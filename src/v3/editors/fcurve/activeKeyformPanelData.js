// @ts-check

/**
 * Animation Phase 5 Slices 5.Q + 5.R — Active Keyframe N-panel data module.
 *
 * Pure data layer backing the FCurveEditor's "Active Keyframe" N-panel
 * section. Mirrors the data half of Blender's `graph_panel_key_properties`
 * (`reference/blender/source/blender/editors/space_graph/graph_buttons.cc:365-610`),
 * with the React rendering layered on top in `ActiveKeyformPanel.jsx`
 * (sister architecture to `fcurveFooterData.js` ↔ `FCurveEditor.FCurveFooter`).
 *
 * # What 5.Q shipped (MVP scope — always-on fields)
 *
 * Three fields editable per active keyform:
 *   1. **Interpolation** type (dropdown — full 13-entry Blender enum)
 *      — Blender: `graph_buttons.cc:410` (`bezt_ptr.prop("interpolation")`)
 *   2. **Key Frame** (X coordinate in ms — SS canonical time unit, see
 *      [feedback_ms_canonical_animation_time]) — Blender:
 *      `graph_buttons.cc:443-457` (`bezt_ptr.prop("co_ui", index=0)`)
 *   3. **Value** (Y coordinate) — Blender:
 *      `graph_buttons.cc:460-475` (`bezt_ptr.prop("co_ui", index=1)`)
 *
 * # What 5.R adds (conditional fields)
 *
 * Closes 5.Q Deviation 1. Adds the 4 conditional sections from
 * `graph_panel_key_properties`:
 *
 *   - **Left handle** (Type + Frame + Value) — visible only when the
 *     PREVIOUS keyform has `BEZT_IPO_BEZ` interpolation, since segment
 *     interp is segment-START-keyform's `ipo` and a bezier segment's
 *     incoming side reads the next keyform's `handleLeft` as a control
 *     point. Blender: `graph_buttons.cc:479-533`.
 *
 *   - **Right handle** (Type + Frame + Value) — visible only when the
 *     CURRENT keyform's `ipo == BEZT_IPO_BEZ` (its outgoing bezier
 *     segment uses this kf's `handleRight`). Blender:
 *     `graph_buttons.cc:536-591`.
 *
 *   - **Easing direction** (dropdown) — visible when the current
 *     keyform's `ipo > BEZT_IPO_BEZ` (named easings: back / bounce /
 *     circ / cubic / elastic / expo / quad / quart / quint / sine).
 *     Blender: `graph_buttons.cc:414-416` (`bezt_ptr.prop("easing")`).
 *     SS field is `easeMode` per the eval substrate
 *     ([fcurveEval.js:50-61](../../../anim/fcurveEval.js)).
 *
 *   - **Easing extras**:
 *       - `back` (overshoot) when current's `ipo == BEZT_IPO_BACK`
 *         — Blender: `graph_buttons.cc:419-423`.
 *       - `amplitude` + `period` when current's `ipo == BEZT_IPO_ELASTIC`
 *         — Blender: `graph_buttons.cc:425-430`.
 *
 * Handle coord edits route through `applyHandleDrag` (Slice 5.B helper)
 * which encodes the Blender-faithful side effects of
 * `BKE_nurb_bezt_handle_test` — AUTO/AUTO_ANIM → ALIGN on both sides,
 * VECT → FREE on the dragged side, opposite-side aligned mirror. That
 * matches the chain `graphedit_activekey_left/right_handle_coord_cb`
 * (`graph_buttons.cc:325-363`) → `graphedit_activekey_handles_cb`
 * (`:287-305`) → `BKE_nurb_bezt_handle_test` runs in Blender's path.
 * After the side-effect step we re-sort + recalc handles per the base
 * `graphedit_activekey_update_cb` (`:277-284`).
 *
 * # The active-keyform context resolution
 *
 * `resolveActiveKeyformContext(action, fcurveId)` mirrors Blender's
 * `get_active_fcurve_keyframe_edit` (`graph_buttons.cc:253-274`) which
 * resolves `(fcu, bezt, prevbezt)`. Slice 5.R extends the returned
 * shape with `prevKf` (the keyform at `kfIndex-1`, or null when the
 * active is the first kf — matches Blender's `max_ii(idx-1, 0)`
 * at `graph_buttons.cc:270` clamped via a null-on-zero check at the
 * call site since the conditional "show left handle" gate already
 * requires a real previous kf with `ipo == BEZT_IPO_BEZ`).
 *
 * The resolution chain:
 *   1. Find the FCurve by id (no match → null context).
 *   2. Read `activeKeyformIndex` via the Slice 5.H accessor
 *      `getActiveKeyformIndex` — handles bounds + missing-field guards.
 *   3. Sentinel `FCURVE_ACTIVE_KEYFORM_NONE` → null context.
 *   4. Otherwise return `{ fcurve, kfIndex, kf, prevKf }`.
 *
 * # Edit recipes — undo-coupled + sort-aware + auto-handle recalc
 *
 * Each edit is a mutator that runs inside `update(recipe)` (no
 * `skipHistory:true` — these are data writes, not view state; sister
 * to Slices 5.G/5.I/5.M/5.N/5.O/5.P which all flow through normal undo).
 *
 *   - **`applyEditKeyformValue`** — write `kf.value` THEN call
 *     `recalcKeyformHandles(fcurve.keyforms)`. Audit-fix HIGH-B1
 *     (Slice 5.Q dual-audit 2026-05-17): the initial substrate
 *     omitted the recalc with a wrong rationale ("handles_recalc
 *     only matters for handles which this MVP doesn't expose").
 *     Reality: AUTO/AUTO_ANIM handles' STORED tangent positions
 *     depend on neighboring keyframe values; skipping recalc on a
 *     value edit leaves the tangents stale → curve shape between
 *     this kf and its neighbors becomes wrong on AUTO-handle curves
 *     even though the panel never showed handles. Mirrors Blender's
 *     UNCONDITIONAL `BKE_fcurve_handles_recalc` call in
 *     `graphedit_activekey_update_cb` at `graph_buttons.cc:283`.
 *
 *   - **`applyEditKeyformFrame`** — capture active kf object → write
 *     `kf.time` → inline re-sort by time → relocate active index via
 *     `captureActiveKeyformObject` / `relocateActiveKeyformByObject`
 *     (Slice 5.H pattern) → recalc handles. Mirrors Blender's
 *     `sort_time_fcurve` + `BKE_fcurve_handles_recalc` pair at
 *     `graph_buttons.cc:282-283`.
 *
 *   - **`applyEditKeyformInterpolation`** — direct write to
 *     `kf.interpolation`. No sort, no handle recalc (interp type is
 *     the segment-shape choice; it doesn't change tangent positions
 *     and doesn't affect AUTO recalc inputs). The segment-level
 *     visual changes (the curve geometry between this kf and the
 *     next) update on re-render naturally via the `decoded` memo's
 *     `[action?.fcurves]` dep.
 *
 * # Preflight readers — phantom-undo gates
 *
 * Sister to Slices 5.M/5.N/5.O: every edit recipe has a paired
 * `wouldEdit*Change` preflight that mirrors mutation logic without
 * writes. The dispatcher checks BEFORE calling `update()` so a re-
 * commit of the same value (user types the existing value + Enter)
 * doesn't burn an undo slot. `projectStore.js:230-232` pushes the
 * pre-recipe snapshot unconditionally; preflight short-circuit is
 * the only way to avoid it.
 *
 * # SS deviations
 *
 * **Deviation 1 — MVP scope omits handle editing.** CLOSED in Slice
 * 5.R (this slice). Blender's 6 conditional sections from
 * `graph_panel_key_properties` are now all rendered when their
 * predicates fire. The 5.Q substrate kept this deviation explicit so
 * the closure point is traceable in the docstring.
 *
 * **Deviation 2 — no per-property unit conversion.** Blender's
 * `RNA_SUBTYPE_UNIT(RNA_property_subtype(fcu_prop))` machinery at
 * `graph_buttons.cc:399` reads the property's unit subtype (angle,
 * length, time, etc.) and applies conversion in the UI (e.g. radians
 * → degrees for rotation params). SS keyform values are raw floats
 * with no unit metadata on the bound parameter — the value field
 * shows whatever's stored, no conversion. Acceptable because SS's
 * parameter range conventions are uniform (0-1 sliders + bone
 * rotation in radians, both displayed as-is). Closure tied to a
 * future parameter-units system.
 *
 * **Deviation 3 (CLOSED Slice 5.T) — frame field now tracks the
 * View menu's "Use Timecode" toggle.** Blender's `co_ui` property is
 * always in frames regardless of `SIPO_DRAWTIME` (only the X-axis
 * grid changes). SS's Time row label + value flip together with the
 * toggle: `showSeconds=false` → "Frame" with integer frames at the
 * effective fps; `showSeconds=true` → "Time (s)" with decimal
 * seconds. Canonical storage stays ms
 * (see [feedback_ms_canonical_animation_time]); the display↔parse
 * layer lives in [fcurveTimeFormat.js](./fcurveTimeFormat.js). The
 * deviation that remains vs Blender is the field tracking the toggle
 * (Blender keeps the field in frames always) — see Slice 5.T
 * deviation 2 in `fcurveTimeFormat.js` for the rationale.
 *
 * **Deviation 4 — default-interpolation sparse-default 'linear'
 * (not Blender's BEZT_IPO_BEZ).** Blender's BezTriple default
 * interpolation is `BEZT_IPO_BEZ` (Bezier) — see
 * `reference/blender/source/blender/animrig/intern/fcurve.cc:29`
 * (`settings.interpolation = BEZT_IPO_BEZ`). SS treats a missing
 * `interpolation` field as `'linear'` for compute + display + the
 * preflight's same-value short-circuit. This divergence predates
 * Slice 5.Q (the convention is established across `evaluateFCurve`,
 * the timeline editor, and graphEditOps) but is surfaced explicitly
 * here because it affects: (a) the panel dropdown's apparent
 * "current" value for sparse keyforms, and (b) what counts as a no-
 * op when the user picks 'linear' from the dropdown (sparse→linear =
 * no-op; explicit bezier→linear = delete-the-field for sparse
 * discipline). Audit-fix MED-B3 (Slice 5.Q dual-audit 2026-05-17):
 * promoted from buried preflight comment to a named Deviation.
 * Closure tied to a future "match Blender defaults" sweep; not
 * gated on any single slice.
 *
 * @module v3/editors/fcurve/activeKeyformPanelData
 */

