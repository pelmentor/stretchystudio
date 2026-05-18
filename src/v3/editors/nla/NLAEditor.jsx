// @ts-check

/**
 * NLAEditor — Animation Phase 4 Slice 4.D (4.D.1 read-only + 4.D.2
 * drag interactions).
 *
 * Surfaces the NLA stack (`animData.nlaTracks[]`) for every animData-
 * bearing Object in the project, mirroring Blender's NLA Editor space
 * (informational: Blender's NLA panel layout in `space_nla.cc` +
 * `space_nla.py`; SS structure is column-flex per-group, not a panel
 * tree).
 *
 * # 4.D.1 (commit 5385734 + audit-fix 6f52410)
 *
 * Read-only render: track rows + strip rectangles + group headers +
 * ruler + two-state empty placeholder.
 *
 * # 4.D.2 (this slice)
 *
 * Drag interactions on strip rectangles + track reorder + ResizeObserver-
 * driven timeline width:
 *
 *   - Strip body drag → translates strip (preserves duration)
 *   - Strip left-edge drag → resizes start
 *   - Strip right-edge drag → resizes end
 *   - Track header vertical drag → reorders track stack
 *   - ResizeObserver on the timeline-lane parent → drives pxWidth
 *     state (replaces the audit-fix-hoisted 800px const)
 *
 * Drag state buffered in local React state; commits to projectStore
 * only on pointerup (one undo snapshot per drag). Math lives in pure
 * `nlaEditorOps.js` (60 asserts pin contracts).
 *
 * # Deferred to later sub-slices
 *
 *   - 4.D.3: blend-mode dropdown + Mute/Solo toggles + Edit Action
 *     button (calls Slice 4.C enterTweakMode)
 *   - 4.D.4: Push Action Down operator + track/strip CRUD context menus
 *   - Ruler tick marks (basic ruler shipped in 4.D.1; tick marks
 *     deferred since they need a separate ms→tick layout helper)
 *   - Playhead (deferred to a later slice when scene-time integration
 *     for the NLA timeline is wired)
 *
 * @module v3/editors/nla/NLAEditor
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useProjectStore } from '../../../store/projectStore.js';
import {
  buildNlaEditorRows,
  computeTimelineSpan,
  BLENDMODE_LABELS,
  BLENDMODE_COLORS,
} from './nlaEditorData.js';
import {
  applyMoveStrip,
  applyResizeStripStart,
  applyResizeStripEnd,
  applyReorderTrack,
  pxDeltaToMs,
} from './nlaEditorOps.js';
import { cn } from '../../../lib/utils.js';

const LABEL_W = 160;
const ROW_H = 24;
const RULER_H = 22;
const GROUP_HEADER_H = 28;
const RESIZE_HANDLE_W = 6;   // px — width of the invisible edge-grab zone

/**
 * Convert ms to px along the timeline. Pure helper.
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
 * @typedef {Object} StripDragState
 * @property {string} objectId
 * @property {string} trackId
 * @property {string} stripId
 * @property {('move'|'resize-start'|'resize-end')} mode
 * @property {number} startPx              -- pointer X at drag start
 * @property {number} stripStartMs         -- strip.start at drag start
 * @property {number} stripEndMs           -- strip.end at drag start
 * @property {number} previewDeltaMs       -- live delta during drag
 */

/**
 * Strip rectangle with pointer-event handlers for the 3 drag modes.
 * The body grabs `move`; invisible RESIZE_HANDLE_W-wide zones at the
 * left + right edges grab `resize-start` / `resize-end`.
 *
 * @param {{
 *   strip: import('./nlaEditorData.js').NlaStripRow,
 *   objectId: string,
 *   trackId: string,
 *   minMs: number,
 *   maxMs: number,
 *   pxWidth: number,
 *   dragState: StripDragState | null,
 *   onDragStart: (s: StripDragState) => void,
 * }} props
 */
