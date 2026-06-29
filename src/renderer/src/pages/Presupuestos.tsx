/**
 * Página Presupuestos — catálogo KB editable y reglas de ensayo.
 */
import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { api } from '../lib/api'
import { Ic } from '../components/Icon'
import { eur } from '../lib/format'
import type { Rules, CategoryRule, TestRule } from '../../../main/pipeline/planner'

interface KbCatalogRow {
  testId: string
  canonicalDesc: string
  origin: 'alagal' | 'cye'
  section: string | null
  priceTarifaCye: number | null
  pricePricebook: number | null
  priceAlagal: number | null
  hasOverride: boolean
  isNew: boolean
  disabled: boolean
}

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
          <p>Catálogo editable de ensayos y reglas que alimentan el motor de presupuestos</p>
        </div>
      </div>

      <div className="tab-bar">
        <button
          className={`tab-btn${tab === 'catalog' ? ' active' : ''}`}
          onClick={() => setTab('catalog')}
        >
          <Ic.Catalog /> Catálogo de ensayos
        </button>
        <button
          className={`tab-btn${tab === 'rules' ? ' active' : ''}`}
          onClick={() => setTab('rules')}
        >
          <Ic.Rules /> Reglas de ensayo
        </button>
      </div>

      {tab === 'catalog' && <CatalogTab />}
      {tab === 'rules' && <RulesTab />}
    </div>
  )
}

// ── Tab: Catálogo de ensayos (KB editable) ────────────────────────────────────

const EMPTY_NEW: Partial<KbCatalogRow> = { testId: '', canonicalDesc: '', priceTarifaCye: null, section: null }

