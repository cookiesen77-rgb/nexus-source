/**
 * VideoNodeFlow - React Flow 版本的视频节点
 * 完全对齐 Vue 版本 VideoNode.vue 实现
 * 
 * 性能优化：使用 IntersectionObserver 实现懒加载
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Copy, Expand, Video, Image, Eye, Download, X } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { openExternal } from '@/lib/openExternal'
import { getMedia, getMediaByNodeId, saveMedia } from '@/lib/mediaStorage'
import { useInView } from '@/hooks/useInView'

interface VideoNodeData {
  label?: string
  url?: string
  sourceUrl?: string  // 原始 URL（用于从 localStorage 恢复）
  mediaId?: string    // IndexedDB 媒体 ID（用于恢复大型数据）
  loading?: boolean
  error?: string
  model?: string
  duration?: number
}

// 格式化时长
const formatDuration = (seconds: number) => {
  if (!seconds || !Number.isFinite(seconds)) return '0:00'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export const VideoNodeComponent = memo(function VideoNode({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoNodeData
  const [showActions, setShowActions] = useState(false)
  const [videoError, setVideoError] = useState('')
  const videoRef = useRef<HTMLVideoElement>(null)
  const persistAttemptedRef = useRef<string>('')
  
  // 懒加载：只有节点进入可视区域时才加载视频
  const { ref: inViewRef, inView } = useInView({
    rootMargin: '200px', // 提前 200px 开始加载
    triggerOnce: true,   // 一旦加载过就不再卸载
  })

  const displayUrl = nodeData?.url || ''

  // 如果没有 url，尝试从 IndexedDB 或 sourceUrl 恢复
  // 使用 ref 防止重复尝试
  // 性能优化：只有节点在可视区域内时才加载
  const loadAttemptedRef = React.useRef(false)
  
  useEffect(() => {
    // 懒加载：如果节点不在可视区域，暂不加载
    if (!inView) {
      return
    }
    
    // 如果已经有 url 或正在加载，或者有错误，不需要尝试恢复
    if (nodeData?.url || nodeData?.loading || nodeData?.error) {
      return
    }
    
    // 如果没有 mediaId 也没有 sourceUrl，不需要尝试
    if (!nodeData?.mediaId && !nodeData?.sourceUrl) {
      return
    }
    
    // 如果已经尝试过，不再重复
    if (loadAttemptedRef.current) {
      return
    }
    
    loadAttemptedRef.current = true
    
    const loadMedia = async () => {
      try {
        // 1. 首先尝试通过 mediaId 从 IndexedDB 加载
        if (nodeData?.mediaId) {
          console.log('[VideoNode] 从 IndexedDB 加载视频, mediaId:', nodeData.mediaId)
          const record = await getMedia(nodeData.mediaId)
          if (record?.data) {
            useGraphStore.getState().updateNode(id, {
              data: { url: record.data, loading: false }
            } as any)
            return
          }
        }
        
        // 2. 尝试通过 nodeId 从 IndexedDB 查找
        console.log('[VideoNode] 通过 nodeId 从 IndexedDB 查找:', id)
        const recordByNode = await getMediaByNodeId(id)
        if (recordByNode?.data) {
          useGraphStore.getState().updateNode(id, {
            data: { 
              url: recordByNode.data, 
              mediaId: recordByNode.id,
              loading: false 
            }
          } as any)
          return
        }
        
        // 3. 如果有 sourceUrl（HTTPS URL），直接使用
        if (nodeData?.sourceUrl && nodeData.sourceUrl.startsWith('http')) {
          console.log('[VideoNode] 使用 sourceUrl:', nodeData.sourceUrl.slice(0, 50))
          useGraphStore.getState().updateNode(id, {
            data: { url: nodeData.sourceUrl, loading: false }
          } as any)
          return
        }
        
        console.log('[VideoNode] 无法恢复视频数据，节点需要重新生成')
      } catch (err) {
        console.error('[VideoNode] 加载媒体失败:', err)
      }
    }
    
    loadMedia()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.loading, nodeData?.error, inView])

  // 若当前 url 为 dataURL/纯 base64 且尚未落库，则写入 IndexedDB 并写回 mediaId（跨重启）
  useEffect(() => {
    const url = String(nodeData?.url || '').trim()
    if (!url) return
    if (nodeData?.mediaId) return
    if (persistAttemptedRef.current === url) return

    const isHttp = /^https?:\/\//i.test(url)
    const isDataUrl = url.startsWith('data:')
    const isBase64Like = !isHttp && url.length > 50000
    if (!isDataUrl && !isBase64Like) return

    persistAttemptedRef.current = url

    const persist = async () => {
      try {
        const store = useGraphStore.getState()
        const projectId = store.projectId || 'default'
        const mediaId = await saveMedia({
          nodeId: id,
          projectId,
          type: 'video',
          data: url,
          sourceUrl: typeof nodeData?.sourceUrl === 'string' && /^https?:\/\//i.test(nodeData.sourceUrl) ? nodeData.sourceUrl : undefined,
          model: typeof nodeData?.model === 'string' ? nodeData.model : undefined,
        })
        if (mediaId) store.patchNodeDataSilent(id, { mediaId })
      } catch {
        // ignore
      }
    }
    void persist()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl, nodeData?.model])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('video', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleExtractFrame = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!displayUrl || !videoRef.current) {
      window.$message?.warning?.('视频未就绪，请稍后再试')
      return
    }

    try {
      const video = videoRef.current
      if (!video.paused) video.pause()

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth || 640
      canvas.height = video.videoHeight || 360
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas 初始化失败')

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
      const dataUrl = canvas.toDataURL('image/jpeg', 0.92)

      const store = useGraphStore.getState()
      const node = store.nodes.find((n) => n.id === id)
      const imageId = store.addNode('image', 
        { x: (node?.x || 0) + 450, y: node?.y || 0 },
        { label: '视频帧', url: dataUrl }
      )
      store.addEdge(id, imageId, {})
      window.$message?.success?.('已提取当前帧')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '提取帧失败')
    }
  }, [id, displayUrl])

  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!displayUrl) return
    
    // 对于 data URL，在新标签页中打开
    if (displayUrl.startsWith('data:') || displayUrl.startsWith('blob:')) {
      window.open(displayUrl, '_blank')
      return
    }
    
    // 对于 HTTP URL，使用 openExternal（支持 Tauri）
    if (displayUrl.startsWith('http')) {
      void openExternal(displayUrl)
      return
    }
    
    window.open(displayUrl, '_blank')
  }, [displayUrl])

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!displayUrl) return
    
    const filename = `video_${Date.now()}.mp4`
    
    try {
      // data URL 或 blob URL 直接下载
      if (displayUrl.startsWith('data:') || displayUrl.startsWith('blob:')) {
        const link = document.createElement('a')
        link.href = displayUrl
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        return
      }
      
      // HTTP URL - 检测 Tauri 环境
      const isTauri = typeof window !== 'undefined' && !!(window as any).__TAURI_INTERNALS__
      
      if (isTauri) {
        // Tauri 环境：使用 tauri HTTP 插件
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
        const response = await tauriFetch(displayUrl)
        const arrayBuffer = await response.arrayBuffer()
        const blob = new Blob([arrayBuffer], { type: 'video/mp4' })
        const blobUrl = URL.createObjectURL(blob)
        
        const link = document.createElement('a')
        link.href = blobUrl
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(blobUrl)
      } else {
        // Web 环境：直接使用 anchor
        const link = document.createElement('a')
        link.href = displayUrl
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      }
    } catch (err) {
      console.error('[VideoNode] 下载失败:', err)
    }
  }, [displayUrl])

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      const store = useGraphStore.getState()
      const projectId = store.projectId || 'default'
      void (async () => {
        let mediaId: string | undefined
        try {
          mediaId = await saveMedia({
            nodeId: id,
            projectId,
            type: 'video',
            data: dataUrl,
            sourceUrl: undefined,
            model: typeof (nodeData as any)?.model === 'string' ? (nodeData as any).model : undefined,
          })
        } catch {
          mediaId = undefined
        }
        store.updateNode(id, {
          data: {
            ...(store.nodes.find((n) => n.id === id)?.data as any),
            url: dataUrl,
            sourceUrl: '', // dataURL 不作为长期 source
            mediaId,
            label: file.name,
          },
        } as any)
      })()
    }
    reader.readAsDataURL(file)
  }, [id])

  const handleVideoError = useCallback(() => {
    setVideoError('视频加载失败')
  }, [])

  return (
    // ref 用于懒加载检测
    <div
      ref={inViewRef}
      className="relative pr-[50px] pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`video-node bg-[var(--bg-secondary)] rounded-xl border w-[400px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="px-3 py-2 border-b border-[var(--border-color)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-secondary)]">
              {nodeData?.label || '视频'}
            </span>
            <div className="flex items-center gap-1">
              <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {nodeData?.model && (
            <div className="mt-1 text-xs text-[var(--text-secondary)] truncate">
              {nodeData.model}
            </div>
          )}
        </div>

        {/* 视频预览区域 - 支持懒加载 */}
        <div className="p-3">
          {/* 懒加载占位符：节点不在可视区域且无已有视频时显示 */}
          {!inView && !displayUrl && !nodeData?.loading && (
            <div className="aspect-video rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border border-[var(--border-color)]">
              <Video size={32} className="text-[var(--text-secondary)] opacity-50" />
              <span className="text-sm text-[var(--text-secondary)] opacity-50">滚动到此处加载</span>
            </div>
          )}

          {/* 加载状态 */}
          {inView && nodeData?.loading && (
            <div className="aspect-video rounded-lg bg-gradient-to-br from-cyan-400 via-blue-300 to-amber-200 flex flex-col items-center justify-center gap-3 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/20 via-blue-400/20 to-amber-300/20 animate-pulse" />
              <div className="relative z-10">
                <Video size={48} className="text-white" />
              </div>
              <span className="text-sm text-white font-medium relative z-10">创作中，预计等待 1 分钟</span>
            </div>
          )}

          {/* 错误状态 */}
          {inView && !nodeData?.loading && nodeData?.error && (
            <div className="aspect-video rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800">
              <X size={32} className="text-red-500" />
              <span className="text-sm text-red-500">{nodeData.error}</span>
            </div>
          )}

          {/* 视频加载错误 */}
          {inView && !nodeData?.loading && !nodeData?.error && videoError && (
            <div className="aspect-video rounded-lg bg-red-50 dark:bg-red-900/20 flex flex-col items-center justify-center gap-2 border border-red-200 dark:border-red-800">
              <X size={32} className="text-red-500" />
              <span className="text-sm text-red-500">{videoError}</span>
            </div>
          )}

          {/* 视频预览 */}
          {(inView || displayUrl) && !nodeData?.loading && !nodeData?.error && !videoError && displayUrl && (
            <div className="aspect-video rounded-lg overflow-hidden bg-black">
              <video
                ref={videoRef}
                src={displayUrl}
                controls
                crossOrigin="anonymous"
                playsInline
                preload="metadata"
                className="w-full h-full object-contain nodrag"
                onError={handleVideoError}
              />
            </div>
          )}

          {/* 空状态 */}
          {inView && !nodeData?.loading && !nodeData?.error && !videoError && !displayUrl && (
            <div className="aspect-video rounded-lg bg-[var(--bg-tertiary)] flex flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--border-color)] relative">
              <Video size={32} className="text-[var(--text-secondary)]" />
              <span className="text-sm text-[var(--text-secondary)]">拖放视频或点击上传</span>
              <input
                type="file"
                accept="video/*"
                className="absolute inset-0 opacity-0 cursor-pointer nodrag"
                onChange={handleFileUpload}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          {/* 时长信息 */}
          {nodeData?.duration && (
            <div className="mt-2 text-xs text-[var(--text-secondary)]">
              时长: {formatDuration(nodeData.duration)}
            </div>
          )}
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>

      {/* 悬浮操作按钮 - 复制（右上角偏左） */}
      {showActions && (
        <div className="absolute -top-5 right-12 z-[1000]">
          <button
            onClick={handleDuplicate}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Copy size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              复制
            </span>
          </button>
        </div>
      )}

      {/* 右侧操作按钮 */}
      {showActions && displayUrl && (
        <div className="absolute right-10 top-20 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]">
          {/* 提取当前帧 */}
          <button
            onClick={handleExtractFrame}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Image size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[90px] transition-all duration-200 whitespace-nowrap">
              提取当前帧
            </span>
          </button>
          {/* 预览 */}
          <button
            onClick={handlePreview}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Eye size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              预览
            </span>
          </button>
          {/* 下载 */}
          <button
            onClick={handleDownload}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Download size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              下载
            </span>
          </button>
        </div>
      )}
    </div>
  )
})
