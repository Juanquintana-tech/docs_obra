import { useEffect, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { eur } from '../lib/format'
import type { RagMatch, RagStatus } from '../lib/types'

const THRESHOLD = 0.3

function scoreColor(score: number): string {
  if (score >= 0.6) return 'var(--ok)'
  if (score >= THRESHOLD) return 'var(--warn)'
  return 'var(--danger)'
}

export function ValidacionRag(): JSX.Element {
  const [status, setStatus] = useState<RagStatus | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [matches, setMatches] = useState<RagMatch[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.ragStatus().then(setStatus)
  }, [])

  async function search(): Promise<void> {
    if (!query.trim()) return
    setBusy(true)
    try {
      setMatches(await api.ragFindMatches(query, category || undefined, 8))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Validación del RAG</h1>
          <p>Comprueba a qué entrada del catálogo ALAGAL mapea cada ensayo y con qué confianza</p>
        </div>
      </div>

      {status && (
        <div
          className="banner banner-warn"
          style={{ background: 'var(--light)', color: 'var(--navy)' }}
        >
          Catálogo: <b>{status.size}</b> entradas con precio · Motor:{' '}
          <b>{status.usesEmbeddings ? 'híbrido (TF-IDF + embeddings)' : 'TF-IDF (léxico)'}</b>
          {!status.usesEmbeddings && ' · embeddings aún no activados'}
        </div>
      )}

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="row" style={{ alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 280, marginBottom: 0 }}>
            <label>Descripción del ensayo</label>
            <input
              className="input"
              placeholder="p. ej. Proctor Modificado UNE 103501"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Categoría (opcional)</label>
            <select
              className="select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">— ninguna —</option>
              {status?.categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={search} disabled={busy || !query.trim()}>
            {busy ? 'Buscando…' : '🔍 Buscar'}
          </button>
        </div>
      </div>

      {matches && (
        <>
          <p className="muted" style={{ marginBottom: 10 }}>
            {matches.length} resultados. Umbral de aceptación: {THRESHOLD} (por debajo → precio
            base).
          </p>
          {matches.length === 0 ? (
            <div className="empty">Sin coincidencias.</div>
          ) : (
            <table className="plan-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Entrada del catálogo</th>
                  <th>Código</th>
                  <th>Precio</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m, i) => (
                  <tr key={m.codigo + i}>
                    <td className="num">{i + 1}</td>
                    <td>{m.descripcion}</td>
                    <td className="num">{m.codigo}</td>
                    <td className="num">{eur(m.precio)}</td>
                    <td className="num">
                      <b style={{ color: scoreColor(m.score) }}>{(m.score * 100).toFixed(0)}%</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}
