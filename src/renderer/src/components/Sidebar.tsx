import type { JSX } from 'react'

export type PageName =
  | 'dashboard'
  | 'proyectos'
  | 'nueva'
  | 'detalle'
  | 'ensayos'
  | 'presupuestos'
  | 'validacion'

interface NavDef {
  section: string
  items: { name: PageName; label: string; ico: string }[]
}

const NAV: NavDef[] = [
  { section: 'Inicio', items: [{ name: 'dashboard', label: 'Dashboard', ico: '📊' }] },
  {
    section: 'Gestión',
    items: [
      { name: 'proyectos', label: 'Proyectos', ico: '🏗️' },
      { name: 'nueva', label: 'Nuevo Proyecto', ico: '➕' }
    ]
  },
  {
    section: 'Laboratorio',
    items: [
      { name: 'ensayos', label: 'Ensayos', ico: '🧪' },
      { name: 'presupuestos', label: 'Presupuestos', ico: '💶' },
      { name: 'validacion', label: 'Validación RAG', ico: '🎯' }
    ]
  }
]

interface Props {
  current: PageName
  onNavigate: (p: PageName) => void
}

export function Sidebar({ current, onNavigate }: Props): JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        CYE
        <small>Control y Estudios</small>
      </div>
      {NAV.map((group) => (
        <div key={group.section}>
          <div className="nav-section">{group.section}</div>
          {group.items.map((it) => (
            <button
              key={it.name}
              className={`nav-item${current === it.name ? ' active' : ''}`}
              onClick={() => onNavigate(it.name)}
            >
              <span className="ico">{it.ico}</span>
              {it.label}
            </button>
          ))}
        </div>
      ))}
    </aside>
  )
}
