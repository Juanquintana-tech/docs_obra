/**
 * Revisión cualitativa del emparejamiento contra el LIBRO DE PRECIOS propio.
 * Monta un RAG híbrido sobre price_book.json y pasa los ensayos de test_rules
 * (lo que genera el planner) para ver si emparejan con el ensayo correcto y
 * devuelven el precio real del laboratorio.
 *
 *   npm run rag:review-pricebook
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { RagPricer, type EmbeddingsIndexFile } from '../rag/ragPricer'
import { createEmbeddingsProvider } from '../rag/embeddings'
import { l2normalize } from '../rag/minimaxEmbeddings'
import { normalize } from '../rag/normalize'
import type { CatalogEntry } from '../rag/catalog'
import { loadRules } from './loadKnowledge'
import type { PriceBookEntry } from '../rag/priceBook'

async function main(): Promise<void> {
  const pbPath = resolve(process.cwd(), 'resources/knowledge/price_book.json')
  if (!existsSync(pbPath)) {
    console.error('Falta price_book.json. Ejecuta: npm run rag:price-book')
    process.exit(1)
  }
  const { entries } = JSON.parse(readFileSync(pbPath, 'utf-8')) as { entries: PriceBookEntry[] }

  // Catálogo = libro de precios
  const catalog: CatalogEntry[] = entries.map((e) => ({
    codigo: e.codigo,
    descripcion: e.descripcion,
    precio: e.reciente,
    categoria: '',
    doc: normalize(e.descripcion)
  }))
  const priceByCode = new Map(entries.map((e) => [e.codigo, e]))

  const provider = createEmbeddingsProvider()
  const pricer = new RagPricer({ embeddings: provider })
  pricer.fit(catalog)

  // Embeddings del libro de precios (en memoria)
  const vecs = await provider.embed(
    catalog.map((c) => c.descripcion),
    'doc'
  )
  const index: EmbeddingsIndexFile = {
    model: provider.id,
    dim: provider.dim,
    entries: catalog.map((c, i) => ({ codigo: c.codigo, vector: l2normalize(vecs[i]) }))
  }
  pricer.loadEmbeddings(index)
  console.log(`Libro de precios: ${catalog.length} ensayos · híbrido: ${pricer.usesEmbeddings}\n`)

  // Consultas = descripciones de los ensayos de test_rules (lo que produce el planner)
  const rules = loadRules()
  let ok = 0
  let total = 0
  for (const [cat, rule] of Object.entries(rules)) {
    console.log(`\x1b[1m━━ ${cat} ━━\x1b[0m`)
    for (const test of rule.tests ?? []) {
      total++
      const [m] = await pricer.findMatchesHybrid(test.description, 1)
      const pb = m ? priceByCode.get(m.codigo) : undefined
      const rango = pb && pb.max > pb.min ? ` [${pb.min}–${pb.max}]` : ''
      const conf =
        m && m.score >= 0.55
          ? '\x1b[32m●\x1b[0m'
          : m && m.score >= 0.4
            ? '\x1b[33m◐\x1b[0m'
            : '\x1b[31m○\x1b[0m'
      if (m && m.score >= 0.4) ok++
      console.log(
        `  ${conf} ${test.description.slice(0, 46).padEnd(46)} → ${(m?.descripcion ?? '(sin match)').slice(0, 44)}`
      )
      console.log(`      €${m?.precio ?? '?'}${rango}  (score ${(m?.score ?? 0).toFixed(2)})`)
    }
  }
  console.log(`\n\x1b[1mResumen:\x1b[0m ${ok}/${total} con match razonable (score≥0.40).`)
  console.log('● alta confianza (≥0.55)  ◐ media (≥0.40)  ○ baja')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
