// @ts-check

/**
 * Weight-Paint brush-strength-adjust modal state (Shift+F gesture).
 *
 * Mirrors Blender's `WM_OT_radial_control` for fraction-typed brush
 * parameters (`wm_radial_control.cc` — Blender's `weight_paint_keymap`
 * binds Shift+F to the radial-control operator with
 * `data_path='tool_settings.unified_paint_settings.strength'`).
 *
 * Sister store to [[brushRadiusAdjustStore]]. Keeps the same shape so
 * the gesture overlays read interchangeably, but writes to
 * `editorStore.brushStrength` ∈ [0,1] instead of `brushSize` ∈ [2,1000].
 *
 * Three parallel modal stores exist now:
 *   - `radiusAdjustStore` — Edit Mode proportional-edit radius (mesh-units)
 *   - `brushRadiusAdjustStore` — Weight Paint brush size (screen-px)
 *   - `brushStrengthAdjustStore` — Weight Paint brush strength (0-1 fraction)
 *
 * Three is enough motivation to generalise; the trigger to refactor
 * comes when Sculpt mode F-binding ships (which would need its own
 * fourth store for `sculpt.size`). At that point a `scalarModalStore`
 * with a target-discriminator (which writer / which clamp / which
 * math) becomes the right abstraction. Until then, parallel stays
 * cheaper than a target switch in every method.
 *
 * @module store/brushStrengthAdjustStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} BrushStrengthAdjustState
 * @property {boolean} active
 * @property {number|null} startBrushStrength
 *   Captured at Shift+F-press so Esc can restore it.
 * @property {{x:number,y:number}|null} anchorClient
 *   Captured on first pointermove after Shift+F-press.
 * @property {(startBrushStrength:number) => void} begin
 * @property {(anchor:{x:number,y:number}) => void} setAnchor
 * @property {() => void} commit
 * @property {() => void} cancel
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<BrushStrengthAdjustState>>} */
export const useBrushStrengthAdjustStore = create((set) => ({
  active: false,
  startBrushStrength: null,
  anchorClient: null,

  begin: (startBrushStrength) => set({
    active: true,
    startBrushStrength,
    anchorClient: null,
  }),

  setAnchor: (anchorClient) => set({ anchorClient }),

  commit: () => set({
    active: false,
    startBrushStrength: null,
    anchorClient: null,
  }),

  cancel: () => set({
    active: false,
    startBrushStrength: null,
    anchorClient: null,
  }),
}));
