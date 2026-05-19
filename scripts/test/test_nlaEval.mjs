// Tests for src/anim/nlaEval.js — Animation Phase 4 Slice 4.B NLA
// evaluator. Run: node scripts/test/test_nlaEval.mjs
//
// Coverage:
//   §1 — applyBlendMode kernels (all 4 modes, byte-faithful to Blender)
//   §2 — applyBlendMode early-out on influence=0
//   §3 — remapStripTime forward (no scale, no repeat)
//   §4 — remapStripTime with scale ≠ 1
//   §5 — remapStripTime with repeat > 1
//   §6 — remapStripTime reverse flag
//   §7 — remapStripTime end-of-strip pin (integer repeat)
//   §8 — computeStripInfluence baseline (no ramps)
//   §9 — computeStripInfluence blendin ramp
//   §10 — computeStripInfluence blendout ramp
//   §11 — computeStripInfluence USR_INFLUENCE override
//   §12 — stripActiveAt: in-range + extend-mode gating (hold/hold_forward/nothing)
//   §13 — evaluateNla: empty animData → empty map
//   §14 — evaluateNla: single strip replace
//   §15 — evaluateNla: two strips replace + add stacked
//   §16 — evaluateNla: muted strip skipped
//   §17 — evaluateNla: muted track skipped
//   §18 — evaluateNla: solo track wins
//   §19 — evaluateNla: disabled track skipped
//   §20 — evaluateNla: NLA_EVAL_OFF skips entirely
//   §21 — evaluateNla: tweak mode skips the tweaked strip
//   §22 — evaluateNla: blendin ramp at strip boundary
//   §23 — evaluateNla: stack order matters (bottom-up index)
//   §24 — evaluateNla: combine blendmode is never written by Phase 4 (defensive)

import {
  applyBlendMode,
  remapStripTime,
  computeStripInfluence,
  stripActiveAt,
  evaluateNla,
} from '../../src/anim/nlaEval.js';
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

// Fixture helper: a project with a linear-ramp action (1 fcurve named
// 'paramX' that goes 0→100 over 0→1000ms).
function makeLinearRampProject(actionId = 'a1', fcurveValue = 100) {
  return {
    actions: [
      {
        id: actionId,
        fcurves: [
          {
            id: 'fc1', rnaPath: 'paramX',
            keyforms: [
              { time: 0,    value: 0,           interpolation: 'linear' },
              { time: 1000, value: fcurveValue, interpolation: 'linear' },
            ],
          },
        ],
      },
    ],
  };
}

// ── 1. applyBlendMode kernels match Blender byte-faithfully ────────
{
  // Blender nla_blend_value (anim_sys.cc:1841-1873) reference math:
  //   replace  → lower * (1 - inf) + strip * inf
  //   add      → lower + strip * inf
  //   subtract → lower - strip * inf
  //   multiply → inf * (lower * strip) + (1 - inf) * lower

  // Replace: lerp(5, 10, 0.3) = 5*0.7 + 10*0.3 = 6.5
  close(applyBlendMode(5, 10, 'replace', 0.3), 6.5, 1e-9, '1: replace lerp(5,10,0.3)=6.5');
  // Add:  5 + 10*0.3 = 8
  close(applyBlendMode(5, 10, 'add', 0.3), 8, 1e-9, '1: add 5 + 10*0.3 = 8');
  // Subtract: 5 - 10*0.3 = 2
  close(applyBlendMode(5, 10, 'subtract', 0.3), 2, 1e-9, '1: subtract 5 - 10*0.3 = 2');
  // Multiply: 0.3*(5*10) + 0.7*5 = 15 + 3.5 = 18.5
  close(applyBlendMode(5, 10, 'multiply', 0.3), 18.5, 1e-9, '1: multiply 0.3*(5*10) + 0.7*5 = 18.5');

  // Replace inf=1 returns pure strip
  close(applyBlendMode(5, 10, 'replace', 1), 10, 1e-9, '1: replace inf=1 → pure strip');
  // Replace inf=0 returns pure lower (early-out)
  close(applyBlendMode(5, 10, 'replace', 0), 5, 1e-9, '1: replace inf=0 → pure lower');

  // Unknown blendmode defaults to replace (Blender's default branch)
  close(applyBlendMode(5, 10, /** @type any */ ('unknown'), 0.5), 7.5, 1e-9,
    '1: unknown blendmode falls back to replace lerp(5,10,0.5)=7.5');
}

// ── 2. applyBlendMode early-out on influence near zero ─────────────
{
  // Blender anim_sys.cc:1847: IS_EQF(influence, 0.0f) → return lower
  // For all 4 modes, influence ≈ 0 short-circuits to lower.
  for (const mode of ['replace', 'add', 'subtract', 'multiply']) {
    close(applyBlendMode(42, 999, mode, 0), 42, 1e-9, `2: ${mode} inf=0 → lower=42`);
    close(applyBlendMode(42, 999, mode, 1e-15), 42, 1e-9, `2: ${mode} inf~0 → lower=42`);
  }
}

