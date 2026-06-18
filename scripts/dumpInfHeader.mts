// Inspecciona las fórmulas reales de la hoja INF en la plantilla original
import PizZip from 'pizzip'
import { readFileSync } from 'fs'
import XLSX from 'xlsx'

const buf = readFileSync('resources/templates/plantilla_placa_carga.xlsx')
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true })
const inf = wb.Sheets['INF']

// Fórmulas de la cabecera (filas 3-9)
const cells = ['A3','A5','F5','A6','F6','A7','C7','F7','A8','F8','A9','D9','F9']
for (const ref of cells) {
  const c = inf[ref]
  console.log(`${ref}: f="${c?.f ?? '-'}" v="${c?.v ?? '-'}"`)
}
