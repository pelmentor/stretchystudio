// Tests for FModifier evaluator (Animation Phase 3 Slice 3.B).
//
// Covers:
//   - influence calc (useInfluence + range gate + blendin/blendout)
//   - 6 per-type evaluators (cycles/noise/generator/limits/stepped/envelope)
//   - two-pass dispatcher (reverse-walk time + forward-walk value)
//   - cycles t->v storage handoff (cycyofs)
//   - evaluateFCurve integration (modifier pipeline + driver interaction)
//
// Run: node scripts/test/test_fmodifiers.mjs

import {
  perlinNoise2D,
  perlinFbm2D,
  computeFModifierInfluence,
  evaluateCyclesTime,
  evaluateCyclesValue,
  evaluateNoiseValue,
  evaluateGeneratorValue,
  evaluateLimitsTime,
  evaluateLimitsValue,
  evaluateSteppedTime,
  evaluateEnvelopeValue,
  evaluateTimeModifiers,
  evaluateValueModifiers,
  evaluateFModifierStack,
} from '../../src/anim/fmodifiers.js';
import { evaluateFCurve } from '../../src/anim/fcurve.js';

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
function approx(a, b, name, eps = 1e-6) {
  if (Math.abs(a - b) <= eps) { passed++; return; }
  failed++; failures.push(name);
  console.error(`FAIL: ${name}\n   got:      ${a}\n   expected: ${b} (±${eps})`);
}

// ===========================================================================
// Influence (range + blendin/blendout)
// ===========================================================================

// ── 1. useInfluence=false → influence is 1 regardless of mod.influence ─
{
  const mod = { id: 'm1', type: 'noise', influence: 0.3 };
  approx(computeFModifierInfluence(mod, 500), 1, '1: useInfluence false → 1.0');
}

// ── 2. useInfluence=true → uses mod.influence ───────────────────────
{
  const mod = { id: 'm1', type: 'noise', useInfluence: true, influence: 0.3 };
  approx(computeFModifierInfluence(mod, 500), 0.3, '2: useInfluence true → 0.3');
}

// ── 3. Range gate: outside range → influence 0 ──────────────────────
{
  const mod = { id: 'm1', type: 'noise', useRestrictedRange: true, sfra: 100, efra: 500 };
  approx(computeFModifierInfluence(mod, 50), 0, '3a: before sfra → 0');
  approx(computeFModifierInfluence(mod, 600), 0, '3b: after efra → 0');
  approx(computeFModifierInfluence(mod, 300), 1, '3c: inside range, no useInfluence → 1');
}

// ── 4. Blend-in fade: linear ramp 0 → influence over blendin window ─
{
  const mod = { id: 'm1', type: 'noise', useRestrictedRange: true,
    sfra: 100, efra: 500, blendin: 100 };
  approx(computeFModifierInfluence(mod, 100), 0, '4a: at sfra → 0');
  approx(computeFModifierInfluence(mod, 150), 0.5, '4b: half-way through blendin → 0.5');
  approx(computeFModifierInfluence(mod, 200), 1, '4c: at end of blendin → 1.0');
  approx(computeFModifierInfluence(mod, 350), 1, '4d: past blendin → 1.0');
}

// ── 5. Blend-out fade: linear ramp influence → 0 over blendout window ─
{
  const mod = { id: 'm1', type: 'noise', useRestrictedRange: true,
    sfra: 100, efra: 500, blendout: 100 };
  approx(computeFModifierInfluence(mod, 400), 1, '5a: at start of blendout → 1.0');
  approx(computeFModifierInfluence(mod, 450), 0.5, '5b: half-way → 0.5');
  approx(computeFModifierInfluence(mod, 500), 0, '5c: at efra → 0');
}

// ── 6. Blend-in × useInfluence: scaled ramp ─────────────────────────
{
  const mod = { id: 'm1', type: 'noise', useRestrictedRange: true,
    useInfluence: true, influence: 0.4,
    sfra: 100, efra: 500, blendin: 100 };
  approx(computeFModifierInfluence(mod, 150), 0.2, '6: 0.5 * 0.4 = 0.2');
}

// ===========================================================================
// Perlin noise primitive sanity
// ===========================================================================

// ── 7. Perlin noise is deterministic ────────────────────────────────
{
  const a = perlinNoise2D(0.5, 0.7);
  const b = perlinNoise2D(0.5, 0.7);
  eq(a, b, '7a: deterministic — same input twice → same output');
  assert(a >= -1 && a <= 1, '7b: perlin range roughly [-1, +1]');
  // Different inputs → different outputs
  const c = perlinNoise2D(0.5, 0.71);
  assert(a !== c, '7c: different y → different output');
}

// ── 8. perlinFbm2D normalised to ~[0, 1] ────────────────────────────
{
  const samples = [];
  for (let i = 0; i < 50; i++) {
    samples.push(perlinFbm2D(i * 0.13, 0.5, 0, 0.5, 2));
  }
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  assert(min >= 0 && min < 0.5, '8a: fbm min in lower half');
  assert(max > 0.5 && max <= 1, '8b: fbm max in upper half');
}

// ── 9. perlinFbm2D with depth=0 is single-octave ─────────────────────
{
  // Single octave = base Perlin remapped to [0,1]. Two calls with same
  // input must be identical.
  const a = perlinFbm2D(2.7, 1.0, 0, 0.5, 2);
  const b = perlinFbm2D(2.7, 1.0, 0, 0.5, 2);
  eq(a, b, '9: deterministic across calls');
}

