# Rig Invariant Check

A post-Init-Rig structural validation pass that catches whole *classes*
of rig bugs from logs alone, without requiring you to click parts in
the viewport or read off values from the Properties panel.

**Source**: [`src/io/live2d/rig/rigInvariantCheck.js`](../src/io/live2d/rig/rigInvariantCheck.js)
**Wired into**: [`RigService.initializeRig`](../src/services/RigService.js) — runs immediately after `seedAllRig` writes its output into `project.nodes`, before the rigSpec cache write.
**Tests**: `npm run test:rigInvariantCheck` (16 cases as of 2026-05-25).

## Why this exists

Pre-framework debug loop for a typical viewport regression:

1. User: "after Init Rig, the head is detached"
2. Assistant: "click the displaced part — what does the Properties panel show? What's the pivot? Is it a part or a group? Can you select Rig Warp and tell me its parent?"
3. User: clicks, reads, types
4. Assistant: spawns three exploration agents on different hypotheses
5. Repeat for 30+ minutes

User directive (2026-05-25):

> You need to find a way to detect these kind of bugs instantly from
> logs, not relying too much on user. Find a way, make a framework to
> catch this kind of stuff. Per rule 1.

This module is that framework. Every reported "viewport looks wrong"
bug should either be caught by an existing invariant or be the
inspiration for a new one — that way the next person who hits the
same class of bug sees the smoking-gun field values in the Logs
panel without doing any UI archaeology.

## What it checks (current set)

Each invariant is a single structural assertion. A violation produces
one `logger.error('rigInvariantCheck', ...)` line with the offender's
id + name + the failing field values **inlined into the message
string** (per [[inline-diagnostic-fields]] — the user's console paste
collapses `Object` payloads to `[object Object]`, so the message
string is the only reliable surface for paste-back diagnostics).

| ID | Invariant | Catches |
|----|-----------|---------|
| **I-1** | Every `type:'part'` node with a non-empty mesh has at least one entry in `modifiers[]` | Empty modifier stack → renderer falls back to root frame → part renders at canvas origin (face-displacement class) |
| **I-2** | Every `modifiers[i]`'s reference (`objectId` for `type:'lattice'`, `deformerId` otherwise) resolves to a node in `project.nodes` | Dangling refs → `synthesizeModifierStacks` walk breaks at that link |
| **I-3** | Every `objectKind:'lattice'` node's `parent` (if non-null) resolves to a node | The v43-flatten regression class — parent string lost in conversion → renderer reads null parent |
| **I-4** | Each lattice's `dataId` points at a cage whose `vertices.length === (rows+1) × (cols+1)` | Cage shape mismatches lattice `gridSize` |
| **I-5** | Every `mesh.runtime.keyforms[i].vertexPositions` is a `Float32Array` (or numeric array) of length `2 × vertexCount`, all entries finite | Caught the **handwear "scaled infinitely" regression** (2026-05-25): an object-array `[{x,y},...]` written into the flat-array field, propagating `{x,y}` objects into bone-LBS arithmetic → ±Infinity vertex positions → handwear fills viewport |
| **I-6** | If `mesh.jointBoneId` is set, `mesh.boneWeights.length === vertexCount` (regardless of `mesh.vertices` shape) | Sister of I-5: same shape-mismatch class on the bone-skin side |
| **I-7** | Every node with `boneRole` has finite `transform.pivotX/Y` | The **Shelby bone-NaN cascade** (2026-05-25): `deriveCanvasPivot` returning `NaN` for object-shape verts → SkeletonOverlay NaN flood |
| **I-8** | Every depgraph-evaluated frame's `vertexPositions` contains only finite numbers | The "gray viewport" class — bone-LBS or warp eval produced ±Infinity verts → mesh fills entire viewport. Runs `evalProjectFrameViaDepgraph` (the SAME engine `CanvasViewport.jsx:1009` uses). |
| **I-9** | Every depgraph-evaluated frame's bbox extent is ≤ `100 × max(canvasWidth, canvasHeight)` | Sister of I-8 — catches "rendered huge but not actually Infinity" cases (a part scaled by 50× would silently render as a giant gray rectangle). Threshold of 100× is deliberately loose; tighter thresholds are project-specific. |

