import React, { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useGraphStore } from '@/graph/store'
import { X } from 'lucide-react'

const getString = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v))

export default function NodeRemarkModal({
  open,
  nodeId,
  onClose,
}: {
  open: boolean
  nodeId: string | null
  onClose: () => void
}) {
  const node = useGraphStore((s) => (nodeId ? s.nodes.find((n) => n.id === nodeId) || null : null))
  const updateNode = useGraphStore((s) => s.updateNode)

  const title = useMemo(() => {
    if (!node) return '备注'
    const label = getString((node.data as any)?.label) || node.type
    return `备注 · ${label}`
  }, [node])

  const initial = useMemo(() => getString((node?.data as any)?.remark || ''), [node])
  const [value, setValue] = useState(initial)

  useEffect(() => {
    if (!open) return
    setValue(initial)
  }, [initial, open])

  if (!open || !nodeId) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex w-[560px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5">
          <Textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="为这个节点写点备注（仅文本）…"
            className="min-h-[180px]"
          />
          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="secondary"
              onClick={() => {
                setValue('')
              }}
            >
              清空
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={onClose}>
                取消
              </Button>
              <Button
                onClick={() => {
                  const next = String(value || '')
                  updateNode(nodeId, { data: { remark: next } } as any)
                  onClose()
                }}
              >
                保存
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

