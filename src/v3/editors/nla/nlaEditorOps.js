// @ts-check

/**
 * NLAEditor pure-function operations layer — Animation Phase 4 Slice
 * 4.D.2 (drag interactions data substrate).
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
 * # No-overlap enforcement (SS DEVIATION, documented)
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
 * shift if they want clean separation. Slice 4.D.4 may add opt-in
 * "auto-separate on drop" if user feedback requests it.
 *
 * @module v3/editors/nla/nlaEditorOps
 */

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
