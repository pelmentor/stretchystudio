// @ts-check

/**
 * Toolset Plan Phase 7.C.1-4 — Clear Pose Loc / Rot / Scale operators.
 *
 * Implements Blender's pose-clear-transforms trio. All three delegate
 * through `pose_clear_transform_generic_exec`
 * (`reference/blender/source/blender/editors/armature/pose_transform.cc:1262`)
 * which iterates the selected pose-channel bones and calls a per-axis
 * helper:
 *
 *   - `pose.clearLocation` (`Alt+G`) — per `POSE_OT_loc_clear`
 *     (registration at `pose_transform.cc:1404`; helper
 *     `pchan_clear_loc` at `:1085-1127`). Zeros `pose.x` + `pose.y`.
 *   - `pose.clearRotation` (`Alt+R`) — per `POSE_OT_rot_clear`
 *     (registration at `pose_transform.cc:1377`; helper
 *     `pchan_clear_rot` at `:1129-1242`). Zeros `pose.rotation`.
 *     Blender's version operates on quaternion/Euler/axis-angle
 *     channels per `BoneChannel.rotmode` — SS bones are 2D,
 *     single-axis rotation only.
 *   - `pose.clearScale` (`Alt+S`) — per `POSE_OT_scale_clear`
 *     (registration at `pose_transform.cc:1350`; helper
 *     `pchan_clear_scale` at `:1244-1250`). Sets `pose.scaleX` +
 *     `pose.scaleY` to 1.0.
 *
 * Plus three per-axis "clear all" variants (`Shift+Alt+G/R/S`) that
 * apply the same clear to EVERY bone in the rig, not just selection.
 * Audit-fixed binding split (G-1/D-1) — the plan v1 had a single
 * combined `Alt+Shift+R` chord; per Blender, each axis has its own
 * chord and applies to all bones of the active armature.
 *
 * # Selection semantics
 *
 * Blender's pose-clear ops operate on `bArmature.act_bone` + selected
 * pose-channel bones. SS reads `useSelectionStore.items` filtered to
 * `isBoneGroup(...)`. The active bone is the LAST entry (Blender
 * convention).
 *
 * "Clear All" variants ignore selection — they walk every
 * `isBoneGroup(n)` node in the project. Audit-fix D-2: this is an
 * SS-specific extension with no direct Blender counterpart. The
 * closest Blender analogues are:
 *   - `POSE_OT_transforms_clear` (`pose_transform.cc:1431`) — clears
 *     loc + rot + scale of SELECTED bones via `pchan_clear_transforms`
 *     at `:1252-1257`. Selection-scoped, not all-bones.
 *   - `POSE_OT_user_transforms_clear` (`pose_transform.cc:1517`,
 *     exec `pose_clear_user_transforms_exec` at `:1453-1515`) —
 *     restores bones to their KEYFRAMED state (or rest pose if no
 *     action). Semantically opposite to identity-zero.
 *
 * # Pose-shape routing
 *
 * `applyClear` routes through `setBonePose` / `setBonePoseField` in
 * `objectDataAccess.js`, which detect v17/v18 flat shape vs v19+
 * channels shape (`node.pose.channels[node.id]`) and write into the
 * correct slot. This closes the writer/reader shape gap from Phase 7.C
 * audit-fix G-2 (formerly documented as deviation pending follow-up
 * plan; closed by Pose Write Canonicalisation Plan).
 *
 * # Undo
 *
 * All operators wrap their `updateProject` writes in a single
 * `beginBatch`/`endBatch` so the user gets ONE undo entry no matter
 * how many bones were cleared.
 *
 * @module v3/operators/pose/clearTransform
 */

import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { isBoneGroup, getBonePose, setBonePose, setBonePoseField } from '../../../store/objectDataAccess.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';

/**
 * The five fields that make up a bone's pose-delta. Used for identity
 * comparisons + the default initializer for bones with no `pose` slot.
 *
 * @type {{rotation:number, x:number, y:number, scaleX:number, scaleY:number}}
 */
export const IDENTITY_POSE = Object.freeze({
  rotation: 0,
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});

/**
 * Eligible bones for "clear selected" operators. Returns the bone-group
 * node IDs from the current selection.
 *
 * Mirror of `eligibleSelection` in snap.js but inverted — snap.js
 * EXCLUDES bones (snap operates on Object transforms, bones live in
 * armature data); this includes ONLY bones (pose-clear is bone-only).
 *
 * @returns {{boneIds: string[], activeId: string|null}}
 */
export function eligibleBones() {
  const items = useSelectionStore.getState().items ?? [];
  const project = useProjectStore.getState().project;
  if (!project?.nodes) return { boneIds: [], activeId: null };
  const byId = new Map();
  for (const n of project.nodes) {
    if (n && typeof n.id === 'string') byId.set(n.id, n);
  }
  const out = [];
  for (const it of items) {
    if (it?.type !== 'group') continue;
    const node = byId.get(it.id);
    if (!node) continue;
    if (!isBoneGroup(node)) continue;
    out.push(it.id);
  }
  return {
    boneIds: out,
    activeId: out.length === 0 ? null : out[out.length - 1],
  };
}

