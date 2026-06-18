const PizZip = require('pizzip');
const { readFileSync } = require('fs');

const buf = readFileSync('resources/templates/presupuesto_plantilla.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Find {fecha} and show context
const idx = docXml.indexOf('{fecha}');
console.log('{fecha} position:', idx);
if (idx >= 0) {
  const pStart = docXml.lastIndexOf('<w:p', idx);
  const pEnd = docXml.indexOf('</w:p>', idx) + 6;
  const para = docXml.slice(pStart, pEnd);
  console.log('\nParagraph containing {fecha} text:');
  console.log(para.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  console.log('\nRaw XML around {fecha}:');
  console.log(docXml.slice(Math.max(0, idx - 300), idx + 200));
}
