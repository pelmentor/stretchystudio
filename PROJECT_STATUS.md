# Stretchy Studio — Project Overview & Status

**Last Updated:** 2026-04-08 · **Current Phase:** M3 Complete · **Next Phase:** M4 (Timeline & Keyframe Animation)

---

## 1. Project Vision

Stretchy Studio is a 2D animation tool targeting illustrators and animators. Import PSD/PNG → group layers → pose on an After Effects-style timeline → export spritesheet. Simple, intuitive, end-to-end workflow.

**Key Design Principle:** Ship thin vertical slices. Every milestone leaves the app usable end-to-end.

### What's Different from Original Plan

The original design favored Live2D-style parameters and abstract deformers (complex UX). The revised approach is **timeline-first**:
- Dropped parameter system entirely
- Direct keyframing of transforms and mesh vertices
- After Effects workflow (not Live2D)
- Lower learning curve for 2D animators

---

## 2. Architecture

### Directory Layout

```
src/
  app/layout/              # 4-zone layout (canvas, layers, inspector, timeline)
  store/
    projectStore.js        # Scene tree (Nodes, Groups, Parts) + project state
    editorStore.js         # Selection, tool mode, viewport state
    animationStore.js      # [M4] CurrentTime, isPlaying, poseOverrides
    historyStore.js        # Undo/redo (skeleton, not yet integrated)
  renderer/
    transforms.js          # [M3] Matrix math & world matrix composition
    scenePass.js           # Transform pass + draw pass (hierarchical MVP)
    partRenderer.js        # VAO per part, vertex/UV/index management
    program.js, shaders/   # WebGL shader programs
  mesh/
    contour.js, sample.js, delaunay.js, generate.js, worker.js
  components/
    canvas/
      CanvasViewport.jsx   # Viewport + drag-drop, PSD auto-org modal
      GizmoOverlay.jsx     # [M3] Transform gizmo (move + rotate handles)
    layers/
      LayerPanel.jsx       # [M3] Depth & Groups tabs, drag-to-reparent
    inspector/
      Inspector.jsx        # [M3] Transform panel + mesh settings
    timeline/              # [M4] TrackRows, Keyframes, Playhead
  io/
    psd.js                 # ag-psd wrapper for layer extraction
    psdOrganizer.js        # [M3] Character format detection & auto-grouping
    export.js              # [M5] Spritesheet/Zip builder
```

### Data Model

```
Project
├── nodes: [
│   { id, type: 'part' | 'group', name, parent, visible, opacity },
│   { transform: {x, y, rotation, hSkew, scaleX, scaleY, pivotX, pivotY} },
│   { draw_order (parts only) },
│   { mesh, meshOpts (parts only) }
│ ]
├── textures: { [nodeId]: blobUrl }
├── activeAnimationId: uuid (M4+)
└── animations: [{ id, name, duration, fps, tracks: [...] }] (M4+)
```

### Rendering Pipeline

1. **Transform Pass** (depth-first tree walk):
   - Compute world matrices: `parent.world × node.local`
   - Store transient `node._worldMatrix` for each node
2. **Draw Pass** (sorted by `draw_order`):
   - Per-part MVP = camera × worldMatrix
   - Render mesh, wireframe, vertices, overlays
   - Respects `visibility` and `opacity`

---

## 3. Completed Milestones

### ✅ M1 — Canvas Foundation (Completed)
- WebGL2 renderer skeleton with VAO per part
- PNG single-layer import & automatic triangulation
- Vertex dragging with undo/redo
- Basic viewport zoom/pan

### ✅ M2 — Auto Mesh & PSD Import (Completed)
- **PSD Import** (`ag-psd` wrapper): multi-layer extraction, layer names preserved, correct z-order
- **Mesh Generation Sliders**: Alpha threshold, smooth passes, grid spacing, edge padding, edge points
- **Per-Part Mesh Override**: Each layer can have custom mesh settings
- **Viewport Navigation**: Zoom-toward-cursor, Alt+drag pan, smooth controls
- **Manual Mesh Editing**: Add/remove vertex tools (no auto-retriangulation until remesh)
- **Layer Panel v1**: Names, visibility toggle, draw-order reorder buttons
- **Visibility Overlays**: Global toggles for image, wireframe, vertices, edge outline
- **Inspector Panel**: Overlay toggles, tool mode buttons, mesh settings, per-part opacity

