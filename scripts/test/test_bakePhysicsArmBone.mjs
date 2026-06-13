// Regression for bake physics writing bone-rotation rnaPath for arm-
// physics outputs (2026-06-13).
//
// Bug class: Bake Physics worked for hair / clothing / bust but the
// baked output for ARM PHYSICS had no effect during playback. Root
// cause: arm physics rules' outputs target `ParamRotation_<bone>`
// synthetic params (Cubism physics doesn't know about bones; the
// rig system uses these as the bridge). During live preview,
// CanvasViewport's PARAM → BONE mirror translates these param values
// into bone rotations every tick — BUT THAT MIRROR IS PREVIEW-MODE
// ONLY (CanvasViewport.jsx:1231 gates `if (previewModeRef.current)`,
// deliberately so editor-mode slider defaults don't clobber gestures).
//
// Consequence: bake wrote
// `objects["__params__"].values["ParamRotation_LeftElbow"]` fcurves;
// at playback time the animation engine evaluated them; the value
// landed in paramOverrides — but the bone never moved because the
// mirror was off.
//
// Hair / clothing / bust outputs target REAL Cubism params (ParamHair*,
// ParamCloth*, etc.) that drive WARP keyforms directly — no bone-
// mirror needed. Those worked correctly because the gap was specific
// to the bone-mirrored output path.
//
// Fix: detect `ParamRotation_<sanitized>` paramIds in the bake output
// loop; resolve to the actual bone node id; write the record using
// the bone's pose.rotation rnaPath (`objects["<boneId>"].pose.rotation`)
// instead. This bypasses the param-mirror gap — bone-rotation fcurves
// are read by TRANSFORM_COMPOSE's poseOverrides path which DOES run
// during playback.
//
// applyBakePhysics' destructive-clear loop also extended to clear
// BOTH the new bone-rotation fcurve path AND the legacy __params__
// path, so re-baking after the fix wipes stale data from pre-fix
// bakes.
//
// Run: node scripts/test/test_bakePhysicsArmBone.mjs

import { bakePhysics, applyBakePhysics } from '../../src/v3/operators/bakePhysics.js';

let pass = 0;
let fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.error(`FAIL: ${msg}`); } };

/**
 * Project shape with an arm-physics-style rule:
 *   - Input: ParamBodyAngleZ (user-driven)
 *   - Output: ParamRotation_LeftElbow (synthetic, targets bone via mirror)
 *   - A `leftElbow` bone group exists with id 'bone-leftElbow' so the
 *     bone resolution succeeds.
 */
function makeArmProject({ inputKeyforms }) {
  /** @type {any} */
  const project = {
    parameters: [
      { id: 'ParamBodyAngleZ', name: 'ParamBodyAngleZ', default: 0, min: -10, max: 10 },
      { id: 'ParamRotation_LeftElbow', name: 'ParamRotation_LeftElbow', default: 0, min: -30, max: 30 },
    ],
    actions: [
      {
        id: 'act-A',
        name: 'A',
        fps: 24,
        frameStart: 0,
        frameEnd: 500,
        duration: 500,
        fcurves: [
          {
            rnaPath: 'objects["__params__"].values["ParamBodyAngleZ"]',
            keyforms: inputKeyforms,
          },
        ],
      },
    ],
    nodes: [
      // The bone the arm physics rule's output resolves to. Name
      // 'LeftElbow' sanitises to 'LeftElbow'.
      {
        id: 'bone-leftElbow',
        type: 'group',
        name: 'LeftElbow',
        boneRole: 'leftElbow',
      },
      // The physics holder — could be the bone itself or a handwear
      // mesh. For the test, attach to the bone.
      {
        id: 'physicsHolder',
        type: 'group',
        modifiers: [
          {
            type: 'physicsModifier',
            ruleId: 'rule-armSway',
            name: 'Arm Sway',
            category: 'arms',
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
            output: {
              paramId: 'ParamRotation_LeftElbow',
              vertexIndex: 1,
              scale: 4,
              isReverse: false,
            },
          },
        ],
      },
    ],
  };
  return project;
}

// ── §1 — bake writes bone-rotation rnaPath for ParamRotation_ output ──

