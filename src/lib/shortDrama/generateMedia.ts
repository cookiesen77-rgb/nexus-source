import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import * as modelsConfig from '@/config/models'
import { resolveCachedImageUrl, resolveCachedMediaUrl } from '@/lib/workflow/cache'
import { getJson, postFormData, postJson } from '@/lib/workflow/request'

const normalizeText = (text: unknown) => String(text || '').replace(/\r\n/g, '\n').trim()
const toDataUrl = (b64: string, mime = 'image/png') => `data:${mime};base64,${b64}`
const isHttpUrl = (v: string) => /^https?:\/\//i.test(v)
const isDataUrl = (v: string) => /^data:image\/[a-z0-9.+-]+;base64,/i.test(String(v || '').trim())
const isBase64Like = (v: string) => /^[A-Za-z0-9+/=]+$/.test(String(v || '').trim())

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

const compressImageBase64 = async (base64Data: string, maxSizeBytes: number = 900 * 1024): Promise<string> => {
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
      let result = base64Data

      // 如果图片本身就很小，直接返回
      const comma = base64Data.indexOf(',')
      const currentSize = comma >= 0 ? Math.ceil((base64Data.length - (comma + 1)) * 0.75) : Math.ceil(base64Data.length * 0.75)
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
        const c = result.indexOf(',')
        const size = c >= 0 ? Math.ceil((result.length - (c + 1)) * 0.75) : Math.ceil(result.length * 0.75)
        if (size <= maxSizeBytes) {
          resolve(result)
          return
        }
      }

      // 如果还是太大，进一步缩小尺寸
      width = Math.floor(width * 0.7)
      height = Math.floor(height * 0.7)
      canvas.width = width
      canvas.height = height
      ctx.drawImage(img, 0, 0, width, height)
      result = canvas.toDataURL('image/jpeg', 0.6)
      resolve(result)
    }
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = base64Data
  })
}

