# Cubism Adapter Revert — Toward Blender Parity

**Status:** SHIPPED 2026-05-09 (afternoon)
**Date:** 2026-05-09 (afternoon, post arm-disappear sweep)
**Predecessors:** `CUBISM_ADAPTER_PATTERN.md` (shipped, but architecturally wrong)
**Drives:** `feedback_blender_reference_strict.md` ("never invent modes/datablocks/concepts. Check `reference/blender/source/blender/` first.")
**User invoked Rule №2:** no migration baggage — dead/staged migration files deleted

---

## §1 Why this exists

Three Apply Modifier / export bugs in two days, all rooted in the same architectural mistake. Two independent agent audits have now flagged the root cause: **`seedDefaultRigidWeights` writes contamination data onto the project graph that contradicts Blender's data model.**

Blender's reality (`reference/blender/source/blender/`):

> A mesh has vertex groups (`me->dvert`) **only** when it is per-vertex skinned. A mesh that follows its parent bone rigidly has NO vertex groups, NO Armature modifier — it just inherits the bone's world matrix via the parent-child transform chain (`object.cc`, `armature.cc`). These are two separate mechanisms.

StretchyStudio post-2026-05-09:

> Every meshed part with a bone-group ancestor gets `boneWeights = [1.0, …]` + `jointBoneId = nearestBoneAncestor.id`, regardless of whether it actually needs per-vertex skinning. Then a Cubism Adapter strips these "rigid-intent" weights at the cmo3/moc3 export boundary so wire-format stays clean.

The conflation of "follows bone" with "is per-vertex skinned" is anti-Blender. The strip is a band-aid — every reader that touches `mesh.boneWeights` needs to remember to strip; every miss is a new bug.

---

## §2 The bugs that proved this

| Date | Bug | Site | Root cause |
|---|---|---|---|
| 2026-05-09 (morning) | moc3 broken export — orphan `band=0` keyforms | `meshBindingPlan.js` | Read raw `mesh.boneWeights`; missed adapter strip. Fixed in `5db54c9`. |
| 2026-05-09 (midday) | Apply Modifier on handwear → pose jump | `ArmatureModifierService.js:170-184` | Linear-only frame transform of cached keyforms (assumed joint-bone-pivot-relative; actually parent-deformer-local). Fixed in `5db54c9`. |
| 2026-05-09 (afternoon) | Apply Modifier → arm disappears entirely | `selectRigSpec.js:563-638` pre-rig fallback | Stale `rigParent` after Apply normalized POSED canvas-px verts into warp's REST [0..1] bbox; bilinear extrapolation threw geometry off-canvas. Fixed in `e361de1`. |
| 2026-05-09 (afternoon) | moc3 paramSpec contamination — useless `ParamRotation_<face>` sliders | `moc3writer.js:119-125` | Read raw `mesh.boneWeights`; **second** missed adapter strip. Fixed in `e361de1`. |

The pattern is unmistakable: **every reader of `mesh.boneWeights+jointBoneId` outside the export adapter is a latent bug**. The strip is a single chokepoint that cannot reach all consumers (rendering pipeline, paramSpec build, modifier synth, render-loop composition decision, applyPoseAsRest, save/load round-trip, etc.).

---

## §3 The Blender-correct architecture

### Two distinct mechanisms (not a continuum)

| Blender | StretchyStudio analogue | When |
|---|---|---|
| **Bone parent + no vertex groups** — mesh follows bone via parent-chain transform | `GroupRotation_<bone>` rotation deformer; part is child of deformer | Rigid follow (handwear, face mesh, torso, hair, etc.) |
| **Vertex groups + Armature modifier** — per-vertex LBS skinning | `mesh.boneWeights` + `mesh.jointBoneId` + Armature entry in `node.modifiers[]` | True skinning (limb blend zones, `computeSkinWeights` produces variable weights) |

**Cubism's `GroupRotation_<bone>` deformer is the rigid-follow analogue.** It already exists, it's already part of the rig synth pipeline, and it's already what the renderer used pre-Adapter for non-limb parts (the deleted overlay-matrix path was a parallel implementation).

