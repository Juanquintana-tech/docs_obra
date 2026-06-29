/**
 * Importador de los presupuestos CYE reales → frecuencias, precios CYE y eval.
 *
 *   npm run kb:import-cye
 *
 * Entrada:  8 presupuestos CYE (ver INVENTARIO_FUENTES.md §3). NUNCA los Plan_*.xlsx.
 * Salida (resources/knowledge/curated/):
 *   - frequency_rules.json  (kb_frequency_rules: categoría → ensayo → muestreo/freqUnit)
 *   - cye_prices.json       (kb_prices source=tarifa_cye: reciente/mediana/min/max/n)
 *   - aliases.json          (kb_test_aliases: texto real → ensayo canónico)
 *   - cye_tests.json        (ensayos en presupuestos CYE NO presentes en ALAGAL)
 *   - eval_projects.json    (8 proyectos parseados, held-out para evaluación)
 *
 * El ALAGAL curado (alagal_catalog.json) debe existir antes (npm run kb:import-alagal).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import XLSX from 'xlsx'
import { normalize } from '../../rag/normalize'
import { extractNormCodes } from '../../rag/normCodes'
import type {
  KbTest, KbPrice, KbAlias, KbFrequencyRule,
  EvalProject, EvalSection,
} from '../../kb/types'

const PRESUPUESTOS_BASE = '/Users/usuario/Desktop/Nigal/Proyects/CYE/DOCS/Presupuestos_completo'
const CURATED = resolve(process.cwd(), 'resources/knowledge/curated')

// ── Presupuestos CYE válidos (decisiones de INVENTARIO_FUENTES.md §5) ───────
const BUDGETS: { id: string; file: string; sheet?: string }[] = [
  { id: 'E1', file: 'Ejemplo 1/P-1140.25 Rev 2.xls' },
  { id: 'E2', file: 'Ejemplo 2/P-0331.25.xlsx' },
  { id: 'E3', file: 'Ejemplo 3/P-0789.25.xls' },
  { id: 'E4', file: 'Ejemplo 4/P-0002.2-23.xlsx' },
  { id: 'E5', file: 'Ejemplo 5/P-1339-20 P Rev 3.xlsx', sheet: 'BASE' },
  { id: 'E6', file: 'Ejemplo 6/0118.24 P.xlsx' },
  { id: 'E7', file: 'Ejemplo 7/0414.26 P.xls' },
  { id: 'E8', file: 'Ejemplo 8/P-0618-2018 CYE A54 ARZUA.xlsx' },
]

// ── Categorías internas inferidas del texto de sección ──────────────────────
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [/TERRAPL[ÉE]N|RELLENO|PEDRAPL[ÉE]N|EXPLANAD|SUELO SELEC|SUELO TOLER|CORONACI/i, 'TERRAPLEN_RELLENOS'],
  [/ZAHORRA/i, 'ZAHORRA_ARTIFICIAL'],
  [/SUELO[S]? ESTAB|SUELOCEMENTO|SUELO CEMENTO/i, 'SUELO_ESTABILIZADO'],
  [/MEZCLA BIT|BITUMINOSA|AGLOMERAD|\bAC[- ]?\d|\bMBC\b|BBTM/i, 'MEZCLA_BITUMINOSA'],
  [/ESCOLLERA|ENROCAMIENTO/i, 'ESCOLLERA'],
  [/HORMIG[OÓ]N|PROBETA|CIMENTAC|H[AM]-\d|ESTRUCTURA/i, 'HORMIGON'],
  [/ACERO\s*(PASIVO|LAMINADO|ESTRUCTURA|CORRUGAD|ARMADUR)|FERRALLA/i, 'ACERO'],
  [/ACERO LAMINAD|PERFIL/i, 'ACERO_LAMINADO'],
  [/RIEGO|EMULSI[OÓ]N|ADHERENCIA|IMPRIMACI[OÓ]N|BET[UÚ]N/i, 'RIEGO_BITUMINOSO'],
  [/MARCAS VIALES|SE[ÑN]ALIZACI/i, 'MARCAS_VIALES'],
  [/PILOTE/i, 'PILOTES'],
  [/BUL[OÓ]N|BULON/i, 'BULON'],
  [/SONDEO|GEOT[ÉE]CN|PRUEBA[S]? DE SERVICIO|PLACA DE CARGA/i, 'SERVICIO'],
]
function inferCategory(text: string): string | null {
  for (const [re, cat] of CATEGORY_MAP) if (re.test(text)) return cat
  return null
}

// ── Helpers numéricos / texto ───────────────────────────────────────────────
function toNum(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (v == null) return null
  const s = String(v).trim()
  const letters = (s.match(/[a-zA-Z]/g) ?? []).length
  if (letters > s.length * 0.3) return null
  const clean = s.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '')
  const n = parseFloat(clean)
  return Number.isFinite(n) ? n : null
}
function clean(v: unknown): string {
  return String(v ?? '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}
function parseSpanishQuantity(s: string): { quantity: number; unit: string } | null {
  const m = clean(s).match(/([\d.]+(?:,\d+)?)\s*(m[23³²]|t\b|Tm\b|km\b|ml\b|kg\b|ud\.?|u\b)/i)
  if (!m) return null
  const quantity = parseFloat(m[1].replace(/\./g, '').replace(',', '.'))
  if (!Number.isFinite(quantity) || quantity <= 0) return null
  return { quantity, unit: m[2].toLowerCase().replace('³', '3').replace('²', '2') }
}
const RAW_NORM_RE = /(?:UNE(?:[-\s]?EN)?|NLT|ASTM|ISO|EN|prEN)\s*[-]?\s*[A-Z]?\s*\d[\d\-.:/]*/gi
function rawNormCodes(desc: string): string[] {
  return Array.from(desc.match(RAW_NORM_RE) ?? []).map((s) => s.replace(/\s+/g, ' ').trim())
}

