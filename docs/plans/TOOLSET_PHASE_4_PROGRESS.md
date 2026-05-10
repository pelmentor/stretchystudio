# Toolset Phase 4 — Merge / Dissolve / Subdivide

Sister doc to `TOOLSET_BLENDER_PARITY_PLAN.md` §Phase 4.
Plan + sub-section index lives there; this is the running ship-status.

## Status: SHIPPED 2026-05-10 (commit `428bcdf`)

Three new mesh-edit topology operators wired through a generic
`TopologyOpResult` dispatcher. Manual browser-side gate (Phase 4.F)
still owed by user.

## What shipped

### Pure operator modules

- [src/v3/operators/edit/merge.js](../../src/v3/operators/edit/merge.js) —
  `mergeAtCenter`, `mergeAtCursor`, `mergeAtLast`, `mergeByDistance`,
  `mergeCollapse`. All return `TopologyOpResult` with
  `retriangulated:false` (preserve topology, only drop degenerate
  triangles). Union-find chains threshold pairs.
- [src/v3/operators/edit/dissolve.js](../../src/v3/operators/edit/dissolve.js) —
  `dissolveVertices` removes selected verts, refills holes via
  Meisters–Chazelle ear-clip (handles concave rings — mandatory for
  Live2D character art). `earClipTriangulate` exported pure for tests.
  Connected dissolved clusters skipped (v1 simplification). Boundary
  vert dissolve = open ring = no refill (hole left).
- [src/v3/operators/edit/subdivide.js](../../src/v3/operators/edit/subdivide.js) —
  `subdivide(mesh, sel, {cuts, smoothness})`. Triangle subdivides when
  ≥2 of its verts are selected. cuts > 1 iterates single-cuts, growing
  selection by midpoints whose both endpoints were selected.
  Smoothness pulls midpoints toward Loop-style averaged neighbour
  positions. vertexSources composed back to ORIGINAL mesh indices so
  blendShape data can be remapped on a multi-cut.

### Shared helpers

- [src/lib/meshTopology.js](../../src/lib/meshTopology.js) —
  `compactByGroups`, `remapTriangles`, `remapEdgeIndices`,
  `remapPerVertexArray` + `averageDeltas` / `averageNumbers`,
  `enumerateOneRingPolygon`, `pointInTriangleStrict` + `cross2`,
  `isDegenerateTri`, `removeDegenerateTriangles`,
  `identityVertexSources`, `identityVertexIndexRemap`, `dist2`,
  `edgeKey`, `remapUvs`.
- [src/lib/sceneRegistry.js](../../src/lib/sceneRegistry.js) —
  `setSceneRef` / `getSceneRef` — module-scope holder for the WebGL
  scene's `parts` so global keymap operators can re-upload mesh data
  without threading sceneRef through the dispatcher.
  CanvasViewport sets it on mount, clears on cleanup.

### Imperative dispatcher

