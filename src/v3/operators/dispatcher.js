// @ts-check

/**
 * v3 Phase 0A - Keymap → operator dispatcher.
 *
 * Mounts a single `keydown` listener on `window`, resolves the
 * `KeyboardEvent` to a chord (see `chordOf`), looks the chord up in
 * the active keymap, and invokes the corresponding operator.
 *
 * Designed to coexist with v2 - it ignores any event whose target is
 * inside an editable element (`input` / `textarea` / `[contenteditable]`)
 * because those should keep their native typing behaviour.
 *
 * Returns a cleanup function so the AppShell's `useEffect` can detach
 * on unmount.
 *
 * @module v3/operators/dispatcher
 */

import { DEFAULT_KEYMAP, chordOf } from '../keymap/default.js';
import { getOperator } from './registry.js';

/**
 * Returns true when the event came from a typing context where
 * shortcuts should pass through.
 * @param {EventTarget|null} t
 */
function isEditableTarget(t) {
  if (!t || typeof Element === 'undefined' || !(t instanceof Element)) return false;
  const tag = t.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (t instanceof HTMLElement && t.isContentEditable) return true;
  return false;
}

/**
 * Resolve a chord to an operator id using the active keymap. For now
 * the keymap is the static default; user overrides (Phase 0+) layer
 * on top of it.
 * @param {string} chord
 */
function resolve(chord) {
  return DEFAULT_KEYMAP[chord] ?? null;
}

/**
 * Mount the global dispatcher. Call from `AppShell` `useEffect`.
 * @returns {() => void} cleanup
 */
export function mountOperatorDispatcher() {
  function onKeyDown(e) {
    if (isEditableTarget(e.target)) return;
    const chord = chordOf(e);
    const opId = resolve(chord);
    if (!opId) return;
    const op = getOperator(opId);
    if (!op) return;
    if (op.available && !op.available({ editorType: null })) return;
    e.preventDefault();
    try {
      op.exec({ editorType: null });
    } catch (err) {
      // Don't let an operator error kill the whole app - log + swallow.
      // Real telemetry comes in Phase 0G.
      console.error(`[operator ${opId}] exec failed`, err);
    }
  }

  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
