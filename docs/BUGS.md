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

## Status snapshot (2026-05-02)

| Status | Entries |
|--------|---------|
| ✅ Fixed / Superseded | BUG-001 (tab-switch remount), BUG-002 (eye-closure parabola), BUG-004 (Init Rig armature/mesh sync via resetToRestPose), BUG-006 (warp extrapolation, superseded by Cubism warp port Phase 1), BUG-007 (variant visibility), BUG-008 (Init Rig + bone-move sister), BUG-009 (eyes closed after Init Rig), BUG-010 (Iris Offset sister), BUG-011 (seedAllRig get-throw), BUG-012 (wizard selection leak + workspace viz policy) |
| 🔬 Instrumented (awaiting repro) | BUG-005 (per-piece Opacity slider) |
| ⏳ Open | BUG-003 (kernel verified textbook via raw asm; Phase 2b FD Jacobian probe BLOCKED on rotation-matrix-structure refactor — quantified at 17.73 px param max via oracle harness) |

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

| Role | Path |
|------|------|
| **Test PSD** (input) | `D:\Projects\Programming\stretchystudio\shelby_neutral_ok.psd` |
| **Expected `.cmo3` reference** | `D:\Projects\Programming\stretchystudio\shelby.cmo3` |
| **Expected runtime bundle** (model3 / moc3 / textures, post-"Export For Runtime") | `D:\Projects\Programming\stretchystudio\New Folder_cubism\` |

**How to use these for any pipeline bug:**

1. Drop `shelby_neutral_ok.psd` into the editor → run the wizard → export `.cmo3`
2. Diff against `shelby.cmo3` (XML structure, deformer chains, keyform values) using the inspectors
3. For runtime parity, also load both in Cubism Viewer and scrub the same params

The reference `shelby.cmo3` and runtime files were produced by Cubism Editor directly, so any divergence in our export is on us, not the reference.

---

## Open

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

### BUG-003 — Body Angle X/Y/Z + face Angle X/Y/Z don't match Cubism

- **Severity:** high · **Reported:** 2026-04-30 · **Root cause confirmed via raw asm:** 2026-05-02 · **Fix in progress (Phase 2b)**
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

- TOTAL divergence (raw v3 vs oracle, all causes): max=73.23 px, mean=6.00 px across 21 fixtures
- PARAM-DRIVEN divergence (total minus rest baseline — pure BUG-003 signal): max=17.73 px, mean=3.25 px
- Worst drawable: ArtMesh6 (eyelash-l), chain has rotation-on-warp-parent boundaries

**Phase 2b implementation blocker found (2026-05-02):** initial attempt revealed v3's rotation matrix structure (`R · diag(extraSx, extraSy)`) is **diagonal-only**. When a warp is parameter-rotated, the warp's local Jacobian at the rotation pivot has off-diagonal terms — a rotation that the FD probe captures as `(dx, dy)`. v3's diagonal matrix can only carry the magnitude `|delta|`, not the directional information. Both attempted alternatives (canvas-final + chain-stop OR FD-magnitude-as-slope) made divergence worse than baseline. Real fix requires switching `rotationEval.js`'s matrix to a general 2×2 + translation, which is a downstream-consumer refactor out of scope for a single sweep. Detail in [`CUBISM_WARP_PORT.md`](live2d-export/CUBISM_WARP_PORT.md#-phase-2--rotation-deformer-eval-raw-asm-verified-2026-05-02).

**Status:** ⏳ Blocked on rotation-matrix-structure refactor. Diagnostic harness shipped; baseline pinned; infrastructure (`DeformerStateCache.evalChainAtPoint`) preserved for the next attempt.

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

### ✅ BUG-006 — Breath warp squashes the whole head (and body angle / face angle leaked too)

- **Severity:** high · **Reported:** 2026-04-30 · **Fixed:** 2026-04-30 (after `4e8ad18`) · **Superseded:** 2026-05-01 (Cubism warp port, Phase 1)
- **Affects:** in-app native rig evaluator — *every* warp deformer (BreathWarp, BodyXWarp, BodyWarpY, BodyWarpZ, FaceParallax, etc.)

**Root cause (one-line):** the runtime warp evaluator extrapolated the *deformed* keyform grid linearly outside `[0, 1]` instead of falling back to the rest grid. With a deformation gradient at the grid boundary (e.g. breath's chest compression at row 1, body-angle bow at the edge cells), the extrapolation propagated that deformation monotonically into every vertex past the bbox. Result: head squashes with breath, face leans with body angle, etc.

**Initial fix (2026-04-30):** at the warp step in `chainEval`, branch on `(u, v) ∈ [0, 1]² ?` — inside use the deformed `state.grid`, outside fall back to `state.baseGrid` (uniform rest projection). This stops the unwanted extrapolation but is still **not** what Cubism Core actually does.

**Phase 1 supersession (2026-05-01):** Phase 0 IDA reverse-engineering of `WarpDeformer_TransformTarget` revealed the real Cubism behaviour — it doesn't cut off, it **continues to displace OOB vertices using edge-gradient linear extrapolation**, with smooth handoff via a 9-region dispatch (1 far field + 4 boundary bands + 4 corner zones). The cutoff fix was too conservative and left a class of "vertex stops moving when it leaves the bbox" residual visible in shelby's body chain. Replaced by [cubismWarpEval.js](../src/io/live2d/runtime/evaluator/cubismWarpEval.js), which is a byte-faithful port of the Cubism kernel; `chainEval.js` warp branch now calls `evalWarpKernelCubism` instead of `bilinearFFD(inside ? grid : baseGrid)`. See [CUBISM_WARP_PORT.md](./live2d-export/CUBISM_WARP_PORT.md) for the full RE pseudocode + verification setup.

**Files touched (Phase 1):** [cubismWarpEval.js](../src/io/live2d/runtime/evaluator/cubismWarpEval.js) (new), [chainEval.js](../src/io/live2d/runtime/evaluator/chainEval.js) (warp branch swap, `isQuadTransform` plumbed via `DeformerStateCache.getState`).

**Tests:** chainEval 25/25, warpEval (old) 45/45, **cubismWarpEval (new) 29/29**, e2e_equivalence 27/27, full rig-eval suite 754/754 — no regressions.

**Visual confirmation:** TODO — user to re-run shelby_neutral_ok.psd, confirm breath stops squashing head AND body angle X/Y/Z + face angle X/Y/Z look correct. (BUG-003 left open until re-verified — most likely already fixed by Phase 1 port.)

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