import {
  getActiveKeyformIndex,
  FCURVE_ACTIVE_KEYFORM_NONE,
  captureActiveKeyformObject,
  relocateActiveKeyformByObject,
} from '../../../anim/fcurveActiveKeyform.js';
import { recalcKeyformHandles } from '../../../anim/fcurveHandles.js';
import { applyHandleDrag } from '../../../anim/graphEditOps.js';

/**
 * Sparse-default for `kf.easeMode`. Mirrors Blender's `BEZT_IPO_EASE_AUTO`
 * (the eval substrate picks a per-easing-type default at evaluation time
 * via `DEFAULT_EASE_MODE` in `fcurveEval.js:50-61`). Surfaced as a
 * constant so the dropdown's "current" display, the preflight's same-
 * value short-circuit, and the mutator's delete-on-default branch all
 * agree on the canonical token. Blender enum:
 * `reference/blender/source/blender/makesdna/DNA_curve_enums.h:220-226`
 * (`eBezTriple_Easing` with `BEZT_IPO_EASE_AUTO = 0`). RNA dropdown
 * items: `reference/blender/source/blender/makesrna/intern/rna_fcurve.cc:118-143`
 * (`rna_enum_beztriple_interpolation_easing_items`). Audit-fix HIGH-B3
 * (Slice 5.R dual-audit 2026-05-17): original cite said `rna_curve.cc`,
 * actual enum lives in `rna_fcurve.cc:118`.
 */
