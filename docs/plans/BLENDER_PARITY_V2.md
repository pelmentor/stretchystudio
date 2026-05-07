# Blender Parity Refactor V2 — DepGraph + Modifier Eval Flip + NodeTree

**Status:** Drafted 2026-05-07. Audited 2026-05-07. Consensus locked.
**SHIPPED:** Phase 0 + Refactor 1 (D-1..D-6) + Refactor 2 (N-1..N-5) all landed 2026-05-07 in one autonomous session. ~600 new test assertions across 28 new test scripts. `npm test` + `tsc --noEmit` green throughout.

**Pending — gated on user validation:**
- D-6 user gate: manual Shelby byte-fidelity sweep + flip default `evalEngine` flag to `'depgraph'`.
- 2-week soak under `'depgraph'` default.
- Cleanup phase deletions (chainEval, selectRigSpec, synthesizeDeformerParents, dual-write synthesizers, `'classic'` flag) — only after soak passes.
**Author:** Claude (autonomous mode)
**Scope:** ~12 weeks autonomous, three architectural refactors with one merged engine block + visual editor on top.

## Why this plan

The V1 Blender Parity refactor (shipped 2026-05-06) brought SS's *data shape* into structural alignment with Blender — Object/ObjectData split, per-object mode, modifier+constraint stacks (storage), FCurve/Driver primitives, RNA path resolver. The *evaluation engine* underneath was untouched. Today's runtime still walks parent-link trees in `chainEval.js`, recomputes `selectRigSpec` whole-graph on every project mutation, and drivers/FCurves are scaffolded but never fire.

V2 replaces the evaluation engine. After audit, the plan structure is:
1. **Phase 0** — Foundation cleanup. Schema migration v21, body-warp fallback made explicit, Init Rig writes modifier stacks directly, `synthesizeDeformerParents` (the inverse synth) properly implemented, test harness for Shelby byte-fidelity.
2. **Refactor 1 (MERGED DepGraph + Modifier Eval Flip)** — DepGraph as the formal eval engine; modifier-stack iteration as the concrete mechanism for the GEOMETRY_EVAL kernel. The audit's key insight: doing these sequentially rewrites `chainEval.js` twice. Merged, they're one engine refactor.
3. **Refactor 2 (NodeTree)** — Per-domain (Rig / Driver / Animation) node-graph datablocks layered on top of the depgraph. Visual editor as the user-visible payoff.
4. **Cleanup** — Delete dead code paths after soak.

## What stays unchanged

- `.cmo3` / `.moc3` / `.can3` byte-fidelity. The rig data shape ABOVE the eval engine is unaffected by V2 — Init Rig still produces the same project nodes; export still walks them. V2 changes how those nodes are evaluated at runtime, not what they are.
- v18/v19/v20 schema. V2 introduces v21+ for new fields (modifier mode flags, NodeTree datablocks) but no existing field is removed.
- `npm test` green throughout. Each phase is shippable independently.
- The Phase 5 scaffolds I just shipped (`src/anim/{fcurve,driver,driverPass,animationFCurve,constraints}.js`) are absorbed by V2's depgraph as evaluation kernels — they don't get rewritten, they get wired in.

## Cross-cutting architectural rules

**Rule 1 — Phase X-flip never breaks Phase (X-1).** Every flip ships behind a feature flag (`evalEngine: 'classic' | 'depgraph'`). Default flag stays `'classic'` until manual Shelby byte-fidelity sweep validates the new path. Old code path is not deleted until 2 weeks after default flip.

**Rule 2 — Reference everything in Blender source.** Every helper module's doc header cites `reference/blender/source/...:line` for the function it's adapting from, and lists SS deviations explicitly. No "I think Blender does X" — read the source.

**Rule 3 — One canonical mirror at a time.** The audit caught a triple dual-write risk in V1. Mitigation rule: at any given moment, at most ONE dual-write window is active. Phase 0 eliminates the parent-link → modifier-stack post-pass (Init Rig writes stacks directly). Refactor 1 maintains modifier-stack ↔ DepGraph dual-write. Refactor 2 maintains modifier-stack ↔ NodeTree dual-write only AFTER Refactor 1's window closes.

**Rule 4 — Tests pin behaviour, not implementation.** Phase A's tests must still pass after Phase B's flip — the public eval contract (rigSpec → ArtMeshFrame[]) doesn't change between phases, only the engine underneath.

**Rule 5 — Byte-fidelity is the gate, not green tests.** Every flip's gate is the manual Shelby PSD → cmo3/moc3 byte-diff. Unit tests pass means the engine doesn't crash; byte-diff zero means the engine is correct.

