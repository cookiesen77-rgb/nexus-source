import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from '@/config/models'
import { getJson, postFormData, postJson } from '@/lib/workflow/request'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
import { getMedia, getMediaByNodeId, saveMedia, isLargeData, isBase64Data } from '@/lib/mediaStorage'
import { requestQueue, type QueueTask } from '@/lib/workflow/requestQueue'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

// 检测是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 根据环境选择 fetch 实现（Windows Tauri 必须用插件 fetch 才能正常工作）
const safeFetch = isTauri ? tauriFetch : globalThis.fetch

// 视频生成参数覆盖接口
export interface VideoGenerationOverrides {
  model?: string
  ratio?: string
  duration?: number
  size?: string
}

const normalizeText = (text: unknown) => String(text || '').replace(/\r\n/g, '\n').trim()

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)

const pickFirstHttpUrlFromText = (text: string) => {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/https?:\/\/\S+/i)
  if (!m) return ''
  return String(m[0] || '').replace(/[)\]}>"'，。,.]+$/g, '').trim()
}

const normalizeMediaUrl = (raw: any) => {
  const v = typeof raw === 'string' ? raw.trim() : ''
  if (!v) return ''
  if (v.startsWith('data:') || v.startsWith('blob:') || isHttpUrl(v)) return v
  const picked = pickFirstHttpUrlFromText(v)
  return picked || ''
}

const extractVideoUrlDeep = (payload: any) => {
  const seen = new Set<string>()
  const urls: string[] = []

  const push = (val: any) => {
    if (typeof val !== 'string') return
    if (!val.startsWith('http')) return
    if (seen.has(val)) return
    seen.add(val)
    urls.push(val)
  }

  const walk = (obj: any, depth = 0) => {
    if (!obj || depth > 6) return
    if (typeof obj === 'string') {
      if (/\.(mp4|webm|mov|m4v|m3u8)(\?|$)/i.test(obj)) push(obj)
      return
    }
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1)
      return
    }
    if (typeof obj !== 'object') return

    for (const k of ['video_url', 'videoUrl', 'url', 'result_url', 'output_url']) {
      if (typeof obj[k] === 'string') push(obj[k])
    }
    for (const v of Object.values(obj)) walk(v, depth + 1)
  }

  walk(payload)
  return urls[0] || ''
}

const sanitizeErrorForNode = (raw: any) => {
  const msg = String(raw?.message || raw || '').trim()
  if (!msg) return '生成失败'
  if (/Failed to fetch|NetworkError|Network request failed/i.test(msg)) {
    return '网络请求失败（Failed to fetch）。请稍后重试，或检查网络/代理设置'
  }
  // 防止把 nginx/网关的整段 HTML 直接写进节点（会污染画布/存储）
  if (/<(html|!doctype|head|body|title)\b/i.test(msg)) {
    const m = msg.match(/<title[^>]*>([^<]+)<\/title>/i)
    const title = m ? String(m[1] || '').trim() : ''
    return title ? title : '网关错误（Bad Gateway）'
  }
  if (msg.length > 360) return `${msg.slice(0, 360)}…`
  return msg
}

const isDataUrl = (v: string) => typeof v === 'string' && v.startsWith('data:')
const isBase64Like = (v: string) =>
  typeof v === 'string' && v.length > 1024 && !v.startsWith('http') && !v.startsWith('blob:') && !v.startsWith('data:')

const resolveReadableImageFromNode = async (node: GraphNode | null): Promise<string> => {
  if (!node || node.type !== 'image') return ''
  const d: any = node.data || {}

  const b64 = typeof d.base64 === 'string' ? d.base64.trim() : ''
  if (b64 && (isDataUrl(b64) || isBase64Like(b64))) return b64

  const url = typeof d.url === 'string' ? d.url.trim() : ''
  if (url && (isDataUrl(url) || isBase64Like(url))) return url

  // 优先 mediaId（若存在），其次按 nodeId 查询（兼容旧数据）
  const mediaId = typeof d.mediaId === 'string' ? d.mediaId.trim() : d.mediaId != null ? String(d.mediaId).trim() : ''
  if (mediaId) {
    try {
      const rec = await getMedia(mediaId)
      const data = typeof rec?.data === 'string' ? rec.data.trim() : ''
      if (data) return data
    } catch {
      // ignore
    }
  }
  try {
    const rec2 = await getMediaByNodeId(node.id)
    const data2 = typeof rec2?.data === 'string' ? rec2.data.trim() : ''
    if (data2) return data2
  } catch {
    // ignore
  }

  return ''
}