const EASE_MODE_DEFAULT = 'auto';

/**
 * Sparse-defaults for `kf.back`, `kf.amplitude`, `kf.period`. Match
 * `DEFAULT_BACK_OVERSHOOT` / `DEFAULT_ELASTIC_AMPLITUDE` /
 * `DEFAULT_ELASTIC_PERIOD` at `fcurveEval.js:63-77`, which themselves
 * mirror Blender's BezTriple struct-initializer defaults at
 * `reference/blender/source/blender/animrig/intern/fcurve.cc:338-345`
 * (`back = 1.70158f`, `amplitude = 0.8f`, `period = 4.1f`). Audit-fix
 * HIGH-B1 (Slice 5.R dual-audit 2026-05-17): the prior cite
 * `fcurve.cc:29-36` was the `KeyframeSettings` block (interpolation
 * default), not the BezTriple BACK/AMPLITUDE/PERIOD defaults; the
 * amplitude/period values themselves were `0`/`0` since Phase 2.C (a
 * latent visual regression — ELASTIC curves evaluated to degenerate
 * straight lines) and got corrected in the same sweep.
 *
 * Sparse-discipline: writing the default DELETES the field rather than
 * persisting it, per Rule №2 (no migration baggage). The eval path
 * reads the field with `typeof ... === 'number'` guards and falls back
 * to the same constants when missing — round-trip safe.
 */
const BACK_DEFAULT = 1.70158;
const AMPLITUDE_DEFAULT = 0.8;
const PERIOD_DEFAULT = 4.1;

/**
 * Predicate matching Blender's `bezt->ipo > BEZT_IPO_BEZ` check at
 * `graph_buttons.cc:414`. Returns true for named easings (the 10
 * BLI_easing_* functions). Blender enum
 * `reference/blender/source/blender/makesdna/DNA_curve_enums.h:200-217`
 * (`eBezTriple_Interpolation`) orders the named easings AFTER
 * `BEZT_IPO_BEZ = 2`: BACK=3, BOUNCE=4, CIRC=5, CUBIC=6, ELASTIC=7,
 * EXPO=8, QUAD=9, QUART=10, QUINT=11, SINE=12. SS encodes these as
 * strings, so we test against the set of named easings directly.
 * Audit-fix HIGH-B2 (Slice 5.R dual-audit 2026-05-17): original cite
 * said `DNA_anim_enums.h` with a wrong enum order (SINE=3, ELASTIC=12);
 * the file is `DNA_curve_enums.h` and the order matches the verbatim
 * citation above.
 *
 * @param {string|undefined} ipo
 * @returns {boolean}
 */
function isEasingInterpolation(ipo) {
  if (typeof ipo !== 'string') return false;
  return ipo === 'sine' || ipo === 'quad' || ipo === 'cubic'
    || ipo === 'quart' || ipo === 'quint' || ipo === 'expo'
    || ipo === 'circ' || ipo === 'back' || ipo === 'bounce'
    || ipo === 'elastic';
}

/**
 * @typedef {{
 *   time: number,
 *   value: number,
 *   interpolation?: string,
 *   easeMode?: string,
 *   back?: number,
 *   amplitude?: number,
 *   period?: number,
 *   handleLeft?: { time: number, value: number },
 *   handleRight?: { time: number, value: number },
 *   handleType?: { left: string, right: string },
 * }} KeyformLike
 *
 * @typedef {{
 *   id: string,
 *   keyforms: Array<KeyformLike>,
 *   activeKeyformIndex?: number,
 * }} FCurveLike
 *
 * @typedef {{
 *   fcurve: FCurveLike,
 *   kfIndex: number,
 *   kf: KeyformLike,
 *   prevKf: KeyformLike|null,
 * }} ActiveKeyformContext
 */

/**
 * Resolve `(fcurve, kfIndex, kf)` for the active keyform on the named
 * FCurve, or `null` if no active keyform exists.
 *
 * Mirrors `get_active_fcurve_keyframe_edit` (`graph_buttons.cc:253-274`)
 * minus the `prevbezt` field (deferred to Slice 5.R with handle editing).
 *
 * Null-returns when:
 *   - `action` / `action.fcurves` missing
 *   - `fcurveId` doesn't match any fcurve
 *   - active index sentinel (= `FCURVE_ACTIVE_KEYFORM_NONE`)
 *   - the indexed keyform is missing (defensive — `getActiveKeyformIndex`
 *     does the bounds check, but the array slot could be sparse)
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @returns {ActiveKeyformContext|null}
 */
