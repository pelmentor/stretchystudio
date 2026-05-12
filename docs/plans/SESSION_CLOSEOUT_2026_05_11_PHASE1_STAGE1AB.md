# Session Close-out — 2026-05-11 (Animation Phase 1 Stage 1.A+1.B sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE7D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7D.md).
This sub-session shipped **Animation Phase 1 Stage 1.A+1.B — Action
datablock + per-Object AnimData (schema v36)** plus the chore of
tracking `_start.bat` (small ask the user folded in mid-session). One
big substrate commit (`229305a`) + one chore commit (`0ccf985`); the
close-out doc commit follows.

## What shipped this sub-session (2 commits + close-out + audit-fix sweep)

| Commit  | What |
|---------|------|
| `0ccf985` | chore: track `_start.bat` dev launcher (removed gitignore exception). Folded in mid-session per user request. |
| `229305a` | Animation Phase 1 Stage 1.A+1.B — Action datablock + per-Object AnimData. Schema bump v35→v36; ~30 consumer files rewired across save/load + export pipeline + runtime/canvas + editor UI; helper module refactored; store renames; 17 test files updated; 56 new migration assertions. |
| `b6b6ac6` | docs(plan): Phase 1 Stage 1.A+1.B close-out — Action datablock ship + memory updates. |
| `3339257` | fix(audit): Phase 1 Stage 1.A+1.B audit-fix sweep — 5 HIGH + 4 MED gaps. New audit-pin (47 assertions), 14 test fixtures rewritten for canonical double-quote rnaPath grammar, `package.json` wires new pin into `npm test`. Reverses the "Audit status" deferral noted below — the sweep ran in the next sub-session as Resume path A predicted. |
| `d298bf5` | feat(anim): Phase 1 Stage 1.C — `actionRegistry` helpers. 5 lifecycle helpers (`getActionUsers` / `assignAction` / `unassignAction` / `cloneAction` / `deleteAction`) shipped as a pure-function module; `projectStore.deleteAction` delegates so the `node.animData.actionId` cascade runs unconditionally. New `test_actionRegistry.mjs` (65 assertions) wired into `npm test` after `test:animFCurveBridge`. Closes Resume path B. |
| (next)    | fix(audit): Phase 1 Stage 1.C audit-fix sweep — 4 HIGH + 7 MED + 7 LOW gaps. Two parallel audit agents (architecture + Blender-fidelity) ran against `d298bf5`; all HIGH addressed in this sweep + audit-pin (57 assertions). |

## Stage 1.C audit status

