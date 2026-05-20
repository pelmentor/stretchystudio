# Plan — Warps as first-class Lattice/Grid-Mesh Objects (Blender parity)

**Status:** PLANNED — not started. Massive refactor, scheduled for a
dedicated session. Written 2026-05-20 at the user's request after the
edit-mode / rig-discoverability work surfaced how unintuitive the current
abstract-warp model is.

**One-line goal:** make warp deformers **actual editable grid-mesh /
lattice objects** in the scene, and make the part↔warp relationship an
**explicit modifier on the affected piece that references the warp object**
(and declares its targets) — mirroring how Blender's **Lattice modifier**
(`MOD_lattice`) / **Mesh Deform** (`MeshDeformModifierData`) work, instead
of the current implicit hierarchy + opaque deformer node.

---

## Why (user's framing)

> "We need the warp objects to be actual mesh objects, MIMICKING WHAT
> BLENDER does. It needs to be a grid mesh object with a warp deformer
> MODIFIER applied to it, and the pieces which get affected by the warp
> grid mesh/object via warp modifier ARE selected inside the modifier."

The trigger: a user trying to fix "legwear floats during BodyAngleZ" went
to the **legwear part's** properties and found nothing — because in the
current model the deforming warp is an *ancestor deformer node*, not
something the part visibly owns. The mental model the user expects (and
Blender provides) is: a **visible cage object** you can select and edit,
and on each deformed piece a **modifier** that names that cage. The cage IS
a mesh you edit in Edit Mode.

This also dovetails with the session's edit-mode work: editing a warp
grid-object's vertices would reuse the **Edit-Mode mesh editing** +
**exit→refit re-derivation** path shipped this session (`35668fb`).

---

## Current architecture (what exists today)

- **Warp = abstract deformer node.** `project.nodes` entry
  `{ type:'deformer', deformerKind:'warp', gridSize:{rows,cols},
  baseGrid:Float64Array (control points), localFrame, bindings:[{parameterId,
  keys, interpolation}], keyforms:[{keyTuple, positions:Float64Array,
  opacity}], parent:<nodeId>, targetPartId?, canvasBbox? }`. The grid is a
  flat control-point array, NOT a mesh with triangles/edges.
  Source of truth: `selectRigSpec._warpNodeToSpec`
  ([src/io/live2d/rig/selectRigSpec.js:904](../../src/io/live2d/rig/selectRigSpec.js)).
- **Part ↔ warp link is dual:** (a) the part's Blender-style
  `modifiers[]` stack may carry a warp modifier `{ type:'warp',
  deformerId, enabled, mode, synthetic? }`; AND/OR (b) the part is a
  hierarchy descendant of the warp (ancestor chain), which is how the
  *legwear* case resolves (its `modifiers[]` showed only an Armature; the
  body warp is an ancestor, not a stack entry). This duality is the root
  of the discoverability gap.
