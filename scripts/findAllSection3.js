const PizZip = require('pizzip');
const { readFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Find ALL occurrences of "VALORADO" 
let pos = 0;
let count = 0;
while ((pos = docXml.indexOf('VALORADO', pos)) !== -1) {
  const pStart = docXml.lastIndexOf('<w:p', pos);
  const pEnd = docXml.indexOf('</w:p>', pos) + 6;
  const para = docXml.slice(pStart, pEnd);
  const text = para.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log(`\nOccurrence ${++count} at pos ${pos}:`);
  console.log('  Paragraph text:', text.slice(0, 150));
  console.log('  Para ends at:', pEnd);
  pos++;
}

// Also search for "3.-" separately
console.log('\n\n=== ALL "3.-" occurrences ===');
pos = 0;
count = 0;
while ((pos = docXml.indexOf('3.-', pos)) !== -1) {
  const pStart = docXml.lastIndexOf('<w:p', pos);
  const pEnd = docXml.indexOf('</w:p>', pos) + 6;
  const para = docXml.slice(pStart, pEnd);
  const text = para.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log(`\n"3.-" occurrence ${++count} at pos ${pos}:`);
  console.log('  Paragraph text:', text.slice(0, 150));
  pos++;
}
