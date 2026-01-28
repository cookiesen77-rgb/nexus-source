import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { shallow } from 'zustand/shallow'
import SettingsDialog from '@/components/SettingsDialog'
import { useGraphStore } from '@/graph/store'
import type { Viewport } from '@/graph/types'
import WebGLGraphCanvas from '@/components/canvas/WebGLGraphCanvas'
import DOMGraphCanvas from '@/components/canvas/DOMGraphCanvas'
import ReactFlowCanvas from '@/components/canvas/ReactFlowCanvas'
import CanvasSidebar, { type CanvasTool } from '@/components/canvas/CanvasSidebar'
import NodePalettePanel from '@/components/canvas/NodePalettePanel'
import NodeCardsLayer from '@/components/canvas/NodeCardsLayer'
import EdgeOverlayLayer from '@/components/canvas/EdgeOverlayLayer'
import EventCoordinator from '@/components/canvas/EventCoordinator'
import CanvasContextMenu, { type CanvasContextPayload } from '@/components/canvas/CanvasContextMenu'
import CanvasHud from '@/components/canvas/CanvasHud'
import { DEFAULT_IMAGE_MODEL } from '@/config/models'
import { useProjectsStore } from '@/store/projects'
import CanvasAssistantDrawer from '@/components/canvas/CanvasAssistantDrawer'
import NodeRemarkModal from '@/components/canvas/NodeRemarkModal'
import DownloadModal from '@/components/canvas/DownloadModal'
import HistoryPanel from '@/components/canvas/HistoryPanel'
import PromptLibraryModal from '@/components/canvas/PromptLibraryModal'
import { getNodeSize } from '@/graph/nodeSizing'
import { useSettingsStore } from '@/store/settings'
import { saveMedia } from '@/lib/mediaStorage'
import { ChevronDown, ChevronLeft, Download, History, Moon, Settings, Sun } from 'lucide-react'

// 功能开关
// USE_REACT_FLOW: 使用 React Flow（推荐，完全对齐 Huobao 架构）
// USE_DOM_CANVAS: 使用纯 DOM 画布
// USE_NEW_EVENT_SYSTEM: 使用新事件协调层（实验性）
const USE_REACT_FLOW = true   // 使用 React Flow（60fps 性能保证）
const USE_DOM_CANVAS = false  // 改为 false，使用 React Flow 代替
const USE_NEW_EVENT_SYSTEM = false
const USE_SPATIAL_INDEX = true

