/**
 * Director Console | 导演台组件
 * 分镜规划 + 预设模板 + AI 润色 + 自动生成
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { streamChatCompletions, chatCompletions } from '@/api'
import { generateImage } from '@/api/image'
import { postJson } from '@/lib/workflow/request'
import {
  X,
  Sparkles,
  Clock,
  Plus,
  Trash2,
  Upload,
  Image as ImageIcon,
  Wand2,
  Loader2,
  ChevronDown,
  Eye,
  Copy,
  Check
} from 'lucide-react'
import {
  DIRECTOR_PRESETS,
  DirectorPreset,
  getPresetById,
  buildFinalPrompt,
  POLISH_SYSTEM_PROMPT,
  getAspectRatioOptions
} from '@/lib/directorPresets'
import { IMAGE_MODELS, DEFAULT_IMAGE_MODEL } from '@/config/models'
import { useAssetsStore } from '@/store/assets'

interface HistoryEntry {
  storyIdea: string
  styleBible: string
  directorNotes: string
  shotCount: number
  aspectRatio: string
  shots: string[]
  timestamp: number
  presetId?: string
}

interface CreateNodesPayload {
  storyIdea: string
  styleBible: string
  directorNotes: string
  shots: string[]
  imageModel: string
  aspectRatio: string
  autoGenerateImages: boolean
  // 新增：单图模式
  singleImageUrl?: string
  singleImagePrompt?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onCreateNodes: (payload: CreateNodesPayload) => void
}

const HISTORY_KEY = 'nexus-director-history'
const DEFAULT_CHAT_MODEL = 'gpt-5-mini'

// 使用配置的图片模型列表
const imageModelOptions = (IMAGE_MODELS as any[]).map((m: any) => ({
  label: m.label,
  value: m.key
}))

export default function DirectorConsole({ open, onClose, onCreateNodes }: Props) {
  // 预设模式
  const [selectedPreset, setSelectedPreset] = useState<string>('none')
  const [showPresetDropdown, setShowPresetDropdown] = useState(false)
  
  // 参考图
  const [referenceImage, setReferenceImage] = useState<string | null>(null)
  const [referenceImageFile, setReferenceImageFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  // Form state
  const [userPrompt, setUserPrompt] = useState('')
  const [styleBible, setStyleBible] = useState('')
  const [directorNotes, setDirectorNotes] = useState('')
  const [shotCount, setShotCount] = useState(10)
  const [aspectRatio, setAspectRatio] = useState('16:9')
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL || 'gemini-3-pro-image-preview')
  const [autoGenerateImages, setAutoGenerateImages] = useState(true)
  const [resolution, setResolution] = useState<'1K' | '2K' | '4K'>('2K')

  // AI 润色相关
  const [polishedPrompt, setPolishedPrompt] = useState('')
  const [isPolishing, setIsPolishing] = useState(false)
  const [polishError, setPolishError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // 生成图片相关
  const [isGeneratingImage, setIsGeneratingImage] = useState(false)
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  // 分镜模式（旧功能）
  const [shots, setShots] = useState<string[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // History state
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [showHistory, setShowHistory] = useState(false)

  // 当前预设配置
  const currentPreset = getPresetById(selectedPreset) || DIRECTOR_PRESETS[0]

  // 切换预设时更新默认值
  useEffect(() => {
    if (currentPreset) {
      setAspectRatio(currentPreset.aspectRatio)
      setResolution(currentPreset.resolution)
      // 清空之前的结果
      setPolishedPrompt('')
      setGeneratedImageUrl(null)
      setShots([])
    }
  }, [selectedPreset])

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
    setUserPrompt(entry.storyIdea || '')
    setStyleBible(entry.styleBible || '')
    setDirectorNotes(entry.directorNotes || '')
    setShotCount(entry.shotCount || 10)
    setAspectRatio(entry.aspectRatio || '16:9')
    setShots(entry.shots || [])
    if (entry.presetId) setSelectedPreset(entry.presetId)
    setShowHistory(false)
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    saveHistory([])
  }, [saveHistory])

  // 参考图上传处理
  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setReferenceImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setReferenceImage(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    setReferenceImageFile(file)
    const reader = new FileReader()
    reader.onload = (ev) => {
      setReferenceImage(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }, [])

  const clearReferenceImage = useCallback(() => {
    setReferenceImage(null)
    setReferenceImageFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  // AI 润色提示词
  const handlePolish = useCallback(async () => {
    if (!userPrompt.trim()) {
      setPolishError('请先输入描述')
      return
    }

    setIsPolishing(true)
    setPolishError(null)
    setPolishedPrompt('')

    try {
      // 构建消息
      const messages: any[] = [
        { role: 'system', content: currentPreset.systemPrompt || POLISH_SYSTEM_PROMPT }
      ]

      // 如果有参考图，添加图片分析
      let userContent: any
      if (referenceImage) {
        userContent = [
          {
            type: 'text',
            text: `Please analyze this reference image and use it to enhance the following prompt. Extract character appearance, style, and visual elements from the image.

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output ONLY the polished, professional prompt. No explanations.`
          },
          {
            type: 'image_url',
            image_url: { url: referenceImage }
          }
        ]
      } else {
        userContent = `Polish this prompt into a professional, detailed image generation prompt:

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output ONLY the polished prompt. No explanations.`
      }

      messages.push({ role: 'user', content: userContent })

      // 调用 AI
      let response = ''
      for await (const chunk of streamChatCompletions({
        model: DEFAULT_CHAT_MODEL,
        messages
      })) {
        response += chunk
        setPolishedPrompt(response)
      }

      // 如果没有使用模板，直接使用AI返回的结果
      // 如果使用了模板，AI已经按模板格式润色了
      
    } catch (err: any) {
      console.error('[DirectorConsole] AI 润色失败:', err)
      setPolishError(err?.message || '润色失败')
    } finally {
      setIsPolishing(false)
    }
  }, [userPrompt, referenceImage, currentPreset])

  // 生成图片 - 支持多种模型格式（用于单独生图，已有润色结果时）
  const handleGenerateImage = useCallback(async () => {
    const promptToUse = polishedPrompt || userPrompt
    if (!promptToUse.trim()) {
      setGenerateError('请先输入或润色提示词')
      return
    }

    setIsGeneratingImage(true)
    setGenerateError(null)
    setGeneratedImageUrl(null)

    try {
      const modelCfg = (IMAGE_MODELS as any[]).find(m => m.key === imageModel) || (IMAGE_MODELS as any[])[0]
      const format = modelCfg?.format || 'openai-image'
      let imageUrl = ''
      
      if (format === 'gemini-image') {
        // Gemini 格式
        const requestParts: any[] = []
        if (promptToUse) requestParts.push({ text: promptToUse })
        if (referenceImage) {
          const match = referenceImage.match(/^data:(.+?);base64,(.+)$/)
          if (match) {
            requestParts.push({ inline_data: { mime_type: match[1], data: match[2] } })
          }
        }
        if (requestParts.length === 0) throw new Error('请提供提示词或参考图')
        
        const payload = {
          contents: [{ role: 'user', parts: requestParts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: aspectRatio || '1:1', imageSize: resolution || '2K' }
          }
        }
        const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
        const parts = rsp?.candidates?.[0]?.content?.parts || []
        const inline = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]
        if (inline?.data) {
          imageUrl = `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`
        }
        if (!imageUrl) throw new Error('生图返回为空，请重试')
      } else if (format === 'openai-chat-image') {
        // Chat 方式生图
        const chatMessages = [{ role: 'user', content: `Generate an image: ${promptToUse}` }]
        const result = await chatCompletions({ model: imageModel, messages: chatMessages })
        const content = result?.choices?.[0]?.message?.content || ''
        const urlMatch = content.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+\.(png|jpg|jpeg|webp|gif)/i)
        if (urlMatch) imageUrl = urlMatch[0]
        else {
          const b64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
          if (b64Match) imageUrl = b64Match[0]
        }
        if (!imageUrl) throw new Error('Chat 生图未返回有效图片')
      } else if (format === 'kling-image') {
        // Kling 格式
        const klingPayload = {
          model_name: modelCfg.defaultParams?.model_name || 'kling-v2-1',
          prompt: promptToUse,
          aspect_ratio: aspectRatio || '1:1',
          n: 1
        }
        const rsp = await postJson<any>(modelCfg.endpoint, klingPayload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 120000 })
        if (rsp?.data?.images?.[0]?.url) imageUrl = rsp.data.images[0].url
        else if (rsp?.data?.[0]?.url) imageUrl = rsp.data[0].url
        else throw new Error('Kling 生图未返回有效图片')
      } else {
        // OpenAI 兼容格式
        const result = await generateImage({
          model: imageModel,
          prompt: promptToUse,
          size: aspectRatio,
        }, {
          endpoint: modelCfg?.endpoint || '/images/generations',
          authMode: modelCfg?.authMode || 'bearer',
          timeout: modelCfg?.timeout
        })
        if (result?.url) imageUrl = result.url
        else if (result?.data?.[0]?.url) imageUrl = result.data[0].url
        else if (result?.data?.[0]?.b64_json) imageUrl = `data:image/png;base64,${result.data[0].b64_json}`
        else throw new Error('未获取到图片结果')
      }
      
      setGeneratedImageUrl(imageUrl)
      
      // 同步到历史素材
      try {
        useAssetsStore.getState().addAsset({
          type: 'image',
          src: imageUrl,
          title: userPrompt?.slice(0, 50) || '导演台生成',
          model: imageModel
        })
      } catch (e) {
        console.warn('[DirectorConsole] 添加到历史素材失败:', e)
      }
    } catch (err: any) {
      console.error('[DirectorConsole] 生成图片失败:', err)
      setGenerateError(err?.message || '生成失败')
    } finally {
      setIsGeneratingImage(false)
    }
  }, [polishedPrompt, userPrompt, imageModel, aspectRatio, referenceImage, resolution])

  // 一键生成：先润色，再生图
  const handlePolishAndGenerate = useCallback(async () => {
    if (!userPrompt.trim()) {
      setGenerateError('请先输入描述')
      return
    }

    // 第一步：润色
    setIsPolishing(true)
    setPolishError(null)
    setPolishedPrompt('')
    setGenerateError(null)
    setGeneratedImageUrl(null)

    let finalPrompt = ''

    try {
      // 构建消息
      const messages: any[] = [
        { role: 'system', content: currentPreset.systemPrompt || POLISH_SYSTEM_PROMPT }
      ]

      // 如果有参考图，添加图片分析
      let userContent: any
      if (referenceImage) {
        userContent = [
          {
            type: 'text',
            text: `Please analyze this reference image and use it to enhance the following prompt. Extract character appearance, style, and visual elements from the image.

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output ONLY the polished, professional prompt. No explanations.`
          },
          {
            type: 'image_url',
            image_url: { url: referenceImage }
          }
        ]
      } else {
        userContent = `Polish this prompt into a professional, detailed image generation prompt:

User's description:
${userPrompt}

${currentPreset.promptTemplate ? `Use this template structure:\n${currentPreset.promptTemplate}` : ''}

Output ONLY the polished prompt. No explanations.`
      }

      messages.push({ role: 'user', content: userContent })

      // 调用 AI 润色
      for await (const chunk of streamChatCompletions({
        model: DEFAULT_CHAT_MODEL,
        messages
      })) {
        finalPrompt += chunk
        setPolishedPrompt(finalPrompt)
      }
    } catch (err: any) {
      console.error('[DirectorConsole] AI 润色失败:', err)
      setPolishError(err?.message || '润色失败')
      setIsPolishing(false)
      return
    }
    
    setIsPolishing(false)

    // 第二步：生成图片
    if (!finalPrompt.trim()) {
      setGenerateError('润色结果为空')
      return
    }

    setIsGeneratingImage(true)

    try {
      // 查找模型配置
      const modelCfg = (IMAGE_MODELS as any[]).find(m => m.key === imageModel) || (IMAGE_MODELS as any[])[0]
      const format = modelCfg?.format || 'openai-image'
      
      let imageUrl = ''
      
      if (format === 'gemini-image') {
        // Gemini 格式
        const requestParts: any[] = []
        if (finalPrompt) requestParts.push({ text: finalPrompt })
        if (referenceImage) {
          const match = referenceImage.match(/^data:(.+?);base64,(.+)$/)
          if (match) {
            requestParts.push({ inline_data: { mime_type: match[1], data: match[2] } })
          }
        }
        if (requestParts.length === 0) throw new Error('请提供提示词或参考图')
        
        const payload = {
          contents: [{ role: 'user', parts: requestParts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: aspectRatio || '1:1', imageSize: resolution || '2K' }
          }
        }
        
        const rsp = await postJson<any>(modelCfg.endpoint, payload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 240000 })
        const parts = rsp?.candidates?.[0]?.content?.parts || []
        const inline = parts.map((p: any) => p.inlineData || p.inline_data).filter(Boolean)[0]
        if (inline?.data) {
          imageUrl = `data:${inline.mimeType || inline.mime_type || 'image/png'};base64,${inline.data}`
        }
        if (!imageUrl) throw new Error('生图返回为空，请重试')
      } else if (format === 'openai-chat-image') {
        // Chat 方式生图（Grok、通义千问等）
        const chatMessages = [
          { role: 'user', content: `Generate an image based on this description: ${finalPrompt}\n\nPlease return the image directly.` }
        ]
        const result = await chatCompletions({ model: imageModel, messages: chatMessages })
        const content = result?.choices?.[0]?.message?.content || ''
        // 尝试提取 URL 或 base64
        const urlMatch = content.match(/https?:\/\/[^\s<>"{}|\\^`[\]]+\.(png|jpg|jpeg|webp|gif)/i)
        if (urlMatch) {
          imageUrl = urlMatch[0]
        } else {
          const b64Match = content.match(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/)
          if (b64Match) imageUrl = b64Match[0]
        }
        if (!imageUrl) throw new Error('Chat 生图未返回有效图片')
      } else if (format === 'kling-image') {
        // Kling 格式
        const klingPayload = {
          model_name: modelCfg.defaultParams?.model_name || 'kling-v2-1',
          prompt: finalPrompt,
          aspect_ratio: aspectRatio || '1:1',
          n: 1
        }
        const rsp = await postJson<any>(modelCfg.endpoint, klingPayload, { authMode: modelCfg.authMode, timeoutMs: modelCfg.timeout || 120000 })
        // Kling 可能返回 task_id 需要轮询，或直接返回图片
        if (rsp?.data?.images?.[0]?.url) {
          imageUrl = rsp.data.images[0].url
        } else if (rsp?.data?.[0]?.url) {
          imageUrl = rsp.data[0].url
        } else {
          throw new Error('Kling 生图未返回有效图片')
        }
      } else {
        // OpenAI 兼容格式
        const result = await generateImage({
          model: imageModel,
          prompt: finalPrompt,
          size: aspectRatio,
        }, {
          endpoint: modelCfg?.endpoint || '/images/generations',
          authMode: modelCfg?.authMode || 'bearer',
          timeout: modelCfg?.timeout
        })
        if (result?.url) imageUrl = result.url
        else if (result?.data?.[0]?.url) imageUrl = result.data[0].url
        else if (result?.data?.[0]?.b64_json) imageUrl = `data:image/png;base64,${result.data[0].b64_json}`
        else throw new Error('未获取到图片结果')
      }
      
      setGeneratedImageUrl(imageUrl)
      
      // 同步到历史素材
      try {
        useAssetsStore.getState().addAsset({
          type: 'image',
          src: imageUrl,
          title: userPrompt?.slice(0, 50) || '导演台生成',
          model: imageModel
        })
      } catch (e) {
        console.warn('[DirectorConsole] 添加到历史素材失败:', e)
      }
    } catch (err: any) {
      console.error('[DirectorConsole] 生成图片失败:', err)
      setGenerateError(err?.message || '生成失败')
    } finally {
      setIsGeneratingImage(false)
    }
  }, [userPrompt, referenceImage, currentPreset, imageModel, aspectRatio, resolution])

  // 复制润色后的提示词
  const handleCopyPrompt = useCallback(() => {
    if (polishedPrompt) {
      navigator.clipboard.writeText(polishedPrompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [polishedPrompt])

  // 旧的分镜生成逻辑（保留）
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
      userPrompt.trim()
    ]

    if (styleBible.trim()) {
      parts.push('', '【角色&美术 Bible】', styleBible.trim())
    }

    if (directorNotes.trim()) {
      parts.push('', '【导演备注】', directorNotes.trim())
    }

    parts.push('', `【画幅】Aspect Ratio: ${aspectRatio}`)

    return parts.join('\n')
  }, [userPrompt, styleBible, directorNotes, shotCount, aspectRatio])

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

  const handleGenerateStoryboard = async () => {
    if (!userPrompt.trim()) {
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
        storyIdea: userPrompt.trim(),
        styleBible: styleBible.trim(),
        directorNotes: directorNotes.trim(),
        shotCount,
        aspectRatio,
        shots: parsed,
        presetId: selectedPreset
      })
    } catch (err: any) {
      const message = err?.message || '分镜生成失败'
      setError(message)
    } finally {
      setIsGenerating(false)
    }
  }

  // 上板：创建节点
  const handleCreate = () => {
    // 预设模式：生成单图
    if (selectedPreset !== 'none' && generatedImageUrl) {
      onCreateNodes({
        storyIdea: userPrompt.trim(),
        styleBible: styleBible.trim(),
        directorNotes: directorNotes.trim(),
        shots: [],
        imageModel,
        aspectRatio,
        autoGenerateImages: false,
        singleImageUrl: generatedImageUrl,
        singleImagePrompt: polishedPrompt || userPrompt
      })
      onClose()
      return
    }

    // 分镜模式
    if (shots.length === 0) {
      setError('请先生成分镜')
      return
    }

    onCreateNodes({
      storyIdea: userPrompt.trim(),
      styleBible: styleBible.trim(),
      directorNotes: directorNotes.trim(),
      shots,
      imageModel,
      aspectRatio,
      autoGenerateImages
    })

    onClose()
  }

  // 判断是否是单图预设模式
  const isSingleImageMode = selectedPreset !== 'none'

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-[min(88vh,920px)] w-[min(1200px,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">导演台</h2>
            
            {/* 预设选择器 */}
            <div className="relative ml-4">
              <button
                onClick={() => setShowPresetDropdown(!showPresetDropdown)}
                className="flex items-center gap-2 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:border-[var(--accent-color)] transition-colors"
              >
                <span>{currentPreset.name}</span>
                <ChevronDown className={cn('h-4 w-4 transition-transform', showPresetDropdown && 'rotate-180')} />
              </button>
              
              {showPresetDropdown && (
                <div className="absolute left-0 top-full z-50 mt-1 w-[320px] rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
                  <div className="max-h-[400px] overflow-auto p-2">
                    {DIRECTOR_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        onClick={() => {
                          setSelectedPreset(preset.id)
                          setShowPresetDropdown(false)
                        }}
                        className={cn(
                          'w-full rounded-lg p-3 text-left transition-colors',
                          selectedPreset === preset.id
                            ? 'bg-[rgb(var(--accent-rgb)/0.2)] text-[var(--accent-color)]'
                            : 'hover:bg-[var(--bg-primary)] text-[var(--text-primary)]'
                        )}
                      >
                        <div className="font-medium text-sm">{preset.name}</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5">{preset.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowHistory(!showHistory)}
              className={cn(
                'rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]',
                showHistory && 'text-[var(--accent-color)]'
              )}
              title="历史记录"
            >
              <Clock className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            >
              <X className="h-5 w-5" />
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
        <div className="flex flex-1 gap-4 overflow-hidden p-5">
          {/* 左侧：输入区域 */}
          <div className="flex w-1/2 flex-col gap-4 overflow-auto">
            {/* 参考图上传 */}
            {currentPreset.supportsReferenceImage && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-bold text-[var(--text-primary)]">
                  参考图（可选）
                  {currentPreset.referenceImageGuide && (
                    <span className="ml-2 font-normal text-[var(--text-secondary)]">
                      {currentPreset.referenceImageGuide}
                    </span>
                  )}
                </label>
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  className={cn(
                    'relative flex h-[140px] items-center justify-center rounded-xl border-2 border-dashed transition-colors',
                    referenceImage
                      ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.1)]'
                      : 'border-[var(--border-color)] bg-[var(--bg-primary)] hover:border-[var(--accent-color)]'
                  )}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                  
                  {referenceImage ? (
                    <div className="relative h-full w-full p-2">
                      <img
                        src={referenceImage}
                        alt="Reference"
                        className="h-full w-full object-contain rounded-lg"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          clearReferenceImage()
                        }}
                        className="absolute right-3 top-3 rounded-full bg-black/50 p-1 text-white hover:bg-black/70"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-[var(--text-secondary)]">
                      <Upload className="h-8 w-8" />
                      <span className="text-xs">拖拽或点击上传参考图</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 提示词输入 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[var(--text-primary)]">
                  {isSingleImageMode ? '描述' : '剧情 / 概念'}
                </label>
                <span className="text-[10px] text-[var(--text-secondary)]">{userPrompt.length}/2000</span>
              </div>
              <textarea
                value={userPrompt}
                onChange={(e) => setUserPrompt(e.target.value)}
                className="h-[120px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                placeholder={currentPreset.userPromptPlaceholder || '描述你想要生成的内容...'}
                maxLength={2000}
              />
            </div>

            {/* 设置区域 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">画幅</label>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                >
                  {getAspectRatioOptions().map((opt) => (
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
              
              {!isSingleImageMode && (
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
              )}
              
              {isSingleImageMode && (
                <div className="flex flex-col gap-2">
                  <label className="text-[11px] font-bold uppercase text-[var(--text-secondary)]">分辨率</label>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value as '1K' | '2K' | '4K')}
                    className="w-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
                  >
                    <option value="1K">1K (1024px)</option>
                    <option value="2K">2K (2048px)</option>
                    <option value="4K">4K (4096px)</option>
                  </select>
                </div>
              )}
            </div>

            {/* 分镜模式额外选项 */}
            {!isSingleImageMode && (
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[var(--text-primary)]">角色&美术 Bible（可选）</label>
                  <textarea
                    value={styleBible}
                    onChange={(e) => setStyleBible(e.target.value)}
                    className="h-[80px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                    placeholder="固定点：发型/服装/配饰/体型/色板；画风：国漫厚涂/赛璐璐/写实…"
                    maxLength={1000}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-xs font-bold text-[var(--text-primary)]">导演备注（可选）</label>
                  <textarea
                    value={directorNotes}
                    onChange={(e) => setDirectorNotes(e.target.value)}
                    className="h-[80px] w-full resize-none rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:border-[var(--accent-color)] focus:outline-none"
                    placeholder="情绪线/节奏点/镜头语言偏好…"
                    maxLength={1000}
                  />
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex items-center gap-3">
              {isSingleImageMode ? (
                <>
                  <Button
                    variant="secondary"
                    onClick={handlePolish}
                    disabled={!userPrompt.trim() || isPolishing}
                    className="flex-1"
                  >
                    {isPolishing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Wand2 className="mr-2 h-4 w-4" />
                    )}
                    {isPolishing ? 'AI 润色中...' : 'AI 润色提示词'}
                  </Button>
                  <Button
                    onClick={handlePolishAndGenerate}
                    disabled={!userPrompt.trim() || isPolishing || isGeneratingImage}
                    className="flex-1"
                  >
                    {(isPolishing || isGeneratingImage) ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ImageIcon className="mr-2 h-4 w-4" />
                    )}
                    {isPolishing ? '润色中...' : isGeneratingImage ? '生成中...' : '一键生成'}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    onClick={handleGenerateStoryboard}
                    disabled={!userPrompt.trim() || isGenerating}
                    className="flex-1"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    {isGenerating ? '生成中...' : '生成分镜'}
                  </Button>
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-[var(--text-secondary)]">自动出图</label>
                    <button
                      onClick={() => setAutoGenerateImages(!autoGenerateImages)}
                      className={cn(
                        'rounded-lg border px-3 py-1 text-xs font-bold transition-colors',
                        autoGenerateImages
                          ? 'border-[rgb(var(--accent-rgb)/0.3)] bg-[rgb(var(--accent-rgb)/0.2)] text-[var(--accent-color)]'
                          : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)]'
                      )}
                    >
                      {autoGenerateImages ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* 错误提示 */}
            {(polishError || generateError || error) && (
              <div className="rounded-lg bg-red-500/10 px-4 py-2 text-xs text-red-500">
                {polishError || generateError || error}
              </div>
            )}
          </div>

          {/* 右侧：输出区域 */}
          <div className="flex w-1/2 flex-col gap-4 overflow-auto">
            {isSingleImageMode ? (
              <>
                {/* 润色后的提示词 */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-[var(--text-primary)]">AI 润色提示词</label>
                    {polishedPrompt && (
                      <button
                        onClick={handleCopyPrompt}
                        className="flex items-center gap-1 text-xs text-[var(--accent-color)] hover:underline"
                      >
                        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied ? '已复制' : '复制'}
                      </button>
                    )}
                  </div>
                  <div className="h-[200px] overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                    {polishedPrompt ? (
                      <pre className="whitespace-pre-wrap text-xs text-[var(--text-primary)] font-mono leading-relaxed">
                        {polishedPrompt}
                      </pre>
                    ) : (
                      <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)]">
                        点击「AI 润色提示词」开始
                      </div>
                    )}
                  </div>
                </div>

                {/* 生成的图片 */}
                <div className="flex flex-1 flex-col gap-2">
                  <label className="text-xs font-bold text-[var(--text-primary)]">生成结果</label>
                  <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                    {generatedImageUrl ? (
                      <div className="relative">
                        <img
                          src={generatedImageUrl}
                          alt="Generated"
                          className="w-full rounded-lg"
                        />
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-[var(--text-secondary)]">
                        {isGeneratingImage ? (
                          <div className="flex flex-col items-center gap-3">
                            <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-color)]" />
                            <span>正在生成图片...</span>
                          </div>
                        ) : (
                          '点击「生成图片」开始'
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* 分镜输出 */
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-primary)]">分镜输出</span>
                  {shots.length > 0 && (
                    <span className="text-[11px] text-[var(--text-secondary)]">{shots.length} 条</span>
                  )}
                </div>
                <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                  {shots.length === 0 ? (
                    <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-[var(--text-secondary)]">
                      点击「生成分镜」开始
                    </div>
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
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-[var(--border-color)] p-4">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleCreate}
            disabled={isSingleImageMode ? !generatedImageUrl : shots.length === 0}
          >
            <Plus className="mr-1 h-4 w-4" />
            上板
          </Button>
        </div>
      </div>
    </div>
  )
}
