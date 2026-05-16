// Animation Phase 5 — tests for src/anim/graphEditOps.js
//
// Coverage:
//   - Slice 5.B helpers (applyKeyformDrag + applyHandleDrag, audit-fix
//     sweep 2026-05-16): no-clamp grab + replay + HD_AUTO→HD_ALIGN
//     both-sides + HD_VECT→HD_FREE dragged-only + aligned-mirror
//     length-equivalence to Blender's `len_ratio` formula
//     (curve.cc:3242-3301).
//   - Slice 5.C operator-pass helpers (this commit): applyGrab,
//     applyScale, snapKeyformsToFrame, setHandleType, setInterpolation,
//     setExtrapolation, deleteKeyforms, mergeDuplicateTimeKeys,
//     testKeyformHandles, remapSelection. Verified against Blender
//     reference paths cited in graphEditOps.js's JSDoc.
//
// Run: node scripts/test/test_graphEditOps.mjs

import {
  applyKeyformDrag,
  applyHandleDrag,
  applyGrab,
  applyScale,
  applyGrabToKeyform,
  applyScaleToKeyform,
  snapKeyformsToFrame,
  setHandleType,
  setInterpolation,
  setExtrapolation,
  deleteKeyforms,
  mergeDuplicateTimeKeys,
  testKeyformHandles,
  snapshotKeyform,
  remapSelection,
} from '../../src/anim/graphEditOps.js';

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

// ─────────────────────────────────────────────────────────────────────
// Slice 5.B — applyKeyformDrag (pure translation, no clamping)
// ─────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────
// Slice 5.B — applyHandleDrag (HD_AUTO → HD_ALIGN, HD_VECT → HD_FREE)
// ─────────────────────────────────────────────────────────────────────

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

// Opposite is auto, dragged is free.
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

// HD_VECT → HD_FREE on dragged side only.
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

// HD_VECT side dragged when opposite is HD_AUTO.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'vector' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleType.right === 'free', 'auto+vector drag right: vector → free on dragged');
  assert(kf.handleType.left === 'aligned', 'auto+vector drag right: opp auto → aligned (both-sides AUTO rule)');
}

// Aligned mirror with pre-existing aligned opposite.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 10 });
  const newLen = Math.sqrt(925);
  const oppLen = 20;
  const expLeftX = 100 - (30 / newLen) * oppLen;
  const expLeftY = 5 - (5 / newLen) * oppLen;
  near(kf.handleLeft.time, expLeftX, 1e-6, 'aligned mirror: left.time reflected');
  near(kf.handleLeft.value, expLeftY, 1e-6, 'aligned mirror: left.value reflected');
  const actualLen = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(actualLen, oppLen, 1e-6, 'aligned mirror: opposite handle length preserved (== Blender len_ratio formula end-state)');
}

// AUTO+AUTO drag: triggers mirror via auto-converted aligned.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 10 });
  const newLen = Math.sqrt(925);
  const oppLen = 20;
  const expLeftX = 100 - (30 / newLen) * oppLen;
  near(kf.handleLeft.time, expLeftX, 1e-6, 'AUTO+AUTO drag: triggers mirror via auto-converted aligned');
  assert(kf.handleType.left === 'aligned' && kf.handleType.right === 'aligned', 'AUTO+AUTO drag: end-state has BOTH aligned');
}

// Length-invariance across large drags.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'aligned', right: 'free' },
    handleLeft:  { time: 70,  value: 5 },
    handleRight: { time: 105, value: 5 },
  };
  const preLeftLen = 30;
  applyHandleDrag(kf, 'right', { time: 200, value: 5 });
  const postLeftLen = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(postLeftLen, preLeftLen, 1e-6, 'aligned mirror: opposite-length invariant across large drags');
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
    handleLeft:  { time: 100, value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 130, value: 8 });
  assert(kf.handleLeft.time === 100 && kf.handleLeft.value === 5, 'zero-length opp: mirror skipped');
}

