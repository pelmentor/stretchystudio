// @ts-check
/* eslint-disable react/prop-types, react-hooks/exhaustive-deps */

/**
 * Animation Phase 5 — F-Curve Graph Editor (write-mode).
 *
 * Two-layer composition (plan §5.A): SVG background (axes + curve path
 * per visible FCurve + zero-line + playhead) + canvas-2D foreground
 * (keyframe diamonds + handle dots; receives all pointer events). Both
 * layers share a single `view` derived from container dims via
 * ResizeObserver and the auto-fit value range across all visible curves;
 * the canvas is DPR-aware.
 *
 * # Slice 5.B (shipped 2026-05-16, `bd1e68b` + `feb4bde`)
 *
 *   - LMB-click keyframe diamond → select (whole-keyform select sets
 *     `{center,left,right}` all true so the next click+drag moves the
 *     KNOT and the handles ride along per Blender's KNOT_ONLY semantic).
 *   - LMB-click handle dot → select that side only.
 *   - LMB-drag keyframe diamond → grab in (time, value).
 *   - LMB-drag handle dot → reshape via `applyHandleDrag` (HD_AUTO →
 *     HD_ALIGN both-sides + HD_VECT → HD_FREE dragged-only + aligned
 *     mirror; matches `BKE_nurb_bezt_handle_test` at
 *     `reference/blender/source/blender/blenkernel/intern/curve.cc:4054-4084`).
 *   - Click empty area → seek the playhead.
 *
 * # Slice 5.C (shipped 2026-05-16, `0d78ad3` + `213c748`) — operator pass
 *
 *   - **G** — modal grab over selected keyforms (per-part). Ctrl-snap
 *     dTime to whole frames; Shift = 0.1× precision multiplier.
 *     LMB / Enter confirm; Esc / RMB cancel.
 *   - **S** — modal scale around pivot (selection median).
 *   - **B** — box-select via local rubber-band.
 *   - **V / T / Shift+E** — handle-type / interpolation / extrapolation menus.
 *   - **Delete / X** — delete selected keyforms (last-kf guard per curve).
 *   - **Home** — clear view-lock + re-fit.
 *   - **Ctrl+G** — snap selected keyform centres to whole frames.
 *   - **Post-release** — `mergeDuplicateTimeKeys` + `recalcKeyformHandles`.
 *   - **Lock-view-during-drag** — value range freezes during modal/drag.
 *
 *   **Lifted in Slice 5.E (2026-05-16):** modal G/S axis-lock (X/Y) and
 *   typed numeric input now share the viewport's input reducer -- see
 *   the Slice 5.E section below.
 *
 * # Slice 5.D — driver banner + edit-disable gate
 *
 * Per plan §5.D: "If the active FCurve has a `driver`, show the driver
 * expression as a banner above the curve and a '(D)' badge. Editing
 * handles is disabled when the driver is active (the driver overrides
 * the curve); a button clears the driver to allow keyframe editing."
 *
 *   - **DriverBanner** above the canvas when the active FCurve has a
 *     `driver` attached. Shows: "DRIVER" label + driver type (scripted/
 *     sum/min/max/avg) + truncated expression (or `variables.length`
 *     count for non-scripted types) + live evaluated value (re-evaluates
 *     on `currentTime` change so it tracks the playhead) + "Clear
 *     Driver" button (drops `fcurve.driver` via batched `updateProject`).
 *   - **Edit-disabled gate (per-fcurve)** via `hasDriver` at
 *     [src/anim/driverGate.js](../../../anim/driverGate.js). A driven
 *     fcurve's keyform values are overridden by the driver output (see
 *     `evaluateFCurve` step 2), so editing them is meaningless. The
 *     gate is PER-CURVE so a cross-curve selection that mixes driven +
 *     undriven curves keeps the undriven ones editable -- this mirrors
 *     Blender's pattern of disabling the `Properties` panel's value
 *     widget per channel rather than gating the whole editor.
 *     Concretely the gate skips:
 *       - `startKeyformDrag` / `startHandleDrag` (early return)
 *       - `operatorSetHandleType` / `operatorSetInterpolation` /
 *         `operatorSetExtrapolation` / `operatorSnapToFrame` /
 *         `operatorDelete` (skip per-fcurve in the iteration loop)
 *       - Modal G / S originals collection (skip driven fcurves so they
 *         don't enter the pivot calculation; if NO mutable fcurves
 *         remain, the modal bails via the existing `n === 0` guard).
 *     Selection / box-select / sidebar click / seek / Home / A still
 *     work against driven curves -- the user can still SELECT keyforms
 *     to inspect timing, just not MUTATE them.
 *   - **Sidebar "(D)" badge** on every row whose fcurve has a driver
 *     (active or context), so the user can spot driven channels at a
 *     glance before clicking into them.
 *   - **Plot-area ResizeObserver** now observes the plot-rect (the
 *     div directly hosting the SVG + canvas) instead of the outer
 *     wrap. The Slice 5.D banner sits in the same vertical flex column
 *     as the plot-rect, so the rect's height shrinks when the banner
 *     mounts -- the canvas resizes naturally via the observer callback.
 *     Side-effect: the prior pass observed the outer wrap (sidebar +
 *     plot), so `view.w` was outer width and the canvas's `style.width`
 *     overflowed the plot-rect by `SIDEBAR_W` to the right; that
 *     overflow was clipped by the Wrapper's `overflow-hidden` but made
 *     the rightmost ~180px of the curve never visible. Observing the
 *     plot-rect makes `view.w` = plot-rect width, so the curve fills
 *     the visible plot area exactly.
 *
 *   **SS-deferred** (this slice, documented explicitly):
 *   - Driver variable list / expression editor in the banner. Blender's
 *     Drivers Editor panel surfaces `variables[]` with type-specific
 *     targets (single-prop / rot-diff / loc-diff / trans-channel /
 *     context-prop). SS's `evaluateDriver` only handles `singleProp`
 *     (see [driver.js](../../../anim/driver.js) "Deviations from
 *     Blender"), and a UI to author variables doesn't exist yet -- the
 *     banner shows the count read-only this slice and the user must
 *     attach drivers via NodeTreeEditor / `driverCompile.js` paths.
 *   - Driver invalid-flag display (`DRIVER_FLAG_INVALID` red_alert in
 *     `graph_buttons.cc:1026-1031`). `evaluateDriver` returns NaN on
 *     unsafe / failing expressions and the FCurve falls back to keyform
 *     eval; there's no persisted invalid-flag on the driver object today
 *     to surface as a red banner.
 *   - Driver influence slider -- `ChannelDriver.influence` is not
 *     modelled in SS yet (see [driver.js](../../../anim/driver.js)
 *     "Deviations from Blender"); a driver either fully overrides or
 *     doesn't fire.
 *
 *   **Deviations from Blender** (architectural, documented per audit-fix
 *   MED-B1+MED-B2 on 2026-05-16):
 *   - **Banner mode-split.** Blender splits keyframe vs driver editing
 *     into separate Graph Editor modes: `SIPO_MODE_ANIMATION` and
 *     `SIPO_MODE_DRIVERS`, switched at
 *     `reference/blender/source/blender/editors/space_graph/space_graph.cc:244`
 *     (and gated throughout `space_graph.cc:244,256,304`,
 *     `graph_buttons.cc:737`, `graph_ops.cc`, `graph_edit.cc`). The
 *     driver settings panel poll explicitly returns false outside
 *     `SIPO_MODE_DRIVERS` at `graph_buttons.cc:733-742`. SS merges the
 *     two modes into ONE editor and surfaces the driver UI as a banner
 *     above the curve. Consequence: per-channel `hasDriver` gating in
 *     drag-starters + operators is required to compensate (Blender
 *     doesn't need it because drivers never coexist with keyframes in
 *     the same channel list); see [driverGate.js](../../../anim/driverGate.js)
 *     "Why a per-curve gate at all" for the full rationale.
 *   - **"(D)" sidebar badge has no Blender precedent at the channel-row
 *     level.** Blender's channel-list rendering at
 *     `reference/blender/source/blender/editors/animation/anim_channels_defines.cc:1631`
 *     uses `ICON_DRIVER` only for the "Drivers" GROUP-HEADER expander
 *     in `SIPO_MODE_DRIVERS`, not as a per-fcurve indicator on
 *     individual animated channels. SS's "(D)" text badge is an SS
 *     invention to surface driven channels in the merged-mode sidebar
 *     (since Blender's split-mode structure makes per-channel badges
 *     unnecessary there).
 *   - **`clearDriver` keeps the fcurve.** Blender's `ANIM_remove_driver`
 *     at `reference/blender/source/blender/editors/animation/drivers.cc:511-544`
 *     removes the entire FCurve from `adt->drivers` via
 *     `BLI_remlink + BKE_fcurve_free` -- because Blender's driver-
 *     FCurves live in a separate ListBase (`AnimData::drivers`) from
 *     keyframe-FCurves (`AnimData::action->curves`) and a driver-FCurve
 *     has no role outside being the driver. SS overlays the driver on
 *     the same fcurve that owns `keyforms[]`, so clearing the driver
 *     keeps the keyform-bearing fcurve in place (which is the whole
 *     point of the "Clear Driver" button -- resume keyform editing).
 *     See [driverGate.js](../../../anim/driverGate.js) `clearDriver`
 *     doc-block for the full architectural deviation.
 *
 * # Slice 5.E (this commit) — axis-lock + typed numeric input
 *
 * Per close-out doc resume path #1: "Modal G/S axis-lock + typed
 * numeric input. Should share implementation with the viewport's
 * `ModalTransformOverlay`; a `useModalTransformInput()` hook extraction."
 *
 *   - **X / Y axis lock during modal G/S.** Pressing `X` constrains
 *     the transform to the time axis (zero value-delta for G; only
 *     time-scale for S). Pressing `Y` constrains to the value axis.
 *     Pressing the same axis again clears the lock. Blender confirms
 *     bare X/Y is valid in `T_2D_EDIT` editors at
 *     `reference/blender/source/blender/editors/transform/transform.cc:655-670`
 *     (only TFM_MODAL_AXIS_Z + plane locks are blocked in 2D; X/Y fall
 *     through to the constraint check). Shift+X / Shift+Y is recognised
 *     as a noop (preventDefault) per the 2D plane-lock block at
 *     `transform.cc:660-662` so the chord doesn't fall through to
 *     bare-axis toggle.
 *   - **Typed numeric input.** Digits / `.` / leading `-` accumulate
 *     into the input reducer's `typedBuffer`; the value drives the
 *     transform exactly. For G: typed value is in FRAMES on the time
 *     axis (matches the visible axis labels; converted to ms via
 *     `msPerFrame`) and raw value units on the value axis. For S:
 *     typed value is a scale multiplier. Backspace pops; `=` toggles
 *     `numericMode` (Blender's `NUM_EDIT_FULL` flag from
 *     `reference/blender/source/blender/editors/util/numinput.cc:369-378`
 *     -- `=` is one-way enable, only `Ctrl+=` clears).
 *   - **Shared reducer.** Both modals (viewport `ModalTransformOverlay`
 *     and this fcurve modal) route axis / typed / numericMode
 *     transitions through `transformInputReducer` at
 *     [src/lib/modal/transformInputReducer.js](../../../lib/modal/transformInputReducer.js).
 *     The viewport keeps its zustand store (Footer + overlay both
 *     subscribe cross-component); this fcurve modal uses the
 *     `useTransformModalInput()` hook (no Footer wiring, HUD is
 *     plot-relative). Validation rules + `=`-toggle semantics live
 *     in ONE place per Rule №1.
 *   - **Units in HUD.** `f` suffix on the typed buffer for G when no
 *     axis or X-axis is locked (time = frames); no suffix for G + Y-axis
 *     (raw value); `×` for S (multiplier). Matches what the axes display
 *     so the typed number reads as "5 frames" / "0.3 value units" /
 *     "2.0× scale" intuitively.
 *   - **Snap interaction.** Typed values DISABLE shift-precision +
 *     ctrl-frame-snap (typed is exact). Same as the viewport modal at
 *     `ModalTransformOverlay.jsx:253-260`.
 *
 *   **SS-deferred** (this slice):
 *   - Per-keyform pivot for S (median vs cursor vs individual origins).
 *     Currently uses the global median across all selected keyforms in
 *     all selected fcurves. Blender's "Pivot Point" header dropdown
 *     (median / cursor / individual / 3D cursor) is a per-editor setting
 *     not yet ported to the fcurve editor.
 *   - Mirror axis lock for the per-keyform DRAG path (startKeyformDrag /
 *     startHandleDrag). Those use the freer applyKeyformDrag path
 *     rather than the modal applyGrab, and don't open a HUD to display
 *     axis state. A follow-on could route them through the same hook
 *     when shift-locked.
 *
 * # Slice 5.C+ (prior commit) — multi-curve display
 *
 * Per plan §5.C: "Phase 5 supports displaying multiple FCurves at once
 * (one color each). The active FCurve is the one being edited; others
 * are background context. UI: a curve-list sidebar."
 *
 *   - **All FCurves in the active action render at once.** Each curve
 *     gets a stable rainbow color via `getcolorFcurveRainbow` (port of
 *     `reference/blender/source/blender/editors/animation/anim_ipo_utils.cc:311-346`
 *     `FCURVE_COLOR_AUTO_RAINBOW`).
 *   - **Active vs context** mirrors Blender's `FCURVE_ACTIVE` flag at
 *     `reference/blender/source/blender/editors/space_graph/graph_draw.cc:1155-1161`:
 *     active curve = stroke width 2.5px; context = 1.0px. Active curve
 *     keyform diamonds render at full size; context curves at smaller
 *     size + reduced opacity (matches Blender's `fcurve_display_alpha`
 *     at `graph_draw.cc:50-57`).
 *   - **Curve-list sidebar** (left edge): color swatch + label + eye
 *     toggle + click-to-activate. Active row highlighted. Eye toggle is
 *     session-local (no schema change this slice; see § "SS-deferred").
 *   - **Selection lifted to `Map<fcurveId, Map<kfIdx, parts>>`** so a
 *     box-select / shift-click can pick handles across multiple curves
 *     at once. Modal G/S iterate the per-curve sub-selections; V/T/E
 *     menus apply to every selected curve.
 *   - **Cross-curve click**: clicking a context-curve diamond switches
 *     active to that curve AND selects the kf. Mirrors Blender's
 *     `mouse_graph_keys` at
 *     `reference/blender/source/blender/editors/space_graph/graph_select.cc:1850`,
 *     which calls `ANIM_set_active_channel` at
 *     `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:237`
 *     to elevate the clicked channel to active. Per audit-fix HIGH-B1
 *     (2026-05-16): SS only elevates active for non-Shift clicks, matching
 *     Blender's `select_mode != SELECT_INVERT` guard at `graph_select.cc:1843-1856`.
 *   - **View auto-fit** considers all visible curves' min/max value
 *     (not just the active curve), so context curves stay in-frame.
 *
 *   **SS-deferred** (this slice, documented explicitly):
 *   - Persistent visibility flag — would need a `fcurve.visible` schema
 *     field; the eye toggle is session-local for now. Switching tabs
 *     resets visibility (Blender persists `FCURVE_VISIBLE` in `flag`).
 *   - Per-FCurve `color_mode` selector — SS only ships AUTO_RAINBOW.
 *     The Blender modes AUTO_RGB / AUTO_YRGB / CUSTOM (`DNA_anim_enums.h:344-351`)
 *     are not exposed; they'd need both a schema field and a UI affordance.
 *   - Channel groupings (`fcurve.grp` Action groups) — flat sidebar list
 *     for now; group collapse / mute / solo is Phase 6 (Dopesheet) work.
 *   - F-Modifier-drawn curves — `(fcu->modifiers.first || FCURVE_INT_VALUES)`
 *     at `graph_draw.cc:1151-1153` triggers a sampled redraw; SS doesn't
 *     ship F-Modifiers (`Phase 3` plan item), so this branch isn't ported.
 *   - Per-FCurve mute render (`FCURVE_MUTED` greyish hue at
 *     `graph_draw.cc:1190-1200`) — SS doesn't ship `fcurve.mute` as a
 *     schema field, so there's nothing to differentiate visually. A
 *     follow-on slice would add the schema field + the muted-grey
 *     branch together.
 *   - Channel-vs-keyform selection split — Blender keeps `FCURVE_SELECTED`
 *     (channels in the channel list) independent of per-keyform selection
 *     and of the single `FCURVE_ACTIVE` flag. Slice 5.F (2026-05-16)
 *     lifted this by adding the sparse per-FCurve `selected` boolean +
 *     sidebar Shift-click semantics. The helper lives at
 *     [src/anim/fcurveChannelSelect.js](../../../anim/fcurveChannelSelect.js);
 *     the active concept still resolves from `selectionStore` so
 *     `pickFCurve(action, selection)` returns the "last clicked" curve
 *     while `fcurve.selected` carries the multi-row state.
 *   - Active-keyform highlight (`draw_fcurve_active_vertex` at
 *     `graph_draw.cc:241-280`, the per-FCurve `BKE_fcurve_active_keyframe_index`
 *     concept). SS has no active-keyform field on FCurves; the highlight
 *     is omitted. The TH_VERTEX_ACTIVE band of Blender's UX is a
 *     follow-on once an active-keyform schema field exists.
 *
 * # Per-handle selection state (plan §5.B + §5.C)
 *
 * Selection is keyed per-FCurve, then per-keyform with `{center, left,
 * right}` booleans mapping to Blender's `BEZT_SEL_F2 / F1 / F3` flags at
 * `reference/blender/source/blender/makesdna/DNA_curve_types.h:90-95`.
 *
 *   `Map<fcurveId: string, Map<keyformIdx: number, {center, left, right}>>`
 *
 * The selection store is local-React — graph-editor selection doesn't
 * bleed into the global selectionStore because the global store's
 * identity is part/param/group, not keyform-index-in-an-active-FCurve.
 *
 * # SIPO_SELVHANDLESONLY
 *
 * Handles draw only for SELECTED keyforms — Blender's
 * `SIPO_SELVHANDLESONLY` mode at
 * `reference/blender/source/blender/editors/space_graph/graph_draw.cc:469-476`.
 * Cross-curve: handles draw for selected entries on ANY visible curve
 * (Blender's `SIPO_SELVHANDLESONLY` is global, not per-curve).
 *
 * # Hotkey scoping
 *
 * Wrap div is `tabIndex={0}` and auto-focuses on pointer enter so
 * hotkeys go to the editor under the cursor (Blender's pattern). Modal
 * G/S/B mount window-level capture listeners so drag can leave bounds.
 *
 * @module v3/editors/fcurve/FCurveEditor
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnimationStore } from '../../../store/animationStore.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { interpolateTrack } from '../../../renderer/animationEngine.js';
import {
  decodeFCurveTarget,
  fcurveTargetsParam,
} from '../../../anim/animationFCurve.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { beginBatch, endBatch } from '../../../store/undoHistory.js';
import {
  applyKeyformDrag,
  applyHandleDrag,
  applyGrab,
  applyScale,
  snapKeyformsToFrame,
  setHandleType,
  setInterpolation,
  setExtrapolation,
  deleteKeyforms,
  mergeDuplicateTimeKeys,
  snapshotKeyform,
  remapSelection,
} from '../../../anim/graphEditOps.js';
import { recalcKeyformHandles } from '../../../anim/fcurveHandles.js';
import { fcurveColorCss } from '../../../anim/fcurveColor.js';
import { hasDriver, clearDriver } from '../../../anim/driverGate.js';
import { evaluateDriver } from '../../../anim/driver.js';
import {
  applyChannelSelect,
  isFCurveSelected,
} from '../../../anim/fcurveChannelSelect.js';
import { isFCurveMuted, toggleFCurveMute } from '../../../anim/fcurveMute.js';
import { isFCurveHidden, toggleFCurveHidden } from '../../../anim/fcurveVisible.js';
import {
  getActiveKeyformIndex,
  setActiveKeyform,
  remapActiveKeyform,
  captureActiveKeyformObject,
  relocateActiveKeyformByObject,
  FCURVE_ACTIVE_KEYFORM_NONE,
} from '../../../anim/fcurveActiveKeyform.js';
import { useTransformModalInput } from '../../../lib/modal/useTransformModalInput.js';
import {
  keyEventToAction,
  parseTyped,
} from '../../../lib/modal/transformInputReducer.js';

const CURVE_SAMPLES = 240;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 12;
const PAD_B = 22;
const SIDEBAR_W = 168;

// Hit-test radii (px, screen-space).
const HIT_KEYFRAME_R = 7;
const HIT_HANDLE_R = 6;

// Alpha for context curves — mirrors Blender's `U.fcu_inactive_alpha`
// default of 0.5 (`graph_draw.cc:54-57`). Active curve is always 1.0.
const CTX_ALPHA = 0.5;

const HANDLE_TYPES = /** @type {const} */ ([
  { key: 'free',         label: 'Free' },
  { key: 'aligned',      label: 'Aligned' },
  { key: 'vector',       label: 'Vector' },
  { key: 'auto',         label: 'Auto' },
  { key: 'auto_clamped', label: 'Auto Clamped' },
]);

