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
import { toFloat, parseMasasList } from '../ensayos'

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

/** Genera el .xlsx oficial de granulometría a partir de la plantilla y los datos. */
export function fillGranulometriaTemplate(
  datos: GranulometriaInput & Record<string, unknown>,
  _obra: ObraLike,
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

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
