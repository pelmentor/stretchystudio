// @ts-check

/**
 * Animation Phase 5 Slice 5.P — FCurve Editor per-editor footer formatters.
 *
 * Pure data module backing the FCurveEditor's per-editor footer
 * (rendered at the bottom of `<Wrapper>` in `FCurveEditor.jsx`).
 * Sister architecture to `v3/shell/footerStatusData.js` (global
 * statusbar formatters) and `v3/v3/editors/.../canvasContextMenuItems.js`
 * — splits derive-state-from-store-snapshot away from the React
 * presentation so unit tests don't need a JSX runtime.
 *
 * # The Blender footer region this slot maps to
 *
 * Blender's Graph Editor registers a per-editor FOOTER region
 * (`reference/blender/source/blender/editors/space_graph/space_graph.cc:996-1005`,
 * `RGN_TYPE_FOOTER`) painted by `GRAPH_HT_playback_controls`
 * (`reference/blender/scripts/startup/bl_ui/space_graph.py:113-124`). Its
 * draw function shows TWO mutually-exclusive surfaces:
 *
 *   - **Drivers mode** → `drivers_editor_footer(layout, context)`
 *     (`space_graph.py:17-41`) — "Driver: {id} ({data_path})" +
 *     "Variables: N" + "Expression: …" labels.
 *   - **Normal mode** → `playback_controls(layout, context)` — the
 *     transport bar (jump-to-start / prev / play / next / jump-to-end /
 *     current-frame display).
 *
 * SS has redistributed Blender's footer content:
 *   - Playback controls were **lifted to the global Footer** in
 *     Round 7 FID-A.2 (2026-05-16) — see
 *     `v3/shell/PlaybackControls.jsx` module JSDoc. The global Footer
 *     mirrors Blender's `STATUSBAR_HT_header`, not the per-editor
 *     `GRAPH_HT_playback_controls`.
 *   - Driver info has its own dedicated banner above the timeline plot
 *     (Slice 5.D `DriverBanner`) showing the same Driver/Variables/
 *     Expression triad.
 *
 * That leaves the per-editor FOOTER **region slot freed in SS**. This
 * slice (5.P) repurposes the slot for FCurve channel-state summary —
 * total / selected / hidden / muted counts + active-FCurve label.
 * **Deliberate deviation from Blender** documented below in Deviation 1.
 *
 * # SS deviations
 *
 * **Deviation 1 — channel-state summary instead of playback controls.**
 * Blender's per-editor FOOTER shows playback controls. SS surfaces
 * channel counts + active FCurve label instead. Rationale: SS already
 * lifted playback controls to global (single transport bar across all
 * timelines), and the FCurveEditor's sidebar lacks a Blender-style
 * header strip that summarises channel state — `ANIMFILTER_LIST_*`
 * counts don't surface anywhere in the SS UI today. Using the freed
 * slot avoids both adding a second transport bar (redundant) AND
 * letting useful info stay invisible. Closure condition: if SS ever
 * grows per-editor transports (e.g. independent timeline scrubbers
 * per editor), the global lift would unwind and this slot would
 * reclaim playback controls — at which point channel-state summary
 * would need a different home (sidebar header strip is the natural
 * target).
 *
 * **Deviation 2 — no driver-mode footer alternative.** Blender's
 * footer text changes wholesale in drivers mode. SS does NOT have a
 * "drivers mode" toggle (the Graph Editor and Drivers editor were one
 * surface from Phase 5 Slice A onward — driven curves render with a
 * banner instead of a mode switch). Channel-state summary is shown
 * uniformly. Closure condition: if SS splits drivers into a separate
 * editor type (Phase 5 #6 — Driver variable list / expression editor),
 * a drivers-only footer variant would replace this summary in that
 * editor.
 *
 * # Rule №1 compliance — no silent fallbacks
 *
 * Every output is derived from the live `decoded` array (the same
 * source the sidebar + plot render from). No "(no curves)" fallback
 * text — the empty-action / empty-fcurves states are handled UPSTREAM
 * in `FCurveEditor.jsx` by rendering `<Empty msg=... />` instead of
 * the footer (the footer never mounts when there are zero channels).
 *
 * @module v3/editors/fcurve/fcurveFooterData
 */

import { isFCurveSelected } from '../../../anim/fcurveChannelSelect.js';
import { isFCurveHidden } from '../../../anim/fcurveVisible.js';
import { isFCurveMuted } from '../../../anim/fcurveMute.js';

/**
 * @typedef {{ id: string, selected?: boolean, hide?: boolean, mute?: boolean }} FCurveLike
 * @typedef {{ fcurve: FCurveLike, label: string }} DecodedFCurveRow
 * @typedef {{ total: number, selected: number, hidden: number, muted: number }} ChannelCounts
 */

