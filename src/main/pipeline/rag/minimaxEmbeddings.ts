/**
 * Proveedor de embeddings MiniMax (embo-01). Implementa EmbeddingsProvider.
 *
 * Robusto frente al rate limit (RPM) de la API:
 *   · batching: varios textos por petición (menos llamadas)
 *   · throttle entre lotes
 *   · reintento con backoff exponencial ante status_code 1002 (rate limit)
 *
 * Respuesta de la API: { vectors: number[][], base_resp: { status_code, status_msg } }
 * status_code 0 = OK; 1002 = rate limit. No requiere GroupId.
 */
import type { EmbedKind, EmbeddingsProvider } from './types'

const MINIMAX_EMBED_URL = 'https://api.minimaxi.chat/v1/embeddings'
const MINIMAX_EMBED_MODEL = 'embo-01'
const EMBO_DIM = 1536

export interface MiniMaxEmbeddingsOptions {
  apiKey?: string
  /** textos por petición (lote) */
  batchSize?: number
  /** pausa base entre lotes, ms */
  throttleMs?: number
  /** reintentos ante rate limit */
  maxRetries?: number
  /** callback de progreso (procesados / total) */
  onProgress?: (done: number, total: number) => void
}

interface EmbedResponse {
  vectors: number[][] | null
  base_resp?: { status_code?: number; status_msg?: string }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class MiniMaxEmbeddingsProvider implements EmbeddingsProvider {
  readonly id = 'minimax-embo-01'
  readonly dim = EMBO_DIM
  private readonly batchSize: number
  private readonly throttleMs: number
  private readonly maxRetries: number

  constructor(private readonly opts: MiniMaxEmbeddingsOptions = {}) {
    this.batchSize = opts.batchSize ?? 16
    this.throttleMs = opts.throttleMs ?? 1500
    this.maxRetries = opts.maxRetries ?? 8
  }

  private apiKey(): string {
    const key = this.opts.apiKey ?? process.env.MINIMAX_API_KEY ?? ''
    if (!key || key === 'your_key_here') {
      throw new Error('MINIMAX_API_KEY no está configurada para embeddings')
    }
    return key
  }

  /** Una petición (un lote). Reintenta ante rate limit con backoff. */
  private async embedBatch(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const type = kind === 'query' ? 'query' : 'db'
    let attempt = 0
    for (;;) {
      const resp = await fetch(MINIMAX_EMBED_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model: MINIMAX_EMBED_MODEL, texts, type }),
        signal: AbortSignal.timeout(60_000)
      })
      const data = (await resp.json()) as EmbedResponse
      const code = data.base_resp?.status_code ?? 0

      if (data.vectors && code === 0) return data.vectors

      // 1002 = rate limit (RPM) → backoff y reintento
      if (code === 1002 && attempt < this.maxRetries) {
        attempt++
        const wait = Math.min(60_000, this.throttleMs * 2 ** attempt)
        await sleep(wait)
        continue
      }
      throw new Error(
        `MiniMax embeddings error (status=${code}, msg=${data.base_resp?.status_msg ?? '?'})`
      )
    }
  }

  async embed(texts: string[], kind: EmbedKind = 'doc'): Promise<number[][]> {
    const out: number[][] = []
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)
      const vecs = await this.embedBatch(batch, kind)
      out.push(...vecs)
      this.opts.onProgress?.(out.length, texts.length)
      if (i + this.batchSize < texts.length) await sleep(this.throttleMs)
    }
    return out
  }
}

/** Normaliza un vector a norma L2 = 1 (para que el coseno sea un simple producto escalar). */
export function l2normalize(v: number[]): number[] {
  let norm = 0
  for (const x of v) norm += x * x
  norm = Math.sqrt(norm) || 1
  return v.map((x) => x / norm)
}
