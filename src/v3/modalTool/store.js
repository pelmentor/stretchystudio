// @ts-check

/**
 * Modal-tool framework — active-handler stack.
 *
 * Mirrors Blender's `wmWindow.runtime.modalhandlers` ListBase at
 * `reference/blender/source/blender/windowmanager/intern/wm_event_system.cc:2617-2747`.
 * Blender walks the list latest-first — newest modal handler gets the
 * event first. If it returns `OPERATOR_PASS_THROUGH`, the event falls
 * to the next handler. If it returns `OPERATOR_RUNNING_MODAL` (or
 * `OPERATOR_FINISHED` / `OPERATOR_CANCELLED`), the event is consumed
 * and propagation stops — except for "always pass" events
 * (`wm_event_always_pass` at :855-859, timers + window deactivate).
 *
 * SS's analog:
 *   - One global stack of `{id, handlerRef}` entries.
 *   - The InputDispatcher (single `window` listener) walks latest-first
 *     and consults each handler.
 *   - Handler returns `'PASS_THROUGH' | 'RUNNING_MODAL' | 'FINISHED' | 'CANCELLED'`
 *     mirroring Blender's `eOperatorStatus`. `PASS_THROUGH` (or any
 *     falsy / unknown return) continues to the next handler;
 *     anything else stops dispatcher propagation
 *     (`e.stopPropagation()`).
 *
 * Each entry carries a `RefObject` to the handler (not the function
 * directly) so React renders can re-create the handler closure without
 * thrashing the store. The dispatcher reads `entry.handler.current`
 * at event time — always the latest closure.
 *
 * @module v3/modalTool/store
 */

import { create } from 'zustand';

/**
 * @typedef {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'} ModalToolResult
 *
 * Handler signature: receives the live DOM event, returns a status.
 * `PASS_THROUGH` (or any falsy return) continues; other values stop
 * propagation. Mirrors Blender's modal-handler invoke return semantics.
 *
 * @typedef {(event: Event) => (ModalToolResult|undefined|null|false)} ModalToolHandler
 *
 * @typedef {Object} ModalToolHandlerRef
 * @property {ModalToolHandler|null} current
 *
 * @typedef {Object} ModalToolStackEntry
 * @property {string} id
 * @property {ModalToolHandlerRef} handler
 *
 * @typedef {Object} ModalToolStoreState
 * @property {ReadonlyArray<ModalToolStackEntry>} stack
 * @property {(id: string, handler: ModalToolHandlerRef) => void} register
 * @property {(id: string) => void} unregister
 */

/** @type {import('zustand').UseBoundStore<import('zustand').StoreApi<ModalToolStoreState>>} */
export const useModalToolStore = create((set) => ({
  /** Latest-registered modal is at the end of the array. */
  stack: [],

  register: (id, handler) => set((s) => {
    // Filter out any prior entry with same id — a re-mount of the same
    // tool replaces, doesn't stack. Mirrors Blender's `WM_event_add_modal_handler`
    // which deduplicates by op pointer.
    const next = s.stack.filter((e) => e.id !== id);
    next.push({ id, handler });
    return { stack: next };
  }),

  unregister: (id) => set((s) => ({
    stack: s.stack.filter((e) => e.id !== id),
  })),
}));
