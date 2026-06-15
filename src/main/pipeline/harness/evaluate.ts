/**
 * Harness de evaluación del RAG. Corre un set de casos etiquetados y reporta
 * precisión@1, recall@k, acierto de precio y score medio.
 *
 *   npm run rag:eval                 # usa cases.sample.json
 *   npm run rag:eval -- mis_casos.json
 *
 * Formato del fichero de casos: { "cases": [ { query, category?, expected_code?, expected_price? } ] }
 * Cuando tengamos los casos reales del laboratorio, este es el fichero a sustituir.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { buildPricer } from './loadKnowledge'
import { CATEGORY_CTX } from '../rag/ragPricer'

interface Case {
  query: string
  category?: string
  expected_code?: string
  expected_price?: number
}

const PRICE_TOL = 0.01 // tolerancia relativa de precio (1%)
const TOP_K = 5

async function main(): Promise<void> {
  const file = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(__dirname, 'cases.sample.json')
  const { cases } = JSON.parse(readFileSync(file, 'utf-8')) as { cases: Case[] }
  const pricer = await buildPricer()

  let p1 = 0
  let recallK = 0
  let priceOk = 0
  let priceEvaluated = 0
  let scoreSum = 0

  console.log(`\x1b[1mEvaluando ${cases.length} casos (${file})\x1b[0m\n`)
  for (const c of cases) {
    const matches = pricer.findMatches(
      `${c.query} ${c.category ? (pricerCtx(c.category) ?? '') : ''}`.trim(),
      TOP_K
    )
    const best = matches[0]
    scoreSum += best?.score ?? 0

    const codeHit = c.expected_code ? best?.codigo === c.expected_code : null
    const recallHit = c.expected_code ? matches.some((m) => m.codigo === c.expected_code) : null
    let priceHit: boolean | null = null
    if (c.expected_price != null && best) {
      priceEvaluated++
      priceHit = Math.abs(best.precio - c.expected_price) <= c.expected_price * PRICE_TOL
      if (priceHit) priceOk++
    }
    if (codeHit) p1++
    if (recallHit) recallK++

    const status = (b: boolean | null): string =>
      b === null ? '·' : b ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'
    console.log(
      `${status(codeHit)} p@1  ${status(priceHit)} precio  score=${(best?.score ?? 0).toFixed(3)}  ` +
        `${c.query.slice(0, 48)}\n     → ${best?.descripcion?.slice(0, 70) ?? '(sin match)'} ` +
        `(€${best?.precio ?? '?'}${c.expected_price != null ? `, esperado €${c.expected_price}` : ''})`
    )
  }

  const n = cases.length
  const withCode = cases.filter((c) => c.expected_code).length
  console.log('\n\x1b[1m── Métricas ──\x1b[0m')
  if (withCode) {
    console.log(`  precisión@1: ${p1}/${withCode} (${pct(p1, withCode)})`)
    console.log(`  recall@${TOP_K}:  ${recallK}/${withCode} (${pct(recallK, withCode)})`)
  } else {
    console.log('  (sin expected_code en los casos → precisión@1/recall no evaluados)')
  }
  if (priceEvaluated)
    console.log(`  acierto precio: ${priceOk}/${priceEvaluated} (${pct(priceOk, priceEvaluated)})`)
  console.log(`  score medio: ${(scoreSum / n).toFixed(3)}`)
}

function pct(a: number, b: number): string {
  return b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a'
}

// Reutiliza el contexto de categoría del pricer (mismo enriquecimiento que getBestPrice).
function pricerCtx(category: string): string | undefined {
  return CATEGORY_CTX[category]
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
