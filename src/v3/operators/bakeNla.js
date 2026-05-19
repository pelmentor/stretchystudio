// @ts-check

/**
 * BakeNLA operator — Animation Phase 4 Slice 4.E.
 *
 * "Freeze the runtime NLA stack into a single ground-truth Action."
 * Walks `evaluateNla` (plus the bound-action layer that composes ON TOP
 * of the NLA stack) across a frame range at a fixed step, samples the
 * composed value of every touched rnaPath, and writes the sampled
 * values back as a new Action's FCurves. Used both by the exporter
 * (Phase 4 keeps the exporter NLA-blind — only flat Actions go to
 * `motion3.json`) and as a user-facing "commit" button in the NLAEditor.
 *
 * Loose port of Blender's `NLA_OT_bake` operator (`scripts/startup/
 * bl_operators/anim.py:191-336`), which delegates the heavy lifting to
 * `anim_utils.bake_action_objects` → `bake_action_iter` (`scripts/
 * modules/bpy_extras/anim_utils.py:155-249`). SS's substrate is much
 * smaller than Blender's because:
 *   - SS has no pose bones / armatures / constraints; every animatable
 *     property is addressed by a single rnaPath, so the inner loop is
 *     `rnaPath → number` rather than `Bone × {loc, rot, scale, bbone,
 *     custom_props}`.
 *   - SS's evaluator (`anim/nlaEval.js#evaluateNla`) is already pure
 *     and returns the full per-rnaPath Map at any time. No scene
 *     update / view-layer dependency walk is needed at each sample.
 *
 * # Composition order at each sample (mirrors Blender)
 *
 * Blender composes the bound Action as an implicit top-of-stack strip
 * (`anim_sys.cc:3322-3365` — `animsys_construct_orig_action_strip`).
 * The synthetic strip uses:
 *   - `act_blendmode` / `act_influence` / `act_extendmode` from
 *     AnimData (renamed `actionBlendmode` / `actionInfluence` /
 *     `actionExtendmode` in SS — see `v36_action_datablock.js#defaultAnimData`).
 *   - Spans the action's frame range (Blender uses
 *     `Action::get_frame_range_of_keys`; SS reads
 *     `action.frameStart` / `frameEnd` / `duration` per the v36
 *     Action shape, falling back to scanning all fcurve keyforms).
 *   - Muted when soloing is on (`ADT_FLAG.NLA_SOLO_TRACK`) or when in
 *     tweak mode without `NLA_EVAL_UPPER_TRACKS` (Blender:3354-3358).
 *
 * Per sample frame `t`:
 *   1. `acc := evaluateNla(animData, t, project)` — the NLA stack
 *      contribution (pure; honors solo / mute / tweak-skip / blendin /
 *      blendout / USR_INFLUENCE / USR_TIME / extend modes).
 *   2. If the bound action is evaluatable (see gating below), evaluate
 *      each bound-action FCurve at `t`, then blend the result into `acc`
 *      via `applyBlendMode(lower, value, actionBlendmode, actionInfluence)`.
 *   3. Read `acc[rnaPath]` for every rnaPath in the bake universe; missing
 *      entries default to 0 (SS DEVIATION 18 below).
 *
 * # Bound-action evaluatability gate (Blender anim_sys.cc:3353-3358)
 *
 * The implicit top strip is MUTED — i.e. the bound action's contribution
 * is skipped — when ANY of:
 *   - `animData.actionId === null` (no action to bake)
 *   - `(adtFlag & NLA_SOLO_TRACK) !== 0` (soloing — the bound action is
 *     not on a SOLO track, so it gets occluded)
 *   - `(adtFlag & NLA_EDIT_ON) !== 0` AND `(adtFlag & NLA_EVAL_UPPER_TRACKS) === 0`
 *     (tweak mode without upper-tracks eval flag — Blender skips the
 *     bound action because the tweak strip is on the NLA stack INSTEAD,
 *     and showing the bound action on top would double-count).
 *
 * # rnaPath universe (SS DEVIATION 18 — default-0 for unsampled paths)
 *
 * The bake samples a fixed universe of rnaPaths. The universe is the
 * UNION of:
 *   - Every fcurve in the bound action's `fcurves[]` (when bound action
 *     is evaluatable).
 *   - Every fcurve in every NLA strip's referenced action's `fcurves[]`
 *     (across every track, regardless of mute/solo — the universe is
 *     about which paths COULD be touched, not which ARE at sample t).
 *
 * At sample frame `t`, an rnaPath that isn't touched by any active
 * strip lands in `acc` with no entry. The bake keyform value is `0` in
 * that case — matching `evaluateNla`'s `blendStripIntoAccumulator`
 * default (`acc.has(rnaPath) ? get : 0`). SS deviates from Blender,
 * which reads the property's CURRENT RNA-resolved value as the
 * lower-bound default — SS doesn't have a generic rnaPath → value
 * reader at the substrate layer. Documented at audit-time as
 * **SS DEVIATION 18 — default-0 for unsampled rnaPaths**.
 *
 * # cleanCurves (Blender's `clean_curves` option)
 *
 * Post-bake pass that removes redundant adjacent-equal keyframes (within
 * an epsilon). Mirrors Blender's `clean_action_keys` step in
 * `anim_utils.py` (the operator end of the `do_clean` path). SS uses
 * the same fixed epsilon `1e-6` that Blender's clean uses.
 *
 * # Output FCurve shape
 *
 * Output keyforms are Phase 2 BezTriples with vector handles +
 * `interpolation: 'linear'`. Same shape as `upsertKeyframe` produces
 * for `'linear'` interpolation — matches the rest of the SS animation
 * substrate (Phase 2.A/2.C BezTriple migration). Dense linear samples
 * are the canonical Blender bake output too (linear is the only honest
 * choice for arbitrary sample data).
 *
 * # SS deviations (cumulative this slice)
 *
 *   - **DEV 17 — No per-frame scene update**: Blender's bake_action_iter
 *     calls `scene.frame_set(frame)` + `view_layer.update()` at every
 *     sample so drivers / constraints / physics re-evaluate. SS evaluates
 *     pure (`evaluateNla` is referentially transparent in `(animData,
 *     timeMs, project)`); no scene update is needed because there's no
 *     hidden dependency graph to refresh.
 *   - **DEV 18 — Default-0 for unsampled rnaPaths**: see "rnaPath
 *     universe" above.
 *   - **DEV 19 — Single-object bake**: Blender's `bake_action_objects`
 *     walks N objects in lockstep so cross-object drivers stay coherent
 *     across the bake's "scene at frame F" model. SS bakes one Object
 *     at a time; cross-object drivers (Phase 3) re-resolve naturally
 *     because SS uses pure project reads, not a mutating scene.
 *   - **DEV 20 — Linear-only output interpolation**: Bake output is
 *     always linear-interp BezTriples. Blender bake is the same;
 *     called out explicitly to forestall a future "why aren't baked
 *     curves bezier?" audit.
 *
 * # Cross-references
 *
 *   - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4.E
 *     (lines 1398-1407)
 *   - `src/anim/nlaEval.js` — the evaluator the bake samples through
 *   - `src/anim/fcurve.js` — `evaluateFCurve` for the bound-action
 *     layer + `upsertKeyframe` for the output keyform shape match
 *   - `src/anim/actionRegistry.js` — the action-lifecycle helpers
 *     the project-mutator side wires into
 *   - `reference/blender/scripts/startup/bl_operators/anim.py:191-336`
 *     (NLA_OT_bake operator)
 *   - `reference/blender/scripts/modules/bpy_extras/anim_utils.py:155-249`
 *     (bake_action / bake_action_objects / bake_action_iter)
 *   - `reference/blender/source/blender/blenkernel/intern/anim_sys.cc:3322-3365`
 *     (animsys_construct_orig_action_strip — bound action as implicit
 *     top-of-stack strip)
 *
 * @module v3/operators/bakeNla
 */

