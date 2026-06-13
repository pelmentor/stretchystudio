// @ts-check

/**
 * Bake Physics — turn the active action's input curves through
 * cubismPhysicsKernel and write the resulting output param values back
 * onto the same action as fresh fcurves.
 *
 * # Why this exists
 *
 * Physics is stateful (springs + dampers integrate dt over time), so
 * `computeParamOverrides(action, time)` cannot evaluate "the hair sway
 * at frame N" in isolation — you have to step the simulation from
 * frame 0 to frame N. PNG sequence export and motion3.json bake both
 * suffer the same: any physics-driven param sits at rest in the output
 * because the export path is stateless (memo'd: see
 * `[[capture-export-must-mirror-live-tick]]`).
 *
 * The user-facing workflow is the Blender-style "Bake Action" with
 * physics enabled — author the input animation (head turn, body sway,
 * arm pose), then bake the simulation into deterministic keyframes
 * on the SAME action. After bake, every downstream consumer (export,
 * NLA, motion3) gets the physics behaviour without needing a live
 * tick loop.
 *
 * # Algorithm
 *
 * 1. Resolve `project.physicsRules` via `gatherPhysicsRules`. Empty →
 *    no-op (return zero fcurves, sampleCount=0).
 * 2. Build `paramSpecs` from `project.parameters`.
 * 3. Create a fresh `PhysicsState` (cubismPhysicsKernel).
 * 4. Optional pre-roll: integrate from `frameStartMs - preRollMs` to
 *    `frameStartMs` WITHOUT recording, so the simulation reaches
 *    steady-state w.r.t. the initial input. Without this, the first
 *    second of the bake shows transients as springs settle from rest.
 * 5. Step `frameStartMs → frameEndMs` at `stepMs`:
 *    - Build `paramValues` for this frame: start from parameter
 *      defaults, overlay every fcurve from the action at this time.
 *      Physics INPUT params (the rule's `inputs[]`) are read from this
 *      working map.
 *    - Call `tickPhysics(state, rules, working, paramSpecs, dtSec)` —
 *      mutates `working` in place, writing the rule's OUTPUT values.
 *    - For every output paramId in any rule, record
 *      `{rnaPath, time, value}` using `working[outputId]`. The rnaPath
 *      is the canonical `objects["__params__"].values["<id>"]`.
 *
 * 6. Return the collected `Array<{rnaPath, time, value}>` plus the
 *    list of touched paramIds + sample count.
 *
 * # Determinism contract
 *
 * Same input action + same project + same options → byte-identical
 * output keyframes. The kernel + fixed dt accumulator
 * (`physicsTick.js`) guarantees this; the only env-dependent thing
 * we touch is `Date.now()` (we don't).
 *
 * # Pre-roll rationale
 *
 * `createKernelState` starts every particle at the chain's rest
 * position with zero velocity. If the input at frame 0 is non-rest
 * (e.g. ParamBodyAngleZ = 10°), the spring will accelerate from rest
 * toward the steady-state for ~0.5 seconds, looking like an
 * unwanted "wind-up" jitter at the start of the bake. Pre-rolling for
 * `preRollMs` (default 500ms) at the same input as frame 0 settles
 * the chain before recording starts.
 *
 * # Caller's responsibility (Rule №1)
 *
 * This is a PURE function: no project mutation, no fcurve write. The
 * caller (`applyBakePhysics` below, or a future operator) must
 * decide what to do with the returned records. Two reasonable
 * strategies are shipped:
 *
 *   - `applyBakePhysics(project, actionId, options)` — insert the
 *     records into the action's fcurves IN PLACE via
 *     `insertKeyformAtInAction(REPLACE_OR_APPEND)`. Preserves any
 *     non-physics fcurves on the action.
 *
 *   - (future) "Bake to new action" — clone the action, bake into the
 *     clone, leave the source action untouched. Matches Blender's
 *     `bake_action_objects(use_current_action=False)`.
 *
 * @module v3/operators/bakePhysics
 */

import { gatherPhysicsRules } from '../../io/live2d/rig/physicsConfig.js';
import { createPhysicsState, tickPhysics, buildParamSpecs } from '../../io/live2d/runtime/physicsTick.js';
import { computeParamOverrides } from '../../renderer/animationEngine.js';
import { insertKeyformAtInAction, INSERTKEY_FLAGS } from '../../anim/insertKeyframe.js';
import { sanitisePartName } from '../../lib/partId.js';
import { getBoneRole } from '../../store/objectDataAccess.js';

