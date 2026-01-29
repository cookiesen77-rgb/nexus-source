import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from '@/config/models'
import { getJson, postJson } from '@/lib/workflow/request'
import { resolveCachedImageUrl } from '@/lib/workflow/cache'
import { saveMedia, isLargeData, isBase64Data } from '@/lib/mediaStorage'
import { requestQueue, type QueueTask } from '@/lib/workflow/requestQueue'
import { useAssetsStore } from '@/store/assets'

// 图片生成参数覆盖接口
export interface ImageGenerationOverrides {
  model?: string
  size?: string
  quality?: string
}

const normalizeText = (text: unknown) => String(text || '').replace(/\r\n/g, '\n').trim()

const toDataUrl = (b64: string, mime = 'image/png') => `data:${mime};base64,${b64}`

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)

// Gemini 生图容易在高并发或提示词不明确时返回纯文本（无 inlineData）。
// 这里统一把提示词包裹成“只输出图片”的指令，提高稳定性。
const buildGeminiImagePrompt = (raw: string) => {
  const t = normalizeText(raw)
  if (!t) return ''
  return `请直接生成图片，不要输出任何解释文字。画面描述：\n${t}`
}

const pickFirstHttpUrlFromText = (text: string) => {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/https?:\/\/\S+/i)
  if (!m) return ''
  // 去掉常见的尾随标点/引号/括号，避免 src 带上无效字符
  return String(m[0] || '').replace(/[)\]}>"'，。,.]+$/g, '').trim()
}

const extractUrlsDeep = (payload: any) => {
  const urls: string[] = []
  const seen = new Set<string>()
  const push = (val: any) => {
    if (typeof val !== 'string') return
    const v = val.trim()
    if (!v) return
    if (!v.startsWith('http') && !v.startsWith('data:')) return
    if (seen.has(v)) return
    seen.add(v)
    urls.push(v)
  }
  const walk = (obj: any, depth = 0) => {
    if (!obj || depth > 5) return
    if (typeof obj === 'string') return push(obj)
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1)
      return
    }
    if (typeof obj !== 'object') return
    for (const k of ['url', 'image_url', 'imageUrl', 'output_url', 'result_url']) {
      if (typeof (obj as any)[k] === 'string') push((obj as any)[k])
    }
    for (const v of Object.values(obj)) walk(v, depth + 1)
  }
  walk(payload)
  return urls
}

const normalizeToImageUrl = (resp: any) => {
  const data = resp?.data
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0]
    if (typeof first?.url === 'string' && first.url) return first.url
    if (typeof first?.b64_json === 'string' && first.b64_json) return toDataUrl(first.b64_json, 'image/png')
  }
  if (typeof resp?.url === 'string') return resp.url
  if (typeof resp?.image_url === 'string') return resp.image_url
  return ''
}

const resolveImageToInlineData = async (input: string) => {
  const v = String(input || '').trim()
  if (!v) return null
  if (v.startsWith('data:')) {
    const m = v.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) return null
    return { mimeType: m[1] || 'image/png', data: m[2] || '' }
  }
  if (!/^https?:\/\//i.test(v)) return null

  try {
    const res = await fetch(v, { method: 'GET' })
    if (!res.ok) return null
    const blob = await res.blob()
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('read failed'))
      reader.onload = () => resolve(String(reader.result || ''))
      reader.readAsDataURL(blob)
    })
    const m = base64.match(/^data:([^;]+);base64,(.*)$/)
    if (!m) return null
    return { mimeType: m[1] || blob.type || 'image/png', data: m[2] || '' }
  } catch {
    return null
  }
}

/**
 * 获取连接到配置节点的输入（提示词和参考图）
 * 与 Vue 版本 getConnectedInputs() 对齐
 */
