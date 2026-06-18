const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);

// Footer XML
const footer1 = zip.file('word/footer1.xml').asText();
const footer2 = zip.file('word/footer2.xml').asText();
writeFileSync('/tmp/footer1.xml', footer1);
writeFileSync('/tmp/footer2.xml', footer2);
console.log('Footer1 text:', footer1.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,400));
console.log('Footer2 text:', footer2.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,400));

// Header XML
const header1 = zip.file('word/header1.xml').asText();
writeFileSync('/tmp/header1.xml', header1);
console.log('\nHeader1 text:', header1.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,400));

// Find Table 2 in document.xml
const docXml = zip.file('word/document.xml').asText();
const tables = [];
const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
let m;
while ((m = tblRe.exec(docXml)) !== null) tables.push(m[0]);

console.log(`\nFound ${tables.length} tables`);
if (tables[1]) {
  writeFileSync('/tmp/table2.xml', tables[1]);
  console.log('Table 2 XML length:', tables[1].length);
  console.log('Table 2 text:', tables[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,300));
}

// Find the "Narón" date paragraph
const naronRe = /(<w:p[ >][\s\S]*?Nar[oó]n[\s\S]*?<\/w:p>)/;
const naronMatch = docXml.match(naronRe);
if (naronMatch) {
  const text = naronMatch[1].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log('\nNarón paragraph text:', text.slice(0, 300));
  writeFileSync('/tmp/naron_para.xml', naronMatch[1]);
}

// Find TOTAL in document
const totalIdx = docXml.lastIndexOf('TOTAL');
if (totalIdx >= 0) {
  const snippet = docXml.slice(Math.max(0, totalIdx - 200), totalIdx + 500);
  const text = snippet.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log('\nTOTAL area:', text);
}
