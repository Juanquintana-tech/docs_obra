/**
 * Construye el índice de embeddings del catálogo ALAGAL y lo persiste en
 * resources/knowledge/alagal_embeddings.json (vectores normalizados a L2=1).
 *
 *   npm run rag:build-embeddings
 *
 * RESUMIBLE: guarda tras cada lote y, al relanzarlo, salta los códigos ya hechos.
 * Tolerante al rate limit de MiniMax (el proveedor reintenta con backoff). Si la API
 * acaba fallando, guarda lo conseguido y termina con código 1 para poder reintentar.
 * Requiere MINIMAX_API_KEY (en .env de la raíz).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { loadCatalog } from '../rag/catalog'
import { l2normalize } from '../rag/minimaxEmbeddings'
import { createEmbeddingsProvider } from '../rag/embeddings'
import type { EmbeddingsIndexFile } from '../rag/ragPricer'
import { TARIFAS_PATH } from './loadKnowledge'

const OUT_PATH = resolve(process.cwd(), 'resources/knowledge/alagal_embeddings.json')
const CHUNK = 64

function loadExisting(): EmbeddingsIndexFile | null {
  if (!existsSync(OUT_PATH)) return null
  try {
    return JSON.parse(readFileSync(OUT_PATH, 'utf-8')) as EmbeddingsIndexFile
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const provider = createEmbeddingsProvider()
  console.log(`Proveedor de embeddings: ${provider.id} (dim ${provider.dim})`)

  const catalog = await loadCatalog(TARIFAS_PATH)
  const existing = loadExisting()
  const done = new Map<string, number[]>((existing?.entries ?? []).map((e) => [e.codigo, e.vector]))
  const pending = catalog.filter((e) => !done.has(e.codigo))

  console.log(
    `Catálogo: ${catalog.length} entradas · ya hechas: ${done.size} · pendientes: ${pending.length}`
  )
  if (pending.length === 0) {
    console.log('Índice completo, nada que hacer.')
    return
  }

  const save = (): void => {
    const out: EmbeddingsIndexFile = {
      model: provider.id,
      dim: provider.dim,
      entries: catalog
        .filter((e) => done.has(e.codigo))
        .map((e) => ({ codigo: e.codigo, vector: done.get(e.codigo)! }))
    }
    writeFileSync(OUT_PATH, JSON.stringify(out))
  }

  try {
    for (let i = 0; i < pending.length; i += CHUNK) {
      const chunk = pending.slice(i, i + CHUNK)
      const vecs = await provider.embed(
        chunk.map((e) => e.doc),
        'doc'
      )
      chunk.forEach((e, j) => done.set(e.codigo, l2normalize(vecs[j])))
      save()
      console.log(`  ${done.size}/${catalog.length} (${OUT_PATH.split('/').pop()})`)
    }
    console.log(`\n✓ Índice completo: ${done.size} vectores en ${OUT_PATH}`)
  } catch (e) {
    save()
    console.error(
      `\n✗ Interrumpido (${e instanceof Error ? e.message : e}). Guardadas ${done.size}/${catalog.length}.` +
        ' Relanza `npm run rag:build-embeddings` para continuar.'
    )
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
