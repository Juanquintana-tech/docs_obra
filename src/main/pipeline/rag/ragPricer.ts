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
import { l2normalize } from './minimaxEmbeddings'
import type { EmbeddingsProvider, RagMatch } from './types'

/** Fichero de índice de embeddings del catálogo (vectores YA normalizados a L2=1). */
export interface EmbeddingsIndexFile {
  model: string
  dim: number
  entries: { codigo: string; vector: number[] }[]
}

export const DEFAULT_EMB_WEIGHT = 0.5

/** Contexto semántico por categoría interna → términos clave (port de CATEGORY_CTX). */
export const CATEGORY_CTX: Record<string, string> = {
  HORMIGON: 'hormigon probetas resistencia compresion fabricacion',
  ZAHORRA_ARTIFICIAL: 'zahorra granulometria proctor compactacion aridos',
  TERRAPLEN_RELLENOS: 'terraplen relleno suelos densidad proctor modificado apisonado compactacion',
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
  /** Vectores de embedding normalizados, alineados con `entries` (null si falta). */
  private embVecs: (number[] | null)[] = []
  private embLoaded = 0

  constructor(private readonly opts: RagPricerOptions = {}) {}

  /** true si el modo híbrido está operativo: hay proveedor para la consulta Y un índice cargado. */
  get usesEmbeddings(): boolean {
    return !!this.opts.embeddings && this.embLoaded > 0
  }

  /** Nº de entradas (ensayos con precio) en el índice. */
  get catalogSize(): number {
    return this.entries.length
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

  /** Carga el índice de embeddings del catálogo, alineándolo por código con las entradas. */
  loadEmbeddings(index: EmbeddingsIndexFile): void {
    const byCode = new Map(index.entries.map((e) => [e.codigo, e.vector]))
    this.embVecs = this.entries.map((e) => byCode.get(e.codigo) ?? null)
    this.embLoaded = this.embVecs.filter((v) => v !== null).length
  }

  private toMatch(doc: number, score: number): RagMatch {
    const e = this.entries[doc]
    return {
      descripcion: e.descripcion,
      precio: e.precio,
      codigo: e.codigo,
      categoria: e.categoria,
      score: Math.round(score * 10000) / 10000
    }
  }

  /** Devuelve los n ensayos más similares del catálogo (solo TF-IDF, síncrono). */
  findMatches(query: string, n = 5): RagMatch[] {
    if (this.entries.length === 0) return []
    return this.tfidf
      .queryTopK(normalize(query), n)
      .map(({ doc, score }) => this.toMatch(doc, score))
  }

  /**
   * Búsqueda híbrida: combina la similitud semántica (embeddings) con la léxica (TF-IDF).
   * Si no hay embeddings operativos, cae a TF-IDF puro. `weight` = peso de los embeddings [0,1].
   */
  async findMatchesHybrid(query: string, n = 5, weight = DEFAULT_EMB_WEIGHT): Promise<RagMatch[]> {
    if (this.entries.length === 0) return []
    if (!this.usesEmbeddings || !this.opts.embeddings) return this.findMatches(query, n)

    const tfidfScores = this.tfidf.scoreAll(normalize(query))
    const [qvecRaw] = await this.opts.embeddings.embed([query], 'query')
    const qvec = l2normalize(qvecRaw)

    const scored: Array<{ doc: number; score: number }> = []
    for (let i = 0; i < this.entries.length; i++) {
      const ev = this.embVecs[i]
      let emb = 0
      if (ev) {
        let dot = 0
        for (let k = 0; k < qvec.length && k < ev.length; k++) dot += qvec[k] * ev[k]
        emb = Math.max(0, dot) // coseno (vectores normalizados) recortado a [0,1]
      }
      const hybrid = weight * emb + (1 - weight) * tfidfScores[i]
      if (hybrid > 0) scored.push({ doc: i, score: hybrid })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, n).map(({ doc, score }) => this.toMatch(doc, score))
  }

  /**
   * Mejor match → { precio, descripcion, score, source }. Si score < threshold,
   * source='fallback' y precio=null (el planner usa su precio base).
   */
  getBestPrice(
    testDescription: string,
    category = '',
    threshold = DEFAULT_THRESHOLD
  ): {
    precio: number | null
    descripcion: string
    codigo: string
    score: number
    source: 'alagal' | 'fallback'
  } {
    const ctx = CATEGORY_CTX[category] ?? ''
    const query = `${testDescription} ${ctx}`.trim()
    const [best] = this.findMatches(query, 1)
    if (!best || best.score < threshold) {
      return {
        precio: null,
        descripcion: '',
        codigo: '',
        score: best?.score ?? 0,
        source: 'fallback'
      }
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
