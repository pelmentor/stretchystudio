# Animation Phase 3 — Slice 3.C close-out

**Date**: 2026-05-18
**Commits**: `5c1a930` (substrate) → `da9182c` (audit-fix sweep) → (this doc)
**Predecessor**: `SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_B.md`
(FModifier evaluator)
**Path #14 (continued) from Phase 3 queue** — *Properties panel UI
(per-FCurve modifier list: add/remove/reorder/mute/expand + per-type
inline editors)* — SHIPPED.

## ⚠️ User-side manual UI verification needed

Per [feedback_no_background](../../memory/feedback_no_background.md) I
did NOT start the dev server unprompted to visually verify the panel.
Substrate logic + data ops are covered by 147 unit tests, but the UI's
visual layout / click flow / draft-input behavior is not regression-
tested. **Before declaring 3.C fully shipped**, the user should:
1. Run `npm run dev` and open an FCurve in the FCurveEditor
2. Press `N` to open the N-panel (right sidebar)
3. Confirm "Modifiers" section renders below "Active Keyframe"
4. Add each of the 6 modifier types via the dropdown; confirm Cycles
   greys out after first add and lands at index 0
5. Exercise mute / remove / reorder up-down / expand-collapse
6. Edit per-type fields (cycles modes, noise params, generator
   coefficients, limits axis flags, stepped step size, envelope
   control points)
7. Confirm undo/redo (Ctrl+Z / Ctrl+Y) recovers from each edit

If anything's off visually, ping me with the screenshot or a brief
description and I'll fix.

## What the path was

> "**3.C — Properties panel UI** (per-FCurve modifier list:
> add/remove/reorder/mute/expand; per-type inline data editors) | NEW
> TOP"
> — from Slice 3.B close-out (`SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_3_SLICE_B.md`)

UI surface for the modifier-stack data (3.A typedef) + evaluator (3.B
runtime). Mounts inside the FCurveEditor's N-panel (right sidebar, `N`
key toggle) below the existing `ActiveKeyformPanel`.

## Blender divergence verified

| Aspect | Blender | SS port (3.C) |
|--------|---------|---------------|
| Panel registration | `graph_panel_modifiers` in `editors/space_graph/graph_buttons.cc` | `FCurveModifiersPanel` React component mounted in N-panel |
| Add Modifier dropdown | Operator-based menu (`GRAPH_OT_fmodifier_add`) | Inline `<select>` populated from `MODIFIER_TYPE_OPTIONS` |
| Cycles head-of-stack | `BLI_assert(fcm->prev == nullptr)` at `fmodifier.cc:635` | Enforced by `applyAddModifier` + `wouldReorderModifierChange` |
| Add-modifier active behavior | `add_fmodifier:1213-1215` -- `if BLI_listbase_is_single` sets ACTIVE | Audit-fix MED-8: SS now matches (was always-promote pre-fix) |
| Set-active EXCLUSIVE | `set_active_fmodifier:1363-1378` -- clears all then sets one | `applySetActiveModifier` mirrors the loop |
| Remove behavior | `remove_fmodifier:1289-1327` -- frees data + unlinks; does NOT touch ACTIVE | SS UX convention: promote previous neighbor (documented as SS-side, not Blender port) |
| Cycle mode labels | "No Cycles" / "Repeat Motion" / "Repeat with Offset" / "Repeat Mirrored" per `rna_fcurve.cc:1531-1545` | Audit-fix HIGH-2/3: SS now matches (was "Repeat" / "Mirror" pre-fix) |
| Generator mode labels | "Expanded Polynomial" / "Factorized Polynomial" per `rna_fcurve.cc:1281-1285` | Audit-fix HIGH-4: SS now matches (was "Polynomial" / "Factorised Polynomial" pre-fix) |
| Noise `use_legacy_noise` | UI toggle at `fmodifier_ui.cc:547` | Intentionally omitted (3.B evaluator only ships modern Perlin); UI hint documents the omission |
| Generator `poly_order` "Order" field | UI field at `fmodifier_ui.cc:374` | Intentionally omitted (SS derives degree from `coefficients.length`); UI hint documents the derivation |

## What shipped

