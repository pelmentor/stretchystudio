// @ts-check

/**
 * Dopesheet channel mute dispatcher — Animation Phase 6 Slice 6.F.1.
 *
 * Pure decision-tree + dispatcher for the M-keypress mute gesture in
 * the Dopesheet. Companion to `dopesheetGrab.js` (Slice 6.C),
 * `dopesheetDelDup.js` (Slice 6.D), `dopesheetClipboard.js` (Slice
 * 6.E). The keymap-effect wiring lives in `DopesheetEditor.jsx`; this
 * module owns the "which channel(s) should the gesture target" logic +
 * the dispatcher that routes to the existing single/bulk mute
 * primitives in `fcurveMute.js`.
 *
 * # What this slice ports
 *
 * Blender's `ANIM_OT_channels_setting_toggle` operator at
 * `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:3090-3114`,
 * parameterised for `ACHANNEL_SETTING_MUTE` (the per-FCurve mute bit,
 * enum entry at
 * `reference/blender/source/blender/editors/include/ED_anim_api.hh:669`):
 *
 *     enum eAnimChannel_Settings {
 *       ACHANNEL_SETTING_SELECT = 0,
 *       ACHANNEL_SETTING_PROTECT = 1,
 *       ACHANNEL_SETTING_MUTE = 2,
 *       ACHANNEL_SETTING_EXPAND = 3,
 *       ACHANNEL_SETTING_VISIBLE = 4,    // only for Graph Editor
 *       ACHANNEL_SETTING_SOLO = 5,       // only for NLA Tracks  ← see SS DEV 18
 *       ACHANNEL_SETTING_PINNED = 6,     // only for NLA Actions
 *       ACHANNEL_SETTING_MOD_OFF = 7,
 *       ACHANNEL_SETTING_ALWAYS_VISIBLE = 8,
 *     };
 *
 * The exec dispatches to `setflag_anim_channels` at
 * `anim_channels_edit.cc:2923-3001`. SS already ships that bulk-mute
 * primitive as `applyChannelMuteSelected` in
 * [src/anim/fcurveMute.js](./fcurveMute.js) (Slice 5.O — wired into
 * the FCurveEditor sidebar Shift+W keymap). Slice 6.F.1 adds the
 * DOPESHEET surface: the M-keypress.
 *
 * # Keymap binding — SS-CONVENTIONAL, NOT Blender-faithful
 *
 * **SS DEVIATION 16** (hotkey choice). Blender's channel-mute keymap
 * is bound at
 * `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:3876-3878`
 * in the `km_animation_channels` block (which the channel sidebar
 * subscribes to):
 *
 *     ("anim.channels_setting_toggle",  {"type": 'W', "value": 'PRESS', "shift": True}, None),
 *     ("anim.channels_setting_enable",  {"type": 'W', "value": 'PRESS', "shift": True, "ctrl": True}, None),
 *     ("anim.channels_setting_disable", {"type": 'W', "value": 'PRESS', "alt": True}, None),
 *
 * **Audit-fix Slice 6.F.1 LOW-F2** (cite-precision tightening): the
 * operator's `type` enum default at `anim_channels_edit.cc:3113` is
 * `0` (a sentinel — `prop_animchannel_settings_types` at `:2907-2911`
 * holds `{PROTECT=1, MUTE=2}`, so default-0 matches no item). The
 * `invoke = WM_menu_invoke` at `:3100` pops the enum picker so the
 * user selects MUTE or PROTECT at use time. (Prior to audit-fix this
 * paragraph cited `:3138`, which is the SISTER operator
 * `ANIM_OT_channels_editable_toggle`'s default — that one DOES default
 * to `ACHANNEL_SETTING_PROTECT`. Different operator, different default.
 * Behavioral claim — "Shift+W alone doesn't directly toggle mute" —
 * is correct; only the supporting cite needed tightening.) SS Slice
 * 5.O wired Shift+W directly to mute (skipping the type-picker menu —
 * Slice 5.O Deviation 1) because SS only supports `fcurve.mute` today,
 * not `fcurve.protected`.
 *
 * Slice 6.F.1 binds **M** in the DOPESHEET (not the sidebar). This
 * hotkey choice does NOT match Blender's `Shift+W` — it matches the
 * established DAW convention (Pro Tools, Logic Pro, Ableton Live all
 * use **M** for "mute the current track/channel"). The plan §6.B
 * operator table explicitly names `dopesheet.muteChannel | M | Toggle
 * mute on hovered channel`, which is DAW-idiomatic rather than
 * Blender-faithful. Honest deviation per Rule №2.
 *
 * Sister Slice 5.O Deviation 1 still applies: the type-picker menu is
 * NOT shipped; M routes directly to mute. PROTECT-as-its-own-keymap
 * lands when SS ships `fcurve.protected` + a popup-menu primitive.
 *
 * # Target selection — HOVERED takes priority over SELECTION
 *
 * **SS DEVIATION 17** (target-selection semantic). Blender's
 * `setflag_anim_channels` at `anim_channels_edit.cc:2961-2963` applies
 * `ANIMFILTER_SEL` (selected-only filter) when called via the
 * `_exec` path at `:3029`:
 *
 *     setflag_anim_channels(&ac, setting, mode, true, flush);
 *                                            ^^^^
 *                                       onlysel=true
 *
 * So Blender's `Shift+W` operates on every selected channel,
 * regardless of which row the pointer is over. The "hovered" concept
 * doesn't exist at the operator level — it's implicit from the keymap
 * subscription being region-scoped (the channels sidebar region only
 * fires its keymap when the pointer is in that region).
 *
 * SS dopesheet uses WINDOW-level keymap binding (no region scoping —
 * the keydown listener is window-level + skip-input-fields, matching
 * the 6.C/6.D/6.E pattern). To approximate Blender's region-scoped
 * "act on what the pointer is over" UX without region scoping, SS
 * tracks the hovered FCurve via `hoveredFcurveIdRef` (set by
 * row-level `onPointerEnter`/`Leave` handlers) and uses HOVER as the
 * primary target. Selection becomes the FALLBACK when no row is
 * hovered (pointer outside the row strip).
 *
 * Target-selection decision tree (this module's `pickMuteTarget`):
 *
 *   1. If `hoveredFcurveId` is set AND the action contains a matching
 *      fcurve → `{ kind: 'hovered', fcurveId }`.
 *   2. Else if any fcurve in `action.fcurves` has `selected === true`
 *      → `{ kind: 'selection' }`.
 *   3. Else → `{ kind: 'none' }` (predicate returns false; M is a no-op).
 *
 * Sister rationale to Blender's keymap region-scoping: under realistic
 * UX where the user hovers a row before pressing M, the hovered-priority
 * path mirrors Blender's region-scoped UX faithfully. The
 * selection-fallback covers the case where the user has multi-selected
 * via Shift+click then moves the pointer away — DAW-idiomatic (it
 * "remembers" the selection).
 *
 * # Solo (Ctrl+Alt+M) — DEFERRED to Slice 6.F.2
 *
 * **SS DEVIATION 18** (solo deferred). The plan §6.B operator table
 * names `dopesheet.soloChannel | Ctrl+Alt+M | Solo channel`. Blender's
 * `ACHANNEL_SETTING_SOLO = 5` at `ED_anim_api.hh:674` carries the
 * inline comment "only for NLA Tracks" — there is NO per-FCurve solo
 * in Blender's animation system. Per-FCurve solo would be an SS-only
 * DAW-convention extension (Pro Tools, Logic Pro all support per-track
 * solo with the "if any solo'd, mute all non-solo'd" semantic).
 *
 * Shipping per-FCurve solo requires:
 *
 *   1. A new `FCURVE_SOLO` flag bit (sister to `FCURVE_MUTED` in
 *      `DNA_anim_enums.h:303-314`; no analog in Blender).
 *   2. `isFCurveSoloed` accessor + `isAnyFCurveSoloed(action)` predicate.
 *   3. `isFCurveEffectivelyMuted` cascade extended: muted iff
 *      `(fc.mute OR group.mute OR (anyOtherSolo && !this.solo))`.
 *   4. All 4 eval call sites updated to honour the new cascade (sister
 *      to Slice 5.V's group-mute cascade work — `animationFCurve.js`,
 *      `depgraph/kernels/{fcurve,animation}.js`, `animationEngine.js`'s
 *      `computePoseOverrides` + `computeParamOverrides`).
 *   5. The dopesheet M-cascade greying in `dopesheetRows.js`'s
 *      `isFCurveEffectivelyMuted` re-derivation to surface the
 *      solo-implied mute visually.
 *
 * That's a ~3-hour separate slice. Deferred to **Slice 6.F.2** to
 * avoid bundling unrelated semantics into one ship. The plan's
 * "Per-channel mute/solo — Slice 6.F" wording underestimated the
 * solo lift because of the NLA-tracks-only Blender constraint
 * discovered at slice authoring time. Honest deferred-scope per Rule №2.
 *
 * # Pure-ops contract (matches Slice 6.C/6.D/6.E conventions)
 *
 * Three exports:
 *
 *   1. `pickMuteTarget(action, hoveredFcurveId)` — PURE. Returns
 *      `{ kind: 'hovered' | 'selection' | 'none', fcurveId? }`. No
 *      mutation. Testable in isolation.
 *
 *   2. `applyDopesheetChannelMute(action, target)` — IMMER-FRIENDLY
 *      mutator. Delegates to `toggleFCurveMute` (single — `target.kind
 *      === 'hovered'`) or `applyChannelMuteSelected(action, 'toggle')`
 *      (bulk — `target.kind === 'selection'`). Returns
 *      `{ changed, kind, mode? }` for the caller to log / no-op detect.
 *
 *   3. `wouldDopesheetChannelMuteChange(action, target)` — cheap
 *      predicate. True iff the dispatch would actually mutate any
 *      `fc.mute` bit. For `'hovered'`: always true (single toggle of
 *      an existing fc is always a change). For `'selection'`: delegates
 *      to `wouldChannelMuteSelectedChange(action, 'toggle')`. For
 *      `'none'`: false.
 *
 * No new pure mute kernel — reuses
 * [src/anim/fcurveMute.js](./fcurveMute.js)'s already-shipped Slice
 * 5.O primitives (which themselves byte-faithfully port
 * `setflag_anim_channels` at `anim_channels_edit.cc:2923-3001`). Per
 * `feedback_byte_verify_behavior_cites` rule 9, the cites above are
 * RE-SOURCED from `anim_channels_edit.cc` + `ED_anim_api.hh` +
 * `blender_default.py` directly, NOT re-quoted from `fcurveMute.js`'s
 * docstring. The structural reference to fcurveMute.js is for code
 * reuse only; behavioral claims are first-hand.
 *
 * @module anim/dopesheetChannelMute
 */

