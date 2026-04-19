'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Settings, Copy, Check, Heart, Info, Save, Webhook, Loader2, Activity } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { apiGet, apiPost } from '@/lib/api'

// ─── Types ──────────────────────────────────────────────────────────

interface WebhookHealthEntry {
  last_received: string | null
  is_healthy: boolean
}

interface WebhookHealth {
  woocommerce: WebhookHealthEntry
  odoo: WebhookHealthEntry
}

interface ConnectionItem {
  id: number
  name: string
  platform: 'odoo' | 'woocommerce'
  is_active: boolean
}

interface ConnHealthResult {
  connection_id: number
  odoo_ok: boolean | null
  wc_ok: boolean | null
  odoo_latency_ms: number | null
  wc_latency_ms: number | null
  odoo_error: string | null
  wc_error: string | null
  checked_at: string
}


// ─── Helpers ────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

// ─── Card Wrapper ───────────────────────────────────────────────────

function SettingsCard({
  icon: Icon,
  title,
  subtitle,
  accentColor,
  children,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  subtitle: string
  accentColor: string
  children: React.ReactNode
}) {
  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center w-9 h-9 rounded-lg"
            style={{ background: `color-mix(in srgb, ${accentColor} 15%, transparent)` }}
          >
            <span style={{ color: accentColor }}><Icon size={18} /></span>
          </div>
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
              {title}
            </h2>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              {subtitle}
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {children}
      </div>
    </div>
  )
}

// ─── Copy Button ────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback: select text for manual copy
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-all flex-shrink-0"
      style={{
        background: copied
          ? 'color-mix(in srgb, #10b981 15%, transparent)'
          : 'var(--muted)',
        color: copied ? '#10b981' : 'var(--muted-foreground)',
        border: copied
          ? '1px solid color-mix(in srgb, #10b981 30%, transparent)'
          : '1px solid var(--border)',
      }}
      onMouseEnter={(e) => {
        if (!copied) e.currentTarget.style.borderColor = 'var(--ring)'
      }}
      onMouseLeave={(e) => {
        if (!copied) e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {copied ? (
        <>
          <Check size={12} />
          Copied!
        </>
      ) : (
        <>
          <Copy size={12} />
          Copy
        </>
      )}
    </button>
  )
}

// ─── Webhook URL Row ────────────────────────────────────────────────

