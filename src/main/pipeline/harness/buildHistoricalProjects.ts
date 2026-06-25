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

export interface HistoricalProject {
  id: string
  nombre: string
  archivo: string
  total_base: number
  categories: string[]
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
  // Solo acepta cadenas que sean principalmente numéricas (tolerando separadores €, %, espacios)
  const s = String(v).trim()
  // Si hay más del 50% de letras (tipo "Rev. 1 (...)"), rechazar
  const letters = (s.match(/[a-zA-Z]/g) ?? []).length
  if (letters > s.length * 0.3) return null
  const clean = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = parseFloat(clean)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeHeader(v: unknown): string {
  return String(v ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// Identifica sub-encabezados descriptivos dentro de una sección
const IS_SUBSECTION_RE =
  /^ensayos?\s+(de|control|complet|identif)|^(tipo|clase|grado)\s+/i
// Palabras que indican que la fila no es un ensayo facturable
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
  const categoriesSet = new Set<string>()
  let totalBase = 0
  let nombre = ''

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
    if (rows.length < 5) continue

    // ── Detectar índice de columnas desde el encabezado ───────────────────
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
        // Total: columna siguiente al precio que contenga "importe", "total" o "€"
        const idxTotal = headers.findIndex(
          (t, i) => i > idxPrice && /importe|total|€/i.test(t)
        )
        colTotal = idxTotal >= 0 ? idxTotal : idxPrice + 1
        // nTests: columna previa que contenga "ud", "nº", "cant", o "num"
        const idxUd = headers.findIndex(
          (t, i) => i < idxPrice && /^uds?\.?$|^n[uú]?m\.?$|^cant|^unidad/i.test(t)
        )
        colNTests = idxUd >= 0 ? idxUd : idxPrice - 1
        break
      }
    }

    if (colPrice < 0) {
      // Intento alternativo: "Precio Unitario" / "TOTAL" en posición lateral
      for (const rawRow of rows) {
        const row = rawRow as unknown[]
        const headers = row.map(normalizeHeader)
        const idxP = headers.findIndex((t) => /precio\s*unitario/i.test(t))
        const idxT = headers.findIndex((t) => /^total$/i.test(t))
        if (idxP >= 0 && idxT > idxP) {
          colPrice = idxP; colTotal = idxT
          colNTests = headers.findIndex((t, i) => i < idxP && /medici[oó]n|ud\.?|uds\.?|cant/i.test(t))
          if (colNTests < 0) colNTests = 0
          // Ajustar colDesc: buscar columna "CONCEPTOS" o "ENSAYO" o la primera columna con texto largo
          const idxDesc = headers.findIndex((t) => /concepto|ensayo|descripci/i.test(t))
          if (idxDesc >= 0) colDesc = idxDesc
          break
        }
      }
      // Última heurística
      if (colPrice < 0) { colNTests = 4; colPrice = 5; colTotal = 6 }
    }

    let currentSection = 'GENERAL'

    for (const rawRow of rows) {
      const row = rawRow as unknown[]
      const rawDesc = String(row[colDesc] ?? '')
        .replace(/\r?\n/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!rawDesc || rawDesc.length < 4) continue

      // ── BASE IMPONIBLE (debe ir ANTES de los filtros de ruido) ────────────
      if (/BASE IMPONIBLE|TOTAL BASE|IMPORTE TOTAL/i.test(rawDesc)) {
        // Preferir celdas con valor numérico nativo de Excel (typeof number)
        // para evitar parsear strings como "Rev. 1 (126.510 €)"
        for (let ci = row.length - 1; ci >= 0; ci--) {
          const v = row[ci]
          if (typeof v === 'number' && Number.isFinite(v) && v > 500) {
            totalBase = v; break
          }
        }
        continue
      }

      if (IS_NOISE_RE.test(rawDesc)) continue

      // ── Nombre de la obra (primera fila descriptiva larga) ─────────────
      if (!nombre && rawDesc.length > 15 && !/^\d/.test(rawDesc)) {
        nombre = rawDesc.slice(0, 80)
      }

      // ── Sección / Capítulo ─────────────────────────────────────────────
      const price = toNum(row[colPrice])
      const total = toNum(row[colTotal])
      const isTestLine = price !== null && total !== null && price > 0 && price < 5000

      if (!isTestLine) {
        // Puede ser un encabezado de sección
        if (IS_SUBSECTION_RE.test(rawDesc)) continue
        const cat = inferCategory(rawDesc)
        if (cat) {
          categoriesSet.add(cat)
          currentSection = rawDesc
            .replace(/^\d+[\.\-]\s*/, '')
            .replace(/\s*\(.*?\)\s*$/, '')
            .trim()
            .toUpperCase()
            .slice(0, 60)
        }
        continue
      }

      if (IS_SUBSECTION_RE.test(rawDesc) || rawDesc.length < 10) continue

      const nTests = toNum(row[colNTests]) ?? Math.round(total / price)

      plan.push({
        seccion: currentSection,
        descripcion: rawDesc.slice(0, 200),
        n_tests: Math.max(1, Math.round(nTests)),
        precio_unitario: price,
        importe: total,
      })
    }

    if (plan.length >= 3) break // suficiente con la primera hoja con datos
  }

  if (plan.length < 3 || totalBase < 500) return null

  return {
    id: archivo,
    nombre: nombre || archivo,
    archivo,
    total_base: totalBase,
    categories: Array.from(categoriesSet),
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
      return (
        (ext === '.xls' || ext === '.xlsx') &&
        /^P[-_\d0]/i.test(f) &&
        !/medicion|totalizad|plantilla|tarifas/i.test(f)
      )
    })

    for (const f of files) {
      process.stdout.write(`Ejemplo ${i} / ${f} ... `)
      const proj = parseFile(join(dir, f), `Ejemplo ${i} — ${f}`)
      if (proj) {
        proj.id = `E${i}`
        projects.push(proj)
        console.log(
          `✓ ${proj.plan.length} líneas · cats: ${proj.categories.join(', ')} · base: ${proj.total_base.toLocaleString('es-ES')} €`
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
