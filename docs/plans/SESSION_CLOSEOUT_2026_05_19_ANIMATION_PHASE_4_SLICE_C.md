# Session Closeout — Animation Phase 4 Slice 4.C (TWEAK MODE SHIPPED)

**Date:** 2026-05-19
**Branch:** master (143 commits ahead of origin/master, +2 this slice)
**Schema:** v42 (no bump — eval-state helpers only consume 4.A substrate)
**Status:** SHIPPED — substrate `f0fd4be` + audit-fix `3ae4c5e`
**Phase 4:** 3/7 slices complete

---

## What 4.C ships

Plan §4.C spec items (`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1333`):

1. **`enterTweakMode(animData, trackId, stripId)`** — ✅
   byte-faithful port of `BKE_nla_tweakmode_enter` (nla.cc:2352-2456)
2. **`exitTweakMode(animData, project?)`** — ✅ byte-faithful port of
   `BKE_nla_tweakmode_exit` + `nla_tweakmode_exit_nofollowptr` +
   `nla_tweakmode_exit_sync_strip_lengths` (nla.cc:2492-2565 +
   2463-2486) including the SYNC_LENGTH bound-sync per audit-fix
3. **`clearTweakFlags(animData)`** — ✅ byte-faithful port of
   `BKE_nla_tweakmode_clear_flags` (nla.cc:2567-2577)
4. **TWEAKUSER strip-share tagging** — ✅ marks every strip sharing
   the tweak strip's action (Blender :2384-2393)
5. **DISABLED cascade on active + above tracks** — ✅ honors
   `NLA_EVAL_UPPER_TRACKS` gate (Blender :2399-2408)
6. **Action swap + backup pointers** — ✅ `animData.actionId` becomes
   the tweak strip's actionId; pre-tweak saved to `tmpActionId` /
   `tmpSlotHandle`
7. **`ADT_NLA_EDIT_ON` flag bit** — ✅ set on enter, cleared on exit
8. **SYNC_LENGTH bound re-derivation at exit** — ✅
   (audit-fix HIGH-F5; was originally documented as deviation,
   correctly identified by auditor as buildable today)
9. **Different-strip-while-in-tweak rejection** — ✅ audit-fix HIGH-A2
   surfaces a footgun that Blender's operator-layer pairing masked

Concretely:

- **NEW [src/anim/nlaTweakMode.js](../../src/anim/nlaTweakMode.js)** (~380 LOC after audit-fix)
  — 3 public exports (`enterTweakMode` / `exitTweakMode` /
  `clearTweakFlags`) + 4 internal helpers (`findTrackAndStrip` /
  `findAction` / `getActionLengthMs` / `syncStripBoundsToAction`).
  All pure-on-error / mutating-on-success. Numbered "SS deviations"
  block (5 entries) at module top per the established convention.

- **NEW [scripts/test/test_nlaTweakMode.mjs](../../scripts/test/test_nlaTweakMode.mjs)** (~620 LOC, 75 asserts across 16 sections)
  including 3 evaluator-integration sections covering the
  Slice 4.B/4.C split contract.

## Cite-discipline arc

**HOLDS at 5** (3.F → 3.G → 4.A → 4.B → 4.C all clean). Fidelity audit
verified every cited file + line range + content match. New cites this
slice (substrate + audit-fix combined):

- `BKE_nla.hh:524-549` — enter/exit/clear_flags declarations
- `nla.cc:2352-2456` — `BKE_nla_tweakmode_enter`
- `nla.cc:2365-2367` — already-in-tweak short-circuit
- `nla.cc:2384-2393` — TWEAKUSER tag loop
- `nla.cc:2397` — active strip untag
- `nla.cc:2399-2408` — DISABLED cascade (active + upper tracks)
- `nla.cc:2414-2415` — backup pre-tweak action
- `nla.cc:2417-2433` — swap-in tweak action (refcounting omitted per SS deviation 1)
- `nla.cc:2451-2453` — runtime pointers + flag set
- `nla.cc:2463-2486` — `nla_tweakmode_exit_sync_strip_lengths` (SYNC_LENGTH wire)
- `nla.cc:2492-2505` — `nla_tweakmode_exit_nofollowptr`
- `nla.cc:2507-2514` — public wrapper
- `nla.cc:2516-2565` — `BKE_nla_tweakmode_exit`
- `nla.cc:2567-2577` — `BKE_nla_tweakmode_clear_flags`
- `nla.cc:535` (audit-fix) — `nlastrip_recalculate_bounds` formula
- `anim_sys.cc:3448` (audit-fix) — evaluator accumulates first→last
  (verifies listbase head = BOTTOM layer)

