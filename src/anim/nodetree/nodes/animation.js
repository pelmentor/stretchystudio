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

registerNodeType({
  typeId: 'FCurveStrip',
  label: 'F-Curve Strip',
  category: 'animation',
  sockets: [
    { identifier: 'value', name: 'Value',
      type: SocketType.VALUE, inOut: SocketInOut.OUTPUT },
  ],
  // storage = { track: <SS animation track record> }
  // ctx.time is in seconds (matches EvalContext); SS tracks use
  // milliseconds internally. interpolateTrack handles ms.
  execute: (node, ctx) => {
    const track = node.storage?.track;
    if (!track) return undefined;
    if (track.property === 'mesh_verts') return undefined; // deferred
    const timeMs = (ctx?.time ?? 0) * 1000;
    const value = interpolateTrack(track.keyframes ?? [], timeMs, false, 0);
    if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;

    // Write back to overrides — same convention as
    // `kernels/animation.js` in Phase D-4.
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
