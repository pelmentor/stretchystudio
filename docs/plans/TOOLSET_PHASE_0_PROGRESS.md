# Toolset Phase 0 — Progress Log

Started: 2026-05-10
Plan: [TOOLSET_BLENDER_PARITY_PLAN.md](./TOOLSET_BLENDER_PARITY_PLAN.md)
Goal: ship the vertex selection foundation so Phase 1 (box/lasso),
Phase 4 (merge/dissolve/subdivide), Phase 5 (extrude), Phase 6
(select linked) — every multi-vertex op — has a selection set to
dispatch against.

## Sub-phase status

| Sub | What | Status |
|-----|------|--------|
| 0.A | `editorStore.selectedVertexIndices` + `activeVertex` slot + 9 actions | ✅ SHIPPED (2026-05-10) |
| 0.B | `hitTestVertices` + `buildVertexAdjacency` + `shortestPathBetweenVertices` + CanvasViewport `select` toolMode dispatch (LMB / Shift+LMB / Ctrl+LMB / empty-deselect) | ✅ SHIPPED (2026-05-10) |
| 0.C | `KeyA` (mode-aware select-all toggle) + `Alt+KeyA` (mode-aware deselect-all) | ✅ SHIPPED (2026-05-10) |
| 0.D | `VertexSelectionOverlay` mounted in `CanvasArea` (orange selected, white unselected, white-bordered active) | ✅ SHIPPED (2026-05-10) |
| 0.E | Default Edit-Mode `toolMode` flipped from `'brush'` → `'select'`; T-panel adds Select as first entry | ✅ SHIPPED (2026-05-10) |
| 0.F | Mode-switch persistence + `setSelection` head-change clear + topology-change invalidation hooks in add/remove vertex paths | ✅ SHIPPED (2026-05-10) |
| 0.G | 4 test files: basic / persistence / invalidation / hitTest (79 assertions total) | ✅ SHIPPED (2026-05-10) |

## What landed

### 0.A — Store slot + actions

[src/store/editorStore.js](../../src/store/editorStore.js):

- `selectedVertexIndices: Map<partId, Set<number>>` — per-part selection
  (Blender's Edit Mode model: selection lives on the `Mesh` datablock,
  not globally).
- `activeVertex: { partId, vertIndex } | null` — last-clicked vertex
  for the white-bordered active mark (Blender "active element").

Nine actions mirror Blender's Edit Mode operator set:
`selectVertex` / `deselectVertex` / `toggleVertexSelection` /
`setVertexSelectionForPart` / `selectAllVertices` /
`deselectAllVertices` / `clearAllVertexSelections` /
`invalidateVertexSelectionForPart`. Active-vertex pointer follows the
expected semantics: set on add, cleared when the active vertex is
removed.

### 0.B — Hit-test + adjacency + shortest-path

[src/io/hitTest.js](../../src/io/hitTest.js):

- `hitTestVertices(verts, worldX, worldY, threshold)` — returns the
  index of the nearest vertex within `threshold`, or `-1` when none.
  Supports both flat `[x0,y0,x1,y1,...]` and `Array<{x,y}>` shapes.
  Tie-break: lower index wins (deterministic).
- `buildVertexAdjacency(triangles, vertCount)` — returns
  `Map<vertIndex, Set<neighbourIndex>>` from a triangle index list.
- `shortestPathBetweenVertices(adjacency, fromIdx, toIdx)` — BFS
  shortest path on the adjacency graph (mirrors Blender's
  `mesh.shortest_path_pick`).

### 0.B (cont.) — CanvasViewport `select` dispatch