import {
  evaluateNla,
  applyBlendMode,
} from '../../anim/nlaEval.js';
import { evaluateFCurve } from '../../anim/fcurve.js';
import {
  ADT_FLAG,
  NLA_BLEND_MODES,
} from '../../anim/nla.js';
import { uid } from '../../lib/ids.js';

/**
 * Numeric epsilon for `cleanCurves` adjacent-equality. Matches Blender's
 * `clean_action_keys` step which uses `1e-6f` (per
 * `reference/blender/source/blender/editors/animation/keyframes_general.cc`
 * `clean_fcurve_segments`).
 */
const CLEAN_EPS = 1e-6;

/**
 * @typedef {Object} BakeNlaOptions
 * @property {number} frameStartMs   - Inclusive lower bound (ms).
 * @property {number} frameEndMs     - Inclusive upper bound (ms);
 *   must be `>= frameStartMs`.
 * @property {number} stepMs         - Sample step (ms); must be `> 0`.
 *   Typical: `1000 / action.fps` (= 41.6̄7ms at 24fps).
 * @property {boolean} [useCurrentAction] - When true, overwrite the
 *   currently-bound action's `fcurves[]` in place (preserving its
 *   `id` + `name`). When false / omitted, create a NEW action and
 *   assign it to the Object via `node.animData.actionId`. Default
 *   `false` (less destructive — matches Blender's default which
 *   creates a new action unless `use_current_action` is set).
 * @property {boolean} [cleanCurves] - Post-process: remove redundant
 *   adjacent-equal keyforms within `CLEAN_EPS`. Default `false`
 *   (matches Blender's `clean_curves: BoolProperty default=False`).
 * @property {string} [bakedName] - Name for the new action.
 *   Default `'Baked Action'`. Ignored when `useCurrentAction=true`.
 */

