/**
 * Construye el corpus de proyectos históricos a partir de los P-*.xls/xlsx reales.
 *
 *   npm run rag:historical
 *
 * Salida: resources/knowledge/historical_projects.json
 * Usado por plannerLLM para selección de few-shot y por el nuevo motor de generación.
 */
import { writeFileSync, readdirSync, existsSync } from 'fs'
import { join, extname, resolve } from 'path'
import XLSX from 'xlsx'

export interface HistoricalPlanLine {
  seccion: string
  descripcion: string
  n_tests: number
  precio_unitario: number
  importe: number
}

export interface HistoricalSection {
  category: string
  sectionName: string
  quantity: number | null
  unit: string | null
  tests: HistoricalPlanLine[]
}

export interface HistoricalProject {
  id: string
  nombre: string
  archivo: string
  total_base: number
  categories: string[]
  sections: HistoricalSection[]
  plan: HistoricalPlanLine[]
}

// ── Categorías inferidas del texto de sección ──────────────────────────────
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/TERRAPLÉN|TERRAPLEN|RELLENO|PEDRAPLÉN|PEDRAPLEN|EXPLANAD/i, 'TERRAPLEN_RELLENOS'],
  [/ZAHORRA/i, 'ZAHORRA_ARTIFICIAL'],
  [/SUELO ESTAB/i, 'SUELO_ESTABILIZADO'],
  [/MEZCLA BIT|BITUMINOSA/i, 'MEZCLA_BITUMINOSA'],
  [/ESCOLLERA/i, 'ESCOLLERA'],
  [/HORMIG[OÓ]N|PROBETA|CIMENTAC/i, 'HORMIGON'],
  [/ACERO\s*(PASIVO|LAMINADO|ESTRUCTURA)/i, 'ACERO'],
  [/RIEGO|EMULSIÓN|EMULSION|ADHERENCIA|IMPRIMACIÓN/i, 'RIEGO_BITUMINOSO'],
  [/MARCAS VIALES|SEÑALIZACI/i, 'MARCAS_VIALES'],
  [/PILOTE/i, 'PILOTES'],
  [/SONDEO|GEOTÉCN|GEOTECN/i, 'SERVICIO'],
]

function inferCategory(text: string): string | null {
  for (const [re, cat] of CATEGORY_MAP) {
    if (re.test(text)) return cat
  }
  return null
}

function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  if (v == null) return null
  const s = String(v).trim()
  const letters = (s.match(/[a-zA-Z]/g) ?? []).length
  if (letters > s.length * 0.3) return null
  const clean = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = parseFloat(clean)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Parsea cantidades en formato español de las cabeceras de sección.
 * Ej: "4.400.000 m3" → { quantity: 4400000, unit: 'm3' }
 * Ej: "252.652 m3"   → { quantity: 252652,  unit: 'm3' }
 */
function parseSpanishQuantity(s: string): { quantity: number; unit: string } | null {
  if (!s) return null
  const m = String(s)
    .trim()
    .match(/^([\d.,]+)\s*(m[23]|t\b|Tm\b|km\b|ml\b|ud\.?|kg\b)/i)
  if (!m) return null
  // En español: punto = separador de miles, coma = decimal
  const numStr = m[1].replace(/\./g, '').replace(',', '.')
  const quantity = parseFloat(numStr)
  return Number.isFinite(quantity) && quantity > 0 ? { quantity, unit: m[2].toLowerCase() } : null
}

