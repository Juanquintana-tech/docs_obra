/**
 * Calibración de los umbrales del LabPricer en modo HÍBRIDO (TF-IDF + embeddings).
 *
 *   npm run rag:thresholds                       # usa cases_reales.json
 *   npm run rag:thresholds -- otros_casos.json
 *
 * Para cada caso obtiene el MEJOR match del libro de precios y de ALAGAL (umbral 0,
 * así siempre devuelve score), y usa el acierto de precio (±tol) como proxy de
 * "match correcto". Luego barre umbrales candidatos y, para cada uno, reporta:
 *   · cobertura  = % de casos aceptados (score ≥ umbral)
 *   · precisión  = % de los aceptados cuyo precio es correcto
 *   · perdidos   = correctos que el umbral dejaría fuera (irían a fallback)
 * El umbral recomendado maximiza F1 entre precisión y recall de los correctos.
 */
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { existsSync } from 'fs'
import { RagPricer, type EmbeddingsIndexFile } from '../rag/ragPricer'
import { normalize } from '../rag/normalize'
import { createEmbeddingsProvider } from '../rag/embeddings'
import { loadPriceBook } from '../rag/priceBook'
import type { CatalogEntry } from '../rag/catalog'
import { KNOWLEDGE_DIR, TARIFAS_PATH, EMBEDDINGS_PATH } from './loadKnowledge'

interface Case {
  query: string
  category?: string
  expected_price?: number
}

const PRICE_TOL = 0.01
const CANDIDATES = [0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8]

/** Construye el pricer del libro de precios con embeddings (igual que buildLabPricer). */
async function buildPriceBookPricer(): Promise<RagPricer> {
  const provider = createEmbeddingsProvider()
  const pbPath = resolve(KNOWLEDGE_DIR, 'price_book.json')
  const pbEmbPath = resolve(KNOWLEDGE_DIR, 'price_book_embeddings.json')
  const entries = existsSync(pbPath) ? loadPriceBook(pbPath) : []
  const catalog: CatalogEntry[] = entries.map((e) => ({
    codigo: e.codigo,
    descripcion: e.descripcion,
    precio: e.reciente,
    categoria: '',
    doc: normalize(e.descripcion)
  }))
  const pricer = new RagPricer({ embeddings: provider })
  pricer.fit(catalog)
  if (catalog.length && existsSync(pbEmbPath)) {
    pricer.loadEmbeddings(JSON.parse(readFileSync(pbEmbPath, 'utf-8')) as EmbeddingsIndexFile)
  }
  return pricer
}

async function buildAlagalPricer(): Promise<RagPricer> {
  const pricer = await RagPricer.fromXlsx(TARIFAS_PATH, { embeddings: createEmbeddingsProvider() })
  if (existsSync(EMBEDDINGS_PATH)) {
    pricer.loadEmbeddings(JSON.parse(readFileSync(EMBEDDINGS_PATH, 'utf-8')) as EmbeddingsIndexFile)
  }
  return pricer
}

interface Scored {
  score: number
  hit: boolean // precio correcto (±tol)
  hasPrice: boolean // el caso traía expected_price
}

function priceHit(got: number | null, expected: number | undefined): boolean {
  if (got == null || expected == null) return false
  return Math.abs(got - expected) <= expected * PRICE_TOL
}

/** Pesos de embeddings a comparar (0 = solo TF-IDF). */
const WEIGHTS = [0, 0.3, 0.5]

/** Consultas de CONTROL que NO deberían casar con el libro de precios del laboratorio
 *  (geotecnia/materiales): sirven para ver dónde puntúan los "no-match" y situar el
 *  umbral en el hueco entre match real y no-match. */
const CONTROLS = [
  'reparación de fontanería en un cuarto de baño',
  'alquiler de furgoneta de mudanzas por un fin de semana',
  'diseño de logotipo y manual de identidad corporativa',
  'clase particular de inglés para principiantes',
  'reserva de hotel con desayuno para dos noches',
  'reparación de pantalla de teléfono móvil',
  'menú degustación para dos en restaurante',
  'suscripción anual a plataforma de streaming'
]

function stats(a: number[]): string {
  if (!a.length) return '(n/a)'
  return `min=${Math.min(...a).toFixed(3)} med=${median(a).toFixed(3)} max=${Math.max(...a).toFixed(3)}`
}

