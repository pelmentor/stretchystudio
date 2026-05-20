// @ts-check

/**
 * NLA evaluator — Slice 4.B of Animation Phase 4 Blender-Parity Plan.
 *
 * Walks an `animData.nlaTracks[]` stack bottom-to-top, blending each
 * active strip's evaluated action values into a running accumulator
 * keyed by rnaPath. Mirrors Blender's `nlaeval` pipeline:
 *   - `reference/blender/source/blender/blenkernel/intern/nla.cc:707-770`
 *     `nlastrip_get_frame_actionclip` -- strip-time ↔ action-time
 *     mapping with repeat / scale / reverse / cyclic-end-pin
 *   - `reference/blender/source/blender/blenkernel/intern/nla.cc:690-697`
 *     `BKE_nlatrack_is_enabled` -- mute / solo gating (solo trumps mute)
 *   - `reference/blender/source/blender/blenkernel/intern/anim_sys.cc:1009-1027`
 *     `nlastrip_get_influence` -- blendin / blendout ramps
 *   - `reference/blender/source/blender/blenkernel/intern/anim_sys.cc:1841-1873`
 *     `nla_blend_value` -- 4 blend mode kernels (replace / add /
 *     subtract / multiply; combine deferred per Slice 4.A audit)
 *   - `reference/blender/source/blender/blenkernel/intern/anim_sys.cc:1086-1148`
 *     extend-mode strip activation gating (HOLD / HOLD_FORWARD / NOTHING)
 *
 * # Pure function, ms canonical
 *
 * `evaluateNla(animData, timeMs, project)` is pure: reads inputs, returns
 * `Map<rnaPath, number>`. Mutates nothing. Per
 * `feedback_ms_canonical_animation_time`, every time field on
 * NlaStrip + the `timeMs` argument are milliseconds. The `repeat` /
 * `scale` factors are unitless; the conversion from ms → action-local
 * ms uses the strip's own ms-typed `start` / `end` / `actstart` /
 * `actend`.
 *
 * # Tweak-mode gating
 *
 * If `animData.flag & ADT_FLAG.NLA_EDIT_ON` is set, the strip
 * identified by `animData.tweakStripId` (on the track identified by
 * `animData.tweakTrackId`) is SKIPPED during the stack walk -- it
 * represents the action being live-edited at the topmost layer
 * (Slice 4.C will wire that topmost layer separately). The
 * `NLATRACK_DISABLED` flag is also honored as a per-track skip.
 *
 * # Blend kernels (byte-faithful)
 *
 *   'replace'  → lower * (1 - inf) + strip * inf                  (LERP)
 *   'add'      → lower + strip * inf
 *   'subtract' → lower - strip * inf
 *   'multiply' → inf * (lower * strip) + (1 - inf) * lower
 *
 * All four early-out on `inf == 0` returning `lower_value` unchanged
 * (matches Blender `anim_sys.cc:1847`).
 *
 * # Influence sources (precedence)
 *
 * 1. If `strip.flag & NLASTRIP_FLAG_USR_INFLUENCE`, read the
 *    `influence` channel from a per-strip fcurve (rnaPath matches
 *    `'influence'`) and clamp [0, 1].
 * 2. Else compute from `strip.influence` (baseline 0..1) modulated by
 *    blendin / blendout ramps -- inside blendin range, ramp 0 → 1;
 *    inside blendout range, ramp 1 → 0; otherwise full strength.
 *
 * @module anim/nlaEval
 */

import { evaluateFCurve } from './fcurve.js';
import {
  NLA_BLEND_MODES,
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
  getNlaTracks,
  isTweakModeOn,
} from './nla.js';

/**
 * Resolve an Action by id from a project (defensive — null on miss).
 *
 * Walks `project.actions[]`. The result is the Action's `fcurves`
 * array (or empty array on miss). Centralised so the evaluator
 * doesn't have to know the project shape beyond `project.actions`.
 *
 * @param {{actions?: Array<{id: string, fcurves?: Array<object>}>}} project
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

/** @type {Array<object>} */
const EMPTY_FCURVES = /** @type {Array<object>} */
  (/** @type {unknown} */ (Object.freeze([])));

