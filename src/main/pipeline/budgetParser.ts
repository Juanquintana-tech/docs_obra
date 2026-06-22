/**
 * Parser de presupuestos existentes de laboratorio.
 * A diferencia del pipeline normal (raw doc → LLM classify → planner → RAG),
 * aquí el documento YA ES un presupuesto valorado: extraemos las filas directamente
 * sin aplicar reglas de frecuencia ni repricing.
 *
 * Soporta: XLSX, XLS, DOCX, PDF, TXT
 * Para Excel multi-hoja: expone listSheets() para que el renderer muestre un selector.
 */
import { readFile } from 'fs/promises'
import { extname } from 'path'
import { createLlmProvider } from './llm'
import type { PlanRowInput } from './types'

// ── Tipos públicos ─────────────────────────────────────────────────────────────

export interface BudgetSheet {
  name: string
  rowCount: number
}

export interface BudgetImportResult {
  obra: { obra: string; cliente: string; ref_doc: string; municipio: string }
  plan: PlanRowInput[]
  meta: { format: string; chars: number; sheetName: string | null; rowCount: number }
}

// ── Prompt del LLM ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un extractor de presupuestos de laboratorio de control de calidad de obras en España.
El documento es un presupuesto VALORADO: cada fila ya tiene descripción, número de ensayos y precio.
Tu tarea es extraer las filas de ensayo tal como aparecen, SIN generar nuevos ensayos ni aplicar frecuencias.

── Identificar cabeceras de sección ─────────────────────────────────────────────
Una fila es cabecera de sección cuando:
- El mismo texto aparece repetido en varias columnas (celdas fusionadas en Excel)
- O es texto en mayúsculas sin precio ni cantidad (ej: "1.- CIMENTACIÓN Y ESTRUCTURA", "ENSAYOS DE CARACTERIZACIÓN")
- O aparece como encabezado numerado seguido de subpartidas
Usa esa cabecera como campo "material" para los ensayos que le siguen hasta la siguiente cabecera.

── Filas a IGNORAR ──────────────────────────────────────────────────────────────
- Cabeceras de columna: "ENSAYO", "MUESTREO", "UDS.", "PRECIO UNITARIO €", "IMPORTE €", "Ud", "Nº"
- Filas de total, subtotal, suma: contienen palabras como "TOTAL", "SUBTOTAL", "IVA", "BASE IMPONIBLE", "SUMA"
- Filas vacías o con solo números de página
- Filas de firma, datos del laboratorio, logos

── Extracción de datos ───────────────────────────────────────────────────────────
Para cada fila de ensayo:
  material    → sección/capítulo actual (actualizar al encontrar nueva cabecera)
  description → descripción completa del ensayo / servicio
  n_tests     → número de unidades/ensayos (columna "UDS.", "Nº", cantidad; si no aparece, usa 1)
  unit_price  → precio unitario en € (número; null si no aparece o es 0)
  total       → importe total en € (número; si no aparece, calcula n_tests × unit_price)
  notes       → muestreo, normativa, acreditación (ENAC), o cualquier nota relevante (puede ser vacío)

── Datos de la obra ─────────────────────────────────────────────────────────────
Busca en el encabezado, pie de página o portada del documento:
  obra     → nombre de la obra o proyecto
  cliente  → empresa cliente / promotora
  ref_doc  → número de presupuesto (P-XXXX, 0XXX.XX, ref. expediente)
  municipio → localización de la obra

Devuelve EXCLUSIVAMENTE este JSON (sin texto adicional):
{
  "obra": "...",
  "cliente": "...",
  "ref_doc": "...",
  "municipio": "...",
  "rows": [
    {
      "material": "nombre de la sección",
      "description": "descripción del ensayo",
      "n_tests": 3,
      "unit_price": 90.0,
      "total": 270.0,
      "notes": ""
    }
  ]
}`

// ── Parseo tolerante de JSON ───────────────────────────────────────────────────

function parseJsonLoose<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) {
      try { return JSON.parse(m[0]) as T } catch { return null }
    }
    return null
  }
}

// ── Extracción de texto por hoja (preserva estructura tabular) ─────────────────

function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((t) => t.text).join('').trim()
    }
    if ('result' in v) return String(v.result ?? '').trim()
    if ('text' in v) return String(v.text ?? '').trim()
  }
  return ''
}

async function readXlsxSheet(path: string, sheetName?: string | null): Promise<string> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)

  const ws = sheetName ? wb.getWorksheet(sheetName) ?? wb.worksheets[0] : wb.worksheets[0]
  if (!ws) return ''

  const lines: string[] = [`## ${ws.name}`]
  ws.eachRow((row) => {
    const cells: string[] = []
    row.eachCell({ includeEmpty: false }, (cell) => {
      const t = cellText(cell.value)
      if (t) cells.push(t)
    })
    if (!cells.length) return
    const unique = [...new Set(cells)]
    // Detectar celdas fusionadas: si todos son iguales → fila de cabecera de sección
    const line = unique.length === 1 ? `[SECCIÓN] ${unique[0]}` : cells.join('\t')
    lines.push(line)
  })
  return lines.join('\n')
}

