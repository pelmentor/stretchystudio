// @ts-check

/**
 * Production-shape depgraph runner.
 *
 * Phase 0.D.0 of the Animation Blender-Parity Plan. Provides a
 * drop-in replacement for `evalRig` that routes every art mesh
 * through the depgraph's `ART_MESH_EVAL` op. The returned shape
 * matches `chainEval.evalRig` (`ArtMeshFrame[]`) so consumers can
 * swap engines without altering the renderer.
 *
 * # Wiring
 *
 *   const frames = evalProjectFrameViaDepgraph(project, paramValues);
 *   //   ↪ frames[i] = { id, vertexPositions, opacity, drawOrder }
 *
 * `paramValues` is a flat `{ paramId: value }` map (matching evalRig's
 * second arg). The runner copies each entry into the depgraph's
 * `paramOverrides` map so PARAM_EVAL kernels pick up the values; from
 * there, FCURVE_EVAL / DRIVER_EVAL / ANIMATION_TRACK_EVAL / PHYSICS_EVAL
 * may overwrite them inside the eval pass.
 *
 * # When to use this vs `evalRig`
 *
 * `evalRig` is the legacy chainEval entry point — fast, well-tested,
 * fixed semantics. `evalProjectFrameViaDepgraph` is the depgraph
 * production wire (Phase 0.D.0). They're swap-compatible at the
 * `ArtMeshFrame` boundary; pick by `preferencesStore.evalEngine`.
 *
 * @module anim/depgraph/evalProjectFrame
 */

import { buildDepGraph } from './build.js';
import { evalDepGraph } from './eval.js';
import { OperationCode, NodeType } from './types.js';

/**
 * @typedef {object} ArtMeshFrame
 * @property {string} id
 * @property {Float32Array} vertexPositions
 * @property {number} opacity
 * @property {number} drawOrder
 */

/**
 * Evaluate every art mesh in the project via the depgraph. Output
 * shape matches `evalRig`.
 *
 * @param {object} project
 * @param {Record<string, number>} paramValues
 * @param {object} [opts]
 * @param {object|null} [opts.animation] - active animation clip; when set,
 *   the depgraph's ANIMATION_TRACK_EVAL kernel evaluates tracks at
 *   `opts.timeMs`. Pass null when no animation is active.
 * @param {number} [opts.timeMs] - playhead time in milliseconds
 *   (Phase 0.0 canonical unit). Defaults to 0.
 * @param {number} [opts.requiredMode] - modifier mode bitmask
 * @returns {ArtMeshFrame[]}
 */
export function evalProjectFrameViaDepgraph(project, paramValues, opts = {}) {
  const graph = buildDepGraph(project, opts.animation ? { animation: opts.animation } : {});
  const overrides = new Map();
  if (paramValues && typeof paramValues === 'object') {
    for (const k of Object.keys(paramValues)) {
      const v = paramValues[k];
      if (typeof v === 'number' && Number.isFinite(v)) overrides.set(k, v);
    }
  }
  const ctx = evalDepGraph(graph, {
    project,
    timeMs: opts.timeMs ?? 0,
    paramOverrides: overrides,
    animation: opts.animation ?? null,
    requiredMode: opts.requiredMode,
  });
  /** @type {ArtMeshFrame[]} */
  const frames = [];
  for (const node of project.nodes ?? []) {
    if (!node || node.type !== 'part') continue;
    const key = `${node.id}/${NodeType.GEOMETRY}/${OperationCode.ART_MESH_EVAL}`;
    const out = ctx.outputs.get(key);
    if (!out || !out.vertexPositions) continue;
    frames.push({
      id: out.id ?? node.id,
      vertexPositions: out.vertexPositions,
      opacity: typeof out.opacity === 'number' ? out.opacity : 1,
      drawOrder: typeof out.drawOrder === 'number' ? out.drawOrder : (node.draw_order ?? 500),
    });
  }
  return frames;
}
