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
  if (!t.isTauri) return { displayUrl: u, localPath: '' }
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
