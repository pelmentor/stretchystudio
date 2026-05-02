// Stage 1 — recover the FaceRotation pivot offset between v3 and Cubism.
//
// Observed: at AngleZ=30 the eyebrow-r/eyebrow-l/front-hair meshes have
// uniform PARAM divergence ~6.18 px (max ≈ mean). Pure rigid shift =
// signature of a pivot offset between v3 and Cubism's FaceRotation.
//
// Math: vert_after_rot - vert_before_rot = (R - I)(vert_before - pivot)
//   so v3_dev_at_30 - v3_dev_at_0 = (R - I)(vert_0 - P_v3)
//      cub_dev_at_30 - cub_dev_at_0 = (R - I)(vert_0 - P_cub)
// Subtracting: (v3 - cub) at 30 vs 0 = (R - I)(P_cub - P_v3)
//   thus  P_cub - P_v3 = (R - I)⁻¹ · param_delta_vector
//
// Inverts (R - I) using small-angle determinant (R(30°) - I has det 0.5).
// Reports the implied pivot offset in canvas-px for each face mesh.

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

function findFix(name) {
  const f = fs.readdirSync(SNAPSHOTS_DIR).find(n => n === `${name}.json` || n.startsWith(`${name}__`));
  return f ? path.join(SNAPSHOTS_DIR, f) : null;
}

const ANGLE_DEG = 30;
const rad = (ANGLE_DEG * Math.PI) / 180;
const cs = Math.cos(rad);
const sn = Math.sin(rad);
// Cubism's rotation convention is +Z = clockwise in screen space (Y down).
// For our diff math the sign doesn't matter as long as we use the same
// (R - I) consistently — but we test BOTH signs and pick the one that
// gives a small consistent pivot-offset across meshes.
function makeRminI(sign) {
  const sn_ = sign * sn;
  return {
    a: cs - 1, b: -sn_,
    c: sn_,    d: cs - 1,
  };
}
function inv2x2(M) {
  const det = M.a * M.d - M.b * M.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-30) return null;
  const inv = 1 / det;
  return { a: M.d * inv, b: -M.b * inv, c: -M.c * inv, d: M.a * inv };
}
function apply(M, x, y) { return [M.a * x + M.b * y, M.c * x + M.d * y]; }

const bytes = fs.readFileSync(path.join(REPO_ROOT, 'shelby.cmo3'));
const result = await importCmo3(bytes);
const harvest = await initializeRigFromProject(result.project, new Map());
const rig = harvest.rigSpec;
const nodeNames = new Map();
for (const n of result.project.nodes ?? []) nodeNames.set(n.id, n.name);

const restPath = findFix('default');
const angleZPath = findFix('AngleZ_pos30');
const rest = JSON.parse(fs.readFileSync(restPath, 'utf8'));
const angleZ = JSON.parse(fs.readFileSync(angleZPath, 'utf8'));
const ppu = rest.canvas_info?.pixels_per_unit ?? 1;
const halfW = (rest.canvas_info?.size?.[0] ?? 0) / 2;
const halfH = (rest.canvas_info?.size?.[1] ?? 0) / 2;

const restFrames = evalRig(rig, {});
const angleZFrames = evalRig(rig, angleZ.applied_parameters ?? {});

console.log(`# implied FaceRotation pivot offset P_cub - P_v3 (canvas-px) at ParamAngleZ=${ANGLE_DEG}`);
for (const [signLabel, sign] of [['+sign', 1], ['-sign', -1]]) {
  const RminI = makeRminI(sign);
  const inv = inv2x2(RminI);
  console.log();
  console.log(`## ${signLabel}  (R - I) = [${RminI.a.toFixed(4)} ${RminI.b.toFixed(4)}; ${RminI.c.toFixed(4)} ${RminI.d.toFixed(4)}]`);

  // Just the face-rotated rigid-shift meshes (no eye-closure parabola).
  const FACE_MESHES_BY_NAME = ['eyebrow-l', 'eyebrow-r', 'front hair'];
  for (let i = 0; i < (rig.artMeshes ?? []).length; i++) {
    const am = rig.artMeshes[i];
    const name = nodeNames.get(am.id) ?? '?';
    if (!FACE_MESHES_BY_NAME.includes(name)) continue;
    const od_rest = rest.drawables[i];
    const od_30 = angleZ.drawables[i];
    const v3_rest = restFrames[i];
    const v3_30 = angleZFrames[i];
    if (!od_rest || !od_30 || !v3_rest || !v3_30) continue;
    if (od_rest.vertex_count !== v3_rest.vertexPositions.length / 2) continue;
    // For 4 representative verts (start, 1/4, 1/2, 3/4), compute
    //   ParamDelta = (v3_30 - cub_30) - (v3_rest - cub_rest)
    //   PivotOffset = (R-I)⁻¹ · ParamDelta
    const N = od_rest.vertex_count;
    const indices = [0, Math.floor(N/4), Math.floor(N/2), Math.floor(3*N/4)];
    const offsets = [];
    for (const v of indices) {
      const ox_r = od_rest.vertices[v * 2] * ppu + halfW;
      const oy_r = -od_rest.vertices[v * 2 + 1] * ppu + halfH;
      const ox_30 = od_30.vertices[v * 2] * ppu + halfW;
      const oy_30 = -od_30.vertices[v * 2 + 1] * ppu + halfH;
      const v3_rx = v3_rest.vertexPositions[v * 2];
      const v3_ry = v3_rest.vertexPositions[v * 2 + 1];
      const v3_30x = v3_30.vertexPositions[v * 2];
      const v3_30y = v3_30.vertexPositions[v * 2 + 1];
      const dx_30 = v3_30x - ox_30, dy_30 = v3_30y - oy_30;
      const dx_r  = v3_rx  - ox_r,  dy_r  = v3_ry  - oy_r;
      const pdx = dx_30 - dx_r;
      const pdy = dy_30 - dy_r;
      const [offX, offY] = apply(inv, pdx, pdy);
      offsets.push({ v, pdx, pdy, offX, offY });
    }
    console.log(`  ${name}  (vertex 0/${Math.floor(N/4)}/${Math.floor(N/2)}/${Math.floor(3*N/4)} of ${N})`);
    for (const o of offsets) {
      console.log(`    v${String(o.v).padStart(2)}  param_delta=(${o.pdx.toFixed(2).padStart(6)}, ${o.pdy.toFixed(2).padStart(6)})  ⇒  P_cub-P_v3 = (${o.offX.toFixed(2).padStart(6)}, ${o.offY.toFixed(2).padStart(6)})`);
    }
  }
}
