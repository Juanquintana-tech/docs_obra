/**
 * Genera el informe Word de Ensayo de Carga con Placa (NLT-357/98) con docx v9.
 * Replica fielmente el informe oficial PDF:
 *   · Cabecera membrete (logo + dirección)
 *   · Título en negrita + subrayado
 *   · Bloque de datos del ensayo (2 columnas etiqueta/valor)
 *   · Tabla de mediciones: Primer ciclo / Descarga / Segundo ciclo + anotaciones Ev1/Ev2
 *   · Observaciones
 *   · Gráfica Presión vs Asientos (PNG generado por placaChartPng)
 *   · Pie legal (dos guiones)
 *   · Bloque de firmas doble (Director Técnico + Jefe del Área)
 *   · Pie de cliente + número de página
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
  WidthType,
  BorderStyle,
  ShadingType,
  convertMillimetersToTwip,
  PageNumber
} from 'docx'
import { computePlaca, type PlacaInput } from '../ensayos'
import { placaChartPng } from './placaChart'
import type { Ensayo, Obra } from '../../db'

// ── Paleta CYE ────────────────────────────────────────────────────────────────

const NAVY = '1B2A4A'
const LIGHT_BLUE = 'D6E4F0'
const WHITE = 'FFFFFF'

// ── Geometría de página ───────────────────────────────────────────────────────

const MARGIN_TW = convertMillimetersToTwip(15)
const A4_WIDTH_TW = 11906
const CONTENT_TW = A4_WIDTH_TW - MARGIN_TW * 2  // ≈ 10200 twips

// Conversión twips → píxeles (96 dpi estándar Word): 1 px = 15 twips
const CONTENT_PX = Math.round(CONTENT_TW / 15)   // ≈ 680 px
// Conversión mm → píxeles
const PX_PER_MM = 96 / 25.4

// ── Bordes ────────────────────────────────────────────────────────────────────

const noBorder = {
  top: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right: { style: BorderStyle.NONE, size: 0, color: 'auto' }
} as const

const thinBorder = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  left: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  right: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' }
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function fmtNum(v: unknown, dec = 2): string {
  if (v === null || v === undefined || v === '') return ''
  const n = parseFloat(String(v).replace(',', '.'))
  if (isNaN(n)) return ''
  return n.toFixed(dec).replace('.', ',')
}

function navyShading() {
  return { type: ShadingType.SOLID, color: NAVY, fill: NAVY }
}

function lightShading() {
  return { type: ShadingType.SOLID, color: LIGHT_BLUE, fill: LIGHT_BLUE }
}

// ── Helpers de celdas ─────────────────────────────────────────────────────────

/** Celda genérica: fondo, borde, texto y alineación configurables. */
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
}): TableCell {
  const shading =
    opts.bg === 'navy' ? navyShading() : opts.bg === 'light' ? lightShading() : undefined
  return new TableCell({
    width: { size: opts.widthTw, type: WidthType.DXA },
    columnSpan: opts.colspan ?? 1,
    shading,
    borders: opts.border ?? thinBorder,
    verticalAlign: VerticalAlign.CENTER,
    children: [
      new Paragraph({
        alignment: opts.align ?? AlignmentType.LEFT,
        spacing: { before: 30, after: 30 },
        children: [
          new TextRun({
            text: opts.text,
            bold: opts.bold ?? false,
            size: opts.size ?? 16,
            color: opts.color ?? (opts.bg === 'navy' ? WHITE : '000000'),
            font: 'Calibri'
          })
        ]
      })
    ]
  })
}

function labelCell(text: string, widthTw: number): TableCell {
  return cell({ text, widthTw, bg: 'light', bold: true, color: NAVY, size: 16 })
}

function valueCell(text: string, widthTw: number, colspan = 1): TableCell {
  return cell({ text, widthTw, colspan, bg: 'white', size: 16 })
}

// ── Tabla de datos del ensayo ─────────────────────────────────────────────────

/**
 * 4 columnas: label-izq (1700) | valor-izq (3400) | label-der (1700) | valor-der (3400)
 * Total = 10200 = CONTENT_TW
 */
