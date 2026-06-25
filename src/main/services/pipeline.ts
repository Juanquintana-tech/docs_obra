/**
 * Servicio de pipeline para el proceso main: orquesta ingesta y entregables,
 * cacheando el índice RAG y las reglas (se construyen una sola vez).
 */
import { readFile } from 'fs/promises'
import { extractDocument } from '../pipeline/extractor'
import { classifyMaterials, classifyLargeDocument, extractObraInfo } from '../pipeline/classifier'
import { generatePlan, type Material, type Rules } from '../pipeline/planner'
import { listSheets, parseBudget, type BudgetSheet, type BudgetImportResult } from '../pipeline/budgetParser'
import { CATEGORY_CTX } from '../pipeline/rag/ragPricer'
import type { RagMatch } from '../pipeline/rag/types'
import type { PriceStrategy } from '../pipeline/rag/priceBook'
import { buildLabPricer, type LabPricer } from './labPricer'
import { UtilityEmbeddingsProvider } from './embeddingsProcess'
import { generateExcel, generateWord, type ObraInfo } from '../pipeline/formatter'
import { generateInformeWord, generateInformeExcel } from '../pipeline/informes'
import type { PlanRowInput } from '../pipeline/types'
import type { Ensayo, Obra } from '../db'
import { knowledgePath, writableKnowledgePath, templatePath } from '../paths'

let _rules: Rules | null = null
let _pricer: LabPricer | null = null
let _pricerPromise: Promise<LabPricer> | null = null

/** Proveedor de embeddings compartido (UtilityProcess); se cierra al salir. */
const _embeddings = new UtilityEmbeddingsProvider()

/** Detiene el UtilityProcess de embeddings (llamar al cerrar la app). */
export function disposePipeline(): void {
  _embeddings.dispose()
}

async function getRules(): Promise<Rules> {
  if (_rules) return _rules
  _rules = JSON.parse(await readFile(writableKnowledgePath('test_rules.json'), 'utf-8')) as Rules
  return _rules
}

/** Construye (y cachea) el motor de precios: libro de precios propio + ALAGAL de
 *  fallback. Cachea la PROMESA en vuelo para no construirlo dos veces si hay
 *  ingestas concurrentes. */
function getPricer(): Promise<LabPricer> {
  if (_pricer) return Promise.resolve(_pricer)
  if (!_pricerPromise) {
    _pricerPromise = buildLabPricer(
      {
        priceBookPath: knowledgePath('price_book.json'),
        priceBookEmbeddingsPath: knowledgePath('price_book_embeddings.json'),
        alagalXlsxPath: knowledgePath('tarifas_alagal.xlsx'),
        alagalEmbeddingsPath: knowledgePath('alagal_embeddings.json')
      },
      _embeddings
    ).then((p) => {
      _pricer = p
      return p
    })
  }
  return _pricerPromise
}

export interface IngestResult {
  obra: { obra: string; cliente: string; ref_doc: string; municipio: string }
  materials: Material[]
  plan: PlanRowInput[]
  strategy: PriceStrategy
  meta: { format: string; chars: number; needsOcr: boolean }
}

/** PDF/Word/Excel → texto → (obra, materiales) → plan valorado con la estrategia dada. */
export async function ingestDocument(
  path: string,
  strategy: PriceStrategy = 'mediana',
  onChunkDone?: (done: number, total: number) => void
): Promise<IngestResult> {
  const { text, format, needsOcr } = await extractDocument(path)
  const [obraInfo, materials] = await Promise.all([
    extractObraInfo(text),
    classifyLargeDocument(text, format, undefined, onChunkDone)
  ])
  const [rules, pricer] = await Promise.all([getRules(), getPricer()])
  const plan = await generatePlan(materials, rules, (items) => pricer.priceMany(items, strategy))
  return {
    obra: {
      obra: obraInfo.obra ?? '',
      cliente: obraInfo.cliente ?? '',
      ref_doc: obraInfo.ref_doc ?? '',
      municipio: obraInfo.municipio ?? ''
    },
    materials,
    plan,
    strategy,
    meta: { format, chars: text.length, needsOcr }
  }
}

