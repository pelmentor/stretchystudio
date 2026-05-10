# Phase 5 Blender-Fidelity Audit — 2026-05-10

Independent code review of commit `ea590ac` (Toolset Phase 5 — Extrude
operator + vertex-mode modal G) through a Blender-fidelity lens.
Verified against `reference/blender/source/`.

## Summary

10 gaps total — **2 HIGH** (silent wrong-behaviour vs Blender), **5 MED**
(missing Blender features / semantic divergences), **3 LOW** (active-vert
mapping + active-history details + label drift).

| ID   | Sev  | One-line | Action |
|------|------|----------|--------|
| D-1  | HIGH | Esc-cancel rolls back the topology change; Blender keeps the extrude (only the translate is cancelled) | DOCUMENT-AS-DEVIATION |
| D-2  | HIGH | Interior-vert selection toasts and bails; Blender dispatches to `extrude_verts_indiv` (creates wire-edge to a new vert) | DOCUMENT-AS-DEVIATION |
| D-3  | MED  | `R`/`S` mid-modal switching is supported by Blender's `TRANSFORM_OT_translate`; SS modal G is translate-only | DOCUMENT-AS-DEVIATION |
| D-4  | MED  | Multi-vert selection with no shared boundary edges → SS bridges nothing AND ALSO emits `extrude_region`-style duplicate-only path; Blender dispatches to `extrude_verts_indiv` (each vert gets its OWN duplicate + connecting edge) | DOCUMENT-AS-DEVIATION |
| D-5  | MED  | `Alt+E` (extrude variants pop-up menu) not bound; Blender's canonical access for `extrude_verts_indiv` / `extrude_repeat` / `dupli_extrude_cursor` | DEFER |
| D-6  | MED  | RMB during modal G cancels in SS; Blender's translate uses RMB-to-cancel only when `release_confirm=false` AND `select_mouse=RIGHT` (default LMB-select preset has RMB-cancel; SS unconditionally uses RMB cancel which is correct for that preset) | DOCUMENT-AS-DEVIATION |
| D-7  | MED  | Degenerate-tri filter on boundary detection — Blender does NOT area-filter degenerate faces in `BM_edge_is_boundary`; SS adds an area threshold for Live2D seam-tri masking | DOCUMENT-AS-DEVIATION |
| D-8  | LOW  | Active-vertex post-extrude uses `Set.values().next()` (insertion order); Blender remaps every selection-history entry via `BMO_mesh_selected_remap` so previous-active → its duplicate | DOCUMENT-AS-DEVIATION |
| D-9  | LOW  | extrude.js cites `editmesh_extrude.cc:507-585` as the canonical source — actual range for `MESH_OT_extrude_region` definition is 458-476; the dispatch logic is `edbm_extrude_mesh` at 358-427 + `edbm_extrude_ex` at 212-257; bmop is `bmo_extrude_face_region_exec` at 319+ in `bmesh/operators/bmo_extrude.cc` | FIX (cite update) |
| D-10 | LOW  | Quad-emission winding doc-comment claims "absolute winding doesn't affect rendering"; Blender's loop order has explicit `use_normal_flip` semantics (irrelevant in 2D-alpha-blend Live2D, but the JSDoc should still cite the Blender source for the winding convention) | DOCUMENT-AS-DEVIATION |

---

## HIGH-severity gaps

### D-1: Esc-cancel rolls back the entire extrude; Blender keeps it

**Our file:** `src/v3/operators/registry.js:892-941` (extrude operator) +
`src/v3/shell/ModalVertexTransformOverlay.jsx:336-375` (rollbackThenCancel)
**Blender source:** `windowmanager/intern/wm_operator_type.cc:308-328`
(`wm_macro_end`) + `:475-483` (`wm_macro_cancel`)

