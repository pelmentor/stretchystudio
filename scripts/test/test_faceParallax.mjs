// Tests for src/io/live2d/rig/faceParallaxBuilder.js +
// src/io/live2d/rig/faceParallaxStore.js — Stage 4
// (face parallax keyform persistence — Milestone C kickoff).
// Run: node scripts/test_faceParallax.mjs

import { buildFaceParallaxSpec } from '../../src/io/live2d/rig/faceParallaxBuilder.js';
import {
  serializeFaceParallaxSpec,
  deserializeFaceParallaxSpec,
  resolveFaceParallax,
  seedFaceParallax,
  clearFaceParallax,
} from '../../src/io/live2d/rig/faceParallaxStore.js';
import { DEFAULT_AUTO_RIG_CONFIG } from '../../src/io/live2d/rig/autoRigConfig.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertEq(actual, expected, name) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
  console.error(`  expected: ${e}`);
  console.error(`  actual:   ${a}`);
}

function assertClose(actual, expected, eps, name) {
  if (Math.abs(actual - expected) < eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name} — expected ~${expected}, got ${actual}`);
}

// Float64Array equality with epsilon — used for spec.keyforms[i].positions.
function arraysClose(a, b, eps, name) {
  if (a.length !== b.length) {
    failed++;
    console.error(`FAIL: ${name} — length mismatch ${a.length} vs ${b.length}`);
    return;
  }
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > eps) {
      failed++;
      console.error(`FAIL: ${name} at idx=${i} — ${a[i]} vs ${b[i]}`);
      return;
    }
  }
  passed++;
}

// Synthetic Hiyori-ish face: 5 face-tagged meshes covering canonical
// regions. Deliberately scaled small so we can sanity-check spec
// dimensions.
function makeFaceMeshes() {
  // Bbox roughly: face center at (200, 200), face mesh 100×120 wide.
  return [
    // Main face mesh
    { tag: 'face', vertices: [150, 140, 250, 140, 250, 260, 150, 260] },
    // Eyes (super-group: eye-l)
    { tag: 'eyelash-l',  vertices: [165, 175, 195, 175, 195, 185, 165, 185] },
    { tag: 'eyewhite-l', vertices: [167, 177, 193, 177, 193, 183, 167, 183] },
    { tag: 'irides-l',   vertices: [177, 178, 187, 178, 187, 183, 177, 183] },
    // Eyes (super-group: eye-r)
    { tag: 'eyelash-r',  vertices: [205, 175, 235, 175, 235, 185, 205, 185] },
    { tag: 'eyewhite-r', vertices: [207, 177, 233, 177, 233, 183, 207, 183] },
    { tag: 'irides-r',   vertices: [217, 178, 227, 178, 227, 183, 217, 183] },
    // Eyebrows
    { tag: 'eyebrow-l',  vertices: [165, 165, 195, 165, 195, 170, 165, 170] },
    { tag: 'eyebrow-r',  vertices: [205, 165, 235, 165, 235, 170, 205, 170] },
    // Mouth
    { tag: 'mouth',      vertices: [185, 220, 215, 220, 215, 230, 185, 230] },
    // Nose
    { tag: 'nose',       vertices: [195, 195, 205, 195, 205, 215, 195, 215] },
  ];
}

function makeFaceBoxes() {
  return {
    faceUnionBbox: { minX: 140, minY: 130, maxX: 260, maxY: 270, W: 120, H: 140 },
    faceMeshBbox: { minX: 150, minY: 140, maxX: 250, maxY: 260 },
    facePivotCx: 200,
    facePivotCy: 260,
  };
}

// --- buildFaceParallaxSpec: shape contract ---

{
  const meshes = makeFaceMeshes();
  const { spec, debug } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  assertEq(spec.id, 'FaceParallaxWarp', 'spec.id');
  assertEq(spec.name, 'Face Parallax', 'spec.name');
  assertEq(spec.parent, { type: 'rotation', id: 'FaceRotation' }, 'spec.parent');
  assertEq(spec.gridSize, { rows: 5, cols: 5 }, 'spec.gridSize 5x5 cells = 6x6 control points');
  assert(spec.baseGrid instanceof Float64Array, 'baseGrid is Float64Array');
  assertEq(spec.baseGrid.length, 6 * 6 * 2, 'baseGrid 36 points × 2 floats');
  assertEq(spec.localFrame, 'pivot-relative', 'localFrame');
  assertEq(spec.bindings.length, 2, '2 bindings (AngleY + AngleX)');
  assertEq(spec.bindings[0].parameterId, 'ParamAngleY', 'first binding ParamAngleY (Hiyori order)');
  assertEq(spec.bindings[1].parameterId, 'ParamAngleX', 'second binding ParamAngleX');
  assertEq(spec.bindings[0].keys, [-30, 0, 30], 'binding keys -30/0/30');
  assertEq(spec.keyforms.length, 9, '9 keyforms (3×3)');
  assert(spec.keyforms[0].positions instanceof Float64Array, 'keyform.positions is Float64Array');
  assertEq(spec.keyforms[0].positions.length, 6 * 6 * 2, 'each keyform 72 floats');
  assertEq(spec.isVisible, true, 'isVisible default');
  assertEq(spec.isLocked, false, 'isLocked default');
  assertEq(spec.isQuadTransform, false, 'isQuadTransform default');

  // Debug shape
  assert(debug.algorithm.includes('depth-weighted'), 'debug.algorithm');
  assertEq(debug.gridCols, 6, 'debug.gridCols');
  assertEq(debug.gridRows, 6, 'debug.gridRows');
  assert(debug.constants.FP_DEPTH_K === 0.80, 'debug constants reflect defaults');
}

// --- buildFaceParallaxSpec: rest grid is pivot-relative ---

{
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  // First grid point: faceUnionBbox.minX(140) - facePivotCx(200) = -60
  //                    faceUnionBbox.minY(130) - facePivotCy(260) = -130
  assertClose(spec.baseGrid[0], -60, 1e-6, 'baseGrid[0] = minX - facePivotCx');
  assertClose(spec.baseGrid[1], -130, 1e-6, 'baseGrid[1] = minY - facePivotCy');
  // Last grid point: faceUnionBbox.maxX(260) - 200 = 60
  //                  faceUnionBbox.maxY(270) - 260 = 10
  const last = spec.baseGrid.length - 2;
  assertClose(spec.baseGrid[last],     60, 1e-6, 'baseGrid[last].x = maxX - facePivotCx');
  assertClose(spec.baseGrid[last + 1], 10, 1e-6, 'baseGrid[last].y = maxY - facePivotCy');
}

// --- buildFaceParallaxSpec: rest keyform (ax=0, ay=0) equals baseGrid ---

{
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  // Find the (ay=0, ax=0) keyform — keyTuple stored as [ay, ax] with
  // AngleY varying fastest in the storage order. (axOuter=0, ayInner=0)
  // is index 4 in 0..8.
  const restKf = spec.keyforms.find(k => k.keyTuple[0] === 0 && k.keyTuple[1] === 0);
  assert(restKf != null, 'has (ay=0, ax=0) keyform');
  arraysClose(restKf.positions, spec.baseGrid, 1e-9, 'rest keyform = baseGrid');
}

// --- buildFaceParallaxSpec: deterministic (idempotent) ---

{
  const meshes = makeFaceMeshes();
  const ctx = { meshes, ...makeFaceBoxes() };
  const a = buildFaceParallaxSpec(ctx);
  const b = buildFaceParallaxSpec(ctx);
  arraysClose(a.spec.baseGrid, b.spec.baseGrid, 1e-15, 'baseGrid deterministic');
  for (let i = 0; i < 9; i++) {
    arraysClose(a.spec.keyforms[i].positions, b.spec.keyforms[i].positions,
      1e-15, `keyform[${i}].positions deterministic`);
  }
}

// --- buildFaceParallaxSpec: ax≠0 keyforms diverge from rest ---

{
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  // (ay=0, ax=30) keyform should differ from rest at center (where Z is high)
  const ax30 = spec.keyforms.find(k => k.keyTuple[0] === 0 && k.keyTuple[1] === 30);
  assert(ax30 != null, 'has (ay=0, ax=30) keyform');
  // Center of grid (3, 3) at index = (3*6 + 3) * 2 = 42
  const dx = ax30.positions[42] - spec.baseGrid[42];
  assert(Math.abs(dx) > 0.5, 'ax=30 at center has nonzero X shift');
}

// --- buildFaceParallaxSpec: ax=0 keyforms are L/R symmetric ---

{
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  const ay30 = spec.keyforms.find(k => k.keyTuple[0] === 30 && k.keyTuple[1] === 0);
  // For each row, mirror columns should have antisymmetric X shift,
  // symmetric Y shift (relative to rest).
  const fpGW = 6, fpGH = 6;
  for (let r = 0; r < fpGH; r++) {
    for (let c = 0; c < 3; c++) {
      const mc = fpGW - 1 - c;
      const giL = (r * fpGW + c) * 2;
      const giR = (r * fpGW + mc) * 2;
      const sxL = ay30.positions[giL]     - spec.baseGrid[giL];
      const sxR = ay30.positions[giR]     - spec.baseGrid[giR];
      const syL = ay30.positions[giL + 1] - spec.baseGrid[giL + 1];
      const syR = ay30.positions[giR + 1] - spec.baseGrid[giR + 1];
      // Anti-symmetric X: sxL + sxR ≈ 0
      assertClose(sxL + sxR, 0, 1e-9, `ax=0 ay=30 row=${r} col=${c} antisymmetric X`);
      // Symmetric Y: syL ≈ syR
      assertClose(syL - syR, 0, 1e-9, `ax=0 ay=30 row=${r} col=${c} symmetric Y`);
    }
  }
}

// --- buildFaceParallaxSpec: protected regions (super-groups present) ---

{
  const meshes = makeFaceMeshes();
  const { debug } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  // SUPER_GROUPS produce 2 entries (eye-l, eye-r); plus per-mesh:
  // eyebrow-l, eyebrow-r, mouth, nose = 6 total. (Eyes are aggregated
  // into super-groups, so eyelash/eyewhite/irides become 2 region entries
  // not 6.)
  const tags = debug.protectedRegions.map(r => r.tag).sort();
  assertEq(tags, ['eye-l', 'eye-r', 'eyebrow-l', 'eyebrow-r', 'mouth', 'nose'].sort(),
    'protected regions: 2 super-groups + 4 per-mesh = 6');
  // Eye super-groups must have protection 1.0 (full rigid).
  const eyeL = debug.protectedRegions.find(r => r.tag === 'eye-l');
  assertEq(eyeL.protection, 1.00, 'eye-l protection 1.00');
  // Eyebrow per-mesh: 0.80 from PROTECTION_PER_TAG.
  const browL = debug.protectedRegions.find(r => r.tag === 'eyebrow-l');
  assertEq(browL.protection, 0.80, 'eyebrow-l protection 0.80');
  // Mouth per-mesh: 0.30.
  const mouth = debug.protectedRegions.find(r => r.tag === 'mouth');
  assertEq(mouth.protection, 0.30, 'mouth protection 0.30');
}

// --- buildFaceParallaxSpec: custom autoRigFaceParallax propagates ---

{
  const meshes = makeFaceMeshes();
  const { debug } = buildFaceParallaxSpec({
    meshes, ...makeFaceBoxes(),
    autoRigFaceParallax: {
      ...DEFAULT_AUTO_RIG_CONFIG.faceParallax,
      depthK: 0.50,
      maxAngleXDeg: 25,
      // Override eye protection to 0.5 — should affect eye-l/eye-r protection.
      // Note: super-groups always carry 1.0 * protectionStrength, the per-tag
      // entry only matters for non-super-grouped meshes.
      protectionStrength: 0.7,
    },
  });
  assertClose(debug.constants.FP_DEPTH_K, 0.50, 1e-9, 'custom depthK propagates');
  assertClose(debug.constants.FP_MAX_ANGLE_X_DEG, 25, 1e-9, 'custom maxAngleX propagates');
  // protectionStrength=0.7 → eye-l protection = 1.00 * 0.7
  const eyeL = debug.protectedRegions.find(r => r.tag === 'eye-l');
  assertClose(eyeL.protection, 0.70, 1e-9, 'protectionStrength multiplier');
}

// --- buildFaceParallaxSpec: no face mesh → falls back to union ---

{
  // Drop the 'face' tag to test fallback path.
  const meshes = makeFaceMeshes().filter(m => m.tag !== 'face');
  const boxes = makeFaceBoxes();
  const { spec, debug } = buildFaceParallaxSpec({
    meshes, ...boxes, faceMeshBbox: null,
  });
  assertEq(spec.gridSize, { rows: 5, cols: 5 }, 'fallback path same grid size');
  // faceMeshCenter falls back to facePivotCx + (faceUnion midY)
  assertClose(debug.faceMeshCenter.cx, 200, 1e-9, 'fallback faceMeshCenter.cx = facePivotCx');
  assertClose(debug.faceMeshCenter.cy, (130 + 270) / 2, 1e-9, 'fallback faceMeshCenter.cy = union midY');
}

// --- serializeFaceParallaxSpec: Float64Array → plain arrays ---

{
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  const stored = serializeFaceParallaxSpec(spec);
  assertEq(stored.id, 'FaceParallaxWarp', 'stored.id');
  assertEq(stored.gridSize, { rows: 5, cols: 5 }, 'stored.gridSize');
  assert(Array.isArray(stored.baseGrid), 'stored.baseGrid is plain Array');
  assertEq(stored.baseGrid.length, 72, 'stored.baseGrid 72 numbers');
  assert(Array.isArray(stored.keyforms[0].positions), 'stored.keyform.positions is plain Array');
  assertEq(stored.keyforms.length, 9, 'stored 9 keyforms');
  assert(typeof stored.baseGrid[0] === 'number', 'stored array contains plain numbers');
}

// --- deserializeFaceParallaxSpec: round-trip preserves values ---

{
  const meshes = makeFaceMeshes();
  const { spec: original } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  const stored = serializeFaceParallaxSpec(original);
  const restored = deserializeFaceParallaxSpec(stored);
  assert(restored.baseGrid instanceof Float64Array, 'restored.baseGrid is Float64Array');
  assert(restored.keyforms[0].positions instanceof Float64Array, 'restored.positions is Float64Array');
  arraysClose(restored.baseGrid, original.baseGrid, 1e-15, 'baseGrid round-trip exact');
  for (let i = 0; i < 9; i++) {
    arraysClose(restored.keyforms[i].positions, original.keyforms[i].positions,
      1e-15, `keyform[${i}].positions round-trip exact`);
  }
  assertEq(restored.bindings, original.bindings, 'bindings round-trip');
}

// --- deserializeFaceParallaxSpec: malformed input ---

{
  assertEq(deserializeFaceParallaxSpec(null),                null, 'null → null');
  assertEq(deserializeFaceParallaxSpec(undefined),           null, 'undefined → null');
  assertEq(deserializeFaceParallaxSpec({}),                  null, 'empty → null (no keyforms)');
  assertEq(deserializeFaceParallaxSpec({ keyforms: [] }),    null, 'empty keyforms → null');
  assertEq(deserializeFaceParallaxSpec({ keyforms: [{}] }),  null, 'no baseGrid → null');
}

// --- deserializeFaceParallaxSpec: lenient on partial fields ---

{
  // Minimum viable: keyforms + baseGrid present, defaults fill the rest.
  const minimal = {
    keyforms: [{ positions: [1, 2, 3, 4] }],
    baseGrid: [0, 0, 0, 0],
  };
  const restored = deserializeFaceParallaxSpec(minimal);
  assertEq(restored.id, 'FaceParallaxWarp', 'default id');
  assertEq(restored.parent, { type: 'rotation', id: 'FaceRotation' }, 'default parent');
  assertEq(restored.gridSize, { rows: 5, cols: 5 }, 'default gridSize');
  assertEq(restored.localFrame, 'pivot-relative', 'default localFrame');
  assertEq(restored.keyforms[0].opacity, 1, 'default opacity');
}

// --- resolveFaceParallax / seedFaceParallax / clearFaceParallax ---

{
  const project = {};
  assertEq(resolveFaceParallax(project), null, 'no project.faceParallax → null');
}

{
  const project = { faceParallax: null };
  assertEq(resolveFaceParallax(project), null, 'null → null');
}

{
  const project = {};
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  seedFaceParallax(project, spec);
  assert(project.faceParallax != null, 'seed wrote project.faceParallax');
  assert(Array.isArray(project.faceParallax.baseGrid), 'stored as plain array');
  const resolved = resolveFaceParallax(project);
  assert(resolved != null, 'resolve returns spec when populated');
  arraysClose(resolved.baseGrid, spec.baseGrid, 1e-15, 'resolved baseGrid matches seeded');
  for (let i = 0; i < 9; i++) {
    arraysClose(resolved.keyforms[i].positions, spec.keyforms[i].positions,
      1e-15, `resolved keyform[${i}] matches seeded`);
  }
}

{
  // seedFaceParallax destructive: overwrites prior content.
  const project = {
    faceParallax: { extraField: 'should be gone after re-seed' },
  };
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  seedFaceParallax(project, spec);
  assert(!project.faceParallax.extraField, 'destructive: prior fields gone');
}

{
  // clearFaceParallax sets back to null.
  const project = {};
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  seedFaceParallax(project, spec);
  assert(project.faceParallax != null, 'pre-clear: populated');
  clearFaceParallax(project);
  assertEq(project.faceParallax, null, 'clear: null');
  assertEq(resolveFaceParallax(project), null, 'resolve after clear: null');
}

// --- JSON round-trip via stringify/parse (simulates .stretch save/load) ---

{
  const project = {};
  const meshes = makeFaceMeshes();
  const { spec } = buildFaceParallaxSpec({ meshes, ...makeFaceBoxes() });
  seedFaceParallax(project, spec);
  const json = JSON.stringify(project);
  const reloaded = JSON.parse(json);
  const resolved = resolveFaceParallax(reloaded);
  arraysClose(resolved.baseGrid, spec.baseGrid, 1e-15, 'JSON round-trip baseGrid');
  for (let i = 0; i < 9; i++) {
    arraysClose(resolved.keyforms[i].positions, spec.keyforms[i].positions,
      1e-15, `JSON round-trip keyform[${i}]`);
  }
}

// --- EQUIVALENCE: spec built twice from same inputs == ---

{
  const meshes = makeFaceMeshes();
  const ctx = { meshes, ...makeFaceBoxes() };
  const fresh = buildFaceParallaxSpec(ctx);
  // Round-trip through serialize → JSON → deserialize must give us the
  // same spec (within float precision). This is the Stage 4 invariant
  // that gates the diff harness.
  const stored = serializeFaceParallaxSpec(fresh.spec);
  const json = JSON.stringify(stored);
  const reloaded = JSON.parse(json);
  const restored = deserializeFaceParallaxSpec(reloaded);
  arraysClose(restored.baseGrid, fresh.spec.baseGrid, 1e-15, 'EQUIVALENCE: baseGrid');
  for (let i = 0; i < 9; i++) {
    arraysClose(restored.keyforms[i].positions, fresh.spec.keyforms[i].positions,
      1e-15, `EQUIVALENCE: keyform[${i}].positions`);
  }
}

// --- Summary ---

console.log(`faceParallax: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
