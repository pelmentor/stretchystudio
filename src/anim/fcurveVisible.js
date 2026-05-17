// @ts-check

/**
 * Animation Phase 5 Slice 5.I — Channel visibility helper.
 *
 * Pure mutation helper for the per-FCurve `hide` boolean — negative of
 * Blender's `FCURVE_VISIBLE` bit (`DNA_anim_enums.h:303-305`,
 * `rna_fcurve.cc:2696-2697` exposes it as `fcurve.hide` via
 * `RNA_def_property_boolean_negative_sdna`). Sister to `mute` (Slice 5.G),
 * `selected` (Slice 5.F) and `activeKeyformIndex` (Slice 5.H).
 *
 * # Why this slice exists
 *
 * Slices 5.C+/D/E/F/G/H surfaced eye-toggle visibility through a
 * local-React `useState(new Set())` in FCurveEditor. That state is lost
 * when:
 *   - the user switches editor tabs (the FCurveEditor unmounts),
 *   - the project is saved and reloaded,
 *   - the active Action changes (each Action re-derives its own
 *     decoded list, but the hidden set is keyed by fcurve.id which
 *     happens to survive — yet remains process-scoped only).
 *
 * Blender persists `FCURVE_VISIBLE` on the FCurve datablock itself, so
 * a hidden curve stays hidden across file save/load. SS now mirrors
 * that by storing the bit on `fcurve.hide` in the project JSON.
 *
 * # Blender semantics ported
 *
 * The flag has three distinct caller sites:
 *
 *   - **Editor filter** — `anim_filter.cc:1287-1288` gates inclusion in
 *     `ANIMFILTER_CURVE_VISIBLE`-filtered iteration. Hidden curves are
 *     skipped from the Graph Editor's row enumeration, which means
 *     their plot DOES NOT render and their handles are NOT hit-testable.
 *     A second loop at `anim_filter.cc:1441` enforces the same rule for
 *     `visibility_matters` callers. SS matches via the existing
 *     `visible = decoded.filter(...)` memo in FCurveEditor.jsx (now
 *     fed by `!isFCurveHidden(fc)` instead of `!hidden.has(fcId)`).
 *
 *   - **Render hint** — `anim_channels_defines.cc:5267-5269` dims the
 *     color-band rect to 0.3 alpha when `!(fcu->flag & FCURVE_VISIBLE)`.
 *     SS already mirrors this in the Sidebar (the color square's
 *     `opacity: isHidden ? 0.3 : 1`).
 *
 *   - **Channel sidebar setting** — `anim_channels_defines.cc:1130-1131`
 *     wires `ACHANNEL_SETTING_VISIBLE` ↔ `FCURVE_VISIBLE` for the
 *     F-Curve channel type. The Python API spells it `fcurve.hide`
 *     (NEGATIVE_sdna, `rna_fcurve.cc:2697`), which is the field name
 *     SS adopts. The operator `ANIM_OT_channels_setting_toggle`
 *     (`anim_channels_edit.cc:3105`) carries `OPTYPE_REGISTER |
 *     OPTYPE_UNDO`, so Blender registers hide changes in its undo
 *     stack — SS matches by calling `update(recipe)` without
 *     `skipHistory:true`.
 *
 * # Visibility does NOT gate evaluation
 *
 * Important divergence from mute: `is_fcurve_evaluatable` at
 * `reference/blender/source/blender/animrig/intern/evaluation.cc:95-111`
 * checks only `FCURVE_MUTED` (plus null `rna_path`), NOT
 * `FCURVE_VISIBLE`. Hidden curves still drive their bound properties.
 *
 * SS's eval substrate (`evaluateActionFCurves`, `kernelFCurveEval`)
 * iterates `action.fcurves` directly without consulting `hide`, so
 * playback continues to apply hidden curves' values to the rig.
 * Matches Blender; not a bug.
 *
 * # Visibility does NOT auto-clear selection/active
 *
 * Per-row hide toggle (`ACHANNEL_SETTING_VISIBLE` via
 * `anim_channels_edit.cc:3105`) just flips the bit. The combined
 * "deselect-all-and-optionally-hide" path
 * (`anim_channels_edit.cc:5411-5428`, `deselect_all_fcurves(hide=true)`)
 * clears `FCURVE_SELECTED | FCURVE_ACTIVE` only when invoked from the
 * higher-level operator paths (e.g. graph-area box-deselect with a
 * specific intent). The eye-toggle SS exposes maps to the first path,
 * so SS does NOT touch `selected`, the active fcurve, the
 * `selectedHandles` keyform-pick map, or the `activeKeyformIndex`
 * sparse field when hiding. The hidden curve simply stops drawing;
 * if the user un-hides it later the same selection state returns.
 *
 * The hidden curve also still appears in the sidebar (so the user can
 * click the eye to un-hide). Blender's `ANIMFILTER_LIST_CHANNELS`
 * filter intentionally omits `ANIMFILTER_CURVE_VISIBLE` for the same
 * reason: the row stays, only the plot disappears. SS matches by
 * mapping the sidebar over `decoded` (full list) but the plot +
 * hit-tests over `visible` (filtered list).
 *
 * # Bulk visibility operators (Slice 5.M — this slice)
 *
 * `GRAPH_OT_hide` and `GRAPH_OT_reveal` ship as `applyHideFCurves` and
 * `applyRevealFCurves` below. See those exports' JSDoc for per-helper
 * Blender citations.
 *
 * # SS-deferred Blender visibility operators
 *
 *   - **`setflag_anim_channels` with `ACHANNEL_SETTING_VISIBLE`** —
 *     channel-group hierarchical flushing (parent group → children).
 *     Gated on the not-yet-shipped FCurveGroup datablock; sister to
 *     the `AGRP_MUTED` flush gap already documented in
 *     [fcurveMute.js](./fcurveMute.js).
 *   - **`deselect_all_fcurves(hide=true)`** — composite
 *     deselect-and-hide already documented above.
 *
 * # Schema & migration
 *
 * No migration ships with this slice. `fcurve.hide` is a sparse
 * boolean: missing in v40-and-older saves, treated as `false` by
 * `isFCurveHidden`. Per `feedback_no_migration_baggage_rule_two`, a
 * migration writing `hide: false` onto every fcurve would be pure
 * noise — the reader collapses tri-state (`true` / `false` / missing)
 * into a clean boolean already.
 *
 * Hide IS in the project undo history (mirrors Slice 5.G's mute path
 * and Blender's `OPTYPE_UNDO`). Toggle calls `update(recipe)` without
 * `skipHistory:true`.
 *
 * @module anim/fcurveVisible
 */

