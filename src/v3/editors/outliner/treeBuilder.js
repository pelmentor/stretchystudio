// @ts-check

/**
 * v3 Phase 1A — Outliner tree builder.
 *
 * Pure converter: `project.nodes` (flat array, parent-id pointers)
 * → recursive tree the OutlinerEditor renders. Sort order matches
 * the PSD authoring convention so the user reads a familiar list:
 * top of the outliner = top of the canvas (highest draw_order).
 *
 * Plan §4.1 specifies five display modes:
 *
 *   - `'viewLayer'` — Blender's "View Layer" — single canonical tree
 *                     unifying the scene hierarchy AND the rig graph.
 *                     Post-BFA-006 Phase 4 this is just the unified
 *                     hierarchy walker over `project.nodes` (which
 *                     now contains deformer nodes alongside parts +
 *                     groups; see Phase 1 + Phase 3). Bones get an
 *                     `isBone` flag, deformers an `isDeformer` /
 *                     `deformerKind` flag so TreeNode picks the right
 *                     icon. Default — Blender's "one tree, expand to drill".
 *   - `'hierarchy'` — legacy alias: just project.nodes. Identical to
 *                     `viewLayer` after Phase 4 (kept for back-compat
 *                     with existing tests).
 *   - `'rig'`       — rigSpec deformer tree only (warps + rotations)
 *                     with art meshes shown under their parent deformer.
 *   - `'skeleton'`  — armature-only filter: only `boneRole`-tagged
 *                     groups, bone-to-bone parent chain. Click selects
 *                     the bone; SkeletonOverlay highlights it on the
 *                     canvas in lockstep.
 *   - `'param'`     — parameters grouped by role. (Not implemented;
 *                     covered by ParametersEditor for now.)
 *   - `'anim'`      — animations + tracks. (Not implemented; lands
 *                     with Phase 3 Timeline editor.)
 *
 * Pure function, no store reads — caller passes nodes / rigSpec
 * explicitly. This keeps the builder unit-testable and independent
 * of the v3 shell.
 *
 * @module v3/editors/outliner/treeBuilder
 */

/**
 * Subset of project node fields the outliner consumes.
 *
 * @typedef {Object} ProjectNodeLike
 * @property {string}              id
 * @property {'part'|'group'|'deformer'}      type
 * @property {string}              name
 * @property {string|null|undefined} parent
 * @property {number=}             draw_order
 * @property {boolean=}            visible
 * @property {string|null=}        boneRole
 *   When `type === 'group'` and this is set, the group is a skeleton
 *   bone. Used by `'skeleton'` mode to filter to bones-only.
 * @property {('warp'|'rotation')=} deformerKind
 *   When `type === 'deformer'`, discriminates warp vs rotation. Phase 4
 *   surfaces this via the `isDeformer`/`deformerKind` fields on
 *   `OutlinerNode` so TreeNode can pick the matching icon.
 */

/**
 * @typedef {Object} DeformerSpecLike
 * @property {string}                                id
 * @property {string=}                               name
 * @property {{type:string, id?:string|null}=}       parent
 *
 * @typedef {Object} ArtMeshSpecLike
 * @property {string}                                id
 * @property {{type:string, id?:string|null}=}       parent
 *
 * @typedef {Object} RigSpecLike
 * @property {DeformerSpecLike[]=}  warpDeformers
 * @property {DeformerSpecLike[]=}  rotationDeformers
 * @property {ArtMeshSpecLike[]=}   artMeshes
 */

