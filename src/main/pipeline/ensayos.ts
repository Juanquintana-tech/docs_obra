/**
 * Dominio de los informes de ensayo: especificaciones y motor de cálculo.
 *
 * Port de cye-demo/ensayos.py a TypeScript.
 *
 * Cada tipo de ensayo define:
 *   · metadatos (label, norma, título del informe)
 *   · una función compute_* que, a partir de los datos introducidos, calcula
 *     resultados derivados y el veredicto de cumplimiento.
 *
 * Normas de referencia:
 *   · Densidad y humedad in situ → ASTM D-6938 · PG-3 Art. 330.6.5.4
 *   · Carga con placa            → NLT-357/98
 */

// ── Catálogo de tipos de ensayo ──────────────────────────────────────────────

export interface TipoMeta {
  label: string
  norma: string
  tituloInforme: string
}

export const TIPOS: Record<string, TipoMeta> = {
  densidad_in_situ: {
    label: 'Densidad y humedad in situ',
    norma: 'ASTM D-6938 · PG-3 Art. 330.6.5.4',
    tituloInforme:
      'INFORME DE ENSAYO DE DENSIDAD Y HUMEDAD "IN SITU" (por isótopos radiactivos ASTM D-6938)'
  },
  placa_carga: {
    label: 'Ensayo de carga con placa',
    norma: 'NLT-357/98',
    tituloInforme: 'INFORME DE ENSAYO DE CARGA CON PLACA NLT-357/98'
  },
  granulometria: {
    label: 'Granulometría de escollera (5-40 kg)',
    norma: 'UNE EN 13383-2',
    tituloInforme: 'ARMOUR STONE QUALITY CONTROL TESTS — UNE EN 13383-2'
  },
  radon_trazas: {
    label: 'Concentración de radón (trazas CR-39)',
    norma: 'ISO 11665-4 · IS-47 CSN · PE-CYE-39',
    tituloInforme:
      'INFORME DE ENSAYO — INSTALACIÓN DE DETECTORES Y POSTERIOR MEDIDA DE LA CONCENTRACIÓN DE RADÓN EN AIRE INTERIOR'
  }
}

// ── Helpers numéricos ─────────────────────────────────────────────────────────

/** Parsea un valor como float, aceptando coma decimal española.
 *  Si contiene "/" (dos lecturas, ej. "0,80/0,81"), devuelve el mayor. */
export function toFloat(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).trim()
  if (s.includes('/')) {
    const parts = s.split('/').map((p) => parseFloat(p.trim().replace(',', '.')))
    const valid = parts.filter((n) => !isNaN(n))
    return valid.length ? Math.max(...valid) : null
  }
  const n = parseFloat(s.replace(',', '.'))
  return isNaN(n) ? null : n
}

function mean(xs: (number | null)[]): number {
  const valid = xs.filter((x): x is number => x !== null)
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0
}

function cvPct(xs: (number | null)[]): number {
  const valid = xs.filter((x): x is number => x !== null)
  const n = valid.length
  if (n < 2) return 0
  const m = mean(valid)
  if (m === 0) return 0
  const variance = valid.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)
  return (Math.sqrt(variance) / m) * 100
}

// ══════════════════════════════════════════════════════════════════════════════
// DENSIDAD Y HUMEDAD IN SITU  (ASTM D-6938 / PG-3 330.6.5.4)
// ══════════════════════════════════════════════════════════════════════════════

export const COMPACTACION_MIN_DEFAULT = 100.0 // % medio mínimo
export const MARGEN_DENSIDAD = 0.03 // g/cm³ por debajo de la densidad especificada

export interface DensidadRow {
  n: number
  referencia?: string
  d_max: number | null // g/cm³ Proctor (laboratorio)
  h_opt: number | null // % humedad óptima
  d_situ: number | null // g/cm³ medida en obra
  h_situ: number | null // % humedad in situ
  compactacion?: number | null // calculado: d_situ/d_max*100
  observaciones?: string
}

export interface DensidadInput {
  cabecera?: Record<string, string>
  ensayos: DensidadRow[]
  compactacion_min?: number
  correccion_densidad?: number | null
  correccion_humedad?: number | null
  cond3_cumple?: boolean | null
}

