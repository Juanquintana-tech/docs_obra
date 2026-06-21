/**
 * Parser de presupuestos del laboratorio (.xls/.xlsx) → pares (descripción, precio unitario).
 * Usado por rag:cases y rag:price-book.
 */
import { readdirSync, statSync } from 'fs'
import { join, extname } from 'path'
import XLSX from 'xlsx'

export interface BudgetPair {
  query: string
  price: number
  src: string
  /** año 4 dígitos inferido del nombre de fichero; 0 si desconocido */
  year: number
}

/** Infiere el año del nombre del fichero: busca token de 2 dígitos en [18,30]. */
export function yearFromLabel(label: string): number {
  const tokens = label.match(/(?<!\d)\d{2}(?!\d)/g) ?? []
  const years = tokens.map(Number).filter((n) => n >= 18 && n <= 30)
  return years.length ? 2000 + Math.max(...years) : 0
}

const HEADER_PRICE = /precio\s*unitario|p\.?\s*unitario|precio\s*ud/i
const HEADER_DESC  = /ensayo|concepto|descrip|normativa/i

// Fila de capítulo/sección que no debe incluirse como ensayo.
const CHAPTER =
  /^\s*(\d+\s*[.\-)]|cap[ií]tulo|movimiento de tierras|cimentaci|estructura|firme|varios|albañiler|relleno|terraplen|terraplén|zahorra|hormig[oó]n|mezcla|escollera|acero|campaña|marcas viales)/i

// Pistas de que la fila es un ensayo de laboratorio o servicio de campo facturable.
// TEST (lab/campo): UNE, NLT, ASTM, determinación, granulometría, proctor, etc.
const TEST_HINT =
  /une|nlt|astm|\ben\s*\d|determinaci|ensayo|granulometr|proctor|densidad|índice|indice|contenido|resistencia|toma de muestra|equivalente|límites|limites|análisis|analisis|cbr|atterberg|compactaci|espesor|extracci|penetraci|consistencia|hinchamiento|triaxial|edómetro|edometro|corte\s+directo|compresión\s+simple|compresion\s+simple|permeabilidad|lavado|desgaste|ángeles|lajas|árido|arido|ligante|betún|betun|emulsión|emulsion|asentamiento/i
// SERVICIO (ítem BOM que ya es un servicio): perforación, sondeo, SPT, movilización, etc.
const SERVICE_HINT =
  /perforaci[oó]n|sondeo|spt|presióm|presiom|testigo|parafinado|piezóm|piezom|nivel\s+piezom|arqueta|movilizaci[oó]n|traslado\s+de\s+sond|toma\s+de\s+muestra\s+de\s+agua|caja\s+portates|tubo\s+ranurado|georreferen|apertura\s+y\s+preparaci[oó]n|videoc[aá]mara|estanqueidad|iri\b|crt\b|retroreflect|retrorreflect|retrorrreflect|macrotextura|km\s+de\s+carril|desplazamiento\s+de\s+equipo|inspecci[oó]n\s+(de\s+media\s+jornada|por\s+técnico)|ecodyn|medici[oó]n\s+de\s+iri/i

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null) return null
  const n = parseFloat(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function extractFromFile(path: string, label: string): BudgetPair[] {
  const out: BudgetPair[] = []
  const year = yearFromLabel(label)
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
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const price = toNum(row[colPrice])
      if (!desc || desc.length < 8 || price == null || price <= 0 || price > 8000) continue
      if (CHAPTER.test(desc)) continue
      if (!TEST_HINT.test(desc) && !SERVICE_HINT.test(desc)) continue
      out.push({ query: desc, price, src: label, year })
    }
  }
  return out
}

/**
 * Recorre una o varias carpetas de presupuestos y devuelve todos los pares (sin dedup).
 * Soporta hasta 2 niveles de profundidad (carpeta/subcarpeta/archivo.xls).
 */
export function extractBudgetPairs(...bases: string[]): BudgetPair[] {
  const pairs: BudgetPair[] = []
  for (const base of bases) {
    let entries: string[]
    try { entries = readdirSync(base) } catch { continue }
    for (const entry of entries) {
      const entryPath = join(base, entry)
      try {
        if (statSync(entryPath).isDirectory()) {
          // un nivel más dentro (Ejemplo 1/, Ejemplo 2/, etc.)
          for (const f of readdirSync(entryPath)) {
            const ext = extname(f).toLowerCase()
            if (ext !== '.xls' && ext !== '.xlsx') continue
            const fp = join(entryPath, f)
            // excluir archivos claramente no-presupuesto CYE
            if (/medicion|totalizad|plantilla|tarifas\s*alagal/i.test(f)) continue
            pairs.push(...extractFromFile(fp, `${entry}/${f}`))
          }
        } else {
          // archivo directamente en la raíz de la carpeta
          const ext = extname(entry).toLowerCase()
          if (ext !== '.xls' && ext !== '.xlsx') continue
          if (/medicion|totalizad|plantilla|tarifas\s*alagal/i.test(entry)) continue
          pairs.push(...extractFromFile(entryPath, entry))
        }
      } catch { /* skip */ }
    }
  }
  return pairs
}

export const DEFAULT_BUDGETS_DIRS: string[] = [
  '/Users/usuario/Desktop/Nigal/Proyects/CYE/Proyecto_docs_obra/Docs_post_demo_1/Presupuestos',
  '/Users/usuario/Desktop/Nigal/Proyects/CYE/Proyecto_docs_obra/presupuestos'
]

// Retrocompatibilidad: acepta string o usa DEFAULT
export const DEFAULT_BUDGETS_DIR = DEFAULT_BUDGETS_DIRS[0]
