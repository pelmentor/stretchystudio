# Rig Invariant Check

A post-Init-Rig structural validation pass that catches whole *classes*
of rig bugs from logs alone, without requiring you to click parts in
the viewport or read off values from the Properties panel.

**Source**: [`src/io/live2d/rig/rigInvariantCheck.js`](../src/io/live2d/rig/rigInvariantCheck.js)
**Wired into**: [`RigService.initializeRig`](../src/services/RigService.js) — runs immediately after `seedAllRig` writes its output into `project.nodes`, before the rigSpec cache write.
**Tests**: `npm run test:rigInvariantCheck` (33 cases as of 2026-05-26).

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
| **I-10** | Every bone's `transform.scaleX/Y` AND `pose.scaleX/Y` is in `[0.01, 100]` | The upstream of I-9. A bone with `scaleX=1000` propagates multiplicatively through the chain. Named the offending bone before depgraph even runs, so you don't need to read 19 frame bboxes to find which bone polluted them. |
| **I-11** | Every lattice cage vertex coordinate is within `100 × max(canvasWidth, canvasHeight)` | The other upstream of I-9. A lattice with cage vertices at canvas-px ≈ 1,000,000 will translate every mesh through it to that position. Body-warp chain naturally extends 0.1× past canvas edges; 100× is the corruption threshold. |
| **I-12** | Every bone's `pose.x/y` (and the v19 channels-shape `pose.channels[id].x/y` equivalent) is within `10 × max(canvasWidth, canvasHeight)` | Pose translation feeds `composed.x = pivotX + pose.x` (`anim/constraints.js:171`) which feeds the world-matrix translation via `composedTransformToBonePose` (`kernels/bonePostChain.js:84`). A `pose.x` of 800K → every skinned vertex offset by 800K → RENDERS HUGE. Catches the upstream of I-9 when scale (I-10) and pivot finiteness (I-7) both pass — the exact 2026-05-26 handwear case. |
| **I-13** | Every bone's `transform.pivotX/Y` is within `10 × max(canvasWidth, canvasHeight)` (additional to I-7's finiteness check) | I-7 catches NaN; I-13 catches finite-but-huge pivot (e.g. 800K). Combined with any non-identity rotation the `T(pivot) × R × S × T(-pivot)` algebra's cross-axis term doesn't cancel, so the resulting world-matrix translation is similarly huge. Sister of I-12: together they bracket every input to the bone world-matrix translation channel. |
| **I-14** | Every bone's STATIC-composed world matrix translation (`m[6], m[7]`) is within `10 × max(canvasWidth, canvasHeight)` — runs `computeWorldMatrices`, the same pre-constraint algebra Blender's depsgraph uses | Catches stored-data pollution that COMBINES pivot + pose + parent chain in ways the per-field invariants (I-7/I-10/I-12/I-13) don't see in isolation: a non-zero `transform.rotation` × non-zero `transform.pivot` cross-term, a non-zero `transform.x/y`, or a parent chain that accumulates per-bone offsets into a huge total. **If I-14 PASSES but I-9 still fires, the bug enters via depgraph dynamic eval, NOT stored data — see I-15.** |
| **I-15** | Every bone's `ctx.outputs.get(<boneId>/TRANSFORM/TRANSFORM_COMPOSE).transform.x/y` is within `10 × max(canvasWidth, canvasHeight)` — runs the depgraph end-to-end and reads each bone's constraint-composed output | Catches constraint-solver pollution, fcurve unit-mismatch, or any depgraph-internal composition producing huge values even when stored data (I-1..I-14) is clean. **Pairs with I-14: I-14 = static pre-constraint, I-15 = post-constraint depgraph. A fire on I-15 without I-14 narrows the source to constraint eval / animated pose override / driver path.** |
| **I-16** | Every bone's STATIC-composed world matrix NON-translation components (`m[0]=scaleX`, `m[4]=scaleY`, `m[1]=shearXY`, `m[3]=shearYX`) is within `±100` | Sister of I-14 — I-14 catches huge translation `m[6]/m[7]`; I-16 catches huge scale/shear. Bone-LBS arithmetic is `px = m[0]·x + m[3]·y + m[6]`: an `m[0]=1000` blows up canvas-px x=900 to 900K before adding translation, identical render symptom to a 900K translation. Threshold matches I-10's per-bone stored-scale ceiling because the composed matrix is a chain product — `100^N` chain composition can blow up even when each link's stored scale passes I-10 individually. **The handwear bug-03 hole: pre-I-16, a 1000× composed scale silently passed I-14 (translation finite + bounded) yet rendered at 170K×1.27M px.** |
| **I-17** | Every bone's `ctx.outputs.get(<boneId>/TRANSFORM/TRANSFORM_COMPOSE).transform.scaleX/scaleY` is within `±100` | Sister of I-15 on the scale axis. Catches eval-time scale blowup — constraint-solver amplification, fcurve unit mismatch on a scale channel, or driver chain producing huge value. Pairs with I-15 (translation) the same way I-16 pairs with I-14. |
| **I-18** | Every `mesh.runtime.keyforms[i].vertexPositions` entry's magnitude is within `±10 × max(canvasWidth, canvasHeight)` | Sister of I-5 on the magnitude axis. I-5 catches NaN/Infinity; I-18 catches finite-but-huge — rest geometry that's already corrupted BEFORE bone-skinning or warp eval. Likely sources: bone-bake reading the wrong `mesh.vertices` shape ([[mesh-vertices-dual-shape]]) and writing object-array indices into a flat slot; PSD ingest writing layer coords through the wrong frame; an upstream transform-bake producing out-of-canvas keyform positions. |
| **I-19** | Every bone's EVAL-TIME world matrix (via `resolveBoneWorldFromCtx` — the EXACT function `applyBonePostChainSkin` calls) translation `m[6]/m[7]` within `10 × max(canvas)` AND scale/shear `m[0]/m[4]/m[1]/m[3]` within `±100` | The MISSING piece bug-03 slipped through. I-14/I-16 cover STATIC composeWorldMatrices (stored algebra). I-15/I-17 cover per-bone TRANSFORM_COMPOSE. NEITHER catches the CHAIN PRODUCT of composed-pose-derived locals along the bone parent chain. Per-bone composed scale ≤ 100 individually but `100^N` chain product blows up — five bones at composed scale 4 each → chain product 1024, 800× handwear-bbox class. I-19 runs the same function the skinning kernel calls, so the matrix it inspects IS the matrix multiplied into vertex positions. |
| **I-20** | DIAGNOSTIC-ONLY: when I-9 fires on a part, re-eval the depgraph with `ctx.artMeshBboxTrace` populated so `kernelArtMeshEval` captures bbox(bufA) BEFORE the modifier loop + AFTER each modifier step + AFTER bone-skin. Emits one I-20 line per step showing the bbox at that point in the chain. | Pinpoints WHICH MODIFIER STEP blows up a part's verts when I-14..I-19 all pass but I-9 still fires. The bug-03 case after I-19 still fires alone on handwear: per-step trace names the offending modifier directly (e.g. `mod[0] warp-lifted (deformerId=BodyXWarp)` going from 1k×1k → 800k×1M), so the fix targets that specific kernel path. The trace flag is opt-in inside kernelArtMeshEval — zero overhead on clean rigs. |

