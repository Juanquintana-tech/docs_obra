/**
 * RAG de precios — busca el ensayo más similar en el catálogo ALAGAL.
 *
 * Port de agents/rag_pricer.py a TypeScript. Estrategia actual: TF-IDF char n-gram
 * (3-5). Diseñado como HÍBRIDO: admite un EmbeddingsProvider opcional para combinar
 * similitud semántica con la léxica (se activará en una fase posterior).
 */
import { TfidfIndex } from './tfidf'
import { normalize } from './normalize'
import { loadCatalog, type CatalogEntry } from './catalog'
import type { EmbeddingsProvider, RagMatch } from './types'

/** Contexto semántico por categoría interna → términos clave (port de CATEGORY_CTX). */
export const CATEGORY_CTX: Record<string, string> = {
  HORMIGON: 'hormigon probetas resistencia compresion fabricacion',
  ZAHORRA_ARTIFICIAL: 'zahorra granulometria proctor compactacion aridos',
  TERRAPLEN_RELLENOS:
    'terraplen relleno suelos densidad proctor modificado apisonado compactacion',
  SUELO_ESTABILIZADO: 'suelo estabilizado cemento cal tratamiento',
  MEZCLA_BITUMINOSA: 'mezcla bituminosa asfaltica ligante brea',
  ESCOLLERA: 'escollera enrocamiento petreos rocas',
  ACERO: 'acero armadura barra traccion dureza'
}

export const DEFAULT_THRESHOLD = 0.3

export interface RagPricerOptions {
  /** Proveedor de embeddings opcional (híbrido). Si null → solo TF-IDF. */
  embeddings?: EmbeddingsProvider | null
  /** Peso de la señal de embeddings al combinar [0,1]. El resto va a TF-IDF. */
  embeddingsWeight?: number
}

export class RagPricer {
  private tfidf = new TfidfIndex()
  private entries: CatalogEntry[] = []

  constructor(private readonly opts: RagPricerOptions = {}) {}

  /** true si hay un proveedor de embeddings configurado (modo híbrido). */
  get usesEmbeddings(): boolean {
    return !!this.opts.embeddings
  }

  /** Construye el índice a partir de las entradas del catálogo. */
  fit(entries: CatalogEntry[]): void {
    this.entries = entries
    this.tfidf.fit(entries.map((e) => e.doc))
  }

  /** Atajo: carga el catálogo desde un xlsx y construye el índice. */
  static async fromXlsx(xlsxPath: string, opts?: RagPricerOptions): Promise<RagPricer> {
    const pricer = new RagPricer(opts)
    pricer.fit(await loadCatalog(xlsxPath))
    return pricer
  }

  /** Devuelve los n ensayos más similares del catálogo. */
  findMatches(query: string, n = 5): RagMatch[] {
    if (this.entries.length === 0) return []
    const top = this.tfidf.queryTopK(normalize(query), n)
    return top.map(({ doc, score }) => {
      const e = this.entries[doc]
      return {
        descripcion: e.descripcion,
        precio: e.precio,
        codigo: e.codigo,
        categoria: e.categoria,
        score: Math.round(score * 10000) / 10000
      }
    })
  }

  /**
   * Mejor match → { precio, descripcion, score, source }. Si score < threshold,
   * source='fallback' y precio=null (el planner usa su precio base).
   */
  getBestPrice(
    testDescription: string,
    category = '',
    threshold = DEFAULT_THRESHOLD
  ): { precio: number | null; descripcion: string; codigo: string; score: number; source: 'alagal' | 'fallback' } {
    const ctx = CATEGORY_CTX[category] ?? ''
    const query = `${testDescription} ${ctx}`.trim()
    const [best] = this.findMatches(query, 1)
    if (!best || best.score < threshold) {
      return { precio: null, descripcion: '', codigo: '', score: best?.score ?? 0, source: 'fallback' }
    }
    return {
      precio: best.precio,
      descripcion: best.descripcion,
      codigo: best.codigo,
      score: best.score,
      source: 'alagal'
    }
  }
}
