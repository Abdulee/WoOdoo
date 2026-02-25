'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Plug,
  Wand2,
  ListChecks,
  Search,
  FileText,
  ShoppingCart,
  Settings,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/connections', label: 'Connections', icon: Plug },
  { href: '/jobs/new', label: 'New Sync Job', icon: Wand2 },
  { href: '/jobs', label: 'Sync Jobs', icon: ListChecks },
  { href: '/explorer', label: 'Product Explorer', icon: Search },
  { href: '/logs', label: 'Sync Logs', icon: FileText },
  { href: '/orders', label: 'Orders', icon: ShoppingCart },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="flex flex-col w-64 h-screen flex-shrink-0 border-r"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--border)',
      }}
    >
      {/* Logo Header */}
      <div
        className="flex items-center gap-3 px-4 py-4 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="relative w-8 h-8 flex-shrink-0">
          <Image
            src="/woodoo-logo.png"
            alt="WoOdoo"
            width={32}
            height={32}
            className="object-contain"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none'
            }}
          />
        </div>
        <div>
          <span className="text-lg font-bold" style={{ color: 'var(--primary)' }}>
            Wo
          </span>
          <span className="text-lg font-bold" style={{ color: 'var(--secondary)' }}>
            Odoo
          </span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-3" role="navigation" aria-label="Main navigation">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive =
              item.href === '/'
                ? pathname === '/'
                : pathname === item.href || pathname.startsWith(item.href + '/')

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'text-white'
                      : 'hover:text-white'
                  )}
                  style={
                    isActive
                      ? {
                          background: 'color-mix(in srgb, var(--primary) 20%, transparent)',
                          color: 'var(--primary)',
                        }
                      : {
                          color: 'var(--muted-foreground)',
                        }
                  }
                >
                  <Icon size={18} className="flex-shrink-0" />
                  {item.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div
        className="px-4 py-3 text-xs border-t"
        style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}
      >
        WoOdoo v0.1.0
      </div>
    </aside>
  )
}
