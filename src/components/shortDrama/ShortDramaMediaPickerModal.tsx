import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAssetsStore } from '@/store/assets'
import { useGraphStore } from '@/graph/store'
import { getMedia } from '@/lib/mediaStorage'
import { Image as ImageIcon, X } from 'lucide-react'

export type ShortDramaPickedImage = {
  origin: 'history' | 'canvas'
  id: string
  label: string
  sourceUrl?: string
  displayUrl?: string
  mediaId?: string
}

type TabKey = 'history' | 'canvas'

interface Props {
  open: boolean
  onClose: () => void
  title?: string
  multiple?: boolean
  initialTab?: TabKey
  onConfirm: (items: ShortDramaPickedImage[]) => void
}

const isHttp = (v: string) => /^https?:\/\//i.test(v)

function useIdbMediaUrl(mediaId?: string) {
  const [url, setUrl] = useState<string>('')
  useEffect(() => {
    if (!mediaId) {
      setUrl('')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const rec = await getMedia(mediaId)
        if (cancelled) return
        setUrl(String(rec?.data || ''))
      } catch {
        if (cancelled) return
        setUrl('')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [mediaId])
  return url
}

function PickCard({
  selected,
  label,
  src,
  onClick,
}: {
  selected: boolean
  label: string
  src: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-xl border bg-[var(--bg-primary)] text-left',
        selected ? 'border-[var(--accent-color)] ring-2 ring-[rgb(var(--accent-rgb)/0.25)]' : 'border-[var(--border-color)] hover:border-[var(--accent-color)]'
      )}
    >
      <div className="relative flex h-28 w-full items-center justify-center bg-black/10">
        {src ? (
          <img src={src} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            <ImageIcon className="h-4 w-4 opacity-60" />
            无预览
          </div>
        )}
        {selected ? <div className="absolute right-2 top-2 rounded-full bg-[var(--accent-color)] px-2 py-0.5 text-xs text-white">已选</div> : null}
      </div>
      <div className="p-2">
        <div className="truncate text-xs font-medium text-[var(--text-primary)]">{label || '未命名'}</div>
      </div>
    </button>
  )
}

export default function ShortDramaMediaPickerModal({ open, onClose, title, multiple = true, initialTab = 'history', onConfirm }: Props) {
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({})

  const assets = useAssetsStore((s) => s.assets)
  const canvasNodes = useGraphStore((s) => (s as any).nodes || [])

  const itemsHistory = useMemo(() => {
    const list = (assets || []).filter((a) => a?.type === 'image')
    return list.map((a) => {
      const src = String(a?.src || '').trim()
      const label = String(a?.title || a?.id || '').trim() || '历史图片'
      const picked: ShortDramaPickedImage = {
        origin: 'history',
        id: String(a.id),
        label,
        sourceUrl: isHttp(src) ? src : undefined,
        displayUrl: !isHttp(src) ? src : undefined,
      }
      return picked
    })
  }, [assets])

  const itemsCanvas = useMemo(() => {
    const list = Array.isArray(canvasNodes) ? canvasNodes.filter((n: any) => n?.type === 'image') : []
    return list.map((n: any) => {
      const d: any = n?.data || {}
      const label = String(d?.label || n?.id || '').trim() || '画布图片'
      const url = String(d?.url || '').trim()
      const sourceUrl = String(d?.sourceUrl || '').trim()
      const mediaId = String(d?.mediaId || '').trim()
      const picked: ShortDramaPickedImage = {
        origin: 'canvas',
        id: String(n?.id || ''),
        label,
        sourceUrl: isHttp(sourceUrl) ? sourceUrl : isHttp(url) ? url : undefined,
        displayUrl: !isHttp(url) ? url : undefined,
        mediaId: mediaId || undefined,
      }
      return picked
    })
  }, [canvasNodes])

  const currentItems = tab === 'canvas' ? itemsCanvas : itemsHistory

  useEffect(() => {
    if (!open) return
    setTab(initialTab)
    setSelectedIds({})
  }, [open, initialTab])

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = { ...prev }
      const cur = !!next[id]
      if (!multiple) {
        return cur ? {} : { [id]: true }
      }
      next[id] = !cur
      return next
    })
  }

  const selectedCount = Object.values(selectedIds).filter(Boolean).length

  const confirm = () => {
    const selected = currentItems.filter((it) => selectedIds[it.id])
    onConfirm(selected)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="flex h-[min(80vh,760px)] w-[min(980px,96vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="text-sm font-semibold text-[var(--text-primary)]">{title || '选择图片'}</div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            type="button"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-3">
          <div className="flex items-center rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
            <Button size="sm" variant="ghost" className={cn('h-8 px-3', tab === 'history' ? 'bg-[var(--bg-secondary)]' : '')} onClick={() => setTab('history')}>
              历史素材
            </Button>
            <Button size="sm" variant="ghost" className={cn('h-8 px-3', tab === 'canvas' ? 'bg-[var(--bg-secondary)]' : '')} onClick={() => setTab('canvas')}>
              画布图片
            </Button>
          </div>
          <div className="text-xs text-[var(--text-secondary)]">
            已选 {selectedCount} {multiple ? '项' : '项（单选）'}
          </div>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {currentItems.length === 0 ? (
            <div className="rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-6 text-sm text-[var(--text-secondary)]">
              {tab === 'history' ? '暂无历史图片。先生成一些图片，或从画布导入。' : '画布中暂无图片节点。'}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {currentItems.map((it) => (
                <PickableItem key={it.id} item={it} selected={!!selectedIds[it.id]} onClick={() => toggle(it.id)} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-3">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button onClick={confirm} disabled={selectedCount === 0}>
            确认添加
          </Button>
        </div>
      </div>
    </div>
  )
}

function PickableItem({ item, selected, onClick }: { item: ShortDramaPickedImage; selected: boolean; onClick: () => void }) {
  const fromIdb = useIdbMediaUrl(item.mediaId)
  const src = String(item.sourceUrl || item.displayUrl || fromIdb || '').trim()
  return <PickCard selected={selected} label={item.label} src={src} onClick={onClick} />
}

