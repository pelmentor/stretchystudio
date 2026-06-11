// @ts-check

/**
 * Modal-tool framework — registration hook.
 *
 * A modal tool component (e.g. `CircleSelectOverlay`, `BoxSelectOverlay`)
 * calls `useModalTool(...)` to register its handler with the central
 * stack while it's "active" (the underlying state machine is engaged).
 * The hook handles registration / unregistration on lifecycle changes
 * AND keeps the handler closure fresh via a ref — handler functions
 * can be recreated each render without thrashing the store.
 *
 * # Why the ref dance
 *
 * If we stored the handler function directly in the store, every
 * render of the modal component would create a new closure and the
 * store entry would either go stale (if we stored on mount only) or
 * thrash (if we re-register every render). The ref pattern: the store
 * holds a `RefObject` whose `current` we update on every render. The
 * dispatcher reads `entry.handler.current` at event-fire time —
 * always the latest closure with fresh state.
 *
 * Mirrors Blender's `WM_event_add_modal_handler` /
 * `WM_event_remove_modal_handler` lifecycle at
 * `reference/blender/source/blender/windowmanager/wm_event_system.hh`.
 *
 * @module v3/modalTool/useModalTool
 */

import { useEffect, useRef } from 'react';
import { useModalToolStore } from './store.js';

/**
 * Register a modal-tool handler with the central stack. The handler
 * is in effect ONLY while `isActive` is true; flipping false unregisters.
 *
 * @param {Object} opts
 * @param {string} opts.id - Stable identifier (e.g. `'circleSelect'`).
 *   Tools sharing an id replace each other in the stack.
 * @param {boolean} opts.isActive - When true, register; when false,
 *   unregister. Driven by whatever state machine the tool owns.
 * @param {import('./store.js').ModalToolHandler} opts.handleEvent
 *   Called by the dispatcher on each event. See the typedef in
 *   `store.js` for the return-value contract.
 */
export function useModalTool({ id, isActive, handleEvent }) {
  /** @type {import('./store.js').ModalToolHandlerRef} */
  const ref = useRef(handleEvent);
  ref.current = handleEvent;

  useEffect(() => {
    if (!isActive) return;
    const { register, unregister } = useModalToolStore.getState();
    register(id, ref);
    return () => unregister(id);
  }, [id, isActive]);
}