SS opens an undo batch BEFORE running the extrude topology op + before
the modal G begins; on Esc, `discardBatch` rolls back BOTH the topology
AND the live drag. Blender's `MESH_OT_extrude_region_move` is a macro:
the extrude sub-operator runs with `exec()` and FINISHES first, then
`TRANSFORM_OT_translate` runs modally. On Esc, only the translate is
cancelled (`wm_macro_cancel` calls `op->opm->type->cancel(C, op->opm)`
on the *current* modal sub-op). The `wm_macro_end` then converts the
overall macro return from CANCELLED → FINISHED iff a previous
sub-operator finished:

```cpp
if (retval & (OPERATOR_CANCELLED | OPERATOR_INTERFACE)) {
    if (md && (md->retval & OPERATOR_FINISHED)) {
      retval |= OPERATOR_FINISHED;
      retval &= ~(OPERATOR_CANCELLED | OPERATOR_INTERFACE);
    }
}
```

So in Blender, after Esc-mid-translate, the user is left with the
extruded geometry sitting on top of the source verts (a "doubled-vert"
state). They can press M (merge) to undo it manually, or Ctrl+Z to undo
the whole thing.

SS's behaviour (Esc rolls back both topology + drag) is more
user-friendly for the "I changed my mind" case — but it's NOT Blender.
A Blender user who muscle-memory presses Esc will think "OK extrude
done, drag cancelled, ready for next op", but in SS the entire extrude
disappears.

**Recommended action — DOCUMENT-AS-DEVIATION** (per Rule №1):
SS deliberately diverges because:
1. SS lacks a "merge by distance" muscle-memory recovery path that's as
   smooth as Blender's M-menu; the doubled-vert state is harder to
   resolve.
2. The extrude+drag is a single intentional gesture in our UX model
   (one batch open before extrude). Cancelling mid-gesture means
   "abort the gesture", not "abort just the second half".

JSDoc on `extrude` (registry.js) + `rollbackThenCancel` (overlay) +
`modalVertexTransformStore.js` should explicitly cite the Blender
divergence with the wm_macro_end source line. Add a memory entry too —
this is a behaviour Blender users WILL hit.

---

### D-2: Interior-vert selection toasts and bails; Blender dispatches to verts_indiv

**Our file:** `src/v3/operators/registry.js:882-889` + `src/v3/operators/edit/extrude.js:80-91`
**Blender source:** `editors/mesh/editmesh_extrude.cc:358-427`
(`edbm_extrude_mesh` dispatch) + `editors/mesh/editmesh_extrude.cc:169-186`
(`edbm_extrude_verts_indiv`) + `bmesh/operators/bmo_extrude.cc:236-284`
(`bmo_extrude_vert_indiv_exec`)

SS's `extrude(mesh, sel)` returns `null` when `selectedBoundary.size === 0`,
and the operator toasts "Cannot extrude / Extrude needs selected boundary
verts." The user is fully blocked on interior-vert selection.

Blender's E-key flow in vertex select mode:

```cpp
// edbm_extrude_mesh:366-378
if (em->selectmode & SCE_SELECT_VERTEX) {
  if (em->bm->totvertsel == 0) {
    nr = NONE;
  }
  else if (em->bm->totvertsel == 1) {
    nr = VERT_ONLY;            // ← single vert OR no edges between selected verts
  }
  else if (em->bm->totedgesel == 0) {
    nr = VERT_ONLY;            // ← multi-vert but none share an edge (all interior!)
  }
  else {
    nr = ELEM_FLAG;            // ← extrude_face_region (this is what SS implements)
  }
}
```

For interior-only vert selection, `totedgesel == 0` → `VERT_ONLY` →
`extrude_verts_indiv`, which:
1. Creates a NEW vert at the same position (`BM_vert_create(bm, v->co, v, BM_CREATE_NOP)`)
2. Creates a NEW EDGE between the source and the duplicate (`BM_edge_create(bm, v, dupev, nullptr, BM_CREATE_NOP)`)
3. Selects the duplicate, deselects the source, hands off to translate

So Blender's "interior vert extrude" is a **wire-edge extension** — useful
for retopology / loose-vert sketching. SS's region-only implementation
silently blocks this entire workflow.

