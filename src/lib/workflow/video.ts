import { useGraphStore } from '@/graph/store'
import type { GraphNode } from '@/graph/types'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { getJson, postFormData, postJson } from '@/lib/workflow/request'
import { resolveCachedMediaUrl } from '@/lib/workflow/cache'
import { getMedia, getMediaByNodeId, saveMedia, isLargeData, isBase64Data } from '@/lib/mediaStorage'
import { requestQueue, type QueueTask } from '@/lib/workflow/requestQueue'
import { useSettingsStore } from '@/store/settings'
import { useAssetsStore } from '@/store/assets'
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

export type GenerateVideoFromConfigNodeOptions = {
  /**
   * 指定输出视频节点 ID（用于 loopCount 并发批量生成，避免并发抢占同一输出节点）
   */
  outputNodeId?: string
  /**
   * 是否自动选中输出节点（默认 true）
   * - 批量并发时建议关闭，避免并发任务互相抢焦点
   */
  selectOutput?: boolean
  /**
   * 是否写回配置节点 executed/outputNodeId（默认 true）
   * - 批量并发时建议关闭，由批量调度方统一在结束后写回
   */
  markConfigExecuted?: boolean
}

type RunningTaskState = { cancelled: boolean; activeCount: number }

// 正在运行的视频任务 Map：configNodeId -> { cancelled, activeCount }
// 说明：loopCount 并发时，同一个 configNodeId 会有多个并发任务，因此需要引用计数，避免提前 delete 导致取消失效。
const runningTasks = new Map<string, RunningTaskState>()

// 全局取消标记 - 页面卸载时设为 true
let globalCancelled = false

// 取消指定节点的视频生成任务
export const cancelVideoTask = (nodeId: string) => {
  const task = runningTasks.get(nodeId)
  if (task) {
    task.cancelled = true
    console.log('[cancelVideoTask] 已标记取消任务:', nodeId)
  }
}

// 取消所有正在运行的视频任务
export const cancelAllVideoTasks = () => {
  globalCancelled = true
  runningTasks.forEach((task, nodeId) => {
    task.cancelled = true
    console.log('[cancelAllVideoTasks] 已标记取消任务:', nodeId)
  })
}

// 检查任务是否被取消
const isTaskCancelled = (nodeId: string) => {
  return globalCancelled || runningTasks.get(nodeId)?.cancelled === true
}

// 页面卸载时取消所有任务
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    console.log('[video] 页面卸载，取消所有任务')
    cancelAllVideoTasks()
  })
  window.addEventListener('unload', () => {
    cancelAllVideoTasks()
  })
}

const normalizeText = (text: unknown) => String(text || '').replace(/\r\n/g, '\n').trim()

const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)

/**
 * Build ordered video images:
 * - keep first/last even if duplicated
 * - dedupe refs (and avoid duplicating first/last)
 * - enforce maxImages
 */
const buildOrderedVideoImages = (args: {
  firstFrame: string
  lastFrame: string
  refImages: string[]
  maxImages: number
}) => {
  const max = Number.isFinite(args.maxImages) && args.maxImages > 0 ? Math.floor(args.maxImages) : 2
  const first = String(args.firstFrame || '').trim()
  const last = String(args.lastFrame || '').trim()
  const refs = Array.isArray(args.refImages) ? args.refImages : []

  const out: string[] = []
  if (first) out.push(first)
  if (out.length < max && last) out.push(last)

  const seen = new Set<string>()
  for (const v of out) {
    if (v) seen.add(v)
  }
  for (const r of refs) {
    if (out.length >= max) break
    const v = String(r || '').trim()
    if (!v) continue
    if (seen.has(v)) continue
    out.push(v)
    seen.add(v)
  }
  return out
}

// 检测 Tauri 环境
const isTauriEnv = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

// 将 base64 图片上传到图床，获取公网 URL
// 腾讯 AIGC API 需要公网可访问的图片 URL
const uploadBase64ToImageHost = async (base64Data: string): Promise<string> => {
  // ⚠️ 仅允许使用云雾官方图床：
  // - 文档：https://yunwu.apifox.cn/doc-7376047
  // - API：https://yunwu.apifox.cn/api-356192326
  console.log('[uploadImage] 开始上传图片到云雾图床..., Tauri 环境:', isTauriEnv)

  const apiKey = getApiKey()
  if (!apiKey) {
    throw new Error('缺少 API Key，无法上传到云雾图床。请先在设置中填写 apiKey。')
  }

  // 将 base64 转换为 Blob
  const base64Content = base64Data.split(',')[1] || base64Data
  const mimeMatch = base64Data.match(/^data:([^;]+);/)
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/png'
  const byteCharacters = atob(base64Content)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], { type: mimeType })

  const ext = mimeType.split('/')[1] || 'png'
  const fileName = `image.${ext}`

  const form = new FormData()
  form.append('file', blob, fileName)

  // 使用统一的 postFormData（Tauri 下会自动转换成 multipart bytes）
  const resp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', form, { authMode: 'bearer', timeoutMs: 120000 })
  console.log('[uploadImage] 云雾图床响应:', JSON.stringify(resp, null, 2))
  const urlOut = String(resp?.url || resp?.data?.url || resp?.data?.link || '').trim()
  if (urlOut && /^https?:\/\//i.test(urlOut)) return urlOut
  throw new Error(String(resp?.error || resp?.message || resp?.data?.message || '云雾图床上传失败'))
}

// 图片压缩工具函数 - 将 base64 图片压缩到指定大小以下
const compressImageBase64 = async (base64Data: string, maxSizeBytes: number = 800 * 1024): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        reject(new Error('无法创建 canvas context'))
        return
      }
      
      let { width, height } = img
      let quality = 0.9
      let result = base64Data
      
      // 如果图片本身就很小，直接返回
      const currentSize = Math.ceil((base64Data.length - (base64Data.indexOf(',') + 1)) * 0.75)
      if (currentSize <= maxSizeBytes) {
        resolve(base64Data)
        return
      }
      
      // 计算需要缩小的比例
      const sizeRatio = Math.sqrt(maxSizeBytes / currentSize)
      if (sizeRatio < 1) {
        width = Math.floor(width * Math.max(sizeRatio, 0.5))
        height = Math.floor(height * Math.max(sizeRatio, 0.5))
      }
      
      // 限制最大尺寸
      const maxDim = 1920
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height)
        width = Math.floor(width * scale)
        height = Math.floor(height * scale)
      }
      
      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      
      // 逐步降低质量直到满足大小要求
      for (let q = 0.85; q >= 0.3; q -= 0.1) {
        result = canvas.toDataURL('image/jpeg', q)
        const size = Math.ceil((result.length - (result.indexOf(',') + 1)) * 0.75)
        if (size <= maxSizeBytes) {
          console.log(`[compressImage] 压缩成功: ${Math.round(currentSize/1024)}KB -> ${Math.round(size/1024)}KB, 质量=${q.toFixed(1)}, 尺寸=${width}x${height}`)
          resolve(result)
          return
        }
        quality = q
      }
      
      // 如果还是太大，进一步缩小尺寸
      width = Math.floor(width * 0.7)
      height = Math.floor(height * 0.7)
      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      result = canvas.toDataURL('image/jpeg', 0.6)
      
      const finalSize = Math.ceil((result.length - (result.indexOf(',') + 1)) * 0.75)
      console.log(`[compressImage] 最终压缩: ${Math.round(currentSize/1024)}KB -> ${Math.round(finalSize/1024)}KB, 尺寸=${width}x${height}`)
      resolve(result)
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = base64Data
  })
}

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
  // 支持 data:, blob:, http(s):, 以及相对路径 /v1/...
  if (v.startsWith('data:') || v.startsWith('blob:') || isHttpUrl(v) || v.startsWith('/v1/')) return v
  const picked = pickFirstHttpUrlFromText(v)
  return picked || ''
}

