// Sanity-check the .cmo3 → SS project synthesiser. Polyfills the small
// subset of browser APIs the import path touches (Blob is in Node 18+,
// URL.createObjectURL is not — we stub it to a deterministic string so
// the project shape can be inspected without a real renderer).
//
// Usage: node scripts/dev-tools/verify_cmo3_import.mjs <file.cmo3>

import { readFileSync } from 'node:fs';

let blobCounter = 0;
globalThis.URL.createObjectURL = (blob) => `blob:mock-${++blobCounter}-${blob.size}b`;

const { importCmo3 } = await import('../../src/io/live2d/cmo3Import.js');

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/dev-tools/verify_cmo3_import.mjs <cmo3>');
  process.exit(2);
}

const bytes = readFileSync(path);
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);

const { project, warnings, stats } = await importCmo3(u8);

console.log(`[importCmo3] stats: ${JSON.stringify(stats)}`);
console.log(`[importCmo3] canvas: ${project.canvas.width} × ${project.canvas.height}`);
console.log(`[importCmo3] schemaVersion: ${project.schemaVersion}`);
console.log(`[importCmo3] textures: ${project.textures.length}`);
console.log(`[importCmo3] nodes: ${project.nodes.length}`);
console.log(`[importCmo3] parameters: ${project.parameters.length}`);

const groups = project.nodes.filter((n) => n.type === 'group');
const parts = project.nodes.filter((n) => n.type === 'part');
console.log('');
console.log(`[shape] groups=${groups.length} parts=${parts.length}`);
console.log('');
console.log('[group hierarchy]');
const byId = new Map(project.nodes.map((n) => [n.id, n]));
for (const g of groups) {
  const parentName = g.parent ? (byId.get(g.parent)?.name ?? '(missing)') : '(root)';
  console.log(`  ${g.name.padEnd(20)} parent=${parentName}`);
}
console.log('');
console.log('[first 6 parts]');
for (const p of parts.slice(0, 6)) {
  const verts = p.mesh.vertices.length;
  const tris = p.mesh.triangles.length;
  const parentName = p.parent ? (byId.get(p.parent)?.name ?? '(missing)') : '(root)';
  const tex = project.textures.find((t) => t.id === p.id);
  console.log(`  ${p.name.padEnd(20)} verts=${String(verts).padStart(3)}  tris=${String(tris).padStart(3)}  parent=${parentName}  texture=${tex ? 'yes' : 'no'}`);
  // Sanity: vertices have {x,y,restX,restY}
  const v0 = p.mesh.vertices[0];
  if (typeof v0?.x !== 'number' || typeof v0?.restY !== 'number') {
    console.error(`    !! vertex 0 has wrong shape: ${JSON.stringify(v0)}`);
  }
  // Sanity: triangles are triplets
  if (!Array.isArray(p.mesh.triangles[0]) || p.mesh.triangles[0].length !== 3) {
    console.error(`    !! triangle 0 wrong shape: ${JSON.stringify(p.mesh.triangles[0])}`);
  }
}
console.log('');
console.log('[parameters]');
for (const param of project.parameters.slice(0, 6)) {
  console.log(`  ${param.id.padEnd(18)} role=${param.role.padEnd(10)} [${param.min}..${param.max}] default=${param.default}`);
}

const rigWarpEntries = Object.entries(project.rigWarps);
if (rigWarpEntries.length > 0) {
  console.log('');
  console.log(`[rigWarps] ${rigWarpEntries.length} entries`);
  const [firstId, firstSpec] = rigWarpEntries[0];
  const part = parts.find((p) => p.id === firstId);
  console.log(`  sample: ${firstSpec.id} → ${part?.name ?? '(missing)'}`);
  console.log(`    gridSize=${firstSpec.gridSize.cols}×${firstSpec.gridSize.rows}  keyforms=${firstSpec.keyforms.length}  bindings=${firstSpec.bindings.length}`);
  console.log(`    canvasBbox=${JSON.stringify(firstSpec.canvasBbox)}`);
  for (const b of firstSpec.bindings) {
    console.log(`    binding: ${b.parameterId} keys=[${b.keys.join(', ')}]`);
  }
  console.log(`    keyform[0] keyTuple=[${firstSpec.keyforms[0].keyTuple.join(', ')}]`);
}

if (warnings.length > 0) {
  console.log('');
  console.log('[warnings]');
  for (const w of warnings.slice(0, 8)) console.log(`  - ${w}`);
}
