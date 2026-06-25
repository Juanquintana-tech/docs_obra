/**
 * Motor de generación de planes de ensayo basado en LLM (Gemini Flash).
 *
 * Arquitectura sección a sección:
 *   Para cada material del proyecto, se hace una llamada Gemini independiente.
 *   Cada llamada recibe:
 *     - La sección y cantidad del material
 *     - Secciones históricas de esa misma categoría (con cantidades para escalar)
 *     - Tabla de frecuencias medias derivada del historial
 *     - Fragmento del price_book relevante para esa categoría
 *
 *   Esto elimina el "scale mismatch": el modelo escala dentro de cada sección,
 *   no entre secciones de tamaños muy diferentes.
 */
import { readFileSync, existsSync } from 'fs'
import { GeminiProvider } from './gemini'
import {
  loadHistoricalProjects,
  getSectionsByCategory,
  type SectionReference,
} from '../rag/historicalProjects'
import type { HistoricalProject } from '../rag/historicalProjects'
import type { Material, PlanRowInput } from '../types'
import { normalize } from '../rag/normalize'

// ── Tipos internos ─────────────────────────────────────────────────────────

interface PriceBookEntry {
  codigo: string
  descripcion: string
  reciente: number
  mediana: number
  min: number
  max: number
  n: number
}

interface LLMSectionLine {
  descripcion: string
  n_tests: number
  precio_unitario: number
}

interface LLMSectionResponse {
  ensayos: LLMSectionLine[]
}

// ── Price book ─────────────────────────────────────────────────────────────

let _priceBook: PriceBookEntry[] | null = null

function loadPriceBook(path: string): PriceBookEntry[] {
  if (_priceBook) return _priceBook
  if (!existsSync(path)) return []
  const { entries } = JSON.parse(readFileSync(path, 'utf-8')) as { entries: PriceBookEntry[] }
  _priceBook = entries
  return entries
}

function matchPriceBook(desc: string, entries: PriceBookEntry[]): PriceBookEntry | null {
  if (entries.length === 0) return null

  const normDesc = normalize(desc)
  const normDescTokens = new Set(normDesc.split(/\s+/).filter((t) => t.length > 3))

  const normCodes = desc.match(/(?:UNE|NLT|ASTM|EN)\s*[\d\-.:]+/gi) ?? []
  const normCodesNorm = normCodes.map((c) => normalize(c).replace(/\s+/g, ''))

  let bestEntry: PriceBookEntry | null = null
  let bestScore = -1

  for (const entry of entries) {
    const entryNorm = normalize(entry.descripcion)
    const entryTokens = new Set(entryNorm.split(/\s+/).filter((t) => t.length > 3))

    const entryNormCodes =
      entry.descripcion
        .match(/(?:UNE|NLT|ASTM|EN)\s*[\d\-.:]+/gi)
        ?.map((c) => normalize(c).replace(/\s+/g, '')) ?? []

    let normBonus = 0
    for (const code of normCodesNorm) {
      if (entryNormCodes.some((ec) => ec.includes(code) || code.includes(ec))) {
        normBonus += 0.3
      }
    }

    const inter = [...normDescTokens].filter((t) => entryTokens.has(t)).length
    const union = new Set([...normDescTokens, ...entryTokens]).size
    const jaccard = union > 0 ? inter / union : 0

    const score = jaccard + normBonus
    if (score > bestScore) {
      bestScore = score
      bestEntry = entry
    }
  }

  return bestScore >= 0.2 ? bestEntry : null
}

// ── Frecuencias históricas ─────────────────────────────────────────────────

interface FrequencyRow {
  desc: string
  testsPerUnit: number
  sources: number
}

/**
 * Normaliza unidades para comparación (m3/m³ → m3, m2/m² → m2, etc.)
 */
function normUnit(u: string): string {
  return u.trim().toLowerCase()
    .replace('³', '3').replace('²', '2')
    .replace(/\s+/g, '')
}

/**
 * Calcula frecuencias SOLO cuando la unidad histórica coincide con la del material.
 * Si no hay coincidencia de unidades, devuelve [] para no propagar unidades erróneas.
 */
function computeFrequencies(refs: SectionReference[], materialUnit: string): FrequencyRow[] {
  const targetUnit = normUnit(materialUnit)
  const byKey = new Map<string, { desc: string; totalRate: number; sources: number }>()

  for (const { section } of refs) {
    if (!section.quantity || section.quantity <= 0) continue
    if (!section.unit) continue
    // Solo usar si la unidad coincide
    if (normUnit(section.unit) !== targetUnit) continue

    for (const test of section.tests) {
      const key = normalize(test.descripcion).slice(0, 60)
      if (!byKey.has(key)) {
        byKey.set(key, { desc: test.descripcion, totalRate: 0, sources: 0 })
      }
      const entry = byKey.get(key)!
      entry.totalRate += test.n_tests / section.quantity
      entry.sources++
    }
  }

  return Array.from(byKey.values())
    .map(({ desc, totalRate, sources }) => ({
      desc,
      testsPerUnit: totalRate / sources,
      sources,
    }))
    .sort((a, b) => b.sources - a.sources)
}

