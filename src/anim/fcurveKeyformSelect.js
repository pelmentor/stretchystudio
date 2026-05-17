// @ts-check

/**
 * Animation Phase 5 Slice 5.L — Keyform-level INVERT selection helper.
 *
 * Pure mutation helper for the Plot's `selectedHandles` map — the
 * per-FCurve, per-keyform handle-trio (center/left/right) selection
 * state. This module is the keyform-layer peer of `fcurveChannelSelect.js`
 * (which owns the per-FCurve `selected` boolean at the channel layer).
 *
 * # Why a separate module
 *
 * Slice 5.K wired bulk channel select-all (A / Alt+A / Ctrl+I when
 * cursor is over the sidebar). The graph-region keymap binds the SAME
 * three actions to `graph.select_all` (`blender_default.py:2010`), but
 * operating on keyforms instead of channels. Slice 5.K shipped A and
 * Alt+A for the graph region by reusing the in-component `clearSelection`
 * + `operatorSelectAll` callbacks; Ctrl+I was deferred because no
 * keyform-invert primitive existed yet. This module ships that primitive.
 *
 * # Blender semantics ported
 *
 * Keymap registration — `_template_items_select_actions` in
 * `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:420-439`,
 * registered for `graph.select_all` at `:2010` inside `km_graph_editor`.
 *
 * The default `Params` config sets `use_select_all_toggle=False` (line
 * 115) → the `if not params.use_select_all_toggle` branch fires (lines
 * 421-427), placing Ctrl+I → INVERT at **line 425**. The `else` branch
 * (lines 434-439, when `use_select_all_toggle=True` user preference is
 * set) emits the same Ctrl+I → INVERT at line 438. Both branches —
 * along with the legacy branch's line 432 — agree on Ctrl+I semantics;
 * the divergence between branches is only for the `A` key (SELECT vs
 * TOGGLE). Audit-fix LOW-B1 (Slice 5.L dual-audit 2026-05-17) corrected
 * an earlier citation that pointed at :438 alone — accurate, but in
 * the wrong branch for the default config.
 *
 * The `industry_compatible_data.py` keymap at `:966` also binds Ctrl+I
 * → INVERT for `graph.select_all`; both keymaps agree, no divergence.
 *
 * Operator dispatch — `graphkeys_deselectall_exec` at
 * `reference/blender/source/blender/editors/space_graph/graph_select.cc:423-475`:
 *
 *   case SEL_INVERT:
 *     deselect_graph_keys(&ac, false, SELECT_INVERT, true);
 *
 * `deselect_graph_keys` at `graph_select.cc:354-419` walks visible
 * FCurves (`ANIMFILTER_DATA_VISIBLE | ANIMFILTER_CURVE_VISIBLE |
 * ANIMFILTER_FCURVESONLY | ANIMFILTER_NODUPLIS`) and for each visible
 * curve invokes `ANIM_fcurve_keyframes_loop` with the SELECT_INVERT
 * callback per BezTriple.
 *
 * Per-BezTriple INVERT — `select_bezier_invert` at
 * `reference/blender/source/blender/editors/animation/keyframes_edit.cc:1567-1580`:
 *
 *   bezt->f2 ^= BEZT_FLAG_SELECT;      // flip center (keyframe vertex)
 *   if (bezt->f2 & SELECT) {           // handles ALWAYS mirror new center
 *     bezt->f1 |= BEZT_FLAG_SELECT;    // → after invert, partial
 *     bezt->f3 |= BEZT_FLAG_SELECT;    //   handle-only selections collapse
 *   } else {                           //   to all-3 or none.
 *     bezt->f1 &= ~BEZT_FLAG_SELECT;
 *     bezt->f3 &= ~BEZT_FLAG_SELECT;
 *   }
 *
 * Center is the truth. Handles are forced to mirror. SS port mirrors
 * this exactly: read `center`, flip, write `{ center, left, right }`
 * all to the flipped value. A pre-invert state like `{ center: false,
 * left: true, right: false }` (handle-only selection from a future
 * partial-handle box-select) flips to `{ center: true, left: true,
 * right: true }` — same convergence Blender produces.
 *
 * # Visible-curves filter
 *
 * The caller passes `visibleFCurves` (already filtered by
 * `isFCurveHidden`) so hidden curves (Slice 5.I's `fcurve.hide`) are
 * excluded — matching Blender's `ANIMFILTER_CURVE_VISIBLE`. Hidden
 * curves' existing entries in `currentSelection` are DROPPED in the
 * return value (they aren't in `visibleFCurves`), which matches the
 * existing `operatorSelectAll` behavior on line 1816 of FCurveEditor
 * (`if (sub.size > 0) next.set(d.fcurve.id, sub)`).
 *
 * # SS deviations from Blender (intentional)
 *
 * **Deviation 1 — no channel-flag side-effect.** Blender's
 * `deselect_graph_keys` with `do_channels=true` (`graph_select.cc:397-413`)
 * has a side-effect: when `sel != SELECT_SUBTRACT` (true for INVERT),
 * every walked FCurve gets `fcu->flag |= FCURVE_SELECTED`. SS does NOT
 * propagate this to the channel layer because (a) the existing SS
 * `operatorSelectAll` doesn't either — symmetric precedent; (b) the
 * user expectation when pressing Ctrl+I in the graph region is "invert
 * which keyforms I'll drag", not "incidentally promote every channel
 * to selected". Same reasoning as Slice 5.K's MED-A1 deferral of
 * channel-active-clearing. Tracked under `project_ss_is_embryo`.
 *
 * **Deviation 2 — no FCURVE_ACTIVE clearing/restoration.** Blender's
 * `graphkeys_deselectall_exec` (`graph_select.cc:423-475`) saves the
 * active FCurve before the batch op, lets `deselect_graph_keys` clear
 * every FCURVE_ACTIVE flag (line 413), then restores
 * `(FCURVE_SELECTED | FCURVE_ACTIVE)` on the active one (line 466). SS
 * doesn't have a per-FCurve ACTIVE flag — active is derived from
 * `selectStore` (param/node) — so there is nothing to clear or
 * restore at this layer. Same deferral as Slice 5.K's MED-A1.
 *
 * # Active-keyform side-effect
 *
 * Blender's "active keyform" (`SIPO_FLAG_ACTIVE_KEYFORM` highlight from
 * Slice 5.I) is NOT mutated by `graph.select_all` in any branch — the
 * active-keyform pointer is preserved across bulk operations. SS port
 * matches: this helper writes only to the handle-selection map; the
 * caller leaves `action.activeKeyformId` alone. (Verified at
 * `graph_select.cc:423-475` — no `active_keyform` writes in the
 * select-all exec path.)
 */

