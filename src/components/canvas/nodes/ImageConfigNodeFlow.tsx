/**
 * ImageConfigNodeFlow - React Flow 版本的文生图配置节点
 * 完全对齐 Vue 版本 ImageConfigNode.vue 实现
 * 
 * 性能优化 - 完全不订阅 store，只使用 getState() 按需获取
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Copy, Trash2, Expand } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { generateImageFromConfigNode } from '@/lib/workflow/image'
import { IMAGE_MODELS } from '@/config/models'

// 默认图片模型
const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0]?.key || 'gemini-3-pro-image-preview'

// 模型选项
const MODEL_OPTIONS = IMAGE_MODELS.map((m: any) => ({ key: m.key, label: m.label }))

// 验证模型是否有效（存在于选项列表中）
const VALID_MODEL_KEYS = new Set(IMAGE_MODELS.map((m: any) => m.key))
const getValidModel = (modelKey: string | undefined): string => {
  if (modelKey && VALID_MODEL_KEYS.has(modelKey)) {
    return modelKey
  }
  return DEFAULT_IMAGE_MODEL
}

// 获取模型配置
const getModelConfig = (modelKey: string) => {
  return IMAGE_MODELS.find((m: any) => m.key === modelKey) || IMAGE_MODELS[0]
}

// 获取模型的尺寸选项
const getModelSizeOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  const sizes = config?.sizes || ['1:1', '16:9', '9:16', '4:3', '3:4']
  return sizes.map((s: any) => typeof s === 'string' ? { key: s, label: s } : { key: s.key, label: s.label })
}

// 获取模型的画质选项
const getModelQualityOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  return config?.qualities || []
}

interface ImageConfigNodeData {
  label?: string
  model?: string
  size?: string
  quality?: string
  autoExecute?: boolean
}

export const ImageConfigNodeComponent = memo(function ImageConfigNode({ id, data, selected }: NodeProps) {
  const nodeData = data as ImageConfigNodeData
  const [showActions, setShowActions] = useState(false)
  // 使用 getValidModel 确保模型值有效，防止 UI 与内部状态不一致
  const [model, setModel] = useState(() => getValidModel(nodeData?.model))
  
  const [size, setSize] = useState(nodeData?.size || '3:4') // 默认 3:4 竖版
  const [quality, setQuality] = useState(nodeData?.quality || '')
  const [loading, setLoading] = useState(false)
  const autoExecuteTriggered = useRef(false)
  
  const updateTimerRef = useRef<number>(0)
  
  // 清理定时器（防止内存泄漏）
  useEffect(() => {
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current)
        updateTimerRef.current = 0
      }
    }
  }, [])
  
  // 获取当前模型配置
  const currentModelConfig = getModelConfig(model) as any
  const sizeOptions = getModelSizeOptions(model)
  const qualityOptions = getModelQualityOptions(model)
  const hasQualityOptions = qualityOptions.length > 0
  
  // 按需计算连接状态
  const getConnectionStatus = useCallback(() => {
    const state = useGraphStore.getState()
    const incomingEdges = state.edges.filter((e) => e.target === id)
    let prompts = 0
    let images = 0

    for (const edge of incomingEdges) {
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'text' && sourceNode.data?.content) {
        prompts++
      }
      if (sourceNode?.type === 'image' && sourceNode.data?.url) {
        images++
      }
    }
    return { prompts, images }
  }, [id])

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    useGraphStore.getState().removeNode(id)
  }, [id])

  const handleDuplicate = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const store = useGraphStore.getState()
    const node = store.nodes.find((n) => n.id === id)
    if (node) {
      store.addNode('imageConfig', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleGenerate = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    console.log('[ImageConfigNode] handleGenerate 被调用, nodeId:', id, 'model:', model, 'size:', size, 'quality:', quality)
    
    const status = getConnectionStatus()
    if (status.prompts === 0 && status.images === 0) {
      window.$message?.warning?.('请连接文本节点（提示词）或图片节点（参考图）')
      return
    }

    setLoading(true)
    
    try {
      // 生成前强制同步当前 UI 选择到 store（用于持久化）
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
      useGraphStore.getState().updateNode(id, { data: { model, size, quality } })
      
      // 直接传递参数到生成函数，彻底避免异步同步问题
      await generateImageFromConfigNode(id, { model, size, quality })
      window.$message?.success?.('图片生成成功')
    } catch (err: any) {
      window.$message?.error?.(err?.message || '图片生成失败')
      console.error('[ImageConfigNode] 生成失败:', err)
    } finally {
      setLoading(false)
    }
  }, [id, model, size, quality, getConnectionStatus])

  // 更新 store 的辅助函数
  const debouncedUpdateStore = useCallback((updates: Record<string, any>) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: updates })
    }, 300)
  }, [id])

  // 自动执行逻辑：当 autoExecute 为 true 时自动生成图片
  useEffect(() => {
    if (nodeData?.autoExecute && !autoExecuteTriggered.current && !loading) {
      autoExecuteTriggered.current = true
      // 清除 autoExecute 标志，防止重复触发
      useGraphStore.getState().updateNode(id, { data: { autoExecute: false } })
      
      // 延迟执行，确保节点连接已建立
      const timer = setTimeout(async () => {
        const status = getConnectionStatus()
        if (status.prompts > 0 || status.images > 0) {
          setLoading(true)
          try {
            // 直接传递参数到生成函数
            await generateImageFromConfigNode(id, { model, size, quality })
            console.log('[ImageConfigNode] 自动执行成功')
          } catch (err: any) {
            console.error('[ImageConfigNode] 自动执行失败:', err)
            window.$message?.error?.(err?.message || '自动生成失败')
          } finally {
            setLoading(false)
          }
        } else {
          console.warn('[ImageConfigNode] 自动执行跳过：没有连接的提示词或参考图')
        }
      }, 500) // 延迟 500ms 确保连接建立
      
      return () => clearTimeout(timer)
    }
  }, [nodeData?.autoExecute, id, model, size, quality, loading, getConnectionStatus])

  return (
    <div 
      className="relative pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`image-config-node bg-[var(--bg-secondary)] rounded-xl border min-w-[320px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {nodeData?.label || '文生图'}
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

        {/* 配置选项 */}
        <div className="p-3 space-y-3">
          {/* 模型选择 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">模型</span>
            <select
              value={model}
              onChange={(e) => {
                const newModel = e.target.value
                setModel(newModel)
                const config = getModelConfig(newModel) as any
                // 更新默认值
                if (config?.defaultParams?.size) setSize(config.defaultParams.size)
                if (config?.defaultParams?.quality) setQuality(config.defaultParams.quality)
                debouncedUpdateStore({ 
                  model: newModel,
                  size: config?.defaultParams?.size,
                  quality: config?.defaultParams?.quality
                })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none max-w-[180px]"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 画质选择 */}
          {hasQualityOptions && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--text-secondary)]">画质</span>
              <select
                value={quality}
                onChange={(e) => {
                  const newQuality = e.target.value
                  setQuality(newQuality)
                  debouncedUpdateStore({ quality: newQuality })
                }}
                onMouseDown={(e) => e.stopPropagation()}
                className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
              >
                {qualityOptions.map((opt: any) => (
                  <option key={opt.key} value={opt.key}>{opt.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* 尺寸选择 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">尺寸</span>
            <select
              value={size}
              onChange={(e) => {
                const newSize = e.target.value
                setSize(newSize)
                debouncedUpdateStore({ size: newSize })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
            >
              {sizeOptions.map((opt: any) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 模型提示 */}
          {currentModelConfig?.tips && (
            <div className="text-xs text-[var(--text-tertiary)] bg-[var(--bg-tertiary)] rounded px-2 py-1">
              {currentModelConfig.tips}
            </div>
          )}

          {/* 连接输入指示 */}
          <ConnectionStatusIndicator getConnectionStatus={getConnectionStatus} />

          {/* 生成按钮 */}
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--accent-color)] hover:opacity-90 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <span className="animate-spin">⟳</span> : <span>◆</span>}
            {loading ? '生成中...' : '立即生成'}
          </button>
        </div>

        {/* 连接点 */}
        <Handle type="target" position={Position.Left} id="left" />
        <Handle type="source" position={Position.Right} id="right" />
      </div>

      {/* 悬浮复制按钮 */}
      {showActions && (
        <div className="absolute -top-5 right-0 z-[1000]">
          <button
            onClick={handleDuplicate}
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 shadow-sm w-max"
          >
            <Copy size={16} className="text-gray-600 dark:text-gray-300" />
            <span className="text-xs text-gray-600 dark:text-gray-300 max-w-0 overflow-hidden group-hover:max-w-[60px] transition-all duration-200 whitespace-nowrap">
              复制
            </span>
          </button>
        </div>
      )}
    </div>
  )
})

// 连接状态指示器组件
const ConnectionStatusIndicator = memo(function ConnectionStatusIndicator({ 
  getConnectionStatus 
}: { 
  getConnectionStatus: () => { prompts: number; images: number } 
}) {
  const [status, setStatus] = useState(() => getConnectionStatus())
  
  // 订阅边和节点数据的变化以更新状态
  useEffect(() => {
    // 初始化时更新一次
    setStatus(getConnectionStatus())
    
    // 订阅 store 变化（边或节点数据变化时更新）
    const unsubscribe = useGraphStore.subscribe(
      (state, prevState) => {
        // 边变化时更新
        if (state.edges !== prevState.edges) {
          setStatus(getConnectionStatus())
          return
        }
        // 节点数据变化时也需要更新（检查 content 变化）
        if (state.nodes !== prevState.nodes) {
          // 检查是否有文本节点的 content 变化
          const hasContentChange = state.nodes.some((node, idx) => {
            const prevNode = prevState.nodes[idx]
            if (!prevNode || node.type !== 'text') return false
            return (node.data as any)?.content !== (prevNode.data as any)?.content
          })
          if (hasContentChange) {
            setStatus(getConnectionStatus())
          }
        }
      }
    )
    return unsubscribe
  }, [getConnectionStatus])

  return (
    <div 
      className="text-xs text-[var(--text-secondary)] py-2 border-t border-[var(--border-color)]"
    >
      <div className="mb-1.5 opacity-70">支持多张参考图 + 提示词（最多 14 张参考图）</div>
      <div className="flex items-center gap-2">
        <span className={`px-2 py-0.5 rounded-full ${
          status.prompts > 0 
            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
        }`}>
          提示词 {status.prompts > 0 ? '✓' : '○'}
        </span>
        <span className={`px-2 py-0.5 rounded-full ${
          status.images > 0 
            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' 
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
        }`}>
          参考图 {status.images > 0 ? `${status.images}张` : '○'}
        </span>
      </div>
    </div>
  )
})
