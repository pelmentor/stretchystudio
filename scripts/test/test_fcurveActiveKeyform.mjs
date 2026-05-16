// Animation Phase 5 Slice 5.H — tests for src/anim/fcurveActiveKeyform.js.
//
// Coverage:
//   - FCURVE_ACTIVE_KEYFORM_NONE sentinel.
//   - getActiveKeyformIndex: sparse-field, OOB, missing-keyforms,
//     non-integer, null/undefined guards.
//   - setActiveKeyform: valid index, out-of-bounds, null-clears,
//     non-integer-clears, sparse-after-clear (no `-1` written),
//     unknown fcurveId no-op, null action guard.
//   - clearActiveKeyform: writes sentinel, removes field.
//   - captureActiveKeyformObject: returns object ref, null when NONE.
//   - relocateActiveKeyformByObject: identity-based remap through
//     sort + merge + delete, null capture is no-op, deleted-obj clears.
//   - remapActiveKeyform: index-based remap (shift, delete-clear,
//     same-idx no-write, missing-active no-op).
//   - Peer isolation: setting active on one fcurve doesn't touch peers.
//
// Run: node scripts/test/test_fcurveActiveKeyform.mjs

import {
  FCURVE_ACTIVE_KEYFORM_NONE,
  getActiveKeyformIndex,
  setActiveKeyform,
  clearActiveKeyform,
  captureActiveKeyformObject,
  relocateActiveKeyformByObject,
  remapActiveKeyform,
} from '../../src/anim/fcurveActiveKeyform.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeKf(t, v) {
  return {
    time: t, value: v,
    handleLeft: { time: t, value: v },
    handleRight: { time: t, value: v },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear', flag: 0,
  };
}

