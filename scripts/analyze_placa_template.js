/**
 * Analiza la estructura de "Informe placa 4.xls" (formato BIFF/legacy) para mapear
 * las celdas de cabecera y datos que hay que rellenar en placaExcelTemplate.ts.
 *
 * Uso:  node scripts/analyze_placa_template.js
 */
const path = require('path')
// SheetJS lee .xls BIFF sin problemas
const XLSX = require('xlsx')

const FILE = path.join(__dirname, '..', 'resources', 'templates', 'Informe placa 4.xls')

const wb = XLSX.readFile(FILE, { cellDates: true, cellStyles: true, cellNF: true })

console.log('=== HOJAS ===')
console.log(wb.SheetNames)

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  if (!ws) continue
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
  console.log(`\n=== HOJA: ${name} (${ws['!ref']}) ===`)

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: true, defval: null })
  rows.forEach((row, ri) => {
    const cells = []
    row.forEach((v, ci) => {
      if (v !== null && v !== '') {
        const addr = XLSX.utils.encode_cell({ r: ri, c: ci })
        const raw = ws[addr]
        cells.push(`${addr}=${JSON.stringify(v)}${raw && raw.t ? '(' + raw.t + ')' : ''}`)
      }
    })
    if (cells.length) console.log(`  R${ri + 1}: ${cells.join(' | ')}`)
  })

  // Celdas combinadas
  const merges = ws['!merges'] || []
  if (merges.length) {
    console.log(`  Merges (${merges.length}):`)
    merges.slice(0, 30).forEach((m) => {
      console.log(
        `    ${XLSX.utils.encode_cell(m.s)}:${XLSX.utils.encode_cell(m.e)}`
      )
    })
  }
}
