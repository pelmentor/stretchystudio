# Session Close-out — 2026-05-11 (Animation Phase 1 Stage 1.C sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md).
This sub-session shipped **Animation Phase 1 Stage 1.C — `actionRegistry`
helpers** (the 5 lifecycle helpers per plan §1.C) plus the same-day
dual-audit + audit-fix sweep. Two commits: substrate (`d298bf5`) +
audit-fix sweep (`aed272e`). Both pushed to `origin/master`.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `d298bf5` | feat(anim): Phase 1 Stage 1.C — `actionRegistry` helpers. New `src/anim/actionRegistry.js` with 5 lifecycle helpers; `projectStore.deleteAction` delegates so the cascade to `node.animData.actionId` runs unconditionally. `test_actionRegistry.mjs` 65 assertions. |
| `aed272e` | fix(audit): Phase 1 Stage 1.C audit-fix sweep — 4 HIGH + 7 MED + 7 LOW. New audit-pin (57 assertions), `test_actionRegistry.mjs` extended to 87 assertions. Closes G-3 (cross-store cascade), G-4 (substrate inert), G-1/D-2 (deep-clone driver), D-1 (clone parity scope) HIGH gaps + 14 MED/LOW. |

## What was the gap

Stage 1.A+1.B (commit `229305a` + audit-fix `3339257`) shipped the
v36 schema flip — `project.actions[]` + per-Object `node.animData` —
but only the basic `create / rename / delete` projectStore primitives.
Plan §1.C calls for a proper registry module covering the lifecycle
operations that touch BOTH `project.actions[]` AND every Object's
`animData` slot in one atomic step:

```js
getActionUsers(project, actionId)       // who's bound to this action?
assignAction(project, objectId, actionId, slot=0)   // bind one Object
unassignAction(project, objectId)        // clear one Object's binding
cloneAction(project, actionId, newName)  // deep-copy with fresh id
deleteAction(project, actionId)          // remove + cascade to nullify animData.actionId
```

Without `deleteAction`'s cascade, deletion would leave dangling-pointer
references (`animData.actionId = "<deleted>"`) for the runtime to
defensively skip — exactly the crutch Rule №1 prohibits.

## The conversion

### Substrate (`d298bf5`)

- New module `src/anim/actionRegistry.js` implementing the 5 helpers
  with in-place mutation throughout (matches migrations +
  `objectDataAccess.js` + every `projectStore` `produce(...)` thunk
  convention). The plan's `→ newProject` annotations are JSDoc
  shorthand for "project state after the call".
- `projectStore.deleteAction` (the existing thunk from Stage 1.A+1.B)
  delegates to `registryDeleteAction` so the cascade kicks in whether
  the deletion comes from the (current) Actions panel, the
  (Stage 1.E) future ActionsEditor, or any programmatic call site.
- New test `scripts/test/test_actionRegistry.mjs` — 65 assertions
  covering registry CRUD + cascade + defensive shape checks +
  projectStore delegation pin (string-grep on the import + the call
  site so future refactors that bypass the registry surface as a
  regression).
- Wired into `npm test` chain after `test:animFCurveBridge`.
- Schema unchanged (uses v36 `node.animData` from Stage 1.A+1.B).

Blender source mirrors:
- `assign_action` → `reference/blender/source/blender/animrig/intern/action.cc:1166`
- `unassign_action` → `:1199` (literally `assign_action(nullptr, …)`)
- `action_copy_data` → `reference/blender/source/blender/blenkernel/intern/action.cc:119`
- `BKE_animdata_ensure_id` runtime override → `blenkernel/intern/anim_data.cc:123` (act_influence = 1.0f)

### Same-day dual audit

Per the **established pattern** (memory:
`feedback_dual_audit_after_phase_ship.md`), two parallel
`general-purpose` agents ran against `d298bf5`:

1. **Architecture audit** — surfaced 10 gaps (4 HIGH + 5 MED + 1 LOW)
2. **Blender-fidelity audit** — surfaced 10 gaps (2 HIGH + 4 MED + 4 LOW)

