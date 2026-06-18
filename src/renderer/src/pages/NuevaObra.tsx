import { useState, useEffect, useCallback, useRef, type JSX, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { PlanTable } from '../components/PlanTable'
import { Ic } from '../components/Icon'
import { FormField, DateFormField } from '../components/FormField'
import { errorMessage } from '../lib/errors'
import type { IngestResult, PlanRowInput, PriceStrategy } from '../lib/types'

// ── Constantes ───────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<PriceStrategy, string> = {
  reciente: 'Precio más reciente',
  mediana: 'Precio mediano',
  max: 'Precio máximo'
}

const STAGES = [
  { id: 0, label: 'Extrayendo texto del documento', pctEnd: 18 },
  { id: 1, label: 'Clasificando materiales con IA', pctEnd: 78 },
  { id: 2, label: 'Valorando ensayos con RAG', pctEnd: 96 },
] as const

const ALLOWED_EXT = ['pdf', 'docx', 'xlsx', 'xls', 'txt']

// Tipos Electron-specific: File expone `path` en el renderer con sandbox:false
interface ElectronFile extends File {
  path: string
}

// ── Componente principal ─────────────────────────────────────────────────────

type Phase = 'idle' | 'ingesting' | 'review' | 'saving'

export function NuevaObra(): JSX.Element {
  const navigate = useNavigate()
  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [result, setResult] = useState<IngestResult | null>(null)
  const [dragOver, setDragOver] = useState(false)

  // Progreso simulado (0-100)
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)

  // Campos editables de la obra
  const [obra, setObra] = useState('')
  const [cliente, setCliente] = useState('')
  const [refLab, setRefLab] = useState('')
  const [fecha, setFecha] = useState('')
  const [responsable, setResponsable] = useState('')
  const [strategy, setStrategy] = useState<PriceStrategy>('reciente')
  const [repricing, setRepricing] = useState(false)
  const [pastedText, setPastedText] = useState('')
  // Secuencia de reprecio: descarta respuestas de cambios de estrategia superados.
  const repriceSeq = useRef(0)

  // ── Progreso simulado ─────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'ingesting') return
    const t0 = Date.now()
    const id = setInterval(() => {
      const secs = (Date.now() - t0) / 1000
      setElapsed(Math.floor(secs))
      setProgress((prev) => {
        // Fase 0 (0-1.5s → 0-18%): extracción de texto, rápida
        // Fase 1 (1.5-22s → 18-78%): llamadas LLM, lenta
        // Fase 2 (22-27s → 78-96%): RAG + plan, media
        const target =
          secs < 1.5 ? (secs / 1.5) * 18 :
          secs < 22  ? 18 + ((secs - 1.5) / 20.5) * 60 :
          secs < 27  ? 78 + ((secs - 22) / 5) * 18 :
          96
        return Math.min(96, Math.max(prev, target))
      })
    }, 400)
    return () => clearInterval(id)
  }, [phase])

  // ── Lógica de ingesta ─────────────────────────────────────────────────────
  const doIngest = useCallback(async (path: string, name: string): Promise<void> => {
    setError(null)
    setFileName(name)
    setProgress(0)
    setElapsed(0)
    setPhase('ingesting')
    try {
      const r = await api.ingestDocument(path, strategy)
      setProgress(100)
      // Breve pausa para que la barra llegue al 100% antes de cambiar de pantalla
      await new Promise((res) => setTimeout(res, 350))
      setResult(r)
      setObra(r.obra.obra)
      setCliente(r.obra.cliente)
      setRefLab(r.obra.ref_doc)
      setPhase('review')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('idle')
    }
  }, [strategy])

  const doIngestText = useCallback(async (text: string): Promise<void> => {
    setError(null)
    setFileName('Texto pegado')
    setProgress(0)
    setElapsed(0)
    setPhase('ingesting')
    try {
      const r = await api.ingestText(text, strategy)
      setProgress(100)
      await new Promise((res) => setTimeout(res, 350))
      setResult(r)
      setObra(r.obra.obra)
      setCliente(r.obra.cliente)
      setRefLab(r.obra.ref_doc)
      setPastedText('')
      setPhase('review')
    } catch (e) {
      setError(errorMessage(e))
      setPhase('idle')
    }
  }, [strategy])

  async function pickAndIngest(): Promise<void> {
    const picked = await api.pickDocument()
    if (!picked) return
    await doIngest(picked.path, picked.name)
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────
  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    setDragOver(true)
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    // Solo desactivar si el puntero sale del contenedor raíz
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0] as ElectronFile | undefined
    if (!file) return
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXT.includes(ext)) {
      setError(`Formato no admitido: .${ext}. Usa PDF, DOCX, XLSX o TXT.`)
      return
    }
    if (!file.path) {
      setError('No se pudo leer la ruta del archivo. Usa el botón «Seleccionar documento».')
      return
    }
    await doIngest(file.path, file.name)
  }

  // ── Reprecio ──────────────────────────────────────────────────────────────
  async function changeStrategy(next: PriceStrategy): Promise<void> {
    setStrategy(next)
    if (!result) return
    const seq = ++repriceSeq.current
    setRepricing(true)
    try {
      const plan = await api.repricePlan(result.materials, next)
      if (seq !== repriceSeq.current) return // llegó un cambio de estrategia más reciente
      setResult({ ...result, plan, strategy: next })
    } catch (e) {
      if (seq === repriceSeq.current) setError(errorMessage(e))
    } finally {
      if (seq === repriceSeq.current) setRepricing(false)
    }
  }

  // ── Guardado ──────────────────────────────────────────────────────────────
  async function save(): Promise<void> {
    if (!result) return
    setPhase('saving')
    try {
      const id = await api.saveObra(
        { obra, cliente, ref_lab: refLab, fecha, responsable, coef_baja: 1, price_strategy: strategy },
        result.plan as PlanRowInput[]
      )
      navigate('/detalle/' + id)
    } catch (e) {
      setError(errorMessage(e))
      setPhase('review')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const currentStage = progress < STAGES[0].pctEnd ? 0 : progress < STAGES[1].pctEnd ? 1 : 2

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Nuevo Proyecto</h1>
          <p>Sube la memoria o presupuesto (PDF, Word o Excel) para generar el plan de ensayos</p>
        </div>
      </div>

      {error && (
        <div className="banner banner-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠ {error}</span>
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: 12, color: 'var(--danger)' }}
            onClick={() => setError(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Zona de carga (idle) ── */}
      {phase === 'idle' && (
        <>
          <div
            className={`ingest-zone${dragOver ? ' drag-over' : ''}`}
            onClick={pickAndIngest}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && pickAndIngest()}
          >
            <div className="drop-icon">
              {dragOver ? <Ic.Folder size={52} /> : <Ic.Upload size={52} />}
            </div>
            <div className="drop-title">
              {dragOver ? 'Suelta el archivo para analizar' : 'Arrastra o haz clic para subir'}
            </div>
            <div className="drop-sub">
              {dragOver ? '' : 'PDF, DOCX, XLSX, XLS o TXT — memoria, presupuesto o mediciones'}
            </div>
            <div className="format-chips">
              {['PDF', 'DOCX', 'XLSX', 'XLS', 'TXT'].map((f) => (
                <span key={f} className="format-chip">{f}</span>
              ))}
            </div>
          </div>

        {/* ── Texto pegado ── */}
        <div className="paste-zone">
          <div className="paste-zone-label">
            <span>¿Lo tienes en texto plano? Pégalo aquí directamente</span>
            {pastedText && (
              <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setPastedText('')}>
                Limpiar
              </button>
            )}
          </div>
          <textarea
            className="paste-textarea"
            placeholder="Pega aquí el contenido: partidas de presupuesto, mediciones, descripción del proyecto…"
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            rows={6}
          />
          {pastedText.trim().length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                {pastedText.trim().length.toLocaleString('es-ES')} caracteres
              </span>
              <button
                className="btn btn-primary"
                onClick={() => doIngestText(pastedText.trim())}
              >
                Analizar texto
              </button>
            </div>
          )}
        </div>
        </>
      )}

      {/* ── Panel de análisis (ingesting) ── */}
      {phase === 'ingesting' && (
        <div className="ingest-panel">
          <div className="ingest-panel-header">
            <div className="ingest-file-name">📄 {fileName}</div>
            <div className="ingest-file-sub">Analizando con inteligencia artificial…</div>
          </div>

          {/* Barra de progreso */}
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="progress-label">{Math.round(progress)}%</div>

          {/* Etapas */}
          <div className="stage-list">
            {STAGES.map((s) => {
              const state =
                currentStage > s.id ? 'stage-done' :
                currentStage === s.id ? 'stage-active' :
                'stage-pending'
              const isDone = currentStage > s.id
              const isActive = currentStage === s.id
              return (
                <div key={s.id} className={`stage-row ${state}`}>
                  <span className="stage-bullet">
                    {isDone ? '✓' : isActive ? '●' : String(s.id + 1)}
                  </span>
                  <span>{s.label}</span>
                </div>
              )
            })}
          </div>

          <div className="ingest-elapsed">
            <span className="dot" />
            Procesando · {elapsed}s transcurridos
          </div>
        </div>
      )}

      {/* ── Revisión y guardado ── */}
      {(phase === 'review' || phase === 'saving') && result && (
        <>
          {result.meta.needsOcr && (
            <div className="banner banner-warn">
              ⚠ El documento parece escaneado. El texto extraído puede ser escaso y afectar a la calidad del análisis.
            </div>
          )}

          {/* Datos del proyecto */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <h3>Datos del proyecto</h3>
              <div className="meta-chips">
                <span className="meta-chip"><b>{result.materials.length}</b> materiales</span>
                <span className="meta-chip"><b>{result.plan.length}</b> líneas de ensayo</span>
                <span className="meta-chip">{result.meta.format.toUpperCase()} · {fmtChars(result.meta.chars)}</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <FormField label="Obra / Proyecto" value={obra} onChange={setObra} autoFocus />
              <FormField label="Cliente" value={cliente} onChange={setCliente} />
              <FormField label="Ref. Laboratorio" value={refLab} onChange={setRefLab} />
              <DateFormField label="Fecha del plan" value={fecha} onChange={setFecha} />
              <FormField label="Responsable" value={responsable} onChange={setResponsable} />
            </div>
            {!obra.trim() && (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                ⚠ Introduce el nombre de la obra antes de guardar.
              </p>
            )}
          </div>

          {/* Cabecera del plan con selector de estrategia */}
          <div
            className="row"
            style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}
          >
            <h3>Plan de ensayos valorado</h3>
            <div className="field" style={{ marginBottom: 0, minWidth: 240 }}>
              <label>Estrategia de precio{repricing ? ' · recalculando…' : ''}</label>
              <select
                className="select"
                value={strategy}
                disabled={repricing}
                onChange={(e) => changeStrategy(e.target.value as PriceStrategy)}
                title="Precio aplicado desde el histórico de presupuestos del laboratorio"
              >
                {(Object.keys(STRATEGY_LABELS) as PriceStrategy[]).map((s) => (
                  <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                ))}
              </select>
            </div>
          </div>

          <PlanTable rows={result.plan} />

          <div className="toolbar" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              className="btn"
              onClick={() => { setPhase('idle'); setResult(null) }}
              disabled={phase === 'saving'}
            >
              ← Volver
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={phase === 'saving' || !obra.trim()}
            >
              {phase === 'saving' ? (
                <><span className="spinner" /> Guardando…</>
              ) : (
                <><Ic.Save /> Guardar proyecto</>
              )}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Utilidades ───────────────────────────────────────────────────────────────

function fmtChars(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k chars`
  return `${n} chars`
}
