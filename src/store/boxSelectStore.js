// @ts-check

/**
 * Toolset Phase 1.A — Modal box / lasso select state.
 *
 * Activated by `selection.boxSelect` (B chord) or by the Ctrl+LMB-drag
 * gesture in CanvasViewport (lasso). The `BoxSelectOverlay` mounted
 * at AppShell level reads this store to render the in-progress shape
 * and run the actual selection on commit.
 *
 * Two kinds — `'box'` for axis-aligned rectangle drag,
 * `'lasso'` for freehand polygon drag.
 *
 * # State machine (mirrors Blender's `Gesture Box` modal map)
 *
 * Box select has TWO phases (matches Blender's
 * `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:6259-6270`
 * — `BEGIN` action only fires on LMB-PRESS, not on the operator-invoke
 * itself):
 *
 *   1. **Armed** — operator (B-key) called `arm()`. `kind === 'box'`,
 *      `startClient === null`. Overlay is mounted listening for
 *      LMB-down but draws NOTHING. ESC / RMB cancels.
 *   2. **Dragging** — first LMB-down fired the overlay's `anchor()`.
 *      `startClient` set to the click point, `currentClient` follows
 *      the cursor. LMB-up commits.
 *
 * Lasso skips phase 1 because it's invoked by a Ctrl+LMB-drag — the
 * click HAS already happened by the time we get here, so the operator
 * uses `begin()` (anchored immediately).
 *
 * Common slots:
 *   - `kind`            — 'box' | 'lasso' | null
 *   - `mode`            — 'object' | 'edit' (which selection slot we
 *                         write to on commit). Captured at arm/begin so
 *                         a mode-switch mid-drag doesn't redirect.
 *   - `editPartId`      — when mode === 'edit', the part whose vertex
 *                         set we're editing. Captured at arm/begin so a
 *                         selection change mid-drag doesn't redirect.
 *   - `gestureModifier` — modifier captured at gesture start. Used by
 *                         lasso (Ctrl is the gesture-starter so it
 *                         can't double as a commit-time modifier);
 *                         null for box (modifier read at release).
 *                         `'add' | 'subtract' | null`.
 *
 * Box-only slots:
 *   - `startClient`     — viewport-px start of the rect. NULL while
 *                         armed-but-not-anchored. Set by `anchor()` on
 *                         first LMB-down.
 *   - `currentClient`   — viewport-px current cursor (drives draw).
 *                         NULL while armed-but-not-anchored.
 *
 * Lasso-only slots:
 *   - `pathClient`      — viewport-px polygon vertices appended on
 *                         each `pointermove`. First point seeded by
 *                         `begin`. Closed automatically on commit.
 *
 * Modal contract:
 *   - `arm({kind, mode, editPartId, gestureModifier?})` — B-key path.
 *     Opens modal in "waiting for LMB-down" state.
 *   - `anchor(client)` — Overlay calls this on first LMB-down to
 *     transition from armed to dragging.
 *   - `begin({kind, mode, editPartId, startClient, gestureModifier?})`
 *     — Ctrl+LMB-drag lasso path. Opens modal already-anchored
 *     (the user clicked, so anchor is known).
 *   - `update(client)` updates currentClient (box) or appends to path (lasso)
 *   - `commit()` clears the modal — the consumer (overlay) does the
 *     actual selection write before calling commit
 *   - `cancel()` clears the modal without selecting
 *
 * @module store/boxSelectStore
 */

import { create } from 'zustand';