// ===========================================================================
// Generator
// ===========================================================================

// ── 10. Polynomial: c0 + c1*x + c2*x^2 ──────────────────────────────
{
  const mod = { type: 'generator', data: { mode: 'polynomial', coefficients: [1, 2, 3] } };
  // At x=0: 1
  approx(evaluateGeneratorValue(mod, 0, 0), 1, '10a: poly at x=0 → 1');
  // At x=2: 1 + 2*2 + 3*4 = 1 + 4 + 12 = 17
  approx(evaluateGeneratorValue(mod, 0, 2), 17, '10b: poly at x=2 → 17');
}

// ── 11. Polynomial replaces cvalue (not additive by default) ────────
{
  const mod = { type: 'generator', data: { mode: 'polynomial', coefficients: [5] } };
  approx(evaluateGeneratorValue(mod, 100, 0), 5, '11: non-additive replaces input');
}

// ── 12. Polynomial additive: adds to cvalue ─────────────────────────
{
  const mod = { type: 'generator', data: { mode: 'polynomial', coefficients: [5], additive: true } };
  approx(evaluateGeneratorValue(mod, 100, 0), 105, '12: additive sums');
}

// ── 13. Factorised polynomial: pair = a*x + b ───────────────────────
{
  // [2, 3, 4, 5] = (2x + 3) * (4x + 5)
  // At x=1: (2+3) * (4+5) = 5 * 9 = 45
  const mod = { type: 'generator',
    data: { mode: 'polynomial_factorised', coefficients: [2, 3, 4, 5] } };
  approx(evaluateGeneratorValue(mod, 0, 1), 45, '13a: factorised pair at x=1');
  // At x=0: 3 * 5 = 15
  approx(evaluateGeneratorValue(mod, 0, 0), 15, '13b: factorised pair at x=0');
}

// ── 14. Factorised — pair order matters (regression: 3.A audit HIGH) ─
{
  // If the pair were (offset + scale*x) by mistake, [2,3] at x=10 would
  // be 2 + 3*10 = 32. The correct (scale*x + offset) gives 2*10 + 3 = 23.
  const mod = { type: 'generator',
    data: { mode: 'polynomial_factorised', coefficients: [2, 3] } };
  approx(evaluateGeneratorValue(mod, 0, 10), 23,
    '14: pair = scale*x + offset (NOT offset + scale*x — the 3.A HIGH regression test)');
}

// ── 15. Empty coefficients → unchanged ──────────────────────────────
{
  const mod = { type: 'generator', data: { coefficients: [] } };
  approx(evaluateGeneratorValue(mod, 42, 5), 42, '15: empty coeffs is no-op');
}

// ===========================================================================
// Limits
// ===========================================================================

// ── 16. Limits time-pass: X clamping ────────────────────────────────
{
  const mod = { type: 'limits', data: { useMinX: true, minX: 100, useMaxX: true, maxX: 500 } };
  eq(evaluateLimitsTime(mod, 50), 100, '16a: below minX → minX');
  eq(evaluateLimitsTime(mod, 600), 500, '16b: above maxX → maxX');
  eq(evaluateLimitsTime(mod, 300), 300, '16c: inside → unchanged');
}

// ── 17. Limits value-pass: Y clamping ───────────────────────────────
{
  const mod = { type: 'limits', data: { useMinY: true, minY: -10, useMaxY: true, maxY: 10 } };
  eq(evaluateLimitsValue(mod, -50), -10, '17a: below minY → minY');
  eq(evaluateLimitsValue(mod, 50), 10, '17b: above maxY → maxY');
  eq(evaluateLimitsValue(mod, 0), 0, '17c: inside → unchanged');
}

// ── 18. Limits with no flags set: passthrough ───────────────────────
{
  const mod = { type: 'limits', data: {} };
  eq(evaluateLimitsTime(mod, 999), 999, '18a: no use flags X → unchanged');
  eq(evaluateLimitsValue(mod, 999), 999, '18b: no use flags Y → unchanged');
}

// ===========================================================================
// Stepped
// ===========================================================================

// ── 19. Stepped snaps to step boundaries ────────────────────────────
{
  // stepSize=100ms, offset=0; t=250 should snap to 200; t=350 to 300; etc.
  const mod = { type: 'stepped', data: { stepSize: 100, offset: 0 } };
  eq(evaluateSteppedTime(mod, 250), 200, '19a: 250→200');
  eq(evaluateSteppedTime(mod, 350), 300, '19b: 350→300');
  eq(evaluateSteppedTime(mod, 700), 700, '19c: on boundary → boundary');
}

// ── 20. Stepped with offset ─────────────────────────────────────────
{
  // stepSize=100, offset=10; bands at 10..110, 110..210, ...
  const mod = { type: 'stepped', data: { stepSize: 100, offset: 10 } };
  eq(evaluateSteppedTime(mod, 50), 10, '20a: 50→10 (offset start)');
  eq(evaluateSteppedTime(mod, 150), 110, '20b: 150→110');
}

