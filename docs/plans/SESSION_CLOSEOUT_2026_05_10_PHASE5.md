# Session Close-out — 2026-05-10 (Phase 5 sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_10_PHASE4.md](./SESSION_CLOSEOUT_2026_05_10_PHASE4.md).
Earlier-day work: Animation Phase 0 (5/6 + armature port), Toolset
Phases 0/1/2/3/4, four audit-fix sweeps. This sub-session shipped
Toolset **Phase 5 + Phase 5 audit-fix sweep** (fifth audit sweep
of the day). Branch ahead of `origin/master` by 18 commits at
HEAD `6063b2c`.

## What shipped this sub-session (2 commits)

### Toolset Blender-Parity Plan — Phase 5 + audit-fix

`E`-key extrude on selected boundary verts:

| Commit  | What |
|---------|------|
| `ea590ac` | Phase 5 initial — `extrude.js` pure operator (boundary-vert duplication + bridging quads), `getBoundaryVerts` + `getBoundaryEdges` helpers in `meshTopology.js` (with degenerate-tri filter for Live2D seam tris), `selectionOverride` field added to `TopologyOpResult`, vertex-mode modal G via new `modalVertexTransformStore` + `ModalVertexTransformOverlay`, `discardBatch(applyFn)` API in `undoHistory` (snapshot pop + restore without redo-stack pollution), `excludeVertIndicesByPart` build option in `buildSnapHash` (so dragged dups don't auto-snap to source). 6 test suites, 116 assertions. |
| `6063b2c` | Phase 5 audit-fix sweep — 2 HIGH (G-1 modal writes restX/restY so the rig actually sees the drag; G-2 batch leak on applyTopologyOp failure path) + 8 MED + 5 LOW gaps closed. 2 new test suites pinning the fixes (44 new assertions). |

## Audit-fix sweep details (`6063b2c`)

Two independent agents (architecture + Blender-fidelity) audited
`ea590ac` and surfaced 23 gaps. All HIGH addressed; remaining MED/LOW
either fixed or DOCUMENT-AS-DEVIATION per Rule №1.

### Architecture HIGH

- **G-1** — `ModalVertexTransformOverlay.applyDelta` wrote only
  `mesh.vertices[i].x/y` per tick. `restX/restY` stayed at the source
  position post-extrude. After commit, the rig (chainEval / Pose Mode
  preview / animation playback / export / Object-Mode tab switch) read
  rest = source and snapped the dragged dups back on top of the
  originals — the entire user-visible drag was silently invisible to
  the rig. Fix: write BOTH pose AND rest each tick; matches
  `merge.js:99-102` and `add_vertex` (`CanvasViewport.jsx:2487`).
  `revertVerts` mirrors. The `original` Map's previously-dead
  `restX/restY` capture (sister G-10) becomes live data.
- **G-2** — `edit.extrude` exec called `applyTopologyOp` without
  checking the boolean return. On the defensive failure path (partId
  vanishes between `activeEditPart()` gate and `applyTopologyOp`),
  `beginBatch` would leave a dangling snapshot that surfaces as a
  stale undo entry on the next user undo. Fix: gate on the return +
  call `discardBatch(() => {})` to drop the snapshot cleanly. Same
  defensive close after the post-op `newMesh` check.

### Architecture MED

- **G-3 + G-4** — Overlay key handlers used `preventDefault()` only;
  Escape leaked to dispatcher's bubble-phase listener (firing
  `selection.clear`, silently losing object selection) and operator
  chords (E/G/R/S/B/M) leaked through and mounted nested modals on
  top of the active vertex modal. Fix: `e.stopPropagation()` on
  every key handler + catch-all preventDefault+stopPropagation for
  any chord not in the handled set. Sister `ModalTransformOverlay`
  has the same gap; flagged for the next polish pass.
- **G-5** — Per-tick `new Float32Array(uvs)` allocation for
  `uploadPositions` was burning ~1.4 MB/sec GC pressure during
  smooth drags (Hiyori-class 3000-vert parts at 60 Hz). Fix: cache
  the Float32Array at modal entry via `uvsArrRef`. UVs are
  immutable during a vertex translate.
- **G-6** — `axis` was a useEffect dep, so every X/Y axis-toggle
  press tore down the listeners + rebuilt the snap hash (~30 ms jank
  on Hiyori). Fix: read `axis` from store inside `applyDelta` and
  the X/Y handlers; drop `axis` from deps. Effect now runs once per
  modal session.
