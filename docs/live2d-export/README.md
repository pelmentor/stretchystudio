# Live2D Export for Stretchy Studio

Export Stretchy Studio projects to Live2D Cubism format — both runtime (.moc3) and project (.cmo3).

## Quick Start

1. Open your project in Stretchy Studio
2. Click **Export** in the toolbar
3. Choose export type:
   - **Live2D Runtime** — .moc3 ZIP for Ren'Py, game engines, Cubism SDK apps
   - **Live2D Project** — .cmo3 for editing in Cubism Editor 5.0

## Features

- **Runtime export** (.moc3): texture atlas, draw order, parameters, animations (.motion3.json)
- **Project export** (.cmo3): per-mesh textures, part hierarchy, rotation deformers, parameter bindings
- **Animation export** (.can3): parameter keyframes with Bezier curves, auto-generated alongside .cmo3
- **Auto-rig** (opt-in): with tagged PSD layers (face, mouth, eyewhite-l/r, etc.), the exporter generates a full standard rig — face parallax, eye closure, mouth open, neck/body tilt, head angle — ready to animate in Cubism Editor without manual deformer setup
- **Emotion / outfit / seasonal variants**: layer-name convention `<base>.<suffix>` (e.g. `mouth.smile`, `topwear.winter`) auto-creates `Param<Suffix>` that crossfades between base and variant. Works for non-eye features and for eye meshes via 2D keyform grid (blink × variant simultaneously)
- **Physics** (opt-in): hair front/back and skirt pendulum physics rules emit as `CPhysicsSettingsSourceSet` — pendulums swing on ParamBodyAngleX/Z
- **Bone weight baking**: monolithic limb meshes with per-vertex bone weights are exported as art mesh keyforms — smooth elbow/knee bending without mesh splitting
- **Iris clipping**: iris meshes clipped by their paired eyewhite (variant-aware — variant iris uses variant eyewhite mask)
- **Auto-parenting**: meshes automatically parented to their group's rotation deformer with correct coordinate transforms

## Export Types

### Live2D Runtime (.moc3 ZIP)
Produces a ready-to-use model for Ren'Py, game engines, and Cubism SDK apps.

**Contents**: `.model3.json` + `.moc3` + texture atlas + `.cdi3.json` + `.motion3.json`

### Live2D Project (.cmo3 / .cmo3 + .can3 ZIP)
Produces a Cubism Editor 5.0 project file for further editing.

When animations exist, exports a ZIP containing both `.cmo3` (model) and `.can3` (animation).

## Code Structure

All export code is in `src/io/live2d/`:

