'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { PageContainer } from '@/components/layout/PageContainer'
import { apiGet, apiPut } from '@/lib/api'
import type { ConnectionResponse, SyncJobResponse } from '../../../../../types/api'

// ─── Local form types (match API body shape) ───────────────────────

interface FilterRule {
  field: string
  operator: string
  value: string
}

interface FieldMappingRule {
  odoo_field: string
  wc_field: string
  direction: 'odoo_to_wc' | 'wc_to_odoo' | 'bidirectional' | 'skip'
  transform?: string
}

type SyncDirection = 'odoo_to_wc' | 'wc_to_odoo' | 'bidirectional'
type ScheduleType = 'manual' | 'cron' | 'interval'

interface JobFormState {
  name: string
  description: string
  connection_id: number | null
  sync_direction: SyncDirection
  filters: FilterRule[]
  field_mappings: FieldMappingRule[]
  schedule_type: ScheduleType
  cron_expression: string
  interval_seconds: number
  is_enabled: boolean
}

const DEFAULT_MAPPINGS: FieldMappingRule[] = [
  { odoo_field: 'name', wc_field: 'name', direction: 'bidirectional' },
  { odoo_field: 'list_price', wc_field: 'regular_price', direction: 'bidirectional' },
  { odoo_field: 'default_code', wc_field: 'sku', direction: 'bidirectional' },
  { odoo_field: 'description', wc_field: 'description', direction: 'bidirectional' },
]

const FILTER_OPERATORS = ['=', '!=', 'in', '>', '<', 'like']

const STEP_NAMES = ['Basic Info', 'Filters', 'Field Mappings', 'Schedule', 'Review & Save']

// ─── Step Indicator ────────────────────────────────────────────────

