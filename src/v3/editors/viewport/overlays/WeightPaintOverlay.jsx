// @ts-check

/**
 * V4 Phase 4b — Weight Paint canvas overlay.
 *
 * Active when `editorStore.editMode === 'weightPaint'` and a part is
 * selected. Renders three layers, separated for performance:
 *
 *   1. **Heatmap** (memoized React subcomponent) — colored triangles +
 *      per-vertex circles. Re-renders ONLY when `weightArr`, `projected`
 *      list, or active group reference changes. Stable across cursor
 *      moves.
 *
 *   2. **Brush cursor** — imperatively positioned via refs (no React
 *      state). Pointer-move updates `<circle>.cx/cy` directly so the
 *      heatmap doesn't see a re-render every mouse twitch.
 *
 *   3. **Pointer-capture surface** — invisible top layer that owns the
 *      pointerdown/move/up handlers + rAF brush coalescing.
 *
 * **Performance contract.** Painting at 60+Hz pointer events would
 * fire one immer `produce` per event in the naïve path; with a
 * thousand-vertex mesh and a brush radius covering ~50 verts, that's
 * 50k cell mutations / sec. The rAF coalescing reduces commits to
 * one per animation frame (~60Hz), and the per-stroke `beginBatch`
 * collapses the whole drag into a single undo entry.
 *
 * Math:
 *   - Project canvas-px → screen-px via the same (zoom, panX, panY)
 *     CanvasViewport applies, so the heatmap pins to the GL canvas.
 *   - Brush hit-test computes vertex screen distance and applies the
 *     cosine falloff against `brushSize` (in screen px).
 *
 * @module v3/editors/viewport/overlays/WeightPaintOverlay
 */

import { memo, useEffect, useMemo, useRef } from 'react';
import { useEditorStore } from '../../../../store/editorStore.js';
import { useProjectStore } from '../../../../store/projectStore.js';
import { beginBatch, endBatch } from '../../../../store/undoHistory.js';

