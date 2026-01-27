import React, { useEffect, useMemo, useRef } from 'react'
import { useGraphStore } from '@/graph/store'
import type { GraphEdge, GraphNode, NodeType } from '@/graph/types'
import { getNodeSize } from '@/graph/nodeSizing'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL } from '@/config/models'

export type CanvasContextPayload =
  | { kind: 'node'; id: string; clientX: number; clientY: number }
  | { kind: 'edge'; id: string; clientX: number; clientY: number }
  | { kind: 'canvas'; clientX: number; clientY: number; world: { x: number; y: number } }

const itemClass =
  'flex w-full items-center justify-between px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]'

const sectionSep = <div className="my-1 h-px w-full bg-[var(--border-color)]" />

const guessSpawnType = (to: GraphNode | null): NodeType => {
  if (!to) return 'text'
  if (to.type === 'imageConfig') return 'image'
  if (to.type === 'videoConfig') return 'image'
  return 'text'
}

export default function CanvasContextMenu({
  open,
  onOpenChange,
  payload,
  onRequestEditRemark,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  payload: CanvasContextPayload | null
  onRequestEditRemark?: (nodeId: string) => void
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const updateNode = useGraphStore((s) => s.updateNode)
  const removeNode = useGraphStore((s) => s.removeNode)
  const duplicateNode = useGraphStore((s) => s.duplicateNode)
  const addNode = useGraphStore((s) => s.addNode)
  const addEdge = useGraphStore((s) => s.addEdge)
  const removeEdge = useGraphStore((s) => s.removeEdge)
  const setEdgeImageRole = useGraphStore((s) => s.setEdgeImageRole)
  const setSelected = useGraphStore((s) => s.setSelected)
  const withBatch = useGraphStore((s) => s.withBatchUpdates)

  const info = useMemo(() => {
    if (!payload) return null
    if (payload.kind === 'node') {
      const node = nodes.find((n) => n.id === payload.id) || null
      return { kind: 'node' as const, node }
    }
    if (payload.kind === 'edge') {
      const edge = edges.find((e) => e.id === payload.id) || null
      return { kind: 'edge' as const, edge }
    }
    return { kind: 'canvas' as const, world: payload.world }
  }, [edges, nodes, payload])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const el = rootRef.current
      if (!el) return
      if (el.contains(e.target as any)) return
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false)
    }
    // 使用 capture 阶段监听，避免画布/节点 stopPropagation() 导致无法关闭
    window.addEventListener('pointerdown', onDown, { capture: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, { capture: true } as any)
      window.removeEventListener('keydown', onKey)
    }
  }, [onOpenChange, open])

  if (!open || !payload || !info) return null

  const style: React.CSSProperties = {
    left: payload.clientX,
    top: payload.clientY
  }

  const spawnConfigToRight = (src: GraphNode, type: NodeType) => {
    const { w } = getNodeSize(src.type)
    const dx = type === 'imageConfig' ? Math.max(360, w + 40) : Math.max(420, w + 80)
    withBatch(() => {
      const id = addNode(type, { x: src.x + dx, y: src.y + (type === 'videoConfig' ? 40 : 0) }, {
        label: type === 'imageConfig' ? '文生图' : '视频生成',
        ...(type === 'imageConfig' ? { model: DEFAULT_IMAGE_MODEL } : {}),
        ...(type === 'videoConfig' ? { model: DEFAULT_VIDEO_MODEL } : {})
      })
      addEdge(src.id, id, {})
      setSelected(id)
    })
  }

  const spawnNodeAt = (type: NodeType, world: { x: number; y: number }) => {
    const id = addNode(type, { x: world.x, y: world.y }, { label: type === 'text' ? '文本' : type })
    setSelected(id)
  }

  const MenuShell = ({ children }: { children: React.ReactNode }) => (
    <div
      ref={rootRef}
      className="pointer-events-auto fixed z-[60] w-[220px] overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
      style={style}
    >
      {children}
    </div>
  )

  if (info.kind === 'node' && info.node) {
    const n = info.node
    const url = String((n.data as any)?.url || '').trim()
    const canDownload = (n.type === 'image' || n.type === 'video' || n.type === 'audio') && !!url
    return (
      <MenuShell>
        {canDownload ? (
          <>
            <button
              className={itemClass}
              onClick={() => {
                try {
                  const ext = n.type === 'video' ? 'mp4' : n.type === 'audio' ? 'mp3' : 'png'
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${String((n.data as any)?.label || 'asset').trim() || 'asset'}-${Date.now()}.${ext}`
                  document.body.appendChild(a)
                  a.click()
                  document.body.removeChild(a)
                } catch {
                  // ignore
                }
                onOpenChange(false)
              }}
            >
              <span>下载素材</span>
            </button>
            {sectionSep}
          </>
        ) : null}
        <button
          className={itemClass}
          onClick={() => {
            setSelected(n.id)
            onOpenChange(false)
          }}
        >
          <span>选中</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            onRequestEditRemark?.(n.id)
            onOpenChange(false)
          }}
        >
          <span>编辑备注…</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            const next = duplicateNode(n.id)
            if (next) setSelected(next)
            onOpenChange(false)
          }}
        >
          <span>复制</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            removeNode(n.id)
            onOpenChange(false)
          }}
        >
          <span className="text-[var(--danger-color)]">删除</span>
        </button>
        {sectionSep}
        <button
          className={itemClass}
          onClick={() => {
            spawnConfigToRight(n, 'imageConfig')
            onOpenChange(false)
          }}
        >
          <span>创建生图配置</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            spawnConfigToRight(n, 'videoConfig')
            onOpenChange(false)
          }}
        >
          <span>创建视频配置</span>
        </button>
        {sectionSep}
        <button
          className={itemClass}
          onClick={() => {
            updateNode(n.id, { zIndex: Date.now() })
            onOpenChange(false)
          }}
        >
          <span>置顶</span>
        </button>
      </MenuShell>
    )
  }

  if (info.kind === 'edge' && info.edge) {
    const e = info.edge
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const s = byId.get(e.source)
    const t = byId.get(e.target)
    const canSetRole = s?.type === 'image' && t?.type === 'videoConfig'
    return (
      <MenuShell>
        {canSetRole ? (
          <>
            <button
              className={itemClass}
              onClick={() => {
                setEdgeImageRole(e.id, 'first_frame_image')
                onOpenChange(false)
              }}
            >
              <span>设为首帧</span>
            </button>
            <button
              className={itemClass}
              onClick={() => {
                setEdgeImageRole(e.id, 'last_frame_image')
                onOpenChange(false)
              }}
            >
              <span>设为尾帧</span>
            </button>
            <button
              className={itemClass}
              onClick={() => {
                setEdgeImageRole(e.id, 'input_reference')
                onOpenChange(false)
              }}
            >
              <span>设为参考图</span>
            </button>
            {sectionSep}
          </>
        ) : null}
        <button
          className={itemClass}
          onClick={() => {
            removeEdge(e.id)
            onOpenChange(false)
          }}
        >
          <span className="text-[var(--danger-color)]">删除连线</span>
        </button>
      </MenuShell>
    )
  }

  if (info.kind === 'canvas') {
    const world = info.world
    return (
      <MenuShell>
        <button
          className={itemClass}
          onClick={() => {
            spawnNodeAt('text', world)
            onOpenChange(false)
          }}
        >
          <span>新建文本节点</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            spawnNodeAt('imageConfig', world)
            onOpenChange(false)
          }}
        >
          <span>新建生图配置</span>
        </button>
        <button
          className={itemClass}
          onClick={() => {
            spawnNodeAt('videoConfig', world)
            onOpenChange(false)
          }}
        >
          <span>新建视频配置</span>
        </button>
      </MenuShell>
    )
  }

  return null
}
