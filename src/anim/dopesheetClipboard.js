// @ts-check

/**
 * Dopesheet copy/paste ops — Animation Phase 6 Slice 6.E.
 *
 * Pure mutation helpers + module-level clipboard singleton for the
 * Ctrl+C / Ctrl+V gestures in the Dopesheet. Companion to
 * `dopesheetGrab.js` (Slice 6.C, modal grab) + `dopesheetDelDup.js`
 * (Slice 6.D, Del + Shift+D). The keymap-effect wiring lives in
 * `DopesheetEditor.jsx`.
 *
 * # What this slice ports
 *
 * Blender's `ACTION_OT_copy` + `ACTION_OT_paste` operators dispatched
 * from the SpaceAction (Dopesheet) keymap. Reference path:
 *
 *   - **Keymap** at
 *     `reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py:2706-2709`:
 *
 *     ```py
 *     ("action.copy",  {"type": 'C', "value": 'PRESS', "ctrl": True}, None),
 *     ("action.paste", {"type": 'V', "value": 'PRESS', "ctrl": True}, None),
 *     ("action.paste", {"type": 'V', "value": 'PRESS', "shift": True, "ctrl": True},
 *      {"properties": [("flipped", True)]}),
 *     ```
 *
 *     SS binds Ctrl+C → copy and Ctrl+V → paste. The Shift+Ctrl+V
 *     `flipped=True` variant is NOT shipped — see SS DEVIATION 14
 *     below.
 *
 *   - **Copy operator** at
 *     `reference/blender/source/blender/editors/space_action/action_edit.cc:647-660`
 *     (`ACTION_OT_copy`). `actkeys_copy_exec` at `:606-645` dispatches
 *     to `copy_action_keys` at `:521-538` which filters the visible
 *     FCurves via `ANIM_animdata_filter` and delegates to
 *     `copy_animedit_keys` at
 *     `reference/blender/source/blender/editors/animation/keyframes_general.cc:1488-1566`.
 *
 *     The kernel:
 *
 *       1. Resets the module-level singleton at
 *          `keyframes_general.cc:1258` (`KeyframeCopyBuffer *keyframe_copy_buffer = nullptr`)
 *          via `ANIM_fcurves_copybuf_reset` (defn at `:1347-1352`, called
 *          from `copy_animedit_keys` at `:1493`) — frees the old buffer;
 *          allocates a fresh one.
 *       2. Per fcurve: skips if no center-bit-selected bezts
 *          (`ANIM_fcurve_keyframes_loop(..., ANIM_editkeyframes_ok(BEZT_OK_SELECTED_KEY), ...) == 0`
 *          at `:1505-1517` — `ANIM_editkeyframes_ok` resolves
 *          `BEZT_OK_SELECTED_KEY` to a per-bezt predicate that checks
 *          `bezt->f2 & SELECT`, the CENTER bit).
 *       3. Allocates a fresh `FCurve` copy with the original's
 *          `rna_path` + `array_index`, appended to a per-slot channelbag.
 *       4. Per bezt in the source: if center-selected, inserts a deep
 *          copy into the buffer fcurve via `insert_bezt_fcurve(...,
 *          INSERTKEY_OVERWRITE_FULL | INSERTKEY_FAST)` at `:1549`.
 *          Times stored are ABSOLUTE (no offset applied at copy time).
 *       5. Tracks min/max copied frame in `keyframe_copy_buffer->first_frame`
 *          / `last_frame` at `:1553-1554` (initialized to `+infinity` /
 *          `-infinity` per `keyframes_general_intern.hh:95-96`). These
 *          drive the default `CFRA_START` paste-offset mode.
 *       6. Records `current_frame = ac->scene->r.cfra` at `:1558` —
 *          the playhead at copy time. Used only by `OFFSET_CFRA_RELATIVE`
 *          (SS deviates: see DEV 13 below).
 *
 *     SS mirrors steps 1-6 in `copyKeyformsToClipboard` below. The
 *     SS clipboard shape is shallower (no channelbags / slot handles
 *     — SS fcurves are uniquely id'd inside an action; no NLA strip
 *     slotting yet) but the per-fcurve list of absolute-time deep-copy
 *     keyforms + first/last/origin metadata is structurally equivalent.
 *
 *   - **Paste operator** at
 *     `action_edit.cc:746-779` (`ACTION_OT_paste`). Default RNA props:
 *
 *       - `offset = KEYFRAME_PASTE_OFFSET_CFRA_START` (action_edit.cc:770)
 *         → paste keys starting AT the playhead. Offset is
 *         `cfra - first_frame`.
 *       - `merge = KEYFRAME_PASTE_MERGE_MIX` (action_edit.cc:775) →
 *         just overlay; same-time keys get overwritten via
 *         `INSERTKEY_OVERWRITE_FULL` at `keyframes_general.cc:2001`.
 *       - `flipped = false` → no bone-name mirroring.
 *
 *     `actkeys_paste_exec` at `:662-731` dispatches to `paste_action_keys`
 *     at `:540-596`. That filters destination FCurves (preferring
 *     SELECTED channels first, falling back to ALL channels per
 *     `:577-587` — comment cites bug #31670 as the historical
 *     rationale for the loosening), then delegates to
 *     `paste_animedit_keys` at `keyframes_general.cc:2118-...`.
 *
 *     The kernel:
 *
 *       1. Early-return `KEYFRAME_PASTE_NOTHING_TO_PASTE` if clipboard
 *          is empty (`keyframes_general.cc:2124`).
 *       2. Early-return `KEYFRAME_PASTE_NOWHERE_TO_PASTE` if no
 *          destination fcurves match (`:2127`).
 *       3. Compute X-offset per `offset_mode`:
 *          - `OFFSET_CFRA_START`: `offset[0] = cfra - first_frame` (`:2139`)
 *          - `OFFSET_CFRA_END`:   `offset[0] = cfra - last_frame`   (`:2142`)
 *          - `OFFSET_CFRA_RELATIVE`: `offset[0] = cfra - current_frame` (`:2145`)
 *          - `OFFSET_NONE`:       `offset[0] = 0` (`:2148`)
 *
 *       4. Per destination fcurve: `paste_animedit_keys_fcurve` at
 *          `:1925-2006`:
 *
 *          - Deselect ALL existing keys in destination (`:1935-1937`,
 *            `BEZT_DESEL_ALL`). This means the paste-result selection
 *            REPLACES the prior selection, doesn't extend it.
 *          - Per `merge_mode`:
 *            - `MIX`: do nothing extra (overlay only) — `:1941-1943`.
 *            - `OVER`: `BKE_fcurve_delete_keys_all` (wipe destination)
 *              — `:1945-1948`. NOT shipped in SS — see DEV 13.
 *            - `OVER_RANGE`/`OVER_RANGE_ALL`: select-then-delete keys
 *              in the source-time-range — `:1950-1978`. NOT shipped
 *              in SS — see DEV 13.
 *          - Per source bezt: deep-copy, optionally flip-mirror (no-op
 *            in SS — DEV 14), add offset to vec[0]/[1]/[2], force
 *            `BEZT_SEL_ALL` (`:1998`), then `insert_bezt_fcurve(...,
 *            INSERTKEY_OVERWRITE_FULL)` (`:2001` — same-time replaces).
 *          - `BKE_fcurve_handles_recalc` after the loop (`:2005`).
 *
 *     SS mirrors steps 1-4 in `pasteKeyformsFromClipboard` below.
 *
 * # SS DEVIATIONS (Phase 6 numbering — cumulative)
 *
 * - **DEV 11** — Plan-naming clarification: `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md`
 *   §6.B's operator table names these as `dopesheet.copyColumn` /
 *   `dopesheet.pasteColumn` ("Copy column at playhead" / "Paste at
 *   playhead"). The "column" framing was a conceptual shorthand by the
 *   plan author — Blender's actual `ACTION_OT_copy` operates on the
 *   SELECTION (whatever it is, not a vertical column at the playhead),
 *   and `ACTION_OT_paste` anchors at the playhead (which IS column-like
 *   from a UX standpoint). SS implements Blender semantics: copy
 *   selection; paste-anchor at playhead. Naming the helpers
 *   `copyKeyformsToClipboard` / `pasteKeyformsFromClipboard` rather
 *   than `copyColumn` / `pasteColumn` to avoid perpetuating the
 *   misnomer. Honest plan-language clarification per Rule №2 (don't
 *   ship under aspirational/inaccurate names just because a plan
 *   draft uses them).
 *
 * - **DEV 12** — fcurve matching is by EXACT id (SS uses unique
 *   per-action fcurve ids). Blender matches by `rna_path + array_index`
 *   (plus slot identifier when multiple slots are involved) — see
 *   `paste_animedit_keys` at `keyframes_general.cc:2152-` for the
 *   from-single-to-single fast path and the `pastebuf_match_func`
 *   discriminator at `:1589-1595` for the multi-source/multi-target
 *   case. SS's `action.fcurves[].id` is a stable string and unique
 *   within an action; cross-action paste matches by id (so if you copy
 *   from action A's fcurve "neckRotZ" and paste into action B which
 *   also has an fcurve "neckRotZ", they match). Honest deviation —
 *   simpler matching semantics, no RNA-path resolution needed.
 *
 * - **DEV 13** — Single paste mode: `OFFSET=CFRA_START` + `MERGE=MIX`
 *   only. Blender exposes 4 offset modes (`CFRA_START` / `CFRA_END` /
 *   `CFRA_RELATIVE` / `NONE`) and 4 merge modes (`MIX` / `OVER` /
 *   `OVER_RANGE` / `OVER_RANGE_ALL`), surfaced via the F6 redo panel
 *   (`rna_enum_keyframe_paste_offset_items` at
 *   `keyframes_general.cc:2009-2023`; `rna_enum_keyframe_paste_merge_items`
 *   at `:2054-2068`). SS has no redo panel and ships only the defaults
 *   from `ACTION_OT_paste`: paste-anchor = playhead, same-time-replace
 *   behavior. Other modes deferred indefinitely (no user demand, no
 *   UI surface). Honest deferred-scope deviation per Rule №2 (numbered
 *   SS DEVIATION rather than no-op stub).
 *
 * - **DEV 14** — `flipped` variant NOT shipped: Blender's
 *   `Shift+Ctrl+V` keymap binding at `blender_default.py:2708-2709`
 *   sets `flipped=True`, triggering `do_curve_mirror_flippping` per
 *   bezt at `keyframes_general.cc:1989-1991` (the `if (flip)` branch
 *   inside `paste_animedit_keys_fcurve`) + `flip_names` rna-path
 *   surgery at `:1570-1587` (rewrites `pose.bones["Foot.L"]` →
 *   `pose.bones["Foot.R"]`). SS dopesheet has no bones in its keyform
 *   model (bone params are stored as separate flat fcurves keyed by
 *   `boneId.suffix`, not as RNA-path-bone-name strings), so the
 *   flip-mirror semantic doesn't apply. Honest scope deviation per
 *   Rule №2.
 *
 * - **DEV 15** — Selection-after-paste: SS replaces the selection
 *   ENTIRELY with the newly-pasted keyforms (all parts on: `{center,
 *   left, right} === true`). Blender deselects ALL existing in the
 *   destination fcurves first (`paste_animedit_keys_fcurve` at
 *   `:1935-1937` — `BEZT_DESEL_ALL` per bezt in destination) and then
 *   forces `BEZT_SEL_ALL` on the inserts at `:1998`. Net Blender
 *   behavior: pasted keys are the new selection; destination's other
 *   keys are unselected. SS matches. The difference is scope — Blender
 *   deselects only in the affected destination fcurves; SS replaces
 *   the GLOBAL selection map. Under realistic SS UX (paste targets
 *   destinations that match clipboard fcurves; non-matching fcurves
 *   weren't selected pre-paste either), the global-replace and the
 *   per-fcurve-replace produce identical observable state. Honest
 *   simplification.
 *
 * # Module-level clipboard singleton (vs. caller-owned)
 *
 * Blender stores the clipboard at module-scope in a global pointer
 * (`keyframe_copy_buffer = nullptr` at `keyframes_general.cc:1258`,
 * reset by `ANIM_fcurves_copybuf_reset` at `:1347-1352`). The buffer
 * survives across multiple operator invocations + persists for the
 * lifetime of the process (until `ANIM_fcurves_copybuf_free` at
 * `:1354-1360` is called at shutdown).
 *
 * SS mirrors this with a module-scope `_clipboard` variable + the
 * `getClipboard` / `resetClipboard` accessors below. Same lifecycle:
 * the clipboard survives across DopesheetEditor unmounts/remounts and
 * across action switches (so copying from action A then switching to
 * action B then pasting works — fcurve-id match per DEV 12 above).
 * Process-scoped: lost on full page reload (matches Blender's
 * process-scoped buffer).
 *
 * **Why module-scope, not store-scope**: per the established SS
 * pattern that selection / cursor / playback state lives in Zustand
 * stores but PURE ephemeral buffers (clipboard, undo-stack, drag
 * snapshots) live outside the store to avoid contaminating the
 * serialized project state. The clipboard is NEVER persisted to disk
 * or to URL — pure runtime state. Module-scope is the simplest
 * encoding of that contract.
 *
 * # Pure-ops contract (matches Slice 6.C/6.D conventions)
 *
 * Three helpers split by mutation scope:
 *
 *   1. `copyKeyformsToClipboard(action, handles, originTime)` — RESETS
 *      the module-level clipboard, then populates it from the selected
 *      center keyforms of `action`. Returns `{ changed, buffer }` —
 *      `changed=true` iff anything was copied (matches Blender's
 *      `copy_action_keys` returning `false` → `OPERATOR_CANCELLED`
 *      with "No keyframes copied to the internal clipboard" report at
 *      `action_edit.cc:639`). Caller checks `changed` to decide
 *      whether to log a UI toast.
 *
 *   2. `pasteKeyformsFromClipboard(action, destinationTime)` —
 *      IMMER-FRIENDLY mutator. Walks the current clipboard's fcurves;
 *      for each, finds the matching `action.fcurves[i]` by id (DEV
 *      12) and inserts deep-copy entries with `time` shifted by
 *      `destinationTime - clipboard.firstTime` (DEV 13: CFRA_START
 *      offset only). Same-time keys in the destination are REPLACED
 *      via the insert path. Returns `{ changed, newSelections: Map<fcurveId, number[]> }`
 *      — the per-fcurve list of NEW keyform indices for the pasted
 *      entries, post-sort. Caller passes `newSelections` to the
 *      selection store as the new handles map (with all parts on,
 *      matching Blender's `BEZT_SEL_ALL` at `:1998`).
 *
 *   3. `wouldCopyChange(handles)` / `wouldPasteChange(action)` —
 *      cheap predicates. `wouldCopyChange` returns true iff `handles`
 *      contains at least one center=true entry (matches
 *      `copy_animedit_keys` early-return on zero selected at
 *      `keyframes_general.cc:1505-1517`). `wouldPasteChange` returns
 *      true iff the clipboard is non-empty AND at least one
 *      destination fcurve id matches (matches the two-step early-
 *      return in `paste_animedit_keys` at `:2124-2129`).
 *
 * # Why the split from `graphEditOps.js`
 *
 * `graphEditOps.js` operates on ONE fcurve. The dopesheet operates on
 * the full action — many fcurves at once. The dispatch wrapper at
 * this layer:
 *
 *   - Walks the clipboard's fcurves on paste / the selection's fcurves
 *     on copy.
 *   - For each, looks up / matches the corresponding destination
 *     fcurve.
 *   - Delegates per-fcurve insert + sort + handle-recalc.
 *   - Collects per-fcurve new-index lists into the outer
 *     `Map<fcurveId, number[]>` that the caller uses to derive the
 *     new selection.
 *
 * Mirrors the same dispatch/kernel split as `copy_animedit_keys` (the
 * outer loop) vs `insert_bezt_fcurve` (the per-key kernel) in
 * Blender's `keyframes_general.cc`.
 *
 * @module anim/dopesheetClipboard
 */