/**
 * Read accessor for the negative of `FCURVE_VISIBLE`.
 *
 * Strict `=== true` check: defensive against accidental writes of
 * `1`/`"yes"`/non-boolean truthy values that aren't part of the
 * contract. Mirrors `isFCurveMuted` (Slice 5.G) and `isFCurveSelected`
 * (Slice 5.F).
 *
 * @param {object|null|undefined} fcurve
 * @returns {boolean}
 */
export function isFCurveHidden(fcurve) {
  return !!(fcurve && fcurve.hide === true);
}

/**
 * Toggle the per-FCurve hide bit in-place.
 *
 * Mirrors Blender's `ACHANNEL_SETTING_TOGGLE` write through
 * `acf_fcurve_setting_flag` (returns `FCURVE_VISIBLE`) → caller does
 * `fcu->flag ^= FCURVE_VISIBLE`. Because SS stores the negative
 * (`hide`), the implementation is `fc.hide = !isFCurveHidden(fc)`.
 *
 * Single-curve operation: no peer interaction. Does not clear
 * `selected`, `activeKeyformIndex`, or the editor-local keyform-pick
 * map — those persist across hide/unhide cycles (matches Blender's
 * per-row toggle path; see module header).
 *
 * Returns the post-toggle value so the caller can update sidebar UI
 * (eye glyph, color-square alpha) without re-reading the fcurve.
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {string} fcurveId
 * @returns {{ hiddenNow: boolean }}
 */