After cross-audit dedup (4 duplicates compressed), 18 unique gaps
total: **4 HIGH + 7 MED + 7 LOW**.

### Audit-fix sweep (`aed272e`)

All HIGH addressed + 14 MED/LOW; all in one commit + audit-pin
(`test_audit_fixes_2026_05_11_phase1_stage1c.mjs`, 57 assertions
across 16 gap blocks + 1 functional integration).

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| G-1/D-2 | HIGH | Cross-audit | `cloneAction` shallow-cloned `driver.variables[]` + each variable's `target` object. Mutating clone's driver path bled into source. Now deep-clones both arrays + per-variable target objects (mirrors Blender `fcurve_copy_driver` `fcurve_driver.cc:1075`). |
| G-3 | HIGH | Architecture | `useAnimationStore.activeActionId` not cleared when its action was deleted; ~10 UI consumers (Timeline, Dopesheet, FCurve editor, ParamRow, CanvasViewport, GizmoOverlay, SkeletonOverlay, ExportModal, NodeTreeArea) silently no-op'd on the stale id. `projectStore.deleteAction` thunk now resets `activeActionId` to null when it matches the deleted id. |
| G-4 | HIGH | Architecture | Substrate inert without projectStore wrappers — registry helpers couldn't reach a React-aware path. Per Rule №2, callable-by-no-one is the same anti-pattern as callable-but-no-op (just inverted). Three minimal projectStore thunks (`assignAction` / `unassignAction` / `cloneAction`) shipped delegating to the registry. |
| D-1 | HIGH | Blender-fidelity | `cloneAction` JSDoc claimed parity with `action_copy_data` but Blender clones `groups` + `markers` + `layers` + `slots` + `strip_keyframe_data` + `last_slot_handle` too. SS clones `fcurves` + `audioTracks` + `meta` only. DOCUMENT-AS-DEVIATION with explicit Phase 4 / Phase 6 follow-up note. |
| G-5 | MED | Architecture | `cloneAction` returned just the new id; every caller paid an `actions.find(...)` scan. Now returns the full clone object (matches Blender `bpy.data.actions["X"].copy()` Python parity). |
| G-7 | MED | Architecture | `assignAction` doesn't reset `actionInfluence` / `actionBlendmode` / `actionExtendmode` (per-Object policy, not per-action — mirrors Blender `assign_action` write-set: `action` + `slot_handle` + `last_slot_identifier` only). Symmetry note added to JSDoc. |
| G-8 | MED | Architecture | 6 missing test scenarios added: `getActionUsers` after delete, clone-of-bound-action, double-assign slot replacement, double-delete, deep-driver independence, integer-guard rejection. |
| D-3 | MED | Blender-fidelity | Plan §1.C signatures said `→ newProject` (clone said `→ { newProject, newActionId }`); ship returns `boolean` / action object — MORE Blender-faithful than the plan (`bool assign_action`). Plan doc updated with shipped contract + Blender citations. |
| D-4 | MED | Blender-fidelity | `assignAction` JSDoc didn't enumerate Blender `assign_action`'s skipped behaviours: `last_slot_identifier` mirror, NLA tweak-mode editability guard, datablock reference counting. DOCUMENT-AS-DEVIATION with Phase-4 follow-up note. |
| D-5 | MED | Blender-fidelity | `unassignAction` returns `false` on already-null binding; Blender returns `true` ("postcondition holds"). Net effect on project shape identical, only caller-visible signal differs. DOCUMENT-AS-DEVIATION (UI-distinguishable no-op-vs-miss intentional). |
| D-6 | MED | Blender-fidelity | `slot` parameter unguarded — non-integer / negative writes would corrupt project shape. Added `Number.isInteger(slot) && slot >= 0` guard per Blender's `slot_handle_t` (signed int32, `Slot::unassigned = 0` per `animrig/ANIM_action.hh:731`). |
| G-2/D-8 | LOW | Cross-audit | `deleteAction` cascade walks `animData.actionId` only; future `nlaTracks[].strips[].actionId` (Phase 4) not covered. DOCUMENT-AS-DEVIATION with explicit Phase-4 follow-up TODO. |
| G-6 | LOW | Architecture | `getActionUsers` returns live node references; mutating outside `produce()` bypasses immer + undo. Stronger JSDoc warning + explicit "MUTATING outside `produce()`" callout. |
| G-9 | LOW | Architecture | File header documented in-place mutation convention but didn't flag the `cloneAction` return-shape divergence from plan. Header rewritten with explicit "Return shapes follow the Blender helpers' contract rather than the plan's prose" section. |
| G-10 | LOW | Architecture | Dead defensive re-bind block in `cloneAction` (unreachable because the missing-`actions` early-return at `src` lookup fired first). Removed. |
| D-7 | LOW | Blender-fidelity | `meta.source = 'authored'` on clone is SS-specific (Blender's Action has no `meta` field). DOCUMENT-AS-DEVIATION in cloneAction JSDoc (was only in module header). |
| D-9 | LOW | Blender-fidelity | `__scene__` synthetic Object enumerated by `getActionUsers` but not yet a valid `assignAction` target until Stage 1.D. Read/write asymmetry documented in JSDoc. |
| D-10 | LOW | Blender-fidelity | Plan §1.C missing "Stage 1.E entry gate" sub-section listing UI consumers Stage 1.E will rewire. Added (3 consumers: ActionsEditor, Properties panel AnimData section, per-action "Used by" strip). |

Audit reports: the agent results are summarised inline here; the
substrate audit was conducted via parallel `general-purpose` agents
in this sub-session (no separate `AUDIT_2026_05_11_PHASE1_STAGE1C_*.md`
disk artefacts — the close-out's Stage 1.C audit-status table IS the
canonical audit record).

## Test scoreboard

All Phase 1 Stage 1.C-touched suites green.

| Suite | Assertions |
|-------|------------|
| `test_actionRegistry` (substrate `d298bf5` + 22 added in `aed272e`) | 87 |
| `test_audit_fixes_2026_05_11_phase1_stage1c` (NEW, 16 gap blocks + integration) | 57 |
| `test_animationStore` (existing, `activeActionId` reset is via thunk; no test churn) | (existing — passes) |
| `test_paramReferences` (no churn from Stage 1.C) | (existing — passes) |
| `test_migration_v36` (no churn) | (existing — passes) |
| Plus all 188+ prior-day suites | (existing — passes) |

Full `npm test` chain exits 0; typecheck clean.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (37 from earlier 2026-05-11 close-outs through `51481dd`) | Phases 0–7.D ship + 11 audit-fix sweeps + 7 close-out docs + Phase 8 |
| 38    | `0ccf985` | chore: track `_start.bat` dev launcher |
| 39    | `229305a` | feat(anim): Phase 1 Stage 1.A+1.B — Action datablock + AnimData (v36) |
| 40    | `b6b6ac6` | docs(plan): Phase 1 Stage 1.A+1.B close-out (initial) |
| 41    | `3339257` | fix(audit): Phase 1 Stage 1.A+1.B audit-fix sweep — 5 HIGH + 4 MED |
| 42    | `093a8dc` | docs(plan): Phase 1 Stage 1.A+1.B audit-fix close-out addendum |
| 43    | `d298bf5` | feat(anim): Phase 1 Stage 1.C — `actionRegistry` helpers |
| 44    | `aed272e` | fix(audit): Phase 1 Stage 1.C audit-fix sweep — 4 HIGH + 7 MED + 7 LOW |
| 45    | (next)    | docs(plan): Stage 1.C close-out doc (this file) |

## Schemas after Phase 1 Stage 1.C

`CURRENT_SCHEMA_VERSION = 36`. **No schema bump in this sub-session** —
Stage 1.C is pure helper-module work on top of v36's `project.actions[]`
+ `node.animData` shape from Stage 1.A+1.B.

## Hotkey reservations

Stage 1.C added no new hotkeys (substrate flip + thunk wiring). The
Phase 6 `I` reservation (Insert Keyframe) remains queued for Stage 1.E
+ Phase 6 of the animation plan.

## Resume paths for fresh session

Pick one (or several — they're largely independent):

### A. Animation Phase 1 Stage 1.D — `__scene__` pseudo-Object (recommended next)

Per plan §1.D (lines 539-545), introduce a
`{id: '__scene__', type: 'sceneObject', animData: {actionId:...}}`
node in `project.nodes` for actions that animate the whole project
(typical Cubism character motion). The exporter treats `__scene__`
identically to an Object AnimData — it walks the FCurves and writes
them to motion3.json.

The selector for "what's the active action?" shifts from
`useAnimationStore.activeActionId` to
`getActiveActionForScene(project)` which falls back to the UI store
when no `__scene__` binding exists. Audit-fix D-9 from this
sub-session (the read/write asymmetry between `getActionUsers` and
`assignAction` for synthetic nodes) closes naturally once `__scene__`
exists.

Schema bump v37 (next after v36). Migration creates `__scene__` node
if missing on every legacy v36 project.

### B. Animation Phase 1 Stage 1.E — UI rename + ActionsEditor

Per plan §1.E (lines 547-557):
- `src/v3/editors/animations/AnimationsEditor.jsx` → `ActionsEditor.jsx`
- Per-action "Used by: <objects>" strip (consumes `getActionUsers`
  from Stage 1.C — already shipped)
- "Duplicate" command (consumes `cloneAction` thunk from Stage 1.C —
  already shipped, returns full action object)
- Drag an action into an Object's AnimData slot in the Properties
  panel (consumes `assignAction` thunk from Stage 1.C — already
  shipped)
- Timeline action picker dropdown

Updates: `editorRegistry` keys, `useEditorStore.editorMode` enum,
default workspace tabs, all import sites. Stage 1.E entry-gate
sub-section in plan §1.C lists the 3 UI consumers.

### C. NodeTree retirement (parallel work-thread)

Delete `project.nodeTrees.{rig,driver,animation}` entirely. Refactor
NodeTreeEditor to render `selectRigSpec(project)` directly (read-only,
no datablock). Drop v22 + v23 + v24 migrations. Drop the v24-shadow
branch in `FCurveStrip` node-type executor (v36 added this for
backward compat with the v24-shadow during Stage 1.A+1.B; once
NodeTrees retire, the post-v36 `compileAnimationTree(action)` becomes
the sole compile path).

### D. Stage 1.F + 1.G — Phase 1 exit gate

Per plan §1.F + 1.G:
- 5 new test suites: `test_actionDatablock_migration`,
  `test_actionRegistry` (already shipped, 87 assertions),
  `test_actionScene` (depends on Stage 1.D),
  `test_actionExportMotion3`, `test_actionExportCan3`
- Manual Cubism Viewer acceptance gates on **Shelby** + **test_image4**
  — each PSD with one keyframed Action. BOTH PSDs are required per
  memory `feedback_test_character_is_shelby.md` ("the byte-fidelity
  gate must exercise **both** PSDs"; same dual-PSD policy already in
  plan §11 lines 1625-1626 and Phase 0.D flag-flip gate). Anime
  topology (test_image4) has historically exposed bugs the Western
  fixture (Shelby) missed — BUG-025 leg-roles fly was anime-only.
  Hiyori is reference-only with no PSD source.

Required to declare Phase 1 fully shipped. Stage 1.D + 1.E should
land first; this is the closing gate.

### Recommended order

A → B → C → D. Stage 1.D unblocks 1.E's Properties-panel AnimData
section (needs `__scene__` to bind global motion). Stage 1.E
exercises Stage 1.C's helpers in production UI. NodeTree retirement
is decoupled and can land anytime once 1.E has stabilised. Stage
1.F+1.G is the gate.

## Cross-references

- Animation plan: [docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md) §Phase 1 (lines 419-578)
- Stage 1.A+1.B close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md)
- Phase 7.D close-out (full toolset day-end): [SESSION_CLOSEOUT_2026_05_11_PHASE7D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7D.md)
- Memory: dual-audit-after-every-phase-ship pattern
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
