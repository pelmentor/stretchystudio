// @ts-check

/**
 * Dopesheet box-select substrate — Animation Phase 6 Slice 6.B.
 *
 * Pure mutation helpers for marquee (drag-rect) selection in the
 * Dopesheet. Sister to:
 *   - Slice 6.A `dopesheetSelectOps.js` — per-tick click select
 *   - Slice 5.Y `fcurveBoxSelect.js` — FCurveEditor channel-list
 *     box-select (different scope: that one selects CHANNELS, this
 *     one selects KEYFORMS).
 *
 * # Blender semantics ported
 *
 * **Operator** — `ACTION_OT_select_box` defined at
 * `reference/blender/source/blender/editors/space_action/action_select.cc:675-695`:
 *
 *   ot->name = "Box Select";
 *   ot->idname = "ACTION_OT_select_box";
 *   ot->invoke = actkeys_box_select_invoke;       // line 603-622
 *   ot->exec = actkeys_box_select_exec;           // line 624-673
 *   ot->modal = WM_gesture_box_modal;
 *
 * **Exec body** — `actkeys_box_select_exec` at `action_select.cc:624-673`:
 *
 *   1. Read `mode` RNA enum (`SET` / `ADD` / `SUB`) → translate to
 *      `selectmode` (`SELECT_ADD` for SET/ADD, `SELECT_SUBTRACT` for
 *      SUB). Line 636 — note SET maps to ADD because the pre-deselect
 *      below handles the "clear first" semantic; SUB maps to SUBTRACT.
 *   2. If `SEL_OP_USE_PRE_DESELECT(sel_op)` (only true for SET / REPLACE),
 *      call `deselect_action_keys(&ac, 1, SELECT_SUBTRACT)` to wipe
 *      existing keyframe selection. Line 637-639.
 *   3. Build rect from operator's border properties (`xmin/ymin/xmax/ymax`).
 *      Line 642.
 *   4. Pick `mode` (the box-select scope, NOT the SET/ADD/SUB enum
 *      above) based on `axis_range` RNA flag (line 645-661):
 *        - false → `ACTKEYS_BORDERSEL_ALLKEYS` — all keys in rect XY
 *        - true → axis-favored: X-major → `BORDERSEL_FRAMERANGE`
 *          (all keys in time-range regardless of row);
 *          Y-major → `BORDERSEL_CHANNELS` (all keys in selected rows
 *          regardless of time).
 *   5. Call `box_select_action(&ac, rect, mode, selectmode)` (line 665) —
 *      defined at `action_select.cc:527-598`; walks the visible
 *      bAnimListElem and per-element invokes `box_select_elem`
 *      (line 456-525) which dispatches by `ale->type` and ultimately
 *      flips `bezt->f2 & SELECT` via the SS-equivalent of
 *      `select_bezier_add` / `select_bezier_subtract`
 *      (`keyframes_edit.cc:1523` / `:1545`).
 *
 * **Invoke body** — `actkeys_box_select_invoke` at `action_select.cc:603-622`:
 *
 *   - Reads `tweak` RNA boolean (true when invoked by LMB CLICK_DRAG;
 *     false when invoked by B-key + standalone modal rect entry).
 *   - When `tweak=true`, calls `actkeys_is_key_at_position(ac, mval_x, mval_y)`;
 *     if the drag started ON a keyframe, returns
 *     `OPERATOR_CANCELLED | OPERATOR_PASS_THROUGH` so the click-on-key
 *     operator (`ACTION_OT_clickselect`, Slice 6.A) handles it instead.
 *     SS mirrors this in the consumer's DOM event handler — if
 *     `pointerdown.target.closest('[data-tick]')`, don't start a
 *     drag-rect; let the tick's onClick fire normally.
 *
 * **Keymap** — `blender_default.py:2662-2671`:
 *
 *   ("action.select_box", {"type": 'B', "value": 'PRESS'},
 *    {"properties": [("axis_range", False)]}),                     // BKEY → modal rect, all-keys mode
 *   ("action.select_box", {"type": 'B', "value": 'PRESS', "alt": True},
 *    {"properties": [("axis_range", True)]}),                       // Alt+BKEY → axis-favored
 *   ("action.select_box", {"type": ..., "value": 'CLICK_DRAG'},
 *    {"properties": [("tweak", True), ("mode", 'SET')]}),           // plain LMB-drag → REPLACE
 *   ("action.select_box", {"type": ..., "value": 'CLICK_DRAG', "shift": True},
 *    {"properties": [("tweak", True), ("mode", 'ADD')]}),           // Shift LMB-drag → EXTEND
 *   ("action.select_box", {"type": ..., "value": 'CLICK_DRAG', "ctrl": True},
 *    {"properties": [("tweak", True), ("mode", 'SUB')]}),           // Ctrl LMB-drag → SUBTRACT
 *
 * SS mode mapping (the helper's `mode` parameter):
 *
 *   - **'replace'** = plain LMB-drag OR plain B-key. Pre-clear all
 *     selection then add hitsInRect. Blender's SET path (line 637's
 *     `SEL_OP_USE_PRE_DESELECT` returns true for SET).
 *   - **'extend'** = Shift+LMB-drag. NO pre-clear; ADD hitsInRect to
 *     the existing selection. Blender's ADD path.
 *   - **'subtract'** = Ctrl+LMB-drag. NO pre-clear; REMOVE hitsInRect
 *     from the existing selection. Blender's SUB path.
 *
 * # Slice 6.B scope
 *
 * Ships ALLKEYS mode only (the BKEY + plain-drag default). Axis-range
 * mode (Alt+B with X-major → FRAMERANGE; Y-major → CHANNELS) deferred
 * to a polish slice; the substrate is the same `applyBoxSelect`
 * function for all three since the SHAPE of `hitsInRect` is identical
 * — only the JSX-layer hit computation changes.
 *
 * Per-handle selection: like Slice 6.A's per-tick ops, box-select
 * writes ALL THREE handle bits (center + left + right) for each hit
 * tick. Matches Blender's `select_bezier_add` at `keyframes_edit.cc:1523`
 * which sets all three.
 *
 * # SS deviations
 *
 * **None new this slice.** Inherits SS DEVIATION 1 from Slice 6.A
 * (Ctrl+LMB on a tick = deselect; here, Ctrl+LMB-drag = subtract-
 * from-selection, which is the BLENDER-FAITHFUL behavior — so the
 * drag binding stays in line with Blender while the click binding
 * is the SS deviation. No conflict at the drag layer.)
 *
 * # Cross-references
 *
 *   - `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 6.B
 *   - `src/store/keyformSelectionStore.js` — the store this writes to
 *   - `src/anim/dopesheetSelectOps.js` — sister per-tick click select
 *   - `src/anim/fcurveBoxSelect.js` — channel-list box-select (different
 *     scope: channels vs keyforms; same mode-mapping convention)
 *   - `reference/blender/source/blender/editors/space_action/action_select.cc:603-622`
 *     (`actkeys_box_select_invoke`)
 *   - `reference/blender/source/blender/editors/space_action/action_select.cc:624-673`
 *     (`actkeys_box_select_exec`)
 *   - `reference/blender/source/blender/editors/space_action/action_select.cc:675-695`
 *     (`ACTION_OT_select_box` operator registration)
 *   - `reference/blender/source/blender/editors/space_action/action_select.cc:527-598`
 *     (`box_select_action` — the in-rect walker)
 *   - `reference/blender/source/blender/editors/space_action/action_select.cc:441-446`
 *     (`ACTKEYS_BORDERSEL_*` enum — ALLKEYS / FRAMERANGE / CHANNELS)
 *   - `reference/blender/source/blender/editors/animation/keyframes_edit.cc:1523-1532`
 *     (`select_bezier_add` — per-bezt all-3-handles set helper)
 *   - `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:2662-2671`
 *     (`km_dopesheet` box_select bindings)
 *
 * @module anim/dopesheetBoxSelect
 */

