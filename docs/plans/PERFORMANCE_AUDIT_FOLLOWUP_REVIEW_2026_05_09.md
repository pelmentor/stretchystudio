# Plan-review cycle — performance follow-up plan, 2026-05-09

Companion to:
- [PERFORMANCE_AUDIT_2026_05_09.md](./PERFORMANCE_AUDIT_2026_05_09.md) — punch list + ship status
- [PERFORMANCE_AUDIT_FOLLOWUP_PLAN.md](./PERFORMANCE_AUDIT_FOLLOWUP_PLAN.md) — implementation plans for the 12 deferred items (revised per this review)

This doc records the **plan-review cycle** that ran on 2026-05-09
between the first draft of the follow-up plan (commit `1b9772a`)
and the revised plan (commit `8f8d8ed`). Eight substantive
findings landed; all eight were verified against actual source
before the plan was changed.

The point of preserving this isn't the audit report itself —
that's folded back into the plan. It's the **review methodology**
and the **patterns** the review surfaced, so future plan reviews
have a reference for the depth of scrutiny needed and the kinds
of mistakes a planner is prone to make.

## Review setup

| | |
|---|---|
| Plan reviewed | `docs/plans/PERFORMANCE_AUDIT_FOLLOWUP_PLAN.md` (commit `1b9772a`) |
| Reviewer | Code-reviewer agent (`feature-dev:code-reviewer` subagent) |
| Brief | Confidence-filtered findings only; check root-cause accuracy + Rule №1 compliance + dependency claims + test gates |
| Reading scope | Full plan, companion punch list, all five shipped commits (`6653926`..`bd6db98`), spot-checked source files |
| Output format | Severity-grouped report (Blockers / Wrong as stated / Weak gates / Sequencing / Suggested additions) |

## Methodology

The reviewer was briefed to:

1. **Spot-check every file:line citation.** Open the cited file,
   confirm the cited line/range matches the description.
2. **Audit each fix proposal for crutchlessness.** Specifically:
   silent fallbacks, "for now" / "until X lands" language, no-op
   shims, cache invalidation keys that miss real input dependencies.
3. **Check dependency claims.** Items the plan said were
   independent — verify via grep that no shared code path links
   them. Items the plan paired — verify the pairing is necessary,
   not just convenient.
4. **Audit test gates.** For each plan, walk the cited tests and
   check they actually exercise the changed surface.
5. **Walk specific concerns** that the planner flagged (P1 audit
   completeness, R3 buffer aliasing, P4 cache invalidation, M7
   hit-test scope, R12 data flow).

Every finding was confidence-rated; only findings ≥ 80%
confidence were included in the report.

## Findings

### B1 — P4 cache key didn't cover all input mutations

**Confidence: 100.**

The plan claimed `versionControl.geometryVersion` plus a
per-subsystem configHash would catch all input changes for
the harvest cache. Verification:

```text
grep -nE "geometryVersion\+\+|state.versionControl.geometryVersion" src/store/projectStore.js
```

Returned 10 sites (mesh edits, blend-shape ops, pivot, reset,
load, splits — all geometry-side). None of the five config seed
actions (`seedAutoRigConfig`, `seedBoneConfig`,
`seedEyeClosureConfig`, `seedRotationDeformerConfig`,
`seedVariantFadeRules`) bump it. So a user editing
`autoRigConfig` then running a keyform stage would hit a stale
geometryVersion cache and silently get the prior harvest.

**Why the planner missed it.** Conflated "version counter"
with "everything-changed counter." `geometryVersion` is
deliberately scoped to geometry; that's the right semantic. The
plan should have read both halves of the cache key as
load-bearing, with the configHash carrying the config-mutation
signal.

**Resolution.** [PERFORMANCE_AUDIT_FOLLOWUP_PLAN.md §P4](./PERFORMANCE_AUDIT_FOLLOWUP_PLAN.md)
now states explicitly: configHash is load-bearing for
config-only mutations; the cache check is the conjunction
`cached.geometryVersion === current && cached.configHash === current`.
Each `runStage` call recomputes the configHash; a stale half
fails the check.

### B2 — R12 wasn't a single-line short-circuit

**Confidence: 95.**

The plan claimed R12 was "one-line on top of R1's gate":
`if (realCount === 0) valuesForEval = paramValuesRef.current`.

