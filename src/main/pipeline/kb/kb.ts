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
