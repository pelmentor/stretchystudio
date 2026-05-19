# Session Closeout — Animation Phase 4 Slice 4.D.4 (NLAEditor CRUD + Push Action Down)

**Date:** 2026-05-19
**Branch:** master (159 commits ahead of origin/master, +2 this slice)
**Schema:** v42 (no bump — UI-only slice)
**Status:** SHIPPED — substrate `12f992f` + audit-fix `09ee4dd`
**Phase 4:** 7/7 sub-slices of 4.D complete (4.D.1 + 4.D.2 + 4.D.3 + 4.D.4);
remaining phase 4 work: 4.E (BakeNLA) + 4.F (test parity) + 4.G (exit gate).

---

## What 4.D.4 ships

Plan §4.D.4 CRUD scope items:

1. ✅ **"+ Track" button** per GroupHeader (always visible). Creates
   a fresh empty `NlaTrack` at the top of the stack via
   `applyAddTrack`. Auto-unique name with Blender-style `.NNN`
   suffix on collision.

2. ✅ **"+ Strip" button** per track row. Opens `ActionPickerPopover`
   listing all project actions; clicking one adds a strip via
   `applyAddStrip`. Disabled on PROTECTED tracks (UI gate + substrate
   gate per Rule №1 dual-enforcement). Auto-positions to the
   leftmost free range that fits the action's duration.

3. ✅ **"Push Down" button** per GroupHeader (visible when
   `animData.actionId` is set + not in tweak mode). Calls
   `applyPushActionDown` — byte-faithful port of Blender's
   `BKE_nla_action_pushdown` (`nla.cc:2248-2294`). Tries top track
   first; creates new track named after the action if top is full
   or PROTECTED. Clears `actionId` + `slotHandle` on success.

4. ✅ **Right-click context menu (track)**: Toggle Mute/Solo/Protect
   + Delete (disabled with reason on PROTECTED or tweak-strip-holds).

5. ✅ **Right-click context menu (strip)**: Edit Action (calls Slice
   4.C `enterTweakMode`) + Toggle Mute + Delete (disabled with
   reason in tweak mode or PROTECTED track).

6. ✅ **Delete button** (Trash2 icon) in `StripPropertiesPanel`
   footer. Same `wouldRemoveStripChange` gate as context-menu Delete.

7. ✅ **Empty groups now render** with the +Track button (pre-4.D.4
   we filtered them out because there was no way to create tracks
   from UI). Users can now bootstrap their first track from the
   empty state.

8. ✅ **Local context-menu primitive** (`NlaContextMenu`) embedded
   in NLAEditor.jsx. Does NOT use the global `useEditMenuStore` /
   `CanvasContextMenu` (those are single-instance-only for canvas
   use; dual-pane NLAEditor instances would conflict).

Concretely:

- **EDITED [src/v3/editors/nla/nlaEditorOps.js](../../src/v3/editors/nla/nlaEditorOps.js)** (~1080 LOC; +470 this slice)
  — 5 new pure-function ops (`applyAddTrack`, `applyAddStrip`,
  `applyRemoveStrip`, `applyRemoveTrack`, `applyPushActionDown`) + 4
  `wouldXChange` predicates + 7 helpers (`readActionDurationMs`,
  `readActionStartMs`, `readActionName`, `uniqueTrackName`,
  `uniqueStripId`, `rangesOverlap`, `findFreeRangeStart`).

- **EDITED [src/v3/editors/nla/NLAEditor.jsx](../../src/v3/editors/nla/NLAEditor.jsx)** (~1600 LOC; +470 this slice)
  — `NlaContextMenu` + `ActionPickerPopover` components + 5 new
  operator handlers + GroupHeader extensions (+Track / Push Down
  buttons + animData prop) + TrackRow extensions (+Strip button +
  right-click handlers) + StripPropertiesPanel Delete button.

- **EDITED [scripts/test/test_nlaEditorOps.mjs](../../scripts/test/test_nlaEditorOps.mjs)** (~510 LOC; +86 this slice)
  — 16 new sections (31-46): addTrack/addStrip/removeStrip/
  removeTrack/pushActionDown happy paths + paired wouldChange
  predicates + edge cases (PROTECTED + tweak mode + Rule №1 half-
  commit verification 45f).

