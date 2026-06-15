/**
 * Genera el Excel "Plan de Control de Calidad Valorado" (port de formatter.generate_excel).
 * Usa exceljs. Las filas planas del planner se agrupan por material para recrear
 * las secciones (cabeceras azul marino) del documento original.
 */
import ExcelJS from 'exceljs'
import type { PlanRowInput } from '../types'
import { COLORS, IVA_RATE, TOTAL_LABEL, type ObraInfo } from './types'

const argb = (hex: string): string => `FF${hex}`
const fill = (hex: string): ExcelJS.Fill => ({
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: argb(hex) }
})
const thin = { style: 'thin' as const }
const allThin = { top: thin, bottom: thin, left: thin, right: thin }

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
const COL_WIDTHS = [55, 11, 10, 6, 9, 12, 8, 16, 12]

export async function generateExcel(planRows: PlanRowInput[], obra: ObraInfo): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Plan de Ensaios')

  // ── Cabecera ──
  ws.mergeCells('A1:I1')
  const title = ws.getCell('A1')
  title.value = 'PLAN DE CONTROL DE CALIDAD VALORADO'
  title.font = { bold: true, size: 14, color: { argb: argb('FFFFFF') } }
  title.fill = fill(COLORS.NAVY)
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 24

  ws.mergeCells('A2:I2')
  const obraCell = ws.getCell('A2')
  obraCell.value = `Obra: ${obra.obra ?? ''}`
  obraCell.font = { bold: true, size: 11 }
  obraCell.alignment = { horizontal: 'left', indent: 1 }
  ws.getRow(2).height = 18

  for (const [col, label] of [
    ['A', 'Cliente:'],
    ['D', 'Ref. Laboratorio:'],
    ['G', 'Fecha:']
  ] as const) {
    ws.getCell(`${col}3`).value = label
    ws.getCell(`${col}3`).font = { bold: true, size: 9 }
  }
  ws.getCell('B3').value = obra.cliente ?? ''
  ws.getCell('E3').value = obra.ref_lab ?? ''
  ws.getCell('H3').value = obra.fecha ?? ''
  ws.getRow(3).height = 14

  // ── Cabecera de tabla ──
  HEADERS.forEach((h, i) => {
    const cell = ws.getRow(5).getCell(i + 1)
    cell.value = h
    cell.font = { bold: true, color: { argb: argb('FFFFFF') }, size: 9 }
    cell.fill = fill(COLORS.MID)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allThin
    ws.getColumn(i + 1).width = COL_WIDTHS[i]
  })
  ws.getRow(5).height = 28

  // ── Filas: agrupadas por material (sección) ──
  const testRows = planRows.filter((r) => r.type === 'test')
  let rowNum = 6
  let currentMaterial: string | null = null

  for (const item of testRows) {
    const material = item.material ?? ''
    if (material !== currentMaterial) {
      currentMaterial = material
      ws.mergeCells(`A${rowNum}:I${rowNum}`)
      const qty = item.measurement
      const qtyStr = qty ? `${qty.toLocaleString('es-ES')} ${item.measurement_unit ?? ''}` : ''
      const label = `  ${material.toUpperCase()}${qtyStr ? `   —   ${qtyStr}` : ''}`
      for (let c = 1; c <= 9; c++) {
        const cell = ws.getRow(rowNum).getCell(c)
        if (c === 1) cell.value = label
        cell.fill = fill(COLORS.NAVY)
        cell.font = { bold: true, color: { argb: argb('FFFFFF') }, size: 10 }
        cell.border = allThin
      }
      ws.getRow(rowNum).height = 18
      rowNum++
    }

    const values = [
      item.description ?? '',
      item.measurement ?? null,
      item.freq_qty ?? null,
      item.measurement_unit ?? '',
      item.n_lots ?? null,
      item.tests_per_lot ?? null,
      item.n_tests ?? null,
      item.unit_price ?? null,
      item.total ?? null
    ]
    values.forEach((v, i) => {
      const c = i + 1
      const cell = ws.getRow(rowNum).getCell(c)
      cell.value = v
      cell.border = allThin
      cell.font = { size: 9 }
      cell.alignment = { horizontal: c > 1 ? 'center' : 'left', wrapText: true, vertical: 'top' }
      if ((c === 8 || c === 9) && v) cell.numFmt = '#,##0.00'
    })
    ws.getRow(rowNum).height = 30
    rowNum++
  }

  // ── Totales ──
  const total = testRows.reduce((s, r) => s + (r.total ?? 0), 0)
  rowNum++ // fila en blanco
  writeTotalRow(ws, rowNum, TOTAL_LABEL, total, true)
  writeTotalRow(ws, rowNum + 1, 'IVA 21%:', total * IVA_RATE, false)
  writeTotalRow(ws, rowNum + 2, 'TOTAL (IVA incluido):', total * (1 + IVA_RATE), true)

  return Buffer.from(await wb.xlsx.writeBuffer())
}

function writeTotalRow(
  ws: ExcelJS.Worksheet,
  rowNum: number,
  label: string,
  amount: number,
  strong: boolean
): void {
  ws.mergeCells(`A${rowNum}:H${rowNum}`)
  const labelCell = ws.getCell(`A${rowNum}`)
  labelCell.value = label
  labelCell.alignment = { horizontal: 'right' }
  labelCell.font = { bold: strong, size: 11 }
  const amountCell = ws.getRow(rowNum).getCell(9)
  amountCell.value = amount
  amountCell.font = { bold: strong, size: 11 }
  amountCell.numFmt = '#,##0.00'
  amountCell.border = strong
    ? { top: { style: 'double' }, bottom: { style: 'double' }, left: thin, right: thin }
    : allThin
}
