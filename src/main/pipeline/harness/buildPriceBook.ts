/**
 * Construye el LIBRO DE PRECIOS propio del laboratorio a partir de sus
 * presupuestos reales: agrupa por ensayo y calcula precio mediano + rango.
 *
 *   npm run rag:price-book -- "/ruta/a/Presupuestos"
 *
 * Salida: resources/knowledge/price_book.json (GITIGNORED — precios reales).
 * Será la fuente de precios primaria del RAG (ALAGAL como fallback).
 */
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { extractBudgetPairs, DEFAULT_BUDGETS_DIR, normalizeDesc, median } from './budgetParser'

export interface PriceBookEntry {
  codigo: string
  descripcion: string
  precio: number // mediana
  min: number
  max: number
  n: number // nº de presupuestos en que aparece
}

function main(): void {
  const base = process.argv[2] ?? DEFAULT_BUDGETS_DIR
  const pairs = extractBudgetPairs(base)

  // agrupar por descripción normalizada
  const groups = new Map<string, { prices: number[]; forms: Map<string, number> }>()
  for (const p of pairs) {
    const k = normalizeDesc(p.query)
    if (!groups.has(k)) groups.set(k, { prices: [], forms: new Map() })
    const g = groups.get(k)!
    g.prices.push(p.price)
    g.forms.set(p.query, (g.forms.get(p.query) ?? 0) + 1) // forma original más frecuente
  }

  const entries: PriceBookEntry[] = [...groups.values()]
    .map((g, i) => {
      const descripcion = [...g.forms.entries()].sort((a, b) => b[1] - a[1])[0][0]
      return {
        codigo: `PB-${String(i + 1).padStart(4, '0')}`,
        descripcion,
        precio: median(g.prices),
        min: Math.min(...g.prices),
        max: Math.max(...g.prices),
        n: g.prices.length
      }
    })
    .sort((a, b) => b.n - a.n)

  const outPath = resolve(process.cwd(), 'resources/knowledge/price_book.json')
  writeFileSync(outPath, JSON.stringify({ entries }, null, 2))

  const conRango = entries.filter((e) => e.max > e.min).length
  console.log(
    `Libro de precios: ${entries.length} ensayos únicos (${pairs.length} líneas de presupuesto)`
  )
  console.log(`  con rango de precio (varía entre presupuestos): ${conRango}`)
  console.log(`  → ${outPath} (gitignored)`)
  console.log('\nTop 10 ensayos más presupuestados:')
  for (const e of entries.slice(0, 10)) {
    const rango = e.max > e.min ? ` [${e.min}–${e.max}]` : ''
    console.log(`  n=${e.n}  €${e.precio}${rango}  ${e.descripcion.slice(0, 56)}`)
  }
}

main()
