/** Datos administrativos de la obra para los entregables (Excel/Word). */
export interface ObraInfo {
  obra?: string
  cliente?: string
  ref_lab?: string
  fecha?: string
  responsable?: string
}

/** Paleta corporativa CYE (port de formatter.py). */
export const COLORS = {
  ORANGE: 'E36C09',
  NAVY: '1F3864',
  MID: '2E75B6',
  LIGHT: 'D6E4F0',
  GREY: '595959'
} as const

export const IVA_RATE = 0.21
export const TOTAL_LABEL = 'TOTAL (IVA no incluido):'
