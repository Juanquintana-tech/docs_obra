const PizZip = require('pizzip');
const { readFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Search for "VALORADO" which should be unique enough
const idx = docXml.indexOf('VALORADO');
console.log('"VALORADO" found at:', idx);
if (idx >= 0) {
  const pStart = docXml.lastIndexOf('<w:p', idx);
  const pEnd = docXml.indexOf('</w:p>', idx) + 6;
  const para = docXml.slice(pStart, pEnd);
  console.log('Paragraph text:', para.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  console.log('\nEnd of paragraph XML (last 100 chars):');
  console.log(para.slice(-100));
  // Show what comes immediately after
  console.log('\nNext 300 chars after </w:p>:');
  console.log(docXml.slice(pEnd, pEnd + 300).replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
}

// Also check if "3.-" appears with the PLAN content
const idx3 = docXml.indexOf('3.-');
console.log('\n"3.-" found at:', idx3);
if (idx3 >= 0) {
  const snippet = docXml.slice(idx3, idx3 + 200).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log('Context:', snippet);
}
