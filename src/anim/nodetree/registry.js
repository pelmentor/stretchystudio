// @ts-check

/**
 * NodeTree typeinfo registry.
 *
 * Phase N-1 of the V2 plan. Loose port of Blender's node-type
 * registry (`reference/blender/source/blender/blenkernel/BKE_node.hh:246-453`):
 *
 *   - Each typeId entry carries `{label, category, sockets, execute}`.
 *   - `sockets` is the static socket layout (input + output declarations).
 *   - `execute(node, ctx)` is the eval kernel, called by the depgraph
 *     NODETREE_NODE_EVAL op (Phase D-* extension).
 *
 * # Initial entries (Phase N-1)
 *
 * - `PartInput`        — emits the part's source vertices.
 * - `PartOutput`       — sink; final geometry lands here.
 * - `WarpModifier`     — bilinear FFD via warp deformer reference.
 * - `RotationModifier` — 2D affine via rotation deformer reference.
 *
 * Phase N-2 adds: `ParamInput`, `Math`, `Compare`, `Constant`,
 * `DriverOutput`. Phase N-3 adds: `FCurveStrip`, `TimelineOutput`.
 *
 * @module anim/nodetree/registry
 */

import { SocketType, SocketInOut } from './types.js';

/**
 * @typedef {object} SocketDecl
 * @property {string} identifier
 * @property {string} name
 * @property {string} type
 * @property {string} inOut
 * @property {any} [defaultValue]
 *
 * @typedef {object} NodeTypeInfo
 * @property {string} typeId
 * @property {string} label
 * @property {('rig'|'driver'|'animation'|'common')} category
 * @property {SocketDecl[]} sockets
 * @property {(node: import('./types.js').NodeTreeNode, ctx: any) => any} [execute]
 */

/** @type {Record<string, NodeTypeInfo>} */
export const NODE_TYPES = {};

/**
 * Register a NodeTypeInfo entry. Idempotent on typeId.
 * @param {NodeTypeInfo} info
 */
export function registerNodeType(info) {
  NODE_TYPES[info.typeId] = info;
}

/** @param {string} typeId */
export function getNodeType(typeId) {
  return NODE_TYPES[typeId] ?? null;
}

/**
 * Build socket array (with `inOut` filled in) from a SocketDecl list.
 * @param {SocketDecl[]} declarations
 */
export function buildSocketsFromDeclarations(declarations) {
  return declarations.map((d) => ({
    identifier: d.identifier,
    name: d.name,
    type: d.type,
    inOut: d.inOut,
    defaultValue: d.defaultValue,
  }));
}

// ---------- RigTree node types ----------

registerNodeType({
  typeId: 'PartInput',
  label: 'Part Input',
  category: 'rig',
  sockets: [
    { identifier: 'positions', name: 'Positions',
      type: SocketType.MESH, inOut: SocketInOut.OUTPUT },
  ],
  execute: (_node, ctx) => {
    // Reads source mesh.vertices for the part. Resolved by build-pass
    // wiring (the part's mesh vertex array becomes the seed input).
    return ctx?.partVertices ?? null;
  },
});

registerNodeType({
  typeId: 'PartOutput',
  label: 'Part Output',
  category: 'rig',
  sockets: [
    { identifier: 'positions', name: 'Positions',
      type: SocketType.MESH, inOut: SocketInOut.INPUT },
  ],
  execute: (_node, ctx) => {
    // Sink — caller reads the input value as the final positions.
    return ctx?.inputs?.positions ?? null;
  },
});

registerNodeType({
  typeId: 'WarpModifier',
  label: 'Warp Deformer',
  category: 'rig',
  sockets: [
    { identifier: 'positions', name: 'Positions',
      type: SocketType.MESH, inOut: SocketInOut.INPUT },
    { identifier: 'positions', name: 'Positions',
      type: SocketType.MESH, inOut: SocketInOut.OUTPUT },
  ],
  // Storage carries: { deformerId, enabled, mode, showInEditor, synthetic? }.
  // Execute proxies to the depgraph's GRID_LIFT_TO_PARENT output via
  // the dispatch layer (NODETREE_NODE_EVAL kernel reads ctx.outputs).
  execute: (node, ctx) => {
    const id = node.storage?.deformerId;
    if (!id) return ctx?.inputs?.positions ?? null;
    return ctx?.depgraphOutputs?.get?.(`${id}/GEOMETRY/GRID_LIFT_TO_PARENT`) ?? null;
  },
});

registerNodeType({
  typeId: 'RotationModifier',
  label: 'Rotation Deformer',
  category: 'rig',
  sockets: [
    { identifier: 'positions', name: 'Positions',
      type: SocketType.MESH, inOut: SocketInOut.INPUT },
    { identifier: 'positions', name: 'Positions',
      type: SocketType.MESH, inOut: SocketInOut.OUTPUT },
  ],
  execute: (node, ctx) => {
    const id = node.storage?.deformerId;
    if (!id) return ctx?.inputs?.positions ?? null;
    return ctx?.depgraphOutputs?.get?.(`${id}/GEOMETRY/MATRIX_BUILD`) ?? null;
  },
});