const INFO_W = [1700, 3400, 1700, 3400] as const

/** Fila de obra: label en col0, valor en cols 1-3 (colspan 3). */
function obraRow(texto: string): TableRow {
  return new TableRow({
    children: [
      labelCell('Obra:', INFO_W[0]),
      valueCell(texto, INFO_W[1] + INFO_W[2] + INFO_W[3], 3)
    ]
  })
}

/** Fila estándar con 2 pares etiqueta/valor. */
function infoRow(label1: string, val1: string, label2: string, val2: string): TableRow {
  return new TableRow({
    children: [
      labelCell(label1, INFO_W[0]),
      valueCell(val1, INFO_W[1]),
      labelCell(label2, INFO_W[2]),
      valueCell(val2, INFO_W[3])
    ]
  })
}

/**
 * Fila con 3 campos: label1/val1 y label2/val2 combinados en la celda izquierda,
 * label3/val3 en la celda derecha. Así se replica el estilo del PDF para las filas
 * "Fecha ensayo + Climatología | Temperatura" y "Humedad suelo + Ø placa | Tiempo".
 */
function tripleRow(
  label1: string, val1: string,
  label2: string, val2: string,
  label3: string, val3: string
): TableRow {
  return new TableRow({
    children: [
      labelCell(label1, INFO_W[0]),
      new TableCell({
        width: { size: INFO_W[1], type: WidthType.DXA },
        borders: thinBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            spacing: { before: 30, after: 30 },
            children: [
              new TextRun({ text: val1 ? val1 + '   ' : '', size: 16, font: 'Calibri' }),
              new TextRun({ text: label2 + ' ', size: 16, font: 'Calibri', bold: true, color: NAVY }),
              new TextRun({ text: val2, size: 16, font: 'Calibri' })
            ]
          })
        ]
      }),
      labelCell(label3, INFO_W[2]),
      valueCell(val3, INFO_W[3])
    ]
  })
}

function infoTable(datos: Record<string, unknown>, obra: Obra): Table {
  const cab = (datos.cabecera as Record<string, string>) ?? {}

  const obraText  = toStr(cab.obra || obra.obra)
  const cliente   = toStr(cab.cliente || obra.cliente)
  const refObra   = toStr(cab.ref_obra || obra.ref_lab)
  const procedencia    = toStr(cab.procedencia)
  const ordenTrabajo   = toStr(cab.orden_trabajo)
  const fechaEnsayo    = toStr(cab.fecha_ensayo)
  const climatologia   = toStr(cab.climatologia)
  const temperatura    = toStr(cab.temperatura)
  const pk    = toStr(cab.pk)
  const capa  = toStr(cab.capa)
  const humedad = toStr(cab.humedad_suelo)
  const radioMm = parseFloat(toStr(datos.radio_mm as unknown)) * 2 || parseFloat(toStr(cab.diam_placa)) || 300
  const diamCm  = (radioMm / 10).toFixed(0)
  const tiempo  = toStr(cab.tiempo)

  return new Table({
    width: { size: CONTENT_TW, type: WidthType.DXA },
    borders: noBorder,
    rows: [
      obraRow(obraText),
      infoRow('Cliente:',        cliente,      'Ref. de obra:',       refObra),
      infoRow('Procedencia:',    procedencia,  'Orden de trabajo:',   ordenTrabajo),
      tripleRow('Fecha ensayo:', fechaEnsayo,  'Climatología:', climatologia, 'Temperatura ºC:', temperatura),
      infoRow('P.K.:',           pk,           'Capa:',               capa),
      tripleRow('Humedad suelo:', humedad,     'Ø placa:', `${diamCm} cm`, 'Tiempo invertido (min):', tiempo)
    ]
  })
}

// ── Tabla principal de mediciones ─────────────────────────────────────────────

/**
 * 6 columnas:
 *   0 — Carga específica MPa  (1700)
 *   1 — L1                    (1500)
 *   2 — L2                    (1500)
 *   3 — L3                    (1500)
 *   4 — Asiento medio mm      (1700)
 *   5 — Anotaciones Ev (sin borde) (2300)
 * Total = 10200
 */