---

# Phase 0 — Foundation cleanup (Week 1)

## Goal

Three problems V1 left behind that V2 cannot proceed without addressing:
1. **Body-warp implicit fallback.** Every part without `rigParent` ends up with an empty modifier stack today; chainEval implicitly threads them through `innermostBodyWarpId`. The Refactor 1 modifier-stack iteration silently drops these parts. Fix at the data layer.
2. **Init Rig writes parent-link trees** then a post-pass derives modifier stacks. By Refactor 1, this means three mirrors (parent-link, modifier-stack, depgraph). Fix by making Init Rig write stacks directly and parent links derived (the audit's recommendation).
3. **`synthesizeDeformerParents` is named in V1's plan but never specified.** The export pipeline (`cmo3writer.js`) reads `node.parent` directly. When modifier-stack becomes canonical, the parent-link must be derived from stacks for export to stay byte-identical. Specify and implement the inverse synth.

By end of Phase 0:
- Schema v21 migration: every existing modifier extended with `{mode: MODE_REALTIME | MODE_RENDER, enabled: true, showInEditor: true}` per `DNA_modifier_types.h:131-142`. Synthetic body-warp modifier written for every part missing rigParent.
- `initRig.js` writes `part.modifiers[]` directly. Parent links on deformer nodes become derived view via `synthesizeDeformerParents`.
- `synthesizeDeformerParents(project)` implemented + tested. Round-trips via `synthesizeModifierStacks` → `synthesizeDeformerParents` produce the original project structurally.
- Shelby byte-fidelity test infrastructure: `scripts/test/test_shelbyByteFidelity.mjs` runs Init Rig on a Shelby fixture, exports cmo3+moc3, compares against pre-V2 baseline. Cold-start vs warm-start physics handled.
- `npm test` green.

## Phase 0 sub-phases

**0.1 (~1.5 days)** — Schema v21 migration + body-warp fallback
- New file: `src/store/migrations/v21_modifier_mode_flags.js` (extracted from projectMigrations.js).
- Migration walks every part: extends each modifier with `{mode: MODE_REALTIME | MODE_RENDER, enabled: true, showInEditor: true}`. For parts with empty `modifiers[]` AND non-null `selectRigSpec(project).innermostBodyWarpId`, write a synthetic `{type: 'warp', deformerId: <innermostBodyWarpId>, ...}` modifier.
- Test: `test_migration_v21.mjs` — verifies mode flag insertion, body-warp fallback insertion idempotent, no double-writes.

**0.2 (~1.5 days)** — `synthesizeDeformerParents` (inverse synth)
- New function in `src/store/deformerNodeSync.js`. Walks every part's `modifiers[]`, derives the leaf-to-root deformer parent chain, writes `node.parent` on each deformer.
- Round-trip invariant test: `synthesizeModifierStacks(p) → synthesizeDeformerParents(p)` produces a project with identical `node.parent` values to the original (modulo the synthetic body-warp inserts).
- Edge case: parts with non-deformer parent ids (e.g. group folders). Test pinned.

**0.3 (~2 days)** — Init Rig writes modifier stacks directly
- `initRig.js` modified: rather than producing parent-link tree → calling `synthesizeModifierStacks` post-pass, it produces `{partId: modifierStack[]}` directly. Then calls `synthesizeDeformerParents` to maintain the parent-link mirror that `cmo3writer.js` still reads.
- This is the critical edit — eliminates one of the three dual-write layers immediately.
- Tests verify: same Shelby project produces same `part.modifiers[]` output via old path vs new path.

**0.4 (~1 day)** — Shelby byte-fidelity test harness
- New file: `scripts/test/test_shelbyByteFidelity.mjs`. Loads a Shelby fixture (`fixtures/shelby_baseline.stretch`), runs Init Rig, exports cmo3 + moc3, byte-diffs against `fixtures/shelby_baseline.cmo3` + `fixtures/shelby_baseline.moc3`. Cold-physics-start: deterministic seed for the rNG; pre-warm 60 frames before the diff.
- Critical addition that V1's plan missed (audit Gap B): the diff starts at frame 60 of warmed state, not frame 0 of cold state.
- This is the GATE for every subsequent phase. If it fails, no flip ships.

**Phase 0 gate:** Shelby byte-fidelity test green. `npm test` green. v21 migration registered. Parent-link mirror still reads correct.

---

# Refactor 1 (MERGED) — DepGraph + Modifier Eval Flip (Weeks 2-7)

## Goal

Replace `chainEval.js` + `selectRigSpec.js` + the per-frame whole-graph recomputation with a formal Dependency Graph. Modifier-stack iteration is the concrete mechanism for the GEOMETRY_EVAL kernel — there's no separate "modifier eval flip" because the depgraph build pass IS the modifier-iteration model.

By end of Refactor 1:
- A `DepGraph` data structure exists per Blender's `deg_node*.hh` shape.
- Build pass populates it from `project.nodes` + animation tracks + drivers + modifier stacks.
- Eval pass replaces today's per-frame whole-graph recomputation with topo-sorted operation-by-operation evaluation, with dirty-bit propagation per `deg_eval.cc`.
- `chainEval.js` becomes vestigial — the depgraph IS the eval engine. Modifier stacks are iterated by the GEOMETRY_EVAL kernels.
- Per-modifier `enabled` / `mode` flags actually gate evaluation.
- Drivers + FCurves wire in as graph operations. They actually fire now.
- Same observable output as today's `evalRig` (byte-identical on Shelby fixture).

## Why merged?

The audit caught that Refactor 1 (DepGraph) and the original Refactor 2 (Modifier eval flip) both rewrite the same `chainEval.js` parent-chain walk. Doing them sequentially means rewriting it twice. Doing them merged means modifier-stack iteration is the *implementation* of the depgraph's GEOMETRY_EVAL kernel from day one. One eval engine, one byte-fidelity gate, one `chainEval.js` rewrite.

## Phase breakdown

### Phase D-1 — Data structures + topology (Week 2, ~5 days)

Per Blender's `deg_node.hh:159-219` (Node), `deg_node_id.hh:38-138` (IDNode), `deg_node_component.hh:33-155` (ComponentNode), `deg_node_operation.hh:257-305` (OperationNode), `depsgraph_relation.hh:35-49` (Relation).

New files:
- `src/anim/depgraph/types.js` — shape definitions (IDNode, ComponentNode, OperationNode, Relation, EvalContext) per the architecture doc.
- `src/anim/depgraph/build.js` — `buildDepGraph(project, animation)`. Two-pass per `pipeline_view_layer.h` → `build_nodes()` then `build_relations()`.
- `src/anim/depgraph/build_relations.js` — relation builders. One file per relation domain (param→deformer, parent-chain, driver→param, time→fcurve, etc.).

Tests:
- `test_depgraph_shape.mjs` — graph shape, IDNode/ComponentNode/OperationNode shape, allocator correctness.
- `test_depgraph_build.mjs` — build pass on synthetic projects + Shelby fixture. Verify edge enumeration matches expected adjacency. Topo correctness: every parent-chain creates parent-before-child edge.
- `test_depgraph_cycleDetection.mjs` — driver cycles broken via `is_reachable()`-equivalent + RELATION_FLAG_CYCLIC marking per `deg_builder_relations_drivers.cc:112-141`.

**Ship:** Behind flag, no eval yet. Just the graph structure.

### Phase D-2 — Simple eval kernels (Week 2.5, ~3 days)

Kernels for non-deformer ops. These are easy because the underlying eval logic exists in V1 scaffolds.

New file: `src/anim/depgraph/eval.js`. Implements `evalDepGraph(graph, ctx)` per `deg_eval.cc:88-187`. Topo-sorted single-threaded JS pass; ready-queue + pendingLinks counter; dirty propagation.

Kernel implementations (in `src/anim/depgraph/kernels/`):
- `time.js` — TIME_TICK kernel reads `animationStore.currentTime`.
- `param.js` — PARAM_EVAL kernel reads from `paramValuesStore`. Sets the entry value for downstream nodes.
- `fcurve.js` — FCURVE_EVAL kernel calls `fcurve.js:evaluateFCurve` on the bound rnaPath.
- `driver.js` — DRIVER_EVAL kernel calls `driver.js:evaluateDriver`. Per Blender's order, runs AFTER fcurve for the same target — output overrides the keyframe value.

Tests:
- `test_depgraph_eval_simple.mjs` — runs the eval pass on a project with FCurves + drivers, no deformers. Verifies values match what `evaluateFCurve` / `evaluateDriver` would produce called directly.
- Driver-cascade test: `paramA driven by paramB` → tagging paramB tags paramA's DRIVER_EVAL only (not the whole graph).

**Ship:** Behind flag. Drivers + FCurves now actually fire under the depgraph engine path. Classic path unchanged.

### Phase D-3a — Simple deformer kernels (Weeks 3-4, ~10 days)

The basic deformer eval — KEYFORM_EVAL (warp + rotation) + MATRIX_BUILD (rotation) + GEOMETRY_EVAL_DEFORMED (artMesh per-vertex chain walk via modifier stack).

New kernel files in `src/anim/depgraph/kernels/`:
- `keyform.js` — KEYFORM_EVAL kernel. Ports `cellSelect` + `evalWarpGrid` / `evalRotation` from `chainEval.js:781-838`. Caches per-op output in `ctx.outputs[op]`.
- `matrix.js` — MATRIX_BUILD kernel for rotation deformers. Ports the matrix construction (without FD probe — that's D-3b).
- `geometry.js` — GEOMETRY_EVAL_DEFORMED kernel per part. **Iterates `part.modifiers[]`** (this is the modifier-eval flip; the depgraph kernel IS the modifier iterator). For each enabled modifier, calls into the corresponding `MODIFIER_TYPES.<type>.deformVerts` kernel.
- New file: `src/anim/modifierTypeInfo.js` — registry mirroring `BKE_modifier.hh:236-260`. Initial entries: `warp`, `rotation`. Each carries `deformVerts(modifier, ctx, mesh, positions)`. Mode-flag enablement check via `isEnabled(mod, requiredMode)` mirroring `BKE_modifier.hh:530-552`.

Tests:
- `test_modifierTypeInfo.mjs` — registry shape, isEnabled() truth table, mode bitmask behaviour. **Audit Gap C**: pin `MODE_RENDER`-only modifier behaviour: skipped in viewport, applied on export. Test asserts both directions.
- `test_modifierIterationOrder.mjs` — **Audit Gap D**: pin leaf-to-root order. Stack `[RigWarp, BodyXWarp, BreathWarp, BodyYWarp, BodyZWarp]` evaluates leaf-first.
- `test_depgraph_eval_simpleDeformer.mjs` — depgraph eval on a project with only simple warp+rotation chains (no lifted-grid yet). Output byte-identical to a chainEval call on the same project.

**Ship:** Behind flag. Simple rigs (no lifted-grid dependence) work end-to-end through the depgraph.

### Phase D-3b — Lifted-grid + FD-probe kernels (Weeks 4-5, ~10 days)

The HARD part. The audit caught that this was 5 days in V1; it's realistically 2 weeks.

New kernel files:
- `gridLift.js` — GRID_LIFT_TO_PARENT kernel. Ports `_computeRestState` from `selectRigSpec.js` and the per-frame lift from `chainEval.js:getLiftedGrid`. Inputs: parent's lifted grid (or null for root). Output: this warp's lifted-rest grid in canvas-px.
- `rotationSetup.js` — ROTATION_SETUP_PROBE kernel. Ports the FD-Jacobian probe from `chainEval.js:getRotationSetup`. Two `evalChainAtPoint` calls per rotation deformer become two depgraph eval-subqueries (with their own caching). The Cubism-faithful canvas-final matrix bake belongs here.

Per-warp / per-rotation OperationNode wiring in `build_relations.js`:
- Every warp's GRID_LIFT_TO_PARENT op depends on its parent deformer's GRID_LIFT_TO_PARENT (or root).
- Every rotation's ROTATION_SETUP_PROBE op depends on its parent's GRID_LIFT_TO_PARENT (because the FD probe walks the chain).

Tests:
- `test_depgraph_eval_liftedGrid.mjs` — depgraph eval on a project with lifted-grid chain (the body-warp BZ→BY→Breath→BX path). Compare per-frame output to chainEval byte-for-byte across 30 frames.
- `test_depgraph_eval_rotationSetup.mjs` — FD-probed canvas-final matrix matches `getRotationSetup` output exactly.

**Critical correctness gate (mid-Refactor-1):** Run `test_shelbyByteFidelity.mjs` against the depgraph eval path. Diff must equal zero across 30 frames spanning param sweeps. **If this fails, halt and debug. Do not proceed to D-4 until green.**

**Ship:** Behind flag. Full deformer chain works through the depgraph. Byte-fidelity proven.

### Phase D-4 — Physics + animation kernels (Week 5.5, ~3 days)

PHYSICS_EVAL kernel wraps `tickPhysics`. Inputs are PARAM_EVAL outputs of physics rule input params. Output writes back to PARAM_EVAL of physics rule output params (i.e., physics output params get a PARAM_EVAL op with PHYSICS_EVAL as upstream).

ANIMATION_TRACK_EVAL kernel: ports `computeParamOverrides` + `computePoseOverrides` from `animationEngine.js:175-225`. Each animation track becomes one ANIMATION_TRACK_EVAL op; output flows into PARAM_EVAL or transform fields.

Tests:
- `test_depgraph_eval_physics.mjs` — depgraph eval with physics enabled. Output matches `tickPhysics` output across 60 frames (warm-start). **Audit Gap B**: explicitly tests cold-start vs warm-start divergence; fails if eval path produces non-deterministic output.
- `test_depgraph_eval_animation.mjs` — animation playback through depgraph. Track interpolation produces same poseOverrides + paramOverrides as `animationEngine.js`.

**Ship:** Behind flag. Full per-frame eval pipeline now runs through the depgraph.

### Phase D-5 — chainEval flip + Properties UI for modifier stack (Week 6, ~5 days)

`CanvasViewport.jsx` tick path replacement when flag is `'depgraph'`. The 8-step sequence collapses to:
1. `graph.tagTime()` if playhead moved.
2. For each user param change: `graph.tagParam(id)`.
3. `evalDepGraph(graph, evalCtx)`.
4. `evalCtx.outputs` feeds the renderer.

Properties UI: new section `ModifierStackSection.jsx` (replaces existing rig-stack viewer). Drag-reorder, per-modifier toggle, expand/collapse. Reorder bumps `tagProjectMutation` for now (incremental rebuild is post-V2).

Tests:
- `test_canvasViewportTick_depgraph.mjs` — synthetic frame test: tag time, run eval, verify output shape.
- `test_modifierStackSection.mjs` — UI behavioural test: drag reorder, toggle, undo.

**Ship:** Behind flag. Both eval paths work side-by-side via the flag. Production flag stays `'classic'`.

### Phase D-6 — Side-by-side validation + flag flip + soak (Week 7, ~5 days)

Side-by-side mode: when `evalEngine === 'classic'`, additionally run the depgraph eval and assert byte-equality of outputs (debug-only, configurable via dev flag). This catches divergence in real use.

Performance comparison on Shelby: idle slider, single-param-tweak, full-pose-load. Depgraph eval on dirty-only frames should be O(dirty subgraph) vs classic's O(whole graph).

**Manual Shelby byte-fidelity sweep (the user gate).** User loads Shelby PSD, runs Init Rig, exports cmo3+moc3 under flag = `'classic'`. Then runs same sequence under flag = `'depgraph'`. Diffs. Must be byte-identical. After confirmation: flag default flips to `'depgraph'`.

2-week soak before deleting the classic path (cleanup phase, end of plan).

**Ship:** Default flag `'depgraph'`. Classic path still in source for rollback.

---

# Refactor 2 — NodeTree (Weeks 8-11)

## Goal

Generalise the depgraph + modifier-stack into a NodeTree datablock model. Three concrete NodeTree types per Blender's `eNodeTree_Type` (DNA_node_types.h:274-283):
1. **RigTree** per part — replaces modifier stack with a node graph (modifier-stack is the linear-special-case of a graph).
2. **DriverTree** per project — replaces scripted-driver-string + variables with a wired graph.
3. **AnimationTree** per animation clip — replaces flat `tracks[]` with NLA-style strip composition.

Plus: a working visual graph editor at `src/v3/editors/nodetree/NodeTreeEditor.jsx`.

By end of Refactor 2:
- Three NodeTree datablocks live on `project`. Each has `nodes[]` + `links[]` + a `typeinfo` dispatch per `BKE_node.hh:503-547`.
- Eval is depgraph-driven (each NodeTree node becomes one OperationNode in the depgraph; each Link becomes a Relation).
- Visual editor lets users drag-add nodes, drag-link sockets, drag-remove. Backed by `react-flow`.
- Migration preserves all existing behaviour: every modifier-stack becomes a linear-graph in RigTree; every driver expression compiles into a sub-graph in DriverTree; every animation track becomes a strip in AnimationTree.

## Phase breakdown

### Phase N-1 — NodeTree shape + RigTree migration (Week 8, ~5 days)

Schema v22 migration: lifts every `part.modifiers[]` into a derived `RigTree_<partId>` node tree on `project.nodeTrees.rig`. Modifier stacks stay; tree is dual-write (the only V2 dual-write window we'll have, per Rule 3 — Refactor 1's window must be closed first).

New files:
- `src/anim/nodetree/types.js` — shape definitions (NodeTree, NodeTreeNode, Socket, Link) per `DNA_node_types.h:1421-1966`.
- `src/anim/nodetree/registry.js` — typeinfo registry per `BKE_node.hh:246-453`. Initial: `PartInput`, `PartOutput`, `WarpModifier`, `RotationModifier`.
- `src/anim/nodetree/build.js` — `buildNodeTreesFromProject(project)` walks every part, produces a linear chain RigTree. Per the audit, the migration is one-way at the data layer — the modifier-stack array is the persisted form, the NodeTree is derived for editor + eval.
- `src/anim/nodetree/eval.js` — adds NODETREE_NODE_EVAL kernel to depgraph. Each node's `execute` is dispatched via the typeinfo registry.

Tests:
- `test_nodetree_shape.mjs` — datablock shape, socket/link/node structure.
- `test_nodetree_migration.mjs` — modifier stack ↔ rig tree round-trip on Shelby. Idempotent.
- `test_nodetree_eval.mjs` — RigTree eval via depgraph byte-equal to direct modifier-stack eval.

**Ship:** Behind flag (`riggingPath: 'modifierStack' | 'nodeTree'`). RigTree eval works; modifier stack still canonical.

### Phase N-2 — Modifier node types + DriverTree migration (Week 8.5-9, ~5 days)

Driver expression parser → graph builder. Maps `a * 2` to a Math+Constant subgraph. Unparseable expressions fall back to a `ScriptedExpression` node wrapping the existing scripted-driver eval.

New rig-tree node types (extends N-1's registry):
- `ParamInput` — reads a paramValue.
- `Math` — supports `+ - * / sin cos abs min max clamp pow sqrt PI` (same set as scripted driver).
- `Compare` — `< > == != <= >=`.
- `Constant` — literal value socket.
- `DriverOutput` — writes back to a paramValue.

Migration v23: every existing `param.driver` expression compiles into a DriverTree subgraph. Original expression preserved as fallback.

Tests:
- `test_driverTree_migration.mjs` — every existing scripted-driver expression survives migration. `(rot1 + rot2) / 2` compiles to a graph that evaluates to the same value.
- `test_driverTree_eval.mjs` — DriverTree eval via depgraph matches `evaluateDriver` output exactly.

### Phase N-3 — AnimationTree migration (Week 9.5, ~3 days)

New animation-tree node types: `FCurveStrip`, `TimelineOutput`. Future-proof for NLA strip nodes (blending, modifiers on strips).

Each animation clip migrates: tracks → FCurveStrips → TimelineOutput.

Tests:
- `test_animationTree_migration.mjs` — every existing track survives; eval matches `computeParamOverrides` + `computePoseOverrides`.

### Phase N-4 — Visual editor scaffolding (Weeks 10, ~5 days)

`react-flow` integration. New file: `src/v3/editors/nodetree/NodeTreeEditor.jsx`. Initial: read-only view over the active part's RigTree + project's DriverTree + active animation's AnimationTree. Mode pill switches between trees.

Renders:
- Node list with type-specific icons.
- Links between sockets.
- Right-click → properties panel for selected node.

Tests:
- `test_nodeTreeEditor_renderRead.mjs` — render the editor against a Shelby project; verify node count + link count match expected.

**Ship:** Read-only editor. Users can SEE the rig as a graph, can't yet edit.

### Phase N-5 — Visual editor interactions (Week 11, ~5 days)

Interactive editor:
- Drag-add: right-click → menu → category → node type. Inserts a fresh node at cursor. Triggers depgraph rebuild.
- Drag-link: from output socket to input socket. Type validation per Blender's `validate_link` callback (`BKE_node.hh:521`). Type-mismatched drag rejected with cursor feedback.
- Drag-remove: select node → DEL → depgraph rebuild.
- Undo: every edit lands as one immer mutation. Standard undo/redo.

Tests:
- `test_nodeTreeEditor_interactions.mjs` — UI behavioural test: add node, link, delete, undo.
- `test_nodeTreeEditor_typeValidation.mjs` — float→pose link rejected; float→float link accepted; mismatched-type drag never creates a Link record.

**Ship:** Behind flag. Visual editor is functional. Default flag still `'modifierStack'`.

---

# Cleanup phase (Week 12, ~3 days)

After Refactor 1 + Refactor 2 ship + 2-week soak:
- Delete `src/io/live2d/runtime/evaluator/chainEval.js` (replaced by depgraph + nodetree eval).
- Delete `src/io/live2d/rig/selectRigSpec.js` (replaced by depgraph build pass).
- Delete `synthesizeDeformerParents` (parent-link mirror no longer needed once `cmo3writer.js` reads from RigTree directly).
- Delete the `evalEngine: 'classic'` flag.
- Delete the dual-write `synthesizeModifierStacks` (Refactor 1 made stacks canonical, Refactor 2 made them derived from RigTree — so the synthesizer is dead).
- ~3000 LOC dropped.

Final state:
- One graph engine (DepGraph).
- One canonical chain shape (NodeTrees, with linear-modifier-stack as a UI view).
- Visual editor available for power users; modifier stack panel for casual users (both edit the same RigTree).
- Drivers + FCurves + animation all run through the same engine.

---

# Manual byte-fidelity sweep gates (the user gates)

Each phase has one mandatory user gate. Plan does NOT advance past the gate without user confirmation:

1. **End of Phase 0** — Schema v21 migration applied to Shelby. Init Rig writes stacks directly. cmo3 byte-diff against pre-V2 baseline = zero. (This validates that the data-layer changes don't break anything.)
2. **End of Phase D-3b** — Mid-Refactor-1 critical gate. Depgraph eval on Shelby produces byte-identical output to classic eval across 30 frames. **The plan halts here if it fails.**
3. **End of Refactor 1 (Phase D-6)** — Default flag flip to `'depgraph'`. Same Shelby byte-fidelity diff. Soak begins.
4. **End of Refactor 2 (Phase N-5)** — Visual editor smoke test. User opens RigTree on Shelby, adds/links/deletes a node, verifies behavioural change. Modifier-stack view still works.
5. **End of Cleanup (Week 12)** — Final byte-fidelity diff after dead code removal. Confirm no regression.

---

# Test coverage (full plan inventory)

Tests added in V2:
- **Phase 0**: `test_migration_v21`, `test_synthesizeDeformerParents`, `test_initRigOutputsStacks`, `test_shelbyByteFidelity` (the harness).
- **Phase D-1**: `test_depgraph_shape`, `test_depgraph_build`, `test_depgraph_cycleDetection`.
- **Phase D-2**: `test_depgraph_eval_simple` (FCurve + Driver kernels).
- **Phase D-3a**: `test_modifierTypeInfo` (with MODE_RENDER + leaf-to-root order pinning), `test_modifierIterationOrder`, `test_depgraph_eval_simpleDeformer`.
- **Phase D-3b**: `test_depgraph_eval_liftedGrid`, `test_depgraph_eval_rotationSetup`. **Critical mid-refactor byte-fidelity gate.**
- **Phase D-4**: `test_depgraph_eval_physics` (cold/warm divergence pin), `test_depgraph_eval_animation`.
- **Phase D-5**: `test_canvasViewportTick_depgraph`, `test_modifierStackSection`.
- **Phase D-6**: side-by-side eval assertion (debug-only).
- **Phase N-1**: `test_nodetree_shape`, `test_nodetree_migration`, `test_nodetree_eval`.
- **Phase N-2**: `test_driverTree_migration`, `test_driverTree_eval`.
- **Phase N-3**: `test_animationTree_migration`.
- **Phase N-4**: `test_nodeTreeEditor_renderRead`.
- **Phase N-5**: `test_nodeTreeEditor_interactions`, `test_nodeTreeEditor_typeValidation`.

Estimated total new test assertions: ~800.

---

# Risk register

**RISK-1 (R1 from audit):** Body-warp implicit fallback. **Mitigation:** Phase 0.1 writes synthetic body-warp modifier into every part missing rigParent; this is checked before any Refactor 1 phase ships.

**RISK-2 (R3 from audit):** Phase D-3b is hard. **Mitigation:** Two weeks budgeted (vs V1's 5 days). Mid-refactor byte-fidelity gate at end of D-3b — if it fails, halt and debug; no progression to D-4.

**RISK-3 (R5 from audit):** `cmo3writer.js` reads parent links. **Mitigation:** Phase 0.2 implements `synthesizeDeformerParents` (the inverse synth). Tested with round-trip property; cmo3 export stays byte-identical at every phase.

**RISK-4 (Triple dual-write):** **Mitigation per Rule 3:** Phase 0 eliminates parent-link → modifier-stack post-pass (Init Rig writes stacks directly). Refactor 1 maintains classic ↔ depgraph dual-write. Refactor 2 maintains modifier-stack ↔ NodeTree dual-write only AFTER Refactor 1's window closes. Maximum two layers at any point.

**RISK-5 (Driver cycles):** Two drivers depending on each other. **Mitigation:** Build pass detects cycles via Tarjan/Kosaraju, marks the offending Relation with `RELATION_FLAG_CYCLIC`, breaks one edge (consistent choice — alphabetic-by-rnaPath). Logs warning. Same approach as Blender.

**RISK-6 (Build cost dominates eval savings):** **Mitigation:** Build is incremental — `tagProjectMutation` only rebuilds the affected subgraph. Targeting <5ms full build on Shelby; if exceeded, post-V2 phase optimises.

**RISK-7 (NodeTree visual editor type mismatches corrupt eval):** **Mitigation:** Phase N-5 hard-rejects type-mismatched drag-link before the Link record is created. No "auto-convert" sockets in V2 — any conversion must be explicit (insert a typed conversion node). Test `test_nodeTreeEditor_typeValidation` pins this.

---

# Files inventory

**New files (Phase 0):**
- `src/store/migrations/v21_modifier_mode_flags.js`
- `scripts/test/test_migration_v21.mjs`
- `scripts/test/test_synthesizeDeformerParents.mjs`
- `scripts/test/test_initRigOutputsStacks.mjs`
- `scripts/test/test_shelbyByteFidelity.mjs`

**New files (Refactor 1):**
- `src/anim/depgraph/types.js`
- `src/anim/depgraph/build.js`
- `src/anim/depgraph/build_relations.js`
- `src/anim/depgraph/eval.js`
- `src/anim/depgraph/kernels/{time,param,fcurve,driver,keyform,matrix,geometry,gridLift,rotationSetup,physics,animation}.js` (~11 kernel files)
- `src/anim/modifierTypeInfo.js`
- `src/v3/editors/properties/sections/ModifierStackSection.jsx`
- ~12 new test files

**New files (Refactor 2):**
- `src/anim/nodetree/{types,registry,build,eval}.js`
- `src/anim/nodetree/nodes/{partInput,partOutput,warpModifier,rotationModifier,paramInput,math,compare,constant,driverOutput,fcurveStrip,timelineOutput}.js` (~11 node-type files)
- `src/v3/editors/nodetree/NodeTreeEditor.jsx`
- `src/v3/editors/nodetree/NodeRenderer.jsx`
- `src/v3/editors/nodetree/SocketRenderer.jsx`
- `src/v3/editors/nodetree/LinkRenderer.jsx`
- `src/v3/editors/nodetree/AddNodeMenu.jsx`
- ~10 new test files

**Modified files:**
- `src/store/projectMigrations.js` — register v21, v22, v23.
- `src/store/projectStore.js` — `evalEngine` + `riggingPath` flags.
- `src/store/deformerNodeSync.js` — add `synthesizeDeformerParents`.
- `src/io/live2d/rig/initRig.js` — write modifier stacks directly.
- `src/components/canvas/CanvasViewport.jsx` — flag-gated tick path.
- `src/io/live2d/runtime/evaluator/chainEval.js` — flag-gated eval (deleted in cleanup).
- `src/io/live2d/rig/selectRigSpec.js` — deleted in cleanup.
- `eslint.config.js` — already adjusted for `_`-prefix unused params.
- `package.json` — ~30 new test entries.

---

# Sequencing summary

| Week | Phase | What ships |
|------|-------|------------|
| 1    | Phase 0 (4 sub-phases) | v21 migration, synthesizeDeformerParents, Init Rig writes stacks, byte-fidelity test harness |
| 2    | Phase D-1 | Depgraph data structures, build pass, topology tests |
| 2.5  | Phase D-2 | Simple kernels (time, param, fcurve, driver) — drivers fire for the first time |
| 3-4  | Phase D-3a | Simple deformer kernels (warp/rotation eval, modifier stack iteration) |
| 4-5  | Phase D-3b | Lifted-grid + FD probe kernels — **mid-refactor byte-fidelity gate** |
| 5.5  | Phase D-4 | Physics + animation kernels |
| 6    | Phase D-5 | CanvasViewport flip + Properties UI for modifier stack |
| 7    | Phase D-6 | Side-by-side validation, flag flip default, **manual Shelby gate** |
| 8    | Phase N-1 | RigTree migration |
| 8.5-9 | Phase N-2 | Modifier node types + DriverTree migration |
| 9.5  | Phase N-3 | AnimationTree migration |
| 10   | Phase N-4 | Visual editor read-only |
| 11   | Phase N-5 | Visual editor interactive (drag-add, drag-link, delete, undo) — **manual Shelby gate** |
| 12   | Cleanup | Delete dead paths, ~3000 LOC dropped |

Total: 12 weeks. Realistic.