// Re-edit cycle: drag → release → drag again.
{
  const kf = {
    time: 100, value: 5,
    handleType: { left: 'auto', right: 'auto' },
    handleLeft:  { time: 80,  value: 5 },
    handleRight: { time: 120, value: 5 },
  };
  applyHandleDrag(kf, 'right', { time: 140, value: 5 });
  assert(kf.handleType.left === 'aligned' && kf.handleType.right === 'aligned', 'first drag: both → aligned');
  const lengthAfter1 = Math.hypot(kf.handleLeft.time - kf.time, kf.handleLeft.value - kf.value);
  near(lengthAfter1, 20, 1e-6, 'first drag: left length preserved at 20');
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

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — testKeyformHandles (Blender BKE_nurb_bezt_handle_test)
//
// Audit-fix HIGH-B1 (2026-05-16) — VECT → FREE keys off the XOR
// between each handle's flag and the centre flag (curve.cc:4074, 4079):
//   left:  !(SEL_F1) != !(SEL_F2)    ↔   parts.left !== parts.center
//   right: !(SEL_F3) != !(SEL_F2)    ↔   parts.right !== parts.center
// The earlier port keyed off (left !== right) which mis-handled the
// "handle moved together with centre" case (no conversion expected)
// and the "centre selected alone" case (both VECT should convert).
// ─────────────────────────────────────────────────────────────────────

// Only-left selected: AUTO → ALIGN both sides.
{
  const kf = { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: false, left: true, right: false });
  assert(kf.handleType.left === 'aligned' && kf.handleType.right === 'aligned', 'testHandles: only-left selected, AUTO → ALIGN both');
}

// Only-right selected, opposite VECT: AUTO → ALIGN both; left VECT
// untouched (the LEFT handle's XOR with centre is false === false; no
// VECT→FREE fires on a handle that "agrees" with centre).
{
  const kf = { time: 100, value: 5, handleType: { left: 'vector', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: false, left: false, right: true });
  assert(kf.handleType.right === 'aligned', 'testHandles: only-right + right was auto → aligned');
  assert(kf.handleType.left === 'vector', 'testHandles: only-right + left was vector → stays vector (left XOR centre = false)');
}

// Selected-side VECT: VECT → FREE on dragged side only.
{
  const kf = { time: 100, value: 5, handleType: { left: 'vector', right: 'vector' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: false, left: true, right: false });
  assert(kf.handleType.left === 'free', 'testHandles: only-left VECT → FREE on left');
  assert(kf.handleType.right === 'vector', 'testHandles: only-left VECT → opposite untouched (right XOR centre = false)');
}

// Both handles selected (no center): PARTIAL selection per Blender;
// AUTO → ALIGN both sides fires. VECT → FREE: left XOR centre =
// true !== false = true → free. right XOR centre = true !== false =
// true → free. (Audit-fix HIGH-B1 — old SS port bailed on
// `flag1 === flag2`; that was wrong.)
{
  const kf = { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: false, left: true, right: true });
  assert(kf.handleType.left === 'aligned' && kf.handleType.right === 'aligned', 'testHandles: both-handles no-centre → partial → AUTO → ALIGN both (Blender XOR with centre)');
}
{
  const kf = { time: 100, value: 5, handleType: { left: 'vector', right: 'vector' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: false, left: true, right: true });
  assert(kf.handleType.left === 'free' && kf.handleType.right === 'free', 'testHandles: both-handles no-centre VECT → BOTH free (each handle XOR centre is true)');
}

// Center selected alone (rare but reachable via box-select hitting
// just the diamond): PARTIAL selection. AUTO → ALIGN both. Each
// handle's XOR with centre is false !== true = true → VECT → FREE.
{
  const kf = { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: true, left: false, right: false });
  assert(kf.handleType.left === 'aligned' && kf.handleType.right === 'aligned', 'testHandles: centre-only → AUTO → ALIGN both');
}
{
  const kf = { time: 100, value: 5, handleType: { left: 'vector', right: 'vector' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: true, left: false, right: false });
  assert(kf.handleType.left === 'free' && kf.handleType.right === 'free', 'testHandles: centre-only VECT → both free (handle XOR centre = true)');
}

// All three selected (centre + both handles, e.g. click-on-centre):
// no-op. flag == SEL_F1|SEL_F2|SEL_F3 trips Blender's "all selected"
// guard at curve.cc:4065.
{
  const kf = { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: true, left: true, right: true });
  assert(kf.handleType.left === 'auto' && kf.handleType.right === 'auto', 'testHandles: all-three selected → no conversion (Blender all-selected guard)');
}

// Nothing selected: no-op (flag === 0).
{
  const kf = { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: false, left: false, right: false });
  assert(kf.handleType.left === 'auto' && kf.handleType.right === 'auto', 'testHandles: nothing selected → no conversion (Blender nothing-selected guard)');
}