export interface DensidadResult {
  rows: (DensidadRow & { compactacion: number | null })[]
  media_d_situ: number
  media_h_situ: number
  media_compactacion: number
  cv_densidad: number
  cv_humedad: number
  compactacion_min: number
  d_min_admisible: number
  d_situ_minima: number
  cond1: boolean
  cond2: boolean
  cond3: boolean | null
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

export function computeDensidad(input: DensidadInput): DensidadResult {
  const compactacion_min = input.compactacion_min ?? COMPACTACION_MIN_DEFAULT
  const cond3_cumple = input.cond3_cumple ?? null
  const corr_d = toFloat(input.correccion_densidad) ?? 0
  const corr_h = toFloat(input.correccion_humedad) ?? 0

  const rows = (input.ensayos ?? []).map((r) => {
    const d_max = toFloat(r.d_max)
    const d_situ = toFloat(r.d_situ)
    const d_corr = d_situ !== null ? d_situ + corr_d : null
    const comp = d_max && d_corr ? Math.round((d_corr / d_max) * 1000) / 10 : null
    return {
      ...r,
      d_max,
      h_opt: toFloat(r.h_opt),
      d_situ,
      h_situ: toFloat(r.h_situ),
      compactacion: comp
    }
  })

  const d_situ_list = rows.map((r) => r.d_situ).filter((x): x is number => x !== null)
  const d_corr_list = d_situ_list.map((d) => d + corr_d)
  const h_situ_list = rows.map((r) => r.h_situ).filter((x): x is number => x !== null)
  const h_corr_list = h_situ_list.map((h) => h + corr_h)
  const comp_list = rows.map((r) => r.compactacion).filter((x): x is number => x !== null)
  const d_max_list = rows.map((r) => r.d_max).filter((x): x is number => x !== null)

  const media_d_situ = Math.round(mean(d_corr_list) * 1000) / 1000
  const media_h_situ = Math.round(mean(h_corr_list) * 10) / 10
  const media_comp = Math.round(mean(comp_list) * 10) / 10
  const cv_d = Math.round(cvPct(d_corr_list) * 10) / 10
  const cv_h = Math.round(cvPct(h_corr_list) * 10) / 10

  const d_especificada = d_max_list.length ? Math.max(...d_max_list) : 0
  const d_min_admisible = d_especificada
    ? Math.round((d_especificada - MARGEN_DENSIDAD) * 1000) / 1000
    : 0
  const d_situ_minima = d_corr_list.length ? Math.round(Math.min(...d_corr_list) * 1000) / 1000 : 0

  const cond1 = comp_list.length ? media_comp >= compactacion_min : false
  const cond2 = d_corr_list.length ? d_situ_minima >= d_min_admisible : false

  let cumple = cond1 && cond2
  if (cond3_cumple === false) cumple = false

  return {
    rows,
    media_d_situ,
    media_h_situ,
    media_compactacion: media_comp,
    cv_densidad: cv_d,
    cv_humedad: cv_h,
    compactacion_min,
    d_min_admisible,
    d_situ_minima,
    cond1,
    cond2,
    cond3: cond3_cumple,
    veredicto: comp_list.length ? (cumple ? 'CUMPLE' : 'NO CUMPLE') : ''
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CARGA CON PLACA  (NLT-357/98)
// ══════════════════════════════════════════════════════════════════════════════

export const PLACA_RADIO_MM = 150.0 // placa Ø300 mm
export const PLACA_DELTA_P = 0.2 // MPa (0,35 − 0,15)
export const PLACA_RATIO_MAX_DEFAULT = 2.2 // Ev2/Ev1 admisible

/** Escalones de presión por defecto (MPa) */
export const PLACA_CICLO1 = [0.0, 0.07, 0.15, 0.21, 0.28, 0.35, 0.42, 0.5]
export const PLACA_DESCARGA = [0.25, 0.125, 0.0]
export const PLACA_CICLO2 = [0.07, 0.15, 0.21, 0.28, 0.35, 0.42]

export interface PlacaFila {
  presion: number | null
  l1: number | null
  l2: number | null
  l3: number | null
  asiento_medio?: number | null
}

export interface PlacaInput {
  cabecera?: Record<string, string>
  ciclo1: PlacaFila[]
  descarga?: PlacaFila[]
  ciclo2: PlacaFila[]
  ratio_max?: number
  radio_mm?: number
}

export interface PlacaResult {
  ciclo1: (PlacaFila & { asiento_medio: number | null })[]
  descarga: (PlacaFila & { asiento_medio: number | null })[]
  ciclo2: (PlacaFila & { asiento_medio: number | null })[]
  ev1: number | null
  ev2: number | null
  ratio: number | null
  ratio_max: number
  radio_mm: number
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

function asientoMedio(l1: unknown, l2: unknown, l3: unknown): number | null {
  const vals = [toFloat(l1), toFloat(l2), toFloat(l3)].filter((v): v is number => v !== null)
  // Sin redondeo: se conserva la precisión completa para el cálculo de Ev
  // (igual que AVERAGE() en Excel sin ROUND). El formato visual queda a cargo de fmt().
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

/**
 * Fórmula NLT-357/98: Ev = ROUND(1.5 × r × Δp / Δs, 0)
 * donde r = PLACA_RADIO_MM, Δp = PLACA_DELTA_P (constante de calibración), Δs en mm.
 */
function calcEv(
  s_max: number | null,
  s_min: number | null,
  radio_mm: number,
  delta_p: number
): number | null {
  if (s_max === null || s_min === null) return null
  const ds = s_max - s_min
  if (ds <= 0) return null
  return Math.round((1.5 * radio_mm * delta_p) / ds)
}

function asientoEn(
  filas: (PlacaFila & { asiento_medio: number | null })[],
  presionObj: number
): number | null {
  for (const r of filas) {
    if (r.presion !== null && Math.abs(r.presion - presionObj) < 1e-6) return r.asiento_medio
  }
  return null
}

/**
 * Calcula Ev sobre un ciclo de forma dinámica:
 * 1) Puntos de referencia CYE (plantilla real): 0.175 y 0.075 MPa.
 * 2) Puntos estándar NLT tradicionales: 0.35 y 0.15 MPa.
 * 3) Fallback: primer y último punto del ciclo con fórmula (π/2)·r·Δp/Δs.
 *
 * roundHigh: true para ciclo2 (plantilla usa ROUND(AVERAGE,2) en la fila 0.175 MPa),
 *            false para ciclo1 (plantilla usa AVERAGE sin redondear en esa fila).
 */
function calcEvCiclo(
  filas: (PlacaFila & { asiento_medio: number | null })[],
  radio_mm: number,
  roundHigh = false
): number | null {
  // 1. Referencia CYE (fórmula Excel del lab: ROUND(1.5*150*0.2/(s175-s075),0))
  const s175raw = asientoEn(filas, 0.175)
  const s075raw = asientoEn(filas, 0.075)
  if (s175raw !== null && s075raw !== null) {
    const s175 = roundHigh ? Math.round(s175raw * 100) / 100 : s175raw
    const s075 = Math.round(s075raw * 100) / 100 // siempre redondeado (ROUND en plantilla)
    return calcEv(s175, s075, radio_mm, PLACA_DELTA_P)
  }

  // 2. Referencia NLT estándar (0.35 y 0.15 MPa)
  const s35 = asientoEn(filas, 0.35)
  const s15 = asientoEn(filas, 0.15)
  if (s35 !== null && s15 !== null) {
    return calcEv(s35, s15, radio_mm, PLACA_DELTA_P)
  }

  // 3. Fallback: rango completo del ciclo
  const validos = filas.filter((r) => r.presion !== null && r.asiento_medio !== null)
  if (validos.length < 2) return null
  const first = validos[0]
  const last = validos[validos.length - 1]
  const dp = last.presion! - first.presion!
  const ds = last.asiento_medio! - first.asiento_medio!
  if (dp <= 0 || ds <= 0) return null
  return Math.round(((Math.PI / 2) * radio_mm * dp) / ds)
}

export function computePlaca(input: PlacaInput): PlacaResult {
  const ratio_max = input.ratio_max ?? PLACA_RATIO_MAX_DEFAULT
  const radio_mm = input.radio_mm ?? PLACA_RADIO_MM

  function withMedias(filas: PlacaFila[]): (PlacaFila & { asiento_medio: number | null })[] {
    return filas.map((r) => ({
      presion: toFloat(r.presion),
      l1: toFloat(r.l1),
      l2: toFloat(r.l2),
      l3: toFloat(r.l3),
      asiento_medio: asientoMedio(r.l1, r.l2, r.l3)
    }))
  }

  const c1 = withMedias(input.ciclo1 ?? [])
  const desc = withMedias(input.descarga ?? [])
  const c2 = withMedias(input.ciclo2 ?? [])

  const ev1 = calcEvCiclo(c1, radio_mm, false) // c1: E37 usa AVERAGE (sin redondeo en high)
  const ev2 = calcEvCiclo(c2, radio_mm, true) // c2: E49 usa ROUND(AVERAGE,2) en high
  const ratio = ev1 && ev2 && ev1 > 0 ? Math.round((ev2 / ev1) * 10) / 10 : null

  // Criterio Ev2/Ev1 ≤ 2.2 desactivado temporalmente
  return {
    ciclo1: c1,
    descarga: desc,
    ciclo2: c2,
    ev1,
    ev2,
    ratio,
    ratio_max,
    radio_mm,
    veredicto: ''
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// GRANULOMETRÍA DE ESCOLLERA  (UNE EN 13383-2) — clase 5-40 kg
// ══════════════════════════════════════════════════════════════════════════════

/** Especificación de la clase 5-40 kg (% acumulado por masa y límites de resumen). */
export const GRANULO_SPEC_5_40 = {
  ell: [0, 2], // % < 1,5 kg
  nll: [0, 10], // % < 5 kg
  nul: [70, 100], // % < 40 kg
  eul: [97, 100], // % < 80 kg
  mem: [10, 20], // masa media (kg)
  lt_max: 20, // % LT (L/E > 3)
  p45_max: 3 // % partículas con L > 45 cm
} as const

export interface GranulometriaInput {
  cabecera?: Record<string, string>
  masas: (number | string)[] // masa Mi (kg) de cada piedra
  fragmentos_masa?: number | string | null // masa total de fragmentos < 1,5 kg
  m50?: number | string | null // manual: masa al 50 % (kg)
  lt_pct?: number | string | null // manual: % LT (L/E > 3)
  particulas_45?: number | string | null // manual: nº de piedras con L > 45 cm
}

export interface GranulometriaResult {
  n: number
  masa_total: number
  ell: number
  nll: number
  nul: number
  eul: number
  mem: number
  m50: number | null
  lt_pct: number | null
  p45_pct: number | null
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

const between = (v: number, [lo, hi]: readonly [number, number] | number[]): boolean =>
  v >= lo && v <= hi

/** Normaliza la lista de masas: admite array (lista de filas) o texto (una por línea/coma). */
export function parseMasasList(raw: unknown): number[] {
  const items = Array.isArray(raw) ? raw : String(raw ?? '').split(/[\s,;\n]+/)
  return items.map(toFloat).filter((m): m is number => m !== null)
}

// ══════════════════════════════════════════════════════════════════════════════
// CONCENTRACIÓN DE RADÓN EN AIRE INTERIOR  (ISO 11665-4 / IS-47 CSN / PE-CYE-39)
// ══════════════════════════════════════════════════════════════════════════════

export interface RadonMetadata {
  fecha_inicio?: string
  fecha_fin?: string
  duracion_dias?: number | null
  fecha_procesado_inicio?: string
  fecha_procesado_fin?: string
  error_fabricante_pct?: number
  umbral_decision?: number    // Bq/m³
  limite_deteccion?: number   // Bq/m³
  nivel_referencia?: number   // Bq/m³ (por defecto 300, Art. 72 RD 1029/2022)
  instalacion_cye?: boolean
  norma?: string
}

export interface RadonLote {
  id: string
  fecha_inicio: string
  fecha_fin: string
  duracion_dias: number | null
}

export interface RadonDetector {
  n: number
  codigo: string
  lote?: string
  edificio?: string
  planta?: string
  ubicacion?: string
  extraviado?: boolean
  saturado?: boolean       // exposición > rango del equipo; RAC real desconocida pero >1.000 Bq/m³
  exposicion?: number | null   // kBq·h/m²
  u_exposicion?: number | null // incertidumbre expandida k=2
  rac?: number | null          // Bq/m³
  u_rac?: number | null        // incertidumbre expandida k=2
  plano_id?: string
  foto_path?: string | null
}

export interface RadonInput {
  metadata?: RadonMetadata
  lotes?: RadonLote[]
  detectores?: RadonDetector[]
}

export interface RadonResult {
  n_total: number
  n_extraviados: number
  n_saturados: number
  n_validos: number
  n_exceden: number
  rac_min: number | null
  rac_max: number | null
  rac_media: number | null
  nivel_referencia: number
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

export function computeRadon(input: RadonInput): RadonResult {
  const nivel = input.metadata?.nivel_referencia ?? 300
  const detectores = input.detectores ?? []

  const n_total = detectores.length
  const extraviados = detectores.filter((d) => d.extraviado)
  const saturados = detectores.filter((d) => !d.extraviado && d.saturado)
  const validos = detectores.filter(
    (d) => !d.extraviado && !d.saturado && d.rac !== null && d.rac !== undefined
  )

  const racs = validos
    .map((d) => (typeof d.rac === 'number' ? d.rac : null))
    .filter((r): r is number => r !== null)
  const n_exceden = racs.filter((r) => r > nivel).length + saturados.length

  const rac_min = racs.length ? Math.min(...racs) : null
  const rac_max = racs.length ? Math.max(...racs) : null
  const rac_media = racs.length
    ? Math.round(racs.reduce((a, b) => a + b, 0) / racs.length)
    : null

  let veredicto: 'CUMPLE' | 'NO CUMPLE' | '' = ''
  if (validos.length > 0 || saturados.length > 0) {
    veredicto = n_exceden > 0 ? 'NO CUMPLE' : 'CUMPLE'
  }

  return {
    n_total,
    n_extraviados: extraviados.length,
    n_saturados: saturados.length,
    n_validos: validos.length,
    n_exceden,
    rac_min,
    rac_max,
    rac_media,
    nivel_referencia: nivel,
    veredicto
  }
}

export interface RadonContinuoEquipo {
  tipo: 'SARAD' | 'AlphaGUARD' | 'RAD7' | 'Otro'
  modelo?: string
  numero_serie?: string
  n_certificado?: string
  fecha_calibracion?: string
  factor_calibracion?: number  // C0 en Bq/m³ (offset de calibración del equipo)
}

export interface RadonContinuoInput {
  equipo?: RadonContinuoEquipo
  edificio?: string
  planta?: string
  ubicacion?: string
  fecha_inicio?: string
  hora_inicio?: string
  fecha_fin?: string
  hora_fin?: string
  duracion_horas?: number | null
  intervalo_min?: number        // intervalo de medida en minutos (10=AlphaGUARD, 60=SARAD/RAD7)
  n_medidas?: number | null     // nº de puntos de medida
  rac_media?: number | null     // Bq/m³ — resultado principal
  rac_max?: number | null       // Bq/m³
  rac_min?: number | null       // Bq/m³
  u_rac?: number | null         // incertidumbre expandida k=2 en Bq/m³
  umbral_decision?: number      // DT en Bq/m³ (default 10)
  limite_deteccion?: number     // LLD en Bq/m³ (default 20)
  nivel_referencia?: number     // 300 Bq/m³ Art. 72 RD 1029/2022
  norma?: string
  temperatura_media?: number | null
  humedad_media?: number | null
  presion_media?: number | null
  observaciones?: string
}

export interface RadonContinuoResult {
  rac_media: number | null
  rac_max: number | null
  rac_min: number | null
  nivel_referencia: number
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

export function computeRadonContinuo(input: RadonContinuoInput): RadonContinuoResult {
  const nivel = input.nivel_referencia ?? 300
  const rac_media = input.rac_media ?? null
  const rac_max = input.rac_max ?? null
  const rac_min = input.rac_min ?? null

  let veredicto: 'CUMPLE' | 'NO CUMPLE' | '' = ''
  if (rac_media !== null) {
    veredicto = rac_media > nivel ? 'NO CUMPLE' : 'CUMPLE'
  }

  return { rac_media, rac_max, rac_min, nivel_referencia: nivel, veredicto }
}

export function computeGranulometria(input: GranulometriaInput): GranulometriaResult {
  const sp = GRANULO_SPEC_5_40
  const masas = parseMasasList(input.masas)
  const frag = toFloat(input.fragmentos_masa ?? null) ?? 0
  const n = masas.length

  const sumIn = (lo: number, hi: number): number =>
    masas.filter((m) => m >= lo && m < hi).reduce((a, b) => a + b, 0)
  const sumD = sumIn(1.5, 5)
  const sumE = sumIn(5, 40)
  const sumF = sumIn(40, 80)
  const total = masas.reduce((a, b) => a + b, 0) + frag

  const pct = (cum: number): number => (total > 0 ? Math.round((cum / total) * 1000) / 10 : 0)
  const ell = pct(frag)
  const nll = pct(frag + sumD)
  const nul = pct(frag + sumD + sumE)
  const eul = pct(frag + sumD + sumE + sumF)
  const mem = n ? Math.round((masas.reduce((a, b) => a + b, 0) / n) * 10) / 10 : 0

  const m50 = toFloat(input.m50 ?? null)
  const lt = toFloat(input.lt_pct ?? null)
  const p45n = toFloat(input.particulas_45 ?? null)
  const p45 = p45n !== null && n > 0 ? Math.round((p45n / n) * 1000) / 10 : null

  let veredicto: 'CUMPLE' | 'NO CUMPLE' | '' = ''
  if (n > 0 && total > 0) {
    const ok =
      between(ell, sp.ell) &&
      between(nll, sp.nll) &&
      between(nul, sp.nul) &&
      between(eul, sp.eul) &&
      between(mem, sp.mem) &&
      (lt === null || lt <= sp.lt_max) &&
      (p45 === null || p45 <= sp.p45_max)
    veredicto = ok ? 'CUMPLE' : 'NO CUMPLE'
  }

  return {
    n,
    masa_total: Math.round(total * 10) / 10,
    ell,
    nll,
    nul,
    eul,
    mem,
    m50,
    lt_pct: lt,
    p45_pct: p45,
    veredicto
  }
}