function normalizeHeader(v: unknown): string {
  return String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

const IS_SUBSECTION_RE =
  /^ensayos?\s+(de|control|complet|identif)|^(tipo|clase|grado)\s+/i
const IS_NOISE_RE =
  /^(observ|muestreo\s+t|p\.\s*unitario|importe|uds\.|ensayos?\/|goc$|art\s*\d)/i

function parseFile(path: string, archivo: string): HistoricalProject | null {
  let wb: XLSX.WorkBook
  try {
    wb = XLSX.readFile(path)
  } catch {
    return null
  }

  const plan: HistoricalPlanLine[] = []
  const sectionsMap = new Map<string, HistoricalSection>()
  const categoriesSet = new Set<string>()
  let totalBase = 0
  let nombre = ''

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
    if (rows.length < 5) continue

    let colDesc = 0
    let colNTests = -1
    let colPrice = -1
    let colTotal = -1

    for (const rawRow of rows) {
      const row = rawRow as unknown[]
      const headers = row.map(normalizeHeader)
      const idxPrice = headers.findIndex((t) => /p[\.\s]*unitario|precio[\s_]*unit/i.test(t))
      if (idxPrice >= 0) {
        colPrice = idxPrice
        const idxTotal = headers.findIndex(
          (t, i) => i > idxPrice && /importe|total|€/i.test(t)
        )
        colTotal = idxTotal >= 0 ? idxTotal : idxPrice + 1
        const idxUd = headers.findIndex(
          (t, i) => i < idxPrice && /^uds?\.?$|^n[uú]?m\.?$|^cant|^unidad/i.test(t)
        )
        colNTests = idxUd >= 0 ? idxUd : idxPrice - 1
        break
      }
    }

    if (colPrice < 0) {
      for (const rawRow of rows) {
        const row = rawRow as unknown[]
        const headers = row.map(normalizeHeader)
        const idxP = headers.findIndex((t) => /precio\s*unitario/i.test(t))
        const idxT = headers.findIndex((t) => /^total$/i.test(t))
        if (idxP >= 0 && idxT > idxP) {
          colPrice = idxP; colTotal = idxT
          colNTests = headers.findIndex((t, i) => i < idxP && /medici[oó]n|ud\.?|uds\.?|cant/i.test(t))
          if (colNTests < 0) colNTests = 0
          const idxDesc = headers.findIndex((t) => /concepto|ensayo|descripci/i.test(t))
          if (idxDesc >= 0) colDesc = idxDesc
          break
        }
      }
      if (colPrice < 0) { colNTests = 4; colPrice = 5; colTotal = 6 }
    }

    let currentSection = 'GENERAL'
    let currentCategory: string | null = null
    let currentQuantity: number | null = null
    let currentUnit: string | null = null

    for (const rawRow of rows) {
      const row = rawRow as unknown[]
      const rawDesc = String(row[colDesc] ?? '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!rawDesc || rawDesc.length < 4) continue

      // ── BASE IMPONIBLE (antes de los filtros de ruido) ──────────────────
      if (/BASE IMPONIBLE|TOTAL BASE|IMPORTE TOTAL/i.test(rawDesc)) {
        for (let ci = row.length - 1; ci >= 0; ci--) {
          const v = row[ci]
          if (typeof v === 'number' && Number.isFinite(v) && v > 500) {
            totalBase = v; break
          }
        }
        continue
      }

      if (IS_NOISE_RE.test(rawDesc)) continue

      if (!nombre && rawDesc.length > 15 && !/^\d/.test(rawDesc)) {
        nombre = rawDesc.slice(0, 80)
      }

      const price = toNum(row[colPrice])
      const total = toNum(row[colTotal])
      const isTestLine = price !== null && total !== null && price > 0 && price < 5000

      if (!isTestLine) {
        if (IS_SUBSECTION_RE.test(rawDesc)) continue
        const cat = inferCategory(rawDesc)
        if (cat) {
          categoriesSet.add(cat)
          currentCategory = cat
          currentSection = rawDesc
            .replace(/^\d+[\.\-]\s*/, '')
            .replace(/\s*\(.*?\)\s*$/, '')
            .trim()
            .toUpperCase()
            .slice(0, 60)

          // Extraer cantidad de la cabecera de sección (col 2)
          const qtyStr = String(row[2] ?? '').trim()
          const parsed = parseSpanishQuantity(qtyStr)
          currentQuantity = parsed?.quantity ?? null
          currentUnit = parsed?.unit ?? null

          if (!sectionsMap.has(currentSection)) {
            sectionsMap.set(currentSection, {
              category: cat,
              sectionName: currentSection,
              quantity: currentQuantity,
              unit: currentUnit,
              tests: [],
            })
          }
        }
        continue
      }

      if (IS_SUBSECTION_RE.test(rawDesc) || rawDesc.length < 10) continue

      const nTests = toNum(row[colNTests]) ?? Math.round(total / price)
      const planLine: HistoricalPlanLine = {
        seccion: currentSection,
        descripcion: rawDesc.slice(0, 200),
        n_tests: Math.max(1, Math.round(nTests)),
        precio_unitario: price,
        importe: total,
      }

      plan.push(planLine)
      sectionsMap.get(currentSection)?.tests.push(planLine)

      // Si la sección no tenía categoría asignada aún, intentar inferirla del contexto
      if (!currentCategory) {
        const sectionEntry = sectionsMap.get(currentSection)
        if (sectionEntry && !sectionEntry.category) {
          const cat = inferCategory(rawDesc)
          if (cat) {
            sectionEntry.category = cat
            categoriesSet.add(cat)
            currentCategory = cat
          }
        }
      }
    }

    if (plan.length >= 3) break
  }

  if (plan.length < 3 || totalBase < 500) return null

  const sections = Array.from(sectionsMap.values()).filter((s) => s.tests.length > 0)

  return {
    id: archivo,
    nombre: nombre || archivo,
    archivo,
    total_base: totalBase,
    categories: Array.from(categoriesSet),
    sections,
    plan,
  }
}

const PRESUPUESTOS_BASE = '/Users/usuario/Desktop/Nigal/Proyects/CYE/DOCS/Presupuestos_completo'

function main(): void {
  const projects: HistoricalProject[] = []

  for (let i = 1; i <= 8; i++) {
    const dir = join(PRESUPUESTOS_BASE, `Ejemplo ${i}`)
    if (!existsSync(dir)) continue

    const files = readdirSync(dir).filter((f) => {
      const ext = extname(f).toLowerCase()
      // Acepta archivos tipo "P-1234.xlsx" (comienzan con P) O
      // tipo "0118.24 P.xlsx" (terminan en " P.xlsx") como E6 y E7
      const isPfile = /^P[-_\d]/i.test(f) || /\bP\.xlsx?$/i.test(f)
      const isNoise = /medicion|totalizad|plantilla|tarifas/i.test(f)
      return (ext === '.xls' || ext === '.xlsx') && isPfile && !isNoise
    })

    for (const f of files) {
      process.stdout.write(`Ejemplo ${i} / ${f} ... `)
      const proj = parseFile(join(dir, f), `Ejemplo ${i} — ${f}`)
      if (proj) {
        proj.id = `E${i}`
        projects.push(proj)
        const sectionsSummary = proj.sections
          .map((s) => `${s.sectionName.slice(0, 20)}${s.quantity ? ` (${s.quantity.toLocaleString('es-ES')} ${s.unit})` : ''}`)
          .join(' | ')
        console.log(
          `✓ ${proj.plan.length} líneas · ${proj.sections.length} secciones · base: ${proj.total_base.toLocaleString('es-ES')} €\n  Secciones: ${sectionsSummary}`
        )
      } else {
        console.log('✗ no se pudo parsear')
      }
    }
  }

  const outPath = resolve(process.cwd(), 'resources/knowledge/historical_projects.json')
  writeFileSync(outPath, JSON.stringify({ projects }, null, 2))
  console.log(`\nGuardados ${projects.length} proyectos → ${outPath}`)
}

main()
