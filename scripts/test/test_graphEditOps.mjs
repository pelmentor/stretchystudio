// Animation Phase 5 — tests for src/anim/graphEditOps.js
//
// Validates the pure keyform-drag and handle-drag mutations the
// FCurveEditor uses inside its `updateProject((p) => …)` immer draft.
//
// Run: node scripts/test/test_graphEditOps.mjs

import { applyKeyformDrag, applyHandleDrag } from '../../src/anim/graphEditOps.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}
function near(actual, expected, eps, name) {
  if (Math.abs(actual - expected) <= eps) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n  expected: ${expected}\n  actual:   ${actual}`);
}

// ── applyKeyformDrag ────────────────────────────────────────────────

// Free drag (no neighbours) — value translates, handles ride along.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 80,  value: 4 },
    handleRight: { time: 120, value: 6 },
  };
  const applied = applyKeyformDrag(
    kf, null, null,
    100, 5, { time: 80, value: 4 }, { time: 120, value: 6 },
    50, 10,
    1000,
  );
  assert(applied === 50, 'keyform-drag no-neighbours: applied dt equals requested dt');
  assert(kf.time === 150, 'keyform-drag: time += dTime');
  assert(kf.value === 15, 'keyform-drag: value += dValue');
  assert(kf.handleLeft.time === 130, 'keyform-drag: handleLeft.time rides along');
  assert(kf.handleLeft.value === 14, 'keyform-drag: handleLeft.value rides along');
  assert(kf.handleRight.time === 170, 'keyform-drag: handleRight.time rides along');
  assert(kf.handleRight.value === 16, 'keyform-drag: handleRight.value rides along');
}

// Negative-dt clamp against prev neighbour: keyform must not collide.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 90, value: 5 },
    handleRight: { time: 110, value: 5 },
  };
  const prev = { time: 80 };
  const applied = applyKeyformDrag(
    kf, prev, null,
    100, 5, { time: 90, value: 5 }, { time: 110, value: 5 },
    -100, 0,  // requested dt would put kf at time=0, way past prev
    1000,
  );
  assert(kf.time === 81, 'prev-clamp: time = prev.time + 1');
  assert(applied === -19, 'prev-clamp: applied dt = clamped minus orig');
  // Handles ride along with the CLAMPED delta, not the requested delta.
  assert(kf.handleLeft.time === 71, 'prev-clamp: handles translate by applied dt');
}

// Positive-dt clamp against next neighbour.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 95, value: 5 },
    handleRight: { time: 105, value: 5 },
  };
  const next = { time: 120 };
  applyKeyformDrag(
    kf, null, next,
    100, 5, { time: 95, value: 5 }, { time: 105, value: 5 },
    1000, 0,
    2000,
  );
  assert(kf.time === 119, 'next-clamp: time = next.time - 1');
  assert(kf.handleRight.time === 124, 'next-clamp: handles translate by applied dt');
}

// Value drag is unrestricted (no value-axis neighbour concept).
{
  const kf = { time: 100, value: 5, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 80, value: 4 }, handleRight: { time: 120, value: 6 } };
  applyKeyformDrag(kf, null, null, 100, 5, { time: 80, value: 4 }, { time: 120, value: 6 }, 0, 999, 1000);
  assert(kf.value === 1004, 'value-drag: no value-axis clamp');
  assert(kf.handleLeft.value === 1003, 'value-drag: handles ride along on value');
}

// Original snapshot semantics: caller passes orig values so subsequent
// drag-moves are computed against the start-of-drag baseline, not the
// previous frame. Two-step replay.
{
  const kf = { time: 100, value: 5, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 80, value: 4 }, handleRight: { time: 120, value: 6 } };
  // First move: dt=10, dv=2
  applyKeyformDrag(kf, null, null, 100, 5, { time: 80, value: 4 }, { time: 120, value: 6 }, 10, 2, 1000);
  assert(kf.time === 110 && kf.value === 7, 'replay step1: deltas applied');
  // Second move: dt=30, dv=5 (computed against ORIG, not current)
  applyKeyformDrag(kf, null, null, 100, 5, { time: 80, value: 4 }, { time: 120, value: 6 }, 30, 5, 1000);
  assert(kf.time === 130 && kf.value === 10, 'replay step2: absolute baseline, not relative');
  assert(kf.handleLeft.time === 110 && kf.handleLeft.value === 9, 'replay step2: handles use orig baseline');
}

// ── applyHandleDrag — auto → free conversion ────────────────────────

{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'free', 'auto-handle drag: right side flips to free');
  assert(kf.handleType.left === 'auto', 'auto-handle drag: left side untouched');
  assert(kf.handleRight.time === 130 && kf.handleRight.value === 8, 'auto-handle drag: new handle written');
}

{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto_clamped', right: 'free' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'left', { time: 70, value: 3 });
  assert(kf.handleType.left === 'free', 'auto_clamped drag: also flips to free');
}

// Free → free (no flip needed; just update).
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 80,  value: 4 },
    handleRight: { time: 120, value: 6 },
  };
  applyHandleDrag(kf, 'left', { time: 60, value: 2 });
  assert(kf.handleType.left === 'free', 'free drag: stays free');
  assert(kf.handleLeft.time === 60 && kf.handleLeft.value === 2, 'free drag: handle updated');
  assert(kf.handleRight.time === 120 && kf.handleRight.value === 6, 'free drag: opposite untouched');
}

// Missing handleType defaults to auto/auto and flips on edit.
{
  const kf = {
    time: 100, value: 5,
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'free', 'missing handleType: defaults to auto → flips to free');
}

// ── applyHandleDrag — aligned mirror ────────────────────────────────

// Aligned opposite reflects through keyform, length preserved.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    // left is at (80, 5): 20 units left of keyform, 0 above.
    // right is at (120, 5): 20 units right, 0 above.
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  // Drag right to (130, 10) — direction (30, 5) from keyform, length √(900+25)=√925.
  applyHandleDrag(kf, 'right', { time: 130, value: 10 });
  // Left should reflect through keyform: unit dir of right = (30/√925, 5/√925).
  // Left = keyform - unit * oppLen. oppLen of left was 20.
  // Reflected left = (100, 5) - (30/√925, 5/√925) * 20.
  const oppLen = 20;
  const newLen = Math.sqrt(925);
  const expLeftX = 100 - (30 / newLen) * oppLen;
  const expLeftY = 5 - (5 / newLen) * oppLen;
  near(kf.handleLeft.time, expLeftX, 1e-6, 'aligned mirror: left.time reflected through keyform');
  near(kf.handleLeft.value, expLeftY, 1e-6, 'aligned mirror: left.value reflected through keyform');
  // Length preserved.
  const actualLen = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(actualLen, oppLen, 1e-6, 'aligned mirror: opposite handle length preserved');
}

// Opposite NOT aligned → no mirror.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 10 });
  assert(kf.handleLeft.time === 80 && kf.handleLeft.value === 5, 'no-mirror: opposite untouched when not aligned');
}

// Zero-length newHandle: skip mirror (would divide by ~0).
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 100, value: 5 });
  // Mirror skipped — left preserved.
  assert(kf.handleLeft.time === 80 && kf.handleLeft.value === 5, 'zero-length new: mirror skipped, left preserved');
}

// Zero-length opposite handle: skip mirror (preserved unchanged).
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    handleLeft:  { time: 100, value: 5 },  // zero-length
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleLeft.time === 100 && kf.handleLeft.value === 5, 'zero-length opp: mirror skipped');
}

// Auto + opposite aligned: auto flips, aligned still mirrors against
// the NEW free position.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 10 });
  assert(kf.handleType.right === 'free', 'auto + aligned opp: auto flips to free');
  assert(kf.handleType.left === 'aligned', 'auto + aligned opp: opposite type unchanged');
  // Left should be mirrored against the NEW right position.
  const newLen = Math.sqrt(30 * 30 + 5 * 5);
  const oppLen = 20;
  const expLeftX = 100 - (30 / newLen) * oppLen;
  near(kf.handleLeft.time, expLeftX, 1e-6, 'auto + aligned opp: mirror uses new right');
}

// ── summary ─────────────────────────────────────────────────────────

if (failed === 0) {
  console.log(`PASS ${passed}/${passed} checks`);
  process.exit(0);
} else {
  console.error(`FAIL ${failed}/${passed + failed} checks`);
  process.exit(1);
}
