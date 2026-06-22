/**
 * Extractor de texto multi-formato. Los inputs reales del laboratorio pueden ser
 * PDF, Word (.docx) o Excel (.xlsx/.xls) con las cantidades de obra. Dispatcher
 * por extensión → texto plano que alimenta al classifier.
 *
 *   .pdf         → unpdf (pdf.js); detecta escaneado (needsOcr)
 *   .docx        → mammoth (texto plano)
 *   .xlsx / .xls → exceljs (todas las hojas, fila a fila)
 *   .txt         → lectura directa
 *
 * OCR de PDFs escaneados: DIFERIDO (ver PLAN.md) — texto nativo es el caso dominante.
 */
import { readFile } from 'fs/promises'
import { extname } from 'path'
import { extractText as unpdfExtractText, getDocumentProxy } from 'unpdf'

export type DocFormat = 'pdf' | 'docx' | 'xlsx' | 'txt'

export interface ExtractResult {
  text: string
  format: DocFormat
  /** páginas (solo PDF; 0 en otros formatos) */
  totalPages: number
  method: 'native' | 'ocr'
  /** true si el PDF parece escaneado (poco texto por página) y haría falta OCR. */
  needsOcr: boolean
}

/** Umbral de caracteres por página por debajo del cual se sospecha PDF escaneado. */
const MIN_CHARS_PER_PAGE = 50

/** Punto de entrada: detecta el formato por extensión y extrae el texto. */
export async function extractDocument(path: string): Promise<ExtractResult> {
  const ext = extname(path).toLowerCase()
  switch (ext) {
    case '.pdf':
      return extractPdf(path)
    case '.docx':
      return extractDocx(path)
    case '.xlsx':
    case '.xlsm':
      return extractXlsx(path)
    case '.xls':
      // Formato binario legacy (BIFF): exceljs no lo lee → SheetJS.
      return extractXlsLegacy(path)
    case '.txt':
    case '.md':
    case '.csv':
      return {
        text: (await readFile(path, 'utf-8')).trim(),
        format: 'txt',
        totalPages: 0,
        method: 'native',
        needsOcr: false
      }
    default:
      throw new Error(
        `Formato no soportado: ${ext || '(sin extensión)'} — usa PDF, DOCX, XLSX o TXT`
      )
  }
}

async function extractPdf(path: string): Promise<ExtractResult> {
  const buffer = new Uint8Array(await readFile(path))
  const pdf = await getDocumentProxy(buffer)
  const { totalPages, text } = await unpdfExtractText(pdf, { mergePages: true })
  const merged = (text ?? '').trim()
  const needsOcr = totalPages > 0 && merged.length < MIN_CHARS_PER_PAGE * totalPages
  return { text: merged, format: 'pdf', totalPages, method: 'native', needsOcr }
}

async function extractDocx(path: string): Promise<ExtractResult> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ path })
  return { text: value.trim(), format: 'docx', totalPages: 0, method: 'native', needsOcr: false }
}

/** Unidades de medida habituales en obra civil española. */
const UNITS_RE = /^(m3|m²|m2|m³|ml|m\b|t\b|kg|ud|uds?|l)\s+/i

/**
 * Normaliza una fila de tabla de medición donde el primer campo puede ser
 * "UNIDAD descripción" (p.ej. "m3 terraplén") y el segundo la cantidad.
 * Transforma a "CANTIDAD UNIDAD descripción" para que el LLM lo reconozca.
 * Las columnas adicionales (lotes, muestras) se descartan si son solo números.
 */
function normalizeXlsxRow(cells: string[]): string {
  if (cells.length < 2) return cells.join('\t')
  const first = cells[0].trim()
  const unitMatch = first.match(UNITS_RE)
  if (!unitMatch) return cells.join('\t')
  const unit = unitMatch[1]
  const desc = first.slice(unitMatch[0].length).trim()
  const qty = cells[1].trim()
  if (!qty || isNaN(Number(qty.replace(',', '.')))) return cells.join('\t')
  // Conserva la descripción extendida si la hay en columnas posteriores (texto, no números)
  const extra = cells
    .slice(2)
    .filter((c) => isNaN(Number(c.replace(',', '.'))) && c.trim().length > 2)
    .join('; ')
  return extra
    ? `${qty} ${unit} ${desc} (${extra})`
    : `${qty} ${unit} ${desc}`
}

async function extractXlsx(path: string): Promise<ExtractResult> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const lines: string[] = []
  const seen = new Set<string>()
  wb.eachSheet((ws) => {
    const sheetLines: string[] = []
    ws.eachRow((row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = cellText(cell.value)
        if (t) cells.push(t)
      })
      if (!cells.length) return
      // Colapsar celdas fusionadas (mismo valor repetido en N columnas)
      const unique = [...new Set(cells)]
      const deduped = unique.length === 1 ? unique : cells
      const raw = deduped.join('\t')
      if (seen.has(raw)) return
      seen.add(raw)
      sheetLines.push(normalizeXlsxRow(deduped))
    })
    if (sheetLines.length) {
      lines.push(`# ${ws.name}`)
      lines.push(...sheetLines)
    }
  })
  return {
    text: lines.join('\n').trim(),
    format: 'xlsx',
    totalPages: 0,
    method: 'native',
    needsOcr: false
  }
}

/** Lee .xls binario legacy (BIFF) con SheetJS. Mismo formato de salida que extractXlsx. */
async function extractXlsLegacy(path: string): Promise<ExtractResult> {
  const mod = await import('xlsx')
  const XLSX = (mod as unknown as { default?: typeof mod }).default ?? mod
  const wb = XLSX.readFile(path, { cellDates: true })
  const lines: string[] = []
  const seen = new Set<string>()
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const sheetLines: string[] = []
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
    for (const row of rows) {
      const cells = (row as unknown[])
        .map((c) => (c == null ? '' : String(c).trim()))
        .filter(Boolean)
      if (!cells.length) continue
      const unique = [...new Set(cells)]
      const deduped = unique.length === 1 ? unique : cells
      const raw = deduped.join('\t')
      if (seen.has(raw)) continue
      seen.add(raw)
      sheetLines.push(normalizeXlsxRow(deduped))
    }
    if (sheetLines.length) {
      lines.push(`# ${name}`)
      lines.push(...sheetLines)
    }
  }
  return {
    text: lines.join('\n').trim(),
    format: 'xlsx',
    totalPages: 0,
    method: 'native',
    needsOcr: false
  }
}

/** Extrae texto plano de una celda exceljs (richText / hyperlink / fórmula / fecha). */
function cellText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((t) => t.text).join('')
    }
    if ('text' in v) return String(v.text)
    if ('result' in v) return String(v.result)
  }
  return ''
}
