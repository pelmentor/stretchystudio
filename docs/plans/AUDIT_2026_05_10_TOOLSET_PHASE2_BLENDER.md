# Phase 2 Blender-Fidelity Audit — 2026-05-10

Independent verification of `5b81205` (Toolset Phase 2 — snap-to-grid /
vertex / increment in Modal G/R/S) against actual Blender 5.x source at
`reference/blender/source/blender/`. The progress doc claims "Blender-
faithful"; this audit checks each claim against the upstream source.

## Summary

- **9 divergences from Blender; 5 HIGH (observably wrong to a Blender
  user), 2 MED, 2 LOW.**
- The single biggest finding: the **Shift modifier is wired to the
  wrong concept**. In Blender, `LEFT_SHIFT` = `MOD_PRECISION` (fine-
  grained input — drives 5°→1° snap precision); `LEFT_CTRL` =
  `MOD_SNAP_INVERT` (toggles snap on/off mid-modal). SS Phase 2 uses
  Shift to *engage* snap, which is the opposite of Blender's
  always-on-when-magnet-on model.
- **`SCE_SNAP_SOURCE_*` is misinterpreted.** SS treats it as "snap
  target mode" (where the snap dot lives). Blender treats it as the
  **source-on-the-moving-selection** that lands on the target vertex —
  Closest = nearest selection vertex / bbox corner, NOT "the cursor IS
  the anchor". This makes SS's "closest" path actually a Blender-
  unrelated heuristic ("cursor lands on vertex").
- The grid-default 16 px and rotate-default 15° aren't from Blender
  (Blender 2D is `1.0 / pixel_width` adaptive; 3D is `ED_view3d_grid_view_scale`;
  rotate is **5°** with **1°** precision). The 15° was preserved from
  SS's pre-Phase-2 hard-code; calling it Blender-default in jsdoc /
  plan is wrong.
- Snap-to-rest-verts (vs deformed/visible verts) is a HIGH divergence
  for Pose Mode users — the dot will appear far from where the vertex
  actually is on screen.
- `Shift+S` for the Phase 7.A toolbox conflicts with Blender's "Snap
  Pie Menu" reservation.

## Divergence index

| ID | What | Severity | SS file | Blender ref |
|----|------|----------|---------|-------------|
| D-1 | Shift used to *engage* snap, not as precision modifier | HIGH | `ModalTransformOverlay.jsx:184,216,242` | `transform_snap.cc:1726` (`MOD_PRECISION`); `blender_default.py:6184-85` (Shift→PRECISION) |
| D-2 | Master toggle off ≠ Blender's magnet off | HIGH | `ModalTransformOverlay.jsx:184` (Shift+master-OFF still snaps) | `transform_snap.cc:150-153` (`SCE_SNAP` is the only gate) |
| D-3 | "Closest" target mode misinterpreted as "cursor IS the anchor" | HIGH | `ModalTransformOverlay.jsx:158-162`; `snapMath.js:71-72,86-90` | `transform_snap.cc:1481-1588` (`snap_source_closest_fn` finds nearest selection vertex, not cursor) |
| D-4 | Snap-to-REST verts in Pose Mode (visible vert is deformed) | HIGH | `snapHash.js:23-25,151` (`getMeshVertices` is rest data) | `transform_snap_object_mesh.cc` (snaps to evaluated/visible mesh) |
| D-5 | Modal-R rotation increment default is 15°, Blender's is 5° (with 1° Shift-precision) | HIGH | `preferencesStore.js:85`; `ModalTransformOverlay.jsx:55` | `DNA_scene_types.h:2430-33` (`snap_angle_increment_2d = DEG2RADF(5.0f)`) |
| D-6 | Grid increment default 16 px is fabricated; Blender 2D is `1/pixel_width` adaptive | MED | `preferencesStore.js:83`; jsdoc claims "Blender default" at L62 | `image_draw.cc:583` (`grid_steps_x[step] = 1.0f / pixel_width`); `transform_snap.cc:920` (Clip = 0.125) |
| D-7 | Snap modes don't co-exist (vertex vs grid are gated by Shift, not the bitfield model) | MED | `ModalTransformOverlay.jsx:143-144,184` (mutually exclusive via Shift) | `eSnapMode` is a bitfield (`DNA_scene_types.h:1919-44`); modes coexist, hits ranked by distance |
| D-8 | `Shift+S` claimed-reserved for Phase 7.A toolbox conflicts with Blender's Snap Pie Menu | LOW | `TOOLSET_BLENDER_PARITY_PLAN.md` Phase 7.A | `blender_default.py:1833-35` (`VIEW3D_MT_snap_pie` / `VIEW3D_MT_snap` on Shift+S) |
| D-9 | Snap visualization is a single magenta dot (no source/target distinction, no line, no theme color per snap type) | LOW | `ModalTransformOverlay.jsx:396-422` | `transform_snap.cc:207-489` (`drawSnapping`: source dot + target circle + line + per-type color via `TH_TRANSFORM/SELECT/ACTIVE`) |

