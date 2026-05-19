// @ts-check

/**
 * Animation Phase 6 Slice 6.F.2 — Per-FCurve solo helpers.
 *
 * Pure mutation + read helpers for the per-FCurve `solo` boolean. Companion
 * to `fcurveMute.js` (Slice 5.G / 5.O) and `fcurveGroups.js` cascade
 * (Slice 5.V). Backs the dopesheet Ctrl+Alt+M keymap via
 * `dopesheetChannelSolo.js` + DopesheetEditor.jsx.
 *
 * # NOT a Blender port — SS-original DAW-convention extension
 *
 * Blender's `eAnimChannel_Settings` enum at
 * `reference/blender/source/blender/editors/include/ED_anim_api.hh:665-680`
 * declares `ACHANNEL_SETTING_SOLO = 5` (line 674) with the comment
 * `/** only for NLA Tracks *\/`. The setting dispatchers per channel
 * type confirm this restriction:
 *
 *   - `acf_nlatrack_setting_flag` at
 *     `reference/blender/source/blender/editors/animation/anim_channels_defines.cc:4424-4447`
 *     returns `NLATRACK_SOLO` for the SOLO case (`:4441-4442`).
 *   - Sister dispatchers for FCurve / Group / etc. all have a SOLO
 *     case that returns 0 with a NLA-only comment:
 *     `acf_fcurve_setting_flag` at `:1095` ("Solo Flag is only for NLA"),
 *     `acf_group_setting_flag` at `:891`
 *     ("Only available in NLA Editor for tracks"), and several others
 *     at `:3818`, `:3982`, `:4273` all noting NLA-only.
 *
 * Blender's NLA solo is a TWO-FLAG system per
 * `reference/blender/source/blender/makesdna/DNA_anim_enums.h`:
 *
 *   - **`NLATRACK_SOLO = (1 << 3)`** at `:469` — per-track flag.
 *     Comment: "track is the only one evaluated (must be used in
 *     conjunction with adt->flag)".
 *   - **`ADT_NLA_SOLO_TRACK = (1 << 0)`** at `:555` — per-AnimData flag
 *     "Only evaluate a single track in the NLA." Set when ANY track in
 *     the AnimData is soloed.
 *
 * Effective NLA semantic: when `ADT_NLA_SOLO_TRACK` is set AND a track
 * doesn't carry `NLATRACK_SOLO`, that track is "tagged for special
 * non-solo handling" (effectively muted) — visible in the per-track
 * draw at `anim_channels_defines.cc:4347-4350` and the validity
 * dispatch at `:4393-4411`.
 *
 * **SS has no per-FCurve solo in Blender.** This module implements an
 * SS-original DAW-convention extension (Pro Tools, Logic Pro, Ableton
 * Live all support per-track solo with the "if any solo'd, mute all
 * non-solo'd" semantic). The structural pattern mirrors Blender's NLA
 * solo (per-element flag + global "anySolo" predicate + eval-gate
 * cascade), but the semantic is multi-solo (multiple FCurves can carry
 * `solo: true` simultaneously; any-soloed-plays-rest-silent) rather
 * than Blender's single-solo (one track at a time).
 *
 * Honest scope per Rule №2: this is NEW SS functionality, not a port.
 * Cites above are PROVENANCE (proving Blender has no per-FCurve solo
 * to port from) — the implementation below is original.
 *
 * # Semantic — multi-solo, solo wins over mute
 *
 * Decision matrix for "is this fcurve evaluatable":
 *
 *   | anySolo | this.solo | this.mute | evaluatable |
 *   |---------|-----------|-----------|-------------|
 *   |    Y    |     Y     |     -     |     YES     |
 *   |    Y    |     N     |     -     |     NO      |
 *   |    N    |     -     |     Y     |     NO      |
 *   |    N    |     -     |     N     |     YES     |
 *
 * Critical: when `anySolo`, the mute bit on a solo'd fcurve is
 * IGNORED (solo overrides mute). When `!anySolo`, solo is irrelevant
 * — only mute matters. This matches Pro Tools / Logic Pro / Ableton.
 *
 * Implementation hook: `isFCurveEffectivelyMuted` in
 * [fcurveGroups.js](./fcurveGroups.js) is extended with solo cascade
 * — every existing eval call site picks up the new semantic without
 * touching them individually. Sister to Slice 5.V's group-mute cascade.
 *
 * # Sparse-boolean field (no schema bump)
 *
 * `fcurve.solo` is a sparse boolean: missing in v42-and-older saves
 * (i.e. all current saves), treated as `false` by `isFCurveSoloed`.
 * No migration ships with this slice — per
 * `feedback_no_migration_baggage_rule_two`, a v43 migration writing
 * `solo: false` onto every fcurve would be pure noise.
 *
 * Schema stays at v42. Sparse-boolean reader pattern (`fc.solo === true`,
 * strict check, missing collapses to false) handles tri-state cleanly.
 *
 * Solo IS in the project undo history (sister to Slice 5.O mute):
 * solo changes which curves drive properties, so it's data not view
 * state. Toggles route through `update(recipe)` without
 * `skipHistory:true`.
 *
 * # Structural mirror of fcurveMute.js — for ergonomics, not for cites
 *
 * The exports below intentionally mirror `fcurveMute.js`'s shape
 * (`isFCurveMuted` / `toggleFCurveMute` / `applyChannelMuteSelected` /
 * `wouldChannelMuteSelectedChange`) so the dopesheet dispatchers have
 * a uniform interface. This is STRUCTURAL similarity for caller
 * ergonomics — none of the cites in this module are inherited from
 * fcurveMute.js's docstring. Per rule 9, all Blender provenance is
 * re-sourced directly from `ED_anim_api.hh`, `anim_channels_defines.cc`,
 * `DNA_anim_enums.h`.
 *
 * @module anim/fcurveSolo
 */

