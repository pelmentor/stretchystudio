// @ts-check
/* eslint-disable react/prop-types */

/**
 * v3 Phase 2H — Modal G/R/S overlay.
 *
 * Mounts a fullscreen capture layer while a modal transform is
 * active. Translates the mouse delta from viewport pixels into the
 * appropriate transform mutation:
 *
 *   - `translate` — adds (dx/zoom, dy/zoom) to each selected node's
 *     transform.x/y.
 *   - `rotate`    — adds the angular delta from start→current cursor
 *     (around pivotCanvas) to each node's transform.rotation.
 *   - `scale`     — multiplies scaleX/scaleY by the radial ratio of
 *     current→start cursor distances from pivotCanvas.
 *
 * Per-frame writes use `updateProject(recipe, {skipHistory:true})`
 * so the modal doesn't burn 60 undo entries. On commit, a single
 * snapshot is pushed by re-running the same mutation with
 * skipHistory off — that keeps undo coherent with the final state.
 *
 * Axis lock (X/Y) zeroes the orthogonal component for translate, and
 * for scale clamps the affected axis only (X locks scaleY=1, Y locks
 * scaleX=1). Rotate ignores axis lock (no Z in 2D).
 *
 * Shift snaps:
 *   - translate: 10 px increments
 *   - rotate:    15° increments
 *   - scale:     0.1 increments
 *
 * @module v3/shell/ModalTransformOverlay
 */

import { useEffect, useRef } from 'react';
import { useModalTransformStore } from '../../store/modalTransformStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { endBatch } from '../../store/undoHistory.js';
import { writePoseValues } from '../../renderer/animationEngine.js';

const SNAP_TRANSLATE = 10;       // px in canvas space
const SNAP_ROTATE    = 15 * Math.PI / 180;
const SNAP_SCALE     = 0.1;

