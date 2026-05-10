# Phase 4 Blender-Fidelity Audit — 2026-05-10

Independent code review of commit `428bcdf` (Toolset Phase 4 — Merge /
Dissolve / Subdivide topology operators) through a Blender-fidelity
lens. Verified all parity claims against `reference/blender/source/`.

## Summary

9 gaps total — **2 HIGH** (math wrong vs Blender), **4 MED**
(silent missing features / semantic divergences), **3 LOW**
(labelling drift).

| ID   | Sev  | One-line | Action |
|------|------|----------|--------|
| D-1  | HIGH | `cuts > 1` iterates single-cuts (`4^cuts` sub-tris); Blender does single-pass `(cuts+1)^2` per `bm_subdivide_multicut` | FIXED `4347926` |
| D-2  | HIGH | Smoothness pull is Loop-style; Blender uses normal-guided slerp (no-op for flat 2D meshes) — labelled "Catmull-Clark-like" was wrong | FIXED `4347926` (DOCUMENT-AS-DEVIATION) |
| D-3  | MED  | `MERGE_FIRST` ("At First") missing from menu and operator | FIXED `4347926` |
| D-4  | MED  | `mergeAtLast` doesn't document active-vert must be selection-history-last | FIXED `4347926` (JSDoc) |
| D-5  | MED  | `mergeByDistance` is M-menu sub-item; Blender exposes as separate `MESH_OT_remove_doubles` with `use_unselected` + `use_centroid` | FIXED `4347926` (DOCUMENT-AS-DEVIATION) |
| D-6  | MED  | Boundary verts silently leave holes; Blender has `use_boundary_tear` + `use_face_split` | FIXED `4347926` (DOCUMENT-AS-DEVIATION) |
| D-7  | LOW  | `dissolve.js` doc-comment claimed "constrained Delaunay"; Blender's `BLI_polyfill_calc_arena` self-documents as ear-clip with KD-tree | FIXED `4347926` |
| D-8  | LOW  | `Ctrl+X` in Blender is `MESH_OT_dissolve_mode` (context-sensitive); harmless today but needs re-routing when edge/face select modes land | FIXED `4347926` (keymap doc) |
| D-10 | LOW  | Adjacent dissolved-vert clusters silently skipped; doc inconsistent across module banner / inline comment / JSDoc | FIXED `4347926` |

---

## HIGH-severity gaps

### D-1: cuts > 1 produces wrong sub-triangle density vs Blender

**Our file:** `src/v3/operators/edit/subdivide.js` (pre-fix)
**Blender source:** `bmesh/operators/bmo_subdivide.cc:440-468` (`bm_subdivide_multicut`)

Pre-fix `subdivide` ran `singleCut` in a loop `cuts` times. Each pass
quadruples the triangle count: `4^cuts`. Blender's `MESH_OT_subdivide`
inserts `cuts` midpoints *along each selected edge* in a single pass,
giving `(cuts+1)^2` sub-triangles per parent.

| cuts | SS pre-fix (4^cuts) | Blender ((cuts+1)^2) |
|------|---------------------|----------------------|
| 1    | 4                   | 4                    |
| 2    | 16                  | 9                    |
| 3    | 64                  | 16                   |
| 4    | 256                 | 25                   |

The pre-fix densities were exponentially off-target for cuts > 1.
Power users coming from Blender would expect Blender-shaped meshes;
SS produced wildly different geometry.

**Fix:** Rewrote `subdivide` as a single-pass triangular-grid
algorithm. For each subdivided parent triangle, generate `cuts`
midpoints per edge (cached so adjacent parents share), then build a
triangular grid of `(cuts+1)+1` rows with barycentric interior verts.
Emits exactly `(cuts+1)^2` sub-triangles per parent. **DONE in
`4347926`.** Pinned by `test_audit_fixes_2026_05_10_phase4.mjs` D-1.

Sister change to data interpolation: introduced `vertexWeights`
parallel map (extends `TopologyOpResult`) so per-vertex blendShape
deltas / weightGroups / boneWeights interpolate via barycentric
weights instead of unweighted source averages. Edge midpoint at
parameter t along (a, b) → `weights = [1-t, t]`. Interior vert at
barycentric (α, β, γ) → `weights = [α, β, γ]`. `remapPerVertexArray`
+ `averageDeltas` + `averageNumbers` all extended to take optional
weights.

---

### D-2: Smoothness algorithm is Loop-style, not Catmull-Clark

**Our file:** `src/v3/operators/edit/subdivide.js` (pre-fix doc said "Catmull-Clark-like")
**Blender source:** `bmesh/operators/bmo_subdivide.cc:237-368` (`alter_co`)

The smoothness pull was documented as "Catmull-Clark-like" but is
actually **Loop-subdivision-style** (neighbour-average pull). Blender's
`alter_co` does a normal-guided sphere-dual-blend slerp using the two
endpoint normals. On flat 2D meshes (every normal = `(0, 0, 1)` by
default), Blender's slerp **collapses to the raw linear midpoint**, so
`smoothness > 0` has NO visible effect in Blender for flat 2D art-mesh
geometry. Our Loop-style pull produces visible movement at
smoothness=1, which is more useful for 2D character editing but is
not Blender's behaviour.

**Action — DOCUMENT-AS-DEVIATION.** SS deliberately keeps Loop-style
because:
1. Visible 2D smoothness IS useful for character mesh cleanup
   (eyelid bevels, hair tip curls).
2. Blender's normal-based slerp would be a 2D no-op in our domain
   anyway — removing smoothness entirely as the "Blender-faithful"
   choice would lose useful functionality.

