/**
 * VideoConfigNodeFlow - React Flow 版本的视频配置节点
 * 完全对齐 Vue 版本 VideoConfigNode.vue 实现
 */
import React, { memo, useState, useCallback, useRef, useEffect } from 'react'
import { Handle, Position, NodeProps } from '@xyflow/react'
import { Trash2, Copy, Expand, Video } from 'lucide-react'
import { useGraphStore } from '@/graph/store'
import { generateVideoFromConfigNode } from '@/lib/workflow/video'
import { DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from '@/config/models'

// 模型选项
const MODEL_OPTIONS = VIDEO_MODELS.map((m: any) => ({ key: m.key, label: m.label }))

// 获取模型配置
const getModelConfig = (modelKey: string) => {
  return VIDEO_MODELS.find((m: any) => m.key === modelKey) || VIDEO_MODELS[0]
}

// 获取模型的比例选项
const getModelRatioOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  const ratios = config?.ratios || ['16:9', '9:16']
  return ratios.map((r: string) => ({ key: r, label: r }))
}

// 获取模型的时长选项
const getModelDurationOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  const durs = config?.durs || [{ label: '5 秒', key: 5 }]
  return durs
}

// 获取模型的尺寸选项（如 Sora）
const getModelSizeOptions = (modelKey: string) => {
  const config = getModelConfig(modelKey) as any
  return config?.sizes || []
}

interface VideoConfigNodeData {
  label?: string
  model?: string
  ratio?: string
  dur?: number
  size?: string
  loopCount?: number  // 循环生成次数，默认 1
}

