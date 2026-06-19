/**
 * Factoría del proveedor de embeddings.
 * Proveedor activo: gemini-embedding-2 (3072d, asimétrico RETRIEVAL_DOCUMENT/QUERY).
 * Mejora drásticamente la discriminación respecto a E5-small (384d, simétrico),
 * que saturaba en ~0.96–0.99 haciendo imposible calibrar un umbral útil.
 *
 * Requiere GEMINI_API_KEY en .env. Para entorno offline sin API puede
 * sustituirse por LocalEmbeddingsProvider (localEmbeddings.ts).
 */
import { GeminiEmbeddingsProvider } from './geminiEmbeddings'
import type { EmbeddingsProvider } from './types'

export function createEmbeddingsProvider(): EmbeddingsProvider {
  return new GeminiEmbeddingsProvider()
}
