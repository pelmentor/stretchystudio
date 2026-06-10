# Stretchy Studio

**A 2D character rigging editor with Blender-style authoring.**

Stretchy Studio takes a tagged PSD or hand-laid layer set and produces a fully rigged character — bones, mesh deformers, parameters, physics, animations — that you can edit, animate, and export. The authoring surface (modes, tools, hotkeys, the Properties panel, the canvas toolbar) is modelled after Blender so 2D artists with a 3D background feel at home.

[🚀 Launch the Editor](https://editor.stretchy.studio) · [💬 Discord](https://discord.com/invite/zB6TrHTwAb) · [🌐 stretchy.studio](https://stretchy.studio)

---

## What it does

### Authoring

- **3 workspaces** — Edit, Pose, Animation — each tuned to a phase of the pipeline, sharing one canvas + one source of truth.
- **One Edit Mode slot** with sub-modes (Mesh / Skeleton / BlendShape / Keyform / Weight Paint), surfaced via the canvas ModePill. `Tab` toggles Object↔Edit universally; `G/R/S` does modal grab/rotate/scale on bone pose; mesh-edit gets proportional editing with `O`/`Shift+O`/`Alt+O` falloff.
- **Click-to-select** with triangle hit-test against rig frames; `KeyA` toggles select-all; `B` box-select; `I` keyframes the hovered property at the playhead.
- **Native runtime evaluator** — chain eval, scrubber UI, mask allocator, pendulum physics, idle-skip eval cache. The viewport shows the deformed rig live during editing.

### Auto-rigging

- **Tagged PSD layers → full standard rig.** Tag layers `face`, `mouth`, `eyewhite-l/r`, `legwear`, etc., run Init Rig, get face parallax, eye closure, mouth open, neck/body tilt, head angle, physics-driven hair sway — without manually wiring deformers.
- **DWPose ONNX** for AI-driven joint detection on see-through-style PSDs; **heuristic** fallback for instant skeleton estimation from layer bounds.
- **Variants.** Layer-name convention `<base>.<suffix>` (e.g. `mouth.smile`, `topwear.winter`) auto-creates `Param<Suffix>` that crossfades between base and variant. Eye variants get a 2D keyform grid (blink × variant simultaneously).

### Animation

- **Timeline + Dopesheet + F-Curve editor** — Blender-style keyframe surfaces. Drag, snap-to-extremes, ghost-render-on-drag, plain-wheel zoom, MMB-pan.
- **Procedural motion presets** — generate idle / listening / talking / glances / tilts from one CLI command or the export dialog. Each preset is a deterministic function of (personality, duration, seed).
- **Audio tracks** — layer music + SFX in the timeline; trim, position, sync with the playhead.

### Export

- **Live2D Cubism** — both runtime (`.moc3` + `.model3.json` + `.physics3.json` + `.motion3.json`) and editor source (`.cmo3` + `.can3`) for Cubism Editor 5.0. The live viewport's evaluator is a port of Cubism's warp + pendulum kernels, so what you see matches what the runtime produces.
- **Spine 4.0 JSON** — bones, slots, attachments, animation tracks (translate / rotate / scale / opacity) with auto image packing.
- **PNG / WEBP / JPG sequences** — frame-by-frame, with custom scale, FPS, transparent / solid backgrounds.

### Other features

- **Iris clipping** — irises stay contained in their paired eyewhite (variant-aware).
- **Limb skinning** — monolithic limb meshes with per-vertex bone weights bake to art-mesh keyforms, so elbows/knees bend without mesh splitting.
- **Project format** — `.stretch` (ZIP with embedded textures + JSON metadata), full undo/redo via snapshot history.

---

## Quick start

1. Open [editor.stretchy.studio](https://editor.stretchy.studio).
2. Drag a `.stretch` project, PSD, or PNG into the workspace.
3. For a fresh PSD: follow the 3-step wizard (rig method → joint adjust → finish).
4. **File → Export…** → pick a format (Live2D runtime / Cubism project / Spine / PNG sequence).

For tagged-PSD auto-rig to work end-to-end, the layer names need standard tags (`face`, `eyewhite-l/r`, `mouth`, etc.). The wizard's heuristic mode and DWPose mode both write these tags during import.

---

## For developers

### Tech stack

[React](https://react.dev/) + [Vite](https://vitejs.dev/) · [Zustand](https://github.com/pmndrs/zustand) + [Immer](https://immerjs.github.io/immer/) · [WebGL2](https://developer.mozilla.org/en-US/docs/Web/API/WebGL2RenderingContext) + [gl-matrix](http://glmatrix.net/) · [Tailwind CSS](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) · [ag-psd](https://github.com/misonou/ag-psd) (PSD parsing) · [JSZip](https://stuk.github.io/jszip/) (export packaging).

### Project structure

```
src/
├── v3/                      Authoring shell (workspaces, ModePill, canvas toolbar, modals)
│   ├── shell/               AppShell, Topbar, CanvasArea, ExportModal, PsdImportWizard, etc.
│   ├── editors/             Per-area editors (outliner, properties, parameters, timeline,
│   │                        viewport, animations, dopesheet, fcurve, keyformGraph, logs)
│   ├── operators/           Keymap-bound operations (G/R/S, Tab, KeyA, click-select, …)
│   ├── keymap/              Hotkey registry + chord handling
│   └── templates/           Workspace layout templates
│
├── store/                   Zustand stores (projectStore, editorStore, animationStore,
│                            historyStore, rigSpecStore, modalTransformStore, …)
├── services/                Side-effect services (ExportService, ImportService,
│                            PsdImportService, RigService, PoseService, dwposeService, …)
│
├── io/
│   ├── live2d/              Live2D export pipeline (cmo3writer, moc3writer, can3writer,
│   │                        rig data layer, runtime evaluator, idle motion generator)
│   ├── exportSpine.js       Spine 4.0 JSON export
│   ├── psd.js               PSD parsing + tagging
│   └── projectFile.js       .stretch save/load
│
├── renderer/                WebGL2 pipeline (transforms, scenePass, partRenderer, mask
│                            stencil, gizmo overlay)
├── mesh/                    Auto-triangulation + edit algorithms
├── components/canvas/       Canvas-host React components (CanvasViewport, SkeletonOverlay,
│                            GizmoOverlay) — mounted under v3/shell/CanvasArea
└── components/ui/           Radix-derived primitives
```

### Setup

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # full test suite
pnpm typecheck  # tsc --noEmit
```

### Documentation

- [docs/README.md](docs/README.md) — entry point + "where do I look for X"
- [docs/BUGS.md](docs/BUGS.md) · [docs/FEATURE_GAPS.md](docs/FEATURE_GAPS.md) — living trackers
- [docs/PROJECT_DATA_LAYER.md](docs/PROJECT_DATA_LAYER.md) — project schema + integrity holes
- [docs/WORKSPACES.md](docs/WORKSPACES.md) — workspace + edit-mode + toolbar contract
- [docs/live2d/README.md](docs/live2d/README.md) — Live2D export pipeline reference
- [docs/archive/](docs/archive/) — shipped plans + session post-mortems

---

## See-Through pipeline (one supported entry point)

Stretchy Studio is friendly to PSDs decomposed by [**See-Through**](https://github.com/shitagaki-lab/see-through), a SOTA framework that takes a single anime illustration and produces fully inpainted, semantically distinct body-part layers. The wizard's tagging step recognises See-Through's naming convention and auto-rigs from there.

- Free demo: [Hugging Face](https://huggingface.co/spaces/24yearsold/see-through-demo)
- Paper: [arxiv.org/abs/2602.03749](https://arxiv.org/abs/2602.03749)

See-Through is trained on anime / VTuber styles. Realistic styles may not decompose well.

---

## License

MIT. See [LICENSE](LICENSE).
