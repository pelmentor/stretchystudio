// @ts-check

/**
 * Generic radial-control modal state — replaces the 5 parallel
 * single-purpose stores (radiusAdjustStore, brushRadiusAdjustStore,
 * brushStrengthAdjustStore, sculptRadiusAdjustStore,
 * sculptStrengthAdjustStore).
 *
 * Mirrors Blender's `WM_OT_radial_control` (`wm_radial_control.cc`):
 * one operator handles every dial-style brush parameter — size,
 * strength, falloff, alpha — discriminated by the `data_path`
 * argument. SS mirrors that shape: one store + one overlay, with a
 * `target` string discriminating which scalar the modal is bound to.
 *
 * The target registry lives in ScalarModalOverlay (the
 * descriptor needs JSX/store imports — keeping it adjacent to the
 * dispatcher means the store stays a pure state machine).
 *
 * # Why this exists
 *
 * Five parallel stores shipped 2026-06-12 (419e872, 07e8fbd, e57b81e,
 * ee7b43b) — each was ~70 LOC of identical state-machine shape with
 * different field names (startRadius / startBrushSize /
 * startBrushStrength / startSize / startStrength). The first three
 * commits' messages flagged the 4→5 transition as the firm
 * abstraction trigger; this refactor delivers on that per RULE №2
 * (no migration baggage / deferred-forever plans).
 *
 * @module store/scalarModalStore
 */

import { create } from 'zustand';

/**
 * @typedef {string} ScalarModalTarget
 *   Discriminator for which scalar the modal is currently driving.
 *   Resolved via the registry in ScalarModalOverlay. Known values
 *   (2026-06-12):
 *     - 'proportionalEditRadius'
 *     - 'brushSize'
 *     - 'brushStrength'
 *     - 'sculptSize'
 *     - 'sculptStrength'
 */

/**
 * @typedef {Object} ScalarModalState
 * @property {boolean} active
 * @property {ScalarModalTarget|null} target
 *   Which descriptor in the registry this modal is currently bound
 *   to. `null` when inactive.
 * @property {number|null} startValue
 *   Pre-gesture value snapshot. Cancel path restores this.
 * @property {{x:number,y:number}|null} anchorClient
 *   Captured on first pointermove after begin(). `null` until the
 *   user moves the mouse for the first time — supports users who
 *   entered a brush mode via the workspace switcher without first
 *   hovering the canvas.
 * @property {(target: ScalarModalTarget, startValue: number) => void} begin
 * @property {(anchor: {x:number,y:number}) => void} setAnchor
 * @property {() => void} commit  - exits keeping current value
 * @property {() => void} cancel  - exits keeping current value (caller
 *                                   must restore startValue first if
 *                                   the cancel semantic requires it)
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<ScalarModalState>>} */
export const useScalarModalStore = create((set) => ({
  active: false,
  target: null,
  startValue: null,
  anchorClient: null,

  begin: (target, startValue) => set({
    active: true,
    target,
    startValue,
    anchorClient: null,
  }),

  setAnchor: (anchorClient) => set({ anchorClient }),

  commit: () => set({
    active: false,
    target: null,
    startValue: null,
    anchorClient: null,
  }),

  cancel: () => set({
    active: false,
    target: null,
    startValue: null,
    anchorClient: null,
  }),
}));
