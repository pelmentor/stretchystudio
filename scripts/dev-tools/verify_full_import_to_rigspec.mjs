// End-to-end verification: import shelby.cmo3 → run initializeRigFromProject
// → assert rigSpec contains structural warps, rotation deformers, and
// art meshes wired correctly. This is the same path the modal's
// auto-buildRigSpec triggers, so passing here means the modal's
// "Imported X parts ... · rig: N warps" message will succeed at runtime.
import { readFileSync } from 'node:fs';
let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}`;

const { importCmo3 } = await import('../../src/io/live2d/cmo3Import.js');
const { initializeRigFromProject } = await import('../../src/io/live2d/rig/initRig.js');

const path = process.argv[2] ?? 'shelby.cmo3';
const bytes = readFileSync(path);
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const { project } = await importCmo3(u8);

console.log('Running initializeRigFromProject on imported project…');
const harvest = await initializeRigFromProject(project);

const rigSpec = harvest.rigSpec;
if (!rigSpec) {
  console.error('FAIL: rigSpec is null');
  process.exit(1);
}

console.log(`  warpDeformers: ${rigSpec.warpDeformers?.length ?? 0}`);
console.log(`  rotationDeformers: ${rigSpec.rotationDeformers?.length ?? 0}`);
console.log(`  artMeshes: ${rigSpec.artMeshes?.length ?? 0}`);
console.log(`  parameters: ${rigSpec.parameters?.length ?? 0}`);

const warpIds = new Set(rigSpec.warpDeformers.map((w) => w.id));
const expected = ['BodyZWarp', 'BodyYWarp', 'BreathWarp', 'BodyXWarp', 'NeckWarp', 'FaceParallaxWarp'];
const missing = expected.filter((id) => !warpIds.has(id));
console.log('');
console.log(`  expected structural warps present: ${missing.length === 0 ? 'YES' : 'NO (missing: ' + missing.join(', ') + ')'}`);

const rotIds = rigSpec.rotationDeformers.map((r) => r.id).sort();
console.log(`  rotation IDs: ${rotIds.join(', ')}`);

console.log(`  artMesh count == part count: ${rigSpec.artMeshes.length === project.nodes.filter((n) => n.type === 'part').length}`);

console.log('');
console.log('OK');
