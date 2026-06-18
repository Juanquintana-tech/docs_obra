/**
 * Extracción de datos de formularios de ensayo a partir de una imagen.
 * Usa Gemini Vision (gemini-2.0-flash) con prompts específicos por tipo.
 *
 * Regla clave: extraer solo datos brutos escritos por el trabajador.
 * NUNCA extraer campos calculados (%Compactación, Ev1/Ev2, veredicto…).
 */
import { GeminiProvider } from '../llm/gemini'
import { LlmError } from '../llm/types'

// ── Tipos de resultado por ensayo ──────────────────────────────────────────────

export interface DensidadOcrResult {
  cabecera: {
    orden_trabajo: string | null
    capa: string | null
    n_lote: string | null
    localizacion: string | null
    fecha_ensayo: string | null
  }
  ensayos: Array<{
    referencia: string | null
    d_max: string | null
    h_opt: string | null
    d_situ: string | null
    h_situ: string | null
    observaciones: string | null
  }>
}

export interface AlbaranOcrResult {
  n_ensayo_ot: string | null
  fecha_toma: string | null
  fecha_entrada: string | null
  titulo_obra: string | null
  ref_obra: string | null
  empresa: string | null
  direccion: string | null
  nif_cif: string | null
  persona_contacto: string | null
  telefono_fax: string | null
  observaciones_cliente: string | null
  peticionario: string | null
  efectuada_por_cye: boolean | null
  recibida_en_cye: boolean | null
  ensayo_in_situ: boolean | null
  recogida_por_cye_en: string | null
  material_descripcion: string | null
  localizacion: string | null
  otros_datos: string | null
  cantidad_muestra: string | null
  ensayos_solicitados: Array<{ ensayo: string; normativa: string }>
}

export interface GranulometriaOcrResult {
  cabecera: {
    material: string | null
    muestra: string | null
    localizacion: string | null
    fecha_ensayo: string | null
  }
  masas: string[] // valor de "Masa Mi kg" por piedra, en orden
}

export interface PlacaOcrResult {
  cabecera: {
    orden_trabajo: string | null
    pk: string | null
    capa: string | null
    fecha_ensayo: string | null
    diam_placa: string | null
  }
  ciclo1: Array<{ presion: number; l1: string | null; l2: string | null; l3: string | null }>
  descarga: Array<{ presion: number; l1: string | null; l2: string | null; l3: string | null }>
  ciclo2: Array<{ presion: number; l1: string | null; l2: string | null; l3: string | null }>
}

// ── Sistema prompt común ───────────────────────────────────────────────────────

const SYSTEM = `Eres un asistente especializado en extracción de datos de formularios de \
laboratorio de control de calidad de obra civil española (empresa CYE - Control y Estudios). \
Los formularios son plantillas impresas rellenadas a mano con bolígrafo azul o negro.

REGLAS:
- Extrae SOLO los valores escritos a mano. No inventes ni calcules ningún campo.
- Separador decimal en los formularios: apóstrofe (') o coma. Conviértelo siempre a coma \
(ej: 2'10 → "2,10", 4'56 → "4,56", 9'5 → "9,5").
- Normaliza las fechas al formato dd-mm-aaaa.
- Si una celda está vacía o ilegible devuelve null.
- Devuelve SOLO JSON válido, sin texto adicional.`

// ── Prompts por tipo ───────────────────────────────────────────────────────────

function promptDensidad(): string {
  return `Extrae los datos del formulario DENSIDAD "IN SITU" (CF-DENSIS).

El formulario tiene:
- Cabecera (a veces aparece en el margen o en una hoja de albarán adjunta): Orden de trabajo, \
Capa, Nº Lote, Localización/PK, Fecha de ensayo.
- Tabla principal con columnas: Nº Lote | REFERENCIA | LABORATORIO (Densidad Máxima / Humedad Óptima) \
| OBRA (Densidad / Humedad) | %Compactación | OBSERVACIONES.

IMPORTANTE:
- En LABORATORIO, el mismo valor de Densidad Máxima y Humedad Óptima puede aparecer \
una sola vez y aplicarse a varias filas. Si es así, repite ese valor en cada fila de la tabla.
- NO extraigas el campo %Compactación (lo calcula la aplicación automáticamente).
- Incluye solo las filas que tengan al menos un valor escrito (omite filas completamente vacías).
- El campo "Nº Lote" puede aparecer en la primera columna o en la cabecera; si aparece en \
la cabecera úsalo en el campo cabecera.n_lote.

Devuelve este JSON exacto (sin campos extra):
{
  "cabecera": {
    "orden_trabajo": string | null,
    "capa": string | null,
    "n_lote": string | null,
    "localizacion": string | null,
    "fecha_ensayo": string | null
  },
  "ensayos": [
    {
      "referencia": string | null,
      "d_max": string | null,
      "h_opt": string | null,
      "d_situ": string | null,
      "h_situ": string | null,
      "observaciones": string | null
    }
  ]
}`
}

