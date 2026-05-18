// Animation Phase 3 Slice 3.F — FModifier export-bake byte-identity gate.
//
// Plan §3.F:
//   > test_fmodifiers_export_bake.mjs — Noise baked at export,
//   > byte-identical to a hand-baked motion3
//
// What this test gates:
//   - generateMotion3Json's bake helper produces segment arrays
//     byte-identical to a manually-constructed hand-bake using the
//     same FPS cadence + the same eval pipeline.
//   - No fp drift, no off-by-one in sample positions, no accidental
//     rounding, no spurious metadata.
//   - Determinism across reconstruction: building the action twice +
//     exporting twice yields literally-equal segment arrays.
//
// What this test does NOT gate (audit-fix 3.F LOW-2):
//   - Blender-fidelity of the eval substrate. handBake calls
//     evaluateFCurve which calls SS's own evaluateNoiseValue /
//     evaluateCyclesTime / etc. Byte-identity here proves the bake
//     helper is faithful to that pipeline; it does NOT prove the
//     pipeline matches Blender. The Blender-fidelity gate lives in
//     test_fmodifiers.mjs (102+ asserts pinning each per-type evaluator
//     against fmodifier.cc semantics) and test_actionExportMotion3.mjs
//     (action-level shape).
//
// Why a dedicated file:
//   - test_motion3jsonNoiseExport.mjs §6 pins cross-run determinism but
//     not byte-identity to a HAND-BAKE — that's a stronger property
//     (the bake helper might add side effects beyond the eval pipeline).
//   - This is the plan §3.F exit gate for the export-bake substrate.
//
// Sister tests:
//   - test_fmodifiers.mjs — evaluator substrate (102 asserts, all 6 types)
//   - test_motion3jsonNoiseExport.mjs — Noise bake gate matrix (26 asserts)
//   - test_motion3jsonCyclesExport.mjs — Cycles bake gate matrix (42 asserts)
//
// Run: node scripts/test/test_fmodifiers_export_bake.mjs

import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';
import { evaluateFCurve } from '../../src/anim/fcurve.js';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  failures.push(name);
  console.error(`FAIL: ${name}`);
}
function assertEq(actual, expected, name) {
  if (actual === expected) { passed++; return; }
  failed++;
  failures.push(`${name}\n  actual:   ${actual}\n  expected: ${expected}`);
  console.error(`FAIL: ${name}\n  actual:   ${actual}\n  expected: ${expected}`);
}

/**
 * Hand-bake derivation that mirrors `bakeFCurveModifiers` exactly:
 *   stepMs = 1000 / fps
 *   sampleCount = floor(durationMs / stepMs) + 1
 *   sample i at time = i * stepMs (clamped to durationMs for the last one)
 *
 * Returns the expected motion3 segment array as if encoded from the
 * baked linear keyforms.
 *
 * INVARIANT (audit-fix 3.F MED-1): the first sample's time is always
 * `0` because `bakeFCurveModifiers` always starts sampling at `i=0 →
 * time = 0 * stepMs = 0`. If a future refactor changes the bake start
 * offset (e.g. aligning to the first keyform's time, or skipping the
 * t=0 sample), `handBake` here must be updated in lockstep — the
 * `firstMismatch` check below silently identifies the first divergent
 * index but doesn't flag a semantic regression at the first sample.
 */
function handBake(fcurve, durationMs, fps) {
  const stepMs = 1000 / fps;
  const sampleCount = Math.floor(durationMs / stepMs) + 1;
  const segs = [];
  // First sample at t=0 (bake-spec invariant; see JSDoc).
  const t0 = 0;
  const v0 = evaluateFCurve(fcurve, t0);
  segs.push(t0 / 1000, v0);
  // Subsequent samples become linear (type-0) segments.
  for (let i = 1; i < sampleCount; i++) {
    const time = (i === sampleCount - 1) ? durationMs : i * stepMs;
    const value = evaluateFCurve(fcurve, time);
    segs.push(0, time / 1000, value);
  }
  return segs;
}

function paramFcurve(paramId, kfs, modifiers) {
  const fc = {
    id: `param:${paramId}`,
    rnaPath: `objects["__params__"].values["${paramId}"]`,
    keyforms: kfs.map((k) => ({
      easing: 'linear', type: 'linear', interpolation: 'linear',
      ...k,
    })),
  };
  if (modifiers) fc.modifiers = modifiers;
  return fc;
}

function makeAction(props = {}) {
  return {
    id: 'a', name: 'A', fps: 30, duration: 1000, audioTracks: [],
    fcurves: [], meta: {}, flag: 0,
    ...props,
  };
}

// Strict byte-identity comparison. Returns -1 if equal, else first
// mismatch index for diagnostics.
function firstMismatch(a, b) {
  if (a.length !== b.length) return -2;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return -1;
}

