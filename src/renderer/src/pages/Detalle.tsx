import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import { PlanTable } from '../components/PlanTable'
import type { Obra, PlanRow } from '../lib/types'

interface Props {
  obraId: number
  onBack: () => void
  onDeleted: () => void
  onEnsayos: (obraId: number) => void
}

export function Detalle({ obraId, onBack, onDeleted, onEnsayos }: Props): JSX.Element {
  const [obra, setObra] = useState<Obra | null>(null)
  const [rows, setRows] = useState<PlanRow[]>([])
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
    setRows(r.filter((x) => x.row_type === 'test'))
    setEnsayosCount(counts[obraId] ?? 0)
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
        <button className="btn btn-navy" onClick={() => exportDoc('excel')} disabled={busy}>
          ⬇ Excel
        </button>
        <button className="btn btn-navy" onClick={() => exportDoc('word')} disabled={busy}>
          ⬇ Word
        </button>
        <span className="spacer" />
        <button className="btn" onClick={() => onEnsayos(obraId)}>
          🧪 Ensayos ({ensayosCount})
        </button>
        <button className="btn" onClick={toggleArchive}>
          {obra.status === 'activa' ? '🗄 Archivar' : '↩ Activar'}
        </button>
        <button className="btn btn-danger" onClick={remove}>
          🗑 Eliminar
        </button>
      </div>

      {msg && <div className="banner banner-warn">{msg}</div>}

      <PlanTable rows={rows} />
    </div>
  )
}
