// Animation Phase 5 Slice 5.EE — tests for
// src/store/keyformSelectionStore.js (FCurveEditor publish /
// DopesheetEditor consume mirror store).
//
// Coverage:
//   - Default state is empty Map
//   - publishHandles replaces the Map
//   - publishHandles skips set() when ref-equal (identity-stable)
//   - isKeyformCenterSelected: null/empty/missing/non-Map guards
//   - isKeyformCenterSelected: hit/miss on fcurveId + keyformIdx
//   - isKeyformCenterSelected: gates on `.center === true` only
//     (left/right alone don't fire the halo per Blender `bezt->f2`)
//   - __resetForTests clears back to empty
//
// Run: node scripts/test/test_keyformSelectionStore.mjs

import {
  useKeyformSelectionStore,
  isKeyformCenterSelected,
} from '../../src/store/keyformSelectionStore.js';

let passed = 0;
let failed = 0;

function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}

function setOf(fcurveId, kfIdx, parts) {
  const inner = new Map();
  inner.set(kfIdx, parts);
  const outer = new Map();
  outer.set(fcurveId, inner);
  return outer;
}

// ── Default state ─────────────────────────────────────────────────
{
  const s = useKeyformSelectionStore.getState();
  eq(s.handles instanceof Map, true, 'default state: handles is a Map');
  eq(s.handles.size, 0, 'default state: empty Map');
}

// ── publishHandles replaces the Map ──────────────────────────────
{
  const store = useKeyformSelectionStore;
  store.getState().__resetForTests();

  const next = setOf('fcA', 0, { center: true, left: false, right: false });
  store.getState().publishHandles(next);
  eq(store.getState().handles, next, 'publishHandles: Map reference replaced');
  eq(store.getState().handles.get('fcA')?.get(0)?.center, true, 'publishHandles: data readable');
}

// ── publishHandles skips set() when ref-equal (identity-stable) ──
{
  const store = useKeyformSelectionStore;
  store.getState().__resetForTests();

  const same = new Map();
  store.getState().publishHandles(same);
  let count = 0;
  const unsub = store.subscribe(() => { count++; });
  store.getState().publishHandles(same);  // same ref → should NOT fire subscribers
  unsub();
  eq(count, 0, 'publishHandles: same-ref skip avoids subscriber call');
}

// ── isKeyformCenterSelected guards ───────────────────────────────
{
  eq(isKeyformCenterSelected(null, 'a', 0), false, 'null handles → false');
  eq(isKeyformCenterSelected(undefined, 'a', 0), false, 'undefined handles → false');
  eq(isKeyformCenterSelected({}, 'a', 0), false, 'non-Map handles → false');
  eq(isKeyformCenterSelected(new Map(), 'a', 0), false, 'empty Map → false');
  eq(isKeyformCenterSelected(new Map(), null, 0), false, 'null fcurveId → false');
  eq(isKeyformCenterSelected(new Map(), '', 0), false, 'empty fcurveId → false');
  eq(isKeyformCenterSelected(new Map(), 42, 0), false, 'non-string fcurveId → false');
  eq(isKeyformCenterSelected(new Map(), 'a', null), false, 'null keyformIdx → false');
  eq(isKeyformCenterSelected(new Map(), 'a', -1), false, 'negative keyformIdx → false');
  eq(isKeyformCenterSelected(new Map(), 'a', '0'), false, 'string keyformIdx → false');
}

// ── isKeyformCenterSelected hit/miss ─────────────────────────────
{
  const handles = setOf('fcA', 0, { center: true, left: false, right: false });
  eq(isKeyformCenterSelected(handles, 'fcA', 0), true, 'hit: fcA[0].center=true → true');
  eq(isKeyformCenterSelected(handles, 'fcA', 1), false, 'miss: wrong keyformIdx → false');
  eq(isKeyformCenterSelected(handles, 'fcB', 0), false, 'miss: wrong fcurveId → false');
}

// ── center bit semantic: left/right alone don't fire halo ────────
// Blender's gate at graph_draw.cc:254 is `bezt->f2 & SELECT` — `f2` is
// the CENTER bit. SS equivalent is `.center === true`. If only handle
// bits are set without the center, no halo.
{
  const onlyLeft = setOf('fcA', 0, { center: false, left: true, right: false });
  eq(isKeyformCenterSelected(onlyLeft, 'fcA', 0), false, 'center=false, left=true → false (only center gates)');
  const onlyRight = setOf('fcA', 0, { center: false, left: false, right: true });
  eq(isKeyformCenterSelected(onlyRight, 'fcA', 0), false, 'center=false, right=true → false');
  const noneSelected = setOf('fcA', 0, { center: false, left: false, right: false });
  eq(isKeyformCenterSelected(noneSelected, 'fcA', 0), false, 'all false → false');
}

// ── center bit semantic: requires strict ===true ─────────────────
{
  const truthy = setOf('fcA', 0, { center: 1, left: false, right: false });  // non-bool
  eq(isKeyformCenterSelected(truthy, 'fcA', 0), false, 'center=1 (truthy non-bool) → false (strict === true)');
  const stringTrue = setOf('fcA', 0, { center: 'true', left: false, right: false });
  eq(isKeyformCenterSelected(stringTrue, 'fcA', 0), false, 'center="true" string → false (strict)');
}

// ── __resetForTests ──────────────────────────────────────────────
{
  const store = useKeyformSelectionStore;
  store.getState().publishHandles(setOf('x', 0, { center: true, left: false, right: false }));
  eq(store.getState().handles.size > 0, true, 'pre-reset: store has data');
  store.getState().__resetForTests();
  eq(store.getState().handles.size, 0, '__resetForTests: store back to empty');
}

// ── final report ───────────────────────────────────────────────────
if (failed === 0) {
  console.log(`All ${passed} keyformSelectionStore assertions passed.`);
  process.exit(0);
} else {
  console.error(`\n${failed} of ${passed + failed} assertions FAILED.`);
  process.exit(1);
}
