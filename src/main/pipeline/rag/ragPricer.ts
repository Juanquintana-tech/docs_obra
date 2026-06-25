/**
 * Motor de búsqueda RAG de precios en el catálogo ALAGAL.
 * Modo TF-IDF (siempre) + embeddings opcionales (híbrido).
 * Fusión: combinación lineal (por defecto) o RRF (opts.useRrf=true).
 * RRF requiere recalibrar umbrales con `npm run rag:thresholds`.
 */
import { TfidfIndex } from './tfidf'
import { normalize } from './normalize'
import { loadCatalog, type CatalogEntry } from './catalog'
import { l2normalize } from './minimaxEmbeddings'
import { extractNormCodes, normBonus } from './normCodes'
import type { EmbeddingsProvider, RagMatch } from './types'

export interface EmbeddingsIndexFile {
  model: string
  dim: number
  entries: { codigo: string; vector: number[] }[]
}

// Calibrado a 0.3: a 0.5 los embeddings e5-small saturaban (todo ≥0.96).
export const DEFAULT_EMB_WEIGHT = 0.3
export const DEFAULT_THRESHOLD = 0.3

export interface PriceResult {
  precio: number | null
  descripcion: string
  codigo: string
  score: number
  source: 'alagal' | 'fallback'
}

// Contexto semántico añadido a la query según la categoría del material.
export const CATEGORY_CTX: Record<string, string> = {
  HORMIGON:           'hormigon probetas resistencia compresion fabricacion',
  ZAHORRA_ARTIFICIAL: 'zahorra granulometria proctor compactacion aridos',
  TERRAPLEN_RELLENOS: 'terraplen relleno suelos densidad proctor modificado compactacion',
  SUELO_ESTABILIZADO: 'suelo estabilizado cemento cal tratamiento',
  MEZCLA_BITUMINOSA:  'mezcla bituminosa asfaltica ligante aridos',
  ESCOLLERA:          'escollera enrocamiento petreos rocas',
  ACERO:              'acero armadura barra traccion',
  ACERO_LAMINADO:     'acero laminado estructural perfil traccion charpy s275 s355',
  MARCAS_VIALES:      'marcas viales señalizacion horizontal retroreflectancia pintura',
  RIEGO_BITUMINOSO:   'riego bituminoso emulsion imprimacion adherencia dotacion',
  PILOTES:            'pilotes cimentacion profunda sonic logging integridad',
  SERVICIO:           'prueba servicio laboratorio campo'
}

// Palabras clave del campo `categoria` del catálogo ALAGAL por categoría interna.
// Bonus +0.05 cuando hay coincidencia.
const CATEGORY_ALAGAL_KEYWORDS: Record<string, string[]> = {
  HORMIGON:           ['hormigon', 'mortero', 'cemento'],
  TERRAPLEN_RELLENOS: ['suelo', 'tierra', 'terraplen'],
  ZAHORRA_ARTIFICIAL: ['zahorra', 'arido', 'firme', 'pavimento'],
  MEZCLA_BITUMINOSA:  ['bituminosa', 'asfalto', 'firme', 'pavimento'],
  ESCOLLERA:          ['escollera', 'roca', 'piedra'],
  ACERO:              ['acero', 'ferralla', 'armadura'],
  SUELO_ESTABILIZADO: ['suelo', 'estabilizado'],
  ACERO_LAMINADO:     ['acero', 'metal', 'estructural', 'laminado'],
  MARCAS_VIALES:      ['marca', 'señalizacion', 'vial', 'pintura'],
  RIEGO_BITUMINOSO:   ['bituminosa', 'riego', 'ligante', 'emulsion'],
  PILOTES:            ['pilote', 'cimentacion'],
  SERVICIO:           ['geotecnia', 'suelo', 'roca', 'sondeo', 'ensayo']
}

function categoryBonus(queryCategory: string, entryCategoria: string): number {
  const keywords = CATEGORY_ALAGAL_KEYWORDS[queryCategory]
  if (!keywords) return 0
  const cat = entryCategoria.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  return keywords.some((kw) => cat.includes(kw)) ? 0.05 : 0
}

export interface RagPricerOptions {
  embeddings?: EmbeddingsProvider | null
  embeddingsWeight?: number
  useRrf?: boolean
}

export class RagPricer {
  private tfidf = new TfidfIndex()
  private entries: CatalogEntry[] = []
  private entryNorms: Set<string>[] = []
  private embVecs: (number[] | null)[] = []
  private embLoaded = 0

  constructor(private readonly opts: RagPricerOptions = {}) {}

  get usesEmbeddings(): boolean {
    return !!this.opts.embeddings && this.embLoaded > 0
  }

  get catalogSize(): number {
    return this.entries.length
  }

  fit(entries: CatalogEntry[]): void {
    this.entries = entries
    this.entryNorms = entries.map((e) => extractNormCodes(`${e.categoria} ${e.descripcion}`))
    this.tfidf.fit(entries.map((e) => e.doc))
  }

  static async fromXlsx(xlsxPath: string, opts?: RagPricerOptions): Promise<RagPricer> {
    const pricer = new RagPricer(opts)
    pricer.fit(await loadCatalog(xlsxPath))
    return pricer
  }

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

