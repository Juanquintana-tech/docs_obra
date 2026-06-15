/**
 * Generación de informes de ensayo en Word y Excel con membrete CYE.
 *
 * Port de cye-demo/informes.py a TypeScript.
 * Word → librería `docx`; Excel → `exceljs`.
 */
import {
  Document, Packer, Paragraph, Table, TableRow, TableCell,
  TextRun, WidthType, AlignmentType, BorderStyle, ShadingType,
  convertInchesToTwip, TableLayoutType
} from 'docx'
import ExcelJS from 'exceljs'
import type { Ensayo, Obra } from '../db'
import {
  computeDensidad, computePlaca, TIPOS, toFloat,
  type DensidadInput, type PlacaInput
} from './ensayos'

// ── Constantes corporativas ──────────────────────────────────────────────────
const NAVY = '1F3864'
const ORANGE = 'E36C09'
const MID = '2E75B6'
const LIGHT = 'D6E4F0'
const GREY = '595959'

const ADDRESS =
  'Polígono de La Gándara, Avda del Mar nº 123\n15570 NARÓN (A Coruña)\n' +
  'Tfno: 981 37 11 36   Fax: 981 37 11 04\ne-mail: cye@controlyestudios.es'

const HABILITACION =
  'Laboratorio habilitado por la Xunta de Galicia e inscrito en el Registro General del CTE ' +
  'como LECCE con Nº: GAL-L-005 en las áreas de actuación: GT, VS, PS, EH, EA y EFA'

const DIRECTOR_DEFAULT = 'Gonzalo J. Guzmán'
const JEFE_DEFAULT = 'María Díaz Calvo'

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: unknown, dec = 2): string {
  const n = toFloat(v)
  if (n === null) return ''
  return n.toFixed(dec).replace('.', ',')
}

const THIN_BORDER = { style: BorderStyle.SINGLE, size: 4, color: '888888' }

function hdrCell(text: string, fill = MID): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, fill },
    borders: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text, bold: true, size: 15, color: 'FFFFFF' })]
      })
    ]
  })
}

function dataCell(text: string, bold = false, align: 'center' | 'left' | 'right' = 'center', fill?: string): TableCell {
  const cell = new TableCell({
    borders: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
    ...(fill ? { shading: { type: ShadingType.SOLID, fill } } : {}),
    children: [
      new Paragraph({
        alignment:
          align === 'left'
            ? AlignmentType.LEFT
            : align === 'right'
              ? AlignmentType.RIGHT
              : AlignmentType.CENTER,
        spacing: { before: 30, after: 30 },
        children: [new TextRun({ text: text ?? '', bold, size: 16 })]
      })
    ]
  })
  return cell
}

function letterheadSection(obra: string): Paragraph[] {
  return [
    new Paragraph({
      children: [
        new TextRun({ text: 'CYE — Control y Estudios', bold: true, size: 24, color: ORANGE }),
        new TextRun({ text: `\n${ADDRESS}`, size: 15, color: GREY })
      ]
    }),
    new Paragraph({
      children: [new TextRun({ text: `Obra: ${obra}`, bold: true, size: 18, color: NAVY })],
      spacing: { before: 100, after: 80 }
    })
  ]
}

function titlePar(text: string): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 100 },
    children: [new TextRun({ text, bold: true, size: 22, color: NAVY })]
  })
}

function infoRow(pairs: [string, string][]): Table {
  const cells = pairs.map(([k, v]) =>
    new TableCell({
      borders: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
      children: [
        new Paragraph({
          spacing: { before: 20, after: 20 },
          children: [
            new TextRun({ text: `${k}: `, bold: true, size: 15 }),
            new TextRun({ text: v, size: 15 })
          ]
        })
      ]
    })
  )
  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: cells })]
  })
}

function signaturesPar(director: string, jefe: string): Paragraph {
  return new Paragraph({
    spacing: { before: 400 },
    children: [
      new TextRun({ text: 'VºBº EL DIRECTOR DEL LABORATORIO', bold: true, size: 17, color: NAVY }),
      new TextRun({ text: `\t\t\t`, break: 0 }),
      new TextRun({ text: 'EL JEFE DE ÁREA VS', bold: true, size: 17, color: NAVY }),
      new TextRun({ text: `\n\n\nFdo.: ${director}`, size: 17 }),
      new TextRun({ text: `\t\t\t\tFdo.: ${jefe}`, size: 17 })
    ]
  })
}

