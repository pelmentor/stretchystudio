# Session Close-out — Animation Phase 7 Slice 7.A (Keying Set registry)

**Session date:** 2026-05-19 (Phase 6 → Phase 7 transition session).
**Slice:** 7.A — Keying Set registry substrate.
**Commits:** `2ebefe4` (substrate) + `768d25c` (audit-fix).
**Branch:** master.
**Schema:** v42 (unchanged — sparse `project.keyingSets[]` +
`project.activeKeyingSetId` fields; no migration).
**Status:** **SUBSTRATE-COMPLETE.** Phase 7's first slice ships the
registry + per-object collectors + per-project CRUD. Slices remaining:
7.B (Insert Keyframe operator), 7.C (I-key menu UI), 7.D (auto-key
parity), 7.E (K-key toast/rebind), 7.F (test sweep + Phase 7 exit gate).

---

## What 7.A shipped

### Substrate — `src/anim/keyingSets.js` (~500 LOC after audit-fix)

- `BUILTIN_KEYING_SET_IDS` — frozen tuple, canonical menu order:
  `['Available', 'Location', 'Rotation', 'Scaling', 'LocRotScale',
  'BlendShape', 'AllParams']` (5 Blender ports + 2 SS-original).
- `getKeyingSet(project, id)` — lookup (built-ins first, then
  `project.keyingSets[]`).
- `listKeyingSets(project)` — stable-ordered built-ins + user-defined.
  Shadow attempts on built-in ids rejected.
- `getActiveKeyingSet(project)` + `setActiveKeyingSet(project, id)`
  (Rule №1 throw on unknown id).
- `collectChannels(project, set, objectIds)` — dispatches built-in
  per-object collectors OR user-defined static paths.
- `addKeyingSet` / `removeKeyingSet` / `cloneKeyingSet` — full CRUD
  for user-defined sets. Built-ins are read-only (throws on shadow
  attempts). Active pointer auto-clears when its target is removed.

### Tests — `scripts/test/test_keyingSets.mjs` (144 asserts after audit-fix)

12 sections covering registry shape, per-object collection (object vs
bone vs blend-shape vs param), LocRotScale composite order, Available
fcurve scan + audit-fix MED-1 owner filter + defensive dedup, active
pointer, CRUD (add/remove/clone with throws on collision), listKeyingSets
ordering, MED-2 empty-name fallback at 5 emitter sites, collectChannels
resilience.

Wired into master `npm test` chain (between `test:fcurveSolo` and
`test:fmodifiers`).

---

## SS DEVIATIONS new this slice (20-25)