Verification against [src/components/canvas/CanvasViewport.jsx:660-725](../../src/components/canvas/CanvasViewport.jsx#L660-L725):

- `valuesForEval` is set at line 682 (with-physics) or 686
  (no-physics), both **upstream** of R1's `realCount`
  computation at lines 711-720. The proposed insertion point
  ("at the bottom of the livePreview branch") is not adjacent
  to where `valuesForEval` is set; an implementer following
  the plan literally would put the override in the wrong place.

- More subtly: when `realCount === 0`, the breath/look/blink
  values in `updates` are within `PARAM_DELTA_EPSILON` of the
  prior store values. So
  `working = { ...paramValuesRef.current, ...updates }` is NOT
  bit-equal to `paramValuesRef.current` — the merged updates
  are sub-epsilon different. Substituting
  `paramValuesRef.current` yields a ref-stable but
  value-different result vs the prior frame.

This second finding is the deeper one: the cache fill stores
`paramValues: valuesForEval`, and on the next idle frame, the
cache check uses identity. For the cache to hit on idle frames,
`paramValuesRef.current` must equal `valuesForEval` from the
prior fill — which means `paramValuesRef.current` must be
**advanced synchronously** after every `setMany`, not lazily
via React re-render commit.

**Why the planner missed it.** Treated `realCount === 0` as
"nothing changed" instead of "no value crossed epsilon." The
two are not the same — sub-epsilon updates still differ from
the prior store value bit-wise. Also assumed
`paramValuesRef.current` automatically tracks setMany; it
doesn't (it's a render-time ref, lags by one commit).

**Resolution.** Plan §R12 rewritten as a coordinated 3-touch
change: always set `valuesForEval = paramValuesRef.current`,
manually advance `paramValuesRef.current` after every
`setMany`, and verify the cache fill stores the right
reference. Effort revised from 1-2h to 2-3h.

### W1 — M7 root cause described the wrong code path

**Confidence: 95.**

