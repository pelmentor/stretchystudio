// @ts-check

/**
 * Shared modal-transform input reducer (Animation Phase 5 Slice 5.E,
 * 2026-05-16) — pure state-machine for the axis-lock + typed-numeric +
 * numeric-mode triplet used by Blender-style modal G/R/S handlers.
 *
 * # Why a shared reducer
 *
 * Two callers run the same input state machine:
 *
 *   1. **Viewport modal** — [src/v3/shell/ModalTransformOverlay.jsx]
 *      drives transforms over `project.nodes[i].transform/pose`. Stores
 *      its state in `modalTransformStore` because the HUD AND the Footer
 *      both subscribe to those fields cross-component.
 *   2. **F-Curve editor modal** — [src/v3/editors/fcurve/FCurveEditor.jsx]
 *      drives transforms over `fcurve.keyforms[i].time/value`. Stores
 *      its state in a per-Plot hook (no Footer wiring; the HUD is
 *      plot-relative).
 *
 * The storage shape differs (zustand vs `useReducer`) because the
 * cross-component subscription requirements differ — but the
 * state-transition LOGIC (digit validation, single leading sign, single
 * decimal point, popping at empty exits numericMode, etc.) is identical.
 * That shared logic lives here. Both callers pipe their stores through
 * the same reducer so there's exactly ONE place where the validation
 * rules are written.
 *
 * # Blender provenance
 *
 *   - **`=` enters numeric mode** — Blender's `NUM_EDIT_FULL` flag in
 *     `reference/blender/source/blender/editors/util/numinput.cc:369-378`:
 *     pressing `=` with the flag OFF turns it ON; pressing `=` again
 *     while ON is a noop; only `Ctrl+=` clears the flag.
 *   - **X/Y axis lock works in 2D editors** — confirmed at
 *     `reference/blender/source/blender/editors/transform/transform.cc:655-670`.
 *     The `T_2D_EDIT` blocklist catches `TFM_MODAL_AXIS_Z` /
 *     `TFM_MODAL_PLANE_*` (irrelevant in 2D) but `TFM_MODAL_AXIS_X` and
 *     `TFM_MODAL_AXIS_Y` fall through to the `T_NO_CONSTRAINT` check.
 *     Graph Editor (T_2D_EDIT) supports bare X/Y axis-lock by inheritance.
 *   - **Shift+X / Shift+Y noop in 2D** — `transform.cc:660-662` returns
 *     false for `TFM_MODAL_PLANE_X` / `TFM_MODAL_PLANE_Y` in
 *     `T_2D_EDIT`. SS recognizes Shift+X/Y as `noop` so the chord is
 *     consumed (preventing fall-through to bare-axis toggle) but doesn't
 *     transition state.
 *   - **Pop at empty exits numericMode** — SS deviation, not in
 *     Blender. Without it, a user who pressed `=` accidentally is stuck
 *     holding zero until Esc-cancel. SS allows one extra Backspace as
 *     an escape hatch.
 *
 * # SS-deferred (audit-fix MED-B1, 2026-05-16)
 *
 * Blender's `numinput.cc:353-365` AUTO-enables `NUM_EDIT_FULL` when the
 * first digit / operator character arrives -- BUT ONLY when the user
 * preference `USER_FLAG_NUMINPUT_ADVANCED` (`DNA_userdef_types.h:34`)
 * is set:
 *
 * ```c
 *   if (U.flag & USER_FLAG_NUMINPUT_ADVANCED)
 *   {
 *     if (... && strchr("01234567890@%^&*-+/{}()[]<>.|", event_ascii)) {
 *       if (!(n->flag & NUM_EDIT_FULL)) {
 *         n->flag |= NUM_EDITED;
 *         n->flag |= NUM_EDIT_FULL;
 *         ...
 *       }
 *     }
 *   }
 * ```
 *
 * SS doesn't model `USER_FLAG_NUMINPUT_ADVANCED` as a preference, so
 * `appendTyped` only accumulates into `typedBuffer` -- the user must
 * press `=` explicitly to enter `numericMode`. With the pref OFF (the
 * Blender default before the user opts in), Blender behaves the same
 * way: digits accumulate without flipping NUM_EDIT_FULL. SS is therefore
 * byte-faithful to the DEFAULT path; the advanced-pref auto-enable is
 * a documented omission rather than a silent bug. A follow-on slice
 * could add a `preferences.numericInputAdvanced` toggle and dispatch
 * an extra `'enterNumericMode'` from `appendTyped` when on.
 *
 * # API
 *
 *   - `INITIAL_STATE` — frozen `{axis:null, typedBuffer:'', numericMode:false}`.
 *   - `transformInputReducer(state, action)` — pure; returns same object
 *     identity when the action is a noop / yields no transition (so
 *     downstream selectors don't churn).
 *   - `parseTyped(buf)` — string → finite number, or NaN if empty / mid-typing.
 *   - `keyEventToAction(event, options)` — KeyboardEvent → reducer action |
 *     null. Caller is responsible for `preventDefault` + `stopPropagation`
 *     when the function returns non-null (the action is "consumed" by the
 *     modal regardless of whether it transitioned state — including the
 *     `'noop'` type returned for Shift+X/Y).
 *
 * @module lib/modal/transformInputReducer
 */

