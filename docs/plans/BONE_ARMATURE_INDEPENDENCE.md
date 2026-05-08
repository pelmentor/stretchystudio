# Bone Armature Independence — Plan

**Status:** SHIPPED 2026-05-08 (all 5 phases + 1 same-day fix for ancestor compose). Full test suite (147 suites, 0 failures including new `test_boneSkinning.mjs` with 21 cases) and typecheck green.

**Same-day fix (bug found by user before commit landed):** initial implementation built the skinning matrix from the joint bone's OWN pose only via `buildBoneSkinningMatrix(boneNode)`. That misses ancestor rotations — rotating `leftArm` produced no visible deformation in `handwear-l` (jointBoneId=`leftElbow`) because `leftElbow.pose = identity`, even though `leftElbow.world = leftArm.pose * leftElbow.pose ≠ identity`. Fix: extracted `computeBoneWorldMatrices(nodes)` from `boneOverlayMatrix.js` (composes through the bone-group ancestor chain), and CanvasViewport now looks up `boneWorld.get(jointBoneId)` for skinning. `buildBoneSkinningMatrix` removed (was a footgun — only correct for root bones). New regression test in `test_boneSkinning.mjs` Test 7 asserts ancestor-pose composes through.
**Drafted:** 2026-05-08 · **Owner:** pelmentor
**Supersedes:** [BONE_ROTATION_CANONICAL.md](BONE_ROTATION_CANONICAL.md) (rejected by user 2026-05-08 — that plan proposed bidirectional sync between bone and `ParamRotation_<bone>`; user wants independence, not mirroring).

## Goal (verbatim user statement, 2026-05-08)

> "On rigged character with INIT RIG, I don't want the bones for example arms to be 'ROTATED' by params baked shapes, I don't want that when you rotate arm bones it just activates param baked arm rotation, I want bones to ACT LIKE BONES, no hacky drivers to params, and I want for example arm rotate params and arm bone rotation to COEXIST like BLENDER STYLE."

