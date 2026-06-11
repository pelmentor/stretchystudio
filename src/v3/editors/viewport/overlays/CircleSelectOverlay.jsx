// @ts-check
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 6.D — Circle Select modal overlay.
 *
 * Mounts a fullscreen capture layer while `circleSelectStore.active` is
 * true. Renders a cursor-following circle at the current radius and
 * runs paint-time selection on every mousemove while LMB is held.
 *
 * Mirrors Blender's `VIEW3D_OT_select_circle`
 * (`reference/blender/source/blender/editors/space_view3d/view3d_select.cc:5706-5725`
 * operator def + `:5596-5704` exec callback). Audit fix D-10 corrected
 * a pre-existing wrong cite at `:3470+` (which is grease-pencil curves
 * selection, unrelated). Modal lifecycle (mouse handling, radius adjust)
 * lives in
 * `reference/blender/source/blender/windowmanager/intern/wm_gesture_ops.cc:349-447`
 * (`WM_gesture_circle_modal`); the `View3D Gesture Circle` modal map is
 * defined in `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:6232-6246`.
 *
 * Modal interaction:
 *
 *   - mousemove                 → update cursor circle position; if
 *                                 LMB/MMB-held, pick verts/parts under
 *                                 the circle and add/subtract per stroke
 *   - LMB-down                  → start a paint stroke (default add;
 *                                 Shift+LMB-down → subtract)
 *   - MMB-down                  → start a subtract paint stroke (audit
 *                                 D-5 — pen-tablet-friendly subtract;
 *                                 mirrors `blender_default.py:6239`
 *                                 `MIDDLEMOUSE` → `DESELECT` in the
 *                                 `View3D Gesture Circle` modal map)
 *   - LMB/MMB-up                → end the stroke; modal stays active
 *                                 for further strokes (matches Blender)
 *   - mousewheel                → adjust radius. Audit D-1 fix: wheel-up
 *                                 SHRINKS, wheel-down GROWS — matches
 *                                 Blender's `WHEELUPMOUSE = SUBTRACT`
 *                                 binding (`blender_default.py:6241-6243`)
 *                                 and `WM_gesture_circle_modal`'s
 *                                 SUB/ADD application
 *                                 (`wm_gesture_ops.cc:383-390`).
 *                                 Pre-fix the JSDoc claimed the opposite
 *                                 ("Blender convention: wheel up = larger
 *                                 radius"); both the JSDoc claim AND the
 *                                 implementation were wrong.
 *   - Esc / RMB / Enter         → exit the modal
 *   - bare `C`                  → SS-only off-toggle (audit D-8) — exits
 *                                 the modal. Blender's modal map has no
 *                                 `C` binding; the user must press ESC
 *                                 / RIGHTMOUSE / RET. SS adds the
 *                                 affordance to match the activation
 *                                 chord's "toggle" feel. Documented as
 *                                 a deliberate UX deviation per Rule №1.
 *
 * **Per-paint-tick hit-test.** Project the cursor + radius back to
 * canvas-space using the canvas DOM rect + the active edit Viewport's
 * (zoom, pan). For Edit Mode, also project through the part's inverse
 * world matrix to mesh-local space (so the radius scales with the
 * part's transform, just like vertex-click hit-test does).
 *
 * **Audit fix G-3 — paint-stroke caches.** Pre-fix `runPaintTick`
 * called `computeWorldMatrices(project.nodes)` and built a fresh
 * `frameMap` on every mousemove. On a 200-node project at 60 Hz drag
 * that was 60 full tree-walks per second. The matrices are constant
 * within a paint stroke (project not mutated mid-stroke), so we cache
 * them in refs at `startPaint` time and clear at `endPaint`.
 *
 * **No selection rollback on Esc.** Unlike Box Select where Esc cancels
 * everything, Blender's circle select keeps any selection changes made
 * in prior strokes — Esc just exits the modal. This matches the
 * "painting-style" UX where each stroke is an independent operation.
 *
 * @module v3/editors/viewport/overlays/CircleSelectOverlay
 */

import { useCallback, useMemo, useRef } from 'react';
import { useCircleSelectStore } from '../../../../store/circleSelectStore.js';
import { useModalTool } from '../../../modalTool/index.js';
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
import { clientToCanvasXY as clientToCanvas } from '../viewportMath.js';

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

  // Audit fix G-3 — per-stroke caches. `worldMatricesRef` and `frameMapRef`
  // are populated on `startPaint` (mousedown) and cleared on `endPaint`
  // (mouseup). Mid-stroke ticks reuse them instead of rebuilding per
  // mousemove. The project ref is captured too so we can short-circuit if
  // something replaces the project mid-stroke (defensive — shouldn't
  // happen, but cheap to check).
  const worldMatricesRef = useRef(/** @type {Map<string, Float32Array | number[]> | null} */ (null));
  const frameMapRef      = useRef(/** @type {Map<string, Float32Array | number[]> | null} */ (null));
  const cachedProjectRef = useRef(/** @type {any} */ (null));

  // Modal-tool framework registration. The InputDispatcher mounted at
  // AppShell walks the active stack and consults this handler. Returning
  // 'PASS_THROUGH' lets unhandled events (X to delete, etc.) fall to
  // the operator dispatcher — mirrors Blender's `WM_gesture_circle_modal`
  // PASS_THROUGH semantic (`wm_event_system.cc:2725`). Returning
  // 'RUNNING_MODAL' / 'CANCELLED' stops propagation.
  const handleEvent = useCallback(/** @returns {import('../../../modalTool/index.js').useModalToolStore extends never ? never : 'PASS_THROUGH'|'RUNNING_MODAL'|'CANCELLED'|undefined} */ (e) => {
    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      setCursor({ x: me.clientX, y: me.clientY });
      if (paintingRef.current) {
        runPaintTick({
          mode, editPartId,
          cursorClient: { x: me.clientX, y: me.clientY },
          radiusPx: radiusRef.current,
          paintMode: paintModeRef.current ?? 'add',
          worldMatricesRef, frameMapRef, cachedProjectRef,
        });
      }
      // Mousemove passes through — other modals (none currently) and
      // native handlers (cursor visualizations etc.) still need it.
      return 'PASS_THROUGH';
    }

    if (e.type === 'mousedown') {
      const me = /** @type {MouseEvent} */ (e);
      // Audit fix D-5 — accept LMB (button 0) AND MMB (button 1).
      // MMB starts a subtract stroke directly (Blender's pen-tablet
      // friendly subtract path: `blender_default.py:6239`
      // `MIDDLEMOUSE` → `DESELECT`). LMB respects Shift for subtract.
      /** @type {'add'|'subtract'} */
      let pm;
      if (me.button === 0)      pm = me.shiftKey ? 'subtract' : 'add';
      else if (me.button === 1) pm = 'subtract';
      else                       return 'PASS_THROUGH';
      e.preventDefault();
      // Audit fix G-3 — populate the per-stroke caches once. Subsequent
      // mousemove ticks read these refs instead of rebuilding.
      cachedProjectRef.current = useProjectStore.getState().project;
      worldMatricesRef.current = computeWorldMatrices(cachedProjectRef.current.nodes);
      frameMapRef.current = null;
      startPaint(pm);
      runPaintTick({
        mode, editPartId,
        cursorClient: { x: me.clientX, y: me.clientY },
        radiusPx: radiusRef.current,
        paintMode: pm,
        worldMatricesRef, frameMapRef, cachedProjectRef,
      });
      return 'RUNNING_MODAL';
    }

    if (e.type === 'mouseup') {
      const me = /** @type {MouseEvent} */ (e);
      if (me.button !== 0 && me.button !== 1) return 'PASS_THROUGH';
      e.preventDefault();
      // Clear caches so a stale matrix doesn't leak into the next stroke.
      worldMatricesRef.current = null;
      frameMapRef.current = null;
      cachedProjectRef.current = null;
      endPaint();
      return 'RUNNING_MODAL';
    }

    if (e.type === 'wheel') {
      const we = /** @type {WheelEvent} */ (e);
      e.preventDefault();
      // Audit fix D-1 — Blender's `View3D Gesture Circle` modal map
      // binds `WHEELUPMOUSE = SUBTRACT` (shrink) and `WHEELDOWNMOUSE = ADD`
      // (grow). `deltaY < 0` is wheel-up on most browsers → SHRINK.
      const dir = we.deltaY < 0 ? -1 : +1;
      setRadius(radiusRef.current + dir * WHEEL_RADIUS_STEP_PX);
      return 'RUNNING_MODAL';
    }

    if (e.type === 'contextmenu') {
      e.preventDefault();
      cancel();
      return 'CANCELLED';
    }

    if (e.type === 'keydown') {
      const ke = /** @type {KeyboardEvent} */ (e);
      if (ke.key === 'Escape' || ke.key === 'Enter') {
        e.preventDefault();
        cancel();
        return 'CANCELLED';
      }
      // SS-only off-toggle (audit D-8): bare `C` re-toggles Circle
      // Select OFF. Blender's modal map has no `C` binding — but the
      // affordance matches the activation chord's "toggle" feel.
      if (ke.code === 'KeyC' && !ke.ctrlKey && !ke.metaKey && !ke.altKey && !ke.shiftKey) {
        e.preventDefault();
        cancel();
        return 'CANCELLED';
      }
      // Everything else: pass through. X / Delete / G / R / S / B / I /
      // Ctrl+Z all reach the operator dispatcher and run while
      // circle-select stays armed. Mirrors Blender's
      // `View3D Gesture Circle` modal map at `blender_default.py:6229-6246`
      // where only the enumerated events are owned; everything else
      // returns `OPERATOR_PASS_THROUGH` from `WM_gesture_circle_modal`
      // (`wm_event_system.cc:2725`). User 2026-06-11: "i select then
      // press x — nothing happens until i exit that tool."
      return 'PASS_THROUGH';
    }

    return 'PASS_THROUGH';
  }, [mode, editPartId, setCursor, setRadius, startPaint, endPaint, cancel]);

  useModalTool({ id: 'circleSelect', isActive: active, handleEvent });

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
 * Audit fix G-3 — accepts per-stroke caches (`worldMatricesRef`,
 * `frameMapRef`, `cachedProjectRef`) so the mid-stroke ticks reuse the
 * matrices computed at stroke-start instead of re-walking the node tree
 * per mousemove. Defensive fallback: if the cached project ref doesn't
 * match the live project (something replaced the project mid-stroke),
 * recompute on the fly.
 *
 * @param {Object} args
 * @param {'object'|'edit'} args.mode
 * @param {string|null} args.editPartId
 * @param {{x:number, y:number}} args.cursorClient
 * @param {number} args.radiusPx           - viewport-px
 * @param {'add'|'subtract'} args.paintMode
 * @param {{current:Map<string, Float32Array|number[]>|null}} [args.worldMatricesRef]
 * @param {{current:Map<string, Float32Array|number[]>|null}} [args.frameMapRef]
 * @param {{current:any}} [args.cachedProjectRef]
 */
function runPaintTick({
  mode, editPartId, cursorClient, radiusPx, paintMode,
  worldMatricesRef, frameMapRef, cachedProjectRef,
}) {
  const ctxBridge = useCaptureStore.getState().getCanvasHitContext;
  const ctx = typeof ctxBridge === 'function' ? ctxBridge() : null;
  const canvasEl = ctx?.canvasEl ?? null;
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const view = useEditorStore.getState().viewByMode.viewport;
  const project = useProjectStore.getState().project;
  const frames = ctx?.frames ?? null;
  const finalVertsByPartId = ctx?.finalVertsByPartId ?? null;

  // Audit fix G-3 — read worldMatrices from the stroke cache when
  // available + the cached project still matches the live project.
  // Otherwise compute fresh (covers test paths and the defensive
  // mid-stroke project-replacement case).
  const cacheValid = cachedProjectRef?.current === project;
  let worldMatrices = (cacheValid && worldMatricesRef?.current) ? worldMatricesRef.current : null;
  if (!worldMatrices) {
    worldMatrices = computeWorldMatrices(project.nodes);
    if (worldMatricesRef) worldMatricesRef.current = worldMatrices;
    if (cachedProjectRef) cachedProjectRef.current = project;
  }

  const [cxCanvas, cyCanvas] = clientToCanvas(rect, view, cursorClient.x, cursorClient.y);
  // viewport-px radius → canvas-px radius: divide by zoom (matches box
  // select's coord transform; both convert width-like quantities by /zoom).
  const radiusCanvas = radiusPx / view.zoom;

  if (mode === 'object') {
    const pickedIds = partsInCircle(
      project, frames, cxCanvas, cyCanvas, radiusCanvas,
      { worldMatrices, finalVertsByPartId },
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
  const wm = worldMatrices.get(editPartId) ?? mat3Identity();
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
