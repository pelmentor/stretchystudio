# Session Aggregate — Animation Phase 6 Slices 6.E + 6.F.1 + 6.F.2 (2026-05-19)

**Session date:** 2026-05-19 (continuation from prior session aggregate
`d359f28` covering 6.C + 6.D).
**Branch:** master (187 commits ahead of origin/master; +9 this session).
**Schema:** v42 (no bumps — UI substrate + sparse-boolean fields only).
**Status:** All three slices SHIPPED + 3 dual-audit sweeps clean.
**Phase progress:** 6.A → 6.F.2 SHIPPED (7/7+); only **6.G exit gate** remains.

---

## What this session shipped

### Slice 6.E — Dopesheet copy/paste (Ctrl+C / Ctrl+V)
Commits: `1aaf0b3` (substrate) + `554be56` (audit-fix) + `989449b` (docs).
Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_E.md`.

- **`src/anim/dopesheetClipboard.js`** (NEW, ~485 LOC):
  module-level `_clipboard` singleton (analog of Blender's
  `keyframe_copy_buffer = nullptr` at `keyframes_general.cc:1258`),
  `copyKeyformsToClipboard(action, handles, originTime)` (mirrors
  `copy_animedit_keys` at `:1488-1566` — deep-copies center-selected
  entries with absolute times + firstTime/lastTime/originTime),
  `pasteKeyformsFromClipboard(action, destinationTime)` (mirrors
  `paste_animedit_keys_fcurve` at `:1925-2006` — CFRA_START offset,
  MIX merge same-time replace), `handlesFromPasteResult`,
  `wouldCopyChange`, `wouldPasteChange`, `getClipboard`,
  `resetClipboard`. Throws Rule №1 on bad input.
- **DopesheetEditor.jsx** wires Ctrl+C / Ctrl+V via the established
  6.C/6.D gate pattern (input-skip + grab/box-drag ref suppression +
  store-read at fire time). Conditional `preventDefault` so browser's
  native text-copy still works when SS has nothing to do.
- 107 test asserts (95 pre-audit + 12 post-audit for frozen wrapper
  enforcement). All green first try.

### Slice 6.F.1 — Dopesheet mute channel (M key)
Commits: `21416c5` (substrate) + `1f15410` (audit-fix) + `bb1bd0d` (docs).
Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_F1.md`.

- **`src/anim/dopesheetChannelMute.js`** (NEW, ~290 LOC):
  decision-tree + dispatcher routing M-key fire to either single-curve
  toggle (hovered) or bulk toggle (selection fallback). Reuses
  already-shipped Slice 5.O `applyChannelMuteSelected` kernel.
- **DopesheetEditor.jsx** adds `hoveredFcurveIdRef` + Row
  `onPointerEnter`/`Leave` handlers + M-key effect.
- 56 test asserts. All green first try.
- **Scope discovery at slice-write**: Plan §6.B envisioned ONE slice
  for "Per-channel mute/solo". Byte-verification revealed
  `ACHANNEL_SETTING_SOLO = 5` is NLA-tracks-only per
  `ED_anim_api.hh:674` → **6.F SPLIT** into 6.F.1 (mute, shipped now)
  + 6.F.2 (solo, queued as separate ~3hr slice).

### Slice 6.F.2 — Per-FCurve solo (Ctrl+Alt+M)
Commits: `90e8655` (substrate) + `b1b7a5b` (audit-fix) + `53c117d` (docs).
Close-out: `docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_F2.md`.

- **`src/anim/fcurveSolo.js`** (NEW, ~230 LOC):
  5 exports mirroring `fcurveMute.js` structural shape (NOT cite
  inheritance per rule 9). `isFCurveSoloed`, `isAnyFCurveSoloed`,
  `toggleFCurveSolo`, `applyChannelSoloSelected` (scan-first),
  `wouldChannelSoloSelectedChange`.
- **`src/anim/dopesheetChannelSolo.js`** (NEW, ~190 LOC): sister to
  6.F.1's `dopesheetChannelMute.js`.
