// @ts-check
/* eslint-disable react/prop-types, react-hooks/exhaustive-deps */

/**
 * Animation Phase 5 — F-Curve Graph Editor (write-mode, Slices 5.A + 5.B + 5.C).
 *
 * Two-layer composition (plan §5.A): SVG background (axes + curve path
 * + zero-line + playhead) + canvas-2D foreground (keyframe diamonds +
 * handle dots; receives all pointer events). Both layers share a single
 * `view` derived from container dims via ResizeObserver and the
 * FCurve's auto-fit value range; the canvas is DPR-aware.
 *
 * # Slice 5.B (shipped 2026-05-16, `bd1e68b` + `feb4bde`)
 *
 *   - LMB-click keyframe diamond → select (whole-keyform select sets
 *     `{center,left,right}` all true so the next click+drag moves the
 *     KNOT and the handles ride along per Blender's KNOT_ONLY semantic).
 *   - LMB-click handle dot → select that side only.
 *   - LMB-drag keyframe diamond → grab in (time, value).
 *   - LMB-drag handle dot → reshape via `applyHandleDrag` (HD_AUTO →
 *     HD_ALIGN both-sides + HD_VECT → HD_FREE dragged-only + aligned
 *     mirror; matches `BKE_nurb_bezt_handle_test` at
 *     `reference/blender/source/blender/blenkernel/intern/curve.cc:4054-4084`).
 *   - Click empty area → seek the playhead.
 *
 * # Slice 5.C (this commit) — operator pass
 *
 *   - **G** — modal grab over selected keyforms (per-part). Hold Ctrl to
 *     snap dTime to whole frames; Shift = 0.1× precision multiplier.
 *     LMB / Enter confirm; Esc / RMB cancel.
 *   - **S** — modal scale around the pivot (selection median time +
 *     median value). Same modifiers as G.
 *   - **B** — box-select via local rubber-band rect. Replace by default;
 *     Shift = add; Ctrl = subtract.
 *   - **V** — handle-type menu (Free / Aligned / Vector / Auto /
 *     Auto Clamped). Sets type on the dragged side of partial-selection
 *     entries; both sides for whole-keyform selections.
 *   - **T** — interpolation menu (Constant / Linear / Bezier + 10 named
 *     easings). Per-keyform write (Blender's segment-start convention).
 *   - **Shift+E** — extrapolation menu (Constant / Linear). Per-FCurve.
 *   - **Delete / X** — delete selected keyforms (handle-only entries
 *     left intact, matching Blender's GRAPH_OT_delete behaviour).
 *   - **Home** — re-fit view to FCurve range; also clears view-lock.
 *   - **Ctrl+G** — snap selected keyforms to nearest whole frame.
 *   - **Post-release** — `mergeDuplicateTimeKeys` collapses time ties
 *     produced by the drag/grab into one keyform per cluster (averaged
 *     value); `recalcKeyformHandles` re-positions auto/aligned handles.
 *     Mirrors `BKE_fcurve_merge_duplicate_keys` at
 *     `reference/blender/source/blender/blenkernel/intern/fcurve.cc:1801-1910`
 *     called from `transform_convert_graph.cc:1014`.
 *   - **Lock-view-during-drag** — the auto-fit value range freezes on
 *     drag-start and unfreezes on release/cancel (closes the 5.A wart
 *     where dragging a kf outside the range rescaled the y-axis mid-
 *     drag and made the diamond appear to drift).
 *
 * # Per-handle selection state (plan §5.B)
 *
 * Selection is keyed per-keyform with `{center, left, right}` booleans
 * mapping to Blender's `BEZT_SEL_F2 / F1 / F3` flags at
 * `reference/blender/source/blender/makesdna/DNA_curve_types.h:90-95`.
 * The selection store is local-React (`useState<Map<idx, parts>>`) —
 * graph-editor selection doesn't bleed into the global selectionStore
 * because the global store's identity is part / param / group, not
 * keyform index in an active FCurve.
 *
 * # SIPO_SELVHANDLESONLY
 *
 * Handles draw only for SELECTED keyforms — Blender's
 * `SIPO_SELVHANDLESONLY` mode at
 * `reference/blender/source/blender/editors/space_graph/graph_draw.cc:469-476`,
 * not the default mode that draws handles for every keyframe. SS ships
 * SIPO_SELVHANDLESONLY by default because a 1200-keyform curve with
 * every-keyframe handles is visual noise; a per-editor toggle for "all
 * handles" can land in Slice 5.C+.
 *
 * # Hotkey scoping
 *
 * The editor's wrap div is `tabIndex={0}` and auto-focuses on pointer
 * enter so hotkeys go to the editor under the cursor (Blender's
 * pattern). Modal G/S/B mount their own window-level capture listeners
 * so the user can drag past the editor's bounds without losing focus.
 *
 * @module v3/editors/fcurve/FCurveEditor
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { interpolateTrack } from '../../../renderer/animationEngine.js';
import {
  decodeFCurveTarget,
  fcurveTargetsParam,
} from '../../../anim/animationFCurve.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';
import {
  applyKeyformDrag,
  applyHandleDrag,
  applyGrab,
  applyScale,
  snapKeyformsToFrame,
  setHandleType,
  setInterpolation,
  setExtrapolation,
  deleteKeyforms,
  mergeDuplicateTimeKeys,
  snapshotKeyform,
  remapSelection,
} from '../../../anim/graphEditOps.js';
import { recalcKeyformHandles } from '../../../anim/fcurveHandles.js';

const CURVE_SAMPLES = 240;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;

// Hit-test radii (px, screen-space).
const HIT_KEYFRAME_R = 7;
const HIT_HANDLE_R = 6;

const HANDLE_TYPES = /** @type {const} */ ([
  { key: 'free',         label: 'Free' },
  { key: 'aligned',      label: 'Aligned' },
  { key: 'vector',       label: 'Vector' },
  { key: 'auto',         label: 'Auto' },
  { key: 'auto_clamped', label: 'Auto Clamped' },
]);

