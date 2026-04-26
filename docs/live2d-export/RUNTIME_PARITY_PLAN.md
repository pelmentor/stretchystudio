# Runtime export parity plan

## Goal

Make `exportLive2D` (the runtime path that produces `.moc3` + `.model3.json` +
`.motion3.json` + `.physics3.json` + atlas PNGs in a ZIP) byte-equivalent — at
the rig-data level — to what Cubism Editor produces when a user re-exports a
.cmo3 we generated via "File → Export For Runtime".

In other words: the user should be able to skip the Cubism Editor round-trip
entirely. Today, the cmo3 path generates a full rig (warp/rotation deformers,
keyforms, parts hierarchy, parameter groups, …); the runtime path generates
only the atlas + minimal moc3 with no deformer infrastructure, so the runtime
model loads but doesn't deform when params animate.

## Diagnosis

The two writers were built at different times and never shared a data layer:

* `cmo3writer.js` (4598 LOC) generates the rig **inline** while emitting XML.
  Standard params, bone rotation params, variant params, warp deformers,
  rotation deformers, keyforms, parts — all decided and written as side
  effects of XML emission.
* `moc3writer.js` (~750 LOC) reads `project.parameters` (always empty for
  fresh PSD imports — nothing in the codebase populates it). It emits art
  meshes, no deformers, and used to fall back to a single-`ParamOpacity`
  parameter list.

Result before the work began this session: runtime moc3 was a static collage
of meshes. ParamSmile defaulted to 1 (or rather, the variant mesh sat at full
opacity over the base because there was no fade keyform), no cursor tracking,
no body sway.

## Already shipped

### Phase B + C — RigSpec data layer + moc3 binary translator (2026-04-26)

The runtime moc3 export now ships with a working rig. `cmo3writer` runs in
`rigOnly` mode to harvest the shared `RigSpec`; `moc3writer` translates
that spec into binary deformer sections.

**rig/ modules**

* `rig/rigSpec.js` — JSDoc types for `WarpDeformerSpec`,
  `RotationDeformerSpec`, `ArtMeshSpec`, `PartSpec`, `KeyformBindingSpec`,
  the three keyform variants. Documents the local-frame contract.
  Provides `emptyRigSpec(canvas)` factory and `findDeformer/findPart`
  helpers. `RigSpec` carries `canvasToInnermostX/Y` so writers can
  project canvas-px positions into the deepest body warp's 0..1 frame.
* `rig/warpDeformers.js` — `buildNeckWarpSpec`. Pure data; the cmo3
  emit helper consumes it and emits XML.
* `rig/rotationDeformers.js` — `buildFaceRotationSpec`,
  `buildGroupRotationSpec`. Same pattern.
* `rig/bodyWarp.js` — `buildBodyWarpChain` produces the four
  `WarpDeformerSpec` entries for BZ → BY → Breath → BX, plus
  `canvasToBodyXX/Y` normaliser and the body-anatomy debug log
  (HIP_FRAC, FEET_FRAC, spineCfShifts).

**cmo3writer changes**

* Imports the rig builders. Calls `buildBodyWarpChain` near line 2419,
  replacing ~50 LOC of inline bbox/anchor/spine math.
* The body warp emission block (~360 LOC of inline math + XML) is now a
  spec-driven translator loop; the math lives in `bodyWarp.js`.
* `emitNeckWarp`, `emitFaceRotation` consume specs from the rig builders
  and translate to XML via existing `emitSingleParamKfGrid` +
  `emitStructuralWarp` helpers.
* The deferred group-rotation block (lines ~1605–1758) also pushes a
  `RotationDeformerSpec` per group into `rigCollector`. The re-parenting
  pass updates both the XML refs AND the rigCollector entries so the
  spec reflects the FINAL parent (post re-parenting). Pivot conversion
  (canvas → BodyXWarp 0..1 OR canvas-px-from-parent-pivot) is mirrored
  back into the spec's keyforms.
