/**
 * Parser de presupuestos existentes de laboratorio.
 *
 * EXCEL (xlsx/xls): extracción PROGRAMÁTICA — lee celdas directamente, detecta
 *   cabeceras de sección por repetición, y mapea columnas por cabecera de tabla.
 *   No necesita LLM para los datos; solo lo usa para extraer info de la obra.
 *
 * PDF / DOCX / TXT: extracción por LLM con prompt permisivo (las tablas en PDF
 *   no tienen estructura programática fiable).
 */
import { readFile } from 'fs/promises'
import { extname, basename } from 'path'
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

// ── Utilidades numéricas ───────────────────────────────────────────────────────

/** Parsea número en formato español ("1.234,56" → 1234.56). */
function parseNum(s: string): number | null {
  if (!s || !s.trim()) return null
  const cleaned = s.trim().replace(/[€\s%]/g, '').replace(/\./g, '').replace(',', '.')
  const n = parseFloat(cleaned)
  return isNaN(n) ? null : n
}

function isNumStr(s: string): boolean {
  return parseNum(s) !== null
}

// ── Utilidades de celda ExcelJS ────────────────────────────────────────────────

function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (Array.isArray(v.richText))
      return (v.richText as Array<{ text: string }>).map((t) => t.text).join('').trim()
    if ('result' in v) return String(v.result ?? '').trim()
    if ('text' in v) return String(v.text ?? '').trim()
  }
  return ''
}

// ── Lectura de hojas como matriz de celdas ─────────────────────────────────────

type RawRow = string[] // valores de celda (puede incluir vacíos si includeEmpty=true)

async function readXlsxRows(path: string, sheetName?: string | null): Promise<RawRow[]> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const ws = sheetName ? (wb.getWorksheet(sheetName) ?? wb.worksheets[0]) : wb.worksheets[0]
  if (!ws) return []

  const rows: RawRow[] = []
  ws.eachRow((row) => {
    // Leer todas las celdas, incluyendo vacías, hasta la última columna con valor
    const maxCol = ws.columnCount || 8
    const cells: string[] = []
    for (let ci = 1; ci <= maxCol; ci++) {
      cells.push(cellText(row.getCell(ci).value))
    }
    // Recortar celdas vacías al final
    while (cells.length > 0 && !cells[cells.length - 1]) cells.pop()
    rows.push(cells)
  })
  return rows
}

async function readXlsRows(path: string, sheetName?: string | null): Promise<RawRow[]> {
  const mod = await import('xlsx')
  const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod
  const wb = XLSX.readFile(path, { cellDates: true })
  const targetName = sheetName ?? wb.SheetNames[0]
  const ws = wb.Sheets[targetName]
  if (!ws) return []
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
  return raw.map((row) => (row as unknown[]).map((c) => (c == null ? '' : String(c).trim())))
}

// ── Detección de tipos de fila ─────────────────────────────────────────────────

function isSkipRow(cells: string[]): boolean {
  const joined = cells.join(' ').toLowerCase().replace(/\./g, '')
  return /\b(total|subtotal|iva|base imponible|suma\b|tope\b|presupuesto total)/.test(joined)
}

/**
 * Fila de cabecera de SECCIÓN: todas las celdas no vacías tienen el mismo valor.
 * Ej: ["1.- CIMENTACIÓN", "1.- CIMENTACIÓN", "1.- CIMENTACIÓN", ...]
 */
function detectSectionHeader(cells: string[]): string | null {
  const nonEmpty = cells.filter((c) => c.length > 0)
  if (nonEmpty.length < 2) return null
  const unique = new Set(nonEmpty)
  return unique.size === 1 ? nonEmpty[0] : null
}

/**
 * Fila de cabecera de TABLA: contiene algún indicador de descripción y alguno de precio.
 */
function isTableHeader(cells: string[]): boolean {
  const joined = cells.join(' ').toLowerCase()
  return (
    /ensayo|descripci[oó]n|prueba|concepto/.test(joined) &&
    /precio|importe|coste|euros?|€/.test(joined)
  )
}

