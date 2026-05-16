// @ts-check

/**
 * Footer / status-bar formatter — Audit 4 #1 (2026-05-16).
 *
 * Pure data module backing `Footer.jsx` (sister architecture to
 * `canvasContextMenuItems.js` ↔ `CanvasContextMenu.jsx` from Round 5).
 * Kept `.js` (not `.jsx`) so the Node integrity test can import the
 * formatters without a JSX transpiler — Node's ESM loader rejects
 * `.jsx` directly.
 *
 * Mirrors Blender's `STATUSBAR_HT_header.draw` (`reference/blender/
 * scripts/startup/bl_ui/space_statusbar.py:8-31`) which composes
 * three templates left-to-right with `separator_spacer()` between:
 *
 *   1. `template_input_status()`     — active modal operator's key hints
 *   2. `template_reports_banner()`   — recent warn/error messages
 *      `template_running_jobs()`     — progress bar for background jobs
 *   3. `template_status_info()`      — selection + scene stats
 *
 * SS analogs surfaced this round (with deviations called out per
 * `feedback_blender_reference_strict.md` — Blender source IS the
 * source of truth, deviations must be honest, not silent):
 *
 *   - `formatInputStatus(...)`  ↔ template_input_status — Blender's
 *     `uiTemplateInputStatus` (`reference/blender/source/blender/
 *     editors/interface/interface_template_status.cc:267-375`)
 *     shows TWO things depending on cursor-area context: (a) when
 *     a modal operator is running, the operator's modal keymap
 *     hint row; (b) when no modal is running, the active editor
 *     area's cursor-region LMB/MMB/RMB keymap labels (e.g. "Click:
 *     Select | Drag: Box Select | Click: Tweak"). SS surfaces only
 *     the modal path here + falls back to a mode label when no
 *     modal — SS has no cursor-region/area-zone keymap primitive,
 *     so the non-modal cursor-keymap row is deliberately omitted.
 *     Documented deviation, not silent gap.
 *   - `countReports(entries)`   ↔ template_reports_banner — Blender's
 *     `uiTemplateReportsBanner` (`interface_template_status.cc:45-151`)
 *     shows ONLY the most-recent report as a timed fade-out banner
 *     (`reports->reporttimer` drives the fade; auto-hides when the
 *     timer expires). There is no per-report dismiss UI; the whole
 *     banner just vanishes after a few seconds. SS surfaces an
 *     aggregate warn/error pill count across the full logsStore ring
 *     buffer instead — permanent visibility rather than transient
 *     flash. Trade-off: SS misses Blender's single-message text
 *     surface (the user has to open the Logs editor to read text);
 *     Blender misses SS's "how many errors total" affordance. Both
 *     justifiable; SS's choice favors a smaller status bar without
 *     a fade animation primitive in the design system.
 *     Running-jobs progress bar (`template_running_jobs`) is also
 *     omitted: SS has no unified background-job system today (PSD
 *     wizard owns its own full-screen chrome; export modal stays
 *     open during work). Surfacing a single-line "PSD import 47%"
 *     would be a Rule №1 stub.
 *   - `formatStats(...)`        ↔ template_status_info — Blender's
 *     `uiTemplateStatusInfo` (`interface_template_status.cc:408-622`,
 *     dispatcher into `ED_info_statusbar_string_ex`) shows SCENE-LEVEL
 *     stats: vertex/edge/face/tri counts (total + selected), memory
 *     usage, scene duration, Blender version — all configurable via
 *     `U.statusbar_flag`. SS surfaces OBJECT-SELECTION-LEVEL info
 *     instead ("1 selected · Mesh · 142 verts") — SS has no scene
 *     stats concept (no aggregate vert / face counts roll up to the
 *     project today; rigPipeline could synthesize but that's
 *     out-of-scope plumbing). Deviation: different layer of
 *     granularity, same screen slot.
 *
 * Per Rule №1 — no quick-and-dirty fixes — every output is derived
 * from a live store slot; no fallback text papers over a missing
 * source. Empty selection renders "0 selected", not "(no selection)".
 *
 * @module v3/shell/footerStatusData
 */

