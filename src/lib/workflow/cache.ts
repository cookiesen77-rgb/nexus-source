import { getTauri, tauriInvoke } from '@/lib/tauri'

const getApiKey = () => {
  try {
    return localStorage.getItem('apiKey') || ''
  } catch {
    return ''
  }
}

export const resolveCachedImageUrl = async (url: string) => {
  const u = String(url || '').trim()
  if (!u) return { displayUrl: '', localPath: '' }
  if (u.startsWith('data:') || u.startsWith('blob:')) return { displayUrl: u, localPath: '' }

  const t = await getTauri()
  if (!t.isTauri) return { displayUrl: u, localPath: '' }
  if (!/^https?:\/\//i.test(u)) return { displayUrl: u, localPath: '' }

  const token = getApiKey()
  const path = await tauriInvoke<string>('cache_remote_image', { url: u, authToken: token || null })
  if (!path) return { displayUrl: u, localPath: '' }

  try {
    const displayUrl = t.convertFileSrc ? t.convertFileSrc(path) : u
    return { displayUrl, localPath: path }
  } catch {
    return { displayUrl: u, localPath: path }
  }
}

export const resolveCachedMediaUrl = async (url: string) => {
  const u = String(url || '').trim()
  if (!u) return { displayUrl: '', localPath: '' }
  if (u.startsWith('data:') || u.startsWith('blob:')) return { displayUrl: u, localPath: '' }

  const t = await getTauri()
  
  // Tauri 环境：使用原生缓存
  if (t.isTauri) {
    if (!/^https?:\/\//i.test(u)) return { displayUrl: u, localPath: '' }
    const token = getApiKey()
    const path = await tauriInvoke<string>('cache_remote_media', { url: u, authToken: token || null })
    if (!path) return { displayUrl: u, localPath: '' }

    try {
      const displayUrl = t.convertFileSrc ? t.convertFileSrc(path) : u
      return { displayUrl, localPath: path }
    } catch {
      return { displayUrl: u, localPath: path }
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
      console.log('[resolveCachedMediaUrl] Web 环境下载需要鉴权的视频:', u.slice(0, 80))
      const response = await fetch(u, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      })
      if (!response.ok) {
        console.error('[resolveCachedMediaUrl] 下载失败:', response.status)
        return { displayUrl: u, localPath: '' }
      }
      const blob = await response.blob()
      const blobUrl = URL.createObjectURL(blob)
      console.log('[resolveCachedMediaUrl] 转换为 blob URL:', blobUrl.slice(0, 50))
      return { displayUrl: blobUrl, localPath: '' }
    } catch (err) {
      console.error('[resolveCachedMediaUrl] 下载视频失败:', err)
      return { displayUrl: u, localPath: '' }
    }
  }
  
  return { displayUrl: u, localPath: '' }
}
