/**
 * Contrato de la API expuesta al renderer (window.api). Implementación y tipos
 * en un solo sitio para que main, preload y renderer compartan la misma forma.
 * Los tipos de dominio se importan como type-only (se borran en runtime).
 */
import { ipcRenderer } from 'electron'
import type {
  Obra,
  PlanRow,
  ObraInput,
  GlobalStats,
  PriceCorrectionInput,
  Ensayo,
  EnsayoInput,
  PlanRowPatch,
  NewPlanRowData,
  PlanEdits,
  ProgressRow
} from '../main/db'
import type { PlanRowInput, Material } from '../main/pipeline/types'
import type {
  IngestResult,
  BudgetSheet,
  BudgetImportResult
} from '../main/services/pipeline'
import type { CatalogEntry } from '../main/pipeline/rag/catalog'
import type { Rules } from '../main/pipeline/planner'
import type { PriceStrategy } from '../main/pipeline/types'
import type { AgentIntent } from '../main/services/agent'
import type { BudgetEditPlan } from '../main/services/budgetAgent'
import type { BBDDPlanResult } from '../main/services/bbddPlan'

export interface PickedDocument {
  path: string
  name: string
}

export const api = {
  // ── Lectura ──
  getGlobalStats: (): Promise<GlobalStats> => ipcRenderer.invoke('db:getGlobalStats'),
  getObras: (status?: 'activa' | 'archivada'): Promise<Obra[]> =>
    ipcRenderer.invoke('db:getObras', status),
  getObra: (id: number): Promise<Obra | undefined> => ipcRenderer.invoke('db:getObra', id),
  getPlanRows: (id: number): Promise<PlanRow[]> => ipcRenderer.invoke('db:getPlanRows', id),

  // ── Escritura ──
  saveObra: (info: ObraInput, plan: PlanRowInput[]): Promise<number> =>
    ipcRenderer.invoke('db:saveObra', info, plan),
  updateStatus: (id: number, status: 'activa' | 'archivada'): Promise<void> =>
    ipcRenderer.invoke('db:updateStatus', id, status),
  updateObraInfo: (id: number, info: ObraInput): Promise<void> =>
    ipcRenderer.invoke('db:updateObraInfo', id, info),
  deleteObra: (id: number): Promise<void> => ipcRenderer.invoke('db:deleteObra', id),
  /** Revela un fichero en el Finder/Explorador (tras exportar un informe). */
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke('app:showInFolder', path),
  savePriceCorrection: (c: PriceCorrectionInput): Promise<number> =>
    ipcRenderer.invoke('db:savePriceCorrection', c),
  updatePlanRows: (obraId: number, patches: PlanRowPatch[]): Promise<void> =>
    ipcRenderer.invoke('db:updatePlanRows', obraId, patches),
  deletePlanRow: (rowId: number): Promise<void> => ipcRenderer.invoke('db:deletePlanRow', rowId),
  addPlanRow: (obraId: number, data: NewPlanRowData): Promise<number> =>
    ipcRenderer.invoke('db:addPlanRow', obraId, data),
  savePlanEdits: (obraId: number, edits: PlanEdits): Promise<void> =>
    ipcRenderer.invoke('db:savePlanEdits', obraId, edits),
  applyDiscount: (obraId: number, discountPct: number): Promise<void> =>
    ipcRenderer.invoke('db:applyDiscount', obraId, discountPct),

  // ── Ingesta ──
  pickDocument: (): Promise<PickedDocument | null> => ipcRenderer.invoke('ingest:pickDocument'),
  ingestDocument: (path: string, strategy?: PriceStrategy): Promise<IngestResult> =>
    ipcRenderer.invoke('ingest:document', path, strategy),
  ingestText: (text: string, strategy?: PriceStrategy): Promise<IngestResult> =>
    ipcRenderer.invoke('ingest:text', text, strategy),

  // Plan BBDD (motor determinista por lote)
  bbddGenerate: (path: string): Promise<BBDDPlanResult> =>
    ipcRenderer.invoke('bbdd:generateFromDoc', path),
  // Ingesta con el motor BBDD (mismo IngestResult que el RAG) para Nueva Obra
  bbddIngest: (path: string, strategy?: PriceStrategy): Promise<IngestResult> =>
    ipcRenderer.invoke('bbdd:ingestDocument', path, strategy),
  /** Recalcula el plan con otra estrategia de precios (sin re-ingestar el documento). */
  repricePlan: (materials: Material[], strategy: PriceStrategy): Promise<PlanRowInput[]> =>
    ipcRenderer.invoke('pipeline:repricePlan', materials, strategy),

  // ── Entregables (devuelven la ruta guardada o null si se cancela) ──
  exportExcel: (obraId: number): Promise<string | null> =>
    ipcRenderer.invoke('export:excel', obraId),
  exportWord: (obraId: number): Promise<string | null> => ipcRenderer.invoke('export:word', obraId),

  // ── Ensayos (informes de campo) ──
  getEnsayos: (obraId: number | null, tipo?: string): Promise<Ensayo[]> =>
    ipcRenderer.invoke('ensayo:getAll', obraId, tipo),
  saveEnsayo: (obraId: number | null, input: EnsayoInput): Promise<number> =>
    ipcRenderer.invoke('ensayo:save', obraId, input),
  updateEnsayo: (ensayoId: number, input: EnsayoInput): Promise<void> =>
    ipcRenderer.invoke('ensayo:update', ensayoId, input),
  deleteEnsayo: (ensayoId: number): Promise<void> => ipcRenderer.invoke('ensayo:delete', ensayoId),
  countEnsayosPorObra: (): Promise<Record<number, number>> =>
    ipcRenderer.invoke('ensayo:countPerObra'),
  exportEnsayoWord: (ensayoId: number): Promise<string | null> =>
    ipcRenderer.invoke('ensayo:exportWord', ensayoId),
  exportEnsayoExcel: (ensayoId: number): Promise<string | null> =>
    ipcRenderer.invoke('ensayo:exportExcel', ensayoId),
  /** Devuelve el siguiente n_expediente libre para el año dado (no lo reserva). */
  getNextExpediente: (year: number): Promise<string> =>
    ipcRenderer.invoke('ensayo:nextExpediente', year),
  /** Vista de avance: filas del plan con recuento de informes vinculados. */
  getEnsayoProgress: (obraId: number): Promise<ProgressRow[]> =>
    ipcRenderer.invoke('ensayo:getProgress', obraId),
  /** Extrae datos de un formulario de ensayo a partir de una imagen en base64.
   *  Devuelve { ocr, tipo, conf } con los campos extraídos listos para mergear
   *  y la confianza de cada campo ("high"|"mid"|"low"). */
  scanEnsayoFromImage: (
    tipo: string,
    imageBase64: string,
    mimeType: string
  ): Promise<{ ocr: Record<string, unknown>; tipo: string; conf: Record<string, string> }> =>
    ipcRenderer.invoke('ensayo:scanFromImage', { tipo, imageBase64, mimeType }),

  // ── Importación de presupuestos existentes ──
  listBudgetSheets: (path: string): Promise<BudgetSheet[]> =>
    ipcRenderer.invoke('budget:listSheets', path),
  parseBudget: (path: string, sheetName?: string | null): Promise<BudgetImportResult> =>
    ipcRenderer.invoke('budget:parse', path, sheetName),

  // ── Importación JSON / ZIP del bot de radón ──
  importRadonJson: (): Promise<{ data: unknown; fotoMap: Record<string, string> } | null> =>
    ipcRenderer.invoke('radon:importJson'),
  pickRadonPhoto: (): Promise<string | null> => ipcRenderer.invoke('radon:pickPhoto'),
  openRadonPhoto: (path: string): Promise<void> => ipcRenderer.invoke('radon:openPhoto', path),

  // ── Presupuestos (catálogo y reglas) ──
  getCatalog: (): Promise<CatalogEntry[]> => ipcRenderer.invoke('presup:getCatalog'),
  getRules: (): Promise<Rules> => ipcRenderer.invoke('presup:getRules'),
  saveRules: (rules: Rules): Promise<void> => ipcRenderer.invoke('presup:saveRules', rules),

  // ── Agente (intérprete de comandos en lenguaje natural) ──
  interpretCommand: (userText: string, fileNames: string[]): Promise<AgentIntent> =>
    ipcRenderer.invoke('agent:interpret', userText, fileNames),
  interpretBudgetEdit: (obraId: number, userText: string): Promise<BudgetEditPlan> =>
    ipcRenderer.invoke('agent:interpretBudgetEdit', obraId, userText),

  // ── Progreso de clasificación por chunks (documentos grandes) ──
  /**
   * Suscribe un callback a los eventos de progreso de chunk emitidos por el proceso main
   * durante la ingesta de documentos grandes. Devuelve una función de desuscripción.
   */
  onIngestProgress: (cb: (data: { done: number; total: number }) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, data: { done: number; total: number }): void =>
      cb(data)
    ipcRenderer.on('ingest:chunkProgress', handler)
    return () => ipcRenderer.removeListener('ingest:chunkProgress', handler)
  }
}

export type Api = typeof api