// ── 3. remapStripTime forward, no scale, no repeat ─────────────────
{
  // Strip on track at [100, 1100], maps to action [0, 1000].
  // At time = 100 → actstart (0). At time = 1100 → actend (1000).
  // At time = 500 → actstart + (500 - 100) / 1 = 400.
  const strip = makeNlaStrip('s1', 'a1', {
    start: 100, end: 1100, actstart: 0, actend: 1000,
  });
  close(remapStripTime(strip, 100), 0, 1e-9, '3: t=start → actstart');
  close(remapStripTime(strip, 1100), 1000, 1e-9, '3: t=end (integer repeat=1) → actend (end-pin)');
  close(remapStripTime(strip, 500), 400, 1e-9, '3: t=mid → linear interp');
  close(remapStripTime(strip, 600), 500, 1e-9, '3: t=600 → action 500');
}

// ── 4. remapStripTime with scale ≠ 1 ───────────────────────────────
{
  // Strip on track at [0, 2000], scale=2.0 → action plays 2× SLOWER
  // (well, scale slows time mapping: actlength=1000, scaled to 2000ms).
  // Blender formula: actstart + fmod(t - start, actlength * scale) / scale
  //                = 0 + fmod(t, 2000) / 2
  // At t=500 → 500/2 = 250.   At t=1000 → 1000/2 = 500.
  const strip = makeNlaStrip('s2', 'a1', {
    start: 0, end: 2000, actstart: 0, actend: 1000, scale: 2,
  });
  close(remapStripTime(strip, 500), 250, 1e-9, '4: scale=2, t=500 → action 250');
  close(remapStripTime(strip, 1000), 500, 1e-9, '4: scale=2, t=1000 → action 500');
}

// ── 5. remapStripTime with repeat > 1 ──────────────────────────────
{
  // Strip [0, 2000], action [0, 1000], repeat=2 → action loops twice.
  // At t=500 → action 500 (first repeat). At t=1500 → fmod(1500, 1000)/1 = 500 (second).
  const strip = makeNlaStrip('s3', 'a1', {
    start: 0, end: 2000, actstart: 0, actend: 1000, repeat: 2,
  });
  close(remapStripTime(strip, 500), 500, 1e-9, '5: repeat=2, t=500 → action 500');
  close(remapStripTime(strip, 1500), 500, 1e-9, '5: repeat=2, t=1500 → action 500 (2nd loop)');
  // End-pin at t=end with integer repeat → actend not 0
  close(remapStripTime(strip, 2000), 1000, 1e-9, '5: repeat=2, t=end → actend (integer-repeat pin)');
}

// ── 6. remapStripTime reverse flag ─────────────────────────────────
{
  // REVERSE: plays end → start. Blender nla.cc:749:
  //   actend - fmod(t - start, actlength * scale) / scale
  // Strip [0, 1000], action [0, 1000], reverse=true.
  // At t=0   → actend (1000).    At t=500 → 1000 - 500 = 500.
  // At t=1000 (integer repeat pin) → actstart (0).
  const strip = makeNlaStrip('s4', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    flag: NLASTRIP_FLAG.REVERSE,
  });
  close(remapStripTime(strip, 0), 1000, 1e-9, '6: reverse, t=start → actend');
  close(remapStripTime(strip, 500), 500, 1e-9, '6: reverse, t=mid → mid');
  close(remapStripTime(strip, 1000), 0, 1e-9, '6: reverse, t=end (integer repeat) → actstart');
}

// ── 7. remapStripTime end-of-strip pin only for INTEGER repeat ─────
{
  // repeat=1.5 (non-integer) → end-of-strip uses generic fmod path,
  // NOT the actend pin. At t=end=1500, action time = fmod(1500, 1000) = 500.
  const strip = makeNlaStrip('s5', 'a1', {
    start: 0, end: 1500, actstart: 0, actend: 1000, repeat: 1.5,
  });
  close(remapStripTime(strip, 1500), 500, 1e-9, '7: non-integer repeat: t=end → fmod path (500, not actend=1000)');
}

// ── 8. computeStripInfluence baseline (no ramps) ───────────────────
{
  const strip = makeNlaStrip('s6', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    influence: 0.75,
  });
  close(computeStripInfluence(strip, 500), 0.75, 1e-9, '8: mid-strip, no ramps → baseline');
  close(computeStripInfluence(strip, 0), 0.75, 1e-9, '8: t=start, no blendin → baseline');
  close(computeStripInfluence(strip, 1000), 0.75, 1e-9, '8: t=end, no blendout → baseline');
}

// ── 9. computeStripInfluence blendin ramp ──────────────────────────
{
  // blendin=200: from t=0 (start) to t=200, influence ramps 0 → baseline.
  // Formula: baseline * (t - start) / blendin
  const strip = makeNlaStrip('s7', 'a1', {
    start: 100, end: 1100, actstart: 0, actend: 1000,
    influence: 0.8, blendin: 200,
  });
  close(computeStripInfluence(strip, 100), 0, 1e-9, '9: t=start → 0 (ramp begin)');
  close(computeStripInfluence(strip, 200), 0.8 * (100 / 200), 1e-9, '9: mid-blendin → ramped');
  close(computeStripInfluence(strip, 300), 0.8, 1e-9, '9: blendin-end → full baseline');
  close(computeStripInfluence(strip, 500), 0.8, 1e-9, '9: past blendin, mid-strip → baseline');
}

