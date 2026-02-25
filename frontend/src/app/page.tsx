'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiGet } from '@/lib/api'
import { PageContainer } from '@/components/layout/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  RefreshCw,
  Clock,
  AlertTriangle,
  CalendarClock,
  Plug,
  Zap,
  Plus,
  ArrowRight,
  Activity,
  CheckCircle2,
  XCircle,
  Info,
} from 'lucide-react'
import type {
  ConnectionResponse,
  SyncJobResponse,
  SyncExecutionResponse,
  PaginatedResponse,
} from '../../types/api'

/* ─── Types (inline, for UI shape) ─── */

interface ConnectionStatus {
  name: string
  platform: 'odoo' | 'woocommerce'
  status: 'connected' | 'disconnected' | 'unconfigured'
  lastChecked: string | null
}

interface StatCard {
  label: string
  value: number | string
  icon: React.ElementType
  accent?: string
}

interface ActivityEvent {
  id: number
  timestamp: string
  eventType: 'sync_completed' | 'sync_failed' | 'sync_started' | 'product_created' | 'product_updated'
  description: string
  status: 'success' | 'error' | 'info'
  count?: number
}

interface LastSyncInfo {
  timestamp: string
  duration: string
  jobName: string
  status: 'completed' | 'failed'
}

/* ─── Helpers ─── */

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDuration(startedAt: string, completedAt?: string): string {
  if (!completedAt) return 'running...'
  const diff = new Date(completedAt).getTime() - new Date(startedAt).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s`
  const mins = Math.floor(secs / 60)
  const remainSecs = secs % 60
  return `${mins}m ${remainSecs}s`
}

/* ─── Sub-components ─── */

function ConnectionDot({ status }: { status: ConnectionStatus['status'] }) {
  const colors: Record<string, string> = {
    connected: '#22c55e',
    disconnected: '#ef4444',
    unconfigured: '#6b7280',
  }
  return (
    <span
      className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ background: colors[status] ?? '#6b7280' }}
    />
  )
}

function StatusBadge({ status }: { status: ActivityEvent['status'] }) {
  const config: Record<string, { bg: string; fg: string; icon: React.ElementType }> = {
    success: { bg: 'rgba(34,197,94,0.12)', fg: '#22c55e', icon: CheckCircle2 },
    error: { bg: 'rgba(239,68,68,0.12)', fg: '#ef4444', icon: XCircle },
    info: { bg: 'rgba(59,130,246,0.12)', fg: '#3b82f6', icon: Info },
  }
  const c = config[status] ?? config.info
  const Icon = c.icon
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: c.bg, color: c.fg }}
    >
      <Icon size={12} />
      {status}
    </span>
  )
}

/* ─── Dashboard Page ─── */

export default function DashboardPage() {
  // Fetch connections
  const { data: connectionsData, isLoading: connectionsLoading } = useQuery({
    queryKey: ['connections'],
    queryFn: () => apiGet<PaginatedResponse<ConnectionResponse>>('/api/connections'),
  })

  // Fetch jobs
  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => apiGet<PaginatedResponse<SyncJobResponse>>('/api/jobs'),
  })

  // Find the most recent job to fetch executions for
  const firstJobId = jobsData?.items?.[0]?.id
  const { data: executionsData, isLoading: executionsLoading } = useQuery({
    queryKey: ['executions', firstJobId],
    queryFn: () => apiGet<SyncExecutionResponse[]>(`/api/jobs/${firstJobId}/executions`),
    enabled: !!firstJobId,
  })

  const isLoading = connectionsLoading || jobsLoading

  // Map ConnectionResponse → ConnectionStatus
  const connections: ConnectionStatus[] = (connectionsData?.items ?? []).map((conn) => ({
    name: conn.name,
    platform: conn.platform as 'odoo' | 'woocommerce',
    status: conn.is_active ? 'connected' : 'disconnected',
    lastChecked: conn.last_tested_at ? formatRelativeTime(conn.last_tested_at) : null,
  }))

  // Compute stat card values from real data
  const enabledJobCount = jobsData?.items?.filter((j) => j.is_enabled).length ?? 0
  const latestExecution = executionsData?.[0] ?? null
  const productsSynced = latestExecution?.synced_count ?? 0

  const stats: StatCard[] = [
    { label: 'Products Synced', value: isLoading ? '...' : productsSynced, icon: RefreshCw, accent: 'var(--primary)' },
    { label: 'Pending Sync', value: isLoading ? '...' : 0, icon: Clock, accent: 'var(--secondary)' },
    { label: 'Needs Review', value: isLoading ? '...' : 0, icon: AlertTriangle, accent: 'var(--destructive)' },
    { label: 'Scheduled Jobs', value: isLoading ? '...' : enabledJobCount, icon: CalendarClock, accent: 'var(--muted-foreground)' },
  ]

  // Activity feed — empty for now (no dedicated activity endpoint)
  const activity: ActivityEvent[] = []

  // Build last sync info from most recent execution
  let lastSync: LastSyncInfo | null = null
  if (latestExecution) {
    const jobForExecution = jobsData?.items?.find((j) => j.id === latestExecution.job_id)
    lastSync = {
      timestamp: formatRelativeTime(latestExecution.started_at),
      duration: formatDuration(latestExecution.started_at, latestExecution.completed_at),
      jobName: jobForExecution?.name ?? `Job #${latestExecution.job_id}`,
      status: latestExecution.status === 'completed' ? 'completed' : 'failed',
    }
  }

  const hasConnections = connections.length > 0

  // Show loading state while initial data loads
  if (isLoading && !connectionsData && !jobsData) {
    return (
      <PageContainer className="flex flex-col items-center justify-center min-h-[80vh]">
        <div className="flex items-center gap-3">
          <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--muted-foreground)' }} />
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading dashboard...</p>
        </div>
      </PageContainer>
    )
  }

  /* Full-page empty state when no connections exist */
  if (!hasConnections) {
    return (
      <PageContainer className="flex flex-col items-center justify-center min-h-[80vh]">
        <div
          className="w-full max-w-lg rounded-xl border p-8 text-center"
          style={{
            background: 'var(--card)',
            borderColor: 'var(--border)',
          }}
        >
          <EmptyState
            title="No connections configured yet"
            description="Connect your Odoo and WooCommerce instances to start syncing products, inventory, and orders."
            icon={Plug}
          >
            <Link
              href="/connections"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors"
              style={{
                background: 'var(--primary)',
                color: 'var(--primary-foreground)',
              }}
            >
              Set up connections
              <ArrowRight size={16} />
            </Link>
          </EmptyState>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Dashboard
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted-foreground)' }}>
            Overview of sync health, recent jobs, and connection status.
          </p>
        </div>
        {/* Quick Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/jobs"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              background: 'var(--primary)',
              color: 'var(--primary-foreground)',
            }}
          >
            <Zap size={15} />
            Run Sync Now
          </Link>
          <Link
            href="/jobs/new"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border transition-colors"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--foreground)',
              background: 'transparent',
            }}
          >
            <Plus size={15} />
            Create New Job
          </Link>
        </div>
      </div>

      {/* Connection Health */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--muted-foreground)' }}>
          Connection Health
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {connections.map((conn) => (
            <div
              key={conn.name}
              className="flex items-center gap-3 px-4 py-3 rounded-lg border"
              style={{
                background: 'var(--card)',
                borderColor: 'var(--border)',
              }}
            >
              <ConnectionDot status={conn.status} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
                  {conn.name}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  {conn.platform === 'odoo' ? 'Odoo' : 'WooCommerce'}
                  {conn.lastChecked ? ` · Checked ${conn.lastChecked}` : ' · Never checked'}
                </p>
              </div>
              <span
                className="text-xs font-medium px-2 py-0.5 rounded-full capitalize"
                style={{
                  background:
                    conn.status === 'connected'
                      ? 'rgba(34,197,94,0.12)'
                      : conn.status === 'disconnected'
                        ? 'rgba(239,68,68,0.12)'
                        : 'rgba(107,114,128,0.12)',
                  color:
                    conn.status === 'connected'
                      ? '#22c55e'
                      : conn.status === 'disconnected'
                        ? '#ef4444'
                        : '#6b7280',
                }}
              >
                {conn.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Stat Cards */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--muted-foreground)' }}>
          Sync Overview
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon
            const isEmpty = stat.value === '—' || stat.value === 0 || stat.value === '...'
            return (
              <div
                key={stat.label}
                className="relative overflow-hidden rounded-lg border px-4 py-4"
                style={{
                  background: 'var(--card)',
                  borderColor: 'var(--border)',
                }}
              >
                {/* Accent bar */}
                <div
                  className="absolute top-0 left-0 w-full h-0.5"
                  style={{ background: isEmpty ? 'var(--border)' : (stat.accent ?? 'var(--primary)') }}
                />
                <div className="flex items-start justify-between">
                  <div>
                    <p
                      className="text-xs font-medium uppercase tracking-wide mb-1"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {stat.label}
                    </p>
                    <p
                      className="text-2xl font-bold tabular-nums"
                      style={{ color: isEmpty ? 'var(--muted-foreground)' : 'var(--foreground)' }}
                    >
                      {stat.value}
                    </p>
                  </div>
                  <div
                    className="p-2 rounded-md"
                    style={{
                      background: isEmpty
                        ? 'var(--muted)'
                        : `color-mix(in srgb, ${stat.accent ?? 'var(--primary)'} 12%, transparent)`,
                    }}
                  >
                    <Icon
                      size={18}
                      style={{ color: isEmpty ? 'var(--muted-foreground)' : (stat.accent ?? 'var(--primary)') }}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Last Sync + Activity in a 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Last Sync Card */}
        <section className="lg:col-span-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--muted-foreground)' }}>
            Last Sync
          </h2>
          <div
            className="rounded-lg border p-5 h-[calc(100%-2rem)]"
            style={{
              background: 'var(--card)',
              borderColor: 'var(--border)',
            }}
          >
            {executionsLoading ? (
              <div className="flex flex-col items-center justify-center h-full py-6 text-center">
                <RefreshCw size={24} className="animate-spin" style={{ color: 'var(--muted-foreground)', opacity: 0.5 }} />
                <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  Loading...
                </p>
              </div>
            ) : lastSync ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Activity size={16} style={{ color: 'var(--primary)' }} />
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    {lastSync.jobName}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--muted-foreground)' }}>Completed</span>
                    <span style={{ color: 'var(--foreground)' }}>{lastSync.timestamp}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--muted-foreground)' }}>Duration</span>
                    <span style={{ color: 'var(--foreground)' }}>{lastSync.duration}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span style={{ color: 'var(--muted-foreground)' }}>Status</span>
                    <StatusBadge status={lastSync.status === 'completed' ? 'success' : 'error'} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full py-6 text-center">
                <Activity size={24} style={{ color: 'var(--muted-foreground)', opacity: 0.5 }} />
                <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  No sync has run yet
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Recent Activity Feed */}
        <section className="lg:col-span-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--muted-foreground)' }}>
            Recent Activity
          </h2>
          <div
            className="rounded-lg border overflow-hidden"
            style={{
              background: 'var(--card)',
              borderColor: 'var(--border)',
            }}
          >
            {activity.length > 0 ? (
              <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {activity.map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center gap-4 px-4 py-3 transition-colors"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="text-xs font-mono whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>
                      {event.timestamp}
                    </span>
                    <p className="flex-1 text-sm truncate" style={{ color: 'var(--foreground)' }}>
                      {event.description}
                    </p>
                    {event.count !== undefined && (
                      <span className="text-xs tabular-nums" style={{ color: 'var(--muted-foreground)' }}>
                        {event.count} items
                      </span>
                    )}
                    <StatusBadge status={event.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center">
                <Activity size={24} style={{ color: 'var(--muted-foreground)', opacity: 0.5 }} className="mx-auto" />
                <p className="mt-2 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                  No sync activity yet
                </p>
                <p className="mt-1 text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
                  Activity will appear here after your first sync job runs.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </PageContainer>
  )
}
