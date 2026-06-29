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
      { path: '/radon', label: 'Radón', ico: <Ic.Radon /> },
      { path: '/presupuestos', label: 'Presupuestos', ico: <Ic.Presupuestos /> }
    ]
  }
]

const TOOLS: NavDef[] = [
  {
    section: 'Herramientas',
    items: [
      { path: '/bbdd', label: 'Presupuesto BBDD', ico: <Ic.Upload /> }
    ]
  }
]

function isActive(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/') return currentPath === '/'
  return currentPath === itemPath || currentPath.startsWith(itemPath + '/')
}

function NavGroup({
  group,
  currentPath,
  onNavigate,
  extraClass = ''
}: {
  group: NavDef
  currentPath: string
  onNavigate: (path: string) => void
  extraClass?: string
}): JSX.Element {
  return (
    <div>
      <div className="nav-section">{group.section}</div>
      {group.items.map((it) => (
        <button
          key={it.path}
          className={`nav-item${extraClass}${isActive(it.path, currentPath) ? ' active' : ''}`}
          onClick={() => onNavigate(it.path)}
        >
          <span className="ico">{it.ico}</span>
          {it.label}
        </button>
      ))}
    </div>
  )
}

export function Sidebar(): JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <aside className="sidebar">
      <div className="brand">
        <CyeLogo />
      </div>

      {NAV.map((g) => (
        <NavGroup key={g.section} group={g} currentPath={pathname} onNavigate={navigate} />
      ))}

      <div className="sidebar-spacer" />

      {TOOLS.map((g) => (
        <NavGroup key={g.section} group={g} currentPath={pathname} onNavigate={navigate} extraClass=" nav-item-tool" />
      ))}
    </aside>
  )
}
