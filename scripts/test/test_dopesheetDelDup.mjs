// Tests for src/anim/dopesheetDelDup.js — Animation Phase 6 Slice 6.D.
// Run: node scripts/test/test_dopesheetDelDup.mjs
//
// Coverage:
//   §1  — wouldDelDupChange false on null/empty/center-less
//   §2  — wouldDelDupChange true on real selection
//   §3  — applyDeleteKeyforms Rule №1 input validation throws
//   §4  — applyDeleteKeyforms no-op when handles empty
//   §5  — applyDeleteKeyforms skips fcurve with no center bits
//   §6  — applyDeleteKeyforms deletes single selected keyform
//   §7  — applyDeleteKeyforms deletes multiple selected keyforms
//   §8  — applyDeleteKeyforms remap marks deleted as -1
//   §9  — applyDeleteKeyforms skips unselected siblings
//   §10 — applyDeleteKeyforms handles-only (no center) → no delete
//   §11 — applyDeleteKeyforms preserves empty fcurve (SS DEV 7)
//   §12 — applyDeleteKeyforms multi-fcurve mixed selection
//   §13 — applyDeleteKeyforms skips out-of-bounds keyform indices
//   §14 — applyDuplicateKeyforms Rule №1 input validation throws
//   §15 — applyDuplicateKeyforms no-op when handles empty
//   §16 — applyDuplicateKeyforms skips fcurve with no center bits
//   §17 — applyDuplicateKeyforms inserts copy after selected
//   §18 — applyDuplicateKeyforms remap points at DUPLICATE position
//   §19 — applyDuplicateKeyforms handles-only (no center) → no duplicate
//   §20 — applyDuplicateKeyforms multiple selected → all duplicated
//   §21 — applyDuplicateKeyforms remap accounts for prior-insert shifts
//   §22 — applyDuplicateKeyforms duplicate is deep-copy (independent handles)
//   §23 — applyDuplicateKeyforms preserves unselected sibling values
//   §24 — applyDuplicateKeyforms duplicate carries same time as original
//   §25 — applyDuplicateKeyforms multi-fcurve mixed selection
//   §26 — applyDuplicateKeyforms skips out-of-bounds keyform indices
//   §27 — Round-trip: delete then remap drops selection entries
//   §28 — Round-trip: duplicate then remap re-targets selection at copies

import {
  applyDeleteKeyforms,
  applyDuplicateKeyforms,
  wouldDelDupChange,
} from '../../src/anim/dopesheetDelDup.js';
import { remapHandlesAfterTranslate } from '../../src/anim/dopesheetGrab.js';

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
  console.error(`FAIL: ${name} — expected throw, got none`);
}

// ── helpers ─────────────────────────────────────────────────────────────
function makeKf(time, value, opts = {}) {
  return {
    time, value,
    handleLeft:  opts.handleLeft  ?? { time: time - 100, value },
    handleRight: opts.handleRight ?? { time: time + 100, value },
    handleType:  { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  };
}
function makeFc(id, kfs) {
  return { id, keyforms: kfs, fcurveType: 'rna' };
}
function makeAction(fcs) {
  return { id: 'a1', name: 'a1', fcurves: fcs, duration: 5000 };
}
function makeHandles(entries) {
  const m = new Map();
  for (const [fcid, inner] of entries) {
    const sub = new Map();
    for (const [idx, parts] of inner) sub.set(idx, parts);
    m.set(fcid, sub);
  }
  return m;
}
const ALL = { center: true, left: true, right: true };
const CENTER_ONLY = { center: true, left: false, right: false };
const HANDLES_ONLY = { center: false, left: true, right: true };

// ── §1 — wouldDelDupChange false on null/empty/center-less ─────────────
{
  eq(wouldDelDupChange(null), false, '§1 null → false');
  eq(wouldDelDupChange(undefined), false, '§1 undefined → false');
  eq(wouldDelDupChange(new Map()), false, '§1 empty Map → false');
  const noCenter = makeHandles([['fc1', [[0, HANDLES_ONLY]]]]);
  eq(wouldDelDupChange(noCenter), false, '§1 no-center → false');
}

// ── §2 — wouldDelDupChange true on real selection ──────────────────────
{
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  eq(wouldDelDupChange(h), true, '§2 single center → true');
  const center = makeHandles([['fc1', [[0, CENTER_ONLY]]]]);
  eq(wouldDelDupChange(center), true, '§2 center-only → true');
}

// ── §3 — applyDeleteKeyforms Rule №1 input validation ─────────────────
{
  throws(() => applyDeleteKeyforms(null, new Map()),
    /non-null object/, '§3 null action throws');
  throws(() => applyDeleteKeyforms({ fcurves: 'nope' }, new Map()),
    /must be an array/, '§3 non-array fcurves throws');
}

// ── §4 — applyDeleteKeyforms no-op when handles empty ──────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const r = applyDeleteKeyforms(action, new Map());
  eq(r.changed, false, '§4 empty handles → changed=false');
  eq(r.remaps.size, 0, '§4 empty handles → empty remaps');
  eq(action.fcurves[0].keyforms.length, 1, '§4 keyform untouched');
}

