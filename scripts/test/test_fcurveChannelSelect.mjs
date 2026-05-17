// Animation Phase 5 Slices 5.F + 5.J — tests for src/anim/fcurveChannelSelect.js
//
// Coverage:
//   - applyChannelSelect('replace') clears all + sets clicked + reports
//     makeActive=true (Blender's SELECT_REPLACE, anim_channels_edit.cc:4239-4243)
//   - applyChannelSelect('toggle') xors clicked only; others untouched
//     (Blender's SELECT_INVERT, anim_channels_edit.cc:4231-4234)
//   - Toggle ON sets makeActive=true; toggle OFF sets makeActive=false
//     (Blender's gate at anim_channels_edit.cc:4247: elevate active
//     only when newly selected)
//   - applyChannelSelect('range') walks active→clicked inclusive,
//     pre-wipes everything, never elevates active (Blender's
//     SELECT_EXTEND_RANGE, anim_channels_edit.cc:3984-4025 walker +
//     line 4236 pre-walk + line 4247 active-gate). Auto-downgrades to
//     'toggle' when no eligible active exists (line 4517-4522).
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

// Audit-fix LOW-A1 (Slice 5.F dual-audit): unknown modifier guard.
// Earlier helper fell through to 'toggle'; that would silently mask a
// future 'extend' wiring before its branch exists. Now an explicit
// no-op return is the contract. (Slice 5.J added 'range' to the
// allowlist; renamed the test sentinel to 'unknown-modifier' so it
// won't collide with any future modifier name.)
{
  const a = makeAction(['a']);
  const r = applyChannelSelect(a, 'a', 'unknown-modifier');
  assert(r.makeActive === false && r.selectedNow === false,
    'guard: unknown modifier → no-op');
  assert(a.fcurves[0].selected === undefined || a.fcurves[0].selected === false,
    'guard: unknown modifier doesn\'t mutate selected');
}

{
  const a = makeAction(['a']);
  a.fcurves[0].selected = true;
  const r = applyChannelSelect(a, 'a', '');
  assert(r.makeActive === false && r.selectedNow === false,
    'guard: empty-string modifier → no-op');
  assert(a.fcurves[0].selected === true,        'guard: empty modifier preserves prior state');
}

