import { useEffect, useMemo, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import type { Obra } from '../lib/types'

interface Props {
  onOpen: (id: number) => void
  onNew: () => void
  onEnsayos: (obraId: number) => void
}

export function Proyectos({ onOpen, onNew, onEnsayos }: Props): JSX.Element {
  const [obras, setObras] = useState<Obra[]>([])
  const [filter, setFilter] = useState<'activa' | 'archivada'>('activa')
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    api.getObras(filter).then(setObras)
    api.countEnsayosPorObra().then(setCounts)
  }, [filter])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return obras
    return obras.filter(
      (o) => o.obra.toLowerCase().includes(term) || o.cliente.toLowerCase().includes(term)
    )
  }, [obras, q])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Proyectos</h1>
          <p>{filtered.length} proyecto(s)</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          ➕ Nuevo Proyecto
        </button>
      </div>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Buscar por obra o cliente…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ flex: 1 }}
        />
        <select
          className="select"
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'activa' | 'archivada')}
        >
          <option value="activa">Activas</option>
          <option value="archivada">Archivadas</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="empty">No hay proyectos que coincidan.</div>
      ) : (
        <div className="cards">
          {filtered.map((o) => (
            <div className="card clickable" key={o.id} onClick={() => onOpen(o.id)}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="card-title">{o.obra || '(sin nombre)'}</span>
                <span className="spacer" />
                <span className={`badge badge-${o.status}`}>{o.status}</span>
              </div>
              <div className="card-sub" style={{ marginBottom: 10 }}>
                {o.cliente || '—'} · {o.ref_lab || 'sin ref.'}
              </div>
              <div className="card-stats">
                <div className="stat">
                  <div className="stat-val">{o.n_ensayos}</div>
                  <div className="stat-lbl">Planificados</div>
                </div>
                <div className="stat">
                  <div className="stat-val">{counts[o.id] ?? 0}</div>
                  <div className="stat-lbl">Informes</div>
                </div>
                <div className="stat">
                  <div className="stat-val">{eur(o.total_importe)}</div>
                  <div className="stat-lbl">Importe</div>
                </div>
              </div>
              <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onEnsayos(o.id)
                  }}
                >
                  🧪 Ensayos
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
