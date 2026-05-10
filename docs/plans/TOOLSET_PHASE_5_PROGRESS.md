# Toolset Plan — Phase 5 Progress (Extrude)

- Initial Phase 5 commit: `ea590ac`
- Audit-fix sweep: `6063b2c`

Status: BASE + AUDIT-FIX SHIPPED. Manual gate (Phase 5.E) is browser-side.

## What landed

Per [TOOLSET_BLENDER_PARITY_PLAN.md §Phase 5](./TOOLSET_BLENDER_PARITY_PLAN.md):

### 5.A — Boundary detection (`src/lib/meshTopology.js`)

- `getBoundaryVerts(mesh, opts={epsArea})` → `Set<vertIdx>` — verts incident on any boundary edge.
- `getBoundaryEdges(mesh, opts={epsArea})` → `Array<[u, v]>` — edges used by exactly one non-degenerate triangle.
- Degenerate-tri filter: tris with area < `epsArea` (default `1e-9`) are skipped before counting. Critical for Live2D meshes which often include zero-area UV / clip-mask seam separators whose collinear edges would otherwise misclassify as boundary.

### 5.B — Extrude operator (`src/v3/operators/edit/extrude.js`)

- `extrude(mesh, selection)` → `TopologyOpResult | null`
- Algorithm:
  1. `selectedBoundary = selection ∩ getBoundaryVerts(mesh)`
  2. If empty → return null (caller toasts).
  3. Duplicate every selected boundary vert (positions copy, vertexSources length-1).
  4. For each boundary edge with BOTH endpoints in selectedBoundary: emit quad bridge `(u, v, v', u')` = two triangles.
  5. Return TopologyOpResult with `selectionOverride = {new vert indices}`.
