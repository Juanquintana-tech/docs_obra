const EUR = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
})
const NUM = new Intl.NumberFormat('es-ES')

export const eur = (n: number | null | undefined): string => EUR.format(n ?? 0)
export const num = (n: number | null | undefined): string => (n == null ? '' : NUM.format(n))
export const IVA_RATE = 0.21
