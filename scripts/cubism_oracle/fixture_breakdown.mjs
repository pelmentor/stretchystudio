// Stage 1 helper — print PARAM divergence for ALL drawables at a chosen
// fixture (oracle harness clips to top-5). Used to confirm whether the
// 9.45 px BUG-003 signal at AngleZ_pos30 is concentrated on eye meshes
// (a known harness-limitation artifact) or distributed across the rig.
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
import { evalRig } from '../../src/io/live2d/runtime/evaluator/chainEval.js';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const SNAPSHOTS_DIR = path.join(REPO_ROOT, 'scripts/cubism_oracle/snapshots/shelby_runtime');
const FIXTURE = process.argv[2] ?? 'AngleZ_pos30';

function findFixturePath(name) {
  const files = fs.readdirSync(SNAPSHOTS_DIR);
  const match = files.find(f => f === `${name}.json` || f.startsWith(`${name}__`));
  return match ? path.join(SNAPSHOTS_DIR, match) : null;
}

async function main() {
  const bytes = fs.readFileSync(path.join(REPO_ROOT, 'shelby.cmo3'));
  const result = await importCmo3(bytes);
  const harvest = await initializeRigFromProject(result.project, new Map());
  const rig = harvest.rigSpec;
  const nodeNames = new Map();
  for (const n of result.project.nodes ?? []) nodeNames.set(n.id, n.name);

  // Rest baseline
  const restPath = findFixturePath('default');
  const rest = JSON.parse(fs.readFileSync(restPath, 'utf8'));
  const restPpu = rest.canvas_info?.pixels_per_unit ?? 1;
  const restHalfW = (rest.canvas_info?.size?.[0] ?? 0) / 2;
  const restHalfH = (rest.canvas_info?.size?.[1] ?? 0) / 2;
  const restFrames = evalRig(rig, {});
  const restDelta = new Map();
  for (let i = 0; i < rest.drawables.length; i++) {
    const od = rest.drawables[i];
    const v3 = restFrames[i];
    if (!v3 || v3.vertexPositions.length !== od.vertex_count * 2) continue;
    const delta = new Float64Array(od.vertex_count * 2);
    for (let v = 0; v < od.vertex_count; v++) {
      const ox = od.vertices[v * 2] * restPpu + restHalfW;
      const oy = -od.vertices[v * 2 + 1] * restPpu + restHalfH;
      delta[v * 2] = v3.vertexPositions[v * 2] - ox;
      delta[v * 2 + 1] = v3.vertexPositions[v * 2 + 1] - oy;
    }
    restDelta.set(i, delta);
  }

  // Fixture
  const fpath = findFixturePath(FIXTURE);
  if (!fpath) { console.error(`fixture '${FIXTURE}' not found`); process.exit(1); }
  const oracle = JSON.parse(fs.readFileSync(fpath, 'utf8'));
  const ppu = oracle.canvas_info?.pixels_per_unit ?? 1;
  const halfW = (oracle.canvas_info?.size?.[0] ?? 0) / 2;
  const halfH = (oracle.canvas_info?.size?.[1] ?? 0) / 2;
  const frames = evalRig(rig, oracle.applied_parameters ?? {});

  console.log(`# fixture: ${FIXTURE}  params: ${JSON.stringify(oracle.applied_parameters)}`);
  console.log(`# all drawables, sorted by param_max desc:`);
  const rows = [];
  for (let i = 0; i < oracle.drawables.length; i++) {
    const od = oracle.drawables[i];
    const v3 = frames[i];
    const am = rig.artMeshes?.[i];
    const name = am ? (nodeNames.get(am.id) ?? '?') : '?';
    if (!v3 || v3.vertexPositions.length !== od.vertex_count * 2) {
      rows.push({ idx: i, name, paramMax: NaN, paramMean: NaN, status: 'skip' });
      continue;
    }
    const rd = restDelta.get(i);
    let pmax = 0, psum = 0;
    for (let v = 0; v < od.vertex_count; v++) {
      const ox = od.vertices[v * 2] * ppu + halfW;
      const oy = -od.vertices[v * 2 + 1] * ppu + halfH;
      const dx = v3.vertexPositions[v * 2] - ox;
      const dy = v3.vertexPositions[v * 2 + 1] - oy;
      const pdx = rd ? dx - rd[v * 2] : dx;
      const pdy = rd ? dy - rd[v * 2 + 1] : dy;
      const pd = Math.hypot(pdx, pdy);
      if (pd > pmax) pmax = pd;
      psum += pd;
    }
    rows.push({ idx: i, name, paramMax: pmax, paramMean: psum / od.vertex_count });
  }
  rows.sort((a, b) => (b.paramMax ?? 0) - (a.paramMax ?? 0));
  for (const r of rows) {
    if (r.status === 'skip') {
      console.log(`  [${String(r.idx).padStart(2)}] ${r.name.padEnd(20)} <skip>`);
    } else {
      console.log(`  [${String(r.idx).padStart(2)}] ${r.name.padEnd(20)} param_max=${r.paramMax.toFixed(2).padStart(7)}  param_mean=${r.paramMean.toFixed(2).padStart(7)}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
