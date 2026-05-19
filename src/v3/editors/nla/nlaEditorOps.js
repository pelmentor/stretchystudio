// @ts-check

/**
 * NLAEditor pure-function operations layer — Animation Phase 4 Slices
 * 4.D.2 (drag interactions) + 4.D.3 (affordance toggles + setters) +
 * 4.D.4 (CRUD + Push Action Down).
 *
 * Splits each drag/reorder operation into a pure function that takes
 * the current animData + an op input and returns a NEW animData
 * (immutable per Zustand convention). The JSX handler layer
 * (`NLAEditor.jsx`) wires pointer events to these functions; the
 * project store action persists the result.
 *
 * Mirrors `src/v3/editors/fcurve/fcurveModifiersPanelData.js` ops
 * pattern (Slice 3.C): `wouldXChange` predicate + `applyX` mutator
 * pair so the JSX can disable affordances that would be no-ops.
 *
 * # Operations shipped in 4.D.2
 *
 *   - applyMoveStrip(animData, trackId, stripId, deltaMs) → animData
 *       Translates a strip by deltaMs, preserving duration. Clamps
 *       so strip.start >= 0 (no negative timeline positions).
 *
 *   - applyResizeStripStart(animData, trackId, stripId, newStartMs)
 *       Moves the LEFT edge. Clamps to [0, strip.end - MIN_STRIP_MS]
 *       so the strip stays positive-length and >= 0.
 *
 *   - applyResizeStripEnd(animData, trackId, stripId, newEndMs)
 *       Moves the RIGHT edge. Clamps to [strip.start + MIN_STRIP_MS, +Inf).
 *
 *   - applyReorderTrack(animData, trackId, newIndex)
 *       Updates the track's `index` field + RESTAMPS sibling tracks
 *       to maintain contiguous integer indices. Per Slice 4.C audit
 *       MED-A3 contract: "Slice 4.D NLAEditor MUST re-stamp index
 *       on every reorder" — this is that helper.
 *
 * # Operations shipped in 4.D.3
 *
 *   - applySetStripBlendMode(animData, trackId, stripId, blendmode)
 *       Validates against NLA_BLEND_MODES; throws on unknown (Rule №1
 *       — no silent fallback to default).
 *
 *   - applySetStripExtendMode(animData, trackId, stripId, extendmode)
 *       Validates against NLA_EXTEND_MODES; throws on unknown.
 *
 *   - applySetStripInfluence(animData, trackId, stripId, influence)
 *       Clamps to [0, 1] per Blender `rna_nla.cc:1069-1072`
 *       (`PROP_FACTOR` range 0..1 on `influence`).
 *
 *   - applyToggleStripMuted(animData, trackId, stripId)
 *       XORs `NLASTRIP_FLAG.MUTED`. Per Blender `rna_nla.cc` —
 *       strip-level mute is a property, not a special-cased toggle.
 *
 *   - applyToggleTrackMuted(animData, trackId)
 *       XORs `NLATRACK_FLAG.MUTED`.
 *
 *   - applyToggleTrackProtected(animData, trackId)
 *       XORs `NLATRACK_FLAG.PROTECTED`.
 *
 *   - applyToggleTrackSolo(animData, trackId)
 *       Byte-faithful port of `BKE_nlatrack_solo_toggle`
 *       (`nla.cc:1262-1292`): clears `NLATRACK_FLAG.SOLO` on ALL OTHER
 *       tracks (solo is exclusive — one track at a time), XOR-toggles
 *       on the target, then sets/clears `ADT_FLAG.NLA_SOLO_TRACK` on
 *       the animData based on whether target now has SOLO set.
 *
 * # Operations shipped in 4.D.4
 *
 *   - applyAddTrack(animData, name?)
 *       Creates a new NlaTrack via `makeNlaTrack` and appends to the
 *       top of the stack (`index = nlaTracks.length`). Default name
 *       "NlaTrack" with uniqueness suffix when needed. SS deviation
 *       from Blender's `BKE_nlatrack_new()` default flag = `SELECTED |
 *       OVERRIDELIBRARY_LOCAL` (per `nla.cc:358-367`) — SS leaves
 *       `flag = 0` per the Slice 4.A deviation already documented in
 *       `nla.js`.
 *
 *   - applyAddStrip(animData, project, trackId, actionId, startMs?)
 *       Creates a new NlaStrip via `makeNlaStrip` referencing
 *       actionId. Derives `actstart`/`actend`/`end` from the action's
 *       frame range (`project.actions[...].frameStart`/`frameEnd`/
 *       `duration`). If the action has no length signal, uses
 *       `MIN_STRIP_MS` (1ms) so the strip is non-empty + the user can
 *       resize.
 *
 *       **SS DEVIATION 15 — auto-position on overlap** (audit-fix
 *       Slice 4.D.4 HIGH-A1 + fidelity HIGH-A1). Blender's
 *       `BKE_nlatrack_add_strip` (`nla.cc:1361-1379`) returns `false`
 *       when `BKE_nlastrips_has_space` (`nla.cc:860-890`) finds no
 *       room at the requested start. The CALLER (operator) then
 *       decides to fall over to a new track. SS's `applyAddStrip`
 *       silently scans rightward via `findFreeRangeStart` and inserts
 *       at the first free position that fits the action's duration —
 *       so the only refusals are (a) PROTECTED track, (b) missing
 *       action, (c) missing track, (d) empty/missing project.
 *       Behavioral consequence: a strip ALWAYS lands on the requested
 *       track (if the track is open + action exists); never fails over
 *       to a different track at this layer. `applyPushActionDown`'s
 *       "fall over to new track" fires only on PROTECTED top track,
 *       not on "top track full".
 *
 *       Refuses if the target track is PROTECTED (per
 *       `BKE_nlatrack_add_strip` `nla.cc:1361-1379`). Returns
 *       same-ref animData on rejection; caller introspects via
 *       `wouldAddStripChange`.
 *
 *   - applyRemoveStrip(animData, trackId, stripId)
 *       Removes strip from track. Refuses if the strip is the current
 *       `tweakStripId` — Rule №1: caller must `exitTweakMode` first.
 *       Mirrors Blender's defensive `BKE_nla_tweakmode_exit` call at
 *       `nla_edit.cc:1297` before deleting an active tweak strip
 *       (SS shifts the gate from "exit-then-delete" to "refuse-and-
 *       force-explicit-exit"). Refuses if the parent track is
 *       PROTECTED.
 *
 *       **No transition cascade** (audit-fix Slice 4.D.4 MED-A3):
 *       Blender's `NLA_OT_delete` (`nla_edit.cc:1300-1307`) also
 *       removes adjacent `NLASTRIP_TYPE_TRANSITION` strips when
 *       deleting a normal strip — both prev-transition and
 *       next-transition are dropped via
 *       `BKE_nlastrip_remove_and_free`. SS skips this because
 *       transitions are not modeled in Phase 4 (Slice 4.A schema only
 *       defines clip strips; transition support is deferred per
 *       plan §Phase 5).
 *
 *   - applyRemoveTrack(animData, trackId)
 *       Removes track + all its strips. Cascade-deletes strips by
 *       virtue of array-filter (the track + its `strips[]` array drop
 *       together). Blender's equivalent is `BKE_nlatrack_remove_and_free`
 *       (`nla.cc:684-688` — a 3-liner) which delegates to
 *       `BKE_nlatrack_free` (`nla.cc:109-126`) that iterates `strips`
 *       and calls `BKE_nlastrip_remove_and_free` per-strip; SS does
 *       the cascade implicitly (no per-strip cleanup hook needed —
 *       there's no allocated state beyond plain JSON).
 *
 *       Re-stamps remaining tracks' indices to maintain contiguous
 *       integers (per Slice 4.C audit-fix MED-A3 contract). If the
 *       removed track had `NLATRACK_FLAG.SOLO` set, also clears
 *       `ADT_FLAG.NLA_SOLO_TRACK` on the animData (per Blender's
 *       `nla_tracks.cc:736-738`). Refuses if the track contains the
 *       current tweak strip OR if the track is PROTECTED.
 *
 *       **SS DEVIATION 16 — no id-user refcount on action references**
 *       (audit-fix Slice 4.D.4 fidelity MED-A4). Blender's
 *       `BKE_nlatrack_remove_and_free(..., do_id_user=true)` decrements
 *       ID user-counts on each freed strip's referenced action. SS
 *       doesn't refcount actions — they're plain string-id references
 *       into `project.actions[]`. Removing a strip never garbage-
 *       collects an action; unused actions linger until explicitly
 *       deleted via the Actions editor. Acceptable today (low strip-
 *       creation churn in production projects); a future bulk-cleanup
 *       sweep is the right place to add a project-wide unused-action
 *       reaper.
 *
 *   - applyPushActionDown(animData, project)
 *       Port of `BKE_nla_action_pushdown` (`nla.cc:2248-2294`). If
 *       `animData.actionId` is null, returns same-ref. Creates a
 *       strip from the active action via `makeNlaStrip`. Tries top
 *       track first; if the top track is PROTECTED OR there are no
 *       tracks at all, creates a new track named after the action
 *       (per `nla.cc:617` `STRNCPY_UTF8(nlt->name,
 *       adt->action->id.name + 2)`). Clears `animData.actionId`
 *       (and `slotHandle`) after successful push. Refuses if in
 *       tweak mode (Blender's operator's poll function
 *       `nlaop_poll_tweakmode_off` enforces; SS mirrors at
 *       substrate per Rule №1).
 *
 *       **Audit-fix Slice 4.D.4 MED-A2**: pre-fix this said "creates
 *       a new track if the last track rejects (no space or no last
 *       track)". The "no space" branch is unreachable because
 *       `applyAddStrip` auto-positions rightward (SS DEVIATION 15
 *       above) — only PROTECTED top tracks trigger the new-track
 *       fallback. Updated to reflect actual behavior. (Blender's
 *       BKE_nlastack_add_strip DOES fall over to new-track on no-
 *       space because its `BKE_nlatrack_add_strip` strictly rejects;
 *       SS's port diverges per deviation 15.)
 *
 *       **SS DEVIATION 13 — no act_blendmode/act_influence/
 *       act_extendmode inheritance.** Blender (`nla.cc:2274-2276`)
 *       copies these from AnimData to the new strip; SS's animData
 *       doesn't model these fields (no `act_blendmode` etc on the
 *       v42 schema), so the strip gets the `makeNlaStrip` defaults
 *       (blendmode='replace', extendmode='hold', influence=1). A
 *       future schema bump that adds those AnimData fields MUST
 *       wire the copy here per Blender behavior.
 *
 *       **SS DEVIATION 14 — no USR_INFLUENCE escalation.** Blender
 *       (`nla.cc:2278-2290`) sets `NLASTRIP_FLAG_USR_INFLUENCE` on
 *       the pushed-down strip if `act_influence < 1.0f` so the
 *       sub-1.0 influence survives. SS skips this because SS doesn't
 *       model `act_influence` (per deviation 13) — the strip lands
 *       with influence=1 regardless, so the escalation has no
 *       behavioral basis. Re-litigate when deviation 13 is fixed.
 *
 * # No-overlap enforcement on RESIZE/DRAG (SS DEVIATION, documented)
 *
 * **Scope clarification (audit-fix Slice 4.D.4):** this deviation
 * applies to BOTH `applyMoveStrip`/`applyResizeStripStart`/`applyResizeStripEnd`
 * (the drag-time ops) AND `applyAddStrip` (the create-time op) —
 * SEE SS DEVIATION 15 above for the latter. The pre-audit-fix text
 * here claimed "the CREATE-time op `applyAddStrip` DOES honor
 * Blender's overlap rejection" — wrong: it auto-positions rightward
 * instead. The runtime behavior (no rejection at the strip-positioning
 * level) is the same for drag + create; only the implementation paths
 * differ (drag clamps; create scans rightward via
 * `findFreeRangeStart`).
 *
 * Blender's `nlastrip_fix_resize_overlaps` (nla.cc:1616+) shifts
 * neighbor strips when a resize would cause overlap. SS does NOT
 * enforce no-overlap at the substrate level — overlapping strips
 * are evaluator-valid: per Slice 4.B `evaluateNla`
 * (`src/anim/nlaEval.js` accumulator loop), each strip's
 * contribution is blended via `applyBlendMode(lower, strip,
 * blendmode, influence)` regardless of overlap. Cross-track:
 * bottom-up accumulation per the track-index sort; upper REPLACE
 * with influence=1 fully occludes lower, ADD/SUB/MUL or partial-
 * influence compose per the kernel. Same-track overlap: strips
 * iterate in array order, each calling `applyBlendMode` against
 * the running accumulator — the last strip evaluated wins per its
 * blendmode/influence (NOT a positional "left-to-right" rule).
 *
 * Audit-fix Slice 4.D.2 HIGH-F1: pre-fix rationale falsely claimed
 * "higher-track strip wins at the overlap region via the bottom-to-
 * top stack walk", which mischaracterized SS's evaluator (which
 * goes through `applyBlendMode` uniformly — REPLACE-influence-1 is
 * the only mode that fully occludes; other modes compose). Updated
 * to accurately describe what `evaluateNla` does.
 *
 * The 4.D NLAEditor surfaces overlaps visually; user can manually
 * shift if they want clean separation. Slice 4.D.4 explicitly chose
 * NOT to add an "auto-separate on drop" option — Blender doesn't
 * either, and the user-direct-resolve workflow has worked in the
 * 4.D.2/4.D.3 manual checklists without ambiguity.
 *
 * @module v3/editors/nla/nlaEditorOps
 */

