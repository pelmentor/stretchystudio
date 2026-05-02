// Stage 1 helper — list every spec that binds to a given parameter.
if (typeof globalThis.Blob === 'undefined') { globalThis.Blob = class { constructor() {} }; }
if (typeof globalThis.URL === 'undefined' || !globalThis.URL.createObjectURL) {
  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'stub://harness';
  globalThis.URL.revokeObjectURL = () => {};
}
import fs from 'node:fs';
import path from 'node:path';
import { importCmo3 } from '../../src/io/live2d/cmo3Import.js';
import { initializeRigFromProject } from '../../src/io/live2d/rig/initRig.js';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const TARGET_PARAM = process.argv[2] ?? 'ParamAngleZ';

const bytes = fs.readFileSync(path.join(REPO_ROOT, 'shelby.cmo3'));
const result = await importCmo3(bytes);
const harvest = await initializeRigFromProject(result.project, new Map());
const rig = harvest.rigSpec;

console.log(`## what does ${TARGET_PARAM} drive in shelby?`);
const findUses = (specs, kind) => {
  for (const s of specs ?? []) {
    const uses = (s.bindings ?? []).some(b => b.parameterId === TARGET_PARAM);
    if (uses) {
      const params = (s.bindings ?? []).map(b => b.parameterId).join(',');
      console.log(`  ${kind.padEnd(5)} ${s.id.padEnd(40)}  bindings=[${params}]  parent=${s.parent?.type ?? '?'}/${s.parent?.id ?? '<root>'}`);
    }
  }
};
findUses(rig.warpDeformers, 'warp');
findUses(rig.rotationDeformers, 'rot');
findUses(rig.artMeshes, 'mesh');
