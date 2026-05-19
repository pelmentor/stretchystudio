// Tests for src/v3/operators/bakeNla.js — Animation Phase 4 Slice 4.E
// BakeNLA operator. Run: node scripts/test/test_bakeNla.mjs
//
// Coverage:
//   §1  — bakeNla input validation (Rule №1 throws)
//   §2  — empty animData → empty fcurves, sampleCount=0
//   §3  — single replace strip, no bound action: bake matches evaluateNla
//   §4  — two strips (replace + add) stacked: composed output
//   §5  — bound action layer composes on top (replace, influence 1)
//   §6  — bound action with influence 0.5 + add blendmode
//   §7  — bound action MUTED when soloing (only solo track contributes)
//   §8  — bound action MUTED when tweaking + !EVAL_UPPER_TRACKS
//   §9  — bound action evaluatable when tweaking + EVAL_UPPER_TRACKS
//   §10 — NLA_EVAL_OFF: NLA bypassed, bound action still bakes
//   §11 — muted strip / muted track / disabled track skipped
//   §12 — rnaPath universe = union of strip-action + bound-action paths
//   §13 — cleanCurves removes redundant midpoints, preserves endpoints
//   §14 — sample loop terminates inclusive of frameEndMs (no overshoot)
//   §15 — non-integer step accumulates without drift past frameEndMs
//   §16 — wouldBakeNlaChange predicate
//   §17 — applyBakeNla creates new action + assigns when useCurrentAction=false
//   §18 — applyBakeNla overwrites in-place when useCurrentAction=true
//   §19 — applyBakeNla returns null for unknown objectId / missing animData
//   §20 — applyBakeNla returns null for useCurrentAction without bound action
//   §21 — output keyform shape matches Phase 2 BezTriple (linear-vector)
//   §22 — bake round-trip: evaluateFCurve(baked) ≈ original composed output
//   §23 — invalid actionBlendmode on bound action throws (Rule №1 boundary)

import {
  bakeNla,
  applyBakeNla,
  wouldBakeNlaChange,
} from '../../src/v3/operators/bakeNla.js';
import { evaluateNla, applyBlendMode } from '../../src/anim/nlaEval.js';
import { evaluateFCurve } from '../../src/anim/fcurve.js';
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

// Fixture: project with one action 'a1' = linear ramp 0→100 over 0..1000ms on rnaPath 'pX'.
function makeProject() {
  return {
    actions: [
      {
        id: 'a1',
        name: 'A1',
        fcurves: [
          {
            id: 'fc1', rnaPath: 'pX',
            keyforms: [
              { time: 0,    value: 0,   interpolation: 'linear' },
              { time: 1000, value: 100, interpolation: 'linear' },
            ],
          },
        ],
      },
      {
        id: 'a2',
        name: 'A2',
        fcurves: [
          {
            id: 'fc2', rnaPath: 'pY',
            keyforms: [
              { time: 0,    value: 0,  interpolation: 'linear' },
              { time: 1000, value: 50, interpolation: 'linear' },
            ],
          },
        ],
      },
    ],
    nodes: [
      { id: 'obj1', type: 'part', animData: makeAnimData() },
    ],
  };
}
function makeAnimData(overrides = {}) {
  return {
    actionId: null,
    actionInfluence: 1,
    actionBlendmode: 'replace',
    actionExtendmode: 'hold',
    slotHandle: 0,
    nlaTracks: [],
    drivers: [],
    flag: 0,
    tmpActionId: null,
    tmpSlotHandle: 0,
    tweakTrackId: null,
    tweakStripId: null,
    ...overrides,
  };
}

// ── 1. bakeNla input validation (Rule №1 throws) ────────────────────────
{
  const p = makeProject();
  const ad = makeAnimData();
  throws(
    () => bakeNla(ad, p, null),
    /options object is required/,
    '1a: bakeNla null options throws'
  );
  throws(
    () => bakeNla(ad, p, { frameStartMs: NaN, frameEndMs: 100, stepMs: 10 }),
    /frameStartMs must be finite/,
    '1b: NaN frameStartMs throws'
  );
  throws(
    () => bakeNla(ad, p, { frameStartMs: 0, frameEndMs: Infinity, stepMs: 10 }),
    /frameEndMs must be finite/,
    '1c: Infinity frameEndMs throws'
  );
  throws(
    () => bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 100, stepMs: 0 }),
    /stepMs must be positive/,
    '1d: stepMs=0 throws'
  );
  throws(
    () => bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 100, stepMs: -5 }),
    /stepMs must be positive/,
    '1e: negative stepMs throws'
  );
  throws(
    () => bakeNla(ad, p, { frameStartMs: 100, frameEndMs: 50, stepMs: 10 }),
    /frameEndMs.*< frameStartMs/,
    '1f: frameEndMs<frameStartMs throws'
  );
}