// ── 20b. Stepped truncates toward zero (audit-fix 3.B HIGH-1) ──────
{
  // Regression for HIGH-1: Math.floor vs C int() truncation. For
  // (evaltime - offset) negative, floor rounds toward -inf and gives
  // one step lower than Blender; trunc rounds toward zero and matches.
  // stepSize=100, offset=500, evaltime=400 → (400-500)/100 = -1.0
  //   trunc(-1.0) = -1   → snapblock=-1 → -100+500 = 400 (boundary; on step)
  // stepSize=100, offset=500, evaltime=450 → (450-500)/100 = -0.5
  //   trunc(-0.5) = 0    → snapblock= 0 → 0+500 = 500 (matches Blender int())
  //   floor(-0.5) = -1   → snapblock=-1 → -100+500 = 400 (pre-fix bug)
  const mod = { type: 'stepped', data: { stepSize: 100, offset: 500 } };
  eq(evaluateSteppedTime(mod, 450), 500,
    '20b: trunc(-0.5)=0 → snaps UP to offset, not down (Blender C int() semantics)');
  eq(evaluateSteppedTime(mod, 350), 400,
    '20c: trunc(-1.5)=-1 → snaps to 400 (matches Blender)');
}

// ── 21. Stepped useStartTime/useEndTime gates ───────────────────────
{
  const mod = { type: 'stepped', data: {
    stepSize: 100, offset: 0, useStartTime: true, startTime: 200,
    useEndTime: true, endTime: 800,
  } };
  eq(evaluateSteppedTime(mod, 150), 150, '21a: before startTime → unchanged');
  eq(evaluateSteppedTime(mod, 450), 400, '21b: inside → snapped');
  eq(evaluateSteppedTime(mod, 900), 900, '21c: after endTime → unchanged');
}

// ===========================================================================
// Envelope
// ===========================================================================

// ── 22. Envelope: cvalue remap with single control point ────────────
{
  // referenceValue=0, defaultMin=-1, defaultMax=1 means input range is [-1, +1]
  // controlPoint at t=500 has min=0, max=10 means output range is [0, 10]
  // cvalue=0 maps to fac = (0 - (-1)) / 2 = 0.5 → output = 0 + 0.5*10 = 5
  const mod = { type: 'envelope', data: {
    referenceValue: 0, defaultMin: -1, defaultMax: 1,
    controlPoints: [{ time: 500, min: 0, max: 10 }],
  } };
  approx(evaluateEnvelopeValue(mod, 0, 500), 5, '22a: midpoint of input → midpoint of output');
  approx(evaluateEnvelopeValue(mod, 1, 500), 10, '22b: top of input → top of output');
  approx(evaluateEnvelopeValue(mod, -1, 500), 0, '22c: bottom of input → bottom of output');
}

// ── 23. Envelope: linear interp between two control points ──────────
{
  const mod = { type: 'envelope', data: {
    referenceValue: 0, defaultMin: 0, defaultMax: 1,
    controlPoints: [
      { time: 0, min: 0, max: 10 },
      { time: 1000, min: 5, max: 20 },
    ],
  } };
  // cvalue=1 (top of input) at t=500 (midpoint of envelope)
  // midpoint envelope: min=2.5, max=15
  // fac = (1 - 0) / 1 = 1; output = 2.5 + 1 * (15 - 2.5) = 15
  approx(evaluateEnvelopeValue(mod, 1, 500), 15, '23a: lerp envelope at midpoint, fac=1');
  // cvalue=0.5 at t=500: fac=0.5; output = 2.5 + 0.5 * 12.5 = 8.75
  approx(evaluateEnvelopeValue(mod, 0.5, 500), 8.75, '23b: lerp envelope at midpoint, fac=0.5');
}

// ── 24. Envelope: no control points → passthrough ───────────────────
{
  const mod = { type: 'envelope', data: { controlPoints: [] } };
  eq(evaluateEnvelopeValue(mod, 42, 500), 42, '24: empty controlPoints → passthrough');
}

// ===========================================================================
// Noise
// ===========================================================================

// ── 25. Noise is deterministic for same params ──────────────────────
{
  const mod = { type: 'noise', data: { size: 100, strength: 1, phase: 1 } };
  const a = evaluateNoiseValue(mod, 0, 500);
  const b = evaluateNoiseValue(mod, 0, 500);
  eq(a, b, '25: same params + time → same value');
}

// ── 26. Noise — different time → different value (almost always) ────
{
  const mod = { type: 'noise', data: { size: 100, strength: 1, phase: 1 } };
  const a = evaluateNoiseValue(mod, 0, 500);
  const b = evaluateNoiseValue(mod, 0, 1000);
  assert(a !== b, '26: different time → different value');
}

// ── 27. Noise — phase shift changes output ──────────────────────────
{
  const a = evaluateNoiseValue({ type: 'noise', data: { size: 100, strength: 1, phase: 1 } }, 0, 500);
  const b = evaluateNoiseValue({ type: 'noise', data: { size: 100, strength: 1, phase: 5 } }, 0, 500);
  assert(a !== b, '27: different phase → different value');
}

// ── 28. Noise REPLACE adds centred noise to cvalue (NOT replaces) ──
{
  // strength=0 → noise contribution is 0 regardless → cvalue unchanged
  const mod = { type: 'noise', data: { strength: 0, blendType: 'replace' } };
  approx(evaluateNoiseValue(mod, 42, 500), 42, '28: strength=0 → unchanged');
}

