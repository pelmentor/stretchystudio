// @ts-check

/**
 * v45 — bone-baked art-mesh adapter (RULE №4 follow-up, Leak #1).
 *
 * # Why this exists
 *
 * Pre-v45 projects persist bone-baked art-mesh keyforms — N entries
 * per `boneConfig.bakedKeyformAngles` on `ParamRotation_<bone>` — in
 * `part.mesh.runtime.keyforms[]` + `part.mesh.runtime.bindings[]`.
 * The v44 viewport collapsed these post-persist in
 * `selectRigSpec._liveSkinBoneBaked`, so the depgraph never saw them;
 * but the keyforms still sat in the store, wired spurious
 * `ParamRotation_<bone>` → artMesh dependency edges in the depgraph
 * build (`anim/depgraph/build.js`), and acted as dead-on-read storage.
 *
 * Slice 1B (2026-05-23) moved the collapse upstream into the emitter
 * (`io/live2d/cmo3/artMeshSourceEmit.js`, `pm.hasBakedKeyforms`
 * branch): the rigCollector now pushes a single rest keyform on
 * ParamOpacity[1.0] for bone-baked parts; bone LBS owns the
 * deformation via `applyBonePostChainSkin` /
 * `applyTwoBoneSkinning`. The Cubism XML export still emits N
 * CArtMeshForm entries (the adapter side).
 *
 * Slice 1C removed the `_liveSkinBoneBaked` shim from selectRigSpec
 * — it's dead code now that the emitter produces clean data. To
 * keep that removal safe for existing projects (which carry stale
 * persisted bakes), v45 forces a re-Init Rig so `seedAllRig` rebuilds
 * `mesh.runtime` from the new emitter output. Same mechanism as v29
 * + v44.
 *
 * @module store/migrations/v45_bone_baked_art_mesh_adapter
 */

/**
 * @param {object} project
 */
export function migrateBoneBakedArtMeshAdapterViaReseed(project) {
  if (!project) return;
  // Force Init Rig re-run on next viewport render. The async path
  // runs generateCmo3 + persistArtMeshRuntime → bone-baked parts get
  // a single ParamOpacity[1.0] rest keyform in `mesh.runtime`, shedding
  // the pre-v45 ParamRotation_<bone> N-keyform bake.
  project.lastInitRigCompletedAt = null;
}
