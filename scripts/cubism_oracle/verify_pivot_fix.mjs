#!/usr/bin/env node
// Stage 1 final validation — DISPROOF artifact.
//
// HYPOTHESIS TESTED: patch v3 rigSpec's FaceRotation `originX/Y` to the
// authored Cubism value computed from the cmo3 chain → AngleZ_pos30 PARAM
// drops to ~0 on eyebrow-l/eyebrow-r/front-hair.
//
// RESULT: PARAM **unchanged**. The patch shifts both v3@rest and v3@30
// output by the same constant (+7, +34.7) px, which the harness's
// rest-delta subtraction cancels out. The geometric reason: the rotation
// matrix is `out = R·in + origin`, which means `origin` is ALWAYS a pure
// translation — it adds the same vector regardless of angle. The PARAM
// signal `(R-I)·(in_v3 - in_oracle)` doesn't see `origin` at all.
//
// REAL ROOT CAUSE (revised): the PARAM signature `(R-I)·c = (-6.13, 0.69)`
// resolves to `c = (in_v3 - in_oracle) ≈ (-0.88, -35.4)` — a constant
// vertex offset of ~35 px in Y at FaceRotation's INPUT. That input comes
// from FaceParallaxWarp's lifted output, which v3 builds heuristically
// (cmo3writer.js facePivot + radius/protected regions) and which differs
// from Cubism's authored FaceParallaxWarp grid. So the BUG-003 9.45 px
// PARAM signal at AngleZ_pos30 is from the *heuristic-vs-authored gap of
// FaceParallaxWarp* (and possibly other chain ancestors), not from a
// localised FaceRotation pivot mismatch.
//
// IMPLICATION: there is no single-deformer fix. Closing the harness PARAM
// signal requires v3's `initializeRigFromProject` to consume authored
// cmo3 deformer data instead of regenerating heuristically. That's a
// substantial feature rebuild touching cmo3Import → initRig → cmo3writer's
// heuristic path. PHASE_2B_PLAN.md's chainEval-level approach was already
// invalidated by Stage 1 measurement; this script demonstrates that the
// natural follow-up ("just patch the pivot") doesn't work either.

if (typeof globalThis.Blob === 'undefined') { globalThis.Blob = class { constructor() {} }; }
if (typeof globalThis.URL === 'undefined' || !globalThis.URL.createObjectURL) {
  if (!globalThis.URL) globalThis.URL = {};
  globalThis.URL.createObjectURL = () => 'stub://harness';
  globalThis.URL.revokeObjectURL = () => {};
}

import fs from 'node:fs';
import path from 'node:path';
import { unpackCaff } from '../../src/io/live2d/caffUnpacker.js';
import { parseCmo3Xml } from '../../src/io/live2d/cmo3XmlParser.js';
import { extractScene } from '../../src/io/live2d/cmo3PartExtract.js';
import { importCmo3 } from '../../src/io/live2d/cmo3Import.js';
import { initializeRigFromProject } from '../../src/io/live2d/rig/initRig.js';
import { evalRig, DeformerStateCache } from '../../src/io/live2d/runtime/evaluator/chainEval.js';
import { evalWarpKernelCubism } from '../../src/io/live2d/runtime/evaluator/cubismWarpEval.js';

