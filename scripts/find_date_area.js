const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

const buf = readFileSync('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Search for "EL DIRECTOR" area 
const dirIdx = docXml.indexOf('EL DIRECTOR');
console.log('EL DIRECTOR found at index:', dirIdx);
if (dirIdx >= 0) {
  const area = docXml.slice(Math.max(0, dirIdx - 500), dirIdx + 500);
  writeFileSync('/tmp/director_area.xml', area);
  console.log('TEXT around EL DIRECTOR:');
  console.log(area.replace(/<[^>]+>/g,' ').replace(/\s+/g,' '));
}

// Also search for footer XML with P/XXX/YY
const footer1Xml = zip.file('word/footer1.xml').asText();
const footer2Xml = zip.file('word/footer2.xml').asText();

// Find the exact text runs that contain P/XXX/YY
console.log('\n--- FOOTER1 XML around P/XXX ---');
const idx1 = footer1Xml.indexOf('P/XXX/YY');
if (idx1 >= 0) {
  const snippet = footer1Xml.slice(Math.max(0,idx1-400), idx1+200);
  console.log(snippet);
}
writeFileSync('/tmp/footer1_full.xml', footer1Xml);

// Find "Narón" or any city+address in the main document - at the END
// The MODELO has a signature block at the end with location
const allNaron = [];
let pos = 0;
while ((pos = docXml.indexOf('Nar', pos)) !== -1) {
  const context = docXml.slice(pos, pos+100).replace(/<[^>]+>/g,' ').trim();
  allNaron.push({pos, context});
  pos++;
}
console.log('\nAll "Nar" occurrences:', allNaron.length);
allNaron.slice(-5).forEach(n => console.log(`  pos=${n.pos}: ${n.context.slice(0,80)}`));