## Output format

**Clean rig:**
```
INFO  rigInvariantCheck — OK | parts=19 lattices=23 bones=12 | I-1..I-7 all pass
```

**Violations:**
```
ERROR rigInvariantCheck — I-5 | id=handwear-l name=handwear-l | keyforms[0].vertexPositions[0] is non-finite (value=[object Object])
ERROR rigInvariantCheck — I-6 | id=handwear-l name=handwear-l | mesh.jointBoneId="grp-..." boneWeights.length=139 but vertexCount=278
ERROR rigInvariantCheck — FAIL | 2 violation(s) | by-invariant: I-5=1, I-6=1 | first-5: I-5/handwear-l, I-6/handwear-l
```

The summary line groups violations by invariant ID so you see the
*class* of bug at a glance; the per-violation lines name the
offender + the specific failing field values.

## How to interpret violations

| Class | Likely cause |
|-------|--------------|
| I-1 (empty modifiers) on face/head parts | Modifier-stack synth didn't reach face-region parts. Look at `synthesizeModifierStacks` in `deformerNodeSync.js` and the resolution chain for non-bone-baked parts. |
| I-2 (dangling refs) | A migration removed a node but didn't rewrite the refs that pointed at it. Look at the most recent retired field in `MEMORY.md`. |
| I-3 (lattice parent unresolved) | An `upsertWarpAsLattice` call lost the `parent` field. Check `warpSpecToDeformerNode` → `warpNodeToLatticeNodes` for the lattice in question. |
| I-4 (cage shape mismatch) | Either the seeder built the cage wrong, or the lattice's `gridSize` was changed without re-seeding the cage. |
| I-5 (vertexPositions shape) | The dual-`mesh.vertices`-shape footgun ([[mesh-vertices-dual-shape]]). Object-array verts copied into a flat-array field. Catalog of known write sites: `groupRotationToBone.js`. |
| I-6 (boneWeights count mismatch) | Same shape-mismatch class as I-5, on the skinning side. |
| I-7 (NaN bone pivot) | `deriveCanvasPivot` returned `NaN`. See [[typeof-nan-is-number]] + [[shelby-invisible-bones-fix-2026-05-25]]. |
| I-8 (eval Infinity) | The depgraph's bone-LBS / warp eval produced non-finite output. Check bone matrices (`makeBoneLocalMatrix`, `mat3MulInto` chain), skin weights, parent matrix lookups. The bug is at RENDER time, NOT in `project.nodes` — structural checks I-1..I-7 will pass. |
| I-9 (eval huge bbox) | Same family as I-8 but the inputs were technically finite. Look for a bone matrix with very large scale (e.g. a chain where one matrix's scale multiplied through the chain accumulates), an unbounded warp grid, or a `(0,0) → far-away-point` translation that was meant to be a pivot offset. |

## How to add a new invariant

When you discover a new bug class that can be expressed as "a structural
property of `project.nodes` that should always hold post-Init-Rig":

1. Pick an unused ID (`I-8`, `I-9`, …).
2. Add the check inside `runRigInvariantChecks` in
   [`rigInvariantCheck.js`](../src/io/live2d/rig/rigInvariantCheck.js).
   Use the `violate(invariant, id, name, message)` helper. The
   message string must include every smoking-gun field value
   verbatim (no `${JSON.stringify(obj)}` — that produces unreadable
   blobs on paste).
3. Add a row to the table above.
4. Add at least one positive-fixture test (clean → ok=true) and one
   negative-fixture test (violated → ok=false) in
   [`test_rigInvariantCheck.mjs`](../scripts/test/test_rigInvariantCheck.mjs).
5. Run `npm run test:rigInvariantCheck` and `npm run typecheck`.

**Design rule.** Invariants I-1..I-7 are *purely structural* — they
read `project.nodes` fields directly with no eval/render/transform.
Invariants I-8 and I-9 are *eval-time* — they run
`evalProjectFrameViaDepgraph` (the same engine the viewport uses)
once and inspect its output. Eval-time checks catch the bug class
where `project.nodes` looks correct but the renderer still produces
±Infinity (handwear at-infinity 2026-05-25). Defensively wrapped in
try/catch — eval throwing degrades to skipped checks rather than
blocking Init Rig.

When adding a new invariant: classify it as **structural** (cheap,
runs always) or **eval-time** (one extra evalRig, runs only once at
end-of-Init-Rig) and place it in the corresponding section.

## Field-name reference

Modifier types and their reference field — verified against
[`ArmatureModifierService.js`](../src/services/ArmatureModifierService.js)
and `synthesizeModifierStacks`:

| `modifier.type` | Reference field | Points at |
|----------------|------------------|-----------|
| `'lattice'`    | `objectId`       | The lattice `type:'object'` node |
| `'armature'`   | `deformerId`     | The joint bone (a `type:'group'` node with `boneRole`) |
| anything else  | `deformerId`     | The deformer node |

Lattice + cage relationship:

```
{type:'object', objectKind:'lattice', id, name, parent, dataId, gridSize:{rows,cols}, …}
                                                       │
                                                       ▼
{type:'meshData', id:<dataId>, isLatticeCage:true, gridSize:{...}, vertices: <(rows+1)*(cols+1) points>}
```

`gridSize.{rows,cols}` counts **cells**, not points. The cage has
`(rows+1) × (cols+1)` point vertices laid out in row-major order.

## Real bugs the framework already caught

| Date | Bug | Invariant that fired |
|------|-----|---------------------|
| 2026-05-25 | Handwear vertices at ±Infinity (object-array verts in flat field) | I-5 (would have fired pre-fix; commit `23d785a` ships the framework AFTER the fix) |
| 2026-05-25 | First framework run found 14 I-2 + 23 I-4 violations on Shelby PSD post-Init-Rig | Both were FRAMEWORK BUGS surfaced by the framework itself — `armature` modifier uses `deformerId` not `boneId`; `gridSize` counts cells not points. Both fixed in the same commit that added the framework. |

The framework is self-validating in the sense that its first
production run uncovered its own incorrect assumptions before any
user-facing diagnostic mileage was lost on them.

## Future work

Things this module deliberately does NOT check (yet) — each could
be a sibling framework:

- **Render-vs-eval consistency.** Probe both the depgraph and the
  chain evaluator with the same params and assert they produce
  identical outputs at a handful of probe points. The existing
  `rigInitIdentityDiag` measures chainEval output; I-8/I-9 measure
  depgraph output. A future check would assert they agree, catching
  the engine-drift class (the original
  `evalProjectFrameViaDepgraph`-vs-`evalRig` cutover bugs).
- **Re-rig idempotency.** Save the rigSpec, re-run Init Rig, diff —
  any drift is a non-idempotent stage.
- **PSD-source vs rendered position cross-check.** Store the
  original PSD layer center; after Init Rig, log delta between
  PSD center and the part's rendered canvas position; flag if >
  threshold. Catches the wholesale "PSD layout vs rig layout"
  desync that user reported on 2026-05-25.

## Related

- [[invariant-checks-over-user-repro]] — the user directive that
  motivated this module
- [[inline-diagnostic-fields]] — paste-friendly message format
  (Object payloads collapse, so smoking-gun fields go in the
  message string)
- [[mesh-vertices-dual-shape]] — the object-vs-flat footgun I-5
  and I-6 exist to catch
- [[shelby-invisible-bones-fix-2026-05-25]] — the prior bug that
  motivated I-7
- [[feedback_in_app_logging]] — the broader observability
  discipline this is one piece of
