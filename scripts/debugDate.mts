import PizZip from 'pizzip'
import { readFileSync } from 'fs'
import XLSX from 'xlsx'

const buf = readFileSync('placa_baked_test.xlsx')
const zip = new PizZip(buf)

// Leer DATINF sheet XML
const s1 = zip.file('xl/worksheets/sheet1.xml')!.asText()
const m = s1.match(/<c r="C1"[^>]*>[\s\S]*?<\/c>/)
console.log('DATINF C1 raw XML:', m?.[0] ?? 'NO ENCONTRADA')

// Buscar A7 en sheet2 (INF)
const s2 = zip.file('xl/worksheets/sheet2.xml')!.asText()
const m2 = s2.match(/<c r="A7"[^>]*>[\s\S]*?<\/c>/)
console.log('INF A7 raw XML:', m2?.[0] ?? 'NO ENCONTRADA')

// Ver qué lee XLSX de C1 en DATINF
const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true, cellDates: false })
const datinf = wb.Sheets['DATINF']
const c1 = datinf['C1']
console.log('\nDATINF C1 XLSX parsed:', JSON.stringify(c1))
