// Stage 1 helper — print v3 artMesh order with chain summary.
// Maps oracle's ArtMesh0..N to v3's mesh names + chains, so we can
// pinpoint which actual mesh the divergent oracle index corresponds to.
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
const harvest = await initializeRigFromProject(result.project, new Map());
const rig = harvest.rigSpec;

// Find names from project nodes
const nodeNames = new Map();
for (const n of result.project.nodes ?? []) nodeNames.set(n.id, n.name);

console.log('## v3 artMesh order (matches oracle drawable index)');
const am = rig.artMeshes ?? [];
for (let i = 0; i < am.length; i++) {
  const m = am[i];
  const name = nodeNames.get(m.id) ?? '?';
  let chain = '';
  let cur = m.parent;
  let safety = 32;
  while (cur && cur.type !== 'root' && safety-- > 0) {
    chain += `${cur.type}/${cur.id} → `;
    const next = (rig.warpDeformers ?? []).find(w => w.id === cur.id) ?? (rig.rotationDeformers ?? []).find(r => r.id === cur.id);
    if (!next) { chain += '<missing>'; break; }
    cur = next.parent;
  }
  chain += 'root';
  const paramBindings = (m.bindings ?? []).map(b => b.parameterId).join(',') || '-';
  console.log(`  [${String(i).padStart(2)}] ${m.id}  name="${name}"  bindings=[${paramBindings}]`);
  console.log(`         chain: ${chain}`);
}
