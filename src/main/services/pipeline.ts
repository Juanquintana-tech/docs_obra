/**
 * Servicio de pipeline para el proceso main: entregables (Word/Excel) e
 * importación de presupuestos. La generación de planes la hace el motor BBDD
 * determinista (ver services/bbddPlan.ts). El RAG/TF-IDF/embeddings se retiró.
 */
import {
  listSheets,
  parseBudget,
  type BudgetSheet,
  type BudgetImportResult
} from '../pipeline/budgetParser'
import { generateExcel, generateWord, type ObraInfo } from '../pipeline/formatter'
import { generateInformeWord, generateInformeExcel } from '../pipeline/informes'
import type { PlanRowInput } from '../pipeline/types'
import type { PriceStrategy } from '../pipeline/types'
import type { Material } from '../pipeline/types'
import type { Ensayo, Obra } from '../db'
import { templatePath } from '../paths'

/** Resultado de la ingesta de un documento → plan editable (mismo shape RAG/BBDD). */
export interface IngestResult {
  obra: { obra: string; cliente: string; ref_doc: string; municipio: string }
  materials: Material[]
  plan: PlanRowInput[]
  strategy: PriceStrategy
  meta: { format: string; chars: number; needsOcr: boolean }
  /** Avisos del motor (sanity-check de cantidades, categorías sin reglas…). */
  warnings?: string[]
}

/** No-op: ya no hay UtilityProcess de embeddings que cerrar (se conserva por compatibilidad). */
export function disposePipeline(): void {}

/** No-op: el motor BBDD recarga la KB por sesión; no hay caché de planner que invalidar. */
export function invalidateRulesCache(): void {}

// ── Entregables ───────────────────────────────────────────────────────────

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
  // toma_hormigon y radon_trazas generan el Excel con ExcelJS directamente (sin plantilla)
  if (ensayo.tipo === 'toma_hormigon') return generateInformeExcel(ensayo, obra, '')
  if (ensayo.tipo === 'radon_trazas') return generateInformeExcel(ensayo, obra, '')
  const tpl =
    ensayo.tipo === 'placa_carga'
      ? templatePath('plantilla_placa_carga.xlsx')
      : ensayo.tipo === 'granulometria'
        ? templatePath('informe_granulometría.xlsx')
        : templatePath('plantilla_densidad_in_situ.xlsx')
  return generateInformeExcel(ensayo, obra, tpl)
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
