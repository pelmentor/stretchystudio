# Session Aggregate — 2026-05-19 — Animation Phase 4 close-out + Phase 6 open

**Session date:** 2026-05-19 (cross-compact continuation; spans
Slices 4.E + 4.F + 6.A + 6.B over 4 substrate+audit cycles)
**Branch:** master (170 commits ahead of origin/master; +12 this
session)
**Schema:** v42 (no bump this session — all 4 slices are UI/operator
substrate, no migration)
**Status:** Phase 4 substrate complete (4.G user-blocked on manual
checklist); Phase 6 opened, 2/7 slices SHIPPED.

This aggregate covers four sub-slices shipped this session; each
has its own close-out doc with full diff-level detail. The
per-slice closeouts:
- `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_4_SLICE_E.md`
- `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_4_SLICE_F.md`
- `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_A.md`
- `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_B.md`

---

## What this session shipped (4 substrate slices + 2 close-outs)

### Slice 4.E — BakeNLA operator (commits `7e4a2a0` + `6ebe3e2`)

The "freeze runtime NLA stack into a single ground-truth Action"
operator. `src/v3/operators/bakeNla.js` (~620 LOC after audit-fix):

- `bakeNla(animData, project, options)` — pure substrate. Walks
  `[frameStartMs, frameEndMs]` at `stepMs`, composing
  `evaluateNla` output with the bound-action layer (mirroring
  `animsys_create_action_track_strip` at `anim_sys.cc:3313-3365`).
- `applyBakeNla(project, objectId, options)` — project mutator;
  routes binding-assignment through
  `actionRegistry.js#assignAction`.
- `wouldBakeNlaChange(animData)` — predicate.

NLAEditor per-group Bake button (Combine icon, emerald). **110
new test_bakeNla asserts.**

### Slice 4.F — test parity sweep + manual checklists (commit `218c68c`)

Coverage audit of plan §4.F vs as-shipped: 8/10 rows FULL under
different filenames; 2 rows had partial coverage filled with new
test_nlaEval §30 (replace+subtract stacked integration) + §31
(replace+multiply stacked integration); 1 row deliberately deferred
(combine — out of Phase 4 scope). Plan §4.F amended with
status-augmented mapping table.

New `docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md` covers
Phase 3 FModifier UI carryover + Phase 4 §4.G end-to-end scenarios
(idle+breath+walk+talk stack / shared-Blink across 2 characters /
tweak push→edit→exit / bake→motion3.json→Cubism Viewer parity).

**735 Phase 4 cumulative asserts** post-4.F.

### Slice 6.A — Dopesheet tick selection + lift keyformSelectionStore (commits `cfb82a9` + `5b4cccd`)

**Phase 6 opens.** Architectural lift: the cross-editor
`keyformSelectionStore` evolved from "FCurveEditor canonical /
others read-only mirror" (Slice 5.EE shape) to multi-writer
canonical via new `useKeyformSelectionState()` hook returning
`[handles, setHandles]`. Drop-in for FCurveEditor's 22 useState
call sites; zero behavioral change there.

New `src/anim/dopesheetSelectOps.js`: 3 pure ops
(`applyTickSelectReplace` / `applyTickSelectExtend` /
`applyTickSelectDeselect`) + `isTickSelected` predicate.
DopesheetEditor tick clicks: plain LMB=replace / Shift=extend /
Ctrl=deselect; double-click→seek via separate `onDoubleClick`.

**60 new test_dopesheetSelectOps asserts.**

### Slice 6.B — Dopesheet box-select (commits `bdf95a8` + `dff1c99`)

B-key + LMB-drag rect marquee with 3 modes (REPLACE/EXTEND/SUBTRACT)
mirroring Blender's `ACTION_OT_select_box`. New
`src/anim/dopesheetBoxSelect.js`: pure `applyBoxSelect` +
`computeBoxHits` + `BOX_SELECT_MODES`. DopesheetEditor track-area
drag-rect with 4px threshold; marquee overlay (blue replace/extend,
red subtract); B-key window listener arms gesture; drag-on-tick
guard with B-armed override.

