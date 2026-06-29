/**
 * Rellena la plantilla Excel OFICIAL de granulometría de escollera
 * (resources/templates/informe_granulometría.xlsx, UNE EN 13383-2), clase 5-40 kg.
 *
 * A diferencia de densidad/placa, esta plantilla tiene UNA sola hoja ("distribución")
 * que es a la vez hoja de datos y de cálculo, con un gráfico nativo de la curva de
 * distribución de masas. NO se hornean las fórmulas: se dejan vivas y la hoja
 * recalcula al abrir (fullCalcOnLoad), igual que la usa el laboratorio, de modo que
 * el gráfico se regenera solo.
 *
 * Entrada (lo único que se escribe):
 *   · Masas de cada piedra → columna B desde la fila 3 (B3:B432, máx. 430 piedras).
 *   · Masa total de fragmentos < 1,5 kg → C455 (la plantilla toma C456 = C455).
 *   · Valores de resumen MANUALES del laboratorio:
 *       M50 (kg)                         → G463
 *       nº de piedras con L > 45 cm      → G462  (H462 = G462/n calcula el %)
 *       % LT (L/E > 3)                   → H461  (se escribe como fracción = %/100)
 *
 * El resto (clasificación por cubos, sumas, % acumulados ELL/NLL/NUL/EUL, MEM, n y la
 * curva del gráfico) lo calcula la propia plantilla a partir de las masas.
 */
import PizZip from 'pizzip'
import { readFileSync } from 'fs'
import type { GranulometriaInput } from '../ensayos'
import { toFloat, parseMasasList, computeGranulometria } from '../ensayos'

const SHEET = 'distribución'

const DATA_START_ROW = 3 // primera fila de masas (B3)
const DATA_MAX_STONES = 430 // B3:B432 (MEM = AVERAGE(B3:B432))
const FRAG_TOTAL_CELL = 'C455' // masa total de fragmentos < 1,5 kg
const M50_CELL = 'G463'
const P45_CELL = 'G462' // nº de partículas con L > 45 cm (recuento)
const LT_CELL = 'H461' // % LT (se escribe como fracción)

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Reemplaza el valor de una celda existente conservando su estilo (`s`). */
function setCell(xml: string, ref: string, value: number | string | null): string {
  if (value === null || value === '' || value === undefined) return xml
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
  const m = xml.match(re)
  if (!m) return xml
  const styleMatch = m[1].match(/\bs="(\d+)"/)
  const s = styleMatch ? ` s="${styleMatch[1]}"` : ''
  const cell =
    typeof value === 'number'
      ? `<c r="${ref}"${s}><v>${value}</v></c>`
      : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
  return xml.replace(re, cell)
}

/** Vacía el valor de una celda conservando su estilo (`<c r s/>`). */
function clearCell(xml: string, ref: string): string {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
  const m = xml.match(re)
  if (!m) return xml
  const styleMatch = m[1].match(/\bs="(\d+)"/)
  return xml.replace(re, `<c r="${ref}"${styleMatch ? ` s="${styleMatch[1]}"` : ''}/>`)
}

/** Resuelve nombre de hoja → ruta XML dentro del zip (por r:id). */
function sheetPath(zip: PizZip, name: string): string {
  const wb = zip.file('xl/workbook.xml')!.asText()
  const rels = zip.file('xl/_rels/workbook.xml.rels')!.asText()
  const sheet = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find(
    (x) => x[1] === name
  )
  if (!sheet) throw new Error(`Hoja ${name} no encontrada en la plantilla de granulometría`)
  const rel = [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].find(
    (x) => x[1] === sheet[2]
  )
  if (!rel) throw new Error(`Relación de la hoja ${name} no encontrada`)
  return 'xl/' + rel[2].replace(/^\/?xl\//, '')
}

/** Quita calcChain.xml y sus referencias (la hoja recalcula al abrir). */
function removeCalcChain(zip: PizZip): void {
  if (!zip.file('xl/calcChain.xml')) return
  zip.remove('xl/calcChain.xml')
  const ct = zip.file('[Content_Types].xml')!.asText()
  zip.file(
    '[Content_Types].xml',
    ct.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, '')
  )
  const rels = zip.file('xl/_rels/workbook.xml.rels')!.asText()
  zip.file(
    'xl/_rels/workbook.xml.rels',
    rels.replace(/<Relationship[^>]*Target="calcChain\.xml"[^>]*\/>/, '')
  )
}

