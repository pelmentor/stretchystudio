// Tests for src/anim/dopesheetSelectOps.js — Animation Phase 6 Slice 6.A
// Dopesheet tick selection ops. Run: node scripts/test/test_dopesheetSelectOps.mjs
//
// Coverage:
//   §1  — applyTickSelectReplace happy path (empty → 1 entry)
//   §2  — applyTickSelectReplace clears prior selections
//   §3  — applyTickSelectReplace identity-stable on same-tick re-click
//   §4  — applyTickSelectReplace input validation (Rule №1 throws)
//   §5  — applyTickSelectExtend adds when not present
//   §6  — applyTickSelectExtend toggles off when present
//   §7  — applyTickSelectExtend preserves OTHER fcurves' selections
//   §8  — applyTickSelectExtend drops fcurveId when sub empties
//   §9  — applyTickSelectExtend input validation
//   §10 — applyTickSelectDeselect removes the tick when present
//   §11 — applyTickSelectDeselect identity-stable when tick not present
//   §12 — applyTickSelectDeselect drops fcurveId when sub empties
//   §13 — applyTickSelectDeselect preserves OTHER fcurves' selections
//   §14 — isTickSelected basic semantics
//   §15 — Immutability: input handles + inner subs never mutated
//   §16 — Identity-stable returns trigger setHandles skip
//   §17 — All 3 ops emit fresh Map instances (no shared references)

import {
  applyTickSelectReplace,
  applyTickSelectExtend,
  applyTickSelectDeselect,
  isTickSelected,
} from '../../src/anim/dopesheetSelectOps.js';

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

// ── 1. applyTickSelectReplace happy path ────────────────────────────
{
  const handles = new Map();
  const next = applyTickSelectReplace(handles, 'fc1', 5);
  eq(next.size, 1, '1a: 1 entry');
  assert(next.has('fc1'), '1b: has fc1');
  const sub = next.get('fc1');
  eq(sub.size, 1, '1c: sub has 1 entry');
  const parts = sub.get(5);
  eq(parts.center, true, '1d: center=true');
  eq(parts.left, true, '1e: left=true');
  eq(parts.right, true, '1f: right=true');
}

// ── 2. applyTickSelectReplace clears prior selections ───────────────
{
  const handles = fixture([['fcA', 1], ['fcA', 2], ['fcB', 3]]);
  const next = applyTickSelectReplace(handles, 'fcA', 99);
  eq(next.size, 1, '2a: replaced — only fcA present');
  assert(!next.has('fcB'), '2b: fcB cleared');
  const sub = next.get('fcA');
  eq(sub.size, 1, '2c: only the new entry on fcA');
  assert(sub.has(99), '2d: kf 99 present');
  assert(!sub.has(1), '2e: prior kf 1 cleared');
}

// ── 3. applyTickSelectReplace identity-stable on same-tick re-click ─
{
  const h1 = applyTickSelectReplace(new Map(), 'fc1', 0);
  const h2 = applyTickSelectReplace(h1, 'fc1', 0);
  assert(h1 === h2, '3: same-tick re-replace returns SAME ref (no-op)');
}

// ── 4. applyTickSelectReplace input validation ──────────────────────
{
  throws(
    () => applyTickSelectReplace(new Map(), '', 0),
    /fcurveId must be a non-empty string/,
    '4a: empty fcurveId throws'
  );
  throws(
    () => applyTickSelectReplace(new Map(), 'fc1', -1),
    /keyformIdx must be a non-negative integer/,
    '4b: negative idx throws'
  );
  throws(
    () => applyTickSelectReplace(new Map(), 'fc1', 1.5),
    /keyformIdx must be a non-negative integer/,
    '4c: non-integer idx throws'
  );
  throws(
    () => applyTickSelectReplace(new Map(), /** @type any */ (null), 0),
    /fcurveId must be a non-empty string/,
    '4d: null fcurveId throws'
  );
}

// ── 5. applyTickSelectExtend adds when not present ──────────────────
{
  const handles = new Map();
  const next = applyTickSelectExtend(handles, 'fc1', 5);
  eq(next.size, 1, '5a: 1 entry');
  const sub = next.get('fc1');
  eq(sub.size, 1, '5b: sub has 1');
  eq(sub.get(5).center, true, '5c: full select');
}

// ── 6. applyTickSelectExtend toggles off when present ───────────────
{
  const handles = fixture([['fc1', 5]]);
  const next = applyTickSelectExtend(handles, 'fc1', 5);
  eq(next.size, 0, '6a: outer Map emptied (subselect emptied → fcurveId dropped)');
  assert(!next.has('fc1'), '6b: fc1 removed');
}

// ── 7. applyTickSelectExtend preserves OTHER fcurves' selections ────
{
  const handles = fixture([['fcA', 1], ['fcB', 2], ['fcB', 3]]);
  const next = applyTickSelectExtend(handles, 'fcA', 99);
  eq(next.size, 2, '7a: still 2 fcurves');
  const subA = next.get('fcA');
  eq(subA.size, 2, '7b: fcA has both kf 1 (kept) + kf 99 (new)');
  assert(subA.has(1), '7c: kf 1 preserved');
  assert(subA.has(99), '7d: kf 99 added');
  const subB = next.get('fcB');
  eq(subB.size, 2, '7e: fcB untouched (2 entries)');
}

// ── 8. applyTickSelectExtend drops fcurveId when sub empties ────────
{
  const handles = fixture([['fcA', 1], ['fcB', 2]]);
  const next = applyTickSelectExtend(handles, 'fcA', 1);   // toggle off
  eq(next.size, 1, '8a: outer Map has 1 entry');
  assert(next.has('fcB'), '8b: fcB still present');
  assert(!next.has('fcA'), '8c: fcA dropped (sub emptied)');
}