export function toggleFCurveHidden(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { hiddenNow: false };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return { hiddenNow: false };
  fc.hide = !isFCurveHidden(fc);
  return { hiddenNow: fc.hide === true };
}

/**
 * Bulk hide — port of `GRAPH_OT_hide` (`space_graph/graph_ops.cc:226-318`).
 *
 * Keymap (`blender_default.py:1967` → `_template_items_hide_reveal_actions`
 * at `:461-466`):
 *   - **H**       → `graph.hide` with `unselected=false` (hide selected)
 *   - **Shift+H** → `graph.hide` with `unselected=true`  (hide unselected
 *                   = isolate selected)
 *
 * Blender's `graphview_curves_hide_exec` runs in two phases:
 *
 * **Phase 1** (`graph_ops.cc:247-282`): walk currently visible curves
 * filtered by `unselected ? ANIMFILTER_UNSEL : ANIMFILTER_SEL`. For each
 * matched curve set `ACHANNEL_SETTING_VISIBLE` to CLEAR (hide it) AND
 * `ACHANNEL_SETTING_SELECT` to CLEAR (deselect it). The deselect is not
 * incidental — it's the same `ANIM_channel_setting_set` call right
 * after the hide.
 *
 * **Phase 2** (`graph_ops.cc:284-312`): ONLY when `unselected=true`.
 * Walk all selected curves (no visibility filter) and set both
 * VISIBLE and SELECT to ADD. The effect: the user pressed Shift+H to
 * isolate their selection — after the visibility flip, their selected
 * curves are guaranteed visible+selected (in case Phase 1's flush
 * touched them through the group hierarchy SS doesn't have yet).
 *
 * # SS port
 *
 * SS has no `ANIMFILTER_LIST_CHANNELS` / `ANIM_flush_setting_anim_channels`
 * — there's no FCurveGroup datablock yet (cf. `fcurveMute.js`'s AGRP
 * deferral). Without group flushing, Phase 2's re-ensure step is a
 * defensive no-op: SS's Phase 1 only touches FCurves matching the
 * filter, so a selected curve cannot have been wrongly hidden. The
 * helper still runs the Phase 2 re-ensure for byte-faithfulness — it
 * IS a no-op today (asserted in tests), and will start mattering when
 * group flush ships.
 *
 * # SS deviations
 *
 * **Deviation 1 — no "active curve" handling.** SS has no per-FCurve
 * ACTIVE slot (same deferral as Slice 5.K MED-A1, 5.L Deviation 2 —
 * tracked under `project_ss_is_embryo`). Blender's `FCURVE_ACTIVE` is
 * cleared by `ANIM_set_active_channel` and the composite
 * `deselect_all_fcurves(hide=true)` path
 * (`anim_channels_edit.cc:5411-5428`) — neither of which is called
 * by `graphview_curves_hide_exec` itself. `ANIM_channel_setting_set`
 * is a pure bit-flip (`anim_channels_defines.cc:4993-5041`) with no
 * post-update callback for the FCurve type. So the operational gap
 * here only manifests once SS ships the higher-level composite paths
 * that DO clear ACTIVE; per-row hide today doesn't lose anything.
 * Audit-fix LOW-B1 (Slice 5.M dual-audit 2026-05-17): tightened the
 * causal attribution that was inaccurate in the original draft.
 *
 * **Deviation 2 — no Industry-Compatible keymap support.** SS hard-
 * codes the Blender-default keymap bindings (bare H / Shift+H /
 * Alt+H). The Industry-Compatible preset
 * (`industry_compatible_data.py:919-923`) binds hide to **Ctrl+H**
 * (not bare H), keeping Shift+H and Alt+H. Users on the IC preset
 * pressing Ctrl+H expect hide; SS sees an unbound key. Documented
 * but not wired — SS doesn't have a keymap-preset selector yet, so
 * wiring both variants per Rule №2 would be migration baggage.
 * Audit-fix MED-B1 (Slice 5.M dual-audit 2026-05-17): documented
 * the divergence; closure pending an SS keymap-preset feature.
 *
 * @param {object} action — Action datablock (mutated in place)
 * @param {{ unselected: boolean }} opts
 * @returns {{ changed: boolean, hiddenCount: number, deselectedCount: number, reShowCount: number }}
 *   `changed` = any flag write occurred. `hiddenCount` = curves whose
 *   `hide` flipped false→true. `deselectedCount` = curves whose
 *   `selected` flipped true→false. `reShowCount` = Phase 2 curves
 *   re-shown (today always 0; will populate when group flush ships).
 */