/**
 * Pure-function bake: produce the FCurve set for the composed NLA-stack-
 * plus-bound-action output of `animData`, across the requested frame
 * range + step.
 *
 * **Pure** — reads `animData` + `project`, returns a fresh array of
 * FCurve objects. Mutates nothing.
 *
 * **Throws (Rule №1):**
 *   - `frameEndMs < frameStartMs`
 *   - `stepMs <= 0`
 *   - `stepMs` non-finite
 *
 * @param {object|null|undefined} animData
 * @param {object} project
 * @param {BakeNlaOptions} options
 * @returns {{
 *   fcurves: object[],
 *   sampleCount: number,
 *   rnaPaths: string[],
 * }}
 */
export function bakeNla(animData, project, options) {
  // Rule №1 input validation. Bad ranges aren't recoverable at the
  // substrate — the caller has authored a UX-impossible request and
  // silently no-oping would mask the bug. Throw with diagnostic.
  if (!options || typeof options !== 'object') {
    throw new Error('bakeNla: options object is required');
  }
  const { frameStartMs, frameEndMs, stepMs } = options;
  if (!Number.isFinite(frameStartMs)) {
    throw new Error(`bakeNla: frameStartMs must be finite (got ${frameStartMs})`);
  }
  if (!Number.isFinite(frameEndMs)) {
    throw new Error(`bakeNla: frameEndMs must be finite (got ${frameEndMs})`);
  }
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new Error(`bakeNla: stepMs must be positive + finite (got ${stepMs})`);
  }
  if (frameEndMs < frameStartMs) {
    throw new Error(
      `bakeNla: frameEndMs (${frameEndMs}) < frameStartMs (${frameStartMs})`
    );
  }

  // Empty animData → empty bake (not an error — bake of a vacuous
  // animation slot is legal; the result is a zero-fcurve action).
  if (!animData || typeof animData !== 'object') {
    return { fcurves: [], sampleCount: 0, rnaPaths: [] };
  }

  // Gate the bound-action layer per Blender's
  // `animsys_construct_orig_action_strip` (anim_sys.cc:3353-3358):
  // bound-action is MUTED when soloing OR (tweaking AND not
  // EVAL_UPPER_TRACKS) OR animData.actionId is null.
  const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
  const soloing = (adtFlag & ADT_FLAG.NLA_SOLO_TRACK) !== 0;
  const tweaking = (adtFlag & ADT_FLAG.NLA_EDIT_ON) !== 0;
  const evalUpperTracks = (adtFlag & ADT_FLAG.NLA_EVAL_UPPER_TRACKS) !== 0;
  const actionId =
    typeof animData.actionId === 'string' && animData.actionId.length > 0
      ? animData.actionId
      : null;

  const boundActionEvaluatable =
    actionId !== null
    && !soloing
    && (!tweaking || evalUpperTracks);

  // Bound-action FCurves (resolved once outside the sample loop).
  const boundActionFcurves = boundActionEvaluatable
    ? getActionFCurves(project, actionId)
    : [];

  // Bound-action blendmode validation: per Rule №1 + the same boundary-
  // check pattern as `evaluateNla` MED-A4 (`nlaEval.js:550-557`), an
  // unknown blendmode here is a project-shape bug that must throw, not
  // silently degrade. Mirrors `nlaEval.js`'s strict check at the entry
  // point.
  const actionBlendmode =
    typeof animData.actionBlendmode === 'string'
      ? animData.actionBlendmode
      : 'replace';
  if (boundActionEvaluatable
      && !NLA_BLEND_MODES.includes(/** @type any */ (actionBlendmode))) {
    throw new Error(
      `bakeNla: animData.actionBlendmode is `
      + `'${actionBlendmode}' (expected one of ${NLA_BLEND_MODES.join('|')})`
    );
  }
  const actionInfluence =
    typeof animData.actionInfluence === 'number' ? animData.actionInfluence : 1;

  // rnaPath universe: UNION of bound-action paths + every NLA strip's
  // action's paths. Walked once; the per-sample loop reads from this
  // fixed set so absent rnaPaths at sample t get the default-0 keyform
  // (SS DEVIATION 18 — see module docstring).
  const rnaPathSet = collectRnaPathUniverse(animData, project, boundActionFcurves);
  /** @type {string[]} */
  const rnaPaths = Array.from(rnaPathSet).sort();

  // Per-rnaPath sample arrays: built up frame-by-frame, then folded
  // into FCurve objects below.
  /** @type {Map<string, Array<{time: number, value: number}>>} */
  const samplesByPath = new Map();
  for (const path of rnaPaths) samplesByPath.set(path, []);

  // Sample loop: inclusive of frameEndMs. The `<= frameEndMs + halfStep`
  // guard handles floating-point drift across many additions of a
  // non-integer step (e.g. 41.6̄7ms × 240 samples accumulates to
  // ~10000.08ms, not 10000ms exact — we want the final sample to land
  // at frameEndMs, not be skipped by a strict `<=` after accumulator
  // drift).
  let sampleCount = 0;
  const halfStep = stepMs * 0.5;
  for (let i = 0; ; i++) {
    const t = frameStartMs + i * stepMs;
    if (t > frameEndMs + halfStep) break;
    // Clamp the last sample to frameEndMs exactly so the bake's
    // keyform timeline ends on the requested boundary.
    const sampleT = t > frameEndMs ? frameEndMs : t;
    sampleCount++;

    // Step 1: NLA stack contribution.
    const acc = evaluateNla(animData, sampleT, project);

    // Step 2: bound-action layer on top (when evaluatable).
    if (boundActionEvaluatable && boundActionFcurves.length > 0) {
      for (const fc of boundActionFcurves) {
        if (!fc || typeof fc.rnaPath !== 'string') continue;
        const stripValue = evaluateFCurve(fc, sampleT);
        const lowerValue = acc.has(fc.rnaPath)
          ? /** @type {number} */ (acc.get(fc.rnaPath))
          : 0;
        acc.set(
          fc.rnaPath,
          applyBlendMode(lowerValue, stripValue, actionBlendmode, actionInfluence)
        );
      }
    }

    // Step 3: record samples for every rnaPath in the universe.
    for (const path of rnaPaths) {
      const value = acc.has(path) ? /** @type {number} */ (acc.get(path)) : 0;
      /** @type {Array<{time: number, value: number}>} */
      const arr = /** @type {any} */ (samplesByPath.get(path));
      arr.push({ time: sampleT, value });
    }

    // Termination: if we just emitted the clamped end sample, stop.
    if (sampleT >= frameEndMs) break;
  }

  // Build output FCurves. Linear-interp BezTriple shape (vector
  // handles) — same as `upsertKeyframe(..., 'linear')` produces.
  /** @type {object[]} */
  const fcurves = [];
  for (const path of rnaPaths) {
    /** @type {Array<{time: number, value: number}>} */
    const samples = /** @type {any} */ (samplesByPath.get(path));
    if (samples.length === 0) continue;
    const keyforms = options.cleanCurves
      ? cleanRedundantSamples(samples)
      : samples;
    fcurves.push({
      id: pathToFcurveId(path),
      rnaPath: path,
      arrayIndex: 0,
      keyforms: keyforms.map((s) => sampleToKeyform(s.time, s.value)),
      modifiers: [],
      extrapolation: 'constant',
    });
  }

  return { fcurves, sampleCount, rnaPaths };
}

