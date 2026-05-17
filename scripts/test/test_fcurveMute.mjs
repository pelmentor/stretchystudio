// Animation Phase 5 Slice 5.G + 5.O — tests for src/anim/fcurveMute.js +
// caller-side eval gates (animationFCurve.evaluateActionFCurves +
// depgraph kernel kernelFCurveEval).
//
// Slice 5.G coverage (single-curve + eval):
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
// Slice 5.O coverage (bulk-mute on selected channels — Shift+W /
// Ctrl+Shift+W / Alt+W):
//   - applyChannelMuteSelected: ENABLE / DISABLE / TOGGLE modes,
//     scan-first TOGGLE resolution, sparse-field preservation,
//     hidden+selected curves still acted on (sidebar uses
//     ANIMFILTER_LIST_VISIBLE not ANIMFILTER_CURVE_VISIBLE),
//     driver-bearing curves mute-toggleable
//   - wouldChannelMuteSelectedChange: preflight reader symmetric with
//     the mutator (phantom-undo gate)
//   - Guards: null action / fcurves / mode
//
// Audit-fix LOW-A2 (Slice 5.O dual-audit 2026-05-17): provenance tag
// extended to include 5.O. Same fix as fcurveMute.js LOW-A1.
//
// Run: node scripts/test/test_fcurveMute.mjs

import {
  isFCurveMuted,
  toggleFCurveMute,
  applyChannelMuteSelected,
  wouldChannelMuteSelectedChange,
} from '../../src/anim/fcurveMute.js';
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
// applyChannelMuteSelected — bulk-mute on selected channels
// (Slice 5.O: Shift+W / Ctrl+Shift+W / Alt+W in sidebar region)
//
// Mirrors `setflag_anim_channels` (`anim_channels_edit.cc:2923-3001`)
// with `setting=ACHANNEL_SETTING_MUTE` and `onlysel=true`.

function makeBulkAction() {
  return {
    id: 'A',
    fcurves: [
      makeFCurve('a', 'objects["__params__"].values["a"]', 1),
      makeFCurve('b', 'objects["__params__"].values["b"]', 2),
      makeFCurve('c', 'objects["__params__"].values["c"]', 3),
    ],
  };
}

// ── ENABLE (Ctrl+Shift+W) ───────────────────────────────────────────

{
  // 2 selected, all unmuted → both go to mute=true; unselected peer stays.
  const a = makeBulkAction();
  a.fcurves[0].selected = true;
  a.fcurves[1].selected = true;
  const r = applyChannelMuteSelected(a, 'enable');
  assert(r.changed === true,              'enable: changed=true');
  assert(r.mutedCount === 2,              'enable: mutedCount=2');
  assert(r.unmutedCount === 0,            'enable: unmutedCount=0');
  assert(r.resolvedMode === 'enable',     'enable: resolvedMode=enable');
  assert(a.fcurves[0].mute === true,      'enable: a muted');
  assert(a.fcurves[1].mute === true,      'enable: b muted');
  assert(a.fcurves[2].mute === undefined, 'enable: c untouched (unselected)');
}

{
  // All selected already muted → no change.
  const a = makeBulkAction();
  a.fcurves[0].selected = true; a.fcurves[0].mute = true;
  a.fcurves[1].selected = true; a.fcurves[1].mute = true;
  const r = applyChannelMuteSelected(a, 'enable');
  assert(r.changed === false,             'enable all-already-muted: changed=false');
  assert(r.mutedCount === 0,              'enable all-already-muted: mutedCount=0');
  assert(r.resolvedMode === 'enable',     'enable all-already-muted: resolvedMode=enable');
  assert(a.fcurves[0].mute === true,      'enable all-already-muted: a stays muted');
  assert(a.fcurves[1].mute === true,      'enable all-already-muted: b stays muted');
}

