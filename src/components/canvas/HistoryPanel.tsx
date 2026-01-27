/**
 * History Panel | 历史素材面板
 * 显示已生成的图片/视频/音频历史记录
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import {
  useAssetsStore,
  getAssetThumbnail,
  getLocalCacheUrl,
  enqueueThumbnails,
  enqueueLocalCache,
  type Asset,
  type AssetType,
  type HistoryPerformanceMode
} from '@/store/assets'
import {
  X,
  Image as ImageIcon,
  Video,
  Music,
  Trash2
} from 'lucide-react'

interface Props {
  onClose: () => void
  onAddToCanvas: (asset: Asset) => void
}

type TabId = 'image' | 'video' | 'audio'

export default function HistoryPanel({ onClose, onAddToCanvas }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('image')
  const [visibleCount, setVisibleCount] = useState(40)
  const [localCacheFailures, setLocalCacheFailures] = useState<Set<string>>(new Set())

  const assets = useAssetsStore((s) => s.assets)
  const historyPerformanceMode = useAssetsStore((s) => s.historyPerformanceMode)
  const localCacheEnabled = useAssetsStore((s) => s.localCacheEnabled)
  const setHistoryPerformanceMode = useAssetsStore((s) => s.setHistoryPerformanceMode)
  const removeAsset = useAssetsStore((s) => s.removeAsset)

  // Filtered assets by type
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => a.type === activeTab)
  }, [assets, activeTab])

  // Visible assets (virtualization)
  const visibleAssets = useMemo(() => {
    return filteredAssets.slice(0, visibleCount)
  }, [filteredAssets, visibleCount])

  // Can load more
  const canLoadMore = filteredAssets.length > visibleCount

  // Reset visible count when tab changes
  useEffect(() => {
    setVisibleCount(40)
  }, [activeTab])

  // Enqueue thumbnails and local cache
  useEffect(() => {
    enqueueThumbnails(filteredAssets, historyPerformanceMode)
    enqueueLocalCache(filteredAssets)
  }, [filteredAssets, historyPerformanceMode, localCacheEnabled])

  // Reset failures when local cache is enabled
  useEffect(() => {
    if (localCacheEnabled) {
      setLocalCacheFailures(new Set())
    }
  }, [localCacheEnabled])

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => Math.min(filteredAssets.length, prev + 40))
  }, [filteredAssets.length])

  const getDisplaySrc = useCallback(
    (asset: Asset): string => {
      if (!asset) return ''

      // Try local cache first
      if (!localCacheFailures.has(asset.id)) {
        const localUrl = getLocalCacheUrl(asset)
        if (localUrl) return localUrl
      }

      // Try thumbnail
      if (historyPerformanceMode !== 'off' && asset.type === 'image') {
        const thumb = getAssetThumbnail(asset, historyPerformanceMode)
        if (thumb) return thumb
      }

      return asset.src
    },
    [historyPerformanceMode, localCacheFailures]
  )

  const handleMediaError = useCallback((asset: Asset) => {
    if (!asset) return
    setLocalCacheFailures((prev) => {
      const next = new Set(prev)
      next.add(asset.id)
      return next
    })
  }, [])

  const handleDragStart = useCallback((e: React.DragEvent, asset: Asset) => {
    e.dataTransfer.setData(
      'application/json',
      JSON.stringify({
        type: asset.type,
        src: asset.src,
        title: asset.title,
        model: asset.model,
        duration: asset.duration
      })
    )
    e.dataTransfer.effectAllowed = 'copy'
  }, [])

  const handleDelete = useCallback(
    (id: string) => {
      removeAsset(id)
    },
    [removeAsset]
  )

  const tabs: Array<{ id: TabId; label: string; icon: React.ReactNode }> = [
    { id: 'image', label: '图片', icon: <ImageIcon className="h-3.5 w-3.5" /> },
    { id: 'video', label: '视频', icon: <Video className="h-3.5 w-3.5" /> },
    { id: 'audio', label: '音频', icon: <Music className="h-3.5 w-3.5" /> }
  ]

  const performanceModes: Array<{ value: HistoryPerformanceMode; label: string }> = [
    { value: 'ultra', label: '极速' },
    { value: 'normal', label: '普通' },
    { value: 'off', label: '关闭' }
  ]

  return (
    <div className="flex h-full w-[300px] flex-col border-l border-[var(--border-color)] bg-[var(--bg-secondary)]">
      {/* Header */}
      <div className="border-b border-[var(--border-color)] p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--text-primary)]">历史素材</span>
          <div className="flex items-center gap-2">
            {/* Performance mode toggle */}
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1 text-[11px]">
              {performanceModes.map((mode) => (
                <button
                  key={mode.value}
                  onClick={() => setHistoryPerformanceMode(mode.value)}
                  className={cn(
                    'rounded-md px-2 py-1 transition-colors',
                    historyPerformanceMode === mode.value
                      ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)]'
                  )}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <button
              onClick={onClose}
              className="rounded p-1 transition-colors hover:bg-[var(--bg-tertiary)]"
            >
              <X className="h-4 w-4 text-[var(--text-secondary)]" />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex rounded-lg border border-[var(--border-color)] bg-[var(--bg-primary)] p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-md py-2 text-xs font-medium transition-colors',
                activeTab === tab.id
                  ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {filteredAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-[var(--text-secondary)]">
            {activeTab === 'image' && <ImageIcon className="h-11 w-11 opacity-60" />}
            {activeTab === 'video' && <Video className="h-11 w-11 opacity-60" />}
            {activeTab === 'audio' && <Music className="h-11 w-11 opacity-60" />}
            <div className="mt-3 text-xs font-medium">
              暂无{activeTab === 'image' ? '图片' : activeTab === 'video' ? '视频' : '音频'}
            </div>
            <div className="mt-1 text-[11px] opacity-70">生成后会自动出现在这里</div>
          </div>
        ) : activeTab === 'audio' ? (
          // Audio list
          <div className="space-y-3">
            {visibleAssets.map((asset) => (
              <div
                key={asset.id}
                className="group cursor-grab rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-3 transition-colors hover:border-[var(--accent-color)] active:cursor-grabbing"
                draggable
                onDragStart={(e) => handleDragStart(e, asset)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--bg-tertiary)]">
                      <Music className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{asset.title || '音频'}</div>
                      <div className="truncate text-[11px] text-[var(--text-secondary)]">
                        {asset.model || 'Suno'}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      className="rounded-md border border-[var(--border-color)] px-2 py-1 text-[11px] transition-colors hover:border-[var(--accent-color)]"
                      onClick={() => onAddToCanvas(asset)}
                    >
                      上板
                    </button>
                    <button
                      className="rounded-md bg-[var(--bg-tertiary)] p-1.5 text-[var(--text-secondary)] transition-colors hover:bg-red-500/20 hover:text-red-500"
                      title="删除"
                      onClick={() => handleDelete(asset.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <audio src={asset.src} controls className="mt-2 w-full" onClick={(e) => e.stopPropagation()} />
              </div>
            ))}
          </div>
        ) : (
          // Image/Video grid
          <div className="grid grid-cols-2 gap-3">
            {visibleAssets.map((asset) => (
              <div
                key={asset.id}
                className="group relative aspect-square cursor-grab overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] transition-colors hover:border-[var(--accent-color)] active:cursor-grabbing"
                draggable
                onDragStart={(e) => handleDragStart(e, asset)}
                onClick={() => onAddToCanvas(asset)}
              >
                {asset.type === 'image' ? (
                  <img
                    src={getDisplaySrc(asset)}
                    alt={asset.title || '历史图片'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    onError={() => handleMediaError(asset)}
                  />
                ) : (
                  <video
                    src={getDisplaySrc(asset)}
                    className="h-full w-full object-cover"
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
                    onMouseLeave={(e) => (e.target as HTMLVideoElement).pause()}
                    onError={() => handleMediaError(asset)}
                  />
                )}

                {/* Delete button */}
                <button
                  className="absolute right-2 top-2 rounded-lg bg-black/40 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/60 group-hover:opacity-100"
                  title="删除"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(asset.id)
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>

                {/* Title overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent p-2">
                  <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-white/90">
                    {asset.title || (asset.type === 'video' ? '视频' : '图片')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Load more button */}
        {canLoadMore && (
          <div className="mt-4 flex justify-center">
            <button
              className="rounded-lg border border-[var(--border-color)] px-3 py-1.5 text-xs transition-colors hover:border-[var(--accent-color)]"
              onClick={loadMore}
            >
              加载更多
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
