import { useState, Fragment, type JSX } from 'react'
import { api } from '../lib/api'
import { eur, num } from '../lib/format'
import { Ic } from '../components/Icon'
import type { BBDDPlanResult } from '../../../main/services/bbddPlan'
import type { PlanLine } from '../../../main/pipeline/kb/engine'

/** Plan generado por el motor determinista (BBDD curada), por tramo, con trazabilidad. */
export function BBDDPlan(): JSX.Element {
  const [doc, setDoc] = useState<string | null>(null)
  const [result, setResult] = useState<BBDDPlanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pickAndGenerate(): Promise<void> {
    setError(null)
    const picked = await api.pickDocument()
    if (!picked) return
    setDoc(picked.name)
    setResult(null)
    setBusy(true)
    try {
      setResult(await api.bbddGenerate(picked.path))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Presupuesto BBDD</h1>
          <p className="muted">
            Motor determinista por lote sobre la base de datos curada (normativa PG-3 / EHE).
            El LLM solo extrae mediciones; cada cifra es trazable.
          </p>
        </div>
        <button className="btn btn-primary" onClick={pickAndGenerate} disabled={busy}>
          <Ic.Upload /> {busy ? 'Generando…' : 'Generar desde documento'}
        </button>
      </div>

      {doc && <p className="muted">Documento: <strong>{doc}</strong></p>}
      {busy && <div className="banner">Extrayendo y clasificando (Gemini→MiniMax) y calculando el plan…</div>}
      {error && <div className="banner banner-danger">Error: {error}</div>}

      {result && <PlanView result={result} />}
    </>
  )
}

function srcBadge(p: PlanLine['provenance']): JSX.Element {
  const cls = p.kind === 'normativa' ? 'badge badge-ok' : 'badge'
  return <span className={cls} title={p.detail ?? ''}>{p.kind === 'normativa' ? p.source : p.source}</span>
}

/** Explicación determinista de por qué una línea está en el plan (desde su provenance). */
function explainLine(l: PlanLine): { porque: string; cuantos: string; precio: string; confianza: string } {
  const p = l.provenance
  const porque = p.kind === 'normativa'
    ? `Exigido por normativa: ${p.source}${p.control ? ` (control de ${p.control})` : ''}.`
    : `Incluido según el histórico de presupuestos de CYE para esta categoría${p.source && p.source !== 'presupuesto CYE (histórico)' ? ` (${p.source})` : ''}.`
  const cuantos = `${num(l.nTests)} ensayo(s)${p.detail ? ` — ${p.detail}` : ''}.`
  const precio = l.unitPrice == null
    ? 'Sin precio en la BBDD: a preciar manualmente.'
    : `${eur(l.unitPrice)}/ensayo · fuente de precio: ${p.priceSource}. Importe: ${eur(l.total ?? 0)}.`
  const confianza = `Confianza del emparejamiento ensayo→catálogo: ${Math.round((p.matchConfidence ?? 0) * 100)}%.`
  return { porque, cuantos, precio, confianza }
}

function PlanView({ result }: { result: BBDDPlanResult }): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <div className="kpis">
        <div className="kpi"><span className="kpi-label">Base imponible</span><span className="kpi-value">{eur(result.totalBase)}</span></div>
        <div className="kpi"><span className="kpi-label">IVA (21%)</span><span className="kpi-value">{eur(result.iva)}</span></div>
        <div className="kpi"><span className="kpi-label">Total</span><span className="kpi-value">{eur(result.totalConIva)}</span></div>
        <div className="kpi"><span className="kpi-label">Tramos · líneas</span><span className="kpi-value">{result.tramos.length} · {result.nLines}</span></div>
        <div className="kpi"><span className="kpi-label">A revisar</span><span className="kpi-value">{result.nReview}</span></div>
      </div>

      {result.warnings.length > 0 && (
        <div className="banner banner-warn">
          <strong>Avisos ({result.warnings.length}):</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {result.tramos.map((t, i) => (
        <div className="card" key={i} style={{ marginBottom: 16 }}>
          <div className="section-actions">
            <h3 style={{ margin: 0 }}>{t.tramo}</h3>
            <span className="muted">{t.nLines} líneas{t.nReview > 0 ? ` · ${t.nReview} ⚠` : ''} · {eur(t.subtotal)}</span>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '0 0 4px' }}>Haz clic en una línea para ver <strong>por qué está en el plan</strong>.</p>
          <table className="plan-table">
            <thead>
              <tr>
                <th>Ensayo</th>
                <th style={{ textAlign: 'right' }}>Nº</th>
                <th style={{ textAlign: 'right' }}>P. unit.</th>
                <th style={{ textAlign: 'right' }}>Importe</th>
                <th>Fuente</th>
              </tr>
            </thead>
            <tbody>
              {t.lines.map((l, j) => {
                const key = `${i}-${j}`
                const ex = explainLine(l)
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={() => setOpen(open === key ? null : key)}
                      style={{ cursor: 'pointer', background: l.needsReview ? 'var(--warn-bg, #fff8e6)' : undefined }}
                    >
                      <td>{open === key ? '▾ ' : '▸ '}{l.needsReview && '⚠ '}{l.description}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{num(l.nTests)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.unitPrice == null ? '—' : eur(l.unitPrice)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{l.total == null ? '—' : eur(l.total)}</td>
                      <td>{srcBadge(l.provenance)} <span className="muted" style={{ fontSize: 11 }}>{l.provenance.priceSource}</span></td>
                    </tr>
                    {open === key && (
                      <tr>
                        <td colSpan={5} style={{ background: 'var(--bg-soft, #f6f8fb)', padding: '10px 14px' }}>
                          <strong style={{ fontSize: 12 }}>¿Por qué este ensayo?</strong>
                          <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.5 }}>
                            <li><strong>Motivo:</strong> {ex.porque}</li>
                            <li><strong>Cantidad:</strong> {ex.cuantos}</li>
                            <li><strong>Precio:</strong> {ex.precio}</li>
                            <li><strong>Confianza:</strong> {ex.confianza}</li>
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  )
}
