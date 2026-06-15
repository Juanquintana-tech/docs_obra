/**
 * Classifier — extrae materiales ensayables y datos de obra del texto del PDF.
 * Port de agents/classifier.py. Usa un LlmProvider enchufable (MiniMax por defecto).
 */
import type { Material } from './types'
import { createLlmProvider, type LlmProvider } from './llm'

const SYSTEM_PROMPT = `Eres un experto en control de calidad de obras de construcción civil en España.
Tu tarea es analizar el texto de una memoria técnica o presupuesto de obra y extraer todos los
materiales/unidades de obra que sean SUSCEPTIBLES de ser ensayadas por un laboratorio de control.

Los materiales susceptibles de ensayo son siempre los mismos tipos:
- Terraplén, rellenos, pedraplén, todo-uno
- Suelo estabilizado in situ con cemento (S-EST)
- Zahorra artificial
- Mezclas bituminosas (AC 32, AC 22, AC 16, BBTM, etc.)
- Hormigones (HA-XX, HP-XX, HM-XX, hormigón proyectado/gunita) - por tipo → categoría HORMIGON
- Escollera / enrocamiento
- Acero para hormigón armado (pasivo/activo)
- Bulones / micropilotes

IGNORA (NO son materiales a ensayar — no los incluyas):
- Unidades de obra de RETIRADA/DEMOLICIÓN: fresado de pavimento (p. ej. "fresado por centímetro de espesor"),
  demoliciones, levantado, excavación, desbroce, retirada de firme. Son trabajos, no materiales nuevos a ensayar.
- Señalización, jardinería, mobiliario urbano, instalaciones eléctricas, saneamiento menor.
- Unidades de medición auxiliares o de abono (p. ej. "por cm de espesor", "m²·cm") que no representan un material colocado.
IMPORTANTE: solo se ensaya el material NUEVO puesto en obra (terraplén, zahorra, hormigón, mezcla bituminosa colocada,
escollera, acero…). El fresado retira material existente y NO se ensaya.

Devuelve EXCLUSIVAMENTE un JSON array con este formato, sin texto adicional:
[
  {
    "material": "nombre canónico del material",
    "category": "una de: TERRAPLEN_RELLENOS | ZAHORRA_ARTIFICIAL | HORMIGON | ESCOLLERA | SUELO_ESTABILIZADO | MEZCLA_BITUMINOSA | ACERO | OTRO",
    "quantity": número en float o null si no se encuentra,
    "unit": "m3 | m2 | t | ml | ud",
    "description": "descripción tal como aparece en el documento",
    "notes": "notas relevantes como tipo de hormigón, localización, etc."
  }
]`

const OBRA_INFO_PROMPT = `Eres un asistente especializado en documentación de obras de construcción en España. Analiza el texto y extrae los datos administrativos de la obra. Devuelve EXCLUSIVAMENTE un JSON con este formato exacto, sin texto adicional:
{
  "obra": "nombre completo de la obra o proyecto tal como aparece en el documento",
  "cliente": "empresa o entidad contratante / promotora / constructora principal",
  "ref_doc": "número de expediente o código de proyecto si aparece, si no cadena vacía",
  "municipio": "municipio o localización de la obra si aparece, si no cadena vacía"
}
Si un campo no está claro en el documento, usa cadena vacía.`

export interface ObraInfoExtracted {
  obra?: string
  cliente?: string
  ref_doc?: string
  municipio?: string
}

/** Parseo tolerante de JSON (admite respuesta envuelta en texto). */
function parseJsonLoose<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T
  } catch {
    // intenta recortar al primer bloque [...] o {...}
    const m = raw.match(/[[{][\s\S]*[\]}]/)
    if (m) {
      try {
        return JSON.parse(m[0]) as T
      } catch {
        return null
      }
    }
    return null
  }
}

/** Infiere nombre de obra, cliente y otros datos del texto del PDF. */
export async function extractObraInfo(
  pdfText: string,
  provider: LlmProvider = createLlmProvider()
): Promise<ObraInfoExtracted> {
  const raw = await provider.chat(
    OBRA_INFO_PROMPT,
    `Extrae los datos administrativos de esta memoria de obra:\n\n${pdfText.slice(0, 30000)}`,
    { maxTokens: 512, timeoutMs: 60_000, tag: 'extract_obra_info' }
  )
  const result = parseJsonLoose<ObraInfoExtracted>(raw)
  return result && typeof result === 'object' && !Array.isArray(result) ? result : {}
}

/** Extrae y clasifica los materiales ensayables del texto del PDF. */
export async function classifyMaterials(
  pdfText: string,
  provider: LlmProvider = createLlmProvider()
): Promise<Material[]> {
  const raw = await provider.chat(
    SYSTEM_PROMPT,
    `Analiza este texto y extrae los materiales susceptibles de ensayo:\n\n${pdfText.slice(0, 50000)}`,
    { maxTokens: 4096, timeoutMs: 120_000, tag: 'classify_materials' }
  )
  const parsed = parseJsonLoose<unknown>(raw)
  if (!Array.isArray(parsed)) return []
  // conserva solo los elementos que son objetos (el LLM a veces mezcla strings)
  return parsed.filter((m): m is Material => typeof m === 'object' && m !== null)
}
