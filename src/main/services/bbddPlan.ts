/**
 * Servicio del plan BBDD (Etapa 5): documento → extractor → motor por lote →
 * resultado agrupado por tramo, listo para la UI.
 *
 * Reusa el extractor (kbExtractor) y el motor determinista (engine). El LLM solo
 * estructura; los números salen de la BBDD curada.
 */
import { resolve } from 'path'
import { loadKb, effectivePrice } from '../pipeline/kb/kb'
import * as db from '../db'
import { loadNormativeRules } from '../pipeline/kb/normative'
import { generatePlan, type PlanLine, type SectionInput } from '../pipeline/kb/engine'
import { extractSections, classifyToSections, materialToSection } from '../pipeline/kb/kbExtractor'
import { extractDocument } from '../pipeline/extractor'
import { extractObraInfo } from '../pipeline/classifier'
import { knowledgePath } from '../paths'
import type { IngestResult } from './pipeline'
import type { PlanRowInput, Material, PriceStrategy } from '../pipeline/types'

export interface BBDDTramo {
  tramo: string
  lines: PlanLine[]
  subtotal: number
  nLines: number
  nReview: number
}

export interface BBDDPlanResult {
  tramos: BBDDTramo[]
  totalBase: number
  iva: number
  totalConIva: number
  warnings: string[]
  sectionsCount: number
  skipped: number
  nLines: number
  nReview: number
}

const IVA = 0.21

// La KB curada es estable durante la sesión → se carga una vez.
let _kb: ReturnType<typeof loadKb> | null = null
let _norm: ReturnType<typeof loadNormativeRules> | null = null
function curatedDir(): string {
  // En dev process.cwd() = raíz; en empaquetado, knowledgePath apunta a resources.
  try {
    return knowledgePath('curated')
  } catch {
    return resolve(process.cwd(), 'resources/knowledge/curated')
  }
}
function kb(): ReturnType<typeof loadKb> {
  if (!_kb) {
    const overrides = db.getCatalogOverrides().map((o) => ({
      testId: o.test_id,
      canonicalDesc: o.canonical_desc,
      priceTarifaCye: o.price_tarifa_cye,
      disabled: o.disabled === 1,
      isNew: o.is_new === 1,
      categoryCode: o.category_code
    }))
    _kb = loadKb(curatedDir(), overrides)
  }
  return _kb
}

export function invalidateKbCache(): void { _kb = null }
function norm(): ReturnType<typeof loadNormativeRules> {
  if (!_norm) _norm = loadNormativeRules(curatedDir())
  return _norm
}

/** Genera el plan BBDD desde un documento de obra, agrupado por tramo. */
export async function generateBBDDPlan(path: string): Promise<BBDDPlanResult> {
  const { sections, skipped, warning } = await extractSections(path)
  const { lines, totalBase, warnings } = generatePlan(sections, kb(), norm())
  if (warning) warnings.unshift(warning)

  const byTramo = new Map<string, PlanLine[]>()
  for (const l of lines) {
    const key = l.tramo ?? '(sin tramo)'
    if (!byTramo.has(key)) byTramo.set(key, [])
    byTramo.get(key)!.push(l)
  }
  const tramos: BBDDTramo[] = [...byTramo.entries()].map(([tramo, ls]) => ({
    tramo,
    lines: ls,
    subtotal: Math.round(ls.reduce((a, l) => a + (l.total ?? 0), 0) * 100) / 100,
    nLines: ls.length,
    nReview: ls.filter((l) => l.needsReview).length,
  }))

  return {
    tramos,
    totalBase,
    iva: Math.round(totalBase * IVA * 100) / 100,
    totalConIva: Math.round(totalBase * (1 + IVA) * 100) / 100,
    warnings,
    sectionsCount: sections.length,
    skipped,
    nLines: lines.length,
    nReview: lines.filter((l) => l.needsReview).length,
  }
}

// ── Integración en el flujo de Nueva Obra (mismo IngestResult que el motor viejo) ──

function lineToPlanRow(l: PlanLine): PlanRowInput {
  const p = l.provenance
  // Procedencia legible y completa para Detalle: artículo/fuente · control · cálculo.
  const provText = [p.source, p.control, p.detail].filter(Boolean).join(' · ')
  return {
    type: 'test',
    material: l.tramo ?? l.categoryCode, // PlanTable agrupa por material → agrupa por tramo
    description: l.description,
    n_tests: l.nTests,
    unit_price: l.unitPrice ?? 0,
    total: l.total ?? 0,
    // price_source = fuente de precio; rag_score = confianza; rag_desc = procedencia completa.
    price_source: l.provenance.priceSource,
    rag_score: l.provenance.matchConfidence,
    rag_desc: provText,
    needs_review: l.needsReview,
  }
}

function sectionToMaterial(s: SectionInput): Material {
  return {
    material: s.material ?? s.tramo ?? undefined,
    category: s.categoryCode,
    quantity: s.quantity,
    unit: s.unit ?? undefined,
  }
}

