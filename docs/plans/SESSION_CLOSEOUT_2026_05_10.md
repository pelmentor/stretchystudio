# Session Close-out — 2026-05-10

Fresh-session resume entry point. Branch clean at `ee2b1c5`.

## What shipped today (10 commits)

### Animation Blender-Parity Plan — Phase 0
Five sub-phases + armature port + audit-fix sweep:

| Commit  | What |
|---------|------|
| `ec5d7d3` | 0.A — gridLift / depgraph build-relation fix |
| `ad7f26a` | 0.B — driver pass wired into CanvasViewport tick |
| `0386a6a` | 0.C — TRANSFORM_COMPOSE op for constraint composition |
| `c8f86f3` | 0.D.0 — depgraph wired into CanvasViewport rAF (`evalEngine` flag) |
| `bc8a875` | 0.D armature port — bone post-chain inside ART_MESH_EVAL |
| `10ecaa8` | docs(plan) — Phase 0 close-out |

### Toolset Blender-Parity Plan — Phases 0 + 1
Foundation + first feature cluster:

| Commit  | What |
|---------|------|
| `4a59d62` | Phase 0 — vertex selection model in Edit Mode (79 test assertions) |
| `f7fba11` | Phase 1 — box / lasso select in Object + Edit Mode (65 test assertions) |

### Audit-fix sweep (post-ship)
Two independent agents audited both plans; 6 HIGH bugs caught and closed:

| Commit  | What |
|---------|------|
| `ee2b1c5` | 6 HIGH bugs + 2 MED gaps + doc-drift sweep + 23-assertion regression suite |

## Audit-driven fixes in `ee2b1c5`

**Animation HIGH:**
- `EvalContext.time → timeMs` rename (promised by §0.0 + §0.D.0, never done). All kernels rebased; `evalProjectFrameViaDepgraph` now propagates `animation` + `currentTime` from CanvasViewport — depgraph branch's animation kernels were dead code at hardcoded `time:0`.
- `transformCompose.overlayTransform()` for bones now subtracts pivot before writing pose. Was: bone-target-bone constraint chains doubled the pivot offset (latent — chain test used non-bone groups so bug was hidden).

**Toolset HIGH:**
- Lasso always-subtract — Ctrl was the gesture-starter and still held at release; modifier read at commit always evaluated to `subtract`. Fixed by capturing modifier intent at gesture start (`gestureModifier` in lasso-candidate + `boxSelectStore`).
- Edit-Mode lasso-from-empty-canvas blocked — Ctrl+LMB on empty canvas fell into the `idx===-1` deselect-all branch. Fixed by hoisting Ctrl+LMB candidate ABOVE the deselect.
- `dispatchMeshWorker` missing `invalidateVertexSelectionForPart` after `setMesh()` — stale vertex indices after a remesh.

**Toolset MED:**
- Mid-drag `A` "select all under" toggle (plan §1.A) — Object Mode → all visible parts; Edit Mode → all verts of active part; Shift+A composes.
- 3 read-only editorStore helpers (plan §0.A) — `isVertexSelected`, `getSelectedVertexCount`, `getAllSelectedVertices`.

**Doc-drift:**
- `preferencesStore.js` — stale "no production effect" claims removed (contradicted 0.D.0 + 0.D ship)
- `build.js` — stale "TRANSFORM op reserved... Phase D-3a will populate it" comment removed (Phase 0.C populates it)
- `captureStore.js` + `CanvasViewport.jsx` — stale plural `BoxSelectOverlay/LassoSelectOverlay` references updated
- `BoxSelectOverlay.jsx` — lying "active vertex cleared" comment replaced with actual `deselectVertex` call
- Animation plan exit checklist + grievance map — Phase 0.E AnimationTree dual-write references removed (dropped in v2 audit)

## Audit docs on disk

