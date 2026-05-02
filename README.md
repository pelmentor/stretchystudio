# 🧬 Stretchy Studio

**Browser-based Live2D Cubism rigger and animator. PSD in, `.cmo3` / `.moc3` out.**

Stretchy Studio takes a layer-decomposed PSD (typically [See-Through](https://github.com/shitagaki-lab/see-through) output) and produces a fully rigged Cubism model — face parallax, body warp chain, eye blink, hair sway physics, idle motion — that loads byte-equivalent to Cubism Editor's own export. No desktop app, no Cubism Editor licence, no toolchain to install. Runs entirely in your browser.

[🚀 Launch the Editor](https://editor.stretchy.studio) · [💬 Discord](https://discord.com/invite/zB6TrHTwAb) · [🌐 stretchy.studio](https://stretchy.studio)

> Forked from [MangoLion/stretchystudio](https://github.com/MangoLion/stretchystudio). The upstream README's "PSD → Spine 4.0" pipeline still works (see [GAP-005](docs/FEATURE_GAPS.md#gap-005--export-button-regressed-from-multi-target-to-single-target)); this fork's centre of gravity has shifted to the Cubism path.

---

## What it does

| | |
|---|---|
| **Live2D `.cmo3` / `.moc3` / `.can3` export** | Full reverse-engineered Cubism Core format support. Output verified byte-equivalent against Cubism Editor's own runtime export ([memory: project_runtime_export_parity](#)). The rigging happens in-browser; the file you ship is the file Cubism Viewer / Live2D Cubism SDK runtimes load. |
| **Native rig in the viewport** | The full Cubism deformer pipeline (warp + rotation deformers, FFD, parameter binding, physics) runs live in the editor canvas. No round-tripping to Cubism Viewer to see the rig — what you scrub is what you export. |
| **Auto-rig from See-Through PSDs** | One-click Init Rig harvests face parallax, body angle X/Y/Z, breath, eye closure curves, head/neck warps, hair sway physics, clothing physics, arm-elbow pendulums — all derived from PSD geometry, not hardcoded. |
| **Variant / shape-key system** | `face.smile`, `eyebrow.surprised`, `accessory.season` style variant layers automatically pair with their base, register a `Param<Suffix>` parameter, and fade in cleanly. 2D keyform grids (e.g. `ParamEyeLOpen × ParamSmile`) supported. |
| **Cubism-aware physics** | Pendulum hair sway, X-only clothing hem (Y motion would expose the layer underneath), 2-joint elbow whip, breath cycle. Output is a real `physics3.json` that runs in any Cubism SDK runtime. |
| **Idle motion generator** | Auto-generates a loop-safe `motion3.json` from your exported model3+cdi3+physics3 ([scripts/idle/](scripts/idle/) + `/idle` slash command). Skips physics-driven outputs to avoid double-driving. |
| **Hot-reload PSD layers** | Pick a folder of PNGs; the canvas refreshes when files change. Lets you iterate art and rig in parallel. |
| **Project file as source of truth** | `.stretch` round-trips all customisations cleanly (rig keyforms, variant pairings, physics rules, etc.). Re-Init Rig only re-derives fields the user hasn't customised. See [docs/PROJECT_DATA_LAYER.md](docs/PROJECT_DATA_LAYER.md) for the integrity model. |
| **In-app Logs panel** | Pipeline diagnostics (parabola fits, warp builds, orphan refs, stale rig signatures) flow to a Logs editor inside the v3 shell. No more round-tripping to `.rig.log.json`. |

---

## How it differs from upstream

| | Upstream | This fork |
|---|---|---|
| Primary export target | Spine 4.0 JSON, PNG sequence | Live2D `.cmo3` / `.moc3` / `.can3`, plus the upstream targets |
| Rig evaluator | Spine-style bones | Native Cubism warp + rotation deformers; **byte-faithful port of `WarpDeformer_TransformTarget`** from Cubism Core 5.0 disassembly ([CUBISM_WARP_PORT.md](docs/live2d-export/CUBISM_WARP_PORT.md)) |
| Shell layout | 4-zone (Canvas / Layers / Inspector / Timeline) | Blender-style splittable area tree with 5 workspace presets (Layout / Modeling / Rigging / Pose / Animation) |
| Auto-rig | DWPose skeleton | Full Cubism rig: parallax, body warp chain, eye closure parabolas, head rotation deformers, hair physics, clothing physics, arm pendulums |
| Variant layers | — | `.smile` / `.sad` style suffix system with auto-pairing, fade rules, 2D keyform grids |
| Visual debug | — | In-app Logs panel; reactive PSD-reimport stale-rig banner |

The two pipelines coexist. PNG sequence + Spine export still build (currently the v3 ExportModal only surfaces the Cubism path; restoring multi-target is [GAP-005](docs/FEATURE_GAPS.md#gap-005--export-button-regressed-from-multi-target-to-single-target)).

---

## Quick start

1. Open [editor.stretchy.studio](https://editor.stretchy.studio) — or run locally (see "Develop" below).
2. Drop a PSD into the workspace. Layer naming follows See-Through tag conventions (`face`, `eyewhite-l`, `eyelash-r`, `irides-l`, `eyebrow-l`, `mouth`, `front hair`, `back hair`, `topwear`, etc.); see [src/io/armatureOrganizer.js](src/io/armatureOrganizer.js) `KNOWN_TAGS` for the full list.
3. Step through the Import Wizard — it auto-tags layers, you confirm or correct.
4. **Init Rig** — one click. Harvests every Cubism deformer + physics rule from PSD geometry.
5. Switch to **Pose** workspace to scrub parameters and verify; **Animation** workspace to author timelines.
6. **Export** → `.cmo3` (Cubism Editor format) and `.moc3` + `.cdi3.json` + `.model3.json` + `.physics3.json` + `.motion3.json` (Cubism SDK runtime bundle, ready to drop into a Ren'Py / Unity / Web SDK project).

The runtime bundle is verified to load in [Live2D Cubism Web SDK](https://github.com/Live2D/CubismWebSamples) and the [Ren'Py Live2D pipeline](https://www.renpy.org/doc/html/live2d.html) without warnings.

---

## Variant layers (shape-key style)

Name a layer `<base>.<suffix>` (e.g. `face.smile`, `eyebrow.surprised`, `accessory.summer`) and Stretchy Studio:

1. Pairs the variant with its base sibling (same name minus `.suffix`).
2. Registers `Param<Suffix>` (e.g. `ParamSmile`).
3. Hides the variant by default.
4. Emits `0 → 1` opacity fade on the parameter.
5. Reparents + restacks `draw_order` so the variant sits immediately above its base.

Backdrop layers (face, ears, front/back hair) never fade — they're the opaque substrate that prevents midpoint translucency. Multiple variants per base are supported.

For `ParamEyeLOpen × Param<Suffix>` 2D compounds (variant eye that should still blink), the eye closure parabola is fit on the variant's own vertices, not shared with the base.

See [src/io/variantNormalizer.js](src/io/variantNormalizer.js) and [docs/live2d-export/](docs/live2d-export/) for the canonical fade rules + 2D grid spec.

---

## Develop

```bash
pnpm install
pnpm dev          # Vite dev server, http://localhost:5173
```

```bash
pnpm test         # full unit-test suite (2800+ cases across 68 files) + tsc --noEmit
pnpm typecheck    # tsc --noEmit only
```

Architecture overview lives in [docs/](docs/):

- [docs/V3_WORKSPACES.md](docs/V3_WORKSPACES.md) — workspace × concern matrix, viewport policy, Reset Pose semantics
- [docs/PROJECT_DATA_LAYER.md](docs/PROJECT_DATA_LAYER.md) — what survives save→load, what's re-derived at export, integrity holes (Phase A all shipped)
- [docs/FEATURE_GAPS.md](docs/FEATURE_GAPS.md) — open work + cross-references to upstream
- [docs/BUGS.md](docs/BUGS.md) — known bugs
- [docs/live2d-export/CUBISM_WARP_PORT.md](docs/live2d-export/CUBISM_WARP_PORT.md) — IDA Pro disassembly + JS port plan for the Cubism deformer kernel; oracle diff harness for BUG-003 quantification
- [docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md](docs/live2d-export/NATIVE_RIG_REFACTOR_PLAN.md) — rig ownership migration (export-time → project-time)

### Project layout

```
src/
├── App.jsx                 # mounts <AppShell />
├── v3/
│   ├── shell/              # Topbar, AreaTree, modals, StaleRigBanner, ExportModal
│   ├── editors/            # area editors: viewport, livePreview, outliner,
│   │                       #   properties, parameters, timeline, dopesheet,
│   │                       #   fcurve, logs, …
│   ├── operators/          # commands (file.save, app.undo, …) — keyboard + UI hooks
│   ├── keymap/             # default keybindings
│   └── templates/          # workspace layout presets (5 default workspaces)
├── io/
│   ├── live2d/
│   │   ├── cmo3writer.js   # .cmo3 (Cubism Editor) writer
│   │   ├── moc3writer.js   # .moc3 (Cubism SDK runtime) writer
│   │   ├── can3writer.js   # .can3 animation writer
│   │   ├── exporter.js     # top-level export orchestration
│   │   ├── runtime/        # in-app rig evaluator (chainEval, warpEval,
│   │   │                   #   rotationEval, artMeshEval) — port of
│   │   │                   #   Cubism Core kernels
│   │   ├── rig/            # auto-rig builders (faceParallax, bodyWarp,
│   │   │                   #   warpDeformers, rotationDeformers, physics,
│   │   │                   #   eyeClosureFit) + per-mesh signature module
│   │   ├── cmo3/, moc3/,   # format-specific section writers
│   │   │   can3/
│   │   ├── cmo3Import.js   # .cmo3 round-trip importer (debug / inspection)
│   │   └── idle/           # idle-motion generator (motion3.json synth)
│   ├── projectFile.js      # .stretch (ZIP) save/load
│   ├── variantNormalizer.js # variant-base pairing
│   └── armatureOrganizer.js # See-Through tag conventions, DWPose stub
├── store/                  # zustand stores: projectStore, paramValuesStore,
│                           #   animationStore, rigSpecStore, logsStore, …
├── services/               # RigService, ImportService, ExportService,
│                           #   PersistenceService — façades over stores
├── renderer/               # WebGL: scenePass, partRenderer, transforms
├── mesh/                   # auto-triangulation, mesh editing
├── lib/logger.js           # → useLogsStore + console; the in-app log surface
└── components/             # legacy v2 UI (PsdImportWizard wrapped inside v3)

scripts/
├── test/                   # 67 standalone unit-test scripts (~2800 cases)
├── cubism_oracle/          # Python ctypes harness over Live2DCubismCore.dll
│                           #   + JS oracle diff harness (cmo3 → rigSpec → evalRig
│                           #   vs Cubism). BUG-003 quantification.
├── native-rig-diff/        # canonicalise + diff helper for export regression
└── idle/                   # idle-motion CLI

docs/
├── V3_WORKSPACES.md        # workspace × concern matrix, viewport policy,
│                           #   Reset Pose semantics, wizard cleanup contract
├── PROJECT_DATA_LAYER.md   # data-layer audit + 10 integrity holes (Phase A
│                           #   detection all shipped 2026-05-02)
├── FEATURE_GAPS.md         # open features + cross-refs to upstream
├── BUGS.md                 # bug tracker (real bugs only)
└── live2d-export/          # format reverse-engineering + porting docs
    ├── CUBISM_WARP_PORT.md     # IDA disassembly + JS port plan
    └── NATIVE_RIG_REFACTOR_PLAN.md  # rig ownership migration

reference/
├── stretchystudio-upstream-original/   # pristine upstream snapshot
├── moc3-reader-re/         # community .moc3 RE notes
└── live2d-sample/          # Cubism's own sample bundles for diff testing
```

---

## See-Through credit

The auto-rig pipeline relies on layer-tag conventions established by [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through) ([paper](https://arxiv.org/abs/2602.03749)) — `face`, `eyewhite-l/r`, `eyelash-l/r`, `irides-l/r`, `eyebrow-l/r`, `mouth`, `nose`, `ears-l/r`, `front hair` / `back hair`, `topwear`, `bottomwear`, `legwear`. PSDs decomposed via the [free Hugging Face demo](https://huggingface.co/spaces/24yearsold/see-through-demo) load and rig with no manual tagging. Hand-tagged or differently-decomposed PSDs work too — the wizard lets you re-tag during import.

See-Through is trained on anime / VTuber-style illustrations. Realistic styles will not decompose correctly; they'd need manual layering anyway.

---

## License

MIT — see [LICENSE](LICENSE).
