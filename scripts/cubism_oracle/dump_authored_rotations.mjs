// Stage 1 helper — dump authored rotation deformers from shelby.cmo3
// (BEFORE applyRotationDeformersToGroups gates on parent=rotation).
//
// Confirms what the cmo3 actually stores for FaceRotation's pivot.
if (typeof globalThis.Blob === 'undefined') { globalThis.Blob = class { constructor() {} }; }
if (typeof globalThis.URL === 'undefined' || !globalThis.URL.createObjectURL) {
  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'stub://harness';
  globalThis.URL.revokeObjectURL = () => {};
}
import fs from 'node:fs';
import path from 'node:path';
import { extractCmo3Scene } from '../../src/io/live2d/cmo3PartExtract.js';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const bytes = fs.readFileSync(path.join(REPO_ROOT, 'shelby.cmo3'));
const scene = await extractCmo3Scene(bytes);

console.log('## authored rotation deformers in shelby.cmo3');
console.log(`   canvas: ${scene.canvasW} × ${scene.canvasH}`);
console.log(`   total deformers: ${scene.deformers.length} (${scene.deformers.filter(d => d.kind === 'rotation').length} rotation)`);
console.log();

const byGuid = new Map();
for (const d of scene.deformers) if (d.ownGuidRef) byGuid.set(d.ownGuidRef, d);

for (const def of scene.deformers) {
  if (def.kind !== 'rotation') continue;
  const parent = def.parentDeformerGuidRef ? byGuid.get(def.parentDeformerGuidRef) : null;
  const parentKind = parent ? parent.kind : '<root|warp|missing>';
  const parentName = parent ? parent.name ?? '?' : '<canvas-rooted>';
  console.log(`  rotation '${def.name ?? '?'}'  (idStr=${def.idStr})`);
  console.log(`    parent: ${parentKind}/${parentName}  (guid=${def.parentDeformerGuidRef ?? '<root>'})`);
  console.log(`    keyforms: ${def.keyforms.length}`);
  for (let i = 0; i < def.keyforms.length; i++) {
    const k = def.keyforms[i];
    console.log(`      kf${i}  angle=${(k.angle ?? 0).toFixed(3).padStart(8)}  origin=(${(k.originX ?? 0).toFixed(4).padStart(10)}, ${(k.originY ?? 0).toFixed(4).padStart(10)})`);
  }
  console.log();
}
