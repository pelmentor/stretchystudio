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
 * Common slots:
 *   - `kind`            — 'box' | 'lasso' | null
 *   - `mode`            — 'object' | 'edit' (which selection slot we
 *                         write to on commit). Captured at begin so
 *                         a mode-switch mid-drag doesn't redirect.
 *   - `editPartId`      — when mode === 'edit', the part whose vertex
 *                         set we're editing. Captured at begin so a
 *                         selection change mid-drag doesn't redirect.
 *   - `gestureModifier` — modifier captured at gesture start. Used by
 *                         lasso (Ctrl is the gesture-starter so it
 *                         can't double as a commit-time modifier);
 *                         null for box (modifier read at release).
 *                         `'add' | 'subtract' | null`.
 *
 * Box-only slots:
 *   - `startClient`     — viewport-px start of the rect
 *   - `currentClient`   — viewport-px current cursor (drives draw)
 *
 * Lasso-only slots:
 *   - `pathClient`      — viewport-px polygon vertices appended on
 *                         each `pointermove`. First point seeded by
 *                         `begin`. Closed automatically on commit.
 *
 * Modal contract:
 *   - `begin({kind, mode, editPartId, startClient, gestureModifier?})`
 *     opens the modal
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
