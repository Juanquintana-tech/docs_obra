/**
 * Genera el informe Word de Densidad y Humedad In Situ (ASTM D-6938) con docx v9.
 * Replica el informe oficial PDF:
 *   · Cabecera membrete (logo + dirección)
 *   · Título
 *   · Caja de datos del ensayo (obra, ref, orden, capa, localización, lote, obs.)
 *   · Cabecera "RESULTADOS OBTENIDOS" + fecha de ensayo
 *   · Tabla de mediciones: cabecera 3 niveles (LABORATORIO/OBRA) + datos + MEDIA LOTE
 *   · Bloque ESPECIFICACIÓN Art.513 PG-3 con 3 condiciones y veredictos
 *   · Notas al pie ¹ y ²
 *   · Gráfica % Compactación vs Nº Ensayo (PNG)
 *   · Pie legal, fecha, firmas dobles, pie de cliente
 */
import { readFileSync } from 'fs'
import sharp from 'sharp'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  VerticalAlign,
  VerticalMergeType,
  WidthType,
  BorderStyle,
  ShadingType,
  convertMillimetersToTwip,
  PageNumber
} from 'docx'
import { computeDensidad, type DensidadInput } from '../ensayos'
import { densidadChartPng } from './densidadChart'
import type { Ensayo, Obra } from '../../db'

// ── Paleta CYE ────────────────────────────────────────────────────────────────

const NAVY = '1B2A4A'
const LIGHT_BLUE = 'D6E4F0'
const WHITE = 'FFFFFF'
const GREEN_DARK = '1A7A3E'
const RED_DARK = 'C0392B'

// ── Geometría de página ───────────────────────────────────────────────────────

const MARGIN_TW = convertMillimetersToTwip(15)
const A4_WIDTH_TW = 11906
const CONTENT_TW = A4_WIDTH_TW - MARGIN_TW * 2   // ≈ 10200 twips
const CONTENT_PX = Math.round(CONTENT_TW / 15)    // ≈ 680 px
const PX_PER_MM = 96 / 25.4

// ── Bordes ────────────────────────────────────────────────────────────────────

const noBorder = {
  top:    { style: BorderStyle.NONE,   size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE,   size: 0, color: 'auto' },
  left:   { style: BorderStyle.NONE,   size: 0, color: 'auto' },
  right:  { style: BorderStyle.NONE,   size: 0, color: 'auto' }
} as const

const thinBorder = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' }
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function fmtNum(v: unknown, dec = 3): string {
  if (v === null || v === undefined || v === '') return ''
  const n = parseFloat(String(v).replace(',', '.'))
  if (isNaN(n)) return ''
  return n.toFixed(dec).replace('.', ',')
}

function navyShading() { return { type: ShadingType.SOLID, color: NAVY,       fill: NAVY       } }
function lightShading() { return { type: ShadingType.SOLID, color: LIGHT_BLUE, fill: LIGHT_BLUE } }

/** Celda genérica: fondo, borde y texto configurables. */
function cell(opts: {
  text: string
  widthTw: number
  colspan?: number
  bg?: 'navy' | 'light' | 'white'
  bold?: boolean
  size?: number
  color?: string
  align?: typeof AlignmentType[keyof typeof AlignmentType]
  border?: typeof thinBorder | typeof noBorder
  vmerge?: typeof VerticalMergeType[keyof typeof VerticalMergeType]
}): TableCell {
  const shading =
    opts.bg === 'navy'  ? navyShading() :
    opts.bg === 'light' ? lightShading() : undefined
  return new TableCell({
    width: { size: opts.widthTw, type: WidthType.DXA },
    columnSpan: opts.colspan ?? 1,
    shading,
    borders: opts.border ?? thinBorder,
    verticalAlign: VerticalAlign.CENTER,
    verticalMerge: opts.vmerge,
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        spacing: { before: 30, after: 30 },
        children: [
          new TextRun({
            text: opts.text,
            bold:  opts.bold ?? false,
            size:  opts.size ?? 16,
            color: opts.color ?? (opts.bg === 'navy' ? WHITE : '000000'),
            font:  'Calibri'
          })
        ]
      })
    ]
  })
}