{
  const project = makeArmProject({
    inputKeyforms: [
      { time: 0,   value: 10, interpolation: 'linear' },
      { time: 500, value: 10, interpolation: 'linear' },
    ],
  });
  const result = bakePhysics(project.actions[0], project, {
    frameStartMs: 0, frameEndMs: 500, stepMs: 1000 / 24, preRollMs: 0,
  });

  ok(result.ruleCount === 1, '§1 — one rule gathered');
  ok(result.outputParamIds.length === 1
    && result.outputParamIds[0] === 'ParamRotation_LeftElbow',
    '§1 — output paramId is still the synthetic bone-mirror param');

  // The critical assertion: every record's rnaPath targets the bone's
  // pose.rotation, NOT objects["__params__"].values["..."].
  ok(result.records.length > 0, '§1 — records exist');
  const boneRotationPaths = result.records.filter(
    (r) => r.rnaPath === 'objects["bone-leftElbow"].pose.rotation',
  );
  ok(boneRotationPaths.length === result.records.length,
    `§1 — all ${result.records.length} records use bone.pose.rotation rnaPath `
    + `(got ${boneRotationPaths.length})`);

  const paramRecords = result.records.filter(
    (r) => r.rnaPath.startsWith('objects["__params__"]'),
  );
  ok(paramRecords.length === 0,
    `§1 — NO records use the legacy __params__ rnaPath `
    + `(got ${paramRecords.length}) — would silently no-op via mirror gap`);
}

// ── §2 — applyBakePhysics writes the fcurve to the action ─────────────

{
  const project = makeArmProject({
    inputKeyforms: [
      { time: 0,   value: 10, interpolation: 'linear' },
      { time: 500, value: 10, interpolation: 'linear' },
    ],
  });
  const result = applyBakePhysics(project, 'act-A', {
    frameStartMs: 0, frameEndMs: 500, stepMs: 1000 / 24, preRollMs: 0,
  });
  ok(result !== null, '§2 — apply returns non-null');
  ok(result.keysWritten > 0, `§2 — keys written (got ${result.keysWritten})`);

  // Action's fcurves should now contain a bone-rotation fcurve.
  const action = project.actions[0];
  const boneFcurve = action.fcurves.find(
    (fc) => fc.rnaPath === 'objects["bone-leftElbow"].pose.rotation',
  );
  ok(!!boneFcurve, '§2 — action has bone.pose.rotation fcurve after bake');
  ok(boneFcurve.keyforms && boneFcurve.keyforms.length > 0,
    '§2 — bone fcurve has keyforms');

  // No __params__ fcurve for the synthetic ParamRotation_* should exist.
  const paramFcurve = action.fcurves.find(
    (fc) => fc.rnaPath === 'objects["__params__"].values["ParamRotation_LeftElbow"]',
  );
  ok(!paramFcurve,
    '§2 — NO __params__ ParamRotation_LeftElbow fcurve (would be the mirror-gap path)');

  // Original input fcurve preserved.
  const inputFcurve = action.fcurves.find(
    (fc) => fc.rnaPath === 'objects["__params__"].values["ParamBodyAngleZ"]',
  );
  ok(!!inputFcurve, '§2 — input fcurve (ParamBodyAngleZ) preserved');
}

// ── §3 — re-bake clears both legacy AND new path (migration safety) ──
//
// A project baked BEFORE this fix has a stale
// `objects["__params__"].values["ParamRotation_LeftElbow"]` fcurve
// that never worked. Re-baking AFTER the fix must clear it (otherwise
// the user has both a stale param fcurve and a new bone-rotation
// fcurve — the param one does nothing but pollutes the curve list).

{
  const project = makeArmProject({
    inputKeyforms: [
      { time: 0,   value: 10, interpolation: 'linear' },
      { time: 500, value: 10, interpolation: 'linear' },
    ],
  });
  // Pre-seed the action with a legacy bake artifact (pre-fix shape):
  project.actions[0].fcurves.push({
    rnaPath: 'objects["__params__"].values["ParamRotation_LeftElbow"]',
    keyforms: [
      { time: 0, value: 0.123, interpolation: 'linear' },
      { time: 500, value: 0.456, interpolation: 'linear' },
    ],
  });

  applyBakePhysics(project, 'act-A', {
    frameStartMs: 0, frameEndMs: 500, stepMs: 1000 / 24, preRollMs: 0,
  });

  const action = project.actions[0];
  const legacyParamFcurve = action.fcurves.find(
    (fc) => fc.rnaPath === 'objects["__params__"].values["ParamRotation_LeftElbow"]',
  );
  ok(!legacyParamFcurve,
    '§3 — legacy __params__ ParamRotation_LeftElbow fcurve REMOVED '
    + '(re-bake migration cleanup)');

  const newBoneFcurve = action.fcurves.find(
    (fc) => fc.rnaPath === 'objects["bone-leftElbow"].pose.rotation',
  );
  ok(!!newBoneFcurve, '§3 — new bone-rotation fcurve PRESENT');
}

// ── §4 — re-bake clears prior bone-rotation fcurve too ───────────────

