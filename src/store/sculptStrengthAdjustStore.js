// @ts-check

/**
 * Sculpt brush-strength-adjust modal state (Shift+F gesture).
 *
 * Mirrors Blender's `WM_OT_radial_control` for sculpt-strength —
 * writes to `editorStore.sculpt.strength` ∈ [0,1] (independent from
 * weight paint's `brushStrength`).
 *
 * Sister to [[sculptRadiusAdjustStore]], [[brushStrengthAdjustStore]],
 * [[brushRadiusAdjustStore]], and [[radiusAdjustStore]]. With five
 * parallel modal stores now shipped, a `scalarModalStore` with a
 * target-discriminator is overdue — flagged for the next refactor
 * slice. Keeping parallel files for now means this ships as a clean
 * one-commit pattern rather than a paired refactor + new-modal
 * commit pair.
 *
 * @module store/sculptStrengthAdjustStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} SculptStrengthAdjustState
 * @property {boolean} active
 * @property {number|null} startStrength
 * @property {{x:number,y:number}|null} anchorClient
 * @property {(startStrength:number) => void} begin
 * @property {(anchor:{x:number,y:number}) => void} setAnchor
 * @property {() => void} commit
 * @property {() => void} cancel
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<SculptStrengthAdjustState>>} */
export const useSculptStrengthAdjustStore = create((set) => ({
  active: false,
  startStrength: null,
  anchorClient: null,

  begin: (startStrength) => set({
    active: true,
    startStrength,
    anchorClient: null,
  }),

  setAnchor: (anchorClient) => set({ anchorClient }),

  commit: () => set({
    active: false,
    startStrength: null,
    anchorClient: null,
  }),

  cancel: () => set({
    active: false,
    startStrength: null,
    anchorClient: null,
  }),
}));