interface ObraLike {
  obra?: string
  cliente?: string
  ref_lab?: string
}

// ── Construcción de la pestaña "Informe" (OOXML puro, sin ExcelJS) ─────────────

/** Número de columna (1-based) → letra(s) OOXML. */
function colLetter(n: number): string {
  let r = ''
  while (n > 0) {
    n--
    r = String.fromCharCode(65 + (n % 26)) + r
    n = Math.floor(n / 26)
  }
  return r
}

function cref(rowNum: number, colNum: number): string {
  return `${colLetter(colNum)}${rowNum}`
}

/** Celda de texto inline, con opción de negrita. */
function tc(rowNum: number, colNum: number, text: string, bold = false): string {
  const inner = bold
    ? `<r><rPr><b/></rPr><t xml:space="preserve">${xmlEscape(text)}</t></r>`
    : `<t xml:space="preserve">${xmlEscape(text)}</t>`
  return `<c r="${cref(rowNum, colNum)}" t="inlineStr"><is>${inner}</is></c>`
}

/** Celda numérica. */
function nc(rowNum: number, colNum: number, v: number): string {
  return `<c r="${cref(rowNum, colNum)}"><v>${v}</v></c>`
}

/** Fila OOXML. */
function mkRow(rowNum: number, cells: string[], ht?: number): string {
  const htAttr = ht ? ` ht="${ht}" customHeight="1"` : ''
  return `<row r="${rowNum}"${htAttr}>${cells.join('')}</row>`
}

/** Rango de merge A1:B2. */
function mg(r1: number, c1: number, r2: number, c2: number): string {
  return `<mergeCell ref="${cref(r1, c1)}:${cref(r2, c2)}"/>`
}

interface InformeData {
  obra: string; cliente: string; ref_lab: string
  muestra: string; material: string; localizacion: string
  fecha_muestreo: string; fecha_ensayo: string
  n: number; ell: number; nll: number; nul: number; eul: number; mem: number
  m50: number | null; lt_pct: number | null; p45_pct: number | null
}

