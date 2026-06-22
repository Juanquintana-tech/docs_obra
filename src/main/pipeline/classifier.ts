/**
 * Classifier — extrae materiales ensayables y datos de obra del texto del PDF.
 * Port de agents/classifier.py. Usa un LlmProvider enchufable (MiniMax por defecto).
 */
import type { Material } from './types'
import { createLlmProvider, type LlmProvider } from './llm'

const SYSTEM_PROMPT = `Eres un experto en control de calidad de obras de construcción civil en España.
Analiza el texto y extrae las partidas que un laboratorio de CC.CC. tiene que facturar.

Hay DOS tipos de partidas completamente distintas:

── TIPO A: Material de construcción a ensayar ──────────────────────────────────
El ítem del presupuesto es un MATERIAL puesto en obra (m³ de terraplén, t de mezcla…).
El laboratorio generará ensayos según las frecuencias del PG-3.

Categorías tipo A:
  TERRAPLEN_RELLENOS  — terraplén, relleno, pedraplén, todo-uno
  SUELO_ESTABILIZADO  — suelo estabilizado in situ con cemento o cal (S-EST, SEST, SC, suelo-cemento)
  ZAHORRA_ARTIFICIAL  — zahorra artificial (ZA), grava-cemento
  MEZCLA_BITUMINOSA   — mezclas bituminosas terminadas: AC 32, AC 22, AC 16, BBTM, DTS (doble tratamiento superficial)
  HORMIGON            — hormigones (HA-XX, HP-XX, HM-XX, proyectado/gunita), un ítem por tipo
  ESCOLLERA           — escollera, enrocamiento
  ACERO               — acero para hormigón armado (barras corrugadas, malla electrosoldada)
  ACERO_LAMINADO      — acero estructural laminado (perfiles IPE/HEB/UPN, chapas, S275/S355)
  MARCAS_VIALES       — marcas viales, señalización horizontal (pintura, termoplástica, retroreflectancia)
  RIEGO_BITUMINOSO    — riego de imprimación, riego de adherencia, riego de curado (emulsión aplicada en m2)
  PILOTES             — pilotes, micropilotes, pantallas de pilotes
  BULON               — bulones de anclaje pasivo, barras de anclaje en taludes, soil-nails
                        (la cantidad es la longitud total en metros; se generará 1 ensayo de
                        arrancamiento por cada 50 m de bulon instalado)
  ACERO_ACTIVO        — acero para pretensado/postensado: torones Y1860, cordones, barras de
                        pretensar, acero activo en general
  OTRO                — material ensayable que no encaja en ninguna categoría anterior

── TIPO B: Servicio o ensayo directo ───────────────────────────────────────────
El ítem del presupuesto ES en sí mismo un servicio de laboratorio/campo.
La cantidad en el BOM = número de veces que se realiza ese servicio.
El laboratorio simplemente cobra cantidad × precio_unitario, sin generar subensayos.

Categoría tipo B:
  SERVICIO  — metros de perforación/sondeo, ensayos SPT, toma de muestras, testigos
              parafinados, tubos piezómetros, movilización de equipos, ensayos
              presiométricos, georreferenciación, lecturas piezométricas, inspección
              con videocámara, medición IRI/CRT, desplazamiento de equipo APL/ECODYN,
              pruebas de estanqueidad, cualquier otro servicio/ensayo que aparece ya
              con su propia cantidad unitaria (no metros de material instalado).

IGNORAR (no incluir):
- Demoliciones, fresado, levantado, excavación, desbroce, retirada de firme.
- Señalización vertical, jardinería, mobiliario, instalaciones MEP (salvo si son pruebas).
- Partidas auxiliares o de abono ("por cm de espesor", "m²·cm").
- Betún o ligante como materia prima aislada (p.ej. "BETUN MEJORADO 4.326 t", "BETUN MODIFICADO"):
  el ensayo es sobre la MEZCLA terminada, no sobre el betún en acopio.

── Abreviaturas frecuentes en obras civiles españolas ──────────────────────────
  ZA / Z.A.  → ZAHORRA_ARTIFICIAL
  SEST / S-EST / SC / GC (suelo cemento/grava cemento) → SUELO_ESTABILIZADO
  DTS (doble tratamiento superficial) → MEZCLA_BITUMINOSA
  AC-22 / AC-16 / BBTM → MEZCLA_BITUMINOSA
  HA-XX / HP-XX / HM-XX / C20/25 / C25/30 / C30/37 / C40/50 → HORMIGON
  BULON / BULÓN / soil nail / anclaje pasivo → BULON (cantidad en metros totales instalados)
  ACERO PRET / ACERO PRETENSAR / Y1860 / torones / cordones → ACERO_ACTIVO
  B500S / B500SD → ACERO (barras corrugadas pasivas)
  acero estructural / S275 / S355 / IPE / HEB → ACERO_LAMINADO
  horm. proyectado / gunita → HORMIGON
  micropilote / micropilotes → PILOTES

── Formato tabular (planes de control, totalizados) ────────────────────────────
El documento puede ser una tabla con columnas separadas por tabuladores.
El primer campo puede contener "CANTIDAD UNIDAD descripción" ya normalizado,
o bien solo una descripción de sección (E-1A, E-18, Pasarela, Rampa…) — IGNORAR esas cabeceras.
Columnas adicionales con números (lotes, muestras) o texto de control → IGNORAR.
Extrae solo los materiales con cantidad numérica clara.
Agrupa por tipo: si hay varios tipos de hormigón (C25/30, C30/37, C40/50) en una misma obra,
agrúpalos en un único ítem HORMIGON con la suma de todas las cantidades.

── Regla de AGREGACIÓN ─────────────────────────────────────────────────────────
Si el mismo tipo de material aparece en MÚLTIPLES FILAS (una por estructura, viaducto o
sección), SUMA todas las cantidades en UN SOLO ítem con la cantidad total.
Ejemplo: si hay 10 filas "HA-30" con distintas cantidades (una por viaducto), devuelve
UN solo ítem "HORMIGON HA-30" con la suma de todas las cantidades.
Excepción: tipos de hormigón DIFERENTES (HA-30 y HP-50) van en ítems separados.

Devuelve EXCLUSIVAMENTE un JSON array (sin texto adicional):
[
  {
    "material": "nombre corto canónico",
    "category": "una de las categorías arriba",
    "quantity": número float o null,
    "unit": "m3|m2|t|m|ml|ud",
    "description": "texto tal como aparece en el documento",
    "notes": "notas opcionales (tipo hormigón, localización, etc.)"
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
    { maxTokens: 8192, timeoutMs: 120_000, tag: 'classify_materials' }
  )
  const parsed = parseJsonLoose<unknown>(raw)
  if (!Array.isArray(parsed)) return []
  // conserva solo los elementos que son objetos (el LLM a veces mezcla strings)
  return parsed.filter((m): m is Material => typeof m === 'object' && m !== null)
}