const DATA_W = [1700, 1500, 1500, 1500, 1700, 2300] as const
const DATA_MAIN_W = DATA_W[0] + DATA_W[1] + DATA_W[2] + DATA_W[3] + DATA_W[4]

function dataHeaderRow(): TableRow {
  return new TableRow({
    children: [
      cell({ text: 'Carga específica (MPa)', widthTw: DATA_W[0], bg: 'navy', bold: true, align: AlignmentType.CENTER, size: 14 }),
      new TableCell({
        width: { size: DATA_W[1] + DATA_W[2] + DATA_W[3], type: WidthType.DXA },
        columnSpan: 3,
        shading: navyShading(),
        borders: thinBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 30, after: 30 },
          children: [new TextRun({ text: 'Lectura de flexímetros (mm)', bold: true, size: 14, color: WHITE, font: 'Calibri' })]
        })]
      }),
      cell({ text: 'Asiento medio (mm)', widthTw: DATA_W[4], bg: 'navy', bold: true, align: AlignmentType.CENTER, size: 14 }),
      cell({ text: '', widthTw: DATA_W[5], bg: 'white', border: noBorder })
    ]
  })
}

function dataSubHeaderRow(): TableRow {
  return new TableRow({
    children: [
      cell({ text: '', widthTw: DATA_W[0], bg: 'navy', align: AlignmentType.CENTER, size: 14 }),
      cell({ text: '1', widthTw: DATA_W[1], bg: 'navy', bold: true, align: AlignmentType.CENTER, size: 14 }),
      cell({ text: '2', widthTw: DATA_W[2], bg: 'navy', bold: true, align: AlignmentType.CENTER, size: 14 }),
      cell({ text: '3', widthTw: DATA_W[3], bg: 'navy', bold: true, align: AlignmentType.CENTER, size: 14 }),
      cell({ text: '', widthTw: DATA_W[4], bg: 'navy', align: AlignmentType.CENTER, size: 14 }),
      cell({ text: '', widthTw: DATA_W[5], bg: 'white', border: noBorder })
    ]
  })
}

function groupHeaderRow(label: string): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: 5,
        width: { size: DATA_MAIN_W, type: WidthType.DXA },
        shading: lightShading(),
        borders: thinBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 40 },
          children: [new TextRun({ text: label, bold: true, size: 16, color: NAVY, font: 'Calibri' })]
        })]
      }),
      cell({ text: '', widthTw: DATA_W[5], bg: 'white', border: noBorder })
    ]
  })
}

type FilaCalc = {
  presion: number | null
  l1: number | null
  l2: number | null
  l3: number | null
  asiento_medio: number | null
}

/** evLines: lista de strings a mostrar (línea por línea) en la columna de anotaciones. */
function dataRow(fila: FilaCalc, evLines: string[]): TableRow {
  const evRuns: TextRun[] = evLines.flatMap((line, idx) =>
    idx === 0
      ? [new TextRun({ text: line, bold: true, size: 16, color: NAVY, font: 'Calibri' })]
      : [new TextRun({ text: line, bold: true, size: 16, color: NAVY, font: 'Calibri', break: 1 })]
  )
  return new TableRow({
    children: [
      cell({ text: fmtNum(fila.presion, 2), widthTw: DATA_W[0], align: AlignmentType.CENTER, size: 15 }),
      cell({ text: fmtNum(fila.l1, 2),      widthTw: DATA_W[1], align: AlignmentType.CENTER, size: 15 }),
      cell({ text: fmtNum(fila.l2, 2),      widthTw: DATA_W[2], align: AlignmentType.CENTER, size: 15 }),
      cell({ text: fmtNum(fila.l3, 2),      widthTw: DATA_W[3], align: AlignmentType.CENTER, size: 15 }),
      cell({ text: fmtNum(fila.asiento_medio, 2), widthTw: DATA_W[4], align: AlignmentType.CENTER, size: 15 }),
      new TableCell({
        width: { size: DATA_W[5], type: WidthType.DXA },
        borders: noBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          spacing: { before: 30, after: 30 },
          children: evRuns.length ? evRuns : [new TextRun({ text: '', font: 'Calibri', size: 15 })]
        })]
      })
    ]
  })
}