const extractVideoUrlDeep = (payload: any) => {
  const seen = new Set<string>()
  const urls: string[] = []

  // 检查是否为图片 URL
  const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url)
  // 检查是否为视频 URL
  const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(url)

  const push = (val: any, isFromVideoKey = false) => {
    if (typeof val !== 'string') return
    if (!val.startsWith('http')) return
    if (seen.has(val)) return
    // 排除明显的图片 URL
    if (isImageUrl(val)) return
    seen.add(val)
    // 优先添加明确的视频 URL
    if (isVideoUrl(val)) {
      urls.unshift(val) // 添加到开头
    } else if (isFromVideoKey) {
      urls.push(val) // 来自视频相关字段的 URL
    }
  }

  const walk = (obj: any, depth = 0) => {
    if (!obj || depth > 6) return
    if (typeof obj === 'string') {
      if (isVideoUrl(obj)) push(obj, true)
      return
    }
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1)
      return
    }
    if (typeof obj !== 'object') return

    // 检查 FileInfos 数组中的 FileType
    if (Array.isArray(obj.FileInfos) || Array.isArray(obj.file_infos)) {
      const fileInfos = obj.FileInfos || obj.file_infos || []
      for (const fi of fileInfos) {
        const fileType = String(fi?.FileType || fi?.file_type || '').toLowerCase()
        const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url
        // 只接受视频类型或无法确定类型但 URL 是视频格式的
        if (fileUrl && (fileType === 'video' || fileType.includes('video') || isVideoUrl(fileUrl))) {
          push(fileUrl, true)
        }
      }
    }

    for (const k of ['video_url', 'videoUrl', 'result_url', 'output_url']) {
      if (typeof obj[k] === 'string') push(obj[k], true)
    }
    // 不再盲目匹配 'url', 'FileUrl' 等通用字段，避免误取图片 URL
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
 * 将图片调整为指定尺寸（用于 Sora OpenAI 格式）
 * Sora API 要求图片尺寸必须与请求的 size 参数完全匹配
 * @param blob 原始图片 Blob
 * @param targetSize 目标尺寸，格式为 "WIDTHxHEIGHT"（如 "720x1280"）
 * @returns 调整后的 Blob
 */
const resizeImageBlob = async (blob: Blob, targetSize: string): Promise<Blob> => {
  // 解析目标尺寸
  const match = targetSize.match(/^(\d+)x(\d+)$/)
  if (!match) {
    console.warn('[resizeImageBlob] 无效的尺寸格式:', targetSize)
    return blob
  }
  const targetWidth = parseInt(match[1], 10)
  const targetHeight = parseInt(match[2], 10)
  
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(blob)
    
    img.onload = () => {
      URL.revokeObjectURL(url)
      
      // 创建 canvas 并绘制调整后的图片
      const canvas = document.createElement('canvas')
      canvas.width = targetWidth
      canvas.height = targetHeight
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        console.warn('[resizeImageBlob] 无法获取 canvas context')
        resolve(blob)
        return
      }
      
      // 计算裁剪/填充参数以保持宽高比并居中
      const srcRatio = img.width / img.height
      const dstRatio = targetWidth / targetHeight
      
      let sx = 0, sy = 0, sw = img.width, sh = img.height
      
      if (srcRatio > dstRatio) {
        // 源图更宽，裁剪两侧
        sw = img.height * dstRatio
        sx = (img.width - sw) / 2
      } else if (srcRatio < dstRatio) {
        // 源图更高，裁剪上下
        sh = img.width / dstRatio
        sy = (img.height - sh) / 2
      }
      
      // 使用高质量缩放
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, targetWidth, targetHeight)
      
      canvas.toBlob((resizedBlob) => {
        if (resizedBlob) {
          console.log('[resizeImageBlob] 图片已调整尺寸:', img.width, 'x', img.height, '->', targetWidth, 'x', targetHeight)
          resolve(resizedBlob)
        } else {
          console.warn('[resizeImageBlob] canvas.toBlob 失败')
          resolve(blob)
        }
      }, 'image/png', 0.95)
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      console.warn('[resizeImageBlob] 图片加载失败')
      resolve(blob)
    }
    
    img.src = url
  })
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

