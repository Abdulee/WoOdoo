import { cn } from '@/lib/utils'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  sm: 'w-4 h-4 border-2',
  md: 'w-8 h-8 border-4',
  lg: 'w-12 h-12 border-4',
}

export function LoadingSpinner({ size = 'md', className }: LoadingSpinnerProps) {
  return (
    <div
      className={cn(
        'rounded-full animate-spin border-t-transparent',
        sizeMap[size],
        className
      )}
      style={{
        borderColor: 'var(--primary)',
        borderTopColor: 'transparent',
      }}
      role="status"
      aria-label="Loading"
    />
  )
}
