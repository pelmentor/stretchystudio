// @ts-check

/**
 * Animation Phase 5 Slice 5.G — Channel mute helper.
 *
 * Pure mutation helper for the per-FCurve `mute` boolean — Blender's
 * `FCURVE_MUTED` bit (`DNA_anim_enums.h:303-314`). Independent from
 * `FCURVE_SELECTED` (channel selection, Slice 5.F) and `FCURVE_VISIBLE`
 * (Graph Editor row eye-toggle, still local-React in SS).
 *
 * # Blender semantics ported
 *
 * The flag has two distinct caller sites:
 *
 *   - **Eval gate** — `is_fcurve_evaluatable` at
 *     `reference/blender/source/blender/animrig/intern/evaluation.cc:95-111`
 *     returns `false` when `fcu->flag & FCURVE_MUTED`, short-circuiting
 *     the entire `calculate_fcurve` path. The animation evaluator
 *     (`animsys_eval_fcurves`, `evaluate_action_fcurves`) walks each
 *     curve and SKIPS muted curves — the bound property keeps its prior
 *     value rather than getting overwritten with anything.
 *
 *     Audit note (Slice 5.G dual-audit 2026-05-16, HIGH-B1): SS mirrors
 *     the **animrig** copy of `is_fcurve_evaluatable` (at evaluation.cc
 *     line 95), NOT the older `blenkernel/intern/anim_sys.cc:345` copy.
 *     The animrig version is documented as "Copy of the same-named
 *     function in anim_sys.cc, with the check on action groups removed"
 *     and per Blender issue #135666 the `FCURVE_DISABLED` check is also
 *     intentionally excluded (those curves may still be evaluatable for
 *     other users of the same slot). SS reaches the same outcome a
 *     different way: `decodeAllFCurves` filters unresolvable targets at
 *     decode time, so an SS equivalent of `FCURVE_DISABLED` isn't load-
 *     bearing today.
 *
 *     Driver evaluation gates the same way at
 *     `blenkernel/intern/anim_sys.cc:916` and `:4302`
 *     (`BKE_animsys_eval_driver`) — a muted driver curve doesn't fire.
 *     Important: SS's `evaluateFCurve` calls `evaluateDriver` inline as
 *     step 2, so caller-side gating (skipping the whole `evaluateFCurve`
 *     call) correctly stops driver firing without per-driver plumbing.
 *
 *   - **Render hint** — `graph_draw.cc:1190-1194` greys the F-Curve
 *     stroke (`immUniformThemeColorShade(TH_HEADER, 50)`) when the curve
 *     OR its containing channel group is muted. SS's Graph Editor port
 *     surfaces this via the decoded row's `isMuted` flag; muted curves
 *     still draw (greyed) instead of being hidden.
 *
 *   - **Channel sidebar setting** — `anim_channels_defines.cc:1124-1125`
 *     wires `ACHANNEL_SETTING_MUTE` ↔ `FCURVE_MUTED` for the F-Curve
 *     channel type. The Python API spells it `fcurve.mute` per RNA
 *     (`rna_fcurve.cc:2690-2691`), which is the field name SS adopts.
 *     The operator `ANIM_OT_channels_setting_toggle`
 *     (`anim_channels_edit.cc:3105`) carries `OPTYPE_REGISTER |
 *     OPTYPE_UNDO`, so Blender registers mute changes in its undo
 *     stack — SS matches by calling `update(recipe)` without
 *     `skipHistory:true`.
 *
 * # SS-deferred: group-level mute (`AGRP_MUTED`)
 *
 * Blender's older `is_fcurve_evaluatable` copy in
 * `blenkernel/intern/anim_sys.cc:345-356` also short-circuits when
 * `fcu->grp && (fcu->grp->flag & AGRP_MUTED)` — the FCurve's
 * containing channel group is muted. SS does NOT implement this
 * because the v40 schema has no FCurveGroup datablock yet (action
 * groups will land with the Dopesheet channel-grouping phase). When
 * groups ship, this header's eval gate needs to grow a sister check
 * (`isFCurveGroupMuted(fc.grp)`) and the sidebar needs a per-group
 * mute toggle. Documented as Slice 5.G dual-audit MED-B2 (2026-05-16)
 * to keep the gap from silently persisting once groups arrive.
 *
 * # Eval gate placement — at the caller, not inside evaluateFCurve
 *
 * `evaluateFCurve(fc, time)` returns a number; "muted → skip evaluation"
 * is NOT representable as a return value (returning 0 silently corrupts
 * the bound parameter, returning NaN works but is a sideband signal
 * downstream callers wouldn't otherwise produce). Per Blender's pattern,
 * the right place to gate is in the caller's iteration:
 *
 *   for (const fc of action.fcurves) {
 *     if (isFCurveMuted(fc)) continue;
 *     const v = evaluateFCurve(fc, t);
 *     ...
 *   }
 *
 * That's what `evaluateActionFCurves` (animationFCurve.js) and
 * `kernelFCurveEval` (depgraph/kernels/fcurve.js) do post-Slice 5.G.
 *
 * `evaluateFCurve` itself stays unit-of-evaluation pure: given an fcurve
 * + time, it computes the value. Mute is a higher-level eval-plan
 * concern (which curves participate in this frame's update). The
 * separation also keeps `evaluateFCurve` usable for the Graph Editor
 * render path, which DOES want to sample muted curves (so they draw
 * greyed in the plot — Blender does the same).
 *
 * # Schema & migration
 *
 * No migration ships with this slice. `fcurve.mute` is a sparse
 * boolean: missing in v39-and-older saves, treated as `false` by
 * `isFCurveMuted`. Per `feedback_no_migration_baggage_rule_two`, a
 * v40 migration writing `mute: false` onto every fcurve would be pure
 * noise — the reader collapses tri-state (`true` / `false` / missing)
 * into a clean boolean already.
 *
 * Mute IS in the project undo history (unlike Slice 5.F's selection
 * field): it changes which curves actually drive properties, so it's
 * data not view state. Blender records mute toggles in the undo stack
 * for the same reason. The sidebar mute click calls `update(recipe)`
 * without `skipHistory:true`.
 *
 * @module anim/fcurveMute
 */

