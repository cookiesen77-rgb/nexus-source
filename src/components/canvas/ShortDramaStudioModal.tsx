/**
 * Short Drama Studio Modal | 短剧制作工作台（C1）
 *
 * 目标：
 * - 全流程在工作台内完成（不依赖画布节点）
 * - 模型来源：Nexus 内置模型（见 config/models.js）
 * - 草稿：localStorage（大媒体写入 IndexedDB，草稿保存 mediaId/sourceUrl）
 */

import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Film, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useGraphStore } from '@/graph/store'
import { Button } from '@/components/ui/button'
import ShortDramaStudioAutoView from '@/components/shortDrama/ShortDramaStudioAutoView'
import ShortDramaStudioManualView from '@/components/shortDrama/ShortDramaStudioManualView'
import { createDefaultDraftV2, loadShortDramaDraftV2, saveShortDramaDraftV2 } from '@/lib/shortDrama/draftStorage'
import { createDefaultShortDramaPrefs, loadShortDramaPrefs, saveShortDramaPrefs } from '@/lib/shortDrama/uiPrefs'
import { syncAssetHistoryFromCanvasNodes } from '@/lib/assets/syncFromCanvas'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'
import type { ShortDramaStudioPrefsV1 } from '@/lib/shortDrama/uiPrefs'

interface Props {
  open: boolean
  onClose: () => void
}

export default function ShortDramaStudioModal({ open, onClose }: Props) {
  const projectId = useGraphStore((s) => s.projectId) || 'default'

  const [draft, setDraft] = useState<ShortDramaDraftV2>(() => createDefaultDraftV2(projectId))
  const [prefs, setPrefs] = useState<ShortDramaStudioPrefsV1>(() => createDefaultShortDramaPrefs())

  const draftRef = useRef(draft)
  const prefsRef = useRef(prefs)
  draftRef.current = draft
  prefsRef.current = prefs

  // Load draft & prefs when opening
  useEffect(() => {
    if (!open) return
    setDraft(loadShortDramaDraftV2(projectId))
    setPrefs(loadShortDramaPrefs(projectId))
    syncAssetHistoryFromCanvasNodes({ includeDataUrl: true, includeAssetUrl: true })
  }, [open, projectId])

  // Persist draft (debounced)
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      void saveShortDramaDraftV2(projectId, draftRef.current)
    }, 250)
    return () => window.clearTimeout(t)
  }, [open, projectId, draft])

  // Persist prefs (debounced)
  useEffect(() => {
    if (!open) return
    const t = window.setTimeout(() => {
      void saveShortDramaPrefs(projectId, prefsRef.current)
    }, 250)
    return () => window.clearTimeout(t)
  }, [open, projectId, prefs])

  const mode = prefs.mode
  const setMode = (next: 'auto' | 'manual') => setPrefs((p) => ({ ...p, mode: next }))

  const body = useMemo(() => {
    const viewProps = { projectId, draft, setDraft, prefs, setPrefs }
    return mode === 'manual' ? <ShortDramaStudioManualView {...viewProps} /> : <ShortDramaStudioAutoView {...viewProps} />
  }, [projectId, draft, prefs, mode])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex h-[min(92vh,980px)] w-[min(1480px,98vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3">
            <Film className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">短剧制作</h2>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
              <Button
                size="sm"
                variant="ghost"
                className={cn('h-8 px-3', mode === 'auto' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]')}
                onClick={() => setMode('auto')}
              >
                自动
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className={cn(
                  'h-8 px-3',
                  mode === 'manual' ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'
                )}
                onClick={() => setMode('manual')}
              >
                手动
              </Button>
            </div>

            <button
              onClick={onClose}
              className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
              type="button"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-hidden p-4">
          <div className="h-full min-h-0">{body}</div>
        </div>
      </div>
    </div>
  )
}

