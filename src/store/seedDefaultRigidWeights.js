// @ts-check

/**
 * Cubism Adapter — Phase 1: default rigid vertex weights for parts
 * under bones.
 *
 * Walks every meshed part in `project.nodes` whose nearest ancestor
 * (via `node.parent` chain) is an `isBoneGroup` node. For each such
 * part:
 *   - If `mesh.boneWeights` is already populated AND its length
 *     matches `mesh.vertices.length` → leave intact. This preserves
 *     `computeSkinWeights` output (limb skinning) and any user-painted
 *     weights.
 *   - Else if `mesh.vertices` has known length → fill
 *     `mesh.boneWeights = [1.0, 1.0, …]` of that length, set
 *     `mesh.jointBoneId = nearestBoneAncestor.id` (the predicate
 *     `isBoneGroup` ensures `boneRole` is set, which
 *     `synthesizeModifierStacks` requires for Armature-modifier
 *     synthesis).
 *
 * # Why this exists
 *
 * Pre-2026-05-09 SS shipped a binary composition path: limb meshes had
 * vertex groups + Armature modifier (LBS); other bone-followed parts
 * (torso, hat, hair) had nothing and rendered via the rigid overlay-
 * matrix path in CanvasViewport. Two parallel composition paths were
 * the BUG-028 surface (post-Apply double-rotation on weighted parts).
 *
 * The Cubism Adapter pattern collapses both paths into one: every
 * bone-followed part has vertex groups (rigid = all-1.0 "red paint";
 * skinned = per-vertex variation). Renderer goes through LBS
 * uniformly; cmo3/moc3 export strips rigid-intent weights to preserve
 * wire-format byte-fidelity.
 *
 * # Composition with other rig stages
 *
 * - Runs in `seedAllRig` AFTER mesh sync (which guarantees
 *   `mesh.vertices.length` is current) and BEFORE
 *   `synthesizeModifierStacks` (which adds the Armature modifier when
 *   weights are present).
 * - Idempotent: re-running on a project that already has rigid
 *   weights is a no-op.
 * - Lossless: only writes when both fields would otherwise be null /
 *   missing. User-authored boneWeights / per-vertex skinning are never
 *   overwritten.
 *
 * # Predicate consistency with `synthesizeModifierStacks`
 *
 * `synthesizeModifierStacks` adds an Armature modifier only when
 * `byId.get(jointBoneId)` is `isBoneGroup` (`type === 'group' &&
 * boneRole`). This pass uses the same predicate to walk the ancestor
 * chain → the assigned `jointBoneId` always passes the synth's guard,
 * so the Armature modifier is guaranteed to surface for newly-rigid
 * parts. (Audit Issue 2 / 3 from `CUBISM_ADAPTER_PATTERN.md` §9.)
 *
 * @module store/seedDefaultRigidWeights
 */

import { isBoneGroup, isMeshedPart, getMesh } from './objectDataAccess.js';

/**
 * @param {object} project — mutated in place
 * @returns {{ partsSeeded: number, partsSkippedAlreadyHasWeights: number, partsSkippedNoBoneAncestor: number }}
 */
export function seedDefaultRigidWeights(project) {
  const stats = {
    partsSeeded: 0,
    partsSkippedAlreadyHasWeights: 0,
    partsSkippedNoBoneAncestor: 0,
  };
  if (!project || !Array.isArray(project.nodes)) return stats;

  // Index nodes for O(1) ancestor walk.
  const byId = new Map();
  for (const n of project.nodes) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }

  for (const part of project.nodes) {
    if (!isMeshedPart(part, project)) continue;
    const mesh = getMesh(part, project);
    if (!mesh) continue;
    const vertCount = Array.isArray(mesh.vertices) ? mesh.vertices.length : 0;
    if (vertCount === 0) continue;  // mesh not yet processed

    // Skip if already weighted to a length matching the vertex count.
    // computeSkinWeights output (limbs) and user-painted weights both
    // satisfy this; we don't clobber them. Length-mismatched arrays
    // are treated as missing — they would fail downstream readers
    // anyway and we'd rather backfill rigid-1.0 than leave a malformed
    // partial.
    if (
      Array.isArray(mesh.boneWeights)
      && mesh.boneWeights.length === vertCount
      && typeof mesh.jointBoneId === 'string'
      && mesh.jointBoneId.length > 0
    ) {
      stats.partsSkippedAlreadyHasWeights++;
      continue;
    }

    // Walk to nearest bone-group ancestor (boneRole-bearing).
    // Cycle-guarded against malformed self-parent references.
    let cursor = part.parent ? byId.get(part.parent) : null;
    const seen = new Set();
    let nearestBone = null;
    while (cursor) {
      if (seen.has(cursor)) break;
      seen.add(cursor);
      if (isBoneGroup(cursor)) { nearestBone = cursor; break; }
      cursor = cursor.parent ? byId.get(cursor.parent) : null;
    }
    if (!nearestBone) {
      stats.partsSkippedNoBoneAncestor++;
      continue;
    }

    // Fill rigid weights + assign jointBoneId. The synth's guard
    // (jointBone is isBoneGroup) is satisfied because `nearestBone`
    // came from `isBoneGroup` itself.
    mesh.boneWeights = new Array(vertCount).fill(1.0);
    mesh.jointBoneId = nearestBone.id;
    stats.partsSeeded++;
  }

  return stats;
}
