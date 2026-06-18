const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-0582-18 conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

const tables = [];
const re = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
let m;
while ((m = re.exec(docXml)) !== null) tables.push(m[0]);

const table4 = tables[3];

// Get table properties (tblPr and tblGrid)
const tblPrMatch = table4.match(/<w:tblPr>[\s\S]*?<\/w:tblPr>/);
const tblGridMatch = table4.match(/<w:tblGrid>[\s\S]*?<\/w:tblGrid>/);
console.log('=== TBLPR ===');
console.log(tblPrMatch ? tblPrMatch[0] : 'NOT FOUND');
console.log('\n=== TBLGRID ===');
console.log(tblGridMatch ? tblGridMatch[0] : 'NOT FOUND');

// Get first row (header) and 5th row (data row) XML
const rows = [];
const rowRe = /<w:tr>[\s\S]*?<\/w:tr>/g;
let rm;
while ((rm = rowRe.exec(table4)) !== null) rows.push(rm[0]);

console.log('\n=== ROW 1 (header) XML ===');
console.log(rows[0]);

console.log('\n=== ROW 2 (section) XML ===');
console.log(rows[1]);

console.log('\n=== ROW 5 (data row) XML ===');
console.log(rows[4]);

writeFileSync('/tmp/row1_header.xml', rows[0] || '');
writeFileSync('/tmp/row5_data.xml', rows[4] || '');
writeFileSync('/tmp/tblPr.xml', (tblPrMatch ? tblPrMatch[0] : '') + (tblGridMatch ? tblGridMatch[0] : ''));
