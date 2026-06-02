# Session aggregate — 2026-06-02

**Workflow + autonomous audit-sweep run.** 18 commits, **20 / 36 confirmed audit findings closed end-to-end**. Tracking doc: [AUDIT_2026_06_02_THICK_AUDIT.md](AUDIT_2026_06_02_THICK_AUDIT.md).

## Phase 1 — the audit workflow

The session opened with **"жирный аудит всего проекта"** — a thick audit per all standing rules (RULE-№1/№2/№4 + architecture + tests + bugs/plans). After a wrong first pass with 5 plain parallel `Agent` calls, the user redirected to a proper `Workflow` with adversarial verify:

**Workflow shape** (`wf_b2f8512a-445`):

```
phase('Find')   — 6 parallel finders, one per dimension
phase('Verify') — 3 lenses per finding (existence / severity / context),
                  default refuted=true, survives if ≤1 of 3 refutes
phase('Critic') — completeness critic on confirmed set
```

**Result:** 72 raw findings → **36 confirmed / 36 refuted** (50 % pruning). 223 agents, ~10 M tokens, 23 min wall-clock.

**Why this worked:** 3-lens adversarial verify caught half the agent claims as wrong/intentional/already-addressed. The "existence" lens caught hallucinated cite locations. The "severity" lens caught patterns that were intentional API contracts. The "context" lens caught items already documented as deferred. Per `[[audit-agent-claims-before-mass-delete]]` — agent reasoning is not ground truth; verify before acting.

## Phase 2 — the autonomous sweep

User: **"автономно фикси"** → no further prompts, ship through the punch list.

### Commits chronology

| # | Commit | Author | Item(s) | Net |
|---|--------|--------|---------|-----|
| 1 | `309ee80` | Pelmentor | tracking doc opens | +257 |
| 2 | `17028c8` | Claude | rule-1-08 bonePostChain `finiteOr` | +18 -15 |
| 3 | `be4f2d7` | Pelmentor | rule-1-04 driver.js NaN-propagate | +14 -2 |
| 4 | `59b43f2` | Claude | rule-1-09 matrix.js + shared `finiteOr` util | +52 -32 |
| 5 | `4f69207` | Pelmentor | rule-1-02 constraints.js throw + NaN | +29 -12 |
| 6 | `9b647b3` | Claude | doc update (eval-path sweep) | +11 -17 |
| 7 | `6fb5623` | Claude | rule-1-06 RigService 4× swallow | +19 -5 |
| 8 | `4fbe396` | Pelmentor | rule-1-11 weightPaint 7 sites | +19 -8 |
| 9 | `ea3fca5` | Claude | rule-1-14 8 menu invokers + `reportOpFailure` util | +62 -8 |
| 10 | `e62976d` | Pelmentor | rule-1-05/-07 TimelineEditor audio errors | +25 -2 |
| 11 | `bea0c4d` | Claude | rule-1-10 Spine exporter throw on NaN | +27 -4 |
| 12 | `3de09d7` | Pelmentor | rule-1-12 LogsEditor copy toast | +12 -1 |
| 13 | `acd37e5` | Claude | RULE-№2 metla — 6 dead shims | +25 -194 |
| 14 | `a1205f6` | Pelmentor | arch-10 chainEval docstrings + bug-04 console.log | +27 -22 |
| 15 | `282aba5` | Claude | rule-4-05 Apply Armature → TRANSFORM_COMPOSE | +59 -15 |
| 16 | `e21fe54` | Pelmentor | rule-4-03/-04 ANIMATION_TRACK_EVAL → evaluateFCurve | +26 -6 |
| 17 | `b7b2188` | Claude | test-01 v32 migration test (19 assertions) | +177 -1 |
| 18 | `9c7c90e` | Pelmentor | doc close-out | +24 -63 |

**Net:** −150 LOC of dead code retired; +430 LOC of substantive fixes / new utilities / tests.

### Items closed

- **RULE-№1 (11/11)** — silent fallbacks all closed:
  - eval-path NaN-safety: rule-1-02, -04, -08, -09 (4 sites use shared `finiteOr`)
  - error escalation: rule-1-06 (RigService 4× swallows), rule-1-14 (8 menu invokers), rule-1-05/-07 (TimelineEditor), rule-1-12 (LogsEditor), rule-1-11 (weightPaint 7 sites), rule-1-10 (Spine exporter throws)