/**
 * Resolve `ParamRotation_<sanitized>` → bone node id.
 *
 * Why this exists: bone physics outputs are stored as `ParamRotation_*`
 * synthetic params at SEED time (see physicsConfig.js:resolveRuleOutputs).
 * During live preview, CanvasViewport's PARAM → BONE mirror translates
 * these param values into bone rotations every tick. But that mirror
 * runs PREVIEW-MODE ONLY (CanvasViewport.jsx:1231 — animation-mode was
 * deliberately gated off to prevent editor-mode slider defaults from
 * clobbering gestures).
 *
 * Consequence: if bake writes `objects["__params__"].values["ParamRotation_LeftElbow"]`
 * fcurves, the animation engine evaluates them but the bone doesn't
 * move during playback — the mirror is gated off. Hair / clothing /
 * bust physics outputs target REAL Cubism params (ParamHairFront etc.)
 * that drive warps directly, so they don't hit this gap.
 *
 * Fix: write bone-output physics directly to the bone's pose.rotation
 * rnaPath, bypassing the param-mirror entirely. The canonical bone
 * rotation rnaPath is `objects["<boneId>"].pose.rotation` (see
 * rnaPath.js:16, animationFCurve.js:300).
 *
 * @param {object} project
 * @param {string} paramId
 * @returns {string|null} bone node id, or null if not a bone param
 */
function resolveBoneIdForParamRotation(project, paramId) {
  if (typeof paramId !== 'string') return null;
  const match = paramId.match(/^ParamRotation_(.+)$/);
  if (!match) return null;
  const sanitised = match[1];
  for (const node of project?.nodes ?? []) {
    if (!node || node.type !== 'group') continue;
    if (!getBoneRole(node)) continue;
    if (sanitisePartName(node.name || node.id) === sanitised) return node.id;
  }
  return null;
}

/**
 * Canonical record rnaPath for a baked output. Bone-mirrored params
 * (ParamRotation_<sanitized>) resolve to the bone's pose.rotation;
 * everything else stays on the __params__ path.
 *
 * @param {object} project
 * @param {string} paramId
 * @returns {string}
 */
function rnaPathForBakedOutput(project, paramId) {
  const boneId = resolveBoneIdForParamRotation(project, paramId);
  if (boneId) return `objects["${boneId}"].pose.rotation`;
  return `objects["__params__"].values["${paramId}"]`;
}

/**
 * @typedef {Object} BakePhysicsOptions
 * @property {number} [frameStartMs=0]  - Inclusive lower bound of the
 *   bake range (ms). Defaults to `action.frameStart ?? 0`.
 * @property {number} [frameEndMs]      - Inclusive upper bound (ms).
 *   Defaults to `action.frameEnd ?? action.duration ?? 2000`.
 * @property {number} [stepMs]          - Sample step (ms). Defaults
 *   to `1000 / (action.fps ?? 24)` — one record per action frame.
 * @property {number} [preRollMs=500]   - Settle-time before recording.
 *   Integrates the chain at the input-at-frameStart for this many ms
 *   without writing anything, so the recorded curves don't start with
 *   a "spring releases from rest" transient. Set to 0 to skip.
 */

/**
 * @typedef {Object} BakeRecord
 * @property {string} rnaPath
 * @property {number} time     - ms
 * @property {number} value
 */

/**
 * @typedef {Object} BakePhysicsResult
 * @property {BakeRecord[]} records   - Every `{rnaPath, time, value}`
 *   to insert. Sorted by `(rnaPath, time)`.
 * @property {string[]} outputParamIds - Distinct paramIds that were
 *   touched (union of all rules' `outputs[].paramId`).
 * @property {number} sampleCount    - Number of frames sampled.
 * @property {number} ruleCount      - Number of physics rules ticked.
 */

/**
 * Pure-function bake. Sample the action through physics, return what
 * fcurves would need.
 *
 * **Throws (Rule №1):**
 *   - `frameEndMs < frameStartMs`
 *   - `stepMs <= 0`
 *   - Non-finite range / step.
 *
 * Empty physics rules → empty records, NOT an error. The caller can
 * decide whether to surface "nothing to bake".
 *
 * @param {object} action          - The source action (read-only here).
 * @param {object} project         - Project (for parameters + rules).
 * @param {BakePhysicsOptions} [options]
 * @returns {BakePhysicsResult}
 */
