# Session Close-out — 2026-05-11 (Animation Phase 1 Stage 1.E sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md).
This sub-session shipped **Animation Phase 1 Stage 1.E — `ActionsEditor`
rename + 11-file `activeActionId` consumer rewire + Properties AnimData
section** (no schema bump; substrate uses Stage 1.D's v37 `__scene__`
node) + the same-day dual-audit + audit-fix sweep. Two commits:
substrate (`4d3892a`) + audit-fix sweep (`45371d5`). Both pushed to
`origin/master`.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `4d3892a` | feat(anim): Phase 1 Stage 1.E — `AnimationsEditor` → `ActionsEditor` rename (file + directory + EditorType + workspace area) + 11-file `activeActionId` consumer rewire through `getActiveSceneAction(project, fallback)` + new Properties `AnimDataSection` for per-Object Action binding + scene-action header / Used-by strip / Duplicate command in ActionsEditor + Timeline picker scene-rebind. Tests: `test_stage1e_actions_editor.mjs` (56 assertions) + `test_uiV3Store.mjs` workspace-area assertion update. Plan §1.E + §1.C entry-gate enumeration (D-9 Stage 1.D) closed. |
| `45371d5` | fix(audit): Phase 1 Stage 1.E audit-fix sweep — 4 HIGH + 8 MED + 12 LOW. New audit-pin (`test_audit_fixes_2026_05_11_phase1_stage1e.mjs`, 39 assertions). HIGH: D-1 Item-tab placement deferral note (Blender Data tab port queued for Stage 1.F + Phase 2 entry-gate), D-2 "Animation Data" → "Animation" label, D-3 default-collapsed AnimData section, D-4 last-position in tab. MED: G-3 deletion-cascade UX feedback (toast + AlertDialog binding pre-display), G-10 `cloneAction` thunk returns FULL object (not id), D-6 `.001` Blender naming via new `nextDotNNNName` helper, D-5/D-11/D-12/D-7/D-8 JSDoc deviations cited against Blender. LOW: G-1 dep-array narrowing, G-2 TimelineEditor handler consistency, G-6/G-7/G-8 text rename sweep, G-9 sceneAction orphan-id `logger.error`, D-9 plural-id deviation doc, D-10 omitted-fields scope clarification. |

## What was the gap

Stage 1.A+1.B (commits `229305a` substrate + `3339257` audit-fix)
shipped the v36 `Action` datablock + per-Object `node.animData`. Stage
1.C (commits `d298bf5` + `aed272e`) shipped the `actionRegistry`
lifecycle helpers. Stage 1.D (commits `220655e` + `0174eaf`) shipped
the `__scene__` pseudo-Object node (v37) + `sceneAction.js` selectors
(`getSceneNode` / `getSceneAction` / `getActiveSceneAction`).

But the editor still spoke the pre-Stage-1.D vocabulary. Eleven files
read `useAnimationStore.activeActionId` directly and looked actions
up via `proj.actions.find(a => a.id === activeActionId)` — by-passing
the scene binding entirely. The `AnimationsEditor.jsx` panel name
mismatched Blender's "Action" datablock terminology. There was no
Properties surface for per-Object Action binding (the plan's "drag an
action into an Object's AnimData slot in the Properties panel" was
unimplemented). `cloneAction` / `assignAction` / `unassignAction`
thunks (Stage 1.C) had no UI callers (Rule №2 anti-pattern queued from
Stage 1.C audit-fix G-2).

Plan §1.E calls for the UI rename + ActionsEditor enhancements; plan
§1.C "Stage 1.E entry gate" (extended in Stage 1.D audit-fix D-9)
enumerates the full 11-file consumer rewire: TimelineEditor (12 hits),
DopesheetEditor (3), FCurveEditor (3), ParamRow (1), NodeTreeArea (4),
ExportModal (6), CanvasViewport (4), GizmoOverlay (1), SkeletonOverlay
(1), `exportAnimation.resolveActions` (left as a pure helper — caller
pre-resolves the active id).

## The conversion

### Substrate (`4d3892a`)

- File rename: `editors/animations/AnimationsEditor.jsx` →
  `editors/actions/ActionsEditor.jsx` (and `IdleMotionDialog.jsx`
  moved with it). Function `AnimationsEditor` → `ActionsEditor`.