function makeFCurve(id, kfTimes) {
  return {
    id,
    rnaPath: `objects["__params__"].values["${id}"]`,
    keyforms: kfTimes.map((t, i) => makeKf(t, i * 0.1)),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Sentinel

assert(FCURVE_ACTIVE_KEYFORM_NONE === -1, 'sentinel: FCURVE_ACTIVE_KEYFORM_NONE === -1');

// ─────────────────────────────────────────────────────────────────────
// getActiveKeyformIndex — sparse-field + sanity checks

assert(getActiveKeyformIndex(null)      === -1, 'get: null fcurve → NONE');
assert(getActiveKeyformIndex(undefined) === -1, 'get: undefined fcurve → NONE');
assert(getActiveKeyformIndex({})        === -1, 'get: missing field → NONE');
assert(getActiveKeyformIndex({ keyforms: [makeKf(0,0)] }) === -1, 'get: missing index → NONE');

// Missing keyforms array
assert(getActiveKeyformIndex({ activeKeyformIndex: 0 }) === -1, 'get: missing keyforms → NONE');
assert(getActiveKeyformIndex({ activeKeyformIndex: 0, keyforms: null }) === -1, 'get: null keyforms → NONE');

// Non-integer index
assert(getActiveKeyformIndex({ activeKeyformIndex: 1.5, keyforms: [makeKf(0,0), makeKf(1,1)] }) === -1, 'get: float index → NONE');
assert(getActiveKeyformIndex({ activeKeyformIndex: 'foo', keyforms: [makeKf(0,0)] }) === -1, 'get: string index → NONE');
assert(getActiveKeyformIndex({ activeKeyformIndex: NaN, keyforms: [makeKf(0,0)] }) === -1, 'get: NaN index → NONE');

// OOB
assert(getActiveKeyformIndex({ activeKeyformIndex: -1, keyforms: [makeKf(0,0)] }) === -1, 'get: -1 index → NONE');
assert(getActiveKeyformIndex({ activeKeyformIndex: 5, keyforms: [makeKf(0,0), makeKf(1,1)] }) === -1, 'get: OOB index → NONE');
assert(getActiveKeyformIndex({ activeKeyformIndex: 2, keyforms: [makeKf(0,0), makeKf(1,1)] }) === -1, 'get: equal-to-length index → NONE');

// Valid
assert(getActiveKeyformIndex({ activeKeyformIndex: 0, keyforms: [makeKf(0,0), makeKf(1,1)] }) === 0, 'get: valid 0');
assert(getActiveKeyformIndex({ activeKeyformIndex: 1, keyforms: [makeKf(0,0), makeKf(1,1)] }) === 1, 'get: valid 1');

// ─────────────────────────────────────────────────────────────────────
// setActiveKeyform — valid + bounds + clear semantics

{
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  const r = setActiveKeyform(a, 'x', 1);
  assert(r.activeNow === 1,                           'set: returns activeNow=1');
  assert(a.fcurves[0].activeKeyformIndex === 1,       'set: writes index=1');
  assert(getActiveKeyformIndex(a.fcurves[0]) === 1,   'set: round-trips through get');
}

{
  // OOB index → cleared (no `-1` written, sparse field).
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1; // start with something set
  const r = setActiveKeyform(a, 'x', 99);
  assert(r.activeNow === -1,                          'set: OOB→NONE return');
  assert(!('activeKeyformIndex' in a.fcurves[0]),     'set: OOB clears field (no `-1` written, sparse)');
}

{
  // Negative index → cleared.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const r = setActiveKeyform(a, 'x', -5);
  assert(r.activeNow === -1,                          'set: negative→NONE return');
  assert(!('activeKeyformIndex' in a.fcurves[0]),     'set: negative clears field');
}

{
  // Float index → cleared.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const r = setActiveKeyform(a, 'x', 1.7);
  assert(r.activeNow === -1,                          'set: float→NONE return');
  assert(!('activeKeyformIndex' in a.fcurves[0]),     'set: float clears field');
}

{
  // null index → cleared.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const r = setActiveKeyform(a, 'x', null);
  assert(r.activeNow === -1,                          'set: null→NONE return');
  assert(!('activeKeyformIndex' in a.fcurves[0]),     'set: null clears field');
}

{
  // Unknown fcurveId → no-op.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const r = setActiveKeyform(a, 'unknown', 0);
  assert(r.activeNow === -1,                          'set: unknown id→NONE return');
  assert(a.fcurves[0].activeKeyformIndex === 1,       'set: unknown id leaves peer untouched');
}

{
  // Null action → safe no-op.
  const r = setActiveKeyform(null, 'x', 0);
  assert(r.activeNow === -1,                          'set: null action→NONE');
}

{
  // Null fcurves array → safe no-op.
  const r = setActiveKeyform({ fcurves: null }, 'x', 0);
  assert(r.activeNow === -1,                          'set: null fcurves→NONE');
}

// ─────────────────────────────────────────────────────────────────────
// Peer isolation

{
  const a = {
    id: 'A',
    fcurves: [
      makeFCurve('x', [0, 1, 2]),
      makeFCurve('y', [0, 1, 2]),
      makeFCurve('z', [0, 1, 2]),
    ],
  };
  a.fcurves[1].activeKeyformIndex = 2; // y has active=2 pre-existing
  setActiveKeyform(a, 'x', 0);
  assert(a.fcurves[0].activeKeyformIndex === 0,       'peer: x active set');
  assert(a.fcurves[1].activeKeyformIndex === 2,       'peer: y untouched');
  assert(!('activeKeyformIndex' in a.fcurves[2]),     'peer: z untouched (still sparse)');
}

// ─────────────────────────────────────────────────────────────────────
// clearActiveKeyform

{
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 2;
  const r = clearActiveKeyform(a, 'x');
  assert(r.activeNow === -1,                          'clear: NONE return');
  assert(!('activeKeyformIndex' in a.fcurves[0]),     'clear: field removed (sparse)');
}

// ─────────────────────────────────────────────────────────────────────
// captureActiveKeyformObject

{
  const fc = makeFCurve('x', [0, 1, 2]);
  assert(captureActiveKeyformObject(fc) === null,     'capture: no active → null');
  fc.activeKeyformIndex = 1;
  const obj = captureActiveKeyformObject(fc);
  assert(obj === fc.keyforms[1],                      'capture: returns object ref');
  fc.activeKeyformIndex = 99; // OOB
  assert(captureActiveKeyformObject(fc) === null,     'capture: OOB → null (via getActiveKeyformIndex sanity)');
}

// ─────────────────────────────────────────────────────────────────────
// relocateActiveKeyformByObject

{
  // Capture before sort → relocate after sort.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 5, 2])] };
  const fc = a.fcurves[0];
  fc.activeKeyformIndex = 1; // points at time=5
  const captured = captureActiveKeyformObject(fc);
  fc.keyforms.sort((u, v) => u.time - v.time); // now order: [0, 2, 5]
  // Object at time=5 is now at index 2.
  const r = relocateActiveKeyformByObject(a, 'x', captured);
  assert(r.activeNow === 2,                           'relocate sort: active follows obj to idx 2');
  assert(fc.activeKeyformIndex === 2,                 'relocate sort: field updated');
}

{
  // Null capture → no-op.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const r = relocateActiveKeyformByObject(a, 'x', null);
  assert(r.activeNow === -1,                          'relocate null capture: NONE return');
  assert(a.fcurves[0].activeKeyformIndex === 1,       'relocate null capture: no write');
}

{
  // Captured obj removed → cleared.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  const fc = a.fcurves[0];
  fc.activeKeyformIndex = 1;
  const captured = captureActiveKeyformObject(fc);
  // Simulate delete: drop index 1.
  fc.keyforms = fc.keyforms.filter((_, i) => i !== 1);
  const r = relocateActiveKeyformByObject(a, 'x', captured);
  assert(r.activeNow === -1,                          'relocate deleted obj: NONE return');
  assert(!('activeKeyformIndex' in fc),               'relocate deleted obj: field cleared (sparse)');
}

{
  // Unknown fcurveId → no-op.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const captured = a.fcurves[0].keyforms[1];
  const r = relocateActiveKeyformByObject(a, 'nonexistent', captured);
  assert(r.activeNow === -1,                          'relocate unknown id: NONE return');
  assert(a.fcurves[0].activeKeyformIndex === 1,       'relocate unknown id: peer untouched');
}

// ─────────────────────────────────────────────────────────────────────
// remapActiveKeyform

{
  // Shift active idx via remap.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2, 3, 4])] };
  a.fcurves[0].activeKeyformIndex = 3;
  // Remap: idx 1 deleted; idx 0→0, 2→1, 3→2, 4→3.
  const remap = new Map([[0, 0], [1, -1], [2, 1], [3, 2], [4, 3]]);
  const r = remapActiveKeyform(a, 'x', remap);
  assert(r.activeNow === 2,                           'remap shift: active 3→2');
  assert(a.fcurves[0].activeKeyformIndex === 2,       'remap shift: field updated');
}

{
  // Active deleted → cleared.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const remap = new Map([[0, 0], [1, -1], [2, 1]]);
  const r = remapActiveKeyform(a, 'x', remap);
  assert(r.activeNow === -1,                          'remap delete: active cleared');
  assert(!('activeKeyformIndex' in a.fcurves[0]),     'remap delete: field cleared (sparse)');
}

{
  // Same index (no shift) → no-write (idempotent).
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const remap = new Map([[0, 0], [1, 1], [2, 2]]);
  const r = remapActiveKeyform(a, 'x', remap);
  assert(r.activeNow === 1,                           'remap same-idx: return unchanged');
  assert(a.fcurves[0].activeKeyformIndex === 1,       'remap same-idx: field unchanged');
}

{
  // Missing active → no-op (sparse).
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  const remap = new Map([[0, -1]]);
  const r = remapActiveKeyform(a, 'x', remap);
  assert(r.activeNow === -1,                          'remap missing-active: NONE return');
  assert(!('activeKeyformIndex' in a.fcurves[0]),     'remap missing-active: still sparse');
}

{
  // Unknown fcurveId.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  a.fcurves[0].activeKeyformIndex = 1;
  const r = remapActiveKeyform(a, 'nope', new Map());
  assert(r.activeNow === -1,                          'remap unknown id: NONE return');
  assert(a.fcurves[0].activeKeyformIndex === 1,       'remap unknown id: peer untouched');
}

{
  // Null action.
  const r = remapActiveKeyform(null, 'x', new Map());
  assert(r.activeNow === -1,                          'remap null action: NONE');
}

// ─────────────────────────────────────────────────────────────────────
// End-to-end: simulate Blender's "may_activate" pattern + merge tracking

{
  // Click on kf 1 (first time) → active=1.
  // Click on kf 1 again (already-selected, has active) → no-op.
  // Click on kf 2 (was not selected, replace mode) → active=2.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2])] };
  setActiveKeyform(a, 'x', 1);
  assert(getActiveKeyformIndex(a.fcurves[0]) === 1,   'e2e: first click sets active');

  // Simulate sort: kf 1 dragged right past kf 2, post-sort order is [0, kf2, kf1].
  const fc = a.fcurves[0];
  const captured = captureActiveKeyformObject(fc); // captures kf 1
  // Swap to simulate drag-past-neighbor:
  [fc.keyforms[1], fc.keyforms[2]] = [fc.keyforms[2], fc.keyforms[1]];
  relocateActiveKeyformByObject(a, 'x', captured);
  assert(getActiveKeyformIndex(fc) === 2,             'e2e: active follows obj through sort');
}

// ─────────────────────────────────────────────────────────────────────
// Audit-fix HIGH-A2 (Slice 5.H dual-audit 2026-05-16) — verify the
// capture+relocate pattern correctly handles the TimelineEditor delete
// shape (`fc.keyforms = fc.keyforms.filter(...)`).

{
  // Active obj survives filter → index re-points correctly.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2, 3])] };
  const fc = a.fcurves[0];
  fc.activeKeyformIndex = 3; // points at time=3
  const captured = captureActiveKeyformObject(fc);
  // Delete kfs at time=1 and time=2.
  fc.keyforms = fc.keyforms.filter(kf => kf.time !== 1 && kf.time !== 2);
  relocateActiveKeyformByObject(a, 'x', captured);
  assert(fc.activeKeyformIndex === 1,                 'audit-A2: active obj at time=3 now at idx 1');
}

{
  // Active obj deleted → field cleared.
  const a = { id: 'A', fcurves: [makeFCurve('x', [0, 1, 2, 3])] };
  const fc = a.fcurves[0];
  fc.activeKeyformIndex = 2;
  const captured = captureActiveKeyformObject(fc);
  fc.keyforms = fc.keyforms.filter(kf => kf.time !== 2); // delete the active kf
  relocateActiveKeyformByObject(a, 'x', captured);
  assert(!('activeKeyformIndex' in fc),               'audit-A2: deleted active obj clears field');
}

// ─────────────────────────────────────────────────────────────────────
// Audit-fix HIGH-A3 — per-tick sort tracking on Timeline drag.

{
  // Active obj at idx 0 (time=1). Move its time to 3 (past kf[1] at
  // time=2). Sort produces [kf[1], kf[0]]. Relocate finds active at 1.
  const a = { id: 'A', fcurves: [makeFCurve('x', [1, 2])] };
  const fc = a.fcurves[0];
  fc.activeKeyformIndex = 0;
  const captured = captureActiveKeyformObject(fc);
  fc.keyforms[0].time = 3; // simulate drag-past
  fc.keyforms.sort((a, b) => a.time - b.time);
  relocateActiveKeyformByObject(a, 'x', captured);
  assert(fc.activeKeyformIndex === 1,                 'audit-A3: drag-past tracks active to new idx');
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