function medicionesTable(calc: ReturnType<typeof computePlaca>): Table {
  const rows: TableRow[] = [dataHeaderRow(), dataSubHeaderRow()]

  // Primer ciclo de carga
  rows.push(groupHeaderRow('Primer ciclo de carga'))
  calc.ciclo1.forEach((f, i) => {
    const isLast = i === calc.ciclo1.length - 1
    const ev: string[] = isLast && calc.ev1 !== null ? [`Ev1 (MPa): ${calc.ev1}`] : []
    rows.push(dataRow(f, ev))
  })

  // Descarga
  rows.push(groupHeaderRow('Descarga'))
  calc.descarga.forEach((f) => rows.push(dataRow(f, [])))

  // Segundo ciclo de carga
  rows.push(groupHeaderRow('Segundo ciclo de carga'))
  calc.ciclo2.forEach((f, i) => {
    const isLast = i === calc.ciclo2.length - 1
    const ev: string[] = []
    if (isLast) {
      if (calc.ev2 !== null) ev.push(`Ev2 (MPa): ${calc.ev2}`)
      if (calc.ratio !== null) ev.push(`Ev2/Ev1: ${calc.ratio.toFixed(1).replace('.', ',')}`)
    }
    rows.push(dataRow(f, ev))
  })

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
    rows: [
      new TableRow({
        children: [
          sigCell('VºBº EL DIRECTOR TÉCNICO DE LABORATORIO', responsable),
          sigCell('JEFE DEL ÁREA VS', '')
        ]
      })
    ]
  })
}

// ── Función principal ─────────────────────────────────────────────────────────