// ── 29. Noise blend types ───────────────────────────────────────────
{
  // strength=0 short-circuits all four — they're all additive in the strength term
  const base = { type: 'noise', data: { strength: 0 } };
  for (const blend of ['replace', 'add', 'subtract']) {
    approx(
      evaluateNoiseValue({ ...base, data: { ...base.data, blendType: blend } }, 42, 500),
      42, `29-${blend}: strength=0 → unchanged`,
    );
  }
  // Multiply: cvalue * noise * 0 = 0 (multiply zeroes regardless of cvalue)
  approx(
    evaluateNoiseValue({ ...base, data: { ...base.data, blendType: 'multiply' } }, 42, 500),
    0, '29-multiply: strength=0 → zeros via multiply');
}

// ===========================================================================
// Cycles
// ===========================================================================

// ── 30. Cycles 'none' is passthrough ────────────────────────────────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  const mod = { type: 'cycles', data: { before: 'none', after: 'none' } };
  const s = { cycyofs: 0 };
  eq(evaluateCyclesTime(mod, fc, -500, s), -500, '30a: before with mode=none → unchanged');
  eq(evaluateCyclesTime(mod, fc, 1500, s), 1500, '30b: after with mode=none → unchanged');
}

// ── 31. Cycles 'repeat' after: t cycles back into [first, last) ─────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  const mod = { type: 'cycles', data: { after: 'repeat', afterCycles: 0 } };
  const s = { cycyofs: 0 };
  // t=1500 should map to 500 (one cycle past)
  approx(evaluateCyclesTime(mod, fc, 1500, s), 500, '31a: 1500 → 500');
  approx(evaluateCyclesTime(mod, fc, 2300, s), 300, '31b: 2300 → 300');
  eq(s.cycyofs, 0, '31c: repeat does NOT set cycyofs');
}

// ── 32. Cycles 'repeat' before: similar ─────────────────────────────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  const mod = { type: 'cycles', data: { before: 'repeat', beforeCycles: 0 } };
  const s = { cycyofs: 0 };
  // t=-500 should map back into the cycle
  const r = evaluateCyclesTime(mod, fc, -500, s);
  assert(r >= 0 && r <= 1000, `32a: -500 maps into [0,1000], got ${r}`);
}

// ── 33. Cycles 'repeat_offset' sets cycyofs ─────────────────────────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  // cycdy = 100 - 0 = 100 per cycle
  const mod = { type: 'cycles', data: { after: 'repeat_offset', afterCycles: 0 } };
  const s = { cycyofs: 0 };
  evaluateCyclesTime(mod, fc, 1500, s);
  // 1500 is past lastX=1000, 1 cycle past; ceil((1500-1000)/1000) = 1; cycyofs = 1 * 100 = 100
  approx(s.cycyofs, 100, '33: repeat_offset cycyofs = 1 cycle * cycdy(100)');
}

// ── 34. Cycles 'mirror' alternates direction ────────────────────────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  const mod = { type: 'cycles', data: { after: 'mirror', afterCycles: 0 } };
  const s = { cycyofs: 0 };
  // t=1500: cycle 0->1 forward; t past lastX, cycle=0.5 (rounded down=0), odd? (cycle+1)%2 = (1)%2 = 1 ≠ 0
  // -> reverse mode: evaltime = lastX - cyct = 1000 - 500 = 500
  approx(evaluateCyclesTime(mod, fc, 1500, s), 500, '34a: mirror cycle 0 reverse');
}

// ── 35. Cycles afterCycles cap stops effect ─────────────────────────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  const mod = { type: 'cycles', data: { after: 'repeat', afterCycles: 2 } };
  const s = { cycyofs: 0 };
  // cycle = (t - 1000) / 1000 > 2 → no effect
  const r = evaluateCyclesTime(mod, fc, 5000, s);
  eq(r, 5000, '35: past cycle cap → unchanged');
}

// ── 36. Cycles value pass adds cycyofs ──────────────────────────────
{
  const s = { cycyofs: 25 };
  approx(evaluateCyclesValue(100, s), 125, '36: cvalue + cycyofs');
  approx(evaluateCyclesValue(100, { cycyofs: 0 }), 100, '36b: no offset → unchanged');
  approx(evaluateCyclesValue(100, {}), 100, '36c: missing cycyofs → unchanged');
}

// ===========================================================================
// Two-pass dispatcher: time pass (reverse walk)
// ===========================================================================

// ── 37. evaluateTimeModifiers: empty list → pass through ────────────
{
  const r = evaluateTimeModifiers([], null, 500);
  eq(r.effectiveTime, 500, '37: empty modifiers → identity');
  assert(Array.isArray(r.scratch) && r.scratch.length === 0, '37b: empty scratch array');
}

// ── 38. evaluateTimeModifiers: stepped warps time ────────────────────
{
  const mods = [{ id: 's1', type: 'stepped', data: { stepSize: 100, offset: 0 } }];
  const r = evaluateTimeModifiers(mods, null, 270);
  eq(r.effectiveTime, 200, '38: stepped 270 → 200');
}

// ── 39. evaluateTimeModifiers: reverse walk order (stepped before limits) ─
{
  // Stack: [limits, stepped] (forward order: limits first, stepped last)
  // Reverse walk: stepped first, then limits.
  // t=550, stepSize=100 → 500, then limits clamps to [600, 800] → 600
  const mods = [
    { id: 'l', type: 'limits', data: { useMinX: true, minX: 600 } },
    { id: 's', type: 'stepped', data: { stepSize: 100, offset: 0 } },
  ];
  const r = evaluateTimeModifiers(mods, null, 550);
  eq(r.effectiveTime, 600, '39: reverse walk — stepped first (550→500), then limits (500→600)');
}

