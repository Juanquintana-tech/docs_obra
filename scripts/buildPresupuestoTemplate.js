/**
 * buildPresupuestoTemplate.js
 * 
 * Toma el MODELO corporativo (P-xxx.yy - MODELO PRESUPUESTO conv.docx) y genera
 * resources/templates/presupuesto_plantilla.docx con marcadores docxtemplater:
 *
 *  - Pie de página: P/XXX/YY → {ref_lab}
 *  - Tabla de plan: tabla 2 (vacía) → tabla con bucle {#rows}…{/rows}
 *  - Firma: "a   EL DIRECTOR" → "a {fecha} EL DIRECTOR"
 *
 * Uso:  node scripts/buildPresupuestoTemplate.js
 */

const PizZip = require('pizzip');
const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { resolve } = require('path');

const MODELO = resolve(__dirname, '../resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx');
const OUTPUT = resolve(__dirname, '../resources/templates/presupuesto_plantilla.docx');

// ─── Column widths (dxa) extraídos de P-0582-18 Tabla 4 ──────────────────────
const COLS = [4536, 850, 995, 424, 566, 712, 423, 852, 846];
const HEADERS = ['ENSAYO', 'Medición', 'Frecuencia', 'Ud.', 'Nº Lotes', 'Nº ens./Lote', 'Uds.', 'PRECIO UNIT. €', 'IMPORTE €'];
const FIELDS  = ['descripcion', 'medida', 'frecuencia', 'ud', 'n_lotes', 'ens_lote', 'uds', 'precio', 'importe'];

// ─── Helpers XML ─────────────────────────────────────────────────────────────

/** rPr común: Arial 6.5pt (sz=13 = half-pts) */
const RPR_NORMAL = `<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:color w:val="000000"/><w:sz w:val="13"/><w:szCs w:val="13"/></w:rPr>`;
const RPR_BOLD   = `<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="000000"/><w:sz w:val="13"/><w:szCs w:val="13"/></w:rPr>`;
const RPR_BOLD_WHITE = `<w:rPr><w:rFonts w:ascii="Arial" w:eastAsia="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:b/><w:bCs/><w:color w:val="FFFFFF"/><w:sz w:val="13"/><w:szCs w:val="13"/></w:rPr>`;

const BORDERS = `<w:tcBorders>
  <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
  <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
  <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
</w:tcBorders>`;

