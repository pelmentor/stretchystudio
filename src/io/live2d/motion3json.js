/**
 * Generate .motion3.json files from Stretchy Studio actions.
 *
 * v36 actions hold FCurves keyed by rnaPath. Each fcurve targets either
 * a parameter (`objects["__params__"].values["<paramId>"]`) or an object
 * property (`objects["<nodeId>"].<property>`). decodeFCurveTarget recovers
 * the legacy paramId / nodeId+property fields for the segment encoder.
 *
 * Live2D .motion3.json animates Parameters and Part opacities via "Curves"
 * with a flat segment-encoded array.
 *
 * For MVP, we convert simple object-property fcurves (opacity) to Live2D
 * curves. Vertex-level animation (mesh_verts) requires parameter-based
 * keyforms in the .moc3, which is handled separately by the moc3 writer.
 *
 * Segment encoding:
 *   - First two values: [startTime, startValue]
 *   - Then repeating: [segmentType, ...points]
 *     - 0 (linear):          0, time, value
 *     - 1 (bezier):          1, cx1, cy1, cx2, cy2, time, value
 *     - 2 (stepped):         2, time, value
 *     - 3 (inverse stepped): 3, time, value
 *
 * Reference: reference/live2d-sample/Hiyori/runtime/motion/hiyori_m01.motion3.json
 *
 * # Loop semantics — Slice 3.D (Cycles → IsLoop)
 *
 * Cubism's `.motion3.json` carries `Meta.Loop: bool` which causes the
 * runtime to re-evaluate the curve modulo `Meta.Duration`. SS drives
 * this from the Cycles FModifier per Animation Blender-Parity Plan
 * §3.D:
 *
 *   - **All fcurves** in the action carry a non-muted head-of-stack
 *     `Cycles` modifier with `before='none', after='repeat',
 *     afterCycles=0` (= cycle the whole curve forward forever from the
 *     last keyform) → `Loop: true`. The original keyforms ship as-is;
 *     no bake.
 *   - **Some** fcurves cycle, **others don't** → `Loop: false`. The
 *     cycling fcurves are baked into explicit keyforms at the action's
 *     FPS (via `evaluateFCurve`, which applies every FModifier on the
 *     fcurve as a side effect). Non-cycling fcurves ship as-is.
 *   - **No** fcurves cycle → `Loop: false`.
 *
 * `action.flag & ACT_CYCLIC` (`v36_action_datablock.js:325-329`) is
 * still reserved but NOT read here — the bit is the action-level
 * counterpart to per-curve Cycles (Blender uses both: ACT_CYCLIC for
 * "Action is intended to loop", Cycles for "extrapolate this curve").
 * Per plan §3.D the per-curve signal is authoritative for IsLoop; the
 * ACT_CYCLIC integration ships with the ActionsEditor Cyclic-toggle UI
 * in a later slice (and will OR-compose with the Cycles signal at that
 * point: `Loop = ACT_CYCLIC || allFCurvesCycle`).
 *
 * # Bake scope — only Cycles in Slice 3.D
 *
 * The bake helper `bakeFCurveModifiers` calls `evaluateFCurve`, which
 * applies the full FModifier stack (Cycles + Noise + Generator + Limits
 * + Stepped + Envelope). However the **trigger** in this slice is
 * narrow: bake only when an fcurve has an active Cycles modifier AND
 * the action isn't uniformly looping. Per plan §3.E, Noise gets its
 * own unconditional bake trigger in a follow-up slice; until then,
 * Noise (and other modifiers) on non-Cycles fcurves are silently
 * dropped from the export. Acceptable for 3.D scope — the alternative
 * is gold-plating cross-slice and bleeds 3.E's substrate into 3.D.
 *
 * @module io/live2d/motion3json
 */

import { decodeFCurveTarget } from '../../anim/animationFCurve.js';
import { evaluateFCurve } from '../../anim/fcurve.js';
import { evaluateBezTripleSegment } from '../../anim/fcurveEval.js';
import { logger } from '../../lib/logger.js';

/**
 * Convert a Stretchy Studio action to .motion3.json format.
 *
 * @param {object} action - From project.actions[]
 * @param {object} [opts]
 * @param {Map<string, string>} [opts.parameterMap] - nodeId+property → Live2D parameter ID
 * @returns {object} JSON-serializable .motion3.json structure
 */
