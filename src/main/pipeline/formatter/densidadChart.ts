/**
 * Gráfica de % compactación por ensayo para el informe de densidad in situ,
 * replicando la de la hoja INF: puntos del lote + línea media + línea de
 * especificación. Se dibuja como SVG y se rasteriza a PNG con sharp (sin matplotlib
 * ni canvas nativo), para embeberla en el Word con ImageRun.
 */
import sharp from 'sharp'
import type { DensidadResult } from '../ensayos'

export interface ChartPng {
  data: Buffer
  width: number
  height: number
}

const BLUE = '#2d5bd1'
const PURPLE = '#7c3aed'
const DARK = '#444444'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Devuelve el PNG de la gráfica, o null si no hay puntos de compactación. */
export async function densidadChartPng(calc: DensidadResult): Promise<ChartPng | null> {
  const pts = calc.rows
    .map((r, i) => ({ x: Number(r.n) || i + 1, y: r.compactacion }))
    .filter((p): p is { x: number; y: number } => p.y != null && isFinite(p.y))
  if (pts.length === 0) return null

  const W = 660
  const H = 250
  const m = { l: 48, r: 14, t: 14, b: 44 }
  const pw = W - m.l - m.r
  const ph = H - m.t - m.b

  const media = calc.media_compactacion
  const spec = calc.compactacion_min
  const yVals = [...pts.map((p) => p.y), media, spec]
  let ymin = Math.min(...yVals)
  let ymax = Math.max(...yVals)
  const padY = (ymax - ymin) * 0.15 || 1
  ymin -= padY
  ymax += padY

  const xs = pts.map((p) => p.x)
  const xmin = Math.min(...xs)
  const xmax = Math.max(...xs, xmin + 1)

  const X = (x: number): number => m.l + ((x - xmin) / (xmax - xmin || 1)) * pw
  const Y = (y: number): number => m.t + ph - ((y - ymin) / (ymax - ymin || 1)) * ph

  const parts: string[] = []
  // marco + rejilla Y (4 líneas) con etiquetas
  parts.push(`<rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="white" stroke="#ccc"/>`)
  for (let i = 0; i <= 4; i++) {
    const yv = ymin + ((ymax - ymin) * i) / 4
    const yy = Y(yv)
    parts.push(`<line x1="${m.l}" y1="${yy}" x2="${m.l + pw}" y2="${yy}" stroke="#eee"/>`)
    parts.push(
      `<text x="${m.l - 6}" y="${yy + 3}" font-size="9" text-anchor="end" fill="#555">${yv.toFixed(0)}</text>`
    )
  }
  // etiquetas X (un tick por ensayo)
  for (const p of pts) {
    parts.push(
      `<text x="${X(p.x)}" y="${m.t + ph + 14}" font-size="9" text-anchor="middle" fill="#555">${p.x}</text>`
    )
  }
  // línea de especificación y media
  parts.push(
    `<line x1="${m.l}" y1="${Y(spec)}" x2="${m.l + pw}" y2="${Y(spec)}" stroke="${DARK}" stroke-width="1.3"/>`
  )
  parts.push(
    `<line x1="${m.l}" y1="${Y(media)}" x2="${m.l + pw}" y2="${Y(media)}" stroke="${PURPLE}" stroke-width="1" stroke-dasharray="5 3"/>`
  )
  // serie del lote (línea + puntos)
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ')
  parts.push(`<path d="${path}" fill="none" stroke="${BLUE}" stroke-width="1.6"/>`)
  for (const p of pts) parts.push(`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="2.6" fill="${BLUE}"/>`)
  // ejes (títulos)
  parts.push(
    `<text x="${m.l + pw / 2}" y="${H - 6}" font-size="10" text-anchor="middle" fill="#333">Nº de ensayo</text>`
  )
  parts.push(
    `<text x="12" y="${m.t + ph / 2}" font-size="10" text-anchor="middle" fill="#333" transform="rotate(-90 12 ${m.t + ph / 2})">% compactación</text>`
  )
  // leyenda
  const ly = m.t + 2
  let lx = m.l + 8
  const legend = (color: string, dash: boolean, label: string): void => {
    parts.push(
      `<line x1="${lx}" y1="${ly}" x2="${lx + 16}" y2="${ly}" stroke="${color}" stroke-width="2"${dash ? ' stroke-dasharray="5 3"' : ''}/>`
    )
    parts.push(`<text x="${lx + 20}" y="${ly + 3}" font-size="9" fill="#333">${esc(label)}</text>`)
    lx += 26 + label.length * 5.4
  }
  legend(BLUE, false, 'Lote')
  legend(PURPLE, true, 'Media Lote')
  legend(DARK, false, 'Especificación')

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="white"/>${parts.join('')}</svg>`
  const data = await sharp(Buffer.from(svg)).png().toBuffer()
  return { data, width: W, height: H }
}