Two parallel audit agents (architecture + Blender-fidelity) audited
`d298bf5` post-substrate. 18 unique gaps surfaced (4 HIGH + 7 MED +
7 LOW; 4 cross-audit duplicates compressed). All HIGH addressed in
this sub-session + audit-pin test
(`test_audit_fixes_2026_05_11_phase1_stage1c.mjs`, 57 assertions).

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| G-1/D-2 | HIGH | Cross-audit | `cloneAction` shallow-cloned `driver.variables` (and per-variable `target` objects). Mutating clone's driver path bled into source. Now deep-clones variables[] AND each variable's target — mirrors Blender `fcurve_copy_driver` (`fcurve_driver.cc:1075`). |
| G-3 | HIGH | Architecture | `useAnimationStore.activeActionId` not cleared when its action was deleted; ~10 UI consumers (Timeline, Dopesheet, FCurve editor, etc.) silently no-op'd on the stale id. `projectStore.deleteAction` thunk now resets `activeActionId` to null when it matches the deleted id (cross-store cascade). |
| G-4 | HIGH | Architecture | Substrate inert without projectStore wrappers — `assignAction` / `unassignAction` / `cloneAction` registry helpers couldn't be called via React-aware path. Per Rule №2, callable-by-no-one is the same anti-pattern as callable-but-no-op. Three minimal projectStore thunks shipped delegating to the registry. |
| D-1 | HIGH | Blender-fidelity | `cloneAction` JSDoc claimed parity with `action_copy_data`, but Blender clones `fcurves` + `groups` + `markers` + `layers` + `slots` + `strip_keyframe_data` + `last_slot_handle`; SS clones `fcurves` + `audioTracks` + `meta` only. DOCUMENT-AS-DEVIATION with explicit Phase 4 / Phase 6 follow-up note. |
| G-5 | MED | Architecture | `cloneAction` returned just the new id; every caller paid an `actions.find(...)` scan. Now returns the full clone object (matches Blender `bpy.data.actions["X"].copy()` Python parity). |
| G-7 | MED | Architecture | `assignAction` doesn't reset `actionInfluence` / `actionBlendmode` / `actionExtendmode` (per-Object policy, not per-action). Symmetry note added to JSDoc — mirrors Blender `assign_action` which writes only `action` + `slot_handle` + `last_slot_identifier`. |
| G-8 | MED | Architecture | 6 missing test scenarios: `getActionUsers` after delete, clone-of-bound-action, double-assign slot replacement, double-delete, deep-driver independence, integer-guard rejection. All added. |
| D-3 | MED | Blender-fidelity | Plan §1.C signatures said `→ newProject` (clone said `→ { newProject, newActionId }`), but ship returns `boolean` / action object — MORE Blender-faithful than the plan. Plan doc updated to reflect shipped contract + cite Blender's `bool assign_action` / `bool unassign_action`. |
| D-4 | MED | Blender-fidelity | `assignAction` JSDoc didn't enumerate Blender's `assign_action` skipped behaviours: `last_slot_identifier` mirror, NLA tweak-mode editability guard, datablock reference counting. DOCUMENT-AS-DEVIATION with Phase-4 follow-up note. |
| D-5 | MED | Blender-fidelity | `unassignAction` returns `false` on already-null binding; Blender returns `true` ("postcondition holds"). Net effect on project shape identical, only caller-visible signal differs. DOCUMENT-AS-DEVIATION (UI-distinguishable no-op-vs-miss is intentional). |
| D-6 | MED | Blender-fidelity | `slot` parameter unguarded; non-integer / negative values would corrupt project shape. Added `Number.isInteger(slot) && slot >= 0` guard per Blender's `slot_handle_t` (signed int32, `Slot::unassigned = 0`). |
| G-2/D-8 | LOW | Cross-audit | `deleteAction` cascade walks `animData.actionId` only; future `nlaTracks[].strips[].actionId` (Phase 4) not covered. DOCUMENT-AS-DEVIATION with explicit Phase-4 follow-up TODO. |
| G-6 | LOW | Architecture | `getActionUsers` returns live node references; mutating outside immer bypasses undo + `hasUnsavedChanges`. Stronger JSDoc warning + explicit "MUTATING outside `produce()`" callout. |
| G-9 | LOW | Architecture | File header documented in-place mutation convention but didn't flag the cloneAction return-shape divergence from plan. Header rewritten with explicit "Return shapes follow the Blender helpers' contract rather than the plan's prose" section. |
| G-10 | LOW | Architecture | Dead defensive re-bind block in `cloneAction` (line was unreachable because the missing-`actions` early return at `src` lookup fired first). Removed. |
| D-7 | LOW | Blender-fidelity | `meta.source = 'authored'` on clone is SS-specific; Blender's Action has no `meta` field. DOCUMENT-AS-DEVIATION in cloneAction JSDoc (was only in module header). |
| D-9 | LOW | Blender-fidelity | `__scene__` synthetic Object enumerated by `getActionUsers` but not yet a valid `assignAction` target until Stage 1.D. Read/write asymmetry documented in `getActionUsers` JSDoc. |
| D-10 | LOW | Blender-fidelity | Plan §1.C missing "Stage 1.E entry gate" sub-section listing UI consumers Stage 1.E will rewire. Added (3 consumers: ActionsEditor, Properties panel AnimData section, per-action "Used by" strip). |

## What was the gap

Pre-v36, animation data lived on a project-level flat list:

```js
project.animations[i] = {
  id, name, fps, duration?, audioTracks,
  tracks: [{ paramId | (nodeId + property), keyframes: [{time, value, easing}] }]
}
```

That conflated Blender's `Action` datablock with `AnimData` (the
per-Object slot binding an Object to one Action), and addressed
animation targets via inline fields rather than RNA paths. The active
clip was selected purely by the UI store's `activeAnimationId` — no
per-Object binding, no NLA, no driver/animation distinction at the
data layer.

Per the Animation Blender-Parity Plan §Phase 1 (lines 419-578), the v36
schema flips this to Blender's
[`DNA_action_types.h:215-360`](../../reference/blender/source/blender/makesdna/DNA_action_types.h)
+ [`DNA_anim_types.h:664-740`](../../reference/blender/source/blender/makesdna/DNA_anim_types.h)
shape:

