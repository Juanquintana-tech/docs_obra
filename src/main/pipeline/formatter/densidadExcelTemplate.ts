/**
 * Rellena la plantilla Excel OFICIAL de densidad/humedad in situ
 * (resources/templates/plantilla_densidad_in_situ.xlsx) con los datos del ensayo,
 * preservando intactos su formato, fórmulas y gráficos.
 *
 * Por qué PizZip y no exceljs: exceljs PIERDE los gráficos al re-guardar el .xlsx.
 * Aquí editamos directamente el OOXML (igual que buildPresupuestoTemplate.js para el
 * Word): solo se tocan las CELDAS DE DATOS de la hoja DATINF; las fórmulas que
 * calculan % compactación, medias, condiciones y la gráfica se recalculan solas al
 * abrir en Excel/LibreOffice (marcamos fullCalcOnLoad). La hoja INF es el entregable
 * formateado; rellenamos su columna A (Nº ensayo) para que se muestren las filas.
 *
 * El mapa de celdas procede del archivo real del laboratorio (validado en cye-demo).
 */
import PizZip from 'pizzip'
import { readFileSync } from 'fs'
import XLSX from 'xlsx'
import { HyperFormula } from 'hyperformula'
import type { DensidadInput, DensidadRow } from '../ensayos'

/** Hoja de datos y primera fila/máximo de ensayos (según la plantilla real). */
const DATA_SHEET = 'DATINF'
const INF_SHEET = 'INF'
const DATA_START_ROW = 26 // primera fila de lecturas in situ en DATINF
const DATA_MAX_ROWS = 16 // filas con fórmulas en la plantilla
const INF_START_ROW = 15 // primera fila de datos en la hoja INF
const INF_MAX_ROWS = 15

/** Capa → nº de "Tipo" del desplegable de la plantilla (lista interna). */
const TIPO_CAPA: Record<string, number> = {
  núcleo: 1,
  nucleo: 1,
  coronación: 2,
  coronacion: 2,
  's-est 3': 3,
  's-est 2': 4,
  's-est 1': 5,
  'suelo-cemento': 6,
  'explanada mejorada': 7,
  'capa de forma': 8,
  subbalasto: 9
}

interface ObraLike {
  obra?: string
  ref_lab?: string
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** A número si parece numérico (admite coma decimal); si no, devuelve el string original. */
function maybeNum(v: unknown): number | string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const n = parseFloat(String(v).trim().replace(',', '.'))
  return isNaN(n) ? String(v) : n
}

/**
 * Reemplaza el VALOR de una celda existente conservando su estilo (`s`).
 * - número → celda numérica `<c r=".." s=".."><v>n</v></c>`
 * - texto  → `<c r=".." s=".." t="inlineStr"><is><t>…</t></is></c>` (no toca sharedStrings)
 * Lanza si la celda no existe en la hoja (la plantilla es un formulario: todas existen).
 */
function setCell(xml: string, ref: string, value: number | string | null): string {
  if (value === null || value === '') return xml
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
  const m = xml.match(re)
  if (!m) throw new Error(`Celda ${ref} no encontrada en la plantilla de densidad`)
  const styleMatch = m[1].match(/\bs="(\d+)"/)
  const s = styleMatch ? ` s="${styleMatch[1]}"` : ''
  const cell =
    typeof value === 'number'
      ? `<c r="${ref}"${s}><v>${value}</v></c>`
      : `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`
  return xml.replace(re, cell)
}