## Cite-discipline arc — **BROKE at 2, RESET to 0**

Fidelity audit verified **11/13 Blender citations BYTE-EXACT** but
found **2 FABRICATED** in the substrate commit:

1. `nla.cc:706-744 BKE_nlatrack_remove_and_free` — actual function
   at `nla.cc:684-688` (3-liner). Lines 706-744 are
   `nlastrip_get_frame_actionclip` (evaluation-time mapping,
   unrelated). Cited in nlaEditorOps.js applyRemoveTrack JSDoc +
   NLAEditor.jsx module JSDoc + commit message. **CORRECTED** to
   `nla.cc:684-688` for the function + `nla.cc:109-126` for
   `BKE_nlatrack_free` (which has the per-strip cascade loop).

2. `nla.cc:937-955 BKE_nlastrips_has_space` — actual function at
   `nla.cc:860-890`. Lines 937-955 are
   `BKE_nlastrips_add_strip_unsafe` (chronological insertion,
   not range-overlap). Cited in nlaEditorOps.js `rangesOverlap`
   docstring. **CORRECTED** to `nla.cc:860-890` (and the
   `rangesOverlap` helper itself was deleted as dead code per Rule
   №2 — never referenced inside the module).

**Verified byte-exact (11):** `nla.cc:2248-2294`
BKE_nla_action_pushdown; `nla.cc:590-625` BKE_nlastack_add_strip;
`nla.cc:617` STRNCPY_UTF8 naming; `nla.cc:1361-1379`
BKE_nlatrack_add_strip PROTECTED gate; `nla.cc:957-969`
BKE_nlastrips_add_strip; `nla_tracks.cc:736-738` SOLO clear on
removed track; `nla.cc:358-367` BKE_nlatrack_new default flags;
`nla_edit.cc:1297` defensive BKE_nla_tweakmode_exit;
`nla.cc:2274-2276` act_* copy on push; `nla.cc:2278-2290`
USR_INFLUENCE escalation; `nla.cc:2266` actionId clear.

Fab streak: 5.P broke at 0 → 3.F HOLDS at 1 → 3.G HOLDS at 2 →
4.A HOLDS at 3 → 4.B HOLDS at 4 → 4.C HOLDS at 5 → **4.D.1 BROKE**
→ reset → 4.D.2 HOLDS at 1 → 4.D.3 HOLDS at 2 → **4.D.4 BROKE at
2, RESET to 0**.

## Lesson — Explore agent cites need byte-verification

The substrate ran the Explore subagent for Blender CRUD-operator
reconnaissance. I verified the marquee `BKE_nla_action_pushdown` +
`BKE_nlastack_add_strip` cites byte-exact before pasting, but
**didn't re-verify the helper-function cites** the agent surfaced.
Both fab cites came from the agent's summary table.

Per `feedback_modifier_binding_check_keymap_first` (generalized):
the rule is "verify EVERY Blender citation byte-exact" — not "verify
the load-bearing ones". Future slices must spot-verify EVERY cite
the reconnaissance agent returns, not a subset.

## Dual-audit findings (commit `09ee4dd`)

### Architecture (2 HIGH + 4 MED + 1 LOW addressed)

- **HIGH-A1 (Rule №1 documentation contract)**: `applyAddStrip`
  JSDoc claimed "REFUSES to add if it would overlap" — impl actually
  auto-positions rightward via `findFreeRangeStart`. Module JSDoc +
  function JSDoc + no-overlap-deviation block all conflicted with
  each other AND with impl. **Fix**: Added SS DEVIATION 15
  documenting the auto-position divergence; corrected all 3 JSDoc
  sites.

- **HIGH-A2 (Rule №2 dead code)**: `EmptyState` else-branch was
  unreachable (component only called with `noAnimData={true}`). Dead
  branch carried stale "shipping in Slice 4.D.4" copy describing
  THIS commit's feature. **Fix**: Removed else-branch + the
  `noAnimData` prop; collapsed to a single message.

