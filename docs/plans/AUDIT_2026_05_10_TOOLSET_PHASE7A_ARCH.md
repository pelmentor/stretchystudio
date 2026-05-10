# Phase 7.A Architecture Audit (2026-05-10)

Reviewed commit `cdd3c93` (master). Examined all 12 files listed in scope.
Traced undo paths, GPU sync, event propagation, and mode gating.

## Summary

4 gaps found: **2 HIGH, 1 MED, 1 LOW.**

| ID  | Sev  | One-line |
|-----|------|----------|
| G-1 | HIGH | All 8 `beginBatch()` calls in Phase 7.A pass no `project` argument — pushes `{project: undefined}` as the pre-gesture snapshot; Ctrl+Z silently no-ops for every multi-node snap/mirror/parent/setOrigin |
| G-2 | HIGH | `setOrigin` shifts vertex XY in-project but the GPU mesh-sync guard short-circuits on unchanged `meshSignature` (hashes count+triCount+uvHash, not positions) — WebGL VBO stays stale; part renders at old vertex positions |
| G-3 | MED  | Escape handler in `SnapMenu`, `ClearParentMenu`, `SetOriginMenu` calls `e.preventDefault()` but not `e.stopPropagation()` — the bubble-phase dispatcher then fires `selection.clear` after every menu-dismiss via Escape |
| G-4 | LOW  | `object.snap.menu` chord (`Shift+S`) has no `available()` guard and no mode scope — fires in Edit Mode, opening an Object Mode menu while editing vertices |

---

## HIGH

### G-1: `beginBatch()` called without `project` argument in all 8 Phase 7.A batch sites — undo is a silent no-op

**Files:**
- `src/v3/operators/object/snap.js:230, 262, 301, 333`
- `src/v3/operators/object/mirror.js:86`
- `src/v3/operators/object/parent.js:79, 149`
- `src/v3/operators/object/setOrigin.js:266`

**Severity:** HIGH — every Phase 7.A multi-node mutation is permanently non-undoable as shipped.

**Repro:** Select two objects → Shift+S → "Selection to Cursor" → Ctrl+Z → objects remain at cursor; original positions not restored.

**Root cause:** `undoHistory.js:76-82`:
```js
export function beginBatch(project) {
  if (_batchDepth === 0) {
    _redoStackBeforeBatch = _redoStack.slice();
    pushSnapshot(project);   // <-- project is undefined when called with no args
  }
  _batchDepth++;
}
```

`pushSnapshot(undefined)` pushes `{ project: undefined }` onto `_snapshots`. On Ctrl+Z, `app.undo` pops that entry and calls:
```js
updateProject((proj) => {
  Object.assign(proj, snapshot);  // Object.assign(target, undefined) = no-op per spec
}, { skipHistory: true });
```
The project is never restored.

Every other site in `registry.js` that batches follows the established pattern:
```js
const project = useProjectStore.getState().project;
beginBatch(project);
```

All eight Phase 7.A functions read `project` from the store immediately before
(e.g., `snap.js:228-229`) but do not pass it to `beginBatch`.

**Fix:** In each of the 8 affected functions, pass the already-captured
`project` to `beginBatch`:

```js
beginBatch(project);   // was: beginBatch()
```

**Why this matters:** Set Parent with keep-transform is a destructive
reparent; Mirror Selected flips all child rotations; all Selection-to-*
snaps move multiple nodes. None of these are undoable. This is the most
user-visible guarantee of the operator system and it is broken for the
entire 7.A surface.

---

### G-2: `setOrigin` mutates vertex positions but GPU mesh stays stale — visual result is wrong

**Files:**
- `src/v3/operators/object/setOrigin.js:227-249` (`applySetOrigin` — mutates `mesh.vertices` + bumps `vc.geometryVersion`)
- `src/io/meshSignature.js:101-109` (`meshSignature` — hashes `vertexCount`, `triCount`, `uvHash` only, not vertex XY)
- `src/components/canvas/CanvasViewport.jsx:475-481` (mesh-sync guard uses signature equality)
- `src/components/canvas/CanvasViewport.jsx:508` (effect dep array: `[project.nodes, project.textures, versionControl.textureVersion]`)

**Severity:** HIGH — the visual result of Set Origin is incorrect; the mesh
appears frozen at the pre-operation position.

**Repro:** Select a top-level meshed part → Set Origin → Origin to Geometry →
the gizmo jumps to mesh centroid, but the displayed vertices do not shift
(they are supposed to shift by the compensating local delta to keep the
visual appearance unchanged).

**Root cause:** The mesh-sync `useEffect` (CanvasViewport.jsx:422-508)
fires when `project.nodes` changes — which it does, because immer produces
a new array on every `updateProject`. Inside, for each part:
```js
const curSig = meshSignature(nodeMesh);
if (!hasMeshGpu || !signaturesEqual(curSig, lastSig)) {
  scene.parts.uploadMesh(node.id, nodeMesh);
```
`meshSignature` returns `{ vertexCount, triCount, uvHash }`. `setOrigin`
shifts every vertex XY by a local-space delta: vertex count is unchanged,
triangle count is unchanged, UVs are unchanged. Signature before and after
are identical → `signaturesEqual` returns `true` → `uploadMesh` is NOT
called → the GPU VBO retains the pre-operation vertex positions.

