# Session Closeout — Animation Phase 4 Slice 4.A (SUBSTRATE SHIPPED)

**Date:** 2026-05-18
**Branch:** master (139 commits ahead of origin/master, +2 this slice)
**Schema:** v41 → **v42** (NLA substrate bump)
**Status:** SHIPPED — substrate `eba15ab` + audit-fix `410459b`
**Phase 4:** 1/7 slices complete (Slice 4.A only)

---

## What 4.A ships

Plan §4.A spec items (`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1260`):

1. **`NlaStrip` shape definition** — ✅ implemented as
   `makeNlaStrip(id, actionId, overrides?)` constructor returning
   the full 16-field strip object
2. **`NlaTrack` shape definition** — ✅ implemented as
   `makeNlaTrack(id, name, overrides?)` returning the 5-field track
3. **AnimData backup pointers** — ✅ added via v42 migration: 4 new
   slots on every animData-carrying node (`tmpActionId` /
   `tmpSlotHandle` / `tweakTrackId` / `tweakStripId`)
4. **`ADT_NLA_EDIT_ON` flag bit** — ✅ exposed via `ADT_FLAG.NLA_EDIT_ON`
   + load-bearing for Slice 4.C tweak-mode entry/exit
5. **Combine blend mode REMOVED** — ✅ `NLA_BLEND_MODES` is a
   4-element frozen list (replace/add/subtract/multiply); constructor
   throws on `combine` per plan §4.B Rule №1 audit

Concretely:

- **NEW [src/store/migrations/v42_nla_substrate.js](../../src/store/migrations/v42_nla_substrate.js)** (~155 LOC)
  — adds the 4 backup-pointer fields with `null`/`0` defaults to
  every animData slot. Idempotent. Lossless. Audit-fix LOW-A4 added
  `corruptSkipped` counter + `logger.warn` for hand-edited corruption
  (matches `feedback_in_app_logging` convention).

- **NEW [src/anim/nla.js](../../src/anim/nla.js)** (~370 LOC)
  — substrate module mirroring `src/anim/fmodifiers.js` pattern:
  - `NLA_BLEND_MODES` frozen 4-element list in Blender enum order
  - `NLA_EXTEND_MODES` frozen 3-element list (full Blender parity)
  - `NLASTRIP_FLAG` / `NLATRACK_FLAG` / `ADT_FLAG` bit dictionaries
    (all values byte-faithful to Blender `DNA_anim_enums.h`)
  - `makeNlaStrip` / `makeNlaTrack` constructors with positional-args-
    wins protection (audit-fix MED-A2) + enum-bounds validation
  - `isNlaTrack` / `isNlaStrip` shape predicates including enum checks
  - `getNlaTracks` sparse-safe reader with stable `EMPTY_NLA_TRACKS`
    sentinel (avoids `feedback_filter_in_selector` trap)
  - `isTweakModeOn` reader for `flag & ADT_FLAG.NLA_EDIT_ON`

- **[src/store/migrations/v36_action_datablock.js](../../src/store/migrations/v36_action_datablock.js)**,
  **[v37_scene_anim_data.js](../../src/store/migrations/v37_scene_anim_data.js)**,
  **[src/store/projectStore.js](../../src/store/projectStore.js)** (×2 inlined literals)
  — `defaultAnimData()` and scene-node init updated +4 fields each.
  Drift between fresh-project ↔ migrated-project shapes is the bug
  this prevents.

- **NEW [scripts/test/test_migrationV42.mjs](../../scripts/test/test_migrationV42.mjs)** (~410 LOC, 183 asserts across 20 sections)

- **[scripts/test/test_migration_v37.mjs](../../scripts/test/test_migration_v37.mjs)** drift-test bumped 8 → 12 fields + 4 new literal checks

## Plan §4.A claim correction (load-bearing)

Plan §4.A claimed: *"AnimData backup pointers (`tmpActionId` /
`tmpSlotHandle` / `tweakTrackId` / `tweakStripId`) are part of Phase
1's animData shape (now expanded above) — Phase 4 wires them."*

This was WRONG. Verified via `feedback_check_plan_against_impl_on_consumption`:
v36's `defaultAnimData()` (`v36_action_datablock.js:292-303`) and
v37's parallel (`v37_scene_anim_data.js:140-151`) declared 8 fields
— `actionId` / `actionInfluence` / `actionBlendmode` /
`actionExtendmode` / `slotHandle` / `nlaTracks` / `drivers` / `flag`
— and stopped. The 4 backup-pointer slots required by tweak-mode
entry/exit were absent.

**Resolution**: Added them via v42 migration instead of patching
them in at runtime via a hypothetical "ensure" shim (Rule №2 — no
migration baggage). The migration is registered, idempotent, lossless;
sister-edits to v36/v37 `defaultAnimData()` + projectStore.js's two
inlined literals keep fresh-project ↔ migrated-project shapes
in sync.

## Cite-discipline arc

