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

import {
  isFCurveHidden,
  toggleFCurveHidden,
  applyHideFCurves,
  applyRevealFCurves,
  wouldHideChangeFCurves,
  wouldRevealChangeFCurves,
} from '../../src/anim/fcurveVisible.js';
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
// Multi-action isolation — same fcurveId in two actions
//
// Audit-fix MED-2 (Slice 5.I dual-audit 2026-05-17): explicit
// regression for the case where two actions independently contain an
// fcurve with the same `id` (possible if actions are cloned, or if
// a future `uid()` collision occurs). Isolation is architecturally
// guaranteed by `toggleFCurveHidden`'s signature (it operates on the
// passed-in `action` object directly), but the test now pins the
// guarantee.

{
  const fcA = makeFCurve('shared-id', [0, 1]);
  const fcB = makeFCurve('shared-id', [0, 1]);
  const actionA = makeAction([fcA]);
  const actionB = makeAction([fcB]);

  toggleFCurveHidden(actionA, 'shared-id');
  assert(isFCurveHidden(fcA) === true,  'multi-action: actionA fcurve hidden');
  assert(isFCurveHidden(fcB) === false, 'multi-action: actionB fcurve unaffected by toggle on A');

  toggleFCurveHidden(actionB, 'shared-id');
  assert(isFCurveHidden(fcB) === true,  'multi-action: actionB fcurve now hidden');
  assert(isFCurveHidden(fcA) === true,  'multi-action: actionA fcurve STILL hidden (no spillback)');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.M — applyHideFCurves: bulk hide of selected (H) or
// unselected (Shift+H). Port of GRAPH_OT_hide.

// Guards
assert(applyHideFCurves(null, { unselected: false }).changed === false, 'hide: null action → no change');
assert(applyHideFCurves({}, { unselected: false }).changed === false, 'hide: missing fcurves → no change');
assert(applyHideFCurves({ fcurves: [] }, null).changed === false, 'hide: null opts → no change');
assert(applyHideFCurves({ fcurves: [] }, {}).changed === false, 'hide: missing unselected → no change');
assert(applyHideFCurves({ fcurves: [] }, { unselected: 'no' }).changed === false, 'hide: non-bool unselected → no change');

// H (unselected=false): hide selected; deselect them
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', selected: true,  hide: false, keyforms: [] },
      { id: 'b', selected: false, hide: false, keyforms: [] },
      { id: 'c', selected: true,  hide: false, keyforms: [] },
    ],
  };
  const r = applyHideFCurves(action, { unselected: false });
  assert(r.changed === true,        'hide selected: changed');
  assert(r.hiddenCount === 2,       'hide selected: hiddenCount=2');
  assert(r.deselectedCount === 2,   'hide selected: deselectedCount=2');
  assert(r.reShowCount === 0,       'hide selected: reShowCount=0 (no Phase 2 unless unselected=true)');
  assert(action.fcurves[0].hide === true,  'hide selected: a hidden');
  assert(action.fcurves[0].selected === false, 'hide selected: a deselected');
  assert(action.fcurves[1].hide === false, 'hide selected: b NOT hidden (was unselected)');
  assert(action.fcurves[1].selected === false, 'hide selected: b still unselected (no change)');
  assert(action.fcurves[2].hide === true,  'hide selected: c hidden');
}

// H with no selection → no-op
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', selected: false, hide: false, keyforms: [] },
      { id: 'b', selected: false, hide: false, keyforms: [] },
    ],
  };
  const r = applyHideFCurves(action, { unselected: false });
  assert(r.changed === false, 'hide selected with nothing selected → no change');
  assert(r.hiddenCount === 0, 'hide selected: 0 hidden');
}

// H skips already-hidden curves (ANIMFILTER_CURVE_VISIBLE)
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', selected: true, hide: true, keyforms: [] },  // already hidden, still selected
    ],
  };
  const r = applyHideFCurves(action, { unselected: false });
  assert(r.changed === false, 'hide selected: already-hidden curve skipped (ANIMFILTER_CURVE_VISIBLE)');
  assert(action.fcurves[0].selected === true, 'hide selected: already-hidden curve NOT deselected');
}

