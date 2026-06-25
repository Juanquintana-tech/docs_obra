/**
 * Motor de generación de planes de ensayo basado en LLM (Gemini Flash).
 *
 * Flujo:
 *   1. Carga price_book.json y historical_projects.json.
 *   2. Selecciona los 3 proyectos históricos más similares como few-shot.
 *   3. Llama a Gemini con: materiales + ejemplos + catálogo de precios.
 *   4. Mapea cada descripción generada al precio determinista del price_book.
 *   5. Devuelve PlanRowInput[] compatible con el formatter existente.
 */
import { readFileSync, existsSync } from 'fs'
import { GeminiProvider } from './gemini'
import { loadHistoricalProjects, findSimilarProjects } from '../rag/historicalProjects'
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

interface LLMPlanLine {
  seccion: string
  descripcion: string
  n_tests: number
  precio_unitario: number
}

interface LLMResponse {
  ensayos: LLMPlanLine[]
}

// ── Price book lookup ──────────────────────────────────────────────────────

let _priceBook: PriceBookEntry[] | null = null

function loadPriceBook(path: string): PriceBookEntry[] {
  if (_priceBook) return _priceBook
  if (!existsSync(path)) return []
  const { entries } = JSON.parse(readFileSync(path, 'utf-8')) as { entries: PriceBookEntry[] }
  _priceBook = entries
  return entries
}

/**
 * Busca la entrada más cercana del price_book para una descripción dada.
 * 1º intento: coincidencia de norma (UNE/NLT/ASTM) + palabra clave principal.
 * 2º intento: máximo solapamiento de tokens normalizados.
 */
function matchPriceBook(desc: string, entries: PriceBookEntry[]): PriceBookEntry | null {
  if (entries.length === 0) return null

  const normDesc = normalize(desc)
  const normDescTokens = new Set(normDesc.split(/\s+/).filter((t) => t.length > 3))

  // Extraer códigos de norma del texto (UNE 103101, NLT-357, etc.)
  const normCodes = desc.match(/(?:UNE|NLT|ASTM|EN)\s*[\d\-.:]+/gi) ?? []
  const normCodesNorm = normCodes.map((c) => normalize(c).replace(/\s+/g, ''))

  let bestEntry: PriceBookEntry | null = null
  let bestScore = -1

  for (const entry of entries) {
    const entryNorm = normalize(entry.descripcion)
    const entryTokens = new Set(entryNorm.split(/\s+/).filter((t) => t.length > 3))

    // Bonus por coincidencia de código de norma
    const entryNormCodes = entry.descripcion
      .match(/(?:UNE|NLT|ASTM|EN)\s*[\d\-.:]+/gi)
      ?.map((c) => normalize(c).replace(/\s+/g, '')) ?? []

    let normBonus = 0
    for (const code of normCodesNorm) {
      if (entryNormCodes.some((ec) => ec.includes(code) || code.includes(ec))) {
        normBonus += 0.3
      }
    }

    // Jaccard sobre tokens
    const inter = [...normDescTokens].filter((t) => entryTokens.has(t)).length
    const union = new Set([...normDescTokens, ...entryTokens]).size
    const jaccard = union > 0 ? inter / union : 0

    const score = jaccard + normBonus
    if (score > bestScore) {
      bestScore = score
      bestEntry = entry
    }
  }

  // Umbral mínimo: al menos 20% solapamiento
  return bestScore >= 0.2 ? bestEntry : null
}

// ── Formateo del prompt ───────────────────────────────────────────────────

function formatPriceBookForPrompt(entries: PriceBookEntry[]): string {
  return entries
    .map((e) => `  ${e.descripcion} → ${e.reciente}€`)
    .join('\n')
}

function formatMaterials(materials: Material[]): string {
  return materials
    .map((m) => {
      const qty = m.quantity != null ? `${m.quantity.toLocaleString('es-ES')} ${m.unit ?? ''}` : '(cantidad no especificada)'
      return `  - ${m.material ?? m.description ?? m.category}: ${qty}`
    })
    .join('\n')
}

// Máximo de líneas por ejemplo en el prompt.
// 100 líneas es el sweet-spot: suficiente para aprender frecuencias sin
// overwhelmar al modelo con contexto redundante.
const MAX_EXAMPLE_LINES = 100

function formatExample(p: HistoricalProject): string {
  const lines = p.plan.slice(0, MAX_EXAMPLE_LINES)
  const planText = lines
    .map((l) => `    ${l.seccion} | ${l.descripcion} | ${l.n_tests} uds × ${l.precio_unitario}€ = ${l.importe}€`)
    .join('\n')
  const more = p.plan.length > MAX_EXAMPLE_LINES
    ? `\n    ... (${p.plan.length - MAX_EXAMPLE_LINES} líneas más, proporcionalmente)`
    : ''
  return `### ${p.id}: ${p.nombre}\nCategorías: ${p.categories.join(', ')}\nBase imponible: ${p.total_base.toLocaleString('es-ES')} €\nPlan:\n${planText}${more}`
}

// ── Parseo de respuesta JSON ──────────────────────────────────────────────

function stripFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
}

// ── API pública ───────────────────────────────────────────────────────────

