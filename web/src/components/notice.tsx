import { CircleAlert, CircleCheck, TriangleAlert, X } from 'lucide-react'

import { cn } from '@/lib/utils'

export interface NoticeState {
  kind: 'success' | 'error' | 'warning'
  text: string
}

const icons = { success: CircleCheck, error: CircleAlert, warning: TriangleAlert }

export function Notice({ notice, onDismiss }: { notice: NoticeState; onDismiss?: () => void }) {
  const Icon = icons[notice.kind]
  return (
    <div
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        notice.kind === 'success' && 'border-success/30 bg-success/10',
        notice.kind === 'error' && 'border-destructive/30 bg-destructive/10 text-destructive',
        notice.kind === 'warning' && 'border-warning/40 bg-warning/10',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" />
      <p className="flex-1 whitespace-pre-line">{notice.text}</p>
      {onDismiss && (
        <button onClick={onDismiss} aria-label="Fermer" className="opacity-60 hover:opacity-100">
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}