export function bakePhysics(action, project, options = {}) {
  if (!action || typeof action !== 'object') {
    throw new Error('bakePhysics: action is required');
  }
  if (!project || typeof project !== 'object') {
    throw new Error('bakePhysics: project is required');
  }

  const fps = typeof action.fps === 'number' && action.fps > 0 ? action.fps : 24;
  const frameStartMs = Number.isFinite(options.frameStartMs)
    ? /** @type {number} */ (options.frameStartMs)
    : (typeof action.frameStart === 'number' ? action.frameStart : 0);
  const _defaultEnd = typeof action.frameEnd === 'number' ? action.frameEnd
    : (typeof action.duration === 'number' ? action.duration : 2000);
  const frameEndMs = Number.isFinite(options.frameEndMs)
    ? /** @type {number} */ (options.frameEndMs)
    : _defaultEnd;
  // stepMs: distinguish "not provided" (undefined) from "provided as
  // invalid" (e.g. 0, -1, NaN). Per RULE №1 the invalid case throws —
  // a silent fallback to the default would mask a caller bug.
  let stepMs;
  if (options.stepMs === undefined || options.stepMs === null) {
    stepMs = 1000 / fps;
  } else if (!Number.isFinite(options.stepMs) || /** @type {number} */ (options.stepMs) <= 0) {
    throw new Error(`bakePhysics: stepMs must be > 0 (got ${options.stepMs})`);
  } else {
    stepMs = /** @type {number} */ (options.stepMs);
  }
  const preRollMs = Number.isFinite(options.preRollMs) && /** @type {number} */ (options.preRollMs) >= 0
    ? /** @type {number} */ (options.preRollMs)
    : 500;

  if (!Number.isFinite(frameStartMs) || !Number.isFinite(frameEndMs)) {
    throw new Error(`bakePhysics: frame range must be finite (got ${frameStartMs}..${frameEndMs})`);
  }
  if (frameEndMs < frameStartMs) {
    throw new Error(`bakePhysics: frameEndMs (${frameEndMs}) < frameStartMs (${frameStartMs})`);
  }

  const rules = gatherPhysicsRules(project) ?? [];
  if (rules.length === 0) {
    return { records: [], outputParamIds: [], sampleCount: 0, ruleCount: 0 };
  }

  const paramSpecs = buildParamSpecs(project.parameters ?? []);
  const state = createPhysicsState(rules);

  // The action duration; computeParamOverrides uses it for the loop
  // boundary. We pass loopKeyframes=false (bake one shot, not loop).
  const endMs = typeof action.duration === 'number' ? action.duration : Math.max(0, frameEndMs);

  // Param-default seed — every fcurve overlays on top of this each
  // frame. Without it, params with NO fcurve in the action would
  // appear as undefined → tickPhysics' `paramValues[id] ?? 0` path
  // would silently treat them as zero, which is WRONG when the param's
  // `default` is non-zero (e.g. ParamOpacity=1).
  /** @type {Record<string, number>} */
  const defaultsSeed = {};
  for (const p of project.parameters ?? []) {
    if (p && typeof p.id === 'string' && typeof p.default === 'number' && Number.isFinite(p.default)) {
      defaultsSeed[p.id] = p.default;
    }
  }

  // Collect the universe of OUTPUT params across all rules.
  /** @type {Set<string>} */
  const outputParamSet = new Set();
  for (const rule of rules) {
    for (const out of rule.outputs ?? []) {
      if (out?.paramId && typeof out.paramId === 'string') outputParamSet.add(out.paramId);
    }
  }
  const outputParamIds = Array.from(outputParamSet);

  /**
   * Build the per-frame param working copy: defaults overlaid with
   * action's fcurve values at `t`. Excludes OUTPUT params from the
   * fcurve overlay — the bake is OVERWRITING those, so reading them
   * from the (possibly stale) existing fcurves would feed last-bake's
   * output back in as this-bake's input, drifting over reruns. Inputs
   * from non-physics fcurves (the user's authored ParamAngleX etc.)
   * pass through unchanged.
   *
   * @param {number} timeMs
   * @returns {Record<string, number>}
   */
  function workingValuesAt(timeMs) {
    const working = { ...defaultsSeed };
    const paramOv = computeParamOverrides(action, timeMs, false, endMs);
    for (const [pid, v] of paramOv) {
      if (outputParamSet.has(pid)) continue;
      if (Number.isFinite(v)) working[pid] = v;
    }
    return working;
  }

  // Pre-roll: integrate at the start-frame input for preRollMs before
  // we start recording. Sub-divide into stepMs ticks so the kernel
  // sees a sane dt budget.
  if (preRollMs > 0) {
    const dtSec = stepMs / 1000;
    const settleInput = workingValuesAt(frameStartMs);
    const steps = Math.ceil(preRollMs / stepMs);
    for (let i = 0; i < steps; i++) {
      tickPhysics(state, rules, settleInput, paramSpecs, dtSec);
    }
  }

  // Pre-resolve each output paramId to its canonical rnaPath. Bone-
  // output params (ParamRotation_*) get bone pose.rotation rnaPaths;
  // everything else stays on the __params__ values path. See
  // `resolveBoneIdForParamRotation` docblock for the mirror-gap
  // rationale this works around.
  /** @type {Map<string, string>} */
  const rnaPathByParamId = new Map();
  for (const pid of outputParamIds) {
    rnaPathByParamId.set(pid, rnaPathForBakedOutput(project, pid));
  }

  /** @type {BakeRecord[]} */
  const records = [];
  let sampleCount = 0;
  const dtSec = stepMs / 1000;
  // Inclusive endpoint, tolerant of floating-point step accumulation.
  const eps = stepMs * 1e-6;
  for (let t = frameStartMs; t <= frameEndMs + eps; t += stepMs) {
    const working = workingValuesAt(t);
    tickPhysics(state, rules, working, paramSpecs, dtSec);
    for (const pid of outputParamIds) {
      const v = working[pid];
      if (!Number.isFinite(v)) continue;
      records.push({
        rnaPath: rnaPathByParamId.get(pid) ?? `objects["__params__"].values["${pid}"]`,
        time: t,
        value: v,
      });
    }
    sampleCount++;
  }

  // Sort by (rnaPath, time) so consumers can binary-search.
  records.sort((a, b) => (a.rnaPath < b.rnaPath ? -1 : a.rnaPath > b.rnaPath ? 1
    : a.time - b.time));

  return { records, outputParamIds, sampleCount, ruleCount: rules.length };
}