import {
  NLA_BLEND_MODES,
  NLA_EXTEND_MODES,
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
  makeNlaTrack,
  makeNlaStrip,
  isTweakModeOn,
} from '../../../anim/nla.js';

/**
 * Minimum strip duration (ms). Below this the strip would be a
 * zero-length no-op (Blender's `IS_EQF` check at nla.cc:1580 rejects
 * stripLen ~= 0; SS uses 1ms as a sane authoring floor). Resizes that
 * would shrink a strip below MIN_STRIP_MS are clamped to MIN_STRIP_MS.
 */
export const MIN_STRIP_MS = 1;

/**
 * Locate a strip + track by id within an animData. Returns indices
 * for in-place patching plus the raw refs.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @returns {{ trackIdx: number, stripIdx: number, track: object|null, strip: object|null }}
 */
function locateStrip(animData, trackId, stripId) {
  const tracks = Array.isArray(animData?.nlaTracks) ? animData.nlaTracks : null;
  if (!tracks) return { trackIdx: -1, stripIdx: -1, track: null, strip: null };
  for (let ti = 0; ti < tracks.length; ti++) {
    const t = tracks[ti];
    if (!t || t.id !== trackId) continue;
    const strips = Array.isArray(t.strips) ? t.strips : null;
    if (!strips) return { trackIdx: ti, stripIdx: -1, track: t, strip: null };
    for (let si = 0; si < strips.length; si++) {
      if (strips[si] && strips[si].id === stripId) {
        return { trackIdx: ti, stripIdx: si, track: t, strip: strips[si] };
      }
    }
    return { trackIdx: ti, stripIdx: -1, track: t, strip: null };
  }
  return { trackIdx: -1, stripIdx: -1, track: null, strip: null };
}

