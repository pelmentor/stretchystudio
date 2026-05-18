// @ts-check

/**
 * NLAEditor — Animation Phase 4 Slice 4.D.1 (READ-ONLY render).
 *
 * Surfaces the NLA stack (`animData.nlaTracks[]`) for every animData-
 * bearing Object in the project, mirroring Blender's NLA Editor space
 * (`reference/blender/scripts/startup/bl_ui/space_nla.py`). Renders:
 *
 *   - One collapsible group header per Object (part / group / scene)
 *   - For each Object: track rows (bottom-to-top) with name + Mute /
 *     Solo / Protected / Disabled indicator badges (read-only)
 *   - For each track: strip rectangles on a timeline ruler, colored
 *     by blendmode, labeled with name + action display name
 *   - Tweak-mode indicator: the tweak strip border turns yellow
 *     (per plan §4.C UI direction)
 *
 * # Slice 4.D.1 scope (intentionally minimal)
 *
 * Read-only. NO drag (4.D.2), NO context menus (4.D.4), NO blend-mode
 * dropdown / Mute/Solo toggle / Edit Action button (4.D.3), NO Push
 * Action Down operator (4.D.4). Per Rule №1 + sub-slice partitioning
 * matching prior Phase 3 (3.A substrate → 3.B eval → 3.C UI →
 * 3.D-3.G features), each sub-slice ships one layer.
 *
 * # Architecture
 *
 *   - Data derivation lives in `nlaEditorData.js` (pure functions;
 *     ~250 LOC; 56 asserts).
 *   - This component is render-only: subscribes to `projectStore` for
 *     the project (zustand selector + `useMemo` for shape derivation
 *     to avoid filter-in-selector trap per `feedback_filter_in_selector`).
 *   - No internal state in 4.D.1 (drag state machine arrives in 4.D.2).
 *
 * @module v3/editors/nla/NLAEditor
 */

import { useMemo } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import {
  buildNlaEditorRows,
  computeTimelineSpan,
  BLENDMODE_LABELS,
  BLENDMODE_COLORS,
} from './nlaEditorData.js';
import { cn } from '../../../lib/utils.js';

const LABEL_W = 160;   // px — fixed track-name column width
const ROW_H = 24;      // px — height per track row
const RULER_H = 22;    // px — timeline ruler height
const GROUP_HEADER_H = 28;   // px — Object-group header height

/**
 * Convert ms to a pixel position on the timeline given the visible
 * span + the timeline pixel width. Pure helper.
 *
 * @param {number} ms
 * @param {number} minMs
 * @param {number} maxMs
 * @param {number} pxWidth
 * @returns {number}
 */
function msToPx(ms, minMs, maxMs, pxWidth) {
  const span = Math.max(1, maxMs - minMs);
  return ((ms - minMs) / span) * pxWidth;
}

/**
 * Render a single strip rectangle.
 * @param {{
 *   strip: import('./nlaEditorData.js').NlaStripRow,
 *   minMs: number,
 *   maxMs: number,
 *   pxWidth: number,
 * }} props
 */
function StripRect({ strip, minMs, maxMs, pxWidth }) {
  const left = msToPx(strip.start, minMs, maxMs, pxWidth);
  const right = msToPx(strip.end, minMs, maxMs, pxWidth);
  const width = Math.max(2, right - left);
  const colorClass = BLENDMODE_COLORS[strip.blendmode] ?? 'bg-zinc-500';
  return (
    <div
      className={cn(
        'absolute top-1 bottom-1 rounded-sm flex items-center px-1.5 text-xs text-white',
        'truncate select-none cursor-default border',
        colorClass,
        strip.muted && 'opacity-40',
        strip.isTweakStrip
          ? 'border-yellow-400 border-2 shadow-[0_0_4px_rgba(250,204,21,0.5)]'
          : 'border-black/30',
        strip.tweakuser && !strip.isTweakStrip && 'border-yellow-600/60 border-dashed',
      )}
      style={{ left: `${left}px`, width: `${width}px` }}
      title={[
        `${strip.name}  (${BLENDMODE_LABELS[strip.blendmode] ?? strip.blendmode})`,
        `action: ${strip.actionName}`,
        `t: ${strip.start.toFixed(0)} → ${strip.end.toFixed(0)} ms`,
        `influence: ${strip.influence.toFixed(2)}`,
        `extendmode: ${strip.extendmode}`,
        strip.muted ? '(MUTED)' : null,
        strip.isTweakStrip ? '(TWEAK STRIP)' : null,
        strip.tweakuser ? '(shares tweaked action)' : null,
      ].filter(Boolean).join('\n')}
    >
      <span className="truncate">
        {strip.name}
      </span>
    </div>
  );
}

/**
 * Render a single track row (label column + timeline lane).
 * @param {{
 *   track: import('./nlaEditorData.js').NlaTrackRow,
 *   minMs: number,
 *   maxMs: number,
 *   pxWidth: number,
 *   isTweakTrack: boolean,
 * }} props
 */
