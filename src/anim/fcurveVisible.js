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
 * # SS-deferred Blender visibility operators
 *
 * Outside Slice 5.I's scope but documented here so the next
 * "Graph Editor keymap parity" slice doesn't have to re-discover them:
 *
 *   - **`GRAPH_OT_hide`** (`space_graph/graph_ops.cc:226-337`) — H
 *     keymap (hide selected curves), Shift+H (hide unselected via
 *     `unselected=true` flag). Iterates filtered channels and clears
 *     `FCURVE_VISIBLE` per-row.
 *   - **`GRAPH_OT_reveal`** (`space_graph/graph_ops.cc:341-419`) —
 *     Alt+H keymap (un-hide everything). Sets `FCURVE_VISIBLE` on
 *     every curve in the channel list.
 *   - **`setflag_anim_channels` with `ACHANNEL_SETTING_VISIBLE`** —
 *     channel-group hierarchical flushing (parent group → children).
 *     Gated on the not-yet-shipped FCurveGroup datablock; sister to
 *     the `AGRP_MUTED` flush gap already documented in
 *     [fcurveMute.js](./fcurveMute.js).
 *   - **`deselect_all_fcurves(hide=true)`** — composite
 *     deselect-and-hide already documented above.
 *
 * SS today only ships the per-row eye-toggle (the `ANIM_OT_channels_
 * setting_toggle` equivalent). Bulk operators are deferred until
 * sidebar selection state acquires a "selected channels" multi-pick
 * (Slice 5.F shipped the bit, bulk operators are still pending in
 * the resume queue).
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
