/**
 * Importador del catálogo ALAGAL → catálogo canónico de ensayos curado.
 *
 *   npm run kb:import-alagal
 *
 * Entrada:  resources/knowledge/tarifas_alagal.xlsx (hoja "Versión  0 28-02-2025")
 * Salida:   resources/knowledge/curated/alagal_catalog.json
 *
 * Extrae las 17 secciones top-level (taxonomía) y los ~749 ensayos con precio,
 * con sus códigos de norma. Asigna ID canónico T-NNNN por orden de código ALAGAL.
 * Estos ensayos son el universo priceable; las frecuencias y los precios CYE se
 * añaden después desde los presupuestos reales (importCye.ts).
 */
import ExcelJS from 'exceljs'
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import type { KbTest, KbPrice } from '../../kb/types'

/** Extrae los códigos de norma en su forma legible original (UNE 103501:94, NLT-357, …). */
const RAW_NORM_RE = /(?:UNE(?:[-\s]?EN)?|NLT|ASTM|ISO|EN|prEN)\s*[-]?\s*[A-Z]?\s*\d[\d\-.:/]*/gi
function rawNormCodes(desc: string): string[] {
  return Array.from(desc.match(RAW_NORM_RE) ?? []).map((s) => s.replace(/\s+/g, ' ').trim())
}

const CATALOG_SHEET = 'Versión  0 28-02-2025'
const ALAGAL_PATH = resolve(process.cwd(), 'resources/knowledge/tarifas_alagal.xlsx')
const OUT_DIR = resolve(process.cwd(), 'resources/knowledge/curated')
const OUT_PATH = resolve(OUT_DIR, 'alagal_catalog.json')

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const v = value as unknown as Record<string, unknown>
    if (Array.isArray(v.richText)) return (v.richText as Array<{ text: string }>).map((t) => t.text).join('')
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

interface AlagalCategory {
  code: string
  name: string
}

interface AlagalCatalogFile {
  generatedFrom: string
  sheet: string
  alagalSections: AlagalCategory[]
  tests: KbTest[]
  prices: KbPrice[]
}

async function main(): Promise<void> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ALAGAL_PATH)
  const ws = wb.getWorksheet(CATALOG_SHEET)
  if (!ws) throw new Error(`No se encontró la hoja "${CATALOG_SHEET}" en ${ALAGAL_PATH}`)

  interface Raw {
    codigo: string
    descripcion: string
    precio: number | null
  }
  const rows: Raw[] = []
  ws.eachRow((row, n) => {
    if (n === 1) return
    const codigo = cellText(row.getCell(1).value).trim()
    const descripcion = cellText(row.getCell(2).value).trim()
    if (!codigo || !descripcion) return
    rows.push({ codigo, descripcion, precio: cellNumber(row.getCell(3).value) })
  })

  // Filas sin precio = cabeceras de categoría, indexadas por código.
  const catMap = new Map<string, string>()
  for (const r of rows) if (r.precio == null) catMap.set(r.codigo, r.descripcion)

  // Secciones top-level: código de un solo nivel ("2.", "3.", …)
  const alagalSections: AlagalCategory[] = rows
    .filter((r) => /^\d+\.$/.test(r.codigo) && r.precio == null)
    .map((r) => ({ code: r.codigo, name: r.descripcion }))

  const topSection = (code: string): string | null => {
    const top = code.split('.')[0] + '.'
    return catMap.get(top) ?? null
  }

  const tests: KbTest[] = []
  const prices: KbPrice[] = []
  let seq = 1
  for (const r of rows) {
    if (r.precio == null || r.precio <= 0) continue
    const id = `T-${String(seq).padStart(4, '0')}`
    seq++
    tests.push({
      id,
      canonicalDesc: r.descripcion,
      normCodes: rawNormCodes(r.descripcion),
      alagalSection: topSection(r.codigo),
      alagalCode: r.codigo,
      origin: 'alagal',
    })
    prices.push({ testId: id, source: 'alagal', price: r.precio })
  }

  const out: AlagalCatalogFile = {
    generatedFrom: 'resources/knowledge/tarifas_alagal.xlsx',
    sheet: CATALOG_SHEET,
    alagalSections,
    tests,
    prices,
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))

  const withNorm = tests.filter((t) => t.normCodes.length > 0).length
  console.log(`Catálogo ALAGAL curado:`)
  console.log(`  secciones top-level: ${alagalSections.length}`)
  console.log(`  ensayos con precio:  ${tests.length}`)
  console.log(`  con código de norma: ${withNorm} (${Math.round((withNorm / tests.length) * 100)}%)`)
  console.log(`  → ${OUT_PATH}`)
  console.log(`\nEjemplos:`)
  for (const t of tests.slice(0, 5)) {
    const p = prices.find((x) => x.testId === t.id)!
    console.log(`  ${t.id} [${t.alagalSection?.slice(0, 22)}] ${t.canonicalDesc.slice(0, 50)} → ${p.price}€  norms=${JSON.stringify(t.normCodes)}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
