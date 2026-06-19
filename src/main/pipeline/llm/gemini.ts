/**
 * Proveedor LLM Google Gemini con soporte de visión.
 * Usa fetch nativo (Node 18+/Electron) — sin dependencias extra.
 * Modelo predeterminado: gemini-3-flash-preview con fallback a gemini-2.5-flash.
 */
import { LlmError, type ChatOptions, type LlmProvider, type VisionOptions } from './types'
import { stripMdFences } from './minimax'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_MODEL = 'gemini-3-flash-preview'
const GEMINI_FALLBACK_MODEL = 'gemini-2.5-flash'

export interface GeminiOptions {
  apiKey?: string
  model?: string
}

export class GeminiProvider implements LlmProvider {
  readonly id = 'gemini'
  private readonly model: string

  constructor(private readonly opts: GeminiOptions = {}) {
    this.model = opts.model ?? GEMINI_MODEL
  }

  private apiKey(): string {
    const key = this.opts.apiKey ?? process.env.GEMINI_API_KEY ?? ''
    if (!key || key === 'tu_clave_aqui') {
      throw new LlmError(
        'GEMINI_API_KEY no está configurada (añádela al .env)',
        this.id
      )
    }
    return key
  }

  async chat(system: string, user: string, opts: ChatOptions = {}): Promise<string> {
    const { maxTokens = 4096, timeoutMs = 60_000, tag = 'gemini' } = opts
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { temperature: 0.0, maxOutputTokens: maxTokens }
    }
    return this._call(this.model, body, timeoutMs, tag)
  }

  async chatWithImage(
    system: string,
    user: string,
    imageBase64: string,
    opts: VisionOptions = {}
  ): Promise<string> {
    const { maxTokens = 4096, timeoutMs = 240_000, tag = 'gemini-vision', mimeType = 'image/jpeg' } = opts
    const body = {
      system_instruction: { parts: [{ text: system }] },
      contents: [
        {
          role: 'user',
          parts: [
            { text: user },
            { inline_data: { mime_type: mimeType, data: imageBase64 } }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.0,
        maxOutputTokens: maxTokens,
        response_mime_type: 'application/json'
      }
    }
    return this._call(this.model, body, timeoutMs, tag)
  }

  private async _call(
    model: string,
    body: unknown,
    timeoutMs: number,
    tag: string
  ): Promise<string> {
    const url = `${GEMINI_BASE}/${model}:generateContent?key=${this.apiKey()}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      })
      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        // Fallback si el modelo principal no está disponible o saturado
        if ((resp.status === 404 || resp.status === 503) && model !== GEMINI_FALLBACK_MODEL) {
          clearTimeout(timer)
          return this._call(GEMINI_FALLBACK_MODEL, body, timeoutMs, tag)
        }
        throw new LlmError(`${tag}: HTTP ${resp.status} — ${text.slice(0, 500)}`, this.id)
      }
      const data = (await resp.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
        error?: { message?: string }
      }
      if (data.error) {
        const msg = data.error.message ?? 'error desconocido'
        // Fallback si la respuesta indica modelo no encontrado
        if (model !== GEMINI_FALLBACK_MODEL && /model.*not.*found|not.*found.*model/i.test(msg)) {
          return this._call(GEMINI_FALLBACK_MODEL, body, timeoutMs, tag)
        }
        throw new LlmError(`${tag}: ${msg}`, this.id)
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      return stripMdFences(text)
    } catch (e) {
      if (e instanceof LlmError) throw e
      const isAbort = e instanceof Error && e.name === 'AbortError'
      const cause = e instanceof Error ? e.message : String(e)
      const msg = isAbort
        ? `${tag}: tiempo de espera agotado (>${Math.round(timeoutMs / 1000)} s)`
        : `${tag}: petición fallida — ${cause}`
      throw new LlmError(msg, this.id, e)
    } finally {
      clearTimeout(timer)
    }
  }
}
