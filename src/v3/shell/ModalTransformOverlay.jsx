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
import { useSelectionStore } from '../../store/selectionStore.js';
import { useCaptureStore } from '../../store/captureStore.js';
import { endBatch } from '../../store/undoHistory.js';
import { writePoseValues } from '../../renderer/animationEngine.js';
import {
  buildSnapHash,
  enumerateSelectionAnchorVerts,
  pickSelectionAnchor,
  snapDeltaToGrid,
  snapAngleToIncrement,
  snapScaleToIncrement,
  applyPrecisionToDelta,
  applyPrecisionToAngle,
  applyPrecisionToScale,
  useSnapStore,
} from '../../lib/snap/index.js';

/** Phase 2 audit fix (D-1) — Shift acts as Blender's `MOD_PRECISION`
 *  during modal G/R/S. Multiplier matches Blender's translate
 *  precision (0.1 = 10× finer). Per `transform_snap.cc:1726` the snap
 *  precision factor is `t->increment[i] * t->increment_precision`,
 *  which for 2D scenes is `5° * (1°/5°) = 1°` — i.e. 0.2× for rotation.
 *  We use 0.1× across the board for translate as the most common
 *  interpretation; rotation/scale precision use the per-mode
 *  `precision` slot (defaults to 1° for rotate, 0.01× for scale). */