### ✅ M3 — Groups & Hierarchical Transforms (Completed 2026-04-08)
- **Matrix Math Library** (`src/renderer/transforms.js`): 3×3 affine math, world matrix composition
- **Scene Graph**: Group nodes with transform inheritance, `reparentNode` action
- **Transform Gizmo** (`GizmoOverlay.jsx`): Drag move handle (translate) + rotation arc handle on canvas
- **Transform Inspector**: Numeric inputs for X, Y, Rotation (°), Horizontal Skew (HSkew), Scale (%), Pivot
- **Layer Panel Tabs**:
  - **Depth Tab**: Flat draw_order list with group-name chips, drag-to-reorder (squeeze behavior), right-click context menu
  - **Groups Tab**: Tree view, drag-to-reparent, collapsible groups with auto-expand on selection
- **PSD Auto-Organizer** (`psdOrganizer.js`): Character format detection (head/body/extras groups), canonical draw order
- **Renderer Integration**: Per-part world matrices, hierarchical transforms work end-to-end
- **Mesh Generation Refinements** (`src/mesh/contour.js`, `src/mesh/generate.js`):
  - **Multi-seed contour tracing**: Traces all separated regions (eyes, arms, etc.) independently, not just the first one
  - **Boundary dilation**: Edge vertices placed 2px outside visual boundary → mesh covers full image content → texture alpha provides visual clip
  - **Per-contour vertex distribution**: Allocates `numEdgePoints` proportionally by perimeter across all detected regions
- **Bugs Fixed**: PSD opacity (was 0), mesh generation (concurrent workers), layer render order, depth tab drag behavior, mesh clipping (chord-shortcut effect), multi-part edge point coverage

**Exit Criteria Met:** Create group → parent layers → rotate group → children rotate around pivot. Depth tab unchanged. Groups tab drag reparents without affecting draw_order. Mesh now covers outer areas without clipping; multiple separated parts all get appropriate edge point coverage.

**M3 Refinement (Mesh-on-Demand Architecture):**
- **Auto-mesh removed:** Layers no longer generate mesh on import. Layers render as textured quads until user explicitly clicks "Generate Mesh" in Inspector.
- **Alpha-based selection:** Layer selection now uses alpha channel sampling instead of mesh intersection. Works for mesh-less parts; vertex proximity check still works when mesh exists.
- **Cropped bounding box:** Gizmo bounding box for mesh-less parts now crops to actual opaque pixels (computed once on import), not full image bounds.
- **Fallback quad rendering:** Each part gets a simple 2-triangle quad VAO for texture rendering without mesh. Replaced by actual mesh when user generates it.
- **Inspector changes:**
  - "Generate Mesh" button when no mesh; "Remesh" button when mesh exists
  - "Delete Mesh" option to revert to quad fallback
  - Mesh settings remain accessible for pre-configuration before generation
- **Benefits:** Faster import (no mesh gen), cleaner workflow (mesh as opt-in), lower memory footprint, better for M4 animation pipeline (easier keyframing without dense vertex data)

---

## 4. Upcoming Milestones

### M4 — Timeline & Keyframe Animation (Next)

**Goal:** AE-lite timeline for posing and animating.

**What to build:**
1. **Editor Mode Toggle** (top-left of CanvasViewport):
   - Two-state toggle: `Staging` | `Animation`
   - `Staging` = current M3 workflow (transform gizmo, mesh editing, layer operations)
   - `Animation` = timeline-active mode (keyframing, playback, pose overrides apply)
   - Stored in `editorStore` as `editorMode: 'staging' | 'animation'`
   - Toggle sits as an absolute-positioned overlay at `top-2 left-2` in CanvasViewport, `z-10`

2. **AnimationStore** (`src/store/animationStore.js`):
   - `currentTime`, `isPlaying`, `duration`, `fps`
   - `activeAnimationId`
   - `poseOverrides`: Map of `nodeId → interpolated {x, y, rotation, scaleX, scaleY, opacity}`

3. **Animation Data Model**:
   ```
   project.animations = [{
     id, name, duration (ms), fps,
     tracks: [{
       nodeId,
       property: 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity' | 'mesh_verts',
       keyframes: [{ time (ms), value, easing: 'linear' | 'ease' }]
     }]
   }]
   ```

