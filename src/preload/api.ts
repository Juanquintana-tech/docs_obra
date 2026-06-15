/**
 * Contrato de la API expuesta al renderer (window.api). Implementación y tipos
 * en un solo sitio para que main, preload y renderer compartan la misma forma.
 * Los tipos de dominio se importan como type-only (se borran en runtime).
 */
import { ipcRenderer } from 'electron'
import type { Obra, PlanRow, ObraInput, GlobalStats, PriceCorrectionInput } from '../main/db'
import type { PlanRowInput } from '../main/pipeline/types'
import type { IngestResult } from '../main/services/pipeline'

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

  // ── Ingesta ──
  pickDocument: (): Promise<PickedDocument | null> => ipcRenderer.invoke('ingest:pickDocument'),
  ingestDocument: (path: string): Promise<IngestResult> =>
    ipcRenderer.invoke('ingest:document', path),

  // ── Entregables (devuelven la ruta guardada o null si se cancela) ──
  exportExcel: (obraId: number): Promise<string | null> =>
    ipcRenderer.invoke('export:excel', obraId),
  exportWord: (obraId: number): Promise<string | null> => ipcRenderer.invoke('export:word', obraId)
}

export type Api = typeof api
