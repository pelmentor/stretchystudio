// v3 Phase 0F.30 - tests for src/io/live2d/rig/warpDeformers.js
//
// buildNeckWarpSpec - the neck-bend warp that follows ParamAngleZ.
// Locking in: 5x5 grid topology (6x6 ctrl points), shoulders-pinned
// gradient (sin(π·(1-rf)/2) is 1 at top row, 0 at bottom),
// pivot-relative-vs-normalised parent handling, autoRigNeckWarp
// fallback to defaults.
//
// Run: node scripts/test/test_warpDeformers.mjs

import { buildNeckWarpSpec } from '../../src/io/live2d/rig/warpDeformers.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function assertThrows(fn, name) {
  try { fn(); failed++; console.error(`FAIL: ${name} (no throw)`); }
  catch { passed++; }
}

function near(a, b, eps = 1e-9) {
  return Math.abs(a - b) <= eps;
}

const NECK_BBOX = { minX: 100, minY: 200, W: 200, H: 100 };

// ── Under WARP parent (normalised 0..1) ──────────────────────────

{
  const { spec, debug } = buildNeckWarpSpec({
    neckUnionBbox: NECK_BBOX,
    parentType: 'warp',
    parentDeformerId: 'BodyXWarp',
    canvasToBodyXX: (x) => (x - 100) / 200,  // map [100,300] → [0,1]
    canvasToBodyXY: (y) => (y - 200) / 100,  // map [200,300] → [0,1]
  });

  assert(spec.id === 'NeckWarp', 'warp parent: id');
  assert(spec.parent.type === 'warp', 'warp parent: parent type');
  assert(spec.parent.id === 'BodyXWarp', 'warp parent: parent id');
  assert(spec.localFrame === 'normalized-0to1', 'warp parent: localFrame');
  assert(spec.gridSize.rows === 5 && spec.gridSize.cols === 5, 'warp: 5×5 grid');

  // 6×6 = 36 control points × 2 coords = 72 floats
  assert(spec.baseGrid.length === 72, 'warp: 72 baseGrid floats');
  assert(spec.baseGrid instanceof Float64Array, 'warp: baseGrid is Float64Array');

  // Top-left corner: (100, 200) maps to (0, 0)
  assert(near(spec.baseGrid[0], 0), 'warp: top-left X = 0');
  assert(near(spec.baseGrid[1], 0), 'warp: top-left Y = 0');
  // Bottom-right corner: (300, 300) maps to (1, 1)
  // Index of (5,5) = (5*6 + 5) * 2 = 70
  assert(near(spec.baseGrid[70], 1), 'warp: bottom-right X = 1');
  assert(near(spec.baseGrid[71], 1), 'warp: bottom-right Y = 1');

  // Bindings + keyforms
  assert(spec.bindings.length === 1, 'warp: 1 binding');
  assert(spec.bindings[0].parameterId === 'ParamAngleZ', 'warp: binds ParamAngleZ');
  assert(JSON.stringify(spec.bindings[0].keys) === '[-30,0,30]', 'warp: 3 keys');
  assert(spec.keyforms.length === 3, 'warp: 3 keyforms');

  // Center keyform (k=0) is identical to base
  for (let i = 0; i < 72; i++) {
    if (spec.keyforms[1].positions[i] !== spec.baseGrid[i]) {
      failed++; console.error('FAIL: warp k=0 deviates from base'); break;
    }
  }
  passed++;

  // Bottom row stays pinned at +30 (gradient = 0)
  // Bottom-right at index 70 (X), 71 (Y); center kf same as +30 kf
  assert(spec.keyforms[2].positions[70] === spec.keyforms[1].positions[70],
    'warp: bottom row pinned at +30');
  assert(spec.keyforms[0].positions[70] === spec.keyforms[1].positions[70],
    'warp: bottom row pinned at -30');

  // Top row at +30 shifts X positively; at -30 shifts X negatively
  // Top-left X is at index 0
  const topLeftPlus  = spec.keyforms[2].positions[0];
  const topLeftMinus = spec.keyforms[0].positions[0];
  const topLeftRest  = spec.keyforms[1].positions[0];
  assert(topLeftPlus > topLeftRest, 'warp: top row shifted + at +30');
  assert(topLeftMinus < topLeftRest, 'warp: top row shifted - at -30');
  // Symmetric around rest
  assert(near((topLeftPlus + topLeftMinus) / 2, topLeftRest),
    'warp: shifts symmetric around rest');

  // Debug payload
  assert(typeof debug.NECK_TILT_FRAC === 'number' && debug.NECK_TILT_FRAC > 0,
    'warp: debug.NECK_TILT_FRAC');
  assert(debug.parentDeformer === 'Body X Warp', 'warp: debug.parentDeformer');
  assert(debug.gridCols === 6 && debug.gridRows === 6, 'warp: debug grid dims');
}

