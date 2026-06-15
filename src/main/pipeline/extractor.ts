/**
 * Extractor de texto de PDF (port parcial de agents/extractor.py).
 * Vía nativa con unpdf (pdf.js). Caso dominante: memorias/presupuestos con texto.
 *
 * OCR de PDFs escaneados: DIFERIDO (ver PLAN.md). Requiere una cadena de
 * renderizado PDF→imagen + tesseract.js que se añadirá como sub-tarea aislada.
 * De momento se detecta el caso y se marca needsOcr=true para avisar en la UI.
 */
import { readFile } from 'fs/promises'
import { extractText as unpdfExtractText, getDocumentProxy } from 'unpdf'

export interface ExtractResult {
  text: string
  totalPages: number
  method: 'native' | 'ocr'
  /** true si el PDF parece escaneado (poco texto por página) y haría falta OCR. */
  needsOcr: boolean
}

/** Umbral de caracteres por página por debajo del cual se sospecha PDF escaneado. */
const MIN_CHARS_PER_PAGE = 50

export async function extractText(pdfPath: string): Promise<ExtractResult> {
  const buffer = new Uint8Array(await readFile(pdfPath))
  const pdf = await getDocumentProxy(buffer)
  const { totalPages, text } = await unpdfExtractText(pdf, { mergePages: true })
  const merged = (text ?? '').trim()

  const needsOcr = totalPages > 0 && merged.length < MIN_CHARS_PER_PAGE * totalPages
  return { text: merged, totalPages, method: 'native', needsOcr }
}
