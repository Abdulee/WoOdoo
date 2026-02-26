'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Rocket, Plug, ShoppingCart, DollarSign, Briefcase, CheckCircle2, Loader2, XCircle, AlertTriangle, ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react'
import { apiGet, apiPost } from '@/lib/api'
import type {
  ConnectionTestResult,
  OdooConnectionConfig,
  WooCommerceConnectionConfig,
} from '../../../types/api'

// ─── Types ──────────────────────────────────────────────────────────

interface ConnectionState {
  connectionId: number | null
  testResult: ConnectionTestResult | null
  isTesting: boolean
  isSaving: boolean
  errors: Record<string, string>
}

// ─── Shared Components ──────────────────────────────────────────────

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

function StepIndicator({ currentStep, steps }: { currentStep: number; steps: { name: string; icon: React.ComponentType<{ size?: number }> }[] }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((s, i) => {
        const stepNum = i + 1
        const isActive = stepNum === currentStep
        const isDone = stepNum < currentStep
        const Icon = s.icon
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="flex items-center justify-center w-10 h-10 rounded-full text-sm font-semibold transition-all"
                style={{
                  background: isActive || isDone ? 'var(--primary)' : 'var(--muted)',
                  color: isActive || isDone ? '#fff' : 'var(--muted-foreground)',
                }}
              >
                {isDone ? <span style={{ color: '#fff' }}><CheckCircle2 size={18} /></span> : <span style={{ color: isActive ? '#fff' : 'var(--muted-foreground)' }}><Icon size={16} /></span>}
              </div>
              <span
                className="text-xs mt-1.5 whitespace-nowrap"
                style={{ color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)' }}
              >
                {s.name}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="w-10 h-0.5 mx-1.5 mt-[-18px]"
                style={{
                  background: isDone ? 'var(--primary)' : 'var(--muted)',
                }}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function WizardCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl overflow-hidden max-w-2xl mx-auto"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="p-6 space-y-5">
        {children}
      </div>
    </div>
  )
}

function TestResultBanner({ result }: { result: ConnectionTestResult }) {
  return (
    <div
      className="rounded-lg px-4 py-3 text-sm flex items-start gap-3"
      style={{
        background: result.success
          ? 'color-mix(in srgb, #10b981 10%, transparent)'
          : 'color-mix(in srgb, var(--destructive) 10%, transparent)',
        border: result.success
          ? '1px solid color-mix(in srgb, #10b981 25%, transparent)'
          : '1px solid color-mix(in srgb, var(--destructive) 25%, transparent)',
      }}
    >
      {result.success ? (
        <span style={{ color: '#10b981' }}><CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" /></span>
      ) : (
        <span style={{ color: 'var(--destructive)' }}><XCircle size={16} className="flex-shrink-0 mt-0.5" /></span>
      )}
      <div className="space-y-1 min-w-0">
        <p style={{ color: 'var(--foreground)' }}>{result.message}</p>
        {result.details && (
          <div className="text-xs space-y-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {result.details.version != null && (
              <p>Version: {String(result.details.version)}</p>
            )}
            {result.details.latency_ms !== undefined && (
              <p>Latency: {String(result.details.latency_ms)}ms</p>
            )}
          </div>
        )}
        {result.currency && (
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Currency: {result.currency}
          </p>
        )}
      </div>
    </div>
  )
}

// ─── Step 1: Welcome ────────────────────────────────────────────────

function StepWelcome() {
  return (
    <WizardCard>
      <div className="text-center py-4">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
          style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
        >
          <span style={{ color: 'var(--primary)' }}><Rocket size={32} /></span>
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
          Welcome to WoOdoo
        </h2>
        <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--muted-foreground)' }}>
          Let&apos;s get your Odoo ↔ WooCommerce sync up and running.
          This wizard will guide you through connecting your systems and creating your first sync job.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 pt-2">
        {[
          { icon: Plug, label: 'Connect Odoo', desc: 'ERP credentials' },
          { icon: ShoppingCart, label: 'Connect WooCommerce', desc: 'REST API keys' },
          { icon: Briefcase, label: 'Create First Job', desc: 'Start syncing' },
        ].map((item, i) => (
          <div
            key={i}
            className="flex flex-col items-center p-4 rounded-lg text-center"
            style={{ background: 'var(--muted)' }}
          >
            <span style={{ color: 'var(--primary)' }}><item.icon size={20} /></span>
            <p className="text-sm font-medium mt-2" style={{ color: 'var(--foreground)' }}>{item.label}</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{item.desc}</p>
          </div>
        ))}
      </div>
    </WizardCard>
  )
}

