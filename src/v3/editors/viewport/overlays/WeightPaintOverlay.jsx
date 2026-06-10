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
 * **Toolset Phase 7.B integration.** Brush dispatch reads
 * `editorStore.weightPaintBrush`:
 *   - `'draw'` (default): lerp toward `editorStore.brushWeight` (Shift
 *     inverts toward 0). Pre-7.B behaviour with the hard-coded `1.0`
 *     replaced by the eyedropper-driven `brushWeight`.
 *   - `'blur'`: lerp each affected vertex toward the mean of its
 *     triangle neighbours' weights via `computeBlurUpdates`.
 *
 * X-axis mirror (`node.weightPaintSettings.xMirror`, schema v34) is
 * applied per-tick: every paint update at vertex `v` also writes the
 * same target weight to `mirror(v)` if a mirror pair exists. The
 * mirror map is built once per stroke (cached in a ref) since topology
 * is stable across pointer events.
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
import { getMesh } from '../../../../store/objectDataAccess.js';
import { computeBlurUpdates } from '../../../../lib/weightPaint/index.js';
import { buildVertexAdjacency } from '../../../../lib/proportionalEdit.js';
import { buildMirrorVertexMap } from '../../../operators/weightPaint/mirror.js';
import { finiteOr } from '../../../../lib/finiteOr.js';

