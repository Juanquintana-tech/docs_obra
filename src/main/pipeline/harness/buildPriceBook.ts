/**
 * Construye el LIBRO DE PRECIOS propio del laboratorio a partir de sus
 * presupuestos reales: agrupa por ensayo y calcula reciente / mediana / máximo + rango.
 *
 *   npm run rag:price-book -- "/ruta/a/Presupuestos"
 *
 * Salida: resources/knowledge/price_book.json (GITIGNORED — precios reales).
 * Es la fuente de precios primaria del RAG (ALAGAL como fallback).
 */
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { extractBudgetPairs, DEFAULT_BUDGETS_DIR } from './budgetParser'
import { aggregatePriceBook } from '../rag/priceBook'

function main(): void {
  const base = process.argv[2] ?? DEFAULT_BUDGETS_DIR
  const pairs = extractBudgetPairs(base)
  const entries = aggregatePriceBook(pairs)

  const outPath = resolve(process.cwd(), 'resources/knowledge/price_book.json')
  writeFileSync(outPath, JSON.stringify({ entries }, null, 2))

  const conRango = entries.filter((e) => e.max > e.min).length
  console.log(`Libro de precios: ${entries.length} ensayos únicos (${pairs.length} líneas)`) // eslint-disable-line
  console.log(`  con rango (varía entre presupuestos): ${conRango} · → ${outPath} (gitignored)`)
  console.log('\nTop 10 (n = nº presupuestos):')
  for (const e of entries.slice(0, 10)) {
    const rango = e.max > e.min ? ` [${e.min}–${e.max}]` : ''
    console.log(
      `  n=${e.n}  reciente=€${e.reciente} mediana=€${e.mediana}${rango}  ${e.descripcion.slice(0, 50)}`
    )
  }
}

main()
