// @ts-check

/**
 * NLAEditor — Animation Phase 4 Slice 4.D (4.D.1 read-only +
 * 4.D.2 drag interactions + 4.D.3 affordances + 4.D.4 CRUD).
 *
 * Surfaces the NLA stack (`animData.nlaTracks[]`) for every animData-
 * bearing Object in the project.
 *
 * # 4.D.1 (commit 5385734 + audit-fix 6f52410)
 *
 * Read-only render: track rows + strip rectangles + group headers +
 * ruler + two-state empty placeholder.
 *
 * # 4.D.2 (substrate 151cea0 + audit-fix 35367c2)
 *
 * Drag interactions on strip rectangles + track reorder via label
 * column drag + ResizeObserver-driven timeline width:
 *
 *   - Strip body drag → translates strip (preserves duration)
 *   - Strip left-edge drag (6px invisible handle) → resizes start
 *   - Strip right-edge drag (6px invisible handle) → resizes end
 *   - Track label-column vertical drag → reorders track stack
 *   - ResizeObserver on the timeline-lane container via callback ref
 *     so re-mount (empty-state → populated transition) re-attaches
 *     observer (audit-fix MED-A6)
 *
 * Drag state buffered in local React state; commits to projectStore
 * only on pointerup (one undo snapshot per drag — matches Blender's
 * modal-operator OPTYPE_UNDO single-step convention per
 * `editors/space_nla/nla_select.cc:584` etc).
 *
 * **Dual-pane safety** (audit-fix MED-A7): each NLAEditor instance
 * tracks its own drag via local state, but two instances mounted
 * simultaneously would both install document pointerup listeners
 * and both could try to commit a drag. Fix: gate commit on
 * `currentDragInstanceId === thisInstanceId` via a module-level
 * Symbol — only the instance that handled the pointerdown commits.
 *
 * # 4.D.3 — affordances (THIS COMMIT)
 *
 *   - **Click-to-select strip** (no-drag pointerup → strip selected).
 *     Editor-local state; no animData mutation. Selection drives the
 *     footer panel + enables the Edit Action button.
 *
 *   - **Strip-properties footer panel** at the bottom of the editor.
 *     Shows blend-mode dropdown + extend-mode dropdown + influence
 *     slider + per-strip Mute toggle + Edit Action button for the
 *     selected strip. Mirrors Blender's strip-properties side panel
 *     (`nla_buttons.cc` `nla_panel_properties` + `nla_panel_evaluation`)
 *     but laid out as a bottom strip instead of a right sidebar so it
 *     doesn't crowd the timeline.
 *
 *   - **Track Mute/Solo/Protected** are now clickable Lucide icons,
 *     replacing the read-only single-letter badges (S/M/P) from 4.D.1.
 *     The Disabled (D) badge remains read-only as it's runtime tweak-
 *     mode state set by `enterTweakMode`, not a user toggle. Per
 *     audit-fix Slice 4.D.1 MED-F1 re-litigation gate.
 *
 *     - Solo: byte-faithful to `BKE_nlatrack_solo_toggle`
 *       (`nla.cc:1262-1292`) — solo is EXCLUSIVE.
 *     - Mute: straight XOR per Blender `ACHANNEL_SETTING_MUTE`.
 *     - Protected: straight XOR per `ACHANNEL_SETTING_PROTECT`.
 *
 *   - **Edit Action button** per selected strip → calls Slice 4.C
 *     `enterTweakMode`. Disabled when the strip's track is PROTECTED
 *     or when this animData is already in tweak mode on a different
 *     strip (the helper returns false in that case).
 *
 *   - **Exit Tweak button** in `GroupHeader` when group is in tweak
 *     mode → calls Slice 4.C `exitTweakMode`. Passes `project` so
 *     SYNC_LENGTH-flagged strips get their bounds re-derived.
 *
 *     **isolate_action deferred** (audit-fix Slice 4.D.3 MED-F2).
 *     Blender's `NLA_OT_tweakmode_exit` (`nla_edit.cc:293-317`)
 *     accepts an `isolate_action` boolean (exposed in
 *     `space_nla.py:281` as `True` for Alt-Tab). When set, exit
 *     additionally clears `ADT_NLA_SOLO_TRACK`. SS's exitTweakMode
 *     does NOT take this parameter; the Exit Tweak button is the
 *     equivalent of Blender's default-arg `isolate_action=False`.
 *     A future slice that wires keyboard shortcuts can add an
 *     "Exit + Clear Solo" affordance + thread the param through.
 *
 *   - **Icon legend (SS DEVIATION from Blender)**:
 *     - Mute = `EyeOff` (lucide). Blender uses `ICON_CHECKBOX_HLT/DEHLT`
 *       per `anim_channels_defines.cc:5822` — a checked-box semantic
 *       that's confusingly inverted (`enabled` argument → DEHLT icon).
 *       SS uses EyeOff for the cleaner "this layer isn't visible
 *       (contributing)" mental model.
 *     - Solo = `Star` (lucide). Blender uses `ICON_SOLO_OFF/ON` per
 *       `:5800` — a star-shaped icon. Lucide's Star is the closest match.
 *     - Protected = `Lock` / `Unlock` (lucide). Matches Blender
 *       `ICON_LOCKED/UNLOCKED` per `:5811`.
 *     - Disabled = `Ban` (lucide). SS-original; Blender renders the
 *       DISABLED state by graying out the row rather than an icon.
 *
 * # 4.D.4 — CRUD + Push Action Down (THIS COMMIT)
 *
 *   - **"+ Track" button** per group header (creates a new empty
 *     NlaTrack at the top of the stack via `applyAddTrack`).
 *
 *   - **"+ Strip" affordance** per track (action-picker popover):
 *     opens a small list of project actions; clicking one inserts a
 *     fresh `NlaStrip` referencing that action via `applyAddStrip`.
 *     Refuses on PROTECTED tracks (per Blender
 *     `BKE_nlatrack_add_strip` `nla.cc:1361-1379`). Auto-positions
 *     leftmost free slot if the track has existing strips (Blender's
 *     `BKE_nlastrips_has_space` overlap-rejection semantic).
 *
 *   - **Push Action Down** button per group header (visible when
 *     `animData.actionId` is set + not in tweak mode). Calls the
 *     `applyPushActionDown` port of Blender's `BKE_nla_action_pushdown`
 *     (`nla.cc:2248-2294`). Tries top track first; creates new track
 *     named after the action if top is full. Clears `actionId` on
 *     success.
 *
 *   - **Delete affordances** via right-click context menu (track) +
 *     trash button in the strip-properties footer (strip). Both go
 *     through the `wouldRemoveXChange` predicate to disable on
 *     PROTECTED tracks or when the strip/track is in tweak mode
 *     (substrate refuses; UI gates to avoid no-op click). Track
 *     delete cascades to strips (per Blender
 *     `BKE_nlatrack_remove_and_free` `nla.cc:684-688` + the
 *     `BKE_nlatrack_free` strip-loop at `nla.cc:109-126` it delegates
 *     to). Audit-fix Slice 4.D.4 HIGH-A1: pre-fix cite was
 *     `nla.cc:706-744` which is actually `nlastrip_get_frame_actionclip`
 *     (unrelated time-mapping helper) — fabricated cite, corrected
 *     here.
 *
 *   - **Local right-click context menus** (NlaContextMenu component
 *     embedded in this module — does NOT use the global
 *     `useEditMenuStore` because that's keyed for one-at-a-time
 *     canvas usage and would conflict with dual-pane NLAEditor
 *     instances). Track context menu offers Delete + Mute/Solo/
 *     Protect quick-toggles. Strip context menu offers Delete +
 *     Edit Action + Mute.
 *
 * # Deferred to later sub-slices
 *
 *   - Ruler tick marks (basic ruler shipped 4.D.1)
 *   - Playhead (deferred until scene-time integration)
 *   - blend-in / blend-out ramp sliders (footer panel will gain them
 *     when AUTO_BLENDS flag UI lands — Blender gates them behind
 *     `use_auto_blend == false` per `nla_buttons.cc:441`)
 *   - USR_INFLUENCE / USR_TIME driven-property surfaces (Blender's
 *     "Animated Influence" sub-panel; SS doesn't model the F-curve
 *     editing chain to that level yet)
 *   - Transition strips (Blender `NLASTRIP_TYPE_TRANSITION`; SS only
 *     ships `NLASTRIP_TYPE_CLIP` equivalents in Phase 4)
 *   - Multi-select strips / box-select (only single-strip selection
 *     today via click-to-select)
 *   - Duplicate / split strip operators
 *   - "Add Track Above Selected" (Blender's `above_sel` param on
 *     `NLA_OT_tracks_add` `nla_tracks.cc:650`)
 *
 * @module v3/editors/nla/NLAEditor
 */

