/**
 * Workflow Templates Modal | 工作流模板弹窗
 * 显示预设工作流模板，支持一键添加到画布
 */

import React from 'react'
import { Button } from '@/components/ui/button'
import { X, LayoutGrid, Layers } from 'lucide-react'
import { WORKFLOW_TEMPLATES } from '@/config/workflows'

interface Props {
  open: boolean
  onClose: () => void
  onSelectTemplate: (templateId: string) => void
}

export default function WorkflowTemplatesModal({ open, onClose, onSelectTemplate }: Props) {
  if (!open) return null

  const handleSelect = (templateId: string) => {
    onSelectTemplate(templateId)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        className="flex max-h-[80vh] w-[700px] max-w-[95vw] flex-col overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--bg-secondary)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border-color)] px-5 py-4">
          <div className="flex items-center gap-3">
            <LayoutGrid className="h-5 w-5 text-[var(--accent-color)]" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">工作流模板</h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {WORKFLOW_TEMPLATES.map((template: any) => (
              <div
                key={template.id}
                className="group cursor-pointer overflow-hidden rounded-xl border border-[var(--border-color)] bg-[var(--bg-primary)] transition-all hover:border-[var(--accent-color)] hover:shadow-lg"
                onClick={() => handleSelect(template.id)}
              >
                {/* Cover image */}
                <div className="aspect-video bg-gradient-to-br from-[var(--accent-color)]/20 to-[var(--accent-color)]/5 relative overflow-hidden">
                  {template.cover ? (
                    <img
                      src={template.cover}
                      alt={template.name}
                      className="h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Layers className="h-12 w-12 text-[var(--accent-color)]/50" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  <div className="absolute bottom-3 left-3 right-3">
                    <h3 className="text-base font-semibold text-white">{template.name}</h3>
                  </div>
                </div>

                {/* Info */}
                <div className="p-3">
                  <p className="text-sm text-[var(--text-secondary)] line-clamp-2">
                    {template.description}
                  </p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="rounded-full bg-[var(--bg-tertiary)] px-2 py-0.5 text-xs text-[var(--text-secondary)]">
                      {template.category === 'storyboard' ? '分镜' : template.category}
                    </span>
                    <Button size="sm" variant="ghost" className="text-[var(--accent-color)]">
                      使用模板
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {WORKFLOW_TEMPLATES.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-[var(--text-secondary)]">
              <LayoutGrid className="mb-3 h-12 w-12 opacity-40" />
              <div className="text-sm">暂无工作流模板</div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-[var(--border-color)] p-4">
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </div>
      </div>
    </div>
  )
}