/**
 * Immutable patch of a single strip within animData. Returns a NEW
 * animData with the strip replaced; original is untouched. Tracks
 * outside the target are shared by reference (shallow-clone only the
 * touched track + strips array).
 *
 * @param {object} animData
 * @param {number} trackIdx
 * @param {number} stripIdx
 * @param {object} newStrip
 * @returns {object}
 */
function patchStrip(animData, trackIdx, stripIdx, newStrip) {
  const tracks = animData.nlaTracks.slice();
  const track = { ...tracks[trackIdx] };
  const strips = track.strips.slice();
  strips[stripIdx] = newStrip;
  track.strips = strips;
  tracks[trackIdx] = track;
  return { ...animData, nlaTracks: tracks };
}

/**
 * Predicate: would the move actually change the strip's position?
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} deltaMs
 * @returns {boolean}
 */
export function wouldMoveStripChange(animData, trackId, stripId, deltaMs) {
  if (Math.abs(deltaMs) < 1e-10) return false;
  const { strip } = locateStrip(animData, trackId, stripId);
  if (!strip) return false;
  // Strip at start=0 with negative delta is clamped to no-op.
  const clampedDelta = Math.max(-strip.start, deltaMs);
  return Math.abs(clampedDelta) > 1e-10;
}

/**
 * Translate a strip by deltaMs, preserving duration. Clamps so
 * strip.start >= 0 (no negative timeline positions). Returns a NEW
 * animData; original unchanged.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} deltaMs
 * @returns {object} new animData (same reference if no-op)
 */
export function applyMoveStrip(animData, trackId, stripId, deltaMs) {
  const { trackIdx, stripIdx, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || trackIdx === -1) return animData;
  // Clamp delta so strip.start stays >= 0
  const clampedDelta = Math.max(-strip.start, deltaMs);
  if (Math.abs(clampedDelta) < 1e-10) return animData;
  const newStrip = {
    ...strip,
    start: strip.start + clampedDelta,
    end: strip.end + clampedDelta,
  };
  return patchStrip(animData, trackIdx, stripIdx, newStrip);
}

/**
 * Predicate: would the start-edge resize actually change anything?
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} newStartMs
 * @returns {boolean}
 */
export function wouldResizeStripStartChange(animData, trackId, stripId, newStartMs) {
  const { strip } = locateStrip(animData, trackId, stripId);
  if (!strip) return false;
  const clamped = Math.min(Math.max(0, newStartMs), strip.end - MIN_STRIP_MS);
  return Math.abs(clamped - strip.start) > 1e-10;
}

/**
 * Resize a strip's LEFT edge. Clamps to [0, strip.end - MIN_STRIP_MS]
 * so the strip stays positive-length and doesn't cross the right edge.
 *
 * NOTE: resizing the left edge while keeping actstart/actend fixed
 * effectively SHIFTS the action's start-of-play in global time but
 * does NOT change the action's playback range — the action still plays
 * from actstart to actend, just over a longer/shorter global time
 * window. Matches Blender's `NlaStrip` semantics: `start` is global
 * timeline placement, `actstart`/`actend` are action-local range.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} newStartMs
 * @returns {object}
 */
export function applyResizeStripStart(animData, trackId, stripId, newStartMs) {
  const { trackIdx, stripIdx, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || trackIdx === -1) return animData;
  const clamped = Math.min(Math.max(0, newStartMs), strip.end - MIN_STRIP_MS);
  if (Math.abs(clamped - strip.start) < 1e-10) return animData;
  const newStrip = { ...strip, start: clamped };
  return patchStrip(animData, trackIdx, stripIdx, newStrip);
}

/**
 * Predicate: would the end-edge resize actually change anything?
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} newEndMs
 * @returns {boolean}
 */
export function wouldResizeStripEndChange(animData, trackId, stripId, newEndMs) {
  const { strip } = locateStrip(animData, trackId, stripId);
  if (!strip) return false;
  const clamped = Math.max(strip.start + MIN_STRIP_MS, newEndMs);
  return Math.abs(clamped - strip.end) > 1e-10;
}

/**
 * Resize a strip's RIGHT edge. Clamps to >= strip.start + MIN_STRIP_MS.
 * No upper bound — the strip can extend arbitrarily far right.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} newEndMs
 * @returns {object}
 */
export function applyResizeStripEnd(animData, trackId, stripId, newEndMs) {
  const { trackIdx, stripIdx, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || trackIdx === -1) return animData;
  const clamped = Math.max(strip.start + MIN_STRIP_MS, newEndMs);
  if (Math.abs(clamped - strip.end) < 1e-10) return animData;
  const newStrip = { ...strip, end: clamped };
  return patchStrip(animData, trackIdx, stripIdx, newStrip);
}

/**
 * Predicate: would the reorder actually change anything?
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {number} newIndex
 * @returns {boolean}
 */
export function wouldReorderTrackChange(animData, trackId, newIndex) {
  const tracks = Array.isArray(animData?.nlaTracks) ? animData.nlaTracks : null;
  if (!tracks) return false;
  for (const t of tracks) {
    if (t && t.id === trackId) {
      return t.index !== Math.max(0, Math.min(tracks.length - 1, newIndex));
    }
  }
  return false;
}