export function resolveActiveKeyformContext(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) return null;
  if (!fcurveId || typeof fcurveId !== 'string') return null;
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return null;
  const idx = getActiveKeyformIndex(fc);
  if (idx === FCURVE_ACTIVE_KEYFORM_NONE) return null;
  const kf = fc.keyforms[idx];
  if (!kf || typeof kf !== 'object') return null;
  // Slice 5.R — `prevKf` for the left-handle visibility predicate.
  //
  // Blender's `get_active_fcurve_keyframe_edit` (`graph_buttons.cc:270-271`)
  // computes `prev_index = max_ii(active_keyframe_index - 1, 0)` and
  // sets `*r_prevbezt = &fcu->bezt[prev_index]`, so for `idx=0` prevbezt
  // is the ACTIVE kf itself (self-as-prev). The visibility check at
  // `graph_buttons.cc:479` then fires for a first kf when its own `ipo`
  // is bezier — Blender shows the active kf's `handle_left` for editing.
  //
  // SS deviates: returns `null` for `idx=0` instead of the self-as-prev
  // sentinel, so the left-handle section stays hidden on the first kf.
  // STRICTER than Blender. Acceptable today because: (a) first-kf
  // left-handle is only meaningful for cyclic / wrapped curves, which
  // SS doesn't ship (Phase 3 F-Modifier `Cycles` queued); (b) the
  // outgoing right-handle of the active kf IS exposed when bezier (via
  // `shouldShowRightHandleSection`), which covers the only authorable
  // bezier surface for a non-cyclic first keyform. Audit-fix LOW-B2
  // (Slice 5.R dual-audit 2026-05-17) corrected the prior overclaim
  // "identical without the awkward self-as-prev sentinel" → "stricter,
  // hides first-kf left-handle". Closure tied to F-Modifier `Cycles`
  // (Phase 3 of the Animation Blender-Parity Plan).
  const prevKf = idx > 0 ? (fc.keyforms[idx - 1] ?? null) : null;
  return { fcurve: fc, kfIndex: idx, kf, prevKf };
}

/**
 * Read-only preflight for {@link applyEditKeyformValue}.
 *
 * Returns true iff calling the mutator with `newValue` would change
 * `kf.value`. Strict number-equality compare — if the user re-types
 * the existing value and confirms, the preflight returns false and
 * the dispatcher skips `update()` entirely, preventing a phantom
 * undo entry.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {number} newValue
 * @returns {boolean}
 */
export function wouldEditKeyformValueChange(action, fcurveId, newValue) {
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  return ctx.kf.value !== newValue;
}

/**
 * Apply a value edit to the active keyform.
 *
 * Write `kf.value` then call `recalcKeyformHandles(fcurve.keyforms)`
 * to recompute AUTO/AUTO_ANIM handle tangent positions (their stored
 * positions depend on neighboring keyframe values). Mirrors Blender's
 * UNCONDITIONAL `BKE_fcurve_handles_recalc` call in
 * `graphedit_activekey_update_cb` at `graph_buttons.cc:283`. Audit-fix
 * HIGH-B1 (Slice 5.Q dual-audit 2026-05-17): initial substrate omitted
 * this with a wrong rationale; without it AUTO handles drift after
 * value edits and curve shape evaluates incorrectly.
 *
 * @param {object} action — Action datablock (mutated)
 * @param {string} fcurveId
 * @param {number} newValue
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformValue(action, fcurveId, newValue) {
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  if (ctx.kf.value === newValue) return { changed: false };
  ctx.kf.value = newValue;
  recalcKeyformHandles(ctx.fcurve.keyforms);
  return { changed: true };
}

/**
 * Read-only preflight for {@link applyEditKeyformFrame}.
 *
 * Returns true iff calling the mutator with `newTimeMs` would change
 * `kf.time`. Same rationale as value preflight.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {number} newTimeMs
 * @returns {boolean}
 */
export function wouldEditKeyformFrameChange(action, fcurveId, newTimeMs) {
  if (typeof newTimeMs !== 'number' || !Number.isFinite(newTimeMs)) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  return ctx.kf.time !== newTimeMs;
}

/**
 * Apply a frame (time) edit to the active keyform.
 *
 * Mirrors `graphedit_activekey_update_cb` (`graph_buttons.cc:277-284`)
 * which sorts then recalcs handles after every coord change:
 *
 *   ```c
 *   sort_time_fcurve(*fcu);
 *   BKE_fcurve_handles_recalc(*fcu);
 *   ```
 *
 * SS:
 *   1. Capture the active kf object reference (Slice 5.H pattern) so
 *      we can relocate the index after sort.
 *   2. Write `kf.time = newTimeMs`.
 *   3. Re-sort `fcurve.keyforms` by ascending time.
 *   4. Re-find the active index via object identity.
 *   5. Recalc handles (Audit-fix HIGH-B1 — see
 *      {@link applyEditKeyformValue}'s recalc rationale; for time
 *      edits the recalc matters even more because BOTH neighbors of
 *      the moved keyform may have changed).
 *
 * The capture-and-relocate pattern is more robust than index
 * arithmetic when the moved keyform crosses multiple neighbors — see
 * `captureActiveKeyformObject` JSDoc in `fcurveActiveKeyform.js` for
 * the full rationale.
 *
 * Returns the post-sort index so the caller can update editor-local
 * state (e.g. the panel reads the new index back via context refresh
 * on next render, but a tight numeric-edit loop benefits from the
 * synchronous return).
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {number} newTimeMs
 * @returns {{ changed: boolean, newIndex: number }}
 */
