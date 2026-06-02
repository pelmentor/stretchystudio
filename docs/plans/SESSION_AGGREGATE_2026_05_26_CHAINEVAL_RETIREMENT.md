# Session Aggregate — 2026-05-26 — rigInvariantCheck I-12..I-15 + chainEval Engine Retirement

Continuation of the 2026-05-25 invariant-framework session
([prior aggregate](SESSION_AGGREGATE_2026_05_25_INVARIANT_FRAMEWORK.md))
that shipped I-1..I-11. This session iterates the framework to I-15
and retires the chainEval (classic) engine end-to-end per the user's
"kill baggage" directive.

## Resume hint for compact

If you're resuming post-compact:

- **Handwear bbox bug is STILL OPEN.** I-9 fires on `handwear-l` /
  `handwear-r` at bbox 173K × 1.26M px on Shelby's 1792² canvas
  (`[747355, 544732] → [920792, 1804142]` for `-l`). I-12 / I-13 / I-14
  did not fire on the last Init Rig run — stored data is clean. I-15
  was added in `cd16afb` but the user hasn't re-run since.
- **chainEval is gone.** depgraph is the SOLE eval path in the codebase.
  Don't reach for chainEval/evalRig — those imports will error out.
  `evalProjectFrameViaDepgraph(project, paramValues, { rigSpec })` is the
  one entry point.
- **Next Init Rig run names the source.** Per the framework's branch
  table:
  - **I-14 fires** → stored data composition bug (transform.x/y,
    transform.rotation×pivot cross-term, or parent-chain accumulation)
  - **I-15 fires (not I-14)** → bug in constraint solver / fcurve /
    driver / animated pose override (depgraph dynamic eval)
  - **Only I-9 fires (neither I-14 nor I-15)** → bug is downstream of
    bone matrices, in `applyTwoBoneSkinning` or the modifier walk
    (warp lift) for bone-baked parts. At that point: instrument the
    actual divergence point, don't add more invariants.
- **DO NOT investigate handwear without re-running first.** I-15 needs
  to be exercised against the live project to narrow the source.

## Commits this session (chronological)

| Commit | Author | Description |
|--------|--------|-------------|
| `85a5813` | Pelmentor | `feat(diag): rigInvariantCheck I-12/I-13 — bone pose+pivot magnitude` — I-12 (`pose.x/y` ≤ 10× canvas, incl. v19 channels shape), I-13 (finite-but-huge `transform.pivotX/Y`). Together bracket every structural input to the bone world-matrix translation channel. +11 unit tests (28/28). |
| `cd16afb` | Claude | `feat(diag): rigInvariantCheck I-14/I-15 — static + depgraph composed bone matrix` — I-14 runs `computeWorldMatrices` (pre-constraint static composition) + asserts bone world-translation ≤ 10× canvas; catches chain-accumulation that per-field checks miss. I-15 refactors I-8/I-9 to drive `buildDepGraph`+`evalDepGraph` directly so `ctx.outputs` is reachable, then reads each bone's TRANSFORM_COMPOSE output. Pairs with I-14: I-14 = static pre-constraint, I-15 = post-constraint dynamic. +6 unit tests (33/33). |
| `146b716` | Pelmentor | `refactor(eval): retire chainEval engine — depgraph is sole eval path` — Closes the long-deferred chainEval retirement. **−9338 / +90 LOC** — biggest crutch-removal pass this branch has seen. |

Authorship tally: 2 Pelmentor + 1 Claude (RULE-№5 alternation).

## What got shipped

### 1. rigInvariantCheck I-12 / I-13 (commit `85a5813`)

The 2026-05-26 Shelby Init Rig run after the I-1..I-11 framework
shipped fired ONLY I-9 (handwear-l/r huge bbox) with I-10/I-11 clean.
Per the prior session's branch table that proved the explosion enters
via a structural field the framework didn't yet check — and the two
remaining inputs to the bone world-matrix translation channel are
`pose.x/y` (additive offset) and `transform.pivotX/Y` magnitude (I-7
only catches NaN, not finite-but-huge).

