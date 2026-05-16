// Animation Phase 5 Slice 5.G — tests for src/anim/fcurveMute.js +
// caller-side eval gates (animationFCurve.evaluateActionFCurves +
// depgraph kernel kernelFCurveEval).
//
// Coverage:
//   - isFCurveMuted: sparse-field invariant (true / false / missing /
//     null / undefined / truthy-but-not-true)
//   - toggleFCurveMute: false→true→false; sparse→true
//   - Guard branches: null action, null fcurves array, unknown id
//   - evaluateActionFCurves SKIPS muted curves (rnaPath absent from
//     output map — Blender's `is_fcurve_evaluatable` short-circuit)
//   - kernelFCurveEval returns NaN for muted curves AND does NOT write
//     to ctx.paramOverrides (mirror Blender's animsys_eval_fcurves skip)
//   - Driver eval is gated transitively (muted curve with driver
//     attached does not fire the driver)
//
// Run: node scripts/test/test_fcurveMute.mjs

import { isFCurveMuted, toggleFCurveMute } from '../../src/anim/fcurveMute.js';
import { evaluateActionFCurves } from '../../src/anim/animationFCurve.js';
import { kernelFCurveEval } from '../../src/anim/depgraph/kernels/fcurve.js';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`FAIL: ${name}`);
}

