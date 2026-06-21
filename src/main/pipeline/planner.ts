/**
 * Genera el plan de ensayos a partir de los materiales clasificados.
 * Dos modos:
 *   - Tipo A (materials): aplica frecuencias de test_rules.json.
 *   - Tipo B (SERVICIO): la cantidad del BOM = nº de servicios; precio directo por RAG.
 */
import type { Material, PlanRowInput } from './types'

export type { Material } from './types'

/** Resultado de valorar un ensayo (lo que devuelve el motor de precios). */
export interface PriceQuote {
  precio: number | null
  descripcion: string
  score: number
  source: string
  min?: number | null
  max?: number | null
}

/** Función de valoración por lotes; la estrategia/fuente la encapsula el caller. */
export type PriceManyFn = (
  items: { description: string; category?: string }[]
) => Promise<PriceQuote[]>

// ── Tipos de las reglas (test_rules.json) ──────────────────────────────────
export interface TestRule {
  description: string
  subcategory?: string
  freq_qty?: number | string
  freq_unit?: string
  tests_per_lot?: number | string
  unit_price?: number | string
}
export interface CategoryRule {
  keywords?: string[]
  unit?: string
  tests?: TestRule[]
}
export type Rules = Record<string, CategoryRule>

// ── Coerciones tolerantes (port de _coerce_float / _coerce_int) ─────────────
function coerceFloat(v: unknown, def = 0): number {
  if (v == null || v === '') return def
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : def
}
function coerceInt(v: unknown, def = 1): number {
  return Math.round(coerceFloat(v, def))
}

function normUnit(u: string | undefined): string {
  return (u || '').trim().toLowerCase().replace(/³/g, '3').replace(/²/g, '2').replace(/\s+/g, '')
}

/**
 * Extrae pares (volumen, unidad) de una frecuencia, admitiendo varios umbrales.
 * "100 m3 / 1.000 m2" → [[100,'m3'],[1000,'m2']]; "500 t" → [[500,'t']].
 * El separador de miles "." se elimina.
 */
export function parseFreqPairs(freqUnit: string): Array<[number, string]> {
  const pairs: Array<[number, string]> = []
  const re = /([\d.,]+)\s*(m3|m³|m2|m²|ml|kg|t|m)\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(freqUnit)) !== null) {
    const num = m[1].replace(/\./g, '').replace(',', '.')
    const val = Number(num)
    if (Number.isFinite(val)) pairs.push([val, normUnit(m[2])])
  }
  return pairs
}

/**
 * Nº de LOTES según cantidad y umbral de frecuencia (port de _calculate_n_lots).
 * Elige el umbral cuya unidad coincide con la del material; si no, el primero.
 * Frecuencias no numéricas → 1 lote conceptual.
 */
export function calculateNLots(
  quantity: number | null | undefined,
  freqUnit: string,
  materialUnit = ''
): number {
  if (quantity == null || quantity <= 0) return 1
  const pairs = parseFreqPairs(freqUnit)
  if (pairs.length === 0) return 1
  const mu = normUnit(materialUnit)
  const match = pairs.find(([, un]) => un && un === mu)
  const umbral = match ? match[0] : pairs[0][0]
  if (umbral <= 0) return 1
  return Math.max(1, Math.ceil(quantity / umbral))
}

/**
 * Genera las filas 'test' del plan. Por cada material aplica las reglas de su
 * categoría y, si se pasa un RagPricer, valora cada ensayo con el catálogo.
 */
export async function generatePlan(
  materials: Material[],
  rules: Rules,
  priceMany?: PriceManyFn | null
): Promise<PlanRowInput[]> {
  // ── Pasada 1: filas estructurales (sin precio) + items a valorar ──
  interface Pending {
    row: PlanRowInput
    description: string
    category: string
  }
  const pending: Pending[] = []

  for (const mat of materials) {
    const category = mat.category ?? 'OTRO'
    const materialName = mat.material || mat.description || ''
    const quantity = mat.quantity ?? null

    // ── Tipo B: SERVICIO — precio directo, sin derivar subensayos ──────────
    if (category === 'SERVICIO') {
      const nTests = Math.max(1, Math.round(quantity ?? 1))
      const description = mat.description || materialName
      pending.push({
        description,
        category,
        row: {
          type: 'test',
          material: materialName,
          subcategory: 'Servicio directo',
          description,
          measurement: quantity,
          measurement_unit: mat.unit ?? 'ud',
          freq_qty: 1,
          freq_unit: `por ${mat.unit ?? 'ud'}`,
          n_lots: 1,
          tests_per_lot: 1,
          n_tests: nTests,
          unit_price: 0,
          total: 0,
          price_source: 'fallback',
          rag_score: 0,
          rag_desc: ''
        }
      })
      continue
    }

    // ── Tipo A: Material — derivar ensayos por frecuencia (test_rules.json) ─
    const rule = rules[category]
    if (!rule) continue

    const materialUnit = mat.unit ?? rule.unit ?? ''

    for (const test of rule.tests ?? []) {
      const freqUnit = test.freq_unit ?? ''
      const freqQty = coerceInt(test.freq_qty, 1)
      const testsPerLot = coerceInt(test.tests_per_lot, 1)
      const description = test.description ?? ''
      const nLots = calculateNLots(quantity, freqUnit, materialUnit)
      const nTests = nLots * freqQty * testsPerLot
      const baseUnitPrice = coerceFloat(test.unit_price, 0)

      pending.push({
        description,
        category,
        row: {
          type: 'test',
          material: materialName,
          subcategory: test.subcategory ?? '',
          description,
          measurement: quantity,
          measurement_unit: materialUnit,
          freq_qty: freqQty,
          freq_unit: freqUnit,
          n_lots: nLots,
          tests_per_lot: testsPerLot,
          n_tests: nTests,
          unit_price: baseUnitPrice,
          total: nTests * baseUnitPrice,
          price_source: 'fallback',
          rag_score: 0,
          rag_desc: ''
        }
      })
    }
  }

  // ── Pasada 2: valoración en bloque (libro de precios → ALAGAL → base) ──
  if (priceMany && pending.length > 0) {
    const results = await priceMany(
      pending.map((p) => ({ description: p.description, category: p.category }))
    )
    pending.forEach((p, i) => {
      const r = results[i]
      const nTests = p.row.n_tests ?? 0
      if (r.precio != null) {
        p.row.unit_price = r.precio
        p.row.total = nTests * r.precio
        p.row.price_source = r.source
        p.row.rag_desc = r.descripcion
        p.row.price_min = r.min ?? null
        p.row.price_max = r.max ?? null
      }
      p.row.rag_score = Math.round(r.score * 1000) / 1000
    })
  }

  return pending.map((p) => p.row)
}