| ID | Check | Bug class caught |
|----|-------|------------------|
| **I-12** | `pose.x/y` (and v19 `pose.channels[id].x/y`) within 10× canvas | Pose translation feeds `composed.x = pivotX + pose.x` (`anim/constraints.js:171`) → `composedTransformToBonePose` (`kernels/bonePostChain.js:84`) → world-matrix translation. A `pose.x` of 800K → every skinned vertex offset by 800K. |
| **I-13** | `transform.pivotX/Y` within 10× canvas (sister to I-7's NaN check) | I-7 catches NaN; I-13 catches finite-but-huge. The `T(pivot)×R×S×T(-pivot)` algebra leaves a cross-axis residual when R≠0, so finite-but-huge pivot + any rotation = huge translation. |

Result: I-12 and I-13 BOTH pass on Shelby. Confirms stored pose +
pivot are clean. Bug enters via dynamic eval.

### 2. rigInvariantCheck I-14 / I-15 (commit `cd16afb`)

| ID | Check | Bug class caught |
|----|-------|------------------|
| **I-14** | Every bone's STATIC-composed world matrix translation (`m[6], m[7]`) within 10× canvas. Runs `computeWorldMatrices` (pre-constraint algebra Blender's depsgraph uses). | Catches stored-data pollution that COMBINES pivot + pose + rotation + parent chain in ways per-field checks (I-7/I-10/I-12/I-13) miss in isolation. Includes a 4-bone-chain unit test where `transform.x=3000` per bone accumulates to 12K. |
| **I-15** | Every bone's `ctx.outputs.get(<boneId>/TRANSFORM/TRANSFORM_COMPOSE).transform.x/y` within 10× canvas. Refactors I-8/I-9 to drive `buildDepGraph` + `evalDepGraph` directly so `ctx.outputs` is reachable. | Catches constraint-solver pollution, fcurve unit-mismatch, or any depgraph-internal composition producing huge values even when stored data (I-1..I-14) is clean. |

I-14 + I-15 together BRACKET the static-vs-dynamic distinction:
- I-14 fires → stored data composition is broken
- I-15 fires without I-14 → bug is strictly in constraint eval /
  fcurve / driver
- Both pass + I-9 fires → bug is in the bone-skin path
  (`applyBonePostChainSkin`, `resolveBoneWorldFromCtx`)

### 3. chainEval engine retirement (commit `146b716`)

Phase 7 close-out (2026-05-20) already declared depgraph the sole
VIEWPORT engine, but chainEval lived on for three reasons:
1. `ArmatureModifierService.applyArmatureModifier` — Apply-Armature bake
2. `initRig.rigInitIdentityDiag` — post-Init-Rig rest-divergence probe
3. `scripts/cubism_oracle/` — Cubism byte-fidelity A/B harness

Per RULE-№2 (no migration baggage) + RULE-№4 (Blender > Cubism) + the
user's "kill baggage" directive, all three callers are ported or
retired. depgraph is now the ONLY eval path in the entire codebase —
no more dual-engine drift surface.

#### Ports (production)

```js
// initRig.js (rigInitIdentityDiag)
- const frames = evalRig(rs, {});
+ const frames = evalProjectFrameViaDepgraph(project, {}, { rigSpec: rs });

// ArmatureModifierService.js (applyArmatureModifier)
- const frames = evalRig(rigSpec, paramValues);
+ const frames = evalProjectFrameViaDepgraph(project, paramValues, { rigSpec });
```

The `rigSpec` option is REQUIRED so selectRigSpec's modifier-toggle
reprojection fires; without it the raw `mesh.runtime` cache is in the
baked leaf frame and toggled-off modifiers land verts wrong. This is
the single biggest "swap is non-trivial" point that the audit surfaced.

#### Deletions

