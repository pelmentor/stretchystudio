// @ts-check

/**
 * v3 Phase 1A — Outliner search filter.
 *
 * Pure: takes a tree + query string → new tree with rows whose `name`
 * (or `id`, as fallback) matches kept, plus the ancestor chain of any
 * match so the user keeps spatial context. Empty subtrees are pruned.
 *
 * Match is case-insensitive substring on the row's name. Phase 1A
 * follow-up may add fuzzy match / glob — keeping it dumb here so the
 * filter is predictable and `findOutlinerNode` remains fast.
 *
 * @module v3/editors/outliner/filters
 */

/**
 * @typedef {import('./treeBuilder.js').OutlinerNode} OutlinerNode
 */

/**
 * @param {OutlinerNode[]} roots
 * @param {string} query
 * @returns {OutlinerNode[]}
 */
export function filterOutlinerTree(roots, query) {
  const q = (query ?? '').trim().toLowerCase();
  if (!q) return roots;
  return roots
    .map((r) => filterNode(r, q))
    .filter((n) => n != null);
}

/**
 * F-4 sweep — predicate-based tree filter.
 *
 * Mirrors Blender's OUTLINER_PT_filter checkboxes (`reference/blender/
 * scripts/startup/bl_ui/space_outliner.py:471-526`) which keep a node
 * AND its ancestor chain when the predicate matches. Empty subtrees
 * pruned.
 *
 * @param {OutlinerNode[]} roots
 * @param {(node: OutlinerNode) => boolean} predicate
 * @returns {OutlinerNode[]}
 */
export function filterOutlinerTreeByPredicate(roots, predicate) {
  return roots
    .map((r) => filterNodeByPredicate(r, predicate))
    .filter((n) => n != null);
}

/**
 * @param {OutlinerNode} node
 * @param {(node: OutlinerNode) => boolean} predicate
 * @returns {OutlinerNode|null}
 */
function filterNodeByPredicate(node, predicate) {
  const selfMatches = predicate(node);
  /** @type {OutlinerNode[]} */
  const filteredChildren = [];
  for (const c of node.children) {
    const fc = filterNodeByPredicate(c, predicate);
    if (fc) filteredChildren.push(fc);
  }
  if (!selfMatches && filteredChildren.length === 0) return null;
  return { ...node, children: filteredChildren };
}

/**
 * @param {OutlinerNode} node
 * @param {string} q  - lower-cased non-empty query
 * @returns {OutlinerNode|null}
 */
function filterNode(node, q) {
  const selfMatches = nameMatches(node, q);

  /** @type {OutlinerNode[]} */
  const filteredChildren = [];
  for (const c of node.children) {
    const fc = filterNode(c, q);
    if (fc) filteredChildren.push(fc);
  }

  if (!selfMatches && filteredChildren.length === 0) return null;

  // Re-emit the node with possibly-filtered children. Preserve all
  // other fields verbatim so the renderer's selection / visibility /
  // sortKey logic doesn't change shape under filtering.
  return {
    ...node,
    children: filteredChildren,
  };
}

/** @param {OutlinerNode} n @param {string} q */
function nameMatches(n, q) {
  if (n.name && n.name.toLowerCase().includes(q)) return true;
  if (n.id && n.id.toLowerCase().includes(q)) return true;
  return false;
}
