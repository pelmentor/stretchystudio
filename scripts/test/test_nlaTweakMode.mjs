// Tests for src/anim/nlaTweakMode.js — Animation Phase 4 Slice 4.C.
// Run: node scripts/test/test_nlaTweakMode.mjs
//
// Coverage:
//   §1  — enterTweakMode happy path (TWEAKUSER tagging + DISABLED
//         cascade + action swap + flag set)
//   §2  — enterTweakMode untags the active strip itself (Blender :2397)
//   §3  — enterTweakMode short-circuits when already in tweak mode
//   §4  — enterTweakMode fails when track/strip missing
//   §5  — enterTweakMode fails when strip has no actionId
//   §6  — enterTweakMode honors NLA_EVAL_UPPER_TRACKS (only active
//         track disabled, not the ones above)
//   §7  — exitTweakMode restores pre-tweak action + clears all state
//   §8  — exitTweakMode is no-op when not in tweak mode
//   §9  — clearTweakFlags clears flags but does NOT restore action
//   §10 — full enter→exit round-trip leaves animData byte-equal to start
//         (modulo the DISABLED-on-the-active-track + TWEAKUSER tags being
//         cleared by exit)
//   §11 — enter→eval integration: evaluator skips DISABLED tracks +
//         the tweak strip itself (regression test with 4.B's evaluator)
//   §12 — exit→eval integration: evaluator goes back to normal stack walk

import {
  enterTweakMode,
  exitTweakMode,
  clearTweakFlags,
} from '../../src/anim/nlaTweakMode.js';
import {
  makeNlaStrip,
  makeNlaTrack,
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
  isTweakModeOn,
} from '../../src/anim/nla.js';
import { evaluateNla } from '../../src/anim/nlaEval.js';

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

// Standard fixture: 3-track stack with strips, animData bound to 'baseAct'.
function makeFixture() {
  return {
    actionId: 'baseAct',
    slotHandle: 0,
    actionInfluence: 1,
    actionBlendmode: 'replace',
    actionExtendmode: 'hold',
    nlaTracks: [
      makeNlaTrack('tBot', 'Lower Body', { index: 0, strips: [
        makeNlaStrip('sBot1', 'idleAct', {
          start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
        }),
      ] }),
      makeNlaTrack('tMid', 'Upper Body', { index: 1, strips: [
        makeNlaStrip('sMid1', 'walkAct', {
          start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
        }),
        makeNlaStrip('sMid2', 'walkAct', {   // shares walkAct → expected TWEAKUSER
          start: 1000, end: 2000, actstart: 0, actend: 1000, influence: 1,
        }),
      ] }),
      makeNlaTrack('tTop', 'Face', { index: 2, strips: [
        makeNlaStrip('sTop1', 'talkAct', {
          start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
        }),
      ] }),
    ],
    drivers: [],
    flag: 0,
    tmpActionId: null, tmpSlotHandle: 0,
    tweakTrackId: null, tweakStripId: null,
  };
}

// ── 1. enterTweakMode happy path ───────────────────────────────────
{
  const ad = makeFixture();
  const ok = enterTweakMode(ad, 'tMid', 'sMid1');
  assert(ok, '1: enter returns true on success');
  assert(isTweakModeOn(ad), '1: ADT_NLA_EDIT_ON set');
  eq(ad.tweakTrackId, 'tMid', '1: tweakTrackId set');
  eq(ad.tweakStripId, 'sMid1', '1: tweakStripId set');
  eq(ad.tmpActionId, 'baseAct', '1: tmpActionId backed up');
  eq(ad.tmpSlotHandle, 0, '1: tmpSlotHandle backed up');
  eq(ad.actionId, 'walkAct', '1: actionId swapped to tweak strip\'s action');
  // Active track + every track ABOVE (index > activeIdx) DISABLED
  const tBot = ad.nlaTracks.find((t) => t.id === 'tBot');
  const tMid = ad.nlaTracks.find((t) => t.id === 'tMid');
  const tTop = ad.nlaTracks.find((t) => t.id === 'tTop');
  eq(tBot.flag & NLATRACK_FLAG.DISABLED, 0, '1: track below active NOT disabled');
  eq(tMid.flag & NLATRACK_FLAG.DISABLED, NLATRACK_FLAG.DISABLED, '1: active track DISABLED');
  eq(tTop.flag & NLATRACK_FLAG.DISABLED, NLATRACK_FLAG.DISABLED, '1: track above active DISABLED');
}