/** @typedef {('translate'|'rotate'|'scale'|null)} ModalKind
 *  @typedef {('x'|'y'|null)} AxisLock
 *  @typedef {{dx:number, dy:number, dRot:number, scale:number}} LiveDelta */

/**
 * Mode → human label. Mirrors Blender's mode names from
 * `DNA_object_enums.h` / `space_view3d.py` mode dropdowns:
 *
 *   - null        → 'Object Mode'   (`OB_MODE_OBJECT`)
 *   - 'edit'      → 'Edit Mode'     (`OB_MODE_EDIT`; SS appends dataKind
 *                                     so the bar disambiguates Mesh vs
 *                                     Armature without the user opening
 *                                     the Properties Object tab)
 *   - 'pose'      → 'Pose Mode'     (`OB_MODE_POSE`)
 *   - 'weightPaint' → 'Weight Paint' (`OB_MODE_WEIGHT_PAINT`)
 *
 *  Blender additionally has SCULPT / TEXTURE_PAINT / VERTEX_PAINT /
 *  PARTICLE_EDIT but SS doesn't expose those modes (sculpt is a
 *  workspace preset that stays in Object Mode + Sculpt tool today).
 *
 * @param {string|null|undefined} editMode
 * @param {string|null|undefined} dataKind  Edit Mode only — 'mesh' |
 *                                          'armature' | 'empty' |
 *                                          'deformer'.
 * @returns {string}
 */
export function modeLabel(editMode, dataKind) {
  if (editMode === 'pose')        return 'Pose Mode';
  if (editMode === 'weightPaint') return 'Weight Paint';
  if (editMode === 'edit') {
    if (dataKind === 'armature') return 'Edit Mode (Armature)';
    if (dataKind === 'mesh')     return 'Edit Mode (Mesh)';
    return 'Edit Mode';
  }
  return 'Object Mode';
}

/**
 * Format a live delta for the modal HUD echo. Mirrors what
 * `ModalTransformOverlay` shows on the canvas (the floating HUD by
 * the cursor) — surfacing it in the footer too so the user can read
 * the precise value while their eyes are on the modal's key hints.
 *
 * Format rules (Blender HUD parity, `interface_modal_keymap.cc`):
 *   - translate, no axis  → "12.5, -8.0 px"
 *   - translate, X locked → "X: 12.5 px"
 *   - translate, Y locked → "Y: -8.0 px"
 *   - rotate              → "45.0°"   (no axis qualifier; SS rotates Z-only)
 *   - scale, no axis      → "1.25×"
 *   - scale, X locked     → "X: 1.25×"
 *   - scale, Y locked     → "Y: 1.25×"
 *
 * @param {ModalKind} kind
 * @param {AxisLock} axis
 * @param {LiveDelta} delta
 * @returns {string}
 */
function formatLiveDelta(kind, axis, delta) {
  if (kind === 'translate') {
    if (axis === 'x') return `X: ${delta.dx.toFixed(1)} px`;
    if (axis === 'y') return `Y: ${delta.dy.toFixed(1)} px`;
    return `${delta.dx.toFixed(1)}, ${delta.dy.toFixed(1)} px`;
  }
  if (kind === 'rotate') {
    const deg = (delta.dRot * 180) / Math.PI;
    return `${deg.toFixed(1)}°`;
  }
  if (kind === 'scale') {
    if (axis === 'x') return `X: ${delta.scale.toFixed(3)}×`;
    if (axis === 'y') return `Y: ${delta.scale.toFixed(3)}×`;
    return `${delta.scale.toFixed(3)}×`;
  }
  return '';
}

/** Per-modal-kind keybind shortcut shown ahead of the live delta.
 *  Mirrors Blender's gesture-launch shortcut so users learning the
 *  bindings see "G — Move" reinforced on every modal entry.
 *
 *  @param {ModalKind} kind @returns {string} */