// ── 2. empty animData → empty fcurves, sampleCount=0 ────────────────────
{
  const p = makeProject();
  const result = bakeNla(null, p, { frameStartMs: 0, frameEndMs: 100, stepMs: 10 });
  eq(result.fcurves.length, 0, '2a: null animData → 0 fcurves');
  eq(result.sampleCount, 0, '2a: null animData → 0 samples');

  // animData with no tracks + no bound action → empty universe → empty fcurves
  const r2 = bakeNla(makeAnimData(), p, { frameStartMs: 0, frameEndMs: 100, stepMs: 10 });
  eq(r2.fcurves.length, 0, '2b: empty animData → 0 fcurves');
  eq(r2.rnaPaths.length, 0, '2b: empty animData → 0 rnaPaths');
  // But sampleCount still runs (substrate is honest — it sampled the
  // requested range; the universe was just empty).
  assert(r2.sampleCount > 0, '2b: sampleCount > 0 even with empty universe');
}

// ── 3. single replace strip, no bound action ────────────────────────────
{
  const p = makeProject();
  const strip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    blendmode: 'replace', influence: 1,
  });
  const track = makeNlaTrack('t1', 'T_t1', { strips: [strip], index: 0 });
  const ad = makeAnimData({ nlaTracks: [track] });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 250 });
  eq(result.fcurves.length, 1, '3a: one fcurve baked');
  eq(result.fcurves[0].rnaPath, 'pX', '3a: rnaPath=pX');
  eq(result.fcurves[0].keyforms.length, 5, '3a: 5 samples (0, 250, 500, 750, 1000)');

  // Values should match the underlying linear ramp 0→100
  const kfs = result.fcurves[0].keyforms;
  close(kfs[0].value, 0, 1e-9, '3b: t=0 → 0');
  close(kfs[1].value, 25, 1e-9, '3b: t=250 → 25');
  close(kfs[2].value, 50, 1e-9, '3b: t=500 → 50');
  close(kfs[3].value, 75, 1e-9, '3b: t=750 → 75');
  close(kfs[4].value, 100, 1e-9, '3b: t=1000 → 100');
}

// ── 4. two strips (replace + add) stacked ───────────────────────────────
{
  const p = makeProject();
  // Bottom track: replace, full influence — produces 0→100
  const sB = makeNlaStrip('sB', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    blendmode: 'replace', influence: 1,
  });
  const tB = makeNlaTrack('tB', 'T_tB', { strips: [sB], index: 0 });
  // Top track: add, influence 0.5 — adds half of the ramp on top
  const sT = makeNlaStrip('sT', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    blendmode: 'add', influence: 0.5,
  });
  const tT = makeNlaTrack('tT', 'T_tT', { strips: [sT], index: 1 });
  const ad = makeAnimData({ nlaTracks: [tB, tT] });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 500 });
  eq(result.fcurves.length, 1, '4a: one fcurve');
  // At t=500: bottom = 50, top = 50 * 0.5 = 25, total = 50 + 25 = 75
  const kfs = result.fcurves[0].keyforms;
  close(kfs[1].value, 75, 1e-9, '4b: t=500 → 50 + 25 = 75');
}

// ── 5. bound action layer composes on top (replace inf=1) ───────────────
{
  // Bound action 'a2' (rnaPath='pY', 0→50). NLA empty.
  const p = makeProject();
  const ad = makeAnimData({ actionId: 'a2', actionInfluence: 1, actionBlendmode: 'replace' });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 500 });
  eq(result.fcurves.length, 1, '5a: one fcurve from bound action');
  eq(result.fcurves[0].rnaPath, 'pY', '5a: rnaPath=pY');
  const kfs = result.fcurves[0].keyforms;
  close(kfs[1].value, 25, 1e-9, '5b: bound action ramp at t=500 → 25');
}