// ── 10. computeStripInfluence blendout ramp ────────────────────────
{
  // blendout=300: from t=end-300 to t=end, influence ramps baseline → 0.
  // Formula: baseline * (end - t) / blendout
  const strip = makeNlaStrip('s8', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    influence: 1.0, blendout: 300,
  });
  close(computeStripInfluence(strip, 700), 1.0, 1e-9, '10: blendout-start (t=end-blendout) → baseline');
  close(computeStripInfluence(strip, 850), 1.0 * (150 / 300), 1e-9, '10: mid-blendout → ramped');
  close(computeStripInfluence(strip, 1000), 0, 1e-9, '10: t=end → 0');
}

// ── 11. computeStripInfluence USR_INFLUENCE override ──────────────
{
  // USR_INFLUENCE flag set + per-strip fcurve with rnaPath='influence':
  // ignore baseline + blendin/out; evaluate the fcurve.
  const strip = makeNlaStrip('s9', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    influence: 0.999,   // would-be baseline; should be ignored
    blendin: 999, blendout: 999,   // would distort if not ignored
    flag: NLASTRIP_FLAG.USR_INFLUENCE,
    fcurves: [
      {
        id: 'fc_inf', rnaPath: 'influence',
        keyforms: [
          { time: 0,    value: 0.1, interpolation: 'linear' },
          { time: 1000, value: 0.9, interpolation: 'linear' },
        ],
      },
    ],
  });
  close(computeStripInfluence(strip, 0), 0.1, 1e-9, '11: USR_INFLUENCE: t=0 → fcurve 0.1');
  close(computeStripInfluence(strip, 500), 0.5, 1e-9, '11: USR_INFLUENCE: mid → fcurve 0.5');
  close(computeStripInfluence(strip, 1000), 0.9, 1e-9, '11: USR_INFLUENCE: t=end → fcurve 0.9');

  // Clamp [0, 1] enforced even if fcurve emits out-of-range
  const overshootStrip = makeNlaStrip('s9b', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000,
    flag: NLASTRIP_FLAG.USR_INFLUENCE,
    fcurves: [{
      id: 'fc_inf', rnaPath: 'influence',
      keyforms: [
        { time: 0, value: -0.5, interpolation: 'linear' },
        { time: 1000, value: 1.5, interpolation: 'linear' },
      ],
    }],
  });
  close(computeStripInfluence(overshootStrip, 0), 0, 1e-9, '11: USR_INFLUENCE clamps lower to 0');
  close(computeStripInfluence(overshootStrip, 1000), 1, 1e-9, '11: USR_INFLUENCE clamps upper to 1');
}

// ── 12. stripActiveAt — extend-mode gating ─────────────────────────
{
  const stripHold = makeNlaStrip('s10a', 'a1', {
    start: 100, end: 200, actstart: 0, actend: 100, extendmode: 'hold',
  });
  assert(stripActiveAt(stripHold, 150), '12: hold mode: in-range active');
  assert(stripActiveAt(stripHold, 100), '12: hold mode: at start active');
  assert(stripActiveAt(stripHold, 200), '12: hold mode: at end active');
  assert(stripActiveAt(stripHold, 50),  '12: hold mode: before start active (backward hold)');
  assert(stripActiveAt(stripHold, 500), '12: hold mode: after end active (forward hold)');

  const stripHoldForward = makeNlaStrip('s10b', 'a1', {
    start: 100, end: 200, actstart: 0, actend: 100, extendmode: 'hold_forward',
  });
  assert(stripActiveAt(stripHoldForward, 150), '12: hold_forward in-range active');
  assert(!stripActiveAt(stripHoldForward, 50), '12: hold_forward: before start NOT active');
  assert(stripActiveAt(stripHoldForward, 500), '12: hold_forward: after end active');

  const stripNothing = makeNlaStrip('s10c', 'a1', {
    start: 100, end: 200, actstart: 0, actend: 100, extendmode: 'nothing',
  });
  assert(stripActiveAt(stripNothing, 150), '12: nothing in-range active');
  assert(!stripActiveAt(stripNothing, 50), '12: nothing: before start NOT active');
  assert(!stripActiveAt(stripNothing, 500), '12: nothing: after end NOT active');

  // Zero-length strip is always a no-op
  const stripZero = makeNlaStrip('s10d', 'a1', {
    start: 100, end: 100, actstart: 0, actend: 0, extendmode: 'hold',
  });
  assert(!stripActiveAt(stripZero, 100), '12: zero-length strip never active');
}

// ── 13. evaluateNla: empty animData → empty Map ────────────────────
{
  const acc = evaluateNla(null, 500, { actions: [] });
  eq(acc.size, 0, '13: null animData → empty map');
  const acc2 = evaluateNla({}, 500, { actions: [] });
  eq(acc2.size, 0, '13: empty animData → empty map');
  const acc3 = evaluateNla({ nlaTracks: [] }, 500, { actions: [] });
  eq(acc3.size, 0, '13: empty nlaTracks → empty map');
}

