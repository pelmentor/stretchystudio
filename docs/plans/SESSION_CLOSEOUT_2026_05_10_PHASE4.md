# Session Close-out — 2026-05-10 (Phase 4 sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_10_PHASE3.md](./SESSION_CLOSEOUT_2026_05_10_PHASE3.md).
Earlier-day work: Animation Phase 0 (5/6 + armature port), Toolset
Phases 0/1/2/3, three audit-fix sweeps. This sub-session shipped
Toolset **Phase 4 + Phase 4 audit-fix sweep** (fourth audit sweep
of the day). Branch ahead of `origin/master` by 15 commits at
HEAD `4347926`.

## What shipped this sub-session (3 commits)

### Toolset Blender-Parity Plan — Phase 4 + audit-fix

Merge / Dissolve / Subdivide topology operators:

| Commit  | What |
|---------|------|
| `438f58e` | Sister fix — `matchTag` re-export bug in `armatureOrganizer.js` introduced by `7e264a9` ("perf(loading): split armatureMeta") was crashing `npm test`; bare `export {} from` re-exports don't add bindings to local scope. Trivial 2-line import added. |
| `428bcdf` | Phase 4 initial — `src/lib/meshTopology.js` shared helpers, `src/lib/sceneRegistry.js` for keymap-operator scene access, three pure operator modules (`v3/operators/edit/{merge,dissolve,subdivide}.js`), `applyTopologyOp.js` dispatcher (rebuilds blendShape deltas + weightGroups + boneWeights via vertexSources averaging, remaps editor selection via vertexIndexRemap, GPU upload via sceneRegistry, single undo entry), `editMenuStore` + `subdivideStore`, `MergeMenu.jsx` popover, N-panel `TopologySection`, 7 operators registered, hotkeys M / Ctrl+X. 6 test suites, 175 assertions. |
| `4347926` | Phase 4 audit-fix sweep — 5 HIGH (3 arch + 2 Blender) + 9 MED + 5 LOW gaps closed. Headline fixes: G-3 sig-tracked GPU re-upload (closed undo-coherence hole), D-1 single-pass `(cuts+1)^2` Subdivide (Blender-faithful, was iterative `4^cuts`), G-1 `mesh.runtime` cleared on topology op (closed chainEval-on-rigged-part bug). 184 total assertions across 7 suites. |

## Audit-fix sweep details (`4347926`)

Two independent agents (architecture + Blender-fidelity) audited
`428bcdf` and surfaced 19 gaps. All 5 HIGH addressed; remaining MEDs
either fixed or DOCUMENTED-AS-DEVIATION per Rule №1.

### Architecture HIGH