**Recommended action — DOCUMENT-AS-DEVIATION** with explicit plan
followup (Phase 6+ should ship `extrude.vertsIndiv` as a separate operator
+ E-key dispatcher that picks based on `totedgesel`). For Live2D meshes,
wire-edge geometry is unusable downstream (no triangles → no rendering),
so the v1 "boundary verts only" gate matches the data model. But the
toast wording should NOT say "Cannot extrude" — that's misleading. A
Blender-aware user will read it as "extrude is broken" rather than
"extrude needs faces".

Suggested toast: "Interior-vert extrude not supported (Live2D meshes
need triangles). Select a boundary vertex." — and add a memory pinning
the Phase 6+ plan: ship `extrude.vertsIndiv` per Blender's
`MESH_OT_extrude_verts_indiv` once a mesh model that supports
wire-edges lands.

---

## MED-severity gaps

### D-3: Mid-modal R/S switch missing

**Our file:** `src/store/modalVertexTransformStore.js:38` (kind constrained
to `'translate'`) + `src/v3/shell/ModalVertexTransformOverlay.jsx:243-303`
(no R/S keyhandlers)
**Blender source:** `editors/transform/transform.cc:693-742`

Blender's `TRANSFORM_OT_translate` accepts `TFM_MODAL_ROTATE` /
`TFM_MODAL_RESIZE` mid-modal switches (default `R` and `S` chords) and
converts the in-flight transform without restarting:

```cpp
case TFM_MODAL_TRANSLATE:
case TFM_MODAL_ROTATE:
case TFM_MODAL_RESIZE: {
  if (!transform_mode_is_changeable(t->mode)) return false;
  // ...switches modes...
}
```

So a Blender user presses E → drag starts in translate → presses R →
modal switches to rotate around selection median, dragging the new
ring around. SS's modal G is translate-only and ignores `KeyR` /
`KeyS` mid-modal.

**Recommended action — DOCUMENT-AS-DEVIATION.** SS's
`modalVertexTransformStore` JSDoc already calls out "Translate ONLY in
v1" with reference to "Phase 6+ — needs an anchor / pivot model that
only makes sense once a real pivot mode (median / individual / cursor)
lands per-edit-mode." That's correct. But the doc should also cite the
Blender source (`transform.cc:693-742`) so a future implementer
porting this knows where to look.

---

### D-4: Multi-vert selection with no shared boundary edges silently routes through region path

**Our file:** `src/v3/operators/edit/extrude.js:115-123`
**Blender source:** `editors/mesh/editmesh_extrude.cc:373-378`
(`totedgesel == 0` branch) + `bmesh/operators/bmo_extrude.cc:236-284`
(`bmo_extrude_vert_indiv_exec`)

Sister-issue to D-2. When the user selects multiple boundary verts that
DON'T share any boundary edges (e.g. opposite corners of a quad mesh),
SS's region extrude:

```js
for (const [u, v] of boundaryEdges) {
  if (!selectedBoundary.has(u) || !selectedBoundary.has(v)) continue;
  // ... emit quad ...
}
```

emits ZERO quad bridges, only the duplicates. The user gets isolated
duplicate verts at the source positions with no connecting geometry.
Blender's dispatch picks `VERT_ONLY` in this case — each selected vert
gets its own duplicate AND an edge connecting source-to-duplicate (a
wire-edge per vert).

This is verified by `test_extrude_partialBoundary.mjs:75-93` (test 3):
selection `[0, 2]` on a quad where `(0,2)` is the interior diagonal →
2 dups, NO bridge tris. SS's tests CONFIRM the divergence is intentional
("non-contiguous selection" is documented), but Blender's behaviour is
to emit the wire-edges.

**Recommended action — DOCUMENT-AS-DEVIATION** (same Phase 6+ followup
as D-2 — the wire-edge semantics need a mesh model that supports them).
Add JSDoc on `extrude` explicitly noting "no quad bridge" for the
non-contiguous case + cite Blender's `extrude_verts_indiv` dispatch as
the missing path.

