/**
 * Demo del planner: genera un plan de ensayos para una lista de materiales de
 * ejemplo (simulando la salida del classifier) y lo valora con el RAG.
 *
 *   npm run plan:demo
 */
import { generatePlan, type Material } from '../planner'
import { loadRules, buildPricer } from './loadKnowledge'

const SAMPLE_MATERIALS: Material[] = [
  { material: 'Terraplén núcleo', category: 'TERRAPLEN_RELLENOS', quantity: 25000, unit: 'm3' },
  {
    material: 'Zahorra artificial ZA-25',
    category: 'ZAHORRA_ARTIFICIAL',
    quantity: 8000,
    unit: 'm3'
  },
  { material: 'Hormigón HA-30 cimentación', category: 'HORMIGON', quantity: 1200, unit: 'm3' },
  { material: 'Mezcla bituminosa AC22', category: 'MEZCLA_BITUMINOSA', quantity: 4500, unit: 't' }
]

async function main(): Promise<void> {
  const rules = loadRules()
  const pricer = await buildPricer()
  const plan = generatePlan(SAMPLE_MATERIALS, rules, pricer)

  let total = 0
  let currentMat = ''
  for (const row of plan) {
    if (row.material !== currentMat) {
      currentMat = row.material ?? ''
      console.log(`\n\x1b[1m■ ${currentMat}\x1b[0m  (${row.measurement} ${row.measurement_unit})`)
    }
    total += row.total ?? 0
    const src = row.price_source === 'alagal' ? '\x1b[32m●\x1b[0m' : '\x1b[31m○\x1b[0m'
    console.log(
      `  ${src} ${(row.description ?? '').slice(0, 50).padEnd(50)} ` +
        `lotes=${row.n_lots}  nº=${row.n_tests}  €/ud=${row.unit_price}  ` +
        `total=€${(row.total ?? 0).toFixed(0)}  (score ${row.rag_score})`
    )
  }
  console.log(
    `\n\x1b[1mPlan generado:\x1b[0m ${plan.length} líneas de ensayo · ` +
      `total sin IVA = €${total.toFixed(2)} · con IVA (21%) = €${(total * 1.21).toFixed(2)}`
  )
  console.log('\x1b[32m●\x1b[0m precio de catálogo (RAG)   \x1b[31m○\x1b[0m precio base (fallback)')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
