'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Play,
  Edit,
  Trash2,
  Plus,
  ToggleLeft,
  ToggleRight,
  Filter,
  RefreshCw,
  Briefcase,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api'
import type { SyncJobResponse, SyncDirection } from '../../../types/api'

// ─── Types ──────────────────────────────────────────────────────────

interface JobListResponse {
  items: SyncJobResponse[]
  total: number
}

type DirectionFilter = SyncDirection | 'all'
type EnabledFilter = 'all' | 'enabled' | 'disabled'

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getDirectionLabel(dir: SyncDirection): string {
  switch (dir) {
    case 'odoo_to_wc':
      return 'Odoo → WC'
    case 'wc_to_odoo':
      return 'WC → Odoo'
    case 'bidirectional':
      return 'Bidirectional'
    case 'skip':
      return 'Skip'
    default:
      return dir
  }
}

function getDirectionColor(dir: SyncDirection): string {
  switch (dir) {
    case 'odoo_to_wc':
      return '#3b82f6' // blue
    case 'wc_to_odoo':
      return '#a855f7' // purple
    case 'bidirectional':
      return '#14b8a6' // teal
    default:
      return '#6b7280' // gray
  }
}

function getScheduleLabel(config: SyncJobResponse['schedule_config']): string {
  if (!config) return 'Manual'
  if (config.trigger === 'cron' && config.cron_expression) {
    return `Cron: ${config.cron_expression}`
  }
  if (config.trigger === 'interval' && config.interval_minutes) {
    return `Every ${config.interval_minutes}m`
  }
  return 'Manual'
}

// ─── Direction Badge ────────────────────────────────────────────────

function DirectionBadge({ direction }: { direction: SyncDirection }) {
  const color = getDirectionColor(direction)
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {getDirectionLabel(direction)}
    </span>
  )
}

// ─── Enabled Badge ──────────────────────────────────────────────────

function EnabledBadge({ enabled }: { enabled: boolean }) {
  const color = enabled ? '#10b981' : '#6b7280'
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
        color,
      }}
    >
      {enabled ? 'Enabled' : 'Disabled'}
    </span>
  )
}