// Order matches Blender's `rna_enum_beztriple_interpolation_mode_items`
// at `reference/blender/source/blender/makesrna/intern/rna_curve.cc`.
const INTERPOLATION_TYPES = /** @type {const} */ ([
  { key: 'constant', label: 'Constant' },
  { key: 'linear',   label: 'Linear' },
  { key: 'bezier',   label: 'Bezier' },
  { key: 'sine',     label: 'Sinusoidal' },
  { key: 'quad',     label: 'Quadratic' },
  { key: 'cubic',    label: 'Cubic' },
  { key: 'quart',    label: 'Quartic' },
  { key: 'quint',    label: 'Quintic' },
  { key: 'expo',     label: 'Exponential' },
  { key: 'circ',     label: 'Circular' },
  { key: 'back',     label: 'Back' },
  { key: 'bounce',   label: 'Bounce' },
  { key: 'elastic',  label: 'Elastic' },
]);

const EXTRAPOLATION_TYPES = /** @type {const} */ ([
  { key: 'constant', label: 'Constant' },
  { key: 'linear',   label: 'Linear' },
]);

export function FCurveEditor() {
  const project = useProjectStore((s) => s.project);
  const activeActionId = useAnimationStore((s) => s.activeActionId);
  const currentTime = useAnimationStore((s) => s.currentTime);
  const setCurrentTime = useAnimationStore((s) => s.setCurrentTime);
  const fps = useAnimationStore((s) => s.fps);
  const selection = useSelectionStore((s) => s.items);
  const selectStore = useSelectionStore((s) => s.select);

  const action = useMemo(
    () => getActiveSceneAction(project, activeActionId),
    [project.nodes, project.actions, activeActionId],
  );

  // Decoded label map for sidebar rows.
  const labels = useMemo(() => buildLabelMaps(project), [project.nodes, project.parameters]);

  // Active FCurve = the one global selection points at (existing
  // `pickFCurve` semantics preserved). May be null if no curves match.
  const activeFCurve = useMemo(() => pickFCurve(action, selection), [action, selection]);

  // Audit-fix HIGH-A1 (2026-05-16): memoize `decoded`. Without this, a
  // bare `decodeAllFCurves(action, labels)` would rerun on every render
  // — including every `update(..., { skipHistory:true })` pointer-move
  // tick during keyform drag — cascading into `visible`, `samples`,
  // `autoFit`, `curvePaths` and the canvas redraw. With ~10 curves at
  // 240 samples each, that's ~2400 fcurve evaluations PER pointer move.
  const decoded = useMemo(
    () => (action ? decodeAllFCurves(action, labels) : []),
    [action?.fcurves, labels],
  );

  // Audit-fix MED-A3 (2026-05-16): stable callback identity so Plot's
  // `onPointerDown` useCallback doesn't bust its cache on every parent
  // render. `selectStore` is stable (Zustand store method).
  const onPickActiveByTarget = useCallback((target) => {
    if (target.kind === 'param') {
      selectStore({ type: 'parameter', id: target.paramId }, 'replace');
    } else if (target.kind === 'node') {
      selectStore({ type: 'part', id: target.nodeId }, 'replace');
    }
  }, [selectStore]);

  if (!action) {
    return (
      <Wrapper>
        <Empty msg="Create or select an action in the Actions panel." />
      </Wrapper>
    );
  }
  if (decoded.length === 0) {
    return (
      <Wrapper>
        <Empty msg="No F-curves in this action — drop a keyframe in the Timeline first." />
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <Plot
        action={action}
        activeActionId={activeActionId}
        decoded={decoded}
        activeFCurveId={activeFCurve?.id ?? null}
        currentTime={currentTime}
        fps={fps}
        onSeek={setCurrentTime}
        onPickActiveByTarget={onPickActiveByTarget}
      />
    </Wrapper>
  );
}

function Wrapper({ children }) {
  return (
    <div className="flex flex-col h-full bg-card overflow-hidden">
      <div className="flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

function Empty({ msg }) {
  return (
    <div className="h-full flex items-center justify-center px-6 text-center text-xs text-muted-foreground italic">
      {msg}
    </div>
  );
}

function Plot({ action, activeActionId, decoded, activeFCurveId, currentTime, fps, onSeek, onPickActiveByTarget }) {
  const wrapRef = useRef(null);
  // Slice 5.D: separate ref for the plot-rect (sibling of DriverBanner
  // inside the right-side flex column). ResizeObserver watches THIS ref
  // so canvas dims track the actual drawing area, not the outer wrap
  // (which includes Sidebar + Banner -- see file-header "Plot-area
  // ResizeObserver" note for the bug this also fixes incidentally).
  const plotAreaRef = useRef(null);
  const canvasRef = useRef(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  /** @type {[Map<string, Map<number, {center:boolean,left:boolean,right:boolean}>>, Function]} */
  const [selectedHandles, setSelectedHandles] = useState(new Map());
  // Slice 5.I — visibility now persists on `fcurve.hide` (negative of
  // Blender's FCURVE_VISIBLE). The prior local `useState(new Set())`
  // was lost on editor unmount / save-load. See
  // [src/anim/fcurveVisible.js](../../../anim/fcurveVisible.js).
  /** @type {[null | {minV:number, maxV:number}, Function]} */
  const [viewLock, setViewLock] = useState(null);
  /** @type {[null | {kind:'g'|'s'}, Function]} */
  const [modal, setModal] = useState(null);
  /** @type {[null | {x:number, y:number, curX:number, curY:number, modifier:'replace'|'add'|'subtract'}, Function]} */
  const [boxSelect, setBoxSelect] = useState(null);
  /** @type {[null | {kind:'handleType'|'interpolation'|'extrapolation', x:number, y:number}, Function]} */
  const [menu, setMenu] = useState(null);

  // Slice 5.E — shared axis-lock + typed numeric input state. Routes
  // through `transformInputReducer` (the same reducer the viewport
  // modal's zustand store wraps) so validation rules + numericMode
  // semantics stay identical across both modals. `stateRef` exposes
  // the synchronous post-action value to the imperative `applyModal`
  // closure inside `startModal`.
  const modalInput = useTransformModalInput();

  const update = useProjectStore((s) => s.updateProject);
  // In-flight drag cleanup refs (Slices 5.B/5.C contract — unmount mid-
  // drag/modal/box-select releases listeners + closes the undo batch).
  const dragCleanupRef = useRef(/** @type {(() => void) | null} */ (null));
  const modalCleanupRef = useRef(/** @type {(() => void) | null} */ (null));
  const boxSelectCleanupRef = useRef(/** @type {(() => void) | null} */ (null));
  // Latest selection for handlers/effects that close over a ref.
  const selectionRef = useRef(selectedHandles);
  useEffect(() => { selectionRef.current = selectedHandles; }, [selectedHandles]);
  // Audit-fix MED-A4 (2026-05-16): viewRef for box-select. `applyBoxSelect`
  // is called from `onUp` which was registered with the THEN-current
  // `view` closure; if `view` changes mid-box-select (container resize
  // or eye-toggle changing autoFit), the closed-over `view` is stale.
  // Sister to the existing modal pattern that doesn't have this problem
  // because `applyModal` reads `snap` which is closed at modal-start and
  // intentionally frozen (modal uses viewLock).
  const viewRef = useRef(/** @type {any} */ (null));

  // Visible = decoded \ hidden. Hidden curves still register colour
  // (so eye-toggling doesn't reshuffle colours) but skip rendering.
  // Slice 5.I — `hide` is now read from the persisted FCurve field.
  //
  // Dep-array `[decoded]` is sufficient (no separate `hidden` Set dep
  // anymore). Justification: `toggleFCurveHidden` mutates `fc.hide`
  // through an immer draft → new `fc` reference → new `action.fcurves`
  // array → new `project.actions` → outer-component `decoded` memo
  // (dep `[action?.fcurves, labels]`) invalidates → the new `decoded`
  // array prop reaches this `Plot` component → `visible` memo's
  // reference-equality check on `decoded` fires. Audit-fix MED-1
  // (Slice 5.I dual-audit 2026-05-17): documented so a future reader
  // doesn't collapse the dep thinking it's redundant.
  const visible = useMemo(
    () => decoded.filter((d) => !isFCurveHidden(d.fcurve)),
    [decoded],
  );

  // Per-curve sampled values + per-curve auto-fit min/max. Active curve's
  // samples drive interactive overlays; context curves contribute to the
  // global auto-fit so they stay in-frame.
  const samples = useMemo(() => {
    const out = new Map();
    for (const d of visible) {
      const s = sampleCurve(d.fcurve, action.duration ?? 1000);
      out.set(d.fcurve.id, s);
    }
    return out;
  }, [visible, action.duration]);

  const autoFit = useMemo(() => {
    let minV = Infinity, maxV = -Infinity;
    for (const s of samples.values()) {
      if (s.minV < minV) minV = s.minV;
      if (s.maxV > maxV) maxV = s.maxV;
    }
    if (!Number.isFinite(minV)) { minV = 0; maxV = 1; }
    if (minV === maxV) { minV -= 0.5; maxV += 0.5; }
    return { minV, maxV };
  }, [samples]);

  const duration = Math.max(1, action.duration ?? 1000);

  // View min/max — locked snapshot during a modal/drag so the y-axis
  // doesn't rescale as the user drags a kf outside its range.
  const minV = viewLock?.minV ?? autoFit.minV;
  const maxV = viewLock?.maxV ?? autoFit.maxV;

  // Wipe per-curve selection entries that point at curves no longer in
  // the action (e.g., the user deleted a curve in the Timeline). Active
  // curve change does NOT wipe (cross-curve selection is the whole
  // point of 5.C+); only delete entries whose curve disappeared.
  useEffect(() => {
    setSelectedHandles((prev) => {
      const liveIds = new Set(decoded.map((d) => d.fcurve.id));
      const next = new Map();
      for (const [fid, sub] of prev) {
        if (liveIds.has(fid)) next.set(fid, sub);
      }
      return next;
    });
  }, [decoded]);

  useEffect(() => {
    const el = plotAreaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const r = entry.contentRect;
        setContainerSize({ w: r.width, h: r.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Unmount cleanup — release any in-flight listener bundles.
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
      if (modalCleanupRef.current) {
        modalCleanupRef.current();
        modalCleanupRef.current = null;
      }
      if (boxSelectCleanupRef.current) {
        boxSelectCleanupRef.current();
        boxSelectCleanupRef.current = null;
      }
    };
  }, []);

  const view = useMemo(() => {
    const w = Math.max(1, containerSize.w);
    const h = Math.max(1, containerSize.h);
    const plotW = Math.max(1, w - PAD_L - PAD_R);
    const plotH = Math.max(1, h - PAD_T - PAD_B);
    const span = (maxV - minV) || 1;
    return {
      w, h, plotW, plotH,
      tMin: 0, tMax: duration,
      vMin: minV, vMax: maxV, vSpan: span,
      tx: (t) => PAD_L + (t / duration) * plotW,
      ty: (v) => PAD_T + (1 - (v - minV) / span) * plotH,
      xToTime: (x) => ((x - PAD_L) / plotW) * duration,
      yToValue: (y) => minV + (1 - (y - PAD_T) / plotH) * span,
    };
  }, [containerSize.w, containerSize.h, duration, minV, maxV]);

  // Audit-fix MED-A4 (2026-05-16) — sync viewRef so `applyBoxSelect`'s
  // `onUp` reads the live `view` even if container resized mid-drag.
  useEffect(() => { viewRef.current = view; }, [view]);

  // SVG curve paths — one per visible FCurve. Built once when samples
  // or view change. Active curve drawn last (on top).
  const curvePaths = useMemo(() => {
    const out = [];
    for (const d of visible) {
      const s = samples.get(d.fcurve.id);
      if (!s || s.values.length === 0) continue;
      let dPath = '';
      for (let i = 0; i < s.values.length; i++) {
        const p = s.values[i];
        dPath += (i === 0 ? 'M' : 'L') + view.tx(p.t).toFixed(1) + ',' + view.ty(p.v).toFixed(2);
      }
      out.push({
        id: d.fcurve.id,
        d: dPath,
        color: d.color,
        isActive: d.fcurve.id === activeFCurveId,
        // Slice 5.G — Blender's `graph_draw.cc:1190-1194` greys the
        // stroke (`immUniformThemeColorShade(TH_HEADER, 50)`) when
        // muted. Surfaced here so the render branch picks neutral grey
        // + lower opacity instead of the rainbow color.
        isMuted: isFCurveMuted(d.fcurve),
      });
    }
    // Active last so it overdraws context curves.
    out.sort((a, b) => Number(a.isActive) - Number(b.isActive));
    return out;
  }, [visible, samples, view, activeFCurveId]);

  // Imperative canvas redraw — diamonds + handles for every visible
  // curve. Active curve gets full-size diamonds + interactive hit area;
  // context curves get smaller dimmer diamonds.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const pxW = Math.max(1, Math.round(view.w * dpr));
    const pxH = Math.max(1, Math.round(view.h * dpr));
    if (canvas.width !== pxW) canvas.width = pxW;
    if (canvas.height !== pxH) canvas.height = pxH;
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);

    // Context curves first (under) then active last (over).
    for (const d of visible) {
      if (d.fcurve.id === activeFCurveId) continue;
      const sub = selectedHandles.get(d.fcurve.id);
      const muted = isFCurveMuted(d.fcurve);
      drawHandles(ctx, d.fcurve.keyforms, sub, view, /*isActive*/ false, muted);
      drawKeyframes(ctx, d.fcurve.keyforms, sub, view, /*isActive*/ false, muted);
    }
    for (const d of visible) {
      if (d.fcurve.id !== activeFCurveId) continue;
      const sub = selectedHandles.get(d.fcurve.id);
      const muted = isFCurveMuted(d.fcurve);
      // Slice 5.H — Blender's `draw_fcurve_active_vertex` three-condition
      // gate (`graph_draw.cc:241-262`): (1) channel-active (only the
      // active-channel branch reaches here), (2) `active_keyframe_index
      // != FCURVE_ACTIVE_KEYFRAME_NONE`, (3) the indexed keyform's
      // CENTER handle (f2) is selected — `graph_draw.cc:254` tests
      // exactly `!(bezt->f2 & SELECT)`, NOT `BEZT_ISSEL_ANY`. The
      // halo signals "this knot is numerically editable in the N-panel";
      // when only a tangent handle is selected (no center), Blender
      // hides the halo to avoid misleading the user.
      // (Audit-fix MED-B1 2026-05-16: pre-fix gate was
      // `center||left||right`; corrected to center-only.)
      // Condition (3) is enforced here in render because SS's keyform
      // selection lives editor-local (`selectedHandles`), not on the
      // keyform record. See `fcurveActiveKeyform.js` module header for
      // the split rationale.
      const activeIdx = getActiveKeyformIndex(d.fcurve);
      let activeIdxToDraw = FCURVE_ACTIVE_KEYFORM_NONE;
      if (activeIdx !== FCURVE_ACTIVE_KEYFORM_NONE) {
        const subEntry = sub?.get(activeIdx);
        if (subEntry && subEntry.center) {
          activeIdxToDraw = activeIdx;
        }
      }
      drawHandles(ctx, d.fcurve.keyforms, sub, view, /*isActive*/ true, muted, activeIdxToDraw);
      drawKeyframes(ctx, d.fcurve.keyforms, sub, view, /*isActive*/ true, muted, activeIdxToDraw);
    }
  }, [visible, selectedHandles, view, activeFCurveId]);

  // ── helpers — selection-map mutation ────────────────────────────────

  function setSubSelection(fcurveId, sub) {
    setSelectedHandles((prev) => {
      const next = new Map(prev);
      if (!sub || sub.size === 0) next.delete(fcurveId);
      else next.set(fcurveId, sub);
      return next;
    });
  }

  function clearSelection() { setSelectedHandles(new Map()); }

  // ── pointer handling (canvas) ───────────────────────────────────────

  const onPointerDown = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.focus();
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // (1) Handle dots take priority over keyform diamonds. Handles
    // draw only for SELECTED keyforms (SIPO_SELVHANDLESONLY), so we
    // walk every fcurve in the current selection — active first, then
    // context curves with any selection — and test each handle dot.
    // Audit-fix MED-B7 (2026-05-16): the prior pass tested ONLY the
    // active curve's handle dots, so a shift-selected context-curve
    // handle would draw but be unclickable (the click fell through to
    // the keyform-diamond pass and started a kf-move on whatever was
    // underneath). Mirrors Blender's `find_nearest_fcurve_vert` at
    // `reference/blender/source/blender/editors/space_graph/graph_select.cc:1714-1788`,
    // which walks ALL visible curves looking for nearest vert.
    const handleHitOrder = activeFCurveId
      ? [activeFCurveId, ...[...selectedHandles.keys()].filter((id) => id !== activeFCurveId)]
      : [...selectedHandles.keys()];
    for (const fcurveId of handleHitOrder) {
      const sub = selectedHandles.get(fcurveId);
      const fc = visible.find((d) => d.fcurve.id === fcurveId)?.fcurve;
      if (!sub || !fc) continue;
      let hitHandle = null;
      for (const [i] of sub) {
        const kf = fc.keyforms[i];
        if (!kf) continue;
        if (kf.handleLeft && hitTest(x, y, view.tx(kf.handleLeft.time), view.ty(kf.handleLeft.value), HIT_HANDLE_R)) {
          hitHandle = { idx: i, side: 'left' };
          break;
        }
        if (kf.handleRight && hitTest(x, y, view.tx(kf.handleRight.time), view.ty(kf.handleRight.value), HIT_HANDLE_R)) {
          hitHandle = { idx: i, side: 'right' };
          break;
        }
      }
      if (!hitHandle) continue;
      // Cross-curve handle pick → elevate to active (non-Shift only)
      // for parity with the diamond-pick code path.
      if (fcurveId !== activeFCurveId && !e.shiftKey) {
        const target = decodeFCurveTarget(fc);
        if (target) onPickActiveByTarget(target);
      }
      const subNext = e.shiftKey ? cloneSubSelection(sub) : new Map();
      const cur = subNext.get(hitHandle.idx) ?? { center: false, left: false, right: false };
      if (hitHandle.side === 'left') {
        if (!e.shiftKey) subNext.set(hitHandle.idx, { center: false, left: true, right: false });
        else             subNext.set(hitHandle.idx, { ...cur, left: true });
      } else {
        if (!e.shiftKey) subNext.set(hitHandle.idx, { center: false, left: false, right: true });
        else             subNext.set(hitHandle.idx, { ...cur, right: true });
      }
      if (e.shiftKey) setSubSelection(fcurveId, subNext);
      else            setSelectedHandles(new Map([[fcurveId, subNext]]));

      // Audit-fix HIGH-B1 (Slice 5.H dual-audit 2026-05-16) — Blender's
      // `may_activate` gate fires for ALL bezt hits (key, left handle,
      // right handle), not just diamond hits. Per
      // `graph_select.cc:1789-1797` the `if (nvi->bezt)` enclosing block
      // covers `NEAREST_HANDLE_KEY` AND `NEAREST_HANDLE_LEFT` AND
      // `NEAREST_HANDLE_RIGHT` (line 1761-1786). Pre-fix the SS handle-
      // hit path returned at line 791 without firing the setter, so
      // dragging a bezier handle dot left the active-keyform halo
      // pinned to a stale keyform. Per-handle `already_selected` check
      // matches Blender's per-side test at `graph_select.cc:1725-1728`.
      const handleSubPrev = sub ?? new Map();
      const handleSubPrevEntry = handleSubPrev.get(hitHandle.idx);
      const handleWasAlreadySelected = !!handleSubPrevEntry && (
        hitHandle.side === 'left' ? handleSubPrevEntry.left : handleSubPrevEntry.right
      );
      const handleSubNextEntry = subNext.get(hitHandle.idx);
      const handleIsSelectedAfter = !!handleSubNextEntry && (
        hitHandle.side === 'left' ? handleSubNextEntry.left : handleSubNextEntry.right
      );
      if (handleIsSelectedAfter) {
        const handleFC = visible.find((d) => d.fcurve.id === fcurveId)?.fcurve;
        const handleCurrentActive = getActiveKeyformIndex(handleFC);
        const handleMayActivate = !handleWasAlreadySelected ||
          handleCurrentActive === FCURVE_ACTIVE_KEYFORM_NONE;
        if (handleMayActivate) {
          update((p) => {
            const a = getActiveSceneAction(p, activeActionId);
            if (!a) return;
            setActiveKeyform(a, fcurveId, hitHandle.idx);
          });
        }
      }

      startHandleDrag(e, fcurveId, hitHandle.idx, hitHandle.side);
      return;
    }

    // (2) Keyform diamonds — walk ALL visible curves (active first).
    /** @type {null | {fcurveId:string, idx:number, isActive:boolean}} */
    let hit = null;
    if (activeFCurveId) {
      const activeFC = visible.find((d) => d.fcurve.id === activeFCurveId)?.fcurve;
      if (activeFC) {
        for (let i = 0; i < activeFC.keyforms.length; i++) {
          const kf = activeFC.keyforms[i];
          if (typeof kf.value !== 'number') continue;
          if (hitTest(x, y, view.tx(kf.time), view.ty(kf.value), HIT_KEYFRAME_R)) {
            hit = { fcurveId: activeFCurveId, idx: i, isActive: true };
            break;
          }
        }
      }
    }
    if (!hit) {
      for (const d of visible) {
        if (d.fcurve.id === activeFCurveId) continue;
        for (let i = 0; i < d.fcurve.keyforms.length; i++) {
          const kf = d.fcurve.keyforms[i];
          if (typeof kf.value !== 'number') continue;
          if (hitTest(x, y, view.tx(kf.time), view.ty(kf.value), HIT_KEYFRAME_R)) {
            hit = { fcurveId: d.fcurve.id, idx: i, isActive: false };
            break;
          }
        }
        if (hit) break;
      }
    }

    if (hit) {
      // Cross-curve click on a context curve → elevate to active first.
      // Mirrors `mouse_graph_keys` at
      // `reference/blender/source/blender/editors/space_graph/graph_select.cc:1850`,
      // which calls `ANIM_set_active_channel` at
      // `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:237`.
      // Audit-fix HIGH-B1 + MED-B4 (2026-05-16): citation corrected (the
      // prior `select_pchannel_keychannel_first` symbol was fabricated and
      // does not exist in Blender) AND the elevate now SKIPS on Shift,
      // matching Blender's `select_mode != SELECT_INVERT` guard at
      // `graph_select.cc:1843-1856` — Shift-click on a context-curve key
      // extends the keyform selection without changing the active channel.
      if (!hit.isActive && !e.shiftKey) {
        const target = decodeFCurveTarget(visible.find((d) => d.fcurve.id === hit.fcurveId)?.fcurve);
        if (target) {
          onPickActiveByTarget(target);
        }
      }
      const subPrev = selectedHandles.get(hit.fcurveId) ?? new Map();
      const subNext = e.shiftKey
        ? toggleKeyformInSub(subPrev, hit.idx)
        : new Map([[hit.idx, { center: true, left: true, right: true }]]);
      // Shift-click also leaves OTHER fcurves' selections intact;
      // non-shift replaces the WHOLE selection.
      if (e.shiftKey) {
        setSubSelection(hit.fcurveId, subNext);
      } else {
        setSelectedHandles(new Map([[hit.fcurveId, subNext]]));
      }

      // Slice 5.H — Blender's "may_activate" pattern for active keyform.
      // Mirrors `mouse_graph_keys` at
      // `reference/blender/source/blender/editors/space_graph/graph_select.cc:1789-1797`:
      //
      //   if (!run_modal && BEZT_ISSEL_ANY(bezt)) {
      //     const bool may_activate = !already_selected ||
      //                               BKE_fcurve_active_keyframe_index(...)
      //                                   == FCURVE_ACTIVE_KEYFRAME_NONE;
      //     if (may_activate) BKE_fcurve_active_keyframe_set(fcu, bezt);
      //   }
      //
      // The `!already_selected || current == NONE` gate is the
      // load-bearing detail: Shift-clicking an already-selected keyform
      // when something is already active leaves the active pointer
      // alone, so a multi-select extension doesn't steal focus from
      // whatever the user was numerically editing.
      // Audit-fix MED-B3 (Slice 5.H dual-audit 2026-05-16): per
      // `graph_select.cc:1725-1728` Blender's `already_selected` is
      // a per-handle check — for `NEAREST_HANDLE_KEY` it tests
      // `bezt->f2 & SELECT` (center only). The diamond hit path is
      // SS's `NEAREST_HANDLE_KEY` equivalent, so the precondition
      // should test only center. Pre-fix the helper checked ANY of
      // center/left/right, so a sequence of "shift-click left handle
      // → click center diamond" would mis-fire as already_selected
      // and skip the active set even when an active was elsewhere.
      const subPrevEntry = subPrev.get(hit.idx);
      const wasAlreadySelected = !!subPrevEntry && subPrevEntry.center;
      const subNextEntry = subNext.get(hit.idx);
      const isSelectedAfter = !!subNextEntry && subNextEntry.center;
      if (isSelectedAfter) {
        const hitFC = visible.find((d) => d.fcurve.id === hit.fcurveId)?.fcurve;
        const currentActive = getActiveKeyformIndex(hitFC);
        const mayActivate = !wasAlreadySelected ||
          currentActive === FCURVE_ACTIVE_KEYFORM_NONE;
        if (mayActivate) {
          update((p) => {
            const a = getActiveSceneAction(p, activeActionId);
            if (!a) return;
            setActiveKeyform(a, hit.fcurveId, hit.idx);
          });
        }
      }

      startKeyformDrag(e, hit.fcurveId, hit.idx);
      return;
    }

    if (!e.shiftKey) clearSelection();
    const ms = clamp(view.xToTime(x), 0, duration);
    onSeek(ms);
  }, [visible, activeFCurveId, view, selectedHandles, duration, onSeek, onPickActiveByTarget, update, activeActionId]);

  // ── single-keyform drag (Slice 5.B) ─────────────────────────────────

  function startKeyformDrag(e, fcurveId, kfIdx) {
    const initFC = action.fcurves.find((f) => f.id === fcurveId);
    const kf = initFC?.keyforms[kfIdx];
    if (!kf) return;
    // Slice 5.D edit-disabled gate: driven curves never mutate via drag.
    // The selection-set already happened in onPointerDown so the click
    // still highlights the kf -- only the drag-then-mutate path bails.
    if (hasDriver(initFC)) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    setViewLock({ minV: autoFit.minV, maxV: autoFit.maxV });
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const snap = view;
    const origTime = kf.time;
    const origValue = kf.value;
    const origHandleLeft = { ...kf.handleLeft };
    const origHandleRight = { ...kf.handleRight };
    const dragIdxRef = { current: kfIdx };
    let pendingSelectionIdx = null;

    const move = (ev) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const dTime = (dx / snap.plotW) * duration;
      const dValue = -(dy / snap.plotH) * snap.vSpan;

      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        const curIdx = dragIdxRef.current;
        const k = fc.keyforms[curIdx];
        if (!k) return;
        applyKeyformDrag(
          k,
          origTime,
          origValue,
          origHandleLeft,
          origHandleRight,
          dTime,
          dValue,
        );
        // Slice 5.H — per-tick active tracking through sort (single-
        // keyform drag variant). See bulk modal-grab onMove for the
        // sister wiring. The captured object reference might be the
        // same `k` if the user is dragging the active keyform, or a
        // different kf if they're dragging a non-active one — either
        // way the helper finds its post-sort position.
        const capturedActiveTick = captureActiveKeyformObject(fc);
        fc.keyforms.sort((a, b) => a.time - b.time);
        relocateActiveKeyformByObject(a, fcurveId, capturedActiveTick);
        const newIdx = fc.keyforms.indexOf(k);
        if (newIdx !== curIdx && newIdx >= 0) {
          dragIdxRef.current = newIdx;
          pendingSelectionIdx = newIdx;
        }
      }, { skipHistory: true });

      if (pendingSelectionIdx !== null) {
        setSelectedHandles(new Map([[fcurveId, new Map([[pendingSelectionIdx, { center: true, left: true, right: true }]])]]));
        pendingSelectionIdx = null;
      }
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        const curIdx = dragIdxRef.current;
        const sel = new Map([[curIdx, { center: true, left: true, right: true }]]);
        // Slice 5.H — capture active object pre-merge so it tracks
        // through the duplicate-collapse pass per Blender's invariant
        // (`fcurve.cc:1768-1770` — deleting/merging the active keyform
        // requires the index to be re-pointed or cleared).
        const capturedActive = captureActiveKeyformObject(fc);
        const remap = mergeDuplicateTimeKeys(fc, sel);
        recalcKeyformHandles(fc.keyforms);
        relocateActiveKeyformByObject(a, fcurveId, capturedActive);
        const finalIdx = remap.get(curIdx);
        if (typeof finalIdx === 'number' && finalIdx >= 0 && finalIdx !== curIdx) {
          queueMicrotask(() => {
            setSelectedHandles(new Map([[fcurveId, new Map([[finalIdx, { center: true, left: true, right: true }]])]]));
          });
        }
      }, { skipHistory: true });
      endBatch();
      setViewLock(null);
      dragCleanupRef.current = null;
    };
    const up = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function startHandleDrag(e, fcurveId, kfIdx, side) {
    const initFC = action.fcurves.find((f) => f.id === fcurveId);
    const kf = initFC?.keyforms[kfIdx];
    if (!kf) return;
    // Slice 5.D edit-disabled gate: same as startKeyformDrag.
    if (hasDriver(initFC)) return;
    const sourceHandle = side === 'left' ? kf.handleLeft : kf.handleRight;
    if (!sourceHandle) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    setViewLock({ minV: autoFit.minV, maxV: autoFit.maxV });
    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const snap = view;
    const origHandle = { ...sourceHandle };

    const move = (ev) => {
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const dTime = (dx / snap.plotW) * duration;
      const dValue = -(dy / snap.plotH) * snap.vSpan;

      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        const k = fc.keyforms[kfIdx];
        if (!k) return;
        applyHandleDrag(k, side, {
          time: origHandle.time + dTime,
          value: origHandle.value + dValue,
        });
      }, { skipHistory: true });
    };
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) return;
        recalcKeyformHandles(fc.keyforms);
      }, { skipHistory: true });
      endBatch();
      setViewLock(null);
      dragCleanupRef.current = null;
    };
    const up = () => cleanup();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  // ── modal G/S — Slice 5.C, cross-curve in 5.C+ ──────────────────────

  function startModal(kind, anchorClient) {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    setViewLock({ minV: autoFit.minV, maxV: autoFit.maxV });
    setModal({ kind });
    // Slice 5.E — clear axis-lock + typed buffer + numericMode for the
    // new modal session. The hook's reset is referentially stable; this
    // is a clean slate so the HUD doesn't show stale axis/typed text.
    modalInput.reset();

    const snap = view;

    // Per-FCurve origins + per-FCurve dragIdxByOrigin. The cross-curve
    // pivot is the median (time, value) across EVERY selected entry on
    // ANY curve — Blender's `transform_convert_graph.cc:962-988` does
    // the same (median pivot is global to the transform op).
    /** @type {Map<string, Map<number, ReturnType<typeof snapshotKeyform>>>} */
    const originsByFc = new Map();
    let pivotTime = 0;
    let pivotValue = 0;
    let n = 0;
    for (const [fcurveId, sub] of sel) {
      const fc = action.fcurves.find((f) => f.id === fcurveId);
      if (!fc) continue;
      // Slice 5.D edit-disabled gate: skip driven curves so they don't
      // enter the pivot OR get transformed. The n === 0 guard below
      // bails the modal cleanly if EVERY selected curve is driven.
      if (hasDriver(fc)) continue;
      const subOrigins = new Map();
      for (const [idx] of sub) {
        const k = fc.keyforms[idx];
        if (!k) continue;
        subOrigins.set(idx, snapshotKeyform(k));
        pivotTime += k.time;
        pivotValue += k.value;
        n++;
      }
      if (subOrigins.size > 0) originsByFc.set(fcurveId, subOrigins);
    }
    if (n === 0) {
      endBatch();
      setModal(null);
      setViewLock(null);
      return;
    }
    const pivot = { time: pivotTime / n, value: pivotValue / n };
    const startClientX = anchorClient.x;
    const startClientY = anchorClient.y;

    const pivotPxX = view.tx(pivot.time);
    const pivotPxY = view.ty(pivot.value);
    const rect = canvasRef.current?.getBoundingClientRect();
    const startDist = Math.hypot(
      (rect ? startClientX - rect.left : startClientX) - pivotPxX,
      (rect ? startClientY - rect.top  : startClientY) - pivotPxY,
    ) || 1;

    const msPerFrame = fps > 0 ? 1000 / fps : 1000 / 24;

    // Per-FCurve dragIdxByOrigin: each FCurve's selected origins track
    // their post-sort positions via object-identity (same pattern as
    // Slice 5.C's audit-fix HIGH-A2).
    /** @type {Map<string, Map<number, number>>} */
    let dragIdxByOriginByFc = new Map();
    for (const [fcurveId, subOrigins] of originsByFc) {
      const m = new Map();
      for (const [idx] of subOrigins) m.set(idx, idx);
      dragIdxByOriginByFc.set(fcurveId, m);
    }

    function applyModal(currentX, currentY, shiftKey, ctrlKey) {
      // Slice 5.E — read axis-lock + typed-numeric state from the
      // hook's synchronous ref. `onKey` updates the ref BEFORE calling
      // applyModal so the post-keystroke value lands on this tick.
      const { axis, typedBuffer, numericMode } = modalInput.stateRef.current;
      const typed = parseTyped(typedBuffer);
      const typedFinite = Number.isFinite(typed);
      const useTyped = typedFinite || numericMode;

      const dxPx = currentX - startClientX;
      const dyPx = currentY - startClientY;
      let dTime = (dxPx / snap.plotW) * duration;
      let dValue = -(dyPx / snap.plotH) * snap.vSpan;

      // Shift = MOD_PRECISION (Blender `transform_snap.cc:1726`). Typed
      // values are exact -- precision multiplier doesn't apply there.
      if (!useTyped && shiftKey) { dTime *= 0.1; dValue *= 0.1; }

      // Typed override for G. Translates to canvas-frame units:
      //   - axis 'x' or null: typed = frames on the time axis (default
      //     to X per Blender's "G → type → axis defaults to X" at
      //     `transform_input.cc:131-148`). For empty-buffer numericMode
      //     `typed` is 0 -- modal holds at zero.
      //   - axis 'y': typed = raw value units on the value axis.
      // Frame-based units (not ms) match the user-visible axis labels;
      // see file-header "Slice 5.E units" note.
      if (useTyped && kind === 'g') {
        const v = typedFinite ? typed : 0;
        if (axis === 'y') {
          dTime = 0;
          dValue = v;
        } else {
          dTime = msPerFrame > 0 ? v * msPerFrame : v;
          dValue = 0;
        }
      }

      // Frame-snap (Ctrl) only when NOT typing -- typed values are exact.
      if (!useTyped && kind === 'g' && ctrlKey && msPerFrame > 0) {
        // Audit-fix MED-B5 (2026-05-16): snap absolute final pivot time
        // to whole frames, then re-derive dTime as (snappedPivot -
        // origPivot). This mirrors Blender's modal-G + T_SNAP_KEYS
        // behaviour where the selection's reference point lands ON a
        // frame regardless of where it started, vs the prior bug where
        // snapping the DELTA preserved sub-frame offsets indefinitely
        // (a kf starting at t=17ms would land on t=17+N*msPerFrame).
        const wantPivot = Math.round((pivot.time + dTime) / msPerFrame) * msPerFrame;
        dTime = wantPivot - pivot.time;
      }

      // Axis lock for G (post-typed, post-snap so it always wins). For
      // 'x' axis: clamp value-delta to zero; for 'y': clamp time-delta.
      // No-op for `useTyped` because the typed branch above already
      // wrote a single-axis delta.
      if (!useTyped && kind === 'g') {
        if (axis === 'x') dValue = 0;
        if (axis === 'y') dTime = 0;
      }

      const curDist = Math.hypot(
        (rect ? currentX - rect.left : currentX) - pivotPxX,
        (rect ? currentY - rect.top  : currentY) - pivotPxY,
      );
      let scaleFactor = curDist / startDist;
      if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) scaleFactor = 1;
      if (!useTyped && shiftKey) scaleFactor = 1 + 0.1 * (scaleFactor - 1);
      if (!useTyped && kind === 's' && ctrlKey) {
        scaleFactor = Math.round(scaleFactor * 10) / 10 || 0.1;
      }
      // Typed scale: multiplier directly. Empty-buffer numericMode = 1
      // (identity) so the modal holds without growing/shrinking.
      if (useTyped && kind === 's') {
        scaleFactor = typedFinite ? typed : 1;
        if (!Number.isFinite(scaleFactor) || scaleFactor === 0) scaleFactor = 1;
      }
      // Axis lock for S: apply scaleFactor to ONLY one axis, leave the
      // other at 1. `applyScale`'s last two args are (scaleX, scaleY).
      const scaleX = kind === 's' && axis === 'y' ? 1 : scaleFactor;
      const scaleY = kind === 's' && axis === 'x' ? 1 : scaleFactor;

      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        const nextMapByFc = new Map();
        for (const [fcurveId, sub] of sel) {
          const fc = a.fcurves.find((f) => f.id === fcurveId);
          if (!fc) continue;
          const dragMap = dragIdxByOriginByFc.get(fcurveId);
          const origMap = originsByFc.get(fcurveId);
          if (!dragMap || !origMap) continue;
          const workSelection = new Map();
          const workOrigins = new Map();
          for (const [origIdx, parts] of sub) {
            const curIdx = dragMap.get(origIdx);
            if (typeof curIdx !== 'number') continue;
            const k = fc.keyforms[curIdx];
            if (!k) continue;
            workSelection.set(curIdx, parts);
            const o = origMap.get(origIdx);
            if (o) workOrigins.set(curIdx, o);
          }
          if (kind === 'g') {
            applyGrab(fc, workSelection, workOrigins, dTime, dValue);
          } else {
            applyScale(fc, workSelection, workOrigins, pivot, scaleX, scaleY);
          }
          // Identity-track post-sort indices.
          /** @type {Map<number, any>} */
          const objsByOrigIdx = new Map();
          for (const [origIdx, curIdx] of dragMap) {
            const k = fc.keyforms[curIdx];
            if (k) objsByOrigIdx.set(origIdx, k);
          }
          // Slice 5.H — per-tick active tracking. The sort below may
          // shift the active keyform's index; track by object so the
          // highlight stays on the right vertex throughout the modal
          // drag. (Without this, the highlight would jump to whatever
          // kf happens to occupy the pre-sort active index.)
          const capturedActiveTick = captureActiveKeyformObject(fc);
          fc.keyforms.sort((a, b) => a.time - b.time);
          relocateActiveKeyformByObject(a, fcurveId, capturedActiveTick);
          const nextMap = new Map();
          for (const [origIdx, obj] of objsByOrigIdx) {
            const ni = fc.keyforms.indexOf(obj);
            if (ni >= 0) nextMap.set(origIdx, ni);
          }
          nextMapByFc.set(fcurveId, nextMap);
        }
        dragIdxByOriginByFc = nextMapByFc;
      }, { skipHistory: true });

      // Reflect post-sort indices to React selection state.
      const nextSel = new Map();
      for (const [fcurveId, sub] of sel) {
        const dragMap = dragIdxByOriginByFc.get(fcurveId);
        if (!dragMap) continue;
        const subNext = new Map();
        for (const [origIdx, parts] of sub) {
          const newIdx = dragMap.get(origIdx);
          if (typeof newIdx === 'number') subNext.set(newIdx, parts);
        }
        if (subNext.size > 0) nextSel.set(fcurveId, subNext);
      }
      setSelectedHandles(nextSel);
    }

    function commit() { cleanup(false); }
    function revert() {
      update((p) => {
        const a = getActiveSceneAction(p, activeActionId);
        if (!a) return;
        for (const [fcurveId, subOrigins] of originsByFc) {
          const fc = a.fcurves.find((f) => f.id === fcurveId);
          if (!fc) continue;
          const dragMap = dragIdxByOriginByFc.get(fcurveId);
          if (!dragMap) continue;
          for (const [origIdx, o] of subOrigins) {
            const curIdx = dragMap.get(origIdx);
            if (typeof curIdx !== 'number') continue;
            const k = fc.keyforms[curIdx];
            if (!k) continue;
            k.time = o.time;
            k.value = o.value;
            k.handleLeft = { time: o.handleLeft.time, value: o.handleLeft.value };
            k.handleRight = { time: o.handleRight.time, value: o.handleRight.value };
            if (o.handleType) k.handleType = { left: o.handleType.left, right: o.handleType.right };
          }
          // Audit-fix HIGH-A1 (Slice 5.H dual-audit 2026-05-16) —
          // the revert restores keyform times, then re-sorts to
          // re-establish original order. `activeKeyformIndex` holds
          // the drag-final tracked index from onMove's last tick;
          // after the times-restore + sort the indices shift back
          // toward originals, and the field would point at the wrong
          // object without this capture/relocate pair. Same pattern
          // as the per-tick onMove sort + cleanup merge wirings.
          const capturedActive = captureActiveKeyformObject(fc);
          fc.keyforms.sort((a, b) => a.time - b.time);
          relocateActiveKeyformByObject(a, fcurveId, capturedActive);
        }
      }, { skipHistory: true });
      // Restore original selection.
      setSelectedHandles(cloneFullSelection(sel));
      cleanup(true);
    }
    function cleanup(cancelled) {
      window.removeEventListener('mousemove', onMove, { capture: true });
      window.removeEventListener('mousedown', onClickCommit, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
      if (!cancelled) {
        update((p) => {
          const a = getActiveSceneAction(p, activeActionId);
          if (!a) return;
          /** @type {Map<string, Map<number, number>>} */
          const remapsByFc = new Map();
          for (const [fcurveId, sub] of sel) {
            const fc = a.fcurves.find((f) => f.id === fcurveId);
            if (!fc) continue;
            const dragMap = dragIdxByOriginByFc.get(fcurveId);
            if (!dragMap) continue;
            const workSub = new Map();
            for (const [origIdx, parts] of sub) {
              const curIdx = dragMap.get(origIdx);
              if (typeof curIdx === 'number') workSub.set(curIdx, parts);
            }
            // Slice 5.H — capture pre-merge active object so it
            // tracks through `mergeDuplicateTimeKeys` (Blender's per-
            // op active-keyframe rebind, `fcurve.cc:1768-1770`).
            const capturedActive = captureActiveKeyformObject(fc);
            const remap = mergeDuplicateTimeKeys(fc, workSub);
            recalcKeyformHandles(fc.keyforms);
            relocateActiveKeyformByObject(a, fcurveId, capturedActive);
            remapsByFc.set(fcurveId, remap);
          }
          queueMicrotask(() => {
            const nextSel = new Map();
            for (const [fcurveId, sub] of sel) {
              const dragMap = dragIdxByOriginByFc.get(fcurveId);
              const remap = remapsByFc.get(fcurveId);
              if (!dragMap || !remap) continue;
              const subNext = new Map();
              for (const [origIdx, parts] of sub) {
                const curIdx = dragMap.get(origIdx);
                if (typeof curIdx !== 'number') continue;
                const finalIdx = remap.get(curIdx);
                if (typeof finalIdx === 'number' && finalIdx >= 0) {
                  subNext.set(finalIdx, parts);
                }
              }
              if (subNext.size > 0) nextSel.set(fcurveId, subNext);
            }
            setSelectedHandles(nextSel);
          });
        }, { skipHistory: true });
      }
      endBatch();
      setViewLock(null);
      setModal(null);
      // Slice 5.E — clear axis/typed/numericMode so a stale axis label
      // doesn't surface on the NEXT modal session (which calls reset()
      // at startup too, but a clean teardown is cheap and keeps the
      // store/hook consistent between commits).
      modalInput.reset();
      modalCleanupRef.current = null;
    }

    let shiftHeld = false;
    let ctrlHeld = false;
    let lastX = startClientX;
    let lastY = startClientY;

    function onMove(ev) {
      lastX = ev.clientX;
      lastY = ev.clientY;
      shiftHeld = ev.shiftKey;
      ctrlHeld = ev.ctrlKey || ev.metaKey;
      applyModal(lastX, lastY, shiftHeld, ctrlHeld);
    }
    function onClickCommit(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.button === 2) revert();
      else commit();
    }
    function onContextMenu(ev) {
      ev.preventDefault();
      ev.stopPropagation();
      revert();
    }
    function onKey(ev) {
      // Slice 5.E — axis-lock + typed-numeric routed through the shared
      // keyEventToAction helper so X/Y/=/digits/Backspace match the
      // viewport modal exactly (single rules-source per Rule №1).
      const action = keyEventToAction(ev);
      if (action) {
        ev.preventDefault();
        ev.stopPropagation();
        if (action.type === 'cancel') { revert(); return; }
        if (action.type === 'commit') { commit(); return; }
        // `noop` (Shift+X/Y in 2D editors per `transform.cc:660-662`)
        // and every state-transition action route through dispatch.
        // dispatch updates `stateRef.current` synchronously BEFORE
        // applyModal reads from it -- so the new axis/typed/numericMode
        // value drives this tick, not the prior one.
        modalInput.dispatch(action);
        applyModal(lastX, lastY, shiftHeld, ctrlHeld);
        return;
      }
      // Modifier-only re-tick: Shift/Ctrl press/release should re-apply
      // immediately so MOD_PRECISION + frame-snap engage without waiting
      // for a mousemove. Other unrecognised keys still preventDefault to
      // keep global hotkeys (Tab / F-keys / etc.) from firing mid-modal.
      if (ev.key === 'Shift' || ev.key === 'Control' || ev.key === 'Meta') {
        shiftHeld = ev.shiftKey;
        ctrlHeld = ev.ctrlKey || ev.metaKey;
        applyModal(lastX, lastY, shiftHeld, ctrlHeld);
      }
      ev.preventDefault();
      ev.stopPropagation();
    }

    window.addEventListener('mousemove', onMove, { capture: true });
    window.addEventListener('mousedown', onClickCommit, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    modalCleanupRef.current = () => cleanup(true);
    applyModal(startClientX, startClientY, false, false);
  }

  // ── Box-select (B) — Slice 5.C, cross-curve in 5.C+ ─────────────────

  function startBoxSelect(anchorClient) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = anchorClient.x - rect.left;
    const startY = anchorClient.y - rect.top;
    setBoxSelect({ x: startX, y: startY, curX: startX, curY: startY, modifier: 'replace' });

    function removeListeners() {
      window.removeEventListener('mousemove', onMove, { capture: true });
      window.removeEventListener('mouseup', onUp, { capture: true });
      window.removeEventListener('keydown', onKey, { capture: true });
    }
    function onMove(ev) {
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) return;
      const cx = ev.clientX - r.left;
      const cy = ev.clientY - r.top;
      const modifier = ev.shiftKey ? 'add' : (ev.ctrlKey || ev.metaKey) ? 'subtract' : 'replace';
      setBoxSelect({ x: startX, y: startY, curX: cx, curY: cy, modifier });
    }
    function onUp(ev) {
      removeListeners();
      boxSelectCleanupRef.current = null;
      const r = canvasRef.current?.getBoundingClientRect();
      if (!r) { setBoxSelect(null); return; }
      const cx = ev.clientX - r.left;
      const cy = ev.clientY - r.top;
      const modifier = ev.shiftKey ? 'add' : (ev.ctrlKey || ev.metaKey) ? 'subtract' : 'replace';
      const x1 = Math.min(startX, cx);
      const y1 = Math.min(startY, cy);
      const x2 = Math.max(startX, cx);
      const y2 = Math.max(startY, cy);
      if (Math.abs(x2 - x1) >= 2 && Math.abs(y2 - y1) >= 2) {
        applyBoxSelect(x1, y1, x2, y2, modifier);
      }
      setBoxSelect(null);
    }
    function onKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        removeListeners();
        boxSelectCleanupRef.current = null;
        setBoxSelect(null);
      }
    }
    window.addEventListener('mousemove', onMove, { capture: true });
    window.addEventListener('mouseup', onUp, { capture: true });
    window.addEventListener('keydown', onKey, { capture: true });
    boxSelectCleanupRef.current = () => {
      removeListeners();
      boxSelectCleanupRef.current = null;
      setBoxSelect(null);
    };
  }

  // Cross-curve: iterate ALL visible FCurves, test each kf's centre +
  // both handle dots against the rect. `include_handles=true` matches
  // Blender's `GRAPH_OT_select_box` default at `graph_select.cc:578-587`
  // (`incl_handles=true` → `KEYFRAME_ITER_INCL_HANDLES`); each handle is
  // INDEPENDENTLY tested at `keyframes_edit.cc:1527-1536` via the
  // `KEYFRAME_OK_KEY/H1/H2` bits, then OR'd into BEZT's `f1/f2/f3` —
  // SS mirrors that per-component test below. Audit-fix MED-A4: read
  // view via viewRef so a mid-drag resize uses the live transform.
  function applyBoxSelect(x1, y1, x2, y2, modifier) {
    const v = viewRef.current ?? view;
    const base = modifier === 'replace' ? new Map() : cloneFullSelection(selectionRef.current);
    const inRect = (px, py) => px >= x1 && px <= x2 && py >= y1 && py <= y2;
    for (const d of visible) {
      const subBase = base.get(d.fcurve.id) ?? new Map();
      const subNext = new Map(subBase);
      for (let i = 0; i < d.fcurve.keyforms.length; i++) {
        const kf = d.fcurve.keyforms[i];
        if (typeof kf.value !== 'number') continue;
        const kx = v.tx(kf.time);
        const ky = v.ty(kf.value);
        const cur = subNext.get(i) ?? { center: false, left: false, right: false };
        const centerIn = inRect(kx, ky);
        const leftIn = kf.handleLeft && inRect(v.tx(kf.handleLeft.time), v.ty(kf.handleLeft.value));
        const rightIn = kf.handleRight && inRect(v.tx(kf.handleRight.time), v.ty(kf.handleRight.value));
        if (modifier === 'subtract') {
          const out = {
            center: cur.center && !centerIn,
            left:   cur.left   && !leftIn,
            right:  cur.right  && !rightIn,
          };
          if (out.center || out.left || out.right) subNext.set(i, out);
          else subNext.delete(i);
        } else {
          const out = {
            center: cur.center || centerIn,
            left:   cur.left   || leftIn,
            right:  cur.right  || rightIn,
          };
          if (out.center || out.left || out.right) subNext.set(i, out);
        }
      }
      if (subNext.size > 0) base.set(d.fcurve.id, subNext);
      else base.delete(d.fcurve.id);
    }
    setSelectedHandles(base);
  }

  // ── Operator handlers (V / T / Shift+E / Delete / Home / Ctrl+G) ───
  // Per-curve iteration — operators apply to every FCurve in the selection.

  function operatorSetHandleType(type) {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      for (const [fcurveId, sub] of sel) {
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) continue;
        // Slice 5.D edit-disabled gate: skip driven curves so a mixed
        // selection still mutates the undriven ones.
        if (hasDriver(fc)) continue;
        setHandleType(fc, sub, type, 'both');
        recalcKeyformHandles(fc.keyforms);
      }
    });
    endBatch();
  }

  function operatorSetInterpolation(interp) {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      for (const [fcurveId, sub] of sel) {
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) continue;
        if (hasDriver(fc)) continue; // Slice 5.D edit-disabled gate
        setInterpolation(fc, sub, interp);
        recalcKeyformHandles(fc.keyforms);
      }
    });
    endBatch();
  }

  function operatorSetExtrapolation(extrap) {
    // Extrapolation is a per-FCurve property; apply to every FCurve in
    // the selection. If no selection but an active curve exists, fall
    // back to it (Blender's behaviour for "operate on active").
    const sel = selectionRef.current;
    const targetIds = sel.size > 0
      ? [...sel.keys()]
      : (activeFCurveId ? [activeFCurveId] : []);
    if (targetIds.length === 0) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      for (const fcurveId of targetIds) {
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) continue;
        if (hasDriver(fc)) continue; // Slice 5.D edit-disabled gate
        setExtrapolation(fc, extrap);
      }
    });
    endBatch();
  }

  function operatorDelete() {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    // Last-kf guard runs PER-CURVE — refuse to drop any FCurve's last
    // keyform (the Timeline shows ≥1-kf curves only). Audit-fix HIGH-A4
    // from Slice 5.C: the FAST pre-batch guard fires BEFORE `beginBatch`
    // so a no-op delete pushes no phantom undo snapshot.
    /** @type {Map<string, Map<number, any>>} */
    const toDelete = new Map();
    let anyDeletable = false;
    for (const [fcurveId, sub] of sel) {
      const fc = action.fcurves.find((f) => f.id === fcurveId);
      if (!fc) continue;
      if (hasDriver(fc)) continue; // Slice 5.D edit-disabled gate
      const wouldDelete = countDeletableInSub(sub);
      if (wouldDelete === 0) continue;
      if (fc.keyforms.length - wouldDelete < 1) continue;
      toDelete.set(fcurveId, sub);
      anyDeletable = true;
    }
    if (!anyDeletable) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      /** @type {Map<string, Map<number, number>>} */
      const remapsByFc = new Map();
      for (const [fcurveId, sub] of toDelete) {
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) continue;
        // Audit-fix HIGH-A7 (2026-05-16): re-check the guard against
        // the LIVE draft. The pre-batch guard reads from `action` (the
        // memo snapshot from last render), so two rapid Delete presses
        // both see the stale length. The second press would pass the
        // pre-batch guard (length-N >= 1 against the original count)
        // but the live draft already has N fewer keyforms from the
        // first delete still settling — bypassing the guard could drop
        // the FCurve's final keyform. Cheap defense: re-check inside.
        const liveWould = countDeletableInSub(sub);
        if (fc.keyforms.length - liveWould < 1) continue;
        const remap = deleteKeyforms(fc, sub);
        recalcKeyformHandles(fc.keyforms);
        // Slice 5.H — mirror `fcurve.cc:1768-1770`: if the active
        // keyform was just deleted, clear active; otherwise shift
        // its index through the remap.
        remapActiveKeyform(a, fcurveId, remap);
        remapsByFc.set(fcurveId, remap);
      }
      queueMicrotask(() => {
        const nextSel = new Map();
        for (const [fcurveId, sub] of sel) {
          const remap = remapsByFc.get(fcurveId);
          if (!remap) {
            // Untouched FCurve — preserve its sub-selection as-is.
            nextSel.set(fcurveId, cloneSubSelection(sub));
            continue;
          }
          const remapped = remapSelection(sub, remap);
          if (remapped.size > 0) nextSel.set(fcurveId, remapped);
        }
        setSelectedHandles(nextSel);
      });
    });
    endBatch();
  }

  function operatorHome() {
    setViewLock(null);
  }

  function operatorSnapToFrame() {
    const sel = selectionRef.current;
    if (sel.size === 0) return;
    const msPerFrame = fps > 0 ? 1000 / fps : 1000 / 24;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      /** @type {Map<string, {postSortSel:Map<number,any>, remap:Map<number,number>}>} */
      const resultByFc = new Map();
      for (const [fcurveId, sub] of sel) {
        const fc = a.fcurves.find((f) => f.id === fcurveId);
        if (!fc) continue;
        if (hasDriver(fc)) continue; // Slice 5.D edit-disabled gate
        // Same identity-track pattern as Slice 5.C audit-fix HIGH-A1.
        /** @type {Map<number, any>} */
        const objsByOrigIdx = new Map();
        for (const [origIdx] of sub) {
          const k = fc.keyforms[origIdx];
          if (k) objsByOrigIdx.set(origIdx, k);
        }
        // Slice 5.H — capture pre-snap active object so it tracks
        // through snap + sort + merge per Blender's invariant
        // (`fcurve.cc:1313-1320` sort tracking + `:1768-1770` merge).
        const capturedActive = captureActiveKeyformObject(fc);
        snapKeyformsToFrame(fc, sub, msPerFrame);
        fc.keyforms.sort((a, b) => a.time - b.time);
        const postSortSel = new Map();
        for (const [origIdx, parts] of sub) {
          const obj = objsByOrigIdx.get(origIdx);
          if (!obj) continue;
          const ni = fc.keyforms.indexOf(obj);
          if (ni >= 0) postSortSel.set(ni, parts);
        }
        const remap = mergeDuplicateTimeKeys(fc, postSortSel);
        recalcKeyformHandles(fc.keyforms);
        relocateActiveKeyformByObject(a, fcurveId, capturedActive);
        resultByFc.set(fcurveId, { postSortSel, remap });
      }
      queueMicrotask(() => {
        const nextSel = new Map();
        for (const [fcurveId, { postSortSel, remap }] of resultByFc) {
          const remapped = remapSelection(postSortSel, remap);
          if (remapped.size > 0) nextSel.set(fcurveId, remapped);
        }
        setSelectedHandles(nextSel);
      });
    });
    endBatch();
  }

  function operatorSelectAll() {
    // Select-all across ALL visible curves' ALL keyforms.
    const next = new Map();
    for (const d of visible) {
      const sub = new Map();
      for (let i = 0; i < d.fcurve.keyforms.length; i++) {
        sub.set(i, { center: true, left: true, right: true });
      }
      if (sub.size > 0) next.set(d.fcurve.id, sub);
    }
    setSelectedHandles(next);
  }

  // ── Hotkey dispatch ─────────────────────────────────────────────────

  const onKeyDown = useCallback((e) => {
    if (modal) return;
    if (menu) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const rect = canvasRef.current?.getBoundingClientRect();
    const anchor = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: 0, y: 0 };

    if (e.code === 'KeyG') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) operatorSnapToFrame();
      else startModal('g', anchor);
      return;
    }
    if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      startModal('s', anchor);
      return;
    }
    if (e.code === 'KeyB') {
      e.preventDefault();
      startBoxSelect(anchor);
      return;
    }
    if (e.code === 'KeyV') {
      e.preventDefault();
      if (selectionRef.current.size === 0) return;
      setMenu({ kind: 'handleType', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (selectionRef.current.size === 0) return;
      setMenu({ kind: 'interpolation', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'KeyE' && e.shiftKey) {
      e.preventDefault();
      setMenu({ kind: 'extrapolation', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'Delete' || e.code === 'KeyX') {
      e.preventDefault();
      operatorDelete();
      return;
    }
    if (e.code === 'Home') {
      e.preventDefault();
      operatorHome();
      return;
    }
    if (e.code === 'KeyA' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (selectionRef.current.size > 0) clearSelection();
      else operatorSelectAll();
      return;
    }
    // Audit-fix HIGH-A5 (2026-05-16): include `activeActionId` so that
    // switching the scene-bound action between keypresses doesn't leave
    // `onKeyDown` closing over a stale id (which would silently no-op
    // operators against the wrong action's getActiveSceneAction result).
  }, [modal, menu, fps, view, visible, activeFCurveId, activeActionId]);

  // ── Slice 5.D — driver banner + live value ──────────────────────────

  // The active FCurve's driver (if any). Re-resolved per render because
  // `activeFCurveDecoded` below is also per-render; cheap object lookup.
  const activeDriver = useMemo(() => {
    const fc = visible.find((d) => d.fcurve.id === activeFCurveId)?.fcurve;
    return hasDriver(fc) ? fc.driver : null;
  }, [visible, activeFCurveId]);

  // Live-evaluate the driver at the current time so the banner tracks
  // the playhead. `evaluateDriver`'s variable resolution reads project
  // state via `evaluateRnaPath`, hence the project dep. `currentTime`
  // is the only animation-time signal the driver expression sees today
  // (Blender's `self` ref isn't implemented per driver.js "Deviations").
  const project = useProjectStore((s) => s.project);
  const driverValue = useMemo(() => {
    if (!activeDriver) return null;
    return evaluateDriver(activeDriver, { project });
    // currentTime kept in deps so the banner re-renders on playhead
    // movement even though the driver expression doesn't accept time
    // directly -- driven RNA paths may resolve to time-varying values.
  }, [activeDriver, project, currentTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear-driver action: drops `fcurve.driver` in a batched updateProject
  // so it lands as one undo entry. After the mutation the curve becomes
  // editable again (the per-fcurve gate inside operator handlers reads
  // `hasDriver` per-call so the next G/S/V/T/Delete picks up the change
  // without any extra plumbing). Mirrors Blender's
  // `ANIM_OT_driver_button_remove`-style "remove driver" action.
  const onClearActiveDriver = useCallback(() => {
    if (!activeFCurveId) return;
    const proj = useProjectStore.getState().project;
    beginBatch(proj);
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const fc = a.fcurves.find((f) => f.id === activeFCurveId);
      if (!fc) return;
      clearDriver(fc);
    });
    endBatch();
  }, [activeFCurveId, activeActionId, update]);

  // Sidebar action — toggle visibility.
  //
  // Slice 5.I — writes the persisted `fcurve.hide` boolean (negative of
  // Blender's `FCURVE_VISIBLE`). Like Slice 5.G's mute toggle, hide
  // IS in the undo stack — Blender's
  // `ANIM_OT_channels_setting_toggle` carries `OPTYPE_UNDO` at
  // `anim_channels_edit.cc:3105`, and visibility is data not view
  // state (survives editor remount, save/load, action switch).
  // See [src/anim/fcurveVisible.js](../../../anim/fcurveVisible.js).
  const toggleHidden = useCallback((fcurveId) => {
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      toggleFCurveHidden(a, fcurveId);
    });
  }, [activeActionId, update]);

  // Slice 5.F — channel selection (independent of "active").
  //
  // Writes the per-FCurve `selected` boolean into `project.actions[i]`
  // and returns the helper's decision so the click handler can wire the
  // out-of-action side-effects (set active, clear keyform selection).
  //
  // Audit-fix HIGH-A1 (2026-05-16): `skipHistory: true` — channel
  // selection is view state, not data. Blender doesn't record channel-
  // selection changes in its undo stack either; pushing a snapshot per
  // sidebar click would burn the 50-entry undo budget on UI navigation
  // noise and evict real edit history. (Prior commit used
  // `beginBatch`/`endBatch` which always pushes a snapshot at depth 0.)
  //
  // Mirrors Blender's `click_select_channel_fcurve` at
  // `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:4223-4257`
  // (dispatched from `mouse_anim_channels` at line 4475) — see
  // [src/anim/fcurveChannelSelect.js](../../../anim/fcurveChannelSelect.js)
  // for the full provenance trace.
  const applyChannelClick = useCallback((fcurveId, modifier) => {
    let decision = { makeActive: false, selectedNow: false };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      decision = applyChannelSelect(a, fcurveId, modifier);
    }, { skipHistory: true });
    return decision;
  }, [activeActionId, update]);

  // Slice 5.G — channel mute toggle (Blender's FCURVE_MUTED bit).
  //
  // Unlike Slice 5.F's selection toggle, mute IS in the undo stack: it
  // changes which curves drive properties, so it's data not view state.
  // Blender records `ANIM_OT_channels_setting_toggle` writes in undo
  // for the same reason. No `skipHistory:true` here.
  //
  // The eval-side gate lives at the caller (animationFCurve +
  // depgraph/kernels/fcurve.js) per Blender's `is_fcurve_evaluatable`
  // pattern. See [src/anim/fcurveMute.js](../../../anim/fcurveMute.js).
  const onToggleMute = useCallback((fcurveId) => {
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      toggleFCurveMute(a, fcurveId);
    });
  }, [activeActionId, update]);

  // For the menu, "current" needs to know the active fcurve to read
  // extrapolation; for handle type / interp we use the most-common value
  // across the WHOLE multi-curve selection.
  const activeFCurveDecoded = visible.find((d) => d.fcurve.id === activeFCurveId)?.fcurve ?? null;

  return (
    <div
      ref={wrapRef}
      className="relative w-full h-full flex focus:outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerEnter={() => wrapRef.current?.focus({ preventScroll: true })}
    >
      <Sidebar
        decoded={decoded}
        activeFCurveId={activeFCurveId}
        onToggleHidden={toggleHidden}
        onToggleMute={onToggleMute}
        onPickActiveByTarget={onPickActiveByTarget}
        onApplyChannelClick={applyChannelClick}
        onClearKeyformSelection={clearSelection}
        selection={selectedHandles}
      />

      <div className="flex-1 min-w-0 h-full flex flex-col">
        {activeDriver ? (
          <DriverBanner
            driver={activeDriver}
            value={driverValue}
            color={visible.find((d) => d.fcurve.id === activeFCurveId)?.color ?? null}
            label={visible.find((d) => d.fcurve.id === activeFCurveId)?.label ?? ''}
            onClear={onClearActiveDriver}
          />
        ) : null}

        <div ref={plotAreaRef} className="relative flex-1 min-w-0">
        <svg
          width={view.w}
          height={view.h}
          className="absolute inset-0 pointer-events-none"
        >
          <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={view.h - PAD_B}
            stroke="currentColor" className="text-border" strokeWidth={1} />
          <line x1={PAD_L} y1={view.h - PAD_B} x2={view.w - PAD_R} y2={view.h - PAD_B}
            stroke="currentColor" className="text-border" strokeWidth={1} />

          <text x={PAD_L - 4} y={PAD_T + 8} textAnchor="end" fontSize={10}
            className="fill-muted-foreground font-mono">{maxV.toFixed(2)}</text>
          <text x={PAD_L - 4} y={view.h - PAD_B} textAnchor="end" fontSize={10}
            className="fill-muted-foreground font-mono">{minV.toFixed(2)}</text>

          {[0, 0.33, 0.67, 1].map((p) => (
            <text key={p}
              x={view.tx(p * duration)} y={view.h - 4} textAnchor="middle" fontSize={10}
              className="fill-muted-foreground font-mono">
              {((p * duration) / 1000).toFixed(1)}s
            </text>
          ))}

          {minV < 0 && maxV > 0 ? (
            <line x1={PAD_L} y1={view.ty(0)} x2={view.w - PAD_R} y2={view.ty(0)}
              stroke="currentColor" className="text-border/60" strokeDasharray="2 2" strokeWidth={1} />
          ) : null}

          {curvePaths.map((cp) => (
            <path
              key={cp.id}
              d={cp.d}
              fill="none"
              // Slice 5.G — muted curves draw in neutral grey at 0.35
              // alpha. Mirrors Blender's `graph_draw.cc:1190-1194`
              // (`immUniformThemeColorShade(TH_HEADER, 50)`). Active +
              // muted still draws greyed (not the brighter active
              // colour) — Blender does the same, mute wins over active
              // for the stroke choice.
              stroke={cp.isMuted ? 'hsl(0 0% 55%)' : cp.color}
              strokeOpacity={cp.isMuted ? 0.35 : (cp.isActive ? 1.0 : CTX_ALPHA)}
              strokeWidth={cp.isActive ? 2.5 : 1.0}
            />
          ))}

          <line x1={view.tx(currentTime)} y1={PAD_T}
            x2={view.tx(currentTime)} y2={view.h - PAD_B}
            stroke="currentColor" className="text-primary/70" strokeWidth={1} />

          {boxSelect ? (
            <rect
              x={Math.min(boxSelect.x, boxSelect.curX)}
              y={Math.min(boxSelect.y, boxSelect.curY)}
              width={Math.abs(boxSelect.curX - boxSelect.x)}
              height={Math.abs(boxSelect.curY - boxSelect.y)}
              fill="hsl(25 95% 55% / 0.10)"
              stroke="hsl(25 95% 55%)"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          ) : null}
        </svg>

        <canvas
          ref={canvasRef}
          className="absolute inset-0 cursor-crosshair focus:outline-none"
          tabIndex={-1}
          onPointerDown={onPointerDown}
        />

        {modal ? (
          <ModalHUD
            kind={modal.kind}
            axis={modalInput.state.axis}
            typedBuffer={modalInput.state.typedBuffer}
            numericMode={modalInput.state.numericMode}
          />
        ) : null}
        {menu ? (
          <OperatorMenu
            menu={menu}
            selection={selectedHandles}
            action={action}
            activeFCurve={activeFCurveDecoded}
            onClose={() => setMenu(null)}
            onPickHandleType={operatorSetHandleType}
            onPickInterpolation={operatorSetInterpolation}
            onPickExtrapolation={operatorSetExtrapolation}
          />
        ) : null}
        </div>
      </div>
    </div>
  );
}

