# Toolset Phase 1 — Progress Log

Started: 2026-05-10
Plan: [TOOLSET_BLENDER_PARITY_PLAN.md](./TOOLSET_BLENDER_PARITY_PLAN.md) §Phase 1
Goal: rubber-band rectangle and freehand lasso selection in both
Object Mode (parts) and Edit Mode (verts). Builds on Phase 0's
`selectedVertexIndices` (Edit Mode) and the existing `selectionStore`
(Object Mode). Once shipped, every multi-vertex op (merge / dissolve
/ subdivide / extrude in Phase 4–5) has a high-throughput selection
gesture, not just per-click.

## Sub-phase status

| Sub | What | Status |
|-----|------|--------|
| 1.A | `selection.boxSelect` (B chord) — modal rect; replace / Shift add / Ctrl subtract; works in Object + Edit Mode | ✅ SHIPPED (2026-05-10) |
| 1.B | Lasso Select (`Ctrl+LMB-drag`) — modal polygon; even-odd fill rule; same modifiers; deferred dispatch preserves Edit-Mode shortest-path-pick on Ctrl+LMB-click | ✅ SHIPPED (2026-05-10) |
| 1.C | Edit-Mode optimization for >5000 verts (quadtree) | ⏳ DEFERRED — current impl is O(n) per call. Will revisit when a real char hits the threshold |
| 1.D | `BoxSelectOverlay.jsx` mounted in `CanvasArea` (handles both kinds via `boxSelectStore.kind`) | ✅ SHIPPED (2026-05-10) |
| 1.E | 4 test files: object-mode AABB, edit-mode vertex-in-rect, lasso winding, modifier composition (65 assertions total) | ✅ SHIPPED (2026-05-10) |
| 1.F | Manual exit gate (browser-side; verified by user) | ⏳ PENDING |

## What landed

### 1.A — `selection.boxSelect` operator + `B` keymap

[src/v3/keymap/default.js](../../src/v3/keymap/default.js):
```js
'KeyB': 'selection.boxSelect',
```

[src/v3/operators/registry.js](../../src/v3/operators/registry.js):
the operator captures `mode` (Object vs Edit) + `editPartId` at
activation so a mode-switch mid-drag doesn't redirect the eventual
commit. Opens the modal via `useBoxSelectStore.begin({ kind: 'box', ... })`.
Available from any context — Object Mode picks parts, Edit Mode picks
verts of the active part.

### 1.B — Lasso (`Ctrl+LMB-drag`)

Lasso is a mouse gesture, not a chord — wired in
[src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)
via a deferred-dispatch pattern so `Ctrl+LMB` keeps both meanings:

- **Ctrl+LMB-click** in Edit Mode + select tool → BFS shortest topology
  path from active vertex to clicked (Phase 0.B behaviour, preserved).
- **Ctrl+LMB-drag** in either Object Mode or Edit Mode + select tool
  → opens lasso modal once the cursor crosses 4px from the mousedown.

The candidate state lives in `lassoCandidateRef`. `onPointerMove`
promotes to lasso on threshold cross (releases pointer capture so the
overlay's window listeners take over, replays the move so the path
picks up where we left off, clears the candidate). `onPointerUp`
without a cross runs the captured `onClickFallback` closure (Edit-Mode
shortest-path-pick body, or no-op for Object Mode where Ctrl+LMB had
no prior meaning).

### 1.D — `BoxSelectOverlay.jsx` (handles both kinds)

[src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx](../../src/v3/editors/viewport/overlays/BoxSelectOverlay.jsx)
self-gates on `boxSelectStore.kind` so it only renders during a
B-drag or Ctrl+LMB-drag. Single component handles both because the
modal capture infrastructure (window-level mousemove / mouseup /
keydown / contextmenu) is identical — only the on-commit dispatch
branches on `kind`.

Render:
- Box: dashed orange `<rect>` with 10% fill, drawn from the snapped
  start corner to the live cursor.
- Lasso: dashed orange `<polyline>` with 10% fill, points from
  `pathClient` plus the live cursor.

Pointer events stay non-interactive (`pointer-events: none`) — the
overlay's window listeners drive commit / cancel.

Dispatch on commit:
- **Object Mode**: `partsInRect` / `partsInPolygon` against the
  project's nodes (with chainEval frames + composed verts from
  CanvasViewport via the new `getCanvasHitContext` bridge in
  `captureStore`). Modifier composes against `selectionStore.items`:
  - `replace` (no modifier) → drop prior selection, set new
  - `add` (Shift) → union via `selectionStore.select(refs, 'add')`
  - `subtract` (Ctrl) → filter prior items, drop matches, replace
  Mirrors active head into legacy `editorStore.selection[0]` slot for
  Properties / GizmoOverlay consumers.
- **Edit Mode**: `verticesInRect` / `verticesInPolygon` against the
  active part's `mesh.vertices`, projected through the part's inverse
  worldMatrix to LOCAL space (matches the Edit-Mode rest-frame
  selection model from Phase 0). Modifier composes a fresh `Set` and
  hands it to `setVertexSelectionForPart`. Active vertex pointer
  follows the last picked index on add/replace.

Cancel paths: Esc keydown, right-click. Both clear the modal store
without writing selection.

### Hit-test helpers (new in `src/io/hitTest.js`)