{
  // Mixed: some muted, some not → mute the unmuted ones, leave muted ones.
  const a = makeBulkAction();
  a.fcurves[0].selected = true;
  a.fcurves[1].selected = true; a.fcurves[1].mute = true;
  const r = applyChannelMuteSelected(a, 'enable');
  assert(r.changed === true,              'enable mixed: changed=true');
  assert(r.mutedCount === 1,              'enable mixed: mutedCount=1');
  assert(r.unmutedCount === 0,            'enable mixed: unmutedCount=0');
  assert(a.fcurves[0].mute === true,      'enable mixed: a now muted');
  assert(a.fcurves[1].mute === true,      'enable mixed: b still muted');
}

// ── DISABLE (Alt+W) ─────────────────────────────────────────────────

{
  // 2 selected, all muted → both unmute; unselected muted peer stays.
  const a = makeBulkAction();
  a.fcurves[0].selected = true; a.fcurves[0].mute = true;
  a.fcurves[1].selected = true; a.fcurves[1].mute = true;
  a.fcurves[2].mute = true; // unselected, muted
  const r = applyChannelMuteSelected(a, 'disable');
  assert(r.changed === true,              'disable: changed=true');
  assert(r.unmutedCount === 2,            'disable: unmutedCount=2');
  assert(r.mutedCount === 0,              'disable: mutedCount=0');
  assert(r.resolvedMode === 'disable',    'disable: resolvedMode=disable');
  assert(a.fcurves[0].mute === false,     'disable: a unmuted');
  assert(a.fcurves[1].mute === false,     'disable: b unmuted');
  assert(a.fcurves[2].mute === true,      'disable: c (unselected) untouched');
}

{
  // All selected already unmuted (or sparse) → no change.
  const a = makeBulkAction();
  a.fcurves[0].selected = true; // mute missing → counts as unmuted
  a.fcurves[1].selected = true; a.fcurves[1].mute = false;
  const r = applyChannelMuteSelected(a, 'disable');
  assert(r.changed === false,             'disable all-already-unmuted: changed=false');
  assert(r.unmutedCount === 0,            'disable all-already-unmuted: unmutedCount=0');
  // Sparse field stays sparse — no explicit `mute=false` write onto missing.
  assert(a.fcurves[0].mute === undefined, 'disable all-already-unmuted: sparse stays sparse');
  assert(a.fcurves[1].mute === false,     'disable all-already-unmuted: explicit false stays');
}

// ── TOGGLE (Shift+W) — scan-first uniform-flip ──────────────────────

{
  // All selected unmuted → resolve to ENABLE → all flip to muted.
  const a = makeBulkAction();
  a.fcurves[0].selected = true;
  a.fcurves[1].selected = true;
  const r = applyChannelMuteSelected(a, 'toggle');
  assert(r.changed === true,              'toggle all-unmuted: changed=true');
  assert(r.resolvedMode === 'enable',     'toggle all-unmuted: resolved=enable');
  assert(r.mutedCount === 2,              'toggle all-unmuted: mutedCount=2');
  assert(a.fcurves[0].mute === true,      'toggle all-unmuted: a muted');
  assert(a.fcurves[1].mute === true,      'toggle all-unmuted: b muted');
}

{
  // All selected muted → resolve to DISABLE → all flip to unmuted.
  const a = makeBulkAction();
  a.fcurves[0].selected = true; a.fcurves[0].mute = true;
  a.fcurves[1].selected = true; a.fcurves[1].mute = true;
  const r = applyChannelMuteSelected(a, 'toggle');
  assert(r.changed === true,              'toggle all-muted: changed=true');
  assert(r.resolvedMode === 'disable',    'toggle all-muted: resolved=disable');
  assert(r.unmutedCount === 2,            'toggle all-muted: unmutedCount=2');
  assert(a.fcurves[0].mute === false,     'toggle all-muted: a unmuted');
  assert(a.fcurves[1].mute === false,     'toggle all-muted: b unmuted');
}