// ─── Step 2: Odoo Connection ────────────────────────────────────────

function StepOdoo({
  form,
  setForm,
  state,
  onSaveAndTest,
}: {
  form: OdooConnectionConfig
  setForm: React.Dispatch<React.SetStateAction<OdooConnectionConfig>>
  state: ConnectionState
  onSaveAndTest: () => void
}) {
  return (
    <WizardCard>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
        >
          <span style={{ color: 'var(--primary)' }}><ShieldCheck size={18} /></span>
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Odoo Connection</h2>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>ERP system API credentials (Odoo 17/18 XML-RPC)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FormInput
          label="Odoo URL"
          value={form.url}
          onChange={(v) => setForm((f) => ({ ...f, url: v }))}
          placeholder="https://mycompany.odoo.com"
          error={state.errors.url}
        />
        <FormInput
          label="Database"
          value={form.database}
          onChange={(v) => setForm((f) => ({ ...f, database: v }))}
          placeholder="mycompany"
          error={state.errors.database}
        />
        <FormInput
          label="Username"
          value={form.username}
          onChange={(v) => setForm((f) => ({ ...f, username: v }))}
          placeholder="admin@company.com"
          error={state.errors.username}
        />
        <FormInput
          label="API Key"
          value={form.api_key}
          onChange={(v) => setForm((f) => ({ ...f, api_key: v }))}
          type="password"
          placeholder="••••••••••••"
          error={state.errors.api_key}
        />
      </div>

      {state.testResult && <TestResultBanner result={state.testResult} />}

      <button
        onClick={onSaveAndTest}
        disabled={state.isSaving || state.isTesting}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
        style={{
          background: 'var(--primary)',
          color: '#fff',
          opacity: state.isSaving || state.isTesting ? 0.7 : 1,
          cursor: state.isSaving || state.isTesting ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!state.isSaving && !state.isTesting) e.currentTarget.style.filter = 'brightness(1.15)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = 'brightness(1)'
        }}
      >
        {state.isSaving || state.isTesting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {state.isSaving ? 'Saving…' : 'Testing…'}
          </>
        ) : (
          <>
            <ShieldCheck size={14} />
            Save &amp; Test Connection
          </>
        )}
      </button>
    </WizardCard>
  )
}

// ─── Step 3: WooCommerce Connection ─────────────────────────────────

function StepWooCommerce({
  form,
  setForm,
  state,
  onSaveAndTest,
}: {
  form: WooCommerceConnectionConfig
  setForm: React.Dispatch<React.SetStateAction<WooCommerceConnectionConfig>>
  state: ConnectionState
  onSaveAndTest: () => void
}) {
  return (
    <WizardCard>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--secondary) 15%, transparent)' }}
        >
          <span style={{ color: 'var(--secondary)' }}><ShoppingCart size={18} /></span>
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>WooCommerce Connection</h2>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>REST API credentials from WooCommerce → Settings → Advanced → REST API</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <FormInput
            label="Store URL"
            value={form.url}
            onChange={(v) => setForm((f) => ({ ...f, url: v }))}
            placeholder="https://mystore.com"
            error={state.errors.url}
          />
        </div>
        <FormInput
          label="Consumer Key"
          value={form.consumer_key}
          onChange={(v) => setForm((f) => ({ ...f, consumer_key: v }))}
          placeholder="ck_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          error={state.errors.consumer_key}
        />
        <FormInput
          label="Consumer Secret"
          value={form.consumer_secret}
          onChange={(v) => setForm((f) => ({ ...f, consumer_secret: v }))}
          type="password"
          placeholder="cs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          error={state.errors.consumer_secret}
        />
      </div>

      {state.testResult && <TestResultBanner result={state.testResult} />}

      <button
        onClick={onSaveAndTest}
        disabled={state.isSaving || state.isTesting}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
        style={{
          background: 'var(--secondary)',
          color: '#fff',
          opacity: state.isSaving || state.isTesting ? 0.7 : 1,
          cursor: state.isSaving || state.isTesting ? 'not-allowed' : 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!state.isSaving && !state.isTesting) e.currentTarget.style.filter = 'brightness(1.15)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.filter = 'brightness(1)'
        }}
      >
        {state.isSaving || state.isTesting ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {state.isSaving ? 'Saving…' : 'Testing…'}
          </>
        ) : (
          <>
            <ShieldCheck size={14} />
            Save &amp; Test Connection
          </>
        )}
      </button>
    </WizardCard>
  )
}