export default function Canvas() {
  const { id } = useParams()
  const location = useLocation()
  const nav = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isInteracting, setIsInteracting] = useState(false)
  const [transientViewport, setTransientViewport] = useState<Viewport | null>(null)
  const [tool, setTool] = useState<CanvasTool>('select')
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [spawnAt, setSpawnAt] = useState<{ x: number; y: number } | null>(null)
  const [ctxOpen, setCtxOpen] = useState(false)
  const [ctxPayload, setCtxPayload] = useState<CanvasContextPayload | null>(null)
  const [remarkNodeId, setRemarkNodeId] = useState<string | null>(null)
  const [downloadModalOpen, setDownloadModalOpen] = useState(false)
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false)
  const [promptLibraryOpen, setPromptLibraryOpen] = useState(false)

  // 新事件系统状态
  const [connectPreview, setConnectPreview] = useState<{ from: { x: number; y: number }; to: { x: number; y: number }; fromSide: 'left' | 'right'; toSide: 'left' | 'right' } | null>(null)
  const [selectBox, setSelectBox] = useState<{ start: { x: number; y: number }; current: { x: number; y: number } } | null>(null)
  const [alignGuide, setAlignGuide] = useState<{ x?: number; y?: number } | null>(null)
  const handledInitRef = useRef<string | null>(null)
  const transientViewportRef = useRef<Viewport | null>(null)
  const transientViewportRafRef = useRef<number>(0)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const clipboardRef = useRef<null | { nodes: { type: any; data: any; dx: number; dy: number }[]; edges: { si: number; ti: number; data: any }[] }>(null)

  const addNode = useGraphStore((s) => s.addNode)
  const setProjectId = useGraphStore((s) => s.setProjectId)
  const addEdge = useGraphStore((s) => s.addEdge)
  const setSelected = useGraphStore((s) => s.setSelected)
  const setSelection = useGraphStore((s) => s.setSelection)
  const removeNodes = useGraphStore((s) => s.removeNodes)
  const removeEdge = useGraphStore((s) => s.removeEdge)
  const projectId = useGraphStore((s) => s.projectId)
  // 不订阅 viewport，避免频繁缩放时触发整个 Canvas 重新渲染
  // 需要时通过 useGraphStore.getState().viewport 获取
  const undo = useGraphStore((s) => s.undo)
  const redo = useGraphStore((s) => s.redo)
  const setViewport = useGraphStore((s) => s.setViewport)

  // 撤销/重做状态订阅
  const { canUndo, canRedo } = useGraphStore(
    (s) => ({ canUndo: s.canUndo(), canRedo: s.canRedo() }),
    shallow
  )

  // 适应视图
  const handleFitView = useCallback(() => {
    const state = useGraphStore.getState()
    const nodes = state.nodes
    if (nodes.length === 0) return
    
    const wrap = canvasWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    
    // 计算所有节点的边界
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of nodes) {
      const { w, h } = getNodeSize(n.type)
      minX = Math.min(minX, n.x)
      minY = Math.min(minY, n.y)
      maxX = Math.max(maxX, n.x + w)
      maxY = Math.max(maxY, n.y + h)
    }
    
    const contentW = maxX - minX + 100
    const contentH = maxY - minY + 100
    const zoom = Math.min(rect.width / contentW, rect.height / contentH, 1)
    const x = (rect.width - contentW * zoom) / 2 - minX * zoom + 50 * zoom
    const y = (rect.height - contentH * zoom) / 2 - minY * zoom + 50 * zoom
    
    setViewport({ x, y, zoom })
  }, [setViewport])

  const projects = useProjectsStore((s) => s.projects)

  const dark = useSettingsStore((s) => s.dark)
  const toggleDark = useSettingsStore((s) => s.toggleDark)

  const projectName = useMemo(() => projects.find((p) => p.id === projectId)?.name || projectId, [projectId, projects])

  useEffect(() => {
    const pid = String(id || '').trim() || 'default'
    let cancelled = false
    void (async () => {
      await setProjectId(pid)
      if (cancelled) return
      const initialPrompt = String((location.state as any)?.initialPrompt || '').trim()
      if (!initialPrompt) return
      if (handledInitRef.current === pid) return

      handledInitRef.current = pid
      // 以“当前视口中心”为基准创建初始节点，避免固定坐标导致跑出可视区域
      const vp = useGraphStore.getState().viewport
      const wrap = canvasWrapRef.current
      const rect = wrap?.getBoundingClientRect()
      const z = vp.zoom || 1
      const center = rect
        ? { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
        : { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
      const { w: textW, h: textH } = getNodeSize('text')
      const { w: cfgW, h: cfgH } = getNodeSize('imageConfig')
      const cfgPos = { x: center.x - cfgW * 0.5, y: center.y - cfgH * 0.5 }
      const textPos = { x: cfgPos.x - 400, y: center.y - textH * 0.5 }
      useGraphStore.getState().withBatchUpdates(() => {
        const textId = addNode('text', textPos, { label: '提示词', content: initialPrompt })
        const cfgId = addNode('imageConfig', cfgPos, { label: '文生图', model: DEFAULT_IMAGE_MODEL, prompt: initialPrompt })
        addEdge(textId, cfgId, {})
        setSelected(cfgId)
      })
    })()
    return () => {
      cancelled = true
    }
  }, [id, setProjectId])

  useEffect(() => {
    return () => {
      if (transientViewportRafRef.current) cancelAnimationFrame(transientViewportRafRef.current)
    }
  }, [])

  useEffect(() => {
    if (!nodeMenuOpen) setSpawnAt(null)
  }, [nodeMenuOpen])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName || ''
      const selection = typeof window !== 'undefined' ? window.getSelection?.() : null
      const hasTextSelection = !!selection && !selection.isCollapsed && String(selection.toString() || '').trim().length > 0
      // 如果用户正在选择文本（例如 AI 助手消息、检查器等），不要劫持 ⌘C
      const editing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as any)?.isContentEditable || hasTextSelection
      const meta = e.metaKey || e.ctrlKey

      if (meta && !editing && (e.key === 'c' || e.key === 'C')) {
        const s = useGraphStore.getState()
        if (s.selectedNodeIds.length === 0) return
        e.preventDefault()
        const picked = s.nodes.filter((n) => s.selectedNodeIds.includes(n.id))
        if (picked.length === 0) return
        let x0 = Infinity
        let y0 = Infinity
        for (const n of picked) {
          x0 = Math.min(x0, n.x)
          y0 = Math.min(y0, n.y)
        }
        const idToIdx = new Map(picked.map((n, i) => [n.id, i]))
        const edges = s.edges
          .filter((ed) => idToIdx.has(ed.source) && idToIdx.has(ed.target))
          .map((ed) => ({ si: idToIdx.get(ed.source)!, ti: idToIdx.get(ed.target)!, data: ed.data ? { ...(ed.data as any) } : undefined }))
        clipboardRef.current = {
          nodes: picked.map((n) => ({ type: n.type, data: n.data ? { ...(n.data as any) } : {}, dx: n.x - x0, dy: n.y - y0 })),
          edges
        }
        return
      }

      if (meta && !editing && (e.key === 'v' || e.key === 'V')) {
        const clip = clipboardRef.current
        if (!clip || clip.nodes.length === 0) return
        e.preventDefault()
        const wrap = canvasWrapRef.current
        const vp = useGraphStore.getState().viewport
        const z = vp.zoom || 1
        let anchor = { x: 0, y: 0 }
        if (wrap) {
          const rect = wrap.getBoundingClientRect()
          anchor = { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
        } else {
          anchor = { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
        }
        const ids: string[] = []
        useGraphStore.getState().withBatchUpdates(() => {
          const created: string[] = []
          for (let i = 0; i < clip.nodes.length; i++) {
            const n = clip.nodes[i]
            const id = addNode(n.type, { x: anchor.x + n.dx + 36, y: anchor.y + n.dy + 36 }, { ...(n.data || {}) })
            created.push(id)
          }
          for (const e2 of clip.edges) {
            const sId = created[e2.si]
            const tId = created[e2.ti]
            if (!sId || !tId) continue
            addEdge(sId, tId, e2.data ? { ...(e2.data as any) } : undefined)
          }
          ids.push(...created)
        })
        if (ids.length > 0) setSelection(ids, ids[0])
        return
      }

      if (meta && !editing && (e.key === 'd' || e.key === 'D')) {
        const s = useGraphStore.getState()
        if (s.selectedNodeIds.length === 0) return
        e.preventDefault()
        const picked = s.nodes.filter((n) => s.selectedNodeIds.includes(n.id))
        if (picked.length === 0) return
        const ids: string[] = []
        useGraphStore.getState().withBatchUpdates(() => {
          for (const n of picked) {
            const id = addNode(n.type, { x: n.x + 36, y: n.y + 36 }, { ...(n.data as any) })
            ids.push(id)
          }
        })
        if (ids.length > 0) setSelection(ids, ids[0])
        return
      }

      if (meta && !editing && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault()
        const s = useGraphStore.getState()
        const ids = s.nodes.map((n) => n.id)
        setSelection(ids, s.selectedNodeId)
        return
      }

      if (!editing && (e.key === 'Backspace' || e.key === 'Delete')) {
        const s = useGraphStore.getState()
        if (s.selectedNodeIds.length > 0) {
          e.preventDefault()
          removeNodes(s.selectedNodeIds)
        } else if (s.selectedEdgeId) {
          e.preventDefault()
          removeEdge(s.selectedEdgeId)
        }
        return
      }

      if (meta && !editing && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) void redo()
        else void undo()
        return
      }

      if (meta && !editing && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault()
        void redo()
        return
      }

      if (meta && !editing && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setAssistantOpen((v) => !v)
        return
      }

      if (e.key === 'Escape') {
        setAssistantOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addEdge, addNode, redo, removeEdge, removeNodes, setSelection, undo])

  const onTransientViewportChange = useCallback((vp: Viewport | null) => {
    transientViewportRef.current = vp
    if (transientViewportRafRef.current) return
    transientViewportRafRef.current = requestAnimationFrame(() => {
      transientViewportRafRef.current = 0
      setTransientViewport(transientViewportRef.current)
    })
  }, [])

  // 不订阅 viewport，使用函数动态获取，避免频繁缩放时触发重新渲染
  const paletteSpawnAt = useMemo(() => {
    if (spawnAt) return spawnAt
    const vp = useGraphStore.getState().viewport
    const el = canvasWrapRef.current
    if (!el) {
      const z = vp.zoom || 1
      return { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
    }
    const rect = el.getBoundingClientRect()
    const z = vp.zoom || 1
    return { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
  }, [spawnAt]) // 只依赖 spawnAt，viewport 通过 getState 获取

  const addDroppedFiles = useCallback(
    async (files: File[], client: { x: number; y: number }) => {
      const wrap = canvasWrapRef.current
      if (!wrap) return
      const rect = wrap.getBoundingClientRect()
      const vp = useGraphStore.getState().viewport
      const z = vp.zoom || 1
      const local = { x: client.x - rect.left, y: client.y - rect.top }
      const dropWorld = { x: (local.x - vp.x) / z, y: (local.y - vp.y) / z }

      const state = useGraphStore.getState()
      const hit = state.nodes
        .slice()
        .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
        .reverse()
        .find((n) => {
          if (n.type !== 'imageConfig' && n.type !== 'videoConfig') return false
          const { w, h } = getNodeSize(n.type)
          return dropWorld.x >= n.x && dropWorld.x <= n.x + w && dropWorld.y >= n.y && dropWorld.y <= n.y + h
        })

      const fileToDataUrl = (file: File) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(new Error('read failed'))
          reader.onload = () => resolve(String(reader.result || ''))
          reader.readAsDataURL(file)
        })

      const pairs = await Promise.all(
        files.map(async (f) => ({
          file: f,
          dataUrl: await fileToDataUrl(f)
        }))
      )

      const persistQueue: Array<{ id: string; type: 'image' | 'video' | 'audio'; dataUrl: string }> = []

      useGraphStore.getState().withBatchUpdates(() => {
        const baseX = hit ? hit.x - 380 : dropWorld.x
        const baseY = hit ? hit.y : dropWorld.y
        const ids: string[] = []
        const roleTaken = new Set<string>()
        if (hit?.type === 'videoConfig') {
          const incoming = state.edges.filter((e) => e.target === hit.id)
          for (const e of incoming) {
            const r = String((e.data as any)?.imageRole || '').trim()
            if (r) roleTaken.add(r)
          }
        }

        for (let i = 0; i < pairs.length; i++) {
          const { file, dataUrl } = pairs[i]
          const kind = /^image\\//i.test(file.type) ? 'image' : /^audio\\//i.test(file.type) ? 'audio' : /^video\\//i.test(file.type) ? 'video' : null
          if (!kind) continue
          const label = kind === 'image' ? '上传图片' : kind === 'audio' ? '上传音频' : '上传视频'
          const id = addNode(kind, { x: baseX, y: baseY + i * 36 }, {
            label: file.name || label,
            url: dataUrl,
            // dataURL 不作为长期 source（跨重启用 mediaId 恢复）
            sourceUrl: '',
            fileName: file.name,
            fileType: file.type,
            createdAt: Date.now()
          })
          ids.push(id)
          persistQueue.push({ id, type: kind, dataUrl })

          if (hit && kind === 'image') {
            const data: Record<string, unknown> = { sourcePort: 'right', targetPort: 'left' }
            if (hit.type === 'videoConfig') {
              const hasFirst = roleTaken.has('first_frame_image')
              const hasLast = roleTaken.has('last_frame_image')
              const role = !hasFirst ? 'first_frame_image' : !hasLast ? 'last_frame_image' : 'input_reference'
              data.imageRole = role
              roleTaken.add(role)
            }
            addEdge(id, hit.id, data)
          }
        }

        if (ids.length > 0) setSelection(ids, ids[0])
      })

      // 写入 IndexedDB，确保刷新/重启后可恢复
      const pid = useGraphStore.getState().projectId || 'default'
      for (const item of persistQueue) {
        try {
          const mediaId = await saveMedia({
            nodeId: item.id,
            projectId: pid,
            type: item.type,
            data: item.dataUrl,
          })
          if (mediaId) {
            useGraphStore.getState().patchNodeDataSilent(item.id, { mediaId })
          }
        } catch {
          // ignore
        }
      }
    },
    [addEdge, addNode, setSelection]
  )

  return (
    <div className="h-full w-full bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="flex h-[72px] items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-secondary)] px-6 py-4">
        <div className="flex items-center gap-3">
          <button
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            onClick={() => nav('/')}
            title="返回"
          >
            <ChevronLeft className="h-[18px] w-[18px]" />
          </button>

          <button
            className="flex items-center gap-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
            onClick={() => {
              // TODO: 项目下拉菜单（重命名/复制/删除）
            }}
            title="项目"
          >
            <span className="max-w-[320px] truncate">{projectName}</span>
            <ChevronDown className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => toggleDark()}
            title="主题"
          >
            {dark ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setDownloadModalOpen(true)}
            title="批量下载"
          >
            <Download className="h-[18px] w-[18px]" />
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setHistoryPanelOpen((v) => !v)}
            title="历史素材"
          >
            <History className="h-[18px] w-[18px]" />
          </button>
          <button
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-color)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            onClick={() => setSettingsOpen(true)}
            title="API 设置"
          >
            <Settings className="h-[18px] w-[18px]" />
          </button>
        </div>
      </header>

      <div className="h-[calc(100%-72px)] w-full p-4">
        <div
          ref={canvasWrapRef}
          data-canvas-wrap="1"
          className="relative h-full w-full bg-[var(--bg-primary)]"
          onDragOver={(e) => {
            e.preventDefault()
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer?.files || []).filter((f) => /^(image|audio|video)\\//i.test(f.type))
            if (files.length > 0) {
              e.preventDefault()
              void addDroppedFiles(files, { x: e.clientX, y: e.clientY })
              return
            }

            const raw = e.dataTransfer?.getData('application/json') || ''
            if (!raw) return
            try {
              const asset = JSON.parse(raw)
              const src = String(asset?.src || asset?.url || '').trim()
              const type = String(asset?.type || '').trim()
              if (!src || !type) return
              const kind = type === 'video' ? 'video' : type === 'audio' ? 'audio' : type === 'image' ? 'image' : null
              if (!kind) return
              e.preventDefault()
              const wrap = canvasWrapRef.current
              const rect = wrap?.getBoundingClientRect()
              const vp = useGraphStore.getState().viewport
              const z = vp.zoom || 1
              const local = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : { x: 0, y: 0 }
              const world = { x: (local.x - vp.x) / z, y: (local.y - vp.y) / z }
              const id = addNode(kind, { x: world.x - 120, y: world.y - 80 }, {
                label: String(asset?.title || asset?.label || '').trim() || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'),
                url: src,
                sourceUrl: src,
                model: String(asset?.model || '').trim(),
                duration: asset?.duration,
                createdAt: Date.now()
              })
              setSelected(id)
            } catch {
              // ignore
            }
          }}
        >
          <div className="canvas-layer absolute inset-0">
            {USE_REACT_FLOW ? (
            // React Flow 模式（完全对齐 Huobao/Vue Flow 架构，60fps 性能保证）
            <ReactFlowCanvas
              onContextMenu={(payload: CanvasContextPayload) => {
                setCtxPayload(payload)
                setCtxOpen(true)
              }}
            />
          ) : USE_DOM_CANVAS ? (
            // 高性能 DOM 画布模式
            <DOMGraphCanvas
              onInteractingChange={setIsInteracting}
              onTransientViewportChange={onTransientViewportChange}
              onContextMenu={(payload: CanvasContextPayload) => {
                setCtxPayload(payload)
                setCtxOpen(true)
              }}
            >
              <NodeCardsLayer viewportOverride={transientViewport} />
            </DOMGraphCanvas>
          ) : USE_NEW_EVENT_SYSTEM ? (
            // 新事件系统：EventCoordinator 包裹所有层
            <EventCoordinator
              tool={tool}
              connectMode={tool === 'connect'}
              onInteractingChange={setIsInteracting}
              onTransientViewportChange={onTransientViewportChange}
              onConnectPreviewChange={setConnectPreview}
              onSelectBoxChange={setSelectBox}
              onAlignGuideChange={setAlignGuide}
              onRequestAddNode={(pos) => setSpawnAt(pos)}
              onContextMenu={(payload) => {
                setCtxPayload(payload)
                setCtxOpen(true)
              }}
            >
              <WebGLGraphCanvas
                tool={tool}
                connectMode={tool === 'connect'}
                useExternalEvents={true}
                externalConnectPreview={connectPreview}
                externalSelectBox={selectBox}
                externalAlignGuide={alignGuide}
                externalIsInteracting={isInteracting}
                externalViewport={transientViewport}
              />
              <EdgeOverlayLayer isInteracting={isInteracting} viewportOverride={transientViewport} />
              <NodeCardsLayer viewportOverride={transientViewport} />
            </EventCoordinator>
          ) : (
            // 原有 WebGL 事件系统
            <>
              <WebGLGraphCanvas
                tool={tool}
                connectMode={tool === 'connect'}
                onInteractingChange={setIsInteracting}
                onTransientViewportChange={onTransientViewportChange}
                onRequestAddNode={(pos) => setSpawnAt(pos)}
                onContextMenu={(payload) => {
                  setCtxPayload(payload)
                  setCtxOpen(true)
                }}
              />
              <EdgeOverlayLayer isInteracting={isInteracting} viewportOverride={transientViewport} />
              <NodeCardsLayer viewportOverride={transientViewport} />
            </>
          )}
          </div>

          <div className="ui-layer absolute inset-0">
            <CanvasSidebar
              activeTool={tool}
              nodeMenuOpen={nodeMenuOpen}
              onChangeTool={(next) => {
                setTool(next)
                setNodeMenuOpen(false)
              }}
              onToggleNodeMenu={() => {
                // 在打开菜单时计算当前视口中心位置
                const vp = useGraphStore.getState().viewport
                const el = canvasWrapRef.current
                if (el) {
                  const rect = el.getBoundingClientRect()
                  const z = vp.zoom || 1
                  const centerX = (rect.width * 0.5 - vp.x) / z
                  const centerY = (rect.height * 0.5 - vp.y) / z
                  setSpawnAt({ x: centerX, y: centerY })
                }
                setNodeMenuOpen((v) => !v)
              }}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
              onOpenPromptLibrary={() => setPromptLibraryOpen(true)}
            />

            {/* CanvasHud 在 React Flow / DOM 画布模式下禁用，因为它订阅 viewport 会导致性能问题 */}
            {/* React Flow 和 DOMGraphCanvas 已经内置了小地图，缩放控制通过 wheel 事件实现 */}
            {!USE_REACT_FLOW && !USE_DOM_CANVAS && <CanvasHud containerRef={canvasWrapRef} />}

            {nodeMenuOpen ? (
              <div className="pointer-events-auto absolute left-20 top-56 z-30">
                <NodePalettePanel
                  spawnAt={paletteSpawnAt}
                  onSpawned={() => setSpawnAt(null)}
                  onClose={() => {
                    setNodeMenuOpen(false)
                    setSpawnAt(null)
                  }}
                />
              </div>
            ) : null}

            <CanvasAssistantDrawer open={assistantOpen} onOpenChange={setAssistantOpen} onOpenSettings={() => setSettingsOpen(true)} />

            <CanvasContextMenu
              open={ctxOpen}
              payload={ctxPayload}
              onRequestEditRemark={(nodeId) => setRemarkNodeId(String(nodeId || '').trim() || null)}
              onOpenChange={(v) => {
                setCtxOpen(v)
                if (!v) setCtxPayload(null)
              }}
            />

            <NodeRemarkModal open={remarkNodeId != null} nodeId={remarkNodeId} onClose={() => setRemarkNodeId(null)} />

          </div>

          <div className="canvas-frame pointer-events-none absolute inset-0 rounded-[24px] border border-[var(--border-color)]" />
        </div>
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      
      <DownloadModal 
        open={downloadModalOpen} 
        onClose={() => setDownloadModalOpen(false)} 
        nodes={useGraphStore.getState().nodes}
      />
      
      <PromptLibraryModal
        open={promptLibraryOpen}
        onClose={() => setPromptLibraryOpen(false)}
        onInsert={(text) => {
          // 插入提示词到剪贴板，用户可以粘贴到任何地方
          navigator.clipboard.writeText(text).then(() => {
            window.$message?.success?.('已复制到剪贴板')
          }).catch(() => {
            window.$message?.error?.('复制失败')
          })
        }}
      />
      
      {historyPanelOpen && (
        <div className="fixed right-0 top-0 z-40 h-full">
          <HistoryPanel 
            onClose={() => setHistoryPanelOpen(false)}
            onAddToCanvas={(asset) => {
              const vp = useGraphStore.getState().viewport
              const wrap = canvasWrapRef.current
              const rect = wrap?.getBoundingClientRect()
              const z = vp.zoom || 1
              const center = rect
                ? { x: (rect.width * 0.5 - vp.x) / z, y: (rect.height * 0.5 - vp.y) / z }
                : { x: (-vp.x + 600) / z, y: (-vp.y + 360) / z }
              const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image'
              const id = addNode(kind, { x: center.x - 120, y: center.y - 80 }, {
                label: asset.title || (kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '图片'),
                url: asset.src,
                sourceUrl: asset.src,
                model: asset.model,
                duration: asset.duration,
                createdAt: Date.now()
              })
              setSelected(id)
            }}
          />
        </div>
      )}
    </div>
  )
}
