// @ts-check

/**
 * v3 — PoseService — single source of truth for "reset pose" semantics.
 *
 * Why a service: three call sites need pose reset and they used to
 * inline the same logic with subtle drift:
 *
 *   1. Topbar Reset Pose button — animation mode clears draftPose +
 *      paramValues; staging mode also resets bone-group transforms.
 *   2. RigService.initializeRig — needs to reset BEFORE harvesting so
 *      the rig is built against rest pose (otherwise BUG-004/008/010:
 *      armature posed but mesh rendered at rest, bone-moved layer
 *      frozen, iris deformer broken).
 *   3. (future) wizard Re-init flow — same as #2.
 *
 * Three concerns, one piece of logic — different stages of "make the
 * character go back to rest".
 *
 * @module services/PoseService
 */

import { useProjectStore } from '../store/projectStore.js';
import { useAnimationStore } from '../store/animationStore.js';
import { useParamValuesStore } from '../store/paramValuesStore.js';
import { logger } from '../lib/logger.js';

/**
 * Animation-mode reset: clears the transient pose-edit overlay only.
 *
 *   - `animationStore.draftPose` cleared (uncommitted bone-controller
 *     drags discarded)
 *   - `paramValuesStore.values` reset to canonical defaults
 *
 * Does NOT touch `node.transform` — in animation mode, bone-controller
 * drags write to `draftPose`, not the persistent project state. Reset
 * Pose in this mode is "discard my preview pose"; the project is
 * untouched and committed timeline keyframes survive.
 */
export function resetPoseDraft() {
  useAnimationStore.getState().clearDraftPose();
  const proj = useProjectStore.getState().project;
  useParamValuesStore.getState().resetToDefaults(proj?.parameters ?? []);
}

/**
 * Full reset to rest pose: animation-mode reset PLUS persistent project
 * state for bone groups.
 *
 * In staging mode (Layout / Modeling / Rigging) bone-controller drags
 * write directly to `node.transform.rotation` — there's no transient
 * overlay. To "go back to rest" we have to walk every group with a
 * `boneRole` and zero its transform's rotation/translation/scale.
 * `pivotX/pivotY` are PRESERVED — those define WHERE the bone is, not
 * the user's pose. Per-part transforms (non-bone) are also untouched —
 * those are intentional layout (e.g. a hat positioned in the Outliner);
 * the user has Properties → Reset Transform for individual parts.
 *
 * Used by:
 *   - Topbar Reset Pose button when `editorMode !== 'animation'`
 *   - `RigService.initializeRig` BEFORE harvesting (forces a clean
 *     "rebuild from rest" — fixes BUG-004/008/010)
 *
 * Single immer transaction → single undo snapshot.
 */
export function resetToRestPose() {
  resetPoseDraft();
  useProjectStore.getState().updateProject((p) => {
    for (const n of p.nodes ?? []) {
      if (n?.type !== 'group' || !n.boneRole) continue;
      if (!n.transform) continue;
      n.transform.rotation = 0;
      n.transform.x = 0;
      n.transform.y = 0;
      n.transform.scaleX = 1;
      n.transform.scaleY = 1;
    }
  });
  logger.debug('poseReset', 'resetToRestPose: bone groups + paramValues + draftPose all reset', {});
}
