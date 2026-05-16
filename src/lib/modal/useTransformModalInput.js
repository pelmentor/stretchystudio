// @ts-check

/**
 * React hook wrapping `transformInputReducer` for modal handlers that
 * need synchronous state reads inside imperative closures (e.g. the
 * `applyModal` mousemove tick) AND React state for HUD subscribers
 * (axis indicator, typed buffer, numeric-mode badge).
 *
 * Why both: `useState` / `useReducer` updates are queued for the next
 * render — but a modal's keydown handler typically dispatches an action
 * AND fires `applyModal` in the same turn, and `applyModal` needs the
 * NEW state value, not the stale closure capture. The hook keeps a
 * `stateRef` updated synchronously on every dispatch (before React
 * batches the re-render) so imperative consumers read the post-action
 * value immediately.
 *
 * Both the dispatch path and the ref path run through the same pure
 * `transformInputReducer`, so they can never diverge — the ref is the
 * SAME value React will commit on the next render.
 *
 * # Usage
 *
 * ```js
 * const { state, stateRef, dispatch, reset } = useTransformModalInput();
 *
 * // Imperative onKey handler:
 * function onKey(e) {
 *   const action = keyEventToAction(e);
 *   if (!action) return;
 *   e.preventDefault();
 *   e.stopPropagation();
 *   if (action.type === 'commit') { commit(); return; }
 *   if (action.type === 'cancel') { revert(); return; }
 *   dispatch(action);                              // queues HUD re-render
 *   applyModal(lastX, lastY, shiftHeld, ctrlHeld); // reads stateRef.current
 * }
 *
 * // applyModal:
 * const { axis, typedBuffer, numericMode } = stateRef.current;
 * ```
 *
 * The `useTransformModalInput` hook is intentionally storage-only — it
 * doesn't install listeners, doesn't own the mousemove loop, doesn't
 * touch the project. Those concerns are the caller's because they vary
 * sharply between viewport-modal (vertex/grid snap, node transforms)
 * and fcurve-modal (frame snap, keyform mutation). The hook is just
 * the input-state machine.
 *
 * Viewport's `ModalTransformOverlay` doesn't use this hook because it
 * needs cross-component subscribability (Footer renders the same state),
 * which the zustand `modalTransformStore` provides. The store wraps the
 * SAME `transformInputReducer` for transition logic — see that file's
 * "Shared reducer wrapper" section.
 *
 * @module lib/modal/useTransformModalInput
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  INITIAL_STATE,
  parseTyped,
  transformInputReducer,
} from './transformInputReducer.js';

/**
 * @typedef {import('./transformInputReducer.js').TransformInputState} TransformInputState
 * @typedef {import('./transformInputReducer.js').TransformInputAction} TransformInputAction
 */

/**
 * @returns {{
 *   state: TransformInputState,
 *   stateRef: {current: TransformInputState},
 *   dispatch: (action: TransformInputAction) => void,
 *   reset: () => void,
 *   parseTyped: typeof parseTyped,
 * }}
 */
export function useTransformModalInput() {
  const [state, setState] = useState(INITIAL_STATE);
  const stateRef = useRef(state);

  const dispatch = useCallback((action) => {
    const next = transformInputReducer(stateRef.current, action);
    if (next === stateRef.current) return;
    stateRef.current = next;
    setState(next);
  }, []);

  const reset = useCallback(() => {
    if (stateRef.current === INITIAL_STATE) return;
    stateRef.current = INITIAL_STATE;
    setState(INITIAL_STATE);
  }, []);

  // Audit-fix MED-A1 (2026-05-16) — memoize the return object so a
  // future `useCallback` consumer can add `modalInput` to its deps
  // without re-firing on every render. The shape changes ONLY when the
  // underlying `state` transitions; `stateRef`, `dispatch`, `reset` are
  // stable across renders, and `parseTyped` is a module-level export.
  return useMemo(
    () => ({ state, stateRef, dispatch, reset, parseTyped }),
    [state, dispatch, reset],
  );
}