**61 new test_dopesheetBoxSelect asserts.**

---

## Cite-discipline arc this session (CRITICAL THEME)

| Slice | Pre-audit | Post-audit | Outcome |
|-------|-----------|------------|---------|
| 4.E | 7 cites, 5 verified | 7 cites all verified | **BROKE at 2 fabs → RESET to 0** — fab function name `animsys_construct_orig_action_strip` + fab `clean_fcurve_segments` with wrong epsilon (1e-6 vs 1e-4) AND wrong formula (max-of-abs vs SUM-of-abs) — runtime leak |
| 4.F | No new cites | N/A | clean (no substrate) |
| 6.A | 3 cites, 1 verified | 9 cites all verified | **BROKE at 2 fabs → RESET to 0** — SELECT_* enum values fab; `mouse_action_keys` line range off ~370 lines (cited unrelated function); Ctrl+LMB folding claim fab |
| 6.B | 8 cites, 4 verified | 9 cites all verified | **BROKE at 1 fab → RESET to 0** — `BLI_rcti_isect_pt_v` inclusivity claim fab + INVERTED semantic (Blender uses strict inequality; SS used inclusive) + 3 cite truncations |

**4-slice consecutive fab streak** (4.D.4, 4.E, 6.A, 6.B) at the
same failure mode: cites that CLAIM Blender behavior (line ranges,
function names, enum values, formulas, semantics) all got
invented/truncated/inverted. Existence cites verified clean.

**Meta-feedback memory created this session:**
`feedback_byte_verify_behavior_cites.md` — codifies the pattern
+ the only effective mitigation (mark each behavioral claim
`[VERIFY]` while drafting → read cited lines → confirm → remove
marker → commit). "I'll be careful next time" is explicitly
declared NOT a mitigation. Sister to
`feedback_modifier_binding_check_keymap_first`.

---

## SS deviations this session (5 new; Phase-4-cumulative 22 +
Phase-6-cumulative 3)

### Phase 4 (DEVs 17-22 cumulative; +4 this session via Slice 4.E)

- DEV 17 — no per-frame scene update (pure eval, no dep-graph)
- DEV 18 — default-0 for unsampled rnaPaths (no RNA-current-value
  reader)
