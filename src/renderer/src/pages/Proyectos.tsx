import { useEffect, useMemo, useState, type JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import { Ic } from '../components/Icon'
import type { Obra } from '../lib/types'

export function Proyectos(): JSX.Element {
  const navigate = useNavigate()
  const [obras, setObras] = useState<Obra[] | null>(null)
  const [filter, setFilter] = useState<'activa' | 'archivada'>('activa')
  const [q, setQ] = useState('')
  const [counts, setCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    setObras(null)
    api.getObras(filter).then(setObras)
  }, [filter])

  useEffect(() => {
    api.countEnsayosPorObra().then(setCounts)
  }, [])

  const filtered = useMemo(() => {
    if (!obras) return null
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
          <p>{filtered === null ? 'Cargando…' : `${filtered.length} proyecto(s)`}</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/nueva')}>
          <Ic.NuevoProyecto /> Nuevo Proyecto
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

      {filtered === null ? (
        <div className="cards">
          {[1, 2, 3, 4].map((i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">No hay proyectos que coincidan.</div>
      ) : (
        <div className="cards">
          {filtered.map((o) => (
            <div className="card clickable" key={o.id} onClick={() => navigate('/detalle/' + o.id)}>
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
                    navigate('/ensayos/' + o.id)
                  }}
                >
                  <Ic.Ensayos /> Ensayos
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