- **G-7** — Mid-commit mousemove race: queued mousemoves between
  `commit()` and React's cleanup write verts via stale closure
  `original`/`vertIndices` references. Fix: early-return in
  `applyDelta` if store kind is null.
- **G-8** — `discardBatch` only restored `_redoStackBeforeBatch`
  inside the `_snapshots.length > 0` branch; `clearHistory()` mid-
  batch (project load while modal active) leaves snapshots empty
  but `_redoStackBeforeBatch` set, so the backup persisted past
  depth 0 and would re-emerge on the next discardBatch. Fix:
  restore + null backup unconditionally on depth → 0.
- **G-9** — `excludeVertIndicesByPart` snap-hash filter (Phase 5
  addition) had zero direct test coverage. Fix:
  `test_snap_excludeVertIndices.mjs` (18 assertions) covering 8
  scenarios: no exclusion / single / multi / cross-part isolation /
  empty Map / empty Set / coexistence with `excludePartId` /
  unknown-part defensive.

### Blender-fidelity HIGH (DOCUMENT-AS-DEVIATION)

- **D-1** — Esc-cancel rolls back the entire extrude (topology +
  drag). Blender's `MESH_OT_extrude_region_move` is a macro
  (`wm_operator_type.cc:308-328` `wm_macro_end`); macro CANCELLED →
  FINISHED conversion keeps the extrude on Esc-mid-translate, leaving
  a "doubled-vert" state recoverable via M-menu. SS deliberately
  diverges so the gesture is atomic ("one Esc = abort the whole
  thing"). Documented in `modalVertexTransformStore.js` +
  `ModalVertexTransformOverlay.jsx` banners. Blender users need to be
  aware that SS Esc is more aggressive.
- **D-2** — Interior-vert selection toasts and bails. Blender's
  `edbm_extrude_mesh:373-378` dispatches to `extrude_verts_indiv`
  (creates a wire-edge to a duplicate). Live2D meshes are
  triangle-only so wire-edges are unusable downstream — this is a
  Live2D data-model limitation, NOT an SS bug. Toast title rewritten
  to "Interior-vert extrude not supported"; description mentions the
  Blender operator. Phase 6+ may add `extrude.vertsIndiv` once a mesh
  model supporting wire-edges lands.

### Blender-fidelity MED

- **D-3** — Mid-modal R/S switch missing — DOCUMENTED with
  `editors/transform/transform.cc:693-742` cite.
- **D-4** — Multi-vert non-contiguous selection routes through
  region path (zero quad bridges) instead of Blender's verts_indiv
  dispatch — DOCUMENTED.
- **D-5** — Alt+E variants menu — DEFERRED (no variant operators to
  surface yet; sister to D-2).
- **D-6** — RMB-cancel matches Blender's modern LMB-select preset —
  DOCUMENTED (Phase 7+ industry-compatible mode would need
  preset-aware bindings).
- **D-7** — Degenerate-tri area filter is SS extension over Blender's
  `BM_edge_is_boundary` (`bmesh/intern/bmesh_query_inline.hh:111-115`
  — topology-only). Documented as Live2D-domain adaptation.

### LOW

- **G-10** — Dead `restX/restY` data in `original` Map → lifted to
  live by G-1 fix.
- **G-11** — Hardcoded `cellSize: 64` clips threshold > 64; sister
  `ModalTransformOverlay` same — DOCUMENTED.
- **G-12** — Typedef comment fixed (cited correct SURVIVOR pass).
- **G-13** — `mesh.uvs === undefined` defensive — DEFERRED (gated by
  registry today).
- **D-8** — Active vert post-extrude prefers the duplicate of the
  prior active vert when the dispatcher can identify it (small fix
  in `applyTopologyOp.overrideSelectionForPart`). Falls back to
  insertion-order Set iteration (same compromise as `mergeAtFirst`
  per Phase 4 D-3) when the prior active wasn't on the operating
  part. Closer to Blender's `BMO_mesh_selected_remap`
  (`bmesh/intern/bmesh_operators.cc:582-624`).
- **D-9** — Source citations corrected throughout: pre-fix cited
  `editmesh_extrude.cc:507-585` (which is `edbm_split_exec` —
  unrelated). New cites: `:430-456` (`edbm_extrude_region_exec`),
  `:358-427` (`edbm_extrude_mesh` dispatch), `bmo_extrude.cc:319+`
  (BMOP). Fixed in `extrude.js`, `keymap/default.js`, audit doc
  references the bad cite as historical context only.
- **D-10** — Quad-emission winding doc references Blender's
  `bmo_extrude.cc:517-541` `edge_normal_flip` semantics + documents
  why SS skips them (Live2D 2D mesh, no per-face normals).

## Audit docs on disk

- [AUDIT_2026_05_10_TOOLSET_PHASE5_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE5_ARCH.md) — 13 gaps (2 HIGH, 7 MED, 4 LOW)
- [AUDIT_2026_05_10_TOOLSET_PHASE5_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE5_BLENDER.md) — 10 gaps (2 HIGH, 5 MED, 3 LOW)

## Test scoreboard

All 8 Phase 5 suites green; all adjacent suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_getBoundaryVerts`                                              | 20  |
| `test_extrude_singleVert`                                            | 17  |
| `test_extrude_boundaryRing`                                          | 22  |
| `test_extrude_partialBoundary`                                       | 15  |
| `test_extrude_modalCommit`                                           | 18  |
| `test_extrude_modalCancel`                                           | 24  |
| **`test_snap_excludeVertIndices` (G-9 NEW)**                         | **18** |
| **`test_audit_fixes_2026_05_10_phase5` (NEW — pins 2 HIGH + 8 MED/LOW)** | **26** |
| **Phase 5 total post-audit-fix**                                     | **160** |
| undoHistory (regression-checked after discardBatch additions)        | 22  |
| topology_op_selection_remap (sister)                                 | 19  |
| audit_fixes_2026_05_10_phase4                                        | 18  |
| snap_vertex_threshold                                                | 23  |
| snap_gesture_model                                                   | 18  |
| editorStore                                                          | 87  |
| vertexSelection_basic                                                | 28  |

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged from previous close-outs. The depgraph is coherent
post-audit-fix #1; the Phase 0.D flag flip is gated only on the
user-side manual byte-fidelity sweep on Shelby + test_image4 PSDs.

1. Toggle `preferencesStore.evalEngine = 'depgraph'` in app.
2. Load `shelby_neutral_ok.psd` + `test_image4.psd`.
3. Verify visually + export `.cmo3` and byte-diff against `'classic'`
   baseline.
4. Flip [preferencesStore.js:163](../../src/store/preferencesStore.js#L163)
   default `'classic'` → `'depgraph'`. Keep classic opt-out one
   release.

### B. Toolset Phase 2.G + 3.J + 4.J + 5.E manual gates (user-blocking)

Phases 2 + 3 + 4 + 5 are fully shipped + audit-fixed. Browser-side smoke
tests remain.

**Phase 5.E highlights** (full checklist in
[TOOLSET_PHASE_5_PROGRESS.md](./TOOLSET_PHASE_5_PROGRESS.md)
§"Manual gate"):

- N-panel "Vertex Groups" / "Topology" / etc. — Phase 5 doesn't add a
  new section; extrude is `KeyE` only.
- Select Hiyori's hair tip vert in Edit Mode. Press E.
- New vert appears at same position; modal G HUD shows "vert translate".
- Drag mouse → new vert translates. Source vert stays put.
- LMB-click → commits. Ctrl+Z → restores pre-extrude state (one step).
- Re-extrude. Drag. Press Esc → topology + drag both vanish; redo
  stack NOT polluted (pre-extrude redo entries survive).
- Re-extrude two adjacent boundary verts. Drag → both move together
  with two new bridge triangles.
- After commit, exit Edit Mode → tracker / chainEval reflects the new
  extrudded geometry at the dragged position (G-1 fix).
- Snap-to-vertex: with snap on, drag the new ring near another vert
  on the SAME mesh → snap target appears + the dragged ring lands
  on it (own-source verts excluded from snap via G-9 path).
- Pressing G/R/S/E/M/B during the modal does NOT open competing
  modals (G-3/G-4 stopPropagation).
- BYTE-FIDELITY: re-export cmo3 with extrude-edited part → loads in
  Cubism Viewer.

### C. Toolset Phase 6 — Select Linked / Duplicate / Apply menu / Circle (~1 week)

Next autonomous chunk per plan. Cluster of small wins:

- `L` / `Ctrl+L`: Select Linked (flood-fill via existing
  `buildVertexAdjacency`).
- `Shift+D`: Duplicate (Object Mode + Edit Mode).
- `Ctrl+A`: Apply menu (existing operators registered with proper
  IDs).
- `C`: Circle Select (cursor circle, LMB paint, wheel radius).

See [TOOLSET_BLENDER_PARITY_PLAN.md §Phase 6](./TOOLSET_BLENDER_PARITY_PLAN.md).

### D. Manual browser gates 0.H + 1.F + 2.G + 3.J + 4.J + 5.E (still pending user)

Six manual gates queued. Should be verified before further phases ship.

## Hotkey reservations across both plans

Phase 5 added `KeyE` (Extrude). No new collisions.

- `I` = Insert Keyframe (animation Phase 6)
- `B` = Box Select (toolset Phase 1) ✅ shipped
- `C` = Circle Select (toolset Phase 6)
- `M` = Merge menu (toolset Phase 4) ✅ shipped
- `Ctrl+X` = Dissolve Vertices (toolset Phase 4) ✅ shipped (Blender
  binds this to context-sensitive `MESH_OT_dissolve_mode`; SS direct
  dispatch will need re-routing in Phase 6+)
- `E` = Extrude (toolset Phase 5) ✅ shipped (Blender binds Alt+E
  to a variants menu; SS doesn't yet because no variant ops to
  populate it)
- `L` / `Ctrl+L` = Select Linked (toolset Phase 6)
- `Shift+D` = Duplicate (toolset Phase 6)
- `Ctrl+A` = Apply menu (toolset Phase 6)
- `Shift+X` = Sample Weight (toolset Phase 7.B)
- `Ctrl+Shift+M` = Pose select-mirror (Blender-faithful)
- `Ctrl+Shift+V` = Mirror Pose (paste-flipped, Blender-faithful)
- `Ctrl+N` NOT bound (collides with Blender File New)
- `Alt+Shift+G/R/S` = Clear All Pose per-axis (3 separate chords,
  Blender-faithful)
- ⚠️ `Shift+S` reserved for Phase 7.A toolbox — collides with
  Blender's `VIEW3D_MT_snap_pie`; revisit binding before Phase 7
  ships

## Day-end commit chain (21 commits across five sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| 1     | `ec5d7d3` | anim 0.A — gridLift / depgraph build-relation fix |
| 2     | `ad7f26a` | anim 0.B — driver pass wired into CanvasViewport tick |
| 3     | `0386a6a` | anim 0.C — TRANSFORM_COMPOSE op |
| 4     | `c8f86f3` | anim 0.D.0 — depgraph wired into CanvasViewport rAF |
| 5     | `bc8a875` | anim 0.D armature port — bone post-chain inside ART_MESH_EVAL |
| 6     | `10ecaa8` | docs(plan) — Phase 0 close-out |
| 7     | `4a59d62` | toolset Phase 0 — vertex selection model in Edit Mode |
| 8     | `f7fba11` | toolset Phase 1 — box / lasso select |
| 9     | `ee2b1c5` | audit-fix sweep #1 — 6 HIGH + 2 MED + doc-drift |
| 10    | `6a8b5d3` | session close-out (mid-day) |
| 11    | `5b81205` | toolset Phase 2 — snap during transform (initial) |
| 12    | `980da3e` | audit-fix sweep #2 — Phase 2 dual audit (5 HIGH + 4 MED) |
| 13    | `9c3a906` | docs(plan) — Phase 2 sub-session close-out |
| 14    | `fa17a46` | toolset Phase 3 — Sculpt Mode + 3 brushes |
| 15    | `22a128b` | audit-fix sweep #3 — Phase 3 dual audit (7 HIGH + 12 MED/LOW) |
| 16    | `fa95979` | docs(plan) — Phase 3 sub-session close-out |
| 17    | `438f58e` | sister fix — matchTag local import after armatureMeta split |
| 18    | `428bcdf` | toolset Phase 4 — Merge / Dissolve / Subdivide |
| 19    | `4347926` | audit-fix sweep #4 — Phase 4 dual audit (5 HIGH + 9 MED + 5 LOW) |
| 20    | `b0596ac` | docs(plan) — Phase 4 sub-session close-out |
| 21    | `ea590ac` | toolset Phase 5 — Extrude operator + vertex-mode modal G |
| 22    | `6063b2c` | audit-fix sweep #5 — Phase 5 dual audit (2 HIGH + 8 MED/LOW) |
