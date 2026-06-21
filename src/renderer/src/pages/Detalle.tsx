import { useEffect, useState, useCallback, type JSX } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import { PlanTable, EditablePlanTable } from '../components/PlanTable'
import { Ic } from '../components/Icon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { FormField, DateFormField, InfoRow } from '../components/FormField'
import type { Obra, PlanRow, ObraInput, Ensayo, ProgressRow } from '../lib/types'

// ── Tipos de ensayo ──────────────────────────────────────────────────────────
const TIPO_LABELS: Record<string, string> = {
  albaran_ensayos: 'Albarán de ensayos',
  densidad_in_situ: 'Densidad in situ',
  placa_carga: 'Placa de carga',
  granulometria: 'Granulometría',
  toma_hormigon: 'Albarán de toma',
  informe_hormigon: 'Informe hormigón',
  albaran_planta: 'Albarán de planta'
}

type Tab = 'info' | 'presupuesto' | 'ensayos'

export function Detalle(): JSX.Element {
  const navigate = useNavigate()
  const { obraId: obraIdStr } = useParams<{ obraId: string }>()
  const obraId = Number(obraIdStr)
  const [obra, setObra] = useState<Obra | null>(null)
  const [rows, setRows] = useState<PlanRow[]>([])
  const [editedRows, setEditedRows] = useState<PlanRow[]>([])
  const [editingPlan, setEditingPlan] = useState(false)
  const [deletedIds, setDeletedIds] = useState<number[]>([])
  const [ensayos, setEnsayos] = useState<Ensayo[]>([])
  const [progress, setProgress] = useState<ProgressRow[]>([])
  const [tab, setTab] = useState<Tab>('info')
  const [msg, setMsg] = useState<string | null>(null)
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoForm, setInfoForm] = useState<ObraInput | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const [o, r, ens, prog] = await Promise.all([
      api.getObra(obraId),
      api.getPlanRows(obraId),
      api.getEnsayos(obraId),
      api.getEnsayoProgress(obraId)
    ])
    setObra(o ?? null)
    const testRows = r.filter((x) => x.row_type === 'test')
    setRows(testRows)
    setEditedRows(testRows)
    setEnsayos(ens)
    setProgress(prog)
  }, [obraId])

  useEffect(() => {
    void reload()
  }, [reload])

  // ── Plan ──────────────────────────────────────────────────────────────────
  function startEditPlan(): void {
    setEditedRows(rows.map((r) => ({ ...r })))
    setDeletedIds([])
    setEditingPlan(true)
    setMsg(null)
  }

  function cancelEditPlan(): void {
    setEditingPlan(false)
    setEditedRows(rows)
    setDeletedIds([])
    setMsg(null)
  }

  async function savePlan(): Promise<void> {
    setBusy(true)
    setMsg(null)
    try {
      await api.savePlanEdits(obraId, {
        deletes: deletedIds,
        adds: editedRows
          .filter((r) => r.id < 0)
          .map((r) => ({
            material: r.material,
            subcategory: r.subcategory,
            description: r.description,
            n_tests: r.n_tests ?? 0,
            unit_price: r.unit_price ?? 0
          })),
        updates: editedRows
          .filter((r) => r.id > 0)
          .map((r) => ({
            id: r.id,
            measurement: r.measurement,
            n_lots: r.n_lots,
            tests_per_lot: r.tests_per_lot,
            n_tests: r.n_tests ?? 0,
            unit_price: r.unit_price ?? 0,
            total: r.total ?? 0
          }))
      })
      setEditingPlan(false)
      setDeletedIds([])
      setMsg('Plan actualizado y totales recalculados.')
      await reload()
    } catch (e) {
      setMsg(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function exportDoc(kind: 'excel' | 'word'): Promise<void> {
    setBusy(true)
    setMsg(null)
    setLastExportPath(null)
    try {
      const path = kind === 'excel' ? await api.exportExcel(obraId) : await api.exportWord(obraId)
      if (path) {
        setLastExportPath(path)
        setMsg(`Guardado: ${path}`)
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  // ── Info ──────────────────────────────────────────────────────────────────
  function openInfoEdit(): void {
    if (!obra) return
    setInfoForm({
      obra: obra.obra,
      cliente: obra.cliente,
      ref_lab: obra.ref_lab,
      fecha: obra.fecha,
      responsable: obra.responsable
    })
    setEditingInfo(true)
    setMsg(null)
  }

  async function saveInfo(): Promise<void> {
    if (!infoForm) return
    setBusy(true)
    try {
      await api.updateObraInfo(obraId, infoForm)
      setEditingInfo(false)
      await reload()
    } catch (e) {
      setMsg(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  // ── Archivo / Eliminar ────────────────────────────────────────────────────
  async function toggleArchive(): Promise<void> {
    if (!obra) return
    await api.updateStatus(obraId, obra.status === 'activa' ? 'archivada' : 'activa')
    await reload()
  }

  async function remove(): Promise<void> {
    await api.deleteObra(obraId)
    navigate('/proyectos')
  }

  function goTab(t: Tab): void {
    setTab(t)
    setMsg(null)
    setLastExportPath(null)
  }

  if (!obra) return <div className="empty">Cargando…</div>

  const ensayosCompletados = ensayos.filter((e) => e.estado === 'completado').length
  const ensayosCumplen = ensayos.filter((e) => e.veredicto === 'CUMPLE').length

  return (
    <div>
      {/* ── Cabecera ── */}
      <div className="page-head">
        <div>
          <button className="btn btn-ghost" onClick={() => navigate('/proyectos')} style={{ marginBottom: 10 }}>
            ← Proyectos
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1>{obra.obra || '(sin nombre)'}</h1>
            <button
              className="btn btn-ghost"
              title="Editar datos del proyecto"
              style={{ padding: '4px 8px' }}
              onClick={openInfoEdit}
            >
              <Ic.Edit />
            </button>
          </div>
          <p>{obra.cliente || '—'} · Ref. {obra.ref_lab || '—'} · {obra.fecha || 's/f'}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`badge badge-${obra.status}`}>{obra.status}</span>
          <button className="btn" onClick={toggleArchive}>
            {obra.status === 'activa'
              ? <><Ic.Archive /> Archivar</>
              : <><Ic.Restore /> Activar</>}
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
            <Ic.Trash /> Eliminar
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="tab-bar">
        <button className={`tab-btn${tab === 'info' ? ' active' : ''}`} onClick={() => goTab('info')}>
          Información
        </button>
        <button className={`tab-btn${tab === 'presupuesto' ? ' active' : ''}`} onClick={() => goTab('presupuesto')}>
          Presupuesto
        </button>
        <button className={`tab-btn${tab === 'ensayos' ? ' active' : ''}`} onClick={() => goTab('ensayos')}>
          Ensayos {ensayos.length > 0 && <span className="tab-count">{ensayos.length}</span>}
        </button>
      </div>

      {/* ── Mensaje global ── */}
      {msg && (
        <div
          className={`banner ${msg.startsWith('Error') ? 'banner-error' : 'banner-ok'}`}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
        >
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg}</span>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            {lastExportPath && (
              <button className="btn btn-sm" onClick={() => api.showInFolder(lastExportPath!)}>
                <Ic.Folder /> Abrir carpeta
              </button>
            )}
            <button
              className="btn btn-ghost"
              style={{ padding: '2px 8px', fontSize: 12 }}
              onClick={() => { setMsg(null); setLastExportPath(null) }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: INFORMACIÓN
      ════════════════════════════════════════════════════════════ */}
      {tab === 'info' && (
        <>
          <div className="kpis" style={{ marginBottom: 20 }}>
            <div className="kpi">
              <div className="label">Ensayos planificados</div>
              <div className="value">{obra.n_ensayos}</div>
            </div>
            <div className="kpi">
              <div className="label">Informes de campo</div>
              <div className="value">{ensayos.length}</div>
            </div>
            <div className="kpi">
              <div className="label">Materiales</div>
              <div className="value">{obra.n_materiales}</div>
            </div>
            <div className="kpi">
              <div className="label">Importe (sin IVA)</div>
              <div className="value">{eur(obra.total_importe)}</div>
            </div>
          </div>

          {!editingInfo ? (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <h3>Datos del proyecto</h3>
                <button className="btn" onClick={openInfoEdit}><Ic.Edit /> Editar</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px' }}>
                <InfoRow label="Obra / Proyecto" value={obra.obra} />
                <InfoRow label="Cliente" value={obra.cliente} />
                <InfoRow label="Ref. Laboratorio" value={obra.ref_lab} />
                <InfoRow label="Fecha del plan" value={obra.fecha} />
                <InfoRow label="Responsable" value={obra.responsable} />
              </div>

            </div>
          ) : (
            infoForm && (
              <div className="card" style={{ borderColor: 'var(--mid)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h3>Editar datos del proyecto</h3>
                  <button className="btn btn-ghost" style={{ padding: '4px 8px' }} onClick={() => setEditingInfo(false)}><Ic.Close /></button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <FormField label="Obra / Proyecto" value={infoForm.obra} onChange={(v) => setInfoForm({ ...infoForm, obra: v })} autoFocus />
                  <FormField label="Cliente" value={infoForm.cliente ?? ''} onChange={(v) => setInfoForm({ ...infoForm, cliente: v })} />
                  <FormField label="Ref. Laboratorio" value={infoForm.ref_lab ?? ''} onChange={(v) => setInfoForm({ ...infoForm, ref_lab: v })} />
                  <DateFormField label="Fecha del plan" value={infoForm.fecha ?? ''} onChange={(v) => setInfoForm({ ...infoForm, fecha: v })} />
                  <FormField label="Responsable" value={infoForm.responsable ?? ''} onChange={(v) => setInfoForm({ ...infoForm, responsable: v })} />
                </div>
                <div className="toolbar" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
                  <button className="btn" onClick={() => setEditingInfo(false)} disabled={busy}>Cancelar</button>
                  <button className="btn btn-primary" onClick={saveInfo} disabled={busy || !infoForm.obra.trim()}>
                    {busy ? 'Guardando…' : <><Ic.Save /> Guardar datos</>}
                  </button>
                </div>
              </div>
            )
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: PRESUPUESTO
      ════════════════════════════════════════════════════════════ */}
      {tab === 'presupuesto' && (
        <>
          <div className="toolbar">
            <button className="btn btn-navy" onClick={() => exportDoc('excel')} disabled={busy || editingPlan}>
              <Ic.Download /> Excel
            </button>
            <button className="btn btn-navy" onClick={() => exportDoc('word')} disabled={busy || editingPlan}>
              <Ic.Download /> Word
            </button>
            <span className="spacer" />
            {!editingPlan ? (
              <button className="btn" onClick={startEditPlan} disabled={busy}>
                <Ic.Edit /> Editar plan
              </button>
            ) : (
              <>
                <button className="btn btn-primary" onClick={savePlan} disabled={busy}>
                  {busy ? 'Guardando…' : <><Ic.Save /> Guardar cambios</>}
                </button>
                <button className="btn" onClick={cancelEditPlan} disabled={busy}>
                  Cancelar
                </button>
              </>
            )}
          </div>

          {editingPlan ? (
            <EditablePlanTable
              rows={editedRows}
              onChange={setEditedRows}
              onDelete={(id) => {
                setDeletedIds((prev) => [...prev, id])
                setEditedRows((prev) => prev.filter((r) => r.id !== id))
              }}
              onAdd={(sectionStartIdx) => {
                const tempId = -(Date.now())
                setEditedRows((prev) => {
                  // Recorrer desde sectionStartIdx hacia adelante mientras el material coincida
                  const mat = prev[sectionStartIdx]?.material ?? ''
                  let lastIdx = sectionStartIdx
                  for (let j = sectionStartIdx + 1; j < prev.length; j++) {
                    if (prev[j].material === mat) lastIdx = j
                    else break
                  }
                  const next = [...prev]
                  next.splice(lastIdx + 1, 0, {
                    id: tempId,
                    obra_id: obraId,
                    row_type: 'test',
                    material: mat,
                    subcategory: '',
                    description: '',
                    measurement: null,
                    measurement_unit: '',
                    freq_qty: null,
                    freq_unit: '',
                    n_lots: null,
                    tests_per_lot: null,
                    n_tests: 0,
                    unit_price: 0,
                    total: 0,
                    price_source: 'fallback',
                    rag_score: 0,
                    rag_desc: ''
                  })
                  return next
                })
              }}
            />
          ) : (
            <PlanTable rows={rows} />
          )}
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Eliminar proyecto"
          message={`¿Eliminar "${obra.obra}" y su plan de ensayos? Esta acción no se puede deshacer.`}
          confirmLabel="Sí, eliminar"
          onConfirm={() => { setConfirmDelete(false); void remove() }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* ════════════════════════════════════════════════════════════
          TAB: ENSAYOS
      ════════════════════════════════════════════════════════════ */}
      {tab === 'ensayos' && (
        <>
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: 'var(--text-soft)' }}>
              <b style={{ color: 'var(--navy)' }}>{ensayos.length}</b> informes ·{' '}
              <b style={{ color: 'var(--ok)' }}>{ensayosCumplen}</b> cumplen ·{' '}
              <b style={{ color: 'var(--text-soft)' }}>{ensayosCompletados}</b> completados
            </div>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => navigate('/ensayos/' + obraId)}>
              <Ic.Ensayos /> Gestionar ensayos
            </button>
          </div>

          {/* ── Vista de avance: plan vs ejecución (P2) ── */}
          {progress.length > 0 && (
            <ProgressView progress={progress} />
          )}

          {ensayos.length === 0 ? (
            <div className="empty">
              Aún no hay informes de campo. Usa <b>Gestionar ensayos</b> para crear el primero.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ensayos.map((e) => (
                <div key={e.id} className="ens-card">
                  <div className="ens-card-left">
                    <div className="ens-tipo">{TIPO_LABELS[e.tipo] ?? e.tipo}</div>
                    <div className="ens-titulo">{e.titulo || '—'}</div>
                    <div className="ens-meta">
                      <span className={`badge badge-${e.estado}`}>{e.estado}</span>
                      {e.n_expediente && (
                        <span style={{ fontSize: 11, color: 'var(--text-soft)', fontFamily: 'monospace' }}>
                          {e.n_expediente}
                        </span>
                      )}
                      {e.veredicto && (
                        <span className={e.veredicto === 'CUMPLE' ? 'verdict ok' : e.veredicto === 'NO CUMPLE' ? 'verdict no' : 'verdict'}>
                          {e.veredicto}
                        </span>
                      )}
                      <span style={{ color: 'var(--text-soft)', fontSize: 12 }}>
                        {e.created_at?.slice(0, 10)}
                      </span>
                    </div>
                  </div>
                  <button
                    className="btn"
                    style={{ flexShrink: 0 }}
                    onClick={() => navigate('/ensayos/' + obraId, { state: { editEnsayoId: e.id } })}
                  >
                    <Ic.Edit /> Editar
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Componente: Vista de avance plan ↔ ejecución (P2) ──────────────────────

function ProgressView({ progress }: { progress: ProgressRow[] }): JSX.Element {
  const total = progress.length
  const conEnsayos = progress.filter((r) => r.ensayos_completados > 0).length
  const pct = total > 0 ? Math.round((conEnsayos / total) * 100) : 0

  // Agrupar por material
  const byMaterial = new Map<string, ProgressRow[]>()
  for (const r of progress) {
    const mat = r.material || '(sin material)'
    if (!byMaterial.has(mat)) byMaterial.set(mat, [])
    byMaterial.get(mat)!.push(r)
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>Avance de ejecución</h3>
        <span style={{ fontSize: 22, fontWeight: 700, color: pct === 100 ? 'var(--ok)' : 'var(--navy)' }}>
          {pct} %
        </span>
      </div>

      {/* Barra de progreso */}
      <div style={{ background: 'var(--bg-alt)', borderRadius: 6, height: 10, marginBottom: 10, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: pct === 100 ? 'var(--ok)' : 'var(--mid)',
            borderRadius: 6,
            transition: 'width 0.3s'
          }}
        />
      </div>

      <div style={{ fontSize: 13, color: 'var(--text-soft)', marginBottom: 12 }}>
        <b style={{ color: 'var(--navy)' }}>{conEnsayos}</b> de{' '}
        <b style={{ color: 'var(--navy)' }}>{total}</b> ensayos planificados con informe completado
      </div>

      {/* Tabla por material */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg-alt)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-soft)' }}>Material</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--text-soft)' }}>Ensayo</th>
              <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-soft)' }}>Planificados</th>
              <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-soft)' }}>Vinculados</th>
              <th style={{ textAlign: 'center', padding: '4px 8px', color: 'var(--text-soft)' }}>Estado</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byMaterial.entries()).map(([mat, rows]) =>
              rows.map((r, idx) => (
                <tr
                  key={r.plan_row_id}
                  style={{
                    borderTop: '1px solid var(--border)',
                    background: r.ensayos_completados > 0 ? 'rgba(0,150,80,0.04)' : undefined
                  }}
                >
                  {idx === 0 && (
                    <td
                      rowSpan={rows.length}
                      style={{
                        padding: '4px 8px',
                        fontWeight: 600,
                        color: 'var(--navy)',
                        verticalAlign: 'top',
                        borderRight: '1px solid var(--border)'
                      }}
                    >
                      {mat}
                    </td>
                  )}
                  <td style={{ padding: '4px 8px' }}>{r.description}</td>
                  <td style={{ padding: '4px 8px', textAlign: 'center', color: 'var(--text-soft)' }}>
                    {r.n_tests}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    {r.ensayos_total > 0 ? (
                      <span style={{ fontWeight: 600 }}>{r.ensayos_total}</span>
                    ) : (
                      <span style={{ color: 'var(--text-soft)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                    {r.ensayos_completados > 0 ? (
                      <span className="verdict ok" style={{ fontSize: 11 }}>✓</span>
                    ) : r.ensayos_total > 0 ? (
                      <span className="badge badge-borrador" style={{ fontSize: 11 }}>borrador</span>
                    ) : (
                      <span style={{ color: 'var(--text-soft)', fontSize: 11 }}>pendiente</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

