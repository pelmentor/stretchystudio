// @ts-check

/**
 * Toolset Plan Phase 7.A.2 — Mirror selected (`Ctrl+M` then `X`/`Y`).
 *
 * Implements a 2D analog of Blender's `OBJECT_OT_transform_apply` +
 * `TRANSFORM_OT_mirror` (`reference/blender/source/blender/editors/
 * transform/transform_ops.cc:1047+` for `TRANSFORM_OT_mirror` def;
 * the `proportional`/`constraint_axis` plumbing is in
 * `transform_generics.cc`). Hotkey: `Ctrl+M` opens the axis-pick
 * popover per `blender_default.py:4544` (Object Mode keymap).
 *
 * Mirror geometry:
 *   - Axis = X: world X mirrors across the selection's median X.
 *     Rotation flips sign; scaleX flips sign; pose.x flips sign.
 *   - Axis = Y: world Y mirrors across the selection's median Y.
 *     Rotation flips sign; scaleY flips sign; pose.y flips sign.
 *   - Axis = Z: no-op in 2D (accepted gracefully — single toast
 *     `"Z axis has no effect in 2D"`).
 *
 * # Pivot
 *
 * Median pivot mode (Blender's default for multi-object mirror).
 * Mirror axis passes through `(median.x, median.y)` of selected world
 * origins. For a single-object selection the median == that object's
 * origin, so it mirrors in place.
 *
 * # Bones
 *
 * Bones excluded — bone mirror is a Pose Mode operator (`pose.mirrorPose`,
 * §7.C.5).
 *
 * # Mesh data
 *
 * Mesh vertex positions are NOT mirrored — only the part's transform.
 * Mirroring the actual geometry requires the Mirror modifier (out of
 * scope this phase). Documented in `MIRROR_GEOMETRY_GAP.md` once the
 * audit lands.
 *
 * @module v3/operators/object/mirror
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { computeWorldMatrices } from '../../../renderer/transforms.js';
import { isBoneGroup } from '../../../store/objectDataAccess.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';
import { eligibleSelection, nodeWorldOrigin, worldToParentLocal, medianOfOrigins } from './snap.js';

/**
 * Mirror every selected non-bone node's transform across `axis` ('x'|'y')
 * through the selection-median pivot.
 *
 * @param {'x' | 'y' | 'z'} axis
 * @returns {{ mirrored: number, skippedBones: number, axis: string }}
 */
export function mirrorSelected(axis) {
  if (axis === 'z') {
    return { mirrored: 0, skippedBones: 0, axis: 'z' };
  }
  if (axis !== 'x' && axis !== 'y') {
    return { mirrored: 0, skippedBones: 0, axis };
  }
  const items = useSelectionStore.getState().items ?? [];
  const project = useProjectStore.getState().project;
  const byId = new Map();
  for (const n of project?.nodes ?? []) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }
  const eligibleIds = [];
  let skippedBones = 0;
  for (const it of items) {
    if (it?.type !== 'part' && it?.type !== 'group') continue;
    const node = byId.get(it.id);
    if (!node) continue;
    if (isBoneGroup(node)) { skippedBones++; continue; }
    eligibleIds.push(it.id);
  }
  if (eligibleIds.length === 0) {
    return { mirrored: 0, skippedBones, axis };
  }
  const worldMatrices = computeWorldMatrices(project.nodes);
  const median = medianOfOrigins(eligibleIds, worldMatrices);
  if (!median) return { mirrored: 0, skippedBones, axis };

  beginBatch();
  let mirrored = 0;
  try {
    for (const id of eligibleIds) {
      const node = project.nodes.find((n) => n?.id === id);
      if (!node?.transform) continue;
      const origin = nodeWorldOrigin(id, worldMatrices);
      if (!origin) continue;
      // Mirror world origin across the axis line.
      const newWorldX = axis === 'x' ? (2 * median.x - origin.x) : origin.x;
      const newWorldY = axis === 'y' ? (2 * median.y - origin.y) : origin.y;
      const local = worldToParentLocal(node, worldMatrices, project, newWorldX, newWorldY);
      useProjectStore.getState().updateProject((proj, vc) => {
        const target = proj.nodes.find((n) => n?.id === id);
        if (!target?.transform) return;
        target.transform.x = local.x;
        target.transform.y = local.y;
        // Flip rotation sign + the matching scale axis.
        const oldRot = typeof target.transform.rotation === 'number' ? target.transform.rotation : 0;
        target.transform.rotation = -oldRot;
        if (axis === 'x') {
          const sx = typeof target.transform.scaleX === 'number' ? target.transform.scaleX : 1;
          target.transform.scaleX = -sx;
        } else {
          const sy = typeof target.transform.scaleY === 'number' ? target.transform.scaleY : 1;
          target.transform.scaleY = -sy;
        }
        // For non-bone groups + parts, pose data may not exist. If it
        // does (legacy bone groups still carry it), flip the matching
        // pose axis so the bone follows the mirror.
        if (target.pose) {
          if (axis === 'x' && typeof target.pose.x === 'number') target.pose.x = -target.pose.x;
          if (axis === 'y' && typeof target.pose.y === 'number') target.pose.y = -target.pose.y;
          if (typeof target.pose.rotation === 'number') target.pose.rotation = -target.pose.rotation;
        }
        if (vc) vc.transformVersion++;
      });
      mirrored++;
    }
  } finally {
    endBatch();
  }
  return { mirrored, skippedBones, axis };
}