/** Celda que continúa una fusión vertical (sin contenido visible). */
function vContinue(widthTw: number, colspan = 1): TableCell {
  return new TableCell({
    width: { size: widthTw, type: WidthType.DXA },
    columnSpan: colspan,
    borders: thinBorder,
    verticalMerge: VerticalMergeType.CONTINUE,
    children: [new Paragraph({ children: [] })]
  })
}

// ── Tabla de datos del ensayo (caja de cabecera) ──────────────────────────────

/**
 * Caja con borde externo, sin líneas internas, con 4 filas:
 *   1. Obra: [texto]
 *   2. Ref. Obra: [val]  Orden de trabajo: [val]  Capa: [val]
 *   3. Localización: [val]  Nº Lote: [val]
 *   4. Observaciones: [val]
 */
function infoCajaTable(datos: Record<string, unknown>, obra: Obra): Table {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const obraText     = toStr(cab.obra    || obra.obra)
  const refObra      = toStr(cab.ref_obra || obra.ref_lab)
  const ordenTrabajo = toStr(cab.orden_trabajo)
  const capa         = toStr(cab.capa)
  const localizacion = toStr(cab.localizacion)
  const nLote        = toStr(cab.n_lote)
  const observ       = toStr(cab.observaciones)

  /** Crea una fila de la caja con párrafo multi-campo en negrita/normal. */
  const cajaRow = (fields: Array<{ label: string; value: string }>, isFirst = false, isLast = false): TableRow => {
    const runs: TextRun[] = []
    fields.forEach(({ label, value }, i) => {
      if (i > 0) runs.push(new TextRun({ text: '     ', size: 16, font: 'Calibri' }))
      runs.push(new TextRun({ text: label + ' ', size: 16, font: 'Calibri', bold: true }))
      runs.push(new TextRun({ text: value,        size: 16, font: 'Calibri' }))
    })
    const topBorder    = isFirst ? thinBorder.top    : noBorder.top
    const bottomBorder = isLast  ? thinBorder.bottom : noBorder.bottom
    return new TableRow({
      children: [
        new TableCell({
          width: { size: CONTENT_TW, type: WidthType.DXA },
          borders: {
            top:    topBorder,
            bottom: bottomBorder,
            left:   thinBorder.left,
            right:  thinBorder.right
          },
          children: [new Paragraph({ spacing: { before: 40, after: 40 }, children: runs })]
        })
      ]
    })
  }

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    borders: noBorder,
    rows: [
      cajaRow([{ label: 'Obra:', value: obraText }], true, false),
      cajaRow([
        { label: 'Ref. Obra:', value: refObra },
        { label: 'Orden de trabajo:', value: ordenTrabajo },
        { label: 'Capa:', value: capa }
      ]),
      cajaRow([
        { label: 'Localización:', value: localizacion },
        { label: 'Nº Lote:', value: nLote }
      ]),
      cajaRow([{ label: 'Observaciones:', value: observ }], false, true)
    ]
  })
}

// ── Tabla de mediciones ───────────────────────────────────────────────────────

/**
 * 8 columnas:
 *   0 — Nº ensayo     (900)
 *   1 — D.Máx (g/cm³) (1350)
 *   2 — H.Ópt (%)     (1200)
 *   3 — D.eq rad.     (1350)
 *   4 — D.corr        (1350)
 *   5 — H.eq rad.     (1200)
 *   6 — H.corr        (1200)
 *   7 — Compac. (%)   (1650)
 * Total = 10200
 */
const DW = [900, 1350, 1200, 1350, 1350, 1200, 1200, 1650] as const
const NROWS_MAX = 15   // max filas de datos visibles

