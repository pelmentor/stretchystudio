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
    { time: 0,    value: -5, easing: 'linear' },
    { time: 100,  value:  3, easing: 'linear' },
    { time: 200,  value: 15, easing: 'linear' },
  ];
  const clamped = clampKeyframes(kfs, 0, 10);
  assert(clamped[0].value === 0,  'clamp: -5 → 0');
  assert(clamped[1].value === 3,  'clamp: in-range preserved');
  assert(clamped[2].value === 10, 'clamp: 15 → 10');
  assert(clamped[0].time === 0,   'clamp: time preserved');
  assert(clamped[0].easing === 'linear', 'clamp: easing preserved');
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

console.log(`motionLib: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