// ── Price book filtrado por categoría ─────────────────────────────────────

/**
 * Devuelve las entradas del price_book más relevantes para una categoría.
 * Prioriza los ensayos que aparecen en las secciones históricas de esa categoría.
 */
function priceBookForCategory(
  allEntries: PriceBookEntry[],
  refs: SectionReference[]
): PriceBookEntry[] {
  if (refs.length === 0) return allEntries.filter((e) => e.n >= 20)

  const usedNorms = new Set<string>()
  const usedDescs = new Set<string>()

  for (const { section } of refs) {
    for (const test of section.tests) {
      usedDescs.add(normalize(test.descripcion))
      const codes = test.descripcion.match(/(?:UNE|NLT|ASTM|EN)\s*[\d\-.:]+/gi) ?? []
      for (const c of codes) usedNorms.add(normalize(c).replace(/\s+/g, ''))
    }
  }

  const relevant = allEntries.filter((e) => {
    const nd = normalize(e.descripcion)
    if (usedDescs.has(nd)) return true
    const eCodes =
      e.descripcion
        .match(/(?:UNE|NLT|ASTM|EN)\s*[\d\-.:]+/gi)
        ?.map((c) => normalize(c).replace(/\s+/g, '')) ?? []
    return eCodes.some((ec) => usedNorms.has(ec))
  })

  // Siempre incluir entradas muy frecuentes aunque no aparezcan en el historial
  const highFreq = allEntries.filter((e) => e.n >= 30 && !relevant.includes(e))
  return [...relevant, ...highFreq]
}

// ── Construcción del prompt por sección ───────────────────────────────────

function fmt(n: number, unit: string): string {
  return `${n.toLocaleString('es-ES')} ${unit}`
}

function buildSectionPrompt(
  material: Material,
  refs: SectionReference[],
  freqs: FrequencyRow[],
  pbEntries: PriceBookEntry[],
  strategy: 'reciente' | 'mediana'
): string {
  const matName = material.material ?? material.description ?? material.category ?? 'Material'
  const qty = material.quantity
  const unit = material.unit ?? ''

  // ── Bloque de secciones históricas ─────────────────────────────────────
  let histBlock = ''
  if (refs.length > 0) {
    const refLines = refs.map(({ projectId, projectNombre, section }) => {
      const qtyStr = section.quantity
        ? `${fmt(section.quantity, section.unit ?? unit)}`
        : '(cantidad desconocida)'
      const tests = section.tests
        .map((t) => {
          const rate =
            section.quantity && section.quantity > 0
              ? ` → 1 por ${Math.round(section.quantity / t.n_tests).toLocaleString('es-ES')} ${section.unit ?? unit}`
              : ''
          return `    ${t.descripcion.slice(0, 70)}: ${t.n_tests} uds${rate}`
        })
        .join('\n')
      return `  ${projectId} — ${projectNombre.slice(0, 50)} (${qtyStr}):\n${tests}`
    })
    histBlock = `HISTORIAL — MISMA CATEGORÍA (${refs.length} proyecto${refs.length > 1 ? 's' : ''}):\n${refLines.join('\n\n')}\n\n`
  }

  // ── Tabla de frecuencias medias ─────────────────────────────────────────
  let freqBlock = ''
  if (freqs.length > 0 && qty != null && qty > 0) {
    const freqLines = freqs
      .slice(0, 20)
      .map((f) => {
        const estimated = Math.max(1, Math.round(f.testsPerUnit * qty))
        return `  ${f.desc.slice(0, 65)}: ~${estimated} ensayos (${(f.testsPerUnit * 1000).toFixed(2)} por 1.000 ${unit})`
      })
      .join('\n')
    freqBlock = `FRECUENCIAS MEDIAS HISTÓRICAS → estimación para ${fmt(qty, unit)}:\n${freqLines}\n\n`
  }

  // ── Catálogo de precios ─────────────────────────────────────────────────
  const pbLines = pbEntries
    .map((e) => {
      const price = strategy === 'mediana' ? e.mediana : e.reciente
      return `  ${e.descripcion} → ${price}€`
    })
    .join('\n')

  const qtyStr = qty != null ? fmt(qty, unit) : '(cantidad no especificada)'

  return `Eres un ingeniero experto en planes de control de calidad para obras civiles en España.

TAREA: Genera el plan de ensayos EXCLUSIVAMENTE para la siguiente sección.

SECCIÓN: ${matName}
CANTIDAD: ${qtyStr}

${histBlock}${freqBlock}CATÁLOGO DE PRECIOS DISPONIBLE (${pbEntries.length} ensayos para esta categoría):
${pbLines}

REGLAS:
1. Usa SOLO descripciones que aparezcan EXACTAMENTE en el catálogo de precios.
2. Usa las frecuencias históricas como referencia principal para n_tests.
3. Incluye TODOS los ensayos aplicables: caracterización, control ejecución, recepción.
4. No omitas ensayos que aparezcan en el historial de esta misma categoría.
5. precio_unitario = el precio del catálogo para esa descripción.
6. Responde SOLO con JSON válido, sin markdown ni texto adicional.

FORMATO:
{"ensayos": [{"descripcion": "descripción exacta del catálogo", "n_tests": número_entero, "precio_unitario": número}]}`
}

