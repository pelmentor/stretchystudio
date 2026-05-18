// Animation Phase 3 Slice 3.D — Cycles → motion3.json Meta.Loop + per-fcurve bake.
//
// Plan §3.D maps Cycles FModifier to Cubism's `Meta.Loop`:
//   - All fcurves in action have head-of-stack Cycles with
//     {before='none', after='repeat', afterCycles=0} → Loop=true; keyforms
//     ship as-is (no bake).
//   - Mix (some cycle, some don't) → Loop=false; cycling fcurves baked
//     via `evaluateFCurve` (the bake helper applies the full FModifier
//     stack as a side effect).
//   - No Cycles anywhere → Loop=false.
//
// This file owns the detailed Cycles+bake matrix. Lighter sister-coverage
// (the high-level "Loop changes when modifier present") lives in
// test_actionExportMotion3.mjs §5. The roundtrip helper test
// (Loop=true → Cycles → re-export Loop=true) lives in
// test_motion3jsonCyclesRoundtrip below.
//
// Run: node scripts/test/test_motion3jsonCyclesExport.mjs

import { generateMotion3Json } from '../../src/io/live2d/motion3json.js';
import { parseMotion3Json } from '../../src/io/live2d/motion3jsonImport.js';

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
function near(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }

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

// ── 1. Empty action → Loop=false (no signal, no fallback) ─────────────────
{
  const m = generateMotion3Json(makeAction({ fcurves: [] }));
  assertEq(m.Meta.Loop, false,
    '1: empty action → Loop=false (no Cycles signal, no legacy fallback)');
  assertEq(m.Curves.length, 0, '1a: no curves');
}

// ── 2. Single fcurve, no Cycles → Loop=false ──────────────────────────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P', [{ time: 0, value: 0 }, { time: 500, value: 1 }])],
  }));
  assertEq(m.Meta.Loop, false, '2: no Cycles modifier → Loop=false');
  assertEq(m.Curves[0].Segments.length, 5, '2a: keyforms ship as-is (2 kfs = 5 floats)');
}

// ── 3. Uniform clean Cycles on all fcurves → Loop=true, no bake ──────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [
      paramFcurve('P',
        [{ time: 0, value: 0 }, { time: 500, value: 1 }],
        [{ type: 'cycles', data: { after: 'repeat', afterCycles: 0 } }]),
      paramFcurve('Q',
        [{ time: 0, value: 2 }, { time: 500, value: 3 }],
        [{ type: 'cycles', data: { after: 'repeat' } }]), // sparse afterCycles=0
    ],
  }));
  assertEq(m.Meta.Loop, true, '3: every fcurve has clean Cycles → Loop=true');
  assertEq(m.Curves[0].Segments.length, 5, '3a: P keyforms ship as-is');
  assertEq(m.Curves[1].Segments.length, 5, '3b: Q keyforms ship as-is');
}

// ── 4. Cycles before='repeat' fails the uniform-loop predicate ────────────
{
  // before='repeat' (not 'none') means the curve also cycles BACKWARD,
  // which Cubism's IsLoop=true does NOT model (Cubism loops are
  // forward-only modulo duration).
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{ type: 'cycles', data: { before: 'repeat', after: 'repeat' } }])],
  }));
  assertEq(m.Meta.Loop, false,
    '4: before=repeat fails uniform predicate (Cubism loops forward-only)');
  // The fcurve has active Cycles → gets baked.
  assert(m.Curves[0].Segments.length > 5,
    '4a: fcurve with non-loop Cycles still gets baked when Loop=false');
}