- [AUDIT_2026_05_10_ANIMATION.md](./AUDIT_2026_05_10_ANIMATION.md) — 15 gaps total, 3 HIGH addressed
- [AUDIT_2026_05_10_TOOLSET.md](./AUDIT_2026_05_10_TOOLSET.md) — 17 gaps total, 3 HIGH + 2 MED addressed

## Deliberately deferred (per Rule №1 — no quick fixes)

- `selection.lassoSelect` operator — gesture-only is fine; no command-palette use case yet
- §0.B driver-eval-count telemetry — LOW, no runtime impact
- §0.C integration test scope (2 of 4 constraint types) — landed under §0.C scope
- §0.A `test_depgraph_eval_rigwarp.mjs` per-part RigWarp_* test — covered narrower in `test_depgraphSideBySide_rotationParent.mjs`
- Browser-side manual gates 0.H + 1.F — still pending user

## Test scoreboard

All adjacent suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| editorStore | 87 |
| v3Operators | 63 |
| selectionStore | 23 |
| canvasToolbar | 85 |
| hitTest | 35 |
| vertexSelection_* (4 suites) | 79 |
| boxSelect_* / lassoSelect_* (4 suites) | 65 |
| audit_fixes_2026_05_10 | 23 |
| depgraph_eval_* (10 suites) | ~150 |
| depgraph_armature | 9 |

Pre-existing `test_armatureOrganizer.mjs` ReferenceError (`matchTag is not defined` at line 640) is unrelated to today's work — reproduces on clean master from a prior session.

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

The depgraph is now coherent post-audit-fix — running the manual byte-fidelity sweep is meaningful (was previously validating a depgraph missing animation/FCurve eval and a bone-chain pivot bug).

1. Toggle `preferencesStore.evalEngine = 'depgraph'` in app.
2. Load `shelby_neutral_ok.psd` + `test_image4.psd`.
3. Verify visually + export `.cmo3` and byte-diff against `'classic'` baseline.
4. Flip [preferencesStore.js:163](../../src/store/preferencesStore.js#L163) default `'classic'` → `'depgraph'`. Keep classic opt-out one release.
5. Then Animation Phase 1 (1.5wk fresh session) — Action datablock + NodeTree retirement + 8-consumer `project.animations[]` migration.

### B. Toolset Phase 2 — Snap to grid / vertex (~3-4 days)

- Touches `ModalTransformOverlay.applyDelta` to consult a new `snap` slot in preferencesStore.
- Snap-to-grid: replace current `Math.round(delta / 10) * 10` with `Math.round(delta / increment) * increment`.
- Snap-to-vertex via spatial hash over all rest verts (cached + invalidated on topology change).
- N-panel gains a Snap section (master toggle + per-mode + target dropdown).
- See [TOOLSET_BLENDER_PARITY_PLAN.md](./TOOLSET_BLENDER_PARITY_PLAN.md) §Phase 2.

### C. Manual browser gates (Phase 0.H + 1.F)

Should be verified before further phases ship. See [TOOLSET_PHASE_0_PROGRESS.md](./TOOLSET_PHASE_0_PROGRESS.md) §Manual gate (8 items) and [TOOLSET_PHASE_1_PROGRESS.md](./TOOLSET_PHASE_1_PROGRESS.md) §Audit-driven follow-up.

## Hotkey reservations across both plans

- `I` = Insert Keyframe (animation Phase 6)
- `B` = Box Select (toolset Phase 1) ✅ shipped
- `C` = Circle Select (toolset Phase 6)
- `Shift+X` = Sample Weight (toolset Phase 7.B)
- `Ctrl+Shift+M` = Pose select-mirror (Blender-faithful)
- `Ctrl+Shift+V` = Mirror Pose (paste-flipped, Blender-faithful)
- `Ctrl+N` NOT bound (collides with Blender File New)
- `Alt+Shift+G/R/S` = Clear All Pose per-axis (3 separate chords, Blender-faithful)
