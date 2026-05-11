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
 * Blender's pose clipboard is a partial `.blend` file written to a
 * temp path: `pose_copy_exec`
 * (`reference/blender/source/blender/editors/armature/pose_transform.cc:785`)
 * obtains the path via `pose_copybuffer_filepath_get` and writes the
 * selected bones' pose data; `pose_paste_exec` (`:861`) reads it back
 * via `BKE_copybuffer_read`. The clipboard is a file on disk, not an
 * in-memory store, but it does NOT persist across sessions in any
 * user-discoverable way (the file lives in OS temp and is recreated
 * per copy).
 *
 * SS uses an in-memory Zustand store instead — no need for file I/O in
 * the browser context, and the within-session UX is identical. Keeping
 * the clipboard in-memory means no schema bump required for Phase 7.C,
 * no migration risk for Rule №2. The future Pose Library (per plan
 * §7.C.6 close note) is the persistent surface.
 *
 * Audit-fix D-7: cite corrected from the unrelated quaternion-lock UI
 * panel to the actual disk-clipboard mechanism above.
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
