// Animation Phase 5 Slices 5.F + 5.J + 5.K — tests for src/anim/fcurveChannelSelect.js
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
  applyChannelSelectAll,
  applyChannelDeleteSelected,
  wouldChannelDeleteSelectedChange,
  isFCurveSelected,
  applyGroupChildrenSelect,
  wouldGroupChildrenSelectChange,
} from '../../src/anim/fcurveChannelSelect.js';
import {
  clearActiveFCurves,
  isFCurveActive,
} from '../../src/anim/fcurveActive.js';

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
// Slice 5.K — applyChannelSelectAll(action, mode, ctx)
// Ports ANIM_OT_channels_select_all (anim_channels_edit.cc:3521-3554).
// Modes: toggle/add/clear/invert; scope = ctx.orderedIds; active-clearing
// per line 728-732 "Only erase the ACTIVE flag when deselecting".

// ── Guards ──────────────────────────────────────────────────────────

{
  const r = applyChannelSelectAll(null, 'toggle', { orderedIds: ['a'] });
  assert(r.changed === false && r.clearActive === false && r.resultMode === null,
    'selectAll guard: null action');
}

{
  const r = applyChannelSelectAll({ fcurves: null }, 'toggle', { orderedIds: ['a'] });
  assert(r.changed === false && r.resultMode === null,
    'selectAll guard: null fcurves array');
}

{
  const a = makeAction(['a']);
  const r = applyChannelSelectAll(a, 'unknown-mode', { orderedIds: ['a'] });
  assert(r.changed === false && r.resultMode === null,
    'selectAll guard: unknown mode');
  assert(a.fcurves[0].selected === undefined || a.fcurves[0].selected === false,
    'selectAll guard: unknown mode doesn\'t mutate');
}

{
  const a = makeAction(['a']);
  const r = applyChannelSelectAll(a, 'toggle');
  assert(r.changed === false && r.resultMode === null,
    'selectAll guard: missing ctx');
}

{
  const a = makeAction(['a']);
  const r = applyChannelSelectAll(a, 'toggle', { orderedIds: [] });
  assert(r.changed === false && r.resultMode === null,
    'selectAll guard: empty orderedIds');
}

{
  const a = makeAction(['a']);
  const r = applyChannelSelectAll(a, 'toggle', { orderedIds: null });
  assert(r.changed === false && r.resultMode === null,
    'selectAll guard: null orderedIds');
}

// ── 'add' mode (SEL_SELECT) ────────────────────────────────────────

{
  // All-deselected → all selected, no active to clear.
  const a = makeAction(['a', 'b', 'c']);
  const r = applyChannelSelectAll(a, 'add', { orderedIds: ['a', 'b', 'c'] });
  assert(r.changed === true,                    'add fresh: changed=true');
  assert(r.resultMode === 'add',                'add fresh: resultMode=add');
  assert(r.selectedAfter === 3,                 'add fresh: selectedAfter=3');
  assert(r.clearActive === false,               'add fresh: clearActive=false (no active in ctx)');
  assert(a.fcurves[0].selected === true,        'add fresh: a selected');
  assert(a.fcurves[1].selected === true,        'add fresh: b selected');
  assert(a.fcurves[2].selected === true,        'add fresh: c selected');
}

{
  // Already all-selected → changed=false, idempotent.
  const a = makeAction(['a', 'b', 'c']);
  for (const fc of a.fcurves) fc.selected = true;
  const r = applyChannelSelectAll(a, 'add', { orderedIds: ['a', 'b', 'c'] });
  assert(r.changed === false,                   'add already-all: changed=false');
  assert(r.selectedAfter === 3,                 'add already-all: selectedAfter=3');
}

