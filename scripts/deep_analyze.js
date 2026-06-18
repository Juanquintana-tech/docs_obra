const PizZip = require('pizzip');
const { readFileSync } = require('fs');

function analyzeDoc(path, label) {
  const buf = readFileSync(path, 'binary');
  const zip = new PizZip(buf);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`=== ${label} ===`);

  // List all files in the ZIP
  console.log('\nFiles in ZIP:');
  Object.keys(zip.files).filter(f => !f.endsWith('/') && f.includes('word/')).forEach(f => {
    const size = zip.file(f) ? zip.file(f).asText().length : 0;
    if (size > 0) console.log(`  ${f} (${size} chars)`);
  });

  // Check header.xml for variable content
  const header1 = zip.file('word/header1.xml');
  const header2 = zip.file('word/header2.xml');
  const header3 = zip.file('word/header3.xml');
  const footer1 = zip.file('word/footer1.xml');
  const footer2 = zip.file('word/footer2.xml');

  [header1, header2, header3, footer1, footer2].filter(Boolean).forEach((f, i) => {
    const text = f.asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) console.log(`\nHeader/Footer ${i+1}: ${text.slice(0, 300)}`);
  });

  // Check document body - look for cover page data (first 5000 chars of XML)
  const docXml = zip.file('word/document.xml').asText();
  
  // Find paragraphs before the index
  const indiceIdx = docXml.indexOf('I N D I C E');
  if (indiceIdx >= 0) {
    const coverXml = docXml.slice(0, indiceIdx);
    const coverText = coverXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('\nContent BEFORE the index:');
    console.log(coverText.slice(0, 1000));
  }

  // Look for the date line "Narón"
  const naronIdx = docXml.lastIndexOf('Nar');
  if (naronIdx >= 0) {
    const dateXml = docXml.slice(Math.max(0, naronIdx - 100), naronIdx + 500);
    const dateText = dateXml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    console.log('\nDate/signature area:');
    console.log(dateText);
  }
}

analyzeDoc('resources/templates/P-xxx.yy - MODELO PRESUPUESTO conv.docx', 'MODELO');
analyzeDoc('resources/templates/P-0582-18 conv.docx', 'P-0582-18');