// ── §5 — applyDeleteKeyforms skips fcurve with no center bits ──────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, HANDLES_ONLY]]]]);
  const r = applyDeleteKeyforms(action, h);
  eq(r.changed, false, '§5 handles-only → changed=false');
  eq(action.fcurves[0].keyforms.length, 1, '§5 keyform untouched');
}

// ── §6 — applyDeleteKeyforms deletes single selected keyform ───────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2), makeKf(300, 3),
  ])]);
  const h = makeHandles([['fc1', [[1, ALL]]]]);   // middle
  const r = applyDeleteKeyforms(action, h);
  eq(r.changed, true, '§6 changed=true');
  eq(action.fcurves[0].keyforms.length, 2, '§6 length 3→2');
  eq(action.fcurves[0].keyforms[0].time, 100, '§6 first survives');
  eq(action.fcurves[0].keyforms[1].time, 300, '§6 third survives at idx 1');
}

// ── §7 — applyDeleteKeyforms deletes multiple selected keyforms ────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2), makeKf(300, 3), makeKf(400, 4),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL], [2, ALL]]]]);
  const r = applyDeleteKeyforms(action, h);
  eq(action.fcurves[0].keyforms.length, 2, '§7 length 4→2');
  eq(action.fcurves[0].keyforms[0].time, 200, '§7 idx 1 survives at idx 0');
  eq(action.fcurves[0].keyforms[1].time, 400, '§7 idx 3 survives at idx 1');
}

// ── §8 — remap marks deleted as -1 ──────────────────────────────────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2), makeKf(300, 3),
  ])]);
  const h = makeHandles([['fc1', [[1, ALL]]]]);
  const r = applyDeleteKeyforms(action, h);
  const fcRemap = r.remaps.get('fc1');
  assert(fcRemap, '§8 remap has fc1');
  eq(fcRemap.get(0), 0, '§8 idx 0 stays');
  eq(fcRemap.get(1), -1, '§8 idx 1 deleted (-1)');
  eq(fcRemap.get(2), 1, '§8 idx 2 → 1');
}

// ── §9 — skips unselected siblings ──────────────────────────────────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyDeleteKeyforms(action, h);
  eq(action.fcurves[0].keyforms.length, 1, '§9 length 2→1');
  eq(action.fcurves[0].keyforms[0].time, 200, '§9 unselected sibling survives');
}

// ── §10 — handles-only (no center) → no delete ─────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, HANDLES_ONLY]]]]);
  const r = applyDeleteKeyforms(action, h);
  eq(r.changed, false, '§10 handles-only → changed=false');
  eq(action.fcurves[0].keyforms.length, 1, '§10 keyform retained');
}

// ── §11 — preserves empty fcurve (SS DEV 7) ────────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyDeleteKeyforms(action, h);
  eq(action.fcurves.length, 1, '§11 SS DEV 7: empty fcurve NOT auto-removed');
  eq(action.fcurves[0].keyforms.length, 0, '§11 fcurve has 0 keyforms');
  eq(action.fcurves[0].id, 'fc1', '§11 fcurve identity preserved');
}

// ── §12 — multi-fcurve mixed selection ─────────────────────────────────
{
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 0), makeKf(200, 0)]),
    makeFc('fc2', [makeKf(150, 0), makeKf(250, 0)]),
    makeFc('fc3', [makeKf(50, 0)]),    // no selection → untouched
  ]);
  const h = makeHandles([
    ['fc1', [[0, ALL]]],
    ['fc2', [[1, ALL]]],
  ]);
  const r = applyDeleteKeyforms(action, h);
  eq(action.fcurves[0].keyforms.length, 1, '§12 fc1 length 2→1');
  eq(action.fcurves[0].keyforms[0].time, 200, '§12 fc1 idx 1 survives');
  eq(action.fcurves[1].keyforms.length, 1, '§12 fc2 length 2→1');
  eq(action.fcurves[1].keyforms[0].time, 150, '§12 fc2 idx 0 survives');
  eq(action.fcurves[2].keyforms.length, 1, '§12 fc3 untouched');
  assert(r.remaps.has('fc1') && r.remaps.has('fc2'), '§12 remap covers fc1+fc2');
  assert(!r.remaps.has('fc3'), '§12 remap omits untouched fc3');
}