{
  // Active in scope + ADD → clearActive=false (active ends up selected).
  const a = makeAction(['a', 'b']);
  const r = applyChannelSelectAll(a, 'add',
    { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === false,               'add active-in-scope: clearActive=false (Blender line 728-732 — active selected, not erased)');
}

// ── 'clear' mode (SEL_DESELECT) ────────────────────────────────────

{
  // All-selected → all deselected.
  const a = makeAction(['a', 'b', 'c']);
  for (const fc of a.fcurves) fc.selected = true;
  const r = applyChannelSelectAll(a, 'clear', { orderedIds: ['a', 'b', 'c'] });
  assert(r.changed === true,                    'clear: changed=true');
  assert(r.resultMode === 'clear',              'clear: resultMode=clear');
  assert(r.selectedAfter === 0,                 'clear: selectedAfter=0');
  assert(a.fcurves[0].selected === false,       'clear: a deselected');
  assert(a.fcurves[1].selected === false,       'clear: b deselected');
  assert(a.fcurves[2].selected === false,       'clear: c deselected');
}

{
  // Already-all-deselected → changed=false (sparse-field, no `selected` key
  // means nothing to clear — `before === false`, `after === false`).
  const a = makeAction(['a', 'b']);
  const r = applyChannelSelectAll(a, 'clear', { orderedIds: ['a', 'b'] });
  assert(r.changed === false,                   'clear already-none: changed=false');
  // Sparse-field: don't write `selected: false` when it was already missing.
  assert(a.fcurves[0].selected === undefined,   'clear sparse: a.selected still missing');
  assert(a.fcurves[1].selected === undefined,   'clear sparse: b.selected still missing');
}

{
  // Active in scope + CLEAR → clearActive=true. Mirrors Blender
  // anim_channels_edit.cc:728-732: after CLEAR, FCURVE_SELECTED is wiped
  // to 0 unconditionally, so the "if (!selected && change_active)" branch
  // fires regardless of prior state.
  const a = makeAction(['a', 'b']);
  a.fcurves[0].selected = true;
  const r = applyChannelSelectAll(a, 'clear',
    { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === true,                'clear active-in-scope: clearActive=true');
}

{
  // Active NOT in scope + CLEAR → clearActive=false (active is in a
  // different/hidden region; Blender's anim_channels_for_selection
  // doesn't iterate it).
  const a = makeAction(['a', 'b']);
  a.fcurves[0].selected = true;
  const r = applyChannelSelectAll(a, 'clear',
    { orderedIds: ['b'], activeFCurveId: 'a' });
  assert(r.clearActive === false,               'clear active-not-in-scope: clearActive=false');
  assert(a.fcurves[0].selected === true,        'clear visible-scope: a (out of scope) preserved');
}

// ── 'invert' mode (SEL_INVERT) ─────────────────────────────────────

{
  // Mixed → flipped.
  const a = makeAction(['a', 'b', 'c']);
  a.fcurves[0].selected = true;
  a.fcurves[2].selected = true;
  const r = applyChannelSelectAll(a, 'invert', { orderedIds: ['a', 'b', 'c'] });
  assert(r.changed === true,                    'invert mixed: changed=true');
  assert(r.resultMode === 'invert',             'invert mixed: resultMode=invert');
  assert(r.selectedAfter === 1,                 'invert mixed: selectedAfter=1');
  assert(a.fcurves[0].selected === false,       'invert: a flipped to false');
  assert(a.fcurves[1].selected === true,        'invert: b flipped to true');
  assert(a.fcurves[2].selected === false,       'invert: c flipped to false');
}

{
  // Active in scope + was selected → flips to deselected → clearActive=true.
  const a = makeAction(['a', 'b']);
  a.fcurves[0].selected = true;
  const r = applyChannelSelectAll(a, 'invert',
    { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === true,                'invert active-was-selected: clearActive=true (now deselected)');
}

{
  // Active in scope + was deselected → flips to selected → clearActive=false.
  const a = makeAction(['a', 'b']);
  // a was deselected; b was deselected. After invert: both selected.
  const r = applyChannelSelectAll(a, 'invert',
    { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === false,               'invert active-was-deselected: clearActive=false (now selected)');
}

// ── 'toggle' mode (SEL_TOGGLE) ─────────────────────────────────────
// Resolver: `anim_channels_selection_flag_for_toggle` at
// anim_channels_edit.cc:536-570 — first FCURVE_SELECTED found = CLEAR;
// else ADD.

{
  // None selected → resolves to ADD.
  const a = makeAction(['a', 'b', 'c']);
  const r = applyChannelSelectAll(a, 'toggle', { orderedIds: ['a', 'b', 'c'] });
  assert(r.resultMode === 'add',                'toggle none-selected: resolves to add');
  assert(r.selectedAfter === 3,                 'toggle none-selected: selectedAfter=3');
  assert(a.fcurves[0].selected === true,        'toggle ADD path: a selected');
  assert(a.fcurves[1].selected === true,        'toggle ADD path: b selected');
}

{
  // Any selected → resolves to CLEAR.
  const a = makeAction(['a', 'b', 'c']);
  a.fcurves[1].selected = true; // just one
  const r = applyChannelSelectAll(a, 'toggle', { orderedIds: ['a', 'b', 'c'] });
  assert(r.resultMode === 'clear',              'toggle one-selected: resolves to clear');
  assert(r.selectedAfter === 0,                 'toggle one-selected: selectedAfter=0');
  assert(a.fcurves[1].selected === false,       'toggle CLEAR path: b deselected');
}

{
  // All selected → resolves to CLEAR.
  const a = makeAction(['a', 'b']);
  for (const fc of a.fcurves) fc.selected = true;
  const r = applyChannelSelectAll(a, 'toggle', { orderedIds: ['a', 'b'] });
  assert(r.resultMode === 'clear',              'toggle all-selected: resolves to clear');
  assert(r.selectedAfter === 0,                 'toggle all-selected: selectedAfter=0');
}

{
  // Toggle inherits active-clearing rule via its CLEAR resolution.
  const a = makeAction(['a', 'b']);
  a.fcurves[0].selected = true;
  const r = applyChannelSelectAll(a, 'toggle',
    { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === true,                'toggle→clear active-in-scope: clearActive=true');
}

// ── Scope correctness ──────────────────────────────────────────────

{
  // orderedIds restricts mutation; out-of-scope curves preserved.
  const a = makeAction(['a', 'b', 'c', 'd']);
  a.fcurves[3].selected = true; // 'd' is out of visible scope
  const r = applyChannelSelectAll(a, 'add', { orderedIds: ['a', 'b', 'c'] });
  assert(r.changed === true,                    'scope: changed=true');
  assert(r.selectedAfter === 3,                 'scope: selectedAfter counts only in-scope');
  assert(a.fcurves[0].selected === true,        'scope: a (in-scope) selected');
  assert(a.fcurves[3].selected === true,        'scope: d (out-of-scope) PRESERVED');
}

{
  // Ghost id in orderedIds (id present in orderedIds but not in action.fcurves)
  // is silently skipped — mirrors Slice 5.J's defensive `if (fc)` pattern.
  const a = makeAction(['a', 'b']);
  const r = applyChannelSelectAll(a, 'add', { orderedIds: ['a', 'ghost', 'b'] });
  assert(r.changed === true,                    'ghost: changed=true (real ids still selected)');
  assert(r.selectedAfter === 2,                 'ghost: ghost not counted');
  assert(a.fcurves[0].selected === true,        'ghost: a selected');
  assert(a.fcurves[1].selected === true,        'ghost: b selected');
}

// ── Sister-field preservation ──────────────────────────────────────

{
  // hide / mute / activeKeyformIndex must NOT be touched by bulk select-all.
  const a = makeAction(['a', 'b']);
  a.fcurves[0].hide = true;
  a.fcurves[0].mute = true;
  a.fcurves[0].activeKeyformIndex = 2;
  a.fcurves[1].mute = true;
  applyChannelSelectAll(a, 'add', { orderedIds: ['a', 'b'] });
  assert(a.fcurves[0].hide === true,            'sister: a.hide preserved');
  assert(a.fcurves[0].mute === true,            'sister: a.mute preserved');
  assert(a.fcurves[0].activeKeyformIndex === 2, 'sister: a.activeKeyformIndex preserved');
  assert(a.fcurves[1].mute === true,            'sister: b.mute preserved');
  assert(a.fcurves[0].selected === true,        'sister: a.selected set');
  assert(a.fcurves[1].selected === true,        'sister: b.selected set');
}

// ── Sparse-field invariant ─────────────────────────────────────────

{
  // CLEAR on a curve with no `selected` key must not write `selected: false`
  // (keeps JSON minimal; reader treats missing-vs-false identically).
  const a = makeAction(['a']);
  // a.fcurves[0].selected is undefined
  applyChannelSelectAll(a, 'clear', { orderedIds: ['a'] });
  assert(a.fcurves[0].selected === undefined,   'sparse: clear on missing field doesn\'t write false');
}

{
  // ADD on a curve with no `selected` key writes `selected: true`.
  const a = makeAction(['a']);
  applyChannelSelectAll(a, 'add', { orderedIds: ['a'] });
  assert(a.fcurves[0].selected === true,        'sparse: add on missing field writes true');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.N — applyChannelDeleteSelected + wouldChannelDeleteSelectedChange
// Ports ANIM_OT_channels_delete (anim_channels_edit.cc:2739-2873).
// Filter is ANIMFILTER_SEL — only `selected:true` curves are dropped.

// Guards
{
  const r = applyChannelDeleteSelected(null);
  assert(r.changed === false && r.deletedCount === 0 && r.deletedIds.length === 0,
    'delete guard: null action');
}
{
  const r = applyChannelDeleteSelected({});
  assert(r.changed === false, 'delete guard: missing fcurves');
}
{
  const r = applyChannelDeleteSelected({ fcurves: null });
  assert(r.changed === false, 'delete guard: null fcurves');
}
{
  const r = applyChannelDeleteSelected({ fcurves: [] });
  assert(r.changed === false && r.deletedCount === 0, 'delete: empty fcurves no-op');
}

// wouldChannelDeleteSelectedChange — guards
assert(wouldChannelDeleteSelectedChange(null) === false, 'wouldDelete: null action');
assert(wouldChannelDeleteSelectedChange({}) === false, 'wouldDelete: missing fcurves');
assert(wouldChannelDeleteSelectedChange({ fcurves: null }) === false, 'wouldDelete: null fcurves');
assert(wouldChannelDeleteSelectedChange({ fcurves: [] }) === false, 'wouldDelete: empty');

// No selected → no change
{
  const a = {
    fcurves: [
      { id: 'a', selected: false, keyforms: [] },
      { id: 'b', keyforms: [] }, // sparse-field: no selected key
    ],
  };
  assert(wouldChannelDeleteSelectedChange(a) === false, 'wouldDelete: nothing selected → false');
  const r = applyChannelDeleteSelected(a);
  assert(r.changed === false && r.deletedCount === 0, 'delete: nothing selected → no-op');
  assert(a.fcurves.length === 2, 'delete: array preserved (no mutation)');
}

// Single selected curve — drops it
{
  const a = {
    fcurves: [
      { id: 'a', selected: false, keyforms: [] },
      { id: 'b', selected: true,  keyforms: [] },
      { id: 'c', selected: false, keyforms: [] },
    ],
  };
  assert(wouldChannelDeleteSelectedChange(a) === true, 'wouldDelete: 1 selected → true');
  const r = applyChannelDeleteSelected(a);
  assert(r.changed === true,        'delete: changed');
  assert(r.deletedCount === 1,      'delete: 1 deleted');
  assert(r.deletedIds.length === 1 && r.deletedIds[0] === 'b', 'delete: id=b');
  assert(a.fcurves.length === 2,    'delete: array now length 2');
  assert(a.fcurves[0].id === 'a' && a.fcurves[1].id === 'c', 'delete: order preserved');
}

// Multiple selected — drops all of them
{
  const a = {
    fcurves: [
      { id: 'a', selected: true,  keyforms: [] },
      { id: 'b', selected: false, keyforms: [] },
      { id: 'c', selected: true,  keyforms: [] },
      { id: 'd', selected: true,  keyforms: [] },
    ],
  };
  const r = applyChannelDeleteSelected(a);
  assert(r.deletedCount === 3, 'delete: 3 deleted');
  assert(r.deletedIds.length === 3, 'delete: 3 ids');
  assert(r.deletedIds.indexOf('a') !== -1 && r.deletedIds.indexOf('c') !== -1 && r.deletedIds.indexOf('d') !== -1,
    'delete: ids include a/c/d');
  assert(a.fcurves.length === 1 && a.fcurves[0].id === 'b', 'delete: only b survives');
}

// Delete ALL — action.fcurves can become empty (Blender allows)
{
  const a = {
    fcurves: [
      { id: 'a', selected: true, keyforms: [] },
      { id: 'b', selected: true, keyforms: [] },
    ],
  };
  const r = applyChannelDeleteSelected(a);
  assert(r.deletedCount === 2, 'delete-all: 2 deleted');
  assert(a.fcurves.length === 0, 'delete-all: action.fcurves now empty (Blender allows)');
}

// Sparse-field defensive: `selected: undefined` ≠ true
{
  const a = {
    fcurves: [
      { id: 'a', keyforms: [] },                      // no selected key
      { id: 'b', selected: undefined, keyforms: [] }, // explicit undefined
      { id: 'c', selected: true, keyforms: [] },      // only this gets dropped
    ],
  };
  const r = applyChannelDeleteSelected(a);
  assert(r.deletedCount === 1 && r.deletedIds[0] === 'c', 'delete sparse: only true-flag curve dropped');
  assert(a.fcurves.length === 2, 'delete sparse: 2 survive');
}

// Truthy-but-not-true `selected` values defensively ignored
{
  const a = {
    fcurves: [
      { id: 'a', selected: 1,    keyforms: [] },    // truthy 1 — not deleted
      { id: 'b', selected: 'yes',keyforms: [] },    // truthy string — not deleted
      { id: 'c', selected: true, keyforms: [] },    // only this dropped
    ],
  };
  const r = applyChannelDeleteSelected(a);
  assert(r.deletedCount === 1 && r.deletedIds[0] === 'c',
    'delete: strict === true filter (matches isFCurveSelected contract)');
}

// Driver-bearing curve IS deletable at channel layer (unlike keyform delete)
{
  const a = {
    fcurves: [
      { id: 'd1', selected: true, driver: { expression: 'foo' }, keyforms: [] },
    ],
  };
  const r = applyChannelDeleteSelected(a);
  assert(r.deletedCount === 1, 'delete: driver curve IS deletable at channel layer (Blender ED_anim_ale_fcurve_delete handles drivers)');
  assert(a.fcurves.length === 0, 'delete: driver curve removed');
}

// Malformed-but-selected fcurve entries ARE dropped (audit-fix MED-A1):
// idless/non-string-id selected entries can't be reported back via
// deletedIds (there's no id to report) but they ARE dropped from
// action.fcurves so they don't survive perpetually as undeletable
// stale entries. Plain `null`/`undefined` array entries skipped.
{
  const a = {
    fcurves: [
      null,
      undefined,
      { id: 'a', selected: true, keyforms: [] },
      { selected: true, keyforms: [] }, // no id — dropped, not reported
      { id: 42, selected: true, keyforms: [] }, // non-string id — dropped, not reported
    ],
  };
  const r = applyChannelDeleteSelected(a);
  assert(r.deletedCount === 3,
    'delete: all 3 selected entries dropped (including idless/non-string-id)');
  assert(r.deletedIds.length === 1 && r.deletedIds[0] === 'a',
    'delete: only string-id curves reported in deletedIds (idless drops are silent)');
  // null/undefined slots survive (they're not `selected:true`); the 3
  // selected entries (with-id + idless + non-string-id) are all gone.
  assert(a.fcurves.length === 2, 'delete: 2 non-selected slots (null/undefined) survive; 3 selected dropped');
}

// Array reference preserved (in-place mutation)
{
  const a = {
    fcurves: [
      { id: 'a', selected: true, keyforms: [] },
      { id: 'b', selected: false, keyforms: [] },
    ],
  };
  const beforeRef = a.fcurves;
  applyChannelDeleteSelected(a);
  assert(a.fcurves === beforeRef, 'delete: action.fcurves array reference preserved (in-place splice)');
}

// preflight agrees with applyChannelDeleteSelected
{
  const a1 = { fcurves: [{ id: 'a', selected: false, keyforms: [] }] };
  const a2 = { fcurves: [{ id: 'a', selected: false, keyforms: [] }] };
  assert(wouldChannelDeleteSelectedChange(a1) === applyChannelDeleteSelected(a2).changed,
    'preflight agrees with applyDelete on no-op');
}
{
  const a1 = { fcurves: [{ id: 'a', selected: true, keyforms: [] }] };
  const a2 = { fcurves: [{ id: 'a', selected: true, keyforms: [] }] };
  assert(wouldChannelDeleteSelectedChange(a1) === applyChannelDeleteSelected(a2).changed,
    'preflight agrees with applyDelete on positive case');
}

// preflight does NOT mutate
{
  const a = { fcurves: [{ id: 'a', selected: true, keyforms: [] }] };
  wouldChannelDeleteSelectedChange(a);
  assert(a.fcurves.length === 1, 'preflight does not mutate');
  assert(a.fcurves[0].selected === true, 'preflight does not mutate fields');
}

// ── Slice 5.Z — `clearActive` wire-through integration ────────────
// Verify the dispatcher's contract: when applyChannelSelectAll returns
// clearActive=true, calling clearActiveFCurves(a) drops the fc.active
// flag. The FCurveEditor dispatcher (applyChannelSelectAllOp) does this
// inside the same update() closure, closing Slice 5.K's MED-A1
// deviation that was unblocked by Slice 5.X's persisted fc.active bit.
{
  // mode 'clear' — active is in scope + ends up deselected → clearActive=true
  const a = {
    fcurves: [
      { id: 'a', selected: true, active: true, keyforms: [] },
      { id: 'b', selected: true, keyforms: [] },
    ],
  };
  const r = applyChannelSelectAll(a, 'clear', { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === true, '5.Z: clear → clearActive=true');
  assert(isFCurveActive(a.fcurves[0]) === true, '5.Z: active still on a before dispatcher forwards');
  // Dispatcher would now run `if (decision.clearActive) clearActiveFCurves(a)`
  clearActiveFCurves(a);
  assert(isFCurveActive(a.fcurves[0]) === false, '5.Z: after wire-through, a is no longer active');
  assert(a.fcurves[0].active === undefined, '5.Z: fc.active sparse-deleted (not set to false)');
}
{
  // mode 'add' — active stays selected → clearActive=false → dispatcher does NOT clear
  const a = {
    fcurves: [
      { id: 'a', selected: false, active: true, keyforms: [] },
      { id: 'b', keyforms: [] },
    ],
  };
  const r = applyChannelSelectAll(a, 'add', { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === false, '5.Z: add → clearActive=false (active gets selected, not erased)');
  assert(isFCurveActive(a.fcurves[0]) === true, '5.Z: active preserved on add (no dispatcher clear)');
}
{
  // mode 'invert' — active flips from selected to deselected → clearActive=true
  const a = {
    fcurves: [
      { id: 'a', selected: true, active: true, keyforms: [] },
      { id: 'b', keyforms: [] },
    ],
  };
  const r = applyChannelSelectAll(a, 'invert', { orderedIds: ['a', 'b'], activeFCurveId: 'a' });
  assert(r.clearActive === true, '5.Z: invert (active flips off) → clearActive=true');
  clearActiveFCurves(a);
  assert(isFCurveActive(a.fcurves[0]) === false, '5.Z: dispatcher wire-through clears active');
}

// ── Slice 5.BB — applyGroupChildrenSelect (Shift+Ctrl+click) ──────
// Ports Blender's `selectmode = -1` branch of mouse_anim_channels at
// `anim_channels_edit.cc:4163-4180`. Semantics:
//   1. Pre-clear visible scope (orderedIds) — wipes `selected`
//   2. Select every fcurve with `groupId === clickedGroupId`
//   3. Set group's own `selected = true`
//   4. Active-clear cascade if previously-active was in visible scope

function makeActionWithGroups(groups, fcurves) {
  return { id: 'a1', groups, fcurves };
}

// Guards ────────────────────────────────────────────────────────
{
  const r1 = applyGroupChildrenSelect(null, 'g1', { orderedIds: ['fc1'] });
  assert(r1.changed === false, '5.BB: null action → no change');
  assert(r1.selectedCount === 0, '5.BB: null action → selectedCount=0');

  const r2 = applyGroupChildrenSelect({ fcurves: null }, 'g1', { orderedIds: ['fc1'] });
  assert(r2.changed === false, '5.BB: action with null fcurves → no change');

  const r3 = applyGroupChildrenSelect({ fcurves: [], groups: null }, 'g1', { orderedIds: [] });
  assert(r3.changed === false, '5.BB: action with null groups → no change');

  const r4 = applyGroupChildrenSelect(makeActionWithGroups([], []), '', { orderedIds: [] });
  assert(r4.changed === false, '5.BB: empty groupId → no change');

  const r5 = applyGroupChildrenSelect(makeActionWithGroups([{ id: 'gA' }], []), 'nonexistent', { orderedIds: [] });
  assert(r5.changed === false, '5.BB: nonexistent groupId → no change');
}

// Happy path — pre-clear + select children + mark group selected ────
{
  const a = makeActionWithGroups(
    [{ id: 'gA', name: 'Group A' }, { id: 'gB', name: 'Group B' }],
    [
      { id: 'fc1', groupId: 'gA', keyforms: [] },
      { id: 'fc2', groupId: 'gA', keyforms: [] },
      { id: 'fc3', groupId: 'gB', selected: true, keyforms: [] },
      { id: 'fc4', keyforms: [] },  // ungrouped
    ],
  );
  const r = applyGroupChildrenSelect(a, 'gA', {
    orderedIds: ['fc1', 'fc2', 'fc3', 'fc4'],
  });
  assert(r.changed === true, '5.BB happy: changed=true');
  assert(r.selectedCount === 2, '5.BB happy: selectedCount=2 (gA has 2 fcurves)');
  assert(a.fcurves[0].selected === true, '5.BB happy: fc1 (gA child) selected');
  assert(a.fcurves[1].selected === true, '5.BB happy: fc2 (gA child) selected');
  assert(a.fcurves[2].selected === false, '5.BB happy: fc3 (gB child) DESELECTED via pre-clear');
  assert(a.fcurves[3].selected === undefined, '5.BB happy: fc4 (ungrouped) unchanged sparse-false');
  assert(a.groups[0].selected === true, '5.BB happy: gA group flagged selected');
  assert(a.groups[1].selected !== true, '5.BB happy: gB group NOT flagged selected');
}

// Active-clear cascade — active in visible scope, not in clicked group
{
  const a = makeActionWithGroups(
    [{ id: 'gA' }, { id: 'gB' }],
    [
      { id: 'fc1', groupId: 'gA', selected: true, active: true, keyforms: [] },
      { id: 'fc2', groupId: 'gB', keyforms: [] },
    ],
  );
  const r = applyGroupChildrenSelect(a, 'gB', {
    orderedIds: ['fc1', 'fc2'],
    activeFCurveId: 'fc1',
  });
  assert(r.changed === true, '5.BB active-out-of-group: changed');
  assert(r.clearedActive === true, '5.BB active-out-of-group: clearedActive=true');
  assert(isFCurveActive(a.fcurves[0]) === false, '5.BB: fc1 no longer active (pre-clear cascade)');
  assert(a.fcurves[0].selected === false, '5.BB: fc1 deselected too');
  assert(a.fcurves[1].selected === true, '5.BB: fc2 (gB child) selected');
}

// Active-clear cascade — active IS in clicked group → still cleared (Blender no re-elevation)
{
  const a = makeActionWithGroups(
    [{ id: 'gA' }],
    [
      { id: 'fc1', groupId: 'gA', selected: true, active: true, keyforms: [] },
      { id: 'fc2', groupId: 'gA', keyforms: [] },
    ],
  );
  const r = applyGroupChildrenSelect(a, 'gA', {
    orderedIds: ['fc1', 'fc2'],
    activeFCurveId: 'fc1',
  });
  assert(r.changed === true, '5.BB active-in-group: changed');
  assert(r.clearedActive === true, '5.BB active-in-group: clearedActive=true (no re-elevation)');
  assert(isFCurveActive(a.fcurves[0]) === false, '5.BB: fc1 lost active even though re-selected');
  assert(a.fcurves[0].selected === true, '5.BB: fc1 re-selected (it IS a gA child)');
  assert(a.fcurves[1].selected === true, '5.BB: fc2 selected');
}

// Active OUT of visible scope → preserved
{
  const a = makeActionWithGroups(
    [{ id: 'gA' }],
    [
      { id: 'fcHidden', groupId: 'gOther', active: true, keyforms: [] },  // hidden / out of orderedIds
      { id: 'fc1', groupId: 'gA', keyforms: [] },
    ],
  );
  const r = applyGroupChildrenSelect(a, 'gA', {
    orderedIds: ['fc1'],  // fcHidden out of scope
    activeFCurveId: 'fcHidden',
  });
  assert(r.clearedActive === false, '5.BB active-out-of-scope: preserved');
  assert(isFCurveActive(a.fcurves[0]) === true, '5.BB: fcHidden still active');
}

// Hidden children of clicked group still get selected (SS Deviation 2)
{
  const a = makeActionWithGroups(
    [{ id: 'gA' }],
    [
      { id: 'fc1', groupId: 'gA', keyforms: [] },
      { id: 'fcHidden', groupId: 'gA', hide: true, keyforms: [] },  // hidden
    ],
  );
  const r = applyGroupChildrenSelect(a, 'gA', {
    orderedIds: ['fc1'],  // hidden child out of visible scope
  });
  assert(r.changed === true, '5.BB hidden-children: changed');
  assert(r.selectedCount === 2, '5.BB hidden-children: BOTH children counted (intrinsic list)');
  assert(a.fcurves[0].selected === true, '5.BB: visible child selected');
  assert(a.fcurves[1].selected === true, '5.BB: HIDDEN child also selected (matches Blender agrp->channels)');
}

// Idempotent re-press → no change
{
  const a = makeActionWithGroups(
    [{ id: 'gA', selected: true }],
    [
      { id: 'fc1', groupId: 'gA', selected: true, keyforms: [] },
      { id: 'fc2', groupId: 'gA', selected: true, keyforms: [] },
    ],
  );
  const r = applyGroupChildrenSelect(a, 'gA', {
    orderedIds: ['fc1', 'fc2'],
  });
  assert(r.changed === false, '5.BB idempotent: no change');
  assert(r.selectedCount === 2, '5.BB idempotent: selectedCount still reports the 2 group members');
}

// Preflight matches setter ──────────────────────────────────────
{
  const scenarios = [
    () => ({
      action: makeActionWithGroups(
        [{ id: 'gA' }, { id: 'gB' }],
        [
          { id: 'fc1', groupId: 'gA', keyforms: [] },
          { id: 'fc2', groupId: 'gB', selected: true, keyforms: [] },
        ],
      ),
      gid: 'gA',
      ctx: { orderedIds: ['fc1', 'fc2'] },
    }),
    () => ({
      action: makeActionWithGroups(
        [{ id: 'gA', selected: true }],
        [
          { id: 'fc1', groupId: 'gA', selected: true, keyforms: [] },
        ],
      ),
      gid: 'gA',
      ctx: { orderedIds: ['fc1'] },  // idempotent — predict false
    }),
    () => ({
      action: makeActionWithGroups(
        [{ id: 'gA' }],
        [
          { id: 'fc1', groupId: 'gA', active: true, keyforms: [] },
        ],
      ),
      gid: 'gA',
      ctx: { orderedIds: ['fc1'], activeFCurveId: 'fc1' },  // active-only — predict true
    }),
    () => ({
      action: makeActionWithGroups([], []),
      gid: 'gA',
      ctx: { orderedIds: [] },  // no groups — predict false
    }),
  ];
  for (let i = 0; i < scenarios.length; i++) {
    const sA = scenarios[i]();
    const sB = scenarios[i]();
    const predicted = wouldGroupChildrenSelectChange(sA.action, sA.gid, sA.ctx);
    const r = applyGroupChildrenSelect(sB.action, sB.gid, sB.ctx);
    const anyMutation = r.changed || r.clearedActive;
    assert(predicted === anyMutation, `5.BB scenario ${i}: preflight matches setter (changed||clearedActive)`);
  }
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
