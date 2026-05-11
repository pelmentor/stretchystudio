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
import {
  isBoneGroup,
  getMesh,
  getBonePose,
  setBonePose,
} from '../store/objectDataAccess.js';

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
 *   3. Per-bone-group `node.pose` (schema v17+) — the user-authored
 *      pose offset (`{rotation, x, y, scaleX, scaleY}`). The bone's
 *      rest layout (`transform.pivotX/pivotY`) is intentionally NOT
 *      captured — pivots are rig anatomy, not pose.
 *
 * The returned snapshot is opaque to callers; pass it to `restorePose`.
 *
 * @returns {{
 *   paramValues: Record<string, number>,
 *   draftPose: Map<string, any>,
 *   bonePoses: Record<string, {rotation:number,x:number,y:number,scaleX:number,scaleY:number}>,
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
  const bonePoses = {};
  const proj = useProjectStore.getState().project;
  for (const n of proj?.nodes ?? []) {
    if (!isBoneGroup(n)) continue;
    const p = getBonePose(n);
    bonePoses[n.id] = {
      rotation: p?.rotation ?? 0,
      x:        p?.x ?? 0,
      y:        p?.y ?? 0,
      scaleX:   p?.scaleX ?? 1,
      scaleY:   p?.scaleY ?? 1,
    };
  }
  return { paramValues, draftPose, bonePoses };
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
  // 3. Restore per-bone-group pose offsets (schema v17+).
  // Audit-fix G-11 (Phase 8 sweep): kept the isBoneGroup early-out so
  // a non-bone collision in `snapshot.bonePoses` (key matching by id
  // happenstance) cannot route through `setBonePose` — even though
  // setBonePose silently no-ops on non-bones, the explicit guard
  // documents the bone-only contract at the call site.
  useProjectStore.getState().updateProject((p) => {
    for (const n of p.nodes ?? []) {
      if (!isBoneGroup(n)) continue;
      const saved = snapshot.bonePoses?.[n.id];
      if (!saved) continue;
      setBonePose(n, saved);
      // pivotX / pivotY (on transform) left as-is — rig anatomy, not pose.
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
      // Bone-group poses (schema v17+). Rest layout (pivot) is left
      // untouched — that's rig anatomy, not pose.
      if (isBoneGroup(n)) {
        setBonePose(n, { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 });
        continue;
      }
      // Mesh vertices that were displaced by JS-skinning during a bone
      // drag (SkeletonOverlay onPointerUp commits dependentParts'
      // deformed verts directly into mesh.vertices). Each vert carries
      // restX/restY captured at PSD import; snap x/y back to those so
      // Reset Pose actually undoes elbow / knee skinning. We don't touch
      // restX/restY — those define the rest pose itself, so a vert that's
      // BEEN edited in mesh-edit mode (where restX/restY updates alongside
      // x/y) is already at rest by definition.
      const mesh = getMesh(n, p);
      if (mesh && Array.isArray(mesh.vertices)) {
        for (const v of mesh.vertices) {
          if (!v) continue;
          if (typeof v.restX === 'number') v.x = v.restX;
          if (typeof v.restY === 'number') v.y = v.restY;
        }
      }
    }
  });
  logger.debug('poseReset', 'resetToRestPose: bone groups + paramValues + draftPose + skinned verts all reset', {});
}