function CatalogTab(): JSX.Element {
  const [entries, setEntries] = useState<KbCatalogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [originFilter, setOriginFilter] = useState<'' | 'cye' | 'alagal'>('')
  const [showDisabled, setShowDisabled] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBuf, setEditBuf] = useState<{ desc: string; price: string }>({ desc: '', price: '' })
  const [newRow, setNewRow] = useState<Partial<KbCatalogRow> | null>(null)
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const newRowRef = useRef<HTMLTableRowElement>(null)

  const load = (): void => {
    setLoading(true)
    api.getCatalogTests()
      .then((rows) => setEntries(rows as KbCatalogRow[]))
      .catch(() => setEntries([]))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const sections = useMemo(
    () => [...new Set(entries.map((e) => e.section).filter(Boolean))].sort() as string[],
    [entries]
  )

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return entries.filter((e) => {
      if (!showDisabled && e.disabled) return false
      if (originFilter && e.origin !== originFilter) return false
      if (!term) return true
      return e.testId.toLowerCase().includes(term) || e.canonicalDesc.toLowerCase().includes(term)
    })
  }, [entries, q, originFilter, showDisabled])

  function flash(text: string, ok = true): void {
    setMsg({ text, ok })
    setTimeout(() => setMsg(null), 3500)
  }

  function startEdit(row: KbCatalogRow): void {
    setEditingId(row.testId)
    setEditBuf({ desc: row.canonicalDesc, price: row.priceTarifaCye != null ? String(row.priceTarifaCye) : '' })
  }

  async function saveEdit(row: KbCatalogRow): Promise<void> {
    const price = editBuf.price.trim() === '' ? null : parseFloat(editBuf.price.replace(',', '.'))
    await api.upsertCatalogOverride({
      test_id: row.testId,
      canonical_desc: editBuf.desc.trim() || row.canonicalDesc,
      price_tarifa_cye: price != null && !isNaN(price) ? price : null,
      disabled: 0,
      is_new: row.isNew ? 1 : 0,
      category_code: row.section ?? ''
    })
    setEditingId(null)
    load()
    flash('Cambio guardado. El próximo presupuesto usará los valores actualizados.')
  }

  async function resetOverride(testId: string): Promise<void> {
    await api.deleteCatalogOverride(testId)
    load()
    flash('Override eliminado — se usa el valor base de la KB.')
  }

  async function toggleDisable(row: KbCatalogRow): Promise<void> {
    if (row.disabled) {
      await api.deleteCatalogOverride(row.testId)
      flash('Ensayo reactivado.')
    } else {
      await api.upsertCatalogOverride({
        test_id: row.testId,
        canonical_desc: row.canonicalDesc,
        price_tarifa_cye: row.priceTarifaCye ?? null,
        disabled: 1,
        is_new: row.isNew ? 1 : 0,
        category_code: row.section ?? ''
      })
      flash('Ensayo deshabilitado — no aparecerá en futuros presupuestos.', false)
    }
    load()
  }

  async function saveNew(): Promise<void> {
    if (!newRow?.testId?.trim() || !newRow?.canonicalDesc?.trim()) return
    await api.upsertCatalogOverride({
      test_id: newRow.testId!.trim().toUpperCase(),
      canonical_desc: newRow.canonicalDesc!.trim(),
      price_tarifa_cye: newRow.priceTarifaCye ?? null,
      disabled: 0,
      is_new: 1,
      category_code: newRow.section ?? ''
    })
    setNewRow(null)
    load()
    flash('Nuevo ensayo añadido al catálogo.')
  }

  if (loading) return <div className="empty">Cargando catálogo…</div>

  const tdSoft: React.CSSProperties = { fontSize: 12, color: 'var(--text-soft)' }
  const tdMono: React.CSSProperties = { fontFamily: 'monospace', fontSize: 12 }

  return (
    <div>
      {msg && (
        <div className={`banner ${msg.ok ? 'banner-ok' : 'banner-warn'}`} style={{ marginBottom: 12 }}>
          {msg.text}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Buscar por código o descripción…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className="select" value={originFilter} onChange={(e) => setOriginFilter(e.target.value as '' | 'cye' | 'alagal')}>
          <option value="">Todos los orígenes</option>
          <option value="cye">Solo CYE</option>
          <option value="alagal">Solo ALAGAL</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
          Mostrar deshabilitados
        </label>
        <span style={tdSoft}>{filtered.length} de {entries.filter(e => showDisabled || !e.disabled).length}</span>
        <button
          className="btn btn-secondary"
          onClick={() => { setNewRow({ ...EMPTY_NEW }); setTimeout(() => newRowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50) }}
        >
          + Nuevo ensayo
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="plan-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>Código</th>
              <th style={{ textAlign: 'left' }}>Descripción</th>
              <th style={{ width: 90 }}>Origen</th>
              <th style={{ width: 105, textAlign: 'right' }}>Tarifa CYE</th>
              <th style={{ width: 95, textAlign: 'right' }}>Histórico</th>
              <th style={{ width: 95, textAlign: 'right' }}>ALAGAL</th>
              <th style={{ width: 120, textAlign: 'center' }}>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 600).map((row) => {
              const isEditing = editingId === row.testId
              const rowStyle: React.CSSProperties = row.disabled
                ? { opacity: 0.45, background: 'var(--bg-soft, #f6f8fb)' }
                : row.hasOverride ? { background: '#f0f7ff' } : {}
              return (
                <tr key={row.testId} style={rowStyle}>
                  <td style={tdMono}>
                    {row.testId}
                    {row.hasOverride && <span title="Override activo" style={{ color: '#4a7fd4', fontSize: 10, marginLeft: 3 }}>✦</span>}
                    {row.isNew && <span title="Creado por el usuario" style={{ color: '#16a34a', fontSize: 10, marginLeft: 3 }}>★</span>}
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    {isEditing
                      ? <input className="plan-input plan-input-desc" style={{ width: '100%' }} value={editBuf.desc} onChange={(e) => setEditBuf((b) => ({ ...b, desc: e.target.value }))} />
                      : row.canonicalDesc}
                  </td>
                  <td style={tdSoft}>{row.origin}</td>
                  <td className="num">
                    {isEditing
                      ? <input className="plan-input plan-input-price" style={{ width: 80 }} placeholder="€/ud" value={editBuf.price} onChange={(e) => setEditBuf((b) => ({ ...b, price: e.target.value }))} />
                      : row.priceTarifaCye != null ? eur(row.priceTarifaCye) : <span style={tdSoft}>—</span>}
                  </td>
                  <td className="num" style={tdSoft}>{row.pricePricebook != null ? eur(row.pricePricebook) : '—'}</td>
                  <td className="num" style={tdSoft}>{row.priceAlagal != null ? eur(row.priceAlagal) : '—'}</td>
                  <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {isEditing ? (
                      <>
                        <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => saveEdit(row)}>✓</button>
                        {' '}
                        <button className="btn" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => setEditingId(null)}>✕</button>
                      </>
                    ) : (
                      <>
                        <button className="btn" style={{ padding: '3px 8px', fontSize: 12 }} title="Editar" onClick={() => startEdit(row)}>✎</button>
                        {' '}
                        {row.hasOverride && (
                          <button className="btn" style={{ padding: '3px 8px', fontSize: 12, color: 'var(--text-soft)' }} title="Restablecer a valor base" onClick={() => resetOverride(row.testId)}>↺</button>
                        )}
                        {' '}
                        <button
                          className="btn"
                          style={{ padding: '3px 8px', fontSize: 12, color: row.disabled ? 'var(--ok, #16a34a)' : 'var(--danger, #e53e3e)' }}
                          title={row.disabled ? 'Reactivar' : 'Deshabilitar'}
                          onClick={() => toggleDisable(row)}
                        >
                          {row.disabled ? '▶' : '⊘'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
            {newRow !== null && (
              <tr ref={newRowRef} style={{ background: '#f0fff4' }}>
                <td>
                  <input className="plan-input" style={{ width: 80, fontFamily: 'monospace', fontSize: 12 }} placeholder="U-XXXX" value={newRow.testId ?? ''} onChange={(e) => setNewRow((r) => ({ ...r, testId: e.target.value }))} />
                </td>
                <td>
                  <input className="plan-input plan-input-desc" style={{ width: '100%' }} placeholder="Descripción del ensayo (obligatorio)" value={newRow.canonicalDesc ?? ''} onChange={(e) => setNewRow((r) => ({ ...r, canonicalDesc: e.target.value }))} />
                </td>
                <td style={tdSoft}>cye</td>
                <td>
                  <input className="plan-input plan-input-price" style={{ width: 80 }} placeholder="€/ud" value={newRow.priceTarifaCye != null ? String(newRow.priceTarifaCye) : ''} onChange={(e) => setNewRow((r) => ({ ...r, priceTarifaCye: parseFloat(e.target.value.replace(',', '.')) || null }))} />
                </td>
                <td /><td />
                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: 12 }} disabled={!newRow.testId?.trim() || !newRow.canonicalDesc?.trim()} onClick={saveNew}>✓</button>
                  {' '}
                  <button className="btn" style={{ padding: '3px 8px', fontSize: 12 }} onClick={() => setNewRow(null)}>✕</button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {filtered.length > 600 && (
          <div style={{ padding: 12, textAlign: 'center', ...tdSoft }}>
            Mostrando 600 de {filtered.length}. Usa el buscador para filtrar.
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

  function setTestField(
    cat: string,
    testIdx: number,
    field: keyof TestRule,
    val: string
  ): void {
    if (!rules) return
    const newRules = JSON.parse(JSON.stringify(rules)) as Rules
    if (!newRules[cat]?.tests?.[testIdx]) return
    const numFields: (keyof TestRule)[] = ['freq_qty', 'tests_per_lot', 'unit_price']
    const entry = newRules[cat].tests![testIdx] as unknown as Record<string, unknown>
    if (numFields.includes(field)) {
      const n = parseFloat(val.replace(',', '.'))
      entry[field] = isNaN(n) ? 0 : n
    } else {
      entry[field] = val
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
          {saving ? 'Guardando…' : <><Ic.Save /> Guardar cambios</>}
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
                        <th style={{ width: 80 }}>Freq. qty</th>
                        <th style={{ width: 110 }}>Freq. unit</th>
                        <th style={{ width: 90 }}>Ens./lote</th>
                        <th style={{ width: 110 }}>Precio base (€)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tests.map((test: TestRule, i: number) => (
                        <tr key={i}>
                          <td style={{ textAlign: 'left', fontSize: 13 }}>{test.description}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="input"
                              style={{ width: 70, padding: '4px 8px', fontSize: 13, textAlign: 'right' }}
                              value={test.freq_qty ?? ''}
                              onChange={(e) => setTestField(cat, i, 'freq_qty', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="input"
                              style={{ width: 100, padding: '4px 8px', fontSize: 13 }}
                              value={test.freq_unit ?? ''}
                              onChange={(e) => setTestField(cat, i, 'freq_unit', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={1}
                              className="input"
                              style={{ width: 70, padding: '4px 8px', fontSize: 13, textAlign: 'right' }}
                              value={test.tests_per_lot ?? ''}
                              onChange={(e) => setTestField(cat, i, 'tests_per_lot', e.target.value)}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              step={0.01}
                              className="input"
                              style={{ width: 90, padding: '4px 8px', fontSize: 13, textAlign: 'right' }}
                              value={test.unit_price ?? 0}
                              onChange={(e) => setTestField(cat, i, 'unit_price', e.target.value)}
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
