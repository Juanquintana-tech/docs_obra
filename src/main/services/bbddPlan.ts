/**
 * Servicio del plan BBDD (Etapa 5): documento → extractor → motor por lote →
 * resultado agrupado por tramo, listo para la UI.
 *
 * Reusa el extractor (kbExtractor) y el motor determinista (engine). El LLM solo
 * estructura; los números salen de la BBDD curada.
 */
import { resolve } from 'path'
import { loadKb } from '../pipeline/kb/kb'
import { loadNormativeRules } from '../pipeline/kb/normative'
import { generatePlan, type PlanLine, type SectionInput } from '../pipeline/kb/engine'
import { extractSections, classifyToSections } from '../pipeline/kb/kbExtractor'
import { extractDocument } from '../pipeline/extractor'
import { extractObraInfo } from '../pipeline/classifier'
import { knowledgePath } from '../paths'
import type { IngestResult } from './pipeline'
import type { PlanRowInput, Material } from '../pipeline/types'
import type { PriceStrategy } from '../pipeline/rag/priceBook'

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
  if (!_kb) _kb = loadKb(curatedDir())
  return _kb
}
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
  return {
    type: 'test',
    material: l.tramo ?? l.categoryCode,
    description: l.description,
    n_tests: l.nTests,
    unit_price: l.unitPrice ?? 0,
    total: l.total ?? 0,
    // price_source guarda la fuente de precio; rag_desc, la procedencia (artículo o presupuesto).
    price_source: l.provenance.priceSource,
    rag_score: l.provenance.matchConfidence,
    rag_desc: l.provenance.source,
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
  }
}