/**
 * @typedef {{ fcurveId: string, kfIdx: number }} TickRef
 *
 * @typedef {{ center: boolean, left: boolean, right: boolean }} HandleParts
 *
 * @typedef {Map<string, Map<number, HandleParts>>} SelectedHandlesMap
 */

/**
 * Full-selection payload for a tick (same shape as Slice 6.A's
 * `FULL_SELECT` in dopesheetSelectOps.js). Frozen so the same shared
 * object can be safely written into many Map entries.
 *
 * @type {Readonly<HandleParts>}
 */
const FULL_SELECT = Object.freeze({ center: true, left: true, right: true });

/**
 * Valid mode values. Frozen array drives the input-validation throw.
 *
 * @type {Readonly<Array<'replace'|'extend'|'subtract'>>}
 */
export const BOX_SELECT_MODES = Object.freeze([
  /** @type {const} */ ('replace'),
  /** @type {const} */ ('extend'),
  /** @type {const} */ ('subtract'),
]);

/**
 * Apply a box-select to the current selection Map.
 *
 * **Pure** — reads `handles` + `hitsInRect`, returns a NEW Map; never
 * mutates the input.
 *
 * **Throws (Rule №1)** on:
 *   - `mode` not one of `BOX_SELECT_MODES`
 *   - `hitsInRect` not an array (null / undefined / object)
 *   - per-hit shape failure (missing `fcurveId` / `kfIdx`)
 *
 * **Identity-stable returns** for legitimate no-ops:
 *   - 'extend' / 'subtract' with empty `hitsInRect` → returns the
 *     input ref unchanged (no work to do).
 *   - 'replace' with empty `hitsInRect` AND empty `handles` already
 *     → returns input ref (no work to do).
 *   - 'replace' with empty `hitsInRect` AND non-empty `handles` →
 *     returns a fresh empty Map (clearing IS a change).
 *
 * @param {SelectedHandlesMap} handles - current selection (not mutated)
 * @param {TickRef[]} hitsInRect - ticks intersected by the drag rect
 * @param {'replace'|'extend'|'subtract'} mode
 * @returns {SelectedHandlesMap}
 */
