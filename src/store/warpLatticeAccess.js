// @ts-check

/**
 * Warp ↔ Lattice node seam.
 *
 * The single classification + cage-access point for the "warps as
 * first-class Lattice/grid-mesh objects" refactor
 * (docs/plans/WARP_AS_LATTICE_OBJECT_REFACTOR_PLAN.md).
 *
 * # Why this module exists (Slice 1.A)
 *
 * Today a warp is identified everywhere by the inline test
 * `node.type === 'deformer' && node.deformerKind === 'warp'`, and its rest
 * cage is read inline as `node.baseGrid`. Slice 1.B flips the storage:
 * warps become `{type:'object', objectKind:'lattice'}` nodes whose rest
 * cage is a real editable mesh (`meshData.vertices`), so the type test and
 * the cage read both change. The substrate map found ~15 read sites across
 * the depgraph kernels, selectRigSpec, the deformer-node readers, and the
 * UI — flipping each inline would be a 15-file mega-commit.
 *
 * So Slice 1.A routes every site through these accessors WITHOUT changing
 * behaviour (they read the CURRENT `deformer/warp` shape). Slice 1.B then
 * flips ONLY this module's internals + the writers + the migration. This is
 * the same dual-path-accessor pattern the codebase already uses for the
 * v17→v18 mesh split (`objectDataAccess.getMesh`) and the v28 modifier-data
 * fold (`objectDataAccess.getModifierData`). Blender keeps the analogous
 * seam in `BKE_lattice` (lattice geometry access decoupled from callers).
 *
 * NOTE — what does NOT move and is therefore NOT seamed here: a warp's
 * keyforms, gridSize, localFrame, bindings, isQuadTransform, targetPartId,
 * canvasBbox stay as object-side metadata on the node post-flip (design
 * decision #3 in the plan), so callers keep reading `node.<field>` directly.
 * Only the TYPE discriminator and the rest-cage (`baseGrid`) change.
 *
 * @module store/warpLatticeAccess
 */

import { getMeshVertices } from './objectDataAccess.js';

/**
 * Whether `node` is a warp/lattice cage — the deformer whose grid bilinearly
 * warps its descendant art-mesh verts.
 *
 * Matches BOTH shapes:
 *   - `{type:'object', objectKind:'lattice'}` — the ONLY PERSISTED shape
 *     after the v43 flip (Slice 1.B). Both the migration and the auto-rig
 *     seeders now emit this (Phase 5), so a stored project never carries a
 *     `deformer/warp` node.
 *   - `{type:'deformer', deformerKind:'warp'}` — the TRANSIENT interchange
 *     shape `synthesizeDeformerNodesForExport` inflates each lattice OBJECT
 *     into so the selectRigSpec → moc3/cmo3 wire emitters keep consuming the
 *     control-grid form unchanged (Blender analogue: a Lattice evaluates into
 *     a transient deformation the exporter reads; the persisted datablock is
 *     the lattice). selectRigSpec overlays these synth nodes into its
 *     `nodeById` map and resolves parent refs through this predicate, so the
 *     arm is LIVE export infrastructure — NOT dead transition compat, and NOT
 *     droppable without re-architecting the byte-fidelity-critical export
 *     path (`_warpNodeToSpec` + topo-sort) onto lattice objects directly.
 *     Phase 5 removed the OTHER reason this arm existed (un-flipped auto-rig
 *     output); the synth-interchange reason is permanent by design.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isWarpLatticeNode(node) {
  if (!node || typeof node !== 'object') return false;
  if (node.type === 'object' && node.objectKind === 'lattice') return true;
  return node.type === 'deformer' && node.deformerKind === 'warp';
}

/**
 * Whether `node` is a v43 first-class Lattice (warp) OBJECT specifically
 * (not the legacy `deformer/warp` transient shape). Its cage has a FIXED
 * rows×cols topology the Cubism exporter requires, so Edit-Mode topology
 * ops (add/remove/subdivide/dissolve vertex) must be HARD-BLOCKED on it —
 * only moving existing control points is allowed.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isLatticeCageObject(node) {
  return !!node && node.type === 'object' && node.objectKind === 'lattice';
}

/**
 * Whether `node` is a rotation deformer. Unchanged by the lattice refactor
 * (rotations stay `deformer/rotation`); seamed here only so the chain-walk
 * predicates that discriminate warp-vs-rotation read from one place.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isRotationDeformerNode(node) {
  if (!node || typeof node !== 'object') return false;
  return node.type === 'deformer' && node.deformerKind === 'rotation';
}

/** Prefix marking a group node that IS a group-rotation armature bone. */
export const GROUP_ROTATION_BONE_ROLE_PREFIX = 'groupRotation_';