/**
 * Tally the 4 channel-state counts SS surfaces in the footer.
 *
 * Each fcurve contributes to:
 *   - `total`    — every decoded row (resolvable-target rows; matches
 *                  `decoded.length` from `FCurveEditor.decodeAllFCurves`).
 *   - `selected` — `fc.selected === true` (Slice 5.F `FCURVE_SELECTED`).
 *   - `hidden`   — `fc.hide === true`     (Slice 5.I negative of
 *                                          `FCURVE_VISIBLE`).
 *   - `muted`    — `fc.mute === true`     (Slice 5.G `FCURVE_MUTED`).
 *
 * **Selected/hidden/muted are independent dimensions**, not mutually
 * exclusive: a single fcurve can be all three simultaneously (matches
 * Blender's flag-OR semantics — each bit is independent).
 *
 * @param {ReadonlyArray<DecodedFCurveRow>|null|undefined} decoded
 * @returns {ChannelCounts}
 */
export function countFCurveChannelStates(decoded) {
  const result = { total: 0, selected: 0, hidden: 0, muted: 0 };
  if (!decoded || decoded.length === 0) return result;
  for (const row of decoded) {
    if (!row || !row.fcurve) continue;
    result.total++;
    if (isFCurveSelected(row.fcurve)) result.selected++;
    if (isFCurveHidden(row.fcurve))   result.hidden++;
    if (isFCurveMuted(row.fcurve))    result.muted++;
  }
  return result;
}

/**
 * Format the channel-counts string for the footer's left section.
 *
 * Output shape (zero-elision for selected/hidden/muted; total always
 * shown — including singular/plural):
 *
 *   - `"0 channels"`                          (empty — only happens
 *                                              when footer is hidden anyway)
 *   - `"1 channel"`                           (singular)
 *   - `"12 channels"`                         (no selection, all visible)
 *   - `"12 channels · 3 selected"`            (selection only)
 *   - `"12 channels · 3 selected · 2 hidden"` (selection + hidden)
 *   - `"12 channels · 2 hidden · 1 muted"`    (no selection, hidden + muted)
 *   - `"12 channels · 3 selected · 2 hidden · 1 muted"` (all four)
 *
 * Separator is U+00B7 MIDDLE DOT (` · `) matching `footerStatusData.js`'s
 * `formatStats`. Plural agreement only on `channels`; `selected /
 * hidden / muted` stay singular-form in both 1 and N cases (matches
 * Blender's status-bar terse style — `"1 sel"` vs `"3 sel"` in
 * `interface_template_status.cc:475` uses the same abbreviation).
 *
 * @param {ChannelCounts} counts
 * @returns {string}
 */
export function formatFCurveChannelCounts(counts) {
  const total = counts?.total ?? 0;
  const parts = [`${total} channel${total === 1 ? '' : 's'}`];
  if ((counts?.selected ?? 0) > 0) parts.push(`${counts.selected} selected`);
  if ((counts?.hidden   ?? 0) > 0) parts.push(`${counts.hidden} hidden`);
  if ((counts?.muted    ?? 0) > 0) parts.push(`${counts.muted} muted`);
  return parts.join(' · ');
}

/**
 * Resolve the active-FCurve display label from the decoded row list.
 *
 * Reads the row whose `fcurve.id === activeFCurveId` and returns its
 * pre-built `label` field (the same string the sidebar renders;
 * Param rows show parameter name, Node rows show `"NodeName · property"`).
 *
 * Returns `null` when:
 *   - `activeFCurveId` is null / empty
 *   - No decoded row matches the id (active points at a hidden /
 *     unresolvable curve)
 *
 * Caller decides how to render `null` (the footer presentation hides
 * the right section entirely; see `FCurveEditor.jsx`).
 *
 * Why not just store the label inline on the active selector? Because
 * `decoded` is the single source of truth for row labels (built once
 * per render via `useMemo`); reading from `decoded` here means the
 * footer label can't drift from the sidebar label. Sister to the
 * "decoded.find" pattern the Plot uses to resolve `activeFCurveId`
 * back to its row metadata.
 *
 * @param {ReadonlyArray<DecodedFCurveRow>|null|undefined} decoded
 * @param {string|null|undefined} activeFCurveId
 * @returns {string|null}
 */
export function formatActiveFCurveLabel(decoded, activeFCurveId) {
  if (!activeFCurveId) return null;
  if (!decoded || decoded.length === 0) return null;
  for (const row of decoded) {
    if (row && row.fcurve && row.fcurve.id === activeFCurveId) {
      return typeof row.label === 'string' && row.label.length > 0
        ? row.label
        : null;
    }
  }
  return null;
}
