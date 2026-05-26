# Session Aggregate — 2026-05-25 — Rig Invariant Framework + Handwear Shape-Mismatch Fix

Continuation of the Shelby bone-NaN cascade work
([prior aggregate](SESSION_AGGREGATE_2026_05_24_25_BONE_NAN_CASCADE.md))
that wrapped at `a2e0220`. The bone-NaN fix held, but residual symptoms
on Shelby_neutral_ok.psd surfaced two new bug classes and motivated a
RULE-№1 meta-fix that this session ships.

## Resume hint for compact

If you're resuming post-compact:

- Read [`docs/RIG_INVARIANT_CHECK.md`](../RIG_INVARIANT_CHECK.md) for
  the framework spec (11 invariants, output format, how to add new
  checks, real bugs caught).
- The framework runs after every Init Rig via
  [`RigService.initializeRig`](../../src/services/RigService.js) →
  [`runRigInvariantChecks`](../../src/io/live2d/rig/rigInvariantCheck.js).
- One bug remains open: handwear "RENDERS HUGE" — depgraph eval
  produces handwear bbox at ~500-1000× canvas. I-9 caught and named
  it; I-10 (bone scale range) + I-11 (lattice cage extent) shipped to
  pinpoint the upstream source. User hasn't re-run with I-10/I-11 yet
  as of this aggregate.
- DO NOT investigate the remaining handwear bug without explicit user
  confirmation post-compact. The framework will name the source on the
  next Init Rig log paste.

## Commits this session (chronological)

| Commit | Author | Description |
|--------|--------|-------------|
| `23d785a` | Claude | `fix(rig)+feat(diag): handwear shape-mismatch + rigInvariantCheck framework` — `groupRotationToBone.js` shape-discriminate on write side (object-array verts → flat Float32Array); ship rigInvariantCheck framework I-1..I-7 (structural invariants) wired into `RigService.initializeRig`. +13 tests. |
| `3109b5a` | Pelmentor | `fix(diag)+docs(rig): rigInvariantCheck I-2/I-4 framework bugs + docs` — first production run on Shelby surfaced 37 violations, all framework bugs (I-2 read wrong field name for armature; I-4 used `rows×cols` when cage uses `(rows+1)×(cols+1)` points). +3 framework tests + `docs/RIG_INVARIANT_CHECK.md` (250 lines). |
| `3d30c2e` | Claude | `feat(diag): rigInvariantCheck I-8/I-9 — eval-time invariants` — when I-1..I-7 passed clean but bug persisted, added eval-time checks running same `evalProjectFrameViaDepgraph` engine the viewport uses. I-8 finiteness, I-9 bbox-extent. +1 test. |
| `3749563` | Pelmentor | `feat(diag): rigInvariantCheck I-10/I-11 — upstream of I-9 huge-bbox` — I-9 caught handwear at ~500-1000× canvas; I-10/I-11 are the structural upstreams (bone scale out of range, lattice cage extent extreme) that catch the SOURCE before depgraph runs. +3 tests. |

Authorship tally: 2 Claude + 2 Pelmentor (RULE-№5 alternation).

## What got shipped

### 1. Handwear shape-mismatch fix (commit `23d785a`)

Root cause: `src/store/migrations/groupRotationToBone.js` lines 192-208
assumed flat-array `mesh.vertices` on the write side. Shelby's
PSD-imported meshes are object-shape `[{x,y,restX?,restY?},...]`. The
pre-fix code:

```js
const n = verts.length >> 1;                          // wrong for object array
...
vertexPositions: verts.slice()                        // object array bleeds in
```

After this writes the runtime keyform, the renderer's bone LBS computes
`matrix × {x:500, y:400}` per vertex → NaN/Infinity → handwear meshes
render with vertices at ±Infinity, filling the viewport with the
handwear texture (the "gray viewport" symptom).

Fix: shape-discriminate (same pattern as the read-side fix in `94ae9f5`).
Object-shape → convert to flat `Float32Array` via `restX ?? x` /
`restY ?? y`. Flat-shape → copy as-is. `boneWeights` count derived from
actual vertex count regardless of shape.

+6 regression assertions in `test_groupRotationMigration.mjs` (21/21).

**Note**: This fix did NOT fully resolve the user-visible handwear
symptom on Shelby. The structural checks (I-5, I-6) pass, but I-9
(eval-time bbox check) still fires. So there's ANOTHER source of huge
output downstream — see "Open" below.

### 2. rigInvariantCheck framework (commits `23d785a`, `3109b5a`, `3d30c2e`, `3749563`)

Per user directive 2026-05-25 (saved as memory
[[invariant-checks-over-user-repro]]):

> You need to find a way to detect these kind of bugs instantly from
> logs, not relying too much on user. Find a way, make a framework to
> catch this kind of stuff. Per rule 1.

New module: `src/io/live2d/rig/rigInvariantCheck.js`. Runs after
`seedAllRig` in `RigService.initializeRig`. Eleven invariants:

