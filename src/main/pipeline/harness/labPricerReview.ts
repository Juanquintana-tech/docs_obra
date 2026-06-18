/**
 * Verifica el motor LabPricer: libro de precios (primario) + ALAGAL (fallback)
 * y las 3 estrategias de precio. Precia los ensayos de test_rules.
 *
 *   npm run rag:review-pricer
 */
import { type LabPriceItem } from '../../services/labPricer'
import { buildPlanPricer, loadRules } from './loadKnowledge'
import type { PriceStrategy } from '../rag/priceBook'

async function main(): Promise<void> {
  const pricer = await buildPlanPricer()

  const rules = loadRules()
  const items: LabPriceItem[] = []
  for (const [cat, rule] of Object.entries(rules)) {
    for (const t of rule.tests ?? []) items.push({ description: t.description, category: cat })
  }

  const strategies: PriceStrategy[] = ['reciente', 'mediana', 'max']
  const byStrategy = new Map<PriceStrategy, Awaited<ReturnType<typeof pricer.priceMany>>>()
  for (const s of strategies) byStrategy.set(s, await pricer.priceMany(items, s))

  const base = byStrategy.get('reciente')!
  const src = { pricebook: 0, alagal: 0, fallback: 0 }
  base.forEach((r) => (src[r.source] += 1))

  console.log(`\x1b[1mFuente de precio (${items.length} ensayos):\x1b[0m`)
  console.log(
    `  libro de precios: ${src.pricebook} · ALAGAL: ${src.alagal} · fallback: ${src.fallback}\n`
  )

  console.log('\x1b[1mPrecio por estrategia (muestra):\x1b[0m')
  const sample = [0, 2, 4, 9, 14, 18, 22, 28, 33]
  for (const i of sample) {
    if (!items[i]) continue
    const r = base[i]
    const rec = byStrategy.get('reciente')![i].precio
    const med = byStrategy.get('mediana')![i].precio
    const mx = byStrategy.get('max')![i].precio
    const tag =
      r.source === 'pricebook'
        ? '\x1b[32mLP\x1b[0m'
        : r.source === 'alagal'
          ? '\x1b[33mAL\x1b[0m'
          : '\x1b[31m--\x1b[0m'
    console.log(
      `  ${tag} ${items[i].description.slice(0, 44).padEnd(44)} reciente=€${rec} mediana=€${med} max=€${mx}` +
        (r.min != null && r.max !== r.min ? `  rango[${r.min}–${r.max}]` : '')
    )
  }
  console.log('\nLP=libro de precios  AL=ALAGAL fallback  --=precio base')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
