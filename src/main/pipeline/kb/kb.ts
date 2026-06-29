/**
 * Cargador de la BBDD curada en memoria (branch Cye_BBDD).
 *
 * Lee los JSON curados (fuente de verdad, versionados) y los indexa para el
 * motor determinista. Sin dependencias nativas → puro y testeable bajo tsx.
 *
 * (kb.sqlite es un artefacto derivado para exploración/agente; el motor usa esto.)
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { normalize } from '../rag/normalize'
import { extractNormCodes } from '../rag/normCodes'
import type { KbTest, KbPrice, KbCategory, KbFrequencyRule } from './types'

export interface TestMatch {
  testId: string
  confidence: number
}

export interface KbCatalogOverride {
  testId: string
  canonicalDesc?: string | null
  priceTarifaCye?: number | null
  disabled?: boolean
  isNew?: boolean
  categoryCode?: string | null
}

export interface Kb {
  tests: Map<string, KbTest>
  /** test_id → precios por fuente (tarifa_cye / alagal / pricebook). */
  pricesByTest: Map<string, KbPrice[]>
  /** categoría → reglas de frecuencia (ya deduplicadas: 1 regla por ensayo). */
  rulesByCategory: Map<string, KbFrequencyRule[]>
  categories: Map<string, KbCategory>
  /** Empareja una descripción libre con el ensayo canónico (código de norma + solape de texto). */
  matchTest(desc: string): TestMatch | null
}

function readJson<T>(path: string, key: string): T[] {
  if (!existsSync(path)) throw new Error(`Falta ${path} — ejecuta kb:import-alagal y kb:import-cye`)
  return (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, T[]>)[key] ?? []
}

/** Umbral de volumen (m3) que separa el escalón de frecuencia (≤ → 1/5.000, > → 1/10.000). */
export const VOLUME_THRESHOLD = 500_000

/**
 * Colapsa todas las reglas de un (categoría, ensayo) en una sola, eligiendo el "tipo
 * de frecuencia primario" (el que acumula más `sources`). Si es per_quantity, conserva
 * en `qtyTiers` todas las frecuencias observadas (p.ej. [5000, 10000]) para que el motor
 * elija el escalón según el volumen de la sección.
 */
function collapseRules(rules: KbFrequencyRule[]): KbFrequencyRule {
  // Suma de sources por tipo de frecuencia → tipo primario.
  const byKind = new Map<string, KbFrequencyRule[]>()
  for (const r of rules) {
    if (!byKind.has(r.freqKind)) byKind.set(r.freqKind, [])
    byKind.get(r.freqKind)!.push(r)
  }
  let primary: KbFrequencyRule[] = []
  let bestSources = -1
  for (const group of byKind.values()) {
    const s = group.reduce((a, r) => a + r.sources, 0)
    if (s > bestSources) { bestSources = s; primary = group }
  }
  // Representante: el de más sources dentro del tipo primario.
  const rep = [...primary].sort((a, b) => b.sources - a.sources)[0]
  if (rep.freqKind === 'per_quantity' || rep.freqKind === 'per_lot') {
    const tiers = [...new Set(primary
      .filter((r) => r.freqMagUnit === rep.freqMagUnit && r.freqQty != null)
      .map((r) => r.freqQty as number))].sort((a, b) => a - b)
    return { ...rep, qtyTiers: tiers.length ? tiers : rep.freqQty != null ? [rep.freqQty] : [] }
  }
  return rep
}

