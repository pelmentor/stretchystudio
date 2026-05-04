# Bug Tracker

Living document. One file, three sections: **Open**, **Investigating**, **Fixed**.
Each entry is short and self-contained — anyone reading should be able to pick it up cold.

## Conventions

- **ID** — `BUG-NNN`, monotonically increasing. Never reuse, never renumber.
- **Severity** — `critical` (data loss / can't ship) · `high` (blocks core flow) · `medium` (annoying but workaround exists) · `low` (cosmetic).
- **Status flow** — `open` → `investigating` → `fixed` (move the entry between sections; don't delete on fix).
- **When fixing** — note the commit SHA + date in the **Fix** field, then move the entry to *Fixed*. Keep a one-line root-cause summary so future regressions can grep for it.
- **When triaging** — fill in any missing **Repro** steps the moment you learn them. Empty Repro = guesswork.
- **Header marker** — `✅` prefix means fix shipped (visual scrub may still be pending — see entry body).

## Status snapshot (2026-05-03)

| Status | Entries |
|--------|---------|
| ✅ Fixed / Superseded | BUG-001 (tab-switch remount), BUG-002 (eye-closure parabola), BUG-004 (Init Rig armature/mesh sync via resetToRestPose), BUG-006 (warp extrapolation, superseded by Cubism warp port Phase 1), BUG-007 (variant visibility), BUG-008 (Init Rig + bone-move sister), BUG-009 (eyes closed after Init Rig), BUG-010 (Iris Offset sister), BUG-011 (seedAllRig get-throw), BUG-012 (wizard selection leak + workspace viz policy), BUG-013 (wizard char vanishes on viewport↔livePreview toggle), BUG-014 (legwear stretched / Body Angle unresponsive — bottom-band virtual cell inverted in cubismWarpEval port), BUG-016 (iris controller dead after Init Rig — trackpad now writes ParamEyeBallX/Y in addition to node.transform.x/y), BUG-017 (character disappears forever on layout↔animation switch — centerColumn JSX shape stabilized in AreaTree), BUG-018 (front-hair / shirt / pants frozen in rest pose — `seedParameters` was reading `n.tag` directly while every other consumer derives via `matchTag(n.name)`; fixed via `n.tag ?? matchTag(n.name)`), BUG-019 (Wireframe overlay never visible — `drawWireframe` called `gl.drawElements(gl.LINES, indexCount, ...)` against the triangle IBO, producing incoherent line segments; fixed by building a proper edge-pair IBO at upload time + binding it in drawWireframe) |
| 🔬 Instrumented (awaiting repro) | BUG-005 (per-piece Opacity slider), BUG-015 (BodyAngle in Live Preview — `paramSet` log NOT firing on user drag → slider→store path broken; UI gate hypothesis confirmed primary) |
| ⏳ Open | BUG-022 (hair tilted under hairRig:false), BUG-023 (save→load breaks arm/neck/hair live preview), BUG-024 (wizard reorder step: canvas click-to-select dead) — wave of bugs flagged 2026-05-04, fix pass scheduled after next /compact |
| Recently fixed (2026-05-03) | BUG-003 (closed via TWO commits same day): (1) authored-cmo3 init rig path closed the heuristic-vs-authored gap (AngleZ_pos30 PARAM 9.45 → **0.01 px**), (2) Phase 2b Setup port (`getRotationSetup` + canvas-final matrix) closed the body-warp residual (Breath_full PARAM 5.42 → **0.14 px** -97%, BodyAngleX 5.18 → **1.32 px** -74%, BodyAngleY/Z 3.50 → **0.18-0.21 px** -91 to -95%). Default chainEval kernel flipped to `cubism-setup`. GAP-008 opt-out wired to authored path |
| Recently fixed (2026-05-02) | BUG-020 (canvas distortion on panel resize — `ResizeObserver` + DPR-aware drawingbuffer sync), BUG-021 (proportional-edit toggle now surfaced in canvas toolbar via new `toggle` button kind) |

### Fix-style rule: when there's an upstream/older reference, do an exact port

If the bug exists because a v3 refactor diverged from a working
upstream / pre-v3 path (typically something under
`reference/stretchystudio-upstream-original/`), the fix is a
**byte-for-byte port of the upstream behaviour**, not a redesign.
No "boundary-loop alternative" / "direct-alpha-buffer scanner" /
any other "cleaner" rewrite — the reference is already validated;
relitigating costs time and rarely improves quality.

Perf concerns about the port (e.g., upstream rendered all PNGs;
v3's rigOnly mode wants speed) are addressed by *narrowing* the
ported behaviour to the cases that need it (e.g., render PNGs
only for eye-source meshes), not by inventing a third mechanism.

Mirrors `feedback_exact_port.md` in user memory.

---

## Test setup

Common test inputs + references used across pipeline bugs (BUG-002, BUG-003, anything export-related). Keep paths absolute — these aren't checked into the repo.

| Role | Path | Source |
|------|------|--------|
| **Test PSD** (input) | `D:\Projects\Programming\stretchystudio\shelby_neutral_ok.psd` | Artist-authored PSD |
| **Known-good `.cmo3` reference** | `D:\Projects\Programming\stretchystudio\shelby.cmo3` | **SS v0.2 export** (pre-v3, working) |
| **Cubism Editor runtime bundle** (model3 / moc3 / textures) | `D:\Projects\Programming\stretchystudio\New Folder_cubism\` | Cubism Editor's "Export For Runtime" output |

**`shelby.cmo3` is SS v0.2's export of the same PSD** — pre-Blender-refactor codebase that produced a working .cmo3 per user (2026-05-02: "там в проекте cmo3 всё отлично"). It's the **regression reference**: when v3's export diverges from desired behaviour (BUG-003 BodyAngle mismatch, legwear stretch after Init Rig, etc.), diff the v3 .cmo3 output against this file to see what working output looks like. v0.2's source is at `reference/stretchystudio-upstream-original/` if upstream-side RE is needed.

**`New Folder_cubism\` is Cubism Editor's runtime export** — used by the oracle harness (`scripts/cubism_oracle/`) as the byte-faithful Cubism Core reference for kernel ports (Phase 1 / Phase 2 / Phase 3 of the warp evaluator port).

**How to use these for any pipeline bug:**

1. Drop `shelby_neutral_ok.psd` into the editor → run the wizard → export `.cmo3`
2. Diff v3 output against `shelby.cmo3` (SS v0.2's output) to find the **regression** — XML structure, deformer chains, keyform values via inspectors
3. For runtime parity, load both v3 and Cubism's `New Folder_cubism\` bundle in Cubism Viewer and scrub the same params; the oracle harness handles the binary diff
4. Three-way comparison if needed: v0.2 .cmo3 (regression-free path) ↔ v3 .cmo3 (current) ↔ Cubism runtime bundle (byte-truth)

---

## Open

### BUG-024 — Wizard step 2 "Reorder Layers": clicks on canvas don't select pieces

- **Severity:** medium (workaround exists — drag-reorder in the Outliner pane) · **Reported:** 2026-05-04 (user) · **Status:** open

**Repro:** PSD import wizard → step 2 (Reorder Layers banner). Click any layer/piece in the canvas. Selection doesn't change.

**Root cause (already traced):** Pre-mesh part nodes (created by `finalizePsdImport` after PSD parse) have no `mesh` field yet, and the click-to-select fallback in [src/io/hitTest.js:152-156](src/io/hitTest.js#L152-L156) requires `node.imageWidth` + `node.imageHeight` to enter the parts list at all:

```js
const hasQuad = typeof n.imageWidth === 'number'
  && typeof n.imageHeight === 'number'
  && n.imageWidth > 0
  && n.imageHeight > 0;
return hasTris || hasQuad;
```

Search across `src/` confirms: no PSD import code path (`PsdImportService.js`, `captureStore.finalizePsdImport`) sets `imageWidth` / `imageHeight` on parts. The fallback was designed for this exact case but never wired to its data source. Pre-mesh parts get filtered out → click-to-select silently does nothing during reorder.

**Fix outline (no crutches):** in `finalizePsdImport` (registered in `captureStore` from `CanvasViewport.jsx`), set `node.imageWidth = layer.width` + `node.imageHeight = layer.height` from the parsed PSD layer data when each part node is created. The `transform.x/y` already positions the layer in canvas-px so the existing inverse-worldMatrix path in hitTest.js maps the click correctly.

---

### BUG-022 — Init Rig with `hairRig: false` produces tilted/perma-deformed hair

- **Severity:** high (subsystem opt-out is a core "auto-rig is good enough" feature) · **Reported:** 2026-05-04 (user) · **Status:** open

**Repro:** Open a rigged project, set `autoRigConfig.subsystems.hairRig = false`, run Init Rig. Observe: hair pieces (front-hair, back-hair) render as if a hair-sway parameter is permanently applied — tilted / pre-deformed at rest, instead of staying in their canvas-px PSD position.

**Suspect surface — post-BFA-006 wiring divergence.** Pre-Phase-3, the live evaluator received `applySubsystemOptOutToRigSpec(rigSpec, {subsystems, nodes})`'s output from `useRigSpecStore.buildRigSpec()`. That pass neutralises disabled-subsystem rigWarps in-place (single rest keyform, empty bindings → identity FFD on every frame). After Phase 3's wiring, `useRigSpecStore.rigSpec` can come from `selectRigSpec(project)` (the fast-path / auto-fill subscribe) which walks `project.nodes` deformer entries directly. The opt-out neutralisation step is **not** in that pipeline. Whether disabled-subsystem rigWarp nodes survive in `project.nodes` after `seedAllRig` (they shouldn't — `harvestSeedFromRigSpec` filters them before seeding) needs verification; if any DO survive, chainEval evaluates them with no neutralisation and the hair tilts.

**Where to look first:**
- [src/io/live2d/rig/initRig.js](src/io/live2d/rig/initRig.js) `applySubsystemOptOutToRigSpec` — the neutralisation pass, currently applied to the heuristic generator's output before storing in `useRigSpecStore.rigSpec`. Check what selectRigSpec produces in the disabled-subsystem case.
- [src/io/live2d/rig/initRig.js](src/io/live2d/rig/initRig.js) `harvestSeedFromRigSpec` — does it skip the rigWarp from the harvest map (so seedRigWarps doesn't write the node)? Confirm the dropped warps don't slip in via a different channel (e.g. cmo3-authored path's `_cmo3Scene.deformers` synth).
- [src/store/rigSpecStore.js](src/store/rigSpecStore.js) — both the buildRigSpec fast path AND the auto-fill subscribe should run the neutralisation step before publishing the rigSpec. Probably the cleanest fix is to apply opt-out inside `selectRigSpec` itself (read `project.autoRigConfig.subsystems` + filter), so any consumer of selectRigSpec gets the right rigSpec.

**Fix outline (no crutches):** make subsystem opt-out an intrinsic part of `selectRigSpec` so every consumer sees the neutralised rig regardless of which path published it. Drop the duplicated `applySubsystemOptOutToRigSpec` call in initRig.js once the selector handles it.

---

### BUG-023 — Save→IDB→Load: live preview broken (arm sway dead, neck/hair don't track cursor)

- **Severity:** high (post-BFA-006 round-trip regression — core editor flow) · **Reported:** 2026-05-04 (user) · **Status:** open

**Repro:** Save a rigged project to IndexedDB ("Save to Library"). Reload it. Switch to Live Preview. Observe:
- Arm sway physics doesn't fire on torso movement.
- Neck doesn't follow the cursor (LMB cursor → ParamAngleX/Y).
- Front/back hair don't follow the cursor either.

Re-running Init Rig after the load most likely fixes it (not yet confirmed by user — verify before fix).

**Suspect surface — multiple BFA-006 wiring touchpoints converge on save/load:**

1. **`useRigSpecStore.rigSpec` auto-fill gate.** `94dc0be` changed `_isComplete` to `project.lastInitRigCompletedAt` + `artMeshes.length > 0`. After save/load, `lastInitRigCompletedAt` IS persisted (verified in projectFile.js + projectStore.loadProject hydrators). But a project that was Init-Rig'd pre-Phase-6 (sidetables only, no rotation deformer nodes) may now have artMeshes in selectRigSpec's output but produce a partial rigSpec missing rotation deformers — chainEval renders it but rotation-driven params (ParamAngleX/Y for face/neck) have no deformer to drive.
2. **physicsRules in selectRigSpec output.** `selectRigSpec` calls `resolvePhysicsRules(project)`. If `project.physicsRules` is empty / not-resolved-into-physics3 form, the runtime physics tick has no rules → no arm sway.
3. **Cursor → param-value pipeline.** Possibly unrelated to BFA-006; verify `useParamValuesStore` mounts cursor handlers on load. (Memory `feedback_in_app_logging` — Logs panel may show whether the cursor handler is publishing param values at all.)
4. **`paramValuesStore.seedMissingDefaults` not running on auto-fill path.** `_seedDefaultsForRig` IS called from both buildRigSpec paths AND the auto-fill subscribe in `94dc0be`. But it doesn't seed cursor-driven values (those start at 0 / default and update on pointer-move). Should not be the cause.

**Where to look first:**
- Open Logs panel after save/load reproduction. Note any `paramOrphans`, missing physicsRules, or missing rigSpec warnings.
- Compare `selectRigSpec(project)` output before (Init Rig run, working) vs after (save→load, broken). If rotation deformers are missing in the post-load case → migration v15 didn't synthesise them (correct — they're never sidetables) AND the project has no rotation deformer nodes from a Phase-3+ Init Rig.
- Identify whether the user's broken project was first Init-Rig'd PRE-Phase-3 (= rotations never got dual-written to nodes; only legacy sidetables had warps; v15 migration synthesised warp nodes on load but rotations are absent from project.nodes).

**Hypothesised root cause:** Phase 3's auto-fill gate now permits a "rigSpec without rotations" through (because `_isComplete` doesn't check rotation count by design — see audit fix at `94dc0be`). For projects that haven't been re-Init-Rigged under Phase 3+, the runtime gets a partial rigSpec → angle-driven body deformation works, but face/neck/head rotation deformers are missing → cursor params have no driver.

**Fix outline (no crutches):** treat `lastInitRigCompletedAt` as not-sufficient when project.nodes lacks any rotation deformer nodes — auto-fill should additionally trigger an async `buildRigSpec` to populate rotations + physics on first load post-Phase-3, then the marker matches reality. Or: migration v15 detects pre-Phase-3 saves and clears `lastInitRigCompletedAt` so the user is prompted (or auto-flow) re-Init-Rigs.

---

### ✅ BUG-019 — Wireframe overlay toggle never makes anything visible

- **Severity:** medium (mesh-edit mode UX broken — user can't see what they're editing) · **Reported:** 2026-05-02 (user-flagged) · **Fixed:** 2026-05-02

**Repro:** in Modeling or Rigging workspace, open the Layers popover, tick "Wireframe" — nothing appears in the viewport. Same with "Vertices" alongside the wireframe. Inverting the workspace policy gates is irrelevant; the rendering itself is broken.

**Root cause:** [`partRenderer.drawWireframe`](../src/renderer/partRenderer.js#L235) was structurally wrong:

```js
gl.drawElements(gl.LINES, state.indexCount, gl.UNSIGNED_SHORT, 0);
```

`state.indexCount` indexes the **triangle** IBO (n_triangles × 3 indices, used by the textured pass for `gl.TRIANGLES`). Re-interpreting that as `gl.LINES` consumes indices in pairs — so for triangles `[a,b,c, d,e,f, g,h,i, ...]` you get line segments `(a→b), (c→d), (e→f), (g→h), ...` which are neither triangle edges nor anything coherent. At most resolutions the segments are individually too short / sparse / incoherent to read as a wireframe; the user sees nothing.

**Fix:** `partRenderer.uploadMesh` now builds a separate `state.wireIbo` containing line-segment pairs for every unique triangle edge (3 pairs per triangle, deduped via a `Set` keyed by min/max vertex pair so each interior edge is drawn once). `drawWireframe` swaps to `state.wireIbo` before the draw call and restores `state.ibo` after, mirroring the pattern `drawEdgeOutline` already used for the boundary loop. Approximately 30 LOC: edge-pair build at upload, new GPU buffer + count fields on per-part state, swap-and-restore in drawWireframe, cleanup in destroyPart.

Discovered while planning the edit-mode refactor (single `editMode` slot replacing the prior triple). The user's question "the layers button is not actually making anything visible" was structurally a separate bug from the edit-mode consolidation but in scope of the same sweep — without visible wireframe, mesh-edit mode is meaningless.

---

### ✅ BUG-017 — Character disappears forever on layout↔animation workspace switch

- **Severity:** high (entire model invisible until reload — recurring with the BUG-001 family) · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02

**Repro (user, 2026-05-02 logs):**

1. Init Rig on the man-character.
2. Click the Animation workspace pill in the topbar.
3. **Symptom:** character vanishes. Switching back to Layout doesn't restore it. Reload required.

**Smoking gun in the logs:**

```
17:12:47.535 workspaceSwitch — layout → animation
17:12:47.548 viewportGL — WebGL2 context destroyed (cleanup)
17:12:47.564 viewportGL — WebGL2 context initialised
17:12:47.565 areaTab — center: (none) → t21 (editorType=viewport, remount=false)
```

The `center` Area says `remount=false` (BUG-001's ErrorBoundary key fix is still working), but `WebGL2 context destroyed (cleanup)` fires anyway — meaning CanvasViewport's parent JSX tree changes shape across the switch, so React reconciliation tears down the subtree even though the leaf component's key is stable.

**Root cause:** [`AreaTree.jsx`](../src/v3/shell/AreaTree.jsx) rendered the `centerColumn` differently per workspace:

- **Layout** (no timeline): `centerColumn = <Area area={center} />` — bare Area
- **Animation** (timeline present): `centerColumn = <PanelGroup><Panel><Area /></Panel><handle><Panel><Area timeline /></Panel></PanelGroup>` — wrapped

Switching workspaces moved the center `<Area>` from the bare position to inside `<PanelGroup>` → `<Panel>`. React saw different element types at the same depth, **unmounted the old subtree (taking CanvasArea + CanvasViewport with it)**, and mounted a fresh tree. WebGL context destroyed, every texture upload lost — model invisible until the user re-triggers an upload (which never happens unless they remesh/reload).

**Fix:** `centerColumn` now ALWAYS wraps in a vertical `PanelGroup`, with the timeline Panel rendered conditionally as a sibling. The center Panel (and its `<Area>` child) sits at the SAME depth in EVERY workspace, so React reconciliation preserves the mount across timeline-presence flips. WebGL context survives, texture uploads survive, no character disappear.

**Files touched:**
- [src/v3/shell/AreaTree.jsx](../src/v3/shell/AreaTree.jsx) — centerColumn restructured (always PanelGroup vertical; timeline section is a conditional sibling)

**Lesson:** workspace switches that change which areas exist (e.g. animation adds `timeline`) tempt conditional `<X>` vs `<Y>` JSX shapes at the same depth. React reconciler treats this as element-type change → full subtree remount. **Stable mount across workspace switches requires identical JSX skeleton — branch on which children to render INSIDE a stable wrapper, not on which wrapper to use.** BUG-001 fixed the leaf-key half of this; BUG-017 fixes the parent-tree half.

---

### ✅ BUG-016 — Iris controller (trackpad above head) doesn't move eyes after Init Rig

- **Severity:** medium (eye-look pose authoring blocked post-Init-Rig) · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02

**Repro (user, 2026-05-02):**

1. PSD wizard → Init Rig.
2. Try dragging the "Iris Offset" trackpad in the SkeletonOverlay (the small dark pad above the head with a knob).
3. **Symptom:** "iris controller stops moving eyes after init rig". Pre-Init-Rig the eyes visibly translate when the knob moves; post-Init-Rig nothing happens.

**Root cause:** [`SkeletonOverlay.jsx`](../src/components/canvas/SkeletonOverlay.jsx) trackpad handlers wrote to `node.transform.x/y` of the eyes bone group. Pre-Init-Rig the renderer falls back to `mesh.vertices` projected through `computeWorldMatrices`, so the group transform visibly translates the eye children. Post-Init-Rig the renderer uses `evalRig` output (canvas-px vertex positions from the rigSpec chain), which doesn't compose `node.transform.x/y` of bone groups — that path isn't part of Cubism's deformation model. The trackpad's writes were strictly invisible to the rendered output.

This was the same shape as v0.2 (which had no rigSpec, so worldMatrix path was always active and the trackpad worked). v3's introduction of evalRig broke the assumption.

**Fix (Cubism-matching):** the trackpad now writes to **`ParamEyeBallX` / `ParamEyeBallY`** (range ±1, mapped from the trackpad's ±40 px) in addition to `node.transform.x/y`. The auto-rig pipeline ([`tagWarpBindings.js`](../src/io/live2d/rig/tagWarpBindings.js#L213) iris gaze block) builds iris-translation keyforms bound to `ParamEyeBallX × ParamEyeBallY`, so writing those params drives the rig's iris translation through evalRig — which is exactly how Cubism authors iris movement. The simultaneous `node.transform` write keeps the pre-Init-Rig fallback path working without regression.

The knob's rendered position now reads from `ParamEyeBallX/Y` when a rigSpec is present, falling back to `node.transform` otherwise. Pre-Init-Rig the trackpad behaves like v0.2; post-Init-Rig it drives the rig the Cubism way.

**Files touched:**
- [src/components/canvas/SkeletonOverlay.jsx](../src/components/canvas/SkeletonOverlay.jsx) — trackpad onPointerDown + onPointerMove now also call `useParamValuesStore.setMany({ ParamEyeBallX, ParamEyeBallY })`; knob position reads ParamEyeBall when rigSpec present

**Lesson:** v3's evalRig is the single source of truth for rigged-part vertex positions. UI controllers that historically wrote to `node.transform` of bone groups (a v0.2-era worldMatrix-path mechanism) need a parallel write to whatever **parameter** the rig pipeline binds for that controller's intent. The right Cubism-side wire is the one auto-rigged from `tagWarpBindings.js` — that's the contract.

---

### ✅ BUG-018 — Front-hair / shirt / pants pieces frozen in rest pose (5 tag-gated standard params dropped during seedParameters)

- **Severity:** medium · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02 · `seedParameters` now derives the tag from `matchTag(n.name)` when `n.tag` is absent on the project node ([paramSpec.js:347-360](../src/io/live2d/rig/paramSpec.js#L347-L360))

**Original framing was wrong.** The instrumentation added to [perPartRigWarps.js](../src/io/live2d/cmo3/perPartRigWarps.js) on the man-character repro showed `RigWarp_front_hair` IS emitted (partId `0d5ab07c1be3`) and DOES appear in the `chainEvalLift` summary. `rigWarpsByPartId: 17` matches the 17 emitted warps. The rig warp was never missing.

**Actual smoking gun** — the `paramOrphans` warning:

```jsonc
"ParamHairFront": { "bindings": ["rigWarps[0d5ab07c1be3]:bindings[0]"], "animationTracks": [], "physicsInputs": [] }
```

Five standard params (`ParamHairFront`, `ParamHairBack`, `ParamShirt`, `ParamBust`, `ParamPants`) were referenced by tagWarpBindings' rig-warp keyforms but **never registered in `project.parameters[]`**. Without a parameter spec there's no slider in the Parameters panel and no value source — chainEval reads `0` for them every frame, so the bound rig warps stay locked at their middle keyform. User-visible symptom: hair / shirt / pants pieces appear frozen.

**Root cause.** In [paramSpec.js#seedParameters](../src/io/live2d/rig/paramSpec.js#L337), the meshes mapping read `tag: n.tag ?? null` from the project node. Real-world wizard-imported nodes never store `n.tag` — every other consumer (exporter.js:99, moc3writer.js:115, physics3 generator at exporter.js:258, the rig-harvest path that builds the meshes-with-tags array for cmo3writer) derives it via `matchTag(node.name)`. The `requireTag` gate in `buildParameterSpec` therefore saw `tagsPresent = ∅` even when the project clearly contained `front hair`/`back hair`/`topwear`/`legwear` parts, and silently dropped every gated standard param. Test fixtures DO write `n.tag` directly, which is why the regression never surfaced in unit tests.

**Fix.** [paramSpec.js:347-360](../src/io/live2d/rig/paramSpec.js#L347-L360) — `tag: n.tag ?? matchTag(n.name ?? '')`. Preserves test-fixture compatibility while making real-world projects route tags through the same canonical detector every export path uses.

**Verification.** `npm run test:paramSpec` (21/21), `node scripts/test/test_e2e_equivalence.mjs` (27/27), `npm run test:subsystemsOptOut` (46/46). User repro on the man-character PSD pending — expected outcome: 23 → 28 params seeded post-Init-Rig, `paramOrphans` warning empty, hair / shirt / pants pieces become draggable via the new sliders.

**Lesson.** When 5 distinct symptoms (hair, hair, shirt, bust, pants) all converge on the same `paramOrphans` warning, the bug is upstream of any single subsystem — almost certainly the parameter registry itself, not the consumers that reference it.

---

### 🔬 BUG-015 — BodyAngle X/Y/Z sliders unresponsive in Live Preview tab

- **Severity:** high (advertised pose params don't drive the rig in the user-visible mode) · **Reported:** 2026-05-02 · **Status:** open, needs instrumented repro

**Repro (user, 2026-05-02 — same session as BUG-014 verification):**

1. Drop PSD → wizard → Init Rig (legwear stretch fixed by BUG-014).
2. Switch the `center` area tab to **Live Preview**.
3. Open Parameters editor in `rightTop`. Drag the ParamBodyAngleX / ParamBodyAngleY / ParamBodyAngleZ sliders.
4. **Symptom:** "слайдеры стоят на месте" — sliders don't move when dragged, OR they move but the rendered character does not visibly tilt.

**What we already know:**

- `[bodyWarp] chain built` synthesis log on the user's character showed reasonable peak shifts: `paramBodyAngleZ_at_plus10.peakShiftPx: 29.46`, `paramBodyAngleY_at_plus10: 11.18`, `paramBodyAngleX_at_plus10: 27.24`. So the rigSpec encodes intended movement.
- `bodyAnalyzer` measurement worked (`bodyFracSource: "measured-feet-plus-shoulder-feet-midbody"`); body warp anchors are anatomically correct.
- BUG-014's bottom-band kernel fix unblocked legwear (user-confirmed). Body Angle still doesn't work.
- **2026-05-02 17:24:31 → 17:24:42 repro window:** instrumentation `paramSet` log was added to `paramValuesStore.setParamValue` for every BodyAngle write; `evalRigBodyAngle` log throttled at 1s tracks what evalRig actually consumes. User dragged the BodyAngle sliders during this 11-second window in livePreview tab. **The Logs panel showed NO `paramSet` events.** That eliminates eval / rendering hypotheses and pins the bug at **slider → store**: the drag never reached `setParamValue`. Either the Radix Slider is not registering `onValueChange`, or the ParamRow is unmounted/disabled when the user dragged.

**Updated hypothesis space (post-2026-05-02-repro):**

1. **Radix Slider controlled-value reset** — `<Slider value={[value]}>` creates a fresh array literal every parent render. If the parent re-renders during a drag (e.g. because something else updates `paramValuesStore`), Radix may interpret the new prop as an external value-change and reset its internal drag state. Live preview drivers call `setMany({ ParamBreath, ParamAngleX/Y/Z, ParamEyeBallX/Y, ... })` every frame, which mutates `useParamValuesStore.values` (new object identity each call). ParamRow's selector is `s.values[id]` (per-param) so it shouldn't re-render unless its own param changes — but a parent further up (ParametersEditor or the Area host) might be subscribing more broadly.
2. **Pointer capture stolen** — the LivePreview canvas mounts CanvasViewport with `previewMode=true`. Cursor look gates on LMB-over-canvas. Maybe the canvas's pointer handlers capture the pointer when LMB-down fires anywhere in the document, including over the rightTop area's slider. Result: the slider's `onPointerDown` never fires because the canvas already grabbed the pointer.
3. **ParamRow unmount during drag** — slider + parent re-render at high frequency (60Hz) caused by something else; mid-drag re-render replaces the `<Slider>` instance, killing its drag state.

**Instrumentation shipped 2026-05-02 (post-compact):**

- `paramRow` debug log on ParamRow's `onPointerDown` AND `onValueChange` for the three BodyAngle params ([ParamRow.jsx:113-130](../src/v3/editors/parameters/ParamRow.jsx#L113-L130)). Splits the slider→store boundary in two: pointerDown without onValueChange = Radix isn't producing value events; onValueChange without paramSet = different problem at the setParamValue call.
- `lookRef cursor-look engaged` / `released` debug log on every cursor-look toggle ([CanvasViewport.jsx](../src/components/canvas/CanvasViewport.jsx)). Confirms whether the Live Preview canvas is stealing pointer events when the user reaches for a slider.

**Post-instrumentation repro (2026-05-02 17:49):** Logs panel showed cursor-look events (`lookRef cursor-look engaged` clientX=1257) but **zero `paramRow` events** — the user did not actually drag a BodyAngle slider in this run. Need a fresh repro that explicitly drags a BodyAngle slider in livePreview tab to surface which boundary fails.

**Decision tree once user repros with a slider drag:**
- `paramRow pointerDown` then `onValueChange` then `paramSet` → all three layers OK; bug downstream of the store (e.g., evalRig not reading / chainEval not propagating).
- `pointerDown` but no `onValueChange` → Radix isn't producing value events (mid-gesture interruption).
- No `pointerDown` at all → slider never received the event. Cross-check `lookRef cursor-look engaged` timestamp against the drag attempt to confirm/refute pointer-capture theft.

**Related:** depends on BUG-014's fix landing (it has). Phase 2b for rotation deformer is a separate concern (AngleZ keyform divergence, not slider responsiveness).

---

### ✅ BUG-001 — Character disappears when switching workspaces / area tabs

- **Severity:** high · **Reported:** 2026-04-30 · **Confirmed via logs + Fixed:** 2026-05-02
- **Affects:** v3 viewport rendering, all imported PSD characters

**Repro (confirmed):** every workspace switch full-cycles the WebGL context AND remounts every editor in every area. Logs from shelby on 2026-05-02 (workspace pill click `layout → modeling`):

```
workspaceSwitch — layout → modeling (modeWillChange=false)
viewportGL      — WebGL2 context destroyed (cleanup)
areaTab         — leftTop:  t1 → t6  (remount=true)
areaTab         — leftBottom: t2 → t7  (remount=true)
viewportGL      — WebGL2 context initialised
areaTab         — center:    t3 → t8  (remount=true)
areaTab         — rightTop:  t4 → t9  (remount=true)
areaTab         — rightBottom: t5 → t10 (remount=true)
```

Symmetric event sequence on the way back (`modeling → layout` switches `t6 → t1`, `t7 → t2`, etc.). Observations:

1. **Tab IDs are workspace-scoped, not editor-type-scoped.** Layout workspace owns `t1..t5`, Modeling workspace owns `t6..t10`, Rigging owns `t11..t15`. So even though both layouts have the same editor types in the same areas (outliner / logs / viewport / parameters / properties), React sees `key` change → remounts the editor → tears down its state.
2. **WebGL context is destroyed AND recreated on every switch** because the viewport's `<canvas>` element gets a new instance from the remount. All texture uploads from `partRenderer` are lost; the very next `scenePass.draw` runs against an empty texture cache → "character disappeared" until the next geometry-edit / paramValues-write triggers a re-upload (which never happens unless the user touches something).
3. `modeWillChange=false` confirms this is NOT the editorMode flip suspect — it's pure tab-key churn.

**Root cause:** `WorkspaceTabs.jsx` (recently moved to `editorRegistry.js`) builds a fresh `tabId` per workspace via something like a counter; same logical tab in different workspaces gets different IDs. Fix shape: make tab IDs derive from `(workspaceId, areaId, editorType)` so switching workspaces keeps the editor's React key stable when the editor type matches what was already mounted.

**Next steps:**

1. Find the tab-ID generator in `editorRegistry.js` / workspace defaults
2. Stable-key tabs by `(area, editorType)` so cross-workspace switches reuse mounted editors
3. Verify: after fix, the `areaTab` log should show `remount=false` for areas whose editor type didn't change; `viewportGL` should NOT log destroyed/initialised on every switch
4. Optional but cheap: even with the remount, `partRenderer` could re-upload textures on its first draw call when its texture cache is empty — defensive recovery if a future regression re-introduces remounting

**Notes:** Memory entry mirrors this — `memory/project_v3_tab_switch_disappears.md`.

---

### ✅ BUG-011 — `seedAllRig` threw `ReferenceError: get is not defined` after Init Rig

- **Severity:** critical (rig completely non-functional after Init Rig) · **Introduced:** 2026-05-01 (commit 99113ef, GAP-012/013 step 4) · **Fixed:** 2026-05-02

**Symptoms (user shelby test, 2026-05-02):**

- Character rendered at "rest pose" forever after Init Rig
- Live preview (breath / cursor head-tracking) had no visible effect
- All param sliders had no effect
- Bone controllers (elbow rotation via SkeletonOverlay) DID work — those bypass `evalRig` and write directly to `node.transform`
- A red `get is not defined` banner appeared at the top of the Parameters editor

**Root cause:** [src/store/projectStore.js:57](../src/store/projectStore.js#L57) — `useProjectStore` was created with `create((set) => {…})`, never destructuring `get`. GAP-012/013 step 4 (commit 99113ef) added `const postSeedProject = get().project;` at line 530 inside `seedAllRig` to enumerate orphan references / bone orphans / physics orphans AFTER the immer `produce` block committed. That `get()` reference threw `ReferenceError`, caught by `RigService.initializeRig`'s try/catch and surfaced as the Parameters-tab error banner.

The throw happened AFTER `set()` committed the seeded project (so the user saw `23 params` in the editor) but BEFORE:

1. `RigService.initializeRig` reached `useRigSpecStore.setState({rigSpec, …})` to cache the rigSpec for `evalRig`
2. `useParamValuesStore.getState().resetToDefaults(paramsAfterSeed)` to populate dial positions

No cached rigSpec → `CanvasViewport`'s tick loop's `_rigSpec = rigSpecRef.current` is null → `evalRig` skipped → renderer falls back to rest mesh_verts. `paramValuesStore.values` stays `{}` → `ParamRow`'s `useParamValuesStore((s) => s.values[param.id] ?? param.default)` shows the default but writes never push through to a missing rigSpec. Hence "params don't drive anything".

**Fix (2026-05-02):** [`projectStore.js:57`](../src/store/projectStore.js#L57) — changed `create((set) => {…})` to `create((set, get) => {…})`. One-character fix.

**Why this slipped past CI:** the GAP-012/013 unit tests for orphan references / bone orphans / physics orphans test the pure functions (`findOrphanReferences` etc.), not the seeder action that calls them. The test suite for `seedAllRig` itself doesn't currently exercise the orphan-detection branches. Adding a regression test would require mounting the full project store + harvest fixture, which is heavier than the existing roundtrip suites.

**Phase 2a context:** before isolating this bug I (incorrectly) attributed the regression to Phase 2a's Cubism rotation kernel port, which was reverted on the same day. Phase 2a's kernel is mathematically wrong on its own (at θ=0 it produces `(out.x = py + ox, out.y = px + oy)` — a structural x↔y swap at neutral angle, which can't be the actual Cubism kernel since the Editor displays models upright at default params). So the revert is correct on math grounds even though Phase 2a wasn't responsible for the user's observed regression. BUG-003 stays open pending a proper re-RE of `RotationDeformer_TransformTarget`.

**Lesson:** when a `set()` block runs but then throws after it, the user sees a partial state — half the seeders applied, the other half gone. This is the "store-action-with-side-effects-after-set" anti-pattern. Either keep all post-set work inside the produce, or wrap it in its own try/catch so the partial-state case is recoverable. Until then, every action that calls `get()` after `set()` needs careful review.

---

### ✅ BUG-012 — PSD wizard selection + meshEditMode flags persist into post-import workspaces

- **Severity:** medium (no data loss, but viewport stays in a confusing state) · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02

**Repro (user shelby, 2026-05-02):**

1. Drop PSD into the editor → wizard opens
2. Click on a layer/part during the wizard (e.g. "torso")
3. Finish the wizard with auto-mesh checkbox on
4. **Symptom:** torso stays selected forever; mesh wireframe + edge outline keep highlighting it across every workspace (including Layout where mesh visualizations don't belong)

**Root causes — two distinct bugs that compounded:**

1. **Wizard didn't clear transient editor state on finish.** [`handleWizardComplete`](../src/components/canvas/CanvasViewport.jsx) only cleared `wizardStep`, `wizardPsd`, `skeletonEditMode`, and the snapshot ref. `editorStore.selection`, `useSelectionStore.items`, `meshEditMode`, `blendShapeEditMode`, `activeBlendShapeId` all survived into the post-import editor — whatever the user had selected during the wizard kept its outline + dimming.

2. **Workspace had no concept of "mesh visualizations are workspace-scoped".** `scenePass.draw` ran the wireframe pass whenever ANYTHING was selected, regardless of workspace (`needWirePass = … || selectionSet.size > 0`). So the sticky selection from #1 triggered wireframe rendering even in Layout workspace where the user is doing object-level work.

**Fix (2026-05-02):**

- **Wizard cleanup** — `handleWizardComplete` + `handleWizardSkip` now clear `selection`, `meshEditMode`, `blendShapeEditMode`, `activeBlendShapeId`, `skeletonEditMode` in `editorStore` AND `useSelectionStore.items` via `clear()`. Both wizard exit paths covered.

- **Workspace viewport policy** — new pure module [`src/v3/shell/workspaceViewportPolicy.js`](../src/v3/shell/workspaceViewportPolicy.js) — `applyWorkspacePolicy(overlays, meshEditMode, workspaceId)` returns the EFFECTIVE values that scenePass + drag handlers should consume. Layout / Animation / Pose force `showWireframe = false`, `showVertices = false`, `meshEditMode = false`. Modeling / Rigging are permissive. Edge outline always passthrough (selection feedback works in every workspace). The user's stored toggles are NOT mutated — switching back to Modeling restores their prior wireframe / vertex setup automatically.

- **CanvasViewport** reads the policy at every draw call and at the brush / mesh-edit drag handlers; render and behaviour are gated identically through the same pure function.

**Tests:** [`scripts/test/test_workspaceViewportPolicy.mjs`](../scripts/test/test_workspaceViewportPolicy.mjs) — 54 cases covering every workspace × overlay combo, fallback for unknown workspace IDs, no-mutation invariant.

**Doc:** [`docs/V3_WORKSPACES.md`](V3_WORKSPACES.md) — workspace × concern matrix, policy semantics, Reset Pose semantics by mode, wizard cleanup contract, "adding a new workspace" checklist.

**Adjacent improvement (same commit):** Reset Pose ungated from animation mode. In staging mode (Layout / Modeling / Rigging) it now also resets every bone-tagged group's `node.transform.{rotation, x, y, scaleX, scaleY}` to identity (pivots preserved — those define WHERE the bone is, not the pose). User flow that motivated this: rotate bone controllers in Layout to inspect, want to revert. Per-part transforms (non-bone) stay untouched; for those the user has Properties → Reset Transform (GAP-014).

---

### ✅ BUG-013 — Wizard character vanishes forever when toggling Viewport ↔ Live Preview mid-import

- **Severity:** high (data loss — in-flight PSD import is unrecoverable until reload) · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02

**Repro (user, 2026-05-02):**

1. Drop a PSD into the editor — wizard opens, character preview visible.
2. While the wizard is on `review` / `reorder` / `adjust` / `dwpose`, click the **Live Preview** tab on the center area's header.
3. Click back to the **Viewport** tab.
4. **Symptom:** wizard is gone; canvas is empty; the imported character cannot be recovered without reloading the page.

**Root cause:** the original GAP-010 shape registered TWO distinct editor types (`viewport` → `ViewportEditor`, `livePreview` → `LivePreviewEditor`), each rendered through `editorRegistry.js` by `Area.jsx`. Switching the active tab in the center area swapped the rendered component, which **unmounted the entire `<CanvasViewport>` instance** and its subtree:

- `useState(wizardPsd)` (the parsed PSD bytes the wizard preview displays) — local state, lost on unmount.
- `useRef`s — `onnxSessionRef`, `preImportSnapshotRef`, `meshAllPartsRef`, the wizard handlers' callback closures — all reset.
- WebGL2 context destroyed on the canvas teardown (visible in logs as back-to-back `WebGL2 context destroyed (cleanup)` / `WebGL2 context initialised`); texture uploads, ScenePass, mesh buffers re-uploaded from scratch.

When the user clicked back to Viewport, a fresh `<CanvasViewport>` mounted with `wizardPsd = null`. `wizardStep` (in editorStore) was still `'review'`, but the wizard render gate `!previewMode && wizardStep && wizardPsd` evaluated false, so PsdImportWizard never re-rendered. The PSD bytes were nowhere — gone with the unmounted component.

**Fix (2026-05-02):** introduced a single shared canvas host [`<CanvasArea>`](../src/v3/shell/CanvasArea.jsx) that backs BOTH canvas tabs. [`Area.jsx`](../src/v3/shell/Area.jsx) detects the canvas tab types (`viewport`, `livePreview`) and short-circuits the editor registry, rendering CanvasArea directly under a shared ErrorBoundary key `${area.id}:canvas`. Toggling between the two tabs now only changes the `mode` prop on a stable CanvasArea, which flips `previewMode` on the same `<CanvasViewport>` instance. The canvas never unmounts during the toggle — WebGL2 context, texture uploads, wizardPsd, ONNX session, snapshot refs all survive.

The dead `ViewportEditor.jsx` and `LivePreviewEditor.jsx` components were deleted; their logic moved into CanvasArea (overlays gated on `mode === 'viewport'`, "live preview" badge gated on `mode === 'livePreview'`, captureStore wiring lives unconditionally). Registry entries for both canvas types now carry `component: null` — the label is still consumed by AreaTabBar, only the component slot is unused.

**Files touched:**
- New [src/v3/shell/CanvasArea.jsx](../src/v3/shell/CanvasArea.jsx) — single host for both canvas tabs
- [src/v3/shell/Area.jsx](../src/v3/shell/Area.jsx) — canvas-tab short-circuit + shared ErrorBoundary key
- [src/v3/shell/editorRegistry.js](../src/v3/shell/editorRegistry.js) — `viewport`/`livePreview` entries with `component: null`
- Deleted: `src/v3/editors/viewport/ViewportEditor.jsx`, `src/v3/editors/livePreview/LivePreviewEditor.jsx`

**Tests:** [`test:livePreviewWiring`](../scripts/test/test_livePreviewWiring.mjs) (36 cases) covers the workspace contract + tab-swap path. The "no canvas remount" property is implicit in the architecture (Area.jsx routes both canvas types through the same CanvasArea); a future test could mount a real React tree and assert WebGL context lifetime, but the routing logic is small enough that the contract is reviewable directly.

**Lesson:** when two tabs render conceptually-the-same surface in different modes, share the host component and toggle a prop. Distinct components per mode means React unmounts on every toggle, and any non-store state goes with it. Generalises beyond canvas — any "two views of one resource" UI hits this trap.

---

### ✅ BUG-014 — Legwear stretched 2.5× canvas below canvas after Init Rig; Body Angle X/Y/Z unresponsive

- **Severity:** high (Init Rig produces visibly broken model; affects every character with body geometry slightly past canvas) · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02 (kernel port byte-faithful from IDA)

**Repro (user, 2026-05-02 — man-character + shelby PSDs):**

1. Drop PSD → run wizard → Init Rig.
2. **Symptom A (legwear stretch):** legwear/pants render extending ~1.5× canvas height BELOW canvas, while everything inside canvas looks correct. UV-clamped triangles stretch the bottom row of texture along the off-canvas mesh extent.
3. **Symptom B (Body Angle dead):** moving ParamBodyAngleX/Y/Z slider in Live Preview — torso/head do not visibly tilt. The synthesis log shows reasonable shift magnitudes (e.g. `paramBodyAngleZ_at_plus10.peakShiftPx: 29.46`), but visible body movement is far smaller than expected.

**Lift summary log (the smoking gun):**

```jsonc
"RigWarp_legwear": { "x": [548, 1241], "y": [1170, 4163] }   // canvas H = 1792
"BodyXWarp":       { "x": [555, 1235], "y": [229.8, 1561.2] } // body-X in canvas: visible body
```

`RigWarp_legwear` extends to canvas-y=4163 — 2371 px below canvas — while its parent `BodyXWarp` covers the visible body (canvas-y=229..1561). Linear projection through the chain canvas→BodyZ→BodyY→Breath→BX gives bottom-y ≈ 3306, not 4163: a +860 px (26 %) amplification poisoning the lift.

**Root cause (verified via IDA decompile of `WarpDeformer_TransformTarget @ 0x7fff2b24cc40`):** the **bottom band** of the OUTSIDE-region branch in [src/io/live2d/runtime/evaluator/cubismWarpEval.js](../src/io/live2d/runtime/evaluator/cubismWarpEval.js) had the virtual cell layout inverted relative to Cubism Core. Cubism's IDA layout for v_in ∈ [1, 3]:

| Virtual cell position | Cubism Core (IDA) | v3 port (pre-fix) |
|-----------------------|-------------------|-------------------|
| TL (du=0, dv=0)       | REAL grid bottom row (boundary at v=1) | EXTRAP at v=3 (far below) |
| TR (du=1, dv=0)       | REAL grid bottom row | EXTRAP at v=3 |
| BL (du=0, dv=1)       | EXTRAP at v=3 | REAL grid bottom row |
| BR (du=1, dv=1)       | EXTRAP at v=3 | REAL grid bottom row |

With `dv = (v - 1) / 2`, v_in=1 (boundary) → dv=0 → reads TL/TR. Cubism reads REAL grid (boundary continuity). v3 read EXTRAP-at-far-v=3 — broke continuity and amplified extrapolation through the body warp chain (Phase 3 lifted-grid composition multiplied the error per nested warp).

Why other bands were correct: the **top band** explicitly applies a top↔bottom swap (lines 297-305) so the same structural layout matches Cubism. Bottom band omitted the swap. Left/right bands and corner zones use a min/max-based virtual cell construction that derives the layout from coordinate signs and stayed correct.

**Why Body Angle felt dead:** Phase 3 lifts every warp's grid through the chain. The bottom-band kernel ran on every cascade boundary where a child warp's grid corners landed past v=1 of its parent. For the body chain (BodyXWarp → BreathWarp → BodyWarpY → BodyWarpZ), grid corners corresponding to legs/feet routinely cross v=1 in their parent's local space, so the cascade composition was distorted at the bottom of the model. The torso section ALSO inherits some distortion from this (cascades pull on the shared composition), so visible BodyAngle motion shrinks far below the synthesis-intent peak shift.

**Fix:** byte-faithful port of the IDA bottom-band layout (commit shipped 2026-05-02). REAL grid now lands on virtual TL/TR (boundary continuity at v=1), EXTRAP at virtual BL/BR (far at v=3). No JS-side clamping / clipping / mesh-bbox intervention — kernel matches Cubism Core directly.

**Files touched:**
- [src/io/live2d/runtime/evaluator/cubismWarpEval.js](../src/io/live2d/runtime/evaluator/cubismWarpEval.js) — bottom-band branch swap (~12 LOC)

**Tests:** existing `breathFidelity` (66 cases) + `eyeClosureApply` (35 cases) + `chainDiagnose` (38 cases) all green. The bug specifically affected the bottom-band region which the existing tests don't directly exercise — adding a synthetic OOB-vertex test against the oracle harness is a follow-up so future kernel changes catch band-layout regressions.

**Lesson:** when porting a foreign kernel byte-faithfully, **every band / branch must be IDA-verified independently** — a structurally correct top-band port doesn't imply the bottom band, and the asymmetry between the two (top requires swap, bottom does not) is exactly the kind of detail that gets dropped when reading pseudocode top-down. The oracle harness verifies INSIDE-region paths well; OUTSIDE-region needs targeted vertex placements past each band's boundary to surface this class of bug.

---

### ✅ BUG-003 — Body Angle X/Y/Z + face Angle X/Y/Z don't match Cubism

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-05-03 · **Root cause:** v3's heuristic init rig regenerated rig data from face/topwear bbox, ignoring authored cmo3 deformer values. Phase 2b's chainEval-level investigation (Stage 1 measurement + pivot-patch disproof, 2026-05-03) showed slope ≡ J⁻¹ at every rotation pivot and that single-deformer pivot patches can't move PARAM (constant translation cancelled by rest-delta subtraction). The real surface was the heuristic-vs-authored gap in v3's body chain + FaceParallax + FaceRotation.
- **Fix:** new authored-rig path in `initializeRigFromProject` ([`buildRigSpecFromCmo3.js`](../src/io/live2d/rig/buildRigSpecFromCmo3.js)) — when project has `_cmo3Scene` (set by cmo3Import), build the RigSpec end-to-end from authored cmo3 deformer data instead of regenerating heuristically. AngleZ_pos30 PARAM dropped from 9.45 → **0.01 px**; overall TOTAL max from 24.21 → **5.44 px**; PARAM max from 9.45 → **5.42 px** (residual is body-chain composition through deep face chain; see "Known residual" below).
- See [`docs/INIT_RIG_AUTHORED_REWRITE.md`](INIT_RIG_AUTHORED_REWRITE.md) for the plan that landed this fix.

#### Phase 2b residual closed (2026-05-03 — same day)

The "known residual" above was eliminated by the Phase 2b Setup port shipped in [`chainEval.js`](../src/io/live2d/runtime/evaluator/chainEval.js) — a byte-faithful port of Cubism Core's `RotationDeformer_Setup` (IDA `0x7fff2b24dee0`).

**What changed:** rotation deformers now run a Setup pass per evalRig call:

1. **FD probe** — `evalChainAtPoint(parent, pivot)` and `evalChainAtPoint(parent, pivot + (0, ε))` capture the parent's local rotation at the rotation's pivot.
2. **Bake canvas-final state**:
   - `canvasFinalPivot` = parent.eval(authoredPivot) — replaces authored pivot with parent-deformation-aware position
   - `effectiveAngleDeg` = keyform.angle − probedAngleDeg — compensates parent's local rotation
3. **Eval** uses the baked state: `out = R(effective) · diag(s·rX, s·rY) · v + canvasFinalPivot`. Output is canvas-final; chain walker BREAKS after applying. Mirrors Cubism's "everything is canvas-final after Setup" property.

**Result on shelby oracle harness:**

| Fixture group | Pre-Setup PARAM | Post-Setup PARAM | Reduction |
|---|---|---|---|
| Breath_full | 5.42 px | **0.14 px** | -97% |
| Breath_half | 2.71 px | **0.07 px** | -97% |
| BodyAngleX (±5/±10) | 2.51–5.18 px | **0.66–1.32 px** | -73% to -74% |
| BodyAngleY (±10) | 2.22–3.50 px | **0.18–0.19 px** | -91% to -95% |
| BodyAngleZ (±10) | 3.01–3.52 px | **0.21 px** | -93% to -94% |
| AngleX/Y/Z, EyeBallX/Y, default | 0.00–0.01 px | 0.00–0.01 px | (no regression) |

PHASE_2B_PLAN.md verification gate was "AngleZ PARAM < 1 px and no fixture regresses by > 0.5 px" — passed across the board. Fix file: [`chainEval.js`](../src/io/live2d/runtime/evaluator/chainEval.js) `getRotationSetup` + `buildRotationMat3CanvasFinal`. See [`CUBISM_WARP_PORT.md` Phase 2b](live2d-export/CUBISM_WARP_PORT.md) for the kernel-level explanation and [`PHASE_2B_PLAN.md`](live2d-export/PHASE_2B_PLAN.md) for the staged plan.

**Original investigation (kept for reference):**

- **Severity:** high · **Reported:** 2026-04-30 · **Root cause confirmed via raw asm:** 2026-05-02
- **Affects:** Body angle + head angle parameter rigging in in-app native rig eval

**Root cause confirmed (raw asm read 2026-05-02):**

The rotation kernel itself is **already correct** in v3. Reading the full raw asm of `RotationDeformer_TransformTarget` at IDA `0x7fff2b24c950` (`xmm5/xmm6/xmm7/xmm8` register tracking) reveals:

```
out.x = px·(cos·s·rX) + py·(-sin·s·rY) + originX
out.y = px·(sin·s·rX) + py·( cos·s·rY) + originY
```

That's textbook 2D rotation with `diag(rX, rY)` post-scale — exactly what `buildRotationMat3Aniso` already produces. **The earlier Phase 2a "kernel divergence" was a register-tracking misread of the asm**, not a real divergence.

The actual divergence is in **Setup**, which v3 doesn't have. `RotationDeformer_Setup` at IDA `0x7fff2b24dee0` does an FD Jacobian probe of the parent eval EVERY FRAME (parameter-dependent), then bakes:
- `originX/Y` ← canvas-final pivot (computed via `parent.TransformTarget(pivot)`)
- `angle` ← `angle - probed_parent_local_rotation`
- `scale` ← `keyform.scale × parent.compounded_scale`

So at eval time, the rotation's frame is fully canvas-final-compensated. v3's chainEval doesn't do this — it uses `_warpSlopeX/Y = canvasToInnermostX/Y` (closed-form bbox slope, REST-state) as a stand-in for the scale piece, and ignores the parent's local rotation entirely.

For body-angle params: when `ParamBodyAngleZ ≠ 0`, BodyXWarp's grid is rotated. Cubism's Setup picks up that local rotation when probing the head-rotation deformer's pivot. v3's chainEval doesn't — it assumes the warp's frame is rest-state. **That's the divergence.**

**Fix path:** Phase 2b in [`docs/live2d-export/CUBISM_WARP_PORT.md`](live2d-export/CUBISM_WARP_PORT.md#-phase-2--rotation-deformer-eval-raw-asm-verified-2026-05-02). Implement the FD Jacobian probe in `chainEval.js`'s `DeformerStateCache.getState` for warp-parented rotation deformers. Verify via oracle diff harness (cmo3 → rigSpec → evalRig vs Cubism oracle) BEFORE shipping (per `feedback_oracle_before_unit_tests.md`).

**Quantified baseline (oracle harness 2026-05-02):**

| Snapshot date | TOTAL max | PARAM max | PARAM mean | Notes |
|---------------|-----------|-----------|------------|-------|
| Pre Phase 3   | 73.23 px  | 17.73 px  | 6.66 px    | Baseline. Worst fixture: AngleZ_pos30/neg30 (17.73 px). Breath_full second worst at 16.76 px. |
| Post Phase 3  | 72.21 px  | 17.73 px  | **2.45 px** | Phase 3 lifted-grid Setup shipped 2026-05-02. Most fixtures roughly halved. Breath_full dropped 16.76 → **5.45 px**. AngleZ unchanged at 17.73 (Phase 2b territory — rotation FD Jacobian Setup). |

**Breath warp data point (verified 2026-05-02):**

1. ✅ Our heuristic BreathWarp grid bytes match Cubism Editor's authored `shelby.moc3` BreathWarp grid **byte-for-byte** at both kf[0] (rest) and kf[1] (full breath). Verified via `scripts/dev-tools/moc3_inspect_warp.py` against `New Folder_cubism/shelby.moc3`. Pinned by [`test:breathFidelity`](../scripts/test/test_breathFidelity.mjs) (66 cases — 6×6 grid corners, dy peak at row 2 = -0.015, dx kicks ±0.004/±0.0013, edge pinning).
2. ✅ Deformer chain topology matches: `BodyWarpZ → BodyWarpY → BreathWarp → BodyXWarp → rotations → meshes` (identical to Cubism's authored shelby).
3. ✅ **Phase 3 lifted-grid Setup (shipped 2026-05-02)** — Breath PARAM divergence dropped 16.76 → 5.45 px (67% reduction) by mirroring Cubism Core's `WarpDeformer_Setup` (IDA `0x7fff2b24e410`). Each warp's grid is now lifted top-down through ancestors to canvas-px once per frame; artmesh evaluation does ONE bilinear against the lifted grid instead of nested bilinears through the chain. Fixes the user-reported "head pieces deforming weirdly under breath" symptom — head meshes go through `Rotation_head → BodyXWarp → BreathWarp → BodyWarpY → BodyWarpZ`, where intermediate warps' artist-baked non-uniformity meant nested-bilinear composition (a quartic) diverged from Cubism's lifted single-bilinear.

**Cycle-period correctness fix (2026-05-02, separate from chain comp):** the live-preview ParamBreath synthesizer in CanvasViewport used cycle=3.345 s. Cubism Web Framework's `CubismBreath` standard wiring uses **3.2345 s** for ParamBreath. The 0.11 s discrepancy made our breath drift relative to a Cubism Viewer playing the same model side-by-side. Fixed.

**Phase 2b implementation blocker found (2026-05-02):** initial attempt revealed v3's rotation matrix structure (`R · diag(extraSx, extraSy)`) is **diagonal-only**. When a warp is parameter-rotated, the warp's local Jacobian at the rotation pivot has off-diagonal terms — a rotation that the FD probe captures as `(dx, dy)`. v3's diagonal matrix can only carry the magnitude `|delta|`, not the directional information. Both attempted alternatives (canvas-final + chain-stop OR FD-magnitude-as-slope) made divergence worse than baseline. Real fix requires switching `rotationEval.js`'s matrix to a general 2×2 + translation, which is a downstream-consumer refactor out of scope for a single sweep. Detail in [`CUBISM_WARP_PORT.md`](live2d-export/CUBISM_WARP_PORT.md#-phase-2--rotation-deformer-eval-raw-asm-verified-2026-05-02).

**Phase 3 shipped 2026-05-02:** lifted-grid Setup mirroring Cubism Core's `WarpDeformer_Setup`. Each warp's grid is composed top-down through ancestors to canvas-px once per frame; artmesh evaluation does a single bilinear against the lifted grid instead of nested bilinears through the chain. Mathematically equivalent to Cubism's pipeline (nested bilinears compose to a quartic when intermediate warps are non-identity, while lifted bilinear stays a proper bilinear). Reduced PARAM mean divergence from 6.66 → 2.45 px (63%). Most body-chain fixtures roughly halved. Files: [`chainEval.js`](../src/io/live2d/runtime/evaluator/chainEval.js) — new `getLiftedGrid` method on `DeformerStateCache`, plus rewired warp branch in `evalArtMeshFrame` to break after applying the lifted grid.

**Status:** ⏳ Phase 3 complete. AngleZ_pos30/neg30 fixtures still at 17.73 px PARAM max — that's the Phase 2b rotation FD Jacobian Setup signal (chain composition through *parameter-rotated* warps). Blocked on rotation-matrix-structure refactor as before. Diagnostic harness pinned; infrastructure (`DeformerStateCache.evalChainAtPoint` + `getLiftedGrid`) preserved for the next attempt.

---

### ✅ BUG-004 — Initialize Rig leaves visual mesh and armature out of sync

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-05-02
- **Affects:** Pose workflow → re-rig handoff

**Root cause (one-line):** [`RigService.initializeRig`](../src/services/RigService.js) didn't reset transient pose state before harvesting. After the harvest, evalRig produced rest-pose verts (because `buildMeshesForRig` reads `mesh.vertices.restX/restY` — pose-independent), but `node.transform` still carried the user's bone-controller rotations from before Init Rig. Skeleton overlay reads `node.transform.rotation` directly, so armature stayed posed while the rendered mesh snapped to rest.

**Fix (2026-05-02):** Init Rig is structurally a "rebuild from rest" operation. `RigService.initializeRig` now calls [`resetToRestPose()`](../src/services/PoseService.js) before harvesting:

- `animationStore.draftPose` cleared
- `paramValuesStore.values` reset to canonical defaults (eyes-open etc.)
- Every group with a `boneRole` has `transform.{rotation, x, y, scaleX, scaleY}` zeroed (`pivotX/pivotY` preserved — those define WHERE the bone is, not the pose)
- Per-part transforms (non-bone) are intentionally NOT reset — those are user layout (e.g. a hat positioned via Outliner), not pose

Sister bugs **BUG-008** + **BUG-010** share this root cause and same fix.

**Files touched:** [`src/services/PoseService.js`](../src/services/PoseService.js) (new shared module), [`src/services/RigService.js`](../src/services/RigService.js) (call resetToRestPose before harvest), [`src/v3/shell/Topbar.jsx`](../src/v3/shell/Topbar.jsx) (Reset Pose button now calls the same shared module).

**Tests:** [`test:poseService`](../scripts/test/test_poseService.mjs) — 26 cases covering bone-group reset semantics, pivot preservation, paramValues reset, draftPose clear, no-op + edge cases.

---

### BUG-005 — Per-piece Opacity slider does nothing

- **Severity:** high
- **Reported:** 2026-04-30
- **Affects:** Properties tab on selected pieces

**Repro:**

1. Select a piece (any mesh node) in the Outliner
2. Open Properties → find the Opacity slider/input
3. Drag the slider or change the value
4. Observe: visual rendering is unaffected — the piece stays at its current opacity regardless of the input value

**Suspects (not verified):**

1. The Properties Opacity input writes to a project field (`node.opacity`?) that the renderer no longer reads. v3 may have switched the renderer to use a different opacity source (e.g. `paramValues['ParamOpacity']`, or a per-node animation track override) and the static Properties path is dead.
2. The store mutation runs but doesn't bump a version counter the renderer's selector is watching, so the canvas never re-tickets a redraw.
3. The Properties tab writes to a draft state that's never committed.

**Next steps:**

1. ✅ **Audit shipped 2026-05-02:**
   - [`ObjectTab.jsx`](../src/v3/editors/properties/tabs/ObjectTab.jsx) Opacity input writes `node.opacity` via `patch((n) => { n.opacity = v; })` — the standard updateProject flow.
   - Renderer reads node.opacity in 4 places: [`scenePass.js:149`](../src/renderer/scenePass.js#L149) (`opacity: ov.opacity !== undefined ? ov.opacity : node.opacity`), [`transforms.js:143-146`](../src/renderer/transforms.js#L143) (`computeEffectiveProps` parent-chain multiplication into `opMap`), [`CanvasViewport.jsx:1472`](../src/components/canvas/CanvasViewport.jsx#L1472) (`opacity: drOv?.opacity ?? kfOv?.opacity ?? node.opacity`), and similarly in `GizmoOverlay.jsx` / `SkeletonOverlay.jsx`.
   - The chain looks intact: `ObjectTab.write → store mutation → effective opMap → render call`.
2. ✅ **Instrumentation shipped 2026-05-02:** [`ObjectTab.jsx`](../src/v3/editors/properties/tabs/ObjectTab.jsx) logs `logger.debug('opacityCommit', …, {nodeId, nodeType, previousOpacity, nextOpacity})` on every commit. If the Logs panel shows the commit firing but visual stays unchanged → render-side issue. If the commit doesn't fire → UI binding broken.
3. Possible remaining suspects (verify post-instrumentation repro):
   - Animation-mode draftPose / keyframe override winning over `node.opacity`. Check if user's repro is happening in Pose / Animation workspace.
   - `versionControl` not bumped on opacity write. CanvasViewport.jsx:165 dirty-keys on `[project, isDark]` reference; immer should produce a new project ref. If not, opacity writes don't trigger redraw.
   - Selector memoization: zustand subscribe() may shallow-compare and miss the change.

---

### ✅ BUG-008 — Bone-move + Initialize Rig leaves the moved layer visually frozen (sister to BUG-004)

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-05-02
- **Affects:** Pose → re-rig handoff

**Root cause (one-line):** Same as [BUG-004](#-bug-004--initialize-rig-leaves-visual-mesh-and-armature-out-of-sync). With a bone rotated when Init Rig fired, the rig was harvested while `node.transform.rotation` carried the rotation. The harvested chain's keyforms were derived from rest geometry (good), but the renderer composes `evalRig output × world matrix(node.transform)`. Since `node.transform.rotation ≠ 0`, the rig-driven verts emerged from evalRig at rest but rendered through a rotation matrix → "stuck at the bone's pre-Init-Rig pose, no parameter can move it".

**Fix:** Same as BUG-004 — `RigService.initializeRig` calls [`resetToRestPose()`](../src/services/PoseService.js) before harvesting. The bone-group transform is zeroed before the rig builder ever sees it; the layer is wired to a clean chain that responds normally to params.

---

### ✅ BUG-010 — Iris Offset controller becomes useless after Init Rig (sister to BUG-004 / BUG-008)

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-05-02
- **Affects:** Properties / Parameters → Iris Offset 2D pad

**Root cause (one-line):** Same as [BUG-004](#-bug-004--initialize-rig-leaves-visual-mesh-and-armature-out-of-sync) / [BUG-008](#-bug-008--bone-move--initialize-rig-leaves-the-moved-layer-visually-frozen-sister-to-bug-004). Iris Offset writes to `ParamEyeBallX/Y`. When Init Rig was clicked while those params already had non-default values (the user had been dragging the pad before Init Rig), the iris RotationDeformer's keyforms were derived against the iris's CURRENT (offset) positions. After Init Rig, the controller wrote ParamEyeBallX → 0 (default after reseed) but the rig's rest position WAS the offset → no visible motion.

**Fix:** Same as BUG-004 — `RigService.initializeRig` calls [`resetToRestPose()`](../src/services/PoseService.js) before harvesting. paramValues snap to defaults FIRST, then the rig builder sees iris meshes at their genuine rest positions, and the harvested keyforms drive movement correctly across the param's range.

---

## Investigating

*(none yet)*

---

## Fixed

### ✅ BUG-021 — Proportional-edit enabled-state not surfaced in the canvas toolbar

- **Severity:** low · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02

**Symptom:** the bare-`O` keymap toggles `preferencesStore.proportionalEdit.enabled`, but no UI surface reflected the state. The user only knew it was on when the influence-radius ring drew during a drag — and only inside Mesh Edit.

**Fix.** New third button kind `'toggle'` in [`canvasToolbar/tools.js`](../src/v3/shell/canvasToolbar/tools.js), orthogonal to the existing `'tool'` (sticky, mutually-exclusive within mode) and `'operator'` (momentary) kinds. Toggle entries declare a `toggleId` that the toolbar resolves through a small `TOGGLES` registry in [`CanvasToolbar.jsx`](../src/v3/shell/CanvasToolbar.jsx); each registry entry is `{ isActive(ctx), toggle() }`.

The mesh tool list now ends with a "Proportional Edit" toggle entry (`Circle` icon, `O` hotkey hint, full Shift+O / Alt+O / Ctrl+[/] secondary keys in the tooltip). The toolbar subscribes to `preferencesStore.proportionalEdit?.enabled` so the button highlights immediately when the bare-`O` keymap flips the flag — no separate notification path needed.

**Files touched:**
- [src/v3/shell/canvasToolbar/tools.js](../src/v3/shell/canvasToolbar/tools.js) — added `kind: 'toggle'` + `toggleId` field; mesh list gains a proportional-edit entry.
- [src/v3/shell/CanvasToolbar.jsx](../src/v3/shell/CanvasToolbar.jsx) — `TOGGLES` registry + `usePreferencesStore` subscription + active-state branch in the render loop.
- [scripts/test/test_canvasToolbar.mjs](../scripts/test/test_canvasToolbar.mjs) — extended shape assertions for the new kind; mesh-list test ensures `proportionalEdit` toggle is present (83/83).

**Lesson.** The third button kind lands cheaply once you accept that not every toolbar slot belongs in the `editorStore.toolMode` mutually-exclusive bucket. Blender mixes sticky tools and orthogonal toggles in the same strip; SS now does too.

---

### ✅ BUG-020 — Canvas viewport distorts when adjusting area panel sizes (aspect ratio not refreshed)

- **Severity:** medium · **Reported:** 2026-05-02 · **Fixed:** 2026-05-02

**Symptom:** dragging any panel divider in `react-resizable-panels` made the character stretch / squash for the duration of the drag. Released → settled to correct on the next interaction, but the live preview during the drag was wrong.

**Root cause:** [`scenePass.draw`](../src/renderer/scenePass.js) DID re-sync `canvas.width/.height` to `clientWidth/.clientHeight` per frame — but only when called. The CanvasViewport rAF tick gates that call on `isDirtyRef.current`. Nothing in the React tree flipped `isDirtyRef = true` when `react-resizable-panels` resized the wrapper `<div>`, so:

1. CSS box of the canvas element changed → `clientWidth` changed.
2. `isDirtyRef` was still `false` (no store write, no animation tick reason).
3. `draw()` didn't fire → `canvas.width` (the WebGL drawingbuffer extent) stayed at the previous size.
4. Browser stretched the old-resolution bitmap to fill the new CSS box → live distortion until the next mouse-move triggered a redraw.

**Fix shape (two parts, both shipped):**

1. [`CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) mounts a `ResizeObserver` on the canvas element. On every entry → flips `isDirtyRef.current = true`. The next rAF tick sees the dirty bit, calls `scenePass.draw`, and the existing resize block re-syncs the drawingbuffer.

2. [`scenePass.draw`](../src/renderer/scenePass.js) drawingbuffer sync now multiplies by `devicePixelRatio` so the canvas renders at physical resolution on HiDPI displays (was rendering at logical-px and being upscaled by the browser → blurry on 2× monitors). The camera matrix and background grid still consume CSS-px dimensions (`logicalW/H`) since `editor.view.{zoom, panX, panY}` are stored in CSS px and need to compose with a CSS-px camera. The GL viewport uses physical px (`canvas.width/.height`).

`gl.viewport(0, 0, canvas.width, canvas.height)` now hits every device pixel; `buildCameraMatrix(logicalW, logicalH, ...)` keeps the projection consistent with the CSS-px input axes. Export path (`captureExportFrame`) is unaffected — it runs with `skipResize: true` and pan/zoom in export-px units, which `logicalW = canvas.width` already covers.

**Files touched:**
- [src/components/canvas/CanvasViewport.jsx](../src/components/canvas/CanvasViewport.jsx) — `ResizeObserver` effect (~14 LOC).
- [src/renderer/scenePass.js](../src/renderer/scenePass.js) — DPR-aware drawingbuffer sync + `logicalW/H` separation between viewport (physical) and camera/bg (CSS).

**Lesson.** A self-resizing renderer needs to be told the source-of-truth size has changed; otherwise the rAF gate masks the staleness as long as nothing else triggers a redraw. `ResizeObserver` on the actual canvas element (not the wrapper) is the cleanest signal — survives panel-resize drags, window resizes, and DPR-changing monitor switches in one binding.

---

### ✅ BUG-006 — Breath warp squashes the whole head (and body angle / face angle leaked too)

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-04-30 (after `4e8ad18`) · **Superseded:** 2026-05-01 (Cubism warp port, Phase 1)
- **Affects:** in-app native rig evaluator — *every* warp deformer (BreathWarp, BodyXWarp, BodyWarpY, BodyWarpZ, FaceParallax, etc.)

**Root cause (one-line):** the runtime warp evaluator extrapolated the *deformed* keyform grid linearly outside `[0, 1]` instead of falling back to the rest grid. With a deformation gradient at the grid boundary (e.g. breath's chest compression at row 1, body-angle bow at the edge cells), the extrapolation propagated that deformation monotonically into every vertex past the bbox. Result: head squashes with breath, face leans with body angle, etc.

**Initial fix (2026-04-30):** at the warp step in `chainEval`, branch on `(u, v) ∈ [0, 1]² ?` — inside use the deformed `state.grid`, outside fall back to `state.baseGrid` (uniform rest projection). This stops the unwanted extrapolation but is still **not** what Cubism Core actually does.

**Phase 1 supersession (2026-05-01):** Phase 0 IDA reverse-engineering of `WarpDeformer_TransformTarget` revealed the real Cubism behaviour — it doesn't cut off, it **continues to displace OOB vertices using edge-gradient linear extrapolation**, with smooth handoff via a 9-region dispatch (1 far field + 4 boundary bands + 4 corner zones). The cutoff fix was too conservative and left a class of "vertex stops moving when it leaves the bbox" residual visible in shelby's body chain. Replaced by [cubismWarpEval.js](../src/io/live2d/runtime/evaluator/cubismWarpEval.js), which is a byte-faithful port of the Cubism kernel; `chainEval.js` warp branch now calls `evalWarpKernelCubism` instead of `bilinearFFD(inside ? grid : baseGrid)`. See [CUBISM_WARP_PORT.md](./live2d-export/CUBISM_WARP_PORT.md) for the full RE pseudocode + verification setup.

**Files touched (Phase 1):** [cubismWarpEval.js](../src/io/live2d/runtime/evaluator/cubismWarpEval.js) (new), [chainEval.js](../src/io/live2d/runtime/evaluator/chainEval.js) (warp branch swap, `isQuadTransform` plumbed via `DeformerStateCache.getState`).

**Tests:** chainEval 25/25, warpEval (old) 45/45, **cubismWarpEval (new) 29/29**, e2e_equivalence 27/27, full rig-eval suite 754/754 — no regressions.

**Visual confirmation:** confirmed 2026-05-02 — breath grid synthesis now matches Cubism Editor's authored shelby byte-for-byte (regression-tested via [`test:breathFidelity`](../scripts/test/test_breathFidelity.mjs)). Remaining body-angle / face-angle visual divergence is the chain-composition residual (BUG-003 territory, blocked on Phase 2b rotation-matrix-structure refactor).

---

### BUG-007 — Variant `*.suffix` layers visible by default after PSD import

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-04-30 (after `4e8ad18`)
- **Affects:** PSD import → initial scene visibility

**Root cause (one-line):** `normalizeVariants` in [variantNormalizer.js](../src/io/variantNormalizer.js) paired variants with bases and reparented them, but never wrote `node.visible = false`. The PSD's per-layer visibility flag carried through verbatim, so artists who painted `face.smile` visible while sketching the base saw both layers stacked after import.

**Fix:** in step 2 (reparenting loop) also force `variant.visible = false`. Variants are owned by the auto-rig from this point — the `Param<Suffix>` fade rule (0→1) drives them in via opacity, so they belong hidden at rest pose regardless of the PSD's visible flag.

**Files touched:** [variantNormalizer.js:109-122](../src/io/variantNormalizer.js#L109).

---

### BUG-009 — Eyes display closed after Init Rig until the param is toggled

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-04-30 (after `4e8ad18`)
- **Affects:** in-app native rig eval immediately after Initialize Rig

**Root cause (one-line):** `RigService.initializeRig` did `paramsAfterSeed = harvest.rigSpec?.parameters ?? project.parameters`. `rigCollector.parameters` is `[]` by design (params live in `project.parameters`, not the rigSpec collector), and `??` does not fall through on truthy empty arrays — so `resetToDefaults([])` wiped paramValues. The slider showed `1` via ParamRow's `param.default` fallback, but the store had nothing → renderer read `undefined` → treated as `0` → eyes closed. Touching the slider or clicking Reset wrote the value back into the store.

**Fix:** check array length explicitly — same pattern already used in [rigSpecStore.js:66](../src/store/rigSpecStore.js#L66). When `rigSpec.parameters` is empty fall back to `project.parameters`.

**Files touched:** [RigService.js:147-159](../src/services/RigService.js#L147).

---

### ✅ BUG-002 — Eye-closure parabola fit looks wrong (PNG-alpha path unreachable in rigOnly mode)

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-04-30 (after `4e8ad18`)
- **Affects:** Eyelid closure curve in in-app native rig eval (and rigOnly export)

**Root cause (one-line):** v3's `buildMeshesForRig` set `pngData: new Uint8Array(0)` for every mesh in rigOnly mode, so `extractBottomContourFromLayerPng` always returned null and `fitParabolaFromLowerEdge` fell back to mesh bin-max with only ~6 samples — yielding garbage curvature. Upstream pre-v3 always had real PNG bytes; we'd diverged.

**Fix:** ported upstream behaviour — render canvas-sized PNGs in `buildMeshesForRig` for eye-source meshes only (`EYE_SOURCE_TAGS`, narrow port for perf). Wired `RigService.initializeRig` and `useRigSpecStore.buildRigSpec` to call `loadProjectTextures(project)` so `images` Map is non-empty when `initializeRigFromProject` runs. Cosmetic: `eyeClosureFit.hasPngData` now also checks `length > 0`.

**Files touched:** [exporter.js](../src/io/live2d/exporter.js#L686), [RigService.js](../src/services/RigService.js#L115), [rigSpecStore.js](../src/store/rigSpecStore.js#L38), [eyeClosureFit.js](../src/io/live2d/cmo3/eyeClosureFit.js#L90).

**Visual confirmation:** user reported "да норм глаза" — parabola shape correct. *Note: a separate bug where eyes display closed after Init Rig until the param is toggled survives as BUG-009.*
