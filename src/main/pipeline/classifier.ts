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
  CUBIERTA            — cubiertas planas transitables o no transitables, cubiertas inclinadas,
                        impermeabilizaciones de cubierta, lucernarios (cantidad en m2)
  FACHADA             — fachadas, cerramientos exteriores, muros cortina, carpintería exterior,
                        conjunto fachada-ventana (cantidad en m2)
  BARANDILLA          — barandillas, pretiles, protecciones perimetrales de borde (cantidad en ml)
  FALSO_TECHO         — falsos techos, techos suspendidos, placas de techo (cantidad en m2)
  PANEL_SANDWICH      — paneles tipo sándwich en cubierta o fachada (chapa + aislante + chapa) (cantidad en m2)
  MORTERO             — morteros de cemento, enfoscados, revocos, enlucidos (cantidad en m2)
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
              Medición de concentración de radón (detectores de trazas, período de exposición).
              Pruebas de puesta en servicio de instalaciones en edificación: cuando en el
              Totalizados aparece "saneamiento", "fontanería", "electricidad", "calefacción",
              "climatización", "ventilación", "PCI", "ci", "contra incendios" como ítem
              de control (sin unidad de obra m/m2/m3 asociada), clasificar cada uno como
              SERVICIO con quantity=1 y description="Prueba de servicio de [tipo]".

IGNORAR (no incluir):
- Demoliciones, fresado, levantado, excavación, desbroce, retirada de firme.
- Compactación de fondo de excavación en m² (ej: "20000 M2 COMPACTACIÓN FONDO EXCAVACIÓN"):
  es una operación de preparación, no un material a ensayar. El relleno posterior (SS-2, ZA…) sí se ensaya.
- El trabajo de ejecución de instalaciones MEP como tal (ml de tubería, m2 de conducto…).
  EXCEPCIÓN: si aparecen como partida de control sin cantidad de obra (etiqueta sola como
  "fontanería", "saneamiento", "electricidad", "ci"…) → clasificar como SERVICIO con quantity=1.
- Señalización vertical, jardinería, mobiliario urbano, telecomunicaciones (cableado/antenas).
- Partidas auxiliares o de abono ("por cm de espesor", "m²·cm").
- Betún o ligante como materia prima aislada (p.ej. "BETUN MEJORADO 4.326 t", "BETUN MODIFICADO"):
  el ensayo es sobre la MEZCLA terminada, no sobre el betún en acopio.
- Alicatados, pinturas, solados interiores, morteros de agarre (se ensayan como SERVICIO si aparecen
  explícitamente con cantidad de ensayos, no como material puesto en obra).
- Lámina/membrana anti-radón en m² (ej: "4920 M2 RADÓN", "LÁMINA RADON 0.6 mm"): es un material
  de impermeabilización, NO un ensayo de medición. IGNORAR. Solo clasificar como SERVICIO
  cuando aparezca como partida de medición/informe sin unidad m².
- Malla electrosoldada / mallazo en m² (ej: "1767 M2 MALLAZO 15X15X6", "MALLA ELECTROSOLDADA"):
  es armadura secundaria de pavimento expresada en m². Sin el peso por m² no se puede convertir a
  toneladas. IGNORAR. (Si aparece en kg o t → ACERO con esa cantidad.)
- Alumbrado público / farolas / luminarias (ej: "150 FAROLAS LED", "ALUMBRADO VIAL"):
  son instalaciones de infraestructura urbana. IGNORAR. No generar SERVICIO por cantidad de farolas.
  EXCEPCIÓN: si aparece como partida de control eléctrico genérica ("electricidad", "alumbrado" sin
  cantidad de unidades de obra) → SERVICIO quantity=1.
- Barreras de seguridad vial / biondas / quitamiedos / defensas metálicas / pretiles de carretera
  en ml (ej: "3295 ML BARRERA SEGURIDAD", "BIONDA", "DEFENSA METÁLICA"):
  son elementos de contención vial, NO barandillas de edificación. IGNORAR. No clasificar como
  BARANDILLA (su ensayo estático no es de frecuencia por ml sino por homologación de producto).
- Perfiles de acero para forjado mixto colaborante / losas colaborantes (COFRAPLUS, HAIRCOL,
  COMFLOR, "FORJADO MIXTO", "LOSA COLABORANTE", "CHAPA COLABORANTE"):
  son productos siderúrgicos CE marcados; su control de calidad es documental, no se realizan
  ensayos de tracción en obra. IGNORAR. No clasificar como ACERO_LAMINADO.