- **RULE-№2 (6/8)** — dead shims retired in metla sweep: rule-2-01/-02/-03/-04/-06/-10
- **RULE-№4 (3/4 high-sev)** — biggest Blender-parity holes closed:
  - rule-4-03 + rule-4-04 — `ANIMATION_TRACK_EVAL` now drives FCurve Modifiers + Drivers
  - rule-4-05 — Apply Armature now respects bone constraints
- **Architecture (1)** — arch-10 chainEval docstring reword
- **Tests (1)** — test-01 v32 migration behavior test
- **Bugs (1)** — bug-04 stale `console.log` → `logger.info`

### Architectural shifts

1. **eval-path finite by contract.** Shared `finiteOr(v, fallback)` at [src/lib/finiteOr.js](../../src/lib/finiteOr.js). Consumed by `bonePostChain` (pose channels + composed + pivot), `matrix.js` (rotation builder), `constraints.js` (transform channels). `driver.js` writes NaN explicitly per its FCurve-fallback contract. The rigInvariantCheck framework (I-7 / I-12..I-15) is the upstream loud-detector; these kernel guards are the runtime safety net. Viewport stays finite even when stored data has NaN; framework surfaces the corruption at Init Rig.

2. **ANIMATION_TRACK_EVAL is now full-featured.** Pre-fix the depgraph kernel called `interpolateTrack` (raw bezier sampler) directly, silently bypassing FCurve Modifiers AND Drivers. Substrate (`anim/fmodifiers.js` + `anim/driver.js`), evaluator (`evaluateFCurve`), and UI panels (`FCurveModifiersPanel`) were all wired; the kernel just didn't call the canonical reducer. Post-fix the kernel calls `evaluateFCurve(fc, ctx.timeMs, { project: ctx.project })` which runs the full Blender eval chain: time-modifier pass → keyform sample → value-modifier pass → driver override.

3. **Apply Armature respects constraints.** `evalProjectFrameViaDepgraph` gained `opts.outBoneWorldMatrices: Map<boneId, Float32Array>` (additive, symmetric with existing `opts.liftedGrids`). The runner populates it post-eval by walking bones with `resolveBoneWorldFromCtx` — the constraint-aware (TRANSFORM_COMPOSE-driven) sibling of `computeBoneWorldMatrices` (which reads `node.pose` directly). `ArmatureModifierService` now passes it instead of calling the legacy helper. COPY_ROTATION / TRACK_TO / LIMIT_ROTATION on bones are honored at Apply bake time, matching viewport playback.

4. **Operator failure escalation.** New util at [src/v3/operators/reportOpFailure.js](../../src/v3/operators/reportOpFailure.js): `reportOpFailure(source, err, { opId })` → `logger.error(...)` + `toast({ variant: 'destructive', ... })`. 8 menu invokers (FileMenu, ApplyMenu, CanvasContextMenu, MergeMenu, SnapMenu, ClearParentMenu, CommandPalette, Topbar) now route through it. Failed user-invoked operators no longer look like successful no-ops.

5. **RULE-№2 metla.** 6 deprecated symbols retired wholesale (modeCompat `MODE_BLEND_SHAPE` + `MODE_EDIT_MESH`, snapMath `computeSelectionAnchor`, treeBuilder `RIG_PSEUDO_ROOT_ID` + `'hierarchy'` outliner mode, animationEngine `evaluateEasing`). Tests updated, barrel re-exports cleaned. −169 LOC of @deprecated baggage.

## RULE-№5 alternation note

The chain mostly stayed Claude/Pelmentor alternating, with one Claude→Claude pair (`9b647b3` doc + `6fb5623` RigService) when I lost track briefly. Self-corrected by leaning Pelmentor for the next two substantive commits.

## Open work — for next session

### Blocked on user

