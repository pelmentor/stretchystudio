// @ts-check

/**
 * Dopesheet channel solo dispatcher — Animation Phase 6 Slice 6.F.2.
 *
 * Pure decision-tree + dispatcher for the Ctrl+Alt+M-keypress solo
 * gesture in the Dopesheet. Sister to `dopesheetChannelMute.js`
 * (Slice 6.F.1) — same hover-priority-with-selection-fallback shape,
 * same `pick* / apply* / would*Change` trio.
 *
 * # NOT a Blender port — SS-original DAW-convention extension
 *
 * Blender's `ACHANNEL_SETTING_SOLO = 5` at
 * `reference/blender/source/blender/editors/include/ED_anim_api.hh:674`
 * is annotated `/** only for NLA Tracks *\/`. There is NO per-FCurve
 * solo in Blender's animation system — verification + full provenance
 * trail in [fcurveSolo.js](./fcurveSolo.js) module header. SS solo is
 * a NEW DAW-convention feature; this dispatcher is original-design
 * (the structural pattern mirrors 6.F.1's mute dispatcher for caller
 * ergonomics, but no Blender code to port).
 *
 * # Keymap binding — SS-CONVENTIONAL Ctrl+Alt+M
 *
 * **SS DEVIATION 19** (hotkey choice). The plan §6.B operator table
 * specifies `dopesheet.soloChannel | Ctrl+Alt+M | Solo channel`. This
 * combination is SS-conventional, picked to:
 *   - Avoid collision with the M-key plain-mute toggle (6.F.1).
 *   - Echo the DAW convention of using a modified M for solo (Ableton
 *     uses `S` directly, Pro Tools uses `S`, Logic uses `S` — `Ctrl+Alt+M`
 *     is the SS-internal compromise to stay in the M-family without
 *     stealing the `S` key from snap / scale gestures planned for
 *     other slices).
 *
 * Honest deviation per Rule №2 — no Blender hotkey to mirror.
 *
 * # Target selection — same as 6.F.1 mute
 *
 * **SS DEVIATION 17 reuse** (target-selection semantic). Hover wins
 * over selection; selection is the fallback when no hover. Same
 * rationale as 6.F.1: SS uses window-level keymap binding, so explicit
 * hover-tracking approximates Blender's region-scoped UX. The
 * `dopesheetChannelMute.js` module header has the full rationale; this
 * module reuses the convention.
 *
 * Decision tree (this module's `pickSoloTarget`):
 *
 *   1. `hoveredFcurveId` resolves → `{ kind: 'hovered', fcurveId }`.
 *   2. Any selected fcurve → `{ kind: 'selection' }`.
 *   3. Else → `{ kind: 'none' }`.
 *
 * # Pure-ops contract (matches 6.F.1 dopesheetChannelMute.js)
 *
 * Three exports:
 *
 *   1. `pickSoloTarget(action, hoveredFcurveId)` — PURE decision.
 *      Identical shape to `pickMuteTarget`.
 *
 *   2. `applyDopesheetChannelSolo(action, target)` — IMMER-FRIENDLY
 *      dispatcher. Routes to `toggleFCurveSolo` (hovered) or
 *      `applyChannelSoloSelected(action, 'toggle')` (selection,
 *      scan-first). Returns `{ changed, kind, mode }`.
 *
 *   3. `wouldDopesheetChannelSoloChange(action, target)` — cheap
 *      predicate for the keymap effect's preventDefault gate.
 *
 * No new solo kernel — reuses [fcurveSolo.js](./fcurveSolo.js)'s
 * already-shipped Slice 6.F.2 primitives.
 *
 * @module anim/dopesheetChannelSolo
 */

import {
  isFCurveSoloed,
  applyChannelSoloSelected,
  wouldChannelSoloSelectedChange,
} from './fcurveSolo.js';

/**
 * @typedef {{
 *   id: string,
 *   solo?: boolean,
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
 * @typedef {HoveredTarget | SelectionTarget | NoneTarget} SoloTarget
 *
 * @typedef {{
 *   changed: boolean,
 *   kind: 'hovered' | 'selection' | 'none',
 *   mode: 'enable' | 'disable' | null,
 * }} SoloResult
 */

