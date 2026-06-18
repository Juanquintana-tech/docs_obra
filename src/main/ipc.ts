/**
 * Registro de handlers IPC. Único punto donde el renderer toca el backend.
 * Todos los payloads son objetos planos serializables.
 */
import { ipcMain, dialog, BrowserWindow, shell } from 'electron'
import { writeFile, readFile } from 'fs/promises'
import { basename } from 'path'
import * as db from './db'
import type { PlanRow, ObraInput, EnsayoInput, PlanRowPatch, NewPlanRowData, PlanEdits } from './db'
import type { PlanRowInput } from './pipeline/types'
import type { ObraInfo } from './pipeline/formatter'
import {
  ingestDocument,
  ingestText,
  repricePlan,
  buildExcel,
  buildWord,
  ragStatus,
  ragFindMatches,
  buildEnsayoWord,
  buildEnsayoExcel
} from './services/pipeline'
import { loadCatalog } from './pipeline/rag/catalog'
import { scanEnsayo } from './pipeline/ocr/ensayoOcr'
import type { Rules } from './pipeline/planner'
import type { Material } from './pipeline/types'
import type { PriceStrategy } from './pipeline/rag/priceBook'
import { knowledgePath } from './paths'

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

/** Muestra el diálogo de guardado, escribe el buffer y devuelve la ruta o null si se cancela. */
async function saveWithDialog(
  defaultName: string,
  ext: string,
  build: () => Buffer | Promise<Buffer>
): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: defaultName,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  })
  if (canceled || !filePath) return null
  await writeFile(filePath, await build())
  return filePath
}

async function exportDeliverable(obraId: number, kind: 'excel' | 'word'): Promise<string | null> {
  const obra = db.getObra(obraId)
  if (!obra) throw new Error(`Obra ${obraId} no encontrada`)
  const plan = toPlanInput(db.getPlanRows(obraId))
  const info = obraToInfo(obra)
  const ext = kind === 'excel' ? 'xlsx' : 'docx'
  const safe = (obra.obra || 'plan').replace(/[^\w-]+/g, '_').slice(0, 60)
  return saveWithDialog(`Plan_${safe}.${ext}`, ext, () =>
    kind === 'excel' ? buildExcel(plan, info) : buildWord(plan, info)
  )
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
  ipcMain.handle('db:updateObraInfo', (_e, id: number, info: ObraInput) =>
    db.updateObraInfo(id, info)
  )
  ipcMain.handle('db:deleteObra', (_e, id: number) => db.deleteObra(id))
  ipcMain.handle('app:showInFolder', (_e, path: string) => {
    if (path) shell.showItemInFolder(path)
  })
  ipcMain.handle('db:savePriceCorrection', (_e, c: db.PriceCorrectionInput) =>
    db.savePriceCorrection(c)
  )
  ipcMain.handle('db:updatePlanRows', (_e, obraId: number, patches: PlanRowPatch[]) =>
    db.updatePlanRows(obraId, patches)
  )
  ipcMain.handle('db:deletePlanRow', (_e, rowId: number) => db.deletePlanRow(rowId))
  ipcMain.handle('db:addPlanRow', (_e, obraId: number, data: NewPlanRowData) =>
    db.addPlanRow(obraId, data)
  )
  ipcMain.handle('db:savePlanEdits', (_e, obraId: number, edits: PlanEdits) =>
    db.savePlanEdits(obraId, edits)
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
  ipcMain.handle('ingest:document', (_e, path: string, strategy?: PriceStrategy) =>
    ingestDocument(path, strategy)
  )
  ipcMain.handle('ingest:text', (_e, text: string, strategy?: PriceStrategy) =>
    ingestText(text, strategy)
  )
  ipcMain.handle('pipeline:repricePlan', (_e, materials: Material[], strategy: PriceStrategy) =>
    repricePlan(materials, strategy)
  )

  // ── Entregables ──
  ipcMain.handle('export:excel', (_e, obraId: number) => exportDeliverable(obraId, 'excel'))
  ipcMain.handle('export:word', (_e, obraId: number) => exportDeliverable(obraId, 'word'))

  // ── RAG (pantalla de validación) ──
  ipcMain.handle('rag:status', () => ragStatus())
  ipcMain.handle('rag:findMatches', (_e, query: string, category?: string, n?: number) =>
    ragFindMatches(query, category ?? '', n)
  )

  // ── Ensayos (informes de campo) ──
  ipcMain.handle('ensayo:getAll', (_e, obraId: number, tipo?: string) =>
    db.getEnsayos(obraId, tipo)
  )
  ipcMain.handle('ensayo:save', (_e, obraId: number, input: EnsayoInput) =>
    db.saveEnsayo(obraId, input)
  )
  ipcMain.handle('ensayo:update', (_e, ensayoId: number, input: EnsayoInput) =>
    db.updateEnsayo(ensayoId, input)
  )
  ipcMain.handle('ensayo:delete', (_e, ensayoId: number) => db.deleteEnsayo(ensayoId))
  ipcMain.handle('ensayo:countPerObra', () => db.countEnsayosPorObra())

  ipcMain.handle(
    'ensayo:scanFromImage',
    (_e, arg: { tipo: string; imageBase64: string; mimeType: string }) =>
      scanEnsayo(arg.tipo, arg.imageBase64, arg.mimeType)
  )

  ipcMain.handle('ensayo:exportWord', async (_e, ensayoId: number) => {
    const ensayo = db.getEnsayo(ensayoId)
    if (!ensayo) throw new Error(`Ensayo ${ensayoId} no encontrado`)
    const obra = db.getObra(ensayo.obra_id)
    if (!obra) throw new Error(`Obra ${ensayo.obra_id} no encontrada`)
    const safe = (ensayo.titulo || ensayo.tipo).replace(/[^\w-]+/g, '_').slice(0, 60)
    return saveWithDialog(`Informe_${safe}.docx`, 'docx', () => buildEnsayoWord(ensayo, obra))
  })

  ipcMain.handle('ensayo:exportExcel', async (_e, ensayoId: number) => {
    const ensayo = db.getEnsayo(ensayoId)
    if (!ensayo) throw new Error(`Ensayo ${ensayoId} no encontrado`)
    const obra = db.getObra(ensayo.obra_id)
    if (!obra) throw new Error(`Obra ${ensayo.obra_id} no encontrada`)
    const safe = (ensayo.titulo || ensayo.tipo).replace(/[^\w-]+/g, '_').slice(0, 60)
    return saveWithDialog(`Informe_${safe}.xlsx`, 'xlsx', () => buildEnsayoExcel(ensayo, obra))
  })

  // ── Presupuestos (catálogo y reglas) ──
  ipcMain.handle('presup:getCatalog', () => loadCatalog(knowledgePath('tarifas_alagal.xlsx')))
  ipcMain.handle('presup:getRules', async () => {
    const raw = await readFile(knowledgePath('test_rules.json'), 'utf-8')
    return JSON.parse(raw) as Rules
  })
  ipcMain.handle('presup:saveRules', async (_e, rules: Rules) => {
    await writeFile(knowledgePath('test_rules.json'), JSON.stringify(rules, null, 2), 'utf-8')
    // Invalidar el cache del pipeline para que el próximo presupuesto use las reglas nuevas
    // Se importa aquí para evitar ciclos (el pipeline lo carga lazy)
    const { invalidateRulesCache } = await import('./services/pipeline')
    invalidateRulesCache()
  })
}
