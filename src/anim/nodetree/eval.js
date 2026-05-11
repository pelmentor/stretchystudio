// @ts-check

/**
 * NodeTree eval — topo-sorted dispatch over a single tree.
 *
 * # Schema state
 *
 * Post-v38 NodeTree retirement: this is a TEST-ONLY harness. The
 * pre-v38 framing claimed the depgraph's NODETREE_NODE_EVAL kernel
 * would wrap it; that wiring never landed (Stage 1.D shipped
 * depgraph-driven action eval through `evaluateActionFCurves`
 * directly). Audit-fix G-2 from the retirement audit narrowed this
 * to a single-tree harness — the multi-tree `evalAllRigTrees` (which
 * read `project.nodeTrees.rig`) was deleted with v38.
 *
 * # Why preserved
 *
 * `evalNodeTree(tree, ctx)` is generic over node `typeInfo.execute`
 * functions; the byte-equivalence tests for `compileAnimationTree` →
 * `interpolateTrack` (`scripts/test/test_animationTree_compile.mjs`)
 * + `compileDriverTree` → `evaluateDriver`
 * (`scripts/test/test_driverTree_eval.mjs`) drive node executors
 * through this harness. Deleting it would force rewrites of those
 * tests to dispatch executors directly (no behavioural gain, churn
 * for churn).
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
 * SS does an eager pass — simpler to debug, fast enough for the
 * test surface. Production runtime evaluation lives in the
 * depgraph kernels, not here.
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
