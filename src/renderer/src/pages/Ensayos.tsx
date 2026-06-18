/**
 * Página de Ensayos — lista de informes de campo por obra y editor por tipo.
 * Tipos soportados: densidad_in_situ (ASTM D-6938), placa_carga (NLT-357/98),
 * granulometria de escollera (UNE EN 13383-2) y albaran_ensayos.
 */
import { Fragment, useEffect, useState, useCallback, type JSX } from 'react'
import { useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { Ic } from '../components/Icon'
import { ScanPanel } from '../components/ScanPanel'
import { errorMessage } from '../lib/errors'
import {
  densidadSummary,
  placaSummary,
  asientoMedio,
  granulometriaSummary,
  parseMasas,
  GRANULO_SPEC
} from '../lib/ensayoCalc'
import type { Ensayo, EnsayoInput, Obra } from '../lib/types'
import './Ensayos.css'

// ── Tipos de ensayo (espejo de ensayos.ts TIPOS) ─────────────────────────────

const TIPOS: Record<string, { label: string; norma: string }> = {
  albaran_ensayos: {
    label: 'Albarán de ensayos',
    norma: 'CYE — Solicitud, toma de muestra y registro'
  },
  densidad_in_situ: {
    label: 'Densidad y humedad in situ',
    norma: 'ASTM D-6938 / PG-3 Art.330.6.5.4'
  },
  placa_carga: { label: 'Ensayo de carga con placa', norma: 'NLT-357/98' },
  granulometria: {
    label: 'Granulometría de escollera (5-40 kg)',
    norma: 'UNE EN 13383-2'
  }
}

/** Tipos que tienen informe Word disponible (granulometría aún no). */
const WORD_TIPOS = new Set(['albaran_ensayos', 'densidad_in_situ', 'placa_carga'])
/** Tipos con export a Excel. */
const EXCEL_TIPOS = new Set(['densidad_in_situ', 'placa_carga', 'granulometria'])

// ── Valores por defecto de presiones de placa ────────────────────────────────

const PLACA_CICLO1_PRESIONES = [0.0, 0.07, 0.15, 0.21, 0.28, 0.35, 0.42, 0.5]
const PLACA_CICLO2_PRESIONES = [0.07, 0.15, 0.21, 0.28, 0.35, 0.42]

function defaultDensidadDatos(): Record<string, unknown> {
  return {
    cabecera: { capa: 'Coronación', n_lote: '1' },
    ensayos: Array.from({ length: 6 }, (_, i) => ({ n: i + 1 })),
    compactacion_min: 100,
    cond3_cumple: null
  }
}

function defaultAlbaranDatos(): Record<string, unknown> {
  return {
    n_ensayo_ot: '',
    fecha_toma: '',
    fecha_entrada: '',
    titulo_obra: '',
    ref_obra: '',
    empresa: '',
    direccion: '',
    nif_cif: '',
    persona_contacto: '',
    telefono_fax: '',
    observaciones_cliente: '',
    peticionario: '',
    efectuada_por_cye: false,
    recibida_en_cye: false,
    ensayo_in_situ: false,
    recogida_por_cye_en: '',
    material_descripcion: '',
    localizacion: '',
    otros_datos: '',
    indicaciones_toma: '',
    cantidad_muestra: '',
    firma_tipo: 'analista',
    fdo_muestra: '',
    ensayos_solicitados: Array.from({ length: 8 }, () => ({ ensayo: '', normativa: '' })),
    condiciones_ejecucion: '',
    inspeccion: '',
    aceptacion_cliente: false,
    aceptacion_peticionario: false,
    aceptacion_dir_tecnico: false,
    aceptacion_jefe_area: false,
    comentarios: '',
    fdo_cliente: '',
    fecha_firma_cliente: '',
    fdo_tecnico: '',
    fecha_firma_tecnico: '',
    fecha_encargo: '',
    fecha_informe: ''
  }
}

/** Nº de filas inicial de la lista de masas (las del registro en papel); ampliable. */
const GRANULO_FILAS_INICIALES = 30
const GRANULO_FILAS_MAX = 430 // capacidad de la plantilla (B3:B432)

function defaultGranulometriaDatos(): Record<string, unknown> {
  return {
    cabecera: { material: 'Escollera 5-40 kg / Armour stone 5-40 kg' },
    masas: Array.from({ length: GRANULO_FILAS_INICIALES }, () => ''),
    fragmentos_masa: '',
    m50: '',
    lt_pct: '',
    particulas_45: ''
  }
}

function defaultPlacaDatos(): Record<string, unknown> {
  return {
    cabecera: {},
    ciclo1: PLACA_CICLO1_PRESIONES.map((p) => ({ presion: p, l1: '', l2: '', l3: '' })),
    descarga: [
      { presion: 0.25, l1: '', l2: '', l3: '' },
      { presion: 0.125, l1: '', l2: '', l3: '' },
      { presion: 0.0, l1: '', l2: '', l3: '' }
    ],
    ciclo2: PLACA_CICLO2_PRESIONES.map((p) => ({ presion: p, l1: '', l2: '', l3: '' })),
    ratio_max: 2.2,
    radio_mm: 150
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function verdictClass(v: string): string {
  if (v === 'CUMPLE') return 'verdict ok'
  if (v === 'NO CUMPLE') return 'verdict no'
  return 'verdict'
}

function fmt(v: unknown, dec = 2): string {
  if (v === null || v === undefined || v === '') return '—'
  const n = parseFloat(String(v).replace(',', '.'))
  if (isNaN(n)) return '—'
  return n.toFixed(dec).replace('.', ',')
}

// ── Componente principal ─────────────────────────────────────────────────────

export function Ensayos(): JSX.Element {
  const { obraId: obraIdStr } = useParams<{ obraId?: string }>()
  const [obras, setObras] = useState<Obra[]>([])
  const [obraId, setObraId] = useState<number | null>(obraIdStr ? Number(obraIdStr) : null)
  const [ensayos, setEnsayos] = useState<Ensayo[]>([])
  const [editing, setEditing] = useState<Ensayo | null>(null) // null = lista
  const [creating, setCreating] = useState<string | null>(null) // tipo nuevo
  const [msg, setMsg] = useState<string | null>(null)
  const [lastPath, setLastPath] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.getObras().then(
      (list) => {
        if (!cancelled) setObras(list)
      },
      (e) => {
        if (!cancelled) setMsg(`Error al cargar proyectos: ${errorMessage(e)}`)
      }
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!obraId) return
    let cancelled = false
    api.getEnsayos(obraId).then(
      (list) => {
        if (!cancelled) setEnsayos(list)
      },
      (e) => {
        if (!cancelled) setMsg(`Error al cargar ensayos: ${errorMessage(e)}`)
      }
    )
    return () => {
      cancelled = true
    }
  }, [obraId])

  async function loadEnsayos(id: number): Promise<void> {
    try {
      const list = await api.getEnsayos(id)
      setEnsayos(list)
    } catch (e) {
      setMsg(`Error al cargar ensayos: ${errorMessage(e)}`)
    }
  }

  const obra = obras.find((o) => o.id === obraId)

  // ── Vista: lista de informes ──────────────────────────────────────────────

  if (editing === null && creating === null) {
    return (
      <div>
        <div className="page-head">
          <div>
            <h1>Ensayos</h1>
            <p>Informes de campo rellenados en obra — cálculo automático y descarga con membrete</p>
          </div>
        </div>

        {/* Selector de obra */}
        <div className="card" style={{ marginBottom: 20 }}>
          <label className="field-label">Proyecto</label>
          <select
            className="select"
            value={obraId ?? ''}
            onChange={(e) => {
              const v = e.target.value ? Number(e.target.value) : null
              setObraId(v)
              if (!v) setEnsayos([])
            }}
          >
            <option value="">— Selecciona un proyecto —</option>
            {obras.map((o) => (
              <option key={o.id} value={o.id}>
                {o.obra} · {o.cliente || 'sin cliente'}
              </option>
            ))}
          </select>
        </div>

        {msg && (
          <div
            className={`banner ${msg.startsWith('Error') ? 'banner-error' : 'banner-ok'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12
            }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg}</span>
            {lastPath && (
              <button
                className="btn btn-sm"
                style={{ flexShrink: 0 }}
                onClick={() => api.showInFolder(lastPath)}
              >
                <Ic.Folder /> Abrir carpeta
              </button>
            )}
          </div>
        )}

        {obraId && obra && (
          <>
            {/* KPIs */}
            <div className="kpis" style={{ marginBottom: 20 }}>
              <div className="kpi">
                <div className="label">Informes registrados</div>
                <div className="value">{ensayos.length}</div>
              </div>
              <div className="kpi">
                <div className="label">Completados</div>
                <div className="value">
                  {ensayos.filter((e) => e.estado === 'completado').length}
                </div>
              </div>
              <div className="kpi">
                <div className="label">CUMPLEN</div>
                <div className="value ok-text">
                  {ensayos.filter((e) => e.veredicto === 'CUMPLE').length}
                </div>
              </div>
              <div className="kpi">
                <div className="label">NO CUMPLEN</div>
                <div className="value danger-text">
                  {ensayos.filter((e) => e.veredicto === 'NO CUMPLE').length}
                </div>
              </div>
            </div>

            {/* Botones nuevo ensayo */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              {Object.entries(TIPOS).map(([tipo, meta]) => (
                <button key={tipo} className="btn btn-primary" onClick={() => setCreating(tipo)}>
                  <Ic.Plus /> {meta.label}
                </button>
              ))}
            </div>

            {/* Lista de informes */}
            {ensayos.length === 0 ? (
              <div className="empty">
                Aún no hay informes. Crea el primero con los botones de arriba.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {ensayos.map((e) => (
                  <EnsayoCard
                    key={e.id}
                    ensayo={e}
                    onEdit={() => setEditing(e)}
                    onDelete={async () => {
                      if (!confirm('¿Eliminar este informe?')) return
                      try {
                        await api.deleteEnsayo(e.id)
                        await loadEnsayos(obraId)
                        setLastPath(null)
                        setMsg('Informe eliminado.')
                      } catch (err) {
                        setMsg(`Error al eliminar: ${errorMessage(err)}`)
                      }
                    }}
                    onExportWord={
                      WORD_TIPOS.has(e.tipo)
                        ? async () => {
                            setMsg(null)
                            setLastPath(null)
                            try {
                              const path = await api.exportEnsayoWord(e.id)
                              if (path) {
                                setLastPath(path)
                                setMsg(`Guardado: ${path}`)
                              }
                            } catch (err) {
                              setMsg(`Error al exportar: ${errorMessage(err)}`)
                            }
                          }
                        : undefined
                    }
                    onExportExcel={
                      EXCEL_TIPOS.has(e.tipo)
                        ? async () => {
                            setMsg(null)
                            setLastPath(null)
                            try {
                              const path = await api.exportEnsayoExcel(e.id)
                              if (path) {
                                setLastPath(path)
                                setMsg(`Guardado: ${path}`)
                              }
                            } catch (err) {
                              setMsg(`Error al exportar: ${errorMessage(err)}`)
                            }
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            )}
          </>
        )}

        {!obraId && <div className="empty">Selecciona un proyecto para ver sus ensayos.</div>}
      </div>
    )
  }

  // ── Vista: editor de informe ──────────────────────────────────────────────

  const tipo = editing?.tipo ?? creating!
  const datosinit: Record<string, unknown> = editing
    ? (editing.datos as Record<string, unknown>)
    : tipo === 'densidad_in_situ'
      ? defaultDensidadDatos()
      : tipo === 'albaran_ensayos'
        ? defaultAlbaranDatos()
        : tipo === 'granulometria'
          ? defaultGranulometriaDatos()
          : defaultPlacaDatos()

  return (
    <EnsayoEditor
      tipo={tipo}
      datosInit={datosinit}
      tituloInit={editing?.titulo ?? ''}
      responsableInit={editing?.responsable ?? ''}
      estadoInit={editing?.estado ?? 'borrador'}
      onSave={async (input) => {
        if (editing) {
          await api.updateEnsayo(editing.id, input)
        } else {
          await api.saveEnsayo(obraId!, input)
        }
        setEditing(null)
        setCreating(null)
        await loadEnsayos(obraId!)
        setMsg(editing ? 'Informe actualizado.' : 'Informe guardado.')
      }}
      onCancel={() => {
        setEditing(null)
        setCreating(null)
      }}
    />
  )
}

// ── Tarjeta de informe en la lista ────────────────────────────────────────────

function EnsayoCard({
  ensayo,
  onEdit,
  onDelete,
  onExportWord,
  onExportExcel
}: {
  ensayo: Ensayo
  onEdit: () => void
  onDelete: () => void
  onExportWord?: () => Promise<void>
  onExportExcel?: () => Promise<void>
}): JSX.Element {
  const meta = TIPOS[ensayo.tipo]
  const [running, setRunning] = useState<'word' | 'excel' | null>(null)

  const run = (kind: 'word' | 'excel', fn: () => Promise<void>) => async (): Promise<void> => {
    setRunning(kind)
    try {
      await fn()
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="ens-card">
      <div className="ens-card-left">
        <div className="ens-tipo">{meta?.label ?? ensayo.tipo}</div>
        <div className="ens-titulo">{ensayo.titulo || '—'}</div>
        <div className="ens-meta">
          <span className={`badge badge-${ensayo.estado}`}>{ensayo.estado}</span>
          {ensayo.veredicto && (
            <span className={verdictClass(ensayo.veredicto)}>{ensayo.veredicto}</span>
          )}
          <span style={{ color: 'var(--text-soft)', fontSize: 12 }}>
            {ensayo.created_at?.slice(0, 10)}
          </span>
        </div>
      </div>
      <div className="ens-card-actions">
        <button className="btn" onClick={onEdit} disabled={running !== null}>
          <Ic.Edit /> Editar
        </button>
        {onExportWord && (
          <button
            className="btn btn-navy"
            onClick={run('word', onExportWord)}
            disabled={running !== null}
          >
            <Ic.Download /> {running === 'word' ? 'Generando…' : 'Word'}
          </button>
        )}
        {onExportExcel && (
          <button
            className="btn btn-navy"
            onClick={run('excel', onExportExcel)}
            disabled={running !== null}
          >
            <Ic.Download /> {running === 'excel' ? 'Generando…' : 'Excel'}
          </button>
        )}
        <button className="btn btn-danger" onClick={onDelete} disabled={running !== null}>
          <Ic.Trash />
        </button>
      </div>
    </div>
  )
}

// ── Editor de informe ─────────────────────────────────────────────────────────

function EnsayoEditor({
  tipo,
  datosInit,
  tituloInit,
  responsableInit,
  estadoInit,
  onSave,
  onCancel
}: {
  tipo: string
  datosInit: Record<string, unknown>
  tituloInit: string
  responsableInit: string
  estadoInit: 'borrador' | 'completado'
  onSave: (input: EnsayoInput) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const [datos, setDatos] = useState<Record<string, unknown>>(datosInit)
  const [titulo, setTitulo] = useState(tituloInit)
  const [responsable, setResponsable] = useState(responsableInit)
  const [estado, setEstado] = useState<'borrador' | 'completado'>(estadoInit)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [scanBanner, setScanBanner] = useState<string | null>(null)

  const meta = TIPOS[tipo]
  const veredicto = computeVeredictoLocal(tipo, datos)

  const handleScanResult = useCallback(
    (ocr: Record<string, unknown>) => {
      setDatos((prev) => applyOcrResult(tipo, prev, ocr))
      setScanBanner('Datos extraídos del formulario. Revisa y corrige antes de guardar.')
    },
    [tipo]
  )

  async function handleSave(): Promise<void> {
    setBusy(true)
    setSaveError(null)
    try {
      await onSave({ tipo, titulo, responsable, estado, veredicto, datos })
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-ghost" onClick={onCancel} style={{ marginBottom: 10 }}>
            ← Volver
          </button>
          <h1>{meta?.label ?? tipo}</h1>
          <p style={{ color: 'var(--text-soft)', fontSize: 13 }}>{meta?.norma}</p>
        </div>
        {veredicto && (
          <span className={verdictClass(veredicto)} style={{ fontSize: 18, padding: '8px 22px' }}>
            {veredicto}
          </span>
        )}
      </div>

      {/* Metadatos */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Localización / título del informe</label>
            <input
              className="input"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="PK 0+100 · Lote 1"
            />
          </div>
          <div className="field-group">
            <label className="field-label">Responsable (firma)</label>
            <input
              className="input"
              value={responsable}
              onChange={(e) => setResponsable(e.target.value)}
              placeholder="Nombre del técnico"
            />
          </div>
          <div className="field-group" style={{ maxWidth: 160 }}>
            <label className="field-label">Estado</label>
            <select
              className="select"
              value={estado}
              onChange={(e) => setEstado(e.target.value as 'borrador' | 'completado')}
            >
              <option value="borrador">Borrador</option>
              <option value="completado">Completado</option>
            </select>
          </div>
        </div>
      </div>

      {saveError && <div className="banner banner-error">⚠ {saveError}</div>}
      {scanBanner && (
        <div className="banner banner-ok" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>✓ {scanBanner}</span>
          <button
            className="btn btn-ghost"
            style={{ padding: '2px 8px', fontSize: 12 }}
            onClick={() => setScanBanner(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Panel de escaneo de formularios con IA */}
      <ScanPanel tipo={tipo} onResult={handleScanResult} />

      {/* Formulario específico */}
      {tipo === 'densidad_in_situ' && <DensidadForm datos={datos} onChange={setDatos} />}
      {tipo === 'placa_carga' && <PlacaForm datos={datos} onChange={setDatos} />}
      {tipo === 'granulometria' && <GranulometriaForm datos={datos} onChange={setDatos} />}
      {tipo === 'albaran_ensayos' && <AlbaranForm datos={datos} onChange={setDatos} />}

      <div className="toolbar" style={{ marginTop: 20 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? (
            'Guardando…'
          ) : (
            <>
              <Ic.Save /> Guardar informe
            </>
          )}
        </button>
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ── Merge de resultado OCR en datos del formulario ────────────────────────────

function applyOcrResult(
  tipo: string,
  current: Record<string, unknown>,
  ocr: Record<string, unknown>
): Record<string, unknown> {
  if (tipo === 'densidad_in_situ') {
    type DensRow = { referencia?: string | null; d_max?: string | null; h_opt?: string | null; d_situ?: string | null; h_situ?: string | null; observaciones?: string | null }
    const ocrCab = (ocr.cabecera as Record<string, string | null>) ?? {}
    const ocrRows = (ocr.ensayos as DensRow[]) ?? []
    const cab = (current.cabecera as Record<string, string>) ?? {}
    const newCab = { ...cab }
    for (const [k, v] of Object.entries(ocrCab)) {
      if (v !== null && v !== '') newCab[k] = v as string
    }
    const validRows = ocrRows.filter(
      (r) => r.d_situ !== null || r.h_situ !== null || r.referencia !== null || r.d_max !== null
    )
    const newRows =
      validRows.length > 0
        ? validRows.map((r, i) => ({
            n: i + 1,
            referencia: r.referencia ?? '',
            d_max: r.d_max ?? '',
            h_opt: r.h_opt ?? '',
            d_situ: r.d_situ ?? '',
            h_situ: r.h_situ ?? '',
            observaciones: r.observaciones ?? ''
          }))
        : current.ensayos
    return { ...current, cabecera: newCab, ensayos: newRows }
  }

  if (tipo === 'albaran_ensayos') {
    const merged: Record<string, unknown> = { ...current }
    for (const [k, v] of Object.entries(ocr)) {
      if (v !== null && v !== undefined && v !== '') merged[k] = v
    }
    return merged
  }

  if (tipo === 'granulometria') {
    type GranuOcr = { cabecera?: Record<string, string | null>; masas?: (string | null)[] }
    const granu = ocr as GranuOcr
    const cab = (current.cabecera as Record<string, string>) ?? {}
    const newCab = { ...cab }
    for (const [k, v] of Object.entries(granu.cabecera ?? {})) {
      if (v !== null && v !== '') newCab[k] = v as string
    }
    const masas = (granu.masas ?? []).filter((m): m is string => m !== null && m !== '')
    return {
      ...current,
      cabecera: newCab,
      ...(masas.length > 0 ? { masas } : {})
    }
  }

  if (tipo === 'placa_carga') {
    const PRES_C1 = [0.0, 0.07, 0.15, 0.21, 0.28, 0.35, 0.42, 0.5]
    const PRES_D = [0.25, 0.125, 0.0]
    const PRES_C2 = [0.07, 0.15, 0.21, 0.28, 0.35, 0.42]
    type PlacaRow = { l1?: string | null; l2?: string | null; l3?: string | null }
    const inj = (rows: PlacaRow[], pres: number[]): Record<string, unknown>[] =>
      pres.map((p, i) => ({ presion: p, l1: rows[i]?.l1 ?? '', l2: rows[i]?.l2 ?? '', l3: rows[i]?.l3 ?? '' }))
    const ocrCab = (ocr.cabecera as Record<string, string | null>) ?? {}
    const cab = (current.cabecera as Record<string, string>) ?? {}
    const newCab = { ...cab }
    for (const [k, v] of Object.entries(ocrCab)) {
      if (v !== null && v !== '') newCab[k] = v as string
    }
    return {
      ...current,
      cabecera: newCab,
      ciclo1: inj((ocr.ciclo1 as PlacaRow[]) ?? [], PRES_C1),
      descarga: inj((ocr.descarga as PlacaRow[]) ?? [], PRES_D),
      ciclo2: inj((ocr.ciclo2 as PlacaRow[]) ?? [], PRES_C2)
    }
  }

  return current
}

// ── Cálculo de veredicto en el renderer (sin IPC) ─────────────────────────────
// Delega en ensayoCalc.ts (espejo fiel del backend) para mostrar el veredicto en
// tiempo real mientras se rellena el formulario, con los mismos redondeos.

function computeVeredictoLocal(tipo: string, datos: Record<string, unknown>): string {
  try {
    if (tipo === 'densidad_in_situ') return densidadSummary(datos)?.veredicto ?? ''
    if (tipo === 'placa_carga') return placaSummary(datos).veredicto
    if (tipo === 'granulometria') return granulometriaSummary(datos).veredicto
  } catch {
    /* silent */
  }
  return ''
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIO DENSIDAD IN SITU
// ══════════════════════════════════════════════════════════════════════════════

function DensidadForm({
  datos,
  onChange
}: {
  datos: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
}): JSX.Element {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const ensayos = (datos.ensayos as Record<string, unknown>[]) ?? []
  const compMin = (datos.compactacion_min as number) ?? 100
  const cond3 = (datos.cond3_cumple as boolean | null) ?? null

  const nFilas = ensayos.length

  function setCab(key: string, val: string): void {
    onChange({ ...datos, cabecera: { ...cab, [key]: val } })
  }

  function setNFilas(n: number): void {
    const newRows = Array.from({ length: n }, (_, i) => ensayos[i] ?? { n: i + 1 })
    onChange({ ...datos, ensayos: newRows })
  }

  function setEnsayo(i: number, key: string, val: string): void {
    const newEns = ensayos.map((r, idx) => (idx === i ? { ...r, [key]: val } : r))
    onChange({ ...datos, ensayos: newEns })
  }

  return (
    <div>
      {/* Cabecera */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Datos del lote</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Orden de trabajo</label>
            <input
              className="input"
              value={cab.orden_trabajo ?? ''}
              onChange={(e) => setCab('orden_trabajo', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Capa</label>
            <input
              className="input"
              value={cab.capa ?? ''}
              onChange={(e) => setCab('capa', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Nº Lote</label>
            <input
              className="input"
              value={cab.n_lote ?? ''}
              onChange={(e) => setCab('n_lote', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Localización (PK)</label>
            <input
              className="input"
              value={cab.localizacion ?? ''}
              onChange={(e) => setCab('localizacion', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha ensayo</label>
            <input
              className="input"
              value={cab.fecha_ensayo ?? ''}
              onChange={(e) => setCab('fecha_ensayo', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
        </div>
      </div>

      {/* Rejilla de medidas */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
          <div className="sec-label" style={{ marginBottom: 0 }}>
            Medidas
          </div>
          <label className="field-label" style={{ marginBottom: 0 }}>
            Filas:
          </label>
          <input
            type="number"
            min={1}
            max={40}
            className="input"
            style={{ width: 70 }}
            value={nFilas}
            onChange={(e) => setNFilas(Math.max(1, Math.min(40, parseInt(e.target.value) || 1)))}
          />
          <label className="field-label" style={{ marginBottom: 0 }}>
            % Compactación mín.:
          </label>
          <input
            type="number"
            step={0.5}
            className="input"
            style={{ width: 80 }}
            value={compMin}
            onChange={(e) =>
              onChange({ ...datos, compactacion_min: parseFloat(e.target.value) || 100 })
            }
          />
        </div>

        <div className="dens-grid">
          {/* Cabecera nivel 1 */}
          <div className="dens-th dens-th-n">Nº</div>
          <div className="dens-th dens-th-ref">Referencia</div>
          <div className="dens-grp-hdr lab" style={{ gridColumn: 'span 2' }}>
            🔬 LABORATORIO (Proctor)
          </div>
          <div className="dens-grp-hdr obra" style={{ gridColumn: 'span 2' }}>
            🏗️ OBRA (equipo radiactivo)
          </div>
          <div className="dens-th dens-th-comp">% Compact.</div>
          <div className="dens-th dens-th-obs">Observaciones</div>

          {/* Cabecera nivel 2 */}
          <div className="dens-sub-hdr">Nº</div>
          <div className="dens-sub-hdr">Referencia</div>
          <div className="dens-sub-hdr">D.máx (g/cm³)</div>
          <div className="dens-sub-hdr">H.ópt (%)</div>
          <div className="dens-sub-hdr">D.in situ (g/cm³)</div>
          <div className="dens-sub-hdr">H.in situ (%)</div>
          <div className="dens-sub-hdr">% Compac.</div>
          <div className="dens-sub-hdr">Obs.</div>

          {/* Filas de datos */}
          {ensayos.map((row, i) => {
            const dm = parseFloat(String(row.d_max ?? '').replace(',', '.'))
            const ds = parseFloat(String(row.d_situ ?? '').replace(',', '.'))
            const comp = dm > 0 && ds > 0 ? ((ds / dm) * 100).toFixed(1) : null
            const compOk = comp !== null ? parseFloat(comp) >= compMin : null
            return (
              <Fragment key={`row-${i}`}>
                <div className="dens-cell-n">{i + 1}</div>
                <input
                  key={`ref-${i}`}
                  className="dens-input"
                  value={String(row.referencia ?? '')}
                  onChange={(e) => setEnsayo(i, 'referencia', e.target.value)}
                />
                <input
                  key={`dm-${i}`}
                  className="dens-input"
                  inputMode="decimal"
                  value={String(row.d_max ?? '')}
                  onChange={(e) => setEnsayo(i, 'd_max', e.target.value)}
                  placeholder="0,000"
                />
                <input
                  key={`ho-${i}`}
                  className="dens-input"
                  inputMode="decimal"
                  value={String(row.h_opt ?? '')}
                  onChange={(e) => setEnsayo(i, 'h_opt', e.target.value)}
                  placeholder="0,0"
                />
                <input
                  key={`ds-${i}`}
                  className="dens-input"
                  inputMode="decimal"
                  value={String(row.d_situ ?? '')}
                  onChange={(e) => setEnsayo(i, 'd_situ', e.target.value)}
                  placeholder="0,000"
                />
                <input
                  key={`hs-${i}`}
                  className="dens-input"
                  inputMode="decimal"
                  value={String(row.h_situ ?? '')}
                  onChange={(e) => setEnsayo(i, 'h_situ', e.target.value)}
                  placeholder="0,0"
                />
                <div
                  key={`co-${i}`}
                  className={`dens-comp ${compOk === true ? 'ok' : compOk === false ? 'no' : ''}`}
                >
                  {comp !== null ? `${comp} %` : '—'}
                </div>
                <input
                  key={`ob-${i}`}
                  className="dens-input"
                  value={String(row.observaciones ?? '')}
                  onChange={(e) => setEnsayo(i, 'observaciones', e.target.value)}
                />
              </Fragment>
            )
          })}
        </div>
      </div>

      {/* Resumen de condiciones */}
      <DensidadResumen
        datos={datos}
        compMin={compMin}
        cond3={cond3}
        onCond3={(v) => onChange({ ...datos, cond3_cumple: v })}
      />
    </div>
  )
}

function DensidadResumen({
  datos,
  compMin,
  cond3,
  onCond3
}: {
  datos: Record<string, unknown>
  compMin: number
  cond3: boolean | null
  onCond3: (v: boolean | null) => void
}): JSX.Element {
  const summary = densidadSummary(datos)
  if (!summary) return <></>
  const { mediaComp, dMinAdm, dSituMin, cond1, cond2 } = summary

  return (
    <div className="card">
      <div className="sec-label">Condiciones de cumplimiento</div>
      <table className="cond-table">
        <tbody>
          <tr className={cond1 ? 'cond-ok' : 'cond-no'}>
            <td>Condición 1 — % Compactación media del lote ({mediaComp.toFixed(1)} %)</td>
            <td>≥ {compMin.toFixed(0)} %</td>
            <td className="cond-verdict">{cond1 ? '✓ CUMPLE' : '✗ NO CUMPLE'}</td>
          </tr>
          <tr className={cond2 ? 'cond-ok' : 'cond-no'}>
            <td>Condición 2 — Densidad mín. del lote ({dSituMin.toFixed(3)} g/cm³)</td>
            <td>≥ {dMinAdm.toFixed(3)} g/cm³</td>
            <td className="cond-verdict">{cond2 ? '✓ CUMPLE' : '✗ NO CUMPLE'}</td>
          </tr>
          <tr className={cond3 === true ? 'cond-ok' : cond3 === false ? 'cond-no' : ''}>
            <td>Condición 3 — 60 % de puntos en zona de isosaturación (gráfica)</td>
            <td>Art. 330.6.5.4 PG-3</td>
            <td>
              <select
                className="select"
                style={{ fontSize: 12, padding: '3px 8px' }}
                value={cond3 === true ? 'true' : cond3 === false ? 'false' : ''}
                onChange={(e) =>
                  onCond3(
                    e.target.value === 'true' ? true : e.target.value === 'false' ? false : null
                  )
                }
              >
                <option value="">— No evaluada —</option>
                <option value="true">✓ CUMPLE</option>
                <option value="false">✗ NO CUMPLE</option>
              </select>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIO PLACA DE CARGA
// ══════════════════════════════════════════════════════════════════════════════

/** Tabla de un ciclo de placa de carga (a nivel de módulo: no se recrea en cada render). */
function PlacaTable({
  filas,
  section,
  title,
  setFila,
  amCalc
}: {
  filas: Record<string, unknown>[]
  section: 'ciclo1' | 'descarga' | 'ciclo2'
  title: string
  setFila: (section: 'ciclo1' | 'descarga' | 'ciclo2', i: number, key: string, val: string) => void
  amCalc: (r: Record<string, unknown>) => string
}): JSX.Element {
  return (
    <div style={{ marginBottom: 16 }}>
      <div className="sec-label">{title}</div>
      <table className="placa-table">
        <thead>
          <tr>
            <th>Presión (MPa)</th>
            <th>Lect. 1 (mm)</th>
            <th>Lect. 2 (mm)</th>
            <th>Lect. 3 (mm)</th>
            <th>Asiento medio</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((r, i) => (
            <tr key={i}>
              <td className="placa-presion">{fmt(r.presion, 2)}</td>
              <td>
                <input
                  className="placa-input"
                  inputMode="decimal"
                  value={String(r.l1 ?? '')}
                  onChange={(e) => setFila(section, i, 'l1', e.target.value)}
                />
              </td>
              <td>
                <input
                  className="placa-input"
                  inputMode="decimal"
                  value={String(r.l2 ?? '')}
                  onChange={(e) => setFila(section, i, 'l2', e.target.value)}
                />
              </td>
              <td>
                <input
                  className="placa-input"
                  inputMode="decimal"
                  value={String(r.l3 ?? '')}
                  onChange={(e) => setFila(section, i, 'l3', e.target.value)}
                />
              </td>
              <td className="placa-am">{amCalc(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlacaForm({
  datos,
  onChange
}: {
  datos: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
}): JSX.Element {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const ciclo1 = (datos.ciclo1 as Record<string, unknown>[]) ?? []
  const descarga = (datos.descarga as Record<string, unknown>[]) ?? []
  const ciclo2 = (datos.ciclo2 as Record<string, unknown>[]) ?? []
  const ratioMax = (datos.ratio_max as number) ?? 2.2

  function setCab(key: string, val: string): void {
    onChange({ ...datos, cabecera: { ...cab, [key]: val } })
  }

  function setFila(
    section: 'ciclo1' | 'descarga' | 'ciclo2',
    i: number,
    key: string,
    val: string
  ): void {
    const arr = (datos[section] as Record<string, unknown>[]).map((r, idx) =>
      idx === i ? { ...r, [key]: val } : r
    )
    onChange({ ...datos, [section]: arr })
  }

  // Asiento medio por fila (solo presentación; el cálculo de Ev vive en ensayoCalc).
  const amCalc = (r: Record<string, unknown>): string => {
    const v = asientoMedio(r)
    return v !== null ? v.toFixed(2).replace('.', ',') : '—'
  }

  // Módulos y veredicto en vivo — misma fuente y redondeos que el informe.
  const summary = placaSummary(datos)
  const ev1str = summary.ev1 !== null ? String(summary.ev1) : '—'
  const ev2str = summary.ev2 !== null ? String(summary.ev2) : '—'
  const ratio = summary.ratio
  const ratioOk = summary.cumple

  return (
    <div>
      {/* Cabecera */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Datos del ensayo</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Orden de trabajo</label>
            <input
              className="input"
              value={cab.orden_trabajo ?? ''}
              onChange={(e) => setCab('orden_trabajo', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">P.K.</label>
            <input
              className="input"
              value={cab.pk ?? ''}
              onChange={(e) => setCab('pk', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Capa</label>
            <input
              className="input"
              value={cab.capa ?? ''}
              onChange={(e) => setCab('capa', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha ensayo</label>
            <input
              className="input"
              value={cab.fecha_ensayo ?? ''}
              onChange={(e) => setCab('fecha_ensayo', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
          <div className="field-group" style={{ maxWidth: 120 }}>
            <label className="field-label">Ø placa (mm)</label>
            <input
              className="input"
              value={cab.diam_placa ?? '300'}
              onChange={(e) =>
                onChange({
                  ...datos,
                  cabecera: { ...cab, diam_placa: e.target.value },
                  radio_mm: parseFloat(e.target.value.replace(',', '.')) / 2 || 150
                })
              }
            />
          </div>
          <div className="field-group" style={{ maxWidth: 120 }}>
            <label className="field-label">Ratio máx (Ev2/Ev1)</label>
            <input
              type="number"
              step={0.1}
              className="input"
              value={ratioMax}
              onChange={(e) => onChange({ ...datos, ratio_max: parseFloat(e.target.value) || 2.2 })}
            />
          </div>
        </div>
      </div>

      {/* Tablas ciclo */}
      <div className="card" style={{ marginBottom: 14 }}>
        <PlacaTable
          filas={ciclo1}
          section="ciclo1"
          title="1º Ciclo de carga"
          setFila={setFila}
          amCalc={amCalc}
        />
        {descarga.length > 0 && (
          <PlacaTable
            filas={descarga}
            section="descarga"
            title="Descarga"
            setFila={setFila}
            amCalc={amCalc}
          />
        )}
        <PlacaTable
          filas={ciclo2}
          section="ciclo2"
          title="2º Ciclo de carga"
          setFila={setFila}
          amCalc={amCalc}
        />
      </div>

      {/* Resultados */}
      <div className="card">
        <div className="sec-label">Módulos de compresibilidad</div>
        <table className="cond-table">
          <tbody>
            <tr>
              <td>Ev1 (MPa) — módulo 1er ciclo</td>
              <td colSpan={2} style={{ fontWeight: 700 }}>
                {ev1str}
              </td>
            </tr>
            <tr>
              <td>Ev2 (MPa) — módulo 2º ciclo</td>
              <td colSpan={2} style={{ fontWeight: 700 }}>
                {ev2str}
              </td>
            </tr>
            <tr className={ratioOk === true ? 'cond-ok' : ratioOk === false ? 'cond-no' : ''}>
              <td>Ev2/Ev1 (≤ {ratioMax.toFixed(1)})</td>
              <td>{ratio !== null ? ratio.toFixed(1).replace('.', ',') : '—'}</td>
              <td className="cond-verdict">
                {ratioOk === true ? '✓ CUMPLE' : ratioOk === false ? '✗ NO CUMPLE' : '—'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIO GRANULOMETRÍA DE ESCOLLERA (UNE EN 13383-2, clase 5-40 kg)
// ══════════════════════════════════════════════════════════════════════════════

function GranulometriaForm({
  datos,
  onChange
}: {
  datos: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
}): JSX.Element {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const setCab = (key: string, val: string): void =>
    onChange({ ...datos, cabecera: { ...cab, [key]: val } })
  const set = (key: string, val: unknown): void => onChange({ ...datos, [key]: val })

  const s = granulometriaSummary(datos)
  const sp = GRANULO_SPEC
  const masasOk = parseMasas(datos.masas)

  // Lista de masas como array de filas (admite datos antiguos guardados como texto).
  const masasArr: string[] = Array.isArray(datos.masas)
    ? (datos.masas as unknown[]).map((m) => String(m ?? ''))
    : String(datos.masas ?? '')
        .split(/[\n,;]+/)
        .map((x) => x.trim())
  const setMasa = (i: number, val: string): void => {
    const next = masasArr.slice()
    next[i] = val
    set('masas', next)
  }
  const setNFilas = (n: number): void => {
    const next = Array.from({ length: n }, (_, i) => masasArr[i] ?? '')
    set('masas', next)
  }

  const rangeRow = (
    label: string,
    val: number,
    [lo, hi]: readonly number[],
    dec = 0
  ): JSX.Element => {
    const ok = val >= lo && val <= hi
    return (
      <tr className={s.n ? (ok ? 'cond-ok' : 'cond-no') : ''}>
        <td>{label}</td>
        <td>{val.toFixed(dec)} %</td>
        <td>
          {lo}–{hi} %
        </td>
        <td className="cond-verdict">{s.n ? (ok ? '✓' : '✗') : '—'}</td>
      </tr>
    )
  }

  return (
    <div>
      {/* Cabecera */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Datos de la muestra</div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Material</label>
            <input
              className="input"
              value={cab.material ?? ''}
              onChange={(e) => setCab('material', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Ref. muestra</label>
            <input
              className="input"
              value={cab.muestra ?? ''}
              onChange={(e) => setCab('muestra', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Localización muestra</label>
            <input
              className="input"
              value={cab.localizacion ?? ''}
              onChange={(e) => setCab('localizacion', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha muestreo</label>
            <input
              className="input"
              value={cab.fecha_muestreo ?? ''}
              onChange={(e) => setCab('fecha_muestreo', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha ensayo</label>
            <input
              className="input"
              value={cab.fecha_ensayo ?? ''}
              onChange={(e) => setCab('fecha_ensayo', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
        </div>
      </div>

      {/* Masas — lista numerada (como el registro en papel), ampliable */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            marginBottom: 12,
            flexWrap: 'wrap'
          }}
        >
          <div className="sec-label" style={{ marginBottom: 0 }}>
            Masas de las piedras (kg)
          </div>
          <span className="badge badge-activa">{masasOk.length} piedras con dato</span>
          <div style={{ flex: 1 }} />
          <label className="field-label" style={{ marginBottom: 0 }}>
            Filas:
          </label>
          <input
            type="number"
            min={1}
            max={GRANULO_FILAS_MAX}
            className="input"
            style={{ width: 80 }}
            value={masasArr.length}
            onChange={(e) =>
              setNFilas(Math.max(1, Math.min(GRANULO_FILAS_MAX, parseInt(e.target.value) || 1)))
            }
          />
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => setNFilas(Math.min(GRANULO_FILAS_MAX, masasArr.length + 10))}
          >
            <Ic.Plus /> 10 filas
          </button>
        </div>
        <div className="granulo-grid">
          {masasArr.map((m, i) => (
            <div className="granulo-cell" key={i}>
              <span className="granulo-n">{i + 1}</span>
              <input
                className="granulo-input"
                inputMode="decimal"
                value={String(m ?? '')}
                onChange={(e) => setMasa(i, e.target.value)}
                placeholder="kg"
              />
            </div>
          ))}
        </div>
        <div className="field-row" style={{ marginTop: 14 }}>
          <div className="field-group" style={{ maxWidth: 240 }}>
            <label className="field-label">Masa fragmentos &lt; 1,5 kg (kg)</label>
            <input
              className="input"
              inputMode="decimal"
              value={String(datos.fragmentos_masa ?? '')}
              onChange={(e) => set('fragmentos_masa', e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
      </div>

      {/* Resumen manual */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Resumen manual del laboratorio</div>
        <div className="field-row">
          <div className="field-group" style={{ maxWidth: 180 }}>
            <label className="field-label">M50 (kg)</label>
            <input
              className="input"
              inputMode="decimal"
              value={String(datos.m50 ?? '')}
              onChange={(e) => set('m50', e.target.value)}
            />
          </div>
          <div className="field-group" style={{ maxWidth: 180 }}>
            <label className="field-label">% LT (L/E &gt; 3)</label>
            <input
              className="input"
              inputMode="decimal"
              value={String(datos.lt_pct ?? '')}
              onChange={(e) => set('lt_pct', e.target.value)}
            />
          </div>
          <div className="field-group" style={{ maxWidth: 220 }}>
            <label className="field-label">Nº piedras con L &gt; 45 cm</label>
            <input
              className="input"
              inputMode="numeric"
              value={String(datos.particulas_45 ?? '')}
              onChange={(e) => set('particulas_45', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Resultados / cumplimiento */}
      <div className="card">
        <div className="sec-label">
          Distribución de masas y cumplimiento (clase 5-40 kg) — {s.n} piedras, {s.masaTotal} kg
        </div>
        <table className="cond-table">
          <tbody>
            {rangeRow('ELL — % < 1,5 kg', s.ell, sp.ell)}
            {rangeRow('NLL — % < 5 kg', s.nll, sp.nll)}
            {rangeRow('NUL — % < 40 kg', s.nul, sp.nul)}
            {rangeRow('EUL — % < 80 kg', s.eul, sp.eul)}
            <tr
              className={
                s.n ? (s.mem >= sp.mem[0] && s.mem <= sp.mem[1] ? 'cond-ok' : 'cond-no') : ''
              }
            >
              <td>MEM — masa media (kg)</td>
              <td>{s.mem.toFixed(1)} kg</td>
              <td>
                {sp.mem[0]}–{sp.mem[1]} kg
              </td>
              <td className="cond-verdict">
                {s.n ? (s.mem >= sp.mem[0] && s.mem <= sp.mem[1] ? '✓' : '✗') : '—'}
              </td>
            </tr>
            {s.ltPct !== null && (
              <tr className={s.ltPct <= sp.lt_max ? 'cond-ok' : 'cond-no'}>
                <td>LT — L/E &gt; 3</td>
                <td>{s.ltPct.toFixed(0)} %</td>
                <td>≤ {sp.lt_max} %</td>
                <td className="cond-verdict">{s.ltPct <= sp.lt_max ? '✓' : '✗'}</td>
              </tr>
            )}
            {s.p45Pct !== null && (
              <tr className={s.p45Pct <= sp.p45_max ? 'cond-ok' : 'cond-no'}>
                <td>Partículas con L &gt; 45 cm</td>
                <td>{s.p45Pct.toFixed(0)} %</td>
                <td>≤ {sp.p45_max} %</td>
                <td className="cond-verdict">{s.p45Pct <= sp.p45_max ? '✓' : '✗'}</td>
              </tr>
            )}
            {s.m50 !== null && (
              <tr>
                <td>M50 — masa al 50 %</td>
                <td>{s.m50.toFixed(1)} kg</td>
                <td>—</td>
                <td className="cond-verdict">—</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIO ALBARÁN (SOLICITUD, TOMA DE MUESTRA Y REGISTRO DE ENSAYO)
// ══════════════════════════════════════════════════════════════════════════════

function AlbaranForm({
  datos,
  onChange
}: {
  datos: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
}): JSX.Element {
  function set(key: string, val: unknown): void {
    onChange({ ...datos, [key]: val })
  }

  const ensayosSolicitados =
    (datos.ensayos_solicitados as { ensayo: string; normativa: string }[]) ?? []

  function setEnsayoSol(i: number, key: 'ensayo' | 'normativa', val: string): void {
    const updated = ensayosSolicitados.map((r, idx) => (idx === i ? { ...r, [key]: val } : r))
    set('ensayos_solicitados', updated)
  }

  return (
    <div className="albaran-wrap">
      {/* ── Cabecera del documento ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="alb-header-row">
          <div className="alb-logo-block">
            <div className="alb-logo-text">CYE</div>
            <div className="alb-logo-sub">CONTROL Y ESTUDIOS</div>
            <div className="alb-doc-title">
              SOLICITUD, TOMA DE MUESTRA Y<br />
              REGISTRO DE ENSAYO
            </div>
          </div>
          <div className="alb-header-fields">
            <div className="alb-header-field">
              <span className="alb-hf-label">Nº de ensayo (O.T.)</span>
              <input
                className="input alb-hf-input"
                value={String(datos.n_ensayo_ot ?? '')}
                onChange={(e) => set('n_ensayo_ot', e.target.value)}
              />
            </div>
            <div className="alb-header-field">
              <span className="alb-hf-label">Fecha de toma</span>
              <input
                className="input alb-hf-input"
                value={String(datos.fecha_toma ?? '')}
                onChange={(e) => set('fecha_toma', e.target.value)}
                placeholder="dd-mm-aaaa"
              />
            </div>
            <div className="alb-header-field">
              <span className="alb-hf-label">Fecha de entrada</span>
              <input
                className="input alb-hf-input"
                value={String(datos.fecha_entrada ?? '')}
                onChange={(e) => set('fecha_entrada', e.target.value)}
                placeholder="dd-mm-aaaa"
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Datos de la obra ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Datos de la obra</div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Título</label>
            <input
              className="input"
              value={String(datos.titulo_obra ?? '')}
              onChange={(e) => set('titulo_obra', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Ref. Obra</label>
            <input
              className="input"
              value={String(datos.ref_obra ?? '')}
              onChange={(e) => set('ref_obra', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* ── Datos del cliente ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="alb-two-col">
          <div>
            <div className="sec-label">Datos del cliente</div>
            <div className="alb-field-stack">
              <div className="alb-inline-field">
                <span className="alb-inline-label">Empresa:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.empresa ?? '')}
                  onChange={(e) => set('empresa', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Dirección:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.direccion ?? '')}
                  onChange={(e) => set('direccion', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">N.I.F. / C.I.F.:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.nif_cif ?? '')}
                  onChange={(e) => set('nif_cif', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Persona de contacto:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.persona_contacto ?? '')}
                  onChange={(e) => set('persona_contacto', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Teléfono / Fax:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.telefono_fax ?? '')}
                  onChange={(e) => set('telefono_fax', e.target.value)}
                />
              </div>
            </div>
            <div className="alb-inline-field" style={{ marginTop: 8 }}>
              <span className="alb-inline-label">Observaciones:</span>
              <input
                className="input alb-inline-input"
                value={String(datos.observaciones_cliente ?? '')}
                onChange={(e) => set('observaciones_cliente', e.target.value)}
              />
            </div>
          </div>
          <div>
            <div className="sec-label">Peticionario</div>
            <textarea
              className="input alb-textarea"
              rows={7}
              value={String(datos.peticionario ?? '')}
              onChange={(e) => set('peticionario', e.target.value)}
              placeholder="(cumplimentar cuando sea distinto del cliente y no se conozcan los datos)"
            />
          </div>
        </div>
      </div>

      {/* ── Toma de muestra ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Toma de muestra</div>
        <div className="alb-checks-row">
          <label className="alb-check-label">
            <input
              type="checkbox"
              checked={Boolean(datos.efectuada_por_cye)}
              onChange={(e) => set('efectuada_por_cye', e.target.checked)}
            />
            Efectuada por CYE
          </label>
          <label className="alb-check-label">
            <input
              type="checkbox"
              checked={Boolean(datos.recibida_en_cye)}
              onChange={(e) => set('recibida_en_cye', e.target.checked)}
            />
            Recibida en CYE
          </label>
          <label className="alb-check-label">
            <input
              type="checkbox"
              checked={Boolean(datos.ensayo_in_situ)}
              onChange={(e) => set('ensayo_in_situ', e.target.checked)}
            />
            Ensayo in situ
          </label>
          <label className="alb-check-label">
            <input
              type="checkbox"
              checked={Boolean(datos.recogida_por_cye_en !== '')}
              onChange={(e) => {
                if (!e.target.checked) set('recogida_por_cye_en', '')
              }}
            />
            Recogida por CYE en:
          </label>
          <input
            className="input"
            style={{ flex: 1, minWidth: 120 }}
            value={String(datos.recogida_por_cye_en ?? '')}
            onChange={(e) => set('recogida_por_cye_en', e.target.value)}
          />
        </div>
      </div>

      {/* ── Tabla de muestra ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="alb-muestra-grid">
          {/* Fila 1 */}
          <div className="alb-mg-cell alb-mg-hdr">Material y descripción</div>
          <div className="alb-mg-cell alb-mg-hdr">Localización</div>
          <div className="alb-mg-cell alb-mg-hdr">Otros datos</div>

          <div className="alb-mg-cell">
            <textarea
              className="input alb-textarea-sm"
              rows={3}
              value={String(datos.material_descripcion ?? '')}
              onChange={(e) => set('material_descripcion', e.target.value)}
            />
          </div>
          <div className="alb-mg-cell">
            <textarea
              className="input alb-textarea-sm"
              rows={3}
              value={String(datos.localizacion ?? '')}
              onChange={(e) => set('localizacion', e.target.value)}
            />
          </div>
          <div className="alb-mg-cell">
            <textarea
              className="input alb-textarea-sm"
              rows={3}
              value={String(datos.otros_datos ?? '')}
              onChange={(e) => set('otros_datos', e.target.value)}
            />
          </div>

          {/* Fila 2 */}
          <div className="alb-mg-cell alb-mg-hdr">Indicaciones sobre la toma de muestra</div>
          <div className="alb-mg-cell alb-mg-hdr">Cantidad de muestra</div>
          <div className="alb-mg-cell alb-mg-hdr">Firma / receptor</div>

          <div className="alb-mg-cell">
            <textarea
              className="input alb-textarea-sm"
              rows={3}
              value={String(datos.indicaciones_toma ?? '')}
              onChange={(e) => set('indicaciones_toma', e.target.value)}
            />
          </div>
          <div className="alb-mg-cell">
            <textarea
              className="input alb-textarea-sm"
              rows={3}
              value={String(datos.cantidad_muestra ?? '')}
              onChange={(e) => set('cantidad_muestra', e.target.value)}
            />
          </div>
          <div className="alb-mg-cell alb-firma-cell">
            <label className="alb-check-label">
              <input
                type="radio"
                name="firma_tipo"
                value="analista"
                checked={datos.firma_tipo === 'analista'}
                onChange={() => set('firma_tipo', 'analista')}
              />
              Analista que toma la muestra
            </label>
            <label className="alb-check-label">
              <input
                type="radio"
                name="firma_tipo"
                value="receptor"
                checked={datos.firma_tipo === 'receptor'}
                onChange={() => set('firma_tipo', 'receptor')}
              />
              Persona que recibe / recoge la muestra
            </label>
            <div className="alb-inline-field" style={{ marginTop: 8 }}>
              <span className="alb-inline-label">Fdo.:</span>
              <input
                className="input alb-inline-input"
                value={String(datos.fdo_muestra ?? '')}
                onChange={(e) => set('fdo_muestra', e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Ensayos solicitados ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="alb-ens-grid">
          <div className="alb-mg-hdr" style={{ padding: '6px 10px', textAlign: 'center' }}>
            Ensayos solicitados
          </div>
          <div className="alb-mg-hdr" style={{ padding: '6px 10px', textAlign: 'center' }}>
            Normativa aplicable
          </div>
          {ensayosSolicitados.map((row, i) => (
            <Fragment key={i}>
              <input
                className="input alb-ens-input"
                value={row.ensayo}
                onChange={(e) => setEnsayoSol(i, 'ensayo', e.target.value)}
              />
              <input
                className="input alb-ens-input"
                value={row.normativa}
                onChange={(e) => setEnsayoSol(i, 'normativa', e.target.value)}
              />
            </Fragment>
          ))}
        </div>
      </div>

      {/* ── Condiciones de ejecución ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="sec-label">
          Condiciones de ejecución{' '}
          <span style={{ fontWeight: 400, textTransform: 'none', fontSize: 11 }}>
            (cuando sean distintas a la Norma de Ensayo)
          </span>
        </div>
        <textarea
          className="input alb-textarea"
          rows={3}
          value={String(datos.condiciones_ejecucion ?? '')}
          onChange={(e) => set('condiciones_ejecucion', e.target.value)}
        />
      </div>

      {/* ── Inspección de la muestra ── */}
      <div className="card alb-card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Inspección de la muestra</div>
        <div className="alb-insp-layout">
          <div className="alb-insp-left">
            <div className="alb-checks-row" style={{ marginBottom: 10 }}>
              {(['aceptada', 'en_espera', 'rechazada'] as const).map((v) => (
                <label key={v} className="alb-check-label">
                  <input
                    type="radio"
                    name="inspeccion"
                    value={v}
                    checked={datos.inspeccion === v}
                    onChange={() => set('inspeccion', v)}
                  />
                  {v === 'aceptada' ? 'Aceptada' : v === 'en_espera' ? 'En espera' : 'Rechazada'}
                </label>
              ))}
            </div>
            <label className="field-label">Comentarios</label>
            <textarea
              className="input alb-textarea"
              rows={3}
              value={String(datos.comentarios ?? '')}
              onChange={(e) => set('comentarios', e.target.value)}
            />
          </div>
          <div className="alb-insp-right">
            <div className="alb-acept-block">
              <div className="sec-label">Aceptación</div>
              <label className="alb-check-label">
                <input
                  type="checkbox"
                  checked={Boolean(datos.aceptacion_cliente)}
                  onChange={(e) => set('aceptacion_cliente', e.target.checked)}
                />
                El cliente
              </label>
              <label className="alb-check-label">
                <input
                  type="checkbox"
                  checked={Boolean(datos.aceptacion_peticionario)}
                  onChange={(e) => set('aceptacion_peticionario', e.target.checked)}
                />
                Peticionario
              </label>
              <div className="alb-inline-field" style={{ marginTop: 6 }}>
                <span className="alb-inline-label">Fdo.:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.fdo_cliente ?? '')}
                  onChange={(e) => set('fdo_cliente', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Fecha:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.fecha_firma_cliente ?? '')}
                  onChange={(e) => set('fecha_firma_cliente', e.target.value)}
                  placeholder="dd-mm-aaaa"
                />
              </div>
            </div>
            <div className="alb-acept-block">
              <div className="sec-label">Aceptación</div>
              <label className="alb-check-label">
                <input
                  type="checkbox"
                  checked={Boolean(datos.aceptacion_dir_tecnico)}
                  onChange={(e) => set('aceptacion_dir_tecnico', e.target.checked)}
                />
                Dir. técnico
              </label>
              <label className="alb-check-label">
                <input
                  type="checkbox"
                  checked={Boolean(datos.aceptacion_jefe_area)}
                  onChange={(e) => set('aceptacion_jefe_area', e.target.checked)}
                />
                Jefe de área
              </label>
              <div className="alb-inline-field" style={{ marginTop: 6 }}>
                <span className="alb-inline-label">Fdo.:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.fdo_tecnico ?? '')}
                  onChange={(e) => set('fdo_tecnico', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Fecha:</span>
                <input
                  className="input alb-inline-input"
                  value={String(datos.fecha_firma_tecnico ?? '')}
                  onChange={(e) => set('fecha_firma_tecnico', e.target.value)}
                  placeholder="dd-mm-aaaa"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Registro ── */}
      <div className="card alb-card">
        <div className="sec-label">Registro</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Fecha de encargo</label>
            <input
              className="input"
              value={String(datos.fecha_encargo ?? '')}
              onChange={(e) => set('fecha_encargo', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha de informe</label>
            <input
              className="input"
              value={String(datos.fecha_informe ?? '')}
              onChange={(e) => set('fecha_informe', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
