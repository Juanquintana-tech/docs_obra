/**
 * Motor de precios del laboratorio. Fuente PRIMARIA: el libro de precios propio
 * (price_book.json, derivado de sus presupuestos). FALLBACK: catálogo ALAGAL.
 * Si ninguno empareja con confianza, deja precio base (lo pone el planner).
 *
 * Estrategia de precio (reciente | mediana | max) configurable; por defecto 'reciente'.
 * Aplica la misma búsqueda híbrida (TF-IDF + embeddings) a ambos corpus.
 */
import { existsSync, readFileSync } from 'fs'
import { RagPricer, type EmbeddingsIndexFile } from '../pipeline/rag/ragPricer'
import { normalize } from '../pipeline/rag/normalize'
import { l2normalize } from '../pipeline/rag/minimaxEmbeddings'
import { createEmbeddingsProvider } from '../pipeline/rag/embeddings'
import type { EmbeddingsProvider } from '../pipeline/rag/types'
import type { CatalogEntry } from '../pipeline/rag/catalog'
import {
  loadPriceBook,
  priceForStrategy,
  type PriceBookEntry,
  type PriceStrategy
} from '../pipeline/rag/priceBook'

/** Confianza mínima para aceptar un match del libro de precios / de ALAGAL. */
const PB_THRESHOLD = 0.45
const ALAGAL_THRESHOLD = 0.3

export interface LabPriceResult {
  precio: number | null
  descripcion: string
  score: number
  source: 'pricebook' | 'alagal' | 'fallback'
  /** rango del libro de precios (solo si source='pricebook') */
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
    private readonly pbByCode: Map<string, PriceBookEntry>
  ) {}

  /** Valora una lista de ensayos con la estrategia indicada (por defecto 'reciente'). */
  async priceMany(
    items: LabPriceItem[],
    strategy: PriceStrategy = 'reciente'
  ): Promise<LabPriceResult[]> {
    if (items.length === 0) return []

    // 1) Match contra el libro de precios (threshold 0 → siempre devuelve el mejor + score)
    const pbMatches = await this.priceBookPricer.priceMany(items, 0)

    // 2) Items que no superan el umbral del libro → candidatos a ALAGAL
    const fallbackIdx: number[] = []
    items.forEach((_, i) => {
      if ((pbMatches[i]?.score ?? 0) < PB_THRESHOLD) fallbackIdx.push(i)
    })
    const alagalMatches =
      this.alagalPricer && fallbackIdx.length
        ? await this.alagalPricer.priceMany(
            fallbackIdx.map((i) => items[i]),
            ALAGAL_THRESHOLD
          )
        : []
    const alagalByItem = new Map<number, (typeof alagalMatches)[number]>()
    fallbackIdx.forEach((idx, k) => alagalByItem.set(idx, alagalMatches[k]))

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
      if (al && al.precio != null) {
        return { precio: al.precio, descripcion: al.descripcion, score: al.score, source: 'alagal' }
      }
      return { precio: null, descripcion: '', score: pb?.score ?? 0, source: 'fallback' }
    })
  }

  get hasPriceBook(): boolean {
    return this.priceBookPricer.catalogSize > 0
  }

  /** Nº de ensayos en el libro de precios (para estado de la UI). */
  get size(): number {
    return this.priceBookPricer.catalogSize
  }

  get usesEmbeddings(): boolean {
    return this.priceBookPricer.usesEmbeddings
  }

  /** Matches del libro de precios para una consulta (pantalla de validación). */
  findMatches(query: string, n = 8): Promise<import('../pipeline/rag/types').RagMatch[]> {
    return this.priceBookPricer.findMatchesHybrid(query, n)
  }
}

export interface LabPricerPaths {
  priceBookPath: string
  alagalXlsxPath: string
  alagalEmbeddingsPath: string
}

/** Construye el LabPricer cargando libro de precios + ALAGAL y sus embeddings. */
export async function buildLabPricer(paths: LabPricerPaths): Promise<LabPricer> {
  const provider = createEmbeddingsProvider() // compartido → el modelo se carga una sola vez

  // ── Libro de precios (primario) ──
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
  if (pbCatalog.length) await loadInMemoryEmbeddings(priceBookPricer, pbCatalog, provider)

  // ── ALAGAL (fallback) ──
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

  return new LabPricer(priceBookPricer, alagalPricer, pbByCode)
}

/** Calcula los embeddings de un catálogo en memoria y los carga en el pricer. */
async function loadInMemoryEmbeddings(
  pricer: RagPricer,
  catalog: CatalogEntry[],
  provider: EmbeddingsProvider
): Promise<void> {
  const vecs = await provider.embed(
    catalog.map((c) => c.descripcion),
    'doc'
  )
  pricer.loadEmbeddings({
    model: provider.id,
    dim: provider.dim,
    entries: catalog.map((c, i) => ({ codigo: c.codigo, vector: l2normalize(vecs[i]) }))
  })
}
