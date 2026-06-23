/**
 * Página de Ensayos — lista de informes de campo por obra y editor por tipo.
 * Tipos soportados: densidad_in_situ (ASTM D-6938), placa_carga (NLT-357/98),
 * granulometria de escollera (UNE EN 13383-2), albaran_ensayos, toma_hormigon.
 */
import { Fragment, useEffect, useState, useCallback, type JSX } from 'react'
import { OcrConfCtx, useOcrConf } from '../lib/ocrConf'
import { useParams, useLocation } from 'react-router-dom'
import { api } from '../lib/api'
import { Ic } from '../components/Icon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ScanPanel } from '../components/ScanPanel'
import { errorMessage } from '../lib/errors'
import {
  densidadSummary,
  placaSummary,
  asientoMedio,
  granulometriaSummary,
  parseMasas,
  GRANULO_SPEC,
  tomaHormigonSummary,
  cargaToTension,
  toNum,
  radonSummary
} from '../lib/ensayoCalc'
import type { Ensayo, EnsayoInput, Obra, PlanRow } from '../lib/types'
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
    label: 'Granulometría (Escollera)',
    norma: 'UNE EN 13383-2 · Clase 5-40 kg'
  },
  toma_hormigon: {
    label: 'Albarán de toma (campo)',
    norma: 'EHE-08 · UNE-EN 12350'
  },
  informe_hormigon: {
    label: 'Informe de ensayo (hormigón)',
    norma: 'EHE-08 · UNE-EN 12350 · UNE-EN 12390'
  },
  albaran_planta: {
    label: 'Albarán de planta',
    norma: 'Registro albarán de entrega central hormigonera'
  },
  radon_trazas: {
    label: 'Concentración de radón (trazas CR-39)',
    norma: 'ISO 11665-4 · IS-47 CSN · PE-CYE-39'
  }
}

/** Agrupación visual de tipos para el selector de nuevo ensayo. */
const GRUPOS: Array<{
  id: string
  label: string
  desc: string
  color: string
  abrev: string
  tipos: string[]
  subLabels?: Record<string, string>
}> = [
  {
    id: 'hormigon',
    label: 'Hormigón',
    desc: 'Albarán de toma · Informe de ensayo · Albarán de planta',
    color: 'var(--orange)',
    abrev: 'H',
    tipos: ['toma_hormigon', 'informe_hormigon', 'albaran_planta']
  },
  {
    id: 'densidad',
    label: 'Densidad in situ',
    desc: 'Albarán · Informe de ensayo',
    color: 'var(--navy)',
    abrev: 'D',
    tipos: ['albaran_ensayos', 'densidad_in_situ'],
    subLabels: { albaran_ensayos: 'Albarán' }
  },
  {
    id: 'placa',
    label: 'Placa de carga',
    desc: 'Albarán · Informe de ensayo',
    color: 'var(--mid)',
    abrev: 'P',
    tipos: ['albaran_ensayos', 'placa_carga'],
    subLabels: { albaran_ensayos: 'Albarán' }
  },
  {
    id: 'granulometria',
    label: 'Granulometría (Escollera)',
    desc: 'Albarán · Informe de ensayo',
    color: '#0d7280',
    abrev: 'G',
    tipos: ['albaran_ensayos', 'granulometria'],
    subLabels: { albaran_ensayos: 'Albarán', granulometria: 'Informe Granulometría' }
  },
  {
    id: 'radon',
    label: 'Radón (trazas CR-39)',
    desc: 'ISO 11665-4 · IS-47 CSN — Exposición pasiva, lectura microscópica',
    color: '#6B21A8',
    abrev: 'Rn',
    tipos: ['radon_trazas']
  }
]

/** Tipos que tienen informe Word disponible. */
export const WORD_TIPOS = new Set(['albaran_ensayos', 'densidad_in_situ', 'placa_carga', 'toma_hormigon', 'informe_hormigon', 'albaran_planta', 'radon_trazas'])
/** Tipos con export a Excel. */
const EXCEL_TIPOS = new Set(['densidad_in_situ', 'placa_carga', 'granulometria', 'informe_hormigon'])

// ── Valores por defecto de presiones de placa ────────────────────────────────

const PLACA_CICLO1_PRESIONES = [0.0, 0.07, 0.15, 0.21, 0.28, 0.35, 0.42, 0.5]
const PLACA_CICLO2_PRESIONES = [0.07, 0.15, 0.21, 0.28, 0.35, 0.42]

