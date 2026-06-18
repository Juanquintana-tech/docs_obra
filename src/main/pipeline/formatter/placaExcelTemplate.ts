/**
 * Rellena la plantilla Excel OFICIAL de carga con placa
 * (resources/templates/plantilla_placa_carga.xlsx) con los datos del ensayo.
 *
 * El XLSX contiene dos hojas:
 *   - DATINF  →  datos crudos de cabecera + lecturas de flexímetros.
 *                Las columnas E (asiento medio) y G (Ev1, Ev2, ratio) se calculan
 *                mediante fórmulas AVERAGE/ROUND, igual que en la plantilla real.
 *   - INF     →  informe formateado con CONCATENATE/IF que leen de DATINF.
 *                Se genera automáticamente al hornear las fórmulas.
 *
 * Flujo (idéntico a densidadExcelTemplate):
 *   1. Se vacían las celdas de entrada de la obra de muestra y se escribe en DATINF
 *      solo datos brutos. Las etiquetas/fórmulas de Ev y el gráfico nativo Presión/
 *      Asientos ya vienen en la plantilla y se conservan intactos.
 *   2. bakeFormulas (HyperFormula) calcula AVERAGE, CONCATENATE, Ev1/Ev2/ratio, etc.
 *   3. removeCalcChain elimina la cadena de cálculo obsoleta y removeMacros anula
 *      las llamadas a macros VBA huérfanas (botones SaveAs/VerInf) que dan aviso.
 *   4. Se activa la hoja INF como pestaña visible al abrir.
 *
 * Mapa de celdas DATINF que se rellenan:
 *   C1  fecha_ensayo      C2  fecha_informe     C3  procedencia
 *   C4  cliente           C5  obra              C6  ref_obra
 *   C8  orden_trabajo     C9  localizacion      C10 destinatario1
 *   C12 destinatario2     C14 destinatario3     C20 climatologia
 *   C21 temperatura       C22 pk                C23 capa
 *   C24 humedad_suelo     C25 diam_placa (cm)   C26 tiempo (min)
 *   C27 observaciones
 *   Ciclo1  → A32:D39  (presion + L1, L2, L3)
 *   Descarga→ A41:D43
 *   Ciclo2  → A45:D50
 *   F36 "Ev1 (MPa):"    F49 "Ev2 (MPa):"    F50 "Ev2/Ev1:"
 *   (G36, G49, G50 y toda la columna E se calculan por fórmulas de la plantilla)
 */
import PizZip from 'pizzip'
import { readFileSync } from 'fs'
import XLSX from 'xlsx'
import { HyperFormula } from 'hyperformula'
import type { PlacaInput, PlacaFila } from '../ensayos'

// ── Constantes de la plantilla ───────────────────────────────────────────────
const DATA_SHEET = 'DATINF'

// Filas de datos en DATINF (1-indexed)
const C1_START = 32 // primer escalón ciclo 1
const C1_MAX = 8 // máx. escalones ciclo 1
const DESC_START = 41
const DESC_MAX = 3
const C2_START = 45
const C2_MAX = 6

// Celdas de entrada que gestiona la app: se vacían antes de rellenar para que NUNCA
// queden datos de otra obra de la plantilla de muestra. Las etiquetas/fórmulas
// (E asiento medio, F/G de Ev) y el material (C7) son fijas y NO se tocan.
const HEADER_INPUT_CELLS = [
  'C1',
  'C2',
  'C3',
  'C4',
  'C5',
  'C6',
  'C8',
  'C9',
  'C10',
  'C12',
  'C14',
  'C16',
  'C18',
  'C20',
  'C21',
  'C22',
  'C23',
  'C24',
  'C25',
  'C26',
  'C27'
]
const DATA_ROWS = [32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43, 45, 46, 47, 48, 49, 50]

// ── Helpers XML ──────────────────────────────────────────────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function maybeNum(v: unknown): number | string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return isFinite(v) ? v : null
  const n = parseFloat(String(v).trim().replace(',', '.'))
  return isNaN(n) ? String(v) : n
}

/**
 * Reemplaza el valor de una celda existente conservando su estilo.
 * Si la celda tiene fórmula la convierte en valor estático.
 * Devuelve el XML sin cambios si value es null/vacío.
 */
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

