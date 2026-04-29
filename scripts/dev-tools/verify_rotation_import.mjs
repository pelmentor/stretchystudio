// Verify sweep #15 rotation-deformer → group synthesis by inspecting the
// imported project's group nodes — boneRole assigned, pivot populated.
import { readFileSync } from 'node:fs';
let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}`;

const { importCmo3 } = await import('../../src/io/live2d/cmo3Import.js');

const path = process.argv[2] ?? 'shelby.cmo3';
const bytes = readFileSync(path);
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const { project, warnings, stats } = await importCmo3(u8);

console.log(`stats: ${JSON.stringify(stats)}`);
console.log(`canvas: ${project.canvas.width}×${project.canvas.height}`);
console.log('');
console.log('Group nodes after rotation-deformer mirroring:');
for (const n of project.nodes) {
  if (n.type !== 'group') continue;
  const role = n.boneRole ?? '(none)';
  const px = n.transform?.pivotX ?? 0;
  const py = n.transform?.pivotY ?? 0;
  console.log(`  ${n.name.padEnd(20)} boneRole=${role.padEnd(12)} pivot=(${px.toFixed(1)}, ${py.toFixed(1)})`);
}

const rotationWarnings = warnings.filter((w) => w.startsWith('rotation:'));
console.log('');
console.log(`Rotation-pass warnings: ${rotationWarnings.length}`);
for (const w of rotationWarnings) console.log(`  - ${w}`);

const rigWarpWarnings = warnings.filter((w) => w.startsWith('rigWarp:'));
console.log('');
console.log(`RigWarp-pass warnings: ${rigWarpWarnings.length}`);
for (const w of rigWarpWarnings) console.log(`  - ${w}`);