| File | Purpose |
|------|---------|
| `exporter.js` | Main orchestrator: `exportLive2D()` (runtime) + `exportLive2DProject()` (project) |
| `moc3writer.js` | .moc3 binary writer (V4.00, 100+ sections) |
| `cmo3writer.js` | .cmo3 XML orchestrator (textures, parts, per-mesh rig warps, CArtMeshSource, main.xml assembly) |
| `cmo3/constants.js` | VERSION_PIS, IMPORT_PIS, filter / deformer-root UUIDs |
| `cmo3/pngHelpers.js` | Raw PNG synthesis + P12 alpha-bottom contour extraction |
| `cmo3/deformerEmit.js` | Shared warp/keyform emit helpers (structural warps, KeyformBindings, uniform grids) |
| `cmo3/bodyRig.js` | `emitNeckWarp` + `emitFaceRotation` |
| `cmo3/faceParallax.js` | `emitFaceParallax` — protected regions, A.3/A.6b, `computeFpKeyform`, eye amp (#3), far-eye squash (#5), symmetrizeKeyform |
| `bodyAnalyzer.js` | Torso/head bbox analysis driving body-warp grid |
| `can3writer.js` | .can3 XML generator (animation scenes, parameter keyframes) |
| `xmlbuilder.js` | Shared XML builder for .cmo3 and .can3 generators |
| `caffPacker.js` | CAFF archive packer (XOR obfuscation, ZIP compression) |
| `model3json.js` | .model3.json manifest generator |
| `cdi3json.js` | .cdi3.json display info generator |
| `motion3json.js` | .motion3.json animation generator |
| `textureAtlas.js` | MaxRects BSSF atlas packer with auto-upscale |

UI integration: `src/components/export/ExportModal.jsx`

## Documentation

| Document | Contents |
|----------|----------|
| [AUTO_RIG_PLAN.md](AUTO_RIG_PLAN.md) | **Live roadmap** — per-phase evidence log for the auto-rig pipeline; authoritative source for current work |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Design decisions, data mapping, keyform binding system |
| [MOC3_FORMAT.md](MOC3_FORMAT.md) | .moc3 binary format reference (incl. compile-time field semantics that aren't in cmo3 XML) |
| [RUNTIME_PARITY_PLAN.md](RUNTIME_PARITY_PLAN.md) | Status of `.moc3` direct emission vs Cubism Editor's "Export For Runtime" — what's at parity, what's still cosmetic-gap |
| [CMO3_FORMAT.md](CMO3_FORMAT.md) | .cmo3 format reference (CAFF container, XML schema) |
| [TEMPLATES.md](TEMPLATES.md) | Live2D templates, 3D parallax, standard params — research & feasibility |
| [WARP_DEFORMERS.md](WARP_DEFORMERS.md) | Warp deformer coordinate system — reverse-engineered from Cubism Editor bytecode |
| `SESSION_NN_FINDINGS.md` | Per-session post-mortems (Session 23–current): root causes, bug lessons, decision trails |
| [research/](research/) | Study notes on papers that informed the 2D→pseudo-3D parallax approach |
| [head-angle-x-technique/](head-angle-x-technique/) | RE notes on Hiyori's AngleX technique (contains a post-mortem of a rejected RotationDeformer interpretation) |
| `../../scripts/moc3_inspect*.py` | Section-by-section moc3 dumpers (top-level / rotation / warp / mesh) used to diff against Cubism's "Export For Runtime" output when chasing rendering bugs |

## Data Mapping

| Stretchy Studio | Live2D Runtime (.moc3) | Live2D Project (.cmo3) |
|-----------------|----------------------|----------------------|
| Part (with mesh) | ArtMesh | CArtMeshSource |
| Group | Part (visibility group) | CPartSource |
| Group (with transform) | Rotation deformer | CRotationDeformerSource |
| Parameter | Parameter | CParameterSource |
| Animation track | .motion3.json curve | .can3 CMvAttrF keyframes |
| Texture | Atlas region | CLayer + CImageResource |
| Bone weights | Baked art mesh keyforms | Baked art mesh keyforms |
| Eye closure curve | 2-keyform mesh-level closure on `ParamEye{L,R}Open` | Same |
| Body warp chain (BZ → BY → Breath → BX) | 4 chained warp deformers | Same |
| Face parallax | `FaceParallaxWarp` (6×6, 9 keyforms on AngleX×Y) | Same |

## Known Limitations

- **No pose export** (.pose3.json) — outfit toggle groups (e.g. swap a whole costume set) not yet supported. Per-feature `.suffix` variants (mouth/eyes/etc.) ARE supported via the variant system.
- **No expression export** (.exp3.json) — facial expression presets not yet supported.
- **Multi-variant on same base fades on first suffix only** — a base mesh with both `.smile` AND `.sad` siblings fades to 0 on `ParamSmile` only; at `ParamSad=1` it stays visible. Full solution would require a 3D keyform grid.
- **Merged leg meshes**: single `legwear` PSD layer gets no knee controllers. Split into `legwear-l`/`legwear-r` for independent knee control.
- **Variant eye 2D compound geometry in .moc3**: variant eye meshes use the simpler 1D fade in the runtime moc3; cmo3 fits 4 cells across `ParamEyeL/ROpen × Param<Suffix>` for per-corner geometry. Visual difference is subtle and only at simultaneous mid-blink + mid-variant values.
- **Neck corner shape keys in .moc3**: cmo3 emits per-vertex corner offsets on `ParamAngleZ` for natural neck bending; moc3 relies on the NeckWarp grid morph alone (close but not identical).

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "File read error" in Cubism Viewer | .moc3 consistency check fails | Check field mapping in MOC3_FORMAT.md |
| .cmo3 opens as "(recovered)" | XML schema mismatch | Check required fields in CMO3_FORMAT.md |
| Geometry visible, no textures | Multiple CLayeredImages | Must use single-PSD pattern (one CLayeredImage, N CLayers) |
| Model blank/invisible | Missing keyform bindings | Every ArtMesh needs a binding chain |
| Mesh wireframe but no texture fill | Base positions in deformer-local space | Keep `meshSrc > positions` in canvas pixel space |
| Character scattered across canvas | Vertices in canvas space under deformer | Transform: `local = canvas - deformerWorldOrigin` |
| .can3 blank / NPE on load | Missing `track` back-refs or named fields | See ARCHITECTURE.md ".can3 Deserialization Rules" |
| "recover targetDeformer" warnings | Parts using ROOT deformer GUID | Use "NOT INITIALIZED" GUID (all zeros) |
| Texture lost on deformed vertices | Exported after bone rotation in SS | Exporter uses `restX/restY` — re-export from rest pose |
