/**
 * Motor determinista de valoración (Etapa 2, branch Cye_BBDD).
 *
 * Entrada: mediciones estructuradas por tramo/sección (categoría, cantidad, unidad).
 * Salida:  PlanLine[] con procedencia auditable y flags de fallback.
 *
 * SIN LLM, SIN red, SIN aleatoriedad: mismo input → mismo output (determinista).
 * Toda cifra sale de la BBDD curada (`kb`) y de aritmética explícita.
 */
import type { KbFrequencyRule } from './types'
import { type Kb, effectivePrice } from './kb'

// ── Contratos (estables entre etapas, ver PLAN_BBDD.md §4) ──────────────────

export interface SectionInput {
  tramo?: string | null
  categoryCode: string
  material?: string | null
  quantity: number | null
  unit: string | null
}

export interface Provenance {
  ruleId: string | null // categoría|testId (clave de la regla aplicada)
  freq: string | null // "1 / 5000 m3" legible
  priceSource: 'tarifa_cye' | 'pricebook' | 'alagal' | 'fallback'
  matchConfidence: number // 1.0 = regla/precio directos de la BBDD
  notes?: string
}

export interface PlanLine {
  tramo: string | null
  testId: string | null
  description: string
  categoryCode: string
  nLots: number | null
  nTests: number
  unitPrice: number | null
  total: number | null
  provenance: Provenance
  needsReview: boolean
}

export interface GenerateOptions {
  /** Redondeo de lotes (por defecto ceil: nunca menos control del normativo). */
  rounding?: 'ceil' | 'round'
}

export interface GenerateResult {
  lines: PlanLine[]
  totalBase: number
  warnings: string[]
}

// ── Conversión de unidades de magnitud ──────────────────────────────────────

function normUnit(u: string | null): string {
  return (u ?? '').trim().toLowerCase().replace('³', '3').replace('²', '2').replace(/\s+/g, '')
}

/** Convierte `qty` de `from` a `to`; null si no hay conversión conocida. */
function convert(qty: number, from: string | null, to: string | null): number | null {
  const f = normUnit(from)
  const t = normUnit(to)
  if (!f || !t) return null
  if (f === t) return qty
  if (f === 'kg' && t === 't') return qty / 1000
  if (f === 't' && t === 'kg') return qty * 1000
  if ((f === 'm' && t === 'ml') || (f === 'ml' && t === 'm')) return qty
  if ((f === 'u' && t === 'ud') || (f === 'ud' && t === 'u')) return qty
  return null
}

// ── Cálculo de nº de ensayos por regla ──────────────────────────────────────

interface Computed { nLots: number | null; nTests: number; note?: string; review: boolean }

function computeTests(rule: KbFrequencyRule, section: SectionInput, rounding: 'ceil' | 'round'): Computed {
  const muestreo = rule.muestreo && rule.muestreo > 0 ? rule.muestreo : 1
  const round = rounding === 'ceil' ? Math.ceil : Math.round

  switch (rule.freqKind) {
    case 'per_quantity':
    case 'per_lot': {
      if (rule.freqQty == null || rule.freqQty <= 0) {
        return { nLots: null, nTests: muestreo, note: 'freqQty ausente', review: true }
      }
      if (section.quantity == null) {
        return { nLots: null, nTests: muestreo, note: 'cantidad de sección desconocida', review: true }
      }
      const q = convert(section.quantity, section.unit, rule.freqMagUnit)
      if (q == null) {
        return {
          nLots: null,
          nTests: muestreo,
          note: `unidad sección (${section.unit ?? '—'}) ≠ unidad frecuencia (${rule.freqMagUnit ?? '—'})`,
          review: true,
        }
      }
      const nLots = Math.max(1, round(q / rule.freqQty))
      return { nLots, nTests: nLots * muestreo, review: false }
    }
    case 'per_type':
    case 'per_element':
      // Una sección = un material/elemento → muestreo ensayos.
      return { nLots: 1, nTests: muestreo, review: false }
    case 'fixed':
      return { nLots: null, nTests: muestreo, review: false }
    default: // 'other' → condicional, no calculable
      return { nLots: null, nTests: muestreo, note: `frecuencia no estructurada: "${rule.freqUnit}"`, review: true }
  }
}

// ── API pública ─────────────────────────────────────────────────────────────

export function generatePlan(sections: SectionInput[], kb: Kb, opts: GenerateOptions = {}): GenerateResult {
  const rounding = opts.rounding ?? 'ceil'
  const lines: PlanLine[] = []
  const warnings: string[] = []

  for (const section of sections) {
    const rules = kb.rulesByCategory.get(section.categoryCode)
    if (!rules || rules.length === 0) {
      warnings.push(`Sin reglas de frecuencia para categoría "${section.categoryCode}" (tramo ${section.tramo ?? '—'})`)
      continue
    }

    for (const rule of rules) {
      const test = kb.tests.get(rule.testId)
      const c = computeTests(rule, section, rounding)
      const priced = effectivePrice(kb, rule.testId)

      const unitPrice = priced?.price ?? null
      const total = unitPrice != null ? Math.round(c.nTests * unitPrice * 100) / 100 : null
      const freqStr =
        rule.freqKind === 'per_quantity' || rule.freqKind === 'per_lot'
          ? `${rule.muestreo} / ${rule.freqQty} ${rule.freqMagUnit ?? ''}`.trim()
          : rule.freqUnit

      lines.push({
        tramo: section.tramo ?? null,
        testId: rule.testId,
        description: test?.canonicalDesc ?? rule.rawDesc,
        categoryCode: section.categoryCode,
        nLots: c.nLots,
        nTests: c.nTests,
        unitPrice,
        total,
        provenance: {
          ruleId: `${rule.categoryCode}|${rule.testId}`,
          freq: freqStr,
          priceSource: priced?.source ?? 'fallback',
          matchConfidence: 1,
          notes: c.note,
        },
        needsReview: c.review || unitPrice == null,
      })
    }
  }

  const totalBase = Math.round(lines.reduce((a, l) => a + (l.total ?? 0), 0) * 100) / 100
  return { lines, totalBase, warnings }
}