// ── 6. bound action with influence 0.5 + add blendmode on top of NLA ───
{
  // NLA bottom: rep 'a1' (pX 0→100). Bound 'a2' (pY 0→50) blends-add
  // on top with inf 0.5. The bound action's path pY isn't in NLA, so
  // lower=0. Result at pY: 0 + 50*0.5 = 25 at t=1000.
  const p = makeProject();
  const sB = makeNlaStrip('sB', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    blendmode: 'replace', influence: 1,
  });
  const tB = makeNlaTrack('tB', 'T_tB', { strips: [sB], index: 0 });
  const ad = makeAnimData({
    nlaTracks: [tB],
    actionId: 'a2',
    actionInfluence: 0.5,
    actionBlendmode: 'add',
  });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 1000 });
  eq(result.fcurves.length, 2, '6a: two fcurves (pX from NLA, pY from bound)');
  const pY = result.fcurves.find((fc) => fc.rnaPath === 'pY');
  assert(pY, '6b: pY fcurve present');
  // pY at t=1000: bound 50 * 0.5 = 25, lower=0, add → 0 + 25 = 25
  close(pY.keyforms[1].value, 25, 1e-9, '6b: pY t=1000 = 25');
  // pX at t=1000: NLA 100, no bound contribution → 100
  const pX = result.fcurves.find((fc) => fc.rnaPath === 'pX');
  close(pX.keyforms[1].value, 100, 1e-9, '6c: pX t=1000 = 100 (no bound on pY)');
}

// ── 7. bound action MUTED when soloing ──────────────────────────────────
{
  // Two tracks: bottom non-solo (rep a1 pX), top solo (rep a2 pY).
  // Bound action 'a1' would also write pX — but soloing mutes it.
  // So baked pX = 0 (no source); pY = a2 ramp.
  const p = makeProject();
  const sB = makeNlaStrip('sB', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tB = makeNlaTrack('tB', 'T_tB', { strips: [sB], index: 0 });
  const sT = makeNlaStrip('sT', 'a2', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tT = makeNlaTrack('tT', 'T_tT', { strips: [sT], index: 1, flag: NLATRACK_FLAG.SOLO });
  const ad = makeAnimData({
    nlaTracks: [tB, tT],
    flag: ADT_FLAG.NLA_SOLO_TRACK,
    actionId: 'a1',
  });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 1000 });
  const pX = result.fcurves.find((fc) => fc.rnaPath === 'pX');
  const pY = result.fcurves.find((fc) => fc.rnaPath === 'pY');
  // pX universe present (NLA had pX strip) but soloing mutes bottom + bound → value 0
  close(pX.keyforms[1].value, 0, 1e-9, '7a: pX muted by solo → 0');
  // pY from solo track → 50
  close(pY.keyforms[1].value, 50, 1e-9, '7b: pY from solo track → 50');
}

// ── 8. bound action MUTED when tweaking + !EVAL_UPPER_TRACKS ────────────
{
  const p = makeProject();
  const ad = makeAnimData({
    actionId: 'a1',
    flag: ADT_FLAG.NLA_EDIT_ON,   // tweaking without NLA_EVAL_UPPER_TRACKS
  });
  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 1000 });
  // Bound action MUTED → empty universe (no NLA, no bound action either)
  eq(result.fcurves.length, 0, '8: tweaking + !EVAL_UPPER → bound muted → 0 fcurves');
}

// ── 9. bound action evaluatable when tweaking + EVAL_UPPER_TRACKS ───────
{
  const p = makeProject();
  const ad = makeAnimData({
    actionId: 'a1',
    flag: ADT_FLAG.NLA_EDIT_ON | ADT_FLAG.NLA_EVAL_UPPER_TRACKS,
  });
  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 500 });
  eq(result.fcurves.length, 1, '9a: tweaking + EVAL_UPPER → bound evaluatable → 1 fcurve');
  close(result.fcurves[0].keyforms[1].value, 50, 1e-9, '9b: pX t=500 = 50');
}

// ── 10. NLA_EVAL_OFF: NLA bypassed, bound action still bakes ────────────
{
  const p = makeProject();
  const sB = makeNlaStrip('sB', 'a2', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tB = makeNlaTrack('tB', 'T_tB', { strips: [sB], index: 0 });
  const ad = makeAnimData({
    nlaTracks: [tB],
    actionId: 'a1',
    flag: ADT_FLAG.NLA_EVAL_OFF,
  });
  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 500 });
  // Universe still includes both pX (bound) and pY (NLA strip's action)
  // because universe collection is independent of mute/solo/eval-off.
  // Sample values: pY = 0 (NLA eval off), pX = bound ramp value
  const pY = result.fcurves.find((fc) => fc.rnaPath === 'pY');
  const pX = result.fcurves.find((fc) => fc.rnaPath === 'pX');
  close(pY.keyforms[1].value, 0, 1e-9, '10a: pY = 0 (NLA off)');
  close(pX.keyforms[1].value, 50, 1e-9, '10b: pX from bound action at t=500');
}

