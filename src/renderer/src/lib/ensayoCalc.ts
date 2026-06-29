/**
 * Cálculo de veredictos de ensayo en el renderer — ESPEJO FIEL de
 * src/main/pipeline/ensayos.ts (computeDensidad / computePlaca).
 *
 * Se mantiene aquí una copia (y no se importa el módulo de main) para no cruzar
 * la frontera main/renderer, pero replica EXACTAMENTE los redondeos del backend
 * para que el veredicto mostrado en vivo coincida con el del informe generado.
 *
 * Único punto de cálculo del renderer: lo usan el badge en vivo, la tabla de
 * condiciones de densidad y la tabla de módulos de placa.
 */

/** Parsea aceptando coma decimal española.
 *  Si contiene "/" (dos lecturas, ej. "0,80/0,81"), devuelve el mayor. */
export function toNum(v: unknown): number | null {
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

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0
}

// ── Densidad y humedad in situ (ASTM D-6938 / PG-3 330.6.5.4) ─────────────────

const MARGEN_DENSIDAD = 0.03 // g/cm³

export interface DensidadSummary {
  mediaComp: number
  dMinAdm: number
  dSituMin: number
  compMin: number
  cond1: boolean
  cond2: boolean
  cond3: boolean | null
  veredicto: 'CUMPLE' | 'NO CUMPLE'
}

/** Resumen de cumplimiento de densidad, o null si no hay puntos de compactación. */
export function densidadSummary(datos: Record<string, unknown>): DensidadSummary | null {
  const rows = (datos.ensayos as Record<string, unknown>[] | undefined) ?? []
  const compMin = toNum(datos.compactacion_min) ?? 100

  const corrD = toNum(datos.correccion_densidad) ?? 0
  const comps: number[] = []
  const dMaxList: number[] = []
  const dCorrList: number[] = []
  for (const r of rows) {
    const dm = toNum(r.d_max)
    const ds = toNum(r.d_situ)
    if (dm !== null) dMaxList.push(dm)
    if (ds !== null) dCorrList.push(ds + corrD)
    if (dm && ds) comps.push(Math.round(((ds + corrD) / dm) * 1000) / 10) // 1 decimal, como backend
  }
  if (!comps.length) return null

  const mediaComp = Math.round(mean(comps) * 10) / 10
  const dEspec = dMaxList.length ? Math.max(...dMaxList) : 0
  const dMinAdm = dEspec ? Math.round((dEspec - MARGEN_DENSIDAD) * 1000) / 1000 : 0
  const dSituMin = dCorrList.length ? Math.round(Math.min(...dCorrList) * 1000) / 1000 : 0
  const cond1 = mediaComp >= compMin
  const cond2 = dCorrList.length ? dSituMin >= dMinAdm : false
  const cond3 = (datos.cond3_cumple as boolean | null | undefined) ?? null

  let cumple = cond1 && cond2
  if (cond3 === false) cumple = false

  return {
    mediaComp,
    dMinAdm,
    dSituMin,
    compMin,
    cond1,
    cond2,
    cond3,
    veredicto: cumple ? 'CUMPLE' : 'NO CUMPLE'
  }
}

// ── Carga con placa (NLT-357/98) ──────────────────────────────────────────────

const PLACA_DELTA_P = 0.2 // MPa
const PLACA_RADIO_MM = 150
const PLACA_RATIO_MAX = 2.2

type Fila = Record<string, unknown>

