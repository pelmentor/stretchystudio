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
 * modules/bpy_extras/anim_utils.py:155-260` for the bake_action /
 * bake_action_objects / bake_action_objects_iter trio, and
 * `:252-678` for `bake_action_iter`). SS's substrate is much
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
 * (`anim_sys.cc:3313-3365` — `animsys_create_action_track_strip`; the
 * function signature opens at :3313, body fills :3319-3364). The
 * synthetic strip uses:
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
 * Post-bake pass that removes redundant adjacent-equal keyframes
 * (audit-fix Slice 4.E HIGH-F1: cite-corrected). Mirrors Blender's
 * inline clean loop in `bake_action_iter` at
 * `bpy_extras/anim_utils.py:657-676` — that loop walks each fcurve's
 * keyframe_points (skipping endpoints), and drops the midpoint when
 * `abs(val - val_prev) + abs(val - val_next) < 0.0001` (a SUM-of-abs-
 * deltas threshold at `1e-4`, NOT the max-of-abs / `1e-6` SS originally
 * shipped — caught by Blender-fidelity audit). SS now matches both
 * formula + epsilon byte-faithfully.
 *
 * **SS DEVIATION 22** (audit-fix Slice 4.E HIGH-F1): Blender's clean
 * loop also EXEMPTS keys whose original value (before bake) was in
 * `fcu_orig_data` — i.e. a hand-authored key with that exact value is
 * never collapsed even if surrounded by flat samples. SS's bake always
 * produces FRESH dense samples (no original keys to exempt), so the
 * exemption path is unreachable + intentionally omitted.
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
 *   - **DEV 21 — Always-include-endpoint sample** (audit-fix Slice 4.E
 *     HIGH-F3): Blender's `bake_action_objects` iterates
 *     `range(self.frame_start, self.frame_end + 1, self.step)` — a
 *     standard Python range that stops at the last `start + k*step <=
 *     end`. For step values that don't divide cleanly into the range,
 *     this SKIPS the endpoint (e.g. start=0, end=10, step=3 → samples
 *     `[0, 3, 6, 9]`, no sample at 10). SS clamps the post-overshoot
 *     sample to `frameEndMs` so the endpoint is ALWAYS sampled. The
 *     extra clamped sample is off-grid but harmless — linear-interp on
 *     the baked fcurve produces correct values between 9 and 10. The
 *     SS choice is user-friendlier ("0..10 means I get a key at 10");
 *     the deviation is honest + intentional.
 *   - **DEV 22 — clean loop omits fcu_orig_data exemption**: see
 *     `cleanCurves` section above.
 *
 * # Audit notes (forward-looking, non-deviations)
 *
 *   - Blender calls `BKE_nla_clip_length_ensure_nonzero` on the
 *     synthetic strip (`anim_sys.cc:3340`) so degenerate
 *     `actstart === actend` actions still yield a 1-frame strip
 *     window. SS doesn't construct a synthetic strip object, so
 *     there's nothing to ensure-nonzero in this layer. If
 *     `readActionFrameRangeMs` ever returns `actstartMs === actendMs`,
 *     the actionExtendmode 'hold' branch still clamps to the
 *     boundary (sampleT becomes actstartMs == actendMs); evaluateFCurve
 *     samples the keyform at that exact time. Behavior is consistent;
 *     just noted for future audits.
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
 *   - `reference/blender/scripts/modules/bpy_extras/anim_utils.py:155-260`
 *     (bake_action @ :155 / bake_action_objects @ :186 /
 *     bake_action_objects_iter @ :215) + `:252-678` (bake_action_iter)
 *   - `reference/blender/scripts/modules/bpy_extras/anim_utils.py:657-676`
 *     (the inline `do_clean` loop — `clean_curves` semantics SS
 *     mirrors with audit-corrected formula + epsilon)
 *   - `reference/blender/source/blender/blenkernel/intern/anim_sys.cc:3313-3365`
 *     (`animsys_create_action_track_strip` — bound action as implicit
 *     top-of-stack strip; audit-fix HIGH-F2 corrected function name
 *     from a fab'd `animsys_construct_orig_action_strip`)
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
import { assignAction } from '../../anim/actionRegistry.js';

/**
 * Numeric epsilon for `cleanCurves` adjacent-equality. Matches Blender's
 * inline `do_clean` loop at `bpy_extras/anim_utils.py:673` which uses
 * the literal `0.0001` as its sum-of-abs-deltas threshold. Audit-fix
 * Slice 4.E HIGH-F1 corrected this from a fab'd `1e-6` cite to
 * `keyframes_general.cc#clean_fcurve_segments` (a function that does
 * not exist) — the bake's clean is in Python, not the C editor helper.
 */