// ── 2. enterTweakMode TWEAKUSER tagging ────────────────────────────
{
  const ad = makeFixture();
  enterTweakMode(ad, 'tMid', 'sMid1');
  // sMid1 = active strip → untagged (Blender :2397)
  // sMid2 = shares walkAct → TWEAKUSER
  // sBot1 (idleAct), sTop1 (talkAct) → untagged
  const sMid1 = ad.nlaTracks.find((t) => t.id === 'tMid').strips[0];
  const sMid2 = ad.nlaTracks.find((t) => t.id === 'tMid').strips[1];
  const sBot1 = ad.nlaTracks.find((t) => t.id === 'tBot').strips[0];
  const sTop1 = ad.nlaTracks.find((t) => t.id === 'tTop').strips[0];
  eq(sMid1.flag & NLASTRIP_FLAG.TWEAKUSER, 0,
    '2: active strip itself NOT tagged TWEAKUSER (Blender :2397)');
  eq(sMid2.flag & NLASTRIP_FLAG.TWEAKUSER, NLASTRIP_FLAG.TWEAKUSER,
    '2: strip sharing tweak action IS tagged TWEAKUSER');
  eq(sBot1.flag & NLASTRIP_FLAG.TWEAKUSER, 0,
    '2: strip in lower track NOT tagged (different action)');
  eq(sTop1.flag & NLASTRIP_FLAG.TWEAKUSER, 0,
    '2: strip in upper track NOT tagged (different action)');
}

// ── 3. enterTweakMode short-circuits when already in tweak mode ────
{
  const ad = makeFixture();
  const ok1 = enterTweakMode(ad, 'tMid', 'sMid1');
  assert(ok1, '3: first enter succeeds');
  // Mutate tweakStripId to detect if second enter re-runs
  ad.tweakStripId = 'should_be_preserved_by_early_return';
  const ok2 = enterTweakMode(ad, 'tTop', 'sTop1');
  assert(ok2, '3: second enter returns true (already in tweak)');
  eq(ad.tweakStripId, 'should_be_preserved_by_early_return',
    '3: second enter early-returns, does NOT re-tag or re-swap');
}

// ── 4. enterTweakMode fails when track/strip missing ───────────────
{
  const ad = makeFixture();
  eq(enterTweakMode(ad, 'nonexistent_track', 'sMid1'), false,
    '4: missing track → false');
  eq(enterTweakMode(ad, 'tMid', 'nonexistent_strip'), false,
    '4: missing strip → false');
  // animData unchanged (no flag set, no swap)
  assert(!isTweakModeOn(ad), '4: failure leaves tweak-mode off');
  eq(ad.actionId, 'baseAct', '4: failure leaves actionId untouched');
}

// ── 5. enterTweakMode fails when strip has no actionId ─────────────
{
  const ad = makeFixture();
  // Hand-construct a strip without actionId (raw object; makeNlaStrip
  // would reject this at construction). Simulates corrupt JSON.
  ad.nlaTracks[1].strips.push({
    id: 'sNoAct', name: 'NoAct', actionId: null,
    slotHandle: 0, start: 0, end: 100, actstart: 0, actend: 100,
    repeat: 1, scale: 1, blendmode: 'replace', extendmode: 'hold',
    influence: 1, blendin: 0, blendout: 0, fcurves: [], flag: 0,
  });
  eq(enterTweakMode(ad, 'tMid', 'sNoAct'), false,
    '5: strip with null actionId → false (matches Blender BLI_assert_unreachable)');
  assert(!isTweakModeOn(ad), '5: failure leaves tweak-mode off');
}

// ── 6. NLA_EVAL_UPPER_TRACKS gate ──────────────────────────────────
{
  // With NLA_EVAL_UPPER_TRACKS pre-set, only the active track gets
  // DISABLED; tracks above stay evaluable so the user sees their
  // contribution on top of the tweaked action layer.
  const ad = makeFixture();
  ad.flag = ADT_FLAG.NLA_EVAL_UPPER_TRACKS;
  enterTweakMode(ad, 'tMid', 'sMid1');
  const tMid = ad.nlaTracks.find((t) => t.id === 'tMid');
  const tTop = ad.nlaTracks.find((t) => t.id === 'tTop');
  eq(tMid.flag & NLATRACK_FLAG.DISABLED, NLATRACK_FLAG.DISABLED,
    '6: NLA_EVAL_UPPER_TRACKS: active track still DISABLED');
  eq(tTop.flag & NLATRACK_FLAG.DISABLED, 0,
    '6: NLA_EVAL_UPPER_TRACKS: upper track NOT disabled (Blender :2404-2408)');
}

