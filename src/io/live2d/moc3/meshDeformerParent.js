// @ts-check

/**
 * Mesh → parent_deformer_index assignment for the .moc3 generator.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #39).
 *
 * `art_mesh.parent_deformer_indices` references the umbrella `deformer.*`
 * array (post-topo-sort), NOT the natural `warpSpecs` order. Using the
 * wrong index pointed meshes at the wrong deformer entirely (severe
 * misrendering: arms swapped, body collapsed). Resolution cascade:
 *
 *   1. **Per-mesh rig warp** — mesh has its own `RigWarp_*` (per-mesh
 *      structural warp from cmo3 emit) → parent to it.
 *   2. **Bone-baked mesh** — bone's parent group's rotation deformer
 *      (matches cmo3's `dfOwner = boneGroup.parent`).
 *   3. **Group rotation** — mesh's own group's rotation deformer when
 *      one exists.
 *   4. **Deepest body warp** (BodyXWarp / Breath / BodyWarpY/Z).
 *
 * `art_mesh.parent_part_indices` is a separate concern: the drawing-tree
 * (visibility / draw-order organisation) hierarchy stays at the mesh's
 * group/root part regardless of any deformer chain. cmo3 emits
 * `meshSrc.parentGuid` the same way.
 *
 * @module io/live2d/moc3/meshDeformerParent
 */

/**
 * @param {Object} opts
 * @returns {{
 *   parentDeformerIndices: number[],
 *   parentPartIndices: number[],
 * } | null}
 *   `null` when the rig has no body warp chain (no reparenting needed).
 */
export function buildMeshDeformerParents(opts) {
  const {
    meshParts, groups,
    warpSpecs, rotationSpecs,
    deformerIdToIndex, meshDefaultDeformerIdx,
    partIdMap,
  } = opts;

  if (meshDefaultDeformerIdx < 0) return null;

  // partId → unified deformer index (post-topo-sort).
  /** @type {Map<string, number>} */
  const partIdToDeformerIdx = new Map();
  for (const w of warpSpecs) {
    if (!w.targetPartId) continue;
    const ui = deformerIdToIndex.get(w.id);
    if (ui != null) partIdToDeformerIdx.set(w.targetPartId, ui);
  }

  // groupId → rotation deformer's unified index. Bone-baked meshes
  // (arms / legs) parent to their bone's parent group's rotation
  // deformer; non-rig-warp meshes parent to their own group's rotation
  // deformer when one exists.
  /** @type {Map<string, number>} */
  const groupIdToRotIdx = new Map();
  for (const r of rotationSpecs) {
    if (!r.id?.startsWith('GroupRotation_')) continue;
    const gid = r.id.substring('GroupRotation_'.length);
    const ui = deformerIdToIndex.get(r.id);
    if (ui != null) groupIdToRotIdx.set(gid, ui);
  }

  const parentDeformerIndices = meshParts.map(p => {
    const fromRigWarp = partIdToDeformerIdx.get(p.id);
    if (fromRigWarp != null) return fromRigWarp;
    const jointBoneId = p.mesh?.jointBoneId;
    if (jointBoneId && p.mesh?.boneWeights) {
      const boneGroup = groups.find(g => g.id === jointBoneId);
      const armGroupId = boneGroup?.parent;
      if (armGroupId && groupIdToRotIdx.has(armGroupId)) {
        return /** @type {number} */(groupIdToRotIdx.get(armGroupId));
      }
    }
    if (p.parent && groupIdToRotIdx.has(p.parent)) {
      return /** @type {number} */(groupIdToRotIdx.get(p.parent));
    }
    return meshDefaultDeformerIdx;
  });

  const parentPartIndices = meshParts.map(p => {
    if (p.parent && partIdMap.has(p.parent)) return partIdMap.get(p.parent);
    return 0;
  });

  return { parentDeformerIndices, parentPartIndices };
}
