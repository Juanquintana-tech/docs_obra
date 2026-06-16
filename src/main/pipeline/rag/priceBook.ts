/**
 * Libro de precios propio del laboratorio (derivado de sus presupuestos).
 * Cada ensayo tiene varios precios según la estrategia elegida:
 *   · reciente: precio del presupuesto más reciente (POR DEFECTO)
 *   · mediana:  mediana de todos los presupuestos
 *   · max:      precio máximo (oferta conservadora)
 * Además se conserva el rango [min, max] para mostrarlo en la UI.
 */
import { readFileSync } from 'fs'

export type PriceStrategy = 'reciente' | 'mediana' | 'max'
export const DEFAULT_STRATEGY: PriceStrategy = 'reciente'

export interface PriceBookEntry {
  codigo: string
  descripcion: string
  reciente: number
  mediana: number
  max: number
  min: number
  n: number // nº de presupuestos en que aparece
}

export interface PriceBookFile {
  entries: PriceBookEntry[]
}

export function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function normalizeDesc(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Precio según la estrategia. */
export function priceForStrategy(e: PriceBookEntry, strategy: PriceStrategy): number {
  return strategy === 'mediana' ? e.mediana : strategy === 'max' ? e.max : e.reciente
}

interface RawPair {
  query: string
  price: number
  year: number
}

/** Agrega pares (descripción, precio, año) en entradas del libro de precios. */
export function aggregatePriceBook(pairs: RawPair[]): PriceBookEntry[] {
  const groups = new Map<
    string,
    { prices: number[]; byYear: Map<number, number[]>; forms: Map<string, number> }
  >()
  for (const p of pairs) {
    const k = normalizeDesc(p.query)
    if (!groups.has(k)) groups.set(k, { prices: [], byYear: new Map(), forms: new Map() })
    const g = groups.get(k)!
    g.prices.push(p.price)
    if (!g.byYear.has(p.year)) g.byYear.set(p.year, [])
    g.byYear.get(p.year)!.push(p.price)
    g.forms.set(p.query, (g.forms.get(p.query) ?? 0) + 1)
  }

  return [...groups.values()]
    .map((g, i) => {
      const descripcion = [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0]
      const maxYear = Math.max(...g.byYear.keys())
      const reciente = median(g.byYear.get(maxYear)!) // precio del presupuesto más reciente
      return {
        codigo: `PB-${String(i + 1).padStart(4, '0')}`,
        descripcion,
        reciente,
        mediana: median(g.prices),
        max: Math.max(...g.prices),
        min: Math.min(...g.prices),
        n: g.prices.length
      }
    })
    .sort((a, b) => b.n - a.n)
}

export function loadPriceBook(path: string): PriceBookEntry[] {
  return (JSON.parse(readFileSync(path, 'utf-8')) as PriceBookFile).entries
}