- DEV 19 — single-object bake (Blender batches N)
- DEV 20 — linear-only output interpolation
- DEV 21 — always-include-endpoint sample (clamp-to-end vs
  Blender's range-skip — user-friendly + intentional)
- DEV 22 — clean loop omits `fcu_orig_data` exemption (SS bakes
  fresh dense samples)

### Phase 6 (DEVs 1-3, all this session)

- DEV 1 (Slice 6.A) — Ctrl+LMB rebound to deselect mode (vs
  Blender's `action.select_leftright`); SS-original ergonomic
  choice for per-tick scope
- DEV 2 (Slice 6.B) — INCLUSIVE time-range bounds vs Blender's
  STRICT inequality (`ok_bezier_framerange` at
  `keyframes_edit.cc:559-567`); modern UI convention
- DEV 3 (Slice 6.B) — Axis-range mode (Alt+B → FRAMERANGE /
  CHANNELS) NOT shipped in 6.B; scope-deferred to 6.B.1 polish
  slice

---

## Dual-audit findings rolled up (4 sweeps this session: #67-#72)

| Sweep | Slice | HIGH | MED | LOW | CITE FABS |
|-------|-------|------|-----|-----|-----------|
| #67 (pre-session, 4.D.3) | — | — | — | — | — |
| #68 (pre-session, 4.D.4) | — | — | — | — | — |
| #69 | 4.E | 8 (5 fidelity + 3 architecture) | 6 | 1 | 2 |
| (4.F — no audit) | 4.F | — | — | — | — |
| #71 | 6.A | 6 (3 fidelity + 1 CRITICAL + 1 HIGH + 1) | 2 | 1 | 2 |
| #72 | 6.B | 3 (1 fidelity + 2 architecture) | 3 | 2 | 1 |

All findings addressed in same-day audit-fix commits.

**Cumulative session HIGH count: 17.** Cumulative cite fabs: 5.

---

## Test counts this session

| File | Pre-session | Post-session | Delta |
|------|------------|--------------|-------|
| test_bakeNla.mjs | 0 | 110 | **+110** (NEW) |
| test_nlaEval.mjs | 86 | 90 | +4 (§30/§31 stacked integration) |
| test_dopesheetSelectOps.mjs | 0 | 60 | **+60** (NEW) |
| test_dopesheetBoxSelect.mjs | 0 | 61 | **+61** (NEW) |

**+235 new asserts** across the 4 ship cycles. **Phase 4 cumulative:
735 asserts; Phase 6 cumulative: 121 asserts.** All sibling NLA /
FCurve / Keyform / Dopesheet test suites still green; typecheck
clean throughout.

---

## Rule №1 catches surfaced this session

1. **4.E HIGH-A1** — actionBlendmode validation was guarded by
   `boundActionEvaluatable`. Project with soloing + bad blendmode
   silently bypassed check. Fixed: unconditional when actionId set.

2. **4.E HIGH-A2** — handleBake silently ignored applyBakeNla's
   null return. Fixed: `logger.warn('NLAEditor.bake', ...)` per
   `feedback_in_app_logging`.

3. **4.E MED-A2** — bakeNla docstring promised purity but mutated
   the Map returned by evaluateNla. Fixed: `new Map(...)` copy.

4. **4.E HIGH-F4** — `actionExtendmode` read but not honored. Fixed:
   per-sample gating + clamp/skip per 'nothing'/'hold'/'hold_forward'.

5. **4.E HIGH-F5** — applyBakeNla bypassed `assignAction` (duplicated
   registry logic, silently inherited D-4/D-11 deviations). Fixed:
   route through `assignAction`; rollback on failure.

6. **6.A CRITICAL** — `useKeyformSelectionState` lied about identity-
   stability (returned new closure every render, invalidating
   downstream useCallback identities). Fixed: wrap in useCallback
   with stable Zustand action as only dep.

7. **6.A HIGH-A2** — double-click ran select-then-select-then-seek
   (detail=1 + detail=2 both fired onClick). Fixed: separate
   onDoubleClick handler.

8. **6.A HIGH-F3** — fab claim "Blender folds Ctrl+LMB into
   SELECT_INVERT" — real binding is `action.select_leftright`.
   Fixed: SS DEVIATION 1 with honest documentation.

9. **6.B HIGH-A1** — `handleTrackPointerMove` recreated callback
   on every drag-move event (60-120 Hz) via `[boxDrag]` dep.
   Fixed: empty deps + functional setter.

10. **6.B HIGH-F1** — fab cite `BLI_rcti_isect_pt_v` claimed Blender
    inclusive bounds; reality is STRICT inequality. Fixed: SS
    DEVIATION 2 + corrected cite to `ok_bezier_framerange:559-567`.

---

## Substantive SS deviations registered this session (5 new)

(Listed above per phase.)

DEVs in Phase 4 substrate inline JSDocs (4.E's `bakeNla.js` module
header); Phase 6 substrate inline JSDocs (`dopesheetSelectOps.js` +
`dopesheetBoxSelect.js` module headers). Plan also referenced via
the per-slice close-out + plan-§Phase-4 / §Phase-6 banner updates.

---

## Commits this session (12)

```
7e4a2a0 feat(anim): Phase 4 Slice 4.E — BakeNLA operator
6ebe3e2 fix(audit): Phase 4 Slice 4.E audit-fix
d8c3369 docs(plan): Phase 4 Slice 4.E SHIPPED — close-out
218c68c test(anim): Phase 4 Slice 4.F — NLA test parity sweep + manual checklists
e04e994 docs(plan): Phase 4 Slice 4.F SHIPPED — close-out
cfb82a9 feat(anim): Phase 6 Slice 6.A — Dopesheet tick selection + lift store
5b4cccd fix(audit): Phase 6 Slice 6.A audit-fix
8a1029e docs(plan): Phase 6 Slice 6.A SHIPPED — close-out
bdf95a8 feat(anim): Phase 6 Slice 6.B — Dopesheet box-select
dff1c99 fix(audit): Phase 6 Slice 6.B audit-fix
472b026 docs(plan): Phase 6 Slice 6.B SHIPPED — close-out
[upcoming: this aggregate + memory + plan-banner refresh]
```

---

## Top queued path next session

**Slice 6.C — Modal grab (G key) for time-translate of selected ticks.**

Per plan §6.B operator table: `dopesheet.grab | G | Modal drag
selection in time`. Mirrors Blender's `TRANSFORM_OT_translate` in
TFM_TIME_TRANSLATE mode invoked from `ACTION_OT_*` workflows.
Implementation needs:

- Modal state machine (G keypress enters; pointer move updates
  preview offset; LMB/Enter commits; RMB/Escape cancels).
- Pure op `applyTimeTranslate(action, selectedHandles, deltaMs)`
  that updates `keyform.time` for every selected center-bit entry
  while preserving handle offsets (`handleLeft.time` /
  `handleRight.time` shift by same delta to keep bezier shape).
- Live-preview overlay in Dopesheet (translucent ticks at proposed
  new positions during drag).
- Auto-keyform-sort after commit (the `keyforms[]` invariant is
  sorted-by-time — handle the case where the translate crosses
  adjacent keyforms).

After 6.C: **6.D** delete/duplicate → **6.E** column ops →
**6.F** per-channel mute/solo → **6.G** test sweep + Phase 6 exit
gate.

---

## Standing user-side carryover

- **Phase 3 + 4 manual verification checklist** still outstanding:
  `docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md` (FModifier
  UI + NLA end-to-end + bake→Cubism round-trip)
- **Phase 4 exit gate (4.G)** ships as docs-only commit when that
  checklist comes back fully `[x]`
- **Phase 6 manual checklist** accrues at 6.G

---

## Pre-compact state (snapshot)

- **Branch:** master, 170 commits ahead of origin (NEVER pushed
  per standing "Push only to origin" rule)
- **Working tree:** clean (12 commits this session, 11 in the
  aggregate above + this one)
- **Schema:** v42 (unchanged)
- **Phase status:**
  - Phase 0/1/2/3 SHIP-COMPLETE (pre-session)
  - Phase 4 SUBSTRATE-COMPLETE; 4.G user-blocked
  - Phase 5 SHIP-COMPLETE (pre-session; slices 5.A-5.NN)
  - Phase 6 OPEN: 2/7 slices SHIPPED (6.A + 6.B)
- **Tests added this session:** 235 new asserts (110 bakeNla + 4
  nlaEval + 60 dopesheetSelectOps + 61 dopesheetBoxSelect); all
  sibling suites still green; typecheck clean
- **Audit sweeps this session:** 3 (#69 + #71 + #72) — 4.F was
  docs-only, no audit. 17 cumulative HIGH findings, 5 cite fabs,
  all addressed in audit-fix commits.
- **Cite-discipline:** 4-consecutive-slice fab streak (4.D.4 / 4.E
  / 6.A / 6.B); meta-feedback memory created this session.
- **SS deviations:** 5 new this session (+4 in Phase 4 / +3 in
  Phase 6); cumulative 22 Phase 4 + 3 Phase 6.
- **User-side owed:** Phase 3/4 manual checklist (unified doc);
  Phase 6 manual checklist accrues at 6.G.
- **Next:** Slice 6.C — modal grab (G key) for time-translate.

Ready for `/compact`.
