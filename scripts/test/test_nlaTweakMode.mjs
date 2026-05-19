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
// Audit-fix HIGH-A1: uses NONZERO slotHandle (7) so save/restore pinning
// is real. tmpSlotHandle starts at 99 (a sentinel value the post-exit
// state must NOT carry — proves the clear-to-0 step ran).
// makeNlaStrip's slotHandle defaults to 0; the tweak strip's slot
// (5 for sMid1) is also nonzero so the swap-in / swap-out is visible.
function makeFixture() {
  return {
    actionId: 'baseAct',
    slotHandle: 7,
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
          slotHandle: 5,
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
    tmpActionId: null, tmpSlotHandle: 99,   // sentinel — must clear to 0 on exit
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
  // HIGH-A1: nonzero slotHandle in fixture pins save/restore — 7 must
  // make it into tmpSlotHandle (not 0 default coincidence).
  eq(ad.tmpSlotHandle, 7, '1: tmpSlotHandle backed up (=7, HIGH-A1 pinning)');
  eq(ad.actionId, 'walkAct', '1: actionId swapped to tweak strip\'s action');
  // tweak strip's own slotHandle (5) swapped in.
  eq(ad.slotHandle, 5, '1: slotHandle swapped to tweak strip\'s slotHandle (=5)');
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

// ── 3. enterTweakMode idempotent on SAME strip; REJECTS different
// strip while already in tweak (audit-fix HIGH-A2 + LOW-F8 JSON pin)
{
  const ad = makeFixture();
  const ok1 = enterTweakMode(ad, 'tMid', 'sMid1');
  assert(ok1, '3a: first enter succeeds');
  const afterFirst = JSON.stringify(ad);

  // Same-strip re-enter is idempotent — return true, no state change
  const ok2 = enterTweakMode(ad, 'tMid', 'sMid1');
  assert(ok2, '3b: same-strip re-enter returns true (idempotent)');
  eq(JSON.stringify(ad), afterFirst,
    '3b: same-strip re-enter byte-identical (no mutation — LOW-F8 strengthened)');

  // Different-strip enter returns FALSE (audit-fix HIGH-A2). Pre-fix:
  // Blender's `return true at nla.cc:2365-2367` was silent-success that
  // masked caller intent. SS surfaces it now since explicit IDs make
  // the discrepancy detectable.
  const ok3 = enterTweakMode(ad, 'tTop', 'sTop1');
  eq(ok3, false, '3c: different-strip enter while in tweak returns FALSE (HIGH-A2)');
  eq(JSON.stringify(ad), afterFirst,
    '3c: different-strip rejected — animData byte-identical to first-enter state');
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
  exitTweakMode(ad);   // no project passed — length-sync skipped (OK here)

  assert(!isTweakModeOn(ad), '7: ADT_NLA_EDIT_ON cleared');
  eq(ad.actionId, 'baseAct', '7: actionId restored from tmpActionId');
  // HIGH-A1: slotHandle restored to fixture's 7 (not the tweak strip's 5)
  eq(ad.slotHandle, 7, '7: slotHandle restored from tmpSlotHandle (=7, HIGH-A1)');
  eq(ad.tmpActionId, null, '7: tmpActionId cleared');
  eq(ad.tmpSlotHandle, 0,
    '7: tmpSlotHandle cleared to 0 (sentinel 99 in fixture overwritten by save+clear)');
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
// (audit-fix HIGH-A1 strengthened: fixture now uses tmpSlotHandle=99
// sentinel that exit clears to 0, so the byte-identical claim is
// relaxed to "all fields restored EXCEPT documented tmpSlotHandle
// normalization". Normalize the snapshot to compare.)
{
  const ad = makeFixture();
  // Snapshot but normalize the tmpSlotHandle field (which exit
  // clears to 0 regardless of the pre-enter sentinel value).
  const snapshot = JSON.parse(JSON.stringify(ad));
  snapshot.tmpSlotHandle = 0;
  const beforeNormalized = JSON.stringify(snapshot);

  enterTweakMode(ad, 'tMid', 'sMid1');
  exitTweakMode(ad);

  eq(JSON.stringify(ad), beforeNormalized,
    '10: enter→exit shape-preserving (modulo tmpSlotHandle clear-to-0)');
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

// ── 13. Empty-tracks animData: clear/exit/enter all safe (MED-A4) ─
{
  // Simulates a crash-recovery load where ADT_NLA_EDIT_ON is set on
  // an animData that has no tracks (e.g. tracks were lost in a
  // partial-write). All three helpers must be safe.
  const ad = {
    actionId: 'baseAct', slotHandle: 0,
    nlaTracks: [],
    flag: ADT_FLAG.NLA_EDIT_ON,   // tweak-flag set but no tracks
    tmpActionId: 'restored', tmpSlotHandle: 3,
    tweakTrackId: 't_gone', tweakStripId: 's_gone',
  };

  // clearTweakFlags: no throw, clears NLA_EDIT_ON, leaves action +
  // backup pointers intact (its contract).
  clearTweakFlags(ad);
  eq(ad.flag & ADT_FLAG.NLA_EDIT_ON, 0,
    '13a: clearTweakFlags on empty-tracks clears NLA_EDIT_ON');
  eq(ad.tmpActionId, 'restored',
    '13a: clearTweakFlags preserves backup pointers (clearFlags-only contract)');

  // Reset back to tweak-mode-on for the next assertion
  ad.flag |= ADT_FLAG.NLA_EDIT_ON;

  // exitTweakMode: full restore + clear; no throw despite empty tracks
  exitTweakMode(ad);
  eq(ad.flag & ADT_FLAG.NLA_EDIT_ON, 0, '13b: exitTweakMode on empty-tracks clears flag');
  eq(ad.actionId, 'restored', '13b: exitTweakMode restores actionId from tmpActionId');
  eq(ad.slotHandle, 3, '13b: exitTweakMode restores slotHandle from tmpSlotHandle');
  eq(ad.tweakTrackId, null, '13b: tweakTrackId cleared');
  eq(ad.tweakStripId, null, '13b: tweakStripId cleared');

  // enterTweakMode: requires actual tracks → false
  eq(enterTweakMode(ad, 't_gone', 's_gone'), false,
    '13c: enterTweakMode on empty-tracks → false (track not found)');
}

// ── 14. SYNC_LENGTH bound sync at exit (audit-fix HIGH-F5) ─────────
{
  // Setup: a strip with SYNC_LENGTH flag bound to an action. During
  // tweak, the action's frameEnd changes (user added keyframes past
  // the original end). On exit, the strip's `end` should re-derive:
  //   strip.end = strip.start + actlength * scale * repeat
  // where actlength = action.frameEnd - action.frameStart.
  const project = {
    actions: [
      { id: 'tweakAct', frameStart: 0, frameEnd: 1500,   // was 1000, edited to 1500
        fcurves: [] },
      { id: 'baseAct', frameStart: 0, frameEnd: 1000, fcurves: [] },
    ],
  };
  const ad = {
    actionId: 'tweakAct', slotHandle: 0,   // currently in tweak; tweakAct is the swapped-in action
    nlaTracks: [
      {
        id: 't1', name: 'T', flag: NLATRACK_FLAG.DISABLED, index: 0,
        strips: [
          // Tweak strip itself, SYNC_LENGTH flagged
          {
            id: 'sTweak', name: 'sTweak', actionId: 'tweakAct',
            slotHandle: 0, start: 0, end: 1000, actstart: 0, actend: 1000,
            repeat: 1, scale: 1, blendmode: 'replace', extendmode: 'hold',
            influence: 1, blendin: 0, blendout: 0, fcurves: [],
            flag: NLASTRIP_FLAG.SYNC_LENGTH,
          },
          // Strip sharing the same action, SYNC_LENGTH flagged
          {
            id: 'sShared', name: 'sShared', actionId: 'tweakAct',
            slotHandle: 0, start: 2000, end: 3000, actstart: 0, actend: 1000,
            repeat: 2, scale: 1, blendmode: 'replace', extendmode: 'hold',
            influence: 1, blendin: 0, blendout: 0, fcurves: [],
            flag: NLASTRIP_FLAG.SYNC_LENGTH,
          },
          // Strip sharing the same action, NOT SYNC_LENGTH → unchanged
          {
            id: 'sNoSync', name: 'sNoSync', actionId: 'tweakAct',
            slotHandle: 0, start: 5000, end: 6000, actstart: 0, actend: 1000,
            repeat: 1, scale: 1, blendmode: 'replace', extendmode: 'hold',
            influence: 1, blendin: 0, blendout: 0, fcurves: [],
            flag: 0,
          },
          // Strip referencing a different action, SYNC_LENGTH flagged → unchanged
          {
            id: 'sOther', name: 'sOther', actionId: 'baseAct',
            slotHandle: 0, start: 7000, end: 8000, actstart: 0, actend: 1000,
            repeat: 1, scale: 1, blendmode: 'replace', extendmode: 'hold',
            influence: 1, blendin: 0, blendout: 0, fcurves: [],
            flag: NLASTRIP_FLAG.SYNC_LENGTH,
          },
        ],
      },
    ],
    flag: ADT_FLAG.NLA_EDIT_ON,
    tmpActionId: 'baseAct', tmpSlotHandle: 0,
    tweakTrackId: 't1', tweakStripId: 'sTweak',
  };

  exitTweakMode(ad, project);

  // sTweak: actlength = 1500, scale=1, repeat=1 → end = 0 + 1500*1*1 = 1500
  const sTweak = ad.nlaTracks[0].strips[0];
  close(sTweak.end, 1500, 1e-9,
    '14: sTweak (SYNC_LENGTH on tweaked action): end re-derived 1000 → 1500');

  // sShared: actlength=1500, scale=1, repeat=2 → end = 2000 + 1500*1*2 = 5000
  const sShared = ad.nlaTracks[0].strips[1];
  close(sShared.end, 5000, 1e-9,
    '14: sShared (SYNC_LENGTH, same action, repeat=2): end 3000 → 5000');

  // sNoSync: no SYNC_LENGTH bit → end unchanged
  const sNoSync = ad.nlaTracks[0].strips[2];
  close(sNoSync.end, 6000, 1e-9,
    '14: sNoSync (no SYNC_LENGTH): end unchanged');

  // sOther: SYNC_LENGTH but action is baseAct, not tweakAct → unchanged
  const sOther = ad.nlaTracks[0].strips[3];
  close(sOther.end, 8000, 1e-9,
    '14: sOther (SYNC_LENGTH but different action): end unchanged');
}

// ── 15. SYNC_LENGTH skipped when project not passed (defensive) ────
{
  // Legacy callers that don't pass project should not crash; they just
  // get the pre-audit behavior (no sync). Documented as production
  // callers MUST pass project.
  const ad = makeFixture();
  enterTweakMode(ad, 'tMid', 'sMid1');
  // Mark a strip SYNC_LENGTH
  const sMid1 = ad.nlaTracks.find((t) => t.id === 'tMid').strips[0];
  sMid1.flag |= NLASTRIP_FLAG.SYNC_LENGTH;
  const endBefore = sMid1.end;
  exitTweakMode(ad);   // no project
  eq(sMid1.end, endBefore,
    '15: project omitted → SYNC_LENGTH sync silently skipped (defensive legacy-caller path)');
}

// ── 16. Consumer-chain composition: evaluateNla underlay + active
// action layer = tweak strip's contribution on top (audit-fix LOW-F7) ─
{
  // Verifies the Slice 4.B/4.C split:
  //   1. evaluateNla returns only the underlay (skips tweak strip +
  //      DISABLED tracks)
  //   2. consumer chain reads animData.actionId (= tweak strip's
  //      action post-enter) and evaluates IT as the topmost implicit
  //      layer
  //   3. The combined output equals "what you'd see in the viewport
  //      during tweak mode"
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

  // Step A: evaluator produces underlay (only tBot/idleAct = 10)
  const underlay = evaluateNla(ad, 500, project);
  close(/** @type number */ (underlay.get('paramX')), 10, 1e-9,
    '16a: evaluateNla produces underlay only (paramX=10, walkAct skipped via tweak)');

  // Step B: consumer-chain evaluates animData.actionId as the topmost
  // implicit layer. After enter, animData.actionId === 'walkAct'.
  // Composition (REPLACE blend, influence=1):
  //   combined = lerp(underlay, activeActionResult, 1) = activeActionResult
  // walkAct paramX = 100. Combined = 100.
  eq(ad.actionId, 'walkAct',
    '16b: post-enter, animData.actionId === tweak strip\'s action');

  // Pseudo-consumer-chain composition. The actual composition lives
  // in Slice 4.G or whatever wires evaluateNla into the live viewport.
  // Here we just simulate the contract: blend(underlay, evalAction).
  function evaluateActiveActionAt(actionId, timeMs) {
    const action = project.actions.find((a) => a.id === actionId);
    if (!action) return new Map();
    const out = new Map();
    for (const fc of action.fcurves) {
      // Single-keyform-pair lerp; matches the linear ramp fixture.
      const kfs = fc.keyforms;
      let v = kfs[kfs.length - 1].value;
      for (let i = 0; i < kfs.length - 1; i++) {
        const a = kfs[i], b = kfs[i + 1];
        if (timeMs >= a.time && timeMs <= b.time) {
          const t = (timeMs - a.time) / (b.time - a.time);
          v = a.value * (1 - t) + b.value * t;
          break;
        }
      }
      out.set(fc.rnaPath, v);
    }
    return out;
  }
  const topLayer = evaluateActiveActionAt(ad.actionId, 500);
  // REPLACE composition with influence=1 → pure overwrite
  const combined = new Map(underlay);
  for (const [k, v] of topLayer) combined.set(k, v);
  close(/** @type number */ (combined.get('paramX')), 100, 1e-9,
    '16c: consumer chain combines underlay + tweak action layer → paramX=100');
}

// ── §17 enterTweakMode refuses PROTECTED tracks (audit-fix 4.D.3 HIGH-A1)
{
  // Build a standalone fixture (don't import standardFixture to keep
  // this self-contained against future fixture refactors).
  const ad = {
    actionId: 'baseAct', slotHandle: 0, flag: 0,
    tmpActionId: null, tmpSlotHandle: 0,
    tweakTrackId: null, tweakStripId: null,
    nlaTracks: [
      makeNlaTrack('tProt', 'Protected', {
        index: 0,
        flag: NLATRACK_FLAG.PROTECTED,
        strips: [makeNlaStrip('sP', 'walkAct', { start: 0, end: 500, actstart: 0, actend: 500 })],
      }),
      makeNlaTrack('tOpen', 'Open', {
        index: 1,
        strips: [makeNlaStrip('sO', 'walkAct', { start: 0, end: 500, actstart: 0, actend: 500 })],
      }),
    ],
  };
  // Enter on protected track → false
  const r1 = enterTweakMode(ad, 'tProt', 'sP');
  eq(r1, false, '17a: PROTECTED track refused');
  // animData state unchanged
  assert(!isTweakModeOn(ad), '17b: not in tweak mode after refusal');
  eq(ad.tweakTrackId, null, '17c: tweakTrackId still null');
  eq(ad.tweakStripId, null, '17d: tweakStripId still null');
  eq(ad.actionId, 'baseAct', '17e: actionId still baseAct (no swap)');
  // Strip flags untouched (no TWEAKUSER tagging)
  eq(ad.nlaTracks[0].strips[0].flag, 0, '17f: protected strip flag untouched');
  eq(ad.nlaTracks[1].strips[0].flag, 0, '17g: sibling strip flag untouched');
  // Non-protected track still works
  const r2 = enterTweakMode(ad, 'tOpen', 'sO');
  eq(r2, true, '17h: non-protected track succeeds');
  assert(isTweakModeOn(ad), '17i: now in tweak mode');
  eq(ad.tweakTrackId, 'tOpen', '17j: tweakTrackId set');
}

console.log(`\nnlaTweakMode: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
