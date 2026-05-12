# Session Close-out — 2026-05-11 (Animation Phase 1 Stage 1.F-pre sub-session — NodeTree retirement)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md).
This sub-session shipped **Animation Phase 1 Stage 1.F (pre-exit) —
NodeTree retirement (schema v38)**: deletion of `project.nodeTrees.{rig,
driver, animation}` (the V2 dual-write shadow), on-the-fly derive in
`NodeTreeArea`, retirement of v22/v23/v24 migrations to no-op shims,
deletion of `FCurveStrip`'s legacy `storage.track` shadow branch, plus
the same-day dual audit + audit-fix sweep that cleaned up the residue
the initial pass left behind. Two commits: substrate (`ba20ef7`) +
audit-fix sweep (`7c023b3`). Both pushed to `origin/master`.

## What shipped this sub-session

| Commit  | What |
|---------|------|
| `ba20ef7` | feat(anim): Phase 1 Stage 1.F (pre-exit) — NodeTree retirement (schema v38). `migrations/v38_nodetree_retirement.js` idempotently deletes `project.nodeTrees` from old saves. v22/v23/v24 entries become no-op shims; their migration MODULES deleted from disk. `NodeTreeArea` refactored to derive trees on-the-fly per mode via `buildRigTreeForPart(part)` / `compileDriverTree(paramId, driver)` / `compileAnimationTree(action)`. Side-effect imports for node-type label registration moved from v23/v24 migrations to `NodeTreeArea.jsx`. `FCurveStrip` executor's legacy `storage.track` shadow branch deleted. `animationCompile.js` JSDoc updated: post-v38 SOLE compile path. Three migration-coverage test files (`test_nodetree_migration.mjs`, `test_driverTree_migration.mjs`, `test_animationTree_migration.mjs`) deleted; replaced with leaner `test_animationTree_compile.mjs` (15 assertions). Audit-pin `test_nodetree_retirement.mjs` (41 assertions). |
| `7c023b3` | fix(audit): Phase 1 Stage 1.F-pre — NodeTree retirement audit-fix sweep (1 HIGH dedup'd + 5 MED + 5 LOW). HIGH: G-1+G-2+D-1 dead-write helpers (`buildRigTreesForProject`, `buildNodeTreesFromProject`, `evalAllRigTrees`) deleted — they were the actual production reads/writes of `project.nodeTrees` that the substrate commit left behind. MED: G-3 dead `s.track` branch in NodeTreeEditor.nodeSubtitle removed; G-4 audit-pin extended to repo-wide src/ grep (v38 retirement exempt); D-3 build.js JSDoc reframed to declare modifier stack permanently canonical; D-4 animationCompile.js NLA Phase 4 TODO marker added. LOW: D-2/D-6/D-7/D-8/D-9 deviation doc notes; G-5 redundant `driverIds` dep dropped from tree useMemo. Audit-pin extended 41 → 68 assertions. |

## What was the gap

The Stage 1.E close-out (commit `098421b`) queued NodeTree retirement
as **Resume path A** — the recommended next chunk before the Phase 1
exit gate (Stage 1.F + 1.G test suites + Cubism Viewer byte-identity
gate on Hiyori). Per plan §Phase 1 line 493: "`project.nodeTrees.{rig,
driver, animation}` is deleted (audit-driven: NodeTrees retired here,
not deferred to Phase 8). The NodeTreeEditor is refactored to render
`selectRigSpec(project)` directly — read-only, no datablock."

The V2 NodeTree datablocks were a Phase V2 architectural bet that the
future was a node-graph dataflow (sister to Blender's `bNodeTree`).
Per plan §9.E (lines 1642-1653) the bet didn't pay off — the data
the trees manifested was already implicit in `selectRigSpec` (rig
structure), `param.driver` (drivers), and `action.fcurves[]` (animation),
so there's no information loss. The trees were dual-write shadow that
nothing read except the read-only NodeTreeEditor panel.

Three migrations (`v22_nodetree_rigtree.js`, `v23_nodetree_drivertree.js`,
`v24_nodetree_animationtree.js`) populated the shadow at load; v36's
NodeTree-retirement-deferral comment ("retirement is a separate
follow-up commit") finally got executed here. The retirement closes
the V2 lineage and unblocks the Phase 1 exit gate's clean test
matrix (Stage 1.F+1.G wouldn't need to assert against the v24-shadow
code path).

## The conversion

### Substrate (`ba20ef7`)

- **Schema v38**: `migrations/v38_nodetree_retirement.js` —
  idempotent `delete project.nodeTrees`. Schema bumped 37 → 38 in
  `projectSchemaVersion.js`.
- **v22/v23/v24 retirement**: migration MODULES deleted from disk;
  entries in `projectMigrations.js` become `N: (project) => project,`
  no-op shims (the walker requires contiguous version numbers — sister
  to v30/v31 retirement pattern).
- **`NodeTreeArea.jsx` refactor**: drops `project.nodeTrees` reads
  entirely. Each mode derives its tree on-the-fly:
  - `rig`: `selectionHead && project.nodes.find(part)` →
    `buildRigTreeForPart(part)` walking `part.modifiers[]` (the
    canonical post-v20 stack).
  - `driver`: selection or fallback `paramId` → `compileDriverTree(...)`.
  - `animation`: `getActiveSceneAction(project, uiActiveActionId)?.id`
    → `compileAnimationTree(action)`.
  - `useMemo` deps narrowed to the canonical slices each derive reads.
  - Side-effect imports `nodes/drivers.js` + `nodes/animation.js` added
    so `getNodeType` lookups for labels resolve (these were previously
    side-effect-imported by v23/v24 migrations).
- **FCurveStrip executor**: legacy `storage.track` shadow branch
  deleted. Post-v38 the only producer is `compileAnimationTree`
  (storage.fcurve with rnaPath); `compileLegacyAnimationTree` is gone
  with the v24 module.
- **`animationCompile.js`**: JSDoc updated — SOLE compile path post-v38.
- **Migration-coverage tests deleted**: `test_nodetree_migration.mjs`,
  `test_driverTree_migration.mjs`, `test_animationTree_migration.mjs`.
  Replaced with leaner `test_animationTree_compile.mjs` (15
  assertions: shape + storage.fcurve invariant + byte-equivalence vs
  animationEngine).
- **Audit-pin**: `test_nodetree_retirement.mjs` (41 assertions): schema
  bump, migration delete + idempotency + e2e walk, no-op shim
  source-grep, disk-presence gate, NodeTreeArea production-code grep,
  FCurveStrip production-code grep, animationCompile JSDoc gate,
  package.json script wiring.
- **`package.json`**: dropped `test:nodetreeMigration` / `test:driverTreeMigration` /
  `test:animationTreeMigration`; added `test:nodetreeRetirement` +
  `test:animationTreeCompile`. Wired into npm test chain.

Net diff: −810 lines (810 deletions of migration baggage + dead branches +
old tests minus 524 lines added for v38 + new tests + on-the-fly derive).

### Same-day dual audit

Per the **established pattern** (memory:
`feedback_dual_audit_after_phase_ship.md`), two parallel
`general-purpose` agents ran against `ba20ef7`:

1. **Architecture audit** (12 gaps: G-1..G-12 — 2 HIGH, 2 MED, 8 LOW
   incl. positive findings)
2. **Blender-fidelity audit** (12 gaps: D-1..D-12 — 1 HIGH, 2 MED, 9 LOW
   incl. positive findings)

After cross-audit dedup, 11 unique gaps total: **1 HIGH + 5 MED + 5 LOW**.

The HIGH was a tight convergence — both audits flagged the same root
cause: `buildRigTreesForProject` / `buildNodeTreesFromProject` /
`evalAllRigTrees` were dead-write helpers that still touched the
just-retired `project.nodeTrees` field. They had zero production
callers (only `scripts/test/test_nodetree_eval.mjs` referenced them);
the substrate's audit-pin grep was scoped to `NodeTreeArea.jsx` only
and missed them. Calling them post-v38 would **re-introduce the
retired field** — exactly the Rule №2 anti-pattern the retirement
was supposed to close.

The audit also caught a sister dead branch in
`NodeTreeEditor.nodeSubtitle` (`s.track.paramId` / `s.track.property`
were reachable only via the v24 migration's `compileLegacyAnimationTree`,
gone since the substrate commit).

### Audit-fix sweep (`7c023b3`)

All HIGH addressed in code; all MED addressed in code or doc; all LOW
addressed via doc / cosmetic / dep-array trim.

| Gap | Severity | Lane | What |
|-----|----------|------|------|
| G-1+G-2+D-1 | HIGH | Architecture + Blender-fidelity | Delete `buildRigTreesForProject` + `buildNodeTreesFromProject` from `build.js`; delete `evalAllRigTrees` from `eval.js`. Keep `buildRigTreeForPart` (NodeTreeArea caller) + `evalNodeTree` (test harness for compile-pass byte-equivalence). Retire `evalAllRigTrees` test stanza in `test_nodetree_eval.mjs`. |
| G-3 | MED | Architecture | Delete `s.track.paramId` / `s.track.property` / `s.track.nodeId` branch from `NodeTreeEditor.nodeSubtitle` (lines 158-165). Replace with `s.fcurve.rnaPath` branch (post-v36 shape). |
| G-4 | MED | Architecture | Extend audit-pin's source-grep from NodeTreeArea-only to repo-wide `src/**/*.{js,jsx}`. `v38_nodetree_retirement.js` exempt (it owns the `delete` operation). |
| D-3 | MED | Blender-fidelity | `build.js` module JSDoc reframed — drops the V2 pre-v38 framing that positioned this as a "shadow data store" with a future "flip canonical → tree" migration. Declares modifier stack permanently canonical post-v38; V2 architectural bet retired. |
| D-4 | MED | Blender-fidelity | `animationCompile.js` JSDoc adds Phase 4 NLA TODO marker. Today's compile is `[FCurveStrip × N + TimelineOutput]` with last-strip-only link — a read-only-display approximation, NOT a runtime model. Blender's `NlaStrip` (`DNA_anim_types.h:425-499`) carries blendmode / extendmode / start / end / repeat / scale / influence / nested meta-strips. Phase 4 will REWRITE this compile to walk `nlaTracks[i].strips[]`. Marker prevents future contributors from extending instead of rewriting. |
| D-2 | LOW | Blender-fidelity | `v38_nodetree_retirement.js` JSDoc cites Blender ID_NT datablock deviation (`DNA_node_types.h:1879-1882`). SS retired the datablock because Blender's per-NodeTree undo / library linking / overrides don't apply to a read-only inspector — undo flows through canonical-source mutations. |
| D-6 | LOW | Blender-fidelity | `NodeTreeEditor.jsx` module JSDoc carries "Read-only by design" deviation note citing Blender `space_node` (`node_edit.cc:85-115`). Phase N-5 (V2 plan: drag/connect/delete) was retired with the NodeTree datablocks. |
| D-7 | LOW | Blender-fidelity + UX | Mode pill labels rewritten with canonical-source hints: `'Rig (Modifiers)'` / `'Driver (Expression)'` / `'Animation (FCurves)'`. Blender's NodeEditor `tree_type` enum (`DNA_node_types.h:274-283`) doesn't disclose edit surfaces because Blender's editor IS edit-capable; SS extends because the surface here is read-only. |
| D-8 | LOW | Migration baggage | `NodeTreeType` constant JSDoc notes post-v38 these strings are pure visualisation discriminators, not schema-bound. The Stage 1.E audit-fix G-5 stalemate (`'animation'` lagged the rename because the underlying tree datablock was still `animation`-named) is dissolved — there's no datablock anymore. |
| D-9 | LOW | Blender-fidelity | `projectMigrations.js` header documents the migration walker's contiguous-version invariant as Blender deviation (Blender uses field-level `MAIN_VERSION_FILE_ATLEAST` predicates) + adds a retirement playbook (cleanup migration at N+1, no-op shim at N, delete the module). |
| G-5 | LOW | Architecture | `tree` useMemo deps drop redundant `driverIds` (already a memoised derivative of `project.parameters` which is in the deps; listing both is the filter-in-selector trap). |

**Audit-pin extension**: `test_nodetree_retirement.mjs` extended 41 → 68
assertions. New gap blocks 10-20 cover every audit-fix with:
- Module-export presence/absence checks via dynamic `import * as buildModule`
- Source-grep for deleted dead branches (`s.track` etc.)
- Repo-wide `project.nodeTrees` grep walker (v38 exempt)
- JSDoc presence checks for all deviation citations
- useMemo dep-array regex extraction for G-5 verification

Audit reports kept inline (no separate AUDIT_*.md files — close-out
table IS the canonical audit record, per Stage 1.D/1.E convention).

## Test scoreboard

All NodeTree-touched suites green.

| Suite | Assertions |
|-------|------------|
| `test_nodetree_retirement` (NEW + extended in audit-fix) | 68 |
| `test_animationTree_compile` (NEW, replaces deleted migration test) | 15 |
| `test_nodetree_eval` (trimmed: evalAllRigTrees stanza retired) | 5 |
| `test_nodetree_shape` (no churn) | 35 |
| `test_driverTree_eval` (no churn) | 15 |
| `test_nodeTreeEditor_renderRead` (no churn — same compile passes) | 24 |
| `test_nodeTreeEditor_interactions` (no churn) | 25 |
| `test_nodeTreeEditor_typeValidation` (no churn) | 8 |
| `test_migrations` (extended via the contiguous walker; v22/v23/v24 shims) | 138 |
| `test_migration_v37` (no churn) | 57 |
| `test_projectRoundTrip` (no churn) | 41 |
| `test_depgraphEvalAnimation` (no churn) | 7 |
| `test_exportAnimation` (no churn) | 35 |
| `test_saveLoadRigSpec` (no churn) | 19 |
| `test_animationStore` (no churn) | 55 |
| `test_audit_fixes_2026_05_11_phase1_stage1e` (Stage 1.E pin still green) | 39 |
| `test_audit_fixes_2026_05_11_phase1_stage1d` (Stage 1.D pin still green) | 81 |
| `test_audit_fixes_2026_05_11_phase1_stage1c` (Stage 1.C pin still green) | 57 |
| `test_audit_fixes_2026_05_11_phase1_stage1ab` (Stage 1.A+1.B pin still green) | 47 |

Typecheck clean.

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (51 from earlier 2026-05-11 close-outs through `098421b`) | Phases 0–7.D + Phase 1 Stages 1.A/1.B/1.C/1.D/1.E ship + 15 audit-fix sweeps + 10 close-out docs |
| 52    | `ba20ef7` | feat(anim): Phase 1 Stage 1.F (pre-exit) — NodeTree retirement (schema v38) |
| 53    | `7c023b3` | fix(audit): Phase 1 Stage 1.F-pre — NodeTree retirement audit-fix sweep (1 HIGH dedup'd + 5 MED + 5 LOW) |
| 54    | (next)    | docs(plan): Stage 1.F-pre NodeTree retirement close-out doc (this file) |

## Schemas after Phase 1 Stage 1.F-pre

`CURRENT_SCHEMA_VERSION = 38`. v38 idempotently deletes
`project.nodeTrees`. v22/v23/v24 entries stay as no-op shims (the
walker requires contiguous version numbers; their migration MODULES
are deleted from disk).

## Hotkey reservations

Stage 1.F-pre added no new hotkeys. Phase 6 `I` reservation (Insert
Keyframe) remains queued.

## Resume paths for fresh session

The Phase 1 exit gate is the natural next chunk. (Stage 1.E's D-1
follow-up was RE-RESOLVED 2026-05-12 — Item-tab placement IS the
Blender mirror via `OBJECT_PT_animation`; no implementation needed.
See [SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md).)

### A. Stage 1.F + 1.G — Phase 1 exit gate (recommended next)

Per plan §1.F + 1.G (lines 637-651):

- 5 new test suites:
  - `test_actionDatablock_migration.mjs` — v32→v33 round-trip (was
    v33 in v1 plan; now post-renumber it's v36 round-trip via existing
    `test_migration_v36`)
  - `test_actionRegistry.mjs` — already shipped (95 assertions Stage 1.C+1.D)
  - `test_actionScene.mjs` — depends on Stage 1.D scene + Stage 1.E
    consumers; treats `__scene__` AnimData identically to Object
    AnimData via the rewired exporter
  - `test_actionExportMotion3.mjs` — each Action exports to one
    motion3.json (current path via `resolveActions`)
  - `test_actionExportCan3.mjs` — each Action exports to one .can3
- **Manual Cubism Viewer .moc3 acceptance gates on Shelby + test_image4**
  — each PSD with one keyframed Action — the user-gesture test that
  closes Phase 1. BOTH PSDs are required per memory
  `feedback_test_character_is_shelby.md` ("the byte-fidelity gate must
  exercise **both** PSDs"; same dual-PSD policy already in plan §11
  lines 1625-1626 and Phase 0.D flag-flip gate). Anime topology
  (test_image4) has historically exposed bugs the Western fixture
  (Shelby) missed — BUG-025 leg-roles fly was anime-only. Hiyori is
  reference-only with no PSD source.

NodeTree retirement (this sub-session) was the prerequisite that
removed the v24-shadow code path from the test matrix.

### B. ~~Properties dedicated "Animation" tab~~ — RE-RESOLVED 2026-05-12 (no follow-up needed)

This Resume path's premise was a misread of Blender. The Item-tab
placement IS the Blender mirror via `OBJECT_PT_animation`
(`properties_object.py:618`, `bl_context = "object"`); Blender has no
dedicated Animation tab. The original (now-rejected) plan called for
adding a peer `'animation'` tab and moving `animData` out of Item
tab — **do not do this**, it is the SS-invented pattern that the
RE-RESOLUTION rejects. See
[SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md](./SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md).

### C. Stage 1.E audit-fix D-9 follow-up — projectMigrations walker refactor

Per Audit-fix D-9 in this sub-session:

- Refactor `migrateProject` to tolerate version skips (mirror Blender's
  `MAIN_VERSION_FILE_ATLEAST` field-level predicates).
- Delete the no-op shim entries entirely (v22/v23/v24/v30/v31).
- Sister cleanup that closes Rule №2 baggage across the migration table.

Smallest decoupled chunk if Phase 1 exit gate is blocked on browser
testing.

### Recommended order

A → C. The Phase 1 exit gate is the closing gate the entire
animation Phase 1 lineage was building toward; C is decoupled polish
that can wait. (B is RE-RESOLVED — no follow-up needed.)

## Cross-references

- Animation plan: [docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md) §Phase 1 lines 419-578 + §9.E lines 1642-1653 ("Why retire NodeTrees")
- Stage 1.E close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1E.md)
- Stage 1.D close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1D.md)
- Stage 1.C close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1C.md)
- Stage 1.A+1.B close-out: [SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md](./SESSION_CLOSEOUT_2026_05_11_PHASE1_STAGE1AB.md)
- V2 NodeTree retirement context: [docs/plans/BLENDER_PARITY_V2_SHIPPED.md](./BLENDER_PARITY_V2_SHIPPED.md)
- Memory: dual-audit-after-every-phase-ship pattern
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\feedback_dual_audit_after_phase_ship.md`)
- Memory: in-flight plans pointer
  (`C:\Users\Alexgrv\.claude\projects\d--Projects-Programming-stretchystudio\memory\project_blender_parity_plans_in_flight.md`)