// ── 40. evaluateTimeModifiers: muted modifier is skipped ────────────
{
  const mods = [{ id: 's', type: 'stepped', data: { stepSize: 100, offset: 0 }, muted: true }];
  const r = evaluateTimeModifiers(mods, null, 270);
  eq(r.effectiveTime, 270, '40: muted → unchanged');
}

// ── 41. evaluateTimeModifiers: disabled modifier is skipped ─────────
{
  const mods = [{ id: 's', type: 'stepped', data: { stepSize: 100, offset: 0 }, disabled: true }];
  const r = evaluateTimeModifiers(mods, null, 270);
  eq(r.effectiveTime, 270, '41: disabled → unchanged');
}

// ── 42. evaluateTimeModifiers: out-of-range early-out ───────────────
{
  const mods = [{ id: 's', type: 'stepped',
    data: { stepSize: 100, offset: 0 },
    useRestrictedRange: true, sfra: 1000, efra: 2000,
  }];
  const r = evaluateTimeModifiers(mods, null, 270);
  eq(r.effectiveTime, 270, '42: outside range → unchanged');
}

// ── 42b. Range gate uses ORIGINAL evaltime, not warped t ────────────
{
  // Regression for HIGH-2: pre-audit-fix, the second modifier's range
  // gate was tested against the warped time `t`, not the original
  // `evaltime`. This produced a false-positive gate when modifier 1
  // warped t into modifier 2's exclusion zone (or vice versa).
  //
  // Blender's `evaluate_time_fmodifiers` at `fmodifier.cc:1528-1530`
  // checks `fcm->sfra <= evaltime && fcm->efra >= evaltime` where
  // `evaltime` is the original function parameter, never mutated.
  //
  // Test composition: stack = [limits(useRestrictedRange,
  //   sfra=400, efra=600, useMinX, minX=300), stepped(stepSize=100)]
  // Reverse walk:
  //   stepped at i=1: range gate (no range restrict) passes;
  //     stepped warps 550 → 500.
  //   limits at i=0: range gate against ORIGINAL 550 (in [400,600]) →
  //     passes; clamps t=500 to minX=300 → ... wait, minX=300 but t=500
  //     already exceeds it; no clamp. t stays 500.
  // Pre-fix, the range gate on limits would check t=500 (warped) — still
  // in [400, 600] — same result. Need a case where the warp pushes t
  // OUT of the range so the bug manifests.
  //
  // Better test: stack = [
  //   stepped(stepSize=100, offset=0, useRestrictedRange: sfra=200, efra=400),
  //   stepped(stepSize=50)
  // ]
  // Reverse walk: stepped@i=1 warps 250 → 250 (already on boundary).
  //   stepped@i=0 range gate against original 250 (in [200,400]) → passes;
  //   stepped@i=0 warps 250 → 200.
  // Pre-fix would still pass since t=250 also in range. So this test
  // can't catch the bug.
  //
  // Construct a case where the warp pushes t OUTSIDE modifier-2's range:
  // stack = [
  //   limits(useRestrictedRange, sfra=600, efra=800, useMinX, minX=700),
  //   stepped(stepSize=100, offset=0)
  // ]
  // Original evaltime = 650:
  //   Reverse walk: stepped@i=1 warps 650 → 600.
  //   limits@i=0 range gate:
  //     Post-fix (audit-fix HIGH-2): check original 650 ∈ [600,800] → in range → apply.
  //       limits warps t=600 → minX=700 → final t=700.
  //     Pre-fix: check warped 600 ∈ [600,800] → still in range → also applies.
  //       (Bug doesn't trigger here either — boundary equal.)
  //
  // The bug triggers when the warp pushes t OUT of [sfra, efra]:
  // Original = 750, sfra=700, efra=800. Stepped warps 750 → 700.
  // Post-fix: check original 750 ∈ [700,800] → in range → apply limits.
  // Pre-fix: check warped 700 ∈ [700,800] → also in range → SAME result.
  //
  // The simplest case where the bug bites: stepped warps t LEFTWARD
  // past modifier-2's lower bound. Stepped stepSize=100, offset=0;
  // limits sfra=600, efra=800. Original = 650; stepped warps to 600.
  // limits gate against 600: in [600,800] → in range. Original 650 also
  // in [600,800] → both check pass. Still no bug visible.
  //
  // OK final construction:
  // stack = [
  //   stepped (NOT range-restricted) — warps t leftward,
  //   limits(useRestrictedRange, sfra=620, efra=800, useMinX, minX=900)
  // ]
  // Original = 650. Reverse walk:
  //   limits@i=1: range gate (use original 650, in [620,800]) → apply;
  //               limits warps t=650 → minX=900.
  //   stepped@i=0: warps 900 → 900 (on boundary at offset=0).
  // Post-fix: final t = 900.
  // Pre-fix: range gate against 650 (same as warped here since limits is
  //   processed first in reverse) → same result.
  //
  // The bug requires that modifier-A (later in array, processed earlier
  // in reverse walk) warps t SUCH THAT modifier-B (earlier in array,
  // processed later in reverse walk) sees a DIFFERENT range-membership
  // for t-vs-evaltime:
  //
  // stack = [
  //   limits(useRestrictedRange, sfra=600, efra=800, useMaxX, maxX=750),  // index 0
  //   limits(useMinX, minX=500)                                            // index 1, NOT range-restricted
  // ]
  // Original = 400. Reverse walk:
  //   limits@i=1: not range-restricted; clamps minX=500 → t=500.
  //   limits@i=0: range gate -- check ORIGINAL 400, NOT in [600,800] → SKIP.
  //                Pre-fix: check WARPED 500, NOT in [600,800] → ALSO SKIP.
  //                Same outcome.
  //
  // Try again with stepped warping RIGHTWARD into range:
  // stack = [
  //   limits(useRestrictedRange, sfra=600, efra=800, useMaxY irrelevant -- use minX=900),  // index 0
  //   stepped(stepSize=300, offset=0)                                                       // index 1
  // ]
  // Original = 400. Reverse walk:
  //   stepped@i=1: warps 400 → trunc(400/300)*300 = 1*300 = 300; t=300.
  //   limits@i=0: range gate against ORIGINAL 400; NOT in [600,800] → SKIP.
  //                Pre-fix: range gate against WARPED 300; NOT in [600,800] → ALSO SKIP.
  //                Same.
  //
  // Try stepped warping FROM in-range TO out-of-range:
  // Original = 700. Reverse walk:
  //   stepped@i=1: warps 700 → 2*300=600; t=600.
  //   limits@i=0: range gate against ORIGINAL 700 → in [600,800] → APPLY,
  //                clamp to minX=900; t=900.
  //                Pre-fix: range gate against WARPED 600 → in [600,800] → ALSO APPLY,
  //                clamp to minX=900; t=900.
  //                Same outcome.
  //
  // The bug manifests when stepped warps t IN→OUT of range:
  // Original = 700, stepSize=200, offset=0:
  //   stepped warps 700 → trunc(700/200)*200 = 3*200 = 600.
  //   Original 700 ∈ [600, 800]. Warped 600 ∈ [600, 800]. Boundary identical.
  //
  // OK, let me construct one that ACTUALLY triggers:
  // stack = [
  //   limits(useRestrictedRange, sfra=700, efra=800, useMinY irrelevant -- use minX=900),  // index 0
  //   stepped(stepSize=200, offset=0)                                                       // index 1
  // ]
  // Original = 750. Reverse walk:
  //   stepped@i=1 warps 750 → 600. t=600.
  //   limits@i=0 range gate:
  //     Post-fix: check ORIGINAL 750 ∈ [700,800] → APPLY → t clamped to 900.
  //     Pre-fix: check WARPED 600 ∈ [700,800]? NO → SKIP → t stays 600.
  //   So pre-fix returns 600, post-fix returns 900. DIVERGENCE!
  const mods = [
    { id: 'l', type: 'limits', useRestrictedRange: true,
      sfra: 700, efra: 800,
      data: { useMinX: true, minX: 900 } },
    { id: 's', type: 'stepped', data: { stepSize: 200, offset: 0 } },
  ];
  const r = evaluateTimeModifiers(mods, null, 750);
  eq(r.effectiveTime, 900,
    '42b: range gate checks ORIGINAL evaltime (750 in [700,800]) — limits applies despite stepped warp pushing t to 600 (audit-fix 3.B HIGH-2)');
}