[src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)
gains a `toolMode === 'select'` branch in the Edit-Mode pointer
handler (in front of `add_vertex` / `remove_vertex` / brush). Threshold
is 6px scaled by `view.zoom` (matches Blender's vertex pick threshold).
Dispatch:

- LMB on a vertex → replace selection with that vertex
- Shift+LMB on a vertex → toggle that vertex
- Ctrl+LMB / Cmd+LMB on a vertex → BFS shortest topology path from
  active to clicked, merge the path into the selection. Falls through
  to plain select when active is null or path is unreachable.
- LMB on empty space → `deselectAllVertices(activePartId)`. Shift+LMB
  on empty space is a no-op (don't drop a careful multi-select build).

### 0.C — `A` / `Alt+A` keymap

[src/v3/keymap/default.js](../../src/v3/keymap/default.js) +
[src/v3/operators/registry.js](../../src/v3/operators/registry.js):

- `KeyA` → `selection.selectAllToggle` (existing chord) — operator
  now branches on `editMode === 'edit' && toolMode === 'select'`.
  In that branch, scope toggles between "all of the active part's
  verts selected" and "none". Outside, falls through to existing
  Object-Mode part-selection behaviour.
- `Alt+KeyA` → `selection.deselectAll` (new operator). Mode-aware:
  in Edit Mode + select tool clears the active part's vertex
  selection; otherwise clears object selection (mirrors Escape but
  matches Blender muscle memory).

### 0.D — Overlay

[src/v3/editors/viewport/overlays/VertexSelectionOverlay.jsx](../../src/v3/editors/viewport/overlays/VertexSelectionOverlay.jsx)
(new) renders one dot per vertex in the active part:

- Selected: orange-filled (HSL 25 95% 55%, r=4)
- Unselected: white at 60% alpha (r=2.2)
- Active (last clicked): white-bordered orange (r=5.5) on top

Read-only — `pointerEvents: 'none'` so CanvasViewport keeps single-
source pointer dispatch. Self-gates on
`editMode === 'edit' && toolMode === 'select'` so it only mounts when
relevant. Mounted in
[src/v3/shell/CanvasArea.jsx](../../src/v3/shell/CanvasArea.jsx)
alongside the existing WeightPaintOverlay.

### 0.E — Default + T-panel

[src/store/editorStore.js](../../src/store/editorStore.js):
`enterEditMode('edit')` now defaults `toolMode` to `'select'` instead
of `'brush'` (Blender pattern: Edit Mode opens with Select active,
not Brush). Brush remains accessible via the T-panel and via the
sticky `lastToolByMode` preference.

[src/v3/shell/canvasToolbar/tools.js](../../src/v3/shell/canvasToolbar/tools.js)
adds `'select'` as the FIRST entry in the `mesh` tool list so the
T-panel surfaces it immediately. Brush, Add Vertex, Remove Vertex
follow.

### 0.F — Persistence + invalidation

In [`editorStore.js`](../../src/store/editorStore.js):
- `setSelection` (head change) and `exitEditMode` both clear
  `selectedVertexIndices` + `activeVertex`. Mode-to-mode transitions
  via direct state writes (e.g. Edit → Pose → Edit) preserve the
  selection.

In [`CanvasViewport.jsx`](../../src/components/canvas/CanvasViewport.jsx):
- `add_vertex` and `remove_vertex` paths call
  `invalidateVertexSelectionForPart(partId)` after persisting the
  topology change. Index renumbering after vertex removal would
  otherwise leave stale selections pointing at the wrong vertex.

### 0.G — Tests

| Suite | Assertions |
|-------|------------|
| `vertexSelection_basic` | 28 — per-action contracts (select/deselect/toggle/set/all/invalidate + active-vertex tracking + per-part isolation + bad-input no-ops) |
| `vertexSelection_persistence` | 11 — Edit↔Pose preserves; exitEditMode clears; setSelection head-change clears; same-head preserves; selection extension preserves |
| `vertexSelection_invalidation` | 9 — invalidate drops part + active; isolation across parts; no-op stability |
| `vertexSelection_hitTest` | 31 — hit-test exact/nearest/tie/threshold, both flat and object-shape arrays; adjacency single-tri / quad / shared-edge; BFS straight path / shortcut / disconnect / missing endpoint |
| **TOTAL** | **79** |

Plus 1 fixture update (`test_editorStore.mjs`) and 1 fixture update
(`test_canvasToolbar.mjs`) to reflect the new default.

## Tests passing

| Adjacent suite | Pre-Phase 0 | Post-Phase 0 |
|----------------|-------------|--------------|
| editorStore | 86 | 87 (+1, default flip) |
| v3Operators | 62 | 62 |
| selectionStore | 23 | 23 |
| canvasToolbar | 82 | 85 (+3, select entry) |
| hitTest | 35 | 35 |
| viewportHelpers | 53 | 53 |
| objectDataAccess | 59 | 59 |
| chainEval | 25 | 25 |
| selectRigSpec | 64 | 64 |
| initRig | 60 | 60 |
| projectRoundTrip | 41 | 41 |
| vertexSelection_basic | — | 28 (new) |
| vertexSelection_persistence | — | 11 (new) |
| vertexSelection_invalidation | — | 9 (new) |
| vertexSelection_hitTest | — | 31 (new) |
| **TOTAL** | **590** | **673** |

No regressions. Typecheck clean.

## Manual gate (Phase 0.H)

Per plan §0.H, the manual exit gate is:

1. In Hiyori (or any meshed character) Edit Mode, click a vertex,
   see the orange dot on it.
2. Shift-click another, both render orange. Active mark is the
   second vertex (white border).
3. `A` toggles all on/off scoped to the active part.
4. `Alt+A` deselects all.
5. Ctrl+click a vertex with one already active → BFS shortest path
   between them joins the selection.
6. Switching to Pose Mode and back keeps the selection.
7. Pressing Tab to leave Edit Mode drops the selection.
8. No regressions in existing brush / add_vertex / remove_vertex
   tools (all reachable from the T-panel; brush survives sticky
   `lastToolByMode`).

## What's next

Phase 1 — Box / Lasso Select (1 week per plan). Foundation is in
place: `selectedVertexIndices` is the consumer that box-select writes
to. Plan §Phase 1 entry point: rectangle drag in Edit Mode (verts
inside) and Object Mode (parts inside).
