// v3 Phase 0F.28 - tests for src/io/live2d/idle/motionLib.js
//
// Procedural curve generators for idle motion3.json synthesis. The
// loop-safety contract (value(t=0) === value(t=durationMs)) is the
// invariant every generator must honour - otherwise loop=true motion3
// pops at the seam. Until now untested.
//
// Run: node scripts/test/test_motionLib.mjs

import {
  makeRng,
  genConstant,
  genSine,
  genWander,
  clampKeyframes,
  applyPersonality,
} from '../../src/io/live2d/idle/motionLib.js';
import { encodeKeyframesToSegments } from '../../src/io/live2d/motion3json.js';
import { buildParamFCurve } from '../../src/anim/animationFCurve.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function near(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

// ── makeRng: deterministic seeded PRNG ───────────────────────────

{
  const r1 = makeRng(42);
  const r2 = makeRng(42);
  // Same seed → same sequence
  for (let i = 0; i < 10; i++) {
    if (r1() !== r2()) { failed++; console.error(`FAIL: rng seed determinism @${i}`); break; }
  }
  passed++;

  // Different seeds → different sequences
  const a = makeRng(1)();
  const b = makeRng(2)();
  assert(a !== b, 'rng: different seeds → different first value');

  // Output is in [0, 1)
  const r = makeRng(7);
  for (let i = 0; i < 100; i++) {
    const v = r();
    if (v < 0 || v >= 1) { failed++; console.error(`FAIL: rng range — got ${v}`); break; }
  }
  passed++;
}

// ── genConstant: flat curve ──────────────────────────────────────

{
  const kfs = genConstant({ durationMs: 5000, value: 42 });
  assert(kfs.length === 2, 'genConstant: 2 keyframes');
  assert(kfs[0].time === 0 && kfs[1].time === 5000, 'genConstant: span = duration');
  assert(kfs[0].value === 42 && kfs[1].value === 42, 'genConstant: value held');
  // Loop-safety: t=0 and t=D have same value
  assert(kfs[0].value === kfs[kfs.length - 1].value, 'genConstant: loop-safe');
}

// ── genSine: loop-safe + period snapping ─────────────────────────

{
  const kfs = genSine({ durationMs: 4000, amplitude: 1, period: 1000, mid: 0 });
  // Loop safety: first and last value must match exactly
  assert(near(kfs[0].value, kfs[kfs.length - 1].value, 1e-9),
    'genSine: loop-safe (first === last)');

  // Centered around mid
  const max = Math.max(...kfs.map(k => k.value));
  const min = Math.min(...kfs.map(k => k.value));
  assert(near((max + min) / 2, 0, 0.1), 'genSine: centred near mid=0');
  assert(max <= 1.001 && min >= -1.001, 'genSine: amplitude respected');

  // Time monotonic increasing
  for (let i = 1; i < kfs.length; i++) {
    if (kfs[i].time < kfs[i - 1].time) {
      failed++; console.error('FAIL: genSine: time not monotonic'); break;
    }
  }
  passed++;
  assert(kfs[0].time === 0, 'genSine: starts at 0');
  assert(kfs[kfs.length - 1].time === 4000, 'genSine: ends at duration');
}

{
  // Period that doesn't divide duration evenly gets snapped
  const kfs = genSine({ durationMs: 1000, amplitude: 1, period: 333, mid: 0 });
  // 1000 / 333 ≈ 3.003 → snaps to 3 cycles, period = 333.33
  assert(near(kfs[0].value, kfs[kfs.length - 1].value, 1e-9),
    'genSine: loop-safe even with non-dividing period');
}

// ── genWander: deterministic + loop-safe ─────────────────────────

{
  const kfs1 = genWander({ durationMs: 2000, amplitude: 0.5, seed: 42 });
  const kfs2 = genWander({ durationMs: 2000, amplitude: 0.5, seed: 42 });
  // Same seed → same output
  let same = kfs1.length === kfs2.length;
  if (same) for (let i = 0; i < kfs1.length; i++) {
    if (!near(kfs1[i].value, kfs2[i].value)) { same = false; break; }
  }
  assert(same, 'genWander: same seed → identical curve');

  // Loop-safe
  assert(near(kfs1[0].value, kfs1[kfs1.length - 1].value, 1e-6),
    'genWander: loop-safe');

  // Different seed → different curve
  const kfs3 = genWander({ durationMs: 2000, amplitude: 0.5, seed: 99 });
  assert(kfs3[5].value !== kfs1[5].value, 'genWander: different seed → different');
}

// ── clampKeyframes ───────────────────────────────────────────────

