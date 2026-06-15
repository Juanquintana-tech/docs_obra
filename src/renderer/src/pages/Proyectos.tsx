import { useEffect, useMemo, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import type { Obra } from '../lib/types'

interface Props {
  onOpen: (id: number) => void
  onNew: () => void
}

export function Proyectos({ onOpen, onNew }: Props): JSX.Element {
  const [obras, setObras] = useState<Obra[]>([])
  const [filter, setFilter] = useState<'activa' | 'archivada'>('activa')
  const [q, setQ] = useState('')

  useEffect(() => {
    api.getObras(filter).then(setObras)
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
              <div className="row">
                <span className="card-title">{o.obra || '(sin nombre)'}</span>
                <span className="spacer" />
                <span className={`badge badge-${o.status}`}>{o.status}</span>
              </div>
              <div className="card-sub">{o.cliente || '—'}</div>
              <div className="card-meta">
                <span>
                  Ensayos: <b>{o.n_ensayos}</b>
                </span>
                <span>
                  Materiales: <b>{o.n_materiales}</b>
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
