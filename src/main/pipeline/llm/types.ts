/**
 * Contrato de proveedor LLM enchufable. El classifier no conoce a MiniMax ni a
 * ningún proveedor concreto: solo esta interfaz. Para añadir un modelo mejor
 * (Claude/GPT) basta implementar LlmProvider y registrarlo — MiniMax queda como
 * base/fallback para el prototipo.
 */
export interface ChatOptions {
  maxTokens?: number
  /** timeout en ms */
  timeoutMs?: number
  /** etiqueta para logs */
  tag?: string
}

export interface VisionOptions extends ChatOptions {
  mimeType?: string
}

export interface LlmProvider {
  readonly id: string
  /** Envía system+user y devuelve el contenido del mensaje (texto). */
  chat(system: string, user: string, opts?: ChatOptions): Promise<string>
  /** Envía sistema+texto+imagen (base64) y devuelve JSON como string. Solo proveedores con visión. */
  chatWithImage?(
    system: string,
    user: string,
    imageBase64: string,
    opts?: VisionOptions
  ): Promise<string>
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly cause?: unknown
  ) {
    super(message)
    this.name = 'LlmError'
  }
}
