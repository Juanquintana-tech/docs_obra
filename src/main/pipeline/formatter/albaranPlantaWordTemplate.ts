/**
 * Genera el documento Word de registro de albarán de planta de hormigón.
 * Produce un resumen estructurado (una página A4) de todos los datos
 * capturados del albarán de entrega de la central hormigonera.
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

const NAVY   = '1B2A4A'
const NAVY_L = 'D6E4F0'
const WHITE  = 'FFFFFF'
const GRAY   = '555555'

// ── Helpers ───────────────────────────────────────────────────────────────────

function s(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

const noBorder = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'auto' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'auto' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'auto' }
} as const

const thin = {
  top:    { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  left:   { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' },
  right:  { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA' }
} as const

const navy  = (): { type: typeof ShadingType.SOLID; color: string; fill: string } =>
  ({ type: ShadingType.SOLID, color: NAVY, fill: NAVY })
const light = (): { type: typeof ShadingType.SOLID; color: string; fill: string } =>
  ({ type: ShadingType.SOLID, color: NAVY_L, fill: NAVY_L })

/** Fila de encabezado de sección. */
function secRow(text: string, cols: number): TableRow {
  return new TableRow({
    children: [new TableCell({
      columnSpan: cols,
      shading: navy(),
      borders: noBorder,
      children: [new Paragraph({
        children: [new TextRun({ text, bold: true, color: WHITE, size: 18 })],
        spacing: { before: 40, after: 40 }
      })]
    })]
  })
}

/** Celda etiqueta (fondo suave). */
function lbl(text: string, w: number): TableCell {
  return new TableCell({
    width: { size: w, type: WidthType.DXA },
    shading: light(),
    borders: thin,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text, bold: true, size: 16, color: NAVY })],
      spacing: { before: 30, after: 30 }
    })]
  })
}

/** Celda de valor. */
function val(text: string, w?: number, span?: number): TableCell {
  return new TableCell({
    ...(w ? { width: { size: w, type: WidthType.DXA } } : {}),
    ...(span ? { columnSpan: span } : {}),
    borders: thin,
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text: text || '—', size: 16 })],
      spacing: { before: 30, after: 30 }
    })]
  })
}

/** Fila de dos pares label+valor. */
function row2(
  l1: string, v1: string, w1l: number, w1v: number,
  l2: string, v2: string, w2l: number, w2v: number
): TableRow {
  return new TableRow({ children: [lbl(l1, w1l), val(v1, w1v), lbl(l2, w2l), val(v2, w2v)] })
}

