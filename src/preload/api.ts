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
  PlanRowPatch
} from '../main/db'
import type { PlanRowInput } from '../main/pipeline/types'
import type { IngestResult, RagStatus } from '../main/services/pipeline'
import type { RagMatch } from '../main/pipeline/rag/types'
import type { CatalogEntry } from '../main/pipeline/rag/catalog'
import type { Rules } from '../main/pipeline/planner'

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
  deleteObra: (id: number): Promise<void> => ipcRenderer.invoke('db:deleteObra', id),
  savePriceCorrection: (c: PriceCorrectionInput): Promise<number> =>
    ipcRenderer.invoke('db:savePriceCorrection', c),
  updatePlanRows: (obraId: number, patches: PlanRowPatch[]): Promise<void> =>
    ipcRenderer.invoke('db:updatePlanRows', obraId, patches),

  // ── Ingesta ──
  pickDocument: (): Promise<PickedDocument | null> => ipcRenderer.invoke('ingest:pickDocument'),
  ingestDocument: (path: string): Promise<IngestResult> =>
    ipcRenderer.invoke('ingest:document', path),

  // ── Entregables (devuelven la ruta guardada o null si se cancela) ──
  exportExcel: (obraId: number): Promise<string | null> =>
    ipcRenderer.invoke('export:excel', obraId),
  exportWord: (obraId: number): Promise<string | null> => ipcRenderer.invoke('export:word', obraId),

  // ── RAG (validación) ──
  ragStatus: (): Promise<RagStatus> => ipcRenderer.invoke('rag:status'),
  ragFindMatches: (query: string, category?: string, n?: number): Promise<RagMatch[]> =>
    ipcRenderer.invoke('rag:findMatches', query, category, n),

  // ── Ensayos (informes de campo) ──
  getEnsayos: (obraId: number, tipo?: string): Promise<Ensayo[]> =>
    ipcRenderer.invoke('ensayo:getAll', obraId, tipo),
  saveEnsayo: (obraId: number, input: EnsayoInput): Promise<number> =>
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

  // ── Presupuestos (catálogo y reglas) ──
  getCatalog: (): Promise<CatalogEntry[]> => ipcRenderer.invoke('presup:getCatalog'),
  getRules: (): Promise<Rules> => ipcRenderer.invoke('presup:getRules'),
  saveRules: (rules: Rules): Promise<void> => ipcRenderer.invoke('presup:saveRules', rules)
}

export type Api = typeof api
