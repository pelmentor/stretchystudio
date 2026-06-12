// @ts-check
/* eslint-disable react/prop-types */

/**
 * Toolset Plan Phase 5.B — Modal G vertex-translate overlay.
 *
 * Sister to `ModalTransformOverlay` (which is node-level — translates
 * `node.transform` / `node.pose`). This overlay is vertex-level: it
 * captures the per-frame mouse delta and writes it to a Set of vertex
 * positions on a single part, until the user commits or cancels.
 *
 * **Mount.** Active when `useModalVertexTransformStore.getState().kind`
 * is set. Mounted at `AppShell` so the capture layer covers the entire
 * window (modal G hijacks all mouse + key input until commit/cancel).
 *
 * **Per-frame writes.** `updateProject({skipHistory: true})` mutates
 * `mesh.vertices[i].x/y` for each `vertIndices` member. The pre-mutation
 * snapshot was captured by `beginBatch` BEFORE the modal began (Phase 5
 * extrude pattern — extrude opens the batch + runs `applyTopologyOp`,
 * then begins the modal). On commit, `endBatch()` collapses the
 * batch to one undo entry. On cancel + `rollbackOnCancel`,
 * `discardBatch` pops the snapshot AND restores the pre-batch state in
 * one swoop — covers BOTH the topology change AND the partial drag
 * without polluting the redo stack.
 *
 * **Snap exclusion.** When snap-to-vertex is engaged, the dragged
 * verts are EXCLUDED from the snap hash. Otherwise the new (extruded)
 * verts would auto-snap to themselves at t=0 (they start at the source
 * vert positions). Excluding them lets the user drag freely until they
 * approach a different vertex.
 *
 * **Audit D-6 — RMB-to-cancel matches Blender's LMB-select preset.**
 *
 * **Audit D-1 — Esc rolls back the topology change too.** Blender's
 * macro semantics keep the extrude on Esc-mid-translate (see
 * `modalVertexTransformStore.js` banner). SS's `discardBatch`-driven
 * cancel rolls back BOTH the topology AND the drag — atomic gesture
 * behaviour, deliberate UX deviation per Rule №1.
 *
 * # Modal-tool framework migration (Phase 2.B, 2026-06-12)
 *
 * Sister migration to Phase 2.A (ModalTransformOverlay). Replaces
 * 5x `window.addEventListener` with a single `useModalTool` registration.
 * Owns most keystrokes (RUNNING_MODAL on unrecognised keys) so stray
 * `KeyE` / `KeyG` / `KeyR` / `KeyS` / `KeyB` / `KeyM` can't start a
 * competing modal mid-drag. See `src/v3/modalTool/` for framework
 * substrate; `wm_event_system.cc:2617-2747` for Blender's modal-handler
 * stack.
 *
 * @module v3/shell/ModalVertexTransformOverlay
 */

import { useCallback, useEffect, useRef } from 'react';
import { useModalVertexTransformStore } from '../../store/modalVertexTransformStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { endBatch, discardBatch } from '../../store/undoHistory.js';
import { getSceneRef } from '../../lib/sceneRegistry.js';
import { getMesh } from '../../store/objectDataAccess.js';
import { meshSignature } from '../../io/meshSignature.js';
import { useModalTool } from '../modalTool/index.js';
import {
  buildSnapHash,
  enumerateSelectionAnchorVerts,
  pickSelectionAnchor,
  snapDeltaToGrid,
  applyPrecisionToDelta,
  useSnapStore,
} from '../../lib/snap/index.js';

const PRECISION_FREE_TRANSLATE = 0.1;