export function WeightPaintOverlay() {
  const editMode = useEditorStore((s) => s.editMode);
  const selection = useEditorStore((s) => s.selection);
  const view = useEditorStore((s) => s.viewByMode.viewport);
  const brushSize = useEditorStore((s) => s.brushSize);
  const node = useProjectStore((s) =>
    s.project.nodes.find((n) => n?.id === selection?.[0]) ?? null,
  );
  const paintWeightStroke = useProjectStore((s) => s.paintWeightStroke);

  // Imperative cursor refs — bypass React state to avoid re-rendering
  // the heatmap on every pointer move. The two circles share the same
  // (cx, cy); we update both on pointermove.
  const cursorRef = useRef(/** @type {SVGGElement|null} */ (null));
  const cursorOuterRef = useRef(/** @type {SVGCircleElement|null} */ (null));
  const cursorInnerRef = useRef(/** @type {SVGCircleElement|null} */ (null));

  // Pointer / drag state lives in refs — never causes re-renders.
  const dragRef = useRef(
    /** @type {null | { pointerId: number, erase: boolean, sx: number, sy: number, batched: boolean }} */
    (null),
  );
  // rAF coalescing — pointermove records the latest brush position;
  // a rAF loop reads it and commits one paintWeightStroke per frame.
  const pendingPaintRef = useRef(
    /** @type {null | { sx: number, sy: number, erase: boolean }} */
    (null),
  );
  const rafIdRef = useRef(/** @type {number|null} */ (null));

  // Bail unless the overlay should be visible. All hooks (above + the
  // useMemo / useEffect below) ran unconditionally so React's call
  // order stays stable across renders.
  const active = editMode === 'weightPaint' && node?.mesh;

  const vertices = active
    ? /** @type {Array<{x:number,y:number}>} */ (node.mesh.vertices ?? [])
    : EMPTY_ARRAY;
  const triangles = active
    ? /** @type {number[]} */ (node.mesh.triangles ?? [])
    : EMPTY_ARRAY;
  const activeName = active ? node.mesh.activeWeightGroup : null;
  const weightArr = active && activeName && node.mesh.weightGroups?.[activeName]
    ? node.mesh.weightGroups[activeName]
    : (active ? (node.mesh.boneWeights ?? EMPTY_ARRAY) : EMPTY_ARRAY);

  // Precompute projected screen-space positions whenever vertices or
  // view (zoom/pan) change. Stable across paint commits that don't
  // touch geometry — only the weight array changes during a stroke.
  const projected = useMemo(() => {
    const out = new Array(vertices.length);
    for (let i = 0; i < vertices.length; i++) {
      const v = vertices[i];
      out[i] = {
        x: (v?.x ?? 0) * view.zoom + view.panX,
        y: (v?.y ?? 0) * view.zoom + view.panY,
      };
    }
    return out;
  }, [vertices, view.zoom, view.panX, view.panY]);

  // Cleanup any pending rAF on unmount.
  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  if (!active) return null;

  // ── Brush stroke ──────────────────────────────────────────────────

  function flushPaint() {
    rafIdRef.current = null;
    const pending = pendingPaintRef.current;
    pendingPaintRef.current = null;
    if (!pending) return;
    const { sx, sy, erase } = pending;
    const r = brushSize;
    const r2 = r * r;
    const updates = [];
    for (let i = 0; i < projected.length; i++) {
      const dx = projected[i].x - sx;
      const dy = projected[i].y - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      // Cosine falloff: weight at edge = 0, weight at center = full strength.
      const t = Math.sqrt(d2) / r;
      const fall = (1 + Math.cos(t * Math.PI)) / 2;
      const STRENGTH = 0.5;
      const cur = Number(weightArr[i]) || 0;
      const target = erase ? 0 : 1;
      const next = cur + (target - cur) * STRENGTH * fall;
      updates.push({ vertexIndex: i, weight: next });
    }
    if (updates.length > 0) paintWeightStroke(node.id, updates);
  }

  function schedulePaint(sx, sy, erase) {
    pendingPaintRef.current = { sx, sy, erase };
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(flushPaint);
  }

  function moveCursor(sx, sy) {
    const o = cursorOuterRef.current;
    const i = cursorInnerRef.current;
    if (o) { o.setAttribute('cx', String(sx)); o.setAttribute('cy', String(sy)); o.setAttribute('r', String(brushSize)); }
    if (i) { i.setAttribute('cx', String(sx)); i.setAttribute('cy', String(sy)); i.setAttribute('r', String(brushSize)); }
    if (cursorRef.current) cursorRef.current.setAttribute('visibility', 'visible');
  }

  function hideCursor() {
    if (cursorRef.current) cursorRef.current.setAttribute('visibility', 'hidden');
  }

  function handlePointerDown(e) {
    if (dragRef.current) return;
    e.preventDefault();
    /** @type {SVGSVGElement} */
    const svg = e.currentTarget;
    svg.setPointerCapture?.(e.pointerId);
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    // One undo snapshot per stroke — beginBatch pushes the pre-stroke
    // project; subsequent paintWeightStroke calls during drag bypass
    // pushSnapshot entirely (they use raw `set(produce(...))`).
    beginBatch(useProjectStore.getState().project);
    dragRef.current = {
      pointerId: e.pointerId,
      erase: e.shiftKey,
      sx,
      sy,
      batched: true,
    };
    moveCursor(sx, sy);
    schedulePaint(sx, sy, e.shiftKey);
  }

  function handlePointerMove(e) {
    /** @type {SVGSVGElement} */
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    moveCursor(sx, sy);
    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      schedulePaint(sx, sy, drag.erase || e.shiftKey);
    }
  }

  function handlePointerUp(e) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    /** @type {SVGSVGElement} */
    const svg = e.currentTarget;
    svg.releasePointerCapture?.(e.pointerId);
    // Flush any pending paint synchronously so the final dab lands.
    if (rafIdRef.current != null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
      flushPaint();
    }
    if (drag.batched) endBatch();
    dragRef.current = null;
  }

  return (
    <svg
      className="absolute inset-0"
      style={{ width: '100%', height: '100%', pointerEvents: 'auto', cursor: 'none', touchAction: 'none' }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={hideCursor}
    >
      {/* @ts-ignore — `memo()` strips the props type; we annotate via JSDoc. */}
      <HeatmapLayer
        triangles={triangles}
        projected={projected}
        weightArr={weightArr}
      />

      {/* Brush cursor — imperatively positioned via refs (no React
          state for pointer position). Hidden until the first pointer
          move enters the SVG. */}
      <g ref={cursorRef} pointerEvents="none" visibility="hidden">
        <circle ref={cursorOuterRef} cx={0} cy={0} r={brushSize}
          fill="none" stroke="white" strokeOpacity={0.9} strokeWidth={1.2} />
        <circle ref={cursorInnerRef} cx={0} cy={0} r={brushSize}
          fill="none" stroke="black" strokeOpacity={0.4} strokeWidth={2.4}
          strokeDasharray="3 3" />
      </g>

      {/* Tips pinned to bottom-center so they don't sit underneath the
          ModePill (top-left) or the CanvasToolbar (left edge). */}
      <text
        x="50%"
        y="100%"
        dy="-12"
        textAnchor="middle"
        fontSize={11}
        fill="white"
        style={{ fontFamily: 'monospace', filter: 'drop-shadow(0 0 2px rgba(0,0,0,0.8))' }}
      >
        weight paint · {activeName ?? '(no group)'}
        {' · '}drag = paint · shift+drag = erase
      </text>
    </svg>
  );
}