// ── Under ROTATION parent (pivot-relative, pixel) ────────────────

{
  const { spec, debug } = buildNeckWarpSpec({
    neckUnionBbox: NECK_BBOX,
    parentType: 'rotation',
    parentDeformerId: 'GroupRotation_neck',
    parentPivotCanvas: { x: 200, y: 250 },
    canvasToBodyXX: () => 0,  // unused
    canvasToBodyXY: () => 0,
  });

  assert(spec.parent.type === 'rotation', 'rot parent: parent type');
  assert(spec.localFrame === 'pivot-relative', 'rot parent: localFrame');

  // Base grid at top-left (canvas 100, 200): pivot-relative is (-100, -50)
  assert(spec.baseGrid[0] === -100, 'rot: top-left X = canvas - pivot');
  assert(spec.baseGrid[1] === -50, 'rot: top-left Y = canvas - pivot');

  // spanX in pixels (W=200), so shift magnitude is in pixels at +30
  // top-left X shifts by sign(+1) * tiltFrac * gradient(top row=1) * spanX(200)
  const restTopX = spec.keyforms[1].positions[0];
  const plusTopX = spec.keyforms[2].positions[0];
  const shift = plusTopX - restTopX;
  assert(shift > 0, 'rot: top row shifts + at +30');
  // The shift should equal NECK_TILT_FRAC * 200
  assert(near(shift, debug.NECK_TILT_FRAC * 200), 'rot: shift = tiltFrac * spanX');

  assert(debug.parentDeformer === 'GroupRotation_neck', 'rot: debug parent name');
}

// ── Validation: rotation parent without pivot canvas throws ──────

assertThrows(() => buildNeckWarpSpec({
  neckUnionBbox: NECK_BBOX,
  parentType: 'rotation',
  parentDeformerId: 'X',
  canvasToBodyXX: () => 0,
  canvasToBodyXY: () => 0,
}), 'validation: rotation parent without pivotCanvas throws');

// ── autoRigNeckWarp default fallback ─────────────────────────────

{
  // Without supplying autoRigNeckWarp, defaults are used
  const { debug } = buildNeckWarpSpec({
    neckUnionBbox: NECK_BBOX,
    parentType: 'warp',
    parentDeformerId: 'X',
    canvasToBodyXX: (x) => x / 800,
    canvasToBodyXY: (y) => y / 600,
  });
  assert(debug.NECK_TILT_FRAC > 0 && debug.NECK_TILT_FRAC < 1,
    'default: NECK_TILT_FRAC in (0, 1)');
}

{
  // Custom autoRigNeckWarp.tiltFrac is honoured
  const { debug } = buildNeckWarpSpec({
    neckUnionBbox: NECK_BBOX,
    parentType: 'warp',
    parentDeformerId: 'X',
    canvasToBodyXX: (x) => x / 800,
    canvasToBodyXY: (y) => y / 600,
    autoRigNeckWarp: { tiltFrac: 0.42 },
  });
  assert(debug.NECK_TILT_FRAC === 0.42, 'custom: tiltFrac override');
}

// ── Spec invariants ──────────────────────────────────────────────

{
  const { spec } = buildNeckWarpSpec({
    neckUnionBbox: NECK_BBOX,
    parentType: 'warp',
    parentDeformerId: 'X',
    canvasToBodyXX: (x) => x / 800,
    canvasToBodyXY: (y) => y / 600,
  });
  assert(spec.isVisible === true, 'invariant: isVisible');
  assert(spec.isLocked === false, 'invariant: isLocked');
  assert(spec.isQuadTransform === false, 'invariant: isQuadTransform');
  // All 3 keyforms have opacity 1
  for (const kf of spec.keyforms) {
    if (kf.opacity !== 1) { failed++; console.error('FAIL: keyform opacity != 1'); break; }
  }
  passed++;
}

console.log(`warpDeformers: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
