/**
 * Genera el informe Excel de Toma de Hormigón / Probetas con ExcelJS.
 * No hay plantilla .xlsx preexistente — el informe se construye completamente
 * en código, replicando el formato CYE de dos hojas:
 *   "Albarán"  → datos de la toma (campo)
 *   "Roturas"  → resultados de compresión (laboratorio)
 */
import ExcelJS from 'exceljs'
import type { Obra } from '../../db'

// ── Helpers ───────────────────────────────────────────────────────────────────

const NAVY = 'FF1B2A4A'
const BLUE_LIGHT = 'FFD6E4F0'
const HIGHLIGHT28 = 'FFEBF5E0'

function argb(hex: string): string { return hex.startsWith('FF') ? hex : `FF${hex}` }

function navyFill(): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } }
}
function lightFill(): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE_LIGHT } }
}
function highlightFill(): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(HIGHLIGHT28) } }
}

const thin = { style: 'thin' as const, color: { argb: argb('AAAAAA') } }
const allThin: Partial<ExcelJS.Borders> = { top: thin, bottom: thin, left: thin, right: thin }

function toStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(',', '.'))
  return isNaN(n) ? null : n
}

function parseFck(tipoHormigon: string): number | null {
  const m = String(tipoHormigon ?? '').match(/H[APBR]-(\d+)/i)
  return m ? parseInt(m[1], 10) : null
}

// ── Hoja 1: Albarán (datos de campo) ──────────────────────────────────────────

