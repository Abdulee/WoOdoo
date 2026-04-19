import { cn } from '@/lib/utils'

interface PageContainerProps {
  children: React.ReactNode
  className?: string
}

export function PageContainer({ children, className }: PageContainerProps) {
  return (
    <div className={cn('px-6 py-7 xl:px-8 max-w-[1360px] mx-auto w-full', className)}>
      {children}
    </div>
  )
}
