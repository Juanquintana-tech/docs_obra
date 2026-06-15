/**
 * Factoría del proveedor de embeddings. Por defecto: LOCAL (transformers.js,
 * sin API ni rate limit) — el más robusto para una app de escritorio offline.
 * MiniMax queda disponible (minimaxEmbeddings.ts) como alternativa enchufable;
 * para usarlo, devolver aquí MiniMaxEmbeddingsProvider en su lugar.
 */
import { LocalEmbeddingsProvider } from './localEmbeddings'
import type { EmbeddingsProvider } from './types'

export function createEmbeddingsProvider(): EmbeddingsProvider {
  return new LocalEmbeddingsProvider()
}