{
  // Mixed (one muted) → resolve to DISABLE → muted flips to unmuted,
  // unmuted stays unmuted.
  const a = makeBulkAction();
  a.fcurves[0].selected = true;                                // unmuted
  a.fcurves[1].selected = true; a.fcurves[1].mute = true;      // muted
  a.fcurves[2].selected = true;                                // unmuted
  const r = applyChannelMuteSelected(a, 'toggle');
  assert(r.changed === true,              'toggle mixed: changed=true');
  assert(r.resolvedMode === 'disable',    'toggle mixed: resolved=disable (Blender scan-first)');
  assert(r.unmutedCount === 1,            'toggle mixed: only the previously-muted one flipped');
  assert(r.mutedCount === 0,              'toggle mixed: no new mutes');
  assert(a.fcurves[0].mute === undefined, 'toggle mixed: a stays sparse');
  assert(a.fcurves[1].mute === false,     'toggle mixed: b unmuted');
  assert(a.fcurves[2].mute === undefined, 'toggle mixed: c stays sparse');
}

// ── No-selection / null / invalid mode ──────────────────────────────

{
  // Zero selected → no-op for all modes.
  const a = makeBulkAction();
  for (const mode of /** @type {const} */ (['toggle', 'enable', 'disable'])) {
    const r = applyChannelMuteSelected(a, mode);
    assert(r.changed === false,           `no-sel ${mode}: changed=false`);
    assert(r.resolvedMode === null,       `no-sel ${mode}: resolvedMode=null`);
    assert(r.mutedCount === 0,            `no-sel ${mode}: mutedCount=0`);
    assert(r.unmutedCount === 0,          `no-sel ${mode}: unmutedCount=0`);
  }
}

{
  // Guard: null action.
  const r = applyChannelMuteSelected(null, 'toggle');
  assert(r.changed === false,             'guard: null action');
  assert(r.resolvedMode === null,         'guard: null action resolvedMode=null');
}

{
  // Guard: null fcurves array.
  const r = applyChannelMuteSelected({ fcurves: null }, 'toggle');
  assert(r.changed === false,             'guard: null fcurves');
}

{
  // Guard: unknown mode.
  const a = makeBulkAction();
  a.fcurves[0].selected = true;
  // @ts-expect-error — testing runtime guard against invalid input.
  const r = applyChannelMuteSelected(a, 'wat');
  assert(r.changed === false,             'guard: unknown mode');
  assert(a.fcurves[0].mute === undefined, 'guard: unknown mode no write');
}

// ── Sparse / null entries tolerated ─────────────────────────────────

{
  const a = {
    id: 'A',
    fcurves: [
      null,
      { ...makeFCurve('x', 'objects["__params__"].values["x"]', 1), selected: true },
      undefined,
      { ...makeFCurve('y', 'objects["__params__"].values["y"]', 2), selected: true, mute: true },
    ],
  };
  const r = applyChannelMuteSelected(a, 'toggle');
  // x unmuted, y muted → mixed → resolve to DISABLE.
  assert(r.changed === true,              'sparse-tolerated: changed=true');
  assert(r.resolvedMode === 'disable',    'sparse-tolerated: resolved=disable');
  assert(a.fcurves[1].mute === undefined, 'sparse-tolerated: x stays sparse');
  assert(a.fcurves[3].mute === false,     'sparse-tolerated: y unmuted');
}

// ── Peer-isolation: hidden + unselected curves untouched ────────────

{
  // Hidden + selected curve: STILL acted on (sidebar W ignores hide).
  // Mirrors Blender's `ANIMFILTER_LIST_VISIBLE` (row-visible, not
  // plot-visible) filter at `anim_channels_edit.cc:2956-2960`.
  const a = makeBulkAction();
  a.fcurves[0].selected = true; a.fcurves[0].hide = true; // hidden but selected
  a.fcurves[1].selected = true;
  const r = applyChannelMuteSelected(a, 'enable');
  assert(r.changed === true,              'hidden+selected acted: changed=true');
  assert(r.mutedCount === 2,              'hidden+selected acted: both muted');
  assert(a.fcurves[0].mute === true,      'hidden+selected acted: hidden one muted');
}

