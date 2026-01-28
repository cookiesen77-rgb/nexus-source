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
 * 获取文件数据
 */
async function fetchFileData(url: string): Promise<Uint8Array> {
  if (url.startsWith('data:')) {
    // data URL 转 Uint8Array
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  } else if (url.startsWith('blob:')) {
    // blob URL
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  } else {
    // HTTP URL
    if (isTauri) {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      const response = await tauriFetch(url)
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
          name: ext.toUpperCase(),
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
  } catch (err) {
    console.error('[download] 下载失败:', err)
    throw err
  }
}
