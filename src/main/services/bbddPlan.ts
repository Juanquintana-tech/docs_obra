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
import { generatePlan, type PlanLine } from '../pipeline/kb/engine'
import { extractSections } from '../pipeline/kb/kbExtractor'
import { knowledgePath } from '../paths'

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
