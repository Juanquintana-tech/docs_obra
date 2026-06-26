/**
 * Motor determinista de valoración (Etapa 2, modelo "por lote", branch Cye_BBDD).
 *
 * Entrada: mediciones por tramo/sección (categoría, cantidad, unidad, ± superficie/longitud/altura/capa).
 * Salida:  PlanLine[] con procedencia auditable, precio y flags de fallback.
 *
 * Jerarquía de frecuencia (decidida 2026-06-26):
 *   1) NORMATIVA (normative_rules.json) — autoridad; modelo por lote / escalones.
 *   2) PRESUPUESTO CYE (frequency_rules.json) — rellena ensayos sin regla normativa.
 * El precio SIEMPRE de la BBDD (tarifa_cye > pricebook > alagal). SIN LLM, determinista.
 */
import type { KbFrequencyRule } from './types'
import { type Kb, effectivePrice, VOLUME_THRESHOLD } from './kb'
import { type NormativeRule } from './normative'
import { computeRule, type LotSection } from './lotEngine'

export interface SectionInput {
  tramo?: string | null
  categoryCode: string
  material?: string | null
  quantity: number | null
  unit: string | null
  surface_m2?: number | null
  length_m?: number | null
  heightGe5m?: boolean | null
  capa?: 'rodadura' | 'intermedia' | 'base' | null
}

export interface Provenance {
  kind: 'normativa' | 'presupuesto'
  source: string // artículo normativo o "presupuesto CYE (histórico)"
  control?: string // fabricacion | recepcion | ejecucion
  detail?: string // cómo se calculó el nº de ensayos
  priceSource: 'tarifa_cye' | 'pricebook' | 'alagal' | 'fallback'
  matchConfidence: number
}

export interface PlanLine {
  tramo: string | null
  testId: string | null
  description: string
  categoryCode: string
  nTests: number
  unitPrice: number | null
  total: number | null
  provenance: Provenance
  needsReview: boolean
}

export interface GenerateResult {
  lines: PlanLine[]
  totalBase: number
  warnings: string[]
}

const ASPHALT_DENSITY = 2.4 // t/m³, para estimar volumen de MBC desde tonelaje

function normUnit(u: string | null): string {
  return (u ?? '').trim().toLowerCase().replace('³', '3').replace('²', '2').replace(/\s+/g, '')
}

/** Deriva las magnitudes físicas (m³, t, m², m) de la medición principal + datos extra. */
function toLotSection(s: SectionInput): LotSection {
  const u = normUnit(s.unit)
  const q = s.quantity ?? null
  const isMBC = s.categoryCode === 'MEZCLA_BITUMINOSA'
  let volume_m3: number | null = u === 'm3' ? q : null
  const tonnage_t: number | null = u === 't' || u === 'tm' ? q : null
  if (volume_m3 == null && isMBC && tonnage_t != null) volume_m3 = tonnage_t / ASPHALT_DENSITY
  return {
    categoryCode: s.categoryCode,
    volume_m3,
    tonnage_t,
    surface_m2: s.surface_m2 ?? (u === 'm2' ? q : null),
    length_m: s.length_m ?? (u === 'm' || u === 'ml' ? q : null),
    heightGe5m: s.heightGe5m ?? null,
    capa: s.capa ?? null,
  }
}

/** Escalón de frecuencia para gap-fill per_quantity: usa los tiers observados y el volumen. */
function pickFreqQty(rule: KbFrequencyRule, volume: number): number {
  const tiers = rule.qtyTiers && rule.qtyTiers.length ? rule.qtyTiers : rule.freqQty != null ? [rule.freqQty] : []
  if (tiers.length <= 1) return tiers[0] ?? 0
  const target = volume > VOLUME_THRESHOLD ? 10_000 : 5_000
  return tiers.reduce((best, t) => (Math.abs(t - target) < Math.abs(best - target) ? t : best))
}