function makeFCurve(id, rnaPath, value) {
  return {
    id,
    rnaPath,
    keyforms: [
      { time: 0,    value,
        handleLeft: { time: 0, value }, handleRight: { time: 0, value },
        handleType: { left: 'vector', right: 'vector' },
        interpolation: 'linear', flag: 0 },
      { time: 1000, value,
        handleLeft: { time: 1000, value }, handleRight: { time: 1000, value },
        handleType: { left: 'vector', right: 'vector' },
        interpolation: 'linear', flag: 0 },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// isFCurveMuted — sparse-field invariant

assert(isFCurveMuted({ mute: true })  === true,  'isFCurveMuted: true');
assert(isFCurveMuted({ mute: false }) === false, 'isFCurveMuted: false');
assert(isFCurveMuted({})              === false, 'isFCurveMuted: missing → false');
assert(isFCurveMuted(null)            === false, 'isFCurveMuted: null');
assert(isFCurveMuted(undefined)       === false, 'isFCurveMuted: undefined');
// Truthy-but-not-true does NOT count (defensive against accidental
// writes of 1 / "yes" / non-boolean values).
assert(isFCurveMuted({ mute: 1 })     === false, 'isFCurveMuted: 1 (truthy) → false');
assert(isFCurveMuted({ mute: 'yes' }) === false, 'isFCurveMuted: "yes" → false');

// ─────────────────────────────────────────────────────────────────────
// toggleFCurveMute — single-curve XOR (no peer interaction)

{
  // Sparse-field starting state → toggle ON.
  const a = { id: 'A', fcurves: [makeFCurve('x', 'objects["__params__"].values["p"]', 1)] };
  const r = toggleFCurveMute(a, 'x');
  assert(r.mutedNow === true,             'toggle sparse→ON: mutedNow=true');
  assert(a.fcurves[0].mute === true,      'toggle sparse→ON: mute=true');
}

{
  // mute:true → toggle OFF.
  const a = { id: 'A', fcurves: [makeFCurve('x', 'objects["__params__"].values["p"]', 1)] };
  a.fcurves[0].mute = true;
  const r = toggleFCurveMute(a, 'x');
  assert(r.mutedNow === false,            'toggle true→OFF: mutedNow=false');
  assert(a.fcurves[0].mute === false,     'toggle true→OFF: mute=false');
}

{
  // mute:false explicit → toggle ON.
  const a = { id: 'A', fcurves: [makeFCurve('x', 'objects["__params__"].values["p"]', 1)] };
  a.fcurves[0].mute = false;
  const r = toggleFCurveMute(a, 'x');
  assert(r.mutedNow === true,             'toggle false→ON: mutedNow=true');
  assert(a.fcurves[0].mute === true,      'toggle false→ON: mute=true');
}

{
  // Peer FCurves untouched.
  const a = {
    id: 'A',
    fcurves: [
      makeFCurve('x', 'objects["__params__"].values["p"]', 1),
      makeFCurve('y', 'objects["__params__"].values["q"]', 2),
      makeFCurve('z', 'objects["__params__"].values["r"]', 3),
    ],
  };
  a.fcurves[1].mute = true; // y starts muted
  toggleFCurveMute(a, 'x'); // toggle x ON
  assert(a.fcurves[0].mute === true,      'peer-isolation: x toggled ON');
  assert(a.fcurves[1].mute === true,      'peer-isolation: y unchanged');
  assert(a.fcurves[2].mute === undefined, 'peer-isolation: z untouched');
}

// ─────────────────────────────────────────────────────────────────────
// Guards

{
  const r = toggleFCurveMute(null, 'x');
  assert(r.mutedNow === false,            'guard: null action');
}

{
  const r = toggleFCurveMute({ fcurves: null }, 'x');
  assert(r.mutedNow === false,            'guard: null fcurves array');
}

{
  const a = { id: 'A', fcurves: [makeFCurve('x', 'objects["__params__"].values["p"]', 1)] };
  const r = toggleFCurveMute(a, 'nonexistent');
  assert(r.mutedNow === false,            'guard: unknown fcurveId');
  assert(a.fcurves[0].mute === undefined, 'guard: peer untouched on unknown id');
}

{
  // Null entries tolerated.
  const a = { id: 'A', fcurves: [null, makeFCurve('y', 'objects["__params__"].values["q"]', 2), null] };
  const r = toggleFCurveMute(a, 'y');
  assert(r.mutedNow === true,             'guard: null entries tolerated');
  assert(a.fcurves[1].mute === true,      'guard: y toggled despite null peers');
}

// ─────────────────────────────────────────────────────────────────────
// evaluateActionFCurves — eval gate at the caller (Blender pattern)
//
// Per `is_fcurve_evaluatable` at `animrig/intern/evaluation.cc:95-111`,
// muted curves are SKIPPED — the bound property keeps its previous
// value. SS surfaces this as "rnaPath absent from the output Map" so
// downstream caller (animationEngine.computeParamOverrides) doesn't
// overwrite the existing value with the FCurve evaluation.
// (Audit-fix HIGH-B1 2026-05-16: was mis-cited as :345-356.)

{
  const action = {
    id: 'A',
    fcurves: [
      makeFCurve('x', 'objects["__params__"].values["p"]', 0.5),
      makeFCurve('y', 'objects["__params__"].values["q"]', 0.7),
    ],
  };
  const m = evaluateActionFCurves(action, 500);
  assert(m.has('objects["__params__"].values["p"]'),  'eval baseline: x present');
  assert(m.has('objects["__params__"].values["q"]'),  'eval baseline: y present');
}

{
  // Mute y → y absent from output map. x still present.
  const action = {
    id: 'A',
    fcurves: [
      makeFCurve('x', 'objects["__params__"].values["p"]', 0.5),
      makeFCurve('y', 'objects["__params__"].values["q"]', 0.7),
    ],
  };
  action.fcurves[1].mute = true;
  const m = evaluateActionFCurves(action, 500);
  assert(m.has('objects["__params__"].values["p"]'),    'eval muted-y: x present');
  assert(!m.has('objects["__params__"].values["q"]'),   'eval muted-y: y SKIPPED');
  assert(m.size === 1,                      'eval muted-y: only 1 entry');
}

{
  // All muted → empty map.
  const action = {
    id: 'A',
    fcurves: [
      makeFCurve('x', 'objects["__params__"].values["p"]', 0.5),
      makeFCurve('y', 'objects["__params__"].values["q"]', 0.7),
    ],
  };
  action.fcurves[0].mute = true;
  action.fcurves[1].mute = true;
  const m = evaluateActionFCurves(action, 500);
  assert(m.size === 0,                    'eval all-muted: empty map');
}

{
  // Driver attached to muted curve → driver does NOT fire (Blender's
  // `BKE_animsys_eval_driver` at `anim_sys.cc:4302` gates on
  // FCURVE_MUTED). SS achieves this transitively: the caller skips the
  // whole `evaluateFCurve` call, which contains the inline driver
  // evaluation step.
  //
  // Audit-fix MED-A3 (Slice 5.G dual-audit 2026-05-16): the prior test
  // used `type: 'AVERAGE'` (uppercase) which falls through evaluateDriver's
  // switch to `default: NaN` WITHOUT ever calling resolveVariables, so
  // the variable-targets side-effect getter never fired — passing
  // whether or not the mute gate existed. Fixed to `type: 'avg'` (SS's
  // recognized lowercase enum) AND moved the getter onto `target.rnaPath`
  // (the field resolveVariables actually reads — `targets[0].id` is
  // legacy Blender shape, not SS's `{target:{rnaPath}}` shape). Both
  // an unmuted positive control + a muted negative control now run, so
  // the test would fail-loud if the eval gate regressed.
  function makeDriverAction() {
    const fired = { value: false };
    const action = {
      id: 'A',
      fcurves: [{
        id: 'd',
        rnaPath: 'objects["__params__"].values["p"]',
        keyforms: [],
        driver: {
          type: 'avg',
          variables: [{
            name: 'v',
            target: {
              get rnaPath() {
                fired.value = true;
                return 'objects["__params__"].values["nope"]';
              },
            },
          }],
          expression: '',
        },
      }],
    };
    return { action, fired };
  }
  // Positive control: UNMUTED → driver MUST fire.
  {
    const { action, fired } = makeDriverAction();
    evaluateActionFCurves(action, 0, { project: { parameters: [], nodes: [] } });
    assert(fired.value === true, 'eval unmuted-w/driver: driver DID fire (control)');
  }
  // Negative case: MUTED → driver MUST NOT fire.
  {
    const { action, fired } = makeDriverAction();
    action.fcurves[0].mute = true;
    evaluateActionFCurves(action, 0, { project: { parameters: [], nodes: [] } });
    assert(fired.value === false, 'eval muted-w/driver: driver did NOT fire');
  }
}

// ─────────────────────────────────────────────────────────────────────
// kernelFCurveEval — single-op eval gate (depgraph kernel)
//
// Mirror: returns NaN AND does NOT write to ctx.paramOverrides when
// the curve is muted. (Pre-Slice 5.G it would have written the
// keyform-evaluated value — silently masking the mute.)

function makeCtx(action) {
  return {
    action,
    timeMs: 500,
    project: { parameters: [{ id: 'p', name: 'p' }], nodes: [] },
    paramOverrides: new Map(),
  };
}

{
  // Baseline: non-muted curve writes its value.
  const fc = makeFCurve('x', 'objects["__params__"].values["p"]', 0.42);
  const ctx = makeCtx({ id: 'A', fcurves: [fc] });
  const v = kernelFCurveEval({ tag: fc.rnaPath }, ctx);
  assert(Number.isFinite(v),                            'kernel baseline: finite return');
  assert(ctx.paramOverrides.has('p'),                   'kernel baseline: wrote p');
  assert(Math.abs(ctx.paramOverrides.get('p') - 0.42) < 1e-9, 'kernel baseline: value=0.42');
}

{
  // Muted curve: returns NaN, does NOT write.
  const fc = makeFCurve('x', 'objects["__params__"].values["p"]', 0.42);
  fc.mute = true;
  const ctx = makeCtx({ id: 'A', fcurves: [fc] });
  const v = kernelFCurveEval({ tag: fc.rnaPath }, ctx);
  assert(Number.isNaN(v),                                'kernel muted: NaN return');
  assert(!ctx.paramOverrides.has('p'),                   'kernel muted: did NOT write p');
}

{
  // Mute toggle takes effect immediately on next eval.
  const fc = makeFCurve('x', 'objects["__params__"].values["p"]', 0.42);
  const ctx1 = makeCtx({ id: 'A', fcurves: [fc] });
  kernelFCurveEval({ tag: fc.rnaPath }, ctx1);
  assert(ctx1.paramOverrides.has('p'),                   'kernel pre-mute: wrote');
  fc.mute = true;
  const ctx2 = makeCtx({ id: 'A', fcurves: [fc] });
  kernelFCurveEval({ tag: fc.rnaPath }, ctx2);
  assert(!ctx2.paramOverrides.has('p'),                  'kernel post-mute: did NOT write');
  fc.mute = false;
  const ctx3 = makeCtx({ id: 'A', fcurves: [fc] });
  kernelFCurveEval({ tag: fc.rnaPath }, ctx3);
  assert(ctx3.paramOverrides.has('p'),                   'kernel unmuted: wrote again');
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