// ── 11. muted strip / muted track / disabled track skipped ──────────────
{
  const p = makeProject();
  // Bottom track muted, middle strip muted, top track disabled.
  const sB = makeNlaStrip('sB', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tB = makeNlaTrack('tB', 'T_tB', { strips: [sB], index: 0, flag: NLATRACK_FLAG.MUTED });
  const sM = makeNlaStrip('sM', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1, flag: NLASTRIP_FLAG.MUTED });
  const tM = makeNlaTrack('tM', 'T_tM', { strips: [sM], index: 1 });
  const sT = makeNlaStrip('sT', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tT = makeNlaTrack('tT', 'T_tT', { strips: [sT], index: 2, flag: NLATRACK_FLAG.DISABLED });
  const ad = makeAnimData({ nlaTracks: [tB, tM, tT] });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 1000 });
  // All sources skipped → pX baked as 0 at every sample.
  const pX = result.fcurves.find((fc) => fc.rnaPath === 'pX');
  close(pX.keyforms[1].value, 0, 1e-9, '11: all skipped → pX = 0');
}

// ── 12. rnaPath universe = union of strip-action + bound-action paths ──
{
  const p = makeProject();
  const s = makeNlaStrip('s', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const t = makeNlaTrack('t', 'T_t', { strips: [s], index: 0 });
  const ad = makeAnimData({ nlaTracks: [t], actionId: 'a2' });
  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 100, stepMs: 100 });
  // Universe: pX (from strip's action a1) + pY (from bound action a2)
  eq(result.rnaPaths.length, 2, '12a: 2 unique rnaPaths');
  assert(result.rnaPaths.includes('pX'), '12b: pX in universe');
  assert(result.rnaPaths.includes('pY'), '12c: pY in universe');
}

// ── 13. cleanCurves removes redundant midpoints, preserves endpoints ───
{
  // A bound action with a constant value → many redundant samples.
  // Without cleanCurves: N samples. With cleanCurves: 2 (start + end).
  const p = {
    actions: [{
      id: 'aFlat',
      fcurves: [{
        id: 'fc', rnaPath: 'pZ',
        keyforms: [
          { time: 0, value: 42, interpolation: 'constant' },
          { time: 1000, value: 42, interpolation: 'constant' },
        ],
      }],
    }],
  };
  const ad = makeAnimData({ actionId: 'aFlat' });

  const noClean = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 100 });
  eq(noClean.fcurves[0].keyforms.length, 11, '13a: no clean → 11 samples (0, 100, ..., 1000)');

  const cleaned = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 100, cleanCurves: true });
  eq(cleaned.fcurves[0].keyforms.length, 2, '13b: clean → 2 (endpoints preserved, flat midpoints removed)');
  close(cleaned.fcurves[0].keyforms[0].value, 42, 1e-9, '13c: start key');
  close(cleaned.fcurves[0].keyforms[1].value, 42, 1e-9, '13d: end key');
  close(cleaned.fcurves[0].keyforms[1].time, 1000, 1e-9, '13e: end time = 1000');
}

// ── 14. sample loop terminates inclusive of frameEndMs ─────────────────
{
  // Range 0..100 step 25 → samples at 0, 25, 50, 75, 100 (5 samples)
  const p = makeProject();
  const s = makeNlaStrip('s', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const t = makeNlaTrack('t', 'T_t', { strips: [s], index: 0 });
  const ad = makeAnimData({ nlaTracks: [t] });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 100, stepMs: 25 });
  eq(result.sampleCount, 5, '14a: 5 samples (0, 25, 50, 75, 100)');
  eq(result.fcurves[0].keyforms[4].time, 100, '14b: last sample lands on frameEndMs');
}

