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
  // NaN / Infinity → ignored, same ref
  const out4 = applySetStripInfluence(ad, 'tMid', 's1', NaN);
  assert(out4 === ad, '24e: NaN ignored → same ref');
  const out5 = applySetStripInfluence(ad, 'tMid', 's1', Infinity);
  assert(out5 === ad, '24f: Infinity ignored → same ref');
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

console.log(`\nnlaEditorOps: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
