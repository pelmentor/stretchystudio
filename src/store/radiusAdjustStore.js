// @ts-check

/**
 * F-radius-adjust modal state (Edit Mode proportional-edit radius gesture).
 *
 * Mirrors Blender's `WM_OT_radial_control` (`wm_radial_control.cc`):
 * press F → modal starts; cursor distance from anchor drives the value;
 * scroll wheel nudges; click commits; Esc restores; F again toggles off.
 *
 * SS scope (v1):
 *   - Bound to `preferencesStore.proportionalEdit.radius` only.
 *     Brush-size / weight-paint strength variants will share the same
 *     modal pattern (a future radial-control generalisation slots in here).
 *   - Anchor is captured on the FIRST pointermove after F-press, not at
 *     F-press itself — covers the case where the user enters mesh-edit
 *     via the Outliner / ModePill without first hovering the canvas.
 *
 * Pre-Phase-2.C this state lived in `CanvasViewport.jsx`'s local
 * `radiusAdjustModeRef`, with F/Esc owned by a window keydown listener
 * (line 1907/1919 pre-strip) and the cursor / wheel / click handling
 * scattered across the canvas's pointer-flow useCallbacks. The framework
 * migration hoists state here so:
 *
 *   1. The modal-tool dispatcher (`src/v3/modalTool/`) owns the
 *      keyboard + wheel + mouse window-level events during the modal.
 *      Frees the canvas hot pointer path from per-tick radius-mode
 *      early-checks.
 *   2. The cursor-distance gesture, scroll, and commit/cancel
 *      semantics live in ONE place (the overlay), instead of being
 *      duplicated across wheel/pointerdown/pointermove handlers.
 *   3. The state's lifetime is enforced by the modal-tool stack
 *      (registered while `active`; unregistered automatically on
 *      cancel/commit) — no more `useEffect` shim that exits the
 *      mode on `editMode !== 'mesh'`.
 *
 * @module store/radiusAdjustStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} RadiusAdjustState
 * @property {boolean} active
 * @property {number|null} startRadius
 *   Captured at F-press so Esc can restore it.
 * @property {{x:number,y:number}|null} anchorClient
 *   Captured on first pointermove after F-press. `null` until the
 *   user moves the mouse for the first time.
 * @property {(startRadius:number) => void} begin
 * @property {(anchor:{x:number,y:number}) => void} setAnchor
 * @property {() => void} commit  - exits the mode keeping the current radius
 * @property {() => void} cancel  - exits keeping current radius (caller
 *                                   should restore startRadius first if desired)
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<RadiusAdjustState>>} */
export const useRadiusAdjustStore = create((set) => ({
  active: false,
  startRadius: null,
  anchorClient: null,

  begin: (startRadius) => set({
    active: true,
    startRadius,
    anchorClient: null,
  }),

  setAnchor: (anchorClient) => set({ anchorClient }),

  commit: () => set({
    active: false,
    startRadius: null,
    anchorClient: null,
  }),

  cancel: () => set({
    active: false,
    startRadius: null,
    anchorClient: null,
  }),
}));