| Capability | Where |
|------------|-------|
| `fcurveModifiersPanelData.js` (~670 LOC) — pure data ops: resolveModifiersContext, createDefaultModifierData, applyAdd/Remove/Reorder/SetMuted/SetActive/EditData/EditNumber/SetFlag for the modifier stack | `src/v3/editors/fcurve/fcurveModifiersPanelData.js` |
| 6 type-specific factories with Blender-faithful defaults (per-type new_data) | same module, `createDefaultModifierData` switch |
| Cycles head-of-stack invariant enforced in 3 places (add cycles→unshift; add other→push; reorder→reject violating moves) | same |
| EXCLUSIVE per-fcurve active invariant via `applySetActiveModifier` | same |
| Sparse-write convention (muted/active/useRestrictedRange/useInfluence/disabled flags; modifier list itself) | same |
| 12 would*Change predicates covering every op (5 added in audit-fix sweep) | same |
| `FCurveModifiersPanel.jsx` (~720 LOC) — React panel: Add Modifier dropdown + per-modifier card with collapse/reorder/mute/remove + per-type editor + common range/influence section | `src/v3/editors/fcurve/FCurveModifiersPanel.jsx` |
| 6 per-type editor components (Cycles/Noise/Generator/Limits/Stepped/Envelope) using NumberInput/SelectInput/Checkbox primitives | same |
| Mounted in FCurveEditor N-panel below `ActiveKeyformPanel` | `src/v3/editors/fcurve/FCurveEditor.jsx` |
| Updated stale comment in ActiveKeyformPanel ("SS doesn't have F-Modifiers" → corrected post-3.A) | `src/v3/editors/fcurve/ActiveKeyformPanel.jsx` |
| Tests: 147 assertions (was 124 pre-audit; +23 audit-fix regressions) | `scripts/test/test_fcurveModifiersPanelData.mjs` |
| `test:fcurveModifiersPanelData` script + test-runner registration | `package.json` |

## Dual audit (parallel agents)

| Lane | HIGH | MED | LOW | Total |
|------|------|-----|-----|-------|
| Architecture | 2 (mostly doc lies) | 3 | 4 | 9 |
| Blender fidelity | **6** (1 FAB + 5 surface mismatches) | 1 | several | 7+ |
| **Combined actionable** | **8** | **4** | **~7** | **~19** |

**Fab streak: BROKEN AT 1** — the post-3.B "preflight every Blender
citation against the reference clone before spawning audit" discipline
held for 3.B but lapsed for 3.C. The fab was in a paragraph comment
inside `applyRemoveModifier`'s JSDoc, not in a numbered citation block,
but it's exactly the pattern the audit-fix sweeps keep documenting as
a known trap.

