# Performance audit follow-up — implementation plans

Companion to [PERFORMANCE_AUDIT_2026_05_09.md](./PERFORMANCE_AUDIT_2026_05_09.md).
That doc tracks the punch list + ship status; this doc plans out
each deferred item per **RULE №1** (no quick-and-dirty fixes,
no silent fallbacks, no "fix later" code).

Each plan specifies: root cause, proper fix, concrete steps,
test gates, dependencies, risk class, estimated effort, commit
shape. Plans are ordered for the natural commit sequence — a few
items are paired (R1 → R12, R3 → R12, P10 → P2) and noted.

## Sequencing

Recommended commit order, grouped by risk. Anything in the same
group can ship in any order; cross-group items depend on prior
groups landing.

| Order | Group | Items | Why this order |
|---|---|---|---|
| **1** | Mechanical | P6, P10, M9, R4, **R12** | Pure algorithm/refactor wins. Each is one focused commit, low byte-fidelity risk. P10 unblocks P2's worker-pool reuse. R12 moves here from Group 2 — review found it independent of R3 once R3's external-buffer invariant is enforced (see G1). |
| **2** | Eval-graph alloc surgery | R3 + M1 + M2 | Single typed-array pool fix retires the chainEval/kernel allocation storm. **Byte-fidelity-critical** — runs the full oracle + breath + shelby gate. **Hard invariant**: pool buckets backing externally-returned `frames[i].vertexPositions` MUST NOT be recycled within the pool — otherwise R12's cache hit path (which holds prior `frames` refs) gets silently corrupted on the next eval. |
| **3** | Subscription tightening | R2, S2 | Both touch React subscription patterns. Independent of eval-graph work but cleaner to land after the renderer settles. |
| **4** | Memory ceilings | M7a + M7b | Two-step: M7a prunes `imageDataMapRef` entries on auto-mesh completion (where the entries become dead weight); M7b downsamples the remaining wizard-window entries to a 256² alpha mask. Most of the 200 MB win is M7a. |
| **5** | Pipeline refactors | P4, P1, P2 | The three biggest single rewrites. Each its own multi-day plan; no shared dependency between them so order is by impact-vs-risk. |

## Plan: P6 — mesh dedup spatial hash