/**
 * Memoized heatmap render. Re-renders ONLY when its three input refs
 * change identity (triangles, projected, weightArr). Pointer moves
 * touch the brush cursor refs imperatively without invalidating
 * these props, so the heavy polygon list survives across cursor
 * twitches. Paint commits DO change weightArr (immer produces a new
 * array), invalidating + redrawing the heatmap once per actual
 * weight change rather than once per pointer event.
 */
const HeatmapLayer = memo(/** @param {any} props */ function HeatmapLayer(props) {
  const { triangles, projected, weightArr } = /** @type {{triangles:number[],projected:Array<{x:number,y:number}>,weightArr:any}} */ (props);
  /** @type {Array<JSX.Element>} */
  const polys = [];
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = triangles[t];
    const b = triangles[t + 1];
    const c = triangles[t + 2];
    if (a == null || b == null || c == null) continue;
    const pa = projected[a]; const pb = projected[b]; const pc = projected[c];
    if (!pa || !pb || !pc) continue;
    const wa = Number(weightArr[a]) || 0;
    const wb = Number(weightArr[b]) || 0;
    const wc = Number(weightArr[c]) || 0;
    const meanW = (wa + wb + wc) / 3;
    const fill = `#${colorForWeight(meanW).toString(16).padStart(6, '0')}`;
    polys.push(
      <polygon
        key={t}
        points={`${pa.x},${pa.y} ${pb.x},${pb.y} ${pc.x},${pc.y}`}
        fill={fill}
        stroke="none"
      />,
    );
  }

  /** @type {Array<JSX.Element>} */
  const dots = [];
  for (let i = 0; i < projected.length; i++) {
    const p = projected[i];
    const w = Number(weightArr[i]) || 0;
    const fill = `#${colorForWeight(w).toString(16).padStart(6, '0')}`;
    dots.push(
      <circle
        key={i}
        cx={p.x}
        cy={p.y}
        r={1.5 + w * 1.5}
        fill={fill}
        fillOpacity={0.95}
        stroke="rgb(15,15,15)"
        strokeOpacity={0.4}
        strokeWidth={0.4}
      />,
    );
  }

  return (
    <>
      <g opacity={0.55}>{polys}</g>
      <g>{dots}</g>
    </>
  );
});

function colorForWeight(w) {
  // Ramp: 0 → blue (#3b82f6), 0.5 → green (#22c55e), 1 → red (#ef4444).
  // Stop colors lifted from tailwind palette so they match the rest
  // of the UI (legible on both light and dark themes).
  const clamped = Math.max(0, Math.min(1, w));
  if (clamped < 0.5) {
    const t = clamped / 0.5;
    return lerpHex(0x3b82f6, 0x22c55e, t);
  } else {
    const t = (clamped - 0.5) / 0.5;
    return lerpHex(0x22c55e, 0xef4444, t);
  }
}

function lerpHex(a, b, t) {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Stable empty array for the inactive-state branch — fresh `[]` each
 *  call would invalidate `useMemo(() => …, [vertices, …])`. */
const EMPTY_ARRAY = Object.freeze([]);
