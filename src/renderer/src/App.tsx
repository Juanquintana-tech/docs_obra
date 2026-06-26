import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { JSX } from 'react'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './pages/Dashboard'
import { Proyectos } from './pages/Proyectos'
import { NuevaObra } from './pages/NuevaObra'
import { Detalle } from './pages/Detalle'
import { Ensayos } from './pages/Ensayos'
import { Radon } from './pages/Radon'
import { Presupuestos } from './pages/Presupuestos'
import { ValidacionRag } from './pages/ValidacionRag'
import { BBDDPlan } from './pages/BBDDPlan'

function App(): JSX.Element {
  return (
    <MemoryRouter initialEntries={['/']} initialIndex={0}>
      <div className="app">
        <Sidebar />
        <main className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/proyectos" element={<Proyectos />} />
            <Route path="/nueva" element={<NuevaObra />} />
            <Route path="/detalle/:obraId" element={<Detalle />} />
            <Route path="/ensayos" element={<Ensayos />} />
            <Route path="/ensayos/:obraId" element={<Ensayos />} />
            <Route path="/radon" element={<Radon />} />
            <Route path="/presupuestos" element={<Presupuestos />} />
            <Route path="/validacion" element={<ValidacionRag />} />
            <Route path="/bbdd" element={<BBDDPlan />} />
          </Routes>
        </main>
      </div>
    </MemoryRouter>
  )
}

export default App
