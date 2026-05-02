# Click-to-Select on Canvas (Blender-style)

**Status:** SHIPPED 2026-05-02 — see [`src/io/hitTest.js`](../src/io/hitTest.js), [`CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) object-mode branch, `selection.selectAllToggle` operator + `KeyA` chord, [`V3_WORKSPACES.md` § Click-to-select](V3_WORKSPACES.md). Plan history retained below.
**Origin:** user 2026-05-02 — "We need a selection mode like in blender. with outline, with user being able to select layers just by clicking on them on the canvas. Без костылей."

## What's missing

Today the canvas does NOT support click-to-select of parts. You select parts via the Outliner. Click on the canvas in object mode does pan / drag-to-pivot for groups, but there's no "click the visible mesh, that part becomes selected" gesture. Blender's 3D Viewport does this trivially: click on a mesh → it's the active object, edge outline lights up.

## Target shape

In Object Mode (`editMode === null`) on the edit Viewport:
- **LMB click on a part** → that part becomes the selection. The existing `viewLayers.edgeOutline || isSelected` path in scenePass already draws the boundary outline → we just have to set `editorStore.selection` and `selectionStore`. Outline appears for free.
- **Shift+LMB click** → toggles the part in the multi-selection.
- **LMB click on empty canvas** → clears selection (Blender pattern).
- **Click hits the topmost mesh under the cursor** by drawOrder (front-to-back).

In edit modes (mesh / skeleton / blendShape) the click-to-select is **suppressed** for parts — clicks already do mode-specific work (vertex drag, joint drag, paint). Lock Object Modes preference (already shipped) doubles down on this for the lock-on case.

## Hit-testing approach

We have rig-evaluated vertex positions per frame in scenePass (`evalRig` output). On click:

1. Convert client coords → canvas-px → world-image-space (existing `clientToCanvasSpace` helper).
2. Sort visible parts by `draw_order` descending (front-to-back).
3. For each part with a mesh, run a point-in-triangulation test using **rig-evaluated** vertex positions (so the hit-test matches what's actually rendered, not the rest mesh).
4. First triangle that contains the world point → that part is the hit. Stop iterating.
5. No hit → empty click, clear selection (or no-op if Shift held).

### Why mesh triangulation, not pixel sampling

Pixel sampling would need a GPU readback (slow + brittle with stencil masks). The triangle test is pure CPU, runs against a few hundred to ~50k triangles total per character (well within click-handler latency budget — 10ms is fine), and uses only data we already have.

### Edge case: alpha-zero regions inside the mesh

A mesh might have its boundary covering an area where the texture is fully transparent (e.g. a hand mesh with a hole). Today the boundary outline shows the silhouette of the triangulation, not the visible alpha. For first-cut, treat the whole triangulation as opaque (matching what edge outline shows). If users complain about clicks hitting "invisible" parts, layer a per-triangle UV alpha sampling step on top later. Don't ship that initially — simpler heuristic first.

### Edge case: behind clip-mask

A masked mesh (e.g. iris behind eye-white stencil) is only visible inside the mask region. Clicks landing where the mask region doesn't cover should not hit the iris. Defer this — initially click any triangle of the iris that contains the cursor selects it, even if visually clipped. Acceptable for first-cut; revisit if it becomes a real friction point.

## Implementation

### Files

- **New** [`src/io/hitTest.js`](../src/io/hitTest.js) — pure function `hitTestParts(project, frames, worldX, worldY)` returning the topmost hit `partId` or null. Imports `pointInTriangle` from existing geometry helpers (or inlines it). 100% testable without React or WebGL.
- [`src/components/canvas/CanvasViewport.jsx`](../src/components/canvas/CanvasViewport.jsx) — extend the existing `handlePointerDown` path so when:
  - `editMode === null` (Object Mode)
  - target is the canvas (not an overlay button / SVG handle)
  - Modifier check (Shift = toggle, otherwise replace)
  - run `hitTestParts(project, lastFramesRef.current, worldX, worldY)`
  - call `useEditorStore.getState().setSelection([partId])` + `useSelectionStore.getState().select({type:'part', id:partId}, modifier)`
  - `null` hit + no Shift → both stores cleared.
- Properties tabs / Outliner — no changes; they already react to `selection` updates.

### `lastFramesRef`

Today CanvasViewport caches the last `evalRig` output for memoization (`lastEvalCacheRef`). Reuse this in hit-test: `lastEvalCacheRef.current.frames`. If it's stale (rigSpec changed), hit-test falls back to `node.mesh.vertices` (rest pose) — better than nothing.

### Modifier semantics (already supported by selectionStore)

- Plain LMB click → `select(ref, 'replace')`
- Shift+LMB → `select(ref, 'toggle')`
- Ctrl+LMB → reserved (Blender uses Ctrl for "extend" / range-select; we don't have outline ordering yet, defer)

## Hotkey alignment with Blender

- `A` — select all (toggle: if anything selected → deselect all; else → select all parts). Add a `selection.selectAllToggle` operator + `KeyA` keymap entry.
- `Alt+A` — deselect all (alternative path; `selection.clear` already exists on Esc).
- `Esc` — already deselects (`selection.clear` operator).

`A` is unbound in current keymap. Adding it is a small extra operator + keymap entry, not a separate plan.

## Outline rendering (already shipped)

[`scenePass.js`](../src/renderer/scenePass.js) already draws the per-part edge outline when `viewLayers.edgeOutline || isSelected` — selected parts always get the outline regardless of the toggle. So the moment we set `selection`, the outline appears. No additional renderer work for the outline.

## Tests

- **`test:hitTest`** — pure function unit tests. Build a fake project with 3 overlapping parts at known positions, assert click points hit the correct topmost part by drawOrder, edge cases (no hit, invisible parts excluded, group nodes excluded).
- **`test:CanvasViewport`** — extend live-preview-wiring tests to assert that pointerDown in object mode on a known-position canvas pixel ends up calling `setSelection` with the expected partId. (May need to mock `lastEvalCacheRef.current.frames` directly.)

## Anti-crutch checklist

- One source of truth for selection: `useSelectionStore.items` (universal) + `useEditorStore.selection` (legacy node-id array). Both updated atomically in the click handler.
- No "fallback ID list" or "approximate hit boxes" — real triangle hit-test or nothing.
- No bypassing edit modes — click-to-select is gated on `editMode === null`. In edit modes the existing brush / drag handlers own the click path.
- No new "isSelected" overlay component — the existing edge outline renders selection feedback. Don't duplicate.

## Estimated cost

1 day. Half a day for `hitTest.js` + tests, half for wiring into CanvasViewport + the `A` keymap entry + manual smoke testing.

## Sweep order (when scheduled)

1. `src/io/hitTest.js` + `test:hitTest`.
2. Wire into `CanvasViewport.handlePointerDown` (Object Mode branch).
3. Add `selection.selectAllToggle` operator + `KeyA` chord.
4. Update [V3_WORKSPACES.md](V3_WORKSPACES.md) with click-to-select section.
5. Memory entry for the contract.

## Out of scope (deferred)

- Box select / Lasso (Blender's `B` and `L`). Add as separate sweep after click works.
- Pixel-perfect alpha hit-testing. Triangle-bound for first-cut.
- Hit-test under clip masks. Triangle-bound; mask-respecting variant later.
- Tab cycling through overlapping selections (Blender's "alt-click cycles depth"). Defer.