/**
 * Every bone in the project, ordered by `project.nodes` walk. Used by
 * "Clear All" variants.
 *
 * @returns {string[]}
 */
export function allBoneIds() {
  const project = useProjectStore.getState().project;
  if (!project?.nodes) return [];
  const out = [];
  for (const n of project.nodes) {
    if (isBoneGroup(n)) out.push(n.id);
  }
  return out;
}

/**
 * Write a single pose-field clear. Caller must be inside a `beginBatch`
 * so a multi-bone loop collapses to one undo entry.
 *
 * Idempotency: if the bone already has identity values for the cleared
 * channel, this is still a no-op write (immer detects the equality and
 * doesn't bump version counters). Multiple writers to the same bone in
 * one batch are safe.
 *
 * @param {string} boneId
 * @param {'location'|'rotation'|'scale'|'all'} channel
 */
function applyClear(boneId, channel) {
  useProjectStore.getState().updateProject((proj) => {
    const node = proj.nodes.find((n) => n?.id === boneId);
    if (!node) return;
    switch (channel) {
      case 'location':
        setBonePose(node, { x: 0, y: 0 });
        break;
      case 'rotation':
        setBonePoseField(node, 'rotation', 0);
        break;
      case 'scale':
        setBonePose(node, { scaleX: 1, scaleY: 1 });
        break;
      case 'all':
        setBonePose(node, IDENTITY_POSE);
        break;
    }
  });
}

/**
 * Phase 7.C.1 — Clear Pose Location. Zero `pose.x` + `pose.y` on every
 * selected bone. Single undo entry.
 *
 * @returns {{cleared: number, skipped: boolean}}
 */
export function clearPoseLocation() {
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) return { cleared: 0, skipped: true };
  const project = useProjectStore.getState().project;
  beginBatch(project);
  try {
    for (const id of boneIds) applyClear(id, 'location');
  } finally {
    endBatch();
  }
  return { cleared: boneIds.length, skipped: false };
}

/**
 * Phase 7.C.2 — Clear Pose Rotation. Zero `pose.rotation` on every
 * selected bone. Single undo entry.
 *
 * @returns {{cleared: number, skipped: boolean}}
 */
export function clearPoseRotation() {
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) return { cleared: 0, skipped: true };
  const project = useProjectStore.getState().project;
  beginBatch(project);
  try {
    for (const id of boneIds) applyClear(id, 'rotation');
  } finally {
    endBatch();
  }
  return { cleared: boneIds.length, skipped: false };
}

/**
 * Phase 7.C.3 — Clear Pose Scale. Reset `pose.scaleX` + `pose.scaleY` to
 * 1 on every selected bone. Single undo entry.
 *
 * @returns {{cleared: number, skipped: boolean}}
 */
export function clearPoseScale() {
  const { boneIds } = eligibleBones();
  if (boneIds.length === 0) return { cleared: 0, skipped: true };
  const project = useProjectStore.getState().project;
  beginBatch(project);
  try {
    for (const id of boneIds) applyClear(id, 'scale');
  } finally {
    endBatch();
  }
  return { cleared: boneIds.length, skipped: false };
}

/**
 * Phase 7.C.4 — Clear All Pose (per axis). Walks every bone in the
 * project, regardless of selection.
 *
 * @param {'location'|'rotation'|'scale'} channel
 * @returns {{cleared: number, skipped: boolean}}
 */
export function clearAllPose(channel) {
  const boneIds = allBoneIds();
  if (boneIds.length === 0) return { cleared: 0, skipped: true };
  const project = useProjectStore.getState().project;
  beginBatch(project);
  try {
    for (const id of boneIds) applyClear(id, channel);
  } finally {
    endBatch();
  }
  return { cleared: boneIds.length, skipped: false };
}

/**
 * Eligibility shared by all three "Clear Selected" operators. Available
 * when at least one bone-group is in the active selection.
 *
 * The mode gate (must be in Pose Mode) is enforced at the registry-level
 * `available` callback — see `pose.clear*` registrations in
 * `src/v3/operators/registry.js`. Splitting the mode check out of this
 * helper keeps the pure-function unit-testable from node.
 *
 * @returns {boolean}
 */
export function hasSelectedBones() {
  return eligibleBones().boneIds.length > 0;
}

/**
 * Eligibility for the "Clear All" variants. Available when the project
 * has any bones at all (the operator can no-op if rest pose is already
 * identity, but the affordance is still legal to invoke).
 *
 * @returns {boolean}
 */
export function hasAnyBones() {
  return allBoneIds().length > 0;
}

/**
 * Diagnostic / test helper — read the current pose channels of every
 * selected bone, keyed by id. Used by tests to assert post-clear state.
 *
 * @returns {Record<string, {rotation:number,x:number,y:number,scaleX:number,scaleY:number}>}
 */
export function snapshotSelectedPoses() {
  const { boneIds } = eligibleBones();
  const project = useProjectStore.getState().project;
  /** @type {Record<string, {rotation:number,x:number,y:number,scaleX:number,scaleY:number}>} */
  const out = {};
  for (const id of boneIds) {
    const node = project?.nodes?.find((n) => n?.id === id);
    if (!node) continue;
    out[id] = getBonePose(node) ?? { ...IDENTITY_POSE };
  }
  return out;
}
