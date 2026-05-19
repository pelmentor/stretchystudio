// Tests for src/anim/dopesheetBoxSelect.js — Animation Phase 6 Slice 6.B.
// Run: node scripts/test/test_dopesheetBoxSelect.mjs
//
// Coverage:
//   §1  — applyBoxSelect input validation (Rule №1 throws)
//   §2  — per-hit shape validation throws
//   §3  — 'replace' mode happy path: clears all + adds hits
//   §4  — 'replace' empty handles + empty hits → identity-stable no-op
//   §5  — 'replace' non-empty handles + empty hits → fresh empty Map (change)
//   §6  — 'replace' producing exact-equal prior → identity-stable no-op
//   §7  — 'extend' adds hits to existing selection (no pre-clear)
//   §8  — 'extend' empty hits → identity-stable no-op
//   §9  — 'extend' force-adds (doesn't toggle off when hit is present)
//   §10 — 'subtract' removes hits from existing selection
//   §11 — 'subtract' empty hits → identity-stable no-op
//   §12 — 'subtract' nothing-to-remove (hits not in selection) → identity-stable
//   §13 — 'subtract' drops fcurveId when inner sub empties
//   §14 — Immutability: input handles + inner subs never mutated
//   §15 — All ops emit FULL handles (center+left+right all true)
//   §16 — computeBoxHits time-axis range
//   §17 — computeBoxHits inclusive boundaries (tMin / tMax on a key)
//   §18 — computeBoxHits skips empty-fcurveId / missing keyforms rows
//   §19 — computeBoxHits normalizes inverted ranges (tMin > tMax)
//   §20 — computeBoxHits non-finite bounds returns empty
//   §21 — Multiple hits on same fcurveId compose into one sub-Map

import {
  applyBoxSelect,
  computeBoxHits,
  BOX_SELECT_MODES,
} from '../../src/anim/dopesheetBoxSelect.js';

let passed = 0, failed = 0;
const failures = [];
function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++; failures.push(name); console.error(`FAIL: ${name}`);
}
function eq(a, b, name) {
  if (a === b) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${JSON.stringify(a)}\n   expected: ${JSON.stringify(b)}`);
}
function throws(fn, msgRe, name) {
  try { fn(); }
  catch (e) {
    const msg = e?.message ?? String(e);
    if (msgRe.test(msg)) { passed++; return; }
    failed++; failures.push(name);
    console.error(`FAIL: ${name}\n   threw but message didn't match ${msgRe}: ${msg}`);
    return;
  }
  failed++; failures.push(name);
  console.error(`FAIL: ${name} — expected throw, no throw`);
}

const FULL = { center: true, left: true, right: true };

function fixture(entries = []) {
  /** @type {Map<string, Map<number, {center:boolean,left:boolean,right:boolean}>>} */
  const m = new Map();
  for (const [fid, idx] of entries) {
    if (!m.has(fid)) m.set(fid, new Map());
    /** @type {Map<number, any>} */
    const sub = /** @type {any} */ (m.get(fid));
    sub.set(idx, { ...FULL });
  }
  return m;
}

// ── 1. applyBoxSelect input validation ──────────────────────────────────
{
  throws(
    () => applyBoxSelect(new Map(), [], /** @type any */ ('bogus')),
    /mode must be one of/,
    '1a: bad mode throws'
  );
  throws(
    () => applyBoxSelect(new Map(), /** @type any */ (null), 'replace'),
    /hitsInRect must be an array/,
    '1b: null hitsInRect throws'
  );
  throws(
    () => applyBoxSelect(new Map(), /** @type any */ ('not-array'), 'replace'),
    /hitsInRect must be an array/,
    '1c: string hitsInRect throws'
  );
}

// ── 2. per-hit shape validation throws ──────────────────────────────────
{
  throws(
    () => applyBoxSelect(new Map(), [{ fcurveId: '', kfIdx: 0 }], 'replace'),
    /each hit must be/,
    '2a: empty fcurveId throws'
  );
  throws(
    () => applyBoxSelect(new Map(), [{ fcurveId: 'fc1', kfIdx: -1 }], 'replace'),
    /each hit must be/,
    '2b: negative kfIdx throws'
  );
  throws(
    () => applyBoxSelect(new Map(), [{ fcurveId: 'fc1', kfIdx: 1.5 }], 'replace'),
    /each hit must be/,
    '2c: non-integer kfIdx throws'
  );
  throws(
    () => applyBoxSelect(new Map(), [null], 'replace'),
    /each hit must be/,
    '2d: null entry throws'
  );
}

// ── 3. 'replace' clears all + adds hits ─────────────────────────────────
{
  const handles = fixture([['fcA', 1], ['fcB', 2], ['fcB', 3]]);
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcC', kfIdx: 99 }, { fcurveId: 'fcC', kfIdx: 100 }],
    'replace',
  );
  eq(next.size, 1, '3a: only fcC (prior fcA/fcB cleared)');
  assert(!next.has('fcA'), '3b: fcA cleared');
  assert(!next.has('fcB'), '3c: fcB cleared');
  const subC = next.get('fcC');
  eq(subC.size, 2, '3d: fcC has both new hits');
  assert(subC.has(99), '3e: kf 99 present');
  assert(subC.has(100), '3f: kf 100 present');
}

