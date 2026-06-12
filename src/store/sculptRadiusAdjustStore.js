// @ts-check

/**
 * Sculpt brush-radius-adjust modal state (F gesture).
 *
 * Mirrors Blender's `WM_OT_radial_control` for sculpt brushes — same
 * gesture as the deform/weight-paint F modal, but writes to
 * `editorStore.sculpt.size` (independent from `brushSize` per
 * editorStore.js:214-216: "the user's Edit-Mode brush size is preserved
 * when they Tab into Sculpt and back").
 *
 * Sister to [[brushRadiusAdjustStore]] and [[radiusAdjustStore]]. Four
 * parallel modal stores exist now (proportionalEdit / weight-paint
 * radius / weight-paint strength / sculpt radius); folding to a single
 * `scalarModalStore` with target discriminators is now justified, but
 * deferred until the matching sculpt-strength store ships to avoid
 * partial-refactor churn.
 *
 * @module store/sculptRadiusAdjustStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} SculptRadiusAdjustState
 * @property {boolean} active
 * @property {number|null} startSize
 * @property {{x:number,y:number}|null} anchorClient
 * @property {(startSize:number) => void} begin
 * @property {(anchor:{x:number,y:number}) => void} setAnchor
 * @property {() => void} commit
 * @property {() => void} cancel
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<SculptRadiusAdjustState>>} */
export const useSculptRadiusAdjustStore = create((set) => ({
  active: false,
  startSize: null,
  anchorClient: null,

  begin: (startSize) => set({
    active: true,
    startSize,
    anchorClient: null,
  }),

  setAnchor: (anchorClient) => set({ anchorClient }),

  commit: () => set({
    active: false,
    startSize: null,
    anchorClient: null,
  }),

  cancel: () => set({
    active: false,
    startSize: null,
    anchorClient: null,
  }),
}));
