/**
 * testTemplate.js — verifica que presupuesto_plantilla.docx se renderiza sin errores
 */
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const TEMPLATE = resolve(__dirname, '../resources/templates/presupuesto_plantilla.docx');
const OUTPUT   = resolve(__dirname, '../resources/templates/test_output.docx');

const testData = {
  ref_lab: 'P/0999/2025',
  fecha: '20 de Junio de 2025',
  responsable: 'Gonzalo J. Guzmán',
  obra: 'Carretera AC-211 Tramo Norte',
  cliente: 'ACORMAN, S.L.',
  total_sin_iva: '15.320,00',
  iva: '3.217,20',
  total_con_iva: '18.537,20',
  rows: [
    {
      descripcion: 'Granulometría de suelos por tamizado UNE 103101:95',
      medida: '107.121',
      frecuencia: '20.000',
      ud: 'M3',
      n_lotes: '5',
      ens_lote: '1',
      uds: '5',
      precio: '25,00',
      importe: '125,00'
    },
    {
      descripcion: 'Límites de Atterberg UNE 103103:94 / 103104:93',
      medida: '107.121',
      frecuencia: '20.000',
      ud: 'M3',
      n_lotes: '5',
      ens_lote: '1',
      uds: '5',
      precio: '30,00',
      importe: '150,00'
    },
    {
      descripcion: 'Proctor Modificado UNE 103501:94',
      medida: '107.121',
      frecuencia: '5.000',
      ud: 'M3',
      n_lotes: '21',
      ens_lote: '1',
      uds: '21',
      precio: '42,00',
      importe: '882,00'
    }
  ]
};

try {
  const content = readFileSync(TEMPLATE, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(testData);
  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(OUTPUT, buf);
  console.log('✅ Renderizado correctamente. Output:', OUTPUT);
  console.log('   Tamaño:', (buf.length / 1024).toFixed(1), 'KB');
} catch (err) {
  if (err.properties && err.properties.errors) {
    console.error('❌ Errores docxtemplater:');
    err.properties.errors.forEach(e => console.error('  ', e.message || e));
  } else {
    console.error('❌ Error:', err.message);
  }
}
