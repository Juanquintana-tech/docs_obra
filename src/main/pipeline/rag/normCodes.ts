/**
 * Extracción de códigos de norma técnica de las descripciones de ensayo.
 * Permite detectar si un query y una entrada del catálogo referencian la misma
 * norma (UNE, NLT, ASTM, ISO, EN) y aplicar un bonus de score.
 *
 * Normalización: prefijo + dígitos, sin separadores ni año.
 * "UNE 103101:95" → "UNE103101"   "UNE-EN 933-1" → "UNEEN9331"
 * "NLT-357"       → "NLT357"      "ASTM D-3017"  → "ASTMD3017"
 * "ISO 6892"      → "ISO6892"     "EN 12350-1"   → "EN123501"
 */

/**
 * Regex que captura: (prefijo)(letra_opcional)(número_base).
 * El año ":XX" al final se descarta — un match de número base es suficiente
 * para confirmar que ambos referencian la misma norma.
 */
const NORM_RE =
  /\b(UNE(?:[-\s]?EN)?|NLT|ASTM|ISO|EN)\s*[-]?\s*([A-Z]?)\s*(\d[\d]*)/gi

/** Extrae códigos de norma normalizados de un texto técnico. */
export function extractNormCodes(text: string): Set<string> {
  const codes = new Set<string>()
  NORM_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = NORM_RE.exec(text)) !== null) {
    const prefix = m[1].replace(/[-\s]/g, '').toUpperCase()
    const letter = m[2].toUpperCase()
    const num = m[3]
    codes.add(`${prefix}${letter}${num}`)
  }
  return codes
}

/** Bonus de score cuando query y entrada del catálogo comparten ≥1 norma. */
export const NORM_MATCH_BONUS = 0.10

/**
 * Calcula el bonus de norma para un par (queryNorms, entryNorms).
 * Devuelve NORM_MATCH_BONUS si comparten al menos un código, 0 si no.
 */
export function normBonus(queryNorms: Set<string>, entryNorms: Set<string>): number {
  if (queryNorms.size === 0 || entryNorms.size === 0) return 0
  for (const code of queryNorms) {
    if (entryNorms.has(code)) return NORM_MATCH_BONUS
  }
  return 0
}