// ── 5. Mixed: cycling + non-cycling → Loop=false + selective bake ────────
{
  const action = makeAction({
    fps: 30, duration: 500,
    fcurves: [
      paramFcurve('Looping',
        [{ time: 0, value: 0 }, { time: 250, value: 1 }],
        [{ type: 'cycles', data: { after: 'repeat' } }]),
      paramFcurve('Static',
        [{ time: 0, value: 0 }, { time: 500, value: 1 }]),
    ],
  });
  const m = generateMotion3Json(action);
  assertEq(m.Meta.Loop, false, '5: mixed cycling/static → Loop=false');

  const loopingCurve = m.Curves.find((c) => c.Id === 'Looping');
  const staticCurve = m.Curves.find((c) => c.Id === 'Static');
  // Static: 2 keyforms = 5 floats; baked Looping: 30fps × 500ms = ~16 samples.
  assertEq(staticCurve.Segments.length, 5,
    '5a: static fcurve emitted as-is (5 floats for 2 kfs)');
  assert(loopingCurve.Segments.length > 5,
    `5b: looping fcurve baked (got ${loopingCurve.Segments.length} floats)`);

  // The baked Looping curve must reflect the cycle: at t=375ms (= 250ms
  // cycle + 125ms into the next cycle = halfway through cycle 2), the
  // value should be near 0.5 (mid of 0→1 ramp).
  // Decode the segments to find the sample near t=0.375s.
  const segs = loopingCurve.Segments;
  let bestIdx = -1;
  let bestDelta = Infinity;
  // Walk segment array: [t0, v0, type, time, value, type, time, value, ...]
  // First sample at segs[0]/segs[1].
  const samples = [{ t: segs[0], v: segs[1] }];
  let i = 2;
  while (i < segs.length) {
    const type = segs[i++];
    if (type === 1) {
      // Bezier (shouldn't appear in bake output but defensive)
      i += 4;
      samples.push({ t: segs[i], v: segs[i + 1] });
      i += 2;
    } else {
      samples.push({ t: segs[i], v: segs[i + 1] });
      i += 2;
    }
  }
  for (let k = 0; k < samples.length; k++) {
    const d = Math.abs(samples[k].t - 0.375);
    if (d < bestDelta) { bestDelta = d; bestIdx = k; }
  }
  const nearMid = samples[bestIdx];
  // Cycle is 0→1 over 250ms; at 375ms we're at 125ms into the second
  // cycle. The base FCurve at 125ms (linear 0..1 over 0..250ms) = 0.5.
  // Cycles modifier (repeat) carries that value through.
  assert(near(nearMid.v, 0.5, 0.05),
    `5c: baked Looping at t≈0.375s reflects cycle (got value=${nearMid.v}, expected ≈0.5)`);
}

// ── 6. Cycles with afterCycles=N (bounded) → Loop=false + bake ────────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 100, value: 1 }],
      [{ type: 'cycles', data: { after: 'repeat', afterCycles: 2 } }])],
  }));
  assertEq(m.Meta.Loop, false,
    '6: bounded Cycles (afterCycles>0) fails uniform predicate');
  // Bake kicks in; afterCycles=2 means 2 forward cycles then the value
  // holds. Encoder should produce more than the original 2 keyforms.
  assert(m.Curves[0].Segments.length > 5, '6a: bounded Cycles fcurve baked');
}

// ── 7. Muted Cycles modifier doesn't drive Loop OR trigger bake ──────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{ type: 'cycles', muted: true, data: { after: 'repeat' } }])],
  }));
  assertEq(m.Meta.Loop, false, '7: muted Cycles → Loop=false');
  // Muted Cycles → bake gate doesn't fire → keyforms ship as-is.
  assertEq(m.Curves[0].Segments.length, 5,
    '7a: muted Cycles → no bake, keyforms as-is');
}

// ── 8. Range-restricted Cycles doesn't drive Loop OR trigger bake ────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{
        type: 'cycles',
        useRestrictedRange: true,
        sfra: 0, efra: 250,
        data: { after: 'repeat' },
      }])],
  }));
  assertEq(m.Meta.Loop, false,
    '8: range-restricted Cycles → Loop=false (scoped cycle ≠ full loop)');
  assertEq(m.Curves[0].Segments.length, 5,
    '8a: range-restricted Cycles → no bake, keyforms as-is');
}

// ── 9. Disabled Cycles doesn't drive Loop OR trigger bake ────────────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{ type: 'cycles', disabled: true, data: { after: 'repeat' } }])],
  }));
  assertEq(m.Meta.Loop, false, '9: disabled Cycles → Loop=false');
  assertEq(m.Curves[0].Segments.length, 5, '9a: disabled Cycles → no bake');
}

