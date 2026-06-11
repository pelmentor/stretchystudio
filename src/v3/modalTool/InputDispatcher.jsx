// @ts-check
/* eslint-disable react/prop-types */

/**
 * Modal-tool framework — single window-level input dispatcher.
 *
 * One `window.addEventListener('keydown'|'mousedown'|..., {capture: true})`
 * subscription per event type. On each event, walks the active modal
 * stack latest-first and consults each handler. First handler to
 * return anything OTHER than `'PASS_THROUGH'` (or falsy) stops the
 * walk; the dispatcher then calls `e.stopPropagation()` so React +
 * the operator dispatcher don't see the event.
 *
 * # Why one dispatcher instead of per-overlay listeners
 *
 * Pre-framework: each modal overlay (`CircleSelectOverlay`,
 * `BoxSelectOverlay`, …) added its own `window.addEventListener`
 * with `{capture: true}`. They raced each other and the operator
 * dispatcher; the only way to "win" was a catch-all
 * `e.stopPropagation()` that ate every key the modal didn't explicitly
 * handle. That blocked X-delete during circle-select (user 2026-06-11)
 * and made modal stacking impossible.
 *
 * Post-framework: one capture-phase listener per event type. The
 * handler explicitly returns `PASS_THROUGH` for unowned events; the
 * dispatcher lets them flow to the next handler in the stack and
 * eventually to the operator dispatcher (bubble-phase on window).
 *
 * Mirrors Blender's event-dispatch loop at
 * `reference/blender/source/blender/windowmanager/intern/wm_event_system.cc:2617-2747`
 * — same walk-stack-latest-first, same PASS_THROUGH-falls-down-stack
 * semantic.
 *
 * # Capture vs bubble
 *
 * Listeners use `{capture: true}` so the framework sees events BEFORE
 * any React handler. The operator dispatcher
 * (`src/v3/operators/dispatcher.js`) uses bubble-phase
 * (`addEventListener('keydown', onKeyDown)` with no capture flag), so
 * passing-through here lets the chord reach the operator naturally.
 *
 * # passive: false for wheel
 *
 * Wheel events need `preventDefault()` to suppress page scroll inside
 * the modal — that requires non-passive registration.
 *
 * @module v3/modalTool/InputDispatcher
 */

import { useEffect } from 'react';
import { useModalToolStore } from './store.js';

/**
 * Event types the dispatcher routes. Matches the union of events
 * existing modals subscribed to per-overlay (see CircleSelectOverlay,
 * BoxSelectOverlay pre-migration).
 */
const DISPATCH_EVENT_TYPES = /** @type {const} */ ([
  'keydown',
  'keyup',
  'mousedown',
  'mouseup',
  'mousemove',
  'wheel',
  'contextmenu',
]);

export function ModalToolInputDispatcher() {
  useEffect(() => {
    /**
     * Single dispatch function — bound to every event type. The event
     * type itself flows through `event.type`, so we don't need a
     * separate function per type.
     *
     * @param {Event} event
     */
    function dispatch(event) {
      const stack = useModalToolStore.getState().stack;
      if (stack.length === 0) return;
      // Walk latest-first: Blender's `runtime.modalhandlers` is a
      // LinkedList walked head-to-tail with head = most-recently-added
      // (mirror this by reading our array end-to-start).
      for (let i = stack.length - 1; i >= 0; i--) {
        const handler = stack[i].handler.current;
        if (!handler) continue;
        const result = handler(event);
        // PASS_THROUGH (or falsy / undefined) → continue down the
        // stack. Anything else means this modal consumed the event;
        // stop propagation so the operator dispatcher doesn't also
        // fire on bubble.
        if (result === 'PASS_THROUGH' || !result) continue;
        event.stopPropagation();
        return;
      }
      // No handler claimed the event — fall through to native bubble.
    }

    for (const type of DISPATCH_EVENT_TYPES) {
      // `passive: false` for wheel + keyboard so handlers can
      // preventDefault(). Other event types don't strictly need it
      // but uniform registration keeps the cleanup symmetric.
      window.addEventListener(type, dispatch, { capture: true, passive: false });
    }
    return () => {
      for (const type of DISPATCH_EVENT_TYPES) {
        window.removeEventListener(type, dispatch, { capture: true });
      }
    };
  }, []);

  return null;
}
