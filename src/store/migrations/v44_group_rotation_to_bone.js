// @ts-check

/**
 * v44 — GroupRotation deformer → armature bone (RULE №4).
 *
 * # Why this exists
 *
 * A Cubism `GroupRotation_<g>` deformer is, in Blender, the group `<g>`
 * acting as an armature bone that rotates its weighted meshes around its
 * head (the pivot). Pre-v44 projects persist these as
 * `{type:'deformer', deformerKind:'rotation'}` nodes with parts bound via
 * `rigParent` + `ParamRotation_<g>` bindings. v44 converts them to the
 * Blender authoring model (bone + weight-1 vertex group + bone-LBS owns
 * the rotation); the Cubism deformer is re-synthesised at export time by
 * `synthesizeGroupRotationDeformers` (the downstream adapter).
 *
 * # The mechanism — force an Init Rig re-run (mirrors v29)
 *
 * The conversion (`migrateGroupRotationDeformersToBones`) is wired into
 * `seedAllRig`, which runs on the LIVE project shape (inline `node.mesh`)
 * and derives each bone head from `mesh.vertices − pivot-relative runtime
 * keyform`. Doing the same conversion here would have to re-resolve the
 * v18 Object/ObjectData split (`node.dataId` → `meshData`) and would leave
 * the rest of the rig stale. Instead — like v29 — clear
 * `lastInitRigCompletedAt` so the next viewport render forces an async
 * Init Rig; `seedAllRig` then applies the bone migration on the canonical
 * path. User-authored rig state is preserved by `seedAllRig`'s `'merge'`
 * mode; the `ParamRotation_<g>` slider keeps driving the bone via the
 * skinning-based param mirror (`_buildBoneMirrorEntries`).
 *
 * @module store/migrations/v44_group_rotation_to_bone
 */

/**
 * @param {object} project
 */
export function migrateGroupRotationToBoneViaReseed(project) {
  if (!project) return;
  // Force Init Rig re-run on next viewport render. The async path runs
  // `seedAllRig` → `migrateGroupRotationDeformersToBones`, converting the
  // persisted GroupRotation deformers into armature bones.
  project.lastInitRigCompletedAt = null;
}
