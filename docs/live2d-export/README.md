# Live2D Export for Stretchy Studio

Export Stretchy Studio projects to Live2D Cubism format — both runtime (.moc3) and project (.cmo3).

## Status

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | .moc3 runtime export | **Complete** |
| Phase 2 | .cmo3 project export | **Complete** |
| Phase 2+ | Rotation deformers + auto-parenting + parameter bindings | **Complete** |
| Phase 3 | Animation (.can3) + warp deformers | **Complete** |
| Phase 4 | Physics / pose / expressions | Not started |

See [PROGRESS.md](PROGRESS.md) for detailed milestone tracking.

## Export Types

### Live2D Runtime (.moc3 ZIP)
Produces a ready-to-use model for Ren'Py, game engines, and Cubism SDK apps.

**Contents**: `.model3.json` + `.moc3` + texture atlas + `.cdi3.json` + `.motion3.json`

### Live2D Project (.cmo3)
Produces a Cubism Editor 5.0 project file for further editing (add deformers, animations, physics).

**Contents**: CAFF archive with `main.xml` + per-mesh PNG textures.

## Code Structure

All export code is in `src/io/live2d/`:

| File | Purpose |
|------|---------|
| `exporter.js` | Main orchestrator: `exportLive2D()` (runtime) + `exportLive2DProject()` (.cmo3) |
| `moc3writer.js` | .moc3 binary writer (100+ sections, V4.00) |
| `cmo3writer.js` | .cmo3 XML generator (textures, parts, params, deformers, warp deformers) |
| `can3writer.js` | .can3 XML generator (animation scenes, parameter keyframes) — WIP |
| `xmlbuilder.js` | Shared XML builder for .cmo3 and .can3 generators |
| `caffPacker.js` | CAFF archive packer (XOR obfuscation, ZIP compression) |
| `model3json.js` | .model3.json manifest generator |
| `cdi3json.js` | .cdi3.json display info generator |
| `motion3json.js` | .motion3.json animation generator |
| `textureAtlas.js` | MaxRects BSSF atlas packer with auto-upscale |
| `index.js` | Re-exports all public APIs |

UI integration: `src/components/export/ExportModal.jsx` — "Live2D Runtime" and "Live2D Project" options.

## Documentation

| Document | Contents |
|----------|----------|
| [PROGRESS.md](PROGRESS.md) | Milestone tracker — what's done, what's next |
| [MOC3_FORMAT.md](MOC3_FORMAT.md) | .moc3 binary format reference (sections, fields, validation) |
| [CMO3_FORMAT.md](CMO3_FORMAT.md) | .cmo3 format reference (CAFF container, XML schema, texture pipeline) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design decisions, data mapping, keyform binding system |

### Archived

Session-specific docs (RE logs, session prompts) are in [sessions/](sessions/).

## Tools

| Tool | Location | Purpose |
|------|----------|---------|
| Cubism Editor 5.0 | `C:\Program Files\Live2D Cubism 5.0\` | Test .cmo3 opens correctly |
| Cubism Core DLL | `D:/renpy-8.5.0-sdk/lib/py3-windows-x86_64/Live2DCubismCore.dll` | ctypes validation |
| Ren'Py test project | `D:/renpy-8.5.0-sdk/live2dtest/` | Runtime model testing |
| Python scripts | [scripts/](scripts/) | Prototyping and test tools |

### Python Scripts

| Script | Purpose |
|--------|---------|
| `cmo3_decrypt.py` | Extract/decrypt .cmo3 CAFF archives |
| `cmo3_generate.py` | Python .cmo3 generator (reference implementation) |
| `cmo3_multi_test.py` | Multi-mesh .cmo3 test (red/green/blue) |
| `caff_packer.py` | Python CAFF packer (reference implementation) |
| `test_swapped.py` | .moc3 validation via Cubism Core ctypes |

## Quick Reference

### Data Mapping

| Stretchy Studio | Live2D Runtime (.moc3) | Live2D Project (.cmo3) |
|-----------------|----------------------|----------------------|
| Part (with mesh) | ArtMesh | CArtMeshSource |
| Group | Part (visibility group) | CPartSource |
| Parameter | Parameter | CParameterSource |
| Animation track | .motion3.json curve | (not yet implemented) |
| Texture | Atlas region | CLayer + CImageResource |

### Key Gotchas

1. **Field name swap**: `art_mesh.vertex_counts` = flat index count, `position_index_counts` = vertex count
2. **Single PSD pattern**: .cmo3 requires ONE CLayeredImage with N CLayers (not N CLayeredImages)
3. **Deformer root UUID**: `71fae776-e218-4aee-873e-78e8ac0cb48a` (hardcoded in Cubism Editor)
4. **SDK validator quirk**: `begin < total` checked even when `count=0` — use dummy entries
5. **SOT padding**: 64 bytes at EOF required for zero-count sections
6. **Dual-position trap**: .cmo3 meshes have TWO position arrays — `meshSrc > positions` (canvas pixels, for textures) and `keyform > positions` (deformer-local, for rendering). Setting both to deformer-local = invisible textures.
7. **Deformer origins are parent-relative**: CRotationDeformerForm originX/Y are in the PARENT deformer's local space, not canvas space. Nested deformers compound.
8. **Child coords in parent local space**: Live2D interprets child vertex positions relative to parent deformer's local coordinate system. Auto-parenting requires `vertex_local = vertex_canvas - deformer_world_origin`.

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "File read error" in Cubism Viewer | `csmHasMocConsistency` fails | Check field mapping in MOC3_FORMAT.md |
| .cmo3 opens as "(recovered)" | XML schema mismatch | Check required fields in CMO3_FORMAT.md |
| Geometry visible, no textures | N separate CLayeredImages | Must use single-PSD pattern |
| Model blank/invisible | Missing keyform bindings | Every ArtMesh needs a binding (see ARCHITECTURE.md) |
| `csmGetDrawableRenderOrders` missing | Cubism SDK 5-r.5 | Downgrade to 5-r.1 through 5-r.4 |
| Wrong draw order in .cmo3 | Using array index | Use `part.draw_order` from project |
| ERROR invalid ID in Cubism Editor | Special chars in CDrawableId | Sanitize to `ArtMesh0`, `ArtMesh1`, etc. |
| Mesh wireframe visible, no texture fill | `meshSrc > positions` in deformer-local space | Must keep base positions in canvas pixel space (see gotcha #6) |
| Character scattered across canvas | Mesh parented to deformer but vertices in canvas space | Transform vertices: `local = canvas - deformerWorldOrigin` |
| Deformer controllers in wrong place | Origin computed in canvas space, not parent-relative | Subtract parent deformer's world origin from this deformer's world origin |
| .can3 blank / NPE on load | Missing `track` back-refs or named VisualDefault fields | See ARCHITECTURE.md ".can3 Deserialization Rules" |
| "recover targetDeformer" warnings | Parts use ROOT deformer GUID | Use "NOT INITIALIZED" GUID (all zeros) for part targetDeformerGuid |