function hdr(text: string, col: number, colspan = 1, rs: typeof VerticalMergeType[keyof typeof VerticalMergeType] | undefined = undefined): TableCell {
  const w = DW.slice(col, col + colspan).reduce((a, b) => a + b, 0)
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    columnSpan: colspan > 1 ? colspan : undefined,
    shading: navyShading(),
    borders: thinBorder,
    verticalAlign: VerticalAlign.CENTER,
    verticalMerge: rs,
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 25, after: 25 },
      children: [new TextRun({ text, bold: true, size: 14, color: WHITE, font: 'Calibri' })]
    })]
  })
}

function buildHeaderRows(): TableRow[] {
  // Fila 1: Nº ensayo (rs=3) | LABORATORIO (cs=2) | OBRA (cs=4) | Compactación (rs=3)
  const r1 = new TableRow({ children: [
    hdr('Nº\nensayo', 0, 1, VerticalMergeType.RESTART),
    hdr('LABORATORIO', 1, 2),
    hdr('OBRA', 3, 4),
    hdr('Compactación\n(%)', 7, 1, VerticalMergeType.RESTART)
  ]})

  // Fila 2: rs-continue | Proctor Modificado (cs=2) | D.in situ (g/cm³) (cs=2) | H.in situ (%) (cs=2) | rs-continue
  const r2 = new TableRow({ children: [
    vContinue(DW[0]),
    hdr('Proctor Modificado', 1, 2),
    hdr('Densidad "in situ"\n(g/cm³)', 3, 2),
    hdr('Humedad "in situ"\n(%)', 5, 2),
    vContinue(DW[7])
  ]})

  // Fila 3: rs-continue | D.Máx | H.Ópt | Eq.rad | Corr¹ | Eq.rad | Corr² | rs-continue
  const r3 = new TableRow({ children: [
    vContinue(DW[0]),
    hdr('Densidad\nMáxima\n(g/cm³)', 1),
    hdr('Humedad\nÓptima\n(%)', 2),
    hdr('Equipo\nradiactivo', 3),
    hdr('Corrección¹', 4),
    hdr('Equipo\nradiactivo', 5),
    hdr('Corrección²', 6),
    vContinue(DW[7])
  ]})

  // Fila 4: valores de corrección (0,000 / 0,0)
  const r4 = new TableRow({ children: [
    cell({ text: '', widthTw: DW[0], bg: 'light', size: 14 }),
    cell({ text: '', widthTw: DW[1], bg: 'light', size: 14 }),
    cell({ text: '', widthTw: DW[2], bg: 'light', size: 14 }),
    cell({ text: '', widthTw: DW[3], bg: 'light', size: 14 }),
    cell({ text: '0,000', widthTw: DW[4], bg: 'light', align: AlignmentType.CENTER, size: 14 }),
    cell({ text: '', widthTw: DW[5], bg: 'light', size: 14 }),
    cell({ text: '0,0',   widthTw: DW[6], bg: 'light', align: AlignmentType.CENTER, size: 14 }),
    cell({ text: '', widthTw: DW[7], bg: 'light', size: 14 })
  ]})

  return [r1, r2, r3, r4]
}

type RowCalc = {
  n: number
  d_max: number | null
  h_opt: number | null
  d_situ: number | null
  h_situ: number | null
  compactacion: number | null
}

function dataRow(r: RowCalc): TableRow {
  const cumple = r.compactacion !== null
  return new TableRow({ children: [
    cell({ text: String(r.n), widthTw: DW[0], align: AlignmentType.CENTER, size: 15 }),
    cell({ text: fmtNum(r.d_max, 2), widthTw: DW[1], align: AlignmentType.CENTER, size: 15 }),
    cell({ text: fmtNum(r.h_opt, 1), widthTw: DW[2], align: AlignmentType.CENTER, size: 15 }),
    cell({ text: fmtNum(r.d_situ, 3), widthTw: DW[3], align: AlignmentType.CENTER, size: 15 }),
    cell({ text: fmtNum(r.d_situ, 3), widthTw: DW[4], align: AlignmentType.CENTER, size: 15 }),
    cell({ text: fmtNum(r.h_situ, 1), widthTw: DW[5], align: AlignmentType.CENTER, size: 15 }),
    cell({ text: fmtNum(r.h_situ, 1), widthTw: DW[6], align: AlignmentType.CENTER, size: 15 }),
    new TableCell({
      width: { size: DW[7], type: WidthType.DXA },
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 30, after: 30 },
        children: [new TextRun({
          text: r.compactacion !== null ? fmtNum(r.compactacion, 1) : '',
          size: 15, font: 'Calibri',
          color: cumple ? '000000' : '000000'
        })]
      })]
    })
  ]})
}