- **bug-03 Shelby handwear bbox** — I-14/I-15 shipped 2026-05-26; **NOT yet exercised** against live project. Resume branch table per the framework:
  - I-14 fires → stored-data composition bug (chain accumulation, transform.x/y, or transform.rotation × pivot cross-term)
  - I-15 fires (not I-14) → constraint solver / fcurve / driver / animated pose override
  - Only I-9 fires (neither I-14 nor I-15) → bug downstream of bone matrices, in `applyTwoBoneSkinning` or modifier walk
- **bug-01 BUG-015 BodyAngle** — needs real drag-repro in Logs (the 2026-05-02 17:49 attempt captured zero paramRow events).

### Deferred (refactor scope — substantial sessions each)

- **arch-01** `registry.js` `registerBuiltins()` 2037 LOC, 78 ops inline → split into `/operators/{shell,editor,paint,animation}/*.js` lazy sub-registries
- **arch-02** `CanvasViewport.jsx` 3794 LOC, 30+ hooks → focused components
- **arch-03** `FCurveEditor.Plot` 2700 LOC subcomponent → focused modules
- **arch-08** `selectRigSpec` (1168) + `buildRigSpecFromCmo3` (646) duplicate helpers — RULE-№4 says Cubism byte-fidelity is not a hard blocker, so dedup is now legal
- **rule-2-08** Phase 3.C "delete the standalone deformer nodes" — 13 file touchpoints, effectively superseded by v43 lattice substrate
- **rule-4-07** Lattice modifier `strength: float` + `vertex_group: string` — schema + UI + migration + tests
- **rule-2-11** preferencesStore `lastToolByMode` version-gate — needs localStorage version-migration design
- **test-05** 29 % of src .js/.jsx files (149/515) opt out of `@ts-check` — including `projectStore.js` (1955 LOC), `projectMigrations.js` (1192 LOC), `selectRigSpec.js` (1168 LOC), `cmo3writer.js` (1135 LOC)
- **test-07** `test_initRigShelbyBoneNaN` exit-0 on empty findings — pin positive assertions
- **plan-09** 4 POST_EXPORT_POLISH UX gates

### Optional next round

Completeness critic flagged classes of issue the 6-dimension run did not cover. **Run a second `Workflow`** when these become priority:

- Perf / GPU lifecycle (12 `URL.createObjectURL` vs 10 revoke; FCurveEditor bundle cost; moc3 `binaryWriter._buf` O(N) push)
- Data integrity (`src/io/projectFile.js` documents a "silent partial-save mode" — soft RULE-№1 violation by design; 13 `JSON.parse` sites without schema validation)
- Security (blob: / URL.createObjectURL lifecycle, CSP/SRI, JSON.parse on untrusted `.stretch` ZIPs)
- Workers (7 worker files untouched: psd, psdFinalize, mesh — message-schema, error propagation, pool-size limits)
- Undo memory (`undoHistory.js` holds live immer refs, MAX_HISTORY=50, no ceiling test)
- Animation tick re-entrancy
- i18n (only 5 v3 files reference `t()` vs 38 with `aria-*`)
- Accessibility (canvas overlay labels)
- 22 try/catch swallow sites in src/ — only TimelineEditor was surfaced this round
- Source unread: `src/anim/depgraph/build.js + eval.js` (depgraph core; only kernels audited), `src/io/live2d/cmo3/*` (35 files), `src/io/live2d/moc3/binaryWriter.js`, `src/store/projectStore.js` (immer root), `src/services/PersistenceService.js + projectDb.js`

## Resume hint for next Claude

Per RULE-№5 alternation: last commit was Pelmentor `9c7c90e`. Next commit must be Claude.

**Highest-ROI starting point next session:** wait for the user to re-run Init Rig and tell you what I-14/I-15 fired. That deterministically names the next code-level action per the framework branch table. Do NOT investigate handwear without re-running — pure speculation otherwise.

If the user does not have a re-run available: ask about second-round workflow (missing modalities) vs starting on architectural splits. Don't decide unilaterally — splits are session-scale work and the user may want to direct.

Per `[[invariant-checks-over-user-repro]]`: prefer instrumentation over click-to-repro, but the instrumentation IS shipped here (I-14/I-15) and only needs one re-run. That's not "user repro work" — it's "user runs the program once."
