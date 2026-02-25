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
      className="flex items-center px-6 h-14 border-b flex-shrink-0"
      style={{
        background: 'var(--card)',
        borderColor: 'var(--border)',
      }}
    >
      <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
        {title}
      </h2>
    </header>
  )
}