function emptyDataRow(idx: number): TableRow {
  return new TableRow({ children: DW.map((w) =>
    cell({ text: '', widthTw: w, size: 14, color: 'CCCCCC' })
  )})
}

function mediaLoteRow(calc: ReturnType<typeof computeDensidad>): TableRow {
  return new TableRow({ children: [
    new TableCell({
      width: { size: DW[0] + DW[1] + DW[2], type: WidthType.DXA },
      columnSpan: 3,
      shading: lightShading(),
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text: 'MEDIA LOTE', bold: true, size: 15, font: 'Calibri' })]
      })]
    }),
    cell({ text: fmtNum(calc.media_d_situ, 3), widthTw: DW[3], align: AlignmentType.CENTER, size: 15, bold: true, bg: 'light' }),
    cell({ text: fmtNum(calc.media_d_situ, 3), widthTw: DW[4], align: AlignmentType.CENTER, size: 15, bold: true, bg: 'light' }),
    cell({ text: fmtNum(calc.media_h_situ, 1), widthTw: DW[5], align: AlignmentType.CENTER, size: 15, bold: true, bg: 'light' }),
    cell({ text: fmtNum(calc.media_h_situ, 1), widthTw: DW[6], align: AlignmentType.CENTER, size: 15, bold: true, bg: 'light' }),
    cell({ text: fmtNum(calc.media_compactacion, 1), widthTw: DW[7], align: AlignmentType.CENTER, size: 15, bold: true, bg: 'light' })
  ]})
}