The plan stated `imageDataMapRef` is used for "click-to-select
alpha picking" generally. Verification at
[src/io/hitTest.js:180-260](../../src/io/hitTest.js#L180-L260):

- Line 188: triangulated mesh path runs first for parts with
  triangles.
- Line 197/203/222: `continue` once the triangle path matches.
- Line 245: `imageDataMap` only read when reaching it — i.e.,
  when no finalVerts, no rig verts, and no triangulated mesh.
- Comment at line 225-244 explicitly: "Pre-mesh hit-test priority
  for PSD-imported parts (wizard Reorder / Adjust steps before
  auto-mesh runs)."

So `imageDataMapRef` is only consumed during the wizard's
reorder/adjust window. Once auto-mesh runs, the entries become
**dead weight memory** — never read for hit-test, never freed
until project reset. The 200 MB JS heap waste is real, but the
fix the plan described (downsample) only helps for parts that
don't get meshed (the wizard window). Most of the savings
comes from pruning entries on auto-mesh completion.

**Why the planner missed it.** Read the audit description
without tracing the actual hit-test code path. The audit
agent who flagged M7 originally also wasn't precise about the
pre-mesh scope — both passes assumed the entries were live for
the lifetime of the project. Triangle-path priority makes them
dead after auto-mesh.

**Resolution.** Plan §M7 split into M7a (prune entries on
auto-mesh completion — 95% of the win, 1h effort) + M7b
(256² downsample for wizard-window entries that don't get
meshed yet — 3-4h, also clarifies this surface is coarse
positional, not pixel-precise).

### W2 — P10 step kept a synchronous fallback (Rule №2 violation)

**Confidence: 90.**

Plan §P10 step 2 said: "keep `importPsd` as the synchronous
fallback (some test paths use it), add `importPsdAsync`."

That's exactly the "no-op shim / transition path for
deferred-forever plans" that Rule №2 prohibits. Once both paths
exist, callers will use whichever is convenient at the call
site, and the synchronous path will live forever in the
codebase. Tests using the sync path is not a reason to keep
the production sync export — it's a reason to fix the test
environment.

**Why the planner missed it.** Conflated "tests need a path
that runs synchronously in Node" with "production code needs a
synchronous fallback." The two are separable: tests can use a
test-env worker shim that runs the worker module body inline
when `Worker` is undefined; production code uniformly uses the
async path.

**Resolution.** Plan §P10 step 2 now: "**replace** the
synchronous `importPsd` export with the async one. **No
synchronous fallback path** — Rule №2 prohibits keeping a
transition shim alongside the proper implementation." Step 3
adds the inline worker shim for the test environment.

### G1 — R3 buffer-aliasing risk vs R12's cache reuse

**Confidence: 85.**

Plan §R3 acknowledged "the externally-returned `vertexPositions`
stays freshly-allocated" but treated this as a casual note, not
an invariant.

Verification: chainEval's ping-pong
([src/io/live2d/runtime/evaluator/chainEval.js:215-299](../../src/io/live2d/runtime/evaluator/chainEval.js#L215-L299))
uses `meshState.vertexPositions` as bufA. The returned
`vertexPositions` (line 296) is whatever bufA points to at
chain end. With R12 shipping, `lastEvalCacheRef.current.frames`
holds these references across tick boundaries. If R3's pool
recycles backing buffers under the same key, the next eval
that misses the cache silently mutates the prior frame's
`vertexPositions` while R12's cache hit path is still reading
them.

**Why the planner missed it.** Drafted R3 in isolation from
R12. The interaction shows up only when both ship.

**Resolution.** Plan §R3 now defines a strict **two-class
distinction** in the pool: INTERNAL buckets (recycled per
eval) vs EXTERNAL buckets (never recycled — `vertexPositions`
class). New regression test
`test_typedArrayPoolAliasing.mjs`: capture a `vertexPositions`
ref, run another eval, assert the captured ref's contents are
unchanged. This pins the EXTERNAL invariant in CI.

### D1 — R12 sequencing was wrong

**Confidence: 80.**

Plan put R12 in Group 2 alongside R3 ("piggy-backs because it
shares the eval-cache surface"). But R12 is independent of
R3's surface — the cache fill and hit logic doesn't change
based on whether buffers are pooled. Once G1's invariant is
enforced, R12 is safe to ship before R3.

R12 also has lower risk than R3 (no byte-fidelity surface) and
high impact (eval cache hit on every idle frame). The
"Notes for the implementer" section already said R12 should
ship first, but the sequencing table contradicted it.

**Resolution.** R12 moved to Group 1 (mechanical wins). Group
2 is R3 alone. Plan's "Notes" section now matches the
sequencing table.

### A1 — P1 missed two `structuredClone` sites

**Confidence: 95.**

Plan §P1 root cause cited only `pushSnapshot` (line 73-78) as
the structuredClone site. Verification:

```text
grep -nE "structuredClone" src/store/undoHistory.js
```

Returned three sites:
- Line 74: `pushSnapshot` (push current state for undo)
- Line 122: `undo()` (push current state to redo stack)
- Line 135: `redo()` (push current state to undo stack)

Every undo and redo pays the clone cost again. The plan's
step list covered the push-direction rewrite but never
mentioned undo/redo direction; an implementer following it
literally would ship a half-fix.

**Why the planner missed it.** Read the file partially —
focused on `pushSnapshot` and stopped.

**Resolution.** Plan §P1 root cause now names all three sites.
Steps 4 explicitly cover `undo()` and `redo()` rewrites:
"apply `inversePatches` / `patches` to current state via
immer's `applyPatches`. **No clone of the prior state** — the
redo direction is the patches we already have on the stack."

### A2 — P4 config-hash was too coarse

**Confidence: 80.**

Plan §P4 proposed hashing the full `autoRigConfig` record
along with the other config records. `autoRigConfig` contains
sub-records for `faceParallax`, `bodyWarp`, `neckWarp`,
`rigWarps`. The keyform stages each consume ONE sub-record;
hashing the full record causes cross-stage cache invalidation
when any sub-record changes.

Concrete scenario: user runs `bodyWarpChain` (cache fills),
edits a `faceParallax` opt-out flag in `autoRigConfig`, runs
`bodyWarpChain` again. The full-record hash changes, cache
miss, full re-harvest — even though `bodyWarp` data is
unchanged.

**Why the planner missed it.** Treated `autoRigConfig` as a
monolith because that's how it appears in the store; didn't
audit the per-stage consumer pattern.

**Resolution.** Plan §P4 now defines a per-stage subset table
(`faceParallax` hashes `autoRigConfig.faceParallax` +
`eyeClosureConfig` + `rotationDeformerConfig`; `bodyWarpChain`
hashes `autoRigConfig.bodyWarp` + `boneConfig` +
`bodyWarpLayout`; etc.). Each stage's cache key is independent.

## Patterns the review surfaced

These are the kinds of mistakes the original plan was prone to.
Future plan reviews should weight these heavily:

### Pattern 1 — version counters / hash keys that miss real inputs

(B1, A2 instances.) When a plan proposes "memo on X", verify X
moves on every actual input change. Counters scoped by
semantic meaning (e.g. `geometryVersion`) deliberately don't
move on adjacent state changes. Hash keys over composite
records may be too coarse if consumers only read sub-records.

**Review check:** for every cache key, list every consumer
input. Cross-check that mutation paths for each input either
bump the counter half OR invalidate via the hash half.

### Pattern 2 — "single-line short-circuit" claims that hide coordination

(B2 instance.) Plans describing fixes as one-liners often
under-specify the surrounding state-flow constraints. The R12
fix needed three coordinated touches (advance ref after
setMany; always-paramValuesRef.current for valuesForEval;
verify cache stores the right ref) that all had to land
together for the cache hit to actually trigger.

**Review check:** any plan step that says "single line" or
"trivial" — re-read the surrounding 50 lines to find the
implicit coordination requirements. If the fix touches a
`useRef` value, ask: when does the ref advance? Is the
surrounding code path consistent with that timing?

### Pattern 3 — describing a fix without tracing the consumer

(W1 instance.) M7 talked about hit-test in general; the
actual consumer was a narrow pre-mesh path with a triangle-path
priority above it. Without tracing the consumer's branch
priority, the plan fixed the wrong thing.

**Review check:** for any plan that touches a data-flow
endpoint, find the consumer in the actual source and trace the
priority chain (early returns, continue, branch flags). The
"used by hit-test" claim is not enough — find the specific
branch and confirm the data is read there.

### Pattern 4 — "transition shim" framing of Rule №2 violations

(W2 instance.) Plans that say "keep the old path for tests" or
"add the new path alongside" are exactly the Rule №2 footgun.
Tests are not a reason to keep production code; they're a
reason to fix the test environment.

**Review check:** for every "keep X for now" or "add Y
alongside X" — ask: does this need to live forever, or until a
specific event? If forever, it's a Rule №2 violation. If until
an event, the plan needs to specify the removal trigger AND the
mechanism that ensures the trigger fires.

### Pattern 5 — drafting items in isolation

(G1 instance.) R3 and R12 each looked safe independently. The
buffer-aliasing risk only emerges when both ship — R12 holds
prior frames refs across ticks; R3 recycles their backing
buffers. Plans that pair items need to cross-check the
interaction surface, not just the individual items.

**Review check:** for any plan with multiple related items,
construct a 2x2 matrix (X shipped + Y shipped, X shipped + Y
not, etc.) and ask: in each cell, is the system consistent?
Look specifically for ref-holding consumers across tick
boundaries.

### Pattern 6 — partial reads of source files

(A1 instance.) Reading the first matching site and stopping
misses subsequent sites that share the same anti-pattern. The
P1 plan named one `structuredClone` call site; the actual file
had three.

**Review check:** for every cited file, run a grep over the
full file for the named anti-pattern. If multiple sites match,
the plan must cover all of them.

## Notes for future plan reviews

- **Confidence-filtering matters.** The reviewer was briefed
  to skip nits and report only ≥ 80% confidence findings. All
  eight reported items survived verification. A nit-heavy
  review would have buried the blockers.
- **Verify against actual source, not the plan.** Every finding
  here was confirmed by opening the cited file and reading the
  surrounding code. Plans-that-seem-right-on-paper-but-wrong-on-disk
  is the failure mode.
- **The reviewer's spot-check list (the "specific concerns to
  investigate" section of the brief) is what surfaced B1, B2,
  G1.** Future plan reviews should brief the reviewer with a
  specific list of "things I'm not sure about" — these are the
  load-bearing assumptions that need verification.
- **Patterns generalize.** The six patterns above will recur
  across plans for any domain. Reference them in the brief for
  the next plan review.

## Commit trail

| | |
|---|---|
| First plan draft | `1b9772a` |
| Audit ran | This session, 2026-05-09 |
| Revised plan | `8f8d8ed` |
| This review doc | (next commit after this write) |
