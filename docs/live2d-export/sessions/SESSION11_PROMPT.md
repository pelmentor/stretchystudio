# Session 11 Prompt

## Context

Read documentation in `docs/live2d-export/`:
- `README.md` — index, quick-start, troubleshooting, gotchas
- `PROGRESS.md` — project status (Phases 1-3 complete, baked keyforms next)
- `ARCHITECTURE.md` — decisions, data mapping, **bone weight → baked keyform design**
- `CMO3_FORMAT.md` — .cmo3 format reference

## What's done (Phases 1-3 COMPLETE)

### Phase 1-2 (.moc3 + .cmo3) — COMPLETE
- Full pipeline, renders in Cubism Viewer 5.0 and Ren'Py
- Rotation deformers, auto-parenting, parameter bindings

### Phase 3 (.can3 animation) — COMPLETE
- can3writer.js generates .can3 CAFF archives with animation keyframes
- All deserialization errors fixed, confirmed in Cubism Editor 5.0

### Session 10 fixes
- .can3: track back-refs, named VisualDefault fields, effect-specific fields
- .cmo3: Parts use "NOT INITIALIZED" GUID (eliminates recover warnings)
- .cmo3: Mesh targetDeformerGuid uses jointBoneId's deformer
- projectFile.js: Explicit boneWeights/jointBoneId serialization

## MAIN TASK: Baked Bone-Weight Keyforms

### The Problem
SS uses per-vertex bone weights on monolithic limb meshes (one arm piece with elbow weights). Live2D has NO native bone weight system — rotation deformers rotate all content rigidly. Exported elbows don't bend, they rotate the entire arm.

### The Solution (from ARCHITECTURE.md)
Bake bone-weight-based vertex positions into art mesh keyforms:

1. Mesh stays as one piece under the ARM deformer (shoulder rotation)
2. Mesh gets keyforms bound to the ELBOW rotation parameter
3. At each keyform angle (-30°, 0°, +30°), each vertex position = `rotate(rest, angle × boneWeight, elbowPivot)`
4. Live2D interpolates between positions → smooth weighted bending

### Implementation Plan

#### Step 1: Pass bone weight data to cmo3writer
- `exporter.js` already passes `jointBoneId` per mesh (added in Session 10)
- Also pass `boneWeights` array and the elbow pivot coordinates
- Need to find the elbow pivot: it's the `transform.pivotX/Y` of the jointBone node

#### Step 2: Modify art mesh keyform generation in cmo3writer
Currently each art mesh has 1 keyform (rest position) with no parameter binding.
For meshes with boneWeights:
- Keep mesh under parent ARM deformer (undo the Session 10 jointBoneId parenting)
- Create 3 keyforms bound to the elbow rotation parameter
- Compute vertex positions per keyform using bone weight rotation math
- Use KeyformBindingSource + KeyformGridSource (same pattern as rotation deformers)

#### Step 3: Coordinate space
- Rest vertex positions are in arm-deformer-local space (existing dual-position system)
- Elbow pivot needs to be in the same arm-deformer-local space
- Baked positions: `rotate(armLocal_vertex, angle × weight, armLocal_elbowPivot)`

#### Step 4: Test
- Export from SS with rigged arm
- Open .cmo3 in Cubism Editor
- Move elbow rotation parameter slider
- Verify: arm bends smoothly at elbow, not rigid rotation

### What about the rotation deformer for the elbow?
The elbow's rotation deformer (`Rotation_rightElbow`) still exists in the deformer tree but the mesh is NOT parented to it. The mesh's own keyforms handle the bending. The rotation deformer can be used by the Live2D artist for other purposes or deleted.

Alternative: Don't create rotation deformers for nodes that are bones (have jointBoneId references from meshes). Only create rotation deformers for groups that don't have bone-weight meshes.

## JS files
- `src/io/live2d/caffPacker.js` — CAFF archive packer
- `src/io/live2d/xmlbuilder.js` — shared XML builder
- `src/io/live2d/cmo3writer.js` — .cmo3 XML generator (MAIN CHANGES HERE)
- `src/io/live2d/can3writer.js` — .can3 XML generator
- `src/io/live2d/exporter.js` — exportLive2D + exportLive2DProject (pass boneWeights)
- `src/io/live2d/moc3writer.js` — .moc3 binary writer (also needs keyform changes)
- `src/io/live2d/motion3json.js` — .motion3.json
- `src/components/export/ExportModal.jsx` — UI

## BUG: Texture loss on deformed vertices (Session 10 finding)

When the user rotates an elbow in SS before exporting, vertex `x/y` positions get permanently committed (SkeletonOverlay onPointerUp). But UVs and the texture are based on the ORIGINAL rest positions. After export:
- Non-deformed vertices (weight=0): position matches UV → texture visible
- Deformed vertices (weight>0): position moved, UV still at original → texture gone

**Fix**: In `exporter.js` lines 200-220, use `v.restX ?? v.x` and `v.restY ?? v.y` for both base positions and UV computation. This ensures the exported mesh is always at rest pose with correct texture mapping. The baked keyforms (above) will handle posing via parameters.

```javascript
// Instead of: vertices.push(v.x, v.y)
vertices.push(v.restX ?? v.x, v.restY ?? v.y);

// Instead of: let u = v.x / canvasW
let u = (v.restX ?? v.x) / canvasW;
```

This should be done BEFORE the baked keyforms work — it's a prerequisite.

## Reference
- Hiyori .cmo3 extracted: `reference/live2d-sample/Hiyori/cmo3_extracted/main.xml`
- Hiyori .can3 extracted: `reference/live2d-sample/Hiyori/hiyori_pro_t04_extracted/main.xml`
- Cubism Editor 5.0: `C:\Program Files\Live2D Cubism 5.0\CubismEditor5.exe`
- Ren'Py test: `D:/renpy-8.5.0-sdk/live2dtest/`

## Key patterns to match (from Hiyori)
Look at how Hiyori's art meshes have multiple keyforms bound to parameters. Search for `CArtMeshForm` entries that have different vertex positions per parameter value. This is the pattern we need to replicate for baked bone-weight keyforms.

## Coordinate systems (CRITICAL)
Same as previous sessions — see ARCHITECTURE.md. The baked keyform positions must be in the parent deformer's local space (arm-deformer-local), matching the dual-position system.
