/**
 * Download utility for Tauri and Web
 * 统一使用 blob URL + anchor 下载（最可靠的方式）
 */

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface DownloadOptions {
  url: string
  filename: string
}

/**
 * 下载文件
 * 统一使用 blob URL + anchor 方式，兼容 Tauri 和 Web
 */
export async function downloadFile(options: DownloadOptions): Promise<boolean> {
  const { url, filename } = options

  try {
    let blob: Blob

    if (url.startsWith('data:')) {
      // data URL 转 blob
      const response = await fetch(url)
      blob = await response.blob()
    } else if (url.startsWith('blob:')) {
      // 已经是 blob URL，直接获取 blob
      const response = await fetch(url)
      blob = await response.blob()
    } else {
      // HTTP URL
      if (isTauri) {
        // Tauri 环境：使用 plugin-http 绕过 CORS
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
        const response = await tauriFetch(url)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const arrayBuffer = await response.arrayBuffer()
        blob = new Blob([arrayBuffer])
      } else {
        // Web 环境
        const response = await fetch(url)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        blob = await response.blob()
      }
    }

    // 创建 blob URL 并下载
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
  } catch (err) {
    console.error('[download] 下载失败:', err)
    throw err
  }
}
