// @ts-check

/**
 * NLAEditor data-shape selectors — Animation Phase 4 Slice 4.D.1.
 *
 * Pure functions that translate the project / animData state into
 * editor-friendly row shapes for `NLAEditor.jsx`. Splitting the data
 * derivation out of the JSX keeps the React component small + makes
 * the rendering contract testable without a DOM.
 *
 * # Architecture parallel
 *
 * Mirrors `src/v3/editors/fcurve/fcurveModifiersPanelData.js`
 * (Slice 3.C UI pattern): pure-function data layer with `would*Change`
 * predicates + `apply*` mutators. 4.D.1 ships **read-only selectors**
 * only; mutators land in 4.D.2 / 4.D.3 / 4.D.4 as drag / dropdown /
 * operator helpers respectively.
 *
 * # Track-row shape
 *
 * Each animData-bearing Object (part / group / `__scene__`) contributes
 * a "group" header followed by N track rows (one per `animData.nlaTracks[]`).
 * Tracks are surfaced in **bottom-to-top** order (matching evaluator
 * order — ascending `index`).
 *
 * @module v3/editors/nla/nlaEditorData
 */

import {
  NLASTRIP_FLAG,
  NLATRACK_FLAG,
  ADT_FLAG,
  isNlaTrack,
  isNlaStrip,
} from '../../../anim/nla.js';

/**
 * @typedef {Object} NlaStripRow
 * @property {string} id
 * @property {string} name
 * @property {string|null} actionId
 * @property {string} actionName
 * @property {number} start           ms
 * @property {number} end             ms
 * @property {string} blendmode
 * @property {string} extendmode
 * @property {number} influence       0..1 baseline (NOT the live-ramped value)
 * @property {boolean} muted          NLASTRIP_FLAG.MUTED
 * @property {boolean} selected       NLASTRIP_FLAG.SELECT
 * @property {boolean} tweakuser      NLASTRIP_FLAG.TWEAKUSER (shares the tweaked action)
 * @property {boolean} isTweakStrip   currently being tweaked
 */

/**
 * @typedef {Object} NlaTrackRow
 * @property {string} id
 * @property {string} name
 * @property {number} index            bottom-to-top (0 = bottom)
 * @property {boolean} muted           NLATRACK_FLAG.MUTED
 * @property {boolean} solo            NLATRACK_FLAG.SOLO
 * @property {boolean} protected_      NLATRACK_FLAG.PROTECTED (suffix _ since `protected` is reserved)
 * @property {boolean} disabled        NLATRACK_FLAG.DISABLED (tweak-mode runtime)
 * @property {boolean} enabled         computed: solo logic + mute → "does this track contribute to eval"
 * @property {NlaStripRow[]} strips    strip rows in time order
 */

/**
 * @typedef {Object} NlaObjectGroup
 * @property {string} objectId
 * @property {string} objectName
 * @property {string} objectType       'part' | 'group' | 'scene'
 * @property {NlaTrackRow[]} tracks    bottom-to-top
 * @property {boolean} tweakModeOn     ADT_FLAG.NLA_EDIT_ON
 * @property {boolean} soloActive      ADT_FLAG.NLA_SOLO_TRACK
 * @property {string|null} tweakTrackId
 * @property {string|null} tweakStripId
 */

/**
 * Map an action id to its display name (defensive — returns the id
 * itself if the action has no name OR doesn't exist in the project).
 *
 * @param {object|null|undefined} project
 * @param {string|null|undefined} actionId
 * @returns {string}
 */
function actionDisplayName(project, actionId) {
  if (!actionId) return '(no action)';
  if (!project || !Array.isArray(project.actions)) return actionId;
  for (const a of project.actions) {
    if (a && a.id === actionId) {
      return typeof a.name === 'string' && a.name.length > 0 ? a.name : a.id;
    }
  }
  return actionId;   // dangling reference — surface the id for user diagnostics
}

/**
 * Strip → row, defensive on missing fields.
 *
 * @param {object} strip
 * @param {object|null|undefined} project
 * @param {string|null} tweakStripId
 * @param {string|null} tweakedActionId — the action being tweaked, for TWEAKUSER tagging
 * @returns {NlaStripRow|null} null if strip shape is invalid
 */
