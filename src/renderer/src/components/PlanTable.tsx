import type { JSX } from 'react'
import { eur, num, IVA_RATE } from '../lib/format'

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
}

/** Insignia de confianza de la IA por fila (feature diferenciadora #1). */
function Confidence({ source, score }: { source?: string; score?: number }): JSX.Element {
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

export function PlanTable({ rows }: { rows: PlanTableRow[] }): JSX.Element {
  const total = rows.reduce((s, r) => s + (r.total ?? 0), 0)

  const trs: JSX.Element[] = []
  let currentMat: string | null = null
  rows.forEach((r, i) => {
    if (r.material !== currentMat) {
      currentMat = r.material ?? null
      trs.push(
        <tr className="section" key={`s-${i}`}>
          <td colSpan={7}>
            {(r.material ?? '').toUpperCase()}
            {r.measurement ? `  —  ${num(r.measurement)} ${r.measurement_unit ?? ''}` : ''}
          </td>
        </tr>
      )
    }
    trs.push(
      <tr key={`r-${i}`}>
        <td>{r.description}</td>
        <td className="num">
          {num(r.measurement)} {r.measurement_unit}
        </td>
        <td className="num">{num(r.n_lots)}</td>
        <td className="num">{num(r.n_tests)}</td>
        <td className="num">{eur(r.unit_price)}</td>
        <td className="num">{eur(r.total)}</td>
        <td>
          <Confidence source={r.price_source} score={r.rag_score} />
        </td>
      </tr>
    )
  })

  return (
    <>
      <table className="plan-table">
        <thead>
          <tr>
            <th>Ensayo</th>
            <th>Medida</th>
            <th>Lotes</th>
            <th>Uds.</th>
            <th>€/ud</th>
            <th>Importe</th>
            <th>Origen</th>
          </tr>
        </thead>
        <tbody>{trs}</tbody>
      </table>
      <div className="plan-total">
        <span className="muted">
          IVA (21%): <b>{eur(total * IVA_RATE)}</b>
        </span>
        <span>
          Sin IVA: <b>{eur(total)}</b>
        </span>
        <span className="grand">Total: {eur(total * (1 + IVA_RATE))}</span>
      </div>
    </>
  )
}