* `generateCmo3` accepts a `rigOnly: true` flag that short-circuits
  before XML / CAFF emission and returns just the rigSpec. Used by the
  runtime path.

**moc3writer changes**

* Accepts `rigSpec` in input. When provided, emits:
  * `deformer.*` (umbrella section: ids, parents, types, specific_indices)
  * `warp_deformer.*` + `warp_deformer_keyform.*`
  * `rotation_deformer.*` + `rotation_deformer_keyform.*`
* Unified keyform binding system: art-mesh bindings (variant fade,
  ParamOpacity) and deformer bindings (ParamBodyAngleX/Y/Z, ParamBreath,
  ParamAngleZ, ParamRotation_*) coexist in one ordered list. Each
  parameter owns a contiguous range in `keyform_binding_index`.
* Mesh vertex positions go through `rigSpec.canvasToInnermostX/Y` —
  the BZ → BY → Breath → BX chain — so they live in BodyXWarp's 0..1
  local frame, matching the parent-deformer-local convention.
* Art meshes get `parent_deformer_index = BodyXWarp` (innermost body
  warp) and `parent_part_index = -1`.
* Warp keyform positions stored per `WarpDeformerSpec.localFrame`:
  `canvas-px` → normalised by PPU; `normalized-0to1` → as-is;
  `pivot-relative` → divided by PPU.

**exporter.js changes**

`exportLive2D` builds mesh data via `buildMeshesForRig` (no PNG render),
calls `generateCmo3` in `rigOnly` mode to harvest the rigSpec, discards
the cmo3 buffer, and passes the rigSpec to `generateMoc3`. Same paramSpec
+ physics3 + motion presets wiring as before.

**What works after Phase B+C+D (full parity pass)**

* Body sway on ParamBodyAngleX / Y / Z (BodyWarpZ/Y/X morph the body)
* Breath (BreathWarp morphs subtly on ParamBreath)
* Head tilt on ParamAngleZ (FaceRotation rotation deformer)
* Head turn on ParamAngleX / Y (FaceParallax warp under FaceRotation)
* Neck follow (NeckWarp on ParamAngleZ)
* Group rotations (head, neck, arms, …) on ParamRotation_<group>
* Per-mesh rig warps: tag-specific 5×5 warp per face/neck/body-region mesh
  with cross-product keyforms on TAG_PARAM_BINDINGS axes (eye closure on
  ParamEyeLOpen, mouth shape on ParamMouthOpenY, brow Y on ParamBrowL/RY,
  hair sway on ParamHairFront/Side/Back, etc.). Mesh deforms via the
  rig warp's grid morphing on its driving params.
* Variant fade on Param<Suffix> (Stage 2a)
* Bone-baked keyforms: arm/leg meshes get 5 keyforms across
  ParamRotation_<bone> at angles [-90, -45, 0, +45, +90]° with vertex
  positions rotated around the bone's canvas pivot, weighted by
  boneWeights. Arms now deform when the bone's rotation param drives.
* Per-mesh vertex frame conversion: rig-warp-parented meshes use 0..1
  of the rig warp's canvas bbox; body-only meshes use BodyXWarp 0..1.
  Matches cmo3's mesh-emission frame convention.
* Clip masks: iris meshes are masked by their corresponding eyewhite
  (variant-aware), via `drawable_mask.art_mesh_indices` +
  `art_mesh.mask_begin_indices` / `mask_counts`.

**Known polish gaps (cosmetic, deferrable)**

* Variant eye 2D compound geometry: variant eye meshes (eyewhite-l.smile
  etc.) currently use their parent rig warp's keyforms only. cmo3
  additionally fits 4 cells across ParamEyeLOpen × Param<Suffix> with
  variant-specific eyewhite curves. moc3 ships the simpler 1D fade.
