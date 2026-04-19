'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { apiGet, getToken } from '@/lib/api'

/**
 * Client component that checks setup status and redirects to /setup if first run.
 * Wraps children and renders them only after the check passes (or on excluded paths).
 */
export function SetupGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checked, setChecked] = useState(false)

  // Paths that should NOT be guarded
  const isExcluded =
    pathname === '/setup' ||
    pathname === '/login' ||
    pathname.startsWith('/setup/')

  useEffect(() => {
    if (isExcluded) {
      queueMicrotask(() => {
        setChecked(true)
      })
      return
    }

    const token = getToken()
    if (!token) {
      queueMicrotask(() => {
        setChecked(true)
      })
      return
    }

    let cancelled = false

    apiGet<{ is_first_run: boolean }>('/api/setup/status')
      .then((data) => {
        if (cancelled) return
        if (data.is_first_run) {
          router.replace('/setup')
        } else {
          queueMicrotask(() => {
            setChecked(true)
          })
        }
      })
      .catch(() => {
        if (!cancelled) {
          queueMicrotask(() => {
            setChecked(true)
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [pathname, isExcluded, router])

  if (!checked && !isExcluded) {
    return null
  }

  return <>{children}</>
}
