// @ts-check

/**
 * v3 Phase 1A — Outliner tree builder.
 *
 * Pure converter: `project.nodes` (flat array, parent-id pointers)
 * → recursive tree the OutlinerEditor renders. Sort order matches
 * the PSD authoring convention so the user reads a familiar list:
 * top of the outliner = top of the canvas (highest draw_order).
 *
 * Display mode for v1 is `'hierarchy'` only — group/part scene tree.
 * Plan §4.1 lists three more modes (rig / param / anim); each gets
 * its own builder added here later, dispatched from `buildOutlinerTree`.
 *
 * Pure function, no store reads — caller passes `nodes`. This keeps
 * the builder unit-testable and independent of the v3 shell.
 *
 * @module v3/editors/outliner/treeBuilder
 */

/**
 * Subset of project node fields the outliner consumes. Real project
 * nodes have many more fields; we only type the ones we read so the
 * builder stays decoupled from projectStore's full schema.
 *
 * @typedef {Object} ProjectNodeLike
 * @property {string}              id
 * @property {'part'|'group'}      type
 * @property {string}              name
 * @property {string|null|undefined} parent
 * @property {number=}             draw_order
 * @property {boolean=}            visible
 */

/**
 * @typedef {Object} OutlinerNode
 * @property {string}        id          - same as project node id
 * @property {'part'|'group'} type
 * @property {string}        name
 * @property {string|null}   parent      - id of parent OutlinerNode, or null at root
 * @property {OutlinerNode[]} children   - empty array for leaves
 * @property {boolean}       visible     - effective node.visible (default true)
 * @property {number}        sortKey     - the value children were sorted by; mostly diagnostic
 */

/**
 * @typedef {('hierarchy'|'rig'|'param'|'anim')} OutlinerDisplayMode
 */

const DEFAULT_DRAW_ORDER = 0;

/**
 * Build the outliner tree.
 *
 * @param {ProjectNodeLike[]} nodes
 * @param {{ mode?: OutlinerDisplayMode }} [opts]
 * @returns {OutlinerNode[]}  root-level nodes (parent === null)
 */
