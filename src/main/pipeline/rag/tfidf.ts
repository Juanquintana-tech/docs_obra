/**
 * TF-IDF con n-gramas de caracteres dentro de límites de palabra (char_wb),
 * port fiel del comportamiento de sklearn TfidfVectorizer usado en rag_pricer.py:
 *   analyzer="char_wb", ngram_range=(3,5), sublinear_tf=True, smooth_idf=True, norm="l2".
 *
 * Captura variaciones morfológicas de terminología técnica española
 * (granulometría/granulométrico, proctor/Proctor, une/UNE…) sin API ni GPU.
 */

/** Genera n-gramas de caracteres por palabra, con padding de espacio en los bordes. */
export function charWbNgrams(text: string, minN = 3, maxN = 5): string[] {
  const out: string[] = []
  for (const word of text.split(/\s+/)) {
    if (!word) continue
    const w = ` ${word} `
    const len = w.length
    for (let n = minN; n <= maxN; n++) {
      let offset = 0
      out.push(w.slice(offset, offset + n))
      while (offset + n < len) {
        offset += 1
        out.push(w.slice(offset, offset + n))
      }
      // Palabra más corta que n: se contabiliza una sola vez (igual que sklearn).
      if (offset === 0) break
    }
  }
  return out
}

interface SparseVec {
  idx: number[]
  val: number[]
}

export class TfidfIndex {
  private vocab = new Map<string, number>()
  private idf: number[] = []
  private docVecs: SparseVec[] = []

  /** Construye el índice a partir de los documentos (ya normalizados). */
  fit(docs: string[]): void {
    const n = docs.length
    // 1) vocabulario + document frequency
    const df = new Map<number, number>()
    const docCounts: Map<number, number>[] = []
    for (const doc of docs) {
      const counts = new Map<number, number>()
      const seen = new Set<number>()
      for (const gram of charWbNgrams(doc)) {
        let id = this.vocab.get(gram)
        if (id === undefined) {
          id = this.vocab.size
          this.vocab.set(gram, id)
        }
        counts.set(id, (counts.get(id) ?? 0) + 1)
        seen.add(id)
      }
      for (const id of seen) df.set(id, (df.get(id) ?? 0) + 1)
      docCounts.push(counts)
    }
    // 2) idf con suavizado: ln((1+n)/(1+df)) + 1
    this.idf = new Array(this.vocab.size).fill(0)
    for (const [id, d] of df) this.idf[id] = Math.log((1 + n) / (1 + d)) + 1
    // 3) vectores tf-idf normalizados (sublinear tf = 1+log(tf))
    this.docVecs = docCounts.map((counts) => this.weightAndNormalize(counts))
  }

  private weightAndNormalize(counts: Map<number, number>): SparseVec {
    const idx: number[] = []
    const val: number[] = []
    let norm = 0
    for (const [id, tf] of counts) {
      const w = (1 + Math.log(tf)) * (this.idf[id] ?? 0)
      if (w === 0) continue
      idx.push(id)
      val.push(w)
      norm += w * w
    }
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < val.length; i++) val[i] /= norm
    return { idx, val }
  }

  /** Vectoriza una consulta (ya normalizada) reusando vocab+idf del índice. */
  private transformQuery(query: string): Map<number, number> {
    const counts = new Map<number, number>()
    for (const gram of charWbNgrams(query)) {
      const id = this.vocab.get(gram)
      if (id === undefined) continue // ngramas fuera de vocab se ignoran
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }

  /** Similitud coseno [0,1] de la consulta contra TODOS los docs (índice = doc). */
  scoreAll(query: string): number[] {
    const qVec = this.weightAndNormalize(this.transformQuery(query))
    const qMap = new Map<number, number>()
    for (let i = 0; i < qVec.idx.length; i++) qMap.set(qVec.idx[i], qVec.val[i])

    const scores = new Array<number>(this.docVecs.length).fill(0)
    for (let d = 0; d < this.docVecs.length; d++) {
      const v = this.docVecs[d]
      let dot = 0
      for (let i = 0; i < v.idx.length; i++) {
        const q = qMap.get(v.idx[i])
        if (q !== undefined) dot += q * v.val[i]
      }
      scores[d] = dot
    }
    return scores
  }

  /** Devuelve los índices de doc top-k con su similitud coseno [0,1], desc. */
  queryTopK(query: string, k = 5): Array<{ doc: number; score: number }> {
    const scores = this.scoreAll(query)
    const idxs = scores
      .map((score, doc) => ({ doc, score }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
    return idxs.slice(0, k)
  }

  get size(): number {
    return this.docVecs.length
  }
}
