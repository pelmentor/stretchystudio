// @ts-check

/**
 * NodeTree eval — topo-sorted dispatch over a single tree.
 *
 * Phase N-1 of the V2 plan. The depgraph's NODETREE_NODE_EVAL
 * kernel will eventually wrap this (Phase N-2/3 wiring), but for
 * Phase N-1 the eval pass is direct: caller passes a tree + ctx,
 * gets back a Map<nodeId, anyOutput>.
 *
 * # Eval order
 *
 * `topoOrderTree(tree)` produces sources-first ordering. For each
 * node we:
 *   1. Resolve every input socket value: walk incoming Links to find
 *      the upstream output value; if no incoming link, use socket
 *      `defaultValue`.
 *   2. Call `typeInfo.execute(node, { inputs, ...ctx })`.
 *   3. Store the result keyed by `nodeId` in the outputs Map.
 *
 * # SS deviation
 *
 * Blender's node eval is a lazy-function graph (compiled per tree).
 * SS V2 does an eager pass — simpler to debug, fast enough for
 * thousands of nodes. The lazy compilation can land later if perf
 * profiling shows it matters.
 *
 * @module anim/nodetree/eval
 */

import { topoOrderTree } from './types.js';
import { getNodeType } from './registry.js';

/**
 * Evaluate a NodeTree end-to-end.
 *
 * @param {import('./types.js').NodeTree} tree
 * @param {object} ctx - shared eval context (project, depgraphOutputs, ...)
 * @returns {Map<string, any>} - keyed by node.id; value is execute() return
 */
export function evalNodeTree(tree, ctx) {
  /** @type {Map<string, any>} */
  const outputs = new Map();
  if (!tree || !Array.isArray(tree.nodes)) return outputs;
  const ordered = topoOrderTree(tree);

  for (const node of ordered) {
    const typeInfo = getNodeType(node.typeId);
    if (!typeInfo) continue;

    // Resolve input socket values from incoming links + defaults.
    /** @type {Record<string, any>} */
    const inputs = {};
    for (const sock of node.inputs ?? []) {
      const incoming = (tree.links ?? []).find(
        (l) => l.toNode === node.id && l.toSocket === sock.identifier,
      );
      if (incoming) {
        // Read the upstream node's output for this socket.
        const upstreamOutputs = outputs.get(incoming.fromNode);
        if (upstreamOutputs && typeof upstreamOutputs === 'object'
            && incoming.fromSocket in upstreamOutputs) {
          inputs[sock.identifier] = upstreamOutputs[incoming.fromSocket];
        } else {
          // Single-output case: typeInfo may return a bare value.
          inputs[sock.identifier] = upstreamOutputs;
        }
      } else if (sock.defaultValue !== undefined) {
        inputs[sock.identifier] = sock.defaultValue;
      }
    }

    let result;
    if (typeof typeInfo.execute === 'function') {
      try {
        result = typeInfo.execute(node, { ...ctx, inputs });
      } catch {
        result = undefined;
      }
    }
    outputs.set(node.id, result);
  }

  return outputs;
}

/**
 * Convenience: evaluate every RigTree on a project and return a Map
 * keyed by partId → final positions (PartOutput's input).
 *
 * @param {object} project
 * @param {object} ctx
 * @returns {Map<string, any>}
 */
export function evalAllRigTrees(project, ctx) {
  /** @type {Map<string, any>} */
  const partOutputs = new Map();
  const rigMap = project?.nodeTrees?.rig ?? {};
  for (const [partId, tree] of Object.entries(rigMap)) {
    const partVertices = ctx?.partVertices?.[partId] ?? null;
    const treeCtx = { ...ctx, partVertices };
    const outputs = evalNodeTree(tree, treeCtx);
    // PartOutput is the sink — find it and lift its input value.
    const sinkNode = (tree.nodes ?? []).find((n) => n.typeId === 'PartOutput');
    if (sinkNode) {
      partOutputs.set(partId, outputs.get(sinkNode.id) ?? null);
    }
  }
  return partOutputs;
}
