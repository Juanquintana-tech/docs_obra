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
  fragmentos_masa: string | null // masa total de fragmentos < 1,5 kg (al pie del formulario)
}

export interface TomaHormigonOcrResult {
  identificacion: {
    n_albaran_cye: string | null
    obra: string | null
    nte_cliente: string | null
    ref_obra: string | null
    n_trabajo: string | null
    n_ensayo_obra: string | null
    tipo_hormigon: string | null
    tipo_muestreo: string | null
    tipo_compactacion: string | null
    fecha_toma: string | null
    hora_toma: string | null
    confeccionado_por: string | null
    fecha_recogida: string | null
    hora_recogida: string | null
  }
  camion: {
    descripcion_elemento: string | null
    central: string | null
    matricula: string | null
    volumen_m3: string | null
    albaran_central: string | null
    hora_salida: string | null
    hora_llegada: string | null
    t_max_arido: string | null
  }
  conos: Array<{
    numero: number
    mm: string | null
    tiempo_s: string | null
    observaciones: string | null
  }>
  asentamiento_media: string | null
  limite_uso: string | null
  composicion: {
    tipo_cemento: string | null
    aditivo: string | null
    contenido_cemento_m3: string | null
    relacion_ac: string | null
    t_amb: string | null
    t_hormigon: string | null
    humedad_pct: string | null
  }
  probetas: {
    cantidad: string | null
    tipo: string | null
    por_cye: boolean | null
    fecha_recogida: string | null
    hora_recogida: string | null
  }
  roturas: Array<{
    n_probeta: string | null
    fecha_rotura: string | null
    edad_dias: string | null
    carga_maxima_kn: string | null
    tension_mpa: string | null
  }>
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
}
Añade también "_conf" al nivel raíz: objeto plano con la confianza de cada campo escalar que hayas \
extraído (usa punto para anidados, ej: "cabecera.orden_trabajo"). Valores: "high" = claramente \
legible, "mid" = con dudas, "low" = ilegible o estimado.`
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
}
Añade también "_conf" al nivel raíz: objeto plano con la confianza de cada campo escalar extraído \
(notación punto para anidados). Valores: "high" = claramente legible, "mid" = con dudas, \
"low" = ilegible o estimado.`
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
- Al pie del formulario (última página) puede aparecer una fila con "Fragment" o "Fragmento" o \
"Masa de fragmentos < 1,5 kg" o similar: extrae ese valor numérico en "fragmentos_masa". \
NO lo pongas en "masas" ni en "muestra".

Devuelve este JSON exacto (sin campos extra):
{
  "cabecera": {
    "material": string | null,
    "muestra": string | null,
    "localizacion": string | null,
    "fecha_ensayo": string | null
  },
  "masas": ["19,4", "10,60", "23,20", ...],
  "fragmentos_masa": string | null
}
Añade también "_conf" al nivel raíz: objeto plano con la confianza de cada campo escalar extraído \
(notación punto para anidados). Valores: "high" = claramente legible, "mid" = con dudas, \
"low" = ilegible o estimado.`
}

function promptAlbaranPlanta(): string {
  return `Extrae los datos de un ALBARÁN DE ENTREGA de central hormigonera (puede ser de Hormigones Laracha, \
Votorantim, Cementos Cosmos u otro proveedor). Los formatos varían entre plantas pero los campos clave son siempre similares.