/**
 * Whether `node` is a group-rotation deformer expressed as an armature BONE
 * (RULE №4 — Blender > Cubism: a Cubism RotationDeformer is, in Blender, a
 * bone that rotates a weighted group around its head/pivot). Such a node is a
 * `{type:'group'}` carrying `boneRole: 'groupRotation_<id>'` + a pivot in
 * `transform.pivotX/Y`. The Cubism `GroupRotation_<id>` rotation deformer is
 * re-synthesised from this at export/eval time by `synthesizeGroupRotationDeformers`.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isGroupRotationBoneNode(node) {
  return !!node && typeof node === 'object'
    && node.type === 'group'
    && typeof node.boneRole === 'string'
    && node.boneRole.startsWith(GROUP_ROTATION_BONE_ROLE_PREFIX);
}

/**
 * Whether `node` participates in the deformer/modifier chain as either a
 * warp/lattice cage or a rotation deformer. Replaces the inline
 * `node.type === 'deformer'` gate at sites that then branch on kind —
 * post-flip a lattice cage is an `object`, not a `deformer`, so the bare
 * `type === 'deformer'` test would wrongly reject it.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isChainDeformerNode(node) {
  return isWarpLatticeNode(node) || isRotationDeformerNode(node);
}

/**
 * The chain-node id a part modifier references. v43 lattice (warp)
 * modifiers reference their cage object via `objectId`; warp/rotation
 * modifiers reference a deformer node via `deformerId`. Armature modifiers
 * (no chain node) and malformed entries yield null.
 *
 * Single source of truth so every consumer (selectRigSpec, the export
 * adapter, the depgraph relation/eval passes, the node tree) resolves a
 * modifier's target the same way — a `mod.deformerId`-only read silently
 * skips lattice modifiers (the Phase-5/6 class of bug).
 *
 * @param {object|null|undefined} mod
 * @returns {string|null}
 */
export function modifierRefId(mod) {
  if (!mod || typeof mod !== 'object') return null;
  if (mod.type === 'lattice') {
    return typeof mod.objectId === 'string' ? mod.objectId : null;
  }
  return typeof mod.deformerId === 'string' ? mod.deformerId : null;
}

/**
 * The warp/lattice rest cage as a flat control-point array
 * `[x0,y0,x1,y1,...]` — the Basis grid the keyforms (shape keys) deform
 * relative to.
 *
 * Slice 1.A: `node.baseGrid`. Slice 1.B: the linked `meshData.vertices`
 * (the editable cage mesh) flattened back to the control-point array the
 * eval/export pipeline expects.
 *
 * Returns `undefined` when absent (callers coerce via numberArrayCoerce,
 * matching the previous `node.baseGrid` contract).
 *
 * @param {object|null|undefined} node
 * @param {object} [project] - needed for the lattice-object meshData lookup
 *   (a lattice cage mesh lives in `project.nodes` via `dataId`).
 * @returns {number[]|Float64Array|undefined}
 */
