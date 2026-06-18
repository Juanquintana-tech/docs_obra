// Muestra las fórmulas de G36 y G49/G50 en DATINF
import { readFileSync } from 'fs'
import XLSX from 'xlsx'
import PizZip from 'pizzip'

// Primero la plantilla ORIGINAL (antes de rellenar)
console.log('=== PLANTILLA ORIGINAL ===')
const tpl = readFileSync('resources/templates/plantilla_placa_carga.xlsx')
const wb1 = XLSX.read(tpl, { type: 'buffer', cellFormula: true })
const datinf1 = wb1.Sheets['DATINF']
console.log('G36 (Ev1 formula):', datinf1['G36']?.f, '→ v:', datinf1['G36']?.v)
console.log('G49 (Ev2 formula):', datinf1['G49']?.f, '→ v:', datinf1['G49']?.v)
console.log('G50 (ratio formula):', datinf1['G50']?.f, '→ v:', datinf1['G50']?.v)
console.log('E34 formula:', datinf1['E34']?.f)
console.log('E37 formula:', datinf1['E37']?.f)
console.log('E46 formula:', datinf1['E46']?.f)
console.log('E49 formula:', datinf1['E49']?.f)

// Ahora el XLSX bakeado generado por fillPlacaTemplate
console.log('\n=== XLSX BAKEADO (placa_baked_test.xlsx) ===')
const baked = readFileSync('placa_baked_test.xlsx')
const wb2 = XLSX.read(baked, { type: 'buffer', cellFormula: true })
const datinf2 = wb2.Sheets['DATINF']
console.log('E46 (asiento 0.075 c2):', datinf2['E46']?.v)
console.log('E49 (asiento 0.175 c2):', datinf2['E49']?.v)
console.log('G49 (Ev2):', datinf2['G49']?.v)
console.log()
// Calcular manual: 45/(E49-E46)
const e46 = datinf2['E46']?.v
const e49 = datinf2['E49']?.v
console.log('Manual Ev2 = 45/(E49-E46) =', e49, '-', e46, '=', e49-e46, '→', Math.round(45/(e49-e46)))

// Ver datos ciclo 2 (filas 45-50, columnas A-E)
console.log('\nCiclo2 (A45:E50):')
for (let row = 45; row <= 50; row++) {
  const vals = ['A','B','C','D','E'].map(col => datinf2[`${col}${row}`]?.v ?? '-')
  console.log(`Row ${row}:`, vals.join('\t'))
}