JSDoc + module banner now explicitly flag this as a SS deviation
with reference to the Blender source. **DONE in `4347926`.** Pinned
by `test_audit_fixes_2026_05_10_phase4.mjs` D-2 (greps the doc text).

---

## MED-severity gaps

### D-3: `MERGE_FIRST` ("At First") missing from menu and operator

**Our file:** `src/v3/operators/edit/merge.js` (pre-fix lacked `mergeAtFirst`)
**Blender source:** `editors/mesh/editmesh_tools.cc:3367-3372, 3515`

Blender's `MESH_OT_merge` enum has `MERGE_CENTER`, `MERGE_CURSOR`,
`MERGE_COLLAPSE`, `MERGE_FIRST`, `MERGE_LAST`. SS shipped 4 of 5 (no
`MERGE_FIRST`). Blender's M-menu shows At First whenever
`selected.first` is a vert.

**Fix:** Added `mergeAtFirst` operator + `edit.merge.atFirst`
registration + MergeMenu entry. SS uses Set iteration order as a proxy
for selection-history (insertion order; matches click-history for
click-built selections, geometry-scan order for box/lasso). Documented
deviation. **DONE in `4347926`.** Pinned by
`test_audit_fixes_2026_05_10_phase4.mjs` D-3.

---

### D-4: `mergeAtLast` requires selection-history-last but doesn't document it

**Our file:** `src/v3/operators/edit/merge.js`
**Blender source:** `editors/mesh/editmesh_tools.cc:3388-3411`

Pre-fix JSDoc only said "All selected verts collapse to the active
vertex" — silent on which vertex "active" should be. Blender's
`em->bm->selected.last` is the most-recently-added selection entry.
SS's `editorStore.activeVertex` tracks the same thing (writes on every
`selectVertex` / `toggleVertexSelection` add path), but a caller using
a non-history-last index would silently diverge.

**Fix:** JSDoc explicitly documents the requirement + cross-references
`editorStore.activeVertex`. **DONE in `4347926`.**

---

### D-5: `mergeByDistance` taxonomy + missing Blender features

**Our file:** `src/v3/operators/edit/merge.js`
**Blender source:** `editors/mesh/editmesh_tools.cc:3647-3783`, `space_view3d.py:5197`

`mergeByDistance` is a sub-item of our M-menu; Blender exposes it as a
distinct operator (`MESH_OT_remove_doubles`). Blender's version has
`use_unselected` (merge selected verts against unselected ones,
absent from SS) and `use_centroid=false` (collapse pairs to one
endpoint instead of centroid, also absent).

**Action — DOCUMENT-AS-DEVIATION.** SS keeps the sub-item taxonomy for
muscle-memory locality (one menu instead of two operator searches).
Missing features documented in JSDoc as v1 simplifications. **DONE in
`4347926`.**

---

### D-6: Boundary dissolve silently leaves holes

**Our file:** `src/v3/operators/edit/dissolve.js`
**Blender source:** `bmesh/operators/bmo_dissolve.cc:695-801`, `editmesh_tools.cc:5979-5993`

Boundary verts dissolved → no refill (open ring → ear-clip returns
[]). Blender's `MESH_OT_dissolve_verts` exposes `use_boundary_tear`
(pre-splits incident faces) and `use_face_split` (prevents
post-dissolve degenerate faces). Neither implemented in v1 SS.

**Action — DOCUMENT-AS-DEVIATION.** Documented v1 behaviour ("boundary
dissolve drops incident triangles + leaves a hole; subsequent Remesh
closes it"). Phase 6+ to add the optional flags. **DONE in `4347926`.**

---

## LOW-severity gaps

### D-7: dissolve.js doc claimed "constrained Delaunay"

**Our file:** `src/v3/operators/edit/dissolve.js` (pre-fix module doc)
**Blender source:** `blenlib/intern/polyfill_2d.cc:1-33`

Pre-fix doc said Blender's polygon-fill uses constrained Delaunay.
Actually `BLI_polyfill_calc_arena` self-documents as **"An ear
clipping algorithm"** with a KD-tree for performance. So Blender's
algorithm is the same family as our Meisters–Chazelle (just with the
KD-tree for large rings).

**Fix:** Doc corrected to reference the actual Blender file and
algorithm. **DONE in `4347926`.**

---

### D-8: `Ctrl+X` in Blender is `MESH_OT_dissolve_mode` (context-sensitive)

**Our file:** `src/v3/keymap/default.js`
**Blender source:** `blender_default.py:5605`, `editmesh_tools.cc:6281`

Plan said "Ctrl+X = MESH_OT_dissolve_verts". Actually Blender's chord
is `MESH_OT_dissolve_mode`, a context-sensitive dispatcher that calls
vert/edge/face dissolve based on `tool_settings->selectmode`.
Currently harmless because SS is vertex-only — but the binding will
need a dispatch wrapper when edge/face select modes land (Phase 6+).

**Fix:** Keymap comment now references `MESH_OT_dissolve_mode` and
flags the future re-routing requirement. **DONE in `4347926`.**

---

### D-10: Adjacent dissolved-vert clusters silently skipped (doc inconsistent)

**Our file:** `src/v3/operators/edit/dissolve.js`
**Blender source:** `bmesh/operators/bmo_dissolve.cc:762-778`

Code skipped clusters silently with a code comment but no JSDoc and
no plan-spec mention. Architecture audit G-4 also flagged the
misleading "will be re-fed when we process their centre" comment.

**Fix:** Module banner + inline comment + JSDoc all consistent — v1
simplification, Blender's `BM_faces_join_pair` per-edge approach
queued for Phase 6+. **DONE in `4347926`.**
