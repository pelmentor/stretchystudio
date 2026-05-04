# BFA-006 — Collapse `rigSpec` into `project.nodes` (deformer-as-node)

**Status:** plan, not yet started.
**Estimated cost:** 5–8 days of focused work, shippable in phases (each behaviour-preserving).
**Prereq:** none — current state is the unified Outliner View Layer (commit `7d2a426`), which fakes the unification at the view layer. This plan promotes it to the data model.

---

## Why this exists

Today's data model has **two parallel graphs**:

1. **`project.nodes`** — the scene graph. Parts (`type:'part'`) and groups (`type:'group'`, with `boneRole` flagging bones). Hand-authored, persisted, drag-reorderable, undo-tracked.
2. **`useRigSpecStore.rigSpec`** — the rig graph. Warp deformers, rotation deformers, art-mesh frames. Computed from project state by `initializeRigFromProject` running `generateCmo3` in `rigOnly` mode. Volatile — never persisted.

Plus three persisted sidetables that hold the SOURCE data the rig graph is built from:

3. `project.faceParallax`
4. `project.bodyWarp`
5. `project.rigWarps`

The Outliner just shipped a unified View Layer mode that **fakes** one tree by composing both stores at render time. That's a view-layer fix, not a data-model fix. The data-model split is structurally why:

- Save/load is twice the surface — every persistent rig field needs explicit serialization (and silently dropping a field is what GAP-011 caught).
- `_userAuthored` marker tracking lives on the storage shape, not on identifiable nodes — per-stage refit semantics need bespoke merge logic per subsystem (see [`RigService.runStage`](../src/services/RigService.js)).
- Selection works for project nodes but not for deformers without `selectionStore` carrying a separate `'deformer'` type.
- A deformer "exists" only after `initializeRigFromProject` runs; you can't reference one before Init Rig, can't undo into it, can't drag-reorder it.
- Save→load doesn't auto-rebuild rigSpec; user must click Init Rig again to repopulate the live evaluator (gap surfaced in the persistence audit).

The fix this plan proposes: **deformers become `project.nodes` entries with `type:'deformer'`**. `rigSpec` becomes a derived selector — a runtime index over `project.nodes`, not a separately-built blob. The three persistent sidetables collapse into the node list itself.

---

## Scope

### In

- New node type: `{type:'deformer', deformerKind:'warp'|'rotation', …}`.
- Auto-rig generators (`initializeRigFromProject`, `seedAllRig`, per-stage refit) write deformer nodes into `project.nodes` instead of the three sidetables.
- `rigSpecStore` becomes a **derived selector** — `selectRigSpec(state)` walks `project.nodes`, indexes deformers, returns the chainEval-shaped object. No more async build, no more `lastBuiltGeometryVersion` cache invalidation.
- Save/load round-trips deformer nodes verbatim through the existing `project.nodes` serializer. The three sidetables (`faceParallax`, `bodyWarp`, `rigWarps`) deprecate.
- `_userAuthored` markers move from sidetable keys to per-node fields — `node._userAuthored: true` is enough; per-stage refit's merge logic uses the marker directly.
- Selection: deformer-typed selection already exists in `selectionStore` for the rig-mode tree; no change needed there. Outliner's View Layer mode shows deformers naturally as siblings/children — no synthetic "Rig" pseudo-root.

### Out

- **Bones stay `type:'group'` with `boneRole`.** Bones are ARMATURE objects (Blender contract), not modifiers/deformers. They're conceptually distinct: deformers DRIVE bones via `ParamRotation_<bone>`. Promoting bones to `type:'deformer'` would muddle the model.
- **Parameters / mask configs / physics rules / variant fade rules / boneConfig stay where they are** for now. They're metadata, not graph entities. A future BFA could collapse them too, but not in this scope.
- **Cubism Editor / runtime byte-fidelity is preserved.** The exporter still receives the same rigSpec shape — it's just derived from project.nodes once at export time instead of held as a separate store.
- **chainEval's input shape is unchanged.** It already builds `buildDeformerIndex(rigSpec)` per call; we just feed it a derived rigSpec. Per-frame allocation cost stays flat.