function condicionRow(texto: string, criterio: string, cumple: boolean | null): TableRow {
  const fill = cumple === true ? 'DCFCE7' : cumple === false ? 'FEE2E2' : 'FFFFFF'
  const verdict = cumple === true ? 'CUMPLE' : cumple === false ? 'NO CUMPLE' : '—'
  return new TableRow({
    children: [
      dataCell(texto, false, 'left'),
      dataCell(criterio, false, 'center'),
      dataCell(verdict, true, 'center', fill)
    ]
  })
}

// ══════════════════════════════════════════════════════════════════════════════
// DENSIDAD IN SITU — Word
// ══════════════════════════════════════════════════════════════════════════════

function densidadWord(datos: DensidadInput & Record<string, unknown>, obra: Obra): Buffer {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const calc = computeDensidad(datos)

  const dataRows = calc.rows.map(
    (r) =>
      new TableRow({
        children: [
          dataCell(String(r.n), true),
          dataCell(fmt(r.d_max, 3)),
          dataCell(fmt(r.h_opt, 1)),
          dataCell(fmt(r.d_situ, 3)),
          dataCell(fmt(r.h_situ, 2)),
          dataCell(fmt(r.compactacion, 1), true)
        ]
      })
  )

  const LGREY = 'EFEFEF'
  const resumenRows = [
    new TableRow({
      children: [
        dataCell('MEDIA LOTE', true, 'right', LGREY),
        dataCell('', false, 'center', LGREY),
        dataCell('', false, 'center', LGREY),
        dataCell(fmt(calc.media_d_situ, 3), true, 'center', LGREY),
        dataCell(fmt(calc.media_h_situ, 1), true, 'center', LGREY),
        dataCell(fmt(calc.media_compactacion, 1), true, 'center', LGREY)
      ]
    }),
    new TableRow({
      children: [
        dataCell('CV LOTE V%', true, 'right', LGREY),
        dataCell('', false, 'center', LGREY),
        dataCell('', false, 'center', LGREY),
        dataCell(fmt(calc.cv_densidad, 1), true, 'center', LGREY),
        dataCell(fmt(calc.cv_humedad, 1), true, 'center', LGREY),
        dataCell('—', false, 'center', LGREY)
      ]
    })
  ]

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: convertInchesToTwip(0.7), bottom: convertInchesToTwip(0.7), left: convertInchesToTwip(0.8), right: convertInchesToTwip(0.8) } } },
        children: [
          ...letterheadSection(obra.obra),
          titlePar(TIPOS.densidad_in_situ.tituloInforme),
          infoRow([
            ['Ref. Obra', obra.ref_lab || cab.ref_obra || ''],
            ['Orden trabajo', cab.orden_trabajo || ''],
            ['Capa', cab.capa || '']
          ]),
          infoRow([
            ['Localización (PK)', cab.localizacion || ''],
            ['Nº Lote', cab.n_lote || ''],
            ['Fecha ensayo', cab.fecha_ensayo || '']
          ]),
          new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: 'RESULTADOS OBTENIDOS:', bold: true, size: 18, color: NAVY })] }),
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  hdrCell('Nº'),
                  hdrCell('D.Máx\n(g/cm³)'),
                  hdrCell('H.Ópt\n(%)'),
                  hdrCell('D.in situ\n(g/cm³)'),
                  hdrCell('H.in situ\n(%)'),
                  hdrCell('Compact.\n(%)')
                ]
              }),
              ...dataRows,
              ...resumenRows
            ]
          }),
          new Paragraph({ spacing: { before: 80 } }),
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              condicionRow(
                `Cond.1: % Compact. media del lote (${fmt(calc.media_compactacion, 1)} %)`,
                `≥ ${fmt(calc.compactacion_min, 0)} %`,
                calc.cond1
              ),
              condicionRow(
                `Cond.2: Densidad mín. del lote (${fmt(calc.d_situ_minima, 3)} g/cm³)`,
                `≥ ${fmt(calc.d_min_admisible, 3)} g/cm³`,
                calc.cond2
              ),
              condicionRow(
                'Cond.3: 60 % de los puntos en zona de isosaturación (gráfica)',
                'Art. 330.6.5.4 PG-3',
                calc.cond3
              )
            ]
          }),
          new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `VEREDICTO: ${calc.veredicto}`, bold: true, size: 22, color: calc.veredicto === 'CUMPLE' ? '15803D' : 'B91C1C' })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: HABILITACION, size: 14, color: GREY, italics: true })] }),
          signaturesPar(cab.director || DIRECTOR_DEFAULT, cab.jefe_area || JEFE_DEFAULT)
        ]
      }
    ]
  })

  return Buffer.from(Packer.toBuffer(doc) as unknown as ArrayBuffer)
}

