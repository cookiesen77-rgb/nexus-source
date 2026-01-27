import { DEFAULT_API_BASE_URL } from '@/utils/constants'
import { fetch as tauriFetch } from '@tauri-apps/plugin-http'

export type AuthMode = 'bearer' | 'query' | undefined

// 检测是否在 Tauri 环境中
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

// 根据环境选择 fetch 实现
const safeFetch = isTauri ? tauriFetch : globalThis.fetch

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const isRetryableStatus = (status: number) => status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504

const isHtmlLike = (text: string) => {
  const s = String(text || '').trim().toLowerCase()
  if (!s) return false
  return s.startsWith('<!doctype') || s.startsWith('<html') || s.includes('<html') || s.includes('<head') || s.includes('<body') || s.includes('<title')
}

const extractHtmlTitle = (text: string) => {
  const m = String(text || '').match(/<title[^>]*>([^<]+)<\/title>/i)
  return m ? String(m[1] || '').trim() : ''
}

const stripHtml = (text: string) => {
  const raw = String(text || '')
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const summarizeErrorBody = (res: Response, text: string) => {
  const status = Number(res.status) || 0
  const statusText = String((res as any)?.statusText || '').trim()
  const base = `HTTP ${status}${statusText ? ` ${statusText}` : ''}`.trim()

  const raw = String(text || '')
  if (!raw) return base

  // HTML（如 nginx 502）避免把整页塞到 UI / store
  if (isHtmlLike(raw)) {
    const title = extractHtmlTitle(raw)
    const titleClean = title.replace(/\s+/g, ' ').trim()
    if (titleClean) {
      const withoutLeadingStatus = titleClean.replace(/^(\d{3})\s+/, '').trim()
      return `HTTP ${status} ${withoutLeadingStatus || titleClean}`.trim()
    }
    return base
  }

  // 非 HTML：限制长度，避免巨大错误文本污染画布
  const plain = stripHtml(raw)
  if (!plain) return base
  if (plain.length > 360) return `${plain.slice(0, 360)}…`
  return plain
}

const isRetryableError = (err: any) => {
  const msg = String(err?.message || err || '')
  // 代理/TLS/网络抖动（尤其是 Vite proxy 与上游 TLS 握手偶发失败）
  // 以及：偶发的响应体截断会导致 JSON 解析失败（应视为可重试）
  return /Failed to fetch|NetworkError|socket|TLS|ECONNRESET|EPIPE|ETIMEDOUT|Unexpected end of JSON|Unexpected token|JSON/i.test(msg)
}

const backoffMs = (attempt: number) => {
  const base = 600 * Math.pow(2, Math.max(0, attempt))
  const jitter = Math.floor(Math.random() * 300)
  return Math.min(8000, base + jitter)
}

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

const isAbsolute = (url: string) => /^https?:\/\//i.test(url)

// 检测是否在开发环境（Vite dev server）
const isDev = typeof import.meta !== 'undefined' && import.meta.env?.DEV === true

// 在开发环境的浏览器中使用 Vite 代理（非 Tauri），其他情况使用直接请求
const useViteProxy = isDev && !isTauri

export const resolveEndpointUrl = (endpoint: string) => {
  const ep = String(endpoint || '').trim()
  if (!ep) return DEFAULT_API_BASE_URL
  
  // 如果已经是绝对 URL
  if (isAbsolute(ep)) {
    // 在开发环境（非 Tauri）下，将 nexusapi.cn 的请求转换为相对路径，走 Vite 代理绕过 CORS
    if (useViteProxy && ep.includes('nexusapi.cn')) {
      try {
        const u = new URL(ep)
        // 返回相对路径，让 Vite 代理处理
        return u.pathname + u.search
      } catch {
        return ep
      }
    }
    return ep
  }
  
  // 相对路径处理
  if (useViteProxy) {
    // 开发环境（非 Tauri）：返回相对路径，走 Vite 代理
    return `/v1${ep.startsWith('/') ? ep : `/${ep}`}`
  }
  
  // 生产环境或 Tauri 环境：拼接完整 URL
  const base = DEFAULT_API_BASE_URL.replace(/\/$/, '')
  return `${base}${ep.startsWith('/') ? ep : `/${ep}`}`
}

export const postJson = async <T,>(endpoint: string, body: any, opts?: { authMode?: AuthMode; timeoutMs?: number }) => {
  const url0 = resolveEndpointUrl(endpoint)
  const authMode = opts?.authMode
  const apiKey = getApiKey()
  // query 模式（Gemini v1beta）支持 x-goog-api-key header；避免把 key 放在 URL 里（更安全，也减少代理日志泄露风险）
  const url = url0

  // 详细日志：确认实际请求 URL
  console.log('[postJson] 请求详情:', {
    inputEndpoint: endpoint,
    resolvedUrl: url0,
    finalUrl: url,
    authMode,
    hasApiKey: !!apiKey,
    bodyKeys: Object.keys(body || {})
  })

  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutMs = Number(opts?.timeoutMs || 0)
    const t = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : null

    try {
      const res = await safeFetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authMode === 'query' && apiKey ? { 'x-goog-api-key': apiKey } : {}),
          ...(authMode !== 'query' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify(body || {}),
        signal: controller.signal
      })

      if (res.ok) {
        try {
          return (await res.json()) as T
        } catch (e: any) {
          // 不要吞掉解析失败，否则上层会误判为“返回为空”
          throw new Error(`响应解析失败（JSON）：${String(e?.message || e || '')}`)
        }
      }

      const text = await res.text().catch(() => '')
      // 尝试解析 JSON 错误响应
      let errorMsg = `HTTP ${res.status}`
      try {
        const errJson = JSON.parse(text)
        // 优先提取嵌套的 error 字段（如 {error: "消息"} 或 {error: {message: "消息"}}）
        const extractedError = typeof errJson?.error === 'string' 
          ? errJson.error 
          : errJson?.error?.message || errJson?.message || errJson?.detail
        errorMsg = extractedError || text || errorMsg
      } catch {
        errorMsg = summarizeErrorBody(res, text) || errorMsg
      }

      const shouldRetry = attempt < maxRetries && isRetryableStatus(res.status)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[postJson] 可重试失败，准备重试:', { status: res.status, attempt: attempt + 1, waitMs: wait })
        await sleep(wait)
        continue
      }

      console.error('[postJson] 请求失败:', { status: res.status, errorMsg })
      throw new Error(errorMsg)
    } catch (err: any) {
      // AbortError 通常表示超时；默认不自动重试，避免重复扣费/生成
      const name = String(err?.name || '')
      const shouldRetry = attempt < maxRetries && name !== 'AbortError' && isRetryableError(err)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[postJson] 网络/代理错误，准备重试:', { attempt: attempt + 1, waitMs: wait, message: String(err?.message || err) })
        await sleep(wait)
        continue
      }
      throw err
    } finally {
      if (t) window.clearTimeout(t)
    }
  }

  // 理论上不会到达这里
  throw new Error('postJson failed')
}