**HOLDS at 3** (3.F clean → 3.G clean → 4.A clean — no new fabs).
Blender-fidelity audit verified every citation:

- `DNA_anim_types.h:425-506` (NlaStrip struct) — ACCURATE
  (struct opens at 425; audit-fix LOW-F1 corrected 440 → 425)
- `DNA_anim_types.h:524-538` (NlaTrack struct) — ACCURATE
- `DNA_anim_types.h:697-713` (AnimData backup-pointer section) —
  ACCURATE (audit-fix LOW-F2 + LOW-F3 reconciled "struct" → "backup-
  pointer fields" label + 694 vs 697 inconsistency → 697)
- `DNA_anim_enums.h:374-379` (eNlaStrip_Blend_Mode) — ACCURATE
- `DNA_anim_enums.h:383-391` (eNlaStrip_Extrapolate_Mode) — ACCURATE
- `DNA_anim_enums.h:394-441` (eNlaStrip_Flag) — ACCURATE (10 SS bits + 7 omitted)
- `DNA_anim_enums.h:460-484` (eNlaTrack_Flag) — ACCURATE (6 SS bits + 2 omitted)
- `DNA_anim_enums.h:553-587` (eAnimData_Flag) — ACCURATE (5 NLA bits + 7 UI bits omitted)
- `DNA_anim_enums.h:559` (`ADT_NLA_EDIT_ON = (1 << 2)`) — ACCURATE
  (load-bearing for Slice 4.C)
- `nla.cc:494-534` (BKE_nlastrip_new) — ACCURATE (audit-fix MED-F1
  surfaced the `flag = SELECT | SYNC_LENGTH` deviation; reworded
  JSDoc with explicit SS-deviation block)
- `nla.cc:358-367` (BKE_nlatrack_new) — ACCURATE (same deviation
  pattern; documented)
- `anim_data.cc:105-129` (BKE_animdata_ensure_id) — ACCURATE

Fab streak: 5.P broke at 0 → 3.F HOLDS at 1 → 3.G HOLDS at 2 →
**4.A HOLDS at 3**.

## Dual-audit findings (commit `410459b`)

### Architecture (3 MED + 1 LOW addressed)

- **MED-A1**: `EMPTY_NLA_TRACKS` declared AFTER `getNlaTracks` — TDZ
  footgun for any future top-level IIFE. Moved declaration above.
- **MED-A2**: `makeNlaStrip` / `makeNlaTrack` spread order let
  `overrides.id` clobber the validated positional `id`. Moved
  positional args AFTER spread so they always win.
- **MED-A3**: Test §7 only checked `makeSceneNode()`; v36's
  `defaultAnimData()` 12-field drift was untested. Added §7b for the
  v35→v36 path.
- **LOW-A4**: Silent skip of corrupt-animData nodes. Added
  `logger.warn` + `corruptSkipped` return field for audit-trail
  visibility per `feedback_in_app_logging`.

### Fidelity (1 MED + 3 LOW addressed)

- **MED-F1**: `makeNlaStrip` / `makeNlaTrack` JSDocs overclaimed
  "mirror BKE_nlastrip_new / BKE_nlatrack_new semantics" but SS
  defaults `flag = 0` while Blender seeds `flag = SELECT |
  SYNC_LENGTH` / `SELECTED | OVERRIDELIBRARY_LOCAL`. Reworded with
  explicit "SS DEVIATION" blocks documenting why SS departs (no UI,
  no library-override system, no length-sync evaluator) + re-litigation
  gate.
- **LOW-F1**: NlaStrip cite `440-506` → `425-506` (struct opens at 425).
- **LOW-F2**: AnimData cite labeled "struct" but range covered only
  backup-pointers — relabeled.
- **LOW-F3**: Cite range inconsistency `694-713` vs `697-713` —
  reconciled to `697-713`.

**1 fidelity finding NOT FIXED** (deferred with rationale): SS time-field
defaults (`start=end=actstart=actend=0`) deviate from Blender's
`nla.cc:540-548` which derives from `frame_range_of_slot`. Not fixed
because the substrate module has no project handle to resolve
`actionId` against; the existing JSDoc documents "callers MUST set
them"; the evaluator-side defense lives in Slice 4.B. Rule №1: no
half-finished API.

## Test coverage delta

| Test | Before | After | Delta |
|------|--------|-------|-------|
| test_migrationV42.mjs (NEW) | n/a | 183 | +183 |

**New assertions this slice: 183**.

Section breakdown (20 sections post-audit-fix):
| Section | Asserts | Coverage |
|---------|---------|----------|
| §1 | 3 | empty/null/non-array project safety |
| §2 | 15 | patches all 3 animData-carrying node types |
| §3 | 2 | idempotency + value preservation |
| §4 | 2 | corrupt-shape skip + corruptSkipped counter (audit-fix LOW-A4) |
| §5 | 6 | v41→v42 walker advances + adds fields |
| §6 | 1 | CURRENT_SCHEMA_VERSION sanity |
| §7 | 8 | makeSceneNode() 12-field default |
| §7b | 3 | v35→v36 12-field drift lock-in (audit-fix MED-A3) |
| §8 | 8 | NLA_BLEND_MODES — 4 modes Blender-order; combine absent |
| §9 | 5 | NLA_EXTEND_MODES — 3 modes Blender-order |
| §10 | 18 | NLASTRIP_FLAG bits + omitted-bits asserts (audit-fix MED-F2) |
| §11 | 9 | NLATRACK_FLAG bits + omitted-bits asserts (audit-fix MED-F2) |
| §12 | 13 | ADT_FLAG bits + omitted-bits asserts (audit-fix MED-F2) |
| §13 | 15 | makeNlaStrip defaults match Blender |
| §14 | 14 | makeNlaStrip overrides + validation + positional-wins (audit-fix MED-A2) |
| §15 | 9 | makeNlaTrack defaults + validation + positional-wins (audit-fix MED-A2) |
| §16 | 8 | isNlaTrack / isNlaStrip predicates |
| §17 | 8 | getNlaTracks sparse-safe + stable sentinel |
| §18 | 5 | isTweakModeOn reads ADT_FLAG.NLA_EDIT_ON |
| §19 | 6 | JSON round-trip preserves NLA shape byte-identically |

## Files touched (commits `eba15ab` + `410459b`)

| File | Purpose |
|------|---------|
| src/store/migrations/v42_nla_substrate.js | NEW — migration + corruption-visibility hook |
| src/anim/nla.js | NEW — NlaTrack/NlaStrip constructors + flag enums + predicates |
| scripts/test/test_migrationV42.mjs | NEW — 183 asserts across 20 sections |
| src/store/projectSchemaVersion.js | 41 → 42 |
| src/store/projectMigrations.js | v42 registered + imported |
| src/store/migrations/v36_action_datablock.js | defaultAnimData() +4 fields |
| src/store/migrations/v37_scene_anim_data.js | defaultAnimData() +4 fields |
| src/store/projectStore.js | 2 inlined scene-node literals +4 fields each |
| scripts/test/test_migration_v37.mjs | drift test: +4 literals, count 8→12 |
| package.json | test:migrationV42 entry + aggregate addition |

## SS deviations opened this slice

4.A opens **2 new** documented SS deviations (both substrate-level,
both have re-litigation gates):

1. **`makeNlaStrip` defaults `flag = 0`** vs Blender's `SELECT |
   SYNC_LENGTH`. Reasons: NLAEditor UI (Slice 4.D) hasn't shipped
   → SELECTED has no surface; SYNC_LENGTH is an evaluator semantic
   (Slice 4.B) not yet enforced. Re-litigate when 4.B + 4.D land.

2. **`makeNlaTrack` defaults `flag = 0`** vs Blender's `SELECTED |
   OVERRIDELIBRARY_LOCAL`. Reasons: same UI-surface gap; SS has no
   library-override system (no Blender library-link analog).

Both documented inline in `src/anim/nla.js` with explicit "SS
DEVIATION" blocks following the v36/v37 deviation-doc convention.

## Plan-doc updates (this slice)

`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 4.A expanded
with:
- Schema bump v35-aspirational → **v42** (actual)
- Plan-claim correction note: "Phase 1's animData shape did NOT
  include backup pointers — v42 added them, sister-update to v36/v37"
- Substrate ship-status: 4.A SHIPPED 2026-05-18 (commits `eba15ab` +
  `410459b`)

## Top queued path next

**Slice 4.B — NLA evaluator** (~2-3 days projected):

> `evaluateNla(animData, time, project, evalContext) → Map<rnaPath, value>`
> in `src/anim/nla.js` (or new `src/anim/nlaEval.js`). Iterate tracks
> bottom-to-top, mute/solo gating, per-strip time remap + influence
> ramp, blend mode kernels (replace/add/subtract/multiply matching
> Blender `evaluate_nla_strip_blend` in `nla.cc`).

Slice 4.B is the first Phase 4 slice that consumes Slice 4.A's
constructors + flag enums. The audit-fix MED-A2 positional-wins
protection becomes load-bearing for 4.B since the evaluator will be
building strips programmatically from project state.

Slice 4.B blockers: none. The substrate is complete + tested + audited.

Phases 4.C (tweak mode) / 4.D (NLAEditor UI) / 4.E (BakeNLA operator)
follow.

---

**Commits this slice (2):**
- `eba15ab` — feat(anim): Phase 4 Slice 4.A — NLA substrate (schema v42)
- `410459b` — fix(audit): Phase 4 Slice 4.A audit-fix — 4 MED + 4 LOW + cite-discipline HOLDS at 3

**Phase 4 progress: 1/7 slices.**

**Closes:** 0 grievances (substrate-only; full Phase 4 closes 1
grievance — "no NLA stack"). Substrate ready for Slice 4.B
consumption.