/**
 * Reorder a track to a new index (bottom-to-top, 0 = bottom). Other
 * tracks shift to fill / make room. Re-stamps every track's `index`
 * field to maintain contiguous integers from 0 to N-1.
 *
 * Per Slice 4.C audit MED-A3 contract: "Slice 4.D NLAEditor MUST
 * re-stamp index on every reorder" — index drift would cause the
 * DISABLED cascade in `enterTweakMode` to disable wrong tracks.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {number} newIndex — clamped to [0, n-1]
 * @returns {object}
 */
export function applyReorderTrack(animData, trackId, newIndex) {
  const tracksRef = Array.isArray(animData?.nlaTracks) ? animData.nlaTracks : null;
  if (!tracksRef) return animData;

  // Defensive copy + sort by current index (in case it's already
  // unstamped — we want a deterministic starting order).
  const sorted = tracksRef.slice().sort((a, b) => {
    const ai = typeof a?.index === 'number' ? a.index : 0;
    const bi = typeof b?.index === 'number' ? b.index : 0;
    return ai - bi;
  });

  const fromPos = sorted.findIndex((t) => t && t.id === trackId);
  if (fromPos === -1) return animData;

  const targetIndex = Math.max(0, Math.min(sorted.length - 1, newIndex));
  if (sorted[fromPos].index === targetIndex && fromPos === targetIndex) {
    return animData;
  }

  // Splice-move the track to the target position.
  const [moved] = sorted.splice(fromPos, 1);
  sorted.splice(targetIndex, 0, moved);

  // Re-stamp every track's `index` to its position in the sorted
  // array. Shallow-clone each track to keep immutability.
  const restamped = sorted.map((t, i) => ({ ...t, index: i }));

  return { ...animData, nlaTracks: restamped };
}

/**
 * Convert a pixel delta on the timeline to ms, given the visible
 * span + lane width. Pure helper for the drag handlers.
 *
 * @param {number} deltaPx
 * @param {number} minMs
 * @param {number} maxMs
 * @param {number} pxWidth
 * @returns {number}
 */
export function pxDeltaToMs(deltaPx, minMs, maxMs, pxWidth) {
  if (pxWidth <= 0) return 0;
  const span = Math.max(1, maxMs - minMs);
  return (deltaPx / pxWidth) * span;
}

/**
 * Convert a pixel position on the timeline to absolute ms.
 *
 * @param {number} px
 * @param {number} minMs
 * @param {number} maxMs
 * @param {number} pxWidth
 * @returns {number}
 */
export function pxToMs(px, minMs, maxMs, pxWidth) {
  if (pxWidth <= 0) return minMs;
  const span = Math.max(1, maxMs - minMs);
  return minMs + (px / pxWidth) * span;
}

// ===========================================================================
// Slice 4.D.3 — affordance setters / togglers
// ===========================================================================

/**
 * Locate a track by id within an animData. Returns the index + ref.
 *
 * @param {object} animData
 * @param {string} trackId
 * @returns {{ trackIdx: number, track: object|null }}
 */
function locateTrack(animData, trackId) {
  const tracks = Array.isArray(animData?.nlaTracks) ? animData.nlaTracks : null;
  if (!tracks) return { trackIdx: -1, track: null };
  for (let ti = 0; ti < tracks.length; ti++) {
    if (tracks[ti] && tracks[ti].id === trackId) {
      return { trackIdx: ti, track: tracks[ti] };
    }
  }
  return { trackIdx: -1, track: null };
}

/**
 * Immutable patch of a single track within animData. Shallow-clones
 * the tracks array + the touched track only.
 *
 * @param {object} animData
 * @param {number} trackIdx
 * @param {object} newTrack
 * @returns {object}
 */
function patchTrack(animData, trackIdx, newTrack) {
  const tracks = animData.nlaTracks.slice();
  tracks[trackIdx] = newTrack;
  return { ...animData, nlaTracks: tracks };
}

/**
 * Predicate: would the blend-mode change actually mutate anything?
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {string} blendmode
 * @returns {boolean}
 */
export function wouldSetStripBlendModeChange(animData, trackId, stripId, blendmode) {
  const { strip } = locateStrip(animData, trackId, stripId);
  if (!strip) return false;
  if (!NLA_BLEND_MODES.includes(/** @type {any} */ (blendmode))) return false;
  return strip.blendmode !== blendmode;
}

/**
 * Set a strip's blend mode. Throws on unknown mode per Rule №1 — no
 * silent fallback (validating against `NLA_BLEND_MODES` matches the
 * substrate-level constructor enforcement in `makeNlaStrip`).
 *
 * Cite: `rna_nla.cc:833-838` exposes `blend_type` as an enum backed by
 * `rna_enum_nla_mode_blend_items` (the 4-mode enum SS ships;
 * `combine` deferred per Phase 4 plan §4.B).
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {string} blendmode
 * @returns {object} new animData (same reference if no-op)
 */
export function applySetStripBlendMode(animData, trackId, stripId, blendmode) {
  if (!NLA_BLEND_MODES.includes(/** @type {any} */ (blendmode))) {
    throw new Error(
      `applySetStripBlendMode: blendmode '${blendmode}' not in `
      + `${NLA_BLEND_MODES.join('|')} (combine deferred per plan §4.B)`
    );
  }
  const { trackIdx, stripIdx, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || trackIdx === -1) return animData;
  if (strip.blendmode === blendmode) return animData;
  return patchStrip(animData, trackIdx, stripIdx, { ...strip, blendmode });
}

/**
 * Predicate: would the extend-mode change mutate anything?
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {string} extendmode
 * @returns {boolean}
 */
export function wouldSetStripExtendModeChange(animData, trackId, stripId, extendmode) {
  const { strip } = locateStrip(animData, trackId, stripId);
  if (!strip) return false;
  if (!NLA_EXTEND_MODES.includes(/** @type {any} */ (extendmode))) return false;
  return strip.extendmode !== extendmode;
}

/**
 * Set a strip's extend (extrapolation) mode. Throws on unknown mode.
 *
 * Cite: `rna_nla.cc:826-831` exposes `extrapolation` as an enum backed
 * by `rna_enum_nla_mode_extend_items`. SS ships all 3 modes (hold /
 * hold_forward / nothing) per Slice 4.A.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {string} extendmode
 * @returns {object}
 */
export function applySetStripExtendMode(animData, trackId, stripId, extendmode) {
  if (!NLA_EXTEND_MODES.includes(/** @type {any} */ (extendmode))) {
    throw new Error(
      `applySetStripExtendMode: extendmode '${extendmode}' not in `
      + `${NLA_EXTEND_MODES.join('|')}`
    );
  }
  const { trackIdx, stripIdx, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || trackIdx === -1) return animData;
  if (strip.extendmode === extendmode) return animData;
  return patchStrip(animData, trackIdx, stripIdx, { ...strip, extendmode });
}