---

## Schema design

### New `OutlinerNode` / `ProjectNode` discriminator

```ts
type ProjectNode =
  | { type: 'part';     id: string; ...partFields }
  | { type: 'group';    id: string; boneRole?: string; ...groupFields }
  | { type: 'deformer'; id: string; deformerKind: 'warp'|'rotation'; ...deformerFields };
```

### Warp-deformer node shape

```ts
{
  type: 'deformer',
  deformerKind: 'warp',
  id: string,                            // stable UID, same as old rigSpec deformer.id
  name: string,                          // 'BodyWarpZ' / 'FaceParallax' / 'RigWarp_front_hair'
  parent: string | null,                 // parent deformer id; null = root-parented
  visible?: boolean,
  // -- warp shape --
  gridSize: { rows: number, cols: number },
  baseGrid: number[],                    // flat [x,y,...] in localFrame
  localFrame: 'canvas-px' | 'normalized-0to1',
  bindings: Array<{ paramId, type, keyValues }>,
  keyforms: Array<{ keyTuple, positions, opacity }>,
  // -- per-part rigWarp metadata (today in rigSpec.warpDeformers, lifted here) --
  targetPartId?: string,                 // when this warp is a per-part rigWarp
  isQuadTransform?: boolean,
  // -- author markers --
  _userAuthored?: true,                  // V3 Re-Rig: refit preserves this entry
}
```

### Rotation-deformer node shape

```ts
{
  type: 'deformer',
  deformerKind: 'rotation',
  id: string,
  name: string,                          // 'GroupRotation_<groupName>'
  parent: string | null,
  visible?: boolean,
  // -- rotation shape --
  bindings: Array<{ paramId, type, keyValues }>,
  keyforms: Array<{ keyTuple, angle, originX, originY, scale, reflectX, reflectY, opacity }>,
  // -- author markers --
  _userAuthored?: true,
}
```

### Part node — adds rig parent pointer

```ts
{
  type: 'part',
  id: string,
  ...existing,
  // NEW: which deformer (if any) drives this part. Today this lives
  // implicitly via rigSpec.artMeshes[i].parent; lift it explicitly.
  rigParent?: string | null,
}
```

`group` shape unchanged.

### Sidetables that deprecate