/**
 * Resolve the action's fcurves[] by id; empty array on miss. Local
 * copy of the nlaEval helper (private there) so this module stays
 * self-contained — the dependency on `evaluateNla` already pulls
 * `nlaEval.js` in, but its `getActionFCurves` is not exported.
 *
 * @param {object} project
 * @param {string|null|undefined} actionId
 * @returns {Array<object>}
 */
function getActionFCurves(project, actionId) {
  if (!actionId) return EMPTY_FCURVES;
  if (!project || !Array.isArray(project.actions)) return EMPTY_FCURVES;
  for (const a of project.actions) {
    if (a && a.id === actionId) {
      return Array.isArray(a.fcurves) ? a.fcurves : EMPTY_FCURVES;
    }
  }
  return EMPTY_FCURVES;
}
const EMPTY_FCURVES = /** @type {Array<object>} */
  (/** @type {unknown} */ (Object.freeze([])));

/**
 * Walk every strip in every track + the bound action; collect the union
 * of fcurve rnaPaths. Sorted-array conversion happens at the caller.
 *
 * @param {object} animData
 * @param {object} project
 * @param {Array<object>} boundActionFcurves -- already-resolved
 * @returns {Set<string>}
 */
function collectRnaPathUniverse(animData, project, boundActionFcurves) {
  /** @type {Set<string>} */
  const set = new Set();
  for (const fc of boundActionFcurves) {
    if (fc && typeof fc.rnaPath === 'string') set.add(fc.rnaPath);
  }
  const tracks = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : [];
  for (const track of tracks) {
    if (!track || typeof track !== 'object') continue;
    const strips = Array.isArray(track.strips) ? track.strips : [];
    for (const strip of strips) {
      if (!strip || typeof strip !== 'object') continue;
      const stripActionId =
        typeof strip.actionId === 'string' ? strip.actionId : null;
      if (!stripActionId) continue;
      const fcurves = getActionFCurves(project, stripActionId);
      for (const fc of fcurves) {
        if (fc && typeof fc.rnaPath === 'string') set.add(fc.rnaPath);
      }
    }
  }
  return set;
}

