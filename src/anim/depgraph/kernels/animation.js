// @ts-check

/**
 * ANIMATION_TRACK_EVAL kernel.
 *
 * Phase D-4 of the V2 plan. Replaces the D-2 alias that routed
 * ANIMATION_TRACK_EVAL through the FCurve kernel. Ports
 * `computeParamOverrides` + `computePoseOverrides` from
 * `animationEngine.js:175-225`.
 *
 * # Track shape
 *
 * SS animation tracks have:
 *   - `paramId` (parameter tracks) OR `nodeId + property` (pose tracks)
 *   - `keyframes[] = [{time, value, easing}]`
 *
 * Where the D-1 build pass produced the op tag is the canonical
 * animation-track identifier (`<paramId>` for parameter tracks,
 * `<nodeId>/<property>` for pose tracks). The kernel reads the
 * matching track from `ctx.animation.tracks[]`, calls
 * `interpolateTrack` at `ctx.time`, and writes:
 *
 *   - paramId track  → `ctx.paramOverrides.set(paramId, value)`.
 *     PARAM_EVAL kernel downstream picks this up.
 *   - pose track     → `ctx.poseOverrides.get(nodeId)?.set(property, value)`,
 *     where `ctx.poseOverrides` is `Map<nodeId, Map<property, value>>`.
 *     Phase D-5+ wires part TRANSFORM ops to read these.
 *
 * @module anim/depgraph/kernels/animation
 */

import { interpolateTrack } from '../../../renderer/animationEngine.js';
import { evaluateFCurve } from '../../fcurve.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {number | undefined}
 */
export function kernelAnimationTrackEval(op, ctx) {
  const tag = op.tag;
  if (!tag) return undefined;
  const tracks = ctx.animation?.tracks ?? [];

  // Build pass writes tag = `<targetId>/<property>`. Parse it.
  const slash = tag.indexOf('/');
  const targetId = slash >= 0 ? tag.slice(0, slash) : tag;
  const property = slash >= 0 ? tag.slice(slash + 1) : 'value';

  // Locate the track. Convention varies:
  //   - SS animation: track.paramId or track.nodeId + property.
  //   - FCurve (D-2 scaffold): track.targetId + property.
  const track = tracks.find((t) => {
    if (!t) return false;
    if (t.paramId === targetId) return true;
    if (t.targetId === targetId && (t.property ?? 'value') === property) return true;
    if (t.nodeId === targetId && (t.property ?? 'value') === property) return true;
    return false;
  });
  if (!track) return undefined;

  // Mesh-verts tracks aren't a single number — defer until Phase N-3
  // (animation tree). Return undefined here; downstream PARAM_EVAL
  // ignores undefined.
  if (track.property === 'mesh_verts') return undefined;

  // Track shape detection:
  //   - SS animation track: `keyframes[] = [{time(ms), value, easing}]`
  //   - FCurve (Phase 5 scaffold): `keyforms[] = [{time(s), value, type?}]`
  // ctx.time is in seconds; SS animation engine works in ms.
  let value;
  if (Array.isArray(track.keyframes)) {
    const timeMs = (ctx.time ?? 0) * 1000;
    value = interpolateTrack(track.keyframes, timeMs, false, 0);
  } else if (Array.isArray(track.keyforms)) {
    value = evaluateFCurve(track, ctx.time ?? 0, { project: ctx.project });
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

  if (track.paramId) {
    ctx.paramOverrides?.set(track.paramId, value);
  } else if (track.targetId && !track.nodeId) {
    // FCurve-shape: the target IS a parameter. Write to overrides.
    ctx.paramOverrides?.set(track.targetId, value);
  } else if (track.nodeId) {
    const poseOverrides = /** @type {any} */ (ctx).poseOverrides;
    if (poseOverrides instanceof Map) {
      let entry = poseOverrides.get(track.nodeId);
      if (!entry) { entry = new Map(); poseOverrides.set(track.nodeId, entry); }
      entry.set(track.property ?? 'value', value);
    }
  }
  return value;
}
