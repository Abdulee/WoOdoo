'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getToken } from '@/lib/api'

export interface SyncProgressState {
  isActive: boolean
  jobId: number | null
  executionId: number | null
  phase: string | null
  phaseName: string | null
  processed: number
  total: number
  currentProduct: string | null
  status: 'idle' | 'running' | 'completed' | 'error'
  errorMessage: string | null
}

const PHASE_NAMES: Record<string, string> = {
  categories: 'Categories (1/4)',
  products: 'Products (2/4)',
  images: 'Images (3/4)',
  stock: 'Stock (4/4)',
}

const INITIAL_STATE: SyncProgressState = {
  isActive: false,
  jobId: null,
  executionId: null,
  phase: null,
  phaseName: null,
  processed: 0,
  total: 0,
  currentProduct: null,
  status: 'idle',
  errorMessage: null,
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 2000

export function useWebSocketSync(): {
  progress: SyncProgressState
  connect: (executionId: number) => void
  disconnect: () => void
} {
  const [progress, setProgress] = useState<SyncProgressState>(INITIAL_STATE)
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const executionIdRef = useRef<number | null>(null)
  const intentionalCloseRef = useRef(false)

  const cleanup = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current)
      retryTimeoutRef.current = null
    }
    if (wsRef.current) {
      intentionalCloseRef.current = true
      wsRef.current.close()
      wsRef.current = null
    }
  }, [])

  const connectWs = useCallback((execId: number) => {
    const token = getToken()
    if (!token) {
      return
    }

    cleanup()
    intentionalCloseRef.current = false
    executionIdRef.current = execId
    retriesRef.current = 0

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
    const url = `${wsUrl}/api/ws/sync?token=${token}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    setProgress({
      ...INITIAL_STATE,
      executionId: execId,
      isActive: true,
      status: 'running',
    })

    ws.onopen = () => {
      retriesRef.current = 0
    }

    ws.onmessage = (event: MessageEvent) => {
      let data: Record<string, unknown>
      try {
        data = JSON.parse(event.data as string) as Record<string, unknown>
      } catch {
        return
      }

      const msgType = data.type as string | undefined

      switch (msgType) {
        case 'sync_progress': {
          const phase = (data.phase as string) || null
          setProgress((prev) => ({
            ...prev,
            isActive: true,
            status: 'running',
            jobId: (data.job_id as number) ?? prev.jobId,
            executionId: (data.execution_id as number) ?? prev.executionId,
            phase,
            phaseName: phase ? (PHASE_NAMES[phase] ?? phase) : prev.phaseName,
            processed: (data.processed as number) ?? prev.processed,
            total: (data.total as number) ?? prev.total,
            currentProduct: (data.current_item as string) ?? prev.currentProduct,
          }))
          break
        }

        case 'sync_complete': {
          setProgress((prev) => ({
            ...prev,
            isActive: false,
            status: 'completed',
            processed: (data.synced_count as number) ?? prev.processed,
            errorMessage:
              (data.error_count as number) > 0
                ? `Completed with ${data.error_count} error(s)`
                : null,
          }))
          break
        }

        case 'sync_error': {
          setProgress((prev) => ({
            ...prev,
            isActive: false,
            status: 'error',
            errorMessage: (data.error as string) ?? 'Unknown sync error',
          }))
          break
        }

        case 'sync_log': {
          const level = data.level as string
          const message = data.message as string
          if (level === 'error') {
            console.error('[sync_log]', message)
          } else if (level === 'warning') {
            console.warn('[sync_log]', message)
          } else {
            console.log('[sync_log]', message)
          }
          break
        }

        default:
          break
      }
    }

    ws.onerror = () => {
      // Error details are limited in browser WebSocket API; onclose handles reconnect
    }

    ws.onclose = () => {
      if (intentionalCloseRef.current) {
        return
      }

      // Auto-reconnect logic
      if (retriesRef.current < MAX_RETRIES && executionIdRef.current !== null) {
        retriesRef.current += 1
        retryTimeoutRef.current = setTimeout(() => {
          if (executionIdRef.current !== null) {
            if (executionIdRef.current === null) return
            const token = getToken()
            if (!token) return

            const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8000'
            const url = `${wsUrl}/api/ws/sync?token=${token}`
            const retryWs = new WebSocket(url)
            wsRef.current = retryWs

            retryWs.onopen = ws.onopen
            retryWs.onmessage = ws.onmessage
            retryWs.onerror = ws.onerror
            retryWs.onclose = ws.onclose
          }
        }, RETRY_DELAY_MS)
      }
    }
  }, [cleanup])

  const disconnect = useCallback(() => {
    executionIdRef.current = null
    cleanup()
    setProgress(INITIAL_STATE)
  }, [cleanup])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true
      cleanup()
    }
  }, [cleanup])

  return {
    progress,
    connect: connectWs,
    disconnect,
  }
}
