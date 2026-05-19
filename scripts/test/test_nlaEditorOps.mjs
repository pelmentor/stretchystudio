// Tests for src/v3/editors/nla/nlaEditorOps.js — Animation Phase 4
// Slice 4.D.2 (drag interactions data substrate).
// Run: node scripts/test/test_nlaEditorOps.mjs

import {
  MIN_STRIP_MS,
  applyMoveStrip,
  wouldMoveStripChange,
  applyResizeStripStart,
  wouldResizeStripStartChange,
  applyResizeStripEnd,
  wouldResizeStripEndChange,
  applyReorderTrack,
  wouldReorderTrackChange,
  applySetStripBlendMode,
  wouldSetStripBlendModeChange,
  applySetStripExtendMode,
  wouldSetStripExtendModeChange,
  applySetStripInfluence,
  wouldSetStripInfluenceChange,
  applyToggleStripMuted,
  applyToggleTrackMuted,
  applyToggleTrackProtected,
  applyToggleTrackSolo,
  applyAddTrack,
  applyAddStrip,
  wouldAddStripChange,
  applyRemoveStrip,
  wouldRemoveStripChange,
  applyRemoveTrack,
  wouldRemoveTrackChange,
  applyPushActionDown,
  wouldPushActionDownChange,
  pxDeltaToMs,
  pxToMs,
} from '../../src/v3/editors/nla/nlaEditorOps.js';
import {
  makeNlaStrip,
  makeNlaTrack,
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
} from '../../src/anim/nla.js';

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
function close(a, b, eps, name) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${a}\n   expected: ${b} (±${eps})`);
}

// Fixture: 3 tracks, 2 strips on the middle track
function makeFixture() {
  return {
    actionId: 'baseAct', slotHandle: 0, flag: 0,
    tmpActionId: null, tmpSlotHandle: 0,
    tweakTrackId: null, tweakStripId: null,
    nlaTracks: [
      makeNlaTrack('tBot', 'B', { index: 0 }),
      makeNlaTrack('tMid', 'M', { index: 1, strips: [
        makeNlaStrip('s1', 'walkAct', { start: 100, end: 600, actstart: 0, actend: 500 }),
        makeNlaStrip('s2', 'walkAct', { start: 1000, end: 1500, actstart: 0, actend: 500 }),
      ] }),
      makeNlaTrack('tTop', 'T', { index: 2 }),
    ],
  };
}

function findStrip(ad, trackId, stripId) {
  const t = ad.nlaTracks.find((x) => x.id === trackId);
  return t?.strips.find((s) => s.id === stripId);
}

// ── 1. applyMoveStrip happy path ───────────────────────────────────
{
  const ad = makeFixture();
  const out = applyMoveStrip(ad, 'tMid', 's1', 200);
  // Original unchanged
  eq(findStrip(ad, 'tMid', 's1').start, 100, '1: original ad untouched (immutable)');
  // New animData has moved strip
  const moved = findStrip(out, 'tMid', 's1');
  eq(moved.start, 300, '1: start moved +200 → 300');
  eq(moved.end, 800, '1: end moved +200 → 800');
  // Sibling strip unchanged
  eq(findStrip(out, 'tMid', 's2').start, 1000, '1: sibling strip unchanged');
  // Other tracks unchanged
  eq(out.nlaTracks[0].id, 'tBot', '1: other tracks present');
}

// ── 2. applyMoveStrip clamps so start >= 0 ─────────────────────────
{
  const ad = makeFixture();
  // Strip is at 100; trying to move -500 should clamp to -100
  // (start: 100 - 100 = 0; end: 600 - 100 = 500)
  const out = applyMoveStrip(ad, 'tMid', 's1', -500);
  const moved = findStrip(out, 'tMid', 's1');
  eq(moved.start, 0, '2: start clamped to 0');
  eq(moved.end, 500, '2: end shifted by the same clamped delta (-100)');
}

// ── 3. applyMoveStrip no-op preserves reference ────────────────────
{
  const ad = makeFixture();
  // Strip already at start=100; -100 + larger negative attempt clamps to no-op
  const out = applyMoveStrip(ad, 'tMid', 's1', 0);
  assert(out === ad, '3: zero-delta returns same ref (no allocation)');
  const out2 = applyMoveStrip(ad, 'nonexistent', 's1', 100);
  assert(out2 === ad, '3: missing track returns same ref');
  const out3 = applyMoveStrip(ad, 'tMid', 'nonexistent', 100);
  assert(out3 === ad, '3: missing strip returns same ref');
}

// ── 4. wouldMoveStripChange ────────────────────────────────────────
{
  const ad = makeFixture();
  eq(wouldMoveStripChange(ad, 'tMid', 's1', 50), true, '4: nonzero delta → would change');
  eq(wouldMoveStripChange(ad, 'tMid', 's1', 0), false, '4: zero delta → no change');
  // Strip at start=100, -200 attempts, clamps to -100 → still changes
  eq(wouldMoveStripChange(ad, 'tMid', 's1', -200), true, '4: negative delta within bounds → change');
  // Strip already at start=100, but we test the predicate via construction
  // edge: strip at start=0 with negative delta → clamp to 0 → no change
  const adAtZero = makeFixture();
  adAtZero.nlaTracks[1].strips[0] = makeNlaStrip('s0', 'walkAct',
    { start: 0, end: 500, actstart: 0, actend: 500 });
  eq(wouldMoveStripChange(adAtZero, 'tMid', 's0', -100), false,
    '4: strip at start=0 with negative delta → clamped to no-op');
}

// ── 5. applyResizeStripStart ───────────────────────────────────────
{
  const ad = makeFixture();
  // s1 at [100, 600]; resize start to 200 → [200, 600]
  const out = applyResizeStripStart(ad, 'tMid', 's1', 200);
  const r = findStrip(out, 'tMid', 's1');
  eq(r.start, 200, '5: start updated to 200');
  eq(r.end, 600, '5: end unchanged');
  // Clamp to 0 (negative input)
  const out2 = applyResizeStripStart(ad, 'tMid', 's1', -50);
  eq(findStrip(out2, 'tMid', 's1').start, 0, '5: negative input clamped to 0');
  // Clamp to end - MIN_STRIP_MS (input past end)
  const out3 = applyResizeStripStart(ad, 'tMid', 's1', 999);
  eq(findStrip(out3, 'tMid', 's1').start, 600 - MIN_STRIP_MS,
    '5: input past end clamped to end - MIN_STRIP_MS');
}

// ── 6. wouldResizeStripStartChange ─────────────────────────────────
{
  const ad = makeFixture();
  eq(wouldResizeStripStartChange(ad, 'tMid', 's1', 200), true, '6: 100→200 changes');
  eq(wouldResizeStripStartChange(ad, 'tMid', 's1', 100), false, '6: same value → no change');
  // -1 clamps to 0; current start is 100; 100 → 0 IS a change
  eq(wouldResizeStripStartChange(ad, 'tMid', 's1', -1), true,
    '6: -1 clamps to 0; 100→0 is still a change');
  // Input that already matches current after clamping is a no-op
  // (e.g. current=100, ask for 100 → no change as already covered above)
}

// ── 7. applyResizeStripEnd ─────────────────────────────────────────
{
  const ad = makeFixture();
  // s1 at [100, 600]; resize end to 800 → [100, 800]
  const out = applyResizeStripEnd(ad, 'tMid', 's1', 800);
  const r = findStrip(out, 'tMid', 's1');
  eq(r.start, 100, '7: start unchanged');
  eq(r.end, 800, '7: end updated to 800');
  // Clamp: end can't go below start + MIN_STRIP_MS
  const out2 = applyResizeStripEnd(ad, 'tMid', 's1', 50);
  eq(findStrip(out2, 'tMid', 's1').end, 100 + MIN_STRIP_MS,
    '7: input below start clamped to start + MIN_STRIP_MS');
  // No upper bound
  const out3 = applyResizeStripEnd(ad, 'tMid', 's1', 99999);
  eq(findStrip(out3, 'tMid', 's1').end, 99999, '7: no upper bound');
}

// ── 8. wouldResizeStripEndChange ───────────────────────────────────
{
  const ad = makeFixture();
  eq(wouldResizeStripEndChange(ad, 'tMid', 's1', 800), true, '8: 600→800 changes');
  eq(wouldResizeStripEndChange(ad, 'tMid', 's1', 600), false, '8: same value → no change');
}

// ── 9. applyReorderTrack: simple swap (1 → 0) ──────────────────────
{
  const ad = makeFixture();   // tBot=0, tMid=1, tTop=2
  const out = applyReorderTrack(ad, 'tMid', 0);
  // tMid should be at position 0; tBot bumped to 1; tTop to 2
  const tracks = out.nlaTracks;
  eq(tracks[0].id, 'tMid', '9: tMid at position 0');
  eq(tracks[0].index, 0, '9: tMid index restamped to 0');
  eq(tracks[1].id, 'tBot', '9: tBot bumped to position 1');
  eq(tracks[1].index, 1, '9: tBot index restamped to 1');
  eq(tracks[2].id, 'tTop', '9: tTop stays at position 2');
  eq(tracks[2].index, 2, '9: tTop index unchanged');
  // Original unchanged
  eq(ad.nlaTracks[0].id, 'tBot', '9: original ad untouched');
}

// ── 10. applyReorderTrack: move to top ─────────────────────────────
{
  const ad = makeFixture();   // tBot=0, tMid=1, tTop=2
  const out = applyReorderTrack(ad, 'tBot', 2);
  // tBot moves to position 2; tMid shifts to 0, tTop shifts to 1
  const tracks = out.nlaTracks;
  eq(tracks[0].id, 'tMid', '10: tMid at position 0');
  eq(tracks[0].index, 0, '10: tMid index 0');
  eq(tracks[1].id, 'tTop', '10: tTop at position 1');
  eq(tracks[1].index, 1, '10: tTop index 1');
  eq(tracks[2].id, 'tBot', '10: tBot at position 2');
  eq(tracks[2].index, 2, '10: tBot index 2');
}

// ── 11. applyReorderTrack: clamps newIndex to [0, n-1] ─────────────
{
  const ad = makeFixture();
  const out1 = applyReorderTrack(ad, 'tMid', -5);
  eq(out1.nlaTracks[0].id, 'tMid', '11: negative newIndex clamped to 0');
  const out2 = applyReorderTrack(ad, 'tMid', 999);
  eq(out2.nlaTracks[2].id, 'tMid', '11: huge newIndex clamped to n-1');
}

// ── 12. applyReorderTrack: missing track is no-op ──────────────────
{
  const ad = makeFixture();
  const out = applyReorderTrack(ad, 'nonexistent', 0);
  assert(out === ad, '12: missing track returns same ref');
}

// ── 13. applyReorderTrack: same-position is no-op ──────────────────
{
  const ad = makeFixture();
  const out = applyReorderTrack(ad, 'tMid', 1);   // already at index 1
  assert(out === ad, '13: same-position returns same ref');
}

// ── 14. applyReorderTrack: re-stamp fixes drifted indices ─────────
{
  // Construct an animData with drifted indices (e.g. a previous
  // manual edit left gaps: indices [0, 5, 99] instead of [0, 1, 2]).
  // After reorder, all indices must be contiguous 0..n-1.
  const ad = {
    actionId: null, flag: 0,
    nlaTracks: [
      { ...makeNlaTrack('tA', 'A', { index: 0 }), strips: [] },
      { ...makeNlaTrack('tB', 'B', { index: 5 }), strips: [] },
      { ...makeNlaTrack('tC', 'C', { index: 99 }), strips: [] },
    ],
  };
  const out = applyReorderTrack(ad, 'tA', 2);
  eq(out.nlaTracks[0].index, 0, '14: drifted indices restamped — pos 0');
  eq(out.nlaTracks[1].index, 1, '14: drifted indices restamped — pos 1');
  eq(out.nlaTracks[2].index, 2, '14: drifted indices restamped — pos 2');
  eq(out.nlaTracks[2].id, 'tA', '14: tA correctly moved to position 2');
}

// ── 15. wouldReorderTrackChange ────────────────────────────────────
{
  const ad = makeFixture();
  eq(wouldReorderTrackChange(ad, 'tMid', 0), true, '15: 1 → 0 changes');
  eq(wouldReorderTrackChange(ad, 'tMid', 1), false, '15: 1 → 1 no change');
  eq(wouldReorderTrackChange(ad, 'tMid', 999), true, '15: 999 clamps to 2; 1 → 2 changes');
  eq(wouldReorderTrackChange(ad, 'nonexistent', 0), false, '15: missing track no change');
}

// ── 16. Immutability: original tracks untouched after every op ─────
{
  const ad = makeFixture();
  const before = JSON.stringify(ad);
  applyMoveStrip(ad, 'tMid', 's1', 100);
  applyResizeStripStart(ad, 'tMid', 's1', 200);
  applyResizeStripEnd(ad, 'tMid', 's1', 800);
  applyReorderTrack(ad, 'tMid', 0);
  eq(JSON.stringify(ad), before,
    '16: all 4 ops left the original animData byte-identical (immutability)');
}

// ── 16b. applyReorderTrack: drifted-index same-position restamps
// (audit-fix verifies the documented contract: even on no-position
// change, drifted indices get restamped to contiguous 0..n-1 because
// drifted indices ARE a contract violation that must be repaired).
{
  // Setup: drifted indices [0, 5, 99]. User "moves" track at position
  // 1 (index 5) to newIndex 5. The position doesn't change visually
  // (it's already at the visual middle slot), but the index VALUE
  // drifts. applyReorderTrack restamps to [0, 1, 2].
  const ad = {
    actionId: null, flag: 0,
    nlaTracks: [
      { ...makeNlaTrack('tA', 'A', { index: 0 }), strips: [] },
      { ...makeNlaTrack('tB', 'B', { index: 5 }), strips: [] },
      { ...makeNlaTrack('tC', 'C', { index: 99 }), strips: [] },
    ],
  };
  // newIndex=1 (the actual visual middle slot) — tB is already there
  // visually, but its stored index is 5
  const out = applyReorderTrack(ad, 'tB', 1);
  // After: tB stays at position 1, BUT its index is restamped 5 → 1
  eq(out.nlaTracks[1].id, 'tB', '16b: tB still at position 1');
  eq(out.nlaTracks[1].index, 1, '16b: tB index restamped 5 → 1 (drift repaired)');
  eq(out.nlaTracks[0].index, 0, '16b: tA index 0');
  eq(out.nlaTracks[2].index, 2, '16b: tC index restamped 99 → 2');
}

// ── 17. pxDeltaToMs + pxToMs ───────────────────────────────────────
{
  // Span 0..1000ms over 800px → 1 px = 1.25 ms
  close(pxDeltaToMs(80, 0, 1000, 800), 100, 1e-9, '17: 80px @ 1000ms/800px = 100ms');
  close(pxDeltaToMs(-80, 0, 1000, 800), -100, 1e-9, '17: negative delta');
  // Absolute position
  close(pxToMs(400, 0, 1000, 800), 500, 1e-9, '17: 400px → 500ms');
  close(pxToMs(0, 0, 1000, 800), 0, 1e-9, '17: 0px → 0ms');
  // Defensive
  eq(pxDeltaToMs(100, 0, 1000, 0), 0, '17: pxWidth=0 → 0 (no div-by-zero)');
  eq(pxToMs(100, 50, 1000, 0), 50, '17: pxWidth=0 → minMs');
  // Different span origin
  close(pxToMs(400, 100, 1100, 800), 600, 1e-9, '17: span starts at 100, 400px → 600ms');
}

// ===========================================================================
// Slice 4.D.3 — affordance setters / togglers
// ===========================================================================

// ── 18. applySetStripBlendMode happy path ──────────────────────────
{
  const ad = makeFixture();
  const out = applySetStripBlendMode(ad, 'tMid', 's1', 'add');
  eq(findStrip(ad, 'tMid', 's1').blendmode, 'replace', '18: original unchanged');
  eq(findStrip(out, 'tMid', 's1').blendmode, 'add', '18: new mode set');
  eq(findStrip(out, 'tMid', 's2').blendmode, 'replace', '18: sibling unchanged');
}

// ── 19. applySetStripBlendMode validates ───────────────────────────
{
  const ad = makeFixture();
  let threw = false;
  try { applySetStripBlendMode(ad, 'tMid', 's1', 'combine'); } catch { threw = true; }
  assert(threw, '19: combine throws (deferred per plan §4.B)');
  threw = false;
  try { applySetStripBlendMode(ad, 'tMid', 's1', 'bogus'); } catch { threw = true; }
  assert(threw, '19: unknown mode throws');
}

// ── 20. applySetStripBlendMode no-op preserves ref ─────────────────
{
  const ad = makeFixture();
  const out = applySetStripBlendMode(ad, 'tMid', 's1', 'replace');
  assert(out === ad, '20: same mode → same ref');
  const out2 = applySetStripBlendMode(ad, 'tMid', 'nonexistent', 'add');
  assert(out2 === ad, '20: missing strip → same ref');
  const out3 = applySetStripBlendMode(ad, 'nonexistent', 's1', 'add');
  assert(out3 === ad, '20: missing track → same ref');
}

// ── 21. wouldSetStripBlendModeChange ───────────────────────────────
{
  const ad = makeFixture();
  assert(wouldSetStripBlendModeChange(ad, 'tMid', 's1', 'add'), '21a: replace→add changes');
  assert(!wouldSetStripBlendModeChange(ad, 'tMid', 's1', 'replace'), '21b: replace→replace no-op');
  assert(!wouldSetStripBlendModeChange(ad, 'tMid', 's1', 'bogus'), '21c: invalid mode → no');
  assert(!wouldSetStripBlendModeChange(ad, 'tMid', 'nonexistent', 'add'), '21d: missing → no');
}

// ── 22. applySetStripExtendMode happy path + validate ──────────────
{
  const ad = makeFixture();
  const out = applySetStripExtendMode(ad, 'tMid', 's1', 'nothing');
  eq(findStrip(out, 'tMid', 's1').extendmode, 'nothing', '22a: extendmode set');
  eq(findStrip(ad, 'tMid', 's1').extendmode, 'hold', '22b: original unchanged');
  let threw = false;
  try { applySetStripExtendMode(ad, 'tMid', 's1', 'bogus'); } catch { threw = true; }
  assert(threw, '22c: unknown extendmode throws');
  const out2 = applySetStripExtendMode(ad, 'tMid', 's1', 'hold');
  assert(out2 === ad, '22d: same extendmode → same ref');
}

// ── 23. wouldSetStripExtendModeChange ──────────────────────────────
{
  const ad = makeFixture();
  assert(wouldSetStripExtendModeChange(ad, 'tMid', 's1', 'nothing'), '23a: hold→nothing changes');
  assert(!wouldSetStripExtendModeChange(ad, 'tMid', 's1', 'hold'), '23b: hold→hold no-op');
  assert(!wouldSetStripExtendModeChange(ad, 'tMid', 's1', 'bogus'), '23c: invalid → no');
}

// ── 24. applySetStripInfluence clamps + happy path ─────────────────
{
  const ad = makeFixture();
  const out = applySetStripInfluence(ad, 'tMid', 's1', 0.5);
  close(findStrip(out, 'tMid', 's1').influence, 0.5, 1e-10, '24a: 0.5 set');
  // Original (influence=1 from default) unchanged
  close(findStrip(ad, 'tMid', 's1').influence, 1, 1e-10, '24b: original unchanged');
  const out2 = applySetStripInfluence(ad, 'tMid', 's1', 2);
  close(findStrip(out2, 'tMid', 's1').influence, 1, 1e-10, '24c: clamp >1 to 1');
  // 2 clamps to 1 which is already current value (default) → no-op same-ref
  assert(out2 === ad, '24c2: 2 clamps to 1 = current → no-op same ref');
  const out3 = applySetStripInfluence(ad, 'tMid', 's1', -0.5);
  close(findStrip(out3, 'tMid', 's1').influence, 0, 1e-10, '24d: clamp <0 to 0');
  // Audit-fix Slice 4.D.3 MED-A1: NaN / Infinity now THROW (Rule №1
  // contract parity with applySetStripBlendMode/ExtendMode).
  let threwNaN = false;
  try { applySetStripInfluence(ad, 'tMid', 's1', NaN); } catch { threwNaN = true; }
  assert(threwNaN, '24e: NaN throws (audit-fix MED-A1)');
  let threwInf = false;
  try { applySetStripInfluence(ad, 'tMid', 's1', Infinity); } catch { threwInf = true; }
  assert(threwInf, '24f: Infinity throws');
  let threwNegInf = false;
  try { applySetStripInfluence(ad, 'tMid', 's1', -Infinity); } catch { threwNegInf = true; }
  assert(threwNegInf, '24g: -Infinity throws');
}

// ── 25. wouldSetStripInfluenceChange ───────────────────────────────
{
  const ad = makeFixture();
  assert(wouldSetStripInfluenceChange(ad, 'tMid', 's1', 0.5), '25a: 1→0.5 changes');
  assert(!wouldSetStripInfluenceChange(ad, 'tMid', 's1', 1), '25b: 1→1 no-op');
  // 2 clamps to 1 → no change (default influence=1)
  assert(!wouldSetStripInfluenceChange(ad, 'tMid', 's1', 2), '25c: 2 clamps→1 = current, no change');
  // NaN/Infinity rejected
  assert(!wouldSetStripInfluenceChange(ad, 'tMid', 's1', NaN), '25d: NaN → no');
  assert(!wouldSetStripInfluenceChange(ad, 'tMid', 's1', Infinity), '25e: Infinity → no');
}

// ── 26. applyToggleStripMuted XOR ──────────────────────────────────
{
  const ad = makeFixture();
  // Initial: flag=0
  eq(findStrip(ad, 'tMid', 's1').flag & NLASTRIP_FLAG.MUTED, 0, '26a: initially unmuted');
  const out = applyToggleStripMuted(ad, 'tMid', 's1');
  assert((findStrip(out, 'tMid', 's1').flag & NLASTRIP_FLAG.MUTED) !== 0, '26b: now muted');
  // Toggle again unmuted
  const out2 = applyToggleStripMuted(out, 'tMid', 's1');
  eq(findStrip(out2, 'tMid', 's1').flag & NLASTRIP_FLAG.MUTED, 0, '26c: toggle clears mute');
  // Missing strip → same ref
  const out3 = applyToggleStripMuted(ad, 'tMid', 'nonexistent');
  assert(out3 === ad, '26d: missing strip → same ref');
}

// ── 27. applyToggleTrackMuted XOR ──────────────────────────────────
{
  const ad = makeFixture();
  eq(ad.nlaTracks[1].flag & NLATRACK_FLAG.MUTED, 0, '27a: initially unmuted');
  const out = applyToggleTrackMuted(ad, 'tMid');
  assert((out.nlaTracks[1].flag & NLATRACK_FLAG.MUTED) !== 0, '27b: now muted');
  // Original unchanged
  eq(ad.nlaTracks[1].flag & NLATRACK_FLAG.MUTED, 0, '27c: original unchanged');
  // Toggle clears
  const out2 = applyToggleTrackMuted(out, 'tMid');
  eq(out2.nlaTracks[1].flag & NLATRACK_FLAG.MUTED, 0, '27d: toggle clears');
}

// ── 28. applyToggleTrackProtected XOR ──────────────────────────────
{
  const ad = makeFixture();
  const out = applyToggleTrackProtected(ad, 'tMid');
  assert((out.nlaTracks[1].flag & NLATRACK_FLAG.PROTECTED) !== 0, '28a: now protected');
  const out2 = applyToggleTrackProtected(out, 'tMid');
  eq(out2.nlaTracks[1].flag & NLATRACK_FLAG.PROTECTED, 0, '28b: toggle clears');
  const out3 = applyToggleTrackProtected(ad, 'nonexistent');
  assert(out3 === ad, '28c: missing track → same ref');
}

// ── 29. applyToggleTrackSolo exclusivity ───────────────────────────
{
  // Initial: no track soloed, adt.flag = 0
  const ad = makeFixture();
  eq(ad.flag & ADT_FLAG.NLA_SOLO_TRACK, 0, '29a: initially no solo flag on adt');
  // Solo tMid
  const out = applyToggleTrackSolo(ad, 'tMid');
  assert((out.nlaTracks[1].flag & NLATRACK_FLAG.SOLO) !== 0, '29b: tMid now soloed');
  assert((out.flag & ADT_FLAG.NLA_SOLO_TRACK) !== 0, '29c: adt flag set');
  // Original unchanged (immutability)
  eq(ad.nlaTracks[1].flag & NLATRACK_FLAG.SOLO, 0, '29d: original tMid SOLO unchanged');
  eq(ad.flag & ADT_FLAG.NLA_SOLO_TRACK, 0, '29e: original adt flag unchanged');
  // Solo tTop → tMid loses SOLO (exclusivity)
  const out2 = applyToggleTrackSolo(out, 'tTop');
  eq(out2.nlaTracks[1].flag & NLATRACK_FLAG.SOLO, 0, '29f: tMid SOLO cleared (exclusivity)');
  assert((out2.nlaTracks[2].flag & NLATRACK_FLAG.SOLO) !== 0, '29g: tTop now soloed');
  assert((out2.flag & ADT_FLAG.NLA_SOLO_TRACK) !== 0, '29h: adt flag still set');
  // Toggle tTop again → SOLO cleared everywhere, adt flag cleared
  const out3 = applyToggleTrackSolo(out2, 'tTop');
  eq(out3.nlaTracks[2].flag & NLATRACK_FLAG.SOLO, 0, '29i: tTop SOLO cleared');
  eq(out3.flag & ADT_FLAG.NLA_SOLO_TRACK, 0, '29j: adt flag cleared (no tracks solo)');
  // Missing track → same ref
  const out4 = applyToggleTrackSolo(ad, 'nonexistent');
  assert(out4 === ad, '29k: missing track → same ref');
}

// ── 30. solo preserves OTHER flag bits on cleared tracks ───────────
{
  // Set up: tMid has MUTED set + SOLO set; tTop has PROTECTED set.
  // Solo'ing tBot should clear SOLO on tMid (its only conflicting bit)
  // but preserve MUTED + tTop's PROTECTED.
  const ad = makeFixture();
  ad.nlaTracks[1].flag = NLATRACK_FLAG.MUTED | NLATRACK_FLAG.SOLO;
  ad.nlaTracks[2].flag = NLATRACK_FLAG.PROTECTED;
  ad.flag = ADT_FLAG.NLA_SOLO_TRACK;
  const out = applyToggleTrackSolo(ad, 'tBot');
  // tBot now soloed
  assert((out.nlaTracks[0].flag & NLATRACK_FLAG.SOLO) !== 0, '30a: tBot soloed');
  // tMid: SOLO cleared but MUTED preserved
  eq(out.nlaTracks[1].flag & NLATRACK_FLAG.SOLO, 0, '30b: tMid SOLO cleared');
  assert((out.nlaTracks[1].flag & NLATRACK_FLAG.MUTED) !== 0, '30c: tMid MUTED preserved');
  // tTop: PROTECTED preserved (never had SOLO, so no change at all)
  assert((out.nlaTracks[2].flag & NLATRACK_FLAG.PROTECTED) !== 0, '30d: tTop PROTECTED preserved');
  // tTop didn't have SOLO → its ref should be preserved (perf-optimization
  // assertion — verifies we didn't shallow-clone unaffected tracks)
  assert(out.nlaTracks[2] === ad.nlaTracks[2], '30e: tTop ref preserved (no SOLO/no target)');
}

// ===========================================================================
// Slice 4.D.4 — CRUD + Push Action Down
// ===========================================================================

// Helper: build a minimal project shape carrying actions for action-lookup
function mockProject(actions = []) {
  return { id: 'proj1', actions, nodes: [] };
}

// ── 31. applyAddTrack happy path + uniqueness ──────────────────────
{
  const ad = makeFixture();
  const out = applyAddTrack(ad);
  eq(out.nlaTracks.length, 4, '31a: track count +1');
  eq(out.nlaTracks[3].name, 'NlaTrack', '31b: default name');
  eq(out.nlaTracks[3].index, 3, '31c: index = nlaTracks.length pre-add');
  // Original unchanged
  eq(ad.nlaTracks.length, 3, '31d: original immutable');

  // Second add → unique-suffix
  const out2 = applyAddTrack(out);
  eq(out2.nlaTracks.length, 5, '31e: second track added');
  eq(out2.nlaTracks[4].name, 'NlaTrack.001', '31f: .001 suffix');

  // Custom base name
  const out3 = applyAddTrack(out2, 'Custom');
  eq(out3.nlaTracks[5].name, 'Custom', '31g: custom name');

  // Empty animData (no nlaTracks array)
  const empty = { actionId: null, slotHandle: 0, flag: 0, nlaTracks: [] };
  const empOut = applyAddTrack(empty);
  eq(empOut.nlaTracks.length, 1, '31h: empty start → 1 track');
  eq(empOut.nlaTracks[0].index, 0, '31i: first track index 0');
}

// ── 32. applyAddStrip happy path + duration derivation ─────────────
{
  const ad = makeFixture();
  const proj = mockProject([
    { id: 'walkAct', name: 'Walk', frameStart: 0, frameEnd: 1500, duration: 1500 },
  ]);
  const out = applyAddStrip(ad, proj, 'tBot', 'walkAct', 0);
  const track = out.nlaTracks.find((t) => t.id === 'tBot');
  eq(track.strips.length, 1, '32a: strip added');
  eq(track.strips[0].actionId, 'walkAct', '32b: actionId set');
  eq(track.strips[0].start, 0, '32c: start = minStartMs');
  eq(track.strips[0].end, 1500, '32d: end = start + duration');
  eq(track.strips[0].actstart, 0, '32e: actstart = action.frameStart');
  eq(track.strips[0].actend, 1500, '32f: actend = actstart + duration');
  eq(track.strips[0].name, 'Walk', '32g: name = action display name');
  // Original unchanged
  eq(ad.nlaTracks.find((t) => t.id === 'tBot').strips.length, 0,
    '32h: original empty');
}

// ── 33. applyAddStrip overlap rejection (auto-positions rightward)
{
  const ad = makeFixture();
  const proj = mockProject([
    { id: 'walkAct', name: 'Walk', frameStart: 0, frameEnd: 500, duration: 500 },
  ]);
  // tMid has strips at 100-600 and 1000-1500. Try adding at 200 (would
  // overlap s1) — should auto-position to the leftmost free slot.
  // Gap between s1 (end 600) and s2 (start 1000) is 400 — too small
  // for duration=500. So the strip must land AFTER s2 ends at 1500.
  const out = applyAddStrip(ad, proj, 'tMid', 'walkAct', 200);
  const track = out.nlaTracks.find((t) => t.id === 'tMid');
  eq(track.strips.length, 3, '33a: strip added (positioned to free range)');
  const newStrip = track.strips.find((s) => s.id !== 's1' && s.id !== 's2');
  eq(newStrip.start, 1500, '33b: auto-positioned past s2 (gap=400 < duration=500)');
  eq(newStrip.end, 2000, '33c: end = 1500 + 500');
}

// ── 33b. applyAddStrip with sufficient gap auto-positions in the gap
{
  const ad = makeFixture();
  const proj = mockProject([
    { id: 'shortAct', name: 'Short', frameStart: 0, frameEnd: 300, duration: 300 },
  ]);
  // duration=300 DOES fit in the 400-unit gap between s1 (end 600) and s2 (start 1000)
  const out = applyAddStrip(ad, proj, 'tMid', 'shortAct', 200);
  const track = out.nlaTracks.find((t) => t.id === 'tMid');
  const newStrip = track.strips.find((s) => s.id !== 's1' && s.id !== 's2');
  eq(newStrip.start, 600, '33d: short strip fits in gap right after s1');
  eq(newStrip.end, 900, '33e: end = 600 + 300, before s2 at 1000');
}

// ── 34. applyAddStrip refused on PROTECTED track + missing action ──
{
  const ad = makeFixture();
  ad.nlaTracks[0].flag = 0x10;   // NLATRACK_FLAG.PROTECTED
  const proj = mockProject([{ id: 'walkAct', frameStart: 0, frameEnd: 500 }]);
  const out = applyAddStrip(ad, proj, 'tBot', 'walkAct', 0);
  assert(out === ad, '34a: PROTECTED track → same ref');
  // Missing action
  const out2 = applyAddStrip(ad, proj, 'tMid', 'missingAct', 0);
  assert(out2 === ad, '34b: missing action → same ref');
  // Missing track
  const out3 = applyAddStrip(ad, proj, 'nonexistent', 'walkAct', 0);
  assert(out3 === ad, '34c: missing track → same ref');
  // No project
  const out4 = applyAddStrip(ad, null, 'tMid', 'walkAct', 0);
  assert(out4 === ad, '34d: null project → same ref');
  // Empty action id
  const out5 = applyAddStrip(ad, proj, 'tMid', '', 0);
  assert(out5 === ad, '34e: empty actionId → same ref');
}

// ── 35. wouldAddStripChange predicate ──────────────────────────────
{
  const ad = makeFixture();
  ad.nlaTracks[0].flag = 0x10;   // PROTECTED
  const proj = mockProject([{ id: 'walkAct', frameStart: 0, frameEnd: 500 }]);
  assert(wouldAddStripChange(ad, proj, 'tMid', 'walkAct'), '35a: open track + valid action');
  assert(!wouldAddStripChange(ad, proj, 'tBot', 'walkAct'), '35b: PROTECTED → false');
  assert(!wouldAddStripChange(ad, proj, 'tMid', 'missing'), '35c: missing action → false');
  assert(!wouldAddStripChange(ad, proj, 'nonexistent', 'walkAct'), '35d: missing track → false');
  assert(!wouldAddStripChange(ad, null, 'tMid', 'walkAct'), '35e: null project → false');
  assert(!wouldAddStripChange(ad, proj, 'tMid', ''), '35f: empty action → false');
}

// ── 36. applyRemoveStrip happy path + immutability ─────────────────
{
  const ad = makeFixture();
  const out = applyRemoveStrip(ad, 'tMid', 's1');
  const track = out.nlaTracks.find((t) => t.id === 'tMid');
  eq(track.strips.length, 1, '36a: strip removed');
  eq(track.strips[0].id, 's2', '36b: sibling preserved');
  // Original unchanged
  eq(ad.nlaTracks.find((t) => t.id === 'tMid').strips.length, 2, '36c: original immutable');
  // Other tracks untouched
  assert(out.nlaTracks[0] === ad.nlaTracks[0], '36d: other tracks ref-preserved');
}

// ── 37. applyRemoveStrip refused on PROTECTED + tweak strip ────────
{
  const ad = makeFixture();
  ad.nlaTracks[1].flag = 0x10;   // tMid PROTECTED
  const out = applyRemoveStrip(ad, 'tMid', 's1');
  assert(out === ad, '37a: PROTECTED track → same ref');

  const ad2 = makeFixture();
  ad2.tweakStripId = 's1';
  const out2 = applyRemoveStrip(ad2, 'tMid', 's1');
  assert(out2 === ad2, '37b: tweak strip → same ref');

  // Missing strip
  const ad3 = makeFixture();
  const out3 = applyRemoveStrip(ad3, 'tMid', 'nonexistent');
  assert(out3 === ad3, '37c: missing strip → same ref');
}

// ── 38. wouldRemoveStripChange predicate ───────────────────────────
{
  const ad = makeFixture();
  assert(wouldRemoveStripChange(ad, 'tMid', 's1'), '38a: open + exists → true');
  assert(!wouldRemoveStripChange(ad, 'tMid', 'nonexistent'), '38b: missing → false');
  ad.nlaTracks[1].flag = 0x10;
  assert(!wouldRemoveStripChange(ad, 'tMid', 's1'), '38c: PROTECTED → false');
  ad.nlaTracks[1].flag = 0;
  ad.tweakStripId = 's1';
  assert(!wouldRemoveStripChange(ad, 'tMid', 's1'), '38d: tweak strip → false');
}

// ── 39. applyRemoveTrack + index re-stamp + solo flag clear ────────
{
  const ad = makeFixture();
  // Solo tTop first so we can verify the ADT_FLAG.NLA_SOLO_TRACK gets cleared
  ad.nlaTracks[2].flag = NLATRACK_FLAG.SOLO;
  ad.flag = ADT_FLAG.NLA_SOLO_TRACK;
  const out = applyRemoveTrack(ad, 'tTop');
  eq(out.nlaTracks.length, 2, '39a: track removed');
  eq(out.nlaTracks[0].index, 0, '39b: index 0 preserved');
  eq(out.nlaTracks[1].index, 1, '39c: index 1 preserved');
  eq(out.flag & ADT_FLAG.NLA_SOLO_TRACK, 0, '39d: ADT solo flag cleared (removed track was solo)');
  // Original unchanged
  eq(ad.nlaTracks.length, 3, '39e: original immutable');

  // Removing a non-solo track does NOT clear the solo flag
  const ad2 = makeFixture();
  ad2.nlaTracks[2].flag = NLATRACK_FLAG.SOLO;
  ad2.flag = ADT_FLAG.NLA_SOLO_TRACK;
  const out2 = applyRemoveTrack(ad2, 'tBot');
  assert((out2.flag & ADT_FLAG.NLA_SOLO_TRACK) !== 0, '39f: ADT solo preserved (removed track wasn\'t solo)');
}

// ── 40. applyRemoveTrack with drift gets re-stamped contiguous ─────
{
  const ad = {
    actionId: null, slotHandle: 0, flag: 0,
    tmpActionId: null, tmpSlotHandle: 0, tweakTrackId: null, tweakStripId: null,
    nlaTracks: [
      makeNlaTrack('a', 'A', { index: 0 }),
      makeNlaTrack('b', 'B', { index: 5 }),       // drifted
      makeNlaTrack('c', 'C', { index: 99 }),      // drifted
    ],
  };
  const out = applyRemoveTrack(ad, 'b');
  eq(out.nlaTracks.length, 2, '40a: B removed');
  eq(out.nlaTracks[0].id, 'a', '40b: A first');
  eq(out.nlaTracks[0].index, 0, '40c: A index 0');
  eq(out.nlaTracks[1].id, 'c', '40d: C second');
  eq(out.nlaTracks[1].index, 1, '40e: C index re-stamped 99 → 1');
}

// ── 41. applyRemoveTrack refused on PROTECTED + tweak strip ────────
{
  const ad = makeFixture();
  ad.nlaTracks[1].flag = 0x10;   // PROTECTED
  const out = applyRemoveTrack(ad, 'tMid');
  assert(out === ad, '41a: PROTECTED track → same ref');

  const ad2 = makeFixture();
  ad2.tweakStripId = 's1';   // s1 lives in tMid
  const out2 = applyRemoveTrack(ad2, 'tMid');
  assert(out2 === ad2, '41b: track contains tweak strip → same ref');

  // Removing a different track when tweak strip is elsewhere is fine
  const out3 = applyRemoveTrack(ad2, 'tBot');
  assert(out3 !== ad2, '41c: other track removal OK even when tweak is elsewhere');
}

// ── 42. wouldRemoveTrackChange predicate ───────────────────────────
{
  const ad = makeFixture();
  assert(wouldRemoveTrackChange(ad, 'tBot'), '42a: open + exists → true');
  assert(!wouldRemoveTrackChange(ad, 'nonexistent'), '42b: missing → false');
  ad.nlaTracks[0].flag = 0x10;
  assert(!wouldRemoveTrackChange(ad, 'tBot'), '42c: PROTECTED → false');
  ad.nlaTracks[0].flag = 0;
  ad.tweakStripId = 's1';
  assert(!wouldRemoveTrackChange(ad, 'tMid'), '42d: track contains tweak strip → false');
}

// ── 43. applyPushActionDown happy path (top track has space) ───────
{
  const ad = makeFixture();
  ad.actionId = 'pushAct';
  ad.slotHandle = 3;
  const proj = mockProject([
    { id: 'pushAct', name: 'PushMe', frameStart: 0, frameEnd: 800, duration: 800 },
  ]);
  const out = applyPushActionDown(ad, proj);
  // actionId cleared
  eq(out.actionId, null, '43a: actionId cleared');
  eq(out.slotHandle, 0, '43b: slotHandle cleared');
  // Top track (tTop, index=2) gets the new strip
  const topTrack = out.nlaTracks.find((t) => t.id === 'tTop');
  eq(topTrack.strips.length, 1, '43c: strip on top track');
  eq(topTrack.strips[0].actionId, 'pushAct', '43d: strip references action');
  eq(topTrack.strips[0].name, 'PushMe', '43e: strip name = action name');
  eq(topTrack.strips[0].start, 0, '43f: strip start = 0');
  eq(topTrack.strips[0].end, 800, '43g: strip end = 800');
  // Original unchanged
  eq(ad.actionId, 'pushAct', '43h: original actionId unchanged');
  eq(ad.nlaTracks.find((t) => t.id === 'tTop').strips.length, 0, '43i: original immutable');
}

// ── 44. applyPushActionDown creates new track when top is PROTECTED
{
  const ad = makeFixture();
  ad.actionId = 'pushAct';
  ad.nlaTracks[2].flag = NLATRACK_FLAG.PROTECTED;   // tTop locked
  const proj = mockProject([
    { id: 'pushAct', name: 'Push', frameStart: 0, frameEnd: 400 },
  ]);
  const out = applyPushActionDown(ad, proj);
  eq(out.actionId, null, '44a: actionId cleared');
  // tTop unchanged (no strip added)
  eq(out.nlaTracks.find((t) => t.id === 'tTop').strips.length, 0,
    '44b: tTop still empty (was PROTECTED)');
  // New track created named after the action
  eq(out.nlaTracks.length, 4, '44c: new track created');
  const newTrack = out.nlaTracks[3];
  eq(newTrack.name, 'Push', '44d: new track named after action');
  eq(newTrack.strips.length, 1, '44e: strip on new track');
}

// ── 45. applyPushActionDown refused conditions ─────────────────────
{
  // No actionId
  const ad = makeFixture();
  ad.actionId = null;
  const out = applyPushActionDown(ad, mockProject([]));
  assert(out === ad, '45a: null actionId → same ref');

  // In tweak mode
  const ad2 = makeFixture();
  ad2.actionId = 'foo';
  ad2.flag = ADT_FLAG.NLA_EDIT_ON;
  const out2 = applyPushActionDown(ad2, mockProject([{ id: 'foo' }]));
  assert(out2 === ad2, '45b: in tweak mode → same ref');

  // wouldPushActionDownChange predicate matches
  assert(!wouldPushActionDownChange(ad), '45c: predicate: no actionId → false');
  assert(!wouldPushActionDownChange(ad2), '45d: predicate: in tweak → false');
  ad2.flag = 0;
  // Predicate ONLY checks animData state (actionId + tweak flag), NOT
  // action-presence. The actual op refuses Rule №1-style if both push
  // attempts fail (action missing from project), returning same-ref.
  assert(wouldPushActionDownChange(ad2), '45e: predicate: actionId + not in tweak → true');

  // Rule №1 verification (added in the same audit-sweep batch): if the
  // action isn't actually in the project, applyPushActionDown must
  // refuse rather than half-commit (clear actionId + create empty
  // track but no strip).
  const ad3 = makeFixture();
  ad3.actionId = 'ghostAct';
  const out3 = applyPushActionDown(ad3, mockProject([]));
  assert(out3 === ad3, '45f: action missing from project → same ref (no half-commit)');
}

// ── 46. applyPushActionDown to empty animData (no tracks) ──────────
{
  const ad = {
    actionId: 'lonely', slotHandle: 0, flag: 0,
    tmpActionId: null, tmpSlotHandle: 0, tweakTrackId: null, tweakStripId: null,
    nlaTracks: [],
  };
  const proj = mockProject([{ id: 'lonely', name: 'L', frameStart: 0, frameEnd: 200 }]);
  const out = applyPushActionDown(ad, proj);
  eq(out.actionId, null, '46a: actionId cleared');
  eq(out.nlaTracks.length, 1, '46b: new track created');
  eq(out.nlaTracks[0].name, 'L', '46c: track named after action');
  eq(out.nlaTracks[0].strips.length, 1, '46d: strip on new track');
}

console.log(`\nnlaEditorOps: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
