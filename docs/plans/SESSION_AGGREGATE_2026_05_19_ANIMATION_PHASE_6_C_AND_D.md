# Session Aggregate — Animation Phase 6 Slices 6.C + 6.D (2026-05-19)

**Session date:** 2026-05-19 (continuation from prior session aggregate
`0e1a518` which covered 4.E + 4.F + 6.A + 6.B).
**Branch:** master (177 commits ahead of origin/master; +6 this session).
**Schema:** v42 (no bumps — UI substrate only).
**Status:** Both slices SHIPPED. Phase 6 at 4/7 (6.A-6.D); 6.E-6.G remain.

---

## What this session shipped

### Slice 6.C — Modal grab (G key time-translate)
Commits: `98b8a2a` (substrate) + `f82e670` (audit-fix) + `4aea968` (docs).
Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_C.md`.

- **`src/anim/dopesheetGrab.js`** (NEW, ~360 LOC):
  `applyTimeTranslate` (immer mutator, shifts kf.time+handleLeft.time+
  handleRight.time by same delta per Blender `transform_convert.cc:
  1267-1285`, sorts, calls mergeDuplicateTimeKeys which AVERAGES
  selected values per `fcurve.cc:1801-1916`, recalcs handles) +
  `remapHandlesAfterTranslate` (pure, identity-stable) +
  `wouldTimeTranslateChange` (predicate).
- **DopesheetEditor.jsx** wires G-key modal: window mousemove tracks
  deltaMs preview; ghost translucent diamonds at `kf.time+deltaMs`;
  status pill; LMB/Enter commit; RMB/Esc cancel (no mutation —
  preview is overlay-only).
- 70 new test_dopesheetGrab asserts (later +1 from audit-fix §17 = 70).

### Slice 6.D — Delete (Del) + Duplicate-move (Shift+D)
Commits: `872a208` (substrate) + `a79f431` (audit-fix) + `d6329d2` (docs).
Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_D.md`.

- **`src/anim/dopesheetDelDup.js`** (NEW, ~395 LOC):
  `applyDeleteKeyforms` (immer mutator, pre-filters OOB+non-center,
  delegates to `graphEditOps.deleteKeyforms` which mirrors Blender's
  `BKE_fcurve_delete_keys_selected` at `fcurve.cc:1757-1784`,
  recalcs handles) + `applyDuplicateKeyforms` (immer mutator, walks
  selected center idxs ASCENDING, inserts deep-copy duplicate after
  each per Blender `keyframes_general.cc:62-95`, remap re-targets
  selection at duplicates) + `wouldDelDupChange` predicate.
- **DopesheetEditor.jsx** wires Del + Shift+D:
  - `enterGrabModal()` useCallback helper extracted from G-key effect
    so Shift+D can re-use it.
  - Del → applyDeleteKeyforms via updateProject →
    remapHandlesAfterTranslate drops deleted entries.
  - Shift+D → applyDuplicateKeyforms → remapHandlesAfterTranslate
    re-targets at duplicates → enterGrabModal() auto-enters 6.C grab
    modal (Blender's `ACTION_OT_duplicate_move` macro chain at
    `action_ops.cc:80-89`).
- 83 new test_dopesheetDelDup asserts.

---

## Cite-discipline arc — the 5-slice fab streak

| Slice | Pre-audit | Post-audit | Notes |
|-------|-----------|------------|-------|
| 6.C   | 14 cites, 3 FAB (HIGH-F1/F2/F3) | All fixed | 5th consecutive fab slice |
| 6.D   | 16 cites, **0 FAB** | Clean | **STREAK BROKEN at 5** |

### 6.C fabs (audit-fix `f82e670`)

1. **HIGH-F1**: G-key keymap cite `blender_default.py:2716-2717
   transform.translate` — real is `:2718-2719 transform.transform
   mode='TIME_TRANSLATE'`. Dopesheet uses GENERIC op with mode
   property, not the dedicated translate op.
2. **HIGH-F2**: Merge-semantics docstring said "selected wins +
   OVERWRITES unselected" — actually Blender AVERAGES selected
   values into the lowest-index survivor (`fcurve.cc:1859-1862`
   computes; `:1887` writes). SS impl already averaged correctly;
   only the docstring lied.
3. **HIGH-F3**: INHERITED fab `BEZT_BINARYSEARCH_THRESH = 0.00002 s`
   copy-pasted from `graphEditOps.js:662-663` (pre-existing from
   Slice 5.W vintage). Real value at `BKE_fcurve.hh:217` is `0.01f`
   FRAMES. Fixed at SOURCE + consumer.

### Meta-feedback rule added after 6.C

`feedback_byte_verify_behavior_cites.md` extended with rule 6:

> When CONSUMING a previously-shipped substrate's cites, RE-VERIFY
> against Blender even when the cite is already in-tree. The
> 5-slice streak isn't about laziness on individual cites; it's
> about TRUST IN SISTER MODULES being unjustified when those
> modules themselves were shipped without the byte-verify workflow.

### 6.D shipped clean — rule 6 worked

For 6.D, I opened `fcurve.cc` directly and re-verified
`BKE_fcurve_delete_keys_selected` semantics before re-quoting
`graphEditOps.deleteKeyforms`'s docstring. All 16 cites byte-verified
clean post-audit. The discipline cost was small (2-3 extra Blender
files); streak-breaking effect was immediate.

6.D's audit found 1 MED-F (selection-bit divergence in `BEZT_SEL_ALL`
semantics) — but that was a DISCOVERY new to 6.D's port, not an
inherited fab, and was honestly documented as SS DEVIATION 10 rather
than papered over.

