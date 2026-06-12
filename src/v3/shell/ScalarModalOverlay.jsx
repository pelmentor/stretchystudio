// @ts-check
/* eslint-disable react/prop-types */

/**
 * Generic radial-control modal overlay — replaces the 5 parallel
 * single-purpose overlays (RadiusAdjustOverlay, BrushRadiusAdjustOverlay,
 * BrushStrengthAdjustOverlay, SculptRadiusAdjustOverlay,
 * SculptStrengthAdjustOverlay).
 *
 * Active when `useScalarModalStore.getState().active` is true AND the
 * current editMode matches the active target's required editMode. Owns
 * keyboard / wheel / mouse window-level events via `useModalTool`.
 *
 * # Target registry
 *
 * Each entry describes one dial-style scalar parameter:
 *
 *   - `editMode` — which `editorStore.editMode` value the modal lives
 *     under. If editMode flips off this value mid-modal, the cancel
 *     path restores `startValue` and exits.
 *   - `read()` — current value snapshot. Used by the wheel handler
 *     (relative steps) and the begin caller via the public API.
 *   - `write(value)` — applies new value to the canonical store/field.
 *   - `mouseToValue({dx, dy, zoom})` — gesture math. dx/dy are cursor
 *     deltas from the anchor in screen-px; zoom is the viewport's
 *     current zoom (for unit conversion when the target lives in
 *     mesh units).
 *   - `wheelStep({cur, dir})` — wheel-tick math. dir < 0 = scroll up
 *     (increase); dir > 0 = scroll down (decrease).
 *
 * Pre-refactor each target had its own ~150-LOC overlay with
 * identical handler structure. Adding a 6th would have meant another
 * copy; the registry shape was the natural abstraction once 5
 * existed (RULE №2 — 4→5 transition was the firm trigger flagged in
 * the original commit messages 419e872 / 07e8fbd / e57b81e / ee7b43b /
 * ee7b43b).
 *
 * @module v3/shell/ScalarModalOverlay
 */

import { useCallback, useEffect } from 'react';
import { useScalarModalStore } from '../../store/scalarModalStore.js';
import { useEditorStore } from '../../store/editorStore.js';
import { usePreferencesStore } from '../../store/preferencesStore.js';
import { useModalTool } from '../modalTool/index.js';

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/**
 * @typedef {Object} ScalarTargetDescriptor
 * @property {'edit'|'pose'|'sculpt'|'weightPaint'|'keyform'} editMode
 * @property {() => number} read
 * @property {(value: number) => void} write
 * @property {(args: {dx: number, dy: number, zoom: number}) => number} mouseToValue
 * @property {(args: {cur: number, dir: number}) => number} wheelStep
 */

/**
 * Target registry — keyed by string discriminator. Adding a new
 * radial-control scalar means adding one entry here; no new
 * store/overlay files.
 *
 * @type {Record<string, ScalarTargetDescriptor>}
 */
const REGISTRY = {
  // Edit Mode F — proportional-edit radius (mesh units).
  // Pre-refactor: radiusAdjustStore + RadiusAdjustOverlay.
  proportionalEditRadius: {
    editMode: 'edit',
    read: () => usePreferencesStore.getState().proportionalEdit.radius,
    write: (v) => usePreferencesStore.getState().setProportionalEdit({ radius: v }),
    mouseToValue: ({ dx, dy, zoom }) => {
      const MIN = 5;
      const screenDist = Math.hypot(dx, dy);
      return Math.max(MIN, screenDist / (zoom || 1));
    },
    wheelStep: ({ cur, dir }) => {
      const MIN = 5;
      const FACTOR = 0.1;
      const STEP_MIN = 2;
      const step = Math.max(STEP_MIN, cur * FACTOR);
      return dir < 0 ? cur + step : Math.max(MIN, cur - step);
    },
  },

  // Weight Paint F — brush size (screen-px).
  // Pre-refactor: brushRadiusAdjustStore + BrushRadiusAdjustOverlay.
  brushSize: {
    editMode: 'weightPaint',
    read: () => useEditorStore.getState().brushSize,
    write: (v) => useEditorStore.getState().setBrush({ brushSize: v }),
    mouseToValue: ({ dx, dy }) => {
      const MIN = 2;
      const MAX = 1000;
      return Math.max(MIN, Math.min(MAX, Math.hypot(dx, dy)));
    },
    wheelStep: ({ cur, dir }) => {
      const MIN = 2;
      const MAX = 1000;
      const FACTOR = 0.1;
      const STEP_MIN = 2;
      const step = Math.max(STEP_MIN, cur * FACTOR);
      return dir < 0
        ? Math.min(MAX, cur + step)
        : Math.max(MIN, cur - step);
    },
  },

  // Weight Paint Shift+F — brush strength (0-1 fraction).
  // Pre-refactor: brushStrengthAdjustStore + BrushStrengthAdjustOverlay.
  brushStrength: {
    editMode: 'weightPaint',
    read: () => useEditorStore.getState().brushStrength,
    write: (v) => useEditorStore.getState().setBrushStrength(v),
    mouseToValue: ({ dx, dy }) => {
      const STRENGTH_PIXELS_PER_UNIT = 200;
      return clamp01(Math.hypot(dx, dy) / STRENGTH_PIXELS_PER_UNIT);
    },
    wheelStep: ({ cur, dir }) => {
      const STEP = 0.05;
      return dir < 0 ? clamp01(cur + STEP) : clamp01(cur - STEP);
    },
  },

  // Sculpt F — brush size (screen-px, separate from weight-paint
  // brushSize per editorStore.js:214-216).
  // Pre-refactor: sculptRadiusAdjustStore + SculptRadiusAdjustOverlay.
  sculptSize: {
    editMode: 'sculpt',
    read: () => useEditorStore.getState().sculpt?.size ?? 80,
    write: (v) => useEditorStore.getState().setSculpt({ size: v }),
    mouseToValue: ({ dx, dy }) => {
      const MIN = 2;
      const MAX = 1000;
      return Math.max(MIN, Math.min(MAX, Math.hypot(dx, dy)));
    },
    wheelStep: ({ cur, dir }) => {
      const MIN = 2;
      const MAX = 1000;
      const FACTOR = 0.1;
      const STEP_MIN = 2;
      const step = Math.max(STEP_MIN, cur * FACTOR);
      return dir < 0
        ? Math.min(MAX, cur + step)
        : Math.max(MIN, cur - step);
    },
  },

  // Sculpt Shift+F — brush strength (0-1 fraction).
  // Pre-refactor: sculptStrengthAdjustStore + SculptStrengthAdjustOverlay.
  sculptStrength: {
    editMode: 'sculpt',
    read: () => useEditorStore.getState().sculpt?.strength ?? 0.5,
    write: (v) => useEditorStore.getState().setSculpt({ strength: v }),
    mouseToValue: ({ dx, dy }) => {
      const STRENGTH_PIXELS_PER_UNIT = 200;
      return clamp01(Math.hypot(dx, dy) / STRENGTH_PIXELS_PER_UNIT);
    },
    wheelStep: ({ cur, dir }) => {
      const STEP = 0.05;
      return dir < 0 ? clamp01(cur + STEP) : clamp01(cur - STEP);
    },
  },
};

