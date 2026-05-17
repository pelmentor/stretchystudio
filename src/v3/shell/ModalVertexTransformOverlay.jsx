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
 * **Translate-only in v1.** Blender's E + R/S mid-modal switch (rotate
 * / scale of the freshly-extruded ring around the selection's pivot)
 * is Phase 6+; needs a real per-edit-mode pivot model. See audit
 * D-3 — `editors/transform/transform.cc:693-742`.
 *
 * **Audit D-6 — RMB-to-cancel matches Blender's LMB-select preset.**
 * Blender's modal cancel chord depends on the active keyconfig:
 * default LMB-select preset → RMB cancels; legacy RMB-select preset
 * → LMB cancels. SS unconditionally maps RMB to cancel which matches
 * the modern (default since 2.8) LMB-select preset. When SS gains a
 * keymap-preset switch (Phase 7+ "Industry-Compatible" mode), this
 * binding will need to read `select_mouse` like
 * `editors/transform/transform.cc` does.
 *
 * **Audit D-1 — Esc rolls back the topology change too.** Blender's
 * macro semantics keep the extrude on Esc-mid-translate (see
 * `modalVertexTransformStore.js` banner). SS's `discardBatch`-driven
 * cancel rolls back BOTH the topology AND the drag — atomic gesture
 * behaviour, deliberate UX deviation per Rule №1.
 *
 * @module v3/shell/ModalVertexTransformOverlay
 */