import { recalcKeyformHandles } from './fcurveHandles.js';

/**
 * @typedef {{ center: boolean, left: boolean, right: boolean }} HandleParts
 * @typedef {Map<string, Map<number, HandleParts>>} SelectedHandlesMap
 *
 * @typedef {{
 *   time: number,
 *   value: number | Array<{x: number, y: number}>,
 *   handleLeft?: { time: number, value: number },
 *   handleRight?: { time: number, value: number },
 *   handleType?: { left: string, right: string },
 *   interpolation?: string,
 *   flag?: number,
 * }} Keyform
 *
 * @typedef {{
 *   id: string,
 *   keyforms: Keyform[],
 * }} FCurveLike
 *
 * @typedef {{
 *   fcurves: FCurveLike[],
 *   duration?: number,
 * }} ActionLike
 *
 * @typedef {{
 *   fcurveId: string,
 *   entries: Keyform[],
 * }} ClipboardFcurve
 *
 * @typedef {{
 *   firstTime: number,
 *   lastTime: number,
 *   originTime: number,
 *   fcurves: ClipboardFcurve[],
 * }} ClipboardBuffer
 *   Module-scope clipboard payload. Mirrors Blender's
 *   `KeyframeCopyBuffer` struct at
 *   `keyframes_general_intern.hh:35-100`:
 *
 *     - `firstTime` (Blender `first_frame`): min center time across
 *       all copied entries. Initialized to `+Infinity` before the
 *       per-fcurve loop; min'd down per bezt. Used by `CFRA_START`
 *       paste offset (DEV 13).
 *     - `lastTime` (Blender `last_frame`): max center time. Initialized
 *       to `-Infinity`; max'd up per bezt. Tracked for parity even
 *       though the SS-default `CFRA_START` mode doesn't read it
 *       (kept for inspector visibility + potential CFRA_END deferred
 *       slice).
 *     - `originTime` (Blender `current_frame`): the playhead at copy
 *       time. Tracked for parity even though SS doesn't ship the
 *       `CFRA_RELATIVE` offset mode (DEV 13).
 *     - `fcurves`: per-fcurve list of deep-copy entries with ABSOLUTE
 *       times (no offset baked in). Blender stores per-channelbag
 *       FCurve clones; SS flattens to `{fcurveId, entries}` pairs.
 *
 * @typedef {{ changed: boolean, buffer: ClipboardBuffer | null }} CopyResult
 *
 * @typedef {{ changed: boolean, newSelections: Map<string, number[]> }} PasteResult
 *   `newSelections` is per-fcurve list of NEW keyform indices for the
 *   pasted entries (post-sort). Caller turns this into the new
 *   `SelectedHandlesMap` by building `{center, left, right} === true`
 *   parts for each index — matches Blender's `BEZT_SEL_ALL` at
 *   `paste_animedit_keys_fcurve:1998`.
 */

