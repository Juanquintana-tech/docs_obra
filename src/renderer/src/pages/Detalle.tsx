import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import { PlanTable, EditablePlanTable } from '../components/PlanTable'
import type { Obra, PlanRow, PlanRowPatch } from '../lib/types'

interface Props {
  obraId: number
  onBack: () => void
  onDeleted: () => void
  onEnsayos: (obraId: number) => void
}

export function Detalle({ obraId, onBack, onDeleted, onEnsayos }: Props): JSX.Element {
  const [obra, setObra] = useState<Obra | null>(null)
  const [rows, setRows] = useState<PlanRow[]>([])
  const [editedRows, setEditedRows] = useState<PlanRow[]>([])
  const [editing, setEditing] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ensayosCount, setEnsayosCount] = useState(0)

  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obraId])

  async function reload(): Promise<void> {
    const [o, r, counts] = await Promise.all([api.getObra(obraId), api.getPlanRows(obraId), api.countEnsayosPorObra()])
    setObra(o ?? null)
    const testRows = r.filter((x) => x.row_type === 'test')
    setRows(testRows)
    setEditedRows(testRows)
    setEnsayosCount(counts[obraId] ?? 0)
  }

  function startEdit(): void {
    setEditedRows(rows.map((r) => ({ ...r })))
    setEditing(true)
    setMsg(null)
  }

  function cancelEdit(): void {
    setEditing(false)
    setEditedRows(rows)
    setMsg(null)
  }

  async function savePlan(): Promise<void> {
    setBusy(true)
    setMsg(null)
    try {
      const patches: PlanRowPatch[] = editedRows.map((r) => ({
        id: r.id,
        measurement: r.measurement,
        n_lots: r.n_lots,
        tests_per_lot: r.tests_per_lot,
        n_tests: r.n_tests ?? 0,
        unit_price: r.unit_price ?? 0,
        total: r.total ?? 0
      }))
      await api.updatePlanRows(obraId, patches)
      setEditing(false)
      setMsg('Plan actualizado y totales recalculados.')
      await reload()
    } catch (e) {
      setMsg(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  async function exportDoc(kind: 'excel' | 'word'): Promise<void> {
    setBusy(true)
    setMsg(null)
    try {
      const path = kind === 'excel' ? await api.exportExcel(obraId) : await api.exportWord(obraId)
      if (path) setMsg(`Guardado: ${path}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleArchive(): Promise<void> {
    if (!obra) return
    await api.updateStatus(obraId, obra.status === 'activa' ? 'archivada' : 'activa')
    await reload()
  }

  async function remove(): Promise<void> {
    if (!confirm('¿Eliminar este proyecto y su plan? Esta acción no se puede deshacer.')) return
    await api.deleteObra(obraId)
    onDeleted()
  }

  if (!obra) return <div className="empty">Cargando…</div>

  return (
    <div>
      <div className="page-head">
        <div>
          <button className="btn btn-ghost" onClick={onBack} style={{ marginBottom: 10 }}>
            ← Proyectos
          </button>
          <h1>{obra.obra || '(sin nombre)'}</h1>
          <p>
            {obra.cliente || '—'} · Ref. {obra.ref_lab || '—'} · {obra.fecha || 's/f'}
          </p>
        </div>
        <span className={`badge badge-${obra.status}`}>{obra.status}</span>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Ensayos planificados</div>
          <div className="value">{obra.n_ensayos}</div>
        </div>
        <div className="kpi">
          <div className="label">Informes de campo</div>
          <div className="value">{ensayosCount}</div>
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

      <div className="toolbar">
        <button className="btn btn-navy" onClick={() => exportDoc('excel')} disabled={busy || editing}>
          ⬇ Excel
        </button>
        <button className="btn btn-navy" onClick={() => exportDoc('word')} disabled={busy || editing}>
          ⬇ Word
        </button>
        <span className="spacer" />
        {!editing ? (
          <button className="btn" onClick={startEdit} disabled={busy}>
            ✏️ Editar plan
          </button>
        ) : (
          <>
            <button className="btn btn-primary" onClick={savePlan} disabled={busy}>
              {busy ? 'Guardando…' : '💾 Guardar cambios'}
            </button>
            <button className="btn" onClick={cancelEdit} disabled={busy}>
              Cancelar
            </button>
          </>
        )}
        <button className="btn" onClick={() => onEnsayos(obraId)} disabled={editing}>
          🧪 Ensayos ({ensayosCount})
        </button>
        <button className="btn" onClick={toggleArchive} disabled={editing}>
          {obra.status === 'activa' ? '🗄 Archivar' : '↩ Activar'}
        </button>
        <button className="btn btn-danger" onClick={remove} disabled={editing}>
          🗑 Eliminar
        </button>
      </div>

      {msg && (
        <div className={`banner ${msg.startsWith('Error') ? 'banner-error' : 'banner-warn'}`}>
          {msg}
        </div>
      )}

      {editing ? (
        <EditablePlanTable
          rows={editedRows}
          onChange={setEditedRows}
        />
      ) : (
        <PlanTable rows={rows} />
      )}
    </div>
  )
}
