import React, { useState } from 'react'
import { ExternalLink, KeyRound } from 'lucide-react'
import { openExternal } from '@/lib/openExternal'
import { useSettingsStore } from '@/store/settings'
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

  const [draft, setDraft] = useState(apiKey)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="font-semibold text-[var(--text-primary)]">API 设置</div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="space-y-1">
            <div className="text-sm text-[var(--text-secondary)]">API Key</div>
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
                <KeyRound className="h-3.5 w-3.5" />
                获取 API Key
                <ExternalLink className="h-3.5 w-3.5 opacity-70" />
              </button>
            </div>
          </div>

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
            清除
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => {
                setApiKey(draft)
                onClose()
              }}
            >
              保存
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