/** Asiento medio (sin redondear, como AVERAGE de la plantilla). */
export function asientoMedio(r: Fila): number | null {
  const vals = ['l1', 'l2', 'l3'].map((k) => toNum(r[k])).filter((v): v is number => v !== null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
}

function asientoEn(filas: Fila[], p: number): number | null {
  const row = filas.find((r) => {
    const pr = toNum(r.presion)
    return pr !== null && Math.abs(pr - p) < 1e-6
  })
  return row ? asientoMedio(row) : null
}

function calcEv(sMax: number | null, sMin: number | null, radio: number): number | null {
  if (sMax === null || sMin === null) return null
  const ds = sMax - sMin
  if (ds <= 0) return null
  return Math.round((1.5 * radio * PLACA_DELTA_P) / ds)
}

/** Ev de un ciclo (mismo orden de preferencia que ensayos.ts: CYE 0.175/0.075 → NLT 0.35/0.15 → rango). */
function calcEvCiclo(filas: Fila[], radio: number, roundHigh: boolean): number | null {
  const s175raw = asientoEn(filas, 0.175)
  const s075raw = asientoEn(filas, 0.075)
  if (s175raw !== null && s075raw !== null) {
    const s175 = roundHigh ? Math.round(s175raw * 100) / 100 : s175raw
    const s075 = Math.round(s075raw * 100) / 100
    return calcEv(s175, s075, radio)
  }
  const s35 = asientoEn(filas, 0.35)
  const s15 = asientoEn(filas, 0.15)
  if (s35 !== null && s15 !== null) return calcEv(s35, s15, radio)

  const validos = filas.filter((r) => toNum(r.presion) !== null && asientoMedio(r) !== null)
  if (validos.length < 2) return null
  const first = validos[0]
  const last = validos[validos.length - 1]
  const dp = (toNum(last.presion) as number) - (toNum(first.presion) as number)
  const ds = (asientoMedio(last) as number) - (asientoMedio(first) as number)
  if (dp <= 0 || ds <= 0) return null
  return Math.round(((Math.PI / 2) * radio * dp) / ds)
}

export interface PlacaSummary {
  ev1: number | null
  ev2: number | null
  ratio: number | null
  ratioMax: number
  cumple: boolean | null
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

/** Resumen de módulos de compresibilidad y veredicto de placa de carga. */
export function placaSummary(datos: Record<string, unknown>): PlacaSummary {
  const radio = toNum(datos.radio_mm) ?? PLACA_RADIO_MM
  const ratioMax = toNum(datos.ratio_max) ?? PLACA_RATIO_MAX
  const c1 = (datos.ciclo1 as Fila[] | undefined) ?? []
  const c2 = (datos.ciclo2 as Fila[] | undefined) ?? []

  const ev1 = calcEvCiclo(c1, radio, false)
  const ev2 = calcEvCiclo(c2, radio, true)
  const ratio = ev1 && ev2 && ev1 > 0 ? Math.round((ev2 / ev1) * 10) / 10 : null
  // Criterio Ev2/Ev1 ≤ 2.2 desactivado temporalmente
  return {
    ev1,
    ev2,
    ratio,
    ratioMax,
    cumple: null,
    veredicto: ''
  }
}

// ── Granulometría de escollera (UNE EN 13383-2), clase 5-40 kg ────────────────
// Espejo fiel de computeGranulometria (main). Cubre el % acumulado por masa
// (ELL/NLL/NUL/EUL), MEM y el veredicto; M50/LT/>45cm son valores manuales.

export const GRANULO_SPEC = {
  ell: [0, 2],
  nll: [0, 10],
  nul: [70, 100],
  eul: [97, 100],
  mem: [10, 20],
  lt_max: 20,
  p45_max: 3
} as const

export interface GranulometriaSummary {
  n: number
  masaTotal: number
  ell: number
  nll: number
  nul: number
  eul: number
  mem: number
  m50: number | null
  ltPct: number | null
  p45Pct: number | null
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

/** Parsea una lista de masas desde un textarea (una por línea, o separadas por coma/espacio). */
export function parseMasas(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(toNum).filter((m): m is number => m !== null)
  return String(raw ?? '')
    .split(/[\s,;\n]+/)
    .map(toNum)
    .filter((m): m is number => m !== null)
}

export function granulometriaSummary(datos: Record<string, unknown>): GranulometriaSummary {
  const sp = GRANULO_SPEC
  const masas = parseMasas(datos.masas)
  const frag = toNum(datos.fragmentos_masa) ?? 0
  const n = masas.length
  const sumIn = (lo: number, hi: number): number =>
    masas.filter((m) => m >= lo && m < hi).reduce((a, b) => a + b, 0)
  const total = masas.reduce((a, b) => a + b, 0) + frag
  const pct = (cum: number): number => (total > 0 ? Math.round((cum / total) * 1000) / 10 : 0)
  const ell = pct(frag)
  const nll = pct(frag + sumIn(1.5, 5))
  const nul = pct(frag + sumIn(1.5, 40))
  const eul = pct(frag + sumIn(1.5, 80))
  const mem = n ? Math.round((masas.reduce((a, b) => a + b, 0) / n) * 10) / 10 : 0

  const m50 = toNum(datos.m50)
  const ltPct = toNum(datos.lt_pct)
  const p45n = toNum(datos.particulas_45)
  const p45Pct = p45n !== null && n > 0 ? Math.round((p45n / n) * 1000) / 10 : null

  const inRange = (v: number, [lo, hi]: readonly number[]): boolean => v >= lo && v <= hi
  let veredicto: 'CUMPLE' | 'NO CUMPLE' | '' = ''
  if (n > 0 && total > 0) {
    const ok =
      inRange(ell, sp.ell) &&
      inRange(nll, sp.nll) &&
      inRange(nul, sp.nul) &&
      inRange(eul, sp.eul) &&
      inRange(mem, sp.mem) &&
      (ltPct === null || ltPct <= sp.lt_max) &&
      (p45Pct === null || p45Pct <= sp.p45_max)
    veredicto = ok ? 'CUMPLE' : 'NO CUMPLE'
  }
  return {
    n,
    masaTotal: Math.round(total * 10) / 10,
    ell,
    nll,
    nul,
    eul,
    mem,
    m50,
    ltPct,
    p45Pct,
    veredicto
  }
}

// ── Toma de hormigón / probetas (EHE-08) ──────────────────────────────────────

export interface TomaHormigonSummary {
  fck: number | null
  media28: number | null
  n28: number
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

/** Extrae el fck de un tipo de hormigón: "HA-30/B/20/IIa" → 30, "HP-45/..." → 45. */
export function parseFck(tipoHormigon: string): number | null {
  const m = String(tipoHormigon ?? '').match(/H[APBR]-(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

/** Área de la sección de una probeta cilíndrica 150mm en mm². */
const AREA_150MM = Math.PI * 75 * 75

/** Tensión (MPa) a partir de carga máxima (kN) para probeta cilíndrica 150mm. */
export function cargaToTension(cargaKn: number): number {
  return Math.round((cargaKn * 1000) / AREA_150MM * 100) / 100
}

export function tomaHormigonSummary(datos: Record<string, unknown>): TomaHormigonSummary {
  const ident = (datos.identificacion as Record<string, unknown>) ?? {}
  const fckManual = toNum(datos.fck_manual)
  const fck = fckManual ?? parseFck(String(ident.tipo_hormigon ?? ''))

  const roturas = (datos.roturas as Record<string, unknown>[] | undefined) ?? []
  const tensiones28 = roturas
    .filter((r) => {
      const edad = toNum(r.edad_dias)
      return edad !== null && Math.round(edad) === 28
    })
    .map((r) => toNum(r.tension_mpa))
    .filter((v): v is number => v !== null)

  const n28 = tensiones28.length
  const media28 =
    n28 > 0
      ? Math.round((tensiones28.reduce((a, b) => a + b, 0) / n28) * 100) / 100
      : null

  let veredicto: 'CUMPLE' | 'NO CUMPLE' | '' = ''
  if (fck !== null && media28 !== null) {
    veredicto = media28 >= fck ? 'CUMPLE' : 'NO CUMPLE'
  }

  return { fck, media28, n28, veredicto }
}

// ── Concentración de radón (ISO 11665-4 / IS-47 CSN) ─────────────────────────

export interface RadonSummary {
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

export function radonSummary(datos: Record<string, unknown>): RadonSummary | null {
  const metadata = (datos.metadata as Record<string, unknown>) ?? {}
  const detectores = (datos.detectores as Record<string, unknown>[]) ?? []
  const nivel = toNum(metadata.nivel_referencia) ?? 300

  if (detectores.length === 0) return null

  const extraviados = detectores.filter((d) => d.extraviado)
  const saturados = detectores.filter((d) => !d.extraviado && d.saturado)
  const validos = detectores.filter(
    (d) => !d.extraviado && !d.saturado && d.rac !== null && d.rac !== undefined && d.rac !== ''
  )

  const racs = validos.map((d) => toNum(d.rac)).filter((r): r is number => r !== null)
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
    n_total: detectores.length,
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

// ── Concentración de radón continuo (ISO 11665-8 / IS-47 CSN) ─────────────────

export interface RadonContinuoSummary {
  rac_media: number | null
  rac_max: number | null
  rac_min: number | null
  nivel_referencia: number
  veredicto: 'CUMPLE' | 'NO CUMPLE' | ''
}

export function radonContinuoSummary(datos: Record<string, unknown>): RadonContinuoSummary {
  const nivel = toNum(datos.nivel_referencia) ?? 300
  const rac_media = toNum(datos.rac_media)
  const rac_max = toNum(datos.rac_max)
  const rac_min = toNum(datos.rac_min)

  let veredicto: 'CUMPLE' | 'NO CUMPLE' | '' = ''
  if (rac_media !== null) {
    veredicto = rac_media > nivel ? 'NO CUMPLE' : 'CUMPLE'
  }

  return { rac_media, rac_max, rac_min, nivel_referencia: nivel, veredicto }
}