/**
 * Apply a physics bake to an action IN PLACE. Mutates
 * `project.actions[<actionId>].fcurves` to insert/replace the bake's
 * keyforms. NON-physics fcurves on the action are preserved
 * unchanged.
 *
 * The pre-existing fcurves for any baked output paramId ARE replaced
 * (their keyforms cleared, then re-emitted from the bake). Rationale:
 * a partial overlay of new keys on top of old ones would produce a
 * mongrel curve where the old keys interpolate between the new ones,
 * which is never what the user wants from "bake".
 *
 * @param {object} project
 * @param {string} actionId
 * @param {BakePhysicsOptions} [options]
 * @returns {{
 *   sampleCount: number,
 *   keysWritten: number,
 *   outputParamIds: string[],
 *   ruleCount: number,
 * }|null}
 *   `null` when the action doesn't exist or has no animatable shape.
 *   Caller should surface this to the user.
 */
export function applyBakePhysics(project, actionId, options) {
  if (!project || typeof project !== 'object') return null;
  if (typeof actionId !== 'string' || actionId.length === 0) return null;
  if (!Array.isArray(project.actions)) return null;
  const action = project.actions.find((a) => a && a.id === actionId);
  if (!action || !Array.isArray(action.fcurves)) return null;

  const result = bakePhysics(action, project, options ?? {});

  // Clear any pre-existing fcurves whose rnaPath targets a baked
  // output. Bake is destructive on those by design (see header).
  // Bone-output params (ParamRotation_*) now resolve to bone
  // pose.rotation rnaPaths instead of param paths (see
  // `resolveBoneIdForParamRotation` docblock above) — collect both
  // shapes so the destructive clear catches BOTH a previously-baked
  // param fcurve (legacy bakes from before this fix) AND a previously-
  // baked bone-rotation fcurve (post-fix bakes). Also clear the
  // legacy param fcurve for bone outputs so re-baking after the fix
  // wipes the stale data the gap left behind.
  const bakedRnaPaths = new Set();
  for (const pid of result.outputParamIds) {
    bakedRnaPaths.add(`objects["__params__"].values["${pid}"]`);
    const boneId = resolveBoneIdForParamRotation(project, pid);
    if (boneId) bakedRnaPaths.add(`objects["${boneId}"].pose.rotation`);
  }
  action.fcurves = action.fcurves.filter((fc) => !bakedRnaPaths.has(fc?.rnaPath));

  let keysWritten = 0;
  for (const rec of result.records) {
    const r = insertKeyformAtInAction(action, rec.rnaPath, rec.time, rec.value, INSERTKEY_FLAGS.NOFLAGS);
    if (r?.status && r.status.startsWith('skipped-')) continue;
    keysWritten++;
  }

  return {
    sampleCount: result.sampleCount,
    keysWritten,
    outputParamIds: result.outputParamIds,
    ruleCount: result.ruleCount,
  };
}
