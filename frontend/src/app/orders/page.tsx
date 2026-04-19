'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShoppingCart, RefreshCw, CheckCircle2, XCircle, Clock, Package, Loader2 } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { apiGet, apiPost } from '@/lib/api'
import type { ConnectionResponse } from '../../../types/api'

// ─── Types ──────────────────────────────────────────────────────────

interface OrderMapping {
  id: number
  woo_order_id: number
  odoo_order_name: string | null
  sync_status: 'synced' | 'pending' | 'failed'
  synced_at: string | null
  error_message: string | null
}

interface SyncResponse {
  success: boolean
  odoo_order_id?: string
  error?: string
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function StatusBadge({ status }: { status: OrderMapping['sync_status'] }) {
  const config = {
    synced: {
      bg: 'color-mix(in srgb, #10b981 15%, transparent)',
      border: 'color-mix(in srgb, #10b981 30%, transparent)',
      color: '#10b981',
      icon: <CheckCircle2 size={12} />,
      label: 'Synced',
    },
    pending: {
      bg: 'color-mix(in srgb, #f59e0b 15%, transparent)',
      border: 'color-mix(in srgb, #f59e0b 30%, transparent)',
      color: '#f59e0b',
      icon: <Clock size={12} />,
      label: 'Pending',
    },
    failed: {
      bg: 'color-mix(in srgb, #ef4444 15%, transparent)',
      border: 'color-mix(in srgb, #ef4444 30%, transparent)',
      color: '#ef4444',
      icon: <XCircle size={12} />,
      label: 'Failed',
    },
  }[status]

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        color: config.color,
      }}
    >
      {config.icon}
      {config.label}
    </span>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function OrdersPage() {
  const queryClient = useQueryClient()

  // ── Sync form state ─────────────────────────────────────────────
  const [wcOrderId, setWcOrderId] = useState('')
  const [connectionId, setConnectionId] = useState<number | null>(null)
  const [syncFeedback, setSyncFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  // ── Load connections for the select ─────────────────────────────
  const { data: connections } = useQuery<ConnectionResponse[]>({
    queryKey: ['connections'],
    queryFn: async () => {
      try {
        return await apiGet<ConnectionResponse[]>('/api/connections')
      } catch {
        return []
      }
    },
    retry: false,
  })

  // ── Load orders ─────────────────────────────────────────────────
  const {
    data: orders,
    isLoading: ordersLoading,
    isError: ordersError,
  } = useQuery<OrderMapping[]>({
    queryKey: ['orders'],
    queryFn: async () => {
      try {
        return await apiGet<OrderMapping[]>('/api/orders')
      } catch {
        return []
      }
    },
    retry: false,
  })

  // ── Sync mutation ───────────────────────────────────────────────
  const syncMutation = useMutation<SyncResponse, Error, void>({
    mutationFn: () =>
      apiPost<SyncResponse>('/api/orders/sync', {
        wc_order_id: Number(wcOrderId),
        connection_id: connectionId,
      }),
    onSuccess: (data) => {
      if (data.success) {
        setSyncFeedback({
          type: 'success',
          message: data.odoo_order_id
            ? `Order synced successfully! Odoo Order: ${data.odoo_order_id}`
            : 'Order synced successfully!',
        })
        setWcOrderId('')
        queryClient.invalidateQueries({ queryKey: ['orders'] })
      } else {
        setSyncFeedback({
          type: 'error',
          message: data.error || 'Sync failed with unknown error',
        })
      }
    },
    onError: (error) => {
      setSyncFeedback({
        type: 'error',
        message: error.message || 'Failed to sync order',
      })
    },
  })

  const handleSync = () => {
    setSyncFeedback(null)
    if (!wcOrderId.trim() || !connectionId) return
    syncMutation.mutate()
  }

  const orderList = orders ?? []
  const wcConnections = (connections ?? []).filter(
    (c) => c.platform === 'woocommerce' && c.is_active,
  )

  // ── Render ────────────────────────────────────────────────────────
  return (
    <PageContainer>
      <div
        className="mb-8 rounded-2xl border p-5 sm:p-6"
        style={{
          background: 'linear-gradient(120deg, color-mix(in srgb, var(--primary) 14%, transparent) 0%, color-mix(in srgb, var(--secondary) 10%, transparent) 100%)',
          borderColor: 'color-mix(in srgb, var(--primary) 28%, var(--border))',
        }}
      >
        <div className="flex items-center gap-3 mb-2">
          <ShoppingCart size={28} style={{ color: 'var(--primary)' }} />
          <h1 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Order Sync
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Sync WooCommerce orders to Odoo and monitor order mapping status.
        </p>
      </div>

      {/* ── Sync Form Card ─────────────────────────────────────── */}
      <div
        className="rounded-xl overflow-hidden mb-6"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Card Header */}
        <div
          className="flex items-center gap-3 px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg"
            style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
          >
            <RefreshCw size={18} style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
              Manual Order Sync
            </h2>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Enter a WooCommerce order ID to sync it to Odoo
            </p>
          </div>
        </div>

        {/* Card Body */}
        <div className="px-5 py-4 space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* WC Order ID Input */}
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                WooCommerce Order ID <span style={{ color: 'var(--destructive)' }}>*</span>
              </label>
              <input
                type="number"
                value={wcOrderId}
                onChange={(e) => setWcOrderId(e.target.value)}
                placeholder="e.g. 1042"
                min={1}
                className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                style={{
                  background: 'var(--muted)',
                  color: 'var(--foreground)',
                  border: '1.5px solid var(--border)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ring)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              />
            </div>

            {/* Connection Select */}
            <div className="flex-1">
              <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--foreground)' }}>
                Connection <span style={{ color: 'var(--destructive)' }}>*</span>
              </label>
              <select
                value={connectionId ?? ''}
                onChange={(e) => setConnectionId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
                style={{
                  background: 'var(--muted)',
                  color: 'var(--foreground)',
                  border: '1.5px solid var(--border)',
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--ring)'
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                <option value="">Select a connection…</option>
                {wcConnections.map((conn) => (
                  <option key={conn.id} value={conn.id}>
                    {conn.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sync Button */}
            <div className="flex items-end">
              <button
                onClick={handleSync}
                disabled={syncMutation.isPending || !wcOrderId.trim() || !connectionId}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-md text-sm font-medium transition-all whitespace-nowrap"
                style={{
                  background: 'var(--primary)',
                  color: '#fff',
                  opacity: syncMutation.isPending || !wcOrderId.trim() || !connectionId ? 0.5 : 1,
                  cursor: syncMutation.isPending || !wcOrderId.trim() || !connectionId ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (!syncMutation.isPending) e.currentTarget.style.filter = 'brightness(1.15)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = 'brightness(1)'
                }}
              >
                {syncMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Syncing…
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} />
                    Sync Order
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Sync Feedback */}
          {syncFeedback && (
            <div
              className="rounded-lg px-4 py-3 text-sm flex items-start gap-3"
              style={{
                background:
                  syncFeedback.type === 'success'
                    ? 'color-mix(in srgb, #10b981 10%, transparent)'
                    : 'color-mix(in srgb, var(--destructive) 10%, transparent)',
                border:
                  syncFeedback.type === 'success'
                    ? '1px solid color-mix(in srgb, #10b981 25%, transparent)'
                    : '1px solid color-mix(in srgb, var(--destructive) 25%, transparent)',
              }}
            >
              {syncFeedback.type === 'success' ? (
                <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
              ) : (
                <XCircle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--destructive)' }} />
              )}
              <p style={{ color: 'var(--foreground)' }}>{syncFeedback.message}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Orders Table Card ──────────────────────────────────── */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Table Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-lg"
              style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
            >
              <Package size={18} style={{ color: 'var(--primary)' }} />
            </div>
            <div>
              <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
                Synced Orders
              </h2>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                {orderList.length} order{orderList.length !== 1 ? 's' : ''} tracked
              </p>
            </div>
          </div>
        </div>

        {/* Table Content */}
        <div className="px-5 py-4">
          {ordersLoading ? (
            <div className="flex items-center justify-center py-12 gap-3" style={{ color: 'var(--muted-foreground)' }}>
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">Loading orders…</span>
            </div>
          ) : ordersError || orderList.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Package size={40} style={{ color: 'var(--muted-foreground)', opacity: 0.4 }} />
              <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                No orders synced yet
              </p>
              <p className="text-xs" style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}>
                Use the form above to sync a WooCommerce order to Odoo
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr
                    className="border-b text-left"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <th className="pb-3 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                      WC Order ID
                    </th>
                    <th className="pb-3 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                      Odoo Sale Order
                    </th>
                    <th className="pb-3 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                      Status
                    </th>
                    <th className="pb-3 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                      Synced At
                    </th>
                    <th className="pb-3 font-medium" style={{ color: 'var(--muted-foreground)' }}>
                      Error
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {orderList.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b last:border-b-0 transition-colors"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="py-3 font-mono text-sm" style={{ color: 'var(--foreground)' }}>
                        #{order.woo_order_id}
                      </td>
                      <td className="py-3" style={{ color: 'var(--foreground)' }}>
                        {order.odoo_order_name ?? (
                          <span style={{ color: 'var(--muted-foreground)' }}>—</span>
                        )}
                      </td>
                      <td className="py-3">
                        <StatusBadge status={order.sync_status} />
                      </td>
                      <td className="py-3 text-sm" style={{ color: 'var(--muted-foreground)' }}>
                        {formatTimestamp(order.synced_at)}
                      </td>
                      <td className="py-3 text-xs max-w-[200px] truncate" style={{ color: 'var(--destructive)' }}>
                        {order.error_message ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
