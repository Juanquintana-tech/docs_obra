/**
 * Núcleo de cálculo del modelo "por lote" (Etapa 2 rework, branch Cye_BBDD).
 * Convierte una sección + reglas normativas en líneas de ensayo con nº de ensayos.
 * SIN LLM, determinista. Ver normative.ts y NORMATIVA_FRECUENCIAS.md.
 */
import {
  type NormativeRule, type NormBatteryItem,
  TONGADA_THICKNESS_M, DEFAULT_NCF, DEFAULT_HEIGHT_GE_5M, resolveSurfaceLot,
} from './normative'

export interface LotSection {
  categoryCode: string
  volume_m3?: number | null
  tonnage_t?: number | null
  surface_m2?: number | null // si se conoce; si no, se estima de volumen/espesor
  length_m?: number | null
  heightGe5m?: boolean | null // altura del terraplén ≥5 m (selecciona superficie de lote)
  capa?: 'rodadura' | 'intermedia' | 'base' | null // mezcla bituminosa: selecciona fila de la tabla 542.16
}

export interface NormLine {
  test: string
  nTests: number
  basis: string
  detail: string // cómo se calculó (trazabilidad)
  review: boolean
}

const ceil = Math.ceil

/** Superficie de control (m²): explícita, o estimada de volumen/espesor de tongada. */
function controlSurface(s: LotSection): { surface: number | null; estimated: boolean } {
  if (s.surface_m2 != null && s.surface_m2 > 0) return { surface: s.surface_m2, estimated: false }
  if (s.volume_m3 != null && s.volume_m3 > 0) {
    const t = TONGADA_THICKNESS_M[s.categoryCode] ?? TONGADA_THICKNESS_M._default
    // superficie acumulada de todas las tongadas = volumen / espesor
    return { surface: s.volume_m3 / t, estimated: true }
  }
  return { surface: null, estimated: false }
}

/** nº de lotes de recepción/ejecución = el mayor de los criterios disponibles (lote = el MENOR tamaño). */
function computeLots(s: LotSection, rule: NormativeRule): { nLots: number | null; detail: string; review: boolean } {
  const lot = rule.lot
  if (!lot) return { nLots: null, detail: 'sin definición de lote', review: true }
  const heightGe5m = s.heightGe5m ?? DEFAULT_HEIGHT_GE_5M
  const surfaceLot = resolveSurfaceLot(lot.surface_m2, heightGe5m)
  const { surface, estimated } = controlSurface(s)

  const candidates: number[] = []
  const notes: string[] = []
  if (surfaceLot && surface != null) {
    candidates.push(ceil(surface / surfaceLot))
    notes.push(`${Math.round(surface).toLocaleString('es-ES')} m²${estimated ? '~' : ''}/${surfaceLot.toLocaleString('es-ES')}`)
  }
  if (lot.length_m && s.length_m != null && s.length_m > 0) {
    candidates.push(ceil(s.length_m / lot.length_m))
    notes.push(`${s.length_m} m/${lot.length_m}`)
  }
  if (candidates.length === 0) return { nLots: null, detail: 'sin superficie ni longitud', review: true }
  const nLots = Math.max(1, ...candidates)
  const review = estimated && s.surface_m2 == null && (s.heightGe5m == null && typeof lot.surface_m2 === 'object')
  return { nLots, detail: `${nLots} lotes (${notes.join(', ')}${estimated ? '; sup. estimada' : ''}${s.heightGe5m == null && typeof lot.surface_m2 === 'object' ? '; altura asumida ≥5m' : ''})`, review }
}

function batteryTests(item: NormBatteryItem, nLots: number, s: LotSection): NormLine | null {
  switch (item.basis) {
    case 'perLot':
      return { test: item.test, nTests: nLots * (item.n ?? 1), basis: 'perLot', detail: `${nLots}×${item.n ?? 1}`, review: false }
    case 'per_m': {
      if (s.length_m == null) return { test: item.test, nTests: 0, basis: 'per_m', detail: 'sin longitud', review: true }
      const n = ceil(s.length_m / (item.every ?? 100)) * (item.perBand ?? 1)
      return { test: item.test, nTests: n, basis: 'per_m', detail: `${s.length_m}/${item.every}×${item.perBand ?? 1}`, review: false }
    }
    default: // evento, garantia, porTramo, perDiametro → no calculable sin más datos
      return { test: item.test, nTests: 1, basis: item.basis ?? 'otro', detail: 'frecuencia por PPTP/evento', review: true }
  }
}

/** Calcula las líneas de ensayo normativas para una sección y una regla. */
export function computeRule(s: LotSection, rule: NormativeRule): NormLine[] {
  const out: NormLine[] = []

  if (rule.controlType === 'fabricacion' && rule.volumeTiers && s.volume_m3 != null) {
    for (const tier of rule.volumeTiers) {
      const n = Math.max(1, ceil(s.volume_m3 / tier.every_m3))
      for (const test of tier.tests) out.push({ test, nTests: n, basis: 'fab_m3', detail: `${Math.round(s.volume_m3).toLocaleString('es-ES')}/${tier.every_m3.toLocaleString('es-ES')} m³`, review: false })
    }
    return out
  }
  if (rule.controlType === 'fabricacion' && rule.tonnageTiers && s.tonnage_t != null) {
    // Selecciona la fila de tabla 542.16 según la capa (rodadura/intermedia vs base).
    const isBase = s.capa === 'base'
    const tiers = rule.tonnageTiers.filter((t) => /base/i.test(t.capa) === isBase)
    const chosen = tiers.length ? tiers : [rule.tonnageTiers[0]]
    const capaUnknown = s.capa == null
    for (const tier of chosen) {
      const t = tier.t_por_ensayo[DEFAULT_NCF] ?? Object.values(tier.t_por_ensayo)[0]
      const n = Math.max(1, ceil(s.tonnage_t / t))
      for (const test of tier.tests) out.push({ test, nTests: n, basis: 'fab_t', detail: `${Math.round(s.tonnage_t).toLocaleString('es-ES')}/${t} t (NCF ${DEFAULT_NCF}, ${tier.capa})${capaUnknown ? '; capa asumida' : ''}`, review: capaUnknown })
    }
    return out
  }
  if ((rule.controlType === 'recepcion' || rule.controlType === 'ejecucion') && rule.battery) {
    const { nLots, detail, review } = computeLots(s, rule)
    if (nLots == null) {
      for (const item of rule.battery) out.push({ test: item.test, nTests: 0, basis: 'perLot', detail, review: true })
      return out
    }
    for (const item of rule.battery) {
      const line = batteryTests(item, nLots, s)
      if (line) { line.review = line.review || review; line.detail = `${line.detail} · ${detail}`; out.push(line) }
    }
  }
  return out
}
