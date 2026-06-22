/**
 * Proveedor de embeddings para el proceso main que delega la inferencia en un
 * UtilityProcess (embeddingsWorker.ts). Implementa EmbeddingsProvider, así que
 * RagPricer lo usa igual que a cualquier otro proveedor, pero sin tocar ONNX en
 * el main (ver embeddingsWorker.ts para el porqué).
 *
 * El proceso hijo se arranca de forma perezosa en el primer embed() y se reutiliza.
 * Si el hijo muere, se rechazan las peticiones en vuelo y se reintentará el fork
 * en la siguiente llamada.
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import type { EmbedKind, EmbeddingsProvider } from '../pipeline/rag/types'

/** Dimensión de multilingual-e5-small (debe coincidir con el worker). */
const DIM = 384

/** Tiempo máximo de una petición de embeddings ya con el modelo cargado. */
const REQUEST_TIMEOUT_MS = 60_000
/** Tiempo máximo para cargar el modelo (la 1ª vez descarga ~100 MB). */
const INIT_TIMEOUT_MS = 180_000

interface Pending {
  resolve: (v: number[][]) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class UtilityEmbeddingsProvider implements EmbeddingsProvider {
  readonly id = 'local-e5-small'
  readonly dim = DIM

  private child: UtilityProcess | null = null
  private ready: Promise<void> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  /** Arranca el worker (una vez) y resuelve cuando el modelo está cargado. */
  private ensureChild(): Promise<void> {
    if (this.ready) return this.ready

    this.ready = new Promise<void>((resolve, reject) => {
      const child = utilityProcess.fork(join(__dirname, 'embeddingsWorker.js'), [], {
        serviceName: 'cye-embeddings',
        stdio: 'pipe'
      })
      this.child = child
      let settled = false
      const initTimer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        reject(new Error('el worker de embeddings no cargó el modelo a tiempo'))
      }, INIT_TIMEOUT_MS)

      child.stderr?.on('data', (d) => console.error('[embeddings]', String(d).trimEnd()))
      child.stdout?.on('data', (d) => console.log('[embeddings]', String(d).trimEnd()))

      child.on(
        'message',
        (msg: { ready?: boolean; error?: string; id?: number; vectors?: number[][] }) => {
          // Handshake inicial: el modelo terminó de cargar (o falló).
          if (msg.ready !== undefined) {
            if (settled) return
            settled = true
            clearTimeout(initTimer)
            if (msg.ready) resolve()
            else reject(new Error(msg.error ?? 'fallo al cargar el modelo de embeddings'))
            return
          }
          // Respuesta a una petición concreta.
          if (msg.id === undefined) return
          const p = this.pending.get(msg.id)
          if (!p) return
          this.pending.delete(msg.id)
          clearTimeout(p.timer)
          if (msg.error) p.reject(new Error(msg.error))
          else p.resolve(msg.vectors ?? [])
        }
      )

      child.on('exit', (code) => {
        clearTimeout(initTimer)
        const err = new Error(`el worker de embeddings terminó (código ${code})`)
        if (!settled) {
          settled = true
          reject(err)
        }
        this.rejectAllPending(err)
        this.child = null
        this.ready = null // permite reintentar el fork en la próxima llamada
      })
    })

    return this.ready
  }

  /** Rechaza y limpia todas las peticiones en vuelo (al morir el worker o al cerrarlo). */
  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    this.pending.clear()
  }

  async embed(texts: string[], kind: EmbedKind = 'doc'): Promise<number[][]> {
    if (texts.length === 0) return []
    try {
      await this.ensureChild()
    } catch (e) {
      // El worker no está disponible (módulo no instalado, crash ONNX, etc.).
      // Devolvemos vectores nulos → RagPricer degrada a TF-IDF solo.
      console.warn('[embeddings] no disponible, usando solo TF-IDF:', (e as Error).message)
      return texts.map(() => new Array(DIM).fill(0))
    }
    // El worker pudo morir o cerrarse (dispose) durante el await de arriba.
    const child = this.child
    if (!child) return texts.map(() => new Array(DIM).fill(0))
    const id = this.nextId++
    return new Promise<number[][]>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) {
          reject(new Error(`la petición de embeddings (#${id}) excedió el tiempo límite`))
        }
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      child.postMessage({ id, texts, kind })
    })
  }

  /** Detiene el worker (al cerrar la app) y rechaza las peticiones pendientes. */
  dispose(): void {
    this.child?.kill()
    this.child = null
    this.ready = null
    this.rejectAllPending(new Error('worker de embeddings detenido'))
  }
}
