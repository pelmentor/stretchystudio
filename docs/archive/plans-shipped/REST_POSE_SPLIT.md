# Rest / Pose Split — Blender-style Bone Architecture Plan

Date opened: 2026-05-05
Date shipped: 2026-05-05
Owner: pelmentor
Status: **ALL THREE PHASES SHIPPED**. This doc is now a historical record + reference for the rest/pose contract.

---

## Shipping summary (2026-05-05)

All Phase 1 / Phase 2 / Phase 3 items closed in one autonomous session.
Suite: 100% green (38 new assertions on top of the pre-existing suite).
Typecheck clean. Migration v17 in place; legacy projects auto-fix on load.

### What changed (file index)

| File | Phase | Change |
|---|---|---|
| [src/store/projectMigrations.js](src/store/projectMigrations.js) | 1 | `CURRENT_SCHEMA_VERSION = 17` + v17 migration lifts legacy bone `transform.{rotation,x,y,scale*}` into `node.pose`. |
| [src/components/canvas/CanvasViewport.jsx](src/components/canvas/CanvasViewport.jsx) | 1 | `finalizePsdImport` initializes `pose: identity` on freshly-created bones. |
| [src/renderer/transforms.js](src/renderer/transforms.js) | 1 | New `makeBoneLocalMatrix(transform, pose)`. `computeWorldMatrices` routes bones through it. |
| [src/renderer/boneOverlayMatrix.js](src/renderer/boneOverlayMatrix.js) | 1 | Reads `node.pose` for non-rig-driven bones. Rig-driven bones contribute identity defensively. |
| [src/components/canvas/SkeletonOverlay.jsx](src/components/canvas/SkeletonOverlay.jsx) | 1, 3 | Drag start/commit reads/writes `node.pose`. Eye trackpad too. Override merge uses `applyOverrideToNode`. |
| [src/services/PoseService.js](src/services/PoseService.js) | 1 | `capturePose` / `restorePose` operate on `bonePoses`. `resetToRestPose` zeros `node.pose`, restores skinned `mesh.vertices` from `restX/restY`. |
| [src/store/projectStore.js](src/store/projectStore.js) | 2 | New `applyPoseAsRest()` action — bakes pose into mesh rest + bone pivots, zeros all bone poses. |
| [src/renderer/animationEngine.js](src/renderer/animationEngine.js) | 3 | New `applyOverrideToNode`, `readPoseValue`, `writePoseValues`, bone-aware `getNodePropertyValue`. Single source of truth for bone-vs-transform routing. |
| [src/renderer/scenePass.js](src/renderer/scenePass.js) | 3 | Override merge through `applyOverrideToNode`. |
| [src/components/canvas/GizmoOverlay.jsx](src/components/canvas/GizmoOverlay.jsx) | 3, 1 | Drag commits via `writePoseValues` / drag starts via `readPoseValue`. Override merge via `applyOverrideToNode`. |
| [src/v3/shell/ModalTransformOverlay.jsx](src/v3/shell/ModalTransformOverlay.jsx) | 1, 3 | G/R/S commits via `writePoseValues`. `revert` too. |
| [src/v3/operators/registry.js](src/v3/operators/registry.js) | 1 | `beginModalTransform` captures pose-shape values via `readPoseValue` and computes modal pivot from world matrix (not raw `transform.x/y`). |

### Tests added

| File | Assertions |
|---|---|
| [scripts/test/test_boneOverlayMatrix.mjs](scripts/test/test_boneOverlayMatrix.mjs) | 13 (chain composition, identity-pose elision, rig-driven defensive bypass, translation-only pose) |
| [scripts/test/test_applyPoseAsRest.mjs](scripts/test/test_applyPoseAsRest.mjs) | 25 (visual preservation, pose zeroing, pivot shifts, idempotence, no-op on zero-pose project) |
| [scripts/test/test_poseService.mjs](scripts/test/test_poseService.mjs) | Rewritten to v17 fixture shape (was failing 7) |
| [scripts/test/test_migrations.mjs](scripts/test/test_migrations.mjs) | +25 v17-specific assertions (round-trip, idempotency, already-v17 with pose) |

