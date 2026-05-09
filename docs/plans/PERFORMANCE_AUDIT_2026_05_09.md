# Performance audit + sweep — 2026-05-09

Multi-agent audit of the StretchyStudio codebase across five
dimensions, followed by a five-phase ship pass. Working rule for
the entire sweep: **RULE №1 — no quick-and-dirty fixes**. Every
shipped item is a proper crutchless solution; items that couldn't
fit that bar in this sweep are tracked below as deferred work
(not "fix later" scaffolding shipped under another name).

## Audit dimensions

Five parallel read-only agents scanned different surfaces:

1. **Loading / bundle** — `src/main.jsx`, `vite.config.js`,
   eager-mounted modals + editors, dependency-tree weight, dead UI.
2. **Runtime rendering hot path** — `src/components/canvas/CanvasViewport.jsx`
   rAF tick, chainEval / kernels, draw loop, per-frame work.
3. **React + Zustand subscriptions** — selector traps, missing
   memoisation, store granularity, hot list rendering.
4. **Memory / allocation** — typed-array churn, GPU resource
   lifecycle, blob URL retention, ONNX session disposal,
   undo/history bloat.
5. **Heavy pipelines** — PSD import, auto-rig stages, mesh
   generation, save/load, IndexedDB schema.

Findings overlapped substantially across agents (high confidence
signal). The synthesised punch list lives below.

## Punch-list status

Format: `[STATUS] ID — short` (file:line) — note. STATUS is one of
`SHIPPED` / `⏳DEFERRED⏳`. Commit refs link to the five Phase commits.

### Phase A — loading wins (commit `6653926`)

