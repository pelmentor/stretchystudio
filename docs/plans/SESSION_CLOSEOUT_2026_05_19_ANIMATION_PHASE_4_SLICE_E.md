# Session Close-out — Animation Phase 4 Slice 4.E (BakeNLA operator)

**Session date:** 2026-05-19 (continuation cross-compact)
**Branch:** master (161 commits ahead of origin/master; +2 this slice)
**Schema:** v42 (no bump — Slice 4.E is operator-only, no migration)
**Status:** Slice 4.E SHIPPED.
**Phase 4 status:** 4.A/4.B/4.C/4.D/4.E SHIPPED; 4.F (test parity
sweep) + 4.G (exit gate) remain.

---

## What this slice shipped

### Substrate

`src/v3/operators/bakeNla.js` (~620 LOC after audit-fix) exporting:

- **`bakeNla(animData, project, options)`** — pure substrate. Walks
  `[options.frameStartMs, options.frameEndMs]` at `options.stepMs`,
  composing `evaluateNla` output with the bound-action layer (mirroring
  Blender's `animsys_create_action_track_strip` synthetic top strip).
  Returns `{ fcurves, sampleCount, rnaPaths }`. Mutates nothing.

- **`applyBakeNla(project, objectId, options)`** — project mutator.
  Resolves the Object's animData, calls `bakeNla`, writes a new
  `Action` (or overwrites the bound one when `useCurrentAction=true`),
  routes binding-assignment through `actionRegistry.js#assignAction`
  so registry deviations stay inherited cleanly.

- **`wouldBakeNlaChange(animData)`** — predicate. Returns true when
  the Object has either a bound `actionId` or at least one NLA strip
  with a non-empty `actionId`. (Audit-fix MED-A1 made this strictly
  symmetric with `collectRnaPathUniverse`.)

### UI surface

NLAEditor Bake button per group header (`Combine` icon, emerald):

- Visible when `wouldBakeNlaChange(groupAnimData)` is true.
- Range: this group's own strip span; falls back to bound action's
  `frameStart`/`frameEnd`/`duration`; minimum [0, 1000] floor.
- Step: `1000/24` ms (= 1 frame @ 24fps, Blender's default
  `step=1` on `NLA_OT_bake` at `anim.py:209-213`).
- `useCurrentAction: false` — creates a new action + reassigns
  (less destructive default).
- `cleanCurves: false` — keeps every sample.
- `applyBakeNla(...)` null returns surface via
  `logger.warn('NLAEditor.bake', ...)` (audit-fix HIGH-A2).

### Composition model

At every sample `t`:

```
1. acc := new Map(evaluateNla(animData, t, project))
   (copy — purity contract; evaluateNla's Map is not held cross-sample)
2. If bound action is evaluatable (actionId set AND not soloing AND
   (not tweaking OR EVAL_UPPER_TRACKS)):
     - Compute evalT from actionExtendmode + actstart/actend
       ('nothing' → skip outside; 'hold' → clamp; 'hold_forward' →
        skip before, clamp after).
     - For each bound-action fcurve:
         acc[rnaPath] := applyBlendMode(
           acc.get(rnaPath) ?? 0,
           evaluateFCurve(fc, evalT),
           actionBlendmode,
           actionInfluence)
3. For each rnaPath in the universe:
     keyforms[path].push({ time: t, value: acc.get(path) ?? 0 })
```

---

## Cite-discipline arc

| Cite | Verified |
|------|----------|
| `anim.py:191-336` NLA_OT_bake | YES |
| `anim_utils.py:155-260` bake_action / bake_action_objects / bake_action_objects_iter | CORRECTED (was 155-249, missed bake_action_iter @ :252) |
| `anim_utils.py:252-678` bake_action_iter | YES (added) |
| `anim_utils.py:657-676` inline `do_clean` loop | YES (added; was fab'd `keyframes_general.cc#clean_fcurve_segments`) |
| `anim_sys.cc:3313-3365` `animsys_create_action_track_strip` | CORRECTED (function name was fab'd `animsys_construct_orig_action_strip`; body cite + line range correct) |
| `anim_sys.cc:3353-3358` MUTED gating triplet | YES |
| `anim_sys.cc:3345` `act_extendmode` propagation | YES (added — required for HIGH-F4 fix) |
| `nlaEval.js:550-557` strict blendmode check | YES |
| `main_namemap.cc:441` `id_name_final_build` (used in `uniqueActionName`) | YES |

**Pre-audit:** 7 cites, 2 fabs.
**Post-audit:** all cites byte-verified; **cite-discipline RESET to 0 after substrate BROKE at 2**.

Streak arc this phase: 5.P broke at 0 → 3.F/3.G/4.A/4.B/4.C HOLDS at 5
→ 4.D.1 BROKE → reset → 4.D.2 HOLDS at 1 → 4.D.3 HOLDS at 2 → 4.D.4
BROKE at 2, RESET to 0 → **4.E BROKE at 2, RESET to 0**.

Pattern observation: the 4.D.4 fabs were Explore-agent helper-function
cites I didn't byte-verify. The 4.E fabs were marquee cites I HAD
written manually but to wrong line ranges and a fab'd function name.
The bake's `clean_curves` semantics — wrong epsilon (1e-6 vs 1e-4)
+ wrong formula (max-of-abs vs SUM-of-abs) — actually leaked into the
runtime, so this fab was the most damaging since 4.D.1. The 4.D.4
lesson does NOT generalize fully to 4.E: even hand-authored cites need
verification, especially when the cite refers to a function NAME or
formula NUMBERS (not just a line range).

---

## Audit findings rolled up (sweep #69)

| Audit | HIGH | MED | LOW | CITE FABS |
|-------|------|-----|-----|-----------|
| Architecture | 3 (unconditional blendmode validation; handleBake null-return silent ignore; minMs=0 init bug) | 4 (predicate-vs-impl asymmetry; Map mutation hidden in pure fn; untested degenerate range; useCurrent missing actions silent null) | 0 | 0 |
| Blender fidelity | 5 (CITE FAB clean_fcurve formula + epsilon; CITE FAB function name; sample-range divergence; actionExtendmode ignored; bypassed assignAction) | 2 (cite range; missing frameStart/End/duration) | 1 (BKE_nla_clip_length note) | **2** |

All findings addressed in same-day audit-fix commit `6ebe3e2`.

---

## SS deviations (3 new this slice; cumulative 19 → 22)

- **DEV 21 — Always-include-endpoint sample**: Blender's
  `range(start, end+1, step)` skips the endpoint when step doesn't
  divide cleanly. SS clamps to `frameEndMs` so users always get a
  key at their requested end. User-friendly + intentional.
- **DEV 22 — clean loop omits `fcu_orig_data` exemption**: Blender
  exempts hand-authored keys from clean-collapse; SS's bake always
  produces fresh dense samples (no original keys to exempt), so
  the exemption path is unreachable + intentionally omitted.

Plus 2 pre-existing deviations referenced (not new):
- DEV 17 — no per-frame scene update (pure eval; no dep-graph)
- DEV 18 — default-0 for unsampled rnaPaths (no rnaPath-resolve-
  current-value reader)
- DEV 19 — single-object bake (Blender batches N objects)
- DEV 20 — linear-only output interpolation (Blender bake same)

---

## Rule №1 catches surfaced this slice

1. **Audit HIGH-A1**: blendmode validation was guarded by
   `boundActionEvaluatable`. A project with soloing + bad blendmode
   silently bypassed the check. Fixed: validation unconditional when
   `actionId` is set.

2. **Audit HIGH-A2**: `applyBakeNla(...)` returns null on 5 distinct
   failure modes; pre-fix `handleBake` discarded the return value.
   User would have stared at unchanged UI with no recourse. Fixed:
   `logger.warn('NLAEditor.bake', ...)` per `feedback_in_app_logging`.

3. **Audit MED-A2**: `bakeNla` docstring promised purity but the inner
   loop mutated the Map returned by `evaluateNla` via `.set(...)`. If
   `evaluateNla` ever caches its return Map, this would corrupt
   cross-sample state. Fixed: `new Map(evaluateNla(...))` defensive
   copy. Test §29 asserts via JSON.stringify before/after.

4. **Audit MED-A4**: `applyBakeNla` with `useCurrentAction=true`
   returned null silently when `project.actions` was missing. Project-
   shape bug, not a "nothing to do" — fixed to throw. Test §33 covers.

5. **In-substrate (HIGH-F5)**: `applyBakeNla` was direct-mutating
   `animData.actionId` + `slotHandle` instead of routing through
   `actionRegistry.js#assignAction`. Pre-fix, any future Blender-
   fidelity extension to assignAction (e.g. `last_slot_identifier`
   write per the D-4 deviation) would silently bit-rot at this call
   site. Fixed: route through assignAction; rollback on registry
   failure.

---

## Test counts

| File | Pre-slice | Post-slice | Delta |
|------|-----------|------------|-------|
| `test_bakeNla.mjs` | 0 | 110 | +110 |

Pre-fix substrate ship: 84 asserts.
Post-audit-fix: +26 new asserts covering audit fixes.

Sibling NLA tests still all green:
- `test_nlaEval.mjs`: 86/86
- `test_nlaEditorOps.mjs`: 209/209
- `test_nlaTweakMode.mjs`: 85/85
- `test_nlaEditorData.mjs`: 56/56

**Phase 4 cumulative: 731 asserts** (621 after 4.D.4 + 110 from 4.E).

---

## Commits this slice (2)

```
7e4a2a0 feat(anim): Phase 4 Slice 4.E — BakeNLA operator
6ebe3e2 fix(audit): Phase 4 Slice 4.E audit-fix — 5 HIGH-F + 4 HIGH/MED-A + 2 cite fabs
```

(+1 docs commit shipping this close-out + plan banner + MEMORY update.)

---

## Top queued path next

**Slice 4.F — test parity sweep** (per plan §4.F).

The plan §4.F table enumerates 10 specific test files (test_nla_strip_eval,
test_nla_blend_replace/add/subtract/multiply/combine, test_nla_track_solo,
test_nla_extend_hold, test_nla_tweak_mode, test_nla_bake). Phase 4
has shipped tests under different filenames (test_nlaEval covers strip
eval + all blend modes + solo + extend; test_nlaTweakMode covers tweak;
test_bakeNla covers bake). 4.F audit-fix: verify the actual SS test
files cover every assertion the plan's notional test_files would have
covered, and either rename SS tests to match plan filenames OR amend
plan §4.F to reflect the as-shipped naming. Also: the plan's "Phase 3
manual checklist" is still owed; 4.F is the place to add the bake
manual-verification scenarios from §4.G.

After 4.F:
- **Slice 4.G** — Phase 4 exit gate + manual verification:
  - "Idle + breath" stacked → walk → talk-while-walking
  - Two characters with shared "blink" Action on top NLA track
  - Tweak push → edit blink frequency → accept reflects in NLA underlay
  - Cubism Viewer load of a baked NLA → motion3.json is identical to a
    hand-authored equivalent

---

## Pre-compact state (snapshot)

- **Branch**: master, 161 commits ahead of origin (NEVER pushed this
  session per standing "Push only to origin" rule)
- **Working tree**: about to commit this close-out + plan + MEMORY
- **Schema**: v42 (unchanged)
- **Phase 4 progress**: 4.E SHIPPED; 4.F + 4.G remain
- **Tests added this slice**: 110 new asserts (test_bakeNla.mjs);
  sibling NLA suites still green; typecheck clean
- **Audit sweep this slice**: #69: 8 HIGH (5 fidelity + 3 architecture)
  + 6 MED + 1 LOW + 2 CITE FABS; all addressed
- **Cite-discipline**: BROKE at 2 on 4.E substrate, RESET to 0 after
  audit-fix
- **SS deviations**: 22 cumulative this phase (19 → 22 this slice with
  DEV 21 + DEV 22 + the audit-fix references)
- **User-side owed**: Phase 3 manual verification checklist
  (carryover); Phase 4 manual checklist accrues at 4.G