/**
 * Outliner row.
 *
 * `type` discriminates how the row renders + which selectionStore
 * type it dispatches:
 *   - 'part' / 'group' come from the hierarchy mode.
 *   - 'deformer' comes from rig mode (kind tells warp vs rotation).
 *   - 'artmesh' is the rig-mode leaf (selects the part by mesh id).
 *
 * @typedef {Object} OutlinerNode
 * @property {string}                                          id
 * @property {('part'|'group'|'deformer'|'artmesh')}           type
 * @property {string}                                          name
 * @property {string|null}                                     parent
 * @property {OutlinerNode[]}                                  children
 * @property {boolean}                                         visible
 * @property {number}                                          sortKey
 * @property {('warp'|'rotation')=}                            deformerKind
 * @property {boolean=}                                        isBone
 *   Skeleton-mode rows set this so TreeNode renders a bone icon
 *   instead of the default folder. The underlying node is still a
 *   group (selectionStore uses `type:'group'`).
 * @property {boolean=}                                        isDeformer
 *   BFA-006 Phase 4 — set on `type:'deformer'` rows in the unified
 *   hierarchy tree. Lets TreeNode pick a deformer-specific icon
 *   without overloading `type` (we keep `type:'deformer'` so
 *   selectionStore + click-routing works the same).
 */

/**
 * @typedef {('viewLayer'|'hierarchy'|'rig'|'skeleton'|'param'|'anim')} OutlinerDisplayMode
 */

const DEFAULT_DRAW_ORDER = 0;

/**
 * Build the outliner tree.
 *
 * @param {ProjectNodeLike[]|RigSpecLike|{nodes?: ProjectNodeLike[], rigSpec?: RigSpecLike|null}|null|undefined} input
 *   For `'hierarchy'` / `'skeleton'` mode: project.nodes array.
 *   For `'rig'` mode: a rigSpec object.
 *   For `'viewLayer'` mode: an object `{nodes, rigSpec}` so the
 *   builder can compose both into one tree.
 * @param {{ mode?: OutlinerDisplayMode }} [opts]
 * @returns {OutlinerNode[]}
 */
export function buildOutlinerTree(input, opts = {}) {
  const mode = opts.mode ?? 'viewLayer';
  switch (mode) {
    case 'viewLayer': {
      const composite = /** @type {{nodes?: ProjectNodeLike[], rigSpec?: RigSpecLike|null}} */ (input);
      const nodes = Array.isArray(composite?.nodes) ? composite.nodes
        : (Array.isArray(input) ? /** @type {ProjectNodeLike[]} */ (input) : []);
      const rigSpec = composite?.rigSpec ?? null;
      return buildViewLayerTree(nodes, rigSpec);
    }
    case 'hierarchy':
      return buildHierarchyTree(/** @type {ProjectNodeLike[]} */ (input));
    case 'rig':
      return buildRigTree(/** @type {RigSpecLike} */ (input));
    case 'skeleton':
      return buildSkeletonTree(/** @type {ProjectNodeLike[]} */ (input));
    case 'param':
    case 'anim':
      throw new Error(`buildOutlinerTree: mode '${mode}' not implemented yet`);
    default:
      throw new Error(`buildOutlinerTree: unknown mode '${mode}'`);
  }
}

/**
 * Deprecated. Pre-Phase-4 export of the synthetic "Rig" pseudo-root id;
 * `buildViewLayerTree` no longer composes a rig branch since deformer
 * nodes now live in `project.nodes` directly (BFA-006 Phase 1+3).
 *
 * Kept exported (set to `null`) so any third-party / scratch consumer
 * that imported it keeps loading; check should be `id !== RIG_PSEUDO_ROOT_ID`
 * which now always evaluates true. Remove in a future release.
 *
 * @deprecated since BFA-006 Phase 4 — no longer used.
 */
export const RIG_PSEUDO_ROOT_ID = null;

/**
 * BFA-006 Phase 4 — viewLayer is the unified hierarchy. Deformer
 * nodes live in `project.nodes` post-Phase-3 (warps from the
 * migration v15 + dual-write seeders, rotations from `seedAllRig`'s
 * rotation dual-write), so the unified tree is just
 * `buildHierarchyTree(nodes)` — no synthetic pseudo-root, no rigSpec
 * composition.
 *
 * The `rigSpec` argument is accepted for back-compat with the prior
 * caller signature but ignored.
 *
 * @param {ProjectNodeLike[]|null|undefined} nodes
 * @param {RigSpecLike|null|undefined} _rigSpec  unused (Phase 4)
 * @returns {OutlinerNode[]}
 */
