// @ts-check
/* eslint-disable react/prop-types */

/**
 * Sculpt brush-strength-adjust modal overlay (Shift+F gesture).
 *
 * Sister to [[BrushStrengthAdjustOverlay]] (weight paint). Same
 * dispatch policy, but writes `editorStore.sculpt.strength` ∈ [0,1]
 * via `setSculpt({strength})`. Distance → strength mapping unchanged:
 * `clamp(distance / 200px, 0, 1)`.
 *
 * @module v3/shell/SculptStrengthAdjustOverlay
 */

import { useCallback, useEffect } from 'react';
import { useSculptStrengthAdjustStore } from '../../store/sculptStrengthAdjustStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useModalTool } from '../modalTool/index.js';

const STRENGTH_PIXELS_PER_UNIT = 200;
const WHEEL_STEP = 0.05;

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

export function SculptStrengthAdjustOverlay() {
  const active = useSculptStrengthAdjustStore((s) => s.active);
  const editMode = useEditorStore((s) => s.editMode);
  const isActive = active && editMode === 'sculpt';

  useEffect(() => {
    if (active && editMode !== 'sculpt') {
      const { startStrength } = useSculptStrengthAdjustStore.getState();
      if (typeof startStrength === 'number') {
        useEditorStore.getState().setSculpt({ strength: startStrength });
      }
      useSculptStrengthAdjustStore.getState().cancel();
    }
  }, [active, editMode]);

  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    if (!useSculptStrengthAdjustStore.getState().active) return 'PASS_THROUGH';

    function finishCommit() {
      useSculptStrengthAdjustStore.getState().commit();
    }

    function finishCancelRestore() {
      const { startStrength } = useSculptStrengthAdjustStore.getState();
      if (typeof startStrength === 'number') {
        useEditorStore.getState().setSculpt({ strength: startStrength });
      }
      useSculptStrengthAdjustStore.getState().cancel();
    }

    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      const store = useSculptStrengthAdjustStore.getState();
      if (!store.anchorClient) {
        store.setAnchor({ x: me.clientX, y: me.clientY });
      } else {
        const dx = me.clientX - store.anchorClient.x;
        const dy = me.clientY - store.anchorClient.y;
        const next = clamp01(Math.hypot(dx, dy) / STRENGTH_PIXELS_PER_UNIT);
        useEditorStore.getState().setSculpt({ strength: next });
      }
      return 'RUNNING_MODAL';
    }

    if (e.type === 'wheel') {
      e.preventDefault();
      const we = /** @type {WheelEvent} */ (e);
      const cur = useEditorStore.getState().sculpt?.strength ?? 0.5;
      const next = we.deltaY < 0 ? clamp01(cur + WHEEL_STEP) : clamp01(cur - WHEEL_STEP);
      useEditorStore.getState().setSculpt({ strength: next });
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
      // Bare F OR Shift+F commits — same as BrushStrengthAdjustOverlay
      // (user mid-gesture may still hold Shift when committing).
      if ((ke.key === 'f' || ke.key === 'F')
          && !ke.ctrlKey && !ke.metaKey && !ke.altKey) {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }
      e.preventDefault();
      return 'RUNNING_MODAL';
    }

    return 'PASS_THROUGH';
  }, []);

  useModalTool({ id: 'sculptStrengthAdjust', isActive, handleEvent });

  return null;
}
