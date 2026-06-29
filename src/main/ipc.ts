/**
 * Registro de handlers IPC. Único punto donde el renderer toca el backend.
 * Todos los payloads son objetos planos serializables.
 */
import { ipcMain, dialog, BrowserWindow, shell, app } from 'electron'
import { writeFile, readFile, copyFile, mkdir, rm } from 'fs/promises'
import { basename, dirname, join, extname } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
import * as db from './db'
import type { PlanRow, ObraInput, EnsayoInput, PlanRowPatch, NewPlanRowData, PlanEdits } from './db'
import { writableKnowledgePath } from './paths'
import type { PlanRowInput } from './pipeline/types'
import type { ObraInfo } from './pipeline/formatter'
import {
  buildExcel,
  buildWord,
  buildEnsayoWord,
  buildEnsayoExcel,
  listBudgetSheets,
  parseBudgetDocument
} from './services/pipeline'
import { interpretCommand } from './services/agent'
import { interpretBudgetEdit } from './services/budgetAgent'
import { generateBBDDPlan, ingestDocumentBBDD, ingestTextBBDD, repricePlanBBDD } from './services/bbddPlan'
import { loadCatalog } from './pipeline/rag/catalog'
import { scanEnsayo } from './pipeline/ocr/ensayoOcr'
import type { Rules } from './pipeline/planner'
import type { Material } from './pipeline/types'
import type { PriceStrategy } from './pipeline/types'
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

