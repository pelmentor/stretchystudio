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
 * # Modal-tool framework migration (Phase 2.A, 2026-06-12)
 *
 * Previously this overlay attached its own `window.addEventListener`
 * calls inside a useEffect — racing with every other modal overlay
 * AND with the operator dispatcher. Now it registers a single handler
 * via `useModalTool`; the central `ModalToolInputDispatcher` (mounted
 * at AppShell) walks the active modal stack and consults each handler.
 * Return values:
 *   - 'PASS_THROUGH'   → event falls to next handler / operator dispatcher
 *   - 'RUNNING_MODAL'  → event consumed; dispatcher calls stopPropagation()
 *   - 'FINISHED'       → terminal success (commit)
 *   - 'CANCELLED'      → terminal cancel (Esc / RMB)
 *
 * Mirrors Blender's modal-handler stack walk at
 * `reference/blender/source/blender/windowmanager/intern/wm_event_system.cc:2617-2747`
 * + `wm_handler_operator_call` return-value semantics. See
 * `src/v3/modalTool/` for the framework substrate.
 *
 * Modal G/R/S, unlike circle-select, OWNS most keystrokes — axis-lock
 * (X/Y) chord, snap modifiers (Shift/Ctrl), numeric typed input (=,
 * 0-9, -, ., backspace), commit (Enter / LMB), cancel (Esc / RMB).
 * Everything else returns `RUNNING_MODAL` to swallow it — matches
 * Blender's `transform_modal` which returns `OPERATOR_RUNNING_MODAL`
 * for unhandled keys (`transform.cc:1380+`). Don't pass-through keys
 * like `G` / `R` / `S` / `X` (without axis-lock context) — they'd
 * trigger a competing modal mid-drag.
 *
 * @module v3/shell/ModalTransformOverlay
 */

import { useCallback, useEffect, useRef } from 'react';
import { useModalTransformStore } from '../../store/modalTransformStore.js';
import { useProjectStore } from '../../store/projectStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useSelectionStore } from '../../store/selectionStore.js';
import { useCaptureStore } from '../../store/captureStore.js';
import { endBatch } from '../../store/undoHistory.js';
import { writePoseValues } from '../../renderer/animationEngine.js';
import { useModalTool } from '../modalTool/index.js';
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

/** Render the live delta for the HUD. Mirrors Blender's transform-mode
 *  header echo functions:
 *    - translate → `headerTranslation`
 *      (`reference/blender/source/blender/editors/transform/transform_mode_translate.cc:173`)
 *    - rotate    → `headerRotation`
 *      (`reference/blender/source/blender/editors/transform/transform_mode.cc:564`)
 *    - scale     → `headerResize`
 *      (`reference/blender/source/blender/editors/transform/transform_mode.cc:870`)
 *
 *  Audit-fix sweep (FID-B.2) — earlier banner cited "transform.cc:
 *  headerprint_*" which doesn't exist. Updated to actual symbols.
 *  Precisions bumped to match Blender:
 *    - rotate: `%.2f` (`transform_mode.cc:579`)         → `.toFixed(2)` (was correct)
 *    - scale:  `%.4f` (`transform_mode.cc:878-880`)     → `.toFixed(4)` (was 3)
 *    - translate: per `transform_mode_translate.cc:168` Blender renders
 *      4 decimal places via `BKE_unit_value_as_string_scaled` precision=4.
 *      SS canvas-px is unitless, so we bump from 1 → 2 decimals (the SS
 *      canvas is typically 1000–2000 px wide; sub-pixel precision is
 *      meaningful at high zoom but 4 decimals is overkill at 1× zoom).
 *      A future preference may expose this.
 *
 *  Translate unconstrained: `dx, dy` pair (Blender's "D: %s   D: %s" at
 *  `transform_mode_translate.cc:185-192`).
 */
