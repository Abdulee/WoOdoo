'use client'

import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  ScrollText,
  Loader2,
  Inbox,
  ListChecks,
  Filter,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import { apiGet, apiPost } from '@/lib/api'
import type {
  SyncJobResponse,
  SyncExecutionResponse,
  SyncLogResponse,
  PaginatedResponse,
} from '../../../types/api'

// ─── Types ──────────────────────────────────────────────────────────

type TabId = 'executions' | 'review'

interface ReviewQueueItem {
  id: number
  execution_id: number
  product_mapping_id: number | null
  level: 'info' | 'warning' | 'error'
  message: string
  details: Record<string, unknown> | null
  created_at: string
  retry_count: number
  sync_status: 'failed' | 'review'
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatDuration(start: string, end: string | null): string {
  if (!end) return 'Running…'
  const diff = new Date(end).getTime() - new Date(start).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function statusBadge(status: SyncExecutionResponse['status']) {
  switch (status) {
    case 'running':
      return { bg: 'color-mix(in srgb, #3b82f6 15%, transparent)', border: 'color-mix(in srgb, #3b82f6 30%, transparent)', color: '#60a5fa', label: 'Running', animated: true }
    case 'completed':
      return { bg: 'color-mix(in srgb, #10b981 15%, transparent)', border: 'color-mix(in srgb, #10b981 30%, transparent)', color: '#34d399', label: 'Completed', animated: false }
    case 'failed':
      return { bg: 'color-mix(in srgb, #ef4444 15%, transparent)', border: 'color-mix(in srgb, #ef4444 30%, transparent)', color: '#f87171', label: 'Failed', animated: false }
    case 'cancelled':
      return { bg: 'color-mix(in srgb, #6b7280 15%, transparent)', border: 'color-mix(in srgb, #6b7280 30%, transparent)', color: '#9ca3af', label: 'Cancelled', animated: false }
  }
}

// ─── Skeleton Components ────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 border-b animate-pulse"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="w-5 h-5 rounded" style={{ background: 'var(--muted)' }} />
      <div className="flex-1 space-y-2">
        <div className="h-4 rounded w-1/3" style={{ background: 'var(--muted)' }} />
        <div className="h-3 rounded w-1/2" style={{ background: 'var(--muted)' }} />
      </div>
      <div className="h-6 w-20 rounded-full" style={{ background: 'var(--muted)' }} />
      <div className="h-4 w-16 rounded" style={{ background: 'var(--muted)' }} />
    </div>
  )
}

function SkeletonTable() {
  return (
    <div>
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
      <SkeletonRow />
    </div>
  )
}

// ─── Status Badge Component ─────────────────────────────────────────

function StatusBadge({ status }: { status: SyncExecutionResponse['status'] }) {
  const badge = statusBadge(status)
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        background: badge.bg,
        border: `1px solid ${badge.border}`,
        color: badge.color,
      }}
    >
      {badge.animated && (
        <span
          className="inline-block w-1.5 h-1.5 rounded-full animate-pulse"
          style={{ background: badge.color }}
        />
      )}
      {badge.label}
    </span>
  )
}

// ─── Count Pill ─────────────────────────────────────────────────────

function CountPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-md"
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color: color,
      }}
    >
      {count} {label}
    </span>
  )
}

// ─── Expanded Logs Sub-Table ────────────────────────────────────────

