/**
 * Parser compartido de presupuestos del laboratorio (.xls/.xlsx) → pares
 * (descripción de ensayo, precio unitario). Lo usan rag:cases (set de validación)
 * y rag:price-book (libro de precios propio).
 */
import { readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import XLSX from 'xlsx'

export interface BudgetPair {
  query: string
  price: number
  src: string
}

const HEADER_PRICE = /precio\s*unitario|p\.?\s*unitario|precio\s*ud/i
const HEADER_DESC = /ensayo|concepto|descrip|normativa/i
const CHAPTER =
  /^\s*(\d+\s*[.\-)]|cap[ií]tulo|movimiento de tierras|cimentaci|estructura|firmes?|varios|albañiler)/i
const TEST_HINT =
  /une|nlt|astm|en\s|determinaci|ensayo|granulometr|proctor|densidad|índice|indice|contenido|resistencia|toma de muestra|equivalente|límites|limites|análisis|analisis|cbr|atterberg|compactaci|espesor|extracci|penetraci|consistencia/i

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null) return null
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function extractFromFile(path: string, label: string): BudgetPair[] {
  const out: BudgetPair[] = []
  let sheets: unknown[][][]
  try {
    const wb = XLSX.readFile(path, { cellDates: true })
    sheets = wb.SheetNames.map((n) =>
      XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, blankrows: false })
    )
  } catch {
    return out
  }
  for (const rows of sheets) {
    let colPrice = -1
    let colDesc = -1
    for (const row of rows) {
      const idxP = row.findIndex((c) => HEADER_PRICE.test(String(c ?? '')))
      if (idxP >= 0) {
        colPrice = idxP
        const idxD = row.findIndex((c) => HEADER_DESC.test(String(c ?? '')))
        colDesc = idxD >= 0 ? idxD : 0
        break
      }
    }
    if (colPrice < 0) continue
    for (const row of rows) {
      const desc = String(row[colDesc] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      const price = toNum(row[colPrice])
      if (!desc || desc.length < 10 || price == null || price <= 0 || price > 5000) continue
      if (CHAPTER.test(desc)) continue
      if (!TEST_HINT.test(desc)) continue
      out.push({ query: desc, price, src: label })
    }
  }
  return out
}

/** Recorre la carpeta de presupuestos y devuelve TODOS los pares (sin dedup). */
export function extractBudgetPairs(base: string): BudgetPair[] {
  const pairs: BudgetPair[] = []
  for (const dir of readdirSync(base)) {
    const dirPath = join(base, dir)
    if (!statSync(dirPath).isDirectory()) continue
    for (const f of readdirSync(dirPath)) {
      const ext = extname(f).toLowerCase()
      if (ext !== '.xls' && ext !== '.xlsx') continue
      pairs.push(...extractFromFile(join(dirPath, f), `${dir}/${f}`))
    }
  }
  return pairs
}

export const DEFAULT_BUDGETS_DIR =
  '/Users/usuario/Desktop/Proyecto_docs_obra/Docs_post_demo_1/Presupuestos'

export function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