{
  const a = makeAction(['a']);
  const r = applyChannelSelect(a, 'a', null);
  assert(r.makeActive === false && r.selectedNow === false,
    'guard: null modifier → no-op');
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
// Slice 5.J — applyChannelSelect('range') — SELECT_EXTEND_RANGE
// Mirrors `animchannel_select_range` at
// `anim_channels_edit.cc:3984-4025`; pre-walk clears all per
// `anim_channels_edit.cc:4236` + comment at lines 662-669.

{
  // Active=a, click=c, ordered=[a,b,c]. Range = [a,b,c] inclusive.
  // makeActive=false (line 4247 gate).
  const a = makeAction(['a', 'b', 'c']);
  const r = applyChannelSelect(a, 'c', 'range',
    { activeFCurveId: 'a', orderedIds: ['a', 'b', 'c'] });
  assert(r.makeActive === false,                'range fwd: makeActive=false (line 4247 gate)');
  assert(r.selectedNow === true,                'range fwd: selectedNow=true');
  assert(a.fcurves[0].selected === true,        'range fwd: a selected (bound)');
  assert(a.fcurves[1].selected === true,        'range fwd: b selected (interior)');
  assert(a.fcurves[2].selected === true,        'range fwd: c selected (bound)');
}

{
  // Active=c, click=a (reverse direction). Range = [a,b,c] inclusive.
  // Walker iterates list order: hits a (cursor) → inRange=true; b →
  // inRange; c (active) → inRange=false + early-exit.
  const a = makeAction(['a', 'b', 'c']);
  const r = applyChannelSelect(a, 'a', 'range',
    { activeFCurveId: 'c', orderedIds: ['a', 'b', 'c'] });
  assert(r.makeActive === false,                'range rev: makeActive=false');
  assert(r.selectedNow === true,                'range rev: selectedNow=true');
  assert(a.fcurves[0].selected === true,        'range rev: a selected');
  assert(a.fcurves[1].selected === true,        'range rev: b selected');
  assert(a.fcurves[2].selected === true,        'range rev: c selected');
}

{
  // Single-cell range: active===click. Only that one curve selected
  // (matches Blender's `if (is_active_elem && is_cursor_elem) break;`
  // at line 4017-4021).
  const a = makeAction(['a', 'b', 'c']);
  const r = applyChannelSelect(a, 'b', 'range',
    { activeFCurveId: 'b', orderedIds: ['a', 'b', 'c'] });
  assert(r.selectedNow === true,                'range single: selectedNow=true');
  assert(a.fcurves[0].selected === undefined || a.fcurves[0].selected === false,
    'range single: a NOT selected');
  assert(a.fcurves[1].selected === true,        'range single: b selected');
  assert(a.fcurves[2].selected === undefined || a.fcurves[2].selected === false,
    'range single: c NOT selected');
}

{
  // Pre-walk wipe: pre-existing selections OUTSIDE the range get
  // cleared. Mirrors Blender's `ANIM_anim_channels_select_set(EXTEND_RANGE)`
  // at line 4236 → line 673 sets `selected=false` on every channel
  // before the walker runs.
  const a = makeAction(['a', 'b', 'c', 'd']);
  a.fcurves[0].selected = true; // pre-selected outside upcoming range
  a.fcurves[3].selected = true; // pre-selected outside upcoming range
  const r = applyChannelSelect(a, 'c', 'range',
    { activeFCurveId: 'b', orderedIds: ['a', 'b', 'c', 'd'] });
  assert(r.selectedNow === true,                'range wipe: selectedNow=true');
  assert(a.fcurves[0].selected === false,       'range wipe: a (outside) deselected');
  assert(a.fcurves[1].selected === true,        'range wipe: b (bound) selected');
  assert(a.fcurves[2].selected === true,        'range wipe: c (bound) selected');
  assert(a.fcurves[3].selected === false,       'range wipe: d (outside) deselected');
}

{
  // Audit-fix MED-B1 (Slice 5.J dual-audit): pre-walk wipe scope is the
  // FILTERED visible list, NOT the whole action. Mirrors Blender's
  // `ANIM_anim_channels_select_set(EXTEND_RANGE)` at line 4236 iterating
  // `anim_channels_for_selection(ac)` (the filtered visible list).
  // fcurves filtered out of `decoded` (unresolvable rna_path) keep
  // their `selected` bit on Shift+click range.
  const a = makeAction(['a', 'b', 'c', 'invisible-d']);
  a.fcurves[3].selected = true; // 'invisible-d' was selected via some
                                // other code path (legacy persisted state,
                                // direct mutation, etc.) but `decoded`
                                // filtered it out.
  const r = applyChannelSelect(a, 'c', 'range',
    { activeFCurveId: 'a', orderedIds: ['a', 'b', 'c'] }); // 'invisible-d' NOT in ordered
  assert(r.selectedNow === true,                'range visible-scope: selectedNow=true');
  assert(a.fcurves[0].selected === true,        'range visible-scope: a (bound) selected');
  assert(a.fcurves[1].selected === true,        'range visible-scope: b interior');
  assert(a.fcurves[2].selected === true,        'range visible-scope: c (bound) selected');
  assert(a.fcurves[3].selected === true,        'range visible-scope: invisible-d PRESERVED (not in visible list)');
}

{
  // Audit-fix MED-A2 (Slice 5.J dual-audit): the active bound id is in
  // `orderedIds` but missing from `action.fcurves` — possible if
  // `decoded.map(...)` was computed in a render that saw `action.fcurves`
  // before a delete landed. The `canRange` gate passes (both ids are in
  // orderedIds), the walker runs, and the missing active bound is
  // silently skipped by `if (fc) fc.selected = true`. The cursor bound
  // (which IS in `action.fcurves` — guarded by the earlier `if (!clicked)
  // return`) gets selected. The interior gets selected. `selectedNow:
  // true` matches: the cursor bound IS now selected.
  const a = makeAction(['b', 'c']); // 'a' is NOT in action.fcurves
  const r = applyChannelSelect(a, 'c', 'range',
    { activeFCurveId: 'a', orderedIds: ['a', 'b', 'c'] });
  assert(r.makeActive === false,                'range orphan-active: makeActive=false');
  assert(r.selectedNow === true,                'range orphan-active: selectedNow=true (cursor IS selected)');
  assert(a.fcurves[0].selected === true,        'range orphan-active: b interior selected');
  assert(a.fcurves[1].selected === true,        'range orphan-active: c cursor selected');
}

{
  // Auto-downgrade: no active → falls through to 'toggle' semantics.
  // Per Blender `anim_channels_edit.cc:4517-4522`.
  const a = makeAction(['a', 'b', 'c']);
  a.fcurves[0].selected = true; // pre-selection should survive toggle
  const r = applyChannelSelect(a, 'b', 'range',
    { activeFCurveId: null, orderedIds: ['a', 'b', 'c'] });
  assert(r.makeActive === true,                 'range downgrade null-active: makeActive=true (toggle ON path)');
  assert(r.selectedNow === true,                'range downgrade null-active: selectedNow=true');
  assert(a.fcurves[0].selected === true,        'range downgrade null-active: a stays selected (toggle semantics)');
  assert(a.fcurves[1].selected === true,        'range downgrade null-active: b now selected');
  assert(a.fcurves[2].selected === undefined || a.fcurves[2].selected === false,
    'range downgrade null-active: c untouched');
}

{
  // Auto-downgrade: active is not in orderedIds (e.g. fcurve was
  // hidden-by-decode-filter or deleted). Falls through to toggle.
  const a = makeAction(['a', 'b']);
  const r = applyChannelSelect(a, 'b', 'range',
    { activeFCurveId: 'missing-id', orderedIds: ['a', 'b'] });
  assert(r.makeActive === true,                 'range downgrade orphan-active: makeActive=true');
  assert(a.fcurves[1].selected === true,        'range downgrade orphan-active: b toggled ON');
}

{
  // Auto-downgrade: clicked fcurve isn't in orderedIds. Falls through
  // to toggle (which still finds it in action.fcurves).
  const a = makeAction(['a', 'b', 'c']);
  const r = applyChannelSelect(a, 'c', 'range',
    { activeFCurveId: 'a', orderedIds: ['a', 'b'] }); // c absent from ordered
  assert(r.makeActive === true,                 'range downgrade clicked-not-in-list: makeActive=true');
  assert(a.fcurves[2].selected === true,        'range downgrade clicked-not-in-list: c toggled ON');
}

{
  // Missing ctx → auto-downgrade to toggle.
  const a = makeAction(['a']);
  const r = applyChannelSelect(a, 'a', 'range');
  assert(r.makeActive === true && a.fcurves[0].selected === true,
    'range no-ctx: downgrades to toggle');
}

{
  // Empty orderedIds → downgrade. Even though the helper is technically
  // told "no visible channels", the click came from somewhere, so the
  // safest fallback is toggle (matches Blender's downgrade gate which
  // checks for an active of matching type — if the visible list is
  // empty, no active is findable either).
  const a = makeAction(['a']);
  const r = applyChannelSelect(a, 'a', 'range',
    { activeFCurveId: 'a', orderedIds: [] });
  assert(r.makeActive === true && a.fcurves[0].selected === true,
    'range empty-ordered: downgrades to toggle');
}

{
  // Active is in orderedIds at a position AFTER the clicked element.
  // Walker iterates list order: hits a (cursor) at index 0 →
  // inRange=true; b (interior) → inRange; c → inRange; d (active) at
  // index 3 → inRange=false + early-exit. e past the range → untouched.
  const a = makeAction(['a', 'b', 'c', 'd', 'e']);
  const r = applyChannelSelect(a, 'a', 'range',
    { activeFCurveId: 'd', orderedIds: ['a', 'b', 'c', 'd', 'e'] });
  assert(r.selectedNow === true,                'range 5-channel rev: selectedNow=true');
  assert(a.fcurves[0].selected === true,        'range 5-channel rev: a (cursor) selected');
  assert(a.fcurves[1].selected === true,        'range 5-channel rev: b interior');
  assert(a.fcurves[2].selected === true,        'range 5-channel rev: c interior');
  assert(a.fcurves[3].selected === true,        'range 5-channel rev: d (active) selected');
  assert(a.fcurves[4].selected === undefined || a.fcurves[4].selected === false,
    'range 5-channel rev: e past range NOT selected');
}

{
  // Sister-field preservation: 'range' must NOT touch hide / mute /
  // activeKeyformIndex on selected curves. Editor-only selection bit.
  const a = makeAction(['a', 'b']);
  a.fcurves[0].hide = true;
  a.fcurves[0].mute = true;
  a.fcurves[0].activeKeyformIndex = 2;
  a.fcurves[1].mute = true;
  applyChannelSelect(a, 'b', 'range',
    { activeFCurveId: 'a', orderedIds: ['a', 'b'] });
  assert(a.fcurves[0].hide === true,            'range sister: a.hide preserved');
  assert(a.fcurves[0].mute === true,            'range sister: a.mute preserved');
  assert(a.fcurves[0].activeKeyformIndex === 2, 'range sister: a.activeKeyformIndex preserved');
  assert(a.fcurves[1].mute === true,            'range sister: b.mute preserved');
  assert(a.fcurves[0].selected === true,        'range sister: a.selected set');
  assert(a.fcurves[1].selected === true,        'range sister: b.selected set');
}

{
  // Null entries in orderedIds are tolerated (defensive — the caller
  // is supposed to filter them but the helper shouldn't crash if not).
  const a = makeAction(['a', 'b', 'c']);
  // @ts-ignore - intentionally null entry
  const r = applyChannelSelect(a, 'c', 'range',
    { activeFCurveId: 'a', orderedIds: ['a', null, 'b', 'c'] });
  assert(r.selectedNow === true,                'range null-in-ordered: selectedNow=true');
  assert(a.fcurves[0].selected === true,        'range null-in-ordered: a selected');
  // null entry skipped by byId.get; b still gets selected because it's
  // in the ordered list AFTER null AND we're in range when we hit it.
  assert(a.fcurves[1].selected === true,        'range null-in-ordered: b selected (range continues past null)');
  assert(a.fcurves[2].selected === true,        'range null-in-ordered: c selected (bound)');
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
