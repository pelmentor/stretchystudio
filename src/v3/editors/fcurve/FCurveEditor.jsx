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
import { useEditorStore } from '../../../store/editorStore.js';
import { usePreferencesStore } from '../../../store/preferencesStore.js';
import {
  useKeyformSelectionStore,
  useKeyformSelectionState,
} from '../../../store/keyformSelectionStore.js';
import {
  resolveSelectAllAction,
  resolveChannelDeleteAction,
  resolveHideRevealAction,
} from '../../../anim/keymapPresets.js';
import { useProjectStore } from '../../../store/projectStore.js';
import { useSelectionStore } from '../../../store/selectionStore.js';
import { interpolateTrack } from '../../../renderer/animationEngine.js';
import {
  decodeFCurveTarget,
  fcurveTargetsParam,
} from '../../../anim/animationFCurve.js';
import { getActiveSceneAction } from '../../../anim/sceneAction.js';
import { pickActiveFCurve } from '../../../anim/fcurvePicker.js';
import { getActiveFCurve, setActiveFCurve, clearActiveFCurves } from '../../../anim/fcurveActive.js';
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
  applyChannelSelectAll,
  applyChannelDeleteSelected,
  wouldChannelDeleteSelectedChange,
  isFCurveSelected,
  applyGroupChildrenSelect,
  wouldGroupChildrenSelectChange,
  applyGroupHeaderSelect,
  wouldGroupHeaderSelectChange,
} from '../../../anim/fcurveChannelSelect.js';
import {
  applyChannelBoxSelect,
  wouldChannelBoxSelectChange,
} from '../../../anim/fcurveBoxSelect.js';
import {
  applyGraphSelectAllChannelCascade,
  wouldGraphSelectAllChannelCascadeChange,
} from '../../../anim/graphSelectAllCascade.js';
import { applyKeyformInvertSelection } from '../../../anim/fcurveKeyformSelect.js';
import {
  countFCurveChannelStates,
  formatFCurveChannelCounts,
  formatActiveFCurveLabel,
} from './fcurveFooterData.js';
import { ActiveKeyformPanel } from './ActiveKeyformPanel.jsx';
import { FCurveModifiersPanel } from './FCurveModifiersPanel.jsx';
import { DriverBanner } from './DriverBanner.jsx';
import {
  getEffectiveFps,
  formatXTickLabel,
} from './fcurveTimeFormat.js';
import {
  isFCurveMuted,
  toggleFCurveMute,
  applyChannelMuteSelected,
  wouldChannelMuteSelectedChange,
} from '../../../anim/fcurveMute.js';
import {
  isFCurveHidden,
  toggleFCurveHidden,
  applyHideFCurves,
  applyRevealFCurves,
  wouldHideChangeFCurves,
  wouldRevealChangeFCurves,
} from '../../../anim/fcurveVisible.js';
import {
  getFCurveGroupById,
  isFCurveGroupMuted,
  isFCurveGroupHidden,
  isFCurveGroupExpanded,
  isFCurveGroupSelected,
  isFCurveEffectivelyHidden,
  applyToggleFCurveGroupMute,
  applyToggleFCurveGroupHidden,
  applyToggleFCurveGroupExpanded,
  wouldToggleFCurveGroupMuteChange,
  wouldToggleFCurveGroupHiddenChange,
  wouldToggleFCurveGroupExpandedChange,
} from '../../../anim/fcurveGroups.js';
import { isFCurveGroupActive } from '../../../anim/fcurveGroupActive.js';
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

  // Slice 5.X: active fcurve precedence is now persisted-flag-first,
  // selection-derived second. `getActiveFCurve` reads the per-fcurve
  // `active` bit (Blender's FCURVE_ACTIVE port at
  // [src/anim/fcurveActive.js](../../../anim/fcurveActive.js)); the
  // `pickFCurve` fallback is the bootstrap heuristic for legacy saves
  // that don't carry the bit yet. After the user's first click,
  // `setActiveFCurve` (wired into `applyChannelClick` + the keyform-
  // click branches) writes the explicit flag and the fallback retires
  // for that action. See module header for full provenance.
  //
  // Audit-fix HIGH-1 (Slice 5.X arch audit 2026-05-17): deps narrowed
  // to `[action?.fcurves, selection]` — the memo only walks fcurves
  // (getActiveFCurve) + selection (pickFCurve fallback). Depending on
  // the full `action` ref would re-run on every unrelated mutation
  // (action.duration tweak, action.groups edit, etc.), regressing the
  // sister narrowing pattern established by Slice 5.W's H1 fix on
  // DopesheetEditor + the `decoded` memo below at line ~478.
  const activeFCurve = useMemo(
    () => getActiveFCurve(action) ?? pickFCurve(action, selection),
    [action?.fcurves, selection],
  );

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
    <Wrapper footer={<FCurveFooter decoded={decoded} activeFCurveId={activeFCurve?.id ?? null} />}>
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