/**
 * Module-scope clipboard singleton. Survives across DopesheetEditor
 * mount/unmount and across action switches; process-scoped (lost on
 * full page reload). Mirrors Blender's `keyframe_copy_buffer = nullptr`
 * at `keyframes_general.cc:1258`.
 *
 * @type {ClipboardBuffer | null}
 */
let _clipboard = null;

/**
 * Reset the module-level clipboard to empty. Called at the start of
 * every `copyKeyformsToClipboard` to mirror Blender's
 * `ANIM_fcurves_copybuf_reset` at `keyframes_general.cc:1347-1352`
 * (which frees the old buffer + allocates a fresh one). Exposed for
 * tests + explicit "clear clipboard" UI gestures (none today).
 *
 * @returns {void}
 */
export function resetClipboard() {
  _clipboard = null;
}

/**
 * Read the current clipboard state. Returns `null` if no copy has
 * happened (or if `resetClipboard` was called since the last copy).
 *
 * **Audit-fix Slice 6.E LOW-1**: returns a SHALLOW-FROZEN view of the
 * live buffer (outer `ClipboardBuffer` + inner `ClipboardFcurve` objects
 * + `entries` arrays are `Object.freeze`'d). The frozen view points at
 * the same `Keyform` objects, so deep mutation of `kf.handleLeft` etc.
 * would still silently corrupt — but the common footguns (push/sort
 * the entries array; reassign `firstTime`) are caught at runtime in
 * strict mode. Pre-fix the docstring said "MUST NOT mutate" but no
 * enforcement; the freeze upgrades the contract from prayer to invariant
 * for the structural surface. Module-internal reads (`wouldPasteChange`,
 * `pasteKeyformsFromClipboard`) reference `_clipboard` directly and
 * BYPASS this freeze, so the paste path's per-iteration shallow clone
 * (`cloneKeyform`) still operates on the original mutable Keyform refs
 * — no perf impact.
 *
 * @returns {ClipboardBuffer | null}
 */