/**
 * Is the track enabled (should evaluate) given the AnimData state?
 *
 * Byte-faithful port of Blender's `BKE_nlatrack_is_enabled`
 * (`nla.cc:690-697`):
 *   - If AnimData has `NLA_SOLO_TRACK` set, ONLY tracks with the
 *     `NLATRACK_SOLO` bit evaluate (all others skip).
 *   - Else, tracks with `NLATRACK_MUTED` skip; everyone else evaluates.
 *
 * `NLATRACK_DISABLED` is checked separately at the evaluator entry
 * point -- it's a transient tweak-mode flag, not part of the
 * persistent mute/solo state.
 *
 * @param {object} animData
 * @param {object} track
 * @returns {boolean}
 */
function isTrackEnabled(animData, track) {
  const trackFlag = typeof track.flag === 'number' ? track.flag : 0;
  if (trackFlag & NLATRACK_FLAG.DISABLED) return false;

  const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
  if (adtFlag & ADT_FLAG.NLA_SOLO_TRACK) {
    return (trackFlag & NLATRACK_FLAG.SOLO) !== 0;
  }
  return (trackFlag & NLATRACK_FLAG.MUTED) === 0;
}

/**
 * Order tracks bottom-to-top by `index` (ascending). Lower `index`
 * evaluates first, then higher indices blend on top. Matches Blender's
 * linked-list order where the head of `nla_tracks` is bottom-most.
 *
 * Returns a NEW sorted array — does NOT mutate the input. Stable when
 * indices tie (rare; UI doesn't allow it but defensive code paths
 * might).
 *
 * @param {Array<object>} tracks
 * @returns {Array<object>}
 */
function tracksBottomToTop(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return EMPTY_TRACKS;
  // Slice + sort, never mutate caller's array.
  return tracks.slice().sort((a, b) => {
    const ai = typeof a?.index === 'number' ? a.index : 0;
    const bi = typeof b?.index === 'number' ? b.index : 0;
    return ai - bi;
  });
}

const EMPTY_TRACKS = /** @type {Array<object>} */
  (/** @type {unknown} */ (Object.freeze([])));

/**
 * Map global time → action-local time for a single strip.
 *
 * Byte-faithful port of `nlastrip_get_frame_actionclip`
 * (`nla.cc:707-770`), `NLATIME_CONVERT_EVAL` branch only — SS doesn't
 * need MAP / UNMAP yet (those serve the Graph Editor's strip-overlay
 * UI, which is Slice 4.D).
 *
 * Behavior:
 *   - `scale` of 0 → coerced to 1 (Blender defensive default at :720)
 *   - `repeat` of 0 → coerced to 1 (Blender :713)
 *   - `REVERSE` flag swaps direction (plays end → start)
 *   - End-of-strip pin: if `timeMs == strip.end` AND `repeat` is an
 *     integer, returns `actend` directly to prevent snap-back to
 *     `actstart` (Blender :759-764 special case)
 *   - General case: `actstart + fmod(timeMs - start, actlength * scale) / scale`
 *
 * **USR_TIME override** (audit-fix Slice 4.B MED-F4): If
 * `strip.flag & NLASTRIP_FLAG.USR_TIME`, look up a per-strip FCurve
 * with `rnaPath === 'strip_time'`, evaluate it at `timeMs`, and use
 * THAT as the action-local time directly — bypassing the entire
 * scale/repeat/reverse pipeline. If `USR_TIME_CYCLIC` is ALSO set,
 * wrap the result back into `[actstart, actend)` via positive modulo
 * (Blender `anim_sys.cc:1069-1071`). Centralised here so callers
 * don't duplicate the lookup; the substrate flag enum has exposed
 * USR_TIME since 4.A so honoring it is Rule №1-correct.
 *
 * Returns the action-local time in ms. Caller passes this to
 * `evaluateFCurve(fc, actionLocalMs)`.
 *
 * @param {object} strip
 * @param {number} timeMs -- ms global
 * @returns {number}    -- ms action-local
 */