function buildStripRow(strip, project, tweakStripId, tweakedActionId) {
  if (!isNlaStrip(strip)) return null;
  const flag = typeof strip.flag === 'number' ? strip.flag : 0;
  return {
    id: strip.id,
    name: typeof strip.name === 'string' ? strip.name : strip.id,
    actionId: strip.actionId ?? null,
    actionName: actionDisplayName(project, strip.actionId),
    start: strip.start,
    end: strip.end,
    blendmode: strip.blendmode,
    extendmode: strip.extendmode,
    influence: typeof strip.influence === 'number' ? strip.influence : 1,
    muted: (flag & NLASTRIP_FLAG.MUTED) !== 0,
    selected: (flag & NLASTRIP_FLAG.SELECT) !== 0,
    tweakuser: (flag & NLASTRIP_FLAG.TWEAKUSER) !== 0,
    isTweakStrip: tweakStripId !== null && strip.id === tweakStripId,
  };
}

/**
 * Compute the "enabled" predicate for a track given AnimData mute/solo state.
 *
 * Mirrors `BKE_nlatrack_is_enabled` (`nla.cc:690-697`) without the
 * DISABLED bit (which is a transient tweak-mode flag — surfaced
 * separately in `NlaTrackRow.disabled` for the UI to render the "this
 * track is suppressed by tweak mode" indicator).
 *
 * @param {number} adtFlag
 * @param {number} trackFlag
 * @returns {boolean}
 */
function isTrackEnabled(adtFlag, trackFlag) {
  if (adtFlag & ADT_FLAG.NLA_SOLO_TRACK) {
    return (trackFlag & NLATRACK_FLAG.SOLO) !== 0;
  }
  return (trackFlag & NLATRACK_FLAG.MUTED) === 0;
}

/**
 * Build the full set of {object → tracks} row data for the NLAEditor
 * surface.
 *
 * Walks every node carrying `animData` (part / group / `__scene__`).
 * Objects with no tracks are still surfaced — empty `tracks: []` lets
 * the UI render a "(no NLA tracks; click + to add)" placeholder.
 *
 * Tracks are sorted by ascending `index` (bottom-to-top, matching
 * evaluator). Strips inside each track are sorted by `start` (left-to-
 * right on the timeline). Both sorts are stable (Array.sort is
 * stable per ES2019+) — ties keep input order.
 *
 * @param {object|null|undefined} project
 * @returns {NlaObjectGroup[]}
 */
export function buildNlaEditorRows(project) {
  if (!project || !Array.isArray(project.nodes)) return [];
  /** @type {NlaObjectGroup[]} */
  const groups = [];
  for (const node of project.nodes) {
    if (!node || typeof node !== 'object') continue;
    const animData = node.animData;
    if (!animData || typeof animData !== 'object') continue;
    if (node.type !== 'part' && node.type !== 'group' && node.type !== 'scene') continue;

    const adtFlag = typeof animData.flag === 'number' ? animData.flag : 0;
    const tweakStripId = typeof animData.tweakStripId === 'string'
      && animData.tweakStripId.length > 0
      ? animData.tweakStripId : null;
    const tweakedActionId = (adtFlag & ADT_FLAG.NLA_EDIT_ON) !== 0
      ? (typeof animData.actionId === 'string' ? animData.actionId : null)
      : null;

    /** @type {NlaTrackRow[]} */
    const trackRows = [];
    const tracks = Array.isArray(animData.nlaTracks) ? animData.nlaTracks : [];
    // Defensive copy + sort by index ascending. Filter out malformed
    // track shapes via isNlaTrack predicate (defensive — the UI should
    // never crash on a corrupt project; surface only well-formed rows).
    const validTracks = tracks.filter(isNlaTrack);
    const sortedTracks = validTracks.slice().sort((a, b) => a.index - b.index);
    for (const track of sortedTracks) {
      const trackFlag = typeof track.flag === 'number' ? track.flag : 0;
      const stripList = Array.isArray(track.strips) ? track.strips : [];
      /** @type {NlaStripRow[]} */
      const stripRows = [];
      // Sort strips by start ascending (timeline left-to-right)
      const sortedStrips = stripList.slice().sort((a, b) => {
        const as = typeof a?.start === 'number' ? a.start : 0;
        const bs = typeof b?.start === 'number' ? b.start : 0;
        return as - bs;
      });
      for (const strip of sortedStrips) {
        const row = buildStripRow(strip, project, tweakStripId, tweakedActionId);
        if (row) stripRows.push(row);
      }
      trackRows.push({
        id: track.id,
        name: track.name,
        index: track.index,
        muted: (trackFlag & NLATRACK_FLAG.MUTED) !== 0,
        solo: (trackFlag & NLATRACK_FLAG.SOLO) !== 0,
        protected_: (trackFlag & NLATRACK_FLAG.PROTECTED) !== 0,
        disabled: (trackFlag & NLATRACK_FLAG.DISABLED) !== 0,
        enabled: isTrackEnabled(adtFlag, trackFlag),
        strips: stripRows,
      });
    }

    groups.push({
      objectId: node.id,
      objectName: typeof node.name === 'string' && node.name.length > 0 ? node.name : node.id,
      objectType: node.type,
      tracks: trackRows,
      tweakModeOn: (adtFlag & ADT_FLAG.NLA_EDIT_ON) !== 0,
      soloActive: (adtFlag & ADT_FLAG.NLA_SOLO_TRACK) !== 0,
      tweakTrackId: typeof animData.tweakTrackId === 'string' && animData.tweakTrackId.length > 0
        ? animData.tweakTrackId : null,
      tweakStripId,
    });
  }
  return groups;
}