const findPreferredOpenAiInputImageNode = (configId: string): GraphNode | null => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const edges = s.edges.filter((e) => e.target === configId)

  let anyImage: GraphNode | null = null
  let firstFrameNode: GraphNode | null = null
  let refNode: GraphNode | null = null

  for (const e of edges) {
    const n = byId.get(e.source)
    if (!n || n.type !== 'image') continue
    if (!anyImage) anyImage = n
    const roleRaw = String((e.data as any)?.imageRole || '').trim()
    if (!firstFrameNode && (roleRaw === '' || roleRaw === 'first_frame_image')) firstFrameNode = n
    if (!refNode && roleRaw === 'input_reference') refNode = n
  }

  return firstFrameNode || refNode || anyImage
}

/**
 * 将图片输入转换为 Blob（对齐 Vue 版本）
 * 支持：data URL、HTTP URL、blob URL、纯 base64 字符串
 */
const resolveImageToBlob = async (input: string): Promise<Blob | null> => {
  const v = String(input || '').trim()
  if (!v) {
    console.warn('[resolveImageToBlob] 输入为空')
    return null
  }
  
  // 1. data URL 格式
  if (v.startsWith('data:')) {
    const m = v.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) {
      console.warn('[resolveImageToBlob] 无效的 data URL 格式')
      return null
    }
    const mime = m[1] || 'image/png'
    const b64 = m[2] || ''
    try {
      // 移除可能的空白字符
      const cleanB64 = b64.replace(/\s/g, '')
      const bin = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0))
      const blob = new Blob([bin], { type: mime })
      console.log('[resolveImageToBlob] 成功从 data URL 创建 Blob, size:', blob.size, 'type:', blob.type)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] base64 解码失败:', err)
      return null
    }
  }
  
  // 2. HTTP/HTTPS URL（使用 safeFetch，Windows Tauri 必须用插件 fetch）
  if (/^https?:\/\//i.test(v)) {
    try {
      console.log('[resolveImageToBlob] 获取 HTTP 图片:', v.slice(0, 80), '...')
      const res = await safeFetch(v, { method: 'GET' })
      if (!res.ok) {
        console.warn('[resolveImageToBlob] HTTP 请求失败:', res.status)
        return null
      }
      const blob = await res.blob()
      console.log('[resolveImageToBlob] 成功从 HTTP URL 获取 Blob, size:', blob.size)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] 无法获取 HTTP 图片:', err)
      return null
    }
  }
  
  // 3. blob: URL（blob URL 只能用原生 fetch，因为它是浏览器内部 URL）
  if (v.startsWith('blob:')) {
    try {
      const res = await globalThis.fetch(v)
      if (!res.ok) {
        console.warn('[resolveImageToBlob] blob URL 请求失败')
        return null
      }
      const blob = await res.blob()
      console.log('[resolveImageToBlob] 成功从 blob URL 获取 Blob, size:', blob.size)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] 无法获取 blob URL:', err)
      return null
    }
  }
  
  // 4. 纯 base64 字符串（兜底，与 Vue 版本对齐）
  if (v.length > 1024 && /^[A-Za-z0-9+/=\s]+$/.test(v)) {
    try {
      const cleanB64 = v.replace(/\s/g, '')
      const bin = Uint8Array.from(atob(cleanB64), (c) => c.charCodeAt(0))
      const blob = new Blob([bin], { type: 'image/png' })
      console.log('[resolveImageToBlob] 成功从纯 base64 创建 Blob, size:', blob.size)
      return blob
    } catch (err) {
      console.error('[resolveImageToBlob] 纯 base64 解码失败:', err)
      return null
    }
  }
  
  console.warn('[resolveImageToBlob] 无法识别的图片格式, 前100字符:', v.slice(0, 100))
  return null
}

/**
 * 获取连接到视频配置节点的输入
 * 与 Vue 版本对齐
 */