/**
 * Fila de SUB-MATERIAL: col 0 tiene un nombre de material, el resto está vacío
 * o repite el mismo valor (medición fusionada). No tiene precio real.
 * Ej: ["Acero corrugado B 500 S", "", "", "", "", ""]
 * Ej: ["Cimentación HA-30", "65 m3", "65 m3", "65 m3", "65 m3", "65 m3"]
 */
function detectSubMaterial(cells: string[]): string | null {
  if (!cells[0] || cells[0].length < 3) return null
  const rest = cells.slice(1).filter((c) => c.length > 0)
  // Sin otras celdas → solo etiqueta de material
  if (rest.length === 0) return cells[0]
  // Todas las demás celdas repiten el mismo valor → medición fusionada (p.ej. "42 m3")
  // IMPORTANTE: comprobar esto ANTES de parseNum para evitar que "42 m3" se interprete
  // como numérico y se clasifique erróneamente como fila de ensayo.
  const unique = new Set(rest)
  if (unique.size === 1) return cells[0]
  // Sin números en cols de precio → también sub-material
  const numericCols = cells.slice(3, 6).filter((c) => c.length > 0)
  if (!numericCols.some(isNumStr)) return cells[0]
  return null
}

// ── Detección de columnas desde la fila de cabecera ───────────────────────────

interface ColMap {
  desc: number    // columna de descripción del ensayo
  ntests: number  // columna de UDS. / nº ensayos
  price: number   // columna PRECIO UNITARIO
  total: number   // columna IMPORTE
}

function detectColMap(headerCells: string[]): ColMap {
  let desc = 0, ntests = -1, price = -1, total = -1

  headerCells.forEach((h, i) => {
    const lower = h.toLowerCase().trim()
    if (/ensayo|descripci[oó]n|concepto|normativa/.test(lower)) desc = i
    else if (/uds?\.?\s*$|^n\.?\s*(ens|ud)|^n[uú]m|^medici[oó]n|^cantidad/.test(lower)) ntests = i
    else if (/precio unitario/.test(lower)) price = i
    else if (/^importe|total/.test(lower)) total = i
  })

  // Fallback: si no detectamos por nombre, usar posiciones por defecto.
  // Estructura típica: col0=desc, col1=muestreo, col2=base, col3=UDS, col4=PRECIO, col5=IMPORTE.
  // Importante: asegurar que price ≠ ntests para evitar que una columna "UDS." en col4
  // haga coincidir ambos índices y multiplique cantidades como si fueran precios.
  if (ntests === -1) ntests = Math.min(3, headerCells.length - 1)
  if (price === -1) {
    price = Math.min(4, headerCells.length - 1)
    if (price === ntests) price = ntests + 1
  }
  if (total === -1) {
    total = Math.min(5, headerCells.length - 1)
    if (total === price || total === ntests) total = Math.max(price, ntests) + 1
  }

  return { desc, ntests, price, total }
}

// ── Extracción programática desde matriz de celdas ───────────────────────────

