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

import { useMemo, useRef, useCallback } from 'react';
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

  if (!action) {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground italic">
          Create or select an action in the Actions panel.
        </div>
      </div>
    );
  }

  const duration = Math.max(1, action.duration ?? 1000);

  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex-1 overflow-auto">
        <div className="flex flex-col">
          <Ruler
            duration={duration}
            currentTime={currentTime}
            onSeek={(ms) => setCurrentTime(ms)}
          />
          <div ref={trackAreaRef}>
            {rows.length === 0 ? (
              <div className="p-4 text-center text-xs text-muted-foreground italic">
                Action has no fcurves yet — drop into the Timeline + use auto-keyframe.
              </div>
            ) : (
              rows.map((row) => (
                <Row
                  key={row.key}
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

function Row({ row, duration, currentTime, isActiveChannel, isActiveKeyformSelected, selectionHandles, onTickClick, onSeek }) {
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
