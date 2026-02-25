'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Link2,
  Unlink,
  Search,
  Filter,
  ChevronRight,
  X,
  ArrowLeftRight,
  Loader2,
  Package,
  AlertTriangle,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { EmptyState } from '@/components/ui/EmptyState'
import { apiGet, apiPost, getAuthHeaders } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────────────

interface ProductMapping {
  odoo_id: number
  odoo_name?: string
  woo_id?: number
  woo_name?: string
  mapping_id?: number
  sync_status?: 'synced' | 'pending' | 'failed' | 'review' | null
  last_synced_at?: string
  // Conflict-specific fields
  odoo_sku?: string
  woo_sku?: string
  odoo_price?: number
  woo_price?: string
  odoo_status?: string
  woo_status?: string
}

type TabKey = 'all' | 'unmatched' | 'conflicts'

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function statusBadge(status: string | null | undefined) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    synced: { bg: 'color-mix(in srgb, #10b981 15%, transparent)', text: '#10b981', label: 'Synced' },
    pending: { bg: 'color-mix(in srgb, #eab308 15%, transparent)', text: '#eab308', label: 'Pending' },
    failed: { bg: 'color-mix(in srgb, #ef4444 15%, transparent)', text: '#ef4444', label: 'Failed' },
    review: { bg: 'color-mix(in srgb, #f97316 15%, transparent)', text: '#f97316', label: 'Review' },
  }
  const s = status ?? 'unmatched'
  const style = map[s] ?? { bg: 'color-mix(in srgb, #6b7280 15%, transparent)', text: '#6b7280', label: 'Unmatched' }
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ background: style.bg, color: style.text }}
    >
      {style.label}
    </span>
  )
}

// ─── Tab Configuration ──────────────────────────────────────────────

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All', icon: <Package size={14} /> },
  { key: 'unmatched', label: 'Unmatched', icon: <Unlink size={14} /> },
  { key: 'conflicts', label: 'Conflicts', icon: <AlertTriangle size={14} /> },
]

// ─── Skeleton Row ───────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr>
      {Array.from({ length: 7 }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="h-4 rounded animate-pulse"
            style={{ background: 'var(--muted)', width: i === 1 || i === 3 ? '120px' : '60px' }}
          />
        </td>
      ))}
    </tr>
  )
}

// ─── Field Diff Row ─────────────────────────────────────────────────