// ── 43. evaluateTimeModifiers: cycles passes cycyofs via scratch ────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  const mods = [{ id: 'c1', type: 'cycles', data: { after: 'repeat_offset', afterCycles: 0 } }];
  const r = evaluateTimeModifiers(mods, fc, 1500);
  // Index-keyed scratch (audit-fix 3.B MED-1): scratch[0] for the
  // cycles modifier at array index 0.
  assert(Array.isArray(r.scratch) && r.scratch.length === 1, '43a: scratch is length-1 array');
  approx(r.scratch[0].cycyofs, 100, '43b: scratch[0].cycyofs=100');
}

// ===========================================================================
// Two-pass dispatcher: value pass (forward walk)
// ===========================================================================

// ── 44. evaluateValueModifiers: empty → unchanged ───────────────────
{
  eq(evaluateValueModifiers([], null, 42, 500, new Map()), 42, '44: empty → unchanged');
}

// ── 45. evaluateValueModifiers: generator overrides cvalue ──────────
{
  const mods = [{ id: 'g', type: 'generator',
    data: { coefficients: [10] /* constant 10 */ } }];
  approx(evaluateValueModifiers(mods, null, 42, 0, new Map()), 10,
    '45: generator non-additive replaces cvalue');
}

// ── 46. evaluateValueModifiers: forward walk order ──────────────────
{
  // Stack: [generator(=10), limits(maxY=5)]
  // Forward: generator first (cvalue=10), then limits (10 > 5 → 5)
  const mods = [
    { id: 'g', type: 'generator', data: { coefficients: [10] } },
    { id: 'l', type: 'limits', data: { useMaxY: true, maxY: 5 } },
  ];
  approx(evaluateValueModifiers(mods, null, 0, 0, new Map()), 5,
    '46: forward walk — generator then limits');
}

// ── 47. evaluateValueModifiers: influence blend ─────────────────────
{
  // Generator replaces cvalue=0 with 10; with influence 0.5, result is
  // interpf(10, 0, 0.5) = 10*0.5 + 0*0.5 = 5
  const mods = [{ id: 'g', type: 'generator',
    data: { coefficients: [10] }, useInfluence: true, influence: 0.5 }];
  approx(evaluateValueModifiers(mods, null, 0, 0, new Map()), 5,
    '47: influence=0.5 blends 50/50');
}

