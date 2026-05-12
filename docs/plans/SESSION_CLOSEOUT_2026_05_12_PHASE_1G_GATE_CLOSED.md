# Session close-out — 2026-05-12 PM
# Animation Phase 1.G manual Cubism Viewer .moc3 acceptance gate — FULLY CLOSED

## Status

**Phase 1.G dual-PSD gate** (per `feedback_test_character_is_shelby.md` "the byte-fidelity gate must exercise **both** PSDs"):

| PSD | Topology | Cubism .cmo3 | Cubism .moc3 | Fresh import → export | Save → reload → re-export |
|-----|----------|--------------|--------------|----------------------|---------------------------|
| `shelby_neutral_ok.psd` | Western | ✅ opens | ✅ opens | ✅ verified | ✅ verified |
| `test_image4.psd` | anime | ✅ opens | ✅ opens | ✅ verified | ✅ verified |

**Phase 1 ship gate cleared.** Phase 2 BezTriple (schema v39, ~1 week per plan) is now unblocked.

## How we got here

The session opened from `SESSION_CLOSEOUT_2026_05_12_LOADING_TIMES.md`'s Resume Path A/B/C, with Phase 1.G as the only remaining Phase 1 ship gate. User initiated a smoke test on Shelby that surfaced a cascade of 4 latent regressions — none of which were caught by the prior dual-audit sweeps because they were all in code paths the unit-test harness can't exercise (Web Worker init, runtime variable scope on the rAF tick, ag-psd internal allocator paths).

Each was filtered through Rule №1 (proper fix, no crutch), Rule №2 (no migration baggage), and the new Rule №3 (question agents, not user).

### Hotfix sweep — 4 latent regressions

#### 1. PSD worker — `Canvas not initialized` (latent since `cc700f8`, May 9)

**Symptom**: `[psdImport] workerDecode: 19ms { error: "Canvas not initialized, use initializeCanvas method to set up createCanvas method" }` on every PSD import. Worker thrown immediately on first non-zero-area layer.

**Root cause**: ag-psd's `useImageData: true` flag is *insufficient on its own* — the per-layer buffer allocator `createImageDataBitDepth` (psdReader.ts:780) still funnels through `createImageData` (helpers.ts:378) which calls `createCanvas(1, 1)`. `createCanvas`'s default-export *throws* unless `document` is available; the `if (typeof document !== 'undefined')` auto-installer at helpers.ts:319 only fires on the main thread. The original `cc700f8` author's assumption that `useImageData: true` made ag-psd canvas-free was wrong.