* Neck corner shape keys: cmo3 emits per-vertex corner offsets on
  ParamAngleZ for natural neck bending. moc3 relies on the NeckWarp
  grid morph alone — close but not identical.
* Parts hierarchy: moc3 emits groups as parts (1:1) rather than the
  category-bucketed part tree cmo3 builds.
* Per-mesh frame conversion when the rig warp's parent isn't BodyXWarp
  (e.g. face/neck rig warps parent to FaceParallax / NeckWarp). Mesh
  vertex frame currently treats them all as BodyXWarp's frame — works
  visually for endpoints but may show subtle frame mismatch at extreme
  parameter values.

These remaining gaps don't block functional use of the runtime moc3 —
the model loads, deforms across all standard parameters, blinks, tracks
the cursor, and rotates. They represent the long tail of cmo3-emit
fidelity that lands incrementally after user feedback identifies which
gaps actually show up visually in their characters.

### Binary-diff parity pass — shipped 2026-04-26

After Phase B+C+D landed, the runtime moc3 loaded but rendered with several
visual defects: face/head/arms missing, no eye blink, "Assign Clipping of
ArtMeshes have keyform problems" warning on load. Resolved via byte-level
comparison against Cubism Editor's "Export For Runtime" output on the same
.cmo3 (the reference moc3 sits at `New Folder_cubism/shelby.moc3` in the dev
worktree). Three Cubism-Editor-compile-time field semantics weren't being
replicated by direct moc3 emission — see [MOC3_FORMAT.md → Compile-time
semantics](MOC3_FORMAT.md#compile-time-semantics-cmo3--moc3) for details.

Concretely fixed in this pass:

* **`rotation_deformer_keyform.scales` = `1 / canvasMaxDim` when the rotation's
  parent is a warp; `1.0` when the parent is another rotation.** The cmo3
  XML always carries `scale="1.0"`. Cubism Editor patches the value on
  compile based on parent type. Without the patch, every rotation→warp
  transition (GroupRotation_head → BodyXWarp, GroupRotation_<arm> →
  BodyXWarp, etc.) blew up child positions by 1792× — head/face/arms
  rendered far off-canvas. Fix in `moc3writer.js` rotation-keyform emit.
* **`parameter.keyform_binding_begin_indices` indexes `keyform_bindings`,
  not `keyform_binding_indices`.** And bindings must be ordered such that
  all bindings for the same param are contiguous (so the runtime can read
  `[begin, begin+count)` consecutively). moc3writer now sorts the unique-
  binding pool by owning param order before emitting.
* **Per-mesh keyform plan must mirror cmo3's branches.** Default meshes
  emit 1 keyform on `ParamOpacity[1.0]`, not 2 on `ParamOpacity[0,1]`.
  Variant base meshes (non-backdrop) emit 2 keyforms with opacity 1→0
  on `Param<Suffix>`. Eye-closure meshes (eyelash/eyewhite/irides per
  side) emit 2 keyforms on `ParamEye{L,R}Open[0,1]` with closed-eye
  vertex positions at key=0 and rest at key=1. Cubism's runtime is
  picky about ParamOpacity keyform layouts; uniform 2-key on `[0,1]`
  produced orphan slots and half-canvas overlay artefacts.
* **Mesh-level eye closure shared between writers.** Split
  `computeClosedVertsForMesh` in cmo3writer into a canvas-frame helper
  (`computeClosedCanvasVerts`) plus a local-frame wrapper. cmo3's
  per-mesh loop pushes `{closureSide, closedCanvasVerts}` into
  `rigCollector.eyeClosure` (per partId) BEFORE the rigOnly short-circuit
  fires, so moc3writer can read the canvas-frame closed verts and
  convert to its own per-mesh frame. Resolves both the missing blink
  animation and the "ArtMesh4/7 have no keyforms at maximum/minimum"
  load-time warning (eyewhite_l/r now share the [0,1] keyform range
  the irides clip against).

Inspector scripts in `scripts/`:
`moc3_inspect.py` (counts + parts + deformers + parameters + art meshes
+ bindings + bands), `moc3_inspect_rot.py` (rotation keyforms labelled
by deformer id), `moc3_inspect_warp.py` (warp grid keyforms), and
`moc3_inspect_mesh.py` (art-mesh keyform position bboxes). Run on any
`.moc3` to dump structure; diff against Cubism's reference output to
localize divergences.

### Stage 1 — Parameter spec extraction (2026-04-26)

`src/io/live2d/rig/paramSpec.js` is the single source of truth for the
parameter list. `buildParameterSpec({baseParameters, meshes, groups,
generateRig})` returns ordered `[{id, name, min, max, default, decimalPlaces,
repeat, role, variantSuffix?, boneId?}]`. Roles: `opacity` | `project` |
`variant` | `standard` | `bone`.

* `cmo3writer` now `paramSpecs.map(spec => …)` to materialise its `paramDefs`
  with XML pids attached. Inline param generation deleted.
* `moc3writer` calls the same builder. `project.parameters ?? []` reads gone.
* `exporter.js` builds the spec once at the top of `exportLive2D` and reuses
  it for cdi3 metadata, physics3 paramId gating, motion-preset target ids,
  and model3 LipSync/EyeBlink auto-discovery.

### Stage 2a — Variant fade in moc3 keyform binding (2026-04-26)

Per-mesh `meshBindingPlan` in `moc3writer`: variant meshes (`foo.smile`) get
two keyforms (opacity 0 at suffix=0, opacity 1 at suffix=1) bound to
`Param<Suffix>`. Non-variant meshes stay at one keyform on `ParamOpacity`.
`keyform_binding_index` is now ordered by owning param so each parameter's
`keyform_binding_begin/count` range is contiguous and correct.

Fixes "always smiling": at ParamSmile=0 the variant is invisible and only the
base shows. Endpoints at 0 and 1 are correct; midpoint is still translucent
(base stays opaque) — proper fix is base-fade, which lands with Stage 2b.

## Still broken — what Stage 2b/2c must fix

* No warp deformers in moc3. ParamAngleX/Y/Z, ParamBodyAngleX/Y/Z animate but
  nothing responds. Body is visually frozen.
* No rotation deformers in moc3 (group rotations, face rotation, bone-baked).
* No deferred `ParamRotation_<groupName>` params (cmo3writer line ~1640
  still creates them inline during the deformer loop).
* No base-fade keyforms paired with variant fade-in.
* No cross-product 2D keyform grids (eye 2D compound: ParamEyeLOpen ×
  Param&lt;Suffix&gt;).
* No drawable mask/glue/draw-order-group rig (currently emits dummy entries).

## Architecture target

```
src/io/live2d/rig/
  paramSpec.js          ✓ shipped
  rigSpec.js            ← types + builder orchestration
  warpDeformers.js      ← rig warps, body chain, neck warp, face parallax (data only)
  rotationDeformers.js  ← group rotation defs, face rotation (data only)
  artMeshSpec.js        ← per-mesh keyforms, parents, dual-position resolution
  keyforms.js           ← KeyformBindingSource / KeyformGridSource models
  partsHierarchy.js     ← groups → parts, parent chains, category buckets

src/io/live2d/cmo3writer.js
  → builds RigSpec via rig/* modules, emits XML from RigSpec
  → ALL XML emission stays here. Logic that decides "what deformer to make"
    moves to rig/.

src/io/live2d/moc3writer.js
  → builds RigSpec via the same rig/* modules, emits binary from RigSpec
  → ALL binary emission stays here.

src/io/live2d/cmo3/  (existing helpers)
  → keep deformerEmit/bodyRig/faceParallax for now, but they emit XML *from a
    RigSpec entry* instead of computing+emitting in the same function.
```

`RigSpec` is the contract. Once both writers consume the same spec, parity is
by construction — anything that diverges between cmo3 and moc3 is a translator
bug, not a logic difference.

## RigSpec data shape (draft)

```js
/**
 * @typedef {Object} RigSpec
 * @property {ParamSpec[]} parameters     // already shipped (paramSpec.js)
 * @property {PartSpec[]} parts
 * @property {WarpDeformerSpec[]} warpDeformers
 * @property {RotationDeformerSpec[]} rotationDeformers
 * @property {ArtMeshSpec[]} artMeshes
 * @property {ParameterGroupSpec[]} parameterGroups   // category buckets
 *
 * Order of arrays is the canonical order writers emit in.
 */

/**
 * @typedef {Object} PartSpec
 * @property {string} id
 * @property {string} name
 * @property {string|null} parentPartId
 */

/**
 * @typedef {Object} WarpDeformerSpec
 * @property {string} id
 * @property {string} name
 * @property {{type:'part'|'warp'|'rotation'|'root', id:string|null}} parent
 * @property {{rows:number, cols:number}} gridSize    // typically 6×6
 * @property {Float64Array} baseGrid                  // (cols+1)*(rows+1)*2 in canvas px
 * @property {KeyformBindingSpec[]} bindings          // 1+ params drive this deformer
 * @property {KeyformSpec[]} keyforms                 // cross-product cells; vertex offsets
 * @property {'canvas-px'|'normalized-0to1'|'pivot-relative'} localFrame
 */

/**
 * @typedef {Object} RotationDeformerSpec
 * @property {string} id
 * @property {string} name
 * @property {{type:'part'|'warp'|'rotation'|'root', id:string|null}} parent
 * @property {{x:number, y:number}} originCanvas      // origin in CANVAS px (translator
 *                                                    // converts to parent-local)
 * @property {number} baseAngle                       // degrees
 * @property {KeyformBindingSpec[]} bindings
 * @property {RotationKeyformSpec[]} keyforms         // {angle, originX, originY, scale, …}
 */

/**
 * @typedef {Object} ArtMeshSpec
 * @property {string} id
 * @property {string} name
 * @property {{type:'part'|'warp'|'rotation', id:string|null}} parent
 * @property {string|null} variantSuffix
 * @property {Float64Array} verticesCanvas            // [x0,y0, x1,y1, …] CANVAS px
 *                                                    // (translator converts keyform
 *                                                    // positions to deformer-local)
 * @property {Uint16Array} triangles                  // flat [i0,j0,k0, …]
 * @property {Float32Array} uvs                       // [u0,v0, …] 0..1 of full PSD
 * @property {KeyformBindingSpec[]} bindings
 * @property {ArtMeshKeyformSpec[]} keyforms          // {opacity, drawOrder, vertexOffsets}
 * @property {DrawableMaskSpec[]} masks
 */

/**
 * @typedef {Object} KeyformBindingSpec
 * @property {string} parameterId
 * @property {number[]} keys                          // param values where keyforms live
 */

/**
 * @typedef {Object} KeyformSpec
 * @property {number[]} keyTuple                      // one value per binding (cross-product cell)
 * @property {Float32Array} vertexOffsets             // grid-relative or vertex-relative
 * @property {number} opacity
 * @property {number} drawOrder
 */
```

Open questions logged below feed into finalising the types.

## Phased rollout

### Phase A — Types + neck warp pilot

1. Write `rig/rigSpec.js` with the JSDoc type definitions (no logic).
2. Pick `emitNeckWarp` (~80 LOC, isolated) and refactor it: split into
   `buildNeckWarpSpec()` returning a `WarpDeformerSpec` and
   `emitNeckWarpXml(spec, x)` consuming the spec.
3. Validate the cmo3 path still loads in Cubism Editor identically (logically,
   not byte-identical XML — see open question below).

If the neck-warp pilot lands cleanly, scale up.

### Phase B — Refactor cmo3 helpers to spec-emit

In dependency order:

* `emitFaceRotation` → `RotationDeformerSpec`
* `emitFaceParallax` → `WarpDeformerSpec`
* `emitStructuralWarp` → per-mesh `WarpDeformerSpec`
* Body warp chain (BZ, BY, Breath, BX, lines 3114–3473) → 4 `WarpDeformerSpec`s
* Group rotation deformers (1460–1758) → `RotationDeformerSpec`s
* CArtMeshSource emission (3635–4068) → `ArtMeshSpec`s with keyforms
* Parts hierarchy (1332–1458) → `PartSpec[]`
* Re-parenting pass (3533–3592) → mutate `WarpDeformerSpec.parent`

After every helper migration: cmo3 export must regenerate and load in
Cubism Editor. Visual diff against pre-refactor exports.

### Phase C — moc3 binary translator

* RigSpec → moc3 sections: warp_deformer (rows/cols/vertex_counts/keyform
  ranges), rotation_deformer (base_angles + keyform angles/origins/scales),
  art_mesh.parent_deformer_indices, keyform_binding/index/band restructure
  to handle 2D grids and cross-product cells.
* Reference: py-moc3 + Hiyori sample.
* Verify: load runtime ZIP in Cubism Viewer; manipulate every standard param;
  compare against Cubism's "Export For Runtime" output on the same .cmo3.

### Phase D — Cleanup

* Delete dead inline code in cmo3writer.
* Port deferred ParamRotation_&lt;groupName&gt; generation from cmo3writer
  line ~1640 into `rig/`.
* Fold base-fade keyforms (1→0 on Param&lt;Suffix&gt; for non-backdrop
  bases) into the variant pairing pass.
* Cross-product 2D keyform grids (eye 2D compound).

## Open questions

1. **cmo3 byte-level diff tolerance during refactor** — XML element / attribute
   ordering can shift even when the rig is logically identical. Targeting
   *Cubism-Editor-equivalent loading* (model opens, all params/deformers
   intact) rather than byte-identical XML, unless that turns out to mask bugs.

2. **Physics scope** — `physics3.json` is already a separate runtime file
   (data-driven from `cmo3/physics.js` PHYSICS_RULES). The cmo3 path also
   embeds physics into the .cmo3 itself for Editor display. Runtime scope
   stays at the .physics3.json file (current behavior, what the SDK reads
   alongside .moc3) — physics doesn't live in moc3 binary anyway.

3. **Coordinate-frame translation table** — every deformer type has a
   different local-frame convention (ROOT → canvas px, Warp → 0..1,
   RotationDeformer → canvas-px offsets from pivot). The moc3 translator
   needs an explicit table mapping deformer-type → expected scale, and the
   conversion that keyform position arrays go through. Document in
   `rigSpec.js` JSDoc and unit-test on the neck-warp pilot.

4. **Re-parenting timing** — cmo3writer does a re-parenting pass at
   line 3533 that moves rotation deformers and rig warps under the body
   warp chain after both have been emitted. The RigSpec needs to capture
   the FINAL parent (post re-parenting), not the construction-time parent.

## Estimated scope

Audit numbers: ~1100 LOC of XML emission in `cmo3/*` helpers, ~800 LOC of
inline rig logic in `cmo3writer.js`. Phase B alone is multiple sessions.
Phase C is another big chunk. Realistically: 4–8 focused sessions to land
full parity.

## Working contract

* Cmo3 path stays load-correct in Cubism Editor at every commit.
* Phase A must include a functioning neck-warp end-to-end (cmo3 + moc3) before
  scaling up.
* Each phase ends with a memory file update + this document refreshed.
* Per `feedback_reference_first` and `feedback_verify_not_theorize`: when
  semantics of a moc3 section are unclear, dump Hiyori's bytes via py-moc3
  before guessing.
