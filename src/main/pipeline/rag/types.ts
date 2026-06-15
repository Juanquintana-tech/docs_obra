/**
 * Proveedor de embeddings enchufable. En la Fase 1 el RAG funciona solo con
 * TF-IDF (provider = null). Cuando se elija proveedor (OpenAI / Voyage / MiniMax)
 * se implementa esta interfaz y el ragPricer combina ambas señales (híbrido).
 */
export interface EmbeddingsProvider {
  readonly id: string
  /** Vectoriza una lista de textos. Devuelve un vector por texto. */
  embed(texts: string[]): Promise<number[][]>
}

export interface RagMatch {
  descripcion: string
  precio: number
  codigo: string
  categoria: string
  score: number
}