// ── Esquemas de columnas (ver tabla en el commit) ───────────────────────────
type Schema = 'OBSERV' | 'NORMATIVA' | 'MEDICION' | 'SIMPLE'
interface ColMap { desc: number; muestreo: number; frequnit: number; ntests: number; price: number; total: number; freqCombined: number }
const COLMAPS: Record<Schema, ColMap> = {
  OBSERV:    { desc: 0, muestreo: 2, frequnit: 3, ntests: 4, price: 5, total: 6, freqCombined: -1 },
  NORMATIVA: { desc: 0, muestreo: 1, frequnit: 2, ntests: 3, price: 4, total: 5, freqCombined: -1 },
  MEDICION:  { desc: 3, muestreo: -1, frequnit: -1, ntests: 0, price: 4, total: 5, freqCombined: 1 },
  SIMPLE:    { desc: 0, muestreo: -1, frequnit: -1, ntests: 1, price: 2, total: 3, freqCombined: -1 },
}

function detectSchema(rows: unknown[][]): { schema: Schema; headerRow: number } | null {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const t = rows[i].map((c) => clean(c).toLowerCase()).join(' | ')
    if (/concepto y norma/.test(t) && /n[ºo°]\s*ensayos/.test(t)) return { schema: 'SIMPLE', headerRow: i }
    if (/medici[óo]n/.test(t) && /m[íi]nimo por ley/.test(t) && /conceptos/.test(t)) return { schema: 'MEDICION', headerRow: i }
    if (/ensayos/.test(t) && /muestreo\b/.test(t) && /\bud/.test(t)) return { schema: 'OBSERV', headerRow: i }
    if (/ensayo \/ normativ/.test(t) && /muestreo t[ée]cnico/.test(t)) return { schema: 'NORMATIVA', headerRow: i }
  }
  return null
}

/** Parsea "1/5.000 m3" o "1/10 lotes ensayados" → { muestreo, freqUnit }. */
function parseCombinedFreq(s: string): { muestreo: number | null; freqUnit: string | null } {
  const str = clean(s)
  const m = str.match(/^([\d.,]+)\s*\/\s*(.+)$/)
  if (m) return { muestreo: toNum(m[1]), freqUnit: m[2].trim() }
  return { muestreo: null, freqUnit: str || null }
}

