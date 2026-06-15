/**
 * Proveedor de embeddings LOCAL (en el propio equipo, sin API ni rate limit).
 * Modelo: intfloat/multilingual-e5-small (vía transformers.js), 384 dim, multilingüe.
 *
 * Ventajas para una app de escritorio distribuida a laboratorios: funciona offline,
 * sin coste por uso ni límites. Convención e5: prefijo "query: " / "passage: ".
 *
 * El modelo se descarga una vez (~100 MB) y queda cacheado. Para el empaquetado
 * offline habrá que incluir el modelo en recursos (pendiente, ver PLAN.md).
 */
import { pipeline, type FeatureExtractionPipeline } from '@xenova/transformers'
import type { EmbedKind, EmbeddingsProvider } from './types'

const MODEL = 'Xenova/multilingual-e5-small'
const DIM = 384

export class LocalEmbeddingsProvider implements EmbeddingsProvider {
  readonly id = 'local-e5-small'
  readonly dim = DIM
  private extractor: FeatureExtractionPipeline | null = null

  private async getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractor) {
      this.extractor = await pipeline('feature-extraction', MODEL)
    }
    return this.extractor
  }

  async embed(texts: string[], kind: EmbedKind = 'doc'): Promise<number[][]> {
    if (texts.length === 0) return []
    const ext = await this.getExtractor()
    const prefix = kind === 'query' ? 'query: ' : 'passage: '
    const prefixed = texts.map((t) => prefix + t)
    const out = await ext(prefixed, { pooling: 'mean', normalize: true })

    // out.data es un Float32Array de tamaño n*DIM; out.dims = [n, DIM]
    const [n, dim] = out.dims as [number, number]
    const data = out.data as Float32Array
    const vectors: number[][] = []
    for (let i = 0; i < n; i++) {
      vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)))
    }
    return vectors
  }
}