// ── §13 — skips out-of-bounds keyform indices ──────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[5, ALL]]]]);   // OOB
  const r = applyDeleteKeyforms(action, h);
  eq(r.changed, false, '§13 OOB → changed=false');
  eq(action.fcurves[0].keyforms.length, 1, '§13 keyform untouched');
}

// ── §14 — applyDuplicateKeyforms Rule №1 input validation ──────────────
{
  throws(() => applyDuplicateKeyforms(null, new Map()),
    /non-null object/, '§14 null action throws');
  throws(() => applyDuplicateKeyforms({ fcurves: 'nope' }, new Map()),
    /must be an array/, '§14 non-array fcurves throws');
}

// ── §15 — applyDuplicateKeyforms no-op when handles empty ──────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const r = applyDuplicateKeyforms(action, new Map());
  eq(r.changed, false, '§15 empty handles → changed=false');
  eq(action.fcurves[0].keyforms.length, 1, '§15 keyform untouched');
}

// ── §16 — applyDuplicateKeyforms skips fcurve with no center bits ──────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, HANDLES_ONLY]]]]);
  const r = applyDuplicateKeyforms(action, h);
  eq(r.changed, false, '§16 handles-only → changed=false');
  eq(action.fcurves[0].keyforms.length, 1, '§16 keyform untouched');
}

// ── §17 — inserts copy after selected ──────────────────────────────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 5), makeKf(200, 10),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyDuplicateKeyforms(action, h);
  eq(r.changed, true, '§17 changed=true');
  eq(action.fcurves[0].keyforms.length, 3, '§17 length 2→3');
  eq(action.fcurves[0].keyforms[0].time, 100, '§17 idx 0 original');
  eq(action.fcurves[0].keyforms[1].time, 100, '§17 idx 1 = duplicate (same time)');
  eq(action.fcurves[0].keyforms[2].time, 200, '§17 idx 2 = old idx 1');
}

// ── §18 — remap points at DUPLICATE position ───────────────────────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 5), makeKf(200, 10),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyDuplicateKeyforms(action, h);
  const fcRemap = r.remaps.get('fc1');
  assert(fcRemap, '§18 remap has fc1');
  eq(fcRemap.get(0), 1, '§18 oldIdx 0 → newIdx 1 (the duplicate)');
}

// ── §19 — handles-only (no center) → no duplicate ──────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, HANDLES_ONLY]]]]);
  applyDuplicateKeyforms(action, h);
  eq(action.fcurves[0].keyforms.length, 1, '§19 handles-only → no duplicate');
}

// ── §20 — multiple selected → all duplicated ───────────────────────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2), makeKf(300, 3),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL], [2, ALL]]]]);
  const r = applyDuplicateKeyforms(action, h);
  eq(action.fcurves[0].keyforms.length, 5, '§20 length 3→5');
  // Expected: [100, 100*, 200, 300, 300*]  (* = duplicate)
  eq(action.fcurves[0].keyforms[0].time, 100, '§20 idx 0 original 100');
  eq(action.fcurves[0].keyforms[1].time, 100, '§20 idx 1 duplicate 100');
  eq(action.fcurves[0].keyforms[2].time, 200, '§20 idx 2 unselected 200');
  eq(action.fcurves[0].keyforms[3].time, 300, '§20 idx 3 original 300');
  eq(action.fcurves[0].keyforms[4].time, 300, '§20 idx 4 duplicate 300');
}

// ── §21 — remap accounts for prior-insert shifts ───────────────────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2), makeKf(300, 3),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL], [2, ALL]]]]);
  const r = applyDuplicateKeyforms(action, h);
  const fcRemap = r.remaps.get('fc1');
  eq(fcRemap.get(0), 1, '§21 first selected (oldIdx 0) → newIdx 1');
  eq(fcRemap.get(2), 4,
    '§21 second selected (oldIdx 2) → newIdx 4 (accounts for prior insert)');
}