In Blender ([reference/blender/source/blender/blenkernel/intern/armature_deform.cc:249-268](../../reference/blender/source/blender/blenkernel/intern/armature_deform.cc#L249-L268)), bone rotation is the source of truth for skeletal deformation. Shape keys (the analog of our `ParamRotation_<bone>` keyforms) are an independent modifier that runs separately. Both compose; neither drives the other.

## Today's hack (what we're removing)

- [src/components/canvas/SkeletonOverlay.jsx:547-557](../../src/components/canvas/SkeletonOverlay.jsx#L547-L557) — when a bone has a driver param (`ParamRotation_<sanitisedName>`), the arc-drag handler writes to `paramValuesStore[paramId]`, NOT to `node.pose.rotation`. The bone matrix stays at identity. The "rotation" is the rig's baked-keyform interpolation — the same effect as moving the slider. Bone gestures ARE slider drags.
- [src/renderer/boneOverlayMatrix.js:100-106, 129-130](../../src/renderer/boneOverlayMatrix.js#L100-L130) — defensively zeroes the overlay matrix for any bone whose `ParamRotation_<bone>` exists, to prevent double-rotation under the legacy single-writer contract.
- Result: rotating an arm bone is a bait-and-switch, exactly the user complaint.

Trunk bones (torso/neck/bothLegs/root) ALREADY work the right way — they have no driver param, so the drag handler writes `node.pose.rotation` and the overlay matrix folds it into canvas-space verts. The fix is to extend that path to all bones.

## Constraint (Cubism wire format)

`.cmo3` / `.moc3` / `.motion3.json` only model parameter-driven keyforms. There's no skeletal animation in the format. So at the **export boundary** params are non-negotiable. Inside the editor we can choose any source of truth — we just translate at export.

That's what Blender does for FBX export of armature animations: armature rotates bones in viewport; FBX baker samples per-frame and writes channel curves. SS does the same for Cubism: bone rotation is the runtime authoring model; cmo3 export bakes baked keyforms (already wired today via `artMeshSourceEmit.computeBakedPositions`).

## Design: bones and params truly independent

| Surface | Today | After |
|---|---|---|
| Pose Mode arc gesture on arm bone | Writes `paramValues.ParamRotation_arm` | Writes `node.pose.rotation` |
| Parameters panel slider for `ParamRotation_arm` | Writes `paramValues.ParamRotation_arm` | Writes `paramValues.ParamRotation_arm` (unchanged) |
| Live preview render | chainEval reads param → drives baked keyforms via cellSelect | Same, PLUS overlay matrix folds in `node.pose.rotation`, PLUS per-vertex skinning honors `boneWeights` |
| `ParamRotation_arm` slider value at rest | 0 (bone gesture wrote here) | 0 (bone gesture writes elsewhere now) |
| `node.pose.rotation` for arm bone at rest | 0 (drag handler bypassed it) | 0 (drag handler writes it; rest = 0) |
| Both controls active simultaneously | N/A (drag → param only) | Compose: skinning multiplies on top of the baked-keyform geometry |
| `applyPoseAsRest` | Bakes verts using `pose.rotation`; arm bones have `pose.rotation === 0` so the bake is a no-op | Bakes verts using `pose.rotation`; arm bones now have a real rotation to bake |
| Save / load | `paramValues` carries the rotation (since gesture wrote there) | `node.pose.rotation` carries the rotation |
| cmo3 / moc3 / motion3 export | Reads `paramValues` → bakes keyforms / curves | Same. `paramValues` is still the export-time source of truth — UNCHANGED. |
| Animation tracks | Target `ParamRotation_arm` | Target `ParamRotation_arm` (unchanged) |

Net effect: gesturing the bone arc no longer secretly drags the param slider. The slider's job is animation/import-export; the bone's job is posing. Both are first-class. Both compose visually.

## What COMPOSES means (semantics)

For a bone with rest pivot `P` and `pose.rotation = θ` (the new live value):

**Per-part overlay** (existing path, unchanged math):  
`out_v = R_θ(v - P) + P` applied to every vertex of every part beneath the bone, scaled by 1.

**Per-vertex weighted skinning** (new path):  
For meshes with `boneWeights[i]` defined per vertex (today: only for parts with `jointBoneId` and a bone-baked-keyform pipeline):  
`out_v = lerp(v, R_θ(v - P) + P, weight[i])`  
which collapses to the per-part overlay when `weight[i] = 1` for all i, and to identity when `weight[i] = 0`.

**Composition with chainEval / param-driven keyforms:**  
chainEval runs first → produces canvas-space verts including any `ParamRotation_<bone>` rotation already baked in via cellSelect over the keyforms. Then the bone overlay/skinning applies on top of those verts.

If the user holds `ParamRotation_arm = 30` (slider) AND rotates the bone by 15° (gesture):
- Baked keyforms encode arm at 30° rotation → chainEval emits 30°-rotated verts.
- Skinning rotates them another 15°.
- Final mesh visually at ≈45° rotation (Blender shape-key + armature stacking model).

User-additive. Same as Blender's Armature modifier composing on top of Mesh Deform / shape keys.

## Pivot frame

Bone `transform.pivotX/Y` is canvas-px (the rest pivot of the bone). chainEval emits canvas-px verts. The skinning math is canvas-px → canvas-px. No frame conversion needed.

## Non-goals (explicit, to keep scope)

- Multi-bone weighted skinning per vertex. SS today stores `boneWeights: number[]` (one weight per vertex, ONE bone per part via `jointBoneId`). Multi-bone vertex groups (Blender `MDeformVert.totweight > 1`) are out of scope; the current data model supports single-bone-per-part skinning only.
- Dual-quaternion skinning. Linear blend is what Blender uses by default and what Cubism's baked keyforms encode.
- Auto-keyframe of `node.pose.rotation` for export. Keyframes still target `paramValues.ParamRotation_<bone>`. The user can still drive arm rotation via animation by sliding the param in animation mode; that path is unchanged.
- A new bone-rotation animation track type. Out of scope (would require motion3/can3 changes).
- Translation/scale via bones. `node.pose.x/y/scaleX/scaleY` already feeds `boneOverlayMatrix` for non-driver bones; this plan brings driver bones into that same path. No new fields.

## Implementation phases

### Phase 1 — Decouple drag handler from param writes

[src/components/canvas/SkeletonOverlay.jsx](../../src/components/canvas/SkeletonOverlay.jsx) — drop the `rotationParamId` branch from the move handler. Always write `node.pose.rotation = newRotation` (and the existing `setDraftPose` path for animation mode auto-keyframe capture, but capturing `pose.rotation`, not the param). Drop the param clamp on bone rotation; clamping by param `min/max` was a workaround for the param-driven path. Bones can rotate freely; if the user wants to keyframe the param, the param's own slider clamps independently.

The `rotationParamId` lookup still has value for **the SVG arc visual range** (the arc handle should still cap at the param's min/max so the user has a hint of the typical animation range). Keep it for the visual arc, drop it from the value-writing decision.

### Phase 2 — Drop driver-bone identity guard in overlay

[src/renderer/boneOverlayMatrix.js:87-106](../../src/renderer/boneOverlayMatrix.js#L87-L106) — remove the `driverParamIds` set, `isRigDriven` predicate, and the `if (isRigDriven(boneNode)) local = mat3Identity()` branch. Every bone-group's `pose.{rotation,x,y,scaleX,scaleY}` folds into the overlay matrix uniformly.

Drop the `parameters` argument from the `computeBoneOverlayMatrices` signature. Update [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (the only caller) to drop the second arg.

### Phase 3 — Per-vertex weighted skinning module

New module: **[src/renderer/boneSkinning.js](../../src/renderer/boneSkinning.js)** — applies per-vertex bone-weighted skinning to chainEval output for meshes with `mesh.boneWeights`. Pure functions, no React.

API:
```js
/**
 * Apply per-vertex weighted bone skinning to a flat positions array.
 *
 * For each vertex i: out_v = lerp(in_v, M·in_v, weight[i])
 * where M is the bone's pose-around-pivot matrix (canvas-px → canvas-px).
 *
 * In place. No-op when weights / matrix are absent.
 *
 * @param {Float32Array} positions - flat [x0, y0, x1, y1, ...]
 * @param {Float32Array|null} matrix - 3×3 column-major
 * @param {number[]|null} weights - per-vertex weights, length = positions.length / 2
 */
export function applyWeightedSkinning(positions, matrix, weights) { ... }

/**
 * Build the per-bone overlay matrix used for weighted skinning.
 * Same math as `boneOverlayMatrix.computeBoneOverlayMatrices` produces
 * for a single bone, exported separately so the per-PART overlay path
 * (no weights) and per-VERTEX skinning path (with weights) share the
 * same matrix derivation.
 *
 * @param {object} boneNode - the bone group node with transform + pose
 * @returns {Float32Array} 3×3 column-major canvas-space matrix
 */
export function buildBoneSkinningMatrix(boneNode) { ... }
```

Wiring: in [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) draw loop, after the existing `applyOverlayMatrixObj(...)` call, for each part with `mesh.boneWeights` AND `mesh.jointBoneId`, look up the bone, build its skinning matrix, and call `applyWeightedSkinning(positions, matrix, weights)`.

The overlay matrix path (per-PART) and the skinning path (per-VERTEX) are mutually exclusive for a given mesh — if `boneWeights` exists, use skinning; otherwise the overlay matrix already does the right thing. Avoid double-application.

Refactor: extract the core "make bone local matrix from pose around pivot" math from `boneOverlayMatrix.resolveBoneWorld` into the shared `buildBoneSkinningMatrix` so both paths agree on the math.

### Phase 4 — Tests

New: **[scripts/test/test_boneSkinning.mjs](../../scripts/test/test_boneSkinning.mjs)** — covers:
1. Identity matrix → positions unchanged regardless of weights.
2. Full-weight (1.0 everywhere) → equivalent to `applyOverlayMatrixFlat` with the same matrix.
3. Zero-weight (0.0 everywhere) → positions unchanged regardless of matrix.
4. Mixed weights (0.5) → vertices land halfway between input and rotated.
5. Per-vertex weights ([1, 0, 1, 0]) → only odd-indexed vertices rotate.
6. Pivot-around: rotation around (P.x, P.y) preserves the pivot point itself.

Update: **[scripts/test/test_boneOverlayMatrix.mjs](../../scripts/test/test_boneOverlayMatrix.mjs)** — drop the `driverParamIds` test cases (now obsolete); add a case asserting that arm-bone-style names (with rotation params present in the project) STILL produce a non-identity overlay matrix when `pose.rotation !== 0`.

Smoke: rerun `test:shelbyByteFidelity` (cmo3 export should be unchanged — exporters read `paramValues`, not bone pose), `test:initRig`, `test:e2e`.

### Phase 5 — Doc + memory

- This file → keep as plan; mark phases done as they ship.
- After ship: rewrite as `docs/archive/plans-shipped/BONE_ARMATURE_INDEPENDENCE.md`.
- Memory entry `project_bone_armature_independence_shipped.md` summarizing the shipped state.
- Memory entry update: this directly contradicts (and supersedes) the older `feedback_match_file_format_version.md`-style notion that bones must mirror to params. Add a note to the new memory entry that `BONE_ROTATION_CANONICAL.md`'s mirror approach is rejected.

## What does NOT change

- chainEval. Reads `paramValues` as today. Knows nothing about `pose.rotation`.
- cmo3writer / moc3writer / can3writer / motion3 export. Read `paramValues` as today. Byte-identical output for any project where the user only used the slider.
- Animation tracks + animationStore + idle motion generator. Target paramIds.
- physics3 / cdi3 / model3. No bone awareness.
- `mesh.boneWeights` storage shape. Today's per-mesh single-bone weights stay; new module just consumes them.
- rest/pose split (schema v17). `node.pose.rotation` slot already exists; we're now writing to it for arm bones too.
- `applyPoseAsRest`. Already bakes `pose.rotation` into vertices. Now it has real values to bake (was a no-op for arm bones because they always had `pose.rotation === 0`).

## Risk register

| Risk | Mitigation |
|---|---|
| Existing rigs saved with non-zero `paramValues.ParamRotation_<bone>` (legacy gesture wrote there) | On load these still drive baked keyforms — nothing breaks. Bone is at rest; user can drag bone independently to add overlay. |
| Existing motion3.json animations targeting `ParamRotation_<bone>` | Still play correctly — the param channel still drives chainEval keyforms. Overlay/skinning stays at rest unless bone gesture happens. |
| Double-rotation when user has both slider non-zero AND bone non-zero | Documented as intentional Blender-style stacking. If the user complains, we add a UI gate (toggle "treat bone gesture as slider write") in a follow-up. |
| Overlay matrix performance regression | The matrix math is the same as today; only the GUARD changes. Skinning runs only for parts with `boneWeights`, ~4 parts on shelby. Perf-neutral. |
| `applyPoseAsRest` flow now bakes arm rotations | Already-correct behavior; the existing function reads `pose.rotation` and bakes verts. Was inert for arm bones because `pose.rotation` was always 0. Now exercised. Test coverage exists in `test_applyPoseAsRest.mjs` — add a case for non-zero arm rotation. |

## Cross-references

- [REST_POSE_SPLIT.md](../archive/plans-shipped/REST_POSE_SPLIT.md) — schema v17 introduced `node.pose` slot; this plan finally uses it for arm bones.
- [BONE_ROTATION_CANONICAL.md](BONE_ROTATION_CANONICAL.md) — superseded; its bidirectional-mirror approach was rejected by user 2026-05-08.
- [BUG-025 fix shipped 2026-05-08](../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/project_legs_fly_bug_fix_shipped.md) — same session, removed `LEG_ROLES` skip in `structuralChainEmit`. Prerequisite: now any bone group's rotation deformer participates in the chain like any other group, so the bone overlay's contribution composes correctly with chainEval output.
- Blender reference: `reference/blender/source/blender/blenkernel/intern/armature_deform.cc:249-268` — `pchan_bone_deform` accumulates weighted bone-matrix contributions; same shape as our `applyWeightedSkinning`.