export function applyBoxSelect(handles, hitsInRect, mode) {
  if (!BOX_SELECT_MODES.includes(mode)) {
    throw new Error(
      `dopesheetBoxSelect.applyBoxSelect: mode must be one of `
      + `${BOX_SELECT_MODES.join('|')} (got '${mode}')`
    );
  }
  if (!Array.isArray(hitsInRect)) {
    throw new Error(
      `dopesheetBoxSelect.applyBoxSelect: hitsInRect must be an array `
      + `(got ${typeof hitsInRect})`
    );
  }

  // Validate each hit at the boundary — silent skip of a malformed
  // entry would leave the caller blind to a row-builder bug.
  for (const h of hitsInRect) {
    if (
      !h
      || typeof h.fcurveId !== 'string'
      || h.fcurveId.length === 0
      || !Number.isInteger(h.kfIdx)
      || h.kfIdx < 0
    ) {
      throw new Error(
        `dopesheetBoxSelect.applyBoxSelect: each hit must be `
        + `{fcurveId: non-empty string, kfIdx: non-negative integer} `
        + `(got ${JSON.stringify(h)})`
      );
    }
  }

  // Identity-stable no-op paths
  if (hitsInRect.length === 0) {
    if (mode === 'extend' || mode === 'subtract') {
      return handles;
    }
    // 'replace' with no hits: clear (which is a change iff handles non-empty)
    if (handles.size === 0) return handles;
    return new Map();
  }

  if (mode === 'subtract') {
    return subtractHits(handles, hitsInRect);
  }

  // 'replace' starts from an empty Map; 'extend' starts from a clone of handles
  /** @type {SelectedHandlesMap} */
  const base = mode === 'replace' ? new Map() : cloneHandles(handles);

  for (const hit of hitsInRect) {
    let sub = base.get(hit.fcurveId);
    if (!sub) {
      sub = new Map();
      base.set(hit.fcurveId, sub);
    }
    sub.set(hit.kfIdx, { ...FULL_SELECT });
  }

  // 'replace' + identical-to-prior no-op: if the result equals the
  // input (same fcurveIds, same kfIdxs, all-3-handles), return input
  // ref. This is rare in practice (the caller would have to drag a
  // rect that produces exactly the prior selection), but it preserves
  // the store's identity-stable contract for free.
  if (mode === 'replace' && handlesEqual(base, handles)) {
    return handles;
  }
  return base;
}

/**
 * Subtract-mode: remove every hit from the current handles. Pure.
 * Drops fcurveId entries from the outer Map when the inner sub
 * empties (same invariant as Slice 6.A's
 * `applyTickSelectExtend`/`Deselect`).
 *
 * Identity-stable if NO hit was in the selection (no work done).
 *
 * @param {SelectedHandlesMap} handles
 * @param {TickRef[]} hitsInRect
 * @returns {SelectedHandlesMap}
 */
