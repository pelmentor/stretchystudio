# Live2D Export — Progress Tracker

## Current Status: Phase 2 Complete + Deformers (Session 7, 2026-04-15)

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

## Phase 3: Animation Export -- NOT STARTED

- [x] .motion3.json generator exists (runtime export)
- [ ] Parameters from animation tracks (rotation → ParamRotation_GroupName)
- [ ] Verify .motion3.json works with Ren'Py playback
- [ ] Animation embedding in .cmo3
- [ ] Warp deformers for mesh vertex animations

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

1. **Warp deformers**: SS mesh vertex animations need to map to Live2D CWarpDeformerSource grid keyforms. Non-trivial topology conversion.
2. **Cubism SDK validation**: SDK rejects .moc3 if any cross-reference is wrong. Mitigated by ctypes test harness + reference comparison.