// ── 7. exitTweakMode restores everything ───────────────────────────
{
  const ad = makeFixture();
  enterTweakMode(ad, 'tMid', 'sMid1');
  exitTweakMode(ad);

  assert(!isTweakModeOn(ad), '7: ADT_NLA_EDIT_ON cleared');
  eq(ad.actionId, 'baseAct', '7: actionId restored from tmpActionId');
  eq(ad.tmpActionId, null, '7: tmpActionId cleared');
  eq(ad.tmpSlotHandle, 0, '7: tmpSlotHandle cleared');
  eq(ad.tweakTrackId, null, '7: tweakTrackId cleared');
  eq(ad.tweakStripId, null, '7: tweakStripId cleared');
  // All track DISABLED bits cleared
  for (const t of ad.nlaTracks) {
    eq(t.flag & NLATRACK_FLAG.DISABLED, 0,
      `7: track ${t.id} DISABLED bit cleared`);
  }
  // All strip TWEAKUSER bits cleared
  for (const t of ad.nlaTracks) {
    for (const s of t.strips) {
      eq(s.flag & NLASTRIP_FLAG.TWEAKUSER, 0,
        `7: strip ${s.id} TWEAKUSER bit cleared`);
    }
  }
}

// ── 8. exitTweakMode no-op when not in tweak mode ──────────────────
{
  const ad = makeFixture();
  const before = JSON.stringify(ad);
  exitTweakMode(ad);
  eq(JSON.stringify(ad), before,
    '8: exit when not in tweak mode is a no-op (Blender :2509-2511)');
}

// ── 9. clearTweakFlags clears flags only (no restore) ──────────────
{
  const ad = makeFixture();
  enterTweakMode(ad, 'tMid', 'sMid1');
  clearTweakFlags(ad);

  assert(!isTweakModeOn(ad), '9: ADT_NLA_EDIT_ON cleared');
  // Tracks + strips cleared
  for (const t of ad.nlaTracks) {
    eq(t.flag & NLATRACK_FLAG.DISABLED, 0, `9: track ${t.id} DISABLED cleared`);
    for (const s of t.strips) {
      eq(s.flag & NLASTRIP_FLAG.TWEAKUSER, 0, `9: strip ${s.id} TWEAKUSER cleared`);
    }
  }
  // But action + backup pointers + runtime pointers UNTOUCHED
  // (this is the key difference from exitTweakMode)
  eq(ad.actionId, 'walkAct', '9: actionId STILL the tweak strip\'s (no restore)');
  eq(ad.tmpActionId, 'baseAct', '9: tmpActionId STILL set (clearTweakFlags doesn\'t touch)');
  eq(ad.tweakStripId, 'sMid1', '9: tweakStripId STILL set');
  eq(ad.tweakTrackId, 'tMid', '9: tweakTrackId STILL set');
}

// ── 10. Full enter→exit round-trip is shape-preserving ────────────
{
  const ad = makeFixture();
  const before = JSON.stringify(ad);
  enterTweakMode(ad, 'tMid', 'sMid1');
  exitTweakMode(ad);
  eq(JSON.stringify(ad), before,
    '10: enter→exit byte-identical round-trip (flag bits clean, action restored)');
}