/** Vacía el valor de una celda existente conservando su estilo (`<c r s/>`). */
function clearCell(xml: string, ref: string): string {
  const re = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`)
  const m = xml.match(re)
  if (!m) return xml
  const styleMatch = m[1].match(/\bs="(\d+)"/)
  return xml.replace(re, `<c r="${ref}"${styleMatch ? ` s="${styleMatch[1]}"` : ''}/>`)
}

/** Resuelve nombre de hoja → ruta XML dentro del zip. */
function sheetPath(zip: PizZip, name: string): string {
  const wb = zip.file('xl/workbook.xml')!.asText()
  const rels = zip.file('xl/_rels/workbook.xml.rels')!.asText()
  const sheet = [...wb.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find(
    (x) => x[1] === name
  )
  if (!sheet) throw new Error(`Hoja ${name} no encontrada en la plantilla de placa`)
  const rel = [...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].find(
    (x) => x[1] === sheet[2]
  )
  if (!rel) throw new Error(`Relación de la hoja ${name} no encontrada`)
  return 'xl/' + rel[2].replace(/^\/?xl\//, '')
}

// ── Relleno de DATINF ────────────────────────────────────────────────────────

function fillDatinf(
  xml: string,
  datos: PlacaInput & Record<string, unknown>,
  obra: ObraLike
): string {
  const cab = (datos.cabecera as Record<string, string>) ?? {}
  const dests = ((datos.destinatarios as string[]) ?? []).filter(Boolean)

  // 0. Vaciar las celdas de entrada para no arrastrar datos de la obra de muestra.
  for (const ref of HEADER_INPUT_CELLS) xml = clearCell(xml, ref)
  for (const row of DATA_ROWS) {
    xml = clearCell(xml, `B${row}`)
    xml = clearCell(xml, `C${row}`)
    xml = clearCell(xml, `D${row}`)
  }

  // 1. Cabecera. Cliente/obra/ref se toman del registro de la obra (como densidad);
  //    el resto, de la cabecera del ensayo.
  xml = setCell(xml, 'C1', cab.fecha_ensayo ?? '')
  xml = setCell(xml, 'C2', cab.fecha_informe || cab.fecha_ensayo || '')
  xml = setCell(xml, 'C3', cab.procedencia ?? '')
  xml = setCell(xml, 'C4', cab.cliente || obra.cliente || '')
  xml = setCell(xml, 'C5', cab.obra || obra.obra || '')
  xml = setCell(xml, 'C6', cab.ref_obra || obra.ref_lab || '')
  xml = setCell(xml, 'C8', cab.orden_trabajo ?? '')
  xml = setCell(xml, 'C9', cab.localizacion || 'en Obra')
  if (dests[0]) xml = setCell(xml, 'C10', dests[0])
  if (dests[1]) xml = setCell(xml, 'C12', dests[1])
  if (dests[2]) xml = setCell(xml, 'C14', dests[2])
  if (dests[3]) xml = setCell(xml, 'C16', dests[3])
  if (dests[4]) xml = setCell(xml, 'C18', dests[4])
  xml = setCell(xml, 'C20', cab.climatologia ?? '')
  const temp = maybeNum(cab.temperatura)
  if (temp !== null) xml = setCell(xml, 'C21', temp)
  xml = setCell(xml, 'C22', cab.pk ?? '')
  xml = setCell(xml, 'C23', cab.capa ?? '')
  xml = setCell(xml, 'C24', cab.humedad_suelo ?? '')
  // C25 = Ø de placa en CM (la app lo introduce en mm → ÷10).
  const diamMm = maybeNum(cab.diam_placa)
  if (typeof diamMm === 'number') xml = setCell(xml, 'C25', Math.round((diamMm / 10) * 100) / 100)
  const tiempo = maybeNum(cab.tiempo)
  if (tiempo !== null) xml = setCell(xml, 'C26', tiempo)
  xml = setCell(xml, 'C27', cab.observaciones ?? '')

  // 2. Lecturas de flexímetros (solo A-D; la columna E y los Ev son fórmulas de la
  //    plantilla, que se hornean después). A (presión) se reescribe con la del ensayo.
  const writeRow = (row: number, r: PlacaFila | undefined): void => {
    if (!r) return
    xml = setCell(xml, `A${row}`, maybeNum(r.presion))
    xml = setCell(xml, `B${row}`, maybeNum(r.l1))
    xml = setCell(xml, `C${row}`, maybeNum(r.l2))
    xml = setCell(xml, `D${row}`, maybeNum(r.l3))
  }
  ;(datos.ciclo1 ?? []).slice(0, C1_MAX).forEach((r, i) => writeRow(C1_START + i, r))
  ;(datos.descarga ?? []).slice(0, DESC_MAX).forEach((r, i) => writeRow(DESC_START + i, r))
  ;(datos.ciclo2 ?? []).slice(0, C2_MAX).forEach((r, i) => writeRow(C2_START + i, r))

  return xml
}

// ── bakeFormulas y removeCalcChain (de densidadExcelTemplate) ────────────────

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

function xmlEscapeBake(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function bakedCellXml(ref: string, s: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${s}/>`
  if (typeof value === 'number')
    return isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : `<c r="${ref}"${s}/>`
  if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscapeBake(String(value))}</t></is></c>`
}

function bakeFormulas(zip: PizZip): void {
  const wb = XLSX.read(zip.generate({ type: 'nodebuffer' }), { type: 'buffer', cellFormula: true })
  const sheets = wb.SheetNames
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
  // Los campos de fecha en DATINF son texto plano; no se necesita aritmética de fechas.
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
        if (!cell?.f) continue
        let v: unknown = hf.getCellValue({ sheet: sid, row: r, col: c })
        if (v !== null && typeof v === 'object') v = null
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

/** Anula las llamadas a macros VBA inexistentes (botones SaveAs/VerInf en DATINF y
 *  marcos de gráfica). El .xlsx ya no lleva el código VBA, así que apuntar a esas
 *  macros provoca el aviso "no se puede ejecutar la macro" al abrir/pulsar. Se
 *  ELIMINA el atributo `macro` entero (estado válido "sin macro"). Igual que densidad. */
function removeMacros(zip: PizZip): void {
  for (const part of [
    'xl/worksheets/sheet1.xml',
    'xl/worksheets/sheet2.xml',
    'xl/drawings/drawing1.xml',
    'xl/drawings/drawing2.xml',
    'xl/drawings/vmlDrawing1.vml',
    'xl/drawings/vmlDrawing2.vml'
  ]) {
    const f = zip.file(part)
    if (!f) continue
    zip.file(part, f.asText().replace(/\s*macro="\[0\]![^"]*"/g, ''))
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

interface ObraLike {
  obra?: string
  cliente?: string
  ref_lab?: string
}

/** Genera el .xlsx oficial de placa de carga a partir de la plantilla y los datos. */
export function fillPlacaTemplate(
  datos: PlacaInput & Record<string, unknown>,
  obra: ObraLike,
  templatePath: string
): Buffer {
  const zip = new PizZip(readFileSync(templatePath, 'binary'))

  // 1. Rellenar DATINF con los datos brutos (vaciando antes la obra de muestra)
  const datinfPath = sheetPath(zip, DATA_SHEET)
  zip.file(datinfPath, fillDatinf(zip.file(datinfPath)!.asText(), datos, obra))

  // 2. Hornear las fórmulas (AVERAGE para asiento medio, CONCATENATE para INF, etc.)
  bakeFormulas(zip)

  // 3. Eliminar la cadena de cálculo obsoleta y las macros VBA huérfanas
  removeCalcChain(zip)
  removeMacros(zip)

  // 4. Activar la hoja INF al abrir y forzar recálculo. Cuidado: la plantilla puede
  //    traer YA un activeTab → si lo insertáramos sin más quedaría el atributo
  //    duplicado y Excel daría el libro por dañado. Se reemplaza si existe.
  let wbXml = zip.file('xl/workbook.xml')!.asText()
  wbXml = wbXml.includes('fullCalcOnLoad')
    ? wbXml
    : wbXml.replace(/<calcPr /, '<calcPr fullCalcOnLoad="1" ')
  wbXml = /activeTab="\d+"/.test(wbXml)
    ? wbXml.replace(/activeTab="\d+"/, 'activeTab="1"')
    : wbXml.replace(/<workbookView /, '<workbookView activeTab="1" ')
  zip.file('xl/workbook.xml', wbXml)

  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
