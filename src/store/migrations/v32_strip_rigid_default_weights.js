// @ts-check

/**
 * Schema v32 — strip rigid-1.0 vertex weights written by v31's
 * `seedDefaultRigidWeights`.
 *
 * # Why this migration exists
 *
 * v31 (Cubism Adapter Pattern) wrote `mesh.boneWeights = [1.0, …]` +
 * `mesh.jointBoneId = nearestBoneAncestor.id` onto every meshed part
 * with a bone-group ancestor — including parts that didn't need
 * per-vertex skinning. The intent was to unify the renderer's
 * composition decision around LBS, but it conflated "follows bone"
 * with "is per-vertex skinned" — anti-Blender, source of three
 * regression bugs in two days.
 *
 * v32 reverts the contamination: walks every meshed part, runs
 * `isRigidVertexGroup` on its current weights+jointBoneId, and
 * deletes both fields when the predicate returns true. Parts with
 * meaningful per-vertex variation (limb skinning from
 * `computeSkinWeights`) keep their weights. Parts with bone-routing
 * intent (jointBoneId !== structural-parent bone — Audit Issue 8
 * hand-only sub-meshes) also keep their weights.
 *
 * After the strip, the part follows its bone visually via the
 * `'overlay'` render path (parent-chain transform composition,
 * Blender-correct), not via LBS-with-all-1.0-weights.
 *
 * # Consumer fallout (handled by the same v32 step)
 *
 * `synthesizeModifierStacks` adds an Armature modifier whenever a
 * mesh has `boneWeights+jointBoneId`. After we strip those fields,
 * the synthesized Armature entry on the part's `node.modifiers[]`
 * becomes stale — would re-bind to weights that no longer exist.
 * v32 also walks `node.modifiers[]` and removes orphan armature
 * entries (modifier exists, but mesh has no boneWeights/jointBoneId).
 *
 * # Cross-references
 *
 * - `docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md` §4 — the
 *   revert plan this migration implements.
 * - `src/lib/vertexGroupVariance.js` — `isRigidVertexGroup` predicate
 *   (4-arg form preserves bone-routing intent).
 * - v31 migration (`v31_default_rigid_weights.js`) — what this
 *   reverts. After v32 ships, the v31 migration becomes a no-op for
 *   already-migrated projects but stays in place for projects loaded
 *   from older saves (v30 → v31 → v32 walks idempotently).
 *
 * @module store/migrations/v32_strip_rigid_default_weights
 */

import { isBoneGroup, isMeshedPart, getMesh } from '../objectDataAccess.js';
import {
  isRigidVertexGroup,
  nearestBoneAncestorId,
} from '../../lib/vertexGroupVariance.js';

/**
 * Strip rigid-1.0 weights from already-migrated v31 projects.
 *
 * @param {object} project — mutated in place
 * @returns {{ partsStripped: number, modifiersRemoved: number }}
 */
export function migrateStripRigidDefaultWeights(project) {
  const stats = { partsStripped: 0, modifiersRemoved: 0 };
  if (!project || !Array.isArray(project.nodes)) return stats;

  const byId = new Map();
  for (const n of project.nodes) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }

  for (const part of project.nodes) {
    if (!isMeshedPart(part, project)) continue;
    const mesh = getMesh(part, project);
    if (!mesh) continue;
    const vertCount = Array.isArray(mesh.vertices) ? mesh.vertices.length : 0;
    if (vertCount === 0) continue;
    const weights = mesh.boneWeights;
    const jointBoneId = mesh.jointBoneId;
    if (!Array.isArray(weights) || weights.length === 0) continue;
    if (typeof jointBoneId !== 'string' || jointBoneId.length === 0) continue;

    const nearestBoneId = nearestBoneAncestorId(part, byId, isBoneGroup);
    const isRigid = isRigidVertexGroup(weights, vertCount, jointBoneId, nearestBoneId);
    if (!isRigid) continue;

    delete mesh.boneWeights;
    delete mesh.jointBoneId;
    stats.partsStripped++;

    // Remove orphan Armature modifier (no longer has weights to drive).
    if (Array.isArray(part.modifiers)) {
      const idx = part.modifiers.findIndex((m) => m && m.type === 'armature');
      if (idx >= 0) {
        part.modifiers.splice(idx, 1);
        if (part.modifiers.length === 0) delete part.modifiers;
        stats.modifiersRemoved++;
      }
    }
  }

  return stats;
}