## Material divergences (HIGH)

### D-1: Shift is the wrong modifier — Blender uses Shift for PRECISION, Ctrl for SNAP_INVERT

**SS** (`ModalTransformOverlay.jsx:184-191`):
```js
if (kind === 'translate' && !useTyped && shift && !snapVertexHit) {
  const gridInc = snap?.modes?.grid?.enabled ? ... : LEGACY_SNAP_GRID_INCREMENT;
  const snapped = snapDeltaToGrid({ x: dxCanvas, y: dyCanvas }, gridInc);
  ...
}
```
And L216-224 (rotate) and L242-251 (scale) use the same `if (shift)` to
*engage* snap.

**Blender** (`blender_default.py:6184-85`):
```python
("PRECISION", {"type": 'LEFT_SHIFT', "value": 'ANY', "any": True}, None),
("PRECISION", {"type": 'RIGHT_SHIFT', "value": 'ANY', "any": True}, None),
```
And (`blender_default.py:6154-56`):
```python
("SNAP_INV_ON", {"type": 'LEFT_CTRL', "value": 'PRESS', "any": True}, None),
("SNAP_INV_ON", {"type": 'RIGHT_CTRL', "value": 'PRESS', "any": True}, None),
```

`MOD_PRECISION` is consumed in `transform_snap.cc:1726` for snap math:
```c
const float iter_fac = use_precision ? t->increment[i] * t->increment_precision
                                     : t->increment[i];
```
So Shift in Blender = "while snap is on, use the *_precision* increment
(rotate 5° → 1°, grid `1.0` → `0.1`)". It is **not** the on/off switch.

**Why it matters:** A Blender user holding Shift expects fine-grained
input (sub-pixel translate, 1° rotation, 0.5× × scale step). In SS,
holding Shift snaps to 16 px / 15° / 0.1× — coarser, not finer. And in
SS, releasing Shift turns snap off, while in Blender, releasing Shift
just exits precision mode (snap continues).

**Recommended fix:** Either (a) flip `if (shift)` → `if (!shift)` and
make snap always-on when master is on (with Shift driving a precision
factor `value/5`), matching Blender 1:1; or (b) explicitly document
this as "SS divergence: Shift = engage snap (Blender's Magnet-always-
on doesn't fit a modal-only context)" and rename the N-panel slot
"Snap During Transform" to something that doesn't claim Blender parity.
Option (a) is the only Rule №1-compliant choice.

---

### D-2: Master `enabled = false` still allows Shift to snap (legacy fallback path)

**SS** (`ModalTransformOverlay.jsx:184-191`):
```js
if (kind === 'translate' && !useTyped && shift && !snapVertexHit) {
  const gridInc = snap?.modes?.grid?.enabled
    ? (snap.modes.grid.increment > 0 ? snap.modes.grid.increment : LEGACY_SNAP_GRID_INCREMENT)
    : LEGACY_SNAP_GRID_INCREMENT;
```
This branch fires regardless of `snap.enabled` (the master toggle).
The master is *only* consulted by the vertex-snap branch (L143-144).
Shift+G with master off still snaps to either `grid.increment` or the
legacy 10 px.

**Blender** (`transform_snap.cc:150-153`):
```c
bool transform_snap_is_active(const TransInfo *t)
{
  return (t->tsnap.flag & SCE_SNAP) != 0;
}
```
And `transform_snap_increment_ex` first checks
`transform_snap_is_active(t)` before applying any increment. When the
magnet is off (`SCE_SNAP` flag clear), neither grid nor increment snap
fires.

**Why it matters:** SS's master toggle reads as "vertex snap on/off";
grid + increment are governed only by their per-mode flags AND Shift.
A Blender user expecting "magnet off = no snap of any kind" gets grid
snap on Shift anyway — UX dissonance.

**Recommended fix:** Master toggle should gate ALL snap modes, not
just vertex. Either drop the legacy fallback (vertex/grid/increment
all release on master-off) or rename master "Auto-snap to vertex"
since that's all it actually controls.

---

### D-3: "Closest" target mode is implemented backwards

