/**
 * Genera el informe Word de Toma de Hormigón / Control de Hormigón Fresco.
 * Replica fielmente el formato del informe CYE (una sola página A4):
 *   · Cabecera con logo CYE + título "INFORME DE ENSAYO / CONTROL DE HORMIGÓN FRESCO"
 *   · Datos del albarán de la cuba (cuadrícula 2 columnas)
 *   · Toma de hormigón (operador, conos, compactación)
 *   · Tabla de resultados de compresión (variable nº de probetas)
 *   · Notas de conservación, pie legal y firma
 *
 * Usa el paquete `docx` v9 — generación puramente en código, sin plantilla .docx.
 */
import { readFileSync } from 'fs'
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
  convertMillimetersToTwip
} from 'docx'
import type { Ensayo, Obra } from '../../db'

// ── Paleta CYE ────────────────────────────────────────────────────────────────

const NAVY = '1B2A4A'
const NAVY_LIGHT = 'D6E4F0'
const WHITE = 'FFFFFF'
const GRAY_TEXT = '555555'
const GREEN = '27AE60'
const RED = 'E74C3C'

// ── Helpers ───────────────────────────────────────────────────────────────────

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

function toN(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

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

function navyShading(): { type: typeof ShadingType.SOLID; color: string; fill: string } {
  return { type: ShadingType.SOLID, color: NAVY, fill: NAVY }
}

function lightShading(): { type: typeof ShadingType.SOLID; color: string; fill: string } {
  return { type: ShadingType.SOLID, color: NAVY_LIGHT, fill: NAVY_LIGHT }
}

/** Celda de cabecera de sección (fondo azul marino, texto blanco). */
function sectionHeaderRow(text: string, cols: number): TableRow {
  return new TableRow({
    children: [
      new TableCell({
        columnSpan: cols,
        shading: navyShading(),
        borders: noBorder,
        children: [
          new Paragraph({
            children: [new TextRun({ text, bold: true, color: WHITE, size: 18 })],
            spacing: { before: 40, after: 40 }
          })
        ]
      })
    ]
  })
}

/** Fila de campo: etiqueta (fondo suave) + valor. Puede ir en pares side-by-side. */
function fieldRow(pairs: Array<{ label: string; value: string }>, widths: number[]): TableRow {
  const cells: TableCell[] = []
  pairs.forEach(({ label, value }, i) => {
    cells.push(
      new TableCell({
        width: { size: widths[i * 2] ?? 2500, type: WidthType.DXA },
        shading: lightShading(),
        borders: thinBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            children: [new TextRun({ text: label, bold: true, size: 16, color: NAVY })],
            spacing: { before: 30, after: 30 }
          })
        ]
      }),
      new TableCell({
        width: { size: widths[i * 2 + 1] ?? 2500, type: WidthType.DXA },
        borders: thinBorder,
        verticalAlign: VerticalAlign.CENTER,
        children: [
          new Paragraph({
            children: [new TextRun({ text: value, size: 16 })],
            spacing: { before: 30, after: 30 }
          })
        ]
      })
    )
  })
  return new TableRow({ children: cells })
}

