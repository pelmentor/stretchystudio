# Animation Blender-Parity Plan — Phase 0 Audit

Date: 2026-05-10
Auditor: Claude (independent read; no prior conversation context)
Scope: Phase 0 of [ANIMATION_BLENDER_PARITY_PLAN.md](./ANIMATION_BLENDER_PARITY_PLAN.md)
Source-of-truth docs:
 - Plan: `d:\Projects\Programming\stretchystudio\docs\plans\ANIMATION_BLENDER_PARITY_PLAN.md`
 - Progress: `d:\Projects\Programming\stretchystudio\docs\plans\ANIMATION_PHASE_0_PROGRESS.md`
Commits audited: `ec5d7d3` (0.A), `ad7f26a` (0.B), `0386a6a` (0.C), `c8f86f3` (0.D.0), `bc8a875` (0.D armature)

Verdict legend:
 - SHIPPED — meets the plan exactly
 - PARTIAL — shipped but with caveats; caveats named
 - MISSING — promised in plan, not in code

---

## 1. Sub-phase 0.0 — Canonical time unit (ms)

**Plan bullets** (lines 276-297 of plan):

| # | Plan promised | Verdict | Evidence |
|---|---------------|---------|----------|
| 1 | Declare ms canonical throughout the eval substrate | SHIPPED | Memory entry `feedback_ms_canonical_animation_time.md` exists; indexed in MEMORY.md. |
| 2 | Seconds appear at exactly 2 boundaries: motion3.json + physics dt | SHIPPED for the writers' boundaries — not enforced in the eval substrate | Boundary discipline is documented but not enforced. See bullet 4. |
| 3 | Phase 5 scaffold's seconds-shaped `FCurve.keyforms[].time` migrated to ms in v33 | NOT YET (Phase 1 work — declared deferred) | OK. Phase 1 not started. |
| 4 | The depgraph's `EvalContext.time` field is renamed `timeMs` and rebased | **MISSING** | `src/anim/depgraph/eval.js:86` typedef still says `current playhead time (seconds)`. `src/anim/depgraph/kernels/animation.js:70-73` explicitly says "ctx.time is in seconds; SS animation engine works in ms" and does `(ctx.time ?? 0) * 1000`. `src/anim/depgraph/kernels/fcurve.js:41` calls `evaluateFCurve(fcurve, ctx.time, ...)` with seconds. The rename promised by Phase 0.0 / 0.D.0 was NOT done. |
| 5 | Future contributors check the memory before adding new unit-conversion logic | SHIPPED | Memory entry exists. |