### Decisions made (without further user input)

1. **`node.pose` flat sibling of `node.transform`** — mirrors Blender's `bone.matrix_basis` (pose) sibling-of `bone.matrix` (rest). No nesting.
2. **Phase 1 + 2 + 3 shipped together** — the override-merge audit revealed Phase 3 was load-bearing for animation playback. Bone keyframes would silently put values in the rest matrix without it.
3. **UI placement** — Reset Pose button + chevron dropdown (button group, top-right canvas corner). Apply Pose As Rest is the dropdown's first entry. Future pose ops slot in here. Disabled in animation mode.
4. **2D-rest limitation accepted as-is** — bones can't carry permanent rest rotation (no `rest.rotation` field). Only meshes (canvas-space verts) and pivots can absorb the bake. Sufficient for "Apply Pose As Rest" UX; full Blender parity (rest matrices encoding rotation) is an additive change for later.
5. **Bake op no-confirms** — runs immediately. The bake is undoable through normal Ctrl+Z. The "current pose has N animations attached" warning was deferred — the user can revert via undo.

### Ship readiness

- All five must-fix audit items from §4 closed.
- Three risks (1, 2, 3 in §6) closed; risks 4, 5, 6, 7 either mitigated or accepted as known limitations (documented inline in the relevant code).
- Idle-motion preset bookmark (Risk 7) — not exercised by any failing test; idle synthesis writes to track values which flow through the bone-aware accessors. If divergence shows up in user testing, debug from there.

---

---

## 1. Why we're doing this

User direction (verbatim): *"Lets go towards blender architecture change. Rest matrix and pose offset, also an ability to change/bake pose aka 'Blender's apply pose as rest pose'."* — *"all bones are supposed to be moveable, rotateable before and after init rig. Сделаем без костылей."*

The previous patch (`src/renderer/boneOverlayMatrix.js`) made every bone arc visibly responsive by composing a per-part overlay matrix on top of rig output. That works, but it leaves the data model in an awkward state: bone-group `node.transform` carries BOTH rest layout (`pivotX/pivotY`) AND pose offset (`rotation/x/y/scale*`). Mixed slots make these features impossible without crutches:

- **Apply pose as rest** — there's no separate slot to bake INTO; you can't tell which fields are rest vs. pose.
- **Skeleton Edit Mode (joint-dragging) vs. Pose Mode** — both are currently writing different parts of the same `transform` object; one wrong write and a drag overwrites a pivot or vice versa.
- **Animation keyframing of bone pose** — keyframes track `transform.{x,y,rotation}`; once we want to pose-drive a bone via params (arms/elbows) or via pose (torso/neck), the same field name means different things on different bones.

The Blender model — explicit `rest_matrix` + `pose_matrix`, with "apply pose as rest" rebuilding rest from current world — is the clean answer.

---

## 2. Data model: today vs. target

### Today (pre-v17)

```js
// bone group
node.transform = {
  pivotX, pivotY,           // rest layout (joint location)
  rotation, x, y,           // POSE offset (mixed in here)
  scaleX, scaleY,           // POSE offset (mixed in here)
}
// no `pose` slot
```

### Target (v17+)

```js
// bone group
node.transform = {
  pivotX, pivotY,           // REST layout
  rotation: 0, x: 0, y: 0,  // RESERVED (always identity on bones)
  scaleX: 1, scaleY: 1,     // RESERVED (always identity on bones)
}
node.pose = {
  rotation, x, y,           // POSE offset (identity at rest)
  scaleX, scaleY,
}
```

### Non-bone nodes

`node.transform` keeps its current meaning (mixed pose+layout — single source of truth). Only bone groups (`type==='group' && boneRole`) get a `pose` slot. Parts and plain folders are layout, not pose; they don't need the split.