function extractRowsFromMatrix(rows: RawRow[]): {
  plan: Omit<PlanRowInput, 'price_source' | 'rag_score' | 'rag_desc'>[]
  introLines: string[]
} {
  // 1. Encontrar fila de cabecera de tabla
  const headerIdx = rows.findIndex(isTableHeader)
  const colMap = headerIdx >= 0 ? detectColMap(rows[headerIdx]) : { desc: 0, ntests: 3, price: 4, total: 5 }

  // Líneas anteriores a la cabecera → posible info de la obra
  const introLines = rows.slice(0, Math.max(0, headerIdx))
    .map((r) => r.filter(Boolean).join(' '))
    .filter(Boolean)

  const plan: Omit<PlanRowInput, 'price_source' | 'rag_score' | 'rag_desc'>[] = []
  let currentMaterial = 'General'
  let currentSubMaterial = ''

  const dataRows = rows.slice(headerIdx + 1)

  for (const row of dataRows) {
    if (row.length === 0 || row.every((c) => !c)) continue
    if (isSkipRow(row)) continue

    // ¿Cabecera de sección?
    const section = detectSectionHeader(row)
    if (section) {
      // Limpiar numeración inicial tipo "1.- " o "1) "
      currentMaterial = section.replace(/^\d+[\.\-\)]\s*/, '').trim()
      currentSubMaterial = ''
      continue
    }

    // ¿Sub-material (material sin precio)?
    const subMat = detectSubMaterial(row)
    if (subMat) {
      currentSubMaterial = subMat
      continue
    }

    // ¿Fila de ensayo? Necesita descripción y precio
    const desc = row[colMap.desc]?.trim()
    if (!desc || desc.length < 3) continue

    const nTests = parseNum(row[colMap.ntests] ?? '')
    const unitPrice = parseNum(row[colMap.price] ?? '')
    const total = parseNum(row[colMap.total] ?? '')

    // Fila de subtotal de sección: hay total pero no precio unitario ni nº ensayos
    // Ej: ["", "", "", "MOVIMIENTO DE TIERRAS", "", "3807"]
    if (unitPrice === null && nTests === null && total !== null) {
      currentMaterial = desc.replace(/^\d+[\.\-\)]\s*/, '').trim()
      currentSubMaterial = ''
      continue
    }

    // Si no hay ningún número de precio, no es una fila de ensayo
    if (unitPrice === null && total === null) {
      // Podría ser otro sub-material sin medición
      if (row.slice(1).every((c) => !c || !isNumStr(c))) {
        currentSubMaterial = desc
      }
      continue
    }

    const resolvedN = nTests ?? (unitPrice && total ? Math.round(total / unitPrice) : 1)
    const resolvedPrice = unitPrice ?? (total && resolvedN ? total / resolvedN : 0)
    const resolvedTotal = total ?? resolvedN * resolvedPrice

    const material = currentSubMaterial
      ? `${currentMaterial} — ${currentSubMaterial}`
      : currentMaterial

    plan.push({
      type: 'test',
      material,
      subcategory: '',
      description: desc,
      measurement: resolvedN,
      measurement_unit: 'ud',
      freq_qty: 1,
      freq_unit: 'por ud',
      n_lots: 1,
      tests_per_lot: 1,
      n_tests: resolvedN,
      unit_price: resolvedPrice,
      total: resolvedTotal,
    })
  }

  return { plan, introLines }
}

// ── LLM — solo para obras/PDF/Word ────────────────────────────────────────────

const OBRA_INFO_PROMPT = `Eres un asistente especializado en documentación de obras de construcción.
Busca en el texto los datos administrativos de la obra. Las etiquetas habituales son:
  "OBRA:", "Descripción:", "Proyecto:", "CLAVE:", "Denominación:" → campo "obra"
  "CLIENTE:", "PETICIONARIO:", "Promotor:", "Propiedad:", "U.T.E." → campo "cliente"
  "REF. LABORATORIO:", "Referencia:", "Expediente:", "Nº Oferta:", "Ref.:", "P/" → campo "ref_doc"
  "MUNICIPIO:", "T.M.", "Término Municipal:", "Localidad:", "Provincia:" → campo "municipio"
Si un campo no aparece, devuelve cadena vacía. Devuelve SOLO este JSON (sin texto adicional):
{"obra":"","cliente":"","ref_doc":"","municipio":""}`

async function extractObraFromText(text: string): Promise<{
  obra: string; cliente: string; ref_doc: string; municipio: string
}> {
  if (!text.trim()) return { obra: '', cliente: '', ref_doc: '', municipio: '' }
  try {
    const provider = createLlmProvider()
    const raw = await provider.chat(
      OBRA_INFO_PROMPT,
      `Texto del documento:\n${text.slice(0, 3000)}`,
      { maxTokens: 256, timeoutMs: 30_000, tag: 'budget_obra_info' }
    )
    const m = raw.match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
  } catch { /* devuelve vacío */ }
  return { obra: '', cliente: '', ref_doc: '', municipio: '' }
}