/**
 * @typedef {('x'|'y'|null)} AxisLock
 *
 * @typedef {Object} TransformInputState
 * @property {AxisLock} axis
 * @property {string} typedBuffer
 * @property {boolean} numericMode
 *
 * @typedef {{type:'toggleAxis', axis:'x'|'y'}
 *   | {type:'setAxis', axis:AxisLock}
 *   | {type:'appendTyped', ch:string}
 *   | {type:'popTyped'}
 *   | {type:'clearTyped'}
 *   | {type:'enterNumericMode'}
 *   | {type:'exitNumericMode'}
 *   | {type:'reset'}
 *   | {type:'noop'}
 *   | {type:'commit'}
 *   | {type:'cancel'}
 * } TransformInputAction
 *
 * @typedef {Object} KeyEventOptions
 * @property {boolean} [axisAllowed]  - default true; set false for contexts
 *   that don't support axis lock (none exist today, but the option keeps the
 *   helper honest about its assumptions).
 */

/** @type {Readonly<TransformInputState>} */
export const INITIAL_STATE = Object.freeze({
  axis: null,
  typedBuffer: '',
  numericMode: false,
});

/**
 * Pure reducer. Returns the same object identity when a transition is
 * a no-op so React / Zustand `Object.is` comparisons skip downstream
 * re-renders.
 *
 * Note that `'commit'` and `'cancel'` are recognized as action shapes
 * (so callers can use the same dispatch path uniformly) but produce no
 * state change here — they're external events that the caller routes
 * to its own commit/cancel logic.
 *
 * @param {TransformInputState} state
 * @param {TransformInputAction} action
 * @returns {TransformInputState}
 */
export function transformInputReducer(state, action) {
  if (!action || typeof action !== 'object') return state;
  switch (action.type) {
    case 'toggleAxis': {
      if (action.axis !== 'x' && action.axis !== 'y') return state;
      const next = state.axis === action.axis ? null : action.axis;
      if (next === state.axis) return state;
      return { ...state, axis: next };
    }
    case 'setAxis': {
      const next = action.axis === 'x' || action.axis === 'y' ? action.axis : null;
      if (next === state.axis) return state;
      return { ...state, axis: next };
    }
    case 'appendTyped': {
      const ch = action.ch;
      if (typeof ch !== 'string' || ch.length !== 1) return state;
      const buf = state.typedBuffer ?? '';
      if (ch === '-') {
        if (buf.length > 0) return state;
        return { ...state, typedBuffer: '-' };
      }
      if (ch === '.') {
        if (buf.includes('.')) return state;
        return { ...state, typedBuffer: buf.length === 0 ? '0.' : buf + '.' };
      }
      if (ch >= '0' && ch <= '9') {
        return { ...state, typedBuffer: buf + ch };
      }
      return state;
    }
    case 'popTyped': {
      const next = (state.typedBuffer ?? '').slice(0, -1);
      if (next.length === 0 && state.numericMode) {
        return { ...state, typedBuffer: '', numericMode: false };
      }
      if (next === state.typedBuffer) return state;
      return { ...state, typedBuffer: next };
    }
    case 'clearTyped':
      if (state.typedBuffer === '') return state;
      return { ...state, typedBuffer: '' };
    case 'enterNumericMode':
      if (state.numericMode) return state;
      return { ...state, numericMode: true };
    case 'exitNumericMode':
      if (!state.numericMode) return state;
      return { ...state, numericMode: false };
    case 'reset':
      if (
        state.axis === INITIAL_STATE.axis
        && state.typedBuffer === INITIAL_STATE.typedBuffer
        && state.numericMode === INITIAL_STATE.numericMode
      ) return state;
      return INITIAL_STATE;
    case 'noop':
    case 'commit':
    case 'cancel':
    default:
      return state;
  }
}

/**
 * Parse the typed buffer to a finite number, or NaN if the buffer is
 * empty / not yet a valid number (e.g. `'-'` or `'.'` mid-typing). Use
 * `Number.isFinite(parseTyped(buf))` to decide whether the typed value
 * overrides mouse-delta.
 *
 * @param {string|null|undefined} buf
 * @returns {number}
 */
export function parseTyped(buf) {
  if (typeof buf !== 'string' || buf.length === 0) return NaN;
  const n = Number(buf);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Translate a KeyboardEvent to a reducer action (or null if the event
 * isn't a modal-input key). Returning a non-null action means the modal
 * has consumed the key — caller MUST `preventDefault` + `stopPropagation`
 * to prevent global hotkey dispatchers from firing.
 *
 * The `'noop'` return shape exists for chords the modal recognizes but
 * doesn't transition on (currently Shift+X / Shift+Y per Blender's 2D
 * plane-lock blocklist at `transform.cc:660-662`).
 *
 * @param {KeyboardEvent} event
 * @param {KeyEventOptions} [options]
 * @returns {TransformInputAction | null}
 */
export function keyEventToAction(event, options = {}) {
  const { axisAllowed = true } = options;

  if (event.key === 'Escape') return { type: 'cancel' };
  if (event.key === 'Enter') return { type: 'commit' };

  if (event.shiftKey && (event.code === 'KeyX' || event.code === 'KeyY')) {
    return { type: 'noop' };
  }

  if (axisAllowed && event.code === 'KeyX' && !event.shiftKey) {
    return { type: 'toggleAxis', axis: 'x' };
  }
  if (axisAllowed && event.code === 'KeyY' && !event.shiftKey) {
    return { type: 'toggleAxis', axis: 'y' };
  }

  if (event.key === '=') {
    return (event.ctrlKey || event.metaKey)
      ? { type: 'exitNumericMode' }
      : { type: 'enterNumericMode' };
  }

  if (event.key === 'Backspace') return { type: 'popTyped' };

  if (typeof event.key === 'string' && event.key.length === 1 && (
    (event.key >= '0' && event.key <= '9')
    || event.key === '-'
    || event.key === '.'
  )) {
    return { type: 'appendTyped', ch: event.key };
  }

  return null;
}
