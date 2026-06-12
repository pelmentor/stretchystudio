// @ts-check
/* eslint-disable react/prop-types */

/**
 * Sculpt brush-radius-adjust modal overlay (F gesture).
 *
 * Sister to [[BrushRadiusAdjustOverlay]]. Same handler shape, but
 * writes `editorStore.sculpt.size` (5..300 in N-panel; clamped to
 * 2..1000 here so the modal can grow past the slider limit if the
 * user is dragging far — Blender lets the radial-control exceed the
 * UI slider limits the same way).
 *
 * # Gesture
 *
 * F (in Sculpt mode) opens the modal:
 *   - mousemove   → first move captures anchor; subsequent moves set
 *                   `sculpt.size = distance(cursor, anchor)` in
 *                   screen-px. Sculpt stroke converts to mesh-local at
 *                   stroke begin (CanvasViewport.jsx:3097); the modal
 *                   never sees mesh units.
 *   - wheel       → step ±10% (relative — same as weight-paint radius).
 *   - LMB / Enter → commit.
 *   - F again     → commit.
 *   - Esc / RMB   → cancel (restore start size).
 *
 * @module v3/shell/SculptRadiusAdjustOverlay
 */

import { useCallback, useEffect } from 'react';
import { useSculptRadiusAdjustStore } from '../../store/sculptRadiusAdjustStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useModalTool } from '../modalTool/index.js';

const MIN_SIZE = 2;
const MAX_SIZE = 1000;
const WHEEL_STEP_FACTOR = 0.1;
const WHEEL_STEP_MIN = 2;

export function SculptRadiusAdjustOverlay() {
  const active = useSculptRadiusAdjustStore((s) => s.active);
  const editMode = useEditorStore((s) => s.editMode);
  const isActive = active && editMode === 'sculpt';

  useEffect(() => {
    if (active && editMode !== 'sculpt') {
      const { startSize } = useSculptRadiusAdjustStore.getState();
      if (typeof startSize === 'number') {
        useEditorStore.getState().setSculpt({ size: startSize });
      }
      useSculptRadiusAdjustStore.getState().cancel();
    }
  }, [active, editMode]);

  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    if (!useSculptRadiusAdjustStore.getState().active) return 'PASS_THROUGH';

    function finishCommit() {
      useSculptRadiusAdjustStore.getState().commit();
    }

    function finishCancelRestore() {
      const { startSize } = useSculptRadiusAdjustStore.getState();
      if (typeof startSize === 'number') {
        useEditorStore.getState().setSculpt({ size: startSize });
      }
      useSculptRadiusAdjustStore.getState().cancel();
    }

    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      const store = useSculptRadiusAdjustStore.getState();
      if (!store.anchorClient) {
        store.setAnchor({ x: me.clientX, y: me.clientY });
      } else {
        const dx = me.clientX - store.anchorClient.x;
        const dy = me.clientY - store.anchorClient.y;
        const next = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.hypot(dx, dy)));
        useEditorStore.getState().setSculpt({ size: next });
      }
      return 'RUNNING_MODAL';
    }

    if (e.type === 'wheel') {
      e.preventDefault();
      const we = /** @type {WheelEvent} */ (e);
      const cur = useEditorStore.getState().sculpt?.size ?? 80;
      const step = Math.max(WHEEL_STEP_MIN, cur * WHEEL_STEP_FACTOR);
      const next = we.deltaY < 0
        ? Math.min(MAX_SIZE, cur + step)
        : Math.max(MIN_SIZE, cur - step);
      useEditorStore.getState().setSculpt({ size: next });
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
      if ((ke.key === 'f' || ke.key === 'F')
          && !ke.ctrlKey && !ke.metaKey && !ke.altKey && !ke.shiftKey) {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }
      e.preventDefault();
      return 'RUNNING_MODAL';
    }

    return 'PASS_THROUGH';
  }, []);

  useModalTool({ id: 'sculptRadiusAdjust', isActive, handleEvent });

  return null;
}
