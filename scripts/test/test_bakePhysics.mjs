// Bake Physics — pure-fn core + applyBakePhysics test.
//
// Asserts:
//   - empty project (no physics rules) → empty bake, no error
//   - one rule with one input + one output → output curve has the
//     expected sample count and shape (springs settle from rest)
//   - pre-roll suppresses the "wind-up" transient at the start
//   - applyBakePhysics inserts records into the action's fcurves
//   - applyBakePhysics REPLACES pre-existing fcurves for baked
//     outputs (clears + re-emits), but preserves unrelated fcurves
//   - input validation throws on bad range / step
//
// Run: node scripts/test/test_bakePhysics.mjs

import { bakePhysics, applyBakePhysics } from '../../src/v3/operators/bakePhysics.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

/**
 * Project shape with one physics rule:
 *   - One input param (ParamBodyAngleZ, driven by user fcurve).
 *   - One output param (ParamHairFront, baked by physics).
 *   - Modifier mode = REALTIME so gatherPhysicsRules emits it.
 */
function makeProject({ inputKeyforms, outputKeyforms = null }) {
  /** @type {any} */
  const project = {
    parameters: [
      { id: 'ParamBodyAngleZ', name: 'ParamBodyAngleZ', default: 0, min: -10, max: 10 },
      { id: 'ParamHairFront',  name: 'ParamHairFront',  default: 0, min: -1,  max: 1 },
    ],
    actions: [
      {
        id: 'act-A',
        name: 'A',
        fps: 24,
        frameStart: 0,
        frameEnd: 1000,
        duration: 1000,
        fcurves: [
          {
            rnaPath: 'objects["__params__"].values["ParamBodyAngleZ"]',
            keyforms: inputKeyforms,
          },
          ...(outputKeyforms ? [{
            rnaPath: 'objects["__params__"].values["ParamHairFront"]',
            keyforms: outputKeyforms,
          }] : []),
        ],
      },
    ],
    nodes: [
      {
        id: 'physicsHolder',
        type: 'group',
        modifiers: [
          {
            type: 'physicsModifier',
            ruleId: 'rule-hair',
            name: 'Hair',
            category: 'hair',
            enabled: true,
            mode: 7,
            inputs: [
              { paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100, isReverse: false },
            ],
            vertices: [
              { x: 0, y: 0, radius: 0,  mobility: 1, delay: 0, acceleration: 1 },
              { x: 0, y: 0, radius: 10, mobility: 1, delay: 0.5, acceleration: 1 },
            ],
            normalization: { posMin: -10, posMax: 10, angleMin: -10, angleMax: 10 },
            output: { paramId: 'ParamHairFront', vertexIndex: 1, scale: 1, isReverse: false },
          },
        ],
      },
    ],
  };
  return project;
}

// ── §1 — no physics rules → empty bake, no throw ──────────────────────

{
  const project = { parameters: [], actions: [{ id: 'a', name: 'a', fcurves: [], duration: 100 }], nodes: [] };
  const result = bakePhysics(project.actions[0], project, {});
  ok(result.records.length === 0, '§1 — empty rules → empty records');
  ok(result.outputParamIds.length === 0, '§1 — empty rules → no output params');
  ok(result.sampleCount === 0, '§1 — empty rules → sampleCount=0');
  ok(result.ruleCount === 0, '§1 — empty rules → ruleCount=0');
}

// ── §2 — one rule, constant input → sampled output ───────────────────

{
  // Input held at +10 for the whole action.
  const project = makeProject({
    inputKeyforms: [
      { time: 0, value: 10, interpolation: 'linear' },
      { time: 1000, value: 10, interpolation: 'linear' },
    ],
  });
  const result = bakePhysics(project.actions[0], project, {
    frameStartMs: 0,
    frameEndMs: 1000,
    stepMs: 1000 / 24,
    preRollMs: 0, // exercise the no-pre-roll path
  });
  ok(result.ruleCount === 1, '§2 — one rule resolved');
  ok(result.outputParamIds.length === 1 && result.outputParamIds[0] === 'ParamHairFront',
    '§2 — output param set to ParamHairFront');
  // 24fps over 1000ms inclusive → 25 samples (frames 0..24, t=0..1000).
  ok(result.sampleCount === 25, `§2 — sampleCount=25 (got ${result.sampleCount})`);
  ok(result.records.length === 25,
    `§2 — one rnaPath × 25 samples → 25 records (got ${result.records.length})`);
  // Records sorted ascending by time.
  for (let i = 1; i < result.records.length; i++) {
    if (result.records[i].time < result.records[i - 1].time) {
      ok(false, '§2 — records monotonic time'); break;
    }
  }
  // Pendulum settles toward a non-zero output under constant input.
  // First-frame output ≈ 0 (springs at rest); later samples non-zero.
  const first = result.records[0].value;
  const last = result.records[result.records.length - 1].value;
  ok(Math.abs(first) < Math.abs(last),
    `§2 — output magnitude grows under constant input (first=${first.toFixed(3)} last=${last.toFixed(3)})`);
}

// ── §3 — pre-roll suppresses the wind-up transient ───────────────────

