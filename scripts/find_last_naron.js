const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// The last Narón is at position 1049938 - check context
const pos = 1049938;
const area = docXml.slice(pos - 1000, pos + 1500);
writeFileSync('/tmp/last_naron.xml', area);
console.log('Last Narón context (text):');
console.log(area.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim());
