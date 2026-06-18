/**
 * Gráfica de Presión vs. Asiento para el informe de ensayo de carga con placa
 * (NLT-357/98), replicando la del informe oficial: eje X = Presión MPa, eje Y =
 * Asientos mm (invertido, creciente hacia abajo), tres series (1er ciclo, descarga,
 * 2º ciclo). Se dibuja como SVG y se rasteriza a PNG con sharp para embeberla en
 * el Word con ImageRun.
 */
import sharp from 'sharp'
import type { PlacaResult } from '../ensayos'

export interface ChartPng {
  data: Buffer
  width: number
  height: number
}

const BLUE = '#2d5bd1'
const RED = '#c0392b'
const GREEN = '#16a34a'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Devuelve el PNG de la gráfica Presión vs. Asientos, o null si no hay datos. */
export async function placaChartPng(calc: PlacaResult): Promise<ChartPng | null> {
  type Pt = { p: number; s: number }

  const toPoints = (filas: typeof calc.ciclo1): Pt[] =>
    filas
      .filter((r) => r.presion !== null && r.asiento_medio !== null)
      .map((r) => ({ p: r.presion as number, s: r.asiento_medio as number }))

  const c1 = toPoints(calc.ciclo1)
  const desc = toPoints(calc.descarga)
  const c2 = toPoints(calc.ciclo2)

  if (c1.length === 0) return null

  const W = 660
  const H = 300
  const m = { l: 54, r: 14, t: 14, b: 60 } // margen extra abajo para leyenda
  const pw = W - m.l - m.r
  const ph = H - m.t - m.b

  // Rangos
  const allP = [...c1, ...desc, ...c2].map((p) => p.p)
  const allS = [...c1, ...desc, ...c2].map((p) => p.s)
  const pmin = 0
  const pmax = Math.max(...allP) * 1.1 || 0.35
  const smin = 0
  const smax = Math.max(...allS) * 1.15 || 3

  // Proyecciones (Y invertido: s crece hacia abajo como en el informe)
  const X = (p: number): number => m.l + ((p - pmin) / (pmax - pmin || 1)) * pw
  const Y = (s: number): number => m.t + ((s - smin) / (smax - smin || 1)) * ph

  const parts: string[] = []

  // Marco
  parts.push(
    `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="white" stroke="#ccc"/>`
  )

  // Rejilla Y (5 líneas)
  for (let i = 0; i <= 5; i++) {
    const sv = smin + ((smax - smin) * i) / 5
    const yy = Y(sv)
    parts.push(`<line x1="${m.l}" y1="${yy}" x2="${m.l + pw}" y2="${yy}" stroke="#eee"/>`)
    parts.push(
      `<text x="${m.l - 6}" y="${yy + 3}" font-size="9" text-anchor="end" fill="#555">${sv.toFixed(2)}</text>`
    )
  }

  // Rejilla X (5 líneas)
  for (let i = 0; i <= 5; i++) {
    const pv = pmin + ((pmax - pmin) * i) / 5
    const xx = X(pv)
    parts.push(`<line x1="${xx}" y1="${m.t}" x2="${xx}" y2="${m.t + ph}" stroke="#eee"/>`)
    parts.push(
      `<text x="${xx}" y="${m.t + ph + 13}" font-size="9" text-anchor="middle" fill="#555">${pv.toFixed(2)}</text>`
    )
  }

  // Función para dibujar una serie como polilínea + marcadores
  function drawSeries(pts: Pt[], color: string, marker: 'circle' | 'square' | 'triangle'): void {
    if (pts.length === 0) return
    const pathD = pts
      .map((p, i) => `${i ? 'L' : 'M'}${X(p.p).toFixed(1)},${Y(p.s).toFixed(1)}`)
      .join(' ')
    parts.push(`<path d="${pathD}" fill="none" stroke="${color}" stroke-width="1.5"/>`)
    for (const pt of pts) {
      const cx = X(pt.p)
      const cy = Y(pt.s)
      if (marker === 'circle') {
        parts.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${color}"/>`)
      } else if (marker === 'square') {
        parts.push(`<rect x="${cx - 3}" y="${cy - 3}" width="6" height="6" fill="${color}"/>`)
      } else {
        // triangle (up)
        const d = `M${cx},${cy - 4} L${cx + 3.5},${cy + 2.5} L${cx - 3.5},${cy + 2.5} Z`
        parts.push(`<path d="${d}" fill="${color}"/>`)
      }
    }
  }

  drawSeries(c1, BLUE, 'circle')
  drawSeries(desc, RED, 'square')
  drawSeries(c2, GREEN, 'triangle')

  // Ejes (títulos)
  parts.push(
    `<text x="${m.l + pw / 2}" y="${H - 38}" font-size="10" text-anchor="middle" fill="#333">Presión MPa</text>`
  )
  parts.push(
    `<text x="12" y="${m.t + ph / 2}" font-size="10" text-anchor="middle" fill="#333" transform="rotate(-90 12 ${m.t + ph / 2})">Asientos mm</text>`
  )

  // Leyenda centrada en la parte inferior
  const legendY = H - 18
  const legendItems: { color: string; marker: 'circle' | 'square' | 'triangle'; label: string }[] =
    []
  if (c1.length) legendItems.push({ color: BLUE, marker: 'circle', label: 'Primer ciclo de carga' })
  if (desc.length) legendItems.push({ color: RED, marker: 'square', label: 'Descarga' })
  if (c2.length)
    legendItems.push({ color: GREEN, marker: 'triangle', label: 'Segundo ciclo de carga' })

  // Estimar ancho total de leyenda para centrar
  const itemWidth = 120
  const totalLegendW = legendItems.length * itemWidth
  let lx = m.l + pw / 2 - totalLegendW / 2

  for (const item of legendItems) {
    const mx = lx + 6
    const my = legendY
    if (item.marker === 'circle') {
      parts.push(`<circle cx="${mx}" cy="${my}" r="3.5" fill="${item.color}"/>`)
    } else if (item.marker === 'square') {
      parts.push(
        `<rect x="${mx - 3.5}" y="${my - 3.5}" width="7" height="7" fill="${item.color}"/>`
      )
    } else {
      const d = `M${mx},${my - 4.5} L${mx + 4},${my + 2.5} L${mx - 4},${my + 2.5} Z`
      parts.push(`<path d="${d}" fill="${item.color}"/>`)
    }
    parts.push(
      `<text x="${mx + 8}" y="${my + 4}" font-size="9" fill="#333">${esc(item.label)}</text>`
    )
    lx += itemWidth
  }

  // Borde exterior (sobre todo lo demás para que tape las líneas de rejilla)
  parts.push(
    `<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="none" stroke="#ccc" stroke-width="1"/>`
  )

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="white"/>
  ${parts.join('\n  ')}
</svg>`

  const data = await sharp(Buffer.from(svg)).png().toBuffer()
  return { data, width: W, height: H }
}