function tc(w, text, { bold = false, center = false, fill = 'auto', span = 1, white = false } = {}) {
  const rpr = white ? RPR_BOLD_WHITE : (bold ? RPR_BOLD : RPR_NORMAL);
  const jc = center ? 'center' : 'both';
  const spanAttr = span > 1 ? `<w:gridSpan w:val="${span}"/>` : '';
  const fillAttr = fill !== 'auto' ? `<w:shd w:val="clear" w:color="auto" w:fill="${fill}"/>` : `<w:shd w:val="clear" w:color="auto" w:fill="auto"/>`;
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${spanAttr}${BORDERS}${fillAttr}<w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="145" w:lineRule="atLeast"/><w:jc w:val="${jc}"/>${rpr}</w:pPr><w:r>${rpr}<w:t xml:space="preserve">${text}</w:t></w:r></w:p></w:tc>`;
}

// ─── Tabla del plan ───────────────────────────────────────────────────────────

function buildPlanTable() {
  const tblPr = `<w:tblPr>
  <w:tblW w:w="0" w:type="auto"/>
  <w:tblBorders>
    <w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/>
    <w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/>
  </w:tblBorders>
  <w:tblLayout w:type="fixed"/>
  <w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar>
</w:tblPr>`;

  const tblGrid = `<w:tblGrid>${COLS.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;

  // Fila cabecera (azul oscuro CYE)
  const NAVY = '1F3864';
  const headerCells = HEADERS.map((h, i) => tc(COLS[i], h, { bold: true, center: true, fill: NAVY, white: true })).join('');
  const headerRow = `<w:tr><w:trPr><w:trHeight w:hRule="exact" w:val="614"/></w:trPr>${headerCells}</w:tr>`;

  // Fila de datos con bucle docxtemplater
  // {#rows} va en el PRIMER texto, {/rows} al FINAL del último texto
  const dataCells = FIELDS.map((f, i) => {
    const prefix = i === 0 ? '{#rows}' : '';
    const suffix = i === FIELDS.length - 1 ? '{/rows}' : '';
    return tc(COLS[i], `${prefix}{${f}}${suffix}`, { center: i > 0 });
  }).join('');
  const dataRow = `<w:tr><w:trPr><w:trHeight w:hRule="atLeast" w:val="340"/></w:trPr>${dataCells}</w:tr>`;

  // Fila TOTAL
  const totalW = COLS.slice(0, COLS.length - 1).reduce((s, w) => s + w, 0); // suma cols 0..7
  const totalCell = tc(totalW, 'TOTAL (IVA no incluido)', { bold: true, center: false, span: COLS.length - 1 });
  const importeCell = tc(COLS[COLS.length - 1], '{total_sin_iva}', { bold: true, center: true });
  const totalRow = `<w:tr><w:trPr><w:trHeight w:hRule="atLeast" w:val="340"/></w:trPr>${totalCell}${importeCell}</w:tr>`;

  return `<w:tbl>${tblPr}${tblGrid}${headerRow}${dataRow}${totalRow}</w:tbl>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('Leyendo MODELO:', MODELO);
const raw = readFileSync(MODELO, 'binary');
const zip = new PizZip(raw);

// 1. Pies de página: reemplazar P/XXX/YY → {ref_lab}
for (const name of ['word/footer1.xml', 'word/footer2.xml']) {
  const file = zip.file(name);
  if (!file) { console.log(`  ⚠ No encontrado: ${name}`); continue; }
  const xml = file.asText().replace(/<w:t>P\/XXX\/YY<\/w:t>/g, '<w:t>{ref_lab}</w:t>');
  zip.file(name, xml);
  console.log(`  ✓ ${name}: P/XXX/YY → {ref_lab}`);
}

// 2. document.xml
let docXml = zip.file('word/document.xml').asText();

// 2a. Firma: insertar {fecha} en el párrafo "Narón (A Coruña), a   EL DIRECTOR TÉCNICO"
//     Estrategia: encontrar el párrafo que contiene "Coruña)," y "EL" y reemplazar
//     la secuencia "a   " por "a {fecha} " dentro de ESE párrafo específicamente.
{
  // Encontrar el párrafo completo con Narón / Coruña (es el último en el documento)
  const NARON_SEARCH = 'Narón';
  const lastNaronIdx = docXml.lastIndexOf(NARON_SEARCH);
  if (lastNaronIdx >= 0) {
    // Extraer el párrafo completo
    const pStart = docXml.lastIndexOf('<w:p', lastNaronIdx);
    const pEnd = docXml.indexOf('</w:p>', lastNaronIdx) + 6;
    const paraBefore = docXml.slice(pStart, pEnd);
    
    // Dentro de ESE párrafo, reemplazar el run de doble espacio (entre "a" y "EL")
    // El run tiene: <w:t xml:space="preserve">  </w:t>
    // Justo después del run con <w:t>a</w:t>
    const DOUBLE_SPACE = '<w:t xml:space="preserve">  </w:t>';
    if (paraBefore.includes(DOUBLE_SPACE)) {
      const paraAfter = paraBefore.replace(DOUBLE_SPACE, '<w:t xml:space="preserve">{fecha} </w:t>');
      docXml = docXml.slice(0, pStart) + paraAfter + docXml.slice(pEnd);
      console.log('  ✓ document.xml: fecha placeholder insertado en párrafo de firma');
    } else {
      console.log('  ⚠ document.xml: no se encontró doble espacio en párrafo Narón');
    }
  } else {
    console.log('  ⚠ document.xml: párrafo Narón no encontrado');
  }
}

// 2b. Tabla del plan: la Tabla 2 del MODELO está ANTES del título "3.- PLAN DE CONTROL VALORADO"
//     pero el plan debe ir DESPUÉS de ese título.
//     Estrategia:
//       1. Encontrar la Tabla 2 vacía y el párrafo "3.- PLAN DE CONTROL VALORADO" (2ª ocurrencia)
//       2. Eliminar la Tabla 2 de su posición actual e insertar la nueva tabla DESPUÉS del título
const tables = [];
const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
let m;
while ((m = tblRe.exec(docXml)) !== null) tables.push({ xml: m[0], index: m.index });
console.log(`  Tablas encontradas en document.xml: ${tables.length}`);

if (tables.length >= 2) {
  const emptyTable2 = tables[1].xml;

  // Encontrar la 2ª ocurrencia de "VALORADO" = el título real de la sección 3
  // (la 1ª es el índice en la portada)
  const ANCHOR = 'VALORADO';
  const first = docXml.indexOf(ANCHOR);
  const second = docXml.indexOf(ANCHOR, first + 1);

  if (second >= 0) {
    // Fin del párrafo que contiene el título "3.- PLAN DE CONTROL VALORADO"
    const headingPEnd = docXml.indexOf('</w:p>', second) + 6;

    // Reconstruir: quitar la tabla vacía + insertar plan table después del título
    // Como la tabla vacía está ANTES del título, primero la quitamos y luego
    // calculamos la nueva posición del fin del título
    const before = docXml.slice(0, tables[1].index);
    const after  = docXml.slice(tables[1].index + emptyTable2.length);
    docXml = before + after;

    // Ahora el título ha desplazado su posición: buscar de nuevo
    const second2 = docXml.indexOf(ANCHOR, docXml.indexOf(ANCHOR) + 1);
    const headingPEnd2 = docXml.indexOf('</w:p>', second2) + 6;
    const newTable = buildPlanTable();
    docXml = docXml.slice(0, headingPEnd2) + newTable + docXml.slice(headingPEnd2);
    console.log('  ✓ Tabla 2 vacía eliminada e inserción tras "3.- PLAN DE CONTROL VALORADO"');
  } else {
    // Fallback: sustituir la tabla vacía directamente
    docXml = docXml.replace(emptyTable2, buildPlanTable());
    console.log('  ✓ Tabla 2 reemplazada en su posición original (fallback)');
  }
} else {
  console.log('  ⚠ No se encontraron 2 tablas en document.xml');
}

zip.file('word/document.xml', docXml);

// 3. Guardar
mkdirSync(resolve(__dirname, '../resources/templates'), { recursive: true });
const output = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync(OUTPUT, output);
console.log('\n✅ Plantilla generada:', OUTPUT);
console.log(`   Tamaño: ${(output.length / 1024).toFixed(1)} KB`);