**SS** (`ModalTransformOverlay.jsx:158-162`):
```js
// 'closest' target: the cursor IS the anchor. Other target modes
// (center/median/active) override the anchor with selection
// geometry; deferred to a follow-up — modal currently uses
// 'closest' regardless.
```
And `snapMath.js:71-72`:
```js
* - `closest`: returns `opts.cursor` (the cursor IS the anchor).
```

**Blender** (`transform_snap.cc:1481-1588`, `snap_source_closest_fn`):
```c
static void snap_source_closest_fn(TransInfo *t)
{
  ...
  /* Object mode. */
  if (t->options & CTX_OBJECT) {
    FOREACH_TRANS_DATA_CONTAINER (t, tc) {
      tc->foreach_index_selected([&](const int i) {
        ...
        for (j = 0; j < 8; j++) {       /* iterate bbox corners */
          ...
          dist = t->mode_info->snap_distance_fn(t, loc, t->tsnap.snap_target);
          if ((dist != TRANSFORM_DIST_INVALID) &&
              (closest == nullptr || fabsf(dist) < fabsf(dist_closest))) {
            copy_v3_v3(t->tsnap.snap_source, loc);
            ...
          }
        }
      });
    }
  }
```
And `rna_scene.cc:94`:
```c
{SCE_SNAP_SOURCE_CLOSEST, "CLOSEST", 0, "Closest", "Snap closest point onto target"},
```

The Blender semantics: `Closest` finds the **vertex/bbox-corner of the
selection that is geometrically closest to the snap target**, then
translates the whole selection so that point lands ON the target. The
cursor is irrelevant.

In SS, `Closest` means "the cursor lands on the snap target". If the
selected mesh's centroid is 100 px away from the cursor, the SS
behavior leaves the centroid 100 px away from the snap target, while
Blender's behavior puts the nearest selection vertex exactly ON the
target.

**Why it matters:** This is the *default* snap target mode (Blender
ships `SCE_SNAP_SOURCE_CLOSEST` as the default — see
`DNA_scene_types.h:2350`). A Blender user expecting "drag handle near
vertex X, snap-source-closest" won't see the selection move with the
expected offset.

The plan §2.C also calls it "the cursor IS the anchor" claim it is
"Blender's default" (`preferencesStore.js:78`). Both wrong.

**Recommended fix:** Implement `Closest` correctly: enumerate the
selection's vertex set (or bbox corners for Object Mode), find the
member nearest the snap target's canvas-px position, and emit
`delta = snapTarget - selectionMember`. This requires the selection-
vertex enumeration that the progress doc says is "deferred"; without
it, `closest` is misnamed. Until then, rename to `Cursor` (which is
what it actually does) and add a separate `Closest` entry that's
properly gated until implemented.

---

### D-4: Snap-to-REST-verts breaks Pose Mode visibly

**SS** (`snapHash.js:22-25, 151`):
```js
* "Rest verts" means `node.mesh.vertices` (canvas-px), not the live
* deformed verts. Per plan §2.C — snap-to-rest is the contract;
* snap-to-deformed is a future follow-up if Pose Mode use cases
* demand it.
```
And L151 in `buildSnapHash`:
```js
const verts = normaliseVerts(getMeshVertices(node, project));
```
where `getMeshVertices(node, project)` returns `getMesh(node, project)?.vertices`
(`objectDataAccess.js:243-245`) — i.e. `node.mesh.vertices`, the rest
data. No `evalRig` / `chainEval` / `boneSkinning` is called.

**Blender** snaps to the **evaluated** mesh (`transform_snap_object_mesh.cc`
reads BMesh after evaluator/modifier stack). The visible deformed
vertex IS the snap target.

**Why it matters:** In SS Pose Mode, the user sees a deformed mesh on
screen. They drag the cursor near a vertex they SEE, expect a snap
dot. The dot appears at the vertex's REST canvas-px position — which
can be 50+ px away from where it actually is on screen if the bone
that owns it has been rotated. The user moves the cursor toward the
dot, the dot is on top of empty canvas.

**Worse:** the snap delta lands the selection on the rest-vert
position, not the visible-vert position. So the modal commit visibly
lands NOT on the vertex the user thought they were snapping to.

