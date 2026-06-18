/**
 * Vuelca el XML completo de la hoja INF para ver todas las fórmulas.
 */
const PizZip = require('pizzip')
const { readFileSync, writeFileSync } = require('fs')
const path = require('path')

const zip = new PizZip(readFileSync('resources/templates/plantilla_placa_carga.xlsx', 'binary'))
const xml = zip.file('xl/worksheets/sheet2.xml').asText()

// Mostrar todas las filas con fórmulas
const rows = xml.match(/<row[^>]*>[\s\S]*?<\/row>/g) || []
for (const row of rows) {
  const rNum = (row.match(/ r="(\d+)"/) || [])[1]
  const formulas = row.match(/<f>[^<]+<\/f>/g) || []
  if (formulas.length) {
    console.log(`\n-- Fila ${rNum} --`)
    const cells = row.match(/<c r="[^"]+[^>]*>[\s\S]*?<\/c>/g) || []
    for (const c of cells) {
      const ref = (c.match(/r="([^"]+)"/) || [])[1]
      const f = (c.match(/<f>([^<]+)<\/f>/) || [])[1]
      const v = (c.match(/<v>([^<]*)<\/v>/) || [])[1] || ''
      if (f) console.log(`  ${ref}: f=${f}  v=${v.slice(0, 60)}`)
    }
  }
}

// Guardar también el XML completo para revisión
writeFileSync(path.join(process.env.TMPDIR || '/tmp', 'inf_sheet.xml'), xml)
console.log('\n\nXML completo guardado en $TMPDIR/inf_sheet.xml')