function especificacionRows(calc: ReturnType<typeof computeDensidad>): TableRow[] {
  const cm = calc.compactacion_min
  const lim2 = cm - 2

  const verdictColor = (ok: boolean): string => ok ? GREEN_DARK : RED_DARK
  const verdictText = (ok: boolean, large = false): string =>
    ok ? (large ? 'CUMPLE' : 'Cumple') : (large ? 'NO CUMPLE' : 'No Cumple')

  // ESPECIFICACIÓN cell (col 0, rowspan 3)
  const especCell = (rs: typeof VerticalMergeType[keyof typeof VerticalMergeType]): TableCell =>
    new TableCell({
      width: { size: DW[0], type: WidthType.DXA },
      shading: lightShading(),
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      verticalMerge: rs,
      children: rs === VerticalMergeType.RESTART
        ? [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 30, after: 30 },
            children: [
              new TextRun({ text: 'ESPECIFICACIÓN\nArt. 513\nPG-3', bold: true, size: 14, font: 'Calibri', break: 0 }),
            ]
          })]
        : [new Paragraph({ children: [] })]
    })

  // Fila CONDICIÓN 1: espec(rs) | texto(cs=5) | ≥ cm% | CUMPLE
  const row1 = new TableRow({ children: [
    especCell(VerticalMergeType.RESTART),
    new TableCell({
      width: { size: DW[1]+DW[2]+DW[3]+DW[4]+DW[5], type: WidthType.DXA },
      columnSpan: 5,
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text: `CONDICIÓN 1: % Compactación media del lote obtenida`, size: 14, font: 'Calibri' })]
      })]
    }),
    cell({ text: `≥ ${cm}%`, widthTw: DW[6], align: AlignmentType.CENTER, size: 14, bold: true }),
    new TableCell({
      width: { size: DW[7], type: WidthType.DXA },
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 30, after: 30 },
        children: [new TextRun({
          text: verdictText(calc.cond1, true),
          bold: true, size: 16, font: 'Calibri',
          color: verdictColor(calc.cond1)
        })]
      })]
    })
  ]})

  // Fila CONDICIÓN 2: espec(continue) | texto(cs=6) | veredicto
  const row2 = new TableRow({ children: [
    especCell(VerticalMergeType.CONTINUE),
    new TableCell({
      width: { size: DW[1]+DW[2]+DW[3]+DW[4]+DW[5]+DW[6], type: WidthType.DXA },
      columnSpan: 6,
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text: `CONDICIÓN 2: No más de 2 valores de compactación de los ensayos del lote ≤ ${lim2}% PM`, size: 14, font: 'Calibri' })]
      })]
    }),
    new TableCell({
      width: { size: DW[7], type: WidthType.DXA },
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text: verdictText(calc.cond2), size: 15, font: 'Calibri', color: verdictColor(calc.cond2) })]
      })]
    })
  ]})

  // Fila CONDICIÓN 3: espec(continue) | texto(cs=6) | veredicto
  const cond3ok = calc.cond3 !== false
  const row3 = new TableRow({ children: [
    especCell(VerticalMergeType.CONTINUE),
    new TableCell({
      width: { size: DW[1]+DW[2]+DW[3]+DW[4]+DW[5]+DW[6], type: WidthType.DXA },
      columnSpan: 6,
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        spacing: { before: 30, after: 30 },
        children: [new TextRun({
          text: 'CONDICIÓN 3: Valores de Humedad "in situ" dentro del rango -1%/+0,5% de la Humedad Óptima',
          size: 14, font: 'Calibri'
        }),
        new TextRun({
          text: '\nEsta condición sólo tiene carácter indicativo, no constituyendo base para aceptación o rechazo',
          size: 13, font: 'Calibri', color: '555555', break: 1
        })]
      })]
    }),
    new TableCell({
      width: { size: DW[7], type: WidthType.DXA },
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 30, after: 30 },
        children: [new TextRun({
          text: calc.cond3 === null ? '—' : verdictText(cond3ok),
          size: 15, font: 'Calibri', color: calc.cond3 === null ? '888888' : verdictColor(cond3ok)
        })]
      })]
    })
  ]})

  return [row1, row2, row3]
}

function medicionesTable(datos: Record<string, unknown>): Table {
  const calc = computeDensidad(datos as DensidadInput)
  const rows: TableRow[] = [...buildHeaderRows()]

  // Filas de datos
  const nData = calc.rows.length
  calc.rows.forEach((r) => rows.push(dataRow(r)))

  // Filas vacías hasta NROWS_MAX
  for (let i = nData; i < NROWS_MAX; i++) rows.push(emptyDataRow(i))

  // MEDIA LOTE
  rows.push(mediaLoteRow(calc))

  // ESPECIFICACIÓN
  rows.push(...especificacionRows(calc))

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    borders: noBorder,
    rows
  })
}

// ── Tabla de firmas ───────────────────────────────────────────────────────────