export interface PlannerLLMOptions {
  priceBookPath: string
  historicalProjectsPath: string
  strategy?: 'reciente' | 'mediana'
  /** Excluir este id del few-shot (útil en benchmarks para evitar auto-referencia). */
  excludeProjectId?: string
}

/**
 * Filtra el price_book a las entradas relevantes para los ejemplos similares +
 * las categorías de materiales. Reduce el prompt ~3x sin perder cobertura.
 */
function relevantPriceBook(
  allEntries: PriceBookEntry[],
  similar: HistoricalProject[]
): PriceBookEntry[] {
  if (similar.length === 0) return allEntries

  // Recoger todas las descripciones que aparecen en los proyectos similares
  const usedDescs = new Set<string>()
  for (const p of similar) {
    for (const l of p.plan) usedDescs.add(normalize(l.descripcion))
  }

  // Incluir entrada si su norma normalizada aparece en algún proyecto similar
  const relevant = allEntries.filter((e) => {
    const nd = normalize(e.descripcion)
    // Coincidencia exacta o alta por norma
    if (usedDescs.has(nd)) return true
    // Coincidencia de código de norma
    const codes = e.descripcion.match(/(?:UNE|NLT|ASTM|EN)\s*[\d\-.:]+/gi) ?? []
    for (const code of codes) {
      const nc = normalize(code).replace(/\s/g, '')
      for (const ud of usedDescs) {
        if (ud.includes(nc)) return true
      }
    }
    return false
  })

  // Siempre incluir entradas muy frecuentes (n >= 30) aunque no estén en ejemplos
  const highFreq = allEntries.filter((e) => e.n >= 30 && !relevant.includes(e))
  return [...relevant, ...highFreq]
}

export async function generatePlanLLM(
  materials: Material[],
  opts: PlannerLLMOptions
): Promise<PlanRowInput[]> {
  const priceBook = loadPriceBook(opts.priceBookPath)
  const historical = loadHistoricalProjects(opts.historicalProjectsPath)
    .filter((p) => p.id !== opts.excludeProjectId)
  const similar = findSimilarProjects(materials, historical, 3)
  const filteredPB = relevantPriceBook(priceBook, similar)

  const gemini = new GeminiProvider()

  const systemPrompt = `Eres un ingeniero experto en planes de control de calidad para obras civiles en España.
Tu tarea: dado un listado de materiales con cantidades, generar el plan COMPLETO y EXHAUSTIVO de ensayos de laboratorio.

REGLAS ESTRICTAS:
1. Usa ÚNICAMENTE descripciones de ensayo que aparezcan en el CATÁLOGO DE PRECIOS siguiente.
2. Calcula n_tests según las frecuencias del PG-3 (Art. 330 y siguientes) y los ejemplos adjuntos.
3. precio_unitario = el precio del catálogo para esa descripción exacta.
4. NO omitas ensayos de caracterización, control de ejecución ni control de recepción. Incluye TODOS.
5. Responde EXCLUSIVAMENTE con JSON válido, sin texto ni markdown adicional.
6. Es CRÍTICO que el plan sea exhaustivo: un plan incompleto subestima el presupuesto.

CATÁLOGO DE PRECIOS DISPONIBLES (${filteredPB.length} entradas relevantes):
${formatPriceBookForPrompt(filteredPB)}

FORMATO DE RESPUESTA:
{
  "ensayos": [
    { "seccion": "nombre del capítulo/material", "descripcion": "descripción exacta del catálogo", "n_tests": número_entero, "precio_unitario": número }
  ]
}`

  const examplesBlock =
    similar.length > 0
      ? `PROYECTOS SIMILARES (usa como referencia de frecuencias y estructura):\n${similar.map(formatExample).join('\n\n')}\n\n`
      : ''

  const userPrompt = `${examplesBlock}NUEVO PROYECTO — materiales y cantidades:
${formatMaterials(materials)}

Genera el plan completo de ensayos en JSON.`

  // Timeout generoso: el prompt puede ser largo (>10k tokens)
  const raw = await gemini.chat(systemPrompt, userPrompt, {
    maxTokens: 16384,
    timeoutMs: 120_000,
    tag: 'plannerLLM',
  })

  let parsed: LLMResponse
  try {
    parsed = JSON.parse(stripFences(raw)) as LLMResponse
  } catch {
    throw new Error(`plannerLLM: respuesta JSON inválida de Gemini:\n${raw.slice(0, 500)}`)
  }

  if (!Array.isArray(parsed.ensayos) || parsed.ensayos.length === 0) {
    throw new Error('plannerLLM: Gemini devolvió un plan vacío.')
  }

  const strategy = opts.strategy ?? 'reciente'

  return parsed.ensayos.map((line): PlanRowInput => {
    const pb = matchPriceBook(line.descripcion, priceBook)
    const unitPrice = pb
      ? (strategy === 'mediana' ? pb.mediana : pb.reciente)
      : line.precio_unitario ?? 0

    const nTests = Math.max(1, Math.round(line.n_tests ?? 1))
    const total = nTests * unitPrice

    return {
      material: line.seccion,
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

export function invalidatePlannerCache(): void {
  _priceBook = null
  const { invalidateHistoricalCache } = require('../rag/historicalProjects') as typeof import('../rag/historicalProjects')
  invalidateHistoricalCache()
}
