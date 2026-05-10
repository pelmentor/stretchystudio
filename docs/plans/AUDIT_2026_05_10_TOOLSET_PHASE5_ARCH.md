# Phase 5 Architecture Audit — 2026-05-10

Independent code review of commit `ea590ac` (Toolset Phase 5 — Extrude
operator + vertex-mode modal G + `discardBatch` rollback path).

Traced the full pipeline: keymap → dispatcher → operator registry
→ pure `extrude()` math → `applyTopologyOp` (selectionOverride path)
→ `useModalVertexTransformStore.begin` → overlay mount → per-tick
`uploadPositions` writes → commit (`endBatch`) or rollback
(`discardBatch` + `uploadMesh`). Verified all 116 new test assertions.
Examined sister modules touched by the new APIs (`undoHistory`,
`snapHash`, `applyTopologyOp`, `meshTopology`) for regressions and
silent contract drift.

## Summary

13 gaps total — **2 HIGH** (silent semantic divergence + undefined
GPU behaviour reachable on first use), **7 MED** (race / coupling /
defensive gaps that will rot), **4 LOW** (dead data / labelling drift
/ test gaps). No HIGH gap is a crash, but G-1 silently undermines
the user-visible result of the whole operator.

| ID   | Sev  | One-line                                                                                                                                       | Recommended action |
|------|------|------------------------------------------------------------------------------------------------------------------------------------------------|--------------------|
| G-1  | HIGH | Modal vertex translate writes only `x/y` — `restX/restY` of new dups stays at source position; rig sees dups at source → drag invisible to chainEval | FIX (write rest = pose for Edit-Mode-driven modal) |
| G-2  | HIGH | `applyTopologyOp` return value ignored by extrude exec — failure leaves a dangling batch + bogus modal session                                  | FIX (gate on return; close batch on failure) |
| G-3  | MED  | Escape leaks past overlay capture-listener → also fires `selection.clear` on cancel                                                           | FIX (overlay calls `e.stopPropagation()` on Escape/Enter) |
| G-4  | MED  | Inter-modal collision: while extrude modal active, pressing G/E/R/S/M/B fires another operator + opens another modal (capture listener doesn't preventDefault those keys) | FIX or DOCUMENT (overlay should swallow operator chords while active) |
| G-5  | MED  | Per-tick `applyDelta` allocates a new `Float32Array(uvs)` for every mousemove — GC pressure on smooth drags                                    | FIX (cache UVs Float32Array at modal entry) |
| G-6  | MED  | useEffect re-runs on `axis` change → snap hash + anchor verts rebuild on every X/Y press; transient `clearSnapTarget` on each toggle           | FIX (move snap-hash build to depth-1 ref initialization, not effect deps) |
| G-7  | MED  | Mid-commit mousemove race: queued mousemoves between `commit()` and React cleanup mutate verts via stale closure `original`/`vertIndices`      | FIX (early-return in `applyDelta` if store kind is null) |
| G-8  | MED  | `discardBatch` leaks `_redoStackBeforeBatch` when called at depth 1 with empty snapshots stack (e.g. clearHistory mid-batch)                  | FIX (always null `_redoStackBeforeBatch` on depth→0) |
| G-9  | MED  | `excludeVertIndicesByPart` snap-exclusion path has zero direct test coverage; semantic correctness assumed but never asserted                 | FIX (add test exercising the exclusion in `buildSnapHash`) |
| G-10 | LOW  | `original` Map stores `restX/restY` per-vert but neither `applyDelta` nor `revertVerts` ever reads them — dead data in store + typedef         | FIX (drop restX/restY from typedef + capture; tracking for G-1 lift) |
| G-11 | LOW  | Snap hash `cellSize: 64` hardcoded; user-configured threshold > 64 silently misses snap targets                                              | DOCUMENT (sister `ModalTransformOverlay` has same gap) |
| G-12 | LOW  | `extrude.js:60` typedef comment imprecise: says "growth pass would otherwise leave source verts selected" — actually the SURVIVOR pass keeps them | FIX (comment) |
| G-13 | LOW  | `extrude.js` doesn't defend against `mesh.uvs === undefined` — would throw on `mesh.uvs[i*2]` access                                          | DEFER (gated by registry; not reachable today) |

---

## HIGH-severity gaps

### G-1: Modal vertex translate doesn't update `restX`/`restY` — extrude drag invisible to rig

**File:** `src/v3/shell/ModalVertexTransformOverlay.jsx:204–211`; `src/v3/operators/registry.js:911–921`; `src/v3/operators/edit/extrude.js:96–108`

`applyDelta` writes only `mesh.vertices[idx].x/y`:

```js
for (const idx of vertIndices) {
  const orig = original.get(idx);
  if (!orig) continue;
  if (idx >= 0 && idx < mesh.vertices.length) {
    mesh.vertices[idx].x = orig.x + dxCanvas;
    mesh.vertices[idx].y = orig.y + dyCanvas;
  }
}
```

`restX`/`restY` stays untouched. After `extrude()` runs, the duplicate
vertex is `{...src}` — i.e. it INHERITS `src.restX/restY`, anchored at
the source position. The drag updates only pose-x/y. After commit, the
duplicate has:

  - `x/y` = dragged position (visible only in raw Edit Mode rendering)
  - `restX/restY` = source position (what chainEval / rig / export reads)

Edit Mode legacy single-vertex drag (`CanvasViewport.jsx:3115–3116`)
has the same x/y-only convention — so this isn't a regression of
existing UX. **But for Extrude specifically**, the user's mental
model is "drag to place the new strip at this position." The strip
is then exported / animated / posed — and the rig sees it AT THE
SOURCE POSITION, on top of the original verts. The dragged effect
vanishes the moment chainEval runs (Pose Mode preview, animation
playback, export, even another tab switch back to Object Mode if the
rig was initialised).

Compare to:
  - `add_vertex` (`CanvasViewport.jsx:2487`): new vert gets
    `{x: lx, y: ly, restX: lx, restY: ly}` — rest = pose at creation.
  - `merge.js:99–102`: writes `vertices[newIdx].restX = overridePos.x`
    in addition to `x`. The collapsed centroid is permanent.

The Extrude modal needs the SAME treatment: while the user is
dragging in Edit Mode, both pose AND rest must update so that exiting
Edit Mode preserves the placement.

**Reproduction:** Edit Mode on a meshed part. Select a boundary vert.
Press E. Drag the duplicate 100 px away. Click to commit. Exit Edit
Mode. Observe: the duplicate snaps back to the source position because
chainEval reads restX/restY (= source position). The user's drag is
lost.

**Recommended fix:** In the modal's `applyDelta` (and `revertVerts`),
when the modal session was launched from Edit Mode (or always — Edit
Mode is the only entry path for vertex-modal in v1), write both pose
AND rest:

```js
mesh.vertices[idx].x = orig.x + dxCanvas;
mesh.vertices[idx].y = orig.y + dyCanvas;
mesh.vertices[idx].restX = (orig.restX ?? orig.x) + dxCanvas;
mesh.vertices[idx].restY = (orig.restY ?? orig.y) + dyCanvas;
```

The orig.restX/restY captures (currently dead per G-10) become live data.
This also closes the divergence with merge.js and add_vertex, both of
which write rest.

---

### G-2: `applyTopologyOp` return value ignored — failure leaves dangling batch

**File:** `src/v3/operators/registry.js:895–909`

```js
beginBatch(project);

// Apply the topology op INSIDE the batch — its updateProject call
// is suppressed from snapshotting (isBatching() is true).
applyTopologyOp(partId, result);

// Capture original positions for the new verts (== source vert
// positions, since extrude duplicates at the same coords).
const newProject = useProjectStore.getState().project;
const newNode = newProject.nodes.find((n) => n.id === partId);
const newMesh = newNode?.mesh;
if (!newMesh) return;
```

`applyTopologyOp` returns `false` when the project node or its mesh
is missing. The exec ignores the return value. If applyTopologyOp
fails (e.g. the partId becomes invalid between the `activeEditPart()`
check and the topology op due to a race with another store update —
unlikely in practice but possible if any future code path mutates
`project.nodes` synchronously), then:

1. `beginBatch` already pushed a snapshot.
2. `applyTopologyOp` returned false WITHOUT mutating the project.
3. The `if (!newMesh) return;` early return fires.
4. **The batch is left dangling.** No `endBatch`/`discardBatch` call.
5. Subsequent `beginBatch` calls increment depth without pushing.
6. Subsequent `endBatch` calls decrement back down without popping the
   stale snapshot from extrude.

Stale snapshot persists in `_snapshots`. The next user undo would
restore to a state that never represented an edit.

The `if (!newMesh) return` already exists — but the failure path
was added defensively without closing the batch. The same gap exists
for the `if (!result) return` two lines earlier (line 891), but at
that point `beginBatch` hasn't fired yet, so it's safe.

**Reproduction:** Hard to repro in production today (no concurrent
mutator races between `activeEditPart()` and `applyTopologyOp`).
Reachable defensively — any future code path that snapshot-deletes a
part on an unrelated worker promise could trigger it.

**Recommended fix:**

```js
beginBatch(project);
const ok = applyTopologyOp(partId, result);
if (!ok) {
  // Bail cleanly — no topology applied, drop the batch.
  endBatch();   // depth back to 0; the pushed snapshot becomes a no-op undo entry
  // OR discardBatch to drop the snapshot entirely:
  discardBatch(() => {});
  return;
}
const newProject = useProjectStore.getState().project;
...
```

`discardBatch(() => {})` is cleaner — drops both the dangling batch and
the no-op snapshot.

---

## MED-severity gaps

### G-3: Escape on cancel ALSO triggers `selection.clear`

**File:** `src/v3/shell/ModalVertexTransformOverlay.jsx:243–248`; `src/v3/operators/dispatcher.js:50–67`

The overlay's `keydown` listener uses `{capture: true}` — fires first.
On Escape:
```js
if (e.key === 'Escape') {
  e.preventDefault();
  rollbackThenCancel();
  return;
}
```

`preventDefault()` does NOT stop propagation. The dispatcher's
window-level listener (bubble phase) ALSO fires for Escape. It
resolves Escape → `selection.clear` → calls
`useSelectionStore.getState().clear()`. So pressing Escape during
extrude modal:

1. Capture-phase: `rollbackThenCancel()` rolls back extrude, modal
   closes.
2. Bubble-phase: object selection is cleared.

Result: user cancels an extrude → loses their object selection →
has nothing to operate on next. Surprising side effect.

Sister `ModalTransformOverlay` has the same gap (line 374), so this is
a pre-existing pattern Phase 5 inherits. Worth flagging because it's
two clicks/keys to recover from a single Esc.

**Recommended fix:** Add `e.stopPropagation()` after preventDefault in
both overlays' Escape, Enter, KeyX, KeyY, Backspace, digit handlers.
Sister overlay should be fixed in the same sweep.

---

### G-4: Operator chords leak past modal — Phase 5 modal doesn't shadow E/G/R/S/M/B etc.

**File:** `src/v3/shell/ModalVertexTransformOverlay.jsx:243–303`; `src/v3/operators/dispatcher.js`

The overlay's `onKeyDown` only handles a finite set of chords:
Escape, Enter, KeyX, KeyY, Backspace, digits / `-` / `.`, Control,
Meta, Shift. Anything else falls through to the dispatcher's bubble-
phase listener. So while the extrude modal is active:

- Pressing **E** fires `edit.extrude` again (would no-op because the
  selection is now the new dups, but if the user picked some verts
  before the second E, it would extrude again and open a NESTED
  modal with the OLD modal still active).
- Pressing **G** fires `transform.translate` (opens node-level
  ModalTransformOverlay simultaneously).
- Pressing **B** fires `selection.boxSelect` (mounts BoxSelectOverlay
  on top of the active vertex overlay).
- Pressing **M** opens MergeMenu popover.

Each of these would mount additional modal/overlay components alongside
the active vertex modal. State becomes corrupted.

Sister `ModalTransformOverlay` has the same gap (only handles a small
chord set + lets others through). Pre-existing pattern.

**Recommended fix:** While modal is active, the overlay should
swallow ALL keyboard events — `e.stopPropagation()` on every keydown
that isn't in the handled set, OR install a higher-priority dispatcher
short-circuit that gates on `modalKind || vertexModalKind`. Sister
ModalTransformOverlay needs the same treatment.

---

### G-5: Per-tick `Float32Array` allocation in `applyDelta`

**File:** `src/v3/shell/ModalVertexTransformOverlay.jsx:218–222`

```js
if (scene && scene.parts && postMeshVerts) {
  const uvsArr = postMeshUvs instanceof Float32Array
    ? postMeshUvs
    : new Float32Array(postMeshUvs ?? []);
  scene.parts.uploadPositions(partId, postMeshVerts, uvsArr);
  ...
}
```

After `applyTopologyOp`, the project's `mesh.uvs` is stored as a plain
`Array<number>` (`applyTopologyOp.js:132`: `m.uvs = Array.from(result.uvs);`).
Each mousemove tick allocates a fresh `Float32Array` from the plain
Array. At 60 Hz drag, that's 60 allocations/sec of size `2 * vertCount`
floats. For Hiyori-class meshes (~3000 verts/part), each allocation is
24 KB — 1.4 MB/sec of GC pressure during a drag.

The UVs DO NOT change during the modal drag — only positions move.
So this conversion can run ONCE at modal entry and be reused.

**Recommended fix:** Cache the `Float32Array` UVs in a `useRef` at
modal entry. Subsequent ticks reuse the cached array.

---

### G-6: useEffect dependency on `axis` rebuilds snap hash on every X/Y press

**File:** `src/v3/shell/ModalVertexTransformOverlay.jsx:407–408`

The useEffect deps list:

```js
}, [kind, partId, axis, startMouse, original, vertIndices, rollbackOnCancel,
    setAxis, appendTyped, popTyped, commit, cancel]);
```

Every time the user presses X or Y to constrain axis (which sets `axis`
in the store), this useEffect re-runs:

1. Cleanup removes window listeners.
2. New effect re-acquires canvas DOM rect, rebuilds snap hash via
   `buildSnapHash(project, ...)`, rebuilds `anchorVertsRef`.
3. Calls `useSnapStore.getState().clearSnapTarget()` — magenta dot
   blinks off transiently.
4. Re-attaches window listeners.

For Hiyori (~50 parts × 3000 verts = 150k verts), the snap hash build
is ~30 ms per axis toggle. Visible jank during axis changes. Sister
`ModalTransformOverlay` has the same dep list (line 483).

**Recommended fix:** Move the snap-hash build to `kind`-only deps via
a separate effect, OR use a `useEffect` with the build at modal-open
only and clean up on close.

---

### G-7: Mid-commit race writes verts via stale closures

**File:** `src/v3/shell/ModalVertexTransformOverlay.jsx:325–334, 199–214`

Click-to-commit flow:
```js
function commitInternal() {
  endBatch();
  useSnapStore.getState().clearSnapTarget();
  recordMeshSignature();
  commit();   // store.commit() — kind, original, vertIndices reset
}
```

After `commit()`, store state has `kind: null, original: new Map(), vertIndices: new Set()`.
React schedules a re-render. Cleanup will fire on the new render.

But event-loop queuing: between `commit()` and React's next render,
queued mousemove events fire `onMouseMove → applyDelta`. The closure
variables `original` and `vertIndices` are CAPTURED from the React
render scope (line 65–66) — they hold the OLD references (the
pre-commit Map and Set). The loop in `applyDelta`:

```js
for (const idx of vertIndices) {
  const orig = original.get(idx);
  if (!orig) continue;
  if (idx >= 0 && idx < mesh.vertices.length) {
    mesh.vertices[idx].x = orig.x + dxCanvas;
    mesh.vertices[idx].y = orig.y + dyCanvas;
  }
}
```

Iterates over the OLD `vertIndices` Set with valid indices. Reads
`original.get(idx)` from the OLD Map — returns valid orig data.
Writes to mesh.vertices. updateProject runs with skipHistory=true so
no undo pollution, but the verts MOVE based on the latest cursor
position — not where the user clicked to commit.

In practice the gap between `commit()` and React's cleanup is ~16 ms
(one frame). Programmatic event injection would reproduce reliably;
real users probably don't hit this. Sister `ModalTransformOverlay`
has the same pattern.

**Recommended fix:** At the top of `applyDelta`, early-return if
`useModalVertexTransformStore.getState().kind === null`:

```js
function applyDelta(currentX, currentY, shift, ctrl) {
  if (useModalVertexTransformStore.getState().kind === null) return;
  ...
}
```

Stops any post-commit/post-cancel mousemove from re-mutating verts.

---

### G-8: `discardBatch` can leak `_redoStackBeforeBatch` on snapshots-empty path

**File:** `src/store/undoHistory.js:110–124`

```js
export function discardBatch(applyFn) {
  if (_batchDepth === 0) return;
  if (_batchDepth === 1 && _snapshots.length > 0) {
    const snap = _snapshots.pop();
    if (typeof applyFn === 'function') applyFn(snap?.project);
    if (_redoStackBeforeBatch !== null) {
      _redoStack = _redoStackBeforeBatch;
      _redoStackBeforeBatch = null;
    }
  }
  _batchDepth = Math.max(0, _batchDepth - 1);
}
```

If `_batchDepth === 1` BUT `_snapshots.length === 0` (snapshots cleared
mid-batch via `clearHistory()`), then:
- The inner `if` block doesn't execute.
- `_redoStackBeforeBatch` is NOT cleared.
- depth decrements to 0.
- Next `beginBatch` overwrites `_redoStackBeforeBatch` via `_redoStack.slice()`,
  so no permanent leak — but the post-clear redo state is wrong: the
  user's redo stack was already reset by `clearHistory`, but any
  subsequent `discardBatch` would try to restore `_redoStackBeforeBatch`
  even though it's no longer relevant.

`clearHistory` mid-batch is reachable via project load while modal
is active. Today `clearHistory` is called from `resetProject` and
project-load paths.

**Reproduction:** Begin extrude. Mid-modal, dispatch `file.new` (which
calls `resetProject` → `clearHistory`). Immediately Esc to cancel
modal. Stale `_redoStackBeforeBatch` resurfaces on the next beginBatch
+ discardBatch cycle.

**Recommended fix:** Always null `_redoStackBeforeBatch` on depth → 0
unconditionally:

```js
if (_batchDepth === 1) {
  if (_snapshots.length > 0) {
    const snap = _snapshots.pop();
    if (typeof applyFn === 'function') applyFn(snap?.project);
  }
  // Always clear backup on depth → 0 — covers the snapshots-empty
  // edge (clearHistory mid-batch).
  if (_redoStackBeforeBatch !== null) {
    _redoStack = _redoStackBeforeBatch;
    _redoStackBeforeBatch = null;
  }
}
_batchDepth = Math.max(0, _batchDepth - 1);
```

---

### G-9: `excludeVertIndicesByPart` snap-hash filter has no test coverage

**File:** `src/lib/snap/snapHash.js:155–176`; `scripts/test/test_snap_*.mjs`

The new `opts.excludeVertIndicesByPart` parameter (Phase 5 addition)
is consumed by the modal overlay (line 95–98) to exclude the
duplicates from self-snapping. But no test exercises the path: every
existing snap test calls `buildSnapHash(project)` without the new
opt; every Phase 5 modal test bypasses the overlay and drives stores
directly.

The semantics — "verts in `excludeIdx.get(node.id)` set are skipped;
other verts on the same part remain in the hash" — are completely
untested. A regression that broke the Map/Set lookup or the per-vert
skip would slip through.

**Recommended fix:** Add a unit test:

```js
// test_snap_excludeVertIndices.mjs
const project = { nodes: [{ id: 'p1', type: 'part', mesh: { vertices: [
  { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }
]}}]};
const hash = buildSnapHash(project, {
  excludeVertIndicesByPart: new Map([['p1', new Set([1])]]),
});
assert(hash.count === 2, 'vert 1 excluded, others kept');
assert(hash.findNearest(10, 0, 1) === null, 'excluded vert not found');
assert(hash.findNearest(0, 0, 1)?.vertIndex === 0, 'non-excluded vert findable');
```

---

## LOW-severity gaps

### G-10: `original` Map captures `restX`/`restY` but they're never read

**File:** `src/v3/operators/registry.js:911–921`; `src/store/modalVertexTransformStore.js:43`

The extrude operator captures rest values at modal entry:
```js
original.set(idx, {
  x:     v.x,
  y:     v.y,
  restX: v.restX ?? v.x,
  restY: v.restY ?? v.y,
});
```

The modal overlay's `applyDelta` and `revertVerts` only read `orig.x/y`
— never `orig.restX/restY`. The typedef requires them
(`{x, y, restX, restY}`) but they're dead data.

If G-1 is fixed (extrude writes rest), this dead data becomes live —
keep the captures and update the typedef accordingly. If G-1 is
DEFERRED, drop restX/restY from the typedef + capture.

**Recommended fix:** Tie to G-1. Either lift them into use, or drop.

---

### G-11: Hardcoded snap `cellSize: 64` clips threshold > 64

**File:** `src/v3/shell/ModalVertexTransformOverlay.jsx:96`; `src/v3/shell/ModalTransformOverlay.jsx:137`

```js
snapHashRef.current = buildSnapHash(project, {
  cellSize: 64,
  excludeVertIndicesByPart: new Map([[partId, vertIndices]]),
});
```

`findNearest` doc says `dist` must be ≤ `cellSize`. If user configures
`snap.modes.vertex.threshold > 64`, the 3×3 cell scan misses targets
beyond the cell boundary. Sister `ModalTransformOverlay` has the same
gap (cellSize: 64, line 137).

**Recommended fix:** Either clamp threshold to cellSize at modal entry,
OR derive cellSize from `Math.max(64, threshold)`. Sister overlay
should match. Pre-existing pattern; LOW because the default threshold
is 8 px and most users don't customize.

---

### G-12: Comment in `extrude.js` typedef misnames the selection growth pass

**File:** `src/v3/operators/edit/extrude.js:60`; `src/lib/meshTopology.js:54–62`

```js
* @property {Set<number>}                    [selectionOverride]
*   ...
*   The growth pass would otherwise leave the source verts
*   selected (they were selected pre-op + their `vertexSources` entry is
*   length-1).
```

Misleading. The GROWTH pass (`applyTopologyOp:218–228`) explicitly
SKIPS length-1 sources (`if (sources.length <= 1) continue;`). Source
verts stay selected because of the SURVIVOR pass
(`vertexIndexRemap.get(oldIdx) = oldIdx` for unchanged verts). The
override bypasses BOTH passes.

**Recommended fix:** Rephrase to "the survivor pass would otherwise
keep the source verts selected (`vertexIndexRemap` returns identity
for the originals)".

---

### G-13: `extrude.js` doesn't defend against undefined `mesh.uvs`

**File:** `src/v3/operators/edit/extrude.js:132–140`

```js
const uvs = new Float32Array(newVertices.length * 2);
for (let i = 0; i < mesh.vertices.length; i++) {
  uvs[i * 2]     = mesh.uvs[i * 2]     ?? 0;
  uvs[i * 2 + 1] = mesh.uvs[i * 2 + 1] ?? 0;
}
```

Throws on `mesh.uvs[i * 2]` access if `mesh.uvs` is undefined. Today
unreachable — every meshed part has UVs (gated by registry's
`activeEditPart()`/`topologyAvailable`). DEFER as defensive polish.

---

## Tests passing post-audit

- All 6 new Phase 5 suites: 116 assertions
- Sister `test:undoHistory`: 22 (unchanged) — discardBatch additions
  don't break existing batch / push / undo / redo paths
- Sister snap suites green
- Sister sculpt suites green
- Typecheck clean

## Coverage gaps in test suite (informational)

- Modal overlay's `applyDelta` / `revertVerts` / `rollbackThenCancel`
  / `commitInternal` are NOT directly tested — Phase 5's modal tests
  drive the store directly, bypassing the overlay's mid-flight logic.
  G-1, G-3, G-4, G-5, G-7 all live in the overlay, undetected by unit
  tests.
- No test for `excludeVertIndicesByPart` (G-9).
- No test for snap interaction during a real modal session.
- No test for extrude-then-extrude-again (E pressed mid-modal, G-4).
- No test for extrude on a part with weightGroups or non-trivial UVs
  (the dispatcher's per-vertex remap is exercised by Phase 4's tests
  but not specifically with extrude's selectionOverride path beyond
  blendShapes).

## Files audited

- `src/v3/operators/edit/extrude.js` — pure operator (200 LOC)
- `src/store/modalVertexTransformStore.js` — modal state (119 LOC)
- `src/v3/shell/ModalVertexTransformOverlay.jsx` — overlay (458 LOC)
- `src/lib/meshTopology.js` — additions (`getBoundaryVerts` /
  `getBoundaryEdges` + typedef extension)
- `src/v3/operators/edit/applyTopologyOp.js` — selectionOverride path
- `src/store/undoHistory.js` — `discardBatch` + `_redoStackBeforeBatch`
- `src/lib/snap/snapHash.js` — `excludeVertIndicesByPart`
- `src/v3/keymap/default.js` — `KeyE` chord
- `src/v3/shell/AppShell.jsx` — overlay mount
- `src/v3/operators/registry.js` — `edit.extrude` operator
- `package.json` — new test scripts wired into `test` chain

## Sister regressions checked

- `undoHistory`: 22 assertions still pass; `discardBatch` is purely
  additive.
- `applyTopologyOp`: existing paths (Merge / Dissolve / Subdivide)
  unaffected — `selectionOverride` is opt-in via Set check.
- `snapHash`: existing callers (sister modal, applyPoseAsRest paths)
  unaffected — `excludeVertIndicesByPart` is opt-in.
- `meshTopology`: no existing helper modified; new exports only.
- Edit Mode legacy single-vertex drag (`CanvasViewport.jsx:3115–3116`)
  exhibits the same x/y-only behaviour as G-1 — Phase 5 inherits this
  but does not introduce it.
