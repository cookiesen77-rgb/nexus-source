/**
 * Director Console | 导演台组件
 * 分镜规划 + 自动生成节点
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { streamChatCompletions } from '@/api'
import {
  X,
  Sparkles,
  Clock,
  Plus,
  Trash2
} from 'lucide-react'

interface HistoryEntry {
  storyIdea: string
  styleBible: string
  directorNotes: string
  shotCount: number
  aspectRatio: string
  shots: string[]
  timestamp: number
}

interface CreateNodesPayload {
  storyIdea: string
  styleBible: string
  directorNotes: string
  shots: string[]
  imageModel: string
  aspectRatio: string
  autoGenerateImages: boolean
}

interface Props {
  open: boolean
  onClose: () => void
  onCreateNodes: (payload: CreateNodesPayload) => void
}

const HISTORY_KEY = 'nexus-director-history'
const DEFAULT_CHAT_MODEL = 'gpt-5-mini'

const aspectRatioOptions = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' }
]

const imageModelOptions = [
  { label: 'Gemini 3 Pro', value: 'gemini-3-pro-image-preview' },
  { label: 'FLUX Pro', value: 'flux-pro' },
  { label: 'DALL·E 3', value: 'dall-e-3' },
  { label: 'Midjourney', value: 'midjourney' }
]

export default function DirectorConsole({ open, onClose, onCreateNodes }: Props) {
  // Form state
  const [storyIdea, setStoryIdea] = useState('')
  const [styleBible, setStyleBible] = useState('')
  const [directorNotes, setDirectorNotes] = useState('')
  const [shotCount, setShotCount] = useState(10)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [imageModel, setImageModel] = useState('gemini-3-pro-image-preview')
  const [autoGenerateImages, setAutoGenerateImages] = useState(true)

  // Result state
  const [shots, setShots] = useState<string[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // Load history on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(HISTORY_KEY)
      if (saved) setHistory(JSON.parse(saved))
    } catch {
      // ignore
    }
  }, [])

  // Save history
  const saveHistory = useCallback((entries: HistoryEntry[]) => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-20)))
    } catch {
      // ignore
    }
  }, [])

  const addToHistory = useCallback((entry: Omit<HistoryEntry, 'timestamp'>) => {
    const newEntry: HistoryEntry = { ...entry, timestamp: Date.now() }
    setHistory((prev) => {
      const next = [...prev, newEntry]
      saveHistory(next)
      return next
    })
  }, [saveHistory])

  const loadFromHistory = useCallback((entry: HistoryEntry) => {
    setStoryIdea(entry.storyIdea || '')
    setStyleBible(entry.styleBible || '')
    setDirectorNotes(entry.directorNotes || '')
    setShotCount(entry.shotCount || 10)
    setAspectRatio(entry.aspectRatio || '16:9')
    setShots(entry.shots || [])
    setShowHistory(false)
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
  }, [saveHistory])

  const buildStoryboardPrompt = useCallback(() => {
    const count = Math.max(4, Math.min(24, shotCount))

    const parts = [
      '你是电影导演 + 摄影指导 + 分镜师。',
      `任务：把下面剧情拆成 ${count} 个镜头（严格等于 ${count} 条）。`,
      '输出：严格 JSON 数组（字符串数组）。不要 Markdown，不要解释，不要多余字段。',
      '',
      '每个镜头提示词必须包含：',
      '1) 主体/角色：外观固定点 + 动作 + 场景信息',
      '2) 镜头语言：景别、机位、镜头焦段、构图',
      '3) 运镜：camera movement',
      '4) 光影/色彩/材质',
      '5) 抽象审美 + 质量词（4K/ultra detail）',
      '6) Negative: 模糊/水印/文字/畸形',
      '',
      '节奏：前 20% 建立信息 → 中段推进冲突 → 后 20% 爆点/反转收尾',
      '一致性：同一角色外观、服装、发型必须保持一致',
      '',
      '请让每条字符串以 [SHOT i/N] 开头（i 从 1 开始）。',
      '',
      '【剧情】',
      storyIdea.trim()
    ]

    if (styleBible.trim()) {
      parts.push('', '【角色&美术 Bible】', styleBible.trim())
    }

    if (directorNotes.trim()) {
      parts.push('', '【导演备注】', directorNotes.trim())
    }

    parts.push('', `【画幅】Aspect Ratio: ${aspectRatio}`)

    return parts.join('\n')
  }, [storyIdea, styleBible, directorNotes, shotCount, aspectRatio])

  const parseStoryboardResponse = (text: string): string[] | null => {
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return null

    try {
      const parsed = JSON.parse(jsonMatch[0])
      if (Array.isArray(parsed) && parsed.every((s) => typeof s === 'string')) {
        return parsed
      }
    } catch {
      return null
    }
    return null
  }

  const handleGenerate = async () => {
    if (!storyIdea.trim()) {
      setError('请先填写剧情')
      return
    }

    setError(null)
    setIsGenerating(true)
    setShots([])

    try {
      const prompt = buildStoryboardPrompt()
      let response = ''

      for await (const chunk of streamChatCompletions({
        model: DEFAULT_CHAT_MODEL,
        messages: [
          { role: 'system', content: '你是专业的电影分镜师，擅长将故事拆解为详细的分镜提示词。' },
          { role: 'user', content: prompt }
        ]
      })) {
        response += chunk
      }

      const parsed = parseStoryboardResponse(response)
      if (!parsed || parsed.length === 0) {
        throw new Error('分镜解析失败：模型没有返回有效 JSON 数组')
      }

      setShots(parsed)
      addToHistory({
        storyIdea: storyIdea.trim(),
        styleBible: styleBible.trim(),
        directorNotes: directorNotes.trim(),
        shotCount,
        aspectRatio,
        shots: parsed
      })
    } catch (err: any) {
      const message = err?.message || '分镜生成失败'
      setError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleCreate = () => {
    if (shots.length === 0) {
      setError('请先生成分镜')
      return
    }

    onCreateNodes({
      storyIdea: storyIdea.trim(),
      styleBible: styleBible.trim(),
      directorNotes: directorNotes.trim(),
      shots,
      imageModel,
      aspectRatio,
      autoGenerateImages
    })

    onClose()
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-[min(82vh,860px)] w-[min(1120px,96vw)] flex-col overflow-hidden rounded-3xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] bg-[var(--bg-tertiary)] p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl border border-[rgb(var(--accent-rgb)/0.2)] bg-[rgb(var(--accent-rgb)/0.15)] p-2">
              <Sparkles className="h-4 w-4 text-[var(--accent-color)]" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-[var(--text-primary)]">导演台</span>
              <span className="text-[11px] text-[var(--text-secondary)]">分镜规划 + 自动生成节点</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                'rounded-full p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]',
                showHistory && 'text-[var(--accent-color)]'
              )}
              title="历史记录"
            >
              <Clock className="h-[18px] w-[18px]" />
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-2 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>

        {/* History Panel */}
        {showHistory && (
          <div className="max-h-[200px] overflow-auto border-b border-[var(--border-color)] bg-[var(--bg-primary)]">
            {history.length === 0 ? (
              <div className="p-4 text-center text-sm text-[var(--text-secondary)]">暂无历史记录</div>
            ) : (
              <div className="space-y-2 p-2">
                <div className="mb-2 flex items-center justify-between px-2">
                  <span className="text-xs text-[var(--text-secondary)]">{history.length} 条记录</span>
                  <button onClick={clearHistory} className="flex items-center gap-1 text-xs text-red-500 hover:underline">
                    <Trash2 className="h-3 w-3" />
                    清空
                  </button>
                </div>
                {history
                  .slice()
                  .reverse()
                  .map((entry, i) => (
                    <div
                      key={entry.timestamp || i}
                      onClick={() => loadFromHistory(entry)}
                      className="cursor-pointer rounded-lg bg-[var(--bg-secondary)] p-3 transition-colors hover:bg-[var(--bg-tertiary)]"
                    >
                      <div className="line-clamp-2 text-xs text-[var(--text-primary)]">{entry.storyIdea}</div>
                      <div className="mt-1 text-[10px] text-[var(--text-secondary)]">
                        {entry.shots?.length || 0} 条分镜 · {new Date(entry.timestamp).toLocaleString()}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
          {/* Story Input */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-[var(--text-primary)]">剧情 / 概念</label>
              <span className="text-[10px] text-[var(--text-secondary)]">{storyIdea.length}/2000</span>
            </div>
            <textarea
              value={storyIdea}
              onChange={(e) => setStoryIdea(e.target.value)}
              className="h-[120px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
              placeholder="一句话概念 + 角色关系 + 冲突反转 + 结尾金句（适合短视频/AI 漫剧）…"
              maxLength={2000}
            />
          </div>

          {/* Settings Grid */}
          <div className="grid grid-cols-4 gap-3">
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">镜头数</label>
              <input
                type="number"
                value={shotCount}
                onChange={(e) => setShotCount(Math.max(4, Math.min(24, parseInt(e.target.value) || 10)))}
                min={4}
                max={24}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">画幅</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              >
                {aspectRatioOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">图片模型</label>
              <select
                value={imageModel}
                onChange={(e) => setImageModel(e.target.value)}
                className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
              >
                {imageModelOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">自动出图</label>
              <button
                onClick={() => setAutoGenerateImages(!autoGenerateImages)}
                className={cn(
                  'w-full rounded-lg border py-1.5 text-xs font-bold transition-colors',
                  autoGenerateImages
                    ? 'border-[rgb(var(--accent-rgb)/0.3)] bg-[rgb(var(--accent-rgb)/0.2)] text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                )}
              >
                {autoGenerateImages ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Optional Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-[var(--text-primary)]">角色&美术 Bible（可选）</label>
              <textarea
                value={styleBible}
                onChange={(e) => setStyleBible(e.target.value)}
                className="h-[100px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="固定点：发型/服装/配饰/体型/色板；画风：国漫厚涂/赛璐璐/写实…"
                maxLength={1000}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs font-bold text-[var(--text-primary)]">导演备注（可选）</label>
              <textarea
                value={directorNotes}
                onChange={(e) => setDirectorNotes(e.target.value)}
                className="h-[100px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder="情绪线/节奏点/镜头语言偏好；比如：快节奏、强镜头感、纪实手持…"
                maxLength={1000}
              />
            </div>
          </div>

          {/* Results */}
          <div className="flex flex-1 flex-col gap-2 overflow-hidden">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-primary)]">分镜输出</span>
              <div className="flex items-center gap-2">
                {shots.length > 0 && <span className="text-[11px] text-[var(--text-secondary)]">{shots.length} 条</span>}
                {error && <span className="text-[11px] text-red-500">{error}</span>}
              </div>
            </div>
            <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
              {shots.length === 0 ? (
                <div className="py-8 text-center text-sm text-[var(--text-secondary)]">点击「生成分镜」开始</div>
              ) : (
                <div className="space-y-3">
                  {shots.map((shot, i) => (
                    <div key={i} className="text-xs text-[var(--text-primary)]">
                      <div className="mb-1 text-[10px] text-[var(--text-secondary)]">#{i + 1}</div>
                      <div className="leading-relaxed">{shot}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-color)] p-4">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="secondary" onClick={handleGenerate} disabled={!storyIdea.trim() || isGenerating}>
            <Sparkles className="mr-1 h-4 w-4" />
            {isGenerating ? '生成中...' : '生成分镜'}
          </Button>
          <Button onClick={handleCreate} disabled={shots.length === 0}>
            <Plus className="mr-1 h-4 w-4" />
            上板
          </Button>
        </div>
      </div>
    </div>
  )
}