{
  const kfs = [
    { time: 0,    value: -5, interpolation: 'linear' },
    { time: 100,  value:  3, interpolation: 'linear' },
    { time: 200,  value: 15, interpolation: 'linear' },
  ];
  const clamped = clampKeyframes(kfs, 0, 10);
  assert(clamped[0].value === 0,  'clamp: -5 → 0');
  assert(clamped[1].value === 3,  'clamp: in-range preserved');
  assert(clamped[2].value === 10, 'clamp: 15 → 10');
  assert(clamped[0].time === 0,   'clamp: time preserved');
  assert(clamped[0].interpolation === 'linear', 'clamp: interpolation preserved');
  // Original not mutated
  assert(kfs[0].value === -5, 'clamp: input unmodified');
}

// ── applyPersonality ─────────────────────────────────────────────

{
  const base = { amplitude: 1, period: 1000, intervalAvgMs: 5000, intervalJitterMs: 1000 };

  // Calm: identity multipliers
  const calm = applyPersonality(base, 'calm');
  assert(calm.amplitude === 1 && calm.period === 1000, 'personality: calm = identity');

  // Energetic: bigger amp, shorter period
  const energetic = applyPersonality(base, 'energetic');
  assert(energetic.amplitude === 1.5, 'personality: energetic.amplitude *= 1.5');
  assert(energetic.period === 700,    'personality: energetic.period *= 0.7');

  // Tired: smaller amp, longer period
  const tired = applyPersonality(base, 'tired');
  assert(tired.amplitude === 0.6, 'personality: tired.amplitude');
  assert(tired.period === 1400,   'personality: tired.period');

  // Unknown → defaults to calm
  const unknown = applyPersonality(base, 'banana');
  assert(unknown.amplitude === 1, 'personality: unknown → calm fallback');

  // Missing fields untouched
  const partial = { amplitude: 2 };
  const out = applyPersonality(partial, 'energetic');
  assert(out.amplitude === 3, 'personality: only present fields scaled');
  assert(out.period === undefined, 'personality: missing field stays missing');

  // Input not mutated
  assert(base.amplitude === 1, 'personality: input unchanged');
}

// ── genSine emits bezier handles (smooth-playback regression) ────────

{
  const kfs = genSine({ durationMs: 4000, amplitude: 1, period: 2000, mid: 0 });
  // Every keyframe carries bezier interpolation + analytical handles
  let allBezier = true;
  for (const kf of kfs) {
    if (kf.interpolation !== 'bezier') { allBezier = false; break; }
    if (!kf.handleLeft || !kf.handleRight) { allBezier = false; break; }
  }
  assert(allBezier, 'genSine: every kf has interpolation=bezier + L/R handles');

  // Handle slope at t≈0 should match analytical cosine derivative.
  // v = sin(ωt), dv/dt = ω·cos(ωt). At t=0: dv/dt = ω = 2π/2000.
  // Handle offset = (D/N)/3. genSine uses N = max(8, cycles*12) = 24
  // (cycles=2). dt = 4000/24, handleOff = dt/3 ≈ 55.56ms.
  // Expected handleRight.value at t=0: 0 + ω·handleOff
  //                                    = (2π/2000) · (4000/72)
  //                                    = 8π/2880 ≈ 0.1745
  const kf0 = kfs[0];
  const expectedHRValue = (2 * Math.PI / 2000) * (4000 / 24 / 3);
  assert(near(kf0.handleRight.value, expectedHRValue, 1e-6),
    'genSine: t=0 handleRight matches analytical derivative');
  assert(near(kf0.handleLeft.value, -expectedHRValue, 1e-6),
    'genSine: t=0 handleLeft mirrors derivative across t');

  // End-to-end: motion3 encoder emits TYPE-1 (bezier) segments, not LINEAR.
  // Pre-fix every segment was type 0 (linear) because motionLib used the
  // `easing` field which the encoder doesn't read.
  const segments = encodeKeyframesToSegments(kfs, 4);
  // segments[0,1] = (t0, v0), then triples/septets per segment.
  let i = 2;
  let bezierCount = 0, linearCount = 0;
  while (i < segments.length) {
    const type = segments[i];
    if (type === 1) { bezierCount++; i += 7; }
    else            { linearCount++; i += 3; }
  }
  assert(bezierCount > 0, 'encoder: genSine produces bezier segments');
  assert(linearCount === 0, 'encoder: NO linear segments in pure sine motion');
}

// ── genWander emits bezier handles ───────────────────────────────────