Fab streak: 5.P broke at 0 → 3.F HOLDS at 1 → 3.G HOLDS at 2 →
4.A HOLDS at 3 → 4.B HOLDS at 4 → **4.C HOLDS at 5**.

## Dual-audit findings (commit `3ae4c5e`)

### Architecture (2 HIGH + 3 MED + 1 LOW addressed)

- **HIGH-A1**: §10 round-trip fixture defaulted slotHandle=0; a
  missing tmpSlotHandle save would not be caught. **Fix**: fixture
  uses slotHandle=7, tweak strip slotHandle=5, tmpSlotHandle=99
  sentinel. §1 + §7 pin save/swap/restore math.
- **HIGH-A2**: `enterTweakMode` silent-success when already in tweak
  on a DIFFERENT strip. **Fix**: branch on (trackId, stripId) match;
  reject different-strip with false. §3 rewritten with byte-equal
  pins for both idempotent + reject paths.
- **MED-A3**: Index-vs-array-position drift footgun. **Fix**:
  documented contract in `enterTweakMode` JSDoc; Slice 4.D NLAEditor
  responsibility.
- **MED-A4**: Empty-tracks coverage gap. **Fix**: §13 NEW exercises
  all 3 helpers on `{ nlaTracks: [] }` crash-recovery shape.
- **MED-A5**: Slot-user-map deviation only in function JSDoc.
  **Fix**: promoted to numbered module-level SS DEVIATION block
  (now 5 entries).
- **LOW-A6**: findTrackAndStrip early-return semantics undocumented.
  **Fix**: JSDoc clarifies "strip ids unique within their track".

### Fidelity (1 HIGH-leaning + 3 MED + 3 LOW addressed)

- **HIGH-leaning F5**: SYNC_LENGTH bound sync at exit was claimed
  as deviation but was buildable. **Fix**: added 3 helpers
  (`getActionLengthMs` / `syncStripBoundsToAction` / `findAction`)
  + wired `exitTweakMode(animData, project?)` to re-derive
  `strip.end = start + actlength * abs(scale) * repeat` for
  SYNC_LENGTH-flagged strips referencing the tweaked action.
  §14 covers 4 cases byte-faithfully.
- **MED-F2**: Listbase-head-bottom pin. **Fix**: added cite to
  `enterTweakMode` JSDoc.
- **MED-F3**: Explicit-IDs vs Blender's discovery deviation.
  **Fix**: documented as DEVIATION 4.
- **MED-F4**: `NLATRACK_FLAG.DISABLED` blanket-clear safety verified
  via grep (no other writers).
- **LOW-F1**: tmpSlotHandle=0 not Slot::unassigned. Documented as
  DEVIATION 5.
- **LOW-F6**: refcount/RNA/slot-validation deviations covered by
  DEVIATIONs 1/2/3.
- **LOW-F7**: Tweak-strip eval injection split. **Fix**: §16 NEW
  consumer-chain composition test verifying that `evaluateNla`
  (underlay) + active-action eval (tweak action layer) compose
  correctly.

## Test coverage delta

| Test | Before | After | Delta |
|------|--------|-------|-------|
| test_nlaTweakMode.mjs | 55 | 75 | +20 |

Section breakdown (16 sections post-audit-fix):

| § | Asserts | Coverage |
|---|---|---|
| 1 | 11 | enterTweakMode happy path (DISABLED, TWEAKUSER, action swap, slotHandle swap) |
| 2 | 4 | TWEAKUSER tagging (active strip untagged, shared strip tagged, others untagged) |
| 3 | 5 | idempotent-same-strip + reject-different-strip + JSON byte-equal pin (HIGH-A2 + LOW-F8) |
| 4 | 3 | missing track/strip → false; animData unchanged |
| 5 | 2 | null actionId → false |
| 6 | 2 | NLA_EVAL_UPPER_TRACKS gate honored |
| 7 | 10 | exitTweakMode restores everything (slotHandle restore pinned via HIGH-A1) |
| 8 | 1 | exit when not in tweak → no-op |
| 9 | 11 | clearTweakFlags clears bits only; action + backup pointers preserved |
| 10 | 1 | enter→exit shape-preserving (relaxed for tmpSlotHandle clear-to-0) |
| 11 | 2 | Evaluator integration: tweak skips DISABLED tracks + tweak strip |
| 12 | 1 | Evaluator integration: post-exit normal stack walk resumes |
| 13 | 8 | Empty-tracks safe for all 3 helpers (MED-A4) |
| 14 | 4 | SYNC_LENGTH bound sync at exit (HIGH-F5) |
| 15 | 1 | SYNC_LENGTH silently skipped when project omitted (defensive) |
| 16 | 3 | Consumer-chain composition: underlay + active-action layer = 100 (LOW-F7) |