export function getClipboard() {
  if (!_clipboard) return null;
  // Build a frozen wrapper. Freeze each level of the structural
  // hierarchy (outer + per-fcurve + entries array). Don't freeze the
  // Keyform objects themselves — that would also freeze `handleLeft`
  // etc. recursively across the original module state, defeating the
  // bypass above.
  //
  // TS cast: the `Object.freeze` chain produces a `Readonly<...>` shape
  // that's structurally compatible with `ClipboardBuffer` for reads but
  // assignable-incompatible due to the `readonly` marker on the array.
  // The cast through `unknown` is the standard JSDoc escape — callers
  // observing the result type as `ClipboardBuffer` get the live read
  // semantics they expect; runtime freeze enforces the immutability.
  const frozen = Object.freeze({
    firstTime:  _clipboard.firstTime,
    lastTime:   _clipboard.lastTime,
    originTime: _clipboard.originTime,
    fcurves: Object.freeze(_clipboard.fcurves.map((cb) => Object.freeze({
      fcurveId: cb.fcurveId,
      entries:  Object.freeze(cb.entries.slice()),
    }))),
  });
  return /** @type {ClipboardBuffer} */ (/** @type {unknown} */ (frozen));
}

/**
 * Predicate: would `copyKeyformsToClipboard(action, handles, ...)`
 * have anything to copy? True iff `handles` contains at least one
 * entry with `.center === true`. Mirrors Blender's
 * `copy_animedit_keys` early-`continue` per fcurve when no center-
 * selected bezts are present (`keyframes_general.cc:1505-1517`,
 * `BEZT_OK_SELECTED_KEY == bezt->f2 & SELECT`).
 *
 * @param {SelectedHandlesMap | null | undefined} handles
 * @returns {boolean}
 */
