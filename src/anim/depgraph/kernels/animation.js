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
 * `evaluateFCurve` at `ctx.timeMs`, and writes:
 *
 *   - param target → `ctx.paramOverrides.set(paramId, value)`.
 *     PARAM_EVAL kernel downstream picks this up.
 *   - node target  → `ctx.poseOverrides.get(nodeId)?.set(property, value)`,
 *     where `ctx.poseOverrides` is `Map<nodeId, Map<property, value>>`.
 *     Phase D-5+ wires part TRANSFORM ops to read these.
 *
 * # Eval path
 *
 * Pre-fix the kernel called `interpolateTrack` (raw bezier sampler)
 * directly; FCurve Modifiers + Drivers were silently bypassed during
 * full-action playback even though substrate, evaluator, and UI panels
 * were all wired (rule-4-03 + rule-4-04 audit findings). Post-fix the
 * kernel calls `evaluateFCurve`, the canonical curve→value reducer
 * that runs the time-modifier pass, samples keyforms, runs the
 * value-modifier pass, then applies the driver override per Blender's
 * eval order (`reference/blender/source/blender/animrig/intern/evaluation.cc:95-111`,
 * `fmodifier.cc:1490-1595`).
 *
 * @module anim/depgraph/kernels/animation
 */

import { evaluateFCurve } from '../../fcurve.js';
import { decodeFCurveTarget, normalizePoseOverrideKey } from '../../animationFCurve.js';
import { isFCurveEffectivelyMuted } from '../../fcurveGroups.js';

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
  // Slice 5.V — also cascade group-mute per `anim_sys.cc:350-352`
  // (full Blender per-curve gate at line 347 is
  // `fcu->flag & (FCURVE_MUTED | FCURVE_DISABLED)`; SS omits
  // FCURVE_DISABLED by design — see fcurveMute.js header).
  if (isFCurveEffectivelyMuted(fc, ctx.action)) return undefined;

  const target = decodeFCurveTarget(fc);
  if (!target) return undefined;

  // Mesh-verts fcurves aren't a single number — defer until Phase N-3
  // (animation tree). Return undefined here; downstream PARAM_EVAL
  // ignores undefined.
  if (target.kind === 'node' && target.property === 'mesh_verts') return undefined;

  // rule-4-03 + rule-4-04 fix: evaluate via `evaluateFCurve` (not the
  // raw `interpolateTrack`) so FCurve Modifiers (Cycles / Noise /
  // Generator / Limits / Stepped / Envelope) and Drivers contribute to
  // the value, matching what the FCurve UI + non-action eval paths
  // already do. Pre-fix the kernel called `interpolateTrack` directly,
  // which only sampled bezier keyforms — modifiers + drivers were silently
  // dropped during full-action playback even though the substrate
  // (`anim/fmodifiers.js`, `anim/driver.js`), evaluator
  // (`evaluateFCurve`), and UI panels were all wired. Blender parity:
  // `evaluateFCurve` is the canonical curve→value reduction across all
  // eval contexts.
  const value = evaluateFCurve(fc, ctx.timeMs ?? 0, { project: ctx.project });
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

  if (target.kind === 'param') {
    // Bone-mirror priority gate (RULE №4). When the param is bone-
    // mirrored AND the bone has a rotation override in ctx.poseOverrides
    // (from the user's bone fcurve or pose-mode draft), skip this
    // param fcurve write so the pre-eval seed (CanvasViewport's BONE
    // → PARAM mirror) survives. Without this, a procedural
    // `ParamRotation_<bone>` fcurve in the action would overwrite the
    // bone's authored value and the mesh would keep following the
    // procedural — the user's bone keyframe invisible. See
    // [[bone-to-param-mirror-priority]].
    const mirrorByParam = /** @type {any} */ (ctx).boneMirrorByParam;
    if (mirrorByParam instanceof Map) {
      const boneId = mirrorByParam.get(target.paramId);
      if (boneId) {
        const poseOv = /** @type {any} */ (ctx).poseOverrides;
        const boneEntry = poseOv instanceof Map ? poseOv.get(boneId) : null;
        if (boneEntry instanceof Map && boneEntry.has('rotation')) {
          return undefined;
        }
      }
    }
    ctx.paramOverrides?.set(target.paramId, value);
  } else if (target.kind === 'node') {
    const poseOverrides = /** @type {any} */ (ctx).poseOverrides;
    if (poseOverrides instanceof Map) {
      let entry = poseOverrides.get(target.nodeId);
      if (!entry) { entry = new Map(); poseOverrides.set(target.nodeId, entry); }
      // Normalise to bare channel name so TRANSFORM_COMPOSE's
      // `applyPoseOverrides` (which probes `ov.has('rotation')` etc.)
      // sees the channel regardless of whether the fcurve was created
      // via the K-key (bare) or I-key/keying-set (`pose.<ch>` /
      // `transform.<ch>`) path. See `normalizePoseOverrideKey`.
      entry.set(normalizePoseOverrideKey(target.property), value);
    }
  }
  return value;
}