/**
 * Read accessor for `FCURVE_MUTED`.
 *
 * Strict `=== true` check: defensive against accidental writes of
 * `1`/`"yes"`/non-boolean truthy values that aren't part of the
 * contract. Mirrors `isFCurveSelected` (Slice 5.F).
 *
 * @param {object|null|undefined} fcurve
 * @returns {boolean}
 */
export function isFCurveMuted(fcurve) {
  return !!(fcurve && fcurve.mute === true);
}

/**
 * Toggle the per-FCurve mute bit in-place.
 *
 * Mirrors Blender's `ACHANNEL_SETTING_TOGGLE` write through
 * `acf_fcurve_setting_flag` (returns `FCURVE_MUTED`) → caller does
 * `fcu->flag ^= FCURVE_MUTED`. Single-curve operation: no peer
 * interaction (unlike Slice 5.F's 'replace' branch, which clears
 * peers).
 *
 * Returns the post-toggle value so the caller can update local state
 * (button label, tooltip) without re-reading the fcurve.
 *
 * @param {object} action — the Action datablock (mutated)
 * @param {string} fcurveId
 * @returns {{ mutedNow: boolean }}
 */
export function toggleFCurveMute(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { mutedNow: false };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return { mutedNow: false };
  fc.mute = !isFCurveMuted(fc);
  return { mutedNow: fc.mute === true };
}

/**
 * Resolve a TOGGLE bulk-mute mode against the current selection state.
 *
 * Mirrors Blender's scan-first TOGGLE branch in `setflag_anim_channels`
 * at `anim_channels_edit.cc:2968-2980`:
 *
 *     if (mode == ACHANNEL_SETFLAG_TOGGLE) {
 *       mode = ACHANNEL_SETFLAG_ADD;
 *       for (bAnimListElem &ale : anim_data) {
 *         if (ANIM_channel_setting_get(ac, &ale, setting) > 0) {
 *           mode = ACHANNEL_SETFLAG_CLEAR;
 *           break;
 *         }
 *       }
 *     }
 *
 * The default direction is ADD (mute all); if any selected channel is
 * already muted, the direction flips to CLEAR (unmute all). The result
 * is uniform: after the operator, every selected channel is in the same
 * mute state — either all muted or all unmuted. This is the standard
 * Blender bulk-toggle convention (sister to box-select-toggle).
 *
 * Factored out so the preflight reader and the mutator share a single
 * resolution function: drift between the two would re-introduce the
 * Slice 5.M HIGH-A1 phantom-undo class of bug.
 *
 * @param {Array<object>} selectedFCurves
 * @returns {'enable' | 'disable'}
 */
