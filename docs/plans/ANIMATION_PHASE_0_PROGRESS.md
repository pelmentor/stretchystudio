# Animation Phase 0 — Progress Log

Started: 2026-05-09
Plan: [ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md)
Goal: wire already-shipped scaffolds (FCurve / Driver / RNAPath /
Constraints / DepGraph) into the production hot path.

## Resume entry point (handoff for next session)

Phase 0 is **COMPLETE.** All 6 sub-phases shipped + the armature-port
gate closed (0.0/0.A/0.B/0.C/0.D.0/0.D armature), and the dual-engine
opt-out itself was **removed in the Phase 7 close-out (2026-05-20)**.

**Original 0.D flip plan (now superseded).** The plan was: run a
user-side manual byte-fidelity sweep (toggle `evalEngine='depgraph'`,
load Shelby + test_image4, byte-diff `.cmo3` exports against the
`'classic'` baseline), then flip the default and keep `'classic'` for
one release. The user instead waived the gate on 2026-05-20 ("no
migration baggage, so remove classic") and the entire `'classic'`
opt-out was removed wholesale — `evalProjectFrameViaDepgraph` is now
the sole viewport eval path. The `.cmo3` export pipeline never
consumed depgraph outputs (it builds from rigSpec/project data, not
runtime eval frames — see Phase 1.B.1), so export byte-fidelity is
unaffected by the removal.

After 0.D, **Phase 1 is the next ~1.5-week chunk** — Action datablock
+ NodeTree retirement + 11-consumer migration of `project.animations[]`.
See [ANIMATION_BLENDER_PARITY_PLAN.md §Phase 1](./ANIMATION_BLENDER_PARITY_PLAN.md)
(line 419+). Entry point: grep `\bproject\.animations\b` to seed the
consumer list, then write `migrations/v33_action_datablock.js`.

---

## Sub-phase status

| Sub | What | Status |
|-----|------|--------|
| 0.0 | Declare ms canonical time unit | ✅ SHIPPED |
| 0.A | gridLift RigWarp_* coordinate-frame fix | ✅ SHIPPED (2026-05-10) |
| 0.B | Wire `evaluateProjectDrivers` into CanvasViewport tick (param drivers) | ✅ SHIPPED |
| 0.C | Wire `evaluateConstraints` into pose composition | ✅ SHIPPED (2026-05-10) |
| 0.D.0 | Wire depgraph into CanvasViewport rAF callback | ✅ SHIPPED (2026-05-10) |
| 0.D armature | Bone post-chain LBS / overlay inside `kernelArtMeshEval` | ✅ SHIPPED (2026-05-10) |
| 0.D flip | Flip `evalEngine` default to `depgraph` | ✅ SUPERSEDED 2026-05-20 — the `'classic'` opt-out was removed wholesale in the Phase 7 close-out (user waived the manual byte-fidelity gate per Rule №2); `evalProjectFrameViaDepgraph` is now the sole viewport eval path. |

## 0.0 — Canonical time unit (SHIPPED)

Memory entry written:
[`feedback_ms_canonical_animation_time.md`](../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/feedback_ms_canonical_animation_time.md).
Indexed in MEMORY.md.

**Declaration:** ms is canonical throughout the eval substrate. Seconds
appear at exactly two boundaries:
- motion3.json export/import (single conversion line per direction)
- physics tick `dtSeconds = dtMs / 1000` (matches Cubism kernel
  byte-for-byte)

The Phase 5 scaffold's seconds-shaped `FCurve.keyforms[].time` field
will be converted to ms in Phase 1's v33 migration. The depgraph's
`EvalContext.time` field will be renamed `timeMs` and rebased in
Phase 0.D.0.

## 0.B — Driver pass wired (SHIPPED)

[CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)
imports `evaluateProjectDrivers` + `driverOverridesToParamMap` from
[src/anim/driverPass.js](../../src/anim/driverPass.js). The tick now
runs:

```
1. valuesForEval = paramValuesRef (slider state)
2. (animation mode) merge computeParamOverrides → valuesForEval
3. NEW: driverOverrides = evaluateProjectDrivers(project, {currentValues: valuesForEval})
        merge param-driver outputs → valuesForEval
4. (livePreview) breath / blink / cursor overlays
5. physics tick
6. evalRig(rigSpec, valuesForEval)
```

Tests passing: animationEngine (57), animationStore (55), constraints
(39), anim (64), animFCurveBridge (29), initRig (60),
projectRoundTrip (41), chainEval (25).

**Phase 0 scope:** only param drivers reach the eval substrate. The
`driverOverridesToParamMap` projection extracts paths matching
`objects['__params__'].values['<id>']` and merges them. Transform
drivers (which would mutate `node.transform.<field>` per-frame) are
deferred to Phase 0.D.0 because the classic engine's per-tick
`proj.nodes` reads happen in multiple call sites; centralised
eval-graph wiring is cleaner than shotgunning every consumer.

**Driver evaluation order:** AFTER animation overrides, BEFORE live
preview drivers. Rationale: most Phase 1 driver use cases are
param→param relationships (e.g. `ParamHairFront ← ParamFaceY`), or
transform→transform (`Hair.rotation ← Body.rotation`); these don't
depend on breath/blink/cursor. Drivers that DO depend on physics or
live-preview values will resolve correctly only after the depgraph
default-flip in 0.D.0 (depgraph evaluates everything in topological
order).

## 0.A — gridLift fix SHIPPED (2026-05-10)

The V2 close-out doc
([BLENDER_PARITY_V2_SHIPPED.md](./BLENDER_PARITY_V2_SHIPPED.md):92-94)
documented: *"per-part `RigWarp_*` lifted grids diverged by ~`canvasW/2`
— pivot-relative vs TL-origin coordinate-frame mismatch in
`kernels/gridLift.js`"*.

**Root cause found** (not in `kernels/gridLift.js` — the kernel math
was correct). The defect was a missing build-time relation in
[`src/anim/depgraph/build.js`](../../src/anim/depgraph/build.js):
when a warp's parent was a rotation deformer, `buildDeformerChainRelations`
added no edge from the parent's `MATRIX_BUILD` to the child's
`GRID_LIFT_TO_PARENT`. Topological order was therefore free to evaluate
the child lift BEFORE the parent matrix; the kernel called
`findOpForDeformer(ctx, curId, MATRIX_BUILD)` and found nothing
(`ctx.outputs.has(...)` returns `false` until the matrix actually runs);
the loop broke and returned the unmodified pivot-relative grid.

For `Rotation_face` at canvas pivot (400, 300), that produced lifted
grid coordinates centred at (0, 0) in pivot-relative frame instead of
(400, 300) in canvas-px — exactly the ~`canvasW/2` divergence the V2
doc reported.

**Fix.** The warp branch of `buildDeformerChainRelations` now mirrors
the kernel's eval-time chain walk at build time: it follows
`def.parent` through the project-node parent strings, adding a
relation for every ancestor's `MATRIX_BUILD` (rotation) or
`GRID_LIFT_TO_PARENT` (warp), and breaks at the first warp ancestor or
root. Conservative against `isCanvasFinal` (unknown at build time):
the extra edges constrain topological order without changing
correctness.

Pinned by [`scripts/test/test_depgraphSideBySide_rotationParent.mjs`](../../scripts/test/test_depgraphSideBySide_rotationParent.mjs)
— exercises single-rotation-parent (rest + 30° rotated) and a dual-
rotation chain. All three cases now report `identical: true` from
`runSideBySide`. The matrix-collection stub in
[`src/anim/depgraph/sideBySide.js`](../../src/anim/depgraph/sideBySide.js)
was also closed in the same change (was a no-op map causing every
matrix diff to surface as `maxAbsDelta=Infinity`).

**Investigation summary** (kept for posterity):

The depgraph's `kernelGridLiftToParent`
([src/anim/depgraph/kernels/gridLift.js](../../src/anim/depgraph/kernels/gridLift.js):108-122)
walks the parent chain identically to chainEval's
`_computeLiftedGrid`
([src/io/live2d/runtime/evaluator/chainEval.js](../../src/io/live2d/runtime/evaluator/chainEval.js):601-702):

1. KEYFORM_EVAL produces a per-frame grid in deformer-local frame.
2. For each rotation parent, multiply the matrix at every grid point.
3. For warp parent, bilinear-warp through the parent's lifted grid.
4. Break on canvas-final rotation or on warp parent.

The matrix kernel
([src/anim/depgraph/kernels/matrix.js](../../src/anim/depgraph/kernels/matrix.js))
builds `M = T(originX, originY) · R(angle) · S(scale)` for both legacy
and canvas-final paths — same shape as chainEval. `applyMat3ToPoint`
maps `(x, y) → (R*S*p + (originX, originY))`.

For a chain `RigWarp → rot → root`, where the RigWarp's grid is in
rotation-pivot-relative frame:
- Step 1 (cur=rot): `M_rot · point = R*point + (origin_rot)` →
  canvas-px (matches chainEval).
- Done — break (rot is canvas-final since parent=root).

For a deeper chain `RigWarp → rot1 → rot2 → root`:
- Step 1 (cur=rot1): `M_rot1 · point = R1*point + origin_rot1`.
- Step 2 (cur=rot2): `M_rot2 · prev = R2*(R1*point + origin_rot1) + origin_rot2`.

This is mathematically correct: rotates the inter-pivot vector by
parent's rotation. At rest (all angles=0), reduces to `point +
origin_rot1 + origin_rot2`, matching `_computeRotationCanvasPivotAtRest`'s
additive chain.

**Where could the divergence come from?**

1. **MATRIX_BUILD's `setupOp` lookup**: when ROTATION_SETUP_PROBE has
   not produced a `canvasFinalPivot`, `buildLocalMat3` uses local
   origin. The probe DOES run for every rotation that has a non-root
   parent. For a top-level rotation (parent=root), no probe runs and
   `buildLocalMat3` uses `originX/originY` which IS the canvas-px
   pivot. Looks correct.

2. **chainEval per-part chain (`getLiftedGridForChain`)**: the depgraph
   has only one `kernelGridLiftToParent` per deformer, walking the
   GLOBAL parent chain. chainEval also exposes per-part chain composition
   for warps with modifier-stack-disabled ancestors
   ([selectRigSpec.js](../../src/io/live2d/rig/selectRigSpec.js):721+).
   The depgraph doesn't emit per-part GRID_LIFT_TO_PARENT ops for
   different chain prefixes — the side-by-side test would surface this
   only if a project had middle-disabled modifiers.

3. **The `originX/originY` semantics for nested rotations**: when
   rot1's parent is rot2, what does `originX` mean? It's the position
   in rot2's local frame (canvas-px offset from rot2's pivot). The
   matrix multiplication at step 2 above adds this to `R2·R1·point`,
   which is the right composition.

**The bug is plausibly NOT in the rotation chain math** based on this
read pass. Possibilities:

- The bug is in **how RigWarp_* nodes' parents resolve** during depgraph
  build vs. selectRigSpec's per-part stack — i.e. the kernel walks the
  wrong chain because RigWarp_*'s `def.parent` is the part's
  outer-most modifier, but the per-part chain context is different.
- The bug is in **per-part KEYFORM_EVAL output frame**: maybe the
  RigWarp_*'s grid arrives in canvas-px rather than pivot-relative
  for some specific shape.

**Next step (when 0.A is taken up):** build a side-by-side fixture
that covers per-part RigWarp_* with rotation-deformer parent + verify
each step's intermediate outputs. The existing `sideBySide.js` test
covers warp-warp chains and root-warp; doesn't cover the per-part
`RigWarp_*` shape that triggers the divergence.

Fixture coverage must include **both** user test PSDs (per
[feedback_test_character_is_shelby.md](../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/feedback_test_character_is_shelby.md)):
- `shelby_neutral_ok.psd` (Western topology, regression baseline)
- `test_image4.psd` (anime topology — historically exposed bugs
  Western fixture missed, e.g. BUG-025 leg-roles fly)

Estimated effort: 1–3 days once both fixtures are wired into a
test harness.

## 0.C — Constraint wire-up SHIPPED (2026-05-10)

`TRANSFORM_COMPOSE` op landed: per-Object kernel
([src/anim/depgraph/kernels/transformCompose.js](../../src/anim/depgraph/kernels/transformCompose.js))
runs `evaluateConstraints` against the owner's authored transform/pose
and emits the composed `{x, y, rotation, scaleX, scaleY}`. Build pass
adds target-first relations so chained constraints (A→B→C) resolve in
the correct order.

12 tests pin the kernel: passthrough, COPY_LOCATION, three-deep chain
(C→B→A), LIMIT_ROTATION clamp, disabled-constraint passthrough.

**Production consumers (`renderer/boneOverlayMatrix.js`,
`renderer/boneSkinning.js`, `selectRigSpec.js`) still read
`node.pose` / `node.transform` directly.** Phase 0.D's flag flip is
when the production tick reads from `TRANSFORM_COMPOSE` instead. Until
then, the kernel runs in the depgraph but doesn't affect rendering.

## 0.D.0 — Production wire-in SHIPPED (2026-05-10)

Three pieces landed:

1. **`ART_MESH_EVAL` kernel**
   ([src/anim/depgraph/kernels/artMesh.js](../../src/anim/depgraph/kernels/artMesh.js)).
   Ports `chainEval.evalArtMeshFrame`: cellSelect on
   `mesh.runtime.bindings`, blend `runtime.keyforms[].vertexPositions`,
   walk `part.modifiers[]` reading `GRID_LIFT_TO_PARENT` /
   `MATRIX_BUILD` / `KEYFORM_EVAL` outputs. Emits
   `{id, vertexPositions, opacity, drawOrder}` matching `evalRig`'s
   `ArtMeshFrame`.
2. **`evalProjectFrameViaDepgraph` helper**
   ([src/anim/depgraph/evalProjectFrame.js](../../src/anim/depgraph/evalProjectFrame.js)).
   Drop-in for `evalRig`. Builds the depgraph, evaluates with
   paramOverrides seeded from the caller's `paramValues`, collects
   every part's `ART_MESH_EVAL` output into the `ArtMeshFrame[]` array.
3. **CanvasViewport branch**
   ([src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)).
   Reads `usePreferencesStore.getState().evalEngine` per tick; when
   `'depgraph'`, calls `evalProjectFrameViaDepgraph(projectRef.current,
   valuesForEval)` instead of `evalRig(...)`. Both paths produce the
   same `ArtMeshFrame` shape so the rest of the tick is engine-agnostic.

13 parity tests
([scripts/test/test_depgraph_eval_artMesh.mjs](../../scripts/test/test_depgraph_eval_artMesh.mjs))
pin `evalProjectFrameViaDepgraph` against `evalRig`: root-only,
single-rotation parent, parameter-driven keyform blend at three values
(0, 0.5, 1). All pass at <1e-4 px delta.

## 0.D armature port — bone post-chain inside ART_MESH_EVAL (SHIPPED 2026-05-10)

Closes one of the two prerequisites for the 0.D default-flip. The
depgraph engine now applies bone post-chain composition (LBS + rigid
overlay) inside [`kernelArtMeshEval`](../../src/anim/depgraph/kernels/artMesh.js)
using bone WORLD matrices composed from `TRANSFORM_COMPOSE` outputs,
mirroring the renderer's pre-Phase-0.D post-loop. Constraint-composed
pose feeds skinning — Blender's depsgraph order: solve constraints
then armature deform.

**Three pieces:**

1. **`bonePostChain.js`** ([src/anim/depgraph/kernels/bonePostChain.js](../../src/anim/depgraph/kernels/bonePostChain.js))
   — extract bone WORLD from the depgraph's TRANSFORM_COMPOSE outputs,
   walk the bone parent chain (skipping non-bone visual folders),
   apply two-bone LBS or rigid overlay in place. Memoises bone WORLD
   matrices per-eval on `ctx._artMeshBoneWorldCache` so chains shared
   between sibling parts walk the bone hierarchy once. Decision logic
   reuses `pickBonePostChainComposition` so LBS / overlay / none gate
   identically to the renderer.

2. **`kernelArtMeshEval` extension**
   ([src/anim/depgraph/kernels/artMesh.js](../../src/anim/depgraph/kernels/artMesh.js)).
   After the modifier-chain walk, the kernel calls
   `applyBonePostChainSkin(part, mesh, bufA, ctx, byId, cache)`. The
   armature-modifier branch in the modifier loop stays a no-op so the
   chain keeps walking past it; skinning runs once on the final
   buffer.

3. **Build relations**
   ([src/anim/depgraph/build.js](../../src/anim/depgraph/build.js)
   `buildPartModifierRelations`). Every relevant bone's
   `TRANSFORM_COMPOSE` op gets an edge into the part's `ART_MESH_EVAL`.
   "Relevant" = the project-tree bone-group ancestor chain plus, for
   parts with an Armature modifier, the modifier's `data.jointBoneId`
   chain + `data.parentBoneId`.

**CanvasViewport gating.**
[CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)
now gates the post-loop `applyTwoBoneSkinningObj` /
`applyOverlayMatrixObj` on `_evalEngine !== 'depgraph'`. Classic
emits PRE-skin verts and still needs the post-loop; depgraph emits
POST-skin verts because the kernel did the work. Same `ArtMeshFrame[]`
shape so downstream rendering stays engine-agnostic.

**Tests pinned.**
[scripts/test/test_depgraph_armature.mjs](../../scripts/test/test_depgraph_armature.mjs)
covers five cases:
- Single bone, weight=1.0 (rigid follow via LBS).
- Single bone, weight=0.0 (parent fallback — top-level bone → identity →
  verts at rest).
- Two-bone elbow chain with mixed weights (0 / 0.33 / 0.66 / 1).
- Overlay rigid-follow path (no Armature modifier, no boneWeights, has
  bone-group ancestor).
- LIMIT_ROTATION constraint clamps pose pre-skin (depgraph diverges
  from unclamped, matches hand-built clamped reference).

All five compare byte-equal (<1e-4 px delta) against
`evalRig + applyClassicPostSkin`. 9 assertions, all green.

## 0.C — Constraint wire-up analysis (HISTORICAL)

[src/anim/constraints.js](../../src/anim/constraints.js) ships four
constraint types (COPY_LOCATION, COPY_ROTATION, LIMIT_ROTATION,
TRACK_TO) operating on Object transforms `{x, y, rotation, scaleX,
scaleY}`. Unit-tested (39 tests passing).

The plan §0.C says wire into `kernels/matrix.js` `MATRIX_BUILD`. But
that kernel builds **rotation deformer** matrices, not Object
transforms — different scope. The proper wire-in is the Object
transform composition path:

- `boneOverlayMatrix.js` reads `node.pose` per-part for bone-driven
  parts.
- `boneSkinning.js` consumes pose for LBS.
- `selectRigSpec` reads `node.transform` for non-bone Objects.

**Decision:** defer 0.C. Constraints write to Object transforms and
need a single canonical pose-composition pipeline that doesn't exist
in the classic engine. The clean architecture is:

- Add a depgraph TRANSFORM_COMPOSE op per Object that runs
  `evaluateConstraints` after pose composition.
- Wire it as a dependency of MATRIX_BUILD (for deformers) and the
  bone-overlay path (for parts).

This is depgraph-only architecture and aligns with Phase 0.D.0
(depgraph default flip). Constraints land **in the same change** as
0.D.0, not before.

The constraints.js module stays untouched (already correct, already
tested). No production-side change in this Phase 0 deliverable.

## What's shipping vs. what's pending

**Shipped:**
- 0.0 — ms canonical declaration (memory entry)
- 0.B — driver pass wired into CanvasViewport tick
- 0.A — gridLift / depgraph build-relation fix (2026-05-10)
- 0.C — TRANSFORM_COMPOSE op for constraint composition (2026-05-10)
- 0.D.0 — ART_MESH_EVAL kernel + evalProjectFrameViaDepgraph helper + CanvasViewport branch on `preferencesStore.evalEngine` (2026-05-10)
- 0.D armature — bone post-chain LBS / overlay inside `kernelArtMeshEval`, fed by TRANSFORM_COMPOSE; CanvasViewport post-loop gates skinning on engine (2026-05-10)

**Pending:**
- 0.D flip — flip `preferencesStore.evalEngine` default from `'classic'`
  to `'depgraph'`. One prerequisite remains:
  - **Manual byte-fidelity sweep.** Run both engines side-by-side on
    `shelby_neutral_ok.psd` (Western) + `test_image4.psd` (anime) in
    the actual app. Compare visual + exported `.cmo3` bytes. User-side
    gate.

This means **Phase 0 is one user-side gate from full-shipped**. Param
drivers + constraints + bone skinning all participate in the depgraph
under the `'depgraph'` flag. Once the byte-fidelity sweep clears, the
flip lands and Phase 1 (Action datablock + NodeTree retirement) opens.

## Tests

| Suite | Pre-Phase 0 | Post-Phase 0 |
|-------|-------------|--------------|
| animationEngine | 57 | 57 |
| animationStore | 55 | 55 |
| constraints | 39 | 39 |
| anim | 64 | 64 |
| animFCurveBridge | 29 | 29 |
| initRig | 60 | 60 |
| projectRoundTrip | 41 | 41 |
| chainEval | 25 | 25 |
| depgraph_armature | — | 9 (new) |
| **TOTAL** | **370** | **379** |

No regressions across the depgraph + bone + chainEval + constraints +
animation regression sweep (28 suites, 821 assertions). Typecheck
clean.
