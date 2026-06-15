/**
 * Página de Ensayos — lista de informes de campo por obra y editor por tipo.
 * Tipos soportados: densidad_in_situ (ASTM D-6938) y placa_carga (NLT-357/98).
 */
import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/api'
import type { Ensayo, EnsayoInput, Obra } from '../lib/types'
import './Ensayos.css'

// ── Tipos de ensayo (espejo de ensayos.ts TIPOS) ─────────────────────────────

const TIPOS: Record<string, { label: string; norma: string }> = {
  densidad_in_situ: {
    label: 'Densidad y humedad in situ',
    norma: 'ASTM D-6938 / PG-3 Art.330.6.5.4'
  },
  placa_carga: { label: 'Ensayo de carga con placa', norma: 'NLT-357/98' }
}

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

interface Props {
  initialObraId?: number
}

export function Ensayos({ initialObraId }: Props): JSX.Element {
  const [obras, setObras] = useState<Obra[]>([])
  const [obraId, setObraId] = useState<number | null>(initialObraId ?? null)
  const [ensayos, setEnsayos] = useState<Ensayo[]>([])
  const [editing, setEditing] = useState<Ensayo | null>(null) // null = lista
  const [creating, setCreating] = useState<string | null>(null) // tipo nuevo
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.getObras().then(setObras)
  }, [])

  useEffect(() => {
    if (!obraId) return
    let cancelled = false
    api.getEnsayos(obraId).then((list) => {
      if (!cancelled) setEnsayos(list)
    })
    return () => {
      cancelled = true
    }
  }, [obraId])

  async function loadEnsayos(id: number): Promise<void> {
    const list = await api.getEnsayos(id)
    setEnsayos(list)
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

        {obraId && obra && (
          <>
            {msg && <div className="banner banner-ok">{msg}</div>}

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
                  ➕ {meta.label}
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
                      await api.deleteEnsayo(e.id)
                      await loadEnsayos(obraId)
                      setMsg('Informe eliminado.')
                    }}
                    onExportWord={async () => {
                      setBusy(true)
                      try {
                        const path = await api.exportEnsayoWord(e.id)
                        if (path) setMsg(`Guardado: ${path}`)
                      } finally {
                        setBusy(false)
                      }
                    }}
                    onExportExcel={
                      e.tipo === 'densidad_in_situ'
                        ? async () => {
                            setBusy(true)
                            try {
                              const path = await api.exportEnsayoExcel(e.id)
                              if (path) setMsg(`Guardado: ${path}`)
                            } finally {
                              setBusy(false)
                            }
                          }
                        : undefined
                    }
                    busy={busy}
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
  onExportExcel,
  busy
}: {
  ensayo: Ensayo
  onEdit: () => void
  onDelete: () => void
  onExportWord: () => void
  onExportExcel?: () => void
  busy: boolean
}): JSX.Element {
  const meta = TIPOS[ensayo.tipo]
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
        <button className="btn" onClick={onEdit}>
          ✏️ Editar
        </button>
        <button className="btn btn-navy" onClick={onExportWord} disabled={busy}>
          ⬇ Word
        </button>
        {onExportExcel && (
          <button className="btn btn-navy" onClick={onExportExcel} disabled={busy}>
            ⬇ Excel
          </button>
        )}
        <button className="btn btn-danger" onClick={onDelete}>
          🗑
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

  const meta = TIPOS[tipo]
  const veredicto = computeVeredictoLocal(tipo, datos)

  async function handleSave(): Promise<void> {
    setBusy(true)
    try {
      await onSave({ tipo, titulo, responsable, estado, veredicto, datos })
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

      {/* Formulario específico */}
      {tipo === 'densidad_in_situ' && <DensidadForm datos={datos} onChange={setDatos} />}
      {tipo === 'placa_carga' && <PlacaForm datos={datos} onChange={setDatos} />}

      <div className="toolbar" style={{ marginTop: 20 }}>
        <button className="btn btn-primary" onClick={handleSave} disabled={busy}>
          {busy ? 'Guardando…' : '💾 Guardar informe'}
        </button>
        <button className="btn" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

// ── Cálculo de veredicto en el renderer (sin IPC) ─────────────────────────────
// Replica las condiciones de computeDensidad / computePlaca para mostrar
// el veredicto en tiempo real mientras se rellena el formulario.

function computeVeredictoLocal(tipo: string, datos: Record<string, unknown>): string {
  try {
    if (tipo === 'densidad_in_situ') {
      const rows = (datos.ensayos as { d_max?: unknown; d_situ?: unknown }[] | undefined) ?? []
      const compMin = parseFloat(String(datos.compactacion_min ?? 100))
      const compVals = rows.flatMap((r) => {
        const dm = parseFloat(String(r.d_max ?? '').replace(',', '.'))
        const ds = parseFloat(String(r.d_situ ?? '').replace(',', '.'))
        return dm > 0 && ds > 0 ? [(ds / dm) * 100] : []
      })
      if (!compVals.length) return ''
      const mediaComp = compVals.reduce((a, b) => a + b, 0) / compVals.length
      const cond1 = mediaComp >= compMin
      const dMaxVals = rows.flatMap((r) => {
        const v = parseFloat(String(r.d_max ?? '').replace(',', '.'))
        return v > 0 ? [v] : []
      })
      const dSituVals = rows.flatMap((r) => {
        const v = parseFloat(String(r.d_situ ?? '').replace(',', '.'))
        return v > 0 ? [v] : []
      })
      const dEspec = dMaxVals.length ? Math.max(...dMaxVals) : 0
      const dMinAdm = dEspec ? dEspec - 0.03 : 0
      const dSituMin = dSituVals.length ? Math.min(...dSituVals) : 0
      const cond2 = dSituVals.length ? dSituMin >= dMinAdm : false
      let ok = cond1 && cond2
      if (datos.cond3_cumple === false) ok = false
      return ok ? 'CUMPLE' : 'NO CUMPLE'
    }
    if (tipo === 'placa_carga') {
      const c1 =
        (datos.ciclo1 as
          | { presion?: unknown; l1?: unknown; l2?: unknown; l3?: unknown }[]
          | undefined) ?? []
      const c2 =
        (datos.ciclo2 as
          | { presion?: unknown; l1?: unknown; l2?: unknown; l3?: unknown }[]
          | undefined) ?? []
      const am = (r: { l1?: unknown; l2?: unknown; l3?: unknown }): number | null => {
        const vals = [r.l1, r.l2, r.l3]
          .map((v) => parseFloat(String(v ?? '').replace(',', '.')))
          .filter((v) => !isNaN(v))
        return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      }
      const asientoEn = (filas: typeof c1, p: number): number | null => {
        const row = filas.find(
          (r) => Math.abs(parseFloat(String(r.presion ?? '').replace(',', '.')) - p) < 1e-6
        )
        return row ? am(row) : null
      }
      const ev = (s035: number | null, s015: number | null): number | null => {
        if (s035 === null || s015 === null) return null
        const ds = s035 - s015
        return ds > 0 ? (1.5 * 150 * 0.2) / ds : null
      }
      const ev1 = ev(asientoEn(c1, 0.35), asientoEn(c1, 0.15))
      const ev2 = ev(asientoEn(c2, 0.35), asientoEn(c2, 0.15))
      const ratioMax = parseFloat(String(datos.ratio_max ?? 2.2))
      if (ev1 === null || ev2 === null || ev1 === 0) return ''
      const ratio = ev2 / ev1
      return ratio <= ratioMax ? 'CUMPLE' : 'NO CUMPLE'
    }
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
              <>
                <div key={`n-${i}`} className="dens-cell-n">
                  {i + 1}
                </div>
                <input
                  key={`ref-${i}`}
                  className="dens-input"
                  value={String(row.referencia ?? '')}
                  onChange={(e) => setEnsayo(i, 'referencia', e.target.value)}
                />
                <input
                  key={`dm-${i}`}
                  className="dens-input"
                  value={String(row.d_max ?? '')}
                  onChange={(e) => setEnsayo(i, 'd_max', e.target.value)}
                  placeholder="0,000"
                />
                <input
                  key={`ho-${i}`}
                  className="dens-input"
                  value={String(row.h_opt ?? '')}
                  onChange={(e) => setEnsayo(i, 'h_opt', e.target.value)}
                  placeholder="0,0"
                />
                <input
                  key={`ds-${i}`}
                  className="dens-input"
                  value={String(row.d_situ ?? '')}
                  onChange={(e) => setEnsayo(i, 'd_situ', e.target.value)}
                  placeholder="0,000"
                />
                <input
                  key={`hs-${i}`}
                  className="dens-input"
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
              </>
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
  const ensayos = (datos.ensayos as Record<string, unknown>[]) ?? []
  const compVals = ensayos.flatMap((r) => {
    const dm = parseFloat(String(r.d_max ?? '').replace(',', '.'))
    const ds = parseFloat(String(r.d_situ ?? '').replace(',', '.'))
    return dm > 0 && ds > 0 ? [(ds / dm) * 100] : []
  })
  const dMaxVals = ensayos.flatMap((r) => {
    const v = parseFloat(String(r.d_max ?? '').replace(',', '.'))
    return v > 0 ? [v] : []
  })
  const dSituVals = ensayos.flatMap((r) => {
    const v = parseFloat(String(r.d_situ ?? '').replace(',', '.'))
    return v > 0 ? [v] : []
  })

  if (!compVals.length) return <></>

  const mediaComp = compVals.reduce((a, b) => a + b, 0) / compVals.length
  const dEspec = dMaxVals.length ? Math.max(...dMaxVals) : 0
  const dMinAdm = dEspec ? dEspec - 0.03 : 0
  const dSituMin = dSituVals.length ? Math.min(...dSituVals) : 0
  const cond1 = mediaComp >= compMin
  const cond2 = dSituVals.length ? dSituMin >= dMinAdm : false

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
                  value={String(r.l1 ?? '')}
                  onChange={(e) => setFila(section, i, 'l1', e.target.value)}
                />
              </td>
              <td>
                <input
                  className="placa-input"
                  value={String(r.l2 ?? '')}
                  onChange={(e) => setFila(section, i, 'l2', e.target.value)}
                />
              </td>
              <td>
                <input
                  className="placa-input"
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

  // Calcular asiento medio y Ev en tiempo real
  const amCalc = (r: Record<string, unknown>): string => {
    const vals = ['l1', 'l2', 'l3']
      .map((k) => parseFloat(String(r[k] ?? '').replace(',', '.')))
      .filter((v) => !isNaN(v))
    return vals.length
      ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2).replace('.', ',')
      : '—'
  }

  const asientoEn = (filas: typeof ciclo1, p: number): number | null => {
    const row = filas.find(
      (r) => Math.abs(parseFloat(String(r.presion ?? '').replace(',', '.')) - p) < 1e-6
    )
    if (!row) return null
    const vals = ['l1', 'l2', 'l3']
      .map((k) => parseFloat(String(row[k] ?? '').replace(',', '.')))
      .filter((v) => !isNaN(v))
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  }

  // Radio real de la placa (de la cabecera) para que el Ev mostrado en vivo coincida
  // con el del informe. El veredicto (ratio Ev2/Ev1) es independiente del radio.
  const radioMm = (datos.radio_mm as number) ?? 150
  const ev = (s035: number | null, s015: number | null): string => {
    if (s035 === null || s015 === null) return '—'
    const ds = s035 - s015
    if (ds <= 0) return '—'
    return ((1.5 * radioMm * 0.2) / ds).toFixed(0)
  }

  const ev1str = ev(asientoEn(ciclo1, 0.35), asientoEn(ciclo1, 0.15))
  const ev2str = ev(asientoEn(ciclo2, 0.35), asientoEn(ciclo2, 0.15))
  const ev1 = parseFloat(ev1str)
  const ev2 = parseFloat(ev2str)
  const ratio = !isNaN(ev1) && !isNaN(ev2) && ev1 > 0 ? ev2 / ev1 : null
  const ratioOk = ratio !== null ? ratio <= ratioMax : null

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
              onChange={(e) => {
                setCab('diam_placa', e.target.value)
                onChange({
                  ...datos,
                  cabecera: { ...cab, diam_placa: e.target.value },
                  radio_mm: parseFloat(e.target.value) / 2 || 150
                })
              }}
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
