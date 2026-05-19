// Tests for src/anim/dopesheetGrab.js — Animation Phase 6 Slice 6.C.
// Run: node scripts/test/test_dopesheetGrab.mjs
//
// Coverage:
//   §1  — wouldTimeTranslateChange false on zero / non-finite delta
//   §2  — wouldTimeTranslateChange false on empty / center-less handles
//   §3  — wouldTimeTranslateChange true on real change
//   §4  — applyTimeTranslate Rule №1 input validation throws
//   §5  — applyTimeTranslate no-op when handles empty
//   §6  — applyTimeTranslate no-op when delta rounds to 0
//   §7  — applyTimeTranslate skips fcurve with no center bits
//   §8  — applyTimeTranslate shifts time on selected keyform
//   §9  — applyTimeTranslate shifts handleLeft + handleRight by same delta
//   §10 — applyTimeTranslate skips handle shift when handleLeft/Right absent
//   §11 — applyTimeTranslate sorts after shift (re-ordering case)
//   §12 — applyTimeTranslate builds remap reflecting sort
//   §13 — applyTimeTranslate skips unselected siblings
//   §14 — applyTimeTranslate value unchanged (TFM_TIME_TRANSLATE y_fac=0)
//   §15 — applyTimeTranslate quantizes float delta to integer ms (DEV 4)
//   §16 — applyTimeTranslate negative delta works (move backward in time)
//   §17 — applyTimeTranslate merges duplicates after collision
//   §18 — applyTimeTranslate remap marks merged-away keys as -1
//   §19 — applyTimeTranslate handles multi-fcurve mixed selection
//   §20 — applyTimeTranslate skips out-of-bounds keyform indices
//   §21 — remapHandlesAfterTranslate identity when remaps empty
//   §22 — remapHandlesAfterTranslate updates index when remap shifts
//   §23 — remapHandlesAfterTranslate drops entries where newIdx is -1
//   §24 — remapHandlesAfterTranslate drops outer fcurve when sub empties
//   §25 — remapHandlesAfterTranslate identity-stable when remap is identity
//   §26 — remapHandlesAfterTranslate preserves HandleParts ref per entry
//   §27 — Round-trip: apply + remap leaves selection pointing at moved keys

import {
  applyTimeTranslate,
  remapHandlesAfterTranslate,
  wouldTimeTranslateChange,
} from '../../src/anim/dopesheetGrab.js';

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
  // entries: [[fcurveId, [[idx, {center,left,right}], ...]], ...]
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

// ── §1 — wouldTimeTranslateChange false on zero/non-finite ──────────────
{
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  eq(wouldTimeTranslateChange(h, 0), false, '§1 zero delta → false');
  eq(wouldTimeTranslateChange(h, NaN), false, '§1 NaN delta → false');
  eq(wouldTimeTranslateChange(h, Infinity), false, '§1 Infinity delta → false');
}

// ── §2 — wouldTimeTranslateChange false on empty/center-less ────────────
{
  eq(wouldTimeTranslateChange(null, 100), false, '§2 null handles → false');
  eq(wouldTimeTranslateChange(new Map(), 100), false, '§2 empty Map → false');
  const noCenter = makeHandles([['fc1', [[0, HANDLES_ONLY]]]]);
  eq(wouldTimeTranslateChange(noCenter, 100), false, '§2 no-center → false');
}

// ── §3 — wouldTimeTranslateChange true on real change ──────────────────
{
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  eq(wouldTimeTranslateChange(h, 50), true, '§3 finite + center → true');
  eq(wouldTimeTranslateChange(h, -50), true, '§3 negative delta + center → true');
}

// ── §4 — applyTimeTranslate Rule №1 input validation ───────────────────
{
  throws(() => applyTimeTranslate(null, new Map(), 10),
    /non-null object/, '§4 null action throws');
  throws(() => applyTimeTranslate({ fcurves: 'nope' }, new Map(), 10),
    /must be an array/, '§4 non-array fcurves throws');
  throws(() => applyTimeTranslate(makeAction([]), new Map(), NaN),
    /finite number/, '§4 NaN delta throws');
  throws(() => applyTimeTranslate(makeAction([]), new Map(), Infinity),
    /finite number/, '§4 Infinity delta throws');
}

