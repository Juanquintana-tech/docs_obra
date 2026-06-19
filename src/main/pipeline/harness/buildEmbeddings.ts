/**
 * Construye el índice de embeddings del catálogo ALAGAL y lo persiste en
 * resources/knowledge/alagal_embeddings.json (vectores normalizados a L2=1).
 *
 *   npm run rag:build-embeddings
 *
 * RESUMIBLE: guarda tras cada lote y, al relanzarlo, salta los códigos ya hechos.
 * Si el modelo del índice existente difiere del proveedor actual, lo descarta y
 * reconstruye desde cero (evita mezclar vectores de modelos distintos).
 * Requiere GEMINI_API_KEY (en .env de la raíz).
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// Carga .env antes de cualquier import que lea process.env
;(function loadEnv(): void {
  const p = resolve(process.cwd(), '.env')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=')
    const val = rest.join('=').trim().replace(/^["']|["']$/g, '')
    if (key?.trim() && val && !(key.trim() in process.env)) process.env[key.trim()] = val
  }
})()

import { loadCatalog } from '../rag/catalog'
import { l2normalize } from '../rag/minimaxEmbeddings'
import { createEmbeddingsProvider } from '../rag/embeddings'
import { loadPriceBook } from '../rag/priceBook'
import type { EmbeddingsIndexFile } from '../rag/ragPricer'
import type { EmbeddingsProvider } from '../rag/types'
import { TARIFAS_PATH, KNOWLEDGE_DIR } from './loadKnowledge'

const OUT_PATH = resolve(process.cwd(), 'resources/knowledge/alagal_embeddings.json')
const PB_PATH = resolve(KNOWLEDGE_DIR, 'price_book.json')
const PB_OUT_PATH = resolve(KNOWLEDGE_DIR, 'price_book_embeddings.json')
const CHUNK = 100 // Gemini batchEmbedContents: hasta 100 por llamada

function loadExisting(providerId: string): EmbeddingsIndexFile | null {
  if (!existsSync(OUT_PATH)) return null
  try {
    const idx = JSON.parse(readFileSync(OUT_PATH, 'utf-8')) as EmbeddingsIndexFile
    if (idx.model !== providerId) {
      console.log(`Modelo cambió (${idx.model} → ${providerId}): descartando índice existente.`)
      return null
    }
    return idx
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const provider = createEmbeddingsProvider()
  console.log(`Proveedor de embeddings: ${provider.id} (dim ${provider.dim})`)

  // ── Libro de precios (si existe) → price_book_embeddings.json ──
  await buildPriceBookIndex(provider)

  const catalog = await loadCatalog(TARIFAS_PATH)
  const existing = loadExisting(provider.id)
  const done = new Map<string, number[]>((existing?.entries ?? []).map((e) => [e.codigo, e.vector]))
  const pending = catalog.filter((e) => !done.has(e.codigo))

  console.log(
    `Catálogo ALAGAL: ${catalog.length} entradas · ya hechas: ${done.size} · pendientes: ${pending.length}`
  )
  if (pending.length === 0) {
    console.log('Índice ALAGAL completo, nada que hacer.')
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

/** Embeddings del libro de precios (sobre la descripción), igual que hacía el pricer
 *  en memoria — pero persistido, para que la app NO infiera en el arranque. */
async function buildPriceBookIndex(provider: EmbeddingsProvider): Promise<void> {
  if (!existsSync(PB_PATH)) {
    console.log('No hay price_book.json; se omite el índice del libro de precios.')
    return
  }
  const entries = loadPriceBook(PB_PATH)
  const vecs = await provider.embed(
    entries.map((e) => e.descripcion),
    'doc'
  )
  const out: EmbeddingsIndexFile = {
    model: provider.id,
    dim: provider.dim,
    entries: entries.map((e, i) => ({ codigo: e.codigo, vector: l2normalize(vecs[i]) }))
  }
  writeFileSync(PB_OUT_PATH, JSON.stringify(out))
  console.log(`Libro de precios: ${entries.length} vectores → ${PB_OUT_PATH.split('/').pop()}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