---

### D-5: Alt+E variants menu not bound

**Our file:** `src/v3/keymap/default.js:153` (only KeyE bound)
**Blender source:** `scripts/presets/keyconfig/keymap_data/blender_default.py:5571`
(`("VIEW3D_MT_edit_mesh_extrude", {"type": 'E', "value": 'PRESS', "alt": True})`)
+ `scripts/startup/bl_ui/space_view3d.py:4786-4816` (menu items)

Blender's Alt+E in vertex select mode opens a popup with:
- Extrude Vertices (`mesh.extrude_vertices_move`)
- Extrude Repeat (`mesh.extrude_repeat`)
- Spin (`mesh.spin`)
- Mesh > Extrude catalog asset items

SS doesn't bind Alt+E at all. A Blender user expects to find the
"verts indiv" / "extrude repeat" alternates here.

The keymap doc-comment in `default.js:147-152` already mentions this:
"Blender's keymap routes Alt+E to a 'wave' pop-up menu of extrude
variants; SS direct dispatch ships only the region variant in v1
(Phase 6+ may add `MESH_OT_extrude_verts_indiv`...)"

**Recommended action — DEFER.** SS doesn't have any of the variant
operators yet (no `extrude_vertices_indiv`, no `extrude_repeat`, no
`spin`), so the menu would be empty. Once even one variant lands,
bind Alt+E and surface the menu.

---

### D-6: RMB-cancel matches Blender's LMB-select preset, not the older RMB-select preset

**Our file:** `src/v3/shell/ModalVertexTransformOverlay.jsx:231-242`
(onClick + onContextMenu)
**Blender source:** `transform.cc` modal map entries for confirm/cancel
+ `space_view3d.py` keymap presets

Blender's modal cancel chord depends on the active keyconfig: in the
default LMB-select preset (since 2.8), RMB cancels the modal transform.
In the legacy RMB-select preset, LMB cancels. SS unconditionally uses
RMB-cancel + LMB-confirm, which matches the LMB-select preset.

**Recommended action — DOCUMENT-AS-DEVIATION.** SS doesn't expose a
keymap preset switch (the keymap is hardcoded). Document the LMB-select
assumption in `ModalVertexTransformOverlay.jsx`'s module banner. When
keymap presets become a thing (Phase 7+ "Industry-Compatible" mode), the
modal will need to respect `select_mouse` like Blender does.

---

### D-7: Degenerate-tri area filter is SS-specific (not in Blender)

**Our file:** `src/lib/meshTopology.js:87-98` (`isDegenerateTri`) + `:420-440`
(`getBoundaryVerts`)
**Blender source:** `bmesh/intern/bmesh_query_inline.hh:111-115`
(`BM_edge_is_boundary` — checks loop count only) +
`bmesh/intern/bmesh_core.cc:1878,1939` (`kill_degenerate_faces`
filter — checks `len < 3`, NOT area)

```cpp
ATTR_WARN_UNUSED_RESULT ATTR_NONNULL(1) BLI_INLINE bool BM_edge_is_boundary(const BMEdge *e)
{
  const BMLoop *l = e->l;
  return (l && (l->radial_next == l));   // exactly one face
}
```

Blender's "degenerate face" check is purely topological: a face with
fewer than 3 verts. Blender doesn't check signed area when computing
`BM_edge_is_boundary`. A genuinely zero-area face (3 collinear verts)
would still be counted in Blender's `BM_edge_is_boundary` test.

SS adds an `epsArea = 1e-9` filter (`isDegenerateTri`):

```js
const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
return Math.abs(cross) < epsArea;
```

This is a SS-specific accommodation for Live2D meshes that include
zero-area "seam" triangles as UV / clip-mask separators. Without the
filter, those seam edges would misclassify as boundary edges.

The audit-driven hardening doc in `getBoundaryVerts` JSDoc already
documents this clearly. The plan §5.A also documents it.