function formatLiveDelta(kind, axis, d) {
  if (kind === 'rotate') {
    const deg = (d.dRot ?? 0) * 180 / Math.PI;
    return deg.toFixed(2);
  }
  if (kind === 'scale') {
    return (d.scale ?? 1).toFixed(4);
  }
  // translate
  if (axis === 'x') return (d.dx ?? 0).toFixed(2);
  if (axis === 'y') return (d.dy ?? 0).toFixed(2);
  // unconstrained: show as "x, y" pair
  return `${(d.dx ?? 0).toFixed(2)}, ${(d.dy ?? 0).toFixed(2)} `;
}

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
  // Data subscriptions — drive the effect / handler closure / HUD.
  const kind        = useModalTransformStore((s) => s.kind);
  const axis        = useModalTransformStore((s) => s.axis);
  const startMouse  = useModalTransformStore((s) => s.startMouse);
  const pivotCanvas = useModalTransformStore((s) => s.pivotCanvas);
  const original    = useModalTransformStore((s) => s.original);
  // HUD-only subscriptions — these drive the render() body.
  const typedBuffer = useModalTransformStore((s) => s.typedBuffer);
  const numericMode = useModalTransformStore((s) => s.numericMode);
  const liveDelta   = useModalTransformStore((s) => s.liveDelta);

  // Track last mouse position so typed-buffer keystrokes can re-apply
  // the modal effect without waiting for a mousemove. Initialised to
  // startMouse (or origin) so the first typed digit lands immediately.
  const lastMouse = useRef({ x: 0, y: 0 });

  // Phase 2 — snap-to-vertex needs client→canvas-px conversion. Capture
  // the canvas rect once at modal mount; the canvas doesn't move during
  // a drag, so a single snapshot is correct + cheap. Falls back to a
  // zero-offset rect if no canvas is mounted (snap will degrade to
  // pure-zoom math, still finite — never crashes).
  const canvasRectRef = useRef(/** @type {DOMRect|null} */ (null));
  // Phase 2 audit fix (D-3, D-4) — built fresh per modal session. Hash
  // takes ~1 ms for ~5000 verts; modal-only lifetime sidesteps the
  // staleness-cache + global-invalidation pattern that the prior
  // approach used (see `lib/snap/snapHash.js` jsdoc).
  const snapHashRef = useRef(/** @type {any} */ (null));
  const anchorVertsRef = useRef(/** @type {Array<{x:number,y:number}>} */ ([]));
  const ctrlHeldRef = useRef(false);

  // ── Per-session setup ────────────────────────────────────────────
  //
  // Runs once when the modal first sets [kind, startMouse, pivotCanvas]
  // (modal entry). Cleanup runs on modal end. Setup captures the canvas
  // rect + builds the snap hash + enumerates anchor verts for the
  // user's selection. Modal-tool registration is separate (useModalTool
  // below) — keeps lifecycle responsibilities cleanly separated.
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

    // Seed lastMouse from startMouse so typed digits work before any
    // mousemove fires (e.g. user presses G then immediately types).
    lastMouse.current = { x: startMouse.x, y: startMouse.y };

    return () => {
      // Phase 2.C audit fix — abnormal exits (parent unmount mid-drag,
      // workspace switch, page navigation) bypass commit/cancel. Clear
      // the snap target here so the magenta dot doesn't stick around.
      useSnapStore.getState().clearSnapTarget();
    };
  }, [kind, startMouse, pivotCanvas]);

  // ── Event handler ────────────────────────────────────────────────
  //
  // Single dispatch entry — branches on `e.type`. Reads store actions
  // via `getState()` at handler time so the deps array stays minimal
  // (data slots only). Returning `RUNNING_MODAL` for unhandled keys
  // matches Blender's `transform_modal` — the modal owns most keystrokes
  // mid-drag; passing them through would trigger a competing modal.
  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    if (!kind || !startMouse || !pivotCanvas) return 'PASS_THROUGH';

    // ── Inner helpers — closed over kind/axis/startMouse/pivotCanvas/original ─

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

      const tb = useModalTransformStore.getState().typedBuffer;
      const numMode = useModalTransformStore.getState().numericMode;
      let typed = parseTyped(tb);
      let useTyped = Number.isFinite(typed);
      if (numMode && !useTyped) {
        typed = kind === 'scale' ? 1 : 0;
        useTyped = true;
      }

      if (useTyped && kind === 'translate') {
        if (axis === 'y') { dxCanvas = 0;     dyCanvas = typed; }
        else              { dxCanvas = typed; dyCanvas = 0;     }
      }

      // Phase 2 audit fix (D-1, D-2) — Blender-faithful gesture model.
      //   - master `enabled`: the magnet toggle. ON → snap auto-engages.
      //   - Shift: MOD_PRECISION (fine-grained input; never engages snap).
      //   - Ctrl:  MOD_SNAP_INV (XOR'd against master so user can flip
      //            mid-drag).
      const snap = usePreferencesStore.getState().snap;
      const masterOn = !!snap?.enabled;
      const effSnap = ctrl ? !masterOn : masterOn;
      let snapVertexHit = false;

      if (kind === 'translate' && !useTyped && effSnap && snap?.modes?.vertex?.enabled) {
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

      if (kind === 'translate' && !useTyped && shift && !snapVertexHit
          && (!effSnap || !snap?.modes?.grid?.enabled)) {
        const p = applyPrecisionToDelta({ x: dxCanvas, y: dyCanvas }, PRECISION_FREE_TRANSLATE);
        dxCanvas = p.x;
        dyCanvas = p.y;
      }

      let dRot = 0;
      let scaleMag = 1;
      if (kind === 'rotate') {
        if (useTyped) {
          dRot = typed * Math.PI / 180;
        } else {
          // 2026-06-10 fix — convert BOTH mouse positions to canvas
          // coords before subtracting the canvas-space pivot. See
          // memory `[[modal-rotation-units-and-pivot-frame]]`.
          const rect = canvasRectRef.current ?? { left: 0, top: 0 };
          const sx = (startMouse.x - rect.left) / zoom - view.panX / zoom - pivotCanvas.x;
          const sy = (startMouse.y - rect.top)  / zoom - view.panY / zoom - pivotCanvas.y;
          const cx2 = (currentX - rect.left) / zoom - view.panX / zoom - pivotCanvas.x;
          const cy2 = (currentY - rect.top)  / zoom - view.panY / zoom - pivotCanvas.y;
          dRot = Math.atan2(cy2, cx2) - Math.atan2(sy, sx);
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
      } else if (kind === 'scale') {
        if (useTyped) {
          scaleMag = typed;
        } else {
          const rect = canvasRectRef.current ?? { left: 0, top: 0 };
          const d0 = Math.hypot(
            (startMouse.x - rect.left) / zoom - view.panX / zoom - pivotCanvas.x,
            (startMouse.y - rect.top)  / zoom - view.panY / zoom - pivotCanvas.y,
          ) || 1;
          const d1 = Math.hypot(
            (currentX - rect.left) / zoom - view.panX / zoom - pivotCanvas.x,
            (currentY - rect.top)  / zoom - view.panY / zoom - pivotCanvas.y,
          );
          scaleMag = d1 / d0;
          if (!Number.isFinite(scaleMag) || scaleMag <= 0) scaleMag = 1;
          if (effSnap && snap?.modes?.increment?.enabled) {
            const inc = snap.modes.increment;
            const stepDeg = shift
              ? (inc.precision > 0 ? inc.precision : 1)
              : (inc.value > 0 ? inc.value : 5);
            scaleMag = snapScaleToIncrement(scaleMag, stepDeg);
          } else if (shift) {
            scaleMag = applyPrecisionToScale(scaleMag, PRECISION_FREE_SCALE);
          }
        }
      }

      const updateProject = useProjectStore.getState().updateProject;
      updateProject((proj) => {
        for (const [nodeId, orig] of original) {
          const node = proj.nodes.find((n) => n.id === nodeId);
          if (!node) continue;
          const writer = writePoseValues;
          if (kind === 'translate') {
            const nx = (orig.x ?? 0) + dxCanvas;
            const ny = (orig.y ?? 0) + dyCanvas;
            writer(node, { x: nx, y: ny });
          } else if (kind === 'rotate') {
            // Unit conversion: dRot is in RADIANS, node rotation is DEGREES.
            // See memory `[[modal-rotation-units-and-pivot-frame]]`.
            writer(node, { rotation: (orig.rotation ?? 0) + dRot * 180 / Math.PI });
          } else if (kind === 'scale') {
            const sx = axis === 'y' ? 1 : scaleMag;
            const sy = axis === 'x' ? 1 : scaleMag;
            writer(node, {
              scaleX: (orig.scaleX ?? 1) * sx,
              scaleY: (orig.scaleY ?? 1) * sy,
            });
          }
        }
      }, { skipHistory: true });

      const { setLiveDelta } = useModalTransformStore.getState();
      setLiveDelta(Object.freeze({
        dx: dxCanvas,
        dy: dyCanvas,
        dRot,
        scale: scaleMag,
      }));
    }

    function revert() {
      const updateProject = useProjectStore.getState().updateProject;
      updateProject((proj) => {
        for (const [nodeId, orig] of original) {
          const node = proj.nodes.find((n) => n.id === nodeId);
          if (!node) continue;
          writePoseValues(node, orig);
        }
      }, { skipHistory: true });
    }

    function finishCommit() {
      endBatch();
      useSnapStore.getState().clearSnapTarget();
      useModalTransformStore.getState().commit();
    }

    function finishCancel() {
      revert();
      endBatch();
      useSnapStore.getState().clearSnapTarget();
      useModalTransformStore.getState().cancel();
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
        finishCancel();
        return 'CANCELLED';
      }
      finishCommit();
      return 'FINISHED';
    }

    if (e.type === 'contextmenu') {
      // Right-click = cancel. Suppress browser menu.
      e.preventDefault();
      finishCancel();
      return 'CANCELLED';
    }

    if (e.type === 'keydown') {
      const ke = /** @type {KeyboardEvent} */ (e);

      if (ke.key === 'Escape') {
        e.preventDefault();
        finishCancel();
        return 'CANCELLED';
      }
      if (ke.key === 'Enter') {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }

      // Audit 4 #4 — Shift+X / Shift+Y noop in 2D editor.
      // (`transform.cc:660-662` — `if (t->flag & T_2D_EDIT) return false`).
      if (ke.shiftKey && (ke.code === 'KeyX' || ke.code === 'KeyY')) {
        e.preventDefault();
        return 'RUNNING_MODAL';
      }
      if (ke.code === 'KeyX') {
        e.preventDefault();
        useModalTransformStore.getState().setAxis(axis === 'x' ? null : 'x');
        return 'RUNNING_MODAL';
      }
      if (ke.code === 'KeyY') {
        e.preventDefault();
        useModalTransformStore.getState().setAxis(axis === 'y' ? null : 'y');
        return 'RUNNING_MODAL';
      }

      // Audit-fix sweep (FID-B.3) — `=` is ONE-WAY enable; Ctrl+= disables.
      // Mirrors `numinput.cc:369-378`.
      if (ke.key === '=') {
        e.preventDefault();
        const store = useModalTransformStore.getState();
        if (ke.ctrlKey || ke.metaKey) store.exitNumericMode();
        else store.enterNumericMode();
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, ke.shiftKey, ctrlHeldRef.current);
        return 'RUNNING_MODAL';
      }

      // BVR-005 — typed numeric input.
      if (ke.key === 'Backspace') {
        e.preventDefault();
        useModalTransformStore.getState().popTyped();
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
        // Slice 5.U — `USER_FLAG_NUMINPUT_ADVANCED` (`numinput.cc:352-365`).
        const advanced = usePreferencesStore.getState().useNumericInputAdvanced;
        const store = useModalTransformStore.getState();
        if (advanced) store.appendTypedAuto(ke.key);
        else          store.appendTyped(ke.key);
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, ke.shiftKey, ctrlHeldRef.current);
        return 'RUNNING_MODAL';
      }

      // Phase 2 audit fix (D-1) — Ctrl is MOD_SNAP_INV in Blender.
      if (ke.key === 'Control' || ke.key === 'Meta') {
        if (!ctrlHeldRef.current) {
          ctrlHeldRef.current = true;
          const cur = lastMouse.current;
          applyDelta(cur.x, cur.y, ke.shiftKey, true);
        }
        return 'RUNNING_MODAL';
      }
      // Same for Shift — re-fire so MOD_PRECISION engages immediately.
      if (ke.key === 'Shift') {
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, true, ctrlHeldRef.current);
        return 'RUNNING_MODAL';
      }

      // Audit-fix sweep (FID-B.4) — catch-all: modal transform owns
      // ALL keystrokes mid-drag. Returning 'RUNNING_MODAL' tells the
      // dispatcher to stopPropagation() — prevents stray `KeyG` /
      // `KeyR` / `KeyS` / `KeyE` / `KeyM` from starting a competing
      // modal mid-drag. Mirrors Blender's `transform_modal` which
      // returns `OPERATOR_RUNNING_MODAL` for unrecognised events.
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
  }, [kind, axis, startMouse, pivotCanvas, original]);

  useModalTool({ id: 'modalTransform', isActive: !!kind, handleEvent });

  if (!kind) return null;

  // Visible HUD: small badge at the top showing kind + axis + numeric
  // mode + always-visible delta + typed buffer + hint strip.
  const unit = kind === 'rotate' ? '°' : kind === 'scale' ? '×' : 'px';
  const showTyped = (typedBuffer ?? '').length > 0;
  const liveValueText = formatLiveDelta(kind, axis, liveDelta);
  return (
    <>
      <SnapTargetDot kind={kind} />
      <div className="fixed top-12 left-1/2 -translate-x-1/2 z-[200] pointer-events-none flex items-center gap-2 px-3 py-1.5 bg-popover/95 border border-border rounded text-xs font-mono shadow-lg">
        <span className="text-primary uppercase tracking-wider">{kind}</span>
        {axis ? <span className="text-amber-500">axis: {axis.toUpperCase()}</span> : null}
        {numericMode ? (
          <span className="text-blue-400" title="Numeric input mode (=)">= </span>
        ) : null}
        {showTyped ? (
          <span className="text-foreground">
            {typedBuffer}<span className="text-muted-foreground/70">{unit}</span>
          </span>
        ) : (
          <span className="text-foreground/80">
            {liveValueText}<span className="text-muted-foreground/70">{unit}</span>
          </span>
        )}
        <span className="text-muted-foreground">
          Type · Click/Enter confirm · Esc cancel · X/Y axis · = numeric · Shift snap
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