**src/io/live2d/runtime/evaluator/** (~2000 LOC):
- `chainEval.js` (the engine, ~1370 LOC)
- `chainDiagnose.js` (paired diagnostic)
- `cubismRotationEval.js` (only chainDiagnose used it)
- `artMeshEval.js`, `typedArrayPool.js`, `warpEval.js` (chainEval-exclusive)

**src/anim/depgraph/**:
- `sideBySide.js` (depgraph-vs-chainEval comparator)

**scripts/** (~7300 LOC):
- `scripts/cubism_oracle/` (entire directory — Cubism byte-fidelity
  A/B harness; `v3-legacy` and `cubism-setup` kernel switches die with
  chainEval)
- `scripts/bench/bench_chainEval.mjs`
- 17 test scripts (chainEval engine tests + parity tests + tests that
  used `evalRig` as expected-baseline reference)

**Test infrastructure patches:**
- `realRigHarness.mjs` — drop `evalRig` import + retire `evalRigSpec`.
  `harvestRealRig` + `seedRigSpecToNodes` stay live for the bone-NaN
  regression test.
- `test_inverseBilinearFFD.mjs` — inline a minimal `bilinearFFD`
  function (was `import { bilinearFFD } from warpEval.js`).
- `test_audit_fixes_2026_05_11_phase7d.mjs` — drop G-1a/G-1c (the
  chain-order pins on `test:typedArrayPool` adjacent to
  `test:chainEval`).

**package.json:**
- 17 dead `test:*` script definitions removed
- Master `test` chain re-wired (17 entries stripped)
- `test:rigInvariantCheck` + `test:initRigShelbyBoneNaN` ADDED to chain
  (they were orphans — defined but never invoked by master; caught by
  the G-1 chain-completeness audit guard)

### 4. Audit-before-delete lesson (RULE-№1 in action)

Before mass-deleting chainEval, I dispatched parallel agents to verify
the plan claims. Audit corrections:

| Original claim | Audit finding | Fix |
|----------------|---------------|-----|
| `evalProjectFrameViaDepgraph` is a drop-in for `evalRig` | FALSE — needs `opts.rigSpec` for modifier-toggle reprojection | Passed `rigSpec` in both port sites |
| `sideBySide.js` has zero src/ importers (purely test-only) | Agent self-contradicted: cited `CanvasArea.jsx:74-78` as a "production caller" but the cite was just a comment mentioning "chainEval frames" — no actual import. Re-grepped: TRUE, scripts-only importers | Deleted as planned |
| `rigInitIdentityDiag` is redundant with I-8/I-9 | FALSE — distinct diagnostic class (per-part rest-divergence with top-10 offender list, not a finiteness/bbox check) | Ported to depgraph instead of deleting |
| `cubismRotationEval.js` is only used by chainDiagnose | TRUE | Deleted with chainEval |
| `isQuadTransform` can be removed | FALSE — live kernel-gate, alters interpolation math | KEPT |
| `--kernel=v3-legacy` is dead | FALSE — oracle scripts use it | (user later said "kill the scripts too" → entire `scripts/cubism_oracle/` deleted) |

Lesson: when a plan involves mass-deleting based on agent claims,
RE-VERIFY each claim with a second pass before executing. One agent's
reasoning chain can be wrong (the sideBySide.js cite was a textbook
example — confident assertion, no actual import in the cited file).

## Validation (final state)

- typecheck: clean
- All 316 surviving tests in master chain pass
- Net diff for the session: **+~250 LOC framework, −~9300 LOC engine
  retirement**

## What's still open

Handwear-l / handwear-r bbox at 700K–1.8M px on Shelby's 1792² canvas:
- I-1..I-7 pass (structural)
- I-8 passes (finite verts)
- **I-9 fires** (bbox > 100× canvas)
- I-10..I-13 pass (no stored-data pollution)
- I-14 implemented but not yet run on user's live project
- I-15 implemented but not yet run on user's live project

User has NOT re-run Init Rig with I-14/I-15 active yet (the latest
re-run was against `85a5813` which had only up to I-13). Whichever of
I-14/I-15 fires names the source per the framework's branch table.

## Pattern reinforcement

This session demonstrated two RULE-№1 disciplines:

1. **Bracket the bug class before instrumenting.** I-12/I-13 added one
   layer of structural checks; I-14/I-15 added the static-vs-dynamic
   bracket. Each iteration narrowed the SOURCE class deterministically.
   When the user said "per rule 1" after two iterations, the right
   response wasn't to add a third invariant — it was to stop kicking
   the can on a third iteration AND to take the bigger lateral move
   (retire chainEval) that was the load-bearing structural issue.

2. **Audit before mass-delete.** The plan to retire chainEval initially
   claimed 6+ assertions about safety. Two of those assertions were
   wrong; both got caught by the audit pass before any file was
   deleted. Without the audit, the swap of `evalRig` → `evalProjectFrameViaDepgraph`
   would have silently broken modifier-toggle reprojection in Apply
   Armature (a subtle correctness bug, hard to detect from logs).

## Related

- Prior session aggregate:
  [`SESSION_AGGREGATE_2026_05_25_INVARIANT_FRAMEWORK.md`](SESSION_AGGREGATE_2026_05_25_INVARIANT_FRAMEWORK.md)
- Framework documentation:
  [`docs/RIG_INVARIANT_CHECK.md`](../RIG_INVARIANT_CHECK.md)
- Memory: [[rig-invariant-check-framework-shipped]],
  [[chainEval-retirement-2026-05-26]],
  [[audit-agent-claims-before-mass-delete]],
  [[invariant-checks-over-user-repro]]
