'use client'

import { usePathname } from 'next/navigation'

const pageTitles: Record<string, string> = {
  '/': 'Dashboard',
  '/connections': 'Connections',
  '/jobs/new': 'New Sync Job',
  '/jobs': 'Sync Jobs',
  '/explorer': 'Product Explorer',
  '/logs': 'Sync Logs',
  '/orders': 'Orders',
  '/settings': 'Settings',
}

export function Header() {
  const pathname = usePathname()
  const title = pageTitles[pathname] ?? 'WoOdoo'

  return (
    <header
      className="flex items-center justify-between px-7 h-16 border-b flex-shrink-0"
      style={{
        background: 'color-mix(in srgb, var(--card) 92%, #0b1220 8%)',
        borderColor: 'var(--border)',
      }}
    >
      <div>
        <h2 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
          {title}
        </h2>
        <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
          Operations dashboard
        </p>
      </div>
      <div
        className="rounded-full px-3 py-1 text-[11px] font-medium border"
        style={{
          borderColor: 'color-mix(in srgb, var(--primary) 35%, var(--border))',
          color: 'var(--primary)',
          background: 'color-mix(in srgb, var(--primary) 10%, transparent)',
        }}
      >
        Live
      </div>
    </header>
  )
}
