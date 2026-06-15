import { useState, type JSX } from 'react'
import { api } from '../lib/api'
import { PlanTable } from '../components/PlanTable'
import type { IngestResult, PlanRowInput } from '../lib/types'

interface Props {
  onSaved: (id: number) => void
}

type Phase = 'idle' | 'ingesting' | 'review' | 'saving'

export function NuevaObra({ onSaved }: Props): JSX.Element {
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<IngestResult | null>(null)

  // Campos editables de la obra
  const [obra, setObra] = useState('')
  const [cliente, setCliente] = useState('')
  const [refLab, setRefLab] = useState('')
  const [fecha, setFecha] = useState('')
  const [responsable, setResponsable] = useState('')

  async function pickAndIngest(): Promise<void> {
    setError(null)
    const picked = await api.pickDocument()
    if (!picked) return
    setFileName(picked.name)
    setPhase('ingesting')
    try {
      const r = await api.ingestDocument(picked.path)
      setResult(r)
      setObra(r.obra.obra)
      setCliente(r.obra.cliente)
      setRefLab(r.obra.ref_doc)
      setPhase('review')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('idle')
    }
  }

  async function save(): Promise<void> {
    if (!result) return
    setPhase('saving')
    try {
      const id = await api.saveObra(
        { obra, cliente, ref_lab: refLab, fecha, responsable, coef_baja: 1 },
        result.plan as PlanRowInput[]
      )
      onSaved(id)
    } catch (e) {
      setError(errorMessage(e))
      setPhase('review')
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Nuevo Proyecto</h1>
          <p>Sube la memoria o presupuesto (PDF, Word o Excel) para generar el plan</p>
        </div>
      </div>

      {error && <div className="banner banner-error">⚠ {error}</div>}

      {phase === 'idle' && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p className="muted" style={{ marginBottom: 18 }}>
            Acepta PDF, Word (.docx) y Excel (.xlsx) con las cantidades de obra.
          </p>
          <button className="btn btn-primary" onClick={pickAndIngest}>
            📄 Seleccionar documento
          </button>
        </div>
      )}

      {phase === 'ingesting' && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p>
            Analizando <b>{fileName}</b> con IA…
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            Extracción de texto · clasificación de materiales · valoración RAG
          </p>
        </div>
      )}

      {(phase === 'review' || phase === 'saving') && result && (
        <>
          {result.meta.needsOcr && (
            <div className="banner banner-warn">
              El documento parece escaneado: el texto extraído puede ser escaso.
            </div>
          )}
          <div className="card" style={{ marginBottom: 18 }}>
            <h3 style={{ marginBottom: 12 }}>Datos del proyecto</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="Obra" value={obra} onChange={setObra} />
              <Field label="Cliente" value={cliente} onChange={setCliente} />
              <Field label="Ref. Laboratorio" value={refLab} onChange={setRefLab} />
              <Field label="Fecha" value={fecha} onChange={setFecha} placeholder="dd/mm/aaaa" />
              <Field label="Responsable" value={responsable} onChange={setResponsable} />
            </div>
            <p className="muted" style={{ marginTop: 6 }}>
              {result.materials.length} materiales detectados · {result.plan.length} líneas de
              ensayo · documento {result.meta.format.toUpperCase()}
            </p>
          </div>

          <h3 style={{ marginBottom: 12 }}>Plan de ensayos valorado</h3>
          <PlanTable rows={result.plan} />

          <div className="toolbar" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={phase === 'saving' || !obra.trim()}
            >
              {phase === 'saving' ? 'Guardando…' : '💾 Guardar proyecto'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}): JSX.Element {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

function errorMessage(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/MINIMAX_API_KEY/i.test(msg)) {
    return 'Falta la API key de MiniMax. Añádela como MINIMAX_API_KEY en el fichero .env del proyecto.'
  }
  return msg.replace(/^Error invoking remote method '[^']+':\s*/, '')
}