**Recommended fix:** In Pose Mode, build the snap hash over evaluated
vertices (call `evalProjectFrameViaDepgraph` or `boneSkinning` to get
post-deformation positions). Outside Pose Mode (Edit Mode + Object
Mode where there's no live deformation), rest is fine. Gate the build
path on `editorStore.editMode === 'pose'` or check whether any bone
in the project has non-identity pose.

---

### D-5: Rotation increment default is 15°, Blender's is 5°

**SS** (`preferencesStore.js:85`):
```js
increment: Object.freeze({ enabled: false, value: 15 }),
```
With jsdoc at L70-74:
```js
* - `modes.increment` (default `enabled:false, value:15`): when
*   `enabled` is true, replaces the legacy 15° (rotate) and 0.1
*   (scale) Shift snaps. `value` is the rotation step in degrees;
```

**Blender** (`DNA_scene_types.h:2430-33`):
```c
float snap_angle_increment_2d = DEG2RADF(5.0f);
float snap_angle_increment_2d_precision = DEG2RADF(1.0f);
float snap_angle_increment_3d = DEG2RADF(5.0f);
float snap_angle_increment_3d_precision = DEG2RADF(1.0f);
```

Blender's default rotation snap is **5°**, with **1°** when Shift
(precision) is held. SS preserves the pre-Phase-2 SS-internal hardcode
of 15° and calls it "the default" — implying parity it doesn't have.

**Why it matters:** Phase 2 specifically claims to ship "Blender-
faithful" defaults. A Blender user moving from Blender to SS rotates a
bone with R+15+15+15+15 in SS where they'd type R in Blender and feel
the discrete 5° clicks. The 0.1× scale-step also doesn't match
Blender's `_precision = 0.5f` default (image editor; see
`transform_snap.cc:917`).

**Recommended fix:** Either (a) ship 5° as the increment default
(Blender parity), with a separate "precision = `value/5`" Shift-
modifier behavior; or (b) keep 15° and remove the "Blender's default"
language from the jsdoc + plan + progress doc.

---

## Cosmetic divergences (LOW/MED)

### D-6: 16 px grid default not from Blender (MED)

`preferencesStore.js:62`: jsdoc claims "Default 16 matches Blender's
default grid". Blender's image-editor grid default is **adaptive** via
`ED_space_image_grid_steps` (`image_draw.cc:561-590`), with steps
following `1.0 / pixel_width`. The clip editor uses `0.125`
(`transform_snap.cc:920`); the node editor uses
`space_node::grid_size_get()`. 16 px does not appear as a Blender
default anywhere in the snap subsystem.

The plan doc says 16 px and the progress doc copies it. Source of the
number isn't traceable to Blender — it appears to be a SS choice (the
pre-Phase-2 SS hardcode was 10 px; the bump to 16 was speculation).

Fix: drop "Blender default" from the jsdoc; either ship Blender's
adaptive `1.0 / pixel_width` model or document 16 px as a SS default.

### D-7: Snap modes don't co-exist (MED)

In Blender, `t->tsnap.mode` is a bitfield —
`SCE_SNAP_TO_VERTEX | SCE_SNAP_TO_EDGE | SCE_SNAP_TO_GRID` are all
simultaneously valid; the snap evaluator picks the closest hit per
tick (`transform_snap.cc:1317-1346`). User can have all four modes on
and the system picks "whichever wins this frame".

In SS, vertex snap fires only when `!shift && master.on && vertex.on`,
grid fires only when `shift && grid.on`, increment fires only when
`shift && increment.on` (rotate/scale). They're mutually exclusive by
modifier intent. A user wanting "snap to vertex if there's one nearby,
otherwise snap to grid" needs to alternately tap Shift mid-drag — not
possible in Blender (bitfield).

Fix: drop the Shift gating, keep all per-mode toggles, and pick the
nearest hit per tick (vertex within `threshold` wins; else grid; else
free). Sister to D-1 — same root cause (Shift used as an engagement
modifier instead of a precision modifier).

### D-8: Shift+S reservation conflicts with Blender Snap Pie Menu (LOW)

`blender_default.py:1833-35`:
```python
op_menu_pie("VIEW3D_MT_snap_pie", {"type": 'S', "value": 'PRESS', "shift": True})
op_menu("VIEW3D_MT_snap", {"type": 'S', "value": 'PRESS', "shift": True})
```

The plan reserves Shift+S for the Phase 7.A Object Mode toolbox. A
Blender user pressing Shift+S in SS expects the Snap Pie Menu (snap
selection to cursor / cursor to selection / selection to grid /
cursor to world origin / etc.). Phase 7.A would steal that.

Fix: reserve a different binding for the Phase 7 toolbox (Blender's
T-panel toggle is `T`, the N-panel is `N`; `Shift+S` is purely the
snap menu). Recommend `B` already taken (box-select)... `Shift+B`
reserved for fly nav... `Q` for quick favourites... any non-Blender-
reserved key works.

### D-9: Snap visualization minimal (LOW)

