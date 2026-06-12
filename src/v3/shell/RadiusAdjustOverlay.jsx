// @ts-check
/* eslint-disable react/prop-types */

/**
 * F-radius-adjust modal overlay (proportional-edit radius gesture).
 *
 * Active when `useRadiusAdjustStore.getState().active` is true. Owns
 * the keyboard / wheel / mouse window-level events for the duration
 * via `useModalTool`. Per the framework contract, returning
 * `RUNNING_MODAL` suppresses propagation so the canvas's own wheel
 * and pointerdown listeners don't see the event.
 *
 * # Gesture
 *
 * F (in Edit Mode) opens the modal. While active:
 *   - mousemove   → first move captures the anchor; subsequent moves
 *                   set `proportionalEdit.radius` to
 *                   `distance(cursor, anchor) / zoom` (Blender's
 *                   `WM_OT_radial_control` gesture).
 *   - wheel       → step the radius up/down by 10% (Blender's pattern
 *                   for `WM_RT_RADIAL_CONTROL` wheel events).
 *   - LMB / Enter → commit (keep current radius).
 *   - F again     → commit (keep current radius).
 *   - Esc / RMB   → cancel (restore the radius captured at F-press).
 *
 * # Pre-migration history
 *
 * Pre-Phase-2.C (2026-06-12) the gesture state lived in
 * `CanvasViewport.jsx`'s local `radiusAdjustModeRef`, with F/Esc
 * handled by a window keydown listener at ~line 1907/1919 and the
 * cursor / wheel / commit handling scattered across the canvas's
 * pointer-flow handlers (wheel ~line 2740, pointerdown ~line 2839,
 * pointermove ~line 3650). The framework migration centralises all
 * those branches here — the canvas keeps only the proportional-edit
 * ring rendering (which now reads `useRadiusAdjustStore` for the
 * anchor + active flag).
 *
 * Mirrors Blender's modal-handler stack semantic at
 * `wm_event_system.cc:2617-2747`; the radial-control modal itself
 * lives in `windowmanager/intern/wm_radial_control.cc`.
 *
 * @module v3/shell/RadiusAdjustOverlay
 */

import { useCallback, useEffect } from 'react';
import { useRadiusAdjustStore } from '../../store/radiusAdjustStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { useModalTool } from '../modalTool/index.js';

const MIN_RADIUS = 5;
const WHEEL_STEP_FACTOR = 0.1;
const WHEEL_STEP_MIN = 2;

export function RadiusAdjustOverlay() {
  const active = useRadiusAdjustStore((s) => s.active);
  const editMode = useEditorStore((s) => s.editMode);
  const isActive = active && editMode === 'edit';

  // If editMode flips off 'edit' while the modal is live (Outliner / mode
  // pill / programmatic mode change), restore the captured radius and
  // cancel — matches the pre-migration `useEffect` exit-on-non-mesh path
  // at CanvasViewport line 1849. Without this the store would stay
  // `active=true` but the handler would unregister, leaving an
  // un-cancellable zombie modal that resumes on next edit-mode entry.
  useEffect(() => {
    if (active && editMode !== 'edit') {
      const { startRadius } = useRadiusAdjustStore.getState();
      if (typeof startRadius === 'number') {
        usePreferencesStore.getState().setProportionalEdit({ radius: startRadius });
      }
      useRadiusAdjustStore.getState().cancel();
    }
  }, [active, editMode]);

  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    if (!useRadiusAdjustStore.getState().active) return 'PASS_THROUGH';

    function finishCommit() {
      useRadiusAdjustStore.getState().commit();
    }

    function finishCancelRestore() {
      const { startRadius } = useRadiusAdjustStore.getState();
      if (typeof startRadius === 'number') {
        usePreferencesStore.getState().setProportionalEdit({ radius: startRadius });
      }
      useRadiusAdjustStore.getState().cancel();
    }

    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      const store = useRadiusAdjustStore.getState();
      if (!store.anchorClient) {
        // First pointermove after F-press — capture the anchor here so
        // users who entered mesh-edit via Outliner / ModePill (without
        // hovering the canvas first) still get a sane anchor. Matches
        // the pre-migration semantic at CanvasViewport line 3651.
        store.setAnchor({ x: me.clientX, y: me.clientY });
      } else {
        const dx = me.clientX - store.anchorClient.x;
        const dy = me.clientY - store.anchorClient.y;
        const screenDist = Math.hypot(dx, dy);
        const view = useEditorStore.getState().viewByMode?.viewport ?? { zoom: 1 };
        const zoom = view.zoom || 1;
        const meshRadius = Math.max(MIN_RADIUS, screenDist / zoom);
        usePreferencesStore.getState().setProportionalEdit({ radius: meshRadius });
      }
      return 'RUNNING_MODAL';
    }

    if (e.type === 'wheel') {
      const we = /** @type {WheelEvent} */ (e);
      e.preventDefault();
      const prefs = usePreferencesStore.getState();
      const cur = prefs.proportionalEdit;
      const step = Math.max(WHEEL_STEP_MIN, cur.radius * WHEEL_STEP_FACTOR);
      const next = we.deltaY < 0 ? cur.radius + step : Math.max(MIN_RADIUS, cur.radius - step);
      prefs.setProportionalEdit({ radius: next });
      return 'RUNNING_MODAL';
    }

    if (e.type === 'mousedown') {
      const me = /** @type {MouseEvent} */ (e);
      e.preventDefault();
      if (me.button === 2) {
        finishCancelRestore();
        return 'CANCELLED';
      }
      // LMB / MMB / others — commit (keep current radius).
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
      // F again → commit (toggle off, keep current radius).
      if ((ke.key === 'f' || ke.key === 'F')
          && !ke.ctrlKey && !ke.metaKey && !ke.altKey && !ke.shiftKey) {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }
      // Catch-all: while the modal is active, swallow other keys so
      // they don't start a competing operator (G / R / S / B / etc.).
      // Matches the modal G/R/S RUNNING_MODAL catch-all introduced in
      // Phase 2.A — see ModalTransformOverlay.
      e.preventDefault();
      return 'RUNNING_MODAL';
    }

    return 'PASS_THROUGH';
  }, []);

  useModalTool({ id: 'radiusAdjust', isActive, handleEvent });

  // No render — the proportional-edit ring is owned by CanvasViewport
  // (`propEditCircleRef`); reading the store's `active` + `anchorClient`
  // there pins the ring at the F-press anchor while the modal runs.
  return null;
}
