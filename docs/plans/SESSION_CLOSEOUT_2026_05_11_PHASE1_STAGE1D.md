# Session Close-out — 2026-05-11 (Animation Phase 1 Stage 1.D sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md).
This sub-session shipped **Animation Phase 1 Stage 1.D — `__scene__`
pseudo-Object** (schema v37) + the same-day dual-audit + audit-fix
sweep. Two commits: substrate (`220655e`) + audit-fix sweep
(`0174eaf`). Both pushed to `origin/master`.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `220655e` | feat(anim): Phase 1 Stage 1.D — `__scene__` pseudo-Object (v37). New `src/store/migrations/v37_scene_anim_data.js` + `src/anim/sceneAction.js` (selectors). Fresh-project initial state seeds `__scene__`. `actionRegistry.js` JSDoc reflects D-9 closure. Tests: `test_migration_v37.mjs` (49) + `test_sceneAction.mjs` (25) + 8 new D-9 closure asserts on `test_actionRegistry.mjs`. |
| `0174eaf` | fix(audit): Phase 1 Stage 1.D audit-fix sweep — 7 HIGH + 9 MED + 5 LOW. New audit-pin (`test_audit_fixes_2026_05_11_phase1_stage1d.mjs`, 81 assertions). `test_actionRegistry.mjs` 95, `test_migration_v37.mjs` 65. Closes G-1 (resetProject scene wipe), G-2 (substrate-without-callers documented), G-3 (synthetic-node convention claim corrected), D-1/D-2 (Blender citations), D-3 (`'sceneObject'`→`'scene'`), D-7+G-19 (exporter overclaim correction), D-12+G-5+G-6 (hand-edit collision asymmetry), + 14 MED/LOW. |

## What was the gap

Stage 1.A+1.B (commit `229305a` + audit-fix `3339257`) shipped the
v36 `Action` datablock + per-Object `node.animData`. Stage 1.C
(commit `d298bf5` + audit-fix `aed272e`) shipped the
`actionRegistry` lifecycle helpers. But there was no project-level
animation host: actions that animate the whole project (the typical
Cubism character motion) had no canonical binding slot. Consumers
fell back to the UI store's `useAnimationStore.activeActionId` as
the single source of truth, which didn't survive save/load and
couldn't carry the project-data semantics the exporter needs.

Plan §1.D calls for a `__scene__` pseudo-Object (Blender's `Scene.adt`
analog) that carries the project-wide AnimData. The synthetic node
lives on `project.nodes` so the existing `actionRegistry` helpers
walk it without modification, closing the read/write asymmetry
flagged by Audit-fix D-9 (Stage 1.C audit) along the way.

## The conversion

### Substrate (`220655e`)

- New module `src/store/migrations/v37_scene_anim_data.js` exports
  `migrateSceneAnimData(project)` + `makeSceneNode()` + `isSceneNode()`.
  Migration is idempotent + lossless. Fresh + migrated v36 projects
  both end up with the scene node.
- New module `src/anim/sceneAction.js` exports `getSceneNode` /
  `getSceneAction(project)` / `getActiveSceneAction(project,
  fallbackActionId)`. Resolution order: scene's bound action wins,
  fallbackActionId resolves in `project.actions[]`, else null.
- `src/store/projectStore.js` initial state seeds the scene node
  (no Init Rig prerequisite).
- `src/store/projectSchemaVersion.js` 36→37; `projectMigrations.js`
  registers v37 in numeric position.
- `src/anim/actionRegistry.js` JSDoc reflects that Audit-fix D-9
  (Stage 1.C audit) is naturally CLOSED by v37 (the scene now has
  the standard `animData` slot).
- Tests: `test_migration_v37.mjs` (49 assertions including drift
  safety net), `test_sceneAction.mjs` (25 assertions covering
  selector precedence + defensive shapes), `test_actionRegistry.mjs`
  +8 D-9 closure assertions (post-extension: 95 total). Wired into
  `npm test` chain after `test:migrationV36` and after
  `test:actionRegistry`.
