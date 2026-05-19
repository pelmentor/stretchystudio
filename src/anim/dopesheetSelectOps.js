// @ts-check

/**
 * Dopesheet keyform-tick selection ops — Animation Phase 6 Slice 6.A.
 *
 * Pure mutation helpers for the cross-editor
 * `keyformSelectionStore.handles` Map, called from DopesheetEditor's
 * tick click handler. Sister to `fcurveKeyformSelect.js` (which owns
 * the FCurveEditor's invert / select-all kernel) — this module owns
 * the DOPESHEET-side modes: replace / extend / deselect.
 *
 * # Why a separate module
 *
 * Phase 6 makes DopesheetEditor a WRITER of the
 * `keyformSelectionStore` (Slice 6.A lifted the canonical
 * `selectedHandles` state from FCurveEditor's local useState into the
 * store; see `keyformSelectionStore.js` history note). The Dopesheet
 * keymap differs from the FCurveEditor keymap:
 *
 *   - FCurveEditor LMB drag = box-select rect.
 *   - DopesheetEditor LMB on tick = select tick.
 *
 * Blender's Action Editor (sister surface to SS's Dopesheet) ships
 * a `ACTION_OT_clickselect` operator with extend / deselect /
 * column-select modes. SS ships the same three modes through these
 * three pure ops.
 *
 * # Blender semantics ported
 *
 * Operator: `ACTION_OT_clickselect` (`reference/blender/source/
 * blender/editors/space_action/action_select.cc`), invoked by LMB
 * on a tick. The relevant flag enum at the same file:
 *
 *   SELECT_REPLACE   = 0    -- clear all, select this one
 *   SELECT_EXTEND    = 1    -- shift+LMB: toggle this one, keep others
 *   SELECT_INVERT    = 2    -- ctrl+LMB: toggle this one (alias of EXTEND
 *                              for single-tick semantics)
 *
 * SS collapses EXTEND + INVERT to a single `applyTickSelectExtend`
 * because the per-tick toggle semantic is identical; "extend" is the
 * Blender-canonical name when shift is held. SS ALSO ships a
 * `applyTickSelectDeselect` for an explicit "deselect this tick
 * regardless of current state" mode that the Blender operator does
 * not separately surface (it's just shift-clicked-when-already-
 * selected). SS surfaces it as a distinct mode so the Dopesheet's
 * Ctrl+LMB binding maps cleanly without ambiguity.
 *
 * Selection payload shape mirrors Blender's `bezt->f1/f2/f3` triplet
 * collapsed to booleans, same as
 * `keyformSelectionStore.js#HandleParts`. Tick-click writes ALL THREE
 * (center + left + right) because in the Dopesheet view the user
 * thinks "select the keyframe" — not "select just the center handle".
 * FCurveEditor's per-handle selection is preserved when the user
 * subsequently opens the FCurveEditor; ticks just don't have a
 * separate left/right-handle visualization in the Dopesheet.
 *
 * # Cross-references
 *
 *   - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 6.A
 *   - `src/store/keyformSelectionStore.js` — the store this writes to
 *   - `src/anim/fcurveKeyformSelect.js` — sister module for invert /
 *     select-all kernels (Slice 5.L / 5.N)
 *   - `src/v3/editors/dopesheet/DopesheetEditor.jsx` — the consumer
 *
 * @module anim/dopesheetSelectOps
 */

/**
 * @typedef {{ center: boolean, left: boolean, right: boolean }} HandleParts
 *
 * @typedef {Map<string, Map<number, HandleParts>>} SelectedHandlesMap
 *   Outer Map keyed by fcurveId; inner Map keyed by keyform index.
 */

/**
 * Full-selection payload for a tick click. Mirrors the value
 * FCurveEditor writes for a diamond-hit (center+left+right all true);
 * the Dopesheet treats a tick as "select the whole keyframe", not "select
 * just the center handle".
 *
 * Frozen so callers can't accidentally mutate the shared object that
 * gets written into many Map entries.
 *
 * @type {Readonly<HandleParts>}
 */
const FULL_SELECT = Object.freeze({ center: true, left: true, right: true });

/**
 * Validate inputs. Throws (Rule №1) on bad fcurveId / keyformIdx —
 * silent-no-op would leave the caller staring at unchanged selection
 * with no Logs trace.
 *
 * @param {unknown} fcurveId
 * @param {unknown} keyformIdx
 * @param {string} opName
 */
function validateInputs(fcurveId, keyformIdx, opName) {
  if (typeof fcurveId !== 'string' || fcurveId.length === 0) {
    throw new Error(
      `dopesheetSelectOps.${opName}: fcurveId must be a non-empty string `
      + `(got ${typeof fcurveId === 'string' ? "''" : typeof fcurveId})`
    );
  }
  // `Number.isInteger` narrows to number — cast to satisfy strict-mode
  // TS comparison below (audit-fix TS2365 caught at substrate-ship).
  if (
    !Number.isInteger(keyformIdx)
    || /** @type {number} */ (keyformIdx) < 0
  ) {
    throw new Error(
      `dopesheetSelectOps.${opName}: keyformIdx must be a non-negative `
      + `integer (got ${keyformIdx})`
    );
  }
}

/**
 * Replace-mode: clear the entire current selection, then select ONLY
 * the given tick. Blender's `SELECT_REPLACE` semantic — plain LMB on
 * a tick. Always returns a fresh outer + inner Map; never mutates the
 * input.
 *
 * If the input already has exactly this selection (single entry, same
 * fcurveId + keyformIdx, full handles), returns the input unchanged
 * (identity-stable no-op — the store's `setHandles` will then skip
 * the `set()` call entirely).
 *
 * @param {SelectedHandlesMap} handles - current selection (not mutated)
 * @param {string} fcurveId
 * @param {number} keyformIdx
 * @returns {SelectedHandlesMap}
 */