function promptAlbaran(): string {
  return `Extrae los datos del formulario "SOLICITUD, TOMA DE MUESTRA Y REGISTRO DE ENSAYO" (Albarán CYE).

El formulario incluye: número de ensayo/OT, fechas, datos de la obra, datos del cliente, \
tipo de toma de muestra (checkboxes), descripción del material, localización, \
cantidad de muestra, ensayos solicitados con su normativa.

Para los checkboxes (marcados con ✓ o X o un trazo), devuelve true si está marcado, false si no, \
null si no puedes determinarlo.

Devuelve este JSON exacto (sin campos extra):
{
  "n_ensayo_ot": string | null,
  "fecha_toma": string | null,
  "fecha_entrada": string | null,
  "titulo_obra": string | null,
  "ref_obra": string | null,
  "empresa": string | null,
  "direccion": string | null,
  "nif_cif": string | null,
  "persona_contacto": string | null,
  "telefono_fax": string | null,
  "observaciones_cliente": string | null,
  "peticionario": string | null,
  "efectuada_por_cye": boolean | null,
  "recibida_en_cye": boolean | null,
  "ensayo_in_situ": boolean | null,
  "recogida_por_cye_en": string | null,
  "material_descripcion": string | null,
  "localizacion": string | null,
  "otros_datos": string | null,
  "cantidad_muestra": string | null,
  "ensayos_solicitados": [
    { "ensayo": string, "normativa": string }
  ]
}`
}

function promptGranulo(): string {
  return `Extrae los datos del formulario de GRANULOMETRÍA DE ESCOLLERA (CYE - Control y Estudios).

El formulario tiene:
- Cabecera con campos: OBRA, CLIENTE, MATERIAL, FECHA y un número de referencia de ensayo.
- Tabla con columnas: Nº PIEDRA | Masa Mi kg | LTA Masa Mi kg-Dimensiones | columnas de clasificación (<1,5 / ≥1,5<5 / ≥5<40 / ≥40<80 / ≥80).
- El formulario puede tener MÚLTIPLES PÁGINAS con el mismo formato (continúa la numeración).

INSTRUCCIONES:
- Extrae SOLO la columna "Masa Mi kg" de TODAS las páginas, en orden ascendente por Nº PIEDRA.
- Mantén la coma como separador decimal tal como aparece en el papel (19,4 → "19,4", no "19.4").
- Si algún valor usa apóstrofe como decimal (ej: 19'4), conviértelo a coma (→ "19,4").
- Ignora completamente las columnas de clasificación — son ceros calculados.
- Ignora la columna "LTA Masa Mi kg-Dimensiones" (notas dimensionales ocasionales).
- No incluyas filas vacías ni sin valor de masa.

Devuelve este JSON exacto (sin campos extra):
{
  "cabecera": {
    "material": string | null,
    "muestra": string | null,
    "localizacion": string | null,
    "fecha_ensayo": string | null
  },
  "masas": ["19,4", "10,60", "23,20", ...]
}`
}

function promptPlaca(): string {
  return `Extrae los datos del formulario PLACA DE CARGA (NLT-357/98).

El formulario tiene:
- Cabecera: Orden de trabajo, PK, Capa, Fecha de ensayo, Diámetro de placa (mm).
- Tablas de lecturas: Ciclo 1 (presiones 0 a 0,5 MPa), Descarga (0,25 a 0 MPa), \
Ciclo 2 (0,07 a 0,42 MPa). Cada fila tiene 3 lecturas de deformímetros (L1, L2, L3) en mm.

IMPORTANTE:
- Los valores de presión ya los sé; no los extraigas (son fijos del ensayo).
- Extrae solo las lecturas L1, L2, L3 de cada fila, en el mismo orden que aparecen en el papel.
- NO calcules Ev1, Ev2 ni el veredicto.

Devuelve este JSON exacto (ciclo1 tiene 8 filas, descarga 3, ciclo2 6):
{
  "cabecera": {
    "orden_trabajo": string | null,
    "pk": string | null,
    "capa": string | null,
    "fecha_ensayo": string | null,
    "diam_placa": string | null
  },
  "ciclo1":   [{"l1": string|null,"l2": string|null,"l3": string|null}, ...],
  "descarga": [{"l1": string|null,"l2": string|null,"l3": string|null}, ...],
  "ciclo2":   [{"l1": string|null,"l2": string|null,"l3": string|null}, ...]
}`
}

// ── Parsers y merge ────────────────────────────────────────────────────────────

/** Filtra filas de densidad donde todos los campos medibles son null */
function cleanDensidadRows(
  rows: DensidadOcrResult['ensayos']
): DensidadOcrResult['ensayos'] {
  return rows.filter(
    (r) => r.d_situ !== null || r.h_situ !== null || r.referencia !== null || r.d_max !== null
  )
}