- `project.faceParallax` → unfolded into a single `type:'deformer'` node with `id:'FaceParallax'`.
- `project.bodyWarp.specs[]` → each entry becomes a `type:'deformer'` node; the surrounding `layout`/`bodyFrac` metadata moves to `project.bodyWarpLayout` (kept as small sidetable since it's measurement metadata, not deformer state).
- `project.rigWarps` → each entry becomes a `type:'deformer'` node with `targetPartId` set.

### What stays derived (NOT persisted on deformer nodes)

`selectRigSpec` regenerates these fields from project.nodes each call. Persisting them would let stored data drift from geometry — the audit confirms chainEval and the writers consume all of them.

- **`ArtMeshSpec.verticesCanvas` / `triangles` / `uvs`** — read from `node.mesh.*` at projection time. Persisting would duplicate mesh state.
- **`RigSpec.canvasToInnermostX` / `canvasToInnermostY`** — closures over the innermost body warp's bbox (currently `BodyXWarp`). chainEval reads them at [`chainEval.js:409`](../src/io/live2d/runtime/evaluator/chainEval.js#L409) for the legacy `_warpSlopeX/Y` fallback. `selectRigSpec` rebuilds them from the innermost warp deformer node's `baseGrid` bbox.
- **`RigSpec.innermostBodyWarpId`** — the id of the deepest `BodyXWarp`-style warp; selector picks the bottom of the BodyWarp* chain.
- **`RigSpec.parts`** — built from `project.nodes.filter(type==='part')`.
- **`RigSpec.parameters`** — already in `project.parameters`, copied verbatim.
- **`RigSpec.physicsRules`** — `resolvePhysicsRules(project)` (already a derived selector).
- **`RigSpec.canvas`** — `project.canvas`.

### `_userAuthored` keying after migration

Today the marker key is per-stage:
- `maskConfigs` → `maskedMeshId`
- `physicsRules` → `id`
- `rigWarps` → `targetPartId`
- `faceParallax` / `bodyWarp` → scalar (the marker lives on the singleton itself, so EITHER the whole thing is user-authored OR not)

After migration everything is a `project.nodes` entry, so the merge logic collapses into ONE rule: **id-keyed merge.** `seedAllRig({mode:'merge'})` walks both arrays, preserves nodes whose `_userAuthored === true`, and overwrites the rest with auto-seeded entries that share an id. Per-deformer granularity replaces the singleton "all-or-nothing" semantics that `faceParallax` / `bodyWarp` had — a strict UX improvement.

---

## Phase breakdown

Each phase is **independently shippable**. After each phase, all tests pass + the app behaves identically. We don't break the world, we strangle the old shape.

### Phase 1 — Schema migration (~1 day)

**Goal:** old projects load into the new shape; new shape persists; rigSpec still consumed via the legacy fields, just sourced through the new nodes.

- Add a `projectMigrations.js` v15 entry that:
  - Reads old `faceParallax` / `bodyWarp` / `rigWarps` / `parameters`.
  - Synthesises `type:'deformer'` nodes appended to `project.nodes` with stable ids.
  - Writes `parts[i].rigParent` from the old `rigSpec.artMeshes[i].parent` mapping (rebuild via `initializeRigFromProject` if needed during migration).
  - Sets `lastInitRigCompletedAt` based on old `lastInitRigCompletedAt` so rig freshness is preserved.
  - Leaves the OLD fields in place (for one release) so a rollback is possible.
- `loadProject` / `saveProject` learn to round-trip deformer nodes (just project.nodes serialization, already handles arbitrary `type` discriminator).
- Existing `useRigSpecStore.buildRigSpec` continues to work — it just reads from the new nodes when present, falls back to old fields when not. Both paths produce the same rigSpec shape.

**Deliverable:** Test fixture project saved by current main loads in the new shape. Test fixture saved in the new shape loads back identically. `npm test` green.

### Phase 2 — `selectRigSpec` derived selector (~1 day)

**Goal:** rigSpec is a function of project.nodes, not a separately-built blob.

- Add `src/io/live2d/rig/selectRigSpec.js` exporting `selectRigSpec(project): RigSpec`.
  - Walks `project.nodes`, partitions into warp/rotation deformers + parts.
  - Builds the same shape `chainEval` expects today — `{warpDeformers, rotationDeformers, artMeshes, parameters, canvas, physicsRules}`.
  - Pure, memoizable on `project` identity.
- `useRigSpecStore.rigSpec` becomes a thin `useProjectStore` derived value:
  ```js
  export const useRigSpec = () => useProjectStore((s) => selectRigSpec(s.project));
  ```
- Old `buildRigSpec` async builder kept as **back-compat shim** that just calls `selectRigSpec` synchronously (for callers that still `await` it).
- `lastBuiltGeometryVersion` / `isBuilding` slots become no-ops (always-fresh).

**Deliverable:** `chainEval` consumers still get the same object shape. `npm test` green. Manual verify: open project, drag a slider, see the rig deform. No "click Init Rig to rebuild" needed after load.

**Status (this commit).** Pure selector shipped at `src/io/live2d/rig/selectRigSpec.js` + 40-assertion test (`test_selectRigSpec.mjs`). The full Phase-2 wiring of `useRigSpecStore` was deferred — the selector currently produces a partial RigSpec (warps + parts + canvas + parameters + physicsRules + body-warp closures). Two slices stay empty:

  - `rotationDeformers: []` — Phase 1's migration only synthesised warp deformer nodes from sidetables (rotation deformers were never persisted; they're generated each Init Rig). The selector reads rotation nodes when present, so as soon as Phase 3 dual-writes them, this slice fills in automatically with no code change here.
  - `artMeshes: []` — derivation requires lifting each parent warp's rest grid to canvas-px to project mesh verts into the parent deformer's local frame; the lifted-grid pass needs both warps + rotations resolved, so it lands alongside Phase 3.