function emptyObra(): db.Obra {
  return {
    id: 0,
    obra: '',
    cliente: '',
    ref_lab: '',
    fecha: '',
    coef_baja: 1,
    total_importe: 0,
    n_ensayos: 0,
    n_materiales: 0,
    responsable: '',
    price_strategy: 'reciente',
    iva_rate: 0.21,
    discount_pct: 0,
    created_at: '',
    status: 'activa'
  }
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
  ipcMain.handle('db:applyDiscount', (_e, obraId: number, discountPct: number) =>
    db.applyDiscount(obraId, discountPct)
  )
  ipcMain.handle('db:deletePlanRow', (_e, rowId: number) => db.deletePlanRow(rowId))
  ipcMain.handle('db:addPlanRow', (_e, obraId: number, data: NewPlanRowData) =>
    db.addPlanRow(obraId, data)
  )
  ipcMain.handle('db:savePlanEdits', (_e, obraId: number, edits: PlanEdits) =>
    db.savePlanEdits(obraId, edits)
  )

  // ── Importación de presupuestos ──
  ipcMain.handle('budget:listSheets', (_e, path: string) => listBudgetSheets(path))
  ipcMain.handle('budget:parse', (_e, path: string, sheetName?: string | null) =>
    parseBudgetDocument(path, sheetName)
  )

  // ── Ingesta ──
  ipcMain.handle('ingest:pickDocument', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Documentos', extensions: ['pdf', 'docx', 'xlsx', 'xls', 'txt'] }]
    })
    if (canceled || filePaths.length === 0) return null
    return { path: filePaths[0], name: basename(filePaths[0]) }
  })
  // Ingesta → motor BBDD determinista (el RAG/plannerLLM se retiró).
  ipcMain.handle('ingest:document', (_e, path: string, strategy?: PriceStrategy) =>
    ingestDocumentBBDD(path, strategy)
  )
  ipcMain.handle('ingest:text', (_e, text: string, strategy?: PriceStrategy) =>
    ingestTextBBDD(text, strategy)
  )

  // ── Plan BBDD (motor determinista por lote) ──
  ipcMain.handle('bbdd:generateFromDoc', (_e, path: string) => generateBBDDPlan(path))
  ipcMain.handle('bbdd:ingestDocument', (_e, path: string, strategy?: PriceStrategy) =>
    ingestDocumentBBDD(path, strategy)
  )
  ipcMain.handle('pipeline:repricePlan', (_e, materials: Material[]) =>
    repricePlanBBDD(materials)
  )

  // ── Entregables ──
  ipcMain.handle('export:excel', (_e, obraId: number) => exportDeliverable(obraId, 'excel'))
  ipcMain.handle('export:word', (_e, obraId: number) => exportDeliverable(obraId, 'word'))

  // ── Ensayos (informes de campo) ──
  ipcMain.handle('ensayo:getAll', (_e, obraId: number | null, tipo?: string) =>
    db.getEnsayos(obraId, tipo)
  )
  ipcMain.handle('ensayo:save', (_e, obraId: number | null, input: EnsayoInput) =>
    db.saveEnsayo(obraId, input)
  )
  ipcMain.handle('ensayo:update', (_e, ensayoId: number, input: EnsayoInput) =>
    db.updateEnsayo(ensayoId, input)
  )
  ipcMain.handle('ensayo:delete', (_e, ensayoId: number) => db.deleteEnsayo(ensayoId))
  ipcMain.handle('ensayo:countPerObra', () => db.countEnsayosPorObra())
  ipcMain.handle('ensayo:nextExpediente', (_e, year: number) => db.getNextExpediente(year))
  ipcMain.handle('ensayo:getProgress', (_e, obraId: number) => db.getProgressRows(obraId))

  ipcMain.handle(
    'ensayo:scanFromImage',
    (_e, arg: { tipo: string; imageBase64: string; mimeType: string }) =>
      scanEnsayo(arg.tipo, arg.imageBase64, arg.mimeType)
  )

  ipcMain.handle('ensayo:exportWord', async (_e, ensayoId: number) => {
    const ensayo = db.getEnsayo(ensayoId)
    if (!ensayo) throw new Error(`Ensayo ${ensayoId} no encontrado`)
    const obra = ensayo.obra_id != null ? db.getObra(ensayo.obra_id) : null
    if (ensayo.obra_id != null && !obra) throw new Error(`Obra ${ensayo.obra_id} no encontrada`)
    const safe = (ensayo.titulo || ensayo.tipo).replace(/[^\w-]+/g, '_').slice(0, 60)
    return saveWithDialog(`Informe_${safe}.docx`, 'docx', () =>
      buildEnsayoWord(ensayo, obra ?? emptyObra())
    )
  })

  ipcMain.handle('ensayo:exportExcel', async (_e, ensayoId: number) => {
    const ensayo = db.getEnsayo(ensayoId)
    if (!ensayo) throw new Error(`Ensayo ${ensayoId} no encontrado`)
    const obra = ensayo.obra_id != null ? db.getObra(ensayo.obra_id) : null
    if (ensayo.obra_id != null && !obra) throw new Error(`Obra ${ensayo.obra_id} no encontrada`)
    const safe = (ensayo.titulo || ensayo.tipo).replace(/[^\w-]+/g, '_').slice(0, 60)
    return saveWithDialog(`Informe_${safe}.xlsx`, 'xlsx', () =>
      buildEnsayoExcel(ensayo, obra ?? emptyObra())
    )
  })

  // ── Importación JSON del bot de radón ──
  ipcMain.handle('radon:importJson', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: 'Datos radón (JSON o ZIP)', extensions: ['json', 'zip'] },
        { name: 'JSON radón', extensions: ['json'] },
        { name: 'ZIP radón', extensions: ['zip'] }
      ],
      title: 'Importar datos del bot de radón'
    })
    if (canceled || filePaths.length === 0) return null

    const pickedPath = filePaths[0]
    const ts = Date.now()
    let jsonPath = pickedPath
    let tempExtractDir: string | null = null

    // Si es ZIP: extraer a userData/radon-fotos/{ts}/extracted/ y localizar el JSON dentro
    if (extname(pickedPath).toLowerCase() === '.zip') {
      tempExtractDir = join(app.getPath('userData'), 'radon-fotos', String(ts), 'extracted')
      await mkdir(tempExtractDir, { recursive: true })
      try {
        await execFileAsync('unzip', ['-o', pickedPath, '-d', tempExtractDir])
      } catch (e) {
        await rm(tempExtractDir, { recursive: true, force: true })
        throw new Error(`No se pudo extraer el ZIP: ${String(e)}`)
      }
      // Buscar radon_data.json en el directorio extraído (puede estar en subdirectorio)
      const { stdout } = await execFileAsync('find', [
        tempExtractDir,
        '-name',
        'radon_data.json',
        '-maxdepth',
        '3'
      ])
      const found = stdout.trim().split('\n').filter(Boolean)[0]
      if (!found) {
        await rm(tempExtractDir, { recursive: true, force: true })
        throw new Error('No se encontró radon_data.json dentro del ZIP.')
      }
      jsonPath = found
    }

    const raw = await readFile(jsonPath, 'utf-8')
    const data = JSON.parse(raw)

    if (data.version !== 1 || data.tipo !== 'radon_trazas') {
      if (tempExtractDir) await rm(tempExtractDir, { recursive: true, force: true })
      throw new Error('El archivo no es un JSON de radón válido (version=1, tipo=radon_trazas).')
    }

    // Copiar fotos desde fotos/ junto al JSON → userData/radon-fotos/{ts}/
    const fotosDir = join(dirname(jsonPath), 'fotos')
    const destDir = join(app.getPath('userData'), 'radon-fotos', String(ts))
    const fotoMap: Record<string, string> = {}

    for (const det of (data.detectores ?? []) as { foto_filename?: string | null }[]) {
      if (!det.foto_filename) continue
      const src = join(fotosDir, det.foto_filename)
      const dest = join(destDir, det.foto_filename)
      try {
        await mkdir(destDir, { recursive: true })
        await copyFile(src, dest)
        fotoMap[det.foto_filename] = dest
      } catch {
        // Foto no disponible — se ignora
      }
    }

    // Limpiar directorio de extracción temporal (las fotos ya están copiadas a destDir)
    if (tempExtractDir) await rm(tempExtractDir, { recursive: true, force: true })

    return { data, fotoMap }
  })

  // ── Fotos de radón: adjuntar manualmente y abrir ──
  ipcMain.handle('radon:pickPhoto', async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'heic', 'webp'] }],
      title: 'Adjuntar foto del detector'
    })
    if (canceled || filePaths.length === 0) return null
    // Copiar a userData/radon-fotos/manual/ para tener ruta persistente
    const src = filePaths[0]
    const destDir = join(app.getPath('userData'), 'radon-fotos', 'manual')
    await mkdir(destDir, { recursive: true })
    const destName = `${Date.now()}_${basename(src)}`
    const dest = join(destDir, destName)
    await copyFile(src, dest)
    return dest
  })

  ipcMain.handle('radon:openPhoto', (_e, path: string) => {
    if (path) shell.openPath(path)
  })

  // ── Agente (intérprete de comandos en lenguaje natural) ──
  ipcMain.handle('agent:interpret', (_e, userText: string, fileNames: string[]) =>
    interpretCommand(userText, fileNames)
  )
  ipcMain.handle('agent:interpretBudgetEdit', (_e, obraId: number, userText: string) =>
    interpretBudgetEdit(obraId, userText)
  )

  // ── Catálogo KB editable ──
  ipcMain.handle('catalog:getTests', async () => {
    const { getCatalogEntries } = await import('./services/bbddPlan')
    return getCatalogEntries()
  })
  ipcMain.handle('catalog:upsertOverride', async (_e, override: db.CatalogOverrideRow) => {
    db.upsertCatalogOverride(override)
    const { invalidateKbCache } = await import('./services/bbddPlan')
    invalidateKbCache()
  })
  ipcMain.handle('catalog:deleteOverride', async (_e, testId: string) => {
    db.deleteCatalogOverride(testId)
    const { invalidateKbCache } = await import('./services/bbddPlan')
    invalidateKbCache()
  })

  // ── Presupuestos (catálogo y reglas) ──
  ipcMain.handle('presup:getCatalog', () => loadCatalog(knowledgePath('tarifas_alagal.xlsx')))
  ipcMain.handle('presup:getRules', async () => {
    const raw = await readFile(writableKnowledgePath('test_rules.json'), 'utf-8')
    return JSON.parse(raw) as Rules
  })
  ipcMain.handle('presup:saveRules', async (_e, rules: Rules) => {
    if (typeof rules !== 'object' || rules === null || Array.isArray(rules)) {
      throw new Error('Estructura de reglas inválida')
    }
    await writeFile(
      writableKnowledgePath('test_rules.json'),
      JSON.stringify(rules, null, 2),
      'utf-8'
    )
    const { invalidateRulesCache } = await import('./services/pipeline')
    invalidateRulesCache()
  })
}