export function buildOutlinerTree(nodes, opts = {}) {
  const mode = opts.mode ?? 'hierarchy';
  if (mode !== 'hierarchy') {
    // rig / param / anim modes land in subsequent Phase 1A substages.
    // Throw rather than return [] so a typo in mode surfaces loudly.
    throw new Error(`buildOutlinerTree: mode '${mode}' not implemented yet`);
  }
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  // First pass — index by id, validate basic shape, drop malformed.
  /** @type {Map<string, ProjectNodeLike>} */
  const byId = new Map();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || n.id === '') continue;
    if (n.type !== 'part' && n.type !== 'group') continue;
    byId.set(n.id, n);
  }

  // Second pass — group children by parent id. We do this rather than
  // walk recursively per-root because the parent pointer can dangle
  // (orphaned node whose parent was deleted): catch and reparent to
  // root rather than silently drop.
  /** @type {Map<string, ProjectNodeLike[]>} */
  const childrenByParent = new Map();
  childrenByParent.set('__ROOT__', []);
  for (const n of nodes) {
    if (!n || !byId.has(n.id)) continue;
    const parent = (n.parent && byId.has(n.parent)) ? n.parent : '__ROOT__';
    let bucket = childrenByParent.get(parent);
    if (!bucket) { bucket = []; childrenByParent.set(parent, bucket); }
    bucket.push(n);
  }

  // Cycle detection: a part's parent chain must terminate at root.
  // We allow it as a tree by forcing the cycle-entry's parent to root
  // on second sight. (Real cycles are a data bug; the outliner stays
  // navigable while the rest of the app surfaces the error.)
  const onPath = new Set();

  /** @returns {number} sort key for `n` (groups: max descendant draw_order). */
  function effectiveDrawOrder(/** @type {ProjectNodeLike} */ n) {
    if (n.type === 'part') return n.draw_order ?? DEFAULT_DRAW_ORDER;
    // group — recurse over descendants, take max.
    const seen = new Set();
    let max = -Infinity;
    /** @param {ProjectNodeLike} g */
    function walk(g) {
      if (seen.has(g.id)) return;
      seen.add(g.id);
      const kids = childrenByParent.get(g.id) ?? [];
      for (const k of kids) {
        if (k.type === 'part') {
          const o = k.draw_order ?? DEFAULT_DRAW_ORDER;
          if (o > max) max = o;
        } else {
          walk(k);
        }
      }
    }
    walk(n);
    return max === -Infinity ? DEFAULT_DRAW_ORDER : max;
  }

  /**
   * @param {ProjectNodeLike} n
   * @returns {OutlinerNode}
   */
  function build(n) {
    if (onPath.has(n.id)) {
      // Cycle — synthesize a leaf so we don't recurse forever.
      return {
        id: n.id, type: n.type, name: n.name,
        parent: null,
        children: [],
        visible: n.visible !== false,
        sortKey: DEFAULT_DRAW_ORDER,
      };
    }
    onPath.add(n.id);
    const rawKids = childrenByParent.get(n.id) ?? [];
    const kids = rawKids
      .map(build)
      // PSD convention: higher draw_order on top of the list (top of canvas).
      .sort((a, b) => b.sortKey - a.sortKey);
    onPath.delete(n.id);
    return {
      id: n.id,
      type: n.type,
      name: n.name,
      parent: n.parent && byId.has(n.parent) ? n.parent : null,
      children: kids,
      visible: n.visible !== false,
      sortKey: effectiveDrawOrder(n),
    };
  }

  const roots = (childrenByParent.get('__ROOT__') ?? [])
    .map(build)
    .sort((a, b) => b.sortKey - a.sortKey);
  return roots;
}

/**
 * Walk the outliner tree depth-first, calling `visit(node, depth)`
 * on each node. Used by the renderer to flatten tree → row list once
 * expand/collapse state is applied.
 *
 * @param {OutlinerNode[]} roots
 * @param {(node: OutlinerNode, depth: number) => void} visit
 * @param {(node: OutlinerNode) => boolean} [shouldDescend]
 *   Predicate that returns true to descend into `node.children`. If
 *   omitted, descends always. The OutlinerEditor passes a function
 *   that consults the expand/collapse Set so collapsed groups skip
 *   their subtree.
 */
export function walkOutlinerTree(roots, visit, shouldDescend) {
  /** @param {OutlinerNode} n @param {number} d */
  function step(n, d) {
    visit(n, d);
    if (shouldDescend && !shouldDescend(n)) return;
    for (const c of n.children) step(c, d + 1);
  }
  for (const r of roots) step(r, 0);
}

/**
 * Find an outliner node by id. Returns null when missing.
 *
 * @param {OutlinerNode[]} roots
 * @param {string} id
 * @returns {OutlinerNode|null}
 */
export function findOutlinerNode(roots, id) {
  /** @type {OutlinerNode|null} */
  let found = null;
  walkOutlinerTree(roots, (n) => {
    if (!found && n.id === id) found = n;
  });
  return found;
}

/**
 * Compute the set of ancestor ids for `id`. Used when something
 * outside the outliner selects a node — the outliner auto-expands
 * the chain so the selection becomes visible.
 *
 * @param {OutlinerNode[]} roots
 * @param {string} id
 * @returns {string[]}  ancestor ids root→leaf order, EXCLUDING `id`
 */
export function ancestorChain(roots, id) {
  /** @type {string[]} */
  const path = [];
  /** @param {OutlinerNode[]} list */
  function search(list) {
    for (const n of list) {
      if (n.id === id) return true;
      path.push(n.id);
      if (search(n.children)) return true;
      path.pop();
    }
    return false;
  }
  search(roots);
  return path;
}