- **MED-A2**: `applyPushActionDown` docstring claimed "creates new
  track if last track rejects (no space or no last track)" — "no
  space" branch unreachable per the same auto-position behavior
  (only PROTECTED triggers the fallback). **Fix**: Trimmed docstring
  + cross-ref'd DEVIATION 15.

- **MED-A2-cleanup**: `wouldRemoveStripChange` had unnecessary IIFE
  wrapper around `locateStrip`. **Fix**: Direct destructure.

- **MED-A3**: `wouldAddTrackChange` exported but never used or
  tested (dead surface). **Fix**: Removed. Updated `applyAddTrack`
  JSDoc to note "no wouldAddTrackChange predicate — adding never
  no-ops".

- **MED-A4**: `handleRemoveStrip` / `handleRemoveTrack` cleared
  selection UNCONDITIONALLY on call. If substrate refused (PROTECTED
  changed between menu-open + click), selection got cleared anyway
  → stale-delete erasing editor state with no visible effect.
  **Fix**: Lifted both handlers to inline `updateProject` to observe
  `ad !== node.animData`; gate selection-clear on `didChange` flag.

- **LOW-A1**: `uniqueStripId` / `uniqueTrackName` had silent
  `Date.now()` fallback on 100k / 10k collisions. Rule №1 silent-
  fallback. **Fix**: Throw on overflow.

### Fidelity (2 HIGH cite fabs + 4 MED + 2 LOW; 1 already handled by HIGH-A1)

- **HIGH-A1 (fidelity, cite fab)**: `nla.cc:706-744` — corrected
  above.

- **HIGH-A2 (fidelity, cite fab)**: `nla.cc:937-955` — corrected
  above; helper deleted.

- **MED-A1 (fidelity)**: Same issue as architecture HIGH-A1 —
  auto-position deviation. Addressed in DEVIATION 15.

- **MED-A2 (fidelity)**: Push-down top-track always succeeds per
  DEVIATION 15. Addressed in MED-A2 (architecture).

- **MED-A3 (fidelity)**: Transition cascade (Blender
  `nla_edit.cc:1300-1307` removes adjacent NLASTRIP_TYPE_TRANSITION
  strips on delete) not documented as Phase 4 deferral. **Fix**:
  Added "No transition cascade" note to applyRemoveStrip JSDoc.

- **MED-A4 (fidelity)**: `applyRemoveTrack` skips Blender's
  `do_id_user=true` action refcount decrement. SS has no refcount
  system. **Fix**: Added SS DEVIATION 16 to applyRemoveTrack JSDoc.

- **LOW-A1 (fidelity)**: `readActionName` paraphrased Blender's
  `id.name + 2` as if SS did the prefix-strip too. SS has no
  ID-block-name concept; `action.name` stores the display string
  directly. **Fix**: Tightened docstring.

- **LOW-A2 (fidelity)**: `uniqueTrackName` `.NNN` format matches
  Blender's `BKE_id_new_name_validate`. VERIFIED equivalent — no
  fix needed.

- **LOW-A3 (fidelity)**: `applyAddTrack` default-flag deviation
  chain verified through `makeNlaTrack`. Already documented at
  Slice 4.A. No fix needed.

## Test coverage delta

| Test | Before | After | Delta |
|------|--------|-------|-------|
| test_nlaEditorOps.mjs (extended this slice) | 123 | 209 | +86 |

**New Phase 4 cumulative assertions: 185 (v42) + 86 (nlaEval) +
85 (nlaTweakMode) + 56 (nlaEditorData) + 209 (nlaEditorOps) = 621.**

## Files touched (commits `12f992f` + `<PENDING audit-fix>`)

| File | Purpose |
|------|---------|
| src/v3/editors/nla/nlaEditorOps.js | +5 ops + 4 predicates + 7 helpers |
| src/v3/editors/nla/NLAEditor.jsx | NlaContextMenu + ActionPickerPopover + 5 operator handlers + GroupHeader/TrackRow extensions + StripPropertiesPanel Delete |
| scripts/test/test_nlaEditorOps.mjs | +16 test sections (31-46) including the 45f Rule №1 half-commit safeguard |

