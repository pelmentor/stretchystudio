// Animation Phase 5 Slice 5.F — tests for src/anim/fcurveChannelSelect.js
//
// Coverage:
//   - applyChannelSelect('replace') clears all + sets clicked + reports
//     makeActive=true (Blender's SELECT_REPLACE, anim_channels_edit.cc:4239-4243)
//   - applyChannelSelect('toggle') xors clicked only; others untouched
//     (Blender's SELECT_INVERT, anim_channels_edit.cc:4231-4234)
//   - Toggle ON sets makeActive=true; toggle OFF sets makeActive=false
//     (Blender's gate at anim_channels_edit.cc:4247: elevate active
//     only when newly selected)
//   - Null/empty/unknown-id guards
//   - isFCurveSelected treats missing/false/true correctly
//   - Sparse-field invariant: a fresh fcurve with no `selected` field
//     loads as not-selected.
//
// Run: node scripts/test/test_fcurveChannelSelect.mjs

import {
  applyChannelSelect,
  isFCurveSelected,
} from '../../src/anim/fcurveChannelSelect.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeAction(ids) {
  return {
    id: 'A',
    fcurves: ids.map((id) => ({ id, keyforms: [] })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// isFCurveSelected — sparse-field invariant

assert(isFCurveSelected({ selected: true })  === true,  'isFCurveSelected: true');
assert(isFCurveSelected({ selected: false }) === false, 'isFCurveSelected: false');
assert(isFCurveSelected({})                  === false, 'isFCurveSelected: missing → false');
assert(isFCurveSelected(null)                === false, 'isFCurveSelected: null');
assert(isFCurveSelected(undefined)           === false, 'isFCurveSelected: undefined');
// Truthy-but-not-true does NOT count (defensive against accidental writes
// of 1 / "yes" / non-boolean values that aren't part of the contract).
assert(isFCurveSelected({ selected: 1 })     === false, 'isFCurveSelected: 1 (truthy) → false');
assert(isFCurveSelected({ selected: 'yes' }) === false, 'isFCurveSelected: "yes" → false');

// ─────────────────────────────────────────────────────────────────────
// applyChannelSelect('replace') — SELECT_REPLACE
// anim_channels_edit.cc:4239-4243

{
  const a = makeAction(['a', 'b', 'c']);
  // Pre: nothing selected (sparse, missing field treated as false).
  const r = applyChannelSelect(a, 'b', 'replace');
  assert(r.makeActive === true,                 'replace: makeActive=true');
  assert(r.selectedNow === true,                'replace: selectedNow=true');
  // Sparse-field: helper doesn't write `selected:false` on curves that
  // were already not-selected (keeps JSON minimal). Reader (isFCurveSelected)
  // treats missing-vs-false identically.
  assert(!isFCurveSelected(a.fcurves[0]),       'replace: a not selected');
  assert(a.fcurves[1].selected === true,        'replace: b.selected=true');
  assert(!isFCurveSelected(a.fcurves[2]),       'replace: c not selected');
}

{
  // Pre: a + c already selected. Plain click on b should clear them.
  const a = makeAction(['a', 'b', 'c']);
  a.fcurves[0].selected = true;
  a.fcurves[2].selected = true;
  const r = applyChannelSelect(a, 'b', 'replace');
  assert(r.makeActive === true,                 'replace clear: makeActive=true');
  assert(a.fcurves[0].selected === false,       'replace clear: a.selected=false');
  assert(a.fcurves[1].selected === true,        'replace clear: b.selected=true');
  assert(a.fcurves[2].selected === false,       'replace clear: c.selected=false');
}

{
  // Plain click on already-selected curve: stays selected, active set.
  const a = makeAction(['a', 'b']);
  a.fcurves[1].selected = true;
  const r = applyChannelSelect(a, 'b', 'replace');
  assert(r.makeActive === true,                 'replace already-selected: makeActive=true');
  assert(a.fcurves[1].selected === true,        'replace already-selected: stays selected');
  // Sparse-field: peer `a` had no `selected` field set before, helper
  // doesn't write `false` onto it. Reader-equivalence to false is enough.
  assert(!isFCurveSelected(a.fcurves[0]),       'replace already-selected: peer not selected');
}

// ─────────────────────────────────────────────────────────────────────
// applyChannelSelect('toggle') — SELECT_INVERT
// anim_channels_edit.cc:4231-4234 + active gate at :4247

{
  // Toggle ON (was not selected): selectedNow=true, makeActive=true.
  // Others untouched.
  const a = makeAction(['a', 'b', 'c']);
  a.fcurves[0].selected = true; // pre-existing selection on a
  const r = applyChannelSelect(a, 'b', 'toggle');
  assert(r.makeActive === true,                 'toggle ON: makeActive=true');
  assert(r.selectedNow === true,                'toggle ON: selectedNow=true');
  assert(a.fcurves[0].selected === true,        'toggle ON: a stays selected');
  assert(a.fcurves[1].selected === true,        'toggle ON: b now selected');
  assert(a.fcurves[2].selected === false || a.fcurves[2].selected === undefined,
    'toggle ON: c untouched (still false/missing)');
}

{
  // Toggle OFF (was selected): selectedNow=false, makeActive=false.
  // Blender line 4247: active stays whatever it was — toggle-off
  // doesn't deselect the active concept.
  const a = makeAction(['a', 'b']);
  a.fcurves[0].selected = true;
  a.fcurves[1].selected = true;
  const r = applyChannelSelect(a, 'b', 'toggle');
  assert(r.makeActive === false,                'toggle OFF: makeActive=false');
  assert(r.selectedNow === false,               'toggle OFF: selectedNow=false');
  assert(a.fcurves[0].selected === true,        'toggle OFF: a stays selected');
  assert(a.fcurves[1].selected === false,       'toggle OFF: b now deselected');
}

{
  // Toggle on a sparse-field curve (no `selected` key) → ON.
  const a = makeAction(['a']);
  const r = applyChannelSelect(a, 'a', 'toggle');
  assert(r.makeActive === true,                 'toggle sparse→ON: makeActive=true');
  assert(a.fcurves[0].selected === true,        'toggle sparse→ON: a selected');
}

// ─────────────────────────────────────────────────────────────────────
// Guards

{
  const r = applyChannelSelect(null, 'a', 'replace');
  assert(r.makeActive === false && r.selectedNow === false, 'guard: null action');
}

{
  const r = applyChannelSelect({ fcurves: null }, 'a', 'replace');
  assert(r.makeActive === false && r.selectedNow === false, 'guard: null fcurves array');
}

{
  const a = makeAction(['a']);
  const r = applyChannelSelect(a, 'nonexistent', 'replace');
  assert(r.makeActive === false && r.selectedNow === false, 'guard: unknown fcurveId');
  // Other curves untouched.
  assert(a.fcurves[0].selected === undefined || a.fcurves[0].selected === false,
    'guard: untouched peer');
}

{
  // Null entries in the fcurves array should be tolerated.
  const a = { id: 'A', fcurves: [null, { id: 'b' }, null] };
  const r = applyChannelSelect(a, 'b', 'replace');
  assert(r.makeActive === true,                 'guard: null fcurves entry tolerated');
  assert(a.fcurves[1].selected === true,        'guard: b still selected');
}

// ─────────────────────────────────────────────────────────────────────
// Multi-step scenarios — Blender-style user flows

{
  // User clicks a, then Shift-clicks b, then Shift-clicks c.
  // All three should end up selected.
  const a = makeAction(['a', 'b', 'c']);
  applyChannelSelect(a, 'a', 'replace');
  applyChannelSelect(a, 'b', 'toggle');
  applyChannelSelect(a, 'c', 'toggle');
  assert(a.fcurves[0].selected === true,        'multi: a selected');
  assert(a.fcurves[1].selected === true,        'multi: b selected');
  assert(a.fcurves[2].selected === true,        'multi: c selected');
}

{
  // User has {a, b, c} all selected. Plain-clicks b. Only b survives.
  const a = makeAction(['a', 'b', 'c']);
  for (const fc of a.fcurves) fc.selected = true;
  const r = applyChannelSelect(a, 'b', 'replace');
  assert(r.makeActive === true,                 'collapse: makeActive=true');
  assert(a.fcurves[0].selected === false,       'collapse: a cleared');
  assert(a.fcurves[1].selected === true,        'collapse: b kept');
  assert(a.fcurves[2].selected === false,       'collapse: c cleared');
}

{
  // User Shift-clicks the same curve twice → ends up deselected.
  const a = makeAction(['a']);
  const r1 = applyChannelSelect(a, 'a', 'toggle');
  assert(r1.makeActive === true && a.fcurves[0].selected === true, 'double-toggle: first ON');
  const r2 = applyChannelSelect(a, 'a', 'toggle');
  assert(r2.makeActive === false && a.fcurves[0].selected === false, 'double-toggle: second OFF');
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