/**
 * Read-only preflight for {@link applyHideFCurves}.
 *
 * Returns true iff calling `applyHideFCurves(action, opts)` would
 * mutate any field. Mirrors the mutation logic exactly but without
 * any writes. Audit-fix HIGH-A1 (Slice 5.M dual-audit 2026-05-17):
 * the dispatcher in FCurveEditor.jsx now calls this BEFORE
 * `update(recipe)` so a no-op H/Shift+H press doesn't burn a
 * phantom undo slot (`updateProject` at `projectStore.js:230-232`
 * pushes the snapshot unconditionally before the recipe runs).
 *
 * @param {object | null | undefined} action
 * @param {{ unselected: boolean } | null | undefined} opts
 * @returns {boolean}
 */
export function wouldHideChangeFCurves(action, opts) {
  if (!action || !Array.isArray(action.fcurves)) return false;
  if (!opts || typeof opts.unselected !== 'boolean') return false;
  const unselected = opts.unselected;

  // Phase 1 read: would any filtered curve flip a flag?
  for (const fc of action.fcurves) {
    if (!fc) continue;
    if (isFCurveHidden(fc)) continue;
    const sel = fc.selected === true;
    const match = unselected ? !sel : sel;
    if (!match) continue;
    if (fc.hide !== true) return true;
    if (fc.selected === true) return true;
  }

  // Phase 2 read (unselected=true only): would any selected curve
  // need to be un-hidden? (Re-select branch is a no-op by
  // construction — we filtered on `selected === true`.)
  if (unselected) {
    for (const fc of action.fcurves) {
      if (!fc) continue;
      if (fc.selected !== true) continue;
      if (fc.hide === true) return true;
    }
  }

  return false;
}

/**
 * Read-only preflight for {@link applyRevealFCurves}.
 *
 * Returns true iff calling `applyRevealFCurves(action, opts)` would
 * mutate any field. Mirrors mutation logic without writes. Same
 * undo-budget rationale as {@link wouldHideChangeFCurves}.
 *
 * @param {object | null | undefined} action
 * @param {{ select: boolean } | null | undefined} opts
 * @returns {boolean}
 */
export function wouldRevealChangeFCurves(action, opts) {
  if (!action || !Array.isArray(action.fcurves)) return false;
  if (!opts || typeof opts.select !== 'boolean') return false;
  const select = opts.select;
  const wantSelected = select === true;
  for (const fc of action.fcurves) {
    if (!fc) continue;
    if (!isFCurveHidden(fc)) continue;
    // Will flip hide false (always) and may flip selected (gated).
    // Either side suffices to return true.
    if (fc.hide === true) return true;
    if ((fc.selected === true) !== wantSelected) return true;
  }
  return false;
}

