import { useState, useEffect, useCallback, useRef, type JSX, type DragEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { PlanTable } from '../components/PlanTable'
import { Ic } from '../components/Icon'
import { FormField, DateFormField } from '../components/FormField'
import { errorMessage } from '../lib/errors'
import type { IngestResult, PlanRowInput, PriceStrategy, BudgetSheet, BudgetImportResult } from '../lib/types'

// ── Constantes ───────────────────────────────────────────────────────────────

const STRATEGY_LABELS: Record<PriceStrategy, string> = {
  reciente: 'Precio más reciente',
  mediana: 'Precio mediana',
  max: 'Precio máximo',
  min: 'Precio mínimo',
  importado: 'Precio importado'
}

// Estrategias seleccionables por el usuario (excluye 'importado', interna del flujo de importación).
const SELECTABLE_STRATEGIES = (Object.keys(STRATEGY_LABELS) as PriceStrategy[]).filter(
  (s) => s !== 'importado'
)

const GEN_STAGES = [
  { id: 0, label: 'Extrayendo texto del documento', pctEnd: 18 },
  { id: 1, label: 'Clasificando materiales con IA', pctEnd: 78 },
  { id: 2, label: 'Valorando ensayos con RAG', pctEnd: 96 },
] as const

const IMP_STAGES = [
  { id: 0, label: 'Leyendo fichero', pctEnd: 20 },
  { id: 1, label: 'Extrayendo partidas con IA', pctEnd: 96 },
] as const

const ALLOWED_EXT = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt']

function getFilePath(file: File): string {
  return window.electron?.webUtils?.getPathForFile(file) ?? ''
}

// ── Tipos ─────────────────────────────────────────────────────────────────────

type Mode = 'generate' | 'import'

// Fases compartidas entre modos (review/saving) + específicas por modo
type GenPhase = 'idle' | 'ingesting' | 'review' | 'saving'
type ImpPhase = 'idle' | 'reading' | 'sheet-select' | 'parsing' | 'review' | 'saving'

// ── Componente principal ─────────────────────────────────────────────────────

interface AgentRouteState {
  autoFilePath?: string | null
  autoFileName?: string | null
  hints?: string | null
}

export function NuevaObra(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const didAutoIngest = useRef(false)
  const [mode, setMode] = useState<Mode>('generate')

  // ── Estado modo "Generar" ─────────────────────────────────────────────────
  const [genPhase, setGenPhase] = useState<GenPhase>('idle')
  const [genResult, setGenResult] = useState<IngestResult | null>(null)
  const [strategy, setStrategy] = useState<PriceStrategy>('reciente')
  const [repricing, setRepricing] = useState(false)
  const [pastedText, setPastedText] = useState('')
  const repriceSeq = useRef(0)

  // ── Estado modo "Importar" ────────────────────────────────────────────────
  const [impPhase, setImpPhase] = useState<ImpPhase>('idle')
  const [impResult, setImpResult] = useState<BudgetImportResult | null>(null)
  const [sheets, setSheets] = useState<BudgetSheet[]>([])
  const [selectedSheet, setSelectedSheet] = useState<string | null>(null)
  const [pendingPath, setPendingPath] = useState<string>('')

  // ── Estado compartido ─────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [chunkInfo, setChunkInfo] = useState<{ done: number; total: number } | null>(null)

  // Campos del formulario de la obra
  const [obra, setObra] = useState('')
  const [cliente, setCliente] = useState('')
  const [refLab, setRefLab] = useState('')
  const [fecha, setFecha] = useState('')
  const [responsable, setResponsable] = useState('')
  const [ivaRate, setIvaRate] = useState(21)
  const [discountPct, setDiscountPct] = useState(0)

  // ── Progreso simulado ─────────────────────────────────────────────────────
  const isProcessing = genPhase === 'ingesting' || impPhase === 'parsing'
  useEffect(() => {
    if (!isProcessing) return
    const isImport = impPhase === 'parsing'
    const t0 = Date.now()
    setProgress(0)
    const id = setInterval(() => {
      const secs = (Date.now() - t0) / 1000
      setElapsed(Math.floor(secs))
      setProgress((prev) => {
        const target = isImport
          ? secs < 2 ? (secs / 2) * 20 : 20 + ((secs - 2) / 25) * 76
          : secs < 1.5 ? (secs / 1.5) * 18
          : secs < 22  ? 18 + ((secs - 1.5) / 20.5) * 60
          : secs < 27  ? 78 + ((secs - 22) / 5) * 18
          : 96
        return Math.min(96, Math.max(prev, target))
      })
    }, 400)
    return () => clearInterval(id)
  }, [isProcessing, impPhase])

  // ── Progreso real de chunks (documentos grandes) ─────────────────────────
  useEffect(() => {
    if (genPhase !== 'ingesting') { setChunkInfo(null); return }
    const unsub = api.onIngestProgress(({ done, total }) => {
      setChunkInfo({ done, total })
      // Mapear chunk done/total al rango 18-78% (etapa "Clasificando materiales")
      const pct = 18 + (done / total) * 60
      setProgress((prev) => Math.max(prev, pct))
    })
    return unsub
  }, [genPhase])

  // ── Cambio de modo: resetear estado del otro ──────────────────────────────
  function switchMode(next: Mode): void {
    setMode(next)
    setError(null)
    setDragOver(false)
    if (next === 'generate') {
      setImpPhase('idle'); setImpResult(null); setSheets([]); setSelectedSheet(null)
    } else {
      setGenPhase('idle'); setGenResult(null)
    }
    setObra(''); setCliente(''); setRefLab(''); setFecha(''); setResponsable('')
    setIvaRate(21); setDiscountPct(0)
  }

  // ── Helpers de archivos ───────────────────────────────────────────────────
  function checkExt(name: string): boolean {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (!ALLOWED_EXT.includes(ext)) {
      setError(`Formato no admitido: .${ext}. Usa PDF, DOCX, XLSX, XLS o TXT.`)
      return false
    }
    return true
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODO GENERAR
  // ══════════════════════════════════════════════════════════════════════════

  const doIngest = useCallback(async (path: string, name: string): Promise<void> => {
    setError(null); setFileName(name); setElapsed(0); setChunkInfo(null); setGenPhase('ingesting')
    try {
      const r = await api.ingestDocument(path, strategy)
      setProgress(100)
      await new Promise((res) => setTimeout(res, 350))
      setGenResult(r)
      setObra(r.obra.obra); setCliente(r.obra.cliente); setRefLab(r.obra.ref_doc)
      setGenPhase('review')
    } catch (e) { setError(errorMessage(e)); setGenPhase('idle') }
  }, [strategy])

  // Auto-ingest cuando se llega desde el CommandBar con un archivo ya seleccionado
  useEffect(() => {
    if (didAutoIngest.current || genPhase !== 'idle') return
    const state = location.state as AgentRouteState | null
    if (!state?.autoFilePath) return
    didAutoIngest.current = true
    const name = state.autoFileName ?? state.autoFilePath.split('/').pop() ?? 'documento'
    void doIngest(state.autoFilePath, name)
  }, [doIngest, genPhase, location.state])

  const doIngestText = useCallback(async (text: string): Promise<void> => {
    setError(null); setFileName('Texto pegado'); setElapsed(0); setGenPhase('ingesting')
    try {
      const r = await api.ingestText(text, strategy)
      setProgress(100)
      await new Promise((res) => setTimeout(res, 350))
      setGenResult(r)
      setObra(r.obra.obra); setCliente(r.obra.cliente); setRefLab(r.obra.ref_doc)
      setPastedText(''); setGenPhase('review')
    } catch (e) { setError(errorMessage(e)); setGenPhase('idle') }
  }, [strategy])

  async function pickAndIngest(): Promise<void> {
    const picked = await api.pickDocument()
    if (!picked) return
    await doIngest(picked.path, picked.name)
  }

  async function changeStrategy(next: PriceStrategy): Promise<void> {
    setStrategy(next)
    if (!genResult) return
    const seq = ++repriceSeq.current
    setRepricing(true)
    try {
      const plan = await api.repricePlan(genResult.materials, next)
      if (seq !== repriceSeq.current) return
      setGenResult({ ...genResult, plan, strategy: next })
    } catch (e) {
      if (seq === repriceSeq.current) setError(errorMessage(e))
    } finally {
      if (seq === repriceSeq.current) setRepricing(false)
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODO IMPORTAR
  // ══════════════════════════════════════════════════════════════════════════

  async function startImport(path: string, name: string): Promise<void> {
    setError(null); setFileName(name); setImpPhase('reading')
    try {
      const sheetList = await api.listBudgetSheets(path)
      setPendingPath(path)
      if (sheetList.length > 1) {
        setSheets(sheetList)
        setSelectedSheet(sheetList[0].name)
        setImpPhase('sheet-select')
      } else {
        setSheets(sheetList)
        await doParseBudget(path, sheetList[0]?.name ?? null)
      }
    } catch (e) { setError(errorMessage(e)); setImpPhase('idle') }
  }

  async function doParseBudget(path: string, sheetName: string | null): Promise<void> {
    setImpPhase('parsing'); setElapsed(0)
    try {
      const r = await api.parseBudget(path, sheetName)
      setProgress(100)
      await new Promise((res) => setTimeout(res, 350))
      setImpResult(r)
      setObra(r.obra.obra); setCliente(r.obra.cliente); setRefLab(r.obra.ref_doc)
      setImpPhase('review')
    } catch (e) { setError(errorMessage(e)); setImpPhase('idle') }
  }

  async function pickAndImport(): Promise<void> {
    const picked = await api.pickDocument()
    if (!picked) return
    await startImport(picked.path, picked.name)
  }

  // ── Drag & Drop (compartido) ──────────────────────────────────────────────
  function handleDragOver(e: DragEvent<HTMLDivElement>): void {
    e.preventDefault(); setDragOver(true)
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>): void {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
  }
  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (!file || !checkExt(file.name)) return
    const path = getFilePath(file)
    if (!path) {
      setError('No se pudo leer la ruta. Usa el botón «Seleccionar archivo».')
      return
    }
    if (mode === 'generate') await doIngest(path, file.name)
    else await startImport(path, file.name)
  }

  // ── Guardado (compartido) ─────────────────────────────────────────────────
  async function save(): Promise<void> {
    const plan = mode === 'generate' ? genResult?.plan : impResult?.plan
    if (!plan) return
    const phase = mode === 'generate' ? genPhase : impPhase
    if (phase === 'saving') return

    if (mode === 'generate') setGenPhase('saving')
    else setImpPhase('saving')

    try {
      const id = await api.saveObra(
        {
          obra, cliente, ref_lab: refLab, fecha, responsable,
          coef_baja: 1,
          price_strategy: mode === 'import' ? undefined : strategy,
          iva_rate: ivaRate / 100,
          discount_pct: discountPct
        },
        plan as PlanRowInput[]
      )
      if (discountPct > 0) await api.applyDiscount(id, discountPct)
      navigate('/detalle/' + id)
    } catch (e) {
      setError(errorMessage(e))
      if (mode === 'generate') setGenPhase('review')
      else setImpPhase('review')
    }
  }

  // ── Helpers de render ─────────────────────────────────────────────────────
  const isSaving = genPhase === 'saving' || impPhase === 'saving'
  const isReview = (mode === 'generate' && genPhase === 'review') ||
                   (mode === 'import' && impPhase === 'review')

  const currentPlan = mode === 'generate' ? genResult?.plan : impResult?.plan

  const genCurrentStage =
    progress < GEN_STAGES[0].pctEnd ? 0 : progress < GEN_STAGES[1].pctEnd ? 1 : 2
  const impCurrentStage = progress < IMP_STAGES[0].pctEnd ? 0 : 1

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Nuevo Proyecto</h1>
          <p>
            {mode === 'generate'
              ? 'Sube la memoria o totalizados para generar el plan de ensayos con IA'
              : 'Importa un presupuesto existente para crear un proyecto a partir de él'}
          </p>
        </div>
      </div>

      {/* ── Selector de modo ── */}
      {(genPhase === 'idle' || impPhase === 'idle') && !isReview && (
        <div className="mode-tabs" style={{ display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid var(--border)' }}>
          {(['generate', 'import'] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              style={{
                padding: '10px 22px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: mode === m ? 700 : 400,
                color: mode === m ? 'var(--accent)' : 'var(--text-soft)',
                borderBottom: mode === m ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -2,
                fontSize: 14,
                transition: 'all 0.15s'
              }}
            >
              {m === 'generate' ? '✦ Generar plan con IA' : '📥 Importar presupuesto existente'}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="banner banner-error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>⚠ {error}</span>
          <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: 12, color: 'var(--danger)' }} onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODO GENERAR — IDLE
          ════════════════════════════════════════════════════════════ */}
      {mode === 'generate' && genPhase === 'idle' && (
        <>
          <div
            className={`ingest-zone${dragOver ? ' drag-over' : ''}`}
            onClick={pickAndIngest}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && pickAndIngest()}
          >
            <div className="drop-icon">{dragOver ? <Ic.Folder size={52} /> : <Ic.Upload size={52} />}</div>
            <div className="drop-title">{dragOver ? 'Suelta el archivo para analizar' : 'Arrastra o haz clic para subir'}</div>
            <div className="drop-sub">{dragOver ? '' : 'PDF, DOCX, DOC, XLSX, XLS o TXT — memoria, totalizados o mediciones'}</div>
            <div className="format-chips">
              {['PDF', 'DOCX', 'XLSX', 'XLS', 'TXT'].map((f) => <span key={f} className="format-chip">{f}</span>)}
            </div>
          </div>

          <div className="paste-zone">
            <div className="paste-zone-label">
              <span>¿Lo tienes en texto plano? Pégalo aquí directamente</span>
              {pastedText && (
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setPastedText('')}>Limpiar</button>
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
                <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>{pastedText.trim().length.toLocaleString('es-ES')} caracteres</span>
                <button className="btn btn-primary" onClick={() => doIngestText(pastedText.trim())}>Analizar texto</button>
              </div>
            )}
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODO GENERAR — INGESTING
          ════════════════════════════════════════════════════════════ */}
      {mode === 'generate' && genPhase === 'ingesting' && (
        <ProcessingPanel
          fileName={fileName}
          progress={progress}
          elapsed={elapsed}
          stages={GEN_STAGES as unknown as Stage[]}
          currentStage={genCurrentStage}
          subtitle={chunkInfo ? `Clasificando parte ${chunkInfo.done} de ${chunkInfo.total}…` : undefined}
        />
      )}

      {/* ════════════════════════════════════════════════════════════
          MODO IMPORTAR — IDLE / READING
          ════════════════════════════════════════════════════════════ */}
      {mode === 'import' && (impPhase === 'idle' || impPhase === 'reading') && (
        <div
          className={`ingest-zone${dragOver ? ' drag-over' : ''}`}
          onClick={impPhase === 'idle' ? pickAndImport : undefined}
          onDragOver={impPhase === 'idle' ? handleDragOver : undefined}
          onDragLeave={impPhase === 'idle' ? handleDragLeave : undefined}
          onDrop={impPhase === 'idle' ? handleDrop : undefined}
          role="button" tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && impPhase === 'idle' && pickAndImport()}
          style={{ cursor: impPhase === 'reading' ? 'wait' : 'pointer' }}
        >
          {impPhase === 'reading' ? (
            <>
              <div className="drop-icon" style={{ opacity: 0.5 }}><Ic.Folder size={52} /></div>
              <div className="drop-title">Leyendo {fileName}…</div>
              <div className="drop-sub">Detectando hojas del fichero</div>
            </>
          ) : (
            <>
              <div className="drop-icon">{dragOver ? <Ic.Folder size={52} /> : <Ic.Upload size={52} />}</div>
              <div className="drop-title">{dragOver ? 'Suelta el presupuesto' : 'Arrastra o haz clic para seleccionar'}</div>
              <div className="drop-sub">
                {dragOver ? '' : 'Presupuesto de laboratorio en PDF, Word (DOCX, DOC) o Excel (XLSX, XLS)'}
              </div>
              <div className="format-chips">
                {['PDF', 'DOCX', 'XLSX', 'XLS'].map((f) => <span key={f} className="format-chip">{f}</span>)}
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODO IMPORTAR — SELECCIÓN DE HOJA
          ════════════════════════════════════════════════════════════ */}
      {mode === 'import' && impPhase === 'sheet-select' && (
        <div className="card">
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ marginBottom: 4 }}>Selecciona la hoja del presupuesto</h3>
            <p style={{ fontSize: 13, color: 'var(--text-soft)', margin: 0 }}>
              El archivo <strong>{fileName}</strong> tiene varias hojas. Elige cuál contiene el presupuesto a importar.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {sheets.map((s) => (
              <label
                key={s.name}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: `2px solid ${selectedSheet === s.name ? 'var(--accent)' : 'var(--border)'}`,
                  background: selectedSheet === s.name ? 'var(--accent-bg, #f0f7ff)' : 'var(--bg-card)',
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
              >
                <input
                  type="radio"
                  name="sheet"
                  value={s.name}
                  checked={selectedSheet === s.name}
                  onChange={() => setSelectedSheet(s.name)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-soft)' }}>{s.rowCount} filas</div>
                </div>
                {selectedSheet === s.name && (
                  <span style={{ color: 'var(--accent)', fontSize: 18 }}>✓</span>
                )}
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => { setImpPhase('idle'); setSheets([]) }}>← Volver</button>
            <button
              className="btn btn-primary"
              disabled={!selectedSheet}
              onClick={() => selectedSheet && doParseBudget(pendingPath, selectedSheet)}
            >
              Importar esta hoja →
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          MODO IMPORTAR — PARSING (progreso)
          ════════════════════════════════════════════════════════════ */}
      {mode === 'import' && impPhase === 'parsing' && (
        <ProcessingPanel
          fileName={fileName}
          progress={progress}
          elapsed={elapsed}
          stages={IMP_STAGES as unknown as Stage[]}
          currentStage={impCurrentStage}
          subtitle="Extrayendo partidas del presupuesto…"
        />
      )}

      {/* ════════════════════════════════════════════════════════════
          REVISIÓN (compartida entre modos)
          ════════════════════════════════════════════════════════════ */}
      {isReview && currentPlan && (
        <>
          {/* Banner diferenciador */}
          {mode === 'import' && (
            <div className="banner banner-warn" style={{ background: '#f0f7ff', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
              📥 Presupuesto importado — los precios provienen del documento original. Puedes editarlos en el detalle del proyecto.
            </div>
          )}
          {mode === 'generate' && genResult?.meta.needsOcr && (
            <div className="banner banner-warn">
              ⚠ El documento parece escaneado. El texto extraído puede ser escaso y afectar a la calidad del análisis.
            </div>
          )}

          {/* Datos del proyecto */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <h3>Datos del proyecto</h3>
              <div className="meta-chips">
                {fileName && <span className="meta-chip">📄 {fileName}</span>}
                <span className="meta-chip"><b>{currentPlan.length}</b> líneas de ensayo</span>
                {mode === 'generate' && genResult && (
                  <span className="meta-chip">{genResult.meta.format.toUpperCase()} · {fmtChars(genResult.meta.chars)}</span>
                )}
                {mode === 'import' && impResult && (
                  <span className="meta-chip">{impResult.meta.format.toUpperCase()}{impResult.meta.sheetName ? ` · ${impResult.meta.sheetName}` : ''}</span>
                )}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <FormField label="Obra / Proyecto" value={obra} onChange={setObra} autoFocus />
              <FormField label="Cliente" value={cliente} onChange={setCliente} />
              <FormField label="Ref. Laboratorio" value={refLab} onChange={setRefLab} />
              <DateFormField label="Fecha del plan" value={fecha} onChange={setFecha} />
              <FormField label="Responsable" value={responsable} onChange={setResponsable} />
              <div className="field">
                <label>IVA (%)</label>
                <input
                  type="number"
                  className="input"
                  min={0} max={100} step={1}
                  value={ivaRate}
                  onChange={(e) => setIvaRate(Math.max(0, Math.min(100, Number(e.target.value))))}
                />
              </div>
              <div className="field">
                <label>Descuento (%)</label>
                <input
                  type="number"
                  className="input"
                  min={0} max={100} step={0.1}
                  value={discountPct}
                  onChange={(e) => setDiscountPct(Math.max(0, Math.min(100, Number(e.target.value))))}
                />
                {discountPct > 0 && (
                  <p style={{ fontSize: 11, color: 'var(--text-soft)', marginTop: 3, marginBottom: 0 }}>
                    Se aplicará al guardar
                  </p>
                )}
              </div>
            </div>
            {!obra.trim() && (
              <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                ⚠ Introduce el nombre de la obra antes de guardar.
              </p>
            )}
          </div>

          {/* Cabecera del plan */}
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 12 }}>
            <h3>{mode === 'import' ? 'Partidas importadas' : 'Plan de ensayos valorado'}</h3>
            {mode === 'generate' && (
              <div className="field" style={{ marginBottom: 0, minWidth: 240 }}>
                <label>Estrategia de precio{repricing ? ' · recalculando…' : ''}</label>
                <select
                  className="select"
                  value={strategy}
                  disabled={repricing}
                  onChange={(e) => changeStrategy(e.target.value as PriceStrategy)}
                >
                  {SELECTABLE_STRATEGIES.map((s) => (
                    <option key={s} value={s}>{STRATEGY_LABELS[s]}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <PlanTable rows={currentPlan} />

          <div className="toolbar" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              className="btn"
              onClick={() => {
                if (mode === 'generate') { setGenPhase('idle'); setGenResult(null) }
                else { setImpPhase('idle'); setImpResult(null) }
                setObra(''); setCliente(''); setRefLab(''); setIvaRate(21); setDiscountPct(0)
              }}
              disabled={isSaving}
            >
              ← Volver
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={isSaving || !obra.trim()}
            >
              {isSaving
                ? <><span className="spinner" /> Guardando…</>
                : <><Ic.Save /> Guardar proyecto</>}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Subcomponentes ────────────────────────────────────────────────────────────

interface Stage { id: number; label: string; pctEnd: number }

function ProcessingPanel({
  fileName, progress, elapsed, stages, currentStage, subtitle
}: {
  fileName: string
  progress: number
  elapsed: number
  stages: Stage[]
  currentStage: number
  subtitle?: string
}): JSX.Element {
  return (
    <div className="ingest-panel">
      <div className="ingest-panel-header">
        <div className="ingest-file-name">📄 {fileName}</div>
        <div className="ingest-file-sub">{subtitle ?? 'Analizando con inteligencia artificial…'}</div>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="progress-label">{Math.round(progress)}%</div>
      <div className="stage-list">
        {stages.map((s) => {
          const isDone = currentStage > s.id
          const isActive = currentStage === s.id
          const state = isDone ? 'stage-done' : isActive ? 'stage-active' : 'stage-pending'
          return (
            <div key={s.id} className={`stage-row ${state}`}>
              <span className="stage-bullet">{isDone ? '✓' : isActive ? '●' : String(s.id + 1)}</span>
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
  )
}

// ── Utilidades ────────────────────────────────────────────────────────────────

function fmtChars(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k chars`
  return `${n} chars`
}