- Impermeabilización de losa de tablero / impermeabilización de obra de paso / impermeabilización
  de viaducto / estribos / muros de contención en obra civil en m²
  (ej: "1200 M2 IMPERMEABILIZACIÓN LOSA TABLERO", "IMPERMEABILIZACIÓN OBRA DE PASO"):
  son sistemas de impermeabilización certificados para estructuras de carretera, no ensayados
  por frecuencia en m². IGNORAR. No clasificar como CUBIERTA ni OTRO.

── Abreviaturas frecuentes en obras civiles españolas ──────────────────────────
  ZA / Z.A.  → ZAHORRA_ARTIFICIAL
  SEST / S-EST / SC / GC (suelo cemento/grava cemento) → SUELO_ESTABILIZADO
  DTS (doble tratamiento superficial) → MEZCLA_BITUMINOSA
  AC-22 / AC-16 / BBTM → MEZCLA_BITUMINOSA
  HA-XX / HP-XX / HM-XX / C20/25 / C25/30 / C30/37 / C40/50 → HORMIGON
  BULON / BULÓN / soil nail / anclaje pasivo → BULON (cantidad en metros totales instalados)
  cross hole / cross-hole / cross holle / auscultación sónica / sonic testing → PILOTES
    (cantidad = número de pilotes; el laboratorio realiza 1 ensayo de auscultación por pilote)
  ACERO PRET / ACERO PRETENSAR / Y1860 / torones / cordones → ACERO_ACTIVO
  B500S / B500SD → ACERO (barras corrugadas pasivas)
  acero estructural / S275 / S355 / IPE / HEB → ACERO_LAMINADO
  horm. proyectado / gunita → HORMIGON
  micropilote / micropilotes → PILOTES
  cubierta plana / cubierta transitable / cubierta inclinada → CUBIERTA
  fachada / muro cortina / carpintería exterior → FACHADA
  barandilla / pretil / protección perimetral → BARANDILLA
  falso techo / techo suspendido → FALSO_TECHO
  panel sándwich / panel chapa / panel PUR / panel PIR → PANEL_SANDWICH
  mortero / enfoscado / revoco / enlucido → MORTERO
  radón / radon SIN unidad m² → SERVICIO (quantity=1, description="Prueba de servicio de radón")
  radón / radon CON unidad m² → IGNORAR (es lámina anti-radón, no ensayo)
  saneamiento → SERVICIO (quantity=1, description="Prueba de servicio de saneamiento")
  fontanería / fontaneria → SERVICIO (quantity=1, description="Prueba de servicio de fontanería")
  electricidad / eelectricidad / alumbrado → SERVICIO (quantity=1, description="Prueba de servicio de electricidad")
  calefacción / ACS / calefaccion → SERVICIO (quantity=1, description="Prueba de servicio de calefacción y ACS")
  clima / climatización / ventilación / ventilacion → SERVICIO (quantity=1, description="Prueba de servicio de climatización y ventilación")
  ci / c.i. / contra incendios / PCI → SERVICIO (quantity=1, description="Prueba de servicio PCI contra incendios")

── Formato tabular (planes de control, totalizados) ────────────────────────────
El documento puede ser una tabla con columnas separadas por tabuladores.
El primer campo puede contener "CANTIDAD UNIDAD descripción" ya normalizado,
o bien solo una descripción de sección (E-1A, E-18, Pasarela, Rampa…) — IGNORAR esas cabeceras.
Columnas adicionales con números (lotes, muestras) o texto de control → IGNORAR.
Extrae solo los materiales con cantidad numérica clara.
Agrupa por tipo: si hay varios tipos de hormigón (C25/30, C30/37, C40/50) en una misma obra,
agrúpalos en un único ítem HORMIGON con la suma de todas las cantidades.

IMPORTANTE — Formato numérico de celdas Excel:
Los números en este texto provienen de celdas Excel ya parseadas en notación anglosajona
(punto como separador decimal, sin separador de miles). Interpreta el punto SIEMPRE como decimal,
no como separador de miles. Ejemplos:
  "219.775"   → quantity=219.775 (≈220 m³), NO 219775
  "25420.816" → quantity=25420.816 (≈25.420 m³)
  "45685"     → quantity=45685 (cuarenta y cinco mil seiscientos ochenta y cinco)
  "3547"      → quantity=3547 (tres mil quinientos cuarenta y siete)