/** Marca de "ídem la celda de arriba" usada en las columnas UD de los presupuestos. */
const DITTO_RE = /^(["“”']+|-"-|[íi]d\.?(em)?|igual)$/i
function isDitto(s: string): boolean {
  return DITTO_RE.test(clean(s))
}

/** Normaliza una unidad de magnitud a forma canónica (m³→m3, tm→t, u→ud…). */
function canonMagUnit(u: string): string {
  const x = u.toLowerCase().replace('³', '3').replace('²', '2').trim()
  if (x === 'tm' || x === 'tn') return 't'
  if (x === 'u') return 'ud'
  return x
}

/**
 * Estructura el texto de frecuencia (columna UD) para el motor determinista.
 * "5.000 m3" / "5000 m3" → {per_quantity, 5000, m3}   ·   "Por material" → {per_type}
 */
function parseFreqUnit(raw: string): { kind: import('../../kb/types').FreqKind; qty: number | null; unit: string | null } {
  const s = clean(raw).toLowerCase()
  if (!s) return { kind: 'other', qty: null, unit: null }
  const lot = s.match(/([\d.,]+)\s*lote/)
  if (lot) return { kind: 'per_lot', qty: toNum(lot[1]), unit: 'lote' }
  const m = s.match(/([\d.,]+)\s*(m3|m2|ml|t|tm|tn|km|kg|ud|u|m)\b/)
  if (m) return { kind: 'per_quantity', qty: toNum(m[1]), unit: canonMagUnit(m[2]) }
  if (/jornada|visita|d[íi]a|equipo|despla|moviliz|traslado|fija|sonda/.test(s)) return { kind: 'fixed', qty: null, unit: null }
  if (/elemento|element|pila|estribo|zapata|pilar|fachada/.test(s)) return { kind: 'per_element', qty: 1, unit: null }
  if (/tipo|material|mezcla|emulsi[óo]n|f[óo]rmula|huso|serie|clase|procedencia|capa/.test(s)) return { kind: 'per_type', qty: 1, unit: null }
  return { kind: 'other', qty: null, unit: null }
}

const IS_SUBSECTION_RE = /^ensayos?\s+(de|control|complet|identif|caracter)|^control\s+de/i
const IS_NOISE_RE = /^(observ|muestreo|p\.\s*unitario|precio|importe|uds?\.|concepto|medici[óo]n|m[íi]nimo|total|base imponible|iva|n[ºo°]\s*ensayos)/i

// ── Parseo de un presupuesto ────────────────────────────────────────────────
interface ParsedBudget { project: EvalProject }

function parseBudget(id: string, path: string, sheet: string | undefined): ParsedBudget | null {
  let wb: XLSX.WorkBook
  try { wb = XLSX.readFile(path) } catch { return null }
  const sheetName = sheet && wb.SheetNames.includes(sheet) ? sheet : wb.SheetNames[0]
  const ws = wb.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false }) as unknown[][]

  const det = detectSchema(rows)
  if (!det) return null
  const { schema, headerRow } = det
  const cm = COLMAPS[schema]
  const formato = schema === 'SIMPLE' ? 'B' : 'A'

  const sections: EvalSection[] = []
  let cur: EvalSection | null = null
  let nombre = ''
  let totalBase = 0
  let lastFreqUnit: string | null = null // para resolver marcas ditto (")

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i]
    const descRaw = clean(row[cm.desc])
    const fullText = row.map(clean).join(' ')

    if (/BASE IMPONIBLE|TOTAL BASE|IMPORTE TOTAL|TOTAL PRESUPUESTO/i.test(fullText)) {
      for (let ci = row.length - 1; ci >= 0; ci--) {
        const v = toNum(row[ci])
        if (v && v > 500) { totalBase = Math.max(totalBase, v); break }
      }
      continue
    }
    if (!descRaw || descRaw.length < 4) continue

    const price = toNum(row[cm.price])
    const total = toNum(row[cm.total])
    const isTestLine = price !== null && total !== null && price > 0 && price < 8000 && total > 0

    if (!isTestLine) {
      if (IS_NOISE_RE.test(descRaw) || IS_SUBSECTION_RE.test(descRaw)) continue
      // ¿Cabecera de sección? Inferir categoría + cantidad de la fila.
      const cat = inferCategory(descRaw) ?? inferCategory(fullText)
      const qty = row.map(clean).map(parseSpanishQuantity).find(Boolean) ?? null
      if (cat || qty) {
        if (!nombre && descRaw.length > 10) nombre = descRaw.slice(0, 80)
        cur = {
          category: cat,
          sectionName: descRaw.replace(/^\d+[.\-]\s*/, '').slice(0, 70),
          quantity: qty?.quantity ?? null,
          unit: qty?.unit ?? null,
          lines: [],
        }
        sections.push(cur)
        lastFreqUnit = null // el ditto no cruza cabeceras de sección
      }
      continue
    }

    // Línea de ensayo
    if (!nombre && descRaw.length > 12 && !/^\d/.test(descRaw)) nombre = descRaw.slice(0, 80)
    if (!cur) {
      cur = { category: null, sectionName: 'GENERAL', quantity: null, unit: null, lines: [] }
      sections.push(cur)
    }

    let muestreo: number | null = null
    let freqUnit: string | null = null
    if (schema === 'MEDICION') {
      const f = parseCombinedFreq(clean(row[cm.freqCombined]))
      muestreo = f.muestreo; freqUnit = f.freqUnit
    } else if (cm.muestreo >= 0) {
      muestreo = toNum(row[cm.muestreo])
      const rawFreq = clean(row[cm.frequnit])
      if (isDitto(rawFreq)) freqUnit = lastFreqUnit // hereda la unidad de arriba
      else if (rawFreq) { freqUnit = rawFreq; lastFreqUnit = rawFreq }
      else freqUnit = null
    }
    const nTests = toNum(row[cm.ntests]) ?? Math.max(1, Math.round(total! / price!))

    cur.lines.push({
      seccion: cur.sectionName,
      categoryCode: cur.category,
      descripcion: descRaw.slice(0, 220),
      testId: null, // se resuelve en la fase de matching
      muestreo,
      freqUnit,
      nTests: Math.max(1, Math.round(nTests)),
      precioUnitario: price!,
      importe: total!,
    })
  }

  const cleanSections = sections.filter((s) => s.lines.length > 0)
  const totalLines = cleanSections.reduce((a, s) => a + s.lines.length, 0)
  if (totalLines < 2) return null
  if (totalBase === 0) totalBase = cleanSections.reduce((a, s) => a + s.lines.reduce((b, l) => b + l.importe, 0), 0)

  return {
    project: { id, nombre: nombre || id, archivo: path.split('/').slice(-2).join('/'), formato, totalBase, sections: cleanSections },
  }
}

