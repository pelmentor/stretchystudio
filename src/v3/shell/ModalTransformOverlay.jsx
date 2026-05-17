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
  // Audit-fix sweep — subscribe ONLY to the data slots that gate the
  // effect; read store actions inside the effect via `getState()` so
  // they don't appear in the deps array. Zustand actions are stable
  // refs in practice, but listing them as deps risks the entire
  // global-listener rebind cycle re-firing if a future store refactor
  // ever rebuilds the action set (e.g., via middleware). The data
  // slots — `kind` / `axis` / `startMouse` / `pivotCanvas` / `original`
  // — are the real triggers for setup; everything else is read
  // dynamically per mousemove.
  const kind        = useModalTransformStore((s) => s.kind);
  const axis        = useModalTransformStore((s) => s.axis);
  const startMouse  = useModalTransformStore((s) => s.startMouse);
  const pivotCanvas = useModalTransformStore((s) => s.pivotCanvas);
  const original    = useModalTransformStore((s) => s.original);
  // HUD-only subscriptions — these drive the render() body, not the
  // effect.
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
    // Audit-fix sweep — pull action refs once at effect entry via
    // `getState()` so the deps array can shrink to just data slots.
    // These refs are captured by the inner handlers and stay valid
    // for the lifetime of THIS modal session.
    const {
      setAxis, appendTyped, appendTypedAuto, popTyped,
      enterNumericMode, exitNumericMode, setLiveDelta,
      commit, cancel,
    } = useModalTransformStore.getState();
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
      //
      // Audit 4 #4 — numeric-input mode (`=` toggle). When enabled,
      // the modal HOLDS at the typed value (default 0) regardless of
      // mouse position; this matches Blender's NUM_EDIT_FULL semantics
      // where the typed string is the authoritative value. With an
      // empty buffer we treat typed as 0.
      const tb = useModalTransformStore.getState().typedBuffer;
      const numMode = useModalTransformStore.getState().numericMode;
      let typed = parseTyped(tb);
      let useTyped = Number.isFinite(typed);
      if (numMode && !useTyped) {
        // Numeric mode with empty buffer → hold at 0 (translate/rotate)
        // or 1 (scale identity). Mouse delta is suppressed.
        typed = kind === 'scale' ? 1 : 0;
        useTyped = true;
      }

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

      // Audit 4 #4 — lift rotation / scale magnitude out of the per-node
      // loop. Both are gesture-level (independent of which node the
      // transform applies to), so computing them once per applyDelta tick
      // lets us publish them to `liveDelta` for the always-visible HUD.
      let dRot = 0;
      let scaleMag = 1;
      if (kind === 'rotate') {
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
      } else if (kind === 'scale') {
        if (useTyped) {
          scaleMag = typed;
        } else {
          const d0 = Math.hypot(
            startMouse.x / zoom - pivotCanvas.x,
            startMouse.y / zoom - pivotCanvas.y,
          ) || 1;
          const d1 = Math.hypot(
            currentX / zoom - pivotCanvas.x,
            currentY / zoom - pivotCanvas.y,
          );
          scaleMag = d1 / d0;
          if (!Number.isFinite(scaleMag) || scaleMag <= 0) scaleMag = 1;
          // Scale snap — sister of rotation. `increment.value` is
          // in degrees; scale step = value/100 (so 5° → 0.05×).
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
          // Modal G/R/S always writes pose-shape values for bones
          // (writePoseValues routes to node.pose for bones, node.transform
          // for non-bones).
          const writer = writePoseValues;
          if (kind === 'translate') {
            const nx = (orig.x ?? 0) + dxCanvas;
            const ny = (orig.y ?? 0) + dyCanvas;
            writer(node, { x: nx, y: ny });
          } else if (kind === 'rotate') {
            writer(node, { rotation: (orig.rotation ?? 0) + dRot });
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

      // Audit 4 #4 — publish the live delta to the HUD. Frozen object
      // so referential equality against ZERO_DELTA stays meaningful for
      // selectors that bail on no-op reflows.
      setLiveDelta(Object.freeze({
        dx: dxCanvas,
        dy: dyCanvas,
        dRot,
        scale: scaleMag,
      }));
    }

    function onMouseMove(e) {
      lastMouse.current = { x: e.clientX, y: e.clientY };
      ctrlHeldRef.current = e.ctrlKey || e.metaKey;
      applyDelta(e.clientX, e.clientY, e.shiftKey, ctrlHeldRef.current);
    }
    function onClick(e) {
      // Audit-fix sweep (FID-B.4) — stopPropagation parity with the
      // sister vertex modal (`ModalVertexTransformOverlay.jsx:291`).
      // Without it, the click that commits the modal could also fall
      // through to a click-select on the canvas, immediately re-selecting
      // whatever was under the cursor.
      e.preventDefault();
      e.stopPropagation();
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
      e.stopPropagation();
      revert();
      endBatch();
      useSnapStore.getState().clearSnapTarget();
      cancel();
    }
    function onKeyDown(e) {
      // Audit 4 #4 — stopPropagation on every modal key, mirroring the
      // sister vertex modal (`ModalVertexTransformOverlay.jsx:304`'s
      // audit fix G-3 + G-4). Without it, other window keydown
      // listeners (command palette F3, AppShell global hotkeys) could
      // see the modal-consumed event and fire spurious actions while
      // the user is in the middle of a drag.
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        revert();
        endBatch();
        useSnapStore.getState().clearSnapTarget();
        cancel();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        endBatch();
        useSnapStore.getState().clearSnapTarget();
        commit();
        return;
      }
      // Audit 4 #4 — Shift+X / Shift+Y noop. Blender's `TFM_MODAL_PLANE_X`
      // / `TFM_MODAL_PLANE_Y` chord is the 3D plane lock-out (orthogonal-
      // axis exclusion); in 2D mode it's explicitly disabled at
      // `transform.cc:660-662` (`if (t->flag & T_2D_EDIT) return false`).
      // SS is a 2D editor, so the chord must be a noop instead of falling
      // through to the bare-axis toggle below.
      if (e.shiftKey && (e.code === 'KeyX' || e.code === 'KeyY')) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.code === 'KeyX') {
        e.preventDefault();
        e.stopPropagation();
        setAxis(axis === 'x' ? null : 'x');
        return;
      }
      if (e.code === 'KeyY') {
        e.preventDefault();
        e.stopPropagation();
        setAxis(axis === 'y' ? null : 'y');
        return;
      }
      // Audit-fix sweep (FID-B.3) — `=` is ONE-WAY enable; Ctrl+=
      // disables. Mirrors Blender's `numinput.cc:369-378` semantics:
      // pressing `=` with NUM_EDIT_FULL OFF turns it ON; pressing `=`
      // again does nothing. Only `Ctrl+=` clears the flag. Re-fire
      // applyDelta so the HUD and project reflect the change without
      // waiting on a mousemove.
      if (e.key === '=') {
        e.preventDefault();
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) {
          exitNumericMode();
        } else {
          enterNumericMode();
        }
        const cur = lastMouse.current;
        applyDelta(cur.x, cur.y, e.shiftKey, ctrlHeldRef.current);
        return;
      }
      // BVR-005 — typed numeric input. Digits / sign / decimal point
      // accumulate into modalTransformStore.typedBuffer. Backspace
      // pops. The buffer is then read by the next applyDelta tick
      // (we re-fire one immediately so the HUD + project reflect the
      // typed value without the user nudging the mouse).
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
        // Slice 5.U — `USER_FLAG_NUMINPUT_ADVANCED`
        // (`reference/blender/source/blender/makesdna/DNA_userdef_types.h:34`,
        // `numinput.cc:352-365`): when the pref is ON the first eligible
        // char enters numericMode atomically (Blender flips NUM_EDIT_FULL
        // on the same tick); when OFF the user must press `=` explicitly.
        // Read-through `getState()` so the user can toggle Preferences
        // and have it take effect next keystroke without restarting the
        // modal session.
        const advanced = usePreferencesStore.getState().useNumericInputAdvanced;
        if (advanced) {
          appendTypedAuto(e.key);
        } else {
          appendTyped(e.key);
        }
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
      // Audit-fix sweep (FID-B.4) — catch-all that swallows any
      // unrecognised key while the modal is live. Mirrors the sister
      // vertex modal's catch-all at `ModalVertexTransformOverlay.jsx:378-379`.
      // Without this, a stray `KeyG` / `KeyR` / `KeyS` / `KeyE` /
      // `KeyM` pressed mid-drag would bubble to the global dispatcher
      // and start a competing modal — the exact bug fix G-3 + G-4 closed
      // for the vertex sister.
      e.preventDefault();
      e.stopPropagation();
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
    // Audit-fix sweep — deps array is now data-only. Store actions
    // (setAxis, appendTyped, etc.) are read via `getState()` at effect
    // entry and don't appear here; the effect re-binds only when the
    // gesture's data slots change, not when an unrelated render churns
    // the action selectors.
  }, [kind, axis, startMouse, pivotCanvas, original]);

  if (!kind) return null;

  // Visible HUD: small badge at the top showing kind + axis + numeric
  // mode + always-visible delta + typed buffer + hint strip.
  //
  // Audit 4 #4 — the prior HUD only showed a value when the user was
  // typing. Now the live delta surfaces every frame so users can read
  // the gesture's magnitude without committing. Typed buffer (when
  // present) overrides the live readout — that's the user's intent.
  // Numeric mode (`=`) shows a "= 0" hint when the buffer is empty so
  // the user knows the modal is held at zero waiting for input.
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
