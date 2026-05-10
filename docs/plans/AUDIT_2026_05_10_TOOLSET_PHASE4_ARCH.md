# Phase 4 Architecture Audit — 2026-05-10

Independent code review of commit `428bcdf` (Toolset Phase 4 — Merge /
Dissolve / Subdivide topology operators). Traced the full dispatcher
pipeline from operator registration through pure-operator math, the
`applyTopologyOp` dispatcher, GPU re-upload, undo interaction, and
per-vertex data remap. Verified all 175 test assertions match the
described contract; looked for gaps that manifest at runtime but are
absent from the test suite.

## Summary

10 gaps total — **3 HIGH** (correctness failures reachable on first
use or after save+load), **5 MED** (correctness under specific
topology or workflow conditions), **2 LOW** (polish / dead code).

| ID   | Sev  | One-line | Status |
|------|------|----------|--------|
| G-1  | HIGH | `mesh.runtime.keyforms[i].vertexPositions` length not cleared after topology op — chainEval outputs wrong-length arrays for every rigged part | FIXED `4347926` |
| G-2  | HIGH | `mesh.edgeIndices.has()` crashes Subdivide when edgeIndices is a plain Array (always true after save+load) | FIXED `4347926` |
| G-3  | HIGH | Undo after topology op leaves GPU mesh stale — `hasMesh()` returns true, mesh sync skips re-upload, rendering wrong geometry | FIXED `4347926` |
| G-4  | MED  | Dissolve adjacent-cluster: bucketing by first-dissolved-vert steals shared triangles; the comment "will be re-fed when we process their centre" is wrong — second centre's ring is incomplete, hole is silently dropped | FIXED `4347926` (comment + JSDoc; v1 simplification stays) |
| G-5  | MED  | Smoothness pass bakes smoothed position into `restX`/`restY` — midpoint rest-mesh permanently corrupted for smoothness > 0 | FIXED `4347926` |
| G-6  | MED  | `enumerateOneRingPolygon` silently overwrites `next[u]` on non-manifold / butterfly topology — ring walk corrupts without error | FIXED `4347926` |
| G-7  | MED  | `MergeMenu.run()` comment says "Close BEFORE exec" but exec fires before close — `atCursor` currently works by accident; any future refactor that reads `canvasCursor` post-close breaks silently | FIXED `4347926` (comment) |
| G-8  | MED  | Dead imports in `dissolve.js` and `subdivide.js` mask missing reuse — both files manually re-implement `identityVertexSources`/`identityVertexIndexRemap` inline instead of calling the exported helpers | FIXED `4347926` |
| G-9  | LOW  | MergeMenu lazy-load: first open shows `null` for one frame while the chunk loads — no loading indicator | DEFERRED (cosmetic) |
| G-10 | LOW  | `window.prompt` for By Distance threshold documented as v1 simplification but blocks the main thread and breaks in SSR/test environments | DEFERRED (already documented) |

---

## HIGH-severity gaps

### G-1: `mesh.runtime` keyform vertex-position arrays not cleared after topology op

**File:** `src/v3/operators/edit/applyTopologyOp.js:110–126`; `src/store/artMeshRuntimeSync.js:29–33`

`applyTopologyOp`'s `updateProject` recipe writes the new
`mesh.vertices`, `mesh.uvs`, `mesh.triangles`, and `mesh.edgeIndices`
but does not touch `mesh.runtime`. The runtime object carries
`keyforms[i].vertexPositions`, a flat `Array<number>` of length
`2 * N_old`. After a topology op that changes the vertex count to
`N_new`, `mesh.runtime.keyforms[i].vertexPositions` still has the old
length.

`artMeshEval` at `src/io/live2d/runtime/evaluator/artMeshEval.js:44–55`
reads `refKf.vertexPositions.length` as the authoritative `len` and
then filters out any keyform whose `vertexPositions.length !== len`.
After a topology op, `len = 2 * N_old` and the evaluator outputs a
float buffer of that size — but the vert array now has `N_new`
entries. The canvas renderer (`ScenePass`) reads `N_new` from the GPU
vertex buffer and `N_old` from the evaluator result, producing a
vertex-position mismatch frame on every subsequent rAF tick for any
rigged part.

