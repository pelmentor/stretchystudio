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
| ✅ Fixed / Superseded | BUG-002, BUG-003, BUG-006 |
| 🔬 Instrumented (awaiting repro) | BUG-001, BUG-005 |
| ⏳ Open | BUG-004, BUG-007, BUG-008, BUG-009, BUG-010 |

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

### BUG-001 — Character disappears when switching workspaces / area tabs

- **Severity:** high
- **Reported:** 2026-04-30 (recurring report; user has surfaced this multiple times)
- **Affects:** v3 viewport rendering, all imported PSD characters

**Repro (incomplete — fill in once captured):**

1. Import a PSD via the wizard
2. Confirm the character renders in the Viewport area
3. Switch workspaces (Layout → Modeling, Modeling → Rigging, etc.) **OR** switch area tabs within a workspace
4. Observe: viewport goes blank — character vanishes from the canvas

What we don't know yet:

- Does it happen on *every* workspace switch or only specific transitions?
- Does it happen on tab switches inside a single workspace, or only across workspaces?
- Does the model come back if you toggle the workspace again?
- Does it happen in the `Animation` workspace specifically (where the timeline mounts)?

**Suspects (none confirmed — instrument before fixing):**

1. **Viewport unmount/remount loses GL state.** `Area.jsx` may re-key the editor on tab change, fully remounting `CanvasViewport`. The webgl context, texture uploads, or canvas-ref state could die with it.
2. **`editorMode` flip side-effect.** Topbar now re-couples workspace → editorMode (Pose/Animation → `'animation'`, others → `'staging'`). The renderer's "first frame after mode change" path may leave projection / draw-state inconsistent.
3. **`view.zoom` / `view.panX/Y` reset.** Something on workspace switch may be resetting the view transform, sending the model far off-screen rather than truly hiding it.

**Next steps:**

1. Get a precise repro from the user — exact tab/workspace sequence
2. ✅ **Instrumentation shipped 2026-05-02** (per memory `feedback_verify_not_theorize.md`):
   - [`Topbar.handleWorkspaceClick`](../src/v3/shell/Topbar.jsx) emits `logger.debug('workspaceSwitch', …, {previousWorkspace, nextWorkspace, previousMode, nextMode, modeWillChange})` on every workspace pill click
   - [`Area.useEffect`](../src/v3/shell/Area.jsx) emits `logger.debug('areaTab', …, {areaId, previousTabId, nextTabId, editorType, remount})` on every tab transition. Detects the ErrorBoundary `key` flip that fully unmounts the editor body
   - [`CanvasViewport`](../src/components/canvas/CanvasViewport.jsx) `WebGL init` useEffect logs `logger.debug('viewportGL', 'WebGL2 context initialised', …)` on mount and `'WebGL2 context destroyed'` on cleanup. Direct evidence of GL context cycling
3. **Repro flow:** open the v3 Logs editor (left-bottom area), perform the disappear repro, scroll back through `workspaceSwitch` → `areaTab` → `viewportGL` event sequence. The pattern should immediately distinguish (a) Viewport unmount-remount loses GPU uploads (b) workspace mode flip vs (c) view transform reset.

**Notes:** Memory entry mirrors this — `memory/project_v3_tab_switch_disappears.md`.

---

### ✅ BUG-003 — Body Angle X/Y/Z + face Angle X/Y/Z don't match Cubism

- **Severity:** high · **Reported:** 2026-04-30 · **Root cause confirmed + Phase 2a ship:** 2026-05-02
- **Affects:** Body angle + head angle parameter rigging in in-app native rig eval

**Root cause (confirmed via IDA Pro disassembly of `RotationDeformer_TransformTarget` at `0x7fff2b24c950`, 2026-05-02):** v3's hand-written `buildRotationMat3` used a textbook 2D rotation matrix; Cubism's actual kernel applies a different linear transform — equivalent to `R_textbook(θ + 90°)·diag(rx, ry)`. The two formulas:

```
v3 textbook:    out.x = cos·s·rX·px + (-sin·s·rY)·py + originX
                out.y = sin·s·rX·px + ( cos·s·rY)·py + originY

Cubism actual:  out.x = (-sin·s·rY)·px + (cos·s·rX)·py + originX
                out.y = ( cos·s·rY)·px + (sin·s·rX)·py + originY
```