- `verticesInRect(verts, minX, minY, maxX, maxY)` — supports flat
  `[x,y,x,y,…]` and `Array<{x,y}>`; rect normalised; edge-inclusive;
  returns ascending indices.
- `verticesInPolygon(verts, polyXs, polyYs)` — even-odd fill rule;
  3-point minimum (degenerate polygons return empty).
- `pointInPolygon(px, py, polyXs, polyYs)` — standard ray-cast
  crossings test exposed for tests + future operators.
- `partsInRect(project, frames, minX, minY, maxX, maxY, opts)` —
  project-wide AABB intersection with vertex-source priority matching
  `hitTestParts`: finalVerts → frames → rest-mesh-via-worldMatrix →
  imageBounds → imageWidth/height-via-worldMatrix.
- `partsInPolygon(project, frames, polyXs, polyYs, opts)` — same
  source priority, returns parts whose AABB centre or any of the four
  corners is inside the polygon (more permissive than centre-only;
  matches Blender's behaviour where a lasso clipping a part still
  picks it up).

### Stores

[src/store/boxSelectStore.js](../../src/store/boxSelectStore.js)
(new):
- `kind` — `'box' | 'lasso' | null`
- `mode` — `'object' | 'edit'` (captured at begin)
- `editPartId` — Edit-Mode target (captured at begin)
- `startClient` — viewport-px anchor
- `currentClient` — viewport-px live cursor (drives draw)
- `pathClient` — viewport-px polygon (lasso only); appends are
  gated to ≥1px movement so a near-stationary pointer doesn't bloat
  the polygon
- `begin / update / commit / cancel` — modal lifecycle

[src/store/captureStore.js](../../src/store/captureStore.js):
- `getCanvasHitContext()` bridge — published by CanvasArea on mount,
  cleared on unmount; returns `{ canvasEl, frames, finalVertsByPartId }`
  fresh each call (closure over CanvasViewport's hit-context refs).
  Lets the AppShell-mounted overlay project its modal rect / polygon
  through what the user sees rendered.

## Tests

| Suite | Assertions | Notes |
|-------|------------|-------|
| `boxSelect_objectMode` | 13 | parts AABB intersect (rest, frames, finalVerts source priority); pre-mesh PSD imageBounds; rect normalisation; invisible-skip; group-skip; edge-inclusive |
| `boxSelect_editMode` | 13 | object-shape + flat-array verts; rect normalisation; edge-inclusive; ascending indices; replace/add/subtract modifier patterns |
| `lassoSelect_winding` | 20 | convex / concave-C / triangle / bowtie (figure-8 even-odd); degenerate-polygon defensive returns; verticesInPolygon (object + flat); partsInPolygon AABB-centre/corner test |
| `lassoSelect_modifiers` | 19 | Object-Mode replace/add/subtract via selectionStore; Edit-Mode replace/add/subtract via editorStore; boxSelectStore lifecycle (begin/update/commit/cancel); lasso path append + sub-1px skip |
| **TOTAL** | **65** | |

## Tests passing

| Adjacent suite | Pre-Phase 1 | Post-Phase 1 |
|----------------|-------------|--------------|
| editorStore | 87 | 87 |
| v3Operators | 62 | 63 (+1, new boxSelect operator) |
| selectionStore | 23 | 23 |
| canvasToolbar | 85 | 85 |
| hitTest | 35 | 35 |
| vertexSelection_basic | 28 | 28 |
| vertexSelection_persistence | 11 | 11 |
| vertexSelection_invalidation | 9 | 9 |
| vertexSelection_hitTest | 31 | 31 |
| boxSelect_objectMode | — | 13 (new) |
| boxSelect_editMode | — | 13 (new) |
| lassoSelect_winding | — | 20 (new) |
| lassoSelect_modifiers | — | 19 (new) |
| **TOTAL** | **673** | **738** |

No regressions. Typecheck clean.

## Manual gate (Phase 1.F)

Per plan §1.F, the manual exit gate is:

1. **Object Mode box** — load Hiyori (or any character). Press `B`,
   drag a rect over a few parts. On release the parts inside the
   rect are selected. Shift+drag adds; Ctrl+drag removes.
2. **Edit Mode box** — Tab into a meshed part. Press `B`, drag a
   rect over some verts. Selected verts go orange (Phase 0
   `VertexSelectionOverlay`). Shift / Ctrl modifiers behave the same
   as Object Mode.
3. **Object Mode lasso** — hold Ctrl, LMB-drag a freeform polygon
   around a few parts. On release the parts inside go selected.
4. **Edit Mode lasso** — same gesture in Edit Mode + select tool.
   Verts inside go orange.
5. **Ctrl+LMB-click in Edit Mode** still runs shortest-path-pick
   (Phase 0.B behaviour preserved by the deferred-dispatch pattern).
6. **Esc / right-click** mid-drag cancels the modal without writing
   selection.

## What's next

Phase 2 — Snap to grid / vertex (~3-4 days per plan). Modal G transforms
respect snap modes (snap-to-grid for `Math.round(delta / increment) *
increment`; snap-to-vertex via spatial hash). Touches
`ModalTransformOverlay.applyDelta` and a new `snap` slot in
preferencesStore. N-panel gains a Snap section.