function Wrapper({ children, footer = null }) {
  return (
    <div className="flex flex-col h-full bg-card overflow-hidden" data-editor-type="fcurve">
      <div className="flex-1 overflow-hidden">{children}</div>
      {footer}
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

/**
 * FCurve Editor per-editor footer — Slice 5.P.
 *
 * Mounts at the bottom of the editor wrapper (sister vertical position
 * to Blender's `RGN_TYPE_FOOTER` in `space_graph.cc:996-1005`). Shows
 * channel-state summary + active-FCurve label. Data derivation lives
 * in [`fcurveFooterData.js`](./fcurveFooterData.js); this component
 * is presentation-only.
 *
 * Hidden by construction when `decoded.length === 0` — the parent
 * branches to `<Empty msg=... />` without mounting the Wrapper's
 * footer slot, so the empty-state has no footer at all.
 *
 * Styling matches the global Footer's terse-info row (`h-7` vs the
 * global `h-9` — per-editor footer is thinner since it omits the
 * tall transport-bar slot the global Footer carries).
 *
 * @param {{ decoded: ReadonlyArray<{fcurve:{id:string,selected?:boolean,hide?:boolean,mute?:boolean},label:string}>, activeFCurveId: string|null }} props
 */
function FCurveFooter({ decoded, activeFCurveId }) {
  // Derive counts + active label per render. Both are O(N) walks over
  // `decoded` which is already memoized at the outer component level,
  // so this is cheap; no further memoization needed for typical
  // channel counts (~10s of curves per action).
  const counts = countFCurveChannelStates(decoded);
  const countsText = formatFCurveChannelCounts(counts);
  const activeLabel = formatActiveFCurveLabel(decoded, activeFCurveId);

  return (
    <div className="h-7 border-t shrink-0 bg-card flex items-center px-3 gap-3 text-[11px] text-muted-foreground select-none">
      <div className="shrink-0 tabular-nums">
        {countsText}
      </div>
      <div className="flex-1 min-w-0" />
      {activeLabel ? (
        <div
          className="shrink min-w-0 truncate"
          title={activeLabel}
        >
          <span className="text-muted-foreground/70">Active: </span>
          <span className="text-foreground">{activeLabel}</span>
        </div>
      ) : null}
    </div>
  );
}

function Plot({ action, activeActionId, decoded, activeFCurveId, currentTime, fps, onSeek, onPickActiveByTarget }) {
  // Slice 5.T — Plot is the surface that paints the X-axis ticks AND
  // hosts ActiveKeyformPanel. Both need `showSeconds`; subscribing here
  // (rather than passing through from FCurveEditor) keeps Plot's prop
  // contract narrow and matches how the existing edit-mode + tool-panel
  // hooks subscribe directly from Plot's body.
  const fcurveShowSeconds = useEditorStore((s) => s.fcurveShowSeconds);
  const wrapRef = useRef(null);
  // Slice 5.D: separate ref for the plot-rect (sibling of DriverBanner
  // inside the right-side flex column). ResizeObserver watches THIS ref
  // so canvas dims track the actual drawing area, not the outer wrap
  // (which includes Sidebar + Banner -- see file-header "Plot-area
  // ResizeObserver" note for the bug this also fixes incidentally).
  const plotAreaRef = useRef(null);
  const canvasRef = useRef(null);
  // Slice 5.K (2026-05-17) — region-routed KeyA. Tracks which sub-area
  // the cursor is over so KeyA dispatches to the right scope:
  //   - 'sidebar' → channel select-all (applyChannelSelectAll)
  //   - 'timeline' (default) → keyform select-all (operatorSelectAll)
  // Mirrors Blender's per-area keymap registration: the channels region
  // (`SPACE_GRAPH`/`RGN_TYPE_CHANNELS`) and the graph region register
  // independent KeyA bindings, with mouse position routing the event.
  // Implemented as a ref (not state) so updates don't trigger re-renders;
  // only `onKeyDown` reads it, on the same render cycle as the keypress.
  const regionHoverRef = useRef('timeline');
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  // Slice 6.A — selectedHandles is now LIFTED into the shared
  // `keyformSelectionStore`. The hook returns a `[handles, setHandles]`
  // tuple shaped identically to React's `useState`, so the 22 in-file
  // `setSelectedHandles(...)` call sites are unchanged. The store is
  // now the canonical owner; DopesheetEditor (Phase 6 writer) shares
  // it. The pre-Phase-6 publish-effect-on-unmount has been removed —
  // the store survives editor unmount in line with React-state
  // semantics: a fresh FCurveEditor mount will see whatever selection
  // the surviving editors (Dopesheet) have written.
  /** @type {[Map<string, Map<number, {center:boolean,left:boolean,right:boolean}>>, Function]} */
  const [selectedHandles, setSelectedHandles] = useKeyformSelectionState();
  // Slice 5.FF — B-key arms the channel-list box-select modal. Mirrors
  // Blender's `WM_gesture_box_invoke` with `wait_for_input=true` at
  // `reference/blender/source/blender/windowmanager/intern/wm_gesture_ops.cc:171-179`:
  // when invoked by keyboard (B key, not mouse drag), the modal enters
  // WM_GESTURE_CROSS_RECT state — crosshair cursor, waits for the
  // next LMB-click-drag to define the rect. SS port: when `armed`,
  // the next sidebar pointerdown starts a drag-rect immediately
  // (bypassing the button-child early-return + the 4px movement
  // threshold from Slice 5.Y). Ref mirrors the state for the
  // pointer-event handlers; setter triggers UI re-render for the
  // crosshair cursor + hint banner. Closes Slice 5.Y-1 deviation.
  const [bGestureArmed, setBGestureArmed] = useState(false);
  const bGestureArmedRef = useRef(false);
  useEffect(() => { bGestureArmedRef.current = bGestureArmed; }, [bGestureArmed]);
  // Slice 6.A — the prior Slice 5.EE publish-effect has been removed
  // along with the local useState in favor of the lifted shared store
  // (see selectedHandles declaration above). Every setSelectedHandles
  // call now writes directly to the store; no separate publish hop is
  // needed. The unmount-clears-mirror behavior that Slice 5.EE
  // HIGH-1 added is intentionally NOT preserved — the store now
  // survives editor unmount the way React state would survive any
  // single editor unmounting in a split view. A surviving Dopesheet
  // keeps its selection; a fresh FCurveEditor mount inherits it.
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

  // Slice 5.Q — N-panel visibility (right-side panel hosting the
  // Active Keyframe editor). Mirrors Blender's
  // `space_data.show_region_ui` toggle bound to N at
  // `blender_default.py:1958-1962` (`_template_space_region_type_toggle`
  // with `sidebar_key={"type": 'N', "value": 'PRESS'}` in
  // `km_graph_editor_generic`). Default false — Blender's N-panel
  // also defaults to hidden on a fresh editor instance.
  // Audit note (Slice 5.Q dual-audit): local React state means
  // visibility resets on editor unmount. Acceptable per the Blender
  // analog being `ARegion->flag` view state (not persisted in saves).
  const [npanelOpen, setNpanelOpen] = useState(false);

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
    // Slice 5.V — cascade group-hide via `isFCurveEffectivelyHidden`
    // so a fcurve inside a hidden group disappears from the plot even
    // when its own `hide` bit is false. Sidebar still renders the row
    // (so the user can un-hide the group), but the plot does not.
    () => decoded.filter((d) => !isFCurveEffectivelyHidden(d.fcurve, action)),
    [decoded, action],
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
            // Slice 5.X: handle click promotes the parent fcurve to
            // active. Mirrors Blender's `mouse_graph_keys` two-site
            // pattern — the keyform-active index is set at
            // `reference/blender/source/blender/editors/space_graph/graph_select.cc:1790-1797`
            // (`BKE_fcurve_active_keyframe_set` gated by `BEZT_ISSEL_ANY`
            // + `may_activate`), and the parent FCURVE_ACTIVE is set
            // SEPARATELY at `:1846-1856` (`ANIM_set_active_channel`
            // gated by `!run_modal && (nvi->fcu->flag & FCURVE_SELECTED)
            // && something_was_selected`). SS conflates the two writes
            // into the same `update(...)` recipe because the SS modal
            // path doesn't have Blender's `!run_modal` early gate.
            // Audit-fix HIGH-1 (Slice 5.X fidelity audit 2026-05-17):
            // the original substrate comment claimed both writes
            // happen at `:1790-1797`, which is false — that line range
            // is keyform-active only.
            setActiveFCurve(a, fcurveId);
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
            // Slice 5.X: keyform click promotes the parent fcurve to
            // active. Mirrors Blender's `mouse_graph_keys` two-site
            // pattern (`graph_select.cc:1790-1797` keyform-active +
            // `:1846-1856` parent FCURVE_ACTIVE); see the handle-click
            // branch above for the full provenance trace.
            setActiveFCurve(a, hit.fcurveId);
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

      // Typed override for G. Translates to ms (canonical):
      //   - axis 'x' or null: typed unit follows the View menu's
      //     "Use Timecode" toggle (Slice 5.T). When `fcurveShowSeconds`
      //     is true, typed is decimal seconds and converts via *1000;
      //     when false, typed is frames at the effective fps and
      //     converts via *msPerFrame. Default-to-X matches Blender's
      //     "G → type → axis defaults to X" at
      //     `transform_input.cc:131-148`. Empty-buffer numericMode
      //     leaves `typed` at 0 -- modal holds at zero.
      //   - axis 'y': typed = raw value units on the value axis.
      // The display unit suffix in `ModalHUD` reads the same flag so
      // the HUD text matches what the user is typing.
      if (useTyped && kind === 'g') {
        const v = typedFinite ? typed : 0;
        if (axis === 'y') {
          dTime = 0;
          dValue = v;
        } else {
          if (fcurveShowSeconds) {
            dTime = v * 1000;
          } else {
            dTime = msPerFrame > 0 ? v * msPerFrame : v;
          }
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
      // Slice 5.U — pass the user's `USER_FLAG_NUMINPUT_ADVANCED`
      // preference (`reference/blender/source/blender/makesdna/DNA_userdef_types.h:34`)
      // so a digit/sign/dot keystroke auto-enters numericMode when the
      // pref is ON. Reads through `getState()` to pick up live changes
      // without requiring a modal restart (the pref is rarely toggled
      // mid-modal but read-through is free and avoids stale closures).
      const numericInputAdvanced = usePreferencesStore.getState().useNumericInputAdvanced;
      const action = keyEventToAction(ev, { numericInputAdvanced });
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

  function operatorInvertSelection() {
    // Slice 5.L — Blender-faithful INVERT across all visible keyforms.
    // Mirrors `graph.select_all` action='INVERT'
    // (`graph_select.cc:451-453` → `deselect_graph_keys(.., SELECT_INVERT, ..)`).
    // Pure mutation logic lives in `applyKeyformInvertSelection`; see
    // that module's header for the `select_bezier_invert` rule (center
    // flips per keyform, handles mirror new center).
    //
    // Visible curves are pulled from the `visible` memo (hidden curves
    // are filtered out by `isFCurveHidden` — Slice 5.I) so this matches
    // Blender's ANIMFILTER_CURVE_VISIBLE walk.
    //
    // Audit-fix MED-A1 (Slice 5.L dual-audit 2026-05-17): unlike sibling
    // `operatorSelectAll` above (which writes `setSelectedHandles(next)`
    // computed from `visible` alone), this op uses the FUNCTIONAL form
    // `setSelectedHandles((curr) => ...)` because INVERT needs the
    // previous selection state to flip per-keyform. `visible` itself is
    // safely current via the `onKeyDown` closure (it's in onKeyDown's
    // deps array on line ~2040, so when `visible` changes onKeyDown
    // rebuilds and re-captures this fresh function). The functional
    // form is required ONLY for the `curr` argument; do not collapse
    // it back to the eager form, and do not extract `visible` outside
    // the callback — both invariants matter.
    setSelectedHandles((curr) => applyKeyformInvertSelection(
      visible.map((d) => d.fcurve),
      curr,
    ));
  }

  // ── Hotkey dispatch ─────────────────────────────────────────────────

  // Slice 5.K — bulk channel select-all dispatcher (A / Alt+A / Ctrl+I).
  //
  // Mirrors Blender's `ANIM_OT_channels_select_all`
  // (`anim_channels_edit.cc:3521-3554`). The keymap binds the three
  // canonical actions via `_template_items_select_actions`
  // (`blender_default.py:420-439` registered at `blender_default.py:3864`).
  //
  // Like Slice 5.F's `applyChannelClick`, this skips undo: channel-list
  // selection is UI state, not document state, so a bulk select-all
  // shouldn't burn the 50-entry undo budget.
  //
  // `ctx` is built fresh per call so the helper sees the live `decoded`
  // / `activeFCurveId` — same pattern as Slice 5.J's range-select; do
  // not hoist `decoded.map(...)` into this callback's closure.
  //
  // Active-clearing note (Slice 5.K SS deviation): the helper returns
  // `clearActive: boolean` matching Blender's `if (!selected && change_active)`
  // rule at `anim_channels_edit.cc:728-732`. SS does NOT forward
  // `clearActive` to `selectStore` today — clearing the global
  // param/node selection from a sidebar Alt+A would have side-effects
  // on the param editor + keyform editor's active-row. Documented +
  // deferred to the day SS grows a per-fcurve ACTIVE slot (see the
  // `project_ss_is_embryo` memory). The helper's decision is the truth;
  // the caller's deferral is the deviation.
  //
  // Declaration order: this callback ships ABOVE `onKeyDown` (rather
  // than alongside the related `applyChannelClick` further down) because
  // `onKeyDown` references it; `const` is TDZ-blocked at the
  // useCallback evaluation point, so co-locating with the other channel
  // helpers below the keymap would crash with "used before declaration".
  // Slice 5.Z — forward `applyChannelSelectAll`'s `clearActive` decision
  // into Slice 5.X's `clearActiveFCurves(action)` so the FCURVE_ACTIVE
  // bit drops when bulk select-all clears the active channel's
  // selection. Closes Slice 5.K's MED-A1 deviation ("`clearActive` is
  // computed but NOT forwarded today" — that gap was tied to the
  // pre-5.X derived-active-from-param-selection design; Slice 5.X
  // shipped the per-fcurve persisted ACTIVE bit, unblocking this
  // wire-through). The helper returns `clearActive=true` per Blender's
  // per-channel rule at `anim_channels_edit.cc:728-732` ("Only erase
  // the ACTIVE flag when deselecting") when the active channel ends up
  // deselected in scope; we now mirror that by calling
  // `clearActiveFCurves(a)` inside the same `update()` closure so the
  // sidebar's `bg-accent/60` highlight drops in lockstep.
  const applyChannelSelectAllOp = useCallback((mode) => {
    let decision = { changed: false, clearActive: false, resultMode: null, selectedAfter: 0 };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      // Slice 5.NN (Path #59) — `orderedGroupIds` extends the
      // operator's scope to include groups, closing Slice 5.LL Dev 3.
      // SS uses `action.groups.map(g => g.id)` (no visibility filter)
      // because the sidebar bucketization shows every group header
      // regardless of expansion state. Sister to Slice 5.MM's walker
      // scope deviation: if a future slice adds group-level
      // hide-from-sidebar, this list will need narrowing.
      const groupIds = Array.isArray(a.groups)
        ? a.groups.map((g) => (g && typeof g.id === 'string' ? g.id : null)).filter(Boolean)
        : [];
      decision = applyChannelSelectAll(a, mode, {
        orderedIds: decoded.map((d) => d.fcurve.id),
        orderedGroupIds: groupIds,
        activeFCurveId,
      });
      if (decision.clearActive) {
        clearActiveFCurves(a);
      }
    }, { skipHistory: true });
    return decision;
  }, [activeActionId, update, decoded, activeFCurveId]);

  // Slice 5.Y — channel-list box (drag-rect) selection dispatcher.
  //
  // Mirrors Blender's `ANIM_OT_channels_select_box`
  // (`reference/blender/source/blender/editors/animation/anim_channels_edit.cc:3740-3760`).
  // The Sidebar owns the DOM drag-rect + per-row hit-test; this dispatcher
  // wires the resulting `(idsInRect, modifier)` to the pure helper in
  // [src/anim/fcurveBoxSelect.js](../../../anim/fcurveBoxSelect.js).
  //
  // `skipHistory:true` — same view-state-not-document rationale as
  // Slice 5.F's `applyChannelClick` (HIGH-A1) and Slice 5.K's
  // `applyChannelSelectAllOp`. Blender's box-select carries
  // `OPTYPE_UNDO` (`:3756`) but that's a per-operator default we
  // explicitly opt out of for channel selection in SS — channel
  // selection lives outside the undo stack so users don't burn the
  // 50-entry budget on UI navigation noise.
  //
  // Preflight via `wouldChannelBoxSelectChange` mirrors Slice 5.M's
  // preflight pattern: an empty rect over an empty visible scope, or
  // a rect that hits only already-correctly-selected rows, would
  // otherwise still trigger an `update()` recipe and a React re-render
  // for no semantic change. Reading via `useProjectStore.getState()`
  // avoids subscribing the dispatcher to project state (matches
  // `applyHideOp` / `applyRevealOp` lines 2102+).
  const applyChannelBoxSelectOp = useCallback((idsInRect, modifier) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    // Audit-fix MED-1 (Slice 5.Y arch audit 2026-05-17): filter `decoded`
    // by `isFCurveEffectivelyHidden` BEFORE building `orderedIds`. The
    // helper's Deviation 3 contract specifies `orderedIds` as the
    // visible-scope = "decoded filtered through isFCurveEffectivelyHidden"
    // (mirroring Blender's in-rect-loop filter `ANIMFILTER_LIST_VISIBLE`
    // at `anim_channels_edit.cc:3594`). The earlier dispatcher passed
    // raw `decoded` which still includes hidden-but-rendered rows
    // (sidebar shows them with line-through opacity:0.5 for the un-hide
    // affordance) — so a `replace` drag-rect would clear `selected` on
    // hidden rows in the SS rendering, deviating from the documented
    // narrower in-rect-loop scope.
    const orderedIds = liveAction
      ? decoded
          .filter((d) => !isFCurveEffectivelyHidden(d.fcurve, liveAction))
          .map((d) => d.fcurve.id)
      : [];
    const ctx = { orderedIds, activeFCurveId };
    if (!wouldChannelBoxSelectChange(liveAction, idsInRect, modifier, ctx)) {
      return { changed: false, clearedActive: false, resultMode: modifier, selectedAfter: 0, touchedCount: 0 };
    }
    let decision = { changed: false, clearedActive: false, resultMode: modifier, selectedAfter: 0, touchedCount: 0 };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      decision = applyChannelBoxSelect(a, idsInRect, modifier, ctx);
    }, { skipHistory: true });
    return decision;
  }, [activeActionId, update, decoded, activeFCurveId]);

  // Slice 5.BB — Shift+Ctrl+click → group-children-select dispatcher.
  // Mirrors Blender's `selectmode = -1` branch in `mouse_anim_channels`
  // (`reference/blender/source/blender/editors/animation/anim_channels_edit.cc:4163-4180`),
  // dispatched from `animchannels_mouseclick_invoke` at `:4642-4646`.
  // Keymap: `blender_default.py:3853-3854`.
  //
  // SS extends Blender's "only group headers respond" rule: the Sidebar
  // wires Shift+Ctrl+click on EITHER a group header OR an fcurve row
  // (in which case the fcurve's `groupId` resolves the target group).
  // Ungrouped fcurves no-op (matches Blender's `:4511-4515` early
  // return for non-group channels). See `applyGroupChildrenSelect`
  // module-header Deviation 1.
  //
  // `skipHistory: true` — channel selection is view state per the
  // Slice 5.F/5.K convention. Preflight gates the no-op case so a
  // re-Shift+Ctrl-click on the same group doesn't push a phantom
  // undo snapshot.
  const applyGroupChildrenSelectOp = useCallback((groupId) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    const orderedIds = liveAction
      ? decoded
          .filter((d) => !isFCurveEffectivelyHidden(d.fcurve, liveAction))
          .map((d) => d.fcurve.id)
      : [];
    const ctx = { orderedIds, activeFCurveId };
    if (!wouldGroupChildrenSelectChange(liveAction, groupId, ctx)) {
      return { changed: false, clearedActive: false, selectedCount: 0 };
    }
    let decision = { changed: false, clearedActive: false, selectedCount: 0 };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      decision = applyGroupChildrenSelect(a, groupId, ctx);
    }, { skipHistory: true });
    return decision;
  }, [activeActionId, update, decoded, activeFCurveId]);

  // Slice 5.KK (Path #49) — plain/Ctrl group-header click dispatcher.
  //
  // Mirrors Blender's `click_select_channel_group` non-children branches
  // at `anim_channels_edit.cc:4154-4189` (function defined `:4120-4221`,
  // called via the dispatch chain documented in
  // `applyGroupHeaderSelect`'s JSDoc; audit-fix fidelity MED-1 Slice
  // 5.KK dual-audit corrected the earlier `mouse_anim_channels`
  // attribution — those branches live inside
  // `click_select_channel_group`, not in the per-type dispatcher
  // itself):
  //
  //   - 'replace' (plain click)  → SELECT_REPLACE (`:4181-4189`)
  //   - 'toggle'  (Ctrl+click)   → SELECT_INVERT  (`:4155-4158`)
  //   - 'range'   (Shift+click)  → SELECT_EXTEND_RANGE (`:4159-4162`,
  //     walker at `:3984-4025`) — shipped Slice 5.MM (Path #58).
  //     Auto-downgrades to 'toggle' when no AGRP_ACTIVE group exists
  //     (matches Blender's `:4517-4522` type-agnostic auto-downgrade).
  //
  // Keymap: `blender_default.py:3848-3854`.
  //
  // `skipHistory: true` — channel selection is view state per the
  // Slice 5.F/5.K convention. Preflight gates the no-op case so a
  // re-click on an already-selected-only group doesn't push a phantom
  // undo snapshot.
  //
  // Active-fcurve clear cascade — Blender's pre-clear at `:4183`
  // routes through `anim_channels_select_set` ANIMTYPE_FCURVE case
  // (`:723-734`) clearing FCURVE_ACTIVE on every fcurve that
  // transitions to !FCURVE_SELECTED. SS's helper handles that for the
  // 'replace' branch via `clearActiveFCurves(action)` inside the
  // same `update()` closure (the EXCLUSIVE invariant from Slice 5.X
  // collapses "every visible deselected fcurve loses active" to "the
  // single active fcurve, if visible, loses active").
  const applyGroupHeaderSelectOp = useCallback((groupId, modifier) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    const orderedIds = liveAction
      ? decoded
          .filter((d) => !isFCurveEffectivelyHidden(d.fcurve, liveAction))
          .map((d) => d.fcurve.id)
      : [];
    const ctx = { orderedIds, activeFCurveId };
    if (!wouldGroupHeaderSelectChange(liveAction, groupId, modifier, ctx)) {
      return { changed: false, clearedActive: false, groupSelectedAfter: false };
    }
    let decision = { changed: false, clearedActive: false, groupSelectedAfter: false };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      decision = applyGroupHeaderSelect(a, groupId, modifier, ctx);
    }, { skipHistory: true });
    return decision;
  }, [activeActionId, update, decoded, activeFCurveId]);

  // Slice 5.DD — GRAPH-region select-all channel cascade + active-restore.
  //
  // Ports the `do_channels=true` cascade in `deselect_graph_keys`
  // (`reference/blender/source/blender/editors/space_graph/graph_select.cc:397-413`)
  // plus the outer active-restore pass in `graphkeys_deselectall_exec`
  // at `:459-470`. Closes Slice 5.X-4 deviation (no active-restore
  // pass after bulk select-toggle / deselect-all).
  //
  // The caller (graph-region keymap branches below) is responsible for
  // the keyform-handle-level mutation (`setSelectedHandles(...)`); this
  // dispatcher handles ONLY the channel-side cascade in a separate
  // `update()` closure with `skipHistory:true` (channel selection is
  // view state — Slice 5.F/5.K convention).
  //
  // `previouslyActive` is snapshotted INSIDE the update closure (via
  // `getActiveFCurve(a)?.id`) so it reads the canonical action draft
  // rather than a stale React-state-captured `activeFCurveId`. This
  // matches Slice 5.X's pattern where the dispatcher reads from the
  // immer draft, not the outer closure's captured snapshot.
  //
  // NOT wired into the CHANNEL-region (sidebar) keymap branches —
  // Blender's `animchannels_selectall_exec` at
  // `anim_channels_edit.cc:3521-3554` is deliberately restore-less
  // (no analog to `graph_select.cc:459-470` from
  // `graphkeys_deselectall_exec`; operator type defn at
  // `anim_channels_edit.cc:3556-3575`) per the channel-region
  // semantic (active is allowed to fade away on Alt+A). Slice 5.Z's
  // `clearActive` wire-through already handles the channel-region
  // active-clear correctly.
  //
  // Audit-fix MED-1 (Slice 5.DD arch audit 2026-05-18): preflight-
  // gated. Calls `useProjectStore.getState()` to read live action +
  // active state without subscribing to project store (matches
  // `applyChannelBoxSelectOp` pattern). Skips the `update()` recipe
  // when no net mutation would occur — avoids phantom render +
  // preserves preflight contract.
  //
  // Audit-fix MED-2 (Slice 5.DD arch audit 2026-05-18): note on
  // two-update sequencing. The keymap branch fires `setSelectedHandles`
  // FIRST (React state update) and THEN this dispatcher
  // (immer-based project store update). `orderedIds` is captured from
  // `visible` at callback-creation time; `visible` is derived from
  // `action` (project store), NOT from `selectedHandles`, so the
  // visible scope can't go stale between the two state updates within
  // a single event handler. The `previouslyActive` snapshot inside
  // the immer recipe is the canonical action-draft read (not a
  // React-state capture), so it's correct regardless of the
  // setSelectedHandles → update() ordering.
  const graphSelectAllOp = useCallback((mode) => {
    const orderedIds = visible.map((d) => d.fcurve.id);
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    const liveActive = liveAction ? getActiveFCurve(liveAction)?.id ?? null : null;
    if (!wouldGraphSelectAllChannelCascadeChange(liveAction, mode, { orderedIds, previouslyActive: liveActive })) {
      return;
    }
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      const previouslyActive = getActiveFCurve(a)?.id ?? null;
      applyGraphSelectAllChannelCascade(a, mode, { orderedIds, previouslyActive });
    }, { skipHistory: true });
  }, [activeActionId, update, visible]);

  // Hover region setters — Sidebar wires its outer div to these so
  // `regionHoverRef.current` reflects which sub-area the cursor is over
  // when KeyA / Alt+A / Ctrl+I fires. Stable identities keep Sidebar's
  // mouse-enter/leave handlers from churning on parent re-renders.
  const onSidebarEnter = useCallback(() => { regionHoverRef.current = 'sidebar'; }, []);
  const onSidebarLeave = useCallback(() => { regionHoverRef.current = 'timeline'; }, []);

  // Slice 5.M — bulk hide/reveal dispatcher (H / Shift+H / Alt+H).
  //
  // Mirrors Blender's `GRAPH_OT_hide` (`space_graph/graph_ops.cc:226-318`)
  // and `GRAPH_OT_reveal` (`space_graph/graph_ops.cc:341-402`). Keymap
  // at `blender_default.py:1967` → `_template_items_hide_reveal_actions`
  // at `:461-466`.
  //
  // UNLIKE the select-all dispatcher above, hide/reveal go through
  // normal undo history: both operators carry `OPTYPE_REGISTER |
  // OPTYPE_UNDO` (`graph_ops.cc:332` and `:416`). `fcurve.hide` is
  // a document-level concern that survives save/load (Slice 5.I), so
  // undo coverage matters. `update(recipe)` without `skipHistory:true`
  // is the right pattern — same as `toggleFCurveHidden`'s per-row
  // path (Slice 5.I).
  //
  // The keymap binds these actions ONLY in `km_graph_editor` (the
  // timeline region). `km_animation_channels` (sidebar) does NOT have
  // H/Shift+H/Alt+H entries — Blender's per-row visibility toggle in
  // the sidebar is `W` via `anim.channels_setting_toggle`. So this
  // dispatcher is timeline-scoped only.
  // Audit-fix HIGH-A1 (Slice 5.M dual-audit 2026-05-17): preflight
  // before update(). Without it, pressing H with nothing selected
  // pushes an undo snapshot anyway (`projectStore.js:230-232`
  // unconditionally snapshots before invoking the recipe), giving
  // the user a phantom Ctrl+Z that restores the same state to
  // itself and consumes one undo slot. The preflight reader walks
  // the same filter but doesn't write; if nothing would change we
  // skip the `update()` call entirely. Reading via
  // `useProjectStore.getState()` avoids subscribing the dispatcher
  // to project state (the existing `useState`-driven keymap fires
  // synchronously on keypress and reads the live state then; no
  // need for a render-triggering subscription).
  const applyHideOp = useCallback((mode) => {
    const opts = { unselected: mode === 'unselected' };
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldHideChangeFCurves(liveAction, opts)) {
      return { changed: false, hiddenCount: 0, deselectedCount: 0, reShowCount: 0 };
    }
    let result = { changed: false, hiddenCount: 0, deselectedCount: 0, reShowCount: 0 };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      result = applyHideFCurves(a, opts);
    });
    return result;
  }, [activeActionId, update]);

  const applyRevealOp = useCallback(() => {
    // `select=true` matches Blender's RNA default at
    // `graph_ops.cc:418`; the Alt+H keymap entry binds with no
    // properties (`blender_default.py:463`), so the default applies.
    const opts = { select: true };
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldRevealChangeFCurves(liveAction, opts)) {
      return { changed: false, revealedCount: 0, selectedCount: 0 };
    }
    let result = { changed: false, revealedCount: 0, selectedCount: 0 };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      result = applyRevealFCurves(a, opts);
    });
    return result;
  }, [activeActionId, update]);

  // Slice 5.N — bulk channel delete dispatcher (sidebar X / Delete).
  //
  // Mirrors Blender's `ANIM_OT_channels_delete`
  // (`anim_channels_edit.cc:2739-2873`) which deletes every selected
  // F-Curve channel. Keymap default at `blender_default.py:3873-3874`
  // (X / DEL); Industry-Compatible at `industry_compatible_data.py:2357-2358`
  // (Backspace / DEL).
  //
  // Same preflight pattern as Slice 5.M's hide ops: read live state,
  // ask the pure helper "would anything change?", short-circuit if
  // not, so a no-op X press doesn't burn a phantom undo snapshot
  // (`projectStore.js:230-232`).
  //
  // Side-effect cleanup beyond the pure helper:
  //   1. Drop `selectedHandles` entries keyed by deleted fcurve ids —
  //      otherwise stale keyform-selection state lingers in the
  //      React-local state map even after the underlying fcurve is
  //      gone (Slice 5.C precedent for keyform delete is the same:
  //      clean up the local map post-mutation).
  //   2. Clear the global selectStore active if the active param's
  //      backing fcurve was deleted. Blender re-resolves active
  //      from the channel list per-render; SS's active is stored
  //      independently in selectStore and may now dangle.
  //
  // Driver-bearing curves ARE deletable at the channel layer (unlike
  // the keyform-delete path which respects Slice 5.D's per-curve
  // driver gate). Mirrors `ED_anim_ale_fcurve_delete`
  // (`anim_channels_edit.cc:2692-2734`) which uniformly removes both
  // driven and undriven curves.
  const applyChannelDeleteOp = useCallback(() => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldChannelDeleteSelectedChange(liveAction)) {
      return { changed: false, deletedCount: 0, deletedIds: [] };
    }

    // Pre-compute the deleted set + snapshot each global-selection
    // item's resolved fcurve id BEFORE delete. Audit-fix HIGH-A1
    // (Slice 5.N dual-audit 2026-05-17): the original draft called
    // `useSelectionStore.getState().clear()` which nuked EVERY
    // selection item (parts, params, groups) when ANY active-resolving
    // item's backing fcurve was deleted. That overreached — Blender
    // re-resolves active from the surviving channel list per-render
    // and never touches unrelated selection state. Correct port:
    // identify which selection items would dangle (resolve to a
    // deleted fcurve) and remove ONLY those.
    const deletedIdSet = new Set();
    for (const fc of liveAction.fcurves) {
      if (fc && fc.selected === true && typeof fc.id === 'string') {
        deletedIdSet.add(fc.id);
      }
    }
    const items = useSelectionStore.getState().items;
    /** @type {Array<{type: string, id: string}>} */
    const survivingItems = [];
    let anyDangling = false;
    for (const item of items) {
      let resolvedFCId = null;
      if (item && item.type === 'parameter') {
        const fc = liveAction.fcurves.find((f) => fcurveTargetsParam(f, item.id));
        if (fc) resolvedFCId = fc.id;
      } else if (item && (item.type === 'part' || item.type === 'group')) {
        const fc = liveAction.fcurves.find((f) => {
          const t = decodeFCurveTarget(f);
          return t?.kind === 'node' && t.nodeId === item.id;
        });
        if (fc) resolvedFCId = fc.id;
      }
      if (resolvedFCId && deletedIdSet.has(resolvedFCId)) {
        anyDangling = true;
      } else {
        survivingItems.push(item);
      }
    }

    let result = { changed: false, deletedCount: 0, deletedIds: /** @type {string[]} */ ([]) };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      result = applyChannelDeleteSelected(a);
    });

    if (result.changed && result.deletedIds.length > 0) {
      // Side-effect 1: drop keyform-selection entries for deleted ids.
      setSelectedHandles((curr) => {
        if (!(curr instanceof Map) || curr.size === 0) return curr;
        let anyHit = false;
        for (const id of result.deletedIds) {
          if (curr.has(id)) { anyHit = true; break; }
        }
        if (!anyHit) return curr;
        const next = new Map(curr);
        for (const id of result.deletedIds) next.delete(id);
        return next;
      });
      // Side-effect 2: surgically remove only the dangling selection
      // items (those that resolved to a deleted fcurve). Unrelated
      // params/parts/groups stay selected. `select(targets, 'replace')`
      // sets `items` to a copy of `targets`; passing an empty array
      // is the equivalent of `clear()` and is safe.
      if (anyDangling) {
        useSelectionStore.getState().select(survivingItems, 'replace');
      }
    }
    return result;
  }, [activeActionId, update]);

  // Slice 5.O — bulk channel-mute dispatcher (sidebar Shift+W /
  // Ctrl+Shift+W / Alt+W).
  //
  // Mirrors Blender's three operators wired through `setflag_anim_channels`
  // (`anim_channels_edit.cc:2923-3001`) with setting=MUTE:
  //
  //   - Shift+W       → `anim.channels_setting_toggle` (mode='toggle')
  //   - Ctrl+Shift+W  → `anim.channels_setting_enable` (mode='enable')
  //   - Alt+W         → `anim.channels_setting_disable` (mode='disable')
  //
  // Keymap registration: `blender_default.py:3876-3878` (sidebar region,
  // `km_animation_channels`). Like Slice 5.N's channel-delete this is
  // a SIDEBAR-region binding only; the timeline-region keymap doesn't
  // bind W to anything fcurve-related (W in timeline is a different
  // op-set in other editors and unbound in Graph Editor proper).
  //
  // Preflight pattern: same as Slice 5.M's hide/reveal and Slice 5.N's
  // channel-delete dispatchers — read live state, ask the pure helper
  // "would anything change?", short-circuit if not. Prevents the
  // `projectStore.js:230-232` unconditional pre-recipe snapshot from
  // burning an undo slot when the user presses Shift+W with nothing
  // selected (or with all selected curves already in the target state).
  //
  // SS-skipped Blender UI surface: the type-picker popup menu (Blender
  // pops `{PROTECT, MUTE}` enum via `WM_menu_invoke`). SS only has
  // `fcurve.mute` — `fcurve.protected` is not ported — so the menu
  // would be degenerate (1 option). Routed directly to mute; see
  // `applyChannelMuteSelected` JSDoc Deviation 1 for the closure
  // condition (PROTECT slice + popup-menu primitive).
  const applyChannelMuteOp = useCallback((mode) => {
    const liveProject = useProjectStore.getState().project;
    const liveAction = getActiveSceneAction(liveProject, activeActionId);
    if (!wouldChannelMuteSelectedChange(liveAction, mode)) {
      return { changed: false, mutedCount: 0, unmutedCount: 0, resolvedMode: null };
    }
    let result = { changed: false, mutedCount: 0, unmutedCount: 0, resolvedMode: /** @type {'enable'|'disable'|null} */ (null) };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      result = applyChannelMuteSelected(a, mode);
    });
    return result;
  }, [activeActionId, update]);

  const onKeyDown = useCallback((e) => {
    if (modal) return;
    if (menu) return;
    // Audit-fix HIGH-A1 (Slice 5.Q dual-audit 2026-05-17): added
    // HTMLSelectElement to the input-element guard. Slice 5.Q's
    // ActiveKeyformPanel hosts an interpolation `<select>` dropdown
    // inside the editor's wrap div; without the SelectElement guard,
    // pressing N inside the dropdown bubbled up to onKeyDown and
    // toggled the N-panel closed mid-selection. Every existing
    // editor keybind (G, S, B, V, T, X, A, H, W…) is equally
    // affected — fixing the guard once covers all current and
    // future select-bearing surfaces.
    if (
      e.target instanceof HTMLInputElement
      || e.target instanceof HTMLTextAreaElement
      || e.target instanceof HTMLSelectElement
    ) return;

    // FCurve owns this chord — stopPropagation prevents the global
    // operator dispatcher (registered as a bubble-phase window listener
    // in mountOperatorDispatcher) from ALSO firing on the same key.
    // Pre-2026-06-12 every branch below only called preventDefault, so
    // pressing G over the FCurve editor (which is a tabIndex=0 div that
    // grabs focus on pointerEnter) would start FCurve's keyframe-grab
    // modal AND the global transform.translate modal in lockstep. Same
    // bug class as the dopesheet G fix (DopesheetEditor.jsx:736 — "B-3
    // (R4) — also stopPropagation so the global keymap dispatcher
    // doesn't ALSO fire transform.translate on the same chord").
    // Implemented as a `consume(e)` helper so every branch claims with
    // a one-line call instead of duplicating preventDefault + stopProp.
    const consume = () => { e.preventDefault(); e.stopPropagation(); };

    const rect = canvasRef.current?.getBoundingClientRect();
    const anchor = rect
      ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      : { x: 0, y: 0 };

    if (e.code === 'KeyG') {
      consume();
      if (e.ctrlKey || e.metaKey) operatorSnapToFrame();
      else startModal('g', anchor);
      return;
    }
    if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey) {
      consume();
      startModal('s', anchor);
      return;
    }
    if (e.code === 'KeyB') {
      consume();
      startBoxSelect(anchor);
      return;
    }
    if (e.code === 'KeyV') {
      consume();
      if (selectionRef.current.size === 0) return;
      setMenu({ kind: 'handleType', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'KeyT' && !e.ctrlKey && !e.metaKey) {
      consume();
      if (selectionRef.current.size === 0) return;
      setMenu({ kind: 'interpolation', x: anchor.x, y: anchor.y });
      return;
    }
    if (e.code === 'KeyE' && e.shiftKey) {
      consume();
      setMenu({ kind: 'extrapolation', x: anchor.x, y: anchor.y });
      return;
    }
    // Slice 5.N + 5.II — region-aware delete dispatch.
    //
    // Blender's two delete operators:
    //   - `anim.channels_delete` — sidebar region; deletes selected
    //     FCurves (channel layer; `anim_channels_edit.cc:2739`).
    //     Default keymap: X/DEL (`blender_default.py:3873-3874`);
    //     Industry-compatible: BACKSPACE/DEL
    //     (`industry_compatible_data.py:2357-2358`).
    //   - keyframe.delete-equivalent — timeline region X/DEL;
    //     deletes selected keyforms within fcurves (the existing
    //     `operatorDelete` shipped by Slice 5.C). DEL is bound in
    //     Blender (`graph.delete` at `:2050`); SS's X-as-keyform-
    //     delete is an SS extension that's preset-agnostic.
    //
    // Slice 5.II (this slice) closes the Slice 5.N inline TODO
    // (Industry-Compatible Backspace gap) by routing the
    // channels-region keypress through `resolveChannelDeleteAction`
    // (the resolver pattern from Slice 5.AA). The active preset
    // (`'default'` / `'default_no_toggle'` / `'industry_compatible'`)
    // governs which key fires the channels delete.
    //
    // Known limitation (Slice 5.N MED-A2, also affects Slice 5.K's
    // A/Alt+A/Ctrl+I sidebar branches): `regionHoverRef.current`
    // only updates on pointer enter/leave. Keyboard-only navigation
    // (Tab into the FCurveEditor without moving the mouse, then
    // delete key) falls through to the timeline-region default.
    // Proper fix needs focus tracking on the sidebar container —
    // would be the same lift across all region-aware keys, so
    // deferred to a dedicated slice.
    if (regionHoverRef.current === 'sidebar') {
      const channelDelete = resolveChannelDeleteAction(
        usePreferencesStore.getState().keymapPreset, e,
      );
      if (channelDelete === 'delete') {
        consume();
        applyChannelDeleteOp();
        return;
      }
      // Slice 5.II — block fall-through when the sidebar is hovered
      // but the pressed key isn't bound in the active preset (e.g. X
      // in IC, Backspace in default). Per Blender's per-region
      // keymap dispatch, an unbound key over the channels region is
      // a no-op — it should NOT fall through to the timeline
      // (keyform) operator. Without this block, X in IC over sidebar
      // would silently fire keyform-delete on whatever the timeline
      // has selected.
      if (e.code === 'KeyX' || e.code === 'Backspace' || e.code === 'Delete') {
        return;
      }
    }
    // Timeline region: X or DEL → keyform delete (Slice 5.C).
    if (e.code === 'Delete' || e.code === 'KeyX') {
      consume();
      operatorDelete();
      return;
    }
    if (e.code === 'Home') {
      consume();
      operatorHome();
      return;
    }
    // Slice 5.K + 5.AA — region-routed channel select-all when the
    // cursor is over the sidebar. Mirrors Blender's per-area keymap
    // registration (channels region binds the select-all triplet to
    // `ANIM_OT_channels_select_all`; graph region binds them
    // independently). Checked BEFORE the timeline-scoped KeyA so the
    // sidebar variant wins when hover='sidebar'.
    //
    // Slice 5.AA: the modifier-to-action mapping is delegated to
    // `resolveSelectAllAction(preset, e)` so both keymap presets are
    // honored. The resolver returns:
    //   - 'toggle' (default preset: A)
    //   - 'add'    (industry_compatible preset: Ctrl+A)
    //   - 'clear'  (default: Alt+A; IC: Ctrl+Shift+A)
    //   - 'invert' (both presets: Ctrl+I)
    //   - null     (no preset binding matches — fall through)
    //
    // Default keymap source: `blender_default.py:3864` →
    // `_template_items_select_actions` at `:420-439`.
    // Industry-compatible source: `industry_compatible_data.py:2345-2350`.
    if (regionHoverRef.current === 'sidebar') {
      const action = resolveSelectAllAction(
        usePreferencesStore.getState().keymapPreset,
        e,
      );
      if (action !== null) {
        consume();
        applyChannelSelectAllOp(action);
        return;
      }
      // Slice 5.FF — B key arms box-select. Bound in Blender at
      // `blender_default.py:3865`: `("anim.channels_select_box",
      // {"type": 'B', "value": 'PRESS'}, None)`. Bare B (no modifiers
      // — Blender's keymap entry passes no `shift/ctrl/alt`).
      if (e.code === 'KeyB' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        consume();
        setBGestureArmed(true);
        return;
      }
    }
    // Slice 5.FF — Escape cancels armed box-select (matches Blender's
    // `WM_gesture_box_modal` GESTURE_MODAL_CANCEL handling at
    // `wm_gesture_ops.cc` — Esc returns the modal to OPERATOR_CANCELLED).
    // Region-agnostic: armed state is a global modal, so any Escape
    // anywhere in the editor cancels.
    if (e.key === 'Escape' && bGestureArmedRef.current) {
      consume();
      setBGestureArmed(false);
      return;
    }
    // Graph-region keymap parity with `blender_default.py:2010` (=
    // `*_template_items_select_actions(params, "graph.select_all")`).
    // Slice 5.AA: delegate the modifier-to-action mapping to
    // `resolveSelectAllAction(preset, e)` so both default and
    // industry-compatible presets are honored on the SAME operator
    // surface (graph.select_all has identical triplets to
    // anim.channels_select_all in BOTH presets).
    //
    // Action mapping (per `resolveSelectAllAction`):
    //   - 'toggle' (default: A) → SS resolves locally as
    //     "if size>0 clear else selectAll" which matches Blender's
    //     `use_select_all_toggle=True` branch at `:436`. Default
    //     config sets `:115`=False which would emit SELECT at `:423`
    //     instead — SS picks the more common toggle preference.
    //     Documented in Slice 5.K close-out + keymapPresets.js JSDoc
    //     "Why two presets" deviation (audit-fix HIGH-A1 2026-05-17).
    //   - 'add' (IC: Ctrl+A) → unconditional `operatorSelectAll`
    //     (Blender's `:423` default-config behavior). No toggle on
    //     repeat press in IC preset.
    //   - 'clear' (default: Alt+A; IC: Ctrl+Shift+A) → `clearSelection`.
    //     Default-keymap source: `:437` toggle branch / `:424` default
    //     branch (both emit identical Alt+A row). IC source:
    //     `industry_compatible_data.py:964-965`.
    //   - 'invert' (both: Ctrl+I) → `operatorInvertSelection`.
    //     Default-keymap source: `:438` toggle / `:425` default. IC:
    //     `industry_compatible_data.py:966`.
    //
    // Audit-fix MED-1 (Slice 5.AA arch audit 2026-05-17): the 'toggle'
    // arm uses `selectionRef.current.size` (the count of selected
    // KEYFORM HANDLES in this graph region) as the "any selected"
    // signal — DIFFERENT from the sidebar branch's
    // `applyChannelSelectAll(action, 'toggle', ctx)` which scans
    // channel-level selection. The two regions operate on distinct
    // selection states by design; both qualify as toggle semantics
    // within their own region.
    //
    // Region routing via `regionHoverRef.current` ensures the sidebar
    // branch above wins when cursor is on the channel list; this
    // graph branch fires only when hover='timeline'.
    //
    // Audit-fix MED-3 (Slice 5.AA arch audit 2026-05-17): collapsed
    // the 4-arm if-chain (each with its own preventDefault + return)
    // to a single null-gate matching the sidebar branch's shape, so
    // adding new actions in future presets requires editing one
    // dispatch table instead of duplicating preventDefault/return
    // boilerplate.
    {
      const action = resolveSelectAllAction(
        usePreferencesStore.getState().keymapPreset,
        e,
      );
      if (action !== null) {
        consume();
        // Slice 5.DD — `cascadeMode` is the channel-side cascade
        // intent. For 'toggle' it tracks the keyform-side resolution
        // (add when nothing selected, clear when something is). All
        // other modes pass through 1:1.
        let cascadeMode;
        if (action === 'toggle') {
          if (selectionRef.current.size > 0) { clearSelection(); cascadeMode = 'clear'; }
          else { operatorSelectAll(); cascadeMode = 'add'; }
        } else if (action === 'add') {
          operatorSelectAll();
          cascadeMode = 'add';
        } else if (action === 'clear') {
          clearSelection();
          cascadeMode = 'clear';
        } else { // 'invert'
          operatorInvertSelection();
          cascadeMode = 'invert';
        }
        // Slice 5.DD — channel cascade + active-restore. See
        // `graphSelectAllOp` definition for the Blender provenance
        // (`graphkeys_deselectall_exec:459-470` +
        // `deselect_graph_keys:397-413`).
        graphSelectAllOp(cascadeMode);
        return;
      }
    }
    // Slice 5.M + 5.JJ — bulk hide/reveal (`graph.hide` + `graph.reveal`).
    // Slice 5.JJ refactor: the 3-branch H/Shift+H/Alt+H ladder is now
    // a single resolver-driven dispatch via `resolveHideRevealAction`.
    // The resolver maps to one of 'hide_selected' / 'hide_unselected'
    // / 'reveal' per the active preset:
    //
    //   - 'default' / 'default_no_toggle':
    //       H        → 'hide_selected'   (blender_default.py via :464)
    //       Shift+H  → 'hide_unselected' (:465)
    //       Alt+H    → 'reveal'          (:463)
    //
    //   - 'industry_compatible':
    //       Ctrl+H   → 'hide_selected'   (industry_compatible_data.py:919-920)
    //       Shift+H  → 'hide_unselected' (:921-922 — shared with default)
    //       Alt+H    → 'reveal'          (:923 — shared with default)
    //
    // The reveal binding (Alt+H) and the hide-unselected binding
    // (Shift+H) are SHARED across all 3 presets; only "hide selected"
    // differs (bare H in default, Ctrl+H in IC).
    //
    // These are timeline-region only. Blender's `km_animation_channels`
    // (sidebar) does not bind H/Shift+H/Alt+H — sidebar visibility is
    // toggled per-row via W (`anim.channels_setting_toggle`,
    // `blender_default.py:3876`). So this dispatch path doesn't gate
    // on `regionHoverRef.current === 'sidebar'`; it fires regardless
    // of cursor region today. (If SS later mirrors Blender's W →
    // setting_toggle in the sidebar, that's a separate slice.)
    {
      const hideReveal = resolveHideRevealAction(
        usePreferencesStore.getState().keymapPreset, e,
      );
      if (hideReveal === 'hide_selected') {
        consume();
        applyHideOp('selected');
        return;
      }
      if (hideReveal === 'hide_unselected') {
        consume();
        applyHideOp('unselected');
        return;
      }
      if (hideReveal === 'reveal') {
        consume();
        applyRevealOp();
        return;
      }
    }
    // Slice 5.Q — N key toggles the N-panel (right-side sidebar).
    //
    // Blender keymap (`blender_default.py:1958-1962` =
    // `km_graph_editor_generic` window region) registers via the
    // shared template `_template_space_region_type_toggle` with
    // `sidebar_key={"type": 'N', "value": 'PRESS'}`. The template
    // emits `wm.context_toggle` against
    // `space_data.show_region_ui` (the N-panel visibility flag).
    //
    // Modifier requirements (verified against
    // `_template_space_region_type_toggle` at
    // `blender_default.py:355-369` — no shift/ctrl/alt in the
    // `sidebar_key` keymap dict): bare N, no modifiers.
    //
    // Fires regardless of `regionHoverRef.current` — Blender's
    // template is registered at the WINDOW region level
    // (`km_graph_editor_generic`'s region_type='WINDOW') which
    // matches both the timeline and the sidebar. SS does the same:
    // no region gating on the N key.
    if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      consume();
      setNpanelOpen((v) => !v);
      return;
    }
    // Slice 5.O — bulk channel-mute keymap (sidebar region only).
    //
    // Blender keymap entries at `blender_default.py:3876-3878`:
    //   - Shift+W       → `anim.channels_setting_toggle`
    //   - Ctrl+Shift+W  → `anim.channels_setting_enable`
    //   - Alt+W         → `anim.channels_setting_disable`
    //
    // All three are bound in `km_animation_channels` (sidebar region)
    // — `km_graph_editor` does NOT bind W to anything. So gating on
    // `regionHoverRef.current === 'sidebar'` is mandatory: a Shift+W
    // press over the timeline must NOT fire (would be a Blender
    // divergence; user might be expecting some future timeline-W
    // operator and silent capture would be worse than a noop).
    //
    // Modifier exclusivity matches the keymap exactly: Shift+W means
    // SHIFT only (not Ctrl+Shift+W, not Alt+Shift+W); Ctrl+Shift+W
    // means CTRL+SHIFT only; Alt+W means ALT only. This avoids
    // ambiguity at the boundaries — Ctrl+Shift+W should NOT also
    // fire the bare Shift+W branch.
    //
    // Same region-routing keyboard-nav limitation as Slice 5.N's X/DEL
    // branch (MED-A2): `regionHoverRef.current` only updates on pointer
    // events, so Tab-focused dispatch from a key-only navigation
    // session falls through. Tracked as queued path #17.
    if (regionHoverRef.current === 'sidebar') {
      if (e.code === 'KeyW' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        consume();
        applyChannelMuteOp('toggle');
        return;
      }
      if (e.code === 'KeyW' && e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey) {
        consume();
        applyChannelMuteOp('enable');
        return;
      }
      if (e.code === 'KeyW' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        consume();
        applyChannelMuteOp('disable');
        return;
      }
    }
    // Audit-fix HIGH-A5 (2026-05-16): include `activeActionId` so that
    // switching the scene-bound action between keypresses doesn't leave
    // `onKeyDown` closing over a stale id (which would silently no-op
    // operators against the wrong action's getActiveSceneAction result).
    // Slice 5.K: `applyChannelSelectAllOp` is the new dep; its own
    // closure already includes `activeActionId` + `decoded` + `activeFCurveId`
    // so adding it here covers all live state for the sidebar branch.
    // Slice 5.O: `applyChannelMuteOp` added (mode-keyed dispatcher).
  }, [modal, menu, fps, view, visible, activeFCurveId, activeActionId, applyChannelSelectAllOp, applyHideOp, applyRevealOp, applyChannelDeleteOp, applyChannelMuteOp, graphSelectAllOp]);

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
  // Audit-fix LOW-A1 (Slice 5.J dual-audit 2026-05-17): `ctx` is fully
  // built by the caller (Sidebar onClick) on each click so the helper
  // sees a fresh `{activeFCurveId, orderedIds}` snapshot. Do not hoist
  // the `decoded.map(...)` into this callback's closure — it would
  // capture a stale `decoded` reference from the surrounding scope and
  // silently break range-select on action edits between renders. The
  // closure deps below intentionally include only `activeActionId` +
  // `update` because the helper is purely structural.
  //
  // Audit-fix HIGH-2 (Slice 5.X arch audit 2026-05-17): the same
  // structural-purity rule applies to `setActiveFCurve(a, fcurveId)` —
  // it walks `a.fcurves` only, takes `fcurveId` as a parameter, and
  // mutates the immer draft in-place. Do not capture `activeFCurve`,
  // `activeFCurveId`, or `selection` into this closure for any
  // 5.X-style follow-up — the closure must stay structural-only.
  const applyChannelClick = useCallback((fcurveId, modifier, ctx) => {
    let decision = { makeActive: false, selectedNow: false };
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      decision = applyChannelSelect(a, fcurveId, modifier, ctx);
      // Slice 5.X: persist the active flag when applyChannelSelect's
      // `makeActive` decision says so. Mirrors Blender's
      // `graph_select.cc:466` (`fcu->flag |= (FCURVE_SELECTED |
      // FCURVE_ACTIVE)`) — the SELECTED write already happened inside
      // applyChannelSelect; the ACTIVE write is sister to it. Sharing
      // the same `{ skipHistory: true }` update closure as channel
      // selection per fcurveActive.js Deviation 3 (deliberate sister-UX
      // choice to Slice 5.F's selection-as-view-state stance).
      if (decision.makeActive) {
        setActiveFCurve(a, fcurveId);
      }
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

  // Slice 5.V — group-level mute / hide / expanded toggles. Mirror
  // Blender's `ACHANNEL_SETTING_MUTE` / `_VISIBLE` / `_EXPAND`
  // operators on bActionGroup
  // (`reference/blender/source/blender/editors/animation/anim_channels_defines.cc:908-948`).
  // All three route through the preflight pair in fcurveGroups.js so
  // a no-op toggle skips the undo snapshot (Slice 5.M pattern).
  const onToggleGroupMute = useCallback((groupId) => {
    const liveAction = getActiveSceneAction(
      useProjectStore.getState().project, activeActionId,
    );
    if (!wouldToggleFCurveGroupMuteChange(liveAction, groupId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyToggleFCurveGroupMute(a, groupId);
    });
  }, [activeActionId, update]);

  const onToggleGroupHide = useCallback((groupId) => {
    const liveAction = getActiveSceneAction(
      useProjectStore.getState().project, activeActionId,
    );
    if (!wouldToggleFCurveGroupHiddenChange(liveAction, groupId)) return;
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyToggleFCurveGroupHidden(a, groupId);
    });
  }, [activeActionId, update]);

  const onToggleGroupExpanded = useCallback((groupId) => {
    const liveAction = getActiveSceneAction(
      useProjectStore.getState().project, activeActionId,
    );
    if (!wouldToggleFCurveGroupExpandedChange(liveAction, groupId)) return;
    // Expanded is view state — bypass undo history (matches Blender's
    // expand-toggle which doesn't push to the undo stack).
    update((p) => {
      const a = getActiveSceneAction(p, activeActionId);
      if (!a) return;
      applyToggleFCurveGroupExpanded(a, groupId);
    }, { skipHistory: true });
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
        action={action}
        decoded={decoded}
        activeFCurveId={activeFCurveId}
        onToggleHidden={toggleHidden}
        onToggleMute={onToggleMute}
        onToggleGroupMute={onToggleGroupMute}
        onToggleGroupHide={onToggleGroupHide}
        onToggleGroupExpanded={onToggleGroupExpanded}
        onPickActiveByTarget={onPickActiveByTarget}
        onApplyChannelClick={applyChannelClick}
        onApplyChannelBoxSelect={applyChannelBoxSelectOp}
        onApplyGroupChildrenSelect={applyGroupChildrenSelectOp}
        onApplyGroupHeaderSelect={applyGroupHeaderSelectOp}
        bGestureArmed={bGestureArmed}
        bGestureArmedRef={bGestureArmedRef}
        onConsumeBGesture={() => setBGestureArmed(false)}
        onClearKeyformSelection={clearSelection}
        onSelectAll={applyChannelSelectAllOp}
        onSidebarEnter={onSidebarEnter}
        onSidebarLeave={onSidebarLeave}
        selection={selectedHandles}
      />

      <div className="flex-1 min-w-0 h-full flex flex-col">
        {activeDriver ? (
          <DriverBanner
            driver={activeDriver}
            value={driverValue}
            color={visible.find((d) => d.fcurve.id === activeFCurveId)?.color ?? null}
            label={visible.find((d) => d.fcurve.id === activeFCurveId)?.label ?? ''}
            activeActionId={activeActionId}
            activeFCurveId={activeFCurveId}
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

          {/* X-axis tick labels — Slice 5.T routes through `formatXTickLabel`
              so the View menu's "Use Timecode" toggle (Blender's
              `show_seconds` / `SIPO_DRAWTIME`) switches the labels
              between frame numbers and seconds. Frame mode uses the
              effective fps (action.fps overrides global fps), matching
              `PlaybackControls.jsx` and Blender's per-scene fps source. */}
          {(() => {
            const xTickFps = getEffectiveFps(action, fps);
            const xTickOpts = { showSeconds: fcurveShowSeconds, fps: xTickFps };
            return [0, 0.33, 0.67, 1].map((p) => (
              <text key={p}
                x={view.tx(p * duration)} y={view.h - 4} textAnchor="middle" fontSize={10}
                className="fill-muted-foreground font-mono">
                {formatXTickLabel(p * duration, xTickOpts)}
              </text>
            ));
          })()}

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
            showSeconds={fcurveShowSeconds}
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

      {/* Slice 5.Q — N-panel (right-side sidebar). Toggled by N key
          on the FCurveEditor wrap div. Width fixed at 256px when
          shown; hidden entirely when closed (no animation — Blender's
          N-panel toggle is also instant). Sections stack vertically
          inside the scrollable column: Active Keyframe (5.Q+5.R),
          Modifiers (3.C). Future polish (view options, etc.) stacks
          here. */}
      {npanelOpen ? (
        <div className="w-64 shrink-0 border-l bg-card overflow-y-auto h-full">
          <ActiveKeyformPanel
            action={action}
            activeActionId={activeActionId}
            activeFCurveId={activeFCurveId}
            interpolationTypes={INTERPOLATION_TYPES}
            handleTypes={HANDLE_TYPES}
            showSeconds={fcurveShowSeconds}
            fps={getEffectiveFps(action, fps)}
          />
          <FCurveModifiersPanel
            action={action}
            activeActionId={activeActionId}
            activeFCurveId={activeFCurveId}
          />
        </div>
      ) : null}
    </div>
  );
}

// ── Sidebar (Slice 5.C+) ─────────────────────────────────────────────

function Sidebar({ action, decoded, activeFCurveId, onToggleHidden, onToggleMute, onToggleGroupMute, onToggleGroupHide, onToggleGroupExpanded, onPickActiveByTarget, onApplyChannelClick, onApplyChannelBoxSelect, onApplyGroupChildrenSelect, onApplyGroupHeaderSelect, onClearKeyformSelection, onSelectAll, onSidebarEnter, onSidebarLeave, selection, bGestureArmed, bGestureArmedRef, onConsumeBGesture }) {
  // Slice 5.Y — drag-rect box-select state machine. Pointer events on the
  // sidebar wrapper drive a small 3-state FSM (idle → pressed → dragging).
  // On pointerup-after-drag, the hit-test queries every `[data-fcurve-id]`
  // row and computes Y-axis intersection vs the drag rect (Blender's
  // `box_select_anim_channels` at `anim_channels_edit.cc:3619` only tests
  // `ymax >= rectf.ymin && ymin <= rectf.ymax`, NOT X). The collected
  // ids + modifier go to `onApplyChannelBoxSelect`.
  //
  // `wasDragRef` is the click-suppression latch: when a drag completes,
  // the row's onClick still fires (browser-synthesized from pointerdown +
  // pointerup landing on the same wrapper). The latch tells the row click
  // to bail; cleared on the next pointerdown.
  //
  // The 4px drag threshold is an SS approximation of Blender's user pref
  // `U.drag_threshold_mouse` (default 3 px in `DNA_userdef_types.h:1191`),
  // fetched per-event by `WM_event_drag_threshold` at
  // `reference/blender/source/blender/windowmanager/intern/wm_event_query.cc:407-427`
  // and scaled by `UI_SCALE_FAC`. SS hard-codes 4 (1px above Blender's
  // default) because pointer-event tracking in the browser has no
  // equivalent UserPref hook and the CSS-pixel basis differs from
  // Blender's DPI scaling. Sub-threshold pointer movement is treated as
  // a click, not a drag. Audit-fix HIGH-A1 (Slice 5.Y fidelity audit
  // 2026-05-17): the earlier framing cited `WM_GESTURE_DRAG_THRESHOLD` —
  // that symbol does NOT exist in the Blender source. Real symbol is
  // `WM_event_drag_threshold` (function) reading `U.drag_threshold_mouse`
  // (struct field).
  const containerRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const dragSessionRef = useRef(/** @type {null | {
    pointerId: number,
    startClientX: number,
    startClientY: number,
    isDragging: boolean,
    modifier: 'replace' | 'extend' | 'deselect',
  }} */ (null));
  const wasDragRef = useRef(false);
  const [dragRect, setDragRect] = useState(/** @type {null | {x:number,y:number,w:number,h:number}} */ (null));

  const onSidebarPointerDown = useCallback((e) => {
    // Audit-fix MED-3 (Slice 5.Y arch audit 2026-05-17): reset the
    // click-suppression latch FIRST, before any early return. Otherwise
    // a stale latch from a prior drag survives across pointerdowns that
    // bail (button-child, non-primary button, second-touch). Race
    // example: drag → land on row (latch=true, click eaten) → next press
    // on a button child (early return, latch still true) → keyboard
    // Enter on a row → row onClick reads stale latch=true and bails.
    wasDragRef.current = false;
    // Audit-fix MED-2 (Slice 5.Y arch audit 2026-05-17): guard against
    // multi-touch hijack. On touch devices a second touch (different
    // pointerId, same button=0) would otherwise overwrite the active
    // drag session; move/up events filtered by pointerId then drop the
    // first finger's events silently, leaving the marquee orphaned.
    if (dragSessionRef.current !== null) return;
    // Only react to primary button. Ignore middle/right (browser context
    // menu, scroll, etc.) and any non-LMB pointer types.
    if (e.button !== 0) return;
    // Slice 5.FF — armed-mode (B key pressed) bypasses the
    // button-child early-return. Blender's WM_GESTURE_CROSS_RECT
    // modal accepts the next LMB-click anywhere as the gesture-start
    // (`wm_gesture_ops.cc:171-179`). Capture-then-consume the armed
    // flag here so the modal is one-shot per B press.
    const armed = !!(bGestureArmedRef && bGestureArmedRef.current);
    if (!armed) {
      // Ignore drags that start on an interactive child (button, etc.) —
      // those have their own click semantics. The check uses `closest`
      // so nested icons inside the button still count as the button.
      const t = /** @type {HTMLElement} */ (e.target);
      if (t && t.closest && t.closest('button, a, input, textarea, select')) return;
    } else if (typeof onConsumeBGesture === 'function') {
      onConsumeBGesture();
    }
    // Capture modifier state at press time. Blender's keymap (`blender_default.py:3866-3871`)
    // dispatches: plain→replace, Shift→extend, Ctrl→deselect. Modifiers are
    // read once at press; later modifier changes mid-drag are ignored to
    // match the wmOperator gesture model.
    const modifier = e.shiftKey
      ? 'extend'
      : (e.ctrlKey || e.metaKey)
        ? 'deselect'
        : 'replace';
    dragSessionRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      // Slice 5.FF — armed mode (B key) starts the drag IMMEDIATELY,
      // skipping the 4px threshold from Slice 5.Y. Blender's
      // WM_GESTURE_CROSS_RECT modal accepts the first LMB-press as
      // gesture-start regardless of movement distance.
      isDragging: armed,
      modifier,
    };
    // Slice 5.FF — capture pointer immediately in armed mode so
    // subsequent move/up route to the Sidebar even if the cursor
    // exits the container during the gesture. (Non-armed mode
    // captures lazily on first threshold-exceeding move.)
    if (armed) {
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
      // Seed the marquee at the press point so the user sees a 0x0
      // rect that grows on first move (no flash of empty viewport).
      setDragRect({ x: e.clientX, y: e.clientY, w: 0, h: 0 });
    }
  }, [bGestureArmedRef, onConsumeBGesture]);

  const onSidebarPointerMove = useCallback((e) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    const dx = e.clientX - sess.startClientX;
    const dy = e.clientY - sess.startClientY;
    if (!sess.isDragging) {
      // 4px threshold — under this is a click, over is a drag.
      if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      sess.isDragging = true;
      // Capture so subsequent move/up events route here even if the
      // pointer exits the container. Browsers cancel capture on pointerup.
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture optional */ }
    }
    const x = Math.min(e.clientX, sess.startClientX);
    const y = Math.min(e.clientY, sess.startClientY);
    const w = Math.abs(e.clientX - sess.startClientX);
    const h = Math.abs(e.clientY - sess.startClientY);
    setDragRect({ x, y, w, h });
  }, []);

  const onSidebarPointerUp = useCallback((e) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    dragSessionRef.current = null;
    if (!sess.isDragging) {
      // Sub-threshold movement — let the row click fire normally.
      setDragRect(null);
      return;
    }
    // Drag finished — set the click-suppression latch BEFORE the
    // synthesized click event fires. The latch is read in the row's
    // onClick handler and cleared there (one-shot semantics).
    wasDragRef.current = true;

    const rect = {
      xmin: Math.min(e.clientX, sess.startClientX),
      ymin: Math.min(e.clientY, sess.startClientY),
      xmax: Math.max(e.clientX, sess.startClientX),
      ymax: Math.max(e.clientY, sess.startClientY),
    };
    setDragRect(null);

    // Hit-test: collect every row's `data-fcurve-id` whose bounding box
    // intersects the drag rect on the Y axis. Matches Blender's
    // `box_select_anim_channels` row-Y-intersection at
    // `anim_channels_edit.cc:3619` (X-axis is full-width by design — the
    // operator is row-based, not pixel-grid based).
    //
    // Audit-fix LOW-2 (Slice 5.Y arch audit 2026-05-17): collapsed-group
    // rows render `null` via the `expanded ? bucket.rows.map(...) : null`
    // ternary, so they have no `[data-fcurve-id]` element in the DOM
    // and are naturally excluded from this `querySelectorAll`. That
    // matches Blender's in-rect-loop filter `ANIMFILTER_LIST_VISIBLE`
    // at `anim_channels_edit.cc:3594` (which also excludes collapsed
    // children). Effectively-hidden rows (`fcurve.hide=true`) DO render
    // in the sidebar with line-through opacity:0.5 for the un-hide
    // affordance, so they ARE in the DOM — but the helper filters them
    // out via `orderedIds` (see `applyChannelBoxSelectOp` MED-1 fix).
    const container = containerRef.current;
    if (!container) return;
    const ids = [];
    const rows = container.querySelectorAll('[data-fcurve-id]');
    for (let i = 0; i < rows.length; i++) {
      const el = /** @type {HTMLElement} */ (rows[i]);
      const r = el.getBoundingClientRect();
      // Y-axis overlap test (matches Blender's row gate).
      if (r.bottom >= rect.ymin && r.top <= rect.ymax) {
        const id = el.dataset.fcurveId;
        if (typeof id === 'string' && id.length > 0) ids.push(id);
      }
    }
    onApplyChannelBoxSelect(ids, sess.modifier);
  }, [onApplyChannelBoxSelect]);

  const onSidebarPointerCancel = useCallback((e) => {
    const sess = dragSessionRef.current;
    if (!sess || sess.pointerId !== e.pointerId) return;
    dragSessionRef.current = null;
    // Don't latch wasDrag — a cancelled drag should NOT suppress the next
    // click (the synthesized click won't fire after pointercancel anyway).
    setDragRect(null);
  }, []);

  // Slice 5.V — bucket rows by groupId in the order they appear in
  // `decoded`. Grouped buckets render first (each with a header
  // showing expand/mute/hide); the ungrouped tail renders flat at
  // the end. Mirrors Blender's Graph Editor channel filter pass
  // `ANIM_animfilter_action_slot` at
  // `reference/blender/source/blender/editors/animation/anim_filter.cc:1585`
  // (the `for (bActionGroup *group : channelbag->channel_groups())`
  // loop at line 1659 emits grouped channels first; the
  // `drop_front(first_ungrouped_fcurve_index)` span at line 1673
  // emits ungrouped fcurves last). Audit-fix Slice 5.V FAB-3
  // (dual-audit 2026-05-17): previous cite named
  // `ANIM_animdata_filter_action_slot` (extra `data` token); the
  // actual function is `ANIM_animfilter_action_slot`.
  //
  // Audit-fix M2 (Slice 5.V dual-audit): when an fcurve's groupId
  // points at a missing group (deleted from the action by some other
  // path while this fcurve still carries the id), `getFCurveGroupById`
  // returns null — the row collapses into the ungrouped tail instead
  // of forming a null-headed bucket. Matches Blender's behavior where
  // a dangling `fcu->grp` would never produce a header (header
  // rendering iterates `channelbag->channel_groups()` directly).
  const buckets = (() => {
    const result = [];
    /** @type {Map<string, {group: any, rows: any[]}>} */
    const byGid = new Map();
    /** @type {any[]} */
    const ungrouped = [];
    for (const row of decoded) {
      const gid = row?.fcurve?.groupId;
      if (typeof gid !== 'string' || gid.length === 0) {
        ungrouped.push(row);
        continue;
      }
      const groupObj = getFCurveGroupById(action, gid);
      if (!groupObj) {
        // Dangling groupId → render as ungrouped.
        ungrouped.push(row);
        continue;
      }
      let bucket = byGid.get(gid);
      if (!bucket) {
        bucket = { group: groupObj, rows: [] };
        byGid.set(gid, bucket);
        result.push(bucket);
      }
      bucket.rows.push(row);
    }
    if (ungrouped.length > 0) {
      result.push({ group: null, rows: ungrouped });
    }
    return result;
  })();

  return (
    <div
      ref={containerRef}
      className={
        'relative border-r border-border bg-card/50 overflow-y-auto flex-shrink-0 '
        + (bGestureArmed ? 'cursor-crosshair' : '')
      }
      style={{ width: SIDEBAR_W }}
      onPointerEnter={onSidebarEnter}
      onPointerLeave={onSidebarLeave}
      onPointerDown={onSidebarPointerDown}
      onPointerMove={onSidebarPointerMove}
      onPointerUp={onSidebarPointerUp}
      onPointerCancel={onSidebarPointerCancel}
    >
      {/* Slice 5.FF — armed-mode hint banner. Mirrors Blender's
          status-bar text shown during a WM_GESTURE_CROSS_RECT modal
          (see `wm_gesture_ops.cc:194-...` modal handler). SS surfaces
          it as a small inline banner at the top of the sidebar so
          the user knows the next LMB-click-drag will define the
          rect (and that Escape cancels). */}
      {bGestureArmed ? (
        <div
          className="px-2 py-1 text-[10px] bg-amber-300/20 border-b border-amber-300/40 text-amber-100"
          aria-live="polite"
        >
          Box-select armed — drag to define rect, Esc to cancel
        </div>
      ) : null}
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border flex items-center justify-between">
        <span>F-Curves ({decoded.length})</span>
        {/* Slice 5.K — bulk channel select-all triplet. Mirrors Blender's
            three keymap entries (`blender_default.py:3864` →
            `_template_items_select_actions`). Keep the buttons even
            though the keymap exists: discoverable for users not in the
            habit of Blender keybinds + works without sidebar-hover. */}
        <span className="flex items-center gap-0.5">
          <button
            type="button"
            className="px-1 py-0.5 text-[9px] uppercase tracking-tight rounded hover:bg-accent/60 hover:text-foreground"
            onClick={() => onSelectAll('toggle')}
            title="Toggle select all channels (A)"
            aria-label="Toggle select all channels"
          >
            All
          </button>
          <button
            type="button"
            className="px-1 py-0.5 text-[9px] uppercase tracking-tight rounded hover:bg-accent/60 hover:text-foreground"
            onClick={() => onSelectAll('clear')}
            title="Deselect all channels (Alt+A)"
            aria-label="Deselect all channels"
          >
            None
          </button>
          <button
            type="button"
            className="px-1 py-0.5 text-[9px] uppercase tracking-tight rounded hover:bg-accent/60 hover:text-foreground"
            onClick={() => onSelectAll('invert')}
            title="Invert channel selection (Ctrl+I)"
            aria-label="Invert channel selection"
          >
            Inv
          </button>
        </span>
      </div>
      {buckets.map((bucket) => {
        // Slice 5.V — render group header + (conditionally) child rows.
        // Ungrouped tail bucket has no header and always renders.
        // groupMuted / groupHidden are read here once per bucket so the
        // per-row icons can cascade visually (the row STILL toggles its
        // own bit; the cascade is purely "this curve is now silenced
        // because its parent is, even though its own bit is off").
        const group = bucket.group;
        const expanded = group ? isFCurveGroupExpanded(group) : true;
        const groupMuted = isFCurveGroupMuted(group);
        const groupHidden = isFCurveGroupHidden(group);
        // Slice 5.LL (Path #50) — sidebar surfacing of AGRP_ACTIVE +
        // AGRP_SELECTED. 3-tier backdrop tint mirrors the per-fcurve
        // row convention (Slice 5.F audit-fix MED-B2: SS extension —
        // Blender's `acf_generic_channel_color` is selection-agnostic
        // backdrop, flips only text color; SS adds backdrop tint so
        // selection/active state is visible at a glance):
        //   - active                 → bg-accent/60 (strongest)
        //   - selected-non-active    → bg-accent/25 (medium)
        //   - default                → bg-muted/40 (the existing tint)
        //
        // Audit-fix arch MED-1 (Slice 5.LL dual-audit 2026-05-18):
        // backdrop and text-color are computed INDEPENDENTLY (not
        // co-mingled in one ternary) so the className string never
        // emits two competing `text-*` classes. Text-color precedence
        // is muted > active/selected > default — muted wins because
        // an evaluated-off group should read as dim regardless of
        // selection state (matches Blender's italic-strikethrough on
        // muted channels).
        const groupActive = isFCurveGroupActive(group);
        const groupSelected = isFCurveGroupSelected(group);
        const groupBackdrop = groupActive
          ? 'bg-accent/60 '
          : groupSelected
            ? 'bg-accent/25 '
            : 'bg-muted/40 ';
        const groupTextColor = groupMuted
          ? 'text-muted-foreground/70 italic '
          : (groupActive || groupSelected)
            ? 'text-foreground '
            : 'text-muted-foreground ';
        const headerKey = group?.id ?? '__ungrouped__';
        return (
          <div key={headerKey}>
            {group ? (
              <div
                className={
                  'flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wide '
                  + groupBackdrop
                  + groupTextColor
                  + 'border-b border-border/60 select-none '
                  + (groupHidden ? 'opacity-60 ' : '')
                }
              >
                <button
                  type="button"
                  className="w-3 h-3 flex items-center justify-center text-[9px] hover:text-foreground"
                  onClick={() => onToggleGroupExpanded(group.id)}
                  title={expanded ? 'Collapse group' : 'Expand group'}
                  aria-label={expanded ? 'Collapse group' : 'Expand group'}
                >
                  {expanded ? '▾' : '▸'}
                </button>
                <button
                  type="button"
                  className="w-4 h-4 flex items-center justify-center text-[10px] hover:text-foreground"
                  onClick={() => onToggleGroupHide(group.id)}
                  title={groupHidden ? 'Show group' : 'Hide group'}
                  aria-label={groupHidden ? 'Show group' : 'Hide group'}
                >
                  {groupHidden ? '○' : '●'}
                </button>
                <button
                  type="button"
                  className={
                    'w-4 h-4 flex items-center justify-center text-[11px] leading-none '
                    + (groupMuted ? 'text-muted-foreground/80' : 'text-muted-foreground/40 hover:text-foreground')
                  }
                  onClick={() => onToggleGroupMute(group.id)}
                  title={groupMuted ? 'Unmute group (resume evaluation of all curves)' : 'Mute group (skip evaluation of all curves)'}
                  aria-label={groupMuted ? 'Unmute group' : 'Mute group'}
                >
                  {groupMuted ? '\u{1F507}' : '\u{1F50A}'}
                </button>
                {/* Slice 5.KK (Path #49) — full modifier surface for
                    group-header clicks. Mirrors Blender's
                    `click_select_channel_group` non-children branches
                    at `reference/blender/source/blender/editors/animation/anim_channels_edit.cc:4154-4189`
                    (function defined `:4120-4221`; reached via
                    `animchannels_mouseclick_invoke` `:4614-4670` →
                    `mouse_anim_channels` `:4475-4604` → per-type
                    switch `:4526-4593`) and bound at
                    `blender_default.py:3848-3854`:

                      - **Plain LMB** → SELECT_REPLACE (`:4181-4189`):
                        pre-clear visible-scope fcurves' `selected`,
                        clear active-fcurve in scope, clear OTHER
                        groups' `selected`, set clicked group's
                        `selected = true`.
                      - **Ctrl+LMB** → SELECT_INVERT (`:4155-4158`):
                        XOR clicked group's `selected`; nothing else
                        touched.
                      - **Shift+LMB** → SELECT_EXTEND_RANGE
                        (`:4159-4162`): shipped Slice 5.MM (Path #58)
                        via the helper's 'range' modifier. Walks
                        groups between the active group and the
                        clicked group; auto-downgrades to 'toggle'
                        when no group is active.
                      - **Shift+Ctrl+LMB** → `children_only` = -1
                        (`:4163-4180`): shipped in Slice 5.BB.

                    Modifier-precedence ordering matters: Shift+Ctrl
                    MUST resolve first so the children_only branch
                    doesn't fall through to either of the single-
                    modifier branches. */}
                <span
                  className="truncate flex-1 font-semibold cursor-pointer hover:text-foreground"
                  title="Click to select; Ctrl to toggle; Shift+Ctrl to select all children"
                  onClick={(e) => {
                    // Audit-fix LOW-1 (Slice 5.BB arch audit 2026-05-17):
                    // honor `wasDragRef` latch from the Sidebar drag-rect
                    // FSM (Slice 5.Y). Without this, a drag that started
                    // on the group header span and released elsewhere
                    // would leak its `wasDragRef = true` past a synthesized
                    // click on this span (which has no other gate),
                    // potentially suppressing the next legitimate
                    // keyboard-initiated row click.
                    if (wasDragRef.current) { wasDragRef.current = false; return; }
                    if (e.altKey) return;  // Alt unbound for group headers
                    const ctrlOrMeta = e.ctrlKey || e.metaKey;
                    if (e.shiftKey && ctrlOrMeta) {
                      // Shift+Ctrl → children_only (Slice 5.BB)
                      onApplyGroupChildrenSelect(group.id);
                      return;
                    }
                    if (e.shiftKey) {
                      // Shift alone → SELECT_EXTEND_RANGE (Slice 5.MM).
                      // Helper auto-downgrades to 'toggle' when no
                      // active group exists (matches Blender's
                      // `:4517-4522` type-agnostic downgrade).
                      onApplyGroupHeaderSelect(group.id, 'range');
                      return;
                    }
                    if (ctrlOrMeta) {
                      // Ctrl+click → SELECT_INVERT (toggle)
                      onApplyGroupHeaderSelect(group.id, 'toggle');
                      return;
                    }
                    // Plain click → SELECT_REPLACE
                    onApplyGroupHeaderSelect(group.id, 'replace');
                  }}
                >
                  {group.name}
                </span>
                <span className="text-[9px] font-mono opacity-60">{bucket.rows.length}</span>
              </div>
            ) : null}
            {expanded ? bucket.rows.map((d) => {
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
        // Slice 5.V — indent grouped rows so the group header
        // visually parents them. Ungrouped rows keep `px-2`.
        const inGroup = typeof d.fcurve.groupId === 'string' && d.fcurve.groupId.length > 0;
        return (
          <div
            key={d.fcurve.id}
            data-fcurve-id={d.fcurve.id}
            className={
              'group flex items-center gap-1 py-1 text-xs cursor-pointer hover:bg-accent/40 '
              + (inGroup ? 'pl-5 pr-2 ' : 'px-2 ')
              + rowTint
            }
            onClick={(e) => {
              // Slice 5.Y — click-suppression latch. When the user
              // finishes a drag-rect, the browser still synthesizes a
              // click event on the row landed on; bail here so the click
              // doesn't double-fire with the box-select.
              if (wasDragRef.current) { wasDragRef.current = false; return; }
              const t = decodeFCurveTarget(d.fcurve);
              if (!t) return;
              // Modifier mapping mirrors Blender's animation-channels
              // keymap at
              // `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:3849-3854`
              // (identical in `industry_compatible_data.py:2329-2334`):
              //
              //   - **Shift+click → extend_range** (SELECT_EXTEND_RANGE,
              //     range walker — Slice 5.J). Walks the visible channel
              //     list from active through clicked, inclusive.
              //   - **Ctrl+click → extend** (SELECT_INVERT, toggle —
              //     Slice 5.F. Audit-fix HIGH-B1 (Slice 5.J dual-audit
              //     2026-05-17): Slice 5.F's original wiring put Shift
              //     on toggle, which inverted Blender's mapping; this
              //     is the corrected mapping.). XORs only the clicked
              //     curve's `selected`.
              //   - **Plain click → replace** (SELECT_REPLACE). Clears
              //     every other curve's `selected`.
              //
              // Blender source citations: walker at
              // `anim_channels_edit.cc:3984-4025`; per-modifier dispatch
              // at lines 4231-4243; active-elevation gate at line 4247
              // (range never elevates); auto-downgrade at lines 4517-4522.
              //
              // Slice 5.BB — Shift+Ctrl+click on an fcurve row now
              // dispatches `applyGroupChildrenSelect` against the
              // fcurve's parent group (SS extension over Blender's
              // group-header-only behavior, see fcurveChannelSelect.js
              // Deviation 1). Ungrouped fcurves no-op (no parent group
              // to dispatch against). Closure of the queued-from-5.V
              // comment that previously suggested
              // `e.shiftKey && !e.ctrlKey + explicit Shift+Ctrl arm`.
              //
              // Modifier resolution (post-5.BB):
              //   - Shift+Ctrl (no alt)   → children_only (5.BB)
              //   - Shift (no ctrl/meta)  → 'range' (5.J)
              //   - Ctrl or Meta (no shift) → 'toggle' (5.F)
              //   - neither               → 'replace' (5.F)
              //
              // Other documented bindings:
              //   - Plain-click also wipes keyform selection on other
              //     channels (SS UX extension; audit-fix MED-B3
              //     2026-05-16, Slice 5.F dual-audit). Blender's
              //     `click_select_channel_fcurve` doesn't touch
              //     keyforms; SS treats plain-click as "switch
              //     context, drop the previous keyform picks";
              //     Shift/Ctrl-click preserves the selection for
              //     cross-channel composition.
              const isChildrenOnly = (e.shiftKey && (e.ctrlKey || e.metaKey) && !e.altKey);
              if (isChildrenOnly) {
                const gid = typeof d.fcurve.groupId === 'string' && d.fcurve.groupId.length > 0
                  ? d.fcurve.groupId
                  : null;
                if (gid !== null) onApplyGroupChildrenSelect(gid);
                // Ungrouped fcurves: no-op per Blender's
                // `anim_channels_edit.cc:4511-4515` early-return for
                // non-group channels.
                return;
              }
              const modifier = e.shiftKey
                ? 'range'
                : (e.ctrlKey || e.metaKey)
                  ? 'toggle'
                  : 'replace';
              const ctx = modifier === 'range'
                ? { activeFCurveId, orderedIds: decoded.map((x) => x.fcurve.id) }
                : undefined;
              const decision = onApplyChannelClick(d.fcurve.id, modifier, ctx);
              // Audit-fix MED-A1 (Slice 5.F): gate clear on
              // `decision.selectedNow`. Without it, a click on a curve
              // whose action lookup races to null silently wipes the
              // user's keyform selection for no other effect. Only the
              // plain replace-click wipes — range + toggle preserve
              // keyforms (cross-channel composition intent).
              if (modifier === 'replace' && decision.selectedNow) onClearKeyformSelection();
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
      }) : null}
          </div>
        );
      })}
      {/* Slice 5.Y — drag-rect marquee. Fixed positioning + client coords
          (the drag rect is captured in client space; mirrors the way
          Blender's `WM_gesture_box_modal` paints the gesture overlay in
          window-space, not view-space). z-30 keeps it above the row hover
          tint but below absolutely-positioned modals. `pointer-events:none`
          so the user's pointer never lands on the overlay itself. */}
      {dragRect ? (
        <div
          aria-hidden
          className="fixed pointer-events-none z-30 border border-amber-300/80 bg-amber-300/20"
          style={{
            left: dragRect.x,
            top: dragRect.y,
            width: dragRect.w,
            height: dragRect.h,
          }}
        />
      ) : null}
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

function ModalHUD({ kind, axis, typedBuffer, numericMode, showSeconds = false }) {
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
  // Unit suffix tracks the View menu's "Use Timecode" toggle
  // (`fcurveShowSeconds` / Blender's `SIPO_DRAWTIME` at
  // `reference/blender/source/blender/editors/transform/transform_mode_translate.cc:606-608`
  // — `display_seconds = (sipo->mode == SIPO_MODE_ANIMATION) && (sipo->flag & SIPO_DRAWTIME)`).
  // When seconds mode is active the X-axis displays "0.5s" and typed-G
  // is interpreted as seconds; suffix is 's'. When off (default), X
  // displays frame numbers and typed-G is frames; suffix is 'f'. Y axis
  // is raw value (no unit). Scale is unitless multiplier.
  // Closed Slice 5.T MED-B1 (was: "deferred until SIPO_DRAWTIME toggle
  // ships").
  const unit = kind === 's' ? '×' : (axis === 'y' ? '' : (showSeconds ? 's' : 'f'));
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

// Slice 5.W audit-fix: extracted to `src/anim/fcurvePicker.js` so
// DopesheetEditor can gate its active-keyform halo on the same fcurve.
// `pickFCurve` is now an alias kept for in-file call sites.
const pickFCurve = pickActiveFCurve;

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
    // mesh_verts channels carry per-vertex `[{x,y},...]` values — there is
    // no scalar value-axis to plot or drag in the Graph Editor (Live2D-
    // specific, no Blender analog). They live in the Dopesheet (time
    // domain). Excluding them here keeps the value-domain editor scalar-
    // only and prevents an unplottable sidebar row.
    if (target.kind === 'node' && target.property === 'mesh_verts') continue;
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