function buildViewLayerTree(nodes, _rigSpec) {
  return buildHierarchyTree(nodes);
}

/**
 * @param {ProjectNodeLike[]|null|undefined} nodes
 * @returns {OutlinerNode[]}
 */
function buildHierarchyTree(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  /** @type {Map<string, ProjectNodeLike>} */
  const byId = new Map();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || n.id === '') continue;
    // BFA-006 Phase 4 — accept deformer nodes too. Phase 1 + Phase 3
    // ship them as first-class entries on `project.nodes`; the
    // hierarchy walker below renders them under their `node.parent`
    // (chain parent for deformers).
    if (n.type !== 'part' && n.type !== 'group' && n.type !== 'deformer') continue;
    byId.set(n.id, n);
  }

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

  const onPath = new Set();

  /** @returns {number} sort key for `n` (groups: max descendant draw_order). */
  function effectiveDrawOrder(/** @type {ProjectNodeLike} */ n) {
    if (n.type === 'part') return n.draw_order ?? DEFAULT_DRAW_ORDER;
    // Phase 4 — deformer nodes have no draw_order. Pin them below the
    // lowest part draw_order so they cluster at the bottom of the
    // root list (parts/groups stay on top, matching today's UX).
    if (n.type === 'deformer') return -1;
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
    // `boneRole`-tagged groups get the `isBone` flag here too (not just
    // in skeleton mode), so the unified "View Layer" tree shows the
    // bone icon inline. The flag is type-orthogonal — selectionStore
    // still treats them as `type:'group'`.
    const isBone = n.type === 'group' && !!n.boneRole;
    // Phase 4 — deformers get the `isDeformer` flag (+ `deformerKind`
    // for icon picking). Same idea: the type stays `'deformer'` so
    // selection routing works; the flag is for TreeNode rendering.
    const isDeformer = n.type === 'deformer';
    const deformerKind = isDeformer && (n.deformerKind === 'rotation' || n.deformerKind === 'warp')
      ? n.deformerKind : undefined;
    if (onPath.has(n.id)) {
      return {
        id: n.id, type: n.type, name: n.name,
        parent: null,
        children: [],
        visible: n.visible !== false,
        sortKey: DEFAULT_DRAW_ORDER,
        ...(isBone ? { isBone: true } : null),
        ...(isDeformer ? { isDeformer: true } : null),
        ...(deformerKind ? { deformerKind } : null),
      };
    }
    onPath.add(n.id);
    const rawKids = childrenByParent.get(n.id) ?? [];
    const kids = rawKids
      .map(build)
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
      ...(isBone ? { isBone: true } : null),
      ...(isDeformer ? { isDeformer: true } : null),
      ...(deformerKind ? { deformerKind } : null),
    };
  }

  const roots = (childrenByParent.get('__ROOT__') ?? [])
    .map(build)
    .sort((a, b) => b.sortKey - a.sortKey);
  return roots;
}

/**
 * Build the armature tree — only `boneRole`-tagged groups, parent chain
 * collapsed to bone-to-bone (a bone whose `parent` points at a non-bone
 * group is treated as a root). Mirrors Blender's Armature outliner.
 *
 * Sort order: alphabetical by `boneRole` within siblings — the auto-rig
 * naming convention (`leftArm` / `rightArm`, `leftLeg` / `rightLeg`,
 * `leftKnee` / `rightKnee`) makes this stable and readable.
 *
 * @param {ProjectNodeLike[]|null|undefined} nodes
 * @returns {OutlinerNode[]}
 */
