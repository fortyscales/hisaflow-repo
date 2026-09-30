const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'screens', 'DocumentsScreen.jsx'), 'utf8');
const offenders = [];
for (const match of src.matchAll(/\{[^{}]{0,1200}\}/gs)) {
  const block = match[0];
  if (/\bborder\s*:/.test(block) && /\bborder(?:Top|Right|Bottom|Left)\s*:/.test(block)) offenders.push(block);
}
if (offenders.length) {
  console.error(offenders);
  throw new Error('DocumentsScreen mixes border shorthand with border-side properties in the same style object');
}
console.log('PASS react style shorthand contract');
