# Session Aggregate — Animation Phase 4 (5/7 sub-slices SHIPPED)

**Session date range:** 2026-05-18 → 2026-05-19
**Branch:** master (149 commits ahead of origin/master, +14 this session)
**Schema progression:** v41 → **v42** (Slice 4.A bump)
**Phase 4 status:** 5/7 sub-slices SHIPPED (4.A + 4.B + 4.C + 4.D.1 + 4.D.2)
**Cite-discipline:** BROKE at 5 on 4.D.1 → reset → HOLDS at 1 post-reset after 4.D.2

---

## Session-spanning summary

This session opened with Phase 3 (FModifiers) SHIP-COMPLETE and
advanced through 5 sub-slices of Phase 4 (NLA stack). Each
sub-slice followed the established cadence: substrate commit →
dual-audit (architecture + Blender-fidelity in parallel) →
same-day audit-fix sweep → per-slice close-out doc.

| Sub-slice | Substrate | Audit-fix | Close-out | Tests added |
|-----------|-----------|-----------|-----------|-------------|
| 4.A — NLA substrate (schema v42) | `eba15ab` | `410459b` | `43fd4ff` | 183 |
| 4.B — NLA evaluator | `d91060d` | `8d03d4c` | `acdd871` | 86 |
| 4.C — NLA tweak mode | `f0fd4be` | `3ae4c5e` | `16383fc` | 75 |
| 4.D.1 — NLAEditor read-only | `5385734` | `6f52410` | `7f5d802` | 56 (+2 LOW-A4) |
| 4.D.2 — NLAEditor drag | `151cea0` | `35367c2` | `ba9657e` | 64 |
| **Session aggregate** | | | this doc | **466** |

**Phase 4 cumulative test count: 466 assertions** (185 v42 substrate
+ 86 evaluator + 75 tweak-mode + 56 editor data + 64 editor ops).

---

## Per-sub-slice ledger

### Slice 4.A — NLA substrate (schema v42)

**Closes**: data shapes + flag constants the rest of Phase 4 consumes.

- New `src/store/migrations/v42_nla_substrate.js` — adds 4 AnimData
  backup pointers (`tmpActionId` / `tmpSlotHandle` / `tweakTrackId` /
  `tweakStripId`) corrected from a wrong plan §4.A claim that
  Phase 1 already shipped them. Verified via
  `feedback_check_plan_against_impl_on_consumption`.
- New `src/anim/nla.js`:
  - `NLA_BLEND_MODES` frozen 4-mode list (replace/add/subtract/multiply;
    combine deferred per Rule №1)
  - `NLA_EXTEND_MODES` frozen 3-mode list (full Blender parity)
  - `NLASTRIP_FLAG` / `NLATRACK_FLAG` / `ADT_FLAG` bit enums
    byte-faithful to `DNA_anim_enums.h`
  - `makeNlaStrip` / `makeNlaTrack` constructors with positional-args-
    wins protection + enum-bounds validation
  - `isNlaTrack` / `isNlaStrip` predicates (LOW-A4 audit-fix tightened
    to reject empty-string id/actionId)
  - `getNlaTracks` with stable `EMPTY_NLA_TRACKS` frozen sentinel
  - `isTweakModeOn` flag reader
- v36 + v37 `defaultAnimData()` + projectStore.js's 2 inlined scene-
  node literals parallel-updated +4 fields each.
- 183 new asserts in `test_migrationV42.mjs` (later +2 from 4.D.1
  audit-fix → 185).

**Audit sweep #62**: 4 MED + 4 LOW addressed (TDZ footgun, spread-
order clobber, v36 drift untested, corrupt-skip silent +
imprecise cites + JSDoc overclaim of BKE_nlastrip_new defaults).
Cite-discipline HOLDS at 3 (3.F→3.G→4.A clean).

**2 SS deviations introduced**: makeNlaStrip flag=0 vs Blender
SELECT|SYNC_LENGTH; makeNlaTrack flag=0 vs Blender SELECTED|
OVERRIDELIBRARY_LOCAL.

### Slice 4.B — NLA evaluator

**Closes**: bottom-to-top stack walker + 4 blend kernels +
remapStripTime + computeStripInfluence + tweak-skip stub.