import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import {
  Star, Lock, Unlock, EyeOff, Eye, Ban, Edit2, X,
  Plus, Trash2, ArrowDownToLine, MoreVertical, Combine,
} from 'lucide-react';
import { useProjectStore } from '../../../store/projectStore.js';
import {
  buildNlaEditorRows,
  computeTimelineSpan,
  BLENDMODE_LABELS,
  BLENDMODE_COLORS,
  EXTENDMODE_LABELS,
} from './nlaEditorData.js';
import {
  MIN_STRIP_MS,
  applyMoveStrip,
  applyResizeStripStart,
  applyResizeStripEnd,
  applyReorderTrack,
  applySetStripBlendMode,
  applySetStripExtendMode,
  applySetStripInfluence,
  applyToggleStripMuted,
  applyToggleTrackMuted,
  applyToggleTrackProtected,
  applyToggleTrackSolo,
  applyAddTrack,
  applyAddStrip,
  applyRemoveStrip,
  applyRemoveTrack,
  applyPushActionDown,
  wouldRemoveStripChange,
  wouldRemoveTrackChange,
  wouldPushActionDownChange,
  wouldAddStripChange,
  pxDeltaToMs,
} from './nlaEditorOps.js';
import {
  NLA_BLEND_MODES, NLA_EXTEND_MODES, NLATRACK_FLAG, isTweakModeOn,
} from '../../../anim/nla.js';
import { enterTweakMode, exitTweakMode } from '../../../anim/nlaTweakMode.js';
import { applyBakeNla, wouldBakeNlaChange } from '../../operators/bakeNla.js';
import { cn } from '../../../lib/utils.js';

const LABEL_W = 200;             // 160 → 200 to fit clickable icons
const ROW_H = 24;
const RULER_H = 22;
const GROUP_HEADER_H = 28;
const RESIZE_HANDLE_W = 6;
const PROPERTIES_PANEL_H = 88;
// Click-vs-drag threshold (px) — pointerup with movement below this is
// treated as a click (select), not a drag commit.
//
// **Full SS DEVIATION** (audit-fix Slice 4.D.3 MED-F3): Blender has
// THREE separate operators where SS has one composite pointerdown:
//   1. `NLA_OT_click_select` (right-click in default keymap, MOUSE_PRESS):
//      strip selection. Walks click position to nearest strip + sets
//      NLASTRIP_FLAG.SELECT / ACTIVE.
//   2. `NLA_OT_translate` (G key, modal): start drag-translate. Modal
//      operator with its own pointermove loop.
//   3. `NLA_OT_transform` (S key, modal): resize.
// SS unifies them on left-button pointerdown + threshold-gates click
// vs drag. SS also doesn't write NLASTRIP_FLAG.SELECT to animData —
// selection is editor-local state (per SS DEVIATION at selection-state
// useState below). The 4px threshold + left-click select are
// SS-original UX choices for mouse-first single-pointer flows.
const CLICK_DRAG_THRESHOLD_PX = 4;

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
 *   isSelected: boolean,
 * }} props
 */