**Root cause.** [src/mesh/generate.js:107-121](../../src/mesh/generate.js#L107-L121) dedups
candidate points with `for (const [dx, dy] of deduped)` against the
growing accumulator — O(N²). Same shape at
[src/mesh/sample.js:42-52](../../src/mesh/sample.js#L42-L52)
(`filterByEdgePadding`: O(interior × edge)). Both grow when the user
picks finer mesh-grid spacings on big parts.

**Proper fix.** Spatial hash bucket keyed by
`Math.floor(x / MIN_DIST) | 0`. Lookup neighbours in the 3×3 cells
around the candidate; rejects in O(N) total over the input.

**Steps.**
1. New module `src/mesh/spatialHash.js` exporting a tiny class:
   `SpatialHash(cellSize)` with `add(x,y,payload)`,
   `forEachWithinRadius(x,y,r,cb)`. No external deps.
2. `generate.js` dedup loop: replace inner `for (const [dx,dy] of deduped)` with `spatialHash.forEachWithinRadius(px, py, MIN_DIST, ...)`.
3. `sample.js` `filterByEdgePadding`: same pattern with edge points
   indexed in the hash.
4. New unit test `scripts/test/test_spatialHash.mjs` — exhaustive
   neighbour-query correctness.

**Gates.** `npm run test:spatialHash` (new),
`npm run test:meshSample`, `npm run test:meshPostProcess`,
`npm run test:meshSync`. Visual: regenerate mesh on a high-res
part with default + tightest grid spacing, vertex count must match
prior run within ±1 (interior dedup is order-sensitive at exact
boundaries).

**Dependencies.** None.

**Risk.** Low. Pure algorithm swap.

**Effort.** 2–3h.

**Commit shape.** Single commit: `perf(mesh): O(N) dedup via spatial hash`.

---

## Plan: P10 — `readPsd` in a worker

**Root cause.** [src/io/psd.js:28-29](../../src/io/psd.js#L28-L29)
calls `readPsd(buffer, { skipLayerImageData: false })` synchronously
on the main thread. For 4K × 100-layer PSDs this decompresses
hundreds of RLE streams, locking the UI for 1-3s.

**Proper fix.** Run `readPsd` inside a dedicated worker. Marshal the
result back via transferable `ArrayBuffer`s — every layer's
`ImageData.data.buffer` is transferable, so marshalling is zero-copy.

**Steps.**
1. New worker `src/io/psd.worker.js`:
   - imports `readPsd` from `ag-psd`
   - listens for `{buffer}`, calls `readPsd(buffer, { skipLayerImageData: false })`
   - posts back `{width, height, layers}` with a `transfer:` array
     containing every layer's `imageData.data.buffer`
2. `src/io/psd.js`: **replace** the synchronous `importPsd` export
   with `importPsd(buffer): Promise<{...}>` that creates a one-shot
   worker, posts the buffer (transferable), awaits result. **No
   synchronous fallback path** — Rule №2 prohibits keeping a
   transition shim alongside the proper implementation.
3. Test environment without `Worker`: add a tiny inline shim in
   `scripts/test/_workerShim.mjs` that executes the worker module's
   message handler directly when `Worker` is undefined. Tests then
   `await importPsd(buffer)` exactly like production code; the
   shim is invisible to call sites.
4. `src/components/canvas/CanvasViewport.jsx`'s `processPsdFile`
   already does dynamic `await import('@/io/psd')` then
   `importPsd(buffer)` — change is just the result type
   becoming async; one `await` added.
5. The wizard's `dwposeService` consumes `psd.layers` directly — no
   change needed; the layers arrive via the regular path.

**Gates.** Visual: drop a 4K × 100-layer PSD, confirm UI stays
responsive during read; vertex / layer count matches prior sync
output. `npm run test:PsdImportService`.

**Dependencies.** None.

**Risk.** Low. ag-psd's API is stable; transferable
`ArrayBuffer` marshalling is a standard pattern.

**Effort.** 2–3h.

**Commit shape.** Single commit: `perf(psd): import PSD in a worker`.

---

## Plan: M9 — null `pendingPsd.layers` after consume

**Root cause.** [src/store/wizardStore.js:43-46](../../src/store/wizardStore.js#L43-L46)
holds `pendingPsd.layers`: every layer's full RGBA pixel data.
For a 4K × 50-layer PSD that's 50 × 64 MB ≈ 3.2 GB peak retention
across the wizard's lifetime, even after the layers have been
uploaded to GPU and `imageDataMapRef`. Back-button rollback uses
`preImportSnapshot` (JSON of project), not the layers, so layers
are dead weight after `finalizePsdImport`.

**Proper fix.** After `PsdImportService.finalize` consumes the
layers (uploads to GPU + `imageDataMapRef`), replace
`pendingPsd.layers` with a metadata-only array
`[{name, x, y, w, h}]`. Subsequent wizard steps (`reorder`,
`adjust`, `dwpose`) only need names + bounds — they interact with
the project, not the pixels.

**Steps.**
1. Add `consumeLayers()` action to `wizardStore`: maps the current
   layers to `{name, x, y, w, h}` metadata only and writes back via
   `set`.
2. `PsdImportService.finalize` calls `consumeLayers()` after the
   `setFinalizePsdImport` callback completes.
3. Verify the dwpose step (which uses `psd.layers` for the
   composite) runs BEFORE finalize, not after — confirm in
   `PsdImportWizard.jsx`. If dwpose runs after finalize, gate the
   consume on dwpose having already executed.

**Gates.** `npm run test:wizardStore`, `npm run test:PsdImportService`.
Visual: full wizard flow including Back button (review → Back →
review must still work); memory inspector — heap should drop sharply
after finalize on a big PSD.

**Dependencies.** None. Independent of P10.

**Risk.** Medium. Wizard step state-machine has a Back-button
rollback. Need to verify dwpose isn't a downstream consumer.

**Effort.** 2–3h.

**Commit shape.** Single commit: `perf(wizard): null pendingPsd.layers post-finalize`.

---

## Plan: R4 — `mat3MulInto` + scratch matrix reuse

**Root cause.** [src/renderer/transforms.js:23](../../src/renderer/transforms.js#L23)
`mat3Mul(a, b)` returns a fresh `Float32Array(9)` per call.
Per draw: `computeWorldMatrices` (one per node) + scenePass.draw
per-part (one per part) ≈ 500-1000 allocations on Hiyori-class rig.
Same pattern in [src/renderer/boneOverlayMatrix.js:122](../../src/renderer/boneOverlayMatrix.js#L122).

**Proper fix.** Add `mat3MulInto(out, a, b)` writing into a caller-
supplied scratch buffer. Per-node `world` matrices: pre-allocate one
Float32Array(9) per node, keyed by node id, lazily on first call;
reuse across frames. For per-draw `mat3Mul(camera, worldMatrix)`,
keep two ring scratches at scenePass scope.

**Steps.**
1. Add `mat3MulInto(out, a, b)` to `src/renderer/transforms.js`
   (mirror of `mat3Mul`, no allocation).
2. `computeWorldMatrices` in [src/renderer/scenePass.js](../../src/renderer/scenePass.js):
   walk replaces `mat3Mul` with `mat3MulInto`. The `worldMap`
   stores stable Float32Array(9)s keyed by node id; allocate on
   first see, reuse forever (resize the map only on node delete —
   or just leave entries around, harmless).
3. `scenePass.draw`: replace `mat3Mul(camera, worldMatrix)` with
   `mat3MulInto(scratchPart, camera, worldMatrix)`. `scratchPart`
   is a function-scope local, reused per part.
4. Same pattern in `boneOverlayMatrix.js`'s `resolveBoneWorld`
   (reuse a scratch per bone in `boneWorld`).

**Gates.** `npm run test:transforms`, `npm run test:chainEval`,
`npm run test:cubismWarpEval`, `npm run test:cubismRotationEval`,
`npm run test:bonePostChainComposition`, `npm run test:boneSkinning`,
`npm run test:breathFidelity`, `npm run test:shelbyByteFidelity`.

**Dependencies.** None. Pairs naturally with R3 (same allocation
class) but doesn't depend on it.

**Risk.** Medium. Reference equality of returned matrices changes
(stable across frames now — was fresh per call). Anything that
held matrix references via `Object.is` was already broken (fresh
allocations weren't reference-equal across calls anyway), but
audit consumers before merge to be sure.

**Effort.** 3–4h.

**Commit shape.** Single commit: `perf(renderer): mat3MulInto eliminates per-draw matrix allocs`.

---

## Plan: R3 + M1 + M2 — chainEval typed-array pool

**Root cause.** Per-eval, ~6-10k typed-array allocations for vertex
buffers, intermediate matrices, lifted grids, cellSelect work
arrays — see audit punch list M1, M2, R3 details. On Hiyori-class
rig at 60 fps this is ~600k allocations/sec — a sawtooth GC pattern
visible as frame-pacing jitter during slider drags.

**Proper fix.** Eval-scoped typed-array pool owned by the existing
`DeformerStateCache`, with a strict **two-class** distinction:

- **INTERNAL** buffers: scratch/intermediate buffers that never leave
  the eval (rotation matrices, `bufB` ping-pong, lifted-grid
  composition scratches, cellSelect work arrays). These are
  recycled freely across evals — the pool re-issues the same
  buffer for the same `(key, length)` on the next eval.
- **EXTERNAL** buffers: any buffer that becomes the public
  `frames[i].vertexPositions` returned to the caller. These
  **MUST NOT be recycled** — `lastEvalCacheRef.current.frames`
  retains references across tick boundaries (R12 makes the cache
  hit path read these), and recycling would silently corrupt the
  cached frames on the next eval.

The hard invariant: if a buffer's contents end up referenced by
the eval's return value, it was allocated outside the pool. The
plan keeps the existing `new Float32Array(...)` allocation site
for `vertexPositions` and converts only the demonstrably-internal
allocation sites to pool acquires.

**Steps.**
1. New helper `src/io/live2d/runtime/evaluator/typedArrayPool.js`
   — minimal `Pool` class with `getOrAlloc(key, ctor, length)`
   that returns a stable buffer per (key, length); resizes on
   length growth. JSDoc explicitly forbids passing buffers
   acquired here back through the eval's return value.
2. Hang a `pool` instance off `DeformerStateCache`; expose it on
   the cache instance for chainEval/warpEval/artMeshEval/rotationEval/cellSelect.
3. **Audit each allocation site** in `chainEval.js` (lines 255,
   319, 607, 623, 624, 711, 728, 730, 792, 793, 1060, 1097)
   and tag each as INTERNAL or EXTERNAL. Specifically: any
   buffer that ends up in `meshState.vertexPositions` or
   gets returned via the `frames` array is EXTERNAL. The
   ping-pong `bufA`/`bufB` is tricky — if the chain length
   is even, the final result is in the original `bufA` (which
   is `meshState.vertexPositions`, EXTERNAL); if odd, it's in
   `bufB` and gets copied back. Either way, the externally-
   visible buffer must not come from the pool. Convert ONLY
   the INTERNAL sites.
4. Same INTERNAL-only conversion for `warpEval.js:40`,
   `artMeshEval.js:45`, `rotationEval.js:134, 172`, and the 5
   alloc sites in `cellSelect.js`.
5. Add an **assertion test** at
   `scripts/test/test_typedArrayPoolAliasing.mjs`: run two
   back-to-back evals on the same rigSpec, capture
   `frames1[0].vertexPositions` from the first call, then run
   the second, and assert that the captured reference's
   contents are unchanged (or that the captured reference is
   not Object.is to any buffer the second eval used). Pins
   the EXTERNAL invariant.
6. New unit test `scripts/test/test_typedArrayPool.mjs` —
   acquire/grow correctness.

**Gates.** **All** byte-fidelity tests:
- `npm run test:cubismPhysicsOracle` (worst-case must stay ≤ 1e-4)
- `npm run test:breathFidelity` (66/66)
- `npm run test:shelbyByteFidelity` (23/23)
- `npm run test:chainEval` (25/25)
- `npm run test:cubismWarpEval` (29/29)
- `npm run test:cubismRotationEval` (57/57)
- `npm run test:cubismPhysicsKernel` (15/15)
- `npm run test:bonePostChainComposition` (13/13)
- `npm run test:boneSkinning` (35/35)

**Dependencies.** None upstream. R12 piggy-backs on this — ship in
the same commit if both fit, otherwise R12 second.

**Risk.** **HIGH.** Buffer lifecycle bugs are silent and produce
phantom data corruption. The byte-fidelity gates are the only
defence; oracle round before merge.

**Effort.** 1–2 days.

**Commit shape.** Single commit: `perf(eval): typed-array pool retires the per-frame allocation storm`.

---

## Plan: R12 — eval cache reuses paramValues identity across idle frames

**Root cause.** [src/components/canvas/CanvasViewport.jsx:682,686](../../src/components/canvas/CanvasViewport.jsx#L682)
sets `valuesForEval` BEFORE R1's epsilon-filter runs (lines 711-720).
The two assignments — `valuesForEval = working` (with-physics) and
`valuesForEval = { ...paramValuesRef.current, ...updates }` (no-physics) —
both produce a fresh object every frame. The cache fill at line ~802
stores `paramValues: valuesForEval`, and the cache check uses
identity. So `cache.paramValues === valuesForEval` is always false
in livePreview — the eval re-runs every frame even when no input
changed.

**Why the naive "single-line `if (realCount === 0) valuesForEval = paramValuesRef.current`" is wrong.**
1. The insertion point implied by the original plan (line 720 area)
   is downstream of where `valuesForEval` is set — the override
   would shadow the assignment, but only if inserted explicitly
   AFTER `realCount` is computed.
2. More subtly: when `realCount === 0`, the breath/look/blink
   updates ARE present in `updates` but each was within
   `PARAM_DELTA_EPSILON` of the prior store value. So
   `working = { ...paramValuesRef.current, ...updates }` is NOT
   bit-equal to `paramValuesRef.current` — the merged-in updates
   are sub-epsilon different. Substituting `paramValuesRef.current`
   yields `valuesForEval` that is identity-equal to a stable ref
   but VALUE-different from the prior frame's `working`. That's
   correct (sub-epsilon is by definition negligible), but it must
   be paired with an updated `paramValuesRef.current` after every
   `setMany` so the cache holds the right reference.

**Proper fix.** Coordinate three things in lockstep:
1. After `setMany(realUpdates, ...)` fires, **manually advance
   `paramValuesRef.current`** to the post-setMany store state.
   Without this, the ref lags one frame behind setMany (React's
   re-render hasn't committed yet within the rAF tick).
2. **Always set `valuesForEval = paramValuesRef.current`** —
   independent of physics / no-physics branch, independent of
   realCount. The merged-in `updates` for a real-change frame are
   already in the store after setMany, so paramValuesRef.current
   reflects them.
3. Cache fill stores `paramValues: paramValuesRef.current` (which
   equals `valuesForEval`). On the next idle frame,
   `paramValuesRef.current` is unchanged — identity-equal to the
   cached ref → cache hit.

**Steps.**
1. Replace `valuesForEval = working` (line 682) and
   `valuesForEval = { ...paramValuesRef.current, ...updates }`
   (line 686) with a single `valuesForEval = paramValuesRef.current`
   moved to AFTER the R1 filter block (line 725 area). Physics
   internally uses `working` to compute outputs into `updates` —
   that flow is unchanged.
2. After the `if (realCount > 0)` block calls `setMany`, add
   `paramValuesRef.current = useParamValuesStore.getState().values`
   so the ref tracks the just-written state synchronously.
3. Verify the cache fill at line ~802 stores
   `paramValues: paramValuesRef.current` (already does in spirit —
   `valuesForEval` was the local name; the fix just makes that
   ref the same object as `paramValuesRef.current`).
4. Verify the cache hit path at line ~803 uses `===` against
   `paramValuesRef.current` (or the cached `paramValues` slot).
   The cache key check is already identity; nothing to change.

**Gates.** Visual: livePreview at idle (cursor parked, no input
crossed epsilon) → instrument the cache hit path with a counter;
should hit > 95% of frames. `npm run test:chainEval`,
`npm run test:cubismWarpEval`, `npm run test:bonePostChainComposition`,
`npm run test:breathFidelity`. Note: `test:breathFidelity` is the
key gate because breath continuously cycles; verify the cache
miss is correctly triggered when breath crosses epsilon.

**Dependencies.** Built on R1 (Phase D, already shipped). **Does
NOT depend on R3** — R3's external-buffer invariant (see G1 in
R3's plan) makes R12 safe to ship first. R12 ships in Group 1.

**Risk.** Low-medium. The setMany→ref-advance coordination is
the load-bearing piece; if `paramValuesRef.current` lags setMany
by even one frame, the cache fill stores a stale ref and the
next idle frame misses (no correctness bug, just lost perf).
Add a one-line assertion in dev mode: after every cache fill,
verify `paramValuesRef.current === useParamValuesStore.getState().values`.

**Effort.** 2–3h.

**Commit shape.** Single commit: `perf(eval): paramValuesRef coordinated with setMany so livePreview idle hits the eval cache`.

---

## Plan: R2 — `setLiftedGrids` → revision counter

**Root cause.** [src/components/canvas/CanvasViewport.jsx:781](../../src/components/canvas/CanvasViewport.jsx#L781)
calls `useRigEvalStore.getState().setLiftedGrids(map)` every
cache-miss frame; [src/store/rigEvalStore.js:35](../../src/store/rigEvalStore.js#L35)
unconditionally `set(...)`s the store, fanning out to every
subscriber. WarpDeformerOverlay subscribes — re-renders at 60 Hz
during livePreview / animation playback even when grids didn't
visibly change.

**Proper fix.** Keep the lifted-grids data in a module-level
ref (zero subscriber cost on write). Add a `liftedGridsRevision`
slot to `rigEvalStore` that bumps only when the grid content
materially changes (set-of-warp-ids changed, or any control point
moved by more than an epsilon). WarpDeformerOverlay subscribes
to revision; on bump, reads grids from the ref directly.

**Steps.**
1. `src/store/rigEvalStore.js`: add `liftedGridsRevision: 0` slot;
   keep `liftedGrids` as a non-Zustand module-level ref
   (`let _liftedGridsRef = null` exported as `getLiftedGrids()`).
2. `setLiftedGrids(newMap)`: compare set-of-keys vs current ref;
   if same keys, walk the values, compute max-control-point delta;
   bump revision only if delta > epsilon.
3. `src/v3/editors/viewport/overlays/WarpDeformerOverlay.jsx`:
   - subscribe via `useRigEvalStore((s) => s.liftedGridsRevision)`
   - read `liftedGrids` via `getLiftedGrids()` inside the render
     (revision-keyed, so stale reads can't happen)
4. CanvasViewport keeps calling `setLiftedGrids(map)` every
   cache-miss frame; the no-op branch suppresses the broadcast.

**Gates.** Visual: scrub a slider that drives a warp → overlay
moves smoothly; idle livePreview → overlay does not re-render
(verify with React DevTools profiler).

**Dependencies.** None.

**Risk.** Medium. Revision-vs-content drift bugs are visible
(overlay won't update when it should). Mitigate with epsilon set
to 1e-3 px (well below visible tolerance) and a fallback "always
bump on key-set change" path.

**Effort.** 2–3h.

**Commit shape.** Single commit: `perf(overlay): revision-counter gate suppresses every-frame lifted-grids broadcast`.

---

## Plan: M7 — `imageDataMapRef` two-step (prune + downsample)

**Root cause.** [src/components/canvas/CanvasViewport.jsx:124](../../src/components/canvas/CanvasViewport.jsx#L124)
keeps a `Map<partId, ImageData>` of full-resolution layer pixels.
50 parts × 1024² × RGBA = 200 MB JS heap, never freed (only
`clear()` on full reset).

**Audit correction:** [src/io/hitTest.js:245](../../src/io/hitTest.js#L245)
only reads from `imageDataMap` for **pre-mesh PSD parts** (the
wizard reorder/adjust window before auto-mesh runs). Once a part
has a triangulated mesh, the triangle path at line 188 takes over
and the ImageData entry is **dead weight memory** — never read
again until the part is deleted (Phase B prunes those).

**Proper fix — two phases.**

### M7a — Prune entries on auto-mesh completion

The cleanest fix for ~95% of the memory waste: when a part
transitions from pre-mesh to meshed (the mesh worker pool's
result lands), **delete its entry from `imageDataMapRef`**. The
entry is unreachable for hit-test from that point on; keeping it
around is the leak.

**Steps (M7a).**
1. In `dispatchMeshWorker`'s success handler ([src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)):
   after `setMesh(node, ...)` commits, `imageDataMapRef.current.delete(partId)`.
2. Verify the wizard's reorder/adjust step happens BEFORE
   auto-mesh runs (per the existing comment at hitTest.js:225).
   Confirmed by grep: `autoMeshAllParts` is called from the
   wizard's `complete` action, after reorder/adjust.

**Gates (M7a).** `npm run test:hitTest` (existing), wizard E2E
(drop PSD → reorder → adjust → finish → click-select on a meshed
part still works via the triangle path).

**Effort (M7a).** 1h.

### M7b — Downsample remaining wizard-window entries

For the wizard reorder/adjust window where parts aren't yet
meshed and `imageDataMap` IS read for hit-test: replace each
ImageData with a 256×256 `Uint8Array` alpha-only mask. 256×256
× 1 byte per part = 64 KB; 50 parts in the wizard window = 3.2 MB.

256² is sufficient: the wizard's reorder/adjust is a coarse
positional operation (click to select layer for reordering /
joint placement), not a precision pixel-pick — the user clicks
on broad regions, not single-pixel features. The 256² grid
samples each ~16 px on a 4K canvas — well within the user's
mouse-target tolerance.

**Steps (M7b).**
1. New helper `src/components/canvas/viewport/alphaMask.js`:
   - `downsampleAlphaMask(imageData, srcW, srcH, target=256) → {mask: Uint8Array, w: number, h: number}` (nearest-neighbor, alpha channel only — bilinear is overkill for this use)
   - `sampleAlphaMask(maskRecord, srcCanvasX, srcCanvasY) → number` (maps canvas-px to mask cell, returns alpha)
2. `CanvasViewport.jsx` upload site: store
   `downsampleAlphaMask(imageData, ...)` instead of raw ImageData
   in `imageDataMapRef`.
3. `src/io/hitTest.js:245-253`: replace direct
   `imgData.data[(iy * imgData.width + ix) * 4 + 3]` with
   `sampleAlphaMask(maskRecord, worldX, worldY)`.
4. New unit test `scripts/test/test_alphaMask.mjs`: downsample
   correctness on a known PSD layer (alpha-edge classification
   matches full-res for ≥ 95% of canvas-px samples).

**Gates (M7b).** `npm run test:alphaMask` (new),
`npm run test:hitTest`. Visual: drop a PSD → wizard reorder
step → click-select every layer → verify selection lands on
the visible layer.

**Dependencies (M7).** None.

**Risk.** Low for M7a (pure dispose). Medium for M7b — the
nearest-neighbor 256² downsample may misclassify clicks at
sub-cell precision near layer edges; mitigate with a 2-cell
"any-alpha" check (touch detection at cell boundaries).

**Effort (M7).** M7a 1h, M7b 3-4h. Total 4-5h.

**Commit shape.** Two commits:
1. `perf(memory): drop imageDataMapRef entries on auto-mesh completion`
2. `perf(memory): downsample wizard-window alpha mask to 256x256`

---

## Plan: S2 — PropertiesEditor whole-`project` subscription

**Root cause.** [src/v3/editors/properties/PropertiesEditor.jsx:35](../../src/v3/editors/properties/PropertiesEditor.jsx#L35)
`useProjectStore((s) => s.project)` re-renders the whole stack on
ANY project mutation — paramValue writes, mesh edits, modifier
flips, even unrelated subsystem mutations.

The Phase C fix (S4) made each section subscribe to
`s.project.nodes` separately, so the inner sections re-render
correctly. The OUTER PropertiesEditor still renders on every
project mutation, and it builds `tabsFor({active, project})` and
`sectionsForTab({active, project}, effectiveTab)` which take the
whole project shape.

**Proper fix.** Two-step:

**Step A** — narrow what `tabsFor` / `sectionsForTab` consume.
Read [src/v3/editors/properties/propertiesTabRegistry.jsx](../../src/v3/editors/properties/propertiesTabRegistry.jsx)
to enumerate every field of `project` they actually touch. Likely:
- `project.nodes` (for tab visibility predicates)
- maybe `project.parameters`, `project.physicsRules`, `project.boneConfig`

Refactor signatures from `(active, project)` to
`(active, {nodes, parameters, ...})` — pass only the slice each
predicate needs.

**Step B** — PropertiesEditor subscribes to those fields
separately:
```js
const nodes = useProjectStore((s) => s.project.nodes);
const parameters = useProjectStore((s) => s.project.parameters);
// ...
```

**Steps.**
1. Audit `propertiesTabRegistry.jsx` — list every `project.X` access.
2. Update `tabsFor` and `sectionsForTab` signatures to accept the
   slice object instead of full project; update every predicate.
3. Update `PropertiesEditor.jsx` and any other callers.
4. Update `test:propertiesSectionRegistry` fixtures to the new
   signature.

**Gates.** `npm run test:propertiesSectionRegistry`,
`npm run test:editorStore`. Visual: every selection type still
shows the correct tabs.

**Dependencies.** None.

**Risk.** Medium. Touches every section's predicate — high LOC
delta. Test fixtures need rework.

**Effort.** 4–5h.

**Commit shape.** Single commit: `perf(properties): narrow tabsFor signature so PropertiesEditor stops re-rendering on every project mutation`.

---

## Plan: P4 — `harvestAll` memo across rig stages

**Root cause.** [src/services/RigService.js:326-361](../../src/services/RigService.js#L326-L361)
`runStage(stageName, ...)` for any keyform stage
(`faceParallax` / `bodyWarpChain` / `rigWarps`) re-runs the FULL
`initializeRigFromProject` plus `loadProjectTextures`,
`buildMeshesForRig`, `generateCmo3 rigOnly:true`, `evalRig`.
Refit-three-stages pays 3× the cost; nothing is shared.

**Proper fix.** A single `harvestAll(project, images)` runs the
heavy stuff once and returns
`{faceParallaxSpec, bodyWarpChain, neckWarpSpec, rigWarps}`.
Each stage's result is memoised under a **per-stage compound key**
that is the conjunction of:

- `versionControl.geometryVersion` (geometry inputs), AND
- a **per-stage config-subset hash** that depends ONLY on the
  config records the stage actually consumes.

**Critical: `geometryVersion` does NOT bump on config mutations.**
Verified against [src/store/projectStore.js](../../src/store/projectStore.js) — the
10 `geometryVersion++` writers (lines 332, 346, 355, 367, 760,
918, 953, 1050, 1572, 1619) are all geometry-side mutations
(mesh edits, blend-shape ops, pivot, reset/load, splits). Config
seed actions (`seedAutoRigConfig`, `seedBoneConfig`,
`seedEyeClosureConfig`, …) deliberately don't bump it — that's
correct semantics (geometryVersion is geometry-specific). The
config-subset hash is therefore the **load-bearing** half of the
cache key for config-only changes.

**Per-stage subset definition** (avoids cross-stage cache
invalidation when only one stage's config changes):

| Stage | Config slice in hash |
|---|---|
| `faceParallax` | `autoRigConfig.faceParallax`, `eyeClosureConfig`, `rotationDeformerConfig` |
| `bodyWarpChain` | `autoRigConfig.bodyWarp`, `boneConfig`, `bodyWarpLayout` |
| `rigWarps` (per-part) | `autoRigConfig.rigWarps`, `variantFadeRules`, `rigWarps[partId]` |
| `neckWarp` | `autoRigConfig.neckWarp`, `boneConfig` (neck role) |

Each stage's cache check is the literal conjunction:
```js
const cacheKey = `${stage}:${geometryVersion}:${configSubsetHash(stage, project)}`;
if (cache.get(cacheKey) === undefined) cache.set(cacheKey, harvestAll(project, images, stage));
return cache.get(cacheKey);
```
Both halves change → cache miss. Either half stable → check the
other half. The cache stores per-stage entries, not a single
global entry, so changing only `faceParallax` config doesn't
invalidate the `bodyWarpChain` entry.

**Steps.**
1. Read [src/io/live2d/rig/initRig.js](../../src/io/live2d/rig/initRig.js)
   `initializeRigFromProject` — confirm it can be split into a
   single per-project shared phase (texture load, mesh build,
   chain emit) plus per-stage spec generators. Map each `runStage`
   call to its current code path so the refactor is mechanical.
2. Build the shared phase as `harvestShared(project, images)` —
   returns the heavy invariant (chain emit, mesh artifacts).
3. Build per-stage spec generators that take `harvestShared`
   output + the relevant config slice → returns the spec.
4. `runStage(stageName)` calls `harvestShared` (memoised on
   geometryVersion alone — geometry-only stage-independent), then
   the per-stage generator (memoised on the full per-stage key).
5. Cache lives in `RigService` module scope as a `Map<string, any>`.
   On `versionControl.geometryVersion` change, drop all entries
   whose key prefix matches old version (or just clear — easier).
6. New unit test `scripts/test/test_harvestAllCache.mjs` —
   construct three runStage scenarios:
   (a) same stage twice → second is cache hit
   (b) edit faceParallax config, run faceParallax → miss
   (c) edit faceParallax config, run bodyWarpChain → hit (different
       per-stage subset)
7. Update `test:runStageIntegration` to verify byte-identical output
   pre vs post refactor.

**Gates.** `npm run test:runStageIntegration`,
`npm run test:rigStageOps`, `npm run test:initRig`,
`npm run test:shelbyByteFidelity`,
`npm run test:breathFidelity`. Visual: refit each stage
individually, check Logs panel for "harvest cache hit" message;
byte-identical output to pre-refactor.

**Dependencies.** None on other deferred items.

**Risk.** **HIGH.** Touches Init Rig path. Cache invalidation
bugs would silently use stale data and break byte-fidelity.
Oracle round + manual byte-diff before merge.

**Effort.** 1–2 days.

**Commit shape.** Two commits:
1. `feat(rig): harvestAll returns all four spec slices` (refactor only)
2. `perf(rig): memo harvestAll across runStage calls` (caching layer)

---

## Plan: P1 — undo via immer `produceWithPatches`

**Root cause.** Three `structuredClone(project)` sites in
[src/store/undoHistory.js](../../src/store/undoHistory.js):
- line 74 — `pushSnapshot` (every push)
- line 122 — `undo()` clones current project to push onto the
  redo stack before applying
- line 135 — `redo()` clones current project to push onto the
  undo stack before applying

`pushSnapshot` also `JSON.stringify`s for size-budget enforcement.
Tens of MB per snapshot; 50 entries pin 1-2 GB. The clone alone
is ~50ms on Hiyori-class projects, fired on every drag's first
frame via `beginBatch` and on every `updateProject` outside
batches. Every undo and redo invocation pays the clone cost again.

**Proper fix.** immer `produceWithPatches` already runs inside
`updateProject`. Capture the patches + inverse-patches and store
the tuple per history entry. `undo()` applies inversePatches to
current state; `redo()` applies patches. No snapshots, no JSON.

**Steps.**
1. Read [src/store/undoHistory.js](../../src/store/undoHistory.js)
   fully — three clone sites (lines 74, 122, 135), all need
   replacement.
2. Read `updateProject` in [src/store/projectStore.js](../../src/store/projectStore.js)
   — confirm every mutator goes through `produce`. **Hand-audit
   for direct `state.project.X = Y` mutations outside `produce`
   recipes** — those will silently break with patches. Grep
   `state\.project\.\w+\s*=` across `src/store/`.
3. Refactor `updateProject`:
   - call `produceWithPatches(state, recipe)` instead of `produce`
   - capture `[nextState, patches, inversePatches]`
   - `pushSnapshot(patches, inversePatches)` replaces the existing
     snapshot push
4. Refactor `undoHistory.js`:
   - `pushSnapshot(patches, inversePatches)` appends a tuple
     (no clone, no JSON.stringify)
   - `undo()`: pop the (patches, inversePatches) pair, advance
     the pointer, apply `inversePatches` to `state.project` via
     immer's `applyPatches`. **No clone of the prior state** — the
     redo direction is the patches we already have on the stack.
   - `redo()`: symmetric — apply `patches` to advance forward.
   - drop the `JSON.stringify` size-budget enforcement (patch
     length is O(delta), no budget needed for typical edit
     volumes)
5. Hand-audit every action in `projectStore.js` that calls
   `pushSnapshot` directly — replace with patch-based path
   (or convert to `updateProject` if not already).
6. Verify `clearHistory()` semantics carry over.
7. New tests `scripts/test/test_undoPatches.mjs`: applyPatches
   round-trip on every undoable mutation shape. Existing
   `test:undoHistory` regression run.

**Gates.** `npm run test:undoHistory`,
`npm run test:projectRoundTrip`, `npm run test:saveLoadRigSpec`.
Visual: comprehensive undo/redo on every undoable action
(transform, modifier add/remove, mesh edit, parameter add/edit,
animation keyframe, etc.).

**Dependencies.** None.

**Risk.** **HIGH.** Touches every undoable operation in the app.
A non-immer mutator anywhere in the codebase will silently break
its undo. Mitigate: grep for `state.project.X =` outside `produce`
recipes; flag in PR.

**Effort.** 1–2 days.

**Commit shape.** Two commits:
1. `refactor(store): updateProject emits immer patches+inversePatches` (no behaviour change yet — still pushes snapshots, also pushes patches in parallel for tests)
2. `perf(undo): drop snapshot push, undo via applyPatches` (flip the consumer)

---

## Plan: P2 — `finalizePsdImport` in a worker

**Root cause.** [src/components/canvas/CanvasViewport.jsx:1497-1550](../../src/components/canvas/CanvasViewport.jsx#L1497-L1550)
loops every PSD layer on the main thread:
- `createElement('canvas')` ×2
- `putImageData(layer.imageData)`
- `drawImage` to canvas-sized canvas
- `getImageData(0, 0, psdW, psdH)` — full PSD-canvas alloc per layer

For 4K × 50 layers that's 50 × ~64 MB allocations + N synchronous
decodes, all wrapped in one immer commit. Then `off.toBlob` + `img.onload`
queue N more PNG encodes after.

**Proper fix.** Move per-layer compositing into a worker pool
(reuse the P10 worker pool pattern). Each worker takes a layer's
`ImageData` (transferable) + canvas dims, returns
`{fullImageData (transferable), pngBlob, imageBounds}`. Main thread
applies metadata-only updates inside `updateProject`; bitmap
upload to GPU happens on `Image.onload` outside the immer
transaction.

**Steps.**
1. Build on P10's worker module shape — new `src/io/psdFinalize.worker.js`
   that accepts `{layerImageData, psdW, psdH}` and returns the
   composited result via transferable buffers.
2. New `src/io/psdFinalizeWorkerPool.js` — same shape as
   `mesh/workerPool.js` (long-lived workers, FIFO queue).
3. `CanvasViewport.finalizePsdImport`: dispatch all layers in
   parallel via the pool, await drain, single `updateProject` to
   commit the metadata+textures.
4. Pool lifetime: per-PSD-import (created on wizard finalize,
   destroyed on completion). Or shared with mesh worker pool —
   evaluate after P10.
5. Integration test: `test:PsdImportService` covers finalize path.

**Gates.** `npm run test:PsdImportService`. Visual: drop a 4K ×
50-layer PSD; UI stays responsive throughout finalize. Output
project must match the pre-refactor result byte-for-byte (compare
`.stretch` save with prior commit).

**Dependencies.** P10 (worker pool pattern + transferable
marshalling). Ship after P10 lands.

**Risk.** Medium-high. PSD import critical path; output must be
byte-identical for the byte-fidelity tests downstream.

**Effort.** 1–2 days.

**Commit shape.** Single commit:
`perf(psd): finalizePsdImport runs per-layer compositing in a worker pool`.

---

## Notes for the implementer

- **R12 is more involved than the original draft suggested.**
  The reviewer-pass (2026-05-09) found that `valuesForEval` is
  set BEFORE R1's `realCount` is computed and that `working`
  is sub-epsilon different from `paramValuesRef.current` even
  on idle frames. R12's plan now specifies the proper fix:
  always set `valuesForEval = paramValuesRef.current`, and
  manually advance `paramValuesRef.current` after every
  `setMany` so the cache fill stores the right reference.
  Still ships in Group 1 (low risk, high impact), but it's a
  3-touch coordinated change, not a one-liner.
- **The byte-fidelity gates are the only defence on eval-graph
  work.** `test:cubismPhysicsOracle`, `test:breathFidelity`,
  `test:shelbyByteFidelity`, plus the 4 cubism* tests. Run all
  of them on every commit that touches `src/io/live2d/runtime/`
  or `src/renderer/`.
- **Anti-pattern to avoid in any of these plans:** silent
  fallbacks (`?? []`, `?? {}`, exception-swallowing
  try/catch with an "in case", retry loops on the wrong layer,
  etc.). RULE №1. If a plan step would require one to make
  the test gates pass, that's a sign the plan needs revision —
  not a sign the fallback is OK.
- **MEMORY.md sister entries.** When shipping any of these,
  check the existing MEMORY.md feedback entries for adjacent
  guidance:
  - `feedback_byte_diff_after_writer_refactor.md` (R3, P4)
  - `feedback_oracle_before_unit_tests.md` (R3, R6, P4)
  - `feedback_filter_in_selector.md` (S2)
  - `feedback_post_ship_audit.md` (every multi-phase plan)
  - `feedback_two_views_one_host.md` (R2)

## Audit trail

This plan was reviewed by a code-reviewer agent on 2026-05-09
after the first draft. Eight substantive findings were folded
back in:

- **B1** (P4 cache-key blocker) — `geometryVersion` does NOT bump
  on config seed actions, so the configHash half of the cache key
  is load-bearing. Per-stage subset hashing added so cross-stage
  config edits don't invalidate sibling caches.
- **B2** (R12 insertion-point blocker) — `valuesForEval` is set
  upstream of R1's `realCount`, and `working` is sub-epsilon
  different from `paramValuesRef.current` even when realCount=0.
  Plan rewrites R12 as a 3-touch coordinated change.
- **W1** (M7 wrong scope) — `imageDataMapRef` only used pre-mesh.
  Plan now splits into M7a (prune on auto-mesh, ~95% of win) and
  M7b (downsample wizard window).
- **W2** (P10 sync fallback) — Rule №2 violation. Plan now
  replaces the synchronous export entirely; test environment uses
  an inline worker shim, not a production sync fallback.
- **G1** (R3 buffer-aliasing risk) — frames refs held by R12's
  cache get corrupted if pool recycles backing buffers. Plan now
  defines INTERNAL vs EXTERNAL pool buckets with a hard invariant
  and a regression-pinning aliasing test.
- **D1** (R12 → Group 1) — sequencing moved; R12 ships before R3.
- **A1** (P1 undo/redo clones) — added; the original P1 only
  named the `pushSnapshot` clone but `undo()` and `redo()` also
  clone.
- **A2** (P4 config-hash granularity) — per-stage subset hashing
  replaces the monolithic `autoRigConfig` hash so a faceParallax
  edit doesn't unnecessarily invalidate the bodyWarpChain cache.
