# Animation Phase 5 — Session-spanning close-out: Slices 5.W → 5.X

Aggregate close-out for the 2 slices shipped in this session after the
prior `/compact` cut at `7830738` (the previous session-spanning
close-out for 5.T → 5.U → 5.V). Per-slice close-outs exist separately:
- [Slice 5.W](./SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_W.md)
- [Slice 5.X](./SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_X.md)

This doc is the cross-slice summary + queued-paths snapshot + pre-
compact state for whoever resumes next.

## Commits (this session, oldest → newest)

| SHA       | Slice | Type             | Subject                                                                              |
|-----------|-------|------------------|--------------------------------------------------------------------------------------|
| `7573c49` | 5.W   | substrate        | `feat(anim): Animation Phase 5 Slice 5.W — DopesheetEditor row-state styling`        |
| `caf2d1f` | 5.W   | audit-fix        | `fix(anim): Slice 5.W audit-fix sweep — DopesheetEditor row-state polish`            |
| `bdccfd6` | 5.W   | close-out        | `docs(plan): Animation Phase 5 Slice 5.W close-out`                                  |
| `0d5068d` | 5.X   | substrate        | `feat(anim): Animation Phase 5 Slice 5.X — Per-FCurve ACTIVE flag`                   |
| `c0a2468` | 5.X   | audit-fix        | `fix(anim): Slice 5.X audit-fix sweep — FCURVE_ACTIVE polish + cite corrections`     |
| `df929ec` | 5.X   | close-out        | `docs(plan): Animation Phase 5 Slice 5.X close-out`                                  |
| (this)    | —     | session close-out| `docs(plan): Session-spanning close-out for Slices 5.W → 5.X`                        |

7 commits in session; 70 commits ahead of `origin/master` pre-this-doc;
71 post.

## What shipped (per slice — single-line each)

| Slice | Closes                              | Substrate                                                                                          |
|-------|-------------------------------------|----------------------------------------------------------------------------------------------------|
| 5.W   | Phase 5 path #10 (Slice 5.J queue)  | `dopesheetRows.js` builder + mute-row/hide-row/active-keyform-row styling + `pickActiveFCurve` extraction to shared module |
| 5.X   | Phase 5 path #11 + Slice 5.W Dev 2  | `fcurveActive.js` (persisted FCURVE_ACTIVE bit, EXCLUSIVE) + 3-site FCurveEditor click integration + DopesheetEditor precedence flip; demotes `pickActiveFCurve` to bootstrap fallback |

## Audit-fix lane summary (cumulative across 2 slices)

| Lane          | 5.W                | 5.X                | Cumulative                  |
|---------------|--------------------|--------------------|-----------------------------|
| Architecture  | 1 HIGH + 4 MED + 4 LOW | 2 HIGH + 3 MED + 3 LOW | 3 HIGH + 7 MED + 7 LOW = 17 |
| Fidelity      | 2 HIGH + 3 MED + 2 LOW | 1 HIGH + 3 MED + 2 LOW | 3 HIGH + 6 MED + 4 LOW = 13 |
| Fab citations | 0                  | 0                  | 0 introduced                |
| Fab streak    | 1 (after 5.V reset) | 2                 | streak holding              |

**Streak narrative**: 5.V broke the post-5.P pre-verify streak (3 fab
cites + 1 inverted semantic). 5.W restored it — both HIGH findings
were SEMANTIC overclaims of real cites (not fabs). 5.X held — at
substrate slice volume with many new cites, all verified. Lesson 3
below covers what made 5.X work.

## Documented SS deviations (7 new across 2 slices — cumulative 49 across Phase 5)

