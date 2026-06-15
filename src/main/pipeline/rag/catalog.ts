import ExcelJS from 'exceljs'
import { normalize } from './normalize'

export const CATALOG_SHEET = 'Versión  0 28-02-2025'

export interface CatalogEntry {
  codigo: string
  descripcion: string
  precio: number
  categoria: string
  /** texto normalizado (categoría + descripción) para indexar */
  doc: string
}

/** Extrae el texto plano de una celda exceljs (admite richText / hyperlink / fórmula). */
function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text: string }>).map((t) => t.text).join('')
    }
    if ('text' in v) return String(v.text)
    if ('result' in v) return String(v.result)
  }
  return ''
}

function cellNumber(value: ExcelJS.CellValue): number | null {
  if (typeof value === 'number') return value
  if (typeof value === 'object' && value != null && 'result' in (value as object)) {
    const r = (value as { result: unknown }).result
    if (typeof r === 'number') return r
  }
  const s = cellText(value).trim()
  if (!s) return null
  const n = Number(s.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Carga el catálogo ALAGAL desde el xlsx. Replica la lógica de rag_pricer._build_index:
 * filas con precio > 0 son ensayos; las filas sin precio son categorías padre que
 * enriquecen semánticamente cada ensayo (parent_cat por prefijo de código).
 */
export async function loadCatalog(xlsxPath: string): Promise<CatalogEntry[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(xlsxPath)
  const ws = wb.getWorksheet(CATALOG_SHEET)
  if (!ws) throw new Error(`No se encontró la hoja "${CATALOG_SHEET}" en ${xlsxPath}`)

  interface Raw {
    codigo: string
    descripcion: string
    precio: number | null
  }
  const rows: Raw[] = []
  ws.eachRow((row, n) => {
    if (n === 1) return // cabecera
    const codigo = cellText(row.getCell(1).value).trim()
    const descripcion = cellText(row.getCell(2).value).trim()
    if (!codigo || !descripcion) return
    rows.push({ codigo, descripcion, precio: cellNumber(row.getCell(3).value) })
  })

  // Mapa de categorías (filas sin precio) → descripción, indexadas por su código.
  const catMap = new Map<string, string>()
  for (const r of rows) if (r.precio == null) catMap.set(r.codigo, r.descripcion)

  const parentCat = (code: string): string => {
    const parts = code.replace(/\.+$/, '').split('.')
    for (let depth = parts.length - 1; depth > 0; depth--) {
      const key = parts.slice(0, depth).join('.') + '.'
      const found = catMap.get(key)
      if (found) return found
    }
    return ''
  }

  const entries: CatalogEntry[] = []
  for (const r of rows) {
    if (r.precio == null || r.precio <= 0) continue
    const categoria = parentCat(r.codigo)
    const docRaw = categoria ? `${categoria} ${r.descripcion}` : r.descripcion
    entries.push({
      codigo: r.codigo,
      descripcion: r.descripcion,
      precio: r.precio,
      categoria,
      doc: normalize(docRaw)
    })
  }
  return entries
}