- Editor registry rename: `'animations'` → `'actions'` editor type;
  label "Animations" → "Actions"; `uiV3Store.EditorType` enum + the
  animation workspace's `rightBottom` area's tab list both updated.
- 11 consumer files rewired: every `proj.actions.find(a => a.id ===
  activeActionId)` becomes `getActiveSceneAction(project, activeActionId)`
  (or `getSceneAction(project)` for scene-only reads in TimelineEditor's
  picker scene-rebind logic). useMemo deps narrowed to
  `[project.nodes, project.actions, fallback]` (the two slices the
  helper actually reads).
- ActionsEditor (Stage 1.E surface):
  - Scene-action header (top): one-row affordance for binding any
    action to `__scene__` via `assignAction('__scene__', id, 0)` /
    unbinding via `unassignAction('__scene__')`. Hidden when no scene
    node exists (defensive). Surfaces `getSceneAction(project)` as the
    bound-action label.
  - Per-action Used-by strip: `getActionUsers(project, action.id)`
    returns the Object/Scene list; `formatUsedBy` renders `__scene__`
    as "Scene" first.
  - Duplicate command (per-row Copy icon): wires
    `useProjectStore.cloneAction` thunk; clones land at end of list
    and become active.
  - Header label "Actions (N)" replaces "Animations (N)".
  - Inline-rename + delete dialog kept; delete-cascade notification
    added in audit-fix sweep (G-3).