export function ScalarModalOverlay() {
  const active = useScalarModalStore((s) => s.active);
  const target = useScalarModalStore((s) => s.target);
  const editMode = useEditorStore((s) => s.editMode);
  const descriptor = target ? REGISTRY[target] : null;
  const isActive = active && !!descriptor && editMode === descriptor.editMode;

  // Mode-flip cancel-path: if editMode flips off the target's required
  // mode (Outliner / ModePill / programmatic mode change), restore
  // startValue and cancel. Without this the store would stay
  // `active=true` but the handler would unregister, leaving an
  // un-cancellable zombie modal on next mode re-entry.
  useEffect(() => {
    if (active && descriptor && editMode !== descriptor.editMode) {
      const { startValue } = useScalarModalStore.getState();
      if (typeof startValue === 'number') descriptor.write(startValue);
      useScalarModalStore.getState().cancel();
    }
  }, [active, editMode, descriptor]);

  const handleEvent = useCallback(/** @returns {'PASS_THROUGH'|'RUNNING_MODAL'|'FINISHED'|'CANCELLED'|undefined} */ (e) => {
    const store = useScalarModalStore.getState();
    if (!store.active) return 'PASS_THROUGH';
    const d = store.target ? REGISTRY[store.target] : null;
    if (!d) return 'PASS_THROUGH';

    function finishCommit() {
      useScalarModalStore.getState().commit();
    }

    function finishCancelRestore() {
      const { startValue } = useScalarModalStore.getState();
      if (typeof startValue === 'number') d.write(startValue);
      useScalarModalStore.getState().cancel();
    }

    if (e.type === 'mousemove') {
      const me = /** @type {MouseEvent} */ (e);
      const cur = useScalarModalStore.getState();
      if (!cur.anchorClient) {
        cur.setAnchor({ x: me.clientX, y: me.clientY });
      } else {
        const dx = me.clientX - cur.anchorClient.x;
        const dy = me.clientY - cur.anchorClient.y;
        const view = useEditorStore.getState().viewByMode?.viewport ?? { zoom: 1 };
        const zoom = view.zoom || 1;
        d.write(d.mouseToValue({ dx, dy, zoom }));
      }
      return 'RUNNING_MODAL';
    }

    if (e.type === 'wheel') {
      e.preventDefault();
      const we = /** @type {WheelEvent} */ (e);
      d.write(d.wheelStep({ cur: d.read(), dir: we.deltaY }));
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
      // F (bare or with Shift since Shift+F was the entry for strength
      // modals) — toggle off, commit. Ctrl/Meta/Alt + F pass through to
      // the catch-all below.
      if ((ke.key === 'f' || ke.key === 'F')
          && !ke.ctrlKey && !ke.metaKey && !ke.altKey) {
        e.preventDefault();
        finishCommit();
        return 'FINISHED';
      }
      // Catch-all: while active, swallow other keys so they don't
      // start a competing operator. Mirrors the modal G/R/S
      // RUNNING_MODAL catch-all from Phase 2.A's
      // ModalTransformOverlay.
      e.preventDefault();
      return 'RUNNING_MODAL';
    }

    return 'PASS_THROUGH';
  }, []);

  useModalTool({ id: 'scalarModal', isActive, handleEvent });

  // No render — the visible feedback (proportional-edit ring / brush
  // cursor) is owned by the canvas/overlay layer for each target.
  return null;
}
