/**
 * Genera el Excel de Radón Trazas (CR-39) con ExcelJS — dos pestañas:
 *   "Colocación"  → ficha de campo para instalación y retirada de detectores
 *   "H. Cálculo"  → hoja de cálculo con fórmulas RAC a partir de densidad de trazas
 *
 * Los datos del ensayo (códigos, ubicaciones, fechas, RAC registrada) se pre-rellenan
 * desde la App. Las celdas de entrada del laboratorio (densidad de trazas, parámetros
 * de calibración) quedan en amarillo para que el técnico las complete.
 */
import ExcelJS from 'exceljs'
import type { RadonInput, RadonDetector, RadonMetadata } from '../ensayos'
import type { Obra } from '../../db'

// ── Paleta CYE ────────────────────────────────────────────────────────────────
const NAVY        = 'FF1B2A4A'
const LIGHT_BLUE  = 'FFD6E4F0'
const AMBER       = 'FFFFC000'
const AMBER_LIGHT = 'FFFFF2CC'
const GREEN_LIGHT = 'FFE2EFDA'
const RED_DARK    = 'FF9C0006'
const RED_LIGHT   = 'FFFFC7CE'
const GREY_BG     = 'FFF2F2F2'

// ── Helpers ───────────────────────────────────────────────────────────────────
function solidFill(argb: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } }
}

