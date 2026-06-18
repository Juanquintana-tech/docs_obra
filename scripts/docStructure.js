const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Extract all paragraphs and tables in order with their text content
// to understand the document structure
const blockRe = /(<w:tbl>[\s\S]*?<\/w:tbl>|<w:p>[\s\S]*?<\/w:p>|<w:p [^>]*>[\s\S]*?<\/w:p>)/g;
let m;
let idx = 0;
const blocks = [];
while ((m = blockRe.exec(docXml)) !== null) {
  const isTable = m[0].startsWith('<w:tbl>');
  const text = m[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (isTable) {
    blocks.push({ type: 'TABLE', text: text.slice(0, 100), xmlLen: m[0].length, offset: m.index });
  } else if (text.length > 0) {
    // Only non-empty paragraphs
    blocks.push({ type: 'PARA', text: text.slice(0, 120), offset: m.index });
  }
  idx++;
}

console.log(`Total blocks: ${blocks.length}`);
console.log('\n=== Document structure ===\n');
blocks.forEach((b, i) => {
  if (b.type === 'TABLE') {
    console.log(`[${i}] *** TABLE (${b.xmlLen} chars) *** : ${b.text}`);
  } else {
    console.log(`[${i}] ${b.text}`);
  }
});