/**
 * Predicate: would the influence change mutate anything?
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} influence
 * @returns {boolean}
 */
export function wouldSetStripInfluenceChange(animData, trackId, stripId, influence) {
  const { strip } = locateStrip(animData, trackId, stripId);
  if (!strip) return false;
  if (!Number.isFinite(influence)) return false;
  const clamped = Math.max(0, Math.min(1, influence));
  return Math.abs(clamped - strip.influence) > 1e-10;
}

/**
 * Set a strip's baseline influence value. Clamps to [0, 1] per
 * Blender `rna_nla.cc:1069-1072` (`PROP_FACTOR`, `range(0, 1)`).
 *
 * **SS DEVIATION — always-editable baseline** (audit-fix Slice 4.D.3
 * HIGH-F1). Blender's per-strip `influence` slider at `nla_buttons.cc:551`
 * is gated at `:550` by `layout.enabled_set(use_animated_influence)` —
 * meaning the Blender UI DISABLES the per-strip baseline slider unless
 * `NLASTRIP_FLAG.USR_INFLUENCE` is set. SS does NOT gate this setter
 * on USR_INFLUENCE; the data field is always writable and the UI gate
 * Blender adds is treated as an affordance, not a data invariant.
 *
 * (The pre-audit-fix JSDoc cited `nla_buttons.cc:357` as evidence
 * Blender has an "always-live baseline slider" — that line is actually
 * AnimData-level `action_influence` on `&adt_ptr`, NOT the per-strip
 * `&strip_ptr` `influence`. Two different RNA properties on two
 * different ID-blocks. The miscitation conflated them; this is the
 * corrected statement.)
 *
 * **Rule №1 contract** (audit-fix Slice 4.D.3 MED-A1): throws on
 * non-finite inputs (NaN / Infinity) — matches the throw-on-invalid
 * contract of `applySetStripBlendMode` / `applySetStripExtendMode`.
 * Pre-audit-fix the setter silently returned same-ref animData on
 * NaN/Infinity, hiding caller bugs. The wouldChange predicate still
 * returns `false` on non-finite (a non-throw is appropriate for a
 * "would this op be a no-op" query).
 *
 * Note: this writes the BASELINE `influence` field — when
 * `NLASTRIP_FLAG.USR_INFLUENCE` is set, the evaluator reads from a
 * local F-Curve instead (per Slice 4.B `computeStripInfluence`); the
 * stored baseline is the F-Curve's initial value.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @param {number} influence — must be a finite number; throws otherwise
 * @returns {object}
 */
export function applySetStripInfluence(animData, trackId, stripId, influence) {
  if (!Number.isFinite(influence)) {
    throw new Error(
      `applySetStripInfluence: influence must be a finite number, got ${influence}`
    );
  }
  const { trackIdx, stripIdx, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || trackIdx === -1) return animData;
  const clamped = Math.max(0, Math.min(1, influence));
  if (Math.abs(clamped - strip.influence) < 1e-10) return animData;
  return patchStrip(animData, trackIdx, stripIdx, { ...strip, influence: clamped });
}

/**
 * Toggle `NLASTRIP_FLAG.MUTED` on a strip. Returns NEW animData.
 *
 * Per Blender `rna_nla.cc:1126-1129` `mute` boolean property bound to
 * `NLASTRIP_FLAG_MUTED` via `RNA_def_property_boolean_sdna`. It's a
 * regular flag toggle, not a cascade like solo. The panel checkbox
 * surface is at `nla_buttons.cc:392` (`row.prop(&strip_ptr, "mute", ...)`
 * inside `nla_panel_stripname`).
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @returns {object}
 */
export function applyToggleStripMuted(animData, trackId, stripId) {
  const { trackIdx, stripIdx, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || trackIdx === -1) return animData;
  const oldFlag = typeof strip.flag === 'number' ? strip.flag : 0;
  const newFlag = oldFlag ^ NLASTRIP_FLAG.MUTED;
  return patchStrip(animData, trackIdx, stripIdx, { ...strip, flag: newFlag });
}

/**
 * Toggle `NLATRACK_FLAG.MUTED` on a track. Returns NEW animData.
 *
 * Per Blender `anim_channels_edit.cc` `ACHANNEL_SETTING_MUTE` toggle —
 * straight XOR, no cascade.
 *
 * @param {object} animData
 * @param {string} trackId
 * @returns {object}
 */
export function applyToggleTrackMuted(animData, trackId) {
  const { trackIdx, track } = locateTrack(animData, trackId);
  if (!track || trackIdx === -1) return animData;
  const oldFlag = typeof track.flag === 'number' ? track.flag : 0;
  const newFlag = oldFlag ^ NLATRACK_FLAG.MUTED;
  return patchTrack(animData, trackIdx, { ...track, flag: newFlag });
}

/**
 * Toggle `NLATRACK_FLAG.PROTECTED` on a track. Returns NEW animData.
 *
 * Per Blender `ACHANNEL_SETTING_PROTECT` toggle — straight XOR.
 *
 * @param {object} animData
 * @param {string} trackId
 * @returns {object}
 */
export function applyToggleTrackProtected(animData, trackId) {
  const { trackIdx, track } = locateTrack(animData, trackId);
  if (!track || trackIdx === -1) return animData;
  const oldFlag = typeof track.flag === 'number' ? track.flag : 0;
  const newFlag = oldFlag ^ NLATRACK_FLAG.PROTECTED;
  return patchTrack(animData, trackIdx, { ...track, flag: newFlag });
}

/**
 * Toggle SOLO on a track — byte-faithful port of `BKE_nlatrack_solo_toggle`
 * (`reference/blender/source/blender/blenkernel/intern/nla.cc:1262-1292`).
 *
 * Solo is EXCLUSIVE — at most one track per animData can be soloed
 * at any time. Behaviour matches Blender exactly:
 *
 *   1. Clear `NLATRACK_FLAG.SOLO` on every OTHER track first.
 *   2. XOR-toggle `NLATRACK_FLAG.SOLO` on the target track.
 *   3. If target now has SOLO set → set `ADT_FLAG.NLA_SOLO_TRACK` on
 *      the animData. Otherwise clear it.
 *
 * Evaluator (`nlaEval.js` `evaluateNla`) reads `ADT_FLAG.NLA_SOLO_TRACK`
 * + per-track SOLO bit to decide which tracks contribute — this op
 * keeps the two in sync.
 *
 * @param {object} animData
 * @param {string} trackId
 * @returns {object}
 */
