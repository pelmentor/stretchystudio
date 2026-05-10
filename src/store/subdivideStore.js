// @ts-check

/**
 * Toolset Plan Phase 4.C — Subdivide settings store.
 *
 * Holds the live `cuts` (1..6) + `smoothness` (0..1) values used by
 * the `edit.subdivide` operator. Lives in its own store rather than
 * `editorStore` because:
 *   - it persists across selection changes (sticky operator settings,
 *     Blender pattern);
 *   - it's owned by ToolSettingsPanel (Edit Mode N-panel), not by the
 *     editor view.
 *
 * The N-panel exposes both fields as sliders; the operator reads
 * the current values at exec time.
 *
 * @module store/subdivideStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} SubdivideState
 * @property {number} cuts          - 1..6 (Blender clamps the UI here)
 * @property {number} smoothness    - 0..1 (0 = strict midpoint, 1 = fully smoothed)
 * @property {(partial: {cuts?:number, smoothness?:number}) => void} setSubdivide
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<SubdivideState>>} */
export const useSubdivideStore = create((set) => ({
  cuts: 1,
  smoothness: 0,
  setSubdivide: (partial) => set((state) => {
    /** @type {Partial<SubdivideState>} */
    const next = {};
    if (typeof partial?.cuts === 'number' && Number.isFinite(partial.cuts)) {
      next.cuts = Math.max(1, Math.min(6, Math.floor(partial.cuts)));
    }
    if (typeof partial?.smoothness === 'number' && Number.isFinite(partial.smoothness)) {
      next.smoothness = Math.max(0, Math.min(1, partial.smoothness));
    }
    return next;
  }),
}));
