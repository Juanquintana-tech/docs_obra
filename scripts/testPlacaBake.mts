import { fillPlacaTemplate } from '../src/main/pipeline/formatter/placaExcelTemplate'
import { writeFileSync } from 'fs'
import XLSX from 'xlsx'

const datos = {
  cabecera: {
    obra: 'RENOVACIÓN DE LAS VÍAS DEL RAMAL',
    cliente: 'S. A. de Obras y Servicios, COPASA',
    ref_obra: '0167/26',
    orden_trabajo: '26/1503',
    fecha_ensayo: '12-03-2026',
    fecha_informe: '12/03/2026',
    climatologia: 'Soleado',
    temperatura: '15',
    pk: 'PK 0+060',
    capa: 'Macadam (relleno saneo)',
    diam_placa: '60',
    tiempo: '50'
  },
  radio_mm: 150,
  ciclo1: [
    { presion: 0.000, l1: 0.00, l2: 0.00, l3: 0.00 },
    { presion: 0.036, l1: 0.15, l2: 0.20, l3: 0.30 },
    { presion: 0.075, l1: 0.48, l2: 0.67, l3: 1.10 },
    { presion: 0.107, l1: 0.62, l2: 0.93, l3: 1.62 },
    { presion: 0.143, l1: 0.79, l2: 1.20, l3: 2.09 },
    { presion: 0.175, l1: 0.94, l2: 1.40, l3: 2.48 },
    { presion: 0.214, l1: 1.15, l2: 1.72, l3: 2.96 },
    { presion: 0.250, l1: 1.36, l2: 2.04, l3: 3.32 }
  ],
  descarga: [
    { presion: 0.125, l1: 1.25, l2: 1.91, l3: 3.18 },
    { presion: 0.0625, l1: 1.08, l2: 1.73, l3: 3.00 },
    { presion: 0.000, l1: 0.79, l2: 1.43, l3: 2.65 }
  ],
  ciclo2: [
    { presion: 0.036, l1: 0.90, l2: 1.52, l3: 2.77 },
    { presion: 0.075, l1: 1.01, l2: 1.66, l3: 2.91 },
    { presion: 0.107, l1: 1.16, l2: 1.74, l3: 3.00 },
    { presion: 0.143, l1: 1.17, l2: 1.83, l3: 3.10 },
    { presion: 0.175, l1: 1.26, l2: 1.96, l3: 3.24 },
    { presion: 0.214, l1: 1.33, l2: 2.02, l3: 3.30 }
  ]
}

const buf = fillPlacaTemplate(datos, { obra: datos.cabecera.obra }, 'resources/templates/plantilla_placa_carga.xlsx')
writeFileSync('placa_baked_test.xlsx', buf)

// Inspeccionar valores clave en la hoja INF
const wb = XLSX.read(buf, { type: 'buffer' })
const inf = wb.Sheets['INF']
const datinf = wb.Sheets['DATINF']

console.log('=== DATINF celdas Ev ===')
console.log('G36 (Ev1):', datinf['G36']?.v)
console.log('G49 (Ev2):', datinf['G49']?.v)
console.log('G50 (ratio):', datinf['G50']?.v)
console.log('E37 (asiento medio 0.175 c1):', datinf['E37']?.v)
console.log('E34 (asiento medio 0.075 c1):', datinf['E34']?.v)

console.log('\n=== INF cabecera ===')
console.log('A3:', inf?.['A3']?.v)
console.log('A5:', inf?.['A5']?.v)
console.log('F5:', inf?.['F5']?.v)
console.log('A7:', inf?.['A7']?.v)
console.log('A8:', inf?.['A8']?.v)

console.log('\n=== INF Ev ===')
console.log('F18 (label Ev1):', inf?.['F18']?.v)
console.log('G18 (valor Ev1):', inf?.['G18']?.v)
console.log('F31 (label Ev2):', inf?.['F31']?.v)
console.log('G31 (valor Ev2):', inf?.['G31']?.v)
console.log('F32 (ratio label):', inf?.['F32']?.v)
console.log('G32 (ratio val):', inf?.['G32']?.v)

console.log('\nGenerado placa_baked_test.xlsx -', buf.length, 'bytes')