const getConnectedInputs = (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const connectedEdges = s.edges.filter((e) => e.target === configId)

  const promptParts: string[] = []
  const firstFrame: string[] = []
  const lastFrame: string[] = []
  const refImages: string[] = []

  for (const edge of connectedEdges) {
    const sourceNode = byId.get(edge.source)
    if (!sourceNode) continue

    if (sourceNode.type === 'text') {
      const text = normalizeText((sourceNode.data as any)?.content || '')
      if (text) promptParts.push(text)
    } else if (sourceNode.type === 'image') {
      // 与 Vue 版本对齐：优先使用 base64/DataURL，其次使用 HTTP URL
      // 原因：某些视频 API 需要 base64 数据，HTTP URL 可能因跨域或链接过期而失败
      const nodeData = sourceNode.data as any
      const isHttpUrl = (u: string) => typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'))
      const isDataUrl = (u: string) => typeof u === 'string' && u.startsWith('data:')
      const isBase64Like = (u: string) => typeof u === 'string' && u.length > 1024 && !u.startsWith('http') && !u.startsWith('blob:')
      
      let imageData = ''
      let dataSource = ''
      
      // 1. 优先使用 base64 字段（与 Vue 版本对齐）
      if (nodeData?.base64 && (isDataUrl(nodeData.base64) || isBase64Like(nodeData.base64))) {
        imageData = nodeData.base64
        dataSource = 'base64 字段'
      // 2. url 如果是 DataURL
      } else if (nodeData?.url && isDataUrl(nodeData.url)) {
        imageData = nodeData.url
        dataSource = 'url(DataURL)'
      // 3. url 如果是 HTTP URL
      } else if (nodeData?.url && isHttpUrl(nodeData.url)) {
        imageData = nodeData.url
        dataSource = 'url(HTTP)'
      // 4. sourceUrl（原始 HTTPS URL，作为兜底）
      } else if (nodeData?.sourceUrl && isHttpUrl(nodeData.sourceUrl)) {
        imageData = nodeData.sourceUrl
        dataSource = 'sourceUrl'
      // 5. 纯 base64 字段（无前缀）
      } else if (nodeData?.base64 && typeof nodeData.base64 === 'string' && nodeData.base64.length > 100) {
        imageData = nodeData.base64
        dataSource = 'base64(raw)'
      }
      
      if (!imageData) {
        console.warn('[getConnectedInputs] 图片节点没有可用的图片数据，跳过:', sourceNode.id, 
          '可用字段:', { hasUrl: !!nodeData?.url, hasBase64: !!nodeData?.base64, hasSourceUrl: !!nodeData?.sourceUrl })
        continue
      }
      
      console.log('[getConnectedInputs] 图片数据来源:', dataSource, '长度:', imageData.length,
        '前缀:', imageData.slice(0, 30))

      const roleRaw = String((edge.data as any)?.imageRole || '').trim()
      if (roleRaw === 'last_frame_image') {
        lastFrame.push(imageData)
      } else if (roleRaw === 'input_reference') {
        refImages.push(imageData)
      } else {
        // 默认是首帧
        firstFrame.push(imageData)
      }
    }
  }

  return {
    prompt: promptParts.join('\n\n'),
    firstFrame: firstFrame[0] || '',
    lastFrame: lastFrame[0] || '',
    refImages: Array.from(new Set(refImages))
  }
}

/**
 * 查找已连接的空白输出视频节点（可复用）
 */
const findConnectedOutputVideoNode = (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const outputEdges = s.edges.filter((e) => e.source === configId)

  for (const edge of outputEdges) {
    const targetNode = byId.get(edge.target)
    if (
      targetNode?.type === 'video' &&
      !(targetNode.data as any)?.loading &&
      (!(targetNode.data as any)?.url || (targetNode.data as any)?.url === '')
    ) {
      return targetNode.id
    }
  }
  return null
}