export function loadKb(
  curatedDir = resolve(process.cwd(), 'resources/knowledge/curated'),
  overrides: KbCatalogOverride[] = []
): Kb {
  const alagalPath = resolve(curatedDir, 'alagal_catalog.json')
  const alagal = JSON.parse(readFileSync(alagalPath, 'utf-8')) as { tests: KbTest[]; prices: KbPrice[] }
  const cyeTests = readJson<KbTest>(resolve(curatedDir, 'cye_tests.json'), 'tests')
  const cyePrices = readJson<KbPrice>(resolve(curatedDir, 'cye_prices.json'), 'prices')
  const rules = readJson<KbFrequencyRule>(resolve(curatedDir, 'frequency_rules.json'), 'rules')

  const tests = new Map<string, KbTest>()
  for (const t of [...alagal.tests, ...cyeTests]) tests.set(t.id, t)

  const pricesByTest = new Map<string, KbPrice[]>()
  for (const p of [...alagal.prices, ...cyePrices]) {
    if (!pricesByTest.has(p.testId)) pricesByTest.set(p.testId, [])
    pricesByTest.get(p.testId)!.push(p)
  }

  // ── Aplicar overrides del usuario (catálogo editable) ────────────────────
  for (const ov of overrides) {
    if (ov.disabled) {
      tests.delete(ov.testId)
      pricesByTest.delete(ov.testId)
      continue
    }
    if (ov.isNew && ov.canonicalDesc) {
      tests.set(ov.testId, {
        id: ov.testId,
        canonicalDesc: ov.canonicalDesc,
        normCodes: [],
        alagalSection: ov.categoryCode ?? null,
        alagalCode: null,
        origin: 'cye'
      })
    } else if (ov.canonicalDesc) {
      const t = tests.get(ov.testId)
      if (t) tests.set(ov.testId, { ...t, canonicalDesc: ov.canonicalDesc })
    }
    if (ov.priceTarifaCye != null) {
      const ps = (pricesByTest.get(ov.testId) ?? []).filter((p) => p.source !== 'tarifa_cye')
      ps.unshift({ testId: ov.testId, source: 'tarifa_cye', price: ov.priceTarifaCye })
      pricesByTest.set(ov.testId, ps)
    }
  }

  // Reglas por categoría, colapsadas a una por ensayo (conservando escalones de frecuencia).
  const byCatTest = new Map<string, Map<string, KbFrequencyRule[]>>()
  for (const r of rules) {
    if (!byCatTest.has(r.categoryCode)) byCatTest.set(r.categoryCode, new Map())
    const m = byCatTest.get(r.categoryCode)!
    if (!m.has(r.testId)) m.set(r.testId, [])
    m.get(r.testId)!.push(r)
  }
  const rulesByCategory = new Map<string, KbFrequencyRule[]>()
  for (const [cat, m] of byCatTest) {
    rulesByCategory.set(cat, [...m.values()].map(collapseRules))
  }

  const categories = new Map<string, KbCategory>()
  const testRulesPath = resolve(process.cwd(), 'resources/knowledge/test_rules.json')
  if (existsSync(testRulesPath)) {
    const tr = JSON.parse(readFileSync(testRulesPath, 'utf-8')) as Record<string, { unit?: string; keywords?: string[] }>
    for (const [code, v] of Object.entries(tr)) {
      categories.set(code, { code, name: code.replace(/_/g, ' '), defaultUnit: v.unit ?? null, keywords: v.keywords ?? [] })
    }
  }

  // Índice para el emparejador (código de norma + tokens de descripción).
  // Aliases: descripción real de presupuesto → testId (para matching de queries cortas)
  const aliasesPath = resolve(curatedDir, 'aliases.json')
  const rawAliases = existsSync(aliasesPath)
    ? (JSON.parse(readFileSync(aliasesPath, 'utf-8')) as { aliases: { alias: string; testId: string }[] }).aliases
    : []
  // Por testId → lista de conjuntos de tokens de sus aliases
  const aliasTokensByTest = new Map<string, Set<string>[]>()
  for (const a of rawAliases) {
    const tokens = new Set(normalize(a.alias).split(/\s+/).filter((w) => w.length > 3))
    if (!aliasTokensByTest.has(a.testId)) aliasTokensByTest.set(a.testId, [])
    aliasTokensByTest.get(a.testId)!.push(tokens)
  }

  const byNorm = new Map<string, string[]>()
  const tokensByTest = new Map<string, Set<string>>()
  for (const t of tests.values()) {
    for (const c of extractNormCodes(t.canonicalDesc)) {
      if (!byNorm.has(c)) byNorm.set(c, [])
      byNorm.get(c)!.push(t.id)
    }
    tokensByTest.set(t.id, new Set(normalize(t.canonicalDesc).split(/\s+/).filter((w) => w.length > 3)))
  }
  const jaccard = (qTokens: Set<string>, testId: string): number => {
    const et = tokensByTest.get(testId)
    if (!et) return 0
    let inter = 0
    for (const w of qTokens) if (et.has(w)) inter++
    const union = new Set([...qTokens, ...et]).size
    return union ? inter / union : 0
  }
  // Cobertura alias: fracción de tokens de la query presentes en algún alias del ensayo.
  // Útil cuando la query es corta y Jaccard cae por denominador grande.
  const aliasCoverage = (qTokens: Set<string>, testId: string): number => {
    const sets = aliasTokensByTest.get(testId)
    if (!sets || qTokens.size === 0) return 0
    let best = 0
    for (const at of sets) {
      let inter = 0
      for (const w of qTokens) if (at.has(w)) inter++
      const cov = inter / qTokens.size
      if (cov > best) best = cov
    }
    return best
  }
  const matchTest = (desc: string): TestMatch | null => {
    const qTokens = new Set(normalize(desc).split(/\s+/).filter((w) => w.length > 3))
    const normCands = new Set<string>()
    for (const c of extractNormCodes(desc)) for (const id of byNorm.get(c) ?? []) normCands.add(id)
    if (normCands.size > 0) {
      let best = '', bestJ = -1
      for (const id of normCands) { const j = jaccard(qTokens, id); if (j > bestJ) { bestJ = j; best = id } }
      return { testId: best, confidence: Math.min(1, 0.7 + bestJ * 0.3) }
    }
    let best = '', bestJ = -1
    for (const id of tests.keys()) { const j = jaccard(qTokens, id); if (j > bestJ) { bestJ = j; best = id } }
    if (best && bestJ >= 0.4) return { testId: best, confidence: bestJ }

    // Fallback alias: busca el ensayo cuyas aliases cubren mejor la query corta.
    // Umbral 0.85: al menos 85% de los tokens de la query deben aparecer en el alias.
    let bestAlias = '', bestCov = 0
    for (const id of tests.keys()) {
      const cov = aliasCoverage(qTokens, id)
      if (cov > bestCov) { bestCov = cov; bestAlias = id }
    }
    return bestAlias && bestCov >= 0.85 ? { testId: bestAlias, confidence: bestCov * 0.65 } : null
  }

  return { tests, pricesByTest, rulesByCategory, categories, matchTest }
}

/** Precio efectivo de un ensayo: prioridad tarifa_cye > pricebook > alagal. */
export function effectivePrice(
  kb: Kb,
  testId: string
): { price: number; source: KbPrice['source'] } | null {
  const ps = kb.pricesByTest.get(testId)
  if (!ps || ps.length === 0) return null
  const order: KbPrice['source'][] = ['tarifa_cye', 'pricebook', 'alagal']
  for (const src of order) {
    const found = ps.find((p) => p.source === src)
    if (found) return { price: found.price, source: src }
  }
  return { price: ps[0].price, source: ps[0].source }
}
