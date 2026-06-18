import { useEffect, useState, useCallback, type JSX } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import { PlanTable, EditablePlanTable } from '../components/PlanTable'
import { Ic } from '../components/Icon'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { FormField, DateFormField, InfoRow } from '../components/FormField'
import type { Obra, PlanRow, ObraInput, Ensayo } from '../lib/types'

// ── Tipos de ensayo ──────────────────────────────────────────────────────────
const TIPO_LABELS: Record<string, string> = {
  albaran_ensayos: 'Albarán de ensayos',
  densidad_in_situ: 'Densidad in situ',
  placa_carga: 'Placa de carga',
  granulometria: 'Granulometría'
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
  const [tab, setTab] = useState<Tab>('info')
  const [msg, setMsg] = useState<string | null>(null)
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editingInfo, setEditingInfo] = useState(false)
  const [infoForm, setInfoForm] = useState<ObraInput | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const reload = useCallback(async (): Promise<void> => {
    const [o, r, ens] = await Promise.all([
      api.getObra(obraId),
      api.getPlanRows(obraId),
      api.getEnsayos(obraId)
    ])
    setObra(o ?? null)
    const testRows = r.filter((x) => x.row_type === 'test')
    setRows(testRows)
    setEditedRows(testRows)
    setEnsayos(ens)
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
                  <button className="btn" style={{ flexShrink: 0 }} onClick={() => navigate('/ensayos/' + obraId)}>
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