// ── §5 — no-op when handles empty ──────────────────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const r = applyTimeTranslate(action, new Map(), 50);
  eq(r.changed, false, '§5 empty handles → changed=false');
  eq(r.remaps.size, 0, '§5 empty handles → empty remaps');
  eq(action.fcurves[0].keyforms[0].time, 100, '§5 keyform untouched');
}

// ── §6 — no-op when delta rounds to 0 ──────────────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyTimeTranslate(action, h, 0.4);  // rounds to 0
  eq(r.changed, false, '§6 sub-0.5 delta → changed=false');
  eq(action.fcurves[0].keyforms[0].time, 100, '§6 keyform untouched');
}

// ── §7 — skips fcurve with no center bits ──────────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, HANDLES_ONLY]]]]);
  const r = applyTimeTranslate(action, h, 50);
  eq(r.changed, false, '§7 handles-only → changed=false');
  eq(action.fcurves[0].keyforms[0].time, 100, '§7 keyform untouched');
}

// ── §8 — shifts time on selected keyform ───────────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 5), makeKf(200, 10)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyTimeTranslate(action, h, 30);
  eq(r.changed, true, '§8 single-key shift → changed=true');
  // After shift, key was at 100, now 130; still before 200, so index 0 stays.
  eq(action.fcurves[0].keyforms[0].time, 130, '§8 time shifted +30');
  eq(action.fcurves[0].keyforms[1].time, 200, '§8 unselected key untouched');
}

// ── §9 — handles shift by same delta ───────────────────────────────────
{
  const kf = makeKf(100, 5);
  kf.handleLeft  = { time: 80,  value: 4 };
  kf.handleRight = { time: 120, value: 6 };
  const action = makeAction([makeFc('fc1', [kf])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyTimeTranslate(action, h, 40);
  eq(action.fcurves[0].keyforms[0].time,             140, '§9 center +40');
  eq(action.fcurves[0].keyforms[0].handleLeft.time,  120, '§9 handleLeft +40');
  eq(action.fcurves[0].keyforms[0].handleRight.time, 160, '§9 handleRight +40');
}

// ── §10 — no crash when handleLeft/Right absent ────────────────────────
{
  const kf = { time: 100, value: 5, handleType: { left: 'free', right: 'free' }, flag: 0 };
  // recalcKeyformHandles will reify handles; verify we don't throw before then
  const action = makeAction([makeFc('fc1', [kf])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  // Wrap in try to verify no throw on the shift; the post-sort
  // recalcKeyformHandles is the established path that adds handles back.
  let threw = null;
  try { applyTimeTranslate(action, h, 25); } catch (e) { threw = e; }
  eq(threw, null, '§10 missing handles → no throw');
  eq(action.fcurves[0].keyforms[0].time, 125, '§10 center still shifted');
}

// ── §11 — sorts after shift (re-ordering) ──────────────────────────────
{
  // 3 keys at 100/200/300; shift first key by +250 so it lands between
  // 200 and 300 → final order should be 200, 300 (was selected), 350.
  // Wait: 100 + 250 = 350. So order is 200, 300, 350 — no re-order needed.
  // Let me try +110: 100→210, then sort gives 200, 210, 300.
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 1), makeKf(200, 2), makeKf(300, 3)]),
  ]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyTimeTranslate(action, h, 110);
  eq(r.changed, true, '§11 shift+sort → changed=true');
  const times = action.fcurves[0].keyforms.map((k) => k.time);
  assert(times[0] === 200 && times[1] === 210 && times[2] === 300,
    `§11 sorted to [200,210,300], got ${JSON.stringify(times)}`);
}

// ── §12 — remap reflects post-sort positions ───────────────────────────
{
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 1), makeKf(200, 2), makeKf(300, 3)]),
  ]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyTimeTranslate(action, h, 110);  // 100→210, lands at idx 1
  const fcRemap = r.remaps.get('fc1');
  assert(fcRemap !== undefined, '§12 fc1 has remap');
  eq(fcRemap.get(0), 1, '§12 oldIdx 0 → newIdx 1');
  eq(fcRemap.get(1), 0, '§12 oldIdx 1 (200) → newIdx 0 (still 200, but now first)');
  eq(fcRemap.get(2), 2, '§12 oldIdx 2 (300) → newIdx 2');
}