export function applyToggleTrackSolo(animData, trackId) {
  const { trackIdx } = locateTrack(animData, trackId);
  if (trackIdx === -1) return animData;
  const tracksRef = animData.nlaTracks;

  // Step 1 + 2: walk every track, building a new array. The target
  // gets XOR-toggle; others get SOLO bit force-cleared.
  const newTracks = new Array(tracksRef.length);
  let targetNowSoloed = false;
  for (let i = 0; i < tracksRef.length; i++) {
    const t = tracksRef[i];
    if (!t) { newTracks[i] = t; continue; }
    const flag = typeof t.flag === 'number' ? t.flag : 0;
    if (i === trackIdx) {
      const newFlag = flag ^ NLATRACK_FLAG.SOLO;
      targetNowSoloed = (newFlag & NLATRACK_FLAG.SOLO) !== 0;
      newTracks[i] = { ...t, flag: newFlag };
    } else if ((flag & NLATRACK_FLAG.SOLO) !== 0) {
      newTracks[i] = { ...t, flag: flag & ~NLATRACK_FLAG.SOLO };
    } else {
      newTracks[i] = t;   // no SOLO bit + not target — preserve ref
    }
  }

  // Step 3: sync ADT_FLAG.NLA_SOLO_TRACK on the animData.
  const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
  const newAdtFlag = targetNowSoloed
    ? adtFlag | ADT_FLAG.NLA_SOLO_TRACK
    : adtFlag & ~ADT_FLAG.NLA_SOLO_TRACK;

  return { ...animData, nlaTracks: newTracks, flag: newAdtFlag };
}

// ===========================================================================
// Slice 4.D.4 — CRUD + Push Action Down
// ===========================================================================

/**
 * Read an action's duration from the project (ms). Reads with precedence
 * `frameEnd - frameStart` > `duration` > `MIN_STRIP_MS`. Returns at least
 * `MIN_STRIP_MS` so the created strip is non-empty + user-resizable.
 *
 * Per `feedback_ms_canonical_animation_time`: post-v36 the action shape
 * stores frame fields as ms.
 *
 * @param {object|null|undefined} project
 * @param {string|null|undefined} actionId
 * @returns {number} ms (>= MIN_STRIP_MS)
 */
function readActionDurationMs(project, actionId) {
  if (!actionId || !project || !Array.isArray(project.actions)) return MIN_STRIP_MS;
  for (const a of project.actions) {
    if (!a || a.id !== actionId) continue;
    const fs = typeof a.frameStart === 'number' ? a.frameStart : null;
    const fe = typeof a.frameEnd === 'number' ? a.frameEnd : null;
    if (fs !== null && fe !== null) {
      const d = Math.max(0, fe - fs);
      return d > 0 ? d : MIN_STRIP_MS;
    }
    if (typeof a.duration === 'number') {
      return a.duration > 0 ? a.duration : MIN_STRIP_MS;
    }
    return MIN_STRIP_MS;
  }
  return MIN_STRIP_MS;
}

/**
 * Read an action's actstart (frame range start) from the project.
 * Defaults to 0 if not set.
 *
 * @param {object|null|undefined} project
 * @param {string|null|undefined} actionId
 * @returns {number} ms
 */
function readActionStartMs(project, actionId) {
  if (!actionId || !project || !Array.isArray(project.actions)) return 0;
  for (const a of project.actions) {
    if (!a || a.id !== actionId) continue;
    return typeof a.frameStart === 'number' ? a.frameStart : 0;
  }
  return 0;
}

/**
 * Read an action's name from the project. Returns the actionId itself
 * if the action has no name or doesn't exist.
 *
 * Used for fallback track naming in `applyPushActionDown` to mirror
 * Blender's `STRNCPY_UTF8(nlt->name, adt->action->id.name + 2)` at
 * `nla.cc:617`. **Equivalent semantic, not byte-identical** (audit-fix
 * Slice 4.D.4 LOW-A1): Blender's `id.name + 2` strips the 2-char
 * ID-block prefix ("AC" for actions) from the underlying ID name; SS
 * uses `action.name` directly because SS's action shape stores the
 * display string in `.name` without any prefix to strip (SS has no
 * ID-block-name concept). Both produce the user-visible action name.
 *
 * @param {object|null|undefined} project
 * @param {string|null|undefined} actionId
 * @returns {string}
 */
function readActionName(project, actionId) {
  if (!actionId) return '';
  if (!project || !Array.isArray(project.actions)) return actionId;
  for (const a of project.actions) {
    if (!a || a.id !== actionId) continue;
    return typeof a.name === 'string' && a.name.length > 0 ? a.name : actionId;
  }
  return actionId;
}

/**
 * Generate a unique track name within the animData's tracks. Probes
 * `base`, `base.001`, `base.002` ... in Blender style
 * (`BKE_id_new_name_validate` / `bUniqueName` naming convention with
 * `.NNN` suffix). Returns the first non-colliding name.
 *
 * @param {object[]} existingTracks — `animData.nlaTracks` (may have entries with .name)
 * @param {string} base
 * @returns {string}
 */
function uniqueTrackName(existingTracks, base) {
  const used = new Set();
  if (Array.isArray(existingTracks)) {
    for (const t of existingTracks) {
      if (t && typeof t.name === 'string') used.add(t.name);
    }
  }
  if (!used.has(base)) return base;
  for (let i = 1; i < 10000; i++) {
    const candidate = `${base}.${String(i).padStart(3, '0')}`;
    if (!used.has(candidate)) return candidate;
  }
  // Audit-fix Slice 4.D.4 L1: throw per Rule №1 rather than silent
  // Date.now() fallback. 10k tracks with the same base name is a
  // data-model invariant violation.
  throw new Error(
    `uniqueTrackName: 10,000 collision attempts with base '${base}'`
    + ` — data-model invariant violation`,
  );
}

/**
 * Generate a unique strip id within a track. Strip ids must be unique
 * within their track per the Slice 4.A id contract. Used by addStrip
 * + pushActionDown to mint fresh ids that won't collide.
 *
 * @param {object[]} existingStrips
 * @param {string} prefix
 * @returns {string}
 */
function uniqueStripId(existingStrips, prefix) {
  const used = new Set();
  if (Array.isArray(existingStrips)) {
    for (const s of existingStrips) {
      if (s && typeof s.id === 'string') used.add(s.id);
    }
  }
  for (let i = 0; i < 100000; i++) {
    const candidate = i === 0 ? prefix : `${prefix}_${i}`;
    if (!used.has(candidate)) return candidate;
  }
  // Audit-fix Slice 4.D.4 L1: throw per Rule №1 rather than silent
  // Date.now() fallback. 100k strips on a single track is already a
  // data-model invariant violation; surface loudly so the caller
  // sees the bug instead of inheriting a brittle id.
  throw new Error(
    `uniqueStripId: 100,000 collision attempts with prefix '${prefix}'`
    + ` — data-model invariant violation (single-track strip count)`,
  );
}

