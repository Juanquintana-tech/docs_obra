import type { JSX } from 'react'
import { toInputDate, fromInputDate } from '../lib/format'

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
}

export function FormField({ label, value, onChange, placeholder, autoFocus }: FieldProps): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export function DateFormField({ label, value, onChange }: Omit<FieldProps, 'placeholder' | 'autoFocus'>): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="date"
        value={toInputDate(value)}
        onChange={(e) => onChange(fromInputDate(e.target.value))}
      />
    </div>
  )
}

export function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="info-row-label">{label}</div>
      <div className="info-row-value" data-empty={!value}>{value || '—'}</div>
    </div>
  )
}
