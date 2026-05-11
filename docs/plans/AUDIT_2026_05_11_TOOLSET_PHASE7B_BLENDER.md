# Phase 7.B Blender-Fidelity Audit (2026-05-11)

Reviewed commit `9489177` — Phase 7.B Weight Paint tools (Sample / Blur
brush / Mirror / X-Mirror toggle / Normalize All). Verified against
`reference/blender/` source files. All cited line numbers were opened
and checked.

## Summary

9 gaps found: **1 HIGH**, **3 MEDIUM**, **5 LOW**.

| ID  | Sev | One-line | Action |
|-----|-----|----------|--------|
| D-1 | HIGH | Blur algorithm: Blender accumulates face-loop weights (includes self-weight, multi-counts shared neighbors); SS uses pure unique-neighbor mean | FIX |
| D-2 | MED  | `paint_weight.cc:1063` cited as "Brush type enum (`WPAINT_BRUSH_TYPE_BLUR`)"; line 1063 is a runtime `if(ELEM(...))` check; the enum lives in `DNA_brush_enums.h:507-510` | FIX (cite) |
| D-3 | MED  | Mirror mode `'topology'` is a naming inversion: SS calls coordinate-position matching "topology"; Blender's `use_topology=false` (DEFAULT) is coordinate matching and `use_topology=true` is graph-walk | FIX |
| D-4 | MED  | `NAME_PAIRS` in mirror.js is missing name-flip patterns from `BLI_string_flip_side_name`: dash separator (`-L/-R`), space separator (` L/ R`), prefix forms (`L_name`/`R_name`), and all-caps `LEFT`/`RIGHT` | FIX |
| D-5 | LOW  | `paint.weight_sample_group` (`Ctrl+Shift+X`, `blender_default.py:5137`) not implemented and not documented | DOCUMENT-AS-DEVIATION |
| D-6 | LOW  | Draw and Blur stroke strength hardcoded at `0.5`; Blender reads `brush.alpha * pressure`; no slider surfaced | DOCUMENT-AS-DEVIATION |
| D-7 | LOW  | Sample threshold `max(8, brushSize/2)` matches Blender's `ED_MESH_PICK_DEFAULT_VERT_DIST = 25` only at the default brush size of 50px; diverges when user shrinks the brush below 16px | DOCUMENT-AS-DEVIATION |
| D-8 | LOW  | `xMirror` stored per-Object (schema v34); Blender's `Mesh.use_mirror_x` is per-Mesh. Companion `use_mirror_topology` not modeled. Already documented in the migration file. | DOCUMENT-AS-DEVIATION (already documented) |
| D-9 | LOW  | `lock_active` deviation in normalizeAll already documented inline in normalize.js | DOCUMENT-AS-DEVIATION (already documented) |

---

## HIGH

### D-1: Blur algorithm differs from Blender — face-loop accumulation vs. pure neighbor mean

**File**: `src/lib/weightPaint/blur.js:78-88` (`computeBlurUpdates`)

**Severity**: HIGH — for any interior vertex on a triangle mesh, the
blur target weight computed by SS is numerically different from
Blender's. The two formulas pull in the same direction (toward
neighbors) but with different coefficients, so repeated strokes
produce different convergence.

**Blender ref**: `reference/blender/source/blender/editors/sculpt_paint/mesh/paint_weight.cc:1214-1249`
(`do_wpaint_brush_blur`)

```c
/* Get the average face weight */
int total_hit_loops = 0;
float weight_final = 0.0f;
for (const int face : vert_to_face[vert]) {
    total_hit_loops += faces[face].size();          // += 3 per triangle
    for (const int corner_vert : corner_verts.slice(faces[face])) {
        weight_final += wpd.precomputed_weight[corner_vert];  // includes vert itself
    }
}
weight_final /= total_hit_loops;  // denominator = 3 × valence for tri mesh
```

For a vertex `v` with valence k on a pure-triangle mesh, Blender
accumulates:
- `v`'s own weight **k times** (once per incident face)
- each of `v`'s k neighbors' weights **once** (each neighbor appears in
  exactly one incident face corner)
