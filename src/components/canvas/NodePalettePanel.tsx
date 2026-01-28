import React, { useEffect, useMemo, useRef, useCallback } from 'react'
import type { NodeType } from '@/graph/types'
import { useGraphStore } from '@/graph/store'
import { getNodeSize } from '@/graph/nodeSizing'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'
import { Image, Music, Save, Settings2, SlidersHorizontal, Type, Video } from 'lucide-react'
import { saveMedia } from '@/lib/mediaStorage'

const NODE_OPTIONS: { type: NodeType; name: string; Icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }[] = [
  { type: 'text', name: '文本节点', Icon: Type, color: '#3b82f6' },
  { type: 'imageConfig', name: '文生图配置', Icon: SlidersHorizontal, color: '#22c55e' },
  { type: 'videoConfig', name: '视频生成配置', Icon: Settings2, color: '#f59e0b' },
  { type: 'image', name: '图片节点', Icon: Image, color: '#8b5cf6' },
  { type: 'video', name: '视频节点', Icon: Video, color: '#ef4444' },
  { type: 'audio', name: '音频节点', Icon: Music, color: '#0ea5e9' },
  { type: 'localSave', name: '本地保存', Icon: Save, color: '#0f766e' }
]

const defaultLabelFor = (type: NodeType) => {
  if (type === 'text') return '文本'
  if (type === 'imageConfig') return '生图配置'
  if (type === 'videoConfig') return '视频配置'
  if (type === 'image') return '图片'
  if (type === 'video') return '视频'
  if (type === 'audio') return '音频'
  if (type === 'localSave') return '本地保存'
  return type
}

export default function NodePalettePanel({
  spawnAt,
  onSpawned,
  onClose
}: {
  spawnAt: { x: number; y: number }
  onSpawned: () => void
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)

  const options = useMemo(() => NODE_OPTIONS, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onPointerDown = (e: PointerEvent) => {
      const el = panelRef.current
      if (!el) return
      if (el.contains(e.target as Node)) return
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [onClose])

  // 文件选择器引用
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pendingTypeRef = useRef<NodeType | null>(null)

  // 处理文件选择
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const type = pendingTypeRef.current
    if (!type) return

    const file = files[0]
    const reader = new FileReader()
    
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string
      if (!dataUrl) return

      const { w, h } = getNodeSize(type)
      const pos = { x: spawnAt.x - w * 0.5, y: spawnAt.y - h * 0.5 }
      const label = file.name || defaultLabelFor(type)

      useGraphStore.getState().withBatchUpdates(() => {
        const store = useGraphStore.getState()
        const id = store.addNode(type, pos, {
          label,
          url: dataUrl,
          sourceUrl: '',
          fileName: file.name,
          fileType: file.type,
          createdAt: Date.now()
        })
        useGraphStore.getState().setSelected(id)

        // 异步保存到 IndexedDB
        const projectId = store.projectId || 'default'
        saveMedia({
          nodeId: id,
          projectId,
          type,
          data: dataUrl,
        }).then((mediaId) => {
          if (mediaId) {
            useGraphStore.getState().patchNodeDataSilent(id, { mediaId })
          }
        }).catch(() => {
          // ignore
        })
      })

      onSpawned()
      onClose()
    }

    reader.readAsDataURL(file)

    // 清理 input 以便再次选择同一文件
    e.target.value = ''
    pendingTypeRef.current = null
  }, [spawnAt, onSpawned, onClose])

  // 触发文件选择器
  const triggerFileUpload = useCallback((type: NodeType) => {
    pendingTypeRef.current = type
    
    // 根据类型设置 accept
    let accept = ''
    if (type === 'image') accept = 'image/*'
    else if (type === 'video') accept = 'video/*'
    else if (type === 'audio') accept = 'audio/*'

    if (fileInputRef.current) {
      fileInputRef.current.accept = accept
      fileInputRef.current.click()
    }
  }, [])

  const spawn = (type: NodeType) => {
    // 图片/视频/音频节点触发文件选择器
    if (type === 'image' || type === 'video' || type === 'audio') {
      triggerFileUpload(type)
      return
    }

    const { w, h } = getNodeSize(type)
    const pos = { x: spawnAt.x - w * 0.5, y: spawnAt.y - h * 0.5 }
    const label = defaultLabelFor(type)

    useGraphStore.getState().withBatchUpdates(() => {
      const store = useGraphStore.getState()
      const data: Record<string, unknown> = { label }
      if (type === 'imageConfig') {
        const baseModelCfg: any = (IMAGE_MODELS as any[]).find((m: any) => m.key === DEFAULT_IMAGE_MODEL) || (IMAGE_MODELS as any[])[0]
        data.model = DEFAULT_IMAGE_MODEL
        if (baseModelCfg?.defaultParams?.size) data.size = baseModelCfg.defaultParams.size
        if (baseModelCfg?.defaultParams?.quality) data.quality = baseModelCfg.defaultParams.quality
      }
      if (type === 'videoConfig') {
        const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
        data.model = DEFAULT_VIDEO_MODEL
        if (baseModelCfg?.defaultParams?.ratio) data.ratio = baseModelCfg.defaultParams.ratio
        if (baseModelCfg?.defaultParams?.duration) data.dur = baseModelCfg.defaultParams.duration
        if (baseModelCfg?.defaultParams?.size) data.size = baseModelCfg.defaultParams.size
      }
      const id = store.addNode(type, pos, data)
      useGraphStore.getState().setSelected(id)
    })

    onSpawned()
    onClose()
  }

  return (
    <div
      ref={panelRef}
      className="w-[220px] rounded-[14px] border border-[var(--border-color)] bg-[var(--bg-secondary)] p-2"
    >
      {/* 隐藏的文件选择器 */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleFileSelect}
      />
      <div className="flex flex-col gap-1">
        {options.map((opt) => (
          <button
            key={opt.type}
            onClick={() => spawn(opt.type)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <opt.Icon className="h-[20px] w-[20px]" style={{ color: opt.color }} />
            <span className="truncate text-sm text-[var(--text-primary)]">{opt.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