- New `src/anim/nlaEval.js`:
  - `evaluateNla(animData, time, project) → Map<rnaPath, value>`
  - `applyBlendMode` byte-faithful to Blender `nla_blend_value`
    (anim_sys.cc:1841-1873)
  - `remapStripTime` byte-faithful to `nlastrip_get_frame_actionclip`
    (nla.cc:707-770) including USR_TIME / USR_TIME_CYCLIC wiring
    (audit-fix MED-F4)
  - `computeStripInfluence` blendin/blendout ramps + USR_INFLUENCE
    (anim_sys.cc:1009-1027)
  - `stripActiveAt` extendmode gating
  - Mute/solo per `BKE_nlatrack_is_enabled` (nla.cc:690-697)
  - Tweak-mode strip skip stub for 4.C
- 86 new asserts in `test_nlaEval.mjs`.

**Audit sweep #63**: 2 HIGH (1 false-alarm) + 4 MED + 1 LOW.
Notable: HIGH-A1 O(n²) Map allocation → in-place mutation;
HIGH-A2 tweakStripId='' falsy footgun; MED-A4 boundary blendmode
validation (Rule №1: kernel stays hot-path-clean, evaluator gate
throws); MED-F4 USR_TIME wire (substrate exposed flag; evaluator
must honor it). Cite-discipline HOLDS at 4.

**3 SS deviations**: lower-default=0 for absent rnaPath in acc
(Blender uses RNA default); multi-strip extend-hold no neighbor
awareness; `influence <= 0` skip more aggressive than Blender's
`IS_EQF`.

### Slice 4.C — NLA tweak mode

**Closes**: state-transition helpers paralleling Blender's
`BKE_nla_tweakmode_enter/exit/clear_flags`.

- New `src/anim/nlaTweakMode.js`:
  - `enterTweakMode(animData, trackId, stripId)` — byte-faithful
    port of nla.cc:2352-2456 (TWEAKUSER tag loop, DISABLED cascade,
    action swap, backup pointers, flag set)
  - `exitTweakMode(animData, project?)` — byte-faithful port of
    nla.cc:2492-2565 + audit-fix HIGH-F5 **SYNC_LENGTH bound sync**
    (originally claimed as SS deviation but auditor correctly
    identified as buildable; wired in audit-fix)
  - `clearTweakFlags(animData)` — byte-faithful port of nla.cc:2567-2577
- 75 new asserts in `test_nlaTweakMode.mjs` including evaluator
  integration tests (tweak skip + DISABLED cascade → only undisabled
  lower track contributes).

**Audit sweep #64**: 2 HIGH + 6 MED + 4 LOW. Notable: HIGH-A1 §10
round-trip fixture had slotHandle=0 (couldn't detect missing
tmpSlotHandle save) — fixed with nonzero+sentinel; HIGH-A2
different-strip-while-in-tweak silent success → reject false; HIGH-F5
SYNC_LENGTH actually buildable today. Cite-discipline HOLDS at 5.

**5 SS deviations documented in numbered module-level block**:
no action refcount, no RNA notify, no slot validation, explicit-IDs
API vs Blender's active-bit discovery, tmpSlotHandle=0 sentinel.

### Slice 4.D.1 — NLAEditor read-only (CITE-DISCIPLINE BROKE AT 5)

**Closes**: NLAEditor surface registered + read-only track/strip
render.

- New `src/v3/editors/nla/nlaEditorData.js` — pure data layer:
  `buildNlaEditorRows`, `computeTimelineSpan`, `BLENDMODE_LABELS`,
  `BLENDMODE_COLORS`
- New `src/v3/editors/nla/NLAEditor.jsx` — read-only render with
  ruler + group headers + track rows + strip rects (colored by
  blendmode; tweak strip yellow border)
- Registration in `editorRegistry.js` + `uiV3Store.js` Animation
  workspace
- 56 new asserts in `test_nlaEditorData.mjs`

**⚠️ Cite-discipline streak BROKEN at 5** on this slice:
- Substrate commit `5385734` fab'd 2 Blender citations:
  - `rna_nla.cc:236-260 (rna_enum_nla_strip_mode_items)` was actually
    `:32-61 (rna_enum_nla_mode_blend_items)` — labels correct,
    identifier had transposed word + line range was unrelated
    `rna_NlaStrip_start_frame_set` clamp logic
  - `bl_app_templates_system/General/startup.blend` nonexistent path
    — General template is implicit-default with no template folder