const uploadImageToYunwu = async (dataUrlOrBase64: string): Promise<string> => {
  // ⚠️ 仅允许使用云雾官方图床：
  // - 文档：https://yunwu.apifox.cn/doc-7376047
  // - API：https://yunwu.apifox.cn/api-356192326
  const apiKey = getApiKey()
  if (!apiKey) throw new Error('缺少 API Key，无法上传到云雾图床。请先在设置中填写 apiKey。')

  let dataUrl = String(dataUrlOrBase64 || '').trim()
  if (!dataUrl) throw new Error('空图片数据')
  if (isBase64Like(dataUrl) && !dataUrl.startsWith('data:')) {
    dataUrl = `data:image/png;base64,${dataUrl}`
  }
  if (!dataUrl.startsWith('data:')) {
    throw new Error('云雾图床上传仅支持 dataURL/base64 输入')
  }

  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (!m) throw new Error('图片 dataURL 解析失败')
  const mimeType = String(m[1] || 'image/png')
  const base64Content = String(m[2] || '')
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

  const resp = await postFormData<any>('https://imageproxy.zhongzhuan.chat/api/upload', form, { authMode: 'bearer', timeoutMs: 120000 })
  const urlOut = String(resp?.url || resp?.data?.url || resp?.data?.link || '').trim()
  if (urlOut && /^https?:\/\//i.test(urlOut)) return urlOut
  throw new Error(String(resp?.error || resp?.message || resp?.data?.message || '云雾图床上传失败'))
}

const pickFirstHttpUrlFromText = (text: string) => {
  const t = String(text || '').trim()
  if (!t) return ''
  const m = t.match(/https?:\/\/\S+/i)
  if (!m) return ''
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
    if (!obj || depth > 6) return
    if (typeof obj === 'string') return push(obj)
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1)
      return
    }
    if (typeof obj !== 'object') return
    for (const k of ['url', 'image_url', 'imageUrl', 'output_url', 'result_url', 'video_url', 'videoUrl']) {
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

// ======== gemini-image helpers ========

// 检测是否在 Tauri 环境中（用于 fetch 参考图；主请求走 postJson 已经 Tauri-safe）
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

const safeFetch: typeof fetch = async (...args: any[]) => {
  if (!isTauri) return (globalThis.fetch as any)(...args)
  const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
  return (tauriFetch as any)(...args)
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
    const res = await safeFetch(v, { method: 'GET' })
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

// Gemini 生图容易返回纯文本，这里统一包裹成“只输出图片”
const buildGeminiImagePrompt = (raw: string) => {
  const t = normalizeText(raw)
  if (!t) return ''
  return `请直接生成图片，不要输出任何解释文字。画面描述：\n${t}`
}

// ======== Public APIs ========

export type ShortDramaImageRequest = {
  modelKey?: string
  prompt: string
  size?: string
  quality?: string
  refImages?: string[]
}

export type ShortDramaImageResult = {
  imageUrl: string
  displayUrl: string
  localPath: string
}

export async function generateShortDramaImage(req: ShortDramaImageRequest): Promise<ShortDramaImageResult> {
  const prompt = normalizeText(req?.prompt)
  const desiredKey = String(req?.modelKey || DEFAULT_IMAGE_MODEL)
  const modelCfg: any = (IMAGE_MODELS as any[]).find((m) => m?.key === desiredKey) || (IMAGE_MODELS as any[])[0]
  if (!modelCfg) throw new Error('未找到图片模型配置')

  const size = String(req?.size || modelCfg?.defaultParams?.size || '').trim()
  const quality = String(req?.quality || modelCfg?.defaultParams?.quality || '').trim()
  const refImages = Array.isArray(req?.refImages) ? req!.refImages!.map((x) => String(x || '').trim()).filter(Boolean) : []

  // gemini 特殊：最多 14 张参考图
  const limitedRefImages = refImages.slice(0, modelCfg?.key === 'gemini-3-pro-image-preview' ? 14 : Math.max(0, refImages.length))

  if (!prompt && limitedRefImages.length === 0) {
    throw new Error('请提供提示词或参考图')
  }

  let imageUrl = ''
  let textFallback = ''

  if (modelCfg.format === 'gemini-image') {
    const requestParts: any[] = []
    if (prompt) requestParts.push({ text: buildGeminiImagePrompt(prompt) })

    for (let i = 0; i < limitedRefImages.length; i++) {
      const inline = await resolveImageToInlineData(limitedRefImages[i])
      if (!inline) continue
      if (limitedRefImages.length > 1) requestParts.push({ text: `[参考图${i + 1}]` })
      requestParts.push({
        inline_data: {
          mime_type: inline.mimeType,
          data: inline.data,
        },
      })
    }

    if (requestParts.length === 0) throw new Error('参考图解析失败，请尝试重新上传')

    const payload = {
      contents: [{ role: 'user', parts: requestParts }],
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: {
          aspectRatio: size || '1:1',
          imageSize: quality || '2K',
        },
      },
    }

    // 轻量重试：偶发 200 但无图片
    for (let attempt = 0; attempt < 2; attempt++) {
      const rsp = await postJson<any>(modelCfg.endpoint, payload, {
        authMode: modelCfg.authMode,
        timeoutMs: modelCfg.timeout || 240000,
      })
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
      if (attempt < 1) await new Promise((r) => setTimeout(r, 500))
    }
  } else if (modelCfg.format === 'openai-image') {
    const payload: any = {
      model: modelCfg.key,
      prompt,
      size: size || modelCfg.defaultParams?.size || '1024x1024',
      n: 1,
    }
    if (quality) payload.quality = quality
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    imageUrl = normalizeToImageUrl(rsp)
  } else if (modelCfg.format === 'openai-chat-image') {
    const payload = { model: modelCfg.key, messages: [{ role: 'user', content: prompt }] }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    const maybe = rsp?.choices?.[0]?.message?.content
    if (typeof maybe === 'string') imageUrl = pickFirstHttpUrlFromText(maybe)
    if (!imageUrl) imageUrl = normalizeToImageUrl(rsp)
  } else if (modelCfg.format === 'openai-image-edit') {
    const imageInput = limitedRefImages[0] || ''
    if (!imageInput) throw new Error('该图片模型需要参考图')
    const payload: any = { model: modelCfg.key, prompt, image: imageInput }
    const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    imageUrl = normalizeToImageUrl(rsp) || extractUrlsDeep(rsp)[0] || ''
  } else if (modelCfg.format === 'kling-image') {
    const requestData: any = {
      model_name: modelCfg.defaultParams?.model_name || 'kling-v2-1',
      prompt,
      n: 1,
      aspect_ratio: size || modelCfg.defaultParams?.size || '1:1',
      resolution: quality || modelCfg.defaultParams?.quality || '1k',
    }
    const imageInput = limitedRefImages[0]
    if (imageInput) requestData.image = imageInput
    const resp = await postJson<any>(modelCfg.endpoint, requestData, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    imageUrl = normalizeToImageUrl(resp) || extractUrlsDeep(resp)[0] || ''

    if (!imageUrl) {
      const taskId = resp?.data?.task_id || resp?.data?.id || resp?.task_id || resp?.id || ''
      if (!taskId) throw new Error('Kling 生图返回异常：未获取到图片或任务 ID')
      const statusUrl = `${String(modelCfg.endpoint).replace(/\/$/, '')}/${encodeURIComponent(String(taskId))}`
      for (let i = 0; i < 120; i++) {
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
      clarity: modelCfg.defaultParams?.clarity,
    }
    const resp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
    const list = resp?.data ?? resp
    const first = Array.isArray(list) ? list[0] : list
    imageUrl = String(first?.url || first?.image_url || first || '').trim()
  } else {
    throw new Error(`工作台暂不支持该图片模型格式：${String(modelCfg.format || '')}`)
  }

  if (!imageUrl) {
    const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
    throw new Error(`生图返回为空。${hint}`)
  }
  if (!imageUrl.startsWith('data:') && !isHttpUrl(imageUrl)) {
    const hint = textFallback ? `模型返回文本：${String(textFallback).slice(0, 160)}` : ''
    throw new Error(`生图返回不是图片数据/URL。${hint}`)
  }

  const cached = await resolveCachedImageUrl(imageUrl)
  if (!cached.displayUrl) {
    throw new Error(cached.error || '图片缓存失败')
  }
  return { imageUrl, displayUrl: cached.displayUrl, localPath: cached.localPath || '' }
}

export type ShortDramaVideoRequest = {
  modelKey?: string
  prompt: string
  ratio?: string
  duration?: number
  size?: string
  images?: string[] // 参考图/首帧（允许 data: 或 http）
  lastFrame?: string
}

export type ShortDramaVideoResult = {
  taskId: string
  videoUrl: string
  displayUrl: string
  localPath: string
}

const extractVideoUrlDeep = (payload: any) => {
  const urls = extractUrlsDeep(payload)
  const v = urls.find((u) => /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(u)) || urls[0] || ''
  return v
}

const pollVideoTask = async (id: string, modelCfg: any, statusEndpointOverride: any) => {
  const maxAttempts = 300
  const interval = 3000

  for (let i = 0; i < maxAttempts; i++) {
    const statusEndpoint = statusEndpointOverride
    if (!statusEndpoint) throw new Error('未配置视频查询端点')

    let resp: any
    if (typeof statusEndpoint === 'function') {
      resp = await getJson<any>(statusEndpoint(id), undefined, { authMode: modelCfg.authMode })
    } else {
      resp = await getJson<any>(statusEndpoint, { id }, { authMode: modelCfg.authMode })
    }

    const response = resp?.Response || resp?.response || resp
    const aigcTask = response?.AigcVideoTask || response?.AigcImageTask || response?.aigc_video_task || response?.aigc_image_task
    const aigcOutput = aigcTask?.Output || aigcTask?.output
    const output = aigcOutput || response?.Output || response?.output || resp?.output || resp?.data?.output || resp?.data || resp

    const status = String(
      response?.Status ||
        response?.status ||
        response?.state ||
        aigcTask?.Status ||
        aigcTask?.status ||
        output?.TaskStatus ||
        output?.task_status ||
        output?.status ||
        output?.state ||
        resp?.status ||
        resp?.state ||
        resp?.data?.status ||
        resp?.data?.state ||
        ''
    ).toLowerCase()

    const fileInfos = aigcOutput?.FileInfos || aigcOutput?.file_infos || output?.FileInfos || output?.file_infos || []
    const videoUrlFromFileInfos = Array.isArray(fileInfos)
      ? String(
          fileInfos.find((fi: any) => {
            const fileType = String(fi?.FileType || fi?.file_type || '').toLowerCase()
            const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url || ''
            if (!fileUrl) return false
            if (fileType === 'video' || fileType.includes('video')) return true
            return /\.(mp4|webm|mov|m4v|m3u8|avi|mkv)(\?|$)/i.test(String(fileUrl))
          })?.FileUrl ||
            fileInfos.find((fi: any) => {
              const fileUrl = fi?.FileUrl || fi?.file_url || fi?.Url || fi?.url || ''
              if (!fileUrl) return false
              // 兜底：选第一个非图片
              return !/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i.test(String(fileUrl))
            })?.FileUrl ||
            ''
        )
      : ''

    const outputVideo = output?.video || resp?.output?.video || resp?.data?.output?.video
    const downloads = resp?.downloads || resp?.data?.downloads || output?.downloads
    const downloadUrl = Array.isArray(downloads) && downloads.length > 0 ? (downloads[0]?.url || downloads[0]?.video_url || downloads[0]) : null
    const videoUrl =
      videoUrlFromFileInfos ||
      outputVideo ||
      downloadUrl ||
      aigcOutput?.VideoUrl ||
      aigcOutput?.video_url ||
      output?.VideoUrl ||
      output?.video_url ||
      output?.ResultUrl ||
      output?.result_url ||
      response?.VideoUrl ||
      response?.video_url ||
      resp?.VideoUrl ||
      resp?.video_url ||
      resp?.result_url ||
      resp?.data?.video_url

    if (typeof videoUrl === 'string' && videoUrl.startsWith('http')) return videoUrl
    const deep = extractVideoUrlDeep(resp)
    if (deep && deep.startsWith('http')) return deep

    const isCompleted = /^(finish|finished|completed|complete|success|done|ready|succeeded)$/i.test(status)
    if (isCompleted && !videoUrl) {
      const errCode = aigcTask?.ErrCode || aigcTask?.err_code || aigcTask?.error_code
      const errMsg = aigcTask?.Message || aigcTask?.message || aigcTask?.error_message || aigcTask?.error
      if (errCode || errMsg) {
        throw new Error(String(errMsg || errCode || '视频生成失败'))
      }
    }
    if (/^(failed|fail|error)$/i.test(status)) {
      const rawErr = resp?.error?.message || resp?.message || resp?.data?.error?.message || '视频生成失败'
      throw new Error(String(rawErr))
    }

    await new Promise((r) => setTimeout(r, interval))
  }
  throw new Error('视频生成超时')
}

export async function generateShortDramaVideo(req: ShortDramaVideoRequest): Promise<ShortDramaVideoResult> {
  const prompt = normalizeText(req?.prompt)
  const desiredKey = String(req?.modelKey || DEFAULT_VIDEO_MODEL)
  const resolved: any = (modelsConfig as any)?.getModelByName?.(desiredKey) || null
  const modelCfg: any =
    (resolved && String(resolved?.format || '').includes('video') ? resolved : null) ||
    (VIDEO_MODELS as any[]).find((m) => m?.key === desiredKey) ||
    (VIDEO_MODELS as any[])[0]
  if (!modelCfg) throw new Error('未找到视频模型配置')

  const ratio = String(req?.ratio || modelCfg?.defaultParams?.ratio || '').trim()
  const duration = Number.isFinite(req?.duration) && Number(req?.duration) > 0 ? Number(req?.duration) : Number(modelCfg?.defaultParams?.duration || 0)
  const size = String(req?.size || modelCfg?.defaultParams?.size || '').trim()
  const images = Array.isArray(req?.images) ? req!.images!.map((x) => String(x || '').trim()).filter(Boolean) : []
  const lastFrame = String(req?.lastFrame || '').trim()

  if (!prompt && images.length === 0) {
    throw new Error('请提供视频提示词或参考图')
  }

  let payload: any = null
  let endpointOverride: string = modelCfg.endpoint
  let statusEndpointOverride: any = modelCfg.statusEndpoint

  if (modelCfg.format === 'veo-unified') {
    payload = { model: modelCfg.key, prompt }
    if (images.length > 0) payload.images = images.slice(0, Number(modelCfg.maxImages || 3))
    if (ratio === '16:9' || ratio === '9:16') payload.aspect_ratio = ratio
    payload.duration = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 8)
    const ep = modelCfg.defaultParams?.enhancePrompt
    if (typeof ep === 'boolean') payload.enhance_prompt = ep
    const up = modelCfg.defaultParams?.enableUpsample
    if (typeof up === 'boolean') payload.enable_upsample = up
  } else if (modelCfg.format === 'sora-unified') {
    const orientation = ratio === '9:16' ? 'portrait' : 'landscape'
    const dur = Number.isFinite(duration) && duration > 0 ? duration : Number(modelCfg.defaultParams?.duration || 15)
    payload = {
      model: modelCfg.key,
      prompt,
      orientation,
      size: size || modelCfg.defaultParams?.size || 'large',
      duration: dur,
    }
    if (images.length > 0) payload.images = images.slice(0, Number(modelCfg.maxImages || 2))
    const watermark = modelCfg.defaultParams?.watermark
    if (typeof watermark === 'boolean') payload.watermark = watermark
    const priv = modelCfg.defaultParams?.private
    if (typeof priv === 'boolean') payload.private = priv
  } else if (modelCfg.format === 'unified-video') {
    const requiresImages = typeof modelCfg.requiresImages === 'boolean' ? modelCfg.requiresImages : false
    const imagesMustBeHttp = typeof modelCfg.imagesMustBeHttp === 'boolean' ? modelCfg.imagesMustBeHttp : false
    const maxImages = Number(modelCfg.maxImages || 3)

    let imagesForPayload: string[] = images
    if (imagesMustBeHttp) {
      const cache = new Map<string, string>()
      const out: string[] = []
      for (const raw of images) {
        if (out.length >= maxImages) break
        const v0 = String(raw || '').trim()
        if (!v0) continue
        if (v0.startsWith('blob:')) {
          throw new Error('该视频模型不支持 blob 图片，请使用上传/生成后的图片（可转为公网 URL）')
        }
        if (isHttpUrl(v0)) {
          out.push(v0)
          continue
        }
        const cached = cache.get(v0)
        if (cached) {
          // 保留顺序与重复（首/尾同图时仍传两张）
          out.push(cached)
          continue
        }
        if (isDataUrl(v0)) {
          const compressed = await compressImageBase64(v0, 900 * 1024)
          const uploaded = await uploadImageToYunwu(compressed)
          cache.set(v0, uploaded)
          out.push(uploaded)
          continue
        }
        if (isBase64Like(v0)) {
          const dataUrl = `data:image/png;base64,${v0}`
          const compressed = await compressImageBase64(dataUrl, 900 * 1024)
          const uploaded = await uploadImageToYunwu(compressed)
          cache.set(v0, uploaded)
          out.push(uploaded)
          continue
        }
        throw new Error('该视频模型需要公网可访问的图片 URL（http/https）或 dataURL 图片作为垫图。')
      }
      imagesForPayload = out
    }

    if (imagesMustBeHttp && images.length > 0 && imagesForPayload.length === 0) {
      throw new Error('该视频模型需要垫图，但未找到可用的图片（请提供首帧/尾帧/参考图）。')
    }
    if (requiresImages && imagesForPayload.length === 0) {
      throw new Error('该视频模型需要垫图（请提供至少 1 张参考图/首帧）')
    }
    payload = {
      model: modelCfg.key,
      prompt,
      aspect_ratio: ratio || modelCfg.defaultParams?.ratio || '1:1',
      size: size || modelCfg.defaultParams?.size || '720P',
    }
    if (imagesForPayload.length > 0) payload.images = imagesForPayload.slice(0, maxImages)
    const supportsDuration = typeof modelCfg.supportsDuration === 'boolean' ? modelCfg.supportsDuration : true
    if (supportsDuration && Number.isFinite(duration) && duration > 0) {
      payload.duration = duration
    }
  } else if (modelCfg.format === 'kling-video') {
    const hasAnyImage = Boolean(images.length > 0 || lastFrame)
    const modelName = modelCfg.defaultParams?.model_name || 'kling-v2-6'
    const mode = modelCfg.defaultParams?.mode || 'pro'
    const sound = modelCfg.defaultParams?.sound || 'off'
    const durValue = Number.isFinite(duration) && duration > 0 ? String(duration) : String(modelCfg.defaultParams?.duration || 10)

    if (hasAnyImage) {
      const first = images[0] || ''
      if (!first) throw new Error('Kling 图生视频需要首帧/参考图')
      endpointOverride = modelCfg.endpointImage || endpointOverride
      statusEndpointOverride = modelCfg.statusEndpointImage || statusEndpointOverride
      payload = {
        model_name: modelName,
        image: first,
        image_tail: lastFrame || '',
        mode,
        duration: durValue,
        sound,
      }
      if (prompt) payload.prompt = prompt
    } else {
      payload = { model_name: modelName, prompt, mode, duration: durValue, sound }
      if (ratio) payload.aspect_ratio = ratio
    }
  } else {
    throw new Error(`工作台暂不支持该视频模型格式：${String(modelCfg.format || '')}`)
  }

  // Grok 在 Tauri 中更容易遇到“官方负载过大”，这里做更温和、更长的重试退避
  const isGrokModel = /^grok-video-/i.test(String(modelCfg.key || ''))
  const maxCreateAttempts = (isTauri && isGrokModel) ? 6 : 1
  let task: any = null
  let lastCreateErr: any = null
  for (let attempt = 0; attempt < maxCreateAttempts; attempt++) {
    try {
      if (attempt > 0) {
        const waitMs = Math.min(20000, 2500 * Math.pow(2, Math.max(0, attempt - 1)))
        console.warn(`[shortDramaVideo] Grok 上游过载/抖动，准备第 ${attempt + 1} 次重试...`, { waitMs })
        await new Promise((r) => setTimeout(r, waitMs))
      }
      task = await postJson<any>(endpointOverride, payload, { authMode: modelCfg.authMode, timeoutMs: 240000 })
      break
    } catch (e: any) {
      lastCreateErr = e
      const msg = String(e?.message || e || '')
      const isOverload =
        /负载过大|server busy|overload|Service Unavailable|HTTP 503|Too Many Requests|rate limit|temporarily unavailable|try again later/i.test(msg)
      if (!(isTauri && isGrokModel && isOverload) || attempt === maxCreateAttempts - 1) {
        throw e
      }
    }
  }
  if (!task) throw lastCreateErr || new Error('视频创建失败')

  const id =
    task?.id ||
    task?.task_id ||
    task?.taskId ||
    task?.data?.id ||
    task?.data?.task_id ||
    task?.data?.taskId ||
    task?.Response?.TaskId ||
    task?.response?.task_id
  if (!id) throw new Error('视频返回异常：未获取到任务 ID')

  const polled = await pollVideoTask(String(id), modelCfg, statusEndpointOverride)
  const cached = await resolveCachedMediaUrl(String(polled || '').trim())
  if (!cached.displayUrl) throw new Error(cached.error || '视频缓存失败')

  return {
    taskId: String(id),
    videoUrl: String(polled || '').trim(),
    displayUrl: cached.displayUrl,
    localPath: cached.localPath || '',
  }
}

