/**
 * Construye un set de validación del RAG a partir de presupuestos REALES del
 * laboratorio. Cada línea valorada (descripción de ensayo + precio unitario) se
 * convierte en un caso { query, expected_price }.
 *
 *   npm run rag:cases -- "/ruta/a/Presupuestos"
 *
 * Salida: resources/knowledge/cases_reales.json (GITIGNORED — contiene precios y
 * datos reales del laboratorio). Luego: npm run rag:eval -- resources/knowledge/cases_reales.json
 *
 * Heurística: localiza la fila de cabecera (col con "precio unitario" y col con
 * "ensayo/concepto/descripción"); por cada fila siguiente con descripción y un
 * precio numérico válido emite un caso. Las cabeceras de capítulo/material no
 * tienen precio unitario → se descartan solas.
 */
import { readdirSync, statSync, writeFileSync } from 'fs'
import { resolve, join, extname } from 'path'
import XLSX from 'xlsx'

interface Caso {
  query: string
  expected_price: number
  _src: string
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

function rowsOf(path: string): unknown[][][] {
  const wb = XLSX.readFile(path, { cellDates: true })
  return wb.SheetNames.map((n) =>
    XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, blankrows: false })
  )
}

function extractFromFile(path: string, label: string): Caso[] {
  const out: Caso[] = []
  let sheets: unknown[][][]
  try {
    sheets = rowsOf(path)
  } catch {
    return out
  }
  for (const rows of sheets) {
    // localizar cabecera
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
    if (colPrice < 0) continue // hoja sin tabla de precios reconocible
    for (const row of rows) {
      const desc = String(row[colDesc] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      const price = toNum(row[colPrice])
      if (!desc || desc.length < 10 || price == null || price <= 0 || price > 5000) continue
      if (CHAPTER.test(desc)) continue
      if (!TEST_HINT.test(desc)) continue
      out.push({ query: desc, expected_price: price, _src: label })
    }
  }
  return out
}

function main(): void {
  const base =
    process.argv[2] ?? '/Users/usuario/Desktop/Proyecto_docs_obra/Docs_post_demo_1/Presupuestos'
  const cases: Caso[] = []
  const perFile: Record<string, number> = {}

  for (const dir of readdirSync(base)) {
    const dirPath = join(base, dir)
    if (!statSync(dirPath).isDirectory()) continue
    for (const f of readdirSync(dirPath)) {
      const ext = extname(f).toLowerCase()
      if (ext !== '.xls' && ext !== '.xlsx') continue
      const label = `${dir}/${f}`
      const found = extractFromFile(join(dirPath, f), label)
      if (found.length) {
        perFile[label] = found.length
        cases.push(...found)
      }
    }
  }

  // dedup por (query, precio) normalizados
  const seen = new Set<string>()
  const deduped = cases.filter((c) => {
    const k = `${c.query.toLowerCase()}|${c.expected_price}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const outPath = resolve(process.cwd(), 'resources/knowledge/cases_reales.json')
  writeFileSync(outPath, JSON.stringify({ cases: deduped }, null, 2))

  console.log('Pares extraídos por fichero:')
  for (const [f, n] of Object.entries(perFile)) console.log(`  ${n.toString().padStart(4)}  ${f}`)
  console.log(`\nTotal: ${cases.length} · tras dedup: ${deduped.length}`)
  console.log(`Escrito en: ${outPath} (gitignored)`)
}

main()
