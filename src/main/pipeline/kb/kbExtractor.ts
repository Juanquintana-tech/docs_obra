/**
 * Extractor de mediciones para el motor BBDD (Etapa 3, branch Cye_BBDD).
 *
 * Documento de obra (PDF/XLSX/…) → texto → clasificación LLM (Gemini→MiniMax, reusa
 * el classifier existente) → SectionInput[] que consume el motor determinista.
 *
 * El LLM SOLO produce estructura (categoría, material, cantidad, unidad). Capa e
 * (cuando aplica) altura se derivan del nombre. Todo número del presupuesto lo
 * calcula el motor a partir de la BBDD curada.
 */
import { extractDocument } from '../extractor'
import { classifyMaterials } from '../classifier'
import { createLlmProvider, MiniMaxProvider, type LlmProvider } from '../llm'
import type { SectionInput } from './engine'

/** Capa de mezcla bituminosa inferida del nombre (selecciona fila de la tabla 542.16). */
export function inferCapa(name: string): 'rodadura' | 'intermedia' | 'base' | null {
  const t = name.toLowerCase()
  if (/rodadura|surf|bbtm|sma|\bdts\b|microaglomerad/.test(t)) return 'rodadura'
  if (/intermedia|\bbin\b|\bg\b\s*$|ac.?\d+.?bin/.test(t)) return 'intermedia'
  if (/\bbase\b|ac.?\d+.?base|grava\s*cemento/.test(t)) return 'base'
  return null
}

/** Altura de terraplén ≥5 m inferida del nombre, si se menciona; si no, null (el motor asume). */
export function inferHeightGe5m(name: string): boolean | null {
  const m = name.match(/(\d+(?:[.,]\d+)?)\s*m\b.*altura|altura.*?(\d+(?:[.,]\d+)?)\s*m\b/i)
  if (!m) return null
  const h = parseFloat((m[1] ?? m[2]).replace(',', '.'))
  return Number.isFinite(h) ? h >= 5 : null
}

export function materialToSection(m: {
  material?: string; category?: string; quantity?: number | null; unit?: string; description?: string
}): SectionInput {
  const name = `${m.material ?? ''} ${m.description ?? ''}`.trim()
  return {
    tramo: m.material ?? m.description ?? null,
    categoryCode: m.category ?? 'OTRO',
    material: m.material ?? null,
    quantity: m.quantity ?? null,
    unit: m.unit ?? null,
    capa: m.category === 'MEZCLA_BITUMINOSA' ? inferCapa(name) : null,
    heightGe5m: m.category === 'TERRAPLEN_RELLENOS' ? inferHeightGe5m(name) : null,
  }
}

export interface ExtractedPlanInput {
  sections: SectionInput[]
  skipped: number // materiales OTRO/sin categoría descartados
  attempts: number // intentos de clasificación necesarios
  warning?: string // p.ej. documento sin texto, o clasificación vacía tras reintentos
}

const MAX_ATTEMPTS = 3

/**
 * Extrae y clasifica un documento de obra → secciones para el motor.
 * La clasificación LLM a veces devuelve vacío (respuesta válida pero sin items) y
 * el fallback Gemini→MiniMax no salta porque no es un error. Reintentamos hasta
 * obtener materiales; en el último intento forzamos MiniMax como red de seguridad.
 */
export async function extractSections(path: string, provider?: LlmProvider): Promise<ExtractedPlanInput> {
  const { text } = await extractDocument(path)
  if (text.trim().length < 20) {
    return { sections: [], skipped: 0, attempts: 0, warning: 'El documento no contiene texto legible (¿PDF escaneado? requiere OCR).' }
  }

  let materials: Awaited<ReturnType<typeof classifyMaterials>> = []
  let attempts = 0
  for (; attempts < MAX_ATTEMPTS && materials.length === 0; attempts++) {
    // En el último intento, forzar MiniMax (por si Gemini devuelve vacío de forma persistente).
    const p = provider ?? (attempts === MAX_ATTEMPTS - 1 ? new MiniMaxProvider() : createLlmProvider())
    try {
      materials = await classifyMaterials(text, p)
    } catch {
      materials = []
    }
  }

  const valid = materials.filter((m) => m.category && m.category !== 'OTRO')
  const warning = materials.length === 0
    ? `La clasificación no devolvió materiales tras ${attempts} intentos — revisar el documento.`
    : undefined
  return { sections: valid.map(materialToSection), skipped: materials.length - valid.length, attempts, warning }
}
