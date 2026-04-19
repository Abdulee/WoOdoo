'use client'

import { useEffect, useRef, useState } from 'react'
import type { SyncProgressState } from '@/hooks/useWebSocketSync'

interface SyncProgressOverlayProps {
  progress: SyncProgressState
  onDismiss?: () => void
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength - 1) + '…'
}

export function SyncProgressOverlay({ progress, onDismiss }: SyncProgressOverlayProps) {
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const shouldShow =
    !dismissed && (progress.isActive || progress.status === 'completed' || progress.status === 'error')

  // Animate in/out
  useEffect(() => {
    if (shouldShow) {
      const raf = requestAnimationFrame(() => setVisible(true))
      return () => cancelAnimationFrame(raf)
    } else {
      queueMicrotask(() => {
        setVisible(false)
      })
    }
  }, [shouldShow])

  // Auto-dismiss on complete after 3 seconds
  useEffect(() => {
    if (progress.status === 'completed') {
      autoDismissRef.current = setTimeout(() => {
        setDismissed(true)
        onDismiss?.()
      }, 3000)
    }
    return () => {
      if (autoDismissRef.current) {
        clearTimeout(autoDismissRef.current)
        autoDismissRef.current = null
      }
    }
  }, [progress.status, onDismiss])

  // Reset dismissed state when a new sync starts
  useEffect(() => {
    if (progress.status === 'running') {
      queueMicrotask(() => {
        setDismissed(false)
      })
    }
  }, [progress.status])

  if (!shouldShow) return null

  const percentage = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0

  const headerText =
    progress.status === 'completed'
      ? 'Sync Complete ✓'
      : progress.status === 'error'
        ? 'Sync Failed ✗'
        : 'Syncing...'

  const headerColor =
    progress.status === 'completed'
      ? 'var(--primary)'
      : progress.status === 'error'
        ? 'var(--destructive)'
        : 'var(--foreground)'

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1.5rem',
        right: '1.5rem',
        zIndex: 9999,
        width: '22rem',
        maxWidth: 'calc(100vw - 2rem)',
        backgroundColor: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        padding: '1rem',
        transform: visible ? 'translateY(0)' : 'translateY(120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.3s ease-out, opacity 0.3s ease-out',
      }}
      role="status"
      aria-live="polite"
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.75rem',
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: '0.875rem',
            color: headerColor,
          }}
        >
          {headerText}
        </span>
        <button
          onClick={handleDismiss}
          aria-label="Dismiss sync progress"
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            fontSize: '1.125rem',
            lineHeight: 1,
            padding: '0.25rem',
          }}
        >
          ✕
        </button>
      </div>

      {/* Phase indicator */}
      {progress.phaseName && progress.status === 'running' && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--muted-foreground)',
            marginBottom: '0.5rem',
          }}
        >
          Phase: {progress.phaseName}
        </div>
      )}

      {/* Progress bar */}
      {progress.status === 'running' && (
        <div
          style={{
            width: '100%',
            height: '0.375rem',
            backgroundColor: 'var(--muted)',
            borderRadius: '9999px',
            overflow: 'hidden',
            marginBottom: '0.5rem',
          }}
        >
          <div
            style={{
              width: `${percentage}%`,
              height: '100%',
              backgroundColor: 'var(--primary)',
              borderRadius: '9999px',
              transition: 'width 0.3s ease-out',
            }}
          />
        </div>
      )}

      {/* Stats line */}
      {progress.status === 'running' && progress.total > 0 && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.75rem',
            color: 'var(--muted-foreground)',
            marginBottom: '0.375rem',
          }}
        >
          <span>
            {progress.processed} / {progress.total}
          </span>
          <span>{percentage}%</span>
        </div>
      )}

      {/* Current product */}
      {progress.currentProduct && progress.status === 'running' && (
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--muted-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {truncate(progress.currentProduct, 30)}
        </div>
      )}

      {/* Error message */}
      {progress.errorMessage && (
        <div
          style={{
            fontSize: '0.75rem',
            color: progress.status === 'error' ? 'var(--destructive)' : 'var(--muted-foreground)',
            marginTop: '0.25rem',
          }}
        >
          {progress.errorMessage}
        </div>
      )}
    </div>
  )
}