- Caught by fidelity audit BEFORE user impact; both fabs corrected
  in audit-fix `6f52410`
- Per established convention, streak counter reflects pre-audit-fix
  state. Streak resets to 0 for 4.D.2.

**Audit sweep #65**: 2 HIGH cite fabs + 3 MED (pxWidth hoist,
empty-state differentiation, letter-vs-icon SS deviation block) + 1
LOW (isNlaStrip non-empty tightening — added 2 asserts to v42 test).

**1 SS deviation introduced**: letter badges (S/M/P/D) vs Blender
icons (re-litigated in Slice 4.D.3).

### Slice 4.D.2 — NLAEditor drag interactions (cite-discipline RESTART)

**Closes**: strip move/resize + track reorder + ResizeObserver
timeline + dual-pane drag-ownership.

- New `src/v3/editors/nla/nlaEditorOps.js` — pure-function ops:
  `applyMoveStrip`, `applyResizeStripStart`, `applyResizeStripEnd`,
  `applyReorderTrack` (re-stamps drifted indices per Slice 4.C audit
  MED-A3 contract), `would*Change` predicates, pxToMs helpers,
  `MIN_STRIP_MS = 1` constant
- NLAEditor.jsx substantial rewrite: full drag state machine
  (union typedef for StripDragState | TrackDragState), callback-ref
  ResizeObserver (re-attaches on empty→populated transition),
  module-level Symbol gates dual-pane double-commit, commit-on-
  pointerup for one-undo-snapshot-per-drag matching Blender modal-op
  `OPTYPE_UNDO`
- 64 new asserts in `test_nlaEditorOps.mjs`

