const PizZip = require('pizzip');
const { readFileSync, writeFileSync } = require('fs');

// Analyze P-0582-18 to understand the plan table structure
const buf = readFileSync('resources/templates/P-0582-18 conv.docx', 'binary');
const zip = new PizZip(buf);
const docXml = zip.file('word/document.xml').asText();

// Find all tables
const tables = [];
const tblRe = /<w:tbl>[\s\S]*?<\/w:tbl>/g;
let m;
while ((m = tblRe.exec(docXml)) !== null) tables.push({ xml: m[0], offset: m.index });
console.log(`Found ${tables.length} tables`);

// Find the main plan table (the big one)
tables.forEach((t, i) => {
  const text = t.xml.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log(`\nTable ${i+1} (${t.xml.length} chars): ${text.slice(0,200)}`);
});

// Find TOTAL (IVA no incluido) in document body
const totalIdx = docXml.indexOf('TOTAL');
if (totalIdx >= 0) {
  const snippet = docXml.slice(Math.max(0, totalIdx - 300), totalIdx + 800);
  const text = snippet.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
  console.log('\n\nTOTAL area text:', text.slice(0, 500));
}

// Check footers in P-0582-18
const footer1 = zip.file('word/footer1.xml').asText();
const footer2 = zip.file('word/footer2.xml').asText();
console.log('\nFooter1:', footer1.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 300));
console.log('Footer2:', footer2.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0, 300));

// Find "Narón (A Coruña), a" - the date area at the end
const lastNaron = docXml.lastIndexOf('Nar');
const endDoc = docXml.slice(Math.max(0, lastNaron - 200), lastNaron + 600);
console.log('\nEnd of document (date + signature):', 
  endDoc.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,400));