function subtractHits(handles, hitsInRect) {
  // First pass: are any hits actually in the selection?
  let anyHit = false;
  for (const h of hitsInRect) {
    const sub = handles.get(h.fcurveId);
    if (sub && sub.has(h.kfIdx)) { anyHit = true; break; }
  }
  if (!anyHit) return handles;   // identity-stable no-op

  // Clone the outer + each affected inner sub once.
  /** @type {SelectedHandlesMap} */
  const next = new Map(handles);
  /** @type {Set<string>} */
  const touched = new Set();
  for (const h of hitsInRect) {
    const subPrev = next.get(h.fcurveId);
    if (!subPrev || !subPrev.has(h.kfIdx)) continue;
    let subNext;
    if (touched.has(h.fcurveId)) {
      subNext = /** @type {Map<number, HandleParts>} */ (next.get(h.fcurveId));
    } else {
      subNext = new Map(subPrev);
      next.set(h.fcurveId, subNext);
      touched.add(h.fcurveId);
    }
    subNext.delete(h.kfIdx);
    if (subNext.size === 0) next.delete(h.fcurveId);
  }
  return next;
}

/**
 * Deep-clone the outer + inner Maps. Used by 'extend' mode to start
 * from a private copy of `handles` we can safely mutate.
 *
 * @param {SelectedHandlesMap} handles
 * @returns {SelectedHandlesMap}
 */
function cloneHandles(handles) {
  /** @type {SelectedHandlesMap} */
  const out = new Map();
  for (const [fid, sub] of handles) {
    out.set(fid, new Map(sub));
  }
  return out;
}

/**
 * Structural equality of two handles Maps (same fcurveIds, same
 * kfIdxs, same all-3-handles values). Used for the 'replace'
 * identity-stable no-op path.
 *
 * @param {SelectedHandlesMap} a
 * @param {SelectedHandlesMap} b
 * @returns {boolean}
 */
function handlesEqual(a, b) {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [fid, subA] of a) {
    const subB = b.get(fid);
    if (!subB || subB.size !== subA.size) return false;
    for (const [kfIdx, partsA] of subA) {
      const partsB = subB.get(kfIdx);
      if (
        !partsB
        || partsB.center !== partsA.center
        || partsB.left !== partsA.left
        || partsB.right !== partsA.right
      ) return false;
    }
  }
  return true;
}

/**
 * Compute which ticks fall inside a time-axis range, scoped to the
 * already-Y-filtered rows. The caller is responsible for the Y
 * filtering (DOM row geometry → rows whose bounding-box Y intersects
 * the drag rect); this helper walks each row's keyforms and emits one
 * `TickRef` per keyform whose time falls in `[tMin, tMax]` (inclusive
 * on both ends — matches Blender's `BLI_rcti_isect_pt_v` semantic at
 * `action_select.cc:567` which uses inclusive integer-coord bounds).
 *
 * Rows with an empty / missing fcurveId are skipped (synthetic /
 * header rows have no selection identity). Rows with a missing /
 * non-array keyforms are skipped (defensive).
 *
 * **Pure** — does not mutate inputs.
 *
 * @param {Array<{fcurveId?: string|null, keyforms?: Array<{time?: number}>}>} hitRows
 * @param {number} tMin - time range lower bound (ms, inclusive)
 * @param {number} tMax - time range upper bound (ms, inclusive)
 * @returns {TickRef[]}
 */
export function computeBoxHits(hitRows, tMin, tMax) {
  if (!Array.isArray(hitRows)) return [];
  if (!Number.isFinite(tMin) || !Number.isFinite(tMax)) return [];
  // Normalize so tMin <= tMax (caller can pass either order; the drag
  // rect's min/max calculation should already do this, but be safe).
  const lo = Math.min(tMin, tMax);
  const hi = Math.max(tMin, tMax);

  /** @type {TickRef[]} */
  const hits = [];
  for (const row of hitRows) {
    if (!row || typeof row.fcurveId !== 'string' || row.fcurveId.length === 0) continue;
    if (!Array.isArray(row.keyforms)) continue;
    for (let i = 0; i < row.keyforms.length; i++) {
      const kf = row.keyforms[i];
      if (!kf || typeof kf.time !== 'number') continue;
      if (kf.time >= lo && kf.time <= hi) {
        hits.push({ fcurveId: row.fcurveId, kfIdx: i });
      }
    }
  }
  return hits;
}