| Slice | Deviation                                                                                | Closure condition                                               |
|-------|------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| 5.W-1 | Muted dopesheet rows alpha-dim (Blender's action editor doesn't)                         | None planned — sister styling in FCurveEditor justifies signal  |
| 5.W-2 | Active-keyform halo doesn't enforce keyform-selection precondition (`graph_draw.cc:254`) | Phase 5 path #42 (project-stored keyform selection or cross-editor subscription) |
| 5.W-3 | Hidden curves filtered from dopesheet (Blender's action editor keeps them)               | None planned — DopesheetEditor has no sidebar / un-hide affordance |
| 5.X-1 | Channel-deselect doesn't auto-clear `active`                                             | Path #40 (`applyChannelSelect.change_active=true` branch)       |
| 5.X-2 | Batch select-toggle doesn't auto-clear `active`                                          | Path #12 (queued NEW TOP)                                       |
| 5.X-3 | ACTIVE writes use `skipHistory:true` (inherited from 5.F's view-state stance)            | Same as 5.F — when 50-entry undo budget is no longer binding    |
| 5.X-4 | No active-restore pass after bulk select-toggle / deselect-all                           | Path #41 (downstream of #12)                                    |

Cumulative across Phase 5 Slices 5.L → 5.X:

| Slice | Count |
|-------|-------|
| 5.L   | 3     |
| 5.M   | 3     |
| 5.N   | 2     |
| 5.O   | 3     |
| 5.P   | 2     |
| 5.Q   | 4     |
| 5.R   | 3     |
| 5.S   | 7     |
| 5.T   | 7     |
| 5.U   | 3     |
| 5.V   | 6     |
| 5.W   | 3     |
| 5.X   | 4     |
| **Total** | **50** |

(5.Q Dev 3 closed by 5.T; Slice 5.W Dev 2 PARTIALLY closed by 5.X
gate; net active 48.)

## Self-deferral closures this session

| Closed                                          | When deferred       | Closing slice |
|-------------------------------------------------|---------------------|---------------|
| Slice 5.W Dev 2 (active-keyform halo per-channel gate) | 2026-05-17 (5.W) | 5.X partially — keyform-selection precondition still deferred |

## Schema migrations shipped

| Version bump | Migration | Slice |
|--------------|-----------|-------|
| (none)       | —         | both slices unchanged at v40 |

## Test additions this session

| File                                          | Assertions added (cumulative)  | Slice |
|-----------------------------------------------|-------------------------------:|-------|
| `scripts/test/test_dopesheetRows.mjs` (NEW)   | 41 (substrate) → 66 (+25 audit-fix) | 5.W   |
| `scripts/test/test_fcurvePicker.mjs` (NEW)    | 14                              | 5.W audit-fix |
| `scripts/test/test_fcurveActive.mjs` (NEW)    | 67 (substrate) → 75 (+8 audit-fix) | 5.X   |
| **Total** | **155 new across 3 modules** | session |

3 new test:* entries added to `package.json` aggregate chain.

## Queued resume paths (after 5.X)

| #   | Path                                                          | Status                            |
|-----|---------------------------------------------------------------|-----------------------------------|
| 1-9 | Earlier slices (5.L → 5.V)                                    | SHIPPED                           |
| 10  | DopesheetEditor row-state styling                             | SHIPPED in 5.W                    |
| 11  | Per-fcurve ACTIVE slot                                        | SHIPPED in 5.X                    |
| 12  | ANIM_OT_channels_select_box drag-rect on sidebar              | **NEW TOP** (closes 5.X Dev 2 + 4) |
| 13  | Phase 2 owed-manual verification                              | queued                            |
| 14  | **Phase 3 — F-Curve modifiers** (full phase)                  | queued                            |
| 15  | SS keymap-preset selector                                     | queued                            |
| 16  | Hide/reveal toast notifications                               | queued                            |
| 17  | Sidebar focus tracking for region-aware keys                  | queued                            |
| 18  | Popup-menu primitive                                          | queued                            |
| 19  | `fcurve.protected` (FCURVE_PROTECTED port)                    | queued                            |
| 20  | N-panel collapse-state persistence + multi-panel host         | queued                            |
| 21  | BezTriple selection-flag model + `HD_ALIGN_DOUBLESIDE`        | queued                            |
| 22  | Pre-verify cite discipline workflow item                      | queued                            |
| 23-27 | Driver polish (5.S devs)                                    | queued                            |
| 28-29 | Timecode/Mode-drivers (5.T devs)                            | queued                            |
| 30-32 | NumInput polish (5.U devs)                                  | queued                            |
| 33  | Auto-group on fcurve add (closes 5.V Dev 5)                   | queued                            |
| 34  | Group-flush helper (closes 5.V Dev 6)                         | queued                            |
| 35  | Group-children select operator (Shift+Ctrl+click)             | queued                            |
| 36  | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1)   | queued                            |
| 37  | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2)                 | queued (downstream of #14)        |
| 38  | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3)             | queued                            |
| 39  | Slice 5.V MED-3 fidelity cite cleanup (hide cascade)          | queued                            |
| 40  | `applyChannelSelect.change_active=true` branch (closes 5.X Dev 1) | queued                        |
| 41  | Active-restore pass on bulk select-toggle (closes 5.X Dev 4)  | queued (downstream of #12)        |
| 42  | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | queued                          |

## Pre-compact state

| Property                       | Value                                                                |
|--------------------------------|----------------------------------------------------------------------|
| Branch                         | `master`                                                             |
| Commits ahead of origin/master | 70 (pre-session-close); 71 post                                      |
| Working tree                   | clean                                                                |
| typecheck                      | clean                                                                |
| Touched-paths suites           | green (run after each slice's audit-fix sweep)                       |
| Schema version                 | 40 (unchanged across both slices)                                    |
| Fab streak                     | 2 (5.W + 5.X held; broke at 5.V before that)                         |
| Top queued path                | #12 — ANIM_OT_channels_select_box drag-rect on sidebar               |
| New shared modules             | `src/anim/fcurvePicker.js` (5.W) + `src/anim/fcurveActive.js` (5.X) |

## Session lessons

1. **Memo-dep narrowing has to be enforced per-slice.** Slice 5.W's
   H1 audit-fix narrowed the `rows` memo deps in DopesheetEditor.
   Slice 5.X's substrate added a NEW memo right next door with the
   broad deps the 5.W fix had just removed. Same pattern, same
   regression class. When adding a memo near a recently-narrowed
   one, mirror the narrowing convention as a habit — don't wait for
   the next audit to catch it. (Both 5.W H1 and 5.X H1 were arch-
   audit catches that took ~5 min each to fix; the lesson is to
   apply the convention proactively.)

2. **Reference-identity comparisons inside immer recipes are
   brittle.** Slice 5.X's substrate `setActiveFCurve` used
   `fc === target` after pre-resolving target via `.find(...)`.
   Worked under immer drafts but would silently FAIL (deleting ALL
   active flags) under any future call site resolving target from a
   different array slice. ID-based compare eliminates the coupling
   and costs nothing. Lesson: prefer structural compare
   (`fc.id === fcurveId`) over reference compare inside loops that
   mutate, even when reference compare is "correct" today.

3. **Cite chain accuracy matters even when behaviour is correct.**
   Across this session's 6 fidelity findings, 4 were cite-chain
   corrections — the SS port behaviour was right, but comments
   mis-attributed which Blender file/line/operator was being
   mirrored. Each fix took ~2 min; debugging from a wrong cite
   later would have cost more. The pre-verify discipline applies
   to *which* code is mirrored, not just *whether* the cited line
   exists.

4. **"Demoted to fallback" is not the same as "retired."** Slice
   5.W's close-out claimed Slice 5.X would "retire `pickActiveFCurve`".
   The actual right answer is "demote to bootstrap fallback" because
   of the no-migration policy on `fc.active`. Per Rule №2, principled
   intrinsic fallbacks (not transitional shims) are fine. Updating
   the close-out claim DURING 5.X (not after) kept the in-flight
   memory and JSDoc honest.

5. **Pre-verify discipline scales to substrate slices when applied
   per-cite.** 5.V was the substrate-slice fab cluster (3 fabs + 1
   semantic). 5.W and 5.X both held the streak — 5.X especially
   notable because it was the larger of the two with multiple
   Blender callsite cites (`ANIM_set_active_channel`,
   `mouse_graph_keys`'s two write sites, `graphkeys_deselectall_exec`,
   `ANIM_OT_channels_click`). Pattern: Read each cited file/line
   BEFORE writing the JSDoc that references it. ~3 min per cite,
   amortises across many.

6. **Closing a self-deferral may surface MORE deviations.** Slice
   5.X closed 5.W Dev 2 (active-keyform halo per-channel gate) but
   only PARTIALLY — the keyform-selection precondition
   (`graph_draw.cc:254`: `if (!(bezt->f2 & SELECT)) return;`) remains
   unported, now tracked as queued path #42. Slice 5.X added 4 new
   deviations of its own. Closing one substrate-level gap often
   reveals 2-3 fine-grained gaps that were previously masked. This
   isn't bad — it's healthy decomposition of "TODO: do FCURVE_ACTIVE
   properly" into "TODO: do FCURVE_ACTIVE properly except for
   `change_active=true` branch + bulk select-toggle + keyform-
   selection precondition + active-restore pass". Each item is
   independently shippable in a later slice.

7. **Sister code consistency catches regressions before audits.**
   Multiple fixes this session were sister-pattern enforcement
   (5.W L4: dot-doesn't-branch-on-isHidden inline note; 5.X H1:
   memo deps narrowing matching `decoded` memo style; 5.X HIGH-2
   arch: extending the Slice 5.J LOW-A1 closure-purity comment to
   cover new 5.X writes). Pattern: when touching a file, scan
   the nearby code for the convention you'd otherwise drift from,
   and either match it OR explicitly document the divergence.