/**
 * Compute the total time span covered by all tracks' strips, used to
 * size the timeline ruler. Returns `{ minMs, maxMs }`. Empty data
 * returns `{ minMs: 0, maxMs: 0 }`.
 *
 * @param {NlaObjectGroup[]} groups
 * @returns {{ minMs: number, maxMs: number }}
 */
export function computeTimelineSpan(groups) {
  if (!Array.isArray(groups) || groups.length === 0) return { minMs: 0, maxMs: 0 };
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const g of groups) {
    for (const t of g.tracks) {
      for (const s of t.strips) {
        if (s.start < minMs) minMs = s.start;
        if (s.end > maxMs) maxMs = s.end;
      }
    }
  }
  if (!Number.isFinite(minMs)) return { minMs: 0, maxMs: 0 };
  // Snap minMs to 0 if it's positive (timeline always starts at 0)
  if (minMs > 0) minMs = 0;
  return { minMs, maxMs };
}

/**
 * Blender-faithful blendmode → display label map. Surfaces the labels
 * Blender uses in `rna_nla.cc:32-61` (`rna_enum_nla_mode_blend_items`):
 *   replace  → "Replace"
 *   add      → "Add"
 *   subtract → "Subtract"
 *   multiply → "Multiply"
 * (combine is deferred per plan §4.B; not in the map.)
 *
 * **Citation-correction note (audit-fix Slice 4.D.1)**: pre-audit-fix
 * this comment cited `rna_nla.cc:236-260` and identifier
 * `rna_enum_nla_strip_mode_items`. Both were fabricated — line range
 * 236-260 is inside `rna_NlaStrip_start_frame_set` (unrelated clamp
 * logic), and the identifier had a transposed word ("strip_mode"
 * instead of "mode_blend"). The label STRINGS were correct against
 * the actual enum at 32-61; only the meta-citation was wrong.
 * Cite-discipline streak (5.P → 3.F/G → 4.A/B/C HOLDS at 5) BROKE on
 * this slice — caught by fidelity audit before user impact, but the
 * fab DID land in commit `5385734`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BLENDMODE_LABELS = Object.freeze({
  replace:  'Replace',
  add:      'Add',
  subtract: 'Subtract',
  multiply: 'Multiply',
});

/**
 * Blender-faithful extendmode → display label map. Surfaces the labels
 * Blender uses in `rna_nla.cc:63-72` (`rna_enum_nla_mode_extend_items`):
 *   hold         → "Hold"
 *   hold_forward → "Hold Forward"
 *   nothing      → "Nothing"
 *
 * Order matches Blender's enum array (NOTHING listed first in Blender,
 * HOLD second, HOLD_FORWARD third). SS lists HOLD first because it's
 * the default extendmode + the most common UI selection.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const EXTENDMODE_LABELS = Object.freeze({
  hold:         'Hold',
  hold_forward: 'Hold Forward',
  nothing:      'Nothing',
});

/**
 * Blendmode → CSS/Tailwind color class. SS-chosen palette for visual
 * distinction on the timeline (not mirrored from Blender — Blender's
 * strip rects are a uniform color in NLAEditor with mode shown as a
 * label inside; SS uses color-by-mode for at-a-glance scan).
 *
 * @type {Readonly<Record<string, string>>}
 */
export const BLENDMODE_COLORS = Object.freeze({
  replace:  'bg-blue-500',
  add:      'bg-green-500',
  subtract: 'bg-orange-500',
  multiply: 'bg-purple-500',
});