export function applyEditKeyformFrame(action, fcurveId, newTimeMs) {
  if (typeof newTimeMs !== 'number' || !Number.isFinite(newTimeMs)) {
    return { changed: false, newIndex: FCURVE_ACTIVE_KEYFORM_NONE };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false, newIndex: FCURVE_ACTIVE_KEYFORM_NONE };
  if (ctx.kf.time === newTimeMs) {
    return { changed: false, newIndex: ctx.kfIndex };
  }

  const captured = captureActiveKeyformObject(ctx.fcurve);
  ctx.kf.time = newTimeMs;
  // Inline sort — matches the TimelineEditor convention (see
  // src/v3/editors/timeline/TimelineEditor.jsx:841, :1042, :1069 for
  // the same `keyforms.sort((a, b) => a.time - b.time)` pattern).
  // No centralized helper exists today; keyforms.sort in place is the
  // established pattern.
  ctx.fcurve.keyforms.sort((a, b) => a.time - b.time);
  const { activeNow } = relocateActiveKeyformByObject(action, fcurveId, captured);
  // Audit-fix HIGH-B1: mirror Blender's `BKE_fcurve_handles_recalc`
  // at `graph_buttons.cc:283` (unconditional post-coord-edit recalc).
  recalcKeyformHandles(ctx.fcurve.keyforms);
  return { changed: true, newIndex: activeNow };
}

/**
 * Read-only preflight for {@link applyEditKeyformInterpolation}.
 *
 * Returns true iff calling the mutator with `newInterp` would change
 * `kf.interpolation`. Sparse-field tolerance: missing field collapses
 * to `'linear'` (SS default) for the comparison — typing 'linear'
 * onto a sparse field is a no-op.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {string} newInterp
 * @returns {boolean}
 */
export function wouldEditKeyformInterpolationChange(action, fcurveId, newInterp) {
  if (typeof newInterp !== 'string' || newInterp.length === 0) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  const current = ctx.kf.interpolation ?? 'linear';
  return current !== newInterp;
}

/**
 * Apply an interpolation type edit to the active keyform.
 *
 * Direct write to `kf.interpolation`. The segment-level visual
 * changes (curve geometry between this kf and the next) update on
 * re-render naturally via the `decoded` memo's `[action?.fcurves]`
 * dep — no explicit invalidation needed at this layer.
 *
 * Sparse-field discipline: if the new value matches the sparse-default
 * 'linear', we DELETE the field rather than writing 'linear' (keeps
 * the schema sparse per Rule №2 — no migration baggage). Future
 * sparse-default changes would need to update this same branch.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {string} newInterp — one of the 13 interpolation enum keys
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformInterpolation(action, fcurveId, newInterp) {
  if (typeof newInterp !== 'string' || newInterp.length === 0) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  const current = ctx.kf.interpolation ?? 'linear';
  if (current === newInterp) return { changed: false };
  if (newInterp === 'linear') {
    delete ctx.kf.interpolation;
  } else {
    ctx.kf.interpolation = newInterp;
  }
  return { changed: true };
}

// ── Slice 5.R: visibility predicates ────────────────────────────────────

/**
 * Should the left-handle section (Type + Frame + Value) render?
 *
 * Mirrors `graph_buttons.cc:479` — `(prevbezt) && (prevbezt->ipo ==
 * BEZT_IPO_BEZ)`. The left handle of the active keyform is the
 * INCOMING bezier control point for the segment `[prevKf, kf]`, and
 * Blender only exposes it when that segment is actually bezier.
 *
 * @param {ActiveKeyformContext|null} ctx
 * @returns {boolean}
 */
export function shouldShowLeftHandleSection(ctx) {
  if (!ctx || !ctx.prevKf) return false;
  return ctx.prevKf.interpolation === 'bezier';
}

/**
 * Should the right-handle section (Type + Frame + Value) render?
 *
 * Mirrors `graph_buttons.cc:536` — `bezt->ipo == BEZT_IPO_BEZ`. The
 * right handle is the OUTGOING bezier control point for the segment
 * `[kf, nextKf]`, which is bezier iff this kf's `ipo` is bezier.
 *
 * SS sparse-default for `interpolation` is `'linear'` (not Blender's
 * `BEZT_IPO_BEZ`; see Deviation 4) — so a sparse keyform displays no
 * right-handle section. Matches the Slice 5.Q interpolation dropdown
 * "current display" semantic: a kf with missing `interpolation` reads
 * as linear in every surface.
 *
 * @param {ActiveKeyformContext|null} ctx
 * @returns {boolean}
 */
export function shouldShowRightHandleSection(ctx) {
  if (!ctx) return false;
  return ctx.kf.interpolation === 'bezier';
}

/**
 * Should the easing-direction dropdown render?
 *
 * Mirrors `graph_buttons.cc:414` — `bezt->ipo > BEZT_IPO_BEZ`. The
 * 10 named easings (BACK=3 … SINE=12) all sit above BEZIER=2 in the
 * `eBezTriple_Interpolation` enum (see {@link isEasingInterpolation}
 * for the verified enum order from `DNA_curve_enums.h:200-217`).
 *
 * @param {ActiveKeyformContext|null} ctx
 * @returns {boolean}
 */
export function shouldShowEasingDirection(ctx) {
  if (!ctx) return false;
  return isEasingInterpolation(ctx.kf.interpolation);
}

/**
 * Should the BACK easing extras row render?
 *
 * Mirrors `graph_buttons.cc:420` — `case BEZT_IPO_BACK`.
 *
 * @param {ActiveKeyformContext|null} ctx
 * @returns {boolean}
 */
