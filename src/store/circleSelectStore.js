// @ts-check

/**
 * Toolset Plan Phase 6.D — Circle Select modal state.
 *
 * Activated by `selection.circleSelect` (`C` chord). The
 * `CircleSelectOverlay` mounted at AppShell level reads this store to
 * render the cursor circle + run paint-time selection on each
 * mousemove while LMB is held.
 *
 * **Mode-aware capture.** Captured at `begin` time so a mode switch
 * mid-paint doesn't redirect the eventual writes:
 *   - `mode`            — 'object' | 'edit'
 *   - `editPartId`      — when mode === 'edit', the part whose vertex
 *                         set we're editing
 *
 * **Paint state.**
 *   - `cursorClient`    — viewport-px cursor position (drives circle draw)
 *   - `radiusPx`        — circle radius in viewport-px (mouse-wheel
 *                         adjusts; default 32)
 *   - `painting`        — true while LMB is held (or Shift+LMB for
 *                         subtract). Drives per-mousemove selection
 *                         updates.
 *   - `paintMode`       — 'add' | 'subtract' (Shift held at LMB-down →
 *                         subtract; plain LMB-down → add). Captured at
 *                         paint-start so a mid-stroke Shift-release
 *                         doesn't switch the mode.
 *
 * Modal contract:
 *   - `begin({mode, editPartId, cursorClient})` opens the modal
 *   - `setCursor(client)` updates cursorClient (drives draw)
 *   - `setRadius(px)` updates radiusPx (wheel handler)
 *   - `startPaint(mode)` enters paint state with given mode
 *   - `endPaint()` exits paint state but stays modal (next LMB starts
 *     another stroke)
 *   - `commit()` exits the modal entirely
 *   - `cancel()` exits the modal — the overlay is responsible for
 *     restoring pre-modal selection if needed (Blender's Esc just
 *     ends the modal; selection changes from prior strokes persist)
 *
 * @module store/circleSelectStore
 */

import { create } from 'zustand';

const DEFAULT_RADIUS_PX = 32;
const MIN_RADIUS_PX = 4;
const MAX_RADIUS_PX = 512;

/**
 * @typedef {('object'|'edit')} CircleSelectMode
 * @typedef {('add'|'subtract')} PaintMode
 *
 * @typedef {Object} CircleSelectState
 * @property {boolean} active
 * @property {CircleSelectMode|null} mode
 * @property {string|null} editPartId
 * @property {{x:number, y:number}|null} cursorClient
 * @property {number} radiusPx
 * @property {boolean} painting
 * @property {PaintMode|null} paintMode
 * @property {(args: {mode: CircleSelectMode, editPartId: string|null, cursorClient: {x:number,y:number}}) => void} begin
 * @property {(client: {x:number, y:number}) => void} setCursor
 * @property {(px: number) => void} setRadius
 * @property {(mode: PaintMode) => void} startPaint
 * @property {() => void} endPaint
 * @property {() => void} commit
 * @property {() => void} cancel
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<CircleSelectState>>} */
export const useCircleSelectStore = create((set) => ({
  active: false,
  mode: null,
  editPartId: null,
  cursorClient: null,
  radiusPx: DEFAULT_RADIUS_PX,
  painting: false,
  paintMode: null,

  begin: ({ mode, editPartId, cursorClient }) => set({
    active: true,
    mode,
    editPartId,
    cursorClient,
    // Preserve the user's last radius across activations so wheel-tuning
    // is sticky (matches Blender's behavior).
    painting: false,
    paintMode: null,
  }),

  setCursor: (client) => set({ cursorClient: { x: client.x, y: client.y } }),

  setRadius: (px) => set({
    radiusPx: Math.max(MIN_RADIUS_PX, Math.min(MAX_RADIUS_PX, px)),
  }),

  startPaint: (mode) => set({ painting: true, paintMode: mode }),

  endPaint: () => set({ painting: false, paintMode: null }),

  commit: () => set({
    active: false, mode: null, editPartId: null,
    cursorClient: null, painting: false, paintMode: null,
  }),

  cancel: () => set({
    active: false, mode: null, editPartId: null,
    cursorClient: null, painting: false, paintMode: null,
  }),
}));
