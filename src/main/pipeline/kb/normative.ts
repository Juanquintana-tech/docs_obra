/**
 * Reglas de frecuencia NORMATIVAS (PG-3, EHE-08/Código Estructural).
 * Carga `normative_rules.json` y provee el cálculo de nº de lotes y de ensayos.
 *
 * Modelo (ver NORMATIVA_FRECUENCIAS.md):
 *  - fabricacion: nº ensayos = ceil(magnitud / escalón) por escalón de volumen (m³) o tonelaje (t).
 *  - recepcion/ejecucion: nº lotes × batería fija. Lote = el MENOR de (500 m / superficie m² / día).
 *
 * Estimación de superficie cuando solo hay volumen (decisión 2026-06-26):
 *   superficie de control ≈ volumen / espesor_tongada  →  nLotes = volumen / (espesor × superficie_lote).
 *   Validado: terraplén E8 (4,4M m³, 0,30 m, 10.000 m²) → 1.467 lotes ≈ 7.350 densidades reales.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

export type ControlType = 'fabricacion' | 'recepcion' | 'ejecucion' | 'material_acceptance'

export interface NormLotDef {
  criteria?: 'min' | 'max_tonnage'
  length_m?: number
  surface_m2?: number | Record<string, number>
  daily?: boolean
  t_max?: number
}
export interface NormBatteryItem {
  test: string
  basis?: 'perLot' | 'per_m' | 'perDiametro' | 'evento' | 'garantia' | 'porTramo'
  n?: number
  every?: number // para per_m: 1 cada `every` m
  perBand?: number
  zone?: string
  norm?: string
}
export interface NormVolumeTier {
  every_m3: number
  orDaily?: boolean
  orWeekly?: boolean
  orMonthly?: boolean
  minMuestras?: number
  tests: string[]
}
export interface NormativeRule {
  id: string
  categoryCode: string
  controlType: ControlType
  source: string
  status: 'verified' | 'pending_verification'
  lot?: NormLotDef
  battery?: NormBatteryItem[]
  volumeTiers?: NormVolumeTier[]
  tonnageTiers?: Array<{ capa: string; t_por_ensayo: Record<string, number>; tests: string[] }>
  notas?: string
}

/** Espesor de tongada/capa (m) por categoría, para estimar superficie desde volumen. */
export const TONGADA_THICKNESS_M: Record<string, number> = {
  TERRAPLEN_RELLENOS: 0.3,
  ZAHORRA_ARTIFICIAL: 0.25,
  SUELO_ESTABILIZADO: 0.3,
  MEZCLA_BITUMINOSA: 0.06,
  _default: 0.3,
}

/** Nivel de conformidad por defecto para fabricación bituminosa (A/B/C). */
export const DEFAULT_NCF = 'B'
/** Altura de terraplén asumida si no se conoce (selecciona superficie de lote). */
export const DEFAULT_HEIGHT_GE_5M = true

export function loadNormativeRules(
  curatedDir = resolve(process.cwd(), 'resources/knowledge/curated')
): Map<string, NormativeRule[]> {
  const path = resolve(curatedDir, 'normative_rules.json')
  const byCat = new Map<string, NormativeRule[]>()
  if (!existsSync(path)) return byCat
  const { rules } = JSON.parse(readFileSync(path, 'utf-8')) as { rules: NormativeRule[] }
  for (const r of rules) {
    if (!byCat.has(r.categoryCode)) byCat.set(r.categoryCode, [])
    byCat.get(r.categoryCode)!.push(r)
  }
  return byCat
}

/** Superficie de lote (m²) aplicable, resolviendo el objeto por zona/altura. */
export function resolveSurfaceLot(
  surface: number | Record<string, number> | undefined,
  heightGe5m: boolean
): number | null {
  if (surface == null) return null
  if (typeof surface === 'number') return surface
  // Objeto por zona/altura: preferimos altura; coronación/explanada se tratan aparte.
  if (heightGe5m && surface.altura_ge_5m) return surface.altura_ge_5m
  if (!heightGe5m && surface.altura_lt_5m) return surface.altura_lt_5m
  return surface.altura_ge_5m ?? surface.altura_lt_5m ?? surface.coronacion ?? surface.explanada_coronacion ?? null
}