// Centre + one handle (e.g. centre+right both selected):
// PARTIAL. AUTO → ALIGN both. VECT → FREE: left XOR centre = false !== true = true → free.
// right XOR centre = true !== true = false → STAYS vector.
{
  const kf = { time: 100, value: 5, handleType: { left: 'vector', right: 'vector' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  testKeyformHandles(kf, { center: true, left: false, right: true });
  assert(kf.handleType.left === 'free', 'testHandles: centre+right VECT → left flips (left XOR centre = true)');
  assert(kf.handleType.right === 'vector', 'testHandles: centre+right VECT → right stays (right XOR centre = false; rode along with centre)');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — applyGrabToKeyform / applyGrab
// ─────────────────────────────────────────────────────────────────────

// Center grab: handles ride along.
{
  const kf = { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  const orig = snapshotKeyform(kf);
  applyGrabToKeyform(kf, { center: true, left: false, right: false }, orig, 50, 10);
  assert(kf.time === 150 && kf.value === 15, 'grabToKeyform center: kf moves by Δ');
  assert(kf.handleLeft.time === 130 && kf.handleLeft.value === 15, 'grabToKeyform center: handleLeft rides along');
  assert(kf.handleRight.time === 170 && kf.handleRight.value === 15, 'grabToKeyform center: handleRight rides along');
}

// Only-left grab: only left handle moves; center + right untouched.
{
  const kf = { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } };
  const orig = snapshotKeyform(kf);
  applyGrabToKeyform(kf, { center: false, left: true, right: false }, orig, 10, 2);
  assert(kf.time === 100 && kf.value === 5, 'grabToKeyform left-only: center untouched');
  assert(kf.handleLeft.time === 90 && kf.handleLeft.value === 7, 'grabToKeyform left-only: only left moved');
  assert(kf.handleRight.time === 120 && kf.handleRight.value === 5, 'grabToKeyform left-only: right untouched');
}

// applyGrab over an FCurve.
{
  const fc = {
    keyforms: [
      { time: 0,   value: 0, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: -20, value: 0 }, handleRight: { time: 20, value: 0 } },
      { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } },
      { time: 200, value: 0, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 180, value: 0 }, handleRight: { time: 220, value: 0 } },
    ],
  };
  const origins = new Map();
  origins.set(1, snapshotKeyform(fc.keyforms[1]));
  const selection = new Map([[1, { center: true, left: false, right: false }]]);
  applyGrab(fc, selection, origins, 30, -2);
  assert(fc.keyforms[1].time === 130 && fc.keyforms[1].value === 3, 'applyGrab center: kf moved');
  assert(fc.keyforms[0].time === 0 && fc.keyforms[2].time === 200, 'applyGrab: unselected entries untouched');
}

// applyGrab with only-left selection runs testKeyformHandles → AUTO → ALIGN.
{
  const fc = {
    keyforms: [
      { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } },
    ],
  };
  const origins = new Map([[0, snapshotKeyform(fc.keyforms[0])]]);
  applyGrab(fc, new Map([[0, { center: false, left: true, right: false }]]), origins, 5, 1);
  assert(fc.keyforms[0].handleLeft.time === 85 && fc.keyforms[0].handleLeft.value === 6, 'applyGrab left-only: handle moved');
  assert(fc.keyforms[0].handleType.left === 'aligned' && fc.keyforms[0].handleType.right === 'aligned', 'applyGrab left-only: testHandles fires → AUTO → ALIGN both');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — applyScaleToKeyform / applyScale
// ─────────────────────────────────────────────────────────────────────

// Center scale around pivot.
{
  const kf = { time: 200, value: 10, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 180, value: 10 }, handleRight: { time: 220, value: 10 } };
  const orig = snapshotKeyform(kf);
  applyScaleToKeyform(kf, { center: true, left: false, right: false }, orig, { time: 100, value: 0 }, 0.5, 2);
  assert(kf.time === 150, 'scaleToKeyform center: time = pivot + sX*(orig - pivot) = 100 + 0.5*100');
  assert(kf.value === 20, 'scaleToKeyform center: value = pivot + sY*(orig - pivot) = 0 + 2*10');
  assert(kf.handleLeft.time === 140, 'scaleToKeyform center: left handle time scaled around pivot');
  assert(kf.handleRight.time === 160, 'scaleToKeyform center: right handle time scaled around pivot');
}

