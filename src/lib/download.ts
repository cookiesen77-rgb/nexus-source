/**
 * Download utility for Tauri and Web
 * Tauri: 使用 dialog + fs 实现文件保存对话框
 * Web: 使用 anchor 标签下载
 */

// 检测 Tauri 环境
const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__

interface DownloadOptions {
  url: string
  filename: string
  mimeType?: string
}

/**
 * 下载文件，Tauri 环境会弹出文件保存对话框
 */
export async function downloadFile(options: DownloadOptions): Promise<boolean> {
  const { url, filename, mimeType } = options

  try {
    if (isTauri) {
      return await downloadInTauri(url, filename, mimeType)
    } else {
      return await downloadInWeb(url, filename)
    }
  } catch (err) {
    console.error('[download] 下载失败:', err)
    throw err
  }
}

/**
 * Tauri 环境下载 - 弹出文件保存对话框
 */
async function downloadInTauri(url: string, filename: string, mimeType?: string): Promise<boolean> {
  const { save } = await import('@tauri-apps/plugin-dialog')
  const { writeFile } = await import('@tauri-apps/plugin-fs')
  
  // 获取文件数据
  let data: Uint8Array
  
  if (url.startsWith('data:')) {
    // data URL
    const base64 = url.split(',')[1]
    const binaryString = atob(base64)
    data = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      data[i] = binaryString.charCodeAt(i)
    }
  } else if (url.startsWith('blob:')) {
    // blob URL
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    data = new Uint8Array(arrayBuffer)
  } else {
    // HTTP URL - 使用 Tauri HTTP 插件
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const response = await tauriFetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    data = new Uint8Array(arrayBuffer)
  }

  // 弹出保存对话框
  const ext = filename.split('.').pop() || 'bin'
  const filePath = await save({
    defaultPath: filename,
    filters: [{
      name: getFilterName(ext),
      extensions: [ext]
    }]
  })

  if (!filePath) {
    // 用户取消
    return false
  }

  // 写入文件
  await writeFile(filePath, data)
  return true
}

/**
 * Web 环境下载 - 使用 blob + anchor
 */
async function downloadInWeb(url: string, filename: string): Promise<boolean> {
  let blobUrl: string

  if (url.startsWith('data:') || url.startsWith('blob:')) {
    blobUrl = url
  } else {
    // 通过 fetch 获取 blob
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const blob = await response.blob()
    blobUrl = URL.createObjectURL(blob)
  }

  const link = document.createElement('a')
  link.href = blobUrl
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  // 如果是创建的 blob URL，需要释放
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    URL.revokeObjectURL(blobUrl)
  }

  return true
}

function getFilterName(ext: string): string {
  const extLower = ext.toLowerCase()
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(extLower)) {
    return '图片文件'
  }
  if (['mp4', 'webm', 'mov'].includes(extLower)) {
    return '视频文件'
  }
  if (['mp3', 'wav', 'm4a'].includes(extLower)) {
    return '音频文件'
  }
  return '文件'
}

/**
 * 在 Tauri 中打开预览
 * 对于 HTTP URL，先下载到临时目录然后用系统默认程序打开
 * 对于 data URL，创建新窗口显示
 */
export async function previewFile(url: string, type: 'image' | 'video'): Promise<void> {
  if (!url) {
    throw new Error('URL 为空')
  }

  // data URL 或 blob URL - 在新窗口中显示
  if (url.startsWith('data:') || url.startsWith('blob:')) {
    const win = window.open('', '_blank')
    if (win) {
      if (type === 'image') {
        win.document.write(`<html><head><title>图片预览</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a;}</style></head><body><img src="${url}" style="max-width:100%;max-height:100vh;object-fit:contain;"/></body></html>`)
      } else {
        win.document.write(`<html><head><title>视频预览</title><style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#1a1a1a;}</style></head><body><video src="${url}" controls autoplay style="max-width:100%;max-height:100vh;"/></body></html>`)
      }
      win.document.close()
    }
    return
  }

  // HTTP URL
  if (isTauri) {
    // Tauri 环境：使用 opener 打开系统浏览器
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    // Web 环境：新窗口打开
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
