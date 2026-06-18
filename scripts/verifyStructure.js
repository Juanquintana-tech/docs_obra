const PizZip = require('pizzip');
const { readFileSync } = require('fs');

const buf = readFileSync('resources/templates/presupuesto_plantilla.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Show the document structure around the plan table
const blockRe = /(<w:tbl>[\s\S]*?<\/w:tbl>|<w:p>[\s\S]*?<\/w:p>|<w:p [^>]*>[\s\S]*?<\/w:p>)/g;
let m;
const blocks = [];
while ((m = blockRe.exec(docXml)) !== null) {
  const isTable = m[0].startsWith('<w:tbl>');
  const text = m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (isTable || text.length > 0) {
    blocks.push({ type: isTable ? 'TABLE' : 'PARA', text: text.slice(0, 100), xmlLen: m[0].length });
  }
}

// Show blocks around table positions
blocks.forEach((b, i) => {
  const marker = b.type === 'TABLE' ? `*** TABLE (${b.xmlLen} chars)` : b.text;
  console.log(`[${i}] ${b.type === 'TABLE' ? marker : b.text}`);
});