**Recommended action — DOCUMENT-AS-DEVIATION.** SS's filter is correct
for the Live2D data model (Blender meshes wouldn't have these seam tris
in typical user content). The behaviour is a Live2D adaptation, not a
Blender bug-port. Bolster the doc to explicitly cite Blender's
`BM_edge_is_boundary` source line and call out the SS-side filter as a
Live2D-specific addition.

---

## LOW-severity gaps

### D-8: Active-vertex post-extrude is iteration-order; Blender remaps full selection-history

**Our file:** `src/v3/operators/edit/applyTopologyOp.js:259-273`
(`overrideSelectionForPart`)
**Blender source:** `bmesh/operators/bmo_extrude.cc:259-265` (verts_indiv
remap) + `bmesh/intern/bmesh_operators.cc:582-624`
(`BMO_mesh_selected_remap`)

SS's `overrideSelectionForPart`:

```js
const first = override.values().next().value;
if (typeof first === 'number') {
  editor.selectVertex(partId, first, /* additive */ true);
}
```

picks the first iteration value of the override Set as the new active
vertex. Set iteration is insertion-order, so for the typical case of
"selection built up by clicking" the active vert post-extrude = duplicate
of first-clicked source vert.

Blender's `BMO_mesh_selected_remap`:

```cpp
for (ese = static_cast<BMEditSelection *>(bm->selected.first); ese; ese = ese_next) {
  ese_next = ese->next;
  // ...
  ese->ele = static_cast<BMElem *>(BMO_slot_map_elem_get(slot_elem_map, ese->ele));
  // ...
}
```

walks the ENTIRE `selected.{first..last}` linked list and rewrites each
entry from source elem to duplicate. So `selected.last` (Blender's
"active") becomes the duplicate of the previously-active source vert.