export function ModalVertexTransformOverlay() {
  const kind             = useModalVertexTransformStore((s) => s.kind);
  const partId           = useModalVertexTransformStore((s) => s.partId);
  const axis             = useModalVertexTransformStore((s) => s.axis);
  const startMouse       = useModalVertexTransformStore((s) => s.startMouse);
  const original         = useModalVertexTransformStore((s) => s.original);
  const vertIndices      = useModalVertexTransformStore((s) => s.vertIndices);
  const rollbackOnCancel = useModalVertexTransformStore((s) => s.rollbackOnCancel);
  const typedBuffer      = useModalVertexTransformStore((s) => s.typedBuffer);

  const lastMouse = useRef({ x: 0, y: 0 });
  const canvasRectRef = useRef(/** @type {DOMRect|null} */ (null));
  const snapHashRef = useRef(/** @type {any} */ (null));
  const anchorVertsRef = useRef(/** @type {any[]} */ ([]));
  const ctrlHeldRef = useRef(false);
  // Audit fix G-5 — cache the Float32Array UVs at modal entry. UVs
  // don't change during a vertex translate (only positions do), so the
  // per-tick re-allocation was pure GC pressure.
  const uvsArrRef = useRef(/** @type {Float32Array|null} */ (null));

  // ── Per-session setup ────────────────────────────────────────────
  //
  // Build snap hash + anchor verts + canvas rect + UV cache on modal
  // entry. Cleanup clears snap target. The `axis` slot is intentionally
  // NOT in deps — axis flips mid-modal (X/Y press) shouldn't rebuild
  // the ~30 ms snap hash. Handler reads axis via getState() inside the
  // useCallback.
  useEffect(() => {
    if (!kind || !partId || !startMouse) return;
    const canvasEl = document.querySelector('canvas');
    canvasRectRef.current = canvasEl?.getBoundingClientRect() ?? null;
    useSnapStore.getState().clearSnapTarget();
    ctrlHeldRef.current = false;

    const project = useProjectStore.getState().project;
    const editor = useEditorStore.getState();
    const selection = useSelectionStore.getState().items ?? [];
    snapHashRef.current = buildSnapHash(project, {
      cellSize: 64,
      excludeVertIndicesByPart: new Map([[partId, vertIndices]]),
    });
    anchorVertsRef.current = enumerateSelectionAnchorVerts(project, selection, {
      editMode: editor.editMode,
      activeVertex: editor.activeVertex,
      selectedVertexIndices: editor.selectedVertexIndices,
    });
    // Audit fix G-5 — snapshot UVs once.
    const node = project?.nodes?.find((n) => n.id === partId);
    const mesh = node ? getMesh(node, project) : null;
    const meshUvs = mesh?.uvs;
    uvsArrRef.current = meshUvs instanceof Float32Array
      ? meshUvs
      : new Float32Array(meshUvs ?? []);

    lastMouse.current = { x: startMouse.x, y: startMouse.y };

    return () => {
      useSnapStore.getState().clearSnapTarget();
    };
  }, [kind, partId, startMouse, vertIndices]);

  // ── Event handler ────────────────────────────────────────────────

  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    if (!kind || !partId || !startMouse) return 'PASS_THROUGH';

    // ── Inner helpers — closed over kind/partId/startMouse/original/vertIndices ─

    function parseTyped(buf) {
      if (typeof buf !== 'string' || buf.length === 0) return NaN;
      const n = Number(buf);
      return Number.isFinite(n) ? n : NaN;
    }

    /** Client (screen) px → canvas-local coords via the active viewport
     *  pan/zoom. */
    function clientToCanvasPt(clientX, clientY) {
      const rect = canvasRectRef.current;
      const ed = useEditorStore.getState();
      const view = ed.viewByMode?.viewport ?? { zoom: 1, panX: 0, panY: 0 };
      const zoom = view.zoom || 1;
      const x = rect ? (clientX - rect.left) / zoom - view.panX / zoom : clientX / zoom;
      const y = rect ? (clientY - rect.top)  / zoom - view.panY / zoom : clientY / zoom;
      return { x, y };
    }

    function applyRotateScale(k, currentX, currentY, shift) {
      // Guard against queued mousemoves after commit/cancel.
      if (useModalVertexTransformStore.getState().kind === null) return;
      const pivot = useModalVertexTransformStore.getState().pivotCanvas;
      if (!pivot) return;
      const curAxis = useModalVertexTransformStore.getState().axis;
      const start = clientToCanvasPt(startMouse.x, startMouse.y);
      const cur = clientToCanvasPt(currentX, currentY);

      const tb = parseTyped(useModalVertexTransformStore.getState().typedBuffer);
      const useTyped = Number.isFinite(tb);

      let cos = 1, sin = 0, sx = 1, sy = 1;
      if (k === 'rotate') {
        let angle;
        if (useTyped) {
          angle = (tb * Math.PI) / 180;
        } else {
          const a0 = Math.atan2(start.y - pivot.y, start.x - pivot.x);
          const a1 = Math.atan2(cur.y - pivot.y, cur.x - pivot.x);
          angle = a1 - a0;
          if (shift) { const step = (5 * Math.PI) / 180; angle = Math.round(angle / step) * step; }
        }
        cos = Math.cos(angle);
        sin = Math.sin(angle);
      } else {
        let factor;
        if (useTyped) {
          factor = tb;
        } else {
          const d0 = Math.hypot(start.x - pivot.x, start.y - pivot.y) || 1e-6;
          const d1 = Math.hypot(cur.x - pivot.x, cur.y - pivot.y);
          factor = d1 / d0;
          if (shift) factor = Math.round(factor * 10) / 10;
        }
        sx = curAxis === 'y' ? 1 : factor;
        sy = curAxis === 'x' ? 1 : factor;
      }

      const updateProject = useProjectStore.getState().updateProject;
      /** @type {any} */ let postMeshVerts = null;
      updateProject((proj) => {
        const node = proj.nodes.find((n) => n.id === partId);
        if (!node) return;
        const mesh = getMesh(node, proj);
        if (!mesh) return;
        for (const idx of vertIndices) {
          const orig = original.get(idx);
          if (!orig) continue;
          if (idx < 0 || idx >= mesh.vertices.length) continue;
          const v = mesh.vertices[idx];
          const px = orig.x - pivot.x;
          const py = orig.y - pivot.y;
          const rpx = (orig.restX ?? orig.x) - pivot.x;
          const rpy = (orig.restY ?? orig.y) - pivot.y;
          if (k === 'rotate') {
            v.x = pivot.x + px * cos - py * sin;
            v.y = pivot.y + px * sin + py * cos;
            v.restX = pivot.x + rpx * cos - rpy * sin;
            v.restY = pivot.y + rpx * sin + rpy * cos;
          } else {
            v.x = pivot.x + px * sx;
            v.y = pivot.y + py * sy;
            v.restX = pivot.x + rpx * sx;
            v.restY = pivot.y + rpy * sy;
          }
        }
        postMeshVerts = mesh.vertices;
      }, { skipHistory: true });

      const scene = getSceneRef();
      if (scene && scene.parts && postMeshVerts) {
        const uvsArr = uvsArrRef.current ?? new Float32Array(0);
        scene.parts.uploadPositions(partId, postMeshVerts, uvsArr);
        if (typeof scene._markDirty === 'function') scene._markDirty();
      }
    }

    function applyDelta(currentX, currentY, shift, ctrl) {
      const _kind = useModalVertexTransformStore.getState().kind;
      if (_kind === 'rotate' || _kind === 'scale') {
        applyRotateScale(_kind, currentX, currentY, shift);
        return;
      }
      const curAxis = useModalVertexTransformStore.getState().axis;
      const ed = useEditorStore.getState();
      const view = ed.viewByMode?.viewport ?? { zoom: 1, panX: 0, panY: 0 };
      const zoom = view.zoom || 1;
      let dxView = currentX - startMouse.x;
      let dyView = currentY - startMouse.y;
      if (curAxis === 'x') dyView = 0;
      if (curAxis === 'y') dxView = 0;
      let dxCanvas = dxView / zoom;
      let dyCanvas = dyView / zoom;

      const tb = useModalVertexTransformStore.getState().typedBuffer;
      const typed = parseTyped(tb);
      const useTyped = Number.isFinite(typed);

      if (useTyped) {
        if (curAxis === 'y') { dxCanvas = 0;     dyCanvas = typed; }
        else                 { dxCanvas = typed; dyCanvas = 0;     }
      }

      const snap = usePreferencesStore.getState().snap;
      const masterOn = !!snap?.enabled;
      const effSnap = ctrl ? !masterOn : masterOn;
      let snapVertexHit = false;

      if (!useTyped && effSnap && snap?.modes?.vertex?.enabled) {
        const rect = canvasRectRef.current;
        const cursorCanvasX = rect
          ? (currentX - rect.left) / zoom - view.panX / zoom
          : currentX / zoom;
        const cursorCanvasY = rect
          ? (currentY - rect.top)  / zoom - view.panY / zoom
          : currentY / zoom;
        const threshold = snap.modes.vertex.threshold > 0
          ? snap.modes.vertex.threshold
          : 8;
        const hash = snapHashRef.current;
        const hit = hash
          ? hash.findNearest(cursorCanvasX, cursorCanvasY, threshold)
          : null;
        if (hit) {
          const anchor = pickSelectionAnchor(
            anchorVertsRef.current,
            snap.target ?? 'closest',
            { snapTarget: hit, cursor: { x: cursorCanvasX, y: cursorCanvasY } },
          );
          dxCanvas = hit.x - anchor.x;
          dyCanvas = hit.y - anchor.y;
          if (curAxis === 'x') dyCanvas = 0;
          if (curAxis === 'y') dxCanvas = 0;
          useSnapStore.getState().setSnapTarget(hit);
          snapVertexHit = true;
        }
      }

      if (!snapVertexHit && useSnapStore.getState().target !== null) {
        useSnapStore.getState().clearSnapTarget();
      }

      if (!useTyped && effSnap && !snapVertexHit && snap?.modes?.grid?.enabled) {
        const grid = snap.modes.grid;
        const inc = shift
          ? (grid.precision > 0 ? grid.precision : (grid.increment > 0 ? grid.increment / 10 : 1.6))
          : (grid.increment > 0 ? grid.increment : 16);
        const snapped = snapDeltaToGrid({ x: dxCanvas, y: dyCanvas }, inc);
        dxCanvas = snapped.x;
        dyCanvas = snapped.y;
      }

      if (!useTyped && shift && !snapVertexHit
          && (!effSnap || !snap?.modes?.grid?.enabled)) {
        const p = applyPrecisionToDelta({ x: dxCanvas, y: dyCanvas }, PRECISION_FREE_TRANSLATE);
        dxCanvas = p.x;
        dyCanvas = p.y;
      }

      // Audit fix G-7 — early-return if store committed/cancelled
      // since this listener fired.
      if (useModalVertexTransformStore.getState().kind === null) return;

      const updateProject = useProjectStore.getState().updateProject;
      /** @type {any} */ let postMeshVerts = null;
      updateProject((proj) => {
        const node = proj.nodes.find((n) => n.id === partId);
        if (!node) return;
        const mesh = getMesh(node, proj);
        if (!mesh) return;
        for (const idx of vertIndices) {
          const orig = original.get(idx);
          if (!orig) continue;
          if (idx >= 0 && idx < mesh.vertices.length) {
            const v = mesh.vertices[idx];
            v.x = orig.x + dxCanvas;
            v.y = orig.y + dyCanvas;
            v.restX = (orig.restX ?? orig.x) + dxCanvas;
            v.restY = (orig.restY ?? orig.y) + dyCanvas;
          }
        }
        postMeshVerts = mesh.vertices;
      }, { skipHistory: true });

      const scene = getSceneRef();
      if (scene && scene.parts && postMeshVerts) {
        const uvsArr = uvsArrRef.current ?? new Float32Array(0);
        scene.parts.uploadPositions(partId, postMeshVerts, uvsArr);
        if (typeof scene._markDirty === 'function') scene._markDirty();
      }
    }

    function revertVerts() {
      const updateProject = useProjectStore.getState().updateProject;
      updateProject((proj) => {
        const node = proj.nodes.find((n) => n.id === partId);
        if (!node) return;
        const mesh = getMesh(node, proj);
        if (!mesh) return;
        for (const idx of vertIndices) {
          const orig = original.get(idx);
          if (!orig) continue;
          if (idx >= 0 && idx < mesh.vertices.length) {
            const v = mesh.vertices[idx];
            v.x = orig.x;
            v.y = orig.y;
            v.restX = orig.restX ?? orig.x;
            v.restY = orig.restY ?? orig.y;
          }
        }
      }, { skipHistory: true });
    }

    function recordMeshSignature() {
      const project = useProjectStore.getState().project;
      const node = project?.nodes?.find((n) => n.id === partId);
      const mesh = node ? getMesh(node, project) : null;
      const scene = getSceneRef();
      if (scene && scene.parts && mesh) {
        if (typeof scene._recordMeshUpload === 'function') {
          scene._recordMeshUpload(partId, meshSignature(mesh));
        }
      }
    }

    function commitInternal() {
      endBatch();
      useSnapStore.getState().clearSnapTarget();
      recordMeshSignature();
      useModalVertexTransformStore.getState().commit();
    }

    function rollbackThenCancel() {
      if (rollbackOnCancel) {
        const updateProject = useProjectStore.getState().updateProject;
        discardBatch((snapshot) => {
          if (!snapshot) return;
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
        const project = useProjectStore.getState().project;
        const node = project?.nodes?.find((n) => n.id === partId);
        const mesh = node ? getMesh(node, project) : null;
        const scene = getSceneRef();
        if (scene && scene.parts && mesh) {
          scene.parts.uploadMesh(partId, mesh);
          if (typeof scene._recordMeshUpload === 'function') {
            scene._recordMeshUpload(partId, meshSignature(mesh));
          }
          if (typeof scene._markDirty === 'function') scene._markDirty();
        }
      } else {
        revertVerts();
        endBatch();
        recordMeshSignature();
      }
      useSnapStore.getState().clearSnapTarget();
      useModalVertexTransformStore.getState().cancel();
    }

    // ── Event branches ───────────────────────────────────────────────

    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      lastMouse.current = { x: me.clientX, y: me.clientY };
      ctrlHeldRef.current = me.ctrlKey || me.metaKey;
      applyDelta(me.clientX, me.clientY, me.shiftKey, ctrlHeldRef.current);
      return 'RUNNING_MODAL';
    }

    if (e.type === 'mousedown') {
      const me = /** @type {MouseEvent} */ (e);
      e.preventDefault();
      if (me.button === 2) {
        rollbackThenCancel();
        return 'CANCELLED';
      }
      commitInternal();
      return 'FINISHED';
    }

    if (e.type === 'contextmenu') {
      e.preventDefault();
      rollbackThenCancel();
      return 'CANCELLED';
    }

    if (e.type === 'keydown') {
      const ke = /** @type {KeyboardEvent} */ (e);

      if (ke.key === 'Escape') {
        e.preventDefault();
        rollbackThenCancel();
        return 'CANCELLED';
      }
      if (ke.key === 'Enter') {
        e.preventDefault();
        commitInternal();
        return 'FINISHED';
      }
      if (ke.code === 'KeyX') {
        e.preventDefault();
        const cur = useModalVertexTransformStore.getState().axis;
        useModalVertexTransformStore.getState().setAxis(cur === 'x' ? null : 'x');
        return 'RUNNING_MODAL';
      }
      if (ke.code === 'KeyY') {
        e.preventDefault();
        const cur = useModalVertexTransformStore.getState().axis;
        useModalVertexTransformStore.getState().setAxis(cur === 'y' ? null : 'y');
        return 'RUNNING_MODAL';
      }
      if (ke.key === 'Backspace') {
        e.preventDefault();
        useModalVertexTransformStore.getState().popTyped();
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, ke.shiftKey, ctrlHeldRef.current);
        return 'RUNNING_MODAL';
      }
      if (ke.key.length === 1 && (
        (ke.key >= '0' && ke.key <= '9')
        || ke.key === '-'
        || ke.key === '.'
      )) {
        e.preventDefault();
        // Slice 5.U deviation: vertex modal has NO numericMode slot, so
        // USER_FLAG_NUMINPUT_ADVANCED is deliberately NOT read here.
        useModalVertexTransformStore.getState().appendTyped(ke.key);
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, ke.shiftKey, ctrlHeldRef.current);
        return 'RUNNING_MODAL';
      }
      if (ke.key === 'Control' || ke.key === 'Meta') {
        if (!ctrlHeldRef.current) {
          ctrlHeldRef.current = true;
          const cur = lastMouse.current;
          applyDelta(cur.x, cur.y, ke.shiftKey, true);
        }
        return 'RUNNING_MODAL';
      }
      if (ke.key === 'Shift') {
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, true, ctrlHeldRef.current);
        return 'RUNNING_MODAL';
      }
      // Catch-all: any OTHER chord (KeyE, KeyG, KeyR, KeyS, KeyB, KeyM)
      // gets swallowed so it doesn't open a competing modal mid-drag.
      e.preventDefault();
      return 'RUNNING_MODAL';
    }

    if (e.type === 'keyup') {
      const ke = /** @type {KeyboardEvent} */ (e);
      if (ke.key === 'Control' || ke.key === 'Meta') {
        if (ctrlHeldRef.current) {
          ctrlHeldRef.current = false;
          const cur = lastMouse.current;
          applyDelta(cur.x, cur.y, ke.shiftKey, false);
        }
        return 'RUNNING_MODAL';
      }
      if (ke.key === 'Shift') {
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, false, ctrlHeldRef.current);
        return 'RUNNING_MODAL';
      }
      return 'RUNNING_MODAL';
    }

    return 'PASS_THROUGH';
  }, [kind, partId, startMouse, original, vertIndices, rollbackOnCancel]);

  useModalTool({ id: 'modalVertexTransform', isActive: !!kind, handleEvent });

  if (!kind) return null;

  const showTyped = (typedBuffer ?? '').length > 0;
  return (
    <>
      <SnapTargetDot />
      <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none flex items-center gap-2 px-3 py-1.5 bg-popover/95 border border-border rounded text-xs font-mono shadow-lg">
        <span className="text-primary uppercase tracking-wider">vert {kind}</span>
        {axis ? <span className="text-amber-500">axis: {axis.toUpperCase()}</span> : null}
        {showTyped ? (
          <span className="text-foreground">
            {typedBuffer}
            <span className="text-muted-foreground/70">
              {kind === 'rotate' ? '°' : kind === 'scale' ? '×' : 'px'}
            </span>
          </span>
        ) : null}
        <span className="text-muted-foreground">
          {kind === 'rotate'
            ? 'Type degrees · Click / Enter = confirm · Esc = cancel · Shift = 5° steps'
            : kind === 'scale'
              ? 'Type factor · Click / Enter = confirm · Esc = cancel · X/Y = axis · Shift = 0.1 steps'
              : 'Type a value · Click / Enter = confirm · Esc = cancel · X/Y = axis · Shift = snap'}
        </span>
      </div>
    </>
  );
}

/** Magenta dot rendered at the active snap target — same as
 *  ModalTransformOverlay's SnapTargetDot but vertex-modal-aware. */
function SnapTargetDot() {
  const target = useSnapStore((s) => s.target);
  if (!target) return null;
  const view = useEditorStore.getState().viewByMode?.viewport ?? { zoom: 1, panX: 0, panY: 0 };
  const zoom = view.zoom || 1;
  const canvas = document.querySelector('canvas');
  const rect = canvas?.getBoundingClientRect();
  if (!rect) return null;
  const screenX = rect.left + (target.x * zoom + view.panX);
  const screenY = rect.top  + (target.y * zoom + view.panY);
  return (
    <div
      className="fixed z-[201] pointer-events-none"
      style={{
        left: screenX - 6,
        top:  screenY - 6,
        width: 12,
        height: 12,
        borderRadius: '50%',
        background: 'magenta',
        boxShadow: '0 0 6px rgba(255, 0, 255, 0.85), 0 0 1px white inset',
      }}
    />
  );
}
