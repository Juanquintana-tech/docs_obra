/**
 * Motor de precios del laboratorio.
 * Fuente 1: price_book.json (precios históricos propios, umbral 0.55).
 * Fuente 2: catálogo ALAGAL (tarifa pública, umbral 0.45).
 * Fuente 3: precio base de test_rules.json (fallback siempre disponible).
 */
import { existsSync, readFileSync } from 'fs'
import { RagPricer, type EmbeddingsIndexFile } from '../pipeline/rag/ragPricer'
import { normalize } from '../pipeline/rag/normalize'
import type { CatalogEntry } from '../pipeline/rag/catalog'
import type { EmbeddingsProvider } from '../pipeline/rag/types'
import {
  loadPriceBook,
  priceForStrategy,
  type PriceBookEntry,
  type PriceStrategy
} from '../pipeline/rag/priceBook'
import { GeminiProvider } from '../pipeline/llm/gemini'
import { maybeRerank } from '../pipeline/rag/reranker'

const PB_THRESHOLD = 0.50    // calibrado con rag:thresholds (mejor F1; reales ≥0.969, control ≤0.425)
const ALAGAL_THRESHOLD = 0.45

export interface LabPriceResult {
  precio: number | null
  descripcion: string
  score: number
  source: 'pricebook' | 'alagal' | 'fallback'
  min?: number
  max?: number
}

export interface LabPriceItem {
  description: string
  category?: string
}

export class LabPricer {
  constructor(
    private readonly priceBookPricer: RagPricer,
    private readonly alagalPricer: RagPricer | null,
    private readonly pbByCode: Map<string, PriceBookEntry>,
    private readonly gemini: GeminiProvider | null = null
  ) {}

  async priceMany(
    items: LabPriceItem[],
    strategy: PriceStrategy = 'reciente'
  ): Promise<LabPriceResult[]> {
    if (items.length === 0) return []

    const pbMatches = await this.priceBookPricer.priceMany(items, 0)

    const fallbackIdx = items
      .map((_, i) => i)
      .filter((i) => (pbMatches[i]?.score ?? 0) < PB_THRESHOLD)

    const alagalMatches =
      this.alagalPricer && fallbackIdx.length
        ? await this.alagalPricer.priceMany(fallbackIdx.map((i) => items[i]), ALAGAL_THRESHOLD)
        : []

    const alagalByItem = new Map(fallbackIdx.map((idx, k) => [idx, alagalMatches[k]]))

    return items.map((_, i) => {
      const pb = pbMatches[i]
      if (pb && pb.score >= PB_THRESHOLD) {
        const entry = this.pbByCode.get(pb.codigo)
        if (entry) {
          return {
            precio: priceForStrategy(entry, strategy),
            descripcion: entry.descripcion,
            score: pb.score,
            source: 'pricebook',
            min: entry.min,
            max: entry.max
          }
        }
      }
      const al = alagalByItem.get(i)
      if (al?.precio != null) {
        return { precio: al.precio, descripcion: al.descripcion, score: al.score, source: 'alagal' }
      }
      return { precio: null, descripcion: '', score: pb?.score ?? 0, source: 'fallback' }
    })
  }

  get hasPriceBook(): boolean { return this.priceBookPricer.catalogSize > 0 }
  get size(): number { return this.priceBookPricer.catalogSize }
  get usesEmbeddings(): boolean { return this.priceBookPricer.usesEmbeddings }

  async findMatches(query: string, n = 8): Promise<import('../pipeline/rag/types').RagMatch[]> {
    const matches = await this.priceBookPricer.findMatchesHybrid(query, n)
    if (this.gemini) return maybeRerank(query, matches, this.gemini)
    return matches
  }
}

export interface LabPricerPaths {
  priceBookPath: string
  priceBookEmbeddingsPath: string
  alagalXlsxPath: string
  alagalEmbeddingsPath: string
}

export async function buildLabPricer(
  paths: LabPricerPaths,
  provider: EmbeddingsProvider | null = null,
  geminiApiKey?: string
): Promise<LabPricer> {
  const pbEntries = existsSync(paths.priceBookPath) ? loadPriceBook(paths.priceBookPath) : []
  const pbByCode = new Map(pbEntries.map((e) => [e.codigo, e]))
  const pbCatalog: CatalogEntry[] = pbEntries.map((e) => ({
    codigo: e.codigo,
    descripcion: e.descripcion,
    precio: e.reciente,
    categoria: '',
    doc: normalize(e.descripcion)
  }))
  const priceBookPricer = new RagPricer({ embeddings: provider })
  priceBookPricer.fit(pbCatalog)
  if (pbCatalog.length && existsSync(paths.priceBookEmbeddingsPath)) {
    priceBookPricer.loadEmbeddings(
      JSON.parse(readFileSync(paths.priceBookEmbeddingsPath, 'utf-8')) as EmbeddingsIndexFile
    )
  }

  let alagalPricer: RagPricer | null = null
  try {
    alagalPricer = await RagPricer.fromXlsx(paths.alagalXlsxPath, { embeddings: provider })
    if (existsSync(paths.alagalEmbeddingsPath)) {
      alagalPricer.loadEmbeddings(
        JSON.parse(readFileSync(paths.alagalEmbeddingsPath, 'utf-8')) as EmbeddingsIndexFile
      )
    }
  } catch {
    alagalPricer = null
  }

  const apiKey = geminiApiKey ?? process.env.GEMINI_API_KEY
  const gemini = apiKey ? new GeminiProvider({ apiKey }) : null

  return new LabPricer(priceBookPricer, alagalPricer, pbByCode, gemini)
}