// Only-handle scale: center untouched.
{
  const kf = { time: 200, value: 10, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 180, value: 10 }, handleRight: { time: 220, value: 10 } };
  const orig = snapshotKeyform(kf);
  applyScaleToKeyform(kf, { center: false, left: true, right: false }, orig, { time: 100, value: 0 }, 0.5, 2);
  assert(kf.time === 200 && kf.value === 10, 'scaleToKeyform left-only: center untouched');
  assert(kf.handleLeft.time === 140 && kf.handleLeft.value === 20, 'scaleToKeyform left-only: only left scaled');
  assert(kf.handleRight.time === 220 && kf.handleRight.value === 10, 'scaleToKeyform left-only: right untouched');
}

// applyScale over a curve with mixed selection.
{
  const fc = {
    keyforms: [
      { time: 0,   value: 0, handleType: { left: 'free', right: 'free' }, handleLeft: { time: -10, value: 0 }, handleRight: { time: 10, value: 0 } },
      { time: 100, value: 5, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 80, value: 5 }, handleRight: { time: 120, value: 5 } },
      { time: 200, value: 0, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 180, value: 0 }, handleRight: { time: 220, value: 0 } },
    ],
  };
  const origins = new Map([
    [0, snapshotKeyform(fc.keyforms[0])],
    [2, snapshotKeyform(fc.keyforms[2])],
  ]);
  const sel = new Map([
    [0, { center: true, left: false, right: false }],
    [2, { center: true, left: false, right: false }],
  ]);
  applyScale(fc, sel, origins, { time: 100, value: 0 }, 2, 1);
  assert(fc.keyforms[0].time === -100, 'applyScale: kf 0 expanded to -100');
  assert(fc.keyforms[2].time === 300, 'applyScale: kf 2 expanded to 300');
  assert(fc.keyforms[1].time === 100, 'applyScale: unselected kf 1 untouched');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — snapKeyformsToFrame
// ─────────────────────────────────────────────────────────────────────

// Center snap rounds time + handles ride along.
{
  const kf = { time: 41.7, value: 0, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 30, value: 0 }, handleRight: { time: 50, value: 0 } };
  const fc = { keyforms: [kf] };
  // 24 fps → 1000/24 = 41.667 ms/frame. Frame 1 = 41.667 ms; rounding 41.7 → frame 1 → 41.667.
  snapKeyformsToFrame(fc, new Map([[0, { center: true, left: false, right: false }]]), 1000 / 24);
  near(kf.time, 1000 / 24, 1e-6, 'snap center: time snapped to nearest 24fps frame');
  near(kf.handleLeft.time, 30 + (1000 / 24 - 41.7), 1e-6, 'snap center: left handle rides along by Δ');
  near(kf.handleRight.time, 50 + (1000 / 24 - 41.7), 1e-6, 'snap center: right handle rides along');
}

// Only-handle snap: handle snaps independently; center untouched.
{
  const kf = { time: 100, value: 0, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 38, value: 0 }, handleRight: { time: 120, value: 0 } };
  const fc = { keyforms: [kf] };
  snapKeyformsToFrame(fc, new Map([[0, { center: false, left: true, right: false }]]), 1000 / 24);
  near(kf.handleLeft.time, 1000 / 24, 1e-6, 'snap left-only: left handle snapped to frame 1');
  assert(kf.time === 100 && kf.handleRight.time === 120, 'snap left-only: center + right untouched');
}