const thinGrey = { style: 'thin' as const, color: { argb: 'FFAAAAAA' } }
const allThin: Partial<ExcelJS.Borders> = {
  top: thinGrey, bottom: thinGrey, left: thinGrey, right: thinGrey
}
const boldBorder = { style: 'medium' as const, color: { argb: NAVY } }
const outerBold: Partial<ExcelJS.Borders> = {
  top: boldBorder, bottom: boldBorder, left: boldBorder, right: boldBorder
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

function fmtDate(s?: string): string {
  if (!s) return ''
  // ISO YYYY-MM-DD → DD/MM/YYYY
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

function locationStr(d: RadonDetector): string {
  return [d.edificio, d.planta, d.ubicacion].filter(Boolean).join(' · ')
}

// ── PESTAÑA 1: Colocación ─────────────────────────────────────────────────────

function fillColocacionSheet(
  wb: ExcelJS.Workbook,
  dets: RadonDetector[],
  m: RadonMetadata,
  obra: Obra
): void {
  const ws = wb.addWorksheet('Colocación', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  })

  ws.properties.defaultRowHeight = 18

  // 12 columnas: A-L
  ws.columns = [
    { key: 'n',        width: 5  },   // A: N°
    { key: 'codigo',   width: 14 },   // B: Código
    { key: 'edificio', width: 22 },   // C: Edificio
    { key: 'planta',   width: 13 },   // D: Planta
    { key: 'estancia', width: 26 },   // E: Estancia / Ubicación
    { key: 'ubicado',  width: 20 },   // F: Ubicado en
    { key: 'ci_fecha', width: 13 },   // G: Colocación Fecha
    { key: 'ci_hora',  width: 10 },   // H: Hora
    { key: 'ci_tec',   width: 18 },   // I: Técnico
    { key: 're_fecha', width: 13 },   // J: Retirada Fecha
    { key: 're_hora',  width: 10 },   // K: Hora
    { key: 're_tec',   width: 18 },   // L: Técnico
  ]

  let r = 1

  // ── Título ────────────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:L${r}`)
  const title = ws.getCell(`A${r}`)
  title.value = 'HOJA DE COLOCACIÓN Y RETIRADA DE DETECTORES DE RADÓN'
  title.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  title.fill = solidFill(NAVY)
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(r).height = 28
  r++

  ws.mergeCells(`A${r}:L${r}`)
  ws.getCell(`A${r}`).value = 'IS-47 CSN · ISO 11665-4 · PE-CYE-39'
  ws.getCell(`A${r}`).font = { italic: true, size: 9, color: { argb: 'FFFFFFFF' } }
  ws.getCell(`A${r}`).fill = solidFill(NAVY)
  ws.getCell(`A${r}`).alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(r).height = 16
  r++

  r++ // blank

  // ── Metadata ──────────────────────────────────────────────────────────────
  const addMeta = (label: string, value: string, cols = 4): void => {
    const labelCell = ws.getCell(r, 1)
    labelCell.value = label
    labelCell.font = { bold: true, size: 9 }
    labelCell.fill = solidFill(LIGHT_BLUE)
    labelCell.alignment = { horizontal: 'right' }
    labelCell.border = allThin
    ws.mergeCells(r, 2, r, 1 + cols)
    const valCell = ws.getCell(r, 2)
    valCell.value = value
    valCell.font = { size: 9 }
    valCell.border = allThin
    valCell.alignment = { horizontal: 'left' }
  }

  addMeta('Obra / Centro de Trabajo:', obra.obra ?? '', 5)
  r++
  addMeta('Ref. laboratorio:', obra.ref_lab ?? '', 5)
  r++
  addMeta('Periodo de exposición:', `${fmtDate(m.fecha_inicio)} — ${fmtDate(m.fecha_fin)}`, 5)
  r++
  addMeta('Duración (días):', m.duracion_dias ? String(m.duracion_dias) : '', 5)
  r++
  addMeta('Instalación realizada por CYE:', m.instalacion_cye ? 'Sí' : 'No', 5)
  r++

  r++ // blank

  // ── Cabecera de la tabla de detectores ────────────────────────────────────
  // Fila de grupos
  ws.mergeCells(r, 1, r, 6)
  const gIdent = ws.getCell(r, 1)
  gIdent.value = 'IDENTIFICACIÓN DEL DETECTOR'
  gIdent.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
  gIdent.fill = solidFill(NAVY)
  gIdent.alignment = { horizontal: 'center', vertical: 'middle' }
  gIdent.border = allThin

  ws.mergeCells(r, 7, r, 9)
  const gColoc = ws.getCell(r, 7)
  gColoc.value = 'COLOCACIÓN'
  gColoc.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
  gColoc.fill = solidFill('FF2E5090')
  gColoc.alignment = { horizontal: 'center', vertical: 'middle' }
  gColoc.border = allThin

  ws.mergeCells(r, 10, r, 12)
  const gRetir = ws.getCell(r, 10)
  gRetir.value = 'RETIRADA'
  gRetir.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
  gRetir.fill = solidFill('FF2E5090')
  gRetir.alignment = { horizontal: 'center', vertical: 'middle' }
  gRetir.border = allThin

  ws.getRow(r).height = 20
  r++

  // Fila de encabezados de columna
  const hdrs = ['N°','Código','Edificio','Planta','Estancia / Ubicación','Ubicado en','Fecha','Hora','Técnico (firma)','Fecha','Hora','Técnico (firma)']
  hdrs.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1)
    cell.value = h
    cell.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } }
    cell.fill = solidFill(NAVY)
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allThin
  })
  ws.getRow(r).height = 32
  r++

  // ── Filas de detectores ───────────────────────────────────────────────────
  const detStart = r
  const rowsToFill = Math.max(dets.length, 5) // mínimo 5 filas

  for (let i = 0; i < rowsToFill; i++) {
    const d = dets[i]
    const rowNum = detStart + i
    const isEven = i % 2 === 0
    const bg = isEven ? 'FFFFFFFF' : GREY_BG

    const vals = d
      ? [d.n, d.codigo, d.edificio ?? '', d.planta ?? '', d.ubicacion ?? '', '', '', '', '', '', '', '']
      : ['', '', '', '', '', '', '', '', '', '', '', '']

    vals.forEach((v, ci) => {
      const cell = ws.getCell(rowNum, ci + 1)
      cell.value = v === '' ? null : v
      cell.font = { size: 9 }
      cell.fill = solidFill(bg)
      cell.alignment = { horizontal: ci === 0 ? 'center' : 'left', vertical: 'middle', wrapText: true }
      cell.border = allThin
    })

    if (d?.extraviado) {
      ws.getCell(rowNum, 1).value = `${d.n} ⚠`
      const note = ws.getCell(rowNum, 5)
      note.value = `[EXTRAVIADO] ${d.ubicacion ?? ''}`
      note.font = { size: 9, italic: true, color: { argb: 'FF9C0006' } }
    }

    ws.getRow(rowNum).height = 22
  }

  r += rowsToFill

  // ── Pie con observaciones ─────────────────────────────────────────────────
  r++
  ws.mergeCells(`A${r}:L${r}`)
  ws.getCell(`A${r}`).value = 'Observaciones:'
  ws.getCell(`A${r}`).font = { bold: true, size: 9 }
  ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE)
  ws.getCell(`A${r}`).border = allThin
  ws.getRow(r).height = 14
  r++

  for (let i = 0; i < 3; i++) {
    ws.mergeCells(`A${r}:L${r}`)
    ws.getCell(`A${r}`).border = allThin
    ws.getRow(r).height = 18
    r++
  }

  // Freeze header rows
  ws.views = [{ state: 'frozen', ySplit: detStart + 1 }]
}