Campos a extraer:
- n_albaran_planta: Número de albarán de entrega (número impreso en el albarán).
- n_serie: Número de serie lateral o folio (si es distinto del n_albaran_planta).
- fecha: Fecha del albarán (dd-mm-aaaa).
- planta: Nombre de la planta o central hormigonera.
- cliente: Nombre del cliente indicado en el albarán.
- obra: Nombre/descripción de la obra de destino.
- matricula: Matrícula del camión hormigonera.
- transportista: Nombre de la empresa transportista.
- m3_entregados: Metros cúbicos de hormigón entregados (M³).
- tipo_hormigon: Designación completa del hormigón (ej: "HA-25/B/20/IIa").
- elemento_hormigonado: Elemento estructural hormigonado (pilotes, zapatas, muros…).
- hora_carga: Hora de carga en planta / salida de planta (hh:mm).
- hora_llegada: Hora de llegada a obra (hh:mm).
- hora_inicio_descarga: Hora de inicio de descarga (hh:mm).
- hora_salida_obra: Hora de salida de obra (hh:mm).
- tiempo_limite_uso: Tiempo límite de uso del hormigón (ej: "90 min", "1h30").
- cemento_tipo: Tipo y marca del cemento (ej: "Tudela Veguín (V-L) 42,5 R").
- cemento_kg_m3: Dosificación de cemento en kg/m³.
- relacion_ac: Relación agua/cemento (número decimal, ej: "0,37").
- tolerancia_ac: Tolerancia de la relación a/c (ej: "0,02").
- aditivos: Aditivos utilizados y sus dosis (texto libre, incluye nombre y cantidad).
- adiciones: Adiciones (humo de sílice, cenizas volantes, etc.) y procedencia.
- t_hormigon: Temperatura del hormigón en °C (si aparece).
- cono_mm: Asentamiento del cono Abrams en mm (si aparece en la sección de recepción).
- observaciones: Observaciones o notas adicionales.

IMPORTANTE:
- Normaliza fechas a dd-mm-aaaa. Normaliza apóstrofes decimales a coma.
- Si un campo no aparece o es ilegible, devuelve null. NO inventes valores.
- Los campos de hora usa formato hh:mm.

Devuelve EXACTAMENTE este JSON (sin campos extra):
{
  "n_albaran_planta": string | null,
  "n_serie": string | null,
  "fecha": string | null,
  "planta": string | null,
  "cliente": string | null,
  "obra": string | null,
  "matricula": string | null,
  "transportista": string | null,
  "m3_entregados": string | null,
  "tipo_hormigon": string | null,
  "elemento_hormigonado": string | null,
  "hora_carga": string | null,
  "hora_llegada": string | null,
  "hora_inicio_descarga": string | null,
  "hora_salida_obra": string | null,
  "tiempo_limite_uso": string | null,
  "cemento_tipo": string | null,
  "cemento_kg_m3": string | null,
  "relacion_ac": string | null,
  "tolerancia_ac": string | null,
  "aditivos": string | null,
  "adiciones": string | null,
  "t_hormigon": string | null,
  "cono_mm": string | null,
  "observaciones": string | null
}
Añade también "_conf" al nivel raíz: objeto plano con la confianza de cada campo escalar extraído. \
Valores: "high" = claramente legible, "mid" = con dudas, "low" = ilegible o estimado.`
}

function promptTomaHormigon(): string {
  return `Extrae los datos del formulario CYE de TOMA DE HORMIGÓN Y CONFECCIÓN DE PROBETAS.

El formulario tiene varias secciones:
1. IDENTIFICACIÓN: Nº Albarán CYE, Obra, NTE/Cliente, Ref. Obra, Nº Trabajo, Nº Ensayo Obra, \
Tipo Hormigón (ej: HA-35/F20/XC2), Tipo Muestreo, Tipo Compactación, \
Fecha toma, Hora toma, Confeccionado por, Fecha y Hora recogida.
2. DATOS DEL CAMIÓN: Descripción elemento, Central/Proveedor, Matrícula, Volumen (m³), \
Albarán central, Hora salida, Hora llegada, T.Máx.Árido (mm).
3. ENSAYO ASENTAMIENTO (conos): 2 filas (Cono 1 y Cono 2) con Asentamiento (mm), \
Tiempo (s) y Observaciones. Media final del asentamiento (mm). Límite de uso (h).
4. COMPOSICIÓN: Tipo cemento, Aditivo(s), Contenido cemento kg/m³, Relación a/c, \
Tª ambiente (°C), Tª hormigón (°C), % Humedad.
5. PROBETAS: Nº por tipo (Cilíndricas, Prismáticas, Cúbicas), Total, Tipo/dimensiones \
(ej: "Cilíndricas 150×300mm"), Por CYE (sí/no), Fecha y Hora de recogida en laboratorio.
6. CONSERVACIÓN: Conservación ambiental en obra (SI/NO). Tipo de traslado al laboratorio.
7. ROTURAS (si aparece tabla de resultados): n_probeta, fecha_rotura, edad_dias (7 o 28), \
carga_maxima_kn (kN), tension_mpa (MPa). Puede que esta tabla no aparezca en el albarán de campo.

