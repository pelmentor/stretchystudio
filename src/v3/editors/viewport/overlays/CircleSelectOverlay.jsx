// @ts-check
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 6.D — Circle Select modal overlay.
 *
 * Mounts a fullscreen capture layer while `circleSelectStore.active` is
 * true. Renders a cursor-following circle at the current radius and
 * runs paint-time selection on every mousemove while LMB is held.
 *
 * Mirrors Blender's `VIEW3D_OT_select_circle` (`reference/blender/source/blender/editors/space_view3d/view3d_select.cc:3470+`).
 * Modal interaction:
 *
 *   - mousemove                 → update cursor circle position; if
 *                                 LMB-held, pick verts/parts under the
 *                                 circle and add/subtract per paint mode
 *   - LMB-down                  → start a paint stroke (default add;
 *                                 Shift+LMB-down → subtract)
 *   - LMB-up                    → end the stroke; modal stays active
 *                                 for further strokes (matches Blender)
 *   - mousewheel                → adjust radius (Blender pattern)
 *   - Esc / RMB / Enter         → exit the modal
 *
 * **Per-paint-tick hit-test.** Project the cursor + radius back to
 * canvas-space using the canvas DOM rect + the active edit Viewport's
 * (zoom, pan). For Edit Mode, also project through the part's inverse
 * world matrix to mesh-local space (so the radius scales with the
 * part's transform, just like vertex-click hit-test does).
 *
 * **No selection rollback on Esc.** Unlike Box Select where Esc cancels
 * everything, Blender's circle select keeps any selection changes made
 * in prior strokes — Esc just exits the modal. This matches the
 * "painting-style" UX where each stroke is an independent operation.
 *
 * @module v3/editors/viewport/overlays/CircleSelectOverlay
 */

import { useEffect, useMemo, useRef } from 'react';
import { useCircleSelectStore } from '../../../../store/circleSelectStore.js';
import { useEditorStore } from '../../../../store/editorStore.js';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';
import { useCaptureStore } from '../../../../store/captureStore.js';
import {
  partsInCircle,
  verticesInCircle,
} from '../../../../io/hitTest.js';
import {
  computeWorldMatrices,
  mat3Inverse,
  mat3Identity,
} from '../../../../renderer/transforms.js';
import { getMesh, isMeshedPart } from '../../../../store/objectDataAccess.js';

/** Convert a viewport-px point to canvas-space using a canvas bounding
 *  rect + (zoom, pan). Mirrors `BoxSelectOverlay`'s helper. */
function clientToCanvas(rect, view, clientX, clientY) {
  const cx = (clientX - rect.left) / view.zoom - view.panX / view.zoom;
  const cy = (clientY - rect.top)  / view.zoom - view.panY / view.zoom;
  return [cx, cy];
}

const WHEEL_RADIUS_STEP_PX = 4;

export function CircleSelectOverlay() {
  const active        = useCircleSelectStore((s) => s.active);
  const mode          = useCircleSelectStore((s) => s.mode);
  const editPartId    = useCircleSelectStore((s) => s.editPartId);
  const cursorClient  = useCircleSelectStore((s) => s.cursorClient);
  const radiusPx      = useCircleSelectStore((s) => s.radiusPx);
  const painting      = useCircleSelectStore((s) => s.painting);
  const paintMode     = useCircleSelectStore((s) => s.paintMode);
  const setCursor     = useCircleSelectStore((s) => s.setCursor);
  const setRadius     = useCircleSelectStore((s) => s.setRadius);
  const startPaint    = useCircleSelectStore((s) => s.startPaint);
  const endPaint      = useCircleSelectStore((s) => s.endPaint);
  const cancel        = useCircleSelectStore((s) => s.cancel);

  // Snapshot current paint state in a ref so the mousemove handler can
  // read the fresh value without re-binding the listener (which would
  // tear down the capture).
  const paintingRef  = useRef(painting);
  const paintModeRef = useRef(paintMode);
  const radiusRef    = useRef(radiusPx);
  paintingRef.current  = painting;
  paintModeRef.current = paintMode;
  radiusRef.current    = radiusPx;

  useEffect(() => {
    if (!active) return;

    function onMouseMove(e) {
      setCursor({ x: e.clientX, y: e.clientY });
      if (paintingRef.current) {
        runPaintTick({
          mode, editPartId,
          cursorClient: { x: e.clientX, y: e.clientY },
          radiusPx: radiusRef.current,
          paintMode: paintModeRef.current ?? 'add',
        });
      }
    }

    function onMouseDown(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      // Shift held at LMB-down → subtract for the duration of the stroke.
      // Plain LMB-down → add. Captured at stroke start so a mid-stroke
      // Shift release doesn't switch the mode.
      const pm = e.shiftKey ? 'subtract' : 'add';
      startPaint(pm);
      // Fire one immediate tick so a click without drag still selects
      // under the circle.
      runPaintTick({
        mode, editPartId,
        cursorClient: { x: e.clientX, y: e.clientY },
        radiusPx: radiusRef.current,
        paintMode: pm,
      });
    }

    function onMouseUp(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      endPaint();
    }

    function onWheel(e) {
      e.preventDefault();
      e.stopPropagation();
      // Blender convention: wheel up = larger radius, wheel down =
      // smaller. `deltaY < 0` is wheel up on most browsers.
      const dir = e.deltaY < 0 ? +1 : -1;
      setRadius(radiusRef.current + dir * WHEEL_RADIUS_STEP_PX);
    }

    function onContextMenu(e) {
      e.preventDefault();
      cancel();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape' || e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
      // Match Blender: bare `C` re-toggles out of Circle Select.
      if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        cancel();
        return;
      }
    }

    window.addEventListener('mousemove', onMouseMove, { capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mouseup', onMouseUp, { capture: true });
    window.addEventListener('wheel', onWheel, { capture: true, passive: false });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove, { capture: true });
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('mouseup', onMouseUp, { capture: true });
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [active, mode, editPartId, setCursor, setRadius, startPaint, endPaint, cancel]);

  const drawn = useMemo(() => {
    if (!active || !cursorClient) return null;
    return { cx: cursorClient.x, cy: cursorClient.y, r: radiusPx };
  }, [active, cursorClient, radiusPx]);

  if (!active || !drawn) return null;

  // Stroke colour swaps when subtracting so the user sees what mode
  // they're in mid-stroke.
  const stroke = paintMode === 'subtract' ? 'hsl(0 80% 60%)' : 'hsl(25 95% 55%)';

  return (
    <svg
      className="fixed inset-0 z-[150] pointer-events-none"
      style={{ width: '100vw', height: '100vh' }}
      aria-hidden
    >
      <circle
        cx={drawn.cx}
        cy={drawn.cy}
        r={drawn.r}
        fill="none"
        stroke={stroke}
        strokeWidth={1}
        strokeDasharray="4 3"
      />
    </svg>
  );
}

/**
 * Run one paint tick: pick verts (Edit Mode) or parts (Object Mode) under
 * the cursor circle and apply per `paintMode` ('add' or 'subtract').
 *
 * @param {Object} args
 * @param {'object'|'edit'} args.mode
 * @param {string|null} args.editPartId
 * @param {{x:number, y:number}} args.cursorClient
 * @param {number} args.radiusPx           - viewport-px
 * @param {'add'|'subtract'} args.paintMode
 */
function runPaintTick({ mode, editPartId, cursorClient, radiusPx, paintMode }) {
  const ctxBridge = useCaptureStore.getState().getCanvasHitContext;
  const ctx = typeof ctxBridge === 'function' ? ctxBridge() : null;
  const canvasEl = ctx?.canvasEl ?? null;
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const view = useEditorStore.getState().viewByMode.viewport;
  const project = useProjectStore.getState().project;
  const frames = ctx?.frames ?? null;
  const finalVertsByPartId = ctx?.finalVertsByPartId ?? null;

  const [cxCanvas, cyCanvas] = clientToCanvas(rect, view, cursorClient.x, cursorClient.y);
  // viewport-px radius → canvas-px radius: divide by zoom (matches box
  // select's coord transform; both convert width-like quantities by /zoom).
  const radiusCanvas = radiusPx / view.zoom;

  if (mode === 'object') {
    const pickedIds = partsInCircle(
      project, frames, cxCanvas, cyCanvas, radiusCanvas,
      { worldMatrices: computeWorldMatrices(project.nodes), finalVertsByPartId },
    );
    if (pickedIds.length === 0) return;
    applyObjectSelectionDelta(pickedIds, paintMode);
    return;
  }

  // Edit mode — vertex selection on the captured part.
  if (!editPartId) return;
  const node = project.nodes.find((n) => n?.id === editPartId);
  if (!node || !isMeshedPart(node, project)) return;
  const mesh = getMesh(node, project);
  if (!mesh || !Array.isArray(mesh.vertices) || mesh.vertices.length === 0) return;
  const wm = computeWorldMatrices(project.nodes).get(editPartId) ?? mat3Identity();
  const iwm = mat3Inverse(wm);
  // Project canvas-space center to mesh-local space.
  const lx = iwm[0] * cxCanvas + iwm[3] * cyCanvas + iwm[6];
  const ly = iwm[1] * cxCanvas + iwm[4] * cyCanvas + iwm[7];
  // Local-space radius: the inverse world matrix may include scale.
  // Approximate the local radius by scaling canvas radius by the
  // linear part of `iwm` — taking the geometric mean of column lengths
  // gives a reasonable scalar even under non-uniform scale (matches the
  // approximation already in vertex hit-test snapping).
  const sx = Math.hypot(iwm[0], iwm[1]);
  const sy = Math.hypot(iwm[3], iwm[4]);
  const localScale = Math.sqrt(sx * sy);
  const localRadius = radiusCanvas * localScale;
  const pickedIdx = verticesInCircle(mesh.vertices, lx, ly, localRadius);
  if (pickedIdx.length === 0) return;
  applyEditVertexSelectionDelta(editPartId, pickedIdx, paintMode);
}

/**
 * Object-Mode paint delta: add or subtract pickedIds from the selection.
 * Always additive within a single paint tick — replace mode is never
 * used for circle paint (it'd thrash selection between strokes).
 *
 * @param {string[]} pickedIds
 * @param {'add'|'subtract'} paintMode
 */
function applyObjectSelectionDelta(pickedIds, paintMode) {
  if (pickedIds.length === 0) return;
  const sel = useSelectionStore.getState();
  const editor = useEditorStore.getState();
  if (paintMode === 'add') {
    sel.select(pickedIds.map((id) => ({ type: 'part', id })), 'add');
    const active = sel.getActive();
    editor.setSelection(active && active.type === 'part' ? [active.id] : editor.selection);
    return;
  }
  // Subtract — remove only matching ids without dropping unmatched.
  const pickedSet = new Set(pickedIds);
  const remaining = sel.items.filter((it) => !(it.type === 'part' && pickedSet.has(it.id)));
  sel.select(remaining.length > 0 ? remaining : [], 'replace');
  const active = sel.getActive();
  editor.setSelection(active && active.type === 'part' ? [active.id] : []);
}

/**
 * Edit-Mode paint delta: add or subtract pickedIdx from the part's
 * vertex selection. Active vertex follows the last picked when adding;
 * cleared when its index is removed by subtract.
 *
 * @param {string} partId
 * @param {number[]} pickedIdx
 * @param {'add'|'subtract'} paintMode
 */
function applyEditVertexSelectionDelta(partId, pickedIdx, paintMode) {
  if (pickedIdx.length === 0) return;
  const editor = useEditorStore.getState();
  const cur = editor.selectedVertexIndices.get(partId) ?? new Set();
  let next;
  if (paintMode === 'add') {
    next = new Set(cur);
    for (const i of pickedIdx) next.add(i);
  } else {
    next = new Set(cur);
    for (const i of pickedIdx) next.delete(i);
  }
  editor.setVertexSelectionForPart(partId, next);
  if (paintMode === 'add') {
    editor.selectVertex(partId, pickedIdx[pickedIdx.length - 1], /* additive */ true);
  } else if (editor.activeVertex?.partId === partId
             && !next.has(editor.activeVertex.vertIndex)) {
    editor.deselectVertex(partId, editor.activeVertex.vertIndex);
  }
}
