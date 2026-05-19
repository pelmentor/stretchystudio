# Session Close-out — Animation Phase 6 Slice 6.F.1 (2026-05-19)

**Slice:** 6.F.1 — Dopesheet mute channel (M key).
**Status:** SHIPPED. Commits: `21416c5` (substrate) + `1f15410` (audit-fix).
**Schema:** v42 (no bump — UI substrate + dispatcher only).
**Branch:** master (183 commits ahead of origin/master; +2 this slice).
**Phase progress:** 6.A + 6.B + 6.C + 6.D + 6.E + 6.F.1 SHIPPED (6/7+); 6.F.2 (solo) + 6.G remain.

---

## TL;DR

- Ported Blender's `ANIM_OT_channels_setting_toggle` operator dispatched
  from the SpaceAction keymap, bound to the dopesheet **M** key.
- Reused the already-shipped Slice 5.O bulk-mute kernel
  ([fcurveMute.js](../../src/anim/fcurveMute.js) `applyChannelMuteSelected`)
  which byte-faithfully ports `setflag_anim_channels` at
  `anim_channels_edit.cc:2923-3001`. 6.F.1 adds the DOPESHEET surface
  (5.O wired the FCurveEditor sidebar Shift+W).
- New [src/anim/dopesheetChannelMute.js](../../src/anim/dopesheetChannelMute.js)
  (~290 LOC): decision-tree + dispatcher routing M-key fire to either
  single-curve toggle (hovered) or bulk toggle (selection fallback).
- 3 SS DEVIATIONs (DEV 16-18) declared and audit-verified accurate.
- 56 new test asserts (25 sections); all green.
- **Dual audit clean**: 0 HIGH-F, 0 HIGH-A. **Streak holds: 3 consecutive
  clean slices (6.D + 6.E + 6.F.1) post-rule-6.**
- **Scope discovery + split**: Plan §6.B's "Per-channel mute/solo —
  Slice 6.F" envisioned one slice. Discovery at slice-write time that
  `ACHANNEL_SETTING_SOLO = 5` is NLA-tracks-only per
  `ED_anim_api.hh:674` (verified character-for-character by Blender-
  fidelity audit) → solo is an SS-only DAW-convention extension
  requiring `FCURVE_SOLO` bit + eval-cascade rewrite (~3hr separate
  slice). 6.F.1 ships mute today; **6.F.2 queued for solo** with full
  scope outline in this doc's "Next slice" section.

---

## What shipped

### New: [src/anim/dopesheetChannelMute.js](../../src/anim/dopesheetChannelMute.js)

Exports:

- **`pickMuteTarget(action, hoveredFcurveId)`** — pure decision tree.
  Returns `{ kind: 'hovered' | 'selection' | 'none', fcurveId? }`.
  Decision logic:
  1. If `hoveredFcurveId` resolves to a real fcurve in the action →
     `{ kind: 'hovered', fcurveId }` (DEV 17: hover priority).
  2. Else if any fcurve has `selected === true` → `{ kind: 'selection' }`.
  3. Else → `{ kind: 'none' }`.

- **`applyDopesheetChannelMute(action, target)`** — immer-friendly
  dispatcher. Routes to either single-curve toggle
  ([fcurveMute.toggleFCurveMute](../../src/anim/fcurveMute.js)) or bulk
  toggle ([fcurveMute.applyChannelMuteSelected](../../src/anim/fcurveMute.js)
  with `mode='toggle'`, scan-first resolution at
  `anim_channels_edit.cc:2968-2980`). Returns `{ changed, kind, mode }`.

- **`wouldDopesheetChannelMuteChange(action, target)`** — predicate
  for the keymap effect's preventDefault gate.

No new mute kernel — reuses Slice 5.O's already-shipped primitives
which byte-faithfully port `setflag_anim_channels`. Per
`feedback_byte_verify_behavior_cites` **rule 9**, all 12 Blender cites
in this module are re-SOURCED directly from `anim_channels_edit.cc`,
`ED_anim_api.hh`, and `blender_default.py` — NOT re-quoted from
`fcurveMute.js`'s docstring (sister Slice 5.O also cites some of the
same lines, but each 6.F.1 cite was authored independently against the
reference clone).