export function remapStripTime(strip, timeMs) {
  const stripFlag = typeof strip.flag === 'number' ? strip.flag : 0;

  const actstart = typeof strip.actstart === 'number' ? strip.actstart : 0;
  const actend   = typeof strip.actend === 'number' ? strip.actend : 0;

  // USR_TIME override (Blender anim_sys.cc:1059): bypass the
  // scale/repeat math entirely; per-strip FCurve drives action-local
  // time directly. USR_TIME_CYCLIC (Blender :1069) wraps the result
  // back into [actstart, actend) so a steadily-incrementing user
  // time-fcurve produces a cyclic action play-through.
  if (stripFlag & NLASTRIP_FLAG.USR_TIME) {
    const localFcurves = Array.isArray(strip.fcurves) ? strip.fcurves : null;
    if (localFcurves) {
      for (const fc of localFcurves) {
        if (fc && fc.rnaPath === 'strip_time') {
          let userTime = evaluateFCurve(fc, timeMs);
          if (stripFlag & NLASTRIP_FLAG.USR_TIME_CYCLIC) {
            const actlen = Math.max(actend - actstart, 1e-10);
            userTime = actstart + mod(userTime - actstart, actlen);
          }
          return userTime;
        }
      }
    }
    // USR_TIME set but no strip_time fcurve — fall through to default
    // scale/repeat path. Mirrors Blender's behavior where the flag-
    // enabled control was authored but the driving fcurve is missing
    // (RNA assignment never happens; strip->strip_time keeps prior
    // value, which for first eval == 0; SS gives the more useful
    // fallback to scale/repeat instead of silently zeroing).
  }

  let scale = typeof strip.scale === 'number' ? strip.scale : 1;
  if (Math.abs(scale) < 1e-10) scale = 1;
  scale = Math.abs(scale);   // negative scale handled via REVERSE flag

  let repeat = typeof strip.repeat === 'number' ? strip.repeat : 1;
  if (Math.abs(repeat) < 1e-10) repeat = 1;

  const start    = typeof strip.start === 'number' ? strip.start : 0;
  const end      = typeof strip.end === 'number' ? strip.end : 0;

  const actlength = Math.max(actend - actstart, 1e-10);   // BKE_nla_clip_length_get_nonzero
  const reversed = (stripFlag & NLASTRIP_FLAG.REVERSE) !== 0;

  // End-of-strip pin (Blender nla.cc:759-764 / :739-744 reversed)
  const repeatIsInteger = Math.abs(repeat - Math.floor(repeat)) < 1e-10;
  if (reversed) {
    if (Math.abs(timeMs - end) < 1e-10 && repeatIsInteger) {
      return actstart;
    }
    // nla.cc:749 — reversed: actend - fmod(t - start, actlength * scale) / scale
    return actend - mod(timeMs - start, actlength * scale) / scale;
  }
  if (Math.abs(timeMs - end) < 1e-10 && repeatIsInteger) {
    return actend;
  }
  // nla.cc:769 — forward: actstart + fmod(t - start, actlength * scale) / scale
  return actstart + mod(timeMs - start, actlength * scale) / scale;
}

/**
 * Positive-modulo helper (JavaScript's `%` is sign-preserving;
 * Blender's `fmodf` returns the same sign as the dividend, so for
 * negative `timeMs - start` we'd get a negative result. We want the
 * strict mathematical modulo so values pre-strip-start wrap correctly
 * within the action.)
 *
 * NOTE: Blender's `fmodf(-1.5, 1.0)` actually returns -0.5 (sign of
 * dividend) — same as JS `%`. SS could mirror that exactly, but for
 * the SS use case where time before strip.start should never enter
 * `remapStripTime` (the activation gate filters it), this divergence
 * is unreachable on valid inputs. Documented for the audit trail.
 *
 * @param {number} a
 * @param {number} n
 * @returns {number}
 */
function mod(a, n) {
  return ((a % n) + n) % n;
}

/**
 * Compute the strip's influence at a given time.
 *
 * Two sources, in precedence order:
 *
 * 1. **USR_INFLUENCE override**: if `strip.flag & NLASTRIP_FLAG.USR_INFLUENCE`
 *    AND the strip has a per-strip FCurve with `rnaPath === 'influence'`,
 *    evaluate that FCurve at `timeMs` and clamp [0, 1].
 *
 * 2. **Baseline + blend ramps**: `strip.influence` (default 1.0)
 *    modulated by:
 *      - blendin ramp: while `timeMs ∈ [start, start + blendin]`,
 *        scale by `(timeMs - start) / blendin` so influence ramps 0 → 1
 *      - blendout ramp: while `timeMs ∈ [end - blendout, end]`, scale
 *        by `(end - timeMs) / blendout` so influence ramps 1 → 0
 *    Outside both ramps, full strength.
 *
 * Blender source: `anim_sys.cc:1009-1027` (`nlastrip_get_influence`).
 *
 * @param {object} strip
 * @param {number} timeMs
 * @returns {number} influence in [0, 1]
 */