SS shows a single magenta dot at the snap-target position. Blender's
`drawSnapping` (`transform_snap.cc:207-489`):
- Target dot in `TH_TRANSFORM` color (purple-ish)
- Source dot in `TH_SELECT` color (orange) when `T_DRAW_SNAP_SOURCE`
- A line from source to target showing the snap delta
- Active snap point in `TH_ACTIVE` (yellow) when multi-point snap

SS's dot is the bare minimum. No source indicator (the user can't see
WHICH vertex of their selection lands on the target — relevant in
Closest mode, see D-3), no line, no per-type color (so vertex vs
grid-snap visually identical). For a phase shipping "snap with N-panel
config", no visualization for the grid-snap case at all.

Fix: low priority post D-3 fix. Once Closest works correctly, also
draw the source-vertex dot + line. Per-type color (vertex = magenta;
grid = blue) is polish.

## Plan-level concerns

The plan doc + progress doc make several Blender-fidelity claims that
this audit found unsupported:

1. **§2.A "default 16 (Blender default)"** — not from Blender; see D-6.
2. **§2.A "Blender's 1° = 0.01× convention"** for scale snap — Blender's
   scale snap precision is `0.5f` (`transform_snap.cc:917`) for the
   image editor; there's no 1°-to-0.01× mapping anywhere in Blender.
   This is a SS invention dressed in Blender vocabulary.
3. **§2.A "`closest` … the cursor IS the anchor (simplest, Blender's
   default)"** — wrong on both counts; Blender's "closest" is the
   nearest selection vertex, not the cursor (D-3).
4. **§2.B "Replaces the current `Math.round(delta / 10) * 10`"** —
   the math is a *delta-grid* round, but Blender's `snap_increment_apply`
   is **absolute-grid** (`transform_snap.cc:1733`):
   `r_out[i] = iter_fac * roundf(loc[i] / iter_fac);`
   SS rounds the delta (so 17 px drag → 16 px move when grid=16);
   Blender rounds the absolute position so dragging from 7 px → 23 px
   gives a 16 px move that aligns 23 to grid. Different math, different
   feel.
5. **§2.D "currently fixed at 15°"** — pre-Phase-2 SS hardcode. The
   "preserve legacy" pattern is fine, but tagging it as the new
   "Blender-faithful default" via `preferencesStore.js` jsdoc / plan
   text is misleading.
6. **§2.E "N-panel snap section"** — N-panel placement is sensible
   (Blender does this for snap *settings* via Properties shelf); but
   Blender ALSO surfaces snap on the 3D viewport header (the magnet
   icon click → mode toggles). SS only has the N-panel surface, so the
   "magnet icon" affordance is missing entirely. Less a divergence than
   a UX gap.
7. **Plan §7.A Shift+S** — direct conflict with Blender Snap Pie
   Menu. Replan binding.

## Recommendations

### HIGH — fix before manual gate (Phase 2.G)

1. **D-1 / D-7**: Drop Shift-as-engagement model. Make snap always-on
   when master is on; let modes coexist via bitfield (vertex within
   threshold wins; else grid if enabled; else nothing). Use Shift as
   precision modifier (rotate increment ÷ 5 → 1°/3°; grid increment
   ÷ 10).
2. **D-2**: Master toggle gates ALL modes, not just vertex.
3. **D-3**: Either implement `Closest` correctly (find nearest selection
   vertex to target, emit delta = target − that vertex), OR rename it
   to `Cursor` and add a properly-gated `Closest` entry. The current
   wiring lies about Blender parity.
4. **D-4**: In Pose Mode, build snap hash over deformed verts (post-
   evalRig / boneSkinning), not rest. Or gate snap-to-vertex off in
   Pose Mode entirely until this lands.
5. **D-5**: Either ship 5° as the rotate-increment default (and 1° as
   precision step), or strip "Blender default" claims from doc text.

### MED — defer

- **D-6**: 16 px is a SS choice, not Blender. Keep but fix doc.
- **D-7**: Mode coexistence is a sister of D-1; one fix lands both.

### LOW — defer

- **D-8**: Phase 7.A binding pick is a Phase 7 problem; flag now.
- **D-9**: Visualization polish lands after D-3.

### Plan-doc text fixes (no code change)

Strip "Blender's default", "Blender-faithful", "matches Blender" from:
- `TOOLSET_BLENDER_PARITY_PLAN.md` §2.A (16 px), §2.D (15°)
- `TOOLSET_PHASE_2_PROGRESS.md` (same callouts)
- `preferencesStore.js` SNAP_DEFAULT jsdoc (L62, L74, L78)

Replace with honest "SS default chosen for [reason]" notes.