```js
project.actions[i] = {
  id, name, fps, duration?, frameStart?, frameEnd?, audioTracks,
  fcurves: [{ id, rnaPath, arrayIndex, keyforms, modifiers, driver?, extrapolation }],
  flag, meta
}
node.animData = {
  actionId, actionInfluence, actionBlendmode, actionExtendmode,
  slotHandle, nlaTracks, drivers, flag
}
```

Per Rule №2, `project.animations` is deleted by the migration — no
backward-compat shims; consumers are rewired to read the new shape in
the same vehicle.

## The conversion

### Migration v36 (`migrations/v36_action_datablock.js`)

- Each `project.animations[i]` → `project.actions[i]` with:
  - `tracks → fcurves` via inlined `trackToFCurveInline` (the migration
    is time-locked; doesn't depend on the evolving helper module).
  - `track.paramId='X'` → `fcurve.rnaPath="objects['__params__'].values['X']"`.
  - `track.nodeId='Y' + property='Z'` → `fcurve.rnaPath="objects['Y'].Z"`.
  - `track.keyframes[]` → `fcurve.keyforms[]` (preserves `time/value/easing`
    + adds `type` derived from `easing` for the FCurve evaluator).
  - `track.driver` → `fcurve.driver` (verbatim).
  - `flag: 0` (ACT_CYCLIC | ACT_MUTED | ACT_FRAME_RANGE bitmask, default 0).
  - `meta: { createdAt, modifiedAt, source: 'authored' }` (ports legacy
    timestamps if present; defaults source to 'authored').
- Every Object node (`type ∈ {'part', 'group'}`) gains
  `node.animData = defaultAnimData()` if missing.
- `project.animations` is deleted (Rule №2).
- Idempotent: re-runs on a v36+ project are no-ops.

### Helper module refactor (`src/anim/animationFCurve.js`)

Pre-v36 this was the "track → fcurve bridge". Post-v36 the bridge is
retired (no production callers construct legacy track shapes anymore);
the module ships canonical FCurve construction + identity helpers:

| Helper | Purpose |
|--------|---------|
| `buildParamFCurve(paramId, keyforms, opts?)` | Canonical constructor for parameter-target fcurves. |
| `buildNodeFCurve(nodeId, property, keyforms, opts?)` | Canonical constructor for object-property fcurves. |
| `decodeFCurveTarget(fc)` | Returns `{kind:'param', paramId} \| {kind:'node', nodeId, property} \| null` from `fc.rnaPath`. |
| `fcurveTargetsParam(fc, paramId)` / `fcurveTargetsNode(fc, nodeId)` | Predicates for filtering fcurves by their addressed target. |
| `renameFCurveParam(fc, oldId, newId)` / `renameFCurveNode(fc, oldId, newId)` | Mutators for projectStore's param-rename + node-duplicate cascades. |
| `evaluateActionFCurves(action, time, evalContext?)` | Bulk evaluator returning `Map<rnaPath, value>`. |
| `normalizeKeyforms(input)` | Drops malformed entries; defaults `easing → 'linear'`; derives `type`. |

### Store renames

| Pre-v36 | Post-v36 |
|---------|----------|
| `useAnimationStore.activeAnimationId` | `activeActionId` |
| `useAnimationStore.setActiveAnimationId` | `setActiveActionId` |
| `useAnimationStore.switchAnimation` | `switchAction` |
| `projectStore.createAnimation` | `createAction` |
| `projectStore.renameAnimation` | `renameAction` |
| `projectStore.deleteAnimation` | `deleteAction` |
| `paramReferences.report.animationTracks` | `actionFCurves` |
| `paramReferences.kind: 'animationTrack'` | `kind: 'actionFCurve'` |
| `depgraph.ANIMATION_ID_REF` (`'__animation__'`) | `ACTION_ID_REF` (`'__action__'`) |
| `depgraph.EvalContext.animation` | `EvalContext.action` |
| `depgraph.BuildOptions.animation` | `BuildOptions.action` |
| ANIMATION_TRACK_EVAL op tag = `<targetId>/<property>` | op tag = `fc.rnaPath` (string equality) |

### Consumer rewires (~30 files)

| Domain | Files |
|--------|-------|
| Save/load + store | `projectFile.js`, `projectStore.js` (CRUD + cascades + reset/load), `animationStore.js` |
| Export pipeline | `exporter.js`, `motion3json.js`, `exportSpine.js`, `exportValidation.js`, `motion3jsonImport.js`, `idle/builder.js`, `paramReferences.js`, `exportAnimation.js`, `can3writer.js`, `can3/sceneEmit.js`, `cmo3/meshVertsWarp.js`, `cmo3writer.js`, `cmo3/emitContext.js`, `cmo3Import.js` |
| Runtime / depgraph / canvas | `animationEngine.js`, `depgraph/build.js`, `depgraph/eval.js`, `depgraph/evalProjectFrame.js`, `depgraph/kernels/{fcurve,animation}.js`, `nodetree/animationCompile.js`, `nodetree/nodes/animation.js`, `nodetree/types.js`, `CanvasViewport.jsx`, `GizmoOverlay.jsx`, `SkeletonOverlay.jsx`, `viewport/captureExportFrame.js` |
| Editor UI | `TimelineEditor.jsx` (23 distinct edits — biggest single file), `AnimationsEditor.jsx`, `FCurveEditor.jsx`, `DopesheetEditor.jsx`, `IdleMotionDialog.jsx`, `ExportModal.jsx`, `ParameterTab.jsx`, `ParamRow.jsx`, `PerformanceEditor.jsx`, `NodeTreeArea.jsx` |
| Migrations | `projectSchemaVersion.js`, `projectMigrations.js`, `migrations/v24_nodetree_animationtree.js` (rewrote with inlined `compileLegacyAnimationTree` so its shadow stays time-locked to v24's pre-v36 shape; NodeTree retirement is a separate follow-up) |

### Inline AnimationTree shadow rewire

The v24 NodeTree shadow lifts every clip into `nodeTrees.animation[clipId]`
as an FCurveStrip-per-track tree. The post-v36 `compileAnimationTree`
helper expects an action with `.fcurves`, but v24 runs at schema 24
(BEFORE v36 lifts animations → actions) and sees the legacy track
shape. To keep v24 time-locked without depending on the evolving helper:

- v24 inlines a `compileLegacyAnimationTree(animation)` that emits the
  same tree shape with `storage: { track }` per strip (legacy storage).
- `FCurveStrip` node-type executor handles BOTH storage shapes:
  - Post-v36 path: `storage.fcurve` decoded via `decodeFCurveTarget`.
  - v24-shadow path: `storage.track` reads legacy `paramId/nodeId/property` fields.

Either branch evaluates via the same `interpolateTrack` primitive
(unit-agnostic between `keyforms` / `keyframes` arrays).

### Out of scope (deferred to follow-up commits)

Per Animation Plan §Phase 1.C–1.G (which §Phase 1 collectively covers):

- **Stage 1.C** — `src/anim/actionRegistry.js` helpers
  (`assignAction` / `unassignAction` / `cloneAction` / `deleteAction` /
  `getActionUsers`).
- **Stage 1.D** — `__scene__` pseudo-Object node carrying project-wide
  `animData` for actions that animate the whole project. Until then,
  consumers continue to pick the active action via the UI store
  (`useAnimationStore.activeActionId`).
- **Stage 1.E** — `AnimationsEditor.jsx` → `ActionsEditor.jsx` UI rename
  + per-action "Used by" surfacing + drag-to-bind into Properties panel.
- **NodeTree retirement** — `project.nodeTrees.{rig,driver,animation}`
  deletion. Pre-flight: NodeTreeEditor refactor to render
  `selectRigSpec(project)` directly (read-only, no datablock).
- **Stage 1.F + 1.G** — five new test suites (`test_actionDatablock_migration`,
  `test_actionRegistry`, `test_actionScene`, `test_actionExportMotion3`,
  `test_actionExportCan3`) + Phase 1 exit gate (Cubism Viewer
  acceptance load on Shelby — Hiyori has no PSD source so can't host
  the keyframed-Action test; Shelby is the canonical PSD test
  character per memory `feedback_test_character_is_shelby.md`).

### Audit status

**UPDATE 2026-05-11 (post-close-out):** the dual audit was run in the
next sub-session and shipped as `3339257`. Two parallel agents
(architecture + Blender-fidelity) reviewed `229305a` and returned 9 gaps
(5 HIGH + 4 MED). All fixed in one sweep + audit-pin test
(`test_audit_fixes_2026_05_11_phase1_stage1ab.mjs`, 47 assertions).

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| A-1 | HIGH | Architecture | `kernels/fcurve.js` divided ctx.timeMs by 1000 (legacy from pre-v36 seconds-shaped keyforms); FCURVE_EVAL would silently return first-keyform value because seconds always compared less than ms-shaped keyform times. Latent — current build pass emits ANIMATION_TRACK_EVAL not FCURVE_EVAL. |
| A-2 | HIGH | Architecture | v36 migration `extrapolation` ternary collapsed to dead `'constant' : 'constant'`; fixed to `'constant' : 'linear'` so a linear-easing terminator migrates with linear extrap (matching Blender's `FCURVE_EXTRAPOLATE_LINEAR`). |
| B-1 | HIGH | Blender-fidelity | rnaPath bracket-keys used single-quote (`objects['X']`); Blender's RNA tokenizer at `rna_path.cc:127` accepts only double-quote (`*p == '"'`). Single-quoted keys would fall to the unquoted numeric branch and parse-fail. Switched constructors + decoder regex + 4 production regexes + v36 migration emit + 14 test fixtures to canonical double-quote; v36 idempotency normalises pre-fix saves on load. |
| B-2 | HIGH | Blender-fidelity | `defaultAnimData` cited non-existent enum names `ACT_BLEND_REPLACE`/`ACT_EXTEND_HOLD`; real names per `DNA_anim_enums.h:375,386` are `NLASTRIP_MODE_REPLACE`/`NLASTRIP_EXTEND_HOLD`. |
| B-3 | HIGH | Blender-fidelity | `actionInfluence = 1.0` cited DNA struct (which value-inits to 0); real default lives in BKE constructor `anim_data.cc:123`. Citation corrected. |
| A-3 | MED | Architecture | mesh_verts keyforms silently dropped during migration (array-shaped values not supported by Phase 1 scalar shape) — added drop-site comment + Phase 4 pointer. |
| A-4 | MED | Architecture | `evaluateActionFCurves` `time` parameter renamed to `timeMs` (ms-canonical contract). |
| B-4 | MED | Blender-fidelity | `eAction_Flag` comment expanded to enumerate all 5 bits per `DNA_action_types.h:374-387` (was only listing 3). |
| B-5 | MED | Blender-fidelity | `rnaPath.js` documents `__params__`/`__armature__`/`__scene__` as SS-specific (no Blender analogue) + Stage 1.D coexistence rule. |

Full `npm test` chain still exits 0 post-sweep; typecheck clean.

## Test scoreboard

All Phase 1 Stage 1.A+1.B-touched suites green.

| Suite | Assertions |
|-------|------------|
| `test_migration_v36` (NEW, schema migration) | 56 |
| `test_animFCurveBridge` (rewritten for new helper API) | 51 |
| `test_paramReferences` (rewritten for `actionFCurves` field) | 27 |
| `test_paramCrud` (rewired removeParameter/renameParameter cascade) | 51 |
| `test_animationStore` (rename activeActionId/switchAction) | 55 |
| `test_serializerPurity` (saves/loads `actions` field in JSON) | 10 |
| `test_animationEngine` (computePoseOverrides accepts action shape) | 57 |
| `test_depgraph_build` (action: option + ACTION_ID_REF + rnaPath tags) | 37 |
| `test_depgraph_eval_simple` (FCurve eval via action.fcurves) | 12 |
| `test_depgraph_eval_animation` (byte-fidelity vs computeParamOverrides) | 7 |
| `test_animationTree_migration` (action shape + v24 shadow co-existence) | 15 |
| `test_nodeTreeEditor_renderRead` (compileAnimationTree(action) layout) | 24 |
| `test_audit_fixes_2026_05_11_phase8` (schema-version pin relaxed `>=35`) | 26 |
| `test_idleBuilder` (resultToSsAction returns action shape) | (existing — passes) |
| `test_exportAnimation` (resolveActions + actionsToExport) | (existing — passes) |
| `test_migrations` (v0→v36 chain + intermediate v11 puppet-pin removal) | 137 |

Full `npm test` chain exits 0; typecheck clean. **No new audit-pin
suite shipped** in this sub-session (audit pattern deferred — see
"Audit status" above).

## Resume paths for fresh session

### A. Animation Phase 1 dual-audit + audit-fix sweep ~~(recommended next)~~ — SHIPPED `3339257`

This was the recommended next step at original close-out time, and it
was executed: see "Audit status" above. 9 gaps surfaced + closed in
one sweep. Phase 1 Stage 1.A+1.B substrate is now audit-clean.

### B. Animation Phase 1 Stage 1.C — actionRegistry helpers ~~(recommended next)~~ — SHIPPED `d298bf5`

Per plan §1.C, shipped `src/anim/actionRegistry.js`:

```js
export function getActionUsers(project, actionId) -> Object[]
export function assignAction(project, objectId, actionId, slot=0) -> boolean
export function unassignAction(project, objectId) -> boolean
export function cloneAction(project, actionId, newName) -> string | null
export function deleteAction(project, actionId) -> { removed, cascaded }
```

In-place mutation throughout (matches migrations + `objectDataAccess.js`
+ every projectStore `produce(...)` thunk). The plan's `-> newProject`
annotation is JSDoc shorthand for "project state after the call".

`projectStore.deleteAction` now delegates so the cascade to
`node.animData.actionId` runs whether deletion came from the (current)
Actions panel or future ActionsEditor (Stage 1.E). No projectStore
wrappers shipped for `assignAction` / `unassignAction` / `cloneAction`
yet — they land in Stage 1.E when ActionsEditor is the caller (per
Rule №2: registered-but-unused thunks would be dead-code crutches).

Test scoreboard: `test_actionRegistry.mjs` 65 assertions (registry CRUD
+ cascade + defensive shape checks + projectStore delegation pin via
source-grep). Full `npm test` chain exits 0; typecheck clean.

### C. Animation Phase 1 Stage 1.D — `__scene__` pseudo-Object

Per plan §1.D, introduce a `{id: '__scene__', type: 'sceneObject', animData: {actionId:...}}`
node in `project.nodes` for actions that animate the whole project
(typical Cubism character motion). The exporter treats `__scene__`
identically to an Object AnimData. The selector for "what's the active
action?" shifts from `useAnimationStore.activeActionId` to
`getActiveActionForScene(project)` which falls back to the UI store
when no `__scene__` binding exists.

### D. Animation Phase 1 Stage 1.E — UI file rename

`src/v3/editors/animations/AnimationsEditor.jsx` → `ActionsEditor.jsx`.
Updates: `editorRegistry` keys, `useEditorStore.editorMode` enum,
default workspace tabs, all import sites. Per-action "Used by: <objects>"
list (consumes `getActionUsers` from Stage 1.C).

### E. NodeTree retirement (parallel work-thread)

Delete `project.nodeTrees.{rig,driver,animation}` entirely. Refactor
NodeTreeEditor to render `selectRigSpec(project)` directly (read-only,
no datablock). Drop v22 + v23 + v24 migrations. Drop the v24-shadow
branch in `FCurveStrip` node-type executor. The post-v36
`compileAnimationTree(action)` becomes the sole compile path.

### F. Stage 1.F + 1.G — Phase 1 exit gate

5 new test suites + manual Cubism Viewer acceptance gates on
**Shelby** + **test_image4** — each PSD with one keyframed Action.
BOTH PSDs are required per memory `feedback_test_character_is_shelby.md`
("the byte-fidelity gate must exercise **both** PSDs"; same dual-PSD
policy already in plan §11 lines 1625-1626 and Phase 0.D flag-flip
gate). Anime topology (test_image4) has historically exposed bugs the
Western fixture (Shelby) missed — BUG-025 leg-roles fly was anime-
only. Hiyori is reference-only with no PSD source. Required to
declare Phase 1 fully shipped.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (37 from earlier 2026-05-11 close-outs through `51481dd`) | Phases 0–7.D ship + 11 audit-fix sweeps + 7 close-out docs + Phase 8 |
| 38    | `0ccf985` | chore: track `_start.bat` dev launcher (gitignore exception removed) |
| 39    | `229305a` | feat(anim): Phase 1 Stage 1.A+1.B — Action datablock + AnimData (v36) |
| 40    | `b6b6ac6` | docs(plan): Phase 1 Stage 1.A+1.B close-out (initial doc) |
| 41    | `3339257` | fix(audit): Phase 1 Stage 1.A+1.B audit-fix sweep — 5 HIGH + 4 MED |
| 42    | `093a8dc` | docs(plan): Phase 1 Stage 1.A+1.B audit-fix close-out addendum |
| 43    | `d298bf5` | feat(anim): Phase 1 Stage 1.C — `actionRegistry` helpers |
| 44    | (next)    | fix(audit): Phase 1 Stage 1.C audit-fix sweep — 4 HIGH + 7 MED + 7 LOW (this update) |

## Schemas after Phase 1 Stage 1.A+1.B

`CURRENT_SCHEMA_VERSION = 36`. v36 adds the Action datablock + per-Object
AnimData (lifted from legacy `project.animations[]`).

## Hotkey reservations

Phase 1 Stage 1.A+1.B added no new hotkeys (substrate flip + plan-doc
work). The Phase 6 `I` reservation (Insert Keyframe) remains queued
for Stage 1.E + Phase 6 of the animation plan.
