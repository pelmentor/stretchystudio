// @ts-check

/**
 * NodeTree datablock types.
 *
 * Phase N-1 of the V2 plan. Loose port of Blender's NodeTree DNA
 * (`reference/blender/source/blender/makesdna/DNA_node_types.h:1421-1966`):
 *
 *   - `bNodeSocket` (DNA:1421) → `Socket`
 *   - `bNode`       (DNA:1615) → `NodeTreeNode`
 *   - `bNodeLink`   (DNA:1829) → `Link`
 *   - `bNodeTree`   (DNA:1879) → `NodeTree`
 *
 * # Tree types
 *
 * Per `eNodeTree_Type` (DNA:274-283), Blender has shader / compositor /
 * texture / geometry trees. SS V2 introduces three SS-specific types
 * (per the V2 plan §Refactor 2):
 *
 *   - `RigTree`       — per part. Replaces modifier stack with a graph.
 *   - `DriverTree`    — per project. Replaces scripted-driver strings.
 *   - `AnimationTree` — per animation clip. NLA-style strip composition.
 *
 * The tree shape is identical across types — what differs is the
 * `nodeType` registry entries that populate it (see `registry.js`).
 *
 * # SS deviations
 *
 * - **No runtime cache.** Blender's `bNodeTreeRuntime` carries
 *   layout cache + dispatch tables. SS computes those on demand from
 *   the depgraph build pass; trees stored in the project are pure
 *   data.
 * - **Sockets typed by data domain, not C struct.** Blender has 15+
 *   socket types. SS V2 starts with `'value'` (scalar number) and
 *   `'transform'` (2D affine), enough for RigTree + DriverTree.
 *   AnimationTree adds `'pose'` and `'mesh'` later.
 * - **No socket panels / categories.** UI grouping is rendered by the
 *   editor (Phase N-4) but not stored on the tree.
 *
 * @module anim/nodetree/types
 */

/** Socket data types — SS subset of `eNodeSocketDatatype` (DNA:233). */
export const SocketType = Object.freeze({
  VALUE:     'value',     // scalar number (most common)
  TRANSFORM: 'transform', // 2D affine [a, b, tx, c, d, ty]
  POSE:      'pose',      // {x, y, rotation, scaleX, scaleY}
  MESH:      'mesh',      // vertex array (for meshDef-style nodes)
});

/** Socket direction — `eNodeSocketInOut` (DNA:236). */
export const SocketInOut = Object.freeze({
  INPUT:  'input',
  OUTPUT: 'output',
});

/**
 * NodeTree types — SS V2 subset of `eNodeTree_Type` (DNA:274).
 *
 * Post-v38 NodeTree retirement (Audit-fix D-8): these strings are
 * pure visualisation discriminators on the in-memory derived tree
 * objects consumed by `NodeTreeEditor`. They are NOT schema-bound —
 * no save-on-disk field carries them anymore. The Stage 1.E audit-fix
 * G-5 stalemate (`'animation'` lagged the rename because the
 * underlying tree datablock was still `animation`-named) is dissolved
 * — there's no datablock to rename anymore.
 */
export const NodeTreeType = Object.freeze({
  RIG:       'rig',
  DRIVER:    'driver',
  ANIMATION: 'animation',
});

/**
 * @typedef {object} Socket
 * @property {string} identifier - unique within a node's input/output set
 * @property {string} name       - display label
 * @property {typeof SocketType[keyof typeof SocketType]} type
 * @property {typeof SocketInOut[keyof typeof SocketInOut]} inOut
 * @property {any}    [defaultValue] - used when the input socket is unlinked
 *
 * @typedef {object} NodeTreeNode
 * @property {string} id          - unique within a NodeTree
 * @property {string} typeId      - `'WarpModifier' | 'RotationModifier' | 'PartInput' | ...`
 * @property {Socket[]} inputs
 * @property {Socket[]} outputs
 * @property {object}  [storage]  - per-type arbitrary data (e.g. deformerId for modifier nodes)
 * @property {[number, number]} [position] - editor canvas position (px)
 *
 * @typedef {object} Link
 * @property {string} fromNode    - source node id
 * @property {string} fromSocket  - source socket identifier
 * @property {string} toNode      - dest node id
 * @property {string} toSocket    - dest socket identifier
 *
 * @typedef {object} NodeTree
 * @property {string} id          - unique within project (e.g. `'rig:face'`)
 * @property {typeof NodeTreeType[keyof typeof NodeTreeType]} type
 * @property {NodeTreeNode[]} nodes
 * @property {Link[]} links
 * @property {string} [partId]    - for RigTree: the part this tree belongs to
 * @property {string} [actionId] - for AnimationTree: the action
 */

