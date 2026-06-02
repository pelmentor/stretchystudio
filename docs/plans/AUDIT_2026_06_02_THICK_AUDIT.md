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

- [x] **rule-1-08** — [src/anim/depgraph/kernels/bonePostChain.js:141](../../src/anim/depgraph/kernels/bonePostChain.js#L141) — NaN-pass-through in bonePostChain pose-channel reads — shipped `17028c8` (Claude) + refactored to shared `finiteOr` in `59b43f2`
- [x] **rule-1-04** — [src/anim/driver.js:131](../../src/anim/driver.js#L131) — NaN-pass-through in driver variable resolution — shipped `be4f2d7` (Pelmentor). `resolveVariables` now writes NaN on missing project / unparseable value per the FCurve-fallback contract.
- [x] **rule-1-02** — [src/anim/constraints.js:166](../../src/anim/constraints.js#L166), [:353](../../src/anim/constraints.js#L353) — silent identity-transform on missing node — shipped `4f69207` (Pelmentor). Null inputs throw; 10 `??` channel reads moved to `finiteOr`.

- [x] **rule-1-06** — [src/services/RigService.js:278](../../src/services/RigService.js#L278), [:461](../../src/services/RigService.js#L461), [:567](../../src/services/RigService.js#L567), [:586](../../src/services/RigService.js#L586) — triple silent texture-load swallow + restorePose swallow — shipped `6fb5623` (Claude). All four catches now `logger.warn(...)` with structured payload; rig init still proceeds (bin-max sampling fallback).

### MEDIUM

- [x] **rule-1-09** — [src/anim/depgraph/kernels/matrix.js:72](../../src/anim/depgraph/kernels/matrix.js#L72), [:110-116](../../src/anim/depgraph/kernels/matrix.js#L110) — NaN-pass-through in canvas-final matrix builder — shipped `59b43f2` (Claude). `buildCanvasFinalMat3` + `buildLocalMat3` use `finiteOr` for all 12 numeric reads (angle, scale, opacity, pivot, origin). Shared helper introduced at [src/lib/finiteOr.js](../../src/lib/finiteOr.js).

- [ ] **rule-1-10** — [src/io/exportSpine.js:134](../../src/io/exportSpine.js#L134), [:179](../../src/io/exportSpine.js#L179) — Spine exporter `|| 0` on rotation drops NaN to identity
  - `rotation: -(t.rotation || 0)` — `||` triggers on NaN, 0, and undefined alike. Exporting a Spine file with NaN transform should fail loud.
  - refuted: 1/3

- [x] **rule-1-11** — weightPaint `Number(x) || 0` NaN coercion across 7 sites — shipped `4fbe396` (Pelmentor). sample.js/normalize.js/blur.js + WeightPaintOverlay heatmap + brush all use `finiteOr(x, 0)`.
- [x] **rule-1-14** — operator-exec failures route through `logger.error` + `toast({variant:'destructive'})` across 8 sites (FileMenu, ApplyMenu, CanvasContextMenu, MergeMenu, SnapMenu, ClearParentMenu, CommandPalette + bonus Topbar) — shipped `ea3fca5` (Claude). New util [src/v3/operators/reportOpFailure.js](../../src/v3/operators/reportOpFailure.js).
- [x] **rule-1-05** + **rule-1-07** — TimelineEditor audio errors escalate to logger + toast (decode) / logger.warn (stop race) — shipped `e62976d` (Pelmentor).
- [x] **rule-1-10** — Spine exporter `requireFinite(…)` throws on NaN rotation/scale at lines 134/135/136/179 — shipped `bea0c4d` (Claude). Audit claim re false "Copied" was actually about the silent ignore, not the success-display.
- [x] **rule-1-12** — LogsEditor `catch (_err2) { /* ignore */ }` now surfaces destructive toast on execCommand failure — shipped `3de09d7` (Pelmentor).

---

## RULE-№2 — migration baggage, shims, deferred-forever (8)

### HIGH

- [ ] **rule-2-08** — [src/io/live2d/rig/synthesizeDeformerNodesForExport.js:350](../../src/io/live2d/rig/synthesizeDeformerNodesForExport.js#L350) — Phase 3.B/3.C dual-storage: modifier.data + node.type==='deformer' — **deferred** (large refactor; effectively superseded by v43 lattice substrate; 13 file touchpoints).

### MEDIUM

- [x] **rule-2-04** — `RIG_PSEUDO_ROOT_ID` retired — shipped `acd37e5` (Claude).
- [x] **rule-2-06** — `'hierarchy'` outliner mode retired (tests flipped to `viewLayer`) — shipped `acd37e5` (Claude).
- [x] **rule-2-10** — `evaluateEasing` retired (canonical dispatch via `evaluateBezTripleSegment` / `evaluateFCurve`) — shipped `acd37e5` (Claude).
- [ ] **rule-2-11** — [src/store/preferencesStore.js:303](../../src/store/preferencesStore.js#L303) — `lastToolByMode` legacy key rewrite runs on every load with no version gate — **deferred** (needs localStorage version-migration design).

### LOW

- [x] **rule-2-01** — `MODE_BLEND_SHAPE` retired (ModePill.jsx import dropped) — shipped `acd37e5` (Claude).
- [x] **rule-2-02** / **rule-4-11** — `MODE_EDIT_MESH` retired — shipped `acd37e5` (Claude).
- [x] **rule-2-03** — `computeSelectionAnchor` retired (snap/index.js barrel + snapMath.js + test_snap_target_modes.mjs) — shipped `acd37e5` (Claude).

---

## RULE-№4 — Blender parity gaps (5)

### HIGH

- [x] **rule-4-03** — `ANIMATION_TRACK_EVAL` evaluates FCurve Modifiers — shipped `e21fe54` (Pelmentor). Kernel swapped `interpolateTrack(…)` for `evaluateFCurve(fc, ctx.timeMs, { project: ctx.project })`; Cycles / Noise / Generator / Limits / Stepped / Envelope now drive viewport playback.
- [x] **rule-4-04** — `ANIMATION_TRACK_EVAL` evaluates Drivers — shipped `e21fe54` (Pelmentor) alongside rule-4-03. `evaluateFCurve` applies the driver-wins-over-keyframe semantics per Blender's eval order.
- [x] **rule-4-05** — `ArmatureModifierService.applyArmatureModifier` now consumes constraint-aware bone WORLD matrices from depgraph TRANSFORM_COMPOSE — shipped `282aba5` (Claude). `evalProjectFrameViaDepgraph` gained `opts.outBoneWorldMatrices` Map; ArmatureModifierService passes it instead of calling `computeBoneWorldMatrices`. COPY_ROTATION / TRACK_TO / LIMIT_ROTATION on bones are now honored at Apply bake time.

### MEDIUM

- [ ] **rule-4-07** — [src/anim/modifierTypeInfo.js:177](../../src/anim/modifierTypeInfo.js#L177) — Lattice modifier missing Blender's `strength: float` + `vertex_group: string` — **deferred** (substantial feature: schema + UI + migration + tests). Blender's `LatticeModifierData` (DNA_modifier_types.h:282) carries `strength` (0..1 influence) + optional vertex-group filter; `deformVerts` applies bilinear unconditionally → blocks soft-deform authoring.
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

- [x] **arch-10** — Top-of-file chainEval / evalRig docstrings reworded at the audit-cited high-visibility sites — shipped `a1205f6` (Pelmentor). Remaining 50+ deep-in-file historical comments tied to specific commits or phase-numbered migration history left as record.

---

## Tests (3)

### HIGH

- [x] **test-01** — v32 migration behavior test shipped — `b7b2188` (Claude). [scripts/test/test_v32_strip_rigid_default_weights.mjs](../../scripts/test/test_v32_strip_rigid_default_weights.mjs) — 19 assertions covering rigid-1.0 strip, varying-weights preserve, bone-routing-intent preserve, idempotency, defensive null/empty. Added to master chain as `test:migrationV32`.

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

- [x] **bug-04** — Stale `console.log` routed to `logger.info('skinning', …)` — shipped `a1205f6` (Pelmentor).

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

- **2026-06-02** — workflow shipped, 36/72 findings confirmed. Tracking doc opens.
- **2026-06-02** — eval-path NaN-safety sweep: 4 fixes shipped end-to-end.
  - `rule-1-08` bonePostChain (Claude `17028c8`)
  - `rule-1-04` driver.js (Pelmentor `be4f2d7`)
  - `rule-1-09` matrix.js + shared `finiteOr` helper at [src/lib/finiteOr.js](../../src/lib/finiteOr.js) (Claude `59b43f2`)
  - `rule-1-02` constraints.js: null inputs now throw; 10 channels moved to `finiteOr` (Pelmentor `4f69207`)
  - **Net:** depgraph eval-path is finite by contract end-to-end. The rigInvariantCheck framework (I-7 / I-12..I-15) remains the upstream loud-detector; these kernel fixes are the runtime safety net.
- **2026-06-02 (autonomous batch)** — RULE-№1 sweep closed end-to-end (11/11 confirmed); RULE-№2 metla closed (6/8 dead shims retired; rule-2-08 + rule-2-11 deferred); 3 high-severity RULE-№4 holes closed (rule-4-03 + rule-4-04 + rule-4-05); arch-10 + bug-04 housekeeping; test-01 v32 migration test added.
  - **Net:** **20 audit items closed** across 17 commits. Open: 16 items, of which 5 are explicitly deferred (refactor scope), 2 are blocked on user action (BUG-015 drag-repro, handwear bbox re-run for I-14/I-15), and the rest are smaller follow-ups (rule-4-07 Lattice strength/vgroup feature, arch splits 01/02/03/08, test-05 @ts-check sweep, test-07 NaN-test positive pins, plan-09 four small UX gates).
  - **Key end-state:** depgraph ANIMATION_TRACK_EVAL now drives FCurve Modifiers + Drivers in viewport (was silently bypassing); Apply Armature now respects bone constraints (was silently bypassing TRANSFORM_COMPOSE); 8 menu invokers now surface failures via logger + toast (was console.error-only); eval-path is finite end-to-end with the rigInvariantCheck framework as upstream loud-detector.