/** Fila de un par label+valor que ocupa todo el ancho. */
function row1(label: string, value: string, wl: number): TableRow {
  return new TableRow({ children: [lbl(label, wl), val(value, undefined, 3)] })
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function fillAlbaranPlantaWord(
  ensayo: Ensayo,
  obra: Obra,
  logoPath: string
): Promise<Buffer> {
  const d = ensayo.datos as Record<string, unknown>
  const logoBuf = readFileSync(logoPath)

  // Anchos de columna (twips); tabla de 4 columnas, total ≈ 9360
  const WL = 1600  // etiqueta estrecha
  const WV = 3080  // valor
  const WLw = 1600
  const WVw = 3080

  const mainTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: noBorder,
    rows: [
      // ── IDENTIFICACIÓN ──
      secRow('IDENTIFICACIÓN DEL ALBARÁN', 4),
      row2('Nº Albarán planta:', s(d.n_albaran_planta), WL, WV, 'Nº Serie/lateral:', s(d.n_serie), WLw, WVw),
      row2('Fecha:', s(d.fecha), WL, WV, 'Central / Planta:', s(d.planta), WLw, WVw),
      row2('Ref. Albarán CYE:', s(d.n_albaran_cye), WL, WV, '', '', WLw, WVw),

      // ── CLIENTE Y OBRA ──
      secRow('CLIENTE Y OBRA', 4),
      row1('Cliente:', s(d.cliente), WL),
      row1('Obra:', s(d.obra), WL),
      row2('Elemento hormigonado:', s(d.elemento_hormigonado), WL, WV, 'M³ entregados:', s(d.m3_entregados), WLw, WVw),

      // ── CAMIÓN Y TRANSPORTE ──
      secRow('CAMIÓN Y TRANSPORTE', 4),
      row2('Matrícula:', s(d.matricula), WL, WV, 'Transportista:', s(d.transportista), WLw, WVw),
      row2('Hora carga:', s(d.hora_carga), WL, WV, 'Hora llegada obra:', s(d.hora_llegada), WLw, WVw),
      row2('Hora inicio descarga:', s(d.hora_inicio_descarga), WL, WV, 'Hora salida obra:', s(d.hora_salida_obra), WLw, WVw),
      row2('Límite de uso:', s(d.tiempo_limite_uso), WL, WV, '', '', WLw, WVw),

      // ── COMPOSICIÓN ──
      secRow('TIPO DE HORMIGÓN Y COMPOSICIÓN', 4),
      row2('Tipo de hormigón:', s(d.tipo_hormigon), WL, WV, 'Tª hormigón (°C):', s(d.t_hormigon), WLw, WVw),
      row2('Cemento (tipo y marca):', s(d.cemento_tipo), WL, WV, 'Cemento (kg/m³):', s(d.cemento_kg_m3), WLw, WVw),
      row2('Relación a/c:', s(d.relacion_ac), WL, WV, 'Tolerancia a/c (±):', s(d.tolerancia_ac), WLw, WVw),
      row1('Aditivo(s) y dosis:', s(d.aditivos), WL),
      row1('Adiciones:', s(d.adiciones), WL),

      // ── CONTROL RECEPCIÓN ──
      secRow('CONTROL DE RECEPCIÓN EN OBRA', 4),
      row2('Cono Abrams recepción (mm):', s(d.cono_mm), WL, WV, '', '', WLw, WVw),
      row1('Observaciones:', s(d.observaciones), WL)
    ]
  })

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Arial', size: 16 } } } },
    sections: [{
      properties: {
        page: {
          margin: {
            top:    convertMillimetersToTwip(15),
            bottom: convertMillimetersToTwip(15),
            left:   convertMillimetersToTwip(15),
            right:  convertMillimetersToTwip(15)
          }
        }
      },
      children: [
        // ── Cabecera: logo + título ──
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorder,
          rows: [new TableRow({ children: [
            new TableCell({
              width: { size: 2200, type: WidthType.DXA },
              borders: noBorder,
              verticalAlign: VerticalAlign.CENTER,
              children: [new Paragraph({ children: [new ImageRun({ data: logoBuf, transformation: { width: 110, height: 35 }, type: 'jpg' })] })]
            }),
            new TableCell({
              borders: {
                top: noBorder.top, bottom: noBorder.bottom,
                left: { style: BorderStyle.SINGLE, size: 6, color: NAVY },
                right: noBorder.right
              },
              shading: navy(),
              verticalAlign: VerticalAlign.CENTER,
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: 'REGISTRO DE ALBARÁN DE PLANTA', bold: true, color: WHITE, size: 26 })]
                }),
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [new TextRun({ text: 'HORMIGÓN SUMINISTRADO EN OBRA', bold: true, color: WHITE, size: 20 })]
                })
              ]
            })
          ]})]
        }),

        // ── Subtítulo obra ──
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: s(obra.obra), bold: true, size: 18 })],
          spacing: { before: 80, after: 40 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: NAVY } }
        }),

        new Paragraph({ text: '', spacing: { before: 60, after: 0 } }),

        // ── Tabla principal ──
        mainTable,

        new Paragraph({ text: '', spacing: { before: 60, after: 0 } }),

        // ── Nota legal ──
        new Paragraph({
          children: [new TextRun({ text: 'Registro interno CYE. Datos trasladados del albarán de entrega original de la central hormigonera. El documento original permanece en el expediente de obra.', size: 14, color: GRAY })],
          spacing: { before: 20, after: 20 }
        }),

        new Paragraph({ text: '', spacing: { before: 40, after: 0 } }),

        // ── Firma ──
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: noBorder,
          rows: [new TableRow({ children: [
            new TableCell({
              borders: noBorder,
              children: [
                new Paragraph({ children: [new TextRun({ text: `Narón (A CORUÑA), ${s(d.fecha)}`, size: 15 })], spacing: { before: 40, after: 20 } }),
                new Paragraph({ children: [new TextRun({ text: `Registrado por: ${ensayo.responsable || ''}`, bold: true, size: 15 })], spacing: { before: 0, after: 0 } })
              ]
            }),
            new TableCell({
              borders: noBorder,
              children: [
                new Paragraph({ children: [new TextRun({ text: `Cliente: ${s(obra.cliente)}`, bold: true, size: 15 })], spacing: { before: 40, after: 20 } }),
                new Paragraph({ children: [new TextRun({ text: s(obra.direccion ?? ''), size: 14, color: GRAY })], spacing: { before: 0, after: 0 } })
              ]
            })
          ]})]
        })
      ]
    }]
  })

  return (await Packer.toBuffer(doc)) as Buffer
}