export function wouldCopyChange(handles) {
  if (!handles || typeof handles.get !== 'function') return false;
  for (const sub of handles.values()) {
    if (!sub || typeof sub.values !== 'function') continue;
    for (const parts of sub.values()) {
      if (parts && parts.center === true) return true;
    }
  }
  return false;
}

/**
 * Predicate: would `pasteKeyformsFromClipboard(action, ...)` have
 * anything to paste? True iff the clipboard is non-empty AND at
 * least one destination fcurve in `action.fcurves` matches a clipboard
 * fcurve by id (DEV 12). Mirrors the two-step early-return in
 * Blender's `paste_animedit_keys` at `keyframes_general.cc:2124-2129`:
 *
 *   - `KEYFRAME_PASTE_NOTHING_TO_PASTE` if clipboard empty (`:2124`).
 *   - `KEYFRAME_PASTE_NOWHERE_TO_PASTE` if no destination matches
 *     (`:2127`).
 *
 * @param {ActionLike | null | undefined} action
 * @returns {boolean}
 */
export function wouldPasteChange(action) {
  if (!_clipboard || _clipboard.fcurves.length === 0) return false;
  if (!action || !Array.isArray(action.fcurves)) return false;
  /** @type {Set<string>} */
  const dstIds = new Set();
  for (const fc of action.fcurves) {
    if (fc && typeof fc.id === 'string') dstIds.add(fc.id);
  }
  for (const cb of _clipboard.fcurves) {
    if (dstIds.has(cb.fcurveId)) return true;
  }
  return false;
}

