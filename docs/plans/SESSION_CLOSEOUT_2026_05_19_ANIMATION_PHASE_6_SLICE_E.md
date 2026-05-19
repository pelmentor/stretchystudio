# Session Close-out — Animation Phase 6 Slice 6.E (2026-05-19)

**Slice:** 6.E — Dopesheet copy/paste (Ctrl+C / Ctrl+V).
**Status:** SHIPPED. Commits: `1aaf0b3` (substrate) + `554be56` (audit-fix).
**Schema:** v42 (no bump — UI substrate only).
**Branch:** master (180 commits ahead of origin/master; +2 this slice).
**Phase progress:** 6.A + 6.B + 6.C + 6.D + 6.E SHIPPED (5/7); 6.F + 6.G remain.

---

## TL;DR

- Ported Blender's `ACTION_OT_copy` + `ACTION_OT_paste` dispatched from
  the SpaceAction keymap (Ctrl+C / Ctrl+V). New
  [src/anim/dopesheetClipboard.js](../../src/anim/dopesheetClipboard.js) (~485 LOC)
  + module-level singleton + 7 exported helpers.
- Wired into [src/v3/editors/dopesheet/DopesheetEditor.jsx](../../src/v3/editors/dopesheet/DopesheetEditor.jsx)
  via a new keymap effect with input-skip + grab/box-drag ref suppression
  + selection-Range guard (audit-fix MED-A3).
- 5 SS DEVIATIONs (DEV 11-15) declared and audit-verified accurate.
- 107 new test asserts (32 sections); all green.
- **Dual audit clean**: 0 HIGH-F, 0 MED-F, 0 HIGH-A. **Streak-break HOLDS**:
  2 consecutive clean slices (6.D + 6.E) post-rule-6 establish discipline
  change.
- **Meta**: new memory rule 9 (`feedback_byte_verify_behavior_cites`) —
  "re-SOURCE, don't re-QUOTE" sister-module Blender cites.

---

## What shipped

### New: [src/anim/dopesheetClipboard.js](../../src/anim/dopesheetClipboard.js)

Module-level `_clipboard` singleton (analog of Blender's
`keyframe_copy_buffer = nullptr` at
`reference/blender/source/blender/editors/animation/keyframes_general.cc:1258`).
Survives across DopesheetEditor mount/unmount and across action switches;
process-scoped (lost on full page reload). Reset by every copy via
`resetClipboard` (analog of `ANIM_fcurves_copybuf_reset` at
`:1347-1352`).

Exports:

- **`copyKeyformsToClipboard(action, handles, originTime)`** — mirrors
  `copy_animedit_keys` at `:1488-1566`. Resets singleton, then deep-copies
  center-selected keyforms (`ANIM_editkeyframes_ok(BEZT_OK_SELECTED_KEY)`
  at `:1505-1517` checks `bezt->f2 & SELECT`, center bit) with ABSOLUTE
  times. Tracks `firstTime` / `lastTime` (mins/maxes per `:1553-1554`,
  initialized to `±Infinity` per `keyframes_general_intern.hh:95-96`) +
  `originTime` (playhead at copy time, per `:1558`). Returns
  `{ changed, buffer }`. Throws Rule №1 on bad input.

- **`pasteKeyformsFromClipboard(action, destinationTime)`** — immer
  mutator mirroring `paste_animedit_keys_fcurve` at
  `keyframes_general.cc:1925-2006`. CFRA_START offset
  = `destinationTime - firstTime` (per `:2139`, the default
  `KEYFRAME_PASTE_OFFSET_CFRA_START` from `ACTION_OT_paste:770`). MIX
  merge = same-time-replace via insert (per `INSERTKEY_OVERWRITE_FULL`
  at `:2001`, the default `KEYFRAME_PASTE_MERGE_MIX` from
  `ACTION_OT_paste:775`). Recalcs handles (`BKE_fcurve_handles_recalc`
  analog at `:2005`). Returns `{ changed, newSelections: Map<fcurveId, number[]> }`
  — caller turns `newSelections` into a `SelectedHandlesMap` via the
  helper below (all parts on, matching `BEZT_SEL_ALL` at `:1998`).
  Throws Rule №1 on bad input.