import { useEffect, useRef } from 'react';
import { useModalVertexTransformStore } from '../../store/modalVertexTransformStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { endBatch, discardBatch } from '../../store/undoHistory.js';
import { getSceneRef } from '../../lib/sceneRegistry.js';
import { getMesh } from '../../store/objectDataAccess.js';
import { meshSignature } from '../../io/meshSignature.js';
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
  const setAxis          = useModalVertexTransformStore((s) => s.setAxis);
  const appendTyped      = useModalVertexTransformStore((s) => s.appendTyped);
  const popTyped         = useModalVertexTransformStore((s) => s.popTyped);
  const commit           = useModalVertexTransformStore((s) => s.commit);
  const cancel           = useModalVertexTransformStore((s) => s.cancel);

  const lastMouse = useRef({ x: 0, y: 0 });
  const canvasRectRef = useRef(/** @type {DOMRect|null} */ (null));
  const snapHashRef = useRef(/** @type {any} */ (null));
  const anchorVertsRef = useRef(/** @type {any[]} */ ([]));
  const ctrlHeldRef = useRef(false);
  // Audit fix G-5 — cache the Float32Array UVs at modal entry. UVs
  // don't change during a vertex translate (only positions do), so the
  // per-tick re-allocation was pure GC pressure.
  const uvsArrRef = useRef(/** @type {Float32Array|null} */ (null));

  useEffect(() => {
    if (!kind || !partId || !startMouse) return;
    const canvasEl = document.querySelector('canvas');
    canvasRectRef.current = canvasEl?.getBoundingClientRect() ?? null;
    useSnapStore.getState().clearSnapTarget();
    ctrlHeldRef.current = false;

    // Build snap hash + anchor verts on entry. Exclude the dragged
    // vert positions from the snap hash by passing `excludeVertIndices`
    // — a fresh mode that the snap module honours per-call.
    //
    // Audit fix G-6 — moved out of the per-axis-change reactive path
    // by removing `axis` from the useEffect deps below. Snap-hash
    // build is ~30 ms on Hiyori-class projects; pre-fix the user saw
    // visible jank on every X / Y axis-toggle press.
    {
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
      // Audit fix G-5 — snapshot UVs once. Mesh UVs are immutable
      // during a vertex translate (only positions move).
      const node = project?.nodes?.find((n) => n.id === partId);
      const mesh = node ? getMesh(node, project) : null;
      const meshUvs = mesh?.uvs;
      uvsArrRef.current = meshUvs instanceof Float32Array
        ? meshUvs
        : new Float32Array(meshUvs ?? []);
    }

    function parseTyped(buf) {
      if (typeof buf !== 'string' || buf.length === 0) return NaN;
      const n = Number(buf);
      return Number.isFinite(n) ? n : NaN;
    }

    function applyDelta(currentX, currentY, shift, ctrl) {
      // Audit fix G-6 — read axis from the store rather than closing
      // over the prop. Pre-fix the prop was a useEffect dep, so every
      // axis-toggle press re-mounted the listeners + rebuilt the snap
      // hash (~30 ms jank on Hiyori).
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
        if (axis === 'y') { dxCanvas = 0;     dyCanvas = typed; }
        else              { dxCanvas = typed; dyCanvas = 0;     }
      }

      const snap = usePreferencesStore.getState().snap;
      const masterOn = !!snap?.enabled;
      const effSnap = ctrl ? !masterOn : masterOn;
      let snapVertexHit = false;

      // Snap-to-vertex against OTHER verts in the project (excluding
      // the dragged verts via the snap-hash filter set at modal entry).
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

      // Grid snap.
      if (!useTyped && effSnap && !snapVertexHit && snap?.modes?.grid?.enabled) {
        const grid = snap.modes.grid;
        const inc = shift
          ? (grid.precision > 0 ? grid.precision : (grid.increment > 0 ? grid.increment / 10 : 1.6))
          : (grid.increment > 0 ? grid.increment : 16);
        const snapped = snapDeltaToGrid({ x: dxCanvas, y: dyCanvas }, inc);
        dxCanvas = snapped.x;
        dyCanvas = snapped.y;
      }

      // Free-transform precision (Shift without snap).
      if (!useTyped && shift && !snapVertexHit
          && (!effSnap || !snap?.modes?.grid?.enabled)) {
        const p = applyPrecisionToDelta({ x: dxCanvas, y: dyCanvas }, PRECISION_FREE_TRANSLATE);
        dxCanvas = p.x;
        dyCanvas = p.y;
      }

      // Audit fix G-7 — early-return if the store was committed/cancelled
      // since this listener fired (queued mousemoves in the event loop
      // can outlast `commit()` / `cancel()` by ~one frame). Without this,
      // those queued events would re-mutate verts via the now-stale
      // closure references to `original` / `vertIndices`.
      if (useModalVertexTransformStore.getState().kind === null) return;

      // Live mutation: write new positions to mesh.vertices for the
      // dragged set, then GPU-upload via sceneRegistry. The same pattern
      // sculpt brushes use (sceneRef.parts.uploadPositions) so the
      // viewport sees the move immediately, no React render cycle wait.
      //
      // Audit fix G-1 — write BOTH pose (`x`/`y`) AND rest (`restX`/
      // `restY`). Edit-Mode-driven vertex transforms operate on the rest
      // mesh; if rest stays at the source position, chainEval (Pose Mode
      // preview, animation playback, export, even an Object Mode tab
      // switch) reads rest = source and snaps the dragged dups back on
      // top of their sources. Pre-fix: extrude drag was silently
      // invisible to the rig. Matches `merge.js:99-102` and `add_vertex`
      // (`CanvasViewport.jsx:2487`), both of which write rest = pose at
      // creation/edit time.
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
        // Audit fix G-5 — UVs don't change during a vertex translate.
        // Cache the Float32Array at modal entry (`uvsArrRef`) instead of
        // re-allocating per tick. 60 Hz * 2 * vertCount floats = ~1.4
        // MB/sec GC pressure on Hiyori-class meshes pre-fix.
        const uvsArr = uvsArrRef.current ?? new Float32Array(0);
        scene.parts.uploadPositions(partId, postMeshVerts, uvsArr);
        if (typeof scene._markDirty === 'function') scene._markDirty();
      }
    }

    function onMouseMove(e) {
      lastMouse.current = { x: e.clientX, y: e.clientY };
      ctrlHeldRef.current = e.ctrlKey || e.metaKey;
      applyDelta(e.clientX, e.clientY, e.shiftKey, ctrlHeldRef.current);
    }
    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.button === 2) {
        rollbackThenCancel();
      } else {
        commitInternal();
      }
    }
    function onContextMenu(e) {
      e.preventDefault();
      e.stopPropagation();
      rollbackThenCancel();
    }
    function onKeyDown(e) {
      // Audit fix G-3 + G-4 — stopPropagation on every key while modal
      // is active. Pre-fix, Escape leaked through to the dispatcher's
      // bubble-phase listener (which fired `selection.clear`,
      // surprising users by losing their object selection). Other
      // operator chords (E / G / R / S / B / M) leaked through and
      // mounted nested modals on top of the active vertex modal.
      // Swallowing every key here is the simplest correct gate; the
      // small set of chords we DO want to forward (none today) would
      // need explicit allow-listing.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        rollbackThenCancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        commitInternal();
        return;
      }
      if (e.code === 'KeyX') {
        e.preventDefault();
        e.stopPropagation();
        // Audit fix G-6 — read axis from store, not closure (closure
        // axis would force this useEffect to re-run on every press).
        const cur = useModalVertexTransformStore.getState().axis;
        setAxis(cur === 'x' ? null : 'x');
        return;
      }
      if (e.code === 'KeyY') {
        e.preventDefault();
        e.stopPropagation();
        const cur = useModalVertexTransformStore.getState().axis;
        setAxis(cur === 'y' ? null : 'y');
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        popTyped();
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, e.shiftKey, ctrlHeldRef.current);
        return;
      }
      if (e.key.length === 1 && (
        (e.key >= '0' && e.key <= '9')
        || e.key === '-'
        || e.key === '.'
      )) {
        e.preventDefault();
        e.stopPropagation();
        // Slice 5.U deviation: vertex modal has NO `numericMode` slot
        // in `modalVertexTransformStore`, so Blender's
        // `USER_FLAG_NUMINPUT_ADVANCED` auto-enable behavior
        // (`reference/blender/source/blender/editors/util/numinput.cc:352-365`)
        // has nothing to enter. The pref is therefore deliberately NOT
        // read here. If a future slice adds a numericMode flow to the
        // vertex store, this site should branch on the pref like
        // `ModalTransformOverlay.jsx` does.
        appendTyped(e.key);
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, e.shiftKey, ctrlHeldRef.current);
        return;
      }
      if (e.key === 'Control' || e.key === 'Meta') {
        const next = e.type === 'keydown';
        if (next !== ctrlHeldRef.current) {
          ctrlHeldRef.current = next;
          const cur = lastMouse.current;
          applyDelta(cur.x, cur.y, e.shiftKey, next);
        }
        return;
      }
      if (e.key === 'Shift') {
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, e.type === 'keydown', ctrlHeldRef.current);
        return;
      }
      // Catch-all: any OTHER chord (KeyE, KeyG, KeyR, KeyS, KeyB,
      // KeyM, etc.) gets swallowed so it doesn't leak to the
      // dispatcher and open a competing modal.
      e.preventDefault();
      e.stopPropagation();
    }
    function onKeyUp(e) {
      if (e.key === 'Control' || e.key === 'Meta') {
        if (ctrlHeldRef.current) {
          ctrlHeldRef.current = false;
          const cur = lastMouse.current;
          applyDelta(cur.x, cur.y, e.shiftKey, false);
        }
        return;
      }
      if (e.key === 'Shift') {
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, false, ctrlHeldRef.current);
        return;
      }
    }

    /** Restore vert positions to originals via skipHistory write. Used
     *  by the non-rollback cancel path. Audit fix G-1 — rest values
     *  also restore so the rig sees the pre-drag state (mirrors the
     *  per-tick write that updates both pose AND rest). */
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

    function commitInternal() {
      endBatch();
      useSnapStore.getState().clearSnapTarget();
      // Re-upload the post-commit mesh signature so CanvasViewport's
      // mesh-sync useEffect doesn't double-upload after the React render
      // cycle (sister fix to applyTopologyOp G-3 — same `_recordMeshUpload`
      // path keeps the sig cache fresh).
      recordMeshSignature();
      commit();
    }

    function rollbackThenCancel() {
      if (rollbackOnCancel) {
        // discardBatch handles the full rollback in one swoop:
        // pre-batch snapshot pops + applyFn restores, no redo entry
        // pushed. Covers BOTH the topology change (extrude) AND the
        // live drag delta — single source of truth.
        const updateProject = useProjectStore.getState().updateProject;
        discardBatch((snapshot) => {
          if (!snapshot) return;
          // Match the existing app.undo path (registry.js:129) — the
          // snapshot is the immer-frozen pre-batch project; Object.assign
          // overwrites every top-level key (including arrays), and any
          // node sub-fields that were added during the batch get
          // overwritten by the snapshot's node sub-trees.
          updateProject((proj) => {
            Object.assign(proj, snapshot);
          }, { skipHistory: true });
        });
        // After topology rollback, GPU-resync the mesh from the restored
        // project state — the dragged verts are gone (extrude rolled
        // back), so uploadPositions wouldn't help; full uploadMesh.
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
      cancel();
    }

    /** After commit (or non-rollback cancel), update the mesh-sig
     *  cache so the CanvasViewport mesh-sync useEffect doesn't duplicate
     *  the upload we already did via uploadPositions. */
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

    lastMouse.current = { x: startMouse.x, y: startMouse.y };

    window.addEventListener('mousemove', onMouseMove, { capture: true });
    window.addEventListener('mousedown', onClick, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('keyup',   onKeyUp,   { capture: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove, { capture: true });
      window.removeEventListener('mousedown', onClick, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup',   onKeyUp,   { capture: true });
      useSnapStore.getState().clearSnapTarget();
    };
  }, [kind, partId, startMouse, original, vertIndices, rollbackOnCancel,
      setAxis, appendTyped, popTyped, commit, cancel]);

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
            {typedBuffer}<span className="text-muted-foreground/70">px</span>
          </span>
        ) : null}
        <span className="text-muted-foreground">
          Type a value · Click / Enter = confirm · Esc = cancel · X/Y = axis · Shift = snap
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