export async function fillPlacaWord(ensayo: Ensayo, obra: Obra, logoPath: string): Promise<Buffer> {
  const datos = ensayo.datos as PlacaInput & Record<string, unknown>
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const calc = computePlaca(datos)
  const responsable = toStr(ensayo.responsable)

  // Logo — dimensiones en píxeles (96 dpi estándar Word)
  const logoBuf = readFileSync(logoPath)
  const logoMeta = await sharp(logoBuf).metadata()
  const logoWpx = Math.round(CONTENT_PX * 0.42)
  const logoHpx = Math.round(logoWpx * ((logoMeta.height ?? 120) / (logoMeta.width ?? 620)))

  // Gráfica — target 65 mm de alto
  const chartResult = await placaChartPng(calc)
  const chartHpx = chartResult ? Math.round(65 * PX_PER_MM) : 0
  const chartWpx = chartResult
    ? Math.min(Math.round(chartHpx * (chartResult.width / chartResult.height)), Math.round(CONTENT_PX * 0.92))
    : 0

  // Fecha del informe
  const fechaInforme = toStr(cab.fecha_informe || cab.fecha_ensayo)

  const ADDRESS_LINES = [
    'Polígono de La Gándara, Avda del Mar nº 123',
    '15570 NARÓN (A Coruña)',
    'Tlno: 981 37 11 36  ·  Fax: 981 37 11 04',
    'cye@controlyestudios.es'
  ]

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_WIDTH_TW, height: 16838 },
            margin: { top: MARGIN_TW, bottom: MARGIN_TW, left: MARGIN_TW, right: MARGIN_TW }
          }
        },
        children: [
          // ── Cabecera membrete ────────────────────────────────────────────────
          new Table({
            width: { size: CONTENT_TW, type: WidthType.DXA },
            borders: noBorder,
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: Math.floor(CONTENT_TW * 0.42), type: WidthType.DXA },
                    borders: noBorder,
                    verticalAlign: VerticalAlign.CENTER,
                    children: [
                      new Paragraph({
                        children: [
                          new ImageRun({
                            type: 'jpg',
                            data: logoBuf,
                            transformation: { width: logoWpx, height: logoHpx }
                          })
                        ]
                      })
                    ]
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
                ]
              })
            ]
          }),

          new Paragraph({ spacing: { before: 80, after: 40 }, children: [] }),

          // ── Título ────────────────────────────────────────────────────────────
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 0, after: 120 },
            children: [
              new TextRun({
                text: 'INFORME DE ENSAYO DE CARGA CON PLACA NLT-357/98',
                bold: true,
                underline: { type: 'single' as const },
                size: 22,
                font: 'Calibri'
              })
            ]
          }),

          // ── Datos del ensayo ──────────────────────────────────────────────────
          infoTable(datos, obra),

          new Paragraph({ spacing: { before: 100, after: 0 }, children: [] }),

          // ── Tabla de mediciones ───────────────────────────────────────────────
          medicionesTable(calc),

          // ── Observaciones ─────────────────────────────────────────────────────
          new Paragraph({
            spacing: { before: 80, after: 20 },
            children: [new TextRun({ text: 'Observaciones:', bold: true, size: 16, font: 'Calibri' })]
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: toStr(cab.observaciones), size: 16, font: 'Calibri' })]
          }),

          // ── Gráfica ───────────────────────────────────────────────────────────
          ...(chartResult
            ? [new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 40, after: 80 },
                children: [
                  new ImageRun({
                    type: 'png',
                    data: chartResult.data,
                    transformation: { width: chartWpx, height: chartHpx }
                  })
                ]
              })]
            : []),

          // ── Pie legal ─────────────────────────────────────────────────────────
          new Paragraph({
            spacing: { before: 40, after: 16 },
            children: [new TextRun({ text: '– Los resultados de este Informe sólo afectan al material sometido a ensayo.', size: 15, font: 'Calibri', color: '333333' })]
          }),
          new Paragraph({
            spacing: { before: 0, after: 80 },
            children: [new TextRun({ text: '– Este Informe no deberá reproducirse sin la aprobación de CYE CONTROL Y ESTUDIOS, S.L.', size: 15, font: 'Calibri', color: '333333' })]
          }),

          // ── Fecha ─────────────────────────────────────────────────────────────
          new Paragraph({
            spacing: { before: 20, after: 120 },
            children: [new TextRun({ text: `Narón (A Coruña), ${fechaInforme}`, size: 16, font: 'Calibri' })]
          }),

          // ── Firmas ────────────────────────────────────────────────────────────
          firmasTable(responsable),

          new Paragraph({ spacing: { before: 60, after: 40 }, children: [] }),

          // ── Pie de cliente + página ───────────────────────────────────────────
          new Table({
            width: { size: CONTENT_TW, type: WidthType.DXA },
            borders: {
              top: thinBorder.top,
              bottom: noBorder.bottom,
              left: noBorder.left,
              right: noBorder.right,
              insideHorizontal: noBorder.top,
              insideVertical: noBorder.left
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: Math.floor(CONTENT_TW * 0.78), type: WidthType.DXA },
                    borders: noBorder,
                    children: [
                      new Paragraph({
                        spacing: { before: 40, after: 0 },
                        children: [
                          new TextRun({
                            text: [toStr(obra.cliente), toStr(obra.municipio)].filter(Boolean).join('  —  Dirección: '),
                            size: 14, font: 'Calibri', color: '555555'
                          })
                        ]
                      })
                    ]
                  }),
                  new TableCell({
                    width: { size: Math.ceil(CONTENT_TW * 0.22), type: WidthType.DXA },
                    borders: noBorder,
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.RIGHT,
                        spacing: { before: 40, after: 0 },
                        children: [
                          new TextRun({
                            children: ['Página -', PageNumber.CURRENT, '/', PageNumber.TOTAL_PAGES, '-'],
                            size: 14, font: 'Calibri', color: '555555'
                          })
                        ]
                      })
                    ]
                  })
                ]
              })
            ]
          }),

          // ── Habilitación Xunta ────────────────────────────────────────────────
          new Paragraph({
            spacing: { before: 40, after: 0 },
            children: [
              new TextRun({
                text: 'Laboratorio habilitado por la Xunta de Galicia e inscrito en el Registro General del CTE como LECCE con Nº: GAL-L-005 en las áreas de actuación: GT, VS, PS, EH, EA y EFA',
                size: 13, font: 'Calibri', color: '666666'
              })
            ]
          })
        ]
      }
    ]
  })

  return Buffer.from(await Packer.toBuffer(doc))
}