export function ModalTransformOverlay() {
  const kind        = useModalTransformStore((s) => s.kind);
  const axis        = useModalTransformStore((s) => s.axis);
  const startMouse  = useModalTransformStore((s) => s.startMouse);
  const pivotCanvas = useModalTransformStore((s) => s.pivotCanvas);
  const original    = useModalTransformStore((s) => s.original);
  const typedBuffer = useModalTransformStore((s) => s.typedBuffer);
  const setAxis     = useModalTransformStore((s) => s.setAxis);
  const appendTyped = useModalTransformStore((s) => s.appendTyped);
  const popTyped    = useModalTransformStore((s) => s.popTyped);
  const commit      = useModalTransformStore((s) => s.commit);
  const cancel      = useModalTransformStore((s) => s.cancel);

  // Track last mouse position so typed-buffer keystrokes can re-apply
  // the modal effect without waiting for a mousemove. Initialised to
  // startMouse (or origin) so the first typed digit lands immediately.
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!kind || !startMouse || !pivotCanvas) return;

    /**
     * BVR-005 — Parse the typed buffer to a finite number, or NaN if
     * the buffer is empty / not yet a valid number (e.g. "-" or "."
     * mid-typing). Non-finite → caller falls back to mouse delta.
     */
    function parseTyped(buf) {
      if (typeof buf !== 'string' || buf.length === 0) return NaN;
      const n = Number(buf);
      return Number.isFinite(n) ? n : NaN;
    }

    function applyDelta(currentX, currentY, shift) {
      const ed = useEditorStore.getState();
      const zoom = ed.view.zoom || 1;
      // viewport→canvas delta: divide by zoom. Pan doesn't move with
      // the cursor so we ignore it for delta math.
      let dxView = currentX - startMouse.x;
      let dyView = currentY - startMouse.y;
      if (axis === 'x') dyView = 0;
      if (axis === 'y') dxView = 0;
      let dxCanvas = dxView / zoom;
      let dyCanvas = dyView / zoom;

      // BVR-005 — typed override. When the buffer parses to a finite
      // number, the modal commits that exact value instead of the
      // mouse-delta. Translate distributes the typed value along the
      // active axis (default X if no axis); rotate uses degrees;
      // scale uses the typed value as the multiplier.
      const tb = useModalTransformStore.getState().typedBuffer;
      const typed = parseTyped(tb);
      const useTyped = Number.isFinite(typed);

      if (useTyped && kind === 'translate') {
        // Axis-locked typed translate: typed value goes on the locked
        // axis only. Unconstrained (axis === null) Blender-style: typed
        // value goes on X (matches Blender's "G → type → axis defaults
        // to X"); user can press X/Y to reroute.
        if (axis === 'y') { dxCanvas = 0;     dyCanvas = typed; }
        else              { dxCanvas = typed; dyCanvas = 0;     }
      }

      const updateProject = useProjectStore.getState().updateProject;
      updateProject((proj) => {
        for (const [nodeId, orig] of original) {
          const node = proj.nodes.find((n) => n.id === nodeId);
          if (!node) continue;
          // Modal G/R/S always writes pose-shape values for bones
          // (writePoseValues routes to node.pose for bones, node.transform
          // for non-bones).
          const writer = writePoseValues;
          if (kind === 'translate') {
            let nx = (orig.x ?? 0) + dxCanvas;
            let ny = (orig.y ?? 0) + dyCanvas;
            if (!useTyped && shift) {
              nx = Math.round(nx / SNAP_TRANSLATE) * SNAP_TRANSLATE;
              ny = Math.round(ny / SNAP_TRANSLATE) * SNAP_TRANSLATE;
            }
            writer(node, { x: nx, y: ny });
          } else if (kind === 'rotate') {
            let dRot;
            if (useTyped) {
              dRot = typed * Math.PI / 180; // typed is degrees
            } else {
              const ax0 = startMouse.x / zoom - pivotCanvas.x;
              const ay0 = startMouse.y / zoom - pivotCanvas.y;
              const ax1 = currentX / zoom - pivotCanvas.x;
              const ay1 = currentY / zoom - pivotCanvas.y;
              dRot = Math.atan2(ay1, ax1) - Math.atan2(ay0, ax0);
              if (shift) dRot = Math.round(dRot / SNAP_ROTATE) * SNAP_ROTATE;
            }
            writer(node, { rotation: (orig.rotation ?? 0) + dRot });
          } else if (kind === 'scale') {
            let s;
            if (useTyped) {
              s = typed;
            } else {
              const d0 = Math.hypot(
                startMouse.x / zoom - pivotCanvas.x,
                startMouse.y / zoom - pivotCanvas.y,
              ) || 1;
              const d1 = Math.hypot(
                currentX / zoom - pivotCanvas.x,
                currentY / zoom - pivotCanvas.y,
              );
              s = d1 / d0;
              if (!Number.isFinite(s) || s <= 0) s = 1;
              if (shift) s = Math.max(SNAP_SCALE, Math.round(s / SNAP_SCALE) * SNAP_SCALE);
            }
            const sx = axis === 'y' ? 1 : s;
            const sy = axis === 'x' ? 1 : s;
            writer(node, {
              scaleX: (orig.scaleX ?? 1) * sx,
              scaleY: (orig.scaleY ?? 1) * sy,
            });
          }
        }
      }, { skipHistory: true });
    }

    function onMouseMove(e) {
      lastMouse.current = { x: e.clientX, y: e.clientY };
      applyDelta(e.clientX, e.clientY, e.shiftKey);
    }
    function onClick(e) {
      // left click commits, right click cancels
      e.preventDefault();
      if (e.button === 2) {
        revert();
        endBatch();
        cancel();
      } else {
        endBatch();
        commit();
      }
    }
    function onContextMenu(e) {
      // Right-click = cancel. Need to suppress browser menu.
      e.preventDefault();
      revert();
      endBatch();
      cancel();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        revert();
        endBatch();
        cancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        endBatch();
        commit();
        return;
      }
      if (e.code === 'KeyX') { e.preventDefault(); setAxis(axis === 'x' ? null : 'x'); return; }
      if (e.code === 'KeyY') { e.preventDefault(); setAxis(axis === 'y' ? null : 'y'); return; }
      // BVR-005 — typed numeric input. Digits / sign / decimal point
      // accumulate into modalTransformStore.typedBuffer. Backspace
      // pops. The buffer is then read by the next applyDelta tick
      // (we re-fire one immediately so the HUD + project reflect the
      // typed value without the user nudging the mouse).
      if (e.key === 'Backspace') {
        e.preventDefault();
        popTyped();
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, e.shiftKey);
        return;
      }
      if (e.key.length === 1 && (
        (e.key >= '0' && e.key <= '9')
        || e.key === '-'
        || e.key === '.'
      )) {
        e.preventDefault();
        appendTyped(e.key);
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, e.shiftKey);
        return;
      }
    }

    function revert() {
      const updateProject = useProjectStore.getState().updateProject;
      updateProject((proj) => {
        for (const [nodeId, orig] of original) {
          const node = proj.nodes.find((n) => n.id === nodeId);
          if (!node) continue;
          // Same writer the live-mousemove writes used → cancellation
          // lands the originals back in the right slot.
          writePoseValues(node, orig);
        }
      }, { skipHistory: true });
    }

    // Seed lastMouse from startMouse so typed digits work before any
    // mousemove fires (e.g. user presses G then immediately types).
    lastMouse.current = { x: startMouse.x, y: startMouse.y };

    window.addEventListener('mousemove', onMouseMove, { capture: true });
    window.addEventListener('mousedown', onClick, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove, { capture: true });
      window.removeEventListener('mousedown', onClick, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
    };
  }, [kind, axis, startMouse, pivotCanvas, original, setAxis, appendTyped, popTyped, commit, cancel]);

  if (!kind) return null;

  // Visible HUD: small badge at the top showing kind + axis + snap.
  // BVR-005 — typed buffer surfaces here so the user sees what they're
  // typing in real time. Unit suffix matches the operation: px (G),
  // ° (R), × (S).
  const unit = kind === 'rotate' ? '°' : kind === 'scale' ? '×' : 'px';
  const showTyped = (typedBuffer ?? '').length > 0;
  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none flex items-center gap-2 px-3 py-1.5 bg-popover/95 border border-border rounded text-xs font-mono shadow-lg">
      <span className="text-primary uppercase tracking-wider">{kind}</span>
      {axis ? <span className="text-amber-500">axis: {axis.toUpperCase()}</span> : null}
      {showTyped ? (
        <span className="text-foreground">
          {typedBuffer}<span className="text-muted-foreground/70">{unit}</span>
        </span>
      ) : null}
      <span className="text-muted-foreground">
        Type a value · Click / Enter = confirm · Esc = cancel · X/Y = axis · Shift = snap
      </span>
    </div>
  );
}
