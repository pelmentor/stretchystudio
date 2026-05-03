// Verify the GAP-008 subsystem opt-out works on the authored cmo3 path.
// Sets hairRig=false on shelby's project, runs init rig, dumps the
// resulting rigSpec to confirm hair-related rigWarps were dropped and
// hair art meshes reparent upward.
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
const bytes = fs.readFileSync(path.join(REPO_ROOT, 'shelby.cmo3'));
const result = await importCmo3(bytes);
const project = result.project;

// Disable hairRig + clothingRig + eyeRig.
project.autoRigConfig = {
  ...(project.autoRigConfig ?? {}),
  subsystems: {
    faceRig: true, eyeRig: false, mouthRig: true,
    hairRig: false, clothingRig: false, bodyWarps: true, armPhysics: true,
  },
};

const harvest = await initializeRigFromProject(project, new Map());
const rig = harvest.rigSpec;

console.log();
console.log('## After opt-out: rigSpec.warpDeformers =');
for (const w of rig.warpDeformers) {
  console.log(`  ${w.id.padEnd(28)} parent=${w.parent.type}/${w.parent.id ?? '<root>'}`);
}
console.log();
console.log('## After opt-out: artMeshes parent links =');
for (const m of rig.artMeshes) {
  console.log(`  ${m.name.padEnd(20)} parent=${m.parent.type}/${m.parent.id ?? '<root>'}`);
}
