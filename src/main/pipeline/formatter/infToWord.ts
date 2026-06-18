/**
 * Convierte la hoja INF (ya horneada) de un .xlsx en un documento Word que la
 * replica como una rejilla 1:1 — equivalente a "seleccionar todo en Excel y pegarlo
 * en una página de Word". Lee con exceljs los valores, estilos (fuente, tamaño,
 * negrita, color, relleno, bordes, alineación), anchos de columna y celdas
 * combinadas, y los reproduce en una tabla de docx. El logo y la gráfica (que en
 * Excel flotan sobre las celdas) se colocan: el logo arriba y la gráfica en su banda.
 */
import ExcelJS from 'exceljs'
import {
  Document,
  Packer,
  Table,
  TableRow,
  TableCell,
  Paragraph,
  TextRun,
  ImageRun,
  Footer,
  PageNumber,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  TableLayoutType,
  VerticalMergeType
} from 'docx'

export interface Img {
  data: Buffer
  width: number
  height: number
}

const N_COLS = 8 // A..H (área de impresión de INF)
const PAGE_CONTENT_TWIPS = 10100 // A4 vertical menos márgenes ~0.6"
// Banda de filas donde flota la gráfica en INF (entre condiciones y disclaimer).
const CHART_FROM = 35
const CHART_TO = 44

interface MergeInfo {
  masterR: number
  masterC: number
  rows: number
  cols: number
}

/** Ancho de columna de Excel (caracteres) → twips. */
function colToTwips(width: number | undefined): number {
  const px = Math.round((width ?? 9) * 7 + 5)
  return px * 15
}

/** Color de exceljs (argb 'FFxxxxxx' o {argb}) → hex docx 'xxxxxx', o undefined. */
function hex(color: Partial<ExcelJS.Color> | undefined): string | undefined {
  const argb = color?.argb
  if (!argb || typeof argb !== 'string') return undefined
  return argb.length === 8 ? argb.slice(2) : argb
}

/** Estilo de borde exceljs → grosor docx (eighth-points). Sin borde → 0. */
function borderSize(style: string | undefined): number {
  if (!style) return 0
  if (style === 'hair') return 2
  if (style === 'thin') return 4
  if (style === 'medium') return 8
  if (style === 'thick') return 12
  return 4
}

function side(b: Partial<ExcelJS.Border> | undefined): {
  style: (typeof BorderStyle)[keyof typeof BorderStyle]
  size: number
  color: string
} {
  const sz = borderSize(b?.style)
  return sz
    ? { style: BorderStyle.SINGLE, size: sz, color: hex(b?.color) ?? '000000' }
    : { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }
}

/** Texto a mostrar respetando el formato numérico (decimales) y coma decimal española. */
function display(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'number') {
    const nf = cell.numFmt || ''
    let dec: number
    const m = nf.match(/[0#]\.([0#]+)/)
    if (m) dec = m[1].length
    else dec = Number.isInteger(v) ? 0 : 1
    return v.toFixed(dec).replace('.', ',')
  }
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('')
    return cell.text ?? ''
  }
  return String(v)
}

