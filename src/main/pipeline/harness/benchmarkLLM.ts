/**
 * Benchmark del nuevo motor LLM: compara la salida del plannerLLM con los
 * presupuestos reales para los proyectos del corpus histórico.
 *
 *   npm run rag:benchmark
 */
import 'dotenv/config'
import { resolve } from 'path'
import { generatePlanLLM } from '../llm/plannerLLM'
import { loadHistoricalProjects } from '../rag/historicalProjects'
import type { Material } from '../types'

const KNOWLEDGE = resolve(process.cwd(), 'resources/knowledge')

// Materiales inferidos de cada ejemplo histórico para simular el input del classifier
const TEST_CASES: Array<{ id: string; label: string; expectedBase: number; materials: Material[] }> = [
  {
    id: 'E8',
    label: 'Melide-Arzúa (A-54)',
    expectedBase: 1_314_272,
    materials: [
      { material: 'Terraplén y rellenos localizados', category: 'TERRAPLEN_RELLENOS', quantity: 4_400_000, unit: 'm3' },
      { material: 'Suelo estabilizado in situ con cemento', category: 'SUELO_ESTABILIZADO', quantity: 134_000, unit: 'm3' },
      { material: 'Zahorra artificial', category: 'ZAHORRA_ARTIFICIAL', quantity: 146_645, unit: 'm3' },
      { material: 'Mezcla bituminosa (DTS, SEST, SC, AC-22, BBTM)', category: 'MEZCLA_BITUMINOSA', quantity: 626_000, unit: 't' },
      { material: 'Riego de adherencia e imprimación', category: 'RIEGO_BITUMINOSO', quantity: 1_351_000, unit: 'm2' },
      { material: 'Hormigón armado (HA-25, HA-30, HA-35, HP-50)', category: 'HORMIGON', quantity: 42_000, unit: 'm3' },
      { material: 'Acero armadura pasiva', category: 'ACERO', quantity: 1_295_000, unit: 'kg' },
      { material: 'Escollera', category: 'ESCOLLERA', quantity: 25_421, unit: 'm3' },
      { material: 'Pilotes CPI-8', category: 'PILOTES', quantity: 4_000, unit: 'm' },
      { material: 'Marcas viales y señalización horizontal', category: 'MARCAS_VIALES', quantity: 72, unit: 'km' },
    ],
  },
  {
    id: 'E5',
    label: 'Enlace Orbital A Coruña',
    expectedBase: 124_025,
    materials: [
      { material: 'Rellenos terraplén', category: 'TERRAPLEN_RELLENOS', quantity: 252_652, unit: 'm3' },
      { material: 'Suelo estabilizado', category: 'SUELO_ESTABILIZADO', quantity: 15_000, unit: 'm3' },
      { material: 'Zahorra artificial ZA-25', category: 'ZAHORRA_ARTIFICIAL', quantity: 16_000, unit: 'm3' },
      { material: 'Mezcla bituminosa AC32 base G, AC22 surf', category: 'MEZCLA_BITUMINOSA', quantity: 18_000, unit: 't' },
      { material: 'Riego de adherencia', category: 'RIEGO_BITUMINOSO', quantity: 50_000, unit: 'm2' },
      { material: 'Hormigón HA-30', category: 'HORMIGON', quantity: 800, unit: 'm3' },
      { material: 'Acero armadura pasiva', category: 'ACERO', quantity: 100_000, unit: 'kg' },
      { material: 'Marcas viales', category: 'MARCAS_VIALES', quantity: 5, unit: 'km' },
    ],
  },
  {
    id: 'E1',
    label: 'Stolt Sea Farm - Rianxo',
    expectedBase: 105_039,
    materials: [
      { material: 'Terraplén y relleno', category: 'TERRAPLEN_RELLENOS', quantity: 15_000, unit: 'm3' },
      { material: 'Zahorra artificial', category: 'ZAHORRA_ARTIFICIAL', quantity: 8_000, unit: 'm3' },
      { material: 'Hormigón cimentación y estructura HA-30', category: 'HORMIGON', quantity: 2_000, unit: 'm3' },
      { material: 'Acero pasivo y laminado', category: 'ACERO', quantity: 200_000, unit: 'kg' },
    ],
  },
]

function pct(got: number, expected: number): string {
  const diff = ((got - expected) / expected) * 100
  return `${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%`
}

async function main(): Promise<void> {
  const opts = {
    priceBookPath: resolve(KNOWLEDGE, 'price_book.json'),
    historicalProjectsPath: resolve(KNOWLEDGE, 'historical_projects.json'),
    strategy: 'reciente' as const,
  }

  const projects = loadHistoricalProjects(opts.historicalProjectsPath)
  console.log(`Corpus: ${projects.length} proyectos históricos`)
  console.log('─'.repeat(70))
  console.log('Modo: PRODUCCIÓN (el proyecto propio está en el corpus como referencia)')
  console.log('─'.repeat(70))

  for (const tc of TEST_CASES) {
    console.log(`\n▶ ${tc.id}: ${tc.label} (esperado: ${tc.expectedBase.toLocaleString('es-ES')} €)`)
    try {
      // Modo producción: el proyecto propio puede usarse como referencia (lo haría un proyecto nuevo similar)
      const plan = await generatePlanLLM(tc.materials, opts)
      const total = plan.reduce((s, r) => s + (r.total ?? 0), 0)
      const fromPB = plan.filter((r) => r.price_source === 'pricebook').length
      const totalLines = plan.length

      console.log(`  Líneas generadas: ${totalLines} (${fromPB} con precio del catálogo, ${totalLines - fromPB} LLM fallback)`)
      console.log(`  Total calculado:  ${total.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €`)
      console.log(`  Error vs real:    ${pct(total, tc.expectedBase)}`)

      // Mostrar top 10 líneas por importe
      const top = [...plan].sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 8)
      console.log('  Top 8 líneas por importe:')
      for (const r of top) {
        const src = r.price_source === 'pricebook' ? '●' : '○'
        console.log(`    ${src} ${(r.description ?? '').slice(0, 55).padEnd(55)} n=${r.n_tests}  €/ud=${r.unit_price}  total=${r.total?.toLocaleString('es-ES', { maximumFractionDigits: 0 })}€`)
      }
    } catch (e) {
      console.error(`  ERROR: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
