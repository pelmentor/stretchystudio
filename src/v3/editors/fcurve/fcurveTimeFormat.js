// @ts-check

/**
 * Animation Phase 5 Slice 5.T — F-Curve editor time display formatters.
 *
 * Pure conversion layer between SS's ms-canonical animation substrate
 * (`feedback_ms_canonical_animation_time`) and the F-Curve editor's
 * user-facing time display (X-axis ticks + N-panel Time field rows).
 * Sister module to `lib/timeMath.js` (raw ms↔frame math) — this module
 * adds the display + label + parse-back layer the editor needs.
 *
 * # The Blender flag this module backs
 *
 * Blender's Graph Editor reads `sipo->flag & SIPO_DRAWTIME`
 * (`reference/blender/source/blender/makesdna/DNA_space_enums.h:293`,
 * comment "show timing in seconds instead of frames"), surfaced as the
 * `show_seconds` RNA property at
 * `reference/blender/source/blender/makesrna/intern/rna_space.cc:7218-7221`
 * with label "Use Timecode" and tooltip "Show timing as a timecode
 * instead of frames". The flag toggles the X-axis grid between frame
 * numbers and timecode (`reference/blender/source/blender/editors/space_graph/space_graph.cc:242`
 * — `display_seconds = (sipo->mode == SIPO_MODE_ANIMATION) && (sipo->flag & SIPO_DRAWTIME)`,
 * passed to `ui::view2d_draw_lines_x_frames`).
 *
 * SS stores the flag at `editorStore.fcurveShowSeconds` (boolean, not
 * a bit) — see [[feedback_ms_canonical_animation_time]].
 *
 * # SS deviations from Blender
 *
 * **Deviation 1 — toggle applies uniformly across mode boundary.**
 * Blender disables `display_seconds` in `SIPO_MODE_DRIVERS` because the
 * driver editor's X-axis is the driver input value, not time
 * (`space_graph.cc:242`). SS merged the drivers and animation editors
 * into one surface in Slice 5.D (DriverBanner overlay instead of a mode
 * switch), so there is no `SIPO_MODE_DRIVERS` to gate against. The
 * toggle applies uniformly. Closure condition: Phase 5 path #6 (driver
 * variable list / expression editor) is the slice that would split
 * drivers back into a separate surface; at that point this formatter
 * would gain a `mode` parameter and the drivers surface would short-
 * circuit to a value-axis formatter.
 *
 * **Deviation 2 — input parse is symmetric with display.**
 * Blender's Key Frame field at `graph_buttons.cc:443-457` always
 * stores frame numbers — `show_seconds` only affects the X-axis grid
 * labels, not the field value. SS's N-panel field accepts whatever the
 * user sees: frame integers when `showSeconds === false`, decimal
 * seconds when `showSeconds === true`. Rationale: SS's canonical
 * storage is ms (not frames), so the field already needs a unit-aware
 * label ("Frame" vs "Time (s)") to be meaningful; once the label
 * shifts, accepting the matching unit at parse-time is the only
 * intuitive behaviour. Closure condition: none — the field would have
 * to gain a fixed "always frames" mode to match Blender exactly, which
 * would re-introduce the unit drift the toggle exists to fix.
 *
 * **Deviation 3 — X-axis tick format is decimal seconds, not a
 * full Blender timecode.** When Blender's `display_seconds` path is
 * active the grid calls `BLI_timecode_string_from_time` at
 * `reference/blender/source/blender/editors/interface/view2d/view2d_draw.cc:425`
 * which formats the time according to `U.timecode_style`
 * (e.g. MINIMAL `"0:00.5"`, SMPTE-full `"00:00:00,500"`, SECONDS_ONLY
 * `"0.5"` — see `reference/blender/source/blender/blenlib/intern/timecode.cc:149-158`).
 * SS has no user-preference system for timecode style today, so
 * `formatXTickLabel` always renders bare decimal seconds with an "s"
 * suffix (e.g. `"0.5s"`). The closest Blender style,
 * `USER_TIMECODE_SECONDS_ONLY`, produces `"0.5"` without the "s"
 * suffix — so even the closest match isn't byte-identical. The "s"
 * suffix is preserved because SS's prior pre-toggle behaviour already
 * used it (deviation against itself avoided). Closure condition: a
 * `User.timecode_style` preference port + a `BLI_timecode_string_from_time`
 * formatter port — out of scope for 5.T; the RNA prop label
 * "Use Timecode" remains accurate as a binary-on/off semantic match.
 *
 * # Rule №1 + Rule №2 compliance
 *
 * No silent fallbacks: `getEffectiveFps` returns `null` on bad input
 * so callers can decide whether to skip rendering or error visibly
 * (matches the discipline of `driverEditorData.js`'s preflight pairs).
 * No migration baggage: the prior "Time (ms)" labels are replaced
 * outright, not preserved as a third toggle option — see Slice 5.T
 * close-out doc, "no `ms` mode preserved" decision.
 *
 * @module v3/editors/fcurve/fcurveTimeFormat
 */

import { frameToMs, msToFrame } from '../../../lib/timeMath.js';