`useRigSpecStore.rigSpec` keeps reading through the legacy `buildRigSpec` async builder until Phase 3 — the partial selector would otherwise drop rotation deformers from the live evaluator. The selector + memoization (project-identity `WeakMap`) are in place so Phase 3's wiring is a one-line swap.

### Phase 3 — Auto-rig writes deformer nodes (~2 days)

**Goal:** `initializeRigFromProject` + `seedAllRig` + per-stage refit all WRITE deformer nodes into `project.nodes` directly. The three legacy sidetables stop being touched.

- `seedAllRig(harvest)` rewrites: it now upserts deformer nodes in `project.nodes`, indexed by id. `mode: 'merge'` preserves `_userAuthored` markers per-node. `mode: 'replace'` clobbers.
- **Synthetic "Rig" Collection (per Decision 2):** `seedAllRig` ensures a root-level `type:'group'` node named "Rig" exists, then sets every generated deformer node's `parent` to that group's id. User can rename / move / delete the group post-seed; deformers fall back to root-parented when the Rig group goes away.
- Per-stage refit (`runStage`): same `seedAllRig(harvest, mode)` path; harvest already returns the right shape, only the WRITE side changes.
- `paramSpec.js` / `physicsConfig.js` / etc. — already write to `project.parameters` / `project.physicsRules`, no change.
- `applySubsystemOptOutToRigSpec` (PP1-002) becomes a project-walking pass: filter `project.nodes` to deformers, identify subsystem-owned ones via `targetPartId → tag → subsystem`, neutralise (single rest keyform, empty bindings) verbatim — same algorithm, different input shape.

**Deliverable:** Init Rig produces the same rendered output, with deformers visible in the Outliner under a "Rig" Collection. `npm test` green including the round-trip + e2e tests.

### Phase 4 — Outliner naturalisation (~0.5 day)

**Goal:** Outliner's View Layer mode shows deformers as siblings of parts/groups (or under the "Rig" Collection group from Phase 3), without the runtime-synthesised pseudo-root.

- `buildHierarchyTree` already walks `project.nodes`. Once deformers are in there, they appear naturally — no special-case code.
- **Delete `RIG_PSEUDO_ROOT_ID` + `buildViewLayerTree` composition.** The "Rig" Collection group from Phase 3 is now a real `type:'group'` node, not a synthetic one — the unified tree is just the hierarchy walker.
- "Armature Data" and "Rig Data" dropdown filters become SAME-DATA filters over the unified tree (predicate-based on `node.type === 'deformer'` etc.), not separate trees with different builders.
- TreeNode's `isBone` flag stays; add an analogous `isDeformer` for icon picking (warp icon for `deformerKind:'warp'`, rotation icon for `deformerKind:'rotation'`).

**Deliverable:** Outliner shows one canonical tree. The unified View Layer name still applies but the dropdown's `Armature Data` and `Rig Data` filters are now SAME-DATA filters, not different-tree filters. `RIG_PSEUDO_ROOT_ID` constant + `buildViewLayerTree` function are removed.

### Phase 5 — Selection + per-deformer properties (~0.5 day)

**Goal:** clicking a deformer in Outliner / canvas opens its properties (keyform editor, bindings, etc.) like any other node.

- `selectionStore.select({type:'deformer', id})` already supported. Properties tab registry adds a `WarpDeformerTab` and `RotationDeformerTab` that read the selected deformer node from `project.nodes` directly.
- Tabs surface: name, parent (drag to reparent), bindings list, keyforms list, `_userAuthored` toggle ("locked from refit").
- Drag-reorder in Outliner (existing patch hook for parts/groups) extends to deformers — moving a deformer reparents it.

