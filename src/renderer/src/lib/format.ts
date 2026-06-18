const EUR = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2
})
const NUM = new Intl.NumberFormat('es-ES')

export const eur = (n: number | null | undefined): string => EUR.format(n ?? 0)
export const num = (n: number | null | undefined): string => (n == null ? '' : NUM.format(n))
export const IVA_RATE = 0.21

// ── Conversión de fechas dd/mm/aaaa ↔ yyyy-mm-dd (input[type=date]) ───────────
export function toInputDate(dmy: string | undefined): string {
  if (!dmy) return ''
  const [d, m, y] = dmy.split('/')
  if (!d || !m || !y) return ''
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

export function fromInputDate(iso: string): string {
  if (!iso) return ''
  const [y, m, d] = iso.split('-')
  if (!d || !m || !y) return ''
  return `${d}/${m}/${y}`
}