export const postFormData = async <T,>(endpoint: string, body: FormData, opts?: { authMode?: AuthMode; timeoutMs?: number }) => {
  const url0 = resolveEndpointUrl(endpoint)
  const authMode = opts?.authMode
  const apiKey = getApiKey()
  const url = url0

  // FormData 日志
  console.log('[postFormData] 请求详情:', {
    inputEndpoint: endpoint,
    resolvedUrl: url0,
    finalUrl: url,
    authMode,
    hasApiKey: !!apiKey,
    formDataKeys: [...body.keys()]
  })

  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutMs = Number(opts?.timeoutMs || 0)
    const t = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : null

    try {
      const res = await safeFetch(url, {
        method: 'POST',
        headers: {
          ...(authMode === 'query' && apiKey ? { 'x-goog-api-key': apiKey } : {}),
          ...(authMode !== 'query' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        body,
        signal: controller.signal
      })

      if (res.ok) {
        try {
          return (await res.json()) as T
        } catch (e: any) {
          throw new Error(`响应解析失败（JSON）：${String(e?.message || e || '')}`)
        }
      }

      const text = await res.text().catch(() => '')
      let errorMsg = `HTTP ${res.status}`
      try {
        const errJson = JSON.parse(text)
        // 与 postJson 保持一致的错误处理
        const extractedError = typeof errJson?.error === 'string' 
          ? errJson.error 
          : errJson?.error?.message || errJson?.message || errJson?.detail
        errorMsg = extractedError || text || errorMsg
      } catch {
        errorMsg = summarizeErrorBody(res, text) || errorMsg
      }

      const shouldRetry = attempt < maxRetries && isRetryableStatus(res.status)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[postFormData] 可重试失败，准备重试:', { status: res.status, attempt: attempt + 1, waitMs: wait })
        await sleep(wait)
        continue
      }

      console.error('[postFormData] 请求失败:', { status: res.status, errorMsg })
      throw new Error(errorMsg)
    } catch (err: any) {
      const name = String(err?.name || '')
      const shouldRetry = attempt < maxRetries && name !== 'AbortError' && isRetryableError(err)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[postFormData] 网络/代理错误，准备重试:', { attempt: attempt + 1, waitMs: wait, message: String(err?.message || err) })
        await sleep(wait)
        continue
      }
      throw err
    } finally {
      if (t) window.clearTimeout(t)
    }
  }

  throw new Error('postFormData failed')
}