function FieldDiffRow({ label, odooValue, wcValue }: { label: string; odooValue: string; wcValue: string }) {
  const isDifferent = odooValue !== wcValue
  return (
    <div
      className="grid grid-cols-[100px_1fr_1fr] gap-2 py-2 px-3 rounded text-sm"
      style={{
        background: isDifferent ? 'color-mix(in srgb, #f59e0b 8%, transparent)' : 'transparent',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span className="font-medium truncate" style={{ color: 'var(--muted-foreground)' }}>{label}</span>
      <span className="truncate" style={{ color: 'var(--foreground)' }}>{odooValue}</span>
      <span className="truncate" style={{ color: 'var(--foreground)' }}>{wcValue}</span>
    </div>
  )
}

// ─── Side Panel ─────────────────────────────────────────────────────

function SidePanel({
  product,
  onClose,
  onUnlink,
  isUnlinking,
}: {
  product: ProductMapping
  onClose: () => void
  onUnlink: (mappingId: number) => void
  isUnlinking: boolean
}) {
  const queryClient = useQueryClient()
  const [wcIdInput, setWcIdInput] = useState('')

  const linkMutation = useMutation({
    mutationFn: (wcProductId: number) =>
      apiPost('/api/matching/link', {
        odoo_product_id: product.odoo_id,
        wc_product_id: wcProductId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-mappings'] })
      onClose()
    },
  })

  const isMatched = product.woo_id != null && product.woo_id > 0
  const displayName = product.odoo_name ?? product.woo_name ?? `Product #${product.odoo_id}`

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ background: 'rgba(0, 0, 0, 0.4)' }}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed right-0 top-0 h-screen z-50 overflow-y-auto"
        style={{
          width: '400px',
          background: 'var(--card)',
          borderLeft: '1px solid var(--border)',
          transform: 'translateX(0)',
          transition: 'transform 200ms ease-out',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b sticky top-0 z-10"
          style={{ borderColor: 'var(--border)', background: 'var(--card)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span style={{ color: 'var(--primary)' }}><ArrowLeftRight size={18} /></span>
            <h2 className="text-base font-semibold truncate" style={{ color: 'var(--foreground)' }}>
              {displayName}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: 'var(--muted-foreground)' }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--muted)' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* IDs Summary */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium" style={{ color: 'var(--muted-foreground)' }}>Odoo ID:</span>
            <span style={{ color: 'var(--foreground)' }}>{product.odoo_id}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium" style={{ color: 'var(--muted-foreground)' }}>WC ID:</span>
            <span style={{ color: 'var(--foreground)' }}>{product.woo_id ?? 'Not linked'}</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium" style={{ color: 'var(--muted-foreground)' }}>Status:</span>
            {statusBadge(product.sync_status)}
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-medium" style={{ color: 'var(--muted-foreground)' }}>Last Synced:</span>
            <span style={{ color: 'var(--foreground)' }}>{formatTimestamp(product.last_synced_at)}</span>
          </div>
        </div>

        {/* Field Diff Section */}
        <div className="px-5 pb-4">
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--foreground)' }}>
            Field Comparison
          </h3>
          <div
            className="rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--border)' }}
          >
            {/* Diff header */}
            <div
              className="grid grid-cols-[100px_1fr_1fr] gap-2 px-3 py-2 text-xs font-medium"
              style={{ background: 'var(--muted)', color: 'var(--muted-foreground)' }}
            >
              <span>Field</span>
              <span>Odoo</span>
              <span>WooCommerce</span>
            </div>
            <FieldDiffRow
              label="Name"
              odooValue={product.odoo_name ?? 'N/A'}
              wcValue={product.woo_name ?? 'N/A'}
            />
            <FieldDiffRow
              label="SKU"
              odooValue={product.odoo_sku ?? 'N/A'}
              wcValue={product.woo_sku ?? 'N/A'}
            />
            <FieldDiffRow
              label="Price"
              odooValue={product.odoo_price != null ? String(product.odoo_price) : 'N/A'}
              wcValue={product.woo_price ?? 'N/A'}
            />
            <FieldDiffRow
              label="Status"
              odooValue={product.odoo_status ?? 'N/A'}
              wcValue={product.woo_status ?? 'N/A'}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="px-5 pb-6">
          {isMatched ? (
            <button
              onClick={() => {
                if (product.mapping_id != null) onUnlink(product.mapping_id)
              }}
              disabled={isUnlinking || product.mapping_id == null}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all"
              style={{
                background: 'color-mix(in srgb, var(--destructive) 15%, transparent)',
                color: 'var(--destructive)',
                border: '1px solid color-mix(in srgb, var(--destructive) 30%, transparent)',
                opacity: isUnlinking ? 0.7 : 1,
                cursor: isUnlinking ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (!isUnlinking) e.currentTarget.style.background = 'color-mix(in srgb, var(--destructive) 25%, transparent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'color-mix(in srgb, var(--destructive) 15%, transparent)'
              }}
            >
              {isUnlinking ? <Loader2 size={14} className="animate-spin" /> : <Unlink size={14} />}
              {isUnlinking ? 'Unlinking…' : 'Unlink Mapping'}
            </button>
          ) : (
            <div className="space-y-3">
              <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                Link to WooCommerce Product
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={wcIdInput}
                  onChange={(e) => setWcIdInput(e.target.value)}
                  placeholder="WC Product ID"
                  className="flex-1 px-3 py-2 rounded-md text-sm outline-none"
                  style={{
                    background: 'var(--muted)',
                    color: 'var(--foreground)',
                    border: '1.5px solid var(--border)',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                />
                <button
                  onClick={() => {
                    const id = parseInt(wcIdInput, 10)
                    if (!isNaN(id) && id > 0) linkMutation.mutate(id)
                  }}
                  disabled={linkMutation.isPending || !wcIdInput.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
                  style={{
                    background: 'var(--primary)',
                    color: '#fff',
                    opacity: linkMutation.isPending || !wcIdInput.trim() ? 0.6 : 1,
                    cursor: linkMutation.isPending || !wcIdInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                  onMouseEnter={(e) => {
                    if (!linkMutation.isPending) e.currentTarget.style.filter = 'brightness(1.15)'
                  }}
                  onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)' }}
                >
                  {linkMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Link2 size={14} />
                  )}
                  Link
                </button>
              </div>
              {linkMutation.isError && (
                <p className="text-xs" style={{ color: 'var(--destructive)' }}>
                  {linkMutation.error?.message ?? 'Failed to link products'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export default function ProductExplorerPage() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<TabKey>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedProduct, setSelectedProduct] = useState<ProductMapping | null>(null)

  // ── Data fetching ───────────────────────────────────────────────

  const allQuery = useQuery<ProductMapping[]>({
    queryKey: ['product-mappings', 'all'],
    queryFn: () => apiGet<ProductMapping[]>('/api/matching/unmatched?source=odoo'),
    retry: false,
  })

  const unmatchedQuery = useQuery<ProductMapping[]>({
    queryKey: ['product-mappings', 'unmatched'],
    queryFn: () => apiGet<ProductMapping[]>('/api/matching/unmatched?source=odoo'),
    select: (data) => data.filter((p) => !p.woo_id),
    retry: false,
  })

  const conflictsQuery = useQuery<ProductMapping[]>({
    queryKey: ['product-mappings', 'conflicts'],
    queryFn: () => apiGet<ProductMapping[]>('/api/matching/conflicts'),
    retry: false,
  })

  // ── Active data ─────────────────────────────────────────────────

  const queryMap: Record<TabKey, typeof allQuery> = {
    all: allQuery,
    unmatched: unmatchedQuery,
    conflicts: conflictsQuery,
  }

  const activeQuery = queryMap[activeTab]
  const products = activeQuery.data ?? []
  const isLoading = activeQuery.isLoading

  // ── Search filter ───────────────────────────────────────────────

  const filteredProducts = searchQuery.trim()
    ? products.filter((p) => {
        const q = searchQuery.toLowerCase()
        return (
          String(p.odoo_id).includes(q) ||
          (p.odoo_name ?? '').toLowerCase().includes(q) ||
          String(p.woo_id ?? '').includes(q) ||
          (p.woo_name ?? '').toLowerCase().includes(q)
        )
      })
    : products

  // ── Unlink mutation ─────────────────────────────────────────────

  const unlinkMutation = useMutation({
    mutationFn: async (mappingId: number) => {
      // Use raw fetch because apiDelete calls res.json() which fails on 204
      const token = typeof window !== 'undefined' ? localStorage.getItem('woodoo_token') : null
      const res = await fetch(`${BASE_URL}/api/matching/link/${mappingId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      })
      if (res.status === 401) {
        if (typeof window !== 'undefined') window.location.href = '/login'
        throw new Error('Unauthorized')
      }
      if (!res.ok) {
        const error = await res.text()
        throw new Error(error || res.statusText)
      }
      // 204 No Content — don't parse JSON
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-mappings'] })
      setSelectedProduct(null)
    },
  })

  // ── Render ──────────────────────────────────────────────────────

  return (
    <PageContainer>
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <span style={{ color: 'var(--primary)' }}><ArrowLeftRight size={28} /></span>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Product Explorer
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Browse and compare products between Odoo and WooCommerce. View mapping status and field diffs.
        </p>
      </div>

      {/* Toolbar: Tabs + Search */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        {/* Tabs */}
        <div
          className="flex rounded-lg overflow-hidden"
          style={{ border: '1px solid var(--border)', background: 'var(--muted)' }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium transition-all"
                style={{
                  background: isActive ? 'var(--card)' : 'transparent',
                  color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                  borderRight: '1px solid var(--border)',
                }}
              >
                <span style={{ color: isActive ? 'var(--primary)' : 'var(--muted-foreground)' }}>
                  {tab.icon}
                </span>
                {tab.label}
                {/* Count badge */}
                {queryMap[tab.key].data && (
                  <span
                    className="ml-1 px-1.5 py-0.5 rounded-full text-xs"
                    style={{
                      background: isActive ? 'var(--primary)' : 'var(--border)',
                      color: isActive ? '#fff' : 'var(--muted-foreground)',
                    }}
                  >
                    {queryMap[tab.key].data?.length ?? 0}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Search */}
        <div className="relative">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--muted-foreground)' }}
          >
            <Search size={14} />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search products…"
            className="pl-9 pr-3 py-2 rounded-md text-sm outline-none"
            style={{
              background: 'var(--muted)',
              color: 'var(--foreground)',
              border: '1.5px solid var(--border)',
              width: '240px',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
          />
        </div>
      </div>

      {/* Table */}
      <div
        className="rounded-xl overflow-hidden"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ color: 'var(--foreground)' }}>
            <thead>
              <tr style={{ background: 'var(--muted)', borderBottom: '1px solid var(--border)' }}>
                <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Odoo ID
                </th>
                <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Odoo Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  WC ID
                </th>
                <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  WC Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Status
                </th>
                <th className="text-left px-4 py-3 font-medium text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Last Synced
                </th>
                <th className="text-right px-4 py-3 font-medium text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  <span style={{ color: 'var(--muted-foreground)' }}><Filter size={12} /></span>
                </th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      icon={activeTab === 'conflicts' ? AlertTriangle : Package}
                      title={
                        activeTab === 'all'
                          ? 'No products found'
                          : activeTab === 'unmatched'
                            ? 'No unmatched products'
                            : 'No conflicts detected'
                      }
                      description={
                        activeTab === 'all'
                          ? 'Products from Odoo will appear here once connections are configured.'
                          : activeTab === 'unmatched'
                            ? 'All Odoo products are matched with WooCommerce products.'
                            : 'No field conflicts between matched products.'
                      }
                    />
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr
                    key={`${product.odoo_id}-${product.woo_id ?? 'none'}`}
                    onClick={() => setSelectedProduct(product)}
                    className="transition-colors cursor-pointer"
                    style={{ borderBottom: '1px solid var(--border)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--muted)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <td className="px-4 py-3 font-mono text-xs">{product.odoo_id}</td>
                    <td className="px-4 py-3 truncate max-w-[180px]">{product.odoo_name ?? 'N/A'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{product.woo_id ?? '—'}</td>
                    <td className="px-4 py-3 truncate max-w-[180px]">{product.woo_name ?? 'N/A'}</td>
                    <td className="px-4 py-3">{statusBadge(product.sync_status)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                      {formatTimestamp(product.last_synced_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span style={{ color: 'var(--muted-foreground)' }}>
                        <ChevronRight size={16} />
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer count */}
        {!isLoading && filteredProducts.length > 0 && (
          <div
            className="px-4 py-2.5 text-xs border-t flex items-center justify-between"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
          >
            <span>
              Showing {filteredProducts.length} of {products.length} product{products.length !== 1 ? 's' : ''}
            </span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors"
                style={{ color: 'var(--primary)' }}
              >
                <X size={12} /> Clear search
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error banner */}
      {activeQuery.isError && (
        <div
          className="mt-4 rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
          style={{
            background: 'color-mix(in srgb, var(--destructive) 10%, transparent)',
            border: '1px solid color-mix(in srgb, var(--destructive) 25%, transparent)',
          }}
        >
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--destructive)' }} />
          <div>
            <p className="font-medium" style={{ color: 'var(--destructive)' }}>Failed to load products</p>
            <p style={{ color: 'var(--muted-foreground)' }}>
              {activeQuery.error instanceof Error ? activeQuery.error.message : 'Unknown error'}
            </p>
          </div>
        </div>
      )}

      {/* Side Panel */}
      {selectedProduct && (
        <SidePanel
          product={selectedProduct}
          onClose={() => setSelectedProduct(null)}
          onUnlink={(mappingId) => unlinkMutation.mutate(mappingId)}
          isUnlinking={unlinkMutation.isPending}
        />
      )}
    </PageContainer>
  )
}
