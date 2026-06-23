import { useState, useMemo, type JSX } from 'react'
import { eur, num, IVA_RATE } from '../lib/format'
import { Ic } from './Icon'
import type { PlanRow } from '../lib/types'

export interface PlanTableRow {
  material?: string
  description?: string
  measurement?: number | null
  measurement_unit?: string
  freq_qty?: number | null
  n_lots?: number | null
  tests_per_lot?: number | null
  n_tests?: number | null
  unit_price?: number | null
  total?: number | null
  price_source?: string
  rag_score?: number
  price_min?: number | null
  price_max?: number | null
  price_n?: number | null
}

// ── Tipos para el modo edición ────────────────────────────────────────────────

/** Fila editable: extiende PlanTableRow con id para poder parchear en DB. */
export type EditableRow = PlanRow

interface EditState {
  description: string
  measurement: string
  n_lots: string
  tests_per_lot: string
  n_tests: string
  unit_price: string
  /** total calculado localmente (no editable) */
  total: number
}

/** Convierte un número DB a string para el input (coma decimal española). */
function toStr(v: number | null | undefined): string {
  if (v == null) return ''
  return String(v).replace('.', ',')
}

/** Parsea un string de input a número (acepta coma decimal). Devuelve 0 si inválido. */
function fromStr(s: string): number {
  const n = parseFloat(s.trim().replace(',', '.'))
  return isNaN(n) ? 0 : n
}

/** Parsea un string a número o null si el campo está vacío. */
function parseNullable(s: string): number | null {
  const t = s.trim()
  if (!t) return null
  const n = parseFloat(t.replace(',', '.'))
  return isNaN(n) ? null : n
}

/** Insignia de confianza de la IA por fila (feature diferenciadora #1). */
function Confidence({
  source,
  score,
  min,
  max,
  n
}: {
  source?: string
  score?: number
  min?: number | null
  max?: number | null
  n?: number | null
}): JSX.Element {
  if (source === 'pricebook') {
    const pct = score != null ? `${(score * 100).toFixed(0)}%` : ''
    const range =
      min != null && max != null && min !== max ? `€${min}–€${max}` : min != null ? `€${min}` : ''
    const nLabel = n != null ? `${n} presupuesto${n !== 1 ? 's' : ''}` : ''
    const tooltip = [range, nLabel, pct ? `similitud ${pct}` : ''].filter(Boolean).join(' · ')
    return (
      <span className="badge badge-pricebook" title={tooltip}>
        ● Histórico {pct}
      </span>
    )
  }
  if (source === 'alagal') {
    return (
      <span
        className="badge badge-alagal"
        title={`Similitud RAG: ${((score ?? 0) * 100).toFixed(0)}%`}
      >
        ● Catálogo {score != null ? `${(score * 100).toFixed(0)}%` : ''}
      </span>
    )
  }
  return (
    <span className="badge badge-fallback" title="Sin match en catálogo: precio base de las reglas">
      ○ Base
    </span>
  )
}

// ── Componente principal ──────────────────────────────────────────────────────

interface Props {
  rows: PlanTableRow[]
  ivaRate?: number
}
interface EditableProps {
  rows: EditableRow[]
  ivaRate?: number
  /** Callback que recibe las filas modificadas cuando se hace Recalcular o Guardar */
  onChange: (rows: EditableRow[]) => void
  onDelete?: (id: number) => void
  onAdd?: (sectionStartIdx: number) => void
}

/** Tabla de solo lectura (modo normal). */
export function PlanTable({ rows, ivaRate }: Props): JSX.Element {
  return <PlanTableInner rows={rows} editable={false} onChangeEditable={() => {}} ivaRate={ivaRate} />
}

/** Tabla editable (modo edición en Detalle). */
export function EditablePlanTable({ rows, ivaRate, onChange, onDelete, onAdd }: EditableProps): JSX.Element {
  return (
    <PlanTableInner
      rows={rows}
      editable={true}
      onChangeEditable={onChange}
      onDelete={onDelete}
      onAdd={onAdd}
      ivaRate={ivaRate}
    />
  )
}

// ── Implementación interna ────────────────────────────────────────────────────