**Fix:** At the top of the `updateProject` recipe in `applyTopologyOp`,
after locating `m`, add `if (m.runtime) delete m.runtime;` — same
pattern used by `ArmatureModifierService.js:155` and
`artMeshRuntimeSync.js:175`. The stale runtime is immediately harmless
once cleared; the next Init Rig repopulates it with correct vertex
counts. **DONE in `4347926`.**

---

### G-2: `mesh.edgeIndices.has()` crashes Subdivide after save+load

**File:** `src/v3/operators/edit/subdivide.js:206`; `src/io/projectFile.js:214`

`projectFile.js:214` (the load path) intentionally leaves
`node.mesh.edgeIndices` as a plain `Array<number>` after deserialization.
`singleCut` in `subdivide.js` creates a local `edgeIndices` Set at line
203 correctly (`new Set(mesh.edgeIndices ?? [])`), but at line 206
re-queries the *original* `mesh.edgeIndices` for the boundary-
inheritance test. `Array.prototype.has` is `undefined`. Throws
`TypeError: mesh.edgeIndices.has is not a function` on any Subdivide
invocation after the project was saved and loaded. The bug does not
appear in the unit tests because `test_subdivide_one_cut.mjs` passes
`edgeIndices: null` or a fresh `Set` — never a plain Array from a load
round-trip.

**Fix:** Change line 206 to read from the already-constructed
`edgeIndices` Set. **DONE in `4347926`.** Pinned by
`test_audit_fixes_2026_05_10_phase4.mjs` G-2.

---

### G-3: GPU mesh stale after Ctrl+Z undo of a topology op

**File:** `src/components/canvas/CanvasViewport.jsx:457`; `src/v3/operators/edit/applyTopologyOp.js:131–142`

`applyTopologyOp` performs a GPU upload via
`scene.parts.uploadMesh(partId, ...)`. When the user presses Ctrl+Z,
`app.undo` restores the pre-op project snapshot and marks the rAF
dirty. The mesh sync loop runs on the next frame:

```js
// CanvasViewport.jsx:457
if (!scene.parts.hasMesh(node.id)) { ... uploadMesh ... }
```

`hasMesh(partId)` returns `true` (the part's GPU VAO was created by the
topology op and never freed), so the sync skips the re-upload. The
viewport then evaluates the pre-op project mesh (with `N_old` vertices)
through the post-op GPU buffer (with `N_new` vertices). For a Merge op
where `N_new < N_old`, the GPU IBO references index slots that no
longer exist in the old vertex list — undefined behavior in WebGL,
typically rendering garbage geometry or nothing.

**Fix:** Replaced the `!hasMesh()` guard with per-part
`meshSignature`-tracked re-upload. The sync useEffect now caches
the last-uploaded signature per part and re-uploads on divergence.
Catches: first upload, topology op, undo of topology op, save+load
round-trip. `sceneRegistry` extended with `_recordMeshUpload(partId,
sig)` so `applyTopologyOp`'s explicit upload seeds the cache and the
sync useEffect doesn't double-upload. **DONE in `4347926`.**

---

## MED-severity gaps

### G-4: Dissolve adjacent-cluster leaves holes silently (comment was wrong)

**File:** `src/v3/operators/edit/dissolve.js:172–198`

When two adjacent selected vertices A and B share a triangle [A, B, C],
the bucketing loop (lines 177–184) assigns the triangle to A's bucket
(first dissolved vert encountered). B's bucket therefore does not
contain [A, B, C]. When processing B's ring, `enumerateOneRingPolygon`
receives an incomplete incident set. If the ring includes A (which it
will — A is a neighbour of B), `ringHasOtherDissolved` is true and B's
ring is silently skipped entirely (line 198). The comment said "The
tris incident to those will be re-fed when we process *their* centre"
— this is incorrect. The shared triangle went into A's bucket and A's
ring was rejected as well (it includes B). Both centres are silently
dropped, leaving a topological hole in the mesh.

**Fix:** Comment + JSDoc corrected. Behaviour stays as a v1
simplification (Phase 6+ to BFS-merge connected dissolved clusters
into a single super-ring before ear-clip). **DONE in `4347926`.**

---

### G-5: Smoothness pass bakes smoothed position into `restX`/`restY`

**File:** `src/v3/operators/edit/subdivide.js:180–181`