// Shift+H (unselected=true): hide unselected; Phase 2 re-ensures
// selected are visible+selected (no-op without group flush). Note
// `deselectedCount` only counts true→false transitions — curves that
// were already `selected: false` (matching the unselected filter)
// don't trigger redundant writes.
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', selected: true,  hide: false, keyforms: [] },
      { id: 'b', selected: false, hide: false, keyforms: [] },
      { id: 'c', selected: false, hide: false, keyforms: [] },
      { id: 'd', selected: true,  hide: false, keyforms: [] },
    ],
  };
  const r = applyHideFCurves(action, { unselected: true });
  assert(r.changed === true,      'hide unselected: changed');
  assert(r.hiddenCount === 2,     'hide unselected: hiddenCount=2 (b,c)');
  assert(r.deselectedCount === 0, 'hide unselected: deselectedCount=0 (b,c were already !selected)');
  assert(action.fcurves[0].hide === false, 'hide unselected: a NOT hidden (was selected)');
  assert(action.fcurves[1].hide === true,  'hide unselected: b hidden');
  assert(action.fcurves[2].hide === true,  'hide unselected: c hidden');
  assert(action.fcurves[3].hide === false, 'hide unselected: d NOT hidden (was selected)');
  assert(action.fcurves[0].selected === true, 'hide unselected: a still selected');
  assert(action.fcurves[3].selected === true, 'hide unselected: d still selected');
}

// Shift+H with a selected curve mixed in deselects nothing (selected
// curves skip Phase 1 entirely); the deselectedCount should count
// true→false transitions for unselected curves that have stale
// selected=true (impossible by construction, so 0 in practice).
// Adversarial test: what if a curve has selected:true but caller
// claims it's unselected via the filter? Our filter reads selected
// directly, not from caller — so this can't happen. Skip the
// adversarial test.

// Shift+H Phase 2 re-show check: a selected curve that was already
// hidden gets re-shown (would happen via group-flush; today only via
// the explicit phase-2 walk in our port)
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', selected: true,  hide: true,  keyforms: [] },  // selected + hidden → Phase 2 reveals
      { id: 'b', selected: false, hide: false, keyforms: [] },  // hidden by Phase 1
    ],
  };
  const r = applyHideFCurves(action, { unselected: true });
  assert(r.reShowCount === 1,           'Phase 2: re-show count=1 (a was hidden+selected)');
  assert(action.fcurves[0].hide === false, 'Phase 2: a un-hidden');
  assert(action.fcurves[0].selected === true, 'Phase 2: a still selected');
  assert(action.fcurves[1].hide === true,  'Phase 1: b hidden');
}

// Sparse-field defensive: missing `selected` treated as not-selected
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', hide: false, keyforms: [] },   // missing selected
      { id: 'b', selected: true, hide: false, keyforms: [] },
    ],
  };
  const r = applyHideFCurves(action, { unselected: false });
  assert(r.hiddenCount === 1, 'sparse: only b (selected=true) hidden, a treated as unselected');
  assert(action.fcurves[0].hide === false, 'sparse: a unaffected');
}

// Input not corrupted on failure paths
{
  const action = { fcurves: [{ id: 'a', selected: true, hide: false, keyforms: [] }] };
  applyHideFCurves(action, { unselected: 'bogus' });
  assert(action.fcurves[0].hide === false, 'bad opts: action not mutated');
  assert(action.fcurves[0].selected === true, 'bad opts: action not mutated (sel)');
}

// ─────────────────────────────────────────────────────────────────────
// Slice 5.M — applyRevealFCurves: bulk reveal (Alt+H). Port of GRAPH_OT_reveal.