/**
 * Deep-copy a Keyform. Mirrors Blender's `BezTriple bezt_copy = *bezt;`
 * shallow-copy at `keyframes_general.cc:1987` followed by the per-array
 * `add_v2_v2` mutation — SS's keyforms have nested objects
 * (`handleLeft` / `handleRight` / `handleType`) that need to be cloned
 * independently to avoid the original and copy sharing handle refs
 * (which would surprise on subsequent edits).
 *
 * @param {Keyform} kf
 * @returns {Keyform}
 */
function cloneKeyform(kf) {
  return {
    time:  kf.time,
    // mesh_verts keyforms hold a per-vertex `[{x,y},...]` array; deep-copy
    // it so the clone never shares the source array reference (a scalar
    // value copies by value and is unaffected). Same independence the
    // handle clones below provide.
    value: Array.isArray(kf.value) ? kf.value.map((v) => ({ x: v.x, y: v.y })) : kf.value,
    handleLeft:  kf.handleLeft  ? { ...kf.handleLeft }  : undefined,
    handleRight: kf.handleRight ? { ...kf.handleRight } : undefined,
    handleType:  kf.handleType  ? { ...kf.handleType }  : undefined,
    interpolation: kf.interpolation,
    flag: kf.flag,
  };
}

/**
 * Apply Blender's `copy_animedit_keys` semantics to `action` for every
 * fcurveId in `handles`. Replaces the module-level clipboard singleton
 * with a fresh buffer holding deep-copy entries of every center-
 * selected keyform (handle-only selections, `parts.center === false`,
 * are skipped — matches Blender's `BEZT_OK_SELECTED_KEY` at
 * `keyframes_general.cc:1513`).
 *
 * Per-fcurve behavior (mirrors `copy_animedit_keys` at `:1488-1566`):
 *
 *   1. If no center-selected bezts in this fcurve, skip entirely.
 *   2. Walk selected indices in ASCENDING order, deep-copy each entry
 *      into the buffer fcurve's `entries` list. Times are ABSOLUTE
 *      (no offset; Blender stores absolute frames at `:1549` too —
 *      `insert_bezt_fcurve` with the bezt's own `vec[1][0]`).
 *   3. Update `firstTime = min(firstTime, kf.time)` and `lastTime = max(...)`.
 *
 * Caller responsibility: capture the playhead before calling and pass
 * as `originTime` — Blender does this via `keyframe_copy_buffer->current_frame
 * = ac->scene->r.cfra` at `:1558`. SS hoists it into the param list
 * because the `useAnimationStore.currentTime` read is upstream of the
 * call.
 *
 * Returns `{ changed, buffer }`:
 *
 *   - `changed`: true if any keyform was copied (matches
 *     `copy_action_keys` returning `bool` at `action_edit.cc:521-538`).
 *   - `buffer`: the new clipboard state (live ref into the module-level
 *     singleton — mutating it from outside is UB; caller may pass it
 *     to inspector UI but not mutate).
 *
 * **Throws Rule-№1** on bad input: missing action, non-array
 * `action.fcurves`, non-finite originTime. No silent fallback per
 * `feedback_no_crutches_rule_one`.
 *
 * @param {ActionLike} action
 * @param {SelectedHandlesMap | null | undefined} handles
 * @param {number} originTime
 * @returns {CopyResult}
 */