export async function infSheetToWord(
  xlsxBuf: Buffer,
  logo: Img,
  chart: Img | null,
  sheetName = 'INF',
  lastRow = 63
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(xlsxBuf as unknown as ArrayBuffer)
  const ws = wb.getWorksheet(sheetName)
  if (!ws) throw new Error(`Hoja ${sheetName} no encontrada en el libro`)

  // ── Celdas combinadas ──
  const mergeMaster = new Map<string, MergeInfo>() // "r,c" master → info
  const covered = new Map<string, MergeInfo>() // "r,c" cubierta → su master
  const ranges = ((ws as unknown as { model?: { merges?: string[] } }).model?.merges ?? []) as string[]
  for (const ref of ranges) {
    const [a, b] = ref.split(':')
    const s = ws.getCell(a)
    const e = ws.getCell(b)
    const mr = Number(s.row)
    const mc = Number(s.col)
    const info: MergeInfo = { masterR: mr, masterC: mc, rows: Number(e.row) - mr + 1, cols: Number(e.col) - mc + 1 }
    mergeMaster.set(`${mr},${mc}`, info)
    for (let r = mr; r <= Number(e.row); r++)
      for (let c = mc; c <= Number(e.col); c++) if (r !== mr || c !== mc) covered.set(`${r},${c}`, info)
  }

  // ── Anchos de columna escalados al ancho de página ──
  const rawTw: number[] = []
  for (let c = 1; c <= N_COLS; c++) rawTw.push(colToTwips(ws.getColumn(c).width))
  const totalRaw = rawTw.reduce((a, b) => a + b, 0) || PAGE_CONTENT_TWIPS
  const scale = PAGE_CONTENT_TWIPS / totalRaw
  const colTw = rawTw.map((t) => Math.max(120, Math.round(t * scale)))

  const cellFor = (r: number, c: number): TableCell => {
    const cell = ws.getCell(r, c)
    const merge = mergeMaster.get(`${r},${c}`)
    const span = merge ? merge.cols : 1
    const widthDxa = colTw.slice(c - 1, c - 1 + span).reduce((a, b) => a + b, 0)
    const font = cell.font ?? {}
    const fill = hex((cell.fill as ExcelJS.FillPattern)?.fgColor)
    const b = cell.border ?? {}
    const align =
      cell.alignment?.horizontal === 'right'
        ? AlignmentType.RIGHT
        : cell.alignment?.horizontal === 'left'
          ? AlignmentType.LEFT
          : AlignmentType.CENTER
    const runs = display(cell)
      .split('\n')
      .map((ln, i) => new TextRun({
        text: ln,
        bold: !!font.bold,
        italics: !!font.italic,
        size: Math.round((font.size ?? 9) * 2),
        color: hex(font.color) ?? '000000',
        font: font.name || undefined,
        break: i ? 1 : undefined
      }))
    return new TableCell({
      width: { size: widthDxa, type: WidthType.DXA },
      columnSpan: span > 1 ? span : undefined,
      verticalMerge: merge && merge.rows > 1 ? VerticalMergeType.RESTART : undefined,
      ...(fill ? { shading: { type: ShadingType.SOLID, fill } } : {}),
      borders: { top: side(b.top), bottom: side(b.bottom), left: side(b.left), right: side(b.right) },
      verticalAlign: 'center',
      children: [new Paragraph({ alignment: align, spacing: { before: 10, after: 10 }, children: runs })]
    })
  }

  // Celda de continuación vertical (parte inferior de una combinación que abarca filas).
  const vContinue = (c: number, span: number): TableCell =>
    new TableCell({
      width: { size: colTw.slice(c - 1, c - 1 + span).reduce((a, b) => a + b, 0), type: WidthType.DXA },
      columnSpan: span > 1 ? span : undefined,
      verticalMerge: VerticalMergeType.CONTINUE,
      children: [new Paragraph({})]
    })

  const rows: TableRow[] = []
  for (let r = 2; r <= lastRow; r++) {
    // Banda de la gráfica: una celda que abarca todo el ancho y, en r=CHART_FROM, la imagen.
    if (chart && r >= CHART_FROM && r <= CHART_TO) {
      const cells =
        r === CHART_FROM
          ? [
              new TableCell({
                columnSpan: N_COLS,
                verticalMerge: VerticalMergeType.RESTART,
                borders: { top: side(undefined), bottom: side(undefined), left: side(undefined), right: side(undefined) },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new ImageRun({
                        type: 'png',
                        data: chart.data,
                        transformation: { width: 540, height: Math.round((540 * chart.height) / chart.width) }
                      })
                    ]
                  })
                ]
              })
            ]
          : [new TableCell({ columnSpan: N_COLS, verticalMerge: VerticalMergeType.CONTINUE, children: [new Paragraph({})] })]
      rows.push(new TableRow({ children: cells }))
      continue
    }

    const cells: TableCell[] = []
    for (let c = 1; c <= N_COLS; c++) {
      const cov = covered.get(`${r},${c}`)
      if (cov) {
        // Cubierta por una combinación: si es vertical y estamos en su columna izquierda, continuar.
        if (c === cov.masterC && r > cov.masterR) cells.push(vContinue(c, cov.cols))
        // (cobertura horizontal o interior → no se emite celda)
        continue
      }
      cells.push(cellFor(r, c))
    }
    const h = ws.getRow(r).height
    rows.push(new TableRow({ children: cells, ...(h ? { height: { value: Math.round(h * 20), rule: 'atLeast' } } : {}) }))
  }

  const logoH = Math.round((PAGE_CONTENT_TWIPS / 15) * (logo.height / logo.width)) // px

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 }, // A4 vertical (twips)
            margin: { top: 850, bottom: 850, left: 850, right: 850 }
          }
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ children: ['Página ', PageNumber.CURRENT, '/', PageNumber.TOTAL_PAGES], size: 14, color: '595959' })]
              })
            ]
          })
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 60 },
            children: [
              new ImageRun({
                type: 'jpg',
                data: logo.data,
                transformation: { width: Math.round(PAGE_CONTENT_TWIPS / 15), height: logoH }
              })
            ]
          }),
          new Table({
            layout: TableLayoutType.FIXED,
            columnWidths: colTw,
            width: { size: colTw.reduce((a, b) => a + b, 0), type: WidthType.DXA },
            rows
          })
        ]
      }
    ]
  })
  return Buffer.from(await Packer.toBuffer(doc))
}