── Mezclas bituminosas expresadas en m² ─────────────────────────────────────────
Algunas mezclas de capa delgada aparecen en m² en lugar de toneladas:
  BBTM (betún bituminoso de muy bajo espesor, e ≈ 25 mm, densidad ≈ 2,3 t/m³):
    → quantity = m² × 0,057  (ej: 55.968 m² × 0,057 = 3.190 t)  → unit = "t"
  DTS (doble tratamiento superficial): NO es mezcla bituminosa propiamente dicha.
    Clasificar como RIEGO_BITUMINOSO con la cantidad en m² y unit = "m2".
    (Solo se ensayan dotaciones de ligante y árido, no extracción de testigos.)

── Soleras de hormigón en m² ────────────────────────────────────────────────────
Cuando el Totalizados expresa una solera en m² con espesor visible en la descripción
(ej: "4920 M2 SOLERA HA-25 0,18 M", "2090 M2 SOLERA c-25 0.20 m"):
  → quantity = m² × espesor_metros   (ej: 4920 × 0,18 = 885,6)
  → unit = "m3"
Si el espesor no aparece en el texto, usa quantity = m² y unit = "m2" (el planner lo tratará
como metros cuadrados de losa; mejor imperfecto que inventar un espesor).

── Regla de AGREGACIÓN ─────────────────────────────────────────────────────────
Si el mismo tipo de material aparece en MÚLTIPLES FILAS (una por estructura, viaducto o
sección), SUMA todas las cantidades en UN SOLO ítem con la cantidad total.
Ejemplo: si hay 10 filas "HA-30" con distintas cantidades (una por viaducto), devuelve
UN solo ítem "HORMIGON HA-30" con la suma de todas las cantidades.
Excepción: tipos de hormigón DIFERENTES (HA-30 y HP-50) van en ítems separados.


CASO ESPECIAL — TERRAPLEN_RELLENOS: todos los subtipos de terraplén y relleno
(terraplén con material de excavación, relleno de zanjas, relleno localizado, relleno de
trasdós, relleno de saneo, préstamo, todo-uno, pedraplén, relleno drenante…) se fusionan
en UN ÚNICO ítem "TERRAPLEN_RELLENOS" con la cantidad TOTAL, independientemente
de cuántas filas distintas aparezcan en el documento. El laboratorio ensaya el conjunto
de rellenos de la obra, no cada partida presupuestaria por separado.

Unidades en TERRAPLEN_RELLENOS (prioridad de unidades):
1. Si hay partidas en m³ (terraplén, todo-uno, pedraplén…), suma SOLO las m³ → unit="m3".
   Las partidas en kg del mismo grupo se anotan en "notes" pero no se suman a m³.
2. Si NO hay ninguna partida en m³ pero sí en kg (p.ej. "RELLENO: 4304081 kg") → usar
   los kg directamente: quantity=[suma kg], unit="kg". El planificador los utilizará para
   calibración proporcional. NO ignorar por unidad diferente al historial.
3. SUELO SELEC / suelo seleccionado sin unidad → si hay otras partidas en m³ en el mismo
   documento, fusionar en m³ asumiendo que la cantidad es en m³. Si no hay m³, ignorar
   (su cantidad suele ser insignificante frente al RELLENO principal en kg).