/**
 * Stable per-fcurve id derived from rnaPath. Matches the v36 migration's
 * deterministic-id convention (`param:<X>` / `<nodeId>.<prop>`). For
 * raw rnaPaths that don't match either shape, falls back to the rnaPath
 * verbatim — the id is just an identifier, doesn't need to be
 * structured.
 *
 * @param {string} rnaPath
 * @returns {string}
 */
function pathToFcurveId(rnaPath) {
  const paramMatch = rnaPath.match(/^objects\["__params__"\]\.values\["([^"]+)"\]$/);
  if (paramMatch) return `param:${paramMatch[1]}`;
  const propMatch = rnaPath.match(/^objects\["([^"]+)"\]\.(.+)$/);
  if (propMatch) return `${propMatch[1]}.${propMatch[2]}`;
  return rnaPath;
}

/**
 * Build a Phase 2 BezTriple linear-interp keyform. Matches the shape
 * `upsertKeyframe(fcurve, time, value, 'linear')` produces — vector
 * handles at the keyform position, linear interpolation, flag=0.
 *
 * @param {number} time
 * @param {number} value
 * @returns {object}
 */
function sampleToKeyform(time, value) {
  return {
    time,
    value,
    handleLeft: { time, value },
    handleRight: { time, value },
    handleType: { left: 'vector', right: 'vector' },
    interpolation: 'linear',
    flag: 0,
  };
}

