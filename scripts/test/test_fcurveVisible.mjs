// Animation Phase 5 Slice 5.I — tests for src/anim/fcurveVisible.js.
//
// Coverage:
//   - isFCurveHidden: sparse-field, strict === true, defensive on truthy
//     non-boolean values (matches isFCurveMuted contract).
//   - toggleFCurveHidden: flips, sparse-default → true, true → false,
//     unknown fcurveId no-op, null action / non-array fcurves guard.
//   - Default = visible (matches Blender's FCURVE_VISIBLE bit set in
//     `BKE_fcurve_create` at `animrig/intern/fcurve.cc:62`).
//   - Per-curve isolation: toggling one fcurve doesn't touch peers' hide
//     or their mute/selected/active sister fields.
//   - Visibility is editor-only: does not touch `mute`, `selected`,
//     `activeKeyformIndex`, or the editor-local keyform-pick map
//     (matches Blender's per-row `ACHANNEL_SETTING_VISIBLE` toggle path,
//     distinct from `deselect_all_fcurves(hide=true)` at
//     `anim_channels_edit.cc:5411-5428`).
//
// Run: node scripts/test/test_fcurveVisible.mjs

import { isFCurveHidden, toggleFCurveHidden } from '../../src/anim/fcurveVisible.js';
import { isFCurveMuted } from '../../src/anim/fcurveMute.js';
import { isFCurveSelected } from '../../src/anim/fcurveChannelSelect.js';
import { getActiveKeyformIndex } from '../../src/anim/fcurveActiveKeyform.js';

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

function makeAction(fcurves) {
  return { id: 'act1', fcurves };
}

// ─────────────────────────────────────────────────────────────────────
// isFCurveHidden — read accessor

assert(isFCurveHidden(null)               === false, 'isFCurveHidden: null → false');
assert(isFCurveHidden(undefined)          === false, 'isFCurveHidden: undefined → false');
assert(isFCurveHidden({})                 === false, 'isFCurveHidden: missing field → false (default visible)');
assert(isFCurveHidden({ hide: false })    === false, 'isFCurveHidden: explicit false → false');
assert(isFCurveHidden({ hide: true })     === true,  'isFCurveHidden: explicit true → true');

// Strict === true — defensive on truthy non-boolean values (mirrors
// isFCurveMuted contract from Slice 5.G)
assert(isFCurveHidden({ hide: 1 })        === false, 'isFCurveHidden: 1 (truthy) → false (strict ===)');
assert(isFCurveHidden({ hide: 'yes' })    === false, 'isFCurveHidden: "yes" → false (strict ===)');
assert(isFCurveHidden({ hide: {} })       === false, 'isFCurveHidden: {} → false (strict ===)');
assert(isFCurveHidden({ hide: 0 })        === false, 'isFCurveHidden: 0 → false');
assert(isFCurveHidden({ hide: null })     === false, 'isFCurveHidden: null → false');

// ─────────────────────────────────────────────────────────────────────
// toggleFCurveHidden — guards

assert(toggleFCurveHidden(null, 'x').hiddenNow === false, 'toggleFCurveHidden: null action → no-op false');
assert(toggleFCurveHidden({}, 'x').hiddenNow === false, 'toggleFCurveHidden: no fcurves → no-op false');
assert(toggleFCurveHidden({ fcurves: null }, 'x').hiddenNow === false, 'toggleFCurveHidden: null fcurves → no-op false');
assert(toggleFCurveHidden(makeAction([makeFCurve('a', [0, 1])]), 'missing').hiddenNow === false, 'toggleFCurveHidden: unknown id → no-op false');

// ─────────────────────────────────────────────────────────────────────
// Default state + first toggle (default → hidden)

{
  const fc = makeFCurve('a', [0, 1]);
  assert(isFCurveHidden(fc) === false, 'default: new fcurve is visible (hide missing)');

  const a = makeAction([fc]);
  const r1 = toggleFCurveHidden(a, 'a');
  assert(r1.hiddenNow === true, 'toggle 1: visible → hidden returns hiddenNow=true');
  assert(fc.hide === true, 'toggle 1: fc.hide === true');
  assert(isFCurveHidden(fc) === true, 'toggle 1: isFCurveHidden(fc) === true');

  const r2 = toggleFCurveHidden(a, 'a');
  assert(r2.hiddenNow === false, 'toggle 2: hidden → visible returns hiddenNow=false');
  assert(fc.hide === false, 'toggle 2: fc.hide === false');
  assert(isFCurveHidden(fc) === false, 'toggle 2: isFCurveHidden(fc) === false');
}

// ─────────────────────────────────────────────────────────────────────
// Per-curve isolation — toggling one fcurve doesn't touch peers

