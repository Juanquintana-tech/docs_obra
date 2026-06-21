/**
 * Construye un set de validación del RAG a partir de presupuestos REALES del
 * laboratorio. Cada línea valorada → un caso { query, expected_price }.
 *
 *   npm run rag:cases -- "/ruta/a/Presupuestos"
 *
 * Salida: resources/knowledge/cases_reales.json (GITIGNORED — datos sensibles).
 * NOTA: los precios de presupuesto NO equivalen a los del catálogo ALAGAL; este
 * set sirve para validar el EMPAREJAMIENTO, no para comparar contra ALAGAL.
 */
import { writeFileSync } from 'fs'
import { resolve } from 'path'
import { extractBudgetPairs, DEFAULT_BUDGETS_DIRS } from './budgetParser'

function main(): void {
  const dirs = process.argv[2] ? [process.argv[2]] : DEFAULT_BUDGETS_DIRS
  const pairs = extractBudgetPairs(...dirs)

  const seen = new Set<string>()
  const cases = pairs
    .filter((p) => {
      const k = `${p.query.toLowerCase()}|${p.price}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .map((p) => ({ query: p.query, expected_price: p.price, _src: p.src }))

  const outPath = resolve(process.cwd(), 'resources/knowledge/cases_reales.json')
  writeFileSync(outPath, JSON.stringify({ cases }, null, 2))
  console.log(`${pairs.length} pares · ${cases.length} tras dedup → ${outPath} (gitignored)`)
}

main()