function fillAlbaranSheet(ws: ExcelJS.Worksheet, datos: Record<string, unknown>, obra: Obra): void {
  ws.properties.defaultRowHeight = 16

  // Ancho de columnas
  ws.columns = [
    { width: 28 }, { width: 24 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }
  ]

  const ident = (datos.identificacion as Record<string, unknown>) ?? {}
  const camion = (datos.camion as Record<string, unknown>) ?? {}
  const conos = (datos.conos as Record<string, unknown>[]) ?? []
  const comp = (datos.composicion as Record<string, unknown>) ?? {}
  const prob = (datos.probetas as Record<string, unknown>) ?? {}

  let row = 1

  // Título
  const titleRow = ws.getRow(row++)
  ws.mergeCells(`A${row - 1}:H${row - 1}`)
  const titleCell = ws.getCell(`A${row - 1}`)
  titleCell.value = 'INFORME TOMA DE HORMIGÓN Y CONFECCIÓN DE PROBETAS'
  titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = navyFill()
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  titleRow.height = 24

  // Obra / cliente
  const addMetaRow = (label: string, value: string): void => {
    ws.getRow(row++)
    ws.mergeCells(`A${row - 1}:B${row - 1}`)
    const lc = ws.getCell(`A${row - 1}`)
    lc.value = label
    lc.font = { bold: true, size: 9 }
    lc.fill = lightFill()
    lc.border = allThin
    ws.mergeCells(`C${row - 1}:H${row - 1}`)
    const vc = ws.getCell(`C${row - 1}`)
    vc.value = value
    vc.font = { size: 9 }
    vc.border = allThin
  }

  addMetaRow('Obra', toStr(obra.obra))
  addMetaRow('Cliente', toStr(obra.cliente))
  addMetaRow('Ref. laboratorio', toStr(obra.ref_lab ?? obra.id))
  row++ // espacio

  // Sección helper
  const secHeader = (label: string): void => {
    ws.getRow(row++)
    ws.mergeCells(`A${row - 1}:H${row - 1}`)
    const c = ws.getCell(`A${row - 1}`)
    c.value = label
    c.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } }
    c.fill = navyFill()
    c.alignment = { horizontal: 'left', indent: 1 }
    ws.getRow(row - 1).height = 18
  }

  const field2 = (label: string, value: string, label2?: string, value2?: string): void => {
    ws.getRow(row++)
    ws.mergeCells(`A${row - 1}:B${row - 1}`)
    const lc = ws.getCell(`A${row - 1}`)
    lc.value = label; lc.font = { bold: true, size: 9 }; lc.fill = lightFill(); lc.border = allThin
    ws.mergeCells(`C${row - 1}:D${row - 1}`)
    const vc = ws.getCell(`C${row - 1}`)
    vc.value = value; vc.font = { size: 9 }; vc.border = allThin
    if (label2 !== undefined) {
      ws.mergeCells(`E${row - 1}:F${row - 1}`)
      const lc2 = ws.getCell(`E${row - 1}`)
      lc2.value = label2; lc2.font = { bold: true, size: 9 }; lc2.fill = lightFill(); lc2.border = allThin
      ws.mergeCells(`G${row - 1}:H${row - 1}`)
      const vc2 = ws.getCell(`G${row - 1}`)
      vc2.value = value2 ?? ''; vc2.font = { size: 9 }; vc2.border = allThin
    }
  }

  // ── IDENTIFICACIÓN ──
  secHeader('IDENTIFICACIÓN DEL ENSAYO')
  field2('Nº Albarán CYE', toStr(ident.n_albaran_cye), 'Nº Trabajo', toStr(ident.n_trabajo))
  field2('Nº Ensayo en obra', toStr(ident.n_ensayo_obra), 'Tipo de hormigón', toStr(ident.tipo_hormigon))
  field2('Tipo muestreo', toStr(ident.tipo_muestreo), 'Tipo compactación', toStr(ident.tipo_compactacion))
  field2('Fecha toma', toStr(ident.fecha_toma), 'Hora toma', toStr(ident.hora_toma))
  field2('Confeccionado por', toStr(ident.confeccionado_por), '', '')
  field2('Fecha recogida', toStr(ident.fecha_recogida), 'Hora recogida', toStr(ident.hora_recogida))
  row++

  // ── CAMIÓN ──
  secHeader('DATOS DEL CAMIÓN / AMASADA')
  field2('Descripción elemento', toStr(camion.descripcion_elemento), 'Central', toStr(camion.central))
  field2('Matrícula', toStr(camion.matricula), 'Volumen (m³)', toStr(camion.volumen_m3))
  field2('Albarán central', toStr(camion.albaran_central), 'T.máx. árido (mm)', toStr(camion.t_max_arido))
  field2('Hora salida central', toStr(camion.hora_salida), 'Hora llegada obra', toStr(camion.hora_llegada))
  row++

  // ── CONO DE ABRAMS ──
  secHeader('ENSAYO DE ASENTAMIENTO — CONO DE ABRAMS (UNE-EN 12350-2)')
  // cabecera de tabla
  const conoHead = ws.getRow(row++)
  ;['Cono', 'Asent. (mm)', 'Tiempo (s)', 'Observaciones'].forEach((h, i) => {
    const c = conoHead.getCell(i + 1)
    c.value = h; c.font = { bold: true, size: 9 }; c.fill = lightFill(); c.border = allThin
    c.alignment = { horizontal: 'center' }
  })
  for (const cono of conos.slice(0, 2)) {
    const r = ws.getRow(row++)
    ;[String(cono.numero ?? ''), toStr(cono.mm), toStr(cono.tiempo_s), toStr(cono.observaciones)].forEach((v, i) => {
      const c = r.getCell(i + 1)
      c.value = v; c.font = { size: 9 }; c.border = allThin; c.alignment = { horizontal: i === 0 ? 'center' : 'left' }
    })
  }
  field2('Media asentamiento (mm)', toStr(datos.asentamiento_media), 'Límite de uso (h)', toStr(datos.limite_uso))
  row++

  // ── COMPOSICIÓN ──
  secHeader('COMPOSICIÓN DEL HORMIGÓN')
  field2('Tipo de cemento', toStr(comp.tipo_cemento), 'Aditivo(s)', toStr(comp.aditivo))
  field2('Contenido cemento (kg/m³)', toStr(comp.contenido_cemento_m3), 'Relación a/c', toStr(comp.relacion_ac))
  field2('Tª ambiente (°C)', toStr(comp.t_amb), 'Tª hormigón (°C)', toStr(comp.t_hormigon))
  field2('% Humedad', toStr(comp.humedad_pct), '', '')
  row++

  // ── PROBETAS ──
  secHeader('PROBETAS FABRICADAS')
  field2('Cantidad', toStr(prob.cantidad), 'Tipo / dimensiones', toStr(prob.tipo))
  field2('Por CYE', prob.por_cye ? 'Sí' : 'No', '', '')
  field2('Fecha recogida laboratorio', toStr(prob.fecha_recogida), 'Hora recogida', toStr(prob.hora_recogida))
}

// ── Hoja 2: Roturas (resultados laboratorio) ──────────────────────────────────

