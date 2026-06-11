// @ts-check
/* eslint-disable react/prop-types */

/**
 * Toolset Phase 1 — Modal box / lasso select overlay.
 *
 * Mounts a fullscreen capture layer while `boxSelectStore.kind` is set
 * (`'box'` or `'lasso'`). Renders the in-progress shape and runs the
 * actual selection on commit:
 *
 *   - LMB-down anywhere       → start the rect/lasso (state already
 *                               seeded by the operator that opened
 *                               the modal; we just confirm the
 *                               anchor on first mousedown if the
 *                               operator's startClient was a stale
 *                               cursor read)
 *   - mousemove               → update rect / append to lasso
 *   - LMB-up                  → commit (replace by default; Shift =
 *                               add to selection; Ctrl = subtract)
 *   - Esc / right-click       → cancel (no selection change)
 *
 * The operator captures `mode` ('object' | 'edit') and `editPartId`
 * at activation, so a mode change mid-drag doesn't redirect the
 * commit target.
 *
 * Hit-test runs against the canvas-space rect / polygon. We project
 * the modal's viewport-px points back into canvas space using the
 * canvas's bounding rect + the EDIT viewport's `view` (zoom/pan) —
 * box / lasso select is an editor operator and we never want it to
 * write while the user is on the Live Preview tab. The CanvasArea
 * mode-prop gates the overlay mount to the edit Viewport already
 * (`!isPreview`), so this is consistent.
 *
 * @module v3/editors/viewport/overlays/BoxSelectOverlay
 */

import { useEffect, useMemo, useRef } from 'react';
import { useBoxSelectStore } from '../../../../store/boxSelectStore.js';
import { useEditorStore } from '../../../../store/editorStore.js';
import { useProjectStore } from '../../../../store/projectStore.js';
import { useSelectionStore } from '../../../../store/selectionStore.js';
import { useCaptureStore } from '../../../../store/captureStore.js';
import {
  partsInRect,
  partsInPolygon,
  verticesInRect,
  verticesInPolygon,
} from '../../../../io/hitTest.js';
import { computeWorldMatrices, mat3Inverse, mat3Identity } from '../../../../renderer/transforms.js';
import { getMesh, isMeshedPart } from '../../../../store/objectDataAccess.js';
import { clientToCanvasXY as clientToCanvas } from '../viewportMath.js';

