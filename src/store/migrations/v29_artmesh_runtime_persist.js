// @ts-check

/**
 * v29 — persist `rigSpec.artMeshes` runtime data into project.nodes.
 *
 * # Why this exists
 *
 * Pre-v29 the runtime `rigSpec` consumed by `chainEval` came from TWO
 * disjoint code paths:
 *
 *   - **Init Rig**: `generateCmo3 result.rigSpec` — full data including
 *     per-art-mesh bindings + keyforms (handwear bone-baked angles, eye
 *     closure curves, neck-corner offsets, variant fades).
 *   - **Auto-fill / save+load**: `selectRigSpec(project)` — emits art
 *     meshes with a single rest keyform and zero bindings.
 *
 * The auto-fill subscriber in `rigSpecStore.js` overwrites the full
 * rigSpec with the fast one as soon as the project mutates, so even
 * IMMEDIATELY post Init Rig the bone-baked / eye-closure / variant
 * effects silently disappear from the live preview. Save+load makes
 * it permanent.
 *
 * # The fix
 *
 * `seedAllRig` now persists `harvest.rigSpec.artMeshes[i]`'s
 * `bindings + keyforms + parent` into the matching
 * `project.nodes[i].mesh.runtime` field (JSON-friendly:
 * `Float32Array` → `number[]`). `selectRigSpec._buildArtMeshes` reads
 * from there when present.
 *
 * Pre-v29 projects don't have the `runtime` field, so this migration
 * clears `project.lastInitRigCompletedAt`. The next viewport render
 * forces an async Init Rig that populates the new field. The user's
 * authored rig state (keyforms, bindings on deformer nodes,
 * user-authored markers) is preserved by `seedAllRig`'s `'merge'`
 * mode — they don't lose work, just have to wait one render for the
 * full rigSpec to repopulate.
 *
 * @module store/migrations/v29_artmesh_runtime_persist
 */

/**
 * @param {object} project
 */
export function migrateArtMeshRuntimePersist(project) {
  if (!project) return;
  // Force Init Rig re-run on next viewport render. The async path
  // populates `part.mesh.runtime` from `harvest.rigSpec.artMeshes`.
  project.lastInitRigCompletedAt = null;
}
