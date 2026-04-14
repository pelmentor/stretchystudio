# Live2D Export — Progress Tracker

## Current Status: Phase 2 .cmo3 — Opens in Cubism Editor WITHOUT "recovered" (Session 3)

---

## Phase 0: Research & Foundation (done)

- [x] Fork setup, remotes configured (origin + upstream)
- [x] `.gitignore` updated for reference/ and .claude/
- [x] Reference export analyzed (Hiyori model: 24 parts, 134 art meshes, 70 params)
- [x] Existing .moc3 RE projects surveyed and cloned to reference/
- [x] **py-moc3** (Python read+write) verified on reference file — parses correctly
- [x] Documentation structure created
- [x] MOC3 format fully mapped via py-moc3 section layout (all 100+ sections)
- [x] Data mapping Stretchy Studio → Live2D drafted
- [x] IDA Pro not needed for Phase 1 — py-moc3 provides complete section layout

## Phase 1: Minimum Viable Export (in progress)

**Goal**: Export a minimal model (1+ ArtMesh, 1 texture, 1 parameter) that loads in Cubism Viewer or Ren'Py.

### Code written (`src/io/live2d/`):
- [x] `.model3.json` generator (`model3json.js`)
- [x] `.cdi3.json` generator (`cdi3json.js`)
- [x] `.motion3.json` generator (`motion3json.js`)
- [x] Texture atlas packer (`textureAtlas.js`) — MaxRects BSSF + auto-upscale
- [x] `.moc3` binary writer (`moc3writer.js`) — full section layout
- [x] Main exporter orchestrator (`exporter.js`) — ZIP packaging
- [x] UI integration (Live2D option in Export Modal)

### Bugs found and fixed in session 1:
- [x] `mesh.triangles` is `Array<[i,j,k]>` not flat — flatten with `tri[0],tri[1],tri[2]`
- [x] `mesh.vertices` is `Array<{x,y}>` not flat — `.length` = vertex count, not `/2`
- [x] Atlas packer: crop to `imageBounds` before packing (PSD layers are full-canvas)
- [x] Atlas packer: MaxRects + auto-upscale to fill atlas (not shelf packing)
- [x] UV remapping: `(srcPx - cropOrigin) / cropSize * regionSize` formula
- [x] UV clamping to [0,1] (mesh dilation creates slightly OOB vertices)
- [x] Keyform positions: normalized `(pixel - origin) / PPU`, not raw pixels
- [x] `canvas` const hoisting trap — use `canvasW`/`canvasH` declared at top
- [x] Draw orders: all 500.0, group_indices=-1 (Hiyori pattern)
- [x] Drawable flags: 4 (like Hiyori), not 0
- [x] Version: V4.00 (version=3)
- [x] py-moc3 bug: `additional.quad_transforms` count_idx=-1 → fixed to WARP_DEFORMERS
- [x] ~~position_index_counts = triangle count~~ **CORRECTED in Session 2** (see below)
- [x] ~~position_index_begin_indices = cumulative vertex count~~ **CORRECTED in Session 2**

### Bugs found and fixed in Session 2 (2026-04-14):

**CRITICAL DISCOVERY: .moc3 field names are counterintuitive!**

Session 1 got the field mapping WRONG. Hiyori reverse engineering proved:

| Field (misleading name) | Session 1 belief | Correct meaning (Hiyori RE) |
|---|---|---|
| `vertex_counts` | unique vertex count | **flat triangle index count** (tri*3) |
| `position_index_counts` | triangle count | **rendering vertex count** |
| `uv_begin_indices` | cumul(vc * 2) | cumul(**pic** * 2) |
| `position_index_begin` | cumul(vc) | cumul(**vc**) = cumul(flat_idx) |

**Evidence**: In Hiyori, `sum(vertex_counts) == counts[16]` (POSITION_INDICES), and `uv_begin == cumul(position_index_counts * 2)`. The SDK function `csmGetDrawableVertexCounts` returns `position_index_counts` values.