// ── 10. Influence < 1 → Cycles isn't a clean loop signal ─────────────────
{
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [{
        type: 'cycles',
        useInfluence: true,
        influence: 0.5,
        data: { after: 'repeat' },
      }])],
  }));
  assertEq(m.Meta.Loop, false,
    '10: useInfluence<1 → fractional blend ≠ pure loop, Loop=false');
}

// ── 11. Cycles after non-Cycles at index 0 (shouldn't happen per 3.C) ────
{
  // Per 3.C invariant, Cycles must be at modifiers[0]. We test that the
  // exporter checks modifiers[0] specifically — a Cycles at [1] is
  // ignored as a defensive read against malformed data.
  const m = generateMotion3Json(makeAction({
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 500, value: 1 }],
      [
        { type: 'limits', data: { useMin: true, min: 0 } },
        { type: 'cycles', data: { after: 'repeat' } },
      ])],
  }));
  assertEq(m.Meta.Loop, false,
    '11: Cycles not at head-of-stack → not a Loop signal (3.C invariant defended)');
}

// ── 12. mesh_verts fcurve also flows through bake gate ───────────────────
{
  // mesh_verts uses an index-based segment encoding (each keyform becomes
  // an integer index), but the BAKE happens BEFORE the index transform
  // in generateMotion3Json's loop. With a Cycles modifier on the
  // mesh_verts fcurve AND a non-cycling sibling fcurve forcing
  // Loop=false (uniform predicate fails), the bake fires; the baked
  // records then run through the index transform.
  const action = makeAction({
    fps: 30, duration: 250,
    fcurves: [
      {
        id: 'mesh:m1.mesh_verts',
        rnaPath: 'objects["m1"].mesh_verts',
        keyforms: [
          { time: 0, value: 0, interpolation: 'linear' },
          { time: 125, value: 1, interpolation: 'linear' },
        ],
        modifiers: [{ type: 'cycles', data: { after: 'repeat' } }],
      },
      paramFcurve('Static', [{ time: 0, value: 0 }, { time: 250, value: 1 }]),
    ],
  });
  const parameterMap = new Map([['m1.mesh_verts', 'ParamM1']]);
  const m = generateMotion3Json(action, { parameterMap });
  assertEq(m.Meta.Loop, false,
    '12: mesh_verts with Cycles + non-cycling sibling → Loop=false');
  assertEq(m.Curves.length, 2, '12a: 2 curves emitted');
  const meshCurve = m.Curves.find((c) => c.Id === 'ParamM1');
  assert(meshCurve && meshCurve.Segments.length > 5,
    '12b: mesh_verts baked → multi-segment index encoding');
}

// ── 13. Cycles+Limits composition: bake applies BOTH (Limits clamps) ────
{
  // Single fcurve with Cycles+Limits + a sibling non-cycling fcurve.
  // Sibling forces Loop=false (uniform predicate fails), which fires
  // the bake on the Cycles fcurve; the bake calls `evaluateFCurve`
  // which applies the full modifier stack — Cycles + Limits — so the
  // emitted segment values are clamped by Limits.max.
  const m = generateMotion3Json(makeAction({
    fps: 30, duration: 250,
    fcurves: [
      paramFcurve('P',
        [{ time: 0, value: 0 }, { time: 125, value: 10 }],
        [
          { type: 'cycles', data: { after: 'repeat' } },
          { type: 'limits', data: { useMaxY: true, maxY: 5 } },
        ]),
      paramFcurve('Static', [{ time: 0, value: 0 }, { time: 250, value: 1 }]),
    ],
  }));
  assertEq(m.Meta.Loop, false,
    '13: Cycles+Limits with non-cycling sibling → Loop=false (bake fires)');
  // Walk segments of P and find max value — should be ≤ 5 thanks to Limits.
  const pCurve = m.Curves.find((c) => c.Id === 'P');
  const segs = pCurve.Segments;
  let maxV = segs[1]; // first sample value
  let i = 2;
  while (i < segs.length) {
    const type = segs[i++];
    if (type === 1) { i += 4; maxV = Math.max(maxV, segs[i + 1]); i += 2; }
    else { maxV = Math.max(maxV, segs[i + 1]); i += 2; }
  }
  assert(maxV <= 5.0001,
    `13a: Limits applied during bake (max value ${maxV} ≤ 5)`);
}