  findMatches(query: string, n = 5): RagMatch[] {
    if (this.entries.length === 0) return []
    return this.tfidf
      .queryTopK(normalize(query), n)
      .map(({ doc, score }) => this.toMatch(doc, score))
  }

  // RRF (K=60, Cormack 2009): combina rankings TF-IDF y emb, normaliza a [0,1].
  private applyRrf(tfidfScores: number[], embScores: number[], bonuses: number[]): number[] {
    const n = tfidfScores.length
    const K = 60
    const tfidfRank = new Uint32Array(n)
    const embRank = new Uint32Array(n)
    Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => tfidfScores[b] - tfidfScores[a])
      .forEach((idx, rank) => { tfidfRank[idx] = rank })
    Array.from({ length: n }, (_, i) => i)
      .sort((a, b) => embScores[b] - embScores[a])
      .forEach((idx, rank) => { embRank[idx] = rank })
    const maxRrf = 2 / K
    return Array.from({ length: n }, (_, i) => {
      const rrf = 1 / (K + tfidfRank[i]) + 1 / (K + embRank[i])
      return Math.min(1, rrf / maxRrf + bonuses[i])
    })
  }

  private combineScores(
    tfidfScores: number[],
    embScores: number[],
    bonuses: number[],
    hasEmb: boolean,
    weight: number
  ): number[] {
    if (!hasEmb) {
      return this.entries.map((_, i) => Math.min(1, tfidfScores[i] + bonuses[i]))
    }
    if (this.opts.useRrf) {
      return this.applyRrf(tfidfScores, embScores, bonuses)
    }
    return this.entries.map((_, i) => {
      // Entries without an embedding vector (e.g. newly added) compete on TF-IDF alone,
      // avoiding the unfair (1-weight) penalty that would cap their score at 0.7×tfidf.
      if (!this.embVecs[i]) return Math.min(1, tfidfScores[i] + bonuses[i])
      return Math.min(1, weight * embScores[i] + (1 - weight) * tfidfScores[i] + bonuses[i])
    })
  }

  async findMatchesHybrid(query: string, n = 5, weight = DEFAULT_EMB_WEIGHT): Promise<RagMatch[]> {
    if (this.entries.length === 0) return []
    if (!this.usesEmbeddings || !this.opts.embeddings) return this.findMatches(query, n)

    const tfidfScores = this.tfidf.scoreAll(normalize(query))
    const [qvecRaw] = await this.opts.embeddings.embed([query], 'query')
    const qvec = l2normalize(qvecRaw)
    const qNorms = extractNormCodes(query)

    const embScores = this.entries.map((_, i) => {
      const ev = this.embVecs[i]
      if (!ev) return 0
      let dot = 0
      for (let k = 0; k < qvec.length && k < ev.length; k++) dot += qvec[k] * ev[k]
      return Math.max(0, dot)
    })
    const bonuses = this.entries.map((_, i) => normBonus(qNorms, this.entryNorms[i]))
    const finalScores = this.combineScores(tfidfScores, embScores, bonuses, true, weight)

    return finalScores
      .map((score, doc) => ({ doc, score }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, n)
      .map(({ doc, score }) => this.toMatch(doc, score))
  }

  async priceMany(
    items: { description: string; category?: string }[],
    threshold = DEFAULT_THRESHOLD,
    weight = DEFAULT_EMB_WEIGHT
  ): Promise<PriceResult[]> {
    if (items.length === 0) return []

    const queries = items.map((it) =>
      `${it.description} ${CATEGORY_CTX[it.category ?? ''] ?? ''}`.trim()
    )

    let qvecs: number[][] | null = null
    if (this.usesEmbeddings && this.opts.embeddings) {
      const raw = await this.opts.embeddings.embed(queries, 'query')
      qvecs = raw.map(l2normalize)
    }

    return queries.map((query, qi) => {
      const tfidfScores = this.tfidf.scoreAll(normalize(query))
      const qv = qvecs?.[qi] ?? null
      const qCat = items[qi].category ?? ''
      const qNorms = extractNormCodes(query)

      const embScores = this.entries.map((_, i) => {
        if (!qv) return 0
        const ev = this.embVecs[i]
        if (!ev) return 0
        let dot = 0
        for (let k = 0; k < qv.length && k < ev.length; k++) dot += qv[k] * ev[k]
        return Math.max(0, dot)
      })
      const bonuses = this.entries.map((e, i) =>
        normBonus(qNorms, this.entryNorms[i]) + categoryBonus(qCat, e.categoria)
      )
      const finalScores = this.combineScores(tfidfScores, embScores, bonuses, !!qv, weight)

      let bestDoc = -1
      let bestScore = -1
      for (let i = 0; i < finalScores.length; i++) {
        if (finalScores[i] > bestScore) { bestScore = finalScores[i]; bestDoc = i }
      }

      const round = Math.round(bestScore * 10000) / 10000
      if (bestDoc < 0 || bestScore < threshold) {
        return { precio: null, descripcion: '', codigo: '', score: round, source: 'fallback' }
      }
      const e = this.entries[bestDoc]
      return { precio: e.precio, descripcion: e.descripcion, codigo: e.codigo, score: round, source: 'alagal' }
    })
  }

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
    return { precio: best.precio, descripcion: best.descripcion, codigo: best.codigo, score: best.score, source: 'alagal' }
  }
}