// ── 48. evaluateValueModifiers: cycles reads cycyofs from scratch ───
{
  // Index-keyed scratch (audit-fix 3.B MED-1): scratch is an array
  // indexed by modifier position.
  const scratch = [{ cycyofs: 7 }];
  const mods = [{ id: 'c1', type: 'cycles', data: {} }];
  approx(evaluateValueModifiers(mods, null, 100, 0, scratch), 107,
    '48: value pass adds cycyofs from scratch[i]');
}

// ── 48b. Index-keyed scratch survives missing id (audit-fix 3.B MED-1) ─
{
  // Same as above but the cycles modifier has NO id; pre-audit-fix this
  // would silently drop the cycyofs handoff (id-keyed Map.get(undefined)
  // returns undefined). Post-fix uses positional indexing so id is
  // irrelevant.
  const scratch = [{ cycyofs: 13 }];
  const mods = [{ type: 'cycles', data: {} }];
  approx(evaluateValueModifiers(mods, null, 100, 0, scratch), 113,
    '48b: missing id no longer drops cycyofs (positional storage)');
}

// ── 48c. evaluateFCurve: cycles with missing id still cascades cycyofs ─
{
  // End-to-end regression test for MED-1: cycles repeat_offset without
  // an id field. Pre-fix this would silently zero out the per-cycle
  // Y-offset; post-fix it propagates correctly through positional
  // scratch.
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    // No `id` on the modifier.
    modifiers: [{ type: 'cycles', data: { after: 'repeat_offset', afterCycles: 0 } }],
  };
  // t=1500: time pass maps to 500 + cycyofs=100; sample(500)=50; +100=150
  approx(evaluateFCurve(fc, 1500), 150,
    '48c: repeat_offset cycles cascades cycyofs even without id (audit-fix 3.B MED-1)');
}

// ===========================================================================
// Stack entry point + evaluateFCurve integration
// ===========================================================================

// ── 49. evaluateFModifierStack composes time + value passes ─────────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  const mods = [{ id: 'c1', type: 'cycles', data: { after: 'repeat', afterCycles: 0 } }];
  const sample = (f, t) => {
    const ks = f.keyforms;
    if (t <= ks[0].time) return ks[0].value;
    if (t >= ks[ks.length - 1].time) return ks[ks.length - 1].value;
    return (t / 1000) * 100; // linear lerp 0..100
  };
  // t=1500 → time pass cycles to 500 → sample(500) = 50
  approx(evaluateFModifierStack(mods, fc, sample, 1500), 50,
    '49: stack composes time + value passes');
}

// ── 50. evaluateFCurve: no modifiers → backward compat ──────────────
{
  const fc = { keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }] };
  approx(evaluateFCurve(fc, 500), 50, '50: no modifiers → linear lerp unchanged');
}

// ── 51. evaluateFCurve: cycles repeats ──────────────────────────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 'c1', type: 'cycles', data: { after: 'repeat', afterCycles: 0 } }],
  };
  approx(evaluateFCurve(fc, 1500), 50, '51a: cycles repeat 1500→500→50');
  approx(evaluateFCurve(fc, 2300), 30, '51b: cycles repeat 2300→300→30');
}

// ── 52. evaluateFCurve: limits clamps Y ─────────────────────────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 'l', type: 'limits', data: { useMaxY: true, maxY: 50 } }],
  };
  approx(evaluateFCurve(fc, 800), 50, '52: limits clamps 80 → 50');
}

// ── 53. evaluateFCurve: generator replaces sampled value ────────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 'g', type: 'generator',
      data: { mode: 'polynomial', coefficients: [10] } }],
  };
  approx(evaluateFCurve(fc, 500), 10, '53: generator replaces sample');
}

// ── 54. evaluateFCurve: generator additive sums with sample ─────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 'g', type: 'generator',
      data: { mode: 'polynomial', coefficients: [10], additive: true } }],
  };
  approx(evaluateFCurve(fc, 500), 60, '54: 50 + 10 = 60');
}

// ── 55. evaluateFCurve: stepped warps time before sample ────────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 's', type: 'stepped', data: { stepSize: 100, offset: 0 } }],
  };
  // t=270 → stepped to 200 → sample(200) = 20
  approx(evaluateFCurve(fc, 270), 20, '55: stepped 270→200→20');
}

// ── 56. evaluateFCurve: muted modifier is bypassed ──────────────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 'g', type: 'generator',
      data: { coefficients: [999] }, muted: true }],
  };
  approx(evaluateFCurve(fc, 500), 50, '56: muted modifier doesn\'t apply');
}

// ── 57. evaluateFCurve: noise produces non-keyframe value ───────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 0 }],
    modifiers: [{ id: 'n', type: 'noise', data: { size: 200, strength: 10, phase: 1 } }],
  };
  const a = evaluateFCurve(fc, 500);
  const b = evaluateFCurve(fc, 500);
  eq(a, b, '57a: noise is deterministic across calls');
  assert(a !== 0, '57b: noise produces non-zero (keyframe value would be 0)');
}

// ── 58. evaluateFCurve: driver overrides modifier output ────────────
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 'g', type: 'generator', data: { coefficients: [999] } }],
    driver: { type: 'scripted', variables: [], expression: '42' },
  };
  approx(evaluateFCurve(fc, 500), 42,
    '58: driver wins over modifier output');
}

