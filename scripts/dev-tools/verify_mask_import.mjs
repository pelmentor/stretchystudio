// Verify sweep #17 maskConfigs synthesis from cmo3 clipGuidList.
import { readFileSync } from 'node:fs';
let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}`;

const { importCmo3 } = await import('../../src/io/live2d/cmo3Import.js');

const path = process.argv[2] ?? 'shelby.cmo3';
const bytes = readFileSync(path);
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const { project, warnings } = await importCmo3(u8);

const partNameById = new Map();
for (const n of project.nodes) {
  if (n.type === 'part') partNameById.set(n.id, n.name);
}

console.log(`maskConfigs: ${project.maskConfigs.length} entries`);
for (const cfg of project.maskConfigs) {
  const masked = partNameById.get(cfg.maskedMeshId) ?? '(unknown)';
  const masks = cfg.maskMeshIds.map((id) => partNameById.get(id) ?? '(unknown)');
  console.log(`  ${masked.padEnd(20)} ← masked by [${masks.join(', ')}]`);
}

const maskWarnings = warnings.filter((w) => w.startsWith('mask:'));
console.log('');
console.log(`mask-pass warnings: ${maskWarnings.length}`);
for (const w of maskWarnings) console.log(`  - ${w}`);