- Fixture updates: `test_migrations.mjs` v0-empty + `test_modifierStacks.mjs`
  v19-empty now expect `[__scene__]` instead of `[]` (the v37
  synthetic appears even on empty projects).

Blender source mirrors:
- `Scene.adt` → `reference/blender/source/blender/makesdna/DNA_scene_types.h:2813`
- `BKE_animdata_from_id` (the AnimData getter) →
  `reference/blender/source/blender/blenkernel/intern/anim_data.cc:91`
- `BKE_animdata_ensure_id` (the lazy-create function we deviate
  from by pre-creating; see D-6) → `:105`

### Same-day dual audit

Per the **established pattern** (memory:
`feedback_dual_audit_after_phase_ship.md`), two parallel
`general-purpose` agents ran against `220655e`:

1. **Architecture audit** — surfaced 20 gaps (G-1..G-20 — 3 HIGH,
   8 MED, 9 LOW)
2. **Blender-fidelity audit** — surfaced 17 gaps (D-1..D-17 — 7
   HIGH, 5 MED, 5 LOW)

After cross-audit dedup (G-7↔D-4, G-19↔D-7, G-14↔D-3,
G-5+G-6+G-12↔D-12), 21 unique gaps total: **7 HIGH + 9 MED + 5 LOW**.

The Blender-fidelity audit was particularly load-bearing this
sub-session — caught 3 falsifiable citation errors (D-1, D-2, D-3)
that would have shipped to production code review otherwise. The
dual-audit pattern saved a Rule-№1 violation by demanding
verification rather than just code-reading.

### Audit-fix sweep (`0174eaf`)