/** Compara, por cada peso, el score de casos reales vs controles (separación). */
async function compareWeights(pb: RagPricer, realItems: { description: string }[]): Promise<void> {
  const ctrlItems = CONTROLS.map((q) => ({ description: q }))
  console.log('\n\x1b[1m── Separación real vs control por peso de embeddings ──\x1b[0m')
  console.log('  (queremos: reales ALTO y controles BAJO, con hueco entre medias)')
  for (const w of WEIGHTS) {
    const real = (await pb.priceMany(realItems, 0, w)).map((r) => r.score)
    const ctrl = (await pb.priceMany(ctrlItems, 0, w)).map((r) => r.score)
    const gap = Math.min(...real) - Math.max(...ctrl)
    const tag = w === 0 ? 'solo TF-IDF' : `híbrido w=${w}`
    console.log(`\n  \x1b[1m${tag}\x1b[0m`)
    console.log(`    reales   (${real.length}): ${stats(real)}`)
    console.log(`    control  (${ctrl.length}): ${stats(ctrl)}`)
    console.log(
      `    hueco (min_real − max_control) = ${gap.toFixed(3)}` +
        (gap > 0 ? '  \x1b[32m← separable\x1b[0m' : '  \x1b[31m← solapan\x1b[0m')
    )
  }
}

/** Barre umbrales y devuelve la fila de métricas por cada candidato. */
function sweep(scored: Scored[], label: string): void {
  const evaluable = scored.filter((s) => s.hasPrice)
  const totalCorrect = evaluable.filter((s) => s.hit).length
  console.log(`\n\x1b[1m── ${label} (${evaluable.length} casos con precio) ──\x1b[0m`)
  console.log('  umbral   cobertura   precisión   recall   F1   (perdidos)')
  let best = { t: 0, f1: -1 }
  for (const t of CANDIDATES) {
    const accepted = evaluable.filter((s) => s.score >= t)
    const acceptedCorrect = accepted.filter((s) => s.hit).length
    const precision = accepted.length ? acceptedCorrect / accepted.length : 0
    const recall = totalCorrect ? acceptedCorrect / totalCorrect : 0
    const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
    const lost = totalCorrect - acceptedCorrect
    if (f1 > best.f1) best = { t, f1 }
    console.log(
      `  ${t.toFixed(2)}     ${pct(accepted.length, evaluable.length)}        ` +
        `${pct(acceptedCorrect, accepted.length)}        ${pct(acceptedCorrect, totalCorrect)}    ` +
        `${f1.toFixed(2)}   (${lost})`
    )
  }
  console.log(`  \x1b[32m→ mejor F1 en umbral ${best.t.toFixed(2)}\x1b[0m`)
}

/** Distribución de scores de aciertos vs fallos (para ver si separan bien). */
function distribution(scored: Scored[], label: string): void {
  const ev = scored.filter((s) => s.hasPrice)
  const hits = ev.filter((s) => s.hit).map((s) => s.score)
  const miss = ev.filter((s) => !s.hit).map((s) => s.score)
  const stats = (a: number[]): string =>
    a.length
      ? `min=${Math.min(...a).toFixed(3)} med=${median(a).toFixed(3)} max=${Math.max(...a).toFixed(3)}`
      : '(n/a)'
  console.log(`\n\x1b[1m${label} · distribución de score\x1b[0m`)
  console.log(`  aciertos (${hits.length}): ${stats(hits)}`)
  console.log(`  fallos   (${miss.length}): ${stats(miss)}`)
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function pct(a: number, b: number): string {
  return (b ? `${((100 * a) / b).toFixed(0)}%` : 'n/a').padStart(4)
}

async function main(): Promise<void> {
  const file = process.argv[2]
    ? resolve(process.cwd(), process.argv[2])
    : resolve(KNOWLEDGE_DIR, 'cases_reales.json')
  const { cases } = JSON.parse(readFileSync(file, 'utf-8')) as { cases: Case[] }
  console.log(`\x1b[1mCalibrando con ${cases.length} casos (${file})\x1b[0m`)

  const [pb, al] = await Promise.all([buildPriceBookPricer(), buildAlagalPricer()])
  const items = cases.map((c) => ({ description: c.query, category: c.category }))

  // priceMany con umbral 0 → siempre el mejor match + score, sin recortar.
  const pbRes = await pb.priceMany(items, 0)
  const alRes = await al.priceMany(items, 0)

  const pbScored: Scored[] = cases.map((c, i) => ({
    score: pbRes[i].score,
    hit: priceHit(pbRes[i].precio, c.expected_price),
    hasPrice: c.expected_price != null
  }))
  const alScored: Scored[] = cases.map((c, i) => ({
    score: alRes[i].score,
    hit: priceHit(alRes[i].precio, c.expected_price),
    hasPrice: c.expected_price != null
  }))

  distribution(pbScored, 'LIBRO DE PRECIOS')
  sweep(pbScored, 'LIBRO DE PRECIOS (PB_THRESHOLD)')
  distribution(alScored, 'ALAGAL')
  sweep(alScored, 'ALAGAL (ALAGAL_THRESHOLD)')

  // Lo decisivo: ¿qué peso de embeddings separa match real de no-match?
  await compareWeights(pb, items)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