import {
  isFCurveMuted,
  toggleFCurveMute,
  applyChannelMuteSelected,
  wouldChannelMuteSelectedChange,
} from './fcurveMute.js';

/**
 * @typedef {{
 *   id: string,
 *   mute?: boolean,
 *   selected?: boolean,
 * }} FCurveLike
 *
 * @typedef {{
 *   fcurves: FCurveLike[],
 * }} ActionLike
 *
 * @typedef {{ kind: 'hovered', fcurveId: string }} HoveredTarget
 * @typedef {{ kind: 'selection' }} SelectionTarget
 * @typedef {{ kind: 'none' }} NoneTarget
 * @typedef {HoveredTarget | SelectionTarget | NoneTarget} MuteTarget
 *
 * @typedef {{
 *   changed: boolean,
 *   kind: 'hovered' | 'selection' | 'none',
 *   mode: 'enable' | 'disable' | null,
 * }} MuteResult
 *   `mode` reflects the post-resolution direction actually applied:
 *   - `'enable'` if the toggle flipped curves OFF→ON (mute=true)
 *   - `'disable'` if curves flipped ON→OFF (mute=false)
 *   - `null` if no change (kind='none' or already-uniform).
 */

/**
 * Decide which channel(s) the M-keypress should target. Pure: no
 * mutation, no global reads. Mirrors Blender's region-scoped
 * keymap UX via explicit hover-tracking — see module header SS
 * DEVIATION 17 for the full rationale.
 *
 * Returns one of three shapes:
 *
 *   - `{ kind: 'hovered', fcurveId }` — pointer is over a row whose
 *     fcurveId resolves to a real fcurve in the action.
 *   - `{ kind: 'selection' }` — no hover, but at least one fcurve has
 *     `selected === true`. Bulk-toggle path.
 *   - `{ kind: 'none' }` — neither condition. M is a no-op; caller
 *     should let browser default (which is nothing for M, but the
 *     `preventDefault` is conditional on this returning non-none).
 *
 * The `hoveredFcurveId` parameter accepts `null` / `undefined` /
 * empty string (synthetic-row hover) — all collapse to "no hover".
 * The resolution checks the action contains a matching id to guard
 * against stale refs (e.g. hover was set before an action switch).
 *
 * @param {ActionLike | null | undefined} action
 * @param {string | null | undefined} hoveredFcurveId
 * @returns {MuteTarget}
 */