/**
 * Build a fresh empty tree.
 *
 * @param {string} id
 * @param {typeof NodeTreeType[keyof typeof NodeTreeType]} type
 * @param {Partial<NodeTree>} [extras]
 * @returns {NodeTree}
 */
export function makeNodeTree(id, type, extras = {}) {
  return {
    id,
    type,
    nodes: [],
    links: [],
    ...extras,
  };
}

/**
 * Add a node to the tree. Mutates in place. Returns the node.
 *
 * @param {NodeTree} tree
 * @param {NodeTreeNode} node
 * @returns {NodeTreeNode}
 */
export function addNodeToTree(tree, node) {
  if (!Array.isArray(tree.nodes)) tree.nodes = [];
  tree.nodes.push(node);
  return node;
}

/**
 * Add a link to the tree, deduplicating exact (from→to socket) repeats.
 * Returns true on insert, false on dedup. Type compatibility is NOT
 * checked here — Phase N-5 adds socket-type validation at the editor
 * layer (`validate_link` per `BKE_node.hh:521`).
 *
 * @param {NodeTree} tree
 * @param {Link} link
 * @returns {boolean}
 */
export function addLinkToTree(tree, link) {
  if (!Array.isArray(tree.links)) tree.links = [];
  for (const existing of tree.links) {
    if (existing.fromNode === link.fromNode &&
        existing.fromSocket === link.fromSocket &&
        existing.toNode === link.toNode &&
        existing.toSocket === link.toSocket) {
      return false;
    }
  }
  tree.links.push(link);
  return true;
}

/**
 * @param {NodeTree} tree
 * @param {string} nodeId
 * @returns {NodeTreeNode | null}
 */
export function findNode(tree, nodeId) {
  if (!Array.isArray(tree?.nodes)) return null;
  return tree.nodes.find((n) => n?.id === nodeId) ?? null;
}

/**
 * Remove a node + all its incident links. Mutates in place.
 *
 * @param {NodeTree} tree
 * @param {string} nodeId
 * @returns {boolean} - true if a node was removed
 */
export function removeNodeFromTree(tree, nodeId) {
  if (!Array.isArray(tree?.nodes)) return false;
  const idx = tree.nodes.findIndex((n) => n?.id === nodeId);
  if (idx < 0) return false;
  tree.nodes.splice(idx, 1);
  if (Array.isArray(tree.links)) {
    tree.links = tree.links.filter(
      (l) => l.fromNode !== nodeId && l.toNode !== nodeId,
    );
  }
  return true;
}

/**
 * Topologically order a tree's nodes by data flow (sources before
 * sinks). Cycle-safe — cyclic links are tolerated (the offending
 * node lands at the end, marked nowhere — the eval pass would also
 * detect and flag).
 *
 * @param {NodeTree} tree
 * @returns {NodeTreeNode[]} - topo-ordered (sources first)
 */
export function topoOrderTree(tree) {
  if (!Array.isArray(tree?.nodes)) return [];
  const inEdges = new Map();
  for (const n of tree.nodes) inEdges.set(n.id, 0);
  for (const l of tree.links ?? []) {
    inEdges.set(l.toNode, (inEdges.get(l.toNode) ?? 0) + 1);
  }
  const ready = tree.nodes.filter((n) => (inEdges.get(n.id) ?? 0) === 0);
  const out = [];
  const visited = new Set();
  while (ready.length > 0) {
    const n = ready.shift();
    if (!n || visited.has(n.id)) continue;
    visited.add(n.id);
    out.push(n);
    for (const l of tree.links ?? []) {
      if (l.fromNode !== n.id) continue;
      const cnt = (inEdges.get(l.toNode) ?? 0) - 1;
      inEdges.set(l.toNode, cnt);
      if (cnt === 0) {
        const next = tree.nodes.find((nn) => nn.id === l.toNode);
        if (next) ready.push(next);
      }
    }
  }
  // Append remaining (cycles) at end.
  for (const n of tree.nodes) {
    if (!visited.has(n.id)) out.push(n);
  }
  return out;
}
