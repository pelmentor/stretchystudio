# Session 11 Prompt

## Context

Read documentation in `docs/live2d-export/`:
- `README.md` — index, quick-start, troubleshooting, gotchas
- `PROGRESS.md` — project status (Phases 1-3 COMPLETE)
- `ARCHITECTURE.md` — decisions, data mapping, .can3 deserialization rules
- `CMO3_FORMAT.md` — .cmo3 format reference

## What's done (Phases 1-3 COMPLETE)

### Phase 1-2 (.moc3 + .cmo3) — COMPLETE
- Full pipeline, renders in Cubism Viewer 5.0 and Ren'Py
- Rotation deformers, auto-parenting, parameter bindings

### Phase 3 (.can3 animation) — COMPLETE
- can3writer.js generates .can3 CAFF archives with animation keyframes
- Export produces ZIP with .cmo3 + .can3 when animations exist
- All deserialization errors fixed (track back-refs, named VisualDefault fields, effect-specific fields)
- Parts use "NOT INITIALIZED" GUID for targetDeformerGuid
- **Confirmed in Cubism Editor 5.0** — model + animation loads and plays

## JS files
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/xmlbuilder.js` — shared XML builder (XmlBuilder class + uuid)
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator
- `src/io/live2d/can3writer.js` — .can3 XML generator
- `src/io/live2d/exporter.js` — exportLive2D + exportLive2DProject
- `src/io/live2d/moc3writer.js` — .moc3 binary writer
- `src/io/live2d/model3json.js` — .model3.json
- `src/io/live2d/motion3json.js` — .motion3.json
- `src/io/live2d/cdi3json.js` — .cdi3.json
- `src/io/live2d/textureAtlas.js` — atlas packer
- `src/components/export/ExportModal.jsx` — UI

## Future work options (pick based on priority)

### 1. Ren'Py runtime validation (deferred since Session 9)
- Test .moc3 + .motion3.json in Ren'Py test project
- Verify model renders and animations play correctly
- Path: `D:/renpy-8.5.0-sdk/live2dtest/`

### 2. Physics (.physics3.json)
- Hair, clothing, accessories that respond to head movement
- Cubism physics system: pendulum chains with gravity, wind, damping
- Would make exported models feel more alive in Ren'Py
- Reference: Hiyori has physics for hair, ribbons, etc.

### 3. Pose (.pose3.json)
- Part visibility toggle groups (e.g. outfit A vs outfit B)
- SS groups map naturally to Live2D parts
- Simple JSON format — list of part groups with exclusivity rules

### 4. Expressions (.exp3.json)
- Parameter presets (smile, angry, surprised)
- Each expression = set of {parameterId, value, blendType}
- Could map from SS animation keyframes at specific frames

### 5. Multi-parameter keyform interpolation
- Currently each deformer has 1 parameter with 3 keyforms
- Hiyori uses 2D parameter grids (e.g. AngleX × AngleY)
- Would allow more complex deformation control

### 6. Warp deformer animation
- Code exists in cmo3writer but dormant (no mesh_verts tracks from SS)
- Activate when SS adds vertex deformation keyframe support

## Tools
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Ren'Py test: `D:/renpy-8.5.0-sdk/live2dtest/`
- Hiyori can3 extracted: `reference/live2d-sample/Hiyori/hiyori_pro_t04_extracted/main.xml`
- Hiyori cmo3 extracted: `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`
- Python decrypt: `docs/live2d-export/scripts/cmo3_decrypt.py`
