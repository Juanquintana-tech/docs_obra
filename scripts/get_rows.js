const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-0582-18 conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Find Table 4 (the plan table)
const tables = [];
const re = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
let m;
while ((m = re.exec(docXml)) !== null) tables.push(m[0]);

// Table 4 is tables[3]
const table4 = tables[3];
console.log('Table 4 length:', table4.length);

// Find all rows in Table 4
const rows = [];
const rowRe = /<w:tr>[\s\S]*?<\/w:tr>/g;
let rm;
while ((rm = rowRe.exec(table4)) !== null) rows.push(rm[0]);
console.log('Rows in Table 4:', rows.length);

// Show first 5 rows
rows.slice(0, 5).forEach((row, i) => {
  const text = row.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log(`\nRow ${i+1}: ${text.slice(0, 200)}`);
  if (i < 3) {
    writeFileSync(`/tmp/row_${i+1}.xml`, row);
  }
});