// Order matches Blender's `rna_enum_beztriple_interpolation_mode_items`
// at `reference/blender/source/blender/makesrna/intern/rna_curve.cc`.
const INTERPOLATION_TYPES = /** @type {const} */ ([
  { key: 'constant', label: 'Constant' },
  { key: 'linear',   label: 'Linear' },
  { key: 'bezier',   label: 'Bezier' },
  { key: 'sine',     label: 'Sinusoidal' },
  { key: 'quad',     label: 'Quadratic' },
  { key: 'cubic',    label: 'Cubic' },
  { key: 'quart',    label: 'Quartic' },
  { key: 'quint',    label: 'Quintic' },
  { key: 'expo',     label: 'Exponential' },
  { key: 'circ',     label: 'Circular' },
  { key: 'back',     label: 'Back' },
  { key: 'bounce',   label: 'Bounce' },
  { key: 'elastic',  label: 'Elastic' },
]);

const EXTRAPOLATION_TYPES = /** @type {const} */ ([
  { key: 'constant', label: 'Constant' },
  { key: 'linear',   label: 'Linear' },
]);

export function FCurveEditor() {
  const project = useProjectStore((s) => s.project);
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const currentTime = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);
  const fps = useAnimationStore((s) => s.fps);
  const selection = useSelectionStore((s) => s.items);

  const action = useMemo(
    () => getActiveSceneAction(project, activeActionId),
    [project.nodes, project.actions, activeActionId],
  );

  const picked = useMemo(() => pickFCurve(action, selection), [action, selection]);
  const duration = Math.max(1, action?.duration ?? 1000);
  const sampled = useMemo(
    () => (picked?.keyforms?.length ? sampleCurve(picked, duration) : null),
    [picked, duration],
  );

  if (!action) {
    return (
      <Wrapper>
        <Empty msg="Create or select an action in the Actions panel." />
      </Wrapper>
    );
  }
  if (!picked || !picked.keyforms || picked.keyforms.length === 0 || !sampled) {
    const sub = picked
      ? 'F-curve is empty — drop a keyframe in the Timeline first.'
      : 'Select a parameter or part with keyframes to plot.';
    return (
      <Wrapper>
        <Empty msg={sub} />
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Plot
        activeActionId={activeActionId}
        fcurve={picked}
        sampled={sampled}
        duration={duration}
        currentTime={currentTime}
        fps={fps}
        onSeek={setCurrentTime}
      />
    </Wrapper>
  );
}