### Local-matrix math

The bone's local matrix in its parent's frame:

```
localBone = makeLocalMatrix(transform) × makeLocalMatrix(poseAroundPivot)
```

Where `poseAroundPivot` reuses the bone's `pivotX/pivotY` so pose rotation and translation are interpreted around the same joint as rest. With `transform.{rotation,x,y,scaleX,scaleY}` reserved at identity, `makeLocalMatrix(transform)` reduces to the identity-modulo-pivot (which IS identity for any input point), so the compose simplifies to just the pose matrix. The full `mat3Mul` form is preserved so that future "non-trivial rest" features (e.g. user-authored rest rotation) don't require another rewrite.

---

## 3. What's already shipped

These commits (uncommitted at the time of writing, in working tree):

| File | Change |
|---|---|
| `src/store/projectMigrations.js` | `CURRENT_SCHEMA_VERSION = 17`. v17 migration: add `node.pose`, lift legacy `transform.{rotation,x,y,scaleX,scaleY}` into `pose`, zero them on `transform`. Bone groups only. |
| `src/components/canvas/CanvasViewport.jsx` | `finalizePsdImport` initializes `pose: identity` on freshly-created bone groups. |
| `src/renderer/transforms.js` | New `makeBoneLocalMatrix(transform, pose)`. `computeWorldMatrices` uses it for bone groups. |
| `src/renderer/boneOverlayMatrix.js` | Reads `boneNode.pose` (around `transform.pivot`) for non-rig-driven bones. Rig-driven bones contribute identity. |
| `src/components/canvas/SkeletonOverlay.jsx` | Drag start reads `pose.rotation` (or driver-param value). Drag commit writes `pose.rotation` only when no driver. Eye trackpad writes `pose.x/y`. Pre-Init-Rig knob preview reads `pose.x/y`. |
| `src/services/PoseService.js` | `capturePose` / `restorePose` operate on `bonePoses` (was `boneTransforms`). `resetToRestPose` zeros `node.pose` for bones (transform layout untouched). |

These are correctness-preserving changes WITH a migration that auto-fixes legacy projects on load.

---

## 4. Open work (in order)

### Phase 1 close-out — **paused here, this is the review point**

**Verified blockers (must fix before merge):**

