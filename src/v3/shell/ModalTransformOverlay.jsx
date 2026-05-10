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
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { endBatch } from '../../store/undoHistory.js';
import { writePoseValues } from '../../renderer/animationEngine.js';
import {
  findNearestVertex,
  snapDeltaToGrid,
  snapAngleToIncrement,
  snapScaleToIncrement,
  useSnapStore,
} from '../../lib/snap/index.js';

/** Toolset Phase 2 — legacy fallback snaps when `snap.modes.grid` is
 *  disabled or the increment slot is empty. Match the pre-Phase-2
 *  hard-coded values (G:10px, R:15°, S:0.1) so disabling the mode
 *  preserves the historic behaviour exactly. */
const LEGACY_SNAP_GRID_INCREMENT       = 10;            // px in canvas space
const LEGACY_SNAP_ROTATE_INCREMENT_DEG = 15;
const LEGACY_SNAP_SCALE_INCREMENT_DEG  = 10;            // 10° → 0.1× via snapScaleToIncrement

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

  // Phase 2 — snap-to-vertex needs client→canvas-px conversion. Capture
  // the canvas rect once at modal mount; the canvas doesn't move during
  // a drag, so a single snapshot is correct + cheap. Falls back to a
  // zero-offset rect if no canvas is mounted (snap will degrade to
  // pure-zoom math, still finite — never crashes).
  const canvasRectRef = useRef(null);

  useEffect(() => {
    if (!kind || !startMouse || !pivotCanvas) return;
    canvasRectRef.current = document.querySelector('canvas')?.getBoundingClientRect() ?? null;
    // Clear any leftover snap-target on entry so the dot from a prior
    // drag doesn't render until the first snap engages.
    useSnapStore.getState().clearSnapTarget();

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
      const view = ed.view;
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

      // Toolset Plan Phase 2.B/C — snap config. Read fresh each tick
      // so toggles in the N-panel mid-drag take effect immediately.
      const snap = usePreferencesStore.getState().snap;
      const project = useProjectStore.getState().project;
      let snapVertexHit = false;

      // Phase 2.C — snap-to-vertex (Modal G only, unshifted, master on,
      // mode on). Overrides the mouse-driven dxCanvas/dyCanvas so the
      // anchor (cursor under 'closest' target) lands exactly on the
      // snap vertex. Typed input takes precedence — typed numeric goes
      // to the requested value verbatim.
      if (kind === 'translate' && !useTyped && !shift && snap?.enabled
          && snap.modes?.vertex?.enabled && project) {
        const rect = canvasRectRef.current;
        const cursorCanvasX = rect
          ? (currentX - rect.left) / zoom - view.panX / zoom
          : currentX / zoom;
        const cursorCanvasY = rect
          ? (currentY - rect.top)  / zoom - view.panY / zoom
          : currentY / zoom;
        const startCanvasX = rect
          ? (startMouse.x - rect.left) / zoom - view.panX / zoom
          : startMouse.x / zoom;
        const startCanvasY = rect
          ? (startMouse.y - rect.top)  / zoom - view.panY / zoom
          : startMouse.y / zoom;
        // 'closest' target: the cursor IS the anchor. Other target modes
        // (center/median/active) override the anchor with selection
        // geometry; deferred to a follow-up — modal currently uses
        // 'closest' regardless. The math path is unit-tested via
        // computeSelectionAnchor.
        const hit = findNearestVertex(
          project, cursorCanvasX, cursorCanvasY, snap.modes.vertex.threshold,
        );
        if (hit) {
          dxCanvas = hit.x - startCanvasX;
          dyCanvas = hit.y - startCanvasY;
          if (axis === 'x') dyCanvas = 0;
          if (axis === 'y') dxCanvas = 0;
          useSnapStore.getState().setSnapTarget(hit);
          snapVertexHit = true;
        } else {
          useSnapStore.getState().clearSnapTarget();
        }
      } else {
        useSnapStore.getState().clearSnapTarget();
      }

      // Phase 2.B — Shift+G snaps the delta to grid increments. Reads
      // `snap.modes.grid.increment` (default 16); falls back to legacy
      // 10px when the mode is disabled. Vertex snap (above) wins —
      // Shift inverts intent so they don't both apply on the same tick.
      if (kind === 'translate' && !useTyped && shift && !snapVertexHit) {
        const gridInc = snap?.modes?.grid?.enabled
          ? (snap.modes.grid.increment > 0 ? snap.modes.grid.increment : LEGACY_SNAP_GRID_INCREMENT)
          : LEGACY_SNAP_GRID_INCREMENT;
        const snapped = snapDeltaToGrid({ x: dxCanvas, y: dyCanvas }, gridInc);
        dxCanvas = snapped.x;
        dyCanvas = snapped.y;
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
            const nx = (orig.x ?? 0) + dxCanvas;
            const ny = (orig.y ?? 0) + dyCanvas;
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
              if (shift) {
                // Phase 2.D — rotation snap. Reads
                // `snap.modes.increment.value` when the mode is
                // enabled; legacy 15° otherwise.
                const incDeg = snap?.modes?.increment?.enabled
                  ? (snap.modes.increment.value > 0 ? snap.modes.increment.value : LEGACY_SNAP_ROTATE_INCREMENT_DEG)
                  : LEGACY_SNAP_ROTATE_INCREMENT_DEG;
                dRot = snapAngleToIncrement(dRot, incDeg);
              }
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
              if (shift) {
                // Phase 2.D — scale snap. `increment.value` is in
                // degrees per the SNAP_DEFAULT jsdoc convention; scale
                // step is `value/100`. Legacy 0.1× preserved when the
                // mode is disabled (10°/100 = 0.1×).
                const incDeg = snap?.modes?.increment?.enabled
                  ? (snap.modes.increment.value > 0 ? snap.modes.increment.value : LEGACY_SNAP_SCALE_INCREMENT_DEG)
                  : LEGACY_SNAP_SCALE_INCREMENT_DEG;
                s = snapScaleToIncrement(s, incDeg);
              }
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
        useSnapStore.getState().clearSnapTarget();
        cancel();
      } else {
        endBatch();
        useSnapStore.getState().clearSnapTarget();
        commit();
      }
    }
    function onContextMenu(e) {
      // Right-click = cancel. Need to suppress browser menu.
      e.preventDefault();
      revert();
      endBatch();
      useSnapStore.getState().clearSnapTarget();
      cancel();
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        revert();
        endBatch();
        useSnapStore.getState().clearSnapTarget();
        cancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        endBatch();
        useSnapStore.getState().clearSnapTarget();
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
    <>
      <SnapTargetDot kind={kind} />
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
    </>
  );
}

/** Toolset Phase 2.C — magenta dot rendered at the active snap target.
 *
 *  Subscribes to `useSnapStore` so the dot follows the live snap target
 *  per modal tick. Mounted only while the modal is active (kind set);
 *  Modal G is the only kind that engages snap-to-vertex but the
 *  component is kind-agnostic so a future Modal R/S vertex-snap (if
 *  ever shipped) gets the dot for free. */
function SnapTargetDot({ kind }) {
  const target = useSnapStore((s) => s.target);
  if (!target || kind !== 'translate') return null;
  // Re-derive the canvas rect each render so the dot follows pan/zoom
  // changes (paranoid; both are stable during a modal drag, but cheap).
  const view = useEditorStore.getState().view;
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