### `isRigidVertexGroup` becomes a decision function, not a data rule

The predicate's actual purpose is: "given a part with `boneWeights+jointBoneId`, is the per-vertex skinning meaningful, or is it a no-op (all-1.0)?" That's a **render-time decision**, not a stored fact. The predicate already exists at `src/lib/vertexGroupVariance.js`; we just relocate its callsites.

### Single source of truth

After the revert:
- `mesh.boneWeights` exists ONLY when `computeSkinWeights` produced meaningful per-vertex variation (limb blend zones).
- `mesh.jointBoneId` exists ONLY alongside meaningful weights.
- Armature modifier on `node.modifiers[]` exists ONLY when vertex groups are present.
- All other readers can trust `mesh.boneWeights` semantics: present → real skinning; absent → rigid-follow via deformer chain.

No adapter strip needed at export. No paramSpec contamination. No render-side branch on rigid-vs-truly-skinned. No surprise readers to audit.

---

## §4 What gets reverted

### Code deletions

| File | What | Why |
|---|---|---|
| `src/store/seedDefaultRigidWeights.js` | DELETE entire module | Writes contamination data |
| `src/store/migrations/v31_default_rigid_weights.js` | DELETE migration | Was running `seedDefaultRigidWeights` on load |
| `src/lib/vertexGroupVariance.js` | KEEP `isRigidVertexGroup` (relocated callers); DELETE `nearestBoneAncestorId` if unused | Predicate stays as decision function |
| `src/io/live2d/extractMeshExportStruct.js` | KEEP for Audit-Issue-8 corner case (hand-only sub-meshes whose `computeSkinWeights` saturates to 1.0 with `jointBoneId !== nearestBone`) | Bone-routing-intent guard still needed |

### Code adjustments

| File | Change |
|---|---|
| `src/store/projectStore.js:seedAllRig` | Remove `seedDefaultRigidWeights(proj)` call |
| `src/store/projectMigrations.js` | Schema bump v31 → v32 (no-op for existing v31 projects; future migration to clean up rigid-1.0 weights from already-migrated projects) |
| `src/renderer/bonePostChainComposition.js` | KEEP 2-state but `kind: 'lbs'` only fires when `isRigidVertexGroup(...) === false`. Rigid-follow parts (no weights, no modifier) get composition.kind = 'none' but are visually rotated by the parent rotation deformer chain — same as before the Adapter. |
| `src/io/live2d/moc3/meshBindingPlan.js` | Remove the `extractMeshExportStruct` strip (no contamination to strip); keep the bone-routing-intent guard via `isRigidVertexGroup` |
| `src/io/live2d/exporter.js` | Remove the `extractMeshExportStruct` strip from both extraction sites (lines 477, 772) |
| `src/io/live2d/moc3writer.js` | Remove the `extractMeshExportStruct` strip from the paramSpec build |
| `src/services/ArmatureModifierService.js` | Apply Modifier only legal on parts that genuinely have an Armature modifier (i.e. truly skinned parts) — naturally falls out of the simpler data model |
| `src/store/synthesizeModifierStacks.js` | Only adds Armature modifier when `boneWeights` are present and meaningful (not all-1.0) |

### What stays

- `mesh.runtime` shape (bindings + keyforms + parent) — caching architecture is independent of skinning.
- The minimal-canvas-px runtime write on Apply (commit `e361de1`) — still correct semantics for post-Apply rendering.
- The pre-rig fallback in `selectRigSpec.js` — used by fresh-import projects; just no longer triggered post-Apply.
- Cubism Editor / Viewer compatibility — the wire format is unchanged (we just stop writing rigid-1.0 weights to the project graph that we then strip on export).

### What needs a migration

