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
  // Tonelaje: directo (t/tm) o desde masa en kg (÷1000) para categorías por peso (acero…).
  const tonnage_t: number | null = u === 't' || u === 'tm' ? q : u === 'kg' && q != null ? q / 1000 : null
  if (volume_m3 == null && isMBC && tonnage_t != null) volume_m3 = tonnage_t * (1 / ASPHALT_DENSITY)
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

/** Escalón de frecuencia para gap-fill per_quantity (solo escalona por volumen m³). */
function pickFreqQty(rule: KbFrequencyRule, magnitude: number, isVolume: boolean): number {
  const tiers = rule.qtyTiers && rule.qtyTiers.length ? rule.qtyTiers : rule.freqQty != null ? [rule.freqQty] : []
  if (tiers.length <= 1 || !isVolume) return rule.freqQty ?? tiers[0] ?? 0
  const target = magnitude > VOLUME_THRESHOLD ? 10_000 : 5_000
  return tiers.reduce((best, t) => (Math.abs(t - target) < Math.abs(best - target) ? t : best))
}

/** Magnitud de la sección que corresponde a la unidad de frecuencia del ensayo. */
function magnitudeFor(unit: string | null, lot: LotSection): { qty: number | null; isVolume: boolean } {
  const u = (unit ?? '').toLowerCase()
  if (u === 't' || u === 'tm') return { qty: lot.tonnage_t ?? null, isVolume: false }
  if (u === 'm2') return { qty: lot.surface_m2 ?? null, isVolume: false }
  if (u === 'm' || u === 'ml') return { qty: lot.length_m ?? null, isVolume: false }
  return { qty: lot.volume_m3 ?? null, isVolume: true }
}

/** Gap-fill: nº de ensayos para un ensayo del presupuesto sin regla normativa. */
function budgetTests(rule: KbFrequencyRule, lot: LotSection): { nTests: number; detail: string; review: boolean } {
  const muestreo = rule.muestreo && rule.muestreo > 0 ? rule.muestreo : 1
  // per_quantity: por la magnitud correcta (m³ / t / m² / m), con escalón si es volumen.
  if (rule.freqKind === 'per_quantity') {
    const { qty, isVolume } = magnitudeFor(rule.freqMagUnit, lot)
    if (qty != null) {
      const freqQty = pickFreqQty(rule, qty, isVolume)
      if (freqQty > 0) {
        const n = Math.max(1, Math.ceil(qty / freqQty) * muestreo)
        return { nTests: n, detail: `${Math.round(qty).toLocaleString('es-ES')}/${freqQty} ${rule.freqMagUnit ?? ''} (inferida)`, review: false }
      }
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

/**
 * Techos "razonables" por categoría (en su magnitud natural) para sanity-check.
 * Superarlos NO altera el cálculo; solo emite un aviso para que se revise el dato
 * de entrada (p.ej. un Totalizados con 61.379 t de acero).
 */
const SANITY_MAX: Record<string, { mag: 'volume_m3' | 'tonnage_t' | 'surface_m2' | 'length_m'; max: number }> = {
  ACERO: { mag: 'tonnage_t', max: 20_000 },
  ACERO_ACTIVO: { mag: 'tonnage_t', max: 5_000 },
  ACERO_LAMINADO: { mag: 'tonnage_t', max: 10_000 },
  HORMIGON: { mag: 'volume_m3', max: 300_000 },
  ZAHORRA_ARTIFICIAL: { mag: 'volume_m3', max: 2_000_000 },
  SUELO_ESTABILIZADO: { mag: 'volume_m3', max: 2_000_000 },
  MEZCLA_BITUMINOSA: { mag: 'tonnage_t', max: 500_000 },
  TERRAPLEN_RELLENOS: { mag: 'volume_m3', max: 20_000_000 },
}

function sanityWarn(section: SectionInput, lot: LotSection): string | null {
  const s = SANITY_MAX[section.categoryCode]
  if (!s) return null
  const v = lot[s.mag]
  if (v != null && v > s.max) {
    return `Cantidad inusual en "${section.categoryCode}" (tramo ${section.tramo ?? '—'}): ${Math.round(v).toLocaleString('es-ES')} ${s.mag.split('_')[1]} > ${s.max.toLocaleString('es-ES')} esperado — revisar el dato de entrada.`
  }
  return null
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
    const sw = sanityWarn(section, lot)
    if (sw) warnings.push(sw)
    const tramo = section.tramo ?? null
    const cat = section.categoryCode
    const covered = new Set<string>()

    // 0) SERVICIO: el ítem ES el ensayo/servicio → se factura cantidad × precio (sin batería).
    if (cat === 'SERVICIO') {
      const desc = section.material ?? section.tramo ?? 'Servicio'
      const m = kb.matchTest(desc)
      const priced = m ? effectivePrice(kb, m.testId) : null
      const nTests = Math.max(1, Math.round(section.quantity ?? 1))
      const unitPrice = priced?.price ?? null
      lines.push({
        tramo, testId: m?.testId ?? null, description: m ? kb.tests.get(m.testId)!.canonicalDesc : desc, categoryCode: cat,
        nTests, unitPrice, total: unitPrice != null ? Math.round(nTests * unitPrice * 100) / 100 : null,
        provenance: { kind: 'presupuesto', source: 'servicio directo', detail: `${nTests} × precio`, priceSource: priced?.source ?? 'fallback', matchConfidence: m?.confidence ?? 0 },
        needsReview: unitPrice == null,
      })
      continue
    }

    // 1) Reglas normativas (autoridad de frecuencia)
    const normRules = (normByCat.get(cat) ?? []).filter((r) => r.controlType !== 'material_acceptance')
    for (const rule of normRules) {
      for (const nl of computeRule(lot, rule)) {
        // Si la norma no pudo calcular (nº=0, p.ej. hormigón sin valores de lote),
        // no la emitimos ni la marcamos cubierta → el presupuesto la rellena (replica ejemplos).
        if (nl.nTests === 0) continue
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