function StripRect({
  strip, objectId, trackId, minMs, maxMs, pxWidth, dragState, onDragStart,
}) {
  // Live preview: if THIS strip is being dragged, apply the preview
  // delta to its visual position. The actual data isn't mutated until
  // pointerup commits the drag.
  const isBeingDragged = dragState
    && dragState.objectId === objectId
    && dragState.trackId === trackId
    && dragState.stripId === strip.id;

  let effectiveStart = strip.start;
  let effectiveEnd = strip.end;
  if (isBeingDragged) {
    const d = dragState.previewDeltaMs;
    if (dragState.mode === 'move') {
      effectiveStart = Math.max(0, strip.start + d);
      effectiveEnd = strip.end + (effectiveStart - strip.start);
    } else if (dragState.mode === 'resize-start') {
      effectiveStart = Math.min(strip.end - 1, Math.max(0, strip.start + d));
    } else if (dragState.mode === 'resize-end') {
      effectiveEnd = Math.max(strip.start + 1, strip.end + d);
    }
  }

  const left = msToPx(effectiveStart, minMs, maxMs, pxWidth);
  const right = msToPx(effectiveEnd, minMs, maxMs, pxWidth);
  const width = Math.max(2, right - left);
  const colorClass = BLENDMODE_COLORS[strip.blendmode] ?? 'bg-zinc-500';

  const handlePointerDown = useCallback((mode) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragStart({
      objectId, trackId, stripId: strip.id, mode,
      startPx: e.clientX,
      stripStartMs: strip.start,
      stripEndMs: strip.end,
      previewDeltaMs: 0,
    });
  }, [objectId, trackId, strip.id, strip.start, strip.end, onDragStart]);

  return (
    <div
      className={cn(
        'absolute top-1 bottom-1 rounded-sm flex items-center px-1.5 text-xs text-white',
        'truncate select-none cursor-grab active:cursor-grabbing border',
        colorClass,
        strip.muted && 'opacity-40',
        isBeingDragged && 'opacity-80 shadow-lg z-20',
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
        'drag body to move; drag edges to resize',
        strip.muted ? '(MUTED)' : null,
        strip.isTweakStrip ? '(TWEAK STRIP)' : null,
        strip.tweakuser ? '(shares tweaked action)' : null,
      ].filter(Boolean).join('\n')}
      onPointerDown={handlePointerDown('move')}
    >
      {/* Left resize handle — invisible click target */}
      <div
        className="absolute left-0 top-0 bottom-0 cursor-ew-resize"
        style={{ width: `${RESIZE_HANDLE_W}px` }}
        onPointerDown={handlePointerDown('resize-start')}
      />
      <span className="truncate pointer-events-none">
        {strip.name}
      </span>
      {/* Right resize handle */}
      <div
        className="absolute right-0 top-0 bottom-0 cursor-ew-resize"
        style={{ width: `${RESIZE_HANDLE_W}px` }}
        onPointerDown={handlePointerDown('resize-end')}
      />
    </div>
  );
}

/**
 * Track row.
 *
 * @param {{
 *   track: import('./nlaEditorData.js').NlaTrackRow,
 *   objectId: string,
 *   minMs: number,
 *   maxMs: number,
 *   pxWidth: number,
 *   isTweakTrack: boolean,
 *   dragState: StripDragState | null,
 *   onStripDragStart: (s: StripDragState) => void,
 * }} props
 */