export function WeightPaintOverlay() {
  const editMode = useEditorStore((s) => s.editMode);
  const selection = useEditorStore((s) => s.selection);
  const view = useEditorStore((s) => s.viewByMode.viewport);
  const brushSize = useEditorStore((s) => s.brushSize);
  // 7.B integration: brush type + target weight + per-tick strength.
  // Audit fix G-1 + G-4 + D-6: brushStrength replaces the hardcoded
  // `0.5` constants the initial 7.B used in both branches; the N-panel
  // Hardness slider was a misleading affordance (wrote to brushHardness,
  // which is deform-mode only). Now Strength lives in editor state and
  // both Draw + Blur read it.
  const weightPaintBrush = useEditorStore((s) => s.weightPaintBrush);
  const brushWeight = useEditorStore((s) => s.brushWeight);
  const brushStrength = useEditorStore((s) => s.brushStrength);
  const project = useProjectStore((s) => s.project);
  const node = project.nodes.find((n) => n?.id === selection?.[0]) ?? null;
  // 7.B.4 — per-Object X-mirror toggle (schema v34).
  const xMirror = !!node?.weightPaintSettings?.xMirror;
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

  // Per-stroke caches: adjacency (for blur) + mirror vertex map (for
  // xMirror) are stable across all ticks of a stroke since topology
  // doesn't change. Built lazily on first tick that needs them.
  const adjacencyRef = useRef(/** @type {Array<Set<number>>|null} */ (null));
  const mirrorMapRef = useRef(/** @type {Map<number, number>|null} */ (null));

  // Bail unless the overlay should be visible. All hooks (above + the
  // useMemo / useEffect below) ran unconditionally so React's call
  // order stays stable across renders.
  const nodeMesh = node ? getMesh(node, project) : null;
  const active = editMode === 'weightPaint' && !!nodeMesh;

  const vertices = active
    ? /** @type {Array<{x:number,y:number}>} */ (nodeMesh.vertices ?? [])
    : EMPTY_ARRAY;
  const triangles = active
    ? /** @type {number[]} */ (nodeMesh.triangles ?? [])
    : EMPTY_ARRAY;
  const activeName = active ? nodeMesh.activeWeightGroup : null;
  const weightArr = active && activeName && nodeMesh.weightGroups?.[activeName]
    ? nodeMesh.weightGroups[activeName]
    : (active ? (nodeMesh.boneWeights ?? EMPTY_ARRAY) : EMPTY_ARRAY);

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

  // Reset per-stroke caches when the active part / its mesh topology
  // changes. Adjacency / mirror map both depend on `triangles` +
  // `vertices`; clearing on identity change keeps a stale cache from
  // surviving a part swap mid-mode.
  useEffect(() => {
    adjacencyRef.current = null;
    mirrorMapRef.current = null;
  }, [vertices, triangles]);

  if (!active) return null;

  // ── Brush stroke ──────────────────────────────────────────────────

  function ensureAdjacency() {
    if (!adjacencyRef.current) {
      adjacencyRef.current = buildVertexAdjacency(triangles, vertices.length);
    }
    return adjacencyRef.current;
  }

  function ensureMirrorMap() {
    if (!xMirror) return null;
    if (!mirrorMapRef.current) {
      mirrorMapRef.current = buildMirrorVertexMap(
        /** @type {Array<{x:number,y:number}>} */ (/** @type {any} */ (vertices)),
        'x',
      );
    }
    return mirrorMapRef.current;
  }

  /** Compute the affected-vertex set for a brush dab at (sx, sy). */
  function computeAffected(sx, sy) {
    const r = brushSize;
    const r2 = r * r;
    /** @type {Array<{vertexIndex: number, falloff: number}>} */
    const out = [];
    for (let i = 0; i < projected.length; i++) {
      const dx = projected[i].x - sx;
      const dy = projected[i].y - sy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const t = Math.sqrt(d2) / r;
      const fall = (1 + Math.cos(t * Math.PI)) / 2;
      out.push({ vertexIndex: i, falloff: fall });
    }
    return out;
  }

  /** Apply x-mirror to an `updates` list. For each `vertexIndex` with a
   *  mirror pair, push the same `weight` at the mirrored index. Skips
   *  self-mirrored verts (vertices on the axis) — they're already in. */
  function withMirror(updates, mirrorMap) {
    if (!mirrorMap || mirrorMap.size === 0) return updates;
    const out = updates.slice();
    const seen = new Set(updates.map((u) => u.vertexIndex));
    for (const u of updates) {
      const m = mirrorMap.get(u.vertexIndex);
      if (m == null || m === u.vertexIndex) continue;
      if (seen.has(m)) continue;
      out.push({ vertexIndex: m, weight: u.weight });
      seen.add(m);
    }
    return out;
  }

  function flushPaint() {
    rafIdRef.current = null;
    const pending = pendingPaintRef.current;
    pendingPaintRef.current = null;
    if (!pending) return;
    const { sx, sy, erase } = pending;
    const affected = computeAffected(sx, sy);
    if (affected.length === 0) return;

    /** @type {Array<{vertexIndex: number, weight: number}>} */
    let updates;
    if (weightPaintBrush === 'blur') {
      const adjacency = ensureAdjacency();
      updates = computeBlurUpdates({
        currentWeights: weightArr,
        adjacency,
        affected,
        strength: brushStrength,
        // Audit fix D-1: pass triangles so the math uses Blender's
        // face-loop accumulation instead of a unique-neighbor mean.
        triangles,
      });
    } else {
      // 'draw' (default). Lerp toward brushWeight (or 0 with Shift held).
      const target = erase ? 0 : Number(brushWeight);
      const t = Number.isFinite(target) ? Math.max(0, Math.min(1, target)) : 1;
      updates = [];
      for (const a of affected) {
        const cur = finiteOr(weightArr[a.vertexIndex], 0);
        const next = cur + (t - cur) * brushStrength * a.falloff;
        updates.push({ vertexIndex: a.vertexIndex, weight: next });
      }
    }

    const mirrorMap = ensureMirrorMap();
    const finalUpdates = withMirror(updates, mirrorMap);
    if (finalUpdates.length > 0) paintWeightStroke(node.id, finalUpdates);
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
    // MMB / RMB / Alt+LMB / Ctrl+MMB / Ctrl+RMB → viewport pan/zoom.
    // The SVG overlay sits on top of the WebGL canvas with
    // `pointer-events: auto`, so it captures pointer events before
    // CanvasViewport's `onPointerDown` can see them. Without
    // forwarding, MMB-drag in Weight Paint just no-ops (the SVG eats
    // the down event, the canvas never enters pan mode). Forward by
    // dispatching a synthetic `pointerdown` on the canvas — its
    // handler reads the same button/clientX/clientY contract and
    // calls `canvas.setPointerCapture(e.pointerId)`. Pointer capture
    // wins over hit-testing, so every subsequent pointermove /
    // pointerup for THIS pointer flows directly to the canvas, not
    // the SVG. The user finishes their pan, releases the button,
    // returns to LMB-paint with no state cleanup required.
    //
    // Mirrors CanvasViewport's `onPointerDown` button gate
    // (`e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)`).
    if (e.button !== 0 || e.altKey) {
      /** @type {SVGSVGElement} */
      const svg = e.currentTarget;
      const wrap = svg.closest('[data-editor-type="viewport"]');
      /** @type {HTMLCanvasElement|null} */
      const canvas = wrap?.querySelector('canvas') ?? null;
      if (canvas) {
        canvas.dispatchEvent(new PointerEvent('pointerdown', {
          button: e.button,
          buttons: e.buttons,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
          metaKey: e.metaKey,
          bubbles: true,
          cancelable: true,
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          isPrimary: e.isPrimary,
          pressure: e.pressure,
        }));
      }
      // Don't preventDefault, don't setPointerCapture, don't enter
      // paint mode — the canvas now owns this pointer.
      return;
    }
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
      data-overlay="weightPaint"
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
        {' · '}{weightPaintBrush}
        {weightPaintBrush === 'draw' ? ` · w=${brushWeight.toFixed(2)}` : ''}
        {xMirror ? ' · X-mirror' : ''}
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
    const wa = finiteOr(weightArr[a], 0);
    const wb = finiteOr(weightArr[b], 0);
    const wc = finiteOr(weightArr[c], 0);
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
    const w = finiteOr(weightArr[i], 0);
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