/** Genera la tabla "DATOS DEL ALBARÁN DE LA CUBA DE HORMIGÓN". */
function datosAlbaranTable(datos: Record<string, unknown>, _obra: Obra): Table {
  const ident = (datos.identificacion as Record<string, unknown>) ?? {}
  const camion = (datos.camion as Record<string, unknown>) ?? {}
  const comp = (datos.composicion as Record<string, unknown>) ?? {}

  // Anchuras relativas (DXA = twentieths of a point); total ≈ 9360 (16cm body width A4)
  const W = [1400, 2000, 1400, 2000, 1400, 2000] // 3 pares por fila
  const W2 = [1400, 3000, 1400, 3000]             // 2 pares por fila

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder,
    rows: [
      sectionHeaderRow('DATOS DEL ALBARÁN DE LA CUBA DE HORMIGÓN (Datos facilitados por cliente)', 6),
      fieldRow([
        { label: 'Planta:', value: toStr(camion.central) },
        { label: 'Camión:', value: toStr(camion.matricula) },
        { label: 'Albarán:', value: toStr(camion.albaran_central) }
      ], W),
      fieldRow([
        { label: 'Tipo Hormigón:', value: toStr(ident.tipo_hormigon) },
        { label: 'Tipo Planta:', value: toStr(camion.tipo_planta) || 'Desconocida' },
        { label: 'Consistencia:', value: toStr(camion.consistencia) }
      ], W),
      fieldRow([
        { label: 'Fecha:', value: toStr(ident.fecha_toma) },
        { label: 'Hora Fabr.:', value: toStr(camion.hora_salida) },
        { label: 'Límite uso:', value: toStr(datos.limite_uso) ? `${toStr(datos.limite_uso)}h` : '' }
      ], W),
      fieldRow([
        { label: 'M³ sum.:', value: toStr(camion.volumen_m3) },
        { label: 'T.máx.árido:', value: toStr(camion.t_max_arido) ? `${toStr(camion.t_max_arido)} mm` : '' },
        { label: 'Cemento:', value: toStr(comp.tipo_cemento) }
      ], W),
      fieldRow([
        { label: 'Marca:', value: toStr(comp.marca_cemento) },
        { label: 'Aditivo/s:', value: toStr(comp.aditivo) }
      ], W2),
      fieldRow([
        { label: 'Adiciones:', value: toStr(comp.adiciones) },
        { label: 'Contenido cem./m³:', value: toStr(comp.contenido_cemento_m3) ? `${toStr(comp.contenido_cemento_m3)} Kg` : '' }
      ], W2),
      fieldRow([
        { label: 'Relación a/c:', value: toStr(comp.relacion_ac) },
        { label: 'Observ.:', value: toStr(datos.observaciones) }
      ], W2)
    ]
  })
}

/** Construye la cadena de probetas: "Cil. 5 / Pris. 0 / Cúb. 0" o fallback a cantidad+tipo. */
function buildProbetasStr(prob: Record<string, unknown>): string {
  const cil = toStr(prob.n_cilindricas)
  const pris = toStr(prob.n_prismaticas)
  const cub = toStr(prob.n_cubicas)
  if (cil || pris || cub) {
    const parts: string[] = []
    if (cil && cil !== '0') parts.push(`Cil. ${cil}`)
    if (pris && pris !== '0') parts.push(`Pris. ${pris}`)
    if (cub && cub !== '0') parts.push(`Cúb. ${cub}`)
    const total = toStr(prob.cantidad)
    const base = parts.length ? parts.join(' / ') : `Total ${total || '?'}`
    return total ? `${base}  (Total: ${total})` : base
  }
  return `${toStr(prob.cantidad)} ${toStr(prob.tipo)}`.trim()
}