// ── Parseo de respuesta ───────────────────────────────────────────────────

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

// ── Retry helper ─────────────────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  delayMs = 6000
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        const wait = delayMs * attempt
        console.warn(`[plannerLLM] retry ${attempt}/${maxAttempts - 1} en ${wait / 1000}s...`)
        await new Promise((r) => setTimeout(r, wait))
      }
    }
  }
  throw lastErr
}

// ── Generación de una sección ─────────────────────────────────────────────

async function generateSectionLLM(
  material: Material,
  allEntries: PriceBookEntry[],
  historical: HistoricalProject[],
  opts: PlannerLLMOptions
): Promise<PlanRowInput[]> {
  const category = material.category ?? ''
  const refs = getSectionsByCategory(historical, category, opts.excludeProjectId)
  const pbEntries = priceBookForCategory(allEntries, refs)

  const strategy = opts.strategy ?? 'reciente'
  const freqs = computeFrequencies(refs, material.unit ?? '')
  const prompt = buildSectionPrompt(material, refs, freqs, pbEntries, strategy)

  const gemini = new GeminiProvider()
  const sectionName = material.material ?? material.description ?? material.category ?? 'Sección'

  const raw = await withRetry(() =>
    gemini.chat(
      'Eres un experto en control de calidad de obras civiles. Responde solo con JSON.',
      prompt,
      { maxTokens: 4096, timeoutMs: 90_000, tag: `section:${sectionName.slice(0, 30)}` }
    )
  )

  let parsed: LLMSectionResponse
  try {
    parsed = JSON.parse(stripFences(raw)) as LLMSectionResponse
  } catch {
    throw new Error(`plannerLLM[${sectionName}]: JSON inválido:\n${raw.slice(0, 300)}`)
  }

  if (!Array.isArray(parsed.ensayos) || parsed.ensayos.length === 0) {
    return []
  }

  return parsed.ensayos.map((line): PlanRowInput => {
    const pb = matchPriceBook(line.descripcion, allEntries)
    const unitPrice = pb
      ? (strategy === 'mediana' ? pb.mediana : pb.reciente)
      : line.precio_unitario ?? 0

    const nTests = Math.max(1, Math.round(line.n_tests ?? 1))
    const total = nTests * unitPrice

    return {
      material: sectionName,
      description: line.descripcion,
      n_lots: null,
      n_tests: nTests,
      unit_price: unitPrice,
      total,
      price_source: pb ? 'pricebook' : 'llm_fallback',
      rag_score: pb ? 1.0 : 0.5,
      rag_desc: pb?.descripcion ?? line.descripcion,
      price_min: pb?.min ?? null,
      price_max: pb?.max ?? null,
      price_n: pb?.n ?? null,
    }
  })
}

// ── API pública ───────────────────────────────────────────────────────────

export interface PlannerLLMOptions {
  priceBookPath: string
  historicalProjectsPath: string
  strategy?: 'reciente' | 'mediana'
  excludeProjectId?: string
}

/**
 * Genera el plan de ensayos completo procesando cada material de forma independiente.
 *
 * Una llamada Gemini por sección → cada sección se calibra con su propio historial
 * → sin "scale mismatch" entre secciones de tamaños muy distintos.
 * Las secciones se procesan en paralelo para minimizar el tiempo de respuesta.
 */
export async function generatePlanLLM(
  materials: Material[],
  opts: PlannerLLMOptions
): Promise<PlanRowInput[]> {
  if (materials.length === 0) return []

  const priceBook = loadPriceBook(opts.priceBookPath)
  const historical = loadHistoricalProjects(opts.historicalProjectsPath)
    .filter((p) => p.id !== opts.excludeProjectId)

  // Procesar secciones con concurrencia limitada para evitar rate-limiting de la API
  const CONCURRENCY = 4
  const results: PromiseSettledResult<PlanRowInput[]>[] = []
  for (let i = 0; i < materials.length; i += CONCURRENCY) {
    const batch = materials.slice(i, i + CONCURRENCY)
    const batchResults = await Promise.allSettled(
      batch.map((m) => generateSectionLLM(m, priceBook, historical, opts))
    )
    results.push(...batchResults)
  }

  const allLines: PlanRowInput[] = []
  for (let i = 0; i < results.length; i++) {
    const r = results[i]
    const name = materials[i].material ?? materials[i].category ?? `sección ${i + 1}`
    if (r.status === 'fulfilled') {
      allLines.push(...r.value)
    } else {
      console.error(`[plannerLLM] Error en sección "${name}":`, r.reason)
    }
  }

  return allLines
}

export function invalidatePlannerCache(): void {
  _priceBook = null
  const { invalidateHistoricalCache } = require('../rag/historicalProjects') as typeof import('../rag/historicalProjects')
  invalidateHistoricalCache()
}