### Modified: [src/v3/editors/dopesheet/DopesheetEditor.jsx](../../src/v3/editors/dopesheet/DopesheetEditor.jsx)

- `hoveredFcurveIdRef = useRef(null)` — tracks the currently-hovered
  Row. Ref-based (sub-frame writes; `useState` would 60Hz re-render).
- New M-key keymap effect (after the 6.E Ctrl+C/Ctrl+V effect) with
  the established 6.C/6.D/6.E gate pattern: window-level binding,
  input-skip, grab/box-drag ref suppression, action store-read at fire
  time, conditional `preventDefault` only when target resolves.
- `handleRowPointerEnter` / `handleRowPointerLeave` useCallback helpers
  (empty deps, identity-stable) passed as Row props.
- Row component gained two props + `onPointerEnter`/`Leave` handlers
  on its outer div.
- **Audit-fix MED-A1**: `hoveredFcurveIdRef.current = null` at three
  commit sites (box-drag commit in `handleTrackPointerUp`, grab modal
  commit, grab modal cancel) to avoid stale-hover from pointer-capture
  suppression of `onPointerLeave`.

### New: [scripts/test/test_dopesheetChannelMute.mjs](../../scripts/test/test_dopesheetChannelMute.mjs)

56 asserts across 25 sections:
- §1-9: `pickMuteTarget` decision tree (null/undefined cases, stale
  hover fallback, hover priority over selection, empty-string hover
  collapse to no-hover)
- §10-14: `wouldDopesheetChannelMuteChange` predicate
- §15-25: `applyDopesheetChannelMute` (none no-op, hovered single-curve
  flip OFF→ON and ON→OFF, hovered with stale id, selection bulk-toggle
  scan-first uniform vs mixed, no-selected no-op, isolation from
  other/unselected fcurves, Rule №1 throw)

All 56 pass first try.

### Modified: [package.json](../../package.json)

Added `"test:dopesheetChannelMute": "node scripts/test/test_dopesheetChannelMute.mjs"`.

---

## SS DEVIATIONs (Phase 6 cumulative — 16 through 18)