function Wrapper({ children }) {
  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function Empty({ msg }) {
  return (
    <div className="h-full flex items-center justify-center px-6 text-center text-xs text-muted-foreground italic">
      {msg}
    </div>
  );
}

function Plot({ activeActionId, fcurve, sampled, duration, currentTime, fps, onSeek }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  /** @type {[Map<number, {center:boolean,left:boolean,right:boolean}>, Function]} */
  const [selectedHandles, setSelectedHandles] = useState(new Map());
  /** @type {[null | {minV:number, maxV:number}, Function]} */
  const [viewLock, setViewLock] = useState(null);
  /** @type {[null | {kind:'g'|'s'}, Function]} */
  const [modal, setModal] = useState(null);
  /** @type {[null | {x:number, y:number, curX:number, curY:number, modifier:'replace'|'add'|'subtract'}, Function]} */
  const [boxSelect, setBoxSelect] = useState(null);
  /** @type {[null | {kind:'handleType'|'interpolation'|'extrapolation', x:number, y:number}, Function]} */
  const [menu, setMenu] = useState(null);

  const update = useProjectStore((s) => s.updateProject);
  // Audit-fix HIGH-A1 (Slice 5.B): track any in-flight drag so unmounting
  // the editor mid-drag releases the window-level listeners + closes the
  // open undo batch. Without this, switching tabs mid-drag leaves a
  // dangling `endBatch()` un-called and `_batchDepth > 0` for the rest
  // of the session — every subsequent drag pushes a deeper nested batch
  // and the user's undo history silently stops growing.
  const dragCleanupRef = useRef(/** @type {(() => void) | null} */ (null));
  // Slice 5.C — modal G/S also opens an undo batch + window listeners
  // that need the same unmount-cleanup contract.
  const modalCleanupRef = useRef(/** @type {(() => void) | null} */ (null));
  // Track latest selectedHandles for handlers/effects that capture a ref;
  // React closes over the state at render time which is fine for the
  // first frame of a modal but stale by the next tick.
  const selectionRef = useRef(selectedHandles);
  useEffect(() => { selectionRef.current = selectedHandles; }, [selectedHandles]);

  // View min/max — uses the locked snapshot during a modal/drag so the
  // y-axis doesn't rescale as the user drags a kf outside its range
  // (Slice 5.A UX wart, closed by 5.C). Lock is set at drag/modal start
  // and cleared on release.
  const minV = viewLock?.minV ?? sampled.minV;
  const maxV = viewLock?.maxV ?? sampled.maxV;

  // Reset selection when the active FCurve changes — index-based
  // selection doesn't translate across FCurves.
  useEffect(() => {
    setSelectedHandles(new Map());
    setViewLock(null);
    setBoxSelect(null);
    setMenu(null);
  }, [fcurve.id]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const r = entry.contentRect;
        setContainerSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Audit-fix HIGH-A1: unmount cleanup for any in-flight drag/modal.
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
      if (modalCleanupRef.current) {
        modalCleanupRef.current();
        modalCleanupRef.current = null;
      }
    };
  }, []);

  const view = useMemo(() => {
    const w = Math.max(1, containerSize.w);
    const h = Math.max(1, containerSize.h);
    const plotW = Math.max(1, w - PAD_L - PAD_R);
    const plotH = Math.max(1, h - PAD_T - PAD_B);
    const span = (maxV - minV) || 1;
    return {
      w, h, plotW, plotH,
      tMin: 0, tMax: duration,
      vMin: minV, vMax: maxV, vSpan: span,
      tx: (t) => PAD_L + (t / duration) * plotW,
      ty: (v) => PAD_T + (1 - (v - minV) / span) * plotH,
      xToTime: (x) => ((x - PAD_L) / plotW) * duration,
      yToValue: (y) => minV + (1 - (y - PAD_T) / plotH) * span,
    };
  }, [containerSize.w, containerSize.h, duration, minV, maxV]);

  // SVG curve path — sample-driven polyline.
  const curvePath = useMemo(() => {
    if (sampled.values.length === 0) return '';
    let d = '';
    for (let i = 0; i < sampled.values.length; i++) {
      const p = sampled.values[i];
      d += (i === 0 ? 'M' : 'L') + view.tx(p.t).toFixed(1) + ',' + view.ty(p.v).toFixed(2);
    }
    return d;
  }, [sampled, view]);

  // Imperative canvas redraw.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.round(view.w * dpr));
    const pxH = Math.max(1, Math.round(view.h * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    drawHandles(ctx, fcurve.keyforms, selectedHandles, view);
    drawKeyframes(ctx, fcurve.keyforms, selectedHandles, view);
  }, [fcurve.keyforms, selectedHandles, view]);

  // ── pointer handling (canvas) ───────────────────────────────────────

  const onPointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.focus();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const keyforms = fcurve.keyforms;

    // (1) Foreground hit-test priority: handles of selected keyforms,
    // then keyframe diamonds, then fall through to seek.
    if (selectedHandles.size > 0) {
      for (const [i, parts] of selectedHandles) {
        const kf = keyforms[i];
        if (!kf) continue;
        // Hit-test handles regardless of per-part selection — the handle
        // dot is visible when its keyform is selected (KNOT_ONLY mode),
        // and clicking it grabs that side.
        if (kf.handleLeft && hitTest(x, y, view.tx(kf.handleLeft.time), view.ty(kf.handleLeft.value), HIT_HANDLE_R)) {
          // Click on handle dot → set selection to ONLY that handle
          // (matches Blender's click semantics — clicking a handle
          // deselects center + opposite). Shift adds to selection.
          if (!e.shiftKey) {
            setSelectedHandles(new Map([[i, { center: false, left: true, right: false }]]));
          } else {
            const next = cloneSelection(selectedHandles);
            const cur = next.get(i) ?? { center: false, left: false, right: false };
            next.set(i, { ...cur, left: true });
            setSelectedHandles(next);
          }
          startHandleDrag(e, i, 'left');
          return;
        }
        if (kf.handleRight && hitTest(x, y, view.tx(kf.handleRight.time), view.ty(kf.handleRight.value), HIT_HANDLE_R)) {
          if (!e.shiftKey) {
            setSelectedHandles(new Map([[i, { center: false, left: false, right: true }]]));
          } else {
            const next = cloneSelection(selectedHandles);
            const cur = next.get(i) ?? { center: false, left: false, right: false };
            next.set(i, { ...cur, right: true });
            setSelectedHandles(next);
          }
          startHandleDrag(e, i, 'right');
          return;
        }
      }
    }

    let hitKf = -1;
    for (let i = 0; i < keyforms.length; i++) {
      const kf = keyforms[i];
      if (typeof kf.value !== 'number') continue;
      if (hitTest(x, y, view.tx(kf.time), view.ty(kf.value), HIT_KEYFRAME_R)) {
        hitKf = i;
        break;
      }
    }

    if (hitKf >= 0) {
      // Whole-keyform select → all three parts (KNOT_ONLY semantic).
      const nextSel = e.shiftKey
        ? toggleKeyformSelection(selectedHandles, hitKf)
        : new Map([[hitKf, { center: true, left: true, right: true }]]);
      setSelectedHandles(nextSel);
      startKeyformDrag(e, hitKf);
      return;
    }

    if (!e.shiftKey) setSelectedHandles(new Map());
    const ms = clamp(view.xToTime(x), 0, duration);
    onSeek(ms);
  }, [fcurve, view, selectedHandles, duration, onSeek, activeActionId]);

  // ── single-keyform drag (Slice 5.B) ─────────────────────────────────

  function startKeyformDrag(e, kfIdx) {
    const kf = fcurve.keyforms[kfIdx];
    if (!kf) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    setViewLock({ minV: sampled.minV, maxV: sampled.maxV });
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const snap = view;
    const origTime = kf.time;
    const origValue = kf.value;
    const origHandleLeft = { ...kf.handleLeft };
    const origHandleRight = { ...kf.handleRight };
    const fcurveId = fcurve.id;
    const dragIdxRef = { current: kfIdx };
    let pendingSelectionIdx = null;

    const move = (ev) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const dTime = (dx / snap.plotW) * duration;
      const dValue = -(dy / snap.plotH) * snap.vSpan;

      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        const curIdx = dragIdxRef.current;
        const k = fc.keyforms[curIdx];
        if (!k) return;
        applyKeyformDrag(
          k,
          origTime,
          origValue,
          origHandleLeft,
          origHandleRight,
          dTime,
          dValue,
        );
        fc.keyforms.sort((a, b) => a.time - b.time);
        const newIdx = fc.keyforms.indexOf(k);
        if (newIdx !== curIdx && newIdx >= 0) {
          dragIdxRef.current = newIdx;
          pendingSelectionIdx = newIdx;
        }
      }, { skipHistory: true });

      if (pendingSelectionIdx !== null) {
        setSelectedHandles(new Map([[pendingSelectionIdx, { center: true, left: true, right: true }]]));
        pendingSelectionIdx = null;
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Slice 5.C — post-release: merge duplicate-time keys + recalc
      // handles, mirroring Blender's transform-confirm chain at
      // `transform_convert_graph.cc:1014`.
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        const curIdx = dragIdxRef.current;
        const sel = new Map([[curIdx, { center: true, left: true, right: true }]]);
        const remap = mergeDuplicateTimeKeys(fc, sel);
        recalcKeyformHandles(fc.keyforms);
        const finalIdx = remap.get(curIdx);
        if (typeof finalIdx === 'number' && finalIdx >= 0 && finalIdx !== curIdx) {
          // Defer the state update to after the immer recipe; React
          // setters from inside `produce` don't fire reliably.
          queueMicrotask(() => {
            setSelectedHandles(new Map([[finalIdx, { center: true, left: true, right: true }]]));
          });
        }
      }, { skipHistory: true });
      endBatch();
      setViewLock(null);
      dragCleanupRef.current = null;
    };
    const up = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startHandleDrag(e, kfIdx, side) {
    const kf = fcurve.keyforms[kfIdx];
    if (!kf) return;
    const sourceHandle = side === 'left' ? kf.handleLeft : kf.handleRight;
    if (!sourceHandle) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    setViewLock({ minV: sampled.minV, maxV: sampled.maxV });
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const snap = view;
    const origHandle = { ...sourceHandle };
    const fcurveId = fcurve.id;

    const move = (ev) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const dTime = (dx / snap.plotW) * duration;
      const dValue = -(dy / snap.plotH) * snap.vSpan;

      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        const k = fc.keyforms[kfIdx];
        if (!k) return;
        applyHandleDrag(k, side, {
          time: origHandle.time + dTime,
          value: origHandle.value + dValue,
        });
      }, { skipHistory: true });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      // Handle drag does not move the keyform's centre, so no merge
      // pass is needed; but recalc auto/aligned/vector handles on any
      // neighbouring AUTO entries that the moved handle's slope changed.
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        recalcKeyformHandles(fc.keyforms);
      }, { skipHistory: true });
      endBatch();
      setViewLock(null);
      dragCleanupRef.current = null;
    };
    const up = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── modal G/S — Slice 5.C ───────────────────────────────────────────

  /**
   * Open a modal grab (G) or scale (S) for the current selection.
   * Captures origin snapshots + pivot up front so successive ticks
   * compute from the start-of-modal baseline (matches Blender's
   * `t->data[i].iloc`).
   */
  function startModal(kind, anchorClient) {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    setViewLock({ minV: sampled.minV, maxV: sampled.maxV });
    setModal({ kind });

    const snap = view;
    const fcurveId = fcurve.id;

    /** @type {Map<number, ReturnType<typeof snapshotKeyform>>} */
    const origins = new Map();
    let pivotTime = 0;
    let pivotValue = 0;
    let n = 0;
    for (const [idx] of sel) {
      const k = fcurve.keyforms[idx];
      if (!k) continue;
      origins.set(idx, snapshotKeyform(k));
      pivotTime += k.time;
      pivotValue += k.value;
      n++;
    }
    if (n === 0) {
      endBatch();
      setModal(null);
      setViewLock(null);
      return;
    }
    const pivot = { time: pivotTime / n, value: pivotValue / n };
    const startClientX = anchorClient.x;
    const startClientY = anchorClient.y;

    // For scale: gesture distance reference (cursor distance from pivot
    // in viewport-px at modal start).
    const pivotPxX = view.tx(pivot.time);
    const pivotPxY = view.ty(pivot.value);
    const rect = canvasRef.current?.getBoundingClientRect();
    const startDist = Math.hypot(
      (rect ? startClientX - rect.left : startClientX) - pivotPxX,
      (rect ? startClientY - rect.top  : startClientY) - pivotPxY,
    ) || 1;

    const msPerFrame = fps > 0 ? 1000 / fps : 1000 / 24;

    /** @type {Map<number, number>} kf-by-its-object-ref → its origin-key */
    const liveOriginsByObject = new Map();
    // Track post-sort index re-mapping by walking from the captured
    // origins to current array positions via object identity.
    let dragIdxByOrigin = new Map(
      [...origins.keys()].map((idx) => [idx, idx]),
    );
    // Stash kf object refs at modal-start so we can find their new
    // positions post-sort. We grab them via the immer recipe (the
    // current draft) so we always read the active project tree.

    function applyModal(currentX, currentY, shiftKey, ctrlKey) {
      const dxPx = currentX - startClientX;
      const dyPx = currentY - startClientY;
      let dTime = (dxPx / snap.plotW) * duration;
      let dValue = -(dyPx / snap.plotH) * snap.vSpan;
      if (shiftKey) {
        dTime *= 0.1;
        dValue *= 0.1;
      }
      // Ctrl-snap dTime to whole frames for grab; scale uses 0.1× steps.
      if (kind === 'g' && ctrlKey && msPerFrame > 0) {
        dTime = Math.round(dTime / msPerFrame) * msPerFrame;
      }

      const curDist = Math.hypot(
        (rect ? currentX - rect.left : currentX) - pivotPxX,
        (rect ? currentY - rect.top  : currentY) - pivotPxY,
      );
      let scaleFactor = curDist / startDist;
      if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 1;
      if (shiftKey) scaleFactor = 1 + 0.1 * (scaleFactor - 1);
      if (kind === 's' && ctrlKey) scaleFactor = Math.round(scaleFactor * 10) / 10 || 0.1;

      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        // Build a working selection map keyed off the *current* indices
        // (which may have shifted post-sort).
        /** @type {Map<number, {center,left,right}>} */
        const workSelection = new Map();
        /** @type {Map<number, ReturnType<typeof snapshotKeyform>>} */
        const workOrigins = new Map();
        for (const [origIdx, parts] of sel) {
          const curIdx = dragIdxByOrigin.get(origIdx);
          if (typeof curIdx !== 'number') continue;
          const k = fc.keyforms[curIdx];
          if (!k) continue;
          workSelection.set(curIdx, parts);
          const o = origins.get(origIdx);
          if (o) workOrigins.set(curIdx, o);
        }
        if (kind === 'g') {
          applyGrab(fc, workSelection, workOrigins, dTime, dValue);
        } else {
          applyScale(fc, workSelection, workOrigins, pivot, scaleFactor, scaleFactor);
        }
        // Record kf object refs so we can re-find them after the sort.
        liveOriginsByObject.clear();
        for (const [curIdx] of workSelection) {
          const k = fc.keyforms[curIdx];
          if (k) liveOriginsByObject.set(k, indexOfOriginMap(curIdx, dragIdxByOrigin));
        }
        fc.keyforms.sort((a, b) => a.time - b.time);
        // Re-map origins to new indices via object identity.
        const nextMap = new Map(dragIdxByOrigin);
        for (let i = 0; i < fc.keyforms.length; i++) {
          const k = fc.keyforms[i];
          const origKey = liveOriginsByObject.get(k);
          if (typeof origKey === 'number') nextMap.set(origKey, i);
        }
        dragIdxByOrigin = nextMap;
      }, { skipHistory: true });

      // Reflect post-sort indices into React selection state so the
      // canvas re-renders with the correct diamonds highlighted.
      const nextSel = new Map();
      for (const [origIdx, parts] of sel) {
        const newIdx = dragIdxByOrigin.get(origIdx);
        if (typeof newIdx === 'number') nextSel.set(newIdx, parts);
      }
      setSelectedHandles(nextSel);
    }

    function commit() {
      cleanup(false);
    }
    function revert() {
      // Restore the originals into the (post-sort) positions.
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        for (const [origIdx, o] of origins) {
          const curIdx = dragIdxByOrigin.get(origIdx);
          if (typeof curIdx !== 'number') continue;
          const k = fc.keyforms[curIdx];
          if (!k) continue;
          k.time = o.time;
          k.value = o.value;
          k.handleLeft = { time: o.handleLeft.time, value: o.handleLeft.value };
          k.handleRight = { time: o.handleRight.time, value: o.handleRight.value };
          if (o.handleType) k.handleType = { left: o.handleType.left, right: o.handleType.right };
        }
        fc.keyforms.sort((a, b) => a.time - b.time);
      }, { skipHistory: true });
      // Restore selection to original indices.
      setSelectedHandles(cloneSelection(sel));
      cleanup(true);
    }
    function cleanup(cancelled) {
      window.removeEventListener('mousemove', onMove, { capture: true });
      window.removeEventListener('mousedown', onClickCommit, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      if (!cancelled) {
        // Post-confirm: merge duplicates + recalc handles.
        update((p) => {
          const a = getActiveSceneAction(p, activeActionId);
          if (!a) return;
          const fc = a.fcurves.find((f) => f.id === fcurveId);
          if (!fc) return;
          const workSel = new Map();
          for (const [origIdx, parts] of sel) {
            const curIdx = dragIdxByOrigin.get(origIdx);
            if (typeof curIdx === 'number') workSel.set(curIdx, parts);
          }
          const remap = mergeDuplicateTimeKeys(fc, workSel);
          recalcKeyformHandles(fc.keyforms);
          // Propagate remap to React state.
          queueMicrotask(() => {
            const nextSel = new Map();
            for (const [origIdx, parts] of sel) {
              const curIdx = dragIdxByOrigin.get(origIdx);
              if (typeof curIdx !== 'number') continue;
              const finalIdx = remap.get(curIdx);
              if (typeof finalIdx === 'number' && finalIdx >= 0) {
                nextSel.set(finalIdx, parts);
              }
            }
            setSelectedHandles(nextSel);
          });
        }, { skipHistory: true });
      }
      endBatch();
      setViewLock(null);
      setModal(null);
      modalCleanupRef.current = null;
    }

    let shiftHeld = false;
    let ctrlHeld = false;
    let lastX = startClientX;
    let lastY = startClientY;

    function onMove(ev) {
      lastX = ev.clientX;
      lastY = ev.clientY;
      shiftHeld = ev.shiftKey;
      ctrlHeld = ev.ctrlKey || ev.metaKey;
      applyModal(lastX, lastY, shiftHeld, ctrlHeld);
    }
    function onClickCommit(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.button === 2) revert();
      else commit();
    }
    function onContextMenu(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      revert();
    }
    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        revert();
        return;
      }
      if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        commit();
        return;
      }
      if (ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Meta') {
        shiftHeld = ev.shiftKey;
        ctrlHeld = ev.ctrlKey || ev.metaKey;
        applyModal(lastX, lastY, shiftHeld, ctrlHeld);
      }
      // Eat every other key so modal G/S/B/V/T can't chain mid-modal.
      ev.preventDefault();
      ev.stopPropagation();
    }

    window.addEventListener('mousemove', onMove, { capture: true });
    window.addEventListener('mousedown', onClickCommit, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    modalCleanupRef.current = () => cleanup(true);
    // Fire one tick at modal start so the HUD has something to show.
    applyModal(startClientX, startClientY, false, false);
  }

  // ── Box-select (B) — Slice 5.C ──────────────────────────────────────

  function startBoxSelect(anchorClient) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = anchorClient.x - rect.left;
    const startY = anchorClient.y - rect.top;
    setBoxSelect({ x: startX, y: startY, curX: startX, curY: startY, modifier: 'replace' });

    function onMove(ev) {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;
      const cx = ev.clientX - r.left;
      const cy = ev.clientY - r.top;
      const modifier = ev.shiftKey ? 'add' : (ev.ctrlKey || ev.metaKey) ? 'subtract' : 'replace';
      setBoxSelect({ x: startX, y: startY, curX: cx, curY: cy, modifier });
    }
    function onUp(ev) {
      window.removeEventListener('mousemove', onMove, { capture: true });
      window.removeEventListener('mouseup', onUp, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) { setBoxSelect(null); return; }
      const cx = ev.clientX - r.left;
      const cy = ev.clientY - r.top;
      const modifier = ev.shiftKey ? 'add' : (ev.ctrlKey || ev.metaKey) ? 'subtract' : 'replace';
      const x1 = Math.min(startX, cx);
      const y1 = Math.min(startY, cy);
      const x2 = Math.max(startX, cx);
      const y2 = Math.max(startY, cy);
      if (Math.abs(x2 - x1) >= 2 && Math.abs(y2 - y1) >= 2) {
        applyBoxSelect(x1, y1, x2, y2, modifier);
      }
      setBoxSelect(null);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        window.removeEventListener('mousemove', onMove, { capture: true });
        window.removeEventListener('mouseup', onUp, { capture: true });
        window.removeEventListener('keydown', onKey, { capture: true });
        setBoxSelect(null);
      }
    }
    window.addEventListener('mousemove', onMove, { capture: true });
    window.addEventListener('mouseup', onUp, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
  }

  function applyBoxSelect(x1, y1, x2, y2, modifier) {
    const next = modifier === 'replace' ? new Map() : cloneSelection(selectionRef.current);
    for (let i = 0; i < fcurve.keyforms.length; i++) {
      const kf = fcurve.keyforms[i];
      if (typeof kf.value !== 'number') continue;
      const kx = view.tx(kf.time);
      const ky = view.ty(kf.value);
      const cur = next.get(i) ?? { center: false, left: false, right: false };
      const inRect = (px, py) => px >= x1 && px <= x2 && py >= y1 && py <= y2;
      const centerIn = inRect(kx, ky);
      const leftIn = kf.handleLeft && inRect(view.tx(kf.handleLeft.time), view.ty(kf.handleLeft.value));
      const rightIn = kf.handleRight && inRect(view.tx(kf.handleRight.time), view.ty(kf.handleRight.value));
      if (modifier === 'subtract') {
        const out = {
          center: cur.center && !centerIn,
          left:   cur.left   && !leftIn,
          right:  cur.right  && !rightIn,
        };
        if (out.center || out.left || out.right) next.set(i, out);
        else next.delete(i);
      } else {
        // replace OR add — same writer; replace started from empty
        const out = {
          center: cur.center || centerIn,
          left:   cur.left   || leftIn,
          right:  cur.right  || rightIn,
        };
        if (out.center || out.left || out.right) next.set(i, out);
      }
    }
    setSelectedHandles(next);
  }

  // ── Operator handlers (V / T / Shift+E / Delete / Home / Ctrl+G) ───

  function operatorSetHandleType(type) {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const fcurveId = fcurve.id;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const fc = a.fcurves.find((f) => f.id === fcurveId);
      if (!fc) return;
      setHandleType(fc, sel, type, 'both');
      recalcKeyformHandles(fc.keyforms);
    });
    endBatch();
  }

  function operatorSetInterpolation(interp) {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const fcurveId = fcurve.id;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const fc = a.fcurves.find((f) => f.id === fcurveId);
      if (!fc) return;
      setInterpolation(fc, sel, interp);
      recalcKeyformHandles(fc.keyforms);
    });
    endBatch();
  }

  function operatorSetExtrapolation(extrap) {
    const fcurveId = fcurve.id;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const fc = a.fcurves.find((f) => f.id === fcurveId);
      if (!fc) return;
      setExtrapolation(fc, extrap);
    });
    endBatch();
  }

  function operatorDelete() {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    // Don't delete if it would leave 0 keyforms — every FCurve in SS
    // assumes ≥1 keyform (evaluator returns the lone value as the
    // constant). Two-keyform-curves are valid; one-keyform-curves too;
    // zero-keyform-curves are unrepresented (the Timeline shows them
    // as missing and pickFCurve drops them).
    const fcurveId = fcurve.id;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const fc = a.fcurves.find((f) => f.id === fcurveId);
      if (!fc) return;
      const wouldDelete = countDeletable(sel);
      if (fc.keyforms.length - wouldDelete < 1) return;
      const remap = deleteKeyforms(fc, sel);
      recalcKeyformHandles(fc.keyforms);
      // Propagate remap to React state.
      queueMicrotask(() => {
        setSelectedHandles(remapSelection(sel, remap));
      });
    });
    endBatch();
  }

  function operatorHome() {
    // Clear view-lock — `view` derives from `sampled.{minV,maxV}` when
    // lock is null, so this auto-fits to the current curve range.
    setViewLock(null);
  }

  function operatorSnapToFrame() {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const msPerFrame = fps > 0 ? 1000 / fps : 1000 / 24;
    const fcurveId = fcurve.id;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const fc = a.fcurves.find((f) => f.id === fcurveId);
      if (!fc) return;
      snapKeyformsToFrame(fc, sel, msPerFrame);
      fc.keyforms.sort((a, b) => a.time - b.time);
      mergeDuplicateTimeKeys(fc, sel);
      recalcKeyformHandles(fc.keyforms);
    });
    endBatch();
  }

  function operatorSelectAll() {
    const next = new Map();
    for (let i = 0; i < fcurve.keyforms.length; i++) {
      next.set(i, { center: true, left: true, right: true });
    }
    setSelectedHandles(next);
  }

  // ── Hotkey dispatch ─────────────────────────────────────────────────

  const onKeyDown = useCallback((e) => {
    if (modal) return; // Modal owns the keystrokes via its capture listener.
    if (menu) return;  // Menu owns the keystrokes.
    // Most operator hotkeys are single-letter; let the browser handle
    // text-input keys outside our scope.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    // Get cursor anchor for modal G/S — defaults to centre of canvas.
    const rect = canvasRef.current?.getBoundingClientRect();
    const anchor = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: 0, y: 0 };

    if (e.code === 'KeyG') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) operatorSnapToFrame();
      else startModal('g', anchor);
      return;
    }
    if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      startModal('s', anchor);
      return;
    }
    if (e.code === 'KeyB') {
      e.preventDefault();
      // For B-key, the box starts at the cursor's current position.
      // We don't have a current cursor event here — use canvas centre
      // as the anchor (Blender does the same: B opens a rubberband
      // anchored at the cursor's current position, but we use centre
      // as a safe default and the user can drag from there).
      startBoxSelect(anchor);
      return;
    }
    if (e.code === 'KeyV') {
      e.preventDefault();
      if (selectionRef.current.size === 0) return;
      setMenu({ kind: 'handleType', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (selectionRef.current.size === 0) return;
      setMenu({ kind: 'interpolation', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'KeyE' && e.shiftKey) {
      e.preventDefault();
      setMenu({ kind: 'extrapolation', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'Delete' || e.code === 'KeyX') {
      e.preventDefault();
      operatorDelete();
      return;
    }
    if (e.code === 'Home') {
      e.preventDefault();
      operatorHome();
      return;
    }
    if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey) {
      // Blender's A in space_graph = toggle-all (deselect if any selected).
      e.preventDefault();
      if (selectionRef.current.size > 0) setSelectedHandles(new Map());
      else operatorSelectAll();
      return;
    }
  }, [modal, menu, fcurve, fps]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full focus:outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerEnter={() => wrapRef.current?.focus({ preventScroll: true })}
    >
      <svg
        width={view.w}
        height={view.h}
        className="absolute inset-0 pointer-events-none"
      >
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={view.h - PAD_B}
          stroke="currentColor" className="text-border" strokeWidth={1} />
        <line x1={PAD_L} y1={view.h - PAD_B} x2={view.w - PAD_R} y2={view.h - PAD_B}
          stroke="currentColor" className="text-border" strokeWidth={1} />

        <text x={PAD_L - 4} y={PAD_T + 8} textAnchor="end" fontSize={10}
          className="fill-muted-foreground font-mono">{maxV.toFixed(2)}</text>
        <text x={PAD_L - 4} y={view.h - PAD_B} textAnchor="end" fontSize={10}
          className="fill-muted-foreground font-mono">{minV.toFixed(2)}</text>

        {[0, 0.33, 0.67, 1].map((p) => (
          <text key={p}
            x={view.tx(p * duration)} y={view.h - 4} textAnchor="middle" fontSize={10}
            className="fill-muted-foreground font-mono">
            {((p * duration) / 1000).toFixed(1)}s
          </text>
        ))}

        {minV < 0 && maxV > 0 ? (
          <line x1={PAD_L} y1={view.ty(0)} x2={view.w - PAD_R} y2={view.ty(0)}
            stroke="currentColor" className="text-border/60" strokeDasharray="2 2" strokeWidth={1} />
        ) : null}

        <path d={curvePath} fill="none" stroke="currentColor"
          className="text-primary" strokeWidth={1.5} />

        <line x1={view.tx(currentTime)} y1={PAD_T}
          x2={view.tx(currentTime)} y2={view.h - PAD_B}
          stroke="currentColor" className="text-primary/70" strokeWidth={1} />

        {boxSelect ? (
          <rect
            x={Math.min(boxSelect.x, boxSelect.curX)}
            y={Math.min(boxSelect.y, boxSelect.curY)}
            width={Math.abs(boxSelect.curX - boxSelect.x)}
            height={Math.abs(boxSelect.curY - boxSelect.y)}
            fill="hsl(25 95% 55% / 0.10)"
            stroke="hsl(25 95% 55%)"
            strokeWidth={1}
            strokeDasharray="4 3"
          />
        ) : null}
      </svg>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair focus:outline-none"
        tabIndex={-1}
        onPointerDown={onPointerDown}
      />

      {modal ? <ModalHUD kind={modal.kind} /> : null}
      {menu ? (
        <OperatorMenu
          menu={menu}
          fcurve={fcurve}
          selection={selectedHandles}
          onClose={() => setMenu(null)}
          onPickHandleType={operatorSetHandleType}
          onPickInterpolation={operatorSetInterpolation}
          onPickExtrapolation={operatorSetExtrapolation}
        />
      ) : null}
    </div>
  );
}

// ── canvas-2D drawing helpers ────────────────────────────────────────

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} keyforms
 * @param {Map<number, {center:boolean,left:boolean,right:boolean}>} selectedHandles
 * @param {{tx:(t:number)=>number, ty:(v:number)=>number}} view
 */
function drawHandles(ctx, keyforms, selectedHandles, view) {
  if (selectedHandles.size === 0) return;
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)'; // amber-500
  ctx.lineWidth = 1;
  for (const [i, parts] of selectedHandles) {
    const kf = keyforms[i];
    if (!kf) continue;
    const kx = view.tx(kf.time);
    const ky = view.ty(kf.value);
    if (kf.handleLeft) {
      const hx = view.tx(kf.handleLeft.time);
      const hy = view.ty(kf.handleLeft.value);
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, parts.left ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = parts.left ? '#fde68a' : 'rgba(245, 158, 11, 0.85)';
      ctx.fill();
    }
    if (kf.handleRight) {
      const hx = view.tx(kf.handleRight.time);
      const hy = view.ty(kf.handleRight.value);
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, parts.right ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = parts.right ? '#fde68a' : 'rgba(245, 158, 11, 0.85)';
      ctx.fill();
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} keyforms
 * @param {Map<number, {center:boolean,left:boolean,right:boolean}>} selectedHandles
 * @param {{tx:(t:number)=>number, ty:(v:number)=>number}} view
 */
function drawKeyframes(ctx, keyforms, selectedHandles, view) {
  for (let i = 0; i < keyforms.length; i++) {
    const kf = keyforms[i];
    if (typeof kf.value !== 'number') continue;
    const x = view.tx(kf.time);
    const y = view.ty(kf.value);
    const parts = selectedHandles.get(i);
    const sel = !!parts?.center;
    const r = sel ? 5 : 4;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = sel ? '#fbbf24' : '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = sel ? 1.5 : 1;
    ctx.stroke();
  }
}

// ── HUD + Menu subcomponents ─────────────────────────────────────────

function ModalHUD({ kind }) {
  const label = kind === 'g' ? 'GRAB' : 'SCALE';
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex items-center gap-2 px-3 py-1 bg-popover/95 border border-border rounded text-[11px] font-mono shadow">
      <span className="text-primary uppercase tracking-wider">{label}</span>
      <span className="text-muted-foreground">Click/Enter confirm · Esc/RMB cancel · Shift fine · Ctrl snap</span>
    </div>
  );
}

function OperatorMenu({ menu, fcurve, selection, onClose, onPickHandleType, onPickInterpolation, onPickExtrapolation }) {
  const items = menu.kind === 'handleType' ? HANDLE_TYPES
              : menu.kind === 'interpolation' ? INTERPOLATION_TYPES
              : EXTRAPOLATION_TYPES;
  const onPick = menu.kind === 'handleType' ? onPickHandleType
               : menu.kind === 'interpolation' ? onPickInterpolation
               : onPickExtrapolation;

  // Detect the "current" choice for highlighting:
  //   - handle type: most common type across selected entries' left side
  //   - interpolation: most common across selected entries
  //   - extrapolation: per-fcurve field
  const current = useMemo(() => {
    if (menu.kind === 'extrapolation') return fcurve.extrapolation ?? 'constant';
    if (menu.kind === 'handleType') {
      const counts = new Map();
      for (const [idx] of selection) {
        const kf = fcurve.keyforms[idx];
        if (!kf?.handleType) continue;
        counts.set(kf.handleType.left, (counts.get(kf.handleType.left) ?? 0) + 1);
      }
      return mostCommon(counts) ?? null;
    }
    // interpolation
    const counts = new Map();
    for (const [idx] of selection) {
      const kf = fcurve.keyforms[idx];
      if (!kf?.interpolation) continue;
      counts.set(kf.interpolation, (counts.get(kf.interpolation) ?? 0) + 1);
    }
    return mostCommon(counts) ?? null;
  }, [menu.kind, fcurve, selection]);

  useEffect(() => {
    function onDocKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
        return;
      }
      // 1..9 shortcuts: index into the menu items.
      const n = ev.key.charCodeAt(0) - '1'.charCodeAt(0);
      if (n >= 0 && n < items.length) {
        ev.preventDefault();
        onPick(items[n].key);
        onClose();
      }
    }
    function onDocClick() { onClose(); }
    window.addEventListener('keydown', onDocKey, { capture: true });
    window.addEventListener('mousedown', onDocClick, { capture: true });
    return () => {
      window.removeEventListener('keydown', onDocKey, { capture: true });
      window.removeEventListener('mousedown', onDocClick, { capture: true });
    };
  }, [items, onPick, onClose]);

  const title = menu.kind === 'handleType' ? 'Handle Type'
              : menu.kind === 'interpolation' ? 'Interpolation'
              : 'Extrapolation';

  return (
    <div
      className="fixed z-50 bg-popover border border-border rounded shadow-lg py-1 text-xs"
      style={{ left: menu.x + 4, top: menu.y + 4, minWidth: 160 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
        {title}
      </div>
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          className={`block w-full text-left px-3 py-1 hover:bg-accent ${current === it.key ? 'text-primary font-semibold' : ''}`}
          onMouseDown={(e) => { e.stopPropagation(); onPick(it.key); onClose(); }}
        >
          <span className="text-muted-foreground/70 mr-2">{i + 1}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function pickFCurve(action, selection) {
  if (!action?.fcurves) return null;
  for (let i = selection.length - 1; i >= 0; i--) {
    const sel = selection[i];
    if (sel.type === 'parameter') {
      const fc = action.fcurves.find((f) => fcurveTargetsParam(f, sel.id));
      if (fc) return fc;
    }
    if (sel.type === 'part' || sel.type === 'group') {
      const fc = action.fcurves.find((f) => {
        const t = decodeFCurveTarget(f);
        return t?.kind === 'node' && t.nodeId === sel.id;
      });
      if (fc) return fc;
    }
  }
  return null;
}

function sampleCurve(fcurve, duration) {
  const values = [];
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = (i / CURVE_SAMPLES) * duration;
    const v = interpolateTrack(fcurve.keyforms, t);
    if (typeof v !== 'number') continue;
    values.push({ t, v });
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  for (const kf of fcurve.keyforms) {
    if (typeof kf?.value !== 'number') continue;
    if (kf.value < minV) minV = kf.value;
    if (kf.value > maxV) maxV = kf.value;
    if (kf.handleLeft && typeof kf.handleLeft.value === 'number') {
      if (kf.handleLeft.value < minV) minV = kf.handleLeft.value;
      if (kf.handleLeft.value > maxV) maxV = kf.handleLeft.value;
    }
    if (kf.handleRight && typeof kf.handleRight.value === 'number') {
      if (kf.handleRight.value < minV) minV = kf.handleRight.value;
      if (kf.handleRight.value > maxV) maxV = kf.handleRight.value;
    }
  }
  if (!Number.isFinite(minV)) { minV = 0; maxV = 1; }
  if (minV === maxV) { minV -= 0.5; maxV += 0.5; }
  const span = maxV - minV;
  minV -= span * 0.05;
  maxV += span * 0.05;
  return { values, minV, maxV };
}

function hitTest(x, y, cx, cy, r) {
  return Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function cloneSelection(sel) {
  /** @type {Map<number, {center:boolean,left:boolean,right:boolean}>} */
  const next = new Map();
  for (const [idx, parts] of sel) {
    next.set(idx, { center: parts.center, left: parts.left, right: parts.right });
  }
  return next;
}

function toggleKeyformSelection(sel, idx) {
  const next = cloneSelection(sel);
  if (next.has(idx)) next.delete(idx);
  else next.set(idx, { center: true, left: true, right: true });
  return next;
}

function countDeletable(sel) {
  let n = 0;
  for (const [, parts] of sel) if (parts.center) n++;
  return n;
}

function indexOfOriginMap(curIdx, dragIdxByOrigin) {
  for (const [origIdx, mapped] of dragIdxByOrigin) {
    if (mapped === curIdx) return origIdx;
  }
  return -1;
}

function mostCommon(counts) {
  let bestKey = null;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) { bestCount = c; bestKey = k; }
  }
  return bestKey;
}
