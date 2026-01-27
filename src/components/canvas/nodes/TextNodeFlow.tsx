/**
 * TextNodeFlow - React Flow 版本的文本节点
 * 完全对齐 Huobao 的 TextNode.vue 实现
 * 
 * 性能优化：
 * 1. 使用 useRef 存储内容，避免每次输入都重渲染
 * 2. 只在 blur 时同步到 store
 * 3. 完全避免订阅 store
 */
import React, { memo, useState, useCallback, useRef } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Copy, Trash2, ImageIcon, Video, Expand } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { DEFAULT_IMAGE_MODEL, DEFAULT_VIDEO_MODEL, IMAGE_MODELS, VIDEO_MODELS } from '@/config/models'

interface TextNodeData {
  content?: string
  label?: string
}

export const TextNodeComponent = memo(function TextNode({ id, data, selected }: NodeProps) {
  const nodeData = data as TextNodeData
  // 使用 ref 存储内容，避免每次输入都触发重渲染
  const contentRef = useRef(nodeData?.content || '')
  const [displayContent, setDisplayContent] = useState(nodeData?.content || '')
  const [showActions, setShowActions] = useState(false)

  // 更新内容到 store（只在 blur 时）
  const handleBlur = useCallback(() => {
    // 使用 setTimeout 延迟执行，避免阻塞 UI
    setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: { content: contentRef.current } })
    }, 0)
  }, [id])

  // 删除节点
  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  // 复制节点
  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('text', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  // 生成图片
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
          label: '文生图',
          model: DEFAULT_IMAGE_MODEL,
          size: baseModelCfg?.defaultParams?.size,
          quality: baseModelCfg?.defaultParams?.quality,
        }
      )
      store.addEdge(id, newNodeId, { sourceHandle: 'right', targetHandle: 'left' })
    }
  }, [id])

  // 生成视频
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
    <div 
      className="relative pr-[50px] pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`text-node bg-[var(--bg-secondary)] rounded-xl border min-w-[280px] max-w-[350px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {nodeData?.label || '文本'}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={handleDelete}
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              title="删除"
            >
              <Trash2 size={14} />
            </button>
            <button
              className="p-1 hover:bg-[var(--bg-tertiary)] rounded transition-colors"
              title="展开"
            >
              <Expand size={14} />
            </button>
          </div>
        </div>

        {/* 内容 */}
        <div className="p-3">
          <textarea
            value={displayContent}
            onChange={(e) => {
              const val = e.target.value
              contentRef.current = val
              setDisplayContent(val)
            }}
            onBlur={handleBlur}
            onMouseDown={(e) => e.stopPropagation()}
            onWheel={(e) => e.stopPropagation()}
            className="nodrag nowheel w-full bg-transparent resize-none outline-none text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] min-h-[80px]"
            placeholder="请输入文本内容..."
          />
          <button
            disabled={!displayContent.trim()}
            className="mt-2 px-3 py-1.5 text-xs rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--accent-color)] hover:text-white border border-[var(--border-color)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
          >
            <span>✨</span>
            AI 润色
          </button>
        </div>

        {/* 连接点 */}
        <Handle type="source" position={Position.Right} id="right" />
        <Handle type="target" position={Position.Left} id="left" />
      </div>

      {/* 悬浮操作按钮 - 复制（右上角偏左，与 Vue 版本一致） */}
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

      {/* 右侧操作按钮（与 Vue 版本一致：right-10 + translate-x-full） */}
      {showActions && (
        <div className="absolute right-10 top-1/2 -translate-y-1/2 translate-x-full flex flex-col gap-2 z-[1000]">
          <button
            onClick={handleImageGen}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
          >
            <ImageIcon size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[80px] transition-all duration-200 whitespace-nowrap">
              图片生成
            </span>
          </button>
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
    </div>
  )
})
