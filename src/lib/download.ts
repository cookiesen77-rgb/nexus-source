/**
 * Download utility for Tauri and Web
 * Tauri: 使用 dialog 选择保存路径 + fs 写入文件
 * Web: 使用 blob URL + anchor 下载
 */

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface DownloadOptions {
  url: string
  filename: string
  mimeType?: string
}

/**
 * Base64 字符串转 Uint8Array（高效处理大型数据）
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * 从 asset:// URL 中提取本地文件路径
 * asset://localhost/path/to/file -> /path/to/file
 */
function extractLocalPath(assetUrl: string): string | null {
  if (!assetUrl.startsWith('asset://')) return null
  try {
    const url = new URL(assetUrl)
    // asset://localhost/Users/... -> /Users/...
    const p = decodeURIComponent(url.pathname)
    // Windows: asset://localhost/C:/Users/... -> /C:/Users/...（需要去掉前导斜杠）
    if (/^\/[A-Za-z]:\//.test(p)) return p.slice(1)
    return p
  } catch {
    return null
  }
}

/**
 * 规范化网关相对路径为绝对 URL（Tauri plugin-http 需要绝对地址）
 */
function normalizeGatewayUrl(url: string): string {
  const u = String(url || '').trim()
  if (!u) return u
  if (/^https?:\/\//i.test(u)) return u
  if (u.startsWith('asset://') || u.startsWith('data:') || u.startsWith('blob:')) return u
  const prefixes = ['/v1/', '/v1beta', '/kling', '/tencent-vod', '/video']
  if (u.startsWith('/')) {
    for (const p of prefixes) {
      if (u.startsWith(p)) return `https://nexusapi.cn${u}`
    }
  }
  return u
}

/**
 * 获取文件数据
 */
async function fetchFileData(url: string): Promise<Uint8Array> {
  console.log('[download] fetchFileData, url type:', 
    url.startsWith('data:') ? 'data:' : 
    url.startsWith('blob:') ? 'blob:' : 
    url.startsWith('asset:') ? 'asset:' :
    url.startsWith('http') ? 'http' : 'unknown',
    'length:', url.length
  )
  
  if (url.startsWith('data:')) {
    // data URL 转 Uint8Array（直接解析 base64，避免 fetch 对大文件的性能问题）
    const commaIndex = url.indexOf(',')
    if (commaIndex === -1) {
      throw new Error('Invalid data URL format')
    }
    const base64Data = url.substring(commaIndex + 1)
    console.log('[download] 解析 data URL, base64 length:', base64Data.length)
    return base64ToUint8Array(base64Data)
  } else if (url.startsWith('blob:')) {
    // blob URL
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  } else if (url.startsWith('asset://') && isTauri) {
    // Tauri asset:// URL - 读取本地文件
    const localPath = extractLocalPath(url)
    if (!localPath) {
      throw new Error('Invalid asset URL')
    }
    console.log('[download] 读取本地文件:', localPath)
    const { readFile } = await import('@tauri-apps/plugin-fs')
    return await readFile(localPath)
  } else {
    // HTTP URL
    if (isTauri) {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      const resolvedUrl = normalizeGatewayUrl(url)
      console.log('[download] Tauri fetch:', resolvedUrl.slice(0, 100))
      const response = await tauriFetch(resolvedUrl)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    } else {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const arrayBuffer = await response.arrayBuffer()
      return new Uint8Array(arrayBuffer)
    }
  }
}

/**
 * 获取文件扩展名
 */
function getExtension(filename: string): string {
  const match = filename.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : 'png'
}

/**
 * 获取文件类型名称（用于保存对话框）
 */
function getFileTypeName(ext: string): string {
  const types: Record<string, string> = {
    mp4: 'MP4 视频',
    webm: 'WebM 视频',
    mov: 'MOV 视频',
    avi: 'AVI 视频',
    png: 'PNG 图片',
    jpg: 'JPEG 图片',
    jpeg: 'JPEG 图片',
    gif: 'GIF 图片',
    webp: 'WebP 图片',
  }
  return types[ext] || ext.toUpperCase()
}

/**
 * 下载文件
 * Tauri: 弹出保存对话框选择路径
 * Web: 使用 anchor 下载到默认位置
 */
export async function downloadFile(options: DownloadOptions): Promise<boolean> {
  const { url, filename } = options

  try {
    // 获取文件数据
    const data = await fetchFileData(url)
    
    if (isTauri) {
      // Tauri 环境：使用 dialog 选择保存路径
      const { save } = await import('@tauri-apps/plugin-dialog')
      const { writeFile } = await import('@tauri-apps/plugin-fs')
      
      const ext = getExtension(filename)
      
      // 弹出保存对话框
      const filePath = await save({
        defaultPath: filename,
        filters: [{
          name: getFileTypeName(ext),
          extensions: [ext]
        }]
      })
      
      if (!filePath) {
        // 用户取消了保存
        return false
      }
      
      // 写入文件
      await writeFile(filePath, data)
      
      return true
    } else {
      // Web 环境：使用 blob URL + anchor
      const blob = new Blob([data])
      const blobUrl = URL.createObjectURL(blob)
      
      const link = document.createElement('a')
      link.href = blobUrl
      link.download = filename
      link.style.display = 'none'
      document.body.appendChild(link)
      link.click()
      
      // 清理
      setTimeout(() => {
        document.body.removeChild(link)
        URL.revokeObjectURL(blobUrl)
      }, 1000)

      return true
    }
  } catch (err: any) {
    console.error('[download] 下载失败:', err)
    // 提供更详细的错误信息
    const errMsg = err?.message || String(err) || '未知错误'
    throw new Error(`下载失败: ${errMsg}`)
  }
}