export function applyHideFCurves(action, opts) {
  const result = { changed: false, hiddenCount: 0, deselectedCount: 0, reShowCount: 0 };
  if (!action || !Array.isArray(action.fcurves)) return result;
  if (!opts || typeof opts.unselected !== 'boolean') return result;
  const unselected = opts.unselected;

  // Phase 1: filter visible curves by selection state, hide + deselect.
  for (const fc of action.fcurves) {
    if (!fc) continue;
    if (isFCurveHidden(fc)) continue;                 // ANIMFILTER_CURVE_VISIBLE
    const sel = fc.selected === true;
    const match = unselected ? !sel : sel;            // ANIMFILTER_UNSEL vs SEL
    if (!match) continue;
    if (fc.hide !== true) {
      fc.hide = true;
      result.hiddenCount++;
      result.changed = true;
    }
    if (fc.selected === true) {
      fc.selected = false;
      result.deselectedCount++;
      result.changed = true;
    }
  }

  // Phase 2 (unselected=true only): re-ensure selected curves are
  // visible+selected. Today a no-op without FCurveGroup flushing —
  // see module header / Phase 2 doc above.
  if (unselected) {
    for (const fc of action.fcurves) {
      if (!fc) continue;
      if (fc.selected !== true) continue;
      let reShown = false;
      if (fc.hide === true) {
        fc.hide = false;
        reShown = true;
        result.changed = true;
      }
      if (reShown) result.reShowCount++;
      // Selected re-ensure is already a no-op: we filtered on
      // `selected === true`, so we can't write a true we don't have.
    }
  }

  return result;
}

/**
 * Bulk reveal — port of `GRAPH_OT_reveal` (`space_graph/graph_ops.cc:341-402`).
 *
 * Keymap (`blender_default.py:1967` → `_template_items_hide_reveal_actions`
 * at `:461-466`, line `:463`):
 *   - **Alt+H** → `graph.reveal` (no properties → `select` defaults true)
 *
 * Blender's `graphview_curves_reveal_exec` walks all curves and for
 * each: if currently NOT visible, ALSO set SELECT to ADD-or-CLEAR
 * (gated by `select` RNA prop, default true); always set VISIBLE to
 * ADD. Curves that were already visible are NOT affected in their
 * selection state — only previously-hidden curves get the SELECT
 * write. This matches the user intent: "show me the hidden things
 * AND select them so I can immediately act on them."
 *
 * Note Blender's RNA default — `RNA_def_boolean(.., "select", true, ..)`
 * at `graph_ops.cc:418`. The Alt+H keymap entry binds the operator
 * with NO properties (`blender_default.py:463`), so the default value
 * applies. The user-callable `bpy.ops.graph.reveal(select=False)`
 * variant exists but no SS UI surfaces it today.
 *
 * @param {object} action — Action datablock (mutated in place)
 * @param {{ select: boolean }} opts
 * @returns {{ changed: boolean, revealedCount: number, selectedCount: number }}
 *   `revealedCount` = curves whose `hide` flipped true→false.
 *   `selectedCount` = curves whose `selected` was written (only for
 *   curves that WERE hidden — matches Blender's gate at `:379-383`).
 */
export function applyRevealFCurves(action, opts) {
  const result = { changed: false, revealedCount: 0, selectedCount: 0 };
  if (!action || !Array.isArray(action.fcurves)) return result;
  if (!opts || typeof opts.select !== 'boolean') return result;
  const select = opts.select;

  for (const fc of action.fcurves) {
    if (!fc) continue;
    const wasHidden = isFCurveHidden(fc);
    if (wasHidden) {
      // Selection write is gated on previous hidden state —
      // `graph_ops.cc:379-383`. Setting `selected=false` explicitly
      // when select=false matches Blender's `ACHANNEL_SETFLAG_CLEAR`
      // branch; it does NOT drop selection of already-visible curves
      // (those skip this branch via the `wasHidden` gate). Sparse-
      // field handled implicitly: `fc.selected === true` is false
      // for both undefined and explicit false, so when
      // wantSelected=false we don't unnecessarily write false onto
      // an already-sparse field.
      const wantSelected = select === true;
      if ((fc.selected === true) !== wantSelected) {
        fc.selected = wantSelected;
        result.selectedCount++;
        result.changed = true;
      }
      fc.hide = false;
      result.revealedCount++;
      result.changed = true;
    }
  }

  return result;
}