4. **Timeline Transport Controls** (`src/components/timeline/`):
   - **Current Frame** field — shows/sets playhead position (integer frame number)
   - **Start Frame** field — first frame of loop range (default 0)
   - **End Frame** field — last frame of loop range (default = duration × fps)
   - Start/End determine the loop window during playback
   - **Speed slider** — playback rate multiplier, default 0 (paused), range 0×–2×
   - **FPS field** — frames per second for this animation clip (integer, default 24)

5. **Timeline UI** (`src/components/timeline/`):
   - Horizontal tracks per node (collapsible)
   - Keyframe diamonds (◆) at time positions
   - Scrubber/playhead for seeking
   - Play/Pause/Stop/Loop transport buttons

6. **Keyframe Workflow**:
   - Press **K** at scrubber position → snapshot current transforms into keyframes
   - Auto-keyframe toggle: any transform drag auto-records keyframe

7. **Playback Engine**:
   - rAF loop reads `currentTime`, interpolates between keyframes
   - Applies to `poseOverrides` (does NOT mutate `projectStore`)
   - Renderer reads overrides during draw if playing
   - Respects Start/End frame loop range and Speed multiplier

8. **Mesh Warp Keyframes**:
   - `mesh_verts` property stores `Float32Array` snapshot of vertex positions
   - Interpolated per-vertex during playback (enables tail-wag, leg-bend, etc.)

**Exit Criteria:** Import PSD → group head → K (pose 1) → scrub → K (pose 2) → Play → head rotates smoothly. Mesh warp: bend tail → K → K → Play → tail wags.

---

### M5 — Spritesheet Export

**Goal:** Render animation to frames → download as zip of PNGs or packed spritesheet.

**What to build:**
- **Frame Renderer**: Offscreen WebGL canvas, step through animation time, `gl.readPixels` per frame
- **Export UI**: Dialog with options:
  - Animation clip (dropdown)
  - FPS override
  - Background (transparent/white/custom)
  - Format (Zip of PNGs / Spritesheet image + JSON atlas)
- **Zip Output**: `frame_0000.png`, `frame_0001.png`, … (JSZip)
- **Spritesheet Mode**: Shelf-pack frames into power-of-2 atlas, output `spritesheet.png` + `spritesheet.json` (compatible with Phaser/Unity/Godot)

**Exit Criteria:** Export → download zip → frames have correct transparency and sequence.

---

### M6 — Physics

**Goal:** Spring physics for secondary motion (hair, cloth).

**What to build:**
- **Physics Group**: Ordered chain of groups/parts with gravity, stiffness, damping, wind
- **Verlet Integrator**: Runs on rAF alongside playback, applies offsets on top of animated pose
- **Physics Inspector**: Add/remove chain nodes, tweak parameters
- **Play Modes**:
  - Preview (P key): animation + live physics
  - Bake: writes physics results as keyframes (destructive, undoable)

**Exit Criteria:** Attach physics to hair → Press Play → hair jiggles with gravity.

---

### M7 — GIF / Video Export (Deferred Post-M6)
- **GIF**: `gif.js` worker (MIT, popular)
- **WebM**: MediaRecorder API on canvas stream
- Builds on frame renderer from M5

---

## 5. What's Dropped from Original Plan

| Feature | Status | Reason |
|---------|--------|--------|
| Parameter system | **Dropped** | Replaced by direct keyframing (lower learning curve) |
| Armed recording mode | **Dropped** | Part of parameter system |
| Warp deformer 5×5 grid | **Dropped** | Direct vertex keyframes more flexible & intuitive |
| Path deformer | **Dropped** | Scope reduction |
| `.stretch` format + atlas packer | **Deferred** | Spritesheet export covers immediate need |
| 2D parameter grids | **Dropped** | Out of scope |
| Standalone player library | **Deferred** | No immediate use case |

---

## 6. Key Architecture Notes

### Mesh-on-Demand with Quad Fallback
- **No auto-mesh on import:** Parts initially render with a simple 2-triangle textured quad (`uploadQuadFallback`). No GPU cost for mesh generation.
- **Lazy mesh generation:** User clicks "Generate Mesh" in Inspector → `dispatchMeshWorker` computes mesh → `uploadMesh` replaces quad with actual mesh.
- **Delete reverts fallback:** User clicks "Delete Mesh" → `uploadQuadFallback` restores quad, `node.mesh = null`.
- **Quad has no edges:** Edge indices empty for fallback quad (no green wireframe visualization). Once mesh generated, edges show.