// ── 4. 'replace' empty handles + empty hits → identity-stable no-op ─────
{
  const handles = new Map();
  const next = applyBoxSelect(handles, [], 'replace');
  assert(next === handles, '4: empty + no hits → same ref');
}

// ── 5. 'replace' non-empty handles + empty hits → fresh empty Map ───────
{
  const handles = fixture([['fcA', 1]]);
  const next = applyBoxSelect(handles, [], 'replace');
  assert(next !== handles, '5a: different ref (clear is a change)');
  eq(next.size, 0, '5b: cleared');
}

// ── 6. 'replace' producing exact-equal prior → identity-stable no-op ────
{
  const handles = fixture([['fcA', 5]]);
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcA', kfIdx: 5 }],
    'replace',
  );
  assert(next === handles, '6: replace producing identical state → same ref');
}

// ── 7. 'extend' adds hits to existing selection (no pre-clear) ──────────
{
  const handles = fixture([['fcA', 1], ['fcB', 2]]);
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcC', kfIdx: 99 }],
    'extend',
  );
  eq(next.size, 3, '7a: 3 fcurves (existing 2 + new fcC)');
  assert(next.has('fcA'), '7b: fcA preserved');
  assert(next.has('fcB'), '7c: fcB preserved');
  assert(next.has('fcC'), '7d: fcC added');
}

// ── 8. 'extend' empty hits → identity-stable no-op ──────────────────────
{
  const handles = fixture([['fcA', 1]]);
  const next = applyBoxSelect(handles, [], 'extend');
  assert(next === handles, '8: extend with no hits → same ref');
}

// ── 9. 'extend' force-adds (no toggle-off semantic) ─────────────────────
{
  const handles = fixture([['fcA', 1]]);
  // Extend a tick that's already selected — should remain selected
  // (force-add, NOT the toggle semantic of dopesheetSelectOps.extend).
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcA', kfIdx: 1 }],
    'extend',
  );
  // The op produces a new outer Map (the inner sub got a new
  // FULL_SELECT object), but the result is structurally equivalent.
  eq(next.size, 1, '9a: 1 fcurve');
  const sub = next.get('fcA');
  eq(sub.size, 1, '9b: 1 keyform');
  assert(sub.get(1).center === true, '9c: still selected');
}

// ── 10. 'subtract' removes hits from existing selection ─────────────────
{
  const handles = fixture([['fcA', 1], ['fcA', 2], ['fcB', 3]]);
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcA', kfIdx: 2 }],
    'subtract',
  );
  eq(next.size, 2, '10a: still 2 fcurves');
  const subA = next.get('fcA');
  eq(subA.size, 1, '10b: fcA has only kf 1 left');
  assert(subA.has(1), '10c: kf 1 preserved');
  assert(!subA.has(2), '10d: kf 2 removed');
  const subB = next.get('fcB');
  eq(subB.size, 1, '10e: fcB unchanged');
}

// ── 11. 'subtract' empty hits → identity-stable no-op ───────────────────
{
  const handles = fixture([['fcA', 1]]);
  const next = applyBoxSelect(handles, [], 'subtract');
  assert(next === handles, '11: subtract with no hits → same ref');
}

// ── 12. 'subtract' nothing-to-remove → identity-stable no-op ────────────
{
  const handles = fixture([['fcA', 1]]);
  // Hit that wasn't selected
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcA', kfIdx: 999 }, { fcurveId: 'fcZ', kfIdx: 0 }],
    'subtract',
  );
  assert(next === handles, '12: all hits absent → same ref');
}

// ── 13. 'subtract' drops fcurveId when inner sub empties ────────────────
{
  const handles = fixture([['fcA', 1], ['fcB', 2]]);
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcA', kfIdx: 1 }],
    'subtract',
  );
  eq(next.size, 1, '13a: 1 fcurve (fcA dropped)');
  assert(!next.has('fcA'), '13b: fcA removed (sub emptied)');
  assert(next.has('fcB'), '13c: fcB preserved');
}

// ── 14. Immutability: input handles + inner subs never mutated ──────────
{
  const handles = fixture([['fcA', 1], ['fcA', 2], ['fcB', 3]]);
  const subABefore = handles.get('fcA');
  const subASizeBefore = subABefore.size;
  applyBoxSelect(handles, [{ fcurveId: 'fcA', kfIdx: 99 }], 'replace');
  applyBoxSelect(handles, [{ fcurveId: 'fcA', kfIdx: 99 }], 'extend');
  applyBoxSelect(handles, [{ fcurveId: 'fcA', kfIdx: 1 }], 'subtract');
  eq(handles.size, 2, '14a: outer size unchanged');
  eq(subABefore.size, subASizeBefore, '14b: inner subA size unchanged');
  assert(handles.get('fcA') === subABefore, '14c: inner subA ref preserved');
}

