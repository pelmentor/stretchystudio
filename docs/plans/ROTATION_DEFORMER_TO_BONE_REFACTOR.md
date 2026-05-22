# RotationDeformer → armature bone refactor (RULE №4)

Compact-resumption anchor. Driven by **RULE №4 (declared 2026-05-22): Blender
fidelity > Cubism fidelity** — when the SS authoring model conflicts with
Cubism quirks, choose Blender; the `.cmo3`/`.moc3` export is a downstream
adapter. Cubism-export byte-fidelity is NOT a hard blocker; protect viewport/
eval, adapt export.

## Goal

A Cubism "GroupRotation" deformer (`GroupRotation_grp-<hash>`, surfaced as a
`ROTATION` entry in `part.modifiers[]`) is, in Blender, an **armature bone**
that rotates its weighted meshes around its head (the pivot). Replace the
deformer-as-modifier model with bones; re-synthesise the Cubism deformer at
export/eval time (the adapter).

This is the second of two related efforts shipped this session:
1. **Bone-baked PART skinning → Blender LBS** (SHIPPED): viewport live LBS off
   FK bone pose; export bakes LBS (`bakeBoneRotationLBS`, proven == viewport's
   `applyTwoBoneSkinning`). Commits `a355547`, `d3a205b`, `6f93b71`.
2. **GroupRotation → bone** (THIS doc): Slices A–F shipped+validated; G remains.

## The autonomous test framework (the key enabler — no browser needed)

`scripts/test/realRigHarness.mjs` runs the **real Init-Rig pipeline
(`generateCmo3`) in Node**, producing the real rigSpec (real rotation
deformers, real artMesh vertex FRAMES, real parent chains). **This is the
substitute for in-browser verification** — the pipeline output is the ground
truth. Use `harvestRealRig(project)` / `evalRigSpec(rigSpec, params)` /
`artMeshOf` / `rotationOf`. It already caught + corrected a wrong coord-space
assumption.

## GROUNDED findings (from `test_groupRotationRealRig.mjs` — real pipeline)

- A non-bone group DOES get a `GroupRotation_<g>` deformer; the part is
  parented to it with **pivot-relative** keyforms, while `verticesCanvas`
  already holds the **canvas-px** rest → bone-model conversion needs NO coord
  guessing.
- Group rotations are **WARP-PARENTED by default** (authored pivot is warp-
  local `(0,0)`; they sit under the body-warp chain). So warp-parented is the
  COMMON case.
- The **bone head = canvas-final REST pivot = `mesh.vertices[i] −
  pivotRelKeyform[i]`** (constant; = the part centroid). The warp chain above
  the rotation is preserved as the part's runtime parent (body warps still
  deform the mesh, THEN the bone rotates it).
- RULE №4 divergence: the bone head is FIXED (Blender) vs Cubism's warp-MOVED
  pivot. They coincide at warp-rest; they intentionally differ under a
  deformed warp (only when BodyAngle ≠ 0 AND the group rotation ≠ 0 — a
  second-order interaction). The bone (fixed) is correct per RULE №4.

## Slices

| Slice | What | Commit | Status |
| --- | --- | --- | --- |
| A | characterization oracle (`test_groupRotationCharacterization`) locks current GroupRotation depgraph eval | `8e38291` | ✅ |
| B | `isGroupRotationBoneNode` + `GROUP_ROTATION_BONE_ROLE_PREFIX` seam (`warpLatticeAccess`) | `4f66ae1` | ✅ |
| C | `synthesizeGroupRotationDeformers` (bone→transient deformer, byte-identical to legacy via `buildGroupRotationSpec`→`rotationSpecToDeformerNode`) | `4f66ae1` | ✅ |
| D | wire synth into `synthesizeDeformerNodesForExport` (inert pre-migration) | `0040a02` | ✅ |
| E | depgraph LBS evals a group-rotation BONE == the deformer, byte-for-byte (`test_groupRotationBoneEval`) — **eval reroute needs NO depgraph code** | `1ba3804` | ✅ |
| F | `migrateGroupRotationDeformersToBones` (`src/store/migrations/groupRotationToBone.js`) — VALIDATED: bone model reproduces deformer eval at rest+30° (`test_groupRotationMigration`) | `e6d4438` | ✅ |
| — | param mirror auto-includes group-rotation bones (skinning-based `_buildBoneMirrorEntries`); no wiring needed | `493bde0` | ✅ |
| G | **ACTIVATION (remaining)** — see below | — | ⬜ |

## Slice G — the remaining activation (well-defined, churny)

Wire the **validated** migration live + reconcile. Steps:
1. **seedAllRig flip**: call `migrateGroupRotationDeformersToBones(proj)` near the
   end of `seedAllRig` (projectStore.js, AFTER `persistArtMeshRuntime` +
   `synthesizeModifierStacks`), then re-run `synthesizeModifierStacks` +
   `synthesizeDeformerParents` (the bone-bound parts gain an Armature modifier
   + lose the rotation entry). Expose via the `peers` bridge
   (`projectStoreRigPeers.js`) like the other rig fns.
2. **Register the migration** in `projectMigrations.js` (versioned) so EXISTING
   projects upgrade on load. NOTE the coupling: the migration drops the
   `ParamRotation` binding, so it MUST land with the param mirror (which
   auto-works) — confirm the slider still drives the bone post-migration.
3. **Reconcile the test churn**: every test that asserts the OLD rotation-
   deformer structure (e2e_equivalence, initRig, sideBySide, modifierStacks,
   etc.) will now see BONES. Update them to assert the bone model. This is
   expected + correct per RULE №4.
4. **Before flipping — build the real-rig seed-validation** (the harness's
   missing `rigSpec → project.nodes` step, mirroring `seedAllRig`): harvest a
   real WARP-PARENTED rig (multiple group rotations; a part under BOTH a
   skeleton bone AND a group rotation), seed → migrate → eval (depgraph),
   assert == the real `@30` baseline. This proves the flip safe across the
   COMPLEX real cases, not just the root-parented fixture. The warp-MOVED-pivot
   non-rest divergence is intended (don't assert it matches the old Cubism).

## Key files

```
scripts/test/realRigHarness.mjs                 — autonomous real-rig harness (no browser)
scripts/test/test_groupRotationRealRig.mjs      — GROUNDED coord-space findings + frozen @30 baseline
src/store/warpLatticeAccess.js                  — isGroupRotationBoneNode seam (B)
src/io/live2d/rig/synthesizeGroupRotationDeformers.js — bone→deformer adapter (C)
src/io/live2d/rig/synthesizeDeformerNodesForExport.js — wires the synth (D)
src/store/migrations/groupRotationToBone.js     — the migration (F)
scripts/test/test_groupRotationMigration.mjs    — migration eval-equivalence proof (F)
scripts/test/test_groupRotationCharacterization.mjs — Slice-A oracle
scripts/test/test_groupRotationBoneEval.mjs     — Slice-E LBS==deformer proof
src/store/rigSpecStore.js:_buildBoneMirrorEntries — param mirror (auto-includes bones)
src/store/projectStore.js:seedAllRig            — where the G flip goes
```

## Test status

Full suite 324 pass / 2 known-pre-existing fails (`test_audit_fixes_2026_05_11_
phase1_stage1e`, `phase7d` — unrelated, always-failing). Typecheck clean.

## Follow-up (RULE №4, tracked in memory)

After this ships: audit OTHER Cubism-leak sites — ParamRotation indirection
generally, param-driven keyform bakes, the deformer-chain vs modifier-stack
representation, masks, physics coupling. Spawn agents (RULE №3).
