/**
 * Punto de entrada de la capa LLM. Expone la factoría del proveedor que usa el
 * classifier. Para el prototipo: solo MiniMax. Para añadir un modelo mejor,
 * implementar LlmProvider y anteponerlo en createLlmProvider() — MiniMax queda
 * como fallback automático vía FallbackProvider.
 */
import { type ChatOptions, type LlmProvider, LlmError } from './types'
import { MiniMaxProvider } from './minimax'

export { type LlmProvider, type ChatOptions, LlmError } from './types'
export { MiniMaxProvider } from './minimax'

/**
 * Encadena proveedores: intenta el primero y, si lanza LlmError, pasa al siguiente.
 * Permite "modelo frontera con MiniMax de fallback" sin tocar el classifier.
 */
export class FallbackProvider implements LlmProvider {
  readonly id: string
  constructor(private readonly providers: LlmProvider[]) {
    if (providers.length === 0) throw new Error('FallbackProvider necesita al menos un proveedor')
    this.id = `fallback(${providers.map((p) => p.id).join('>')})`
  }

  async chat(system: string, user: string, opts?: ChatOptions): Promise<string> {
    let lastError: unknown
    for (const p of this.providers) {
      try {
        return await p.chat(system, user, opts)
      } catch (e) {
        lastError = e
        // solo se hace fallback ante errores del proveedor; otros errores se propagan
        if (!(e instanceof LlmError)) throw e
      }
    }
    throw new LlmError('todos los proveedores fallaron', this.id, lastError)
  }
}

/** Proveedor por defecto del classifier. Hoy: MiniMax. */
export function createLlmProvider(): LlmProvider {
  return new MiniMaxProvider()
  // Futuro: new FallbackProvider([new ClaudeProvider(), new MiniMaxProvider()])
}