function buildSkeletonTree(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];

  /** @type {Map<string, ProjectNodeLike>} */
  const bonesById = new Map();
  for (const n of nodes) {
    if (!n || typeof n.id !== 'string' || n.id === '') continue;
    if (n.type !== 'group') continue;
    if (!n.boneRole) continue;
    bonesById.set(n.id, n);
  }
  if (bonesById.size === 0) return [];

  /** @type {Map<string, ProjectNodeLike[]>} */
  const childrenByParent = new Map();
  childrenByParent.set('__ROOT__', []);
  for (const bone of bonesById.values()) {
    // Walk up `parent` chain until we land on another bone (or the
    // project root). Non-bone groups in between are skipped — they're
    // not part of the armature view.
    let p = bone.parent ?? null;
    while (p && !bonesById.has(p)) {
      const upstream = nodes.find((n) => n?.id === p);
      p = upstream?.parent ?? null;
    }
    const parentKey = p && bonesById.has(p) ? p : '__ROOT__';
    let bucket = childrenByParent.get(parentKey);
    if (!bucket) { bucket = []; childrenByParent.set(parentKey, bucket); }
    bucket.push(bone);
  }

  const onPath = new Set();

  /**
   * @param {ProjectNodeLike} bone
   * @returns {OutlinerNode}
   */
  function build(bone) {
    if (onPath.has(bone.id)) {
      return {
        id: bone.id, type: 'group', name: bone.boneRole ?? bone.name,
        parent: null, children: [], visible: bone.visible !== false,
        sortKey: 0, isBone: true,
      };
    }
    onPath.add(bone.id);
    const rawKids = childrenByParent.get(bone.id) ?? [];
    const kids = rawKids.map(build).sort((a, b) => a.name.localeCompare(b.name));
    onPath.delete(bone.id);
    return {
      id: bone.id,
      type: 'group',
      // Surface boneRole as the row label — auto-rig conventions
      // (`head`, `leftArm`, `bothLegs`) read better than the auto-
      // generated group name which often duplicates the role.
      name: bone.boneRole ?? bone.name,
      parent: bone.parent && bonesById.has(bone.parent) ? bone.parent : null,
      children: kids,
      visible: bone.visible !== false,
      sortKey: 0,
      isBone: true,
    };
  }

  return (childrenByParent.get('__ROOT__') ?? [])
    .map(build)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build the rigSpec deformer tree.
 *
 * Warp / rotation deformers are listed by their `parent` reference;
 * art meshes hang under their parent deformer as leaves. Roots are
 * deformers whose parent is `{type: 'root'}` (or null/missing).
 *
 * Sort order: insertion order from the rigSpec arrays. The rig
 * generator's emission order is meaningful (parents emitted before
 * children of the same depth); we don't second-guess it.
 *
 * @param {RigSpecLike|null|undefined} rigSpec
 * @returns {OutlinerNode[]}
 */