`applySetOrigin` correctly bumps `vc.geometryVersion++` at line 246, but
`geometryVersion` is not in the effect's dependency array (line 508), so
even if the intent was to drive an unconditional re-upload via
`geometryVersion`, the effect doesn't re-run on that change alone.

**Fix (Option A — surgical, matches existing `textureVersion` pattern):**

1. Add `versionControl.geometryVersion` to the mesh-sync effect's dep array.
2. Track the geometryVersion at last-upload time per part and bypass the
   signature guard when it has advanced.

The `geometryVersion` bump in `applySetOrigin` already exists and is the
correct signal; Option A makes CanvasViewport listen to it.

**Why this matters:** Set Origin is the operation the user reaches for
after manual mesh positioning. If the canvas doesn't reflect it, the user
will assume the operation failed or double-apply it, corrupting their data.

---

## MEDIUM

### G-3: Escape in SnapMenu, ClearParentMenu, SetOriginMenu bleeds through to `selection.clear`

**Files:**
- `src/v3/shell/SnapMenu.jsx:53-57` — Escape handler missing `stopPropagation`
- `src/v3/shell/ClearParentMenu.jsx:45-49` — same gap
- `src/v3/shell/SetOriginMenu.jsx:64-68` — same gap
- `src/v3/keymap/default.js:58` — `'Escape': 'selection.clear'`
- `src/v3/operators/dispatcher.js:69` — bubble-phase listener

**Severity:** MEDIUM — silently clears the user's selection on every
menu-dismiss via Escape, requiring re-selection before retry.

**Repro:** Select two objects → Shift+S → press Escape → menu closes AND
selection is cleared.

**Root cause:** All three menus register `onKey` in the capture phase
(`true` third arg). They fire before the bubble-phase dispatcher. They
call `e.preventDefault()` but not `e.stopPropagation()`. After the
capture handler returns, the event continues propagating to bubble phase.
The dispatcher resolves `'Escape'` → `'selection.clear'` →
`useSelectionStore.getState().clear()`.

`MirrorAxisMenu` is correctly immunized (line 54: `e.stopPropagation()`
is present). The other three menus have only `e.preventDefault()`.

**Fix:** Add `e.stopPropagation()` to the Escape branch in each of the
three affected menus.

**Why this matters:** Three out of four new popovers silently discard
the user's selection on every keyboard dismiss. The user must re-select
before retrying the snap/parent/setOrigin operation.

---

## LOW

### G-4 (DOCUMENT-AS-DEVIATION): `Shift+S` snap menu fires in Edit Mode — no mode gate

**File:** `src/v3/keymap/default.js:227`; `src/v3/operators/registry.js:1407-1413`

**Severity:** LOW — not data-corrupting (snap ops no-op with a vertex-only
selection), but incorrect muscle-memory for Blender users.

**Root cause:** `object.snap.menu` has no `available()` guard. The keymap
is mode-unaware. In Blender, `Shift+S` in Edit Mode opens `VIEW3D_MT_snap`
for vertex/edge/face snapping — a different operator entirely. SS serves
the Object Mode menu in all modes.

**Why not fixed now (DOCUMENT-AS-DEVIATION):** The correct fix is:
```js
available: () => useEditorStore.getState().editMode !== 'edit',
```
But blocking it without a vertex-snap replacement leaves `Shift+S` dead
in Edit Mode, which is worse UX. This gap should be closed when Phase 7.B
(mesh/vertex snap) ships, gating `object.snap.menu` to non-edit modes
and routing Edit Mode `Shift+S` to the vertex snap menu. No corrective
action now; note tracked.

---

## Verification cross-reference

| Prior lesson | Status in Phase 7.A |
|---|---|
| G-1 (async exec) | All 9 snap + mirror + setOrigin operators are synchronous. No new `async exec`. Clean. |
| G-2 (mode gate gaps) | Internal `eligibleSelection()` / type filters make ops data-safe in wrong modes. UX gap documented in G-4. |
| G-3 (worldMatrices per tick) | `setParent`'s `computeWorldMatrices` is called once before the loop — intentionally stale; correct for multi-child keep-transform compensation. |
| G-4/G-5 (chord bleed through popovers) | `MirrorAxisMenu` correctly immunized. Three others missing `stopPropagation` on Escape only (G-3 above). |
| G-6/G-7 (batch wrapping) | All multi-node ops use `beginBatch`/`endBatch` structure — correct. Missing `project` argument breaks the snapshot (G-1). |
| G-8 (helper dedup) | `mirror.js`, `parent.js`, `setOrigin.js` all import shared helpers from `snap.js`. No duplication. |
