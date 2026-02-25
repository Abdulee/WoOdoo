'use client'

import { useState, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plug, ShieldCheck, ShoppingCart, Image, Loader2, CheckCircle2, XCircle, AlertTriangle, Clock } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { apiGet, apiPost, apiPut } from '@/lib/api'
import type {
  ConnectionResponse,
  ConnectionTestResult,
  ConnectionCreate,
  ConnectionUpdate,
  OdooConnectionConfig,
  WooCommerceConnectionConfig,
} from '../../../types/api'

// ─── Types ──────────────────────────────────────────────────────────

interface WordPressMediaConfig {
  wp_url: string
  app_username: string
  app_password: string
}

type ConnectionStatus = 'idle' | 'testing' | 'connected' | 'error'

interface SectionState {
  status: ConnectionStatus
  lastTested: string | null
  testResult: ConnectionTestResult | null
  errors: Record<string, string>
  connectionId: number | null
}

// ─── Helpers ────────────────────────────────────────────────────────

function formatTimestamp(iso: string | null): string {
  if (!iso) return 'Never tested'
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function StatusDot({ status }: { status: ConnectionStatus }) {
  const color =
    status === 'connected'
      ? 'bg-emerald-400 shadow-emerald-400/50'
      : status === 'error'
        ? 'bg-red-400 shadow-red-400/50'
        : status === 'testing'
          ? 'bg-amber-400 shadow-amber-400/50 animate-pulse'
          : 'bg-gray-500'
  return <span className={`inline-block w-2.5 h-2.5 rounded-full shadow-lg ${color}`} />
}

// ─── Input Component ────────────────────────────────────────────────

function FormInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  error,
  required = true,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  error?: string
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
        {label}
        {required && <span style={{ color: 'var(--destructive)' }}> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 rounded-md text-sm transition-colors outline-none"
        style={{
          background: 'var(--muted)',
          color: 'var(--foreground)',
          border: error ? '1.5px solid var(--destructive)' : '1.5px solid var(--border)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--ring)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = error ? 'var(--destructive)' : 'var(--border)'
        }}
      />
      {error && (
        <p className="text-xs" style={{ color: 'var(--destructive)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Section Card ───────────────────────────────────────────────────

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  accentColor,
  children,
  sectionState,
  onTest,
  isTesting,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  subtitle: string
  accentColor: string
  children: React.ReactNode
  sectionState: SectionState
  onTest: () => void
  isTesting: boolean
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

        {/* Status indicator */}
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted-foreground)' }}>
          <StatusDot status={sectionState.status} />
          <span>
            {sectionState.status === 'testing'
              ? 'Testing…'
              : sectionState.status === 'connected'
                ? 'Connected'
                : sectionState.status === 'error'
                  ? 'Error'
                  : 'Not tested'}
          </span>
          {sectionState.lastTested && (
            <>
              <Clock size={12} />
              <span>{formatTimestamp(sectionState.lastTested)}</span>
            </>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-5 py-4 space-y-4">
        {children}

        {/* Test Result */}
        {sectionState.testResult && (
          <div
            className="rounded-lg px-4 py-3 text-sm flex items-start gap-3"
            style={{
              background: sectionState.testResult.success
                ? 'color-mix(in srgb, #10b981 10%, transparent)'
                : 'color-mix(in srgb, var(--destructive) 10%, transparent)',
              border: sectionState.testResult.success
                ? '1px solid color-mix(in srgb, #10b981 25%, transparent)'
                : '1px solid color-mix(in srgb, var(--destructive) 25%, transparent)',
            }}
          >
            {sectionState.testResult.success ? (
              <CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#10b981' }} />
            ) : (
              <XCircle size={16} className="flex-shrink-0 mt-0.5" style={{ color: 'var(--destructive)' }} />
            )}
            <div className="space-y-1 min-w-0">
              <p style={{ color: 'var(--foreground)' }}>{sectionState.testResult.message}</p>
              {sectionState.testResult.details && (
                <div className="text-xs space-y-0.5" style={{ color: 'var(--muted-foreground)' }}>
                  {sectionState.testResult.details.version != null && (
                    <p>Version: {String(sectionState.testResult.details.version)}</p>
                  )}
                  {sectionState.testResult.details.latency_ms !== undefined && (
                    <p>Latency: {String(sectionState.testResult.details.latency_ms)}ms</p>
                  )}
                  {sectionState.testResult.currency && (
                    <p>Currency: {sectionState.testResult.currency}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Test Button */}
        <div className="pt-1">
          <button
            onClick={onTest}
            disabled={isTesting}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: accentColor,
              color: '#fff',
              opacity: isTesting ? 0.7 : 1,
              cursor: isTesting ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!isTesting) e.currentTarget.style.filter = 'brightness(1.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)'
            }}
          >
            {isTesting ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Testing…
              </>
            ) : (
              <>
                <ShieldCheck size={14} />
                Test Connection
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Currency Mismatch Banner ───────────────────────────────────────

function CurrencyMismatchBanner({
  odooCurrency,
  wcCurrency,
}: {
  odooCurrency: string
  wcCurrency: string
}) {
  return (
    <div
      className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
      style={{
        background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
        border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)',
      }}
    >
      <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
      <div>
        <p className="font-medium" style={{ color: '#fbbf24' }}>
          Currency Mismatch Detected
        </p>
        <p style={{ color: 'var(--muted-foreground)' }}>
          Odoo uses <strong style={{ color: 'var(--foreground)' }}>{odooCurrency}</strong> but
          WooCommerce uses <strong style={{ color: 'var(--foreground)' }}>{wcCurrency}</strong>.
          Products will sync without price conversion — ensure both systems use the same currency
          or apply manual exchange rates.
        </p>
      </div>
    </div>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const queryClient = useQueryClient()

  // ── Form state ─────────────────────────────────────────────────
  const [odooForm, setOdooForm] = useState<OdooConnectionConfig>({
    url: '',
    database: '',
    username: '',
    api_key: '',
  })

  const [wcForm, setWcForm] = useState<WooCommerceConnectionConfig>({
    url: '',
    consumer_key: '',
    consumer_secret: '',
    version: 'wc/v3',
  })

  const [wpForm, setWpForm] = useState<WordPressMediaConfig>({
    wp_url: '',
    app_username: '',
    app_password: '',
  })

  // ── Section states ─────────────────────────────────────────────
  const [odooState, setOdooState] = useState<SectionState>({
    status: 'idle',
    lastTested: null,
    testResult: null,
    errors: {},
    connectionId: null,
  })

  const [wcState, setWcState] = useState<SectionState>({
    status: 'idle',
    lastTested: null,
    testResult: null,
    errors: {},
    connectionId: null,
  })

  const [wpState, setWpState] = useState<SectionState>({
    status: 'idle',
    lastTested: null,
    testResult: null,
    errors: {},
    connectionId: null,
  })

  // ── Load existing connections ──────────────────────────────────
  const { data: connections } = useQuery<ConnectionResponse[]>({
    queryKey: ['connections'],
    queryFn: () => apiGet<ConnectionResponse[]>('/api/connections'),
    retry: false,
  })

  // Populate forms from existing connections
  useEffect(() => {
    if (!connections) return
    for (const conn of connections) {
      if (conn.platform === 'odoo') {
        setOdooState((s) => ({
          ...s,
          connectionId: conn.id,
          lastTested: conn.last_tested_at ?? null,
          status: conn.is_active ? 'connected' : 'idle',
        }))
      }
      if (conn.platform === 'woocommerce') {
        setWcState((s) => ({
          ...s,
          connectionId: conn.id,
          lastTested: conn.last_tested_at ?? null,
          status: conn.is_active ? 'connected' : 'idle',
        }))
      }
    }
  }, [connections])

  // ── Save + Test mutation factory ───────────────────────────────
  const useSaveAndTest = (
    platform: 'odoo' | 'woocommerce',
    setState: React.Dispatch<React.SetStateAction<SectionState>>,
    getConfig: () => Record<string, unknown>,
    connectionId: number | null,
  ) => {
    return useMutation<ConnectionTestResult, Error, void>({
      mutationFn: async () => {
        const config = getConfig()
        let id = connectionId

        // Save/update connection first
        if (id) {
          await apiPut<ConnectionResponse>(`/api/connections/${id}`, {
            config,
          } as unknown as ConnectionUpdate)
        } else {
          const created = await apiPost<ConnectionResponse>('/api/connections', {
            platform,
            name: `${platform} connection`,
            config,
          } as unknown as ConnectionCreate)
          id = created.id
          setState((s) => ({ ...s, connectionId: id }))
        }

        // Test connection
        return apiPost<ConnectionTestResult>(`/api/connections/${id}/test`, {})
      },
      onMutate: () => {
        setState((s) => ({ ...s, status: 'testing', testResult: null }))
      },
      onSuccess: (result) => {
        const now = new Date().toISOString()
        setState((s) => ({
          ...s,
          status: result.success ? 'connected' : 'error',
          testResult: result,
          lastTested: now,
        }))
        queryClient.invalidateQueries({ queryKey: ['connections'] })
      },
      onError: (error) => {
        setState((s) => ({
          ...s,
          status: 'error',
          testResult: {
            success: false,
            message: error.message || 'Connection test failed',
          },
        }))
      },
    })
  }

  // ── Validation ─────────────────────────────────────────────────
  const validateOdoo = useCallback((): boolean => {
    const errors: Record<string, string> = {}
    if (!odooForm.url.trim()) errors.url = 'URL is required'
    if (!odooForm.database.trim()) errors.database = 'Database name is required'
    if (!odooForm.username.trim()) errors.username = 'Username is required'
    if (!odooForm.api_key.trim()) errors.api_key = 'API Key is required'
    setOdooState((s) => ({ ...s, errors }))
    return Object.keys(errors).length === 0
  }, [odooForm])

  const validateWc = useCallback((): boolean => {
    const errors: Record<string, string> = {}
    if (!wcForm.url.trim()) errors.url = 'Store URL is required'
    if (!wcForm.consumer_key.trim()) errors.consumer_key = 'Consumer Key is required'
    if (!wcForm.consumer_secret.trim()) errors.consumer_secret = 'Consumer Secret is required'
    setWcState((s) => ({ ...s, errors }))
    return Object.keys(errors).length === 0
  }, [wcForm])

  const validateWp = useCallback((): boolean => {
    const errors: Record<string, string> = {}
    if (!wpForm.wp_url.trim()) errors.wp_url = 'WordPress URL is required'
    if (!wpForm.app_username.trim()) errors.app_username = 'Username is required'
    if (!wpForm.app_password.trim()) errors.app_password = 'Application Password is required'
    setWpState((s) => ({ ...s, errors }))
    return Object.keys(errors).length === 0
  }, [wpForm])

  // ── Mutations ──────────────────────────────────────────────────
  const odooMutation = useSaveAndTest(
    'odoo',
    setOdooState,
    () => ({ ...odooForm }),
    odooState.connectionId,
  )

  const wcMutation = useSaveAndTest(
    'woocommerce',
    setWcState,
    () => ({ ...wcForm }),
    wcState.connectionId,
  )

  // WordPress Media uses a separate save/test flow — store as woocommerce subtype
  const wpMutation = useMutation<ConnectionTestResult, Error, void>({
    mutationFn: async () => {
      // WordPress media credentials are stored as a separate connection
      // For now we just test the WordPress REST API
      const config = { ...wpForm }
      let id = wpState.connectionId

      if (id) {
        await apiPut<ConnectionResponse>(`/api/connections/${id}`, {
          config,
        } as unknown as ConnectionUpdate)
      } else {
        const created = await apiPost<ConnectionResponse>('/api/connections', {
          platform: 'woocommerce',
          name: 'wordpress-media',
          config,
        } as unknown as ConnectionCreate)
        id = created.id
        setWpState((s) => ({ ...s, connectionId: id }))
      }

      return apiPost<ConnectionTestResult>(`/api/connections/${id}/test`, {})
    },
    onMutate: () => {
      setWpState((s) => ({ ...s, status: 'testing', testResult: null }))
    },
    onSuccess: (result) => {
      const now = new Date().toISOString()
      setWpState((s) => ({
        ...s,
        status: result.success ? 'connected' : 'error',
        testResult: result,
        lastTested: now,
      }))
      queryClient.invalidateQueries({ queryKey: ['connections'] })
    },
    onError: (error) => {
      setWpState((s) => ({
        ...s,
        status: 'error',
        testResult: {
          success: false,
          message: error.message || 'Connection test failed',
        },
      }))
    },
  })

  // ── Test handlers ──────────────────────────────────────────────
  const handleTestOdoo = () => {
    if (validateOdoo()) odooMutation.mutate()
  }
  const handleTestWc = () => {
    if (validateWc()) wcMutation.mutate()
  }
  const handleTestWp = () => {
    if (validateWp()) wpMutation.mutate()
  }

  // ── Currency mismatch detection ────────────────────────────────
  const odooCurrency = odooState.testResult?.currency ?? null
  const wcCurrency = wcState.testResult?.currency ?? null
  const hasCurrencyMismatch =
    odooCurrency !== null &&
    wcCurrency !== null &&
    odooCurrency !== wcCurrency

  // ── Render ─────────────────────────────────────────────────────
  return (
    <PageContainer>
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Plug size={28} style={{ color: 'var(--primary)' }} />
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
            Connection Settings
          </h1>
        </div>
        <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Configure API credentials for Odoo, WooCommerce, and WordPress. Test each connection before syncing.
        </p>
      </div>

      {/* Currency Mismatch Warning */}
      {hasCurrencyMismatch && (
        <div className="mb-6">
          <CurrencyMismatchBanner odooCurrency={odooCurrency!} wcCurrency={wcCurrency!} />
        </div>
      )}

      {/* Connection Sections */}
      <div className="space-y-6">
        {/* ── Odoo Connection ─────────────────────────────── */}
        <SectionCard
          icon={ShieldCheck}
          title="Odoo Connection"
          subtitle="ERP system API credentials (Odoo 17/18 XML-RPC)"
          accentColor="var(--primary)"
          sectionState={odooState}
          onTest={handleTestOdoo}
          isTesting={odooMutation.isPending}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormInput
              label="Odoo URL"
              value={odooForm.url}
              onChange={(v) => setOdooForm((f) => ({ ...f, url: v }))}
              placeholder="https://mycompany.odoo.com"
              error={odooState.errors.url}
            />
            <FormInput
              label="Database"
              value={odooForm.database}
              onChange={(v) => setOdooForm((f) => ({ ...f, database: v }))}
              placeholder="mycompany"
              error={odooState.errors.database}
            />
            <FormInput
              label="Username"
              value={odooForm.username}
              onChange={(v) => setOdooForm((f) => ({ ...f, username: v }))}
              placeholder="admin@company.com"
              error={odooState.errors.username}
            />
            <FormInput
              label="API Key"
              value={odooForm.api_key}
              onChange={(v) => setOdooForm((f) => ({ ...f, api_key: v }))}
              type="password"
              placeholder="••••••••••••"
              error={odooState.errors.api_key}
            />
          </div>
        </SectionCard>

        {/* ── WooCommerce Connection ──────────────────────── */}
        <SectionCard
          icon={ShoppingCart}
          title="WooCommerce Connection"
          subtitle="REST API credentials from WooCommerce → Settings → Advanced → REST API"
          accentColor="var(--secondary)"
          sectionState={wcState}
          onTest={handleTestWc}
          isTesting={wcMutation.isPending}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <FormInput
                label="Store URL"
                value={wcForm.url}
                onChange={(v) => setWcForm((f) => ({ ...f, url: v }))}
                placeholder="https://mystore.com"
                error={wcState.errors.url}
              />
            </div>
            <FormInput
              label="Consumer Key"
              value={wcForm.consumer_key}
              onChange={(v) => setWcForm((f) => ({ ...f, consumer_key: v }))}
              placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              error={wcState.errors.consumer_key}
            />
            <FormInput
              label="Consumer Secret"
              value={wcForm.consumer_secret}
              onChange={(v) => setWcForm((f) => ({ ...f, consumer_secret: v }))}
              type="password"
              placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              error={wcState.errors.consumer_secret}
            />
          </div>
        </SectionCard>

        {/* ── WordPress Media ─────────────────────────────── */}
        <SectionCard
          icon={Image}
          title="WordPress Media"
          subtitle="Application passwords for uploading product images via WordPress REST API"
          accentColor="#e879f9"
          sectionState={wpState}
          onTest={handleTestWp}
          isTesting={wpMutation.isPending}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <FormInput
                label="WordPress URL"
                value={wpForm.wp_url}
                onChange={(v) => setWpForm((f) => ({ ...f, wp_url: v }))}
                placeholder="https://mystore.com"
                error={wpState.errors.wp_url}
              />
            </div>
            <FormInput
              label="Application Username"
              value={wpForm.app_username}
              onChange={(v) => setWpForm((f) => ({ ...f, app_username: v }))}
              placeholder="admin"
              error={wpState.errors.app_username}
            />
            <FormInput
              label="Application Password"
              value={wpForm.app_password}
              onChange={(v) => setWpForm((f) => ({ ...f, app_password: v }))}
              type="password"
              placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
              error={wpState.errors.app_password}
            />
          </div>
        </SectionCard>
      </div>
    </PageContainer>
  )
}