const pollVideoTask = async (id: string, modelCfg: any) => {
  const maxAttempts = 300  // 增加到 300 次（15 分钟）
  const interval = 3000    // 3 秒间隔
  const maxConsecutiveErrors = 10 // 连续错误次数限制
  
  console.log('[pollVideoTask] 开始轮询, 任务 ID:', id, '最大尝试:', maxAttempts)
  let lastErr: any = null
  let consecutiveErrors = 0
  let lastSuccessStatus = ''

  const isTransientPollError = (err: any) => {
    const msg = String(err?.message || err || '')
    if (!msg) return true
    if (/Failed to fetch|NetworkError|Network request failed/i.test(msg)) return true
    if (/响应解析失败（JSON）|Unexpected end of JSON|Unexpected token/i.test(msg)) return true
    const m = msg.match(/HTTP\s+(\d{3})/i)
    if (m) {
      const code = Number(m[1])
      return code === 404 || code === 408 || code === 429 || code === 500 || code === 502 || code === 503 || code === 504
    }
    if (/Bad Gateway|Gateway Timeout|Service Unavailable/i.test(msg)) return true
    return false
  }

  for (let i = 0; i < maxAttempts; i++) {
    const statusEndpoint = modelCfg.statusEndpoint
    if (!statusEndpoint) throw new Error('未配置视频查询端点')

    let resp: any
    try {
      if (typeof statusEndpoint === 'function') {
        resp = await getJson<any>(statusEndpoint(id), undefined, { authMode: modelCfg.authMode })
      } else {
        resp = await getJson<any>(statusEndpoint, { id }, { authMode: modelCfg.authMode })
      }
      // 请求成功，重置连续错误计数
      consecutiveErrors = 0
    } catch (err: any) {
      lastErr = err
      consecutiveErrors++
      const elapsed = Math.round((i + 1) * interval / 1000)
      const msg = String(err?.message || err || '')
      const transient = isTransientPollError(err)
      console.warn(`[pollVideoTask] 轮询 ${i + 1}/${maxAttempts} (${elapsed}s): 查询失败 [连续错误: ${consecutiveErrors}]`, { transient, message: msg.slice(0, 160) })
      
      // 如果是非临时错误，立即抛出
      if (!transient) throw err
      
      // 如果连续错误太多，可能是后端严重问题
      if (consecutiveErrors >= maxConsecutiveErrors) {
        console.error(`[pollVideoTask] 连续 ${consecutiveErrors} 次请求失败，停止轮询`)
        throw new Error(`视频状态查询持续失败（${consecutiveErrors} 次）。后端服务可能不可用，请稍后重试。`)
      }
      
      // 使用指数退避，但不超过 10 秒
      const backoff = Math.min(interval * Math.pow(1.5, Math.min(consecutiveErrors - 1, 3)), 10000)
      await new Promise((r) => setTimeout(r, backoff))
      continue
    }
    
    const status = String(resp?.status || resp?.data?.status || '').toLowerCase()
    const elapsed = Math.round((i + 1) * interval / 1000)
    lastSuccessStatus = status
    console.log(`[pollVideoTask] 轮询 ${i + 1}/${maxAttempts} (${elapsed}s):`, {
      status,
      hasVideoUrl: !!(resp?.video_url || resp?.data?.video_url || resp?.url || resp?.data?.url)
    })

    const direct = extractVideoUrlDeep(resp)
    if (direct) {
      console.log('[pollVideoTask] 获取到视频 URL:', direct?.slice(0, 80))
      return direct
    }

    if (status === 'failed') {
      const errMsg = resp?.error?.message || resp?.message || resp?.data?.error?.message || '视频生成失败'
      console.error('[pollVideoTask] 视频生成失败:', errMsg)
      throw new Error(errMsg)
    }

    await new Promise((r) => setTimeout(r, interval))
  }

  // 超时处理 - 提供更详细的信息
  const timeoutInfo = lastSuccessStatus 
    ? `最后状态: ${lastSuccessStatus}` 
    : (lastErr ? `最后错误: ${sanitizeErrorForNode(lastErr)}` : '')
  throw new Error(`视频生成超时（${Math.round(maxAttempts * interval / 60000)} 分钟）。${timeoutInfo}。请检查后端服务状态或稍后重试。`)
}

