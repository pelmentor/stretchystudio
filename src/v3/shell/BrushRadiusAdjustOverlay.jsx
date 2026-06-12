// @ts-check
/* eslint-disable react/prop-types */

/**
 * Weight-Paint brush-radius-adjust modal overlay (F gesture).
 *
 * Active when `useBrushRadiusAdjustStore.getState().active` is true.
 * Owns the keyboard / wheel / mouse window-level events for the
 * duration via `useModalTool`. Per the framework contract, returning
 * `RUNNING_MODAL` suppresses propagation so neither the canvas's wheel
 * (which would V2D-zoom) nor the WeightPaintOverlay's pointerdown
 * (which would start a stroke) sees the event while the modal is live.
 *
 * # Gesture
 *
 * F (in Weight Paint mode) opens the modal. While active:
 *   - mousemove   → first move captures the anchor; subsequent moves
 *                   set `editorStore.brushSize` to
 *                   `distance(cursor, anchor)` in screen pixels
 *                   (Blender's `WM_OT_radial_control` gesture). No
 *                   `/zoom` divisor because brushSize is already in
 *                   screen-space pixels.
 *   - wheel       → step the brushSize up/down by 10%.
 *   - LMB / Enter → commit (keep current brushSize).
 *   - F again     → commit (keep current brushSize).
 *   - Esc / RMB   → cancel (restore the brushSize captured at F-press).
 *
 * # Sister overlay
 *
 * Mirrors [[RadiusAdjustOverlay]] (Edit-Mode proportional-edit radius).
 * The two are deliberately parallel — see brushRadiusAdjustStore.js
 * docblock for why they're not folded.
 *
 * Mirrors Blender's modal-handler stack semantic at
 * `wm_event_system.cc:2617-2747`; the radial-control modal itself
 * lives in `windowmanager/intern/wm_radial_control.cc`.
 *
 * @module v3/shell/BrushRadiusAdjustOverlay
 */

import { useCallback, useEffect } from 'react';
import { useBrushRadiusAdjustStore } from '../../store/brushRadiusAdjustStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useModalTool } from '../modalTool/index.js';

const MIN_BRUSH_SIZE = 2;
const MAX_BRUSH_SIZE = 1000;
const WHEEL_STEP_FACTOR = 0.1;
const WHEEL_STEP_MIN = 2;

export function BrushRadiusAdjustOverlay() {
  const active = useBrushRadiusAdjustStore((s) => s.active);
  const editMode = useEditorStore((s) => s.editMode);
  const isActive = active && editMode === 'weightPaint';

  // If editMode flips off 'weightPaint' while the modal is live
  // (Outliner / mode pill / programmatic mode change), restore the
  // captured size and cancel. Without this the store would stay
  // `active=true` but the handler would unregister, leaving an
  // un-cancellable zombie modal that resumes on next weight-paint entry.
  useEffect(() => {
    if (active && editMode !== 'weightPaint') {
      const { startBrushSize } = useBrushRadiusAdjustStore.getState();
      if (typeof startBrushSize === 'number') {
        useEditorStore.getState().setBrush({ brushSize: startBrushSize });
      }
      useBrushRadiusAdjustStore.getState().cancel();
    }
  }, [active, editMode]);

  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    if (!useBrushRadiusAdjustStore.getState().active) return 'PASS_THROUGH';

    function finishCommit() {
      useBrushRadiusAdjustStore.getState().commit();
    }

    function finishCancelRestore() {
      const { startBrushSize } = useBrushRadiusAdjustStore.getState();
      if (typeof startBrushSize === 'number') {
        useEditorStore.getState().setBrush({ brushSize: startBrushSize });
      }
      useBrushRadiusAdjustStore.getState().cancel();
    }

    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      const store = useBrushRadiusAdjustStore.getState();
      if (!store.anchorClient) {
        store.setAnchor({ x: me.clientX, y: me.clientY });
      } else {
        const dx = me.clientX - store.anchorClient.x;
        const dy = me.clientY - store.anchorClient.y;
        // brushSize is screen-pixel — distance directly, no /zoom divisor.
        const next = Math.max(MIN_BRUSH_SIZE, Math.min(MAX_BRUSH_SIZE, Math.hypot(dx, dy)));
        useEditorStore.getState().setBrush({ brushSize: next });
      }
      return 'RUNNING_MODAL';
    }

    if (e.type === 'wheel') {
      e.preventDefault();
      const we = /** @type {WheelEvent} */ (e);
      const cur = useEditorStore.getState().brushSize;
      const step = Math.max(WHEEL_STEP_MIN, cur * WHEEL_STEP_FACTOR);
      const next = we.deltaY < 0
        ? Math.min(MAX_BRUSH_SIZE, cur + step)
        : Math.max(MIN_BRUSH_SIZE, cur - step);
      useEditorStore.getState().setBrush({ brushSize: next });
      return 'RUNNING_MODAL';
    }

    if (e.type === 'mousedown') {
      const me = /** @type {MouseEvent} */ (e);
      e.preventDefault();
      if (me.button === 2) {
        finishCancelRestore();
        return 'CANCELLED';
      }
      // LMB / MMB / others — commit (keep current size).
      finishCommit();
      return 'FINISHED';
    }

    if (e.type === 'contextmenu') {
      e.preventDefault();
      finishCancelRestore();
      return 'CANCELLED';
    }

    if (e.type === 'keydown') {
      const ke = /** @type {KeyboardEvent} */ (e);
      if (ke.key === 'Escape') {
        e.preventDefault();
        finishCancelRestore();
        return 'CANCELLED';
      }
      if (ke.key === 'Enter') {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }
      // F again → commit (toggle off, keep current size).
      if ((ke.key === 'f' || ke.key === 'F')
          && !ke.ctrlKey && !ke.metaKey && !ke.altKey && !ke.shiftKey) {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }
      // Catch-all: while the modal is active, swallow other keys so
      // they don't start a competing operator (Shift+X eyedropper /
      // mode toggle / etc.). Matches the modal G/R/S RUNNING_MODAL
      // catch-all from Phase 2.A.
      e.preventDefault();
      return 'RUNNING_MODAL';
    }

    return 'PASS_THROUGH';
  }, []);

  useModalTool({ id: 'brushRadiusAdjust', isActive, handleEvent });

  // No render — the brush cursor is owned by WeightPaintOverlay
  // (`cursorOuterRef` / `cursorInnerRef`) which reads `editorStore.brushSize`
  // and re-paints on every pointermove. While the modal is live the
  // user's cursor moves drive brushSize through setBrush, which the
  // overlay subscribes to via useEditorStore, so the visible brush
  // circle scales in real time.
  return null;
}
