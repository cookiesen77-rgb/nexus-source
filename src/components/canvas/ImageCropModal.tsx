/**
 * Image Crop Modal | 图片裁剪弹窗
 * 支持自由裁剪和预设比例裁剪
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { X, RotateCcw, Check } from 'lucide-react'

interface Props {
  open: boolean
  imageUrl: string
  onClose: () => void
  onCrop: (croppedDataUrl: string) => void
}

interface CropArea {
  x: number
  y: number
  width: number
  height: number
}

interface DragState {
  isDragging: boolean
  type: 'move' | 'resize' | null
  handle: string | null
  startX: number
  startY: number
  startCrop: CropArea
}

const ASPECT_RATIOS = [
  { label: '自由', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

export default function ImageCropModal({ open, imageUrl, onClose, onCrop }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [imageLoaded, setImageLoaded] = useState(false)
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 })
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 })
  const [cropArea, setCropArea] = useState<CropArea>({ x: 0, y: 0, width: 0, height: 0 })
  const [aspectRatio, setAspectRatio] = useState<number | null>(null)
  
  // 使用 ref 存储拖动状态，避免频繁的状态更新
  const dragRef = useRef<DragState>({
    isDragging: false,
    type: null,
    handle: null,
    startX: 0,
    startY: 0,
    startCrop: { x: 0, y: 0, width: 0, height: 0 }
  })
  const rafRef = useRef<number | null>(null)

  // 加载图片并初始化裁剪区域
  useEffect(() => {
    if (!open || !imageUrl) return
    
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height })
      setImageLoaded(true)
    }
    img.onerror = () => {
      console.error('Failed to load image for cropping')
    }
    img.src = imageUrl
    
    return () => {
      setImageLoaded(false)
    }
  }, [open, imageUrl])

  // 计算显示尺寸和初始裁剪区域
  useEffect(() => {
    if (!imageLoaded || !containerRef.current) return
    
    const container = containerRef.current
    const maxWidth = container.clientWidth - 40
    const maxHeight = container.clientHeight - 40
    
    let displayW = imageSize.width
    let displayH = imageSize.height
    
    // 缩放以适应容器
    if (displayW > maxWidth) {
      displayH = (displayH * maxWidth) / displayW
      displayW = maxWidth
    }
    if (displayH > maxHeight) {
      displayW = (displayW * maxHeight) / displayH
      displayH = maxHeight
    }
    
    setDisplaySize({ width: displayW, height: displayH })
    
    // 初始裁剪区域为图片中心 80%
    const initialW = displayW * 0.8
    const initialH = displayH * 0.8
    setCropArea({
      x: (displayW - initialW) / 2,
      y: (displayH - initialH) / 2,
      width: initialW,
      height: initialH,
    })
  }, [imageLoaded, imageSize])

  // 应用宽高比
  const applyAspectRatio = useCallback((ratio: number | null) => {
    setAspectRatio(ratio)
    if (ratio === null) return
    
    setCropArea((prev) => {
      let newW = prev.width
      let newH = prev.height
      
      // 保持中心点，调整尺寸
      const currentRatio = prev.width / prev.height
      if (currentRatio > ratio) {
        newW = prev.height * ratio
      } else {
        newH = prev.width / ratio
      }
      
      // 确保不超出边界
      newW = Math.min(newW, displaySize.width)
      newH = Math.min(newH, displaySize.height)
      
      const newX = prev.x + (prev.width - newW) / 2
      const newY = prev.y + (prev.height - newH) / 2
      
      return {
        x: Math.max(0, Math.min(newX, displaySize.width - newW)),
        y: Math.max(0, Math.min(newY, displaySize.height - newH)),
        width: newW,
        height: newH,
      }
    })
  }, [displaySize])

  // 鼠标事件处理 - 使用 ref 和 RAF 优化性能
  const handleMouseDown = useCallback((e: React.MouseEvent, type: 'move' | 'resize', handle?: string) => {
    e.preventDefault()
    e.stopPropagation()
    
    dragRef.current = {
      isDragging: true,
      type,
      handle: handle || null,
      startX: e.clientX,
      startY: e.clientY,
      startCrop: { ...cropArea }
    }
  }, [cropArea])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current.isDragging) return
    
    // 使用 RAF 节流
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
    }
    
    const clientX = e.clientX
    const clientY = e.clientY
    
    rafRef.current = requestAnimationFrame(() => {
      const { type, handle, startX, startY, startCrop } = dragRef.current
      const dx = clientX - startX
      const dy = clientY - startY
      
      let newArea = { ...startCrop }
      
      if (type === 'move') {
        newArea.x = Math.max(0, Math.min(startCrop.x + dx, displaySize.width - startCrop.width))
        newArea.y = Math.max(0, Math.min(startCrop.y + dy, displaySize.height - startCrop.height))
      } else if (type === 'resize' && handle) {
        switch (handle) {
          case 'se':
            newArea.width = Math.max(50, Math.min(startCrop.width + dx, displaySize.width - startCrop.x))
            newArea.height = aspectRatio 
              ? newArea.width / aspectRatio 
              : Math.max(50, Math.min(startCrop.height + dy, displaySize.height - startCrop.y))
            break
          case 'sw':
            const newWidthSW = Math.max(50, startCrop.width - dx)
            newArea.x = startCrop.x + startCrop.width - newWidthSW
            newArea.width = newWidthSW
            newArea.height = aspectRatio 
              ? newArea.width / aspectRatio 
              : Math.max(50, Math.min(startCrop.height + dy, displaySize.height - startCrop.y))
            break
          case 'ne':
            newArea.width = Math.max(50, Math.min(startCrop.width + dx, displaySize.width - startCrop.x))
            const newHeightNE = aspectRatio 
              ? newArea.width / aspectRatio 
              : Math.max(50, startCrop.height - dy)
            newArea.y = startCrop.y + startCrop.height - newHeightNE
            newArea.height = newHeightNE
            break
          case 'nw':
            const newWidthNW = Math.max(50, startCrop.width - dx)
            const newHeightNW = aspectRatio 
              ? newWidthNW / aspectRatio 
              : Math.max(50, startCrop.height - dy)
            newArea.x = startCrop.x + startCrop.width - newWidthNW
            newArea.y = startCrop.y + startCrop.height - newHeightNW
            newArea.width = newWidthNW
            newArea.height = newHeightNW
            break
        }
        
        newArea.x = Math.max(0, newArea.x)
        newArea.y = Math.max(0, newArea.y)
        newArea.width = Math.min(newArea.width, displaySize.width - newArea.x)
        newArea.height = Math.min(newArea.height, displaySize.height - newArea.y)
      }
      
      setCropArea(newArea)
    })
  }, [displaySize, aspectRatio])

  const handleMouseUp = useCallback(() => {
    dragRef.current.isDragging = false
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  // 重置裁剪区域
  const handleReset = useCallback(() => {
    const initialW = displaySize.width * 0.8
    const initialH = displaySize.height * 0.8
    setCropArea({
      x: (displaySize.width - initialW) / 2,
      y: (displaySize.height - initialH) / 2,
      width: initialW,
      height: initialH,
    })
    setAspectRatio(null)
  }, [displaySize])

  // 执行裁剪
  const handleCrop = useCallback(() => {
    if (!imageLoaded) return
    
    // 计算实际图片上的裁剪区域
    const scaleX = imageSize.width / displaySize.width
    const scaleY = imageSize.height / displaySize.height
    
    const realCrop = {
      x: cropArea.x * scaleX,
      y: cropArea.y * scaleY,
      width: cropArea.width * scaleX,
      height: cropArea.height * scaleY,
    }
    
    // 创建 canvas 进行裁剪
    const canvas = document.createElement('canvas')
    canvas.width = realCrop.width
    canvas.height = realCrop.height
    
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.drawImage(
        img,
        realCrop.x, realCrop.y, realCrop.width, realCrop.height,
        0, 0, realCrop.width, realCrop.height
      )
      
      const croppedDataUrl = canvas.toDataURL('image/png')
      onCrop(croppedDataUrl)
      onClose()
    }
    img.src = imageUrl
  }, [imageLoaded, imageSize, displaySize, cropArea, imageUrl, onCrop, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="flex h-[min(85vh,800px)] w-[min(1000px,95vw)] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">裁剪图片</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Aspect Ratio Selector */}
        <div className="flex items-center gap-2 border-b border-[var(--border-color)] px-5 py-3">
          <span className="text-xs text-[var(--text-secondary)]">比例：</span>
          {ASPECT_RATIOS.map((ratio) => (
            <button
              key={ratio.label}
              onClick={() => applyAspectRatio(ratio.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                aspectRatio === ratio.value
                  ? 'border-[var(--accent-color)] bg-[rgb(var(--accent-rgb)/0.1)] text-[var(--accent-color)]'
                  : 'border-[var(--border-color)] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]'
              )}
            >
              {ratio.label}
            </button>
          ))}
        </div>

        {/* Crop Area */}
        <div
          ref={containerRef}
          className="relative flex flex-1 items-center justify-center overflow-hidden bg-[var(--bg-primary)] p-5"
        >
          {imageLoaded && displaySize.width > 0 && (
            <div
              className="relative select-none"
              style={{ width: displaySize.width, height: displaySize.height }}
            >
              {/* 原图（变暗） */}
              <img
                ref={imageRef}
                src={imageUrl}
                alt="Crop preview"
                className="absolute inset-0 h-full w-full object-contain opacity-40"
                draggable={false}
              />
              
              {/* 裁剪区域（亮） */}
              <div
                className="absolute cursor-move overflow-hidden border-2 border-white shadow-lg"
                style={{
                  left: cropArea.x,
                  top: cropArea.y,
                  width: cropArea.width,
                  height: cropArea.height,
                }}
                onMouseDown={(e) => handleMouseDown(e, 'move')}
              >
                <img
                  src={imageUrl}
                  alt="Crop area"
                  className="absolute"
                  style={{
                    left: -cropArea.x,
                    top: -cropArea.y,
                    width: displaySize.width,
                    height: displaySize.height,
                  }}
                  draggable={false}
                />
                
                {/* 网格线 */}
                <div className="pointer-events-none absolute inset-0">
                  <div className="absolute left-1/3 top-0 h-full w-px bg-white/50" />
                  <div className="absolute left-2/3 top-0 h-full w-px bg-white/50" />
                  <div className="absolute left-0 top-1/3 h-px w-full bg-white/50" />
                  <div className="absolute left-0 top-2/3 h-px w-full bg-white/50" />
                </div>
                
                {/* 缩放手柄 */}
                {['nw', 'ne', 'sw', 'se'].map((handle) => (
                  <div
                    key={handle}
                    className={cn(
                      'absolute h-4 w-4 rounded-full border-2 border-white bg-[var(--accent-color)]',
                      handle.includes('n') ? '-top-2' : '-bottom-2',
                      handle.includes('w') ? '-left-2' : '-right-2',
                      handle === 'nw' && 'cursor-nw-resize',
                      handle === 'ne' && 'cursor-ne-resize',
                      handle === 'sw' && 'cursor-sw-resize',
                      handle === 'se' && 'cursor-se-resize'
                    )}
                    onMouseDown={(e) => handleMouseDown(e, 'resize', handle)}
                  />
                ))}
              </div>
            </div>
          )}
          
          {!imageLoaded && (
            <div className="text-sm text-[var(--text-secondary)]">加载图片中...</div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[var(--border-color)] px-5 py-4">
          <div className="text-xs text-[var(--text-secondary)]">
            裁剪尺寸: {Math.round(cropArea.width * (imageSize.width / displaySize.width))} x {Math.round(cropArea.height * (imageSize.height / displaySize.height))} px
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={handleReset}>
              <RotateCcw className="mr-2 h-4 w-4" />
              重置
            </Button>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={handleCrop} disabled={!imageLoaded}>
              <Check className="mr-2 h-4 w-4" />
              确认裁剪
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
