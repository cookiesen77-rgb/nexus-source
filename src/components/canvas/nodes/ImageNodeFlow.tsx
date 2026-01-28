/**
 * ImageNodeFlow - React Flow 版本的图片节点
 * 显示生成的图片或上传的参考图
 * 参考 Vue 版本 ImageNode.vue 实现侧边功能
 * 
 * 性能优化：使用 IntersectionObserver 实现懒加载
 */
import React, { memo, useState, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Download, Expand, Loader2, Copy, ImageIcon, Crop, Eye, Video } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { getMedia, getMediaByNodeId, saveMedia } from '@/lib/mediaStorage'
import { downloadFile } from '@/lib/download'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { useInView } from '@/hooks/useInView'
import ImageCropModal from '@/components/canvas/ImageCropModal'
import MediaPreviewModal from '@/components/canvas/MediaPreviewModal'
import ImageEditToolbar from '@/components/canvas/ImageEditToolbar'

interface ImageNodeData {
  label?: string
  url?: string
  sourceUrl?: string  // 原始 URL（用于从 localStorage 恢复后重新加载）
  mediaId?: string    // IndexedDB 媒体 ID（用于恢复大型数据）
  loading?: boolean
  error?: string
}

export const ImageNodeComponent = memo(function ImageNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageNodeData
  const [showActions, setShowActions] = useState(false)
  const [editToolbarBusy, setEditToolbarBusy] = useState(false)
  const [editToolbarHover, setEditToolbarHover] = useState(false)
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const persistAttemptedRef = React.useRef<string>('')
  
  // 懒加载：只有节点进入可视区域时才加载图片
  const { ref: inViewRef, inView } = useInView({
    rootMargin: '200px', // 提前 200px 开始加载
    triggerOnce: true,   // 一旦加载过就不再卸载
  })

  // 如果没有 url，尝试从 IndexedDB 或 sourceUrl 恢复
  // 优先级：1. IndexedDB (mediaId) 2. sourceUrl (HTTPS URL)
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
          console.log('[ImageNode] 从 IndexedDB 加载图片, mediaId:', nodeData.mediaId)
          const record = await getMedia(nodeData.mediaId)
          if (record?.data) {
            useGraphStore.getState().updateNode(id, {
              data: { url: record.data, loading: false }
            } as any)
            return
          }
        }
        
        // 2. 尝试通过 nodeId 从 IndexedDB 查找
        console.log('[ImageNode] 通过 nodeId 从 IndexedDB 查找:', id)
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
          console.log('[ImageNode] 使用 sourceUrl:', nodeData.sourceUrl.slice(0, 50))
          useGraphStore.getState().updateNode(id, {
            data: { url: nodeData.sourceUrl, loading: false }
          } as any)
          return
        }
        
        console.log('[ImageNode] 无法恢复图片数据，节点需要重新生成')
      } catch (err) {
        console.error('[ImageNode] 加载媒体失败:', err)
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
          type: 'image',
          data: url,
          sourceUrl: typeof nodeData?.sourceUrl === 'string' && /^https?:\/\//i.test(nodeData.sourceUrl) ? nodeData.sourceUrl : undefined,
          model: typeof (nodeData as any)?.model === 'string' ? (nodeData as any).model : undefined,
        })
        if (mediaId) store.patchNodeDataSilent(id, { mediaId })
      } catch {
        // ignore
      }
    }
    void persist()
  }, [id, nodeData?.url, nodeData?.mediaId, nodeData?.sourceUrl])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('image', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleDownload = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可下载')
      return
    }
    
    try {
      const success = await downloadFile({
        url: nodeData.url,
        filename: `image_${id}_${Date.now()}.png`,
        mimeType: 'image/png'
      })
      if (success) {
        window.$message?.success?.('下载成功')
      }
    } catch (err: any) {
      console.error('[ImageNode] 下载失败:', err)
      window.$message?.error?.(`下载失败: ${err?.message || '未知错误'}`)
    }
  }, [id, nodeData?.url])

  // 图片生图 - 创建 imageConfig 节点并连接
  const handleImageGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
      const newNodeId = store.addNode(
        'imageConfig',
        { x: node.x + 400, y: node.y },
        { 
          label: '图生图',
          model: DEFAULT_IMAGE_MODEL,
          size: '1:1',
          quality: baseModelCfg?.defaultParams?.quality,
        }
      )
      store.addEdge(id, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
    }
  }, [id])

  // 裁剪功能
  const handleCrop = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可裁剪')
      return
    }
    setCropModalOpen(true)
  }, [nodeData?.url])

  // 裁剪完成回调
  const handleCropComplete = useCallback((croppedDataUrl: string) => {
    // 创建新的图片节点，保留原图
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('image', { x: node.x + 50, y: node.y + 50 }, {
        label: '裁剪图',
        url: croppedDataUrl
      })
      window.$message?.success?.('裁剪完成，已创建新节点')
    }
  }, [id])

  // 预览功能 - 在应用内模态框中显示
  const handlePreview = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!nodeData?.url) {
      window.$message?.warning?.('暂无图片可预览')
      return
    }
    setPreviewModalOpen(true)
  }, [nodeData?.url])

  // 视频生成 - 创建 videoConfig 节点并连接
  const handleVideoGen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
      const newNodeId = store.addNode(
        'videoConfig',
        { x: node.x + 400, y: node.y },
        { 
          label: '视频生成',
          model: DEFAULT_VIDEO_MODEL,
          ratio: baseModelCfg?.defaultParams?.ratio,
          dur: baseModelCfg?.defaultParams?.duration,
          size: baseModelCfg?.defaultParams?.size,
        }
      )
      store.addEdge(id, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
    }
  }, [id])

  return (
    // 外层 wrapper 提供悬浮按钮空间（参考 Vue 版本）
    // ref 用于懒加载检测
    <div
      ref={inViewRef}
      className="relative pr-[50px] pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => !editToolbarBusy && !editToolbarHover && setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`image-node bg-[var(--bg-secondary)] rounded-xl border min-w-[260px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {nodeData?.label || '图片'}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={handleDelete} className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
              <Trash2 size={14} />
            </button>
            <button className="p-1 hover:bg-[var(--bg-tertiary)] rounded">
              <Expand size={14} />
            </button>
          </div>
        </div>

        {/* 图片内容 - 支持懒加载 */}
        <div className="p-3 min-h-[200px] flex items-center justify-center overflow-hidden rounded-lg">
          {/* 懒加载占位符：节点不在可视区域且无已有图片时显示 */}
          {!inView && !nodeData?.url && !nodeData?.loading ? (
            <div className="flex flex-col items-center gap-2 text-[var(--text-secondary)]">
              <ImageIcon size={32} className="opacity-50" />
              <span className="text-sm opacity-50">滚动到此处加载</span>
            </div>
          ) : nodeData?.loading ? (
            <div className="flex flex-col items-center gap-2 text-[var(--text-secondary)]">
              <Loader2 size={32} className="animate-spin" />
              <span className="text-sm">生成中...</span>
            </div>
          ) : nodeData?.error ? (
            <div className="flex flex-col items-center gap-2 text-red-500 p-4">
              <span className="text-2xl">⚠</span>
              <span className="text-sm text-center">{nodeData.error}</span>
            </div>
          ) : nodeData?.url ? (
            <img
              src={nodeData.url}
              alt={nodeData.label || '图片'}
              className="max-w-full max-h-[300px] object-contain rounded-lg"
              draggable={false}
              loading="lazy"
              onError={() => {
                try {
                  // 当 URL 无效或图片加载失败时，给出明确错误提示，避免用户误以为“没有呈现在画布上”
                  useGraphStore.getState().updateNode(id, { data: { loading: false, error: '图片加载失败（URL 无效或已过期）' } } as any)
                } catch {
                  // ignore
                }
              }}
            />
          ) : (
            <div className="text-sm text-[var(--text-secondary)]">暂无图片</div>
          )}
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>

      {/* 图片编辑工具栏（在节点上方，仅在有图片时显示） */}
      {nodeData?.url && (
        <ImageEditToolbar
          nodeId={id}
          imageUrl={nodeData.url}
          visible={showActions || editToolbarBusy || editToolbarHover}
          onBusyChange={setEditToolbarBusy}
          onHoverChange={setEditToolbarHover}
        />
      )}

      {/* 右侧操作按钮（只在有图片时显示） */}
      {showActions && nodeData?.url && (
        <div className="absolute right-10 top-1/2 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]">
          {/* 复制 */}
          <button
            onClick={handleDuplicate}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Copy size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              复制
            </span>
          </button>
          {/* 图片生图 */}
          <button
            onClick={handleImageGen}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <ImageIcon size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
              图片生图
            </span>
          </button>
          {/* 裁剪 */}
          <button
            onClick={handleCrop}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Crop size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              裁剪
            </span>
          </button>
          {/* 预览 */}
          <button
            onClick={handlePreview}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Eye size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
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
          {/* 视频生成 */}
          <button
            onClick={handleVideoGen}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <Video size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
              视频生成
            </span>
          </button>
        </div>
      )}

      {/* 裁剪弹窗 - 使用 Portal 渲染到 body，避免被 React Flow 节点捕获事件 */}
      {cropModalOpen && nodeData?.url && createPortal(
        <ImageCropModal
          open={cropModalOpen}
          imageUrl={nodeData.url}
          onClose={() => setCropModalOpen(false)}
          onCrop={handleCropComplete}
        />,
        document.body
      )}

      {/* 预览弹窗 */}
      {previewModalOpen && nodeData?.url && createPortal(
        <MediaPreviewModal
          open={previewModalOpen}
          url={nodeData.url}
          type="image"
          onClose={() => setPreviewModalOpen(false)}
        />,
        document.body
      )}
    </div>
  )
})
