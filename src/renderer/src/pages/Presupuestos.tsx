/**
 * Página Presupuestos — visualiza el catálogo ALAGAL y edita las reglas de ensayo.
 * Los cambios en las reglas se guardan en test_rules.json y se aplican al siguiente presupuesto.
 */
import { useEffect, useMemo, useState, type JSX } from 'react'
import { api } from '../lib/api'
import type { CatalogEntry } from '../../../main/pipeline/rag/catalog'
import type { Rules, CategoryRule, TestRule } from '../../../main/pipeline/planner'

const CAT_LABELS: Record<string, string> = {
  TERRAPLEN_RELLENOS: 'Terraplén y rellenos',
  ZAHORRA_ARTIFICIAL: 'Zahorra artificial',
  HORMIGON: 'Hormigón',
  ESCOLLERA: 'Escollera',
  SUELO_ESTABILIZADO: 'Suelo estabilizado',
  MEZCLA_BITUMINOSA: 'Mezcla bituminosa',
  ACERO: 'Acero'
}

// ── Componente principal ──────────────────────────────────────────────────────

export function Presupuestos(): JSX.Element {
  const [tab, setTab] = useState<'catalog' | 'rules'>('catalog')

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Presupuestos</h1>
          <p>Catálogo de tarifas ALAGAL y reglas de ensayo que alimentan el cálculo de precios</p>
        </div>
      </div>

      <div className="tab-bar">
        <button
          className={`tab-btn${tab === 'catalog' ? ' active' : ''}`}
          onClick={() => setTab('catalog')}
        >
          📋 Catálogo ALAGAL
        </button>
        <button
          className={`tab-btn${tab === 'rules' ? ' active' : ''}`}
          onClick={() => setTab('rules')}
        >
          ⚙️ Reglas de ensayo
        </button>
      </div>

      {tab === 'catalog' && <CatalogTab />}
      {tab === 'rules' && <RulesTab />}
    </div>
  )
}

// ── Tab: Catálogo ALAGAL ──────────────────────────────────────────────────────

function CatalogTab(): JSX.Element {
  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [catFilter, setCatFilter] = useState('')

  useEffect(() => {
    api
      .getCatalog()
      .then(setEntries)
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }, [])

  const categories = useMemo(() => {
    return [...new Set(entries.map((e) => e.categoria).filter(Boolean))].sort()
  }, [entries])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return entries.filter((e) => {
      const matchQ =
        !term || e.descripcion.toLowerCase().includes(term) || e.codigo.toLowerCase().includes(term)
      const matchCat = !catFilter || e.categoria === catFilter
      return matchQ && matchCat
    })
  }, [entries, q, catFilter])

  if (loading) return <div className="empty">Cargando catálogo…</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <input
          className="input"
          style={{ flex: 1 }}
          placeholder="Buscar por código o descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span style={{ color: 'var(--text-soft)', fontSize: 13, whiteSpace: 'nowrap' }}>
          {filtered.length} de {entries.length} entradas
        </span>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="plan-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Código</th>
              <th style={{ textAlign: 'left' }}>Descripción</th>
              <th style={{ width: 120 }}>Categoría</th>
              <th style={{ width: 90 }}>Precio (€)</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((e) => (
              <tr key={e.codigo}>
                <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.codigo}</td>
                <td style={{ textAlign: 'left' }}>{e.descripcion}</td>
                <td style={{ fontSize: 12, color: 'var(--text-soft)' }}>{e.categoria || '—'}</td>
                <td className="num" style={{ fontWeight: 600 }}>
                  {e.precio.toFixed(2).replace('.', ',')} €
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div
            style={{ padding: 12, textAlign: 'center', color: 'var(--text-soft)', fontSize: 13 }}
          >
            Mostrando 500 de {filtered.length} entradas. Usa el buscador para filtrar.
          </div>
        )}
      </div>
    </div>
  )
}

// ── Tab: Reglas de ensayo ─────────────────────────────────────────────────────

function RulesTab(): JSX.Element {
  const [rules, setRules] = useState<Rules | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [openCat, setOpenCat] = useState<string | null>(null)

  useEffect(() => {
    api.getRules().then((r) => {
      setRules(r)
      setDirty(false)
    })
  }, [])

  function setTestPrice(cat: string, testIdx: number, val: string): void {
    if (!rules) return
    const num = parseFloat(val.replace(',', '.'))
    const newRules = JSON.parse(JSON.stringify(rules)) as Rules
    if (newRules[cat]?.tests?.[testIdx]) {
      newRules[cat].tests![testIdx].unit_price = isNaN(num) ? 0 : num
    }
    setRules(newRules)
    setDirty(true)
  }

  async function save(): Promise<void> {
    if (!rules) return
    setSaving(true)
    try {
      await api.saveRules(rules)
      setDirty(false)
      setMsg('Reglas guardadas. El próximo presupuesto usará los precios actualizados.')
      setTimeout(() => setMsg(null), 4000)
    } catch (e) {
      setMsg(`Error al guardar: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  if (!rules) return <div className="empty">Cargando reglas…</div>

  const categories = Object.keys(rules)

  return (
    <div>
      {msg && (
        <div
          className="banner banner-ok"
          style={{ background: '#d1fae5', color: '#065f46', border: '1px solid #6ee7b7' }}
        >
          {msg}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          marginBottom: 14,
          gap: 10,
          alignItems: 'center'
        }}
      >
        {dirty && <span style={{ color: 'var(--warn)', fontSize: 13 }}>● Cambios sin guardar</span>}
        <button className="btn btn-primary" onClick={save} disabled={saving || !dirty}>
          {saving ? 'Guardando…' : '💾 Guardar cambios'}
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {categories.map((cat) => {
          const rule = rules[cat] as CategoryRule
          const label = CAT_LABELS[cat] ?? cat
          const isOpen = openCat === cat
          const tests = rule.tests ?? []
          return (
            <div key={cat} className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <button
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px 18px',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer'
                }}
                onClick={() => setOpenCat(isOpen ? null : cat)}
              >
                <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--navy)', flex: 1 }}>
                  {label}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                  {tests.length} ensayo(s) · unidad: {rule.unit ?? '—'}
                </span>
                <span style={{ color: 'var(--border)' }}>{isOpen ? '▲' : '▼'}</span>
              </button>

              {isOpen && tests.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                  <table className="plan-table" style={{ borderRadius: 0, boxShadow: 'none' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Descripción del ensayo</th>
                        <th style={{ width: 100 }}>Subcategoría</th>
                        <th style={{ width: 80 }}>Freq. qty</th>
                        <th style={{ width: 80 }}>Freq. unit</th>
                        <th style={{ width: 110 }}>Precio base (€)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tests.map((test: TestRule, i: number) => (
                        <tr key={i}>
                          <td style={{ textAlign: 'left', fontSize: 13 }}>{test.description}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-soft)' }}>
                            {test.subcategory ?? '—'}
                          </td>
                          <td style={{ fontSize: 12 }}>{test.freq_qty ?? '—'}</td>
                          <td style={{ fontSize: 12 }}>{test.freq_unit ?? '—'}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              className="input"
                              style={{
                                width: 90,
                                padding: '4px 8px',
                                fontSize: 13,
                                textAlign: 'right'
                              }}
                              value={test.unit_price ?? 0}
                              onChange={(e) => setTestPrice(cat, i, e.target.value)}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {isOpen && tests.length === 0 && (
                <div style={{ padding: '12px 18px', color: 'var(--text-soft)', fontSize: 13 }}>
                  Esta categoría no tiene ensayos definidos en las reglas.
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