function StripRect({
  strip, objectId, trackId, minMs, maxMs, pxWidth, dragState, onDragStart, isSelected,
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
          : isSelected
            ? 'border-sky-400 border-2 shadow-[0_0_4px_rgba(56,189,248,0.5)] z-10'
            : 'border-black/30',
        strip.tweakuser && !strip.isTweakStrip && 'border-yellow-600/60 border-dashed',
      )}
      style={{ left: `${left}px`, width: `${width}px` }}
      data-strip-id={strip.id}
      title={[
        `${strip.name}  (${BLENDMODE_LABELS[strip.blendmode] ?? strip.blendmode})`,
        `action: ${strip.actionName}`,
        `t: ${strip.start.toFixed(0)} → ${strip.end.toFixed(0)} ms`,
        `influence: ${strip.influence.toFixed(2)}`,
        `extendmode: ${strip.extendmode}`,
        'drag body to move; drag edges to resize; right-click for context menu',
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
 * Track-level affordance icon button. Renders a clickable Lucide icon
 * for Mute / Solo / Protected toggles. Stops pointer events from
 * bubbling so the surrounding track-label drag handler doesn't trigger.
 *
 * `Icon` is typed as `any` because Lucide's `LucideIcon` is a
 * `ForwardRefExoticComponent` whose `propTypes.size` allows
 * `string | number` (legacy SVG attr semantics), and TS rejects
 * narrowing to a hand-written `{ size?: number }` signature. We
 * exclusively pass numeric `size` (12) and a className string, so the
 * loosened typing is safe in practice.
 *
 * @param {{
 *   Icon: any,
 *   active: boolean,
 *   activeColor: string,
 *   onClick: () => void,
 *   title: string,
 * }} props
 */
function IconToggle({ Icon, active, activeColor, onClick, title }) {
  const handlePointerDown = useCallback((e) => {
    // Must stop propagation so the track-label drag listener (parent)
    // doesn't grab pointer capture and start a track reorder.
    e.stopPropagation();
  }, []);
  const handleClick = useCallback((e) => {
    e.stopPropagation();
    onClick();
  }, [onClick]);
  return (
    <button
      type="button"
      className={cn(
        'p-0.5 rounded hover:bg-zinc-700/60 cursor-pointer',
        active ? activeColor : 'text-zinc-600 hover:text-zinc-400',
      )}
      title={title}
      onPointerDown={handlePointerDown}
      onClick={handleClick}
    >
      <Icon size={12} />
    </button>
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
 *   selectedStripId: string|null,
 *   onToggleTrackMuted: () => void,
 *   onToggleTrackSolo: () => void,
 *   onToggleTrackProtected: () => void,
 *   onAddStripClick: (x: number, y: number) => void,
 *   onTrackContextMenu: (x: number, y: number) => void,
 *   onStripContextMenu: (stripId: string, x: number, y: number) => void,
 * }} props
 */
function TrackRow({
  track, objectId, minMs, maxMs, pxWidth, isTweakTrack,
  dragState, onStripDragStart, onTrackDragStart, trackOriginalIndex,
  selectedStripId,
  onToggleTrackMuted, onToggleTrackSolo, onToggleTrackProtected,
  onAddStripClick, onTrackContextMenu, onStripContextMenu,
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
      {/* Label column. SS DEVIATION (Slice 4.D.3 re-litigation of
          4.D.1 MED-F1): Blender uses ICON_CHECKBOX_HLT/DEHLT for mute
          (anim_channels_defines.cc:5822), ICON_SOLO_OFF for solo
          (:5800), ICON_UNLOCKED/LOCKED for protected (:5811). SS uses
          Lucide icons (EyeOff / Star / Lock) chosen for clearer
          semantics — see module-level "Icon legend" block. The Ban
          icon for the DISABLED runtime indicator is SS-original
          (Blender just grays the row). */}
      <div
        className={cn(
          'flex items-center gap-1 px-2 border-r border-zinc-800 text-xs cursor-grab active:cursor-grabbing',
          isTweakTrack && 'text-yellow-400',
          !track.enabled && 'text-zinc-500',
        )}
        style={{ width: `${LABEL_W}px`, minWidth: `${LABEL_W}px` }}
        onPointerDown={handleTrackPointerDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onTrackContextMenu(e.clientX, e.clientY);
        }}
        title="Drag to reorder track within the stack; right-click for context menu"
      >
        <span className="text-zinc-500 text-[10px] tabular-nums w-4">
          {track.index}
        </span>
        <span className="truncate flex-1">
          {track.name}
        </span>
        <IconToggle
          Icon={track.muted ? EyeOff : Eye}
          active={track.muted}
          activeColor="text-zinc-300"
          onClick={onToggleTrackMuted}
          title={track.muted
            ? 'MUTED — track skipped during eval (click to unmute)'
            : 'Click to mute (track will be skipped)'}
        />
        <IconToggle
          Icon={Star}
          active={track.solo}
          activeColor="text-yellow-400"
          onClick={onToggleTrackSolo}
          title={track.solo
            ? 'SOLO — only this track evaluates (click to clear)'
            : 'Click to solo (only this track will evaluate)'}
        />
        <IconToggle
          Icon={track.protected_ ? Lock : Unlock}
          active={track.protected_}
          activeColor="text-sky-400"
          onClick={onToggleTrackProtected}
          title={track.protected_
            ? 'PROTECTED — edits blocked (click to unlock)'
            : 'Click to protect (block edits)'}
        />
        {track.disabled && (
          <span
            className="text-orange-500 p-0.5"
            title="DISABLED — suppressed by NLA tweak mode"
          >
            <Ban size={12} />
          </span>
        )}
        {/* 4.D.4 + Strip — opens action-picker popover anchored to the
            button's bounding rect. Disabled when track is PROTECTED
            (matches Blender's BKE_nlatrack_add_strip refusal at
            nla.cc:1361-1379). */}
        <button
          type="button"
          disabled={track.protected_}
          className={cn(
            'p-0.5 rounded cursor-pointer',
            track.protected_
              ? 'opacity-40 cursor-not-allowed text-zinc-600'
              : 'text-zinc-500 hover:bg-zinc-700 hover:text-zinc-200',
          )}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (track.protected_) return;
            const rect = e.currentTarget.getBoundingClientRect();
            onAddStripClick(rect.right, rect.top);
          }}
          title={track.protected_
            ? 'Track is PROTECTED — unlock to add strips'
            : 'Add a strip to this track (pick an Action)'}
        >
          <Plus size={12} />
        </button>
      </div>
      <div
        className="relative flex-1 overflow-hidden"
        style={{ width: `${pxWidth}px` }}
        onContextMenu={(e) => {
          // 4.D.4: if the right-click landed on a strip, surface the
          // strip context menu; otherwise the right-click is on empty
          // lane space → no menu (a future sub-slice could add an
          // "Add strip at cursor" action here).
          const target = /** @type any */ (e.target);
          const stripEl = target?.closest?.('[data-strip-id]');
          if (stripEl) {
            e.preventDefault();
            e.stopPropagation();
            onStripContextMenu(stripEl.dataset.stripId, e.clientX, e.clientY);
          }
        }}
      >
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
            isSelected={selectedStripId === strip.id}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * @param {{
 *   group: import('./nlaEditorData.js').NlaObjectGroup,
 *   animData: object|null,
 *   onExitTweak: () => void,
 *   onAddTrack: () => void,
 *   onPushDown: () => void,
 *   canPushDown: boolean,
 *   onBake: () => void,
 *   canBake: boolean,
 * }} props
 */
function GroupHeader({ group, animData, onExitTweak, onAddTrack, onPushDown, canPushDown, onBake, canBake }) {
  const activeActionName = canPushDown && animData && typeof animData.actionId === 'string'
    ? animData.actionId : null;
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
      {/* 4.D.4 Push Action Down — visible whenever group has an active
          action AND not in tweak mode. Mirrors Blender's NLA_OT_action_pushdown
          UI surface in the strip properties panel (when an active action
          is present). */}
      {canPushDown && (
        <button
          type="button"
          className="ml-2 px-2 py-0.5 rounded bg-sky-800/40 hover:bg-sky-700/60 text-sky-300 text-[10px] uppercase tracking-wider flex items-center gap-1"
          onClick={onPushDown}
          title={`Push active action${activeActionName ? ` "${activeActionName}"` : ''} down onto the NLA stack as a new strip (Blender NLA_OT_action_pushdown)`}
        >
          <ArrowDownToLine size={10} />
          Push Down
        </button>
      )}
      {/* 4.D.4 + Track — always visible (no PROTECTED-equivalent at
          the AnimData level; per-track PROTECTED gates only edit-on-
          existing-track). */}
      <button
        type="button"
        className="ml-2 px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-[10px] uppercase tracking-wider flex items-center gap-1"
        onClick={onAddTrack}
        title="Add a new empty NLA track at the top of the stack"
      >
        <Plus size={10} />
        Track
      </button>
      {/* 4.E Bake NLA — visible whenever the group has any bake-able
          content (bound action OR at least one NLA strip). Mirrors
          Blender's NLA_OT_bake (anim.py:191-336): collapses the
          composed NLA+bound-action evaluation into a single new Action
          and reassigns it on the Object. Range comes from the group's
          own strip span; step = 1000/24ms (1 frame @ 24fps). */}
      {canBake && (
        <button
          type="button"
          className="ml-2 px-2 py-0.5 rounded bg-emerald-800/40 hover:bg-emerald-700/60 text-emerald-300 text-[10px] uppercase tracking-wider flex items-center gap-1"
          onClick={onBake}
          title="Bake the NLA stack + bound action into a single new Action (Blender NLA_OT_bake). Sample step = 1 frame @ 24fps."
        >
          <Combine size={10} />
          Bake
        </button>
      )}
      {group.tweakModeOn && (
        <>
          <span
            className="ml-2 text-yellow-400 text-[10px] uppercase tracking-wider"
            title="In NLA tweak mode — editing the tweak strip's action directly"
          >
            TWEAK
          </span>
          <button
            type="button"
            className="ml-2 px-2 py-0.5 rounded bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-300 text-[10px] uppercase tracking-wider flex items-center gap-1"
            onClick={onExitTweak}
            title="Exit tweak mode — restores pre-tweak action + re-derives SYNC_LENGTH strip bounds"
          >
            <X size={10} />
            Exit Tweak
          </button>
        </>
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
 * Resolve a selected strip ref into the full NlaStripRow + track row
 * (so the footer panel can read all properties without re-walking
 * the project).
 *
 * @param {import('./nlaEditorData.js').NlaObjectGroup[]} groups
 * @param {{ objectId: string, trackId: string, stripId: string }|null} ref
 * @returns {{
 *   group: import('./nlaEditorData.js').NlaObjectGroup,
 *   track: import('./nlaEditorData.js').NlaTrackRow,
 *   strip: import('./nlaEditorData.js').NlaStripRow,
 * } | null}
 */
function resolveSelectedStrip(groups, ref) {
  if (!ref) return null;
  for (const g of groups) {
    if (g.objectId !== ref.objectId) continue;
    for (const t of g.tracks) {
      if (t.id !== ref.trackId) continue;
      for (const s of t.strips) {
        if (s.id === ref.stripId) {
          return { group: g, track: t, strip: s };
        }
      }
    }
  }
  return null;
}

/**
 * Strip-properties footer panel. Surfaces blend-mode + extend-mode +
 * influence + per-strip Mute toggle + Edit Action button for the
 * selected strip. Mirrors Blender's strip-properties side panel
 * (`nla_buttons.cc` `nla_panel_properties` :397-459) but laid out as a
 * bottom strip.
 *
 * The slider/dropdowns commit on `onChange` (immediate, like Blender's
 * RNA setters). The Edit Action button calls `enterTweakMode` via the
 * passed-in handler; the handler returns void since `enterTweakMode`'s
 * `false` return is logged separately (caller handles the case).
 *
 * @param {{
 *   resolved: {
 *     group: import('./nlaEditorData.js').NlaObjectGroup,
 *     track: import('./nlaEditorData.js').NlaTrackRow,
 *     strip: import('./nlaEditorData.js').NlaStripRow,
 *   } | null,
 *   onSetBlendMode: (m: string) => void,
 *   onSetExtendMode: (m: string) => void,
 *   onSetInfluence: (v: number) => void,
 *   onToggleStripMuted: () => void,
 *   onEditAction: () => void,
 *   onClearSelection: () => void,
 *   onDeleteStrip: () => void,
 *   deleteDisabled: boolean,
 *   deleteDisabledReason: string,
 * }} props
 */
function StripPropertiesPanel({
  resolved, onSetBlendMode, onSetExtendMode, onSetInfluence,
  onToggleStripMuted, onEditAction, onClearSelection,
  onDeleteStrip, deleteDisabled, deleteDisabledReason,
}) {
  if (!resolved) {
    return (
      <div
        className="border-t border-zinc-800 bg-zinc-900/60 px-4 flex items-center text-xs text-zinc-500"
        style={{ height: `${PROPERTIES_PANEL_H}px` }}
      >
        Click a strip to edit its properties (blend mode, extend mode,
        influence) and enter Tweak Mode on its action.
      </div>
    );
  }
  const { group, track, strip } = resolved;

  // Edit Action is disabled when (a) track is protected or (b) the
  // animData is already in tweak mode.
  //
  // - The protection gate is SS-ORIGINAL (audit-fix Slice 4.D.3 MED-F1):
  //   Blender's NLA_OT_tweakmode_enter poll function `nlaop_poll_tweakmode_off`
  //   (`nla_edit.cc:195`) checks only "is the editor not already in
  //   tweak mode" — it does NOT poll on track-protected. SS adds the
  //   gate because the PROTECTED bit is the "edits blocked" contract
  //   on a track, and entering tweak mode IS an edit-equivalent
  //   action (it routes subsequent edits into the strip's action).
  //   This deviation is enforced at TWO layers per Rule №1:
  //     1. UI affordance disable (here)
  //     2. Substrate refusal in enterTweakMode (audit-fix HIGH-A1)
  //
  // - The tweak-mode gate matches Slice 4.C audit-fix HIGH-A2: the
  //   helper rejects different-strip enter requests; the UI disables
  //   to avoid the no-op user click.
  const editActionDisabled = track.protected_ || group.tweakModeOn;
  const editActionTitle = track.protected_
    ? 'Track is PROTECTED — unlock it to enter tweak mode'
    : group.tweakModeOn
      ? group.tweakStripId === strip.id
        ? 'Already tweaking this strip'
        : 'Another strip is already in tweak mode — Exit Tweak first'
      : 'Enter tweak mode: edits to the bound action affect this strip live';

  return (
    <div
      className="border-t border-zinc-800 bg-zinc-900/60 px-4 py-2 flex flex-col gap-1"
      style={{ height: `${PROPERTIES_PANEL_H}px` }}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="text-zinc-500 uppercase text-[10px] tracking-wider">
          Strip:
        </span>
        <span className="text-zinc-200 font-medium truncate max-w-[200px]" title={strip.name}>
          {strip.name}
        </span>
        <span className="text-zinc-500 text-[10px]">
          action: {strip.actionName}
        </span>
        <span className="text-zinc-500 text-[10px]">
          @ {strip.start.toFixed(0)} → {strip.end.toFixed(0)} ms
        </span>
        <span className="flex-1" />
        <button
          type="button"
          className="text-zinc-500 hover:text-zinc-300 p-1"
          onClick={onClearSelection}
          title="Clear selection"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <label className="flex items-center gap-1">
          <span className="text-zinc-500">Blend:</span>
          <select
            className="bg-zinc-800 text-zinc-200 border border-zinc-700 rounded px-1 py-0.5 text-xs"
            value={strip.blendmode}
            onChange={(e) => onSetBlendMode(e.target.value)}
            title="Strip blend mode — how this strip's contribution combines with the accumulated NLA result"
          >
            {/* BLENDMODE_LABELS is the Blender-faithful display string
                per rna_nla.cc:32-61 rna_enum_nla_mode_blend_items
                (cite corrected by Slice 4.D.1 audit-fix). */}
            {NLA_BLEND_MODES.map((m) => (
              <option key={m} value={m}>{BLENDMODE_LABELS[m] ?? m}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-zinc-500">Extend:</span>
          <select
            className="bg-zinc-800 text-zinc-200 border border-zinc-700 rounded px-1 py-0.5 text-xs"
            value={strip.extendmode}
            onChange={(e) => onSetExtendMode(e.target.value)}
            title="Extrapolation — what plays outside [actstart, actend]"
          >
            {/* EXTENDMODE_LABELS is the Blender-faithful display string
                per rna_nla.cc:63-72 rna_enum_nla_mode_extend_items. */}
            {NLA_EXTEND_MODES.map((m) => (
              <option key={m} value={m}>{EXTENDMODE_LABELS[m] ?? m}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1 flex-1 max-w-[260px]">
          <span className="text-zinc-500">Influence:</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={strip.influence}
            onChange={(e) => onSetInfluence(parseFloat(e.target.value))}
            className="flex-1 accent-sky-500"
            title="Strip influence (0..1) — multiplier on the strip's contribution"
          />
          <span className="text-zinc-400 tabular-nums w-10 text-right">
            {strip.influence.toFixed(2)}
          </span>
        </label>
        <button
          type="button"
          className="px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-[11px] flex items-center gap-1"
          onClick={onToggleStripMuted}
          title={strip.muted ? 'Strip is MUTED — click to unmute' : 'Mute this strip'}
        >
          {strip.muted ? <Eye size={11} /> : <EyeOff size={11} />}
          {strip.muted ? 'Unmute' : 'Mute'}
        </button>
        <button
          type="button"
          className={cn(
            'px-2 py-0.5 rounded text-[11px] flex items-center gap-1',
            editActionDisabled
              ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              : 'bg-sky-700 hover:bg-sky-600 text-white',
          )}
          disabled={editActionDisabled}
          onClick={editActionDisabled ? undefined : onEditAction}
          title={editActionTitle}
        >
          <Edit2 size={11} />
          Edit Action
        </button>
        <button
          type="button"
          className={cn(
            'px-2 py-0.5 rounded text-[11px] flex items-center gap-1',
            deleteDisabled
              ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
              : 'bg-red-900/40 hover:bg-red-800/60 text-red-300',
          )}
          disabled={deleteDisabled}
          onClick={deleteDisabled ? undefined : onDeleteStrip}
          title={deleteDisabled ? deleteDisabledReason : 'Delete this strip'}
        >
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  );
}

/**
 * Empty-state placeholder. Only fires when there are zero animData-
 * bearing groups in the project — post-4.D.4, empty groups still
 * render (with the +Track button to bootstrap their first track), so
 * the "has nodes but no tracks" branch from earlier sub-slices is
 * UNREACHABLE and was deleted (audit-fix Slice 4.D.4 HIGH-A2: Rule №2
 * migration baggage — the deleted branch also carried stale
 * "shipping in Slice 4.D.4" copy about this very feature).
 */
function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full text-zinc-500 text-sm p-6">
      <div className="text-center max-w-md">
        <p className="mb-2">No animData-bearing Objects in this project.</p>
        <p className="text-xs">
          NLA tracks attach to parts, bone groups, and the scene
          pseudo-Object. Import a PSD or run the wizard to populate
          the project before adding NLA tracks.
        </p>
      </div>
    </div>
  );
}

/**
 * Editor-local right-click context menu. Used for both track and strip
 * context. Renders a small popover at the cursor; dismisses on outside
 * click or Escape. SS-original implementation (does NOT use the global
 * `useEditMenuStore` which is single-instance-only for canvas use).
 *
 * @param {{
 *   menu: { kind: 'track'|'strip', objectId: string, trackId: string, stripId?: string, x: number, y: number } | null,
 *   onClose: () => void,
 *   onDelete: () => void,
 *   onEditAction?: () => void,
 *   onToggleMuted?: () => void,
 *   onToggleSolo?: () => void,
 *   onToggleProtected?: () => void,
 *   deleteDisabled: boolean,
 *   deleteDisabledReason: string,
 * }} props
 */
function NlaContextMenu({
  menu, onClose, onDelete, onEditAction, onToggleMuted, onToggleSolo,
  onToggleProtected, deleteDisabled, deleteDisabledReason,
}) {
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu, onClose]);
  if (!menu) return null;

  // Clamp inside viewport
  const W = 200;
  const H = menu.kind === 'strip' ? 130 : 160;
  const x = Math.max(4, Math.min(window.innerWidth - W - 4, menu.x + 2));
  const y = Math.max(4, Math.min(window.innerHeight - H - 4, menu.y + 2));

  const item = (label, Icon, onClick, opts = {}) => (
    <button
      type="button"
      disabled={opts.disabled}
      className={cn(
        'w-full text-left text-[12px] px-3 py-1 flex items-center gap-2',
        opts.disabled
          ? 'opacity-40 cursor-not-allowed'
          : 'cursor-pointer hover:bg-zinc-700 hover:text-zinc-100',
        opts.danger && !opts.disabled && 'text-red-400',
      )}
      title={opts.title}
      onClick={() => { if (!opts.disabled) { onClick(); onClose(); } }}
    >
      <Icon size={12} />
      <span className="flex-1">{label}</span>
    </button>
  );

  return (
    <div
      ref={ref}
      className="fixed z-[110] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg py-1"
      style={{ left: x, top: y, width: `${W}px` }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800 mb-1">
        {menu.kind === 'track' ? 'Track' : 'Strip'}
      </div>
      {menu.kind === 'strip' && onEditAction && item('Edit Action', Edit2, onEditAction)}
      {menu.kind === 'strip' && onToggleMuted && item('Toggle Mute', EyeOff, onToggleMuted)}
      {menu.kind === 'track' && onToggleMuted && item('Toggle Mute', EyeOff, onToggleMuted)}
      {menu.kind === 'track' && onToggleSolo && item('Toggle Solo', Star, onToggleSolo)}
      {menu.kind === 'track' && onToggleProtected && item('Toggle Protect', Lock, onToggleProtected)}
      <div className="my-1 h-px bg-zinc-800" />
      {item('Delete', Trash2, onDelete, {
        disabled: deleteDisabled,
        danger: true,
        title: deleteDisabled ? deleteDisabledReason : undefined,
      })}
    </div>
  );
}

/**
 * Action-picker popover used by the "+ Strip" affordance. Renders a
 * small scrollable list of all project actions; click an entry to
 * add a strip referencing it to the target track.
 *
 * @param {{
 *   picker: { objectId: string, trackId: string, x: number, y: number } | null,
 *   project: object|null|undefined,
 *   onClose: () => void,
 *   onPick: (actionId: string) => void,
 * }} props
 */
function ActionPickerPopover({ picker, project, onClose, onPick }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!picker) return undefined;
    const onPointerDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [picker, onClose]);
  if (!picker) return null;

  const actions = Array.isArray(project?.actions) ? project.actions : [];
  // Clamp inside viewport
  const W = 240;
  const maxH = 320;
  const x = Math.max(4, Math.min(window.innerWidth - W - 4, picker.x + 2));
  const y = Math.max(4, Math.min(window.innerHeight - maxH - 4, picker.y + 2));

  return (
    <div
      ref={ref}
      className="fixed z-[110] rounded-md border border-zinc-700 bg-zinc-900 shadow-lg py-1 overflow-auto"
      style={{ left: x, top: y, width: `${W}px`, maxHeight: `${maxH}px` }}
      role="menu"
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800 mb-1">
        Add strip — pick an Action
      </div>
      {actions.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-zinc-500">
          No Actions in this project. Create one in the Actions editor first.
        </div>
      ) : (
        actions.map((a) => {
          if (!a || typeof a.id !== 'string') return null;
          const name = typeof a.name === 'string' && a.name.length > 0 ? a.name : a.id;
          const duration = typeof a.duration === 'number' ? a.duration
            : (typeof a.frameStart === 'number' && typeof a.frameEnd === 'number'
              ? Math.max(0, a.frameEnd - a.frameStart) : null);
          return (
            <button
              key={a.id}
              type="button"
              className="w-full text-left text-[12px] px-3 py-1 cursor-pointer hover:bg-zinc-700 hover:text-zinc-100 flex items-center justify-between gap-2"
              onClick={() => { onPick(a.id); onClose(); }}
              title={`${name} (${a.id})`}
            >
              <span className="truncate">{name}</span>
              {duration !== null && (
                <span className="text-[10px] text-zinc-500 tabular-nums">
                  {duration.toFixed(0)} ms
                </span>
              )}
            </button>
          );
        })
      )}
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
  // 4.D.4 — also show groups with 0 tracks so the user can bootstrap
  // the first track via the GroupHeader +Track button. Pre-4.D.4 we
  // filtered these out because there was no way to add tracks; now
  // the empty group is a valid working state.
  const visibleGroupsWithEmpty = groups;

  // Per-objectId node lookup so the GroupHeader can read animData.actionId
  // for the Push Down gate without re-traversing project.nodes per render.
  const nodesById = useMemo(() => {
    const m = new Map();
    if (project && Array.isArray(project.nodes)) {
      for (const n of project.nodes) {
        if (n && typeof n.id === 'string') m.set(n.id, n);
      }
    }
    return m;
  }, [project]);

  // Editor-local strip selection (NOT persisted in animData). 4.D.3
  // SS DEVIATION: Blender uses NLASTRIP_FLAG.SELECT + NLASTRIP_FLAG.ACTIVE
  // bits on the strip itself. SS keeps selection editor-local because
  // (a) it's UI-only state that doesn't need to survive reload, and
  // (b) the existing flag-bit-based selection would require an
  // animData-mutating click handler which would create undo entries
  // for every click — too noisy.
  const [selectedStripRef, setSelectedStripRef] = useState(
    /** @type {{ objectId: string, trackId: string, stripId: string }|null} */ (null),
  );

  // 4.D.4 — local right-click context menu state. Editor-local so two
  // NLAEditor instances don't fight over `useEditMenuStore` (which is
  // designed for single-canvas global use).
  const [contextMenu, setContextMenu] = useState(
    /** @type {{
     *   kind: 'track'|'strip',
     *   objectId: string,
     *   trackId: string,
     *   stripId?: string,
     *   x: number,
     *   y: number,
     * } | null} */ (null),
  );

  // 4.D.4 — open action-picker popover for the +Strip affordance.
  // Pinned to (objectId, trackId) so we know which track to add to.
  const [actionPicker, setActionPicker] = useState(
    /** @type {{ objectId: string, trackId: string, x: number, y: number } | null} */ (null),
  );

  // When the underlying strip gets deleted/renamed by another flow,
  // drop the selection so the footer panel doesn't show stale data.
  // Resolution via resolveSelectedStrip() inside the render below;
  // here we just hold the ref.
  const resolvedSelection = useMemo(
    () => resolveSelectedStrip(visibleGroupsWithEmpty, selectedStripRef),
    [visibleGroupsWithEmpty, selectedStripRef],
  );
  useEffect(() => {
    if (selectedStripRef && !resolvedSelection) {
      setSelectedStripRef(null);
    }
  }, [selectedStripRef, resolvedSelection]);

  // Audit-fix Slice 4.D.3 HIGH-A2: reset selection on PROJECT IDENTITY
  // change. The resolved-selection useEffect above clears when the
  // strip can't be found, but a freshly-loaded project may have a
  // strip with the SAME id as the previously-selected one (e.g., both
  // derived from a shared UUID namespace, or the user re-loaded the
  // same .stretch file). Without this gate the footer panel would
  // resolve to a different strip object and silently show stale data.
  const projectId = project?.id ?? null;
  useEffect(() => {
    setSelectedStripRef(null);
  }, [projectId]);

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

  // Maximum pointer movement (px) during the active drag — used by
  // pointerup to distinguish click-select from drag-commit. Ref instead
  // of state so we don't re-render on every pointermove.
  const maxMovePxRef = useRef(0);

  useEffect(() => {
    if (!dragState) return undefined;
    maxMovePxRef.current = 0;

    const handleMove = (e) => {
      if (dragState.kind === 'strip') {
        const deltaPx = e.clientX - dragState.startPx;
        const movedPx = Math.abs(deltaPx);
        if (movedPx > maxMovePxRef.current) maxMovePxRef.current = movedPx;
        const deltaMs = pxDeltaToMs(deltaPx, span.minMs, span.maxMs, pxWidth);
        setDragState((prev) => prev && prev.kind === 'strip'
          ? { ...prev, previewDeltaMs: deltaMs } : prev);
      } else {
        // Track drag — convert pointer Y delta to index delta via ROW_H
        const deltaY = e.clientY - dragState.startY;
        const movedPx = Math.abs(deltaY);
        if (movedPx > maxMovePxRef.current) maxMovePxRef.current = movedPx;
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
        // 4.D.3: click-vs-drag distinction. If pointer barely moved,
        // this was a click → select the strip (or no-op for track drag).
        const wasClick = maxMovePxRef.current <= CLICK_DRAG_THRESHOLD_PX;
        if (dragState.kind === 'strip') {
          if (wasClick) {
            // Click on strip → select for footer panel
            setSelectedStripRef({
              objectId: dragState.objectId,
              trackId: dragState.trackId,
              stripId: dragState.stripId,
            });
          } else {
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
          }
        } else {
          // Track reorder commit (click on track label = no-op, no select)
          if (!wasClick) {
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

  // ----- Affordance callbacks (per-object/track/strip mutators) -----
  // Each one wraps the pure op in an updateProject recipe. The recipe
  // mutates the node.animData ref via immer (Zustand store action),
  // matching the 4.D.2 drag-commit pattern.

  const makeNodeRecipe = useCallback((objectId, mutator) => {
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      const newAd = mutator(node.animData);
      // Audit-fix Slice 4.D.3 MED-A2: strict !== match (NOT
      // truthiness). All current + documented-future ops in
      // nlaEditorOps.js return either same-ref animData (no-op) or
      // a new object — never null/undefined/false. A truthiness check
      // would silently swallow a future op that accidentally returned
      // falsy (Rule №1: no silent fallbacks). Mirrors the 4.D.2
      // drag-commit pattern in the pointerup handler.
      if (newAd !== node.animData) {
        node.animData = newAd;
      }
    });
  }, [updateProject]);

  const handleToggleTrackMuted = useCallback((objectId, trackId) => {
    makeNodeRecipe(objectId, (ad) => applyToggleTrackMuted(ad, trackId));
  }, [makeNodeRecipe]);

  const handleToggleTrackSolo = useCallback((objectId, trackId) => {
    makeNodeRecipe(objectId, (ad) => applyToggleTrackSolo(ad, trackId));
  }, [makeNodeRecipe]);

  const handleToggleTrackProtected = useCallback((objectId, trackId) => {
    makeNodeRecipe(objectId, (ad) => applyToggleTrackProtected(ad, trackId));
  }, [makeNodeRecipe]);

  const handleToggleStripMuted = useCallback((objectId, trackId, stripId) => {
    makeNodeRecipe(objectId, (ad) => applyToggleStripMuted(ad, trackId, stripId));
  }, [makeNodeRecipe]);

  const handleSetBlendMode = useCallback((objectId, trackId, stripId, mode) => {
    makeNodeRecipe(objectId, (ad) => applySetStripBlendMode(ad, trackId, stripId, mode));
  }, [makeNodeRecipe]);

  const handleSetExtendMode = useCallback((objectId, trackId, stripId, mode) => {
    makeNodeRecipe(objectId, (ad) => applySetStripExtendMode(ad, trackId, stripId, mode));
  }, [makeNodeRecipe]);

  const handleSetInfluence = useCallback((objectId, trackId, stripId, value) => {
    makeNodeRecipe(objectId, (ad) => applySetStripInfluence(ad, trackId, stripId, value));
  }, [makeNodeRecipe]);

  // enterTweakMode / exitTweakMode mutate animData IN PLACE (per Slice
  // 4.C contract — caller controls persistence). Wrap in updateProject
  // so immer captures the mutations into a new project snapshot.
  const handleEditAction = useCallback((objectId, trackId, stripId) => {
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      // enterTweakMode returns false if already in tweak mode on a
      // different strip OR if the strip can't be found. The footer-
      // panel button is disabled in those cases per the disabled-state
      // logic in StripPropertiesPanel; if a stale call slips through,
      // the no-op is silent (animData unchanged).
      enterTweakMode(node.animData, trackId, stripId);
    });
  }, [updateProject]);

  const handleExitTweak = useCallback((objectId) => {
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      if (!isTweakModeOn(node.animData)) return;
      // Pass project so SYNC_LENGTH-flagged strips get bounds re-derived
      // per Slice 4.C audit-fix HIGH-F5.
      exitTweakMode(node.animData, proj);
    });
  }, [updateProject]);

  // ----- Slice 4.D.4 CRUD callbacks -----

  const handleAddTrack = useCallback((objectId) => {
    makeNodeRecipe(objectId, (ad) => applyAddTrack(ad));
  }, [makeNodeRecipe]);

  const handleAddStrip = useCallback((objectId, trackId, actionId) => {
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      const newAd = applyAddStrip(node.animData, proj, trackId, actionId, 0);
      if (newAd !== node.animData) {
        node.animData = newAd;
      }
    });
  }, [updateProject]);

  const handleRemoveStrip = useCallback((objectId, trackId, stripId) => {
    // Audit-fix Slice 4.D.4 MED-A4: gate the selection-clear on
    // SUBSTRATE SUCCESS, not on the call attempt. If the substrate
    // refuses (PROTECTED-changed-since-menu-opened, tweak strip,
    // missing strip), we must NOT clear selection — that would
    // discard editor state on a no-op. Lift to inline updateProject
    // so we can observe `ad !== node.animData` after the recipe.
    let didChange = false;
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      const newAd = applyRemoveStrip(node.animData, trackId, stripId);
      if (newAd !== node.animData) {
        node.animData = newAd;
        didChange = true;
      }
    });
    if (didChange
        && selectedStripRef
        && selectedStripRef.objectId === objectId
        && selectedStripRef.trackId === trackId
        && selectedStripRef.stripId === stripId) {
      setSelectedStripRef(null);
    }
  }, [updateProject, selectedStripRef]);

  const handleRemoveTrack = useCallback((objectId, trackId) => {
    let didChange = false;
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      const newAd = applyRemoveTrack(node.animData, trackId);
      if (newAd !== node.animData) {
        node.animData = newAd;
        didChange = true;
      }
    });
    if (didChange
        && selectedStripRef
        && selectedStripRef.objectId === objectId
        && selectedStripRef.trackId === trackId) {
      setSelectedStripRef(null);
    }
  }, [updateProject, selectedStripRef]);

  const handlePushActionDown = useCallback((objectId) => {
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      const newAd = applyPushActionDown(node.animData, proj);
      if (newAd !== node.animData) {
        node.animData = newAd;
      }
    });
  }, [updateProject]);

  // Slice 4.E — BakeNLA. Computes the bake range from the group's own
  // track span; step is 1000/24 ms (= 1 frame @ 24fps, matching Blender's
  // default `step=1` on NLA_OT_bake at anim.py:209-213). useCurrentAction
  // defaults false (Blender default) — creates a new action + reassigns,
  // less destructive than overwriting the bound action's fcurves.
  const handleBake = useCallback((objectId) => {
    updateProject((proj) => {
      const node = proj.nodes.find((n) => n && n.id === objectId);
      if (!node || !node.animData) return;
      // Per-group bake range: walk this object's tracks/strips for the
      // [min, max] span; fall back to [0, 1000] if the group is purely
      // bound-action (no NLA strips → action's own frame range would be
      // the ideal default; bakeNla itself doesn't read action.frameStart
      // so we walk + default sensibly here).
      let minMs = 0;
      let maxMs = 0;
      const tracks = Array.isArray(node.animData.nlaTracks) ? node.animData.nlaTracks : [];
      for (const t of tracks) {
        const strips = Array.isArray(t?.strips) ? t.strips : [];
        for (const s of strips) {
          if (typeof s?.start === 'number' && s.start < minMs) minMs = s.start;
          if (typeof s?.end === 'number' && s.end > maxMs) maxMs = s.end;
        }
      }
      // If bound action only (no NLA strips), default to the action's
      // own frameStart/frameEnd/duration when present.
      if (maxMs === 0 && typeof node.animData.actionId === 'string') {
        const action = (proj.actions ?? []).find((a) => a && a.id === node.animData.actionId);
        if (action) {
          if (typeof action.frameStart === 'number') minMs = action.frameStart;
          if (typeof action.frameEnd === 'number') maxMs = action.frameEnd;
          else if (typeof action.duration === 'number') maxMs = action.duration;
        }
      }
      if (maxMs <= minMs) maxMs = minMs + 1000;   // Minimum 1s range fallback
      applyBakeNla(proj, objectId, {
        frameStartMs: minMs,
        frameEndMs: maxMs,
        stepMs: 1000 / 24,
        useCurrentAction: false,
        cleanCurves: false,
      });
    });
  }, [updateProject]);

  // Strip delete state (for the StripPropertiesPanel footer).
  const stripDeleteState = useMemo(() => {
    if (!resolvedSelection) return { canDelete: false, reason: 'No strip selected' };
    const { group, track, strip } = resolvedSelection;
    const node = nodesById.get(group.objectId);
    const ad = node?.animData;
    const ok = ad && wouldRemoveStripChange(ad, track.id, strip.id);
    if (ok) return { canDelete: true, reason: '' };
    if (track.protected_) return { canDelete: false, reason: 'Track is PROTECTED — unlock to delete strips' };
    if (group.tweakStripId === strip.id) return { canDelete: false, reason: 'Strip is in tweak mode — Exit Tweak first' };
    return { canDelete: false, reason: 'Cannot delete this strip' };
  }, [resolvedSelection, nodesById]);

  // Context-menu delete state (for NlaContextMenu).
  const contextMenuDeleteState = useMemo(() => {
    if (!contextMenu) return { disabled: false, reason: '' };
    const node = nodesById.get(contextMenu.objectId);
    const ad = node?.animData;
    if (!ad) return { disabled: true, reason: 'No animData' };
    if (contextMenu.kind === 'track') {
      if (wouldRemoveTrackChange(ad, contextMenu.trackId)) return { disabled: false, reason: '' };
      const tracks = Array.isArray(ad.nlaTracks) ? ad.nlaTracks : [];
      const t = tracks.find((x) => x && x.id === contextMenu.trackId);
      const trackFlag = typeof t?.flag === 'number' ? t.flag : 0;
      if ((trackFlag & NLATRACK_FLAG.PROTECTED) !== 0) return { disabled: true, reason: 'Track is PROTECTED' };
      return { disabled: true, reason: 'Track contains the tweak strip — Exit Tweak first' };
    }
    if (contextMenu.stripId
        && wouldRemoveStripChange(ad, contextMenu.trackId, contextMenu.stripId)) {
      return { disabled: false, reason: '' };
    }
    return { disabled: true, reason: 'Cannot delete (PROTECTED or in tweak mode)' };
  }, [contextMenu, nodesById]);

  // All hooks above this line. Early return safe now.
  if (visibleGroupsWithEmpty.length === 0) {
    return (
      <div ref={setContainerRef} className="h-full">
        <EmptyState />
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

      {/* Audit-fix Slice 4.D.3 MED-A3: TrackRow / GroupHeader receive
          INLINE arrow callbacks that bind (objectId, trackId) at the
          map step. These create fresh function refs per render and so
          would defeat any React.memo wrap on TrackRow. Acceptable
          today because TrackRow is NOT memoized — the project's
          per-frame N-track render is well under the React reconciler's
          cost-per-element budget. If TrackRow ever gets React.memo
          (likely when track count routinely exceeds ~50), refactor:
          either pass (objectId, trackId) as props + have TrackRow
          call useCallback'd parent handlers with them, or stabilize
          the binding via a small per-track useMemo. The
          useCallback'd handler layer (handleToggleTrackMuted etc) is
          already structured to support that move. */}
      {visibleGroupsWithEmpty.map((group) => {
        const groupNode = nodesById.get(group.objectId);
        const groupAnimData = groupNode?.animData ?? null;
        const canPushDown = wouldPushActionDownChange(groupAnimData);
        const canBake = wouldBakeNlaChange(groupAnimData);
        return (
          <div key={group.objectId}>
            <GroupHeader
              group={group}
              animData={groupAnimData}
              onExitTweak={() => handleExitTweak(group.objectId)}
              onAddTrack={() => handleAddTrack(group.objectId)}
              onPushDown={() => handlePushActionDown(group.objectId)}
              canPushDown={canPushDown}
              onBake={() => handleBake(group.objectId)}
              canBake={canBake}
            />
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
                selectedStripId={
                  selectedStripRef
                    && selectedStripRef.objectId === group.objectId
                    && selectedStripRef.trackId === track.id
                    ? selectedStripRef.stripId
                    : null
                }
                onToggleTrackMuted={() => handleToggleTrackMuted(group.objectId, track.id)}
                onToggleTrackSolo={() => handleToggleTrackSolo(group.objectId, track.id)}
                onToggleTrackProtected={() => handleToggleTrackProtected(group.objectId, track.id)}
                onAddStripClick={(x, y) => setActionPicker({
                  objectId: group.objectId, trackId: track.id, x, y,
                })}
                onTrackContextMenu={(x, y) => setContextMenu({
                  kind: 'track', objectId: group.objectId, trackId: track.id, x, y,
                })}
                onStripContextMenu={(stripId, x, y) => setContextMenu({
                  kind: 'strip', objectId: group.objectId, trackId: track.id, stripId, x, y,
                })}
              />
            ))}
          </div>
        );
      })}
      <StripPropertiesPanel
        resolved={resolvedSelection}
        onSetBlendMode={(m) => resolvedSelection && handleSetBlendMode(
          resolvedSelection.group.objectId, resolvedSelection.track.id,
          resolvedSelection.strip.id, m)}
        onSetExtendMode={(m) => resolvedSelection && handleSetExtendMode(
          resolvedSelection.group.objectId, resolvedSelection.track.id,
          resolvedSelection.strip.id, m)}
        onSetInfluence={(v) => resolvedSelection && handleSetInfluence(
          resolvedSelection.group.objectId, resolvedSelection.track.id,
          resolvedSelection.strip.id, v)}
        onToggleStripMuted={() => resolvedSelection && handleToggleStripMuted(
          resolvedSelection.group.objectId, resolvedSelection.track.id,
          resolvedSelection.strip.id)}
        onEditAction={() => resolvedSelection && handleEditAction(
          resolvedSelection.group.objectId, resolvedSelection.track.id,
          resolvedSelection.strip.id)}
        onClearSelection={() => setSelectedStripRef(null)}
        onDeleteStrip={() => resolvedSelection && handleRemoveStrip(
          resolvedSelection.group.objectId, resolvedSelection.track.id,
          resolvedSelection.strip.id)}
        deleteDisabled={!stripDeleteState.canDelete}
        deleteDisabledReason={stripDeleteState.reason}
      />
      <NlaContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onDelete={() => {
          if (!contextMenu) return;
          if (contextMenu.kind === 'track') {
            handleRemoveTrack(contextMenu.objectId, contextMenu.trackId);
          } else if (contextMenu.stripId) {
            handleRemoveStrip(contextMenu.objectId, contextMenu.trackId, contextMenu.stripId);
          }
        }}
        onEditAction={contextMenu?.kind === 'strip' && contextMenu.stripId
          ? () => handleEditAction(contextMenu.objectId, contextMenu.trackId,
            /** @type string */ (contextMenu.stripId))
          : undefined}
        onToggleMuted={contextMenu
          ? () => {
              if (contextMenu.kind === 'track') {
                handleToggleTrackMuted(contextMenu.objectId, contextMenu.trackId);
              } else if (contextMenu.stripId) {
                handleToggleStripMuted(contextMenu.objectId, contextMenu.trackId,
                  contextMenu.stripId);
              }
            }
          : undefined}
        onToggleSolo={contextMenu?.kind === 'track'
          ? () => handleToggleTrackSolo(contextMenu.objectId, contextMenu.trackId)
          : undefined}
        onToggleProtected={contextMenu?.kind === 'track'
          ? () => handleToggleTrackProtected(contextMenu.objectId, contextMenu.trackId)
          : undefined}
        deleteDisabled={contextMenuDeleteState.disabled}
        deleteDisabledReason={contextMenuDeleteState.reason}
      />
      <ActionPickerPopover
        picker={actionPicker}
        project={project}
        onClose={() => setActionPicker(null)}
        onPick={(actionId) => {
          if (!actionPicker) return;
          handleAddStrip(actionPicker.objectId, actionPicker.trackId, actionId);
          setActionPicker(null);
        }}
      />
    </div>
  );
}
