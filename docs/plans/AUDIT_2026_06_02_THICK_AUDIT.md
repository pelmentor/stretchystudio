# Thick audit — 2026-06-02

**Goal:** lock down what's left so the program becomes a workhorse per all standing rules.

**How:** Workflow `wf_b2f8512a-445` ran 6 parallel finders (RULE-№1, RULE-№2, RULE-№4, architecture, tests, bugs+plans) → each finding verified by 3 adversarial lens-agents (existence / severity / context, default refuted=true) → survives only if ≤1 of 3 refutes → completeness critic.

**Result:** 72 raw findings → **36 confirmed / 36 refuted** (50 % pass rate). 223 agents, ~10 M tokens, 23 min.

## Status legend

- `[ ]` open — needs work
- `[~]` in-progress
- `[x]` shipped (commit SHA in trailing comment)
- `[-]` won't-do (with rationale)

---

## Per-dimension stats

| Dimension | Confirmed | Refuted |
|-----------|-----------|---------|
| RULE-№1 (silent fallbacks) | **11** | 4 |
| RULE-№2 (migration baggage) | **8** | 4 |
| RULE-№4 (Blender parity) | **5** | 6 |
| Architecture | **5** | 5 |
| Tests | **3** | 7 |
| Bugs + Plans | **4** | 10 |
| **Total** | **36** | 36 |

---

## RULE-№1 — silent fallbacks, NaN-passthrough, fix-later (11)

### HIGH