export function BoxSelectOverlay() {
  const kind            = useBoxSelectStore((s) => s.kind);
  const mode            = useBoxSelectStore((s) => s.mode);
  const editPartId      = useBoxSelectStore((s) => s.editPartId);
  const startClient     = useBoxSelectStore((s) => s.startClient);
  const currentClient   = useBoxSelectStore((s) => s.currentClient);
  const pathClient      = useBoxSelectStore((s) => s.pathClient);
  const gestureModifier = useBoxSelectStore((s) => s.gestureModifier);
  const anchor          = useBoxSelectStore((s) => s.anchor);
  const update          = useBoxSelectStore((s) => s.update);
  const commit          = useBoxSelectStore((s) => s.commit);
  const cancel          = useBoxSelectStore((s) => s.cancel);

  // Snapshot view for projection at commit. The store reads viewByMode
  // by ref so the overlay sees the same numbers CanvasViewport draws
  // with on the edit Viewport tab. Lasso also uses it on every move
  // for the polygon-in-canvas-space rasterisation, but we read fresh
  // each tick rather than caching.
  const viewRef = useRef(useEditorStore.getState().viewByMode.viewport);
  useEffect(() => {
    viewRef.current = useEditorStore.getState().viewByMode.viewport;
  }, [kind]);

  useEffect(() => {
    if (!kind) return;

    function onMouseDown(e) {
      // Box-select armed-but-not-anchored phase: first LMB-down anchors
      // the box at the click point and transitions the modal to dragging.
      // Mirrors Blender's `Gesture Box` modal map `BEGIN` action firing
      // on LEFTMOUSE PRESS (blender_default.py:6265). For lasso, the
      // Ctrl+LMB-drag invoker already anchored via `begin()` so this is
      // a no-op (startClient is already set).
      if (e.button !== 0) return;
      if (kind === 'box' && !startClient) {
        e.preventDefault();
        e.stopPropagation();
        anchor({ x: e.clientX, y: e.clientY });
      }
    }

    function onMouseMove(e) {
      // Skip moves before the click anchor — armed-but-not-anchored
      // phase shows nothing; first cursor update happens at anchor time.
      if (!startClient) return;
      update({ x: e.clientX, y: e.clientY });
    }

    function onMouseUp(e) {
      if (e.button !== 0) return;
      // LMB-up before anchor (impossible normally, but defensive) is a
      // no-op — there's nothing to commit.
      if (!startClient) return;
      e.preventDefault();
      // Phase 1.B-fix — for lasso, Ctrl is the gesture-starter so it
      // can't double as a commit-time modifier. Use the modifier
      // captured at gesture start (`gestureModifier`); fall back to
      // commit-time read for box (where modifiers are pure compose).
      const modifier = kind === 'lasso'
        ? (gestureModifier ?? (e.shiftKey ? 'add' : 'replace'))
        : (e.shiftKey ? 'add' : (e.ctrlKey || e.metaKey) ? 'subtract' : 'replace');
      runCommit({
        kind, mode, editPartId, startClient,
        endClient: { x: e.clientX, y: e.clientY },
        pathClient,
        modifier,
      });
      commit();
    }

    function onContextMenu(e) {
      e.preventDefault();
      cancel();
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
        return;
      }
      // Toolset Phase 1.A — mid-drag A toggles "select all under" semantics
      // (Blender pattern). Object Mode → select every visible part; Edit
      // Mode → select every vertex of the active part. Modifier respected
      // (Shift = add to existing selection; Ctrl = subtract from it).
      if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const selectAllModifier = e.shiftKey ? 'add' : 'replace';
        runSelectAllUnder({ mode, editPartId, modifier: selectAllModifier });
        cancel();
      }
    }

    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('mousemove', onMouseMove, { capture: true });
    window.addEventListener('mouseup', onMouseUp, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('mousemove', onMouseMove, { capture: true });
      window.removeEventListener('mouseup', onMouseUp, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [kind, mode, editPartId, startClient, pathClient, gestureModifier, anchor, update, commit, cancel]);

  // Compute the visible rect / path in viewport-px once per render.
  const drawn = useMemo(() => {
    if (!kind || !startClient || !currentClient) return null;
    if (kind === 'box') {
      const x1 = Math.min(startClient.x, currentClient.x);
      const y1 = Math.min(startClient.y, currentClient.y);
      const x2 = Math.max(startClient.x, currentClient.x);
      const y2 = Math.max(startClient.y, currentClient.y);
      return { kind: 'box', x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    if (kind === 'lasso') {
      // Build an SVG points string. Append currentClient so the path
      // stays anchored to the live cursor (the store appends to
      // pathClient only when the cursor moves more than 1px to keep
      // the polygon clean, but the visual should still chase).
      const pts = pathClient.length > 0
        ? [...pathClient, currentClient]
        : [currentClient];
      return { kind: 'lasso', points: pts.map((p) => `${p.x},${p.y}`).join(' ') };
    }
    return null;
  }, [kind, startClient, currentClient, pathClient]);

  if (!kind || !drawn) return null;

  return (
    <svg
      className="fixed inset-0 z-[150] pointer-events-none"
      style={{ width: '100vw', height: '100vh' }}
      aria-hidden
    >
      {drawn.kind === 'box' ? (
        <rect
          x={drawn.x}
          y={drawn.y}
          width={drawn.w}
          height={drawn.h}
          fill="hsl(25 95% 55% / 0.10)"
          stroke="hsl(25 95% 55%)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      ) : (
        <polyline
          points={drawn.points}
          fill="hsl(25 95% 55% / 0.10)"
          stroke="hsl(25 95% 55%)"
          strokeWidth={1}
          strokeDasharray="4 3"
        />
      )}
    </svg>
  );
}

/**
 * Run the actual selection on commit. Pulled out of the React effect
 * so a future programmatic commit (e.g. typed coords, future
 * `selection.boxSelectAll`) can reuse the same dispatch.
 *
 * @param {Object} args
 * @param {'box'|'lasso'} args.kind
 * @param {'object'|'edit'} args.mode
 * @param {string|null} args.editPartId
 * @param {{x:number, y:number}} args.startClient
 * @param {{x:number, y:number}} args.endClient
 * @param {Array<{x:number, y:number}>} args.pathClient
 * @param {'replace'|'add'|'subtract'} args.modifier
 */
function runCommit({ kind, mode, editPartId, startClient, endClient, pathClient, modifier }) {
  const ctxBridge = useCaptureStore.getState().getCanvasHitContext;
  const ctx = typeof ctxBridge === 'function' ? ctxBridge() : null;
  const canvasEl = ctx?.canvasEl ?? null;
  if (!canvasEl) return;
  const rect = canvasEl.getBoundingClientRect();
  const view = useEditorStore.getState().viewByMode.viewport;

  const project = useProjectStore.getState().project;
  const frames = ctx?.frames ?? null;
  const finalVertsByPartId = ctx?.finalVertsByPartId ?? null;

  if (mode === 'object') {
    let pickedIds = /** @type {string[]} */ ([]);
    if (kind === 'box') {
      const [x1, y1] = clientToCanvas(rect, view, startClient.x, startClient.y);
      const [x2, y2] = clientToCanvas(rect, view, endClient.x, endClient.y);
      // Don't fire on a dimensionless drag (single click in modal is
      // a no-op; that's deliberate — Blender's box-select also drops
      // the keystroke if the user clicks without dragging).
      if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) < 1) return;
      pickedIds = partsInRect(
        project, frames,
        Math.min(x1, x2), Math.min(y1, y2),
        Math.max(x1, x2), Math.max(y1, y2),
        { worldMatrices: computeWorldMatrices(project.nodes), finalVertsByPartId },
      );
    } else {
      // Lasso: project polygon path back to canvas space.
      if (pathClient.length < 3) return;
      const polyXs = new Array(pathClient.length);
      const polyYs = new Array(pathClient.length);
      for (let i = 0; i < pathClient.length; i++) {
        const [cx, cy] = clientToCanvas(rect, view, pathClient[i].x, pathClient[i].y);
        polyXs[i] = cx;
        polyYs[i] = cy;
      }
      pickedIds = partsInPolygon(
        project, frames, polyXs, polyYs,
        { worldMatrices: computeWorldMatrices(project.nodes), finalVertsByPartId },
      );
    }
    applyObjectSelection(pickedIds, modifier);
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

  /** Project a viewport-px point through canvas → local space. */
  function clientToLocal(client) {
    const [wx, wy] = clientToCanvas(rect, view, client.x, client.y);
    const lx = iwm[0] * wx + iwm[3] * wy + iwm[6];
    const ly = iwm[1] * wx + iwm[4] * wy + iwm[7];
    return [lx, ly];
  }

  let pickedIdx = /** @type {number[]} */ ([]);
  if (kind === 'box') {
    const [x1, y1] = clientToLocal(startClient);
    const [x2, y2] = clientToLocal(endClient);
    if (Math.abs(x2 - x1) < 1 && Math.abs(y2 - y1) < 1) return;
    pickedIdx = verticesInRect(
      mesh.vertices,
      Math.min(x1, x2), Math.min(y1, y2),
      Math.max(x1, x2), Math.max(y1, y2),
    );
  } else {
    if (pathClient.length < 3) return;
    const polyXs = new Array(pathClient.length);
    const polyYs = new Array(pathClient.length);
    for (let i = 0; i < pathClient.length; i++) {
      const [lx, ly] = clientToLocal(pathClient[i]);
      polyXs[i] = lx;
      polyYs[i] = ly;
    }
    pickedIdx = verticesInPolygon(mesh.vertices, polyXs, polyYs);
  }

  applyEditVertexSelection(editPartId, pickedIdx, modifier);
}

/**
 * Mutate Object-Mode selection per modifier. Mirrors the universal
 * `selectionStore` API plus the legacy `editorStore.selection` slot
 * (Properties / GizmoOverlay still read from the latter).
 *
 * @param {string[]} pickedIds
 * @param {'replace'|'add'|'subtract'} modifier
 */
function applyObjectSelection(pickedIds, modifier) {
  const sel = useSelectionStore.getState();
  const editor = useEditorStore.getState();
  if (modifier === 'replace') {
    if (pickedIds.length === 0) {
      sel.clear();
      editor.setSelection([]);
      return;
    }
    sel.select(pickedIds.map((id) => ({ type: 'part', id })), 'replace');
    editor.setSelection([pickedIds[pickedIds.length - 1]]);
    return;
  }
  if (modifier === 'add') {
    if (pickedIds.length === 0) return;
    sel.select(pickedIds.map((id) => ({ type: 'part', id })), 'add');
    const active = sel.getActive();
    editor.setSelection(active && active.type === 'part' ? [active.id] : editor.selection);
    return;
  }
  // subtract — remove only matching ids without dropping unmatched.
  if (pickedIds.length === 0) return;
  const pickedSet = new Set(pickedIds);
  const remaining = sel.items.filter((it) => !(it.type === 'part' && pickedSet.has(it.id)));
  sel.select(remaining.length > 0 ? remaining : [], 'replace');
  const active = sel.getActive();
  editor.setSelection(active && active.type === 'part' ? [active.id] : []);
}

/**
 * Mutate Edit-Mode vertex selection per modifier. The active vertex
 * pointer follows the last-picked index in `pickedIdx` so the user's
 * white-bordered active mark lands on a vertex they actually selected.
 *
 * @param {string} partId
 * @param {number[]} pickedIdx
 * @param {'replace'|'add'|'subtract'} modifier
 */
function applyEditVertexSelection(partId, pickedIdx, modifier) {
  const editor = useEditorStore.getState();
  const cur = editor.selectedVertexIndices.get(partId) ?? new Set();
  let next;
  if (modifier === 'replace') next = new Set(pickedIdx);
  else if (modifier === 'add') {
    next = new Set(cur);
    for (const i of pickedIdx) next.add(i);
  } else {
    next = new Set(cur);
    for (const i of pickedIdx) next.delete(i);
  }
  editor.setVertexSelectionForPart(partId, next);
  // Active vertex: prefer the last picked when add/replace; on
  // subtract, drop active if it was just removed (deselectVertex
  // is the only action that touches activeVertex on its own — the
  // bulk setVertexSelectionForPart leaves activeVertex untouched).
  if (modifier !== 'subtract' && pickedIdx.length > 0) {
    editor.selectVertex(partId, pickedIdx[pickedIdx.length - 1], /* additive */ true);
  } else if (modifier === 'subtract'
             && editor.activeVertex?.partId === partId
             && !next.has(editor.activeVertex.vertIndex)) {
    editor.deselectVertex(partId, editor.activeVertex.vertIndex);
  }
}

/**
 * Toolset Phase 1.A — mid-drag `A` "select all under" semantics.
 * Object Mode → every visible meshed part; Edit Mode → every vertex
 * of the active part. Modifier composes against the existing
 * selection (Shift = add; default = replace).
 *
 * @param {Object} args
 * @param {'object'|'edit'} args.mode
 * @param {string|null} args.editPartId
 * @param {'replace'|'add'} args.modifier
 */
function runSelectAllUnder({ mode, editPartId, modifier }) {
  const project = useProjectStore.getState().project;
  if (mode === 'object') {
    const ids = (project?.nodes ?? [])
      .filter((n) => n?.type === 'part' && n.visible !== false)
      .map((n) => n.id);
    applyObjectSelection(ids, modifier);
    return;
  }
  if (!editPartId) return;
  const node = project.nodes.find((n) => n?.id === editPartId);
  if (!node) return;
  const mesh = getMesh(node, project);
  if (!mesh || !Array.isArray(mesh.vertices) || mesh.vertices.length === 0) return;
  const allIdx = Array.from({ length: mesh.vertices.length }, (_, i) => i);
  applyEditVertexSelection(editPartId, allIdx, modifier);
}
