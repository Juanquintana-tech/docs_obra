/**
 * Proveedor de embeddings enchufable. En la Fase 1 el RAG funciona solo con
 * TF-IDF (provider = null). Cuando se elija proveedor (OpenAI / Voyage / MiniMax)
 * se implementa esta interfaz y el ragPricer combina ambas señales (híbrido).
 */
/** "doc" para entradas del catálogo, "query" para consultas (embeddings asimétricos). */
export type EmbedKind = 'doc' | 'query'

export interface EmbeddingsProvider {
  readonly id: string
  /** Dimensión del vector que produce (para validar/persistir). */
  readonly dim: number
  /** Vectoriza una lista de textos. Devuelve un vector por texto, en el mismo orden. */
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>
}

export interface RagMatch {
  descripcion: string
  precio: number
  codigo: string
  categoria: string
  score: number
}