- **G-1** — `applyTopologyOp` didn't clear `mesh.runtime` after
  topology op. `artMeshEval` reads `runtime.keyforms[i].vertexPositions.length`
  as authoritative `len`; the stale `2 * N_old` length corrupted
  output buffers for every rigged part on every rAF tick. Fix:
  `delete m.runtime` in the updateProject recipe; matches existing
  pattern at [ArmatureModifierService.js:155](../../src/services/ArmatureModifierService.js#L155).
- **G-2** — `subdivide.js:206` crashed with `TypeError: mesh.edgeIndices.has
  is not a function` after save+load — `projectFile.js:214` intentionally
  leaves `edgeIndices` as a plain Array. Fix: query the local Set built
  at line 203 (which already coerces `mesh.edgeIndices ?? []`).
- **G-3** — `if (!hasMesh())` mesh-sync guard skipped re-upload after
  undo of a topology op. Fix: per-part `meshSignature` cache; the sync
  useEffect re-uploads on signature divergence (catches first upload,
  topology op, undo of topology op, save+load round-trip). `sceneRegistry`
  extended with `_recordMeshUpload(partId, sig)` so `applyTopologyOp`'s
  explicit upload seeds the cache and the sync useEffect doesn't
  double-upload.

### Blender-fidelity HIGH

- **D-1** — Pre-fix Subdivide ran `singleCut` `cuts` times → `4^cuts`
  sub-tris per parent. Blender's `MESH_OT_subdivide` /
  `bm_subdivide_multicut` (`bmesh/operators/bmo_subdivide.cc:440-468`)
  inserts `cuts` midpoints per edge in a SINGLE pass → `(cuts+1)^2`
  sub-tris per parent. cuts=2 → 9 (was 16); cuts=3 → 16 (was 64).
  Rewritten as single-pass triangular grid: `cuts` edge midpoints
  cached by canonical edge key (adjacent parents share) + barycentric
  interior verts. Extended `TopologyOpResult` with `vertexWeights`
  parallel map so per-vertex blendShape / weightGroup data
  interpolates linearly along source verts (NOT snap to unweighted
  mean).
- **D-2** — Smoothness pull is **Loop-subdivision-style**
  (neighbour-averaged), NOT Catmull-Clark as the prior doc claimed.
  Blender's `alter_co` (`bmo_subdivide.cc:237-368`) uses normal-guided
  sphere-dual-blend slerp; on flat 2D meshes (every normal `(0,0,1)`)
  Blender's slerp collapses to the linear midpoint, so smoothness>0
  has NO visible effect in Blender for our domain. SS keeps Loop-style
  as a deliberate deviation (visible 2D smoothness IS useful for
  character editing) — DOCUMENT-AS-DEVIATION via module banner.

### MED / LOW

- **G-4** — Dissolve adjacent-cluster comment was wrong ("will be
  re-fed when we process their centre"); fixed comment + JSDoc.
  Behaviour stays as v1 simplification (Phase 6+ to BFS-merge clusters).
- **G-5** — Smoothness pull was baking smoothed pose into `restX`/
  `restY`; fix: rest preserved (geometric midpoint), only pose-space
  `x`/`y` is pulled.
- **G-6** — `enumerateOneRingPolygon` silently overwrote `next[u]` on
  non-manifold "butterfly" topology; fix: detect duplicate u, return
  null (caller treats as "no refill possible"; incident triangles are
  still removed).
- **G-7** — `MergeMenu.run()` exec/close comment was reversed;
  behaviour was correct (atCursor relies on close-after-exec), only
  the comment was misleading; fixed comment.
- **G-8** — Removed dead imports of `identityVertexSources` /
  `identityVertexIndexRemap` (subdivide.js rewrite naturally dropped
  them).
- **D-3** — Added `mergeAtFirst` (Blender's `MERGE_FIRST` "At First").
  Operator + MergeMenu entry + 6-button menu order matches Blender's
  `MESH_MT_merge`. SS uses Set iteration order as proxy for
  selection-history (insertion-order; matches click-history for
  click-built selections, geometry-scan for box/lasso); deviation
  documented.
- **D-4** — Documented `mergeAtLast` requires
  `editorStore.activeVertex` (selection-history-last) in JSDoc.
- **D-5** — Documented `mergeByDistance` taxonomy + missing
  `use_unselected` / `use_centroid=false` Blender features as v1
  simplifications.
- **D-6** — Documented boundary dissolve leaves hole + missing
  `use_boundary_tear` / `use_face_split` Blender features as v1
  simplifications.
- **D-7** — `dissolve.js` module doc no longer claims "constrained
  Delaunay" — Blender's `BLI_polyfill_calc_arena` self-documents as
  "An ear clipping algorithm" with KD-tree
  (`blenlib/intern/polyfill_2d.cc:1-33`).
- **D-8** — Keymap doc references Blender's `Ctrl+X` =
  `MESH_OT_dissolve_mode` (context-sensitive dispatcher); SS direct
  dispatch needs re-routing when edge/face select modes land.
- **D-10** — Cluster dissolve doc consistent across module banner +
  inline comment + JSDoc.

### Deliberately deferred (LOW, per Rule №1)

- **G-9** — MergeMenu lazy-load null flash on first open. Cosmetic
  (~50ms latency on cold cache); not worth the placeholder spinner.
- **G-10** — `window.prompt` for By Distance threshold. Already
  documented as v1 simplification; the proper redo-panel pattern
  needs significant new infrastructure (snapshot pre-op state +
  revert-and-rerun on settings change).

## Audit docs on disk

- [AUDIT_2026_05_10_TOOLSET_PHASE4_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE4_ARCH.md) — 10 gaps, 3 HIGH addressed
- [AUDIT_2026_05_10_TOOLSET_PHASE4_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE4_BLENDER.md) — 9 gaps, 2 HIGH addressed

## Test scoreboard

All 7 Phase 4 suites green; all adjacent suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_merge_center`                                                  | 43 |
| `test_merge_byDistance`                                              | 22 |
| `test_dissolve_verts_eartrip`                                        | 23 |
| `test_subdivide_one_cut`                                             | 24 |
| `test_subdivide_n_cuts` (rebased for Blender (cuts+1)^2 semantic)    | 35 |
| `test_topology_op_selection_remap`                                   | 19 |
| **`test_audit_fixes_2026_05_10_phase4` (NEW — pins 5 HIGH + 3 MED)** | **18** |
| **Phase 4 total post-audit-fix**                                     | **184** |
| editorStore                                                          | 87 |
| canvasToolbar                                                        | 104 |
| modeCompat                                                           | 78 |
| proportionalEdit                                                     | 52 |
| audit_fixes_2026_05_10                                               | 23 |
| modalTransformTyped                                                  | 11 |
| undoHistory                                                          | 22 |
| vertexSelection_basic                                                | 28 |
| snap_gesture_model                                                   | 18 |
| sculpt_grab / smooth / pinch / store / undo                          | 112 |
| armatureOrganizer (sister fix verified)                              | 47 |

## Pre-existing latent fix bundled (commit `438f58e`)

The `matchTag` re-export bug in `src/io/armatureOrganizer.js`
introduced by [commit 7e264a9](https://github.com/) ("perf(loading):
split armatureMeta + defer initRig from eager graph") crashed
`npm run test:armatureOrganizer` (and therefore the full `npm test`
chain) since 2026-05-09. A bare `export { matchTag } from
'./armatureMeta.js'` doesn't add the binding to the re-exporting
module's local scope, so `autoRearrangeLayers`'s direct call crashed
with `ReferenceError`. 2-line import added; 47 assertions green.

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

### B. Toolset Phase 2.G + 3.J + 4.J manual gates (user-blocking)

Phases 2 + 3 + 4 are fully shipped + audit-fixed. Browser-side smoke
tests remain.

**Phase 4.J highlights** (full checklist in
[TOOLSET_PHASE_4_PROGRESS.md](./TOOLSET_PHASE_4_PROGRESS.md)
§"Manual gate"):

- N-panel "Topology" section visible in Edit Mode; Merge / Dissolve
  buttons + Cuts / Smoothness sliders + Subdivide button.
- M opens MergeMenu with 6 options (At First, At Last, At Center,
  At Cursor, Collapse, By Distance). Each item runs the variant +
  closes the menu. Esc / outside-click closes without action.
- M → At Cursor: select 3 verts, click anywhere on canvas → all 3
  collapse there.
- M → By Distance: prompts for threshold (default 1.0 px) → near-
  duplicate verts merge.
- Ctrl+X dissolves selected vertices; one-ring refills via ear-clip
  on convex / concave (star-shaped) rings.
- Subdivide cuts=2 produces 9 sub-tris per parent (NOT 16); cuts=3
  produces 16; cuts=6 produces 49.
- Smoothness>0 visibly smooths midpoints on multi-tri selections;
  rest mesh (restX/restY) is NOT mutated by smoothness.
- One operator = one undo entry: subdivide, Ctrl+Z → mesh restores
  to pre-op state in one step.
- After undo, GPU geometry matches restored project state (audit
  fix G-3 — pre-fix would render post-op geometry post-undo).
- BlendShape preservation: if part has shape keys, run subdivide
  with cuts=2 → shape key deltas barycentrically interpolate to
  midpoints + interior verts (audit fix D-1's `vertexWeights`).
- Save-then-load: project round-trip; then Subdivide on the loaded
  part doesn't crash (audit fix G-2).
- BYTE-FIDELITY: re-export cmo3 with topology-edited part still
  loads in Cubism Viewer.

### C. Toolset Phase 5 — Extrude (~4-5 days)

Next autonomous chunk per plan. `E`-key extrude on selected boundary
verts: duplicate, link edges to old, enter modal G. Boundary detection
already lives in `lib/proportionalEdit.js`'s adjacency code; new work
is the boundary-aware extrude operator + the modal-G hand-off. See
[TOOLSET_BLENDER_PARITY_PLAN.md §Phase 5](./TOOLSET_BLENDER_PARITY_PLAN.md).

### D. Manual browser gates 0.H + 1.F + 2.G + 3.J + 4.J (still pending user)

Five manual gates queued. Should be verified before further phases
ship.

## Hotkey reservations across both plans

Unchanged. Phase 4 added `KeyM` (Merge menu) and `Ctrl+X`/`Meta+X`
(Dissolve Vertices); Subdivide has no hotkey (Blender uses right-click
menu; SS exposes via N-panel button).

- `I` = Insert Keyframe (animation Phase 6)
- `B` = Box Select (toolset Phase 1) ✅ shipped
- `C` = Circle Select (toolset Phase 6)
- `M` = Merge menu (toolset Phase 4) ✅ shipped
- `Ctrl+X` = Dissolve Vertices (toolset Phase 4) ✅ shipped (Blender
  binds this to context-sensitive `MESH_OT_dissolve_mode`; SS direct
  dispatch will need re-routing in Phase 6+)
- `E` = Extrude (toolset Phase 5)
- `Shift+X` = Sample Weight (toolset Phase 7.B)
- `Ctrl+Shift+M` = Pose select-mirror (Blender-faithful)
- `Ctrl+Shift+V` = Mirror Pose (paste-flipped, Blender-faithful)
- `Ctrl+N` NOT bound (collides with Blender File New)
- `Alt+Shift+G/R/S` = Clear All Pose per-axis (3 separate chords,
  Blender-faithful)
- ⚠️ `Shift+S` reserved for Phase 7.A toolbox — collides with
  Blender's `VIEW3D_MT_snap_pie`; revisit binding before Phase 7
  ships

## Day-end commit chain (18 commits across four sub-sessions)

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