/**
 * Convierte el resultado OCR de densidad al formato datos de la app.
 * Solo sobrescribe campos con valores no-null.
 */
export function mergeDensidadResult(
  current: Record<string, unknown>,
  ocr: DensidadOcrResult
): Record<string, unknown> {
  const cab = (current.cabecera as Record<string, string>) ?? {}
  const newCab = { ...cab }

  // Merge cabecera (solo no-null)
  const ocrCab = ocr.cabecera ?? {}
  for (const [k, v] of Object.entries(ocrCab)) {
    if (v !== null && v !== '') newCab[k] = v
  }

  // Rows: reemplazar con las extraídas (asignando n=i+1)
  const cleaned = cleanDensidadRows(ocr.ensayos ?? [])
  const newRows =
    cleaned.length > 0
      ? cleaned.map((r, i) => ({
          n: i + 1,
          referencia: r.referencia ?? '',
          d_max: r.d_max ?? '',
          h_opt: r.h_opt ?? '',
          d_situ: r.d_situ ?? '',
          h_situ: r.h_situ ?? '',
          observaciones: r.observaciones ?? ''
        }))
      : current.ensayos // sin datos → no tocar

  return { ...current, cabecera: newCab, ensayos: newRows }
}

export function mergeAlbaranResult(
  current: Record<string, unknown>,
  ocr: AlbaranOcrResult
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current }
  for (const [k, v] of Object.entries(ocr)) {
    if (v !== null && v !== undefined) merged[k] = v
  }
  return merged
}

export function mergePlacaResult(
  current: Record<string, unknown>,
  ocr: PlacaOcrResult
): Record<string, unknown> {
  const PRESIONES_C1 = [0.0, 0.07, 0.15, 0.21, 0.28, 0.35, 0.42, 0.5]
  const PRESIONES_D = [0.25, 0.125, 0.0]
  const PRESIONES_C2 = [0.07, 0.15, 0.21, 0.28, 0.35, 0.42]

  const injectPres = (
    rows: PlacaOcrResult['ciclo1'],
    presiones: number[]
  ): Record<string, unknown>[] =>
    presiones.map((p, i) => ({
      presion: p,
      l1: rows[i]?.l1 ?? '',
      l2: rows[i]?.l2 ?? '',
      l3: rows[i]?.l3 ?? ''
    }))

  const cab = (current.cabecera as Record<string, string>) ?? {}
  const newCab = { ...cab }
  for (const [k, v] of Object.entries(ocr.cabecera ?? {})) {
    if (v !== null && v !== '') newCab[k] = v
  }

  return {
    ...current,
    cabecera: newCab,
    ciclo1: injectPres(ocr.ciclo1 ?? [], PRESIONES_C1),
    descarga: injectPres(ocr.descarga ?? [], PRESIONES_D),
    ciclo2: injectPres(ocr.ciclo2 ?? [], PRESIONES_C2)
  }
}

export function mergeGranulometriaResult(
  current: Record<string, unknown>,
  ocr: GranulometriaOcrResult
): Record<string, unknown> {
  const cab = (current.cabecera as Record<string, string>) ?? {}
  const newCab = { ...cab }
  for (const [k, v] of Object.entries(ocr.cabecera ?? {})) {
    if (v !== null && v !== '') newCab[k] = v as string
  }
  const masas = (ocr.masas ?? []).filter((m) => m !== null && m !== '')
  return {
    ...current,
    cabecera: newCab,
    ...(masas.length > 0 ? { masas } : {})
  }
}

// ── Función pública ────────────────────────────────────────────────────────────

const SUPPORTED_TIPOS = new Set(['densidad_in_situ', 'albaran_ensayos', 'placa_carga', 'granulometria'])

/**
 * Extrae datos de un formulario de ensayo a partir de una imagen en base64.
 * Devuelve un objeto con los datos extraídos listos para mergear en `datos`.
 */
export async function scanEnsayo(
  tipo: string,
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<{ ocr: Record<string, unknown>; tipo: string }> {
  if (!SUPPORTED_TIPOS.has(tipo)) {
    throw new Error(`Tipo de ensayo "${tipo}" no soporta escaneo todavía`)
  }

  const gemini = new GeminiProvider()

  let prompt: string
  if (tipo === 'densidad_in_situ') prompt = promptDensidad()
  else if (tipo === 'albaran_ensayos') prompt = promptAlbaran()
  else if (tipo === 'granulometria') prompt = promptGranulo()
  else prompt = promptPlaca()

  let raw: string
  try {
    raw = await gemini.chatWithImage(SYSTEM, prompt, imageBase64, { mimeType, tag: `ocr:${tipo}` })
  } catch (e) {
    if (e instanceof LlmError) throw e
    throw new LlmError(`OCR fallido para ${tipo}`, 'gemini', e)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch {
    throw new Error(`Gemini devolvió JSON inválido:\n${raw.slice(0, 300)}`)
  }

  return { ocr: parsed, tipo }
}