- **Eval:** parts' canvas-px verts are projected into the warp's local
  frame (normalised 0..1 of the warp's lifted-rest bbox), then bilinearly
  interpolated through the warp grid; the deformed grid per frame is the
  cellSelect-blended keyforms. Lives in the depgraph warp kernels
  (`src/anim/depgraph/kernels/gridLift.js`, `keyform.js`, `matrix.js`) +
  classic `chainEval` (`runtime/evaluator/warpEval.js`,
  `cubismWarpEval.js`).
- **Grid editing UI:** `WarpDeformerOverlay` draws + drags the lattice
  control points on canvas (not an Edit-Mode mesh).
- **Keyform editing:** `DeformerKeyformsSection` (Properties) → set bound
  param → "Edit keyform" → drag handles. Per the discoverability deep-link
  added this session, a part's Modifier Stack rows jump to the deformer's
  keyform editor — but only for deformers in the part's own `modifiers[]`,
  NOT ancestor warps.
- **Export:** `cmo3writer` / `moc3writer` emit warps as Cubism
  `CDeformerSurface` (control-point grid + per-keyform positions). Byte
  fidelity is regression-gated (Hiyori/Shelby).

## Target architecture (Blender Lattice-modifier parity)

1. **Warp becomes a grid-mesh / lattice OBJECT** — a real, selectable,
   Edit-Mode-editable node whose geometry IS the grid (rows×cols control
   points as mesh vertices, with row/col edges). Visible in the Outliner
   as an object, editable like any mesh (drag verts in Edit Mode → reuse
   this session's edit path).
2. **Affected pieces carry an explicit warp/lattice modifier** that
   *references the warp object* (Blender: Lattice modifier `object` field).
   The set of affected pieces is **declared in the modifier / on the warp
   object** ("selected inside the modifier"), not implied by hierarchy.
   Optional vertex-group-style limit (Blender's modifier `vertex_group`).
3. **Deformation states (keyforms) become shape-keys on the grid object** —
   the grid object's per-param deformation is stored like shape keys
   (Basis + param-bound keys), consistent with how art-mesh keyforms +
   shape keys already work. Editing a keyform = editing the grid object's
   shape at that param value.

---

## Gap analysis — systems touched (all of these)

1. **Data model / schema + migration.** New object node type (or repurpose
   `deformer/warp`) carrying real mesh geometry (vertices/edges/triangles)
   + shape-key-style keyforms. A schema-version migration must convert
   every existing warp deformer (baseGrid + keyforms) into the new
   grid-object form **losslessly** AND rewrite each affected part's
   relationship into an explicit modifier reference. Honour Rule №2 (no
   staged-but-dead migration; no shims).
2. **Rig eval (selectRigSpec + depgraph kernels + chainEval).** The warp
   grid must be read from the object's mesh vertices instead of `baseGrid`;
   the lifted-rest bbox + bilinear projection adapt to grid-as-mesh. The
   per-part chain walk resolves the warp via the explicit modifier
   reference, not the ancestor pointer. Side-by-side parity (depgraph ≈
   chainEval ≈ pre-refactor) must hold <1e-4px.
3. **Modifier stack UI** (`ModifierStackSection`). Warp modifier rows gain
   an **object picker** (which grid object) + a **targets / vertex-group**
   control, mirroring Blender's Lattice modifier panel. The session's
   "Edit deformation" ◇ deep-link generalises to "select the referenced
   grid object."
4. **Outliner / selection.** Warp grid objects appear as first-class
   selectable objects (their own icon); selecting one shows mesh +
   shape-key + transform sections.
5. **Edit Mode.** Entering Edit Mode on a warp grid object edits the cage
   verts (reuse PP1-008(b) live-edit + the exit→`refitAll` re-derivation).
   The Smooth/Brush tools work on the cage.
6. **Grid-editing overlay.** `WarpDeformerOverlay` either retires in favour
   of normal mesh Edit-Mode editing, or becomes the "show cage while
   deforming children" overlay (Blender shows the lattice in object mode).
7. **Node Tree.** The rig tree gains a real **Lattice/Warp modifier node**
   that references the grid object (and currently *also* needs to stop
   skipping armature modifiers — see the separate gap below).
8. **Export (moc3 / cmo3).** The Cubism writers must still emit
   `CDeformerSurface` (control-point grid + keyform positions) derived from
   the grid object's mesh + shape keys. **Highest-risk area** — byte
   fidelity vs Hiyori/Shelby must not regress. The internal representation
   changes; the wire format must not.
9. **Auto-rig.** The rig generators that currently synthesise warp
   deformer nodes (`bodyWarpChain`, `rigWarps`, `faceParallax`) must emit
   grid objects + modifier references instead.

---

## Open design decisions (resolve at session start)

- **New node type vs repurpose.** Add `type:'object', objectKind:'lattice'`
  (clean Blender mapping) vs extend the existing `deformer/warp` node with
  mesh geometry. Trade-off: clean model vs migration blast radius.
- **Targets: warp-declares-pieces vs piece-declares-warp.** Blender is
  piece-declares (each mesh's Lattice modifier names the lattice). The
  user said "pieces selected inside the modifier," which could mean the
  warp object lists its targets. Pick one canonical direction (Blender's
  piece-declares is the faithful default; a warp-side target list can be a
  derived convenience view).
- **Keyforms as shape keys.** Confirm the grid object's per-param
  deformation maps cleanly onto the existing shape-key / keyform substrate
  (it should — keyforms already are param-bound vertex-position sets).
- **Lattice (control grid) vs Mesh Deform (arbitrary cage).** Cubism warps
  are regular rows×cols grids → Blender **Lattice** is the closest analog.
  Keep the grid regular (don't open arbitrary-topology cages) to preserve
  Cubism export.
- **Migration reversibility / one cmo3 round-trip** to prove no fidelity
  loss before flipping the default.

## Suggested phasing (next session)

0. **Spec + byte-fidelity gate.** Capture current warp export bytes
   (Hiyori + Shelby) as the regression oracle BEFORE touching anything.
1. **Substrate.** New lattice-object node + schema migration (warp node →
   grid object + per-part modifier reference), behind read-paths only.
2. **Eval.** Point selectRigSpec + depgraph + chainEval at the grid object;
   side-by-side parity vs pre-refactor.
3. **UI.** Outliner object + Modifier-stack object picker + Node Tree
   lattice node + Edit-Mode cage editing.
4. **Export.** Re-derive `CDeformerSurface` from the grid object; byte-diff
   vs the Phase-0 oracle until clean.
5. **Auto-rig.** Generators emit grid objects + modifier refs.
6. **Cleanup.** Retire the abstract warp node + the dual hierarchy/modifier
   link (Rule №2: delete, don't shim).

## Risks
- **Export regression** (Cubism wire format) — the dominant risk; gate with
  the Phase-0 byte oracle.
- **Eval rewrite** touching the hottest path (per-frame warp deform) — keep
  the side-by-side harness green throughout.
- **Migration of existing user rigs** — must be lossless + irreversible-safe.
- **Scope creep** — Lattice parity only; resist arbitrary-cage Mesh Deform.

---

## Related (smaller, can land independently first)
- **Node Tree skips armature modifiers** ([anim/nodetree/build.js:89](../../src/anim/nodetree/build.js)
  — `continue` when no `deformerId`), so bone-bound parts (e.g. legwear)
  render as an empty `Part Input → Part Output`. Add an Armature/bone
  modifier node so the rig tree is honest. Cheap; not gated on this refactor.
- **Ancestor-deformer discoverability** — a part's panel could list the
  *ancestor* deformers that affect it (not just its own `modifiers[]`),
  with the same jump-to-keyform link. Offered to the user; pending. The
  lattice refactor makes this moot for warps (they become explicit
  modifier refs) but still relevant for the transition.