export const generateVideoFromConfigNode = async (configNodeId: string, overrides?: VideoGenerationOverrides) => {
  console.log('[generateVideo] 开始生成视频, configNodeId:', configNodeId, 'overrides:', overrides)
  
  const store = useGraphStore.getState()
  const cfg = store.nodes.find((n) => n.id === configNodeId)
  if (!cfg || cfg.type !== 'videoConfig') throw new Error('请选择一个"视频配置"节点')

  const d: any = cfg.data || {}
  console.log('[generateVideo] 节点数据:', d)

  // 1. 获取连接的输入
  const { prompt, firstFrame, lastFrame, refImages } = getConnectedInputs(configNodeId)
  console.log('[generateVideo] 连接输入:', {
    promptLength: prompt?.length || 0,
    hasFirstFrame: !!firstFrame,
    hasLastFrame: !!lastFrame,
    refImagesCount: refImages.length,
    // 显示图片 URL 前缀以确认是 HTTP 还是 base64
    firstFrameType: firstFrame ? (firstFrame.startsWith('http') ? 'HTTP URL' : 'base64/other') : 'none',
    refImagesTypes: refImages.map(img => img.startsWith('http') ? 'HTTP URL' : 'base64/other')
  })

  if (!prompt && !firstFrame && !lastFrame && refImages.length === 0) {
    throw new Error('请连接文本节点（提示词）或图片节点（首帧/尾帧/参考图）')
  }

  // 优先使用 overrides 参数，解决 UI 选择与实际调用不一致的问题
  const modelKey = String(overrides?.model || d.model || DEFAULT_VIDEO_MODEL)
  const modelCfg: any = (VIDEO_MODELS as any[]).find((m) => m.key === modelKey) || (VIDEO_MODELS as any[])[0]
  console.log('[generateVideo] 模型配置:', { modelKey, modelCfg, fromOverrides: !!overrides?.model })
  if (!modelCfg) throw new Error('未找到模型配置')

  // 优先使用 overrides 参数
  const ratio = String(overrides?.ratio || d.ratio || modelCfg.defaultParams?.ratio || modelCfg.defaultParams?.aspect_ratio || '')
  const duration = Number(overrides?.duration || d.duration || d.dur || modelCfg.defaultParams?.duration || 0)
  const imagesAll = [firstFrame, lastFrame, ...refImages].filter(Boolean)
  const images = Array.from(new Set(imagesAll)).slice(0, Number(modelCfg.maxImages || 2))

  // 2. 先创建/复用视频节点（显示 loading 状态）
  let videoNodeId = findConnectedOutputVideoNode(configNodeId)
  const nodeX = cfg.x
  const nodeY = cfg.y

  if (videoNodeId) {
    store.updateNode(videoNodeId, { data: { loading: true, error: '' } } as any)
  } else {
    videoNodeId = store.addNode('video', { x: nodeX + 460, y: nodeY }, {
      url: '',
      loading: true,
      label: '视频生成结果'
    })
    store.addEdge(configNodeId, videoNodeId, {
      sourceHandle: 'right',
      targetHandle: 'left'
    })
  }

  // 3. 调用 API 生成视频
  let errorStage: 'precheck' | 'create' | 'poll' | 'finalize' = 'precheck'
  try {
    let payload: any = null
    let requestType: 'json' | 'formdata' = 'json'
    let endpointOverride: string = modelCfg.endpoint
    let statusEndpointOverride: any = modelCfg.statusEndpoint

    if (modelCfg.format === 'veo-unified') {
      payload = { model: modelCfg.key, prompt }
      if (images.length > 0) payload.images = images
      if (ratio === '16:9' || ratio === '9:16') payload.aspect_ratio = ratio
      // 添加 duration 参数
      if (Number.isFinite(duration) && duration > 0) payload.duration = duration
      const ep = modelCfg.defaultParams?.enhancePrompt
      if (typeof ep === 'boolean') payload.enhance_prompt = ep
      const up = modelCfg.defaultParams?.enableUpsample
      if (typeof up === 'boolean') payload.enable_upsample = up
    } else if (modelCfg.format === 'sora-unified') {
      const orientation = ratio === '9:16' ? 'portrait' : 'landscape'
      const size = d.size || modelCfg.defaultParams?.size || 'large'
      const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 15)
      payload = {
        model: modelCfg.key,
        prompt,
        orientation,
        size,
        duration: dur
      }
      if (images.length > 0) payload.images = images
      const watermark = typeof d.watermark === 'boolean' ? d.watermark : modelCfg.defaultParams?.watermark
      if (typeof watermark === 'boolean') payload.watermark = watermark
      const priv = typeof d.private === 'boolean' ? d.private : modelCfg.defaultParams?.private
      if (typeof priv === 'boolean') payload.private = priv
    } else if (modelCfg.format === 'unified-video') {
      // 即梦视频统一格式：需要 size 参数（官方文档要求）
      payload = { model: modelCfg.key, prompt }
      if (images.length > 0) payload.images = images
      if (ratio) payload.aspect_ratio = ratio
      // 添加必需的 size 参数（默认 1080P）
      const sizeParam = d.size || modelCfg.defaultParams?.size || '1080P'
      payload.size = sizeParam
      if (duration) payload.duration = duration
    } else if (modelCfg.format === 'openai-video') {
      const inputNode = findPreferredOpenAiInputImageNode(configNodeId)
      let inputCandidate = firstFrame || refImages[0] || ''

      // 若当前候选是 URL（或为空），优先尝试从 IndexedDB 取回可读取的 dataURL/base64（避免跨域/CORS 导致 Failed to fetch）
      const localData = await resolveReadableImageFromNode(inputNode)
      if (localData) {
        const cur = String(inputCandidate || '')
        const preferLocal = !cur || cur.startsWith('http') || cur.startsWith('blob:')
        if (preferLocal) inputCandidate = localData
      }

      if (!inputCandidate) throw new Error('该视频模型需要垫图（请连接首帧/参考图）')
      const blob = await resolveImageToBlob(inputCandidate)
      if (!blob) {
        throw new Error('垫图解析失败（可能跨域/CORS 或链接已过期）。建议：使用上传/拖入的本地图片，或先让图片节点完成缓存（mediaId）')
      }

      const fd = new FormData()
      fd.append('model', modelCfg.key)
      fd.append('prompt', prompt)
      if (Number.isFinite(duration) && duration > 0) fd.append('seconds', String(duration))
      const sizeValue = ratio === '9:16' ? '720x1280' : '1280x720'
      fd.append('size', sizeValue)
      const watermark = modelCfg.defaultParams?.watermark
      if (typeof watermark === 'boolean') fd.append('watermark', watermark ? 'true' : 'false')
      fd.append('input_reference', blob, 'input.png')

      requestType = 'formdata'
      payload = fd
    } else if (modelCfg.format === 'kling-video') {
      const hasAnyImage = Boolean(firstFrame || lastFrame || refImages.length > 0)
      const modelName = modelCfg.defaultParams?.model_name || 'kling-v2-6'
      const mode = modelCfg.defaultParams?.mode || 'pro'
      const sound = modelCfg.defaultParams?.sound || 'off'
      // Kling API 要求 duration 为字符串类型（官方文档要求）
      const durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : '10'

      if (hasAnyImage) {
        const image = firstFrame || refImages[0] || ''
        if (!image) throw new Error('Kling 图生视频需要首帧/参考图（请连接图片节点）')
        endpointOverride = modelCfg.endpointImage || endpointOverride
        statusEndpointOverride = modelCfg.statusEndpointImage || statusEndpointOverride
        payload = {
          model_name: modelName,
          image,
          image_tail: lastFrame || '',
          mode,
          duration: durValue,  // 字符串类型
          sound
        }
        if (prompt) payload.prompt = prompt
      } else {
        payload = { model_name: modelName, prompt, mode, duration: durValue, sound }
        if (ratio) payload.aspect_ratio = ratio
      }
    } else if (modelCfg.format === 'tencent-video') {
      const version = modelCfg.defaultParams?.version
      payload = { model: modelCfg.key, prompt }
      if (version) payload.version = version
      if (ratio) payload.aspect_ratio = ratio
      if (duration) payload.duration = Number(duration)
    } else if (modelCfg.format === 'openai-video') {
      // Sora 2 / OpenAI Videos API 格式 (/videos/generations)
      const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 10)
      const size = d.size || modelCfg.defaultParams?.size || '720p'
      const aspectRatio = ratio || modelCfg.defaultParams?.ratio || '16:9'
      
      payload = {
        model: modelCfg.key,
        prompt: prompt || '',
        duration: dur,
        size: size,
        aspect_ratio: aspectRatio
      }
      
      // 如果有参考图，添加为 image 参数
      if (firstFrame || refImages.length > 0) {
        const imageUrl = firstFrame || refImages[0]
        payload.image = imageUrl
      }
    } else if (modelCfg.format === 'openai-chat-video') {
      // 旧的 Chat Completions 视频格式（兼容性保留）
      const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 8)
      const size = d.size || modelCfg.defaultParams?.size || '720p'
      const aspectRatio = ratio || modelCfg.defaultParams?.ratio || '16:9'
      
      let videoPrompt = prompt || ''
      if (firstFrame || refImages.length > 0) {
        const imageUrl = firstFrame || refImages[0]
        payload = {
          model: modelCfg.key,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: `Generate a ${dur} second video at ${size} resolution with aspect ratio ${aspectRatio}. ${videoPrompt}` },
                { type: 'image_url', image_url: { url: imageUrl } }
              ]
            }
          ],
          video: { duration: dur, size: size, aspect_ratio: aspectRatio }
        }
      } else {
        payload = {
          model: modelCfg.key,
          messages: [{ role: 'user', content: `Generate a ${dur} second video at ${size} resolution with aspect ratio ${aspectRatio}. ${videoPrompt}` }],
          video: { duration: dur, size: size, aspect_ratio: aspectRatio }
        }
      }
    } else {
      throw new Error(`暂未支持该视频模型格式：${String(modelCfg.format || '')}`)
    }

    console.log('[generateVideo] 发送 API 请求:', {
      endpoint: endpointOverride,
      requestType,
      authMode: modelCfg.authMode,
      format: modelCfg.format,
      modelKey: modelCfg.key,
      payload: requestType === 'formdata' ? '[FormData]' : payload
    })
    console.log('[generateVideo] 完整 payload:', JSON.stringify(payload, null, 2))
    
    // 带重试的 API 调用（处理网络抖动）
    const maxRetries = 3
    let lastError: Error | null = null
    let task: any = null
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        errorStage = 'create'
        if (attempt > 0) {
          console.log(`[generateVideo] 第 ${attempt + 1} 次重试...`)
          await new Promise(r => setTimeout(r, 1000 * attempt)) // 递增延迟
        }
        
        task = requestType === 'formdata'
          ? await postFormData<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
          : await postJson<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
        
        break // 成功则跳出重试循环
      } catch (err: any) {
        lastError = err
        const isNetworkError = err?.message?.includes('Failed to fetch') || 
                               err?.message?.includes('NetworkError') ||
                               err?.message?.includes('ERR_')
        
        // 非网络错误或已达最大重试次数，直接抛出
        if (!isNetworkError || attempt === maxRetries - 1) {
          throw err
        }
        
        console.warn(`[generateVideo] 网络错误，准备重试:`, err?.message)
      }
    }
    
    if (!task) {
      throw lastError || new Error('视频 API 调用失败')
    }
    
    console.log('[generateVideo] API 响应:', task)

    // 尝试从不同格式提取视频 URL
    let extractedVideoUrl = ''
    
    // OpenAI Videos API 格式
    if (modelCfg.format === 'openai-video') {
      // 标准响应格式: { id, status, video_url } 或 { data: [{ url }] }
      extractedVideoUrl = task?.video_url || task?.url || task?.data?.[0]?.url || task?.data?.video_url || ''
      console.log('[generateVideo] OpenAI Video 解析:', { extractedVideoUrl, taskKeys: Object.keys(task || {}) })
    }
    
    // Chat Completions 视频格式
    if (modelCfg.format === 'openai-chat-video') {
      const choice = task?.choices?.[0]
      const content = choice?.message?.content || ''
      extractedVideoUrl = pickFirstHttpUrlFromText(content) || ''
      if (!extractedVideoUrl) {
        extractedVideoUrl = task?.video_url || task?.data?.video_url || choice?.message?.video_url || ''
      }
      console.log('[generateVideo] Chat Video 解析:', { content: content?.slice(0, 200), extractedVideoUrl })
    }

    const directRaw =
      extractedVideoUrl ||
      task?.video_url ||
      task?.data?.video_url ||
      task?.data?.url ||
      task?.url ||
      extractVideoUrlDeep(task)
    let videoUrl = normalizeMediaUrl(directRaw)

    if (!videoUrl) {
      const id = task?.id || task?.task_id || task?.taskId || task?.data?.id || task?.data?.task_id || task?.data?.taskId
      if (!id) throw new Error('视频返回异常：未获取到任务 ID')
      errorStage = 'poll'
      const polled = await pollVideoTask(String(id), { ...modelCfg, statusEndpoint: statusEndpointOverride })
      videoUrl = normalizeMediaUrl(polled)
    }

    if (!videoUrl) {
      const hint = typeof directRaw === 'string' && String(directRaw).trim()
        ? `模型返回文本：${String(directRaw).trim().slice(0, 160)}`
        : ''
      throw new Error(`视频返回为空。${hint}`)
    }
    
    console.log('[generateVideo] 获取到视频 URL:', videoUrl?.slice(0, 100))

    // 4. 成功：更新视频节点
    const cached = await resolveCachedMediaUrl(videoUrl)
    const latestStore = useGraphStore.getState()
    const displayUrl = cached.displayUrl
    
    console.log('[generateVideo] 缓存解析结果:', {
      videoUrl: videoUrl?.slice(0, 80),
      displayUrl: displayUrl?.slice(0, 80),
      localPath: cached.localPath?.slice(0, 50),
      videoNodeId
    })
    
    // 如果数据是大型数据（base64 或 blob URL），保存到 IndexedDB
    let mediaId: string | undefined
    if (isLargeData(displayUrl) || isBase64Data(displayUrl)) {
      try {
        const projectId = latestStore.projectId || 'default'
        mediaId = await saveMedia({
          nodeId: videoNodeId,
          projectId,
          type: 'video',
          data: displayUrl,
          sourceUrl: videoUrl !== displayUrl ? videoUrl : undefined,
          model: modelKey,
        })
        console.log('[generateVideo] 视频已保存到 IndexedDB, mediaId:', mediaId)
      } catch (err) {
        console.error('[generateVideo] 保存到 IndexedDB 失败:', err)
      }
    }
    
    latestStore.updateNode(videoNodeId, {
      data: {
        url: displayUrl,
        localPath: cached.localPath,
        // 如果是 HTTPS URL，保存原始 URL；否则保存 mediaId
        sourceUrl: isHttpUrl(videoUrl) ? videoUrl : undefined,
        mediaId, // IndexedDB 媒体 ID
        loading: false,
        error: '',
        label: '视频',
        model: modelKey,
        updatedAt: Date.now()
      }
    } as any)
    
    // 等待 React 渲染周期，确保 store 更新已同步
    await new Promise(r => setTimeout(r, 50))
    
    // 验证更新是否成功
    const afterUpdate = useGraphStore.getState().nodes.find(n => n.id === videoNodeId)
    console.log('[generateVideo] 更新后验证:', {
      nodeId: afterUpdate?.id,
      hasUrl: !!(afterUpdate?.data as any)?.url,
      urlLength: (afterUpdate?.data as any)?.url?.length || 0,
      urlPreview: (afterUpdate?.data as any)?.url?.slice(0, 80),
      loading: (afterUpdate?.data as any)?.loading,
      error: (afterUpdate?.data as any)?.error,
      mediaId: (afterUpdate?.data as any)?.mediaId
    })
    
    // 如果验证失败，尝试重新更新
    if (!afterUpdate || !(afterUpdate.data as any)?.url) {
      console.warn('[generateVideo] 节点更新验证失败，尝试重新更新')
      useGraphStore.getState().updateNode(videoNodeId, {
        data: { url: displayUrl, loading: false, error: '', model: modelKey, mediaId }
      } as any)
      await new Promise(r => setTimeout(r, 50))
    }
    
    // 触发 React Flow 节点刷新事件
    try {
      const event = new CustomEvent('nexus:node-updated', { detail: { nodeId: videoNodeId, type: 'video' } })
      window.dispatchEvent(event)
    } catch (e) {
      console.warn('[generateVideo] 触发刷新事件失败:', e)
    }

    latestStore.setSelected(videoNodeId)
    latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: videoNodeId } } as any)
    errorStage = 'finalize'

  } catch (err: any) {
    // 5. 失败：更新视频节点显示错误
    console.error('[generateVideo] 生成失败:', err?.message, err)
    const latestStore = useGraphStore.getState()
    const baseMsg = sanitizeErrorForNode(err)
    const msg =
      errorStage === 'create'
        ? (baseMsg.startsWith('创建任务失败：') ? baseMsg : `创建任务失败：${baseMsg}`)
        : errorStage === 'poll'
          ? (baseMsg.startsWith('轮询任务失败：') ? baseMsg : `轮询任务失败：${baseMsg}`)
          : baseMsg
    latestStore.updateNode(videoNodeId, {
      data: {
        loading: false,
        error: msg,
        updatedAt: Date.now()
      }
    } as any)
    throw err
  }
}

/**
 * 将视频生成任务加入队列（用于批量生成）
 * @param configNodeId 视频配置节点 ID
 * @param overrides 参数覆盖
 * @param callbacks 回调函数
 * @returns 任务 ID
 */
export const enqueueVideoGeneration = (
  configNodeId: string,
  overrides?: VideoGenerationOverrides,
  callbacks?: {
    onProgress?: (progress: number) => void
    onComplete?: (result: any) => void
    onError?: (error: Error) => void
  }
): string => {
  return requestQueue.enqueue({
    type: 'video',
    configNodeId,
    overrides,
    priority: 10,
    onProgress: callbacks?.onProgress,
    onComplete: callbacks?.onComplete,
    onError: callbacks?.onError
  })
}

// 注册视频生成执行器
requestQueue.registerExecutor('video', async (task) => {
  const overrides = task.overrides as VideoGenerationOverrides | undefined
  await generateVideoFromConfigNode(task.configNodeId, overrides)
  return { success: true, configNodeId: task.configNodeId }
})
