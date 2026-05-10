# Animation Phase 0 — Progress Log

Started: 2026-05-09
Plan: [ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md)
Goal: wire already-shipped scaffolds (FCurve / Driver / RNAPath /
Constraints / DepGraph) into the production hot path.

## Sub-phase status

| Sub | What | Status |
|-----|------|--------|
| 0.0 | Declare ms canonical time unit | ✅ SHIPPED |
| 0.A | gridLift RigWarp_* coordinate-frame fix | ⏳ DEFERRED — analysis below |
| 0.B | Wire `evaluateProjectDrivers` into CanvasViewport tick (param drivers) | ✅ SHIPPED |
| 0.C | Wire `evaluateConstraints` into pose composition | ⏳ DEFERRED — analysis below |
| 0.D.0 | Wire depgraph into CanvasViewport rAF callback | ⏳ Pending 0.A |
| 0.D | Flip `evalEngine` default to `depgraph` | ⏳ Pending 0.A + 0.D.0 |

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

## 0.A — gridLift bug analysis (DEFERRED)

The V2 close-out doc
([BLENDER_PARITY_V2_SHIPPED.md](./BLENDER_PARITY_V2_SHIPPED.md):92-94)
documented: *"per-part `RigWarp_*` lifted grids diverged by ~`canvasW/2`
— pivot-relative vs TL-origin coordinate-frame mismatch in
`kernels/gridLift.js`"*.

**Investigation summary** (Phase 0 read pass):

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

## 0.C — Constraint wire-up analysis (DEFERRED)

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

**Shipped this session:**
- 0.0 — ms canonical declaration (memory entry)
- 0.B — driver pass wired into CanvasViewport tick

**Deferred with analysis (this doc):**
- 0.A — gridLift fix (needs side-by-side fixture work)
- 0.C — constraint wire-up (waits for 0.D.0 architectural decision)

**Pending downstream:**
- 0.D.0 — depgraph viewport wire-up (gated on 0.A)
- 0.D — depgraph default flip (gated on 0.D.0)

This means **Phase 0 is partially shipped**. The user-visible win is
that authored param drivers now affect the live preview / animation
playback — which closes one of the 17 grievances from the audit
("drivers theatre"). The depgraph default-flip and gridLift fix are
the next significant chunk and require dedicated session work.

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
| **TOTAL** | **370** | **370** |

No regressions. Typecheck clean.
