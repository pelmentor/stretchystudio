// @ts-check

/**
 * Animation-tree node type registrations.
 *
 * Phase N-3 of the V2 plan. Adds:
 *
 *   - `FCurveStrip`     — wraps a single SS Action FCurve. Reads time
 *                         from ctx, interpolates the fcurve's keyforms,
 *                         writes the result to either
 *                         `ctx.paramOverrides` (param fcurves) or
 *                         `ctx.poseOverrides` (object fcurves).
 *   - `TimelineOutput`  — sink that aggregates per-strip outputs into
 *                         a single observable summary. Mostly cosmetic
 *                         in N-3; future-proofs for NLA strip-blending
 *                         (Blender's track stack composition).
 *
 * Adapted from Blender's NLA strip nodes
 * (`reference/blender/source/blender/makesdna/DNA_anim_types.h`
 * `NlaStrip` / `NlaTrack`).
 *
 * # Schema state
 *
 * Post-v38 NodeTree retirement: the only producer of FCurveStrip nodes
 * is `compileAnimationTree(action)` which always carries `storage.fcurve`
 * (v36 FCurve with rnaPath). The pre-v38 v24 migration's
 * `compileLegacyAnimationTree` (which carried `storage.track` legacy
 * shape) is gone — that branch in `execute` was deleted with the
 * retirement.
 *
 * @module anim/nodetree/nodes/animation
 */

import { registerNodeType } from '../registry.js';
import { SocketType, SocketInOut } from '../types.js';
import { interpolateTrack } from '../../../renderer/animationEngine.js';
import { decodeFCurveTarget, normalizePoseOverrideKey } from '../../animationFCurve.js';

registerNodeType({
  typeId: 'FCurveStrip',
  label: 'F-Curve Strip',
  category: 'animation',
  sockets: [
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { fcurve: <v36 FCurve> } from compileAnimationTree.
  //
  // ctx.time is in seconds (motion3.json boundary); the keyforms use
  // milliseconds internally. `interpolateTrack` handles ms uniformly.
  execute: (node, ctx) => {
    const timeMs = (ctx?.time ?? 0) * 1000;
    const fcurve = node.storage?.fcurve;
    if (!fcurve) return undefined;
    const target = decodeFCurveTarget(fcurve);
    if (!target) return undefined;
    if (target.kind === 'node' && target.property === 'mesh_verts') return undefined;
    const value = interpolateTrack(fcurve.keyforms ?? [], timeMs, false, 0);
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

    if (target.kind === 'param') {
      // Mirror of kernelAnimationTrackEval's bone-mirror priority gate.
      // See [[bone-to-param-mirror-priority]] for the rationale.
      const mirrorByParam = ctx?.boneMirrorByParam;
      if (mirrorByParam instanceof Map) {
        const boneId = mirrorByParam.get(target.paramId);
        if (boneId) {
          const poseOv = ctx?.poseOverrides;
          const boneEntry = poseOv instanceof Map ? poseOv.get(boneId) : null;
          if (boneEntry instanceof Map && boneEntry.has('rotation')) {
            return undefined;
          }
        }
      }
      ctx?.paramOverrides?.set?.(target.paramId, value);
    } else if (target.kind === 'node') {
      const poseOverrides = ctx?.poseOverrides;
      if (poseOverrides instanceof Map) {
        let entry = poseOverrides.get(target.nodeId);
        if (!entry) { entry = new Map(); poseOverrides.set(target.nodeId, entry); }
        // Mirror the depgraph ANIMATION_TRACK_EVAL kernel — bare channel
        // names only. See `normalizePoseOverrideKey`.
        entry.set(normalizePoseOverrideKey(target.property), value);
      }
    }
    return value;
  },
});

registerNodeType({
  typeId: 'TimelineOutput',
  label: 'Timeline Output',
  category: 'animation',
  sockets: [
    // Tracks contribute to a dynamic input set; we model it as a
    // single "summary" input that just collects whatever the upstream
    // strip emitted. Phase N-5 visual editor surfaces per-strip pin
    // sockets, but the eval contract stays simple.
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.INPUT, defaultValue: 0 },
  ],
  // Sink — execute returns the input value so downstream consumers
  // (debug overlay, future track-blender) can read it.
  execute: (_node, ctx) => ctx?.inputs?.value ?? 0,
});