// ── 1. Noise-only bake byte-identical to hand-bake ────────────────────────
{
  const fcurve = paramFcurve('P',
    [{ time: 0, value: 0 }, { time: 1000, value: 1 }],
    [{ type: 'noise', data: {
      size: 100, strength: 0.5, phase: 1, offset: 0,
      depth: 0, lacunarity: 2, roughness: 0.5,
      blendType: 'add',
    } }]);
  const action = makeAction({ fps: 30, duration: 1000, fcurves: [fcurve] });
  const expected = handBake(fcurve, 1000, 30);
  const actual = generateMotion3Json(action).Curves[0].Segments;
  const mismatch = firstMismatch(expected, actual);
  if (mismatch === -2) {
    failed++;
    const msg = `1: Noise bake — length mismatch (expected ${expected.length}, got ${actual.length})`;
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  } else if (mismatch >= 0) {
    failed++;
    const msg = `1: Noise bake — value mismatch at idx ${mismatch} (expected ${expected[mismatch]}, got ${actual[mismatch]})`;
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  } else {
    passed++;
  }
}

// ── 2. Cycles-bake byte-identical to hand-bake ────────────────────────────
{
  // Cycles bake fires when action isn't uniformly looping → use a
  // mixed action (Cycles fcurve + non-cycling sibling) to force the gate.
  const cycleFc = paramFcurve('Looping',
    [{ time: 0, value: 0 }, { time: 250, value: 1 }],
    [{ type: 'cycles', data: { after: 'repeat' } }]);
  const staticFc = paramFcurve('Static',
    [{ time: 0, value: 0 }, { time: 500, value: 1 }]);
  const action = makeAction({
    fps: 30, duration: 500, fcurves: [cycleFc, staticFc],
  });
  const expected = handBake(cycleFc, 500, 30);
  const m = generateMotion3Json(action);
  const actual = m.Curves.find((c) => c.Id === 'Looping').Segments;
  const mismatch = firstMismatch(expected, actual);
  if (mismatch === -2) {
    failed++;
    const msg = `2: Cycles bake — length mismatch (expected ${expected.length}, got ${actual.length})`;
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  } else if (mismatch >= 0) {
    failed++;
    const msg = `2: Cycles bake — value mismatch at idx ${mismatch} (expected ${expected[mismatch]}, got ${actual[mismatch]})`;
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  } else {
    passed++;
  }
}

// ── 3. Cycles + Noise composition byte-identical to hand-bake ────────────
{
  // Cycles + Noise on the SAME fcurve. Per 3.E, Noise triggers bake
  // regardless of Loop. Hand-bake must apply both modifiers (forward-
  // walk value pass per fmodifier.cc:1567-1569) — Cycles via time pass
  // first (reverse walk fmodifier.cc:1515-1517), then Noise on the
  // cycled value.
  const fc = paramFcurve('CycNoise',
    [{ time: 0, value: 0 }, { time: 100, value: 1 }],
    [
      { type: 'cycles', data: { after: 'repeat' } },
      { type: 'noise', data: {
        size: 50, strength: 0.3, phase: 2, blendType: 'add',
      } },
    ]);
  // Uniform-loop predicate satisfied (only one fcurve, has cycle),
  // so Loop=true. Noise trigger still fires bake on this fcurve.
  const action = makeAction({ fps: 30, duration: 500, fcurves: [fc] });
  const expected = handBake(fc, 500, 30);
  const m = generateMotion3Json(action);
  assertEq(m.Meta.Loop, true,
    '3: uniform-Cycles single-fcurve action → Loop=true');
  const actual = m.Curves[0].Segments;
  const mismatch = firstMismatch(expected, actual);
  if (mismatch === -2) {
    failed++;
    const msg = `3a: Cycles+Noise bake — length mismatch (expected ${expected.length}, got ${actual.length})`;
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  } else if (mismatch >= 0) {
    failed++;
    const msg = `3a: Cycles+Noise bake — value mismatch at idx ${mismatch} (expected ${expected[mismatch]}, got ${actual[mismatch]})`;
    failures.push(msg);
    console.error(`FAIL: ${msg}`);
  } else {
    passed++;
  }
}

// ── 4. Bake survives all 4 Noise blend types byte-identically ────────────
{
  for (const blendType of ['replace', 'add', 'subtract', 'multiply']) {
    const fc = paramFcurve(`P_${blendType}`,
      [{ time: 0, value: 0.5 }, { time: 500, value: 0.5 }],
      [{ type: 'noise', data: {
        size: 100, strength: 0.4, phase: 3, blendType,
      } }]);
    const action = makeAction({ fps: 30, duration: 500, fcurves: [fc] });
    const expected = handBake(fc, 500, 30);
    const actual = generateMotion3Json(action).Curves[0].Segments;
    const mismatch = firstMismatch(expected, actual);
    if (mismatch !== -1) {
      failed++;
      const msg = `4 (blendType=${blendType}): mismatch at idx ${mismatch}`;
      failures.push(msg);
      console.error(`FAIL: ${msg}`);
    } else {
      passed++;
    }
  }
}