function buildInformeSheetXml(d: InformeData): string {
  const rows: string[] = []
  const merges: string[] = []

  const blank = (r: number): string => mkRow(r, [])

  // ── R1: Título ──
  merges.push(mg(1, 1, 1, 13))
  rows.push(mkRow(1, [tc(1, 1, 'ARMOUR STONE QUALITY CONTROL TESTS / UNE EN 13383-2', true)], 22))

  // ── R2–5: Cabecera ──
  const hdrLeft: [number, string, string][] = [
    [2, 'PROJECT / PROYECTO:', d.obra],
    [3, 'CLIENT / CLIENTE:', d.cliente],
    [4, 'MATERIAL:', d.material],
    [5, 'LOCATION / LOCALIZACIÓN:', d.localizacion],
  ]
  const hdrRight: [number, string, string][] = [
    [2, 'WORK REF. / REF. TRABAJO:', d.ref_lab],
    [3, 'SAMPLE REF. / Nº MUESTRA:', d.muestra],
    [4, 'SAMPLING DATE / FECHA MUESTREO:', d.fecha_muestreo],
    [5, 'TESTING DATE / FECHA ENSAYO:', d.fecha_ensayo],
  ]
  for (let i = 0; i < 4; i++) {
    const [r, lbl, val] = hdrLeft[i]
    const [, rlbl, rval] = hdrRight[i]
    merges.push(mg(r, 2, r, 8))
    merges.push(mg(r, 11, r, 13))
    rows.push(mkRow(r, [tc(r, 1, lbl, true), tc(r, 2, val), tc(r, 9, rlbl), tc(r, 11, rval)]))
  }

  rows.push(blank(6))

  // ── R7: Sección distribución de masas ──
  merges.push(mg(7, 1, 7, 13))
  rows.push(mkRow(7, [tc(7, 1, 'DETERMINACIÓN DE LA DISTRIBUCIÓN DE MASAS / MASS DISTRIBUTION DETERMINATION', true)], 18))

  merges.push(mg(8, 1, 8, 13))
  rows.push(mkRow(8, [tc(8, 1, 'Método de ensayo / Testing method: UNE EN 13383-2:2003')]))

  merges.push(mg(9, 1, 9, 10))
  rows.push(mkRow(9, [
    tc(9, 1, 'Nº componentes de escollera más pesados / No. of heaviest armour stones:'),
    nc(9, 11, d.n),
  ]))

  rows.push(blank(10))

  merges.push(mg(11, 1, 11, 13))
  rows.push(mkRow(11, [tc(11, 1, 'Porcentajes acumulativos de componentes / Cumulative percentages of components:')]))

  rows.push(mkRow(12, [
    tc(12, 1, 'Fracción / Fraction', true),
    tc(12, 3, 'Resultado % / Result %', true),
    tc(12, 4, 'Especificación % / Specification %', true),
  ]))

  const frac: [string, string, number, string][] = [
    ['< 1,5 kg', 'ELL', d.ell, '0 - 2'],
    ['< 5 kg', 'NLL', d.nll, '0 - 10'],
    ['< 40 kg', 'NUL', d.nul, '70 - 100'],
    ['< 80 kg', 'EUL', d.eul, '97 - 100'],
  ]
  frac.forEach(([lbl, code, pct, spec], i) => {
    const r = 13 + i
    rows.push(mkRow(r, [tc(r, 1, lbl), tc(r, 2, code), nc(r, 3, pct), tc(r, 4, spec)]))
  })

  rows.push(blank(17))

  // ── R18–20: Masa media ──
  rows.push(mkRow(18, [
    tc(18, 1, 'Masa media / Average Mass', true),
    tc(18, 3, 'Resultado / Result (kg)', true),
    tc(18, 4, 'Especificación / Specification (kg)', true),
  ]))
  rows.push(mkRow(19, [tc(19, 1, 'MEM'), nc(19, 3, d.mem), tc(19, 4, '10 - 20')]))
  rows.push(mkRow(20, [
    tc(20, 1, 'M50'),
    d.m50 !== null ? nc(20, 3, d.m50) : tc(20, 3, '—'),
    tc(20, 4, '—'),
  ]))

  rows.push(blank(21))

  // ── R22–26: Porcentaje LT ──
  merges.push(mg(22, 1, 22, 13))
  rows.push(mkRow(22, [tc(22, 1, 'DETERMINACIÓN DEL PORCENTAJE DE COMPONENTES LT / LT COMPONENT PERCENTAGE DETERMINATION', true)], 18))

  merges.push(mg(23, 1, 23, 13))
  rows.push(mkRow(23, [tc(23, 1, 'Componentes con relación L/E > 3 / Components with L/E dimensional ratio > 3')]))

  merges.push(mg(24, 1, 24, 13))
  rows.push(mkRow(24, [tc(24, 1, 'Especificación LT / Specification LT ≤ 20 %')]))

  rows.push(blank(25))

  merges.push(mg(26, 1, 26, 2))
  rows.push(mkRow(26, [
    tc(26, 1, 'RESULTADO / RESULT: LT (%)', true),
    d.lt_pct !== null ? nc(26, 3, d.lt_pct) : tc(26, 3, '—'),
  ]))

  rows.push(blank(27))

  // ── R28–31: Partículas > 45 cm ──
  merges.push(mg(28, 1, 28, 13))
  rows.push(mkRow(28, [tc(28, 1, 'DETERMINACIÓN DEL PORCENTAJE DE COMPONENTES CON LONGITUD > 45 cm / PERCENTAGE OF COMPONENTS WITH LENGTH > 45 cm', true)], 18))

  merges.push(mg(29, 1, 29, 13))
  rows.push(mkRow(29, [tc(29, 1, 'Especificación / Specification: ≤ 3 %')]))

  rows.push(blank(30))

  merges.push(mg(31, 1, 31, 2))
  rows.push(mkRow(31, [
    tc(31, 1, 'RESULTADO / RESULT: % Partículas con longitud / Particles with length > 45 cm', true),
    d.p45_pct !== null ? nc(31, 3, d.p45_pct) : tc(31, 3, '—'),
  ]))

  rows.push(blank(32))

  // ── R33–34: Disclaimer ──
  const disc1 = 'El presente informe hace referencia únicamente a los elementos ensayados. / This report refers only to the tested elements.'
  const disc2 = 'La reproducción parcial de este informe sin autorización del laboratorio no está permitida. / Partial reproduction without laboratory authorisation is not permitted.'
  merges.push(mg(33, 1, 33, 13))
  merges.push(mg(34, 1, 34, 13))
  rows.push(mkRow(33, [tc(33, 1, disc1)]))
  rows.push(mkRow(34, [tc(34, 1, disc2)]))

  rows.push(blank(35))

  // ── R36–40: Firma ──
  merges.push(mg(36, 1, 36, 7))
  rows.push(mkRow(36, [tc(36, 1, 'Lugar y fecha / Location and date: _________________________')]))

  rows.push(blank(37))

  merges.push(mg(38, 1, 38, 7))
  rows.push(mkRow(38, [tc(38, 1, 'Nombre y cargo / Name and position: _________________________')]))

  merges.push(mg(39, 1, 39, 7))
  rows.push(mkRow(39, [tc(39, 1, 'Firma / Signature:')]))

  rows.push(blank(40))

  // ── R41: Hoja 1/1 ──
  rows.push(mkRow(41, [tc(41, 13, 'Hoja / Sheet 1/1')]))

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="28" customWidth="1"/>
    <col min="2" max="2" width="10" customWidth="1"/>
    <col min="3" max="3" width="14" customWidth="1"/>
    <col min="4" max="4" width="20" customWidth="1"/>
    <col min="5" max="8" width="6" customWidth="1"/>
    <col min="9" max="9" width="26" customWidth="1"/>
    <col min="10" max="10" width="2" customWidth="1"/>
    <col min="11" max="12" width="14" customWidth="1"/>
    <col min="13" max="13" width="10" customWidth="1"/>
  </cols>
  <sheetData>
    ${rows.join('\n    ')}
  </sheetData>
  <mergeCells count="${merges.length}">
    ${merges.join('\n    ')}
  </mergeCells>
  <pageSetup orientation="portrait"/>
</worksheet>`
}

/** Inyecta una hoja OOXML en el zip como primera hoja del workbook. */
function injectSheetFirst(zip: PizZip, sheetName: string, sheetXml: string): void {
  const newFile = 'xl/worksheets/sheet_informe.xml'
  zip.file(newFile, sheetXml)

  // Content Types
  let ct = zip.file('[Content_Types].xml')!.asText()
  if (!ct.includes('sheet_informe')) {
    ct = ct.replace(
      '</Types>',
      '<Override PartName="/xl/worksheets/sheet_informe.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    )
    zip.file('[Content_Types].xml', ct)
  }

  // Relación en workbook.xml.rels
  let rels = zip.file('xl/_rels/workbook.xml.rels')!.asText()
  const rids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((m) => parseInt(m[1]))
  const newRid = `rId${(rids.length ? Math.max(...rids) : 0) + 1}`
  rels = rels.replace(
    '</Relationships>',
    `<Relationship Id="${newRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet_informe.xml"/></Relationships>`
  )
  zip.file('xl/_rels/workbook.xml.rels', rels)

  // Insertar primera en workbook.xml
  let wb = zip.file('xl/workbook.xml')!.asText()
  const sids = [...wb.matchAll(/sheetId="(\d+)"/g)].map((m) => parseInt(m[1]))
  const newSid = (sids.length ? Math.max(...sids) : 0) + 1
  wb = wb.replace(
    '<sheets>',
    `<sheets><sheet name="${xmlEscape(sheetName)}" sheetId="${newSid}" r:id="${newRid}"/>`
  )
  zip.file('xl/workbook.xml', wb)
}

/** Genera el .xlsx oficial de granulometría a partir de la plantilla y los datos. */
export function fillGranulometriaTemplate(
  datos: GranulometriaInput & Record<string, unknown>,
  obra: ObraLike,
  templatePath: string
): Buffer {
  const zip = new PizZip(readFileSync(templatePath, 'binary'))
  const path = sheetPath(zip, SHEET)
  let xml = zip.file(path)!.asText()

  // 0. Vaciar las masas de muestra (B3:B455), el total de fragmentos (C455) y los
  //    valores de resumen manuales para no arrastrar datos de la obra de muestra.
  for (let r = DATA_START_ROW; r <= 455; r++) xml = clearCell(xml, `B${r}`)
  for (const ref of [FRAG_TOTAL_CELL, M50_CELL, P45_CELL, LT_CELL]) xml = clearCell(xml, ref)

  // 1. Masas de las piedras → columna B.
  const masas = parseMasasList(datos.masas).slice(0, DATA_MAX_STONES)
  masas.forEach((m, i) => {
    xml = setCell(xml, `B${DATA_START_ROW + i}`, m)
  })

  // 2. Total de fragmentos < 1,5 kg → C455 (la plantilla lo usa como total del cubo <1,5).
  const frag = toFloat(datos.fragmentos_masa)
  if (frag !== null && frag > 0) xml = setCell(xml, FRAG_TOTAL_CELL, frag)

  // 3. Resumen manual del laboratorio.
  const m50 = toFloat(datos.m50)
  if (m50 !== null) xml = setCell(xml, M50_CELL, m50)
  const p45 = toFloat(datos.particulas_45)
  if (p45 !== null) xml = setCell(xml, P45_CELL, p45)
  const lt = toFloat(datos.lt_pct)
  if (lt !== null) xml = setCell(xml, LT_CELL, Math.round((lt / 100) * 1e6) / 1e6) // % → fracción

  zip.file(path, xml)

  // 4. Quitar la cadena de cálculo y forzar recálculo al abrir (regenera el gráfico).
  removeCalcChain(zip)
  let wbXml = zip.file('xl/workbook.xml')!.asText()
  if (!wbXml.includes('fullCalcOnLoad'))
    wbXml = wbXml.replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" ')
  zip.file('xl/workbook.xml', wbXml)

  // 5. Pestaña "Informe" en primer lugar.
  const res = computeGranulometria(datos)
  const cab = datos.cabecera ?? {}
  const informeData: InformeData = {
    obra: obra.obra ?? '',
    cliente: obra.cliente ?? '',
    ref_lab: obra.ref_lab ?? '',
    muestra: cab.muestra ?? '',
    material: cab.material ?? '',
    localizacion: cab.localizacion ?? '',
    fecha_muestreo: cab.fecha_muestreo ?? '',
    fecha_ensayo: cab.fecha_ensayo ?? '',
    n: res.n,
    ell: res.ell,
    nll: res.nll,
    nul: res.nul,
    eul: res.eul,
    mem: res.mem,
    m50: res.m50,
    lt_pct: res.lt_pct,
    p45_pct: res.p45_pct,
  }
  injectSheetFirst(zip, 'Informe', buildInformeSheetXml(informeData))

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