// ── 14. Round-trip: Loop=true → import → re-export → Loop=true ───────────
{
  // The motion3jsonImport.js companion (3.D) synthesizes a head-of-stack
  // Cycles modifier on every imported fcurve when Meta.Loop=true. This
  // closes the round-trip: a Cubism-authored looping motion that's
  // imported and re-exported preserves Meta.Loop.
  const original = JSON.stringify({
    Version: 3,
    Meta: {
      Duration: 1.0, Fps: 30.0, Loop: true, AreBeziersRestricted: false,
      CurveCount: 2, TotalSegmentCount: 2, TotalPointCount: 4,
      UserDataCount: 0, TotalUserDataSize: 0,
    },
    Curves: [
      { Target: 'Parameter', Id: 'ParamA', Segments: [0, 0, 0, 1.0, 1.0] },
      { Target: 'Parameter', Id: 'ParamB', Segments: [0, 0, 0, 1.0, 0.5] },
    ],
  });
  let counter = 0;
  const { action, warnings } = parseMotion3Json(original, { uid: () => `id_${counter++}` });
  assertEq(warnings.length, 0, '14: no warnings on clean Loop=true import');
  // Both imported fcurves should carry the synthesized Cycles modifier.
  for (const fc of action.fcurves) {
    assert(Array.isArray(fc.modifiers) && fc.modifiers.length === 1
      && fc.modifiers[0].type === 'cycles'
      && fc.modifiers[0].data?.after === 'repeat',
      `14a: imported fcurve ${fc.id} has head-of-stack Cycles {after:'repeat'}`);
  }
  const reExported = generateMotion3Json(action);
  assertEq(reExported.Meta.Loop, true,
    '14b: re-exported motion preserves Meta.Loop=true');
  // Segment count preserved (no bake fired because uniform Cycles).
  assertEq(reExported.Meta.TotalSegmentCount, 2,
    '14c: re-exported preserves segment shape (no bake on uniform loop)');
}

// ── 15. Round-trip: Loop=false (or missing) → import → re-export Loop=false
{
  const original = JSON.stringify({
    Version: 3,
    Meta: {
      Duration: 1.0, Fps: 30.0, Loop: false, AreBeziersRestricted: false,
      CurveCount: 1, TotalSegmentCount: 1, TotalPointCount: 2,
      UserDataCount: 0, TotalUserDataSize: 0,
    },
    Curves: [{ Target: 'Parameter', Id: 'ParamA', Segments: [0, 0, 0, 1.0, 1.0] }],
  });
  let counter = 0;
  const { action } = parseMotion3Json(original, { uid: () => `id_${counter++}` });
  for (const fc of action.fcurves) {
    assert(!fc.modifiers || fc.modifiers.length === 0,
      `15: Loop=false import does NOT synthesize Cycles on ${fc.id}`);
  }
  const reExported = generateMotion3Json(action);
  assertEq(reExported.Meta.Loop, false, '15a: re-export preserves Loop=false');
}

// ── 16. duration=0 edge case (audit-fix M-1: early-return unchanged) ────
{
  // Audit-fix M-1: duration=0 actions early-return the original fcurve
  // unchanged from bakeFCurveModifiers. The previous shape (Math.max(2,
  // ...) floor) produced two coincident keyforms at t=0 — a Rule №1
  // silent-fallback shape. Now: Cycles fcurve survives with its
  // original keyforms, and the segment encoder produces the natural
  // 2-keyform encoding (5 floats).
  const m = generateMotion3Json(makeAction({
    duration: 0,
    fcurves: [
      paramFcurve('P',
        [{ time: 0, value: 0 }, { time: 100, value: 1 }],
        [{ type: 'cycles', data: { after: 'repeat' } }]),
      paramFcurve('Static', [{ time: 0, value: 0 }, { time: 100, value: 1 }]),
    ],
  }));
  assertEq(m.Meta.Loop, false,
    '16: duration=0 mixed action → Loop=false');
  const pCurve = m.Curves.find((c) => c.Id === 'P');
  // P's original 2 keyforms survive (early-return); 5 floats for 2 kfs.
  assertEq(pCurve.Segments.length, 5,
    '16a: duration=0 early-returns original fcurve unchanged (no degenerate bake)');
}