- New Properties `'animData'` section (`AnimDataSection.jsx`):
  Visible for parts + groups (matches Stage 1.A
  `objectDataAccess.isObject(node)` semantic). Surfaces
  `node.animData.actionId` as a select dropdown; assign / unassign
  via Stage 1.C `assignAction` / `unassignAction` thunks. Read-only
  "FCurves: N" derived display when an action is bound. Scene
  binding stays in ActionsEditor (Stage 1.D Audit-fix G-16: scene
  isn't a `SelectableType`).
- TimelineEditor picker shows `animation?.id` (resolved scene-aware).
  When user picks a different action AND scene is bound, also re-binds
  scene to the new id so the resolution gate doesn't silently snap the
  picker back. Auto-select effect skips when `animation` is non-null
  (avoids writing UI store when scene already resolves).
- `useAudioSync` dep flipped from `animStore.activeActionId` to
  `animation?.id` so audio restarts cleanly when scene-binding flips
  the resolved action without UI-store touching.

Tests: `test_stage1e_actions_editor.mjs` (56 assertions): file
rename, registry/type rename, per-consumer rewire grep, AnimDataSection
registration + visibility predicate, ActionsEditor scene-header /
cloneAction / Used-by / scene-label-shim, Timeline picker scene-rebind.
`test_uiV3Store.mjs` animation workspace `rightBottom` assertion
updated `'animations'` → `'actions'`. Wired into `npm test` chain.

### Same-day dual audit

Per the **established pattern** (memory:
`feedback_dual_audit_after_phase_ship.md`), two parallel
`general-purpose` agents ran against `4d3892a`:

1. **Architecture audit** — surfaced 12 gaps (G-1..G-12 — 0 HIGH,
   2 MED, 10 LOW)
2. **Blender-fidelity audit** — surfaced 12 gaps (D-1..D-12 — 4 HIGH,
   4 MED, 4 LOW)

After cross-audit dedup (G-12 = no action; G-11 noted as pre-existing
pattern), 24 unique gaps total: **4 HIGH + 8 MED + 12 LOW**. Heavy
Blender-fidelity load this round — the audit caught a section-label
mismatch ("Animation Data" → "Animation"), a default-collapsed-state
oversight, a `.001`-vs-` Copy` clone-naming convention deviation, and
a placement question (Item tab vs Data tab) that surfaced a deeper
infra gap (SS Data tab is parts-only).

The most consequential MED finding (G-10) was a thunk-vs-registry
return-shape regression: the `cloneAction` thunk discarded the registry's
full-object return shape (Stage 1.C Audit-fix G-5 explicitly lifted the
return shape from id → object precisely to spare callers a re-find scan)
and returned just the id. The audit caught it; fixed in the same sweep.

### Audit-fix sweep (`45371d5`)

All HIGH addressed in CODE (not deferred); D-1 specifically gets a
documented Stage 1.F + Phase 2 entry-gate deferral pending dedicated
"Animation" Properties tab. (D-1 RE-RESOLVED 2026-05-12 — the
deferral premise was a misread of Blender; Item-tab placement IS
the Blender mirror via `OBJECT_PT_animation`. See
[SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md).)
All MED addressed in code or doc; LOW addressed via doc / cosmetic /
loud-defensive refactor.

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| D-1 | HIGH→MED | Blender-fidelity | (Originally: `animData` section in Item tab vs Blender Data tab. Doc the deviation; queue dedicated Animation tab for Stage 1.F + Phase 2 entry-gate.) **RE-RESOLVED 2026-05-12** — the deferral premise was a misread; Blender's Animation panel registers per-datablock-type via `OBJECT_PT_animation` / `DATA_PT_*_animation` / `MATERIAL_PT_animation` / etc. on different tabs, with no dedicated Animation tab. Item-tab placement IS the Blender mirror via `OBJECT_PT_animation` (`properties_object.py:618`, `bl_context = "object"`). See [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md). |
| D-2 | HIGH | Blender-fidelity | Section label "Animation Data" → "Animation" (mirrors Blender `bl_label = "Animation"` on `PropertiesAnimationMixin` at `space_properties.py:135`). Mechanical change in `AnimDataSection.jsx` + `sectionRegistry.jsx`. |
| D-3 | HIGH | Blender-fidelity | `'animData'` added to `editorStore.propertiesSectionsCollapsed` initial Set — matches Blender `bl_options = {'DEFAULT_CLOSED'}` (`space_properties.py:136`). Per-Object bindings rarely change post-import; collapsed-by-default keeps Item tab compact. |
| D-4 | HIGH | Blender-fidelity | `animData` LAST in Item tab `sectionIds` (matches Blender `bl_order = PropertyPanel.bl_order - 1` "just above Custom Properties"). |
| G-3 | MED | Architecture | `confirmDelete` now toasts "Unbound from: …" post-delete + AlertDialog "Currently bound to: …" pre-delete (using `getActionUsers` snapshot). No more silent scene-binding cascade on action delete. |
| G-10 | MED | Architecture | `projectStore.cloneAction` thunk returns FULL cloned action object (mirrors Stage 1.C Audit-fix G-5). Re-resolves post-finalised entry from `get().project.actions` so the returned ref is NOT the immer draft (which is revoked after `produce()`). |
| D-5 | MED | Blender-fidelity | ActionsEditor module JSDoc documents per-row Copy button as discoverability extension over Blender's `(N)` user-count pip on `template_id` (`interface_template_id.cc:1284`). Per Blender, `ACTION_OT_duplicate` (`action_edit.cc:1097`) duplicates KEYFRAMES not the Action ID. |
| D-6 | MED | Blender-fidelity | Clone names use Blender's `.001` convention via new `nextDotNNNName(actions, base)` helper in `actionRegistry.js`. Mirrors `BKE_main_namemap_get_unique_name` (`main_namemap.cc:450`). Replaces ` Copy` suffix. |
| D-7 | MED | Blender-fidelity | TimelineEditor picker rebind documented as Blender-faithful to `template_action(animated_id, ...)` writing to its pinned datablock (`space_dopesheet.py:313`). Audit conflated with auto-broadcast `ANIM_OT_replace_action` op (`anim_ops.cc:1389`); kept as-is, doc clarifies. |
| D-8 | MED | Blender-fidelity | `getActiveSceneAction` JSDoc warns scene-wins composition is UI-bridging convenience, NOT runtime parity claim. Blender runs each datablock's adt independently (`BKE_animdata_from_id(&scene->id)` AND `BKE_animdata_from_id(&object->id)` both fire). Phase 2+ per-Object adt consumers MUST NOT route through this. |
| D-11 | MED | Blender-fidelity | ActionsEditor module JSDoc clarifies Used-by strip is EXTENSION of Blender's `(N)` pip pattern, not a mirror. |
| D-12 | MED | Blender-fidelity | ActionsEditor module JSDoc documents scene-action header as SS-specific because SS lacks Scene tab in Properties. Blender's parallel: `SCENE_PT_animation` (`properties_scene.py:452`). |
| G-1 | LOW | Architecture | ExportModal `activeActionId` useMemo dep narrowed `[project, ...]` → `[project.nodes, project.actions, ...]`. Matches canonical pattern. |
| G-2 | LOW | Architecture | TimelineEditor `End`/`FPS` field handlers normalised: `p.actions.find(x => x.id === animation.id)` → `getActiveSceneAction(p, anim.activeActionId)`. Every immer mutation handler now follows the same pattern. |
| G-6 | LOW | Architecture | HelpModal animation workspace blurb: "Animations list" → "Actions panel". |
| G-7 | LOW | Architecture | `actionRegistry.deleteAction` docstring: "Animations" panel reference → "Actions"; legacy `proj.actions.find(...)` lookup pattern updated to `getActiveSceneAction(...)`. |
| G-8 | LOW | Architecture | ExportModal empty-state copy updated. |
| G-9 | LOW | Architecture | `getSceneAction` orphan-id case (scene's `actionId` doesn't resolve) emits `logger.error(...)` instead of silently swallowing. `deleteAction` cascade should prevent orphans; loud-error so the next bug-author finds the cascade gap fast. |
| D-9 | LOW | Blender-fidelity | editorRegistry `'actions'` plural id documented as panel-scoped deviation from Blender's `SPACE_ACTION` singular space-type enum (`DNA_space_enums.h:1161`). |
| D-10 | LOW | Blender-fidelity | AnimDataSection JSDoc cites `draw_action_and_slot_selector_for_id` (`scripts/startup/bl_ui/anim.py:8`) — omission of `actionInfluence`/`actionBlendmode`/`actionExtendmode` IS Blender-faithful (those live in NLA Editor, not the per-datablock Animation panel; reserved for Phase 4). |

Audit reports: substrate audit conducted via parallel `general-purpose`
agents in this sub-session (no separate `AUDIT_2026_05_11_PHASE1_STAGE1E_*.md`
disk artefacts — the close-out's Stage 1.E audit-status table IS the
canonical audit record).

## Test scoreboard

All Phase 1 Stage 1.E-touched suites green.

| Suite | Assertions |
|-------|------------|
| `test_stage1e_actions_editor` (NEW substrate `4d3892a`) | 56 |
| `test_audit_fixes_2026_05_11_phase1_stage1e` (NEW audit-fix `45371d5`, 24 gap blocks + functional integrations) | 39 |
| `test_actionRegistry` (existing 95; one assertion updated for `.001` naming) | 95 |
| `test_sceneAction` (no churn — orphan-test now produces logger.error stdout, return value unchanged) | 25 |
| `test_uiV3Store` (workspace area assertion update for `'actions'`) | 59 |
| `test_migration_v37` (no churn) | 57 |
| `test_migrations` (no churn) | 138 |
| `test_exportAnimation` (no churn — `resolveActions` stays pure) | 35 |
| `test_propertiesSectionRegistry` (no churn — new section auto-counted by registry walk) | 19 |
| `test_animationStore` (no churn) | 55 |
| `test_idleDialogWiring` (no churn) | 7 |
| `test_projectRoundTrip` (no churn) | 41 |
| `test_outlinerTreeBuilder` (no churn) | 109 |
| `test_editorStore` (no churn — `propertiesSectionsCollapsed` initial seed adds `'animData'` but no test asserted emptiness) | 87 |
| `test_transforms` (no churn) | 34 |
| `test_saveLoadRigSpec` (no churn) | 19 |
| `test_depgraphBuild` (no churn) | 37 |
| `test_e2e` (no churn) | 27 |
| `test_rigSpec` (no churn) | 25 |
| `test_modifierStacks` (no churn) | 34 |
| `test_selectRigSpec` (no churn) | 64 |
| `test_auditFixes20260511Phase1Stage1d` (no churn — Stage 1.D pin still green) | 81 |
| Plus all 188+ prior-day suites | (existing — passes) |

Typecheck clean. Note: full `npm test` chain still hits Windows'
8191-char command-length limit on this build and bails before the
final tail; individual suite runs verify the touched + adjacent
suites are green.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (48 from earlier 2026-05-11 close-outs through `d3516b2`) | Phases 0–7.D + Phase 1 Stages 1.A/1.B/1.C/1.D ship + 14 audit-fix sweeps + 9 close-out docs |
| 49    | `4d3892a` | feat(anim): Phase 1 Stage 1.E — ActionsEditor + activeActionId rewire |
| 50    | `45371d5` | fix(audit): Phase 1 Stage 1.E audit-fix sweep — 4 HIGH + 8 MED + 12 LOW |
| 51    | (next)    | docs(plan): Stage 1.E close-out doc (this file) |

## Schemas after Phase 1 Stage 1.E

`CURRENT_SCHEMA_VERSION = 37` (unchanged from Stage 1.D; Stage 1.E is
substrate + UI only, no migration).

## Hotkey reservations

Stage 1.E added no new hotkeys. The Phase 6 `I` reservation (Insert
Keyframe) remains queued.

## Resume paths for fresh session

Pick one (or several — they're largely independent):

### A. NodeTree retirement (recommended next — parallel work-thread, decoupled from Stage 1.F/G)

Per plan §Phase 1 (lines ~419-578) + the `MEMORY.md` "Stage 1.E/NodeTree
retirement queued" pointer:

- Delete `project.nodeTrees.{rig,driver,animation}` entirely.
- Refactor [src/v3/editors/nodetree/NodeTreeArea.jsx](../../src/v3/editors/nodetree/NodeTreeArea.jsx)
  to render `selectRigSpec(project)` directly (read-only, no datablock).
- Drop v22 + v23 + v24 migrations
  ([src/store/migrations/v22_*.js](../../src/store/migrations/),
  [v23_*.js](../../src/store/migrations/),
  [v24_*.js](../../src/store/migrations/)).
- Drop the v24-shadow branch in `FCurveStrip` node-type executor (v36
  added this for backward compat; once NodeTrees retire, the post-v36
  `compileAnimationTree(action)` becomes the sole compile path).
- Update `NodeTreeArea` mode pill: `'animation'` label kept legacy;
  Stage 1.E audit-fix G-5 noted this lags the rename intentionally
  because the underlying tree datablock is still `animation`-named.
  Once retired, the mode pill goes away too.

### B. Stage 1.F + 1.G — Phase 1 exit gate

Per plan §1.F + 1.G (lines 637-651):

- 5 new test suites:
  - `test_actionDatablock_migration.mjs` — v32→v33 round-trip
  - `test_actionRegistry.mjs` — already shipped (95 assertions Stage 1.C+1.D)
  - `test_actionScene.mjs` — depends on Stage 1.D scene + Stage 1.E
    consumers; treats `__scene__` AnimData identically to Object
    AnimData via the rewired exporter
  - `test_actionExportMotion3.mjs` — each Action exports to one
    motion3.json (current path via `resolveActions`)
  - `test_actionExportCan3.mjs` — each Action exports to one .can3
- Manual Cubism Viewer .moc3 byte-identity gate on Hiyori with one
  keyframed Action (the user-gesture test that closes Phase 1).

Required to declare Phase 1 fully shipped. NodeTree retirement should
land first to keep the v24-shadow path out of the new test suites.

### C. ~~Properties dedicated "Animation" tab~~ — RE-RESOLVED 2026-05-12 (no follow-up needed)

This Resume path's premise was a misread of Blender.
`PropertiesAnimationMixin.bl_context = "data"` is the mixin's
*default* — every concrete subclass overrides it via its ButtonsPanel
base. `OBJECT_PT_animation`
(`reference/blender/scripts/startup/bl_ui/properties_object.py:618`)
inherits `ObjectButtonsPanel.bl_context = "object"` and registers the
Object-datablock's Animation panel on the **Object** tab — same role
as SS's Item tab. SS's existing Item-tab placement IS the Blender-
faithful mirror; the dedicated-Animation-tab plan would have been
SS-invented (Blender has no dedicated Animation tab in its Properties
navigation). See
[SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md).

The original (now-rejected) plan called for adding a peer `'animation'`
Properties tab and moving `animData` out of Item tab. **Do not do
this** — the dedicated-tab framing is the SS-invented pattern that the
RE-RESOLUTION rejects.

### Recommended order

A → B. NodeTree retirement is the smallest decoupled chunk and
clears the v24-shadow code path that Phase 1's exit-gate test suites
would otherwise need to assert against. Stage 1.F/1.G is the closing
gate. (C is RE-RESOLVED — no follow-up needed.)

## Cross-references

- Animation plan: [docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md) §Phase 1.E (lines 626-680) + §1.C entry-gate (lines 541-557)
- Stage 1.D close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md)
- Stage 1.C close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md)
- Stage 1.A+1.B close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md)
- Phase 7.D close-out (full toolset day-end): [SESSION_CLOSEOUT_2026_05_11_PHASE7D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7D.md)
- Memory: dual-audit-after-every-phase-ship pattern
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
- Memory: in-flight plans pointer
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_blender_parity_plans_in_flight.md`)