| # | What | Honesty class |
|---|------|----------------|
| 20 | Scaling carries `id="Scaling"` (constant at `keyingsets_builtins.py:29`, referenced at `:72`) + `label="Scale"` (literal at `:73`). | Faithful Blender split |
| 21 | Per-component RNA paths (`transform.x` + `transform.y`); Blender uses 3-vector path + `array_index`. SS `evaluateRnaPath` has no array_index concept. | Honest substrate divergence |
| 22 | Rotation collapsed to single scalar; Blender's mode-dependent euler/quat/axis_angle absent. SS is 2D-only Live2D. | Honest model divergence |
| 23 | User-defined sets at `project.keyingSets[]`. Blender scene-scoped; SS project IS the scene per Phase 1 Stage 1.D. | 1:1 mapping shift |
| 24 | `BlendShape` SS-original set. No Blender analog (Blender uses shape-key fcurves on mesh datablock). | SS-original feature |
| 25 | `AllParams` SS-original set. No Blender analog (Blender's `RKS_GEN_custom_props` is per-data-block, not project-wide). | SS-original feature |

All 6 deviations audit-verified accurate.

---

## Audit findings + fixes (sweep #78)

**Blender-fidelity audit:** **2 HIGH-F / 1 MED-F / 1 LOW-F** —
**clean cite streak BROKEN at 7.A.**

| Finding | Class | Fix |
|---------|-------|-----|
| HIGH-F1 | Cite fab | `keyingsets.cc:355-364 BKE_keyingset_add_path` was completely fab. Real defn at `blenkernel/intern/anim_sys.cc:173`; cited line range was `remove_keyingset_button_exec`. Replaced with defn + call-site cite. |
| HIGH-F2 | Orphan cite | `(:157-162 — RKS_GEN_available)` attached visually to `keyingsets_builtins.py` but intent was `_keyingsets_utils.py:131-162`. Now explicit cross-file. |
| MED-F | Constant-vs-literal | `:72-73 bl_idname = "Scaling"` was imprecise; `:72` carries `bl_idname = ANIM_KS_SCALING_ID` (constant), literal `"Scaling"` at `:29`. Docstring now documents the split. |
| LOW-F | Range polish | `:27-34` → `:26-34` (includes "Keep these in sync" comment at line 26). |

**Architecture audit:** **0 HIGH / 2 MED / 4 LOW** (1 no-action).

| Finding | Class | Fix |
|---------|-------|-----|
| MED-1 | Group attribution bug | `availablePaths` cross-attributed shared-action fcurves to whichever object iterated first. Fix: filter fcurves to those whose `rnaPath.startsWith('objects["${oid}"]')` — mirrors Blender basePath filter at `_keyingsets_utils.py:157-160`. |
| MED-2 | Empty-string trap | `node.name ?? id` returns `''` when name is empty (nullish-coalesce only trips null/undefined). 11 sites refactored to shared `groupOf(node)` helper using `||`. |
| LOW-1 | Freeze depth — no action | `BUILTIN_DEFS` shallow freeze is correct for the registry shape. |
| LOW-2 | Selector trap doc | JSDoc note on `listKeyingSets` warning against in-selector use (filter-in-selector trap). |
| LOW-3 | Silent-empty-snapshot doc | JSDoc note on `cloneKeyingSet` warning about empty `objectIds` producing empty snapshot. |
| LOW-4 | Test coverage | +13 asserts covering MED-1 group attribution + MED-2 empty-name fallback at all 5 emitter sites + defensive same-action dedup. |

All findings addressed in audit-fix commit `768d25c` same-day.

---

## Cite-discipline arc — STREAK BROKEN AT 7.A

| Slice | Pre-audit | Post-audit | Notes |
|-------|-----------|------------|-------|
| 6.D | 16 cites, 0 FAB | Clean | Streak broken (was 5-slice fab streak before this) |
| 6.E | 32+ cites, 0 FAB | 3 LOW-F | Clean |
| 6.F.1 | 12 cites, 0 FAB | 2 LOW-F | Clean |
| 6.F.2 | 12 cites, 0 FAB | 0 LOW-F | Clean |
| **7.A** | **~20 cites, 2 FAB** | **Audit-fixed same-day** | **STREAK BROKEN** |

**Root cause analysis** for the 7.A regression:

1. **HIGH-F1** (`keyingsets.cc:355-364 BKE_keyingset_add_path`) —
   classic "grep function name + pick nearest plausible line + didn't
   open the file" pattern. Rule 6 of byte-verify was written to catch
   exactly this. The slice author wrote the cite from a name-and-rough-
   location memory rather than from a file open.

2. **HIGH-F2** (orphan `:157-162` cite) — substrate header docstring
   carries the explicit claim "re-SOURCED per memory rule 9". The
   cite itself was nonetheless re-quoted from draft notes — visually
   inheriting `keyingsets_builtins.py` as the file context — without
   reopening `_keyingsets_utils.py` to verify the line range. Rule 9
   was DECLARED but not APPLIED at this cite.

The 4-slice Phase 6 streak (6.D + 6.E + 6.F.1 + 6.F.2) gave a false
sense of automaticity. The mechanical re-source workflow needs to
be applied to EVERY cite, not just the "marquee" ones. Memory rule
update (this session): tighten rule 9 phrasing to "Re-OPEN, not just
re-source: every cite must come from a same-session file open. Draft
notes are stale by definition."

---

## File summary

```
src/anim/keyingSets.js          ~500 LOC  NEW  substrate + audit-fix
scripts/test/test_keyingSets.mjs +144     NEW  144 asserts
package.json                    +2 lines  EDIT test:keyingSets wire
```

Net new asserts: 144 (this slice).

---

## Commits this slice (2)

```
2ebefe4 feat(anim): Phase 7 Slice 7.A — Keying Set registry substrate
768d25c fix(audit): Phase 7 Slice 7.A audit-fix — 2 HIGH-F cite + 2 MED + 4 LOW
```

Plus this close-out doc + plan banner update (1 commit).

---

## Top queued path

**Slice 7.B — Insert Keyframe operator.** Plan §7.B specifies an
operator `animation.insertKeyframe(keyingSetId)` with:

1. Resolve set's `collectChannels(activeObject)` → RNA paths.
2. Resolve active Action via `node.animData.actionId`.
3. For each RNA path: get current value via `evaluateRnaPath`, find or
   create FCurve, insert/replace BezTriple at `animationStore.currentTime`.

Modifiers: 'Only Insert Needed' (skip when fcurve already matches),
'Replace' vs 'Always Add' (overwrite-at-time semantic).

**Blender refs (recon for 7.B, partially completed this session):**

- `editors/animation/keyframing.cc:438-461` — `ANIM_OT_keyframe_insert`
  operator definition (`exec = insert_key_exec`).
- `editors/animation/keyframing.cc:410-435` — `insert_key_exec` entry.
- `editors/animation/keyframing.cc:177-..` — `insert_key_with_keyingset`
  kernel (real work).
- `editors/animation/keyframing.cc:479-502` — `ANIM_OT_keyframe_insert_by_name`
  (named-set variant; SS UI may want this shape for the I-menu's "click
  a set" path).
- `editors/animation/keyframing.cc:569-580` — `ANIM_OT_keyframe_insert_menu`
  (menu invoker; 7.C territory).
- `DNA_anim_enums.h:500-524` — `eInsertKeyFlags`:
  `INSERTKEY_NEEDED` (1<<0), `INSERTKEY_REPLACE` (1<<4),
  `INSERTKEY_AVAILABLE` (1<<10).
- `blender_default.py:1402` — I-key bound to `anim.keyframe_insert`.

Estimated 7.B: ~4-6 hours substrate + 1hr audit-fix + 30min close-out.

---

## Pre-commit state

- **Branch**: master, 192 commits ahead of origin (NEVER pushed).
- **Working tree**: about to commit close-out doc + plan banner.
- **Schema**: v42 (unchanged).
- **Phase 7 progress**: 7.A SUBSTRATE-COMPLETE; 5 slices remaining
  (7.B / 7.C / 7.D / 7.E / 7.F).
- **Tests added this slice**: 144 asserts. All cross-slice suites
  green (animationEngine 61, animationStore 55, fcurveEval 35,
  actionRegistry 95).
- **Cite-discipline**: 4-slice clean streak BROKEN at 7.A (1 slice
  in, 2 HIGH-F fabs caught + fixed same-day). Rule 9 application
  discipline tightened in memory `feedback_byte_verify_behavior_cites`.

---

## User-side owed

Nothing new this slice — 7.A is internal substrate with no UI surface.
Manual verification will accrue at Slice 7.F (Phase 7 exit gate)
when the I-menu + insertion kernel are user-visible.