### Alpha-Based Selection (M3 Refinement)
- **ImageData caching:** Each part's `ImageData` stored in `imageDataMapRef` during import for fast alpha sampling.
- **Bounds computation:** `computeImageBounds(imageData)` scans for opaque pixels (alpha > 10), returns `{minX, minY, maxX, maxY}`. Cached on node as `imageBounds`.
- **Click handling:** `sampleAlpha(imageData, lx, ly)` returns alpha at pixel. Hit-test loop checks alpha (no mesh required). Vertex proximity check still works when mesh exists.
- **Gizmo bounding box:** Uses `node.imageBounds` for mesh-less parts, `node.mesh.vertices` for meshed parts.

### Pose Separation
During playback, interpolated values go into `animationStore.poseOverrides` (a Map of `nodeId → {x, y, rotation, ...}`). The renderer reads overrides instead of `projectStore` values. This avoids polluting the project model with playback state.

### Mesh Warp Keyframes
Stored as `Float32Array` snapshots of vertex positions. Lerped per-vertex during playback. The renderer's `PartRenderer.uploadPositions()` hot-path updates GPU buffers on each frame.

### Transform Composition
World matrices computed each frame from node tree + pose overrides. No caching in M3 (simple scenes work fine). Caching can be added in M4+ if perf requires.

### State Management
- `projectStore`: Persistent project model (nodes, transforms, textures). **New fields:** `imageWidth`, `imageHeight`, `imageBounds` for mesh-less parts.
- `editorStore`: UI state (selection, tool mode, viewport, activeLayerTab)
- `animationStore`: Playback state (currentTime, isPlaying, poseOverrides) — separate to keep concerns isolated
- `historyStore`: Undo/redo skeleton (not yet integrated into UI workflows)

---

## 7. Current Project Statistics

| Metric | Value |
|--------|-------|
| **Status** | M3 production-ready; M4 design in progress (mode toggle, timeline controls) |
| **Files Modified/Created** | 15+ |
| **Line Count** (core) | ~3100 (renderer + store + UI + alpha picking) |
| **Bundle Size** | 587 KB minified, 187 KB gzipped |
| **Performance** | 60 fps with 3–5 parts × 1000 verts each; mesh-less parts even faster |
| **Main Dependency** | ag-psd (~120 KB), WebGL2 |
| **Import Speed** | ~2–3× faster (no auto-mesh computation) |

---

## 8. Known Limitations

- **No undo/redo yet:** All changes immediate (M5 feature)
- **No hierarchical visibility culling:** Hidden parent's children still participate in picking (minor)
- **No transform inheritance preview:** Gizmo shows local axes only
- **Groups have no visual appearance:** Containers only (intentional; may revisit M5+)
- **Remesh lag:** Large images (>2048px) can freeze UI for ~500ms (acceptable per spec)
- **PSD edge cases:** CMYK, smart objects, layer effects, complex blend modes not fully validated
- **Mesh dilation:** Edge vertices are placed 2px outside alpha boundary for chord-shortcut coverage. Very thin features (<4px) may slightly extend beyond visual boundary before texture alpha clips (acceptable trade-off for reliable full-image coverage)
- **Bounds computation:** Alpha-based bounding box computed once at import (threshold = 10). Very faint semi-transparent edges may be excluded. Can be refined in future if needed.

---

## 8b. M4 Animation Bugs Fixed

### Issue: Brush Deform & Layer Selection Fail on Animated Nodes
**Root Cause:** In `CanvasViewport.onPointerDown`, world matrices were computed from `proj.nodes` (raw stored transforms) instead of the effective transforms (keyframe interpolation + draft pose overlays). This made `iwm` (inverse world matrix) wrong for any node with animation applied, breaking:
1. **Brush hit-testing:** Brush couldn't select/deform vertices on animated meshes
2. **Layer selection:** Couldn't click on parts that had been moved by keyframes (had to click original position)
3. **Vertex picking:** Single-vertex drag wouldn't register on animated nodes

