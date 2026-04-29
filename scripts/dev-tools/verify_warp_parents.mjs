// Show resolved rigWarp parents for each imported part. Verifies sweep
// #16 chain-walk: face region rigWarps should parent to FaceParallaxWarp,
// neck to NeckWarp, others to BodyXWarp.
import { readFileSync } from 'node:fs';
let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}`;

const { importCmo3 } = await import('../../src/io/live2d/cmo3Import.js');

const path = process.argv[2] ?? 'shelby.cmo3';
const bytes = readFileSync(path);
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const { project } = await importCmo3(u8);

const partNameById = new Map();
for (const n of project.nodes) {
  if (n.type === 'part') partNameById.set(n.id, n.name);
}

console.log('rigWarp parent mapping:');
const counts = { FaceParallaxWarp: 0, NeckWarp: 0, BodyXWarp: 0, other: 0 };
for (const [partId, spec] of Object.entries(project.rigWarps)) {
  const partName = partNameById.get(partId) ?? '(unknown)';
  const parentId = spec.parent?.id ?? '(none)';
  console.log(`  ${spec.id.padEnd(28)} target=${partName.padEnd(20)} parent=${parentId}`);
  if (counts[parentId] !== undefined) counts[parentId]++;
  else counts.other++;
}

console.log('');
console.log(`Counts: FaceParallaxWarp=${counts.FaceParallaxWarp}  NeckWarp=${counts.NeckWarp}  BodyXWarp=${counts.BodyXWarp}  other=${counts.other}`);
