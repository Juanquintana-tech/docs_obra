const PizZip = require('pizzip')
const { readFileSync } = require('fs')

const tplBuf = readFileSync('resources/templates/plantilla_placa_carga.xlsx', 'binary')
const zip = new PizZip(tplBuf)

const files = Object.keys(zip.files).filter((f) => !zip.files[f].dir)
console.log('=== Archivos en el XLSX ===')
files.forEach((f) => console.log(' ', f))

const styles = zip.file('xl/styles.xml')
console.log('\n=== styles.xml:', !!styles, styles ? '(' + styles.asText().length + ' bytes)' : '')

const wb = zip.file('xl/workbook.xml').asText()
console.log('\n=== workbook.xml (primeros 800 chars) ===')
console.log(wb.slice(0, 800))

// Celdas de la hoja INF
const rels = zip.file('xl/_rels/workbook.xml.rels').asText()
const sheetMatch = wb.match(/name="INF"[^>]*r:id="([^"]+)"/)
if (sheetMatch) {
  const rId = sheetMatch[1]
  const relMatch = rels.match(new RegExp(`Id="${rId}"[^>]*Target="([^"]+)"`))
  if (relMatch) {
    const sheetPath = 'xl/' + relMatch[1].replace(/^\/?xl\//, '')
    const sheetXml = zip.file(sheetPath).asText()
    console.log('\n=== INF primeras 1000 chars ===')
    console.log(sheetXml.slice(0, 1000))
  }
}