For a body-angle deformer at θ=±10° (Cubism's typical range), v3 produced near-identity behaviour while Cubism produces near-90°-rotated behaviour. The user-visible symptom "body angle X/Y/Z don't match Cubism" was exactly this 90° offset.

**Phase 2a fix (2026-05-02):** [`src/io/live2d/runtime/evaluator/cubismRotationEval.js`](../src/io/live2d/runtime/evaluator/cubismRotationEval.js) byte-faithful port of the kernel; `chainEval.js` switched to `buildRotationMat3CubismAniso`. Tests: `test:cubismRotationEval` (57 cases including a "BUG-003 canary" that asserts the new formula diverges from v3's textbook for non-trivial inputs); `test:chainEval` updated (6 cases re-asserted to Cubism semantics).

**Open Phase 2b:** the `_warpSlopeX/Y` closed-form approximation for warp-parented rotation deformers (`canvasToInnermostX/Y` slope) still approximates the parent warp's local Jacobian instead of probing it via finite-difference like Cubism does. For shelby's smaller body-warp bbox this is ~5× off. Visual scrub on shelby will determine whether residual divergence justifies Phase 2b before that ships.

**Verify on shelby:** scrub `ParamBodyAngleX/Y/Z` and `ParamAngleX/Y/Z`. With Phase 2a the kernel matches Cubism's; remaining divergence is pure chain-composition (Phase 2b territory).

---

### BUG-004 — Initialize Rig leaves visual mesh and armature out of sync

- **Severity:** high
- **Reported:** 2026-04-30
- **Affects:** Pose workflow → re-rig handoff

**Repro:**

1. Import a character (e.g. `shelby_neutral_ok.psd`)
2. Pose the character — drag bones, set `ParamAngleX`, etc. so the visible character is in a non-rest pose
3. Click "Initialize Rig" (or whichever operator runs the rig builder again)
4. Observe: **visual mesh parts snap back to rest pose**, but the **armature / skeleton overlay stays in the posed transform**

End state: armature shows posed bones (rotated joints, moved pivots) over a mesh that's drawn at rest. Two views of the same project disagree.

**Suspects (not verified):**

1. Initialize-Rig operator only resets one of the two pipelines:
   - **Visual side** — re-runs mesh sampling / weights / draw-buffer regen → falls back to rest-pose verts
   - **Armature side** — keeps current `ParamAngleX/Y/Z` + rotation deformer values intact because they live in `paramValuesStore` / pose draft, not in the rig spec
2. Or vice-versa: the armature's bone-pivot positions get re-derived from current rig spec while mesh draw uses cached rest verts.
3. Possibly the operator should call `captureRestPose` / clear pose draft / reset `paramValues` before rebuilding.

**Next steps:**

1. Find the "Initialize Rig" operator — likely in `src/v3/operators/registry.js` or a rig-builder action.
2. Trace what it touches: project nodes, rigSpec, paramValues, animation draft pose, skeletonOverlay state.
3. Confirm whether the desync is "mesh resets, armature doesn't" or "mesh stays posed, armature resets to rest" — user reports the former, but verify in the actual code path.

**What "fixed" looks like:** after Initialize Rig, the visible character + armature both show the same pose (most natural: both reset to rest, since rig-init implies "rebuild from scratch"). The user can then re-pose if they want.

**Notes:** Related to GAP-006 (no reset-to-rest button) — if the user had a one-click way to clear the pose before clicking Initialize Rig, this desync would never appear in practice. But the underlying bug is still real and should be fixed at the operator level, not papered over with UI.

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

### BUG-008 — Bone-move + Initialize Rig leaves the moved layer visually frozen (no param can move it)

- **Severity:** high
- **Reported:** 2026-04-30
- **Affects:** Pose → re-rig handoff (sister bug to BUG-004)

**Repro:**

1. Import a character (e.g. `shelby_neutral_ok.psd`)
2. Drag a single bone — the layer attached to that bone visibly moves
3. Click **Initialize Rig**
4. Try to move that same layer via any parameter (`ParamAngleX`, `ParamBodyAngleX`, anything that should drive it)
5. Observe: **the layer is completely frozen** — no parameter affects it visually

End state: the layer stays painted at whatever pose it was in when Init Rig fired, regardless of param values. Other (non-bone-moved) layers still respond to params normally.

**Suspects (not verified):**

1. **Bone transform got baked into rest verts on Init Rig**, but the param→deformer rigging that should drive the layer was rebuilt without that layer in any chain. So the rest pose absorbs the displacement and the layer is no longer wired to any deformer.
2. **Re-init wiped the layer's `boneWeights` / `parentDeformerGuidRef`** — Initialize Rig may iterate only over layers it auto-recognises and skip layers it considers "user-modified". The skipped layer ends up rigless.
3. **Pose draft + rest pose merged in the wrong direction** — the bone move was committed into the project as if it were a rest-pose edit, then Init Rig captured that as the new rest, but the deformer chain regenerator emitted a chain from the OLD layer positions. Mismatch → layer stuck at its mid-pose location with no driver.

**Next steps:**

1. Find the Initialize Rig operator (same code path as BUG-004 — likely `src/v3/operators/registry.js` or a rig builder action). Trace what happens to a layer's `boneWeights`, `parentDeformerGuidRef`, and rest verts when the operator runs after a bone-move.
2. Repro on shelby_neutral_ok.psd, pick a single bone (e.g. left arm), move it 50px, click Init Rig, then attempt every param. Confirm the layer is fully unrigged vs. partially rigged.
3. Same instrumentation pattern as BUG-002: route Init Rig's per-layer decisions through `lib/logger.js` (source: `'rigInit'`) — log which layers are kept vs rebuilt vs orphaned. Then we'll see in the panel exactly what happened to the frozen layer.

**Notes:** This is a strict superset of BUG-004 — that one is "armature shows posed, mesh resets to rest"; this one is "after Init Rig, the visual is forever stuck". Both tell us the rig-init operator is not idempotent over the pose-state pair (rest verts, current pose). Fix should make Init Rig a clean reset: clear pose draft → rebuild rig from rest verts → all layers wired to their auto-detected deformer chain.

---

### BUG-010 — Iris Offset controller becomes useless after Init Rig (drives nothing)

- **Severity:** high
- **Reported:** 2026-04-30
- **Affects:** Properties / Parameters → Iris Offset 2D pad

**Repro:**

1. Import `shelby_neutral_ok.psd`, run the wizard
2. **Before** clicking Initialize Rig: drag the Iris Offset pad — irises move, pupils track. Working as expected.
3. Click **Initialize Rig**
4. **After** Init Rig: drag the Iris Offset pad — irises don't move at all. The controller is dead.

**Suspects (not verified):**

1. **Init Rig overwrites the iris rig with a regenerated chain that doesn't bind to `ParamEyeBallX/Y`** (the params Iris Offset writes to). Heuristic rebuild may produce a different deformer chain than the wizard's iris-rotation deformer, and the new chain isn't wired to the same params.
2. **The iris RotationDeformer's keyforms get wiped during seeding.** `seedAllRig` may pass a fresh rigSpec where the iris deformer exists structurally but with empty keyforms, so the pad's writes have no effect.
3. **Param ID mismatch after reseeding.** Iris Offset controller writes to `ParamEyeBallX`; init-rig may emit `ParamEyeBallX2` or an alternate ID, leaving the controller writing into a phantom param.

**Next steps:**

1. Repro on shelby_neutral_ok.psd. After Init Rig, check `useParamValuesStore.values` keys before/after — does `ParamEyeBallX` exist? Has the value been written when the user drags the pad?
2. Check the harvest in `initializeRigFromProject` — is the iris RotationDeformer present in `rigSpec.rotationDeformers`? Are its keyforms populated?
3. Compare `project.rigWarps` / `project.rotationDeformers` snapshot before vs after Init Rig — the seeder may be replacing a working deformer with a broken one.
4. Same instrumentation pattern: log iris-deformer harvest results through `lib/logger.js` (source: `'rigInit'`) to see in the panel exactly what changed.

**Notes:** Sister to BUG-008 (frozen layer after bone-move + Init Rig). Both fit the pattern "Init Rig clobbers something the user just had working." Suggests the rebuild path is destructive rather than additive — fix likely needs to either preserve user-customised deformers or rebuild ALL deformers from a known-good template (not partial overwrite).

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
