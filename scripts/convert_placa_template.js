/**
 * Convierte Informe placa 4.xls (BIFF) → plantilla_placa_carga.xlsx (OOXML)
 * y detecta fórmulas en ambas hojas.
 *
 * Uso:  node scripts/convert_placa_template.js
 */
const path = require('path')
const XLSX = require('xlsx')
const { writeFileSync } = require('fs')

const SRC = path.join(__dirname, '..', 'resources', 'templates', 'Informe placa 4.xls')
const DST = path.join(__dirname, '..', 'resources', 'templates', 'plantilla_placa_carga.xlsx')

const wb = XLSX.readFile(SRC, { cellDates: true, cellStyles: true, cellNF: true })

// Detectar fórmulas
let formulaCount = 0
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  if (!ws) continue
  for (const [addr, cell] of Object.entries(ws)) {
    if (addr.startsWith('!')) continue
    if (cell && cell.t === 'f') {
      console.log(`  FORMULA ${name}!${addr}: ${cell.f}`)
      formulaCount++
    }
  }
}
console.log(`\nTotal fórmulas: ${formulaCount}`)

// Guardar como XLSX
XLSX.writeFile(wb, DST, { bookType: 'xlsx', type: 'buffer' })
console.log(`\nGuardado: ${DST}`)