function modalKindLabel(kind) {
  if (kind === 'translate') return 'G — Move';
  if (kind === 'rotate')    return 'R — Rotate';
  if (kind === 'scale')     return 'S — Scale';
  return '';
}

/**
 * Compose the input-status string for the footer's left section.
 *
 * Dispatch priority (matches Blender's "active modal takes over the
 * input-status line" pattern — a running TRANSFORM_OT_translate
 * blocks the default keymap status):
 *
 *   1. Vertex modal active   → "G — Move Vertices · X: 12.5 px"
 *   2. Node modal active     → "G — Move · X: 12.5 px"
 *   3. Numeric type-in mode  → "G — Move · [ 12.5 ]"   (typed buffer)
 *   4. Fallback              → "<Mode Label>"          (no modal)
 *
 * Numeric mode (`numericMode === true` on the node modal — Blender's
 * `NUM_EDIT_FULL` flag, declared at `editors/util/numinput.cc:51` and
 * triggered by digit entry at `:355-365`; the `=`/`*` keyboard-toggle
 * fallback is at `:367-380`) replaces the live-delta render with the
 * typed buffer so the user sees their keystrokes accumulate. Empty
 * buffer in numeric mode shows `[ 0 ]` (translate / rotate) or `[ 1 ]`
 * (scale), matching the held-value default Blender uses when the
 * buffer is empty.
 *
 * @param {{
 *   modal?:       {kind: ModalKind, axis: AxisLock, typedBuffer?: string, numericMode?: boolean, liveDelta?: LiveDelta},
 *   vertexModal?: {kind: ('translate'|null), axis: AxisLock, typedBuffer?: string},
 *   editMode?:    string|null,
 *   dataKind?:    string|null,
 * }} input
 * @returns {string}
 */
export function formatInputStatus(input) {
  const vKind = input.vertexModal?.kind ?? null;
  if (vKind === 'translate') {
    const axis = input.vertexModal?.axis ?? null;
    const typed = input.vertexModal?.typedBuffer ?? '';
    const axisLabel = axis === 'x' ? 'X: ' : axis === 'y' ? 'Y: ' : '';
    const valueText = typed.length > 0
      ? `[ ${typed} ]`
      : `${axisLabel}…`;
    return `G — Move Vertices · ${valueText}`;
  }

  const mKind = input.modal?.kind ?? null;
  if (mKind) {
    const label = modalKindLabel(mKind);
    const axis = input.modal?.axis ?? null;
    const typed = input.modal?.typedBuffer ?? '';
    if (input.modal?.numericMode || typed.length > 0) {
      const axisLabel = axis === 'x' ? 'X: ' : axis === 'y' ? 'Y: ' : '';
      const shown = typed.length > 0
        ? typed
        : (mKind === 'scale' ? '1' : '0');
      return `${label} · ${axisLabel}[ ${shown} ]`;
    }
    const delta = input.modal?.liveDelta
      ?? { dx: 0, dy: 0, dRot: 0, scale: 1 };
    return `${label} · ${formatLiveDelta(mKind, axis, delta)}`;
  }

  return modeLabel(input.editMode ?? null, input.dataKind ?? null);
}

/**
 * Count warn + error entries in the in-app logs ring buffer.
 * Surfaces as a "⚠ 3 · ⛔ 1" badge in the footer's right section so
 * users notice errors without opening the Logs editor.
 *
 * NOTE — no acknowledgement / dismissal tracking. Blender's
 * `template_reports_banner` carries per-report dismiss via
 * `WM_report_banner_show_pending` but the underlying ringbuffer
 * (`reports.reports` list) drives the count. SS mirrors the latter:
 * counts reflect the current logsStore contents (cap 500, FIFO eviction).
 * Clearing the Logs panel zeros both counts. A dismiss model would
 * need its own dedicated store + persisted ack ids; out of scope for
 * the first cut and would be a Rule №1 stub if half-implemented.
 *
 * @param {ReadonlyArray<{level: string}>|null|undefined} entries
 * @returns {{ warn: number, error: number }}
 */