function WebhookUrlRow({ label, url }: { label: string; url: string }) {
  const inputId = `webhook-url-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={inputId}
          name={inputId}
          type="text"
          readOnly
          value={url}
          className="flex-1 px-3 py-2 rounded-md text-sm outline-none"
          style={{
            background: 'var(--muted)',
            color: 'var(--muted-foreground)',
            border: '1.5px solid var(--border)',
          }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <CopyButton text={url} />
      </div>
    </div>
  )
}

// ─── Health Dot ─────────────────────────────────────────────────────

function HealthDot({ healthy }: { healthy: boolean }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shadow-lg ${
        healthy
          ? 'bg-emerald-400 shadow-emerald-400/50'
          : 'bg-red-400 shadow-red-400/50'
      }`}
    />
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [customerId, setCustomerId] = useState('')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // ── Load webhook health ───────────────────────────────────────
  const { data: webhookHealth, isLoading: healthLoading } = useQuery<WebhookHealth | null>({
    queryKey: ['webhook-health'],
    queryFn: async () => {
      try {
        return await apiGet<WebhookHealth>('/api/webhooks/health')
      } catch {
        return null
      }
    },
    refetchInterval: 30000,
  })

  // ── Load settings ─────────────────────────────────────────────
  const { data: settings } = useQuery<Record<string, unknown> | null>({
    queryKey: ['settings'],
    queryFn: async () => {
      try {
        return await apiGet<Record<string, unknown>>('/api/settings')
      } catch {
        return null
      }
    },
  })

  // Populate customer ID from settings
  useEffect(() => {
    if (settings && typeof settings === 'object' && 'default_customer_id' in settings) {
      queueMicrotask(() => {
        setCustomerId(String(settings.default_customer_id ?? ''))
      })
    }
  }, [settings])

  // ── Load connections for health check ────────────────────────
  const { data: connectionsData } = useQuery<{ items: ConnectionItem[] } | null>({
    queryKey: ['connections'],
    queryFn: async () => {
      try {
        return await apiGet<{ items: ConnectionItem[] }>('/api/connections')
      } catch {
        return null
      }
    },
  })

  // ── Connection health check state ─────────────────────────────
  const [connHealth, setConnHealth] = useState<Record<number, ConnHealthResult | 'loading'>>({})

  const handleConnHealthCheck = async (connId: number) => {
    setConnHealth((prev) => ({ ...prev, [connId]: 'loading' }))
    try {
      const result = await apiGet<ConnHealthResult>(`/api/connections/${connId}/health`)
      setConnHealth((prev) => ({ ...prev, [connId]: result }))
    } catch {
      setConnHealth((prev) => {
        const next = { ...prev }
        delete next[connId]
        return next
      })
    }
  }

  // ── Save customer ID ──────────────────────────────────────────
  const handleSaveCustomerId = async () => {
    setSaveStatus('saving')
    try {
      await apiPost('/api/settings', {
        key: 'default_customer_id',
        value: customerId,
      })
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch {
      setSaveStatus('error')
      setTimeout(() => setSaveStatus('idle'), 3000)
    }
  }

  // ── Render ────────────────────────────────────────────────────
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
          <Settings size={28} style={{ color: 'var(--primary)' }} />
          <h1 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Settings
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Configure webhook endpoints, sync preferences, and view application info.
        </p>
      </div>

      <div className="space-y-6">
        {/* ── Webhook Configuration ─────────────────────────────── */}
        <SettingsCard
          icon={Webhook}
          title="Webhook Configuration"
          subtitle="Inbound webhook URLs for WooCommerce and Odoo"
          accentColor="var(--primary)"
        >
          <div className="space-y-4">
            <WebhookUrlRow
              label="WooCommerce Webhook URL"
              url={`${API_URL}/api/webhooks/woocommerce`}
            />
            <WebhookUrlRow
              label="Odoo Webhook URL"
              url={`${API_URL}/api/webhooks/odoo`}
            />
          </div>

          <div
            className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
            style={{
              background: 'color-mix(in srgb, var(--primary) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--primary) 20%, transparent)',
            }}
          >
            <Info size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--primary)' }} />
            <p style={{ color: 'var(--muted-foreground)' }}>
              Paste these URLs into your WooCommerce/Odoo webhook settings to enable real-time sync notifications.
            </p>
          </div>
        </SettingsCard>

        {/* ── Webhook Health ─────────────────────────────────────── */}
        <SettingsCard
          icon={Heart}
          title="Webhook Health"
          subtitle="Status of inbound webhook endpoints"
          accentColor="#10b981"
        >
          {healthLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 size={16} className="animate-spin" style={{ color: 'var(--muted-foreground)' }} />
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Checking webhook health…
              </span>
            </div>
          ) : webhookHealth ? (
            <div className="space-y-3">
              {/* WooCommerce health */}
              <div
                className="flex items-center justify-between rounded-lg px-4 py-3"
                style={{
                  background: 'var(--muted)',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="flex items-center gap-3">
                  <HealthDot healthy={webhookHealth.woocommerce.is_healthy} />
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    WooCommerce
                  </span>
                </div>
                <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Last received: {formatTimestamp(webhookHealth.woocommerce.last_received)}
                </span>
              </div>

              {/* Odoo health */}
              <div
                className="flex items-center justify-between rounded-lg px-4 py-3"
                style={{
                  background: 'var(--muted)',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="flex items-center gap-3">
                  <HealthDot healthy={webhookHealth.odoo.is_healthy} />
                  <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                    Odoo
                  </span>
                </div>
                <span className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
                  Last received: {formatTimestamp(webhookHealth.odoo.last_received)}
                </span>
              </div>
            </div>
          ) : (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background: 'var(--muted)',
                border: '1px solid var(--border)',
                color: 'var(--muted-foreground)',
              }}
            >
              No webhooks received yet. Configure your WooCommerce and Odoo instances to send webhooks to the URLs above.
            </div>
          )}
        </SettingsCard>

        {/* ── Connection Health Check ────────────────────────────── */}
        <SettingsCard
          icon={Activity}
          title="Connection Health"
          subtitle="Test connectivity and latency for each connection"
          accentColor="#6366f1"
        >
          {connectionsData?.items && connectionsData.items.length > 0 ? (
            <div className="space-y-3">
              {connectionsData.items.map((conn) => {
                const hr = connHealth[conn.id]
                const isChecking = hr === 'loading'
                const healthData = typeof hr === 'object' ? hr : null
                const isOk = healthData
                  ? (conn.platform === 'odoo' ? healthData.odoo_ok : healthData.wc_ok)
                  : null
                const latency = healthData
                  ? (conn.platform === 'odoo' ? healthData.odoo_latency_ms : healthData.wc_latency_ms)
                  : null
                return (
                  <div
                    key={conn.id}
                    className="flex items-center justify-between rounded-lg px-4 py-3"
                    style={{
                      background: 'var(--muted)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <HealthDot healthy={isOk === true} />
                      <div>
                        <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                          {conn.name}
                        </span>
                        {latency !== null && (
                          <span className="ml-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
                            {latency}ms
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleConnHealthCheck(conn.id)}
                      disabled={isChecking}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all"
                      style={{
                        background: isOk === true
                          ? 'color-mix(in srgb, #10b981 15%, transparent)'
                          : isOk === false
                            ? 'color-mix(in srgb, #ef4444 15%, transparent)'
                            : 'var(--muted)',
                        color: isOk === true
                          ? '#10b981'
                          : isOk === false
                            ? '#ef4444'
                            : 'var(--muted-foreground)',
                        border: '1px solid var(--border)',
                        cursor: isChecking ? 'not-allowed' : 'pointer',
                        opacity: isChecking ? 0.7 : 1,
                      }}
                    >
                      {isChecking ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Heart size={12} />
                      )}
                      {isChecking ? 'Checking…' : isOk === true ? 'Healthy' : isOk === false ? 'Unhealthy' : 'Check Health'}
                    </button>
                  </div>
                )
              })}
            </div>
          ) : (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{
                background: 'var(--muted)',
                border: '1px solid var(--border)',
                color: 'var(--muted-foreground)',
              }}
            >
              No connections configured. Add connections first to check their health.
            </div>
          )}
        </SettingsCard>
        {/* ── Order Sync Settings ────────────────────────────────── */}
        <SettingsCard
          icon={Save}
          title="Order Sync Settings"
          subtitle="Configure defaults for order synchronization"
          accentColor="#f59e0b"
        >
          <div className="space-y-1.5">
            <label htmlFor="default-customer-id" className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
              Default Customer ID
            </label>
            <div className="flex items-center gap-2">
              <input
                id="default-customer-id"
                name="default-customer-id"
                type="text"
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                placeholder="e.g. 1"
                className="flex-1 px-3 py-2 rounded-md text-sm transition-colors outline-none"
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
              <button
                onClick={handleSaveCustomerId}
                disabled={saveStatus === 'saving'}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all"
                style={{
                  background: saveStatus === 'saved'
                    ? '#10b981'
                    : saveStatus === 'error'
                      ? 'var(--destructive)'
                      : '#f59e0b',
                  color: '#fff',
                  opacity: saveStatus === 'saving' ? 0.7 : 1,
                  cursor: saveStatus === 'saving' ? 'not-allowed' : 'pointer',
                }}
                onMouseEnter={(e) => {
                  if (saveStatus === 'idle') e.currentTarget.style.filter = 'brightness(1.15)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.filter = 'brightness(1)'
                }}
              >
                {saveStatus === 'saving' ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Saving…
                  </>
                ) : saveStatus === 'saved' ? (
                  <>
                    <Check size={14} />
                    Saved!
                  </>
                ) : saveStatus === 'error' ? (
                  <>
                    <Info size={14} />
                    Error
                  </>
                ) : (
                  <>
                    <Save size={14} />
                    Save
                  </>
                )}
              </button>
            </div>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Used when no customer match is found during order sync. Enter the Odoo partner/customer ID.
            </p>
          </div>
        </SettingsCard>

        {/* ── About ──────────────────────────────────────────────── */}
        <SettingsCard
          icon={Info}
          title="About"
          subtitle="Application information"
          accentColor="var(--muted-foreground)"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                Version
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
                WoOdoo v1.0.0
              </span>
            </div>
            <div
              className="w-full"
              style={{
                height: '1px',
                background: 'var(--border)',
              }}
            />
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
                API Endpoint
              </span>
              <span className="text-sm font-mono" style={{ color: 'var(--foreground)' }}>
                {API_URL}
              </span>
            </div>
          </div>
        </SettingsCard>
      </div>
    </PageContainer>
  )
}
