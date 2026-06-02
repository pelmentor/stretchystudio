# Session aggregate — 2026-06-02 round-3

Third `Workflow` audit over the top-5 critic-flagged categories from R2 + driver-cycle / migration safety, plus autonomous fix sweep. 11 commits, **28 / 33 confirmed findings shipped end-to-end**. Tracking doc: [AUDIT_2026_06_02_R3_DEEP_MODALITIES.md](AUDIT_2026_06_02_R3_DEEP_MODALITIES.md).

## Workflow

`wf_3cd96114-a42` — 202 agents, ~9.4M tokens, 28 min. 65 raw → **33 confirmed / 32 refuted** (49% pruning, similar to R2's 44%).

Six dimensions: live2d-json-subformats, cross-store, build/PWA tooling, ui-edge, renderer, migrations-drivers.

Pattern (same as R1/R2):
- 6 finders × per-dimension prompt.
- 3-lens verify (existence / severity / context), default refuted=true, survives if ≤1 of 3 refutes.
- Completeness critic over the confirmed set.

Critic-flagged next-round categories: byte-fidelity binary/XML writers (moc3/cmo3/can3), CMO3 import pipeline, Cubism runtime kernels, NodeTree compile passes, animation editor surfaces (NLA/dopesheet/fcurve mods/keying sets), wizard/template onboarding, mesh-editing kernels, keymap dispatcher conflict/precondition, hot-reload, holistic v21-v48 migration chain, bone skinning matrix composition, i18n/a11y/theming.

## Phase 2 — autonomous sweep

| # | Commit | Author | Items | Net |
|---|--------|--------|-------|-----|
| 1 | `27528d9` | Claude | tracking doc | +71 |
| 2 | `43abefc` | pelmentor | MIG-NAN + MIG-V18 | +30 -2 |
| 3 | `e61cf1a` | Claude | L2D-JSON physics3 batch | +129 -32 |
| 4 | `4560232` | pelmentor | motion3 + cdi3 | +87 -12 |
| 5 | `7a20e68` | Claude | CROSS-1/-4/-5/-7/-11/-12 | +109 -13 |
| 6 | `3e5578b` | pelmentor | F1 + F2 + F4 | +72 -20 |
| 7 | `c5d4fcc` | Claude | GL-03..-08 | +117 -9 |
| 8 | `3e812f3` | pelmentor | DRIVER-PARAMS | +40 -10 |
| 9 | `44f21fe` | Claude | BUILD-009 | +11 -10 |
| 10 | `b4c5812` | pelmentor | test un-pin (driver cascade) | +4 -13 |
| 11 | `fce32a4` | Claude | test un-pin (Angle fallback) | +6 -3 |

**Net:** ~+675 LOC substantive fixes, ~−120 LOC of broken / dead patterns retired.

## Architectural shifts

1. **Migration walker is finite-version-safe.** `migrateProject` now throws on non-finite `schemaVersion` instead of silently slipping through (NaN-comparisons returned false on every guard → ZERO migrations applied → schemaVersion stayed NaN → every downstream consumer saw a v0 shape). Companion fix: `projectFile.loadProject` now restores `Float32Array` UVs on post-v18 `meshData` nodes (the original loop only checked `node.mesh`).

2. **Physics3 round-trip is byte-faithful.** Writer no longer hardcodes `Output.Weight=100`, `Type='Angle'`, or `EffectiveForces.gravity=(0,-1)`. Importer captures all three; writer reads `o.weight`, `o.outputType`, `opts.effectiveForces`. NaN/Infinity routed through `finiteOr`. Vertex Position uses `requireFinite` (throws on non-finite — no sane fallback). Rules with <2 vertices rejected (symmetric to importer). Unknown `Input.type` no longer silently coerced.

3. **Motion3 + cdi3 silent-fallback class closed.** motion3 writer throws on missing `action.duration`/`fps` (invariant violation post-v36). Motion3 importer rejects negative Duration; warns + infers from largest keyform time when Meta.Duration is missing/0. cdi3 writer dedupes Parameter/Part Ids with logger.warn.

4. **Cross-store cleanup chokepoint on deleteNode.** New `cleanupOnNodeDelete(idsToDelete)` helper fans out to editorStore (`selection`, `activeVertex`, `activeBlendShapeId`, `keyformEdit`, `expandedGroups`, `selectedVertexIndices`), `selectionStore.items`, `animationStore.draftPose/restPose`. Live-binding circular ES import resolves cleanly. `paramValuesStore.reset()` at the top of `resetProject` + `loadProject` so stale `ParamRotation_<bone>` values from project A don't fan out onto B's bones.

5. **Modal lifecycle survives mode/project swaps.** `cancelActiveModals()` helper in editorStore. `exitEditMode` cancels before clearing edit state (F1). `resetProject` + `loadProject` cancel before swapping project state (F2). Pre-fix Tab or any mode-switch left modal stores alive with window-level listeners still bound; post-load mousemoves referenced nodes from the OLD project. Plus `DopesheetEditor` grab modal's window keydown now intercepts Ctrl/Meta+Z+Y+Shift+Z (F4) — pre-fix mid-grab undo desynchronized grabStateRef from the reverted action.

6. **WebGL lifecycle hardened.** `webglcontextlost` / `webglcontextrestored` handlers (GL-03): halt rAF on loss, rebuild ScenePass + clear upload caches + restart rAF on restore. `visibilitychange` resets `lastPhysicsTimestampRef` so post-resume dt math short-circuits to 0 (GL-04 — pre-fix the wall-clock pause integrated as a single huge pendulum step, visible whip). Upload-cache trio + `uvTypedCache` cleared in `handleReset`, `handleLoadProject`, and the init effect's cleanup (GL-06). `partRenderer.uploadMesh` now picks `Uint32Array` IBO for >65535 verts and records `state.indexType` for all three drawElements sites (GL-07 — pre-fix Uint16 silently truncated). `TEXTURE_MIN_FILTER` switched to `LINEAR_MIPMAP_LINEAR` so the mipmap chain `generateMipmap` builds actually gets sampled (GL-08).

7. **Driver `__params__` view reads live values.** `evaluateRnaPath` threads `evalContext.paramOverrides` into `_paramsView` so `objects["__params__"].values["X"]` returns X's current animated/driven/slider value instead of `p.default`. `driver.js#resolveVariables` passes the full evalContext; depgraph DRIVER_EVAL kernel passes `ctx.paramOverrides`. Test that PINNED the broken cascade (`Z = 0` because Y read its default) updated to assert the correct cascade (`Z = 60`).

## RULE-№5 alternation

Strictly maintained Claude ↔ pelmentor across all 11 commits.

## Open work — for next session

### Deferred (5 items, well-scoped each)

- **CROSS-9** setSelection reads preferences during reducer — widespread pattern, separate refactor session.
- **CROSS-10** persisted lastToolByMode validation — low impact.
- **BUILD-001** manual-chunks denylist → allowlist — needs byte-budget baseline first.
- **BUILD-006** PWA manifest icons — asset task.
- **BUILD-008** tsconfig + jsconfig duplication — needs IDE-plugin verification.
- **GL-10** premultipliedAlpha:false / blendFunc mismatch — needs visual A/B.

### Round-4 candidates (per critic)

Highest expected yield: byte-fidelity binary/XML writers (moc3/cmo3/can3 — completely untouched in r1/r2/r3), Cubism runtime kernels, NodeTree compile passes, animation editor surfaces (NLA/dopesheet/fcurve mods).

### Blocked on user (unchanged)

- bug-03 Shelby handwear bbox — needs Init Rig re-run.
- bug-01 BUG-015 BodyAngle — needs real drag-repro.

## Resume hint for next Claude

Per RULE-№5 alternation: last commit Claude `fce32a4`. Next must be pelmentor.

Three options, ranked by ROI:
1. Round-4 over byte-fidelity binary writers (the largest untouched substrate).
2. Pick one DEFERRED item (each fits in a session).
3. Wait for user Init Rig re-run on bug-03.