/** Genera la tabla "TOMA DE HORMIGÓN". */
function tomaHormigonTable(datos: Record<string, unknown>, responsable: string): Table {
  const ident = (datos.identificacion as Record<string, unknown>) ?? {}
  const camion = (datos.camion as Record<string, unknown>) ?? {}
  const comp = (datos.composicion as Record<string, unknown>) ?? {}
  const conos = (datos.conos as Record<string, unknown>[]) ?? []
  const _prob = (datos.probetas as Record<string, unknown>) ?? {}

  const cono1mm = toStr(conos[0]?.mm)
  const cono2mm = toStr(conos[1]?.mm)
  const media = toStr(datos.asentamiento_media)
  const tipoAs1 = toStr(conos[0]?.observaciones)
  const tipoAs2 = toStr(conos[1]?.observaciones)

  const W = [1400, 2000, 1400, 2000, 1400, 2000]
  const W2 = [1400, 3000, 1400, 3000]

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder,
    rows: [
      sectionHeaderRow(`TOMA DE HORMIGÓN         Operador: ${responsable || toStr(ident.confeccionado_por)}`, 6),
      fieldRow([
        { label: 'Probetas:', value: buildProbetasStr(_prob) },
        { label: 'Hora toma:', value: toStr(ident.hora_toma) },
        { label: 'Tª amb. °C:', value: toStr(comp.t_amb) }
      ], W),
      new TableRow({
        children: [
          // Tª horm
          new TableCell({
            width: { size: 1400, type: WidthType.DXA }, shading: lightShading(), borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: 'Tª hor. °C:', bold: true, size: 16, color: NAVY })], spacing: { before: 30, after: 30 } })]
          }),
          new TableCell({
            width: { size: 900, type: WidthType.DXA }, borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: toStr(comp.t_hormigon), size: 16 })], spacing: { before: 30, after: 30 } })]
          }),
          // Cono Abrams label
          new TableCell({
            columnSpan: 4,
            borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              children: [
                new TextRun({ text: 'Cono Abrams (mm)   M1 ', bold: false, size: 16 }),
                new TextRun({ text: cono1mm || '—', bold: true, size: 16 }),
                new TextRun({ text: '   M2 ', bold: false, size: 16 }),
                new TextRun({ text: cono2mm || '—', bold: true, size: 16 }),
                new TextRun({ text: '   Media ', bold: false, size: 16 }),
                new TextRun({ text: media || '—', bold: true, size: 16 })
              ],
              spacing: { before: 30, after: 30 }
            })]
          })
        ]
      }),
      fieldRow([
        { label: 'Tipo Muestreo:', value: toStr(ident.tipo_muestreo) },
        { label: 'Fecha recogida:', value: toStr(_prob.fecha_recogida || ident.fecha_recogida) }
      ], W2),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1400, type: WidthType.DXA }, shading: lightShading(), borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: 'Tipo asentamiento:', bold: true, size: 16, color: NAVY })], spacing: { before: 30, after: 30 } })]
          }),
          new TableCell({
            columnSpan: 5, borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: [tipoAs1, tipoAs2].filter(Boolean).join('   /   ') || '—', size: 16 })], spacing: { before: 30, after: 30 } })]
          })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1400, type: WidthType.DXA }, shading: lightShading(), borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: 'Método compactación:', bold: true, size: 16, color: NAVY })], spacing: { before: 30, after: 30 } })]
          }),
          new TableCell({
            width: { size: 3200, type: WidthType.DXA }, borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: toStr(ident.tipo_compactacion), size: 16 })], spacing: { before: 30, after: 30 } })]
          }),
          new TableCell({
            width: { size: 1400, type: WidthType.DXA }, shading: lightShading(), borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: 'Obsev.:', bold: true, size: 16, color: NAVY })], spacing: { before: 30, after: 30 } })]
          }),
          new TableCell({
            columnSpan: 3, borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: '', size: 16 })], spacing: { before: 30, after: 30 } })]
          })
        ]
      }),
      new TableRow({
        children: [
          new TableCell({
            width: { size: 1400, type: WidthType.DXA }, shading: lightShading(), borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: 'Elemento hormigonado:', bold: true, size: 16, color: NAVY })], spacing: { before: 30, after: 30 } })]
          }),
          new TableCell({
            columnSpan: 5, borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({ children: [new TextRun({ text: toStr(camion.descripcion_elemento), size: 16 })], spacing: { before: 30, after: 30 } })]
          })
        ]
      })
    ]
  })
}