/**
 * @typedef {{
 *   id?: string,
 *   solo?: boolean,
 *   selected?: boolean,
 * }} FCurveLike
 *
 * @typedef {{
 *   fcurves: FCurveLike[],
 * }} ActionLike
 */

/**
 * Strict `=== true` read for `fc.solo`. Defensive against accidental
 * truthy writes (`1`, `"yes"`, etc.). Missing field → false.
 *
 * Sister structural form to `isFCurveMuted` in
 * [fcurveMute.js](./fcurveMute.js#L133), but no Blender provenance —
 * see module header for why this is SS-original.
 *
 * @param {FCurveLike|null|undefined} fcurve
 * @returns {boolean}
 */
export function isFCurveSoloed(fcurve) {
  return !!(fcurve && fcurve.solo === true);
}

/**
 * True iff ANY fcurve in the action carries `solo === true`. O(N) walk;
 * called per-eval-call per fcurve in the worst case (no caching today
 * — see module header perf note). For typical SS actions (<100 fcurves),
 * the walk is sub-microsecond.
 *
 * Mirrors the structural role of `ADT_NLA_SOLO_TRACK` in Blender
 * (`DNA_anim_enums.h:555` — "Only evaluate a single track in the NLA")
 * but DERIVED rather than STORED. Blender caches the bit on AnimData
 * because NLA track edits are infrequent and the per-bit-flag check is
 * cheaper than a list walk; SS derives it per-call because the action
 * fcurves[] is the source of truth and there's no "action.flags" slot
 * to mirror an extra bit into. Caching could be added later if a perf
 * profile shows it.
 *
 * @param {ActionLike|null|undefined} action
 * @returns {boolean}
 */
export function isAnyFCurveSoloed(action) {
  if (!action || !Array.isArray(action.fcurves)) return false;
  for (const fc of action.fcurves) {
    if (fc && fc.solo === true) return true;
  }
  return false;
}

/**
 * Toggle the per-FCurve solo bit in-place. Returns the post-toggle
 * value so the caller can update local state (button label, tooltip)
 * without re-reading.
 *
 * Single-curve operation: no peer interaction (DAW multi-solo). Sister
 * structural form to `toggleFCurveMute` from
 * [fcurveMute.js](./fcurveMute.js#L153).
 *
 * @param {ActionLike} action — Action datablock (mutated)
 * @param {string} fcurveId
 * @returns {{ soloNow: boolean }}
 */
