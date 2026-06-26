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
import type { KbTest, KbPrice, KbCategory, KbFrequencyRule } from './types'

export interface Kb {
  tests: Map<string, KbTest>
  /** test_id → precios por fuente (tarifa_cye / alagal / pricebook). */
  pricesByTest: Map<string, KbPrice[]>
  /** categoría → reglas de frecuencia (ya deduplicadas: 1 regla por ensayo). */
  rulesByCategory: Map<string, KbFrequencyRule[]>
  categories: Map<string, KbCategory>
}

function readJson<T>(path: string, key: string): T[] {
  if (!existsSync(path)) throw new Error(`Falta ${path} — ejecuta kb:import-alagal y kb:import-cye`)
  return (JSON.parse(readFileSync(path, 'utf-8')) as Record<string, T[]>)[key] ?? []
}

/**
 * Entre reglas que compiten para el mismo (categoría, ensayo) —p.ej. terraplén a
 * 1/5.000 m3 vs 1/10.000 m3 en distintos presupuestos— elige una representativa:
 * la respaldada por más presupuestos (`sources`); a igualdad, la más exigente
 * (menor freqQty = más ensayos = criterio conservador de control de calidad).
 */
function selectRule(a: KbFrequencyRule, b: KbFrequencyRule): KbFrequencyRule {
  if (a.sources !== b.sources) return a.sources > b.sources ? a : b
  const aq = a.freqQty ?? Infinity
  const bq = b.freqQty ?? Infinity
  return aq <= bq ? a : b
}

export function loadKb(curatedDir = resolve(process.cwd(), 'resources/knowledge/curated')): Kb {
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

  // Reglas por categoría, deduplicadas a una por ensayo.
  const byCatTest = new Map<string, Map<string, KbFrequencyRule>>()
  for (const r of rules) {
    if (!byCatTest.has(r.categoryCode)) byCatTest.set(r.categoryCode, new Map())
    const m = byCatTest.get(r.categoryCode)!
    const prev = m.get(r.testId)
    m.set(r.testId, prev ? selectRule(prev, r) : r)
  }
  const rulesByCategory = new Map<string, KbFrequencyRule[]>()
  for (const [cat, m] of byCatTest) rulesByCategory.set(cat, [...m.values()])

  const categories = new Map<string, KbCategory>()
  const testRulesPath = resolve(process.cwd(), 'resources/knowledge/test_rules.json')
  if (existsSync(testRulesPath)) {
    const tr = JSON.parse(readFileSync(testRulesPath, 'utf-8')) as Record<string, { unit?: string; keywords?: string[] }>
    for (const [code, v] of Object.entries(tr)) {
      categories.set(code, { code, name: code.replace(/_/g, ' '), defaultUnit: v.unit ?? null, keywords: v.keywords ?? [] })
    }
  }

  return { tests, pricesByTest, rulesByCategory, categories }
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