**Sub-phase 0.0 verdict: PARTIAL.** The declarative work (memory + boundary doc) shipped. The structural rename of `EvalContext.time` → `timeMs` was promised in BOTH §0.0 ("rebased in Phase 0.D.0") and §0.D.0 (implied by ctx.timeMs in plan's example code at lines 369-378), and was NOT done. The animation kernel actively maintains a "ms inside, seconds in ctx" convention contradicting the canonical-ms declaration.

Files involved:
- `src/anim/depgraph/eval.js:86` (typedef says seconds)
- `src/anim/depgraph/eval.js:127` (`time: ctxIn.time ?? 0` — no rename)
- `src/anim/depgraph/kernels/time.js:25` (`return ctx.time;`)
- `src/anim/depgraph/kernels/animation.js:73` (`const timeMs = (ctx.time ?? 0) * 1000;` — proves ctx.time is seconds)
- `src/anim/depgraph/evalProjectFrame.js:67` (`time: 0` hardcoded — animation playback under depgraph would not see currentTime even if rename existed; see §5)

---

## 2. Sub-phase 0.A — gridLift RigWarp_* coordinate-frame fix

**Plan bullets** (lines 298-318):

| # | Plan promised | Verdict | Evidence |
|---|---------------|---------|----------|
| 1 | Fix contained to `src/anim/depgraph/kernels/gridLift.js` and a sister patch to the rotation-setup probe | DEVIATED (justified) | The fix landed in `src/anim/depgraph/build.js:393-422` — root cause was missing build-time relations, not a kernel math bug. `kernels/gridLift.js` and `kernels/rotationSetup.js` are unchanged. The progress doc explains this clearly. The deviation is correct (the bug was elsewhere). Plan was wrong; ship is right. |
| 2 | Full byte-parity between `'classic'` and `'depgraph'` on `test:depgraphSideBySide` 6-warp suite | NOT VERIFIED IN AUDIT | The 6-warp suite (`scripts/test/test_depgraphSideBySide.mjs`) exists but I have not run it. It's wired into the master `test` chain at line 199 of package.json. |
| 3 | Full byte-parity on Shelby-topology test in `test:chainEval` | **MISSING** | `scripts/test/test_chainEval.mjs` does NOT contain a depgraph-comparison run; it tests chainEval alone. No "Shelby topology test" was added to it. |
| 4 | Add `test_depgraph_eval_rigwarp.mjs` covering RigWarp_* (top-level + per-part) | RENAMED + PARTIAL | Actual filename: `scripts/test/test_depgraphSideBySide_rotationParent.mjs` (different name). Plan's name does not exist. Coverage is two rotation-parent shapes (single rotation, dual rotation chain) — does NOT cover per-part `RigWarp_*` shape, which was the specific shape the V2 close-out documented as broken. The test does cover the underlying root-cause (missing build relation), but the test name + per-part RigWarp* coverage promised by the plan is NOT in the file. |
| 5 | Sister patch to rotation-setup probe | NOT NEEDED | Per progress doc analysis, the kernel math was correct — no probe patch required. Plan was speculative. |
| 6 | Memory entry / changelog update for 0.A | MISSING (gate optional) | Phase 0.A is documented in `ANIMATION_PHASE_0_PROGRESS.md` only. No standalone memory entry. (Plan §5's "memory entry per phase shipped" only fires at phase exit, so this isn't strictly violated.) |

**Sub-phase 0.A verdict: PARTIAL.** Functional fix landed and is regression-pinned, but the test name/scope and the chainEval test extension do not match plan promises. The actual test coverage is narrower than promised (rotation chain ≠ RigWarp* per-part shape). The progress doc itself notes this gap: see ANIMATION_PHASE_0_PROGRESS.md:210-214 ("build a side-by-side fixture that covers per-part RigWarp_*" — this gap was raised then quietly elided when 0.A shipped).

Files involved:
- `src/anim/depgraph/build.js:393-422` (the fix)
- `src/anim/depgraph/sideBySide.js:154-191` (`collectChainMatrices` no-longer-stub)
- `scripts/test/test_depgraphSideBySide_rotationParent.mjs` (regression pin, 7 asserts, 3 cases)

---

## 3. Sub-phase 0.B — Driver pass wired into CanvasViewport tick

**Plan bullets** (lines 319-340):

| # | Plan promised | Verdict | Evidence |
|---|---------------|---------|----------|
| 1 | Order: `computeParamOverrides` → **NEW** `evaluateProjectDrivers` → `evalRig` | SHIPPED | `src/components/canvas/CanvasViewport.jsx:573-635`. Driver pass at lines 615-635, after `computeParamOverrides` (lines 573-595), before `evalRig`/`evalProjectFrameViaDepgraph` (line 898/900). |
| 2 | Drivers visibly affect the live preview the moment they are authored | SHIPPED in classic, PARTIAL in depgraph | In classic mode the merged param map flows into evalRig. Under depgraph, only param drivers reach the substrate (transform drivers route via the depgraph branch's TRANSFORM_COMPOSE — see §6); but **animation FCurves' driver flag is NOT wired into the depgraph kernels for transform drivers in 0.B itself**. The doc explicitly defers transform drivers to 0.D.0, then 0.D.0 didn't actually add a separate path. |
| 3 | New telemetry: count of driver evaluations per tick in `lib/logger.js` Logs panel | **MISSING** | `src/lib/logger.js` has no driver-count telemetry. `grep "driver" src/lib/logger.js` returns nothing. CanvasViewport's tick has no logger.debug for driver count. |
| 4 | Test: `test_animationStore.mjs` extended with a project that has a param driver and asserts the value at tick | **MISSING** | `scripts/test/test_animationStore.mjs` has zero matches for `driver|Driver`. The test was not extended. |

**Sub-phase 0.B verdict: PARTIAL.** Wire-up shipped; telemetry + test extension MISSING. Both omissions are silent — the plan's exit gate (a failing test) doesn't fire because the test doesn't exist.

Files involved:
- `src/components/canvas/CanvasViewport.jsx:30-35` (imports)
- `src/components/canvas/CanvasViewport.jsx:598-635` (wire-up)
- `src/anim/driverPass.js:103-116` (`evaluateProjectDrivers`)
- `src/anim/driverPass.js:127-136` (`driverOverridesToParamMap`)

---

## 4. Sub-phase 0.C — Constraint pass

**Plan bullets** (lines 341-360):

| # | Plan promised | Verdict | Evidence |
|---|---------------|---------|----------|
| 1 | Wire constraints in *after* pose composition but *before* matrix build | SHIPPED architecturally — but in a NEW op, not the planned location | The plan said "Wire-in point: `kernels/matrix.js` `MATRIX_BUILD` opcode — extend to call `evaluateConstraints(node, poseSeed, project)` before composing the world matrix." Actual: a NEW `TRANSFORM_COMPOSE` opcode + kernel was created (`src/anim/depgraph/kernels/transformCompose.js`). `kernels/matrix.js` is UNCHANGED. The progress doc (lines 350-360) explains the deviation: matrix.js builds rotation-deformer matrices, not Object transforms — different scope. The architectural call is correct. Deviation is justified. |
| 2 | Constraints will only run on bone pose channels in this phase | DEVIATED | The kernel runs on ALL parts and groups, not bone-only. `build.js:129-135` adds TRANSFORM_COMPOSE to every `node.type === 'part' \|\| node.type === 'group'`. Wider scope than the plan promised; harmless but a deviation. |
| 3 | A `LIMIT_ROTATION` constraint authored on a bone visibly clamps the user's R-modal rotation in real time | **NOT IN PRODUCTION** | The kernel is only consumed inside the depgraph (which is opt-in `'depgraph'` flag, default `'classic'`). The progress doc itself (line 240): "Production consumers (`renderer/boneOverlayMatrix.js`, `renderer/boneSkinning.js`, `selectRigSpec.js`) still read `node.pose` / `node.transform` directly. Phase 0.D's flag flip is when the production tick reads from `TRANSFORM_COMPOSE` instead. Until then, the kernel runs in the depgraph but doesn't affect rendering." So the user-facing promise is not yet kept under the default flag. |
| 4 | Test: `test_constraints_integration.mjs` covering all four types end-to-end through a depgraph eval | **MISSING (renamed + scope-reduced)** | Filename promised by plan: `test_constraints_integration.mjs`. Actual: `scripts/test/test_depgraph_eval_transformCompose.mjs`. Coverage: only **2 of 4 types** (COPY_LOCATION, LIMIT_ROTATION). COPY_ROTATION and TRACK_TO are NOT tested in the depgraph integration test. (`test_constraints.mjs` covers all 4 in unit form, but that pre-dates 0.C.) |

**Sub-phase 0.C verdict: PARTIAL.** Architecture is sound and follows Blender's `BKE_constraints_solve` order. But: (a) the user-facing "constraint clamps live R-modal" promise is gated on the depgraph flag flip (0.D), not yet effective; (b) integration test name + scope deviates from plan; (c) **subtle bone-bone constraint chain bug latent**: see §9.

Files involved:
- `src/anim/depgraph/kernels/transformCompose.js` (137 lines, the kernel)
- `src/anim/depgraph/build.js:129-135` (IDNode + TRANSFORM_COMPOSE addition)
- `src/anim/depgraph/build.js:188-225` (constraint relations)
- `src/anim/depgraph/eval.js:78` (kernel registration)
- `scripts/test/test_depgraph_eval_transformCompose.mjs` (5 cases, 13 asserts; progress doc claims 12)

---

## 5. Sub-phase 0.D.0 — Wire depgraph into production rAF callback

**Plan bullets** (lines 361-389):

| # | Plan promised | Verdict | Evidence |
|---|---------------|---------|----------|
| 1 | `CanvasViewport.jsx` reads `preferencesStore.evalEngine` per tick | SHIPPED | `src/components/canvas/CanvasViewport.jsx:896` — `const _evalEngine = usePreferencesStore.getState().evalEngine;` |
| 2 | Branch routes through `evalDepGraph` when `'depgraph'` | SHIPPED | `src/components/canvas/CanvasViewport.jsx:897-901` |
| 3 | Plan's example code uses `ctx = { timeMs: animationStore.currentTime, ... }` | NOT FOLLOWED | The actual call (`evalProjectFrameViaDepgraph(projectRef.current, valuesForEval)`) passes NO timeMs/time and NO animation. Internally `evalProjectFrame.js:67` hardcodes `time: 0`. **Animation playback under `'depgraph'` would not see currentTime through the depgraph's own animation kernel**, although merged param overrides arrive via `valuesForEval`. This is a deferred-forever migration concern (Rule №2 risk). |
| 4 | Both branches produce identical output on Shelby + Hiyori (the byte-fidelity gate) | **GATED ON USER MANUAL TEST** | Per progress doc lines 13-19 + lines 376-383: gated on user-side manual sweep. Not automated. |
| 5 | The cited example code does `evalDepGraph(buildDepGraph(project), ctx)` then "result.paramValues + result.poseOverrides feed evalRig" | NOT IMPLEMENTED THIS WAY | Actual implementation skips `evalRig` entirely under depgraph and consumes `ART_MESH_EVAL` outputs directly via `evalProjectFrameViaDepgraph`. This is architecturally cleaner than the plan's example but is a DIFFERENT shape. Caveat: lifted-grids overlay falls back to a separate probe path under depgraph (`CanvasViewport.jsx:911` sets `liftedGrids` to null). |
| 6 | `kernelArtMeshEval` ports `chainEval.evalArtMeshFrame` (cellSelect → keyform blend → modifier walk → emit ArtMeshFrame) | SHIPPED | `src/anim/depgraph/kernels/artMesh.js` (259 lines). Pipeline matches plan. |
| 7 | `evalProjectFrameViaDepgraph` helper, drop-in for `evalRig` | SHIPPED with caveats | `src/anim/depgraph/evalProjectFrame.js` (87 lines). Caveats: hardcoded `time: 0`; no `animation` propagation; no `liftedGrids` collection (overlay degrades). |
| 8 | 13 parity tests | SHIPPED (~match) | `scripts/test/test_depgraph_eval_artMesh.mjs` has **14 asserts** across 3 test scenarios (root-only, single rotation parent, parameter-driven keyform blend). Progress doc claims 13. Off-by-one — not a functional issue. |

**Sub-phase 0.D.0 verdict: PARTIAL — wire-in is real, but the integration is narrow.** Param values flow through the depgraph; animation/time/lifted-grids flow through the classic side-channel via `valuesForEval` upstream. This is a deliberate scope-narrowing — only the artMesh frame computation runs in the depgraph — but the plan implied a fuller substitution. Per Rule №2, the "stub `time: 0`" + "no `animation` argument" + "no liftedGrids collection" pattern is exactly the kind of half-wired path that becomes baggage if 0.D ships and Phase 1 absorbs the gap.

Files involved:
- `src/anim/depgraph/kernels/artMesh.js` (kernel)
- `src/anim/depgraph/evalProjectFrame.js` (runner)
- `src/components/canvas/CanvasViewport.jsx:891-901` (gating + branch)
- `src/components/canvas/CanvasViewport.jsx:1027-1054` (skinning skip under depgraph — verified working)
- `src/anim/depgraph/build.js:111-121` (ART_MESH_EVAL op added)
- `src/anim/depgraph/eval.js:80` (kernel registration)
- `src/anim/depgraph/build.js:443-552` (relation wiring including bone TRANSFORM_COMPOSE → ART_MESH_EVAL)
- `scripts/test/test_depgraph_eval_artMesh.mjs` (3 cases, 14 asserts)

---

## 6. Sub-phase 0.D armature port — bone post-chain inside ART_MESH_EVAL

**Plan-equivalent text** is fragmented across §0.D + the progress doc. The ship is documented in `ANIMATION_PHASE_0_PROGRESS.md:273-331`.

**Promised pieces** (per progress doc + commit message):

| # | Promise | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | New `bonePostChain.js` kernel with WORLD-matrix cache + parent chain walk | SHIPPED | `src/anim/depgraph/kernels/bonePostChain.js` (221 lines). |
| 2 | Reuses `pickBonePostChainComposition` so LBS / overlay / none gates identically to renderer | SHIPPED | `bonePostChain.js:34, 173`. |
| 3 | `kernelArtMeshEval` calls `applyBonePostChainSkin` after the modifier-chain walk; armature-modifier branch is no-op | SHIPPED | `src/anim/depgraph/kernels/artMesh.js:147-152, 173`. |
| 4 | Memoises bone WORLD matrices per-eval on `ctx._artMeshBoneWorldCache` | SHIPPED | `bonePostChain.js:111-153` + `artMesh.js:168-173`. `eval.js:108-113` typedef. |
| 5 | `buildPartModifierRelations` wires every relevant bone's TRANSFORM_COMPOSE to the part's ART_MESH_EVAL | SHIPPED | `src/anim/depgraph/build.js:497-550`. |
| 6 | "Relevant" includes (1) bone-group ancestor chain, (2) modifier `data.jointBoneId` chain, (3) modifier `data.parentBoneId` | SHIPPED | `build.js:540-549`. |
| 7 | CanvasViewport gates the post-loop skinning on `_evalEngine !== 'depgraph'` | SHIPPED | `src/components/canvas/CanvasViewport.jsx:1032`. Verified the entire skin block (LBS + overlay) is inside the gate. |
| 8 | 9 parity tests, 5 cases, byte-equal (<1e-4 px) against `evalRig + applyClassicPostSkin` | SHIPPED | `scripts/test/test_depgraph_armature.mjs` has 11 asserts across 5 test cases. Progress doc claims 9 — off-by-two. |
| 9 | Test 5 covers `LIMIT_ROTATION` constraint clamping pose pre-skin (proves TRANSFORM_COMPOSE → bone WORLD chain) | SHIPPED | `test_depgraph_armature.mjs` Test 5 (lines 264+). |

**Sub-phase 0.D armature verdict: SHIPPED.** Functionally complete and well-tested. Single concern: the bone-target-bone constraint chain has a latent bug in `transformCompose.js`'s `overlayTransform()` (see §9, Cross-Cutting Concerns) — but this is not on the 0.D armature surface, since the test uses non-bone groups for the chain test.

Files involved:
- `src/anim/depgraph/kernels/bonePostChain.js` (221 lines)
- `src/anim/depgraph/kernels/artMesh.js:147-152, 168-173` (integration)
- `src/anim/depgraph/build.js:497-550` (build relations)
- `src/components/canvas/CanvasViewport.jsx:1032` (skinning gate)
- `src/anim/depgraph/eval.js:108-113` (cache typedef)
- `scripts/test/test_depgraph_armature.mjs` (5 cases, 11 asserts)

---

## 7. Sub-phase 0.D flip — DEFERRED

**Plan bullets** (lines 391-401):

| # | Promise | Verdict | Evidence |
|---|---------|---------|----------|
| 1 | After 0.A–0.C + 0.D.0 land green, change `preferencesStore.js` default `evalEngine` from `'classic'` to `'depgraph'` | DEFERRED CLEANLY | `src/store/preferencesStore.js:160` still defaults to `'classic'`. |
| 2 | Keep the `'classic'` opt-out for one release | N/A — flip not done | |
| 3 | All existing tests pass with depgraph as the default | N/A — flip not done | |
| 4 | One byte-fidelity sweep on Shelby + Hiyori with depgraph default | GATED on user-side sweep | Per progress doc lines 13-19. |
| 5 | Memory entry: *"DepGraph is the production tick"* | N/A — flip not done | |

**Sub-phase 0.D flip verdict: CLEANLY DEFERRED.** Default stays `'classic'`. The deferral is the plan's intended state — it's an explicit gate.

**However, the deferral is NOT clean per Rule №2:**
- `src/store/preferencesStore.js:34-36`: comment says `'depgraph'` "is retained as opt-in for future render-side wiring; it has no production effect under the current flag-gated reads." This comment **contradicts** the post-0.D.0 reality (depgraph DOES have production effect when toggled). The comment is stale by 2 commits (0.D.0 + 0.D armature).
- `src/store/preferencesStore.js:158-159`: same stale comment ("`'depgraph'` opt-in has no production-side reader today").

These stale comments are documentation drift, not functional bugs. They mislead future readers about whether the depgraph ever runs.

---

## 8. Cross-cutting concerns (Rule №2 + hidden deferrals)

### 8.A — Stale "RESERVED" comment in build.js

`src/anim/depgraph/build.js:111-113`:
```js
// Per-part IDNodes. GEOMETRY_EVAL_DEFORMED iterates the modifier
// stack at eval time. TRANSFORM op reserved for parts that have
// bone-driven transforms (Phase D-3a will populate it).
```
But Phase 0.C's TRANSFORM op population is implemented just below at lines 124-135. The "TRANSFORM op reserved... Phase D-3a will populate it" comment is stale and contradicts the new code immediately below. **Per Rule №2, this is migration baggage** — a "RESERVED" comment for work that landed.

### 8.B — Stale preferencesStore comment about evalEngine

`src/store/preferencesStore.js:34-36, 158-159`: claims `'depgraph'` "has no production effect" / "has no production-side reader today" — contradicts the 0.D.0 + 0.D armature ship. **Per Rule №2, this is documentation baggage.**

### 8.C — Plan-doc inconsistency: AnimationTree dual-write

`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1643` (Phase 0 exit checklist) still lists `[ ] AnimationTree dual-write; test_animationTree_dualwrite green`, and line 1733 still maps grievance N to "Phase 0.E (dual-write) + Phase 8 (retire)". But §0.E (lines 403-409) explicitly REMOVED 0.E in v2 ("Originally v1 had a Phase 0.E to fix the AnimationTree shadow-write bug. Audit feedback: this is migration baggage..."). The exit checklist + grievance map were not updated when v2 dropped 0.E. **Plan-doc internal contradiction**, not code baggage.

### 8.D — `EvalContext.time` field rename never happened (Rule №2 risk)

Plan §0.0 (lines 290-293) explicitly promised: "The depgraph's `EvalContext.time` field is renamed `timeMs` and rebased." Plan §0.D.0 example code (lines 369-377) uses `timeMs: animationStore.currentTime`. Neither was done. The animation kernel actively maintains a "ms inside, seconds in ctx" convention. The rename is now staged for "later" without a registered migration → exactly the "deferred-forever" pattern Rule №2 prohibits.

### 8.E — Hardcoded `time: 0` in the depgraph runner (Rule №2 risk)

`src/anim/depgraph/evalProjectFrame.js:67` hardcodes `time: 0`. CanvasViewport's call site (`CanvasViewport.jsx:898`) passes no time. This means:
- Animation FCurves evaluated inside the depgraph (FCURVE_EVAL kernel) would always see t=0.
- ANIMATION_TRACK_EVAL kernel won't fire at all (no `animation` passed).

Today this works because `valuesForEval` is computed by the classic engine upstream (line 829 in CanvasViewport). The depgraph just receives the merged param values. So animation works "in the system" but not "in the depgraph." If 0.D flip lands without addressing this, the depgraph's own animation/FCurve kernels will be dead code — running but evaluating nothing. **Per Rule №2, this is a "stub for later" smell.** Either (a) wire `animationStore.currentTime` and `activeAnim` into the runner, or (b) explicitly delete the dead kernels until they're needed.

### 8.F — Latent bone-bone constraint chain doubling bug

`src/anim/depgraph/kernels/transformCompose.js:125-137` `overlayTransform()` for bones writes `pose.x = composed.x`. But `composed.x` IS already `pivotX + pose.x_original` per `effectiveTransform()` in constraints.js:171. When the next constraint reads the substituted node, `effectiveTransform` re-adds pivot: `pivotX + pose.x = pivotX + (pivotX + pose.x_original) = 2*pivotX + pose.x_original`. **Bone-target-bone constraint chains will double the pivot offset.** Not surfaced in tests because `test_depgraph_eval_transformCompose.mjs`'s chain test (Test 3) uses non-bone `type: 'group'` nodes — the bone branch in `overlayTransform` is never exercised by the chain test.

Mitigation requires either (a) computing pose from the composed transform via the same inverse logic as `composedTransformToBonePose` in `bonePostChain.js`, or (b) re-architecting so constraints output pose-shape values directly for bones.

### 8.G — Promised telemetry not added

Plan §0.B promised driver-eval-count telemetry in `src/lib/logger.js`. Not added (verified with grep — zero matches for `driver` in `src/lib/logger.js`). Plan §0.C did not promise telemetry, but the same gap applies for constraints. The progress doc does not mention this gap.

### 8.H — Promised tests not added

| Promised by plan | Actually exists? |
|------------------|------------------|
| 0.B: `test_animationStore.mjs` extended with a param-driver assertion | NO |
| 0.A: `test_depgraph_eval_rigwarp.mjs` (RigWarp* top-level + per-part) | NO (renamed `test_depgraphSideBySide_rotationParent.mjs`, narrower scope: rotation-chain only) |
| 0.A: Shelby topology test in `test:chainEval` | NO |
| 0.C: `test_constraints_integration.mjs` covering all 4 constraint types | NO (renamed `test_depgraph_eval_transformCompose.mjs`, only 2 of 4 types tested in integration) |

---

## 9. Tests assertion-count audit

Progress doc claims (line 391-402):
- depgraph_armature: 9 (new). **Actual: 11 asserts (5 cases).**
- transformCompose tests: 12 (claimed in line 232). **Actual: 13 asserts (5 cases).**
- artMesh tests: 13 (claimed in line 268). **Actual: 14 asserts (3 cases).**
- side-by-side rotationParent: not explicitly claimed. **Actual: 7 asserts (3 cases).**

Off-by-one/two. Likely the progress doc was authored before the final test pass; commit messages also have stale counts (e.g. armature commit says "9 parity tests"). Functionally fine — counts moved up, not down. Worth correcting in the progress doc for accuracy.

---

## 10. Phase 0 coherence with no Phase 1

Phase 1 (Action datablock + NodeTree retirement + 11-consumer migration of `project.animations[]`) has NOT shipped. Audit: is the codebase coherent without it?

- `project.animations[]` is still the canonical data source (verified: `CanvasViewport.jsx:573, 823`; `evalProjectFrame.js` does not read it but doesn't need to since param overrides arrive via the upstream merge).
- NodeTree datablocks (`src/anim/nodetree/*`) still exist as V2 architectural foundation. Read-only NodeTreeEditor still mounts. Not touched by Phase 0 — coherent.
- No `actionRegistry.js`, no `fcurveHandles.js`, no `fmodifiers.js`, no `nla.js`, no `keyingSets.js` — confirmed absent. No leftover stubs.
- No v33 migration file (`src/store/migrations/v33_*.js` — confirmed absent).
- The code does not crash, does not have dangling imports, does not have "is action set?" branches that would behave differently without Phase 1.

Phase 0 → Phase 1 boundary is clean. No leftover stubs from Phase 1.

---

## 11. Gaps summary (everything not SHIPPED)

| ID | Sub-phase | Severity | Gap |
|----|-----------|----------|-----|
| G-1 | 0.0 | HIGH | `EvalContext.time` not renamed to `timeMs`; kernels still convert seconds→ms inline. Promised in §0.0 + §0.D.0 example code. |
| G-2 | 0.A | LOW | `test_depgraph_eval_rigwarp.mjs` not created; actual test (rotationParent) covers different shape (rotation chain, not per-part RigWarp_*). |
| G-3 | 0.A | MED | Shelby topology test promised in `test:chainEval` not added. |
| G-4 | 0.B | HIGH | Driver eval count telemetry in `lib/logger.js` not added. |
| G-5 | 0.B | HIGH | `test_animationStore.mjs` driver-extension test not added. |
| G-6 | 0.C | LOW | Integration test covers 2 of 4 constraint types (COPY_ROTATION + TRACK_TO missing in depgraph integration). |
| G-7 | 0.C | MED | Constraints don't affect the production tick under default `'classic'` — gated on 0.D flip (this is the plan's design, but the user-facing 0.C deliverable from §0.C "constraint clamps user's R-modal in real time" is not yet true). |
| G-8 | 0.D.0 | HIGH | `evalProjectFrameViaDepgraph` hardcodes `time: 0`; no `animation` propagation. Stub-for-later pattern (Rule №2 risk). |
| G-9 | 0.D.0 | LOW | `liftedGrids` not collected under depgraph → WarpDeformerOverlay degrades. Acknowledged in code, not in plan. |
| G-10 | Cross | LOW | `src/anim/depgraph/build.js:111-113` stale "TRANSFORM op reserved... Phase D-3a will populate it" comment; should read "populated by Phase 0.C below". |
| G-11 | Cross | LOW | `src/store/preferencesStore.js:34-36, 158-159` stale "no production effect" / "no production-side reader today" comments. |
| G-12 | Cross | MED | `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md:1643, 1733` reference removed Phase 0.E AnimationTree dual-write; not updated when v2 dropped 0.E. |
| G-13 | Cross | HIGH | `transformCompose.js`'s `overlayTransform()` doubles pivotX/Y for bone-target-bone constraint chains. Latent — not surfaced by tests. |
| G-14 | Tests | LOW | Progress-doc test counts are off-by-one/two (counts went UP, not down — minor accuracy issue). |
| G-15 | 0.D flip | INFO | Default `'classic'`. Gated on user manual byte-fidelity sweep (Shelby + test_image4). Per the plan, this IS the gate. |

---

## 12. Recommendations

1. **G-1, G-8 (highest, both Rule №2)** — Either rename `EvalContext.time → timeMs` and rebase kernels, OR delete `evalProjectFrame.js`'s hardcoded `time: 0` + animation kernels until they're consumed. Don't ship 0.D flip with the rename outstanding; the moment depgraph becomes default, the seconds-versus-ms convention bakes in.

2. **G-13 (latent bug)** — Add a test for bone-target-bone constraint chaining to `test_depgraph_eval_transformCompose.mjs`. If the doubling happens, fix `overlayTransform()` to write `pose.{x,y}` from `composedTransformToBonePose(node, t)` (bonePostChain.js already has the inverse).

3. **G-4, G-5, G-3, G-6 (test-debt)** — Either complete the promised tests (cheap; ~1-2 hours each) or update the plan to reflect the narrower scope. Half-promises in the plan create exit-gate ambiguity for future audits.

4. **G-10, G-11, G-12 (doc drift, Rule №2 baggage)** — Update the comments in `build.js:111-113`, `preferencesStore.js:34-36 + 158-159`, and the plan checklist at lines 1643 + 1733. ~10 minutes total.

5. **G-7, G-15 (production effect)** — Before the user runs the byte-fidelity sweep gate, address G-1 + G-8 + G-13. The sweep would otherwise validate against a depgraph that's missing animation/FCurve eval and has a known latent bone-chain bug.

6. **G-9 (lifted-grids degradation)** — Either port the lifted-grids collection into the depgraph runner, OR document explicitly that the warp-grid overlay falls back under depgraph mode (currently only the code knows, not the user). Plan doesn't mention this trade.

7. **General — Audit the progress doc itself.** It claims test counts that don't match reality (low-stakes); it elides gaps that the plan promised; it doesn't surface G-13 or G-8 as concerns. Per the user's "post-ship audit pass" memory entry (`feedback_post_ship_audit.md`), re-reading the diff before declaring done would have caught most of these gaps.

---

## 13. Bottom line

Phase 0 is **functionally close to plan but documentationally drifty and partially stubbed.** The core wires (driver pass, TRANSFORM_COMPOSE, ART_MESH_EVAL, bone post-chain) are real and tested. Three categories of gap:

- **Promise-debt** (test names, telemetry, kernel rename): plan said it; ship didn't include it. Most are low-effort fixes.
- **Stub-for-later** (`time: 0` hardcoded, no animation propagation): the depgraph is structurally narrower than promised. Per Rule №2, must address before flag-flip or risk baking the gap in.
- **Latent bug** (G-13 bone-chain pivot doubling): not user-visible today (production reads `node.pose` directly), but will surface the moment 0.D flip lands and a user authors a bone-on-bone constraint.

The "5 of 6 sub-phases shipped + armature gate closed" claim in the progress doc is **defensible but overstated**: 0.0's structural rename is missing, 0.B/0.C tests are partial, 0.D.0 is narrower than the plan's example code. Recommend addressing G-1/G-8/G-13 before the user runs the manual byte-fidelity sweep so the sweep validates a coherent system, not the current half-wired one.