// ── wouldChannelMuteSelectedChange — preflight reader ───────────────
//
// Critical: must mirror applyChannelMuteSelected exactly (drift would
// re-introduce Slice 5.M HIGH-A1 phantom-undo bug class).

{
  // No selection → all modes return false.
  const a = makeBulkAction();
  assert(wouldChannelMuteSelectedChange(a, 'toggle')  === false, 'pre: no-sel toggle');
  assert(wouldChannelMuteSelectedChange(a, 'enable')  === false, 'pre: no-sel enable');
  assert(wouldChannelMuteSelectedChange(a, 'disable') === false, 'pre: no-sel disable');
}

{
  // Selected + all-already-muted: enable→false, disable→true, toggle→true.
  const a = makeBulkAction();
  a.fcurves[0].selected = true; a.fcurves[0].mute = true;
  a.fcurves[1].selected = true; a.fcurves[1].mute = true;
  assert(wouldChannelMuteSelectedChange(a, 'enable')  === false, 'pre: all-muted enable=false');
  assert(wouldChannelMuteSelectedChange(a, 'disable') === true,  'pre: all-muted disable=true');
  assert(wouldChannelMuteSelectedChange(a, 'toggle')  === true,  'pre: all-muted toggle=true (TOGGLE always flips when sel>0)');
}

{
  // Selected + all-already-unmuted: enable→true, disable→false, toggle→true.
  const a = makeBulkAction();
  a.fcurves[0].selected = true;
  a.fcurves[1].selected = true;
  assert(wouldChannelMuteSelectedChange(a, 'enable')  === true,  'pre: all-unmuted enable=true');
  assert(wouldChannelMuteSelectedChange(a, 'disable') === false, 'pre: all-unmuted disable=false');
  assert(wouldChannelMuteSelectedChange(a, 'toggle')  === true,  'pre: all-unmuted toggle=true');
}

{
  // Mixed: enable→true (one to add), disable→true (one to clear),
  // toggle→true (always flips when sel>0).
  const a = makeBulkAction();
  a.fcurves[0].selected = true;
  a.fcurves[1].selected = true; a.fcurves[1].mute = true;
  assert(wouldChannelMuteSelectedChange(a, 'enable')  === true,  'pre: mixed enable=true');
  assert(wouldChannelMuteSelectedChange(a, 'disable') === true,  'pre: mixed disable=true');
  assert(wouldChannelMuteSelectedChange(a, 'toggle')  === true,  'pre: mixed toggle=true');
}

{
  // Guard: null action / invalid mode.
  assert(wouldChannelMuteSelectedChange(null, 'toggle') === false,            'pre guard: null action');
  assert(wouldChannelMuteSelectedChange({ fcurves: null }, 'toggle') === false,'pre guard: null fcurves');
  // @ts-expect-error — testing runtime guard against invalid input.
  assert(wouldChannelMuteSelectedChange(makeBulkAction(), 'wat') === false,   'pre guard: unknown mode');
}

// ── Driver-bearing curves ARE mute-toggleable ───────────────────────
//
// Mirrors Blender: `ANIM_channel_setting_set` for MUTE is a pure
// flag-flip (`anim_channels_defines.cc:1124-1125`) — driver presence
// does not gate the write. The DRIVER's evaluation is gated downstream
// by `BKE_animsys_eval_driver` (`anim_sys.cc:4302`), which SS already
// handles via the caller-side eval gate (test above).

{
  const a = {
    id: 'A',
    fcurves: [{
      id: 'd',
      rnaPath: 'objects["__params__"].values["p"]',
      keyforms: [],
      selected: true,
      driver: { type: 'avg', variables: [], expression: '' },
    }],
  };
  const r = applyChannelMuteSelected(a, 'enable');
  assert(r.changed === true,              'driver mute-toggleable: changed=true');
  assert(a.fcurves[0].mute === true,      'driver mute-toggleable: mute=true written');
}

// ─────────────────────────────────────────────────────────────────────
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