**Deliverable:** The user can browse, edit, and re-parent deformers from the Outliner without any rig-sidetable knowledge.

### Phase 6 — Sidetable deletion (~1 day)

**Goal:** `project.faceParallax` / `project.bodyWarp` / `project.rigWarps` removed from the schema.

- All readers (~18 files) are migrated to read from `project.nodes` directly.
- `seedFaceParallax` / `seedBodyWarp` / `seedRigWarps` actions on `projectStore` deprecate (the `seedAllRig` write-path is the new home).
- Migration v16: drop the old fields from any project that still carries them.
- `saveProject` / `loadProject`: stop emitting/reading the three fields.

**Deliverable:** `git grep "project.faceParallax\|project.bodyWarp\|project.rigWarps"` returns zero hits in `src/`. All tests green.

### Phase 7 — Cleanup + docs (~0.5 day)

- Delete legacy `buildRigSpec` async builder + its single-flight guard (Phase 2 made them no-ops).
- Update `BLENDER_FIDELITY_AUDIT.md` past-wins entry for BFA-006.
- Update `PROJECT_DATA_LAYER.md` — close I-1 / I-2 / I-3 / etc. holes that become moot once deformers are nodes.
- Update `V3_RERIG_FLOW_PLAN.md` if any notes need amending.

---

## Migration strategy

- **Forward compatibility (old saves load):** Migration v15 unfolds sidetables into nodes. Every existing `.stretch` file loads correctly.
- **Backward compatibility (new saves load on old code):** **Not preserved.** Once Phase 1 lands, saves carry deformer nodes. Old code seeing `type:'deformer'` would either ignore them (TreeNode renders an unknown-type icon — non-fatal) or crash. We're past the v3 stability window where this matters; users on master only.
- **Rollback path:** Phase 1 leaves the old fields in place during migration. If we need to roll back to before Phase 6, the writes still work because the auto-rig pipeline keeps populating both shapes through Phases 1–5. Rollback only loses Phase 6 work.

---

## Risk register

| Risk | Severity | Mitigation |
|------|----------|------------|
| chainEval per-frame regression — derived selector adds allocation cost | high | Memoize `selectRigSpec` on `project` identity. The current `useRigSpecStore.rigSpec` already changes identity on geometry edits via `geometryVersion`; matching that cadence is fine. Bench against shelby (1339 tests already run) to confirm no >5% frame budget regression. |
| Save format break on rollback | high | Keep old fields populated during Phases 1–5. Phase 6 deletes them, but only after Phase 5 has soaked. |
| `_userAuthored` semantics drift mid-refactor | medium | Phase 3 lands the migration in a single commit; no partial state where some sidetables write _userAuthored and others write to nodes. |
| Cubism byte-exact export breaks | high | Every phase keeps `chainEval` and `generateCmo3` consumers unchanged. They read the same shape. The only diff is WHERE that shape comes from (a derived selector vs. a built blob). Run `test:cubismPhysicsOracle` + `test:e2e` after each phase. |
| Per-stage refit (V3 Re-Rig) regression | medium | Phase 3 ports the merge logic node-by-node. The 11-stage runStageIntegration test is the regression net. |
| Outliner drag-reorder lands deformers in invalid parents | low | Phase 5's drag handler validates: deformer parent must be another deformer or root; part parent must be group/null; group parent must be group/null. Reject invalid drops. |
| `canvasToInnermostX/Y` closures regenerated each `selectRigSpec` call → allocation churn on the chainEval hot path | medium | Memoize `selectRigSpec` on `project` identity (`useProjectStore` already preserves identity across non-mutating reads). Closures only rebuild when project changes — same cadence as today's `useRigSpecStore.buildRigSpec`. Bench against shelby to confirm <5% frame-budget delta. |
| User deletes the synthetic "Rig" Collection group → orphan deformers | low | Group-delete path either reparents children to root (legitimate) or refuses if `_userAuthored`-marked deformers would orphan. Keep the soft fallback: deformers with `parent === <deletedRigId>` get `parent: null` on group delete. Auto-rig recreates the Rig group on the next Init Rig if missing. |
| Migration v15 reconstructing `parts[i].rigParent` requires re-running Init Rig (async) → migration becomes async | medium | Migration v15 reads `project.rigWarps[partId]` directly to figure out which deformer parents which part — the data is already there, no async re-run needed. The synthesis is "for each rigWarps key, set `parts[partId].rigParent = rigWarps[partId].id`." Plus FaceParallax / BodyWarp parts inferred from their existing `parent` fields in the spec. Synchronous. |

