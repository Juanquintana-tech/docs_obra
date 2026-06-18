const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// The last Narón is at position 1049938 - look at a wider area to find paragraphs
const pos = 1049938;

// Find paragraph start before this position
let pStart = docXml.lastIndexOf('<w:p', pos);
let pEnd = docXml.indexOf('</w:p>', pos) + 6;
const para1 = docXml.slice(pStart, pEnd);
console.log('=== Paragraph containing "Narón" ===');
console.log(para1.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());

// Look at the next 3 paragraphs
let nextPos = pEnd;
for (let i = 0; i < 3; i++) {
  const start = docXml.indexOf('<w:p', nextPos);
  if (start < 0) break;
  const end = docXml.indexOf('</w:p>', start) + 6;
  const para = docXml.slice(start, end);
  console.log(`\n=== Para ${i+1} after Narón ===`);
  console.log(para.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
  nextPos = end;
}

// Also show last 2000 chars of document.xml to see end-of-document content
const endContent = docXml.slice(-3000);
writeFileSync('/tmp/modelo_end.xml', endContent);
console.log('\n=== Last 1000 chars text ===');
console.log(endContent.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(-800));