// ── 14. evaluateNla: single strip replace ──────────────────────────
{
  const project = makeLinearRampProject('a1', 100);   // paramX 0→100 over 0→1000ms
  const strip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const animData = {
    flag: 0,
    nlaTracks: [makeNlaTrack('t1', 'Body', { index: 0, strips: [strip] })],
  };
  const acc = evaluateNla(animData, 500, project);
  eq(acc.size, 1, '14: single strip → 1 channel in map');
  close(/** @type number */ (acc.get('paramX')), 50, 1e-9,
    '14: t=500 → paramX 50 (lerp(0, 50, 1)=50 since no lower)');
}

// ── 15. evaluateNla: two strips replace + add stacked ─────────────
{
  // Bottom track REPLACE, sets paramX. Top track ADD, adds more.
  const project = makeLinearRampProject('a1', 100);   // paramX 0→100
  const projectWithB = {
    actions: [
      ...project.actions,
      {
        id: 'a2',
        fcurves: [{
          id: 'fc2', rnaPath: 'paramX',
          keyforms: [
            { time: 0, value: 10, interpolation: 'linear' },
            { time: 1000, value: 10, interpolation: 'linear' },
          ],
        }],
      },
    ],
  };
  const bottomStrip = makeNlaStrip('sb', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
    blendmode: 'replace',
  });
  const topStrip = makeNlaStrip('st', 'a2', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
    blendmode: 'add',
  });
  const animData = {
    flag: 0,
    nlaTracks: [
      makeNlaTrack('t_bot', 'Body', { index: 0, strips: [bottomStrip] }),
      makeNlaTrack('t_top', 'Face', { index: 1, strips: [topStrip] }),
    ],
  };
  // At t=500: bottom REPLACE → 50; top ADD → 50 + 10*1 = 60.
  const acc = evaluateNla(animData, 500, projectWithB);
  close(/** @type number */ (acc.get('paramX')), 60, 1e-9,
    '15: replace(50) + add(10) = 60');
}

// ── 16. evaluateNla: muted strip skipped ───────────────────────────
{
  const project = makeLinearRampProject('a1', 100);
  const strip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
    flag: NLASTRIP_FLAG.MUTED,
  });
  const animData = {
    flag: 0,
    nlaTracks: [makeNlaTrack('t1', 'Body', { index: 0, strips: [strip] })],
  };
  const acc = evaluateNla(animData, 500, project);
  eq(acc.size, 0, '16: muted strip contributes nothing');
}

// ── 17. evaluateNla: muted track skipped ───────────────────────────
{
  const project = makeLinearRampProject('a1', 100);
  const strip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const track = makeNlaTrack('t1', 'Body', {
    index: 0, strips: [strip], flag: NLATRACK_FLAG.MUTED,
  });
  const animData = { flag: 0, nlaTracks: [track] };
  const acc = evaluateNla(animData, 500, project);
  eq(acc.size, 0, '17: muted track contributes nothing');
}