const getConnectedInputs = (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const connectedEdges = s.edges.filter((e) => e.target === configId)
  
  // 调试日志
  console.log('[getConnectedInputs] configId:', configId)
  console.log('[getConnectedInputs] 总边数:', s.edges.length)
  console.log('[getConnectedInputs] 连接到此节点的边:', connectedEdges.length, connectedEdges.map(e => ({ source: e.source, target: e.target })))
  
  const promptParts: string[] = []
  const refImages: string[] = []

  for (const edge of connectedEdges) {
    const sourceNode = byId.get(edge.source)
    console.log('[getConnectedInputs] 边 source:', edge.source, '-> 节点:', sourceNode?.type, sourceNode?.data)
    if (!sourceNode) continue

    if (sourceNode.type === 'text') {
      const text = normalizeText((sourceNode.data as any)?.content || '')
      console.log('[getConnectedInputs] 提取到文本:', text?.slice(0, 50))
      if (text) promptParts.push(text)
    } else if (sourceNode.type === 'image') {
      // 优先 base64，其次 url（与 Vue 版本一致）
      const imageData = (sourceNode.data as any)?.base64 || (sourceNode.data as any)?.url || (sourceNode.data as any)?.sourceUrl || ''
      if (imageData) refImages.push(imageData)
    }
  }

  console.log('[getConnectedInputs] 结果 - 提示词数:', promptParts.length, '参考图数:', refImages.length)
  return { prompt: promptParts.join('\n\n'), refImages }
}

/**
 * 查找已连接的空白输出图片节点（可复用）
 * 与 Vue 版本 findConnectedOutputImageNode() 对齐
 */
const findConnectedOutputImageNode = (configId: string) => {
  const s = useGraphStore.getState()
  const byId = new Map(s.nodes.map((n) => [n.id, n]))
  const outputEdges = s.edges.filter((e) => e.source === configId)

  for (const edge of outputEdges) {
    const targetNode = byId.get(edge.target)
    // 检查目标是否为空白图片节点（没有 url 且没有在 loading）
    if (
      targetNode?.type === 'image' &&
      !(targetNode.data as any)?.loading &&
      (!(targetNode.data as any)?.url || (targetNode.data as any)?.url === '')
    ) {
      return targetNode.id
    }
  }
  return null
}

