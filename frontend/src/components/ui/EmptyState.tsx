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
        'flex flex-col items-center justify-center py-16 px-4 text-center',
        className
      )}
    >
      {Icon && (
        <div
          className="mb-4 p-4 rounded-full"
          style={{ background: 'var(--muted)' }}
        >
          <Icon size={32} style={{ color: 'var(--muted-foreground)' }} />
        </div>
      )}
      <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
        {title}
      </h3>
      {description && (
        <p className="text-sm max-w-sm" style={{ color: 'var(--muted-foreground)' }}>
          {description}
        </p>
      )}
      {children && <div className="mt-6">{children}</div>}
    </div>
  )
}