| ID | Check | Bug class caught |
|----|-------|------------------|
| **I-1** | Every non-empty `type:'part'` has at least one entry in `modifiers[]` | Empty modifier stack → renderer at canvas origin |
| **I-2** | Every modifier ref (`objectId` for lattice, `deformerId` otherwise) resolves to a node | Dangling refs |
| **I-3** | Lattice `parent` (if non-null) resolves | v43 parent-flatten regression class |
| **I-4** | Cage `vertices.length === (rows+1)×(cols+1)` | gridSize/cage shape mismatch |
| **I-5** | `vertexPositions` is flat `Float32Array` of `2N` finite numbers | Handwear "scaled infinitely" 2026-05-25 (object-array bleed) |
| **I-6** | `boneWeights.length === vertexCount` | Sister of I-5 on bone-skin side |
| **I-7** | Bone `transform.pivotX/Y` finite | Shelby bone-NaN cascade 2026-05-25 |
| **I-8** | Depgraph `evalProjectFrameViaDepgraph` output `vertexPositions` is finite | Eval-time NaN/Infinity (handwear if ±Infinity at eval) |
| **I-9** | Depgraph output bbox extent ≤ `100 × max(canvasW, canvasH)` | Eval-time "rendered huge" (caught Shelby handwear at ~500-1000× canvas) |
| **I-10** | Bone `transform.scaleX/Y` AND `pose.scaleX/Y` in `[0.01, 100]` | Upstream of I-9 — names the polluted bone |
| **I-11** | Lattice cage vertex within `100 × max(canvasW, canvasH)` | Upstream of I-9 — names the polluted cage |

Output format: one `logger.error` per violation with offender id/name +
the smoking-gun field values inlined into the message string (per
[[inline-diagnostic-fields]] — Object payloads collapse on console
paste). Summary line groups by invariant + lists first 5 offenders by
name.

Defensive: I-8/I-9 wrap depgraph eval in try/catch — eval failure
degrades to `logger.warn` "skipped" rather than blocking Init Rig.

**Self-validation:** First production run on Shelby surfaced 37
violations — all 37 were framework bugs (I-2 read wrong field; I-4
had wrong formula). Both fixed in `3109b5a` before any user
diagnostic mileage was wasted on them.

### 3. Documentation (commit `3109b5a`)

New `docs/RIG_INVARIANT_CHECK.md` (~250 lines after `3749563` updates):

- Why the framework exists (user directive + the debug-loop pattern
  it eliminates)
- All 11 invariants in a table — bug class each catches
- Output format with real examples
- Interpretation table: violation → likely root cause → where to look
- How to add a new invariant (5 steps)
- Field-name reference (modifier types, lattice+cage relationship)
- Real bugs caught + the self-caught I-2/I-4 framework bugs
- Future work list (render-vs-eval consistency check, re-rig
  idempotency, PSD-vs-render cross-check)

### 4. Memory entries

| Entry | Purpose |
|-------|---------|
| `feedback_invariant_checks_over_user_repro.md` | The rule — when a bug surfaces from "viewport looks wrong," build a structural check; STOP asking the user to click parts |

MEMORY.md updated with the entry. New project entry
`project_rig_invariant_check_framework_shipped.md` ships in this
aggregate commit.

## Validation (final state)

- `test:groupRotationMigration` ........ 21/21 (was 15 + 6 new)
- `test:rigInvariantCheck` ............. 20/20 (added in this session)
- `test:groupRotationMigrationRealRig` . 17/17
- `test:groupWorldMatrices` ............ 21/21
- `npm run typecheck` .................. clean

## What's still open

User reported on the final Init Rig run (commit `3d30c2e` shipped):
- `rigInvariantCheck` I-9 fires on handwear-l + handwear-r (bbox
  ~500-1000× canvas)
- Visually: head detached at top-left, gray viewport from handwear
  rendering at huge scale

This means depgraph's eval produces handwear verts at hundreds of
thousands of pixels on a 1792×1792 canvas. The handwear shape-mismatch
fix (commit `23d785a`) corrected the stored data but a different path
ALSO produces the huge output.

I-10 (bone scale range) and I-11 (lattice cage extent) shipped in
`3749563` to surface the structural upstream of the I-9 violation.
User has NOT re-run Init Rig with I-10/I-11 yet — that re-run is the
next step on resumption.

Expected outcomes on the next Init Rig log:
- **I-10 fires** → names the bone whose scale is corrupted. Direct fix.
- **I-11 fires** → names the lattice whose cage is in the wrong frame.
  Direct fix.
- **Only I-9 fires** (no I-10/I-11) → the scale enters via dynamic eval
  (constraint chain, fcurve, etc.), not stored data. Next step is
  kernel-level instrumentation per the framework's "Future work" doc
  section.

Whichever fires names the source; the user does not need to click
anything in the viewport.

## Pattern reinforcement: the framework loop

This session demonstrated the value of the invariant framework over the
prior ping-pong debugging style. Compare:

**Pre-framework (2026-05-24/25 bone-NaN cascade):**
1. User: "viewport broken"
2. Multiple Agent spawns on different hypotheses
3. Multiple AskUserQuestion turns ("click the displaced part — what
   does Properties show?")
4. Manual diagnosis cycle 30+ minutes
5. Fix shipped

**With framework (this session):**
1. User: "still gray, head flies away"
2. I-9 fires, names handwear-l + handwear-r + their bboxes
3. Add I-10/I-11 to narrow source class (bone scale vs cage extent)
4. Re-run names the polluted source
5. Direct fix

The user explicitly noted (2026-05-25):
> Documentize the framework — that's a good way to find what's wrong

Memory [[invariant-checks-over-user-repro]] enforces this discipline
across future sessions. The principle: when a bug surfaces from
"viewport looks wrong," BUILD a structural invariant check that fires
from logs; do NOT ping-pong with the user.

## Related

- Prior session aggregate:
  [`SESSION_AGGREGATE_2026_05_24_25_BONE_NAN_CASCADE.md`](SESSION_AGGREGATE_2026_05_24_25_BONE_NAN_CASCADE.md)
- Framework documentation:
  [`docs/RIG_INVARIANT_CHECK.md`](../RIG_INVARIANT_CHECK.md)
- Memory: [[invariant-checks-over-user-repro]],
  [[mesh-vertices-dual-shape]], [[inline-diagnostic-fields]],
  [[shelby-invisible-bones-fix-2026-05-25]]