// ─── Step 4: Currency Check ─────────────────────────────────────────

function StepCurrency({
  odooCurrency,
  wcCurrency,
}: {
  odooCurrency: string | null
  wcCurrency: string | null
}) {
  const hasMismatch = odooCurrency && wcCurrency && odooCurrency !== wcCurrency
  const bothDetected = odooCurrency && wcCurrency

  return (
    <WizardCard>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg"
          style={{ background: 'color-mix(in srgb, #f59e0b 15%, transparent)' }}
        >
          <span style={{ color: '#f59e0b' }}><DollarSign size={18} /></span>
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Currency Check</h2>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>Verify currencies match between systems</p>
        </div>
      </div>

      {bothDetected && !hasMismatch && (
        <div
          className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
          style={{
            background: 'color-mix(in srgb, #10b981 10%, transparent)',
            border: '1px solid color-mix(in srgb, #10b981 25%, transparent)',
          }}
        >
          <span style={{ color: '#10b981' }}><CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" /></span>
          <div>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>Currencies Match</p>
            <p style={{ color: 'var(--muted-foreground)' }}>
              Both systems use <strong style={{ color: 'var(--foreground)' }}>{odooCurrency}</strong>. No conversion needed.
            </p>
          </div>
        </div>
      )}

      {hasMismatch && (
        <div
          className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
          style={{
            background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
            border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)',
          }}
        >
          <span style={{ color: '#f59e0b' }}><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /></span>
          <div>
            <p className="font-medium" style={{ color: '#fbbf24' }}>Currency Mismatch Detected</p>
            <p style={{ color: 'var(--muted-foreground)' }}>
              Odoo uses <strong style={{ color: 'var(--foreground)' }}>{odooCurrency}</strong> but
              WooCommerce uses <strong style={{ color: 'var(--foreground)' }}>{wcCurrency}</strong>.
              Products will sync without price conversion — ensure both systems use the same currency
              or apply manual exchange rates.
            </p>
          </div>
        </div>
      )}

      {!bothDetected && (
        <div
          className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
          style={{
            background: 'var(--muted)',
            border: '1px solid var(--border)',
          }}
        >
          <span style={{ color: 'var(--muted-foreground)' }}><DollarSign size={16} className="flex-shrink-0 mt-0.5" /></span>
          <div>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>Currency Not Detected</p>
            <p style={{ color: 'var(--muted-foreground)' }}>
              {!odooCurrency && !wcCurrency
                ? 'Neither connection returned currency information. Test both connections first.'
                : !odooCurrency
                  ? 'Odoo currency not detected. Test the Odoo connection first.'
                  : 'WooCommerce currency not detected. Test the WooCommerce connection first.'}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 pt-2">
        <div className="p-4 rounded-lg" style={{ background: 'var(--muted)' }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>Odoo Currency</p>
          <p className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>{odooCurrency ?? '—'}</p>
        </div>
        <div className="p-4 rounded-lg" style={{ background: 'var(--muted)' }}>
          <p className="text-xs font-medium mb-1" style={{ color: 'var(--muted-foreground)' }}>WooCommerce Currency</p>
          <p className="text-lg font-bold" style={{ color: 'var(--foreground)' }}>{wcCurrency ?? '—'}</p>
        </div>
      </div>
    </WizardCard>
  )
}

// ─── Step 5: First Job ──────────────────────────────────────────────

function StepFirstJob({
  connectionId,
  direction,
  setDirection,
  isCreating,
  jobCreated,
  onCreateJob,
}: {
  connectionId: number | null
  direction: string
  setDirection: (d: string) => void
  isCreating: boolean
  jobCreated: boolean
  onCreateJob: () => void
}) {
  return (
    <WizardCard>
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex items-center justify-center w-9 h-9 rounded-lg"
          style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
        >
          <span style={{ color: 'var(--primary)' }}><Briefcase size={18} /></span>
        </div>
        <div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--foreground)' }}>Create First Sync Job</h2>
          <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
            Sensible defaults: all core fields mapped, 6-hour sync interval
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-lg" style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}>
          <p className="text-sm font-medium mb-3" style={{ color: 'var(--foreground)' }}>Sync Direction</p>
          <div className="flex flex-wrap gap-3">
            {([
              { value: 'odoo_to_wc', label: 'Odoo → WC' },
              { value: 'wc_to_odoo', label: 'WC → Odoo' },
              { value: 'bidirectional', label: 'Bidirectional' },
            ] as const).map((opt) => (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-all text-sm"
                style={{
                  background: direction === opt.value ? 'color-mix(in srgb, var(--primary) 15%, transparent)' : 'var(--card)',
                  border: direction === opt.value ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                  color: direction === opt.value ? 'var(--foreground)' : 'var(--muted-foreground)',
                }}
              >
                <input
                  type="radio"
                  name="setup_direction"
                  value={opt.value}
                  checked={direction === opt.value}
                  onChange={(e) => setDirection(e.target.value)}
                  className="sr-only"
                />
                <span className="font-medium">{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="text-sm space-y-2" style={{ color: 'var(--muted-foreground)' }}>
          <p><strong style={{ color: 'var(--foreground)' }}>Default field mappings:</strong></p>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {[
              ['name', 'name'],
              ['list_price', 'regular_price'],
              ['default_code', 'sku'],
              ['description', 'description'],
            ].map(([odoo, wc]) => (
              <div key={odoo} className="flex items-center gap-2 px-3 py-1.5 rounded" style={{ background: 'var(--muted)' }}>
                <span style={{ color: 'var(--foreground)' }}>{odoo}</span>
                <span>→</span>
                <span style={{ color: 'var(--foreground)' }}>{wc}</span>
              </div>
            ))}
          </div>
          <p>Schedule: every <strong style={{ color: 'var(--foreground)' }}>6 hours</strong></p>
        </div>

        {jobCreated && (
          <div
            className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
            style={{
              background: 'color-mix(in srgb, #10b981 10%, transparent)',
              border: '1px solid color-mix(in srgb, #10b981 25%, transparent)',
            }}
          >
            <span style={{ color: '#10b981' }}><CheckCircle2 size={16} className="flex-shrink-0 mt-0.5" /></span>
            <p style={{ color: 'var(--foreground)' }}>Sync job created successfully!</p>
          </div>
        )}

        {!connectionId && (
          <div
            className="rounded-lg px-4 py-3 flex items-start gap-3 text-sm"
            style={{
              background: 'color-mix(in srgb, #f59e0b 10%, transparent)',
              border: '1px solid color-mix(in srgb, #f59e0b 30%, transparent)',
            }}
          >
            <span style={{ color: '#f59e0b' }}><AlertTriangle size={16} className="flex-shrink-0 mt-0.5" /></span>
            <p style={{ color: 'var(--muted-foreground)' }}>
              No connection available. Go back and set up at least one connection first.
            </p>
          </div>
        )}

        {!jobCreated && connectionId && (
          <button
            onClick={onCreateJob}
            disabled={isCreating || !connectionId}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all"
            style={{
              background: 'var(--primary)',
              color: '#fff',
              opacity: isCreating ? 0.7 : 1,
              cursor: isCreating ? 'not-allowed' : 'pointer',
            }}
            onMouseEnter={(e) => {
              if (!isCreating) e.currentTarget.style.filter = 'brightness(1.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.filter = 'brightness(1)'
            }}
          >
            {isCreating ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Creating…
              </>
            ) : (
              <>
                <Briefcase size={14} />
                Create Sync Job
              </>
            )}
          </button>
        )}
      </div>
    </WizardCard>
  )
}

// ─── Step 6: Complete ───────────────────────────────────────────────

function StepComplete({ isCompleting, onFinish }: { isCompleting: boolean; onFinish: () => void }) {
  return (
    <WizardCard>
      <div className="text-center py-6">
        <div
          className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4"
          style={{ background: 'color-mix(in srgb, #10b981 15%, transparent)' }}
        >
          <span style={{ color: '#10b981' }}><CheckCircle2 size={32} /></span>
        </div>
        <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--foreground)' }}>
          You&apos;re All Set!
        </h2>
        <p className="text-sm max-w-md mx-auto mb-6" style={{ color: 'var(--muted-foreground)' }}>
          Your connections are configured and your first sync job is ready to go.
          You can manage everything from the dashboard.
        </p>
        <button
          onClick={onFinish}
          disabled={isCompleting}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm font-semibold transition-all"
          style={{
            background: 'var(--primary)',
            color: '#fff',
            opacity: isCompleting ? 0.7 : 1,
            cursor: isCompleting ? 'not-allowed' : 'pointer',
          }}
          onMouseEnter={(e) => {
            if (!isCompleting) e.currentTarget.style.filter = 'brightness(1.15)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'brightness(1)'
          }}
        >
          {isCompleting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Finishing…
            </>
          ) : (
            <>
              Go to Dashboard
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </div>
    </WizardCard>
  )
}

// ─── Main Page ──────────────────────────────────────────────────────

const STEPS = [
  { name: 'Welcome', icon: Rocket },
  { name: 'Odoo', icon: Plug },
  { name: 'WooCommerce', icon: ShoppingCart },
  { name: 'Currency', icon: DollarSign },
  { name: 'First Job', icon: Briefcase },
  { name: 'Complete', icon: CheckCircle2 },
]

export default function SetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)

  // ── Odoo form ───────────────────────────────────────────────────
  const [odooForm, setOdooForm] = useState<OdooConnectionConfig>({
    url: '',
    database: '',
    username: '',
    api_key: '',
  })
  const [odooState, setOdooState] = useState<ConnectionState>({
    connectionId: null,
    testResult: null,
    isTesting: false,
    isSaving: false,
    errors: {},
  })

  // ── WooCommerce form ────────────────────────────────────────────
  const [wcForm, setWcForm] = useState<WooCommerceConnectionConfig>({
    url: '',
    consumer_key: '',
    consumer_secret: '',
    version: 'wc/v3',
  })
  const [wcState, setWcState] = useState<ConnectionState>({
    connectionId: null,
    testResult: null,
    isTesting: false,
    isSaving: false,
    errors: {},
  })

  // ── First Job ───────────────────────────────────────────────────
  const [jobDirection, setJobDirection] = useState('odoo_to_wc')
  const [isCreatingJob, setIsCreatingJob] = useState(false)
  const [jobCreated, setJobCreated] = useState(false)

  // ── Complete ────────────────────────────────────────────────────
  const [isCompleting, setIsCompleting] = useState(false)

  // ── Validation ──────────────────────────────────────────────────
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

  // ── Save & Test handlers ────────────────────────────────────────
  const handleSaveAndTestOdoo = async () => {
    if (!validateOdoo()) return
    setOdooState((s) => ({ ...s, isSaving: true, testResult: null }))
    try {
      const config = { ...odooForm }
      let id = odooState.connectionId

      if (id) {
        // Update existing — use main connections API
        await apiPost(`/api/connections/${id}`, { config })
      } else {
        // Create via setup endpoint
        const created = await apiPost<{ id: number }>('/api/setup/connection', {
          platform: 'odoo',
          name: 'Odoo Connection',
          config,
        })
        id = created.id
        setOdooState((s) => ({ ...s, connectionId: id }))
      }

      setOdooState((s) => ({ ...s, isSaving: false, isTesting: true }))

      const result = await apiPost<ConnectionTestResult>('/api/setup/test-connection', {
        connection_id: id,
      })

      setOdooState((s) => ({
        ...s,
        isTesting: false,
        testResult: result,
      }))
    } catch (err) {
      setOdooState((s) => ({
        ...s,
        isSaving: false,
        isTesting: false,
        testResult: {
          success: false,
          message: err instanceof Error ? err.message : 'Connection failed',
        },
      }))
    }
  }

  const handleSaveAndTestWc = async () => {
    if (!validateWc()) return
    setWcState((s) => ({ ...s, isSaving: true, testResult: null }))
    try {
      const config = { ...wcForm }
      let id = wcState.connectionId

      if (id) {
        await apiPost(`/api/connections/${id}`, { config })
      } else {
        const created = await apiPost<{ id: number }>('/api/setup/connection', {
          platform: 'woocommerce',
          name: 'WooCommerce Connection',
          config,
        })
        id = created.id
        setWcState((s) => ({ ...s, connectionId: id }))
      }

      setWcState((s) => ({ ...s, isSaving: false, isTesting: true }))

      const result = await apiPost<ConnectionTestResult>('/api/setup/test-connection', {
        connection_id: id,
      })

      setWcState((s) => ({
        ...s,
        isTesting: false,
        testResult: result,
      }))
    } catch (err) {
      setWcState((s) => ({
        ...s,
        isSaving: false,
        isTesting: false,
        testResult: {
          success: false,
          message: err instanceof Error ? err.message : 'Connection failed',
        },
      }))
    }
  }

  // ── First Job handler ───────────────────────────────────────────
  const handleCreateJob = async () => {
    const connectionId = odooState.connectionId ?? wcState.connectionId
    if (!connectionId) return
    setIsCreatingJob(true)
    try {
      await apiPost('/api/setup/first-job', {
        connection_id: connectionId,
        direction: jobDirection,
      })
      setJobCreated(true)
    } catch {
      // Silently handle — user can retry
    } finally {
      setIsCreatingJob(false)
    }
  }

  // ── Complete handler ────────────────────────────────────────────
  const handleFinish = async () => {
    setIsCompleting(true)
    try {
      await apiPost('/api/setup/complete', {})
      router.push('/')
    } catch {
      setIsCompleting(false)
    }
  }

  // ── Navigation ──────────────────────────────────────────────────
  const canGoNext = (): boolean => {
    if (step === 2) {
      // Odoo: must have tested successfully (or allow skipping)
      return true // Allow proceeding even without test — they can come back
    }
    if (step === 3) {
      return true
    }
    return true
  }

  const goNext = () => {
    if (canGoNext()) setStep((s) => Math.min(s + 1, 6))
  }
  const goBack = () => setStep((s) => Math.max(s - 1, 1))

  // ── Derived state ───────────────────────────────────────────────
  const odooCurrency = odooState.testResult?.currency ?? null
  const wcCurrency = wcState.testResult?.currency ?? null

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--background)' }}>
      {/* Header */}
      <div className="text-center pt-8 pb-2">
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--foreground)' }}>
          Setup Wizard
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
          Step {step} of {STEPS.length}
        </p>
      </div>

      {/* Step Indicator */}
      <div className="px-4 pt-4">
        <StepIndicator currentStep={step} steps={STEPS} />
      </div>

      {/* Step Content */}
      <div className="flex-1 px-4 pb-4">
        {step === 1 && <StepWelcome />}
        {step === 2 && (
          <StepOdoo
            form={odooForm}
            setForm={setOdooForm}
            state={odooState}
            onSaveAndTest={handleSaveAndTestOdoo}
          />
        )}
        {step === 3 && (
          <StepWooCommerce
            form={wcForm}
            setForm={setWcForm}
            state={wcState}
            onSaveAndTest={handleSaveAndTestWc}
          />
        )}
        {step === 4 && (
          <StepCurrency odooCurrency={odooCurrency} wcCurrency={wcCurrency} />
        )}
        {step === 5 && (
          <StepFirstJob
            connectionId={odooState.connectionId ?? wcState.connectionId}
            direction={jobDirection}
            setDirection={setJobDirection}
            isCreating={isCreatingJob}
            jobCreated={jobCreated}
            onCreateJob={handleCreateJob}
          />
        )}
        {step === 6 && (
          <StepComplete isCompleting={isCompleting} onFinish={handleFinish} />
        )}
      </div>

      {/* Navigation */}
      {step < 6 && (
        <div
          className="flex items-center justify-between px-4 py-4 border-t max-w-2xl mx-auto w-full"
          style={{ borderColor: 'var(--border)' }}
        >
          <div>
            {step > 1 && (
              <button
                onClick={goBack}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
                style={{
                  background: 'var(--muted)',
                  color: 'var(--foreground)',
                  border: '1.5px solid var(--border)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
              >
                <ArrowLeft size={14} />
                Back
              </button>
            )}
          </div>
          <button
            onClick={goNext}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
            style={{
              background: 'var(--primary)',
              color: '#fff',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.15)' }}
            onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)' }}
          >
            Next
            <ArrowRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