function ExecutionLogs({ executionId }: { executionId: number }) {
  const { data: logs, isLoading, error } = useQuery<SyncLogResponse[]>({
    queryKey: ['execution-logs', executionId],
    queryFn: () => apiGet<SyncLogResponse[]>(`/api/executions/${executionId}/logs`),
    retry: false,
  })

  if (isLoading) {
    return (
      <div className="px-8 py-4">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
          <Loader2 size={14} className="animate-spin" />
          Loading log entries…
        </div>
      </div>
    )
  }

  if (error || !logs || logs.length === 0) {
    return (
      <div className="px-8 py-4">
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          {error ? 'Could not load log entries.' : 'No log entries for this execution.'}
        </p>
      </div>
    )
  }

  return (
    <div className="px-4 pb-3">
      <div
        className="rounded-lg overflow-hidden"
        style={{
          background: 'color-mix(in srgb, var(--muted) 50%, transparent)',
          border: '1px solid var(--border)',
        }}
      >
        <table className="w-full text-sm">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>Level</th>
              <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>Message</th>
              <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>Product Mapping</th>
              <th className="text-left px-4 py-2 text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>Time</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => {
              const levelColors: Record<string, string> = {
                info: '#3b82f6',
                warning: '#f59e0b',
                error: '#ef4444',
              }
              const levelColor = levelColors[log.level] || '#6b7280'
              return (
                <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td className="px-4 py-2">
                    <span
                      className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{
                        background: `color-mix(in srgb, ${levelColor} 15%, transparent)`,
                        color: levelColor,
                      }}
                    >
                      {log.level === 'error' && <XCircle size={10} />}
                      {log.level === 'warning' && <AlertTriangle size={10} />}
                      {log.level === 'info' && <CheckCircle2 size={10} />}
                      {log.level}
                    </span>
                  </td>
                  <td className="px-4 py-2" style={{ color: 'var(--foreground)' }}>
                    <span className="line-clamp-2">{log.message}</span>
                  </td>
                  <td className="px-4 py-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                    {log.product_mapping_id ? `#${log.product_mapping_id}` : '—'}
                  </td>
                  <td className="px-4 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>
                    {formatTimestamp(log.created_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Execution Row ──────────────────────────────────────────────────

function ExecutionRow({
  execution,
  jobName,
  isExpanded,
  onToggle,
}: {
  execution: SyncExecutionResponse
  jobName: string
  isExpanded: boolean
  onToggle: () => void
}) {
  return (
    <div>
      <div
        className="flex items-center gap-3 px-5 py-3.5 cursor-pointer transition-colors"
        style={{
          borderBottom: '1px solid var(--border)',
          background: isExpanded ? 'color-mix(in srgb, var(--muted) 40%, transparent)' : 'transparent',
        }}
        onClick={onToggle}
        onMouseEnter={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'color-mix(in srgb, var(--muted) 25%, transparent)'
        }}
        onMouseLeave={(e) => {
          if (!isExpanded) e.currentTarget.style.background = 'transparent'
        }}
      >
        {/* Expand toggle */}
        <span style={{ color: 'var(--muted-foreground)' }}>
          {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>

        {/* Job name */}
        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium truncate block" style={{ color: 'var(--foreground)' }}>
            {jobName}
          </span>
          <span className="text-xs flex items-center gap-1 mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            <Clock size={11} />
            {formatTimestamp(execution.started_at)}
            <span className="mx-1">·</span>
            {formatDuration(execution.started_at, execution.completed_at ?? null)}
          </span>
        </div>

        {/* Status */}
        <StatusBadge status={execution.status} />

        {/* Counts */}
        <div className="flex items-center gap-2">
          <CountPill label="synced" count={execution.synced_count} color="#10b981" />
          <CountPill label="failed" count={execution.error_count} color="#ef4444" />
          <CountPill label="skipped" count={execution.skipped_count} color="#6b7280" />
        </div>
      </div>

      {/* Expanded logs */}
      {isExpanded && <ExecutionLogs executionId={execution.id} />}
    </div>
  )
}

// ─── Review Queue Item ──────────────────────────────────────────────

function ReviewQueueRow({
  item,
  onRetry,
  onDismiss,
  isRetrying,
  isDismissing,
}: {
  item: ReviewQueueItem
  onRetry: () => void
  onDismiss: () => void
  isRetrying: boolean
  isDismissing: boolean
}) {
  const levelColors: Record<string, string> = {
    error: '#ef4444',
    warning: '#f59e0b',
    review: '#f59e0b',
    failed: '#ef4444',
  }
  const levelColor = levelColors[item.level] || '#6b7280'

  return (
    <div
      className="flex items-start gap-4 px-5 py-4"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {/* Level icon */}
      <div className="mt-0.5">
        {item.level === 'error' ? (
          <XCircle size={16} style={{ color: levelColor }} />
        ) : item.level === 'warning' ? (
          <AlertTriangle size={16} style={{ color: levelColor }} />
        ) : (
          <AlertTriangle size={16} style={{ color: '#6b7280' }} />
        )}
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {item.product_mapping_id && (
            <span
              className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{ background: 'var(--muted)', color: 'var(--foreground)' }}
            >
              Mapping #{item.product_mapping_id}
            </span>
          )}
          <span
            className="inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              background: `color-mix(in srgb, ${levelColor} 15%, transparent)`,
              color: levelColor,
            }}
          >
            {item.sync_status}
          </span>
          {item.retry_count > 0 && (
            <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {item.retry_count} retries
            </span>
          )}
        </div>
        <p className="text-sm" style={{ color: 'var(--foreground)' }}>
          {item.message}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--muted-foreground)' }}>
          Execution #{item.execution_id} · {formatTimestamp(item.created_at)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onRetry}
          disabled={isRetrying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{
            background: 'var(--primary)',
            color: '#fff',
            opacity: isRetrying ? 0.7 : 1,
            cursor: isRetrying ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isRetrying) e.currentTarget.style.filter = 'brightness(1.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'brightness(1)'
          }}
        >
          {isRetrying ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
          Retry
        </button>
        <button
          onClick={onDismiss}
          disabled={isDismissing}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
          style={{
            background: 'var(--muted)',
            color: 'var(--muted-foreground)',
            opacity: isDismissing ? 0.7 : 1,
            cursor: isDismissing ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isDismissing) e.currentTarget.style.filter = 'brightness(1.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'brightness(1)'
          }}
        >
          {isDismissing ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
          Dismiss
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function SyncLogsPage() {
  const queryClient = useQueryClient()

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('executions')

  // Filters
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Expanded rows
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // Retry/dismiss tracking
  const [retryingIds, setRetryingIds] = useState<Set<number>>(new Set())
  const [dismissingIds, setDismissingIds] = useState<Set<number>>(new Set())

  // ── Fetch jobs for filter dropdown ─────────────────────────────
  const { data: jobsData } = useQuery<PaginatedResponse<SyncJobResponse>>({
    queryKey: ['jobs'],
    queryFn: () => apiGet<PaginatedResponse<SyncJobResponse>>('/api/jobs'),
    retry: false,
  })
  const jobs = jobsData?.items ?? []

  // ── Fetch executions ──────────────────────────────────────────
  // If a job is selected, fetch executions for that job; otherwise fetch all
  const executionsQueryKey = selectedJobId
    ? ['executions', selectedJobId]
    : ['executions', 'all']

  const {
    data: executions,
    isLoading: isLoadingExecutions,
    error: executionsError,
    refetch: refetchExecutions,
  } = useQuery<SyncExecutionResponse[]>({
    queryKey: executionsQueryKey,
    queryFn: async () => {
      if (selectedJobId) {
        return apiGet<SyncExecutionResponse[]>(`/api/jobs/${selectedJobId}/executions`)
      }
      // Fetch executions from all jobs
      if (jobs.length === 0) return []
      const results = await Promise.all(
        jobs.map((job) =>
          apiGet<SyncExecutionResponse[]>(`/api/jobs/${job.id}/executions`).catch(() => [] as SyncExecutionResponse[])
        )
      )
      return results.flat().sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())
    },
    enabled: activeTab === 'executions' && (selectedJobId !== null || jobs.length > 0),
    retry: false,
  })

  // ── Fetch review queue ────────────────────────────────────────
  const {
    data: reviewItems,
    isLoading: isLoadingReview,
    error: reviewError,
    refetch: refetchReview,
  } = useQuery<ReviewQueueItem[]>({
    queryKey: ['review-queue'],
    queryFn: () => apiGet<ReviewQueueItem[]>('/api/review-queue'),
    enabled: activeTab === 'review',
    retry: false,
  })

  // ── Mutations ─────────────────────────────────────────────────
  const retryMutation = useMutation<{ success: boolean }, Error, number>({
    mutationFn: (id) => apiPost<{ success: boolean }>(`/api/review-queue/${id}/retry`, {}),
    onMutate: (id) => {
      setRetryingIds((prev) => new Set(prev).add(id))
    },
    onSettled: (_data, _error, id) => {
      setRetryingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    },
  })

  const dismissMutation = useMutation<{ success: boolean }, Error, number>({
    mutationFn: (id) => apiPost<{ success: boolean }>(`/api/review-queue/${id}/dismiss`, {}),
    onMutate: (id) => {
      setDismissingIds((prev) => new Set(prev).add(id))
    },
    onSettled: (_data, _error, id) => {
      setDismissingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    },
  })

  const retryAllMutation = useMutation<void, Error, void>({
    mutationFn: async () => {
      if (!reviewItems) return
      const failed = reviewItems.filter((i) => i.sync_status === 'failed')
      await Promise.allSettled(
        failed.map((item) => apiPost(`/api/review-queue/${item.id}/retry`, {}))
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-queue'] })
    },
  })

  // ── Handlers ──────────────────────────────────────────────────
  const toggleExpanded = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  // ── Build job name lookup ─────────────────────────────────────
  const jobNameMap: Record<number, string> = {}
  for (const job of jobs) {
    jobNameMap[job.id] = job.name
  }

  // ── Filter executions ─────────────────────────────────────────
  const filteredExecutions = (executions ?? []).filter((exec) => {
    if (statusFilter !== 'all' && exec.status !== statusFilter) return false
    return true
  })

  // ── Tab definitions ───────────────────────────────────────────
  const tabs: { id: TabId; label: string; icon: React.ReactNode; count?: number }[] = [
    {
      id: 'executions',
      label: 'Executions',
      icon: <ListChecks size={15} />,
      count: filteredExecutions.length,
    },
    {
      id: 'review',
      label: 'Review Queue',
      icon: <AlertTriangle size={15} />,
      count: reviewItems?.length,
    },
  ]

  // ── Render ────────────────────────────────────────────────────
  return (
    <PageContainer>
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <ScrollText size={28} style={{ color: 'var(--primary)' }} />
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Sync Logs
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          View detailed logs from all sync executions, filter by job, status, or date range.
        </p>
      </div>

      {/* Tabs */}
      <div
        className="flex items-center gap-1 mb-5 p-1 rounded-lg w-fit"
        style={{ background: 'var(--muted)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: activeTab === tab.id ? 'var(--card)' : 'transparent',
              color: activeTab === tab.id ? 'var(--foreground)' : 'var(--muted-foreground)',
              boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}
          >
            {tab.icon}
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  background: activeTab === tab.id
                    ? 'color-mix(in srgb, var(--primary) 15%, transparent)'
                    : 'color-mix(in srgb, var(--muted-foreground) 15%, transparent)',
                  color: activeTab === tab.id ? 'var(--primary)' : 'var(--muted-foreground)',
                }}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ═══════════════════ EXECUTIONS TAB ═══════════════════ */}
      {activeTab === 'executions' && (
        <div>
          {/* Filters */}
          <div
            className="flex items-center gap-3 mb-4 px-4 py-3 rounded-lg"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            <Filter size={14} style={{ color: 'var(--muted-foreground)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
              Filters
            </span>

            {/* Job filter */}
            <select
              value={selectedJobId ?? ''}
              onChange={(e) => setSelectedJobId(e.target.value ? Number(e.target.value) : null)}
              className="px-3 py-1.5 rounded-md text-sm outline-none"
              style={{
                background: 'var(--muted)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            >
              <option value="">All Jobs</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.name}
                </option>
              ))}
            </select>

            {/* Status filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-md text-sm outline-none"
              style={{
                background: 'var(--muted)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            >
              <option value="all">All Statuses</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <div className="flex-1" />

            {/* Refresh */}
            <button
              onClick={() => refetchExecutions()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
              style={{
                background: 'var(--muted)',
                color: 'var(--muted-foreground)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--border)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--muted)' }}
            >
              <RefreshCw size={12} />
              Refresh
            </button>
          </div>

          {/* Executions list */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            {/* Table header */}
            <div
              className="flex items-center gap-3 px-5 py-2.5 text-xs font-medium"
              style={{
                color: 'var(--muted-foreground)',
                borderBottom: '1px solid var(--border)',
                background: 'color-mix(in srgb, var(--muted) 50%, transparent)',
              }}
            >
              <span className="w-5" />
              <span className="flex-1">Job / Time</span>
              <span className="w-24 text-center">Status</span>
              <span className="w-64 text-center">Results</span>
            </div>

            {isLoadingExecutions ? (
              <SkeletonTable />
            ) : executionsError ? (
              <EmptyState
                title="Failed to load executions"
                description="Could not fetch execution data. Check your connection and try again."
                icon={AlertTriangle}
              />
            ) : filteredExecutions.length === 0 ? (
              <EmptyState
                title="No executions found"
                description={
                  selectedJobId || statusFilter !== 'all'
                    ? 'No executions match your current filters. Try adjusting them.'
                    : 'Run a sync job to see execution logs here.'
                }
                icon={Inbox}
              />
            ) : (
              filteredExecutions.map((exec) => (
                <ExecutionRow
                  key={exec.id}
                  execution={exec}
                  jobName={jobNameMap[exec.job_id] || `Job #${exec.job_id}`}
                  isExpanded={expandedIds.has(exec.id)}
                  onToggle={() => toggleExpanded(exec.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════ REVIEW QUEUE TAB ═══════════════════ */}
      {activeTab === 'review' && (
        <div>
          {/* Header bar */}
          <div
            className="flex items-center justify-between mb-4 px-4 py-3 rounded-lg"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} style={{ color: '#f59e0b' }} />
              <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Items requiring manual review
              </span>
              {reviewItems && reviewItems.length > 0 && (
                <span
                  className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: 'color-mix(in srgb, #f59e0b 15%, transparent)',
                    color: '#f59e0b',
                  }}
                >
                  {reviewItems.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => retryAllMutation.mutate()}
                disabled={retryAllMutation.isPending || !reviewItems || reviewItems.filter((i) => i.sync_status === 'failed').length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                style={{
                  background: 'var(--primary)',
                  color: '#fff',
                  opacity: retryAllMutation.isPending ? 0.7 : 1,
                  cursor: retryAllMutation.isPending ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!retryAllMutation.isPending) e.currentTarget.style.filter = 'brightness(1.15)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = 'brightness(1)'
                }}
              >
                {retryAllMutation.isPending ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <RotateCcw size={12} />
                )}
                Retry All Failed
              </button>
              <button
                onClick={() => refetchReview()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                style={{
                  background: 'var(--muted)',
                  color: 'var(--muted-foreground)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--border)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--muted)' }}
              >
                <RefreshCw size={12} />
                Refresh
              </button>
            </div>
          </div>

          {/* Review queue list */}
          <div
            className="rounded-xl overflow-hidden"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
            }}
          >
            {isLoadingReview ? (
              <SkeletonTable />
            ) : reviewError ? (
              <EmptyState
                title="Failed to load review queue"
                description="Could not fetch review queue items. Check your connection and try again."
                icon={AlertTriangle}
              />
            ) : !reviewItems || reviewItems.length === 0 ? (
              <EmptyState
                title="Review queue is empty"
                description="No items need manual review. All syncs are clean!"
                icon={CheckCircle2}
              />
            ) : (
              reviewItems.map((item) => (
                <ReviewQueueRow
                  key={item.id}
                  item={item}
                  onRetry={() => retryMutation.mutate(item.id)}
                  onDismiss={() => dismissMutation.mutate(item.id)}
                  isRetrying={retryingIds.has(item.id)}
                  isDismissing={dismissingIds.has(item.id)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