// ── 59. evaluateFCurve: malformed modifier (unknown type) skipped ──
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{ id: 'x', type: 'function_generator' /* deferred type */, data: {} }],
  };
  approx(evaluateFCurve(fc, 500), 50, '59: unknown type → skipped, sample wins');
}

// ── 60. evaluateFCurve: empty modifiers array → no behavior change ──
{
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [],
  };
  approx(evaluateFCurve(fc, 500), 50, '60: empty modifiers → identity');
}

// ── 3.F gap-fills (added 2026-05-18) ──────────────────────────────────────

// ── 61. Generator degree 0 (constant): single coefficient ──────────────
{
  // poly with one coefficient = degree 0 = constant output. Replaces
  // sampled value when additive=false.
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{
      type: 'generator', id: 'g1',
      data: { mode: 'polynomial', coefficients: [42], additive: false },
    }],
  };
  approx(evaluateFCurve(fc, 500), 42,
    '61: generator degree-0 constant replaces sampled value');
  // factorised mode with one coefficient — degree 0 = floor(1/2) = 0 pairs.
  // No pairs → product stays at initial 1 → multiplied by 0 baseline = 0,
  // or replaces value with `value * 1 = ... wait, additive=false means
  // cvalue = generated, so output = 1 (the initial product).
  // Actually let me re-check: factorised value starts at 1, iterates
  // PAIRS, never iterates because length<2 → returns 1.
  const fcFact = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 100 }],
    modifiers: [{
      type: 'generator', id: 'g2',
      data: { mode: 'polynomial_factorised', coefficients: [99], additive: false },
    }],
  };
  approx(evaluateFCurve(fcFact, 500), 1,
    '61a: factorised generator with single unpaired coefficient returns 1 (no pairs iterated)');
}

// ── 62. Noise frequency response — different `size` produces different output ─
{
  // size is the Perlin period in ms. size=10 (high frequency) and
  // size=1000 (low frequency) over the same time domain produce
  // distinguishable outputs (the high-frequency noise oscillates more).
  const fcHigh = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 0 }],
    modifiers: [{ type: 'noise', id: 'n1',
      data: { size: 10, strength: 1, phase: 1, blendType: 'replace' } }],
  };
  const fcLow = {
    keyforms: [{ time: 0, value: 0 }, { time: 1000, value: 0 }],
    modifiers: [{ type: 'noise', id: 'n2',
      data: { size: 1000, strength: 1, phase: 1, blendType: 'replace' } }],
  };
  // Sample at 16 positions across 0..1000ms; count how often consecutive
  // samples have different signs (zero-crossings = oscillation frequency).
  let highCrossings = 0;
  let lowCrossings = 0;
  let prevHigh = evaluateFCurve(fcHigh, 0);
  let prevLow = evaluateFCurve(fcLow, 0);
  for (let i = 1; i <= 16; i++) {
    const t = (i * 1000) / 16;
    const vh = evaluateFCurve(fcHigh, t);
    const vl = evaluateFCurve(fcLow, t);
    if ((vh < 0) !== (prevHigh < 0)) highCrossings++;
    if ((vl < 0) !== (prevLow < 0)) lowCrossings++;
    prevHigh = vh;
    prevLow = vl;
  }
  // High-frequency noise should cross zero more often than low-frequency.
  // We don't pin exact counts (depends on phase + Perlin internals) —
  // just that "different size ⇒ different observable structure".
  if (highCrossings === lowCrossings) {
    failed++;
    const msg = `62: noise frequency response — size variation produced same crossing count (${highCrossings} both); expected diverging`;
    failures.push(msg);
    console.log(`FAIL: ${msg}`);
  } else {
    passed++;
  }
}

// ── 63. Cycles + Noise + Limits 3-way composition (plan §3.F target) ───
{
  // Single fcurve carries Cycles (head) + Noise + Limits. Per the
  // forward-walk value pass (fmodifier.cc:1568-1569) the order is
  // Cycles-time → sample → Cycles-value(+cycyofs) → Noise → Limits.
  // Limits.maxY=0.6 caps the final output regardless of Noise additions.
  const fc = {
    keyforms: [{ time: 0, value: 0 }, { time: 100, value: 1 }],
    modifiers: [
      { type: 'cycles', id: 'c1', data: { after: 'repeat' } },
      { type: 'noise', id: 'n1',
        data: { size: 50, strength: 0.5, phase: 1, blendType: 'add' } },
      { type: 'limits', id: 'l1',
        data: { useMaxY: true, maxY: 0.6 } },
    ],
  };
  // Sample at 8 positions across 0..500ms (cycle period=100ms, so 5 cycles).
  let maxObserved = -Infinity;
  for (let i = 0; i <= 8; i++) {
    const t = (i * 500) / 8;
    const v = evaluateFCurve(fc, t);
    if (v > maxObserved) maxObserved = v;
  }
  // Limits MUST clamp every output to ≤ 0.6.
  if (maxObserved > 0.6001) {
    failed++;
    const msg = `63: 3-way composition — Limits clamp violated (max=${maxObserved.toFixed(4)} > 0.6)`;
    failures.push(msg);
    console.log(`FAIL: ${msg}`);
  } else {
    passed++;
  }
}

console.log(`\nfmodifiers: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