// Guards
assert(applyRevealFCurves(null, { select: true }).changed === false, 'reveal: null action → no change');
assert(applyRevealFCurves({ fcurves: [] }, null).changed === false, 'reveal: null opts → no change');
assert(applyRevealFCurves({ fcurves: [] }, {}).changed === false, 'reveal: missing select → no change');
assert(applyRevealFCurves({ fcurves: [] }, { select: 1 }).changed === false, 'reveal: non-bool select → no change');

// Default Alt+H: select=true → all hidden curves unhide AND become selected
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', hide: true,  selected: false, keyforms: [] },
      { id: 'b', hide: true,  selected: true,  keyforms: [] },   // already selected
      { id: 'c', hide: false, selected: false, keyforms: [] },   // wasn't hidden
    ],
  };
  const r = applyRevealFCurves(action, { select: true });
  assert(r.changed === true,         'reveal: changed');
  assert(r.revealedCount === 2,      'reveal: revealedCount=2 (a,b)');
  assert(r.selectedCount === 1,      'reveal: selectedCount=1 (a flipped; b already true)');
  assert(action.fcurves[0].hide === false, 'reveal: a unhidden');
  assert(action.fcurves[0].selected === true, 'reveal: a now selected');
  assert(action.fcurves[1].hide === false, 'reveal: b unhidden');
  assert(action.fcurves[1].selected === true, 'reveal: b still selected');
  assert(action.fcurves[2].hide === false, 'reveal: c untouched (was visible)');
  assert(action.fcurves[2].selected === false, 'reveal: c NOT selected (was visible — selection gated on prev-hidden)');
}

// Reveal with select=false: hidden curves unhide AND become explicitly deselected
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', hide: true,  selected: true,  keyforms: [] },  // was selected → cleared
      { id: 'b', hide: true,  selected: false, keyforms: [] },  // stays !selected
    ],
  };
  const r = applyRevealFCurves(action, { select: false });
  assert(r.revealedCount === 2, 'reveal select=false: revealedCount=2');
  assert(r.selectedCount === 1, 'reveal select=false: selectedCount=1 (a flipped true→false)');
  assert(action.fcurves[0].selected === false, 'reveal select=false: a deselected');
  assert(action.fcurves[1].selected === false, 'reveal select=false: b still deselected');
}

// Reveal with nothing hidden → no-op
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', hide: false, selected: false, keyforms: [] },
      { id: 'b', hide: false, selected: true,  keyforms: [] },
    ],
  };
  const r = applyRevealFCurves(action, { select: true });
  assert(r.changed === false, 'reveal: no hidden curves → no change');
  assert(r.revealedCount === 0, 'reveal: 0 revealed');
  assert(r.selectedCount === 0, 'reveal: 0 selection writes (gate held)');
  assert(action.fcurves[1].selected === true, 'reveal: b still selected (untouched)');
}

// Sparse-field defensive: hidden curve with no `selected` field
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', hide: true, keyforms: [] },  // no selected field
    ],
  };
  const r = applyRevealFCurves(action, { select: true });
  assert(r.revealedCount === 1, 'sparse reveal: 1 revealed');
  assert(action.fcurves[0].selected === true, 'sparse reveal: now selected');
}

// Sparse-field defensive: hidden curve with no `selected`, select=false
// (should NOT write false onto a sparse field — keeps the field sparse)
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', hide: true, keyforms: [] },  // no selected field
    ],
  };
  applyRevealFCurves(action, { select: false });
  // `fc.selected === true` is false (undefined !== true), wantSelected
  // is false → condition `false !== false` is false → no write.
  assert(!('selected' in action.fcurves[0]) || action.fcurves[0].selected === undefined,
    'sparse reveal select=false: field stays sparse (no spurious false write)');
}

// ─────────────────────────────────────────────────────────────────────
// Sister-field preservation — hide/reveal don't touch other slots