export function copyKeyformsToClipboard(action, handles, originTime) {
  if (!action || typeof action !== 'object') {
    throw new Error('copyKeyformsToClipboard: action must be a non-null object');
  }
  if (!Array.isArray(action.fcurves)) {
    throw new Error('copyKeyformsToClipboard: action.fcurves must be an array');
  }
  if (!Number.isFinite(originTime)) {
    throw new Error('copyKeyformsToClipboard: originTime must be a finite number');
  }
  // Reset clipboard FIRST — matches Blender's call site at
  // `copy_animedit_keys:1493` (function defn at `:1347-1352`). Pre-fix,
  // partial population would have leaked from prior copies if we
  // early-returned mid-loop.
  resetClipboard();
  if (!handles || typeof handles.get !== 'function' || handles.size === 0) {
    return { changed: false, buffer: null };
  }
  /** @type {ClipboardFcurve[]} */
  const fcurves = [];
  let firstTime =  Number.POSITIVE_INFINITY;
  let lastTime  =  Number.NEGATIVE_INFINITY;
  for (const fc of action.fcurves) {
    if (!fc || typeof fc.id !== 'string') continue;
    const sub = handles.get(fc.id);
    if (!sub || typeof sub.get !== 'function' || sub.size === 0) continue;
    if (!Array.isArray(fc.keyforms) || fc.keyforms.length === 0) continue;
    // Collect selected center indices in ASCENDING order. Blender's
    // per-fcurve loop at `:1541-1555` walks i=0..totvert; SS sorts
    // explicitly because Map iteration order isn't guaranteed ascending.
    /** @type {number[]} */
    const selectedIdxs = [];
    for (const [kfIdx, parts] of sub.entries()) {
      if (typeof kfIdx !== 'number' || kfIdx < 0 || kfIdx >= fc.keyforms.length) {
        continue;
      }
      if (parts && parts.center === true) selectedIdxs.push(kfIdx);
    }
    if (selectedIdxs.length === 0) continue;
    selectedIdxs.sort((a, b) => a - b);
    /** @type {Keyform[]} */
    const entries = [];
    for (const oldIdx of selectedIdxs) {
      const kf = fc.keyforms[oldIdx];
      entries.push(cloneKeyform(kf));
      if (kf.time < firstTime) firstTime = kf.time;
      if (kf.time > lastTime)  lastTime  = kf.time;
    }
    if (entries.length > 0) {
      fcurves.push({ fcurveId: fc.id, entries });
    }
  }
  if (fcurves.length === 0) {
    // No center-selected keyforms anywhere — clipboard stays null
    // (matches Blender's `is_empty()` early-return path; `OPERATOR_CANCELLED`
    // + "No keyframes copied" report at action_edit.cc:639).
    return { changed: false, buffer: null };
  }
  _clipboard = { firstTime, lastTime, originTime, fcurves };
  return { changed: true, buffer: _clipboard };
}

/**
 * Apply Blender's `paste_animedit_keys` semantics to `action` for
 * every fcurve in the current module-level clipboard. Immer-friendly:
 * mutates `action.fcurves[i].keyforms` in place by replacing each
 * matched fcurve's keyforms array with a re-sorted (insertion +
 * same-time-replace) copy.
 *
 * Per-fcurve behavior (mirrors `paste_animedit_keys_fcurve` at
 * `keyframes_general.cc:1925-2006`, `merge_mode=MIX`):
 *
 *   1. Find the destination fcurve in `action.fcurves` by exact id
 *      (DEV 12). Skip if no match — matches Blender's filtered
 *      `anim_data` not containing the source's RNA path.
 *   2. Compute X-offset = `destinationTime - clipboard.firstTime`
 *      (DEV 13: `CFRA_START` only).
 *   3. Per clipboard entry: deep-copy, shift `time` + `handleLeft.time`
 *      + `handleRight.time` by the offset. Mirrors Blender's
 *      `add_v2_v2(bezt_copy.vec[0], offset)` etc. at `:1993-1995` —
 *      vec[0] is left handle, vec[1] is center, vec[2] is right handle.
 *      SS's flat-time-fields encode the same thing.
 *      (Values are NOT touched — SS DEV 13 fixes paste-y-offset-mode
 *      to NONE; Blender's default is also NONE per `paste_action_keys`
 *      at `action_edit.cc:551`: `paste_context.value_offset_mode =
 *      KEYFRAME_PASTE_VALUE_OFFSET_NONE`.)
 *   4. Insert into the destination via the same-time-replace path:
 *      if a destination keyform has exactly the same time, REPLACE
 *      it with the pasted entry (matches `INSERTKEY_OVERWRITE_FULL`
 *      at `:2001`). Otherwise insert at the time-sorted position.
 *   5. After all inserts: call `recalcKeyformHandles` to settle
 *      auto/aligned handles against the new neighbour topology.
 *      Mirrors `BKE_fcurve_handles_recalc` at `:2005`.
 *
 * **SS DEVIATION 11-15** declared in module header.
 *
 * Returns `{ changed, newSelections }`:
 *
 *   - `changed`: true if any keyform was actually pasted.
 *   - `newSelections`: `Map<fcurveId, number[]>` — per-fcurve list of
 *     the NEW keyform indices (post-sort) for the pasted entries.
 *     Caller turns this into the new `SelectedHandlesMap` by building
 *     `{center: true, left: true, right: true}` parts for each index
 *     (matches Blender's `BEZT_SEL_ALL` at `:1998`).
 *
 * **Throws Rule-№1** on bad input: missing action, non-array
 * `action.fcurves`, non-finite destinationTime. No silent fallback
 * per `feedback_no_crutches_rule_one`.
 *
 * @param {ActionLike} action
 * @param {number} destinationTime
 * @returns {PasteResult}
 */