// ── 15. non-integer step accumulates without drift past frameEndMs ─────
{
  // Range 0..1000 step 1000/24 = 41.6̄7 → 25 samples (0, 41.67, ..., last
  // landing on or before 1000 — final clamped to 1000 exactly).
  const p = makeProject();
  const s = makeNlaStrip('s', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const t = makeNlaTrack('t', 'T_t', { strips: [s], index: 0 });
  const ad = makeAnimData({ nlaTracks: [t] });

  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 1000 / 24 });
  // 24 fps = ~41.67ms step; 1000/41.67 ≈ 24, so 25 samples (0..24 inclusive)
  // The last sample is at 1000 exactly (clamp).
  const kfs = result.fcurves[0].keyforms;
  close(kfs[kfs.length - 1].time, 1000, 1e-9, '15a: last sample = frameEndMs');
  // Penultimate sample must be < 1000 (the clamp only fires once)
  assert(kfs[kfs.length - 2].time < 1000, '15b: penultimate < 1000');
}

// ── 16. wouldBakeNlaChange predicate ─────────────────────────────────────
{
  assert(!wouldBakeNlaChange(null), '16a: null → false');
  assert(!wouldBakeNlaChange(makeAnimData()), '16b: empty → false');
  assert(wouldBakeNlaChange(makeAnimData({ actionId: 'a1' })), '16c: bound action → true');
  const t = makeNlaTrack('t', 'T_t', { strips: [makeNlaStrip('s', 'a1', {})], index: 0 });
  assert(wouldBakeNlaChange(makeAnimData({ nlaTracks: [t] })), '16d: has strip → true');
  // Track with empty strips array doesn't count
  const tEmpty = makeNlaTrack('tE', 'T_tE', { strips: [], index: 0 });
  assert(!wouldBakeNlaChange(makeAnimData({ nlaTracks: [tEmpty] })), '16e: empty track → false');
}

// ── 17. applyBakeNla creates new action + assigns when useCurrentAction=false ──
{
  const p = makeProject();
  // Add an NLA strip on obj1
  const obj = p.nodes.find((n) => n.id === 'obj1');
  const s = makeNlaStrip('s', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const t = makeNlaTrack('t', 'T_t', { strips: [s], index: 0 });
  obj.animData.nlaTracks = [t];

  const before = p.actions.length;
  const result = applyBakeNla(p, 'obj1', { frameStartMs: 0, frameEndMs: 1000, stepMs: 250 });
  assert(result !== null, '17a: applyBakeNla returns result');
  eq(p.actions.length, before + 1, '17b: new action appended');
  // The created action's id is bound on obj1
  eq(obj.animData.actionId, result.actionId, '17c: animData.actionId set to baked id');
  eq(result.replacedActionId, null, '17d: replacedActionId=null (no prior binding)');
  eq(result.fcurveCount, 1, '17e: 1 fcurve baked');
  eq(result.action.meta.source, 'baked', '17f: meta.source=baked');
}

// ── 18. applyBakeNla overwrites in-place when useCurrentAction=true ────
{
  const p = makeProject();
  const obj = p.nodes.find((n) => n.id === 'obj1');
  // Bind an action first
  obj.animData.actionId = 'a1';
  // Add an NLA strip
  const s = makeNlaStrip('s', 'a2', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  obj.animData.nlaTracks = [makeNlaTrack('t', 'T_t', { strips: [s], index: 0 })];

  const before = p.actions.length;
  const result = applyBakeNla(p, 'obj1', {
    frameStartMs: 0, frameEndMs: 1000, stepMs: 500, useCurrentAction: true,
  });
  assert(result !== null, '18a: applyBakeNla returns result');
  eq(p.actions.length, before, '18b: action count unchanged (overwrite)');
  eq(result.actionId, 'a1', '18c: actionId = current');
  eq(result.replacedActionId, 'a1', '18d: replacedActionId=a1');
  // The action's fcurves now reflect the bake (universe = pX from bound a1 + pY from strip a2 = 2 fcurves)
  const a1 = p.actions.find((a) => a.id === 'a1');
  eq(a1.fcurves.length, 2, '18e: a1 now carries 2 fcurves (universe of bake)');
  eq(a1.meta.source, 'baked', '18f: meta.source=baked');
}

// ── 19. applyBakeNla returns null for unknown objectId / missing animData ──
{
  const p = makeProject();
  eq(applyBakeNla(p, 'nope', { frameStartMs: 0, frameEndMs: 100, stepMs: 10 }), null, '19a: unknown objectId → null');
  eq(applyBakeNla(null, 'obj1', { frameStartMs: 0, frameEndMs: 100, stepMs: 10 }), null, '19b: null project → null');

  const p2 = makeProject();
  const obj = p2.nodes.find((n) => n.id === 'obj1');
  delete obj.animData;
  eq(applyBakeNla(p2, 'obj1', { frameStartMs: 0, frameEndMs: 100, stepMs: 10 }), null, '19c: missing animData slot → null');
}

// ── 20. applyBakeNla returns null for useCurrentAction without bound action ──
{
  const p = makeProject();
  // No animData.actionId set
  const result = applyBakeNla(p, 'obj1', {
    frameStartMs: 0, frameEndMs: 100, stepMs: 10, useCurrentAction: true,
  });
  eq(result, null, '20: useCurrentAction without bound → null (Rule №1)');
}

// ── 21. output keyform shape matches Phase 2 BezTriple (linear-vector) ──
{
  const p = makeProject();
  const ad = makeAnimData({ actionId: 'a1' });
  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 100, stepMs: 50 });
  const kf = result.fcurves[0].keyforms[0];
  assert(typeof kf.time === 'number', '21a: time number');
  assert(typeof kf.value === 'number', '21b: value number');
  assert(kf.handleLeft && kf.handleRight, '21c: handles present');
  eq(kf.handleType.left, 'vector', '21d: handleType.left=vector');
  eq(kf.handleType.right, 'vector', '21e: handleType.right=vector');
  eq(kf.interpolation, 'linear', '21f: interpolation=linear');
  eq(kf.flag, 0, '21g: flag=0');
}