const pollVideoTask = async (id: string, modelCfg: any, nodeId?: string, videoNodeId?: string) => {
  const maxAttempts = 300  // 增加到 300 次（15 分钟）
  // 轮询间隔：极速模式更快拿到完成态；稳定模式更保守减少 429/过载
  const perfMode = useSettingsStore.getState().performanceMode || 'off'
  const interval = perfMode === 'ultra' ? 2000 : perfMode === 'normal' ? 3000 : 3500
  const maxConsecutiveErrors = 10 // 连续错误次数限制
  
  console.log('[pollVideoTask] 开始轮询, 任务 ID:', id, 'nodeId:', nodeId, '最大尝试:', maxAttempts)
  let lastErr: any = null
  let consecutiveErrors = 0
  let lastSuccessStatus = ''

  const isTransientPollError = (err: any) => {
    const msg = String(err?.message || err || '')
    if (!msg) return true
    // 网络错误
    if (/Failed to fetch|NetworkError|Network request failed/i.test(msg)) return true
    // JSON 解析错误
    if (/响应解析失败（JSON）|Unexpected end of JSON|Unexpected token|did not match|expected pattern/i.test(msg)) return true
    // Tauri HTTP 插件特有错误
    if (/error sending request|request error|sending request|connect error|connection/i.test(msg)) return true
    // HTTP 状态码
    const m = msg.match(/HTTP\s+(\d{3})/i)
    if (m) {
      const code = Number(m[1])
      return code === 404 || code === 408 || code === 429 || code === 500 || code === 502 || code === 503 || code === 504
    }
    if (/Bad Gateway|Gateway Timeout|Service Unavailable/i.test(msg)) return true
    return false
  }

  for (let i = 0; i < maxAttempts; i++) {
    // 检查任务是否被取消
    if (nodeId && isTaskCancelled(nodeId)) {
      console.log('[pollVideoTask] 任务已被取消:', nodeId)
      throw new Error('任务已取消')
    }
    
    // 检查节点是否还存在（用户可能已删除配置节点或视频节点）
    if (nodeId || videoNodeId) {
      const store = useGraphStore.getState()
      const configExists = !nodeId || store.nodes.some(n => n.id === nodeId)
      const videoExists = !videoNodeId || store.nodes.some(n => n.id === videoNodeId)
      if (!configExists || !videoExists) {
        console.log('[pollVideoTask] 节点已被删除，停止轮询:', { nodeId, videoNodeId, configExists, videoExists })
        throw new Error('节点已删除，任务已取消')
      }
    }
    const statusEndpoint = modelCfg.statusEndpoint
    if (!statusEndpoint) throw new Error('未配置视频查询端点')

    let resp: any
    try {
      // Tencent AIGC Video 格式使用 GET 请求到 /tencent-vod/v1/query/{task_id} 查询任务状态
      if (modelCfg.format === 'tencent-video') {
        const queryUrl = typeof statusEndpoint === 'function' ? statusEndpoint(id) : `${statusEndpoint}/${id}`
        resp = await getJson<any>(queryUrl, undefined, { authMode: modelCfg.authMode })
      } else if (typeof statusEndpoint === 'function') {
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
    
    // 支持多种响应格式的状态解析 (PascalCase 和 snake_case)
    const response = resp?.Response || resp?.response || resp
    // 腾讯 AIGC 格式: Response.AigcVideoTask 或 Response.AigcImageTask
    const aigcTask = response?.AigcVideoTask || response?.AigcImageTask || response?.aigc_video_task || response?.aigc_image_task
    // 注意：output 必须优先从 aigcTask.Output 获取，不能跳过 aigcTask
    const aigcOutput = aigcTask?.Output || aigcTask?.output
    const output = aigcOutput || response?.Output || response?.output || resp?.output || resp?.data?.output || resp?.data || resp
    
    // 状态优先从 Response.Status 或 AigcTask.Status 获取
    // OpenAI Sora 格式可能使用 state 字段
    const status = String(
      response?.Status || response?.status || response?.state ||
      aigcTask?.Status || aigcTask?.status ||
      output?.TaskStatus || output?.task_status || output?.status || output?.state ||
      resp?.status || resp?.state || resp?.data?.status || resp?.data?.state || ''
    ).toLowerCase()
    const elapsed = Math.round((i + 1) * interval / 1000)
    lastSuccessStatus = status
    
    // 尝试从多个位置获取视频 URL (腾讯 AIGC 格式: AigcTask.Output.FileInfos[0].FileUrl)
    const fileInfos = aigcOutput?.FileInfos || aigcOutput?.file_infos || output?.FileInfos || output?.file_infos || []
    
    // 从 FileInfos 中筛选视频文件（排除图片）
    const isImageUrl = (url: string) => /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(url)
    const isVideoUrl = (url: string) => /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(url)
    
    let videoUrlFromFileInfos = ''
    for (const fi of fileInfos) {
      const fileType = String(fi?.FileType || fi?.file_type || '').toLowerCase()
      const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url || ''
      // 优先选择类型为 video 的文件，或者 URL 是视频格式的文件
      if (fileUrl && (fileType === 'video' || fileType.includes('video') || isVideoUrl(fileUrl))) {
        videoUrlFromFileInfos = fileUrl
        break
      }
      // 如果没有明确的视频类型，选择第一个非图片的文件
      if (fileUrl && !isImageUrl(fileUrl) && !videoUrlFromFileInfos) {
        videoUrlFromFileInfos = fileUrl
      }
    }
    
    // OpenAI Sora 格式支持：output.video, downloads[0].url 等
    const outputVideo = output?.video || resp?.output?.video || resp?.data?.output?.video
    const downloads = resp?.downloads || resp?.data?.downloads || output?.downloads
    const downloadUrl = Array.isArray(downloads) && downloads.length > 0 
      ? (downloads[0]?.url || downloads[0]?.video_url || downloads[0]) 
      : null
    
    const videoUrl = videoUrlFromFileInfos || outputVideo || downloadUrl ||
                     aigcOutput?.VideoUrl || aigcOutput?.video_url ||
                     output?.VideoUrl || output?.video_url || output?.ResultUrl || output?.result_url || 
                     response?.VideoUrl || response?.video_url ||
                     resp?.VideoUrl || resp?.video_url || resp?.result_url || resp?.data?.video_url
    
    console.log(`[pollVideoTask] 轮询 ${i + 1}/${maxAttempts} (${elapsed}s):`, {
      status,
      hasVideoUrl: !!videoUrl,
      videoUrlPreview: videoUrl?.slice?.(0, 80),
      outputVideo: outputVideo?.slice?.(0, 80),
      downloadUrl: typeof downloadUrl === 'string' ? downloadUrl?.slice?.(0, 80) : null
    })

    // 如果直接有视频 URL，返回
    if (videoUrl && videoUrl.startsWith('http')) {
      console.log('[pollVideoTask] 获取到视频 URL:', videoUrl?.slice(0, 80))
      return videoUrl
    }

    const direct = extractVideoUrlDeep(resp)
    if (direct) {
      console.log('[pollVideoTask] 深度解析获取到视频 URL:', direct?.slice(0, 80))
      return direct
    }

    // 如果状态是 finish/completed/success 但没有视频 URL
    // 也支持 ready 状态（某些 API 使用 ready 表示完成）
    const isCompleted = /^(finish|finished|completed|complete|success|done|ready|succeeded)$/i.test(status)
    
    if (isCompleted && !videoUrl) {
      // 对于 sora-openai 格式，视频 URL 就是 /videos/{id}/content 端点
      // 使用相对路径，让请求通过 Vite 代理（避免 CORS 问题）
      if (modelCfg.format === 'sora-openai') {
        const contentUrl = `/v1/videos/${id}/content`
        console.log('[pollVideoTask] Sora OpenAI 格式：构造视频下载 URL:', contentUrl)
        return contentUrl
      }
      
      // 检查 AigcTask 中的错误码和消息
      const errCode = aigcTask?.ErrCode || aigcTask?.err_code || aigcTask?.error_code
      const errMsg = aigcTask?.Message || aigcTask?.message || aigcTask?.error_message || aigcTask?.error
      
      console.warn('[pollVideoTask] 状态已完成但未找到视频 URL，详细结构:', {
        'ErrCode': errCode,
        'Message': errMsg,
        'Progress': aigcTask?.Progress,
        'FileInfos': fileInfos,
        'AigcOutput keys': Object.keys(aigcOutput || {}),
        'fullResp': JSON.stringify(resp)?.slice(0, 2000)
      })
      
      // 如果有错误码或 FileInfos 为空，说明生成失败（sora-openai 格式除外，它没有 FileInfos）
      if (modelCfg.format !== 'sora-openai' && (errCode || errMsg || (fileInfos && fileInfos.length === 0))) {
        const errorDetail = errMsg || errCode || '视频生成完成但未返回文件，可能是内容审核未通过或生成失败'
        console.error('[pollVideoTask] 视频生成失败:', errorDetail)
        throw new Error(errorDetail)
      }
    }

    // 检查失败状态 (支持多种格式: failed, FAILED, fail, error, FAIL)
    if (/^(failed|fail|error)$/i.test(status)) {
      const response0 = resp?.Response || resp?.response || resp
      const errorCandidates: Array<unknown> = [
        resp?.error?.message,
        resp?.error?.msg,
        resp?.error_message,
        resp?.errorMessage,
        resp?.message,
        resp?.msg,
        // grok unified format often uses `error` as string
        typeof resp?.error === 'string' ? resp.error : '',
        typeof resp?.data?.error === 'string' ? resp.data.error : '',
        resp?.data?.error?.message,
        resp?.data?.message,
        response0?.message,
        response0?.msg,
        typeof response0?.error === 'string' ? response0.error : '',
        response0?.error?.message,
        aigcTask?.Message,
        aigcTask?.message,
        aigcTask?.error_message,
        aigcTask?.error,
      ]
      const rawErr =
        errorCandidates
          .map((x) => (typeof x === 'string' ? x.trim() : ''))
          .find((s) => s) || '视频生成失败'

      const traceId =
        (resp?.trace_id || resp?.traceId || resp?.TraceId || response0?.trace_id || response0?.traceId || response0?.TraceId) ?? ''
      const debug = {
        model: String(modelCfg?.key || ''),
        format: String(modelCfg?.format || ''),
        id,
        status,
        traceId: traceId ? String(traceId) : '',
        respKeys: Object.keys(resp || {}),
      }
      console.error('[pollVideoTask] 视频生成失败:', rawErr, debug)
      try {
        const snippet = JSON.stringify(resp)?.slice(0, 2000)
        if (snippet) console.warn('[pollVideoTask] failed 响应片段:', snippet)
      } catch {
        // ignore
      }
      
      // 友好化常见错误消息
      let friendlyMsg = rawErr
      if (/AUDIO_FILTERED|audio.*filter/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：音频内容被审核过滤，请修改提示词后重试'
      } else if (/CONTENT_FILTERED|content.*filter/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：内容被审核过滤，请修改提示词后重试'
      } else if (/NSFW|sensitive|违规/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：内容不符合平台规定，请修改提示词'
      } else if (/timeout|超时/i.test(rawErr)) {
        friendlyMsg = '视频生成超时，请稍后重试'
      } else if (/quota|limit|配额/i.test(rawErr)) {
        friendlyMsg = '视频生成失败：API 配额不足，请检查账户余额'
      }
      
      const extra = traceId ? `（trace_id: ${String(traceId)}）` : ''
      throw new Error(`${friendlyMsg}${extra}`)
    }

    await new Promise((r) => setTimeout(r, interval))
  }

  // 超时处理 - 提供更详细的信息
  const timeoutInfo = lastSuccessStatus 
    ? `最后状态: ${lastSuccessStatus}` 
    : (lastErr ? `最后错误: ${sanitizeErrorForNode(lastErr)}` : '')
  throw new Error(`视频生成超时（${Math.round(maxAttempts * interval / 60000)} 分钟）。${timeoutInfo}。请检查后端服务状态或稍后重试。`)
}

export const generateVideoFromConfigNode = async (
  configNodeId: string,
  overrides?: VideoGenerationOverrides,
  options?: GenerateVideoFromConfigNodeOptions
) => {
  console.log('[generateVideo] 开始生成视频, configNodeId:', configNodeId, 'overrides:', overrides)
  
  const selectOutput = options?.selectOutput !== false
  const markConfigExecuted = options?.markConfigExecuted !== false
  const forcedOutputId = String(options?.outputNodeId || '').trim()
  
  // 注册任务，以便可以被取消（支持同一 configNodeId 并发）
  const existingTask = runningTasks.get(configNodeId)
  if (existingTask) {
    existingTask.activeCount = (existingTask.activeCount || 0) + 1
  } else {
    runningTasks.set(configNodeId, { cancelled: false, activeCount: 1 })
  }
  
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
  // 兼容旧 key（MODEL_ALIASES），避免保存过的项目在升级后找不到模型
  const resolved: any = (modelsConfig as any)?.getModelByName?.(modelKey) || null
  const modelCfg: any =
    (resolved && String(resolved?.format || '').includes('video') ? resolved : null) ||
    (VIDEO_MODELS as any[]).find((m) => m.key === modelKey) ||
    (VIDEO_MODELS as any[])[0]
  console.log('[generateVideo] 模型配置:', { modelKey, resolvedKey: String(modelCfg?.key || ''), modelCfg, fromOverrides: !!overrides?.model })
  if (!modelCfg) throw new Error('未找到模型配置')

  // 优先使用 overrides 参数
  const ratio = String(overrides?.ratio || d.ratio || modelCfg.defaultParams?.ratio || modelCfg.defaultParams?.aspect_ratio || '')
  
  // 详细的 duration 来源追踪
  const durationSources = {
    'overrides.duration': overrides?.duration,
    'd.duration': d.duration,
    'd.dur': d.dur,
    'defaultParams.duration': modelCfg.defaultParams?.duration
  }
  const duration = Number(overrides?.duration ?? d.duration ?? d.dur ?? modelCfg.defaultParams?.duration ?? 0)
  console.log('[generateVideo] Duration 来源追踪:', durationSources, '最终 duration:', duration)
  const images = buildOrderedVideoImages({
    firstFrame,
    lastFrame,
    refImages,
    maxImages: Number(modelCfg.maxImages || 2),
  })

  // 2. 先创建/复用视频节点（显示 loading 状态）
  let videoNodeId = forcedOutputId || findConnectedOutputVideoNode(configNodeId)
  const nodeX = cfg.x
  const nodeY = cfg.y
  
  let forceOutput = false
  if (forcedOutputId) {
    const forcedNode = store.nodes.find((n) => n.id === forcedOutputId)
    if (forcedNode?.type === 'video') {
      forceOutput = true
      // 强制使用指定输出节点
      store.updateNode(forcedOutputId, { data: { loading: true, error: '' } } as any)
    } else {
      console.warn('[generateVideo] 指定 outputNodeId 无效，回退到默认创建/复用:', forcedOutputId, forcedNode?.type)
      videoNodeId = findConnectedOutputVideoNode(configNodeId)
    }
  }

  if (!forceOutput) {
    // 获取重新生成模式设置
    const regenerateMode = useSettingsStore.getState().regenerateMode || 'create'
    
    // 记录旧的视频数据（用于保存到历史记录）
    let oldVideoData: any = null

    if (videoNodeId) {
      const existingNode = store.nodes.find(n => n.id === videoNodeId)
      if (existingNode?.data?.url) {
        oldVideoData = { ...existingNode.data }
      }
      
      if (regenerateMode === 'replace') {
        // 替代模式：直接更新现有节点
        store.updateNode(videoNodeId, { data: { loading: true, error: '' } } as any)
      } else {
        // 新建模式：如果已有节点有内容，创建新节点
        if (oldVideoData?.url) {
          // 将旧数据保存到历史记录
          if (oldVideoData.url) {
            useAssetsStore.getState().addAsset({
              type: 'video',
              src: oldVideoData.url,
              title: oldVideoData.label || '视频历史',
              model: modelKey,
              duration: oldVideoData.duration
            })
          }
          // 创建新节点
          videoNodeId = store.addNode('video', { x: nodeX + 460, y: nodeY + 50 }, {
            url: '',
            loading: true,
            label: '视频生成结果'
          })
          store.addEdge(configNodeId, videoNodeId, {
            sourceHandle: 'right',
            targetHandle: 'left'
          })
        } else {
          // 复用已有的空白视频节点
          store.updateNode(videoNodeId, { data: { loading: true, error: '' } } as any)
        }
      }
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
  }

  if (!videoNodeId) {
    throw new Error('视频输出节点创建失败')
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
      // 强制添加 duration 参数（不论是否有效，都传递，让 API 决定）
      const finalDuration = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 8)
      payload.duration = finalDuration
      console.log('[generateVideo] veo-unified duration:', { userSelected: duration, final: finalDuration })
      const perfMode = useSettingsStore.getState().performanceMode || 'off'
      const forceFast = perfMode === 'ultra'
      const ep = modelCfg.defaultParams?.enhancePrompt
      if (typeof ep === 'boolean') payload.enhance_prompt = forceFast ? false : ep
      const up = modelCfg.defaultParams?.enableUpsample
      if (typeof up === 'boolean') payload.enable_upsample = forceFast ? false : up
    } else if (modelCfg.format === 'sora-unified') {
      const orientation = ratio === '9:16' ? 'portrait' : 'landscape'
      const size = overrides?.size || d.size || modelCfg.defaultParams?.size || 'large'
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
      // 也兼容 Grok 视频统一格式（/v1/video/create）
      payload = { model: modelCfg.key, prompt }
      const requiresImages = typeof modelCfg.requiresImages === 'boolean' ? modelCfg.requiresImages : false
      const imagesMustBeHttp = typeof modelCfg.imagesMustBeHttp === 'boolean' ? modelCfg.imagesMustBeHttp : false
      let imagesForPayload: string[] = images
      if (imagesMustBeHttp) {
        const storeNow = useGraphStore.getState()
        const byId2 = new Map(storeNow.nodes.map((n) => [n.id, n]))
        const connectedEdges2 = storeNow.edges.filter((e) => e.target === configNodeId)

        const firstNodes: GraphNode[] = []
        const lastNodes: GraphNode[] = []
        const refNodes: GraphNode[] = []
        for (const edge of connectedEdges2) {
          const n = byId2.get(edge.source)
          if (!n || n.type !== 'image') continue
          const roleRaw = String((edge.data as any)?.imageRole || '').trim()
          if (roleRaw === 'last_frame_image') lastNodes.push(n)
          else if (roleRaw === 'input_reference') refNodes.push(n)
          else firstNodes.push(n)
        }

        const maxImages = Number(modelCfg.maxImages || 2)
        const out: string[] = []
        const resolvedByNodeId = new Map<string, string>()

        const isPrivateNetUrl = (u: string) =>
          /^https?:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(u)

        const resolvePublicUrlForNode = async (n: GraphNode) => {
          const nd: any = n?.data || {}

          // 1) Prefer real remote URL if exists (avoid local cache / intranet URLs)
          const candidates = [
            nd.sourceUrl,
            nd.sourceURL,
            nd.originalUrl,
            nd.remoteUrl,
            nd.displayUrl,
            nd.url,
          ]
            .map((x) => (typeof x === 'string' ? x.trim() : ''))
            .filter(Boolean)

          const remote = candidates.find((u) => isHttpUrl(u) && !isPrivateNetUrl(u))
          if (remote) return remote

          // 2) If only intranet HTTP URL exists, fail fast with a clear message.
          const intranet = candidates.find((u) => isHttpUrl(u) && isPrivateNetUrl(u))
          if (intranet) {
            throw new Error('该视频模型不支持内网/本地图片链接（localhost/127/192.168/10/172.16-31）。请使用公网可访问的图片 URL，或改用云端生成图片（会带 sourceUrl）。')
          }

          // 3) Convert local data to a public URL via image host upload.
          const localReadable = await resolveReadableImageFromNode(n)
          if (localReadable.startsWith('blob:')) {
            throw new Error('该视频模型不支持 blob 图片，请使用上传/生成后的图片（可转成公网 URL）')
          }
          if (isDataUrl(localReadable)) {
            const compressed = await compressImageBase64(localReadable, 900 * 1024)
            return await uploadBase64ToImageHost(compressed)
          }
          if (isBase64Like(localReadable)) {
            return await uploadBase64ToImageHost(localReadable)
          }

          throw new Error('该视频模型需要公网可访问的图片 URL（http/https）作为垫图。当前连接的图片无法转换，请更换为可访问链接的图片。')
        }

        const resolveForNode = async (n: GraphNode) => {
          const key = String(n?.id || '').trim()
          if (key && resolvedByNodeId.has(key)) return resolvedByNodeId.get(key) || ''
          const u = await resolvePublicUrlForNode(n)
          if (key) resolvedByNodeId.set(key, u)
          return u
        }

        const firstNode = firstNodes[0] || null
        const lastNode = lastNodes[0] || null
        const refCandidates = [...refNodes, ...firstNodes.slice(1), ...lastNodes.slice(1)]

        // first / last can be duplicated (keep both positions if maxImages allows)
        if (firstNode && out.length < maxImages) {
          out.push(await resolveForNode(firstNode))
        }
        if (lastNode && out.length < maxImages) {
          out.push(await resolveForNode(lastNode))
        }

        // refs: dedupe against first/last and among themselves
        const seenRefs = new Set<string>()
        for (const u of out) {
          const v = String(u || '').trim()
          if (v) seenRefs.add(v)
        }
        for (const n of refCandidates) {
          if (out.length >= maxImages) break
          const u = String(await resolveForNode(n) || '').trim()
          if (!u) continue
          if (seenRefs.has(u)) continue
          out.push(u)
          seenRefs.add(u)
        }

        imagesForPayload = out.filter(Boolean).slice(0, maxImages)
      }

      if (requiresImages && imagesForPayload.length === 0) {
        throw new Error('该视频模型需要垫图（请连接首帧/尾帧/参考图至少 1 张）')
      }
      if (imagesForPayload.length > 0) payload.images = imagesForPayload
      if (ratio) payload.aspect_ratio = ratio
      // 添加必需的 size 参数（默认 1080P）
      const sizeParam = overrides?.size || d.size || modelCfg.defaultParams?.size || '1080P'
      payload.size = sizeParam
      const supportsDuration = typeof modelCfg.supportsDuration === 'boolean' ? modelCfg.supportsDuration : true
      if (supportsDuration && duration) payload.duration = duration
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
      // 优先使用配置中的 size，否则根据 ratio 自动选择
      const sizeValue = overrides?.size || d.size || modelCfg.defaultParams?.size || (ratio === '9:16' ? '720x1280' : '1280x720')
      fd.append('size', sizeValue)
      const watermark = modelCfg.defaultParams?.watermark
      if (typeof watermark === 'boolean') fd.append('watermark', watermark ? 'true' : 'false')
      fd.append('input_reference', blob, 'input.png')

      requestType = 'formdata'
      payload = fd
    } else if (modelCfg.format === 'sora-openai') {
      // Sora OpenAI 官方格式（multipart/form-data 格式）
      // 参考文档: https://help.allapi.store/api-412862113
      // 端点: POST /v1/videos
      // 查询: GET /v1/videos/{id}
      // 注意：当有图片输入时，图片尺寸必须与 size 参数完全匹配
      const sizeValue = overrides?.size || d.size || modelCfg.defaultParams?.size || (ratio === '9:16' ? '720x1280' : '1280x720')
      const secondsValue = Number.isFinite(duration) && duration > 0 ? String(duration) : '4'
      
      const fd = new FormData()
      fd.append('model', modelCfg.key)
      fd.append('prompt', prompt || '')
      fd.append('size', sizeValue)
      fd.append('seconds', secondsValue)
      
      // 如果有图片，需要转换为 Blob 并调整尺寸以匹配 size 参数
      // Sora API 要求: "Inpaint image must match the requested width and height"
      const imageInput = firstFrame || refImages[0] || ''
      if (imageInput) {
        let blob = await resolveImageToBlob(imageInput)
        if (blob) {
          // 调整图片尺寸以匹配请求的 size 参数
          console.log('[generateVideo] Sora OpenAI: 调整图片尺寸以匹配 size:', sizeValue)
          blob = await resizeImageBlob(blob, sizeValue)
          fd.append('input_reference', blob, 'input.png')
        }
      }
      
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
        let image = firstFrame || refImages[0] || ''
        if (!image) throw new Error('Kling 图生视频需要首帧/参考图（请连接图片节点）')

        // Kling 图生视频：尽量使用公网 URL（避免 base64 过大/不可访问导致失败）
        if (image.startsWith('data:') || isBase64Like(image)) {
          console.log('[kling-video] 检测到 base64 首帧，自动上传到图床...')
          try {
            if (image.startsWith('data:')) {
              image = await compressImageBase64(image, 900 * 1024)
            }
            image = await uploadBase64ToImageHost(image)
          } catch (uploadErr: any) {
            throw new Error(`首帧图片上传失败：${uploadErr?.message || '未知错误'}`)
          }
        }
        if (image.startsWith('blob:')) {
          throw new Error('Kling 图生视频不支持 blob 图片，请使用上传/生成后的图片（可转成公网 URL）')
        }

        let tail = lastFrame || ''
        if (tail && (tail.startsWith('data:') || isBase64Like(tail))) {
          console.log('[kling-video] 检测到 base64 尾帧，自动上传到图床...')
          try {
            if (tail.startsWith('data:')) {
              tail = await compressImageBase64(tail, 900 * 1024)
            }
            tail = await uploadBase64ToImageHost(tail)
          } catch (uploadErr: any) {
            throw new Error(`尾帧图片上传失败：${uploadErr?.message || '未知错误'}`)
          }
        }
        if (tail.startsWith('blob:')) {
          throw new Error('Kling 图生视频不支持 blob 尾帧图片，请使用上传/生成后的图片（可转成公网 URL）')
        }

        endpointOverride = modelCfg.endpointImage || endpointOverride
        statusEndpointOverride = modelCfg.statusEndpointImage || statusEndpointOverride
        payload = {
          model_name: modelName,
          image,
          image_tail: tail,
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
      // Tencent AIGC Video 格式 (Vidu / Hailuo / Kling)
      // 官方文档：https://help.allapi.store/api-412862124
      const version = modelCfg.defaultParams?.version || ''
      const size = overrides?.size || d.size || modelCfg.defaultParams?.size || '720p'
      const dur = Number(duration) || Number(modelCfg.defaultParams?.duration) || 4
      
      // 解析 model_name 和 model_version
      // key 格式如：vidu-q2-turbo, hailuo-2.3-fast, kling-2.5
      let modelName = 'Vidu'
      let modelVersion = version
      
      const keyLower = modelCfg.key.toLowerCase()
      if (keyLower.startsWith('vidu')) {
        modelName = 'Vidu'
        // version 已从 defaultParams 获取
      } else if (keyLower.startsWith('hailuo')) {
        modelName = 'Hailuo'
      } else if (keyLower.startsWith('kling')) {
        modelName = 'Kling'
      }
      
      payload = {
        model_name: modelName,
        model_version: modelVersion,
        prompt: prompt || '',
        enhance_prompt: 'Enabled',
        output_config: {
          storage_mode: 'Temporary',
          resolution: size.toUpperCase(),  // 720P, 1080P
          duration: dur,  // int 类型
        }
      }
      
      // 添加宽高比
      if (ratio) {
        payload.output_config.aspect_ratio = ratio
      }
      
      // 添加首帧图片（如果有）
      if (firstFrame || refImages.length > 0) {
        let imageUrl = firstFrame || refImages[0]
        
        // 腾讯 AIGC API 只支持公网可访问的 HTTP(S) URL
        // 如果是 base64 或 blob，自动上传到图床获取公网 URL
        if (imageUrl.startsWith('data:') || isBase64Like(imageUrl)) {
          console.log('[tencent-video] 检测到 base64 图片，自动上传到图床...')
          try {
            if (imageUrl.startsWith('data:')) {
              imageUrl = await compressImageBase64(imageUrl, 900 * 1024)
            }
            imageUrl = await uploadBase64ToImageHost(imageUrl)
            console.log('[tencent-video] 图片已上传，公网 URL:', imageUrl)
          } catch (uploadErr: any) {
            console.error('[tencent-video] 图片上传失败:', uploadErr)
            throw new Error(`图片上传失败：${uploadErr?.message || '未知错误'}。请使用公网可访问的图片 URL`)
          }
        }
        if (imageUrl.startsWith('blob:')) {
          throw new Error('腾讯 AIGC 视频模型不支持 blob 图片，请使用公网可访问的图片 URL（https://...）')
        }
        if (/^https?:\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/i.test(imageUrl)) {
          throw new Error('腾讯 AIGC 视频模型不支持内网图片地址，请使用公网可访问的图片 URL')
        }
        if (!imageUrl.startsWith('http://') && !imageUrl.startsWith('https://')) {
          throw new Error('腾讯 AIGC 视频模型需要公网可访问的图片 URL（以 http:// 或 https:// 开头）')
        }
        
        payload.file_infos = [{
          type: 'Url',
          url: imageUrl
        }]
      }
      
      // 添加尾帧图片（如果有）
      if (lastFrame) {
        let lastFrameUrl = lastFrame
        // 如果是 base64，自动上传到图床
        if (lastFrameUrl.startsWith('data:') || isBase64Like(lastFrameUrl)) {
          console.log('[tencent-video] 检测到 base64 尾帧图片，自动上传到图床...')
          try {
            if (lastFrameUrl.startsWith('data:')) {
              lastFrameUrl = await compressImageBase64(lastFrameUrl, 900 * 1024)
            }
            lastFrameUrl = await uploadBase64ToImageHost(lastFrameUrl)
          } catch (uploadErr: any) {
            throw new Error(`尾帧图片上传失败：${uploadErr?.message || '未知错误'}`)
          }
        }
        if (lastFrameUrl.startsWith('blob:')) {
          throw new Error('腾讯 AIGC 视频模型不支持 blob 图片作为尾帧')
        }
        if (!lastFrameUrl.startsWith('http://') && !lastFrameUrl.startsWith('https://')) {
          throw new Error('腾讯 AIGC 视频模型的尾帧图片需要公网可访问的 URL')
        }
        payload.last_frame_url = lastFrameUrl
      }
      
      console.log('[tencent-video] 请求参数:', JSON.stringify(payload, null, 2))
    } else if (modelCfg.format === 'sora-video') {
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
      const size = overrides?.size || d.size || modelCfg.defaultParams?.size || '720p'
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

    // 打印详细的请求信息，包括 FormData 内容
    let payloadDebug: any = payload
    if (requestType === 'formdata' && payload instanceof FormData) {
      payloadDebug = {}
      payload.forEach((value, key) => {
        payloadDebug[key] = value instanceof Blob ? `[Blob: ${value.size} bytes]` : value
      })
    }
    console.log('[generateVideo] 发送 API 请求:', {
      endpoint: endpointOverride,
      requestType,
      authMode: modelCfg.authMode,
      format: modelCfg.format,
      modelKey: modelCfg.key,
      userSelectedDuration: duration,
      payload: payloadDebug
    })
    console.log('[generateVideo] 完整 payload:', JSON.stringify(payloadDebug, null, 2))
    
    // 带重试的 API 调用（处理网络抖动 / 上游过载）
    // Grok 在 Tauri 中更容易遇到“官方负载过大”，这里做更温和、更长的重试退避。
    const isGrokModel = /^grok-video-/i.test(String(modelCfg.key || ''))
    const maxRetries = (isTauriEnv && isGrokModel) ? 6 : 3
    let lastError: Error | null = null
    let task: any = null
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        errorStage = 'create'
        if (attempt > 0) {
          console.log(`[generateVideo] 第 ${attempt + 1} 次重试...`)
          // 递增延迟：Grok + Tauri 采用更长的指数退避
          const waitMs = (isTauriEnv && isGrokModel)
            ? Math.min(20000, 2500 * Math.pow(2, Math.max(0, attempt - 1))) // 2.5s, 5s, 10s, 20s...
            : (1000 * attempt)
          await new Promise(r => setTimeout(r, waitMs))
        }
        
        task = requestType === 'formdata'
          ? await postFormData<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
          : await postJson<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
        
        break // 成功则跳出重试循环
      } catch (err: any) {
        lastError = err
        const errMsg = String(err?.message || err || '')
        const isNetworkError = /Failed to fetch|NetworkError|ERR_/i.test(errMsg)
        const isOverloadError =
          isTauriEnv &&
          isGrokModel &&
          /负载过大|server busy|overload|Service Unavailable|HTTP 503|Too Many Requests|rate limit|temporarily unavailable|try again later/i.test(errMsg)
        
        // 非网络错误或已达最大重试次数，直接抛出
        if ((!isNetworkError && !isOverloadError) || attempt === maxRetries - 1) {
          throw err
        }
        
        console.warn(`[generateVideo] ${isOverloadError ? '上游过载' : '网络'}错误，准备重试:`, errMsg)
      }
    }
    
    if (!task) {
      throw lastError || new Error('视频 API 调用失败')
    }
    
    console.log('[generateVideo] API 响应:', JSON.stringify(task, null, 2))

    // 尝试从不同格式提取视频 URL
    let extractedVideoUrl = ''
    
    // Tencent AIGC Video 格式 (Vidu/Hailuo/Kling)
    if (modelCfg.format === 'tencent-video') {
      // 响应格式（PascalCase）:
      // { Response: { TaskId, RequestId } }
      // 或 snake_case: { task_id, request_id, output: { video_url } }
      const response = task?.Response || task?.response || task
      const output = response?.Output || response?.output || task?.output || task?.data?.output || task?.data || task
      
      // 支持 PascalCase 和 snake_case
      const taskId = response?.TaskId || response?.task_id || 
                     output?.TaskId || output?.task_id || output?.id ||
                     task?.TaskId || task?.task_id || task?.id ||
                     task?.RequestId || task?.request_id
      const videoUrl = output?.VideoUrl || output?.video_url || output?.result_url || 
                       response?.VideoUrl || response?.video_url ||
                       task?.VideoUrl || task?.video_url || task?.result_url
      const taskStatus = output?.TaskStatus || output?.task_status || output?.status ||
                         response?.TaskStatus || response?.task_status || task?.status
      
      console.log('[generateVideo] Tencent Video 解析:', { 
        taskId, 
        taskStatus, 
        videoUrl: videoUrl?.slice?.(0, 80),
        responseKeys: Object.keys(response || {}),
        outputKeys: Object.keys(output || {})
      })
      
      if (videoUrl && videoUrl.startsWith('http')) {
        extractedVideoUrl = videoUrl
      } else if (taskId) {
        // 需要轮询，将 task_id 存入 task 对象供后续使用
        task.id = taskId
        task.task_id = taskId
        console.log('[generateVideo] Tencent Video 需要轮询, taskId:', taskId)
      } else {
        // 没有 taskId 也没有 videoUrl，打印完整响应以便调试
        console.error('[generateVideo] Tencent Video 无法解析响应:', JSON.stringify(task, null, 2))
      }
    }
    
    // Sora 2 Videos API 格式
    if (modelCfg.format === 'sora-video') {
      // 标准响应格式: { id, status, video_url } 或 { data: [{ url }] }
      extractedVideoUrl = task?.video_url || task?.url || task?.data?.[0]?.url || task?.data?.video_url || ''
      console.log('[generateVideo] Sora Video 解析:', { extractedVideoUrl, taskKeys: Object.keys(task || {}) })
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
      try {
        const polled = await pollVideoTask(String(id), { ...modelCfg, statusEndpoint: statusEndpointOverride }, configNodeId, videoNodeId)
        videoUrl = normalizeMediaUrl(polled)
      } catch (pollErr: any) {
        const msg = String(pollErr?.message || pollErr || '')
        const isTencent = modelCfg.format === 'tencent-video'
        const looksLikeImageUrlNotReachable =
          /ImageURL.*external network/i.test(msg) ||
          /InvalidParameterValue/i.test(msg) ||
          /\bErrCode\b.*70000/i.test(msg) ||
          /retrieved from the external network/i.test(msg)

        // Tencent AIGC：若提示 ImageURL 外网不可达，尝试重新上传到云雾图床并重试一次
        if (isTencent && looksLikeImageUrlNotReachable) {
          console.warn('[generateVideo] Tencent Video ImageURL 外网不可达，尝试重新上传到云雾图床并重试一次...')
          const firstInput = String(firstFrame || refImages[0] || '').trim()
          if (!firstInput) throw pollErr

          const ensureUploadable = async (input: string) => {
            const v = String(input || '').trim()
            if (!v) return ''
            if (v.startsWith('data:')) return await compressImageBase64(v, 900 * 1024)
            if (isBase64Like(v)) return v
            // 兜底：若是 http(s)，在 Tauri 环境尝试下载再转成 dataURL 以便重传
            if (isHttpUrl(v) && isTauriEnv) {
              const b = await resolveImageToBlob(v)
              if (!b) return ''
              const dataUrl = await new Promise<string>((resolve) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result || ''))
                reader.onerror = () => resolve('')
                reader.readAsDataURL(b)
              })
              if (dataUrl) return await compressImageBase64(dataUrl, 900 * 1024)
            }
            return ''
          }

          const firstUploadable = await ensureUploadable(firstInput)
          if (!firstUploadable) {
            throw new Error(
              `视频生成失败：上游提示首帧 ImageURL 无法外网访问，且当前首帧无法自动重传（可能是跨域/无本地数据）。请改用“上传/本地图片（dataURL）”作为首帧，或更换可被外网访问的图床域名。原始错误：${msg}`
            )
          }

          const retryFirstUrl = await uploadBase64ToImageHost(firstUploadable)

          let retryLastUrl = ''
          if (lastFrame) {
            const lastUploadable = await ensureUploadable(lastFrame)
            if (lastUploadable) {
              retryLastUrl = await uploadBase64ToImageHost(lastUploadable)
            }
          }

          const retryPayload: any = { ...(payload as any) }
          const existingFileInfos = Array.isArray(retryPayload.file_infos) ? retryPayload.file_infos : []
          if (existingFileInfos.length > 0) {
            retryPayload.file_infos = [...existingFileInfos]
            retryPayload.file_infos[0] = { ...(retryPayload.file_infos[0] || {}), type: 'Url', url: retryFirstUrl }
          } else {
            retryPayload.file_infos = [{ type: 'Url', url: retryFirstUrl }]
          }
          if (retryLastUrl) retryPayload.last_frame_url = retryLastUrl

          console.log('[generateVideo] Tencent Video 重试 create payload（仅展示关键字段）:', {
            file_infos_0: retryPayload?.file_infos?.[0],
            last_frame_url: retryPayload?.last_frame_url,
          })

          // 重新创建任务
          const retryTask: any = await postJson<any>(endpointOverride, retryPayload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
          const retryTaskId =
            retryTask?.Response?.TaskId ||
            retryTask?.TaskId ||
            retryTask?.task_id ||
            retryTask?.taskId ||
            retryTask?.data?.task_id ||
            retryTask?.data?.taskId
          const retryId =
            retryTask?.id ||
            retryTaskId ||
            retryTask?.task_id ||
            retryTask?.taskId ||
            retryTask?.data?.id ||
            retryTask?.data?.task_id ||
            retryTask?.data?.taskId
          if (!retryId) throw new Error('重试创建任务失败：未获取到任务 ID')

          const polled2 = await pollVideoTask(String(retryId), { ...modelCfg, statusEndpoint: statusEndpointOverride }, configNodeId, videoNodeId)
          videoUrl = normalizeMediaUrl(polled2)
        } else {
          throw pollErr
        }
      }
    }

    if (!videoUrl) {
      const hint = typeof directRaw === 'string' && String(directRaw).trim()
        ? `模型返回文本：${String(directRaw).trim().slice(0, 160)}`
        : ''
      throw new Error(`视频返回为空。${hint}`)
    }
    
    console.log('[generateVideo] 获取到视频 URL:', videoUrl?.slice(0, 100))

    // 4. 成功：更新视频节点
    const perfMode = useSettingsStore.getState().performanceMode || 'off'
    const preferFastWriteback = isTauriEnv && perfMode === 'ultra'

    // Tauri 极速模式：先回写远程 URL（结束 loading），缓存/下载在后台进行
    if (preferFastWriteback && isHttpUrl(videoUrl)) {
      const latestStore = useGraphStore.getState()
      try {
        latestStore.updateNode(videoNodeId, {
          data: {
            url: videoUrl,
            sourceUrl: videoUrl,
            loading: false,
            error: '',
            label: '视频',
            model: modelKey,
            updatedAt: Date.now()
          }
        } as any)
      } catch {
        // ignore
      }

      void (async () => {
        try {
          const cached = await resolveCachedMediaUrl(videoUrl) as { displayUrl: string; localPath: string; error?: string }
          const storeNow = useGraphStore.getState()
          const stillExists = storeNow.nodes.some((n) => n.id === videoNodeId)
          if (!stillExists) return
          const nextUrl = String(cached.displayUrl || '').trim()
          if (nextUrl && nextUrl !== videoUrl) {
            storeNow.updateNode(videoNodeId, {
              data: { url: nextUrl, localPath: cached.localPath, sourceUrl: videoUrl, loading: false, error: '', updatedAt: Date.now() }
            } as any)
          }
        } catch {
          // ignore
        }
      })()

      if (selectOutput) latestStore.setSelected(videoNodeId)
      if (markConfigExecuted) latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: videoNodeId } } as any)
      errorStage = 'finalize'
      return
    }

    const cached = await resolveCachedMediaUrl(videoUrl) as { displayUrl: string; localPath: string; error?: string }
    const latestStore = useGraphStore.getState()
    const displayUrl = cached.displayUrl
    
    console.log('[generateVideo] 缓存解析结果:', {
      videoUrl: videoUrl?.slice(0, 80),
      displayUrl: displayUrl?.slice(0, 80),
      localPath: cached.localPath?.slice(0, 50),
      error: cached.error,
      videoNodeId
    })
    
    // 如果下载失败，抛出错误
    if (!displayUrl && cached.error) {
      throw new Error(`视频下载失败: ${cached.error}`)
    }
    if (!displayUrl) {
      throw new Error('视频下载失败：无法获取视频内容')
    }
    
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

    if (selectOutput) {
      latestStore.setSelected(videoNodeId)
    }
    if (markConfigExecuted) {
      latestStore.updateNode(configNodeId, { data: { executed: true, outputNodeId: videoNodeId } } as any)
    }
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
  } finally {
    // 清理任务注册
    const task = runningTasks.get(configNodeId)
    if (task) {
      task.activeCount = (task.activeCount || 1) - 1
      if (task.activeCount <= 0) {
        runningTasks.delete(configNodeId)
        console.log('[generateVideo] 任务已清理:', configNodeId)
      } else {
        console.log('[generateVideo] 并发任务仍在运行，暂不清理:', { configNodeId, activeCount: task.activeCount })
      }
    }
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