// ─── Skeleton Row ───────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 border-b"
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="flex-1 space-y-2">
        <div
          className="h-4 w-40 rounded animate-pulse"
          style={{ background: 'var(--muted)' }}
        />
        <div
          className="h-3 w-24 rounded animate-pulse"
          style={{ background: 'var(--muted)' }}
        />
      </div>
      <div
        className="h-6 w-20 rounded-full animate-pulse"
        style={{ background: 'var(--muted)' }}
      />
      <div
        className="h-6 w-16 rounded-full animate-pulse"
        style={{ background: 'var(--muted)' }}
      />
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-8 w-8 rounded animate-pulse"
            style={{ background: 'var(--muted)' }}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Delete Confirmation Dialog ─────────────────────────────────────

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
  isPending,
}: {
  open: boolean
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-xl p-6 max-w-md w-full mx-4 shadow-xl"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
          {title}
        </h3>
        <p className="text-sm mb-6" style={{ color: 'var(--muted-foreground)' }}>
          {message}
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
            style={{
              background: 'var(--muted)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
            style={{
              background: 'var(--destructive)',
              color: '#fff',
              opacity: isPending ? 0.7 : 1,
              cursor: isPending ? 'not-allowed' : 'pointer',
            }}
          >
            {isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Toast Notification ─────────────────────────────────────────────

function Toast({
  message,
  type,
  onClose,
}: {
  message: string
  type: 'success' | 'error'
  onClose: () => void
}) {
  const color = type === 'success' ? '#10b981' : 'var(--destructive)'
  return (
    <div
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium"
      style={{
        background: 'var(--card)',
        border: `1px solid ${color}`,
        color: 'var(--foreground)',
      }}
    >
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: color }}
      />
      {message}
      <button
        onClick={onClose}
        className="ml-2 text-xs opacity-60 hover:opacity-100"
        style={{ color: 'var(--muted-foreground)' }}
      >
        ✕
      </button>
    </div>
  )
}

// ─── Job Row ────────────────────────────────────────────────────────

function JobRow({
  job,
  onRunNow,
  onToggle,
  onDelete,
  isRunning,
  isToggling,
}: {
  job: SyncJobResponse
  onRunNow: (id: number) => void
  onToggle: (job: SyncJobResponse) => void
  onDelete: (id: number) => void
  isRunning: boolean
  isToggling: boolean
}) {
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 border-b transition-colors"
      style={{ borderColor: 'var(--border)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'color-mix(in srgb, var(--muted) 40%, transparent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {/* Job info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--foreground)' }}
          >
            {job.name}
          </span>
          <EnabledBadge enabled={job.is_enabled} />
        </div>
        <div
          className="flex items-center gap-3 text-xs"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {job.connection_id != null && (
            <span>Connection #{job.connection_id}</span>
          )}
          <span>{getScheduleLabel(job.schedule_config)}</span>
          <span>Updated {formatTimestamp(job.updated_at)}</span>
        </div>
      </div>

      {/* Direction */}
      <DirectionBadge direction={job.direction} />

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        {/* Run Now */}
        <button
          onClick={() => onRunNow(job.id)}
          disabled={isRunning || !job.is_enabled}
          title="Run Now"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors"
          style={{
            color: isRunning ? '#3b82f6' : 'var(--muted-foreground)',
            background: 'transparent',
            opacity: !job.is_enabled ? 0.4 : 1,
            cursor: isRunning || !job.is_enabled ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isRunning && job.is_enabled) {
              e.currentTarget.style.background = 'var(--muted)'
              e.currentTarget.style.color = '#3b82f6'
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = isRunning ? '#3b82f6' : 'var(--muted-foreground)'
          }}
        >
          {isRunning ? (
            <span className="animate-spin">
              <RefreshCw size={15} />
            </span>
          ) : (
            <Play size={15} />
          )}
        </button>

        {/* Toggle Enable/Disable */}
        <button
          onClick={() => onToggle(job)}
          disabled={isToggling}
          title={job.is_enabled ? 'Disable' : 'Enable'}
          className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors"
          style={{
            color: job.is_enabled ? '#10b981' : 'var(--muted-foreground)',
            background: 'transparent',
            cursor: isToggling ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--muted)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {job.is_enabled ? <ToggleRight size={17} /> : <ToggleLeft size={17} />}
        </button>

        {/* Edit */}
        <Link
          href={`/jobs/${job.id}/edit`}
          title="Edit"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors"
          style={{
            color: 'var(--muted-foreground)',
            background: 'transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--muted)'
            e.currentTarget.style.color = 'var(--foreground)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--muted-foreground)'
          }}
        >
          <Edit size={15} />
        </Link>

        {/* Delete */}
        <button
          onClick={() => onDelete(job.id)}
          title="Delete"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md transition-colors"
          style={{
            color: 'var(--muted-foreground)',
            background: 'transparent',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--destructive) 12%, transparent)'
            e.currentTarget.style.color = 'var(--destructive)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--muted-foreground)'
          }}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function SyncJobsPage() {
  const queryClient = useQueryClient()

  // ── Filter state ──────────────────────────────────────────────
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
  const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>('all')

  // ── Dialog state ──────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<number | null>(null)

  // ── Toast state ───────────────────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  // ── Running job IDs (for per-row spinner) ─────────────────────
  const [runningIds, setRunningIds] = useState<Set<number>>(new Set())
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set())

  // ── Query: fetch jobs ─────────────────────────────────────────
  const { data, isLoading, isError, error } = useQuery<JobListResponse>({
    queryKey: ['jobs'],
    queryFn: () => apiGet<JobListResponse>('/api/jobs'),
  })

  // ── Mutation: run now ─────────────────────────────────────────
  const runMutation = useMutation<{ execution_id: number }, Error, number>({
    mutationFn: (id: number) =>
      apiPost<{ execution_id: number }>(`/api/jobs/${id}/run`, {}),
    onMutate: (id) => {
      setRunningIds((prev) => new Set(prev).add(id))
    },
    onSuccess: (_data, id) => {
      setRunningIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      showToast('Job started successfully', 'success')
    },
    onError: (err, id) => {
      setRunningIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      showToast(err.message || 'Failed to start job', 'error')
    },
  })

  // ── Mutation: toggle enable/disable ───────────────────────────
  const toggleMutation = useMutation<SyncJobResponse, Error, SyncJobResponse>({
    mutationFn: (job: SyncJobResponse) =>
      apiPut<SyncJobResponse>(`/api/jobs/${job.id}`, {
        is_enabled: !job.is_enabled,
      }),
    onMutate: (job) => {
      setTogglingIds((prev) => new Set(prev).add(job.id))
    },
    onSuccess: (result) => {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(result.id)
        return next
      })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      showToast(
        `Job ${result.is_enabled ? 'enabled' : 'disabled'}`,
        'success',
      )
    },
    onError: (err, job) => {
      setTogglingIds((prev) => {
        const next = new Set(prev)
        next.delete(job.id)
        return next
      })
      showToast(err.message || 'Failed to toggle job', 'error')
    },
  })

  // ── Mutation: delete job ──────────────────────────────────────
  const deleteMutation = useMutation<unknown, Error, number>({
    mutationFn: (id: number) => apiDelete<unknown>(`/api/jobs/${id}`),
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      showToast('Job deleted', 'success')
    },
    onError: (err) => {
      setDeleteTarget(null)
      showToast(err.message || 'Failed to delete job', 'error')
    },
  })

  // ── Client-side filtering ─────────────────────────────────────
  const jobs = data?.items ?? []
  const filteredJobs = jobs.filter((job) => {
    if (directionFilter !== 'all' && job.direction !== directionFilter) return false
    if (enabledFilter === 'enabled' && !job.is_enabled) return false
    if (enabledFilter === 'disabled' && job.is_enabled) return false
    return true
  })

  // ── Render ────────────────────────────────────────────────────
  return (
    <PageContainer>
      <div
        className="mb-6 rounded-2xl border p-5 sm:p-6"
        style={{
          background: 'linear-gradient(120deg, color-mix(in srgb, var(--primary) 14%, transparent) 0%, color-mix(in srgb, var(--secondary) 10%, transparent) 100%)',
          borderColor: 'color-mix(in srgb, var(--primary) 28%, var(--border))',
        }}
      >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span style={{ color: 'var(--primary)' }}>
              <Briefcase size={28} />
            </span>
            <h1
              className="text-3xl font-semibold tracking-tight"
              style={{ color: 'var(--foreground)' }}
            >
              Sync Jobs
            </h1>
          </div>
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Manage sync job configurations, trigger manual runs, and monitor status.
          </p>
        </div>
        <Link
          href="/jobs/new"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all"
          style={{
            background: 'var(--primary)',
            color: '#fff',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = 'brightness(1.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'brightness(1)'
          }}
        >
          <Plus size={16} />
          New Job
        </Link>
      </div>
      </div>

      <div
        className="flex items-center gap-4 px-4 py-3 rounded-xl mb-4"
        style={{
          background: 'color-mix(in srgb, var(--card) 90%, #0f172a 10%)',
          border: '1px solid color-mix(in srgb, var(--border) 80%, transparent)',
        }}
      >
        <span style={{ color: 'var(--muted-foreground)' }}>
          <Filter size={16} />
        </span>

        {/* Direction filter */}
        <div className="flex items-center gap-2">
          <label
            className="text-xs font-medium"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Direction
          </label>
          <select
            value={directionFilter}
            onChange={(e) => setDirectionFilter(e.target.value as DirectionFilter)}
            className="text-sm px-2 py-1 rounded-md outline-none"
            style={{
              background: 'var(--muted)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            <option value="all">All</option>
            <option value="odoo_to_wc">Odoo → WC</option>
            <option value="wc_to_odoo">WC → Odoo</option>
            <option value="bidirectional">Bidirectional</option>
          </select>
        </div>

        {/* Enabled filter */}
        <div className="flex items-center gap-2">
          <label
            className="text-xs font-medium"
            style={{ color: 'var(--muted-foreground)' }}
          >
            Status
          </label>
          <select
            value={enabledFilter}
            onChange={(e) => setEnabledFilter(e.target.value as EnabledFilter)}
            className="text-sm px-2 py-1 rounded-md outline-none"
            style={{
              background: 'var(--muted)',
              color: 'var(--foreground)',
              border: '1px solid var(--border)',
            }}
          >
            <option value="all">All</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        {/* Result count */}
        <span
          className="ml-auto text-xs"
          style={{ color: 'var(--muted-foreground)' }}
        >
          {filteredJobs.length} job{filteredJobs.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Jobs List Card */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'color-mix(in srgb, var(--card) 92%, transparent)',
          border: '1px solid color-mix(in srgb, var(--border) 82%, transparent)',
        }}
      >
        {/* Table header */}
        <div
          className="flex items-center gap-4 px-5 py-3 text-xs font-medium border-b"
          style={{
            color: 'var(--muted-foreground)',
            borderColor: 'var(--border)',
            background: 'color-mix(in srgb, var(--muted) 50%, transparent)',
          }}
        >
          <div className="flex-1">Job</div>
          <div className="w-28 text-center">Direction</div>
          <div className="w-36 text-right">Actions</div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        )}

        {/* Error state */}
        {isError && (
          <div className="px-5 py-8 text-center">
            <p className="text-sm" style={{ color: 'var(--destructive)' }}>
              Failed to load jobs: {error?.message || 'Unknown error'}
            </p>
            <button
              onClick={() => queryClient.invalidateQueries({ queryKey: ['jobs'] })}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: 'var(--muted)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            >
              <RefreshCw size={12} />
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && jobs.length === 0 && (
          <EmptyState
            icon={Briefcase}
            title="No sync jobs yet"
            description="Create your first sync job to start synchronizing data between Odoo and WooCommerce."
          >
            <Link
              href="/jobs/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
              style={{
                background: 'var(--primary)',
                color: '#fff',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.filter = 'brightness(1.15)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.filter = 'brightness(1)'
              }}
            >
              <Plus size={16} />
              Create First Job
            </Link>
          </EmptyState>
        )}

        {/* Filtered empty state */}
        {!isLoading && !isError && jobs.length > 0 && filteredJobs.length === 0 && (
          <div className="px-5 py-12 text-center">
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
              No jobs match the current filters.
            </p>
            <button
              onClick={() => {
                setDirectionFilter('all')
                setEnabledFilter('all')
              }}
              className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
              style={{
                background: 'var(--muted)',
                color: 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            >
              Clear Filters
            </button>
          </div>
        )}

        {/* Job rows */}
        {!isLoading &&
          !isError &&
          filteredJobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              onRunNow={(id) => runMutation.mutate(id)}
              onToggle={(j) => toggleMutation.mutate(j)}
              onDelete={(id) => setDeleteTarget(id)}
              isRunning={runningIds.has(job.id)}
              isToggling={togglingIds.has(job.id)}
            />
          ))}
      </div>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete Sync Job"
        message="Are you sure you want to delete this job? This action cannot be undone. All related execution history will also be removed."
        onConfirm={() => {
          if (deleteTarget !== null) deleteMutation.mutate(deleteTarget)
        }}
        onCancel={() => setDeleteTarget(null)}
        isPending={deleteMutation.isPending}
      />

      {/* Toast notifications */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </PageContainer>
  )
}