---

## Test strategy

- **Per-phase regression:** `npm test` is the gate. Phase 1 adds round-trip fixtures with deformer nodes. Phase 2 adds a `selectRigSpec` purity test. Phase 3 adds an Init-Rig-writes-nodes test. Phase 6 adds a "no sidetable references" lint test (grep-based).
- **Oracle gate:** `test:cubismPhysicsOracle` + `test:breathFidelity` + `test:e2e` after each phase to confirm byte-fidelity holds.
- **Manual gate after each phase:** Open shelby project, click Init Rig, verify the canvas matches the pre-phase render, save + reload, verify canvas matches.
- **Migration gate:** Save a fixture project on the pre-phase commit, switch to the post-phase commit, load it, assert deepEqual to a freshly-generated post-phase project.

---

## Decisions (2026-05-04 — "делаем как Blender")

User locked in the four open questions with "do as Blender does". The Blender-canonical answers happen to match the original recommendations — formalising them so each phase has a fixed contract:

1. **Bones stay separate from deformers.** Blender's data model: bones are sub-data of an Armature OBJECT (not Objects themselves); modifiers are sub-data of Mesh Objects. They're structurally distinct categories. SS mirrors this: bones stay `type:'group' + boneRole`, deformers become `type:'deformer'`. The two categories interact through `ParamRotation_<bone>` parameters — bones don't BECOME rotation deformers, they DRIVE them.

2. **Auto-rig creates a default "Rig" Collection.** Blender's auto-generated rigs (e.g. Rigify) drop their generated objects into a sub-Collection by default. SS auto-rig will do the same: the seed step creates a `type:'group'` node named "Rig" at root level, then attaches every generated deformer node under it. The user can rename it, move deformers OUT of it, delete it (deformers reparent to root) — it's just a Collection. This keeps the default Outliner tidy when there are 30–50 generated deformers without forcing structure on power users.

3. **Incremental push after each phase.** Blender's main is always green; large refactors land in small reviewable patches. Each phase here is shippable + behaviour-preserving — push after each. Smaller blast radius, easier revert per phase, oracle gate runs catch regressions before the next phase compounds them.

4. **One week of daily-driver soak before Phase 6.** Blender's deprecation cycle is ≥1 release before removal. Phases 1–5 keep `project.faceParallax` / `project.bodyWarp` / `project.rigWarps` populated alongside the new deformer nodes (dual-write). After Phase 5 lands and at least one week of daily-driver use passes with no rig-eval / export regressions, Phase 6 deletes the old fields. Rollback to Phase 5 stays possible during that window.

---

## Cross-references

- Trigger: [BLENDER_FIDELITY_AUDIT.md](BLENDER_FIDELITY_AUDIT.md) — user 2026-05-04 questioned 3-tab Outliner, ratified View Layer dropdown, asked for full data-model unification next.
- Existing data layer audit: [PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md) — most "holes" become moot when deformers are nodes (I-1 / I-2 / I-3 / I-8).
- Re-rig flow that this plan needs to keep working: [V3_RERIG_FLOW_PLAN.md](V3_RERIG_FLOW_PLAN.md).
- Outliner view-layer fix this plan promotes: commit `7d2a426` (`refactor(outliner): unified View Layer tree + Blender-style scope dropdown`).
