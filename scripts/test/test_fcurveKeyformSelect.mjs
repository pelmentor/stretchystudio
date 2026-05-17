// Animation Phase 5 Slice 5.L — tests for src/anim/fcurveKeyformSelect.js
//
// Coverage:
//   - applyKeyformInvertSelection on fully-selected map → empty (clears all)
//   - on empty map → every visible keyform selected (handles all true)
//   - on mixed map → flipped per keyform; handles mirror new center
//     (Blender's select_bezier_invert at keyframes_edit.cc:1567-1580)
//   - Sparse-field invariant: omits entries where new center is false
//     (matches operatorSelectAll's `if (sub.size > 0)` convention)
//   - Hidden curves (absent from visibleFCurves) → entries dropped from
//     output, matching Blender's ANIMFILTER_CURVE_VISIBLE filter
//   - Partial-handle pre-state ({center: false, left: true, right: false})
//     → after invert all three force-mirror the new center (Blender's
//     handle-collapse rule at keyframes_edit.cc:1571-1578)
//   - Input not mutated (currentSelection preserved by reference)
//   - Guards: null/undefined inputs, malformed curves, ghost entries
//
// Run: node scripts/test/test_fcurveKeyformSelect.mjs

import { applyKeyformInvertSelection } from '../../src/anim/fcurveKeyformSelect.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeCurve(id, kfCount) {
  return { id, keyforms: Array.from({ length: kfCount }, (_, i) => ({ idx: i })) };
}

function sel(center, left = center, right = center) {
  return { center, left, right };
}

// ─────────────────────────────────────────────────────────────────────
// Guards

assert(
  applyKeyformInvertSelection(null, null) instanceof Map,
  'null visibleFCurves → empty Map',
);
assert(
  applyKeyformInvertSelection(null, null).size === 0,
  'null visibleFCurves → size 0',
);
assert(
  applyKeyformInvertSelection(undefined, new Map()).size === 0,
  'undefined visibleFCurves → empty',
);
assert(
  applyKeyformInvertSelection([], new Map()).size === 0,
  'empty visibleFCurves → empty',
);
assert(
  applyKeyformInvertSelection([makeCurve('A', 2)], null).size === 1,
  'null currentSelection treated as empty (everything inverts → all selected)',
);
assert(
  applyKeyformInvertSelection([makeCurve('A', 2)], undefined).size === 1,
  'undefined currentSelection treated as empty',
);
assert(
  applyKeyformInvertSelection([makeCurve('A', 2)], 'not a map').size === 1,
  'non-Map currentSelection treated as empty (defensive)',
);
assert(
  applyKeyformInvertSelection([null, undefined, {}, { id: 1 }], new Map()).size === 0,
  'malformed curves skipped silently',
);
assert(
  applyKeyformInvertSelection([{ id: 'A' }], new Map()).size === 0,
  'curve missing keyforms array → skipped',
);

// ─────────────────────────────────────────────────────────────────────
// Empty currentSelection → all keyforms become selected

