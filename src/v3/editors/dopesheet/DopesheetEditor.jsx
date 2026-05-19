// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 3B — Dopesheet editor.
 *
 * Sibling to TimelineEditor, focused on keyform DENSITY rather than
 * playback scrubbing. One row per fcurve, ticks at the times their
 * keyforms live. Click a tick to jump the playhead. Read-only on
 * the keyform values themselves — editing still happens through
 * the timeline / animation mode + auto-keyframe.
 *
 * The point of this view is "what does this animation actually do at
 * a glance" — does this motion fire on every frame, or just at start
 * and end? Are the params evenly distributed? You can answer those
 * questions in 0.5s here vs. scrolling through Timeline's 22px rows.
 *
 * Row ordering: parameter fcurves first (alphabetical by id), then
 * node fcurves grouped by node, then by property within node. That
 * groups everything driving the same dial together.
 *
 * # Slice 5.W — row-state styling
 *
 * Row data + filtering are extracted to [./dopesheetRows.js](./dopesheetRows.js)
 * so the React tree only handles presentation. Per-row state (full
 * rationale + Blender citations in that module's header):
 *
 *   - **Muted** (`isFCurveEffectivelyMuted` — per-fcurve OR group
 *     cascade): label gets `italic opacity-60`; diamonds drop to 0.4
 *     alpha. Per-row dot doesn't branch on hidden (audit-fix L4): hidden
 *     rows are filtered out by the builder and never reach the renderer,
 *     so the FCurveEditor sidebar's `opacity: isHidden || isMuted ? 0.3
 *     : 1` (see [src/v3/editors/fcurve/FCurveEditor.jsx:3166](../fcurve/FCurveEditor.jsx#L3166))
 *     collapses to just `isMuted` here.
 *
 *   - **Hidden** (`isFCurveEffectivelyHidden`): row filtered out
 *     entirely. Deliberate SS deviation from Blender's Action Editor
 *     (which keeps hidden rows visible in the channel sidebar); see
 *     `dopesheetRows.js` Deviation 3 for the rationale.
 *
 *   - **Active keyform pin** (`fc.activeKeyformIndex`, Slice 5.H):
 *     pale-yellow ring + amber-300 fill, rendered LAST so it sits on
 *     top of adjacent diamonds. Gated on `fc.active === true` (persisted
 *     FCURVE_ACTIVE bit shipped in Slice 5.X at
 *     [src/anim/fcurveActive.js](../../../anim/fcurveActive.js)), with
 *     `pickActiveFCurve(action, selection)` as the bootstrap fallback
 *     for legacy actions that haven't yet been clicked. Mirrors
 *     `draw_fcurve_active_vertex` at `graph_draw.cc:244` (early-returns
 *     on `!(fcu->flag & FCURVE_ACTIVE)`). Pre-5.X, the gate relied
 *     solely on the selection-derived fallback (Slice 5.W audit-fix
 *     HIGH-2) — without a persisted flag, every row carrying
 *     `activeKeyformIndex` showed a halo (`setActiveKeyform` doesn't
 *     clear sibling fcurves' indices).
 *
 * @module v3/editors/dopesheet/DopesheetEditor
 */

import { useMemo, useRef, useCallback, useState, useEffect } from 'react';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import {
  useKeyformSelectionStore,
  useKeyformSelectionState,
  isKeyformCenterSelected,
} from '../../../store/keyformSelectionStore.js';
import {
  applyTickSelectReplace,
  applyTickSelectExtend,
  applyTickSelectDeselect,
  isTickSelected,
} from '../../../anim/dopesheetSelectOps.js';
import {
  applyBoxSelect,
  computeBoxHits,
} from '../../../anim/dopesheetBoxSelect.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { pickActiveFCurve } from '../../../anim/fcurvePicker.js';
import { getActiveFCurve } from '../../../anim/fcurveActive.js';
import { buildDopesheetRows, getKeyformRenderOrder } from './dopesheetRows.js';

const LABEL_W = 180;
const ROW_H   = 18;
const RULER_H = 16;

export function DopesheetEditor() {
  const projectNodes = useProjectStore((s) => s.project.nodes);
  const projectParameters = useProjectStore((s) => s.project.parameters);
  const projectActions = useProjectStore((s) => s.project.actions);
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const selection = useSelectionStore((s) => s.items);
  const currentTime  = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);

  // Stage 1.E: scene-bound action wins over UI-store fallback. Audit-fix
  // H1 (Slice 5.W arch audit 2026-05-17): narrowed deps below from
  // [action, project] to just the slices the builder reads — any
  // unrelated `project` mutation (wizard step, vertex paint, etc.)
  // would otherwise rebuild the entire row list.
  const action = useMemo(
    () => getActiveSceneAction({ nodes: projectNodes, actions: projectActions }, activeActionId),
    [projectNodes, projectActions, activeActionId],
  );

  // Audit-fix H1: dep only on the narrow slices buildDopesheetRows
  // actually reads. The picker (HIGH-2 gate) needs only `selection`.
  const projectForBuild = useMemo(
    () => ({ nodes: projectNodes, parameters: projectParameters }),
    [projectNodes, projectParameters],
  );
  const rows = useMemo(
    () => buildDopesheetRows(action, projectForBuild),
    [action, projectForBuild],
  );
  // Slice 5.X: persisted FCURVE_ACTIVE flag is the source of truth;
  // selection-derived picker is the bootstrap fallback for legacy
  // actions that don't carry `fc.active` yet. See
  // [src/anim/fcurveActive.js](../../../anim/fcurveActive.js) module
  // header for the full precedence rationale (sister to FCurveEditor's
  // `activeFCurve` memo at line ~467).
  //
  // Audit-fix HIGH-1 (Slice 5.X arch audit 2026-05-17): deps narrowed
  // to `[action?.fcurves, selection]` so the memo only re-runs when
  // either fcurves OR selection actually changes. Sister narrowing
  // to FCurveEditor.jsx's activeFCurve memo. Mirrors Slice 5.W H1's
  // narrowing convention on the `rows` memo below.
  const activeFCurveId = useMemo(
    () => getActiveFCurve(action)?.id ?? pickActiveFCurve(action, selection)?.id ?? null,
    [action?.fcurves, selection],
  );

  // Audit-fix Slice 6.B (TS2448): hoist `duration` above the box-select
  // useCallback so its closure has a defined binding at hook-declaration
  // time. The actual usage only fires at runtime when `action` is
  // non-null (the early return below blocks render otherwise), but the
  // strict-mode TS check is at-declaration, not at-runtime. `action`
  // may be null here; default to 1000 in that case — none of the
  // box-select callbacks (down/move/up) can fire because the early
  // return prevents the track area from mounting + receiving pointer
  // events. The default is a defensive value, not a runtime path.
  const duration = Math.max(1, action?.duration ?? 1000);

  // Slice 5.EE — subscribe to keyform-selection store. Slice 6.A
  // promoted DopesheetEditor from READER to WRITER (tick clicks now
  // mutate the shared store via dopesheetSelectOps); the
  // [handles, setHandles] tuple gives useState-shaped ergonomics on
  // top of the lifted shared state. The halo gate (Slice 5.EE) still
  // reads `handles` via the same subscription — no subscriber churn.
  const [keyformSelectionHandles, setKeyformSelectionHandles] = useKeyformSelectionState();

  // Slice 6.A — tick click handler. Plain LMB replaces; Shift+LMB
  // extends (toggle); Ctrl+LMB deselects; double-click seeks the
  // playhead to the tick's time (preserves the prior seek workflow).
  // Click-on-row-body (empty timeline area) still seeks per the
  // existing onClick at the row-container.
  const handleTickClick = useCallback(
    /**
     * @param {MouseEvent | React.MouseEvent} e
     * @param {string} fcurveId
     * @param {number} kfIdx
     */
    (e, fcurveId, kfIdx) => {
      e.stopPropagation();
      if (e.shiftKey) {
        setKeyformSelectionHandles((prev) =>
          applyTickSelectExtend(prev, fcurveId, kfIdx));
      } else if (e.ctrlKey || e.metaKey) {
        setKeyformSelectionHandles((prev) =>
          applyTickSelectDeselect(prev, fcurveId, kfIdx));
      } else {
        setKeyformSelectionHandles((prev) =>
          applyTickSelectReplace(prev, fcurveId, kfIdx));
      }
    },
    [setKeyformSelectionHandles],
  );

  const trackAreaRef = useRef(/** @type {HTMLDivElement|null} */ (null));

  // ── Slice 6.B: box-select state + handlers ─────────────────────────────
  // Drag state tracks the IN-PROGRESS marquee. `mode` is captured at
  // pointerdown (modifier-keys at that time decide REPLACE/EXTEND/SUB);
  // changing modifiers mid-drag doesn't change the mode (matches Blender's
  // CLICK_DRAG bindings which read modifiers at the gesture START).
  // `tMinPx` / `tMaxPx` track the rect in TRACK-AREA-LOCAL X pixels;
  // `yMin` / `yMax` track in TRACK-AREA-LOCAL Y pixels. The track area's
  // width represents the action's full `duration` linearly.
  /** @typedef {{
   *   startX: number, startY: number,
   *   curX: number, curY: number,
   *   mode: 'replace'|'extend'|'subtract'
   * }} BoxDragState */
  /** @type {[BoxDragState|null, Function]} */
  const [boxDrag, setBoxDrag] = useState(null);
  // B-key armed state — set true on B keypress; next pointerdown in
  // the track area starts a drag-rect (skipping the on-tick guard).
  // Mirrors FCurveEditor's bGestureArmed pattern from Slice 5.FF.
  const [bArmed, setBArmed] = useState(false);

  // 4px drag threshold (audit-fix Slice 5.Y precedent for SS — Blender's
  // WM_event_drag_threshold default is 3px, SS rounds to 4 for the
  // pointer-event handlers). Below this, treat as click; above as drag.
  const DRAG_THRESHOLD_PX = 4;

  // Track-area pointerdown handler — disambiguates click vs drag-rect.
  // Returns early when:
  //   - target is a tick element (let tick onClick fire — Blender's
  //     `actkeys_box_select_invoke` returns OPERATOR_PASS_THROUGH when
  //     the drag started ON a key, per action_select.cc:613-618;
  //     EXCEPTION: if bArmed, override and start the drag-rect anyway
  //     so B-key + LMB-on-key still box-selects, matching Blender's
  //     BKEY path which doesn't have the tweak check.)
  //   - pointerType is not 'mouse' (touch/pen — keep simple for 6.B;
  //     Slice 6.C will reconsider for modal grab)
  const handleTrackPointerDown = useCallback(
    /** @param {React.PointerEvent<HTMLDivElement>} e */
    (e) => {
      if (e.button !== 0) return;   // LMB only
      const targetEl = /** @type {HTMLElement|null} */ (e.target);
      const onTick = targetEl?.closest('[data-tick="1"]') !== null;
      if (onTick && !bArmed) {
        // Let the tick onClick handle this — don't start drag-rect.
        return;
      }
      const trackArea = trackAreaRef.current;
      if (!trackArea) return;
      const rect = trackArea.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;
      /** @type {'replace'|'extend'|'subtract'} */
      const mode = e.shiftKey ? 'extend'
        : (e.ctrlKey || e.metaKey) ? 'subtract'
        : 'replace';
      setBoxDrag({ startX, startY, curX: startX, curY: startY, mode });
      setBArmed(false);   // consumed
      // Capture pointer on the track area so subsequent move/up land
      // on it even if the cursor leaves the element bounds.
      try { trackArea.setPointerCapture(e.pointerId); } catch { /* noop */ }
    },
    [bArmed],
  );

  // Pointermove during drag — update the rect's current corner. Below
  // threshold, the pointerup commit will treat it as a click (no-op
  // on the box-select side; the tick onClick already ran if applicable).
  //
  // Audit-fix Slice 6.B HIGH-A1: callback identity is now stable —
  // empty dep array, functional `setBoxDrag` reads latest state inside
  // the updater + short-circuits when no drag is active. Pre-fix the
  // `[boxDrag]` dep recreated the callback on every drag-move event
  // (60-120 Hz), triggering pointer-handler prop churn + re-attach
  // on every frame.
  const handleTrackPointerMove = useCallback(
    /** @param {React.PointerEvent<HTMLDivElement>} e */
    (e) => {
      const trackArea = trackAreaRef.current;
      if (!trackArea) return;
      const rect = trackArea.getBoundingClientRect();
      const curX = e.clientX - rect.left;
      const curY = e.clientY - rect.top;
      setBoxDrag((/** @type {BoxDragState|null} */ prev) =>
        prev ? { ...prev, curX, curY } : prev);
    },
    [],
  );

  // Pointerup — commit the box-select (if drag exceeded threshold) or
  // discard (if it was a click). Commit reads the rect's X-range and
  // the Y-intersected rows, builds hits, calls applyBoxSelect, writes
  // to the store.
  const handleTrackPointerUp = useCallback(
    /** @param {React.PointerEvent<HTMLDivElement>} e */
    (e) => {
      const drag = boxDrag;
      setBoxDrag(null);
      const trackArea = trackAreaRef.current;
      if (trackArea) {
        try { trackArea.releasePointerCapture(e.pointerId); } catch { /* noop */ }
      }
      if (!drag || !trackArea) return;
      const dx = Math.abs(drag.curX - drag.startX);
      const dy = Math.abs(drag.curY - drag.startY);
      if (dx < DRAG_THRESHOLD_PX && dy < DRAG_THRESHOLD_PX) {
        // Below threshold → click, not drag. No box-select side effect.
        // (Tick onClick already ran if applicable.)
        return;
      }
      // Compute Y-intersected rows via DOM row bounding boxes. Each
      // row's data-row-idx attribute lets us index back into `rows`.
      const trackRect = trackArea.getBoundingClientRect();
      const yMinAbs = Math.min(drag.startY, drag.curY) + trackRect.top;
      const yMaxAbs = Math.max(drag.startY, drag.curY) + trackRect.top;
      /** @type {Array<{fcurveId: string, keyforms: Array<{time: number}>}>} */
      const hitRows = [];
      // Walk the rendered Row elements via querySelectorAll on the
      // track area — the per-row DOM node carries data-row-idx as a
      // numeric string into `rows`.
      const rowEls = trackArea.querySelectorAll('[data-row-idx]');
      for (const el of rowEls) {
        const rb = el.getBoundingClientRect();
        // Y intersect: row's [top, bottom] overlaps [yMinAbs, yMaxAbs]
        if (rb.bottom < yMinAbs || rb.top > yMaxAbs) continue;
        const idxStr = el.getAttribute('data-row-idx');
        if (idxStr === null) continue;
        const idx = parseInt(idxStr, 10);
        const row = rows[idx];
        if (!row || !row.fcurveId) continue;
        hitRows.push({ fcurveId: row.fcurveId, keyforms: row.keyforms });
      }
      // Convert track-area-local X to time. Track area's full width =
      // `duration` ms. The Row's tick area starts after the LABEL_W
      // column, so subtract LABEL_W first.
      const tickAreaWidth = Math.max(1, trackRect.width - LABEL_W);
      const xToTime = (/** @type {number} */ x) =>
        ((x - LABEL_W) / tickAreaWidth) * duration;
      const tMin = xToTime(Math.min(drag.startX, drag.curX));
      const tMax = xToTime(Math.max(drag.startX, drag.curX));
      const hits = computeBoxHits(hitRows, tMin, tMax);
      setKeyformSelectionHandles((prev) =>
        applyBoxSelect(prev, hits, drag.mode));
    },
    [boxDrag, rows, duration, setKeyformSelectionHandles],
  );

  // B-key handler — arms the gesture for the next pointerdown.
  // Audit-fix Slice 6.B HIGH-A2: split into TWO effects so the
  // arm-listener (which doesn't read `bArmed`) stays mounted with
  // an empty dep array, and only the Escape-clear listener
  // re-registers when bArmed flips. Pre-fix both listeners re-mounted
  // on every B-press → wasteful churn.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (e.key !== 'b' && e.key !== 'B') return;
      // Skip if user is typing in an input
      const t = /** @type {HTMLElement|null} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      setBArmed(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Escape clears `bArmed` — only mount the listener while bArmed
  // is true (no need to listen otherwise).
  useEffect(() => {
    if (!bArmed) return;
    /** @param {KeyboardEvent} e */
    const onKeyDownEsc = (e) => {
      if (e.key === 'Escape') setBArmed(false);
    };
    window.addEventListener('keydown', onKeyDownEsc);
    return () => window.removeEventListener('keydown', onKeyDownEsc);
  }, [bArmed]);

  if (!action) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground italic">
          Create or select an action in the Actions panel.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col">
          <Ruler
            duration={duration}
            currentTime={currentTime}
            onSeek={(ms) => setCurrentTime(ms)}
          />
          <div
            ref={trackAreaRef}
            className={
              'relative '
              + (bArmed ? 'cursor-crosshair' : '')
            }
            onPointerDown={handleTrackPointerDown}
            onPointerMove={handleTrackPointerMove}
            onPointerUp={handleTrackPointerUp}
            onPointerCancel={handleTrackPointerUp}
          >
            {rows.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground italic">
                Action has no fcurves yet — drop into the Timeline + use auto-keyframe.
              </div>
            ) : (
              rows.map((row, idx) => (
                <Row
                  key={row.key}
                  rowIdx={idx}
                  row={row}
                  duration={duration}
                  currentTime={currentTime}
                  isActiveChannel={row.fcurveId !== '' && row.fcurveId === activeFCurveId}
                  isActiveKeyformSelected={isKeyformCenterSelected(
                    keyformSelectionHandles,
                    row.fcurveId,
                    row.activeKfIdx,
                  )}
                  selectionHandles={keyformSelectionHandles}
                  onTickClick={handleTickClick}
                  onSeek={setCurrentTime}
                />
              ))
            )}
            {/* Slice 6.B marquee overlay — rendered only during drag,
                pointer-events-none so it doesn't interfere with the
                track area's drag handlers. Color mirrors the FCurveEditor
                box-select rect (blue tint when 'replace'/'extend', red
                for 'subtract'). */}
            {boxDrag && (
              Math.abs(boxDrag.curX - boxDrag.startX) >= DRAG_THRESHOLD_PX
              || Math.abs(boxDrag.curY - boxDrag.startY) >= DRAG_THRESHOLD_PX
            ) && (
              <div
                className={
                  'absolute pointer-events-none border '
                  + (boxDrag.mode === 'subtract'
                    ? 'border-red-400/80 bg-red-400/10'
                    : 'border-sky-400/80 bg-sky-400/10')
                }
                style={{
                  left: Math.min(boxDrag.startX, boxDrag.curX),
                  top: Math.min(boxDrag.startY, boxDrag.curY),
                  width: Math.abs(boxDrag.curX - boxDrag.startX),
                  height: Math.abs(boxDrag.curY - boxDrag.startY),
                }}
                aria-hidden
              />
            )}
            {bArmed && !boxDrag && (
              <div
                className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-sky-700/80 text-white rounded pointer-events-none"
                aria-hidden
              >
                B: drag to box-select
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Ruler({ duration, currentTime, onSeek }) {
  const ticks = useMemo(() => buildRulerTicks(duration), [duration]);
  return (
    <div
      className="sticky top-0 z-10 bg-card border-b flex"
      style={{ height: RULER_H }}
    >
      <div className="shrink-0 border-r" style={{ width: LABEL_W }} />
      <div
        className="relative flex-1 cursor-crosshair"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const ms = (x / rect.width) * duration;
          onSeek(Math.max(0, Math.min(duration, ms)));
        }}
      >
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute top-0 bottom-0 w-px bg-border/50"
            style={{ left: `${(t / duration) * 100}%` }}
          />
        ))}
        {ticks.map((t) => (
          <span
            key={`l-${t}`}
            className="absolute top-0 text-[9px] text-muted-foreground/70 -translate-x-1/2 px-0.5"
            style={{ left: `${(t / duration) * 100}%` }}
          >
            {(t / 1000).toFixed(1)}
          </span>
        ))}
        <span
          className="absolute top-0 bottom-0 w-px bg-primary"
          style={{ left: `${(currentTime / duration) * 100}%` }}
        />
      </div>
    </div>
  );
}

function Row({ rowIdx, row, duration, currentTime, isActiveChannel, isActiveKeyformSelected, selectionHandles, onTickClick, onSeek }) {
  const { isMuted, activeKfIdx } = row;
  // Audit-fix M2 (Slice 5.W arch audit 2026-05-17): z-order extracted
  // to `getKeyformRenderOrder` in dopesheetRows.js for unit-testability.
  const orderedIndices = useMemo(
    () => getKeyformRenderOrder(row.keyforms.length, activeKfIdx),
    [row.keyforms, activeKfIdx],
  );

  // Halo gates (3 conditions, all required to draw):
  //   1. per-channel: this row's fcurve is the currently active one
  //      (SS-equivalent of FCURVE_ACTIVE gate at `graph_draw.cc:244`).
  //      Slice 5.W audit-fix HIGH-2 + Slice 5.X persisted `fc.active`.
  //   2. active-keyform index is in range (Slice 5.W).
  //   3. **NEW Slice 5.EE — active keyform's center bit is SELECTED**
  //      (SS-equivalent of `bezt->f2 & SELECT` at `graph_draw.cc:254`).
  //      The `isActiveKeyformSelected` prop is computed by the parent
  //      reading from the cross-editor `useKeyformSelectionStore`
  //      (FCurveEditor publishes; DopesheetEditor consumes). Closes
  //      Slice 5.W-2 deviation that was deferred because SS keyform
  //      selection lived only in FCurveEditor's local React state.
  //
  // **Deviation 5.EE-2** (audit-fix MED-1 fidelity 2026-05-18):
  // Blender's `draw_fcurve_active_vertex` has a 4th gate at
  // `graph_draw.cc:251` — view-range cull
  // (`IN_RANGE(bezt->vec[1][0], v2d->cur.xmin - 0.05*width,
  // v2d->cur.xmax + 0.05*width)`). SS omits it because the dopesheet
  // row track is row-based DOM (`overflow:hidden` + `left:%`
  // positioning auto-culls off-screen keyforms via CSS), not a
  // pixel-renderer that needs explicit view-frustum guards. The
  // off-track diamond would be invisible regardless of halo state,
  // so the gate is functionally redundant in SS's render model.
  const showActiveHalo = (
    isActiveChannel
    && activeKfIdx >= 0
    && activeKfIdx < row.keyforms.length
    && isActiveKeyformSelected
  );

  return (
    <div
      className="flex items-center border-b border-border/40 hover:bg-muted/20"
      style={{ height: ROW_H }}
      data-row-idx={rowIdx}
    >
      <div
        className={
          'shrink-0 px-2 truncate text-[10px] border-r flex items-center gap-1.5 '
          + (isMuted ? 'italic opacity-60' : '')
        }
        style={{ width: LABEL_W }}
        title={row.tooltip}
      >
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${row.kindColor}`}
          style={{ opacity: isMuted ? 0.4 : 1 }}
          aria-hidden
        />
        <span className="truncate">{row.label}</span>
        <span className="text-muted-foreground tabular-nums ml-auto">{row.keyforms.length}</span>
      </div>
      <div
        className="relative flex-1 h-full"
        style={{ opacity: isMuted ? 0.4 : 1 }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          onSeek((x / rect.width) * duration);
        }}
      >
        {orderedIndices.map((i) => {
          const kf = row.keyforms[i];
          const left = (kf.time / duration) * 100;
          const isHot = Math.abs(kf.time - currentTime) < 1;
          const isActiveHalo = showActiveHalo && i === activeKfIdx;
          // Slice 6.A — per-tick selection state. Empty-fcurveId rows
          // (group headers / row-without-fcurve) never participate in
          // selection; the predicate short-circuits on empty fcurveId.
          const isSelected = row.fcurveId !== ''
            && isTickSelected(selectionHandles, row.fcurveId, i);
          return (
            <span
              key={i}
              data-tick="1"
              className={
                'absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 cursor-pointer '
                + (isActiveHalo
                  ? 'ring-2 ring-yellow-300/90 bg-amber-300'
                  : isSelected
                    ? 'ring-2 ring-orange-400 bg-amber-400'
                    : (isHot ? 'bg-primary ring-1 ring-primary/40' : 'bg-amber-500/80 ring-1 ring-card hover:bg-amber-400'))
              }
              style={{ left: `calc(${left}% - 4px)` }}
              title={`${kf.time.toFixed(0)}ms · ${formatValue(kf.value)}${isActiveHalo ? ' · active' : isSelected ? ' · selected' : ''}`}
              onClick={(e) => {
                // Slice 6.A — primary click is now SELECT (plain /
                // shift+extend / ctrl+deselect); double-click ALSO
                // seeks via onDoubleClick below (preserves the prior
                // seek workflow). Rows without an fcurveId (synthetic
                // / header rows) keep the legacy seek-on-click behavior
                // since they have no selection identity to manipulate.
                //
                // Audit-fix Slice 6.A HIGH-A2 documentation: a true
                // double-click fires TWO `onClick` events (detail=1
                // then detail=2). The detail=1 event runs the select
                // handler; the detail=2 event would run select AGAIN
                // (re-replacing with the same single-entry selection,
                // which is the identity-stable no-op path in
                // applyTickSelectReplace, so no extra subscriber
                // re-renders). The onDoubleClick handler then seeks.
                // Net UX: double-click selects-then-seeks; the select
                // step is intentional + lossless (clicking a tick
                // and seeking to its time both make sense).
                if (row.fcurveId === '') {
                  e.stopPropagation();
                  onSeek(kf.time);
                  return;
                }
                onTickClick(e, row.fcurveId, i);
              }}
              onDoubleClick={(e) => {
                // Detail=2 click triggers this AFTER the second
                // onClick; seek to tick time. The select is already
                // done by the prior onClick events; stopPropagation
                // prevents the parent row's seek-on-empty-click.
                e.stopPropagation();
                onSeek(kf.time);
              }}
            />
          );
        })}
        <span
          className="absolute top-0 bottom-0 w-px bg-primary/60 pointer-events-none"
          style={{ left: `${(currentTime / duration) * 100}%` }}
          aria-hidden
        />
      </div>
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────

function buildRulerTicks(duration) {
  // Aim for 5–10 labelled ticks regardless of duration.
  const target = 8;
  const raw = duration / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = Math.max(pow, Math.round(raw / pow) * pow);
  const out = [];
  for (let t = 0; t <= duration + 0.5; t += step) out.push(t);
  return out;
}

function formatValue(v) {
  // Audit-fix L2: render null/undefined as the project's empty-value
  // glyph instead of the literal strings "null"/"undefined" that the
  // prior `String(v)` fallthrough produced.
  if (v == null) return '—';
  if (typeof v === 'number') return v.toFixed(2);
  if (Array.isArray(v)) return `[${v.map((n) => Number(n).toFixed(2)).join(', ')}]`;
  return String(v);
}