// ── §13 — skips unselected siblings ────────────────────────────────────
{
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 0), makeKf(200, 0), makeKf(300, 0)]),
  ]);
  const h = makeHandles([['fc1', [[1, ALL]]]]);   // only middle key
  applyTimeTranslate(action, h, 20);
  const times = action.fcurves[0].keyforms.map((k) => k.time);
  eq(times[0], 100, '§13 idx 0 untouched');
  eq(times[1], 220, '§13 idx 1 shifted +20');
  eq(times[2], 300, '§13 idx 2 untouched');
}

// ── §14 — values unchanged ──────────────────────────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 5)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyTimeTranslate(action, h, 50);
  eq(action.fcurves[0].keyforms[0].value,             5, '§14 center value');
  eq(action.fcurves[0].keyforms[0].handleLeft.value,  5, '§14 handleLeft value');
  eq(action.fcurves[0].keyforms[0].handleRight.value, 5, '§14 handleRight value');
}

// ── §15 — quantizes float delta to integer ms (DEV 4) ──────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyTimeTranslate(action, h, 23.7);   // rounds to 24
  eq(action.fcurves[0].keyforms[0].time, 124, '§15 23.7 → +24');
}
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyTimeTranslate(action, h, -23.3);  // rounds to -23
  eq(action.fcurves[0].keyforms[0].time, 77, '§15 -23.3 → -23');
}

// ── §16 — negative delta (backward in time) ────────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(500, 0)])]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  applyTimeTranslate(action, h, -100);
  eq(action.fcurves[0].keyforms[0].time, 400, '§16 -100 shift works');
}

// ── §17 — merges duplicates after collision ────────────────────────────
{
  // Keys at 100 / 200. Shift key 0 by +100 → collides with key 1 at 200.
  // mergeDuplicateTimeKeys: selected wins at lowest cluster idx.
  // Post-sort: [200 (idx0, originally key1, NOT selected), 200 (idx1,
  // originally key0, selected)]. Cluster has selected at idx1; selected
  // becomes new survivor at LOWEST cluster idx (idx 0 in cluster) → the
  // survivor at idx 0 is the one written with the selected's value/handles.
  // Actually look at the impl: it averages selected values, writes to
  // keepIdx = selectedInCluster[0]. Then deletes others. So survivor
  // count is 1; the merged-away one was the unselected key 1.
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 5), makeKf(200, 10)]),
  ]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyTimeTranslate(action, h, 100);
  eq(action.fcurves[0].keyforms.length, 1, '§17 cluster collapsed to 1');
  eq(action.fcurves[0].keyforms[0].time, 200, '§17 survivor at time 200');
  eq(r.changed, true, '§17 reported changed');
}

// ── §18 — remap marks merged-away as -1 ────────────────────────────────
{
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 5), makeKf(200, 10)]),
  ]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const r = applyTimeTranslate(action, h, 100);
  const fcRemap = r.remaps.get('fc1');
  // After shift, key 0 → time 200 → sort puts both at index 0/1 with
  // ties; then merge: selected (originally key 0) wins, unselected
  // (key 1) merged away. Selected survivor index = 0.
  // So oldIdx 0 (selected) → newIdx 0; oldIdx 1 (unselected) → newIdx -1.
  eq(fcRemap.get(0), 0, '§18 selected survives at newIdx 0');
  eq(fcRemap.get(1), -1, '§18 unselected merged away');
}

// ── §19 — multi-fcurve mixed selection ─────────────────────────────────
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
  const r = applyTimeTranslate(action, h, 30);
  eq(r.changed, true, '§19 multi-fc changed=true');
  eq(action.fcurves[0].keyforms[0].time, 130, '§19 fc1 idx0 shifted');
  eq(action.fcurves[0].keyforms[1].time, 200, '§19 fc1 idx1 untouched');
  eq(action.fcurves[1].keyforms[0].time, 150, '§19 fc2 idx0 untouched');
  eq(action.fcurves[1].keyforms[1].time, 280, '§19 fc2 idx1 shifted');
  eq(action.fcurves[2].keyforms[0].time, 50,  '§19 fc3 fully untouched');
  assert(r.remaps.has('fc1') && r.remaps.has('fc2'), '§19 remap has fc1+fc2');
  assert(!r.remaps.has('fc3'), '§19 remap omits untouched fc3');
}