Devuelve EXCLUSIVAMENTE un JSON array (sin texto adicional):
[
  {
    "material": "nombre corto canónico",
    "category": "una de las categorías arriba",
    "quantity": número float o null,
    "unit": "m3|m2|t|m|ml|ud",
    "description": "texto tal como aparece en el documento (para SERVICIO MEP/radón usa el formato canónico de las abreviaturas, no el texto del PDF)",
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
  provider: LlmProvider = createLlmProvider(),
  opts: { timeoutMs?: number } = {}
): Promise<Material[]> {
  const { timeoutMs = 120_000 } = opts
  const raw = await provider.chat(
    SYSTEM_PROMPT,
    `Analiza este texto y extrae los materiales susceptibles de ensayo:\n\n${pdfText.slice(0, 50000)}`,
    { maxTokens: 8192, timeoutMs, tag: 'classify_materials' }
  )
  const parsed = parseJsonLoose<unknown>(raw)
  if (!Array.isArray(parsed)) return []
  // conserva solo los elementos que son objetos (el LLM a veces mezcla strings)
  return parsed.filter((m): m is Material => typeof m === 'object' && m !== null)
}

// ── Clasificación de documentos grandes (chunking automático) ────────────────

export const LARGE_DOC_THRESHOLD = 50_000
const CHUNK_SIZE = 20_000

// Palabras clave de líneas que el LLM ignoraría de todos modos —
// filtrarlas aquí reduce el texto antes de enviarlo al LLM.
const IGNORAR_BUDGET_RE =
  /demolici|fresad|levantamiento|desbroce|excav|derribo|desescombro|desmontaje|gestión.*residu|transpor.*tierr|limpieza.*viaria|encofrado|andamio|apuntalamiento|barrera.*hormig.*prefabri|señaliz.*vertic|jardinería|mobiliario urbano|farola|luminari|alumbrado.*vial|cable|telecomunicaci|antena/i

/**
 * Compacta texto de presupuesto tabular (formato Presto/Fiebdc) a solo las
 * columnas relevantes (qty, ud, descripción) y elimina líneas claramente IGNORAR.
 * Reduce el texto típicamente a ~50% del tamaño original.
 * Solo se aplica a textos extraídos de XLSX con formato tabular de ≥5 columnas.
 */
export function compactBudgetText(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []
  for (const line of lines) {
    const cols = line.split('\t')
    if (cols.length >= 5) {
      if (cols[1]?.trim() === 'Capítulo') continue
      const ud = cols[2]?.trim()
      const desc = cols[3]?.trim()
      const qty = cols[4]?.trim()
      if (!desc || !qty || isNaN(Number(qty))) continue
      if (IGNORAR_BUDGET_RE.test(desc)) continue
      result.push(`${qty} ${ud} ${desc}`)
    } else {
      const t = line.trim()
      if (t && !t.match(/^\d+(\.\d+)?$/) && t.length > 5 && !IGNORAR_BUDGET_RE.test(t))
        result.push(t)
    }
  }
  return result.join('\n')
}

/** Divide el texto en chunks cortando solo por líneas completas. */
export function chunkByLines(text: string, maxChars: number): string[] {
  const lines = text.split('\n')
  const chunks: string[] = []
  let current = ''
  for (const line of lines) {
    if (current.length + line.length + 1 > maxChars && current.length > 0) {
      chunks.push(current)
      current = ''
    }
    current += (current ? '\n' : '') + line
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * Fusiona materiales de múltiples chunks:
 * - Agrupa por (category, material normalizado) y suma quantities.
 * - Cuando un chunk tiene quantity=null y otro tiene quantity=x, conserva x.
 */
export function mergeMaterials(all: Material[][]): Material[] {
  const map = new Map<string, Material>()
  for (const chunk of all) {
    for (const m of chunk) {
      const key = `${m.category}||${(m.material ?? '').toLowerCase().trim()}`
      const existing = map.get(key)
      if (!existing) {
        map.set(key, { ...m })
      } else if (m.quantity != null && existing.quantity != null) {
        existing.quantity += m.quantity
      } else if (m.quantity != null) {
        existing.quantity = m.quantity
      }
    }
  }
  return Array.from(map.values())
}

/**
 * Clasifica materiales de un documento potencialmente grande.
 * - Si el texto cabe en un solo chunk (≤ LARGE_DOC_THRESHOLD) usa classifyMaterials directamente.
 * - Si es más grande: compacta (solo XLSX tabular), divide en chunks de CHUNK_SIZE,
 *   clasifica cada chunk en serie con timeout extendido (300 s) y fusiona los resultados.
 *
 * @param onChunkDone  Callback opcional llamado tras cada chunk (done, total).
 */
export async function classifyLargeDocument(
  text: string,
  format: string,
  provider: LlmProvider = createLlmProvider(),
  onChunkDone?: (done: number, total: number) => void
): Promise<Material[]> {
  if (text.length <= LARGE_DOC_THRESHOLD) {
    return classifyMaterials(text, provider)
  }

  const compact = format === 'xlsx' ? compactBudgetText(text) : text
  const chunks = chunkByLines(compact, CHUNK_SIZE)
  const results: Material[][] = []

  for (let i = 0; i < chunks.length; i++) {
    results.push(await classifyMaterials(chunks[i], provider, { timeoutMs: 300_000 }))
    onChunkDone?.(i + 1, chunks.length)
  }

  return mergeMaterials(results)
}