/**
 * Decide which channel(s) the Ctrl+Alt+M keypress should target. Pure
 * — same shape as 6.F.1's `pickMuteTarget`. See module header for the
 * hover-priority rationale (DEV 17 reuse).
 *
 * @param {ActionLike|null|undefined} action
 * @param {string|null|undefined} hoveredFcurveId
 * @returns {SoloTarget}
 */
export function pickSoloTarget(action, hoveredFcurveId) {
  if (!action || !Array.isArray(action.fcurves)) return { kind: 'none' };
  if (typeof hoveredFcurveId === 'string' && hoveredFcurveId !== '') {
    const hit = action.fcurves.find((fc) => fc && fc.id === hoveredFcurveId);
    if (hit) return { kind: 'hovered', fcurveId: hoveredFcurveId };
  }
  for (const fc of action.fcurves) {
    if (fc && fc.selected === true) return { kind: 'selection' };
  }
  return { kind: 'none' };
}

/**
 * Predicate: would `applyDopesheetChannelSolo(action, target)` mutate
 * any `fc.solo` bit? Same shape as 6.F.1's
 * `wouldDopesheetChannelMuteChange`.
 *
 * For `'hovered'`: true iff the fcurveId still resolves (single-curve
 * toggle is always a state-flip when the fc exists).
 *
 * For `'selection'`: delegates to `wouldChannelSoloSelectedChange`.
 *
 * For `'none'`: false.
 *
 * @param {ActionLike|null|undefined} action
 * @param {SoloTarget} target
 * @returns {boolean}
 */
export function wouldDopesheetChannelSoloChange(action, target) {
  if (!target || target.kind === 'none') return false;
  if (!action || !Array.isArray(action.fcurves)) return false;
  if (target.kind === 'hovered') {
    return action.fcurves.some((fc) => fc && fc.id === target.fcurveId);
  }
  return wouldChannelSoloSelectedChange(action, 'toggle');
}

/**
 * Dispatch the solo toggle for the given target. Immer-friendly:
 * mutates `action.fcurves[i].solo` in place via the delegated
 * primitives in [fcurveSolo.js](./fcurveSolo.js).
 *
 * Per-target behavior:
 *
 *   - `'hovered'` → `toggleFCurveSolo(action, target.fcurveId)`.
 *   - `'selection'` → `applyChannelSoloSelected(action, 'toggle')`.
 *   - `'none'` → no-op.
 *
 * @param {ActionLike} action
 * @param {SoloTarget} target
 * @returns {SoloResult}
 */
export function applyDopesheetChannelSolo(action, target) {
  if (!target || target.kind === 'none') {
    return { changed: false, kind: 'none', mode: null };
  }
  if (!action || !Array.isArray(action.fcurves)) {
    throw new Error('applyDopesheetChannelSolo: action.fcurves must be an array');
  }
  if (target.kind === 'hovered') {
    const fc = action.fcurves.find((f) => f && f.id === target.fcurveId);
    if (!fc) {
      return { changed: false, kind: 'hovered', mode: null };
    }
    // Audit-fix Slice 6.F.2 MED-A: inline the toggle to eliminate the
    // double-find pattern (pre-fix called `toggleFCurveSolo(action, id)`
    // which re-walked `action.fcurves` to find the same fc again).
    // Eliminates the latent risk of `wasSolo` reading the pre-mutation
    // proxy while the toggle mutates a different reference if the
    // helper is ever refactored to splice-replace. Sister fix applies
    // to dopesheetChannelMute.js (same pattern).
    const wasSolo = isFCurveSoloed(fc);
    fc.solo = !wasSolo;
    return {
      changed: true,
      kind: 'hovered',
      mode: wasSolo ? 'disable' : 'enable',
    };
  }
  // target.kind === 'selection'
  const r = applyChannelSoloSelected(action, 'toggle');
  return {
    changed: r.changed,
    kind: 'selection',
    mode: r.changed ? r.resolvedMode : null,
  };
}