function defaultDensidadDatos(): Record<string, unknown> {
  return {
    cabecera: { capa: 'Coronación', n_lote: '1' },
    ensayos: Array.from({ length: 6 }, (_, i) => ({ n: i + 1 })),
    compactacion_min: 100,
    correccion_densidad: 0,
    correccion_humedad: 0,
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

function defaultTomaHormigonDatos(): Record<string, unknown> {
  return {
    identificacion: {
      n_albaran_cye: '',
      sub_obra: '',
      obra: '',
      nte_cliente: '',
      ref_obra: '',
      n_trabajo: '',
      n_ensayo_obra: '',
      lote: '',
      tipo_hormigon: 'HA-25/B/20/IIa',
      tipo_muestreo: 'Simple',
      tipo_compactacion: '3×25 Picadas',
      fecha_toma: '',
      hora_toma: '',
      confeccionado_por: '',
      fecha_recogida: '',
      hora_recogida: ''
    },
    camion: {
      descripcion_elemento: '',
      central: '',
      tipo_planta: '',
      matricula: '',
      volumen_m3: '',
      albaran_central: '',
      hora_salida: '',
      hora_llegada: '',
      t_max_arido: '20',
      consistencia: 'P'
    },
    conos: [
      { numero: 1, mm: '', tiempo_s: '', tipo_asentamiento: 'Simétrico', observaciones: '' },
      { numero: 2, mm: '', tiempo_s: '', tipo_asentamiento: 'Simétrico', observaciones: '' }
    ],
    asentamiento_media: '',
    limite_uso: '32',
    composicion: {
      tipo_cemento: '',
      marca_cemento: '',
      aditivo: '',
      adiciones: '',
      contenido_cemento_m3: '',
      relacion_ac: '',
      t_amb: '',
      t_hormigon: '',
      humedad_pct: ''
    },
    probetas: {
      cantidad: '5',
      n_cilindricas: '5',
      n_prismaticas: '0',
      n_cubicas: '0',
      tipo: 'Cilíndricas 150×300mm',
      por_cye: true,
      fecha_recogida: '',
      hora_recogida: ''
    },
    roturas: [
      { n_probeta: '1', fecha_rotura: '', edad_dias: '7',  densidad_kg_m3: 'Nominales', carga_maxima_kn: '', tension_mpa: '', ajuste_c_sup: 'a', ajuste_c_inf: 'e' },
      { n_probeta: '2', fecha_rotura: '', edad_dias: '7',  densidad_kg_m3: 'Nominales', carga_maxima_kn: '', tension_mpa: '', ajuste_c_sup: 'a', ajuste_c_inf: 'e' },
      { n_probeta: '3', fecha_rotura: '', edad_dias: '28', densidad_kg_m3: 'Nominales', carga_maxima_kn: '', tension_mpa: '', ajuste_c_sup: 'a', ajuste_c_inf: 'e' },
      { n_probeta: '4', fecha_rotura: '', edad_dias: '28', densidad_kg_m3: 'Nominales', carga_maxima_kn: '', tension_mpa: '', ajuste_c_sup: 'a', ajuste_c_inf: 'e' },
      { n_probeta: '5', fecha_rotura: '', edad_dias: '28', densidad_kg_m3: 'Nominales', carga_maxima_kn: '', tension_mpa: '', ajuste_c_sup: 'a', ajuste_c_inf: 'e' }
    ],
    fck_manual: '',
    observaciones: '',
    conservacion_ambiental: true,
    tipo_traslado: '',
    tiempo_estancia_obra: '',
    duracion_traslado: ''
  }
}

function defaultAlbaranPlantaDatos(): Record<string, unknown> {
  return {
    n_albaran_planta: '',
    n_serie: '',
    fecha: '',
    planta: '',
    n_albaran_cye: '',
    cliente: '',
    obra: '',
    matricula: '',
    transportista: '',
    m3_entregados: '',
    tipo_hormigon: '',
    elemento_hormigonado: '',
    hora_carga: '',
    hora_llegada: '',
    hora_inicio_descarga: '',
    hora_fin_descarga: '',
    hora_salida_obra: '',
    tiempo_limite_uso: '',
    distancia_km: '',
    descarga_segura: true,
    cemento_tipo: '',
    cemento_kg_m3: '',
    relacion_ac: '',
    tolerancia_ac: '',
    aditivos: '',
    adiciones: '',
    t_hormigon: '',
    tipo_elemento: '',
    ctrl_entrega_acta: false,
    ctrl_cono: false,
    ctrl_recinto_probetas: false,
    cono_mm: '',
    observaciones: ''
  }
}

export function defaultRadonDatos(): Record<string, unknown> {
  return {
    metadata: {
      fecha_inicio: '',
      fecha_fin: '',
      duracion_dias: null,
      fecha_procesado_inicio: '',
      fecha_procesado_fin: '',
      error_fabricante_pct: 7,
      umbral_decision: 3,
      limite_deteccion: 7,
      nivel_referencia: 300,
      instalacion_cye: true,
      norma: 'IS-47 CSN + PE-CYE-39 (ISO 11665-4)'
    },
    lotes: [],
    detectores: []
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

export function verdictClass(v: string): string {
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
  const location = useLocation()
  const [obras, setObras] = useState<Obra[]>([])
  const [obraId, setObraId] = useState<number | null>(obraIdStr ? Number(obraIdStr) : null)
  const [ensayos, setEnsayos] = useState<Ensayo[]>([])
  const [planRows, setPlanRows] = useState<PlanRow[]>([])
  const [editing, setEditing] = useState<Ensayo | null>(null) // null = lista
  const [creating, setCreating] = useState<string | null>(null) // tipo nuevo
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [lastPath, setLastPath] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)

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
    Promise.all([api.getEnsayos(obraId), api.getPlanRows(obraId)]).then(
      ([list, rows]) => {
        if (cancelled) return
        setEnsayos(list)
        setPlanRows(rows.filter((r) => r.row_type === 'test'))
        // Auto-abrir ensayo específico si venimos de Detalle (state.editEnsayoId)
        const editId = (location.state as { editEnsayoId?: number } | null)?.editEnsayoId
        if (editId) {
          const target = list.find((e) => e.id === editId)
          if (target) setEditing(target)
        }
      },
      (e) => {
        if (!cancelled) setMsg(`Error al cargar ensayos: ${errorMessage(e)}`)
      }
    )
    return () => {
      cancelled = true
    }
  // location.state solo se lee en el montaje inicial; no queremos re-disparar
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId])

  async function loadEnsayos(id: number): Promise<void> {
    try {
      const [list, rows] = await Promise.all([api.getEnsayos(id), api.getPlanRows(id)])
      setEnsayos(list)
      setPlanRows(rows.filter((r) => r.row_type === 'test'))
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
            {/* Summary bar */}
            <div className="ensayo-summary-bar">
              <div className="esb-total">
                <span className="esb-num">{ensayos.length}</span>
                <span className="esb-lbl">informes</span>
              </div>
              <div className="esb-sep" />
              <div className="esb-completion">
                <div className="esb-cmp-header">
                  <span className="esb-lbl">Completados</span>
                  <span className="esb-fraction">
                    {ensayos.filter((e) => e.estado === 'completado').length} / {ensayos.length}
                  </span>
                </div>
                <div className="esb-bar-track">
                  <div
                    className="esb-bar-fill"
                    style={{
                      width: `${ensayos.length ? Math.round((ensayos.filter((e) => e.estado === 'completado').length / ensayos.length) * 100) : 0}%`
                    }}
                  />
                </div>
              </div>
              <div className="esb-sep" />
              <div className="esb-verdict esb-verdict-ok">
                <span className="esb-num">{ensayos.filter((e) => e.veredicto === 'CUMPLE').length}</span>
                <span className="esb-lbl">Cumplen</span>
              </div>
              <div className="esb-verdict esb-verdict-fail">
                <span className="esb-num">{ensayos.filter((e) => e.veredicto === 'NO CUMPLE').length}</span>
                <span className="esb-lbl">No cumplen</span>
              </div>
            </div>

            {/* Selector de nuevo ensayo agrupado */}
            <div className="ensayo-picker">
              <p className="ensayo-picker-title">Nuevo informe de ensayo</p>
              <div className="ensayo-picker-layout">
                <div className="ensayo-grupos">
                  {GRUPOS.map((g) => {
                    const isOpen = openGroup === g.id
                    const isSingle = g.tipos.length === 1
                    return (
                      <button
                        key={g.id}
                        className={`ensayo-grupo-card${isOpen ? ' active' : ''}`}
                        style={{ '--grupo-color': g.color } as React.CSSProperties}
                        onClick={() => {
                          if (isSingle) {
                            setCreating(g.tipos[0])
                          } else {
                            setOpenGroup(isOpen ? null : g.id)
                          }
                        }}
                      >
                        <div className="ensayo-grupo-abrev">{g.abrev}</div>
                        <div className="ensayo-grupo-info">
                          <div className="ensayo-grupo-label">{g.label}</div>
                          <div className="ensayo-grupo-desc">{g.desc}</div>
                        </div>
                        <span className="ensayo-grupo-chevron">
                          {isSingle ? '→' : '▶'}
                        </span>
                      </button>
                    )
                  })}
                </div>
                {GRUPOS.filter((g) => g.tipos.length > 1 && openGroup === g.id).map((g) => (
                  <div
                    key={g.id}
                    className="ensayo-subtypes-panel"
                    style={{ '--grupo-color': g.color } as React.CSSProperties}
                  >
                    <p className="ensayo-subtypes-title">{g.label}</p>
                    {g.tipos.map((tipo) => (
                      <button
                        key={tipo}
                        className="ensayo-subtype-btn"
                        onClick={() => { setCreating(tipo); setOpenGroup(null) }}
                      >
                        <span className="ensayo-subtype-label">{g.subLabels?.[tipo] ?? TIPOS[tipo].label}</span>
                        <span className="ensayo-subtype-norma">{TIPOS[tipo].norma}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
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
                    onDelete={() => setConfirmDeleteId(e.id)}
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

        {confirmDeleteId !== null && (
          <ConfirmDialog
            title="Eliminar informe"
            message="¿Eliminar este informe de ensayo? Esta acción no se puede deshacer."
            confirmLabel="Sí, eliminar"
            onConfirm={async () => {
              const id = confirmDeleteId
              setConfirmDeleteId(null)
              try {
                await api.deleteEnsayo(id)
                if (obraId) await loadEnsayos(obraId)
                setLastPath(null)
                setMsg('Informe eliminado.')
              } catch (err) {
                setMsg(`Error al eliminar: ${errorMessage(err)}`)
              }
            }}
            onCancel={() => setConfirmDeleteId(null)}
          />
        )}
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
          : tipo === 'toma_hormigon' || tipo === 'informe_hormigon'
            ? defaultTomaHormigonDatos()
            : tipo === 'albaran_planta'
              ? defaultAlbaranPlantaDatos()
              : tipo === 'radon_trazas'
                ? defaultRadonDatos()
                : defaultPlacaDatos()

  return (
    <EnsayoEditor
      tipo={tipo}
      datosInit={datosinit}
      tituloInit={editing?.titulo ?? ''}
      responsableInit={editing?.responsable ?? ''}
      estadoInit={editing?.estado ?? 'borrador'}
      planRowIdInit={editing?.plan_row_id ?? null}
      nExpedienteInit={editing?.n_expediente ?? ''}
      planRows={planRows}
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

export function EnsayoCard({
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
          {ensayo.n_expediente && (
            <span style={{ fontSize: 11, color: 'var(--text-soft)', fontFamily: 'monospace' }}>
              {ensayo.n_expediente}
            </span>
          )}
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

export function EnsayoEditor({
  tipo,
  datosInit,
  tituloInit,
  responsableInit,
  estadoInit,
  planRowIdInit,
  nExpedienteInit,
  planRows,
  onSave,
  onCancel
}: {
  tipo: string
  datosInit: Record<string, unknown>
  tituloInit: string
  responsableInit: string
  estadoInit: 'borrador' | 'completado' | 'aprobado'
  planRowIdInit?: number | null
  nExpedienteInit?: string
  planRows?: PlanRow[]
  onSave: (input: EnsayoInput) => Promise<void>
  onCancel: () => void
}): JSX.Element {
  const [datos, setDatos] = useState<Record<string, unknown>>(datosInit)
  const [titulo, setTitulo] = useState(tituloInit)
  const [responsable, setResponsable] = useState(responsableInit)
  const [estado, setEstado] = useState<'borrador' | 'completado' | 'aprobado'>(estadoInit)
  const [planRowId, setPlanRowId] = useState<number | null>(planRowIdInit ?? null)
  const [nExpediente, setNExpediente] = useState(nExpedienteInit ?? '')
  const [loadingExpediente, setLoadingExpediente] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [ocrConf, setOcrConf] = useState<Record<string, string>>({})

  const meta = TIPOS[tipo]
  const veredicto = computeVeredictoLocal(tipo, datos)

  const handleScanResult = useCallback(
    (ocr: Record<string, unknown>, conf: Record<string, string>) => {
      setDatos((prev) => applyOcrResult(tipo, prev, ocr))
      setOcrConf(conf)
    },
    [tipo]
  )

  async function handleAutoExpediente(): Promise<void> {
    setLoadingExpediente(true)
    try {
      const year = new Date().getFullYear()
      const next = await api.getNextExpediente(year)
      setNExpediente(next)
    } catch {
      /* silent — el usuario puede escribir manualmente */
    } finally {
      setLoadingExpediente(false)
    }
  }

  async function handleSave(): Promise<void> {
    setBusy(true)
    setSaveError(null)
    try {
      await onSave({
        tipo,
        titulo,
        responsable,
        estado,
        veredicto,
        n_expediente: nExpediente,
        plan_row_id: planRowId,
        datos
      })
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0 }}>{meta?.label ?? tipo}</h1>
            <div className="estado-toggle-wrap">
              <span className="estado-toggle-label">Estado</span>
              <button
                className={`estado-toggle estado-toggle-${estado}`}
                onClick={() => {
                  const order: Array<'borrador' | 'completado' | 'aprobado'> = ['borrador', 'completado', 'aprobado']
                  setEstado(order[(order.indexOf(estado) + 1) % order.length])
                }}
              >
                {estado === 'borrador' ? '○ Borrador' : estado === 'completado' ? '● Completado' : '✓ Aprobado'}
              </button>
              <span className="estado-toggle-hint">Clic para cambiar</span>
            </div>
          </div>
          <p style={{ color: 'var(--text-soft)', fontSize: 13, marginTop: 4 }}>{meta?.norma}</p>
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
        </div>
        <div className="field-row" style={{ marginTop: 10 }}>
          {/* Nº expediente (P3 — ENAC) */}
          <div className="field-group" style={{ maxWidth: 200 }}>
            <label className="field-label" title="Numeración correlativa del laboratorio (ENAC)">
              Nº Expediente
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="input"
                style={{ fontFamily: 'monospace' }}
                value={nExpediente}
                onChange={(e) => setNExpediente(e.target.value)}
                placeholder="2026/0001"
              />
              <button
                className="btn"
                style={{ flexShrink: 0, padding: '4px 10px', fontSize: 12 }}
                onClick={handleAutoExpediente}
                disabled={loadingExpediente}
                title="Asignar el siguiente número libre"
              >
                {loadingExpediente ? '…' : 'Auto'}
              </button>
            </div>
          </div>
          {/* Enlace a línea del plan (P2) */}
          {planRows && planRows.length > 0 && (
            <div className="field-group">
              <label className="field-label" title="Vincular a una línea del plan de control de calidad">
                Línea del plan
              </label>
              <select
                className="select"
                value={planRowId ?? ''}
                onChange={(e) => setPlanRowId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— Sin vincular —</option>
                {planRows.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.material ? `${r.material} · ` : ''}{r.description}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Panel de escaneo de formularios con IA */}
      <ScanPanel tipo={tipo} onResult={handleScanResult} />

      {saveError && <div className="banner banner-error">⚠ {saveError}</div>}

      {/* Formulario específico — envuelto en contexto de confianza OCR */}
      <OcrConfCtx.Provider value={ocrConf}>
        {tipo === 'densidad_in_situ' && <DensidadForm datos={datos} onChange={setDatos} />}
        {tipo === 'placa_carga' && <PlacaForm datos={datos} onChange={setDatos} />}
        {tipo === 'granulometria' && <GranulometriaForm datos={datos} onChange={setDatos} />}
        {tipo === 'albaran_ensayos' && <AlbaranForm datos={datos} onChange={setDatos} />}
        {tipo === 'toma_hormigon' && <TomaHormigonForm datos={datos} onChange={setDatos} showRoturas={false} />}
        {tipo === 'informe_hormigon' && <TomaHormigonForm datos={datos} onChange={setDatos} showRoturas={true} />}
        {tipo === 'albaran_planta' && <AlbaranPlantaForm datos={datos} onChange={setDatos} />}
        {tipo === 'radon_trazas' && <RadonForm datos={datos} onChange={setDatos} />}
      </OcrConfCtx.Provider>

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

  if (tipo === 'albaran_planta') {
    const merged: Record<string, unknown> = { ...current }
    for (const [k, v] of Object.entries(ocr)) {
      if (v !== null && v !== undefined && v !== '') merged[k] = v
    }
    return merged
  }

  if (tipo === 'toma_hormigon' || tipo === 'informe_hormigon') {
    type TomaOcr = {
      identificacion?: Record<string, string | null>
      camion?: Record<string, string | null>
      conos?: Array<{ numero?: number; mm?: string | null; tiempo_s?: string | null; observaciones?: string | null }>
      asentamiento_media?: string | null
      limite_uso?: string | null
      composicion?: Record<string, string | null>
      probetas?: Record<string, string | null | boolean>
      conservacion_ambiental?: boolean | null
      tipo_traslado?: string | null
      roturas?: Array<Record<string, string | null>>
    }
    const t = ocr as TomaOcr
    const merged = { ...current }

    const mergeSection = (key: string, src: Record<string, unknown> | undefined): void => {
      if (!src) return
      const existing = (current[key] as Record<string, unknown>) ?? {}
      const next = { ...existing }
      for (const [k, v] of Object.entries(src)) {
        if (v !== null && v !== undefined && v !== '') next[k] = v
      }
      merged[key] = next
    }

    mergeSection('identificacion', t.identificacion as Record<string, unknown> | undefined)
    mergeSection('camion', t.camion as Record<string, unknown> | undefined)
    mergeSection('composicion', t.composicion as Record<string, unknown> | undefined)
    mergeSection('probetas', t.probetas as Record<string, unknown> | undefined)

    if (t.asentamiento_media !== null && t.asentamiento_media !== undefined && t.asentamiento_media !== '')
      merged.asentamiento_media = t.asentamiento_media
    if (t.limite_uso !== null && t.limite_uso !== undefined && t.limite_uso !== '')
      merged.limite_uso = t.limite_uso
    if ((ocr as Record<string, unknown>).conservacion_ambiental !== null && (ocr as Record<string, unknown>).conservacion_ambiental !== undefined)
      merged.conservacion_ambiental = (ocr as Record<string, unknown>).conservacion_ambiental
    if ((ocr as Record<string, unknown>).tipo_traslado !== null && (ocr as Record<string, unknown>).tipo_traslado !== undefined && (ocr as Record<string, unknown>).tipo_traslado !== '')
      merged.tipo_traslado = (ocr as Record<string, unknown>).tipo_traslado

    if (t.conos && t.conos.length > 0) {
      const existConos = (current.conos as Record<string, unknown>[]) ?? []
      merged.conos = t.conos.map((c, i) => ({
        numero: c.numero ?? i + 1,
        mm: c.mm ?? existConos[i]?.mm ?? '',
        tiempo_s: c.tiempo_s ?? existConos[i]?.tiempo_s ?? '',
        tipo_asentamiento: (c as Record<string, unknown>).tipo_asentamiento ?? existConos[i]?.tipo_asentamiento ?? 'Simétrico',
        observaciones: c.observaciones ?? existConos[i]?.observaciones ?? ''
      }))
    }

    if (t.roturas && t.roturas.length > 0) {
      merged.roturas = t.roturas.map((r, i) => ({
        n_probeta: r.n_probeta ?? String(i + 1),
        fecha_rotura: r.fecha_rotura ?? '',
        edad_dias: r.edad_dias ?? '',
        carga_maxima_kn: r.carga_maxima_kn ?? '',
        tension_mpa: r.tension_mpa ?? ''
      }))
    }

    return merged
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
    if (tipo === 'toma_hormigon' || tipo === 'informe_hormigon') return tomaHormigonSummary(datos).veredicto
    if (tipo === 'radon_trazas') return radonSummary(datos)?.veredicto ?? ''
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
  const cc = useOcrConf()
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const ensayos = (datos.ensayos as Record<string, unknown>[]) ?? []
  const compMin = (datos.compactacion_min as number) ?? 100
  const cond3 = (datos.cond3_cumple as boolean | null) ?? null

  const nFilas = ensayos.length

  function setCab(key: string, val: string): void {
    onChange({ ...datos, cabecera: { ...cab, [key]: val } })
  }

  const corrD = parseFloat(String(datos.correccion_densidad ?? 0)) || 0

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
              className={cc('cabecera.orden_trabajo')}
              value={cab.orden_trabajo ?? ''}
              onChange={(e) => setCab('orden_trabajo', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Capa</label>
            <input
              className={cc('cabecera.capa')}
              value={cab.capa ?? ''}
              onChange={(e) => setCab('capa', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Nº Lote</label>
            <input
              className={cc('cabecera.n_lote')}
              value={cab.n_lote ?? ''}
              onChange={(e) => setCab('n_lote', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Localización (PK)</label>
            <input
              className={cc('cabecera.localizacion')}
              value={cab.localizacion ?? ''}
              onChange={(e) => setCab('localizacion', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha ensayo</label>
            <input
              className={cc('cabecera.fecha_ensayo')}
              value={cab.fecha_ensayo ?? ''}
              onChange={(e) => setCab('fecha_ensayo', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
          <div className="field-group">
            <label className="field-label" title="Offset aditivo sobre D in situ (g/cm³). 0 = sin corrección">Corrección densidad (g/cm³)</label>
            <input
              type="number"
              step={0.001}
              className="input"
              style={{ width: 110 }}
              value={datos.correccion_densidad ?? 0}
              onChange={(e) =>
                onChange({ ...datos, correccion_densidad: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
          <div className="field-group">
            <label className="field-label" title="Offset aditivo sobre H in situ (%). 0 = sin corrección">Corrección humedad (%)</label>
            <input
              type="number"
              step={0.1}
              className="input"
              style={{ width: 110 }}
              value={datos.correccion_humedad ?? 0}
              onChange={(e) =>
                onChange({ ...datos, correccion_humedad: parseFloat(e.target.value) || 0 })
              }
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
            const comp = dm > 0 && ds > 0 ? (((ds + corrD) / dm) * 100).toFixed(1) : null
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
  amCalc,
  keyPressures
}: {
  filas: Record<string, unknown>[]
  section: 'ciclo1' | 'descarga' | 'ciclo2'
  title: string
  setFila: (section: 'ciclo1' | 'descarga' | 'ciclo2', i: number, key: string, val: string) => void
  amCalc: (r: Record<string, unknown>) => string
  keyPressures?: number[]
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
          {filas.map((r, i) => {
            const isKey = keyPressures?.some((p) => Math.abs((toNum(r.presion) ?? -1) - p) < 1e-6) ?? false
            return (
            <tr key={i} className={isKey ? 'placa-ev-row' : undefined}>
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
            )
          })}
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
  const cc = useOcrConf()
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
              className={cc('cabecera.orden_trabajo')}
              value={cab.orden_trabajo ?? ''}
              onChange={(e) => setCab('orden_trabajo', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">P.K.</label>
            <input
              className={cc('cabecera.pk')}
              value={cab.pk ?? ''}
              onChange={(e) => setCab('pk', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Capa</label>
            <input
              className={cc('cabecera.capa')}
              value={cab.capa ?? ''}
              onChange={(e) => setCab('capa', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha ensayo</label>
            <input
              className={cc('cabecera.fecha_ensayo')}
              value={cab.fecha_ensayo ?? ''}
              onChange={(e) => setCab('fecha_ensayo', e.target.value)}
              placeholder="dd-mm-aaaa"
            />
          </div>
          <div className="field-group" style={{ maxWidth: 120 }}>
            <label className="field-label">Ø placa (mm)</label>
            <input
              className={cc('cabecera.diam_placa')}
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
          keyPressures={[0.15, 0.35]}
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
          keyPressures={[0.15, 0.35]}
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
                {summary.ev1 === null && (
                  <span className="placa-ev-hint">introduce datos en las filas resaltadas (0,15 y 0,35 MPa)</span>
                )}
              </td>
            </tr>
            <tr>
              <td>Ev2 (MPa) — módulo 2º ciclo</td>
              <td colSpan={2} style={{ fontWeight: 700 }}>
                {ev2str}
                {summary.ev2 === null && (
                  <span className="placa-ev-hint">introduce datos en las filas resaltadas (0,15 y 0,35 MPa)</span>
                )}
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
  const cc = useOcrConf()
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
              className={cc('cabecera.material')}
              value={cab.material ?? ''}
              onChange={(e) => setCab('material', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Ref. muestra</label>
            <input
              className={cc('cabecera.muestra')}
              value={cab.muestra ?? ''}
              onChange={(e) => setCab('muestra', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Localización muestra</label>
            <input
              className={cc('cabecera.localizacion')}
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
              className={cc('cabecera.fecha_ensayo')}
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
  const cc = useOcrConf()
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
                className={`${cc('n_ensayo_ot')} alb-hf-input`}
                value={String(datos.n_ensayo_ot ?? '')}
                onChange={(e) => set('n_ensayo_ot', e.target.value)}
              />
            </div>
            <div className="alb-header-field">
              <span className="alb-hf-label">Fecha de toma</span>
              <input
                className={`${cc('fecha_toma')} alb-hf-input`}
                value={String(datos.fecha_toma ?? '')}
                onChange={(e) => set('fecha_toma', e.target.value)}
                placeholder="dd-mm-aaaa"
              />
            </div>
            <div className="alb-header-field">
              <span className="alb-hf-label">Fecha de entrada</span>
              <input
                className={`${cc('fecha_entrada')} alb-hf-input`}
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
              className={cc('titulo_obra')}
              value={String(datos.titulo_obra ?? '')}
              onChange={(e) => set('titulo_obra', e.target.value)}
            />
          </div>
          <div className="field-group">
            <label className="field-label">Ref. Obra</label>
            <input
              className={cc('ref_obra')}
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
                  className={`${cc('empresa')} alb-inline-input`}
                  value={String(datos.empresa ?? '')}
                  onChange={(e) => set('empresa', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Dirección:</span>
                <input
                  className={`${cc('direccion')} alb-inline-input`}
                  value={String(datos.direccion ?? '')}
                  onChange={(e) => set('direccion', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">N.I.F. / C.I.F.:</span>
                <input
                  className={`${cc('nif_cif')} alb-inline-input`}
                  value={String(datos.nif_cif ?? '')}
                  onChange={(e) => set('nif_cif', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Persona de contacto:</span>
                <input
                  className={`${cc('persona_contacto')} alb-inline-input`}
                  value={String(datos.persona_contacto ?? '')}
                  onChange={(e) => set('persona_contacto', e.target.value)}
                />
              </div>
              <div className="alb-inline-field">
                <span className="alb-inline-label">Teléfono / Fax:</span>
                <input
                  className={`${cc('telefono_fax')} alb-inline-input`}
                  value={String(datos.telefono_fax ?? '')}
                  onChange={(e) => set('telefono_fax', e.target.value)}
                />
              </div>
            </div>
            <div className="alb-inline-field" style={{ marginTop: 8 }}>
              <span className="alb-inline-label">Observaciones:</span>
              <input
                className={`${cc('observaciones_cliente')} alb-inline-input`}
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
            className={cc('recogida_por_cye_en')}
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
              className={`${cc('material_descripcion')} alb-textarea-sm`}
              rows={3}
              value={String(datos.material_descripcion ?? '')}
              onChange={(e) => set('material_descripcion', e.target.value)}
            />
          </div>
          <div className="alb-mg-cell">
            <textarea
              className={`${cc('localizacion')} alb-textarea-sm`}
              rows={3}
              value={String(datos.localizacion ?? '')}
              onChange={(e) => set('localizacion', e.target.value)}
            />
          </div>
          <div className="alb-mg-cell">
            <textarea
              className={`${cc('otros_datos')} alb-textarea-sm`}
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
              className={`${cc('cantidad_muestra')} alb-textarea-sm`}
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

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIO TOMA DE HORMIGÓN / PROBETAS
// ══════════════════════════════════════════════════════════════════════════════

type TomaRow = Record<string, unknown>

function TomaHormigonForm({
  datos,
  onChange,
  showRoturas = true
}: {
  datos: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
  showRoturas?: boolean
}): JSX.Element {
  const cc = useOcrConf()
  const ident = (datos.identificacion as Record<string, unknown>) ?? {}
  const camion = (datos.camion as Record<string, unknown>) ?? {}
  const conos = (datos.conos as TomaRow[]) ?? []
  const comp = (datos.composicion as Record<string, unknown>) ?? {}
  const prob = (datos.probetas as Record<string, unknown>) ?? {}
  const roturas = (datos.roturas as TomaRow[]) ?? []

  function setIdent(k: string, v: unknown): void {
    onChange({ ...datos, identificacion: { ...ident, [k]: v } })
  }
  function setCamion(k: string, v: string): void {
    onChange({ ...datos, camion: { ...camion, [k]: v } })
  }
  function setComp(k: string, v: string): void {
    onChange({ ...datos, composicion: { ...comp, [k]: v } })
  }
  function setProb(k: string, v: unknown): void {
    onChange({ ...datos, probetas: { ...prob, [k]: v } })
  }
  function setCono(i: number, k: string, v: string): void {
    const next = conos.map((c, idx) => (idx === i ? { ...c, [k]: v } : c))
    onChange({ ...datos, conos: next })
  }
  function setRotura(i: number, k: string, v: string): void {
    const next = roturas.map((r, idx) => {
      if (idx !== i) return r
      const updated = { ...r, [k]: v }
      // Auto-calcular tensión a partir de carga si el tipo es cilíndrica 150mm
      if (k === 'carga_maxima_kn' && v !== '') {
        const kn = toNum(v)
        if (kn !== null && String(prob.tipo ?? '').includes('150')) {
          updated.tension_mpa = String(cargaToTension(kn)).replace('.', ',')
        }
      }
      return updated
    })
    onChange({ ...datos, roturas: next })
  }
  function addRotura(): void {
    onChange({
      ...datos,
      roturas: [
        ...roturas,
        { n_probeta: String(roturas.length + 1), fecha_rotura: '', edad_dias: '28', densidad_kg_m3: 'Nominales', carga_maxima_kn: '', tension_mpa: '', ajuste_c_sup: 'a', ajuste_c_inf: 'e' }
      ]
    })
  }
  function removeRotura(i: number): void {
    onChange({ ...datos, roturas: roturas.filter((_, idx) => idx !== i) })
  }

  const summary = tomaHormigonSummary(datos)

  return (
    <div>
      {/* ── Identificación ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Identificación del ensayo</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">{showRoturas ? 'Ref. Ensayo CYE' : 'Nº Albarán CYE'}</label>
            <input className={cc('identificacion.n_albaran_cye')} value={String(ident.n_albaran_cye ?? '')} onChange={(e) => setIdent('n_albaran_cye', e.target.value)} />
          </div>
          {showRoturas && (
            <div className="field-group">
              <label className="field-label">Sub Obra</label>
              <input className={cc('identificacion.sub_obra')} value={String(ident.sub_obra ?? '')} onChange={(e) => setIdent('sub_obra', e.target.value)} placeholder="CAZ, Viaducto…" />
            </div>
          )}
          <div className="field-group">
            <label className="field-label">Nº Trabajo</label>
            <input className={cc('identificacion.n_trabajo')} value={String(ident.n_trabajo ?? '')} onChange={(e) => setIdent('n_trabajo', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Nº Ensayo en obra</label>
            <input className={cc('identificacion.n_ensayo_obra')} value={String(ident.n_ensayo_obra ?? '')} onChange={(e) => setIdent('n_ensayo_obra', e.target.value)} />
          </div>
          <div className="field-group" style={{ maxWidth: 90 }}>
            <label className="field-label">Lote</label>
            <input className={cc('identificacion.lote')} value={String(ident.lote ?? '')} onChange={(e) => setIdent('lote', e.target.value)} placeholder="1" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Obra</label>
            <input className={cc('identificacion.obra')} value={String(ident.obra ?? '')} onChange={(e) => setIdent('obra', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">NTE / Cliente</label>
            <input className={cc('identificacion.nte_cliente')} value={String(ident.nte_cliente ?? '')} onChange={(e) => setIdent('nte_cliente', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Ref. Obra</label>
            <input className={cc('identificacion.ref_obra')} value={String(ident.ref_obra ?? '')} onChange={(e) => setIdent('ref_obra', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Tipo de hormigón</label>
            <input className={cc('identificacion.tipo_hormigon')} value={String(ident.tipo_hormigon ?? '')} onChange={(e) => setIdent('tipo_hormigon', e.target.value)} placeholder="HA-25/B/20/IIa" />
          </div>
          <div className="field-group">
            <label className="field-label">Tipo de muestreo</label>
            <select className="select" value={String(ident.tipo_muestreo ?? 'Simple')} onChange={(e) => setIdent('tipo_muestreo', e.target.value)}>
              <option>Simple</option>
              <option>Puntual</option>
              <option>Compuesto</option>
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Tipo de compactación</label>
            <input className={cc('identificacion.tipo_compactacion')} value={String(ident.tipo_compactacion ?? '')} onChange={(e) => setIdent('tipo_compactacion', e.target.value)} placeholder="3×25 Picadas" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Fecha toma</label>
            <input className={cc('identificacion.fecha_toma')} value={String(ident.fecha_toma ?? '')} onChange={(e) => setIdent('fecha_toma', e.target.value)} placeholder="dd-mm-aaaa" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora toma</label>
            <input className={cc('identificacion.hora_toma')} value={String(ident.hora_toma ?? '')} onChange={(e) => setIdent('hora_toma', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group">
            <label className="field-label">Confeccionado por</label>
            <input className={cc('identificacion.confeccionado_por')} value={String(ident.confeccionado_por ?? '')} onChange={(e) => setIdent('confeccionado_por', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Fecha recogida</label>
            <input className={cc('identificacion.fecha_recogida')} value={String(ident.fecha_recogida ?? '')} onChange={(e) => setIdent('fecha_recogida', e.target.value)} placeholder="dd-mm-aaaa" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora recogida</label>
            <input className={cc('identificacion.hora_recogida')} value={String(ident.hora_recogida ?? '')} onChange={(e) => setIdent('hora_recogida', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group">
            <label className="field-label">fck manual (MPa) — si no está en el tipo</label>
            <input className="input" value={String(datos.fck_manual ?? '')} onChange={(e) => onChange({ ...datos, fck_manual: e.target.value })} placeholder="Ej: 30" />
          </div>
        </div>
      </div>

      {/* ── Datos del camión ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Datos del camión / amasada</div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Descripción del elemento</label>
            <input className={cc('camion.descripcion_elemento')} value={String(camion.descripcion_elemento ?? '')} onChange={(e) => setCamion('descripcion_elemento', e.target.value)} placeholder="Muro pantalla, forjado, zapata…" />
          </div>
          <div className="field-group">
            <label className="field-label">Central / Proveedor</label>
            <input className={cc('camion.central')} value={String(camion.central ?? '')} onChange={(e) => setCamion('central', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Matrícula</label>
            <input className={cc('camion.matricula')} value={String(camion.matricula ?? '')} onChange={(e) => setCamion('matricula', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Tipo planta</label>
            <input className="input" value={String(camion.tipo_planta ?? '')} onChange={(e) => setCamion('tipo_planta', e.target.value)} placeholder="Desconocida" />
          </div>
          <div className="field-group">
            <label className="field-label">Volumen (m³)</label>
            <input className={cc('camion.volumen_m3')} value={String(camion.volumen_m3 ?? '')} onChange={(e) => setCamion('volumen_m3', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Albarán central</label>
            <input className={cc('camion.albaran_central')} value={String(camion.albaran_central ?? '')} onChange={(e) => setCamion('albaran_central', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">T. máx. árido (mm)</label>
            <input className={cc('camion.t_max_arido')} value={String(camion.t_max_arido ?? '')} onChange={(e) => setCamion('t_max_arido', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">{showRoturas ? 'Hora fabricación' : 'Hora salida central'}</label>
            <input className={cc('camion.hora_salida')} value={String(camion.hora_salida ?? '')} onChange={(e) => setCamion('hora_salida', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora llegada obra</label>
            <input className={cc('camion.hora_llegada')} value={String(camion.hora_llegada ?? '')} onChange={(e) => setCamion('hora_llegada', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group" style={{ maxWidth: 150 }}>
            <label className="field-label">Consistencia</label>
            <select className="select" value={String(camion.consistencia ?? 'P')} onChange={(e) => setCamion('consistencia', e.target.value)}>
              <option value="S">S — Seca</option>
              <option value="P">P — Plástica</option>
              <option value="B">B — Blanda</option>
              <option value="F">F — Fluida</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Ensayo de asentamiento (Cono de Abrams) ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Ensayo de asentamiento — Cono de Abrams (UNE-EN 12350-2)</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="placa-table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Cono</th>
                <th>Asentamiento (mm)</th>
                <th>Tiempo (s)</th>
                <th>Tipo asentamiento</th>
                <th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {conos.map((c, i) => (
                <tr key={i}>
                  <td style={{ textAlign: 'center', fontWeight: 600 }}>{String(c.numero ?? i + 1)}</td>
                  <td>
                    <input className="input placa-input" value={String(c.mm ?? '')} onChange={(e) => setCono(i, 'mm', e.target.value)} placeholder="mm" />
                  </td>
                  <td>
                    <input className="input placa-input" value={String(c.tiempo_s ?? '')} onChange={(e) => setCono(i, 'tiempo_s', e.target.value)} placeholder="s" />
                  </td>
                  <td>
                    <select className="select" style={{ padding: '2px 4px', fontSize: 12 }} value={String(c.tipo_asentamiento ?? 'Simétrico')} onChange={(e) => setCono(i, 'tipo_asentamiento', e.target.value)}>
                      <option>Simétrico</option>
                      <option>Asimétrico</option>
                      <option>Derrumbe</option>
                      <option>Cizallamiento</option>
                    </select>
                  </td>
                  <td>
                    <input className="input placa-input" value={String(c.observaciones ?? '')} onChange={(e) => setCono(i, 'observaciones', e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="field-row" style={{ marginTop: 10 }}>
          <div className="field-group" style={{ maxWidth: 200 }}>
            <label className="field-label">Media asentamiento (mm)</label>
            <input className={cc('asentamiento_media')} value={String(datos.asentamiento_media ?? '')} onChange={(e) => onChange({ ...datos, asentamiento_media: e.target.value })} />
          </div>
          <div className="field-group" style={{ maxWidth: 180 }}>
            <label className="field-label">Límite de uso (h)</label>
            <input className={cc('limite_uso')} value={String(datos.limite_uso ?? '')} onChange={(e) => onChange({ ...datos, limite_uso: e.target.value })} />
          </div>
        </div>
      </div>

      {/* ── Composición del hormigón ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Composición del hormigón</div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Tipo de cemento</label>
            <input className={cc('composicion.tipo_cemento')} value={String(comp.tipo_cemento ?? '')} onChange={(e) => setComp('tipo_cemento', e.target.value)} placeholder="CEM I 52,5R…" />
          </div>
          <div className="field-group">
            <label className="field-label">Marca cemento</label>
            <input className="input" value={String(comp.marca_cemento ?? '')} onChange={(e) => setComp('marca_cemento', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Aditivo(s)</label>
            <input className={cc('composicion.aditivo')} value={String(comp.aditivo ?? '')} onChange={(e) => setComp('aditivo', e.target.value)} />
          </div>
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Adiciones (humo sílice, cenizas…)</label>
            <input className="input" value={String(comp.adiciones ?? '')} onChange={(e) => setComp('adiciones', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Contenido cemento (kg/m³)</label>
            <input className={cc('composicion.contenido_cemento_m3')} value={String(comp.contenido_cemento_m3 ?? '')} onChange={(e) => setComp('contenido_cemento_m3', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Relación a/c</label>
            <input className={cc('composicion.relacion_ac')} value={String(comp.relacion_ac ?? '')} onChange={(e) => setComp('relacion_ac', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Tª ambiente (°C)</label>
            <input className={cc('composicion.t_amb')} value={String(comp.t_amb ?? '')} onChange={(e) => setComp('t_amb', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Tª hormigón (°C)</label>
            <input className={cc('composicion.t_hormigon')} value={String(comp.t_hormigon ?? '')} onChange={(e) => setComp('t_hormigon', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">% Humedad</label>
            <input className={cc('composicion.humedad_pct')} value={String(comp.humedad_pct ?? '')} onChange={(e) => setComp('humedad_pct', e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Probetas fabricadas ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Probetas fabricadas</div>
        <div className="field-row">
          <div className="field-group" style={{ maxWidth: 90 }}>
            <label className="field-label">Cilíndricas</label>
            <input className={cc('probetas.n_cilindricas')} value={String(prob.n_cilindricas ?? '')} onChange={(e) => {
              const v = e.target.value
              const total = (parseInt(v) || 0) + (parseInt(String(prob.n_prismaticas ?? '0')) || 0) + (parseInt(String(prob.n_cubicas ?? '0')) || 0)
              onChange({ ...datos, probetas: { ...prob, n_cilindricas: v, cantidad: String(total) } })
            }} placeholder="Nº" />
          </div>
          <div className="field-group" style={{ maxWidth: 90 }}>
            <label className="field-label">Prismáticas</label>
            <input className={cc('probetas.n_prismaticas')} value={String(prob.n_prismaticas ?? '')} onChange={(e) => {
              const v = e.target.value
              const total = (parseInt(String(prob.n_cilindricas ?? '0')) || 0) + (parseInt(v) || 0) + (parseInt(String(prob.n_cubicas ?? '0')) || 0)
              onChange({ ...datos, probetas: { ...prob, n_prismaticas: v, cantidad: String(total) } })
            }} placeholder="Nº" />
          </div>
          <div className="field-group" style={{ maxWidth: 90 }}>
            <label className="field-label">Cúbicas</label>
            <input className={cc('probetas.n_cubicas')} value={String(prob.n_cubicas ?? '')} onChange={(e) => {
              const v = e.target.value
              const total = (parseInt(String(prob.n_cilindricas ?? '0')) || 0) + (parseInt(String(prob.n_prismaticas ?? '0')) || 0) + (parseInt(v) || 0)
              onChange({ ...datos, probetas: { ...prob, n_cubicas: v, cantidad: String(total) } })
            }} placeholder="Nº" />
          </div>
          <div className="field-group" style={{ maxWidth: 70 }}>
            <label className="field-label">Total</label>
            <input className="input" readOnly value={String(prob.cantidad ?? '')} style={{ background: 'var(--bg-soft, #f8f8f8)', color: 'var(--text-soft)' }} />
          </div>
          <div className="field-group">
            <label className="field-label">Dimensiones (tipo principal)</label>
            <select className="select" value={String(prob.tipo ?? 'Cilíndricas 150×300mm')} onChange={(e) => setProb('tipo', e.target.value)}>
              <option>Cilíndricas 150×300mm</option>
              <option>Cilíndricas 100×200mm</option>
              <option>Prismáticas 100×100×400mm</option>
              <option>Cúbicas 150×150mm</option>
            </select>
          </div>
          <div className="field-group" style={{ maxWidth: 140 }}>
            <label className="field-label">Por CYE</label>
            <select className="select" value={prob.por_cye ? 'true' : 'false'} onChange={(e) => setProb('por_cye', e.target.value === 'true')}>
              <option value="true">Sí</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Fecha recogida en laboratorio</label>
            <input className={cc('probetas.fecha_recogida')} value={String(prob.fecha_recogida ?? '')} onChange={(e) => setProb('fecha_recogida', e.target.value)} placeholder="dd-mm-aaaa" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora recogida</label>
            <input className={cc('probetas.hora_recogida')} value={String(prob.hora_recogida ?? '')} onChange={(e) => setProb('hora_recogida', e.target.value)} placeholder="hh:mm" />
          </div>
        </div>
      </div>

      {/* ── Roturas de probetas (solo informe de laboratorio) ── */}
      {showRoturas && <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Roturas de probetas (fase laboratorio)</span>
          <button className="btn btn-sm" onClick={addRotura}>+ Probeta</button>
        </div>

        {summary.fck !== null && (
          <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--text-soft)' }}>
            fck = <strong>{summary.fck} MPa</strong>
            {summary.n28 > 0 && (
              <> · Media 28d ({summary.n28} prob.) = <strong>{fmt(summary.media28, 2)} MPa</strong>
              </>
            )}
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table className="placa-table">
            <thead>
              <tr>
                <th style={{ width: 50 }}>Nº</th>
                <th>Fecha rotura</th>
                <th style={{ width: 70 }}>Edad (d)</th>
                <th style={{ width: 130 }}>Densidad (kg/m³)</th>
                <th>Carga máx. (kN)</th>
                <th>Tensión (MPa)</th>
                <th style={{ width: 60 }}>Sup.</th>
                <th style={{ width: 60 }}>Inf.</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {roturas.map((r, i) => {
                const edad = toNum(r.edad_dias)
                const is28 = edad !== null && Math.round(edad) === 28
                const AJUSTE_OPTS = ['a','b','c','d','e']
                return (
                  <tr key={i} style={is28 ? { background: 'color-mix(in srgb, var(--accent) 6%, transparent)' } : undefined}>
                    <td style={{ textAlign: 'center', fontWeight: 600 }}>{String(r.n_probeta ?? i + 1)}</td>
                    <td><input className="input placa-input" value={String(r.fecha_rotura ?? '')} onChange={(e) => setRotura(i, 'fecha_rotura', e.target.value)} placeholder="dd-mm-aaaa" /></td>
                    <td><input className="input placa-input" value={String(r.edad_dias ?? '')} onChange={(e) => setRotura(i, 'edad_dias', e.target.value)} placeholder="28" style={{ textAlign: 'center' }} /></td>
                    <td><input className="input placa-input" value={String(r.densidad_kg_m3 ?? '')} onChange={(e) => setRotura(i, 'densidad_kg_m3', e.target.value)} placeholder="Nominales" /></td>
                    <td><input className="input placa-input" value={String(r.carga_maxima_kn ?? '')} onChange={(e) => setRotura(i, 'carga_maxima_kn', e.target.value)} placeholder="kN" /></td>
                    <td><input className="input placa-input" value={String(r.tension_mpa ?? '')} onChange={(e) => setRotura(i, 'tension_mpa', e.target.value)} placeholder="MPa" style={is28 ? { fontWeight: 600 } : undefined} /></td>
                    <td>
                      <select className="select" style={{ padding: '2px 4px', fontSize: 12 }} value={String(r.ajuste_c_sup ?? 'a')} onChange={(e) => setRotura(i, 'ajuste_c_sup', e.target.value)}>
                        {AJUSTE_OPTS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="select" style={{ padding: '2px 4px', fontSize: 12 }} value={String(r.ajuste_c_inf ?? 'e')} onChange={(e) => setRotura(i, 'ajuste_c_inf', e.target.value)}>
                        {AJUSTE_OPTS.map(o => <option key={o}>{o}</option>)}
                      </select>
                    </td>
                    <td><button className="btn btn-danger btn-sm" onClick={() => removeRotura(i)} style={{ padding: '2px 6px' }}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 6 }}>
          Resaltado = 28d (veredicto). Sup./Inf.: a=azufre b=cemento c=pulido d=arena e=moldeada. Tensión auto-calculada al introducir kN (cilíndrica 150mm).
        </p>
      </div>}

      {/* ── Observaciones y conservación ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Observaciones y conservación</div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 3 }}>
            <label className="field-label">Observaciones del ensayo</label>
            <input className="input" value={String(datos.observaciones ?? '')} onChange={(e) => onChange({ ...datos, observaciones: e.target.value })} placeholder="MUESTRA TOMADA INICIO DESCARGA…" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group" style={{ maxWidth: 220 }}>
            <label className="field-label">Conservación ambiental en obra</label>
            <select className="select" value={datos.conservacion_ambiental === false ? 'false' : 'true'} onChange={(e) => onChange({ ...datos, conservacion_ambiental: e.target.value === 'true' })}>
              <option value="true">Sí — condiciones de obra</option>
              <option value="false">No — acondicionado</option>
            </select>
          </div>
          <div className="field-group">
            <label className="field-label">Tipo de traslado al laboratorio</label>
            <input className={cc('tipo_traslado')} value={String(datos.tipo_traslado ?? '')} onChange={(e) => onChange({ ...datos, tipo_traslado: e.target.value })} placeholder="Vehículo del laboratorio, cliente…" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Tiempo estancia en obra</label>
            <input className="input" value={String(datos.tiempo_estancia_obra ?? '')} onChange={(e) => onChange({ ...datos, tiempo_estancia_obra: e.target.value })} placeholder="25h" />
          </div>
          <div className="field-group">
            <label className="field-label">Duración traslado laboratorio</label>
            <input className="input" value={String(datos.duracion_traslado ?? '')} onChange={(e) => onChange({ ...datos, duracion_traslado: e.target.value })} placeholder="0,5h" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIO ALBARÁN DE PLANTA DE HORMIGÓN
// ══════════════════════════════════════════════════════════════════════════════

function AlbaranPlantaForm({
  datos,
  onChange
}: {
  datos: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
}): JSX.Element {
  const cc = useOcrConf()
  function set(k: string, v: unknown): void {
    onChange({ ...datos, [k]: v })
  }
  function field(k: string): string { return String(datos[k] ?? '') }

  return (
    <div>
      {/* ── Identificación del albarán ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Identificación del albarán</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Nº Albarán planta</label>
            <input className={cc('n_albaran_planta')} value={field('n_albaran_planta')} onChange={(e) => set('n_albaran_planta', e.target.value)} placeholder="189016" />
          </div>
          <div className="field-group">
            <label className="field-label">Nº Serie / lateral</label>
            <input className={cc('n_serie')} value={field('n_serie')} onChange={(e) => set('n_serie', e.target.value)} placeholder="0166450" />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha</label>
            <input className={cc('fecha')} value={field('fecha')} onChange={(e) => set('fecha', e.target.value)} placeholder="dd-mm-aaaa" />
          </div>
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Central / Planta</label>
            <input className={cc('planta')} value={field('planta')} onChange={(e) => set('planta', e.target.value)} placeholder="Hormigones Laracha — Lamas" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Ref. Albarán CYE (vinculación)</label>
            <input className="input" value={field('n_albaran_cye')} onChange={(e) => set('n_albaran_cye', e.target.value)} placeholder="Nº albarán CYE correspondiente" />
          </div>
        </div>
      </div>

      {/* ── Cliente y obra ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Cliente y obra</div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Cliente</label>
            <input className={cc('cliente')} value={field('cliente')} onChange={(e) => set('cliente', e.target.value)} />
          </div>
          <div className="field-group" style={{ flex: 3 }}>
            <label className="field-label">Obra</label>
            <input className={cc('obra')} value={field('obra')} onChange={(e) => set('obra', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Elemento hormigonado</label>
            <input className={cc('elemento_hormigonado')} value={field('elemento_hormigonado')} onChange={(e) => set('elemento_hormigonado', e.target.value)} placeholder="Pilotes, zapatas, muros…" />
          </div>
          <div className="field-group">
            <label className="field-label">Tipo elemento</label>
            <select className="select" value={field('tipo_elemento')} onChange={(e) => set('tipo_elemento', e.target.value)}>
              <option value="">— Sin especificar —</option>
              <option>Zapatas</option>
              <option>Placa</option>
              <option>Pilares</option>
              <option>Muros</option>
              <option>Pilotes</option>
              <option>Otros</option>
            </select>
          </div>
          <div className="field-group" style={{ maxWidth: 100 }}>
            <label className="field-label">M³ entregados</label>
            <input className={cc('m3_entregados')} value={field('m3_entregados')} onChange={(e) => set('m3_entregados', e.target.value)} placeholder="8,0" />
          </div>
        </div>
      </div>

      {/* ── Camión y transporte ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Camión y transporte</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Matrícula</label>
            <input className={cc('matricula')} value={field('matricula')} onChange={(e) => set('matricula', e.target.value)} />
          </div>
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Transportista</label>
            <input className={cc('transportista')} value={field('transportista')} onChange={(e) => set('transportista', e.target.value)} placeholder="Transportes Álvaro Dasal, S.L." />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Hora carga (salida planta)</label>
            <input className={cc('hora_carga')} value={field('hora_carga')} onChange={(e) => set('hora_carga', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora llegada a obra</label>
            <input className={cc('hora_llegada')} value={field('hora_llegada')} onChange={(e) => set('hora_llegada', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora inicio descarga</label>
            <input className={cc('hora_inicio_descarga')} value={field('hora_inicio_descarga')} onChange={(e) => set('hora_inicio_descarga', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora fin descarga</label>
            <input className={cc('hora_fin_descarga')} value={field('hora_fin_descarga')} onChange={(e) => set('hora_fin_descarga', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group">
            <label className="field-label">Hora salida de obra</label>
            <input className={cc('hora_salida_obra')} value={field('hora_salida_obra')} onChange={(e) => set('hora_salida_obra', e.target.value)} placeholder="hh:mm" />
          </div>
          <div className="field-group" style={{ maxWidth: 120 }}>
            <label className="field-label">Límite de uso</label>
            <input className={cc('tiempo_limite_uso')} value={field('tiempo_limite_uso')} onChange={(e) => set('tiempo_limite_uso', e.target.value)} placeholder="90 min" />
          </div>
          <div className="field-group" style={{ maxWidth: 90 }}>
            <label className="field-label">Distancia (km)</label>
            <input className={cc('distancia_km')} value={field('distancia_km')} onChange={(e) => set('distancia_km', e.target.value)} placeholder="0" />
          </div>
        </div>
        <div className="field-row" style={{ alignItems: 'center', gap: 20 }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={datos.descarga_segura !== false} onChange={(e) => set('descarga_segura', e.target.checked)} />
            Descarga segura
          </label>
        </div>
      </div>

      {/* ── Tipo de hormigón y composición ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Tipo de hormigón y composición</div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Tipo de hormigón</label>
            <input className={cc('tipo_hormigon')} value={field('tipo_hormigon')} onChange={(e) => set('tipo_hormigon', e.target.value)} placeholder="HA-25/B/20/IIa" />
          </div>
          <div className="field-group">
            <label className="field-label">Tª hormigón (°C)</label>
            <input className={cc('t_hormigon')} value={field('t_hormigon')} onChange={(e) => set('t_hormigon', e.target.value)} />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Cemento (tipo y marca)</label>
            <input className={cc('cemento_tipo')} value={field('cemento_tipo')} onChange={(e) => set('cemento_tipo', e.target.value)} placeholder="Tudela Veguín (V-L) 42,5 R" />
          </div>
          <div className="field-group">
            <label className="field-label">Cemento (kg/m³)</label>
            <input className={cc('cemento_kg_m3')} value={field('cemento_kg_m3')} onChange={(e) => set('cemento_kg_m3', e.target.value)} placeholder="351" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Relación a/c</label>
            <input className={cc('relacion_ac')} value={field('relacion_ac')} onChange={(e) => set('relacion_ac', e.target.value)} placeholder="0,37" />
          </div>
          <div className="field-group">
            <label className="field-label">Tolerancia a/c (±)</label>
            <input className={cc('tolerancia_ac')} value={field('tolerancia_ac')} onChange={(e) => set('tolerancia_ac', e.target.value)} placeholder="0,02" />
          </div>
        </div>
        <div className="field-row">
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Aditivo(s) y dosis</label>
            <input className={cc('aditivos')} value={field('aditivos')} onChange={(e) => set('aditivos', e.target.value)} placeholder="Duramix ECO 339: 1,65 · Conplast M2289: 1,84" />
          </div>
          <div className="field-group" style={{ flex: 2 }}>
            <label className="field-label">Adiciones</label>
            <input className={cc('adiciones')} value={field('adiciones')} onChange={(e) => set('adiciones', e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Control de recepción ── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Control de recepción en obra</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Cono Abrams en recepción (mm)</label>
            <input className={cc('cono_mm')} value={field('cono_mm')} onChange={(e) => set('cono_mm', e.target.value)} placeholder="mm" />
          </div>
          <div className="field-group" style={{ flex: 3 }}>
            <label className="field-label">Observaciones</label>
            <input className={cc('observaciones')} value={field('observaciones')} onChange={(e) => set('observaciones', e.target.value)} placeholder="Solicitud de agua adicional, incidencias…" />
          </div>
        </div>
        <div className="field-row" style={{ alignItems: 'center', gap: 24, marginTop: 8 }}>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!datos.ctrl_entrega_acta} onChange={(e) => set('ctrl_entrega_acta', e.target.checked)} />
            Entrega acta
          </label>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!datos.ctrl_cono} onChange={(e) => set('ctrl_cono', e.target.checked)} />
            Cono realizado
          </label>
          <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!datos.ctrl_recinto_probetas} onChange={(e) => set('ctrl_recinto_probetas', e.target.checked)} />
            Existe recinto para probetas
          </label>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// FORMULARIO RADÓN (ISO 11665-4 / IS-47 CSN)
// ══════════════════════════════════════════════════════════════════════════════

const PLANTA_OPCIONES = ['Planta -2', 'Planta -1', 'Planta 0', 'Planta 1', 'Planta 2', 'Cubierta', 'Otro']

function emptyDetector(n: number): Record<string, unknown> {
  return {
    n,
    codigo: '',
    lote: '',
    edificio: '',
    planta: 'Planta 0',
    ubicacion: '',
    extraviado: false,
    saturado: false,
    exposicion: '',
    u_exposicion: '',
    rac: '',
    u_rac: ''
  }
}

function RadonForm({
  datos,
  onChange
}: {
  datos: Record<string, unknown>
  onChange: (d: Record<string, unknown>) => void
}): JSX.Element {
  const meta = (datos.metadata as Record<string, unknown>) ?? {}
  const lotes = (datos.lotes as Record<string, unknown>[]) ?? []
  const detectores = (datos.detectores as Record<string, unknown>[]) ?? []
  const [bulkN, setBulkN] = useState(5)
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const nivelRef = (toNum(meta.nivel_referencia) ?? 300)
  const usaLotes = lotes.length > 0

  async function handleImportJson(): Promise<void> {
    setImportMsg(null)
    try {
      const result = await api.importRadonJson()
      if (!result) return // usuario canceló

      const { data, fotoMap } = result as {
        data: {
          metadata: Record<string, unknown>
          detectores: Record<string, unknown>[]
        }
        fotoMap: Record<string, string>
      }

      // Merge metadata: rellena solo los campos vacíos del form actual
      const botMeta = data.metadata ?? {}
      const newMeta: Record<string, unknown> = { ...meta }
      if (!newMeta.fecha_inicio && botMeta.fecha_instalacion) newMeta.fecha_inicio = botMeta.fecha_instalacion
      if (!newMeta.instalacion_cye) newMeta.instalacion_cye = botMeta.instalacion_cye

      // Merge detectores: añade los del bot conservando resultados (rac, etc.) si ya existían
      const existing = [...detectores] as Record<string, unknown>[]
      const botDets = (data.detectores ?? []) as Record<string, unknown>[]
      const merged: Record<string, unknown>[] = botDets.map((bd) => {
        // Busca detector existente por codigo o por número
        const prev = existing.find(
          (e) => (bd.codigo && e.codigo === bd.codigo) || e.n === bd.n
        ) ?? {}
        const fotoPath = bd.foto_filename ? (fotoMap[String(bd.foto_filename)] ?? null) : null
        return {
          ...emptyDetector(Number(bd.n) || 1),
          ...prev,             // preserva resultados ya introducidos
          n: bd.n,
          codigo: bd.codigo ?? prev.codigo ?? '',
          edificio: bd.edificio ?? prev.edificio ?? '',
          planta: bd.planta ?? prev.planta ?? 'Planta 0',
          ubicacion: bd.ubicacion ?? prev.ubicacion ?? '',
          extraviado: bd.extraviado ?? prev.extraviado ?? false,
          foto_path: fotoPath ?? prev.foto_path ?? null
        }
      })

      onChange({ ...datos, metadata: newMeta, detectores: merged })
      const nFotos = Object.keys(fotoMap).length
      setImportMsg({
        ok: true,
        text: `Importados ${merged.length} detectores` + (nFotos > 0 ? ` y ${nFotos} foto(s).` : ' (sin fotos encontradas).')
      })
    } catch (e) {
      setImportMsg({ ok: false, text: `Error al importar: ${String(e)}` })
    }
  }

  function setMeta(key: string, val: unknown): void {
    onChange({ ...datos, metadata: { ...meta, [key]: val } })
  }

  function addDetector(): void {
    onChange({ ...datos, detectores: [...detectores, emptyDetector(detectores.length + 1)] })
  }

  function addBulk(): void {
    const newOnes = Array.from({ length: bulkN }, (_, i) => emptyDetector(detectores.length + i + 1))
    onChange({ ...datos, detectores: [...detectores, ...newOnes] })
  }

  function removeDetector(i: number): void {
    const next = detectores.filter((_, idx) => idx !== i).map((d, idx) => ({ ...(d as Record<string, unknown>), n: idx + 1 }))
    onChange({ ...datos, detectores: next })
  }

  function setDet(i: number, key: string, val: unknown): void {
    const next = detectores.map((d, idx) => idx === i ? { ...(d as Record<string, unknown>), [key]: val } : d)
    onChange({ ...datos, detectores: next })
  }

  function addLote(): void {
    const id = String.fromCharCode(65 + lotes.length) // A, B, C…
    onChange({ ...datos, lotes: [...lotes, { id, fecha_inicio: '', fecha_fin: '', duracion_dias: null }] })
  }

  function setLote(i: number, key: string, val: unknown): void {
    const next = lotes.map((l, idx) => idx === i ? { ...(l as Record<string, unknown>), [key]: val } : l)
    onChange({ ...datos, lotes: next })
  }

  function removeLote(i: number): void {
    onChange({ ...datos, lotes: lotes.filter((_, idx) => idx !== i) })
  }

  const summary = radonSummary(datos)

  function detRowClass(d: Record<string, unknown>): string {
    if (d.extraviado) return 'radon-row-extraviado'
    if (d.saturado) return 'radon-row-saturado'
    const r = toNum(d.rac)
    if (r !== null && r > nivelRef) return 'radon-row-excede'
    return ''
  }

  return (
    <div>
      {/* Metadatos de exposición */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label">Datos de la exposición</div>
        <div className="field-row">
          <div className="field-group">
            <label className="field-label">Fecha inicio</label>
            <input className="input" type="date" value={String(meta.fecha_inicio ?? '')} onChange={(e) => setMeta('fecha_inicio', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha fin</label>
            <input className="input" type="date" value={String(meta.fecha_fin ?? '')} onChange={(e) => setMeta('fecha_fin', e.target.value)} />
          </div>
          <div className="field-group" style={{ maxWidth: 120 }}>
            <label className="field-label">Duración (días)</label>
            <input className="input" type="number" min={1} value={String(meta.duracion_dias ?? '')} onChange={(e) => setMeta('duracion_dias', e.target.value ? Number(e.target.value) : null)} placeholder="auto" />
          </div>
          <div className="field-group" style={{ maxWidth: 140 }}>
            <label className="field-label">Instalación</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <input type="checkbox" checked={Boolean(meta.instalacion_cye)} onChange={(e) => setMeta('instalacion_cye', e.target.checked)} />
              <span style={{ fontSize: 13 }}>Por CYE</span>
            </label>
          </div>
        </div>
        <div className="field-row" style={{ marginTop: 10 }}>
          <div className="field-group">
            <label className="field-label">Fecha inicio procesado</label>
            <input className="input" type="date" value={String(meta.fecha_procesado_inicio ?? '')} onChange={(e) => setMeta('fecha_procesado_inicio', e.target.value)} />
          </div>
          <div className="field-group">
            <label className="field-label">Fecha fin procesado</label>
            <input className="input" type="date" value={String(meta.fecha_procesado_fin ?? '')} onChange={(e) => setMeta('fecha_procesado_fin', e.target.value)} />
          </div>
          <div className="field-group" style={{ maxWidth: 130 }}>
            <label className="field-label">Error fab. (%)</label>
            <input className="input" type="number" step={0.1} value={String(meta.error_fabricante_pct ?? 7)} onChange={(e) => setMeta('error_fabricante_pct', parseFloat(e.target.value) || 7)} />
          </div>
          <div className="field-group" style={{ maxWidth: 130 }}>
            <label className="field-label">Umbral decisión (Bq/m³)</label>
            <input className="input" type="number" value={String(meta.umbral_decision ?? 3)} onChange={(e) => setMeta('umbral_decision', Number(e.target.value))} />
          </div>
          <div className="field-group" style={{ maxWidth: 130 }}>
            <label className="field-label">Límite detección (Bq/m³)</label>
            <input className="input" type="number" value={String(meta.limite_deteccion ?? 7)} onChange={(e) => setMeta('limite_deteccion', Number(e.target.value))} />
          </div>
          <div className="field-group" style={{ maxWidth: 150 }}>
            <label className="field-label">Nivel referencia (Bq/m³)</label>
            <input className="input" type="number" value={String(meta.nivel_referencia ?? 300)} onChange={(e) => setMeta('nivel_referencia', Number(e.target.value))} />
          </div>
        </div>
        <div className="field-row" style={{ marginTop: 10 }}>
          <div className="field-group" style={{ flex: 3 }}>
            <label className="field-label">Norma / procedimiento</label>
            <input className="input" value={String(meta.norma ?? '')} onChange={(e) => setMeta('norma', e.target.value)} placeholder="IS-47 CSN + PE-CYE-39 (ISO 11665-4)" />
          </div>
        </div>
      </div>

      {/* Lotes (opcional — para campañas con distintos periodos) */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: usaLotes ? 12 : 0 }}>
          <div className="sec-label" style={{ marginBottom: 0 }}>Lotes de exposición <span style={{ fontWeight: 400, color: 'var(--text-soft)', fontSize: 12 }}>(opcional — si los detectores tuvieron periodos distintos)</span></div>
          <button className="btn" style={{ fontSize: 12 }} onClick={addLote}>+ Añadir lote</button>
        </div>
        {usaLotes && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                {['Id', 'Fecha inicio', 'Fecha fin', 'Días', ''].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-soft)', fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lotes.map((l, i) => {
                const lot = l as Record<string, unknown>
                return (
                  <tr key={i}>
                    <td style={{ padding: '3px 6px' }}><input className="input" style={{ width: 40, textAlign: 'center' }} value={String(lot.id ?? '')} onChange={(e) => setLote(i, 'id', e.target.value)} /></td>
                    <td style={{ padding: '3px 6px' }}><input className="input" type="date" value={String(lot.fecha_inicio ?? '')} onChange={(e) => setLote(i, 'fecha_inicio', e.target.value)} /></td>
                    <td style={{ padding: '3px 6px' }}><input className="input" type="date" value={String(lot.fecha_fin ?? '')} onChange={(e) => setLote(i, 'fecha_fin', e.target.value)} /></td>
                    <td style={{ padding: '3px 6px' }}><input className="input" type="number" style={{ width: 70 }} value={String(lot.duracion_dias ?? '')} onChange={(e) => setLote(i, 'duracion_dias', e.target.value ? Number(e.target.value) : null)} placeholder="auto" /></td>
                    <td style={{ padding: '3px 6px' }}><button className="btn btn-danger" style={{ padding: '2px 8px', fontSize: 12 }} onClick={() => removeLote(i)}><Ic.Trash /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Tabla de detectores */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="sec-label" style={{ marginBottom: 0 }}>Detectores ({detectores.length})</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="btn" onClick={handleImportJson} style={{ background: 'var(--color-purple, #6B21A8)', color: '#fff', borderColor: 'transparent' }}>
              📥 Importar desde bot
            </button>
            <span style={{ fontSize: 13, color: 'var(--text-soft)' }}>Añadir:</span>
            <input
              type="number" min={1} max={100}
              className="input" style={{ width: 60 }}
              value={bulkN}
              onChange={(e) => setBulkN(Math.max(1, parseInt(e.target.value) || 1))}
            />
            <button className="btn" onClick={addBulk}>+ {bulkN} filas</button>
            <button className="btn" onClick={addDetector}>+ 1</button>
          </div>
        </div>
        {importMsg && (
          <div style={{
            padding: '6px 10px', borderRadius: 6, marginBottom: 10, fontSize: 13,
            background: importMsg.ok ? 'var(--color-success-bg, #d1fae5)' : 'var(--color-danger-bg, #fee2e2)',
            color: importMsg.ok ? 'var(--color-success, #065f46)' : 'var(--color-danger, #991b1b)'
          }}>
            {importMsg.text}
            <button onClick={() => setImportMsg(null)} style={{ marginLeft: 10, background: 'none', border: 'none', cursor: 'pointer', opacity: 0.6 }}>✕</button>
          </div>
        )}

        {detectores.length === 0 ? (
          <div className="empty" style={{ padding: '20px 0' }}>Aún no hay detectores. Usa los botones de arriba para añadir filas.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--bg-card-alt, #f4f6f9)' }}>
                  {['Nº', 'Código', ...(usaLotes ? ['Lote'] : []), 'Edificio', 'Planta', 'Ubicación', 'Extr.', 'Sat.', 'Exp. kBq·h/m²', '±u exp.', 'RAC Bq/m³', '±u RAC', 'Foto', ''].map((h) => (
                    <th key={h} style={{ padding: '5px 6px', textAlign: 'left', fontWeight: 600, color: 'var(--text-soft)', whiteSpace: 'nowrap', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detectores.map((d, i) => {
                  const det = d as Record<string, unknown>
                  const extraviado = Boolean(det.extraviado)
                  const saturado = Boolean(det.saturado)
                  const disabled = extraviado || saturado
                  return (
                    <tr key={i} className={detRowClass(det)} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '3px 6px', color: 'var(--text-soft)', width: 30 }}>{i + 1}</td>
                      <td style={{ padding: '3px 4px' }}>
                        <input
                          className="input" style={{ width: 72, fontFamily: 'monospace', fontSize: 12 }}
                          value={String(det.codigo ?? '')}
                          onChange={(e) => setDet(i, 'codigo', e.target.value)}
                          placeholder="GJ0000"
                        />
                      </td>
                      {usaLotes && (
                        <td style={{ padding: '3px 4px' }}>
                          <select
                            className="select" style={{ width: 56, fontSize: 12 }}
                            value={String(det.lote ?? '')}
                            onChange={(e) => setDet(i, 'lote', e.target.value)}
                          >
                            <option value="">—</option>
                            {lotes.map((l) => {
                              const lot = l as Record<string, unknown>
                              return <option key={String(lot.id)} value={String(lot.id)}>{String(lot.id)}</option>
                            })}
                          </select>
                        </td>
                      )}
                      <td style={{ padding: '3px 4px' }}>
                        <input
                          className="input" style={{ width: 100, fontSize: 12 }}
                          value={String(det.edificio ?? '')}
                          onChange={(e) => setDet(i, 'edificio', e.target.value)}
                          placeholder="Pabellón…"
                        />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <select
                          className="select" style={{ width: 90, fontSize: 12 }}
                          value={String(det.planta ?? 'Planta 0')}
                          onChange={(e) => setDet(i, 'planta', e.target.value)}
                        >
                          {PLANTA_OPCIONES.map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input
                          className="input" style={{ minWidth: 130, fontSize: 12 }}
                          value={String(det.ubicacion ?? '')}
                          onChange={(e) => setDet(i, 'ubicacion', e.target.value)}
                          placeholder="Zona entrada, estantería…"
                        />
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                        <input
                          type="checkbox" checked={extraviado}
                          onChange={(e) => setDet(i, 'extraviado', e.target.checked)}
                          title="Detector extraviado (sin resultado)"
                        />
                      </td>
                      <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                        <input
                          type="checkbox" checked={saturado} disabled={extraviado}
                          onChange={(e) => setDet(i, 'saturado', e.target.checked)}
                          title="Detector saturado (>rango, RAC >1.000 Bq/m³)"
                        />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input
                          className="input" style={{ width: 80 }} type="number" step={1} disabled={disabled}
                          value={disabled ? '' : String(det.exposicion ?? '')}
                          onChange={(e) => setDet(i, 'exposicion', e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="—"
                        />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input
                          className="input" style={{ width: 60 }} type="number" step={1} disabled={disabled}
                          value={disabled ? '' : String(det.u_exposicion ?? '')}
                          onChange={(e) => setDet(i, 'u_exposicion', e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="±"
                        />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input
                          className="input" style={{ width: 70, fontWeight: 700 }} type="number" step={1} disabled={disabled}
                          value={disabled ? '' : String(det.rac ?? '')}
                          onChange={(e) => setDet(i, 'rac', e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="—"
                        />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input
                          className="input" style={{ width: 55 }} type="number" step={1} disabled={disabled}
                          value={disabled ? '' : String(det.u_rac ?? '')}
                          onChange={(e) => setDet(i, 'u_rac', e.target.value === '' ? '' : Number(e.target.value))}
                          placeholder="±"
                        />
                      </td>
                      <td style={{ padding: '3px 4px', width: 52 }}>
                        {det.foto_path ? (
                          <div style={{ position: 'relative', display: 'inline-block' }}>
                            <img
                              src={`file://${det.foto_path}`}
                              alt={`Det. ${i + 1}`}
                              style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border)' }}
                              onClick={() => api.openRadonPhoto(String(det.foto_path))}
                              title="Clic para abrir"
                            />
                            <button
                              onClick={() => setDet(i, 'foto_path', null)}
                              style={{ position: 'absolute', top: -4, right: -4, width: 14, height: 14, borderRadius: '50%', background: 'var(--color-danger, #dc2626)', border: 'none', color: '#fff', fontSize: 9, lineHeight: '14px', cursor: 'pointer', padding: 0 }}
                              title="Quitar foto"
                            >✕</button>
                          </div>
                        ) : (
                          <button
                            className="btn"
                            style={{ padding: '2px 5px', fontSize: 11 }}
                            title="Adjuntar foto"
                            onClick={async () => {
                              const path = await api.pickRadonPhoto()
                              if (path) setDet(i, 'foto_path', path)
                            }}
                          >📎</button>
                        )}
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <button className="btn btn-danger" style={{ padding: '2px 6px', fontSize: 11 }} onClick={() => removeDetector(i)} title="Eliminar fila">
                          <Ic.Trash />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {detectores.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-soft)', display: 'flex', gap: 16 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: '#e2e8f0', borderRadius: 2, display: 'inline-block' }} /> Extraviado</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: '#fed7aa', borderRadius: 2, display: 'inline-block' }} /> Saturado (&gt;rango)</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, background: '#fef08a', borderRadius: 2, display: 'inline-block' }} /> Excede {nivelRef} Bq/m³</span>
          </div>
        )}
      </div>

      {/* Resumen */}
      {summary && (
        <div className="card">
          <div className="sec-label">Resumen de resultados</div>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>Total detectores</td>
                  <td style={{ fontWeight: 700 }}>{summary.n_total}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>Extraviados</td>
                  <td>{summary.n_extraviados}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>Saturados (&gt;rango)</td>
                  <td style={{ color: summary.n_saturados > 0 ? '#ea580c' : undefined }}>{summary.n_saturados}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>Con resultado válido</td>
                  <td>{summary.n_validos}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>Exceden {summary.nivel_referencia} Bq/m³</td>
                  <td style={{ color: summary.n_exceden > 0 ? '#dc2626' : '#16a34a', fontWeight: 700 }}>{summary.n_exceden}</td>
                </tr>
              </tbody>
            </table>
            <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
              <tbody>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>RAC mínima</td>
                  <td style={{ fontWeight: 700 }}>{summary.rac_min !== null ? `${summary.rac_min} Bq/m³` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>RAC máxima</td>
                  <td style={{ fontWeight: 700, color: summary.rac_max !== null && summary.rac_max > nivelRef ? '#dc2626' : undefined }}>{summary.rac_max !== null ? `${summary.rac_max} Bq/m³` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>RAC media</td>
                  <td style={{ fontWeight: 700 }}>{summary.rac_media !== null ? `${summary.rac_media} Bq/m³` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ padding: '3px 16px 3px 0', color: 'var(--text-soft)' }}>Nivel de referencia</td>
                  <td>{summary.nivel_referencia} Bq/m³ (Art. 72 RD 1029/2022)</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