// ── 18. evaluateNla: solo track wins ───────────────────────────────
{
  // Two tracks; only the SOLO one evaluates.
  const project = makeLinearRampProject('a1', 100);
  const projectWithB = {
    actions: [
      ...project.actions,
      {
        id: 'a2',
        fcurves: [{
          id: 'fc2', rnaPath: 'paramY',
          keyforms: [
            { time: 0, value: 999, interpolation: 'linear' },
            { time: 1000, value: 999, interpolation: 'linear' },
          ],
        }],
      },
    ],
  };
  const soloStrip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const otherStrip = makeNlaStrip('s2', 'a2', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const soloTrack = makeNlaTrack('t1', 'Body', {
    index: 0, strips: [soloStrip], flag: NLATRACK_FLAG.SOLO,
  });
  const otherTrack = makeNlaTrack('t2', 'Face', {
    index: 1, strips: [otherStrip],
  });
  const animData = {
    flag: ADT_FLAG.NLA_SOLO_TRACK,   // ADT solo-flag must also be set
    nlaTracks: [soloTrack, otherTrack],
  };
  const acc = evaluateNla(animData, 500, projectWithB);
  eq(acc.size, 1, '18: solo skips non-solo track → only paramX present');
  assert(acc.has('paramX'), '18: paramX present (from solo)');
  assert(!acc.has('paramY'), '18: paramY absent (non-solo skipped)');
}

// ── 19. evaluateNla: NLATRACK_DISABLED skipped (tweak-mode disable) ─
{
  const project = makeLinearRampProject('a1', 100);
  const strip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const track = makeNlaTrack('t1', 'Body', {
    index: 0, strips: [strip], flag: NLATRACK_FLAG.DISABLED,
  });
  const animData = { flag: 0, nlaTracks: [track] };
  const acc = evaluateNla(animData, 500, project);
  eq(acc.size, 0, '19: NLATRACK_DISABLED skips entirely');
}

// ── 20. evaluateNla: NLA_EVAL_OFF skips entirely ───────────────────
{
  const project = makeLinearRampProject('a1', 100);
  const strip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const animData = {
    flag: ADT_FLAG.NLA_EVAL_OFF,
    nlaTracks: [makeNlaTrack('t1', 'Body', { index: 0, strips: [strip] })],
  };
  const acc = evaluateNla(animData, 500, project);
  eq(acc.size, 0, '20: NLA_EVAL_OFF flag bypasses entire walker');
}

// ── 21. evaluateNla: tweak mode skips the tweaked strip ────────────
{
  const project = makeLinearRampProject('a1', 100);
  const tweakedStrip = makeNlaStrip('s_tweak', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const otherStrip = makeNlaStrip('s_other', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
  });
  const animData = {
    flag: ADT_FLAG.NLA_EDIT_ON,
    tweakStripId: 's_tweak',
    tweakTrackId: 't1',
    nlaTracks: [
      makeNlaTrack('t1', 'Body', { index: 0, strips: [tweakedStrip, otherStrip] }),
    ],
  };
  const acc = evaluateNla(animData, 500, project);
  // Both strips would write paramX (replace), but tweak skips s_tweak;
  // only otherStrip writes → paramX = 50 (not 50+50).
  close(/** @type number */ (acc.get('paramX')), 50, 1e-9,
    '21: tweak-mode skips the tweak strip; only the other strip evaluates');
}

// ── 22. evaluateNla: blendin ramp at strip boundary ───────────────
{
  const project = makeLinearRampProject('a1', 100);
  const strip = makeNlaStrip('s1', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1.0,
    blendin: 200,
  });
  const animData = {
    flag: 0,
    nlaTracks: [makeNlaTrack('t1', 'Body', { index: 0, strips: [strip] })],
  };
  // At t=100: ramp = (100-0)/200 = 0.5; fcurve(100)=10; replace lerp(0, 10, 0.5)=5.
  const acc = evaluateNla(animData, 100, project);
  close(/** @type number */ (acc.get('paramX')), 5, 1e-9,
    '22: t=100 in blendin: ramp 0.5, fcurve 10, replace → 5');
}

// ── 23. evaluateNla: bottom-up index ordering ──────────────────────
{
  // Track A index=0 (bottom), Track B index=1 (top).
  // A writes paramX=100 (replace inf=1). B adds 10. Result: 110.
  // If ordering reversed, B(replace from 0)+A(replace from B)=100, no add.
  const projectAB = {
    actions: [
      {
        id: 'a1',
        fcurves: [{
          id: 'fc1', rnaPath: 'paramX',
          keyforms: [
            { time: 0, value: 100, interpolation: 'linear' },
            { time: 1000, value: 100, interpolation: 'linear' },
          ],
        }],
      },
      {
        id: 'a2',
        fcurves: [{
          id: 'fc2', rnaPath: 'paramX',
          keyforms: [
            { time: 0, value: 10, interpolation: 'linear' },
            { time: 1000, value: 10, interpolation: 'linear' },
          ],
        }],
      },
    ],
  };
  // Tracks passed in REVERSED order in the array, but indices say
  // A=0/B=1 → walker must order by index, not array position.
  const trackB = makeNlaTrack('tB', 'B', {
    index: 1,
    strips: [makeNlaStrip('sB', 'a2', {
      start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
      blendmode: 'add',
    })],
  });
  const trackA = makeNlaTrack('tA', 'A', {
    index: 0,
    strips: [makeNlaStrip('sA', 'a1', {
      start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
      blendmode: 'replace',
    })],
  });
  const animData = { flag: 0, nlaTracks: [trackB, trackA] };
  const acc = evaluateNla(animData, 500, projectAB);
  close(/** @type number */ (acc.get('paramX')), 110, 1e-9,
    '23: index ordering: A(idx=0,replace 100) → B(idx=1,add 10) → 110');
}

// ── 24. evaluateNla rejects unknown blendmode (audit-fix MED-A4) ───
{
  // Rule №1: the evaluator's job is to FAIL LOUD when given malformed
  // input, not silently degrade. The kernel (applyBlendMode) keeps its
  // hot-path fallback for Blender parity (Blender's `nla_blend_value`
  // at anim_sys.cc:1866-1872 has the same default-LERP behavior), but
  // evaluateNla validates `strip.blendmode` against NLA_BLEND_MODES
  // at the boundary and throws.
  const project = makeLinearRampProject('a1', 100);
  // Construct a raw strip bypassing the makeNlaStrip validation:
  const badStrip = {
    id: 's_bad', name: 's_bad', actionId: 'a1',
    slotHandle: 0, start: 0, end: 1000, actstart: 0, actend: 1000,
    repeat: 1, scale: 1, blendmode: 'combine', extendmode: 'hold',
    influence: 1, blendin: 0, blendout: 0, fcurves: [], flag: 0,
  };
  const animData = {
    flag: 0,
    nlaTracks: [{ id: 't1', name: 'T', strips: [badStrip], flag: 0, index: 0 }],
  };
  let threw = false;
  try { evaluateNla(animData, 500, project); }
  catch (e) {
    threw = String(e.message).includes('invalid blendmode')
      && String(e.message).includes('combine')
      && String(e.message).includes('s_bad');
  }
  assert(threw, '24a: evaluateNla throws on combine blendmode with strip id + bad mode in message');

  // applyBlendMode kernel still tolerates unknown for Blender parity
  // (it's the validation gate in evaluateNla that's the Rule №1
  // boundary; the kernel mirrors Blender's nla_blend_value default).
  close(applyBlendMode(5, 10, 'combine', 0.5), 7.5, 1e-9,
    '24b: applyBlendMode kernel tolerant for Blender-parity (default → LERP per anim_sys.cc:1866)');
}