export function computeStripInfluence(strip, timeMs) {
  const stripFlag = typeof strip.flag === 'number' ? strip.flag : 0;

  // USR_INFLUENCE path: per-strip FCurve named 'influence'
  if (stripFlag & NLASTRIP_FLAG.USR_INFLUENCE) {
    const localFcurves = Array.isArray(strip.fcurves) ? strip.fcurves : null;
    if (localFcurves) {
      for (const fc of localFcurves) {
        if (fc && fc.rnaPath === 'influence') {
          const v = evaluateFCurve(fc, timeMs);
          return Math.max(0, Math.min(1, v));
        }
      }
    }
    // USR_INFLUENCE set but no influence fcurve — fall through to baseline
  }

  const baseline = typeof strip.influence === 'number' ? strip.influence : 1;
  const blendin = Math.abs(typeof strip.blendin === 'number' ? strip.blendin : 0);
  const blendout = Math.abs(typeof strip.blendout === 'number' ? strip.blendout : 0);
  const start = typeof strip.start === 'number' ? strip.start : 0;
  const end = typeof strip.end === 'number' ? strip.end : 0;

  // Blendin ramp (Blender anim_sys.cc:1016)
  if (blendin > 1e-10 && timeMs <= start + blendin) {
    const ramp = Math.abs(timeMs - start) / blendin;
    return baseline * ramp;
  }
  // Blendout ramp (Blender anim_sys.cc:1020)
  if (blendout > 1e-10 && timeMs >= end - blendout) {
    const ramp = Math.abs(end - timeMs) / blendout;
    return baseline * ramp;
  }
  // Mid-strip: full strength
  return baseline;
}

/**
 * Is the strip active at the given time (should evaluate)?
 *
 * Honors `extendmode` per Blender `anim_sys.cc:1086-1148`:
 *   - `'hold'`         (NLASTRIP_EXTEND_HOLD = 0): active inside
 *     [start, end]; before the first strip in a track, hold backwards
 *     (act as if time is at `start`); after the last strip, hold forward
 *     (act as if time is at `end`)
 *   - `'hold_forward'` (NLASTRIP_EXTEND_HOLD_FORWARD = 1): active for
 *     timeMs >= start; "ends" the strip's contribution at `end` unless
 *     it's the last strip (then holds forward)
 *   - `'nothing'`      (NLASTRIP_EXTEND_NOTHING = 2): active strictly
 *     within [start, end]
 *
 * SS simplification (deviation, documented): we don't yet have
 * transition strips or multi-strip-per-track first/last detection. This
 * helper treats each strip independently — if `timeMs ∈ [start, end]`
 * the strip is active; otherwise the extendmode rules apply per-strip
 * without neighbor awareness. Slice 4.D may need to refine this if
 * the NLAEditor surfaces multi-strip tracks with extend-hold gaps.
 *
 * @param {object} strip
 * @param {number} timeMs
 * @returns {boolean}
 */
export function stripActiveAt(strip, timeMs) {
  const start = typeof strip.start === 'number' ? strip.start : 0;
  const end = typeof strip.end === 'number' ? strip.end : 0;

  // Zero-length strip is a no-op (Blender skips these too)
  if (Math.abs(end - start) < 1e-10) return false;

  // In-range always evaluates
  if (timeMs >= start && timeMs <= end) return true;

  const extendmode = typeof strip.extendmode === 'string' ? strip.extendmode : 'hold';
  if (extendmode === 'nothing') return false;

  // hold + hold_forward both pin the END (timeMs > end → evaluate at end)
  if (timeMs > end) return true;
  // hold (only) pins the START backward (timeMs < start → evaluate at start)
  if (extendmode === 'hold' && timeMs < start) return true;

  return false;
}

/**
 * Clamp `timeMs` to the strip's strip-time domain for evaluation.
 *
 * When the strip is active outside its [start, end] range (via
 * `extendmode`), the action sample should come from the boundary
 * rather than be extrapolated forever. This matches Blender's
 * `nlastrip_evaluate_actionclip` clamping behavior.
 *
 * @param {object} strip
 * @param {number} timeMs
 * @returns {number}
 */