export function toggleFCurveSolo(action, fcurveId) {
  if (!action || !Array.isArray(action.fcurves)) {
    return { soloNow: false };
  }
  const fc = action.fcurves.find((f) => f && f.id === fcurveId);
  if (!fc) return { soloNow: false };
  fc.solo = !isFCurveSoloed(fc);
  return { soloNow: fc.solo === true };
}

/**
 * Bulk-toggle solo on every selected FCurve. Same scan-first resolution
 * as Slice 5.O's `applyChannelMuteSelected` — if any selected fcurve is
 * already solo'd, the batch goes OFF; else all go ON. Uniform output:
 * after the op every selected channel is in the same solo state.
 *
 * Backs the bulk path of `dopesheetChannelSolo.js#applyDopesheetChannelSolo`
 * when the keypress lands without a hover target.
 *
 * Returns `{ changed, soloedCount, unsoloedCount, resolvedMode }`.
 *
 * @param {ActionLike} action — Action datablock (mutated)
 * @param {'toggle' | 'enable' | 'disable'} mode
 * @returns {{ changed: boolean, soloedCount: number, unsoloedCount: number, resolvedMode: 'enable' | 'disable' | null }}
 */
export function applyChannelSoloSelected(action, mode) {
  /** @type {{ changed: boolean, soloedCount: number, unsoloedCount: number, resolvedMode: 'enable' | 'disable' | null }} */
  const result = { changed: false, soloedCount: 0, unsoloedCount: 0, resolvedMode: null };
  if (mode !== 'toggle' && mode !== 'enable' && mode !== 'disable') return result;
  if (!action || !Array.isArray(action.fcurves)) return result;
  /** @type {FCurveLike[]} */
  const selected = [];
  for (const fc of action.fcurves) {
    if (fc && fc.selected === true) selected.push(fc);
  }
  if (selected.length === 0) return result;
  /** @type {'enable' | 'disable'} */
  let effective;
  if (mode === 'toggle') {
    // Scan-first resolution — sister to fcurveMute.js's
    // resolveToggleDirection. Default ADD (set solo); if any selected
    // is already solo'd, flip to CLEAR (unset all).
    effective = 'enable';
    for (const fc of selected) {
      if (isFCurveSoloed(fc)) { effective = 'disable'; break; }
    }
  } else {
    effective = mode;
  }
  result.resolvedMode = effective;
  const wantSolo = effective === 'enable';
  for (const fc of selected) {
    const wasSolo = isFCurveSoloed(fc);
    if (wasSolo === wantSolo) continue;
    fc.solo = wantSolo;
    result.changed = true;
    if (wantSolo) result.soloedCount++;
    else result.unsoloedCount++;
  }
  return result;
}

/**
 * Read-only preflight for {@link applyChannelSoloSelected}. Returns
 * true iff calling the apply path would mutate any field. Same
 * phantom-undo rationale as Slice 5.O's mute preflight: `updateProject`
 * pushes a snapshot unconditionally before the recipe runs, so a no-op
 * Ctrl+Alt+M with nothing selected (or already-uniform) would otherwise
 * consume an undo slot.
 *
 * TOGGLE invariant: with at least one selected fcurve, TOGGLE is
 * guaranteed to flip at least one. So
 * `wouldChannelSoloSelectedChange(action, 'toggle')` is equivalent to
 * "at least one selected fcurve exists".
 *
 * @param {ActionLike|null|undefined} action
 * @param {'toggle' | 'enable' | 'disable'} mode
 * @returns {boolean}
 */
export function wouldChannelSoloSelectedChange(action, mode) {
  if (mode !== 'toggle' && mode !== 'enable' && mode !== 'disable') return false;
  if (!action || !Array.isArray(action.fcurves)) return false;
  /** @type {FCurveLike[]} */
  const selected = [];
  for (const fc of action.fcurves) {
    if (fc && fc.selected === true) selected.push(fc);
  }
  if (selected.length === 0) return false;
  /** @type {'enable' | 'disable'} */
  let effective;
  if (mode === 'toggle') {
    effective = 'enable';
    for (const fc of selected) {
      if (isFCurveSoloed(fc)) { effective = 'disable'; break; }
    }
  } else {
    effective = mode;
  }
  const wantSolo = effective === 'enable';
  for (const fc of selected) {
    if (isFCurveSoloed(fc) !== wantSolo) return true;
  }
  return false;
}
