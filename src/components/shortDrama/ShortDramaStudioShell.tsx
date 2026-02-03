/**
 * ShortDramaStudioShell | 短剧制作工作台（全屏/嵌入通用壳）
 *
 * 目标：
 * - 复用工作台核心逻辑（草稿/偏好 load & debounce save & flush）
 * - 同时支持：全屏页面（/short-drama/:projectId）与旧 Modal 形态
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Film, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import ShortDramaStudioAutoView from '@/components/shortDrama/ShortDramaStudioAutoView'
import ShortDramaStudioManualView from '@/components/shortDrama/ShortDramaStudioManualView'
import { createDefaultDraftV2, loadShortDramaDraftV2, saveShortDramaDraftV2 } from '@/lib/shortDrama/draftStorage'
import { createDefaultShortDramaPrefs, loadShortDramaPrefs, saveShortDramaPrefs } from '@/lib/shortDrama/uiPrefs'
import { syncAssetHistoryFromCanvasNodes } from '@/lib/assets/syncFromCanvas'
import { useGraphStore } from '@/graph/store'
import type { ShortDramaDraftV2 } from '@/lib/shortDrama/types'
import type { ShortDramaStudioPrefsV1 } from '@/lib/shortDrama/uiPrefs'

export type ShortDramaStudioShellCloseVariant = 'icon' | 'button'

interface Props {
  projectId: string
  className?: string
  closeVariant?: ShortDramaStudioShellCloseVariant
  closeLabel?: string
  onRequestClose?: () => void
}

export default function ShortDramaStudioShell({
  projectId,
  className,
  closeVariant = 'icon',
  closeLabel = '关闭',
  onRequestClose,
}: Props) {
  const pid = String(projectId || '').trim() || 'default'

  const [draft, setDraft] = useState<ShortDramaDraftV2>(() => createDefaultDraftV2(pid))
  const [prefs, setPrefs] = useState<ShortDramaStudioPrefsV1>(() => createDefaultShortDramaPrefs())

  const draftRef = useRef(draft)
  const prefsRef = useRef(prefs)
  draftRef.current = draft
  prefsRef.current = prefs

  const flushNow = useCallback(() => {
    try {
      void saveShortDramaDraftV2(pid, draftRef.current)
    } catch {
      // ignore
    }
    try {
      void saveShortDramaPrefs(pid, prefsRef.current)
    } catch {
      // ignore
    }
  }, [pid])

  // Load draft & prefs on mount / project change
  useEffect(() => {
    setDraft(loadShortDramaDraftV2(pid))
    setPrefs(loadShortDramaPrefs(pid))
    // 把画布中已有素材补进历史（单向补齐，不会破坏历史）
    syncAssetHistoryFromCanvasNodes({ includeDataUrl: true, includeAssetUrl: true })
  }, [pid])

  // Persist draft (debounced)
  useEffect(() => {
    const t = window.setTimeout(() => {
      flushNow()
    }, 250)
    return () => window.clearTimeout(t)
  }, [draft, prefs, flushNow])

  // Flush on unmount
  useEffect(() => {
    return () => {
      flushNow()
    }
  }, [flushNow])

  const handleClose = useCallback(() => {
    flushNow()
    // 同步保存画布，避免“从短剧回到画布时新增节点丢失”（画布可能在路由切换时触发 hydrate 覆盖未落盘的变更）
    ;(async () => {
      try {
        await useGraphStore.getState().saveNow()
      } catch {
        // ignore
      }
      onRequestClose?.()
    })()
  }, [flushNow, onRequestClose])

  const mode = prefs.mode
  const setMode = (next: 'auto' | 'manual') => setPrefs((p) => ({ ...p, mode: next }))

  const body = useMemo(() => {
    const viewProps = { projectId: pid, draft, setDraft, prefs, setPrefs }
    return mode === 'manual' ? <ShortDramaStudioManualView {...viewProps} /> : <ShortDramaStudioAutoView {...viewProps} />
  }, [pid, draft, prefs, mode])

  return (
    <div className={cn('flex h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-secondary)]', className)}>
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

          {onRequestClose ? (
            closeVariant === 'icon' ? (
              <button
                onClick={handleClose}
                className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
                type="button"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              <Button variant="secondary" onClick={handleClose}>
                {closeLabel}
              </Button>
            )
          ) : null}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-hidden p-4">
        <div className="h-full min-h-0">{body}</div>
      </div>
    </div>
  )
}