/** Gap-fill: nº de ensayos para un ensayo del presupuesto sin regla normativa. */
function budgetTests(rule: KbFrequencyRule, lot: LotSection): { nTests: number; detail: string; review: boolean } {
  const muestreo = rule.muestreo && rule.muestreo > 0 ? rule.muestreo : 1
  // per_quantity: ensayos de identificación/material por volumen (escalón observado).
  if (rule.freqKind === 'per_quantity' && lot.volume_m3 != null) {
    const freqQty = pickFreqQty(rule, lot.volume_m3)
    if (freqQty > 0) {
      const n = Math.max(1, Math.ceil(lot.volume_m3 / freqQty) * muestreo)
      return { nTests: n, detail: `${Math.round(lot.volume_m3).toLocaleString('es-ES')}/${freqQty} (inferida)`, review: false }
    }
  }
  // per_lot: "1 por N lotes" — derivada de otro control; sin la referencia, no se infla por volumen.
  if (rule.freqKind === 'per_lot') {
    return { nTests: muestreo, detail: `${rule.freqUnit} (derivada de lotes — revisar)`, review: true }
  }
  if (rule.freqKind === 'per_type' || rule.freqKind === 'per_element' || rule.freqKind === 'fixed') {
    return { nTests: muestreo, detail: `${rule.freqUnit} (inferida)`, review: false }
  }
  return { nTests: muestreo, detail: `${rule.freqUnit} (inferida, revisar)`, review: true }
}

export function generatePlan(
  sections: SectionInput[],
  kb: Kb,
  normByCat: Map<string, NormativeRule[]>
): GenerateResult {
  const lines: PlanLine[] = []
  const warnings: string[] = []

  for (const section of sections) {
    const lot = toLotSection(section)
    const tramo = section.tramo ?? null
    const cat = section.categoryCode
    const covered = new Set<string>()

    // 1) Reglas normativas (autoridad de frecuencia)
    const normRules = (normByCat.get(cat) ?? []).filter((r) => r.controlType !== 'material_acceptance')
    for (const rule of normRules) {
      for (const nl of computeRule(lot, rule)) {
        const m = kb.matchTest(nl.test)
        const testId = m?.testId ?? null
        const priced = testId ? effectivePrice(kb, testId) : null
        if (testId) covered.add(testId)
        const unitPrice = priced?.price ?? null
        const total = unitPrice != null ? Math.round(nl.nTests * unitPrice * 100) / 100 : null
        lines.push({
          tramo, testId, description: testId ? kb.tests.get(testId)!.canonicalDesc : nl.test, categoryCode: cat,
          nTests: nl.nTests, unitPrice, total,
          provenance: { kind: 'normativa', source: rule.source, control: rule.controlType, detail: nl.detail, priceSource: priced?.source ?? 'fallback', matchConfidence: m?.confidence ?? 0 },
          needsReview: nl.review || nl.nTests === 0 || unitPrice == null,
        })
      }
    }

    // 2) Gap-fill: ensayos del presupuesto CYE sin regla normativa
    for (const br of kb.rulesByCategory.get(cat) ?? []) {
      if (covered.has(br.testId)) continue
      const { nTests, detail, review } = budgetTests(br, lot)
      const priced = effectivePrice(kb, br.testId)
      const unitPrice = priced?.price ?? null
      const total = unitPrice != null ? Math.round(nTests * unitPrice * 100) / 100 : null
      lines.push({
        tramo, testId: br.testId, description: kb.tests.get(br.testId)?.canonicalDesc ?? br.rawDesc, categoryCode: cat,
        nTests, unitPrice, total,
        provenance: { kind: 'presupuesto', source: 'presupuesto CYE (histórico)', detail, priceSource: priced?.source ?? 'fallback', matchConfidence: 1 },
        needsReview: review || unitPrice == null,
      })
    }

    if (normRules.length === 0 && !(kb.rulesByCategory.get(cat)?.length)) {
      warnings.push(`Sin reglas (normativa ni presupuesto) para categoría "${cat}" (tramo ${tramo ?? '—'})`)
    }
  }

  const totalBase = Math.round(lines.reduce((a, l) => a + (l.total ?? 0), 0) * 100) / 100
  return { lines, totalBase, warnings }
}