// ── Prompt LLM para PDF/Word ───────────────────────────────────────────────────

const PDF_SYSTEM_PROMPT = `Eres un extractor de presupuestos de laboratorio de control de calidad en obras de construcción.

Las tablas tienen este formato de columnas (de izquierda a derecha):
  MEDICIÓN | FRECUENCIA/MÍNIMO | Ud | DESCRIPCIÓN DEL ENSAYO | PRECIO UNITARIO € | TOTAL €

REGLAS DE EXTRACCIÓN POR FILA:
- description: el texto largo del ensayo (columna DESCRIPCIÓN, con nombre del ensayo y norma UNE/NLT)
- n_tests: el PRIMER número de la fila = columna MEDICIÓN (entero o decimal, ej: 2, 5, 75, 2054)
  * ATENCIÓN: este número está al inicio de la fila, ANTES de la descripción
  * NO es el precio unitario (que va al final)
- unit_price: el PENÚLTIMO número de la fila = columna PRECIO UNITARIO
- total: el ÚLTIMO número de la fila = columna TOTAL/IMPORTE (≈ n_tests × unit_price)

EJEMPLO CORRECTO:
  Fila: "2,00 | 1/10 lotes | Ud | Densidad por el método de la arena... | 9,00 | 18,00"
  → n_tests=2, unit_price=9.0, total=18.0   (porque 2 × 9 = 18 ✓)
  INCORRECTO sería: n_tests=9, unit_price=18 (confundir precio con cantidad)

VERIFICACIÓN: n_tests × unit_price debe aproximarse al total. Si no cuadra, reasigna.

Para el campo "material": usa la última cabecera de sección/capítulo que apareció en el texto
(línea en negrita o mayúsculas sin precio, ej: "MOVIMIENTO DE TIERRAS", "FIRMES Y PAVIMENTOS").
Si no hay sección clara, usa "General".

INCLUYE todas las filas con descripción de ensayo/servicio y precio unitario.
OMITE SOLO: cabeceras de columna, filas de TOTAL/SUBTOTAL/IVA/BASE IMPONIBLE, líneas vacías.

Devuelve EXCLUSIVAMENTE este JSON (sin texto fuera del JSON):
{
  "obra":"","cliente":"","ref_doc":"","municipio":"",
  "rows":[
    {"material":"nombre sección","description":"descripción ensayo","n_tests":2,"unit_price":9.0,"total":18.0}
  ]
}`

async function parsePdfBudget(text: string, format: string): Promise<{
  obra: { obra: string; cliente: string; ref_doc: string; municipio: string }
  rows: Array<{ material?: string; description?: string; n_tests?: number; unit_price?: number | null; total?: number | null }>
}> {
  const provider = createLlmProvider()
  const raw = await provider.chat(
    PDF_SYSTEM_PROMPT,
    `Extrae TODAS las partidas de este presupuesto de laboratorio:\n\n${text.slice(0, 60_000)}`,
    { maxTokens: 16_384, timeoutMs: 180_000, tag: 'parse_budget_pdf' }
  )

  const m = raw.match(/\{[\s\S]*\}/)
  if (!m) return { obra: { obra: '', cliente: '', ref_doc: '', municipio: '' }, rows: [] }
  try {
    const parsed = JSON.parse(m[0])
    return {
      obra: { obra: parsed.obra ?? '', cliente: parsed.cliente ?? '', ref_doc: parsed.ref_doc ?? '', municipio: parsed.municipio ?? '' },
      rows: Array.isArray(parsed.rows) ? parsed.rows : []
    }
  } catch {
    return { obra: { obra: '', cliente: '', ref_doc: '', municipio: '' }, rows: [] }
  }
}