function buildRigTree(rigSpec) {
  if (!rigSpec || typeof rigSpec !== 'object') return [];

  /** @type {Array<{kind:'warp'|'rotation', spec: DeformerSpecLike}>} */
  const deformers = [];
  for (const d of rigSpec.warpDeformers ?? []) {
    if (d?.id) deformers.push({ kind: 'warp', spec: d });
  }
  for (const d of rigSpec.rotationDeformers ?? []) {
    if (d?.id) deformers.push({ kind: 'rotation', spec: d });
  }

  /** @type {Map<string, {kind:'warp'|'rotation', spec:DeformerSpecLike, idx:number}>} */
  const byId = new Map();
  deformers.forEach((d, idx) => byId.set(d.spec.id, { ...d, idx }));

  /** @type {Map<string, OutlinerNode[]>} */
  const childrenByParent = new Map();
  childrenByParent.set('__ROOT__', []);

  // Helper: parent-key resolves to a known deformer id, or '__ROOT__'.
  function parentKey(parentRef) {
    if (!parentRef) return '__ROOT__';
    if (parentRef.type === 'root') return '__ROOT__';
    if (parentRef.id && byId.has(parentRef.id)) return parentRef.id;
    return '__ROOT__'; // dangling parent → reparent to root, like hierarchy mode
  }

  // Build deformer nodes first (no children populated yet).
  /** @type {Map<string, OutlinerNode>} */
  const nodeById = new Map();
  for (const d of deformers) {
    /** @type {OutlinerNode} */
    const node = {
      id: d.spec.id,
      type: 'deformer',
      deformerKind: d.kind,
      name: d.spec.name ?? d.spec.id,
      parent: null,
      children: [],
      visible: true,
      sortKey: 0,
    };
    nodeById.set(d.spec.id, node);
    const pk = parentKey(d.spec.parent);
    let bucket = childrenByParent.get(pk);
    if (!bucket) { bucket = []; childrenByParent.set(pk, bucket); }
    bucket.push(node);
    node.parent = pk === '__ROOT__' ? null : pk;
  }

  // Append art meshes as leaves under their parent deformer.
  for (const am of rigSpec.artMeshes ?? []) {
    if (!am?.id) continue;
    /** @type {OutlinerNode} */
    const leaf = {
      id: am.id,
      type: 'artmesh',
      name: am.id,
      parent: null,
      children: [],
      visible: true,
      sortKey: 0,
    };
    const pk = parentKey(am.parent);
    let bucket = childrenByParent.get(pk);
    if (!bucket) { bucket = []; childrenByParent.set(pk, bucket); }
    bucket.push(leaf);
    leaf.parent = pk === '__ROOT__' ? null : pk;
  }

  // Cycle recovery — any deformer whose chain forms a cycle (A↔B)
  // or sits in an isolated component (no path to ROOT) wouldn't be
  // visited otherwise. Promote each unreached node to a root so the
  // outliner stays navigable. Match hierarchy mode's "dangling parent
  // → reparent to root" behavior: prefer surfacing the data over
  // hiding it.
  const reached = new Set();
  /** @param {OutlinerNode} n */
  function markReached(n) {
    if (reached.has(n.id)) return;
    reached.add(n.id);
    for (const k of childrenByParent.get(n.id) ?? []) markReached(k);
  }
  for (const r of childrenByParent.get('__ROOT__') ?? []) markReached(r);
  for (const node of nodeById.values()) {
    if (!reached.has(node.id)) {
      // Cut its parent edge (so the cycle sibling doesn't drag it
      // back when we attach), promote to root.
      node.parent = null;
      markReached(node);
      const rootBucket = childrenByParent.get('__ROOT__') ?? [];
      rootBucket.push(node);
      childrenByParent.set('__ROOT__', rootBucket);
    }
  }

  // Wire children. Cycle guard via onPath: when we revisit a node,
  // stop descending — the recovery above ensured every node is
  // reachable from a root, so the truncated subtree still surfaces.
  const onPath = new Set();
  /** @param {OutlinerNode} n */
  function attach(n) {
    if (onPath.has(n.id)) {
      n.children = [];
      return;
    }
    onPath.add(n.id);
    const kids = (childrenByParent.get(n.id) ?? []).filter((k) => !onPath.has(k.id));
    for (const k of kids) attach(k);
    n.children = kids;
    onPath.delete(n.id);
  }
  for (const root of childrenByParent.get('__ROOT__') ?? []) attach(root);

  return childrenByParent.get('__ROOT__') ?? [];
}

/**
 * Walk the outliner tree depth-first.
 *
 * @param {OutlinerNode[]} roots
 * @param {(node: OutlinerNode, depth: number) => void} visit
 * @param {(node: OutlinerNode) => boolean} [shouldDescend]
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
 * Find an outliner node by id.
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
 * Compute the set of ancestor ids for `id`. EXCLUDES `id` itself.
 *
 * @param {OutlinerNode[]} roots
 * @param {string} id
 * @returns {string[]}
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