/**
 * Variante de ingesta que usa el MOTOR BBDD (determinista por lote) en lugar del RAG.
 * Devuelve el mismo `IngestResult` → encaja en el flujo de Nueva Obra (revisar/guardar/exportar).
 */
export async function ingestDocumentBBDD(
  path: string,
  strategy: PriceStrategy = 'mediana'
): Promise<IngestResult> {
  const { text, format, needsOcr } = await extractDocument(path)
  const [obraInfo, extracted] = await Promise.all([extractObraInfo(text), classifyToSections(text)])
  const { lines, warnings } = generatePlan(extracted.sections, kb(), norm())
  const plan = lines.map(lineToPlanRow)
  if (extracted.warning) warnings.unshift(extracted.warning)

  return {
    obra: {
      obra: obraInfo.obra ?? '',
      cliente: obraInfo.cliente ?? '',
      ref_doc: obraInfo.ref_doc ?? '',
      municipio: obraInfo.municipio ?? '',
    },
    materials: extracted.sections.map(sectionToMaterial),
    plan,
    strategy,
    meta: { format, chars: text.length, needsOcr },
    warnings,
  }
}

/** Texto pegado → motor BBDD (mismo IngestResult). */
export async function ingestTextBBDD(text: string, strategy: PriceStrategy = 'mediana'): Promise<IngestResult> {
  const [obraInfo, extracted] = await Promise.all([extractObraInfo(text), classifyToSections(text)])
  const { lines, warnings } = generatePlan(extracted.sections, kb(), norm())
  if (extracted.warning) warnings.unshift(extracted.warning)
  return {
    obra: {
      obra: obraInfo.obra ?? '', cliente: obraInfo.cliente ?? '',
      ref_doc: obraInfo.ref_doc ?? '', municipio: obraInfo.municipio ?? '',
    },
    materials: extracted.sections.map(sectionToMaterial),
    plan: lines.map(lineToPlanRow),
    strategy,
    meta: { format: 'txt', chars: text.length, needsOcr: false },
    warnings,
  }
}

/** Re-valora unos materiales con el motor BBDD (sin re-extraer). */
export function repricePlanBBDD(materials: Material[]): PlanRowInput[] {
  const sections = materials.map((m) => materialToSection(m))
  const { lines } = generatePlan(sections, kb(), norm())
  return lines.map(lineToPlanRow)
}

export interface PriceQuote {
  precio: number | null
  source: string
  score: number
  min?: number | null
  max?: number | null
  n?: number | null
}

/** Valora descripciones sueltas de ensayos contra la BBDD curada (para el agente NL). */
export async function priceTestsBBDD(items: { description: string; category?: string }[]): Promise<PriceQuote[]> {
  const k = kb()
  return items.map((it) => {
    const m = k.matchTest(it.description)
    if (!m) return { precio: null, source: 'fallback', score: 0 }
    const p = effectivePrice(k, m.testId)
    const cye = (k.pricesByTest.get(m.testId) ?? []).find((x) => x.source === 'tarifa_cye')
    return {
      precio: p?.price ?? null,
      source: p?.source ?? 'fallback',
      score: m.confidence,
      min: cye?.min ?? null,
      max: cye?.max ?? null,
      n: cye?.n ?? null,
    }
  })
}

/** Lista de códigos de categoría conocidos (para el agente editor de presupuesto). */
export function kbCategories(): string[] {
  return [...kb().categories.keys()]
}

// ── Catálogo editable ─────────────────────────────────────────────────────────

export interface KbCatalogRow {
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

export function getCatalogEntries(): KbCatalogRow[] {
  const k = kb()
  const overridesMap = new Map(db.getCatalogOverrides().map((o) => [o.test_id, o]))
  const result: KbCatalogRow[] = []

  for (const [id, test] of k.tests) {
    const prices = k.pricesByTest.get(id) ?? []
    const ov = overridesMap.get(id)
    result.push({
      testId: id,
      canonicalDesc: test.canonicalDesc,
      origin: test.origin,
      section: test.alagalSection,
      priceTarifaCye: prices.find((p) => p.source === 'tarifa_cye')?.price ?? null,
      pricePricebook: prices.find((p) => p.source === 'pricebook')?.price ?? null,
      priceAlagal: prices.find((p) => p.source === 'alagal')?.price ?? null,
      hasOverride: !!ov,
      isNew: ov?.is_new === 1,
      disabled: false
    })
  }

  // Incluir también los ensayos deshabilitados (para poder reactivarlos desde la UI).
  for (const [id, ov] of overridesMap) {
    if (ov.disabled === 1 && !k.tests.has(id)) {
      result.push({
        testId: id,
        canonicalDesc: ov.canonical_desc ?? id,
        origin: 'cye',
        section: ov.category_code ?? null,
        priceTarifaCye: ov.price_tarifa_cye ?? null,
        pricePricebook: null,
        priceAlagal: null,
        hasOverride: true,
        isNew: ov.is_new === 1,
        disabled: true
      })
    }
  }

  return result.sort((a, b) => a.testId.localeCompare(b.testId))
}