// ── 25. tweakStripId='' (empty string) does NOT silently bypass skip
// (audit-fix HIGH-A2) ──────────────────────────────────────────────
{
  // Pre-fix: `if (tweakStripId && strip.id === tweakStripId)` would
  // FAIL the falsy check for tweakStripId='', leaving the strip
  // unskipped — silent regression of tweak-mode semantics on raw
  // deserialized animData. Post-fix: strict string-non-empty check.
  // Here we use a hand-built animData with empty-string tweakStripId
  // (which makeNlaStrip would never produce, but raw JSON might).
  const project = makeLinearRampProject('a1', 100);
  const strip = {
    id: '', name: '', actionId: 'a1',
    slotHandle: 0, start: 0, end: 1000, actstart: 0, actend: 1000,
    repeat: 1, scale: 1, blendmode: 'replace', extendmode: 'hold',
    influence: 1, blendin: 0, blendout: 0, fcurves: [], flag: 0,
  };
  const animData = {
    flag: ADT_FLAG.NLA_EDIT_ON,
    tweakStripId: '',   // raw-deserialized corruption
    tweakTrackId: 't1',
    nlaTracks: [{ id: 't1', name: 'T', strips: [strip], flag: 0, index: 0 }],
  };
  // Eval should NOT silently bypass — the strip evaluates normally
  // (since tweakStripId is treated as "no tweak strip" when empty).
  const acc = evaluateNla(animData, 500, project);
  // Strip with id='' has its action evaluated like any other strip.
  close(/** @type number */ (acc.get('paramX')), 50, 1e-9,
    '25: empty-string tweakStripId treated as "no tweak strip" — strip still evaluates');
}

// ── 26. Overlapping blendin+blendout pick blendin first (audit-fix
// HIGH-A3 lock-in: SS matches Blender's two-if-with-early-return) ──
{
  // Strip [0, 100], blendin=80, blendout=80 (overlap fully). At t=50:
  //   blendin condition: 50 <= 0+80 = true → return 50/80 * baseline = 0.625
  //   (blendout condition would yield (100-50)/80 = 0.625 — same in
  //   this symmetric case, but asymmetric cases below distinguish)
  // Blender (anim_sys.cc:1009-1027) uses the same two-if-with-return
  // structure — blendin wins via early return. Lock this behavior.
  const stripSym = makeNlaStrip('sym', 'a1', {
    start: 0, end: 100, actstart: 0, actend: 100,
    influence: 1.0, blendin: 80, blendout: 80,
  });
  close(computeStripInfluence(stripSym, 50), 0.625, 1e-9,
    '26: symmetric overlap, t=50: blendin wins (returns 50/80=0.625)');

  // Asymmetric: blendin=20, blendout=80, t=30. blendin condition
  // 30 <= 0+20 = false → falls through. blendout: 30 >= 100-80=20
  // → true → return (100-30)/80 = 0.875. This is the correct
  // Blender behavior — once past blendin, blendout dominates.
  const stripAsym = makeNlaStrip('asym', 'a1', {
    start: 0, end: 100, actstart: 0, actend: 100,
    influence: 1.0, blendin: 20, blendout: 80,
  });
  close(computeStripInfluence(stripAsym, 30), 0.875, 1e-9,
    '26: asymmetric overlap, t=30 past blendin: blendout dominates (0.875)');

  // Inside blendin AND inside blendout: blendin (early return) wins.
  // blendin=60, blendout=60, t=20. blendin: 20 <= 60 → return 20/60 ≈ 0.333.
  const stripInside = makeNlaStrip('inside', 'a1', {
    start: 0, end: 100, actstart: 0, actend: 100,
    influence: 1.0, blendin: 60, blendout: 60,
  });
  close(computeStripInfluence(stripInside, 20), 20 / 60, 1e-9,
    '26: inside both ramps, t=20: blendin returns 20/60 first');
}