IMPORTANTE:
- Normaliza fechas a dd-mm-aaaa. Normaliza apóstrofes decimales a coma (ej: 0'40 → "0,40").
- Si una sección o campo no aparece en el formulario, devuelve null (NO inventes valores).
- Para "roturas": si la tabla de resultados no está, devuelve [] (array vacío).
- Si "Por CYE" está marcado devuelve true, si no false.
- Para "conservacion_ambiental": true si SÍ, false si NO, null si no aparece.

Devuelve este JSON exacto (sin campos extra):
{
  "identificacion": {
    "n_albaran_cye": string | null, "obra": string | null, "nte_cliente": string | null,
    "ref_obra": string | null, "n_trabajo": string | null, "n_ensayo_obra": string | null,
    "tipo_hormigon": string | null, "tipo_muestreo": string | null, "tipo_compactacion": string | null,
    "fecha_toma": string | null, "hora_toma": string | null, "confeccionado_por": string | null,
    "fecha_recogida": string | null, "hora_recogida": string | null
  },
  "camion": {
    "descripcion_elemento": string | null, "central": string | null, "matricula": string | null,
    "volumen_m3": string | null, "albaran_central": string | null,
    "hora_salida": string | null, "hora_llegada": string | null, "t_max_arido": string | null
  },
  "conos": [
    { "numero": 1, "mm": string | null, "tiempo_s": string | null, "observaciones": string | null },
    { "numero": 2, "mm": string | null, "tiempo_s": string | null, "observaciones": string | null }
  ],
  "asentamiento_media": string | null,
  "limite_uso": string | null,
  "composicion": {
    "tipo_cemento": string | null, "aditivo": string | null, "contenido_cemento_m3": string | null,
    "relacion_ac": string | null, "t_amb": string | null, "t_hormigon": string | null, "humedad_pct": string | null
  },
  "probetas": {
    "cantidad": string | null, "n_cilindricas": string | null, "n_prismaticas": string | null,
    "n_cubicas": string | null, "tipo": string | null, "por_cye": boolean | null,
    "fecha_recogida": string | null, "hora_recogida": string | null
  },
  "conservacion_ambiental": boolean | null,
  "tipo_traslado": string | null,
  "roturas": [
    { "n_probeta": string | null, "fecha_rotura": string | null, "edad_dias": string | null, "carga_maxima_kn": string | null, "tension_mpa": string | null }
  ]
}
Añade también "_conf" al nivel raíz: objeto plano con la confianza de cada campo escalar extraído \
(usa notación punto para anidados, ej: "identificacion.n_albaran_cye", "camion.central", \
"composicion.relacion_ac"). Valores: "high" = claramente legible, "mid" = con dudas, \
"low" = ilegible o estimado. Omite arrays (conos, roturas).`
}

function promptPlaca(): string {
  return `Extrae los datos del formulario PLACA DE CARGA (NLT-357/98).

El formulario tiene:
- Cabecera: Orden de trabajo (O.T.), PK/localización, Capa, Fecha de ensayo, Diámetro de placa (mm).
- Tablas de lecturas: Ciclo 1 (presiones 0 a 0,5 MPa, 8 filas), Descarga (0,25 a 0 MPa, 3 filas), \
Ciclo 2 (0,07 a 0,42 MPa, 6 filas). Cada fila tiene 3 columnas de flexímetros (L1, L2, L3) en mm.

IMPORTANTE:
- Los valores de presión son fijos y ya los conozco; no los extraigas.
- Extrae solo L1, L2, L3 de cada fila, en el mismo orden que aparecen en el papel.
- Cada celda puede contener DOS lecturas separadas por "/" (ej: "0'11/0'11", "1'39/1'40"). \
  En ese caso escribe SOLO el mayor de los dos valores, convirtiendo el apóstrofe a coma \
  (ej: "0'11/0'11" → "0,11", "1'39/1'40" → "1,40", "0'80/0'81" → "0,81").
- Si la celda tiene una sola lectura, devuelve solo ese valor (ej: "1'64" → "1,64").
- NO calcules Ev1, Ev2, asiento medio ni el veredicto.
- Si una fila entera está vacía o ilegible, devuelve null en sus tres campos.

Devuelve EXACTAMENTE este JSON (ciclo1: 8 objetos, descarga: 3, ciclo2: 6):
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
}
Añade también "_conf" al nivel raíz: objeto plano con la confianza de cada campo escalar extraído \
(notación punto para anidados). Valores: "high" = claramente legible, "mid" = con dudas, \
"low" = ilegible o estimado. Omite los arrays de ciclos.`
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

/** Si el valor tiene formato "X/Y", devuelve el mayor como string con coma decimal.
 *  Si es un valor simple o null, lo devuelve normalizado (apóstrofe → coma). */
function maxLectura(v: string | null | undefined): string {
  if (!v) return ''
  const s = v.trim().replace(/'/g, ',')
  if (!s.includes('/')) return s
  const parts = s.split('/').map((p) => parseFloat(p.trim().replace(',', '.')))
  const valid = parts.filter((n) => !isNaN(n))
  if (!valid.length) return s
  const max = Math.max(...valid)
  // Conservar los mismos decimales que el valor original
  const decimals = Math.max(...parts.filter((n) => !isNaN(n)).map((n) => {
    const str = String(n)
    return str.includes('.') ? str.split('.')[1].length : 0
  }))
  return max.toFixed(decimals).replace('.', ',')
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
      l1: maxLectura(rows[i]?.l1),
      l2: maxLectura(rows[i]?.l2),
      l3: maxLectura(rows[i]?.l3)
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

const SUPPORTED_TIPOS = new Set(['densidad_in_situ', 'albaran_ensayos', 'placa_carga', 'granulometria', 'toma_hormigon', 'informe_hormigon', 'albaran_planta'])

/**
 * Extrae datos de un formulario de ensayo a partir de una imagen en base64.
 * Devuelve un objeto con los datos extraídos listos para mergear en `datos`.
 */
export async function scanEnsayo(
  tipo: string,
  imageBase64: string,
  mimeType: string = 'image/jpeg'
): Promise<{ ocr: Record<string, unknown>; tipo: string; conf: Record<string, string> }> {
  if (!SUPPORTED_TIPOS.has(tipo)) {
    throw new Error(`Tipo de ensayo "${tipo}" no soporta escaneo todavía`)
  }

  const gemini = new GeminiProvider()

  let prompt: string
  if (tipo === 'densidad_in_situ') prompt = promptDensidad()
  else if (tipo === 'albaran_ensayos') prompt = promptAlbaran()
  else if (tipo === 'granulometria') prompt = promptGranulo()
  else if (tipo === 'toma_hormigon' || tipo === 'informe_hormigon') prompt = promptTomaHormigon()
  else if (tipo === 'albaran_planta') prompt = promptAlbaranPlanta()
  else prompt = promptPlaca()

  let raw: string
  try {
    // Granulometría y placa son los más voluminosos; el resto usa 8192 como mínimo seguro
    const maxTokens = tipo === 'granulometria' || tipo === 'placa_carga' ? 16384 : 8192
    raw = await gemini.chatWithImage(SYSTEM, prompt, imageBase64, { mimeType, tag: `ocr:${tipo}`, maxTokens })
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

  const conf = (parsed._conf as Record<string, string> | undefined) ?? {}
  delete parsed._conf
  return { ocr: parsed, tipo, conf }
}