// ── API pública ────────────────────────────────────────────────────────────────

/** Lista las hojas de un Excel (devuelve [] para no-Excel). */
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
      return wb.SheetNames.map((name) => ({ name, rowCount: 0 }))
    }
  } catch { /* no-op */ }
  return []
}

function rowsToplanRows(
  rows: Array<{ material?: string; description?: string; n_tests?: number; unit_price?: number | null; total?: number | null }>,
  notes = ''
): PlanRowInput[] {
  return rows
    .filter((r) => r.description && r.description.trim().length > 2)
    .map((r) => {
      const nTests = Math.max(1, Math.round(r.n_tests ?? 1))
      const unitPrice = r.unit_price ?? 0
      const total = r.total ?? nTests * unitPrice
      return {
        type: 'test' as const,
        material: r.material ?? 'General',
        subcategory: '',
        description: r.description!.trim(),
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
        rag_desc: notes
      }
    })
}

/** Parsea un presupuesto existente y devuelve filas de plan listas para guardar. */
export async function parseBudget(
  path: string,
  sheetName?: string | null
): Promise<BudgetImportResult> {
  const ext = extname(path).toLowerCase()
  const refFromFilename = basename(path, ext).replace(/\s+/g, '-')

  // ── EXCEL: extracción programática ──────────────────────────────────────
  if (ext === '.xlsx' || ext === '.xlsm' || ext === '.xls') {
    const rawRows = ext === '.xls'
      ? await readXlsRows(path, sheetName)
      : await readXlsxRows(path, sheetName)

    const { plan: extracted, introLines } = extractRowsFromMatrix(rawRows)

    // Info de la obra: combinar intro + cualquier línea del sheet con keywords de obra.
    // Los Excel de presupuesto a veces tienen el nombre de la obra en celdas dispersas
    // (no necesariamente antes de la tabla) o directamente no lo incluyen.
    const obraKeywordLines = rawRows
      .map((r) => r.filter(Boolean).join(' '))
      .filter((line) => /\b(obra|proyecto|clave|peticion|municipio|t\.m\b|ref\.?\s*lab|cliente|promotor)/i.test(line))
    const obraSearchText = [...new Set([...introLines, ...obraKeywordLines])].join('\n')
    const obraInfo = await extractObraFromText(obraSearchText)
    if (!obraInfo.ref_doc) obraInfo.ref_doc = refFromFilename

    const plan: PlanRowInput[] = extracted.map((r) => ({
      ...r,
      price_source: 'importado',
      rag_score: 1,
      rag_desc: 'Importado desde presupuesto original'
    }))

    const chars = rawRows.flat().join('').length
    return {
      obra: obraInfo,
      plan,
      meta: {
        format: ext.slice(1),
        chars,
        sheetName: sheetName ?? null,
        rowCount: plan.length
      }
    }
  }

  // ── PDF / DOCX / TXT: extracción por LLM ─────────────────────────────────
  let text = ''
  let format = 'txt'

  if (ext === '.pdf') {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const buffer = new Uint8Array(await readFile(path))
    const pdf = await getDocumentProxy(buffer)
    const result = await extractText(pdf, { mergePages: true })
    text = result.text ?? ''
    format = 'pdf'
  } else if (ext === '.docx') {
    const mammoth = await import('mammoth')
    const { value } = await mammoth.extractRawText({ path })
    text = value.trim()
    format = 'docx'
  } else {
    text = (await readFile(path, 'utf-8')).trim()
    format = 'txt'
  }

  const { obra, rows } = await parsePdfBudget(text, format)
  if (!obra.ref_doc) obra.ref_doc = refFromFilename

  const plan = rowsToplanRows(rows, 'Importado desde presupuesto original')

  return {
    obra,
    plan,
    meta: { format, chars: text.length, sheetName: null, rowCount: plan.length }
  }
}