// ── §20 — skips out-of-bounds keyform indices ──────────────────────────
{
  const action = makeAction([makeFc('fc1', [makeKf(100, 0)])]);
  // Selection references idx 5, which doesn't exist
  const h = makeHandles([['fc1', [[5, ALL]]]]);
  const r = applyTimeTranslate(action, h, 50);
  eq(r.changed, false, '§20 OOB index → changed=false');
  eq(action.fcurves[0].keyforms[0].time, 100, '§20 real key untouched');
}

// ── §21 — remapHandlesAfterTranslate identity when remaps empty ────────
{
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const out = remapHandlesAfterTranslate(h, new Map());
  eq(out, h, '§21 empty remaps → same ref');
}

// ── §22 — remapHandlesAfterTranslate updates index ─────────────────────
{
  const h = makeHandles([['fc1', [[0, ALL]]]]);
  const remaps = new Map([['fc1', new Map([[0, 2]])]]);
  const out = remapHandlesAfterTranslate(h, remaps);
  assert(out !== h, '§22 changed → new ref');
  const sub = out.get('fc1');
  assert(!sub.has(0), '§22 oldIdx 0 absent');
  assert(sub.has(2), '§22 newIdx 2 present');
}

// ── §23 — remapHandlesAfterTranslate drops entries with newIdx -1 ──────
{
  const h = makeHandles([['fc1', [[0, ALL], [1, ALL]]]]);
  const remaps = new Map([['fc1', new Map([[0, 0], [1, -1]])]]);
  const out = remapHandlesAfterTranslate(h, remaps);
  const sub = out.get('fc1');
  eq(sub.size, 1, '§23 merged-away dropped');
  assert(sub.has(0), '§23 surviving entry kept');
}

// ── §24 — drops outer fcurve when sub empties ──────────────────────────
{
  const h = makeHandles([['fc1', [[0, ALL]]], ['fc2', [[0, ALL]]]]);
  const remaps = new Map([['fc1', new Map([[0, -1]])]]);
  const out = remapHandlesAfterTranslate(h, remaps);
  assert(!out.has('fc1'), '§24 fc1 dropped when sub empty');
  assert(out.has('fc2'), '§24 fc2 kept (no remap entry for it)');
}

// ── §25 — identity-stable when remap is identity ───────────────────────
{
  const h = makeHandles([['fc1', [[0, ALL], [1, ALL]]]]);
  const remaps = new Map([['fc1', new Map([[0, 0], [1, 1]])]]);
  const out = remapHandlesAfterTranslate(h, remaps);
  eq(out, h, '§25 identity remap → same ref');
}

// ── §26 — preserves HandleParts ref per entry ──────────────────────────
{
  const partsRef = { center: true, left: false, right: true };
  const h = makeHandles([['fc1', [[0, partsRef]]]]);
  const remaps = new Map([['fc1', new Map([[0, 3]])]]);
  const out = remapHandlesAfterTranslate(h, remaps);
  eq(out.get('fc1').get(3), partsRef, '§26 same parts ref carried over');
}

// ── §27 — Round-trip: apply + remap leaves selection on moved keys ─────
{
  const action = makeAction([
    makeFc('fc1', [makeKf(100, 0), makeKf(200, 0), makeKf(300, 0)]),
  ]);
  const h = makeHandles([['fc1', [[0, ALL]]]]);   // select first
  const r = applyTimeTranslate(action, h, 110);   // 100 → 210
  // Post-sort: [200, 210, 300]; selected (originally 100→210) at idx 1
  const remapped = remapHandlesAfterTranslate(h, r.remaps);
  const sub = remapped.get('fc1');
  assert(sub.has(1), '§27 selection now at idx 1 (the moved key)');
  // Verify the keyform at idx 1 is indeed the one with time 210
  eq(action.fcurves[0].keyforms[1].time, 210, '§27 idx 1 is the moved key');
}

// ── Summary ─────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('Failures:', failures);
  process.exit(1);
}
