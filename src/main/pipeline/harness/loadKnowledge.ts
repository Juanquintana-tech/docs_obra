/** Helpers comunes para los scripts del harness (ejecutados con tsx bajo Node). */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { RagPricer, type EmbeddingsIndexFile } from '../rag/ragPricer'
import { createEmbeddingsProvider } from '../rag/embeddings'
import type { Rules } from '../planner'

export const KNOWLEDGE_DIR = resolve(process.cwd(), 'resources/knowledge')
export const RULES_PATH = resolve(KNOWLEDGE_DIR, 'test_rules.json')
export const TARIFAS_PATH = resolve(KNOWLEDGE_DIR, 'tarifas_alagal.xlsx')
export const EMBEDDINGS_PATH = resolve(KNOWLEDGE_DIR, 'alagal_embeddings.json')

export function loadRules(): Rules {
  return JSON.parse(readFileSync(RULES_PATH, 'utf-8')) as Rules
}

/**
 * Construye el RAG. Si existe el índice de embeddings, activa el modo híbrido
 * (igual que el servicio del main), de modo que los demos reflejen el comportamiento real.
 * Pasa `tfidfOnly` para forzar solo TF-IDF (comparativas).
 */
export async function buildPricer(tfidfOnly = false): Promise<RagPricer> {
  if (tfidfOnly) return RagPricer.fromXlsx(TARIFAS_PATH)
  const pricer = await RagPricer.fromXlsx(TARIFAS_PATH, { embeddings: createEmbeddingsProvider() })
  if (existsSync(EMBEDDINGS_PATH)) {
    pricer.loadEmbeddings(JSON.parse(readFileSync(EMBEDDINGS_PATH, 'utf-8')) as EmbeddingsIndexFile)
  }
  return pricer
}
