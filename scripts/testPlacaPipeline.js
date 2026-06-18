/**
 * Test end-to-end del pipeline de placa de carga con los datos reales del PDF.
 * Genera placa_test.xlsx y placa_test.docx en /tmp para revisión visual.
 *
 * Uso: node scripts/testPlacaPipeline.js
 */
const path = require('path')
const { writeFileSync } = require('fs')

// Reuse compiled TS via tsx
async function main() {
  // Importar funciones compiladas (usando tsx en modo CJS)
  const { fillPlacaTemplate } = await import('../src/main/pipeline/formatter/placaExcelTemplate.js').catch(() =>
    require('../out/main/pipeline/formatter/placaExcelTemplate')
  )

  // Datos del PDF adjunto
  const datos = {
    cabecera: {
      obra: 'RENOVACIÓN DE LAS VÍAS DEL RAMAL DE ACCESO AL PUERTO DE FERROL EN EL ÁMBITO DE TITULARIDAD DE LA APFSC HASTA SU CONEXIÓN CON EL NUEVO ACCESO FERROVIARO AL PUERTO EXTERIOR- DOTACIÓN DEL TERCER HILO" (P-1655)',
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
      tiempo: '50',
      humedad_suelo: '',
      observaciones: '',
      director: 'Gonzalo J. Guzmán',
      jefe_area: 'María Díaz Calvo'
    },
    radio_mm: 300, // Ø600 mm → radio = 300 mm
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
      { presion: 0.125,  l1: 1.25, l2: 1.91, l3: 3.18 },
      { presion: 0.0625, l1: 1.08, l2: 1.73, l3: 3.00 },
      { presion: 0.000,  l1: 0.79, l2: 1.43, l3: 2.65 }
    ],
    ciclo2: [
      { presion: 0.036, l1: 0.90, l2: 1.52, l3: 2.77 },
      { presion: 0.075, l1: 1.01, l2: 1.66, l3: 2.91 },
      { presion: 0.107, l1: 1.16, l2: 1.74, l3: 3.00 },
      { presion: 0.143, l1: 1.17, l2: 1.83, l3: 3.10 },
      { presion: 0.175, l1: 1.26, l2: 1.96, l3: 3.24 },
      { presion: 0.214, l1: 1.33, l2: 2.02, l3: 3.30 }
    ],
    destinatarios: [
      'S. A. de Obras y Servicios, COPASA Dirección: RUA DO PASEO, 25 - ENTLO. 32003 OURENSE OURENSE'
    ]
  }

  const obra = { obra: datos.cabecera.obra, ref_lab: datos.cabecera.ref_obra }
  const tpl = path.join(__dirname, '..', 'resources', 'templates', 'plantilla_placa_carga.xlsx')

  console.log('Generando Excel...')
  const xlsxBuf = fillPlacaTemplate(datos, obra, tpl)
  const xlsxOut = path.join(process.env.TMPDIR || '/tmp', 'placa_test.xlsx')
  writeFileSync(xlsxOut, xlsxBuf)
  console.log('Excel guardado:', xlsxOut)
}

main().catch(console.error)