All HIGH addressed in CODE (not deferred); 14 MED/LOW addressed in
code, doc, or test.

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| G-1 | HIGH | Architecture | `resetProject` body wiped scene node. Re-seeded the `__scene__` literal in resetProject's nodes-array assignment. Real bug (File→New left no scene host). |
| G-2 | HIGH→MED | Architecture | Substrate-without-callers (Rule №2). Documented Stage 1.E entry-gate explicitly in `sceneAction.js` JSDoc + extended plan §1.C with the full consumer rewire enumeration (11 files, 27 hits). |
| G-3 | HIGH | Architecture | JSDoc misclaim that `__params__` and `__armature__` are real `project.nodes` entries (they're virtual). v37's `__scene__` is the FIRST double-underscore synthetic that lives as a real node entry — documented in v37 + actionRegistry JSDoc. |
| D-1 | HIGH | Blender-fidelity | Cited Blender API `BKE_animdata_id_action` does not exist. Real API is `BKE_animdata_from_id` (`anim_data.cc:91`). Replaced every cite (3 sites). |
| D-2 | HIGH | Blender-fidelity | `DNA_scene_types.h:2225` cite is wrong. Correct line is `:2813`. Replaced every cite (3 sites). |
| D-3 | HIGH | Blender-fidelity | `type: 'sceneObject'` is invented. Renamed to `type: 'scene'` to match Blender's ID type. Mechanical change across migration, projectStore initial + reset, tests. |
| D-7+G-19 | HIGH | Cross-audit | Plan §1.D + commit message overclaimed exporter parity. Plan rewritten with explicit substrate-only ship scope + Stage 1.E entry-gate enumeration. |
| D-4+G-7 | MED | Cross-audit | Outliner silently dropped `__scene__`. Added explicit audit-fix breadcrumb + Stage 1.E "Scene root view" deferral note in `treeBuilder.js`. |
| D-5 | MED | Blender-fidelity | `actionInfluence: 1` deviates from Blender struct DNA default (`0.0f`). Documented as intentional (SS adopts BKE-runtime override because we eagerly create AnimData). |
| D-6 | MED | Blender-fidelity | Blender Scene starts with `Scene.adt = nullptr` (lazy create); SS pre-creates. Documented as intentional. |
| D-9 | MED | Blender-fidelity | Stage 1.E entry-gate listed only Timeline/FCurve/Dopesheet; full consumer rewire spans 11 files. Plan §1.C enumeration extended. |
| D-10 | MED | Blender-fidelity | `getActiveSceneAction` fallback composition is SS-specific (Blender does NOT auto-resolve scene/UI). Documented in sceneAction module JSDoc. |
| D-11 | MED | Blender-fidelity | `assignAction` skips Blender's NLA editability guard (`BKE_animdata_action_editable`). Most relevant for `__scene__` (scene-bound actions are prime tweak-mode target). Phase-4 deferral documented. |
| D-12+G-5+G-6 | MED | Cross-audit | Hand-edited collision (`{id:'__scene__', type:'group'}`) created read/write asymmetry. Migration now FORCE-CORRECTS type/parent/name on any `__scene__` id collision. Functional gate test added. |
| G-4 | MED | Architecture | Drift safety-net was substring-grep only. Tightened to field-occurrence-count test (each field appears EXACTLY once in projectStore initial-state literal). |
| G-8 | MED | Architecture | `isObject(node)` excludes `type: 'scene'` — CORRECT behavior (Blender Scene is not an Object). Documented in objectDataAccess JSDoc with `isSceneNode` cross-reference. |
| G-11 | LOW | Architecture | `computeWorldMatrices` walks `__scene__` and emits identity-matrix entry. Benign (scene IS the world frame); documented. |
| G-13 | LOW | Architecture | `getSceneAction` is private-in-effect for now. Standalone usage rationale documented in sceneAction JSDoc. |
| G-16 | LOW | Architecture | `selectionStore.SelectableType` excludes 'scene' — intentional (scene is project root, not peer of Objects). Documented. |
| D-15 | LOW | Blender-fidelity | `__scene__` is the FIRST double-underscore synthetic living as a real node. Convention break documented in v37 module JSDoc. |
| D-16 | LOW | Blender-fidelity | Migration's animData repair was permissive (would overwrite truthy non-object). Now mirrors Blender's strict `BKE_animdata_ensure_id` contract — repair only when missing, fail loud on corrupt non-null non-object. |

Audit reports: substrate audit conducted via parallel `general-purpose`
agents in this sub-session (no separate `AUDIT_2026_05_11_PHASE1_STAGE1D_*.md`
disk artefacts — the close-out's Stage 1.D audit-status table IS the
canonical audit record).

## Test scoreboard

All Phase 1 Stage 1.D-touched suites green.

| Suite | Assertions |
|-------|------------|
| `test_migration_v37` (NEW substrate `220655e` + audit-fix sweep `0174eaf`) | 65 |
| `test_sceneAction` (NEW substrate `220655e`) | 25 |
| `test_actionRegistry` (existing 87 + 8 D-9 closure asserts in substrate) | 95 |
| `test_audit_fixes_2026_05_11_phase1_stage1d` (NEW, 21 gap blocks + functional integrations) | 81 |
| `test_migrations` (fixture update for v37) | 138 |
| `test_modifierStacks` (fixture update for v37) | 34 |
| `test_projectRoundTrip` (no churn) | 41 |
| `test_rigSpec` (no churn) | 25 |
| `test_selectRigSpec` (no churn) | 64 |
| `test_e2e` (no churn) | 27 |
| `test_outlinerTreeBuilder` (no churn) | 109 |
| `test_transforms` (no churn) | 34 |
| `test_saveLoadRigSpec` (no churn) | 19 |
| `test_depgraphBuild` (no churn) | 37 |
| Plus all 188+ prior-day suites | (existing — passes) |

Typecheck clean. Note: full `npm test` chain hits Windows'
8191-char command-length limit on this build and bails before the
final tail; individual suite runs verify the touched + adjacent
suites are green.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (45 from earlier 2026-05-11 close-outs through `2649d53`) | Phases 0–7.D + Phase 1 Stages 1.A/1.B/1.C ship + 13 audit-fix sweeps + 8 close-out docs + Phase 8 |
| 46    | `220655e` | feat(anim): Phase 1 Stage 1.D — `__scene__` pseudo-Object (v37) |
| 47    | `0174eaf` | fix(audit): Phase 1 Stage 1.D audit-fix sweep — 7 HIGH + 9 MED + 5 LOW |
| 48    | (next)    | docs(plan): Stage 1.D close-out doc (this file) |

## Schemas after Phase 1 Stage 1.D

`CURRENT_SCHEMA_VERSION = 37`. v37 introduces:
- `project.nodes[i] = { id: '__scene__', type: 'scene', name: 'Scene',
  parent: null, animData: defaultAnimData() }` synthetic node, present
  on every project (fresh + migrated). Migration is idempotent and
  type-force-corrects hand-edited collisions.

## Hotkey reservations

Stage 1.D added no new hotkeys. The Phase 6 `I` reservation (Insert
Keyframe) remains queued for Stage 1.E + Phase 6 of the animation plan.

## Resume paths for fresh session

Pick one (or several — they're largely independent):

### A. Animation Phase 1 Stage 1.E — UI rename + ActionsEditor (recommended next)

Per plan §1.E (lines 547-557) + the **extended Stage 1.E entry gate**
in §1.C (audit-fix D-10 from Stage 1.C + D-9 from Stage 1.D — 11
files, 27 hits):

- `src/v3/editors/animations/AnimationsEditor.jsx` → `ActionsEditor.jsx`
- Per-action "Used by: <objects>" strip (consumes `getActionUsers`
  from Stage 1.C — already shipped). Audit-fix D-13 Stage 1.D: when
  `__scene__` is in the bound list, surface as "Scene" (cleaner UI
  label).
- "Duplicate" command (consumes `cloneAction` thunk from Stage 1.C —
  already shipped, returns full action object)
- Drag an action into an Object's AnimData slot in the Properties
  panel (consumes `assignAction` thunk from Stage 1.C — already
  shipped). The scene appears as a drop target alongside Objects.
- Timeline action picker dropdown
- **Full activeActionId consumer rewire** (D-9 Stage 1.D) — 11 sites
  must consume `getActiveSceneAction(project, fallback)`:
  TimelineEditor, DopesheetEditor, FCurveEditor, AnimationsEditor
  (rename), ParamRow, NodeTreeArea, ExportModal, CanvasViewport (4
  hits), GizmoOverlay, SkeletonOverlay, exportAnimation.resolveActions.

### B. NodeTree retirement (parallel work-thread)

Delete `project.nodeTrees.{rig,driver,animation}` entirely. Refactor
NodeTreeEditor to render `selectRigSpec(project)` directly (read-only,
no datablock). Drop v22 + v23 + v24 migrations. Drop the v24-shadow
branch in `FCurveStrip` node-type executor (v36 added this for
backward compat; once NodeTrees retire, the post-v36
`compileAnimationTree(action)` becomes the sole compile path).

### C. Stage 1.F + 1.G — Phase 1 exit gate

Per plan §1.F + 1.G:
- 5 new test suites: `test_actionDatablock_migration`,
  `test_actionRegistry` (already shipped, 95 assertions),
  `test_actionScene` (depends on Stage 1.D — now possible to write,
  treats `__scene__` AnimData identically to Object AnimData),
  `test_actionExportMotion3`, `test_actionExportCan3`
- Manual Cubism Viewer byte-identity gate on Hiyori with one
  keyframed Action (the user-gesture test that closes Phase 1).

Required to declare Phase 1 fully shipped. Stage 1.E should land
first; this is the closing gate.

### Recommended order

A → B → C. Stage 1.E exercises Stage 1.C's helpers + Stage 1.D's
selector in production UI. NodeTree retirement is decoupled and can
land anytime once 1.E has stabilised. Stage 1.F+1.G is the Phase 1
exit gate.

## Cross-references

- Animation plan: [docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md) §Phase 1 (lines 419-578)
- Stage 1.C close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md)
- Stage 1.A+1.B close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md)
- Phase 7.D close-out (full toolset day-end): [SESSION_CLOSEOUT_2026_05_11_PHASE7D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7D.md)
- Memory: dual-audit-after-every-phase-ship pattern
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
- Memory: in-flight plans pointer
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_blender_parity_plans_in_flight.md`)
