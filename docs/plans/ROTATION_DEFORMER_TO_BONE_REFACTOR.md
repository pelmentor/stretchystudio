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
2. **GroupRotation → bone** (THIS doc): **ALL SLICES A–G SHIPPED + validated**
   (2026-05-23). The authoring model is now Blender-faithful: a Cubism
   GroupRotation is an armature bone; export re-synthesises the deformer.

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
| G | **ACTIVATION** — seedAllRig flip + v44 migration + harness seed step + 2 bug-fixes — see below | — | ✅ |

## Slice G — ACTIVATION (SHIPPED 2026-05-23)

All four steps done; the validation harness caught + fixed **two real migration
bugs** before the flip went live.

1. **seedAllRig flip** ✅ — `peers.migrateGroupRotationDeformersToBones(proj)`
   runs in `seedAllRig` right AFTER `persistArtMeshRuntime` and BEFORE the
   existing `synthesizeModifierStacks` + `synthesizeDeformerParents` (so the
   single synth pass picks up the bone model — Armature modifier, no stale
   rotation entry; no double-synth). Exposed via `projectStoreRigPeers.js`.
2. **v44 migration** ✅ — `migrations/v44_group_rotation_to_bone.js` clears
   `lastInitRigCompletedAt` (mirrors v29) to force an async re-Init-Rig on load,
   so the conversion runs on `seedAllRig`'s canonical live-shape path rather
   than duplicating the v18 Object/ObjectData mesh resolution. `CURRENT_SCHEMA_
   VERSION` 43→44. Param mirror auto-keeps the `ParamRotation_<g>` slider driving
   the bone (verified by the eval-equivalence tests).
3. **Test churn** ✅ — minimal: the v29 idempotence test updated (v44 now also
   clears the timestamp for pre-v44 projects); the 10 previously-UNWIRED
   GroupRotation/seedAllRig/perPartRotation tests added to `package.json` (they
   existed but never ran in CI). No test asserted the old rotation-deformer
   structure post-store-pipeline (export rigSpec still synthesises rotation
   deformers via the Slice-C/D adapter, so generateCmo3 tests are unaffected).
4. **Real-rig seed-validation** ✅ — `realRigHarness.seedRigSpecToNodes` is the
   missing `rigSpec → project.nodes` inverse of `harvestRealRig` (seeds the body
   warp lattice chain + rotation deformer nodes + `persistArtMeshRuntime` +
   synth, mirroring `seedAllRig`). `test_groupRotationMigrationRealRig` harvests
   a real NESTED warp-parented rig (`GroupRotation_accessory`/`_trinket` chained
   under `GroupRotation_torso` under `BodyXWarp`), seeds → evals deformer
   baseline → migrates → evals bone model, asserting byte-equivalence at rest,
   single, and NESTED rotation. 17/17.

### The two bugs the validation caught (both fixed in `groupRotationToBone.js`)

- **Warp-coupling for nested rotations** — the first fix attempt routed a
  nested-rotation part's runtime parent to the body-warp ancestor (walking
  through the rotation chain). WRONG: in the deformer model the rotation is
  canvas-final, which BREAKS the modifier-chain walk before the warp — the warp
  never lattice-deforms the geometry; it only moves the rotation PIVOT (the
  "warp-MOVED pivot"). Per RULE №4 the bone head is FIXED, so that pivot motion
  is intentionally dropped. Re-parenting to the warp ADDED a deformation the
  deformer model never applied (eval exploded ~115k px). FIX: group-rotation
  parts are **root-parented** (`resolveParentRef → {type:'root'}`); they carry
  no body-warp lattice in their stack.
- **No-direct-part container pivot** — a container rotation (only sub-rotations,
  no direct mesh, e.g. `GroupRotation_torso`) has a warp-LOCAL authored
  `originX/Y` (e.g. `(0.5,0.5)`), unusable as a canvas pivot. FIX:
  `deriveCanvasPivot` recovers it from a child rotation —
  `childCanvasPivot − child.authoredOrigin` (a rotation-parented deformer's
  origin is a canvas-px offset from its parent's pivot). Recurses bottom-up;
  consistent across multiple children (accessory & trinket both yield torso's
  `(630,410)`).

The warp-MOVED-pivot non-rest divergence (bone fixed vs Cubism warp-moved) is
intended and NOT asserted.

## Key files

```
scripts/test/realRigHarness.mjs                 — autonomous real-rig harness; harvestRealRig + seedRigSpecToNodes (G)
scripts/test/test_groupRotationRealRig.mjs      — GROUNDED coord-space findings + frozen @30 baseline
scripts/test/test_groupRotationMigrationRealRig.mjs — G real-rig nested+warp eval-equivalence (17/17)
src/store/warpLatticeAccess.js                  — isGroupRotationBoneNode seam (B)
src/io/live2d/rig/synthesizeGroupRotationDeformers.js — bone→deformer adapter (C)
src/io/live2d/rig/synthesizeDeformerNodesForExport.js — wires the synth (D)
src/store/migrations/groupRotationToBone.js     — the migration (F); deriveCanvasPivot + root-parent fix (G)
src/store/migrations/v44_group_rotation_to_bone.js — versioned migration: force re-rig (G)
src/store/projectMigrations.js + projectSchemaVersion.js — v44 registered, CURRENT=44 (G)
src/store/projectStoreRigPeers.js               — peers bridge exposes the migration (G)
scripts/test/test_groupRotationMigration.mjs    — migration eval-equivalence proof (F)
scripts/test/test_groupRotationCharacterization.mjs — Slice-A oracle
scripts/test/test_groupRotationBoneEval.mjs     — Slice-E LBS==deformer proof
src/store/rigSpecStore.js:_buildBoneMirrorEntries — param mirror (auto-includes bones)
src/store/projectStore.js:seedAllRig            — the G flip (migrate after persistArtMeshRuntime, before synth)
```

## Test status (2026-05-23, post-G)

Typecheck clean. All 46 GroupRotation/seedAllRig-referencing tests + 10
integration tests (e2e_equivalence, shelbyByteFidelity, saveLoadRigSpec,
initRigStacksCanonical, livePreviewWiring, depgraphSideBySide, runStage-
Integration, …) pass. The 10 GroupRotation-family tests are now WIRED into the
`npm test` chain (they existed but had no `package.json` script). `npm test`
itself can't launch on Windows (the chain exceeds the cmd 8191-char limit) —
run tests individually or via a shell loop.

## Follow-up (RULE №4, tracked in memory)

Now that GroupRotation→bone has shipped end-to-end: audit OTHER Cubism-leak
sites — ParamRotation indirection generally, param-driven keyform bakes, the
deformer-chain vs modifier-stack representation. Spawn agents (RULE №3).
**Physics + masks/clips are OUT of scope** (user, 2026-05-23) — they're
intentional SS features adapted from Cubism, kept as-is, not leaks to fix.
