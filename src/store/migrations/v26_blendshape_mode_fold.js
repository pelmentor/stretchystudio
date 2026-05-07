// @ts-check

/**
 * v26 — BLENDER_DEVIATION_AUDIT Fix 1.
 *
 * Folds the legacy `editMode === 'blendShape'` slot into Blender's
 * universal Edit Mode (`'edit'`) + an active-shape pointer pattern.
 * Pre-v26 SS surfaced shape-key painting as a peer of Edit / Pose;
 * Blender expresses it INSIDE Edit Mode (Mesh Data → Shape Keys
 * panel + active-shape pointer + brush behaviour switching when an
 * active shape is set).
 *
 * Persistence sites that may carry the legacy value:
 *   - `node.mode` (Phase 2b per-object mode storage on every Object).
 *
 * `editorStore.activeBlendShapeId` is still the active-shape pointer
 * — we don't touch it here. Pre-v26, that pointer was only meaningful
 * when `editMode === 'blendShape'`; post-v26, it's meaningful when
 * `editMode === 'edit'` AND set on a meshed part.
 *
 * Idempotent.
 *
 * @module store/migrations/v26_blendshape_mode_fold
 */

/**
 * @param {object} project
 */
export function migrateBlendShapeModeFold(project) {
  if (!project || !Array.isArray(project.nodes)) return;
  for (const node of project.nodes) {
    if (!node) continue;
    if (node.mode === 'blendShape') {
      node.mode = 'edit';
    }
  }
}