// ── 9. applyTickSelectExtend input validation ───────────────────────
{
  throws(
    () => applyTickSelectExtend(new Map(), '', 0),
    /fcurveId must be a non-empty string/,
    '9a: empty fcurveId throws'
  );
  throws(
    () => applyTickSelectExtend(new Map(), 'fc1', NaN),
    /keyformIdx must be a non-negative integer/,
    '9b: NaN idx throws'
  );
}

// ── 10. applyTickSelectDeselect removes when present ────────────────
{
  const handles = fixture([['fcA', 1], ['fcA', 2]]);
  const next = applyTickSelectDeselect(handles, 'fcA', 1);
  eq(next.size, 1, '10a: 1 entry');
  const sub = next.get('fcA');
  eq(sub.size, 1, '10b: kf 1 removed; kf 2 stays');
  assert(sub.has(2), '10c: kf 2 still present');
  assert(!sub.has(1), '10d: kf 1 gone');
}

// ── 11. applyTickSelectDeselect identity-stable when not present ────
{
  const handles = fixture([['fcA', 1]]);
  const next1 = applyTickSelectDeselect(handles, 'fcA', 999);   // wrong idx
  assert(next1 === handles, '11a: missing kf → same ref');
  const next2 = applyTickSelectDeselect(handles, 'fcMissing', 1);   // wrong fid
  assert(next2 === handles, '11b: missing fcurveId → same ref');
}

// ── 12. applyTickSelectDeselect drops fcurveId when sub empties ─────
{
  const handles = fixture([['fcA', 1], ['fcB', 2]]);
  const next = applyTickSelectDeselect(handles, 'fcA', 1);
  eq(next.size, 1, '12a: outer has 1 entry');
  assert(!next.has('fcA'), '12b: fcA dropped after subselect emptied');
  assert(next.has('fcB'), '12c: fcB preserved');
}

// ── 13. applyTickSelectDeselect preserves OTHER fcurves ─────────────
{
  const handles = fixture([['fcA', 1], ['fcA', 2], ['fcB', 3]]);
  const next = applyTickSelectDeselect(handles, 'fcA', 1);
  eq(next.size, 2, '13a: still 2 fcurves');
  const subA = next.get('fcA');
  eq(subA.size, 1, '13b: fcA has just kf 2');
  const subB = next.get('fcB');
  eq(subB.size, 1, '13c: fcB unchanged');
}

// ── 14. isTickSelected basic semantics ──────────────────────────────
{
  const handles = fixture([['fc1', 5]]);
  eq(isTickSelected(handles, 'fc1', 5), true, '14a: present + center=true');
  eq(isTickSelected(handles, 'fc1', 99), false, '14b: missing idx');
  eq(isTickSelected(handles, 'fcMissing', 5), false, '14c: missing fcurveId');
  eq(isTickSelected(null, 'fc1', 5), false, '14d: null handles');
  eq(isTickSelected(handles, '', 5), false, '14e: empty fcurveId');
  eq(isTickSelected(handles, 'fc1', -1), false, '14f: negative idx');
}

// ── 15. Immutability: input handles + inner subs never mutated ──────
{
  const handles = fixture([['fcA', 1], ['fcA', 2], ['fcB', 3]]);
  const subABefore = handles.get('fcA');
  const subASizeBefore = subABefore.size;
  applyTickSelectReplace(handles, 'fcA', 99);
  applyTickSelectExtend(handles, 'fcA', 99);
  applyTickSelectDeselect(handles, 'fcA', 1);
  // After all 3 ops, the input handles map must be unchanged.
  eq(handles.size, 2, '15a: outer size unchanged');
  eq(subABefore.size, subASizeBefore, '15b: inner subA size unchanged');
  assert(handles.get('fcA') === subABefore, '15c: inner subA ref preserved on input');
}

// ── 16. Identity-stable returns trigger setHandles skip ─────────────
{
  // Confirms that the no-op paths return the SAME reference (so the
  // store's identity-stable setHandles can skip the set() call).
  const h = fixture([['fc1', 5]]);
  const r1 = applyTickSelectReplace(h, 'fc1', 5);   // already exactly this
  assert(r1 === h, '16a: replace no-op same-ref');
  const r2 = applyTickSelectDeselect(h, 'fc1', 999);   // tick not present
  assert(r2 === h, '16b: deselect no-op same-ref');
  // Audit-fix Slice 6.A MED-A3: extend on an absent tick is NOT a
  // no-op (always adds → outer Map changes). Extend on a present tick
  // is also NOT a no-op (always removes → outer Map changes). Both
  // toggle paths always emit a new outer Map. Documented behavior.
  const r3 = applyTickSelectExtend(h, 'fc1', 99);   // new tick → toggle on
  assert(r3 !== h, '16c: extend toggle-on always new ref (no no-op)');
  const r4 = applyTickSelectExtend(h, 'fc1', 5);    // present tick → toggle off
  assert(r4 !== h, '16d: extend toggle-off always new ref (no no-op)');
}

// ── 17. All 3 ops emit fresh Map instances (no shared refs) ────────
{
  const h = fixture([['fcA', 1]]);
  const r1 = applyTickSelectReplace(h, 'fcB', 2);
  assert(r1 !== h, '17a: replace returns new outer');
  const r2 = applyTickSelectExtend(h, 'fcA', 99);
  assert(r2 !== h, '17b: extend returns new outer');
  assert(r2.get('fcA') !== h.get('fcA'), '17c: extend returns new inner sub for affected fcurve');
  const r3 = applyTickSelectDeselect(h, 'fcA', 1);
  assert(r3 !== h, '17d: deselect returns new outer when change happens');
}

console.log(`\ndopesheetSelectOps: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