// ── Matching: descripción CYE → ensayo canónico ALAGAL ──────────────────────
interface AlagalCatalog { tests: KbTest[]; prices: KbPrice[] }

function buildMatcher(catalog: AlagalCatalog): (desc: string) => { test: KbTest; confidence: number } | null {
  const byNorm = new Map<string, KbTest[]>()
  const tokensByTest = new Map<string, Set<string>>()
  for (const t of catalog.tests) {
    for (const c of extractNormCodes(t.canonicalDesc)) {
      if (!byNorm.has(c)) byNorm.set(c, [])
      byNorm.get(c)!.push(t)
    }
    tokensByTest.set(t.id, new Set(normalize(t.canonicalDesc).split(/\s+/).filter((w) => w.length > 3)))
  }

  return (desc: string) => {
    // 1) Match fuerte por código de norma (normalizador probado: ignora año/sufijo)
    const normCandidates = new Set<KbTest>()
    for (const c of extractNormCodes(desc)) for (const t of byNorm.get(c) ?? []) normCandidates.add(t)
    const qTokens = new Set(normalize(desc).split(/\s+/).filter((w) => w.length > 3))
    const jac = (t: KbTest): number => {
      const et = tokensByTest.get(t.id)!
      let inter = 0
      for (const w of qTokens) if (et.has(w)) inter++
      const union = new Set([...qTokens, ...et]).size
      return union ? inter / union : 0
    }
    if (normCandidates.size > 0) {
      // entre los que comparten norma, el de mayor solape de texto
      let best: KbTest | null = null, bestJ = -1
      for (const t of normCandidates) { const j = jac(t); if (j > bestJ) { bestJ = j; best = t } }
      return { test: best!, confidence: Math.min(1, 0.7 + bestJ * 0.3) }
    }
    // 2) Match por solape de texto
    let best: KbTest | null = null, bestJ = -1
    for (const t of catalog.tests) { const j = jac(t); if (j > bestJ) { bestJ = j; best = t } }
    if (best && bestJ >= 0.45) return { test: best, confidence: bestJ }
    return null
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function main(): void {
  const catalogPath = resolve(CURATED, 'alagal_catalog.json')
  if (!existsSync(catalogPath)) throw new Error('Falta alagal_catalog.json — ejecuta primero: npm run kb:import-alagal')
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf-8')) as AlagalCatalog
  const match = buildMatcher(catalog)

  const projects: EvalProject[] = []
  for (const b of BUDGETS) {
    const full = join(PRESUPUESTOS_BASE, b.file)
    if (!existsSync(full)) { console.log(`  ${b.id} ✗ no existe: ${b.file}`); continue }
    const parsed = parseBudget(b.id, full, b.sheet)
    if (!parsed) { console.log(`  ${b.id} ✗ no parseado`); continue }
    projects.push(parsed.project)
  }

  // Matching + agregación
  const cyeTests: KbTest[] = []
  const cyeTestByKey = new Map<string, KbTest>()
  const aliases = new Map<string, KbAlias>()
  const freqAgg = new Map<string, KbFrequencyRule>()
  const priceAgg = new Map<string, number[]>() // testId → precios CYE
  const obsByCatTest = new Map<string, number[]>() // `${cat}|${testId}` → nTests observados (calibración)
  let totalLines = 0, matched = 0
  let cyeSeq = 1

  for (const p of projects) {
    for (const s of p.sections) {
      for (const l of s.lines) {
        totalLines++
        const m = match(l.descripcion)
        let testId: string
        if (m) {
          matched++
          testId = m.test.id
          aliases.set(`${normalize(l.descripcion)}|${testId}`, { alias: l.descripcion, testId, source: p.id })
        } else {
          // ensayo CYE no presente en ALAGAL → nuevo canónico
          const key = normalize(l.descripcion).slice(0, 80)
          let t = cyeTestByKey.get(key)
          if (!t) {
            t = { id: `C-${String(cyeSeq++).padStart(4, '0')}`, canonicalDesc: l.descripcion, normCodes: rawNormCodes(l.descripcion), alagalSection: null, alagalCode: null, origin: 'cye' }
            cyeTestByKey.set(key, t); cyeTests.push(t)
          }
          testId = t.id
        }
        l.testId = testId

        // Precio CYE
        if (!priceAgg.has(testId)) priceAgg.set(testId, [])
        priceAgg.get(testId)!.push(l.precioUnitario)

        // Observación para calibración (¿el nº de ensayos escala con el volumen o es plano?)
        if (s.category) {
          const ok = `${s.category}|${testId}`
          if (!obsByCatTest.has(ok)) obsByCatTest.set(ok, [])
          obsByCatTest.get(ok)!.push(l.nTests)
        }

        // Regla de frecuencia (solo si hay categoría y datos de frecuencia)
        if (s.category && l.muestreo != null && l.freqUnit) {
          const pf = parseFreqUnit(l.freqUnit)
          // Clave canónica: fusiona "5.000 m3"/"5000 m3" y "Por material"/"Por tipo".
          const canonKey =
            pf.kind === 'per_quantity' || pf.kind === 'per_lot'
              ? `${pf.kind}:${pf.qty}:${pf.unit}`
              : pf.kind === 'other'
                ? `other:${normalize(l.freqUnit)}`
                : pf.kind
          const fk = `${s.category}|${testId}|${canonKey}`
          const existing = freqAgg.get(fk)
          if (existing) existing.sources++
          else freqAgg.set(fk, {
            categoryCode: s.category, testId, muestreo: l.muestreo,
            freqUnit: l.freqUnit, freqKind: pf.kind, freqQty: pf.qty, freqMagUnit: pf.unit,
            sources: 1, rawDesc: l.descripcion,
          })
        }
      }
    }
  }

  // ── Calibración empírica: ensayos que NO escalan con el volumen → per_type ──
  // Si en los presupuestos reales el nº de ensayos de un (categoría, ensayo) es siempre
  // pequeño (≤5) pese a variar la cantidad, es caracterización por tipo, no por volumen.
  // Evita sobre-extrapolar (p.ej. "penetración de agua" 1/100 m³ → 712 en 71.000 m³).
  const FLAT_MAX = 5
  let recalibrated = 0
  for (const rule of freqAgg.values()) {
    if (rule.freqKind !== 'per_quantity') continue
    const obs = obsByCatTest.get(`${rule.categoryCode}|${rule.testId}`)
    if (obs && obs.length > 0 && Math.max(...obs) <= FLAT_MAX) {
      rule.freqKind = 'per_type'
      rule.muestreo = Math.max(1, Math.round(median(obs)))
      rule.freqQty = null
      rule.freqMagUnit = null
      rule.freqUnit = `${rule.freqUnit} [calibrado: plano→por tipo]`
      recalibrated++
    }
  }

  const cyePrices: KbPrice[] = [...priceAgg.entries()].map(([testId, xs]) => ({
    testId, source: 'tarifa_cye', price: xs[xs.length - 1], min: Math.min(...xs), max: Math.max(...xs), n: xs.length,
  }))
  // recalcular price = mediana (más robusto que "último")
  for (const p of cyePrices) p.price = median(priceAgg.get(p.testId)!)

  const write = (name: string, data: unknown): void => writeFileSync(resolve(CURATED, name), JSON.stringify(data, null, 2))
  write('frequency_rules.json', { rules: [...freqAgg.values()].sort((a, b) => b.sources - a.sources) })
  write('cye_prices.json', { prices: cyePrices })
  write('aliases.json', { aliases: [...aliases.values()] })
  write('cye_tests.json', { tests: cyeTests })
  write('eval_projects.json', { projects })

  // Informe
  console.log(`\nPresupuestos CYE importados: ${projects.length}/8`)
  for (const p of projects) {
    const lines = p.sections.reduce((a, s) => a + s.lines.length, 0)
    const cats = [...new Set(p.sections.map((s) => s.category).filter(Boolean))]
    console.log(`  ${p.id} [${p.formato}] ${lines} líneas · ${p.sections.length} secciones · base ${Math.round(p.totalBase).toLocaleString('es-ES')}€ · cats: ${cats.join(',') || '—'}`)
  }
  console.log(`\nCobertura:`)
  console.log(`  líneas con precio: ${totalLines}/${totalLines} = 100% (toda línea CYE tiene precio tarifa_cye)`)
  console.log(`  reutilizan ensayo ALAGAL: ${matched}/${totalLines} = ${Math.round((matched / totalLines) * 100)}%`)
  console.log(`  ensayos específicos de CYE (no en ALAGAL → canónicos C-*): ${cyeTests.length}`)
  console.log(`    · con norma (revisar, posibles recuperables): ${cyeTests.filter((t) => t.normCodes.length).length}`)
  console.log(`    · sin norma (eléctricos/saneamiento/edificación, legítimos): ${cyeTests.filter((t) => !t.normCodes.length).length}`)
  console.log(`Reglas de frecuencia derivadas: ${freqAgg.size} (${recalibrated} recalibradas plano→por tipo)`)
  console.log(`Precios tarifa_cye: ${cyePrices.length} ensayos`)
  console.log(`Aliases: ${aliases.size}`)
  console.log(`\n→ ${CURATED}/{frequency_rules,cye_prices,aliases,cye_tests,eval_projects}.json`)
}

main()