const REPO_ROOT = path.resolve(new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const SNAPSHOTS_DIR = path.join(REPO_ROOT, 'scripts/cubism_oracle/snapshots/shelby_runtime');

function findFix(name) {
  const f = fs.readdirSync(SNAPSHOTS_DIR).find(n => n === `${name}.json` || n.startsWith(`${name}__`));
  return f ? path.join(SNAPSHOTS_DIR, f) : null;
}

const bytes = fs.readFileSync(path.join(REPO_ROOT, 'shelby.cmo3'));

// ── Extract authored cmo3 scene to find Rotation_head + FaceRotation origins ──
const u8 = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const archive = await unpackCaff(u8);
const xml = new TextDecoder().decode(archive.files.find((f) => f.path === 'main.xml').content);
const parsed = parseCmo3Xml(xml);
const scene = extractScene(parsed);

const byOwnGuid = new Map();
for (const d of scene.deformers) if (d.ownGuidRef) byOwnGuid.set(d.ownGuidRef, d);

const faceRotAuth = scene.deformers.find(d => d.kind === 'rotation' && d.idStr === 'FaceRotation');
if (!faceRotAuth) { console.error('no authored FaceRotation in cmo3'); process.exit(1); }
const rotHeadAuth = byOwnGuid.get(faceRotAuth.parentDeformerGuidRef);
if (!rotHeadAuth) { console.error('no authored Rotation_head'); process.exit(1); }

console.log('[authored] FaceRotation.parent =', rotHeadAuth.idStr);
console.log('[authored] Rotation_head.origin =', rotHeadAuth.keyforms[0].originX, rotHeadAuth.keyforms[0].originY);
console.log('[authored] Rotation_head.parent.guid =', rotHeadAuth.parentDeformerGuidRef);
const headParent = rotHeadAuth.parentDeformerGuidRef ? byOwnGuid.get(rotHeadAuth.parentDeformerGuidRef) : null;
console.log('[authored] Rotation_head.parent.kind =', headParent?.kind, 'name=', headParent?.name);
console.log('[authored] FaceRotation.origin =', faceRotAuth.keyforms[0].originX, faceRotAuth.keyforms[0].originY);

// ── Build standard project + heuristic rigSpec ──
const result = await importCmo3(bytes);
const project = result.project;
const harvest = await initializeRigFromProject(project, new Map());
const rig = harvest.rigSpec;

// ── Find v3's FaceRotation + its parent rotation in the rigSpec ──
const v3FaceRot = rig.rotationDeformers.find(r => r.id === 'FaceRotation');
if (!v3FaceRot) { console.error('no v3 FaceRotation'); process.exit(1); }
const v3GroupRot = rig.rotationDeformers.find(r => r.id === v3FaceRot.parent.id);

console.log();
console.log('[v3]      FaceRotation.parent =', v3FaceRot.parent.type, '/', v3FaceRot.parent.id);
console.log('[v3]      v3 GroupRotation.parent =', v3GroupRot?.parent.type, '/', v3GroupRot?.parent.id);

// Build rest-pose cache + compute v3's GroupRotation canvas pivot.
const cache = new DeformerStateCache(rig, {});
// v3 GroupRotation's canvas pivot: bilerp v3 BodyXWarp's lifted-grid at v3 GroupRotation's authored 0..1.
// Easier path: GroupRotation's matrix translation IS its canvas pivot expressed in BodyXWarp's 0..1 frame
// (since BodyXWarp = parent). Convert via canvas-px BodyXWarp lifted bbox.
const v3GrState = cache.getState(v3GroupRot);
console.log('[v3]      v3 GroupRotation.mat translation (BodyX 0..1) =', v3GrState.mat[2], v3GrState.mat[5]);

// Use evalChainAtPoint on the v3 GroupRotation's parent (warp) at the v3 origin to get canvas-px.
const v3GroupCanvasPivot = cache.evalChainAtPoint(v3GroupRot.parent, v3GrState.mat[2], v3GrState.mat[5]);
console.log('[v3]      v3 GroupRotation canvas pivot =', v3GroupCanvasPivot[0].toFixed(2), v3GroupCanvasPivot[1].toFixed(2));

// v3 FaceRotation's existing canvas pivot.
const v3FrState = cache.getState(v3FaceRot);
const v3FaceCanvasPivot = [v3GroupCanvasPivot[0] + v3FrState.mat[2], v3GroupCanvasPivot[1] + v3FrState.mat[5]];
console.log('[v3]      v3 FaceRotation canvas pivot   =', v3FaceCanvasPivot[0].toFixed(2), v3FaceCanvasPivot[1].toFixed(2));

// ── Compute AUTHORED FaceRotation canvas pivot ──
// Authored Rotation_head.origin is in 0..1 of its parent warp's bbox (NOT canvas-fraction
// per the existing rotationDeformerSynth.js comment, which is wrong for warp-parented case).
// Use v3 BodyXWarp's lifted grid as the proxy (matches authored for shelby).
const authoredHeadOriginX = rotHeadAuth.keyforms[0].originX;
const authoredHeadOriginY = rotHeadAuth.keyforms[0].originY;
// v3 BodyXWarp = the warp parent of v3 GroupRotation
const v3BodyXWarp = rig.warpDeformers.find(w => w.id === v3GroupRot.parent.id);
const headParentRef = { type: 'warp', id: v3BodyXWarp.id };
const authoredHeadCanvasPivot = cache.evalChainAtPoint(headParentRef, authoredHeadOriginX, authoredHeadOriginY);
console.log('[authored] Rotation_head canvas pivot   =', authoredHeadCanvasPivot[0].toFixed(2), authoredHeadCanvasPivot[1].toFixed(2));

const authoredFaceCanvasPivot = [
  authoredHeadCanvasPivot[0] + faceRotAuth.keyforms[0].originX,
  authoredHeadCanvasPivot[1] + faceRotAuth.keyforms[0].originY,
];
console.log('[authored] FaceRotation canvas pivot    =', authoredFaceCanvasPivot[0].toFixed(2), authoredFaceCanvasPivot[1].toFixed(2));

const offset = [authoredFaceCanvasPivot[0] - v3FaceCanvasPivot[0], authoredFaceCanvasPivot[1] - v3FaceCanvasPivot[1]];
console.log('[diff]    authored - v3 FaceRotation pivot =', offset[0].toFixed(2), offset[1].toFixed(2),
            ' (magnitude', Math.hypot(offset[0], offset[1]).toFixed(2), 'px)');

// ── Patch the rigSpec's FaceRotation in-place ──
// FaceRotation's origin is stored as pivot-relative-canvas-px from v3 GroupRotation.
// New origin = authored FaceRotation canvas pivot - v3 GroupRotation canvas pivot.
const newOriginX = authoredFaceCanvasPivot[0] - v3GroupCanvasPivot[0];
const newOriginY = authoredFaceCanvasPivot[1] - v3GroupCanvasPivot[1];
console.log('[patch]   new FaceRotation.origin =', newOriginX.toFixed(2), newOriginY.toFixed(2),
            ' (was', v3FaceRot.keyforms[0].originX.toFixed(2), v3FaceRot.keyforms[0].originY.toFixed(2), ')');

for (const kf of v3FaceRot.keyforms) {
  kf.originX = newOriginX;
  kf.originY = newOriginY;
}

// Sanity: confirm the patch persisted on the rigSpec the harness will see.
console.log('[sanity]  rig.rotationDeformers FaceRotation kf[0]:',
  rig.rotationDeformers.find(r => r.id === 'FaceRotation').keyforms[0].originX.toFixed(2),
  rig.rotationDeformers.find(r => r.id === 'FaceRotation').keyforms[0].originY.toFixed(2));
console.log('[sanity]  Object.isFrozen on keyform?',
  Object.isFrozen(rig.rotationDeformers.find(r => r.id === 'FaceRotation').keyforms[0]));
console.log('[sanity]  count of rotationDeformers with id=FaceRotation:',
  rig.rotationDeformers.filter(r => r.id === 'FaceRotation').length);
console.log('[sanity]  irides-l artmesh chain parent:', rig.artMeshes[0].parent);
const irL = rig.artMeshes[0];
let curParent = irL.parent;
let chain = [];
let safety = 32;
while (curParent && curParent.type !== 'root' && safety-- > 0) {
  chain.push(`${curParent.type}/${curParent.id}`);
  const next = rig.warpDeformers.find(w => w.id === curParent.id) ?? rig.rotationDeformers.find(r => r.id === curParent.id);
  if (!next) break;
  curParent = next.parent;
}
console.log('[sanity]  irides-l chain:', chain.join(' → '));

// ── Re-run oracle diff for AngleZ_pos30 with the patched rigSpec ──
const restPath = findFix('default');
const angleZPath = findFix('AngleZ_pos30');
const rest = JSON.parse(fs.readFileSync(restPath, 'utf8'));
const angleZ = JSON.parse(fs.readFileSync(angleZPath, 'utf8'));
const ppu = rest.canvas_info?.pixels_per_unit ?? 1;
const halfW = (rest.canvas_info?.size?.[0] ?? 0) / 2;
const halfH = (rest.canvas_info?.size?.[1] ?? 0) / 2;

// Sanity inside evalRig: build a fresh cache and inspect FaceRotation state.
{
  const debugCache = new DeformerStateCache(rig, angleZ.applied_parameters ?? {});
  const fr = rig.rotationDeformers.find(r => r.id === 'FaceRotation');
  const st = debugCache.getState(fr);
  console.log('[evalRig-debug] FaceRotation state mat translation =', st.mat[2].toFixed(2), st.mat[5].toFixed(2));
  console.log('[evalRig-debug] FaceRotation state mat linear      =', st.mat[0].toFixed(4), st.mat[1].toFixed(4), '/', st.mat[3].toFixed(4), st.mat[4].toFixed(4));
  // Also at rest:
  const restCache = new DeformerStateCache(rig, {});
  const stR = restCache.getState(fr);
  console.log('[evalRig-debug] @rest FaceRotation translation =', stR.mat[2].toFixed(2), stR.mat[5].toFixed(2));
  console.log('[evalRig-debug] @rest FaceRotation linear      =', stR.mat[0].toFixed(4), stR.mat[1].toFixed(4), '/', stR.mat[3].toFixed(4), stR.mat[4].toFixed(4));
}

// Direct test: pick eyebrow-l vertex 0, compute v3@rest and v3@30 absolute positions.
{
  const ebL = rig.artMeshes[2];  // eyebrow-l per earlier mapping
  const restFrameDbg = evalRig(rig, {})[2];
  const angleZFrameDbg = evalRig(rig, angleZ.applied_parameters ?? {})[2];
  const ox_r = rest.drawables[2].vertices[0] * ppu + halfW;
  const oy_r = -rest.drawables[2].vertices[1] * ppu + halfH;
  const ox_30 = angleZ.drawables[2].vertices[0] * ppu + halfW;
  const oy_30 = -angleZ.drawables[2].vertices[1] * ppu + halfH;
  console.log('[trace-eyebrow]  v3@rest  v0  =', restFrameDbg.vertexPositions[0].toFixed(2), restFrameDbg.vertexPositions[1].toFixed(2));
  console.log('[trace-eyebrow]  oracle@rest    =', ox_r.toFixed(2), oy_r.toFixed(2));
  console.log('[trace-eyebrow]  v3@30  v0    =', angleZFrameDbg.vertexPositions[0].toFixed(2), angleZFrameDbg.vertexPositions[1].toFixed(2));
  console.log('[trace-eyebrow]  oracle@30      =', ox_30.toFixed(2), oy_30.toFixed(2));
}

const restFrames = evalRig(rig, {});
const angleZFrames = evalRig(rig, angleZ.applied_parameters ?? {});

console.log();
console.log('## After patch — PARAM divergence at AngleZ_pos30:');
const nodeNames = new Map();
for (const n of project.nodes ?? []) nodeNames.set(n.id, n.name);
const rows = [];
for (let i = 0; i < angleZ.drawables.length; i++) {
  const od = angleZ.drawables[i];
  const v3 = angleZFrames[i];
  const r0 = restFrames[i];
  const am = rig.artMeshes?.[i];
  const name = am ? (nodeNames.get(am.id) ?? '?') : '?';
  if (!v3 || !r0 || v3.vertexPositions.length !== od.vertex_count * 2) {
    rows.push({ idx: i, name, paramMax: NaN, status: 'skip' });
    continue;
  }
  let pmax = 0, psum = 0;
  for (let v = 0; v < od.vertex_count; v++) {
    const ox = od.vertices[v * 2] * ppu + halfW;
    const oy = -od.vertices[v * 2 + 1] * ppu + halfH;
    const ox_r = rest.drawables[i].vertices[v * 2] * ppu + halfW;
    const oy_r = -rest.drawables[i].vertices[v * 2 + 1] * ppu + halfH;
    const dx_p = (v3.vertexPositions[v * 2] - ox) - (r0.vertexPositions[v * 2] - ox_r);
    const dy_p = (v3.vertexPositions[v * 2 + 1] - oy) - (r0.vertexPositions[v * 2 + 1] - oy_r);
    const pd = Math.hypot(dx_p, dy_p);
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
    console.log(`  [${String(r.idx).padStart(2)}] ${r.name.padEnd(20)} param_max=${r.paramMax.toFixed(2).padStart(7)}  mean=${r.paramMean.toFixed(2).padStart(7)}`);
  }
}
