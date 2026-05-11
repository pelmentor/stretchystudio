# Pose Read/Write Canonicalisation Plan

Cross-cutting follow-up to **Toolset Plan Phase 7.C audit-fix G-2**
(documented as deviation in `clearTransform.js`). Closes the
writer/reader shape disagreement between v17/v18 flat `node.pose` and
v19+ `node.pose.channels[boneId]`.

**Scope expanded mid-implementation**: G-2 hedge claimed "no observable
user impact today (no rendering path reads channels-shape directly)" —
this is wrong. `transforms.js:computeWorldMatrices` passes `node.pose`
directly to `makeBoneLocalMatrix`, which reads `pose.rotation`,
`pose.x`, etc. For a v19 channels-shape bone (`{channels:{[boneId]:{...}}}`),
those reads return `undefined` → coalesce to identity → bone renders at
identity, dropping every pose delta. The bug is only hidden today
because writers all write flat, so any first write reverts the shape
and re-enables the read path. **Both reads and writes need
canonicalisation.**

## The gap

Schema v19 (Phase 1C scaffolding) wraps every bone group's flat
`node.pose = {rotation, x, y, scaleX, scaleY}` into the Blender
PoseChannel pattern `node.pose = { channels: { [boneId]: {...} } }`.
The reader (`getBonePose` at `objectDataAccess.js:332`) is shape-aware
— it detects `pose.channels` and reads from `channels[node.id]`,
falling back to flat. **Every writer in the codebase writes flat,
unconditionally**, including the Phase 7.C operators.

Consequence: a v19-migrated project loaded into the editor reads
correctly via `getBonePose`, but the moment any writer touches the
pose, the channels-shape is silently overwritten with flat. The next
time the project is saved + loaded, the v19 migration runs again and
re-channelises — so the bug is invisible at rest, but every save
de-channelises. There is no observable user impact today (no rendering
path reads channels-shape directly), but it leaves the codebase in a
state where Phase 1C-flip (consolidating per-armature pose channels on
one Object) cannot ship without first auditing every writer.

## Two paths considered

### Path A (CHOSEN) — `setBonePoseField` helper

Add three helpers to `objectDataAccess.js`:

- `ensureBonePoseChannel(node)` — returns the writable PoseChannel
  object (`{rotation, x, y, scaleX, scaleY}`), initialising missing
  fields to identity. Detects shape: returns `node.pose.channels[node.id]`
  for v19+ shape, `node.pose` for flat shape. Creates flat shape if
  `node.pose` is missing entirely (the safer default — never
  spontaneously creates channels-shape, since that's a migration's
  job).
- `setBonePoseField(node, field, value)` — writes one field through
  the helper. Strict guard on `field ∈ {rotation, x, y, scaleX,
  scaleY}`.
- `setBonePose(node, partialPose)` — atomic multi-field write.
  Preserves unset fields' current values.

Route every pose writer through these. Reader (`getBonePose`) stays
unchanged — it was already shape-aware.

### Path B (REJECTED) — v35 re-flatten migration

Ship a v35 migration that unwraps `node.pose.channels[boneId]` back to
flat. Justification (per audit-fix G-2 hedge): "no writer uses
channels-shape, removing it removes the divergence entirely."

**Why rejected:** The channels-shape is *intentional forward-compat*
per `BLENDER_PARITY_REFACTOR.md` §"Phase 1C". When the bone-group →
armature-Object collapse ships, one Object will own multiple bone
channels — exactly what `pose.channels[boneId]` is shaped for. A v35
re-flatten would undo that groundwork, and Phase 1C-flip would have to
re-add it. The G-2 hedge missed that detail (it's only documented in
the migration source comment + the Blender Parity plan, not in any
runtime header).

## Writers to consolidate

Found via grep `node\.pose\s*=|\.pose\.(x|y|rotation|scaleX|scaleY)\s*=`:

| File | Lines | Context |
|------|-------|---------|
| `src/v3/operators/pose/clearTransform.js` | 159, 163-178 | Phase 7.C clear ops |
| `src/v3/operators/pose/mirror.js` | 303-308 | Phase 7.C paste/mirror-paste |
| `src/services/PoseService.js` | 125-130, 163-169 | restorePose + applyDefaultPose |
| `src/store/paramValuesStore.js` | 82-83, 110-111 | ParamRotation_<bone> bone-mirror fan-out |
| `src/store/projectStore.js` | 980-986 | applyPoseAsRest zero-pose pass |
| `src/components/canvas/SkeletonOverlay.jsx` | 401-404, 444-445, 487-489 | drag handlers (location, rotation, joint) |
| `src/renderer/animationEngine.js` | 377-389 | `writePoseValues` (used by Gizmo + Modal) |

## Readers to consolidate

Direct `node.pose.field` / `node.pose?.field` reads that bypass
`getBonePose`'s shape detection:

| File | Lines | Context |
|------|-------|---------|
| `src/renderer/transforms.js` | 180 | `computeWorldMatrices` → `makeBoneLocalMatrix(node.transform, node.pose)`; the smoking-gun render-path reader |
| `src/renderer/animationEngine.js` | 286-291 | `getNodePropertyValue` for K-keyframe insert |
| `src/renderer/animationEngine.js` | 323 | `applyOverrideToNode` `{ ...(node.pose ?? IDENTITY_POSE) }` (whole-pose copy for override merge) |
| `src/renderer/animationEngine.js` | 360 | `readPoseValue` per-key fetch |
| `src/store/paramValuesStore.js` | 204 | `syncFromProject` reads `bone.pose.rotation` to mirror into `values[ParamRotation_<bone>]` |
| `src/components/canvas/SkeletonOverlay.jsx` | 349, 692-693 | overlay drag-start capture + extension capture (defensive `?.` already, but reads identity for v19-shape bones) |

`object/mirror.js:120-123` is **out of scope** — the mirror op
explicitly skips bone groups (`isBoneGroup(node)` → `skippedBones++`)
before the pose-flip block executes. The block exists for legacy
non-bone groups that may carry inherited pose data.

`projectMigrations.js` v17 + v19 writes are **migration code** — they
run exactly once per project upgrade and are the canonical authors of
the shape. Out of scope.

## Tests

- `scripts/test/test_pose_writer_helpers.mjs` — unit tests for
  `ensureBonePoseChannel` / `setBonePoseField` / `setBonePose` on both
  flat and channels-shape inputs. Cover: missing-pose init, partial
  field write preserves siblings, non-bone returns early, invalid
  field name no-ops.
- `scripts/test/test_pose_write_v19_shape.mjs` — end-to-end: load a
  v19-shape fixture, call each consolidated writer, assert the
  channels-shape survives intact.
- All Phase 7.C suites must stay green (149 + 46 audit-pin = 195
  assertions).
- All sister suites (PoseService, paramValues, projectStore
  applyPoseAsRest) must stay green.

## Out of scope

- Phase 1C-flip itself (collapsing per-bone Object to per-armature
  Object). The helper signature `(node, field, value)` will need to
  change to `(armatureObject, boneId, field, value)` then, but routing
  all writers through one helper today is the *prerequisite* — that's
  the whole point.
- Refactoring `getBonePose` — already shape-aware, no change needed.
- Reverting v19 migration — explicitly rejected (Path B above).

## Phase 8 vs follow-up plan

This is filed as a **standalone follow-up plan** rather than Toolset
Plan Phase 8 because it spans the codebase, not the toolset surface.
Toolset Plan Phase 7.D (exit gate) and a future Phase 8 should
proceed independently after this lands.