/**
 * @typedef {('box'|'lasso')} SelectKind
 * @typedef {('object'|'edit')} SelectMode
 * @typedef {('add'|'subtract'|null)} GestureModifier
 *
 * @typedef {Object} BoxSelectState
 * @property {SelectKind|null} kind
 * @property {SelectMode|null} mode
 * @property {string|null} editPartId
 * @property {{x:number, y:number}|null} startClient
 * @property {{x:number, y:number}|null} currentClient
 * @property {Array<{x:number, y:number}>} pathClient
 * @property {GestureModifier} gestureModifier
 * @property {(args: {kind: SelectKind, mode: SelectMode, editPartId: string|null, gestureModifier?: GestureModifier}) => void} arm
 * @property {(client: {x:number, y:number}) => void} anchor
 * @property {(args: {kind: SelectKind, mode: SelectMode, editPartId: string|null, startClient: {x:number,y:number}, gestureModifier?: GestureModifier}) => void} begin
 * @property {(client: {x:number, y:number}) => void} update
 * @property {() => void} commit
 * @property {() => void} cancel
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<BoxSelectState>>} */
export const useBoxSelectStore = create((set) => ({
  kind: null,
  mode: null,
  editPartId: null,
  startClient: null,
  currentClient: null,
  pathClient: [],
  gestureModifier: null,

  // B-key path. Modal mounts in "armed" state — overlay listens for
  // LMB-down but draws nothing yet. Matches Blender's invoke-arms-but-
  // doesn't-anchor semantic at `wm_gesture_ops.cc` (the `BEGIN` action
  // in the modal map only fires on LEFTMOUSE PRESS, NOT on invoke).
  arm: ({ kind, mode, editPartId, gestureModifier = null }) => set({
    kind,
    mode,
    editPartId,
    startClient: null,
    currentClient: null,
    pathClient: [],
    gestureModifier,
  }),

  // Overlay-only — call from onMouseDown when armed. Transitions the
  // modal from "armed waiting for click" to "dragging anchored". For
  // box, anchor sets both startClient and currentClient to the click
  // point so the rect grows from (0×0) under the cursor. For lasso
  // anchored via this path (theoretical — current lasso uses begin()
  // because Ctrl+LMB-drag already has the click), the pathClient seed
  // is the same click.
  anchor: (client) => set((s) => ({
    startClient: { x: client.x, y: client.y },
    currentClient: { x: client.x, y: client.y },
    pathClient: s.kind === 'lasso' ? [{ x: client.x, y: client.y }] : [],
  })),

  // Lasso Ctrl+LMB-drag path. The click HAS happened already, so the
  // operator/caller knows the anchor and seeds it directly.
  begin: ({ kind, mode, editPartId, startClient, gestureModifier = null }) => set({
    kind,
    mode,
    editPartId,
    startClient,
    currentClient: { x: startClient.x, y: startClient.y },
    pathClient: kind === 'lasso' ? [{ x: startClient.x, y: startClient.y }] : [],
    gestureModifier,
  }),

  update: (client) => set((s) => {
    if (!s.kind) return s;
    // Defensive — `update()` while armed-but-not-anchored (`startClient`
    // null) must NOT spontaneously seed the anchor. Anchor is owned by
    // `anchor()`, called by the overlay on real LMB-down. A stray
    // mousemove ticking through with no click hasn't earned the anchor.
    if (!s.startClient) return s;
    if (s.kind === 'lasso') {
      // Append unless the new point is essentially the same as the
      // tail (cuts noise from 60Hz mousemove with a near-stationary
      // pointer; ~1px jitter doesn't grow the polygon).
      const last = s.pathClient[s.pathClient.length - 1];
      const dx = client.x - (last?.x ?? client.x);
      const dy = client.y - (last?.y ?? client.y);
      if (last && dx * dx + dy * dy < 1) {
        return { currentClient: { x: client.x, y: client.y } };
      }
      return {
        currentClient: { x: client.x, y: client.y },
        pathClient: [...s.pathClient, { x: client.x, y: client.y }],
      };
    }
    return { currentClient: { x: client.x, y: client.y } };
  }),

  commit: () => set({
    kind: null, mode: null, editPartId: null,
    startClient: null, currentClient: null, pathClient: [],
    gestureModifier: null,
  }),

  cancel: () => set({
    kind: null, mode: null, editPartId: null,
    startClient: null, currentClient: null, pathClient: [],
    gestureModifier: null,
  }),
}));