// ── 11. Integration: evaluator skips DISABLED tracks + tweak strip ─
{
  // Build a project with 3 actions, each writing a distinct paramX value.
  const project = {
    actions: [
      { id: 'baseAct', fcurves: [{
        id: 'fc1', rnaPath: 'paramX',
        keyforms: [
          { time: 0, value: 1, interpolation: 'linear' },
          { time: 1000, value: 1, interpolation: 'linear' },
        ],
      }] },
      { id: 'idleAct', fcurves: [{
        id: 'fc1', rnaPath: 'paramX',
        keyforms: [
          { time: 0, value: 10, interpolation: 'linear' },
          { time: 1000, value: 10, interpolation: 'linear' },
        ],
      }] },
      { id: 'walkAct', fcurves: [{
        id: 'fc1', rnaPath: 'paramX',
        keyforms: [
          { time: 0, value: 100, interpolation: 'linear' },
          { time: 1000, value: 100, interpolation: 'linear' },
        ],
      }] },
      { id: 'talkAct', fcurves: [{
        id: 'fc1', rnaPath: 'paramX',
        keyforms: [
          { time: 0, value: 1000, interpolation: 'linear' },
          { time: 1000, value: 1000, interpolation: 'linear' },
        ],
      }] },
    ],
  };

  const ad = makeFixture();
  enterTweakMode(ad, 'tMid', 'sMid1');

  // After enter, evaluateNla should:
  //   - skip tMid (DISABLED — active track)
  //   - skip tTop (DISABLED — above active)
  //   - only tBot evaluates: sBot1 → idleAct → paramX = 10
  // (replace blendmode, fresh acc, lower default = 0 → 0*0 + 10*1 = 10)
  const acc = evaluateNla(ad, 500, project);
  close(/** @type number */ (acc.get('paramX')), 10, 1e-9,
    '11: tweak-mode eval: only undisabled track below active contributes (paramX=10)');

  // Also: even within tMid, sMid2 should be skipped by the
  // "DISABLED track" gate; but if NLA_EVAL_UPPER_TRACKS were set,
  // sMid2 would be in a non-disabled track yet still skipped by
  // the tweak-strip-id gate.
  ad.flag |= ADT_FLAG.NLA_EVAL_UPPER_TRACKS;
  // Re-enter is no-op (already in tweak); undisable tTop manually to
  // simulate "upper tracks evaluate" semantics (Blender does this
  // implicitly via the eval-upper-tracks check inside enter, but we
  // already entered before setting the flag in this test).
  const tTop = ad.nlaTracks.find((t) => t.id === 'tTop');
  tTop.flag &= ~NLATRACK_FLAG.DISABLED;
  // Now: tBot evaluates (idleAct=10), tMid still DISABLED (active),
  // tTop evaluates (talkAct=1000, replace → 1000).
  const acc2 = evaluateNla(ad, 500, project);
  close(/** @type number */ (acc2.get('paramX')), 1000, 1e-9,
    '11: NLA_EVAL_UPPER_TRACKS: tTop overrides via replace → paramX=1000');
}

// ── 12. Integration: exit restores normal stack evaluation ─────────
{
  const project = {
    actions: [
      { id: 'baseAct', fcurves: [{ id: 'fc1', rnaPath: 'paramX',
        keyforms: [{ time: 0, value: 1, interpolation: 'linear' },
                   { time: 1000, value: 1, interpolation: 'linear' }] }] },
      { id: 'idleAct', fcurves: [{ id: 'fc1', rnaPath: 'paramX',
        keyforms: [{ time: 0, value: 10, interpolation: 'linear' },
                   { time: 1000, value: 10, interpolation: 'linear' }] }] },
      { id: 'walkAct', fcurves: [{ id: 'fc1', rnaPath: 'paramX',
        keyforms: [{ time: 0, value: 100, interpolation: 'linear' },
                   { time: 1000, value: 100, interpolation: 'linear' }] }] },
      { id: 'talkAct', fcurves: [{ id: 'fc1', rnaPath: 'paramX',
        keyforms: [{ time: 0, value: 1000, interpolation: 'linear' },
                   { time: 1000, value: 1000, interpolation: 'linear' }] }] },
    ],
  };
  const ad = makeFixture();
  enterTweakMode(ad, 'tMid', 'sMid1');
  exitTweakMode(ad);

  // Post-exit: all tracks evaluate normally. Bottom-up (replace):
  //   tBot: paramX = 10
  //   tMid: sMid1 active at t=500 → paramX = 100 (replace 10 → 100)
  //         sMid2 active at t=1000-2000 only → skipped at t=500
  //   tTop: paramX = 1000 (replace 100 → 1000)
  const acc = evaluateNla(ad, 500, project);
  close(/** @type number */ (acc.get('paramX')), 1000, 1e-9,
    '12: post-exit normal stack walk: all 3 tracks replace → paramX=1000');
}

console.log(`\nnlaTweakMode: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