// ── 22. bake round-trip: evaluateFCurve(baked) ≈ original composed ─────
{
  // Round-trip test: bake the composed NLA+bound, then evaluate the
  // baked fcurves at intermediate frames — should match the original
  // composed values within the linear-interp limits of the sample density.
  const p = makeProject();
  const sB = makeNlaStrip('sB', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tB = makeNlaTrack('tB', 'T_tB', { strips: [sB], index: 0 });
  const ad = makeAnimData({ nlaTracks: [tB] });

  // Bake at 50ms step (dense — 21 samples for 0..1000)
  const result = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 50 });
  const baked = result.fcurves[0];

  // Sample 7 intermediate frames + verify the baked fcurve evaluates
  // to the same value evaluateNla produces (within linear-interp error
  // on a linear source curve = exact).
  for (const t of [0, 100, 200, 333, 500, 777, 1000]) {
    const original = /** @type {number} */ (evaluateNla(ad, t, p).get('pX'));
    const baked_value = evaluateFCurve(baked, t);
    close(baked_value, original, 1e-6, `22: round-trip t=${t}`);
  }
}

// ── 23. invalid actionBlendmode on bound action throws (Rule №1) ───────
{
  const p = makeProject();
  const ad = makeAnimData({ actionId: 'a1', actionBlendmode: 'bogus' });
  throws(
    () => bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 100, stepMs: 10 }),
    /actionBlendmode is.*'bogus'/,
    '23: invalid actionBlendmode throws'
  );
}

// ── 24. degenerate single-frame range (audit-fix MED-A3) ────────────────
{
  const p = makeProject();
  const ad = makeAnimData({ actionId: 'a1' });
  const result = bakeNla(ad, p, { frameStartMs: 500, frameEndMs: 500, stepMs: 10 });
  eq(result.sampleCount, 1, '24a: frameStart=frameEnd → 1 sample');
  eq(result.fcurves[0].keyforms.length, 1, '24b: 1 keyform');
  close(result.fcurves[0].keyforms[0].time, 500, 1e-9, '24c: time=500');
  // At t=500: a1 ramp (0..100 over 0..1000) = 50
  close(result.fcurves[0].keyforms[0].value, 50, 1e-9, '24d: value=50');
}

// ── 25. actionExtendmode='nothing' skips bound action outside range ────
{
  // Bound action 'a1' has frame range derivable from its fcurve
  // keyforms (no explicit frameStart/frameEnd) → [0, 1000].
  // Bake from -500..1500, sample step 500 → samples at -500, 0, 500, 1000, 1500.
  // With 'nothing': samples at -500, 1500 are outside → contribution=0.
  // Pre-fix (no extendmode honoring): every sample would evaluate at its own time,
  // extrapolating outside range.
  const p = makeProject();
  const ad = makeAnimData({ actionId: 'a1', actionExtendmode: 'nothing' });
  const result = bakeNla(ad, p, { frameStartMs: -500, frameEndMs: 1500, stepMs: 500 });
  const kfs = result.fcurves[0].keyforms;
  // Samples at -500, 0, 500, 1000, 1500
  close(kfs[0].value, 0, 1e-9, "25a: t=-500 ('nothing' outside) → 0");
  close(kfs[1].value, 0, 1e-9, "25b: t=0 (boundary, inclusive) → 0");
  close(kfs[2].value, 50, 1e-9, "25c: t=500 (inside) → 50");
  close(kfs[3].value, 100, 1e-9, "25d: t=1000 (boundary, inclusive) → 100");
  close(kfs[4].value, 0, 1e-9, "25e: t=1500 ('nothing' outside) → 0");
}