export function pickMuteTarget(action, hoveredFcurveId) {
  if (!action || !Array.isArray(action.fcurves)) return { kind: 'none' };
  // Step 1: hovered priority (DEV 17).
  if (typeof hoveredFcurveId === 'string' && hoveredFcurveId !== '') {
    const hit = action.fcurves.find((fc) => fc && fc.id === hoveredFcurveId);
    if (hit) return { kind: 'hovered', fcurveId: hoveredFcurveId };
  }
  // Step 2: selection fallback.
  for (const fc of action.fcurves) {
    if (fc && fc.selected === true) return { kind: 'selection' };
  }
  // Step 3: nothing to act on.
  return { kind: 'none' };
}

/**
 * Cheap predicate: would `applyDopesheetChannelMute(action, target)`
 * mutate any `fc.mute` bit? True iff the target resolves to at least
 * one fcurve whose mute state will actually flip.
 *
 * For `'hovered'`: always true. A single-curve toggle is always a
 * change (the fcurve's mute bit always flips — there's no prior-state
 * dependency).
 *
 * For `'selection'`: delegates to
 * [fcurveMute.wouldChannelMuteSelectedChange](./fcurveMute.js#L244).
 * Same TOGGLE invariant: with at least one selected fcurve, TOGGLE
 * always flips at least one curve (scan-first resolution picks the
 * direction that opposes at least one current state).
 *
 * For `'none'`: false.
 *
 * Mirrors the spirit of Blender's pre-modal `count` checks
 * (see `count_fcurve_keys` precedent from Slice 6.C). Used by the
 * keymap effect to decide whether to `preventDefault` — when the M
 * keypress is a no-op, let the browser see it.
 *
 * @param {ActionLike | null | undefined} action
 * @param {MuteTarget} target
 * @returns {boolean}
 */