function PlanTableInner({
  rows,
  editable,
  onChangeEditable,
  onDelete,
  onAdd,
  ivaRate = IVA_RATE
}: {
  rows: PlanTableRow[]
  editable: boolean
  onChangeEditable: (rows: EditableRow[]) => void
  onDelete?: (id: number) => void
  onAdd?: (sectionStartIdx: number) => void
  ivaRate?: number
}): JSX.Element {
  // Estado de edición: map de id → campos editados
  const [edits, setEdits] = useState<Record<number, EditState>>({})

  // Mapa inicial derivado de las filas: se recalcula solo cuando cambian rows o editable.
  const baseEdits = useMemo<Record<number, EditState>>(() => {
    if (!editable) return {}
    const m: Record<number, EditState> = {}
    for (const r of rows as EditableRow[]) {
      if (r.row_type !== 'test') continue
      m[r.id] = {
        description: r.description ?? '',
        measurement: toStr(r.measurement),
        n_lots: toStr(r.n_lots),
        tests_per_lot: toStr(r.tests_per_lot),
        n_tests: toStr(r.n_tests),
        unit_price: toStr(r.unit_price),
        total: (r.n_tests ?? 0) * (r.unit_price ?? 0)
      }
    }
    return m
  }, [rows, editable])

  // edits tiene prioridad sobre baseEdits; si edits está vacío usamos baseEdits.
  const activeEdits: Record<number, EditState> =
    Object.keys(edits).length === 0 ? baseEdits : edits

  function setField(id: number, field: keyof Omit<EditState, 'total'>, val: string): void {
    // Tomar el estado actual (editado o base) para la fila
    const cur = activeEdits[id] ?? baseEdits[id]
    if (!cur) return
    const next: EditState = { ...cur, [field]: val }
    if (field === 'n_tests' || field === 'unit_price') {
      const nTests = fromStr(field === 'n_tests' ? val : next.n_tests)
      const uPrice = fromStr(field === 'unit_price' ? val : next.unit_price)
      next.total = Math.round(nTests * uPrice * 100) / 100
    }
    // Construir el nuevo estado completo y propagar inmediatamente al padre
    const newEdits = { ...activeEdits, [id]: next }
    setEdits(newEdits)
    propagate(newEdits)
  }

  /** Recalcula n_tests = n_lots × tests_per_lot para todas las filas y actualiza totales. */
  function recalcAll(): void {
    const newEdits: Record<number, EditState> = {}
    for (const r of rows as EditableRow[]) {
      if (r.row_type !== 'test') continue
      const cur = activeEdits[r.id] ?? baseEdits[r.id]
      const nLots = fromStr(cur.n_lots)
      const tpl = fromStr(cur.tests_per_lot)
      const nTests = nLots > 0 && tpl > 0 ? nLots * tpl : fromStr(cur.n_tests)
      const uPrice = fromStr(cur.unit_price)
      newEdits[r.id] = {
        ...cur,
        n_tests: toStr(nTests),
        total: Math.round(nTests * uPrice * 100) / 100
      }
    }
    setEdits(newEdits)
    // Notificar al padre con las filas actualizadas
    propagate(newEdits)
  }

  /** Propaga el estado actual al padre como EditableRow[]. */
  function propagate(state: Record<number, EditState>): void {
    const updated = (rows as EditableRow[]).map((r) => {
      if (r.row_type !== 'test') return r
      const e = state[r.id]
      if (!e) return r
      return {
        ...r,
        description: e.description,
        measurement: parseNullable(e.measurement),
        n_lots: parseNullable(e.n_lots),
        tests_per_lot: parseNullable(e.tests_per_lot),
        n_tests: fromStr(e.n_tests),
        unit_price: fromStr(e.unit_price),
        total: e.total
      }
    })
    onChangeEditable(updated)
  }

  // Calcular total (desde edits en modo edición, desde rows en modo lectura)
  const total = editable
    ? Object.values(activeEdits).reduce((s, e) => s + e.total, 0)
    : (rows as PlanTableRow[]).reduce((s, r) => s + (r.total ?? 0), 0)

  const trs: JSX.Element[] = []
  let currentMat: string | null = null

  rows.forEach((r, i) => {
    if (r.material !== currentMat) {
      currentMat = r.material ?? null
      const mat = r.material ?? ''
      const label = mat.toUpperCase() + (r.measurement ? `  —  ${num(r.measurement)} ${r.measurement_unit ?? ''}` : '')
      if (editable && onAdd) {
        trs.push(
          <tr className="section" key={`s-${i}`}>
            <td colSpan={8} style={{ userSelect: 'none' }}>{label}</td>
            <td style={{ padding: '0 4px', textAlign: 'center' }}>
              <button
                className="btn-add-row"
                title={`A\u00f1adir l\u00ednea en "${mat}"`}
                onClick={() => onAdd(i)}
              >
                +
              </button>
            </td>
          </tr>
        )
      } else {
        trs.push(
          <tr className="section" key={`s-${i}`}>
            <td colSpan={editable ? 9 : 7}>{label}</td>
          </tr>
        )
      }
    }

    if (!editable) {
      trs.push(
        <tr key={`r-${i}`}>
          <td>{r.description}</td>
          <td className="num">{num(r.measurement)} {r.measurement_unit}</td>
          <td className="num">{num(r.n_lots)}</td>
          <td className="num">{num(r.n_tests)}</td>
          <td className="num">{eur(r.unit_price)}</td>
          <td className="num">{eur(r.total)}</td>
          <td>
            <Confidence
              source={r.price_source}
              score={r.rag_score}
              min={(r as PlanTableRow).price_min}
              max={(r as PlanTableRow).price_max}
              n={(r as PlanTableRow).price_n}
            />
          </td>
        </tr>
      )
    } else {
      const er = (r as EditableRow)
      if (er.row_type !== 'test') return
      const e = activeEdits[er.id] ?? baseEdits[er.id]
      const totalOk = e.total >= 0

      trs.push(
        <tr key={`r-${i}`} className={totalOk ? '' : 'row-warn'}>
          <td>
            <input
              className="plan-input plan-input-desc"
              value={e.description}
              onChange={(ev) => setField(er.id, 'description', ev.target.value)}
              title="Descripción"
            />
          </td>
          <td>
            <input
              className="plan-input"
              value={e.measurement}
              onChange={(ev) => setField(er.id, 'measurement', ev.target.value)}
              title="Medición"
            />
          </td>
          <td>
            <input
              className="plan-input"
              value={e.n_lots}
              onChange={(ev) => setField(er.id, 'n_lots', ev.target.value)}
              title="Nº lotes"
            />
          </td>
          <td>
            <input
              className="plan-input"
              value={e.tests_per_lot}
              onChange={(ev) => setField(er.id, 'tests_per_lot', ev.target.value)}
              title="Ensayos/lote"
            />
          </td>
          <td>
            <input
              className="plan-input plan-input-ntest"
              value={e.n_tests}
              onChange={(ev) => setField(er.id, 'n_tests', ev.target.value)}
              title="Nº ensayos total"
            />
          </td>
          <td>
            <input
              className="plan-input plan-input-price"
              value={e.unit_price}
              onChange={(ev) => setField(er.id, 'unit_price', ev.target.value)}
              title="€/ud"
            />
          </td>
          <td className="num plan-total-cell">{eur(e.total)}</td>
          <td>
            <Confidence
              source={r.price_source}
              score={r.rag_score}
              min={(r as EditableRow & PlanTableRow).price_min}
              max={(r as EditableRow & PlanTableRow).price_max}
              n={(r as EditableRow & PlanTableRow).price_n}
            />
          </td>
          {onDelete && (
            <td style={{ width: 36, padding: '0 6px' }}>
              <button
                className="btn btn-danger"
                style={{ padding: '3px 7px', fontSize: 12, lineHeight: 1 }}
                title="Eliminar línea"
                onClick={() => onDelete(er.id)}
              >
                ✕
              </button>
            </td>
          )}
        </tr>
      )
    }
  })

  return (
    <>
      {editable && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
            Edita los campos y pulsa <b>Recalcular</b> para actualizar los totales (N lotes × ens./lote = Nº uds.).
          </span>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { recalcAll() }}>
            <Ic.Refresh /> Recalcular
          </button>
        </div>
      )}
      <table className="plan-table">
        <thead>
          <tr>
            <th>Ensayo</th>
            {editable ? (
              <>
                <th>Medición</th>
                <th>Lotes</th>
                <th>Ens./lote</th>
                <th>Nº uds.</th>
                <th>€/ud</th>
                <th>Importe</th>
                <th>Origen</th>
                <th style={{ width: 36 }} />
              </>
            ) : (
              <>
                <th>Medida</th>
                <th>Lotes</th>
                <th>Uds.</th>
                <th>€/ud</th>
                <th>Importe</th>
                <th>Origen</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>{trs}</tbody>
      </table>
      <div className="plan-total">
        <span className="muted">
          IVA ({(ivaRate * 100).toFixed(0)}%): <b>{eur(total * ivaRate)}</b>
        </span>
        <span>
          Sin IVA: <b>{eur(total)}</b>
        </span>
        <span className="grand">Total: {eur(total * (1 + ivaRate))}</span>
      </div>
    </>
  )
}