{
  const curves = [makeCurve('A', 3), makeCurve('B', 2)];
  const out = applyKeyformInvertSelection(curves, new Map());
  assert(out.size === 2, 'empty curr → both curves present');
  const aSub = out.get('A');
  const bSub = out.get('B');
  assert(aSub && aSub.size === 3, 'A: all 3 keyforms inverted to selected');
  assert(bSub && bSub.size === 2, 'B: both keyforms inverted to selected');
  const a0 = aSub.get(0);
  assert(
    a0.center === true && a0.left === true && a0.right === true,
    'A[0]: all 3 handles true (Blender select_bezier_invert when f2 becomes selected)',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Fully-selected currentSelection → all entries cleared (omitted)

{
  const curves = [makeCurve('A', 2)];
  const curr = new Map([
    ['A', new Map([
      [0, sel(true)],
      [1, sel(true)],
    ])],
  ]);
  const out = applyKeyformInvertSelection(curves, curr);
  assert(out.size === 0, 'all-selected → all-cleared → empty outer map (sparse invariant)');
}

// ─────────────────────────────────────────────────────────────────────
// Mixed pre-state → per-keyform flip

{
  const curves = [makeCurve('A', 4)];
  const curr = new Map([
    ['A', new Map([
      [0, sel(true)],   // → cleared
      [2, sel(true)],   // → cleared
      // 1 and 3 missing → become selected
    ])],
  ]);
  const out = applyKeyformInvertSelection(curves, curr);
  const aSub = out.get('A');
  assert(aSub && aSub.size === 2, 'mixed: 2 newly-selected entries');
  assert(aSub.has(1) && aSub.has(3), 'mixed: previously-absent indices 1,3 now selected');
  assert(!aSub.has(0) && !aSub.has(2), 'mixed: previously-selected 0,2 now omitted');
  const k1 = aSub.get(1);
  assert(
    k1.center === true && k1.left === true && k1.right === true,
    'mixed: newly-selected keyform has all 3 handles true',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Handle-collapse rule — partial-handle pre-state flips to mirrored state

{
  const curves = [makeCurve('A', 2)];
  // Synthetic pre-state: handle-only selection (center=false, left=true).
  // Blender's select_bezier_invert reads f2 (center) only; f2^=SELECT
  // flips center false→true, then forces f1=f3=SELECT. Our port mirrors.
  const curr = new Map([
    ['A', new Map([
      [0, { center: false, left: true, right: false }],   // center says deselected
      [1, { center: true, left: false, right: true }],    // center says selected
    ])],
  ]);
  const out = applyKeyformInvertSelection(curves, curr);
  const aSub = out.get('A');
  assert(aSub && aSub.size === 1, 'partial-handle: only [0] flips to selected (was center:false)');
  const k0 = aSub.get(0);
  assert(
    k0.center === true && k0.left === true && k0.right === true,
    'partial-handle: [0] inverted → handles force-mirror new center=true (Blender keyframes_edit.cc:1571-1573)',
  );
  assert(
    !aSub.has(1),
    'partial-handle: [1] was center:true → inverted to center:false → omitted (force-mirror to false: keyframes_edit.cc:1575-1577)',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Hidden curves dropped — caller pre-filters visibleFCurves

{
  // Curve 'A' is visible; curve 'B' is NOT in visibleFCurves (would be
  // hidden via fcurve.hide). 'B' has a pre-existing entry; it should be
  // DROPPED in the output — matching operatorSelectAll's behavior.
  const visibleCurves = [makeCurve('A', 2)];
  const curr = new Map([
    ['A', new Map([[0, sel(true)]])],
    ['B', new Map([[0, sel(true)], [1, sel(true)]])],
  ]);
  const out = applyKeyformInvertSelection(visibleCurves, curr);
  assert(!out.has('B'), 'hidden curve B: entry dropped (ANIMFILTER_CURVE_VISIBLE port)');
  assert(out.has('A'), 'visible curve A: still present');
  const aSub = out.get('A');
  // A[0] was selected → cleared; A[1] absent → selected
  assert(aSub.size === 1 && aSub.has(1), 'A: [0] cleared, [1] selected');
}

// ─────────────────────────────────────────────────────────────────────
// Ghost entries in currentSelection (idx beyond keyforms.length)

{
  const curves = [makeCurve('A', 2)];
  const curr = new Map([
    ['A', new Map([
      [0, sel(true)],
      [5, sel(true)],   // ghost: keyforms.length is 2
      [99, sel(true)],  // ghost
    ])],
  ]);
  const out = applyKeyformInvertSelection(curves, curr);
  const aSub = out.get('A');
  // Loop only walks 0..keyforms.length-1, so ghost indices are silently
  // dropped from the output. [0] was selected → cleared; [1] absent →
  // selected. Final sub-map has only [1].
  assert(aSub && aSub.size === 1 && aSub.has(1), 'ghost entries dropped (loop bounded by keyforms.length)');
}

// ─────────────────────────────────────────────────────────────────────
// Input immutability — current selection is not mutated

{
  const curves = [makeCurve('A', 3)];
  const innerMap = new Map([
    [0, sel(true)],
    [1, sel(true)],
    [2, sel(true)],
  ]);
  const curr = new Map([['A', innerMap]]);
  const sizeBefore = innerMap.size;
  const refBefore = innerMap;
  applyKeyformInvertSelection(curves, curr);
  assert(innerMap.size === sizeBefore, 'currentSelection sub-map not mutated (size preserved)');
  assert(curr.get('A') === refBefore, 'currentSelection sub-map reference preserved');
  const k0After = innerMap.get(0);
  assert(
    k0After.center === true && k0After.left === true && k0After.right === true,
    'currentSelection entry objects not mutated',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Double-invert returns to original state (involution property)

{
  const curves = [makeCurve('A', 3)];
  const start = new Map([
    ['A', new Map([
      [0, sel(true)],
      [2, sel(true)],
    ])],
  ]);
  const once = applyKeyformInvertSelection(curves, start);
  const twice = applyKeyformInvertSelection(curves, once);
  // After double invert: indices that were originally selected should be
  // selected again; originally-absent should be absent.
  const aSub = twice.get('A');
  assert(aSub && aSub.size === 2, 'double-invert restores cardinality');
  assert(aSub.has(0) && aSub.has(2), 'double-invert: 0,2 selected (matches start)');
  assert(!aSub.has(1), 'double-invert: 1 absent (matches start)');
}

// ─────────────────────────────────────────────────────────────────────
// Curve with zero keyforms → not added to output

{
  const curves = [makeCurve('A', 0), makeCurve('B', 2)];
  const out = applyKeyformInvertSelection(curves, new Map());
  assert(!out.has('A'), 'zero-keyform curve: not in output (operatorSelectAll convention)');
  assert(out.has('B'), 'non-empty curve: present');
}

// ─────────────────────────────────────────────────────────────────────
// Sister-field preservation — when selection passes through the helper,
// the wrapper `{ center, left, right }` object shape stays canonical

{
  const curves = [makeCurve('A', 1)];
  const out = applyKeyformInvertSelection(curves, new Map());
  const entry = out.get('A').get(0);
  const keys = Object.keys(entry).sort();
  assert(
    keys.length === 3 && keys[0] === 'center' && keys[1] === 'left' && keys[2] === 'right',
    'output entry shape is { center, left, right } — no extra fields, no missing fields',
  );
}

// ─────────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