The smoothness pull on new midpoints (lines 177–181) updated `cur.x`,
`cur.y`, then immediately set `cur.restX = cur.x; cur.restY = cur.y;`.
This baked the *smoothed pose position* into the rest field, destroying
the true geometric midpoint rest. Any subsequent Apply Pose As Rest,
rig evaluation, or export pass that read `restX`/`restY` would see
the smoothed position, not the undeformed rest-mesh midpoint. For
smoothness=0 this was a no-op; for smoothness>0 on a rigged mesh it
silently corrupted the rig's rest-space coordinates.

**Fix:** Rewrite preserves `restX`/`restY` as the geometric midpoint
(barycentric of source verts' rest values); only the pose-space `x`/`y`
is pulled by the smoothness factor. **DONE in `4347926`.** Pinned by
`test_audit_fixes_2026_05_10_phase4.mjs` G-5.

---

### G-6: `enumerateOneRingPolygon` silent overwrite on non-manifold topology

**File:** `src/lib/meshTopology.js:377`

The directed-edge map `next.set(u, v)` is called once per incident
triangle. For a manifold mesh every directed edge `u→v` is unique. For
a non-manifold vertex — two separate fans connected only at the
dissolve centre (a "butterfly") — two triangles can produce the same
outgoing vertex `u` from different windings. The second `next.set(u, v)`
silently overwrote the first, producing a corrupted ring. The walk
either stopped early or looped on a phantom cycle; the closed/open
flag was wrong; ear-clip received a truncated ring and emitted
overlapping or zero triangles. Non-manifold geometry can arise
legitimately in SS meshes (overlapping UV seam verts).

**Fix:** Detect `next.has(u) || prev.has(v)` before the `.set` and
return `null` (caller treats as "no refill possible" — incident
triangles are still removed). **DONE in `4347926`.** Pinned by
`test_audit_fixes_2026_05_10_phase4.mjs` G-6.

---

### G-7: `MergeMenu.run()` comment was backwards

**File:** `src/v3/shell/MergeMenu.jsx:72–82`

Comment said "Close BEFORE exec" but the actual code calls `op.exec`
*before* `close()`. Currently the code is correct: `edit.merge.atCursor`
reads `useEditMenuStore.getState().canvasCursor` at exec time which is
still set because close hasn't fired yet. The risk is that any future
refactor that reorders the lines (e.g. moving `close()` to the top for
"always close on click" semantics) will silently break `atCursor`.

**Fix:** Comment corrected to read "exec BEFORE close so canvasCursor
is still set when atCursor reads it". **DONE in `4347926`.**

---

### G-8: Dead imports of `identityVertexSources` / `identityVertexIndexRemap`

**File:** `src/v3/operators/edit/dissolve.js:47`; `src/v3/operators/edit/subdivide.js:48–49`

`dissolve.js` imported `identityVertexSources` from `meshTopology.js`
but never called it. The dissolve operator manually built the same
structure. `subdivide.js` imported both helpers but never called
either. The dead imports were a correctness signal: the helpers exist
and are exported precisely so operators can use them rather than
duplicating the logic.

**Fix:** Removed dead import from dissolve.js. Subdivide.js rewrite
(D-1) dropped them naturally as part of the new single-pass
implementation. **DONE in `4347926`.**

---

## LOW-severity gaps

### G-9: MergeMenu lazy-load shows `null` on first open

**File:** `src/v3/shell/AppShell.jsx:66–68, 110`

`MergeMenu` is `lazy()`-loaded inside a `<Suspense fallback={null}>`.
On the first time the user presses M and the merge menu opens, React
starts fetching the chunk and renders `null` until it arrives. For
users on fast connections this is imperceptible; on slow connections
or cold cache the menu briefly fails to appear.

**DEFERRED.** Cosmetic; not worth a placeholder spinner for first-load
latency that's typically <50ms.

---

### G-10: `window.prompt` for By Distance threshold

**File:** `src/v3/operators/registry.js:753–763`

`edit.merge.byDistance` uses `window.prompt()` for threshold input.
Documented as a v1 simplification. Blocks the browser's main thread,
crashes in SSR contexts, no unit-test coverage for the threshold-
parsing path. Phase 5+ should replace with the redo-panel pattern used
by Blender's `Merge by Distance`.

**DEFERRED.** Already documented as v1 simplification; the redo-panel
infrastructure is non-trivial and queued for Phase 6+.

---

## Tests passing post-fix

- 7 Phase 4 suites: 175 (original) + 18 (audit-fix pin) = 193 assertions
- All 144 sister suites green
- Typecheck clean
