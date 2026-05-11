// @ts-check

/**
 * Toolset Plan Phase 7.C.6 — Pose clipboard (in-memory only).
 *
 * Stores a snapshot of selected bones' pose data for paste / mirror-paste
 * operations. Mirrors Blender's pose copy/paste:
 *
 *   - `pose.copy`         → snapshot every selected bone's `node.pose`
 *                           keyed by `boneRole` (so paste can map onto
 *                           a different but role-matching skeleton).
 *   - `pose.paste`        → for every selected bone in target armature,
 *                           look up clipboard entry by role + apply.
 *   - `pose.mirrorPose`   → same as paste but each entry's `pose.x`
 *                           and `pose.rotation` get sign-flipped before
 *                           apply, AND the role is mirrored via
 *                           `mirrorRole` (`leftElbow ↔ rightElbow`).
 *
 * # Why role-keyed (not id-keyed)
 *
 * Blender's `pose.paste` matches by bone NAME (`Bone.name`), which is
 * stable across rigs of the same template. SS auto-rig assigns canonical
 * `boneRole` strings (`leftElbow`, `rightArm`, …) — those play the same
 * role-stable identifier function. Pasting onto a manually-renamed bone
 * works as long as the role survives.
 *
 * # Why in-memory (not persisted)
 *
 * Blender's pose clipboard is a runtime singleton (`Scene.tool_settings.
 * use_keyframe_insert_auto`-adjacent storage in `editors/space_view3d/
 * view3d_buttons.cc:2018+`); it does NOT persist across sessions. SS
 * follows the same UX: copy / paste is a within-session affordance, and
 * the future Pose Library (per plan §7.C.6 close note) is the persistent
 * surface. Keeping the clipboard in-memory means no schema bump required
 * for Phase 7.C, no migration risk for Rule №2.
 *
 * # Shape
 *
 *   {
 *     entries: Array<{ role: string, pose: PoseDelta }>,
 *     timestamp: number,        // ms since epoch — for "X seconds ago" tooltips
 *   }
 *
 * `entries` is an Array (not Record<role, PoseDelta>) because future
 * Pose Library entries may surface a stable order; the array preserves
 * the LAST-selected-bone-is-active Blender convention.
 *
 * @module store/poseClipboardStore
 */

import { create } from 'zustand';

/**
 * @typedef {{rotation:number, x:number, y:number, scaleX:number, scaleY:number}} PoseDelta
 *
 * @typedef {Object} PoseClipboardEntry
 * @property {string} role
 * @property {PoseDelta} pose
 *
 * @typedef {Object} PoseClipboardState
 * @property {Array<PoseClipboardEntry>} entries
 * @property {number|null} timestamp
 * @property {(entries: Array<PoseClipboardEntry>) => void} setEntries
 * @property {() => void} clear
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<PoseClipboardState>>} */
export const usePoseClipboardStore = create((set) => ({
  entries: [],
  timestamp: null,

  setEntries: (entries) => set({
    entries: Array.isArray(entries) ? entries.slice() : [],
    timestamp: Date.now(),
  }),

  clear: () => set({ entries: [], timestamp: null }),
}));
