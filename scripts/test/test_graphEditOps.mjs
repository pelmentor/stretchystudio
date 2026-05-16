// Animation Phase 5 — tests for src/anim/graphEditOps.js
//
// Audit-fix sweep 2026-05-16: refreshed test suite reflects the Blender
// reference (BKE_nurb_bezt_handle_test, curve.cc:4054-4084 + the HD_ALIGN
// math at curve.cc:3242-3301). Earlier suite tested an SS-invented
// HD_AUTO→HD_FREE conversion + a +1ms time-clamp; both were drift from
// Blender.
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

// ── applyKeyformDrag — pure translation, no clamping ────────────────

// Free drag — value + handles translate by Δ.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 80,  value: 4 },
    handleRight: { time: 120, value: 6 },
  };
  applyKeyformDrag(kf, 100, 5, { time: 80, value: 4 }, { time: 120, value: 6 }, 50, 10);
  assert(kf.time === 150, 'keyform-drag: time += dTime');
  assert(kf.value === 15, 'keyform-drag: value += dValue');
  assert(kf.handleLeft.time === 130 && kf.handleLeft.value === 14, 'keyform-drag: handleLeft rides along');
  assert(kf.handleRight.time === 170 && kf.handleRight.value === 16, 'keyform-drag: handleRight rides along');
}

// Negative Δ — keyform CAN cross past previous neighbour (Blender re-sorts post-tick).
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 90, value: 5 },
    handleRight: { time: 110, value: 5 },
  };
  applyKeyformDrag(kf, 100, 5, { time: 90, value: 5 }, { time: 110, value: 5 }, -120, 0);
  // No clamp — kf.time can go negative-of-prev (or in this case, past 0 entirely).
  assert(kf.time === -20, 'no-clamp: keyform-drag allows time < prev (Blender re-sort behaviour)');
  assert(kf.handleLeft.time === -30, 'no-clamp: handles ride along with the unclamped Δ');
}

// Positive Δ — keyform CAN cross past next neighbour.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 95, value: 5 },
    handleRight: { time: 105, value: 5 },
  };
  applyKeyformDrag(kf, 100, 5, { time: 95, value: 5 }, { time: 105, value: 5 }, 1000, 0);
  assert(kf.time === 1100, 'no-clamp: keyform-drag allows time > next');
}

// Value drag — unrestricted (no value-axis neighbour concept exists).
{
  const kf = { time: 100, value: 5, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 80, value: 4 }, handleRight: { time: 120, value: 6 } };
  applyKeyformDrag(kf, 100, 5, { time: 80, value: 4 }, { time: 120, value: 6 }, 0, 999);
  assert(kf.value === 1004, 'value-drag: unrestricted');
  assert(kf.handleLeft.value === 1003, 'value-drag: handles ride along on value');
}

// Replay semantics — successive calls compute from the ORIG snapshot.
{
  const kf = { time: 100, value: 5, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 80, value: 4 }, handleRight: { time: 120, value: 6 } };
  applyKeyformDrag(kf, 100, 5, { time: 80, value: 4 }, { time: 120, value: 6 }, 10, 2);
  assert(kf.time === 110 && kf.value === 7, 'replay step1');
  applyKeyformDrag(kf, 100, 5, { time: 80, value: 4 }, { time: 120, value: 6 }, 30, 5);
  assert(kf.time === 130 && kf.value === 10, 'replay step2: absolute baseline, not relative');
  assert(kf.handleLeft.time === 110 && kf.handleLeft.value === 9, 'replay step2: handles use orig baseline');
}

// ── applyHandleDrag — HD_AUTO → HD_ALIGN on BOTH sides ──────────────

// Both sides auto: BOTH convert to aligned.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'aligned', 'auto+auto drag right: right flips to aligned');
  assert(kf.handleType.left === 'aligned', 'auto+auto drag right: LEFT also flips to aligned (Blender both-sides rule)');
}

// auto_clamped + auto_clamped: both convert.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto_clamped', right: 'auto_clamped' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'left', { time: 70, value: 3 });
  assert(kf.handleType.left === 'aligned', 'auto_clamped drag: left → aligned');
  assert(kf.handleType.right === 'aligned', 'auto_clamped drag: right → aligned (both sides)');
}

// Only dragged side is auto, opposite is free: BOTH-sides rule says
// only the auto-typed side flips. The free side stays free.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'aligned', 'mixed free+auto drag right: right (was auto) → aligned');
  assert(kf.handleType.left === 'free', 'mixed free+auto drag right: left (was free) stays free');
}

// Opposite is auto, dragged is free: opposite still converts because
// the AUTO side needs to convert to ALIGN so the next recalc doesn't
// override the dragged FREE side.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'left', { time: 70, value: 3 });
  assert(kf.handleType.left === 'free', 'opp-auto drag left (free): left stays free');
  assert(kf.handleType.right === 'aligned', 'opp-auto drag left (free): right (was auto) → aligned');
}

// Free on both sides: no conversion needed.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'free', right: 'free' },
    handleLeft:  { time: 80,  value: 4 },
    handleRight: { time: 120, value: 6 },
  };
  applyHandleDrag(kf, 'left', { time: 60, value: 2 });
  assert(kf.handleType.left === 'free' && kf.handleType.right === 'free', 'free+free: no conversion');
  assert(kf.handleLeft.time === 60 && kf.handleLeft.value === 2, 'free drag: handle updated');
  assert(kf.handleRight.time === 120 && kf.handleRight.value === 6, 'free drag: opposite untouched');
}