// ── 17. repeat_offset Cycles fires bake (audit-fix H-2 explicit test) ────
{
  // repeat_offset is a valid Blender mode (gradient-offset cycling).
  // It fails the IsLoop predicate (after must be 'repeat', not
  // 'repeat_offset'), so Loop=false and the bake gate fires on the
  // Cycles-present fcurve. The baked samples reflect the
  // gradient-offset waveform via evaluateFCurve.
  const m = generateMotion3Json(makeAction({
    fps: 30, duration: 500,
    fcurves: [paramFcurve('P',
      [{ time: 0, value: 0 }, { time: 100, value: 1 }],
      [{ type: 'cycles', data: { after: 'repeat_offset' } }])],
  }));
  assertEq(m.Meta.Loop, false,
    '17: repeat_offset Cycles → Loop=false (after must be exactly "repeat")');
  // Bake fires: 30fps × 500ms = ~16 samples → >> 5 floats.
  assert(m.Curves[0].Segments.length > 5,
    '17a: repeat_offset Cycles fcurve baked (audit-fix H-2)');
  // Gradient offset: cycle is 0→1 over 0..100ms with delta_y=1 per
  // cycle. At t=200ms (cycle 2 complete) value should be ≈2; at
  // t=350ms (mid cycle 4) value should be ≈3.5.
  const segs = m.Curves[0].Segments;
  // Decode segments to find sample near t=0.35s.
  const samples = [{ t: segs[0], v: segs[1] }];
  let i = 2;
  while (i < segs.length) {
    const type = segs[i++];
    if (type === 1) { i += 4; samples.push({ t: segs[i], v: segs[i + 1] }); i += 2; }
    else { samples.push({ t: segs[i], v: segs[i + 1] }); i += 2; }
  }
  let bestIdx = -1; let bestDelta = Infinity;
  for (let k = 0; k < samples.length; k++) {
    const d = Math.abs(samples[k].t - 0.35);
    if (d < bestDelta) { bestDelta = d; bestIdx = k; }
  }
  assert(samples[bestIdx].v > 2.5,
    `17b: repeat_offset bake produces gradient-increasing values (got ${samples[bestIdx].v} at t≈0.35s, expected > 2.5)`);
}

// ── 18. Importer synthesises Cycles modifier with stable id (audit-fix MED-2)
{
  // Audit-fix MED-2: the synthesised loop-Cycles modifier must carry a
  // stable `id` from the host's uid generator, not undefined. 3.C UI
  // panel keys + future serialisation paths read `modifier.id`.
  let counter = 0;
  const original = JSON.stringify({
    Version: 3,
    Meta: {
      Duration: 1.0, Fps: 30.0, Loop: true, AreBeziersRestricted: false,
      CurveCount: 1, TotalSegmentCount: 1, TotalPointCount: 2,
      UserDataCount: 0, TotalUserDataSize: 0,
    },
    Curves: [{ Target: 'Parameter', Id: 'ParamA', Segments: [0, 0, 0, 1.0, 1.0] }],
  });
  const { action } = parseMotion3Json(original, { uid: () => `synth_id_${counter++}` });
  const synthMod = action.fcurves[0].modifiers[0];
  assert(typeof synthMod.id === 'string' && synthMod.id.length > 0,
    '18: synthesised Cycles modifier carries a string id');
  assert(synthMod.id.startsWith('synth_id_'),
    `18a: synthesised id is minted via opts.uid (got "${synthMod.id}")`);
}

console.log(`motion3jsonCyclesExport: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\nFailures (${failed}):`);
  for (const f of failures) console.error(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