- [ ] **rule-1-08** — [src/anim/depgraph/kernels/bonePostChain.js:141](../../src/anim/depgraph/kernels/bonePostChain.js#L141) — NaN-pass-through in bonePostChain pose-channel reads
  - `pose?.rotation ?? 0`, `pose?.x ?? 0`, `pose?.scaleX ?? 1` — `??` only triggers on null/undefined, so a NaN-poisoned pose channel flows through into `makeBoneLocalMatrix` producing NaN matrices.
  - Same failure mode as Shelby invisible-bones (commit `94ae9f5`, memory `shelby_invisible_bones_fix_2026_05_25`), but at the eval site. Use `Number.isFinite(v) ? v : 0` per `feedback_typeof_nan_is_number`.
  - refuted: 1/3

- [ ] **rule-1-04** — [src/anim/driver.js:131](../../src/anim/driver.js#L131) — NaN-pass-through in driver variable resolution
  - `typeof value === 'number' ? value : Number(value) || 0` — first branch passes NaN through (typeof NaN === 'number'); second silently masks `Number(undefined)=NaN`, `Number({})=NaN`, `Number('')=0` into a silent 0. Also line 127 silently defaults to 0 when project is missing.
  - Per [src/anim/driver.js:22-24,137-139](../../src/anim/driver.js#L22) the file's own contract is "invalid → NaN → FCurve falls back to keyframe value". Lines 127/131 violate that.
  - refuted: 0/3

- [ ] **rule-1-02** — [src/anim/constraints.js:166](../../src/anim/constraints.js#L166), [:353](../../src/anim/constraints.js#L353) — silent identity-transform on missing node
  - `effectiveTransform()` and `evaluateConstraints()` return identity `{x:0,y:0,rotation:0,scaleX:1,scaleY:1}` when owner/node is null. Constraint owner being null is a graph wiring bug — should fail loud. Plus 5 × `?? 0/?? 1` on lines 171-184 leak NaN.
  - refuted: 1/3

- [ ] **rule-1-06** — [src/services/RigService.js:278](../../src/services/RigService.js#L278), [:461](../../src/services/RigService.js#L461), [:567](../../src/services/RigService.js#L567), [:586](../../src/services/RigService.js#L586) — triple silent texture-load swallow
  - Three sibling `try { … loadProjectTextures(…) … } catch (_err) { /* textures missing — proceed without */ }` blocks drop decode/OOM errors silently. Line 586: `try { restorePose(snapshot); } catch (_e) { /* swallow */ }` literally labeled "swallow".
  - refuted: 1/3

### MEDIUM

- [ ] **rule-1-09** — [src/anim/depgraph/kernels/matrix.js:72](../../src/anim/depgraph/kernels/matrix.js#L72), [:110-116](../../src/anim/depgraph/kernels/matrix.js#L110) — NaN-pass-through in canvas-final matrix builder
  - `(setup.effectiveAngleDeg ?? 0)`, `(setup.scale ?? 1)` — NaN slips through `??`, producing NaN matrix entries that cascade through compose.
  - refuted: 1/3

- [ ] **rule-1-10** — [src/io/exportSpine.js:134](../../src/io/exportSpine.js#L134), [:179](../../src/io/exportSpine.js#L179) — Spine exporter `|| 0` on rotation drops NaN to identity
  - `rotation: -(t.rotation || 0)` — `||` triggers on NaN, 0, and undefined alike. Exporting a Spine file with NaN transform should fail loud.
  - refuted: 1/3

- [ ] **rule-1-11** — [src/v3/operators/weightPaint/sample.js:118](../../src/v3/operators/weightPaint/sample.js#L118), normalize.js:109, blur.js:130, [src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx](../../src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx) :242/:394/:395/:396/:413 — `Number(...) || 0` silently coerces NaN
  - Active weight-paint group corruption is masked. 7 sites in total.
  - refuted: 0/3

- [ ] **rule-1-14** — [src/v3/shell/FileMenu.jsx:83](../../src/v3/shell/FileMenu.jsx#L83), [ApplyMenu.jsx:111](../../src/v3/shell/ApplyMenu.jsx#L111), [CanvasContextMenu.jsx:123](../../src/v3/shell/CanvasContextMenu.jsx#L123), [MergeMenu.jsx:95](../../src/v3/shell/MergeMenu.jsx#L95), [SnapMenu.jsx:94](../../src/v3/shell/SnapMenu.jsx#L94), [ClearParentMenu.jsx:69](../../src/v3/shell/ClearParentMenu.jsx#L69), [CommandPalette.jsx:114](../../src/v3/shell/CommandPalette.jsx#L114) — operator-exec only `console.error`
  - 7 menu invokers catch failures with bare `console.error`. No `logger.error`, no toast — failed user-invoked operator is indistinguishable from successful no-op.
  - refuted: 0/3

- [ ] **rule-1-05** — [src/v3/editors/timeline/TimelineEditor.jsx:124](../../src/v3/editors/timeline/TimelineEditor.jsx#L124) — `try { src.stop() } catch (_) {}` swallows AudioBufferSourceNode.stop errors with zero comment / log / escalation
  - refuted: 1/3

- [ ] **rule-1-07** — [src/v3/editors/timeline/TimelineEditor.jsx:118](../../src/v3/editors/timeline/TimelineEditor.jsx#L118) — audio decode error fire-and-forget: `.catch(e => console.error(…))` — no toast, no logger.error, no UI escalation
  - refuted: 1/3

- [ ] **rule-1-12** — [src/v3/editors/logs/LogsEditor.jsx:118](../../src/v3/editors/logs/LogsEditor.jsx#L118) — `catch (_err2) { /* ignore */ }` on `execCommand('copy')`; `setCopied(true)` fires BEFORE the catch → false success feedback to user
  - refuted: 1/3

---

## RULE-№2 — migration baggage, shims, deferred-forever (8)

### HIGH

- [ ] **rule-2-08** — [src/io/live2d/rig/synthesizeDeformerNodesForExport.js:350](../../src/io/live2d/rig/synthesizeDeformerNodesForExport.js#L350) — Phase 3.B/3.C dual-storage: modifier.data + node.type==='deformer'
  - v28 Phase 3.A folded deformer-node state INTO modifier.data; Phase 3.B (export pipeline reads through getModifierData) shipped. Phase 3.C ("delete the standalone deformer nodes") still cited across 13 files, effectively superseded by v43 lattice substrate. Codebase carries: (a) BOTH project.nodes deformer entries AND modifier.data copies, (b) a synthesizeDeformerNodesForExport orphan-fallback whose comment "will disappear after Phase 3.C" became aspirational.
  - refuted: 0/3

### MEDIUM

- [ ] **rule-2-04** — [src/v3/editors/outliner/treeBuilder.js:185](../../src/v3/editors/outliner/treeBuilder.js#L185) — `RIG_PSEUDO_ROOT_ID = null` kept "for third-party consumers"; SS has none. Grep: only the declaration line itself.
  - refuted: 0/3

- [ ] **rule-2-06** — [src/v3/editors/outliner/treeBuilder.js:22](../../src/v3/editors/outliner/treeBuilder.js#L22) — `'hierarchy'` outliner mode kept "for back-compat with existing tests"; 0 src/ consumers. Production uses `'viewLayer'` (identical per comment).
  - refuted: 0/3

- [ ] **rule-2-10** — [src/renderer/animationEngine.js:78](../../src/renderer/animationEngine.js#L78) — `evaluateEasing(t, interpolation)` back-compat stub with zero callers anywhere.
  - refuted: 0/3

- [ ] **rule-2-11** — [src/store/preferencesStore.js:303](../../src/store/preferencesStore.js#L303) — `lastToolByMode` legacy key rewrite runs on every load with no version gate. Either gate via localStorage version-migration OR drop the legacy keys (last seen in user data ~2026-05-07).
  - refuted: 1/3

### LOW

- [ ] **rule-2-01** — [src/modes/modeCompat.js:120](../../src/modes/modeCompat.js#L120) — `MODE_BLEND_SHAPE = MODE_EDIT` @deprecated alias. v26 migration retired the data shape. Only consumer: `ModePill.jsx:55` (purely symbolic, never compared as runtime value).
  - refuted: 0/3

- [ ] **rule-2-02** / **rule-4-11** — [src/modes/modeCompat.js:101-103](../../src/modes/modeCompat.js#L101) — `MODE_EDIT_MESH = MODE_EDIT` @deprecated alias. Grep: only the declaration line. Test fixtures only.
  - refuted: 0/3

- [ ] **rule-2-03** — [src/lib/snap/snapMath.js:287](../../src/lib/snap/snapMath.js#L287) — `computeSelectionAnchor` @deprecated "kept for one release so legacy tests don't break". Production uses `pickSelectionAnchor`. Index barrel re-exports it from [src/lib/snap/index.js:27-31](../../src/lib/snap/index.js#L27).
  - refuted: 0/3

---

## RULE-№4 — Blender parity gaps (5)

### HIGH

- [ ] **rule-4-03** — [src/anim/depgraph/kernels/animation.js:71](../../src/anim/depgraph/kernels/animation.js#L71) — FCurve Modifiers bypassed by ANIMATION_TRACK_EVAL kernel
  - `ANIMATION_TRACK_EVAL` calls `interpolateTrack(fc.keyforms ?? [], ctx.timeMs ?? 0, …)` directly, which does NOT apply fmodifiers. Substrate ([src/anim/fmodifiers.js](../../src/anim/fmodifiers.js)), evaluator path ([src/anim/fcurve.js evaluateFCurve](../../src/anim/fcurve.js#L211)), UI panel ([src/v3/editors/fcurve/FCurveModifiersPanel.jsx](../../src/v3/editors/fcurve/FCurveModifiersPanel.jsx)) all exist but never apply during viewport playback.
  - **Impact:** Cycles, Noise, Generator, Limits, Stepped, Envelope appear in UI but do nothing in viewport. Significant Blender-parity hole.
  - refuted: 0/3

- [ ] **rule-4-04** — [src/anim/depgraph/kernels/animation.js:71](../../src/anim/depgraph/kernels/animation.js#L71) — FCurve drivers bypassed by ANIMATION_TRACK_EVAL kernel
  - Sister to rule-4-03. `evaluateFCurve` (fcurve.js:211) checks `if (fcurve.driver)` and dispatches `evaluateDriver` (Blender wins-over-keyframe semantics). `kernelAnimationTrackEval` calls `interpolateTrack` directly → driver-decorated fcurve never fires during full action playback.
  - refuted: 0/3

- [ ] **rule-4-05** — [src/services/ArmatureModifierService.js:135](../../src/services/ArmatureModifierService.js#L135) — Apply Armature bypasses TRANSFORM_COMPOSE → drops constraints
  - `computeBoneWorldMatrices(project.nodes)` reads `node.pose` directly via `getBonePose` ([boneOverlayMatrix.js:102](../../src/renderer/boneOverlayMatrix.js#L102)), bypassing `TRANSFORM_COMPOSE`. Any `COPY_ROTATION` / `TRACK_TO` / `LIMIT_ROTATION` constraint on a bone is IGNORED at Apply bake time but RESPECTED during viewport playback → Apply silently disagrees with the viewport.
  - refuted: 0/3

### MEDIUM

- [ ] **rule-4-07** — [src/anim/modifierTypeInfo.js:177](../../src/anim/modifierTypeInfo.js#L177) — Lattice modifier missing Blender's `strength: float` + `vertex_group: string`
  - Blender's `LatticeModifierData` (DNA_modifier_types.h:282) carries `strength` (0..1 influence) + optional vertex-group filter. SS's lattice modifier has no strength, no vgroup. `deformVerts` applies the bilinear unconditionally → blocks soft-deform authoring.
  - refuted: 0/3

---

## Architecture (5)

### HIGH

- [ ] **arch-03** — [src/v3/editors/fcurve/FCurveEditor.jsx:621](../../src/v3/editors/fcurve/FCurveEditor.jsx#L621) — `Plot` subcomponent is 2700 LOC inside a 4435-LOC editor
  - SVG layout + canvas-2D draws + ResizeObserver + keyboard router + modal G/S/B + axis-lock + handle drag + banner gating in one function spanning lines 621-3310. Sibling `Sidebar` is 687 LOC.
  - refuted: 0/3

- [ ] **arch-01** — [src/v3/operators/registry.js:148](../../src/v3/operators/registry.js#L148) — `registerBuiltins()` 2037 LOC, 78 operator registrations inline
  - The pattern already knows how to delegate (latest insertKey was split out via `registerInsertKeyOperators(…)`) but 13 phase blocks stay inline. Editors pull in 35+ store imports through this registry.
  - refuted: 1/3

- [ ] **arch-02** — [src/components/canvas/CanvasViewport.jsx:125](../../src/components/canvas/CanvasViewport.jsx#L125) — 3794-LOC component, 30+ hooks, 559 binding sites
  - Owns rendering + input + hit-test + drag + gestures + GL + brush + mesh worker pool. Missing `@ts-check`.
  - refuted: 1/3

### MEDIUM

- [ ] **arch-08** — [src/io/live2d/rig/selectRigSpec.js](../../src/io/live2d/rig/selectRigSpec.js) (1168 LOC) + [src/io/live2d/rig/buildRigSpecFromCmo3.js](../../src/io/live2d/rig/buildRigSpecFromCmo3.js) (646 LOC) — duplicate rig builders
  - Near-identical helpers `_computeRestState`, `_liftWarpToCanvasAtRest`, `_computeRotationCanvasPivotAtRest`. After chainEval retirement + RULE-№4 (Cubism byte-fidelity not a hard blocker), `buildRigSpecFromCmo3` can converge into `selectRigSpec`.
  - refuted: 1/3

### LOW

- [ ] **arch-10** — Stale chainEval / evalRig doc baggage in 11+ files after 2026-05-26 retirement
  - [src/renderer/bonePostChainComposition.js:6](../../src/renderer/bonePostChainComposition.js#L6), [src/io/live2d/rig/selectRigSpec.js:9](../../src/io/live2d/rig/selectRigSpec.js#L9), [src/renderer/hitTest.js:120](../../src/renderer/hitTest.js#L120), [src/renderer/scenePass.js:88](../../src/renderer/scenePass.js#L88), and more.
  - refuted: 0/3

---

## Tests (3)

### HIGH

- [ ] **test-01** — [src/store/migrations/v32_strip_rigid_default_weights.js](../../src/store/migrations/v32_strip_rigid_default_weights.js) — no direct behavior test
  - 107 LOC walks meshed parts, runs `isRigidVertexGroup`, deletes `boneWeights`+`jointBoneId`, removes orphan armature modifiers. `test_migrations.mjs` has zero `boneWeights`/`jointBoneId` references.
  - refuted: 0/3

### MEDIUM

- [ ] **test-05** — `tsconfig.json` — 149/515 src .js/.jsx files (29 %) opt out of @ts-check
  - Critical unchecked giants: `src/store/projectStore.js` (1955 LOC, most-imported), `src/store/projectMigrations.js` (1192 LOC, migration walker root), `src/io/live2d/rig/selectRigSpec.js` (1168 LOC), `src/io/live2d/cmo3writer.js` (1135 LOC).
  - refuted: 1/3

- [ ] **test-07** — [scripts/test/test_initRigShelbyBoneNaN.mjs:206](../../scripts/test/test_initRigShelbyBoneNaN.mjs#L206) — reproducer exit-0 on empty findings is not a pinned assertion
  - Iteration loop could silently skip every node; test passes. Pin positive assertions (bone count ≥ N, specific pivot values).
  - refuted: 1/3

---

## Bugs + Plans (4)

### HIGH

- [ ] **bug-03** — Shelby handwear-l/r huge bbox (I-9 still fires); I-14/I-15 implemented but user hasn't re-run Init Rig
  - Resume-hint resolution branch table waits on a fresh run. See [docs/plans/SESSION_AGGREGATE_2026_05_26_CHAINEVAL_RETIREMENT.md](SESSION_AGGREGATE_2026_05_26_CHAINEVAL_RETIREMENT.md).
  - refuted: 0/3

- [ ] **bug-01** — BUG-015 BodyAngle X/Y/Z sliders unresponsive in Live Preview — instrumented, awaiting user drag-repro
  - 2026-05-02 17:49 instrumented repro had zero `paramRow` events (user did not actually drag a slider). Status `🔬` since 2026-05-08.
  - refuted: 1/3

### MEDIUM

- [ ] **plan-09** — Post-Export Polish items #1-#4 still ⏳ planned
  - (1) N-panel toggle overlaps Reset Pose cluster; (2) Object Mode lets user rotate bones via arc handles (inverted gates in [SkeletonOverlay.jsx:866](../../src/v3/editors/viewport/overlays/SkeletonOverlay.jsx#L866), [:309](../../src/v3/editors/viewport/overlays/SkeletonOverlay.jsx#L309)); (3) Apply Pose As Rest button should live next to ModePill; (4) Pre-rig Apply Pose As Rest leaves parts at PSD position. Estimated combined ~30-60 min. See [docs/plans/POST_EXPORT_POLISH.md](POST_EXPORT_POLISH.md).
  - refuted: 1/3

### LOW

- [ ] **bug-04** — Stale `console.log` in [src/components/canvas/CanvasViewport.jsx:1681](../../src/components/canvas/CanvasViewport.jsx#L1681) — only direct `console.log(` in src/; migrate to `logger.info` per `feedback_in_app_logging`.
  - refuted: 0/3

---

## Refuted findings (35 — for completeness)

These were caught by the 3-lens verify and dropped. Listed here so future audits don't re-raise the same claims:

| Dim | ID | File | Why refuted |
|-----|----|------|-------------|
| rule-1 | rule-1-01 | src/anim/depgraph/kernels/physics.js:53 | typeof `===` 'number' is the upstream Cubism oracle contract (justified) |
| rule-1 | rule-1-03 | src/lib/snap/snapMath.js:37 | delta arg is internally produced from finite math; not external boundary |
| rule-1 | rule-1-13 | src/store/projectStore.js | guards documented at canonical mutation boundary |
| rule-1 | rule-1-15 | various | re-raise of upstream-handled cases |
| rule-2 | rule-2-05/07/09/12 | scattered | actually live, mis-cited, or actively maintained |
| rule-4 | rule-4-01/02/06/08/09/10 | scattered | mis-cited Blender semantics or feature gaps that map to deliberate SS scope |
| arch | arch-04/05/06/07/09 | scattered | size justified by single responsibility (moc3 writer etc.) |
| tests | test-02/03/04/06/08/09/10 | scattered | migrations have indirect coverage via `test_migrations.mjs` chain |
| bugs | bug-02/05–14 / plan-01–08/10 | scattered | already shipped, or no actual repro / not blocking |

Full list with refute-reasons preserved in workflow transcript `wf_b2f8512a-445`.

---

## Missing modalities — next-round seed

Completeness critic flagged classes of issue the 6-dimension run did not cover. **Run a second workflow** when these become priority:

- **Perf / GPU lifecycle** — 12 `URL.createObjectURL` vs 10 revoke sites; `FCurveEditor.Plot` bundle cost; `moc3 binaryWriter._buf` O(N) push per byte
- **Data integrity** — `src/io/projectFile.js` explicitly documents a "silent partial-save mode" (soft RULE-№1 violation by design); 13 `JSON.parse` sites without schema validation
- **Security** — `blob:` / `URL.createObjectURL` lifecycle, CSP / SRI, `JSON.parse` on untrusted `.stretch` ZIPs
- **Workers** — 7 worker files (psd, psdFinalize, mesh) — no audit on message-schema / error propagation / pool-size limits
- **Undo memory** — `src/store/undoHistory.js` holds live immer refs, MAX_HISTORY=50, no ceiling test
- **Animation tick re-entrancy** — `animationStore` + rAF + 30 `setTimeout`/`setInterval` sites
- **i18n** — only 5 v3 files reference `t()` vs 38 with `aria-*` → partial localisation
- **Accessibility** — no audit on missing labels for canvas overlays / modals
- **22 try/catch swallow sites** in src/ — only TimelineEditor surfaced; rest unflagged
- **Source unread** — `src/anim/depgraph/build.js + eval.js` (depgraph core; only kernels audited), `src/io/live2d/cmo3/*` (35 files; only 1 finding), `src/io/live2d/moc3/binaryWriter.js`, `src/store/projectStore.js` (immer root, 17 localStorage refs), `src/services/PersistenceService.js + projectDb.js`, `src/io/psd.worker.js + psdFinalize.worker.js + mesh/worker.js`, `src/lib/swRegister.jsx` (PWA SW)

---

## Decision log

- **2026-06-02** — workflow shipped, 36/72 findings confirmed. Tracking doc opens. First fix target: `rule-1-08` (bonePostChain NaN) as smallest delta to highest-impact RULE-№1 class (same family as the Shelby invisible-bones source fix).