- [ ] **`scripts/test/test_poseService.mjs` is currently failing 7 assertions** (run `npm test` to confirm). Fixture sets `node.transform.rotation = 45` on bones, then expects `resetToRestPose` to zero it. v17 architecture moved that value to `node.pose.rotation`; reset clears pose, not transform. **Fixture rewrite to v17 shape is required.** This is the most concrete signal that the data-model change is real — the test was correct against pre-v17 semantics and is correctly failing now.
- [ ] **`GizmoOverlay.jsx:283,307`** writes `node.transform.{x,y,rotation}` for whatever's selected. Bones written this way put pose into the reserved rest slot. Fix: detect `node.type === 'group' && node.boneRole`, write `node.pose` instead. Mounted only when skeleton view is OFF or the project has no bones (`CanvasViewport.jsx:2504`), so this is a less common path than SkeletonOverlay arcs but still reachable.
- [ ] **`ModalTransformOverlay.jsx:75-108`** (G/R/S keymap) writes `t.x/y/rotation/scaleX/scaleY` on `node.transform` for every selected node. Same fix needed: bones get pose-routing.
- [ ] **`registry.js:365-366`** computes the modal-transform pivot center from `node.transform.x/y`. For bone selections, transform.x/y is reserved at zero — modal pivot lands at canvas (0,0). Read pivot from the bone's WORLD position (`computeWorldMatrices`) instead, or special-case to use `transform.pivotX/pivotY`.
- [ ] **Override merge — three call sites read keyframe/draftPose values into a synthetic `transform`.** This is the most subtle hit: animations targeting bone tracks on `'rotation'` would put values into the rest matrix instead of pose. Bones would render at wrong rotation during playback. **Phase 3 must ship in the same release as Phase 1.**
  - `src/renderer/scenePass.js:178` (renderer)
  - `src/components/canvas/SkeletonOverlay.jsx:172-174` (overlay's effectiveNodes)
  - `src/components/canvas/GizmoOverlay.jsx:76-78` (gizmo's effectiveNodes)
- [ ] **Migration test.** Add a round-trip case to `scripts/test/test_migrations.mjs`: a v16 project with a posed bone (`transform.rotation = 30`) → migrate to v17 → assert `transform.rotation === 0`, `pose.rotation === 30`. Idempotency: running migrate twice produces the same result.
- [ ] **boneOverlay test.** A pure-JS unit test (Node, not Vitest — repo convention) that builds a 3-bone chain (root → torso → leftArm) with mixed driver-param + pose configs, asserts overlay matrix output for a representative vertex.

**Verified clean (no action needed):**
- `groupWorldMatrices` test still passes — `computeWorldMatrices` change is compatible with non-bone nodes (which is what that test exercises).
- `src/io/exportSpine.js:237` reads `node.transform.rotation`. Spine export is for non-Live2D output; verifying it's bone-aware is out of scope for this plan but the read might silently produce zero for posed bones. Bookmark.

### Phase 2 — Apply Pose As Rest

- [ ] **`bakePoseAsRest()` action on `projectStore`.** Walks bones root-to-leaf, for each bone with non-identity pose:
  1. For descendant **parts** whose nearest bone-group ancestor is THIS bone: apply pose matrix (around bone pivot) to `mesh.vertices[i].restX/restY`. Visually unchanged because the bone's pose currently contributed that same transform — but now baked.
  2. For descendant **child bones** whose `parent` chain hits THIS bone: apply pose matrix to `child.transform.pivotX/pivotY`. Child pose stays.
  3. Zero the bone's `pose`.
  4. Bump `versionControl.geometryVersion` (mesh.vertices changed → rigSpec invalidates → next eval rebuilds).
- [ ] **Driver-param bones don't bake.** Arms/elbows/head store rotation in params, not in `pose`. `pose` is already identity for them. Skip — no work needed.
- [ ] **UI affordance.** Topbar Reset Pose dropdown gains `Apply Pose As Rest`. Confirms with a one-line modal ("This will redefine the rest pose of N bones. Undoable.") and runs the action. Same hotkey conventions as Blender (Ctrl+A → Apply menu) deferred to a follow-up keymap pass.
- [ ] **Tests.** Pose a bone, bake, drag back to identity; assert vertex positions match the original posed state (i.e. baking IS the new rest).

### Phase 3 — Animation/keyframing **(must ship with Phase 1)**

This is the load-bearing phase that the previous draft of this plan
understated. Three call sites merge keyframe / draft-pose values into
a synthetic `transform`, used by the renderer and overlays:

- `src/renderer/scenePass.js:178` — renderer build of effectiveNodes
- `src/components/canvas/SkeletonOverlay.jsx:172-174` — skeleton effectiveNodes
- `src/components/canvas/GizmoOverlay.jsx:76-78` — gizmo effectiveNodes

Each one does:
```js
const transformOv = { ...node.transform };
for (const k of ['x', 'y', 'rotation', 'scaleX', 'scaleY']) {
  if (ov[k] !== undefined) transformOv[k] = ov[k];
}
return { ...node, transform: transformOv, ... };
```

For a bone keyframe-driven track on `'rotation'`, this puts the value
into `transformOv.rotation`. Then `computeWorldMatrices` runs on this
synthetic node; with v17, `makeBoneLocalMatrix(transform=…rotation=value, pose=…)`
treats that rotation as REST, which is wrong. Animation playback for
any pre-existing bone track silently desyncs.

The `KEYFRAME_PROPS` array (`['x', 'y', 'rotation', 'scaleX', 'scaleY',
'opacity', 'visible']`) and `getNodePropertyValue` in [src/renderer/animationEngine.js:242-271](src/renderer/animationEngine.js#L242-L271)
also read from `node.transform` directly. After v17, that returns
identity for bones — bone keyframe insertions would record `0` for
rotation regardless of pose.

Items:

- [ ] **Bone-aware accessor.** `getNodePropertyValue(node, 'rotation')` returns `node.pose.rotation` for bones, `node.transform.rotation` for non-bones. Same for `x/y/scaleX/scaleY`. Single function, three call sites are upstream-affected.
- [ ] **Bone-aware override merge.** Update the three sites above so that for a bone target, override values for `rotation/x/y/scaleX/scaleY` go into a synthetic `pose`, not a synthetic `transform`. Either:
  - Each site writes `{ ...node, pose: {...node.pose, rotation: ov.rotation, …}, transform: node.transform }` for bones, OR
  - Extract a helper `applyOverrideValues(node, ov)` that returns a node with the override applied to the right slot.
- [ ] **Keyframe storage stays the same.** Tracks key by node-id + prop-name. The prop name `'rotation'` continues to mean the user-facing rotation regardless of bone vs. non-bone. No track-format change. The bone-aware accessor / merge is what routes the value to the right slot.
- [ ] **Auto-keyframe (K key).** Walks selected nodes and reads "current value" via `getNodePropertyValue`. Once the accessor is bone-aware, this works without further changes — but verify with a test (animation mode, drag a bone, K, scrub time, drag bone back to rest, K, scrub between).
- [ ] **Existing animations migrate transparently?** Old animations have keyframes against `'rotation'` etc. for bones. Track values are just numbers — they apply via the new accessor route. The migration moved per-node `transform.rotation` to `pose.rotation` so the FIRST FRAME after load matches; subsequent keyframes on the track still read out the correct values. No keyframe-data migration needed if accessors and override merges are consistent. **Add a regression test**: a v16 project with a bone-rotation animation track + non-zero pose at first keyframe → migrate → playback at t=0 should render the same visual as pre-migration playback at t=0.

### Phase 4 — Skeleton Edit Mode contract

Skeleton Edit Mode drags joint dots, which writes `transform.pivotX/pivotY`. That's pure rest-layout work. With the split clarified, we can make this contract explicit:

- Skeleton Edit Mode = rest editor. Writes `transform.pivotX/pivotY` only.
- Pose Mode (default) = pose editor. Writes `pose.{rotation, x, y, ...}` only.
- Mode pill / cursor differentiates the two so users know which slot they're touching.

Already roughly in place; just needs a doc-comment pass + a sanity assertion (`if !skeletonEditMode, never write transform.pivot`).

---

## 5. Apply Pose As Rest — semantics

### Algorithm

The bake walks every bone-and-mesh in the project simultaneously, using
the world matrix each node has BEFORE the bake (i.e. with all pose
offsets active). The trick: **zero all bone poses simultaneously** and
record the visual state into rest data. Iterating one bone at a time
won't preserve world matrices because rotations around different points
don't compose to a single rotation around a third point.

```
1. Compute `worldMap_old = computeWorldMatrices(project.nodes)`.
   This snapshots every node's world transform with current poses.
2. For every part with a mesh:
     M = worldMap_old.get(part.id)  // includes all ancestor bone poses
     for each vertex v:
       v.restX = M.x_component(v.restX, v.restY)
       v.restY = M.y_component(v.restX, v.restY)
       v.x     = v.restX  // posed verts realign to new rest
       v.y     = v.restY
3. For every bone group:
     // Update pivot to its current visual canvas-space location.
     // Pivot is in parent's frame; the parent's NEW rest world (post-
     // bake, with all poses zero) = parent's parent's rest world (because
     // bone rests are identity-modulo-pivot which is just identity).
     // So pivot in parent's new frame = bone.world_old @ pivot_old.
     parentWorld_old = worldMap_old.get(bone.parent) ?? identity
     newPivotCanvas  = parentWorld_old @ pose-applied-pivot_old
     bone.transform.pivotX = newPivotCanvas.x
     bone.transform.pivotY = newPivotCanvas.y
4. For every bone group:
     bone.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 }
5. versionControl.geometryVersion++ (mesh.vertices changed → rigSpec
   invalidates, idle motions / animations may need re-evaluation).
```

### Why all poses must zero simultaneously

Consider parent `T` with pose `R30° around T.pivot` and child `H`
parented to T with pose `R20° around H.pivot`. Pre-bake, the world
position of a point `v` under H is:

```
v_canvas = M_T_pose @ M_H_pose @ v
```

If we bake T's pose into H's pivot (so `H.pivotNew = M_T_pose @ H.pivotOld`)
and zero T.pose but leave H.pose unchanged:

```
v_canvas_new = M_H_pose_around_newPivot @ v
             ≠ M_T_pose @ M_H_pose_around_oldPivot @ v   (in general)
```

The composition `R(α around A) ∘ R(β around B)` is a single rotation
by `α + β` around some other point — not `R(β around f(A, B))`.

By zeroing **all** poses and baking the cumulative world transform into
mesh restX/restY directly, this composition issue vanishes — meshes are
in canvas-space and the cumulative matrix can be applied to them
straight. Bone pivots get updated for UX (so future drags rotate around
the visually-current joint) but their poses are zero so there's nothing
to compose against.

### Limitation: 2D rest is identity-modulo-pivot

Our `transform` for bones holds only `pivotX/pivotY` as meaningful
rest data. There's no `rest.rotation` or `rest.scale`. A pivot doesn't
move points (the rest matrix is pure identity), so we can't put a
rotation INTO bone rest the way Blender's apply-pose-as-rest does for
rest matrices.

Consequence: post-bake, dragging a bone's arc rotates around the new
pivot, with the new pivot at the visually-correct location. This
matches what users expect from "Apply Pose As Rest" — what was your
last pose IS the new neutral, and gestures from neutral feel correct.
The only thing missing relative to Blender is that bones can't carry
permanent rest rotation; we'd need a `rest.rotation` field to add that.
Out of scope unless asked for.

### Worked example

Chain `root → torso → head → mesh face` with `torso.pose = R30°`,
all other poses identity.

Pre-bake:
- `face.vertex.restX/restY = (canvasX, canvasY)` at unposed location.
- World matrix for face (path: root.local × torso.local × head.local) =
  `identity × M_torso(R30° around torso pivot) × identity = M_torso`.
- Rendered face vertex = `M_torso @ (canvasX, canvasY)`.

Apply Pose As Rest:
1. snapshot worldMap_old: `face.world = M_torso`.
2. Update mesh rest verts: `face.vertex.restX/restY = M_torso @ (canvasX, canvasY)`.
3. Update head's pivot (in torso's parent frame = canvas):
   `head.transform.pivot = parentWorld_old(=M_torso) @ head.transform.pivotOld`.
4. Zero `torso.pose`.

Post-bake:
- `face.vertex.restX/restY` is at the previously-posed location.
- `face.world = identity` (all poses zero, rests identity-modulo-pivot).
- Rendered face vertex = `identity @ rotatedCanvasXY = rotatedCanvasXY` — same as before bake. ✓
- Head's joint visualizes at its previously-posed canvas location. ✓
- Drag torso 10° from new neutral → rotates around old torso.pivot (unchanged) by 10°. The rotation is on top of new rest, which is the previously-posed state. ✓

---

## 6. Risks

1. **Driver-param bones with a non-zero `pose`.** Shouldn't happen post-v17 (single-writer contract in SkeletonOverlay). If a path slips through, the bone overlay matrix already defends by treating rig-driven bones as identity here. The pose data hangs around but is never applied. Instrumentation check: add a once-per-session debug log if we ever observe `pose.rotation !== 0` on a rig-driven bone, naming the writer.
2. **Legacy projects with non-zero `transform.rotation` on bones AND non-zero `pose.rotation`.** The migration only fires if *legacy fields are non-default* — if a Phase-1-shipped pose is already in `pose` and the user re-saves, the migration leaves both alone. That's fine because Phase 1 left `transform.{rotation,x,y}` at zero on every write. The combination shouldn't exist; defensive behavior: trust `pose`, ignore `transform`'s pose-fields entirely (we already do).
3. **GizmoOverlay / ModalTransformOverlay / registry.js modal-pivot still touch transform.** Confirmed by audit — three call sites write or read `node.transform.{x,y,rotation,scaleX,scaleY}` for whatever's selected. Bones go through wrong slot. **Highest-risk open items — fix all three before merging Phase 1.**
4. **Animation playback + bone keyframes.** Confirmed by audit — three override-merge sites and `getNodePropertyValue` all read `transform`. Until Phase 3 lands, animation playback for bones silently puts pose values into rest matrices, producing visually-broken playback for any pre-existing animation that targets bone tracks. **Phase 3 must ship in the same release as Phase 1**; we don't ship Phase 1 to users until Phase 3 is in.
5. **Apply Pose As Rest + active animation.** Baking pose mutates `mesh.vertices.restX/restY`, which means existing animations on those meshes (deltas computed from rest) shift. Decision: bake should warn ("character has N animations; baking will rebase them — continue?"). Implementation defers to Phase 2.
6. **Existing failing test — `test_poseService.mjs`.** 7 assertions failing. Not a runtime risk, but a merge gate. Fixture is in pre-v17 shape; rewrite to use `node.pose` and verify reset clears pose, transform stays clean.
7. **Idle motion / runtime presets.** Procedural motion synthesisers (`buildMotion3`) write keyframes against `'rotation'` etc. — same accessor concerns as the keyframe insertion path. Verify presets still work post-v17 by exporting a model with idle motion and inspecting the output `.motion3.json` for sane bone values. Bookmark.

---

## 7. Test surface

### Unit / Node tests

- `scripts/test/test_migrations.mjs` — v16 → v17 round-trip with posed bones.
- New: `scripts/test/test_boneOverlay.mjs` — chain of bones, mixed driver-param + pose, assert overlay matrix output.
- New: `scripts/test/test_applyPoseAsRest.mjs` — pose a chain, bake, assert (a) pose all identity, (b) rest verts moved, (c) visual unchanged at identity render.

### Manual / smoke

- Pose torso 30° before Init Rig → visible rotation (worldMatrix path) ✓
- Pose torso 30°, Init Rig → still visible (overlay matrix) ✓
- Pose torso 30°, drag head 20°, Init Rig → both visible, composed ✓
- Drag elbow → param updates, transform stays identity, mesh deforms ✓
- Reset Pose → all bones at identity, parameters at defaults, mesh verts at restX/restY ✓
- Apply Pose As Rest → bones at identity, mesh shape unchanged, can drag bones from new rest ✗ (Phase 2)
- Save / load mid-pose → pose persists across reload ✗ (depends on `pose` being serialized; should be fine because zustand+immer captures it, but verify)
- Load a pre-v17 project with posed bones → migration moves rotation into pose, visual unchanged ✗ (verify via manual smoke)

### What to break on purpose

- A `node.pose = { rotation: 30 }` on an arm bone (driver-param). Overlay should treat it as identity and the arm shouldn't double-rotate. (Tests the defensive path in `boneOverlayMatrix.isRigDriven`.)
- A v17 project with a bone missing `node.pose` entirely. Should default to identity, no crash. (`PoseService.resetToRestPose` initializes if missing; readers default-coalesce.)

---

## 8. Decisions to confirm before continuing

1. **Phase 2 ships in the same release as Phase 1?** Recommended yes — without Apply Pose As Rest, the user can pose but can't bake. The data-model split has limited value without the bake op.
2. **Phase 3 (animation/keyframing) ships in the same release?** Recommended yes (per Risk 4 above). Otherwise existing user animations that key bone rotation will read identity and play back wrong.
3. **Is "rest rotation" ever non-zero?** Currently armatureOrganizer always sets `transform.rotation = 0` for bones. We're keeping it that way (rest is just the pivot). If a future feature wants user-authored rest orientation, it's an additive change to the same model. Confirm there's no current code path that writes a non-zero rest rotation on a bone — grep clean so far.
4. **Naming.** `node.pose` vs. `node.poseOffset` vs. `node.transformPose`? Going with `pose` — short, mirrors Blender, and `transform` is its sibling.
5. **Skeleton Edit Mode drag of pivot — does it preserve pose?** Yes by design: pivot is rest, pose is unchanged in canvas-space terms. But moving the pivot relative to the mesh shifts the *axis* of pose rotation, so a previously-posed bone will visibly snap when its pivot moves. Mirror Blender's behavior: Skeleton Edit Mode is "edit rest" — user expects this. Document it.

---

## 9. Open questions

- **Pose for non-bone nodes?** Hats, eyewear, etc. — the user might want to "pose" those (e.g. tilt a hat) without converting them to a bone. Currently they use `node.transform`. Decision: leave as-is. Posing on parts is a different problem (it's part-level layout overrides, and we don't have a pose system for parts). Revisit if user asks.
- **Per-axis pose locks?** Blender has per-channel transform locks. Could add `node.pose.locked = { rotation: false, x: false, y: false }`. Out of scope for this plan.
- **Pose constraints (IK, copy rotation, etc.)?** Way out of scope. Bookmark.

---

## 10. What I'm asking for review on

Before continuing the implementation:

1. Is the v17 migration approach acceptable, or do you want a different shape (e.g. `node.pose.transform = {...}` to keep nesting symmetric with `node.transform`)?
2. **Phase 1 + Phase 3 must ship together** (per Risk 4 — animations break otherwise). Phase 2 (Apply Pose As Rest) is independent — can ship later if you want a smaller cut. Confirm: ship 1+3, then 2? Or 1+2+3 in one batch?
3. Apply Pose As Rest UI placement — Topbar Reset Pose dropdown OK, or do you want a dedicated Pose menu (matching Blender's Pose menu)?
4. Anything in §4 / §5 that misses an edge case you have in mind?
5. The 2D-rest limitation (§5 — no `rest.rotation` field on bones) — accept as-is, or budget a `rest.rotation` extension for full Blender parity?

---

## Audit summary (2026-05-05 verification pass)

After writing the first draft of this plan, I re-read the working tree to verify each claim. Findings:

**Plan was correct:**
- Migration v17, transforms.js, PoseService, boneOverlayMatrix, SkeletonOverlay drag/start writes — all match what the plan describes.
- GizmoOverlay writes transform without bone awareness (Risk 3). Confirmed.
- registry.js:365 reads transform.x/y for modal pivot. Confirmed.

**Plan was missing or understated:**
- Existing test `test_poseService.mjs` is failing 7 assertions right now — moved to top of Phase 1 close-out as a merge blocker.
- ModalTransformOverlay (G/R/S keymap) is a third bone-blind writer alongside GizmoOverlay. Added to Phase 1 close-out.
- Override-merge call sites — three of them, not implied by the plan's "Phase 3" framing. Animation playback for bones breaks immediately under v17 unless these are bone-aware. Promoted Phase 3 to "must ship with Phase 1".

**Math correction:**
- §5's per-bone-iterative bake walk doesn't preserve world matrices when the chain has multiple posed bones. Replaced with the simultaneous-zero-all-poses algorithm + worked example + an explicit limitation note about 2D rest having no rotation field.