function TrackRow({ track, minMs, maxMs, pxWidth, isTweakTrack }) {
  return (
    <div
      className={cn(
        'flex border-b border-zinc-800',
        track.disabled && 'bg-zinc-900/40',
        !track.enabled && !track.disabled && 'bg-zinc-900/20',
      )}
      style={{ height: `${ROW_H}px` }}
    >
      {/* Label column */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 border-r border-zinc-800 text-xs',
          isTweakTrack && 'text-yellow-400',
          !track.enabled && 'text-zinc-500',
        )}
        style={{ width: `${LABEL_W}px`, minWidth: `${LABEL_W}px` }}
      >
        {/* Bottom-to-top index */}
        <span className="text-zinc-500 text-[10px] tabular-nums w-4">
          {track.index}
        </span>
        {/* Track name */}
        <span className="truncate flex-1" title={track.name}>
          {track.name}
        </span>
        {/* Flag indicators (read-only in 4.D.1; clickable toggles in 4.D.3) */}
        {track.solo && (
          <span className="text-yellow-500" title="SOLO — only this track evaluates">
            S
          </span>
        )}
        {track.muted && (
          <span className="text-zinc-500" title="MUTED — track skipped during eval">
            M
          </span>
        )}
        {track.protected_ && (
          <span className="text-blue-500" title="PROTECTED — edits blocked">
            P
          </span>
        )}
        {track.disabled && (
          <span className="text-orange-500" title="DISABLED — suppressed by NLA tweak mode">
            D
          </span>
        )}
      </div>
      {/* Timeline lane */}
      <div className="relative flex-1 overflow-hidden" style={{ width: `${pxWidth}px` }}>
        {track.strips.map((strip) => (
          <StripRect
            key={strip.id}
            strip={strip}
            minMs={minMs}
            maxMs={maxMs}
            pxWidth={pxWidth}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Render the Object-group header.
 * @param {{
 *   group: import('./nlaEditorData.js').NlaObjectGroup,
 * }} props
 */
function GroupHeader({ group }) {
  return (
    <div
      className={cn(
        'flex items-center px-2 bg-zinc-800/60 border-b border-zinc-700 text-xs font-medium',
        group.tweakModeOn && 'text-yellow-400',
      )}
      style={{ height: `${GROUP_HEADER_H}px` }}
    >
      <span className="text-zinc-500 mr-2 text-[10px] uppercase tracking-wider">
        {group.objectType}
      </span>
      <span className="truncate flex-1" title={group.objectName}>
        {group.objectName}
      </span>
      {group.tweakModeOn && (
        <span
          className="text-yellow-400 text-[10px] uppercase tracking-wider"
          title="In NLA tweak mode — action edits go directly to the tweak strip's action"
        >
          TWEAK
        </span>
      )}
      {group.soloActive && (
        <span
          className="text-yellow-500 text-[10px] uppercase tracking-wider ml-2"
          title="Solo mode active — only SOLO-flagged tracks evaluate"
        >
          SOLO
        </span>
      )}
    </div>
  );
}

/**
 * Empty-state placeholder when no Object carries `animData.nlaTracks`.
 */
function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full text-zinc-500 text-sm p-6">
      <div className="text-center max-w-md">
        <p className="mb-2">No NLA tracks in this project.</p>
        <p className="text-xs">
          NLA tracks let you layer multiple Actions on top of each other
          with per-layer blend modes (replace / add / subtract / multiply).
          Track + strip CRUD ships in Slice 4.D.4.
        </p>
      </div>
    </div>
  );
}

/**
 * The NLAEditor surface.
 */
export function NLAEditor() {
  const project = useProjectStore((s) => s.project);

  // Derive editor row data via useMemo to avoid the filter-in-selector
  // trap (feedback_filter_in_selector). The selector only reads
  // `s.project`; the derivation runs once per project mutation.
  const groups = useMemo(() => buildNlaEditorRows(project), [project]);
  const span = useMemo(() => computeTimelineSpan(groups), [groups]);

  // Hide groups with no tracks for the read-only render in 4.D.1.
  // 4.D.4 adds an "(no tracks; + to add)" affordance per group.
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.tracks.length > 0),
    [groups],
  );

  if (visibleGroups.length === 0) {
    return <EmptyState />;
  }

  // Timeline pixel width — for 4.D.1 we use a fixed render width
  // (consumers see the natural overflow). 4.D.2 will introduce
  // pan/zoom via a width prop computed from container size.
  const pxWidth = 800;
  const { minMs, maxMs } = span;

  return (
    <div className="flex flex-col h-full bg-zinc-950 text-zinc-300 overflow-auto">
      {/* Ruler — minimal for 4.D.1; 4.D.2 will add tick marks + playhead */}
      <div
        className="flex items-center border-b border-zinc-700 bg-zinc-900 text-[10px] text-zinc-500 sticky top-0 z-10"
        style={{ height: `${RULER_H}px` }}
      >
        <div
          className="px-2 border-r border-zinc-700"
          style={{ width: `${LABEL_W}px`, minWidth: `${LABEL_W}px` }}
        >
          tracks
        </div>
        <div className="px-2">
          {minMs.toFixed(0)} ms → {maxMs.toFixed(0)} ms
        </div>
      </div>

      {/* Groups */}
      {visibleGroups.map((group) => (
        <div key={group.objectId}>
          <GroupHeader group={group} />
          {group.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              minMs={minMs}
              maxMs={maxMs}
              pxWidth={pxWidth}
              isTweakTrack={
                group.tweakModeOn
                && group.tweakTrackId !== null
                && track.id === group.tweakTrackId
              }
            />
          ))}
        </div>
      ))}
    </div>
  );
}
