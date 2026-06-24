/**
 * Compara TF-IDF puro vs RAG híbrido (TF-IDF + embeddings locales) en varios
 * ensayos, para medir la mejora del modo híbrido.
 *
 *   npm run rag:compare
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
;(function loadEnv(): void {
  const p = resolve(process.cwd(), '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=')
    const val = rest.join('=').trim().replace(/^["']|["']$/g, '')
    if (key?.trim() && val && !(key.trim() in process.env)) process.env[key.trim()] = val
  }
})()
import { RagPricer, CATEGORY_CTX, type EmbeddingsIndexFile } from '../rag/ragPricer'
import { createEmbeddingsProvider } from '../rag/embeddings'
import { TARIFAS_PATH, KNOWLEDGE_DIR } from './loadKnowledge'

interface Caso {
  q: string
  cat: string
}
const CASOS: Caso[] = [
  { q: 'Granulometría de suelos por tamizado UNE 103101:95', cat: 'TERRAPLEN_RELLENOS' },
  { q: 'Contenido de yesos en suelos NLT 115-99', cat: 'TERRAPLEN_RELLENOS' },
  { q: 'Ensayo de carga con placa doble ciclo NLT-357', cat: 'ZAHORRA_ARTIFICIAL' },
  { q: 'Proctor Modificado UNE 103501:94', cat: 'TERRAPLEN_RELLENOS' },
  { q: 'Equivalente de arena UNE-EN 933-8', cat: 'ZAHORRA_ARTIFICIAL' },
  { q: 'Índice de lajas según UNE EN 933-3', cat: 'ZAHORRA_ARTIFICIAL' },
  { q: 'Desgaste de Los Ángeles según UNE EN 1097-2', cat: 'ZAHORRA_ARTIFICIAL' }
]

async function main(): Promise<void> {
  const embPath = resolve(KNOWLEDGE_DIR, 'alagal_embeddings.json')
  if (!existsSync(embPath)) {
    console.error('No hay índice de embeddings. Ejecuta primero: npm run rag:build-embeddings')
    process.exit(1)
  }
  const pricer = await RagPricer.fromXlsx(TARIFAS_PATH, { embeddings: createEmbeddingsProvider() })
  pricer.loadEmbeddings(JSON.parse(readFileSync(embPath, 'utf-8')) as EmbeddingsIndexFile)

  console.log(`Híbrido operativo: ${pricer.usesEmbeddings}\n`)
  for (const c of CASOS) {
    const query = `${c.q} ${CATEGORY_CTX[c.cat] ?? ''}`.trim()
    const tf = pricer.findMatches(query, 1)[0]
    const hy = (await pricer.findMatchesHybrid(query, 1))[0]
    const same = tf?.codigo === hy?.codigo
    console.log(`\x1b[1m${c.q}\x1b[0m  [${c.cat}]`)
    console.log(`  TF-IDF : ${tf?.descripcion?.slice(0, 64)} (€${tf?.precio})`)
    console.log(
      `  HÍBRIDO: ${hy?.descripcion?.slice(0, 64)} (€${hy?.precio})  ${same ? '=' : '\x1b[33m← cambia\x1b[0m'}`
    )
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
