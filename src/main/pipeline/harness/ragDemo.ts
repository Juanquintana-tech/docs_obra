/**
 * Demo del RAG: mapea cada ensayo de test_rules.json al catálogo ALAGAL y muestra
 * el match, precio y score. Sirve para ojear la calidad del RAG a simple vista.
 *
 *   npm run rag:demo
 */
import { loadRules, buildPricer } from './loadKnowledge'

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n)
}

async function main(): Promise<void> {
  const rules = loadRules()
  const pricer = await buildPricer()

  let total = 0
  let matched = 0
  const lowScore: string[] = []

  for (const [category, rule] of Object.entries(rules)) {
    console.log(`\n\x1b[1m━━ ${category} ━━\x1b[0m`)
    for (const test of rule.tests ?? []) {
      total++
      const r = pricer.getBestPrice(test.description, category)
      const tag =
        r.source === 'alagal'
          ? `\x1b[32m€${r.precio}\x1b[0m`
          : `\x1b[31mfallback (base €${test.unit_price ?? '?'})\x1b[0m`
      if (r.source === 'alagal') matched++
      else lowScore.push(`${category}: ${test.description}`)
      console.log(
        `  ${trunc(test.description, 52)}  score=${r.score.toFixed(3)}  ${tag}` +
          (r.descripcion ? `\n      → ${trunc(r.descripcion, 80)}` : '')
      )
    }
  }

  console.log(
    `\n\x1b[1mResumen:\x1b[0m ${matched}/${total} ensayos con match en catálogo ` +
      `(${((100 * matched) / total).toFixed(0)}%), ${total - matched} en fallback.`
  )
  if (lowScore.length) {
    console.log('\nEnsayos sin match (revisar umbral o catálogo):')
    for (const s of lowScore) console.log('  · ' + s)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
