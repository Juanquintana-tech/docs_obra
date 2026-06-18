/**
 * testEndToEnd.js — prueba el flujo completo de generación Word con datos de BD
 * Usa el primer proyecto de la base de datos local.
 */
const { resolve } = require('path');
const Database = require('better-sqlite3');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { readFileSync, writeFileSync } = require('fs');

const DB_PATH = resolve(process.env.HOME, 'Library/Application Support/cye-electron/cye.db');
const TEMPLATE = resolve(__dirname, '../resources/templates/presupuesto_plantilla.docx');
const OUTPUT   = resolve(__dirname, '../resources/templates/test_e2e_output.docx');

const IVA_RATE = 0.21;
const num = (n) => n == null ? '' : n.toLocaleString('es-ES', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const money = (n) => n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

try {
  const db = new Database(DB_PATH, { readonly: true });
  
  // Get first obra
  const obra = db.prepare('SELECT * FROM obras ORDER BY id LIMIT 1').get();
  if (!obra) { console.log('No hay obras en la BD'); process.exit(0); }
  console.log('Obra:', obra.nombre, '| Cliente:', obra.cliente, '| Ref:', obra.ref_laboratorio);
  
  // Get plan rows
  const rows = db.prepare('SELECT * FROM plan_rows WHERE obra_id = ? ORDER BY id').all(obra.id);
  console.log('Filas del plan:', rows.length, '(tipo test:', rows.filter(r => r.row_type === 'test').length, ')');
  
  // Build template data
  const testRows = rows.filter(r => r.row_type === 'test');
  const total = testRows.reduce((s, r) => s + (r.total ?? 0), 0);
  
  // Group by material → subcategory
  const grouped = new Map();
  for (const r of testRows) {
    const mat = r.material ?? 'OTROS';
    const sub = r.subcategory ?? '';
    if (!grouped.has(mat)) grouped.set(mat, new Map());
    const matMap = grouped.get(mat);
    if (!matMap.has(sub)) matMap.set(sub, []);
    matMap.get(sub).push(r);
  }
  
  const templateRows = [];
  for (const [mat, subcats] of grouped) {
    templateRows.push({ descripcion: mat.toUpperCase(), medida: '', frecuencia: '', ud: '', n_lotes: '', ens_lote: '', uds: '', precio: '', importe: '' });
    for (const [sub, tests] of subcats) {
      if (sub) templateRows.push({ descripcion: `   ${sub}`, medida: '', frecuencia: '', ud: '', n_lotes: '', ens_lote: '', uds: '', precio: '', importe: '' });
      for (const r of tests) {
        templateRows.push({
          descripcion: r.description ?? '',
          medida: num(r.measurement),
          frecuencia: num(r.freq_qty),
          ud: r.measurement_unit ?? '',
          n_lotes: num(r.n_lots),
          ens_lote: num(r.tests_per_lot),
          uds: num(r.n_tests),
          precio: num(r.unit_price),
          importe: num(r.total)
        });
      }
    }
  }
  
  const data = {
    obra: obra.nombre ?? '',
    cliente: obra.cliente ?? '',
    ref_lab: obra.ref_laboratorio ?? 'P/XXX/XXXX',
    fecha: new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }),
    responsable: 'Gonzalo J. Guzmán',
    total_sin_iva: money(total),
    iva: money(total * IVA_RATE),
    total_con_iva: money(total * (1 + IVA_RATE)),
    rows: templateRows
  };
  
  console.log('\nDatos template:');
  console.log('  ref_lab:', data.ref_lab);
  console.log('  fecha:', data.fecha);
  console.log('  total:', data.total_sin_iva, '€');
  console.log('  filas (con cabeceras):', templateRows.length);
  
  // Render
  const content = readFileSync(TEMPLATE, 'binary');
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(data);
  const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  writeFileSync(OUTPUT, buf);
  
  console.log('\n✅ Documento generado:', OUTPUT);
  console.log('   Tamaño:', (buf.length / 1024).toFixed(1), 'KB');
  
} catch (err) {
  if (err.properties && err.properties.errors) {
    console.error('❌ Errores docxtemplater:', err.properties.errors.map(e => e.message).join('; '));
  } else {
    console.error('❌ Error:', err.message);
  }
  process.exit(1);
}
