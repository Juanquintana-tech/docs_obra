import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import type { GlobalStats, Obra } from '../lib/types'

interface Props {
  onOpen: (id: number) => void
  onNew: () => void
}

export function Dashboard({ onOpen, onNew }: Props): JSX.Element {
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [recent, setRecent] = useState<Obra[]>([])

  useEffect(() => {
    api.getGlobalStats().then(setStats)
    api.getObras('activa').then((o) => setRecent(o.slice(0, 6)))
  }, [])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Resumen de la actividad de control de calidad</p>
        </div>
        <button className="btn btn-primary" onClick={onNew}>
          ➕ Nuevo Proyecto
        </button>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="label">Proyectos activos</div>
          <div className="value">{stats?.n_obras ?? '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">Ensayos totales</div>
          <div className="value">{stats?.n_ensayos ?? '—'}</div>
        </div>
        <div className="kpi">
          <div className="label">Importe acumulado</div>
          <div className="value">{stats ? eur(stats.importe_total) : '—'}</div>
        </div>
      </div>

      <h2 style={{ marginBottom: 14 }}>Últimos proyectos</h2>
      {recent.length === 0 ? (
        <div className="empty">
          Aún no hay proyectos. Crea el primero con <b>Nuevo Proyecto</b>.
        </div>
      ) : (
        <div className="cards">
          {recent.map((o) => (
            <div className="card clickable" key={o.id} onClick={() => onOpen(o.id)}>
              <div className="card-title">{o.obra || '(sin nombre)'}</div>
              <div className="card-sub">{o.cliente || '—'}</div>
              <div className="card-meta">
                <span>
                  Ensayos: <b>{o.n_ensayos}</b>
                </span>
                <span>
                  Importe: <b>{eur(o.total_importe)}</b>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