Other fixes applied:
- [x] Full keyform binding chain: 1 binding per mesh, null bands for parts
- [x] SDK validator quirk: `begin < total` checked even when `count=0`
- [x] `mask_begin_indices = 0` (not -1), DRAWABLE_MASKS=1 (dummy entry)
- [x] `drawable_flags = 4` consistently (Hiyori pattern)
- [x] 64 bytes EOF padding (SOT entries for empty sections at end must be < file_size)
- [x] Cubism Core DLL (Ren'Py) ctypes test harness built and validated
- [x] 20-mesh girl model passes consistency + loads + initializes + updates via SDK

### Current state (end of Session 2):
- [x] **Cubism Viewer 5.0: MODEL RENDERS CORRECTLY** (screenshot confirmed 2026-04-14)
- [x] JS moc3writer.js generates valid .moc3 directly from Stretchy Studio UI export
- [x] 20 drawables, correct textures, correct mesh positions
- [x] Also found last bug: SOT[101] must be non-zero for V3.03+ (quad_transforms entry)
- Test harness: `docs/live2d-export/test_swapped.py`

### Session 3: .cmo3 Project Export — Opens Without "recovered" (2026-04-14)

**Goal**: Generate .cmo3 that opens in Cubism Editor 5.0 without "recovered" status.

**Approach**: Java decompile of `Live2D_Cubism.jar` + log analysis + reference-first.

Full texture pipeline implemented:
- [x] CLayeredImage → CLayerGroup → CLayer (fake PSD hierarchy)
- [x] CModelImage with filter env (CLayerSelector → CLayerFilter graph)
- [x] ModelImageFilterSet with well-known StaticFilterDefGuid UUIDs
- [x] CModelImageGroup in CTextureManager._modelImageGroups
- [x] isTextureInputModelImageMode=true, TextureState=MODEL_IMAGE
- [x] CCachedImageManager with cached image data
- [x] CMeshGeneratorExtension with MeshGenerateSetting

Deserialization fixes (found via Java decompile + log):
- [x] LayeredImageWrapper for _rawImages (ClassCastException)
- [x] CPartSource as shared object with self-reference
- [x] CDeformerGuid ROOT UUID: `71fae776-e218-4aee-873e-78e8ac0cb48a` (hardcoded constant)
- [x] CPartSource._childGuids must include CDrawableGuid references
- [x] CModelSource version 4 (avoids missing rootParameterGroup, modelOptions, gameMotionSet)
- [x] CAffecterSourceSet required (checkNotNull in deserialize)
- [x] CBlend_Normal must have ACBlend/displayName content

**Result**: `test_pipeline.cmo3` opens in Cubism Editor 5.0.00 — clean log, no errors,
mesh "ArtMesh0" shown without "(recovered)", canvas visible with white texture.

### Session 4: Multi-Mesh + JS Port (2026-04-14)

**Critical discovery**: Multi-mesh requires ONE CLayeredImage (PSD) with N CLayers,
NOT N separate CLayeredImages. Reference confirmed: untitled_with_mesh has 1 CLayeredImage,
1 CLayerGroup with 20 children CLayers.

- [x] Multi-mesh Python prototype (3 colored meshes — red, green, blue)
- [x] Single-PSD-with-N-layers pattern confirmed working in Cubism Editor 5.0
- [x] CAFF packer ported to JavaScript (caffPacker.js)
- [x] cmo3 generator ported to JavaScript (cmo3writer.js)
- [x] Export UI: "Live2D Project" option in ExportModal.jsx
- [x] exporter.js: exportLive2DProject() with canvas-sized textures
- [x] JS cmo3writer uses single-PSD pattern (1 CLayeredImage, N CLayers)
- [x] Draw order from project.draw_order property
- [x] **Real Stretchy Studio project exports to .cmo3 and opens in Cubism Editor 5.0 with textures** ✓
- [ ] Test in Ren'Py (D:/renpy-8.5.0-sdk/live2dtest/)
- [ ] Test motion playback

### Session 5: Part Hierarchy + Parameters (2026-04-14)

Hiyori .cmo3 RE: Root Part → CPartGuid children (groups) → CDrawableGuid children (meshes).
Each group has parentGuid → parent group. _childGuids can mix CPartGuid + CDrawableGuid.

- [x] RE'd Hiyori part hierarchy: nested CPartSource with CPartGuid/CDrawableGuid children
- [x] RE'd Hiyori parameters: 70 CParameterSource entries (ParamAngleX/Y/Z, etc.)
- [x] RE'd Hiyori deformers: CWarpDeformerSource + CRotationDeformerSource (not implemented yet)
- [x] Part hierarchy: Stretchy Studio groups → CPartSource with proper nesting
- [x] makePartSource() helper with full boilerplate (KeyformGridSource, CPartForm, self-ref)
- [x] Meshes assigned to parent group's _childGuids (or root if ungrouped)
- [x] All project.parameters exported as CParameterSource (+ always ParamOpacity)
- [x] **Confirmed working in Cubism Editor 5.0** — parts panel shows group hierarchy ✓

## Phase 2: Full Static Export — COMPLETE (Session 5)

- [x] .cmo3 project file opens in Cubism Editor 5.0
- [x] Multiple ArtMeshes with correct draw order
- [x] Real texture data from Stretchy Studio (canvas-sized PNGs, single-PSD pattern)
- [x] JS pipeline: ExportModal → exportLive2DProject → generateCmo3 → packCaff → .cmo3
- [x] Part hierarchy (group → CPartSource mapping)
- [x] All project parameters exported
- [ ] Full `.cdi3.json` with parameter groups

## Phase 3: Animation Export

- [ ] `.motion3.json` generator
- [ ] Keyframe → segment encoding (linear, bezier, stepped)
- [ ] Motion groups in `.model3.json`
- [ ] Test animations play correctly in Ren'Py

## Phase 4: Advanced Features

- [ ] `.physics3.json` generator
- [ ] `.pose3.json` generator
- [ ] `.exp3.json` generator (expressions)
- [ ] Warp/Rotation deformer export
- [ ] Multi-parameter keyform interpolation

## Phase 5: Polish & Integration

- [ ] UI integration in Stretchy Studio (export dialog)
- [ ] Progress reporting during export
- [ ] Error handling and validation
- [ ] User documentation

---

## Key Risks

1. **`.moc3` binary format** — partially undocumented, requires RE. Mitigation: reference-driven + moc3ingbird + SDK analysis.
2. **Bone → Parameter mapping** — conceptual mismatch between skeletal animation and parameter-based deformers. Mitigation: vertex baking for MVP.
3. **Cubism SDK validation** — the SDK may reject our .moc3 if any field is wrong. Mitigation: byte-level comparison with reference, incremental testing.