// ── 15. All ops emit FULL handles (center+left+right all true) ──────────
{
  const handles = new Map();
  const next = applyBoxSelect(
    handles,
    [{ fcurveId: 'fcA', kfIdx: 5 }],
    'replace',
  );
  const parts = next.get('fcA').get(5);
  eq(parts.center, true, '15a: center=true');
  eq(parts.left, true, '15b: left=true');
  eq(parts.right, true, '15c: right=true');
}

// ── 16. computeBoxHits time-axis range ──────────────────────────────────
{
  const rows = [
    { fcurveId: 'fcA', keyforms: [{time: 100}, {time: 250}, {time: 500}, {time: 800}] },
    { fcurveId: 'fcB', keyforms: [{time: 50}, {time: 300}, {time: 700}] },
  ];
  // Rect t ∈ [200, 600] selects: fcA kf 1 (250) + fcA kf 2 (500) + fcB kf 1 (300)
  const hits = computeBoxHits(rows, 200, 600);
  eq(hits.length, 3, '16a: 3 hits');
  assert(
    hits.some((h) => h.fcurveId === 'fcA' && h.kfIdx === 1),
    '16b: fcA kf 1 hit'
  );
  assert(
    hits.some((h) => h.fcurveId === 'fcA' && h.kfIdx === 2),
    '16c: fcA kf 2 hit'
  );
  assert(
    hits.some((h) => h.fcurveId === 'fcB' && h.kfIdx === 1),
    '16d: fcB kf 1 hit'
  );
}

// ── 17. computeBoxHits inclusive boundaries ─────────────────────────────
{
  const rows = [
    { fcurveId: 'fcA', keyforms: [{time: 100}, {time: 200}, {time: 300}] },
  ];
  // Inclusive: tMin=200 includes kf 1; tMax=200 includes kf 1
  const hits = computeBoxHits(rows, 200, 200);
  eq(hits.length, 1, '17a: 1 hit at exact boundary');
  eq(hits[0].kfIdx, 1, '17b: kf 1 (time=200)');
}

// ── 18. computeBoxHits skips empty-fcurveId / missing keyforms rows ─────
{
  const rows = [
    { fcurveId: '', keyforms: [{time: 100}] },                    // synthetic row
    { fcurveId: null, keyforms: [{time: 100}] },                  // null
    { fcurveId: 'fcA' },                                          // missing keyforms
    { fcurveId: 'fcB', keyforms: null },                          // null keyforms
    { fcurveId: 'fcC', keyforms: [{time: 100}] },                 // valid
  ];
  const hits = computeBoxHits(rows, 0, 1000);
  eq(hits.length, 1, '18a: only fcC hit (others skipped)');
  eq(hits[0].fcurveId, 'fcC', '18b: hit is fcC');
}

// ── 19. computeBoxHits normalizes inverted ranges ───────────────────────
{
  const rows = [
    { fcurveId: 'fcA', keyforms: [{time: 100}, {time: 500}] },
  ];
  // Inverted range — should still work
  const hits = computeBoxHits(rows, 600, 50);
  eq(hits.length, 2, '19a: both hits even with inverted bounds');
}

// ── 20. computeBoxHits non-finite bounds returns empty ──────────────────
{
  const rows = [{ fcurveId: 'fcA', keyforms: [{time: 100}] }];
  eq(computeBoxHits(rows, NaN, 100).length, 0, '20a: NaN tMin → empty');
  eq(computeBoxHits(rows, 0, Infinity).length, 0, '20b: Infinity tMax → empty');
  eq(computeBoxHits(null, 0, 100).length, 0, '20c: null rows → empty');
}

// ── 21. Multiple hits on same fcurveId compose into one sub-Map ─────────
{
  const handles = new Map();
  const next = applyBoxSelect(
    handles,
    [
      { fcurveId: 'fcA', kfIdx: 1 },
      { fcurveId: 'fcA', kfIdx: 2 },
      { fcurveId: 'fcA', kfIdx: 3 },
      { fcurveId: 'fcB', kfIdx: 1 },
    ],
    'replace',
  );
  eq(next.size, 2, '21a: 2 fcurves (fcA + fcB)');
  eq(next.get('fcA').size, 3, '21b: fcA has all 3 hits in one sub');
  eq(next.get('fcB').size, 1, '21c: fcB has 1');
}

// ── 22. BOX_SELECT_MODES is the expected frozen list ────────────────────
{
  eq(BOX_SELECT_MODES.length, 3, '22a: 3 modes');
  assert(BOX_SELECT_MODES.includes('replace'), '22b: replace');
  assert(BOX_SELECT_MODES.includes('extend'), '22c: extend');
  assert(BOX_SELECT_MODES.includes('subtract'), '22d: subtract');
  assert(Object.isFrozen(BOX_SELECT_MODES), '22e: frozen');
}

console.log(`\ndopesheetBoxSelect: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