function fillRoturasSheet(ws: ExcelJS.Worksheet, datos: Record<string, unknown>, obra: Obra): void {
  ws.properties.defaultRowHeight = 16
  ws.columns = [
    { width: 10 }, { width: 16 }, { width: 10 }, { width: 18 }, { width: 18 }, { width: 16 }
  ]

  const ident = (datos.identificacion as Record<string, unknown>) ?? {}
  const roturas = (datos.roturas as Record<string, unknown>[]) ?? []
  const fckManual = toNum(datos.fck_manual)
  const fck = fckManual ?? parseFck(toStr(ident.tipo_hormigon))

  let row = 1

  // Título
  ws.mergeCells(`A${row}:F${row}`)
  const titleCell = ws.getCell(`A${row}`)
  titleCell.value = 'RESULTADOS DE ROTURA DE PROBETAS'
  titleCell.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } }
  titleCell.fill = navyFill()
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(row).height = 24
  row++

  // Meta
  const meta2 = (label: string, value: string): void => {
    ws.mergeCells(`A${row}:B${row}`)
    const lc = ws.getCell(`A${row}`)
    lc.value = label; lc.font = { bold: true, size: 9 }; lc.fill = lightFill(); lc.border = allThin
    ws.mergeCells(`C${row}:F${row}`)
    const vc = ws.getCell(`C${row}`)
    vc.value = value; vc.font = { size: 9 }; vc.border = allThin
    row++
  }
  meta2('Obra', toStr(obra.obra))
  meta2('Hormigón', toStr(ident.tipo_hormigon))
  if (fck !== null) meta2('fck (MPa)', String(fck))
  row++

  // Cabecera tabla
  const HEADS = ['Nº Probeta', 'Fecha rotura', 'Edad (d)', 'Carga máx. (kN)', 'Tensión (MPa)', '']
  HEADS.forEach((h, i) => {
    const c = ws.getCell(row, i + 1)
    c.value = h; c.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } }
    c.fill = navyFill(); c.border = allThin; c.alignment = { horizontal: 'center' }
  })
  row++

  // Filas de roturas
  const tensiones28: number[] = []
  for (const r of roturas) {
    const edad = toNum(r.edad_dias)
    const is28 = edad !== null && Math.round(edad) === 28
    const tension = toNum(r.tension_mpa)
    if (is28 && tension !== null) tensiones28.push(tension)

    const vals = [toStr(r.n_probeta), toStr(r.fecha_rotura), toStr(r.edad_dias), toStr(r.carga_maxima_kn), toStr(r.tension_mpa), '']
    vals.forEach((v, i) => {
      const c = ws.getCell(row, i + 1)
      c.value = v
      c.font = { size: 9, bold: i === 4 && is28 }
      c.fill = is28 ? highlightFill() : { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }
      c.border = allThin
      c.alignment = { horizontal: 'center' }
    })
    row++
  }

  // Fila resumen
  if (tensiones28.length > 0) {
    row++
    const media28 = Math.round(tensiones28.reduce((a, b) => a + b, 0) / tensiones28.length * 100) / 100
    const cumple = fck !== null ? (media28 >= fck ? 'CUMPLE' : 'NO CUMPLE') : '—'
    const verdictColor = cumple === 'CUMPLE' ? argb('27AE60') : cumple === 'NO CUMPLE' ? argb('E74C3C') : argb('666666')

    ws.mergeCells(`A${row}:C${row}`)
    const ml = ws.getCell(`A${row}`)
    ml.value = `Media tensión 28d (${tensiones28.length} probetas):`
    ml.font = { bold: true, size: 9 }; ml.border = allThin

    const mv = ws.getCell(`D${row}`)
    mv.value = String(media28).replace('.', ',') + ' MPa'
    mv.font = { bold: true, size: 9 }; mv.border = allThin; mv.alignment = { horizontal: 'center' }

    ws.mergeCells(`E${row}:F${row}`)
    const vv = ws.getCell(`E${row}`)
    vv.value = cumple
    vv.font = { bold: true, size: 11, color: { argb: verdictColor } }
    vv.border = allThin; vv.alignment = { horizontal: 'center' }
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function fillTomaHormigonTemplate(
  datos: Record<string, unknown>,
  obra: Obra
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'CYE — Control y Estudios'
  wb.properties.date1904 = false

  const wsAlbaran = wb.addWorksheet('Albarán')
  fillAlbaranSheet(wsAlbaran, datos, obra)

  const wsRoturas = wb.addWorksheet('Roturas')
  fillRoturasSheet(wsRoturas, datos, obra)

  return Buffer.from(await wb.xlsx.writeBuffer())
}