- total denominator: `3k`

Blender's target weight: `(k * w[v] + sum(w[n] for n in neighbors)) / (3k)`
Which simplifies to: `w[v]/3 + sum(w[n]) / (3k)` — a blend that
preserves 1/3 of the vertex's own weight.

**SS behavior** (`blur.js:80-88`):

```js
for (const nb of neighborSet) {
    if (nb === i) continue;   // explicitly excludes self
    sum += currentWeights[nb];
    n++;
}
const mean = sum / n;   // pure neighbor mean, self excluded
```

SS target: `mean(w[n] for n in neighbors)` — no self-weight term at all.

**Impact**: The SS blur converges more aggressively toward the neighbor
mean than Blender does. On a flat uniform-weight region both produce
identical results (no-op). On a sharp boundary: a vertex at `w=1.0`
surrounded by `w=0.0` neighbors converges to `0.0` in SS per tick, but
to `0.333` in Blender per tick. After N strokes the boundary sharpness
is very different.

**Fix**: Replace the unique-neighbor mean with Blender's face-loop
accumulation. The adjacency structure needs to expose incident faces
(not just unique neighbors), or `computeBlurUpdates` needs to receive
the triangle array directly and replicate the loop.

Concrete algorithm for `blur.js`:

```
for each face incident on vertex i:
    total_loops += 3   (triangle mesh)
    for each corner vertex c of that face:
        weight_sum += currentWeights[c]   // includes c === i
weight_final = weight_sum / total_loops
```

The `buildVertexAdjacency` helper currently returns `Set<neighborIndex>`
which loses the "how many faces share this neighbor" multiplicity.
Either: (a) pass the triangle array to `computeBlurUpdates` and build
the face-loop sum inline, or (b) expose a `buildVertexToFace` helper
parallel to `buildVertexAdjacency` that returns `Array<int[]>` (face
corner lists per vertex).

---

## MEDIUM

### D-2: `paint_weight.cc:1063` cited as "Brush type enum" — it is a runtime check; enum is in `DNA_brush_enums.h`

**File**: `src/lib/weightPaint/blur.js:29` (module header comment)

**Severity**: MEDIUM — citation targets the wrong artifact. A future
developer following the cite to verify the enum values finds an
`if(ELEM(...))` guard, not the enum definition.

**Blender ref**:
- `reference/blender/source/blender/makesdna/DNA_brush_enums.h:507-510` — actual enum:
  ```c
  WPAINT_BRUSH_TYPE_DRAW    = 0,
  WPAINT_BRUSH_TYPE_BLUR    = 1,
  WPAINT_BRUSH_TYPE_AVERAGE = 2,
  WPAINT_BRUSH_TYPE_SMEAR   = 3,
  ```
- `reference/blender/source/blender/editors/sculpt_paint/mesh/paint_weight.cc:1063` — what is actually there:
  ```c
  if (ELEM(brush->weight_brush_type, WPAINT_BRUSH_TYPE_SMEAR, WPAINT_BRUSH_TYPE_BLUR)) {
      wpd->precomputed_weight = MEM_new_array_uninitialized<float>(...);
  }
  ```

**Fix**: Change the cite in `blur.js:29` from
`paint_weight.cc:1063 (WPAINT_BRUSH_TYPE_BLUR)` to
`makesdna/DNA_brush_enums.h:507-510`. Optionally retain the `:1063`
cite as "precomputed_weight allocation check" with the correct
description.

---

### D-3: Mirror mode `'topology'` is a naming inversion vs. Blender's `use_topology` flag

**Files**: `src/v3/operators/weightPaint/mirror.js:1-15` (module doc),
`src/v3/operators/registry.js:1573-1574` (operator id + label)