## Rule №1 in-substrate fix

During test-writing, **test 45f** caught a Rule №1 violation in the
initial `applyPushActionDown` impl: if the action was missing from
the project, both `applyAddStrip` attempts failed silently but the
final `return` still cleared `actionId` + `slotHandle`. Net result:
user loses their actionId AND ends up with a stray empty new track
(from the `applyAddTrack` between attempts). Classic silent
half-success.

Fix landed in the SAME substrate commit (not deferred to audit-fix)
since the "no half-commit" contract is the substrate's invariant.
The op now early-returns `animData` on both-attempts-failed.

## SS deviations (Phase 4 cumulative now 16; +4 this slice)

This slice introduces **4 new** documented SS deviations:

13. **No `act_blendmode` / `act_influence` / `act_extendmode`
    inheritance on Push Down** (`nlaEditorOps.js`
    `applyPushActionDown`). Blender (`nla.cc:2274-2276`) copies
    these from AnimData to the new strip; SS's animData doesn't
    model those fields (no `act_*` on v42 schema). Strip lands with
    `makeNlaStrip` defaults.

14. **No `USR_INFLUENCE` escalation on Push Down**. Blender
    (`nla.cc:2278-2290`) sets `NLASTRIP_FLAG_USR_INFLUENCE` if
    `act_influence < 1.0f`. SS skips per deviation 13.

15. **Auto-position on overlap** (`applyAddStrip`, audit-fix HIGH-A1).
    Blender's `BKE_nlatrack_add_strip` (`nla.cc:1361-1379`) returns
    `false` when `BKE_nlastrips_has_space` (`nla.cc:860-890`) finds
    no room. SS scans rightward via `findFreeRangeStart` and inserts
    at the first free position. The `applyPushActionDown` "fall over
    to new track" fallback consequently only fires on PROTECTED top
    track, not on "top track full".

16. **No id-user refcount on action references** (`applyRemoveTrack`,
    audit-fix MED-A4). Blender's `do_id_user=true` decrements
    refcounts on freed strips' actions. SS has no refcount system —
    actions linger in `project.actions[]` until explicitly deleted.

Inherited from 4.A/4.B/4.C/4.D.1/4.D.2/4.D.3 unchanged: 12 deviations.

## Plan-doc + MEMORY updates

- `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4 ship-status
  banner: 6/7 → 7/7 sub-slices of 4.D SHIPPED (slice 4.D complete).
- `MEMORY.md` `project_blender_parity_plans_in_flight` index entry
  updated.

## Top queued path next

**Slice 4.E — BakeNLA operator** (~2 days projected):

The "collapse runtime NLA stack into a single ground-truth Action"
operator. Mirrors Blender's `NLA_OT_bake` / the related anim_sys.cc
bake path. Walks `evaluateNla` across a frame range, samples each
animated rnaPath, writes the sampled values as Action fcurves. Useful
when the user has built a complex NLA stack via this editor and
wants to "freeze" it back to a standalone action.

After 4.E:
- **Slice 4.F** — per-feature test parity sweep + manual checklists
- **Slice 4.G** — Phase 4 exit gate + manual verification

---

**Commits this slice (2):**
- `12f992f` — feat(anim): Phase 4 Slice 4.D.4 — NLAEditor CRUD +
  Push Action Down
- `09ee4dd` — fix(audit): Phase 4 Slice 4.D.4 audit-fix — 2 HIGH +
  5 MED + 2 LOW + 2 cite fabs; cite-discipline RESET

**Phase 4 progress: 4.D sub-slice 7/7 SHIPPED (Slice 4.D complete).**

**Closes:** 0 grievances directly (full Phase 4 closes 1 grievance —
"no NLA stack"). After 4.D.4 the NLAEditor surface is feature-complete
for the create-from-scratch + manage-existing user workflow. Slice 4.E
ships the BakeNLA operator (the runtime → ground-truth-Action
collapse).
