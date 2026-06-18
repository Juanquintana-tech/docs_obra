const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

function extractRuns(path) {
  const buf = readFileSync(path, 'binary');
  const zip = new PizZip(buf);
  const xml = zip.file('word/document.xml').asText();
  const wt = [];
  const re = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const t = m[1].trim();
    if (t) wt.push(t);
  }
  return wt;
}

const modeloRuns = extractRuns('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx');
const ejemploRuns = extractRuns('resources/templates/P-0582-18 conv.docx');

console.log('=== MODELO TEXT RUNS ===');
console.log(modeloRuns.join('\n'));
console.log('\n\n=== EJEMPLO P-0582-18 (first 300 runs) ===');
console.log(ejemploRuns.slice(0, 300).join('\n'));