**Fix** (`9ef2ecf`, [src/io/psd.worker.js:10-23](../../src/io/psd.worker.js#L10-L23)): Call `initializeCanvas(OffscreenCanvas, new ImageData)` at worker entry. Both primitives are Worker-global. Verified by user logs showing `psdImport:workerDecode: 79ms` for a 6.3 MB / 20-layer Shelby PSD.

#### 2. Init Rig — `ReferenceError: upsertDeformerNode is not defined` (latent since BFA-006 NeckWarp dual-write)

**Symptom**: `RigService.initializeRig failed: ReferenceError: upsertDeformerNode is not defined at projectStore.js:1465:13`. Init Rig threw on every replace-branch invocation.

**Root cause**: BFA-006 Phase 6 fallout added NeckWarp dual-write paths to `seedAllRig`. The merge branch at projectStore.js:1462 correctly called `peers.upsertDeformerNode(...)` (the helpers are lifted into `projectStoreRigPeers` and ARE NOT bare exports). The replace branch one line down at projectStore.js:1465 dropped the `peers.` prefix. Bare names were undefined in closure → throw.

**Fix** (`9ef2ecf`, [src/store/projectStore.js:1465](../../src/store/projectStore.js#L1465)): Single-line restore of `peers.` prefix. Verified by user logs showing `rigInit:full: 335ms { warpDeformers: 23, rotationDeformers: 4 }` and the subsequent `chainEvalLift` succeeding.

#### 3. Misleading `boot:moduleEval` (Rule №1 violation in `475527e` same-day)

**Symptom**: `boot:moduleEval: 2ms { ms: 2 }` on every boot. Label promised module evaluation; measurement covered only the synchronous `createRoot().render()` reconciler kick.

**Root cause**: I had wired `logger.time('boot', 'moduleEval')` around React's `render()` call in main.jsx. Module evaluation (ESM import resolution + import-graph execution) had ALREADY completed before line 1 of main.jsx ran — there's no way to measure it from inside the module. The interval wrapper was semantically wrong.

**Fix** (`9ef2ecf`, [src/main.jsx:14-31](../../src/main.jsx#L14-L31) + [src/lib/idlePrefetch.js:57-82](../../src/lib/idlePrefetch.js#L57-L82)): Replaced the misleading interval with three honest milestones (`{msSinceTimeOrigin}`):

```
boot:reactRender   — render call returned (React reconciler kicked)
boot:firstPaint    — first rAF after React's initial commit
boot:idleDone      — kickIdlePrefetches() Promise.allSettled drained
```

`boot:idleDone` is NEW — `kickIdlePrefetches` previously fire-and-forgot 10 dynamic imports with no completion signal. The 2-3s "still loading" tail between firstPaint and "fully ready" was un-measured. Now bracketed by `Promise.allSettled` with `{count, fulfilled, rejected}` payload. Single failed chunk still surfaces at the real Suspense boundary; allSettled only collapses for the boot marker.

**Boot baselines captured** (Vite dev mode):
- Cold load: `firstPaint: 5240ms` → `idleDone: 6391ms` (Δ = 1151ms idle-prefetch tail)
- Hot cache: `firstPaint: 148ms` → `idleDone: 395ms` (Δ = 247ms — same shape, much shorter)

#### 4. rAF tick — `ReferenceError: _evalEngine is not defined` (latent since Phase 0.D.0 `c8f86f3`)

**Symptom**: Character frozen post-Init-Rig in both Viewport + Live Preview. Parameter sliders moved but had zero visual effect. Console threw `Uncaught ReferenceError: _evalEngine is not defined at CanvasViewport.jsx:1117:13` every frame.

**Root cause**: `const _evalEngine = usePreferencesStore.getState().evalEngine` was declared inside the cache-miss `else` branch at line 972, but read at line 1117 (the post-loop bone-composition gate that decides whether classic engine needs LBS/overlay double-compose). On every frame where rigSpec + paramValues were unchanged (the typical 60 Hz idle case), the cache HIT branch ran → `else` skipped → `_evalEngine` undefined → tick throws before any GPU upload.

The fresh-Init-Rig moment was the only path that DIDN'T fire the bug: first frame after Init is always a cache miss → else branch runs → variable defined. Crash started on frame 2.

**Fix** (`1671449`, [src/components/canvas/CanvasViewport.jsx:972](../../src/components/canvas/CanvasViewport.jsx#L972)): Hoisted the const above the `if (cacheHit)` check so both branches + the post-loop pass see it. Per Rule №1, single source of truth; no `?? 'classic'` crutch that would hide future scope regressions.

## Commit chain (this session)

```
1671449  fix(anim): Phase 0.D.0 — hoist _evalEngine const above cache-hit branch
9ef2ecf  fix(hotfix): PSD worker canvas-init + Init Rig peers prefix + honest boot milestones
ab42613  docs(plan): Loading-times instrumentation close-out doc (Stage 0 + 0.B SHIPPED)  [prior]
8b99483  fix(audit): loading-times instrumentation Stage 0.B — 4 HIGH leaks + 3 MED missed paths + 2 LOW polish  [prior]
475527e  feat(logger): loading-time instrumentation — time/timeEnd/timed helpers + 10 path coverage  [prior]
```

All pushed to `origin/master`.

## What the closed gate unblocks

1. **Phase 2 BezTriple handles** (schema v39, ~1 week per `ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 2). Was gated on Phase 1.G; now clear.
2. **Phase 0.D `evalEngine='depgraph'` flag flip** (separate but same gate). The depgraph engine is now byte-faithful per the in-flight memory's Phase 0 audit-fix `ee2b1c5`; default stays `'classic'` until the user toggles via `preferencesStore.evalEngine`. Phase 1.G gate covered the `'classic'` engine path; depgraph path is a separate verification.
3. **Stage 2 loading-times optimization sweep** (gated on user-side baselines per `project_loading_times_instrumentation.md`). Baselines NOW captured:
   - `boot:firstPaint: 5240ms` cold / `148ms` hot
   - `boot:idleDone: 6391ms` cold / `395ms` hot (Δ to firstPaint = 1151ms / 247ms tail)
   - `export:live2d:packAtlas: 1007ms` = **74% of the 1342ms `export:live2d:full`** — dominant single cost
   - `export:live2d:buildMeshesForRig: 120ms`
   - `export:live2d:generateRigOnlyCmo3: 158ms`
   - `export:live2d:generateMoc3: 14ms`
   - `export:cmo3:full: 727ms` (atlasing path skipped — pure model+rig export)
   - `psdImport:workerDecode: 78-79ms` (Shelby 6.3 MB / 20 layers)
   - `psdImport:workerPool:composite: 313-318ms`
   - `psdImport:finalize: 316-321ms`
   - `rigInit:full: 335ms` (Shelby: 20 parts, 23 warpDeformers, 4 rotationDeformers, 19 artMeshes)
   - `rigInit:buildMeshes: 146-157ms` (within rigInit:full)
   - `rigInit:heuristic-path-generateCmo3: 174-185ms` (within rigInit:full)
   - `projectSave:library: 86ms` first / `116ms` second
   - `projectLoad:full: 34ms` (from IDB)
   - `lazyLoad:rig:harvestPipeline: 8ms` (idle-prefetched)
   - `lazyLoad:seeds:11modules: 3-15ms` (idle-prefetched)

   **Stage 2 candidate ranking now changes**: H-5 (`textureAtlas.findMaxScale` memoization) leapfrogs to top priority on measured leverage. Original H-1 (`loadProjectTextures` serial → parallel) was prioritized for 3-path leverage; on a 6.3 MB PSD with 20 textures the parallel win is bounded by 6.3 MB / network-bandwidth and may not be as dominant as theory suggested — needs its own baseline measurement.

## Resume paths

### A. Phase 2 BezTriple (recommended — full week of substrate work, blocks no one else)

`ANIMATION_BLENDER_PARITY_PLAN.md` §Phase 2. Schema v39. BezTriple handles in FCurve keyforms — `interpolation = 'bezier'`, `handle_left_type`, `handle_right_type`, `handle_left[2]`, `handle_right[2]` per Blender's `DNA_curve_types.h`. Implements:
- v39 migration (every existing FCurve keyform gets default `interpolation: 'linear'` + null handles)
- Editor: drag handles in TimelineEditor / DopesheetEditor / FCurveEditor
- Evaluator: depgraph FCURVE_EVAL kernel reads `interpolation` discriminator; bezier path uses cubic Hermite from handle vectors
- Export: motion3.json `Segments` already supports bezier segment type 1 (3 points per knot); export path emits per-knot handle data
- Tests: round-trip migration + editor + evaluator + export

### B. Stage 2 loading-times H-5 (textureAtlas.findMaxScale memoization)

[src/io/live2d/textureAtlas.js:133](../../src/io/live2d/textureAtlas.js#L133). With the new 1007ms baseline this is the single biggest win in the export pipeline. Approach (Rule №1 — proper memoization):
- Cache key: stringified image-id sequence + scale value
- Cache lifetime: per-export call (avoids cross-export staleness when user re-imports PSDs)
- Even within a single binary search the 16 probes are distinct scales — memoization win comes from the re-export case (the user's logs show 2 exports per session is typical: live2d + cmo3)

### C. Stage 2 H-1 (loadProjectTextures serial → parallel)

[src/lib/imageHelpers.js:21](../../src/lib/imageHelpers.js#L21). 3-path leverage (`rigInit`, `runStage` keyform stages, `export` keyform resolve). Lower priority post-baseline because the texture decode is bounded by browser image-decode throughput on local PSDs (no network); the gain may be marginal. Worth measuring before committing to the change.

### D. Phase 0.D `evalEngine='depgraph'` flag flip verification

Separate gate from Phase 1.G's `'classic'` path. Toggle `preferencesStore.evalEngine = 'depgraph'` in DevTools, re-run the same Shelby + test_image4 flow, byte-diff the `.cmo3` against `'classic'` baseline. If clean, flip the default and retire `'classic'` (Rule №2 — no parallel evaluator forever).

## Outstanding items NOT in scope for this session

- `synthOrphanFallback` warning: `2 deformer(s) only present via orphan-fallback. After Phase 3.C they will disappear unless modifier.data is repaired (Re-initialize Rig refreshes it).` Pre-existing — surfaces on every Init Rig and post-load. Tracked elsewhere (Blender Parity Refactor Phase 3.C scaffolding; see `project_blender_alignment_2026_05_07.md`).
- `rigInitIdentityDiag` rest-divergence: `max 19.65 px across 19 parts; 6 offenders > 1 px`. Eye-region rounding offsets baked at Init Rig time vs identity-pose eval; tracked in V3 Polish Pass 001 and similar — not a Phase 1 ship gate concern.
- The cmo3 export path's per-export `bodyAnalyzer` + `eyeContexts` re-runs are visible in the logs (each export re-fits all eye parabolas). Cacheable but ungated; deferred to Stage 2 follow-on if measurements warrant.

## Memory updates this session

- **NEW** `feedback_question_agents_not_user.md` — Rule №3 (declared mid-session): when uncertain, spawn review/ideas-perspective/blender-fidelity agents instead of bouncing back via `AskUserQuestion`. User's time is the bottleneck.
- **UPDATED** `MEMORY.md` — Rule №3 index entry added immediately after Rule №2.
- **UPDATED** `project_blender_parity_plans_in_flight.md` — Phase 1.G FULL closure status (this close-out's anchor section).
- **UPDATED** `project_loading_times_instrumentation.md` — cheat-sheet swapped `boot:moduleEval` + `first frame painted` → milestones `reactRender`/`firstPaint`/`idleDone`. Baselines added.

## Test scoreboard

- TSC clean (typecheck pass across all 5 edited files in 4 hotfix commits).
- Audit-pin (`test_audit_fixes_2026_05_12_loading_times.mjs`): 54 passed.
- File routing (`test_fileRouting.mjs`): 13 passed.
- Manual gate (Cubism Viewer 5.0):
  - shelby_neutral_ok.psd: `.cmo3` opens, `.moc3` opens, save→reload→re-export both open.
  - test_image4.psd: `.cmo3` opens, `.moc3` opens (per user 21:11 verbal confirmation).

## Validation hashes (artifacts the user kept)

```
D:\Projects\Programming\stretchystudio\SHELBY_CMO3_NEW                  — fresh import → export
D:\Projects\Programming\stretchystudio\SHELBY_MOC3_NEW                  — same
D:\Projects\Programming\stretchystudio\SHELBY_CMO3_NEW_FROM_SAVE        — save → reload → export
D:\Projects\Programming\stretchystudio\SHELBY_MOC3_NEW_FROM_SAVE        — same
```

test_image4 artifacts confirmed verbally; user opted not to keep the dir.

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1
- `feedback_no_migration_baggage_rule_two.md` — Rule №2
- `feedback_question_agents_not_user.md` — Rule №3 (declared this session)
- `feedback_test_character_is_shelby.md` — dual-PSD policy
- `project_blender_parity_plans_in_flight.md` — anchor memory; Phase 1.G FULL closure paragraph
- `project_loading_times_instrumentation.md` — baselines captured this session
- `docs/plans/SESSION_CLOSEOUT_2026_05_12_LOADING_TIMES.md` — predecessor (Stage 0 + 0.B substrate shipped)
- `docs/plans/SESSION_CLOSEOUT_2026_05_12_PHASE1_STAGE1E_D1_RERESOLUTION.md` — sister thread (same calendar day; Item-tab placement re-resolution)
- `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` — Phase 2 BezTriple substrate (the next thread)