// ── Sidebar (Slice 5.C+) ─────────────────────────────────────────────

function Sidebar({ decoded, activeFCurveId, onToggleHidden, onToggleMute, onPickActiveByTarget, onApplyChannelClick, onClearKeyformSelection, selection }) {
  return (
    <div
      className="border-r border-border bg-card/50 overflow-y-auto flex-shrink-0"
      style={{ width: SIDEBAR_W }}
    >
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
        F-Curves ({decoded.length})
      </div>
      {decoded.map((d) => {
        const isActive = d.fcurve.id === activeFCurveId;
        // Slice 5.I — read persisted `fcurve.hide` (was: local `hidden` Set).
        const isHidden = isFCurveHidden(d.fcurve);
        // Slice 5.F — `fcurve.selected` (Blender's FCURVE_SELECTED bit)
        // surfaces multi-channel selection in the sidebar independent
        // of the active concept. See
        // [src/anim/fcurveChannelSelect.js](../../../anim/fcurveChannelSelect.js).
        const isChannelSelected = isFCurveSelected(d.fcurve);
        // Slice 5.G — `fcurve.mute` (Blender's FCURVE_MUTED bit).
        // Greyed text + speaker-off button. See
        // [src/anim/fcurveMute.js](../../../anim/fcurveMute.js).
        const isMuted = isFCurveMuted(d.fcurve);
        const hasSelection = (selection.get(d.fcurve.id)?.size ?? 0) > 0;
        // Slice 5.D: "(D)" badge marks driver-locked rows so the user
        // spots them at a glance before clicking in.
        const driven = hasDriver(d.fcurve);
        // Row tint: active (strongest) > selected-non-active (medium) >
        // inactive (muted).
        //
        // Audit-fix MED-B2 (Slice 5.F dual-audit 2026-05-16): SS
        // extension, not a Blender port. Blender's
        // `acf_generic_channel_color` at
        // `reference/blender/source/blender/editors/animation/anim_channels_defines.cc:185-194`
        // is selection-agnostic — backdrop varies only by indent level
        // (`colorOffset = 10 - 10 * indent`). Selection state surfaces
        // ONLY through the per-row text color flip (TH_TEXT_HI vs
        // TH_TEXT). SS adds the 3-tier accent tint so multi-channel
        // selection is visible in the sidebar without forcing the user
        // to read text-color shades; keep this as a documented
        // divergence rather than a fake citation.
        const rowTint = isActive
          ? 'bg-accent/60 text-foreground'
          : isChannelSelected
            ? 'bg-accent/25 text-foreground/90'
            : 'text-muted-foreground';
        return (
          <div
            key={d.fcurve.id}
            className={
              'group flex items-center gap-1 px-2 py-1 text-xs cursor-pointer hover:bg-accent/40 '
              + rowTint
            }
            onClick={(e) => {
              const t = decodeFCurveTarget(d.fcurve);
              if (!t) return;
              // Slice 5.F — Shift-click toggles `fcurve.selected` only;
              // active stays unless newly-selected (mirroring Blender's
              // `anim_channels_edit.cc:4247` gate). Plain click clears
              // every other curve's `selected` (SELECT_REPLACE per
              // `anim_channels_edit.cc:4239-4243`).
              //
              // Plain-click also wipes keyform selection on other
              // channels. Audit-fix MED-B3 (2026-05-16, Slice 5.F dual-
              // audit): this is an SS UX extension, not a Blender port —
              // `graph_select.cc:1741`'s `deselect_graph_keys` lives in
              // `graphkeys_mselect_invoke` (the graph-AREA click path),
              // not the channel-list path. Blender's
              // `click_select_channel_fcurve` doesn't touch keyforms.
              // We keep the wipe because clicking a channel reads as
              // "switch context, drop the previous keyform picks";
              // Shift-click preserves the selection for cross-channel
              // composition.
              const decision = onApplyChannelClick(
                d.fcurve.id,
                e.shiftKey ? 'toggle' : 'replace',
              );
              // Audit-fix MED-A1 (Slice 5.F): gate clear on
              // `decision.selectedNow`. Without it, a click on a curve
              // whose action lookup races to null silently wipes the
              // user's keyform selection for no other effect.
              if (!e.shiftKey && decision.selectedNow) onClearKeyformSelection();
              if (decision.makeActive) onPickActiveByTarget(t);
            }}
            title={driven ? `${d.tooltip} (driver-locked)` : d.tooltip}
          >
            <button
              type="button"
              className="w-4 h-4 flex items-center justify-center text-[10px] hover:text-foreground"
              onClick={(e) => { e.stopPropagation(); onToggleHidden(d.fcurve.id); }}
              title={isHidden ? 'Show curve' : 'Hide curve'}
              aria-label={isHidden ? 'Show curve' : 'Hide curve'}
            >
              {isHidden ? '○' : '●'}
            </button>
            <button
              type="button"
              className={
                'w-4 h-4 flex items-center justify-center text-[11px] leading-none '
                + (isMuted ? 'text-muted-foreground/80' : 'text-muted-foreground/40 hover:text-foreground')
              }
              onClick={(e) => { e.stopPropagation(); onToggleMute(d.fcurve.id); }}
              title={isMuted ? 'Unmute curve (resume evaluation)' : 'Mute curve (skip evaluation)'}
              aria-label={isMuted ? 'Unmute curve' : 'Mute curve'}
            >
              {isMuted ? '\u{1F507}' : '\u{1F50A}'}
            </button>
            <span
              className="w-3 h-3 rounded-sm flex-shrink-0"
              style={{ backgroundColor: d.color, opacity: isHidden || isMuted ? 0.3 : 1 }}
              aria-hidden
            />
            <span className={
              'truncate flex-1 '
              + (isHidden ? 'opacity-50 line-through' : '')
              + (isMuted ? ' italic opacity-60' : '')
            }>
              {d.label}
            </span>
            {driven ? (
              <span
                className="text-[9px] font-mono px-1 rounded bg-primary/20 text-primary"
                title="Driver attached — keyforms are overridden"
              >
                D
              </span>
            ) : null}
            {hasSelection ? (
              <span className="text-[9px] font-mono text-amber-400" title="Has selection">
                ●
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ── DriverBanner (Slice 5.D) ─────────────────────────────────────────

/**
 * Compact banner shown above the canvas when the active FCurve has a
 * driver attached. Mirrors Blender's "Drivers Editor" panel header
 * (`graph_buttons.cc:931-941` -- the "Driver" enable toggle + the
 * `graph_draw_driver_settings_panel` summary at lines 972-1050) but
 * collapsed to a single horizontal strip so it doesn't eat much of the
 * curve drawing area.
 *
 * The "Clear Driver" button drops `fcurve.driver` via the parent's
 * `onClear` callback, which goes through `clearDriver` from
 * [src/anim/driverGate.js](../../../anim/driverGate.js) inside a
 * batched `updateProject` -- one undo entry per click.
 *
 * @param {{
 *   driver: { type:string, expression?:string, variables?:any[] },
 *   value: number|null,
 *   color: string|null,
 *   label: string,
 *   onClear: () => void,
 * }} props
 */
function DriverBanner({ driver, value, color, label, onClear }) {
  const type = driver?.type ?? 'scripted';
  const expr = typeof driver?.expression === 'string' ? driver.expression : '';
  const varCount = Array.isArray(driver?.variables) ? driver.variables.length : 0;
  // Truncate long expressions in the strip (full expression lives in
  // the NodeTreeEditor or graph_buttons-equivalent driver panel; this
  // banner is a quick-look summary, not an editor).
  const exprPreview = expr.length > 60 ? expr.slice(0, 57) + '...' : expr;
  const valueText =
    value === null ? '--'
    : !Number.isFinite(value) ? 'NaN (fallback to keyforms)'
    : value.toFixed(3);
  return (
    <div
      className="flex items-center gap-2 px-3 py-1 text-[11px] border-b border-border bg-popover/40 shadow-sm flex-shrink-0"
      title={`Driver active on ${label} -- keyforms are overridden by the driver expression`}
    >
      <span
        className="w-3 h-3 rounded-sm flex-shrink-0"
        style={{ backgroundColor: color ?? 'currentColor' }}
        aria-hidden
      />
      <span className="font-mono uppercase tracking-wider text-primary px-1.5 rounded bg-primary/15">
        Driver
      </span>
      <span className="text-muted-foreground">{type}</span>
      {type === 'scripted' ? (
        <span className="font-mono text-foreground/80 truncate flex-1 min-w-0" title={expr}>
          {exprPreview || <span className="italic text-muted-foreground">empty expression</span>}
        </span>
      ) : (
        <span className="text-muted-foreground flex-1 min-w-0 truncate">
          {varCount} variable{varCount === 1 ? '' : 's'}
        </span>
      )}
      <span className="font-mono text-foreground/90 px-1.5 border border-border rounded flex-shrink-0">
        = {valueText}
      </span>
      <button
        type="button"
        className="px-2 py-0.5 rounded border border-border bg-card hover:bg-accent text-foreground flex-shrink-0"
        onClick={onClear}
        title="Remove the driver to allow keyframe editing"
      >
        Clear Driver
      </button>
    </div>
  );
}

// ── canvas-2D drawing helpers ────────────────────────────────────────

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} keyforms
 * @param {Map<number, {center:boolean,left:boolean,right:boolean}>|undefined} sub
 * @param {{tx:(t:number)=>number, ty:(v:number)=>number}} view
 * @param {boolean} isActive
 * @param {boolean} [isMuted] - Slice 5.G: dims handle dots + tangent
 *   lines to match the muted SVG curve stroke. Handles stay clickable
 *   (mute is data-only; Blender allows editing muted curve keyframes).
 * @param {number} [activeKfIdx] - Slice 5.H audit-fix MED-B2: index
 *   of the active keyform whose left/right handle dots get a
 *   TH_VERTEX_ACTIVE-equivalent outline ring per
 *   `draw_fcurve_active_handle_vertices` (`graph_draw.cc:338-368`).
 *   Pass -1 to disable. Caller is responsible for the three-condition
 *   gate (same as `drawKeyframes`).
 */
function drawHandles(ctx, keyforms, sub, view, isActive, isMuted = false, activeKfIdx = -1) {
  if (!sub || sub.size === 0) return;
  // Context curve handles still draw, but dimmer.
  ctx.strokeStyle = isActive ? 'rgba(245, 158, 11, 0.55)' : 'rgba(245, 158, 11, 0.30)';
  ctx.lineWidth = 1;
  // Slice 5.G — multiplicative alpha for muted overlay; restored at
  // function exit so callers aren't surprised by leaked state.
  const priorAlpha = ctx.globalAlpha;
  if (isMuted) ctx.globalAlpha = priorAlpha * 0.4;
  for (const [i, parts] of sub) {
    const kf = keyforms[i];
    if (!kf) continue;
    const kx = view.tx(kf.time);
    const ky = view.ty(kf.value);
    if (kf.handleLeft) {
      const hx = view.tx(kf.handleLeft.time);
      const hy = view.ty(kf.handleLeft.value);
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, parts.left ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = parts.left ? '#fde68a' : 'rgba(245, 158, 11, 0.85)';
      ctx.fill();
    }
    if (kf.handleRight) {
      const hx = view.tx(kf.handleRight.time);
      const hy = view.ty(kf.handleRight.value);
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, parts.right ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = parts.right ? '#fde68a' : 'rgba(245, 158, 11, 0.85)';
      ctx.fill();
    }
  }

  // Audit-fix MED-B2 (Slice 5.H dual-audit 2026-05-16) — active-keyform
  // handle-dot outline per `draw_fcurve_active_handle_vertices`
  // (`graph_draw.cc:338-368`). Drawn AFTER the regular handle pass so
  // it sits on top. Blender's per-side conditions:
  //   - left handle: `left_bezt->ipo == BEZT_IPO_BEZ AND bezt->f1 & SELECT`
  //     where `left_bezt = bezt[idx-1] if idx > 0 else bezt` (interpolation
  //     for a kf's LEFT side comes from the PREVIOUS kf's `ipo` field).
  //   - right handle: `bezt->ipo == BEZT_IPO_BEZ AND bezt->f3 & SELECT`.
  // SS spells `kf.interpolation === 'bezier'`. The interpolation gates
  // exist because Blender only draws handle dots for bezier segments;
  // SS's drawHandles unconditionally draws if `kf.handleLeft/Right`
  // exists (which is more permissive), so we mirror Blender's gate
  // here to keep the active outline aligned with the dots themselves.
  if (activeKfIdx >= 0 && activeKfIdx < keyforms.length) {
    const kf = keyforms[activeKfIdx];
    const parts = sub.get(activeKfIdx);
    if (kf && parts) {
      ctx.globalAlpha = priorAlpha;
      ctx.strokeStyle = 'hsl(60 100% 75%)';
      ctx.lineWidth = 1.5;
      // Left handle outline.
      const leftBezt = activeKfIdx > 0 ? keyforms[activeKfIdx - 1] : kf;
      const leftIsBezier = (leftBezt?.interpolation ?? 'linear') === 'bezier';
      if (kf.handleLeft && leftIsBezier && parts.left) {
        const hx = view.tx(kf.handleLeft.time);
        const hy = view.ty(kf.handleLeft.value);
        ctx.beginPath();
        ctx.arc(hx, hy, (parts.left ? 4 : 3) + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Right handle outline.
      const rightIsBezier = (kf.interpolation ?? 'linear') === 'bezier';
      if (kf.handleRight && rightIsBezier && parts.right) {
        const hx = view.tx(kf.handleRight.time);
        const hy = view.ty(kf.handleRight.value);
        ctx.beginPath();
        ctx.arc(hx, hy, (parts.right ? 4 : 3) + 2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  ctx.globalAlpha = priorAlpha;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {any[]} keyforms
 * @param {Map<number, {center:boolean,left:boolean,right:boolean}>|undefined} sub
 * @param {{tx:(t:number)=>number, ty:(v:number)=>number}} view
 * @param {boolean} isActive
 * @param {boolean} [isMuted] - Slice 5.G: dims diamond fill+stroke
 *   alpha to match the muted SVG curve stroke. Diamonds stay clickable.
 * @param {number} [activeKfIdx] - Slice 5.H: index of the active
 *   keyform to highlight with `TH_VERTEX_ACTIVE`-equivalent halo.
 *   Pass `FCURVE_ACTIVE_KEYFORM_NONE` (-1) to disable. Caller is
 *   responsible for enforcing Blender's three-condition gate
 *   (`graph_draw.cc:243-262`); see canvas-render call site.
 */
function drawKeyframes(ctx, keyforms, sub, view, isActive, isMuted = false, activeKfIdx = -1) {
  for (let i = 0; i < keyforms.length; i++) {
    const kf = keyforms[i];
    if (typeof kf.value !== 'number') continue;
    const x = view.tx(kf.time);
    const y = view.ty(kf.value);
    const parts = sub?.get(i);
    const sel = !!parts?.center;
    // Context curve diamonds: smaller + dimmer to push them visually behind.
    const baseR = isActive ? 4 : 3;
    const r = sel ? baseR + 1 : baseR;
    const baseAlpha = isActive ? 1.0 : CTX_ALPHA;
    ctx.globalAlpha = isMuted ? baseAlpha * 0.4 : baseAlpha;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fillStyle = sel ? '#fbbf24' : '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = sel ? '#ffffff' : 'rgba(255,255,255,0.85)';
    ctx.lineWidth = sel ? 1.5 : 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1.0;

  // Slice 5.H — active-keyform halo drawn AFTER all diamonds so it
  // sits on top and isn't dimmed by the muted alpha pass above.
  // Mirrors `draw_fcurve_active_vertex` (`graph_draw.cc:241-262`),
  // which paints the active vertex AFTER the regular vertex pass
  // with `TH_VERTEX_ACTIVE` (default-theme bright white). SS uses a
  // pale-yellow outline ring to stay distinguishable from the white
  // stroke that already marks selected diamonds.
  if (activeKfIdx >= 0 && activeKfIdx < keyforms.length) {
    const kf = keyforms[activeKfIdx];
    if (typeof kf?.value === 'number') {
      const x = view.tx(kf.time);
      const y = view.ty(kf.value);
      const baseR = isActive ? 4 : 3;
      const parts = sub?.get(activeKfIdx);
      const sel = !!parts?.center;
      const r = sel ? baseR + 1 : baseR;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = 'hsl(60 100% 75%)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

// ── HUD + Menu subcomponents ─────────────────────────────────────────

function ModalHUD({ kind, axis, typedBuffer, numericMode }) {
  // Slice 5.E — surfaces axis-lock + typed-numeric + numericMode in the
  // same visual idiom as the viewport's `ModalTransformOverlay` HUD
  // (`src/v3/shell/ModalTransformOverlay.jsx:655-678`). Both modals
  // share the same input reducer so the displayed state is the same.
  //
  // Axis label wording matches Blender's 2D-editor convention at
  // `reference/blender/source/blender/editors/transform/transform.cc:953,958`:
  // `msg_2d = IFACE_("along X")` / `IFACE_("along Y")` (separate from the
  // 3D-editor `msg_3d` strings that say e.g. "global X"). Audit-fix
  // HIGH-B1 (2026-05-16) corrected the prior `"axis: X"` SS invention
  // to match Blender exactly.
  const label = kind === 'g' ? 'GRAB' : 'SCALE';
  // Unit suffix matches the displayed axis labels: X = time (frames),
  // Y = raw value (no unit). Scale is unitless multiplier.
  //
  // SS-deferred (audit MED-B2, 2026-05-16): Blender's Graph Editor
  // toggles between frame-units and seconds-units via the `SIPO_DRAWTIME`
  // flag in space settings; `reference/blender/source/blender/editors/
  // transform/transform_mode_translate.cc:606-608` reads
  // `display_seconds = (sipo->mode == SIPO_MODE_ANIMATION) && (sipo->flag
  // & SIPO_DRAWTIME)` and bases the typed-input unit on it. SS hardcodes
  // frames because we haven't shipped a seconds/frames display-mode
  // toggle yet (the Animation Editor surfaces only frame numbers); when
  // the toggle ships, `unit` here should read the same flag.
  const unit = kind === 's' ? '×' : (axis === 'y' ? '' : 'f');
  const hasTyped = (typedBuffer ?? '').length > 0;
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none flex items-center gap-2 px-3 py-1 bg-popover/95 border border-border rounded text-[11px] font-mono shadow">
      <span className="text-primary uppercase tracking-wider">{label}</span>
      {axis ? (
        <span className="text-amber-500" title={`Constrained to ${axis === 'x' ? 'time' : 'value'} axis`}>
          along {axis.toUpperCase()}
        </span>
      ) : null}
      {numericMode ? (
        <span className="text-blue-400" title="Numeric input mode (=)">= </span>
      ) : null}
      {hasTyped ? (
        <span className="text-foreground">
          {typedBuffer}<span className="text-muted-foreground/70">{unit}</span>
        </span>
      ) : null}
      <span className="text-muted-foreground">
        Type · Enter/Click confirm · Esc cancel · X/Y axis · = numeric · Shift fine · Ctrl snap
      </span>
    </div>
  );
}

function OperatorMenu({ menu, selection, action, activeFCurve, onClose, onPickHandleType, onPickInterpolation, onPickExtrapolation }) {
  const items = menu.kind === 'handleType' ? HANDLE_TYPES
              : menu.kind === 'interpolation' ? INTERPOLATION_TYPES
              : EXTRAPOLATION_TYPES;
  const onPick = menu.kind === 'handleType' ? onPickHandleType
               : menu.kind === 'interpolation' ? onPickInterpolation
               : onPickExtrapolation;

  // "Current" highlighting now spans the multi-curve selection.
  const current = useMemo(() => {
    if (menu.kind === 'extrapolation') {
      // Per-FCurve property. Show the active curve's value (or null if
      // every selected fcurve agrees / disagrees).
      if (selection.size === 0) {
        return activeFCurve?.extrapolation ?? 'constant';
      }
      const seen = new Set();
      for (const [fcurveId] of selection) {
        const fc = action.fcurves.find((f) => f.id === fcurveId);
        if (!fc) continue;
        seen.add(fc.extrapolation ?? 'constant');
        if (seen.size > 1) return null;
      }
      return [...seen][0] ?? null;
    }
    if (menu.kind === 'handleType') {
      const counts = new Map();
      for (const [fcurveId, sub] of selection) {
        const fc = action.fcurves.find((f) => f.id === fcurveId);
        if (!fc) continue;
        for (const [idx] of sub) {
          const kf = fc.keyforms[idx];
          if (!kf?.handleType) continue;
          counts.set(kf.handleType.left, (counts.get(kf.handleType.left) ?? 0) + 1);
        }
      }
      return mostCommon(counts) ?? null;
    }
    // interpolation
    const counts = new Map();
    for (const [fcurveId, sub] of selection) {
      const fc = action.fcurves.find((f) => f.id === fcurveId);
      if (!fc) continue;
      for (const [idx] of sub) {
        const kf = fc.keyforms[idx];
        if (!kf?.interpolation) continue;
        counts.set(kf.interpolation, (counts.get(kf.interpolation) ?? 0) + 1);
      }
    }
    return mostCommon(counts) ?? null;
  }, [menu.kind, selection, action, activeFCurve]);

  useEffect(() => {
    function onDocKey(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose();
        return;
      }
      const n = ev.key.charCodeAt(0) - '1'.charCodeAt(0);
      if (n >= 0 && n < items.length) {
        ev.preventDefault();
        onPick(items[n].key);
        onClose();
      }
    }
    function onDocClick() { onClose(); }
    window.addEventListener('keydown', onDocKey, { capture: true });
    window.addEventListener('mousedown', onDocClick, { capture: true });
    return () => {
      window.removeEventListener('keydown', onDocKey, { capture: true });
      window.removeEventListener('mousedown', onDocClick, { capture: true });
    };
  }, [items, onPick, onClose]);

  const title = menu.kind === 'handleType' ? 'Handle Type'
              : menu.kind === 'interpolation' ? 'Interpolation'
              : 'Extrapolation';

  return (
    <div
      className="fixed z-50 bg-popover border border-border rounded shadow-lg py-1 text-xs"
      style={{ left: menu.x + 4, top: menu.y + 4, minWidth: 160 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
        {title}
      </div>
      {items.map((it, i) => (
        <button
          key={it.key}
          type="button"
          className={`block w-full text-left px-3 py-1 hover:bg-accent ${current === it.key ? 'text-primary font-semibold' : ''}`}
          onMouseDown={(e) => { e.stopPropagation(); onPick(it.key); onClose(); }}
        >
          <span className="text-muted-foreground/70 mr-2">{i + 1}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────

function pickFCurve(action, selection) {
  if (!action?.fcurves) return null;
  for (let i = selection.length - 1; i >= 0; i--) {
    const sel = selection[i];
    if (sel.type === 'parameter') {
      const fc = action.fcurves.find((f) => fcurveTargetsParam(f, sel.id));
      if (fc) return fc;
    }
    if (sel.type === 'part' || sel.type === 'group') {
      const fc = action.fcurves.find((f) => {
        const t = decodeFCurveTarget(f);
        return t?.kind === 'node' && t.nodeId === sel.id;
      });
      if (fc) return fc;
    }
  }
  return null;
}

/**
 * Build label maps once per project change. Used for sidebar rows.
 */
function buildLabelMaps(project) {
  const nodeNameById = new Map((project.nodes ?? []).map((n) => [n.id, n.name ?? n.id]));
  const paramNameById = new Map((project.parameters ?? []).map((p) => [p.id, p.name ?? p.id]));
  return { nodeNameById, paramNameById };
}

/**
 * Decode every FCurve in the action into a render row with stable
 * color (Blender's `FCURVE_COLOR_AUTO_RAINBOW` via `getcolor_fcurve_rainbow`).
 * Curves whose target doesn't resolve are skipped.
 */
function decodeAllFCurves(action, labels) {
  const fcurves = action.fcurves ?? [];
  // Filter to resolvable targets BEFORE assigning rainbow indices so
  // the color count matches what actually renders (Blender does the
  // same — `ANIMFILTER_FCURVESONLY` filter at `space_graph.cc:711`).
  const resolved = [];
  for (const fc of fcurves) {
    const target = decodeFCurveTarget(fc);
    if (!target) continue;
    let label, tooltip;
    if (target.kind === 'param') {
      label = labels.paramNameById.get(target.paramId) ?? target.paramId;
      tooltip = `Parameter ${target.paramId}`;
    } else {
      label = `${labels.nodeNameById.get(target.nodeId) ?? target.nodeId} · ${target.property}`;
      tooltip = `Node ${target.nodeId} · ${target.property}`;
    }
    resolved.push({ fcurve: fc, target, label, tooltip });
  }
  const tot = resolved.length;
  return resolved.map((r, i) => ({
    ...r,
    color: fcurveColorCss(i, tot, 1),
  }));
}

function sampleCurve(fcurve, duration) {
  const values = [];
  let minV = Infinity;
  let maxV = -Infinity;
  for (let i = 0; i <= CURVE_SAMPLES; i++) {
    const t = (i / CURVE_SAMPLES) * duration;
    const v = interpolateTrack(fcurve.keyforms, t);
    if (typeof v !== 'number') continue;
    values.push({ t, v });
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  for (const kf of fcurve.keyforms) {
    if (typeof kf?.value !== 'number') continue;
    if (kf.value < minV) minV = kf.value;
    if (kf.value > maxV) maxV = kf.value;
    if (kf.handleLeft && typeof kf.handleLeft.value === 'number') {
      if (kf.handleLeft.value < minV) minV = kf.handleLeft.value;
      if (kf.handleLeft.value > maxV) maxV = kf.handleLeft.value;
    }
    if (kf.handleRight && typeof kf.handleRight.value === 'number') {
      if (kf.handleRight.value < minV) minV = kf.handleRight.value;
      if (kf.handleRight.value > maxV) maxV = kf.handleRight.value;
    }
  }
  if (!Number.isFinite(minV)) { minV = 0; maxV = 1; }
  if (minV === maxV) { minV -= 0.5; maxV += 0.5; }
  const span = maxV - minV;
  minV -= span * 0.05;
  maxV += span * 0.05;
  return { values, minV, maxV };
}

function hitTest(x, y, cx, cy, r) {
  return Math.abs(x - cx) <= r && Math.abs(y - cy) <= r;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function cloneSubSelection(sub) {
  /** @type {Map<number, {center:boolean,left:boolean,right:boolean}>} */
  const next = new Map();
  if (!sub) return next;
  for (const [idx, parts] of sub) {
    next.set(idx, { center: parts.center, left: parts.left, right: parts.right });
  }
  return next;
}

function cloneFullSelection(sel) {
  /** @type {Map<string, Map<number, {center:boolean,left:boolean,right:boolean}>>} */
  const next = new Map();
  for (const [fid, sub] of sel) {
    next.set(fid, cloneSubSelection(sub));
  }
  return next;
}

function toggleKeyformInSub(sub, idx) {
  const next = cloneSubSelection(sub);
  if (next.has(idx)) next.delete(idx);
  else next.set(idx, { center: true, left: true, right: true });
  return next;
}

function countDeletableInSub(sub) {
  let n = 0;
  for (const [, parts] of sub) if (parts.center) n++;
  return n;
}

function mostCommon(counts) {
  let bestKey = null;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) { bestCount = c; bestKey = k; }
  }
  return bestKey;
}