// snapKeyformsToFrame with msPerFrame <= 0 is a no-op (defensive).
{
  const kf = { time: 41.7, value: 0, handleType: { left: 'free', right: 'free' }, handleLeft: { time: 30, value: 0 }, handleRight: { time: 50, value: 0 } };
  const fc = { keyforms: [kf] };
  snapKeyformsToFrame(fc, new Map([[0, { center: true, left: false, right: false }]]), 0);
  assert(kf.time === 41.7, 'snap msPerFrame=0: no-op');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — setHandleType
// ─────────────────────────────────────────────────────────────────────

{
  const fc = {
    keyforms: [
      { time: 0,   value: 0, handleType: { left: 'auto', right: 'auto' }, handleLeft: {time:0,value:0}, handleRight: {time:0,value:0} },
      { time: 100, value: 5, handleType: { left: 'auto', right: 'auto' }, handleLeft: {time:0,value:0}, handleRight: {time:0,value:0} },
      { time: 200, value: 0, handleType: { left: 'auto', right: 'auto' }, handleLeft: {time:0,value:0}, handleRight: {time:0,value:0} },
    ],
  };
  const sel = new Map([
    [0, { center: true, left: false, right: false }],
    [2, { center: true, left: false, right: false }],
  ]);
  setHandleType(fc, sel, 'vector', 'both');
  assert(fc.keyforms[0].handleType.left === 'vector' && fc.keyforms[0].handleType.right === 'vector', 'setHandleType both: kf 0 both sides → vector');
  assert(fc.keyforms[2].handleType.left === 'vector', 'setHandleType both: kf 2 left → vector');
  assert(fc.keyforms[1].handleType.left === 'auto', 'setHandleType: unselected kf untouched');
}

{
  const fc = {
    keyforms: [{ time: 0, value: 0, handleType: { left: 'auto', right: 'auto' }, handleLeft: {time:0,value:0}, handleRight: {time:0,value:0} }],
  };
  setHandleType(fc, new Map([[0, { center: true, left: false, right: false }]]), 'free', 'left');
  assert(fc.keyforms[0].handleType.left === 'free', 'setHandleType left: left side flipped');
  assert(fc.keyforms[0].handleType.right === 'auto', 'setHandleType left: right side untouched');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — setInterpolation / setExtrapolation
// ─────────────────────────────────────────────────────────────────────

{
  const fc = {
    keyforms: [
      { time: 0,   value: 0, interpolation: 'bezier', handleType: { left: 'auto', right: 'auto' }, handleLeft: {time:0,value:0}, handleRight: {time:0,value:0} },
      { time: 100, value: 5, interpolation: 'bezier', handleType: { left: 'auto', right: 'auto' }, handleLeft: {time:0,value:0}, handleRight: {time:0,value:0} },
      { time: 200, value: 0, interpolation: 'bezier', handleType: { left: 'auto', right: 'auto' }, handleLeft: {time:0,value:0}, handleRight: {time:0,value:0} },
    ],
  };
  setInterpolation(fc, new Map([[1, { center: true, left: false, right: false }]]), 'linear');
  assert(fc.keyforms[1].interpolation === 'linear', 'setInterpolation: kf 1 → linear');
  assert(fc.keyforms[0].interpolation === 'bezier' && fc.keyforms[2].interpolation === 'bezier', 'setInterpolation: unselected kfs untouched');
}

{
  const fc = { keyforms: [], extrapolation: 'constant' };
  setExtrapolation(fc, 'linear');
  assert(fc.extrapolation === 'linear', 'setExtrapolation: per-FCurve field flipped');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — deleteKeyforms + remapSelection
// ─────────────────────────────────────────────────────────────────────

{
  const fc = {
    keyforms: [
      { time: 0,   value: 0, handleType: { left:'auto', right:'auto' }, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100, value: 5, handleType: { left:'auto', right:'auto' }, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 200, value: 0, handleType: { left:'auto', right:'auto' }, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 300, value: 5, handleType: { left:'auto', right:'auto' }, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
    ],
  };
  const sel = new Map([
    [1, { center: true, left: false, right: false }],
    [3, { center: true, left: false, right: false }],
  ]);
  const remap = deleteKeyforms(fc, sel);
  assert(fc.keyforms.length === 2, 'deleteKeyforms: array shrunk to 2');
  assert(fc.keyforms[0].time === 0 && fc.keyforms[1].time === 200, 'deleteKeyforms: surviving entries in correct order');
  assert(remap.get(0) === 0, 'deleteKeyforms remap: kf 0 → 0');
  assert(remap.get(1) === -1, 'deleteKeyforms remap: kf 1 deleted');
  assert(remap.get(2) === 1, 'deleteKeyforms remap: kf 2 → 1');
  assert(remap.get(3) === -1, 'deleteKeyforms remap: kf 3 deleted');
}

// Handle-only selection: deleteKeyforms LEAVES the kf (Blender's delete
// operator removes whole keyframes, not handles).
{
  const fc = {
    keyforms: [
      { time: 100, value: 5, handleType: { left:'auto', right:'auto' }, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
    ],
  };
  const sel = new Map([[0, { center: false, left: true, right: false }]]);
  deleteKeyforms(fc, sel);
  assert(fc.keyforms.length === 1, 'deleteKeyforms: handle-only selection does NOT delete the kf');
}

// remapSelection drops -1 entries.
{
  const sel = new Map([
    [0, { center: true, left: false, right: false }],
    [1, { center: false, left: true, right: false }],
    [2, { center: true, left: true, right: true }],
  ]);
  const remap = new Map([
    [0, 0],
    [1, -1],
    [2, 1],
  ]);
  const next = remapSelection(sel, remap);
  assert(next.size === 2, 'remapSelection: deleted entry dropped');
  assert(next.has(0) && next.get(0).center === true, 'remapSelection: kf 0 preserved');
  assert(next.has(1) && next.get(1).right === true, 'remapSelection: kf 2 → 1 with per-part flags intact');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.C — mergeDuplicateTimeKeys (Blender BKE_fcurve_merge_duplicate_keys)
// ─────────────────────────────────────────────────────────────────────

// Single cluster of 3 identical-time selected kfs: averaged into FIRST
// (audit-fix HIGH-B3 — Blender's reverse-sweep keeps the LOWEST-index
// selected entry, fcurve.cc:1869-1899).
{
  const fc = {
    keyforms: [
      { time: 0,   value: 0, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100, value: 1, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100, value: 5, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100, value: 9, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 200, value: 0, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
    ],
  };
  const sel = new Map([
    [1, { center: true, left: false, right: false }],
    [2, { center: true, left: false, right: false }],
    [3, { center: true, left: false, right: false }],
  ]);
  const remap = mergeDuplicateTimeKeys(fc, sel, 0.5);
  assert(fc.keyforms.length === 3, 'merge: 3 duplicates collapsed to 1; total 5 → 3');
  assert(fc.keyforms[1].time === 100, 'merge: surviving kf at time 100');
  assert(fc.keyforms[1].value === 5, 'merge: surviving value is average (1+5+9)/3 = 5');
  assert(remap.get(0) === 0 && remap.get(4) === 2, 'merge: kfs outside cluster remap correctly');
  assert(remap.get(1) === 1, 'merge HIGH-B3: FIRST selected entry survives at remapped index 1 (Blender reverse-sweep semantics)');
  assert(remap.get(2) === -1 && remap.get(3) === -1, 'merge HIGH-B3: later selected entries marked deleted');
}

// Cluster with mix of selected + unselected: unselected always deleted; selected averaged.
{
  const fc = {
    keyforms: [
      { time: 100, value: 1, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100, value: 7, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100, value: 3, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
    ],
  };
  // Only kf 2 is selected.
  const sel = new Map([[2, { center: true, left: false, right: false }]]);
  mergeDuplicateTimeKeys(fc, sel, 0.5);
  assert(fc.keyforms.length === 1, 'merge mixed: unselected duplicates deleted, 1 survivor');
  assert(fc.keyforms[0].value === 3, 'merge mixed: surviving value is the (single) selected kf — no averaging');
}

// Cluster with NO selected: no-op.
{
  const fc = {
    keyforms: [
      { time: 100, value: 1, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100, value: 7, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
    ],
  };
  mergeDuplicateTimeKeys(fc, new Map(), 0.5);
  assert(fc.keyforms.length === 2, 'merge no-sel: cluster preserved (Blender semantics — unselected-only clusters left alone)');
}

// Empty fcurve: no-op.
{
  const fc = { keyforms: [] };
  const remap = mergeDuplicateTimeKeys(fc, new Map(), 0.5);
  assert(fc.keyforms.length === 0 && remap.size === 0, 'merge empty: no-op');
}

// Tolerance: |t1 - t2| ≤ epsMs counts as duplicate.
{
  const fc = {
    keyforms: [
      { time: 100,    value: 1, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 100.3,  value: 5, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
    ],
  };
  const sel = new Map([
    [0, { center: true, left: false, right: false }],
    [1, { center: true, left: false, right: false }],
  ]);
  mergeDuplicateTimeKeys(fc, sel, 0.5);
  assert(fc.keyforms.length === 1, 'merge tolerance: 0.3 ms gap collapses under 0.5 ms eps');
  assert(fc.keyforms[0].value === 3, 'merge tolerance: averaged = (1+5)/2 = 3');
}

// Tolerance: |t1 - t2| > epsMs does NOT collapse.
{
  const fc = {
    keyforms: [
      { time: 100, value: 1, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
      { time: 101, value: 5, handleType: {left:'free',right:'free'}, handleLeft:{time:0,value:0}, handleRight:{time:0,value:0} },
    ],
  };
  const sel = new Map([
    [0, { center: true, left: false, right: false }],
    [1, { center: true, left: false, right: false }],
  ]);
  mergeDuplicateTimeKeys(fc, sel, 0.5);
  assert(fc.keyforms.length === 2, 'merge tolerance: 1 ms gap > 0.5 ms eps → both preserved');
}

// ─────────────────────────────────────────────────────────────────────
// summary
// ─────────────────────────────────────────────────────────────────────

if (failed === 0) {
  console.log(`PASS ${passed}/${passed} checks`);
  process.exit(0);
} else {
  console.error(`FAIL ${failed}/${passed + failed} checks`);
  process.exit(1);
}