async function readXlsSheet(path: string, sheetName?: string | null): Promise<string> {
  const mod = await import('xlsx')
  const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod
  const wb = XLSX.readFile(path, { cellDates: true })

  const targetName = sheetName ?? wb.SheetNames[0]
  const ws = wb.Sheets[targetName]
  if (!ws) return ''

  const lines: string[] = [`## ${targetName}`]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
  for (const row of rows) {
    const cells = (row as unknown[]).map((c) => (c == null ? '' : String(c).trim())).filter(Boolean)
    if (!cells.length) continue
    const unique = [...new Set(cells)]
    const line = unique.length === 1 ? `[SECCIÓN] ${unique[0]}` : cells.join('\t')
    lines.push(line)
  }
  return lines.join('\n')
}

// ── API pública ────────────────────────────────────────────────────────────────

/** Lista las hojas de un Excel. Devuelve [] para formatos no-Excel. */
export async function listSheets(path: string): Promise<BudgetSheet[]> {
  const ext = extname(path).toLowerCase()
  try {
    if (ext === '.xlsx' || ext === '.xlsm') {
      const ExcelJS = (await import('exceljs')).default
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.readFile(path)
      return wb.worksheets.map((ws) => ({ name: ws.name, rowCount: ws.rowCount }))
    }
    if (ext === '.xls') {
      const mod = await import('xlsx')
      const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod
      const wb = XLSX.readFile(path, { bookSheets: true })
      return wb.SheetNames.map((name) => {
        const ws = wb.Sheets[name]
        const rows = ws ? XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 }) : []
        return { name, rowCount: rows.length }
      })
    }
  } catch {
    // Si falla la lectura, tratamos como no-Excel
  }
  return []
}

/** Extrae el texto de un documento de presupuesto (opcionalmente de una hoja concreta). */
async function extractBudgetText(
  path: string,
  sheetName?: string | null
): Promise<{ text: string; format: string }> {
  const ext = extname(path).toLowerCase()

  if (ext === '.xlsx' || ext === '.xlsm') {
    return { text: await readXlsxSheet(path, sheetName), format: 'xlsx' }
  }
  if (ext === '.xls') {
    return { text: await readXlsSheet(path, sheetName), format: 'xls' }
  }
  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const buffer = new Uint8Array(await readFile(path))
    const pdf = await getDocumentProxy(buffer)
    const { text } = await extractText(pdf, { mergePages: true })
    return { text: text ?? '', format: 'pdf' }
  }
  if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ path })
    return { text: value.trim(), format: 'docx' }
  }
  // TXT / CSV
  return { text: (await readFile(path, 'utf-8')).trim(), format: 'txt' }
}

interface LlmBudgetRow {
  material?: string
  description?: string
  n_tests?: number
  unit_price?: number | null
  total?: number | null
  notes?: string
}

interface LlmBudgetResponse {
  obra?: string
  cliente?: string
  ref_doc?: string
  municipio?: string
  rows?: LlmBudgetRow[]
}

/** Parsea un presupuesto existente y devuelve filas de plan listas para guardar. */
export async function parseBudget(
  path: string,
  sheetName?: string | null
): Promise<BudgetImportResult> {
  const { text, format } = await extractBudgetText(path, sheetName)

  const provider = createLlmProvider()
  const raw = await provider.chat(
    SYSTEM_PROMPT,
    `Extrae las partidas de este presupuesto de laboratorio:\n\n${text.slice(0, 60_000)}`,
    { maxTokens: 8192, timeoutMs: 120_000, tag: 'parse_budget' }
  )

  const parsed = parseJsonLoose<LlmBudgetResponse>(raw)
  const rows = parsed?.rows ?? []

  const plan: PlanRowInput[] = rows
    .filter((r) => r.description && r.description.trim().length > 2)
    .map((r) => {
      const nTests = Math.max(1, Math.round(r.n_tests ?? 1))
      const unitPrice = r.unit_price ?? 0
      const total = r.total ?? nTests * unitPrice
      return {
        type: 'test' as const,
        material: r.material ?? 'Sin clasificar',
        subcategory: '',
        description: (r.description ?? '').trim(),
        measurement: nTests,
        measurement_unit: 'ud',
        freq_qty: 1,
        freq_unit: 'por ud',
        n_lots: 1,
        tests_per_lot: 1,
        n_tests: nTests,
        unit_price: unitPrice,
        total,
        price_source: 'importado',
        rag_score: 1,
        rag_desc: r.notes ?? 'Importado desde presupuesto original'
      }
    })

  return {
    obra: {
      obra: parsed?.obra ?? '',
      cliente: parsed?.cliente ?? '',
      ref_doc: parsed?.ref_doc ?? '',
      municipio: parsed?.municipio ?? ''
    },
    plan,
    meta: {
      format,
      chars: text.length,
      sheetName: sheetName ?? null,
      rowCount: plan.length
    }
  }
}