- **`handlesFromPasteResult(newSelections)`** — pure helper. Builds
  the `SelectedHandlesMap` for post-paste selection: every paste index
  gets `{center: true, left: true, right: true}`. Splits the immer
  mutator's responsibility cleanly (same pattern as 6.C's
  `applyTimeTranslate` + `remapHandlesAfterTranslate`).

- **`wouldCopyChange(handles)`** — predicate. True iff at least one
  `parts.center === true`. Mirrors `copy_animedit_keys` early-`continue`
  per fcurve at `:1505-1517`.

- **`wouldPasteChange(action)`** — predicate. True iff clipboard non-empty
  AND at least one destination fcurve id matches a clipboard fcurve id.
  Mirrors the two-step early-return in `paste_animedit_keys` at
  `:2124-2129` (`KEYFRAME_PASTE_NOTHING_TO_PASTE` + `KEYFRAME_PASTE_NOWHERE_TO_PASTE`).

- **`getClipboard()`** — reads the singleton. Post-audit-fix LOW-1
  returns a shallow-frozen wrapper (outer + per-fcurve + entries array
  all `Object.freeze`'d); module-internal reads bypass.

- **`resetClipboard()`** — clears the singleton. Called at the start of
  every copy; exposed for tests + explicit clear gestures.

### Modified: [src/v3/editors/dopesheet/DopesheetEditor.jsx](../../src/v3/editors/dopesheet/DopesheetEditor.jsx)

New useEffect for Ctrl+C / Ctrl+V keydown handler (immediately after
the 6.D Del/Shift+D effect). Pattern parity with 6.C + 6.D:
- Window-level binding + input/textarea/contenteditable skip.
- `grabActiveRef` / `boxDragActiveRef` suppression (refs identity-stable;
  effect mounts once, no dep churn — same fix pattern as 6.D HIGH-A1).
- Action resolved via `useProjectStore.getState().project` at fire time
  to avoid re-mounting on every project mutation.
- Selection store updated outside the immer recipe via
  `useKeyformSelectionStore.getState().setHandles(...)`.

Audit-fix MED-A3 added: bails out if `window.getSelection()?.type ===
'Range'` so the user's OS text-copy isn't suppressed when they have
non-input text selected (e.g. dopesheet row label).

### New: [scripts/test/test_dopesheetClipboard.mjs](../../scripts/test/test_dopesheetClipboard.mjs)

107 asserts across 32 sections:
- §1-2: `wouldCopyChange` predicate
- §3-5: `wouldPasteChange` predicate
- §6-15: `copyKeyformsToClipboard` (input validation, no-op cases,
  fcurve skips, single-keyform capture, multi-fcurve bounds tracking,
  origin verbatim, deep-copy isolation, OOB skips, handles-only skip,
  clipboard reset on each copy)
- §16-28: `pasteKeyformsFromClipboard` (input validation, no-op cases,
  CFRA_START offset, same-time replace, sort, handle shift, newSelections
  indices, recalc verification, multi-fcurve, round-trip independence,
  resetClipboard wipes paste)
- §29-30: `handlesFromPasteResult` (all-parts-on shape, empty cases)
- §31-32 (audit-fix LOW-1): frozen wrapper enforcement + frozen-read
  doesn't break paste path

All 107 green first try (95 pre-audit + 12 post-audit).

### Modified: [package.json](../../package.json)

Added `"test:dopesheetClipboard": "node scripts/test/test_dopesheetClipboard.mjs"`.

---

## SS DEVIATIONS (Phase 6 cumulative — 11 through 15)

| DEV | What | Why honest |
|-----|------|-----------|
| 11  | Plan-naming clarification — helpers named for Blender semantics, not §6.B's "copyColumn"/"pasteColumn" shorthand | Plan author conceptualized as "column at playhead"; Blender's actual semantic is selection-based copy + playhead-anchor paste |
| 12  | fcurve match by exact id vs Blender's `rna_path + array_index` + slot | SS ids are stable strings, unique per action; Blender's RNA-path system has no SS analog |
| 13  | Single paste mode (CFRA_START offset + MIX merge); other modes deferred | SS has no F6 redo panel; ship defaults from `ACTION_OT_paste:770/775` |
| 14  | Shift+Ctrl+V flipped variant NOT shipped | SS dopesheet has no `pose.bones["..."]` RNA paths in its keyform model |
| 15  | Selection-after-paste GLOBAL replace vs per-destination-fcurve deselect-then-select | Under realistic UX where paste targets fcurves not pre-selected outside clipboard scope, observable state matches |

All 5 audit-verified accurate by the Blender-fidelity agent.

---

## Audit sweep #75 (dual-agent)

### ARCH (code-reviewer) — 0 HIGH-A, 1 MED-A actionable, 1 LOW

- **HIGH-A**: NONE.
- **MED-A1** (latent, no fix today): TOCTOU between `wouldPasteChange`
  outside immer and `pasteKeyformsFromClipboard` inside immer. Zero
  exposure today (synchronous `updateProject`); flagged for future async
  migration.
- **MED-A2** (no regression vs sisters): selection-store update happens
  in a separate microtask from immer commit; safe under React 18
  automatic batching of native event handlers + synchronous Zustand
  updates. Same pattern as 6.C / 6.D.
- **MED-A3** (actionable, FIXED): Ctrl+C with non-input text selected
  suppressed OS text copy. Fix: bail out when `window.getSelection()?.type
  === 'Range'`. Keyform-copy still fires when nothing is text-selected
  (the dominant UX path). Blender has no analog (desktop, no OS-clipboard
  contention).
- **LOW-1** (FIXED): `getClipboard()` returned mutable ref. Now returns
  a shallow-frozen wrapper — strict-mode mutations throw `TypeError`.
  Module-internal reads bypass; paste path zero perf impact.

### BLENDER-FIDELITY (general-purpose) — 0 HIGH-F, 0 MED-F, 3 LOW-F cosmetic

- **HIGH-F**: NONE. **5-slice fab streak (4.D.4 / 4.E / 6.A / 6.B / 6.C)
  remains BROKEN. 2 consecutive clean slices (6.D + 6.E) establish the
  break as discipline change rather than a one-time accident.**
- **MED-F**: NONE.
- **LOW-F1** (FIXED): `:1989` cite landed on `if (flip) {` line; the
  actual `do_curve_mirror_flippping` call is `:1990`. Now `:1989-1991`.
- **LOW-F2** (FIXED): `:1493` cite is the call site inside
  `copy_animedit_keys` (defn at `:1347-1352` cited elsewhere); now
  disambiguated as "(call) / (defn)".
- **LOW-F3** (FIXED): `BEZT_OK_SELECTED_KEY` paraphrase dropped the
  `ANIM_editkeyframes_ok` wrap; restored.

**32+ cites byte-verified clean** including: keymap, module-level
singleton + reset, copy kernel (outer + skip-empty + INSERTKEY flags +
min/max bounds + current_frame), paste per-fcurve (BEZT_DESEL_ALL + MIX
no-op + OVER + OVER_RANGE/ALL + add_v2_v2 + BEZT_SEL_ALL +
INSERTKEY_OVERWRITE_FULL + recalc), paste dispatch (NOTHING/NOWHERE +
4 offset modes + single-to-single fast path + pastebuf_match_func),
both enums (offset items + merge items), flip surgery, struct fields
(+inf/-inf initialization), all operator wrappers (copy/paste exec +
op registration + default RNA prop values).

**Meta-finding: "Rule 6 was PREEMPTED, not just satisfied."** 6.E did
not re-quote ANY specific Blender path/line from in-tree sister modules
(`dopesheetGrab.js` / `dopesheetDelDup.js` / `graphEditOps.js` /
`fcurveHandles.js`); references to those modules are structural
("companion to", "same dispatch/kernel split as") but every line/struct
cite was drawn directly from the reference clone.

This promoted to **new memory rule 9** in `feedback_byte_verify_behavior_cites`:
**"Re-SOURCE, don't re-QUOTE, when sister modules cover the same Blender
semantic."** Strictly subsumes rule 6 when the slice is authoring fresh
cites; rule 6 still applies for the rare case where re-quoting genuinely
is the right pattern (e.g. an op that DELEGATES to a sister helper and
the cite is naming the delegation point).

---

## Tests delta

| File | Asserts | Sections |
|------|---------|----------|
| `test_dopesheetClipboard.mjs` (NEW) | **107** | **32** |

Sibling suites all green (no regressions):
- `test:dopesheetGrab` — 70/70
- `test:dopesheetDelDup` — 83/83
- `test:dopesheetBoxSelect` — 61/61
- `test:dopesheetSelectOps` — 60/60
- `test:keyformSelectionStore` — 25/25
- `test:graphEditOps` — 115/115

Typecheck: clean.

---

## Commits

```
1aaf0b3 feat(anim): Phase 6 Slice 6.E — Dopesheet copy/paste (Ctrl+C / Ctrl+V)
554be56 fix(audit): Phase 6 Slice 6.E audit-fix — 1 MED-A + 1 LOW + 3 LOW-F cite polish
```

(+ docs/plan/memory update commit forthcoming.)

---

## Next slice (6.F)

**Per-channel mute (M) + solo (Ctrl+Alt+M).** Per plan §6.B operator
table:
- `dopesheet.muteChannel | M | Toggle mute on hovered channel`
- `dopesheet.soloChannel | Ctrl+Alt+M | Solo channel`

Mirrors Blender's `ANIM_OT_channels_setting_toggle` /
`ANIM_OT_channels_setting_enable` with `setting=ACHANNEL_SETTING_MUTE`
in `reference/blender/source/blender/editors/animation/anim_channels_edit.cc`.

Note: SS already ships `FCURVE_MUTE` evaluator gating
(`isFCurveEffectivelyMuted` in `dopesheetRows.js`) and the channel sidebar
shows muted rows italicized at 60% opacity. 6.F adds the WRITE side
(keymap-driven mute toggle on hovered channel + group cascade
+ solo-isolates-channel semantics).

After 6.F:
- **6.G** — Test sweep + Phase 6 exit gate + manual checklist.

Pre-draft cite-verification per `feedback_byte_verify_behavior_cites`
rule 9 (the new one): re-source Blender's `ACHANNEL_SETTING_MUTE` enum
+ `setting_setflag` per-channel-type dispatcher + solo's
`ACHANNEL_SETTING_SOLO` cascade DIRECTLY from `anim_channels_edit.cc`;
do not re-quote any in-tree fcurveMute docstrings.

---

## Pre-/loop continuation snapshot

- **Branch**: master, 180 commits ahead of origin (NEVER pushed).
- **Working tree**: about to commit close-out + plan + memory.
- **Schema**: v42 (unchanged).
- **Phase 6 progress**: 5/7 slices SHIPPED. 6.F + 6.G remain.
- **Cite-discipline**: 2 consecutive clean slices post-rule-6
  (`feedback_byte_verify_behavior_cites`); promoted rule 9.
- **SS deviations (Phase 6 cumulative)**: 15.
- **User-side owed**: Phase 3 + 4 manual checklists outstanding;
  Phase 6 manual checklist accrues at 6.G.
