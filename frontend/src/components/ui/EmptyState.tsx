import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  description?: string
  icon?: LucideIcon
  children?: React.ReactNode
  className?: string
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  children,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 px-4 text-center rounded-2xl border',
        className
      )}
      style={{
        background: 'color-mix(in srgb, var(--muted) 45%, transparent)',
        borderColor: 'color-mix(in srgb, var(--border) 82%, transparent)',
      }}
    >
      {Icon && (
        <div
          className="mb-4 p-4 rounded-2xl"
          style={{
            background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
            border: '1px solid color-mix(in srgb, var(--primary) 30%, transparent)',
          }}
        >
          <Icon size={30} style={{ color: 'var(--primary)' }} />
        </div>
      )}
      <h3 className="text-xl font-semibold mb-2 tracking-tight" style={{ color: 'var(--foreground)' }}>
        {title}
      </h3>
      {description && (
        <p className="text-sm max-w-md leading-relaxed" style={{ color: 'var(--muted-foreground)' }}>
          {description}
        </p>
      )}
      {children && <div className="mt-7">{children}</div>}
    </div>
  )
}