// ── §22 — duplicate is deep-copy (independent handles) ─────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 5)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyDuplicateKeyforms(action, h);
  const original = action.fcurves[0].keyforms[0];
  const duplicate = action.fcurves[0].keyforms[1];
  assert(original.handleLeft !== duplicate.handleLeft,
    '§22 handleLeft ref independent');
  assert(original.handleRight !== duplicate.handleRight,
    '§22 handleRight ref independent');
  assert(original.handleType !== duplicate.handleType,
    '§22 handleType ref independent');
  // Mutating duplicate shouldn't affect original
  duplicate.handleLeft.time = 999;
  assert(original.handleLeft.time !== 999, '§22 mutation isolation');
}

// ── §23 — preserves unselected sibling values ──────────────────────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyDuplicateKeyforms(action, h);
  eq(action.fcurves[0].keyforms[2].time, 200, '§23 unselected sibling time');
  eq(action.fcurves[0].keyforms[2].value, 2, '§23 unselected sibling value');
}

// ── §24 — duplicate carries same time as original ──────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 5)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyDuplicateKeyforms(action, h);
  eq(action.fcurves[0].keyforms[0].time, action.fcurves[0].keyforms[1].time,
    '§24 duplicate time matches original');
  eq(action.fcurves[0].keyforms[0].value, action.fcurves[0].keyforms[1].value,
    '§24 duplicate value matches original');
}

// ── §25 — multi-fcurve mixed selection ─────────────────────────────────
{
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 0)]),
    makeFc('fc2', [makeKf(200, 0)]),
    makeFc('fc3', [makeKf(300, 0)]),    // no selection
  ]);
  const h = makeHandles([
    ['fc1', [[0, ALL]]],
    ['fc2', [[0, ALL]]],
  ]);
  const r = applyDuplicateKeyforms(action, h);
  eq(action.fcurves[0].keyforms.length, 2, '§25 fc1 duplicated');
  eq(action.fcurves[1].keyforms.length, 2, '§25 fc2 duplicated');
  eq(action.fcurves[2].keyforms.length, 1, '§25 fc3 untouched');
  assert(r.remaps.has('fc1') && r.remaps.has('fc2'), '§25 remaps fc1+fc2');
  assert(!r.remaps.has('fc3'), '§25 remap omits fc3');
}

// ── §26 — skips out-of-bounds keyform indices ──────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[5, ALL]]]]);
  const r = applyDuplicateKeyforms(action, h);
  eq(r.changed, false, '§26 OOB → changed=false');
  eq(action.fcurves[0].keyforms.length, 1, '§26 keyform untouched');
}

// ── §27 — Round-trip: delete then remap drops selection entries ────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2), makeKf(300, 3),
  ])]);
  const h = makeHandles([['fc1', [[1, ALL]]]]);
  const r = applyDeleteKeyforms(action, h);
  const remapped = remapHandlesAfterTranslate(h, r.remaps);
  // After delete, idx 1 is gone (remap -1); the new selection should
  // drop the entry entirely. Since fc1 had only one selected entry,
  // the entire fc1 sub-Map should be dropped.
  assert(!remapped.has('fc1'), '§27 fc1 dropped from selection (empty after delete)');
}

// ── §28b — Audit-fix MED-A1: pre-filter handles OOB before delegate ────
{
  // OOB-only selection (idx 5 in a 1-key fcurve) should be no-op,
  // NOT throw the new invariant-violation error. Verifies the
  // pre-filter at the contract boundary.
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[5, ALL]]]]);
  // Should not throw
  const r = applyDeleteKeyforms(action, h);
  eq(r.changed, false, '§28b OOB-only → changed=false (no throw)');
  eq(r.remaps.size, 0, '§28b OOB-only → empty remaps');
}

// ── §28 — Round-trip: duplicate then remap re-targets at copies ────────
{
  const action = makeAction([makeFc('fc1', [
    makeKf(100, 1), makeKf(200, 2),
  ])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyDuplicateKeyforms(action, h);
  const remapped = remapHandlesAfterTranslate(h, r.remaps);
  // After duplicate, oldIdx 0 → newIdx 1 (the duplicate). The selection
  // should now point at newIdx 1, not at oldIdx 0.
  const sub = remapped.get('fc1');
  assert(sub, '§28 fc1 still in selection');
  assert(sub.has(1), '§28 selection at newIdx 1 (the duplicate)');
  assert(!sub.has(0), '§28 selection no longer at oldIdx 0');
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures);
  process.exit(1);
}