const PRECISION_FREE_TRANSLATE = 0.1;
const PRECISION_FREE_ROTATE    = 0.1;
const PRECISION_FREE_SCALE     = 0.1;

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
  // Phase 2 audit fix (D-3, D-4) — built fresh per modal session. Hash
  // takes ~1 ms for ~5000 verts; modal-only lifetime sidesteps the
  // staleness-cache + global-invalidation pattern that the prior
  // approach used (see `lib/snap/snapHash.js` jsdoc).
  const snapHashRef = useRef(null);
  const anchorVertsRef = useRef([]);
  const ctrlHeldRef = useRef(false);

  useEffect(() => {
    if (!kind || !startMouse || !pivotCanvas) return;
    const canvasEl = document.querySelector('canvas');
    canvasRectRef.current = canvasEl?.getBoundingClientRect() ?? null;
    // Clear any leftover snap-target on entry so the dot from a prior
    // drag doesn't render until the first snap engages.
    useSnapStore.getState().clearSnapTarget();
    ctrlHeldRef.current = false;

    // Phase 2 audit fix (D-3, D-4) — build the snap hash + selection
    // anchors at modal entry. In Pose Mode, route the hash over the
    // post-skinning evaluated verts (via `getCanvasHitContext` →
    // `frames`) so the snap target tracks what's visibly on screen,
    // not the rest geometry hidden under the deformation.
    {
      const project = useProjectStore.getState().project;
      const editor = useEditorStore.getState();
      const selection = useSelectionStore.getState().items ?? [];
      const inPoseMode = editor.editMode === 'pose';
      let frames = null;
      if (inPoseMode) {
        const ctxFn = useCaptureStore.getState().getCanvasHitContext;
        const ctx = typeof ctxFn === 'function' ? ctxFn() : null;
        frames = ctx?.frames ?? null;
      }
      // Object-Mode dragged-part exclusion (audit fix G-2): when there's
      // exactly one node in the selection, skip its own verts so the
      // snap dot is attracted to OTHER parts. Multi-select and Edit
      // Mode bypass — Edit Mode's modal G is a vertex edit (snap-to-
      // own-other-verts is a feature), and multi-select implies the
      // user wants between-parts snap.
      const excludePartId = (!inPoseMode && editor.editMode !== 'edit'
                             && selection.length === 1)
        ? selection[0]?.id ?? null
        : null;
      snapHashRef.current = buildSnapHash(project, {
        cellSize: 64,   // covers up to ~64-px threshold without rebuild
        frames,
        excludePartId,
      });
      anchorVertsRef.current = enumerateSelectionAnchorVerts(project, selection, {
        editMode: editor.editMode,
        activeVertex: editor.activeVertex,
        selectedVertexIndices: editor.selectedVertexIndices,
      });
    }

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

    function applyDelta(currentX, currentY, shift, ctrl) {
      const ed = useEditorStore.getState();
      // GAP-010 Phase B — view state is keyed by mode now (`viewByMode.viewport`
      // for the edit canvas). Modal G/R/S only fires from the viewport tab,
      // never from livePreview, so reading `viewport` directly is correct.
      const view = ed.viewByMode?.viewport ?? { zoom: 1, panX: 0, panY: 0 };
      const zoom = view.zoom || 1;
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

      // Phase 2 audit fix (D-1, D-2) — Blender-faithful gesture model.
      //   - master `enabled`: the magnet toggle. ON → snap auto-engages.
      //   - Shift: MOD_PRECISION (fine-grained input; never engages snap).
      //   - Ctrl:  MOD_SNAP_INV (XOR'd against master so user can flip
      //            mid-drag).
      // Read fresh each tick so toggles in the N-panel mid-drag take
      // effect immediately.
      const snap = usePreferencesStore.getState().snap;
      const masterOn = !!snap?.enabled;
      const effSnap = ctrl ? !masterOn : masterOn;
      let snapVertexHit = false;

      if (kind === 'translate' && !useTyped && effSnap && snap?.modes?.vertex?.enabled) {
        // Phase 2.C — snap-to-vertex (auto-engages whenever cursor
        // enters threshold). Shift doesn't gate this — it's MOD_PRECISION,
        // not a snap-engagement modifier. Anchor + delta math via
        // pickSelectionAnchor so the user's `snap.target` (closest /
        // center / median / active) actually drives where the selection
        // lands on the snap vertex.
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
          if (axis === 'x') dyCanvas = 0;
          if (axis === 'y') dxCanvas = 0;
          useSnapStore.getState().setSnapTarget(hit);
          snapVertexHit = true;
        }
      }

      if (!snapVertexHit && useSnapStore.getState().target !== null) {
        useSnapStore.getState().clearSnapTarget();
      }

      // Grid snap — auto-engages when master + grid enabled. Shift
      // selects the precision increment instead of the regular one.
      if (kind === 'translate' && !useTyped && effSnap && !snapVertexHit
          && snap?.modes?.grid?.enabled) {
        const grid = snap.modes.grid;
        const inc = shift
          ? (grid.precision > 0 ? grid.precision : (grid.increment > 0 ? grid.increment / 10 : 1.6))
          : (grid.increment > 0 ? grid.increment : 16);
        const snapped = snapDeltaToGrid({ x: dxCanvas, y: dyCanvas }, inc);
        dxCanvas = snapped.x;
        dyCanvas = snapped.y;
      }

      // Free-transform precision when no snap engages (Blender's
      // MOD_PRECISION). Multiplies the raw delta by 0.1 — finer cursor
      // input. NOT applied when typed-buffer is active (typed values
      // are exact).
      if (kind === 'translate' && !useTyped && shift && !snapVertexHit
          && (!effSnap || !snap?.modes?.grid?.enabled)) {
        const p = applyPrecisionToDelta({ x: dxCanvas, y: dyCanvas }, PRECISION_FREE_TRANSLATE);
        dxCanvas = p.x;
        dyCanvas = p.y;
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
              // Phase 2.D — rotation snap is auto-engaging when master
              // + increment.enabled. Shift = precision (Blender's 5°→1°
              // = `precision`). Without snap, Shift = MOD_PRECISION
              // applied to the raw rotation delta.
              if (effSnap && snap?.modes?.increment?.enabled) {
                const inc = snap.modes.increment;
                const stepDeg = shift
                  ? (inc.precision > 0 ? inc.precision : 1)
                  : (inc.value > 0 ? inc.value : 5);
                dRot = snapAngleToIncrement(dRot, stepDeg);
              } else if (shift) {
                dRot = applyPrecisionToAngle(dRot, PRECISION_FREE_ROTATE);
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
              // Scale snap — sister of rotation. `increment.value` is
              // in degrees; scale step = value/100 (so 5° → 0.05×).
              if (effSnap && snap?.modes?.increment?.enabled) {
                const inc = snap.modes.increment;
                const stepDeg = shift
                  ? (inc.precision > 0 ? inc.precision : 1)
                  : (inc.value > 0 ? inc.value : 5);
                s = snapScaleToIncrement(s, stepDeg);
              } else if (shift) {
                s = applyPrecisionToScale(s, PRECISION_FREE_SCALE);
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
      ctrlHeldRef.current = e.ctrlKey || e.metaKey;
      applyDelta(e.clientX, e.clientY, e.shiftKey, ctrlHeldRef.current);
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
        applyDelta(cur.x, cur.y, e.shiftKey, ctrlHeldRef.current);
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
        applyDelta(cur.x, cur.y, e.shiftKey, ctrlHeldRef.current);
        return;
      }
      // Phase 2 audit fix (D-1) — Ctrl is MOD_SNAP_INV in Blender. Re-
      // fire applyDelta on Ctrl press/release so the snap state flips
      // immediately instead of waiting for the next mousemove.
      if (e.key === 'Control' || e.key === 'Meta') {
        const next = e.type === 'keydown';
        if (next !== ctrlHeldRef.current) {
          ctrlHeldRef.current = next;
          const cur = lastMouse.current;
          applyDelta(cur.x, cur.y, e.shiftKey, next);
        }
        return;
      }
      // Same for Shift — re-fire so MOD_PRECISION engages immediately.
      if (e.key === 'Shift') {
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, e.type === 'keydown', ctrlHeldRef.current);
        return;
      }
    }
    function onKeyUp(e) {
      // Mirror onKeyDown for Ctrl + Shift release so the modal updates
      // when the user lets go of MOD_PRECISION / MOD_SNAP_INV.
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
    window.addEventListener('keyup',   onKeyUp,   { capture: true });
    return () => {
      window.removeEventListener('mousemove', onMouseMove, { capture: true });
      window.removeEventListener('mousedown', onClick, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('keyup',   onKeyUp,   { capture: true });
      // Phase 2.C audit fix — abnormal exits (parent unmount mid-drag,
      // workspace switch, page navigation) bypass commit/cancel. Clear
      // the snap target here so the magenta dot doesn't stick around.
      useSnapStore.getState().clearSnapTarget();
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