Already-migrated v31 projects on disk (Shelby / Hiyori / user's other characters) have rigid-1.0 weights baked in. A v32 migration walks `project.nodes`:
- For each part with `mesh.boneWeights` and `mesh.jointBoneId`: run `isRigidVertexGroup`. If TRUE, delete both fields. If FALSE, leave intact.
- For each part: re-run `synthesizeModifierStacks` so any Armature modifier added by v31 is dropped if its underlying weights are gone.

After v32 migration, the project graph matches the pre-Adapter shape for rigid-follow parts (no boneWeights), and matches the limb-skinning shape for truly skinned parts (variable boneWeights).

---

## §5 Render path post-revert

### Limb skinning (rigid-LBS path stays)

- Part has `mesh.boneWeights` (variable) + `mesh.jointBoneId` + Armature modifier.
- Render: chainEval emits canvas-px via deformer chain → `pickBonePostChainComposition` returns `kind: 'lbs'` → `applyTwoBoneSkinningObj` applies LBS overlay.
- Identical to current behavior for limbs.

### Rigid follow (parent-deformer-chain path)

- Part has NO `boneWeights`, NO `jointBoneId`, NO Armature modifier.
- Part's `rigParent` points to `GroupRotation_<bone>` rotation deformer (set by `synthesizeDeformerParents`).
- Render: chainEval emits canvas-px via deformer chain (the rotation deformer rotates the part around the bone's pivot when bone is posed) → `pickBonePostChainComposition` returns `kind: 'none'` → no LBS overlay.
- Same render result as the deleted overlay-matrix path produced, but with no parallel codepath — the rotation deformer chain IS the rigid-follow mechanism.

### Why didn't this work pre-Adapter? (BUG-028)

The pre-Adapter render had two parallel composition paths:
1. LBS for parts with vertex groups
2. Overlay-matrix for parts without

The bug was: parts could fall through BOTH paths (if user had a vertex-group part with the modifier disabled, the renderer would compose both). The Cubism Adapter solution was "force everything through path 1." The Blender-correct solution is "make the composition decision deterministic via `pickBonePostChainComposition`" — return `kind: 'none'` for all path-2 cases, and let the deformer chain alone produce the visual.

That's exactly what V4 already does post-`bonePostChainComposition.js`. The 2-state collapse from Phase 2 of the Cubism Adapter is keepable; it just needs to fire on the absence of weights/modifier rather than on the explicit `'applied'` reason.

---

## §6 Phases

### Phase 1: Render-side composition decision

Update `pickBonePostChainComposition` to return `kind: 'none'` when:
- No `mesh.boneWeights`, OR
- No `mesh.jointBoneId`, OR
- No active Armature modifier in `node.modifiers[]`

(Currently: returns `'lbs'` when boneWeights+jointBoneId+modifier all present.)

Verify rigid-follow parts (no weights, parent = rotation deformer) still render via deformer chain. Test via `test_bonePostChainComposition.mjs`.

### Phase 2: Schema v32 — strip rigid-1.0 weights

Add migration `v32_strip_rigid_default_weights.js`. Walks `project.nodes`, removes `boneWeights`+`jointBoneId` where `isRigidVertexGroup()` returns true. Re-runs `synthesizeModifierStacks` to drop Armature modifiers on parts that lost their weights.

### Phase 3: Remove `seedDefaultRigidWeights` from `seedAllRig`

After Phase 2 migration runs on load, no fresh seeding needed. Remove the call in `projectStore.js:1318`.

### Phase 4: Remove the Cubism Adapter strip

`extractMeshExportStruct.js` keeps the bone-routing-intent guard (Audit Issue 8 — hand-only sub-meshes) but the rigid-1.0 strip path is dead code (no rigid-1.0 weights enter the export anymore). Delete that path; rename module if needed.

Remove strip callsites in `exporter.js`, `moc3writer.js`, `meshBindingPlan.js`.

### Phase 5: Delete `seedDefaultRigidWeights.js` + `v31_default_rigid_weights.js`

Modules are dead. Drop them.

### Phase 6: Verify

- Full test suite green
- Cubism Viewer load test on Shelby moc3 + cmo3
- Visual sweep: pose arm, blink, body angle, idle motion, export — all render correctly
- Apply Modifier on a truly-skinned limb part still works (LBS bake, minimal canvas-px runtime)
- Apply Modifier on a rigid-follow part is no longer offered in UI (no Armature modifier exists to apply)

---

## §7 Risks

| Risk | Mitigation |
|---|---|
| Existing rig data on disk uses v31 (rigid-1.0 weights) — Phase 2 migration must be reversible-safe | Migration only deletes weights confirmed rigid by predicate; bone-routing-intent + true skinning preserved. |
| Multiple users have already saved post-Adapter projects (Shelby, Hiyori with the v31 schema) | v32 migration handles them lossless. |
| The Cubism Adapter plan (`CUBISM_ADAPTER_PATTERN.md`) shipped with mathematical equivalence proofs (rigid LBS = overlay matrix). Reverting doesn't invalidate the math, just chooses a different implementation point | Document this in the plan's §13. The proof remains valid; we just choose the deformer-chain implementation over the LBS implementation. |
| `pickBonePostChainComposition`'s 2-state collapse may need a 3rd state (`'rigid-follow'`) for diagnostic clarity | TBD; can stay 2-state if `'none'` covers both. |
| Apply Modifier UX: post-revert, Properties panel won't show "Apply" button on rigid-follow parts (they have no Armature modifier). User may expect to "apply" the bone-follow somehow | Match Blender — no Apply needed for rigid follow; the part already follows via parent chain. The bone gesture's effect IS the rigid follow at render time; Apply Pose As Rest bakes it into the chain (rotation deformer's pivot updates) without per-mesh per-vertex baking. |

---

## §8 Open questions for user

1. **Schema bump cadence.** v31 was just shipped today (2026-05-09 morning). v32 right after is unusual. Acceptable, or should we squash to a single v31-as-no-op + Phase 2 migration in a renamed slot?

2. **`pickBonePostChainComposition` 2-state vs 3-state.** Keep `'none'` covering both `'applied'` (Apply was clicked) and `'rigid-follow'` (no skinning to begin with), or split for diagnostic clarity?

3. **Apply Pose As Rest scope post-revert.** After revert, fewer parts have Armature modifiers (only truly skinned). `applyPoseAsRest`'s Step 1 + 1b gates on `hasArmatureMod` — naturally narrows scope. For rigid-follow parts, Apply Pose As Rest shifts the bone's pivot (already does via Step 2/3) and the rotation deformer's chain absorbs the new pivot — no per-mesh action needed. Confirm this matches Blender's `OBJECT_OT_pose_armature_apply` semantics.

4. **Test migration cost.** Some existing tests stub `boneWeights = [1, 1, ...]` on rigid fixtures (e.g. `test_applyPoseAsRest.mjs:54-69` which I just updated yesterday for the v31 reality). Phase 2 migration would mean those fixtures are no longer testing the actual production state. Update fixtures to remove the stubbed all-1.0 weights — they're now anti-Blender artifacts.

---

## §9 Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-05-09 (afternoon) | Revert proposed | Three bugs in two days; both audit agents independently flagged `seedDefaultRigidWeights` as the architectural mistake. Reverting is more Blender-like. |
| 2026-05-09 (afternoon) | All 6 phases shipped (commits `67578ac`, follow-up `b293c9e`) | User confirmed visual works post-revert ("It works, very nice"). |
| 2026-05-09 (afternoon) | User invoked **Rule №2** — no migration baggage | Deleted `seedDefaultRigidWeights.js`, `v31_default_rigid_weights.js`, `v30_strip_deformer_nodes.js` (staged Phase 3.C, never registered), `deformerLookup.js` (Phase 3.C helpers, no callers), `test_cubismAdapter_renderEquivalence.mjs` (proved equivalence of the rejected adapter), `test_meshBindingPlan_rigidStrip.mjs` (tested removed strip). Net −1029 lines. |
| 2026-05-09 (afternoon) | Add Modifier > Armature now works without vertex groups (commit `b293c9e`) | User asked: "How do I add modifier back to the piece — what's the best blender approach here and user friendly?" Pre-fix, the section was hidden when no vertex groups existed → no way to start painting weights to promote a rigid-follow part to per-vertex skinning. Post-fix, `bindArmatureModifier` resolves jointBoneId from nearest bone ancestor when missing on the mesh; section is visible for any meshed part with bone-group ancestor. |

---

## §10 The shipped UX — three Blender-parity flows

After all phases of the revert, users have three discrete, Blender-parity flows for managing Armature modifiers on a part. Each flow is one or more user actions; no hidden auto-magic, no contamination data.

### Flow 1 — Bone follow (most common)

**Use case:** the user just wants the part to visually rotate when a bone is posed.

**User action:** none. The mesh is parented to the bone via `node.parent`; the overlay-matrix render path applies the bone's world matrix uniformly to the part's verts every frame. Mirrors Blender's "child of bone, no Armature modifier" semantics (the standard rigid-follow rendering Blender does via parent-chain composition).

**Render decision:** `pickBonePostChainComposition` returns `kind: 'overlay'`; `CanvasViewport` calls `applyOverlayMatrixObj(verts, boneOverlayMap.get(node.id))`. Identity-pose bones produce no map entry → no-op overlay → zero cost.

### Flow 2 — Per-vertex skinning (paint weights)

**Use case:** the user wants partial influence (limb blend zone, sleeve crease, etc.) where different vertices follow different bones with different weights.

**User actions:**
1. **Properties panel → Add Modifier → Armature.** Empty modifier added with target = nearest bone-group ancestor (resolved from `node.parent` chain when `mesh.jointBoneId` is absent). The mesh continues to rigid-follow via overlay path because `mesh.boneWeights` is still empty.
2. **Tab → Weight Paint mode** (V4 Phase 4 shipped 2026-05-05).
3. **Paint weights.** Once any vertex has a non-zero weight, `pickBonePostChainComposition` flips from `'overlay'` to `'lbs'` and `applyTwoBoneSkinningObj` takes over.

**Render decision flips automatically** based on `(hasModifier && hasWeights)` evaluating to true.

### Flow 3 — Re-bind after Apply

**Use case:** the user previously had a per-vertex skinned part (e.g. an arm with limb blend), clicked Apply Modifier to bake the current pose into rest geometry, and now wants to resume LBS skinning (e.g. to pose the bone differently).

**Blender semantics preserved:** Apply Modifier removes the modifier entry from `node.modifiers[]` but keeps vertex groups (`me->dvert` is not touched by `OBJECT_OT_modifier_apply`). The mesh's vertex group data is therefore still on `mesh.boneWeights` + `mesh.jointBoneId` post-Apply.

**User actions:**
1. **Properties panel → Add Modifier → Armature.** `bindArmatureModifier` sees the existing `mesh.jointBoneId` and uses it directly (no need to walk the ancestor chain). Modifier added with the previous binding target. LBS resumes immediately.

The "Add Modifier" tooltip differentiates the two cases: shows "Re-bind Armature modifier to existing vertex groups (N weights → bone X)" when weights exist, "Add empty Armature modifier (target bone: X). The part rigid-follows … until you paint vertex weights" when empty.

### What was deliberately NOT added

- **"Bind with Auto Weights" one-click operator.** Tempting to add (Blender precedent: `Object > Parent > Armature Deform With Automatic Weights`), but in Blender it's a parent-time convenience, not a modifier-time one. SS already has `computeSkinWeights` running in the wizard for limbs. Empty modifier + Weight Paint covers the same surface in two clicks. Can be added later if user requests.
- **Auto-promote on Weight Paint.** Painting weights into an empty modifier could automatically populate `mesh.boneWeights`. Not implemented — the Weight Paint UI's existing flow is the canonical surface, and the modifier's `data.jointBoneId` is the auto-target for any new weight a user paints.

### Implementation summary

| File | Change |
|---|---|
| `src/services/ArmatureModifierService.js` | `bindArmatureModifier` resolves `jointBoneId` from `mesh.jointBoneId` OR nearest bone-group ancestor. Removed `missing-vertex-groups` failure (replaced with `no-bone-ancestor` for the no-target case). |
| `src/v3/editors/properties/sections/ModifierStackSection.jsx` | Section visible for any meshed part with bone-group ancestor (was gated on existing weights). `canBindArmature` predicate widened. Tooltip differentiates re-bind vs fresh-bind. |
| `scripts/test/test_applyArmatureModifier.mjs` | Test 10 contract update + Test 10b added: rigid-follow part → bind succeeds with empty modifier; truly-no-bone-ancestor case fails cleanly. 47/47 green. |