**Severity**: MEDIUM — a Blender user reading the command-palette label
"Mirror Weights (Topology, X axis)" will expect mesh-graph-walk pairing
(Blender's `use_topology=true`). SS gives them coordinate-position
matching, which is Blender's `use_topology=false` (the **default**).

**Blender ref**: `reference/blender/source/blender/editors/object/object_vgroup.cc:3729-3733`
(OBJECT_OT_vertex_group_mirror property):

```c
RNA_def_boolean(ot->srna, "use_topology", false, "Topology Mirror",
    "Use topology based mirroring (for when both sides of mesh have matching, "
    "unique topology)");
```

`use_topology=false` (default) = match by mirrored X coordinate.
`use_topology=true` = walk the mesh edge graph. SS "topology" mode uses
X-coordinate matching — which is Blender's DEFAULT (non-topology)
behavior.

**Fix**: Rename the mode identifier and label:

| Current | Proposed |
|---------|----------|
| `mode: 'topology'` | `mode: 'position'` |
| operator id `weightPaint.mirror.byTopology` | `weightPaint.mirror.byPosition` |
| label `'Mirror Weights (Topology, X axis)'` | `'Mirror Weights (By Position, X axis)'` |
| mirror.js module doc: "topology: pairs each vertex with the vertex at its mirrored X coordinate" | "position: pairs vertices by mirrored X coordinate (Blender's default, `use_topology=false`)" |

The toast in `registry.js:1583` ("No mirror-vertex pairs found on the
active mesh") is fine as-is.

---

### D-4: `NAME_PAIRS` in mirror.js is missing name-flip patterns from `BLI_string_flip_side_name`

**File**: `src/v3/operators/weightPaint/mirror.js:71-76` (`NAME_PAIRS` constant)

**Severity**: MEDIUM — users whose groups are named `Group-L`/`Group-R`,
`L_Arm`/`R_Arm`, or `LEFT_eye`/`RIGHT_eye` will get zero matches in
`byName` mode. These are all valid Blender group names that
`BLI_string_flip_side_name` flips correctly.

**Blender ref**: `reference/blender/source/blender/blenlib/intern/string_utils.cc:243-413`
(`BLI_string_flip_side_name`)

The function recognizes three patterns (in priority order):

1. **Suffix single-char** — any separator in `{'.', ' ', '-', '_'}`
   followed by `l/r/L/R` at end of name. So `.L`, `_L`, `-L`, ` L` (and
   lowercase variants) all flip. The existing SS pairs cover `.L/.R`
   and `_L/_R` but miss `-L/-R` and ` L/ R`.

2. **Prefix single-char** — `l/r/L/R` at position 0 followed by any
   separator. So `L_arm`, `R.hand`, `L-finger`, `L arm` all flip. SS
   `pairGroupNames` only looks at suffixes via `String.endsWith` —
   prefix forms produce zero matches.

3. **Left/Right word** — `left`/`right`/`Left`/`Right`/`LEFT`/`RIGHT`
   at string start or end (case-insensitive search; result case matches
   the found token's case). SS covers `Left/Right` and `left/right` but
   misses `LEFT/RIGHT`.

Current `NAME_PAIRS`:
```js
['_L', '_R'],
['.L', '.R'],
['Left', 'Right'],
['left', 'right'],
```

Missing (non-exhaustive):
- `['-L', '-R']`, `[' L', ' R']` — dash and space separators
- Prefix forms: `L_` / `R_`, `L.` / `R.`, `L-` / `R-`, `L ` / `R `
  (requires checking prefix, not suffix)
- `['LEFT', 'RIGHT']`

**Fix**: Rewrite `pairGroupNames` to call a `flipSideName(name)`
function that implements the same three-pass logic as
`BLI_string_flip_side_name`. Direct port.

---

## LOW

### D-5: `paint.weight_sample_group` (`Ctrl+Shift+X`) not implemented, not documented

**File**: `src/v3/keymap/default.js:268-280`; `src/v3/operators/weightPaint/sample.js` header

**Severity**: LOW — the companion operator to `paint.weight_sample`.
Blender's `blender_default.py:5137`:

```python
("paint.weight_sample_group",
 {"type": 'X', "value": 'PRESS', "ctrl": True, "shift": True}, None),
```

`paint.weight_sample_group` pops a menu of all weight groups present
under the cursor, letting the user pick which group to make active. In
SS, activating a weight group is done via the N-panel dropdown. The
N-panel path is a reasonable substitution in 2D, but `Ctrl+Shift+X` is
unbound and not mentioned as a documented deviation.

**Fix**: Add a comment in `default.js` after the `Shift+KeyX` entry
noting that `Ctrl+Shift+X` (`paint.weight_sample_group`) is not
implemented in v1; the N-panel weight-group dropdown serves the same
function. No chord needed.

---

### D-6: Draw and Blur stroke strength hardcoded at 0.5; Blender reads `brush.alpha`

**Files**: `src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx:225`
(blur: `strength: 0.5`); `:229` (draw: `const STRENGTH = 0.5`)

**Severity**: LOW — in Blender,
`final_alpha = factors[i] * brush_strength * brush_alpha_pressure` where
`brush_alpha_pressure` comes from `brush.alpha` (the brush Strength
slider in the header bar, default 0.5). The hardcoded `0.5` accidentally
matches the Blender default, so first-stroke behavior is correct. But
the user cannot reduce stroke strength below 50% or increase it,
limiting paint-to-black precision and soft-feathering control.

**Blender ref**: `reference/blender/source/blender/editors/sculpt_paint/mesh/paint_weight.cc:1238`
(blur alpha line):

```c
const float final_alpha = factors[i] * brush_strength * brush_alpha_pressure;
```

**Fix** (DOCUMENT-AS-DEVIATION): Add a `brushStrength` field to
`editorStore` (default 0.5, range 0–1), surface it as a slider in the
N-panel "Brush" section alongside the existing Weight and Size sliders,
and pass it as `strength` to both `computeBlurUpdates` and the draw
lerp in `flushPaint`. This is a straightforward one-slider addition
that does not require a schema migration (editor-session state only).

---

### D-7: Sample threshold tied to brushSize; diverges from Blender's fixed constant when brush is small

**File**: `src/v3/operators/weightPaint/sample.js:94-97`

**Severity**: LOW — Blender's `ED_MESH_PICK_DEFAULT_VERT_DIST = 25` px
is defined in `reference/blender/source/blender/editors/include/ED_mesh.hh:662`
as a fixed constant. SS uses `max(8, brushSize/2)`, which equals 25 at
the default `brushSize=50`. At `brushSize < 16` the SS threshold drops
below 8px (the `max` floor), making the eyedropper harder to land than
in Blender. At `brushSize > 50` the threshold grows larger than
Blender's, making it easier — which can cause accidental sampling of a
distant vertex.

**Fix** (DOCUMENT-AS-DEVIATION): The brush-size–linked default is
intentional UX (larger brush → larger eyedropper feel). Add a comment
in `sample.js:94` noting the deviation: `// Blender uses
ED_MESH_PICK_DEFAULT_VERT_DIST = 25 (fixed). SS ties to brushSize/2 so
the eyedropper scales with the cursor. Diverges at brushSize < 16
(floors to 8) and brushSize > 50 (exceeds 25).`

---

### D-8 (DOCUMENT-AS-DEVIATION, already documented): `xMirror` per-Object vs. Blender per-Mesh; `use_mirror_topology` companion not modeled

**File**: `src/store/migrations/v34_weight_paint_settings.js:20-26`

**Severity**: LOW — the migration file already contains a full
explanation of the per-Object vs. per-Mesh deviation and notes that
v1 (one Object = one Mesh) is behaviorally identical. Blender's
companion `use_mirror_topology` flag (topology-based symmetry detection
for the paint symmetry system, distinct from the vertex group mirror
operator's `use_topology`) is also not modeled, but is irrelevant in
2D (no topology-aware spatial index). The existing documentation in
the migration file is sufficient.

**Action**: No further code change needed. Verify the migration file
comment mentions `use_mirror_topology` absence explicitly if not
already present.

---

### D-9 (DOCUMENT-AS-DEVIATION, already documented): `lock_active` not implemented in normalizeAll

**File**: `src/v3/operators/weightPaint/normalize.js:14-24`

**Severity**: LOW — the normalize.js module header already contains the
full deviation explanation: no per-group lock infrastructure, v1
normalizes all groups equally, documented as pending lock
infrastructure. No further action needed.

---

## Source citation table (verified)

| Citation in Phase 7.B | Actual Blender source | Verdict |
|---|---|---|
| `paint_vertex_weight_ops.cc:278` = `PAINT_OT_weight_sample` register | `void PAINT_OT_weight_sample(wmOperatorType *ot)` at line 278 | CORRECT |
| `paint_vertex_weight_ops.cc:172` = `weight_sample_invoke` | `static wmOperatorStatus weight_sample_invoke(...)` at line 172 | CORRECT |
| `blender_default.py:5136` = `Shift+X` for `paint.weight_sample` | `("paint.weight_sample", {"type": 'X', "value": 'PRESS', "shift": True}, None)` at line 5136 | CORRECT |
| `object_vgroup.cc:3219` = `OBJECT_OT_vertex_group_normalize_all` register | `void OBJECT_OT_vertex_group_normalize_all(wmOperatorType *ot)` at line 3219 | CORRECT |
| `object_vgroup.cc:3173` = `vertex_group_normalize_all_exec` | `static wmOperatorStatus vertex_group_normalize_all_exec(...)` at line 3173 | CORRECT |
| `object_vgroup.cc:3707` = `OBJECT_OT_vertex_group_mirror` register | `void OBJECT_OT_vertex_group_mirror(wmOperatorType *ot)` at line 3707 | CORRECT |
| `paint_weight.cc:1149` = `do_wpaint_brush_blur` impl | `static void do_wpaint_brush_blur(...)` at line 1149 | CORRECT |
| `paint_weight.cc:1063` = "Brush type enum (`WPAINT_BRUSH_TYPE_BLUR`)" | Line 1063: `if (ELEM(brush->weight_brush_type, WPAINT_BRUSH_TYPE_SMEAR, WPAINT_BRUSH_TYPE_BLUR))` — NOT the enum definition | WRONG — see D-2 |
| `paint_weight.cc:1562-1583` = brush type dispatch | `wpaint_paint_leaves` switch at 1562; BLUR case at 1579; DRAW at 1582 | CORRECT |
| `paint_weight.cc:1579` = `WPAINT_BRUSH_TYPE_BLUR` dispatch | `case WPAINT_BRUSH_TYPE_BLUR:` at line 1579 | CORRECT |
| `rna_mesh.cc:3243-3247` = `use_mirror_x` property def | `prop = RNA_def_property(srna, "use_mirror_x", ...)` at line 3243; `ui_text` at 3246 | CORRECT (close; 3243-3247 is accurate) |

---

## Keymap companion check (Phase 7.B)

`Shift+X` is unbound in Phases 1–7.A. No collision.

`Ctrl+Shift+X` (`paint.weight_sample_group`) — not bound in SS. See D-5.

No new binding collisions introduced by Phase 7.B.

---

*Verified files: `src/lib/weightPaint/blur.js`, `src/lib/weightPaint/index.js`,
`src/store/migrations/v34_weight_paint_settings.js`,
`src/v3/operators/weightPaint/sample.js`, `src/v3/operators/weightPaint/mirror.js`,
`src/v3/operators/weightPaint/normalize.js`, `src/v3/keymap/default.js`,
`src/v3/operators/registry.js:1547-1630`,
`src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx:208-243`. Reference
files: `reference/blender/source/blender/editors/sculpt_paint/mesh/paint_weight.cc`,
`paint_vertex_weight_ops.cc`, `reference/blender/source/blender/editors/object/object_vgroup.cc`,
`reference/blender/source/blender/blenlib/intern/string_utils.cc`,
`reference/blender/source/blender/makesdna/DNA_brush_enums.h`,
`reference/blender/source/blender/editors/include/ED_mesh.hh`,
`reference/blender/source/blender/makesrna/intern/rna_mesh.cc`,
`reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py`.*
