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

/**
 * Whether `node` is a warp/lattice cage — the deformer whose grid bilinearly
 * warps its descendant art-mesh verts.
 *
 * Slice 1.A: `deformer/warp`. Slice 1.B: also `object/lattice`.
 *
 * @param {object|null|undefined} node
 * @returns {boolean}
 */
export function isWarpLatticeNode(node) {
  if (!node || typeof node !== 'object') return false;
  return node.type === 'deformer' && node.deformerKind === 'warp';
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
 * @param {object} [_project] - reserved: the Slice 1.B meshData lookup needs
 *   it (a lattice cage mesh lives in `project.nodes` via `dataId`). Callers
 *   pass `project` now so 1.B needn't re-touch every call site.
 * @returns {number[]|Float64Array|undefined}
 */
export function getWarpRestGrid(node, _project) {
  if (!node) return undefined;
  return node.baseGrid;
}