function clampStripTime(strip, timeMs) {
  const start = typeof strip.start === 'number' ? strip.start : 0;
  const end = typeof strip.end === 'number' ? strip.end : 0;
  if (timeMs < start) return start;
  if (timeMs > end) return end;
  return timeMs;
}

/**
 * Apply a single strip's blend operation to the accumulator. **Mutates
 * `acc` in place** for performance — `evaluateNla` owns the Map and
 * re-reads it each iteration; no other caller holds a reference, so
 * the new-Map-per-strip pattern (pre-audit-fix HIGH-A1) was pure
 * allocation overhead with no observable purity benefit.
 *
 * For each fcurve in the strip's action, the rnaPath is the key. The
 * blend kernel matches Blender's `nla_blend_value`
 * (`anim_sys.cc:1841-1873`):
 *
 *   replace  → lower * (1 - inf) + strip * inf   (LERP)
 *   add      → lower + strip * inf
 *   subtract → lower - strip * inf
 *   multiply → inf * (lower * strip) + (1 - inf) * lower
 *
 * If a key is absent from `acc`, the fallback lower-value is 0
 * (which for REPLACE means the strip value scales by influence
 * alone -- the rest-value contribution is 0).
 *
 * **SS deviation**: For the 4 ship-modes, SS uses 0 as the
 * lower-value default. Blender uses the channel's RNA-resolved
 * default (its current property value pre-NLA). SS doesn't have
 * RNA default resolution at the substrate level; the eval consumer
 * (Slice 4.B+ caller chain) is expected to pre-seed `acc` with
 * rest values if it needs Blender-faithful "blend onto rest" semantics.
 * Documented + tested.
 *
 * @param {Map<string, number>} acc — mutated in place
 * @param {Array<object>} fcurves -- the strip's action's fcurves
 * @param {number} actionLocalMs
 * @param {string} blendmode
 * @param {number} influence
 * @returns {void}
 */
function blendStripIntoAccumulator(acc, fcurves, actionLocalMs, blendmode, influence) {
  // Blender optimization: influence == 0 → no contribution (anim_sys.cc:1847)
  if (Math.abs(influence) < 1e-10) return;

  for (const fc of fcurves) {
    if (!fc || typeof fc.rnaPath !== 'string') continue;
    // mesh_verts fcurves carry per-vertex `[{x,y},...]` arrays, not a
    // scalar — `applyBlendMode`'s arithmetic would yield NaN. The NLA
    // accumulator is scalar-only (Map<rnaPath, number>); mesh-deform
    // animation is evaluated separately via `interpolateMeshVerts`, not
    // through the NLA scalar blend stack. Skip them (mirrors the depgraph
    // animation kernel's mesh_verts skip). Before mesh_verts keyforms
    // were storable this loop never received a populated mesh curve.
    if (fc.rnaPath.endsWith('.mesh_verts')) continue;
    const stripValue = evaluateFCurve(fc, actionLocalMs);
    const lowerValue = acc.has(fc.rnaPath) ? /** @type {number} */ (acc.get(fc.rnaPath)) : 0;
    acc.set(fc.rnaPath, applyBlendMode(lowerValue, stripValue, blendmode, influence));
  }
}

/**
 * The 4 blend mode kernels. Exported so consumers (tests, Slice 4.E
 * BakeNLA operator that needs identical math) hit the same code.
 *
 * @param {number} lower
 * @param {number} strip
 * @param {string} blendmode
 * @param {number} influence
 * @returns {number}
 */
export function applyBlendMode(lower, strip, blendmode, influence) {
  if (Math.abs(influence) < 1e-10) return lower;
  switch (blendmode) {
    case 'add':
      return lower + strip * influence;
    case 'subtract':
      return lower - strip * influence;
    case 'multiply':
      return influence * (lower * strip) + (1 - influence) * lower;
    case 'replace':
    default:
      // LERP — Blender anim_sys.cc:1871
      return lower * (1 - influence) + strip * influence;
  }
}