export const VideoConfigNodeComponent = memo(function VideoConfigNode({ id, data, selected }: NodeProps) {
  const nodeData = data as VideoConfigNodeData
  const [showActions, setShowActions] = useState(false)
  const [model, setModel] = useState(nodeData?.model || DEFAULT_VIDEO_MODEL)
  const [ratio, setRatio] = useState(nodeData?.ratio || '16:9')
  const [duration, setDuration] = useState(nodeData?.dur || 5)
  const [size, setSize] = useState(nodeData?.size || '')
  const [loopCount, setLoopCount] = useState(nodeData?.loopCount || 1) // 循环次数，默认 1
  const [loading, setLoading] = useState(false)
  
  const updateTimerRef = useRef<number>(0)
  const initializedRef = useRef(false)
  
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
  const ratioOptions = getModelRatioOptions(model)
  const durationOptions = getModelDurationOptions(model)
  const sizeOptions = getModelSizeOptions(model)
  const hasSizeOptions = sizeOptions.length > 0

  // 初始化：保证 store 上的 model/ratio/dur/size 与 UI 一致（避免“UI 选 Veo，实际走 Sora”）
  useEffect(() => {
    if (initializedRef.current) return
    initializedRef.current = true

    const store = useGraphStore.getState()
    const current = store.nodes.find((n) => n.id === id)?.data as any
    const storedModel = String(current?.model || '').trim()
    if (storedModel) return

    const baseModelCfg: any = (VIDEO_MODELS as any[]).find((m: any) => m.key === DEFAULT_VIDEO_MODEL) || (VIDEO_MODELS as any[])[0]
    store.updateNode(id, { data: { 
      model: DEFAULT_VIDEO_MODEL,
      ratio: baseModelCfg?.defaultParams?.ratio,
      dur: baseModelCfg?.defaultParams?.duration,
      size: baseModelCfg?.defaultParams?.size,
    } } as any)
  }, [id])

  // 外部数据变化（store→ReactFlow→props）时，同步回本地 UI state
  useEffect(() => {
    const nextModel = String(nodeData?.model || DEFAULT_VIDEO_MODEL)
    if (nextModel && nextModel !== model) setModel(nextModel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.model, id])

  useEffect(() => {
    const nextRatio = String(nodeData?.ratio || '')
    if (nextRatio && nextRatio !== ratio) setRatio(nextRatio)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.ratio, id])

  useEffect(() => {
    const nextDur = Number((nodeData as any)?.dur ?? (nodeData as any)?.duration ?? 0)
    if (Number.isFinite(nextDur) && nextDur > 0 && nextDur !== duration) setDuration(nextDur)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(nodeData as any)?.dur, (nodeData as any)?.duration, id])

  useEffect(() => {
    const nextSize = String(nodeData?.size || '')
    if (nextSize && nextSize !== size) setSize(nextSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeData?.size, id])

  // 按需计算连接状态
  const getConnectionStatus = useCallback(() => {
    const state = useGraphStore.getState()
    const incomingEdges = state.edges.filter((e) => e.target === id)
    let prompts = 0
    let firstFrame = false
    let lastFrame = false
    let refs = 0

    for (const edge of incomingEdges) {
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'text' && sourceNode.data?.content) {
        prompts++
      }
      if (sourceNode?.type === 'image' && sourceNode.data?.url) {
        const role = (edge.data as any)?.imageRole || 'first_frame_image'
        if (role === 'first_frame_image' && !firstFrame) firstFrame = true
        else if (role === 'last_frame_image' && !lastFrame) lastFrame = true
        else refs++
      }
    }
    return { prompts, firstFrame, lastFrame, refs }
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
      store.addNode('videoConfig', { x: node.x + 50, y: node.y + 50 }, { ...node.data })
    }
  }, [id])

  const handleGenerate = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    console.log('[VideoConfigNode] handleGenerate 被调用, nodeId:', id, 'model:', model, 'ratio:', ratio, 'duration:', duration, 'size:', size, 'loopCount:', loopCount)
    
    const status = getConnectionStatus()
    console.log('[VideoConfigNode] 连接状态:', status)
    
    if (status.prompts === 0 && !status.firstFrame && !status.lastFrame && status.refs === 0) {
      console.warn('[VideoConfigNode] 无输入连接，退出生成')
      window.$message?.warning?.('请连接文本节点（提示词）或图片节点（首帧/尾帧）')
      return
    }

    setLoading(true)
    console.log('[VideoConfigNode] 开始生成视频...')
    
    try {
      // 生成前强制同步当前 UI 选择到 store（用于持久化）
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
      useGraphStore.getState().updateNode(id, { data: { model, ratio, dur: duration, size, loopCount } } as any)
      
      // 循环生成（每次都创建新节点）
      const actualLoopCount = Math.max(1, Math.min(10, loopCount)) // 限制 1-10 次
      
      for (let i = 0; i < actualLoopCount; i++) {
        if (actualLoopCount > 1) {
          window.$message?.info?.(`正在生成第 ${i + 1}/${actualLoopCount} 个视频...`)
        }
        // 直接传递参数到生成函数，彻底避免异步同步问题
        await generateVideoFromConfigNode(id, { model, ratio, duration, size })
      }
      
      console.log('[VideoConfigNode] 视频生成成功')
      if (actualLoopCount > 1) {
        window.$message?.success?.(`成功生成 ${actualLoopCount} 个视频`)
      } else {
        window.$message?.success?.('视频生成成功')
      }
    } catch (err: any) {
      console.error('[VideoConfigNode] 生成失败:', err)
      console.error('[VideoConfigNode] 错误详情:', {
        message: err?.message,
        name: err?.name,
        stack: err?.stack
      })
      // 提取并显示友好的错误消息
      let friendlyMsg = err?.message || '视频生成失败'
      // 处理常见的后端错误
      if (friendlyMsg.includes('负载已饱和') || friendlyMsg.includes('稍后再试')) {
        friendlyMsg = '服务器繁忙，请稍后重试'
      } else if (friendlyMsg.includes('HTTP 500')) {
        friendlyMsg = '服务器内部错误，请稍后重试'
      } else if (friendlyMsg.includes('Failed to fetch') || friendlyMsg.includes('NetworkError')) {
        friendlyMsg = '网络连接失败，请检查网络'
      }
      window.$message?.error?.(friendlyMsg)
    } finally {
      setLoading(false)
    }
  }, [id, model, ratio, duration, size, loopCount, getConnectionStatus])

  // 更新 store 的辅助函数
  const debouncedUpdateStore = useCallback((updates: Record<string, any>) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      useGraphStore.getState().updateNode(id, { data: updates })
    }, 300)
  }, [id])

  return (
    <div
      className="relative pt-[20px]"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* 节点主体 */}
      <div
        className={`video-config-node bg-[var(--bg-secondary)] rounded-xl border min-w-[320px] relative transition-all duration-200 ${
          selected ? 'border-blue-500 shadow-lg shadow-blue-500/20' : 'border-[var(--border-color)]'
        }`}
      >
        {/* 头部 */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-color)]">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {nodeData?.label || '视频生成'}
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
                if (config?.defaultParams?.ratio) setRatio(config.defaultParams.ratio)
                if (config?.defaultParams?.duration) setDuration(config.defaultParams.duration)
                if (config?.sizes?.length > 0) {
                  const defaultSize = config.defaultParams?.size || config.sizes[0]?.key
                  setSize(defaultSize)
                }
                debouncedUpdateStore({ 
                  model: newModel, 
                  ratio: config?.defaultParams?.ratio,
                  dur: config?.defaultParams?.duration,
                  size: config?.sizes?.length > 0 ? (config.defaultParams?.size || config.sizes[0]?.key) : ''
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

          {/* 比例选择 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">比例</span>
            <select
              value={ratio}
              onChange={(e) => {
                const newRatio = e.target.value
                setRatio(newRatio)
                debouncedUpdateStore({ ratio: newRatio })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
            >
              {ratioOptions.map((opt: any) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 尺寸选择（Sora 等模型需要） */}
          {hasSizeOptions && (
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
          )}

          {/* 时长选择 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">时长</span>
            <select
              value={duration}
              onChange={(e) => {
                const newDur = Number(e.target.value)
                setDuration(newDur)
                debouncedUpdateStore({ dur: newDur })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
            >
              {durationOptions.map((opt: any) => (
                <option key={opt.key} value={opt.key}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 循环次数 */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-secondary)]">循环次数</span>
            <select
              value={loopCount}
              onChange={(e) => {
                const newCount = parseInt(e.target.value, 10)
                setLoopCount(newCount)
                debouncedUpdateStore({ loopCount: newCount })
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="nodrag text-sm bg-transparent border border-[var(--border-color)] rounded px-2 py-1 outline-none"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <option key={n} value={n}>{n} 次</option>
              ))}
            </select>
          </div>

          {/* 连接输入指示 */}
          <ConnectionStatusIndicator nodeId={id} />

          {/* 生成按钮 - 允许多次点击 */}
          <button
            onClick={handleGenerate}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-[var(--accent-color)] hover:opacity-90 text-white text-sm font-medium"
          >
            {loading ? <span className="animate-spin">⟳</span> : <Video size={16} />}
            {loading ? '重新生成' : '生成视频'}
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
            className="group p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 flex items-center gap-0 hover:gap-1.5 transition-all shadow-sm w-max"
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