Notably:
- 3.A broke fab at 3 with a struct-opener cite (DNA_anim_types.h:341 vs :353)
- 3.B restored fab at 1 with all 40 cites verified clean
- 3.C broke fab at 1 with a more elaborate fab: WRONG function name
  (`BKE_fmodifier_remove` doesn't exist; real is `remove_fmodifier`),
  WRONG line range (:1167-1189 was `fmodifier_get_typeinfo` + start of
  `add_fmodifier`; real `remove_fmodifier` at :1289-1327), AND WRONG
  attributed behavior (the function does NOT touch the ACTIVE flag on
  any survivor — pure SS-side UX convention dressed up as a Blender
  port)

## Audit-fix sweep (commit `da9182c`)

| Finding | Severity | Fix |
|---------|----------|-----|
| FIDELITY HIGH-1 (FAB): `BKE_fmodifier_remove` cite fabricated | fidelity (FAB) | Rewrote `applyRemoveModifier` docblock: dropped the false Blender attribution, admitted the promote-on-remove is an SS UX convention, documented Blender's actual behavior (no auto-promote at the C-API level) with correct function name and line range. |
| FIDELITY HIGH-2/3/4: UI labels diverged | fidelity | Updated 5 labels: Cycles "Repeat" → "Repeat Motion", Cycles "Mirror" → "Repeat Mirrored", Generator "Polynomial" → "Expanded Polynomial", Generator "Factorised Polynomial" → "Factorized Polynomial". Data keys stay British spelling for typedef compatibility; only user-facing labels flip. |
| FIDELITY HIGH-5: Noise `use_legacy_noise` field omitted | fidelity | Added UI hint to NoiseEditor documenting the omission. SS evaluator only ships modern Perlin (3.B decision); exposing a non-functional toggle would mislead users. |
| FIDELITY HIGH-6: Generator `poly_order` "Order" field omitted | fidelity | Added UI hint to GeneratorEditor documenting that polynomial degree is derived from `coefficients.length` (intentional SS simplification per 3.A typedef MED-3). |
| FIDELITY MED-8: Add-modifier active diverged from Blender | fidelity | `applyAddModifier` now only auto-promotes new modifier when `mods.length === 1` (single-on-add), matching `add_fmodifier:1213-1215`. Tests 19/22/22b/22c/31/45 updated to reflect Blender-matching behavior. |
| ARCH HIGH-1: applyAddModifier comment vs code lie | arch | Rewrote comment to match the actual tail-push code (was claiming "insert at index 1+" but code does `push`). |
| ARCH HIGH-2: promote-on-remove doc said "closest neighbor" | arch | Rolled into FIDELITY HIGH-1 fix; doc admits "previous-first then fall-back-to-index-0" semantic. Added mid-stack active-remove regression test (22b) and head-remove regression (22c) to lock the behavior. |
| ARCH MED-1/2: Generator + Envelope ops bypassed would*Change preflight | arch | Added 6 new predicates in the data layer (wouldAdd/Remove/Edit for both Generator coefficients + Envelope control points). Gated all 6 React handlers on the new predicates. Added 6 new test blocks covering the predicates. |
| ARCH MED-3: NumberInput formatNumber + commit diverged from ActiveKeyformPanel | arch | Aligned `formatNumber` to return `''` for non-finite (was `'0'`); added `draft === ''` guard in commit. Matches the established pattern in the sister panel. |

## SS deviations from Blender (still open, documented)

1. **Promote-on-remove** — Blender's `remove_fmodifier` doesn't touch
   ACTIVE; SS auto-promotes the previous neighbor for UX continuity.
   Documented as intentional SS convention.
2. **Noise `use_legacy_noise` omission** — SS only ships the modern
   Perlin FBM path; toggle hidden because it would expose a
   non-functional control. UI hint documents.
3. **Generator `poly_order` derivation** — SS derives degree from
   `coefficients.length`; the explicit "Order" field hidden. UI hint
   documents.
4. **Add Modifier dropdown vs operator menu** — SS uses an inline
   `<select>`; Blender uses operator-driven menu. Cosmetic difference
   only; both surface the same 6 type options with the same Cycles
   constraint enforcement.
5. **Per-card collapse state** — local React state on `FCurveModifiersPanel`,
   not persisted across FCurveEditor unmounts. Acceptable for typical
   editing sessions; persistence to `editorStore` is a future polish
   slice if needed.

## Queued paths (post-3.C)

| Path | Title | Status |
|------|-------|--------|
| 14 (continued) | **3.D — Cycles → motion3.json IsLoop export** (per plan §3.D: detect `before='none', after='repeat', afterCycles=0` on every fcurve in an Action → IsLoop=true; otherwise bake cycles to explicit keyforms) | NEW TOP |
| 14 (continued) | 3.E — Noise bake-at-export pipeline (FPS-driven bake to explicit keyforms; Cubism has no live-noise primitive) | queued |
| 14 (continued) | 3.F — Test-suite buildout (per-modifier + composition tests + export bake tests) | partial (3.A/3.B/3.C ship 47+102+147 = 296 baseline assertions) |
| 14 (continued) | 3.G — Phase 3 exit gate (round-trip Cycles modifier through save/load; Cubism Viewer loads exported motion3 with IsLoop) | queued |
| 13 | Phase 2 owed-manual verification | USER-SIDE |
| 37 | AGRP_MODIFIERS_OFF cascade — UNBLOCKED post-3.B; could ship at any time | queued |

## Lessons

1. **The fab pattern keeps evolving.** 3.A's fab was a STRUCT-OPENER
   line confused with a field declaration. 3.B's audit cleared all 40
   cites. 3.C's fab is more elaborate: WRONG function name + WRONG
   line range + WRONG attributed behavior, all in a single paragraph.
   The substrate author was attempting to credit Blender for an
   SS-invented UX convention; the audit caught it. **Lesson: paragraph
   prose that claims Blender behavior is a fab risk equal to numbered
   cite blocks.** Any "mirrors Blender's X" claim needs the same
   preflight discipline as `fmodifier.cc:LINE`.

2. **Cite-discipline regression after one clean slice is not "back to
   square one".** 3.B held the streak for one slice; 3.C broke it.
   But the 3.B → 3.C transition was UI-shaped, not substrate-shaped,
   and the fab was in a single comment that was easy to overlook
   amidst React components. For UI slices specifically, citation
   density is lower (3.A had 17 DNA cites, 3.B had 40 fmodifier.cc
   cites; 3.C had ~5 total) so each cite carries proportionally more
   responsibility. The author's attention is on JSX + state
   management; the few Blender cites get less of it. **Going forward:
   even on light-cite UI slices, allocate dedicated preflight time
   per Blender mention.**

3. **UI label parity matters more than expected.** 3 of the 5 audit
   HIGH fidelity items were just label strings ("Repeat" vs "Repeat
   Motion", etc.). The substrate author wrote "Repeat" thinking it
   was Blender's label; it isn't. The user-facing label set is
   essentially a translation table from data keys to UI strings; the
   exact Blender labels for every modifier type/mode/blend-type SHOULD
   be lifted directly from `rna_fcurve.cc`'s `EnumPropertyItem` arrays
   when porting a UI surface. **Lesson: when porting a Blender UI
   surface, grep `rna_*.cc` for the relevant `EnumPropertyItem`
   arrays and paste the labels verbatim.**

4. **Two parallel audit agents catch different things, even on UI.**
   Fidelity caught the FAB + 5 surface mismatches; arch caught the
   would*Change bypasses + formatNumber drift + the comment-vs-code
   lies. Neither agent caught both. **Lesson: keep dual-audit
   convention even on UI slices; the fidelity-vs-arch split scales.**

5. **Manual UI verification is the dual-audit's blind spot.** Both
   audit agents do code review; neither can click a button. The 147
   unit tests verify data ops; they don't verify React state during
   user interaction (e.g. is the panel actually rendering, do
   commit-on-blur fields work, do React warnings appear in the
   console). **Lesson: explicitly call out the verification gap in
   the close-out so the user knows where the "tested" claim ends.**

## Pre-doc state table

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead of origin | **122** (was 120 pre-slice; +2 substrate+audit-fix; +1 this doc) |
| Schema version | v41 (unchanged across this slice — pure UI) |
| Slices shipped this session | 3 (3.A + 3.B + 3.C) |
| Per-slice commit count (3.C) | 2 (substrate + audit-fix) + 1 (this doc) = 3 |
| Dual audits run | 1 (3.C) |
| Audit-fix sweeps | 1 (3.C) |
| Audit findings | 1 FAB + 6 HIGH + 4 MED + ~7 LOW; total ~19 actionable; ALL fixed in same-day sweep |
| **Fab streak** | **BROKEN AT 1** (was 1 holding post-3.B; broken by `BKE_fmodifier_remove` fab — wrong name + wrong lines + wrong behavior) |
| Test suites green | all (147 fcurveModifiersPanelData + 102 fmodifiers + 35 fcurveEval + 61 animationEngine + adjacent = ~500+ assertions verified) |
| Typecheck | clean |
| **UI manual verification** | **NOT done by Claude per `feedback_no_background`**; user-side verification needed |
| New files | `src/v3/editors/fcurve/fcurveModifiersPanelData.js` + `src/v3/editors/fcurve/FCurveModifiersPanel.jsx` + `scripts/test/test_fcurveModifiersPanelData.mjs` |
| Modified files | `src/v3/editors/fcurve/FCurveEditor.jsx` (mount panel) + `src/v3/editors/fcurve/ActiveKeyformPanel.jsx` (stale comment) + `package.json` (test reg) |
| Deviations opened (still tracked) | 5 (promote-on-remove SS convention, legacy_noise omission, poly_order derivation, Add Modifier inline vs operator menu, per-card collapse not persisted) |
| Deviations closed | 0 (substrate slice; no pre-existing devs to close) |
| Top queued path | **#14 (continued) — 3.D Cycles → motion3.json IsLoop export** |

## Phase 3 progress (post-3.C)

```
Phase 3 — F-Curve modifiers (~1 week per plan)
├─ 3.A — Schema substrate ............ SHIPPED 2026-05-18 (typedefs + v41)
├─ 3.B — Modifier evaluator .......... SHIPPED 2026-05-18 (live two-pass)
├─ 3.C — Properties panel UI ......... SHIPPED 2026-05-18 (this slice; manual verification pending)
├─ 3.D — Cycles → IsLoop export ...... NEW TOP
├─ 3.E — Noise bake-at-export ........ queued
├─ 3.F — Test-suite buildout ......... queued (296 baseline assertions)
└─ 3.G — Phase exit gate ............. queued
```

## Whole-Animation-Plan progress (post-3.C)

```
Animation Plan — 8 phases:
├─ ✅ Phase 0 — Wire what already exists
├─ ✅ Phase 1 — Action datablock + NodeTree retirement
├─ ✅ Phase 2 — BezTriple handles
├─ 🟡 Phase 3 — F-Curve modifiers (3.A + 3.B + 3.C SHIPPED; 3.D..3.G queued)
├─ 🔲 Phase 4 — NLA stack (~1.5 weeks)
├─ 🟡 Phase 5 — Graph Editor write-mode (slices A→NN shipped)
├─ 🔲 Phase 6 — Dopesheet write-mode
└─ 🔲 Phase 7 — Insert Keyframe + Keying Sets
```

Phase 3 is now ~45% done by slice count (3/7) and ~75% done by
load-bearing weight (typedef + evaluator + UI cover the editor-side
work; 3.D + 3.E are export-bake passes; 3.F + 3.G are test/gate).