/**
 * Remove redundant adjacent-equal samples. Mirrors Blender's
 * `clean_action_keys` (`keyframes_general.cc`): a sample is redundant
 * when its value is within `CLEAN_EPS` of BOTH its previous + next
 * sample's value (a flat plateau midpoint — endpoints are always kept).
 *
 * @param {Array<{time: number, value: number}>} samples
 * @returns {Array<{time: number, value: number}>}
 */
function cleanRedundantSamples(samples) {
  if (samples.length <= 2) return samples;
  /** @type {Array<{time: number, value: number}>} */
  const out = [samples[0]];
  for (let i = 1; i < samples.length - 1; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const next = samples[i + 1];
    if (Math.abs(cur.value - prev.value) < CLEAN_EPS
        && Math.abs(cur.value - next.value) < CLEAN_EPS) {
      continue;
    }
    out.push(cur);
  }
  out.push(samples[samples.length - 1]);
  return out;
}

/**
 * Project mutator: bake the named Object's NLA stack + bound action,
 * then either overwrite the bound action's fcurves (`useCurrentAction`)
 * or create a new action + assign it.
 *
 * Mutates `project` in place — same convention as `actionRegistry.js`,
 * `objectDataAccess.js`, and every other project-shape helper. Returns
 * a small descriptor of what changed so callers (Zustand thunks, UI
 * toasts, undo telemetry) can surface a meaningful result.
 *
 * Returns `null` when:
 *   - `objectId` does not resolve to a node
 *   - the node has no `animData` slot (project-shape bug)
 *   - `options.useCurrentAction === true` AND the node has no
 *     currently-bound `actionId` (nothing to overwrite — would have
 *     to fall back to "create new" silently, which is the kind of
 *     crutch Rule №1 prohibits at the substrate)
 *
 * @param {object} project   - mutated in place
 * @param {string} objectId
 * @param {BakeNlaOptions} options
 * @returns {{
 *   actionId: string,
 *   action: object,
 *   replacedActionId: string|null,
 *   sampleCount: number,
 *   fcurveCount: number,
 * }|null}
 */
