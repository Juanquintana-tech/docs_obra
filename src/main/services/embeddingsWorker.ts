/**
 * UtilityProcess de embeddings — aísla la inferencia ONNX del proceso main.
 *
 * El modelo (transformers.js → onnxruntime-node) NO puede correr en el proceso
 * main de Electron: el addon nativo provoca un crash (SIGTRAP) y, además,
 * @xenova/transformers es ESM-only (no se puede `require` desde el bundle CJS).
 * Aquí, dentro de un UtilityProcess (entorno Node aislado), ambos problemas
 * desaparecen: la inferencia vive en otro proceso y el paquete se carga con
 * import() dinámico.
 *
 * Protocolo (process.parentPort):
 *   main → worker:  { id, texts, kind }                  petición de embeddings
 *   worker → main:  { id, vectors }                      respuesta OK
 *                   { id, error }                        respuesta con fallo
 *                   { ready: true } | { ready: false, error }   handshake inicial
 *
 * Convención e5: prefijo "query: " para consultas, "passage: " para documentos.
 */
const MODEL = 'Xenova/multilingual-e5-small'

// Tipos mínimos del pipeline de transformers.js (cargado dinámicamente).
type Tensor = { data: Float32Array; dims: number[] }
type Extractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean }
) => Promise<Tensor>

let extractorPromise: Promise<Extractor> | null = null

function getExtractor(): Promise<Extractor> {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers')
      return (await pipeline('feature-extraction', MODEL)) as unknown as Extractor
    })()
  }
  return extractorPromise
}

async function embed(texts: string[], kind: 'doc' | 'query'): Promise<number[][]> {
  if (texts.length === 0) return []
  const ext = await getExtractor()
  const prefix = kind === 'query' ? 'query: ' : 'passage: '
  const out = await ext(
    texts.map((t) => prefix + t),
    { pooling: 'mean', normalize: true }
  )
  const [n, dim] = out.dims as [number, number]
  const data = out.data
  const vectors: number[][] = []
  for (let i = 0; i < n; i++) vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)))
  return vectors
}

const port = process.parentPort

// Precalienta el modelo y avisa al main cuando está listo (o si falló la carga).
getExtractor().then(
  () => port.postMessage({ ready: true }),
  (e: unknown) => port.postMessage({ ready: false, error: String((e as Error)?.message ?? e) })
)

port.on('message', (e: { data: { id: number; texts: string[]; kind: 'doc' | 'query' } }) => {
  const { id, texts, kind } = e.data
  embed(texts, kind).then(
    (vectors) => port.postMessage({ id, vectors }),
    (err: unknown) => port.postMessage({ id, error: String((err as Error)?.message ?? err) })
  )
})