- New `selectionOverride: Set<number>` field on `TopologyOpResult` typedef. When set, the dispatcher replaces editor selection wholesale (Blender's E pattern: source ring deselected post-extrude).
- Helper: `countSelectedBoundary(mesh, selection)` — count without computing the full result, used to surface "Cannot extrude" toast cleanly.

### 5.B — Vertex-mode modal G

- `src/store/modalVertexTransformStore.js` — sister to `modalTransformStore`. Tracks per-vertex `original: Map<vertIdx, {x, y, restX, restY}>` for one part. Translate-only in v1 (Blender's E + R/S mid-modal-switch deferred to Phase 6+).
- `src/v3/shell/ModalVertexTransformOverlay.jsx` — captures mouse + key while modal active. Per-tick:
  - Compute (dx, dy) from mouse delta.
  - Apply snap (vertex / grid) with `excludeVertIndicesByPart` so dragged duplicates don't auto-snap to themselves at t=0.
  - Write to `mesh.vertices[i].x/y` via `updateProject({skipHistory:true})`.
  - GPU-sync via `scene.parts.uploadPositions(partId, verts, uvs)`.
- Modal commit: `endBatch()` → ONE undo entry covering both the topology change AND the drag.
- Modal cancel: `discardBatch(applyFn)` pops the batch snapshot AND restores pre-batch state in one swoop. NO redo-stack pollution (cancel ≠ "I want to redo this later").

### 5.B — `discardBatch` API on `undoHistory.js`

- `discardBatch(applyFn)` — pops the batch snapshot pushed by `beginBatch`, calls `applyFn(snapshot)` to restore project state. Decrements `_batchDepth`.
- Side-effect: `beginBatch` now side-saves the redo stack (`_redoStackBeforeBatch`); `discardBatch` restores it. Without this restore, a cancelled batch would have invalidated the user's redo history (because `pushSnapshot`'s edit-clears-redo behaviour fired at `beginBatch` time).
- Nested batches: only the OUTERMOST `discardBatch` (depth 1) actually pops + restores; nested cancels just decrement (the outer caller decides the final outcome).

### 5.C — Edge cases handled

- No selected boundary verts → toast "Extrude needs selected boundary verts" + bail.
- Closed boundary loop fully selected → entire ring extrudes.
- Open boundary path → quads only along contiguous segments.
- Single boundary vert → just duplicate, no quad bridges.
- Interior-only selection → toast (interior-vert "extrude individual" is Phase 6+).

### 5.D — Tests (8 suites, 160 assertions post-audit-fix)

| Test | Assertions |
|------|------------|
| `test_getBoundaryVerts.mjs`                         | 20  |
| `test_extrude_singleVert.mjs`                       | 17  |
| `test_extrude_boundaryRing.mjs`                     | 22  |
| `test_extrude_partialBoundary.mjs`                  | 15  |
| `test_extrude_modalCommit.mjs`                      | 18  |
| `test_extrude_modalCancel.mjs`                      | 24  |
| **`test_snap_excludeVertIndices.mjs` (G-9 fix)**    | **18** |
| **`test_audit_fixes_2026_05_10_phase5.mjs`**        | **26** |
| **Phase 5 total post-audit-fix**                    | **160** |

Sister suites verified green: `undoHistory` (22), `v3Operators` (67), `editorStore` (87), `meshSignature` (29), `modalTransformTyped` (11), `topologyOpSelectionRemap` (19), Phase 4 audit-fix (18), `snapVertexThreshold` (23), `snapGestureModel` (18), `vertexSelectionBasic` (28), all Phase 4 topology suites (184). Typecheck clean.

### 5.D.audit — Audit-fix sweep (commit `6063b2c`)

Two independent agents (architecture + Blender-fidelity) audited
`ea590ac`. 23 gaps total; all HIGH addressed, MED/LOW either fixed
or DOCUMENTED-AS-DEVIATION.

**Architecture HIGH (FIX):**

- **G-1**: Modal vertex translate writes BOTH `x/y` AND `restX/restY`
  per tick. Pre-fix the rig saw drag dups at source position
  (chainEval reads rest); whole extrude was silently invisible.
- **G-2**: `edit.extrude` exec gates on `applyTopologyOp` boolean
  return; on failure path calls `discardBatch(() => {})` to drop
  the dangling batch snapshot.

**Architecture MED (FIX):**

- **G-3 + G-4**: Overlay key handlers `stopPropagation()` on every
  key + catch-all swallow. Pre-fix Esc leaked to `selection.clear`
  and operator chords mounted nested modals.
- **G-5**: UVs Float32Array cached at modal entry (`uvsArrRef`);
  pre-fix 1.4 MB/sec GC pressure during drags.
- **G-6**: `axis` removed from useEffect deps; reads from store
  inside `applyDelta` + X/Y handlers. Pre-fix every axis toggle
  triggered ~30 ms snap-hash rebuild.
- **G-7**: Early-return guard in `applyDelta` against stale-state
  closure writes during the 1-frame gap between commit/cancel and
  React cleanup.
- **G-8**: `discardBatch` clears `_redoStackBeforeBatch`
  unconditionally on depth → 0; closes leak on
  `clearHistory()`-mid-batch path.
- **G-9**: 18-assertion test covering the new
  `excludeVertIndicesByPart` snap-hash filter.

**Blender-fidelity HIGH (DOCUMENT-AS-DEVIATION per Rule №1):**

- **D-1**: Esc-cancel rolls back the whole extrude (topology + drag).
  Blender's `wm_macro_end` keeps the extrude on Esc-mid-translate.
  SS atomic gesture is deliberate UX deviation.
- **D-2**: Toast wording rewritten to make the Live2D-data-model
  limitation (no wire-edges → no `extrude_verts_indiv`) explicit.

**Blender-fidelity MED:**

- **D-3 / D-4 / D-6 / D-7**: Documented in module banners with
  Blender source cites.
- **D-5**: Alt+E variants menu deferred (no variant operators to
  surface yet).

**LOW:**

- **G-12**: Typedef comment fixed (cited correct selection pass).
- **D-8**: Active vert post-extrude prefers prior active's dup
  (small fix in `overrideSelectionForPart`).
- **D-9**: Source citations corrected throughout
  (`editmesh_extrude.cc:430-456` + `:358-427` + `bmo_extrude.cc:319+`).
- **D-10**: Quad-emission winding doc references Blender's
  `bmo_extrude.cc:517-541` `edge_normal_flip`.

**Deferred per Rule №1:**

- **G-11**: Hardcoded `cellSize: 64` clips threshold > 64 — sister
  `ModalTransformOverlay` has the same gap. DOCUMENTED.
- **G-13**: `mesh.uvs === undefined` defensive — gated by registry,
  unreachable today.
- **D-5**: Alt+E variants menu — no variant ops to populate yet.

Audit docs on disk:
- [AUDIT_2026_05_10_TOOLSET_PHASE5_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE5_ARCH.md) (13 gaps, 2 HIGH FIXED)
- [AUDIT_2026_05_10_TOOLSET_PHASE5_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE5_BLENDER.md) (10 gaps, 2 HIGH DOC-AS-DEVIATION)

## Manual gate (Phase 5.E) — browser-side

- Select Hiyori's hair tip vert in Edit Mode. Press E.
- New vert appears at same position; modal G HUD shows "vert translate".
- Drag mouse → new vert translates. Source vert stays put.
- LMB-click → commits. Ctrl+Z → restores pre-extrude state (one step).
- Re-extrude. Drag. Press Esc → topology + drag both vanish.
- Re-extrude two adjacent boundary verts. Drag → both move together as a strip with two new bridge triangles.
- Snap-to-vertex: with snap on, drag the new ring near another vert on the SAME mesh → snap target appears + the dragged ring lands on it (own-source verts are excluded from snap).
- Byte-fidelity: re-export `.cmo3` after extrude+commit → loads in Cubism Viewer.

## Hotkey

- `KeyE` — extrude (Blender chord parity).
- `KeyE` is NEW in this phase; not previously bound.
- No collision with existing chords.

## Open follow-ons (deferred per Rule №1 / spec)

- `MESH_OT_extrude_verts_indiv` (interior-vert extrude) — Phase 6+ as separate operator.
- Mid-modal R/S switch (extrude region followed by mid-stroke rotate or scale) — Phase 6+ needs proper per-edit-mode pivot model.
- Alt+E pop-up menu (Blender's extrude variants menu) — Phase 6+.
- N-panel "Extrude" button — direct-bind to `KeyE` plus N-panel button is a future polish.
