/**
 * Re-ranker LLM para zona gris RAG (RAG-2).
 *
 * Cuando el mejor match TF-IDF/embedding cae en la zona gris [GRAY_LOW, GRAY_HIGH],
 * se llama a Gemini Flash con los top-N candidatos para elegir el mejor semánticamente.
 * Solo se usa para la búsqueda validación (findMatchesHybrid) — priceMany lo omite
 * para no multiplicar costes en lotes grandes.
 */
import type { RagMatch } from './types'
import { GeminiProvider } from '../llm/gemini'

/** Rango de scores donde el re-ranker actúa. Fuera de este rango no merece la pena llamar al LLM. */
export const GRAY_LOW = 0.35
export const GRAY_HIGH = 0.65

const SYSTEM_PROMPT = `Eres un experto en precios de ensayos de laboratorio de control de calidad en obras de ingeniería civil española.
Tu única tarea es elegir qué entrada del catálogo ALAGAL describe MEJOR el ensayo solicitado.
Responde EXCLUSIVAMENTE con el número del candidato (1, 2, 3, 4 o 5). Sin explicación, sin texto adicional.`

/**
 * Dado un array de candidatos para una consulta, devuelve el índice (0-based) del mejor
 * según el LLM, o null si no puede re-rankear (sin API key, error de red, etc.).
 *
 * @param query        Descripción del ensayo que queremos preciar.
 * @param candidates   Los mejores N matches del índice RAG, ordenados por score desc.
 * @param gemini       Instancia de GeminiProvider ya construida.
 */
export async function rerankCandidates(
  query: string,
  candidates: RagMatch[],
  gemini: GeminiProvider
): Promise<number | null> {
  if (candidates.length === 0) return null
  if (candidates.length === 1) return 0

  const list = candidates
    .slice(0, 5)
    .map((c, i) => `${i + 1}. ${c.descripcion} [${c.codigo}] — ${c.precio != null ? c.precio + ' €' : 'sin precio'}`)
    .join('\n')

  const userMsg = `Ensayo a preciar: "${query}"\n\nCandidatos del catálogo:\n${list}\n\n¿Cuál es el mejor match? Responde solo con el número.`

  try {
    const raw = await gemini.chat(SYSTEM_PROMPT, userMsg, {
      maxTokens: 8,
      timeoutMs: 15_000,
      tag: 'reranker'
    })
    const n = parseInt(raw.trim(), 10)
    if (!isNaN(n) && n >= 1 && n <= candidates.length) return n - 1
    return null
  } catch {
    return null
  }
}

/**
 * Aplica re-ranking a una lista de matches si el top score cae en zona gris.
 * Devuelve los matches con el ganador del LLM promovido al primer lugar.
 */
export async function maybeRerank(
  query: string,
  matches: RagMatch[],
  gemini: GeminiProvider
): Promise<RagMatch[]> {
  if (matches.length === 0) return matches
  const topScore = matches[0].score
  if (topScore < GRAY_LOW || topScore > GRAY_HIGH) return matches

  const bestIdx = await rerankCandidates(query, matches, gemini)
  if (bestIdx === null || bestIdx === 0) return matches

  // Mueve el ganador al primer lugar, ajusta su score al del original top
  const reranked = [...matches]
  const winner = { ...reranked[bestIdx], score: reranked[0].score }
  reranked.splice(bestIdx, 1)
  reranked.unshift(winner)
  return reranked
}
