/**
 * Normalización de texto para el RAG (port de rag_pricer._normalize):
 * minúsculas, sin acentos, puntuación → espacio. Mantiene intactos los
 * términos técnicos (Proctor → proctor, UNE → une).
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos combinantes
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // puntuación → espacio
    .replace(/\s+/g, ' ')
    .trim()
}