// ── PESTAÑA 2: H. Cálculo ─────────────────────────────────────────────────────

function fillCalcSheet(
  wb: ExcelJS.Workbook,
  dets: RadonDetector[],
  m: RadonMetadata,
  obra: Obra
): void {
  const ws = wb.addWorksheet('H. Cálculo', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  })

  ws.properties.defaultRowHeight = 16

  // 9 columnas
  ws.columns = [
    { key: 'n',        width: 5  },   // A
    { key: 'codigo',   width: 12 },   // B
    { key: 'loc',      width: 36 },   // C
    { key: 'td',       width: 17 },   // D — INPUT amarillo
    { key: 'tnetas',   width: 14 },   // E — fórmula
    { key: 'exp',      width: 16 },   // F — fórmula
    { key: 'rac',      width: 13 },   // G — fórmula RESULTADO
    { key: 'urac',     width: 16 },   // H — desde App / manual
    { key: 'estado',   width: 14 },   // I — fórmula
  ]

  let r = 1

  // ── Título ────────────────────────────────────────────────────────────────
  ws.mergeCells(`A${r}:I${r}`)
  ws.getCell(`A${r}`).value = 'H. CÁLCULO — RADÓN TRAZAS CR-39  ·  ISO 11665-4 / IS-47 CSN / PE-CYE-39'
  ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
  ws.getCell(`A${r}`).fill = solidFill(NAVY)
  ws.getCell(`A${r}`).alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(r).height = 26
  r++

  r++ // blank

  // ── Sección: PARÁMETROS DE LA CAMPAÑA ────────────────────────────────────
  const sectionHeader = (label: string): void => {
    ws.mergeCells(`A${r}:I${r}`)
    ws.getCell(`A${r}`).value = label
    ws.getCell(`A${r}`).font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    ws.getCell(`A${r}`).fill = solidFill(NAVY)
    ws.getCell(`A${r}`).alignment = { horizontal: 'left', indent: 1, vertical: 'middle' }
    ws.getRow(r).height = 20
    r++
  }

  const paramRow = (
    label: string,
    value: string | number | null,
    unit = '',
    highlight = false
  ): void => {
    ws.mergeCells(`A${r}:C${r}`)
    const lc = ws.getCell(`A${r}`)
    lc.value = label
    lc.font = { size: 9, bold: true }
    lc.fill = solidFill(LIGHT_BLUE)
    lc.alignment = { horizontal: 'right', vertical: 'middle' }
    lc.border = allThin

    const vc = ws.getCell(`D${r}`)
    vc.value = value
    vc.font = { size: 9 }
    vc.fill = solidFill(highlight ? AMBER_LIGHT : 'FFFFFFFF')
    vc.alignment = { horizontal: highlight ? 'center' : 'left', vertical: 'middle' }
    vc.border = allThin
    if (highlight) vc.font = { size: 9, bold: true }

    if (unit) {
      ws.getCell(`E${r}`).value = unit
      ws.getCell(`E${r}`).font = { size: 9, italic: true, color: { argb: 'FF666666' } }
    }

    ws.getRow(r).height = 16
    r++
  }

  sectionHeader('1. PARÁMETROS DE LA CAMPAÑA')

  paramRow('Obra / Centro de Trabajo:', obra.obra ?? '')
  paramRow('Ref. laboratorio:', obra.ref_lab ?? '')
  paramRow('Fecha inicio exposición:', fmtDate(m.fecha_inicio))
  paramRow('Fecha fin exposición:', fmtDate(m.fecha_fin))

  // B8 = duration — necesitamos esta referencia en las fórmulas
  const ROW_DURACION = r
  paramRow('Duración (días):', m.duracion_dias ?? null, 'días')

  paramRow(
    'Fechas procesado / lectura:',
    [fmtDate(m.fecha_procesado_inicio), fmtDate(m.fecha_procesado_fin)].filter(Boolean).join(' — ')
  )
  paramRow('Norma:', m.norma ?? 'IS-47 CSN + PE-CYE-39 (ISO 11665-4)')

  // B11 = nivel_referencia
  const ROW_NIVEL_REF = r
  paramRow('Nivel de referencia (NR):', m.nivel_referencia ?? 300, 'Bq/m³')

  // B12 = umbral_decision
  const ROW_DT = r
  paramRow('Umbral de decisión (DT):', m.umbral_decision ?? 3, 'Bq/m³')

  // B13 = limite_deteccion
  const ROW_LLD = r
  paramRow('Límite de detección (LLD):', m.limite_deteccion ?? 7, 'Bq/m³')

  r++ // blank

  // ── Sección: PARÁMETROS DE CALIBRACIÓN ───────────────────────────────────
  sectionHeader('2. PARÁMETROS DE CALIBRACIÓN  (rellenar según certificado del lote)')

  // Nota explicativa
  ws.mergeCells(`A${r}:I${r}`)
  ws.getCell(`A${r}`).value = '  ⚠  Celdas en amarillo: introducir el valor del certificado de calibración del lote de detectores.'
  ws.getCell(`A${r}`).font = { size: 8, italic: true, color: { argb: 'FF7F6000' } }
  ws.getCell(`A${r}`).fill = solidFill(AMBER_LIGHT)
  ws.getRow(r).height = 14
  r++

  const inputParamRow = (label: string, defaultVal: number, unit: string): number => {
    const rowRef = r
    ws.mergeCells(`A${r}:C${r}`)
    const lc = ws.getCell(`A${r}`)
    lc.value = label
    lc.font = { size: 9, bold: true }
    lc.fill = solidFill(LIGHT_BLUE)
    lc.alignment = { horizontal: 'right', vertical: 'middle' }
    lc.border = allThin

    const vc = ws.getCell(`D${r}`)
    vc.value = defaultVal
    vc.numFmt = '#,##0.000'
    vc.font = { size: 9, bold: true, color: { argb: 'FF7F6000' } }
    vc.fill = solidFill(AMBER)
    vc.alignment = { horizontal: 'center', vertical: 'middle' }
    vc.border = outerBold

    ws.getCell(`E${r}`).value = unit
    ws.getCell(`E${r}`).font = { size: 9, italic: true, color: { argb: 'FF666666' } }

    ws.getRow(r).height = 18
    r++
    return rowRef
  }

  // ROW_CF = fila donde está D con el CF
  const ROW_CF    = inputParamRow('Factor de calibración CF:', 41.33, 'kBqh/m³ / (track/mm²)  [GJ ≤ 4850: 41.33 · GJ ≥ 4901: 41.15]')
  const ROW_NBKG  = inputParamRow('Densidad de fondo n_bckgr:', 0.539, 'tracks/mm²  [GJ ≤ 4850: 0.539]')
  const ROW_AREA  = inputParamRow('Área efectiva SSSNTD:', 51.713, 'mm²')

  r++ // blank

  // ── Sección: RESULTADOS POR DETECTOR ─────────────────────────────────────
  sectionHeader('3. RESULTADOS POR DETECTOR')

  // Nota instrucciones
  ws.mergeCells(`A${r}:I${r}`)
  ws.getCell(`A${r}`).value = '  Introducir la densidad de trazas (col. D) del informe del laboratorio (Radosys). Los valores de RAC (col. G) se calculan automáticamente.'
  ws.getCell(`A${r}`).font = { size: 8, italic: true, color: { argb: 'FF243F60' } }
  ws.getCell(`A${r}`).fill = solidFill(LIGHT_BLUE)
  ws.getRow(r).height = 14
  r++

  // Cabecera tabla
  const tableHdrs = [
    'N°',
    'Código',
    'Edificio · Planta · Ubicación',
    'Densidad trazas\n(tracks/mm²)\n[DATO LAB]',
    'Trazas netas\n(tracks)',
    'Exposición bruta\n(kBqh/m³)',
    'RAC\n(Bq/m³)',
    '± U_RAC k=2\n(Bq/m³)',
    'Estado'
  ]
  tableHdrs.forEach((h, i) => {
    const cell = ws.getCell(r, i + 1)
    cell.value = h
    cell.font = { bold: true, size: 8, color: { argb: 'FFFFFFFF' } }
    cell.fill = solidFill(i === 3 ? 'FF7F6000' : NAVY)  // columna D en marrón para destacar input
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    cell.border = allThin
  })
  ws.getRow(r).height = 40
  r++

  const DET_START = r
  const rowsToFill = Math.max(dets.length, 5)

  for (let i = 0; i < rowsToFill; i++) {
    const d = dets[i]
    const rowNum = DET_START + i
    const isEven = i % 2 === 0
    const bg = isEven ? 'FFFFFFFF' : GREY_BG

    // N°
    const nCell = ws.getCell(rowNum, 1)
    nCell.value = d?.n ?? null
    nCell.font = { size: 9, bold: true }
    nCell.fill = solidFill(bg)
    nCell.alignment = { horizontal: 'center', vertical: 'middle' }
    nCell.border = allThin

    // Código
    const codeCell = ws.getCell(rowNum, 2)
    codeCell.value = d?.codigo ?? null
    codeCell.font = { size: 9 }
    codeCell.fill = solidFill(bg)
    codeCell.alignment = { horizontal: 'center', vertical: 'middle' }
    codeCell.border = allThin

    // Ubicación
    const locCell = ws.getCell(rowNum, 3)
    locCell.value = d ? locationStr(d) : null
    locCell.font = { size: 9 }
    locCell.fill = solidFill(bg)
    locCell.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
    locCell.border = allThin

    // D: Densidad de trazas — celda INPUT amarilla (vacía si no hay dato de lab)
    // Si hay exposicion y CF defaults podemos dar un valor orientativo: td_orient = expo / CF
    // pero no lo pre-calculamos porque CF puede cambiar. Dejamos vacío para evitar confusión.
    const tdCell = ws.getCell(rowNum, 4)
    tdCell.value = null  // siempre vacío — el técnico introduce el dato del lab
    tdCell.numFmt = '0.000'
    tdCell.font = { size: 9, bold: true, color: { argb: '7F6000' } }
    tdCell.fill = solidFill(AMBER)
    tdCell.alignment = { horizontal: 'center', vertical: 'middle' }
    tdCell.border = outerBold

    // E: Trazas netas = (D - n_bckgr) × AREA
    const eRef = `D${rowNum}`
    const nbRef = `$D$${ROW_NBKG}`
    const areaRef = `$D$${ROW_AREA}`
    const cfRef = `$D$${ROW_CF}`
    const durRef = `$D$${ROW_DURACION}`
    const nrRef  = `$D$${ROW_NIVEL_REF}`
    const dtRef  = `$D$${ROW_DT}`
    const lldRef = `$D$${ROW_LLD}`

    const netCell = ws.getCell(rowNum, 5)
    netCell.value = { formula: `IF(${eRef}="","",ROUND((${eRef}-${nbRef})*${areaRef},1))` }
    netCell.numFmt = '0.0'
    netCell.font = { size: 9, color: { argb: 'FF404040' } }
    netCell.fill = solidFill(isEven ? 'FFF5F5FF' : GREY_BG)
    netCell.alignment = { horizontal: 'center', vertical: 'middle' }
    netCell.border = allThin

    // F: Exposición bruta = D × CF  (kBqh/m³)
    const expCell = ws.getCell(rowNum, 6)
    expCell.value = { formula: `IF(${eRef}="","",ROUND(${eRef}*${cfRef},2))` }
    expCell.numFmt = '0.00'
    expCell.font = { size: 9, color: { argb: 'FF404040' } }
    expCell.fill = solidFill(isEven ? 'FFF5F5FF' : GREY_BG)
    expCell.alignment = { horizontal: 'center', vertical: 'middle' }
    expCell.border = allThin

    // G: RAC = (D - n_bckgr) × CF × 1000 / (duración × 24)
    const racCell = ws.getCell(rowNum, 7)
    racCell.value = { formula: `IF(${eRef}="","",ROUND((${eRef}-${nbRef})*${cfRef}*1000/(${durRef}*24),1))` }
    racCell.numFmt = '0.0'
    racCell.font = { size: 10, bold: true, color: { argb: NAVY } }
    racCell.fill = solidFill(isEven ? 'FFE8F0FE' : LIGHT_BLUE)
    racCell.alignment = { horizontal: 'center', vertical: 'middle' }
    racCell.border = outerBold

    // H: ± U_RAC — pre-rellenado desde la App si existe, de lo contrario vacío
    const uRacCell = ws.getCell(rowNum, 8)
    const uRacFromApp = d && !d.extraviado && !d.saturado ? toNum(d.u_rac) : null
    uRacCell.value = uRacFromApp !== null ? `± ${uRacFromApp.toFixed(2)}` : null
    uRacCell.font = { size: 9, italic: true, color: { argb: 'FF404040' } }
    uRacCell.fill = solidFill(bg)
    uRacCell.alignment = { horizontal: 'center', vertical: 'middle' }
    uRacCell.border = allThin

    // I: Estado vs. nivel de referencia
    const stateCell = ws.getCell(rowNum, 9)
    const gRef = `G${rowNum}`
    if (d?.extraviado) {
      stateCell.value = 'EXTRAVIADO'
      stateCell.font = { size: 8, bold: true, color: { argb: RED_DARK } }
      stateCell.fill = solidFill(RED_LIGHT)
    } else if (d?.saturado) {
      stateCell.value = '>1000 Bq/m³'
      stateCell.font = { size: 8, bold: true, color: { argb: RED_DARK } }
      stateCell.fill = solidFill(RED_LIGHT)
    } else {
      stateCell.value = {
        formula: `IF(${gRef}="","—",IF(${gRef}>=${nrRef},"EXCEDE NR",IF(${gRef}<${lldRef},"< LLD",IF(${gRef}<${dtRef},"< DT","OK"))))`
      }
      stateCell.font = { size: 8, bold: true }
      stateCell.fill = solidFill(bg)
    }
    stateCell.alignment = { horizontal: 'center', vertical: 'middle' }
    stateCell.border = allThin

    ws.getRow(rowNum).height = 20
  }

  r = DET_START + rowsToFill
  r++ // blank

  // ── Sección: RESUMEN ──────────────────────────────────────────────────────
  sectionHeader('4. RESUMEN')

  const detFirstRow = DET_START
  const detLastRow  = DET_START + rowsToFill - 1
  const gRange = `G${detFirstRow}:G${detLastRow}`
  const iRange = `I${detFirstRow}:I${detLastRow}`

  const summaryRow = (label: string, formula: string | null, value: string | null = null): void => {
    ws.mergeCells(`A${r}:C${r}`)
    const lc = ws.getCell(`A${r}`)
    lc.value = label
    lc.font = { size: 9, bold: true }
    lc.fill = solidFill(LIGHT_BLUE)
    lc.alignment = { horizontal: 'right', vertical: 'middle' }
    lc.border = allThin

    const vc = ws.getCell(`D${r}`)
    if (formula) {
      vc.value = { formula }
    } else {
      vc.value = value
    }
    vc.numFmt = formula && formula.includes('COUNTIF') ? '0' : '0.0'
    vc.font = { size: 9, bold: true }
    vc.fill = solidFill('FFFFFFFF')
    vc.border = allThin
    vc.alignment = { horizontal: 'center', vertical: 'middle' }

    ws.getRow(r).height = 16
    r++
  }

  summaryRow('N° detectores totales:', null, String(dets.length || rowsToFill))
  summaryRow('N° detectores válidos:', `COUNTA(G${detFirstRow}:G${detLastRow})`, null)
  summaryRow('RAC mínima (Bq/m³):', `IF(COUNTA(${gRange})=0,"",ROUND(MIN(${gRange}),1))`, null)
  summaryRow('RAC máxima (Bq/m³):', `IF(COUNTA(${gRange})=0,"",ROUND(MAX(${gRange}),1))`, null)
  summaryRow('RAC media (Bq/m³):', `IF(COUNTA(${gRange})=0,"",ROUND(AVERAGE(${gRange}),1))`, null)
  summaryRow('N° que superan nivel referencia:', `COUNTIF(${iRange},"EXCEDE NR")`, null)

  r++ // blank antes del veredicto

  // Veredicto
  ws.mergeCells(`A${r}:C${r}`)
  const vLabel = ws.getCell(`A${r}`)
  vLabel.value = 'VEREDICTO'
  vLabel.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } }
  vLabel.fill = solidFill(NAVY)
  vLabel.alignment = { horizontal: 'center', vertical: 'middle' }
  vLabel.border = allThin

  ws.mergeCells(`D${r}:I${r}`)
  const vCell = ws.getCell(`D${r}`)
  vCell.value = {
    formula: `IF(COUNTIF(${iRange},"EXCEDE NR")>0,"NO CUMPLE","CUMPLE")`
  }
  // Formato condicional de color no soportado directamente en fórmula ExcelJS,
  // pero podemos poner el color base neutral y el usuario verá el valor.
  vCell.font = { bold: true, size: 14, color: { argb: NAVY } }
  vCell.fill = solidFill(GREEN_LIGHT)
  vCell.alignment = { horizontal: 'center', vertical: 'middle' }
  vCell.border = outerBold
  ws.getRow(r).height = 28
  r++

  // ── Nota al pie ───────────────────────────────────────────────────────────
  r++
  ws.mergeCells(`A${r}:I${r}`)
  ws.getCell(`A${r}`).value =
    'Nota: RAC = (Densidad_trazas − n_bckgr) × CF × 1000 / (Duración_días × 24)  |  ' +
    'Nivel de referencia: Art. 72 RD 1029/2022 (300 Bq/m³)  |  ' +
    'Incertidumbre U_RAC (k=2) según ISO 11665-4 / certificado Radosys'
  ws.getCell(`A${r}`).font = { size: 7, italic: true, color: { argb: 'FF666666' } }
  ws.getRow(r).height = 14

  // Freeze primera fila del título
  ws.views = [{ state: 'frozen', ySplit: 1 }]
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function fillRadonTrazasTemplate(
  ensayoInput: unknown,
  obra: Obra
): Promise<Buffer> {
  const input = (ensayoInput ?? {}) as RadonInput
  const m = (input.metadata ?? {}) as RadonMetadata
  const dets = (input.detectores ?? []) as RadonDetector[]

  const wb = new ExcelJS.Workbook()
  wb.creator = 'CYE'
  wb.created = new Date()

  fillColocacionSheet(wb, dets, m, obra)
  fillCalcSheet(wb, dets, m, obra)

  return Buffer.from(await wb.xlsx.writeBuffer())
}