/** Texto plano pegado directamente por el usuario → (obra, materiales) → plan valorado. */
export async function ingestText(
  text: string,
  strategy: PriceStrategy = 'mediana'
): Promise<IngestResult> {
  const [obraInfo, materials] = await Promise.all([extractObraInfo(text), classifyMaterials(text)])
  const [rules, pricer] = await Promise.all([getRules(), getPricer()])
  const plan = await generatePlan(materials, rules, (items) => pricer.priceMany(items, strategy))
  return {
    obra: {
      obra: obraInfo.obra ?? '',
      cliente: obraInfo.cliente ?? '',
      ref_doc: obraInfo.ref_doc ?? '',
      municipio: obraInfo.municipio ?? ''
    },
    materials,
    plan,
    strategy,
    meta: { format: 'txt', chars: text.length, needsOcr: false }
  }
}

/** Re-valora unos materiales con otra estrategia (sin re-extraer ni re-clasificar). */
export async function repricePlan(
  materials: Material[],
  strategy: PriceStrategy
): Promise<PlanRowInput[]> {
  const [rules, pricer] = await Promise.all([getRules(), getPricer()])
  return generatePlan(materials, rules, (items) => pricer.priceMany(items, strategy))
}

// ── Consultas RAG (para la pantalla de validación) ──────────────────────────
export interface RagStatus {
  ready: boolean
  size: number
  usesEmbeddings: boolean
  categories: string[]
}

export async function ragStatus(): Promise<RagStatus> {
  const pricer = await getPricer()
  return {
    ready: pricer.hasPriceBook,
    size: pricer.size,
    usesEmbeddings: pricer.usesEmbeddings,
    categories: Object.keys(CATEGORY_CTX)
  }
}

/** Busca los n mejores matches en el libro de precios (pantalla de validación). */
export async function ragFindMatches(query: string, category = '', n = 8): Promise<RagMatch[]> {
  const pricer = await getPricer()
  const ctx = CATEGORY_CTX[category] ?? ''
  return pricer.findMatches(`${query} ${ctx}`.trim(), n)
}

export async function buildExcel(plan: PlanRowInput[], obra: ObraInfo): Promise<Buffer> {
  return generateExcel(plan, obra)
}

export async function buildWord(plan: PlanRowInput[], obra: ObraInfo): Promise<Buffer> {
  return generateWord(plan, obra, templatePath('presupuesto_plantilla.docx'))
}

export async function buildEnsayoWord(ensayo: Ensayo, obra: Obra): Promise<Buffer> {
  return generateInformeWord(ensayo, obra, templatePath('membrete_cye.jpeg'))
}

export async function buildEnsayoExcel(ensayo: Ensayo, obra: Obra): Promise<Buffer> {
  // toma_hormigon no usa plantilla — genera el Excel con ExcelJS directamente
  if (ensayo.tipo === 'toma_hormigon') return generateInformeExcel(ensayo, obra, '')
  const tpl =
    ensayo.tipo === 'placa_carga'
      ? templatePath('plantilla_placa_carga.xlsx')
      : ensayo.tipo === 'granulometria'
        ? templatePath('informe_granulometría.xlsx')
        : templatePath('plantilla_densidad_in_situ.xlsx')
  return generateInformeExcel(ensayo, obra, tpl)
}

/** Invalida el cache de reglas para que se relean en el próximo presupuesto. */
export function invalidateRulesCache(): void {
  _rules = null
}

// ── Importación de presupuestos existentes ───────────────────────────────────

export type { BudgetSheet, BudgetImportResult }

/** Devuelve la lista de hojas de un Excel. [] para PDF/Word/TXT. */
export async function listBudgetSheets(path: string): Promise<BudgetSheet[]> {
  return listSheets(path)
}

/** Parsea un presupuesto existente y devuelve las filas del plan directamente. */
export async function parseBudgetDocument(
  path: string,
  sheetName?: string | null
): Promise<BudgetImportResult> {
  return parseBudget(path, sheetName)
}