/**
 * Apply Blender-faithful keyform INVERT across every visible FCurve.
 *
 * @param {Array<{ id?: string, keyforms?: Array<unknown> }>} visibleFCurves
 *   Visible curves in display order. Hidden curves (Slice 5.I
 *   `fcurve.hide`) must already be filtered out by the caller —
 *   mirrors Blender's `ANIMFILTER_CURVE_VISIBLE`.
 * @param {Map<string, Map<number, { center?: boolean, left?: boolean, right?: boolean }>> | null | undefined} currentSelection
 *   Current `selectedHandles` map. Sparse: missing entries = not
 *   selected. Read access only; the input is not mutated.
 * @returns {Map<string, Map<number, { center: boolean, left: boolean, right: boolean }>>}
 *   Fresh selection map after INVERT. Center flipped per keyform;
 *   handles mirror the new center (`select_bezier_invert`). Sparse
 *   invariant: entries where new center is false are OMITTED, and
 *   sub-maps that end up empty are not added to the outer map (same
 *   convention as `operatorSelectAll`).
 */
export function applyKeyformInvertSelection(visibleFCurves, currentSelection) {
  const next = new Map();
  if (!Array.isArray(visibleFCurves)) return next;
  const curr = currentSelection instanceof Map ? currentSelection : null;
  for (const fc of visibleFCurves) {
    if (!fc || typeof fc.id !== 'string' || !Array.isArray(fc.keyforms)) continue;
    const currCurve = curr ? curr.get(fc.id) : null;
    const sub = new Map();
    for (let i = 0; i < fc.keyforms.length; i++) {
      const currEntry = currCurve instanceof Map ? currCurve.get(i) : null;
      const wasSelected = currEntry ? currEntry.center === true : false;
      const nowSelected = !wasSelected;
      if (nowSelected) {
        sub.set(i, { center: true, left: true, right: true });
      }
    }
    if (sub.size > 0) next.set(fc.id, sub);
  }
  return next;
}