| ID | Item | File | Status |
|---|---|---|---|
| L1 | 7 fontsource families eagerly loaded → lazy per active font | [src/main.jsx:6-12](../../src/main.jsx#L6-L12), [src/contexts/ThemeProvider.jsx](../../src/contexts/ThemeProvider.jsx) | SHIPPED |
| L2 | `<ExportModal/>` always mounted → React.lazy + open-gated | [src/v3/shell/AppShell.jsx:35](../../src/v3/shell/AppShell.jsx#L35) | SHIPPED |
| L3 | `<PsdImportWizard/>` + ag-psd eager → lazy | [src/components/canvas/CanvasViewport.jsx:25](../../src/components/canvas/CanvasViewport.jsx#L25) | SHIPPED |
| L4 | 11 editors statically imported → React.lazy | [src/v3/shell/editorRegistry.js](../../src/v3/shell/editorRegistry.js), [src/v3/shell/Area.jsx](../../src/v3/shell/Area.jsx) | SHIPPED |
| L5 | `<Cmo3InspectModal/>` pulls full importer → lazy | [src/v3/shell/Cmo3InspectModal.jsx](../../src/v3/shell/Cmo3InspectModal.jsx) | SHIPPED |
| L7 | SaveModal / LoadModal / HelpModal / CommandPalette / ModalTransformOverlay → lazy | `src/v3/shell/AppShell.jsx` | SHIPPED |
| L8 | `projectFile.js` (jszip) eager-imported by canvas → dynamic await | [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) | SHIPPED |
| L9 | `vite.config.js` manualChunks claimed lazy-only deps into eager `vendor` chunk | [vite.config.js](../../vite.config.js) | SHIPPED |
| L10 | 5 unused shadcn UI files + 5 unused deps (recharts, embla, react-day-picker, input-otp, vaul) | `src/components/ui/`, `package.json` | SHIPPED |

**Quantified**: eager bundle **531 → 321 kB gzip (−210 kB / −40%)**.
Lazy-only chunks now: `psd` 66 kB gzip, `ort.bundle` 110 kB + 25 MB
wasm, `jszip.min` 30 kB gzip, plus 11 editor chunks + 8 modal chunks.

### Phase B — memory leaks (commit `5f85638`)

| ID | Item | File | Status |
|---|---|---|---|
| M3 | DWPose ONNX session never released — ~70-200 MB WASM heap leaked per wizard close | [src/io/armatureOrganizer.js:285-294](../../src/io/armatureOrganizer.js#L285-L294), [src/services/dwposeService.js](../../src/services/dwposeService.js) | SHIPPED |
| M4 | Orphaned VAO/VBO/IBO/textures on node delete (~64 MB texture each) | [src/renderer/partRenderer.js](../../src/renderer/partRenderer.js), [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (sync effect) | SHIPPED |
| M5 | Texture + audio blob URLs never revoked on project swap (50-200 MB per swap) | [src/store/projectStore.js](../../src/store/projectStore.js) (`disposeProjectResources`) | SHIPPED |
| M6 | Mesh workers leaked on viewport unmount | [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (cleanup return) | SHIPPED |
| M7a | Prune `imageDataMapRef` entries when their part transitions to a triangulated mesh (entries are dead weight after triangle hit-test path takes over) | [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (mesh worker success handler) | SHIPPED `be6cd84` |
| M7b | Downsample remaining wizard-window entries to 256² alpha mask | [src/components/canvas/viewport/alphaMask.js](../../src/components/canvas/viewport/alphaMask.js), [hitTest.js](../../src/io/hitTest.js) | SHIPPED `b068ed7` |
| M9 | `pendingPsd.layers` retains every layer's full RGBA | [src/store/wizardStore.js](../../src/store/wizardStore.js) | CLOSED — not actionable (see below) |

### Phase C — render thrash (commit `a21fc2e`)

| ID | Item | File | Status |
|---|---|---|---|
| S1 | CanvasViewport whole-store subs (`useEditorStore()` / `useAnimationStore()` no selector) | [src/components/canvas/CanvasViewport.jsx:165,192](../../src/components/canvas/CanvasViewport.jsx#L165) | SHIPPED |
| S3 | Filter-in-selector class — 5 `?? []` / `?? {}` traps | [ParametersEditor.jsx:33](../../src/v3/editors/parameters/ParametersEditor.jsx#L33), [AnimationsEditor.jsx:45](../../src/v3/editors/animations/AnimationsEditor.jsx#L45), [CanvasPropertiesPopover.jsx:34](../../src/v3/shell/CanvasPropertiesPopover.jsx#L34), [WarpDeformerOverlay.jsx:57](../../src/v3/editors/viewport/overlays/WarpDeformerOverlay.jsx#L57), [OutlinerEditor.jsx:77](../../src/v3/editors/outliner/OutlinerEditor.jsx#L77) | SHIPPED |
| S4 | `nodes.find()` inside selector — 7 Properties sections | PartInfo / Visibility / Transform / ModifierStack / BoneSection / MeshTab / BlendShapeTab | SHIPPED |
| S5 | `buildParamGroups(params)` un-memoed | [src/v3/editors/parameters/ParametersEditor.jsx](../../src/v3/editors/parameters/ParametersEditor.jsx) | SHIPPED |
| S6 | TreeNode + ParamRow not React.memo | [TreeNode.jsx](../../src/v3/editors/outliner/TreeNode.jsx), [ParamRow.jsx](../../src/v3/editors/parameters/ParamRow.jsx) | SHIPPED |
| S7 | ParamRow per-row activeId scan → lifted to ParametersEditor | [ParamRow.jsx](../../src/v3/editors/parameters/ParamRow.jsx) | SHIPPED |
| S2 | PropertiesEditor whole-`project` subscription (per-section subs already shipped via S4) | [PropertiesEditor.jsx:35](../../src/v3/editors/properties/PropertiesEditor.jsx#L35) | SHIPPED `b0c0579` |

### Phase D — runtime hot path (commit `805f2cc`)

| ID | Item | File | Status |
|---|---|---|---|
| R1 | livePreview drivers fire `setMany` every frame even at idle → epsilon delta gate | [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (livePreview branch) | SHIPPED |
| R5 | `computeBoneWorldMatrices` runs twice per frame → accept pre-computed bonework | [src/renderer/boneOverlayMatrix.js](../../src/renderer/boneOverlayMatrix.js) | SHIPPED |
| R6 | `cubismPhysicsKernel` allocates 4 fresh Float32Array(N) per tick → state-resident reuse | [src/io/live2d/runtime/cubismPhysicsKernel.js:506-518](../../src/io/live2d/runtime/cubismPhysicsKernel.js#L506-L518) | SHIPPED |
| R7 | `nodes.find` per art-mesh per frame (~10k linear comparisons) → O(1) Map lookup | [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) (rAF tick) | SHIPPED |
| R12 | livePreview eval cache key churns (fresh object each frame) → coordinate paramValuesRef with setMany | [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) | SHIPPED `c7726bb` |
| R4 | `mat3Mul` allocates fresh Float32Array(9) per multiply → mat3MulInto + scratch reuse | [src/renderer/transforms.js:23](../../src/renderer/transforms.js#L23) | SHIPPED `9485a26` |
| R3 (narrow) | chainEval ping-pong `bufB` Float32Array allocation → rigSpec-keyed pool | [src/io/live2d/runtime/evaluator/typedArrayPool.js](../../src/io/live2d/runtime/evaluator/typedArrayPool.js), [chainEval.js](../../src/io/live2d/runtime/evaluator/chainEval.js) | SHIPPED narrow scope |
| R3 wider (M1+M2) | chain-walk scratches + rotation matrices via the typed-array pool | [src/io/live2d/runtime/evaluator/](../../src/io/live2d/runtime/evaluator/) | SHIPPED `7532637` — partial: lifted-grid Float64 stays unpooled (R2 dependency) |
| R2 | `setLiftedGrids` Zustand-broadcasts a fresh Map per frame → revision counter + module-scope ref | [src/store/rigEvalStore.js](../../src/store/rigEvalStore.js), [WarpDeformerOverlay.jsx](../../src/v3/editors/viewport/overlays/WarpDeformerOverlay.jsx) | SHIPPED `03b060b` |

### Phase E — pipeline (commit `bd6db98`)

| ID | Item | File | Status |
|---|---|---|---|
| P3 | Mesh worker spawned per-call; 50 simultaneous boots on `autoMeshAllParts` → pool | [src/mesh/workerPool.js](../../src/mesh/workerPool.js) (new), [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) | SHIPPED |
| P5 | `listProjects()` reads every blob into memory → IndexedDB v2 split (meta + blobs) | [src/io/projectDb.js](../../src/io/projectDb.js), [src/services/PersistenceService.js](../../src/services/PersistenceService.js) | SHIPPED |
| P7 | `saveProject` serial texture/audio fetch → `Promise.all` | [src/io/projectFile.js](../../src/io/projectFile.js) | SHIPPED |
| P8 | `loadProject` serial texture decode → `Promise.all` | [src/io/projectFile.js](../../src/io/projectFile.js) | SHIPPED |
| - | Drop `JSON.stringify(..., null, 2)` indent (.stretch is gzipped anyway) | [src/io/projectFile.js](../../src/io/projectFile.js) | SHIPPED |
| P6 | `generate.js` mesh dedup is O(N²) over deduped points → spatial hash | [src/mesh/spatialHash.js](../../src/mesh/spatialHash.js), [generate.js](../../src/mesh/generate.js), [sample.js](../../src/mesh/sample.js) | SHIPPED |
| P10 | `importPsd` (`readPsd`) runs synchronously on main thread → worker (no sync fallback) | [src/io/psd.worker.js](../../src/io/psd.worker.js), [src/io/psd.js](../../src/io/psd.js) | SHIPPED `cc700f8` |
| P1 | Undo `structuredClone` + `JSON.stringify` per push (~50ms + tens of MB per snapshot) → drop clone, hold immer-frozen reference (memory profile equals immer-patches via structural sharing) | [src/store/undoHistory.js](../../src/store/undoHistory.js) | SHIPPED `cbcd761` |
| P2 | `finalizePsdImport` allocates N full-canvas ImageData on main thread inside one immer commit → worker pool composites + alpha-mask + bounds + PNG, only small results cross the boundary | [src/io/psdFinalize.worker.js](../../src/io/psdFinalize.worker.js), [src/io/psdFinalizeWorkerPool.js](../../src/io/psdFinalizeWorkerPool.js) | SHIPPED `47da983` |
| P4 | `runStage` re-runs full `initializeRigFromProject` per stage (~3× pipeline cost) → memo on project reference (immer auto-invalidation) | [src/services/RigService.js](../../src/services/RigService.js) | SHIPPED `77fb887` |

## Validation

Each phase gated against tsc + vite + the relevant test suites
before commit. The byte-fidelity gates (Cubism oracle / breath
fidelity / shelby byte fidelity) all stayed green throughout.

| Phase | tsc | build | tests |
|---|---|---|---|
| A | clean | clean | (no runtime/data changes) |
| B | clean | clean | projectRoundTrip 41/41, saveLoadRigSpec 19/19 |
| C | clean | clean | editorStore 87/87, propertiesSectionRegistry 19/19, outlinerTreeBuilder 109/109 |
| D | clean | clean | chainEval 25/25, cubismWarpEval 29/29, cubismRotationEval 57/57, cubismPhysicsKernel 15/15, **cubismPhysicsOracle worst 1e-5 vs Web SDK**, physicsTick 44/44, bonePostChainComposition 13/13, boneSkinning 35/35, armatureModifier 23/23, **breathFidelity 66/66**, **shelbyByteFidelity 23/23** |
| E | clean | clean | projectRoundTrip 41/41, saveLoadRigSpec 19/19, services 26/26 |

## Implementation pass 2026-05-09 (afternoon)

After the planning + review cycle, an implementation pass shipped
the following deferred items in commit order:

| Commit | Item | Notes |
|---|---|---|
| `c7726bb` | R12 | Eval cache idle hit (paramValuesRef coordinated with setMany) |
| `3-files` | P6 | Mesh dedup spatial hash (O(N²) → O(N)) + new `test:spatialHash` |
| `9485a26` | R4 | mat3MulInto + scratch matrix reuse |
| `cc700f8` | P10 | readPsd in worker (no sync fallback) |
| `R3 narrow` | R3 (ping-pong only) | rigSpec-keyed typed-array pool for chainEval bufB; new `test:typedArrayPool` |
| `be6cd84` | M7a | Prune `imageDataMapRef` on auto-mesh completion |
| `03b060b` | R2 | `setLiftedGrids` revision-counter gate (no per-frame broadcast) |

Validation: byte-fidelity gates (cubismPhysicsOracle worst 1e-5,
breathFidelity 66/66, shelbyByteFidelity 23/23) green throughout
each commit. tsc + vite build green at every step.

M9 was attempted and deferred-pending-redesign — the audit's
"step 'review' is the last consumer" claim doesn't hold against
the back-from-adjust → re-finalize path; needs UX work.

## Implementation pass 2026-05-09 (continuation)

A second implementation pass closed five of the remaining six
deferred items (M9 stays deferred-pending-redesign per the note
above). Commit order:

| Commit | Item | Notes |
|---|---|---|
| `7532637` | R3 wider | chain-walk scratch + rotation matrix pooling. Lifted-grid Float64 stays unpooled — pooling would break R2's `gridsContentEqual` content-equality gate (same buffer instance → comparison short-circuits → revision never bumps → overlay stops updating). |
| `b068ed7` | M7b | 256² aspect-preserving alpha mask via new `alphaMask.js`. ~64× memory drop on the wizard window. New `test:alphaMask` (21/21). |
| `b0c0579` | S2 | PropertiesEditor narrows to `s.project.nodes`. Audited `sectionRegistry.jsx`: every predicate reads at most `project.nodes`; renders read only `active`. Behaviour identical, sub gates on actual node mutations only. |
| `47da983` | P2 | `finalizePsdImport` per-layer compositing in `psdFinalize.worker.js` pool. Layer ImageData CLONED at dispatch (back→re-finalize re-reads). Worker computes alpha mask + bounds + PNG INSIDE; only small results cross back. PsdImportService.finalize/.reorder/.skip turned async + await. |
| `77fb887` | P4 | `memoInitializeRigFromProject` keyed on the immer-produced `project` reference. Same ref ⇒ same harvest (correct by immer's structural-sharing contract). Single-flight via Promise-valued WeakMap. New `test:harvestCache` (11/11). |
| `cbcd761` | P1 | undoHistory drops the per-push `structuredClone` + `JSON.stringify`. Immer auto-freezes produced state, so pushing the reference IS the snapshot. Memory profile equals immer-patches via structural sharing — same outcome via reference reuse instead of explicit patch records. |

Validation: byte-fidelity gates green throughout — chainEval 25/25,
cubismWarpEval 29/29, cubismRotationEval 57/57, cubismPhysicsKernel
15/15, cubismPhysicsOracle worst 1e-5, breathFidelity 66/66,
shelbyByteFidelity 23/23, bonePostChainComposition 13/13,
boneSkinning 35/35, armatureModifier 23/23, transforms 34/34. New
test suites: alphaMask 21/21, harvestCache 11/11. typecheck clean
at every step.

**M9 closed as non-actionable (2026-05-09 verdict):**

The audit's 3.2 GB projection assumed layers were canvas-sized RGBA;
they're actually layer-sized (region-of-opacity), totaling tens of
MB on typical character PSDs. Retention is only across an ACTIVE
wizard session — `wizardStore.reset()` drops everything on Complete,
Skip, or Cancel. The back-from-adjust → review → re-finalize path
legitimately needs the layers; eliminating retention would either
(a) require a UX change (drop the back button) or (b) introduce
a metadata-only fallback that reloads ImageData from texture URLs
on the back path, both of which add code complexity for a perf
issue that doesn't actually bite. Per Rule №1 — no fake fix for
a non-issue.

**Sweep complete.** Every audit-listed item is now SHIPPED or CLOSED.

## Deferred work — recommended order

The deferred items split cleanly by risk class:

**Safe mechanical wins** (do next):

1. **P6** — mesh dedup spatial hash. Pure algorithm swap, no
   byte-fidelity surface; gated by mesh tests.
2. **P10** — `readPsd` in a worker. Adds a worker module + a
   transferable-buffer marshalling layer; main thread frees up
   for seconds on big PSDs.
3. **M9** — null `pendingPsd.layers` after wizard's review step
   consumes them. Wizard step state-machine review needed.
4. **R4** — `mat3MulInto` + scratch matrix reuse. Mechanical;
   pairs naturally with R3.

**Medium surgery** (each its own focused commit):

5. **R3 + M1 + M2** — chainEval / cellSelect / kernels typed-array
   pool keyed on `DeformerStateCache`. **The biggest single
   per-frame perf win.** Byte-fidelity-critical: oracle round
   before merge, breath + shelby gates.
6. **R12** — eval cache content-hash so livePreview can hit the
   reuse path. Pairs with R3.
7. **R2** — `setLiftedGrids` → ref + revision counter. Touches
   WarpDeformerOverlay subscription; visual smoke after.
8. **M7** — downsample `imageDataMapRef` alpha to 256² mask.
   Hit-test threshold needs UX validation on real PSDs.
9. **S2** — PropertiesEditor whole-`project` sub. Sections
   already subscribe surgically (S4 shipped); this is the outer
   shell. Either narrow tabsFor/sectionsForTab signatures or
   subscribe to `s.project.nodes` + `s.project.parameters`
   separately and rebuild a façade.

**Largest refactors** (own multi-commit plans):

10. **P1** — undo via immer `produceWithPatches`. Project memory
    notes "still future work"; full undoHistory rewrite.
11. **P2** — `finalizePsdImport` worker pool with transferable
    ImageData. Same shape as P10 once that lands.
12. **P4** — `harvestAll(project, images)` memo across rig
    stages keyed by `versionControl.geometryVersion`. Touches
    RigService + initRig + per-stage refit.

## Notes for future sessions

- **Idle-skip is partial.** R1's epsilon-gate skips the React
  fan-out at true idle, but the eval cache (R12) is still
  unreachable in livePreview because `valuesForEval` is a fresh
  object every tick. R3 + R12 together unlock the full skip.
- **The byte-fidelity tests are the only gates that matter for
  chainEval/kernels work.** `test:cubismPhysicsOracle`,
  `test:breathFidelity`, `test:shelbyByteFidelity`. Run all
  three before any commit that touches the eval graph.
- **The `?? []` / `?? {}` selector class is the single highest-
  recurrence anti-pattern in this codebase** (5 instances found
  this sweep, plus 1 already-fixed referenced in MEMORY). Any
  new selector that returns an array/object should be reviewed
  for this pattern before merge.
- **CanvasViewport is 2700+ LOC and the largest single re-render
  cost** in the app. Whole-store subscriptions there are not
  acceptable; any new store touched from CanvasViewport needs
  field-level selectors + a non-subscribing ref for callback
  paths (the pattern Phase C established for editorStore +
  animationStore).