/** Calcula la media de tensión para cada grupo de edad. Solo aparece en la última probeta del grupo. */
function calcMediasPorEdad(roturas: Record<string, unknown>[]): Map<number, string> {
  // Agrupar índices por edad
  const grupos = new Map<string, number[]>()
  roturas.forEach((r, i) => {
    const edad = toStr(r.edad_dias)
    if (!grupos.has(edad)) grupos.set(edad, [])
    grupos.get(edad)!.push(i)
  })

  const mediaMap = new Map<number, string>() // índice → media (solo último de cada grupo)
  grupos.forEach((indices) => {
    const tensiones = indices
      .map((i) => toN(roturas[i].tension_mpa))
      .filter((v): v is number => v !== null)
    if (tensiones.length === 0) return
    const media = Math.round(tensiones.reduce((a, b) => a + b, 0) / tensiones.length * 10) / 10
    mediaMap.set(indices[indices.length - 1], media.toFixed(1).replace('.', ','))
  })
  return mediaMap
}

/** Genera la tabla de resultados de compresión. */
function resultadosTable(datos: Record<string, unknown>): Table {
  const roturas = (datos.roturas as Record<string, unknown>[]) ?? []
  const _prob = (datos.probetas as Record<string, unknown>) ?? {}
  const ident = (datos.identificacion as Record<string, unknown>) ?? {}

  // Parsear Ø y H del tipo de probeta ("Cilíndricas 150×300mm" → 150, 300)
  const tipoMatch = String(_prob.tipo ?? '').match(/(\d+)[×x](\d+)/)
  const diam = tipoMatch ? tipoMatch[1] : '150'
  const altura = tipoMatch ? tipoMatch[2] : '300'

  const mediaMap = calcMediasPorEdad(roturas)
  const fckManual = toN(datos.fck_manual)
  const fckFromTipo = (() => {
    const m = String(ident.tipo_hormigon ?? '').match(/H[APBR]-(\d+)/i)
    return m ? parseInt(m[1], 10) : null
  })()
  const fck = fckManual ?? fckFromTipo

  // Cabeceras
  const makeHeaderCell = (text: string, rowSpan?: number, colSpan?: number): TableCell =>
    new TableCell({
      rowSpan, columnSpan: colSpan,
      width: { size: 500, type: WidthType.AUTO },
      shading: navyShading(),
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text, bold: true, color: WHITE, size: 14 })],
          spacing: { before: 30, after: 30 }
        })
      ]
    })

  const headRow1 = new TableRow({
    tableHeader: true,
    children: [
      makeHeaderCell('Nº\nPro.', 2),
      makeHeaderCell('Fecha\nRotura', 2),
      makeHeaderCell('Edad', 2),
      makeHeaderCell('Dimensiones mm', undefined, 2),
      makeHeaderCell('Densidad *\nKg/m³', 2),
      makeHeaderCell('Carga\nmáxima\nkN', 2),
      makeHeaderCell('Tensión\nMPa', 2),
      makeHeaderCell('Medias\nMPa', 2),
      makeHeaderCell('Ajuste caras **', undefined, 2)
    ]
  })
  const headRow2 = new TableRow({
    tableHeader: true,
    children: [
      makeHeaderCell('Ø'),
      makeHeaderCell('H'),
      makeHeaderCell('C.Sup.'),
      makeHeaderCell('C.Inf.')
    ]
  })

  const makeDataCell = (text: string, bold = false): TableCell =>
    new TableCell({
      borders: thinBorder,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: text || '', bold, size: 16 })],
          spacing: { before: 20, after: 20 }
        })
      ]
    })

  const dataRows: TableRow[] = roturas.map((r, i) => {
    const media = mediaMap.get(i) ?? ''
    const edadNum = toN(r.edad_dias)
    const edadText = edadNum !== null ? `${Math.round(edadNum)}días` : toStr(r.edad_dias)
    return new TableRow({
      children: [
        makeDataCell(toStr(r.n_probeta)),
        makeDataCell(toStr(r.fecha_rotura)),
        makeDataCell(edadText),
        makeDataCell(diam),
        makeDataCell(altura),
        makeDataCell(toStr(r.densidad_kg_m3)),
        makeDataCell(toStr(r.carga_maxima_kn)),
        makeDataCell(toStr(r.tension_mpa)),
        makeDataCell(media, true),
        makeDataCell(toStr(r.ajuste_c_sup)),
        makeDataCell(toStr(r.ajuste_c_inf))
      ]
    })
  })

  // Fila de veredicto si hay datos de 28d
  const tensiones28 = roturas
    .filter((r) => { const e = toN(r.edad_dias); return e !== null && Math.round(e) === 28 })
    .map((r) => toN(r.tension_mpa))
    .filter((v): v is number => v !== null)

  const veredictoRow: TableRow[] = []
  if (fck !== null && tensiones28.length > 0) {
    const media28 = Math.round(tensiones28.reduce((a, b) => a + b, 0) / tensiones28.length * 100) / 100
    const cumple = media28 >= fck
    veredictoRow.push(
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 8, borders: thinBorder, verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: `fck requerido: ${fck} MPa   ·   Media 28d (${tensiones28.length} probetas): ${String(media28).replace('.', ',')} MPa`, size: 15, color: GRAY_TEXT })],
              spacing: { before: 30, after: 30 }
            })]
          }),
          new TableCell({
            columnSpan: 3, borders: thinBorder,
            shading: cumple
              ? { type: ShadingType.SOLID, color: GREEN, fill: GREEN }
              : { type: ShadingType.SOLID, color: RED, fill: RED },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: cumple ? 'CUMPLE' : 'NO CUMPLE', bold: true, color: WHITE, size: 18 })],
              spacing: { before: 30, after: 30 }
            })]
          })
        ]
      })
    )
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      sectionHeaderRow('RESULTADOS DE RESISTENCIA A COMPRESIÓN EN PROBETAS CILÍNDRICAS', 11),
      headRow1,
      headRow2,
      ...dataRows,
      ...veredictoRow
    ]
  })
}

