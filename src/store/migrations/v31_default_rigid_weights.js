// @ts-check

/**
 * v31 — Cubism Adapter Phase 1: default rigid vertex weights for parts
 * under bones.
 *
 * Pre-v31 SS shipped a binary composition path: limb meshes had vertex
 * groups + Armature modifier (LBS); other bone-followed parts (torso,
 * hat, hair) had no weights and rendered via the rigid overlay-matrix
 * path in `CanvasViewport`. Two parallel paths were the BUG-028
 * surface (post-Apply double-rotation on weighted parts).
 *
 * v31 collapses this: every meshed part with a bone-group ancestor
 * gets `mesh.boneWeights = [1.0, ...]` (length = vertices.length) and
 * `mesh.jointBoneId = <nearest isBoneGroup ancestor.id>` if those
 * fields aren't already populated. Renderer then composes via LBS
 * uniformly; cmo3/moc3 export uses the Cubism Adapter
 * (`extractMeshExportStruct` + `vertexGroupVariance.isRigidVertexGroup`)
 * to strip the rigid-intent weights so wire format stays byte-identical
 * to pre-v31 projects.
 *
 * Phase D of the plan (overlay-matrix-path deletion) strict-depends on
 * this migration shipping first — without v31, any project loaded but
 * not re-Init-Rigged would have non-limb parts silently stop following
 * bones once the overlay path is gone (audit Issue 6).
 *
 * # Idempotence
 *
 * `seedDefaultRigidWeights` only writes when `mesh.boneWeights` is
 * missing or length-mismatched. Re-running on a v31+ project is a
 * no-op. Per-vertex weights from `computeSkinWeights` (limbs) and
 * user-painted weights are never overwritten.
 *
 * # Composition with the bone-routing-intent guard
 *
 * The migration assigns `jointBoneId = <nearest isBoneGroup ancestor>`
 * — exactly the bone the part's structural-parent walk produces. The
 * Cubism Adapter's `isRigidVertexGroup` predicate sees `jointBoneId
 * === nearestBoneAncestorId` (its 4th arg) and returns true → adapter
 * strips → byte-identical export. Hand-only sub-meshes whose
 * `jointBoneId` was set by `computeSkinWeights` to a DIFFERENT bone
 * (e.g. 'leftElbow' under a 'leftArm' parent) skip this migration's
 * write because their boneWeights are already populated; the predicate
 * sees the mismatch and preserves their data.
 *
 * @module store/migrations/v31_default_rigid_weights
 */

import { seedDefaultRigidWeights } from '../seedDefaultRigidWeights.js';

/**
 * @param {object} project — mutated in place
 */
export function migrateDefaultRigidWeights(project) {
  if (!project || !Array.isArray(project.nodes)) return;
  seedDefaultRigidWeights(project);
}
