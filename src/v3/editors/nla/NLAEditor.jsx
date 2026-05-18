// @ts-check

/**
 * NLAEditor — Animation Phase 4 Slice 4.D (4.D.1 read-only +
 * 4.D.2 drag interactions + 4.D.2 audit-fix sweep).
 *
 * Surfaces the NLA stack (`animData.nlaTracks[]`) for every animData-
 * bearing Object in the project.
 *
 * # 4.D.1 (commit 5385734 + audit-fix 6f52410)
 *
 * Read-only render: track rows + strip rectangles + group headers +
 * ruler + two-state empty placeholder.
 *
 * # 4.D.2 (substrate 151cea0 + audit-fix this commit)
 *
 * Drag interactions on strip rectangles + track reorder via label
 * column drag + ResizeObserver-driven timeline width:
 *
 *   - Strip body drag → translates strip (preserves duration)
 *   - Strip left-edge drag (6px invisible handle) → resizes start
 *   - Strip right-edge drag (6px invisible handle) → resizes end
 *   - Track label-column vertical drag → reorders track stack
 *     (audit-fix HIGH-A5: was imported in substrate commit but JSX
 *     handler was missing — wired here per Rule №1)
 *   - ResizeObserver on the timeline-lane container via callback ref
 *     so re-mount (empty-state → populated transition) re-attaches
 *     observer (audit-fix MED-A6)
 *
 * Drag state buffered in local React state; commits to projectStore
 * only on pointerup (one undo snapshot per drag — matches Blender's
 * modal-operator OPTYPE_UNDO single-step convention per
 * `editors/space_nla/nla_select.cc:584` etc, audit-fix MED-F2 cite).
 *
 * **Drag-handle width** = 6px is an SS-original choice (audit-fix
 * MED-F1). Blender's NLA editor has no separate edge-resize hitbox
 * — resize uses the general transform modal (G/S keys); the closest
 * Blender analog is the strip-pick tolerance ±7px at
 * `nla_select.cc:280-285`. SS adds the edge-resize hitbox as a
 * mouse-first UX affordance.
 *
 * **Dual-pane safety** (audit-fix MED-A7): each NLAEditor instance
 * tracks its own drag via local state, but two instances mounted
 * simultaneously would both install document pointerup listeners
 * and both could try to commit a drag. Fix: gate commit on
 * `currentDragInstanceId === thisInstanceId` via a module-level
 * Symbol — only the instance that handled the pointerdown commits.
 *
 * # Deferred to later sub-slices
 *
 *   - 4.D.3: blend-mode dropdown + Mute/Solo toggles + Edit Action
 *     button (calls Slice 4.C enterTweakMode)
 *   - 4.D.4: Push Action Down + track/strip CRUD context menus
 *   - Ruler tick marks (basic ruler shipped 4.D.1)
 *   - Playhead (deferred until scene-time integration)
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
  MIN_STRIP_MS,
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
const RESIZE_HANDLE_W = 6;

/**
 * Module-level drag-ownership token. Only the NLAEditor instance whose
 * `instanceId` matches `currentDragOwner` commits on pointerup. Other
 * instances see the pointerup but skip the commit. Prevents the dual-
 * pane double-commit bug (audit-fix MED-A7).
 *
 * @type {symbol|null}
 */
let currentDragOwner = null;

/**
 * Convert ms to px along the timeline.
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
 * @property {'strip'} kind
 * @property {string} objectId
 * @property {string} trackId
 * @property {string} stripId
 * @property {('move'|'resize-start'|'resize-end')} mode
 * @property {number} startPx
 * @property {number} stripStartMs
 * @property {number} stripEndMs
 * @property {number} previewDeltaMs
 *
 * @typedef {Object} TrackDragState
 * @property {'track'} kind
 * @property {string} objectId
 * @property {string} trackId
 * @property {number} startY              -- pointer Y at drag start
 * @property {number} originalIndex
 * @property {number} previewIndex        -- live (snapped to row boundary)
 *
 * @typedef {StripDragState | TrackDragState | null} DragState
 */