**Fix:** Build `effectiveNodes` at the start of `onPointerDown` by merging animation overrides (keyframe values + draft pose) into the base node transforms. Compute `worldMatrices` and `sortedParts` from `effectiveNodes` instead of raw `proj.nodes`. This ensures:
- `iwm` converts mouse coords to the correct local space (where the visuals actually are)
- Vertex picking uses effective vertex positions (draft mesh_verts → keyframe mesh_verts → base mesh)
- Layer alpha-based selection hits the animated bounding box

**Code Location:** `src/components/canvas/CanvasViewport.jsx`, lines ~668–693 (effectiveNodes construction) and lines ~820–845 (vertex picking).

### Issue: Mesh Deform Keyframes Baked Base Mesh
**Root Cause:** Brush drag always called `updateProject`, writing deformed vertices directly into `node.mesh.vertices` (the base mesh) regardless of animation mode. Pressing K then captured the already-modified base, not a keyframe delta.

**Fix:** In animation mode + deform sub-mode, brush drag writes to `animRef.current.setDraftPose(partId, { mesh_verts })` instead of calling `updateProject`. Draft pose is overlaid on top of keyframe values during render and picking. When K is pressed, the effective verts (draft → keyframe → base) are read and inserted as a keyframe. `clearDraftPoseForNode` then reverts visual to the keyframe value. Scrubbing or stopping clears all drafts.

**Code Location:** `src/components/canvas/CanvasViewport.jsx`, lines ~876–885 (brush drag reroute).

### Issue: Group Hierarchy Keyframes Applied Globally
**Root Cause:** When a parent group had a keyframe at frame 1, and a child had its own keyframe at frame 12, the child's initial position (frame 0–11) would snap to match the parent keyframe instead of inheriting smoothly. This was because rest pose wasn't being captured.

**Fix:** Add `captureRestPose(nodes)` call when entering animation mode (M4 future work). Store unmodified node transforms in `animationStore.restPose`. When inserting the first keyframe for a track beyond `startFrame`, auto-insert the rest-pose value at `startFrame`. This ensures interpolation from frame 0 works correctly with group hierarchy — children inherit their base position until their own keyframes kick in.

**Code Location:** `src/renderer/animationEngine.js` (rest pose logic), `src/store/animationStore.js` (captureRestPose action), `src/components/canvas/CanvasViewport.jsx` (K handler, lines ~297–303).

---

## 9. Testing Checklist

✅ PNG import → single layer renders without mesh (quad fallback)  
✅ PSD import → all layers with correct names & z-order, no mesh by default  
✅ Character format detection → auto-creates Head/Body/Extras groups  
✅ Group creation → new group node with default transform  
✅ Transform gizmo → drag move/rotate handles; bounding box crops to opaque pixels  
✅ Inspector numeric inputs → live canvas updates  
✅ Depth tab drag → reorder by draw_order (squeeze behavior)  
✅ Groups tab drag → reparent (only mutates parent)  
✅ Visibility toggle → per-node show/hide  
✅ Layer selection → alpha-based picking (works without mesh)  
✅ Generate Mesh button → creates mesh, button changes to "Remesh"  
✅ Delete Mesh button → removes mesh, reverts to quad fallback  
✅ Add/remove vertex → requires mesh; correct world-space picking on transformed parts  
✅ Vertex drag → moves in local space while tracking world motion  
✅ Gizmo bounding box → matches opaque pixels for mesh-less parts, mesh vertices for meshed parts  
+ ✅ Horizontal Skew (HSkew) → correct shearing direction, separate inspector row, stable pivot calibration

---

## 10. Next Steps

1. **M4 Timeline** (next sprint):
   - Implement editor mode toggle (`Staging` | `Animation`) in top-left CanvasViewport
   - Build AnimationStore with poseOverrides, currentTime, isPlaying
   - Timeline transport controls: Current Frame, Start Frame, End Frame fields, Speed slider, FPS field
   - Timeline UI with keyframe editor
   - Playback engine with interpolation respecting loop range and speed multiplier
   - Integrate renderer to read pose overrides during draw
   - Keyframe workflow (K key for pose snapshots)

2. **M5 Export** (following sprint):
   - Frame capture loop
   - Spritesheet packing

3. **M6+ Advanced**:
   - Physics simulation
   - GIF/video export
   - Undo/redo integration
   - Blend modes, clipping masks

---

**Project Lead:** Nguyen Phan  
**Quality:** M3 production-ready, architecture solid for M4 progression