export function shouldShowBackExtras(ctx) {
  if (!ctx) return false;
  return ctx.kf.interpolation === 'back';
}

/**
 * Should the ELASTIC easing extras row render (amplitude + period)?
 *
 * Mirrors `graph_buttons.cc:425` — `case BEZT_IPO_ELASTIC`.
 *
 * @param {ActiveKeyformContext|null} ctx
 * @returns {boolean}
 */
export function shouldShowElasticExtras(ctx) {
  if (!ctx) return false;
  return ctx.kf.interpolation === 'elastic';
}

// ── Slice 5.R: handle type recipes ──────────────────────────────────────

/**
 * Read-only preflight for {@link applyEditKeyformHandleType}.
 *
 * Sparse-field tolerance: missing `handleType` (or the named side)
 * collapses to `'auto'` (SS default — matches `upsertKeyframe`'s
 * `handleType: { left: 'auto', right: 'auto' }` for bezier-interp
 * keyforms at `fcurve.js:197-199`).
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {'left'|'right'} side
 * @param {string} newType
 * @returns {boolean}
 */
export function wouldEditKeyformHandleTypeChange(action, fcurveId, side, newType) {
  if (side !== 'left' && side !== 'right') return false;
  if (typeof newType !== 'string' || newType.length === 0) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  const ht = ctx.kf.handleType ?? { left: 'auto', right: 'auto' };
  const current = ht[side] ?? 'auto';
  return current !== newType;
}

/**
 * Port of Blender's `BKE_fcurve_update_handle_flag_from_opposite`
 * (`reference/blender/source/blender/blenkernel/intern/fcurve.cc:1233-1267`).
 *
 * After the user picks a new handle type on one side via the N-panel
 * dropdown, normalize the opposite side so the pair remains coherent:
 *
 *   - source ∈ {AUTO, ALIGN, AUTO_ANIM, ALIGN_DOUBLESIDE}
 *     → target = source (forces matching type — e.g. picking ALIGN on
 *     LEFT promotes RIGHT to ALIGN so the aligned-handle mirror has a
 *     mathematical pair).
 *   - source ∈ {FREE, VECT}
 *     → if target ∉ {FREE, VECT}, set target = FREE (so a free/vect
 *     source isn't paired with an auto/aligned target whose recalc
 *     would silently steer the dragged handle).
 *
 * SS doesn't yet model `HD_ALIGN_DOUBLESIDE` (introduced for the
 * double-side aligned-handle work; not surfaced anywhere in SS today),
 * so the matching branch handles 'auto'/'aligned'/'auto_clamped'.
 *
 * Audit-fix MED-B3 (Slice 5.R dual-audit 2026-05-17): originally
 * documented as deferred ("requires the BezTriple selection-flag model
 * SS doesn't yet have"); re-reading `fcurve.cc:1233-1267` shows the
 * helper has zero selection-flag dependency — pure switch on source
 * → target write. Ported in the same audit-fix sweep.
 *
 * Pure helper — mutates `handleType` in place; caller is responsible
 * for the sparse-delete branch on the resulting state.
 *
 * @param {{ left: string, right: string }} handleType  mutated in place
 * @param {'left'|'right'} sourceSide
 */
function updateHandleFlagFromOpposite(handleType, sourceSide) {
  const source = sourceSide === 'left' ? handleType.left : handleType.right;
  const targetKey = sourceSide === 'left' ? 'right' : 'left';
  const target = handleType[targetKey];
  if (source === 'auto' || source === 'aligned' || source === 'auto_clamped') {
    handleType[targetKey] = source;
    return;
  }
  if (source === 'free' || source === 'vector') {
    if (target !== 'free' && target !== 'vector') {
      handleType[targetKey] = 'free';
    }
  }
}

/**
 * Apply a handle-type edit to one side of the active keyform.
 *
 * Mirrors Blender's `graphedit_activekey_handle_left_cb` /
 * `graphedit_activekey_handle_right_cb` (`graph_buttons.cc:307-319`):
 *
 *   1. Write the new handle type on the named side.
 *   2. Call `BKE_fcurve_update_handle_flag_from_opposite` (port at
 *      {@link updateHandleFlagFromOpposite}) so the opposite side stays
 *      coherent — e.g. picking ALIGN on LEFT promotes RIGHT to ALIGN.
 *   3. Re-sort + recalc handles (`graphedit_activekey_update_cb`,
 *      `graph_buttons.cc:282-283`). Sort is a no-op for type-only
 *      edits but kept for symmetry with the coord recipes.
 *
 * Sparse-field discipline: SS convention for `handleType` is whole-
 * object-or-nothing (see `upsertKeyframe` at `fcurve.js:197-199` and
 * `setHandleType` at `graphEditOps.js:531-541` — both write both sides
 * explicitly when the object exists; sparse means the field is absent).
 * If steps 1+2 leave BOTH sides on 'auto' (the sparse default), delete
 * the entire `handleType` field. Otherwise write the full dense pair.
 *
 * Audit-fix MED-A2 (Slice 5.R dual-audit 2026-05-17) initial pass
 * misread the audit recommendation as "per-side sparse"; the SS
 * convention is whole-object sparse, matching what every other
 * `handleType` writer in the codebase does. The current shape is the
 * audit-corrected version: only the both-sides-auto case deletes.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {'left'|'right'} side
 * @param {string} newType
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformHandleType(action, fcurveId, side, newType) {
  if (side !== 'left' && side !== 'right') return { changed: false };
  if (typeof newType !== 'string' || newType.length === 0) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  const ht = ctx.kf.handleType ?? { left: 'auto', right: 'auto' };
  const current = ht[side] ?? 'auto';
  if (current === newType) return { changed: false };

  const next = { left: ht.left ?? 'auto', right: ht.right ?? 'auto' };
  next[side] = newType;
  // Port of `BKE_fcurve_update_handle_flag_from_opposite` —
  // `graph_buttons.cc:309/316` calls this before the standard update.
  updateHandleFlagFromOpposite(next, side);

  if (next.left === 'auto' && next.right === 'auto') {
    delete ctx.kf.handleType;
  } else {
    ctx.kf.handleType = next;
  }
  // Post-edit recalc — matches the `graphedit_activekey_update_cb`
  // tail of the handle-cb chain (`graph_buttons.cc:311, 318`).
  recalcKeyformHandles(ctx.fcurve.keyforms);
  return { changed: true };
}

// ── Slice 5.R: handle coord recipes ─────────────────────────────────────

/**
 * Read the active keyform's handle coordinate on the named side, with
 * the sparse-default fallback `{time, value}` set to the keyform's own
 * coords (matches `upsertKeyframe`'s `handleLeft: {time, value}`
 * initialization at `fcurve.js:202-203`).
 *
 * Used by the panel to display the current handle position; surfaced as
 * a helper so the test suite can assert the sparse-default behaviour
 * without poking the React surface.
 *
 * @param {ActiveKeyformContext|null} ctx
 * @param {'left'|'right'} side
 * @returns {{ time: number, value: number } | null}
 */