export function countReports(entries) {
  if (!entries || entries.length === 0) return { warn: 0, error: 0 };
  let warn = 0, error = 0;
  for (const entry of entries) {
    if (entry.level === 'warn')  warn++;
    else if (entry.level === 'error') error++;
  }
  return { warn, error };
}

/**
 * Compose the stats string for the footer's right section.
 *
 * Layout decisions:
 *
 *   - Empty selection           → "0 selected"
 *   - Single selection          → "1 selected · <DataKind label>"
 *     ('Mesh' / 'Armature' / 'Group' / 'Deformer'; Blender's
 *      `template_status_info` shows similar "Collection | Mesh" style.)
 *   - Multi selection           → "{n} selected"
 *     (DataKind ambiguous across multi-selection; Blender shows the
 *      active object's data + a count — SS's simpler "{n} selected"
 *      avoids the active-object distinction this round since
 *      `editorStore.selection[0]` is the only "active head" concept.)
 *   - Edit Mode + vertex selection
 *                               → above + " · {n} verts"
 *     when `vertexSelectionCount > 0`. Mirrors Blender's
 *     `template_edit_mode_stats` (counts verts / edges / faces in
 *     the edit-mesh footer — SS only has vertex topology today).
 *
 * @param {{
 *   selectionCount: number,
 *   editMode?: string|null,
 *   headDataKind?: string|null,
 *   vertexSelectionCount?: number,
 * }} input
 * @returns {string}
 */
export function formatStats(input) {
  const n = input.selectionCount ?? 0;
  const baseText = n === 0
    ? '0 selected'
    : n === 1
      ? `1 selected · ${dataKindToLabel(input.headDataKind ?? null)}`
      : `${n} selected`;

  if (input.editMode === 'edit' && (input.vertexSelectionCount ?? 0) > 0) {
    const v = input.vertexSelectionCount ?? 0;
    return `${baseText} · ${v} vert${v === 1 ? '' : 's'}`;
  }
  return baseText;
}

/** dataKind → display label. Labels chosen to match Blender's
 *  object-data dropdown names (`space_properties.py` Object Data
 *  Properties tab). Note: Blender's `template_status_info` does NOT
 *  format selection as `"<n> selected · <DataKind>"` — that surface
 *  doesn't exist in Blender; the status bar shows scene vert/edge/
 *  face counts instead. SS surfaces selection-level data here as a
 *  deliberate deviation (SS lacks scene-stats plumbing today; the
 *  selection count + active dataKind is the most useful info SS can
 *  give the user in the same screen slot).
 *
 *  - 'mesh'     → 'Mesh'      (Object.data of type MESH)
 *  - 'armature' → 'Armature'  (Object.data of type ARMATURE)
 *  - 'empty'    → 'Group'     (SS-specific; Blender's analog is
 *                              `OB_EMPTY` + Collection; SS surfaces
 *                              `node.type === 'group'` as Group which
 *                              is closer to a Collection than an Empty.
 *                              Deliberate deviation: SS Groups carry
 *                              children + their own transform like
 *                              Blender Collections, not the
 *                              transform-only invisibles Blender uses
 *                              for Empties.)
 *  - 'deformer' → 'Deformer'  (SS-specific; Live2D-derived. Closest
 *                              Blender analog is a Modifier datablock
 *                              owned by the parent Object; SS surfaces
 *                              deformers as standalone nodes per the
 *                              BFA-006 refactor.)
 *
 *  @param {string|null} kind @returns {string} */
function dataKindToLabel(kind) {
  if (kind === 'mesh')     return 'Mesh';
  if (kind === 'armature') return 'Armature';
  if (kind === 'empty')    return 'Group';
  if (kind === 'deformer') return 'Deformer';
  return 'Unknown';
}
