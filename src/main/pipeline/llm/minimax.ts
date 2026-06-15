/**
 * Proveedor LLM MiniMax (port de agents/classifier.py:_chat).
 * Usa fetch nativo (Node 18+/Electron) — sin dependencias extra.
 */
import { LlmError, type ChatOptions, type LlmProvider } from './types'

const MINIMAX_URL = 'https://api.minimaxi.chat/v1/chat/completions'
const MINIMAX_MODEL = 'MiniMax-Text-01'

export interface MiniMaxOptions {
  /** Si no se pasa, se lee de process.env.MINIMAX_API_KEY. */
  apiKey?: string
  model?: string
}

export class MiniMaxProvider implements LlmProvider {
  readonly id = 'minimax'
  private readonly model: string

  constructor(private readonly opts: MiniMaxOptions = {}) {
    this.model = opts.model ?? MINIMAX_MODEL
  }

  private apiKey(): string {
    const key = this.opts.apiKey ?? process.env.MINIMAX_API_KEY ?? ''
    if (!key || key === 'your_key_here') {
      throw new LlmError(
        'MINIMAX_API_KEY no está configurada (añádela al .env o pásala al proveedor)',
        this.id
      )
    }
    return key
  }

  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<string> {
    const { maxTokens = 4096, timeoutMs = 120_000, tag = 'minimax' } = opts
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(MINIMAX_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          max_tokens: maxTokens
        }),
        signal: controller.signal
      })
      if (!resp.ok) {
        const body = await resp.text().catch(() => '')
        throw new LlmError(`${tag}: HTTP ${resp.status} — ${body.slice(0, 500)}`, this.id)
      }
      const data = (await resp.json()) as {
        choices?: Array<{ message?: { content?: string } }>
        base_resp?: { status_code?: number; status_msg?: string }
      }
      const choices = data.choices ?? []
      if (choices.length === 0) {
        // MiniMax puede devolver 200 con error de negocio en base_resp
        const base = data.base_resp ?? {}
        throw new LlmError(
          `${tag}: respuesta sin 'choices' (status=${base.status_code}, msg=${base.status_msg})`,
          this.id
        )
      }
      return stripMdFences(choices[0]?.message?.content ?? '')
    } catch (e) {
      if (e instanceof LlmError) throw e
      throw new LlmError(`${tag}: petición fallida`, this.id, e)
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Quita el fence markdown (```json … ```) si la respuesta viene envuelta. */
export function stripMdFences(raw: string): string {
  const s = raw.trim()
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
  return m ? m[1].trim() : s
}