// ── 27. USR_TIME flag drives strip_time directly (audit-fix MED-F4) ─
{
  // USR_TIME flag: per-strip FCurve with rnaPath='strip_time' becomes
  // the action-local time, bypassing scale/repeat/reverse. Blender
  // anim_sys.cc:1059.
  const project = makeLinearRampProject('a1', 100);
  // FCurve says: at t=0 → action_time=200, at t=1000 → action_time=800
  // (linear ramp from 20% through to 80% of the action).
  const strip = makeNlaStrip('s_usrtime', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1.0,
    flag: NLASTRIP_FLAG.USR_TIME,
    fcurves: [{
      id: 'fc_time', rnaPath: 'strip_time',
      keyforms: [
        { time: 0,    value: 200, interpolation: 'linear' },
        { time: 1000, value: 800, interpolation: 'linear' },
      ],
    }],
  });
  // remapStripTime at t=500: fcurve(500) = 500 (lerp 200..800 at 50%).
  close(remapStripTime(strip, 500), 500, 1e-9,
    '27: USR_TIME: strip_time fcurve drives action-local time');
  // At t=0, action_time = 200.
  close(remapStripTime(strip, 0), 200, 1e-9, '27: USR_TIME: t=0 → action_time=200');
  // At t=1000, action_time = 800.
  close(remapStripTime(strip, 1000), 800, 1e-9, '27: USR_TIME: t=1000 → action_time=800');

  // USR_TIME_CYCLIC wraps the user-time into [actstart, actend) so
  // a value past actend wraps back to actstart-relative position.
  const stripCyclic = makeNlaStrip('s_cyclic', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 500, influence: 1.0,
    flag: NLASTRIP_FLAG.USR_TIME | NLASTRIP_FLAG.USR_TIME_CYCLIC,
    fcurves: [{
      id: 'fc_time', rnaPath: 'strip_time',
      keyforms: [
        { time: 0,    value: 0,    interpolation: 'linear' },
        { time: 1000, value: 1500, interpolation: 'linear' },  // exceeds actend
      ],
    }],
  });
  // At t=500, fcurve(500) = 750. Wrap into [0, 500): 750 % 500 = 250.
  close(remapStripTime(stripCyclic, 500), 250, 1e-9,
    '27: USR_TIME_CYCLIC: 750 wraps into [0, 500) → 250');
}

// ── 28. evaluateNla immutability — input animData + project unchanged
// (audit-fix MED-A6) ────────────────────────────────────────────────
{
  // The module documents evaluateNla as pure. Verify by deep-freezing
  // the inputs — any mutation attempt would throw in strict mode (and
  // Node ESM runs strict). A successful run with no throw + identical
  // post-call JSON proves immutability.
  const project = makeLinearRampProject('a1', 100);
  const strip = makeNlaStrip('s_im', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 0.5,
    blendin: 100, blendout: 100,
  });
  const animData = {
    flag: 0,
    tmpActionId: null, tmpSlotHandle: 0,
    tweakTrackId: null, tweakStripId: null,
    nlaTracks: [makeNlaTrack('t_im', 'T', { index: 0, strips: [strip] })],
  };
  // Deep freeze
  function deepFreeze(obj) {
    if (obj === null || typeof obj !== 'object') return;
    Object.freeze(obj);
    for (const k of Object.keys(obj)) deepFreeze(obj[k]);
  }
  deepFreeze(animData);
  deepFreeze(project);

  const animDataBefore = JSON.stringify(animData);
  const projectBefore = JSON.stringify(project);

  let threw = false;
  try {
    evaluateNla(animData, 500, project);
    evaluateNla(animData, 100, project);   // run twice (different times)
    evaluateNla(animData, 950, project);
  } catch (_e) { threw = true; }

  assert(!threw, '28a: evaluateNla does not throw on frozen inputs (no mutation attempts)');
  eq(JSON.stringify(animData), animDataBefore, '28b: animData unchanged post-call (deep JSON equal)');
  eq(JSON.stringify(project), projectBefore, '28c: project unchanged post-call');
}

// ── 29. End-to-end hold_forward past-end clamp+remap (audit-fix LOW-A8) ─
{
  // Strip [100, 300], action [0, 200], extendmode='hold_forward'. At
  // t=500 (past end), strip is active per stripActiveAt (hold_forward),
  // clampStripTime clamps t to 300 (strip.end), remapStripTime maps
  // 300 → actend (200) via integer-repeat pin, fcurve(200) is the
  // action's last keyform value. End-to-end pipeline check.
  const project = makeLinearRampProject('a1', 100);   // paramX 0→100 over 0→1000ms
  // Use a project with action [0, 200] so the test is unambiguous:
  const projectShort = {
    actions: [{
      id: 'a_short',
      fcurves: [{
        id: 'fc1', rnaPath: 'paramX',
        keyforms: [
          { time: 0,   value: 0,  interpolation: 'linear' },
          { time: 200, value: 80, interpolation: 'linear' },
        ],
      }],
    }],
  };
  const strip = makeNlaStrip('s_hf', 'a_short', {
    start: 100, end: 300, actstart: 0, actend: 200, influence: 1,
    extendmode: 'hold_forward',
  });
  const animData = {
    flag: 0,
    nlaTracks: [makeNlaTrack('t1', 'T', { index: 0, strips: [strip] })],
  };
  // At t=500: hold_forward → active, clamp to 300, remap to actend=200
  // (integer-repeat pin), fcurve(200) = 80, replace lerp(0, 80, 1) = 80.
  const acc = evaluateNla(animData, 500, projectShort);
  close(/** @type number */ (acc.get('paramX')), 80, 1e-9,
    '29: hold_forward past-end → clamp to strip.end → fcurve(actend) = 80');
  // At t=50 (before start): hold_forward does NOT extend backward
  // → strip skipped, empty map.
  const accBefore = evaluateNla(animData, 50, projectShort);
  eq(accBefore.size, 0,
    '29: hold_forward before start NOT active → empty result');
}