export function pasteKeyformsFromClipboard(action, destinationTime) {
  if (!action || typeof action !== 'object') {
    throw new Error('pasteKeyformsFromClipboard: action must be a non-null object');
  }
  if (!Array.isArray(action.fcurves)) {
    throw new Error('pasteKeyformsFromClipboard: action.fcurves must be an array');
  }
  if (!Number.isFinite(destinationTime)) {
    throw new Error('pasteKeyformsFromClipboard: destinationTime must be a finite number');
  }
  /** @type {Map<string, number[]>} */
  const newSelections = new Map();
  if (!_clipboard || _clipboard.fcurves.length === 0) {
    return { changed: false, newSelections };
  }
  const offset = destinationTime - _clipboard.firstTime;
  // Build a destination-id lookup. O(M) up front avoids O(N×M) per-
  // entry searches when the clipboard has many fcurves.
  /** @type {Map<string, FCurveLike>} */
  const dstById = new Map();
  for (const fc of action.fcurves) {
    if (fc && typeof fc.id === 'string') dstById.set(fc.id, fc);
  }
  let anyChanged = false;
  for (const cb of _clipboard.fcurves) {
    const dst = dstById.get(cb.fcurveId);
    if (!dst) continue;       // DEV 12: no match in destination action — skip
    if (!Array.isArray(dst.keyforms)) continue;
    // Build the post-paste keyforms array. Walk the source (existing
    // destination keyforms) + the offset clipboard entries together,
    // resolving same-time collisions via OVERWRITE (Blender's
    // INSERTKEY_OVERWRITE_FULL at `:2001`).
    /** @type {Keyform[]} */
    const incoming = [];
    for (const ent of cb.entries) {
      const dup = cloneKeyform(ent);
      dup.time += offset;
      if (dup.handleLeft)  dup.handleLeft.time  += offset;
      if (dup.handleRight) dup.handleRight.time += offset;
      incoming.push(dup);
    }
    incoming.sort((a, b) => a.time - b.time);
    // Mark which incoming times will overwrite existing destination
    // entries. A single Set<time> covers it because incoming was already
    // de-duplicated by the source action's sorted-by-time invariant
    // (and the offset preserves the ordering).
    /** @type {Set<number>} */
    const incomingTimes = new Set();
    for (const e of incoming) incomingTimes.add(e.time);
    // Build merged array: keep all destination entries EXCEPT those at
    // a same-time-as-incoming (those get replaced); then push all
    // incoming entries; then sort + identity-track to derive
    // newSelections indices.
    /** @type {Keyform[]} */
    const merged = [];
    for (const kf of dst.keyforms) {
      if (!incomingTimes.has(kf.time)) merged.push(kf);
    }
    /** @type {Set<Keyform>} */
    const incomingSet = new Set();
    for (const e of incoming) {
      merged.push(e);
      incomingSet.add(e);
    }
    merged.sort((a, b) => a.time - b.time);
    // Per-fcurve new-selection indices: the post-sort positions of
    // every entry in incomingSet.
    /** @type {number[]} */
    const idxs = [];
    for (let i = 0; i < merged.length; i++) {
      if (incomingSet.has(merged[i])) idxs.push(i);
    }
    dst.keyforms = merged;
    newSelections.set(dst.id, idxs);
    // Settle auto/aligned handles. Same recalc convention as Slice 6.C
    // (translate) / 6.D (delete + duplicate). Blender does
    // `BKE_fcurve_handles_recalc` at `keyframes_general.cc:2005`.
    recalcKeyformHandles(dst.keyforms);
    anyChanged = true;
  }
  return { changed: anyChanged, newSelections };
}

/**
 * Build a fresh `SelectedHandlesMap` from `newSelections` returned by
 * `pasteKeyformsFromClipboard`. Each entry gets all parts on
 * (`{center, left, right} === true`) — matches Blender's
 * `BEZT_SEL_ALL` force-set at `paste_animedit_keys_fcurve:1998`.
 *
 * This is a separate helper (not folded into `pasteKeyformsFromClipboard`)
 * so the immer mutator stays selection-store-agnostic — same split as
 * Slice 6.C's `applyTimeTranslate` / `remapHandlesAfterTranslate`.
 *
 * @param {Map<string, number[]>} newSelections
 * @returns {SelectedHandlesMap}
 */
export function handlesFromPasteResult(newSelections) {
  /** @type {SelectedHandlesMap} */
  const out = new Map();
  if (!newSelections || typeof newSelections.entries !== 'function') return out;
  for (const [fcId, idxs] of newSelections.entries()) {
    if (!Array.isArray(idxs) || idxs.length === 0) continue;
    /** @type {Map<number, HandleParts>} */
    const sub = new Map();
    for (const i of idxs) {
      sub.set(i, { center: true, left: true, right: true });
    }
    out.set(fcId, sub);
  }
  return out;
}