## Files touched (commits `f0fd4be` + `3ae4c5e`)

| File | Purpose |
|------|---------|
| src/anim/nlaTweakMode.js | NEW — enter/exit/clearFlags helpers + SYNC_LENGTH bound-sync (~380 LOC after audit-fix) |
| scripts/test/test_nlaTweakMode.mjs | NEW — 75 asserts across 16 sections (~620 LOC) |
| package.json | test:nlaTweakMode entry + aggregate addition |

## SS deviations registry (5 numbered, all documented in module top)

1. **No action refcount / Slot-user-map updates** — Blender's
   `animrig::generic_assign_action` refcount omitted. SS uses cascade
   walks in `actionRegistry.js` instead.
2. **No RNA notification** — SS reactivity (Zustand) handles re-render
   naturally when caller persists the mutation.
3. **Slot validation skipped** — SS slotHandle is always 0 in Phase 4
   per plan §4.A; evaluator silently no-ops on dangling handles.
4. **Explicit (trackId, stripId) API** vs Blender's
   active-bit-discovery. Slice 4.D will handle multi-strip-selected
   fallback if needed.
5. **tmpSlotHandle = 0 vs Slot::unassigned sentinel** — no SS Slot
   system yet.

**Note**: pre-audit-fix length-sync deviation REMOVED — F5 wired
SYNC_LENGTH correctly via `syncStripBoundsToAction`.

**Phase 4 cumulative deviations: 7** (2 from 4.A + 0 from 4.B (now
3 from 4.B documented inline) + 5 from 4.C). Some overlap — the
"no action refcount" deviation is essentially a project-wide stance.

## Plan-doc updates

`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4 ship-status
banner + §4.C heading updated:
- Slice 4.C SHIPPED 2026-05-19 (commits `f0fd4be` + `3ae4c5e`)
- 3/7 slices complete; remaining 4.D / 4.E / 4.F / 4.G
- Cite-discipline HOLDS at 5

## Top queued path next

**Slice 4.D — NLAEditor UI** (~3-4 days projected — first UI-heavy
slice of Phase 4):

Plan §4.D (line 1352):
> [src/v3/editors/nla/NLAEditor.jsx] — a dedicated editor tab in
> the animation workspace, similar to TimelineEditor but with track
> rows instead of FCurve rows.
>
> Features:
> - Track list (drag to reorder, right-click for menu)
> - Strip rectangles per track row (drag to move, drag-edge to resize)
> - Click strip → open in TimelineEditor (tweak mode)
> - Per-strip dropdown for blend mode
> - Per-track Mute / Solo toggles
> - "Push Action Down" button (current Action of selected Object →
>   new bottom-track strip)

Slice 4.D depends on:
- ✅ 4.A substrate (constructors + flag enums)
- ✅ 4.B evaluator (live preview must use this)
- ✅ 4.C tweak-mode helpers ("Edit Action" button calls
  `enterTweakMode`)
- New: registration in `editorRegistry.js` + workspace bindings
- New: drag-reorder + drag-resize state machines
- New: per-strip blend-mode dropdown component
- New: "Push Action Down" operator

After 4.D ships, 4.E (BakeNLA operator), 4.F (per-feature test
parity sweep), 4.G (phase exit gate) follow.

---

**Commits this slice (2):**
- `f0fd4be` — feat(anim): Phase 4 Slice 4.C — NLA tweak mode
  (enter/exit/clear ports)
- `3ae4c5e` — fix(audit): Phase 4 Slice 4.C audit-fix — 2 HIGH +
  6 MED + 4 LOW + SYNC_LENGTH wire + cite-discipline HOLDS at 5

**Phase 4 progress: 3/7 slices.**

**Closes:** 0 grievances (helper-only; full Phase 4 closes 1
grievance — "no NLA stack"). Tweak-mode state machinery ready for
4.D NLAEditor UI consumption.