/**
 * Add a new empty NlaTrack to the top of the stack. Returns a NEW
 * animData with the track appended. Default name is "NlaTrack" with
 * a `.NNN` suffix appended on collision. Index is set to the new
 * position (current length).
 *
 * **No `wouldAddTrackChange` predicate** — adding is never a no-op,
 * so the +Track UI affordance never disables. The earlier API-
 * symmetry export was removed in audit-fix Slice 4.D.4 MED-A3 (dead
 * surface — never imported or tested).
 *
 * @param {object} animData
 * @param {string} [baseName] - defaults to "NlaTrack"
 * @returns {object} new animData (NEVER same-ref — adding always changes state)
 */
export function applyAddTrack(animData, baseName = 'NlaTrack') {
  if (!animData || typeof animData !== 'object') return animData;
  const tracksRef = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : [];
  const name = uniqueTrackName(tracksRef, baseName);
  const id = uniqueStripId(
    /** @type {object[]} */ (tracksRef.map((t) => /** @type {object} */ ({ id: t?.id ?? '' }))),
    'track',
  );
  const newTrack = makeNlaTrack(id, name, { index: tracksRef.length });
  return { ...animData, nlaTracks: [...tracksRef, newTrack] };
}

/**
 * Find the leftmost free range on a track of at least `durationMs`
 * starting at or after `minStartMs`. Returns the start position. If
 * `minStartMs` already has space, returns `minStartMs`; otherwise
 * scans rightward past existing strips.
 *
 * @param {object[]} strips
 * @param {number} durationMs
 * @param {number} minStartMs
 * @returns {number}
 */
function findFreeRangeStart(strips, durationMs, minStartMs) {
  if (!Array.isArray(strips) || strips.length === 0) return Math.max(0, minStartMs);
  // Sort strips by start so we can scan in order
  const sorted = strips.slice().sort((a, b) => (a?.start ?? 0) - (b?.start ?? 0));
  let cursor = Math.max(0, minStartMs);
  for (const s of sorted) {
    if (!s) continue;
    const sStart = typeof s.start === 'number' ? s.start : 0;
    const sEnd = typeof s.end === 'number' ? s.end : sStart;
    if (cursor + durationMs <= sStart) {
      // Free range here
      return cursor;
    }
    if (sEnd > cursor) cursor = sEnd;
  }
  return cursor;
}

/**
 * Predicate: would adding a strip succeed? Returns false if the track
 * is PROTECTED OR if the action can't be found in the project OR if
 * the requested startMs has no room for the action's duration AND no
 * free range exists rightward (effectively never, since findFreeRangeStart
 * always returns a position, so this collapses to the PROTECTED +
 * missing-action checks).
 *
 * @param {object} animData
 * @param {object|null|undefined} project
 * @param {string} trackId
 * @param {string} actionId
 * @returns {boolean}
 */
export function wouldAddStripChange(animData, project, trackId, actionId) {
  if (typeof actionId !== 'string' || actionId.length === 0) return false;
  const { track } = locateTrack(animData, trackId);
  if (!track) return false;
  const trackFlag = typeof track.flag === 'number' ? track.flag : 0;
  if ((trackFlag & NLATRACK_FLAG.PROTECTED) !== 0) return false;
  if (!project || !Array.isArray(project.actions)) return false;
  if (!project.actions.some((a) => a && a.id === actionId)) return false;
  return true;
}

/**
 * Add a new NlaStrip to a track, referencing actionId. Derives
 * `actstart`/`actend`/`end` from the action's frame range. Honors
 * Blender's `BKE_nlastrips_has_space` overlap rejection: if the
 * requested `startMs` would overlap an existing strip, auto-scans
 * rightward past existing strips for the leftmost free range
 * (matching Blender's "add to last track first, else new track"
 * fallback behavior at the strip-positioning level).
 *
 * Refuses (returns same-ref) if the track is PROTECTED (per
 * `BKE_nlatrack_add_strip` `nla.cc:1361-1379`) OR if the action
 * doesn't exist in the project (Rule №1 — no silent fallback to
 * "create-without-action" since `makeNlaStrip` would throw).
 *
 * @param {object} animData
 * @param {object|null|undefined} project — to resolve action duration + name
 * @param {string} trackId
 * @param {string} actionId
 * @param {number} [minStartMs] - defaults to 0
 * @returns {object}
 */
export function applyAddStrip(animData, project, trackId, actionId, minStartMs = 0) {
  if (!wouldAddStripChange(animData, project, trackId, actionId)) return animData;
  const { trackIdx, track } = locateTrack(animData, trackId);
  if (!track || trackIdx === -1) return animData;
  const stripsRef = Array.isArray(track.strips) ? track.strips : [];

  const duration = readActionDurationMs(project, actionId);
  const actstart = readActionStartMs(project, actionId);
  const startMs = findFreeRangeStart(stripsRef, duration, Math.max(0, minStartMs));

  const stripId = uniqueStripId(stripsRef, `strip_${actionId}`);
  const stripName = readActionName(project, actionId) || stripId;
  const newStrip = makeNlaStrip(stripId, actionId, {
    name: stripName,
    start: startMs,
    end: startMs + duration,
    actstart,
    actend: actstart + duration,
  });

  // Insert sorted by start ascending (matches Blender's
  // BKE_nlastrips_add_strip_unsafe chronological-insertion semantic).
  const newStrips = [...stripsRef, newStrip].sort((a, b) => (a?.start ?? 0) - (b?.start ?? 0));
  const newTracks = animData.nlaTracks.slice();
  newTracks[trackIdx] = { ...track, strips: newStrips };
  return { ...animData, nlaTracks: newTracks };
}

/**
 * Predicate: can the strip be removed? Returns false if the strip is
 * the current tweak strip OR the parent track is PROTECTED OR the
 * strip doesn't exist.
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @returns {boolean}
 */
export function wouldRemoveStripChange(animData, trackId, stripId) {
  const { track, strip } = locateStrip(animData, trackId, stripId);
  if (!strip || !track) return false;
  const trackFlag = typeof track.flag === 'number' ? track.flag : 0;
  if ((trackFlag & NLATRACK_FLAG.PROTECTED) !== 0) return false;
  if (animData?.tweakStripId === stripId) return false;
  return true;
}

/**
 * Remove a strip from its track. Refuses (returns same-ref) if:
 *   - The strip is the current tweak strip (Rule №1 — caller must
 *     `exitTweakMode` first; mirrors Blender's defensive call at
 *     `nla_edit.cc:1297`).
 *   - The parent track is PROTECTED (per `BKE_nlatrack_add_strip`
 *     PROTECTED gate at `nla.cc:1361-1379` — Blender's track-level
 *     edit lock applies to remove as well as add).
 *   - The strip doesn't exist.
 *
 * Track is left in place even if it becomes empty (mirrors Blender —
 * delete-strip doesn't cascade to delete-track).
 *
 * @param {object} animData
 * @param {string} trackId
 * @param {string} stripId
 * @returns {object}
 */