function resolveToggleDirection(selectedFCurves) {
  for (const fc of selectedFCurves) {
    if (isFCurveMuted(fc)) return 'disable';
  }
  return 'enable';
}

/**
 * Collect every selected fcurve (`fc.selected === true`) into a flat
 * array. Mirrors Blender's `ANIMFILTER_SEL` filter (added when
 * `onlysel=true` at `anim_channels_edit.cc:2961-2963`).
 *
 * Note: NO `isFCurveHidden` skip here. The sidebar W keymap uses
 * `ANIMFILTER_LIST_VISIBLE` (row-visible) not `ANIMFILTER_CURVE_VISIBLE`
 * (plot-visible); hidden curves still appear in the sidebar and remain
 * mutable via Shift+W. Confirmed against the sidebar's `km_animation_channels`
 * filter resolution at `anim_channels_edit.cc:2956-2960`.
 *
 * @param {object} action
 * @returns {Array<object>}
 */
function collectSelectedFCurves(action) {
  const out = [];
  if (!action || !Array.isArray(action.fcurves)) return out;
  for (const fc of action.fcurves) {
    if (fc && fc.selected === true) out.push(fc);
  }
  return out;
}

/**
 * Read-only preflight for {@link applyChannelMuteSelected}.
 *
 * Returns true iff calling `applyChannelMuteSelected(action, mode)`
 * would mutate any field. Mirrors the mutation logic exactly without
 * writes. Same phantom-undo rationale as Slice 5.M's
 * `wouldHideChangeFCurves`: `updateProject` at `projectStore.js:230-232`
 * pushes the snapshot unconditionally before the recipe runs, so a no-op
 * Shift+W with nothing selected (or with all selected curves already in
 * the target state) would otherwise consume an undo slot.
 *
 * Important TOGGLE invariant: with at least one selected fcurve, TOGGLE
 * is guaranteed to change at least one curve. The scan-first resolution
 * picks the direction that OPPOSES at least one current state — uniform
 * input flips all; mixed input flips the minority. So
 * `wouldChannelMuteSelectedChange(action, 'toggle')` is equivalent to
 * `collectSelectedFCurves(action).length > 0`.
 *
 * @param {object | null | undefined} action
 * @param {'toggle' | 'enable' | 'disable'} mode
 * @returns {boolean}
 */
export function wouldChannelMuteSelectedChange(action, mode) {
  if (mode !== 'toggle' && mode !== 'enable' && mode !== 'disable') return false;
  const selected = collectSelectedFCurves(action);
  if (selected.length === 0) return false;
  const effective = mode === 'toggle' ? resolveToggleDirection(selected) : mode;
  const wantMuted = effective === 'enable';
  for (const fc of selected) {
    if (isFCurveMuted(fc) !== wantMuted) return true;
  }
  return false;
}

