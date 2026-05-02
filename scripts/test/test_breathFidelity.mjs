// Breath warp byte-fidelity regression — locks our heuristic breath grid
// synthesizer against Cubism Editor's authored shelby breath warp.
//
// Why: the user reported "breath warp doesn't match Cubism Viewer"
// (2026-05-02). Investigation showed the synthesizer's grid bytes
// already match Cubism's authored shelby exactly — the residual visual
// divergence is the same chain-composition issue as BUG-003 (Phase 2b).
// This test pins the bytes so a future "let's tweak the breath
// constants" PR can't silently regress the byte fidelity.
//
// Ground truth was extracted from `New Folder_cubism/shelby.moc3`
// (Cubism Editor's "Export For Runtime" output) on 2026-05-02 via
// `scripts/dev-tools/moc3_inspect_warp.py`. The authored grid is
// uniform 6×6 spanning 0.055..0.945 in BodyWarpY's normalized 0..1
// frame; the kf[1] deltas follow the canonical breath shape:
//   - rows 0, 4, 5 pinned (top edge + leg rows hold position)
//   - rows 1, 2, 3 dy = -0.012, -0.015, -0.005 (chest peak at row 2)
//   - cols 0, 5 pinned; cols 1..4 dx kicks ∓0.004, ∓0.0013, ±0.0013, ±0.004
//
// Run: node scripts/test/test_breathFidelity.mjs

import { buildBodyWarpChain } from '../../src/io/live2d/rig/bodyWarp.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function approx(a, b, tol = 1e-4) {
  return Math.abs(a - b) <= tol;
}

// Authored shelby BreathWarp grid (extracted from Cubism Editor's
// shelby.moc3, 2026-05-02). Layout: row-major, 6 rows × 6 cols, two
// floats per cp (x, y).
const CUBISM_BREATH_KF0 = [
  // r0 (top — pinned)
  0.0550,0.0550,  0.2330,0.0550,  0.4110,0.0550,  0.5890,0.0550,  0.7670,0.0550,  0.9450,0.0550,
  // r1
  0.0550,0.2330,  0.2330,0.2330,  0.4110,0.2330,  0.5890,0.2330,  0.7670,0.2330,  0.9450,0.2330,
  // r2
  0.0550,0.4110,  0.2330,0.4110,  0.4110,0.4110,  0.5890,0.4110,  0.7670,0.4110,  0.9450,0.4110,
  // r3
  0.0550,0.5890,  0.2330,0.5890,  0.4110,0.5890,  0.5890,0.5890,  0.7670,0.5890,  0.9450,0.5890,
  // r4 (leg row — pinned)
  0.0550,0.7670,  0.2330,0.7670,  0.4110,0.7670,  0.5890,0.7670,  0.7670,0.7670,  0.9450,0.7670,
  // r5 (bottom — pinned)
  0.0550,0.9450,  0.2330,0.9450,  0.4110,0.9450,  0.5890,0.9450,  0.7670,0.9450,  0.9450,0.9450,
];
const CUBISM_BREATH_KF1 = [
  // r0 — pinned same as kf0
  0.0550,0.0550,  0.2330,0.0550,  0.4110,0.0550,  0.5890,0.0550,  0.7670,0.0550,  0.9450,0.0550,
  // r1: dy=-0.012; dx interior = +0.004, +0.0013, -0.0013, -0.004 (ends pinned)
  0.0550,0.2330,  0.2370,0.2210,  0.4123,0.2210,  0.5877,0.2210,  0.7630,0.2210,  0.9450,0.2330,
  // r2: dy=-0.015 — peak chest lift
  0.0550,0.4110,  0.2370,0.3960,  0.4123,0.3960,  0.5877,0.3960,  0.7630,0.3960,  0.9450,0.4110,
  // r3: dy=-0.005 — gentle abdomen lift
  0.0550,0.5890,  0.2370,0.5840,  0.4123,0.5840,  0.5877,0.5840,  0.7630,0.5840,  0.9450,0.5890,
  // r4 — pinned
  0.0550,0.7670,  0.2330,0.7670,  0.4110,0.7670,  0.5890,0.7670,  0.7670,0.7670,  0.9450,0.7670,
  // r5 — pinned
  0.0550,0.9450,  0.2330,0.9450,  0.4110,0.9450,  0.5890,0.9450,  0.7670,0.9450,  0.9450,0.9450,
];

// Drive `buildBodyWarpChain` with a stub that exercises the breath
// branch. perMesh / canvas / hasParamBodyAngleX values don't affect
// the breath grid (BR_MIN/BR_MAX margins are constants from
// autoRigBodyWarp; the breath synth is character-invariant).
const result = buildBodyWarpChain({
  perMesh: [{ vertices: new Float64Array([0, 0, 100, 100]) }],
  canvasW: 1024,
  canvasH: 1024,
  bodyAnalysis: null,
  hasParamBodyAngleX: false,
});

