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
 * V3 Re-Rig Phase 1 — capture the live pose so per-stage refit can
 * reset-to-rest, harvest, then restore.
 *
 * Captured state:
 *   1. `paramValuesStore.values` — slider positions (shallow clone).
 *   2. `animationStore.draftPose` — uncommitted bone-controller drags
 *      (Map clone). Empty Map if none.
 *   3. Per-bone-group `node.transform` for groups with a `boneRole` —
 *      `{rotation, x, y, scaleX, scaleY}`. Pivots NOT captured (they're
 *      part of the rig anatomy, not pose).
 *
 * The returned snapshot is opaque to callers; pass it to `restorePose`.
 *
 * @returns {{
 *   paramValues: Record<string, number>,
 *   draftPose: Map<string, any>,
 *   boneTransforms: Record<string, {rotation:number,x:number,y:number,scaleX:number,scaleY:number}>,
 * }}
 */
export function capturePose() {
  const paramValues = { ...useParamValuesStore.getState().values };
  // draftPose is a Map keyed by boneId → {x?, y?, rotation?}. Clone so
  // post-capture mutations don't leak into the snapshot.
  const draftPoseSrc = useAnimationStore.getState().draftPose ?? new Map();
  const draftPose = new Map();
  for (const [k, v] of draftPoseSrc.entries()) {
    draftPose.set(k, (v && typeof v === 'object') ? { ...v } : v);
  }
  /** @type {Record<string, {rotation:number,x:number,y:number,scaleX:number,scaleY:number}>} */
  const boneTransforms = {};
  const proj = useProjectStore.getState().project;
  for (const n of proj?.nodes ?? []) {
    if (n?.type !== 'group' || !n.boneRole || !n.transform) continue;
    boneTransforms[n.id] = {
      rotation: n.transform.rotation ?? 0,
      x:        n.transform.x ?? 0,
      y:        n.transform.y ?? 0,
      scaleX:   n.transform.scaleX ?? 1,
      scaleY:   n.transform.scaleY ?? 1,
    };
  }
  return { paramValues, draftPose, boneTransforms };
}

/**
 * V3 Re-Rig Phase 1 — restore a snapshot taken via `capturePose`.
 * Inverse op; idempotent against the snapshot's contents.
 *
 * Pivots are intentionally NOT restored — if a per-stage refit moved
 * pivots (it shouldn't; pivots are inputs to seeders, not outputs),
 * the user's joint-drag edits would be lost. Today no seeder writes
 * pivots, so this is a no-op concern.
 *
 * @param {ReturnType<typeof capturePose>} snapshot
 */
export function restorePose(snapshot) {
  if (!snapshot) return;
  // 1. Restore paramValues.
  useParamValuesStore.setState({ values: { ...snapshot.paramValues } });
  // 2. Restore draftPose (it's a Map; clone so the store gets a fresh ref).
  const restored = new Map();
  for (const [k, v] of snapshot.draftPose.entries()) {
    restored.set(k, (v && typeof v === 'object') ? { ...v } : v);
  }
  useAnimationStore.setState({ draftPose: restored });
  // 3. Restore per-bone-group transforms.
  useProjectStore.getState().updateProject((p) => {
    for (const n of p.nodes ?? []) {
      if (n?.type !== 'group' || !n.boneRole) continue;
      const saved = snapshot.boneTransforms[n.id];
      if (!saved || !n.transform) continue;
      n.transform.rotation = saved.rotation;
      n.transform.x = saved.x;
      n.transform.y = saved.y;
      n.transform.scaleX = saved.scaleX;
      n.transform.scaleY = saved.scaleY;
      // pivotX / pivotY left as-is — those are rig anatomy, not pose.
    }
  });
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
