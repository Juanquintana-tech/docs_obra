import { useState, useRef, type JSX, type DragEvent, type KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { Ic } from './Icon'
import type { AgentIntent } from '../lib/types'

// ── Tipos locales ─────────────────────────────────────────────────────────────

interface AttachedFile {
  path: string
  name: string
}

type Phase =
  | 'idle'
  | 'interpreting'
  | 'preview'
  | 'disambig'
  | 'executing'
  | 'answered'
  | 'error'

// ── Helpers ───────────────────────────────────────────────────────────────────

function chipClass(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return 'cmd-chip cmd-chip-pdf'
  if (ext === 'xlsx' || ext === 'xls') return 'cmd-chip cmd-chip-xlsx'
  if (ext === 'docx' || ext === 'doc') return 'cmd-chip cmd-chip-docx'
  if (['jpg', 'jpeg', 'png', 'heic', 'webp'].includes(ext)) return 'cmd-chip cmd-chip-img'
  return 'cmd-chip cmd-chip-default'
}

const INTENT_LABELS: Record<AgentIntent['type'], string> = {
  INGEST: 'Nuevo proyecto',
  ADD_ENSAYO: 'Añadir ensayo',
  EXPORT: 'Exportar',
  NAVIGATE: 'Navegar',
  QUERY: 'Consulta',
  MUTATE: 'Cambiar estado',
  AMBIGUOUS: '¿Cuál proyecto?',
  UNKNOWN: 'No entendido'
}

// ── Sub-componente: descripción de la acción propuesta ────────────────────────

function PreviewBody({ intent, fileName }: { intent: AgentIntent; fileName?: string }): JSX.Element {
  const proj = intent.projectRef ? <b>{intent.projectRef}</b> : intent.obraId ? <b>obra #{intent.obraId}</b> : <span>proyecto seleccionado</span>

  switch (intent.type) {
    case 'INGEST':
      return (
        <span>
          Extraer materiales y generar plan de ensayos
          {fileName ? <> a partir de <b>{fileName}</b></> : ''}.
          Se calculará el presupuesto con el motor RAG.
        </span>
      )
    case 'ADD_ENSAYO': {
      const tipoLabel = intent.tipoEnsayo?.replace(/_/g, ' ') ?? 'informe de campo'
      return <span>Añadir un <b>{tipoLabel}</b> al proyecto {proj}.</span>
    }
    case 'EXPORT':
      return (
        <span>
          Exportar el {intent.format === 'word' ? 'documento Word' : 'archivo Excel'} del proyecto {proj}.
        </span>
      )
    case 'MUTATE':
      return (
        <span>
          {intent.action === 'archivar' ? 'Archivar' : 'Restaurar'} el proyecto {proj}.
          {intent.action === 'archivar' && ' Se puede restaurar después desde la lista de proyectos.'}
        </span>
      )
    default:
      return <span>Ejecutar acción sobre {proj}.</span>
  }
}

// ── Componente principal ──────────────────────────────────────────────────────

export function CommandBar(): JSX.Element {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [file, setFile] = useState<AttachedFile | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [intent, setIntent] = useState<AgentIntent | null>(null)
  const [statusMsg, setStatusMsg] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  function reset(): void {
    setText('')
    setFile(null)
    setPhase('idle')
    setIntent(null)
    setStatusMsg('')
  }

  function attachFile(f: File): void {
    const path = window.electron?.webUtils?.getPathForFile(f) ?? ''
    if (!path) return
    setFile({ path, name: f.name })
  }

  function handleDragOver(e: DragEvent): void {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(e: DragEvent): void {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false)
  }

  function handleDrop(e: DragEvent): void {
    e.preventDefault()
    setIsDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) attachFile(dropped)
    inputRef.current?.focus()
  }

  async function pickFile(): Promise<void> {
    const picked = await api.pickDocument()
    if (!picked) return
    setFile({ path: picked.path, name: picked.name })
    inputRef.current?.focus()
  }

  async function interpret(): Promise<void> {
    if (!text.trim() && !file) return
    setPhase('interpreting')
    try {
      const result = await api.interpretCommand(text.trim(), file ? [file.name] : [])
      setIntent(result)

      if (result.type === 'NAVIGATE') {
        executeNavigation(result)
        return
      }
      if (result.type === 'QUERY') {
        setPhase('answered')
        setStatusMsg(result.answer ?? 'Sin datos disponibles.')
        return
      }
      if (result.type === 'AMBIGUOUS') {
        setPhase('disambig')
        return
      }
      if (result.type === 'UNKNOWN') {
        setPhase('error')
        setStatusMsg(result.suggestion ?? 'No entendí la instrucción.')
        return
      }
      setPhase('preview')
    } catch (e) {
      setPhase('error')
      setStatusMsg(e instanceof Error ? e.message : 'Error al interpretar la instrucción.')
    }
  }

  function executeNavigation(i: AgentIntent): void {
    const dest = i.destination ?? 'detalle'
    if (dest === 'presupuestos') navigate('/presupuestos')
    else if (dest === 'proyectos') navigate('/proyectos')
    else if (dest === 'radon') navigate('/radon')
    else if (i.obraId) navigate(`/${dest}/${i.obraId}`)
    else navigate('/proyectos')
    reset()
  }

  function executeIntent(): void {
    if (!intent) return
    switch (intent.type) {
      case 'INGEST':
        navigate('/nueva', {
          state: {
            autoFilePath: file?.path ?? null,
            autoFileName: file?.name ?? null,
            hints: intent.hints ?? null
          }
        })
        reset()
        break
      case 'ADD_ENSAYO':
        navigate(intent.obraId ? `/ensayos/${intent.obraId}` : '/ensayos', {
          state: {
            autoScanPath: file?.path ?? null,
            tipoEnsayo: intent.tipoEnsayo ?? null
          }
        })
        reset()
        break
      case 'EXPORT':
        void handleExport(intent)
        break
      case 'MUTATE':
        void handleMutate(intent)
        break
      default:
        reset()
    }
  }

  async function handleExport(i: AgentIntent): Promise<void> {
    if (!i.obraId) { reset(); return }
    setPhase('executing')
    try {
      const path = i.format === 'word'
        ? await api.exportWord(i.obraId)
        : await api.exportExcel(i.obraId)
      if (path) await api.showInFolder(path)
      reset()
    } catch (e) {
      setPhase('error')
      setStatusMsg(e instanceof Error ? e.message : 'Error al exportar.')
    }
  }

  async function handleMutate(i: AgentIntent): Promise<void> {
    if (!i.obraId || !i.action) { reset(); return }
    setPhase('executing')
    try {
      await api.updateStatus(i.obraId, i.action === 'archivar' ? 'archivada' : 'activa')
      reset()
    } catch (e) {
      setPhase('error')
      setStatusMsg(e instanceof Error ? e.message : 'Error al cambiar estado.')
    }
  }

  function selectCandidate(candidateId: number): void {
    if (!intent) return
    const hasFile = !!file
    navigate(
      hasFile ? `/ensayos/${candidateId}` : `/detalle/${candidateId}`,
      hasFile ? { state: { autoScanPath: file?.path, tipoEnsayo: intent.tipoEnsayo } } : {}
    )
    reset()
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void interpret() }
    if (e.key === 'Escape') reset()
  }

  const canSend = (text.trim().length > 0 || !!file) && phase === 'idle'
  const isBusy = phase === 'interpreting' || phase === 'executing'
  const previewIcon = intent
    ? { INGEST: <Ic.NuevoProyecto size={14} />, ADD_ENSAYO: <Ic.Ensayos size={14} />, EXPORT: <Ic.Download size={14} />, MUTATE: intent.action === 'archivar' ? <Ic.Archive size={14} /> : <Ic.Restore size={14} />, AMBIGUOUS: <Ic.Search size={14} />, NAVIGATE: <Ic.ChevronRight size={14} />, QUERY: <Ic.Search size={14} />, UNKNOWN: <Ic.Close size={14} /> }[intent.type]
    : null

  return (
    <div
      className={`cmd-bar${isDragOver ? ' cmd-bar-drag' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="cmd-bar-row">
        <div className="cmd-bar-icon" aria-hidden="true">
          {isBusy ? <span className="spin" style={{ width: 14, height: 14, borderWidth: 2 }} /> : <Ic.Sparkles size={15} />}
        </div>

        <textarea
          ref={inputRef}
          className="cmd-bar-input"
          placeholder={
            isDragOver
              ? 'Suelta el archivo aquí…'
              : file
              ? '¿Qué hago con este archivo?'
              : '¿Qué quieres hacer? Escribe o arrastra un documento…'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={phase !== 'idle'}
          autoComplete="off"
          spellCheck={false}
          rows={2}
        />

        <div className="cmd-bar-divider" />

        <button
          className="btn btn-sm"
          onClick={() => void pickFile()}
          disabled={phase !== 'idle'}
          title="Adjuntar archivo"
        >
          <Ic.Upload size={14} />
        </button>

        <button
          className={`btn btn-sm${canSend ? ' btn-primary' : ''}`}
          onClick={() => void interpret()}
          disabled={!canSend}
        >
          <Ic.Send size={14} />
          Enviar
        </button>
      </div>

      {file && (
        <div className="cmd-bar-chips">
          <span className={chipClass(file.name)}>
            <Ic.FileText size={12} />
            {file.name}
            <button
              className="cmd-chip-remove"
              onClick={() => setFile(null)}
              aria-label="Quitar archivo"
            >
              ×
            </button>
          </span>
        </div>
      )}

      {phase === 'preview' && intent && (
        <div className="cmd-preview">
          <div className="cmd-preview-header">
            {previewIcon}
            {INTENT_LABELS[intent.type]}
          </div>
          <div className="cmd-preview-body">
            <PreviewBody intent={intent} fileName={file?.name} />
          </div>
          <div className="cmd-preview-actions">
            <button className="btn btn-sm btn-primary" onClick={executeIntent}>
              Confirmar
            </button>
            <button className="btn btn-sm" onClick={reset}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {phase === 'disambig' && intent?.candidates && (
        <div className="cmd-disambig">
          <div className="cmd-disambig-title">
            <Ic.Search size={13} />
            ¿A qué proyecto te refieres?
          </div>
          {intent.candidates.map((c) => (
            <button
              key={c.id}
              className="cmd-disambig-item"
              onClick={() => selectCandidate(c.id)}
            >
              <Ic.Proyectos size={14} />
              {c.nombre}
              <span className="cmd-disambig-meta">{c.n_ensayos} ensayos · #{c.id}</span>
            </button>
          ))}
          <button className="cmd-disambig-item" onClick={reset} style={{ color: 'var(--text-soft)' }}>
            <Ic.Close size={14} />
            Cancelar
          </button>
        </div>
      )}

      {(phase === 'answered' || phase === 'error') && (
        <div className={`cmd-status cmd-status-${phase === 'answered' ? 'answer' : 'error'}`}>
          <span style={{ flex: 1 }}>{statusMsg}</span>
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
