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
      className="flex flex-col w-72 h-screen flex-shrink-0 border-r"
      style={{
        background: 'var(--sidebar-bg)',
        borderColor: 'var(--border)',
      }}
    >
      <div
        className="flex items-center gap-3 px-5 py-4 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="relative w-8 h-8 flex-shrink-0 rounded-lg overflow-hidden border" style={{ borderColor: 'color-mix(in srgb, var(--primary) 35%, var(--border))' }}>
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
        <div className="leading-tight">
          <div>
            <span className="text-lg font-semibold" style={{ color: 'var(--primary)' }}>
              Wo
            </span>
            <span className="text-lg font-semibold" style={{ color: 'var(--secondary)' }}>
              Odoo
            </span>
          </div>
          <p className="text-[11px] tracking-[0.14em] uppercase" style={{ color: 'var(--muted-foreground)' }}>
            Sync Control
          </p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" role="navigation" aria-label="Main navigation">
        <ul className="space-y-1.5">
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
                    'group flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium border',
                    isActive ? 'text-white' : 'hover:text-white'
                  )}
                  style={
                    isActive
                      ? {
                          background: 'linear-gradient(90deg, color-mix(in srgb, var(--primary) 24%, transparent) 0%, color-mix(in srgb, var(--secondary) 18%, transparent) 100%)',
                          color: 'var(--foreground)',
                          borderColor: 'color-mix(in srgb, var(--primary) 40%, var(--border))',
                          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--primary) 22%, transparent)',
                        }
                      : {
                          color: 'var(--muted-foreground)',
                          borderColor: 'transparent',
                        }
                  }
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-lg"
                    style={{
                      background: isActive
                        ? 'color-mix(in srgb, var(--primary) 26%, transparent)'
                        : 'color-mix(in srgb, var(--muted) 80%, transparent)',
                    }}
                  >
                    <Icon size={17} className="flex-shrink-0" />
                  </span>
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div
        className="mx-4 mb-4 rounded-xl border px-3.5 py-3"
        style={{
          borderColor: 'color-mix(in srgb, var(--secondary) 20%, var(--border))',
          background: 'color-mix(in srgb, var(--secondary) 7%, transparent)',
        }}
      >
        <p className="text-xs font-medium" style={{ color: 'var(--foreground)' }}>
          Need a fresh sync?
        </p>
        <p className="mt-1 text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
          Run it from Jobs and track live progress from any page.
        </p>
      </div>

      <div
        className="px-5 py-3 text-xs border-t"
        style={{ color: 'var(--muted-foreground)', borderColor: 'var(--border)' }}
      >
        WoOdoo v0.1.0
      </div>
    </aside>
  )
}