// ══════════════════════════════════════════════════════════════════════════════
// PLACA DE CARGA — Word
// ══════════════════════════════════════════════════════════════════════════════

function placaWord(datos: PlacaInput & Record<string, unknown>, obra: Obra): Buffer {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const calc = computePlaca(datos as PlacaInput)

  function cicloRows(label: string, filas: typeof calc.ciclo1): TableRow[] {
    const sep = new TableRow({
      children: [
        new TableCell({
          columnSpan: 5,
          shading: { type: ShadingType.SOLID, fill: LIGHT },
          borders: { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: label, bold: true, size: 15 })] })]
        })
      ]
    })
    const data = filas.map(
      (r) =>
        new TableRow({
          children: [
            dataCell(fmt(r.presion, 2), true),
            dataCell(fmt(r.l1, 2)),
            dataCell(fmt(r.l2, 2)),
            dataCell(fmt(r.l3, 2)),
            dataCell(fmt(r.asiento_medio, 2), true)
          ]
        })
    )
    return [sep, ...data]
  }

  const ratioOk = calc.ratio !== null && calc.ratio <= calc.ratio_max

  const doc = new Document({
    sections: [
      {
        properties: { page: { margin: { top: convertInchesToTwip(0.7), bottom: convertInchesToTwip(0.7), left: convertInchesToTwip(0.8), right: convertInchesToTwip(0.8) } } },
        children: [
          ...letterheadSection(obra.obra),
          titlePar(TIPOS.placa_carga.tituloInforme),
          infoRow([
            ['Ref. Obra', obra.ref_lab || cab.ref_obra || ''],
            ['Orden trabajo', cab.orden_trabajo || ''],
            ['P.K.', cab.pk || '']
          ]),
          infoRow([
            ['Capa', cab.capa || ''],
            ['Fecha ensayo', cab.fecha_ensayo || ''],
            ['Ø placa (mm)', cab.diam_placa || String(calc.radio_mm * 2)]
          ]),
          new Paragraph({ spacing: { before: 80, after: 40 }, children: [new TextRun({ text: 'LECTURAS:', bold: true, size: 18, color: NAVY })] }),
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  hdrCell('Presión (MPa)'),
                  hdrCell('Lect.1 (mm)'),
                  hdrCell('Lect.2 (mm)'),
                  hdrCell('Lect.3 (mm)'),
                  hdrCell('Asiento medio (mm)')
                ]
              }),
              ...cicloRows('1º CICLO DE CARGA', calc.ciclo1),
              ...cicloRows('2º CICLO DE CARGA', calc.ciclo2)
            ]
          }),
          new Paragraph({ spacing: { before: 100, after: 40 }, children: [new TextRun({ text: 'MÓDULOS DE COMPRESIBILIDAD:', bold: true, size: 18, color: NAVY })] }),
          new Table({
            layout: TableLayoutType.FIXED,
            width: { size: 50, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({ children: [dataCell('Ev1 (MPa) — módulo 1er ciclo', true, 'left'), dataCell(fmt(calc.ev1, 0), true)] }),
              new TableRow({ children: [dataCell('Ev2 (MPa) — módulo 2º ciclo', true, 'left'), dataCell(fmt(calc.ev2, 0), true)] }),
              new TableRow({
                children: [
                  dataCell(`Ev2/Ev1 (≤ ${fmt(calc.ratio_max, 1)})`, true, 'left'),
                  dataCell(fmt(calc.ratio, 1), true, 'center', calc.ratio !== null ? (ratioOk ? 'DCFCE7' : 'FEE2E2') : 'FFFFFF')
                ]
              })
            ]
          }),
          new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: `VEREDICTO: ${calc.veredicto}`, bold: true, size: 22, color: calc.veredicto === 'CUMPLE' ? '15803D' : 'B91C1C' })] }),
          new Paragraph({ spacing: { before: 60 }, children: [new TextRun({ text: HABILITACION, size: 14, color: GREY, italics: true })] }),
          signaturesPar(cab.director || DIRECTOR_DEFAULT, cab.jefe_area || JEFE_DEFAULT)
        ]
      }
    ]
  })

  return Buffer.from(Packer.toBuffer(doc) as unknown as ArrayBuffer)
}