export function readHandleCoord(ctx, side) {
  if (!ctx) return null;
  if (side !== 'left' && side !== 'right') return null;
  const h = side === 'left' ? ctx.kf.handleLeft : ctx.kf.handleRight;
  if (h && typeof h.time === 'number' && typeof h.value === 'number') {
    return { time: h.time, value: h.value };
  }
  return { time: ctx.kf.time, value: ctx.kf.value };
}

/**
 * Read-only preflight for {@link applyEditKeyformHandleCoord}.
 *
 * Builds the prospective handle point from the existing coord on the
 * unspecified axis, then compares against the current handle position.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {'left'|'right'} side
 * @param {'time'|'value'} axis
 * @param {number} newScalar
 * @returns {boolean}
 */
export function wouldEditKeyformHandleCoordChange(action, fcurveId, side, axis, newScalar) {
  if (side !== 'left' && side !== 'right') return false;
  if (axis !== 'time' && axis !== 'value') return false;
  if (typeof newScalar !== 'number' || !Number.isFinite(newScalar)) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  const current = readHandleCoord(ctx, side);
  if (!current) return false;
  return current[axis] !== newScalar;
}

/**
 * Apply a handle coord edit (one axis of one side) to the active
 * keyform.
 *
 * Routes through the Slice 5.B `applyHandleDrag` helper, which encodes
 * the Blender-faithful side effects of `BKE_nurb_bezt_handle_test`:
 *   - AUTO/AUTO_ANIM → ALIGN on BOTH sides if either was auto, so the
 *     next `recalcKeyformHandles` doesn't overwrite the user's edit.
 *   - VECT → FREE on the dragged side only.
 *   - Opposite-side aligned mirror through the keyform when the
 *     opposite type is ALIGN.
 *
 * This matches the chain Blender invokes for N-panel handle-coord
 * edits: `graphedit_activekey_left/right_handle_coord_cb`
 * (`graph_buttons.cc:325-363`) temporarily sets per-handle selection
 * flags then calls `graphedit_activekey_handles_cb`
 * (`graph_buttons.cc:287-305`), which forwards to
 * `BKE_nurb_bezt_handle_test`. SS doesn't model per-handle selection
 * flags (the editor's `selectedHandles` Map tracks selection but
 * isn't on the kf), so we call `applyHandleDrag` directly — same
 * end-effect for the single-side single-axis edit path the panel
 * dispatches.
 *
 * Audit-fix MED-B2 (Slice 5.R dual-audit 2026-05-17): Blender's
 * `BKE_nurb_bezt_handle_test_calc_flag` at `curve.cc:4073-4082` gates
 * VECT→FREE on partial-selection (XOR with the center flag); the SS
 * `applyHandleDrag` runs the conversion unconditionally. For the
 * N-panel edit path this is equivalent (each panel input is logically
 * a single-side single-axis change, i.e. partial selection in
 * Blender terms). Closure tied to a future Phase 5 slice that ports
 * the BezTriple selection-flag model.
 *
 * After the side effects, re-sort + recalc handles (matches
 * `graphedit_activekey_update_cb` at `graph_buttons.cc:282-283`). The
 * sort matters because a left-handle's `time` is permitted by Blender
 * to exceed the kf's `time` — but it doesn't reorder the keyform
 * array (only `kf.time` reorders that). Sorting is a no-op for handle-
 * only edits, but we run it for symmetry with the value/frame recipes
 * AND to defend against future axis fields that might re-key.
 *
 * Sparse-field discipline: we always write the full {time, value}
 * handle object (no per-axis sparse write) — Blender's vec is dense
 * and SS's handle objects are dense once present. We never delete the
 * handle object on edit (it remains as the user's last positioned
 * coord), only on the implicit auto-handle recalc which writes through
 * `recalcKeyformHandles`.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {'left'|'right'} side
 * @param {'time'|'value'} axis
 * @param {number} newScalar
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformHandleCoord(action, fcurveId, side, axis, newScalar) {
  if (side !== 'left' && side !== 'right') return { changed: false };
  if (axis !== 'time' && axis !== 'value') return { changed: false };
  if (typeof newScalar !== 'number' || !Number.isFinite(newScalar)) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  const current = readHandleCoord(ctx, side);
  if (!current || current[axis] === newScalar) return { changed: false };

  const newHandle = {
    time: axis === 'time' ? newScalar : current.time,
    value: axis === 'value' ? newScalar : current.value,
  };
  applyHandleDrag(ctx.kf, side, newHandle);
  // Mirror Blender's `graphedit_activekey_update_cb` tail
  // (`graph_buttons.cc:282-283`): re-sort then recalc handles.
  ctx.fcurve.keyforms.sort((a, b) => a.time - b.time);
  recalcKeyformHandles(ctx.fcurve.keyforms);
  return { changed: true };
}

// ── Slice 5.R: easing direction (easeMode) recipe ───────────────────────

/**
 * Read-only preflight for {@link applyEditKeyformEaseMode}.
 *
 * Sparse-field tolerance: missing `easeMode` collapses to `'auto'` for
 * the comparison — typing 'auto' onto a sparse field is a no-op.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {string} newMode — one of 'auto'|'in'|'out'|'inout'
 * @returns {boolean}
 */