// ── 30. Stacked-strip integration: subtract on top of replace (Slice 4.F) ─
{
  // Slice 4.F coverage closure: plan §4.F listed
  // `test_nla_blend_subtract.mjs` as a separate file. §1 already covers
  // the kernel (single-call value semantics); this section covers the
  // INTEGRATION path — a subtract strip layered on top of a replace
  // strip in a real NLA stack. Mirrors §15 (replace+add) structure.
  // Bottom: REPLACE pX with a1's 0→100 ramp.
  // Top: SUBTRACT a constant 30 (a2's fcurve).
  // At t=500: bottom puts 50 into acc; top subtracts 30*1 = 20.
  const project = makeLinearRampProject('a1', 100);
  const projectWithSubtract = {
    actions: [
      ...project.actions,
      {
        id: 'a_const30',
        fcurves: [{
          id: 'fc_c30', rnaPath: 'paramX',
          keyforms: [
            { time: 0,    value: 30, interpolation: 'linear' },
            { time: 1000, value: 30, interpolation: 'linear' },
          ],
        }],
      },
    ],
  };
  const bottomStrip = makeNlaStrip('sb', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
    blendmode: 'replace',
  });
  const topStrip = makeNlaStrip('st', 'a_const30', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
    blendmode: 'subtract',
  });
  const animData = {
    flag: 0,
    nlaTracks: [
      makeNlaTrack('t_bot', 'Body', { index: 0, strips: [bottomStrip] }),
      makeNlaTrack('t_top', 'Face', { index: 1, strips: [topStrip] }),
    ],
  };
  // At t=500: REPLACE(0, 50, 1) = 50; SUBTRACT(50, 30, 1) = 50 - 30 = 20
  const acc = evaluateNla(animData, 500, projectWithSubtract);
  close(/** @type number */ (acc.get('paramX')), 20, 1e-9,
    '30a: replace(50) - 30 = 20 (stacked subtract integration)');

  // With influence 0.5 on top: SUBTRACT(50, 30, 0.5) = 50 - 30*0.5 = 35
  topStrip.influence = 0.5;
  const acc2 = evaluateNla(animData, 500, projectWithSubtract);
  close(/** @type number */ (acc2.get('paramX')), 35, 1e-9,
    '30b: replace(50) - 30*0.5 = 35 (subtract with partial influence)');
}

// ── 31. Stacked-strip integration: multiply on top of replace (Slice 4.F) ─
{
  // Same closure logic for multiply. Plan §4.F:
  // multiply kernel: out = inf*(lower*strip) + (1-inf)*lower
  // Bottom: REPLACE pX with a1's 0→100 ramp; at t=500 → 50.
  // Top: MULTIPLY by a constant 2 (a3's fcurve), influence 1.
  // Result: 1*(50*2) + 0*50 = 100.
  const project = makeLinearRampProject('a1', 100);
  const projectWithMultiply = {
    actions: [
      ...project.actions,
      {
        id: 'a_const2',
        fcurves: [{
          id: 'fc_c2', rnaPath: 'paramX',
          keyforms: [
            { time: 0,    value: 2, interpolation: 'linear' },
            { time: 1000, value: 2, interpolation: 'linear' },
          ],
        }],
      },
    ],
  };
  const bottomStrip = makeNlaStrip('sb', 'a1', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
    blendmode: 'replace',
  });
  const topStrip = makeNlaStrip('st', 'a_const2', {
    start: 0, end: 1000, actstart: 0, actend: 1000, influence: 1,
    blendmode: 'multiply',
  });
  const animData = {
    flag: 0,
    nlaTracks: [
      makeNlaTrack('t_bot', 'Body', { index: 0, strips: [bottomStrip] }),
      makeNlaTrack('t_top', 'Face', { index: 1, strips: [topStrip] }),
    ],
  };
  // At t=500: REPLACE → 50; MULTIPLY(50, 2, inf=1) = 1*(50*2) + 0*50 = 100
  const acc = evaluateNla(animData, 500, projectWithMultiply);
  close(/** @type number */ (acc.get('paramX')), 100, 1e-9,
    '31a: replace(50) * 2 = 100 (stacked multiply integration)');

  // Influence 0.5: MULTIPLY(50, 2, 0.5) = 0.5*(50*2) + 0.5*50 = 50 + 25 = 75
  topStrip.influence = 0.5;
  const acc2 = evaluateNla(animData, 500, projectWithMultiply);
  close(/** @type number */ (acc2.get('paramX')), 75, 1e-9,
    '31b: multiply(50, 2, 0.5) = 75 (partial influence lerps toward identity)');
}

console.log(`\nnlaEval: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
