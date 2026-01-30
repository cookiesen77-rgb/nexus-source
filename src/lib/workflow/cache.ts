import { getTauri, tauriInvoke } from '@/lib/tauri'

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

export const resolveCachedImageUrl = async (url: string): Promise<{ displayUrl: string; localPath: string; error?: string }> => {
  const u = String(url || '').trim()
  if (!u) return { displayUrl: '', localPath: '' }
  if (u.startsWith('data:') || u.startsWith('blob:')) return { displayUrl: u, localPath: '' }

  const t = await getTauri()
  
  // Tauri 环境：使用 Rust 端的 cache_remote_image 命令
  if (t.isTauri) {
    // 如果是相对路径，转换为绝对 URL（Tauri 没有 Vite 代理）
    let absoluteUrl = u
    if (u.startsWith('/v1/')) {
      absoluteUrl = `https://nexusapi.cn${u}`
      console.log('[resolveCachedImageUrl] Tauri: 相对路径转换为绝对 URL:', absoluteUrl.slice(0, 80))
    }
    if (!/^https?:\/\//i.test(absoluteUrl)) return { displayUrl: absoluteUrl, localPath: '' }
    
    try {
      const token = getApiKey()
      console.log('[resolveCachedImageUrl] Tauri: 调用 cache_remote_image 命令')
      const path = await tauriInvoke<string>('cache_remote_image', { url: absoluteUrl, authToken: token || null })
      if (!path) {
        console.error('[resolveCachedImageUrl] Tauri: cache_remote_image 返回空')
        return { displayUrl: '', localPath: '', error: '缓存图片失败' }
      }

      const displayUrl = t.convertFileSrc ? t.convertFileSrc(path) : absoluteUrl
      console.log('[resolveCachedImageUrl] Tauri: 缓存成功, displayUrl:', displayUrl.slice(0, 80))
      return { displayUrl, localPath: path }
    } catch (err) {
      console.error('[resolveCachedImageUrl] Tauri: cache_remote_image 异常:', err)
      return { displayUrl: '', localPath: '', error: String(err) }
    }
  }
  
  // Web 环境：直接返回原始 URL（浏览器会处理 CORS）
  return { displayUrl: u, localPath: '' }
}

export const resolveCachedMediaUrl = async (url: string) => {
  const u = String(url || '').trim()
  if (!u) return { displayUrl: '', localPath: '' }
  if (u.startsWith('data:') || u.startsWith('blob:')) return { displayUrl: u, localPath: '' }

  const t = await getTauri()
  
  // Tauri 环境：使用 Rust 端的 cache_remote_media 命令（通过 reqwest 库发送 HTTP 请求）
  if (t.isTauri) {
    // 如果是相对路径，转换为绝对 URL（Tauri 没有 Vite 代理）
    let absoluteUrl = u
    if (u.startsWith('/v1/')) {
      absoluteUrl = `https://nexusapi.cn${u}`
      console.log('[resolveCachedMediaUrl] Tauri: 相对路径转换为绝对 URL:', absoluteUrl.slice(0, 80))
    }
    if (!/^https?:\/\//i.test(absoluteUrl)) return { displayUrl: absoluteUrl, localPath: '' }
    
    try {
      const token = getApiKey()
      console.log('[resolveCachedMediaUrl] Tauri: 调用 cache_remote_media 命令')
      const path = await tauriInvoke<string>('cache_remote_media', { url: absoluteUrl, authToken: token || null })
      if (!path) {
        console.error('[resolveCachedMediaUrl] Tauri: cache_remote_media 返回空')
        return { displayUrl: '', localPath: '', error: '缓存媒体失败' }
      }

      const displayUrl = t.convertFileSrc ? t.convertFileSrc(path) : absoluteUrl
      console.log('[resolveCachedMediaUrl] Tauri: 缓存成功, displayUrl:', displayUrl.slice(0, 80))
      return { displayUrl, localPath: path }
    } catch (err) {
      console.error('[resolveCachedMediaUrl] Tauri: cache_remote_media 异常:', err)
      return { displayUrl: '', localPath: '', error: String(err) }
    }
  }
  
  // Web 环境：检查是否需要鉴权的 URL
  // 1. nexusapi.cn 的绝对 URL
  // 2. /v1/ 开头的相对路径（通过 Vite 代理）
  const needsAuth = (
    (/^https?:\/\//i.test(u) && u.includes('nexusapi.cn')) ||
    u.startsWith('/v1/')
  )
  
  if (needsAuth) {
    try {
      const token = getApiKey()
      // 如果是绝对 URL (nexusapi.cn)，转换为相对路径通过代理
      let fetchUrl = u
      if (/^https?:\/\//i.test(u) && u.includes('nexusapi.cn')) {
        try {
          const parsed = new URL(u)
          fetchUrl = parsed.pathname + parsed.search
          console.log('[resolveCachedMediaUrl] 转换绝对 URL 为相对路径:', fetchUrl)
        } catch {
          // 保持原 URL
        }
      }
      console.log('[resolveCachedMediaUrl] Web 环境下载需要鉴权的视频:', fetchUrl.slice(0, 80))
      const response = await fetch(fetchUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (!response.ok) {
        console.error('[resolveCachedMediaUrl] 下载失败:', response.status)
        // 返回空 URL，避免浏览器尝试直接加载需要鉴权的 URL
        return { displayUrl: '', localPath: '', error: `下载失败: ${response.status}` }
      }
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      console.log('[resolveCachedMediaUrl] 转换为 blob URL:', blobUrl.slice(0, 50))
      return { displayUrl: blobUrl, localPath: '' }
    } catch (err) {
      console.error('[resolveCachedMediaUrl] 下载视频失败:', err)
      // 返回空 URL，避免浏览器尝试直接加载
      return { displayUrl: '', localPath: '', error: String(err) }
    }
  }
  
  return { displayUrl: u, localPath: '' }
}