For matched insertion-order selections these two rules give the SAME
result. For selections built by box/lasso (where Blender's history-last
might differ from SS's first-iteration-order), the active vert post-
extrude diverges.

Same compromise applies to `mergeAtFirst` / `mergeAtLast` (already
documented in Phase 4 audit D-3). SS could match Blender exactly by:
(a) tracking selection-history-first/last in editorStore, OR (b)
preserving the prior `activeVertex.vertIndex` mapping (if the active
source has an entry in `dupOf`, set active to its duplicate).

**Recommended action — DOCUMENT-AS-DEVIATION.** Same scope as
`mergeAtFirst` / `mergeAtLast`. The deviation is identical in shape
and root cause (no selection-history slot in `editorStore`). Bolster
the JSDoc on `overrideSelectionForPart` (and `extrude` in registry.js)
to explicitly reference the Blender remap source + the Phase 4 D-3
audit memo.

For Phase 5 specifically: when `editor.activeVertex` exists pre-extrude
AND its index is in `dupOf`, the override path SHOULD prefer the
duplicate of the prior-active vert. Today it picks `Set.values().next()`
unconditionally. This is a tiny fix (~3 lines) with a real Blender-
fidelity improvement — could be a fast-follow.

---

### D-9: extrude.js cites a wrong/imprecise Blender source line range

**Our file:** `src/v3/operators/edit/extrude.js:13-17`
**Blender source:** `editors/mesh/editmesh_extrude.cc:430-456`
(`edbm_extrude_region_exec`) + `:358-427` (`edbm_extrude_mesh` dispatch)
+ `bmesh/operators/bmo_extrude.cc:319+` (`bmo_extrude_face_region_exec`)

The module docstring says:

```js
* Source: `MESH_OT_extrude_region` in
* `editors/mesh/editmesh_extrude.cc:507-585`. Blender's algorithm is
* face-flag-driven; SS is vertex-only so we lift the boundary-vert /
* boundary-edge subset directly via `getBoundaryVerts` /
* `getBoundaryEdges`.
```

Verified: `editmesh_extrude.cc` is 933 lines total, and the actual
ranges are:
- `MESH_OT_extrude_region` operator definition: lines 458-476
- `edbm_extrude_region_exec` (the exec callback): lines 430-456
- `edbm_extrude_mesh` (dispatch by selectmode): lines 358-427
- `edbm_extrude_ex` (the actual face-region wrapper): lines 212-257
- `bmo_extrude_face_region_exec` (the BMOP doing the work): bmo_extrude.cc:319+

The 507-585 range cited in the JSDoc doesn't correspond to anything in
Blender 4.x source — it's `edbm_split_exec` and other code at that
range. The keymap doc (`default.js:146`) repeats the same bad citation.

The same wrong-citation appears in the Phase 5 plan §5.A / §5.B at
`docs/plans/TOOLSET_BLENDER_PARITY_PLAN.md` (audit context, didn't
modify) — call it out so it gets fixed in lockstep.

**Recommended action — FIX.** Update the cite in `extrude.js` module
docstring to point at:
- `editors/mesh/editmesh_extrude.cc:430-456` (`edbm_extrude_region_exec`)
- AND `editors/mesh/editmesh_extrude.cc:358-427` (`edbm_extrude_mesh`,
  the actual dispatch logic — this is what governs the SS-relevant
  vertex-mode selectmode behaviour)
- AND `bmesh/operators/bmo_extrude.cc:319+` (`bmo_extrude_face_region_exec`,
  the BMOP that does the actual quad emission)

Sister update: the keymap doc-comment in `src/v3/keymap/default.js:146`
("`KeyE` = `MESH_OT_extrude_region` for vertex select mode
(`editmesh_extrude.cc:507-585`)").

---

### D-10: Quad-emission winding doc-comment misses Blender's normal-flip semantics

**Our file:** `src/v3/operators/edit/extrude.js:42-54` (module doc) +
`:120-123` (the actual emission)
**Blender source:** `bmesh/operators/bmo_extrude.cc:517-541`
(`use_normal_flip` branch)

SS's doc:

```
* **Quad winding.** New triangles emit as `(u, v, v', u')` =
* `(u, v, v')` + `(u, v', u')` where u < v in canonical edge order.
* Live2D / SS is alpha-blend (no backface cull), so the absolute
* winding doesn't affect rendering — but the two new triangles share
* the same handedness, so cross-product sanity tests downstream see
* consistent winding within the quad.
```

Blender's `bmo_extrude_face_region_exec` builds the quad from
`(e->v1, e->v2, e_new->v2, e_new->v1)` with an `edge_normal_flip`
toggle determined by:

```cpp
edge_normal_flip = !(e_new->l ? (e_new->l->v == e_new->v1) : (!e->l || !(e->l->v == e->v1)));
```

i.e. orient the new face to give the same normal as the existing
adjacent face's loop. For Live2D 2D meshes this is irrelevant (no
visible normals, alpha blend). But the doc-comment claims winding
"doesn't matter", which is true RENDER-WISE but loses the Blender
context that would help a future implementer hooking into a 3D
extension.

**Recommended action — DOCUMENT-AS-DEVIATION.** Update the JSDoc to
explicitly cite Blender's normal-flip logic + state that SS skips it
because Live2D has no per-face normals. This is a 2-line doc tweak.

---

## Notes for the architecture auditor

The duplicate-batch-discard semantics + scene-registry re-upload paths
in `ModalVertexTransformOverlay.jsx:336-375` are architectural concerns
(potential undo-stack pollution if `discardBatch` ordering changes
break invariant preservation). Out of scope for this Blender-fidelity
audit — flagging here for the arch sweep.

The `extrude` operator's `vertexSources.set(i, [i])` for ALL
pre-existing verts (line 101) creates an O(N) Map up-front before
anything is decided. For very large meshes this is wasteful (existing
operators that survive untouched could be skipped via a sentinel).
Same — out of scope; arch concern.

The `selectionOverride: new Set(dupOf.values())` (line 164) is built
even when `selectedBoundary.size === 0` would have early-returned (line
91). The flow is correct but the set is conceptually constructed before
we know there are duplicates. Defensive ordering, not a bug.
