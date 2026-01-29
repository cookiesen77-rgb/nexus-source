/**
 * PromptReverseModal - 提示词逆推组件
 * 用户上传图片，AI 分析并输出结构化提示词
 */

import React, { useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Upload, Loader2, Copy, Check, Image as ImageIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { streamChatCompletions } from '@/api'

interface Props {
  open: boolean
  onClose: () => void
}

const SYSTEM_PROMPT = `你是一位专业的图像分析专家，擅长逆向推导图像生成提示词。当收到一张图片时，请仔细分析并提供：

1. 详细的中文文本描述，适合直接用于图像生成
2. 结构化的 JSON 表示

请具体描述：
- 主体/角色细节（外貌、服装、姿势、表情）
- 艺术风格和技法（写实、动漫、油画等）
- 构图和取景（特写、全景等）
- 光线和氛围
- 色彩搭配
- 背景和环境
- 镜头角度和透视
- 质量修饰词（高清、精细等）

输出格式：
首先，提供中文文本提示词（纯文本，可直接用于图像生成）。
然后，输出分隔符：---JSON---
最后，提供结构化的 JSON（键名使用英文，值使用中文描述）。`

const DEFAULT_CHAT_MODEL = 'gpt-5-mini'

export default function PromptReverseModal({ open, onClose }: Props) {
  const [image, setImage] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [textPrompt, setTextPrompt] = useState('')
  const [jsonPrompt, setJsonPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copiedText, setCopiedText] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      setImage(reader.result as string)
      setTextPrompt('')
      setJsonPrompt('')
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = () => {
      setImage(reader.result as string)
      setTextPrompt('')
      setJsonPrompt('')
      setError(null)
    }
    reader.readAsDataURL(file)
  }, [])

  const handleAnalyze = useCallback(async () => {
    if (!image) return

    setIsAnalyzing(true)
    setError(null)
    setTextPrompt('')
    setJsonPrompt('')

    try {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请分析这张图片，提供详细的中文文本提示词和结构化的 JSON 表示。' },
            { type: 'image_url', image_url: { url: image } }
          ]
        }
      ]

      let fullResponse = ''
      for await (const chunk of streamChatCompletions({
        model: DEFAULT_CHAT_MODEL,
        messages
      })) {
        fullResponse += chunk

        // 尝试分离文本和 JSON 部分
        const separator = '---JSON---'
        const sepIndex = fullResponse.indexOf(separator)
        if (sepIndex >= 0) {
          setTextPrompt(fullResponse.slice(0, sepIndex).trim())
          const jsonPart = fullResponse.slice(sepIndex + separator.length).trim()
          // 尝试提取 JSON 代码块
          const jsonMatch = jsonPart.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, jsonPart]
          setJsonPrompt(jsonMatch[1]?.trim() || jsonPart)
        } else {
          setTextPrompt(fullResponse)
        }
      }
    } catch (err: any) {
      console.error('[PromptReverse] 分析失败:', err)
      setError(err?.message || '分析失败')
    } finally {
      setIsAnalyzing(false)
    }
  }, [image])

  const handleCopyText = useCallback(() => {
    if (textPrompt) {
      navigator.clipboard.writeText(textPrompt)
      setCopiedText(true)
      setTimeout(() => setCopiedText(false), 2000)
    }
  }, [textPrompt])

  const handleCopyJson = useCallback(() => {
    if (jsonPrompt) {
      navigator.clipboard.writeText(jsonPrompt)
      setCopiedJson(true)
      setTimeout(() => setCopiedJson(false), 2000)
    }
  }, [jsonPrompt])

  const handleClose = useCallback(() => {
    setImage(null)
    setTextPrompt('')
    setJsonPrompt('')
    setError(null)
    onClose()
  }, [onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-6 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">提示词逆推</h2>
          <button
            onClick={handleClose}
            className="rounded-lg p-2 hover:bg-[var(--bg-tertiary)]"
          >
            <X className="h-5 w-5 text-[var(--text-secondary)]" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-1 gap-4 overflow-hidden p-6">
          {/* 左侧：图片上传 */}
          <div className="flex w-1/3 flex-col gap-4">
            <div
              className="flex flex-1 flex-col items-center justify-center rounded-xl border-2 border-dashed border-[var(--border-color)] bg-[var(--bg-primary)] p-4 transition-colors hover:border-[var(--accent-color)]"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileSelect}
                className="hidden"
              />
              {image ? (
                <img
                  src={image}
                  alt="上传的图片"
                  className="max-h-[300px] max-w-full rounded-lg object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-[var(--text-secondary)]">
                  <Upload className="h-12 w-12 opacity-50" />
                  <span className="text-sm">点击或拖拽上传图片</span>
                </div>
              )}
            </div>

            <Button
              onClick={handleAnalyze}
              disabled={!image || isAnalyzing}
              className="w-full"
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  分析中...
                </>
              ) : (
                <>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  分析图片
                </>
              )}
            </Button>

            {error && (
              <div className="rounded-lg bg-red-500/10 p-3 text-sm text-red-500">
                {error}
              </div>
            )}
          </div>

          {/* 右侧：结果显示 */}
          <div className="flex flex-1 gap-4">
            {/* 纯文本结果 */}
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text-secondary)]">文本提示词</span>
                <button
                  onClick={handleCopyText}
                  disabled={!textPrompt}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                  {copiedText ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedText ? '已复制' : '复制'}
                </button>
              </div>
              <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                {textPrompt ? (
                  <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{textPrompt}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)] opacity-50">
                    分析结果将显示在这里
                  </div>
                )}
              </div>
            </div>

            {/* JSON 结果 */}
            <div className="flex flex-1 flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--text-secondary)]">结构化 JSON</span>
                <button
                  onClick={handleCopyJson}
                  disabled={!jsonPrompt}
                  className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50"
                >
                  {copiedJson ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  {copiedJson ? '已复制' : '复制'}
                </button>
              </div>
              <div className="flex-1 overflow-auto rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-4">
                {jsonPrompt ? (
                  <pre className="whitespace-pre-wrap text-sm text-[var(--text-primary)] font-mono">{jsonPrompt}</pre>
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-secondary)] opacity-50">
                    JSON 结构将显示在这里
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
