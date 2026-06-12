// @ts-check
/* eslint-disable react/prop-types */

/**
 * Weight-Paint brush-strength-adjust modal overlay (Shift+F gesture).
 *
 * Active when `useBrushStrengthAdjustStore.getState().active` is true.
 * Sister overlay to [[BrushRadiusAdjustOverlay]] — same handler shape,
 * but writes `editorStore.brushStrength` ∈ [0,1] from cursor distance.
 *
 * # Gesture
 *
 * Shift+F (in Weight Paint mode) opens the modal. While active:
 *   - mousemove   → first move captures anchor; subsequent moves set
 *                   `brushStrength = clamp(distance / STRENGTH_PIXELS, 0, 1)`.
 *                   STRENGTH_PIXELS = 200 (so dragging 200px from anchor
 *                   reaches strength=1.0; matches Blender's default dial
 *                   throw for fraction-typed radial-control gestures).
 *   - wheel       → step strength ±0.05 (5% absolute, not relative —
 *                   since the value is already a fraction, a relative
 *                   step gets useless near 0).
 *   - LMB / Enter → commit (keep current strength).
 *   - Shift+F again → commit (toggle off).
 *   - Esc / RMB   → cancel (restore the strength captured at Shift+F-press).
 *
 * Mirrors Blender's modal-handler stack at
 * `wm_event_system.cc:2617-2747`; the radial-control modal lives in
 * `windowmanager/intern/wm_radial_control.cc`.
 *
 * @module v3/shell/BrushStrengthAdjustOverlay
 */

import { useCallback, useEffect } from 'react';
import { useBrushStrengthAdjustStore } from '../../store/brushStrengthAdjustStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useModalTool } from '../modalTool/index.js';

const STRENGTH_PIXELS_PER_UNIT = 200;
const WHEEL_STEP = 0.05;

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export function BrushStrengthAdjustOverlay() {
  const active = useBrushStrengthAdjustStore((s) => s.active);
  const editMode = useEditorStore((s) => s.editMode);
  const isActive = active && editMode === 'weightPaint';

  // Mode flip → restore + cancel (mirror of BrushRadiusAdjustOverlay
  // policy — flipping mode shouldn't silently lose start value).
  useEffect(() => {
    if (active && editMode !== 'weightPaint') {
      const { startBrushStrength } = useBrushStrengthAdjustStore.getState();
      if (typeof startBrushStrength === 'number') {
        useEditorStore.getState().setBrushStrength(startBrushStrength);
      }
      useBrushStrengthAdjustStore.getState().cancel();
    }
  }, [active, editMode]);

  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    if (!useBrushStrengthAdjustStore.getState().active) return 'PASS_THROUGH';

    function finishCommit() {
      useBrushStrengthAdjustStore.getState().commit();
    }

    function finishCancelRestore() {
      const { startBrushStrength } = useBrushStrengthAdjustStore.getState();
      if (typeof startBrushStrength === 'number') {
        useEditorStore.getState().setBrushStrength(startBrushStrength);
      }
      useBrushStrengthAdjustStore.getState().cancel();
    }

    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      const store = useBrushStrengthAdjustStore.getState();
      if (!store.anchorClient) {
        store.setAnchor({ x: me.clientX, y: me.clientY });
      } else {
        const dx = me.clientX - store.anchorClient.x;
        const dy = me.clientY - store.anchorClient.y;
        const screenDist = Math.hypot(dx, dy);
        const next = clamp01(screenDist / STRENGTH_PIXELS_PER_UNIT);
        useEditorStore.getState().setBrushStrength(next);
      }
      return 'RUNNING_MODAL';
    }

    if (e.type === 'wheel') {
      e.preventDefault();
      const we = /** @type {WheelEvent} */ (e);
      const cur = useEditorStore.getState().brushStrength;
      const next = we.deltaY < 0 ? clamp01(cur + WHEEL_STEP) : clamp01(cur - WHEEL_STEP);
      useEditorStore.getState().setBrushStrength(next);
      return 'RUNNING_MODAL';
    }

    if (e.type === 'mousedown') {
      const me = /** @type {MouseEvent} */ (e);
      e.preventDefault();
      if (me.button === 2) {
        finishCancelRestore();
        return 'CANCELLED';
      }
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
      // Shift+F again → commit (toggle off, keep current strength).
      // Bare F during the modal also commits (the user's mid-gesture
      // habit) — neither bare-F nor Shift+F is meaningful here so we
      // treat both as the toggle-off chord.
      if ((ke.key === 'f' || ke.key === 'F')
          && !ke.ctrlKey && !ke.metaKey && !ke.altKey) {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }
      // Catch-all: while the modal is active, swallow other keys so
      // they don't start a competing operator.
      e.preventDefault();
      return 'RUNNING_MODAL';
    }

    return 'PASS_THROUGH';
  }, []);

  useModalTool({ id: 'brushStrengthAdjust', isActive, handleEvent });

  // No render — strength is invisible directly; the user sees the
  // effect on the next paint stroke. (Brush ring shows size, not
  // strength.) A future enhancement could render a temporary HUD
  // showing the current numeric strength while the modal is live.
  return null;
}
