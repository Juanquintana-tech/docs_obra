/**
 * Registro de handlers IPC. Único punto donde el renderer toca el backend.
 * Todos los payloads son objetos planos serializables.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron'
import { writeFile } from 'fs/promises'
import { basename } from 'path'
import * as db from './db'
import type { PlanRow, ObraInput } from './db'
import type { PlanRowInput } from './pipeline/types'
import type { ObraInfo } from './pipeline/formatter'
import { ingestDocument, buildExcel, buildWord } from './services/pipeline'

/** Mapea filas de la DB (row_type) al contrato del pipeline (type) para el formatter. */
function toPlanInput(rows: PlanRow[]): PlanRowInput[] {
  return rows.map((r) => ({
    type: r.row_type,
    material: r.material,
    subcategory: r.subcategory,
    description: r.description,
    measurement: r.measurement,
    measurement_unit: r.measurement_unit,
    freq_qty: r.freq_qty,
    freq_unit: r.freq_unit,
    n_lots: r.n_lots,
    tests_per_lot: r.tests_per_lot,
    n_tests: r.n_tests,
    unit_price: r.unit_price,
    total: r.total,
    price_source: r.price_source,
    rag_score: r.rag_score,
    rag_desc: r.rag_desc
  }))
}

function obraToInfo(o: db.Obra): ObraInfo {
  return {
    obra: o.obra,
    cliente: o.cliente,
    ref_lab: o.ref_lab,
    fecha: o.fecha,
    responsable: o.responsable
  }
}

async function exportDeliverable(obraId: number, kind: 'excel' | 'word'): Promise<string | null> {
  const obra = db.getObra(obraId)
  if (!obra) throw new Error(`Obra ${obraId} no encontrada`)
  const plan = toPlanInput(db.getPlanRows(obraId))
  const info = obraToInfo(obra)

  const ext = kind === 'excel' ? 'xlsx' : 'docx'
  const safe = (obra.obra || 'plan').replace(/[^\w-]+/g, '_').slice(0, 60)
  const win = BrowserWindow.getFocusedWindow() ?? undefined
  const { canceled, filePath } = await dialog.showSaveDialog(win!, {
    defaultPath: `Plan_${safe}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  })
  if (canceled || !filePath) return null

  const buf = kind === 'excel' ? await buildExcel(plan, info) : buildWord(plan, info)
  await writeFile(filePath, buf)
  return filePath
}

export function registerIpc(): void {
  // ── Lectura DB ──
  ipcMain.handle('db:getGlobalStats', () => db.getGlobalStats())
  ipcMain.handle('db:getObras', (_e, status?: 'activa' | 'archivada') => db.getObras(status))
  ipcMain.handle('db:getObra', (_e, id: number) => db.getObra(id))
  ipcMain.handle('db:getPlanRows', (_e, id: number) => db.getPlanRows(id))

  // ── Escritura DB ──
  ipcMain.handle('db:saveObra', (_e, info: ObraInput, plan: PlanRowInput[]) =>
    db.saveObra(info, plan)
  )
  ipcMain.handle('db:updateStatus', (_e, id: number, status: 'activa' | 'archivada') =>
    db.updateStatus(id, status)
  )
  ipcMain.handle('db:deleteObra', (_e, id: number) => db.deleteObra(id))
  ipcMain.handle('db:savePriceCorrection', (_e, c: db.PriceCorrectionInput) =>
    db.savePriceCorrection(c)
  )

  // ── Ingesta ──
  ipcMain.handle('ingest:pickDocument', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? undefined
    const { canceled, filePaths } = await dialog.showOpenDialog(win!, {
      properties: ['openFile'],
      filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'xlsx', 'xls', 'txt'] }]
    })
    if (canceled || filePaths.length === 0) return null
    return { path: filePaths[0], name: basename(filePaths[0]) }
  })
  ipcMain.handle('ingest:document', (_e, path: string) => ingestDocument(path))

  // ── Entregables ──
  ipcMain.handle('export:excel', (_e, obraId: number) => exportDeliverable(obraId, 'excel'))
  ipcMain.handle('export:word', (_e, obraId: number) => exportDeliverable(obraId, 'word'))
}