/** Resuelve el nombre de hoja → ruta del XML dentro del zip (por r:id, no por nombre de fichero). */
function sheetPath(zip: PizZip, name: string): string {
  const wb = zip.file('xl/workbook.xml')!.asText()
  const rels = zip.file('xl/_rels/workbook.xml.rels')!.asText()
  const sheet = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find(
    (x) => x[1] === name
  )
  if (!sheet) throw new Error(`Hoja ${name} no encontrada en la plantilla`)
  const rel = [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].find((x) => x[1] === sheet[2])
  if (!rel) throw new Error(`Relación de la hoja ${name} no encontrada`)
  return 'xl/' + rel[2].replace(/^\/?xl\//, '')
}

/** Genera el .xlsx oficial de densidad in situ a partir de la plantilla y los datos. */
export function fillDensidadTemplate(
  datos: DensidadInput & Record<string, unknown>,
  obra: ObraLike,
  templatePath: string
): Buffer {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const rows: DensidadRow[] = (datos.ensayos ?? []).slice()

  const zip = new PizZip(readFileSync(templatePath, 'binary'))
  const datinfPath = sheetPath(zip, DATA_SHEET)
  let xml = zip.file(datinfPath)!.asText()

  // ── Cabecera ──
  xml = setCell(xml, 'C1', cab.fecha_ensayo ?? '')
  xml = setCell(xml, 'C2', cab.fecha_informe || cab.fecha_ensayo || '')
  const capaKey = String(cab.capa ?? '').trim().toLowerCase()
  if (TIPO_CAPA[capaKey] !== undefined) xml = setCell(xml, 'C3', TIPO_CAPA[capaKey])
  xml = setCell(xml, 'C4', obra.obra ?? '')
  xml = setCell(xml, 'C5', obra.ref_lab || cab.ref_obra || '')
  xml = setCell(xml, 'C7', cab.orden_trabajo ?? '')
  xml = setCell(xml, 'C8', cab.localizacion ?? '')
  const dests = ((datos.destinatarios as string[]) ?? []).filter((d) => d && String(d).trim())
  ;['C9', 'C11', 'C13', 'C15', 'C17'].forEach((cell, i) => {
    if (dests[i]) xml = setCell(xml, cell, dests[i])
  })
  xml = setCell(xml, 'C19', maybeNum(cab.n_lote))
  const nums = rows.map((r) => Number(r.n)).filter((n) => isFinite(n))
  xml = setCell(xml, 'C20', nums.length ? Math.min(...nums) : 1) // Nº primer ensayo → genera col. A
  xml = setCell(xml, 'C21', rows.length) // Nº de ensayos
  xml = setCell(xml, 'C22', cab.observaciones ?? '')

  // ── Proctor (laboratorio): solo la fila 26; C/D se copian solas hacia abajo ──
  if (rows.length) {
    xml = setCell(xml, 'C26', maybeNum(rows[0].d_max))
    xml = setCell(xml, 'D26', maybeNum(rows[0].h_opt))
  }

  // ── Lecturas in situ (obra): una E/F por ensayo ──
  rows.slice(0, DATA_MAX_ROWS).forEach((r, i) => {
    xml = setCell(xml, `E${DATA_START_ROW + i}`, maybeNum(r.d_situ))
    xml = setCell(xml, `F${DATA_START_ROW + i}`, maybeNum(r.h_situ))
  })
  zip.file(datinfPath, xml)

  // ── Hoja INF: rellenar Nº ensayo (col. A) para que el formato condicional muestre las filas ──
  const infPath = sheetPath(zip, INF_SHEET)
  let inf = zip.file(infPath)!.asText()
  rows.slice(0, INF_MAX_ROWS).forEach((r, i) => {
    inf = setCell(inf, `A${INF_START_ROW + i}`, Number(r.n) || i + 1)
  })
  zip.file(infPath, inf)

  // ── Recalcular fórmulas/gráficos al abrir y mostrar la hoja del informe (INF) ──
  let wbXml = zip.file('xl/workbook.xml')!.asText()
  wbXml = wbXml.includes('fullCalcOnLoad')
    ? wbXml
    : wbXml.replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" ')
  wbXml = wbXml.replace(/<workbookView /, '<workbookView activeTab="1" ')
  zip.file('xl/workbook.xml', wbXml)

  // ── Limpiar caché de gráficas ────────────────────────────────────────────────
  // Los chart*.xml llevan <c:numCache> con datos hardcodeados de la plantilla vacía.
  // Excel los muestra en lugar de releer las celdas, de modo que la gráfica aparece
  // vacía o incorrecta. Al borrar el bloque numCache Excel lo reconstruye al abrir.
  clearChartCache(zip)

  // ── Quitar las macros VBA huérfanas ──────────────────────────────────────────
  // La plantilla es la versión vaciada de un .xls con macros (AdjustGraf, Espec,
  // Pred, VerInf, SaveAs) cuyo código VBA ya NO está en el fichero. Sus llamadas
  // (en los botones de DATINF y en el marco de las gráficas) provocan el aviso
  // "no se puede ejecutar la macro" al abrir y al pulsar la gráfica. Las anulamos.
  removeMacros(zip)

  // ── Eliminar calcChain.xml ──────────────────────────────────────────────────
  // Al cambiar los valores de entrada, la cadena de cálculo precomputada queda
  // obsoleta y Excel muestra avisos de "contenido reparado". Borrarla por completo
  // —junto con su Content-Type y su relación— hace que Excel la reconstruya limpia.
  removeCalcChain(zip)

  // ── Hornear las fórmulas ─────────────────────────────────────────────────────
  // La plantilla calcula compactación, medias, condiciones y la gráfica con fórmulas
  // que dependían de la macro AdjustGraf para acotar el rango. Sin hornear quedan
  // #¡DIV/0!/#N/A y la gráfica rota. Como cye-demo: calculamos todo y dejamos valores
  // estáticos, limpiando los errores a celda en blanco. (HyperFormula como motor.)
  bakeFormulas(zip)

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** Borra los bloques <c:numCache> de todos los chart*.xml y elimina los límites fijos
 *  de eje (c:min / c:max dentro de c:scaling) para que Excel auto-escale y recalcule
 *  la gráfica desde las referencias de celda al abrir el fichero. */
function clearChartCache(zip: PizZip): void {
  const chartDir = 'xl/charts/'
  Object.keys(zip.files)
    .filter(name => name.startsWith(chartDir) && name.endsWith('.xml') && !name.includes('_rels'))
    .forEach(name => {
      const f = zip.file(name)
      if (!f) return
      let xml = f.asText()
      // Elimina el caché de datos de cada serie
      xml = xml.replace(/<c:numCache>[\s\S]*?<\/c:numCache>/g, '')
      // Elimina límites fijos de eje para que Excel auto-escale según los datos reales
      xml = xml.replace(/<c:min val="[^"]*"\/>/g, '')
      xml = xml.replace(/<c:max val="[^"]*"\/>/g, '')
      zip.file(name, xml)
    })
}

/** Anula las llamadas a macros VBA inexistentes en hoja de datos y marcos de gráfica.
 *  Se ELIMINA el atributo `macro` entero (estado válido "sin macro"); dejarlo a ""
 *  hace que Excel considere el control inválido y lo quite ("Registros quitados:
 *  Objeto"). Apuntar a una macro inexistente sí se tolera, pero da error al pulsar. */
function removeMacros(zip: PizZip): void {
  for (const part of [
    'xl/worksheets/sheet1.xml',
    'xl/drawings/drawing1.xml',
    'xl/drawings/drawing2.xml'
  ]) {
    const f = zip.file(part)
    if (!f) continue
    zip.file(part, f.asText().replace(/\s*macro="\[0\]![^"]*"/g, ''))
  }
}

/** Quita calcChain.xml y todas sus referencias (Content_Types + relación del workbook). */
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

/** Construye el cuerpo de una celda baked, conservando su estilo. Error/vacío → celda en blanco. */
function bakedCellXml(ref: string, s: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${s}/>`
  if (typeof value === 'number')
    return isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : `<c r="${ref}"${s}/>`
  if (typeof value === 'boolean')
    return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(String(value))}</t></is></c>`
}

/**
 * "Hornea" las fórmulas del libro: las calcula con HyperFormula y las sustituye por
 * sus valores estáticos en el OOXML, limpiando errores (#N/A, #DIV/0…) a blanco —
 * como el _bake_formulas de cye-demo. Preserva formato, estilos y gráficos.
 */
function bakeFormulas(zip: PizZip): void {
  const wb = XLSX.read(zip.generate({ type: 'nodebuffer' }), { type: 'buffer', cellFormula: true })
  const sheets = wb.SheetNames

  // Rejilla por hoja (fórmula → "=f"; literal → su valor) para alimentar HyperFormula.
  type Raw = string | number | boolean | null
  const grids: Record<string, Raw[][]> = {}
  for (const name of sheets) {
    const ws = wb.Sheets[name]
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    const grid: Raw[][] = []
    for (let r = range.s.r; r <= range.e.r; r++) {
      const row: Raw[] = []
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]
        row.push(cell ? (cell.f ? '=' + cell.f : ((cell.v as Raw) ?? null)) : null)
      }
      grid.push(row)
    }
    grids[name] = grid
  }

  // dateFormats vacío → HyperFormula no auto-parsea strings como fechas.
  const hf = HyperFormula.buildFromSheets(grids, { licenseKey: 'gpl-v3', dateFormats: [] })

  for (const name of sheets) {
    const ws = wb.Sheets[name]
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
    const sid = hf.getSheetId(name)
    if (sid === undefined) continue
    const path = sheetPath(zip, name)
    let xml = zip.file(path)!.asText()
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const ref = XLSX.utils.encode_cell({ r, c })
        const cell = ws[ref]
        if (!cell?.f) continue // solo celdas con fórmula
        let v: unknown = hf.getCellValue({ sheet: sid, row: r, col: c })
        if (v !== null && typeof v === 'object') v = null // DetailedCellError → blanco
        const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
        const m = xml.match(re)
        if (!m) continue
        const sMatch = m[1].match(/\bs="(\d+)"/)
        xml = xml.replace(re, bakedCellXml(ref, sMatch ? ` s="${sMatch[1]}"` : '', v))
      }
    }
    zip.file(path, xml)
  }
  hf.destroy()
}
