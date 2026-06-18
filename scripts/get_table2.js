const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

const tables = [];
const re = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
let m;
while ((m = re.exec(docXml)) !== null) tables.push(m[0]);

console.log('Number of tables:', tables.length);
if (tables[1]) {
  writeFileSync('/tmp/modelo_table2.xml', tables[1]);
  console.log('Table 2 length:', tables[1].length);
  console.log('First 3000 chars:');
  console.log(tables[1].slice(0, 3000));
}

// Also find the paragraphs around/after Table 2 to understand surrounding context
// and find the "Narón (A Coruña), a" date area - look for it in text
const dateSearch = docXml.lastIndexOf('Narón (A Coruña), a');
console.log('\nDate string position:', dateSearch);
if (dateSearch >= 0) {
  const area = docXml.slice(dateSearch, dateSearch + 600);
  writeFileSync('/tmp/date_area.xml', area);
  console.log(area.replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
}
