import { useState, type JSX } from 'react'
import { Sidebar, type PageName } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { Proyectos } from './pages/Proyectos'
import { NuevaObra } from './pages/NuevaObra'
import { Detalle } from './pages/Detalle'
import { Ensayos } from './pages/Ensayos'
import { Presupuestos } from './pages/Presupuestos'
import { ValidacionRag } from './pages/ValidacionRag'

interface Route {
  page: PageName
  obraId?: number
}

function App(): JSX.Element {
  const [route, setRoute] = useState<Route>({ page: 'dashboard' })

  const go = (page: PageName, obraId?: number): void => setRoute({ page, obraId })
  const openObra = (id: number): void => setRoute({ page: 'detalle', obraId: id })

  return (
    <div className="app">
      <Sidebar current={route.page} onNavigate={(p) => go(p)} />
      <main className="content">
        {route.page === 'dashboard' && <Dashboard onOpen={openObra} onNew={() => go('nueva')} onEnsayos={(id) => go('ensayos', id)} />}
        {route.page === 'proyectos' && <Proyectos onOpen={openObra} onNew={() => go('nueva')} onEnsayos={(id) => go('ensayos', id)} />}
        {route.page === 'nueva' && <NuevaObra onSaved={openObra} />}
        {route.page === 'ensayos' && <Ensayos initialObraId={route.obraId} />}
        {route.page === 'presupuestos' && <Presupuestos />}
        {route.page === 'validacion' && <ValidacionRag />}
        {route.page === 'detalle' && route.obraId != null && (
          <Detalle
            obraId={route.obraId}
            onBack={() => go('proyectos')}
            onDeleted={() => go('proyectos')}
            onEnsayos={(id) => go('ensayos', id)}
          />
        )}
      </main>
    </div>
  )
}

export default App
