/**
 * Barra del agente editor de presupuesto. Aparece en modo edición del plan.
 * El usuario escribe en lenguaje natural ("añade la categoría Hormigón con…",
 * "elimina el ensayo de tracción", "aplica un 10% de descuento"); el agente
 * propone un diff que se previsualiza y, al confirmar, se aplica al plan en
 * edición (sin tocar la DB hasta que el usuario pulsa "Guardar cambios").
 */
import { useState, useRef, type JSX, type KeyboardEvent } from 'react'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import { Ic } from './Icon'
import type { BudgetEditPlan, BudgetOp } from '../lib/types'

type Phase = 'idle' | 'interpreting' | 'preview' | 'error'

interface Props {
  obraId: number
  /** Aplica las operaciones confirmadas al plan en edición. */
  onApply: (plan: BudgetEditPlan) => void
}

const EXAMPLES = [
  'Añade la categoría Hormigón con fabricación y rotura de probetas, 4 ensayos',
  'Elimina el ensayo de tracción de acero',
  'Aplica un descuento del 10%'
]

// ── Descripción legible de una operación ──────────────────────────────────────

function OpLine({ op }: { op: BudgetOp }): JSX.Element {
  switch (op.op) {
    case 'add_category':
      return (
        <li>
          <span className="badge badge-alagal" style={{ marginRight: 6 }}>
            + Categoría
          </span>
          <b>{op.material}</b> con {op.tests.length} ensayo(s):{' '}
          {op.tests.map((t) => t.description).join(', ')}
        </li>
      )
    case 'add_test':
      return (
        <li>
          <span className="badge badge-alagal" style={{ marginRight: 6 }}>
            + Ensayo
          </span>
          <b>{op.description}</b> en {op.material}
          {op.unit_price != null && op.unit_price > 0 ? ` · ${eur(op.unit_price)}/ud` : ''}
        </li>
      )
    case 'delete':
      return (
        <li>
          <span className="badge badge-fallback" style={{ marginRight: 6 }}>
            − Eliminar
          </span>
          {op.ids.length} línea(s)
        </li>
      )
    case 'update':
      return (
        <li>
          <span className="badge badge-pricebook" style={{ marginRight: 6 }}>
            ~ Modificar
          </span>
          línea #{op.id}
        </li>
      )
    case 'discount':
      return (
        <li>
          <span className="badge badge-pricebook" style={{ marginRight: 6 }}>
            % Descuento
          </span>
          <b>{op.pct}%</b> sobre todo el presupuesto
        </li>
      )
  }
}

// ── Componente principal ──────────────────────────────────────────────────────

export function BudgetAgentBar({ obraId, onApply }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [plan, setPlan] = useState<BudgetEditPlan | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  function reset(): void {
    setText('')
    setPhase('idle')
    setPlan(null)
    setErrorMsg('')
  }

  async function interpret(): Promise<void> {
    if (!text.trim()) return
    setPhase('interpreting')
    try {
      const result = await api.interpretBudgetEdit(obraId, text.trim())
      setPlan(result)
      if (result.operations.length === 0) {
        setPhase('error')
        setErrorMsg(result.warnings?.join(' ') ?? 'No se entendió la instrucción.')
        return
      }
      setPhase('preview')
    } catch (e) {
      setPhase('error')
      setErrorMsg(e instanceof Error ? e.message : 'Error al interpretar la instrucción.')
    }
  }

  function confirm(): void {
    if (plan) onApply(plan)
    reset()
    inputRef.current?.focus()
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void interpret()
    }
    if (e.key === 'Escape') reset()
  }

  const canSend = text.trim().length > 0 && phase === 'idle'
  const isBusy = phase === 'interpreting'

  return (
    <div className="cmd-bar" style={{ marginBottom: 12 }}>
      <div className="cmd-bar-row">
        <div className="cmd-bar-icon" aria-hidden="true">
          {isBusy ? (
            <span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} />
          ) : (
            <Ic.Sparkles size={15} />
          )}
        </div>

        <textarea
          ref={inputRef}
          className="cmd-bar-input"
          placeholder='Pide un cambio: "Añade categoría Hormigón con rotura de probetas", "Elimina el ensayo X", "Descuento del 10%"…'
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={phase === 'interpreting'}
          autoComplete="off"
          spellCheck={false}
          rows={2}
        />

        <div className="cmd-bar-divider" />

        <button
          className={`btn btn-sm${canSend ? ' btn-primary' : ''}`}
          onClick={() => void interpret()}
          disabled={!canSend}
        >
          <Ic.Send size={14} />
          Interpretar
        </button>
      </div>

      {phase === 'idle' && (
        <div className="cmd-bar-chips" style={{ gap: 6 }}>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              className="cmd-chip cmd-chip-default"
              style={{ cursor: 'pointer', fontWeight: 'normal' }}
              onClick={() => {
                setText(ex)
                inputRef.current?.focus()
              }}
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {phase === 'preview' && plan && (
        <div className="cmd-preview">
          <div className="cmd-preview-header">
            <Ic.Sparkles size={14} />
            {plan.summary}
          </div>
          <div className="cmd-preview-body">
            <ul
              style={{
                margin: '4px 0',
                paddingLeft: 4,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 6
              }}
            >
              {plan.operations.map((op, i) => (
                <OpLine key={i} op={op} />
              ))}
            </ul>
            {plan.warnings?.length ? (
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--warn)' }}>
                {plan.warnings.map((w, i) => (
                  <div key={i}>⚠ {w}</div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="cmd-preview-actions">
            <button className="btn btn-sm btn-primary" onClick={confirm}>
              Aplicar al plan
            </button>
            <button className="btn btn-sm" onClick={reset}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && (
        <div className="cmd-status cmd-status-error">
          <span style={{ flex: 1 }}>{errorMsg}</span>
          <button
            className="btn btn-sm"
            style={{ padding: '2px 8px', fontSize: 11, flexShrink: 0 }}
            onClick={reset}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}