// ══════════════════════════════════════════════════════════════════════════════
// DENSIDAD IN SITU — Excel
// ══════════════════════════════════════════════════════════════════════════════

async function densidadExcel(datos: DensidadInput & Record<string, unknown>, obra: Obra): Promise<Buffer> {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const calc = computeDensidad(datos)

  const wb = new ExcelJS.Workbook()
  wb.creator = 'CYE'
  const ws = wb.addWorksheet('Densidad in situ')

  ws.mergeCells('A1:F1')
  ws.getCell('A1').value = `CYE — ${TIPOS.densidad_in_situ.tituloInforme}`
  ws.getCell('A1').font = { bold: true, size: 12, color: { argb: `FF${NAVY}` } }
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${LIGHT}` } }
  ws.getCell('A1').alignment = { horizontal: 'center' }

  ws.addRow([])
  const infoRows: [string, string][] = [
    ['Obra', obra.obra],
    ['Ref. Lab', obra.ref_lab || ''],
    ['Orden trabajo', cab.orden_trabajo || ''],
    ['Capa', cab.capa || ''],
    ['Localización', cab.localizacion || ''],
    ['Nº Lote', cab.n_lote || ''],
    ['Fecha ensayo', cab.fecha_ensayo || '']
  ]
  for (const [k, v] of infoRows) {
    const row = ws.addRow([k, v])
    row.getCell(1).font = { bold: true }
  }

  ws.addRow([])
  const hdrs = ['Nº', 'D.Máx (g/cm³)', 'H.Ópt (%)', 'D.in situ (g/cm³)', 'H.in situ (%)', 'Compact. (%)']
  const hdrRow = ws.addRow(hdrs)
  hdrRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${MID}` } }
    cell.alignment = { horizontal: 'center' }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })

  for (const r of calc.rows) {
    const row = ws.addRow([
      r.n,
      r.d_max ?? '',
      r.h_opt ?? '',
      r.d_situ ?? '',
      r.h_situ ?? '',
      r.compactacion ?? ''
    ])
    row.eachCell((cell) => {
      cell.alignment = { horizontal: 'center' }
      cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    })
    if (r.compactacion !== null && r.compactacion !== undefined) {
      const compCell = row.getCell(6)
      compCell.font = { bold: true }
      compCell.fill = {
        type: 'pattern', pattern: 'solid',
        fgColor: { argb: r.compactacion >= calc.compactacion_min ? 'FFD1FAE5' : 'FFFEE2E2' }
      }
    }
  }

  const mediaRow = ws.addRow(['MEDIA LOTE', '', '', calc.media_d_situ, calc.media_h_situ, calc.media_compactacion])
  mediaRow.font = { bold: true }
  mediaRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFEFEF' } }

  ws.addRow([])
  ws.addRow(['VEREDICTO', calc.veredicto]).getCell(2).font = {
    bold: true,
    color: { argb: calc.veredicto === 'CUMPLE' ? 'FF15803D' : 'FFB91C1C' }
  }

  ws.columns = [{ width: 8 }, { width: 14 }, { width: 10 }, { width: 16 }, { width: 12 }, { width: 12 }]

  return wb.xlsx.writeBuffer() as unknown as Promise<Buffer>
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function generateInformeWord(ensayo: Ensayo, obra: Obra): Promise<Buffer> {
  const datos = ensayo.datos as Record<string, unknown>
  if (ensayo.tipo === 'densidad_in_situ') return densidadWord(datos as DensidadInput & Record<string, unknown>, obra)
  if (ensayo.tipo === 'placa_carga') return placaWord(datos as PlacaInput & Record<string, unknown>, obra)
  throw new Error(`Tipo de ensayo no soportado: ${ensayo.tipo}`)
}

export async function generateInformeExcel(ensayo: Ensayo, obra: Obra): Promise<Buffer> {
  const datos = ensayo.datos as Record<string, unknown>
  if (ensayo.tipo === 'densidad_in_situ') return densidadExcel(datos as DensidadInput & Record<string, unknown>, obra)
  throw new Error(`Informe Excel no disponible para tipo: ${ensayo.tipo}`)
}