{
  const fcA = makeFCurve('A', [0, 1]);
  const fcB = makeFCurve('B', [0, 1]);
  const fcC = makeFCurve('C', [0, 1]);
  const a = makeAction([fcA, fcB, fcC]);

  toggleFCurveHidden(a, 'B');
  assert(isFCurveHidden(fcA) === false, 'isolation: toggle B leaves A visible');
  assert(isFCurveHidden(fcB) === true,  'isolation: B is hidden');
  assert(isFCurveHidden(fcC) === false, 'isolation: toggle B leaves C visible');
  assert(!('hide' in fcA),              'isolation: A.hide field not written (sparse preserved)');
  assert(!('hide' in fcC),              'isolation: C.hide field not written (sparse preserved)');
}

// ─────────────────────────────────────────────────────────────────────
// Visibility is editor-only — does not touch sister fields
//
// Mirrors Blender's per-row `ACHANNEL_SETTING_VISIBLE` toggle path
// (`anim_channels_edit.cc:3105`'s `ANIM_OT_channels_setting_toggle`)
// which flips ONLY the named flag. The combined `deselect_all_fcurves
// (hide=true)` path at `anim_channels_edit.cc:5411-5428` is a separate
// operator that explicitly clears SELECTED|ACTIVE; SS doesn't expose it.

{
  const fc = makeFCurve('a', [0, 1, 2]);
  fc.mute = true;
  fc.selected = true;
  fc.activeKeyformIndex = 1;
  const a = makeAction([fc]);

  toggleFCurveHidden(a, 'a');
  assert(isFCurveHidden(fc)           === true, 'sister-fields: hide flipped');
  assert(isFCurveMuted(fc)            === true, 'sister-fields: mute preserved');
  assert(isFCurveSelected(fc)         === true, 'sister-fields: selected preserved');
  assert(getActiveKeyformIndex(fc)    === 1,    'sister-fields: activeKeyformIndex preserved');

  toggleFCurveHidden(a, 'a');
  assert(isFCurveHidden(fc)           === false, 'sister-fields: hide flipped back');
  assert(isFCurveMuted(fc)            === true,  'sister-fields: mute STILL preserved on un-hide');
  assert(isFCurveSelected(fc)         === true,  'sister-fields: selected STILL preserved on un-hide');
  assert(getActiveKeyformIndex(fc)    === 1,     'sister-fields: activeKeyformIndex STILL preserved on un-hide');
}

// ─────────────────────────────────────────────────────────────────────
// Multiple toggles per curve

{
  const fc = makeFCurve('a', [0, 1]);
  const a = makeAction([fc]);
  for (let i = 0; i < 5; i++) toggleFCurveHidden(a, 'a');
  // 5 toggles from false → t/f/t/f/t → final hidden
  assert(isFCurveHidden(fc) === true, 'multi-toggle: odd toggles → hidden');
  toggleFCurveHidden(a, 'a');
  assert(isFCurveHidden(fc) === false, 'multi-toggle: even toggles → visible');
}

// ─────────────────────────────────────────────────────────────────────
// Persistence semantic — survives serialization round-trip
//
// The whole point of this slice: the `hide` bit must round-trip through
// JSON. (Sparse-missing → JSON omits → reads back as visible. Explicit
// true → JSON keeps → reads back as hidden.)

{
  const fcVisibleSparse = makeFCurve('v', [0, 1]);
  const fcVisibleExplicit = makeFCurve('ve', [0, 1]);
  fcVisibleExplicit.hide = false;
  const fcHidden = makeFCurve('h', [0, 1]);
  fcHidden.hide = true;

  const action = makeAction([fcVisibleSparse, fcVisibleExplicit, fcHidden]);
  const json = JSON.parse(JSON.stringify(action));

  assert(!('hide' in json.fcurves[0]),       'roundtrip: sparse `hide` is omitted from JSON');
  assert(json.fcurves[1].hide === false,     'roundtrip: explicit false is retained');
  assert(json.fcurves[2].hide === true,      'roundtrip: explicit true is retained');

  assert(isFCurveHidden(json.fcurves[0]) === false, 'roundtrip: sparse reads back visible');
  assert(isFCurveHidden(json.fcurves[1]) === false, 'roundtrip: explicit false reads back visible');
  assert(isFCurveHidden(json.fcurves[2]) === true,  'roundtrip: explicit true reads back hidden');
}

// ─────────────────────────────────────────────────────────────────────
// Filter integration — `visible = decoded.filter(d => !isFCurveHidden(d.fcurve))`
//
// Mirrors `anim_filter.cc:1287-1288`'s `ANIMFILTER_CURVE_VISIBLE` gate.
// SS uses this in FCurveEditor's `visible` memo; smoke-test the shape.

{
  const fcA = makeFCurve('A', [0, 1]);
  const fcB = makeFCurve('B', [0, 1]); fcB.hide = true;
  const fcC = makeFCurve('C', [0, 1]);
  const decoded = [{ fcurve: fcA }, { fcurve: fcB }, { fcurve: fcC }];
  const visible = decoded.filter((d) => !isFCurveHidden(d.fcurve));
  assert(visible.length === 2,                  'filter: hidden curve omitted from visible list');
  assert(visible[0].fcurve.id === 'A',          'filter: A visible at index 0');
  assert(visible[1].fcurve.id === 'C',          'filter: C visible at index 1 (B skipped)');
}

// ─────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
