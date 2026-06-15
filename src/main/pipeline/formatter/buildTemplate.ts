/**
 * Genera la plantilla Word inicial (resources/templates/plan_plantilla.docx) con
 * marcadores docxtemplater. Es un script de UN SOLO USO para sembrar la plantilla:
 * a partir de aquí, la plantilla se edita directamente en Word (logos, estilos,
 * portada corporativa…) SIN tocar código, mientras se conserven los marcadores.
 *
 *   npm run template:build
 *
 * Marcadores: {obra} {cliente} {ref_lab} {fecha} {responsable}
 *             {total_sin_iva} {iva} {total_con_iva}
 *             bucle de tabla: {#rows} … {/rows} con
 *             {descripcion} {medida} {frecuencia} {ud} {n_lotes} {ens_lote} {uds} {precio} {importe}
 */
import { writeFileSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  HeadingLevel,
  ShadingType
} from 'docx'

const NAVY = '1F3864'
const MID = '2E75B6'

const HEADERS = [
  'ENSAYO',
  'Medida',
  'Frecuencia',
  'Ud.',
  'Nº Lotes',
  'Nº ens./Lote',
  'Uds.',
  'PRECIO UNITARIO €',
  'IMPORTE €'
]
// Marcadores por columna de la fila de datos (se repite con {#rows}…{/rows}).
const ROW_FIELDS = [
  'descripcion',
  'medida',
  'frecuencia',
  'ud',
  'n_lotes',
  'ens_lote',
  'uds',
  'precio',
  'importe'
]

function headerCell(text: string): TableCell {
  return new TableCell({
    shading: { type: ShadingType.SOLID, color: MID, fill: MID },
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, color: 'FFFFFF', size: 16 })]
      })
    ]
  })
}

function dataCell(field: string, index: number, last: number): TableCell {
  // El bucle docxtemplater envuelve la fila: {#rows} al inicio de la 1ª celda,
  // {/rows} al final de la última.
  const prefix = index === 0 ? '{#rows}' : ''
  const suffix = index === last ? '{/rows}' : ''
  return new TableCell({
    children: [
      new Paragraph({
        alignment: index === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
        children: [new TextRun({ text: `${prefix}{${field}}${suffix}`, size: 16 })]
      })
    ]
  })
}

function infoLine(label: string, marker: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: NAVY }),
      new TextRun({ text: `{${marker}}` })
    ]
  })
}

function totalLine(label: string, marker: string, strong: boolean): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: [
      new TextRun({ text: `${label}: `, bold: strong, color: NAVY }),
      new TextRun({ text: `{${marker}} €`, bold: strong })
    ]
  })
}

function main(): void {
  const lastCol = ROW_FIELDS.length - 1
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: HEADERS.map(headerCell)
      }),
      new TableRow({
        children: ROW_FIELDS.map((f, i) => dataCell(f, i, lastCol))
      })
    ]
  })

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: 'PLAN DE CONTROL DE CALIDAD VALORADO',
                bold: true,
                color: NAVY,
                size: 28
              })
            ]
          }),
          new Paragraph({ text: '' }),
          infoLine('Obra', 'obra'),
          infoLine('Cliente', 'cliente'),
          infoLine('Ref. Laboratorio', 'ref_lab'),
          infoLine('Fecha', 'fecha'),
          new Paragraph({ text: '' }),
          table,
          new Paragraph({ text: '' }),
          totalLine('TOTAL (IVA no incluido)', 'total_sin_iva', false),
          totalLine('IVA 21%', 'iva', false),
          totalLine('TOTAL (IVA incluido)', 'total_con_iva', true),
          new Paragraph({ text: '' }),
          new Paragraph({ text: '' }),
          infoLine('Responsable', 'responsable')
        ]
      }
    ]
  })

  const dir = resolve(process.cwd(), 'resources/templates')
  mkdirSync(dir, { recursive: true })
  const out = resolve(dir, 'plan_plantilla.docx')
  Packer.toBuffer(doc).then((buf) => {
    writeFileSync(out, buf)
    console.log(`Plantilla generada: ${out} (${buf.length} bytes)`)
  })
}

main()
