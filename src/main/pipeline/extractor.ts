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
    case '.xls':
    case '.xlsm':
      return extractXlsx(path)
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

async function extractXlsx(path: string): Promise<ExtractResult> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  const lines: string[] = []
  wb.eachSheet((ws) => {
    lines.push(`# ${ws.name}`)
    ws.eachRow((row) => {
      const cells: string[] = []
      row.eachCell({ includeEmpty: false }, (cell) => {
        const t = cellText(cell.value)
        if (t) cells.push(t)
      })
      if (cells.length) lines.push(cells.join('\t'))
    })
  })
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
