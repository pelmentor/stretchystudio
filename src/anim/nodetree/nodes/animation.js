// @ts-check

/**
 * Animation-tree node type registrations.
 *
 * Phase N-3 of the V2 plan. Adds:
 *
 *   - `FCurveStrip`     — wraps a single SS animation track. Reads
 *                         time from ctx, interpolates the track's
 *                         keyframes, writes the result to either
 *                         `ctx.paramOverrides` (param tracks) or
 *                         `ctx.poseOverrides` (pose tracks).
 *   - `TimelineOutput`  — sink that aggregates per-strip outputs into
 *                         a single observable summary. Mostly cosmetic
 *                         in N-3; future-proofs for NLA strip-blending
 *                         (Blender's track stack composition).
 *
 * Adapted from Blender's NLA strip nodes
 * (`reference/blender/source/blender/makesdna/DNA_anim_types.h`
 * `NlaStrip` / `NlaTrack`).
 *
 * @module anim/nodetree/nodes/animation
 */

import { registerNodeType } from '../registry.js';
import { SocketType, SocketInOut } from '../types.js';
import { interpolateTrack } from '../../../renderer/animationEngine.js';
import { decodeFCurveTarget } from '../../animationFCurve.js';

registerNodeType({
  typeId: 'FCurveStrip',
  label: 'F-Curve Strip',
  category: 'animation',
  sockets: [
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { fcurve: <v36 FCurve> } (post-v36 compileAnimationTree)
  // OR     = { track:  <legacy SS track> } (v24 migration shadow)
  //
  // ctx.time is in seconds (motion3.json boundary); the keyforms /
  // keyframes use milliseconds internally. `interpolateTrack` handles
  // ms uniformly across both shapes.
  execute: (node, ctx) => {
    const timeMs = (ctx?.time ?? 0) * 1000;

    // Post-v36 path: storage.fcurve carries an FCurve with rnaPath.
    const fcurve = node.storage?.fcurve;
    if (fcurve) {
      const target = decodeFCurveTarget(fcurve);
      if (!target) return undefined;
      if (target.kind === 'node' && target.property === 'mesh_verts') return undefined;
      const value = interpolateTrack(fcurve.keyforms ?? [], timeMs, false, 0);
      if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

      if (target.kind === 'param') {
        ctx?.paramOverrides?.set?.(target.paramId, value);
      } else if (target.kind === 'node') {
        const poseOverrides = ctx?.poseOverrides;
        if (poseOverrides instanceof Map) {
          let entry = poseOverrides.get(target.nodeId);
          if (!entry) { entry = new Map(); poseOverrides.set(target.nodeId, entry); }
          entry.set(target.property, value);
        }
      }
      return value;
    }

    // v24 shadow path: storage.track carries a legacy SS track. The v24
    // shadow is stale snapshot data (NodeTree retirement is in flight),
    // but eval is preserved for the read-only NodeTreeEditor surface.
    const track = node.storage?.track;
    if (!track) return undefined;
    if (track.property === 'mesh_verts') return undefined;
    const value = interpolateTrack(track.keyframes ?? [], timeMs, false, 0);
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

    if (track.paramId) {
      ctx?.paramOverrides?.set?.(track.paramId, value);
    } else if (track.nodeId) {
      const poseOverrides = ctx?.poseOverrides;
      if (poseOverrides instanceof Map) {
        let entry = poseOverrides.get(track.nodeId);
        if (!entry) { entry = new Map(); poseOverrides.set(track.nodeId, entry); }
        entry.set(track.property ?? 'value', value);
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