## Output format

**Clean rig:**
```
INFO  rigInvariantCheck — OK | parts=19 lattices=23 bones=12 evalFrames=19 | I-1..I-13 all pass
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
| I-9 (eval huge bbox) | Same family as I-8 but the inputs were technically finite. Look for a bone matrix with very large scale (e.g. a chain where one matrix's scale multiplied through the chain accumulates), an unbounded warp grid, or a `(0,0) → far-away-point` translation that was meant to be a pivot offset. **If I-9 fires without I-10 or I-11 also firing, the scale comes from a depgraph eval-only path (e.g. constraint chain accumulation) — instrument the kernel.** |
| I-10 (bone scale out of range) | A migration / seeder / fcurve baked a scale outside ~1.0 into the bone's transform or pose. Check recent seeders + the Init Rig flow. |
| I-11 (cage extent extreme) | A lattice cage was built with vertices in screen-space, world-space, or some other frame that's not canvas-px. Look at the cage's `baseGrid` source. |
| I-12 (bone pose translation huge) | A pose channel got polluted: a draftPose write, a constraint solver write-back, a v19-channels migration that misread the source frame, an fcurve baked in a wrong-scale unit. The fix is to find the writer of `node.pose.x/y` (or `node.pose.channels[id].x/y`) for the named bone. |
| I-13 (bone pivot huge) | A seeder wrote a pivot in the wrong frame. Look for `transform.pivotX/Y` writers — `rootBoneInit.js`, `armatureFromBones.js`, the v3 bone-init flow, or whatever the `boneRole` named bone goes through. Cross-reference the `rigInit` log's seed events — anomalous pivot values often appear there minutes before I-13 fires. |
| I-14 (static composed world huge) | A combination of stored fields the per-field checks don't see together. Look at the named bone's full transform (`transform.rotation` × `transform.pivot` cross-axis term, `transform.x/y` offsets, parent-chain accumulation). If multiple bones in a chain all show small-but-non-zero values, the chain accumulation is the culprit. |
| I-15 (depgraph composed huge, I-14 clean) | Constraint solver pollution, fcurve unit mismatch (e.g. radians-vs-degrees), driver chain producing huge value, or animation pose override delivering the wrong value. Check the named bone's `constraints[]` (`reference/blender/source/blender/blenkernel/intern/constraint.cc` for evaluator semantics) and any fcurves driving its pose channels. |
| I-16 (static composed scale/shear huge, I-10 clean) | Chain composition is the culprit. `100^N` chain product can blow up even when each link's stored scale individually passes I-10. Walk the named bone's ancestor chain — multiplicative scale ≥ 100 by the time you reach the offender. Other path: a non-zero `transform.rotation` combined with a non-`1.0` scale at the root produces a non-cancelling shear m[1]/m[3]. |
| I-17 (depgraph composed scale huge, I-16 clean) | Eval-time only — constraint solver writing back scaleX/Y, fcurve unit mismatch on scale channels, driver producing huge value, or the dynamic compose cascade. Stored data is clean; check `constraints[]` and animated scale channels. |
| I-18 (keyform vertex huge, I-5 clean) | Rest geometry already huge BEFORE eval. Highest-probability source: bone-bake or PSD-ingest writing through the wrong `mesh.vertices` shape (object-array indices land in a flat slot, producing coords on the order of `1e6+`). Cross-reference the named part's `meshLayerKeyform` emission path and the `mesh.vertices` writers — `groupRotationToBone.js`, `bakeBoneRotation.js`, anything that loops over `mesh.vertices` and writes back into a Float32Array. |
| I-19 (eval world huge, I-14/I-16/I-17 clean) | Chain product blowup at eval time. Per-bone composed pose is bounded but the parent-chain composition multiplies. Trace the named bone's full chain up to root via `resolveBoneWorldFromCtx` — each level's local matrix uses composed `(x − pivotX, y − pivotY, rotation, scaleX, scaleY)`. Likely cause: a small-but-not-1.0 composed scale at every level compounds; OR a constraint solver introduces a non-zero pose offset on a bone with non-zero pivot, and the rotation-pivot cross-term doesn't cancel through the chain. Investigate the bones with `boneRole` named in I-19 violations — walk their chain in the outliner and inspect each bone's `transform` + `pose.channels[id]`. |
| I-20 (per-step trace lines) | Use the trace lines to identify WHICH STEP grew the bbox. `post-keyform-blend` huge → keyforms are corrupted (sister of I-18 on the live blend, not stored); `mod[i] warp-lifted` huge → the LIFTED grid for that warp deformer is broken (chain composition / corner-zone extrapolation in `cubismWarpEval`); `mod[i] rotation` huge → rotation MATRIX_BUILD output is huge (sister of static rotation matrix check); `post-applyBonePostChainSkin` huge → bone skinning (I-19 should have already named it, otherwise overlay-mode dispatch). Cross-reference each step with the corresponding kernel in `src/anim/depgraph/kernels/`. |

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
| 2026-05-26 | Shelby handwear-l/r bbox 173K × 1.26M px on 1792 canvas (only I-9 fired; I-10/I-11 both passed) | Motivated I-12/I-13 — the structural inputs to the bone world-matrix translation channel (`pose.x/y` and `transform.pivotX/Y` magnitude) weren't checked, so the corruption slipped past I-10 (scale-only) and I-7 (pivot-finiteness-only). Re-run after I-12/I-13 will name the polluted bone field. |

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