// Missing handleType defaults to auto/auto and triggers both-sides conversion.
{
  const kf = {
    time: 100, value: 5,
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'aligned', 'missing handleType: defaults to auto → flips to aligned');
  assert(kf.handleType.left === 'aligned', 'missing handleType: left also flips');
}

// ── applyHandleDrag — HD_VECT → HD_FREE on dragged side only ────────

{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'vector', right: 'vector' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'free', 'vector+vector drag right: right (dragged) → free');
  assert(kf.handleType.left === 'vector', 'vector+vector drag right: left (opposite) stays vector');
}

// HD_VECT side dragged when opposite is HD_AUTO: vector → free on
// dragged side; AUTO side converts to ALIGN (per the both-sides rule).
// Both rules fire independently.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'vector' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'free', 'auto+vector drag right: vector → free on dragged');
  assert(kf.handleType.left === 'aligned', 'auto+vector drag right: opp auto → aligned (both-sides AUTO rule applies because LEFT was auto)');
}

// ── applyHandleDrag — aligned mirror (length preservation) ──────────

// Drag with pre-existing aligned opposite: aligned mirror fires.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    handleLeft:  { time: 80,  value: 5 },  // 20 units left, 0 above
    handleRight: { time: 120, value: 5 },  // 20 units right, 0 above
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 10 });
  // newLen = √(30² + 5²) = √925
  // Reflected left should be at kf - unit_right * oppLen.
  const newLen = Math.sqrt(925);
  const oppLen = 20;
  const expLeftX = 100 - (30 / newLen) * oppLen;
  const expLeftY = 5 - (5 / newLen) * oppLen;
  near(kf.handleLeft.time, expLeftX, 1e-6, 'aligned mirror: left.time reflected');
  near(kf.handleLeft.value, expLeftY, 1e-6, 'aligned mirror: left.value reflected');
  const actualLen = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(actualLen, oppLen, 1e-6, 'aligned mirror: opposite handle length preserved (== Blender len_ratio formula end-state)');
}

// Auto-converted-to-aligned: BOTH sides become aligned, so the mirror
// triggers automatically — verifies the AUTO+ALIGN path produces the
// same user-visible behaviour as the pure-ALIGN path above.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },  // 20 units left
    handleRight: { time: 120, value: 5 },  // 20 units right
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 10 });
  // After step 1: both sides → aligned. After step 3: left mirrors right.
  const newLen = Math.sqrt(925);
  const oppLen = 20;
  const expLeftX = 100 - (30 / newLen) * oppLen;
  near(kf.handleLeft.time, expLeftX, 1e-6, 'AUTO+AUTO drag: triggers mirror via auto-converted aligned');
  assert(kf.handleType.left === 'aligned' && kf.handleType.right === 'aligned', 'AUTO+AUTO drag: end-state has BOTH aligned');
}

// Verify Blender length-equivalence: opposite handle's NEW length
// equals its pre-drag length, regardless of how far the dragged side
// moves. This is the end-behaviour of Blender's `len = len_ratio` /
// `p2_h1 = p2 + len * (p2 - p2_h2)` formula at curve.cc:3266-3282.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    handleLeft:  { time: 70,  value: 5 },  // 30 units left
    handleRight: { time: 105, value: 5 },  // 5 units right
  };
  const preLeftLen = 30;
  applyHandleDrag(kf, 'right', { time: 200, value: 5 });  // big drag
  const postLeftLen = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(postLeftLen, preLeftLen, 1e-6, 'aligned mirror: opposite-length invariant across large drags');
}

// Opposite NOT aligned (no AUTO present) → no mirror.
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

// Zero-length newHandle: mirror skipped.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 100, value: 5 });
  assert(kf.handleLeft.time === 80 && kf.handleLeft.value === 5, 'zero-length new: mirror skipped');
}

// Zero-length opposite handle: mirror skipped.
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

// ── Re-edit cycle: drag → release → drag again ──────────────────────

// First drag converts auto → aligned; second drag from the new pos
// shouldn't re-convert (already aligned), and the mirror still fires.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  // First drag.
  applyHandleDrag(kf, 'right', { time: 140, value: 5 });
  assert(kf.handleType.left === 'aligned' && kf.handleType.right === 'aligned', 'first drag: both → aligned');
  const lengthAfter1 = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(lengthAfter1, 20, 1e-6, 'first drag: left length preserved at 20');
  // Second drag — start from new orig (the post-first-drag state).
  // Mid-session re-edit: the orig snapshot is whatever the editor
  // captured at THIS drag's start, so use the current handleRight.
  const second_origRight = { time: kf.handleRight.time, value: kf.handleRight.value };
  applyHandleDrag(kf, 'right', { time: second_origRight.time + 60, value: 0 });
  assert(kf.handleType.right === 'aligned', 'second drag: already aligned, stays aligned (no re-flip)');
  const lengthAfter2 = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(lengthAfter2, 20, 1e-6, 'second drag: left length STILL preserved at 20 (mirror is idempotent)');
}

// Re-edit a HD_VECT that flipped to HD_FREE: second drag stays free.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'vector', right: 'vector' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'free', 'vector first drag: → free');
  applyHandleDrag(kf, 'right', { time: 140, value: 12 });
  assert(kf.handleType.right === 'free', 'vector second drag: stays free');
  assert(kf.handleRight.time === 140 && kf.handleRight.value === 12, 'second drag: handle updated');
}

// ── summary ─────────────────────────────────────────────────────────

if (failed === 0) {
  console.log(`PASS ${passed}/${passed} checks`);
  process.exit(0);
} else {
  console.error(`FAIL ${failed}/${passed + failed} checks`);
  process.exit(1);
}
