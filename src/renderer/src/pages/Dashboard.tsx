import { useEffect, useState, type JSX } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import { Ic } from '../components/Icon'
import type { GlobalStats, Obra } from '../lib/types'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')
}

const AVATAR_COLORS = ['#1f3864', '#2e75b6', '#e36c09', '#10b981', '#7c3aed', '#d97706']
function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length]
}

type SortBy = 'reciente' | 'nombre' | 'importe' | 'ensayos'

function sortObras(obras: Obra[], by: SortBy): Obra[] {
  return [...obras].sort((a, b) => {
    if (by === 'nombre') return a.obra.localeCompare(b.obra, 'es')
    if (by === 'importe') return (b.total_importe ?? 0) - (a.total_importe ?? 0)
    if (by === 'ensayos') return (b.n_ensayos ?? 0) - (a.n_ensayos ?? 0)
    return b.id - a.id // reciente: mayor id primero
  })
}

export function Dashboard(): JSX.Element {
  const navigate = useNavigate()
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [recent, setRecent] = useState<Obra[] | null>(null)
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [sortBy, setSortBy] = useState<SortBy>('reciente')

  useEffect(() => {
    api.getGlobalStats().then(setStats)
    api.getObras().then(setRecent)
    api.countEnsayosPorObra().then(setCounts)
  }, [])

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Resumen de la actividad de control de calidad</p>
        </div>
      </div>

      <div className="kpis">
        {stats === null ? (
          <>
            <div className="skeleton skeleton-kpi" />
            <div className="skeleton skeleton-kpi" />
            <div className="skeleton skeleton-kpi" />
          </>
        ) : (
          <>
            <div className="kpi">
              <div className="label">Proyectos activos</div>
              <div className="value">{stats.n_obras}</div>
            </div>
            <div className="kpi kpi-mid">
              <div className="label">Ensayos planificados</div>
              <div className="value">{stats.n_ensayos}</div>
            </div>
            <div className="kpi kpi-ok">
              <div className="label">Informes de campo</div>
              <div className="value">{Object.values(counts).reduce((a, b) => a + b, 0)}</div>
            </div>
          </>
        )}
      </div>

      <div className="dash-list-header">
        <h2>Proyectos</h2>
        <div className="cluster">
          <div className="btn-group">
            {(['reciente', 'nombre', 'importe', 'ensayos'] as SortBy[]).map((opt) => (
              <button
                key={opt}
                className={'btn btn-sm' + (sortBy === opt ? ' btn-primary' : '')}
                onClick={() => setSortBy(opt)}
              >
                {opt === 'reciente' ? 'Más reciente' : opt === 'nombre' ? 'Nombre' : opt === 'importe' ? 'Importe' : 'Ensayos'}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={() => navigate('/nueva')}>
            <Ic.NuevoProyecto /> Nuevo Proyecto
          </button>
        </div>
      </div>
      {recent === null ? (
        <div className="stack-sm">
          {[1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-row" />)}
        </div>
      ) : recent.length === 0 ? (
        <div className="empty">
          Aún no hay proyectos. Crea el primero con <b>Nuevo Proyecto</b>.
        </div>
      ) : (
        <div className="stack-sm">
          {sortObras(recent, sortBy).map((o) => (
            <div
              key={o.id}
              className="obra-row"
              onClick={() => navigate('/detalle/' + o.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/detalle/' + o.id)}
            >
              <div className="obra-avatar" style={{ background: avatarColor(o.id) }}>
                {initials(o.obra)}
              </div>
              <div className="obra-row-body">
                <div className="obra-row-name">{o.obra || '(sin nombre)'}</div>
                <div className="obra-row-sub">
                  <span>{o.cliente || '—'} · Ref. {o.ref_lab || '—'}</span>
                  {o.status === 'archivada' && (
                    <span className="obra-row-badge">archivada</span>
                  )}
                </div>
              </div>
              <div className="obra-row-stats">
                <span><span className="muted">Ensayos </span><b>{o.n_ensayos}</b></span>
                <span><span className="muted">Informes </span><b>{counts[o.id] ?? 0}</b></span>
                <span style={{ fontWeight: 700 }}>{eur(o.total_importe)}</span>
              </div>
              <div className="obra-row-actions">
                <button
                  className="btn btn-sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate('/ensayos/' + o.id)
                  }}
                >
                  <Ic.Ensayos /> Ensayos
                </button>
                <span className="obra-row-chevron">
                  <Ic.ChevronRight size={18} />
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
