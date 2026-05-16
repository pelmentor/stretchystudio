// @ts-check
/* eslint-disable react/prop-types, react-hooks/exhaustive-deps */

/**
 * Animation Phase 5 — F-Curve Graph Editor (write-mode, Slices 5.A + 5.B).
 *
 * Plots one fcurve's value-over-time with interactive BezTriple bezier
 * handles. The user can:
 *
 *   - LMB-click a keyframe diamond  → select (Shift toggles).
 *   - LMB-drag a keyframe diamond   → move in (time, value).
 *   - LMB-drag a handle dot         → reshape the bezier interpolation.
 *   - Click empty area              → seek the playhead to that time.
 *
 * # Architecture (plan §5.A)
 *
 * Two-layer composition per the audit-driven decision (the v1 SVG-only
 * path breaks past ~200 keyframes; real characters ship 1200+):
 *
 *   - **Background — SVG** (`pointer-events: none`): axes,
 *     value/time labels, the curve `<path>`, zero-line, playhead.
 *   - **Foreground — canvas-2D** (receives all pointer events):
 *     keyframe diamonds, handle dots + handle lines (drawn only for
 *     SELECTED keyforms — this is Blender's `SIPO_SELVHANDLESONLY` mode,
 *     not the default mode that draws handles for every keyframe; see
 *     `reference/blender/source/blender/editors/space_graph/graph_draw.cc:469-476`.
 *     SS ships SIPO_SELVHANDLESONLY by default because a 1200-keyform
 *     curve with every-keyframe handles is visual noise; a toggle for
 *     "all handles" lands with the V/T menu work in Slice 5.C).
 *
 * Both layers share a single `view` (px-space PAD + plotW/plotH +
 * tMin/tMax + vMin/vMax) derived from container dims via
 * ResizeObserver and the active FCurve's auto-fit value range. The
 * canvas is DPR-aware (drawing buffer scaled by `devicePixelRatio`).
 *
 * # Drag semantics (plan §5.B subset)
 *
 * Keyframe drag: mutates `kf.time` + `kf.value`. Time is clamped to
 * `[prev.time + 1, next.time - 1]` ms so neighbours never collide —
 * `evaluateBezTripleSegment` divides by `next.time - prev.time`, so a
 * collision would NaN the curve. The keyform's handles ride along with
 * the keyform (translated by the same Δtime/Δvalue), matching Blender's
 * absolute-handle-coordinate convention.
 *
 * Handle drag: mutates `kf.handleLeft` or `kf.handleRight`. On drag
 * start, the handle-type conversions defined in
 * `src/anim/graphEditOps.js` fire (HD_AUTO/HD_AUTO_ANIM → HD_ALIGN
 * for both sides; HD_VECT → HD_FREE on the dragged side only). Matches
 * Blender's `BKE_nurb_bezt_handle_test`
 * (`reference/blender/source/blender/blenkernel/intern/curve.cc:4054-4084`),
 * called from `testhandles_fcurve`
 * (`reference/blender/source/blender/editors/transform/transform_convert_graph.cc:580`)
 * per transform tick.
 *
 * Aligned mirror: if the OPPOSITE side is `'aligned'` (either pre-drag
 * or via the AUTO→ALIGN conversion just above), it gets reflected
 * through the keyform so the two handles stay collinear. The opposite
 * handle's pre-drag length is preserved; only its direction is updated.
 * Equivalent in end-behaviour to Blender's `calchandleNurb_intern`
 * HD_ALIGN branch's `len_ratio` formula
 * (`reference/blender/source/blender/blenkernel/intern/curve.cc:3242-3301`).
 *
 * # Undo wrapping
 *
 * Each pointer-down opens a `beginBatch(project)`. Drag-moves mutate
 * via `update(p => ..., { skipHistory: true })`. Pointer-up calls
 * `endBatch()`. Result: one drag = one undo entry, matching
 * TimelineEditor's existing keyframe-drag pattern.
 *
 * # Known UX limitation (deferred to Slice 5.C polish)
 *
 * The view auto-fits to the current FCurve's value range on every
 * render, so a drag that pushes the keyform's value outside the
 * previous range causes the view to rescale mid-drag. The dragged
 * keyform still tracks the cursor in WORLD space (the drag handler
 * closure captured the start-of-drag view), but the displayed cursor
 * position may drift visually. A "lock view during drag" polish lands
 * with the modal G/S operators (plan §5.B).
 *
 * # Out of scope this slice
 *
 * Box-select, modal G/S, snap-to-frame, fit-view (Home), handle-type
 * menu (V), interpolation menu (T), extrapolation menu (Shift+E),
 * Delete, multi-curve display (§5.C), driver banner (§5.D) — all
 * deferred per plan §5.B operator table.
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
import { applyKeyformDrag, applyHandleDrag } from '../../../anim/graphEditOps.js';

const CURVE_SAMPLES = 240;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;

// Hit-test radii (px, screen-space).
const HIT_KEYFRAME_R = 7;
const HIT_HANDLE_R = 6;

export function FCurveEditor() {
  const project = useProjectStore((s) => s.project);
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const currentTime = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);
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

function Plot({ activeActionId, fcurve, sampled, duration, currentTime, onSeek }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [selected, setSelected] = useState(/** @type {Set<number>} */ (new Set()));
  const update = useProjectStore((s) => s.updateProject);
  // Audit-fix HIGH-A1: track any in-flight drag so unmounting the editor
  // mid-drag releases the window-level listeners + closes the open undo
  // batch. Without this, switching tabs mid-drag leaves a dangling
  // `endBatch()` un-called and `_batchDepth > 0` for the rest of the
  // session — every subsequent drag pushes a deeper nested batch and
  // the user's undo history silently stops growing.
  const dragCleanupRef = useRef(/** @type {(() => void) | null} */ (null));

  const { minV, maxV } = sampled;

  // Reset selection when the active FCurve changes — index-based selection
  // doesn't translate across FCurves (kf at index N in curve A ≠ kf at
  // index N in curve B). Cheaper than a global keyform-selection store
  // for the first slice.
  useEffect(() => {
    setSelected(new Set());
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

  // Audit-fix HIGH-A1: unmount cleanup for any in-flight drag.
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
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

  // SVG curve path — sample-driven polyline. Scales with sample count
  // (constant ~240), not keyform count, so it's cheap regardless of how
  // dense the curve is. Canvas-2D handles the per-keyform foreground.
  const curvePath = useMemo(() => {
    if (sampled.values.length === 0) return '';
    let d = '';
    for (let i = 0; i < sampled.values.length; i++) {
      const p = sampled.values[i];
      d += (i === 0 ? 'M' : 'L') + view.tx(p.t).toFixed(1) + ',' + view.ty(p.v).toFixed(2);
    }
    return d;
  }, [sampled, view]);

  // Imperative canvas redraw. Foreground — keyframe diamonds + handle
  // visualisation for selected keyforms.
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

    drawHandles(ctx, fcurve.keyforms, selected, view);
    drawKeyframes(ctx, fcurve.keyforms, selected, view);
  }, [fcurve.keyforms, selected, view]);

  const onPointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const keyforms = fcurve.keyforms;

    // Foreground hit-test priority: handles of selected keyforms first,
    // then keyframe diamonds, then fall through to seek. Selected-handle
    // priority matters because a handle can overlap a keyframe diamond
    // when the handle vector is short (auto/vector handles).
    if (selected.size > 0) {
      for (const i of selected) {
        const kf = keyforms[i];
        if (!kf) continue;
        if (kf.handleLeft && hitTest(x, y, view.tx(kf.handleLeft.time), view.ty(kf.handleLeft.value), HIT_HANDLE_R)) {
          startHandleDrag(e, i, 'left');
          return;
        }
        if (kf.handleRight && hitTest(x, y, view.tx(kf.handleRight.time), view.ty(kf.handleRight.value), HIT_HANDLE_R)) {
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
      const nextSel = e.shiftKey ? toggleSet(selected, hitKf) : new Set([hitKf]);
      setSelected(nextSel);
      startKeyframeDrag(e, hitKf);
      return;
    }

    if (!e.shiftKey) setSelected(new Set());
    const ms = clamp(view.xToTime(x), 0, duration);
    onSeek(ms);
  }, [fcurve, view, selected, duration, onSeek, activeActionId]);

  function startKeyframeDrag(e, kfIdx) {
    const kf = fcurve.keyforms[kfIdx];
    if (!kf) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    // Snapshot start-of-drag view so the world-space deltas don't drift
    // if the auto-fit rescales mid-drag.
    const snap = view;
    const origTime = kf.time;
    const origValue = kf.value;
    const origHandleLeft = { ...kf.handleLeft };
    const origHandleRight = { ...kf.handleRight };
    const fcurveId = fcurve.id;
    // Audit-fix HIGH-B3: SS now allows keyframes to cross during a drag
    // (matches Blender — `sort_time_fcurve` re-sorts post-transform,
    // `BKE_fcurve_merge_duplicate_keys` collapses ties; see
    // reference/blender/source/blender/blenkernel/intern/fcurve.cc:1293-1339
    // + reference/blender/source/blender/editors/transform/transform_convert_graph.cc:950).
    // Per-tick we re-sort the keyforms array and track the dragged
    // keyform's new index via this ref so subsequent ticks keep mutating
    // the correct entry.
    const dragIdxRef = { current: kfIdx };
    // The selection set holds the dragged kf's index — when the index
    // re-maps post-sort we stash it and update React state outside the
    // immer recipe (state setters can't fire from inside `produce`).
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
        // Re-sort to maintain the time-ordered invariant (the BezTriple
        // evaluator binary-searches by time). The dragged kf's object
        // identity is preserved across `Array.prototype.sort`, so
        // `indexOf(k)` finds it after the re-sort.
        fc.keyforms.sort((a, b) => a.time - b.time);
        const newIdx = fc.keyforms.indexOf(k);
        if (newIdx !== curIdx && newIdx >= 0) {
          dragIdxRef.current = newIdx;
          pendingSelectionIdx = newIdx;
        }
      }, { skipHistory: true });

      if (pendingSelectionIdx !== null) {
        setSelected(new Set([pendingSelectionIdx]));
        pendingSelectionIdx = null;
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      endBatch();
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
      endBatch();
      dragCleanupRef.current = null;
    };
    const up = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div ref={wrapRef} className="relative w-full h-full">
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
      </svg>

      <canvas
        ref={canvasRef}
        className="absolute inset-0 cursor-crosshair"
        onPointerDown={onPointerDown}
      />
    </div>
  );
}

// ── canvas-2D drawing helpers ────────────────────────────────────────

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} keyforms
 * @param {Set<number>} selected
 * @param {{tx:(t:number)=>number, ty:(v:number)=>number}} view
 */
function drawHandles(ctx, keyforms, selected, view) {
  if (selected.size === 0) return;
  ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)'; // amber-500
  ctx.fillStyle = 'rgba(245, 158, 11, 0.85)';
  ctx.lineWidth = 1;
  for (const i of selected) {
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
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
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
      ctx.arc(hx, hy, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} keyforms
 * @param {Set<number>} selected
 * @param {{tx:(t:number)=>number, ty:(v:number)=>number}} view
 */
function drawKeyframes(ctx, keyforms, selected, view) {
  for (let i = 0; i < keyforms.length; i++) {
    const kf = keyforms[i];
    if (typeof kf.value !== 'number') continue;
    const x = view.tx(kf.time);
    const y = view.ty(kf.value);
    const sel = selected.has(i);
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
  // Fold keyform + handle values into the range so the auto-fit can't
  // chop the diamonds or handle dots off-view.
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

function toggleSet(set, item) {
  const next = new Set(set);
  if (next.has(item)) next.delete(item);
  else next.add(item);
  return next;
}
