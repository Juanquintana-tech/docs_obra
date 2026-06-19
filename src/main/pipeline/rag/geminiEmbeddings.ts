/**
 * Proveedor de embeddings Google Gemini (text-embedding-004, 768d).
 * Usa embeddings asimétricos: RETRIEVAL_DOCUMENT para indexar el catálogo,
 * RETRIEVAL_QUERY para las consultas en runtime. Esto mejora drásticamente
 * la recuperación frente a modelos simétricos como E5-small.
 *
 * Batch API: hasta 100 textos por llamada → muy eficiente para indexar ALAGAL.
 * Rate limit free tier: 1500 req/min (una llamada de batch = 1 req).
 * Requiere GEMINI_API_KEY en el .env.
 */
import type { EmbedKind, EmbeddingsProvider } from './types'

const GEMINI_MODEL = 'gemini-embedding-2'
const GEMINI_BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`
const DIM = 3072
const BATCH_SIZE = 100
const THROTTLE_MS = 200 // pausa entre lotes (holgura rate limit)

type GeminiTaskType = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY'

interface BatchRequest {
  model: string
  content: { parts: Array<{ text: string }> }
  taskType: GeminiTaskType
}

interface BatchResponse {
  embeddings: Array<{ values: number[] }>
  error?: { code: number; message: string }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export class GeminiEmbeddingsProvider implements EmbeddingsProvider {
  readonly id = 'gemini-embedding-2'
  readonly dim = DIM

  constructor(
    private readonly opts: {
      apiKey?: string
      onProgress?: (done: number, total: number) => void
    } = {}
  ) {}

  private apiKey(): string {
    const key = this.opts.apiKey ?? process.env.GEMINI_API_KEY ?? ''
    if (!key || key === 'tu_clave_aqui') {
      throw new Error('GEMINI_API_KEY no está configurada (añádela al .env)')
    }
    return key
  }

  private async embedBatch(texts: string[], taskType: GeminiTaskType): Promise<number[][]> {
    const requests: BatchRequest[] = texts.map((text) => ({
      model: `models/${GEMINI_MODEL}`,
      content: { parts: [{ text }] },
      taskType
    }))

    const url = `${GEMINI_BASE}:batchEmbedContents?key=${this.apiKey()}`
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(60_000)
    })

    if (!resp.ok) {
      const body = await resp.text().catch(() => '')
      throw new Error(`Gemini embeddings HTTP ${resp.status}: ${body.slice(0, 300)}`)
    }

    const data = (await resp.json()) as BatchResponse
    if (data.error) {
      throw new Error(`Gemini embeddings API error ${data.error.code}: ${data.error.message}`)
    }
    if (!data.embeddings?.length) {
      throw new Error('Gemini embeddings: respuesta vacía')
    }
    return data.embeddings.map((e) => e.values)
  }

  async embed(texts: string[], kind: EmbedKind = 'doc'): Promise<number[][]> {
    const taskType: GeminiTaskType =
      kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'
    const out: number[][] = []

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE)
      const vecs = await this.embedBatch(batch, taskType)
      out.push(...vecs)
      this.opts.onProgress?.(out.length, texts.length)
      if (i + BATCH_SIZE < texts.length) await sleep(THROTTLE_MS)
    }
    return out
  }
}