export function applyTickSelectReplace(handles, fcurveId, keyformIdx) {
  validateInputs(fcurveId, keyformIdx, 'applyTickSelectReplace');
  // Identity-stable no-op: already exactly this selection
  if (
    handles.size === 1
    && handles.has(fcurveId)
  ) {
    const sub = /** @type {Map<number, HandleParts>} */ (handles.get(fcurveId));
    if (sub.size === 1 && sub.has(keyformIdx)) {
      const parts = sub.get(keyformIdx);
      if (
        parts
        && parts.center === true
        && parts.left === true
        && parts.right === true
      ) {
        return handles;
      }
    }
  }
  /** @type {SelectedHandlesMap} */
  const next = new Map();
  next.set(fcurveId, new Map([[keyformIdx, { ...FULL_SELECT }]]));
  return next;
}

/**
 * Extend-mode: TOGGLE the given tick — keep all other selections
 * intact. Blender's `SELECT_EXTEND` / `SELECT_INVERT` semantic on the
 * specific tick — shift+LMB. If the tick is already in the selection
 * (any handle), remove it; otherwise add it as fully-selected.
 *
 * **Toggle semantic, not "force-add"** (Blender alignment): if the
 * user shift-clicks an already-selected tick, the expected outcome is
 * "remove that tick from the selection". This is the documented
 * `SELECT_EXTEND` behavior at `ACTION_OT_clickselect` invoke time —
 * see how `mouse_action_keys` walks the keyframe at
 * `action_select.cc:1530-1600` (extend path).
 *
 * Returns a fresh outer Map. The inner Map for the affected fcurveId
 * is cloned (input never mutated). If the toggle empties the inner
 * Map, the fcurveId is REMOVED from the outer Map (preserves
 * `keyformSelectionStore`'s invariant that an empty inner subselection
 * is never serialized — sister to FCurveEditor's `setSubSelection`
 * helper at `FCurveEditor.jsx:944-951`).
 *
 * @param {SelectedHandlesMap} handles
 * @param {string} fcurveId
 * @param {number} keyformIdx
 * @returns {SelectedHandlesMap}
 */
export function applyTickSelectExtend(handles, fcurveId, keyformIdx) {
  validateInputs(fcurveId, keyformIdx, 'applyTickSelectExtend');
  /** @type {SelectedHandlesMap} */
  const next = new Map(handles);
  const subPrev = handles.get(fcurveId);
  if (subPrev && subPrev.has(keyformIdx)) {
    // Toggle off — clone the inner Map, delete the entry, drop the
    // fcurveId entirely if the inner Map empties.
    const subNext = new Map(subPrev);
    subNext.delete(keyformIdx);
    if (subNext.size === 0) next.delete(fcurveId);
    else next.set(fcurveId, subNext);
  } else {
    // Toggle on — clone the inner Map (or create fresh) + add the entry
    const subNext = new Map(subPrev ?? []);
    subNext.set(keyformIdx, { ...FULL_SELECT });
    next.set(fcurveId, subNext);
  }
  return next;
}

/**
 * Deselect-mode: remove the given tick from the selection (if
 * present); leave everything else intact. SS-specific mode used by
 * Ctrl+LMB on a tick — Blender folds this into SELECT_EXTEND's
 * "shift+clicked an already-selected entry" path, but SS surfaces it
 * as a distinct keybind for ergonomic clarity (a user who wants to
 * remove a specific tick from a larger selection doesn't need to
 * remember whether they last clicked it or not — Ctrl+LMB just
 * removes it, no-op if it wasn't selected).
 *
 * Identity-stable no-op when the tick wasn't selected — returns the
 * input unchanged so the store's setter skips notifying subscribers.
 *
 * @param {SelectedHandlesMap} handles
 * @param {string} fcurveId
 * @param {number} keyformIdx
 * @returns {SelectedHandlesMap}
 */
export function applyTickSelectDeselect(handles, fcurveId, keyformIdx) {
  validateInputs(fcurveId, keyformIdx, 'applyTickSelectDeselect');
  const subPrev = handles.get(fcurveId);
  if (!subPrev || !subPrev.has(keyformIdx)) {
    // No-op: the tick wasn't selected. Identity-stable return.
    return handles;
  }
  /** @type {SelectedHandlesMap} */
  const next = new Map(handles);
  const subNext = new Map(subPrev);
  subNext.delete(keyformIdx);
  if (subNext.size === 0) next.delete(fcurveId);
  else next.set(fcurveId, subNext);
  return next;
}

/**
 * Predicate: is the given tick currently selected (center bit)?
 * Useful for UI to render the selected vs unselected diamond style.
 * Pure read-only helper — does not subscribe to the store.
 *
 * @param {SelectedHandlesMap | null | undefined} handles
 * @param {string | null | undefined} fcurveId
 * @param {number | null | undefined} keyformIdx
 * @returns {boolean}
 */
export function isTickSelected(handles, fcurveId, keyformIdx) {
  if (!handles || typeof handles.get !== 'function') return false;
  if (typeof fcurveId !== 'string' || fcurveId.length === 0) return false;
  if (typeof keyformIdx !== 'number' || keyformIdx < 0) return false;
  const sub = handles.get(fcurveId);
  if (!sub || typeof sub.get !== 'function') return false;
  const parts = sub.get(keyformIdx);
  return !!(parts && parts.center === true);
}
