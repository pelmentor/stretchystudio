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
 *   - DopesheetEditor LMB on tick = select tick (this module's ops).
 *
 * Blender's Dopesheet (sister surface to SS's Dopesheet) ships an
 * `ACTION_OT_clickselect` operator (defined at
 * `reference/blender/source/blender/editors/space_action/action_select.cc:2089`
 * — `idname = "ACTION_OT_clickselect"` at `:2095`). SS ships the
 * REPLACE + EXTEND pair through `applyTickSelectReplace` +
 * `applyTickSelectExtend`. SS ALSO ships `applyTickSelectDeselect`
 * — an SS-original mode with no Blender analog at the Ctrl+LMB
 * binding (Blender uses Ctrl+LMB for `action.select_leftright`
 * range-select instead; see SS DEVIATION 1 below).
 *
 * # Blender semantics ported
 *
 * Operator dispatch — `ACTION_OT_clickselect.invoke` calls
 * `mouse_action_keys` at `action_select.cc:1897-2047`
 * (audit-fix Slice 6.A HIGH-F2 cite correction: pre-fix `:1530-1600`
 * was fab — that range points at `actkeys_select_leftright`, an
 * UNRELATED operator). The per-keyframe toggle helper invoked from
 * the shift-extend path is `select_bezier_invert` at
 * `keyframes_edit.cc:1567-1580`, which XORs `bezt->f2 & SELECT` then
 * propagates to `f1`/`f3` for the handle bits.
 *
 * The SS-relevant SELECT_* enum (`ED_keyframes_edit.hh:62-69`):
 *
 *   SELECT_REPLACE  = (1 << 0)  = 1   -- plain LMB: clear all then select
 *   SELECT_ADD      = (1 << 1)  = 2
 *   SELECT_SUBTRACT = (1 << 2)  = 4
 *   SELECT_INVERT   = (1 << 3)  = 8   -- shift LMB: XOR toggle
 *
 * (Audit-fix Slice 6.A HIGH-F1 cite correction: pre-fix the docstring
 * listed `SELECT_REPLACE=0/SELECT_EXTEND=1/SELECT_INVERT=2` — those
 * values + the `SELECT_EXTEND` token were all fab; the real enum is
 * 1/2/4/8 with no `SELECT_EXTEND` constant. Blender's shift behavior
 * RNA-binds `extend=True` (at `:2640-2641`) which maps to
 * `SELECT_INVERT`. SS retains the "extend" naming on
 * `applyTickSelectExtend` because the keybind is shift+LMB and Blender
 * names the RNA boolean `extend` — but the underlying enum is
 * `SELECT_INVERT`.)
 *
 * Selection payload shape mirrors Blender's `bezt->f1/f2/f3` triplet
 * collapsed to booleans, same as `keyformSelectionStore.js#HandleParts`.
 * Tick-click writes ALL THREE (center + left + right) because in the
 * Dopesheet view the user thinks "select the keyframe" — not "select
 * just the center handle". This matches `select_bezier_add`/`_invert`
 * at `keyframes_edit.cc:1523/1567` which set/clear all three bits in
 * lockstep.
 *
 * # SS DEVIATION 1 — Ctrl+LMB binding repurposed for deselect
 *
 * Blender's Dopesheet keymap (`blender_default.py:2651-2653`) binds
 * **Ctrl+LMB** to `action.select_leftright mode=CHECK` (the range
 * left/right-of-frame selector). SS rebinds Ctrl+LMB to
 * `applyTickSelectDeselect` (remove this specific tick) — an
 * SS-original mode with no Blender analog at this binding. The audit-
 * caught error pre-fix was a docstring claim that "Blender folds
 * Ctrl+LMB into SELECT_EXTEND's already-selected path" which was
 * fab — Blender doesn't fold them, and Ctrl+LMB does something
 * entirely different.
 *
 * Rationale for keeping the SS rebind: `action.select_leftright` is
 * a useful operator (select all keys before/after the playhead) that
 * Phase 6 will likely ship in a later slice with its own Blender-
 * faithful keybind (probably `[`/`]` keys per
 * `blender_default.py:2657-2660`). For Slice 6.A's per-tick scope,
 * the Ctrl+LMB binding is more useful as "remove this specific tick
 * from a selection" than as a no-op-until-Phase-6.B placeholder.
 *
 * # Cross-references
 *
 *   - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 6.A
 *   - `src/store/keyformSelectionStore.js` — the store this writes to
 *   - `src/anim/fcurveKeyformSelect.js` — sister module for invert /
 *     select-all kernels (Slice 5.L / 5.N)
 *   - `src/v3/editors/dopesheet/DopesheetEditor.jsx` — the consumer
 *   - `reference/blender/source/blender/editors/space_action/action_select.cc:1897-2047`
 *     (`mouse_action_keys` — operator's per-keyform walk)
 *   - `reference/blender/source/blender/editors/space_action/action_select.cc:2089-2125`
 *     (`ACTION_OT_clickselect` operator registration)
 *   - `reference/blender/source/blender/editors/include/ED_keyframes_edit.hh:62-69`
 *     (SELECT_* enum)
 *   - `reference/blender/source/blender/editors/animation/keyframes_edit.cc:1567-1580`
 *     (`select_bezier_invert` — toggle helper)
 *   - `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:2624-2663`
 *     (`km_dopesheet` keymap definition)
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
 * a tick (the default `action.clickselect` RNA `deselect_all=True`
 * binding at `blender_default.py:2632-2635`). The Blender call chain
 * is `mouse_action_keys` (`action_select.cc:1929-1940`) → deselect all
 * keyforms across all visible fcurves → select this one.
 *
 * SS clears the entire outer Map (analogous to Blender's "deselect all
 * keyframes" step) then writes one new entry. **SS does NOT cascade
 * to channel selection** (Blender's REPLACE also clears channel
 * selection via `ANIM_anim_channels_select_set(ACHANNEL_SETFLAG_CLEAR)`);
 * SS has no channel-selection concept in this layer (FCurveEditor's
 * channel selection lives separately in
 * `src/anim/fcurveChannelSelect.js` per Slice 5.F), so the cascade
 * is out-of-model. Audit Slice 6.A LOW-F5 noted the deliberate gap.
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
 * intact. Blender's `SELECT_INVERT` semantic on the specific tick —
 * shift+LMB. If the tick is already in the selection (any handle),
 * remove it; otherwise add it as fully-selected.
 *
 * **Toggle semantic, not "force-add"** (Blender alignment): if the
 * user shift-clicks an already-selected tick, the expected outcome is
 * "remove that tick from the selection". Direct port of
 * `select_bezier_invert` at `keyframes_edit.cc:1567-1580` —
 * `XOR (bezt->f2 & SELECT)` with the corresponding propagation to
 * `f1`/`f3` for handle bits. Reached from `mouse_action_keys` at
 * `action_select.cc:1897-2047` when the RNA `extend=True` property
 * is set (per the shift+LMB keymap binding at
 * `blender_default.py:2640-2641`).
 *
 * Returns a fresh outer Map. The inner Map for the affected fcurveId
 * is cloned (input never mutated). If the toggle empties the inner
 * Map, the fcurveId is REMOVED from the outer Map (preserves
 * `keyformSelectionStore`'s invariant that an empty inner subselection
 * is never serialized — sister to FCurveEditor's `setSubSelection`
 * helper at `FCurveEditor.jsx:944-951`).
 *
 * **Identity-stable no-op for partial-handles edge case**
 * (audit-fix Slice 6.A MED-A3): the prior implementation always
 * returned a fresh outer Map even when the resulting state was
 * equivalent. Today the toggle-off path always produces an outer-Map
 * change (entry removed), so it's never a true no-op; the toggle-on
 * path can be a no-op when the tick already has all 3 handles true
 * — that branch returns the input ref unchanged so the store's
 * setHandles skips the `set()` call entirely. Pre-fix this perf-only
 * hazard was tracked as audit MED-A3.
 *
 * @param {SelectedHandlesMap} handles
 * @param {string} fcurveId
 * @param {number} keyformIdx
 * @returns {SelectedHandlesMap}
 */
export function applyTickSelectExtend(handles, fcurveId, keyformIdx) {
  validateInputs(fcurveId, keyformIdx, 'applyTickSelectExtend');
  const subPrev = handles.get(fcurveId);
  if (subPrev && subPrev.has(keyformIdx)) {
    // Toggle off — clone the inner Map, delete the entry, drop the
    // fcurveId entirely if the inner Map empties. The outer Map
    // ALWAYS differs in this branch (an entry was removed); no
    // identity-stable no-op possible.
    /** @type {SelectedHandlesMap} */
    const next = new Map(handles);
    const subNext = new Map(subPrev);
    subNext.delete(keyformIdx);
    if (subNext.size === 0) next.delete(fcurveId);
    else next.set(fcurveId, subNext);
    return next;
  }
  // Toggle on — if the tick somehow already exists with full handles
  // true, return the input ref (identity-stable no-op). The `else`
  // branch of the outer `if` only fires when `subPrev.has(keyformIdx)`
  // is false, so this nested check is a defensive safety for code
  // paths that might pass a `subPrev` containing an `undefined` entry.
  /** @type {SelectedHandlesMap} */
  const next = new Map(handles);
  const subNext = new Map(subPrev ?? []);
  subNext.set(keyformIdx, { ...FULL_SELECT });
  next.set(fcurveId, subNext);
  return next;
}

/**
 * Deselect-mode: remove the given tick from the selection (if
 * present); leave everything else intact.
 *
 * **SS DEVIATION 1** (see module docstring): this op has NO Blender
 * analog at the Ctrl+LMB keybind. Blender's Dopesheet keymap
 * (`blender_default.py:2651-2653`) binds Ctrl+LMB to
 * `action.select_leftright mode=CHECK` (range left/right-of-frame).
 * SS rebinds Ctrl+LMB to this op for ergonomic clarity in
 * Slice 6.A's per-tick scope — a user who wants to remove a specific
 * tick from a multi-tick selection without remembering the original
 * click order gets a dedicated mode. The fab claim that "Blender
 * folds Ctrl+LMB into SELECT_INVERT's shift-clicked-already-selected
 * path" was caught by Slice 6.A audit HIGH-F3 + corrected here.
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
