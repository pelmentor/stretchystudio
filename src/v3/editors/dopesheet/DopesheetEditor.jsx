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
import {
  applyTimeTranslate,
  remapHandlesAfterTranslate,
  wouldTimeTranslateChange,
} from '../../../anim/dopesheetGrab.js';
import {
  applyDeleteKeyforms,
  applyDuplicateKeyforms,
  wouldDelDupChange,
} from '../../../anim/dopesheetDelDup.js';
import {
  copyKeyformsToClipboard,
  pasteKeyformsFromClipboard,
  handlesFromPasteResult,
  wouldCopyChange,
  wouldPasteChange,
} from '../../../anim/dopesheetClipboard.js';
import {
  pickMuteTarget,
  applyDopesheetChannelMute,
  wouldDopesheetChannelMuteChange,
} from '../../../anim/dopesheetChannelMute.js';
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
  const updateProject  = useProjectStore((s) => s.updateProject);
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
  // Refs for the grab-mode gates inside the existing handlers. Reading
  // a ref doesn't make the handlers re-create on every render.
  const grabActiveRef = useRef(false);
  // Audit-fix Slice 6.D HIGH-A1: mirror for boxDrag-active state so
  // keymap window-listener effects (G-key, Delete/Shift+D) can gate
  // suppression via a ref instead of depending on the React state in
  // the effect dep array. Pre-fix the keymap effects re-mounted on
  // every box-drag-frame (60-120 Hz) because [boxDrag] was in the dep
  // array. Established pattern from 6.B HIGH-A1 (handleTrackPointerMove
  // fix), retroactively applied to the G-key effect from 6.C and
  // pre-emptively to the Del/Shift+D effect from 6.D.
  const boxDragActiveRef = useRef(false);
  // Slice 6.F.1 — track the fcurveId of the currently hovered Row.
  // Set by Row's onPointerEnter (to row.fcurveId) and cleared by
  // onPointerLeave (to null). Ref-based: hover changes happen
  // pointer-frequency (sub-frame) and re-rendering the whole editor
  // tree per hover would be 60fps churn. The M-key keymap effect
  // reads this at keypress time via `hoveredFcurveIdRef.current`.
  // Empty-fcurveId rows (synthetic / header) collapse to no-hover
  // because `pickMuteTarget` treats empty string as no-hover (DEV 17).
  const hoveredFcurveIdRef = useRef(/** @type {string | null} */ (null));
  const handleTickClick = useCallback(
    /**
     * @param {MouseEvent | React.MouseEvent} e
     * @param {string} fcurveId
     * @param {number} kfIdx
     */
    (e, fcurveId, kfIdx) => {
      // Slice 6.C — during a modal grab, the click is the COMMIT gesture
      // (handled by the window-level mousedown listener). Suppress the
      // select-handler so the click doesn't accidentally re-select while
      // committing the translate.
      if (grabActiveRef.current) {
        e.stopPropagation();
        return;
      }
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
      // Slice 6.C — during a modal grab, the window-level mousedown
      // listener (capture phase) handles commit/cancel; this handler
      // should not start a box-select. Suppress here to keep the
      // grab-handlers as the sole authority during the gesture.
      if (grabActiveRef.current) return;
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
      // Slice 6.C — track last pointer X for the G-key grab anchor.
      // Updated on EVERY move (not just during box-drag) so a G press
      // anywhere over the track area starts the modal from the cursor.
      lastPointerXRef.current = curX;
      setBoxDrag((/** @type {BoxDragState|null} */ prev) =>
        prev ? { ...prev, curX, curY } : prev);
    },
    [],
  );

  // Refs mirrored from frequently-updating values so handleTrackPointerUp
  // can stay identity-stable. Pre-fix (audit-fix Slice 6.C MED-A1) the
  // callback re-created on every parent render due to `rows`/`duration`
  // changes; not as hot as pointerMove (which fires 60-120 Hz during
  // drag and was fixed in 6.B HIGH-A1) but consistent with that pattern.
  const rowsRef = useRef(rows);
  const durationRef = useRef(duration);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // Pointerup — commit the box-select (if drag exceeded threshold) or
  // discard (if it was a click). Commit reads the rect's X-range and
  // the Y-intersected rows, builds hits, calls applyBoxSelect, writes
  // to the store. Identity-stable: reads boxDrag via the functional
  // setter trick + rows/duration via refs; setKeyformSelectionHandles
  // is a stable Zustand-action wrapper from useKeyformSelectionState().
  const handleTrackPointerUp = useCallback(
    /** @param {React.PointerEvent<HTMLDivElement>} e */
    (e) => {
      // Snapshot + clear boxDrag atomically via the functional setter
      // (reads latest state without depending on the closure).
      /** @type {BoxDragState|null} */
      let drag = null;
      setBoxDrag((/** @type {BoxDragState|null} */ prev) => {
        drag = prev;
        return null;
      });
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
      const curRows = rowsRef.current;
      const curDuration = durationRef.current;
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
        const row = curRows[idx];
        if (!row || !row.fcurveId) continue;
        hitRows.push({ fcurveId: row.fcurveId, keyforms: row.keyforms });
      }
      // Convert track-area-local X to time. Track area's full width =
      // `duration` ms. The Row's tick area starts after the LABEL_W
      // column, so subtract LABEL_W first.
      const tickAreaWidth = Math.max(1, trackRect.width - LABEL_W);
      const xToTime = (/** @type {number} */ x) =>
        ((x - LABEL_W) / tickAreaWidth) * curDuration;
      const tMin = xToTime(Math.min(drag.startX, drag.curX));
      const tMax = xToTime(Math.max(drag.startX, drag.curX));
      const hits = computeBoxHits(hitRows, tMin, tMax);
      setKeyformSelectionHandles((prev) =>
        applyBoxSelect(prev, hits, drag.mode));
    },
    [setKeyformSelectionHandles],
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

  // ── Slice 6.C: modal grab (G key) ──────────────────────────────────────
  // Ports Blender's dopesheet G binding to TFM_TIME_TRANSLATE mode for
  // the SpaceAction. Reference path:
  //
  //   - Keymap: `keymap_data/blender_default.py:2718-2719` binds G in
  //     the dopesheet to `transform.transform` with
  //     `properties=[("mode", "TIME_TRANSLATE")]` — the dopesheet uses
  //     the generic `transform.transform` op with a mode property, NOT
  //     `transform.translate` (which is the 3D-viewport / graph-editor
  //     binding at `:384` / `:1143` / `:2069`). Audit-fix Slice 6.C
  //     HIGH-F1 cite correction: pre-fix this docstring cited
  //     `:2716-2717` (anim.channels_editable_toggle + channels_select_filter)
  //     + claimed `transform.translate` — both wrong; the real dispatch
  //     into TFM_TIME_TRANSLATE is via `transform.transform mode='TIME_TRANSLATE'`
  //     at `:2718-2719`.
  //   - Operator dispatch: `transform_convert_action.cc:1404-1409` wires
  //     `createTransActionData` / `recalcData_actedit` /
  //     `special_aftertrans_update__actedit` — the spacetype-dispatch
  //     to SpaceAction inside `transform.transform`'s mode-router.
  //   - Per-frame flush: `transform_convert.cc:1267-1285`
  //     (`transform_convert_flush_handle2D`) shifts handle X by the same
  //     delta as the center for the bezier-preservation property.
  //   - Post-commit: `transform_convert_action.cc:1203-1295` runs
  //     `posttrans_action_clean` → `BKE_fcurve_merge_duplicate_keys` for
  //     the selected-keys-AVERAGE + unselected-duplicates-DELETE step
  //     (fcurve.cc:1801-1916). Audit-fix Slice 6.C HIGH-F2 docstring
  //     correction: pre-fix this read "selected-wins-on-collision"
  //     which was incomplete — Blender averages selected values, not
  //     "wins" them.
  //
  // SS modal state shape:
  //
  //   `grabState: { startClientX, deltaMs } | null`
  //
  // - G keypress: capture current pointer clientX from `lastPointerXRef`,
  //   enter grab with deltaMs=0.
  // - Window mousemove (during grab): compute deltaMs from
  //   (curClientX - startClientX) * (duration / tickAreaWidth), store
  //   on grabState.
  // - LMB or Enter: commit — call updateProject(recipe) with
  //   applyTimeTranslate; then remapHandlesAfterTranslate to update the
  //   selection store; exit grab.
  // - RMB or Escape: cancel — exit grab without mutation. Action is
  //   untouched (we never mutated during preview), so cancel is free.
  //
  // Preview rendering: ghost translucent diamonds at
  //   `(kf.time + deltaMs) / duration`
  // for every selected center-keyform. Original ticks stay rendered at
  // their original positions; the ghost shows the target.
  /** @typedef {{ startClientX: number, deltaMs: number }} GrabState */
  /** @type {[GrabState|null, Function]} */
  const [grabState, setGrabState] = useState(null);
  // Mirror grabState into a ref so the listeners-mount effect's commit
  // handler can read latest deltaMs without re-mounting on every move
  // (listeners re-mount only on grabState null↔object identity flips).
  const grabStateRef = useRef(grabState);
  useEffect(() => {
    grabStateRef.current = grabState;
    grabActiveRef.current = grabState !== null;
  }, [grabState]);
  // Audit-fix Slice 6.D HIGH-A1: keep boxDragActiveRef in sync so
  // window-listener effects can read suppression state via ref.
  useEffect(() => {
    boxDragActiveRef.current = boxDrag !== null;
  }, [boxDrag]);
  // Last-pointer X tracker (track-area-local px). Updated on every
  // onPointerMove over the track area; used as the start anchor when
  // G is pressed.
  const lastPointerXRef = useRef(/** @type {number|null} */ (null));
  // Track-area client-rect width tracker so the window-level mousemove
  // listener can convert pixels → ms without re-querying the DOM on
  // every frame. Updated at grab-entry time.
  const tickAreaScaleRef = useRef({ tickAreaWidth: 1, duration: 1 });

  // Pre-compute set of selected fcurveIds for the ghost overlay — every
  // Row needs to know whether any of its keyforms are part of the
  // grab so it can render the ghosts. Cheap O(K) walk over the
  // selection.
  const selectedCenterByFcurve = useMemo(() => {
    /** @type {Map<string, Set<number>>} */
    const out = new Map();
    if (!keyformSelectionHandles) return out;
    for (const [fcId, sub] of keyformSelectionHandles.entries()) {
      const idxSet = new Set();
      for (const [kfIdx, parts] of sub.entries()) {
        if (parts && parts.center === true) idxSet.add(kfIdx);
      }
      if (idxSet.size > 0) out.set(fcId, idxSet);
    }
    return out;
  }, [keyformSelectionHandles]);

  // Slice 6.D — extracted grab-modal entry helper. Called by both G
  // keypress (Slice 6.C) AND Shift+D (post-duplicate auto-modal,
  // matching Blender's `ACTION_OT_duplicate_move` macro at
  // `reference/blender/source/blender/editors/space_action/action_ops.cc:80-89`).
  // Reads the latest pointer position from `lastPointerXRef` and the
  // latest duration from `durationRef` so the helper is dep-free
  // (useCallback with empty deps stays identity-stable across renders).
  const enterGrabModal = useCallback(() => {
    const trackArea = trackAreaRef.current;
    if (!trackArea) return;
    const rect = trackArea.getBoundingClientRect();
    const startClientX = (
      typeof lastPointerXRef.current === 'number'
        ? rect.left + lastPointerXRef.current
        : rect.left + rect.width / 2
    );
    const tickAreaWidth = Math.max(1, rect.width - LABEL_W);
    tickAreaScaleRef.current = {
      tickAreaWidth,
      duration: durationRef.current,
    };
    setGrabState({ startClientX, deltaMs: 0 });
  }, []);

  // G keypress — enter grab mode. Requires at least one center-selected
  // keyform AND a known pointer position over the track area.
  // Mirrors Blender's `count_fcurve_keys` predicate at
  // `transform_convert_action.cc:271-303` (called from `:702` inside
  // `createTransActionData` `:646-985`) — `createTransActionData`
  // early-returns when count == 0, never entering modal.
  //
  // Audit-fix Slice 6.D HIGH-A1: gate via grabActiveRef + boxDragActiveRef
  // (refs, identity-stable) instead of grabState/boxDrag in the dep
  // array. Pre-fix the effect re-mounted on every grab-frame +
  // box-drag-frame (60-120 Hz) because [grabState, boxDrag] in deps
  // forced the keydown listener to detach + re-attach each render.
  // The count check moves to a getState() read so we drop the
  // selectedCenterByFcurve dep too — effect now stays mounted once
  // and reads latest selection at fire time.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (e.key !== 'g' && e.key !== 'G') return;
      const t = /** @type {HTMLElement|null} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (grabActiveRef.current || boxDragActiveRef.current) return;
      // No selection → no grab. Match Blender's pre-modal count check.
      // Read latest selection from the store (avoids stale-memo capture).
      if (!wouldDelDupChange(useKeyformSelectionStore.getState().handles)) return;
      e.preventDefault();
      enterGrabModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enterGrabModal]);

  // ── Slice 6.D — Delete (Delete key) + Duplicate (Shift+D) ──────────────
  // Ports Blender's `ACTION_OT_delete` + `ACTION_OT_duplicate_move`
  // operators dispatched from the SpaceAction keymap:
  //
  //   - `keymap_data/blender_default.py:2703-2704`:
  //     `("action.delete",         {"type": 'DEL', "value": 'PRESS'}, ...)`
  //     `("action.duplicate_move", {"type": 'D',   "value": 'PRESS', "shift": True}, None)`
  //
  // Delete: `action_edit.cc:1210-1225` → `delete_action_keys` `:1118-1170`
  //         → `BKE_fcurve_delete_keys_selected` at `fcurve.cc:1757-1784`.
  // Duplicate-move: `action_ops.cc:80-89` MACRO of `ACTION_OT_duplicate`
  //         (`action_edit.cc:1097-1110` → `duplicate_action_keys`
  //         `:1034-1073` → `duplicate_fcurve_keys` at
  //         `keyframes_general.cc:62-95`) THEN `TRANSFORM_OT_transform
  //         mode=TFM_TIME_TRANSLATE use_duplicated_keyframes=true` —
  //         which SS implements as `applyDuplicateKeyforms` +
  //         `remapHandlesAfterTranslate` + `enterGrabModal()` (the
  //         6.C grab modal pre-targeted at the just-created duplicates).
  //
  // **Confirm dialog deferred** (SS DEVIATION 8): Blender's
  // `actkeys_delete_invoke` at `action_edit.cc:1194-1208` pops up a
  // confirmation dialog when `confirm=True`; the dopesheet keymap
  // binding passes `confirm=False` so the dialog is suppressed there.
  // SS mirrors the suppressed-confirm dopesheet behavior — Delete
  // fires immediately, no dialog. Honest per Rule №2 (parity with the
  // bound keymap, not the operator default).
  //
  // **Backspace alias** (SS DEVIATION 9 — audit-fix Slice 6.D MED-A2):
  // Blender's keymap binds Delete (`DEL`) only. SS extends to also
  // accept Backspace because Mac laptops have no physical Delete key
  // (the key labelled "delete" on Mac keyboards is Backspace). The
  // input-skip guard above prevents Backspace from triggering inside
  // text fields. Honest extension per Rule №2.
  //
  // Audit-fix Slice 6.D HIGH-A1: gate via grabActiveRef +
  // boxDragActiveRef instead of grabState/boxDrag in dep array; effect
  // now stays mounted once.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      // Skip if user is typing in an input
      const t = /** @type {HTMLElement|null} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Suppress during grab or box-drag via refs (let the existing
      // modal own the gesture surface). Audit-fix HIGH-A1.
      if (grabActiveRef.current || boxDragActiveRef.current) return;
      const isDelete = (e.key === 'Delete' || e.key === 'Backspace');
      const isShiftD = (e.shiftKey && (e.key === 'd' || e.key === 'D'));
      if (!isDelete && !isShiftD) return;
      // Both ops require at least one center-selected keyform (matches
      // Blender's pre-op `delete_action_keys`/`duplicate_action_keys`
      // returning `false` → `OPERATOR_CANCELLED` when nothing's
      // selected).
      const curHandles = useKeyformSelectionStore.getState().handles;
      if (!wouldDelDupChange(curHandles)) return;
      e.preventDefault();
      if (isDelete) {
        /** @type {import('../../../anim/dopesheetDelDup.js').DelDupRemaps | null} */
        let capturedRemaps = null;
        let capturedChanged = false;
        updateProject((project) => {
          const targetAction = project.actions.find((a) => a.id === activeActionId);
          if (!targetAction) return;
          const r = applyDeleteKeyforms(targetAction, curHandles);
          capturedRemaps = r.remaps;
          capturedChanged = r.changed;
        });
        if (capturedChanged && capturedRemaps) {
          // Audit-fix Slice 6.D HIGH-A2: pass `curHandles` (the
          // snapshot used to drive the op) to `remapHandlesAfterTranslate`
          // rather than re-reading via `getState().handles`. The two
          // can't diverge today since `updateProject` is synchronous
          // and only mutates `project`, but the symmetry guards against
          // latent inconsistency if any sync store-reaction is ever
          // added.
          useKeyformSelectionStore.getState().setHandles(
            remapHandlesAfterTranslate(curHandles, capturedRemaps),
          );
        }
      } else {
        // Shift+D: duplicate + auto-enter grab modal (the
        // ACTION_OT_duplicate_move macro). Order matters: duplicate
        // BEFORE entering grab so the grab targets the duplicates.
        /** @type {import('../../../anim/dopesheetDelDup.js').DelDupRemaps | null} */
        let capturedRemaps = null;
        let capturedChanged = false;
        updateProject((project) => {
          const targetAction = project.actions.find((a) => a.id === activeActionId);
          if (!targetAction) return;
          const r = applyDuplicateKeyforms(targetAction, curHandles);
          capturedRemaps = r.remaps;
          capturedChanged = r.changed;
        });
        if (capturedChanged && capturedRemaps) {
          // Audit-fix HIGH-A2: same curHandles consistency as above.
          useKeyformSelectionStore.getState().setHandles(
            remapHandlesAfterTranslate(curHandles, capturedRemaps),
          );
          // Auto-enter grab modal with the new selection (now pointing
          // at the duplicates). Matches Blender's macro chain.
          enterGrabModal();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [updateProject, activeActionId, enterGrabModal]);

  // ── Slice 6.E — Copy (Ctrl+C) + Paste (Ctrl+V) ─────────────────────────
  // Ports Blender's `ACTION_OT_copy` + `ACTION_OT_paste` operators
  // dispatched from the SpaceAction keymap:
  //
  //   - `keymap_data/blender_default.py:2706-2707`:
  //     `("action.copy",  {"type": 'C', "value": 'PRESS', "ctrl": True}, None)`
  //     `("action.paste", {"type": 'V', "value": 'PRESS', "ctrl": True}, None)`
  //
  // Copy: `action_edit.cc:647-660` (`ACTION_OT_copy`) → `actkeys_copy_exec`
  //       `:606-645` → `copy_action_keys` `:521-538` → `copy_animedit_keys`
  //       at `keyframes_general.cc:1488-1566`. Populates the module-level
  //       singleton at `:1258`.
  // Paste: `action_edit.cc:746-779` (`ACTION_OT_paste`) → `actkeys_paste_exec`
  //       `:662-731` → `paste_action_keys` `:540-596` → `paste_animedit_keys`
  //       at `keyframes_general.cc:2118-...`. Defaults: CFRA_START offset
  //       (cfra - first_frame), MIX merge (same-time replace via
  //       INSERTKEY_OVERWRITE_FULL at `:2001`).
  //
  // **SS DEVIATION 14** (Shift+Ctrl+V flipped variant): not bound. SS
  // dopesheet has no bones in its keyform model — flip-mirror semantics
  // don't apply. See `dopesheetClipboard.js` module header for full rationale.
  //
  // Gate pattern (matches 6.C / 6.D):
  //   - Skip if pointer is inside an input/textarea/contentEditable (the
  //     browser's native text-copy/paste must win in those contexts).
  //   - Skip if a grab modal or box-drag is in flight (refs are
  //     identity-stable per Slice 6.D HIGH-A1).
  //   - Skip + LET BROWSER THROUGH if there's nothing to copy (Ctrl+C
  //     with empty selection) or nothing to paste (Ctrl+V with empty
  //     clipboard or no destination match) — DON'T preventDefault, so
  //     the user's "copy this log line" Ctrl+C still works in adjacent
  //     panels even with the dopesheet open.
  //
  // Action resolution: read from `useProjectStore.getState().project` at
  // keypress time rather than capturing the memo'd `action` from render
  // closure. The memo `action` recomputes on every project mutation, so
  // putting it in the dep array would re-mount the effect on every change
  // (same anti-pattern that audit-fix 6.C/6.D HIGH-A1 addressed for
  // grabState/boxDrag). Reading from store at fire time gives us the
  // freshest action without dep churn.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
      const isCopy  = (e.key === 'c' || e.key === 'C');
      const isPaste = (e.key === 'v' || e.key === 'V');
      if (!isCopy && !isPaste) return;
      // Skip if user is typing in an input — let browser handle text copy/paste.
      const t = /** @type {HTMLElement|null} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      // Suppress during grab or box-drag (same gate as 6.D).
      if (grabActiveRef.current || boxDragActiveRef.current) return;
      // Resolve target action at fire time. Effect stays mounted across
      // project mutations; reading from store avoids stale closure.
      const proj = useProjectStore.getState().project;
      const targetAction = proj.actions.find((a) => a.id === activeActionId);
      if (!targetAction) return;
      if (isCopy) {
        const curHandles = useKeyformSelectionStore.getState().handles;
        // Nothing center-selected → leave Ctrl+C alone (browser default
        // takes over). Matches Blender's `copy_action_keys` returning
        // `false` → `OPERATOR_CANCELLED` at `action_edit.cc:638-641`,
        // except there's no "no keyframes copied" toast in SS yet.
        if (!wouldCopyChange(curHandles)) return;
        // Audit-fix Slice 6.E MED-A3: if the user has a NON-COLLAPSED
        // text selection (e.g. triple-clicked a row label rendered as
        // plain DOM text — NOT an input/textarea/contenteditable, which
        // are already filtered above), Ctrl+C should copy the TEXT, not
        // the keyforms. The user's intent at that moment is "copy this
        // text" — the keyform selection is an unrelated pre-existing
        // state. Bail out before preventDefault so the browser handles
        // it. The reverse case (intentional keyform copy with no text
        // selected) is the dominant SS UX path; this guard only fires
        // when text IS selected, so it doesn't degrade the normal flow.
        // Blender has no analog because it's a desktop app with no
        // OS-clipboard text-copy contention.
        const sel = typeof window !== 'undefined' ? window.getSelection() : null;
        if (sel && sel.type === 'Range') return;
        const curTime = useAnimationStore.getState().currentTime;
        e.preventDefault();
        copyKeyformsToClipboard(targetAction, curHandles, curTime);
      } else {
        // Clipboard empty or no matching destination → leave Ctrl+V alone.
        // Matches Blender's two-step early-return in `paste_animedit_keys`
        // at `keyframes_general.cc:2124-2129` (NOTHING_TO_PASTE +
        // NOWHERE_TO_PASTE).
        if (!wouldPasteChange(targetAction)) return;
        const curTime = useAnimationStore.getState().currentTime;
        e.preventDefault();
        /** @type {Map<string, number[]> | null} */
        let capturedSelections = null;
        let capturedChanged = false;
        updateProject((project) => {
          const ta = project.actions.find((a) => a.id === activeActionId);
          if (!ta) return;
          const r = pasteKeyformsFromClipboard(ta, curTime);
          capturedSelections = r.newSelections;
          capturedChanged = r.changed;
        });
        if (capturedChanged && capturedSelections) {
          // Replace selection with the pasted entries (all parts on).
          // Matches Blender's `BEZT_DESEL_ALL` on destination at
          // `paste_animedit_keys_fcurve:1935-1937` + `BEZT_SEL_ALL` on
          // inserts at `:1998` — net effect is the new selection IS the
          // paste result. SS DEV 15 (global selection replace vs Blender's
          // per-fcurve deselect) — documented in dopesheetClipboard.js.
          useKeyformSelectionStore.getState().setHandles(
            handlesFromPasteResult(capturedSelections),
          );
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [updateProject, activeActionId]);

  // ── Slice 6.F.1 — Mute hovered/selected channel (M key) ───────────────
  // Ports Blender's `ANIM_OT_channels_setting_toggle` operator at
  // `anim_channels_edit.cc:3090-3140`, parameterised for
  // `ACHANNEL_SETTING_MUTE` (`ED_anim_api.hh:669`). Existing bulk-mute
  // kernel `applyChannelMuteSelected` (Slice 5.O, in `fcurveMute.js`)
  // already byte-faithfully ports `setflag_anim_channels` at
  // `anim_channels_edit.cc:2923-3001`. 6.F.1 wires it to the dopesheet
  // M-key via a hover-or-selection target dispatcher.
  //
  // **SS DEVIATIONs** (numbered cumulative, full text in `dopesheetChannelMute.js`):
  //   - DEV 16: Hotkey choice **M** (vs Blender's `Shift+W`). DAW
  //     convention (Pro Tools / Logic / Ableton). Plan §6.B operator
  //     table specifies M.
  //   - DEV 17: Hover-priority target (hovered wins over selection;
  //     selection is the fallback when no hover). Approximates Blender's
  //     region-scoped Shift+W keymap UX via explicit hover-tracking
  //     since SS uses window-level keymap binding.
  //   - DEV 18: Solo (Ctrl+Alt+M) DEFERRED to Slice 6.F.2. Blender's
  //     `ACHANNEL_SETTING_SOLO = 5` is NLA-tracks-only per
  //     `ED_anim_api.hh:674` ("only for NLA Tracks"); per-FCurve solo
  //     would be an SS-only DAW-convention extension requiring a new
  //     FCURVE_SOLO bit + eval-cascade rewrite (~3hr separate slice).
  //
  // Gate pattern (same as 6.C/6.D/6.E):
  //   - Skip input/textarea/contentEditable.
  //   - Suppress during grab/box-drag (refs).
  //   - Skip + LET BROWSER THROUGH if no target resolves (browser's M
  //     does nothing useful, but staying out of the keydown chain
  //     keeps the gate honest).
  //
  // Action resolution: store-read at fire time, same anti-stale-closure
  // pattern as 6.D/6.E.
  useEffect(() => {
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (e.key !== 'm' && e.key !== 'M') return;
      // Allow ONLY plain M — no Ctrl/Shift/Alt/Meta. Solo (Ctrl+Alt+M)
      // is queued as Slice 6.F.2; today the modifier-combos fall
      // through (browser default does nothing for M-with-modifiers
      // outside text fields).
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const t = /** @type {HTMLElement|null} */ (e.target);
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (grabActiveRef.current || boxDragActiveRef.current) return;
      // Resolve target action at fire time.
      const proj = useProjectStore.getState().project;
      const targetAction = proj.actions.find((a) => a.id === activeActionId);
      if (!targetAction) return;
      // Pick the target: hovered (priority) or selection (fallback).
      const target = pickMuteTarget(targetAction, hoveredFcurveIdRef.current);
      if (!wouldDopesheetChannelMuteChange(targetAction, target)) return;
      e.preventDefault();
      updateProject((project) => {
        const ta = project.actions.find((a) => a.id === activeActionId);
        if (!ta) return;
        applyDopesheetChannelMute(ta, target);
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [updateProject, activeActionId]);

  // Slice 6.F.1 — stable hover callbacks for Row to set/clear the
  // hoveredFcurveIdRef. useCallback empty-deps keeps identity stable
  // so Row props don't churn per render.
  const handleRowPointerEnter = useCallback(
    /** @param {string} fcurveId */
    (fcurveId) => {
      // Defensive: empty fcurveId (synthetic / header row) → clear.
      // pickMuteTarget would collapse it to no-hover anyway, but
      // clearing here keeps the ref semantically clean.
      hoveredFcurveIdRef.current = (typeof fcurveId === 'string' && fcurveId !== '') ? fcurveId : null;
    },
    [],
  );
  const handleRowPointerLeave = useCallback(() => {
    hoveredFcurveIdRef.current = null;
  }, []);

  // Grab-modal window listeners — mounted ONLY while grabState !== null.
  // Tracks pointer moves to update deltaMs; LMB/Enter commits;
  // RMB/Escape cancels.
  useEffect(() => {
    if (!grabState) return;
    const startClientX = grabState.startClientX;
    const { tickAreaWidth, duration: durSnap } = tickAreaScaleRef.current;
    const msPerPx = durSnap / tickAreaWidth;

    /** @param {MouseEvent} e */
    const onMouseMove = (e) => {
      const dx = e.clientX - startClientX;
      const nextDelta = dx * msPerPx;
      setGrabState((prev) => prev ? { ...prev, deltaMs: nextDelta } : prev);
    };
    const commit = () => {
      const cur = grabStateRef.current;
      if (!cur) return;
      const dMs = cur.deltaMs;
      // Audit-fix Slice 6.C HIGH-A2: eagerly clear the suppression
      // ref BEFORE setGrabState(null). setGrabState is React-async-
      // batched; the useEffect mirror that resets grabActiveRef runs
      // on the NEXT render, so any handler that fires synchronously
      // between setGrabState and the mirror flip would still see
      // grabActiveRef.current === true. Setting it false here closes
      // the window so the suppression contract holds across the
      // commit's synchronous tail.
      grabActiveRef.current = false;
      setGrabState(null);
      // Audit-fix Slice 6.D HIGH-A2: snapshot handles ONCE and reuse
      // for the no-op check + the applyTimeTranslate input + the
      // remapHandlesAfterTranslate input. Pre-fix re-read .getState()
      // three times; structurally inconsistent (latent bug if any sync
      // middleware reaction were ever added).
      const curHandles = useKeyformSelectionStore.getState().handles;
      if (!wouldTimeTranslateChange(curHandles, dMs)) {
        return;   // sub-1ms drag or no-op selection — discard
      }
      // Commit via immer recipe. Smuggle the remap out for the
      // separate selection-store update.
      /** @type {import('../../../anim/dopesheetGrab.js').TranslateRemaps | null} */
      let capturedRemaps = null;
      let capturedChanged = false;
      updateProject((project) => {
        const targetAction = project.actions.find((a) => a.id === activeActionId);
        if (!targetAction) return;
        const r = applyTimeTranslate(targetAction, curHandles, dMs);
        capturedRemaps = r.remaps;
        capturedChanged = r.changed;
      });
      if (capturedChanged && capturedRemaps) {
        useKeyformSelectionStore.getState().setHandles(
          remapHandlesAfterTranslate(curHandles, capturedRemaps),
        );
      }
    };
    const cancel = () => {
      // Same eager-flip rationale as commit() — close the suppression
      // window before scheduling the React re-render. Cancel has no
      // tail-mutation so the asymmetry isn't load-bearing, but keep
      // both paths symmetric to avoid surprise.
      grabActiveRef.current = false;
      setGrabState(null);
    };
    /** @param {MouseEvent} e */
    const onMouseDown = (e) => {
      // Suppress the click that would otherwise fire on Row tick / track.
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 0) commit();
      else if (e.button === 2) cancel();
    };
    /** @param {KeyboardEvent} e */
    const onKeyDown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      else if (e.key === 'Enter') { e.preventDefault(); commit(); }
      else if (e.key === 'g' || e.key === 'G') {
        // Re-pressing G during a grab is a no-op in Blender (the
        // modal already owns the gesture); ignore silently.
        e.preventDefault();
      }
    };
    /** @param {MouseEvent} e */
    const onContextMenu = (e) => {
      // RMB cancel: suppress the browser context menu.
      e.preventDefault();
    };
    // capture-phase mousedown so we beat Row/Track handlers.
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('contextmenu', onContextMenu);
    };
    // Audit-fix Slice 6.C HIGH-A1: removed `activeActionId` +
    // `updateProject` from the dep array. Pre-fix, if the user changed
    // the active action MID-GRAB (e.g. via a global hotkey in another
    // panel), this effect would tear down + re-register the listeners,
    // and the new commit closure would target the new actionId while
    // the user was still mid-translate against the OLD action — sending
    // the in-flight delta to an unrelated action. Now the closure
    // captures activeActionId at grab-entry time and stays stable
    // until commit/cancel exits the modal. `updateProject` is a Zustand
    // action (construction-time stable) so it's also safe to capture
    // from closure once.
    // The boolean `grabState !== null` evaluates to the same value
    // across renders while a grab is in flight, so React's dep-array
    // identity check correctly avoids re-mounts on every deltaMs tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grabState !== null]);

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
                  grabSelectedIdxSet={
                    grabState ? selectedCenterByFcurve.get(row.fcurveId) ?? null : null
                  }
                  grabDeltaMs={grabState ? Math.round(grabState.deltaMs) : 0}
                  onTickClick={handleTickClick}
                  onSeek={setCurrentTime}
                  onRowPointerEnter={handleRowPointerEnter}
                  onRowPointerLeave={handleRowPointerLeave}
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
            {/* Slice 6.C — grab status pill. Mirrors Blender's modal
                header showing "Dx: NNN" during TFM_TIME_TRANSLATE
                (transform_mode.cc header callback). Shows live deltaMs
                + the LMB/Enter/Esc affordance. */}
            {grabState && (
              <div
                className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] bg-amber-700/85 text-white rounded pointer-events-none tabular-nums"
                aria-hidden
              >
                Grab: {Math.round(grabState.deltaMs) >= 0 ? '+' : ''}{Math.round(grabState.deltaMs)}ms · LMB/Enter commit · RMB/Esc cancel
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

function Row({ rowIdx, row, duration, currentTime, isActiveChannel, isActiveKeyformSelected, selectionHandles, grabSelectedIdxSet, grabDeltaMs, onTickClick, onSeek, onRowPointerEnter, onRowPointerLeave }) {
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
      onPointerEnter={() => { if (onRowPointerEnter) onRowPointerEnter(row.fcurveId); }}
      onPointerLeave={() => { if (onRowPointerLeave) onRowPointerLeave(); }}
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
        {/* Slice 6.C — ghost overlay during modal grab. For every
            center-selected keyform in this row, render a translucent
            diamond at `kf.time + grabDeltaMs` showing the proposed
            commit position. Original ticks stay rendered above
            (z-order via DOM order). Pointer-events-none so clicks
            still hit the originals (window-level mousedown commits
            anyway). */}
        {grabSelectedIdxSet && grabDeltaMs !== 0 && Array.from(grabSelectedIdxSet).map((i) => {
          const kf = row.keyforms[i];
          if (!kf) return null;
          const ghostTime = kf.time + grabDeltaMs;
          const ghostLeft = (ghostTime / duration) * 100;
          return (
            <span
              key={`ghost-${i}`}
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rotate-45 pointer-events-none bg-amber-300/50 ring-1 ring-amber-400/70"
              style={{ left: `calc(${ghostLeft}% - 4px)` }}
              aria-hidden
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