/**
 * Strip rectangle with pointer handlers.
 *
 * @param {{
 *   strip: import('./nlaEditorData.js').NlaStripRow,
 *   objectId: string,
 *   trackId: string,
 *   minMs: number,
 *   maxMs: number,
 *   pxWidth: number,
 *   dragState: DragState,
 *   onDragStart: (s: StripDragState) => void,
 * }} props
 */
function StripRect({
  strip, objectId, trackId, minMs, maxMs, pxWidth, dragState, onDragStart,
}) {
  const isBeingDragged = dragState
    && dragState.kind === 'strip'
    && dragState.objectId === objectId
    && dragState.trackId === trackId
    && dragState.stripId === strip.id;

  let effectiveStart = strip.start;
  let effectiveEnd = strip.end;
  if (isBeingDragged) {
    const d = /** @type {StripDragState} */ (dragState).previewDeltaMs;
    if (dragState.mode === 'move') {
      effectiveStart = Math.max(0, strip.start + d);
      effectiveEnd = strip.end + (effectiveStart - strip.start);
    } else if (dragState.mode === 'resize-start') {
      effectiveStart = Math.min(strip.end - MIN_STRIP_MS, Math.max(0, strip.start + d));
    } else if (dragState.mode === 'resize-end') {
      effectiveEnd = Math.max(strip.start + MIN_STRIP_MS, strip.end + d);
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
      kind: 'strip',
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
      <div
        className="absolute left-0 top-0 bottom-0 cursor-ew-resize"
        style={{ width: `${RESIZE_HANDLE_W}px` }}
        onPointerDown={handlePointerDown('resize-start')}
      />
      <span className="truncate pointer-events-none">
        {strip.name}
      </span>
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
 *   dragState: DragState,
 *   onStripDragStart: (s: StripDragState) => void,
 *   onTrackDragStart: (s: TrackDragState) => void,
 *   trackOriginalIndex: number,
 * }} props
 */
function TrackRow({
  track, objectId, minMs, maxMs, pxWidth, isTweakTrack,
  dragState, onStripDragStart, onTrackDragStart, trackOriginalIndex,
}) {
  // Live preview: this track is being dragged → highlight + offset
  const isBeingTrackDragged = dragState
    && dragState.kind === 'track'
    && dragState.objectId === objectId
    && dragState.trackId === track.id;

  const handleTrackPointerDown = useCallback((e) => {
    // Only initiate track drag from the label column itself, NOT
    // from any of the flag-letter spans (those will become clickable
    // toggles in Slice 4.D.3).
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    onTrackDragStart({
      kind: 'track',
      objectId, trackId: track.id,
      startY: e.clientY,
      originalIndex: trackOriginalIndex,
      previewIndex: trackOriginalIndex,
    });
  }, [objectId, track.id, trackOriginalIndex, onTrackDragStart]);

  return (
    <div
      className={cn(
        'flex border-b border-zinc-800',
        track.disabled && 'bg-zinc-900/40',
        !track.enabled && !track.disabled && 'bg-zinc-900/20',
        isBeingTrackDragged && 'opacity-70 bg-zinc-700/60',
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
          'flex items-center gap-1 px-2 border-r border-zinc-800 text-xs cursor-grab active:cursor-grabbing',
          isTweakTrack && 'text-yellow-400',
          !track.enabled && 'text-zinc-500',
        )}
        style={{ width: `${LABEL_W}px`, minWidth: `${LABEL_W}px` }}
        onPointerDown={handleTrackPointerDown}
        title="Drag to reorder track within the stack"
      >
        <span className="text-zinc-500 text-[10px] tabular-nums w-4">
          {track.index}
        </span>
        <span className="truncate flex-1">
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
          title="In NLA tweak mode"
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

export function NLAEditor() {
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);

  // Instance identity for dual-pane drag-ownership gating
  // (audit-fix MED-A7). Symbol ensures each NLAEditor instance has
  // a unique reference-equal token.
  const instanceIdRef = useRef(/** @type {symbol|null} */ (null));
  if (instanceIdRef.current === null) {
    instanceIdRef.current = Symbol('NLAEditor');
  }

  const groups = useMemo(() => buildNlaEditorRows(project), [project]);
  const span = useMemo(() => computeTimelineSpan(groups), [groups]);
  const visibleGroups = useMemo(
    () => groups.filter((g) => g.tracks.length > 0),
    [groups],
  );

  // ResizeObserver-driven timeline width via CALLBACK REF (audit-fix
  // MED-A6). Callback ref fires on every mount/unmount of the container
  // element — when the empty-state div is replaced with the main
  // container or vice versa, the observer re-attaches automatically.
  // Pre-fix the observer used a `useEffect([], [])` which only ran
  // once on initial mount, so the empty-state → populated transition
  // left the observer attached to the unmounted element and pxWidth
  // stuck at the 800px fallback forever.
  const [pxWidth, setPxWidth] = useState(800);
  const observerRef = useRef(/** @type {ResizeObserver|null} */ (null));
  const setContainerRef = useCallback((el) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (el && typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = entry.contentRect.width - LABEL_W;
          if (w > 0) setPxWidth(w);
        }
      });
      ro.observe(el);
      observerRef.current = ro;
    }
  }, []);
  useEffect(() => () => {
    if (observerRef.current) observerRef.current.disconnect();
  }, []);

  const [dragState, setDragState] = useState(/** @type {DragState} */ (null));

  const handleStripDragStart = useCallback((/** @type {StripDragState} */ s) => {
    currentDragOwner = instanceIdRef.current;
    setDragState(s);
  }, []);

  const handleTrackDragStart = useCallback((/** @type {TrackDragState} */ s) => {
    currentDragOwner = instanceIdRef.current;
    setDragState(s);
  }, []);

  useEffect(() => {
    if (!dragState) return undefined;

    const handleMove = (e) => {
      if (dragState.kind === 'strip') {
        const deltaPx = e.clientX - dragState.startPx;
        const deltaMs = pxDeltaToMs(deltaPx, span.minMs, span.maxMs, pxWidth);
        setDragState((prev) => prev && prev.kind === 'strip'
          ? { ...prev, previewDeltaMs: deltaMs } : prev);
      } else {
        // Track drag — convert pointer Y delta to index delta via ROW_H
        const deltaY = e.clientY - dragState.startY;
        const indexDelta = Math.round(deltaY / ROW_H);
        // In SS rendering, INCREASING index = top of stack, but in the
        // DOM tracks render TOP-DOWN with highest index at TOP. So a
        // downward drag (positive deltaY) DECREASES the target index.
        const previewIndex = Math.max(0, dragState.originalIndex - indexDelta);
        setDragState((prev) => prev && prev.kind === 'track'
          ? { ...prev, previewIndex } : prev);
      }
    };

    const handleUp = () => {
      // Audit-fix MED-A7: only the instance that initiated the drag
      // commits. Other instances (dual-pane) skip the commit but
      // still clear their own local dragState.
      const isOwner = currentDragOwner === instanceIdRef.current;
      if (isOwner && dragState) {
        if (dragState.kind === 'strip') {
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
        } else {
          // Track reorder commit
          const previewIndex = dragState.previewIndex;
          if (previewIndex !== dragState.originalIndex) {
            updateProject((proj) => {
              const node = proj.nodes.find((n) => n && n.id === dragState.objectId);
              if (!node || !node.animData) return;
              const newAd = applyReorderTrack(node.animData, dragState.trackId, previewIndex);
              if (newAd !== node.animData) {
                node.animData = newAd;
              }
            });
          }
        }
        currentDragOwner = null;
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

  // All hooks above this line. Early return safe now.
  if (visibleGroups.length === 0) {
    return (
      <div ref={setContainerRef} className="h-full">
        <EmptyState noAnimData={groups.length === 0} />
      </div>
    );
  }

  const { minMs, maxMs } = span;

  return (
    <div
      ref={setContainerRef}
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
          {dragState && dragState.kind === 'strip' && (
            <span className="ml-3 text-yellow-400">
              [drag {dragState.mode}: Δ{dragState.previewDeltaMs.toFixed(0)} ms]
            </span>
          )}
          {dragState && dragState.kind === 'track' && (
            <span className="ml-3 text-yellow-400">
              [reorder: index {dragState.originalIndex} → {dragState.previewIndex}]
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
              onTrackDragStart={handleTrackDragStart}
              trackOriginalIndex={track.index}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