function TrackRow({
  track, objectId, minMs, maxMs, pxWidth, isTweakTrack, dragState, onStripDragStart,
}) {
  return (
    <div
      className={cn(
        'flex border-b border-zinc-800',
        track.disabled && 'bg-zinc-900/40',
        !track.enabled && !track.disabled && 'bg-zinc-900/20',
      )}
      style={{ height: `${ROW_H}px` }}
    >
      {/* Label column. SS DEVIATION (audit-fix 4.D.1 MED-F1):
          Blender uses ICONS (ICON_HIDE_ON/ICON_SOLO_OFF/ICON_UNLOCKED
          per anim_channels_defines.cc:5768-5822). SS uses single-
          letter badges (S/M/P/D) for compactness in the 4.D read-only
          render. Slice 4.D.3 will convert to clickable toggles +
          likely move to Lucide icons matching the SS UI. */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 border-r border-zinc-800 text-xs',
          isTweakTrack && 'text-yellow-400',
          !track.enabled && 'text-zinc-500',
        )}
        style={{ width: `${LABEL_W}px`, minWidth: `${LABEL_W}px` }}
      >
        <span className="text-zinc-500 text-[10px] tabular-nums w-4">
          {track.index}
        </span>
        <span className="truncate flex-1" title={track.name}>
          {track.name}
        </span>
        {track.solo && (
          <span className="text-yellow-500" title="SOLO — only this track evaluates">S</span>
        )}
        {track.muted && (
          <span className="text-zinc-500" title="MUTED — track skipped during eval">M</span>
        )}
        {track.protected_ && (
          <span className="text-blue-500" title="PROTECTED — edits blocked">P</span>
        )}
        {track.disabled && (
          <span className="text-orange-500" title="DISABLED — suppressed by NLA tweak mode">D</span>
        )}
      </div>
      <div className="relative flex-1 overflow-hidden" style={{ width: `${pxWidth}px` }}>
        {track.strips.map((strip) => (
          <StripRect
            key={strip.id}
            strip={strip}
            objectId={objectId}
            trackId={track.id}
            minMs={minMs}
            maxMs={maxMs}
            pxWidth={pxWidth}
            dragState={dragState}
            onDragStart={onStripDragStart}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Object-group header.
 * @param {{ group: import('./nlaEditorData.js').NlaObjectGroup }} props
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
 * Empty-state placeholder.
 * @param {{ noAnimData: boolean }} props
 */
function EmptyState({ noAnimData }) {
  return (
    <div className="flex items-center justify-center h-full text-zinc-500 text-sm p-6">
      <div className="text-center max-w-md">
        {noAnimData ? (
          <>
            <p className="mb-2">No animData-bearing Objects in this project.</p>
            <p className="text-xs">
              NLA tracks attach to parts, bone groups, and the scene
              pseudo-Object. Import a PSD or run the wizard to populate
              the project before adding NLA tracks.
            </p>
          </>
        ) : (
          <>
            <p className="mb-2">No NLA tracks on any Object yet.</p>
            <p className="text-xs">
              NLA tracks let you layer multiple Actions on top of each
              other with per-layer blend modes (replace / add / subtract
              / multiply). Add tracks via the "+ Track" affordance per
              Object — shipping in Slice 4.D.4.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The NLAEditor surface.
 */
export function NLAEditor() {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);

  const groups = useMemo(() => buildNlaEditorRows(project), [project]);
  const span = useMemo(() => computeTimelineSpan(groups), [groups]);
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.tracks.length > 0),
    [groups],
  );

  // ResizeObserver-driven timeline width. Replaces the 4.D.1 audit-fix-
  // hoisted const. Fallback to 800px until the observer attaches.
  const laneContainerRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [pxWidth, setPxWidth] = useState(800);
  useEffect(() => {
    const el = laneContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width - LABEL_W;
        if (w > 0) setPxWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drag state — null when idle.
  const [dragState, setDragState] = useState(/** @type {StripDragState|null} */ (null));

  const handleStripDragStart = useCallback((/** @type {StripDragState} */ s) => {
    setDragState(s);
  }, []);

  // Global pointer-move + pointer-up handlers while dragging. Attached
  // to the document so the drag survives the pointer leaving the strip
  // rect. Pointer capture (set in onPointerDown) routes events back to
  // the original element, but document-level listeners are belt + braces.
  useEffect(() => {
    if (!dragState) return undefined;

    const handleMove = (e) => {
      const deltaPx = e.clientX - dragState.startPx;
      const deltaMs = pxDeltaToMs(deltaPx, span.minMs, span.maxMs, pxWidth);
      setDragState((prev) => prev ? { ...prev, previewDeltaMs: deltaMs } : prev);
    };

    const handleUp = () => {
      // Commit the drag via projectStore — ONE undo snapshot per drag.
      const finalDelta = dragState.previewDeltaMs;
      if (Math.abs(finalDelta) > 1e-10) {
        updateProject((proj) => {
          const node = proj.nodes.find((n) => n && n.id === dragState.objectId);
          if (!node || !node.animData) return;
          let newAd;
          if (dragState.mode === 'move') {
            newAd = applyMoveStrip(node.animData, dragState.trackId, dragState.stripId, finalDelta);
          } else if (dragState.mode === 'resize-start') {
            newAd = applyResizeStripStart(node.animData, dragState.trackId, dragState.stripId,
              dragState.stripStartMs + finalDelta);
          } else if (dragState.mode === 'resize-end') {
            newAd = applyResizeStripEnd(node.animData, dragState.trackId, dragState.stripId,
              dragState.stripEndMs + finalDelta);
          }
          if (newAd && newAd !== node.animData) {
            node.animData = newAd;
          }
        });
      }
      setDragState(null);
    };

    document.addEventListener('pointermove', handleMove);
    document.addEventListener('pointerup', handleUp);
    return () => {
      document.removeEventListener('pointermove', handleMove);
      document.removeEventListener('pointerup', handleUp);
    };
  }, [dragState, span.minMs, span.maxMs, pxWidth, updateProject]);

  // EARLY RETURN guarded behind ALL hooks above (per feedback_hooks_before_early_return).
  if (visibleGroups.length === 0) {
    return (
      <div ref={laneContainerRef} className="h-full">
        <EmptyState noAnimData={groups.length === 0} />
      </div>
    );
  }

  const { minMs, maxMs } = span;

  return (
    <div
      ref={laneContainerRef}
      className="flex flex-col h-full bg-zinc-950 text-zinc-300 overflow-auto"
    >
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
          {dragState && (
            <span className="ml-3 text-yellow-400">
              [dragging {dragState.mode}: Δ{dragState.previewDeltaMs.toFixed(0)} ms]
            </span>
          )}
        </div>
      </div>

      {visibleGroups.map((group) => (
        <div key={group.objectId}>
          <GroupHeader group={group} />
          {group.tracks.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              objectId={group.objectId}
              minMs={minMs}
              maxMs={maxMs}
              pxWidth={pxWidth}
              isTweakTrack={
                group.tweakModeOn
                && group.tweakTrackId !== null
                && track.id === group.tweakTrackId
              }
              dragState={dragState}
              onStripDragStart={handleStripDragStart}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