/**
 * Evaluate an entire NLA stack at the given time.
 *
 * Walks `animData.nlaTracks[]` bottom-to-top (ascending `index`),
 * skipping muted / disabled tracks and (when solo is on) all
 * non-solo tracks. For each remaining track, walks its `strips[]` in
 * order; for each active + non-muted strip, computes the influence +
 * action-local time, evaluates the strip's action's fcurves, and
 * blends each fcurve's value into the running accumulator keyed by
 * rnaPath.
 *
 * Tweak mode (`ADT_FLAG.NLA_EDIT_ON`): the strip identified by
 * `animData.tweakStripId` is skipped — Slice 4.C will inject it as
 * the topmost implicit layer.
 *
 * Returns `Map<rnaPath, number>` (empty Map if no tracks contribute).
 *
 * @param {object|null|undefined} animData
 * @param {number} timeMs
 * @param {object} project
 * @returns {Map<string, number>}
 */
export function evaluateNla(animData, timeMs, project) {
  /** @type {Map<string, number>} */
  const acc = new Map();
  if (!animData || typeof animData !== 'object') return acc;

  // NLA_EVAL_OFF entirely skips evaluation (Blender ADT_NLA_EVAL_OFF
  // semantic — DNA_anim_enums.h:557).
  const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
  if (adtFlag & ADT_FLAG.NLA_EVAL_OFF) return acc;

  // Tweak-mode strip-skip router. Audit-fix HIGH-A2: use a strict
  // `!== null && length > 0` check rather than `if (tweakStripId && ...)`
  // — raw-deserialized animData (migration output / hand-edited JSON)
  // could carry `tweakStripId: ''` which would silently bypass the
  // skip under the old `&&` falsy guard.
  const tweakOn = isTweakModeOn(animData);
  const rawTweakStripId = animData.tweakStripId;
  /** @type {string|null} */
  const tweakStripId = (
    tweakOn
    && typeof rawTweakStripId === 'string'
    && rawTweakStripId.length > 0
  ) ? rawTweakStripId : null;

  const tracks = tracksBottomToTop(getNlaTracks(animData));
  for (const track of tracks) {
    if (!isTrackEnabled(animData, track)) continue;
    const strips = Array.isArray(track.strips) ? track.strips : null;
    if (!strips) continue;
    for (const strip of strips) {
      if (!strip || typeof strip !== 'object') continue;
      const stripFlag = typeof strip.flag === 'number' ? strip.flag : 0;
      if (stripFlag & NLASTRIP_FLAG.MUTED) continue;
      // Tweak-mode: skip the strip being live-edited.
      if (tweakStripId !== null && strip.id === tweakStripId) continue;
      if (!stripActiveAt(strip, timeMs)) continue;

      // Audit-fix MED-A5: SS deviation from Blender's `IS_EQF`
      // epsilon-equal-zero gate. Blender (`anim_sys.cc:1180`) early-
      // outs only at exact zero; SS skips ANY non-positive influence
      // (`<= 0`). The divergence only matters for negative-baseline-
      // influence inputs which `makeNlaStrip` would never produce
      // (USR_INFLUENCE path clamps to [0,1] explicitly); the more
      // aggressive skip is a defense against hand-edited / migration-
      // corrupt strip data and is the Rule №1-correct safety choice.
      const influence = computeStripInfluence(strip, timeMs);
      if (influence <= 0) continue;

      const stripClampedTime = clampStripTime(strip, timeMs);
      const actionLocalMs = remapStripTime(strip, stripClampedTime);
      const fcurves = getActionFCurves(project, /** @type {string} */ (strip.actionId));
      if (fcurves.length === 0) continue;

      // Audit-fix MED-A4: Rule №1 — validate blendmode at the entry
      // point rather than letting `applyBlendMode`'s kernel default-
      // branch silently degrade unknown values. The kernel keeps its
      // hot-path-clean structure (Blender `nla_blend_value` itself
      // has a `default → LERP` fallback at `anim_sys.cc:1866-1872`).
      // SS rejects malformed inputs at the boundary so the kernel
      // can stay fast.
      const blendmode = typeof strip.blendmode === 'string' ? strip.blendmode : null;
      if (blendmode === null || !NLA_BLEND_MODES.includes(/** @type any */ (blendmode))) {
        throw new Error(
          `evaluateNla: strip id=${strip.id} has invalid blendmode `
          + `'${blendmode}' (expected one of ${NLA_BLEND_MODES.join('|')}; `
          + `'combine' is deferred per plan §4.B)`
        );
      }

      blendStripIntoAccumulator(acc, fcurves, actionLocalMs, blendmode, influence);
    }
  }
  return acc;
}