{
  const project = makeProject({
    inputKeyforms: [
      { time: 0, value: 10, interpolation: 'linear' },
      { time: 1000, value: 10, interpolation: 'linear' },
    ],
  });
  const noPreRoll = bakePhysics(project.actions[0], project, {
    frameStartMs: 0, frameEndMs: 200, stepMs: 1000 / 24, preRollMs: 0,
  });
  const withPreRoll = bakePhysics(project.actions[0], project, {
    frameStartMs: 0, frameEndMs: 200, stepMs: 1000 / 24, preRollMs: 1000,
  });
  // Both should sample identically.
  ok(noPreRoll.sampleCount === withPreRoll.sampleCount, '§3 — same sampleCount');
  // With pre-roll the spring has already settled before recording starts,
  // so the first-frame output magnitude should be greater (closer to
  // steady-state) than without pre-roll (which starts from rest=0).
  const v0_no = Math.abs(noPreRoll.records[0].value);
  const v0_pre = Math.abs(withPreRoll.records[0].value);
  ok(v0_pre > v0_no, `§3 — pre-rolled first-frame closer to steady-state (preRoll=${v0_pre.toFixed(3)} > noPreRoll=${v0_no.toFixed(3)})`);
}

// ── §4 — input validation (Rule №1: throw on bad input) ──────────────

{
  const project = makeProject({ inputKeyforms: [{ time: 0, value: 0 }] });
  let threw = false;
  try { bakePhysics(project.actions[0], project, { frameStartMs: 100, frameEndMs: 50, stepMs: 10 }); }
  catch { threw = true; }
  ok(threw, '§4 — frameEnd < frameStart throws');
}
{
  const project = makeProject({ inputKeyforms: [{ time: 0, value: 0 }] });
  let threw = false;
  try { bakePhysics(project.actions[0], project, { frameStartMs: 0, frameEndMs: 100, stepMs: 0 }); }
  catch { threw = true; }
  ok(threw, '§4 — stepMs <= 0 throws');
}
{
  const project = makeProject({ inputKeyforms: [{ time: 0, value: 0 }] });
  let threw = false;
  try { bakePhysics(project.actions[0], project, { frameStartMs: NaN, frameEndMs: 100, stepMs: 10 }); }
  catch { threw = true; }
  // Default behavior: NaN falls back to action.frameStart=0 — not a throw.
  ok(!threw, '§4 — NaN frameStart falls back to action default, no throw');
}

// ── §5 — applyBakePhysics: inserts records into action.fcurves ──────

{
  const project = makeProject({
    inputKeyforms: [
      { time: 0, value: 0, interpolation: 'linear' },
      { time: 500, value: 10, interpolation: 'linear' },
      { time: 1000, value: 0, interpolation: 'linear' },
    ],
  });
  const result = applyBakePhysics(project, 'act-A', {
    frameStartMs: 0, frameEndMs: 1000, stepMs: 1000 / 24, preRollMs: 100,
  });
  ok(result !== null, '§5 — applyBakePhysics returned non-null');
  ok(result.keysWritten > 0, `§5 — wrote ${result.keysWritten} keys`);
  const action = project.actions[0];
  const outFcurve = action.fcurves.find(
    (fc) => fc.rnaPath === 'objects["__params__"].values["ParamHairFront"]',
  );
  ok(outFcurve != null, '§5 — output fcurve present after bake');
  ok(Array.isArray(outFcurve?.keyforms) && outFcurve.keyforms.length > 0,
    `§5 — output fcurve has keyforms (${outFcurve?.keyforms?.length})`);
  // Input fcurve preserved.
  const inFcurve = action.fcurves.find(
    (fc) => fc.rnaPath === 'objects["__params__"].values["ParamBodyAngleZ"]',
  );
  ok(inFcurve != null && inFcurve.keyforms.length === 3,
    '§5 — input fcurve preserved unchanged');
}

// ── §6 — applyBakePhysics REPLACES existing output fcurve ────────────

{
  const project = makeProject({
    inputKeyforms: [
      { time: 0, value: 0, interpolation: 'linear' },
      { time: 1000, value: 5, interpolation: 'linear' },
    ],
    // Pre-existing junk on the output param — should be wiped.
    outputKeyforms: [
      { time: 0, value: 999, interpolation: 'linear' },
      { time: 1000, value: 999, interpolation: 'linear' },
    ],
  });
  const result = applyBakePhysics(project, 'act-A', {
    frameStartMs: 0, frameEndMs: 1000, stepMs: 1000 / 24, preRollMs: 0,
  });
  ok(result !== null, '§6 — applyBakePhysics returned non-null');
  const outFcurve = project.actions[0].fcurves.find(
    (fc) => fc.rnaPath === 'objects["__params__"].values["ParamHairFront"]',
  );
  ok(outFcurve != null, '§6 — output fcurve still present');
  // No keyform should match the 999 junk.
  const has999 = outFcurve.keyforms.some((k) => k.value === 999);
  ok(!has999, '§6 — pre-existing 999 junk cleared (REPLACE semantics)');
}

// ── §7 — applyBakePhysics: nonexistent action returns null ───────────

{
  const project = makeProject({ inputKeyforms: [{ time: 0, value: 0 }] });
  const result = applyBakePhysics(project, 'no-such-action', {});
  ok(result === null, '§7 — null on unknown actionId');
}

console.log(`bakePhysics: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