{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', selected: true, hide: false, mute: true, activeKeyformIndex: 3, keyforms: [{}, {}, {}, {}] },
    ],
  };
  applyHideFCurves(action, { unselected: false });
  assert(action.fcurves[0].mute === true, 'hide: mute preserved');
  assert(action.fcurves[0].activeKeyformIndex === 3, 'hide: activeKeyformIndex preserved');
}
{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', hide: true, mute: true, activeKeyformIndex: 2, keyforms: [{}, {}, {}] },
    ],
  };
  applyRevealFCurves(action, { select: true });
  assert(action.fcurves[0].mute === true, 'reveal: mute preserved');
  assert(action.fcurves[0].activeKeyformIndex === 2, 'reveal: activeKeyformIndex preserved');
}

// ─────────────────────────────────────────────────────────────────────
// Involution-ish: hide then reveal puts curves back to visible+selected

{
  const action = {
    id: 'A',
    fcurves: [
      { id: 'a', selected: true, hide: false, keyforms: [] },
      { id: 'b', selected: true, hide: false, keyforms: [] },
    ],
  };
  applyHideFCurves(action, { unselected: false });
  assert(action.fcurves[0].hide === true && action.fcurves[1].hide === true, 'hide-then-reveal: both hidden after hide');
  assert(action.fcurves[0].selected === false && action.fcurves[1].selected === false, 'hide-then-reveal: both deselected after hide');
  applyRevealFCurves(action, { select: true });
  assert(action.fcurves[0].hide === false && action.fcurves[1].hide === false, 'hide-then-reveal: both visible after reveal');
  assert(action.fcurves[0].selected === true && action.fcurves[1].selected === true, 'hide-then-reveal: both reselected after reveal');
}

// ─────────────────────────────────────────────────────────────────────
// Audit-fix HIGH-A1 (Slice 5.M dual-audit 2026-05-17) — preflight
// readers MUST mirror the mutation logic exactly so the dispatcher's
// "skip update() when nothing would change" gate doesn't lie.

// wouldHideChangeFCurves — guards
assert(wouldHideChangeFCurves(null, { unselected: false }) === false, 'wouldHide: null action');
assert(wouldHideChangeFCurves({}, { unselected: false }) === false, 'wouldHide: missing fcurves');
assert(wouldHideChangeFCurves({ fcurves: [] }, null) === false, 'wouldHide: null opts');
assert(wouldHideChangeFCurves({ fcurves: [] }, {}) === false, 'wouldHide: missing unselected');
assert(wouldHideChangeFCurves({ fcurves: [] }, { unselected: 'no' }) === false, 'wouldHide: non-bool unselected');

// wouldHideChangeFCurves — empty fcurves, no selection, no visible match
assert(wouldHideChangeFCurves({ fcurves: [] }, { unselected: false }) === false, 'wouldHide: empty fcurves');
assert(wouldHideChangeFCurves({ fcurves: [{ id: 'a', selected: false, hide: false, keyforms: [] }] }, { unselected: false }) === false,
  'wouldHide H: nothing selected → no change');
assert(wouldHideChangeFCurves({ fcurves: [{ id: 'a', selected: true, hide: true, keyforms: [] }] }, { unselected: false }) === false,
  'wouldHide H: only selected curve already hidden → no change (skipped by ANIMFILTER_CURVE_VISIBLE)');

// wouldHideChangeFCurves — positive cases (each helper invariant true)
assert(wouldHideChangeFCurves({ fcurves: [{ id: 'a', selected: true, hide: false, keyforms: [] }] }, { unselected: false }) === true,
  'wouldHide H: selected + visible → change');
assert(wouldHideChangeFCurves({ fcurves: [{ id: 'a', selected: false, hide: false, keyforms: [] }] }, { unselected: true }) === true,
  'wouldHide Shift+H: unselected + visible → change');

// wouldHideChangeFCurves — Phase 2 detection
assert(wouldHideChangeFCurves({
  fcurves: [
    { id: 'a', selected: true, hide: true, keyforms: [] },  // Phase 2 would re-show
    { id: 'b', selected: true, hide: false, keyforms: [] }, // skips Phase 1 (selected)
  ],
}, { unselected: true }) === true,
  'wouldHide Phase 2: a selected+hidden would re-show → change');