// ── 5. Bake byte-identical across two separate export passes ─────────────
{
  // Determinism: same action → same export. This is the property
  // test_motion3jsonNoiseExport §6 also asserts, repeated here in
  // hand-bake-reference form so the byte-identity gate catches any
  // future bake-helper code path that introduces non-determinism.
  const fc = paramFcurve('P',
    [{ time: 0, value: 0 }, { time: 500, value: 1 }],
    [{ type: 'noise', data: {
      size: 100, strength: 0.7, phase: 5, blendType: 'add',
    } }]);
  const action = makeAction({ fps: 30, duration: 500, fcurves: [fc] });
  const expected = handBake(fc, 500, 30);
  const s1 = generateMotion3Json(action).Curves[0].Segments;
  const s2 = generateMotion3Json(action).Curves[0].Segments;
  assertEq(firstMismatch(expected, s1), -1,
    '5: run-1 matches hand-bake byte-for-byte');
  assertEq(firstMismatch(expected, s2), -1,
    '5a: run-2 matches hand-bake byte-for-byte');
  assertEq(firstMismatch(s1, s2), -1,
    '5b: run-1 and run-2 byte-identical (cross-run determinism)');
}

// ── 6. Bake byte-identical across different FPS values ───────────────────
{
  // FPS controls bake cadence. Each FPS produces a distinct segment
  // count, but for any given FPS the bake must match hand-bake.
  for (const fps of [24, 30, 60]) {
    const fc = paramFcurve(`P_${fps}`,
      [{ time: 0, value: 0 }, { time: 200, value: 1 }],
      [{ type: 'noise', data: {
        size: 50, strength: 0.3, phase: 4, blendType: 'add',
      } }]);
    const action = makeAction({ fps, duration: 200, fcurves: [fc] });
    const expected = handBake(fc, 200, fps);
    const actual = generateMotion3Json(action).Curves[0].Segments;
    const mismatch = firstMismatch(expected, actual);
    if (mismatch !== -1) {
      failed++;
      const msg = `6 (fps=${fps}): mismatch at idx ${mismatch} (expected len=${expected.length}, actual len=${actual.length})`;
      failures.push(msg);
      console.error(`FAIL: ${msg}`);
    } else {
      passed++;
    }
  }
}

// ── 7. Last-sample clamp to durationMs is byte-identical ─────────────────
{
  // Construct an action whose duration doesn't land on an FPS step
  // boundary — the last sample must clamp to exactly durationMs (not
  // step*N which would overshoot). Hand-bake applies the same clamp;
  // byte-identity proves the clamp arithmetic matches.
  const fc = paramFcurve('P',
    [{ time: 0, value: 0 }, { time: 333, value: 1 }],
    [{ type: 'noise', data: { size: 100, strength: 0.5, phase: 6 } }]);
  // 333 / (1000/30) = 333 / 33.333... = 9.99 → floor + 1 = 10 samples
  // Last sample i=9 would land at 9*33.33=300; the clamp pulls it to 333.
  const action = makeAction({ fps: 30, duration: 333, fcurves: [fc] });
  const expected = handBake(fc, 333, 30);
  const actual = generateMotion3Json(action).Curves[0].Segments;
  assertEq(firstMismatch(expected, actual), -1,
    '7: non-aligned duration — clamp arithmetic byte-identical');
  // Sanity: the last segment's time field equals durationMs/1000.
  const lastTimeIdx = actual.length - 2; // [type, time, value] tuple at end
  const lastTime = actual[lastTimeIdx];
  assertEq(lastTime, 0.333,
    '7a: last baked sample time = duration / 1000 exactly');
}

// ── 8. Driver-bearing fcurve: bake folds driver in (audit-fix 3.D H-1) ──
{
  // Audit-fix 3.D H-1 stripped `driver` from the baked clone alongside
  // `modifiers`. Hand-bake calls evaluateFCurve which DOES apply the
  // driver. Byte-identity proves the bake helper applies the driver
  // BEFORE stripping it — not after.
  const fc = paramFcurve('P',
    [{ time: 0, value: 0 }, { time: 500, value: 1 }],
    [{ type: 'noise', data: { size: 100, strength: 0.5, phase: 7 } }]);
  fc.driver = {
    type: 'scripted',
    expression: '42',
    variables: [],
  };
  const action = makeAction({ fps: 30, duration: 500, fcurves: [fc] });
  const expected = handBake(fc, 500, 30);
  const actual = generateMotion3Json(action).Curves[0].Segments;
  assertEq(firstMismatch(expected, actual), -1,
    '8: driver-bearing bake byte-identical (driver applied before strip)');
  // Sanity sweep: the driver returns 42, so EVERY baked value should
  // be 42 (driver overrides modifier output per evaluateFCurve:208-217).
  // Audit-fix 3.F LOW-1: walk the segment array properly instead of
  // checking only segs[1]. Segment shape: [t0, v0, type1, t1, v1, type2, t2, v2, ...]
  // — first sample at indices 0/1, every subsequent triplet at 2+3k/3+3k/4+3k.
  let allValuesAre42 = (actual[1] === 42);
  for (let k = 0; (2 + 3 * k + 2) < actual.length; k++) {
    if (actual[2 + 3 * k + 2] !== 42) { allValuesAre42 = false; break; }
  }
  assert(allValuesAre42,
    `8a: every baked sample value equals driver output (42); got first non-42 in segments array`);
}

console.log(`fmodifiers_export_bake: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailures (${failed}):`);
  for (const f of failures) console.error(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