**Audit sweep #66**: 1 HIGH Rule №1 (track reorder claimed in scope,
ops shipped + tested, JSX imported but no handler wired) + 1 HIGH
content (overlap rationale misdescribed SS's own evaluator behavior)
+ 4 MED + 2 LOW. Both HIGH addressed in audit-fix `35367c2`.

**Cite-discipline status**: all 4 Blender citations verified
byte-exact (`BKE_nlastrip_within_bounds`, IS_EQF zero-length,
`BKE_nlastrip_distance_to_frame`, `nlastrip_fix_resize_overlaps`).
Plus 4.D.1 correction verified. **HOLDS at 1 post-reset**.

**2 SS deviations**: no-overlap enforcement (Blender's
`nlastrip_fix_resize_overlaps` not ported; overlapping strips
evaluator-valid via `applyBlendMode`); 6px edge-resize hitbox is
SS-original (Blender uses transform modal).

---

## Cite-discipline narrative

Fab streak (Blender-citation specific) progression:
- 5.P broke at 0 (`interface_template_status.cc:475` fab caught by
  fidelity audit, broke zero-fab streak at 5)
- 3.F HOLDS at 1
- 3.G HOLDS at 2
- 4.A HOLDS at 3
- 4.B HOLDS at 4
- 4.C HOLDS at 5
- **4.D.1 BROKE** (2 fab'd citations in substrate `5385734`,
  caught + corrected in `6f52410`)
- 4.D.2 RESTART → **HOLDS at 1 post-reset**

**Sister contract (content-accuracy)**: 4.D.2 also introduced a
HIGH-F1 content break (overlap rationale misdescribed `evaluateNla`)
that was caught + fixed in the same audit sweep. The cite-discipline
streak counter is specifically for Blender-citation fabs; the
content-accuracy class is tracked separately but addressed with the
same rigour.

---

## SS deviations cumulative (10 documented across Phase 4)

| # | Slice | Deviation |
|---|-------|-----------|
| 1 | 4.A | makeNlaStrip flag=0 vs Blender SELECT\|SYNC_LENGTH |
| 2 | 4.A | makeNlaTrack flag=0 vs Blender SELECTED\|OVERRIDELIBRARY_LOCAL |
| 3 | 4.B | Lower-value default=0 for absent rnaPath (Blender uses RNA default) |
| 4 | 4.B | Multi-strip extend-hold no neighbor awareness |
| 5 | 4.B | `influence <= 0` skip more aggressive than Blender's IS_EQF |
| 6 | 4.C | No action refcount / Slot-user-map updates |
| 7 | 4.C | Explicit-IDs API vs Blender's active-bit discovery |
| 8 | 4.D.1 | Letter badges (S/M/P/D) vs Blender icons (4.D.3 re-litigation) |
| 9 | 4.D.2 | No-overlap enforcement (overlapping strips evaluator-valid) |
| 10 | 4.D.2 | 6px edge-resize hitbox SS-original (Blender uses transform modal) |

Notes: 4.C documentation lists 5 numbered deviations but several are
project-wide stances (no refcount, no RNA notify, no slot validation)
that overlap conceptually; the table above lists the load-bearing
ones for cross-slice tracking.

---

## Files touched this session (14 commits)

**New files (10):**
- src/store/migrations/v42_nla_substrate.js
- src/anim/nla.js
- src/anim/nlaEval.js
- src/anim/nlaTweakMode.js
- src/v3/editors/nla/nlaEditorData.js
- src/v3/editors/nla/NLAEditor.jsx
- src/v3/editors/nla/nlaEditorOps.js
- scripts/test/test_migrationV42.mjs
- scripts/test/test_nlaEval.mjs
- scripts/test/test_nlaTweakMode.mjs
- scripts/test/test_nlaEditorData.mjs
- scripts/test/test_nlaEditorOps.mjs

**Modified (substantial):**
- src/store/projectSchemaVersion.js (41 → 42)
- src/store/projectMigrations.js (v42 registration)
- src/store/migrations/v36_action_datablock.js (+4 fields)
- src/store/migrations/v37_scene_anim_data.js (+4 fields)
- src/store/projectStore.js (2 inlined scene-node literals +4 each)
- src/store/uiV3Store.js (EditorType +'nla'; Animation workspace +nla
  4th tab)
- src/v3/shell/editorRegistry.js (NLAEditor lazy registration)
- scripts/test/test_migration_v37.mjs (drift test field count 8→12 +
  4 new literals)
- package.json (×5 test entries + 5 aggregate-test insertions)

**Plan + close-out docs (7):**
- docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md (§Phase 4 ship-status
  banner + §4.A/4.B/4.C SHIPPED markers + plan-claim correction note)
- docs/plans/SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_4_SLICE_A.md
- docs/plans/SESSION_CLOSEOUT_2026_05_18_ANIMATION_PHASE_4_SLICE_B.md
- docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_4_SLICE_C.md
- docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_4_SLICE_D1.md
- docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_4_SLICE_D2.md
- docs/plans/SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_4_SESSION_AGGREGATE.md
  (this doc)

---

## Top queued path next session

**Slice 4.D.3 — affordances** (~2 days projected):
- Per-track Mute/Solo toggle clickable indicators (replace 4.D.1
  read-only S/M letter badges)
- Per-strip blend-mode dropdown (uses BLENDMODE_LABELS from 4.D.1
  + Slice 4.A's NLA_BLEND_MODES)
- "Edit Action" button per strip → calls Slice 4.C `enterTweakMode`
- "Exit Tweak" button at group header → calls 4.C `exitTweakMode`
- Per-strip influence slider (0..1)
- Letter badges → Lucide icons per 4.D.1 MED-F1 re-litigation gate

Slice 4.D.3 wires the Slice 4.C tweak-mode helpers into the UI
surface. After 4.D.3, the tweak-mode workflow is end-to-end
user-driven.

**Remaining Phase 4 slices after 4.D.3**:
- 4.D.4 — Push Action Down + track/strip CRUD context menus
- 4.E — BakeNLA operator
- 4.F — per-feature test parity sweep
- 4.G — phase exit gate + UI manual verification checklist

---

## User-side manual verification owed

Phase 3 manual verification checklist (`docs/plans/PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md`)
is STILL outstanding — owed from prior session. Phase 4 will accrue
its own manual checklist at 4.G (drag interactions, blend-mode UX,
tweak-mode workflow, BakeNLA round-trip).

---

**Session aggregate close.** Phase 4: 5/7 sub-slices complete; ready
for `/compact` then 4.D.3.
