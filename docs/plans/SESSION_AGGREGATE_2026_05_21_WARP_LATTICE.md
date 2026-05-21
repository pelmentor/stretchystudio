# Session aggregate — Warps → Lattice objects (2026-05-20/21)

Concise index of the warp-as-lattice-object refactor work this session. Full
detail lives in [WARP_AS_LATTICE_OBJECT_REFACTOR_PLAN.md](WARP_AS_LATTICE_OBJECT_REFACTOR_PLAN.md);
this is the compact-resumption anchor.

## What shipped (all pushed to origin through `85b4f43`)

| Commit | What |
| --- | --- |
| `f6cedd7` | **Phase 0** — byte-fidelity gate. `scripts/test/test_warpExportOracle.mjs` pins `selectRigSpec().warpDeformers` (the `warpSpecs` the moc3/cmo3 emitters consume **unchanged**) → hash **`f50b6178`**. + design decisions resolved (Blender DNA-grounded). |
| `c822b02` | **Slice 1.A core** — `src/store/warpLatticeAccess.js` classifier seam (`isWarpLatticeNode` / `isRotationDeformerNode` / `isChainDeformerNode` + `getWarpRestGrid`); routed depgraph build + 4 kernels + selectRigSpec raw-node refs + deformerNodeReaders through it. Behaviour-identical. |
| `ee9c741` | **Slice 1.A UI** — seamed KeyformGraphEditor find-by-targetPartId + OutlinerEditor warp-row decoration. |
| `6852deb` | **Slice 1.B** — THE FLIP. v43 migration: `deformer/warp` node → `{type:'object', objectKind:'lattice'}` (id reused) + `meshData` cage (vertices = baseGrid reshaped) + part modifier `{type:'warp', deformerId, data}` → `{type:'lattice', objectId}` (object is single source of truth). Seam internals + `getMesh` lattice support + synth adapter resolves lattice mods + `synthesizeModifierStacks`/`Parents` lattice-aware. Oracle stays `f50b6178` (migrate→select lossless). |
| `5fc7d99` | **Docs** — "How Blender ACTUALLY does it": modifier sits on the affected piece (`LatticeModifierData.object`); the lattice object owns cage + shape-keys (keyforms); params drive the shape-key blend. |
| `85b4f43` | **Dual-audit fix** — re-seed path made lattice-aware (cage cleanup on remove/replace; NeckWarp guard); +3 regression tests. |

## Current state

- **Warps ARE first-class Lattice objects** now. Load → migrate → lattice
  objects + cage meshData; the part carries `{type:'lattice', objectId}`.
- **Byte-fidelity intact:** oracle `f50b6178` unchanged (migrate→selectRigSpec
  is lossless → Cubism export bytes unchanged by construction).
- **Eval parity:** depgraph kernels read `keyforms`/`gridSize` (not the rest
  cage), so the cage-→-meshData move doesn't touch the hot path; side-by-side
  + e2e suites green.
- **Audits:** Blender-fidelity PASS (all DNA cites verified). Architecture
  re-seed bugs fixed.
- Tests run individually (`node scripts/test/test_*.mjs`) — the `npm test`
  mega-chain exceeds cmd.exe's 8191-char limit on this Windows box.

## Blender model (the canonical answer, mirrored by v43)

- **Modifier** → on the **affected pieces** (layer pieces), referencing the
  warp object via `objectId` (= Blender `LatticeModifierData.object`,
  `DNA_modifier_types.h:285`). NOT on the warp object.
- **Geometry + shape-keys** → on the **lattice object**: the editable rest
  cage = `meshData.vertices` (Basis); per-param deformed cages = `keyforms[]`
  (= KeyBlocks). The object has no modifier of its own.
- **Parameters** → drive the object's keyform (shape-key) blend (`bindings[]`
  + `keyTuple` + `cellSelect`; an N-D generalisation of Blender's 1-D
  `KeyBlock.curval`). Editing a keyform = editing the cage at that param value.

## Remaining work (next sessions)

- **Phase 3 — UI (the visible payoff).** Outliner lattice icon + selectability;
  Properties section routing for `objectKind:'lattice'` (the section registry
  keys on node type); Modifier object-picker; Node Tree lattice node; **Edit-
  Mode cage editing** (where "editable blendshapes" become directly editable —
  reuse the exit→refit path). Ensure the cage `meshData` doesn't leak as its
  own Outliner row.
- **Phase 4 — Export re-derivation** from the grid object; byte-diff vs the
  Phase-0 oracle. (Likely already covered since selectRigSpec output is
  pinned; confirm the cmo3 `CWarpDeformerSource` path.)
- **Phase 5 — Auto-rig writers EMIT lattice objects.** TODAY re-seeding writes
  the legacy `deformer/warp` shape (the seam reads both, so it works, but a
  v43 project can carry a permanent mix). Flip `deformerNodeSync.warpSpecToDeformerNode`
  + the store seeders (bodyWarpStore/rigWarpsStore/faceParallaxStore/projectStore
  seedAllRig) to emit `{type:'object', objectKind:'lattice'}` + cage. Removes
  the dual-shape coexistence.
- **Phase 6 — Cleanup (Rule №2).** Once Phase 5 lands, drop the
  `deformer/warp` arm from `isWarpLatticeNode` + the synth adapter's legacy
  data-fold path + the dual hierarchy/modifier link.

## Key files

```
src/store/migrations/v43_lattice_substrate.js   — the flip migration
src/store/warpLatticeAccess.js                  — the classifier seam (flip point)
src/store/objectDataAccess.js:getMesh           — resolves dataId for lattice objects
src/io/live2d/rig/synthesizeDeformerNodesForExport.js — adapter: lattice mod → transient warp shape
src/store/deformerNodeSync.js                   — writers + synthesizeModifierStacks/Parents (lattice-aware)
scripts/test/test_warpExportOracle.mjs          — f50b6178 gate (migrate→select)
scripts/test/test_migration_v43.mjs             — migration structure (31 asserts)
```