const CLEAN_EPS = 1e-4;

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
  // unknown blendmode is a project-shape bug that must throw, not
  // silently degrade. Audit-fix Slice 4.E HIGH-A1: check is UNCONDITIONAL
  // (was guarded by `boundActionEvaluatable` pre-audit-fix). Project
  // shape correctness is independent of whether the bound action
  // happens to be on the hot path THIS sample — a malformed value
  // surfacing later (e.g. when solo flag clears) would be just as much
  // a Rule №1 violation.
  const actionBlendmode =
    typeof animData.actionBlendmode === 'string'
      ? animData.actionBlendmode
      : 'replace';
  if (actionId !== null
      && !NLA_BLEND_MODES.includes(/** @type any */ (actionBlendmode))) {
    throw new Error(
      `bakeNla: animData.actionBlendmode is `
      + `'${actionBlendmode}' (expected one of ${NLA_BLEND_MODES.join('|')})`
    );
  }
  const actionInfluence =
    typeof animData.actionInfluence === 'number' ? animData.actionInfluence : 1;
  const actionExtendmode =
    typeof animData.actionExtendmode === 'string'
      ? animData.actionExtendmode
      : 'hold';

  // Bound-action frame range (for actionExtendmode gating per audit-fix
  // Slice 4.E HIGH-F4 — Blender's synthetic strip carries
  // `actstart`/`actend` from the action's frame range at
  // `anim_sys.cc:3335-3338` and honors `act_extendmode` at :3345).
  const { actstartMs, actendMs } = boundActionEvaluatable
    ? readActionFrameRangeMs(project, actionId)
    : { actstartMs: 0, actendMs: 0 };

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

    // Step 1: NLA stack contribution. Audit-fix Slice 4.E MED-A2:
    // copy evaluateNla's Map so we honour `bakeNla`'s documented
    // purity contract — even if evaluateNla returns a fresh Map today,
    // a future caching change there would silently corrupt cross-
    // sample state through our `.set` writes below.
    const acc = new Map(evaluateNla(animData, sampleT, project));

    // Step 2: bound-action layer on top (when evaluatable AND active
    // per actionExtendmode). Audit-fix Slice 4.E HIGH-F4: honour
    // `actionExtendmode` (anim_sys.cc:3345 carries it onto the
    // synthetic strip). 'nothing' skips outside [actstart, actend];
    // 'hold' clamps sampleT to the boundary; 'hold_forward' skips
    // before actstart, clamps to actend after.
    if (boundActionEvaluatable && boundActionFcurves.length > 0) {
      let evalT = sampleT;
      let activeForBoundAction = true;
      if (actionExtendmode === 'nothing') {
        if (sampleT < actstartMs || sampleT > actendMs) activeForBoundAction = false;
      } else if (actionExtendmode === 'hold_forward') {
        if (sampleT < actstartMs) activeForBoundAction = false;
        else if (sampleT > actendMs) evalT = actendMs;
      } else {
        // 'hold' (Blender default): always active, clamp outside range
        if (sampleT < actstartMs) evalT = actstartMs;
        else if (sampleT > actendMs) evalT = actendMs;
      }
      if (activeForBoundAction) {
        for (const fc of boundActionFcurves) {
          if (!fc || typeof fc.rnaPath !== 'string') continue;
          const stripValue = evaluateFCurve(fc, evalT);
          const lowerValue = acc.has(fc.rnaPath)
            ? /** @type {number} */ (acc.get(fc.rnaPath))
            : 0;
          acc.set(
            fc.rnaPath,
            applyBlendMode(lowerValue, stripValue, actionBlendmode, actionInfluence)
          );
        }
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
 * Read an action's frame range as `{actstartMs, actendMs}` from the
 * project. Mirrors Blender's `Action::get_frame_range_of_keys(true)` at
 * `anim_sys.cc:3335-3338` (the call site that fills the synthetic
 * action-strip's `actstart`/`actend`). Used by the bound-action
 * actionExtendmode gating in the sample loop (audit-fix Slice 4.E
 * HIGH-F4).
 *
 * Resolution order:
 *   - `action.frameStart` + `action.frameEnd` if both numbers
 *   - `0` + `action.duration` if duration is a positive number
 *   - Scan all fcurves' keyforms for min/max time
 *   - `(0, 0)` if all of the above miss
 *
 * @param {object} project
 * @param {string|null|undefined} actionId
 * @returns {{actstartMs: number, actendMs: number}}
 */
function readActionFrameRangeMs(project, actionId) {
  if (!actionId || !project || !Array.isArray(project.actions)) {
    return { actstartMs: 0, actendMs: 0 };
  }
  for (const a of project.actions) {
    if (!a || a.id !== actionId) continue;
    if (typeof a.frameStart === 'number' && typeof a.frameEnd === 'number') {
      return { actstartMs: a.frameStart, actendMs: a.frameEnd };
    }
    if (typeof a.duration === 'number' && a.duration > 0) {
      return { actstartMs: 0, actendMs: a.duration };
    }
    // Scan fcurves
    let min = Infinity;
    let max = -Infinity;
    const fcs = Array.isArray(a.fcurves) ? a.fcurves : [];
    for (const fc of fcs) {
      const kfs = Array.isArray(fc?.keyforms) ? fc.keyforms : [];
      for (const kf of kfs) {
        if (typeof kf?.time !== 'number') continue;
        if (kf.time < min) min = kf.time;
        if (kf.time > max) max = kf.time;
      }
    }
    if (Number.isFinite(min) && Number.isFinite(max)) {
      return { actstartMs: min, actendMs: max };
    }
    return { actstartMs: 0, actendMs: 0 };
  }
  return { actstartMs: 0, actendMs: 0 };
}

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
 * Remove redundant adjacent-equal samples. Mirrors Blender's inline
 * clean loop at `bpy_extras/anim_utils.py:657-676` byte-faithfully:
 * a midpoint is redundant when `abs(val - val_prev) + abs(val - val_next)
 * < 0.0001` (SUM-of-abs-deltas, NOT max-of-abs). Endpoints are always
 * kept (Blender's loop walks `1..len-2` of the keyframe_points array).
 *
 * Audit-fix Slice 4.E HIGH-F1: formula + epsilon corrected from
 * SS's pre-audit max-of-abs + `1e-6` (which was ~200× stricter than
 * Blender + a different shape entirely).
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
    // Blender anim_utils.py:673 byte-faithful sum-of-abs predicate:
    //   abs(val - val_prev) + abs(val - val_next) < 0.0001
    if (Math.abs(cur.value - prev.value) + Math.abs(cur.value - next.value)
        < CLEAN_EPS) {
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
    // Audit-fix Slice 4.E MED-A4: throw (Rule №1) rather than return
    // null when `project.actions` is not an array. That state indicates
    // a project-shape bug (the v36 migration always installs the
    // array), not a legitimate "nothing to overwrite" condition — the
    // `currentActionId === null` guard above already covers the
    // "nothing to overwrite" case.
    if (!Array.isArray(project.actions)) {
      throw new Error(
        'applyBakeNla: project.actions must be an array (project-shape bug)'
      );
    }
    const found = project.actions.find((a) => a && a.id === currentActionId);
    if (!found) return null;
    found.fcurves = fcurves;
    found.meta = {
      ...(found.meta ?? {}),
      modifiedAt: null,
      source: 'baked',
    };
    // Audit-fix Slice 4.E MED-F2: write frameStart/frameEnd/duration so
    // downstream readers (readActionStartMs/EndMs/DurationMs in
    // nlaEditorOps.js) don't fall back to scanning fcurves for the
    // range. The bake's range IS the action's authoritative range.
    found.frameStart = options.frameStartMs;
    found.frameEnd = options.frameEndMs;
    found.duration = options.frameEndMs - options.frameStartMs;
    actionId = currentActionId;
    action = found;
    replacedActionId = currentActionId;
  } else {
    // Create new action + assign via the registry (audit-fix Slice 4.E
    // HIGH-F5: route through `assignAction` rather than direct-mutating
    // `animData.actionId` / `slotHandle`, so any future Blender-fidelity
    // extension of `assignAction` — `last_slot_identifier`, id-user
    // refcount per actionRegistry.js D-4/D-11 deviations — is inherited
    // cleanly instead of having to fix two call sites).
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
      frameStart: options.frameStartMs,
      frameEnd: options.frameEndMs,
      duration: options.frameEndMs - options.frameStartMs,
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
    // assignAction looks up the action by id — must come AFTER push.
    // Returns false on miss; here we just pushed it, so true is the
    // only honest outcome. If it ever returns false, that's a registry
    // bug worth surfacing.
    const ok = assignAction(project, objectId, newId);
    if (!ok) {
      // Rule №1: rolling back the push keeps the project shape
      // consistent. The registry returning false here would indicate
      // a contract regression we want to surface, not silently swallow.
      project.actions.pop();
      throw new Error(
        `applyBakeNla: assignAction unexpectedly failed for objectId=${objectId}`
      );
    }
    actionId = newId;
    action = created;
    replacedActionId = currentActionId;
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
 * Predicate: would `applyBakeNla` produce a non-empty fcurve set for
 * the given object? Mirrors the `wouldXChange` pattern from
 * `nlaEditorOps.js` (Slice 4.D.3/4.D.4) so the NLAEditor UI can disable
 * the Bake button when nothing would happen.
 *
 * Audit-fix Slice 4.E MED-A1: predicate is now strictly symmetric with
 * `collectRnaPathUniverse`. Returns true when ANY of:
 *   - The Object has a bound `actionId` (non-empty string).
 *   - The Object has at least one NLA strip whose `actionId` is a
 *     non-empty string (strips with `actionId: null` are valid shells
 *     but contribute no rnaPath to the universe, so the bake would
 *     emit zero fcurves on them alone — pre-audit-fix the predicate
 *     returned true for them, gating the UI Bake button to "on" with
 *     no meaningful action).
 *
 * @param {object|null|undefined} animData
 * @returns {boolean}
 */
export function wouldBakeNlaChange(animData) {
  if (!animData || typeof animData !== 'object') return false;
  const hasAction =
    typeof animData.actionId === 'string' && animData.actionId.length > 0;
  if (hasAction) return true;
  const tracks = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : [];
  for (const track of tracks) {
    if (!track || typeof track !== 'object') continue;
    const strips = Array.isArray(track.strips) ? track.strips : [];
    for (const strip of strips) {
      if (
        strip
        && typeof strip.actionId === 'string'
        && strip.actionId.length > 0
      ) {
        return true;
      }
    }
  }
  return false;
}
