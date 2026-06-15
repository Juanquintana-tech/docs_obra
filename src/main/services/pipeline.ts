/**
 * Servicio de pipeline para el proceso main: orquesta ingesta y entregables,
 * cacheando el índice RAG y las reglas (se construyen una sola vez).
 */
import { readFile } from 'fs/promises'
import { extractDocument } from '../pipeline/extractor'
import { classifyMaterials, extractObraInfo } from '../pipeline/classifier'
import { generatePlan, type Material, type Rules } from '../pipeline/planner'
import { RagPricer } from '../pipeline/rag/ragPricer'
import { generateExcel, generateWord, type ObraInfo } from '../pipeline/formatter'
import type { PlanRowInput } from '../pipeline/types'
import { knowledgePath, templatePath } from '../paths'

let _rules: Rules | null = null
let _pricer: RagPricer | null = null

async function getRules(): Promise<Rules> {
  if (_rules) return _rules
  _rules = JSON.parse(await readFile(knowledgePath('test_rules.json'), 'utf-8')) as Rules
  return _rules
}

/** Construye (y cachea) el RAG. Degrada con elegancia: si falla, devuelve null
 *  y el planner usa precios base en vez de tumbar la app. */
async function getPricer(): Promise<RagPricer | null> {
  if (_pricer) return _pricer
  try {
    _pricer = await RagPricer.fromXlsx(knowledgePath('tarifas_alagal.xlsx'))
    return _pricer
  } catch (e) {
    console.error('[pipeline] RAG no disponible, se usarán precios base:', e)
    return null
  }
}

export interface IngestResult {
  obra: { obra: string; cliente: string; ref_doc: string; municipio: string }
  materials: Material[]
  plan: PlanRowInput[]
  meta: { format: string; chars: number; needsOcr: boolean }
}

/** PDF/Word/Excel → texto → (obra, materiales) → plan valorado. */
export async function ingestDocument(path: string): Promise<IngestResult> {
  const { text, format, needsOcr } = await extractDocument(path)
  const [obraInfo, materials] = await Promise.all([extractObraInfo(text), classifyMaterials(text)])
  const [rules, pricer] = await Promise.all([getRules(), getPricer()])
  const plan = generatePlan(materials, rules, pricer)
  return {
    obra: {
      obra: obraInfo.obra ?? '',
      cliente: obraInfo.cliente ?? '',
      ref_doc: obraInfo.ref_doc ?? '',
      municipio: obraInfo.municipio ?? ''
    },
    materials,
    plan,
    meta: { format, chars: text.length, needsOcr }
  }
}

export async function buildExcel(plan: PlanRowInput[], obra: ObraInfo): Promise<Buffer> {
  return generateExcel(plan, obra)
}

export function buildWord(plan: PlanRowInput[], obra: ObraInfo): Buffer {
  return generateWord(plan, obra, templatePath('plan_plantilla.docx'))
}