export function wouldDopesheetChannelMuteChange(action, target) {
  if (!target || target.kind === 'none') return false;
  if (!action || !Array.isArray(action.fcurves)) return false;
  if (target.kind === 'hovered') {
    // Defensive re-check: target.fcurveId must still resolve. (The
    // pickMuteTarget call already validated this, but the action may
    // have changed between pick and apply if the caller separates them.)
    return action.fcurves.some((fc) => fc && fc.id === target.fcurveId);
  }
  // target.kind === 'selection'
  return wouldChannelMuteSelectedChange(action, 'toggle');
}

/**
 * Dispatch the mute toggle for the given target. Immer-friendly:
 * mutates `action.fcurves[i].mute` in place via the delegated
 * primitives in [src/anim/fcurveMute.js](./fcurveMute.js).
 *
 * Per-target behavior:
 *
 *   - `'hovered'` → `toggleFCurveMute(action, target.fcurveId)`. Flips
 *     ONE curve's mute. Returns `mode='enable'` if the new state is
 *     muted, `'disable'` if unmuted, `null` if the fcurveId didn't
 *     resolve (defensive).
 *   - `'selection'` → `applyChannelMuteSelected(action, 'toggle')`.
 *     Bulk-toggles every selected fcurve via the scan-first resolution
 *     (matches Blender's `setflag_anim_channels` TOGGLE branch at
 *     `anim_channels_edit.cc:2968-2980`).
 *   - `'none'` → no-op; returns `changed=false`.
 *
 * @param {ActionLike} action
 * @param {MuteTarget} target
 * @returns {MuteResult}
 */
export function applyDopesheetChannelMute(action, target) {
  if (!target || target.kind === 'none') {
    return { changed: false, kind: 'none', mode: null };
  }
  if (!action || !Array.isArray(action.fcurves)) {
    throw new Error('applyDopesheetChannelMute: action.fcurves must be an array');
  }
  if (target.kind === 'hovered') {
    const fc = action.fcurves.find((f) => f && f.id === target.fcurveId);
    if (!fc) {
      // Defensive: fcurveId no longer resolves (action changed between
      // pick and apply). Treat as no-op; caller can re-pick if needed.
      return { changed: false, kind: 'hovered', mode: null };
    }
    const wasMuted = isFCurveMuted(fc);
    toggleFCurveMute(action, target.fcurveId);
    return {
      changed: true,
      kind: 'hovered',
      mode: wasMuted ? 'disable' : 'enable',
    };
  }
  // target.kind === 'selection'
  const r = applyChannelMuteSelected(action, 'toggle');
  return {
    changed: r.changed,
    kind: 'selection',
    mode: r.changed ? r.resolvedMode : null,
  };
}
