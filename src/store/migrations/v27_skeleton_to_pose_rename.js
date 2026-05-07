// @ts-check

/**
 * v27 — BLENDER_DEVIATION_AUDIT Fix 2.
 *
 * Renames the editMode slot value `'skeleton'` to `'pose'` to match
 * Blender's `OB_MODE_POSE` taxonomy. SS originally called the bone-
 * editing mode "Skeleton Edit", later collapsed Armature Edit into
 * Pose Mode (2026-05-06 commit `9df561f`) but kept the legacy slot
 * name `'skeleton'`. This migration brings the slot value in line
 * with Blender.
 *
 * Note: `viewLayers.skeleton` is the skeleton-overlay-visibility
 * boolean and is NOT renamed — it's a layer name, not a mode.
 *
 * Persistence sites that may carry the legacy value:
 *   - `node.mode` (Phase 2b per-object mode storage on every Object).
 *
 * Idempotent.
 *
 * @module store/migrations/v27_skeleton_to_pose_rename
 */

/**
 * @param {object} project
 */
export function migrateSkeletonToPoseRename(project) {
  if (!project || !Array.isArray(project.nodes)) return;
  for (const node of project.nodes) {
    if (!node) continue;
    if (node.mode === 'skeleton') {
      node.mode = 'pose';
    }
  }
}