export function applyRemoveStrip(animData, trackId, stripId) {
  if (!wouldRemoveStripChange(animData, trackId, stripId)) return animData;
  const { trackIdx, stripIdx, track } = locateStrip(animData, trackId, stripId);
  if (!track || trackIdx === -1 || stripIdx === -1) return animData;
  const newStrips = track.strips.slice();
  newStrips.splice(stripIdx, 1);
  const newTracks = animData.nlaTracks.slice();
  newTracks[trackIdx] = { ...track, strips: newStrips };
  return { ...animData, nlaTracks: newTracks };
}

/**
 * Predicate: can the track be removed? Returns false if PROTECTED, if
 * the track contains the current tweak strip, or if it doesn't exist.
 *
 * @param {object} animData
 * @param {string} trackId
 * @returns {boolean}
 */
export function wouldRemoveTrackChange(animData, trackId) {
  const { track } = locateTrack(animData, trackId);
  if (!track) return false;
  const trackFlag = typeof track.flag === 'number' ? track.flag : 0;
  if ((trackFlag & NLATRACK_FLAG.PROTECTED) !== 0) return false;
  const tweakStripId = animData?.tweakStripId;
  if (tweakStripId && Array.isArray(track.strips)) {
    for (const s of track.strips) {
      if (s && s.id === tweakStripId) return false;
    }
  }
  return true;
}

/**
 * Remove a track + all its strips. Refuses (returns same-ref) if:
 *   - The track is PROTECTED.
 *   - The track contains the current tweak strip.
 *   - The track doesn't exist.
 *
 * If the removed track had `NLATRACK_FLAG.SOLO` set, also clears
 * `ADT_FLAG.NLA_SOLO_TRACK` on the animData per Blender's
 * `nla_tracks.cc:736-738`. Re-stamps remaining tracks' `index` to
 * contiguous integers per Slice 4.C audit-fix MED-A3 contract.
 *
 * @param {object} animData
 * @param {string} trackId
 * @returns {object}
 */
export function applyRemoveTrack(animData, trackId) {
  if (!wouldRemoveTrackChange(animData, trackId)) return animData;
  const { trackIdx, track } = locateTrack(animData, trackId);
  if (!track || trackIdx === -1) return animData;

  const tracksRef = animData.nlaTracks;
  const wasSolo = ((typeof track.flag === 'number' ? track.flag : 0)
    & NLATRACK_FLAG.SOLO) !== 0;

  // Drop the track, then re-stamp every remaining track's index by
  // current position in the bottom-to-top sort.
  const remaining = tracksRef
    .filter((_, i) => i !== trackIdx)
    .slice()
    .sort((a, b) => {
      const ai = typeof a?.index === 'number' ? a.index : 0;
      const bi = typeof b?.index === 'number' ? b.index : 0;
      return ai - bi;
    })
    .map((t, i) => ({ ...t, index: i }));

  const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
  const newAdtFlag = wasSolo
    ? adtFlag & ~ADT_FLAG.NLA_SOLO_TRACK
    : adtFlag;

  return { ...animData, nlaTracks: remaining, flag: newAdtFlag };
}

/**
 * Predicate: would Push Action Down do anything? Returns true iff
 * `animData.actionId` is set AND animData is not in tweak mode.
 *
 * @param {object} animData
 * @returns {boolean}
 */
export function wouldPushActionDownChange(animData) {
  if (!animData || typeof animData !== 'object') return false;
  if (isTweakModeOn(animData)) return false;
  if (typeof animData.actionId !== 'string' || animData.actionId.length === 0) return false;
  return true;
}

/**
 * Push the currently-active action down onto the NLA stack as a new
 * strip on the top track (or a new track if the top is full).
 *
 * Byte-faithful port of `BKE_nla_action_pushdown` (`nla.cc:2248-2294`).
 * SS deviation: no `act_blendmode`/`act_influence`/`act_extendmode`
 * inheritance (SS schema doesn't carry those AnimData fields — see
 * module-level DEVIATION 13 + 14).
 *
 * Behavior:
 *   1. Refuses if not in pushable state (no actionId OR in tweak mode).
 *      Tweak-mode refusal mirrors Blender's `nlaop_poll_tweakmode_off`
 *      poll function on the operator.
 *   2. Creates a strip from the active action via `makeNlaStrip` +
 *      derives bounds from the action's frame range.
 *   3. Tries the LAST track (top of stack) first (per Blender
 *      `nla.cc:608-609`). Adds via `applyAddStrip` — which auto-
 *      positions rightward per SS DEVIATION 15. The only way the
 *      top-track-try returns same-ref is if the top track is
 *      PROTECTED (or doesn't exist). On that rejection, creates a
 *      new track named after the action (per `nla.cc:617`) and adds
 *      there instead.
 *   4. Clears `animData.actionId` + `slotHandle` after successful push.
 *
 * @param {object} animData
 * @param {object|null|undefined} project — to resolve action duration + name
 * @returns {object}
 */
export function applyPushActionDown(animData, project) {
  if (!wouldPushActionDownChange(animData)) return animData;
  const actionId = animData.actionId;

  // Try the LAST (top-of-stack) track first.
  const tracksRef = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : [];
  let workingAd = animData;
  let pushed = false;

  if (tracksRef.length > 0) {
    // Find the track with the highest index (top of bottom-to-top stack)
    let topTrack = tracksRef[0];
    let topIdx = typeof topTrack?.index === 'number' ? topTrack.index : 0;
    for (const t of tracksRef) {
      const i = typeof t?.index === 'number' ? t.index : 0;
      if (i >= topIdx) { topTrack = t; topIdx = i; }
    }
    if (topTrack) {
      const tryAdd = applyAddStrip(workingAd, project, topTrack.id, actionId, 0);
      if (tryAdd !== workingAd) {
        workingAd = tryAdd;
        pushed = true;
      }
    }
  }

  if (!pushed) {
    // Create a new track named after the action + add the strip there.
    // Naming: Blender uses `adt->action->id.name + 2` (strips the "AC"
    // ID prefix). SS uses the action's display name directly via
    // readActionName.
    const trackName = readActionName(project, actionId) || 'NlaTrack';
    const withTrack = applyAddTrack(workingAd, trackName);
    const newTrack = withTrack.nlaTracks[withTrack.nlaTracks.length - 1];
    const withStrip = applyAddStrip(withTrack, project, newTrack.id, actionId, 0);
    if (withStrip !== withTrack) {
      workingAd = withStrip;
      pushed = true;
    }
    // If the strip-add ALSO failed (action missing from project, or
    // some other applyAddStrip refusal), DON'T commit the half-baked
    // state — Rule №1 forbids silent half-success. Return original
    // animData; caller sees no change + can introspect via
    // wouldPushActionDownChange (which doesn't gate on action-presence
    // but DOES gate on tweak-mode + actionId-set).
  }

  if (!pushed) {
    return animData;
  }

  // Clear the active action per Blender nla.cc:2266.
  return {
    ...workingAd,
    actionId: null,
    slotHandle: 0,
  };
}
