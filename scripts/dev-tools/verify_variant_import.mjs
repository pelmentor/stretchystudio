// Verify sweep #18 variant pairing.
import { readFileSync } from 'node:fs';
let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}`;

const { importCmo3 } = await import('../../src/io/live2d/cmo3Import.js');

const path = process.argv[2] ?? 'shelby.cmo3';
const bytes = readFileSync(path);
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const { project, warnings } = await importCmo3(u8);

const partById = new Map();
for (const n of project.nodes) {
  if (n.type === 'part') partById.set(n.id, n);
}

console.log('Variant parts:');
let pairCount = 0;
for (const n of project.nodes) {
  if (n.type !== 'part') continue;
  if (!n.variantSuffix) continue;
  pairCount++;
  const base = partById.get(n.variantOf);
  console.log(`  ${n.name.padEnd(20)} variantOf=${base?.name ?? '(missing)'} suffix=${n.variantSuffix} draw_order=${n.draw_order}`);
}
console.log(`Total variants: ${pairCount}`);

const variantWarnings = warnings.filter((w) => w.startsWith('variant:'));
console.log('');
console.log(`variant-pass warnings: ${variantWarnings.length}`);
for (const w of variantWarnings) console.log(`  - ${w}`);