/**
 * Resolve the effective FPS for the F-Curve editor. Prefers the active
 * action's per-action `fps` override when set (matches how
 * `PlaybackControls.jsx` reads it for the FPS field); falls back to
 * the global `useAnimationStore.fps`. Returns `null` when neither is
 * a positive finite number — caller decides whether to skip rendering.
 *
 * @param {{fps?: number} | null | undefined} action
 * @param {number | null | undefined} globalFps
 * @returns {number | null}
 */
export function getEffectiveFps(action, globalFps) {
  const fromAction = (action && Number.isFinite(action.fps) && action.fps > 0)
    ? Number(action.fps) : null;
  if (fromAction !== null) return fromAction;
  if (Number.isFinite(globalFps) && /** @type {number} */ (globalFps) > 0) {
    return Number(globalFps);
  }
  return null;
}

/**
 * Format a millisecond time for an X-axis tick label.
 *
 *   - `showSeconds === true` → `"0.5s"` (one-decimal seconds, matches
 *     SS's pre-5.T axis label format — the value the FCurveEditor was
 *     already emitting at the tick layer).
 *   - `showSeconds === false` → `"15"` (frame number, integer — matches
 *     Blender's `ui::view2d_draw_lines_x_frames` integer-tick output
 *     when DRAWTIME is off).
 *
 * Returns the raw ms (rounded integer) as a degenerate fallback when
 * the seconds-off mode has no resolvable FPS — this is the "render
 * SOMETHING rather than crash the axis" path; the View menu's toggle
 * write-side rejects flipping to frames when no action is loaded
 * anyway, but this guards live FPS reads going through transient
 * `null` states.
 *
 * @param {number} ms
 * @param {{ showSeconds: boolean, fps: number | null }} opts
 * @returns {string}
 */
export function formatXTickLabel(ms, opts) {
  if (!Number.isFinite(ms)) return '';
  if (opts.showSeconds) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  if (opts.fps === null || !Number.isFinite(opts.fps) || opts.fps <= 0) {
    return String(Math.round(ms));
  }
  return String(msToFrame(ms, opts.fps));
}

/**
 * Pick the field-row label for the N-panel's Time input. Matches the
 * `formatTimeFieldValue` semantics so the user reads matched
 * units (label "Frame" → integer frame; label "Time (s)" → decimal
 * seconds).
 *
 * Optional `side` prefix supports the Slice 5.R L/R handle rows:
 * `"left"` → "L "; `"right"` → "R "; omit for the centre kf.
 *
 * @param {{ showSeconds: boolean, side?: 'left' | 'right' }} opts
 * @returns {string}
 */
export function formatTimeFieldLabel(opts) {
  const prefix = opts.side === 'left' ? 'L ' : opts.side === 'right' ? 'R ' : '';
  return opts.showSeconds ? `${prefix}Time (s)` : `${prefix}Frame`;
}

/**
 * Convert a canonical ms time into the value shown in the N-panel
 * Time field input. Inverse of `parseTimeFieldValue`.
 *
 *   - `showSeconds === true` → `ms / 1000` (decimal seconds).
 *   - `showSeconds === false` → `msToFrame(ms, fps)` (integer frame
 *     index at the active FPS).
 *
 * Returns the raw ms as a degenerate fallback when frames mode has no
 * resolvable FPS — symmetric with `formatXTickLabel`. The toggle's
 * write-side gate keeps the user out of this branch in practice.
 *
 * @param {number} ms
 * @param {{ showSeconds: boolean, fps: number | null }} opts
 * @returns {number}
 */
export function formatTimeFieldValue(ms, opts) {
  if (!Number.isFinite(ms)) return 0;
  if (opts.showSeconds) return ms / 1000;
  if (opts.fps === null || !Number.isFinite(opts.fps) || opts.fps <= 0) {
    return ms;
  }
  return msToFrame(ms, opts.fps);
}

/**
 * Parse a user-entered value from the N-panel Time field back into
 * canonical ms. Inverse of `formatTimeFieldValue`.
 *
 *   - `showSeconds === true` → `value * 1000` (input is decimal
 *     seconds; result is float ms).
 *   - `showSeconds === false` → `frameToMs(Math.round(value), fps)`
 *     (input is a frame number; rounded to the nearest whole frame
 *     before conversion — mirrors Blender's Key Frame field which is
 *     a `UI_BTYPE_NUM_SLIDER` over a `PROP_INT` and rejects fractional
 *     frames outright; SS rounds-to-nearest instead of rejecting so
 *     typing `12.7` lands cleanly on frame 13's ms boundary). This
 *     keeps display↔parse symmetric: the display-side `msToFrame`
 *     also rounds (`lib/timeMath.js:43`).
 *
 * Returns the input verbatim as a degenerate fallback when frames
 * mode has no resolvable FPS. The toggle gate prevents this in
 * practice (frames mode requires a loaded action which carries fps).
 *
 * @param {number} value
 * @param {{ showSeconds: boolean, fps: number | null }} opts
 * @returns {number}
 */
export function parseTimeFieldValue(value, opts) {
  if (!Number.isFinite(value)) return 0;
  if (opts.showSeconds) return value * 1000;
  if (opts.fps === null || !Number.isFinite(opts.fps) || opts.fps <= 0) {
    return value;
  }
  return frameToMs(Math.round(value), opts.fps);
}