// wouldHideChangeFCurves — agrees with applyHideFCurves on no-op case
{
  const action = { id: 'A', fcurves: [{ id: 'a', selected: false, hide: false, keyforms: [] }] };
  const wouldChange = wouldHideChangeFCurves(action, { unselected: false });
  const actual = applyHideFCurves(action, { unselected: false });
  assert(wouldChange === actual.changed, 'preflight agrees with applyHide on no-op');
}

// wouldHideChangeFCurves — agrees with applyHideFCurves on positive case
{
  const action = { id: 'A', fcurves: [{ id: 'a', selected: true, hide: false, keyforms: [] }] };
  const wouldChange = wouldHideChangeFCurves(action, { unselected: false });
  const action2 = { id: 'A', fcurves: [{ id: 'a', selected: true, hide: false, keyforms: [] }] };
  const actual = applyHideFCurves(action2, { unselected: false });
  assert(wouldChange === actual.changed && wouldChange === true, 'preflight agrees with applyHide on positive case');
}

// wouldRevealChangeFCurves — guards
assert(wouldRevealChangeFCurves(null, { select: true }) === false, 'wouldReveal: null action');
assert(wouldRevealChangeFCurves({ fcurves: [] }, null) === false, 'wouldReveal: null opts');
assert(wouldRevealChangeFCurves({ fcurves: [] }, {}) === false, 'wouldReveal: missing select');
assert(wouldRevealChangeFCurves({ fcurves: [] }, { select: 1 }) === false, 'wouldReveal: non-bool select');

// wouldRevealChangeFCurves — empty / no-op
assert(wouldRevealChangeFCurves({ fcurves: [] }, { select: true }) === false, 'wouldReveal: empty');
assert(wouldRevealChangeFCurves({ fcurves: [{ id: 'a', hide: false, selected: false, keyforms: [] }] }, { select: true }) === false,
  'wouldReveal: nothing hidden → no change');

// wouldRevealChangeFCurves — positive cases
assert(wouldRevealChangeFCurves({ fcurves: [{ id: 'a', hide: true, selected: false, keyforms: [] }] }, { select: true }) === true,
  'wouldReveal: hidden curve → change');
assert(wouldRevealChangeFCurves({ fcurves: [{ id: 'a', hide: true, selected: true, keyforms: [] }] }, { select: true }) === true,
  'wouldReveal: hidden curve (already selected) → still change (hide flips)');

// wouldRevealChangeFCurves — agrees with applyRevealFCurves
{
  const action = { id: 'A', fcurves: [{ id: 'a', hide: false, selected: true, keyforms: [] }] };
  const wouldChange = wouldRevealChangeFCurves(action, { select: true });
  const actual = applyRevealFCurves(action, { select: true });
  assert(wouldChange === actual.changed && wouldChange === false, 'preflight agrees with applyReveal on no-op');
}
{
  const action = { id: 'A', fcurves: [{ id: 'a', hide: true, selected: false, keyforms: [] }] };
  const wouldChange = wouldRevealChangeFCurves(action, { select: true });
  const action2 = { id: 'A', fcurves: [{ id: 'a', hide: true, selected: false, keyforms: [] }] };
  const actual = applyRevealFCurves(action2, { select: true });
  assert(wouldChange === actual.changed && wouldChange === true, 'preflight agrees with applyReveal on positive case');
}

// Preflight readers do NOT mutate
{
  const action = { id: 'A', fcurves: [{ id: 'a', selected: true, hide: false, keyforms: [] }] };
  wouldHideChangeFCurves(action, { unselected: false });
  assert(action.fcurves[0].hide === false, 'wouldHide does not mutate hide');
  assert(action.fcurves[0].selected === true, 'wouldHide does not mutate selected');
  wouldRevealChangeFCurves(action, { select: true });
  assert(action.fcurves[0].hide === false, 'wouldReveal does not mutate hide');
}

// ─────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
