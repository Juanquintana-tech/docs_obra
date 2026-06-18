const PizZip = require('pizzip');
const { readFileSync } = require('fs');

function analyzeTables(path) {
  const buf = readFileSync(path, 'binary');
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();

  // Split into tables
  const tableMatches = xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || [];
  console.log(`Found ${tableMatches.length} tables`);

  tableMatches.forEach((tbl, i) => {
    // Extract text from each table
    const text = tbl.replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, (_, t) => t)
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim()
                     .slice(0, 500);
    console.log(`\n--- Table ${i+1} ---`);
    console.log(text);
  });
}

console.log('=== MODELO ===');
analyzeTables('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx');