/**
 * Bulk-mute every selected FCurve — port of `setflag_anim_channels`
 * (`anim_channels_edit.cc:2923-3001`) parameterised for
 * `ACHANNEL_SETTING_MUTE`. Backs the three sidebar keymap entries at
 * `blender_default.py:3876-3878`:
 *
 *   - Shift+W       → `anim.channels_setting_toggle` → mode='toggle'
 *   - Ctrl+Shift+W  → `anim.channels_setting_enable` → mode='enable'
 *   - Alt+W         → `anim.channels_setting_disable` → mode='disable'
 *
 * # Three modes
 *
 * - **`'enable'`** (Ctrl+Shift+W) — set `mute=true` on every selected
 *   curve. Mirrors `ACHANNEL_SETFLAG_ADD`. Curves already muted stay
 *   muted (no spurious flag rewrite).
 * - **`'disable'`** (Alt+W) — set `mute=false` on every selected curve.
 *   Mirrors `ACHANNEL_SETFLAG_CLEAR`.
 * - **`'toggle'`** (Shift+W) — scan-first resolution; see
 *   {@link resolveToggleDirection}.
 *
 * # SS-skipped surfaces
 *
 * **The type-picker menu.** In Blender each of the three operators
 * calls `WM_menu_invoke` which pops the `prop_animchannel_settings_types`
 * enum picker (`anim_channels_edit.cc:2907-2911`): `{PROTECT, MUTE}`.
 * The user selects which setting to act on, then the exec runs. SS
 * has only `fcurve.mute` today — `fcurve.protected` is not ported (no
 * keyform-edit-protection bit exists yet). The picker with one option
 * is degenerate UX, so this slice routes Shift+W / Ctrl+Shift+W / Alt+W
 * DIRECTLY to mute without intermediate UI. When PROTECT lands as its
 * own slice, that slice must:
 *   1. Build a popup menu primitive (no menu UI exists in
 *      FCurveEditor today — context menus + handle-type-pick are
 *      different patterns).
 *   2. Re-route the W keymap branches through it.
 *   3. Add a PROTECT row to the menu enum.
 * Documented as Deviation 1 below to keep the gap from rotting.
 *
 * **Group flushing.** `setflag_anim_channels` at line 2994-2996 calls
 * `ANIM_flush_setting_anim_channels` after each per-channel write to
 * propagate the setting through FCurveGroup hierarchy (group toggle
 * cascades to children, etc.). SS has no FCurveGroup datablock yet
 * (sister to AGRP_MUTED gap in this same module's header) — flushing
 * is genuinely a no-op today, not a TODO. When groups ship, this
 * helper needs to grow a flush pass post-mutation.
 *
 * **`tag_update_animation_element`.** Blender tags the data-block for
 * depgraph re-evaluation per channel touched (line 2991). SS achieves
 * the same end via `updateProject` invalidating the action and the
 * top-level depgraph recompute that follows. No per-channel tag call
 * needed at the helper level — it's the dispatcher's responsibility.
 *
 * # SS deviations (cumulative — closes when conditions met)
 *
 * **Deviation 1 — no type-picker menu.** See SS-skipped above. Closure:
 * SS ships PROTECT (fcurve.protected) AND a popup-menu primitive,
 * THEN W keymap branches re-route through the menu. Tracked under
 * `project_ss_is_embryo` (PROTECT) + the new Slice 5.O #18 queued
 * path (popup-menu primitive).
 *
 * **Deviation 2 — no Industry-Compatible keymap support.** SS hard-codes
 * the Blender-default W bindings. Industry-Compatible
 * (`industry_compatible_data.py`) doesn't appear to remap W today, so
 * this is the SAME deviation as Slice 5.M Deviation 2 / Slice 5.N
 * Deviation 1 — gated on the not-yet-built SS keymap-preset selector.
 *
 * **Deviation 3 — no FCurveGroup flush.** See SS-skipped above. Sister
 * to AGRP_MUTED gap; closure tied to FCurveGroup datablock.
 *
 * # Why mute belongs to undo (not view state)
 *
 * Mirrors the module header rationale: mute changes which curves drive
 * properties, so it's data not view state. Blender registers
 * `OPTYPE_UNDO` on all three operators (`anim_channels_edit.cc:3053`,
 * `:3079`, `:3105`). SS calls `update(recipe)` WITHOUT `skipHistory:true`
 * — same as the sister Slice 5.M / Slice 5.N dispatchers.
 *
 * @param {object} action — Action datablock (mutated in place)
 * @param {'toggle' | 'enable' | 'disable'} mode
 * @returns {{ changed: boolean, mutedCount: number, unmutedCount: number, resolvedMode: 'enable' | 'disable' | null }}
 *   `changed` = any flag write occurred. `mutedCount` = curves whose
 *   `mute` flipped (any non-true) → true. `unmutedCount` = curves whose
 *   `mute` flipped true → false. `resolvedMode` = the post-resolution
 *   direction actually applied (TOGGLE turns into 'enable' or 'disable';
 *   null only when no selected curves / invalid mode).
 */
export function applyChannelMuteSelected(action, mode) {
  /** @type {{ changed: boolean, mutedCount: number, unmutedCount: number, resolvedMode: 'enable' | 'disable' | null }} */
  const result = { changed: false, mutedCount: 0, unmutedCount: 0, resolvedMode: null };
  if (mode !== 'toggle' && mode !== 'enable' && mode !== 'disable') return result;
  const selected = collectSelectedFCurves(action);
  if (selected.length === 0) return result;

  /** @type {'enable' | 'disable'} */
  const effective = mode === 'toggle' ? resolveToggleDirection(selected) : mode;
  result.resolvedMode = effective;
  const wantMuted = effective === 'enable';

  for (const fc of selected) {
    const wasMuted = isFCurveMuted(fc);
    if (wasMuted === wantMuted) continue;
    fc.mute = wantMuted;
    result.changed = true;
    if (wantMuted) result.mutedCount++;
    else result.unmutedCount++;
  }
  return result;
}