- **`src/anim/fcurveGroups.js`** — extended `isFCurveEffectivelyMuted`
  with solo cascade as highest-priority check. All 4 eval call sites
  pick up the semantic automatically (sister to Slice 5.V's group-mute
  cascade integration).
- **DopesheetEditor.jsx** wires Ctrl+Alt+M; reuses `hoveredFcurveIdRef`
  from 6.F.1.
- **SS-ORIGINAL** — not a Blender port. Multi-solo DAW semantic (Pro
  Tools / Logic / Ableton pattern: any-soloed-plays, rest-silent;
  solo overrides mute).
- 59 + 48 + 12 (extended fcurveGroups) + 9 (extended dopesheetRows,
  audit-fix HIGH-A) = 128 new asserts.

---

## Cite-discipline arc — STREAK-BREAK CONFIRMED DURABLE

| Slice | Pre-audit | Post-audit | Notes |
|-------|-----------|------------|-------|
| 6.C (prior) | 14 cites, 3 FAB | All fixed | 5th consecutive fab slice |
| 6.D (prior) | 16 cites, **0 FAB** | Clean | **STREAK BROKEN at 5** |
| 6.E   | 32+ cites, **0 FAB** | 3 LOW-F cosmetic | Confirmed (6.D wasn't accident) |
| 6.F.1 | 12 cites, **0 FAB** | 2 LOW-F cosmetic | 3rd consecutive clean |
| 6.F.2 | 12 cites, **0 FAB** | **0 LOW-F** | **4th consecutive — first SS-original passes too** |

**4 consecutive clean slices** post-rule-6 establish the streak-break
as durable discipline change, not one-time accident. 6.F.2 specifically
tested the **rule-9 / SS-original discipline**: the substrate was honest
about NOT being a Blender port (per-FCurve solo has no Blender analog).
Audit specifically validated "NOT a Blender port" framing across 3
docstring layers; no false port claim detected.

### Rule 9 introduced this session

After 6.E shipped clean, the Blender-fidelity audit observed:

> "Rule 6 was PREEMPTED, not just satisfied" — 6.E did not re-quote
> ANY specific Blender path/line from sister modules; every cite was
> drawn directly from the reference clone.

Promoted to memory rule 9 in `feedback_byte_verify_behavior_cites`:

> **Rule 9 — Re-SOURCE, don't re-QUOTE, when sister modules cover the
> same Blender semantic.** When a sister module's docstring covers
> material relevant to your slice, OPEN BLENDER and re-source the
> original rather than re-quoting the sister's docstring. Strictly
> subsumes rule 6 when authoring fresh cites; sidesteps inherited-fab
> failure class entirely by never depending on sister docstrings.

6.F.1 + 6.F.2 both shipped under rule 9; both passed audit-side
validation.

---

## Audit findings rolled up (sweeps #75 + #76 + #77)

| Sweep | HIGH-A | MED-A | LOW-A | HIGH-F | MED-F | LOW-F |
|-------|--------|-------|-------|--------|-------|-------|
| #75 (6.E)   | 0 | 1 (selection-Range guard) + 1 (TOCTOU latent) | 1 (freeze getClipboard) | **0** | 0 | 3 (cite polish) |
| #76 (6.F.1) | 0 | 1 (hover ref leak post-capture) + 1 observer (Row !memo) | 0 | **0** | 0 | 2 (cite range tightening) |
| #77 (6.F.2) | **1 (dopesheetRows inline cascade)** | 1 systemic (double-find in both dispatchers) | 0 | **0** | **0** | **0** |

All actionable findings addressed same-day in audit-fix commits.

**Notable: sweep #77 was the FIRST audit-clean Blender-fidelity sweep**
(0 HIGH-F + 0 MED-F + 0 LOW-F) — the SS-original framing test was
explicit and passed cleanly. The HIGH-A finding was on
implementation-completeness (inline-cascade sync) rather than cite
discipline.

---

## SS deviations — Phase 6 cumulative (19 total)

| DEV | Slice | What |
|-----|-------|------|
| 1   | 6.A   | Ctrl+LMB rebound to deselect (Blender uses `action.select_leftright`) |
| 2   | 6.B   | INCLUSIVE time-range bounds vs Blender's STRICT `ok_bezier_framerange` |
| 3   | 6.B   | Axis-range mode (Alt+B) NOT shipped — deferred to 6.B.1 |
| 4   | 6.C   | Time-translate is INTEGER-MS; Blender accumulates fractional frames |
| 5   | 6.C   | Snap-to-frame NOT shipped; deferred to 6.C.1 polish slice |
| 6   | 6.C   | Merge epsilon `0.5 ms` vs Blender's `0.01f` frames |
| 7   | 6.D   | Empty-fcurve auto-removal NOT shipped (Blender's `ED_anim_ale_fcurve_delete`) |
| 8   | 6.D   | Delete confirm dialog suppressed (matches dopesheet keymap `confirm=False`) |
| 9   | 6.D   | Backspace aliased to Delete (Mac laptop accommodation) |
| 10  | 6.D   | Duplicate inherits HandleParts profile verbatim, not Blender's `BEZT_SEL_ALL` force-all-on |
| **11**  | **6.E**   | **Plan-naming clarification: "copyColumn"/"pasteColumn" was conceptual; SS implements Blender selection-based copy + playhead-anchor paste** |
| **12**  | **6.E**   | **fcurve match by exact id vs Blender's RNA path + array_index + slot** |
| **13**  | **6.E**   | **Single paste mode (CFRA_START offset + MIX merge); other modes deferred** |
| **14**  | **6.E**   | **Shift+Ctrl+V flipped variant NOT shipped (no bones in SS dopesheet keyform model)** |
| **15**  | **6.E**   | **Selection-after-paste GLOBAL replace vs Blender's per-fcurve deselect-then-select** |
| **16**  | **6.F.1** | **Hotkey M (vs Blender's Shift+W). DAW convention; plan §6.B specifies M** |
| **17**  | **6.F.1** | **Hover-priority target selection (hovered wins; selection is fallback). Approximates Blender's region-scoped UX via explicit hover-tracking** |
| **18**  | **6.F.1** | **Solo (Ctrl+Alt+M) DEFERRED to 6.F.2 — Blender ACHANNEL_SETTING_SOLO is NLA-only per ED_anim_api.hh:674** |
| **19**  | **6.F.2** | **Hotkey Ctrl+Alt+M for solo. SS-conventional (no Blender hotkey); avoids M-collision + stays in M-family without stealing S** |

All 9 new DEVIATIONs (11-19) audit-verified accurate.

---

## Tests added this session

| File | Asserts |
|------|---------|
| `test_dopesheetClipboard.mjs` (NEW) | 107 |
| `test_dopesheetChannelMute.mjs` (NEW) | 56 |
| `test_fcurveSolo.mjs` (NEW) | 59 |
| `test_dopesheetChannelSolo.mjs` (NEW) | 48 |
| `test_fcurveGroups.mjs` (extended) | +12 (89 total) |
| `test_dopesheetRows.mjs` (extended) | +9 (75 total) |

**Total new session test asserts: 291.** All sibling suites green
(dopesheet*, fcurve*, keyform*, nla*, graphEditOps, fmodifiers,
animationEngine, fcurveEval, bakeNla). Typecheck clean.

---

## Commits this session (9)

```
1aaf0b3 feat(anim): Phase 6 Slice 6.E — Dopesheet copy/paste (Ctrl+C / Ctrl+V)
554be56 fix(audit): Phase 6 Slice 6.E audit-fix — 1 MED-A + 1 LOW + 3 LOW-F cite polish
989449b docs(plan): Phase 6 Slice 6.E SHIPPED — Ctrl+C / Ctrl+V close-out (STREAK-BREAK HOLDS)
21416c5 feat(anim): Phase 6 Slice 6.F.1 — Dopesheet mute channel (M key)
1f15410 fix(audit): Phase 6 Slice 6.F.1 audit-fix — 1 MED-A + 2 LOW-F cite polish
bb1bd0d docs(plan): Phase 6 Slice 6.F.1 SHIPPED — M-key mute close-out (3rd clean slice)
90e8655 feat(anim): Phase 6 Slice 6.F.2 — Per-FCurve solo (Ctrl+Alt+M)
b1b7a5b fix(audit): Phase 6 Slice 6.F.2 audit-fix — 1 HIGH-A + 1 MED-A systemic
53c117d docs(plan): Phase 6 Slice 6.F.2 SHIPPED — Per-FCurve solo close-out (4th clean slice)
```

(+this aggregate doc, +1 commit.)

---

## Top queued path

**Slice 6.G — Phase 6 exit gate.** Final slice of Phase 6. Per plan
§6.B "Tests" subsection:

1. **Test sweep**: ensure all 7 dopesheet-related test scripts pass
   cleanly. Decide whether to wire `test:dopesheetClipboard` /
   `test:dopesheetChannelMute` / `test:dopesheetChannelSolo` /
   `test:fcurveSolo` into the master `npm test` chain (currently
   individually-runnable but not in master).
2. **Phase 6 exit gate**: review all 7 shipped slices (6.A through
   6.F.2) for:
   - Cumulative SS DEVIATION compliance (19 total — each verified as
     honest extension or honest deferral per Rule №2).
   - Cross-slice consistency (gate patterns, dep arrays, ref usage).
   - Documentation completeness (every slice has a close-out doc).
3. **Manual checklist**: end-user-visible behaviors to verify in the
   browser. Accrues at 6.G into
   `docs/plans/ANIMATION_PHASE_6_MANUAL_CHECKLIST.md` (paralleling
   the existing `ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`).

Estimated 6.G: ~1 hour (mostly docs; no new substrate).

After 6.G: **Phase 6 SHIP-COMPLETE**. Phase 7 (Insert Keyframe + Keying
Sets, 3-5 days) is the next ANIMATION_BLENDER_PARITY_PLAN.md section.

---

## Pre-compact state (snapshot)

- **Branch**: master, 187 commits ahead of origin (NEVER pushed)
- **Working tree**: about to commit this aggregate
- **Schema**: v42 (unchanged across all 3 slices this session)
- **Phase 6 progress**: 6.A + 6.B + 6.C + 6.D + 6.E + 6.F.1 + 6.F.2
  SHIPPED (7/7+); only 6.G exit gate remains
- **Tests added this session**: 291 asserts (3 new test files + 2
  extended)
- **Cite-discipline**: 4 consecutive clean slices (6.D + 6.E + 6.F.1 +
  6.F.2) post-rule-6; **rule 9 introduced this session** in
  `feedback_byte_verify_behavior_cites` memory; **6.F.2 was the first
  SS-original slice in the post-rule-9 regime and passed honest-framing
  audit cleanly**
- **SS deviations (Phase 6)**: 19 cumulative (9 new this session)
- **User-side owed**: Phase 3 + 4 manual checklist still outstanding
  (`docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`); Phase 6
  manual checklist accrues at 6.G

## Notable architectural patterns established this session

1. **Module-level singleton clipboard** (6.E) — first SS-side singleton
   for ephemeral runtime state, mirroring Blender's process-scoped
   `keyframe_copy_buffer` pattern. Sparse-frozen-wrapper return via
   `getClipboard()` (audit-fix) sets the contract precedent for future
   singletons (project-state should be immutable to callers; module
   state can be flexibly enforced).

2. **Hover-tracking via ref** (6.F.1) — ref-based hover tracking
   (`hoveredFcurveIdRef = useRef(null)`) for sub-frame pointer-event
   frequency without React re-render churn. Pattern reused in 6.F.2;
   foundation for future channel-context-menu / channel-name-rename
   slices that need pointer-target identity.

3. **Eval-cascade via single function extension** (6.F.2) — extending
   `isFCurveEffectivelyMuted` propagates the new semantic to all 4
   eval call sites automatically (sister to Slice 5.V's group-mute
   extension). Precedent for future eval-affecting flags (e.g. proposed
   `fcurve.protected` for read-only channels — would extend the same
   function with a protected-skip branch).

4. **SS-original framing discipline** (6.F.2) — explicit "NOT a Blender
   port" declaration across module headers + inline JSX comments + plan
   docs. Audit-validated as the discipline for shipping SS-original
   work without smuggling under port-cite cover.