export function wouldEditKeyformEaseModeChange(action, fcurveId, newMode) {
  if (typeof newMode !== 'string' || newMode.length === 0) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  const current = ctx.kf.easeMode ?? EASE_MODE_DEFAULT;
  return current !== newMode;
}

/**
 * Apply an easing-direction edit to the active keyform.
 *
 * Direct write to `kf.easeMode`. No sort, no handle recalc — the
 * easing direction (in/out/inout/auto) is a segment-shape choice
 * consumed by the evaluator at `fcurveEval.js:515-577` and changes
 * only the curve geometry between this kf and the next.
 *
 * Sparse-field discipline: if the new value matches the sparse-default
 * 'auto', we DELETE the field rather than writing 'auto' — keeps the
 * schema sparse per Rule №2.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {string} newMode
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformEaseMode(action, fcurveId, newMode) {
  if (typeof newMode !== 'string' || newMode.length === 0) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  const current = ctx.kf.easeMode ?? EASE_MODE_DEFAULT;
  if (current === newMode) return { changed: false };
  if (newMode === EASE_MODE_DEFAULT) {
    delete ctx.kf.easeMode;
  } else {
    ctx.kf.easeMode = newMode;
  }
  return { changed: true };
}

// ── Slice 5.R: easing extras recipes (back / amplitude / period) ────────

/**
 * Internal: dispatch table from easing-extras field name to its sparse-
 * default. Surfaced as a constant so the preflight + mutator share one
 * source of truth (preflight↔mutator drift impossible).
 */
const EASING_EXTRA_DEFAULTS = /** @type {const} */ ({
  back: BACK_DEFAULT,
  amplitude: AMPLITUDE_DEFAULT,
  period: PERIOD_DEFAULT,
});

/**
 * Read-only preflight for {@link applyEditKeyformEasingExtra}.
 *
 * Sparse-field tolerance: missing field collapses to the named
 * default — see {@link EASING_EXTRA_DEFAULTS}.
 *
 * @param {object|null|undefined} action
 * @param {string|null|undefined} fcurveId
 * @param {'back'|'amplitude'|'period'} field
 * @param {number} newValue
 * @returns {boolean}
 */
export function wouldEditKeyformEasingExtraChange(action, fcurveId, field, newValue) {
  if (!(field in EASING_EXTRA_DEFAULTS)) return false;
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) return false;
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return false;
  const current = typeof ctx.kf[field] === 'number'
    ? ctx.kf[field]
    : EASING_EXTRA_DEFAULTS[field];
  return current !== newValue;
}

/**
 * Apply an easing-extras edit (back / amplitude / period) to the
 * active keyform.
 *
 * Direct write to the named field. No sort, no handle recalc — these
 * are parameters of the BACK / ELASTIC easing functions consumed by
 * the evaluator at `fcurveEval.js:522-528` and change only the curve
 * geometry between this kf and the next.
 *
 * Sparse-field discipline: if the new value matches the sparse-default,
 * DELETE the field; otherwise write it. Mirrors Blender's BezTriple
 * struct-default behaviour (`fcurve.cc:29-36`) — fresh keyforms carry
 * the defaults implicitly via the struct initializer; SS achieves the
 * same via the read-side default fallback in `fcurveEval.js:522-528`.
 *
 * @param {object} action
 * @param {string} fcurveId
 * @param {'back'|'amplitude'|'period'} field
 * @param {number} newValue
 * @returns {{ changed: boolean }}
 */
export function applyEditKeyformEasingExtra(action, fcurveId, field, newValue) {
  if (!(field in EASING_EXTRA_DEFAULTS)) return { changed: false };
  if (typeof newValue !== 'number' || !Number.isFinite(newValue)) {
    return { changed: false };
  }
  const ctx = resolveActiveKeyformContext(action, fcurveId);
  if (!ctx) return { changed: false };
  const current = typeof ctx.kf[field] === 'number'
    ? ctx.kf[field]
    : EASING_EXTRA_DEFAULTS[field];
  if (current === newValue) return { changed: false };
  if (newValue === EASING_EXTRA_DEFAULTS[field]) {
    delete ctx.kf[field];
  } else {
    ctx.kf[field] = newValue;
  }
  return { changed: true };
}