function StepIndicator({ currentStep, steps }: { currentStep: number; steps: string[] }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {steps.map((name, i) => {
        const stepNum = i + 1
        const isActive = stepNum === currentStep
        const isDone = stepNum < currentStep
        return (
          <div key={i} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-semibold transition-all"
                style={{
                  background: isActive || isDone ? 'var(--primary)' : 'var(--muted)',
                  color: isActive || isDone ? '#fff' : 'var(--muted-foreground)',
                }}
              >
                {isDone ? '✓' : stepNum}
              </div>
              <span
                className="text-xs mt-1.5 whitespace-nowrap"
                style={{ color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)' }}
              >
                {name}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="w-12 h-0.5 mx-2 mt-[-18px]"
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

// ─── Form Input ────────────────────────────────────────────────────

function FormInput({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
  error,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
  required?: boolean
  error?: string
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
        className="w-full px-3 py-2 rounded-lg text-sm transition-colors outline-none"
        style={{
          background: 'var(--muted)',
          color: 'var(--foreground)',
          border: error ? '1.5px solid var(--destructive)' : '1.5px solid var(--border)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = error ? 'var(--destructive)' : 'var(--border)' }}
      />
      {error && <p className="text-xs" style={{ color: 'var(--destructive)' }}>{error}</p>}
    </div>
  )
}

// ─── Form Select ───────────────────────────────────────────────────

function FormSelect({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
        {label}
        {required && <span style={{ color: 'var(--destructive)' }}> *</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-lg text-sm transition-colors outline-none"
        style={{
          background: 'var(--muted)',
          color: 'var(--foreground)',
          border: '1.5px solid var(--border)',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  )
}

// ─── Section Card ──────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h3 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>{title}</h3>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  )
}

// ─── Step 1: Basic Info ────────────────────────────────────────────

function StepBasicInfo({
  form,
  setForm,
  connections,
  errors,
}: {
  form: JobFormState
  setForm: React.Dispatch<React.SetStateAction<JobFormState>>
  connections: ConnectionResponse[]
  errors: Record<string, string>
}) {
  return (
    <SectionCard title="Basic Information">
      <FormInput
        label="Job Name"
        value={form.name}
        onChange={(v) => setForm((f) => ({ ...f, name: v }))}
        placeholder="e.g. Nightly Product Sync"
        required
        error={errors.name}
      />
      <div className="space-y-1.5">
        <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Optional description of this sync job…"
          rows={3}
          className="w-full px-3 py-2 rounded-lg text-sm transition-colors outline-none resize-y"
          style={{
            background: 'var(--muted)',
            color: 'var(--foreground)',
            border: '1.5px solid var(--border)',
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
        />
      </div>
      <FormSelect
        label="Connection"
        value={form.connection_id?.toString() ?? ''}
        onChange={(v) => setForm((f) => ({ ...f, connection_id: v ? Number(v) : null }))}
        options={[
          { value: '', label: '— Select a connection —' },
          ...connections.map((c) => ({ value: c.id.toString(), label: `${c.name} (${c.platform})` })),
        ]}
        required
      />
      <div className="space-y-2">
        <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
          Sync Direction <span style={{ color: 'var(--destructive)' }}>*</span>
        </label>
        <div className="flex flex-wrap gap-4">
          {([
            { value: 'odoo_to_wc', label: 'Odoo → WC' },
            { value: 'wc_to_odoo', label: 'WC → Odoo' },
            { value: 'bidirectional', label: 'Bidirectional' },
          ] as const).map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-all text-sm"
              style={{
                background: form.sync_direction === opt.value ? 'color-mix(in srgb, var(--primary) 15%, transparent)' : 'var(--muted)',
                border: form.sync_direction === opt.value ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
                color: form.sync_direction === opt.value ? 'var(--foreground)' : 'var(--muted-foreground)',
              }}
            >
              <input
                type="radio"
                name="sync_direction"
                value={opt.value}
                checked={form.sync_direction === opt.value}
                onChange={(e) => setForm((f) => ({ ...f, sync_direction: e.target.value as SyncDirection }))}
                className="sr-only"
              />
              <span className="font-medium">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
    </SectionCard>
  )
}

// ─── Step 2: Filters ───────────────────────────────────────────────

function StepFilters({
  form,
  setForm,
}: {
  form: JobFormState
  setForm: React.Dispatch<React.SetStateAction<JobFormState>>
}) {
  const addFilter = () => {
    setForm((f) => ({
      ...f,
      filters: [...f.filters, { field: '', operator: '=', value: '' }],
    }))
  }

  const updateFilter = (index: number, key: keyof FilterRule, value: string) => {
    setForm((f) => ({
      ...f,
      filters: f.filters.map((rule, i) => (i === index ? { ...rule, [key]: value } : rule)),
    }))
  }

  const removeFilter = (index: number) => {
    setForm((f) => ({ ...f, filters: f.filters.filter((_, i) => i !== index) }))
  }

  return (
    <SectionCard title="Filter Rules">
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Define filter rules to narrow which records are synced. Filters are optional.
      </p>
      {form.filters.length > 0 && (
        <div className="space-y-3">
          {form.filters.map((rule, i) => (
            <div
              key={i}
              className="flex items-center gap-2 p-3 rounded-lg"
              style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <input
                type="text"
                value={rule.field}
                onChange={(e) => updateFilter(i, 'field', e.target.value)}
                placeholder="Field name"
                className="flex-1 px-2 py-1.5 rounded-md text-sm outline-none"
                style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
              />
              <select
                value={rule.operator}
                onChange={(e) => updateFilter(i, 'operator', e.target.value)}
                className="px-2 py-1.5 rounded-md text-sm outline-none"
                style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
              >
                {FILTER_OPERATORS.map((op) => (
                  <option key={op} value={op}>{op}</option>
                ))}
              </select>
              <input
                type="text"
                value={rule.value}
                onChange={(e) => updateFilter(i, 'value', e.target.value)}
                placeholder="Value"
                className="flex-1 px-2 py-1.5 rounded-md text-sm outline-none"
                style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
              />
              <button
                onClick={() => removeFilter(i)}
                className="px-2 py-1 rounded-md text-sm font-medium transition-colors"
                style={{ color: 'var(--destructive)' }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--destructive) 10%, transparent)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={addFilter}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: 'var(--muted)',
          color: 'var(--foreground)',
          border: '1.5px solid var(--border)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        + Add Filter
      </button>
    </SectionCard>
  )
}

// ─── Step 3: Field Mappings ────────────────────────────────────────

function StepFieldMappings({
  form,
  setForm,
}: {
  form: JobFormState
  setForm: React.Dispatch<React.SetStateAction<JobFormState>>
}) {
  const addMapping = () => {
    setForm((f) => ({
      ...f,
      field_mappings: [...f.field_mappings, { odoo_field: '', wc_field: '', direction: 'bidirectional' }],
    }))
  }

  const updateMapping = (index: number, key: keyof FieldMappingRule, value: string) => {
    setForm((f) => ({
      ...f,
      field_mappings: f.field_mappings.map((rule, i) =>
        i === index ? { ...rule, [key]: value } : rule,
      ),
    }))
  }

  const removeMapping = (index: number) => {
    setForm((f) => ({ ...f, field_mappings: f.field_mappings.filter((_, i) => i !== index) }))
  }

  const directionOptions: { value: string; label: string }[] = [
    { value: 'odoo_to_wc', label: 'Odoo → WC' },
    { value: 'wc_to_odoo', label: 'WC → Odoo' },
    { value: 'bidirectional', label: 'Bidirectional' },
    { value: 'skip', label: 'Skip' },
  ]

  return (
    <SectionCard title="Field Mappings">
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Map Odoo fields to WooCommerce fields. Default mappings are pre-populated.
      </p>
      <div className="space-y-3">
        {/* Header row */}
        <div className="grid grid-cols-[1fr_1fr_140px_40px] gap-2 px-3 text-xs font-medium" style={{ color: 'var(--muted-foreground)' }}>
          <span>Odoo Field</span>
          <span>WC Field</span>
          <span>Direction</span>
          <span></span>
        </div>
        {form.field_mappings.map((rule, i) => (
          <div
            key={i}
            className="grid grid-cols-[1fr_1fr_140px_40px] gap-2 items-center p-3 rounded-lg"
            style={{ background: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            <input
              type="text"
              value={rule.odoo_field}
              onChange={(e) => updateMapping(i, 'odoo_field', e.target.value)}
              placeholder="Odoo field"
              className="px-2 py-1.5 rounded-md text-sm outline-none"
              style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
            />
            <input
              type="text"
              value={rule.wc_field}
              onChange={(e) => updateMapping(i, 'wc_field', e.target.value)}
              placeholder="WC field"
              className="px-2 py-1.5 rounded-md text-sm outline-none"
              style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
            />
            <select
              value={rule.direction}
              onChange={(e) => updateMapping(i, 'direction', e.target.value)}
              className="px-2 py-1.5 rounded-md text-sm outline-none"
              style={{ background: 'var(--card)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
            >
              {directionOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <button
              onClick={() => removeMapping(i)}
              className="px-2 py-1 rounded-md text-sm font-medium transition-colors"
              style={{ color: 'var(--destructive)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--destructive) 10%, transparent)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <button
        onClick={addMapping}
        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        style={{
          background: 'var(--muted)',
          color: 'var(--foreground)',
          border: '1.5px solid var(--border)',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--primary)' }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
      >
        + Add Mapping
      </button>
    </SectionCard>
  )
}

// ─── Step 4: Schedule ──────────────────────────────────────────────

function StepSchedule({
  form,
  setForm,
}: {
  form: JobFormState
  setForm: React.Dispatch<React.SetStateAction<JobFormState>>
}) {
  return (
    <SectionCard title="Schedule Configuration">
      <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>
        Choose how this sync job should be triggered.
      </p>
      <div className="flex flex-wrap gap-4">
        {([
          { value: 'manual', label: 'Manual' },
          { value: 'cron', label: 'Cron' },
          { value: 'interval', label: 'Interval' },
        ] as const).map((opt) => (
          <label
            key={opt.value}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg cursor-pointer transition-all text-sm"
            style={{
              background: form.schedule_type === opt.value ? 'color-mix(in srgb, var(--primary) 15%, transparent)' : 'var(--muted)',
              border: form.schedule_type === opt.value ? '1.5px solid var(--primary)' : '1.5px solid var(--border)',
              color: form.schedule_type === opt.value ? 'var(--foreground)' : 'var(--muted-foreground)',
            }}
          >
            <input
              type="radio"
              name="schedule_type"
              value={opt.value}
              checked={form.schedule_type === opt.value}
              onChange={(e) => setForm((f) => ({ ...f, schedule_type: e.target.value as ScheduleType }))}
              className="sr-only"
            />
            <span className="font-medium">{opt.label}</span>
          </label>
        ))}
      </div>
      {form.schedule_type === 'cron' && (
        <FormInput
          label="Cron Expression"
          value={form.cron_expression}
          onChange={(v) => setForm((f) => ({ ...f, cron_expression: v }))}
          placeholder="0 2 * * *"
        />
      )}
      {form.schedule_type === 'interval' && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            Every N seconds
          </label>
          <input
            type="number"
            min={1}
            value={form.interval_seconds}
            onChange={(e) => setForm((f) => ({ ...f, interval_seconds: Number(e.target.value) || 0 }))}
            className="w-full px-3 py-2 rounded-lg text-sm transition-colors outline-none"
            style={{
              background: 'var(--muted)',
              color: 'var(--foreground)',
              border: '1.5px solid var(--border)',
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
            onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
          />
        </div>
      )}
    </SectionCard>
  )
}

// ─── Step 5: Review & Save ─────────────────────────────────────────

function StepReview({
  form,
  connections,
}: {
  form: JobFormState
  connections: ConnectionResponse[]
}) {
  const conn = connections.find((c) => c.id === form.connection_id)
  const dirLabel = { odoo_to_wc: 'Odoo → WC', wc_to_odoo: 'WC → Odoo', bidirectional: 'Bidirectional' }

  return (
    <SectionCard title="Review Configuration">
      <div className="space-y-4">
        {/* Basic info */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <div>
            <span style={{ color: 'var(--muted-foreground)' }}>Name</span>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>{form.name || '—'}</p>
          </div>
          <div>
            <span style={{ color: 'var(--muted-foreground)' }}>Connection</span>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>{conn ? `${conn.name} (${conn.platform})` : '—'}</p>
          </div>
          <div>
            <span style={{ color: 'var(--muted-foreground)' }}>Direction</span>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>{dirLabel[form.sync_direction]}</p>
          </div>
          <div>
            <span style={{ color: 'var(--muted-foreground)' }}>Schedule</span>
            <p className="font-medium" style={{ color: 'var(--foreground)' }}>
              {form.schedule_type === 'cron'
                ? `Cron: ${form.cron_expression || '(not set)'}`
                : form.schedule_type === 'interval'
                  ? `Every ${form.interval_seconds}s`
                  : 'Manual'}
            </p>
          </div>
        </div>
        {form.description && (
          <div className="text-sm">
            <span style={{ color: 'var(--muted-foreground)' }}>Description</span>
            <p style={{ color: 'var(--foreground)' }}>{form.description}</p>
          </div>
        )}

        {/* Filters */}
        <div>
          <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
            Filters ({form.filters.length})
          </h4>
          {form.filters.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>No filters configured</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {form.filters.map((r, i) => (
                <span
                  key={i}
                  className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
                  style={{ background: 'var(--muted)', color: 'var(--foreground)', border: '1px solid var(--border)' }}
                >
                  {r.field} {r.operator} {r.value}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Field mappings */}
        <div>
          <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--foreground)' }}>
            Field Mappings ({form.field_mappings.length})
          </h4>
          <div className="space-y-1">
            {form.field_mappings.map((m, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-md"
                style={{ background: 'var(--muted)' }}
              >
                <span style={{ color: 'var(--foreground)' }}>{m.odoo_field}</span>
                <span style={{ color: 'var(--muted-foreground)' }}>→</span>
                <span style={{ color: 'var(--foreground)' }}>{m.wc_field}</span>
                <span
                  className="ml-auto px-2 py-0.5 rounded-full text-xs"
                  style={{ background: 'var(--card)', color: 'var(--muted-foreground)', border: '1px solid var(--border)' }}
                >
                  {m.direction}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

// ─── Build API body ────────────────────────────────────────────────

function buildJobBody(form: JobFormState) {
  const schedule_config =
    form.schedule_type === 'cron'
      ? { type: 'cron' as const, cron_expression: form.cron_expression }
      : form.schedule_type === 'interval'
        ? { type: 'interval' as const, interval_seconds: form.interval_seconds }
        : null

  return {
    name: form.name,
    description: form.description || undefined,
    connection_id: form.connection_id,
    sync_direction: form.sync_direction,
    filters: form.filters,
    field_mappings: form.field_mappings.length > 0 ? form.field_mappings : DEFAULT_MAPPINGS,
    schedule_config,
    lifecycle_config: null,
    is_enabled: form.is_enabled,
  }
}

// ─── Helpers to parse existing job into form state ─────────────────

function jobToFormState(job: SyncJobResponse): JobFormState {
  // Parse filters — the API may return FilterConfig or FilterRule[]
  let filters: FilterRule[] = []
  if (Array.isArray(job.filters)) {
    filters = job.filters as unknown as FilterRule[]
  }

  // Parse field mappings
  let field_mappings: FieldMappingRule[] = [...DEFAULT_MAPPINGS]
  if (job.field_mappings && job.field_mappings.length > 0) {
    field_mappings = job.field_mappings.map((m) => ({
      odoo_field: m.odoo_field,
      wc_field: m.wc_field,
      direction: m.direction as FieldMappingRule['direction'],
      transform: m.transform,
    }))
  }

  // Parse schedule
  let schedule_type: ScheduleType = 'manual'
  let cron_expression = ''
  let interval_seconds = 3600
  if (job.schedule_config) {
    if (job.schedule_config.cron_expression) {
      schedule_type = 'cron'
      cron_expression = job.schedule_config.cron_expression
    } else if (job.schedule_config.interval_minutes) {
      schedule_type = 'interval'
      interval_seconds = job.schedule_config.interval_minutes * 60
    } else if (job.schedule_config.trigger === 'interval') {
      schedule_type = 'interval'
    } else if (job.schedule_config.trigger === 'cron') {
      schedule_type = 'cron'
    }
  }

  // sync_direction: the API uses `direction` field on SyncJobResponse
  const dir = job.direction as SyncDirection
  const sync_direction: SyncDirection =
    dir === 'odoo_to_wc' || dir === 'wc_to_odoo' || dir === 'bidirectional'
      ? dir
      : 'bidirectional'

  return {
    name: job.name,
    description: '',
    connection_id: job.connection_id ?? null,
    sync_direction,
    filters,
    field_mappings,
    schedule_type,
    cron_expression,
    interval_seconds,
    is_enabled: job.is_enabled,
  }
}

// ─── Main Edit Page ────────────────────────────────────────────────

export default function EditJobPage({ params }: { params: { id: string } }) {
  const router = useRouter()
  const jobId = params.id
  const [step, setStep] = useState(1)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  const [form, setForm] = useState<JobFormState>({
    name: '',
    description: '',
    connection_id: null,
    sync_direction: 'bidirectional',
    filters: [],
    field_mappings: [...DEFAULT_MAPPINGS],
    schedule_type: 'manual',
    cron_expression: '',
    interval_seconds: 3600,
    is_enabled: true,
  })

  // Load existing job
  const { data: job } = useQuery<SyncJobResponse>({
    queryKey: ['job', jobId],
    queryFn: () => apiGet<SyncJobResponse>(`/api/jobs/${jobId}`),
    retry: false,
  })

  // Load connections
  const { data: connectionsData } = useQuery<{ items: ConnectionResponse[]; total: number }>({
    queryKey: ['connections-list'],
    queryFn: () => apiGet<{ items: ConnectionResponse[]; total: number }>('/api/connections'),
    retry: false,
  })
  const connections = connectionsData?.items ?? []

  // Pre-populate form when job loads
  useEffect(() => {
    if (job && !loaded) {
      queueMicrotask(() => {
        setForm(jobToFormState(job))
        setLoaded(true)
      })
    }
  }, [job, loaded])

  const validateStep = (s: number): boolean => {
    const errs: Record<string, string> = {}
    if (s === 1) {
      if (!form.name.trim()) errs.name = 'Name is required'
    }
    setErrors(errs)
    return Object.keys(errs).length === 0
  }

  const goNext = () => {
    if (validateStep(step)) setStep((s) => Math.min(s + 1, 5))
  }

  const goBack = () => setStep((s) => Math.max(s - 1, 1))

  const handleSave = async () => {
    if (!validateStep(1)) { setStep(1); return }
    setSaving(true)
    try {
      const body = buildJobBody(form)
      await apiPut(`/api/jobs/${jobId}`, body)
      router.push('/jobs')
    } catch {
      setSaving(false)
    }
  }

  if (!job) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-20">
          <p className="text-sm" style={{ color: 'var(--muted-foreground)' }}>Loading job…</p>
        </div>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <div
        className="mb-6 rounded-2xl border p-5 sm:p-6"
        style={{
          background: 'linear-gradient(120deg, color-mix(in srgb, var(--primary) 14%, transparent) 0%, color-mix(in srgb, var(--secondary) 10%, transparent) 100%)',
          borderColor: 'color-mix(in srgb, var(--primary) 28%, var(--border))',
        }}
      >
        <h1 className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--foreground)' }}>
          Edit Sync Job
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--muted-foreground)' }}>
          Update the configuration of &ldquo;{job.name}&rdquo;.
        </p>
      </div>

      <StepIndicator currentStep={step} steps={STEP_NAMES} />

      {step === 1 && <StepBasicInfo form={form} setForm={setForm} connections={connections} errors={errors} />}
      {step === 2 && <StepFilters form={form} setForm={setForm} />}
      {step === 3 && <StepFieldMappings form={form} setForm={setForm} />}
      {step === 4 && <StepSchedule form={form} setForm={setForm} />}
      {step === 5 && <StepReview form={form} connections={connections} />}

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6">
        <div>
          {step > 1 && (
            <button
              onClick={goBack}
              className="px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={{
                background: 'var(--muted)',
                color: 'var(--foreground)',
                border: '1.5px solid var(--border)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
            >
              ← Back
            </button>
          )}
        </div>
        <div>
          {step < 5 ? (
            <button
              onClick={goNext}
              className="px-5 py-2.5 rounded-lg text-sm font-medium transition-all"
              style={{
                background: 'var(--primary)',
                color: '#fff',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.filter = 'brightness(1.15)' }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)' }}
            >
              Next →
            </button>
          ) : (
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={{
                background: 'var(--primary)',
                color: '#fff',
                opacity: saving ? 0.7 : 1,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => { if (!saving) e.currentTarget.style.filter = 'brightness(1.15)' }}
              onMouseLeave={(e) => { e.currentTarget.style.filter = 'brightness(1)' }}
            >
              {saving ? 'Saving…' : 'Update Job'}
            </button>
          )}
        </div>
      </div>
    </PageContainer>
  )
}