export const generateImageFromConfigNode = async (configNodeId: string, overrides?: ImageGenerationOverrides) => {
  // 等待确保 store 状态已同步（增加到 200ms）
  console.log('[generateImage] 开始，等待 store 同步... configNodeId:', configNodeId, 'overrides:', overrides)
  await new Promise(resolve => setTimeout(resolve, 200))
  
  const store = useGraphStore.getState()
  console.log('[generateImage] store 节点数:', store.nodes.length, '边数:', store.edges.length)
  
  const cfg = store.nodes.find((n) => n.id === configNodeId)
  if (!cfg || cfg.type !== 'imageConfig') {
    console.error('[generateImage] 节点未找到或类型错误:', configNodeId, cfg?.type)
    throw new Error('请选择一个"生图配置"节点')
  }

  const d: any = cfg.data || {}
  
  // 1. 获取连接的输入（与 Vue 版本一致）
  const { prompt, refImages } = getConnectedInputs(configNodeId)
  
  console.log('[generateImage] configNodeId:', configNodeId, 'prompt长度:', prompt?.length, 'refImages:', refImages.length)
  
  if (!prompt && refImages.length === 0) {
    throw new Error('请连接文本节点（提示词）或图片节点（参考图）')
  }

  // 优先使用 overrides 参数，解决 UI 选择与实际调用不一致的问题
  const modelKey = String(overrides?.model || d.model || DEFAULT_IMAGE_MODEL)
  const modelCfg: any = (IMAGE_MODELS as any[]).find((m) => m.key === modelKey) || (IMAGE_MODELS as any[])[0]
  console.log('[generateImage] 模型配置:', { modelKey, fromOverrides: !!overrides?.model })
  if (!modelCfg) throw new Error('未找到模型配置')

  // 优先使用 overrides 参数
  const size = String(overrides?.size || d.size || modelCfg.defaultParams?.size || '')
  const quality = String(overrides?.quality || d.quality || modelCfg.defaultParams?.quality || '')

  // 2. 检查模型是否支持参考图
  const format = modelCfg.format
  const supportsRefImages = format === 'gemini-image' || format === 'openai-image-edit' || format === 'kling-image'
  const maxRefImages = modelKey === 'gemini-3-pro-image-preview' ? 14 : refImages.length
  const limitedRefImages = refImages.slice(0, maxRefImages)

  if (!supportsRefImages && refImages.length > 0) {
    if (!prompt) {
      throw new Error('当前模型不支持参考图输入，请添加提示词或切换到支持参考图的模型')
    }
    window.$message?.warning?.('当前模型不支持参考图输入，已忽略参考图（仅使用提示词）')
  }

  // 3. 先创建/复用图片节点（显示 loading 状态）- 与 Vue 版本一致
  let imageNodeId = findConnectedOutputImageNode(configNodeId)
  const nodeX = cfg.x
  const nodeY = cfg.y

  if (imageNodeId) {
    // 复用已有的空白图片节点
    store.updateNode(imageNodeId, { data: { loading: true, error: '' } } as any)
  } else {
    // 创建新的图片节点（带 loading 状态）
    imageNodeId = store.addNode('image', { x: nodeX + 400, y: nodeY }, {
      url: '',
      loading: true,
      label: '图像生成结果'
    })
    // 自动连接 imageConfig → image
    store.addEdge(configNodeId, imageNodeId, {
      sourceHandle: 'right',
      targetHandle: 'left'
    })
  }

  // 4. 调用 API 生成图片
  try {
    let imageUrl = ''
    let textFallback = ''

    if (modelCfg.format === 'gemini-image') {
      const requestParts: any[] = []
      if (prompt) requestParts.push({ text: buildGeminiImagePrompt(prompt) })
      
      for (const input of limitedRefImages) {
        const inline = await resolveImageToInlineData(input)
        if (!inline) continue
        requestParts.push({
          inline_data: {
            mime_type: inline.mimeType,
            data: inline.data
          }
        })
      }
      
      if (requestParts.length === 0) throw new Error('请提供提示词或参考图')

      const payload = {
        contents: [{ role: 'user', parts: requestParts }],
        generationConfig: {
          // 只要图片：避免返回纯文本导致“生图返回为空”
          responseModalities: ['IMAGE'],
          imageConfig: {
            aspectRatio: size || '1:1',
            imageSize: quality || '2K'
          }
        }
      }

      // 针对偶发“200 但无图片”的情况，额外做一次轻量重试（不影响并发）
      for (let attempt = 0; attempt < 2; attempt++) {
        const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
        const parts = rsp?.candidates?.[0]?.content?.parts || []
        const inline = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]
        if (inline?.data) {
          imageUrl = toDataUrl(inline.data, inline.mimeType || inline.mime_type || 'image/png')
          break
        }
        const textPart = parts.map((p: any) => p.text).filter(Boolean)[0]
        if (typeof textPart === 'string' && textPart) {
          textFallback = textPart
          const picked = pickFirstHttpUrlFromText(textPart)
          if (picked) {
            imageUrl = picked
            break
          }
        }
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 500))
        }
      }
    } else if (modelCfg.format === 'openai-image') {
      const payload: any = {
        model: modelCfg.key,
        prompt,
        size: size || modelCfg.defaultParams?.size || '1024x1024',
        n: 1
      }
      if (quality) payload.quality = quality
      const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(rsp)
    } else if (modelCfg.format === 'openai-chat-image') {
      const payload = { model: modelCfg.key, messages: [{ role: 'user', content: prompt }] }
      const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      const maybe = rsp?.choices?.[0]?.message?.content
      if (typeof maybe === 'string') {
        const m = maybe.match(/https?:\/\/\S+/)
        if (m) imageUrl = m[0]
      }
      if (!imageUrl) imageUrl = normalizeToImageUrl(rsp)
    } else if (modelCfg.format === 'openai-image-edit') {
      const imageInput = limitedRefImages[0] || ''
      if (!imageInput) throw new Error('该模型需要参考图（请先连接"图片"节点）')
      const payload: any = { model: modelCfg.key, prompt, image: imageInput }
      const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(rsp) || extractUrlsDeep(rsp)[0] || ''
    } else if (modelCfg.format === 'kling-image') {
      const requestData: any = {
        model_name: modelCfg.defaultParams?.model_name || 'kling-v2-1',
        prompt,
        n: 1,
        aspect_ratio: size || modelCfg.defaultParams?.size || '1:1',
        resolution: quality || modelCfg.defaultParams?.quality || '1k'
      }
      const imageInput = limitedRefImages[0]
      if (imageInput) requestData.image = imageInput
      const resp = await postJson<any>(modelCfg.endpoint, requestData, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      imageUrl = normalizeToImageUrl(resp) || extractUrlsDeep(resp)[0] || ''

      if (!imageUrl) {
        const taskId = resp?.data?.task_id || resp?.data?.id || resp?.task_id || resp?.id || ''
        if (!taskId) throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')
        const statusUrl = `${String(modelCfg.endpoint).replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`

        const maxAttempts = 120
        for (let i = 0; i < maxAttempts; i++) {
          const polled = await getJson<any>(statusUrl, undefined, { authMode: modelCfg.authMode })
          imageUrl = normalizeToImageUrl(polled) || extractUrlsDeep(polled)[0] || ''
          if (imageUrl) break
          const statusText = String(polled?.status || polled?.data?.task_status || polled?.data?.status || polled?.task_status || '').toLowerCase()
          if (statusText && /(fail|error)/i.test(statusText)) {
            throw new Error(polled?.message || polled?.error?.message || 'Kling 生图任务失败')
          }
          await new Promise((r) => setTimeout(r, 3000))
        }
      }
    } else if (modelCfg.format === 'tencent-image') {
      const payload: any = {
        model: modelCfg.key,
        prompt,
        version: modelCfg.defaultParams?.version,
        clarity: modelCfg.defaultParams?.clarity
      }
      const resp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
      const list = resp?.data ?? resp
      const first = Array.isArray(list) ? list[0] : list
      imageUrl = String(first?.url || first?.image_url || first || '').trim()
    } else {
      throw new Error(`暂未支持该生图模型格式：${String(modelCfg.format || '')}`)
    }

    if (!imageUrl) {
      const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
      throw new Error(`生图返回为空。${hint}`)
    }
    if (!imageUrl.startsWith('data:') && !isHttpUrl(imageUrl)) {
      // 避免把纯文本当作 <img src>，否则会请求到 /canvas/<文本> 导致“图片不显示”
      const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
      throw new Error(`生图返回不是图片数据/URL。${hint}`)
    }

    // 5. 成功：更新图片节点
    const cached = await resolveCachedImageUrl(imageUrl)
    console.log('[generateImage] 准备更新节点:', imageNodeId, 'url长度:', cached.displayUrl?.length || 0)
    
    const latestStore = useGraphStore.getState()
    
    // 确认节点存在
    const existingNode = latestStore.nodes.find(n => n.id === imageNodeId)
    console.log('[generateImage] 节点存在检查:', existingNode ? '存在' : '不存在', existingNode?.type)
    
    // 如果数据是大型数据（base64），保存到 IndexedDB
    let mediaId: string | undefined
    const displayUrl = cached.displayUrl
    if (isLargeData(displayUrl) || isBase64Data(displayUrl)) {
      try {
        const projectId = latestStore.projectId || 'default'
        mediaId = await saveMedia({
          nodeId: imageNodeId,
          projectId,
          type: 'image',
          data: displayUrl,
          sourceUrl: imageUrl !== displayUrl ? imageUrl : undefined,
          model: modelKey,
        })
        console.log('[generateImage] 图片已保存到 IndexedDB, mediaId:', mediaId)
      } catch (err) {
        console.error('[generateImage] 保存到 IndexedDB 失败:', err)
        // 继续执行，即使 IndexedDB 保存失败，图片仍然可以在当前会话中显示
      }
    }
    // 若返回的是 HTTP 图片 URL：最佳努力转存为 dataURL 写入 IndexedDB，避免后续 openai-video 垫图因跨域/CORS 无法读取
    if (!mediaId && isHttpUrl(displayUrl)) {
      try {
        const inline = await resolveImageToInlineData(displayUrl)
        if (inline?.data) {
          const projectId = latestStore.projectId || 'default'
          const dataUrl = toDataUrl(inline.data, inline.mimeType || 'image/png')
          mediaId = await saveMedia({
            nodeId: imageNodeId,
            projectId,
            type: 'image',
            data: dataUrl,
            sourceUrl: displayUrl,
            model: modelKey,
          })
          console.log('[generateImage] HTTP 图片已转存到 IndexedDB, mediaId:', mediaId)
        }
      } catch (err) {
        console.warn('[generateImage] HTTP 图片转存 IndexedDB 失败（可能跨域/CORS），跳过:', (err as any)?.message || err)
      }
    }
    
    latestStore.updateNode(imageNodeId, {
      data: {
        url: displayUrl,
        localPath: cached.localPath,
        // 如果是 HTTPS URL，保存原始 URL；如果是 base64，保存 mediaId
        sourceUrl: isHttpUrl(imageUrl) ? imageUrl : undefined,
        mediaId, // IndexedDB 媒体 ID
        loading: false,
        error: '',
        label: '文生图',
        model: modelKey,
        updatedAt: Date.now()
      }
    } as any)
    
    // 等待 React 渲染周期，确保 store 更新已同步
    await new Promise(r => setTimeout(r, 50))
    
    // 验证更新是否成功
    const afterUpdate = useGraphStore.getState().nodes.find(n => n.id === imageNodeId)
    console.log('[generateImage] 更新后验证:', afterUpdate?.id, 'url长度:', (afterUpdate?.data as any)?.url?.length || 0, 'loading:', (afterUpdate?.data as any)?.loading, 'mediaId:', (afterUpdate?.data as any)?.mediaId)
    
    // 如果验证失败，尝试重新更新
    if (!afterUpdate || !(afterUpdate.data as any)?.url) {
      console.warn('[generateImage] 节点更新验证失败，尝试重新更新')
      useGraphStore.getState().updateNode(imageNodeId, {
        data: { url: displayUrl, loading: false, error: '', model: modelKey, mediaId }
      } as any)
      await new Promise(r => setTimeout(r, 50))
    }
    
    // 触发 React Flow 节点刷新事件
    try {
      const event = new CustomEvent('nexus:node-updated', { detail: { nodeId: imageNodeId, type: 'image' } })
      window.dispatchEvent(event)
    } catch (e) {
      console.warn('[generateImage] 触发刷新事件失败:', e)
    }
    
    // 选中新创建的图片节点
    latestStore.setSelected(imageNodeId)

    // 同步到历史素材
    try {
      useAssetsStore.getState().addAsset({
        type: 'image',
        src: displayUrl,
        title: prompt?.slice(0, 50) || '画布生成',
        model: modelKey
      })
    } catch (e) {
      console.warn('[generateImage] 添加到历史素材失败:', e)
    }

    // 标记配置节点已执行
    latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: imageNodeId } } as any)

  } catch (err: any) {
    // 6. 失败：更新图片节点显示错误
    const latestStore = useGraphStore.getState()
    latestStore.updateNode(imageNodeId, {
      data: {
        loading: false,
        error: err?.message || '生成失败',
        updatedAt: Date.now()
      }
    } as any)
    throw err
  }
}

/**
 * 将图片生成任务加入队列（用于批量生成）
 * @param configNodeId 图片配置节点 ID
 * @param overrides 参数覆盖
 * @param callbacks 回调函数
 * @returns 任务 ID
 */
export const enqueueImageGeneration = (
  configNodeId: string,
  overrides?: ImageGenerationOverrides,
  callbacks?: {
    onProgress?: (progress: number) => void
    onComplete?: (result: any) => void
    onError?: (error: Error) => void
  }
): string => {
  return requestQueue.enqueue({
    type: 'image',
    configNodeId,
    overrides,
    priority: 10,
    onProgress: callbacks?.onProgress,
    onComplete: callbacks?.onComplete,
    onError: callbacks?.onError
  })
}

// 注册图片生成执行器
requestQueue.registerExecutor('image', async (task) => {
  const overrides = task.overrides as ImageGenerationOverrides | undefined
  await generateImageFromConfigNode(task.configNodeId, overrides)
  return { success: true, configNodeId: task.configNodeId }
})