export const getJson = async <T,>(endpoint: string, query?: Record<string, any>, opts?: { authMode?: AuthMode; timeoutMs?: number }) => {
  const url0 = resolveEndpointUrl(endpoint)
  const authMode = opts?.authMode
  const apiKey = getApiKey()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue
    qs.set(k, String(v))
  }

  const url = qs.toString() ? `${url0}${url0.includes('?') ? '&' : '?'}${qs.toString()}` : url0

  const maxRetries = 2
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController()
    const timeoutMs = Number(opts?.timeoutMs || 0)
    const t = timeoutMs > 0 ? window.setTimeout(() => controller.abort(), timeoutMs) : null

    try {
      const res = await safeFetch(url, {
        method: 'GET',
        headers: {
          ...(authMode === 'query' && apiKey ? { 'x-goog-api-key': apiKey } : {}),
          ...(authMode !== 'query' && apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
        },
        signal: controller.signal
      })

      if (res.ok) {
        try {
          return (await res.json()) as T
        } catch (e: any) {
          throw new Error(`响应解析失败（JSON）：${String(e?.message || e || '')}`)
        }
      }

      const text = await res.text().catch(() => '')
      // 与 postJson 保持一致的错误处理
      let errorMsg = `HTTP ${res.status}`
      try {
        const errJson = JSON.parse(text)
        // 优先提取嵌套的 error 字段
        const extractedError = typeof errJson?.error === 'string' 
          ? errJson.error 
          : errJson?.error?.message || errJson?.message || errJson?.detail
        errorMsg = extractedError || text || errorMsg
      } catch {
        errorMsg = summarizeErrorBody(res, text) || errorMsg
      }

      const shouldRetry = attempt < maxRetries && isRetryableStatus(res.status)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[getJson] 可重试失败，准备重试:', { 
          url: url.slice(0, 100), 
          status: res.status, 
          attempt: attempt + 1, 
          waitMs: wait,
          errorPreview: errorMsg.slice(0, 100)
        })
        await sleep(wait)
        continue
      }
      console.error('[getJson] 请求失败:', { url: url.slice(0, 100), status: res.status, errorMsg: errorMsg.slice(0, 200) })
      throw new Error(errorMsg)
    } catch (err: any) {
      const name = String(err?.name || '')
      const shouldRetry = attempt < maxRetries && name !== 'AbortError' && isRetryableError(err)
      if (shouldRetry) {
        const wait = backoffMs(attempt)
        console.warn('[getJson] 网络/代理错误，准备重试:', { attempt: attempt + 1, waitMs: wait, message: String(err?.message || err) })
        await sleep(wait)
        continue
      }
      throw err
    } finally {
      if (t) window.clearTimeout(t)
    }
  }

  throw new Error('getJson failed')
}
