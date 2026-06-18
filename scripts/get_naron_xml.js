const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

const pos = 1049938;
let pStart = docXml.lastIndexOf('<w:p', pos);
let pEnd = docXml.indexOf('</w:p>', pos) + 6;
const para1 = docXml.slice(pStart, pEnd);
console.log('=== FULL XML of "Narón" paragraph ===');
console.log(para1);
writeFileSync('/tmp/naron_para.xml', para1);