/**
 * Find the innermost (deepest, leaf-most) body-warp lattice id from a set
 * of warp/lattice nodes — the "deepest warp parent that has ≥2 children"
 * heuristic, with a fallback to the deepest BodyX/Y/Z/Breath name by
 * chain depth (handles flat linear body-warp chains where no node has
 * ≥2 children).
 *
 * Mirrors the original derivation in `_deriveInnermostBodyClosures`
 * (`selectRigSpec.js`), extracted to this seam so the synth and the
 * RigSpec selector share one implementation. The CLOSURES that
 * `_deriveInnermostBodyClosures` also produces (`canvasToInnermostX/Y`)
 * are NOT extracted because they need warp REST-state from the lift
 * pipeline; only the leaf-id portion is pure topology.
 *
 * Used by:
 *   - `synthesizeModifierStacks` (M3.2): bone-baked fallback's chain
 *     seed when modifiers[0] is armature-only — replaces the prior
 *     `mesh.runtime.parent.id` read.
 *   - `selectRigSpec._deriveInnermostBodyClosures` (production path —
 *     the helper is the topology-walk half of that function).
 *
 * @param {Array<object>} warpNodes - lattice/warp nodes (already filtered)
 * @param {Array<object>} allDeformerNodes - all chain-deformer nodes
 *   (warp + rotation) for accurate child-count of the chain hubs
 * @returns {string|null}
 */
export function findInnermostBodyWarpId(warpNodes, allDeformerNodes) {
  if (!Array.isArray(warpNodes) || warpNodes.length === 0) return null;
  // Build child count per warp id, counting BOTH warp + rotation children
  // (matches the chain-hub semantic — a warp is a "hub" if it has any
  // chain descendants, not just lattice descendants).
  /** @type {Map<string, number>} */
  const childCount = new Map();
  if (Array.isArray(allDeformerNodes)) {
    for (const d of allDeformerNodes) {
      if (d?.parent) childCount.set(d.parent, (childCount.get(d.parent) ?? 0) + 1);
    }
  }
  const byId = new Map(warpNodes.map((w) => [w.id, w]));
  /** @type {Map<string, string[]>} */
  const childrenById = new Map();
  for (const w of warpNodes) {
    if (!w?.parent || !byId.has(w.parent)) continue;
    if (!childrenById.has(w.parent)) childrenById.set(w.parent, []);
    childrenById.get(w.parent).push(w.id);
  }
  const roots = warpNodes.filter((w) => !w?.parent || !byId.has(w.parent));

  let best = null;
  let bestDepth = -1;
  function dfs(id, depth) {
    if ((childCount.get(id) ?? 0) >= 2 && depth > bestDepth) {
      bestDepth = depth;
      best = id;
    }
    const children = childrenById.get(id) ?? [];
    for (const c of children) dfs(c, depth + 1);
  }
  for (const r of roots) dfs(r.id, 0);

  // Fallback: pick the deepest BodyX/Y/Z/Breath name by chain depth even
  // without ≥2 children. Handles flat linear chains where no warp acts
  // as a hub.
  if (!best) {
    let depthBest = -1;
    function depthDfs(id, depth) {
      if (!byId.has(id)) return;
      const isBodyName = ['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp'].includes(id);
      if (isBodyName && depth > depthBest) {
        depthBest = depth;
        best = id;
      }
      const children = childrenById.get(id) ?? [];
      for (const c of children) depthDfs(c, depth + 1);
    }
    for (const r of roots) depthDfs(r.id, 0);
  }

  return best;
}

export function getWarpRestGrid(node, project) {
  if (!node) return undefined;
  // Lattice object: the rest cage IS the linked meshData's vertices. Flatten
  // the `{x,y}[]` cage back to the `[x0,y0,x1,y1,...]` control-point array
  // the eval/export pipeline expects.
  if (node.type === 'object' && node.objectKind === 'lattice') {
    const verts = getMeshVertices(node, project);
    if (!Array.isArray(verts)) return undefined;
    const flat = new Array(verts.length * 2);
    for (let i = 0; i < verts.length; i++) {
      flat[i * 2] = verts[i]?.x ?? 0;
      flat[i * 2 + 1] = verts[i]?.y ?? 0;
    }
    return flat;
  }
  // Transient synth node / un-flipped warp node: rest cage is inline.
  return node.baseGrid;
}