- [src/v3/operators/edit/applyTopologyOp.js](../../src/v3/operators/edit/applyTopologyOp.js) —
  Single `updateProject` recipe = single undo entry. Rebuilds
  blendShape deltas + weightGroups + boneWeights via vertexSources
  averaging. Remaps editorStore vertex selection: survivors keep
  selection (via `vertexIndexRemap[oldIdx] = newIdx`), deleted verts
  drop (`null`), new midpoints with BOTH source endpoints pre-selected
  join the post-op selection (Blender's "subdivide keeps the active
  loop intact"). activeVertex cleared when its mapping doesn't
  survive. GPU re-upload via `getSceneRef().parts.uploadMesh(...)`.

### UI surface

- [src/v3/keymap/default.js](../../src/v3/keymap/default.js) — `KeyM` →
  `edit.mergeMenu`, `Ctrl+KeyX` / `Meta+KeyX` → `edit.dissolveVerts`.
  No hotkey for Subdivide (Blender uses right-click menu; SS exposes
  it via N-panel button until the context menu lands).
- [src/v3/operators/registry.js](../../src/v3/operators/registry.js) —
  7 new operators (the 5 merge variants + dissolveVerts + subdivide)
  with `topologyAvailable(min)` gates.
- [src/v3/shell/MergeMenu.jsx](../../src/v3/shell/MergeMenu.jsx) —
  5-button popover at cursor, mounted at AppShell when
  `editMenuStore.kind === 'merge'`. Outside-click + Esc closes.
- [src/v3/shell/AppShell.jsx](../../src/v3/shell/AppShell.jsx) —
  lazy-mounts MergeMenu.
- [src/v3/shell/ToolSettingsPanel.jsx](../../src/v3/shell/ToolSettingsPanel.jsx) —
  Edit-Mode TopologySection: Merge / Dissolve buttons, Cuts +
  Smoothness sliders, Subdivide button.
- [src/store/editMenuStore.js](../../src/store/editMenuStore.js) —
  popover state for merge menu (kind, cursor (client-px),
  canvasCursor (canvas-px target for atCursor)).
- [src/store/subdivideStore.js](../../src/store/subdivideStore.js) —
  sticky `cuts` (1..6) + `smoothness` (0..1) settings.
- [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) —
  registers/clears scene ref via `setSceneRef`.

## Tests

| Suite | Assertions |
|-------|------------|
| `test_merge_center` (atCenter / atCursor / atLast / collapse)         | 43 |
| `test_merge_byDistance` (threshold scan + chain + selection scope)    | 22 |
| `test_dissolve_verts_eartrip` (convex / concave / boundary / cluster) | 23 |
| `test_subdivide_one_cut` (4-tri replacement + UV / edge / smoothness) | 24 |
| `test_subdivide_n_cuts` (cut composition + selection growth + clamp)  | 44 |
| `test_topology_op_selection_remap` (full applyTopologyOp path)        | 19 |
| **Phase 4 total**                                                     | **175** |

All 6 sculpt suites + adjacent suites still green.

## Known v1 simplifications (deferred per Rule №1)

- **By Distance threshold input**: `window.prompt` for the threshold
  value. Blender's redo-panel pattern ("operator pops up modifier
  panel after run") is the proper UX; v1 ships the prompt because the
  redo-panel needs significant new infrastructure (snapshot pre-op
  state + revert-and-rerun on settings change).
- **Subdivide modifier modal**: same redo-panel deferral. v1 reads
  `subdivideStore.{cuts, smoothness}` at exec time; user adjusts in
  the N-panel, then presses Subdivide. Sticky settings between
  invocations match Blender's behaviour after the modal closes.
- **Connected dissolved clusters**: when two adjacent verts are both
  dissolved, the per-centre ear-clip declines because the ring
  contains another dissolved vert. Tris incident to those verts are
  dropped, no refill. Future enhancement: BFS-merge connected
  dissolved verts into a single combined ring before ear-clip.
- **Right-click context menu**: Blender's primary affordance for
  Subdivide. Phase 4 ships the operator + N-panel button; the
  context menu is queued for Phase 6 (Phase 5 = Extrude takes
  priority, queued).

## Manual gate (Phase 4.F)

User-side browser sweep, queued alongside Phase 0.H + 1.F + 2.G + 3.J:

- M-merge a stray vertex into its neighbour cluster → mesh cleans up,
  no broken triangles (At Center).
- M → At Cursor: select 3 verts, click anywhere on canvas → all 3
  collapse there.
- M → At Last: select 3 verts (active = last picked) → all 3 collapse
  to active vert's position.
- M → By Distance: prompt for 5px → near-duplicate verts merge.
- M → Collapse: select two disjoint pairs of adjacent verts → each
  pair merges to its own centroid (two final survivors).
- Ctrl+X dissolves selected vertices; one-ring refills via ear-clip.
- N-panel Subdivide: 1 cut → density doubles per selected triangle
  (3 selected verts in a tri → 4 sub-tris); 3 cuts → 64 sub-tris;
  smoothness 1.0 visibly pulls midpoints toward neighbour-averaged
  positions on multi-tri selections.
- One operator = one undo entry: drag, dissolve, Ctrl+Z → mesh
  restores to pre-op state in one step.
- BlendShape preservation: if the part has shape keys, run a merge or
  subdivide → shape key deltas track the new vertex layout (no
  visual jump on shape key value).
- Byte-fidelity sweep on Hiyori (or Shelby) with a topology-edited
  part: re-export cmo3, load in Cubism Viewer → still loads + still
  deforms.

## Audit-fix sweep — SHIPPED (commit `4347926`)

Two independent agents (architecture + Blender-fidelity) audited
`428bcdf` and surfaced 19 gaps total — **5 HIGH** (3 arch + 2 Blender),
**9 MED**, **5 LOW**. All HIGH addressed; MED/LOW either fixed or
DOCUMENTED-AS-DEVIATION per Rule №1.

### Architecture HIGH (audit doc: `AUDIT_2026_05_10_TOOLSET_PHASE4_ARCH.md`)

- **G-1** — `mesh.runtime` not cleared after topology op. `artMeshEval`
  read `runtime.keyforms[i].vertexPositions.length` as authoritative;
  stale `2 * N_old` length corrupted output buffers for every rigged
  part. Fix: `delete m.runtime` in the updateProject recipe.
- **G-2** — `subdivide.js:206` crashed with TypeError after save+load
  because `projectFile.js:214` leaves `edgeIndices` as plain Array.
  Fix: query the local Set built at line 203.
- **G-3** — Pre-fix `if (!hasMesh())` mesh-sync guard skipped re-upload
  after undo of a topology op (GPU still HAS a mesh). Fix: per-part
  `meshSignature` cache; re-upload on signature divergence. Catches
  first upload + topology op + undo + save+load. `sceneRegistry`
  extended with `_recordMeshUpload` so explicit upload seeds the cache
  and the sync doesn't double-upload.

### Blender-fidelity HIGH (audit doc: `AUDIT_2026_05_10_TOOLSET_PHASE4_BLENDER.md`)

- **D-1** — Pre-fix `cuts > 1` iterated single-cuts → `4^cuts` sub-tris
  per parent (16 at cuts=2, 64 at cuts=3). Blender's
  `bm_subdivide_multicut` does single-pass `(cuts+1)^2` (9 at cuts=2,
  16 at cuts=3). Rewrote as single-pass triangular grid: `cuts`
  midpoints per edge (cached for adjacent-parent sharing) + barycentric
  interior verts. Extended `TopologyOpResult` with `vertexWeights`
  parallel map + `remapPerVertexArray`/`averageDeltas`/`averageNumbers`
  to consume it, so blendShape/weightGroup data interpolates linearly
  along source verts (NOT snap to unweighted mean).
- **D-2** — Smoothness pull is Loop-style (neighbour avg); Blender
  uses normal-guided slerp which is a no-op on flat 2D meshes. SS
  keeps Loop-style as a deliberate deviation (visible 2D smoothness
  IS useful for character editing). DOCUMENT-AS-DEVIATION via
  module banner.

### MED

- **G-4** — Dissolve cluster comment was wrong ("will be re-fed");
  fixed comment + JSDoc, behaviour stays as v1 simplification.
- **G-5** — Smoothness pull was baking smoothed pose into restX/restY;
  fix: rest preserved (geometric midpoint), only pose-space x/y pulled.
- **G-6** — `enumerateOneRingPolygon` silently overwrote next[u] on
  non-manifold topology; fix: detect duplicate u, return null.
- **G-7** — MergeMenu exec/close comment was reversed; behaviour was
  correct, comment fixed.
- **G-8** — Dead imports of identityVertexSources/identityVertexIndexRemap
  removed.
- **D-3** — Added `mergeAtFirst` (Blender's MERGE_FIRST). 6-button
  menu now matches Blender's MESH_MT_merge order.
- **D-4** — JSDoc documents mergeAtLast active-vert-history requirement.
- **D-5** — JSDoc documents mergeByDistance taxonomy + missing
  `use_unselected` / `use_centroid=false` Blender features.
- **D-6** — JSDoc documents boundary dissolve leaves hole + missing
  `use_boundary_tear` / `use_face_split` features.

### LOW

- **D-7** — dissolve.js doc claim "constrained Delaunay" replaced with
  accurate "ear-clip with KD-tree" Blender source citation.
- **D-8** — keymap comment documents Blender's `Ctrl+X` =
  `MESH_OT_dissolve_mode` (context-sensitive); SS direct dispatch
  needs re-routing when edge/face select modes land.
- **D-9** — (no D-9 in this audit; gap numbering jumped per
  Blender-fidelity audit's internal numbering)
- **D-10** — Cluster doc consistent across module banner + inline +
  JSDoc.
- **G-9** — MergeMenu lazy-load null flash. DEFERRED (cosmetic).
- **G-10** — `window.prompt` for By Distance. DEFERRED (already
  documented as v1 simplification).

### Audit-fix regression-pin tests

`test_audit_fixes_2026_05_10_phase4.mjs` (18 assertions):
- D-1 cuts=2 → 9 sub-tris (NOT 16); cuts=2 vert count = 10
- D-1b vertexWeights set with [1-t, t] for edge midpoints
- D-2 module doc grep for "Loop-subdivision-style" + SS deviation
- D-3 mergeAtFirst behaves like mergeAtLast modulo target vert
- G-1 applyTopologyOp clears node.mesh.runtime
- G-2 subdivide tolerates plain-Array edgeIndices
- G-5 smoothness leaves restX/restY untouched
- G-6 enumerateOneRingPolygon returns null on non-manifold

## Tests post-audit-fix

| Suite | Assertions |
|-------|------------|
| `test_merge_center`                                                   | 43 |
| `test_merge_byDistance`                                               | 22 |
| `test_dissolve_verts_eartrip`                                         | 23 |
| `test_subdivide_one_cut`                                              | 24 |
| `test_subdivide_n_cuts` (rebased for Blender semantic)                | 35 |
| `test_topology_op_selection_remap`                                    | 19 |
| **`test_audit_fixes_2026_05_10_phase4` (NEW)**                        | **18** |
| **Phase 4 total post-audit-fix**                                      | **184** |

All 144 sister suites green; typecheck clean.