{
  const kfs = genWander({ durationMs: 2000, amplitude: 0.5, harmonics: 3, seed: 42 });
  let allBezier = true;
  for (const kf of kfs) {
    if (kf.interpolation !== 'bezier'
        || !kf.handleLeft || !kf.handleRight) { allBezier = false; break; }
  }
  assert(allBezier, 'genWander: every kf has bezier + handles');

  // Loop-safety post-bezier: first/last handles still pin first/last value
  assert(near(kfs[0].value, kfs[kfs.length - 1].value, 1e-9),
    'genWander: loop-safe value after bezier emission');
}

// ── Analytical handles survive normalizeKeyforms via handleType=free ─
//
// Without handleType:{left:'free',right:'free'} on every kf,
// recalcKeyformHandles overwrites the analytical handles with
// vector (straight-line) ones, collapsing the bezier to a 2N-sided
// polygon — visibly blocky at the extrema in Cubism viewer + ren'py.
// This pin replays the breath config that surfaced the bug and asserts
// the analytical hL/hR values survive the buildParamFCurve round-trip.

{
  const cfg = { durationMs: 10000, amplitude: 0.5, period: 3500, phase: -Math.PI / 2, mid: 0.5 };
  const kfs = genSine(cfg);
  const fc = buildParamFCurve('ParamBreath', kfs);

  assert(fc.keyforms[0].handleType?.left === 'free' && fc.keyforms[0].handleType?.right === 'free',
    'normalize: kf[0] handleType stays free/free');

  // At t=0 with phase=-π/2, sin = -1 (trough). cos = 0 → analytical
  // handle slope = 0 → hR.value must equal kf.value (0).
  assert(near(fc.keyforms[0].handleRight.value, 0, 1e-9),
    'normalize: kf[0] hR.value preserved at analytical 0 (trough)');
  assert(near(fc.keyforms[0].handleLeft.value, 0, 1e-9),
    'normalize: kf[0] hL.value preserved at analytical 0 (trough)');

  // No bezier segment may degenerate to flat handles (cy1==cy2) over a
  // pure sine — that signature is the polygonal vector-handle artefact.
  const segs = encodeKeyframesToSegments(fc.keyforms, 10);
  let degenerate = 0, bezierTotal = 0;
  for (let i = 2; i + 6 < segs.length; ) {
    const type = segs[i];
    if (type === 1) {
      bezierTotal++;
      if (Math.abs(segs[i + 2] - segs[i + 4]) < 1e-9) degenerate++;
      i += 7;
    } else i += 3;
  }
  assert(bezierTotal > 0 && degenerate === 0,
    `normalize: no flat-handle (cy1==cy2) bezier segs after round-trip (got ${degenerate}/${bezierTotal})`);
}

// ── Adaptive handleOff: extremum plateau bounded to sub-frame width ──
//
// Pre-2026-06-09 the handle offset was fixed at dt/3. At a sine peak the
// analytical slope is 0, so handleLeft.value === peak.value — the bezier
// asymptoted to the peak over the last 1/3 of the segment, visibly holding
// at the peak value for ~30-90 ms ("snap at extremes" in cubism viewer).
// Adaptive offset shrinks to ~15% of dt/3 at extrema, collapsing the
// plateau to sub-frame width at typical fps.
//
// Pin: for the breath config (calm, period=3500, amp=0.5), count samples
// in the last 100 ms before peak where bezier value is within 1e-3 of
// the peak. Pre-fix this was 17/50; post-fix should be ≤ 8/50.

{
  const { default: assertImport } = await import('node:assert');
  const { evaluateBezTripleSegment } = await import('../../src/anim/fcurveEval.js');
  const cfg = { durationMs: 10000, amplitude: 0.5, period: 3500, phase: -Math.PI / 2, mid: 0.5 };
  const kfs = genSine(cfg);
  let peakIdx = -1, peakV = -Infinity;
  for (let i = 0; i < kfs.length; i++) if (kfs[i].value > peakV) { peakV = kfs[i].value; peakIdx = i; }
  const prev = kfs[peakIdx - 1];
  const peak = kfs[peakIdx];
  let plateau = 0;
  for (let t = peak.time - 100; t <= peak.time; t += 2) {
    const bv = evaluateBezTripleSegment(prev, peak, t);
    if (Math.abs(peakV - bv) < 1e-3) plateau++;
  }
  assert(plateau <= 8,
    `adaptive handleOff: plateau-near-peak should be <= 8 of 50 samples (was 17 pre-fix); got ${plateau}`);
  assert(peakV > 0.999,
    `sanity: peak still reached cleanly (got ${peakV})`);
}

console.log(`motionLib: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