export function generateMotion3Json(action, opts = {}) {
  const { parameterMap = new Map() } = opts;
  const durationMs = action.duration ?? 2000;
  const durationSec = durationMs / 1000;
  const fps = action.fps ?? 24;

  // 3.D — Cycles → IsLoop. `loop=true` requires a uniform head-of-stack
  // Cycles modifier on every fcurve; otherwise per-fcurve bake handles
  // the cycling channels in-place. See module JSDoc "Loop semantics".
  const loop = actionHasUniformLoopingCycles(action);

  const curves = [];
  let totalSegmentCount = 0;
  let totalPointCount = 0;

  for (const fcurve of (action.fcurves ?? [])) {
    const target = decodeFCurveTarget(fcurve);
    if (!target) continue;

    // 3.D — bake Cycles modifier into explicit keyforms when the action
    // isn't uniformly looping. Bake is a no-op when fcurve has no active
    // Cycles modifier (other modifier types deferred to 3.E+; see module
    // JSDoc "Bake scope"). `effectiveFCurve.keyforms` flows downstream
    // exactly like the original.
    const effectiveFCurve = (!loop && hasActiveCyclesModifier(fcurve))
      ? bakeFCurveModifiers(fcurve, durationMs, fps)
      : fcurve;

    // Parameter fcurves — first-class Live2D parameter animation, emitted
    // directly without going through the SS node→param mapping. Used by
    // the idle generator and any AI-driven motion that targets standard
    // Live2D parameters (ParamAngleX, ParamBreath, etc.) by ID.
    if (target.kind === 'param') {
      const segments = encodeKeyframesToSegments(effectiveFCurve.keyforms ?? [], durationSec);
      if (segments.length === 0) continue;
      const segInfo = countSegmentsAndPoints(segments);
      totalSegmentCount += segInfo.segments;
      totalPointCount += segInfo.points;
      curves.push({ Target: 'Parameter', Id: target.paramId, Segments: segments });
      continue;
    }

    // mesh_verts fcurves → parameter curve driving warp deformer keyform index
    if (target.property === 'mesh_verts') {
      const key = `${target.nodeId}.mesh_verts`;
      if (!parameterMap.has(key)) continue;
      const paramId = parameterMap.get(key);
      const kfs = effectiveFCurve.keyforms;
      if (!kfs || kfs.length < 2) continue;

      // Convert time-based keyforms to index-based segments:
      // keyform[0] at its time → value 0, keyform[1] at its time → value 1, etc.
      const indexKeyframes = kfs.map((kf, idx) => ({
        time: kf.time,
        value: idx,
        interpolation: kf.interpolation ?? 'linear',
      }));
      const segments = encodeKeyframesToSegments(indexKeyframes, durationSec);
      if (segments.length === 0) continue;

      const segInfo = countSegmentsAndPoints(segments);
      totalSegmentCount += segInfo.segments;
      totalPointCount += segInfo.points;

      curves.push({ Target: 'Parameter', Id: paramId, Segments: segments });
      continue;
    }

    // Determine the Live2D target and ID for this fcurve
    const mapping = resolveFCurveMapping(target, parameterMap);
    if (!mapping) continue;

    const { target: live2dTarget, id } = mapping;
    const segments = encodeKeyframesToSegments(effectiveFCurve.keyforms, durationSec);

    if (segments.length === 0) continue;

    // Count segments and points for metadata
    const segInfo = countSegmentsAndPoints(segments);
    totalSegmentCount += segInfo.segments;
    totalPointCount += segInfo.points;

    curves.push({
      Target: live2dTarget,
      Id: id,
      Segments: segments,
    });
  }

  return {
    Version: 3,
    Meta: {
      Duration: durationSec,
      Fps: fps,
      Loop: loop,
      AreBeziersRestricted: false,
      CurveCount: curves.length,
      TotalSegmentCount: totalSegmentCount,
      TotalPointCount: totalPointCount,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: curves,
  };
}

/**
 * Map a decoded node-target FCurve to a Live2D curve target + ID.
 *
 * @param {{kind:'node', nodeId:string, property:string}} target
 * @param {Map<string, string>} parameterMap
 * @returns {{ target: string, id: string } | null}
 */
function resolveFCurveMapping(target, parameterMap) {
  const key = `${target.nodeId}.${target.property}`;

  // Check explicit mapping first
  if (parameterMap.has(key)) {
    return { target: 'Parameter', id: parameterMap.get(key) };
  }

  // Default mapping: opacity → Part opacity
  if (target.property === 'opacity') {
    return { target: 'PartOpacity', id: target.nodeId };
  }

  // Properties like x, y, rotation, scaleX, scaleY need explicit parameterMap
  // entries to be useful (rotation is mapped via groupId.rotation → ParamRotation_*).
  return null;
}

/**
 * Encode v39 BezTriple keyframes into the flat segment array format
 * used by .motion3.json.
 *
 * Each segment in `.motion3.json` carries a 1-byte type code plus
 * type-specific payload (linear=2 floats, bezier=6 floats, etc.).
 *
 * # Slice 2.G — bezier handle round-trip
 *
 * Bezier segments emit `cx1/cy1/cx2/cy2` derived from
 * `prevKf.handleRight` and `kf.handleLeft`. This pairs with
 * `motion3jsonImport.js` (Slice 2.G.1) which preserves Cubism's authored
 * control points into the BezTriple handle slots; the round-trip
 * (`import → save → load → export`) is byte-identical for handles whose
 * positions don't round-trip through fp32 precision loss.
 *
 * # Slice 2.G — named-easing bake
 *
 * Cubism's segment encoding has only three curve types: linear (0),
 * bezier (1), stepped (2). SS's BezTriple supports 10 named easings
 * (sine/quad/cubic/quart/quint/expo/circ/back/bounce/elastic) × 3 modes
 * which Cubism can't represent directly. Per ANIMATION_BLENDER_PARITY_PLAN.md
 * §2.G, named easings BAKE at export time: each segment subdivides into
 * `BAKE_STEPS_PER_SEGMENT` linear sub-segments sampled from the
 * `evaluateBezTripleSegment` curve. The sub-segments hit Cubism's linear
 * (type 0) code path so the runtime engine plays the eased curve
 * faithfully without needing a custom easing.
 *
 * @param {Array<{time: number, value: number, interpolation?: string, handleLeft?: {time:number,value:number}, handleRight?: {time:number,value:number}}>} keyframes
 * @param {number} durationSec - Total duration in seconds
 * @returns {number[]} Flat segment array
 */
export function encodeKeyframesToSegments(keyframes, durationSec) {
  if (!keyframes || keyframes.length === 0) return [];

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  const segments = [];

  // First keyframe: time (sec), value
  segments.push(sorted[0].time / 1000, sorted[0].value);

  // Subsequent keyframes as segments
  for (let i = 1; i < sorted.length; i++) {
    const kf = sorted[i];
    const prevKf = sorted[i - 1];
    const timeSec = kf.time / 1000;
    const prevTimeSec = prevKf.time / 1000;

    // The segment-type discriminator lives on the SEGMENT-START
    // keyform's `interpolation` (Cubism convention; Blender does the
    // same — `BezTriple.ipo` of keyform `i` controls the curve from
    // `i` to `i+1`).
    const interp = prevKf.interpolation || 'linear';

    if (interp === 'bezier') {
      // Bezier: emit Cubism's segment type 1 with cx1/cy1/cx2/cy2 derived
      // from BezTriple handles. After Slice 2.D every bezier keyform
      // reaches here with `handleRight` + `handleLeft` reified by
      // `recalcKeyformHandles` (build-time + insert-time + importer
      // paths). Audit-fix MED-A3 (2026-05-16): the previous `??` fallback
      // to 1/3-2/3 placeholder positions was a Rule №1 silent fallback —
      // it masked unwired call-sites that bypass `recalcKeyformHandles`.
      // We now require the handles to be present and synthesise the
      // 1/3-2/3 default IN PLACE so a future bug producing missing
      // handles fails the round-trip test loud instead of silently
      // emitting flat control points. The synthesis still uses the
      // canonical 1/3-2/3 positions (matches Blender's
      // `init_unbaked_bezt_data` default for unbaked beziers, fcurve.cc:1054).
      let hRight = prevKf.handleRight;
      let hLeft  = kf.handleLeft;
      if (!hRight || !hLeft) {
        // Loud warning instead of silent fallback — after Slice 2.D this
        // branch indicates an unwired call-site that bypassed
        // `recalcKeyformHandles` (e.g. a third upsertKeyframe variant
        // added without the recalc plumbing). The 1/3-2/3 synthesis is
        // a sane default but the OPERATOR LOG ENTRY is what the user
        // needs to discover + fix the source.
        logger.warn('motion3json', 'bezier handles missing — emitting 1/3-2/3 default', {
          prevKfTime: prevKf.time,
          kfTime: kf.time,
          hadHandleRight: !!prevKf.handleRight,
          hadHandleLeft: !!kf.handleLeft,
        });
        const dt = kf.time - prevKf.time;
        if (!hRight) hRight = { time: prevKf.time + dt / 3,       value: prevKf.value };
        if (!hLeft)  hLeft  = { time: kf.time     - dt / 3,       value: kf.value };
      }
      segments.push(
        1,
        hRight.time / 1000, hRight.value,
        hLeft.time  / 1000, hLeft.value,
        timeSec, kf.value,
      );
    } else if (NAMED_EASINGS.has(interp)) {
      // Named easing — bake to a sequence of linear sub-segments. Each
      // sub-segment lands as a type-0 (linear) segment in the flat array.
      // The bake samples the BezTriple evaluator at uniform time steps;
      // BAKE_STEPS_PER_SEGMENT controls fidelity vs file size.
      bakeEasingToLinearSegments(segments, prevKf, kf, prevTimeSec, timeSec);
    } else if (interp === 'constant') {
      segments.push(2, timeSec, kf.value);
    } else {
      // linear (default)
      segments.push(0, timeSec, kf.value);
    }
  }

  return segments;
}

/**
 * Cubism segment-type codes (mirrors `motion3jsonImport.js`).
 */
const NAMED_EASINGS = new Set([
  'sine', 'quad', 'cubic', 'quart', 'quint',
  'expo', 'circ', 'back', 'bounce', 'elastic',
]);

/**
 * Per-segment subdivision count for named-easing bake. 16 steps gives
 * ~0.5° angular fidelity for a 90°-swing curve — well under Cubism's
 * visible-quantisation threshold. Higher counts inflate the motion3.json
 * by ~3 floats/step; 16 is the empirical sweet spot for Hiyori-scale
 * motions (~10s duration, 24fps).
 */
const BAKE_STEPS_PER_SEGMENT = 16;

/**
 * Bake one named-easing BezTriple segment into a sequence of linear
 * sub-segments appended to `segments`. The sub-segments share the eased
 * curve's value at uniform time samples; Cubism's linear interp between
 * adjacent samples reconstructs the curve to ~BAKE_STEPS_PER_SEGMENT
 * fidelity.
 *
 * @param {number[]} segments
 * @param {*} prevKf
 * @param {*} kf
 * @param {number} prevTimeSec
 * @param {number} timeSec
 */
function bakeEasingToLinearSegments(segments, prevKf, kf, prevTimeSec, timeSec) {
  const dtMs = kf.time - prevKf.time;
  if (dtMs <= 0) {
    // Degenerate zero-duration segment — emit single linear hop.
    segments.push(0, timeSec, kf.value);
    return;
  }
  for (let step = 1; step <= BAKE_STEPS_PER_SEGMENT; step++) {
    const sampleTimeMs = prevKf.time + (dtMs * step) / BAKE_STEPS_PER_SEGMENT;
    const sampleValue = evaluateBezTripleSegment(prevKf, kf, sampleTimeMs);
    segments.push(0, sampleTimeMs / 1000, sampleValue);
  }
}

// ── 3.D — Cycles → IsLoop + per-fcurve bake ──────────────────────────────

/**
 * Returns the first non-muted, non-disabled, non-range-restricted Cycles
 * modifier on the fcurve, or `null` if absent.
 *
 * The "head-of-stack" invariant from Slice 3.C (`fcurveModifiersPanelData.js`
 * + `fmodifier.cc:635` `BLI_assert(fcm->prev == nullptr)`) means a Cycles
 * modifier, when present, lives at `modifiers[0]`. So we only check the
 * first entry — multiple Cycles modifiers cannot exist by construction.
 *
 * Range-restricted Cycles modifiers are NOT loop-signal candidates: a
 * scoped cycle isn't equivalent to Cubism's whole-curve `IsLoop=true`.
 *
 * @param {{ modifiers?: Array<object> } | null | undefined} fcurve
 * @returns {object|null}
 */
function getActiveCyclesModifier(fcurve) {
  const mods = fcurve && Array.isArray(fcurve.modifiers) ? fcurve.modifiers : null;
  if (!mods || mods.length === 0) return null;
  const head = mods[0];
  if (!head || head.type !== 'cycles') return null;
  if (head.muted === true || head.disabled === true) return null;
  if (head.useRestrictedRange === true) return null;
  return head;
}

/**
 * True iff fcurve has an active (non-muted, non-restricted) Cycles
 * modifier — regardless of its before/after configuration. Drives the
 * per-fcurve bake decision.
 *
 * @param {{ modifiers?: Array<object> } | null | undefined} fcurve
 * @returns {boolean}
 */
function hasActiveCyclesModifier(fcurve) {
  return getActiveCyclesModifier(fcurve) !== null;
}

/**
 * True iff EVERY fcurve in the action carries an active Cycles modifier
 * configured for `before='none', after='repeat', afterCycles=0` —
 * Cubism's `Meta.Loop=true` equivalent per plan §3.D. An empty fcurve
 * list returns false (no signal = no loop).
 *
 * The exact data shape per `FModCyclesData` in `fmodifiers.js`:
 *   - `before` sparse-default 'none' → missing or 'none' satisfies
 *   - `after` MUST be explicit 'repeat' (sparse default 'none' fails)
 *   - `afterCycles` sparse-default 0 (= infinite) → missing or 0 satisfies
 *
 * Non-zero `useInfluence` slider values fail the check — a fractional
 * cycle isn't a full loop. The cycle-driven IsLoop signal is binary
 * by Cubism's format definition.
 *
 * @param {{ fcurves?: Array<object> } | null | undefined} action
 * @returns {boolean}
 */
function actionHasUniformLoopingCycles(action) {
  const fcurves = action && Array.isArray(action.fcurves) ? action.fcurves : null;
  if (!fcurves || fcurves.length === 0) return false;
  for (const fcurve of fcurves) {
    const cycles = getActiveCyclesModifier(fcurve);
    if (!cycles) return false;
    const data = cycles.data || {};
    const before = data.before ?? 'none';
    const after = data.after ?? 'none';
    const afterCycles = Number.isFinite(data.afterCycles) ? data.afterCycles : 0;
    if (before !== 'none') return false;
    if (after !== 'repeat') return false;
    if (afterCycles !== 0) return false;
    // useInfluence with influence<1 means fractional blend — not a full loop.
    if (cycles.useInfluence === true) {
      const inf = Number.isFinite(cycles.influence) ? cycles.influence : 1;
      if (inf < 1) return false;
    }
  }
  return true;
}

/**
 * Bake an fcurve's modifier stack into explicit linear keyforms at
 * `fps` over `[0, durationMs]`. Returns a shallow-cloned fcurve with
 * baked `keyforms` and `modifiers` stripped — safe to feed into
 * `encodeKeyframesToSegments` without re-applying modifiers.
 *
 * Sampling is uniform at the action's recorded FPS. Each sample becomes
 * a linear keyform; downstream the segment encoder emits each pair as
 * a Cubism type-0 (linear) segment. The bake count is
 * `floor(durationMs / stepMs) + 1` (inclusive endpoints).
 *
 * Per `evaluateFCurve` (`fcurve.js:155`), every active modifier on the
 * fcurve contributes to each sample — Cycles + Noise + Generator +
 * Limits + Stepped + Envelope. The 3.D trigger gate at the caller
 * decides which fcurves get baked; the bake itself is type-agnostic.
 *
 * @param {object} fcurve - source fcurve (not mutated)
 * @param {number} durationMs - action duration in milliseconds
 * @param {number} fps - sample rate (action.fps)
 * @returns {object} cloned fcurve with baked keyforms + modifiers stripped
 */
function bakeFCurveModifiers(fcurve, durationMs, fps) {
  const stepMs = 1000 / fps;
  // +1 for the inclusive endpoint at t=durationMs.
  const sampleCount = Math.max(2, Math.floor(durationMs / stepMs) + 1);
  const baked = new Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    // Clamp the last sample to exactly durationMs to avoid fp drift past
    // the action boundary (the runtime engine treats t > duration as
    // out-of-range; Cubism's loop=false mode holds the last value).
    const time = (i === sampleCount - 1) ? durationMs : i * stepMs;
    const value = evaluateFCurve(fcurve, time);
    baked[i] = {
      time,
      value,
      interpolation: 'linear',
      handleLeft: { time, value },
      handleRight: { time, value },
      handleType: { left: 'vector', right: 'vector' },
      flag: 0,
    };
  }
  // Strip modifiers — they've been baked in. Preserves every other
  // field (target encoding, driver, id, etc.) via spread.
  const { modifiers: _stripped, ...rest } = fcurve;
  return { ...rest, keyforms: baked };
}

/**
 * Count segments and points in a flat segment array (for Meta fields).
 *
 * @param {number[]} segments
 * @returns {{ segments: number, points: number }}
 */
export function countSegmentsAndPoints(segments) {
  if (segments.length < 2) return { segments: 0, points: 0 };

  let segCount = 0;
  let ptCount = 1; // first point (time, value)
  let i = 2; // skip first time+value pair

  while (i < segments.length) {
    const type = segments[i];
    segCount++;
    i++; // skip type byte

    if (type === 1) {
      // Bezier: 6 values (cx1, cy1, cx2, cy2, time, value) → 3 points
      ptCount += 3;
      i += 6;
    } else {
      // Linear/stepped/inverse-stepped: 2 values (time, value) → 1 point
      ptCount += 1;
      i += 2;
    }
  }

  return { segments: segCount, points: ptCount };
}
