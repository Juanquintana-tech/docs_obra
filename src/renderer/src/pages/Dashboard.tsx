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

export function Dashboard(): JSX.Element {
  const navigate = useNavigate()
  const [stats, setStats] = useState<GlobalStats | null>(null)
  const [recent, setRecent] = useState<Obra[] | null>(null)
  const [counts, setCounts] = useState<Record<number, number>>({})

  useEffect(() => {
    api.getGlobalStats().then(setStats)
    api.getObras('activa').then((o) => setRecent(o.slice(0, 6)))
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
            <div className="kpi">
              <div className="label">Ensayos planificados</div>
              <div className="value">{stats.n_ensayos}</div>
            </div>
            <div className="kpi">
              <div className="label">Informes de campo</div>
              <div className="value">{Object.values(counts).reduce((a, b) => a + b, 0)}</div>
            </div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '20px 0 14px' }}>
        <h2>Últimos proyectos activos</h2>
        <button className="btn btn-primary" onClick={() => navigate('/nueva')}>
          <Ic.NuevoProyecto /> Nuevo Proyecto
        </button>
      </div>
      {recent === null ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-row" />)}
        </div>
      ) : recent.length === 0 ? (
        <div className="empty">
          Aún no hay proyectos. Crea el primero con <b>Nuevo Proyecto</b>.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {recent.map((o) => (
            <div
              key={o.id}
              className="obra-row"
              onClick={() => navigate('/detalle/' + o.id)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate('/detalle/' + o.id)}
            >
              <div
                className="obra-avatar"
                style={{ background: avatarColor(o.id) }}
              >
                {initials(o.obra)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 600,
                    fontSize: 14,
                    color: 'var(--navy)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {o.obra || '(sin nombre)'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-soft)', marginTop: 2 }}>
                  {o.cliente || '—'} · Ref. {o.ref_lab || '—'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20, fontSize: 13, flexShrink: 0 }}>
                <span>
                  <span style={{ color: 'var(--text-soft)' }}>Ensayos </span>
                  <b>{o.n_ensayos}</b>
                </span>
                <span>
                  <span style={{ color: 'var(--text-soft)' }}>Informes </span>
                  <b>{counts[o.id] ?? 0}</b>
                </span>
                <span style={{ fontWeight: 700 }}>{eur(o.total_importe)}</span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn"
                  style={{ fontSize: 12, padding: '5px 10px' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    navigate('/ensayos/' + o.id)
                  }}
                >
                  <Ic.Ensayos /> Ensayos
                </button>
                <span
                  style={{
                    color: 'var(--border)',
                    fontSize: 18,
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  ›
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
