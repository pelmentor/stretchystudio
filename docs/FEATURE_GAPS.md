# Feature Gaps

Living document. Tracks where v3 lags upstream's [README.md](../reference/stretchystudio-upstream-original/README.md) feature claims, and items worth adding that upstream has. Sister document to [BUGS.md](BUGS.md).

## Conventions

- **ID** — `GAP-NNN`, monotonically increasing. Never reuse, never renumber.
- **Severity** — `critical` / `high` / `medium` / `low`. Severity reflects user-visible impact, not implementation effort.
- **Status flow** — `open` → `investigating` → `closed` (move between sections; don't delete on close).
- **Verify before adding.** Like BUGS.md, this tracker is for *real* gaps confirmed by reading the code, not marketing diff against upstream's README. Speculation belongs nowhere.
- **Header marker** — `✅` prefix on the heading means the entry is closed (or its core Phase A is shipped, with any Phase B explicitly tracked inside the body). Heading without prefix = still open.

## Status snapshot (2026-05-03)

| Status | Entries |
|--------|---------|
| ✅ Closed / Phase A shipped | GAP-001, GAP-002, GAP-003, GAP-004, GAP-005, GAP-006, GAP-007, GAP-008 (A+B), GAP-009, GAP-010 (A+B), GAP-011, GAP-012, GAP-013, GAP-014, GAP-015 (A+B), GAP-016 (A+B), GAP-017 (Phase A only — user-decided 2026-05-03; Phase B/C not pursued) |
| ⏳ Open | (none) |

Phase B follow-ups for closed entries (UI delete-confirm dialogs, parameter-editor surfaces, etc.) used to be gated on the broader `project_v3_rerig_flow_gap` — that pillar SHIPPED 2026-05-03 (Phases 0+1+3+4 of [V3_RERIG_FLOW_PLAN.md](V3_RERIG_FLOW_PLAN.md)). The "preserve customisations" re-init mode is the new RigStagesTab → "Refit X" buttons (`mode: 'merge'`). Per-stage refit, marker-based authoring tracking, single-flight guard, and the `seedAutoRigConfig` clobber-fix all landed.

---

## Open

### ✅ GAP-017 — In-app idle motion generation (Phase A shipped 2026-05-03)

- **Severity:** medium · **Reported:** 2026-05-03 · **Phase A SHIPPED:** 2026-05-03 (commit `4f7e0b3`)
- **Phase B/C:** **not pursued** (user decision 2026-05-03 — "Достаточно только idle"). Phase A is sufficient.

**Phase A — what shipped.** Sparkles button next to "+" in [AnimationsEditor.jsx](../src/v3/editors/animations/AnimationsEditor.jsx) opens [IdleMotionDialog.jsx](../src/v3/editors/animations/IdleMotionDialog.jsx) — preset (idle / listening / talkingIdle / embarrassedHold) × personality (calm / energetic / tired / nervous / confident) × duration (4–15 s) × fps (24/30/60) × seed. On Generate, calls [`buildMotion3()`](../src/io/live2d/idle/builder.js) directly against `project.parameters` + `project.physicsRules` (no file I/O), creates a new animation populated with one track per animated paramId, switches to it, routes to Animation workspace + Animate mode. Physics-output paramIds are skipped automatically (never animated; driven by physics tick).

Wiring covered by [`scripts/test/test_idleDialogWiring.mjs`](../scripts/test/test_idleDialogWiring.mjs) — 4 presets × physics-skip × seed determinism = 7 cases passing.

**Phase B (animation-track integration) — not pursued.** The Phase A dialog already pushes generated motion into `project.animations` as a real SS animation, so it IS a first-class track. Per-curve editing already works via the standard timeline. The cross-preset blending Phase B mentioned (70% idle + 30% breathing) is a feature-pillar scope that doesn't justify itself for the existing use case.

**Phase C (walk / wave / jump presets) — not pursued.** User-decided. The 4 idle-style presets cover the "what does my character do at rest" use case; non-loop one-shot motions are a different feature shape.

---

### ✅ GAP-016 — View Layers picker (Phase A shipped 2026-05-02)

- **Severity:** medium · **Reported:** 2026-05-02 · **Phase A SHIPPED:** 2026-05-02

> **Post-rework note (2026-05-02 same day):** the workspace rework that landed later the same day **deleted `src/v3/shell/workspaceViewportPolicy.js` + `test_workspaceViewportPolicy.mjs`** entirely. Workspaces are now layout-only — they no longer filter `viewLayers` at consumption time. Every consumer (`scenePass`, `CanvasViewport`, `CanvasArea`, `ViewLayersPopover`) now reads `editorStore.viewLayers` directly. The single-`viewLayers`-map outcome of GAP-016 survived; only the policy filter went away. Lines below referencing the policy module are historical.

**Phase A — fix.** New [`src/v3/shell/ViewLayersPopover.jsx`](../src/v3/shell/ViewLayersPopover.jsx) — single popover in the viewport's top-right toolbar (left of the Reset Pose button) lists every overlay/visualization toggle grouped by Mesh / Rig / Edit, plus three preset buttons (Clean / Modeling / Diagnostics).

State source of truth is now `editorStore.viewLayers` — one map replacing the prior split between `editorStore.overlays.*` (display flags) and the standalone `editorStore.showSkeleton` boolean. Two new layers (`warpGrids`, `rotationPivots`) gate the WarpDeformerOverlay and RotationDeformerOverlay in [`CanvasArea.jsx`](../src/v3/shell/CanvasArea.jsx) — previously rendered unconditionally in edit mode. The prior `meshEditMode/skeletonEditMode/blendShapeEditMode` triple was later collapsed into the single `editorStore.editMode` slot (workspace rework, same day).

Originally `workspaceViewportPolicy.js` filtered `viewLayers` at consumption time so workspaces could suppress mesh/rig overlays. The workspace rework deleted that module — workspaces are layout-only now (Blender pattern); every viewer reads `editorStore.viewLayers` directly. `setViewLayers({skeleton:false})` still drops the user out of skeleton-edit mode (matches prior `setShowSkeleton(false)` behaviour).

**Migration touched:**
- New: [`ViewLayersPopover.jsx`](../src/v3/shell/ViewLayersPopover.jsx)
- [`editorStore.js`](../src/store/editorStore.js) — `overlays` + `showSkeleton` collapsed into `viewLayers` map; `setOverlays` + `setShowSkeleton` replaced by `setViewLayers`
- ~~`workspaceViewportPolicy.js`~~ — initially refactored to accept `viewLayers`, then **deleted entirely** in the workspace rework later the same day
- [`scenePass.js`](../src/renderer/scenePass.js) — reads `editor.viewLayers.{image,wireframe,vertices,edgeOutline,irisClipping}`
- [`CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) — reads `editorState.viewLayers.skeleton`; wizard handlers call `setViewLayers({skeleton:…})`
- [`CanvasArea.jsx`](../src/v3/shell/CanvasArea.jsx) — gates WarpDeformerOverlay on `viewLayers.warpGrids`, RotationDeformerOverlay on `viewLayers.rotationPivots`, mounts the popover (edit Viewport only)
- [`captureExportFrame.js`](../src/components/canvas/viewport/captureExportFrame.js) — mock-editor uses the new shape (every layer except `image` + `irisClipping` stripped for clean frame export)

**Test coverage at GAP-016 ship time:** `test:workspaceViewportPolicy` 57/57, `test:editorStore` 42/42, `test:livePreviewWiring` 36/36. The first of those was deleted alongside the policy module hours later; the latter two are still green at higher case counts (`test:editorStore` 61/61, `test:livePreviewWiring` 24/24 as of 2026-05-02 evening). Full `npm test` suite green; `npx tsc --noEmit` clean.

**Phase B SHIPPED 2026-05-02 (named user presets):**
- New [`preferencesStore.viewLayerPresets`](../src/store/preferencesStore.js): `Record<string, ViewLayers>`, persisted to localStorage as `v3.prefs.viewLayerPresets`. Setters: `setViewLayerPreset(name, layers)` (overwrite-on-conflict, empty-name no-op) and `deleteViewLayerPreset(name)`.
- [`ViewLayersPopover.jsx`](../src/v3/shell/ViewLayersPopover.jsx) extended with a "My presets" section + a "Save as…" form. Built-in presets (Clean / Modeling / Diagnostics) stay separate; user presets list with click-to-apply + X-to-delete.

**Phase B note (still deferred):** per-area scoping (Layers picker affects only the canvas it lives on, useful when two viewport tabs ever ship side-by-side). Out of scope until the area system supports two simultaneous viewport tabs.

---

### ✅ GAP-011 — Project data layer not canonical (4 rig fields lost on save→load)

- **Severity:** critical (silently downgrades export from "use my edits" to "auto-regenerated" without warning)
- **Reported:** 2026-05-01 (user-flagged + audit-confirmed)
- **Affects:** every workflow that saves and reloads a project — i.e. all real-world use

**Strategic principle the audit revealed:**

> Stretchy Studio's value sits on a single invariant — *the project file is the canonical source of truth.* User edits in any editor land in `project.*`, save→reload reproduces the editing context exactly, and the export pipeline reads from `project.*` rather than re-deriving from PSD heuristics. Today this invariant is partially broken.

**Root cause (one-line):** [`saveProject`](../src/io/projectFile.js#L82) does not serialize four fields that `seedAllRig` populates: `autoRigConfig`, `faceParallax`, `bodyWarp`, `rigWarps`. After a save→load round-trip, the export pipeline's `anySeeded` check returns false and falls through to a fresh `initializeRigFromProject` heuristic harvest. The user's customisations are silently re-derived from PSD geometry rather than honoured.

**Repro (verified by audit, 2026-05-01):**

1. Open `shelby_neutral_ok.psd` → click Init Rig (populates all 4 fields in memory).
2. Export `.cmo3` → produces correct rig (matches Cubism Editor output).
3. Save project as `.stretch`.
4. Close app, reload `.stretch` → 4 fields are now null/empty (migrations default them).
5. Export `.cmo3` → falls through to fresh harvest → **visually different output from step 2**, despite no user edits between steps.

**Full audit:** [docs/PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md). Tier 1 (works) lists the 12 persisted fields. **Tier 2 (the gap)** lists the 4 lost fields. Tier 3 lists what's deterministically re-derived (fine). Tier 4 lists transient state (intentionally not persisted).

**Fix (Phase A — quick, ~30 min):** add the 4 missing fields to `saveProject`'s `projectJson` object. Migrations v7-v10 already provide null defaults on legacy saves, so no breakage. Test by exporting `.cmo3` from a freshly-loaded `.stretch` and asserting byte-equal output vs pre-save export.

**Why GAP-011 ranks above other Open entries:**

- Multiple downstream features wait on this: GAP-005 (multi-target export — without a stable data layer, every target's "use my edits" path is broken the same way), GAP-008 (Init Rig opt-out with persistence — the opt-out flag would land in `autoRigConfig` which doesn't survive save/load), GAP-009 (Project vs Auto-regenerated picker — in current state both produce identical output after save/load, defeating the picker's purpose), and the entire `project_v3_rerig_flow_gap` (no point editing in a UI surface if edits don't persist).
- It's also a verification blocker for [CUBISM_WARP_PORT.md](live2d-export/CUBISM_WARP_PORT.md) Phase 1 — the oracle-diff numeric test needs a programmatic rigSpec build path, which means the project must contain enough data to skip the wizard. Today it doesn't survive save/load, so CLI-driven oracle-diff is impossible.

**Notes:** Phase A only fixes the round-trip. Phase B (move Tier 3 fields like eye closure parabolas into Tier 1) is deferred until UI editors for them exist. See PROJECT_DATA_LAYER.md "Migration plan" section.

---

### ✅ GAP-012 — PSD reimport doesn't invalidate seeded rig data (silent corruption)

- **Severity:** high (silently corrupt exports after a normal user workflow)
- **Reported:** 2026-05-01
- **Affects:** anyone who edits a PSD after Init Rig — re-meshes a layer, adds a new layer, renames a layer, deletes a layer, etc.

**Root cause (one-line):** PSD reimport updates `project.nodes` but doesn't tell any of the seeded rig stores (`faceParallax`, `bodyWarp`, `rigWarps`, mesh boneWeights, animation tracks) that their assumptions about the node set may have changed. Stored vertex-indexed data still points at the old vertex layout; new meshes aren't covered by existing keyforms; renamed groups break variant/physics references.

**Concrete failure modes** (cross-referenced from [PROJECT_DATA_LAYER.md → Integrity gaps](PROJECT_DATA_LAYER.md#integrity-gaps-and-known-footguns)):

- **I-1**: warp keyform `positions` arrays are positionally indexed to `node.mesh.vertices`. PSD reimport that re-meshes a layer keeps the index range the same but maps to different geometry — keyforms now deform random vertices toward old silhouette points.
- **I-3**: re-Init Rig with reduced tag coverage (e.g. removed `bottomwear` group) drops `ParamSkirt` from the parameter list, but any animation track still referencing `ParamSkirt.value` becomes a dangling property path.
- **I-4**: layer renamed from `face.smile` to `face_alt` after seeding — `node.variantSuffix='smile'` is stale, but `variantNormalizer` runs from name on next import and can't reconcile.
- **I-5**: bone group renamed/deleted → `node.mesh.jointBoneId` dangles silently.
- **I-6**: physics output bone group renamed → `physicsRules[].outputs[]` dangles.

**Why this is THE umbrella issue:** these five sub-failures share the same root — *the system has no way to know when seeded data has gone stale*. Fixing each individually patches symptoms; the fix is one shared mechanism.

**Defence (Phase A — detection):** ✅ **SHIPPED 2026-05-01.**

1. ✅ Per-mesh fingerprint at seed time — flat `project.meshSignatures: { [partId]: {vertexCount, triCount, uvHash} }`. Module [src/io/meshSignature.js](../src/io/meshSignature.js). Hooked in `projectStore.seedAllRig`; survives save/load via [`projectFile.js`](../src/io/projectFile.js) + schema migration v12. Tests: `test:meshSignature` (29 cases). **Divergence from original sketch:** flat top-level map, not per-subsystem; positional UV hash, not sorted (reordering is an invalidating change keyform.positions cares about).
2. ✅ Reactive validation — [src/v3/shell/StaleRigBanner.jsx](../src/v3/shell/StaleRigBanner.jsx) calls `validateProjectSignatures(project)` on every project mutation (memoized; <1ms for typical mesh counts). Emits one structured `logger.warn('staleRig', …, {stale, missing})` per change with divergence so the Logs editor shows per-part detail.
3. ✅ UI banner — yellow row mounts in `<AppShell>` between Topbar and AreaTree when `hasStaleRigData(report)` is true. Summary count + Re-Init Rig (calls `RigService.initializeRig` directly) + dismiss-for-this-session. Auto-reappears when divergence count changes.

**Detection-only by design.** No auto-clear (lossy). User decides.

**Phase A coverage:** any PSD reimport that touches mesh geometry — vertex count, tri count, UV values, OR positional vertex order — raises the banner and emits per-mesh logs. NOT covered by signatures alone: layer rename (Hole I-4) and bone group rename (Holes I-5 / I-6); those need separate name-vs-id reference fixes (scheduled in Step 4 of the closure plan).

**Defence (Phase B — selective re-derivation):** "Re-Init Rig (preserve customisations)" mode that re-runs the wizard for changed meshes only, leaving unchanged-mesh seeds intact. Out of scope for the umbrella fix.

**Files touched (Phase A):**
- [`src/io/live2d/rig/faceParallaxStore.js`](../src/io/live2d/rig/faceParallaxStore.js) (add `meshSignatures` field to serialized spec)
- [`src/io/live2d/rig/bodyWarpStore.js`](../src/io/live2d/rig/bodyWarpStore.js) (same)
- [`src/io/live2d/rig/rigWarpsStore.js`](../src/io/live2d/rig/rigWarpsStore.js) (per-mesh signature)
- New `src/io/meshSignature.js` (the hash function)
- PSD-reimport hook (likely in `RigService` or `psdImportFinalize`) — recompute all signatures, write to `useLogsStore`
- `src/v3/shell/Topbar.jsx` or a dedicated `<StaleRigBanner>` — UI surface

**Notes:** GAP-011 (round-trip persistence) is the prerequisite — Phase A's signature fields would also be lost on save/load without GAP-011's fix. Phase A of GAP-011 is shipped (2026-05-01), so GAP-012 is unblocked.

This work was already partially planned in [NATIVE_RIG_REFACTOR_PLAN.md → Cross-cutting invariants → ID stability](live2d-export/NATIVE_RIG_REFACTOR_PLAN.md#id-stability-and-invalidation) — explicitly deferred from v1 of the refactor as a footgun acceptable for the initial ship. GAP-012 is the formal entry to track shipping it.

---

### ✅ GAP-013 — Parameter delete has no orphan-reference detection

- **Severity:** medium
- **Reported:** 2026-05-01
- **Affects:** workflows that delete custom parameters (variant suffix params, bone-rotation params), and re-Init Rig flows where tag coverage changes invalidate previously-registered params

**Root cause (one-line):** `project.parameters` is a flat list with no back-references. UI surfaces that remove a parameter (or the `paramSpec.requireTag` gating that drops a param when its tag no longer appears) leave the parameter's references dangling in three places:

- `project.animations[].tracks[].propPath` referencing the deleted parameter ID
- `bindings[].parameterId` inside `faceParallax`, `bodyWarp`, `rigWarps` keyform records
- `physicsRules[].inputs/outputs` referencing parameters as drivers

The parameter disappears, but every reference to it stays in the project, silently producing zero motion / wrong export until someone notices.

**Defence (Phase A — detection):** ✅ **SHIPPED 2026-05-01.**

1. ✅ [`src/io/live2d/rig/paramReferences.js`](../src/io/live2d/rig/paramReferences.js): `findReferences(project, paramId)` for a single id; `findOrphanReferences(project)` sweeps the whole project. Both return structured reports with `location` strings ("animation:anim1:track[3]", "rigWarps[hair-front]:bindings[0]", etc.) ready for UI rendering. Only the 14 unconditional standard params + `ParamOpacity` + `ParamRotation_*` prefix are allowlisted; tag-gated standard params (ParamSkirt, ParamHairFront, etc.) ARE in the orphan-detection scope by design — exactly the case I-3 cares about.
2. ✅ Hooked in `projectStore.seedAllRig` (post-seed): emits `logger.warn('paramOrphans', …, { [orphanId]: locations })` per Init Rig with non-zero orphan count. Surface visible in the Logs editor.

**Test coverage:** `test:paramReferences` (27 cases).

**Phase B (deferred until UI editor exists):**

UI delete-confirm dialog when a parameter editor surface lands. Today's UI doesn't expose parameter delete, so the warn-only path is sufficient — the bug only manifests via re-Init Rig with reduced tag coverage, where the post-seed warn already catches it. Prerequisite for safe parameter-editor UI; tracked under [`project_v3_rerig_flow_gap`](../README.md).

---

### ✅ GAP-014 — No "Reset Transform" button in v3 Object properties tab

- **Severity:** low · **Reported:** 2026-05-02 (user-flagged) · **Fixed:** 2026-05-02

**Fix:** added below the Pivot section in [`ObjectTab.jsx`](../src/v3/editors/properties/tabs/ObjectTab.jsx). One click writes the identity transform `{x:0, y:0, rotation:0, scaleX:1, scaleY:1, pivotX:0, pivotY:0}` via the existing `patch(updateProject)` helper, so the change is undoable.

Plain `<button>` rather than the `Button` component because the file has `// @ts-check` and `Button`'s `forwardRef` signature doesn't carry children types under tsc — keeps the component file warning-free. Visual styling matches the existing Visible/Hidden toggle in the same panel for consistency.

Distinct from [GAP-006](#gap-006--no-reset-to-rest-pose-button-in-pose-workspace) (Reset to Rest Pose — clears whole-character draft pose + paramValues, animation-mode only). GAP-014 is per-node; GAP-006 is whole-character. Both shipped together 2026-05-02.

---

### ✅ GAP-001 — See-Through import wizard not v3-native (SHIPPED 2026-05-02)

- **Severity:** medium · **Reported:** 2026-04-30 · **Fixed:** 2026-05-02

**Fix.** The wizard component is now mounted at AppShell level ([`src/v3/shell/PsdImportWizard.jsx`](../src/v3/shell/PsdImportWizard.jsx)) alongside the other modal/banner chrome (StaleRigBanner, SaveModal, ExportModal). It reads from a dedicated [`wizardStore`](../src/store/wizardStore.js) and dispatches actions through [`PsdImportService`](../src/services/PsdImportService.js); CanvasViewport no longer hosts the wizard mount, the local wizardPsd state, the snapshot ref, the ONNX session ref, or any of the nine wizard handler `useCallback`s.

The 11-prop callback API is gone. The wizard's actions are 9 service methods (`start` / `cancel` / `finalize` / `reorder` / `applyRig` / `skip` / `complete` / `back` / `splitParts` / `updatePsd`). Side-effects that touch the WebGL context (mutating project.nodes from PSD layers + uploading textures + auto-meshing every part) stay in CanvasViewport but reach the wizard through `captureStore` bridges (`finalizePsdImport`, `autoMeshAllParts`) — same pattern Properties → MeshTab uses for `remeshPart`. The ONNX session moved into [`dwposeService`](../src/services/dwposeService.js) as a module-level singleton.

**Why not a v3 area-editor:** the wizard is intentionally multi-modal — `review` and `dwpose` are full-screen modals while `reorder` and `adjust` are top banners over the canvas (the user works in side panels while the wizard watches). An "editor area tab" framing would force one shape on every step. AppShell-level chrome with per-step rendering follows the existing StaleRigBanner pattern and preserves every wizard step's intentional UX.

**Files touched:**
- New [`src/store/wizardStore.js`](../src/store/wizardStore.js) — pendingPsd / step / preImportSnapshot / meshAllParts.
- New [`src/services/PsdImportService.js`](../src/services/PsdImportService.js) — 9 action methods replacing the prior useCallback handlers in CanvasViewport.
- New [`src/services/dwposeService.js`](../src/services/dwposeService.js) — ONNX session singleton + lazy load.
- New [`src/v3/shell/PsdImportWizard.jsx`](../src/v3/shell/PsdImportWizard.jsx) — same UI as the v2 component, but reads stores + dispatches services instead of taking 11 prop callbacks.
- [`src/v3/shell/AppShell.jsx`](../src/v3/shell/AppShell.jsx) — mounts `<PsdImportWizard />` alongside other modals.
- [`src/store/captureStore.js`](../src/store/captureStore.js) — added `finalizePsdImport` + `autoMeshAllParts` bridges.
- [`src/store/editorStore.js`](../src/store/editorStore.js) — `wizardStep` / `setWizardStep` removed (consolidated to wizardStore).
- [`src/components/canvas/CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) — wizard import deleted, 9 wizard handlers + local state + 4 refs deleted, JSX mount deleted, replaced by a single useEffect that publishes finalize/autoMesh into captureStore on mount and clears them on unmount. Net removal: ~165 lines.
- Deleted `src/components/canvas/PsdImportWizard.jsx` (555 lines).

**Test coverage:** new `test:wizardStore` (19 cases), new `test:PsdImportService` (32 cases — full lifecycle: start → finalize → back rolls back project → skip → complete → splitParts/updatePsd patches). Existing 44 editorStore tests still pass after `wizardStep` removal. `npx tsc --noEmit` clean. Production build clean. Visual end-to-end (drop PSD → wizard → adjust → finish) needs browser smoke-test — pending.

**Gap location:** v3 shell + `src/components/PsdImportWizard*` (v2 component) — would need a v3 wrapper or rewrite.

**Notes:** Functionally works today. This is a polish/consistency gap, not a capability gap.

---

### ✅ GAP-015 — Blender mesh-edit ergonomics (proportional editing + MMB-scroll radius)

- **Severity:** medium · **Reported:** 2026-05-02 · **Phase A SHIPPED:** 2026-05-02

**Phase A — fix.** New [`src/lib/proportionalEdit.js`](../src/lib/proportionalEdit.js) helper module: 7 falloff curves (Smooth / Sphere / Root / Linear / Sharp / InvSquare / Constant) matching Blender's `WM_proportional_falloff` enum byte-for-byte at the rim and centre, vertex-adjacency builder from triangle indices, BFS reachability for connected-only mode, and a single-call `computeProportionalWeights` that returns a `Float32Array` of per-vertex weights for a grab. 49 unit tests cover every curve + adjacency + connected-only filtering.

State on `editorStore.proportionalEdit = { enabled, radius, falloff, connectedOnly }` (defaults: off, radius=100, smooth, connected-only off). Wired into the single-vertex drag site in [`CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx):

- **Drag start.** When `proportionalEdit.enabled = true` and the mesh has triangle indices, capture a full rest snapshot of every vertex AND build vertex adjacency (only when `connectedOnly` is on — saves work). Compute weights once; strip zero-weight vertices into an `affected[]` list of `{index, startX, startY, weight}`.
- **Drag move.** For every entry in `affected[]`, write `{startX + localDx*weight, startY + localDy*weight}`. Origin gets weight 1 → moves the full delta; rim vertices get weight ≈0 → barely move; mid-falloff vertices follow the curve. Snapshots taken at drag start so re-renders mid-drag don't drift.
- **MMB scroll during drag.** Wheel delta diverts to `radius` adjust (instead of zoom) when a proportional-edit drag is in flight. Recomputes weights against the captured rest snapshot — recomputing against in-flight deformed mesh would compound drift cumulatively.

**Hotkeys** (Modeling / Rigging workspaces only, outside input fields):
- `O` — toggle `proportionalEdit.enabled`
- `Shift+O` — cycle falloff curve
- `Alt+O` — toggle `connectedOnly`
- `Ctrl+[` / `Ctrl+]` — shrink / grow radius (`Ctrl` disambiguates from brush mode's plain `[`/`]`)

**Visual indicator.** Separate SVG `<circle>` (`propEditCircleRef`) tracks the cursor when proportional editing is enabled — yellow dashed ring at `radius * view.zoom` screen-px. Distinct from the brush-cursor white dashed ring; both can coexist when both modes are on.

**Files touched:**
- New [`src/lib/proportionalEdit.js`](../src/lib/proportionalEdit.js) + [`scripts/test/test_proportionalEdit.mjs`](../scripts/test/test_proportionalEdit.mjs) (49 cases)
- [`src/store/editorStore.js`](../src/store/editorStore.js) — `proportionalEdit` map + `setProportionalEdit` action
- [`src/components/canvas/CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) — drag-start snapshot + drag-move weighted apply + wheel-radius-adjust + keyboard hooks + indicator ring

**Phase B SHIPPED 2026-05-02:**
- **Persist proportional-edit settings.** Moved from `editorStore.proportionalEdit` to [`preferencesStore.proportionalEdit`](../src/store/preferencesStore.js) (auto-persisted to localStorage as `v3.prefs.proportionalEdit`). User's preferred radius / falloff / connectedOnly survives across reloads. Implementation deviates from the original "per project" framing: proportional editing is a **muscle-memory** preference (the user's preferred radius doesn't change with the character they're rigging), so per-user is the correct scope.
- **Adjacency caching.** New `getOrBuildAdjacency(indices, vertexCount)` in [`proportionalEdit.js`](../src/lib/proportionalEdit.js) backed by a module-level WeakMap keyed by the `indices` reference. Successive drags on the same part hit the cache after the first build; immer's path-only-replace semantics auto-invalidate when topology actually changes (retriangulate, vertex add/remove). 3 tests added (52/52 total).

**Phase B note (still open):** "Brush-mode-style adjustment of which sub-mode owns wheel scrolling" was deferred — today's behaviour (proportional drag in flight diverts wheel to radius; otherwise wheel zooms) is fine in practice.

---

### ✅ GAP-002 — No dedicated "Groups" editor tab (closed as redundant 2026-05-02)

- **Severity:** low · **Reported:** 2026-04-30 · **Closed:** 2026-05-02

**Decision:** The upstream README's "Groups tab to parent layers and adjust pivot points" workflow is fully covered by v3's Outliner + Properties → ObjectTab. Selecting a `type='group'` node in [Outliner](../src/v3/editors/outliner/) surfaces parent reassignment, pivot adjustment, and visibility in [ObjectTab.jsx](../src/v3/editors/properties/tabs/ObjectTab.jsx) (transform fields including `pivotX`/`pivotY`). A second "Groups-only" filtered view would duplicate the same actions through different chrome — net negative for user mental model.

**Why no port:** the entry's own Notes flagged "Possibly redundant with Outliner". Outliner already supports drag-to-reparent and group hierarchy display. Pivot edits go through Properties because pivots are per-node properties, not group-membership properties — splitting them across two tabs would be worse than today's single ObjectTab.

If a future user need surfaces (filtering Outliner to groups only, batch-pivot editing, named group presets), file a fresh GAP that names the specific operation Outliner+ObjectTab can't do.

---

### ✅ GAP-003 — Root README is upstream verbatim, doesn't reflect v3

- **Severity:** medium · **Reported:** 2026-04-30 · **Fixed:** 2026-05-02
- **Affects:** First-time user impression, project identity

**Fix:** [README.md](../README.md) rewritten to lead with the Cubism / Live2D pipeline as the differentiator (cmo3/moc3/can3 export, native rig in viewport, byte-faithful Cubism Core port) while keeping See-Through credit (the auto-rig genuinely uses See-Through layer-tag conventions). Project Structure section now reflects v3 layout (`src/v3/shell/`, `src/v3/editors/`, `src/io/live2d/`) instead of upstream's 4-zone shape. Cross-links to [docs/PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md), [docs/FEATURE_GAPS.md](FEATURE_GAPS.md), [docs/BUGS.md](BUGS.md), [docs/live2d-export/CUBISM_WARP_PORT.md](live2d-export/CUBISM_WARP_PORT.md), and the native rig refactor plan. Notes upstream's Spine/PNG paths still build (deferred surfacing tracked under GAP-005).

**Pre-fix state (for history):** [README.md](../README.md) was byte-identical (modulo whitespace) to upstream's pristine README at `reference/stretchystudio-upstream-original/README.md`. It marketed See-Through + DWPose + Spine export — true claims — but said nothing about our differentiators (Cubism pipeline, native rig refactor, variant system, Cubism physics, idle motion gen, hot-reload). Project Structure pointed at `src/app/layout/` and `src/components/inspector/` which were never v3 layout.

---

### ✅ GAP-007 — No in-app Logs panel for pipeline debugging

- **Severity:** high (blocks BUG-002 / BUG-003 / BUG-006 investigation)
- **Reported:** 2026-04-30
- **Affects:** All native-rig debugging; can't see what's happening internally without round-tripping to .cmo3 + opening the JSON log

**Current state:** The pipeline emits a structured `.rig.log.json` only when the user explicitly exports `.cmo3`. For the user's current testing (parabola fit, breath warp, opacity, etc. — all evaluated by the **native** rig in the viewport), there's no way to see what the pipeline computed. They have to export every time, or paste console.log calls and rebuild.

**What this should be:** a Logs editor panel inside v3, mountable as an area tab. Renders an in-memory ring buffer of structured log entries (`{ts, level, source, message, data}`). Pipeline modules write to it via a small `logger` helper; the panel renders the latest N entries with collapsible structured `data`.

**Decision (made 2026-04-30, autonomous):**

- New editor type `logs` in `editorRegistry`
- New zustand store `logsStore` (ring buffer, default cap ~500 entries)
- New helper `src/lib/logger.js` exposing `logger.debug/info/warn/error(source, message, data?)` — pushes to store + browser console
- Mount as `leftBottom` area; left column becomes a vertical split again (Outliner top, Logs bottom)
- First wired callsite: parabola fit (BUG-002)

**Status:** SHIPPING NOW. Will close this entry once panel is live and at least one module writes to it.

---

### ✅ GAP-006 — No "Reset to rest pose" button (originally Pose-only; expanded to all workspaces)

- **Severity:** medium · **Reported:** 2026-04-30 · **Initial fix:** 2026-05-02 · **Expanded:** 2026-05-02
- **Affects:** Posing workflow + bone-controller workflow in staging-mode workspaces

**Fix:** [`Topbar.jsx`](../src/v3/shell/Topbar.jsx) renders a "Reset Pose" button (RotateCcw icon + label) in the right cluster, **visible in every workspace**. Behaviour depends on the current editor mode because of how bone-controller drags persist:

- **Animation mode** (Pose / Animation workspace) — bone drags write to `animationStore.draftPose` (transient overlay). Reset:
  1. `clearDraftPose()` — drops uncommitted pose edits.
  2. `resetToDefaults(project.parameters)` — every dial back to its canonical default.
  3. Committed timeline keyframes are intentionally NOT touched.

- **Staging mode** (Layout / Modeling / Rigging) — bone drags write straight to `node.transform.rotation` in `projectStore` (persistent). Reset does the same as animation mode PLUS walks every group with a `boneRole` and zeros `transform.{rotation, x, y, scaleX, scaleY}` (preserving `pivotX/pivotY` because pivots define WHERE the bone is, not the pose). Per-part transforms (non-bone nodes) are NOT reset — those are intentional layout (positioning a hat sticker, etc.); for those the user has [GAP-014's per-node Reset Transform](#gap-014--no-reset-transform-button-in-v3-object-properties-tab).

The original 2026-05-02 fix gated the button to `editorMode === 'animation'`, which left users in Layout/Modeling/Rigging without a way to revert bone-controller rotations short of Ctrl+Z spam or per-node reset. Expanded same day after user feedback ("где кнопка сброса трансформов когда я повернул контроллеры костей в layout?").

Doc anchor for the workspace × mode matrix: [`docs/V3_WORKSPACES.md`](V3_WORKSPACES.md).

---

### ✅ GAP-005 — Export button regressed from multi-target to single-target

- **Severity:** medium · **Reported:** 2026-04-30 · **Phase A SHIPPED:** 2026-05-02 (Spine restored; PNG-sequence still deferred)
- **Affects:** Export workflow

**Phase A — Spine 4.0 path restored.** [`ExportService.runExport`](../src/services/ExportService.js) now accepts `format: 'spine'` which calls [`exportToSpine({project, onProgress})`](../src/io/exportSpine.js). The v3 [`ExportModal`](../src/v3/shell/ExportModal.jsx) lists Spine as a fourth option (Bone icon) alongside the three Cubism formats. Output filename: `<modelName>_spine.zip` (skeleton.json + per-part PNGs).

Fixed `@/` aliased imports in [`exportSpine.js`](../src/io/exportSpine.js) → relative paths so the file is consumable from Node test harnesses (the alias is Vite-only).

**Test coverage:** `test:services` extended by 1 case (`preflightExportFor(project, 'spine').ok === true`). End-to-end Spine export run-through is a manual smoke test (visual artefact validation lives outside our unit harness).

**Phase B — PNG sequence path.** Still deferred. The frame-capture code from upstream isn't currently called from ExportService and would need its own orchestration (camera framing, frame stride, ZIP packing). Out of scope of GAP-005 Phase A; promoted to a future GAP entry only when actually needed.

**Current state:** Upstream's export button surfaced multiple output targets (PNG sequence, Spine 4.0 JSON, etc.) — different formats for different downstream tools. v3's export button now drives a single Live2D `.cmo3` / `.moc3` / `.can3` pipeline. The other targets are still implemented in code (e.g. `src/io/exportSpine.js`, frame-capture code) but no longer reachable from the header.

**What was lost:**
- PNG sequence / frame export
- Spine 4.0 JSON export
- Possibly others (audit `reference/stretchystudio-upstream-original/src/components/.../ExportModal*` to enumerate)

**Why it regressed:** v3 collapsed the Export button to the single Live2D-pipeline entry point during the Blender-shell refactor. The other targets weren't deleted, they just lost their UI surface.

**What to do (when prioritized — not now):**
1. Audit upstream's ExportModal to list the original targets
2. Restore them as branches inside the v3 ExportModal — same modal, multiple format tabs
3. Wire each target to its existing exporter (most code is already there)

**Notes:** User explicitly deferred this — pipeline output quality is a higher-priority block (see BUGS.md BUG-002, BUG-003). Don't act on this until those are clean.

---

### ✅ GAP-010 — Live Preview as a tab on the center area

- **Severity:** medium · **Reported:** 2026-04-30 · **Phase A SHIPPED:** 2026-05-02 · **Refactored:** 2026-05-02
- **Affects:** Viewport workflow — separation between "edit a frame" and "watch the rig live"

**Phase A — fix.** New editor type `livePreview` registered in [editorRegistry.js](../src/v3/shell/editorRegistry.js). Live drivers (physics pendulum sway + breath cycle + cursor head-look) and editing affordances are gated by a single `previewMode` boolean on [`CanvasViewport`](../src/components/canvas/CanvasViewport.jsx):

- `previewMode=true` enables drivers and suppresses every editing affordance: mesh edit, drag-to-pivot, gizmo, skeleton overlay, drop hint, brush cursor, K-keyframe + brush keyboard shortcuts, PSD wizard mount, file-routing onDrop. Pan/zoom and cursor look are the only pointer interactions.
- `previewMode=false` is genuinely static — no physics, no breath, no cursor look, no `livePreviewActive` flag in `editorStore` anywhere. The previous toggle button in [`ParametersEditor`](../src/v3/editors/parameters/ParametersEditor.jsx) is gone; the snapshot/restore plumbing is deleted.

**Workspace defaults:** every workspace preset ([`uiV3Store.js`](../src/store/uiV3Store.js)) ships the `center` area with two tabs `[viewport, livePreview]`, viewport active by default. The user clicks the Live Preview tab on the center area's header to flip the same canvas into live mode. Both surfaces share `rigSpec` and `paramValues`.

**Single-canvas architecture (refactor 2026-05-02):** Both canvas tabs back onto the same [`<CanvasArea>`](../src/v3/shell/CanvasArea.jsx) host, which owns ONE `<CanvasViewport>` instance whose `previewMode` prop flips with the active tab. [`Area.jsx`](../src/v3/shell/Area.jsx) short-circuits the editor registry for `viewport` and `livePreview` and shares the ErrorBoundary key `${area.id}:canvas`, so toggling between the two tabs does NOT remount the canvas — WebGL2 context, texture uploads, ScenePass, the wizard's local PSD payload, ONNX session, and snapshot refs all survive. The earlier shape (two separate components per editor type, plus a brief side-by-side `centerRight` split) was replaced because every tab toggle destroyed and recreated the WebGL context, which surfaced as a "wizard character disappears forever" bug when the user toggled tabs mid-import. The registry's `component` slot for both canvas types is `null` — Area.jsx routes them through CanvasArea directly; only the `label` is consumed by AreaTabBar.

**Test coverage:** [`test:livePreviewWiring`](../scripts/test/test_livePreviewWiring.mjs) (36 cases) — every workspace's center area has `[viewport, livePreview]` tabs with viewport active, no `centerRight` slot anywhere, removed `editorStore` triple, programmatic tab swap. [`test:uiV3Store`](../scripts/test/test_uiV3Store.mjs) extended to assert the 2-tab center on layout / modeling / rigging / pose / animation.

**Phase B SHIPPED 2026-05-02 — independent camera + zoom + pan per mode.**

`editorStore.view` was replaced with `editorStore.viewByMode = { viewport: {...}, livePreview: {...} }`. The setter signature changed to `setView(modeKey, partial)`. CanvasViewport derives its `modeKey` from the `previewMode` prop and routes every read/write through the active mode's view; the per-frame `editorForDraw` spread that scenePass consumes resolves `view` from `viewByMode[modeKey]` so the renderer is unchanged. Mode-specific overlays (GizmoOverlay, WarpDeformerOverlay, RotationDeformerOverlay) only mount in the edit Viewport, so they hardcode `viewByMode.viewport`. Frame-selection in `v3/operators/registry.js` operates on viewport's view (livePreview's framing is read-only "what does this look like at runtime" and shouldn't be moved by editor operators).

**Files touched:**
- [`src/store/editorStore.js`](../src/store/editorStore.js) — `view` → `viewByMode`; `setView(partial)` → `setView(modeKey, partial)`
- [`src/components/canvas/CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) — derived `modeKey`/`view`/per-mode `setView` wrapper; every `view` read/write threaded through it
- [`src/components/canvas/GizmoOverlay.jsx`](../src/components/canvas/GizmoOverlay.jsx) + [`WarpDeformerOverlay.jsx`](../src/v3/editors/viewport/overlays/WarpDeformerOverlay.jsx) + [`RotationDeformerOverlay.jsx`](../src/v3/editors/viewport/overlays/RotationDeformerOverlay.jsx) — read `s.viewByMode.viewport`
- [`src/v3/operators/registry.js`](../src/v3/operators/registry.js) — frame-selection operates on viewport's view explicitly
- [`scripts/test/test_editorStore.mjs`](../scripts/test/test_editorStore.mjs) — per-mode setView test (44/44).

**Files touched:**
- New [src/v3/shell/CanvasArea.jsx](../src/v3/shell/CanvasArea.jsx) — single canvas host for both modes
- [src/v3/shell/Area.jsx](../src/v3/shell/Area.jsx) — canvas-tab short-circuit + shared ErrorBoundary key
- [src/components/canvas/CanvasViewport.jsx](../src/components/canvas/CanvasViewport.jsx) — `previewMode` prop + every gate site
- [src/v3/shell/editorRegistry.js](../src/v3/shell/editorRegistry.js) — `viewport`/`livePreview` entries with `component: null`
- [src/store/uiV3Store.js](../src/store/uiV3Store.js) — `EditorType` union extended; every preset's center area carries `[viewport, livePreview]`
- [src/store/editorStore.js](../src/store/editorStore.js) — removed `livePreviewActive` / `setLivePreviewActive` / `editParamSnapshot`
- [src/v3/editors/parameters/ParametersEditor.jsx](../src/v3/editors/parameters/ParametersEditor.jsx) — removed Play/Pause toggle
- Deleted: `src/v3/editors/viewport/ViewportEditor.jsx` and `src/v3/editors/livePreview/LivePreviewEditor.jsx` (logic moved into CanvasArea)

---

### ✅ GAP-009 — Export "Data Layer" picker: project data vs auto-regenerated

- **Severity:** high (key differentiator — flagged "КРУТАЯ ФИЧА" by user) · **Reported:** 2026-04-30 · **SHIPPED:** 2026-05-02

**Fix:** [`exporter.js#resolveAllKeyformSpecs`](../src/io/live2d/exporter.js) accepts a third `opts` arg with `forceRegenerate?: boolean`. When `true`, the function skips all seeded-state checks and runs a fresh `initializeRigFromProject` harvest unconditionally — equivalent to upstream pre-v3 cmo3writer behaviour where there was no project-side rig data layer. Threaded through `exportLive2D` and `exportLive2DProject` via a top-level `forceRegenerate` opt.

[`ExportModal.jsx`](../src/v3/shell/ExportModal.jsx) renders a "Rig data source" radio (Project edits / Regenerate from PSD), shown only for Cubism formats (`supportsDataLayerPicker: true` in FORMAT_OPTIONS). Selection translates to `extra.forceRegenerate` in the runExport call. Default = "Project edits"; persists per-modal-session (resets on close, picked up next time as default).

Use cases (matching the original gap brief):
- "Use my edits" — ship customisations from Init Rig + UI tweaks (default)
- "Regenerate from PSD" — clean baseline regeneration / sanity-check / regression-testing heuristic changes / recovery from a bad rig-edit state

Spine target shows the modal but hides the picker (Spine doesn't use the Cubism rig data layer).

**The idea:** every export should let the user pick which "data layer" feeds the writer:

1. **`Project data` (use my edits)** — export uses whatever's in the project store *right now*, i.e. the seeded rig from Init Rig **plus all user customisations made on top** (bone pivot tweaks, weight paint, custom deformer keyforms, manually-fixed iris/breath warps, etc.). What the user is editing in-app *is* what gets shipped.
2. **`Auto-regenerated` (fresh from PSD)** — ignore the project's seeded rig; pass `faceParallaxSpec: null, bodyWarpChain: null, rigWarps: null` into `generateCmo3` so cmo3writer's inline heuristics fire and produce a fresh rig from raw PSD geometry — exactly like upstream pre-v3 [cmo3writer.js](../reference/stretchystudio-upstream-original/src/io/live2d/cmo3writer.js) did when there was no project-side rig data layer. Useful for: clean baseline regeneration, sanity-check exports, regression-testing heuristic changes, or when the user's rig edits got into a bad state and they want to start over without rerunning Init Rig.

**Why it's a flagship feature:** SS's value prop sits exactly on this axis — "auto-rig is good enough, AND when it isn't you can edit on top, AND you can flip between the two cleanly". Most pipelines force one or the other.

**UI surface:** dropdown / radio in the v3 ExportModal (the same modal that GAP-005 will restore multi-target export to). Default = "Project data". Persist last-used choice per project.

**Implementation hook:** `exportLive2DProject` in [src/io/live2d/exporter.js](../src/io/live2d/exporter.js) currently does:

```
faceParallaxSpec = resolveFaceParallax(project);
bodyWarpChain   = resolveBodyWarp(project);
rigWarps        = resolveRigWarps(project);
if (!anySeeded) { harvest = await initializeRigFromProject(project, images); … }
```

For "Auto-regenerated" mode just force `faceParallaxSpec/bodyWarpChain/rigWarps` to `null` regardless of seeded state, then let cmo3writer's inline heuristics fire. That's it — the upstream-equivalent path is already inside `generateCmo3`; we're just choosing which inputs to send.

**Naming candidates:**
- "Data source": *Project edits* / *Regenerate from PSD*
- "Rig data": *Use my customisations* / *Fresh auto-rig*
- (User's framing): *Data layer = Stretchy Studio* / *Data layer = self-generated*

Pick at implementation time.

**Notes:** Pairs naturally with GAP-005 (multi-target export). Both should land in the same ExportModal overhaul. Don't ship one without the other — single-button export with no choice is the current state and shouldn't grow.

---

### ✅ GAP-008 — No opt-out for "rig hair" in Initialize Rig

- **Severity:** high · **Reported:** 2026-04-30 · **Phase A SHIPPED:** 2026-05-02 · **Phase B SHIPPED:** 2026-05-02 (UI checkbox popover next to Init Rig button)
- **Affects:** Init Rig flow on characters where the auto-detected hair rig is unwanted (wrong shape, breaks down, or character intentionally has rigid hair)

**Phase A — data layer + filter logic shipped.** New `project.autoRigConfig.subsystems` section with seven boolean flags (faceRig / eyeRig / mouthRig / hairRig / clothingRig / bodyWarps / armPhysics), all true by default. Setting any to `false` drops matching outputs at harvest time:

- `faceRig: false` → FaceParallax warp dropped
- `bodyWarps: false` → body warp chain dropped + `breath` physics rule dropped
- `hairRig: false` → all `front hair` / `back hair` rigWarps dropped + all `hair-*` physics rules dropped
- `clothingRig: false` → all `topwear`/`bottomwear`/`legwear` rigWarps dropped + clothing physics rules dropped
- `eyeRig: false` → eye/eyelash/iris/eyebrow rigWarps dropped
- `mouthRig: false` → mouth rigWarps dropped
- `armPhysics: false` → `arm-*` / `*elbow*` physics rules dropped

Wired in [`harvestSeedFromRigSpec`](../src/io/live2d/rig/initRig.js) (post-rigSpec filter using a `partId → tag` map built from `project.nodes` with `matchTag`) and [`seedPhysicsRules`](../src/io/live2d/rig/physicsConfig.js) (rule-name prefix filter). Persists via the existing autoRigConfig save/load path; resolveAutoRigConfig spread-merges partial subsystem configs (Hole I-7 mechanism applies).

**Test coverage:** `test:subsystemsOptOut` (46 cases) — all 7 flags individually + combined, tag-to-subsystem map correctness, physics-rule prefix mapping, no-opts fallback (pre-GAP-008 behaviour preserved), seedPhysicsRules integration.

**Phase B SHIPPED 2026-05-02 — UI checkbox popover.** New [`src/v3/editors/parameters/InitRigOptionsPopover.jsx`](../src/v3/editors/parameters/InitRigOptionsPopover.jsx). The popover trigger sits next to the Init Rig button in both [`ParametersEditor`](../src/v3/editors/parameters/ParametersEditor.jsx) surfaces (empty-state and the in-header re-run button), and renders a 7-checkbox list bound directly to `project.autoRigConfig.subsystems` via `updateProject` (so changes are undoable + persist via the existing autoRigConfig save/load path that GAP-011 Phase A already covered). Trigger label shows enabled-count (e.g. `6/7`) so users can see at a glance that they've opted out of something. Helper buttons: All / None.

The expected workflow: uncheck "Hair rig" (or any other) → click Init Rig → resolveAutoRigConfig sees the flag and the post-build filter in `harvestSeedFromRigSpec` drops the matching outputs. No re-toggling needed for subsequent re-runs; the project remembers.

Doesn't gate on the rerig-flow infrastructure — the UI surface is its own button next to Init Rig, not a deeper "rig settings" panel. The data-layer plumbing was always sufficient on its own.

**Current state:** Initialize Rig auto-detects hair (front-hair / back-hair tags) and synthesises sway physics + warp deformers for them. There's no UI checkbox / option / config to skip the hair rig — even if the user wants every other rig output (face, body, eyes, mouth) but not hair, they get it anyway. The user has surfaced this multiple times: every Init Rig forces the hair rig, which is bad for short-hair / buzz-cut / accessory-hair characters where the auto-rig doesn't produce a useful result.

**What's needed (UX direction):**

A pre-init options panel (or an "advanced" expander on the Init Rig button) listing rig subsystems with checkboxes:

- ☑ Face / head rig (parallax, body angle X/Y/Z)
- ☑ Eye rig (closure, iris, eyeball)
- ☑ Mouth rig (open, smile, variants)
- ☐ Hair rig (sway physics, hair warp) ← **needs to be opt-out-able**
- ☑ Clothing rig (hem sway, basic deformers)
- ☑ Body warps (breath, body X/Y/Z)
- ☑ Arm physics (elbow pendulum)

User toggles before clicking Init Rig; unchecked subsystems are skipped entirely (no params registered, no deformers emitted, no physics entries).

**Implementation hook:** `resolveAutoRigConfig(project)` already exists in [src/io/live2d/rig/autoRigConfig.js](../src/io/live2d/rig/autoRigConfig.js) — extend it with per-subsystem booleans, surface them in a config panel, gate each subsystem's emit path on its flag. The config should persist in the project file so re-init keeps user preferences.

**Notes:** Related to BUG-008 (frozen layer after bone-move + Init Rig) and BUG-010 (Iris Offset broken after Init Rig) — collectively suggest Init Rig needs to be more controllable, not less. User-controlled gating is the orthogonal axis to "make rebuild non-destructive".

---

### ✅ GAP-004 — Audio + Spine export reachability through v3 (verified)

- **Severity:** low · **Reported:** 2026-04-30 · **Verified:** 2026-05-02
- **Affects:** Feature completeness through v3 shell

**Audit result: both features ARE surfaced through v3.**

- **Spine 4.0 export.** [`src/v3/shell/ExportModal.jsx:70-72`](../src/v3/shell/ExportModal.jsx#L70) lists Spine as the fourth format option (Bone icon, blurb "Skeleton JSON + per-part PNGs zip for Spine runtimes"). `ExportService.runExport(format='spine')` calls `exportToSpine({project, onProgress})` which produces `<modelName>_spine.zip` (skeleton.json + per-part PNGs). Restored as part of GAP-005 Phase A on 2026-05-02.

- **Audio tracks.** [`src/v3/editors/timeline/TimelineEditor.jsx:1453-1479`](../src/v3/editors/timeline/TimelineEditor.jsx#L1453) has an "Add Audio Track" button (Music icon) in the timeline transport. Clicking prompts for a name, creates an `audioTracks[]` entry on the active animation, and renders an [`AudioTrackRow`](../src/v3/editors/timeline/TimelineEditor.jsx#L411) for upload. [`AudioTrackModal`](../src/v3/editors/timeline/TimelineEditor.jsx#L228) handles per-track edits (start/end ms, timeline placement). Web Audio playback sync via [`useAudioSync`](../src/v3/editors/timeline/TimelineEditor.jsx#L128) keeps the buffer aligned to the playhead; loop restart hooks into `animationStore.loopCount`.

No new gap to file. The GAP-004 smoke-test list cleared.

---

## Investigating

*(none yet)*

---

## Closed

*(none yet)*

---

## Verified shipped (looks-like-a-gap-but-isn't)

Items the casual code-reader might mistake for missing. Documented here so they don't get re-flagged.

| Feature | Why it looks missing | Where it actually is |
|---------|---------------------|---------------------|
| Automatic eye clipping | Grepping `eye_clip` / `iris_clip` returns nothing | Camel-case `irisClipping` flag in [editorStore.js:29](../src/store/editorStore.js#L29); stencil clipping in [scenePass.js:172](../src/renderer/scenePass.js#L172); mask configs at [io/live2d/rig/maskConfigs.js](../src/io/live2d/rig/maskConfigs.js) |
| Realistic limb bending | No "skinning" UI in v3 | Vertex-skinning rigs at [src/io/live2d/rig/](../src/io/live2d/rig/), applied during mesh upload in CanvasViewport pipeline |
| Drag-drop PSD/PNG/.stretch | No v3 shell handler visible | Routed through CanvasViewport's `onDrop` ([CanvasViewport.jsx:1319](../src/components/canvas/CanvasViewport.jsx#L1319)) which v3 mounts inside the Viewport area |
| DWPose auto-rig | "AI / ONNX" not visible in v3 shell | `loadDWPoseSession()` + `runDWPose()` in [io/armatureOrganizer.js](../src/io/armatureOrganizer.js); gated behind `mlEnabled` preference in PsdImportWizard |
| Blender-style shape keys | Not called "shape keys" anywhere | Variant system: [VariantTab.jsx](../src/v3/editors/properties/tabs/VariantTab.jsx) + `BlendShapeTab.jsx`; influence sliders driven by parameter values |
