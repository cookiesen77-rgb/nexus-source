import React, { useState, useEffect } from 'react'
import { ExternalLink, KeyRound, Bot, RefreshCw } from 'lucide-react'
import { openExternal } from '@/lib/openExternal'
import { useSettingsStore, AI_ASSISTANT_MODELS, RegenerateMode } from '@/store/settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Props = {
  open: boolean
  onClose: () => void
}

export default function SettingsDialog({ open, onClose }: Props) {
  const apiKey = useSettingsStore((s) => s.apiKey)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const clearApiKey = useSettingsStore((s) => s.clearApiKey)
  const aiAssistantModel = useSettingsStore((s) => s.aiAssistantModel)
  const setAiAssistantModel = useSettingsStore((s) => s.setAiAssistantModel)
  const regenerateMode = useSettingsStore((s) => s.regenerateMode)
  const setRegenerateMode = useSettingsStore((s) => s.setRegenerateMode)

  const [draft, setDraft] = useState(apiKey)
  const [draftAiModel, setDraftAiModel] = useState(aiAssistantModel)
  const [draftRegenMode, setDraftRegenMode] = useState<RegenerateMode>(regenerateMode)

  // 同步外部状态变化
  useEffect(() => {
    setDraft(apiKey)
    setDraftAiModel(aiAssistantModel)
    setDraftRegenMode(regenerateMode)
  }, [apiKey, aiAssistantModel, regenerateMode])

  if (!open) return null

  const handleSave = () => {
    setApiKey(draft)
    setAiAssistantModel(draftAiModel)
    setRegenerateMode(draftRegenMode)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="font-semibold text-[var(--text-primary)]">设置</div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="space-y-6 px-5 py-4">
          {/* API Key 设置 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <KeyRound className="h-4 w-4" />
              API Key
            </div>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="请输入 API Key"
              type="password"
              autoComplete="off"
            />
            <div className="flex justify-end">
              <button
                className="inline-flex items-center gap-1 text-xs text-[var(--accent-color)] hover:underline"
                onClick={() => openExternal('https://nexusapi.cn/')}
              >
                获取 API Key
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </button>
            </div>
          </div>

          {/* AI 助手模型 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <Bot className="h-4 w-4" />
              AI 助手模型
            </div>
            <select
              value={draftAiModel}
              onChange={(e) => setDraftAiModel(e.target.value)}
              className="w-full rounded-md border border-[var(--border-color)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-[var(--accent-color)] focus:outline-none"
            >
              {AI_ASSISTANT_MODELS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="text-xs text-[var(--text-tertiary)]">
              用于 AI 润色、对话等文本处理功能
            </div>
          </div>

          {/* 重新生成模式 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]">
              <RefreshCw className="h-4 w-4" />
              重新生成模式
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setDraftRegenMode('create')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  draftRegenMode === 'create'
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]/50'
                }`}
              >
                新建节点
              </button>
              <button
                onClick={() => setDraftRegenMode('replace')}
                className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                  draftRegenMode === 'replace'
                    ? 'border-[var(--accent-color)] bg-[var(--accent-color)]/10 text-[var(--accent-color)]'
                    : 'border-[var(--border-color)] bg-[var(--bg-primary)] text-[var(--text-secondary)] hover:border-[var(--accent-color)]/50'
                }`}
              >
                替换原节点
              </button>
            </div>
            <div className="text-xs text-[var(--text-tertiary)]">
              {draftRegenMode === 'create' 
                ? '重新生成时创建新节点，原内容保留' 
                : '重新生成时替换原节点内容，原内容保存到历史记录'}
            </div>
          </div>

          {/* 提示信息 */}
          <div className="rounded-lg bg-[var(--bg-tertiary)] p-3 text-sm text-[var(--text-secondary)]">
            未配置 API Key 将无法使用 AI 相关能力。
            <button
              className="ml-2 inline-flex items-center gap-1 text-[var(--accent-color)] hover:underline"
              onClick={() => openExternal('https://nexusapi.cn/pricing')}
            >
              查看模型价格
              <ExternalLink className="h-3.5 w-3.5 opacity-70" />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-4">
          <Button variant="secondary" onClick={() => clearApiKey()}>
            清除 API Key
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleSave}>
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