/** Párrafo de texto pequeño (notas legales, notas de pie). */
function notePara(text: string, bold = false): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, size: 14, color: GRAY_TEXT, bold })],
    spacing: { before: 20, after: 20 }
  })
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function fillTomaHormigonWord(
  ensayo: Ensayo,
  obra: Obra,
  logoPath: string,
  includeResultados = true
): Promise<Buffer> {
  const datos = ensayo.datos as Record<string, unknown>
  const ident = (datos.identificacion as Record<string, unknown>) ?? {}

  // Logo
  const logoBuf = readFileSync(logoPath)

  // Ref ensayo: preferir n_albaran_cye, fallback n_ensayo_obra
  const refEnsayo = toStr(ident.n_albaran_cye) || toStr(ident.n_ensayo_obra)

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Arial', size: 16 }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertMillimetersToTwip(15),
              bottom: convertMillimetersToTwip(15),
              left: convertMillimetersToTwip(15),
              right: convertMillimetersToTwip(15)
            }
          }
        },
        children: [
          // ── Cabecera: logo + título ──
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorder,
            rows: [
              new TableRow({
                children: [
                  // Logo (columna izquierda)
                  new TableCell({
                    width: { size: 2200, type: WidthType.DXA },
                    borders: noBorder,
                    verticalAlign: VerticalAlign.CENTER,
                    children: [
                      new Paragraph({
                        children: [
                          new ImageRun({
                            data: logoBuf,
                            transformation: { width: 110, height: 35 },
                            type: 'jpg'
                          })
                        ]
                      })
                    ]
                  }),
                  // Título central
                  new TableCell({
                    borders: {
                      top: noBorder.top, bottom: noBorder.bottom,
                      left: { style: BorderStyle.SINGLE, size: 6, color: NAVY },
                      right: noBorder.right
                    },
                    shading: navyShading(),
                    verticalAlign: VerticalAlign.CENTER,
                    children: [
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: includeResultados ? 'INFORME DE ENSAYO' : 'ALBARÁN DE TOMA', bold: true, color: WHITE, size: 26 })]
                      }),
                      new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: 'CONTROL DE HORMIGÓN FRESCO', bold: true, color: WHITE, size: 20 })]
                      })
                    ]
                  })
                ]
              })
            ]
          }),

          // ── Título de obra ──
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: toStr(obra.obra), bold: true, size: 18 })],
            spacing: { before: 80, after: 40 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY } }
          }),

          // ── Línea de referencias ──
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorder,
            rows: [
              new TableRow({
                children: [
                  ...([
                    { label: 'Ref. Obra:', value: toStr(ident.ref_obra) },
                    { label: 'Refª Ensayo:', value: refEnsayo },
                    { label: 'Nº Ensayo:', value: toStr(ident.n_ensayo_obra) },
                    { label: 'Nº Trabajo:', value: toStr(ident.n_trabajo) }
                  ].flatMap(({ label, value }) => [
                    new TableCell({
                      width: { size: 1200, type: WidthType.DXA },
                      borders: noBorder,
                      children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 15, color: NAVY })] })]
                    }),
                    new TableCell({
                      width: { size: 1100, type: WidthType.DXA },
                      borders: noBorder,
                      children: [new Paragraph({ children: [new TextRun({ text: value, size: 15 })] })]
                    })
                  ]))
                ]
              })
            ]
          }),

          new Paragraph({ text: '', spacing: { before: 60, after: 0 } }),

          // ── Tabla albarán cuba ──
          datosAlbaranTable(datos, obra),

          new Paragraph({ text: '', spacing: { before: 60, after: 0 } }),

          // ── Tabla toma de hormigón ──
          tomaHormigonTable(datos, ensayo.responsable ?? ''),

          ...(includeResultados ? [
            new Paragraph({ text: '', spacing: { before: 60, after: 0 } }),
            resultadosTable(datos),
            new Paragraph({ text: '', spacing: { before: 60, after: 0 } }),
          ] : [new Paragraph({ text: '', spacing: { before: 60, after: 0 } })]),

          // ── Observaciones generales ──
          ...(toStr(datos.observaciones)
            ? [new Paragraph({
                children: [
                  new TextRun({ text: 'Observaciones: ', bold: true, size: 15 }),
                  new TextRun({ text: toStr(datos.observaciones), size: 15 })
                ],
                spacing: { before: 40, after: 40 }
              })]
            : []),

          // ── Conservación probetas ──
          (() => {
            const conservAmb = datos.conservacion_ambiental !== false
            const tipoTraslado = toStr(datos.tipo_traslado)
            const tiempoObra = toStr(datos.tiempo_estancia_obra)
            const durTraslado = toStr(datos.duracion_traslado)
            const conservObraText = conservAmb
              ? 'Sí — cubiertas con bolsas y arpilleras en las condiciones ambientales de la obra'
              : 'No — conservación acondicionada'
            return new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              borders: noBorder,
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      width: { size: 3000, type: WidthType.DXA }, borders: thinBorder,
                      children: [
                        new Paragraph({ children: [new TextRun({ text: 'Conservación ambiental en Obra:', bold: true, size: 14 })], spacing: { before: 20, after: 6 } }),
                        new Paragraph({ children: [new TextRun({ text: conservObraText, size: 14 })], spacing: { before: 0, after: 20 } })
                      ]
                    }),
                    new TableCell({
                      borders: thinBorder,
                      children: [
                        new Paragraph({ children: [new TextRun({ text: `Tiempo estancia en Obra: ${tiempoObra || '—'}`, size: 14 })], spacing: { before: 20, after: 6 } }),
                        new Paragraph({ children: [new TextRun({ text: `Duración traslado laboratorio: ${durTraslado || '—'}`, size: 14 })], spacing: { before: 0, after: 6 } }),
                        ...(tipoTraslado ? [new Paragraph({ children: [new TextRun({ text: `Tipo traslado: ${tipoTraslado}`, size: 14 })], spacing: { before: 0, after: 20 } })] : [new Paragraph({ spacing: { before: 0, after: 20 }, children: [] })])
                      ]
                    })
                  ]
                }),
                new TableRow({
                  children: [
                    new TableCell({
                      columnSpan: 2, borders: thinBorder,
                      children: [new Paragraph({
                        children: [
                          new TextRun({ text: 'Conservación Probetas en Laboratorio: ', bold: true, size: 14 }),
                          new TextRun({ text: 'Cámara húmeda (Tª: 20 ±2ºC y HR > 95 %)     Precisión de la máquina de ensayo empleada: CLASE 1', size: 14 })
                        ],
                        spacing: { before: 20, after: 20 }
                      })]
                    })
                  ]
                })
              ]
            })
          })(),

          ...(includeResultados ? [
            new Paragraph({ text: '', spacing: { before: 40, after: 0 } }),
            notePara('* Cálculo de la densidad: Una vez extraída la probeta de la cámara húmeda antes de su refrentado. El volumen es determinado a través de sus: Dimensiones nominales'),
            notePara('** Ajuste de las caras en el momento del ensayo:  a Refrentado mortero azufre   b Refrentado mortero cemento   c Pulido   d Caja de arena   e Moldeada'),
            new Paragraph({ text: '', spacing: { before: 40, after: 0 } }),
          ] : [new Paragraph({ text: '', spacing: { before: 40, after: 0 } })]),

          // ── Texto legal ──
          notePara('Ensayos según UNE EN 12350-1 y 2:2020, 12390-1:2022, 12390-2 y 3:2020, 12390-7:2020 y AC2021'),
          notePara('- CYE CONTROL Y ESTUDIOS, S.L. no se hace responsable de la información aportada por el cliente y esta no se encuentra amparada por la Acreditación.'),
          notePara('- Las incertidumbres expandidas K=2 son: Cono Abrams: ±9%; Compresión: ±5%; Densidad: ±6%. K=2 representa un valor de confianza aprox. del 95% para una distribución normal.'),
          notePara('- Los resultados de este Informe sólo afectan al material sometido a ensayo.'),
          notePara('- Este informe no deberá reproducirse parcialmente sin la aprobación de CYE CONTROL Y ESTUDIOS, S.L.'),
          notePara('- Laboratorio habilitado por la Xunta de Galicia e inscrito en el Registro General del CTE como LECCE con Nº: GAL-L-005 en las áreas de actuación: GT, VS, PS, EH, EA y EFA'),

          new Paragraph({ text: '', spacing: { before: 60, after: 0 } }),

          // ── Firma ──
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: noBorder,
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    borders: noBorder,
                    children: [
                      new Paragraph({ children: [new TextRun({ text: `Narón (A CORUÑA), ${toStr(ident.fecha_recogida) || ''}`, size: 15 })], spacing: { before: 40, after: 20 } }),
                      new Paragraph({ children: [new TextRun({ text: 'Por el Director Técnico', size: 15 })], spacing: { before: 0, after: 20 } }),
                      new Paragraph({ children: [new TextRun({ text: `Fdo.: ${ensayo.responsable || ''}`, bold: true, size: 15 })], spacing: { before: 40, after: 0 } })
                    ]
                  }),
                  new TableCell({
                    borders: noBorder,
                    children: [
                      new Paragraph({ children: [new TextRun({ text: `Cliente: ${toStr(obra.cliente) || ''}`, bold: true, size: 15 })], spacing: { before: 40, after: 20 } }),
                      new Paragraph({ children: [new TextRun({ text: toStr(obra.ref_lab ?? ''), size: 14, color: GRAY_TEXT })], spacing: { before: 0, after: 20 } }),
                      new Paragraph({ children: [new TextRun({ text: 'Envío de copias a:', size: 14, color: GRAY_TEXT })], spacing: { before: 0, after: 0 } })
                    ]
                  })
                ]
              })
            ]
          })
        ]
      }
    ]
  })

  return (await Packer.toBuffer(doc)) as Buffer
}
