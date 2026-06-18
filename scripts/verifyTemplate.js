const PizZip = require('pizzip');
const { readFileSync } = require('fs');

const buf = readFileSync('resources/templates/presupuesto_plantilla.docx', 'binary');
const zip = new PizZip(buf);

// 1. Check footers
const f1 = zip.file('word/footer1.xml').asText();
const f2 = zip.file('word/footer2.xml').asText();
console.log('Footer1 has {ref_lab}:', f1.includes('{ref_lab}'));
console.log('Footer2 has {ref_lab}:', f2.includes('{ref_lab}'));
console.log('Footer1 text:', f1.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,80));

// 2. Check plan table in document.xml
const docXml = zip.file('word/document.xml').asText();
console.log('\ndocument.xml has {#rows}:', docXml.includes('{#rows}'));
console.log('document.xml has {/rows}:', docXml.includes('{/rows}'));
console.log('document.xml has {descripcion}:', docXml.includes('{descripcion}'));
console.log('document.xml has {importe}:', docXml.includes('{importe}'));
console.log('document.xml has {total_sin_iva}:', docXml.includes('{total_sin_iva}'));
console.log('document.xml has {fecha}:', docXml.includes('{fecha}'));

// 3. Find the table with the markers and show its text content
const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
let m, tableIdx = 0;
while ((m = tblRe.exec(docXml)) !== null) {
  tableIdx++;
  const text = m[0].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  if (m[0].includes('{#rows}')) {
    console.log(`\nTable ${tableIdx} (plan table) text preview:`);
    console.log(text.slice(0, 400));
  }
}

// 4. Date area
const naronIdx = docXml.lastIndexOf('Narón');
if (naronIdx >= 0) {
  let pStart = docXml.lastIndexOf('<w:p', naronIdx);
  let pEnd = docXml.indexOf('</w:p>', naronIdx) + 6;
  const para = docXml.slice(pStart, pEnd);
  console.log('\nDate paragraph text:', para.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
}