function firmasTable(responsable: string): Table {
  const half = Math.floor(CONTENT_TW / 2)
  const sigCell = (titulo: string, fdo: string): TableCell =>
    new TableCell({
      width: { size: half, type: WidthType.DXA },
      borders: noBorder,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 10 },
          children: [new TextRun({ text: titulo, bold: true, size: 16, font: 'Calibri' })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 320, after: 0 },
          children: [new TextRun({ text: `Fdo.: ${fdo}`, size: 16, font: 'Calibri' })]
        })
      ]
    })

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    borders: noBorder,
    rows: [new TableRow({ children: [
      sigCell('VºBº EL DIRECTOR DEL LABORATORIO', responsable),
      sigCell('EL JEFE DE ÁREA VS', '')
    ]})]
  })
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function fillDensidadWord(ensayo: Ensayo, obra: Obra, logoPath: string): Promise<Buffer> {
  const datos = ensayo.datos as DensidadInput & Record<string, unknown>
  const cab   = (datos.cabecera as Record<string, string>) ?? {}
  const calc  = computeDensidad(datos)
  const responsable = toStr(ensayo.responsable)

  // Logo
  const logoBuf  = readFileSync(logoPath)
  const logoMeta = await sharp(logoBuf).metadata()
  const logoWpx  = Math.round(CONTENT_PX * 0.42)
  const logoHpx  = Math.round(logoWpx * ((logoMeta.height ?? 120) / (logoMeta.width ?? 620)))

  // Gráfica — target 60 mm de alto
  const chartResult = await densidadChartPng(calc)
  const chartHpx = chartResult ? Math.round(60 * PX_PER_MM) : 0
  const chartWpx = chartResult
    ? Math.min(Math.round(chartHpx * (chartResult.width / chartResult.height)), Math.round(CONTENT_PX * 0.92))
    : 0

  const fechaEnsayo  = toStr(cab.fecha_ensayo)
  const fechaInforme = toStr(cab.fecha_informe || cab.fecha_ensayo)

  const ADDRESS_LINES = [
    'Polígono de La Gándara, Avda del Mar nº 123',
    '15570 NARÓN (A Coruña)',
    'Tlno: 981 37 11 36  ·  Fax: 981 37 11 04',
    'cye@controlyestudios.es'
  ]

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          size: { width: A4_WIDTH_TW, height: 16838 },
          margin: { top: MARGIN_TW, bottom: MARGIN_TW, left: MARGIN_TW, right: MARGIN_TW }
        }
      },
      children: [
        // ── Cabecera membrete ──────────────────────────────────────────────────
        new Table({
          width: { size: CONTENT_TW, type: WidthType.DXA },
          borders: noBorder,
          rows: [new TableRow({ children: [
            new TableCell({
              width: { size: Math.floor(CONTENT_TW * 0.42), type: WidthType.DXA },
              borders: noBorder,
              verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ children: [
                new ImageRun({ type: 'jpg', data: logoBuf, transformation: { width: logoWpx, height: logoHpx } })
              ]})]
            }),
            new TableCell({
              width: { size: Math.ceil(CONTENT_TW * 0.58), type: WidthType.DXA },
              borders: noBorder,
              verticalAlign: VerticalAlign.CENTER,
              children: ADDRESS_LINES.map((line) =>
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  spacing: { before: 0, after: 20 },
                  children: [new TextRun({ text: line, size: 14, color: '444444', font: 'Calibri' })]
                })
              )
            })
          ]})]
        }),

        // ── Línea separadora fina ─────────────────────────────────────────────
        new Paragraph({ spacing: { before: 60, after: 0 }, children: [],
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: '999999' } }
        }),
        new Paragraph({ spacing: { before: 0, after: 60 }, children: [] }),

        // ── Título ────────────────────────────────────────────────────────────
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 80 },
          children: [new TextRun({
            text: 'INFORME DE ENSAYO DE DENSIDAD Y HUMEDAD "IN SITU" (por isótopos radiactivos ASTM D-6938)',
            bold: true, size: 18, font: 'Calibri'
          })]
        }),

        // ── Caja de datos del ensayo ──────────────────────────────────────────
        infoCajaTable(datos, obra),

        new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }),

        // ── RESULTADOS OBTENIDOS + Fecha ──────────────────────────────────────
        new Table({
          width: { size: CONTENT_TW, type: WidthType.DXA },
          borders: noBorder,
          rows: [new TableRow({ children: [
            new TableCell({
              width: { size: Math.floor(CONTENT_TW * 0.6), type: WidthType.DXA },
              borders: noBorder,
              children: [new Paragraph({
                spacing: { before: 0, after: 20 },
                children: [new TextRun({ text: 'RESULTADOS OBTENIDOS:', bold: true, size: 18, font: 'Calibri' })]
              })]
            }),
            new TableCell({
              width: { size: Math.ceil(CONTENT_TW * 0.4), type: WidthType.DXA },
              borders: noBorder,
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 0, after: 20 },
                children: [
                  new TextRun({ text: 'Fecha de ensayo: ', bold: true, size: 16, font: 'Calibri' }),
                  new TextRun({ text: fechaEnsayo, size: 16, font: 'Calibri' })
                ]
              })]
            })
          ]})]
        }),

        // ── Tabla de mediciones ───────────────────────────────────────────────
        medicionesTable(datos),

        new Paragraph({ spacing: { before: 60, after: 0 }, children: [] }),

        // ── Notas al pie ──────────────────────────────────────────────────────
        new Paragraph({
          spacing: { before: 0, after: 10 },
          children: [new TextRun({ text: '¹ Densidad determinada por el método de la arena según UNE 103503:1995', size: 14, font: 'Calibri', color: '444444', italics: true })]
        }),
        new Paragraph({
          spacing: { before: 0, after: 60 },
          children: [new TextRun({ text: '² Humedad determinada por secado en estufa según UNE 103300:93', size: 14, font: 'Calibri', color: '444444', italics: true })]
        }),

        // ── Gráfica ───────────────────────────────────────────────────────────
        ...(chartResult ? [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 60 },
          children: [new ImageRun({ type: 'png', data: chartResult.data, transformation: { width: chartWpx, height: chartHpx } })]
        })] : []),

        // ── Pie legal (centrado, en cursiva con guiones) ───────────────────────
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 20, after: 10 },
          children: [new TextRun({ text: '- Los resultados de este Informe sólo afectan al material sometido a ensayo', size: 15, font: 'Calibri', italics: true })]
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 80 },
          children: [new TextRun({ text: '- Este Informe no deberá reproducirse sin la aprobación de CYE CONTROL Y ESTUDIOS, S.L.', size: 15, font: 'Calibri', italics: true })]
        }),

        // ── Fecha ─────────────────────────────────────────────────────────────
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 100 },
          children: [new TextRun({ text: `Narón (A Coruña), ${fechaInforme}`, size: 16, font: 'Calibri' })]
        }),

        // ── Firmas ────────────────────────────────────────────────────────────
        firmasTable(responsable),

        new Paragraph({ spacing: { before: 60, after: 40 }, children: [] }),

        // ── Pie de cliente + número de página ─────────────────────────────────
        new Table({
          width: { size: CONTENT_TW, type: WidthType.DXA },
          borders: {
            top: thinBorder.top, bottom: noBorder.bottom,
            left: noBorder.left, right: noBorder.right,
            insideH: noBorder.top, insideV: noBorder.left
          },
          rows: [new TableRow({ children: [
            new TableCell({
              width: { size: Math.floor(CONTENT_TW * 0.78), type: WidthType.DXA },
              borders: noBorder,
              children: [new Paragraph({
                spacing: { before: 40, after: 0 },
                children: [new TextRun({
                  text: [toStr(obra.cliente), toStr(obra.municipio)].filter(Boolean).join('  —  Dirección: '),
                  size: 14, font: 'Calibri', color: '555555'
                })]
              })]
            }),
            new TableCell({
              width: { size: Math.ceil(CONTENT_TW * 0.22), type: WidthType.DXA },
              borders: noBorder,
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                spacing: { before: 40, after: 0 },
                children: [new TextRun({
                  children: ['Página -', PageNumber.CURRENT, '/', PageNumber.TOTAL_PAGES, '-'],
                  size: 14, font: 'Calibri', color: '555555'
                })]
              })]
            })
          ]})]
        }),

        // ── Habilitación Xunta ────────────────────────────────────────────────
        new Paragraph({
          spacing: { before: 40, after: 0 },
          children: [new TextRun({
            text: 'Laboratorio habilitado por la Xunta de Galicia e inscrito en el Registro General del CTE como LECCE con Nº: GAL-L-005 en las áreas de actuación: GT, VS, PS, EH, EA y EFA',
            size: 13, font: 'Calibri', color: '666666'
          })]
        })
      ]
    }]
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
