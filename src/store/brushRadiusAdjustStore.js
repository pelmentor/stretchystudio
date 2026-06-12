// @ts-check

/**
 * Weight-Paint brush-radius-adjust modal state (F gesture).
 *
 * Mirrors Blender's `WM_OT_radial_control` (`wm_radial_control.cc`):
 * press F → modal starts; cursor distance from anchor drives the value;
 * scroll wheel nudges; click commits; Esc restores; F again toggles off.
 *
 * Sister store to [[radiusAdjustStore]] (Edit-Mode proportional-edit
 * radius). Parallel rather than generalised so each store stays a thin
 * state machine — the gestures differ in their bound field (brushSize
 * vs proportionalEdit.radius), unit (screen-px vs mesh-units divided
 * by zoom), and minimum clamp (2px vs 5 mesh-units), and folding them
 * would just add a target-discriminator switch in every method.
 *
 * SS scope (v1):
 *   - Bound to `editorStore.brushSize` (shared by deform brush + weight
 *     paint per editorStore.js:207 — "size knob is shared across
 *     deform/sculpt/weight"). Sculpt has its own `sculpt.size` and
 *     would need its own store when sculpt F-binding ships.
 *   - Anchor captured on the FIRST pointermove after F-press, same as
 *     proportional-edit radius — covers users entering weight paint via
 *     the ModePill / workspace switcher without first hovering the canvas.
 *
 * @module store/brushRadiusAdjustStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} BrushRadiusAdjustState
 * @property {boolean} active
 * @property {number|null} startBrushSize
 *   Captured at F-press so Esc can restore it.
 * @property {{x:number,y:number}|null} anchorClient
 *   Captured on first pointermove after F-press. `null` until the
 *   user moves the mouse for the first time.
 * @property {(startBrushSize:number) => void} begin
 * @property {(anchor:{x:number,y:number}) => void} setAnchor
 * @property {() => void} commit  - exits keeping the current brushSize
 * @property {() => void} cancel  - exits keeping current brushSize (caller
 *                                   should restore startBrushSize first
 *                                   if desired)
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<BrushRadiusAdjustState>>} */
export const useBrushRadiusAdjustStore = create((set) => ({
  active: false,
  startBrushSize: null,
  anchorClient: null,

  begin: (startBrushSize) => set({
    active: true,
    startBrushSize,
    anchorClient: null,
  }),

  setAnchor: (anchorClient) => set({ anchorClient }),

  commit: () => set({
    active: false,
    startBrushSize: null,
    anchorClient: null,
  }),

  cancel: () => set({
    active: false,
    startBrushSize: null,
    anchorClient: null,
  }),
}));