export function applyBakeNla(project, objectId, options) {
  if (!project || typeof project !== 'object') return null;
  if (typeof objectId !== 'string' || objectId.length === 0) return null;

  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const node = nodes.find((n) => n && n.id === objectId);
  if (!node) return null;
  if (!node.animData || typeof node.animData !== 'object') return null;

  const animData = node.animData;
  const useCurrent = options.useCurrentAction === true;
  const currentActionId =
    typeof animData.actionId === 'string' && animData.actionId.length > 0
      ? animData.actionId
      : null;

  // Rule №1: useCurrentAction without a current action is a caller bug.
  // No silent fallback to "create new" — return null so the caller knows
  // to surface the error.
  if (useCurrent && currentActionId === null) return null;

  const { fcurves, sampleCount } = bakeNla(animData, project, options);

  // Allocate / locate the destination action.
  let actionId;
  let action;
  /** @type {string|null} */
  let replacedActionId = null;

  if (useCurrent && currentActionId !== null) {
    const actions = Array.isArray(project.actions) ? project.actions : [];
    const found = actions.find((a) => a && a.id === currentActionId);
    if (!found) return null;
    found.fcurves = fcurves;
    found.meta = {
      ...(found.meta ?? {}),
      modifiedAt: null,
      source: 'baked',
    };
    actionId = currentActionId;
    action = found;
    replacedActionId = currentActionId;
  } else {
    // Create new action + assign.
    const newId = uid();
    const baseName =
      typeof options.bakedName === 'string' && options.bakedName.length > 0
        ? options.bakedName
        : 'Baked Action';
    const name = uniqueActionName(project, baseName);
    /** @type {Record<string, *>} */
    const created = {
      id: newId,
      name,
      fps: 24,
      audioTracks: [],
      fcurves,
      flag: 0,
      meta: {
        createdAt: null,
        modifiedAt: null,
        source: 'baked',
      },
    };
    if (!Array.isArray(project.actions)) project.actions = [];
    project.actions.push(created);
    actionId = newId;
    action = created;
    replacedActionId = currentActionId;

    // Assign to the Object's animData slot, replacing whatever was
    // there. (slotHandle stays 0 — same as actionRegistry.js#assignAction
    // default; SS doesn't have a slot table yet per Phase 1 deviation.)
    animData.actionId = newId;
    animData.slotHandle = 0;
  }

  return {
    actionId,
    action,
    replacedActionId,
    sampleCount,
    fcurveCount: fcurves.length,
  };
}

/**
 * Allocate a Blender-style `.NNN` suffix for the new baked action when
 * the base name collides. Local helper rather than re-using
 * `actionRegistry.js#nextDotNNNName` (which is module-private there) —
 * the algorithm is small enough to inline + the bake operator should
 * not have to take a dependency on the registry's private internals.
 *
 * Mirrors Blender's `id_name_final_build` (`main_namemap.cc:441`).
 *
 * @param {object} project
 * @param {string} base
 * @returns {string}
 */
function uniqueActionName(project, base) {
  const actions = Array.isArray(project.actions) ? project.actions : [];
  // Base name doesn't collide → use as-is.
  if (!actions.some((a) => a && a.name === base)) return base;
  const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escapedBase}\\.(\\d{3})$`);
  let max = 0;
  for (const a of actions) {
    if (!a || typeof a.name !== 'string') continue;
    const m = a.name.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > max) max = n;
    }
  }
  return `${base}.${(max + 1).toString().padStart(3, '0')}`;
}

/**
 * Predicate: would `applyBakeNla` produce a meaningful result for the
 * given object? Mirrors the `wouldXChange` pattern from
 * `nlaEditorOps.js` (Slice 4.D.3/4.D.4) so the NLAEditor UI can disable
 * the Bake button when nothing would happen.
 *
 * Returns true when ANY of:
 *   - The Object has a non-empty NLA stack (at least one strip on at
 *     least one track).
 *   - The Object has a bound action (regardless of evaluatability —
 *     bake-of-bound-action is a legitimate "freeze the action with its
 *     post-mod state" workflow).
 *
 * Returns false when both conditions miss (vacuous bake — would
 * produce a zero-fcurve action).
 *
 * @param {object|null|undefined} animData
 * @returns {boolean}
 */
export function wouldBakeNlaChange(animData) {
  if (!animData || typeof animData !== 'object') return false;
  const hasAction =
    typeof animData.actionId === 'string' && animData.actionId.length > 0;
  const tracks = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : [];
  let hasStrip = false;
  for (const track of tracks) {
    if (!track || typeof track !== 'object') continue;
    const strips = Array.isArray(track.strips) ? track.strips : [];
    if (strips.length > 0) { hasStrip = true; break; }
  }
  return hasAction || hasStrip;
}