// ── 26. actionExtendmode='hold' clamps sampleT to action's frame range ─
{
  // 'hold' (default): outside range, evaluate AT the boundary.
  // At t=-500 → clamp to 0 → value 0; at t=1500 → clamp to 1000 → value 100.
  const p = makeProject();
  const ad = makeAnimData({ actionId: 'a1', actionExtendmode: 'hold' });
  const result = bakeNla(ad, p, { frameStartMs: -500, frameEndMs: 1500, stepMs: 500 });
  const kfs = result.fcurves[0].keyforms;
  close(kfs[0].value, 0, 1e-9, '26a: t=-500 (hold clamps to 0) → 0');
  close(kfs[4].value, 100, 1e-9, '26b: t=1500 (hold clamps to 1000) → 100');
}

// ── 27. actionExtendmode='hold_forward' skips before, clamps after ─────
{
  const p = makeProject();
  const ad = makeAnimData({ actionId: 'a1', actionExtendmode: 'hold_forward' });
  const result = bakeNla(ad, p, { frameStartMs: -500, frameEndMs: 1500, stepMs: 500 });
  const kfs = result.fcurves[0].keyforms;
  close(kfs[0].value, 0, 1e-9, "27a: t=-500 ('hold_forward' skips before) → 0");
  close(kfs[2].value, 50, 1e-9, '27b: t=500 (inside) → 50');
  close(kfs[4].value, 100, 1e-9, "27c: t=1500 (hold_forward clamps to 1000) → 100");
}

// ── 28. wouldBakeNlaChange = false when only null-actionId strips ──────
{
  // Audit-fix MED-A1: a strip with actionId=null produces no rnaPath
  // contribution, so the bake would emit zero fcurves. Predicate must
  // accurately reflect this. (makeNlaStrip throws on null actionId per
  // its own validation, so we hand-construct a shell strip directly.)
  const shellStrip = { id: 's2', actionId: null, start: 0, end: 1000, blendmode: 'replace', flag: 0, extendmode: 'hold' };
  const t2 = makeNlaTrack('tN2', 'T_tN2', { strips: [shellStrip], index: 0 });
  assert(!wouldBakeNlaChange(makeAnimData({ nlaTracks: [t2] })),
    '28: strip with actionId=null → predicate false');
  // Sanity: still true when AT LEAST ONE strip has a real actionId
  const realStrip = makeNlaStrip('sReal', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000 });
  const t3 = makeNlaTrack('tMix', 'T_tMix', { strips: [shellStrip, realStrip], index: 0 });
  assert(wouldBakeNlaChange(makeAnimData({ nlaTracks: [t3] })),
    '28b: mixed null + real-actionId strips → predicate true');
}

// ── 29. bakeNla is pure: doesn't mutate inputs (audit-fix MED-A2) ──────
{
  const p = makeProject();
  const sB = makeNlaStrip('sB', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tB = makeNlaTrack('tB', 'T_tB', { strips: [sB], index: 0 });
  const ad = makeAnimData({ nlaTracks: [tB], actionId: 'a2' });
  const beforeAd = JSON.stringify(ad);
  const beforeP = JSON.stringify(p);
  bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 100 });
  eq(JSON.stringify(ad), beforeAd, '29a: animData not mutated');
  eq(JSON.stringify(p), beforeP, '29b: project not mutated');
}