// 连接状态指示器组件 - 订阅 store 实时更新
const ConnectionStatusIndicator = memo(function ConnectionStatusIndicator({ 
  nodeId 
}: { 
  nodeId: string 
}) {
  // 订阅 store 的 edges 变化
  const status = useGraphStore((state) => {
    const incomingEdges = state.edges.filter((e) => e.target === nodeId)
    let prompts = 0
    let firstFrame = false
    let lastFrame = false
    let refs = 0

    for (const edge of incomingEdges) {
      const sourceNode = state.nodes.find((n) => n.id === edge.source)
      if (sourceNode?.type === 'text' && (sourceNode.data as any)?.content) {
        prompts++
      }
      if (sourceNode?.type === 'image' && (sourceNode.data as any)?.url) {
        const role = (edge.data as any)?.imageRole || 'first_frame_image'
        if (role === 'first_frame_image') {
          if (!firstFrame) firstFrame = true
          else refs++ // 多余的首帧算作参考图
        } else if (role === 'last_frame_image') {
          if (!lastFrame) lastFrame = true
          else refs++ // 多余的尾帧算作参考图
        } else {
          refs++
        }
      }
    }
    return { prompts, firstFrame, lastFrame, refs }
  })

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)] py-2 border-t border-[var(--border-color)]">
      <span className={`px-2 py-0.5 rounded-full ${
        status.prompts > 0 
          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' 
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
      }`}>
        提示词 {status.prompts > 0 ? '✓' : '○'}
      </span>
      <span className={`px-2 py-0.5 rounded-full ${
        status.firstFrame 
          ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' 
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
      }`}>
        首帧 {status.firstFrame ? '✓' : '○'}
      </span>
      <span className={`px-2 py-0.5 rounded-full ${
        status.lastFrame 
          ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' 
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
      }`}>
        尾帧 {status.lastFrame ? '✓' : '○'}
      </span>
      <span className={`px-2 py-0.5 rounded-full ${
        status.refs > 0
          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' 
          : 'bg-gray-100 text-gray-500 dark:bg-gray-800'
      }`}>
        参考图 {status.refs > 0 ? `✓ ${status.refs}` : '○'}
      </span>
    </div>
  )
})
