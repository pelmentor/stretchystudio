// @ts-check

/**
 * v3 Phase 5 — Shared canvas capture store.
 *
 * The `CanvasViewport` instance lives inside `ViewportEditor` (deep in
 * the area tree). The Save modal lives at the AppShell level. They
 * share zero render context, so a ref-based handoff would mean
 * threading props through five components.
 *
 * Instead the viewport publishes its capture function here on mount
 * and the SaveModal pulls it via `useCaptureStore.getState()` when the
 * user hits Save. The viewport clears it on unmount so a stale closure
 * over a destroyed canvas never gets called.
 *
 * @module store/captureStore
 */

import { create } from 'zustand';

/**
 * @typedef {Object} CaptureStore
 * @property {(() => string|null)|null} captureThumbnail
 *   Returns a data URL (typically image/webp) sized for the gallery
 *   card. Null when no viewport is mounted yet.
 * @property {(fn: (() => string|null)|null) => void} setCaptureThumbnail
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<CaptureStore>>} */
export const useCaptureStore = create((set) => ({
  captureThumbnail: null,
  setCaptureThumbnail: (fn) => set({ captureThumbnail: fn }),
}));