// ── 30. invalid actionBlendmode throws EVEN when soloing (audit-fix HIGH-A1) ──
{
  // Pre-fix the blendmode validation was guarded by boundActionEvaluatable,
  // so a project with soloing + bad blendmode would silently swallow the bug.
  const p = makeProject();
  const sT = makeNlaStrip('sT', 'a1', { start: 0, end: 1000, actstart: 0, actend: 1000, blendmode: 'replace', influence: 1 });
  const tT = makeNlaTrack('tT', 'T_tT', { strips: [sT], index: 0, flag: NLATRACK_FLAG.SOLO });
  const ad = makeAnimData({
    nlaTracks: [tT],
    actionId: 'a1',
    actionBlendmode: 'bogus',
    flag: ADT_FLAG.NLA_SOLO_TRACK,
  });
  throws(
    () => bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 100, stepMs: 10 }),
    /actionBlendmode is.*'bogus'/,
    '30: bad actionBlendmode throws even when soloing (unconditional check)'
  );
}

// ── 31. clean uses SUM-of-abs ≥ 1e-4 boundary (audit-fix HIGH-F1) ─────
{
  // Direct test of the predicate: a midpoint with abs(cur-prev) + abs(cur-next) = 1e-4
  // is on the boundary; the strict `<` keeps it (NOT removed). A midpoint with
  // sum = 8e-5 (< 1e-4) is removed.
  // Build a project with an action whose fcurve has 3 keyforms at t=0, 500, 1000
  // with values 0, ~5e-5, 1e-4 → at t=500: sum-of-abs to neighbors = 5e-5 + 5e-5 = 1e-4
  // → NOT removed (boundary).
  const p = {
    actions: [{
      id: 'aE', name: 'AE',
      fcurves: [{
        id: 'fc', rnaPath: 'pZ',
        keyforms: [
          { time: 0,    value: 0,      interpolation: 'linear' },
          { time: 500,  value: 5e-5,   interpolation: 'linear' },
          { time: 1000, value: 1e-4,   interpolation: 'linear' },
        ],
      }],
    }],
  };
  const ad = makeAnimData({ actionId: 'aE' });
  // Bake at exactly the 3 keyform times so each sample sits on a known value.
  const cleaned = bakeNla(ad, p, { frameStartMs: 0, frameEndMs: 1000, stepMs: 500, cleanCurves: true });
  // At sum=1e-4, NOT < 1e-4, so midpoint kept → 3 samples
  eq(cleaned.fcurves[0].keyforms.length, 3, '31a: sum=1e-4 boundary keeps midpoint (3 samples)');

  // Now a strictly-flat fcurve: midpoint deltas are 0+0=0 < 1e-4 → removed
  const pFlat = {
    actions: [{
      id: 'aF', name: 'AF',
      fcurves: [{
        id: 'fc', rnaPath: 'pZ',
        keyforms: [
          { time: 0,    value: 7, interpolation: 'linear' },
          { time: 1000, value: 7, interpolation: 'linear' },
        ],
      }],
    }],
  };
  const adFlat = makeAnimData({ actionId: 'aF' });
  const cleanedFlat = bakeNla(adFlat, pFlat, { frameStartMs: 0, frameEndMs: 1000, stepMs: 100, cleanCurves: true });
  eq(cleanedFlat.fcurves[0].keyforms.length, 2, '31b: strictly-flat midpoints (sum=0) removed → endpoints only');
}

// ── 32. applyBakeNla writes frameStart/frameEnd/duration (audit-fix MED-F2) ──
{
  const p = makeProject();
  const obj = p.nodes.find((n) => n.id === 'obj1');
  obj.animData.actionId = 'a1';
  const result = applyBakeNla(p, 'obj1', { frameStartMs: 250, frameEndMs: 1750, stepMs: 100 });
  assert(result, '32: applyBakeNla returned result');
  eq(result.action.frameStart, 250, '32a: frameStart=250');
  eq(result.action.frameEnd, 1750, '32b: frameEnd=1750');
  eq(result.action.duration, 1500, '32c: duration=1500');
}

// ── 33. applyBakeNla useCurrent=true throws when project.actions missing ───
{
  // Audit-fix MED-A4: a project missing actions[] in useCurrent path is a
  // shape bug, not a "nothing to do" — Rule №1 demands throw.
  const p = makeProject();
  const obj = p.nodes.find((n) => n.id === 'obj1');
  obj.animData.actionId = 'a1';   // claim a binding
  delete p.actions;                // wipe the array → shape bug
  throws(
    () => applyBakeNla(p, 'obj1', { frameStartMs: 0, frameEndMs: 100, stepMs: 10, useCurrentAction: true }),
    /project\.actions must be an array/,
    '33: missing project.actions in useCurrent path throws (Rule №1)'
  );
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