const breath = result.specs.find(s => s.id === 'BreathWarp');
assert(breath != null, 'BreathWarp spec produced');
assert(breath.parent.type === 'warp' && breath.parent.id === 'BodyWarpY',
  'BreathWarp parent = BodyWarpY (matches Cubism authored shelby topology)');
assert(breath.localFrame === 'normalized-0to1',
  'BreathWarp localFrame = normalized-0to1');
assert(breath.gridSize.rows === 5 && breath.gridSize.cols === 5,
  'BreathWarp grid 6×6 control points (5×5 cells)');
assert(breath.bindings.length === 1 && breath.bindings[0].parameterId === 'ParamBreath',
  'BreathWarp bound to ParamBreath');
assert(JSON.stringify(breath.bindings[0].keys) === '[0,1]',
  'BreathWarp binding keys = [0, 1]');
assert(breath.keyforms.length === 2,
  'BreathWarp has 2 keyforms (ParamBreath=0, ParamBreath=1)');

// kf[0] = base grid
const kf0 = breath.keyforms[0];
assert(JSON.stringify(kf0.keyTuple) === '[0]', 'kf[0] keyTuple = [0]');
assert(kf0.positions.length === 72, 'kf[0] positions length = 72 (36 cps × 2)');
let kf0Match = true;
for (let i = 0; i < 72; i++) {
  if (!approx(kf0.positions[i], CUBISM_BREATH_KF0[i])) { kf0Match = false; break; }
}
assert(kf0Match,
  'BreathWarp kf[0] matches Cubism authored shelby kf[0] byte-for-byte');

// kf[1] = breath-active grid
const kf1 = breath.keyforms[1];
assert(JSON.stringify(kf1.keyTuple) === '[1]', 'kf[1] keyTuple = [1]');
let kf1Match = true;
let firstMismatch = null;
for (let i = 0; i < 72; i++) {
  if (!approx(kf1.positions[i], CUBISM_BREATH_KF1[i])) {
    if (firstMismatch == null) {
      firstMismatch = `idx=${i} expected=${CUBISM_BREATH_KF1[i].toFixed(4)} got=${kf1.positions[i].toFixed(4)}`;
    }
    kf1Match = false;
  }
}
assert(kf1Match,
  `BreathWarp kf[1] matches Cubism authored shelby kf[1] byte-for-byte${firstMismatch ? ' (first mismatch: ' + firstMismatch + ')' : ''}`);

// Cross-check the deltas (kf[1] - kf[0]) follow the documented breath
// shape so a regression that changes the synthesizer's row constants
// fails this test even if the absolute positions accidentally line up.
function deltaAt(r, c) {
  const i = (r * 6 + c) * 2;
  return [kf1.positions[i] - kf0.positions[i], kf1.positions[i + 1] - kf0.positions[i + 1]];
}
// r=2 (chest) is the dy peak at -0.015
for (let c = 1; c <= 4; c++) {
  const [, dy] = deltaAt(2, c);
  assert(approx(dy, -0.015), `r=2 c=${c}: dy = -0.015 (chest peak)`);
}
// r=1 (shoulders) dy = -0.012
for (let c = 1; c <= 4; c++) {
  const [, dy] = deltaAt(1, c);
  assert(approx(dy, -0.012), `r=1 c=${c}: dy = -0.012 (shoulder lift)`);
}
// r=3 (upper abdomen) dy = -0.005
for (let c = 1; c <= 4; c++) {
  const [, dy] = deltaAt(3, c);
  assert(approx(dy, -0.005), `r=3 c=${c}: dy = -0.005 (upper abdomen)`);
}
// dx kicks: c=1 → +0.004, c=2 → +0.0013, c=3 → -0.0013, c=4 → -0.004
const expectedDx = { 1: +0.004, 2: +0.0013, 3: -0.0013, 4: -0.004 };
for (let r = 1; r <= 3; r++) {
  for (let c = 1; c <= 4; c++) {
    const [dx] = deltaAt(r, c);
    assert(approx(dx, expectedDx[c]), `r=${r} c=${c}: dx = ${expectedDx[c]} (chest squeeze)`);
  }
}
// Boundaries pinned.
for (let c = 0; c < 6; c++) {
  for (const r of [0, 4, 5]) {
    const [dx, dy] = deltaAt(r, c);
    assert(dx === 0 && dy === 0, `r=${r} c=${c}: pinned (no breath delta)`);
  }
}
for (let r = 0; r < 6; r++) {
  for (const c of [0, 5]) {
    const [dx, dy] = deltaAt(r, c);
    assert(dx === 0 && dy === 0, `r=${r} c=${c}: pinned (col edge)`);
  }
}

console.log(`breathFidelity: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
