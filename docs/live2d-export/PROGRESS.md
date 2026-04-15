# Live2D Export — Progress Tracker

## Current Status: Phase 3 In Progress — .can3 Animation Export (Session 9, 2026-04-15)

---

## Phase 0: Research & Foundation -- COMPLETE

- [x] Fork setup, remotes configured (origin=pelmentor, upstream=MangoLion)
- [x] Reference export analyzed (Hiyori: 24 parts, 134 art meshes, 70 params)
- [x] py-moc3 verified, MOC3 format fully mapped (100+ sections)
- [x] Data mapping drafted (see [ARCHITECTURE.md](ARCHITECTURE.md))

## Phase 1: Runtime Export (.moc3) -- COMPLETE

**Goal**: Export model that loads in Cubism Viewer and Ren'Py.

- [x] All JSON generators: .model3.json, .cdi3.json, .motion3.json
- [x] Texture atlas packer (MaxRects BSSF + auto-upscale)
- [x] .moc3 binary writer (V4.00, full section layout)
- [x] Main exporter + ZIP packaging
- [x] UI integration in ExportModal
- [x] **Renders correctly in Cubism Viewer 5.0** (20 drawables, correct textures)
- [x] Loads in Ren'Py (confirmed via log)

Key bugs fixed: field name swap (vertex_counts/position_index_counts), keyform binding chain, SDK validator quirks, SOT padding. See [MOC3_FORMAT.md](MOC3_FORMAT.md) and [ARCHITECTURE.md](ARCHITECTURE.md).

## Phase 2: Project Export (.cmo3) -- COMPLETE

**Goal**: Export .cmo3 that opens in Cubism Editor 5.0 for further editing.

### Session 3: Initial .cmo3
- [x] CAFF container RE'd and implemented
- [x] Full texture pipeline (CLayeredImage → CLayer → CModelImage filter graph)
- [x] Java decompile fixes (LayeredImageWrapper, CPartSource self-ref, CDeformerGuid ROOT, etc.)
- [x] Opens in Cubism Editor without "(recovered)" status

### Session 4: Multi-mesh + JS port
- [x] Single-PSD pattern discovered (ONE CLayeredImage, N CLayers)
- [x] CAFF packer + .cmo3 generator ported to JavaScript
- [x] "Live2D Project" option in ExportModal
- [x] Real Stretchy Studio project exports with textures + correct draw order

### Session 5: Part hierarchy + parameters
- [x] Hiyori RE: 27 nested CPartSource, 70 params, 104 deformers (documented)
- [x] Groups → CPartSource with proper parent-child nesting
- [x] All project.parameters exported as CParameterSource
- [x] Error handling: failures shown in UI
- [x] **Confirmed in Cubism Editor 5.0** -- parts panel shows group hierarchy

### Session 6: Rotation deformers + upstream merge
- [x] Rotation deformers: one CRotationDeformerSource per group
- [x] Origin fallback: SS pivot → descendant mesh bounding box center → canvas center
- [x] Deformer chain follows group hierarchy (parent group → parent deformer)
- [x] Meshes under ROOT (canvas-space) — auto-parenting deferred
- [x] Critical finding: Live2D child positions in PARENT'S LOCAL coord space
- [x] Upstream merge (Spine export, anim curves, UI improvements)
- [x] Docs reorganized (README, ARCHITECTURE, archived sessions)

### Session 7: Auto-parenting + coordinate transforms
- [x] World-space pivot computation (using `makeLocalMatrix` / `mat3Mul` chain)
- [x] Deformer origins now in parent-relative local coords (matching Hiyori pattern)
- [x] Meshes auto-parented to their group's deformer (not ROOT)
- [x] Dual-position system: keyform positions in deformer-local, base positions in canvas space
- [x] **Confirmed in Cubism Editor 5.0** — rotation controllers move limbs correctly

### Session 8: Parameter bindings + animation wiring
- [x] Each rotation deformer bound to `ParamRotation_GroupName` parameter (range [-30, +30])
- [x] 3 keyforms per deformer: angle=-30°, angle=0° (rest), angle=+30°
- [x] KeyformBindingSource + KeyformGridSource structure matching Hiyori pattern
- [x] motion3json: rotation animation tracks mapped to ParamRotation_* parameter IDs
- [x] exporter.js builds parameterMap and passes to generateMotion3Json
- [x] **Confirmed in Cubism Editor 5.0** — parameter sliders control deformer rotation

## Phase 3: Animation Export -- IN PROGRESS

### Session 9: .can3 animation + warp deformers + XmlBuilder refactor
- [x] RE: Hiyori warp deformer structure (50 deformers, all 5×5 grids, IDW for vertex→grid mapping)
- [x] RE: Animations stored in .can3 (separate CAFF archive), NOT embedded in .cmo3
- [x] RE: .can3 format fully mapped (CAnimation → CSceneSource → CMvTrack_Live2DModel_Source → CMvAttrF with CBezierPt keyframes)
- [x] XmlBuilder extracted to shared module (`xmlbuilder.js`) for reuse across cmo3/can3 writers
- [x] Warp deformer generation in cmo3writer (CWarpDeformerSource, 3×3 grid, IDW, ParamDeform_*)
- [x] mesh_verts tracks wired to warp parameters in motion3json + exporter
- [x] can3writer.js — .can3 generator (CAnimation, CSceneSource, parameter keyframes)
- [x] Export pipeline: project export now produces ZIP with .cmo3 + .can3 when animations exist
- [ ] **BLOCKED**: .can3 deserialization errors in Cubism Editor 5.0 (see CAN3_ISSUES below)
- [x] .motion3.json generator exists (runtime export)
- [x] Parameters from animation tracks (rotation → ParamRotation_GroupName)
- [ ] Verify .motion3.json works with Ren'Py playback

### .can3 Known Issues (Session 9)
1. **CMvEffect_VisualDefault.deserialize NPE** — custom Java deserializer expects internal fields we don't emit. Need deeper RE of what VisualDefault requires beyond attrList/attrMap.
2. **ICMvAttr.getTrack lateinit** — parameter CMvAttrF `track` back-reference not initializing correctly in Cubism Editor's Kotlin deserializer.
3. **CMvEffect_Live2DParameter.addAttr NPE** — cascading from VisualDefault failure; the model track can't resetModel_exe.
4. **CFixedSequence ≠ ACValueSequence** — FIXED: CFixedSequence only has `value`, not ACValueSequence fields (curMin, keyPts2, etc.)
5. **CAnimation must be shared** — FIXED: main section references shared CAnimation (not inline).

## Phase 4: Advanced Features -- NOT STARTED

- [ ] .physics3.json generator
- [ ] .pose3.json generator (part visibility groups)
- [ ] .exp3.json generator (expressions)
- [ ] Multi-parameter keyform interpolation

## Phase 5: Polish -- PARTIAL

- [x] UI integration (ExportModal with Runtime + Project options)
- [x] Error handling (failures shown in UI)
- [x] Progress reporting (mesh count in messages)
- [ ] Export validation (check for missing textures, empty meshes)
- [ ] Full .cdi3.json with parameter groups

---

## Key Risks

1. **.can3 deserialization**: Cubism Editor's Java/Kotlin deserializer is strict — custom deserialize() methods expect specific field patterns. Need to RE VisualDefault and parameter attribute initialization more carefully.
2. **Cubism SDK validation**: SDK rejects .moc3 if any cross-reference is wrong. Mitigated by ctypes test harness + reference comparison.
3. **cmo3 "recover targetDeformer" warnings**: All parts show `recover targetDeformer: deformer=null` — non-critical (model renders) but should be investigated.
