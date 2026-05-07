// @ts-check

/**
 * NodeTree edit operations — pure functions over a NodeTree datablock.
 *
 * Phase N-5 of the V2 plan. The React editor (`NodeTreeEditor.jsx`)
 * dispatches drag-add / drag-link / drag-remove / undo gestures to
 * these operations; tests can drive them directly without a browser.
 *
 * Adapted from Blender's `node.cc` edit ops + `BKE_node.hh:521`
 * `validate_link` callback semantics.
 *
 * # Type validation
 *
 * `validateLink(tree, link)` checks:
 *   - Both endpoints exist.
 *   - From-socket is an OUTPUT socket on `fromNode`.
 *   - To-socket is an INPUT socket on `toNode`.
 *   - Socket types are compatible (exact match, or one of the
 *     allowed coercions).
 *
 * Allowed coercions in V2:
 *   - VALUE ↔ VALUE
 *   - MESH ↔ MESH
 *   - POSE ↔ POSE
 *   - TRANSFORM ↔ TRANSFORM
 *
 * No auto-conversion — type-mismatched drag is hard-rejected (matches
 * Phase N-5 plan: "no `auto-convert` sockets in V2 — any conversion
 * must be explicit").
 *
 * @module anim/nodetree/edits
 */

import { addNodeToTree, addLinkToTree, findNode, removeNodeFromTree } from './types.js';
import { getNodeType } from './registry.js';

/**
 * @typedef {{ ok: true } | { ok: false, reason: string }} ValidationResult
 */

/**
 * Validate a candidate Link record. Returns `{ok: true}` or
 * `{ok: false, reason}`. Does NOT mutate the tree.
 *
 * @param {import('./types.js').NodeTree} tree
 * @param {import('./types.js').Link} link
 * @returns {ValidationResult}
 */
export function validateLink(tree, link) {
  if (!tree || !Array.isArray(tree.nodes)) {
    return { ok: false, reason: 'no tree' };
  }
  if (!link?.fromNode || !link?.toNode) {
    return { ok: false, reason: 'missing endpoint' };
  }
  if (link.fromNode === link.toNode) {
    return { ok: false, reason: 'self-link' };
  }
  const from = findNode(tree, link.fromNode);
  const to = findNode(tree, link.toNode);
  if (!from)  return { ok: false, reason: `from node missing (${link.fromNode})` };
  if (!to)    return { ok: false, reason: `to node missing (${link.toNode})` };
  const fromSock = (from.outputs ?? []).find((s) => s.identifier === link.fromSocket);
  const toSock   = (to.inputs   ?? []).find((s) => s.identifier === link.toSocket);
  if (!fromSock) return { ok: false, reason: `from socket not found (${link.fromSocket})` };
  if (!toSock)   return { ok: false, reason: `to socket not found (${link.toSocket})` };
  if (fromSock.inOut !== 'output') {
    return { ok: false, reason: 'fromSocket is not an output' };
  }
  if (toSock.inOut !== 'input') {
    return { ok: false, reason: 'toSocket is not an input' };
  }
  if (fromSock.type !== toSock.type) {
    return { ok: false, reason: `type mismatch: ${fromSock.type} → ${toSock.type}` };
  }
  return { ok: true };
}

/**
 * Add a link iff it validates. Returns the validation result; on
 * success the link is appended to the tree (mutates).
 *
 * @param {import('./types.js').NodeTree} tree
 * @param {import('./types.js').Link} link
 * @returns {ValidationResult}
 */
export function addValidatedLink(tree, link) {
  const v = validateLink(tree, link);
  if (!v.ok) return v;
  addLinkToTree(tree, link);
  return v;
}

/**
 * Insert a fresh node at the given canvas position. The typeId must
 * be registered. Returns the new node, or null on miss.
 *
 * @param {import('./types.js').NodeTree} tree
 * @param {string} typeId
 * @param {[number, number]} position
 * @param {{ id?: string, storage?: object }} [opts]
 * @returns {import('./types.js').NodeTreeNode | null}
 */
export function addNodeAtPosition(tree, typeId, position, opts = {}) {
  const typeInfo = getNodeType(typeId);
  if (!typeInfo) return null;
  const id = opts.id ?? generateUniqueNodeId(tree, typeId);
  const inputs = (typeInfo.sockets ?? []).filter((s) => s.inOut === 'input');
  const outputs = (typeInfo.sockets ?? []).filter((s) => s.inOut === 'output');
  /** @type {import('./types.js').NodeTreeNode} */
  const node = {
    id,
    typeId,
    inputs: /** @type {any} */ (inputs.map((s) => ({ ...s }))),
    outputs: /** @type {any} */ (outputs.map((s) => ({ ...s }))),
    position: [position[0], position[1]],
    storage: opts.storage ?? {},
  };
  addNodeToTree(tree, node);
  return node;
}

/**
 * Generate a fresh node id within the given tree.
 *
 * @param {import('./types.js').NodeTree} tree
 * @param {string} typeId
 * @returns {string}
 */
export function generateUniqueNodeId(tree, typeId) {
  const stem = typeId.toLowerCase();
  let i = 0;
  while (true) {
    const candidate = `${stem}_${i}`;
    if (!findNode(tree, candidate)) return candidate;
    i++;
  }
}

/**
 * Remove a node + its incident links. Returns true on hit.
 *
 * @param {import('./types.js').NodeTree} tree
 * @param {string} nodeId
 * @returns {boolean}
 */
export function removeNode(tree, nodeId) {
  return removeNodeFromTree(tree, nodeId);
}

/**
 * Snapshot a tree's structure for undo/redo. Deep-clones nodes +
 * links arrays. Storage objects are clone-shallow — that's fine for
 * V2, since storage is JSON-only data.
 *
 * @param {import('./types.js').NodeTree} tree
 * @returns {import('./types.js').NodeTree}
 */
export function snapshotTree(tree) {
  return JSON.parse(JSON.stringify(tree));
}
