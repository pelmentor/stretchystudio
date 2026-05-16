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
 * # Loop semantics — Blender deviation (Stage 1.F audit-fix D-2)
 *
 * Blender's `bAction` carries an `ACT_CYCLIC` flag bit (`(1 << 13)` per
 * `reference/blender/source/blender/makesdna/DNA_action_types.h:385-386`)
 * that signals the Action is intended to loop. Per the bit's doccomment,
 * `ACT_CYCLIC` requires `ACT_FRAME_RANGE` to also be set (the cycle
 * boundaries come from the explicit frame range).
 *
 * SS does NOT honor `action.flag & ACT_CYCLIC` today. Live2D motions
 * loop by convention (Hiyori's reference motion3 files all have
 * `Loop: true`); Stage 1.F ships hardcoded `Loop: true` to preserve the
 * existing exporter behavior. The ACT_CYCLIC integration is deferred to
 * Phase 6 (or whichever phase ships a Cyclic-toggle UI in
 * `ActionsEditor`); the field is reserved on the Action shape (see
 * `v36_action_datablock.js:273-281` ACT_CYCLIC bit set) but not yet
 * read here. **No `opts.loop` parameter** — the prior version exposed
 * one but no caller passed it (Rule №2: callable-by-no-one is a Rule
 * №1 anti-pattern). When the Cyclic toggle ships, the contract becomes:
 * `Loop = (action.flag & ACT_CYCLIC) !== 0`, no opts override, and the
 * exporter reads from canonical action state.
 *
 * @module io/live2d/motion3json
 */

import { decodeFCurveTarget } from '../../anim/animationFCurve.js';
import { evaluateBezTripleSegment } from '../../anim/fcurveEval.js';

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
  // Loop = true (hardcoded). See module JSDoc "Loop semantics" deviation
  // — ACT_CYCLIC integration deferred to Cyclic-toggle UI.
  const loop = true;

  const durationSec = (action.duration ?? 2000) / 1000;
  const fps = action.fps ?? 24;

  const curves = [];
  let totalSegmentCount = 0;
  let totalPointCount = 0;

  for (const fcurve of (action.fcurves ?? [])) {
    const target = decodeFCurveTarget(fcurve);
    if (!target) continue;

    // Parameter fcurves — first-class Live2D parameter animation, emitted
    // directly without going through the SS node→param mapping. Used by
    // the idle generator and any AI-driven motion that targets standard
    // Live2D parameters (ParamAngleX, ParamBreath, etc.) by ID.
    if (target.kind === 'param') {
      const segments = encodeKeyframesToSegments(fcurve.keyforms ?? [], durationSec);
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
      const kfs = fcurve.keyforms;
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
    const segments = encodeKeyframesToSegments(fcurve.keyforms, durationSec);

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
      // from BezTriple handles. Pre-Slice-2.G this branch used 1/3-2/3
      // placeholder control points; the BezTriple shape now carries the
      // real handles (placed by `recalcKeyformHandles` or by importer).
      const cx1 = (prevKf.handleRight?.time  ?? (prevKf.time + (kf.time - prevKf.time) / 3)) / 1000;
      const cy1 =  prevKf.handleRight?.value ?? prevKf.value;
      const cx2 = (kf.handleLeft?.time       ?? (kf.time - (kf.time - prevKf.time) / 3))      / 1000;
      const cy2 =  kf.handleLeft?.value      ?? kf.value;
      segments.push(1, cx1, cy1, cx2, cy2, timeSec, kf.value);
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