{
  const project = makeArmProject({
    inputKeyforms: [
      { time: 0,   value: 10, interpolation: 'linear' },
      { time: 500, value: 10, interpolation: 'linear' },
    ],
  });
  // First bake.
  const first = applyBakePhysics(project, 'act-A', {
    frameStartMs: 0, frameEndMs: 500, stepMs: 1000 / 24, preRollMs: 0,
  });
  const firstKeyCount = project.actions[0].fcurves
    .find((fc) => fc.rnaPath === 'objects["bone-leftElbow"].pose.rotation')
    ?.keyforms?.length;
  ok(firstKeyCount > 0, '§4 — first bake produces keyforms');

  // Second bake should REPLACE (not stack).
  const second = applyBakePhysics(project, 'act-A', {
    frameStartMs: 0, frameEndMs: 500, stepMs: 1000 / 24, preRollMs: 0,
  });
  const boneFcurves = project.actions[0].fcurves.filter(
    (fc) => fc.rnaPath === 'objects["bone-leftElbow"].pose.rotation',
  );
  ok(boneFcurves.length === 1,
    `§4 — exactly one bone-rotation fcurve after re-bake (got ${boneFcurves.length})`);
  const secondKeyCount = boneFcurves[0].keyforms.length;
  ok(secondKeyCount === firstKeyCount,
    `§4 — re-bake produces same key count (idempotent under identical inputs)`);
}

// ── §5 — non-bone outputs unchanged (hair / clothing still on __params__) ──

{
  // A hair-style project: output is ParamHairFront (NOT a bone param).
  const project = {
    parameters: [
      { id: 'ParamBodyAngleZ', name: 'ParamBodyAngleZ', default: 0, min: -10, max: 10 },
      { id: 'ParamHairFront', name: 'ParamHairFront', default: 0, min: -1, max: 1 },
    ],
    actions: [{
      id: 'act-A', name: 'A', fps: 24, frameStart: 0, frameEnd: 200, duration: 200,
      fcurves: [{
        rnaPath: 'objects["__params__"].values["ParamBodyAngleZ"]',
        keyforms: [
          { time: 0, value: 10, interpolation: 'linear' },
          { time: 200, value: 10, interpolation: 'linear' },
        ],
      }],
    }],
    nodes: [{
      id: 'physicsHolder', type: 'group',
      modifiers: [{
        type: 'physicsModifier', ruleId: 'rule-hair', name: 'Hair', category: 'hair',
        enabled: true, mode: 7,
        inputs: [{ paramId: 'ParamBodyAngleZ', type: 'SRC_TO_G_ANGLE', weight: 100 }],
        vertices: [
          { x: 0, y: 0, radius: 0, mobility: 1, delay: 0, acceleration: 1 },
          { x: 0, y: 0, radius: 10, mobility: 1, delay: 0.5, acceleration: 1 },
        ],
        normalization: { posMin: -10, posMax: 10, angleMin: -10, angleMax: 10 },
        output: { paramId: 'ParamHairFront', vertexIndex: 1, scale: 1, isReverse: false },
      }],
    }],
  };

  const result = bakePhysics(project.actions[0], project, {
    frameStartMs: 0, frameEndMs: 200, stepMs: 1000 / 24, preRollMs: 0,
  });

  const allParam = result.records.every(
    (r) => r.rnaPath === 'objects["__params__"].values["ParamHairFront"]',
  );
  ok(allParam,
    '§5 — non-bone output (ParamHairFront) STILL uses __params__ rnaPath '
    + '(only bone-mirror params get the special resolution)');
  const anyBone = result.records.some(
    (r) => r.rnaPath.includes('.pose.rotation'),
  );
  ok(!anyBone, '§5 — no bone.pose.rotation rnaPath for hair physics');
}

// ── §6 — bone-not-found falls back to __params__ rnaPath ──────────────
//
// If a ParamRotation_<sanitized> output's matching bone node doesn't
// exist in the project (deleted bone? misconfigured rule?), the
// resolver returns null. The bake falls back to the legacy
// __params__ rnaPath — better to write SOMETHING that maps to the
// mirror system (broken anyway in animation mode but the bake doesn't
// know that) than to silently drop the output.

{
  const project = makeArmProject({
    inputKeyforms: [
      { time: 0,   value: 10, interpolation: 'linear' },
      { time: 200, value: 10, interpolation: 'linear' },
    ],
  });
  // Remove the bone — the rule's output points at ParamRotation_LeftElbow
  // but no leftElbow bone exists in the project.
  project.nodes = project.nodes.filter((n) => n.id !== 'bone-leftElbow');

  const result = bakePhysics(project.actions[0], project, {
    frameStartMs: 0, frameEndMs: 200, stepMs: 1000 / 24, preRollMs: 0,
  });

  const allParam = result.records.every(
    (r) => r.rnaPath === 'objects["__params__"].values["ParamRotation_LeftElbow"]',
  );
  ok(allParam,
    '§6 — bone missing → falls back to __params__ rnaPath '
    + '(documented fallback; mirror gap means the bake records do nothing '
    + 'in playback, but that\'s the user\'s "deleted the bone" problem, '
    + 'not the baker\'s)');
}

console.log(`bakePhysicsArmBone: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