| DEV | What | Why honest |
|-----|------|-----------|
| 16  | Hotkey **M** (vs Blender's `Shift+W` at `blender_default.py:3876`) | DAW convention (Pro Tools / Logic / Ableton all use M for mute). Plan §6.B operator table specifies M. |
| 17  | Hover-priority target (hovered wins over selection; selection is fallback) | Approximates Blender's region-scoped Shift+W UX via explicit hover-tracking since SS uses window-level keymap binding. |
| 18  | Solo (Ctrl+Alt+M) DEFERRED to Slice 6.F.2 | Blender's `ACHANNEL_SETTING_SOLO = 5` at `ED_anim_api.hh:674` is "only for NLA Tracks" (verified character-for-character). Per-FCurve solo would be a NEW DAW-convention feature requiring `FCURVE_SOLO` bit + eval-cascade rewrite. Honest deferred-scope per Rule №2. |

All 3 audit-verified accurate by Blender-fidelity agent (sweep #76).

---

## Audit sweep #76 (dual-agent)

### ARCH (code-reviewer) — 0 HIGH-A, 1 MED-A actionable, 1 MED-A observer

- **HIGH-A**: NONE.
- **MED-A1** (FIXED): Pointer capture during box-drag and grab modal
  suppresses `onPointerLeave` events on Row elements, leaving
  `hoveredFcurveIdRef` stale. Post-commit M-key would target the
  pre-drag hovered row instead of the selection (the documented DEV 17
  fallback path). Fix: clear ref at three commit sites
  (`handleTrackPointerUp` for box-drag; grab modal `commit` + `cancel`).
- **MED-A2** (observer, NOT introduced by 6.F.1): Row lacks `React.memo`,
  so the `useCallback([], [])` identity-stability investment for the
  new hover props produces no actual render savings. Flagged because
  6.F.1 is the first slice where pointer-frequency events make this
  observable; deferred — Row memoization is its own polish-pass scope.
- Other scrutiny points (10 total) cleared as either correct-as-coded
  or pre-existing patterns shared with 6.C/6.D/6.E.

### BLENDER-FIDELITY (general-purpose) — 0 HIGH-F, 0 MED-F, 2 LOW-F precision tightening

- **HIGH-F**: NONE. **Streak HOLDS**: 3 consecutive clean slices
  (6.D + 6.E + 6.F.1) post-rule-6.
- **MED-F**: NONE.
- **LOW-F1** (FIXED): cite range `:3090-3140` overshot
  `ANIM_OT_channels_setting_toggle` body (ends at `:3114`); next 26
  lines belong to sister op `ANIM_OT_channels_editable_toggle`.
  Tightened to `:3090-3114` in both files.
- **LOW-F2** (FIXED): cite at `:3138` claimed
  `ANIM_OT_channels_setting_toggle`'s default RNA `type` enum is
  `ACHANNEL_SETTING_PROTECT`. **Misattributed**: `:3138` IS
  `ACHANNEL_SETTING_PROTECT` — but it belongs to
  `ANIM_OT_channels_editable_toggle`. The `setting_toggle` op's actual
  default at `:3113` is `0` (sentinel; `prop_animchannel_settings_types`
  holds `{PROTECT=1, MUTE=2}`, so default-0 matches no item and
  triggers `WM_menu_invoke` at `:3100`). Behavioral claim was correct;
  cite re-targeted to `:3100/:3113/:2907-2911` with explicit
  prior-misattribution note.

**8 cites byte-verified clean** including all load-bearing claims:
- `anim_channels_edit.cc:2923-3001` (`setflag_anim_channels` body)
- `:2961-2963` (`onlysel=true` adds `ANIMFILTER_SEL`)
- `:2968-2980` (TOGGLE scan-first resolution)
- `:3029` (exec calls with `onlysel=true`)
- `:2907-2911` (enum array `{PROTECT, MUTE}`, no SOLO)
- `ED_anim_api.hh:665-680` (full `eAnimChannel_Settings` declaration)
- `:674` (`ACHANNEL_SETTING_SOLO = 5` with `/** only for NLA Tracks */`
  comment — load-bearing for DEV 18, verified character-for-character)
- `blender_default.py:3876-3878` (`km_animation_channels` Shift+W triple)

**Inherited cites re-verified**: 3 lines (2961, 2968, 3876) cited by
sister `fcurveMute.js` — all 3 match Blender source first-hand, no
inheritance fabrication detected. **Rule 9 (re-source, don't re-quote)
held in audit verification.**

---

## Tests delta

| File | Asserts | Sections |
|------|---------|----------|
| `test_dopesheetChannelMute.mjs` (NEW) | **56** | **25** |

Sibling suites all green (no regressions):
- `test:fcurveMute` — 124/124
- `test:dopesheetClipboard` — 107/107
- `test:dopesheetGrab` — 70/70
- `test:dopesheetDelDup` — 83/83
- `test:dopesheetBoxSelect` — 61/61
- `test:dopesheetRows` — 66/66

Typecheck: clean.

---

## Commits

```
21416c5 feat(anim): Phase 6 Slice 6.F.1 — Dopesheet mute channel (M key)
1f15410 fix(audit): Phase 6 Slice 6.F.1 audit-fix — 1 MED-A + 2 LOW-F cite polish
```

(+ docs/plan update commit forthcoming.)

---

## Next slice (6.F.2 — Solo)

**Solo (Ctrl+Alt+M).** Per plan §6.B operator table:
`dopesheet.soloChannel | Ctrl+Alt+M | Solo channel`. Blender's
`ACHANNEL_SETTING_SOLO = 5` at `ED_anim_api.hh:674` is annotated
`/** only for NLA Tracks */` — there is NO per-FCurve solo in Blender's
animation system. Per-FCurve solo would be an **SS-only DAW-convention
extension** (Pro Tools / Logic / Ableton all support per-track solo
with the "if any solo'd, mute all non-solo'd" semantic). Scope:

1. **Schema**: add `fcurve.solo: boolean` (sparse, like `fcurve.mute`).
   No migration needed — missing reads as `false`. Sister to
   Slice 5.G's `fcurve.mute` add (no schema bump there either).

2. **`src/anim/fcurveSolo.js`** (NEW, ~150 LOC): mirrors
   `fcurveMute.js`'s structure.
   - `isFCurveSoloed(fc)` — strict `=== true` check.
   - `isAnyFCurveSoloed(action)` — predicate; true iff ANY fcurve in
     the action has `solo === true`.
   - `toggleFCurveSolo(action, fcurveId)` — single-curve toggle.
   - `applyChannelSoloSelected(action, mode)` — bulk toggle with
     scan-first resolution (same pattern as 5.O mute).
   - `wouldChannelSoloSelectedChange(action, mode)` — predicate.

3. **`src/anim/fcurveGroups.js`**: extend `isFCurveEffectivelyMuted`
   cascade — fcurve evaluates iff `!mute && !group.mute && (!anySolo || this.solo)`.
   Add `isFCurveEffectivelySoloed(fc, action)` for the dopesheet
   greying. Sister to Slice 5.V's group-mute cascade extension work.

4. **Eval call sites** (4 places — same as Slice 5.V):
   - `src/anim/animationFCurve.js#evaluateActionFCurves`
   - `src/anim/depgraph/kernels/fcurve.js#kernelFCurveEval`
   - `src/anim/depgraph/kernels/animation.js`
   - `src/renderer/animationEngine.js`'s `computePoseOverrides` +
     `computeParamOverrides`
   Each adds the solo-aware mute check before evaluating.

5. **`src/anim/dopesheetChannelMute.js`** (or a new
   `dopesheetChannelSolo.js`): solo dispatcher mirroring
   `pickMuteTarget` + `applyDopesheetChannelMute`. Plus a
   `wouldDopesheetChannelSoloChange` predicate.

6. **DopesheetEditor.jsx**: Ctrl+Alt+M keymap effect routing to the
   solo dispatcher. Sister to the M-key effect this slice shipped.

7. **`src/v3/editors/dopesheet/dopesheetRows.js`**: re-derive
   `isMuted` row state to surface solo-implied-mute (visual cue —
   row appears greyed when another channel is solo'd and this one
   isn't).

8. **Tests**: `test_fcurveSolo.mjs` (~60 asserts) +
   `test_dopesheetChannelSolo.mjs` (~50 asserts) + integration test
   showing solo + mute interaction in eval.

Estimated 6.F.2: ~3 hours (one short session). Should ship before 6.G
(Phase 6 exit gate) so the manual checklist can verify solo end-to-end.

**Pre-draft cite-verification per rule 9**: re-source `setflag_anim_channels`
+ `ANIM_channel_setting_set` dispatcher per-channel-type (the part that
checks `setting == ACHANNEL_SETTING_SOLO` for NLA tracks) directly from
`anim_channels_edit.cc`. Do NOT re-quote any in-tree fcurveMute or
fcurveGroups docstrings (those describe MUTE; SOLO is structurally
analogous but semantically distinct in Blender). The SS solo
implementation is NEW design (no Blender analog for per-FCurve solo) —
docstring should be honest that this is SS-original, not a port.

After 6.F.2:
- **6.G** — Test sweep + Phase 6 exit gate + manual checklist.

---

## Pre-/loop continuation snapshot

- **Branch**: master, 183 commits ahead of origin (NEVER pushed).
- **Working tree**: about to commit close-out + plan.
- **Schema**: v42 (unchanged).
- **Phase 6 progress**: 6/7+ slices SHIPPED (6.A/6.B/6.C/6.D/6.E/6.F.1).
  6.F.2 + 6.G remain.
- **Cite-discipline**: 3 consecutive clean slices post-rule-6
  (`feedback_byte_verify_behavior_cites`); rule 9 held in audit.
- **SS deviations (Phase 6 cumulative)**: 18.
- **User-side owed**: Phase 3 + 4 manual checklists outstanding;
  Phase 6 manual checklist accrues at 6.G.
