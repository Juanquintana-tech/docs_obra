import { useNavigate, useLocation } from 'react-router-dom'
import type { JSX, ReactNode } from 'react'
import { Ic } from './Icon'
import { CyeLogo } from './CyeLogo'

interface NavItem {
  path: string
  label: string
  ico: ReactNode
}

interface NavDef {
  section: string
  items: NavItem[]
}

const NAV: NavDef[] = [
  {
    section: 'Inicio',
    items: [{ path: '/', label: 'Dashboard', ico: <Ic.Dashboard /> }]
  },
  {
    section: 'Gestión',
    items: [{ path: '/proyectos', label: 'Proyectos', ico: <Ic.Proyectos /> }]
  },
  {
    section: 'Laboratorio',
    items: [
      { path: '/ensayos', label: 'Ensayos', ico: <Ic.Ensayos /> },
      { path: '/presupuestos', label: 'Presupuestos', ico: <Ic.Presupuestos /> }
    ]
  }
]

const TOOLS: NavDef[] = [
  {
    section: 'Herramientas',
    items: [{ path: '/validacion', label: 'Validación RAG', ico: <Ic.Validacion /> }]
  }
]

function isActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/')
}

export function Sidebar(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()

  function renderGroup(group: NavDef, extraClass = ''): JSX.Element {
    return (
      <div key={group.section}>
        <div className="nav-section">{group.section}</div>
        {group.items.map((it) => (
          <button
            key={it.path}
            className={`nav-item${extraClass}${isActive(it.path, location.pathname) ? ' active' : ''}`}
            onClick={() => navigate(it.path)}
          >
            <span className="ico">{it.ico}</span>
            {it.label}
          </button>
        ))}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <CyeLogo />
      </div>

      {NAV.map((g) => renderGroup(g))}

      <div className="sidebar-spacer" />

      {TOOLS.map((g) => renderGroup(g, ' nav-item-tool'))}
    </aside>
  )
}
