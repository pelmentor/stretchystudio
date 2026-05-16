// @ts-check

/**
 * ANIMATION_TRACK_EVAL kernel.
 *
 * Phase D-4 of the V2 plan, post-v36 rewire. Replaces the D-2 alias
 * that routed ANIMATION_TRACK_EVAL through the FCurve kernel. Ports
 * `computeParamOverrides` + `computePoseOverrides` from
 * `animationEngine.js` to the depgraph eval substrate.
 *
 * # FCurve shape (post-v36)
 *
 * SS actions store `fcurves: [{ rnaPath, keyforms: [{time, value, easing, type}] }]`.
 * The rnaPath decodes (via `decodeFCurveTarget`) to either:
 *
 *   - param target  → `objects["__params__"].values["<paramId>"]`
 *   - node property → `objects["<nodeId>"].<property>`
 *
 * The D-1 build pass emits one ANIMATION_TRACK_EVAL op per fcurve,
 * tagged with the fcurve's rnaPath. The kernel looks up the fcurve
 * via exact rnaPath match on `ctx.action.fcurves[]`, calls
 * `interpolateTrack` at `ctx.timeMs`, and writes:
 *
 *   - param target → `ctx.paramOverrides.set(paramId, value)`.
 *     PARAM_EVAL kernel downstream picks this up.
 *   - node target  → `ctx.poseOverrides.get(nodeId)?.set(property, value)`,
 *     where `ctx.poseOverrides` is `Map<nodeId, Map<property, value>>`.
 *     Phase D-5+ wires part TRANSFORM ops to read these.
 *
 * @module anim/depgraph/kernels/animation
 */

import { interpolateTrack } from '../../../renderer/animationEngine.js';
import { decodeFCurveTarget } from '../../animationFCurve.js';
import { isFCurveMuted } from '../../fcurveMute.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {number | undefined}
 */
export function kernelAnimationTrackEval(op, ctx) {
  const tag = op.tag;
  if (!tag) return undefined;
  const fcurves = ctx.action?.fcurves ?? [];
  // Build pass writes tag = fc.rnaPath. Locate by exact match.
  const fc = fcurves.find((f) => f?.rnaPath === tag);
  if (!fc) return undefined;
  // Audit-fix HIGH-A2 (Slice 5.G dual-audit 2026-05-16): mute gate.
  // Sister to the same gate in `kernelFCurveEval`; ANIMATION_TRACK_EVAL
  // is the depgraph's per-fcurve op for full action eval and was
  // pre-fix ungated. Mirrors `is_fcurve_evaluatable` at
  // `reference/blender/source/blender/animrig/intern/evaluation.cc:95-111`.
  if (isFCurveMuted(fc)) return undefined;

  const target = decodeFCurveTarget(fc);
  if (!target) return undefined;

  // Mesh-verts fcurves aren't a single number — defer until Phase N-3
  // (animation tree). Return undefined here; downstream PARAM_EVAL
  // ignores undefined.
  if (target.kind === 'node' && target.property === 'mesh_verts') return undefined;

  // post-v36 keyforms carry `{time(ms), value, easing, type}`.
  // `interpolateTrack` consumes the array directly (ms-native, matches
  // ctx.timeMs's canonical unit).
  const value = interpolateTrack(fc.keyforms ?? [], ctx.timeMs ?? 0, false, 0);
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

  if (target.kind === 'param') {
    ctx.paramOverrides?.set(target.paramId, value);
  } else if (target.kind === 'node') {
    const poseOverrides = /** @type {any} */ (ctx).poseOverrides;
    if (poseOverrides instanceof Map) {
      let entry = poseOverrides.get(target.nodeId);
      if (!entry) { entry = new Map(); poseOverrides.set(target.nodeId, entry); }
      entry.set(target.property, value);
    }
  }
  return value;
}