---

## Audit findings rolled up (sweeps #73 + #74)

| Sweep | HIGH-A | MED-A | LOW-A | HIGH-F | MED-F | LOW-F |
|-------|--------|-------|-------|--------|-------|-------|
| #73 (6.C) | 2 (dep array + eager suppression) | 1 (pointerUp identity) | 1 (test doc) | **3** | 0 | 2 |
| #74 (6.D) | 2 (re-mount cycle + handles consistency) | 2 (silent invariant + Backspace doc) | 0 | **0** | 1 (selection-bit) | 3 (doc polish) |

All findings addressed same-day in audit-fix commits.

---

## SS deviations — Phase 6 cumulative (10 total)

| DEV | Slice | What |
|-----|-------|------|
| 1 | 6.A | Ctrl+LMB rebound to deselect (Blender uses `action.select_leftright`) |
| 2 | 6.B | INCLUSIVE time-range bounds vs Blender's STRICT `ok_bezier_framerange` |
| 3 | 6.B | Axis-range mode (Alt+B FRAMERANGE/CHANNELS) NOT shipped — deferred to 6.B.1 |
| 4 | 6.C | Time-translate is INTEGER-MS (Math.round); Blender accumulates fractional frames |
| 5 | 6.C | Snap-to-frame NOT shipped; deferred to 6.C.1 polish slice |
| 6 | 6.C | Merge epsilon `0.5 ms` vs Blender's `0.01f` frames per `BKE_fcurve.hh:217` |
| 7 | 6.D | Empty-fcurve auto-removal NOT shipped (Blender's `ED_anim_ale_fcurve_delete`) |
| 8 | 6.D | Delete confirm dialog suppressed (matches dopesheet keymap `confirm=False`) |
| 9 | 6.D | Backspace aliased to Delete (Mac laptop accommodation) |
| 10 | 6.D | Duplicate inherits HandleParts profile verbatim, not Blender's `BEZT_SEL_ALL` force-all-on |

---

## Tests added this session

| File | Asserts |
|------|---------|
| `test_dopesheetGrab.mjs` (NEW) | 70 |
| `test_dopesheetDelDup.mjs` (NEW) | 83 |
| `test_keyformSelectionStore.mjs` (fixed pre-existing stale publishHandles refs) | 25 (unchanged count, was broken) |

**Total new session tests: 153 asserts.** All sibling suites green
(dopesheet*, fcurve*, keyform*, nla*, graphEditOps, fmodifiers,
bakeNla). Typecheck clean.

---

## Commits this session (6)

```
98b8a2a feat(anim): Phase 6 Slice 6.C — Dopesheet modal grab (G key time-translate)
f82e670 fix(audit): Phase 6 Slice 6.C audit-fix — 3 HIGH-F cite fabs + 2 HIGH-A bugs + 1 MED-A + LOW polish + 1 new SS DEV
4aea968 docs(plan): Phase 6 Slice 6.C SHIPPED — modal grab (G key) close-out
872a208 feat(anim): Phase 6 Slice 6.D — Dopesheet delete (Del) + duplicate-move (Shift+D)
a79f431 fix(audit): Phase 6 Slice 6.D audit-fix — 2 HIGH-A + 2 MED-A + 1 MED-F + 1 LOW-F + 2 new SS DEVs
d6329d2 docs(plan): Phase 6 Slice 6.D SHIPPED — Del + Shift+D close-out (FAB STREAK BROKEN)
```

(+this aggregate doc, +1 commit).

---

## Top queued path

**Slice 6.E — Column copy/paste (Ctrl+C / Ctrl+V).** Per plan §6.B
operator table:
- `dopesheet.copyColumn | Ctrl+C | Copy column at playhead`
- `dopesheet.pasteColumn | Ctrl+V | Paste at playhead`

Mirrors Blender's `ACTION_OT_copy` + `ACTION_OT_paste` operators in
`action_edit.cc`. Implementation plan:

- Pure `copyKeyformsColumn(action, handles, originTime)` → returns
  transferable clipboard buffer (per-fcurve list of keyforms with
  times offset from `originTime`).
- Pure `pasteKeyformsColumn(action, clipboard, destinationTime)` →
  mutates action by inserting clipboard entries at
  `destinationTime + (entry.timeOffset)` per fcurve.
- Module-level clipboard storage (singleton — matches Blender's
  per-process keyframe buffer datastructure).
- DopesheetEditor wires Ctrl+C → copy; Ctrl+V → paste, both at the
  current `useAnimationStore.currentTime`.

Pre-draft cite-verification per `feedback_byte_verify_behavior_cites`
rule 6: re-verify Blender's keyframe-buffer datastructure (any
sister-module references) before re-quoting.

After 6.E:
- **6.F** — Per-channel mute (M) + solo (Ctrl+Alt+M)
- **6.G** — Test sweep + Phase 6 exit gate + manual checklist

---

## Pre-compact state (snapshot)

- **Branch**: master, 177 commits ahead of origin (NEVER pushed)
- **Working tree**: about to commit this aggregate
- **Schema**: v42 (unchanged)
- **Phase 6 progress**: 6.A + 6.B + 6.C + 6.D SHIPPED (4/7 slices)
- **Tests added this session**: 153 asserts
- **Cite-discipline**: 6.D shipped clean; 5-slice fab streak BROKEN
- **SS deviations (Phase 6)**: 10 cumulative
- **User-side owed**: Phase 3 + 4 manual checklist still outstanding
  (`docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`); Phase 6
  manual checklist accrues at 6.G
