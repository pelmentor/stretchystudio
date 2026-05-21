# Plan — Warps as first-class Lattice/Grid-Mesh Objects (Blender parity)

**Status (2026-05-21):** ALL PHASES SHIPPED. Warps ARE first-class Lattice
objects end-to-end — persisted, evaluated, exported, auto-rigged, AND surfaced
in the editor UI (Outliner row + Grid3x3 icon, selectable, Properties
deformer/keyform sections, Modifier-Stack object-picker + jump, Node Tree,
Edit-Mode cage entry with rows×cols topology guards). **One caveat:** the
on-canvas cage-vertex DRAG + visual rendering + Properties-panel appearance
were NOT browser-verified this session (no browser) — the structural path is
open and all logic is unit-tested, but the actual interaction needs an
in-browser pass. See "Phase 3 — SHIPPED" below.

Shipped commits:
- **Phase 0** (`f6cedd7`) — byte-fidelity gate (oracle `f50b6178`).
- **Slice 1.A** (`c822b02`+`ee9c741`) — classifier seam.
- **Slice 1.B** (`6852deb`) — the data-model flip: v43 migration; oracle stays
  `f50b6178` (migrate→select lossless). + Blender-mechanics doc (`5fc7d99`).
- **1.B dual-audit fix** (`85b4f43`) — lattice-aware re-seed + cage cleanup.
- **Phase 5** (`541176a`) — auto-rig SEEDERS emit lattice objects (shared
  `warpNodeToLatticeNodes` converter; `upsertWarpAsLattice`); removes the
  persisted dual-shape coexistence. Threaded `project` into `nodeToWarpSpec`
  (fixed a latent cmo3-export break for migrated projects) + preserved the v21
  `synthetic` marker through the warp→lattice modifier rewrite.
- **Phase 6** (`dff5405`) — per-part modifier chains made lattice-correct in
  selectRigSpec (`_modifierRefId`); seam doc reconciled (the `deformer/warp`
  arm is RETAINED-by-design as the transient export interchange — see below).
- **Phase 4** — CONFIRMED (no code): export reads warps via the resolvers
  (now `project`-threaded) + the oracle-pinned `selectRigSpec().warpDeformers`;
  the per-mesh `mesh_verts` IDW path is separate and untouched.
- **Phase 5/6 dual-audit fix** (`ecf527c`) — NeckWarp seeder → lattice;
  param-cascade (remove/rename) + paramReferences orphan-scan made
  lattice-aware. Blender-fidelity audit PASS (cites byte-verified).

Massive refactor; written 2026-05-20 after the edit-mode / rig-discoverability
work surfaced how unintuitive the abstract-warp model was.

## Phase 6 — REFRAMED: the `deformer/warp` shape is NOT dead

The original Phase 6 ("drop the `deformer/warp` arm from `isWarpLatticeNode`")
is **architecturally incorrect** and was NOT done. The export adapter
(`synthesizeDeformerNodesForExport`) inflates each persisted Lattice object
into a TRANSIENT `deformer/warp` node so the moc3/cmo3 wire emitters consume
the control-grid form unchanged (`_warpNodeToSpec`); `selectRigSpec` overlays
those synth nodes into its `nodeById` and resolves parent refs through the
seam. So the arm is LIVE export infrastructure, mirroring how Blender's Lattice
evaluates into a transient deformation the exporter reads (the persisted
datablock is the lattice). Dropping it would require re-architecting the
byte-fidelity-critical export path onto lattice objects directly — high risk,
zero user benefit. Retained-by-design ≠ Rule-№2 baggage.

## Phase 3 — SHIPPED (2026-05-21, `69d4e0c` + `9e6c71d` + `4a48ace`)

All the pre-flip `type:'deformer'` / `mod.deformerId` consumers were made
lattice-aware. A canonical `modifierRefId(mod)` helper (seam) is the single
source of truth (objectId for lattice, deformerId else).
- **Depgraph + Node Tree per-part modifier handling** (`build.js`,
  `kernels/artMesh.js`, `kernels/geometry.js`, `modifierTypeInfo.js` [+ `lattice`
  MODIFIER_TYPES entry], `nodetree/build.js`) — all via `modifierRefId`. Warps
  already rendered (implicit-parent fallback); now per-part modifier-DISABLE is
  honored for lattice too. `test_depgraph_lattice.mjs` (10) pins legacy↔lattice
  byte-parity + the disable behaviour.
- **Outliner** (`treeBuilder.js`, `TreeNode.jsx`) — lattice objects are rows
  (Grid3x3 icon, `isLattice` flag); cage `meshData` stays hidden. +5 asserts.
- **Selection** (`selectionStore` SelectableType += `'object'`; `OutlinerEditor`
  routing) + **Properties** (`sectionRegistry` routes the 3 deformer sections
  for `type:'object'`; `DeformerInfo/Bindings/Keyforms` use `isChainDeformerNode`)
  + **Modifier-Stack object-picker** (`ModifierStackSection` shows the cage
  object name + ◇ jumps to `{type:'object'}`).
- **Canvas overlay** (`WarpDeformerOverlay`) — selecting a lattice object
  highlights its grid + arms the keyform-edit drag (`activeDeformerId` now
  matches `'object'`). PropertiesEditor breadcrumb shows the name + 'warp' label.
- **Edit-Mode cage** — `getDataKind`→'mesh' for lattice unlocks Edit Mode; the
  canvas edit-path `selNode` resolution accepts cages (`getMesh` already
  resolves the cage via `dataId`). **Topology HARD-BLOCKED** on cages
  (rows×cols invariant): guard in `applyTopologyOp` (subdivide/merge/dissolve/
  extrude) + the add/remove-vertex tool handlers. Moving control points stays
  allowed.

**NOT browser-verified this session (no browser):** the actual on-canvas
cage-vertex DRAG + visual rendering + Properties-panel visual appearance. The
structural path is open and all logic is unit-tested + typecheck-clean, but a
real in-browser pass is owed before declaring the UX done.

**Deliberately NOT done (out of scope / consistent with pre-flip):**
delete/duplicate of a lattice object via the viewport operators (warps-as-
deformers were never delete/duplicate-able there either; would be a NEW feature
and must clean the cage meshData if added). Library-save deformer-count log
undercounts lattice objects (cosmetic).

**One-line goal:** make warp deformers **actual editable grid-mesh /
lattice objects** in the scene, and make the part↔warp relationship an
**explicit modifier on the affected piece that references the warp object**
(and declares its targets) — mirroring how Blender's **Lattice modifier**
(`MOD_lattice`) / **Mesh Deform** (`MeshDeformModifierData`) work, instead
of the current implicit hierarchy + opaque deformer node.

---

## How Blender ACTUALLY does it (the canonical mechanics) — and SS's mirror

Verified against the Blender clone (`reference/blender/`). This is the
ground-truth answer to "where do the modifiers sit, and does the cage carry
editable blendshapes that params drive?"

### 1. The modifier sits on the AFFECTED piece, NOT on the lattice

In Blender the **deformed mesh object** owns the *lattice* modifier; the
**lattice object** owns only geometry and carries no *lattice* modifier of
its own and no target list. (Strictly, any Blender object *can* carry a
modifier stack — the point is the lattice doesn't *need* one for this role:
it's the cage, not a deformed piece.)

- The Lattice modifier is an entry in the *deformed mesh's* modifier stack
  (`Object.modifiers`, a `ListBase<ModifierData>`). Its struct
  `LatticeModifierData = { ModifierData modifier; Object *object; char
  name[64]; float strength; ... }` (`DNA_modifier_types.h:282-292`) carries
  `->object` = a pointer to the lattice object. `MOD_lattice.cc`'s
  `foreachIDLink` walks ONLY `lmd->object` — the modifier reaches *out* to
  the cage; the cage never reaches back.
- The `Lattice` data-block (`DNA_lattice_types.h:55-91`) holds the grid
  (`pntsu/pntsv/pntsw`, `BPoint *def`) + `Key *key` (shape keys). It has
  **no** list of "objects I deform." So the relationship is **piece-declares-
  warp**: each affected mesh picks its cage in its own modifier panel
  (`MOD_lattice.cc` UI `object` picker). One cage, many pieces pointing at it.

So, answering directly: **the modifiers live on the layer pieces (the things
being deformed), referencing the warp/lattice object. NOT on the warp
objects.** The warp objects carry no modifier — they're pure cage geometry +
shape-keys.

**SS mirror (shipped in 1.B / v43):** each affected `part` gets
`modifiers[] += {type:'lattice', objectId}` (Blender's `lmd->object`); the
lattice object (`{type:'object', objectKind:'lattice'}`) holds the cage +
keyforms and carries no modifier. No target list is stored on the lattice (a
warp-side "which pieces do I affect?" view is *derived* on demand, never
persisted — a stored second list would be a dual source of truth).

### 2. The cage HAS editable shape-keys, and params drive their blend

Yes. A Blender Lattice can carry shape keys: `Lattice.key` →
`Key`/`KeyBlock` (`DNA_key_types.h`). The **Basis** KeyBlock is the rest
cage; each additional `KeyBlock` is a full deformed-cage vertex set
(`KeyBlock.data`, `totelem`), relative to the Basis (`KeyBlock.relative`,
`Key.refkey`). A relative shape key is driven by a scalar weight
`KeyBlock.curval` (0..1), animated by an fcurve/driver — so a parameter (via
a driver) blends the cage between Basis and the shape.

**SS mirror (the substrate is in place after 1.B; the editing UI is Phase 3):**
- The cage's **rest** (= Basis) is the lattice object's linked
  `meshData.vertices` — a real mesh, editable in Edit Mode (Phase 3 reuses
  the existing exit→refit path).
- The cage's **per-parameter deformed shapes** are the object's `keyforms[]`
  — each keyform is a full control-point set = a KeyBlock.
- **What drives them:** the object's `bindings[]` (`parameterId` → key
  positions) + each keyform's `keyTuple`. SS blends keyforms by `cellSelect`
  over the bound parameter values. This is an **N-dimensional** generalisation
  of Blender's 1-D `curval` weight (Cubism/SS warps blend over a parameter
  *tuple*, e.g. AngleX×AngleY); Blender has no native N-D keyform grid, so SS
  keeps its own param-binding layer rather than collapsing to a single scalar.

> **One structural difference from Blender (not a bug):** Blender's Basis is
> itself the *first* KeyBlock (`Key.refkey = key->block.first`), and
> `Lattice.def` is a transient edit buffer. SS instead stores the Basis as the
> standalone cage `meshData.vertices` and the keyforms as a separate
> `keyforms[]` array — i.e. Basis is NOT `keyform[0]`. This matches how SS's
> eval/export pipeline already treats `baseGrid` + `keyforms` as distinct, and
> doesn't affect fidelity.

So: **the warp/lattice object owns editable "blendshapes" (the keyforms =
shape keys; the editable rest cage = Basis), and the bound parameters drive
which blend is active.** Editing a keyform = editing the cage's shape at that
parameter value. The deformation then flows: param → cage shape-key blend →
the pieces' lattice modifier → the pieces' vertices bilinearly warped.

### 3. One-line direction summary

- **Modifier** → on the **affected pieces** (layer pieces), referencing the
  warp object.
- **Geometry + shape-keys (keyforms)** → on the **warp/lattice object**; it
  has no modifier of its own.
- **Parameters** → drive the warp object's shape-key blend; the result
  deforms the pieces through their lattice modifier.

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

## Design decisions — RESOLVED 2026-05-20

Resolved via a Blender-fidelity agent reading `reference/blender/` (DNA
structs + `MOD_lattice.cc`). Decisions are now binding for Phase 1+.

1. **New node type, NOT repurpose.** Lattice = a new
   `{type:'object', objectKind:'lattice'}` node owning geometry
   (cage verts + row/col edges) + shape-keys; the part↔cage relationship
   is a *separate, lightweight* per-part modifier entry
   `{type:'lattice', objectId, strength, vertexGroup?}`.
   **Blender:** geometry lives in a `Lattice` data-block
   (`DNA_lattice_types.h:65-78` — `pntsu/pntsv/pntsw`, `BPoint *def`,
   `Key *key`); the modifier is a tiny separate struct on the *deformed*
   mesh (`LatticeModifierData = {Object *object; char name[64]; float
   strength; flag}`, `DNA_modifier_types.h:282-292`). One cage, many
   modifiers pointing at it. **Risk:** migration blast radius — every
   `deformerKind:'warp'` reader repoints in lockstep, no dual-read
   (Rule №2).
2. **Piece-declares-warp is canonical.** The modifier lives on the
   deformed part and names the cage (`LatticeModifierData.object`,
   `DNA_modifier_types.h:285`; `foreach_ID_link` walks only `lmd->object`,
   `MOD_lattice.cc:66-71`). The `Lattice` struct has **no** target
   back-reference. A warp-side target list is a DERIVED view only (Outliner
   / overlay), never stored (a stored second list = Rule №2 violation).
   **Risk:** parts affected today via *ancestor hierarchy* (e.g. legwear)
   have NO `modifiers[]` entry — migration must SYNTHESIZE an explicit
   lattice modifier on every such part or they silently lose their deform.
3. **Keyforms → KeyBlocks on the cage; keep our param-binding layer.**
   A lattice carries shape keys (`Lattice.key`, `DNA_lattice_types.h:78`;
   each `KeyBlock` = full vertex-position array, `DNA_key_types.h`). That
   matches `keyforms[].positions` exactly (Basis = baseGrid). **Mismatch:**
   Blender drives a relative shape key by a scalar `curval`
   (`DNA_key_types.h:80`, 1-D weight via fcurve/driver); our keyforms are
   bound to a multi-axis **parameter tuple** (`keyTuple`) with cellSelect
   blending + `opacity`. So: store positions as KeyBlocks, but
   `bindings`/`keyTuple`/`opacity` stay as explicit object-side metadata —
   do NOT collapse them into a single `curval`.
4. **Stay Lattice (regular rows×cols), NOT Mesh Deform.** Lattice is
   intrinsically a regular grid (`Lattice.pntsu/pntsv/pntsw` are per-axis
   point counts, no faces); Mesh Deform binds an arbitrary cage mesh
   (`MeshDeformModifierData`, harmonic-coordinate bind). Cubism
   `CDeformerSurface` is a regular control grid → Lattice (`pntsu×pntsv`,
   w=1) is the exact analog. **Risk:** Edit-Mode must HARD-BLOCK topology
   ops (add/dissolve/subdivide) on cage objects, else the rows×cols
   invariant the exporter requires breaks.
5. **One-step lossless migration (no shim, Rule №2).** Each
   `deformer/warp` node → one lattice-object node (baseGrid → cage verts +
   row/col edges; gridSize → pntsu/pntsv; keyforms → KeyBlocks; bindings
   preserved as object metadata). Each affected part → explicit modifier
   `{type:'lattice', objectId, ...}`. Old node + hierarchy link deleted in
   the same migration.
   **Data needing a deliberate home (silent-corruption hazards):**
   - `localFrame` (`canvas-px` / `normalized-0to1` / `pivot-relative`):
     Blender has no lift-frame — the deform space comes from the object's
     transform + `BKE_lattice_deform_coords` (`MOD_lattice.cc:95`). Must be
     relocated faithfully (object transform OR explicit object metadata),
     or the bilinear projection space is lost. **This is the #1 migration
     risk — the Phase-0 oracle catches it only at export, not migration.**
   - `canvasBbox`: pure derived cache → recompute, do NOT migrate.
   - `targetPartId` + ancestor link → collapse into per-part modifiers
     (decision #2); enumerate ALL affected parts in migration.
   - `bindings`/`keyTuple`/`opacity` → explicit object-side metadata (#3).

## Phase 0 — DONE (2026-05-20)

Byte-fidelity gate built **before** any refactor: a spec-contract oracle
pinning `selectRigSpec(project).warpDeformers` (the `warpSpecs` the moc3
emitter + cmo3 `CWarpDeformerSource` consume *unchanged*) + the
`canvasToInnermostX/Y` body-warp normaliser closures (derived from
`baseGrid` bbox — the `localFrame` relocation hazard). Self-contained
synthetic model (2-deep warp chain + 2D keyform grid + all three
localFrames + per-mesh `targetPartId`/`canvasBbox` + non-default 4×6 grid).
Since the wire emitters are NOT refactored, identical `warpSpecs` ⟹
identical bytes by construction. **Gate:** `scripts/test/test_warpExportOracle.mjs`
(pinned hash `f50b6178`), wired into `npm run test` + `test:warpExportOracle`.
Phase 1 will rewrite the oracle's project BUILDER to emit grid objects, but
the EXPECTED_HASH must not change — a changed hash = wire regression → halt.

## REVISED phasing (2026-05-20 — after Phase-1 substrate map)

The original "Phase 1 substrate behind read-paths, Phase 2 eval repoint"
split is **impossible under Rule №2.** The substrate map found that eval
reads warps via **two independent paths**, and warp data is **already
dual-stored**:
- **selectRigSpec path** (`_warpNodeToSpec`, selectRigSpec.js:904 +
  `synthesizeDeformerNodesForExport` reading `part.modifiers[].data`) →
  feeds `WarpDeformerOverlay`, `chainEval`, `moc3writer`, `cmo3writer`.
- **depgraph-direct path** — `anim/depgraph/build.js` (buildNodes ~99-110 +
  chain-relation passes) and 4 kernels (`gridLift`, `keyform`, `artMesh`,
  `rotationSetup`) reach into `project.nodes` and test `deformerKind ===
  'warp'` DIRECTLY, NOT via selectRigSpec.
- Data is already in two places: the `deformer/warp` node AND a copy folded
  into `part.modifiers[].data` (v28 migration).

So the migration + EVERY reader must flip together (no staged-dead
migration). To keep that atomic flip reviewable + green, decompose into:

- **Slice 1.A — accessor seam (behavior-identical, NO schema change).**
  Create canonical predicates + cage/keyform getters (Blender precedent:
  `BKE_lattice`). Route ALL ~15 read sites through them
  (depgraph build + 4 kernels, selectRigSpec, deformerNodeReaders, the UI
  branches, modifierTypeInfo). Accessors internally read the CURRENT
  `deformer/warp` shape → zero behavior change, oracle + full suite green,
  nothing dead (accessors are live wrappers). This shrinks 1.B's blast
  radius from ~15 files to ~3.
- **Slice 1.B — the flip.** v43 migration (warp node → `{type:'object',
  objectKind:'lattice', dataId}` + `{type:'meshData', vertices=baseGrid,
  edges=grid}` + per-part `{type:'lattice', objectId}` modifier; synthesize
  modifiers on ANCESTOR-affected parts; relocate `localFrame`; delete old
  node + hierarchy link). Update ONLY the accessor internals + the writers
  (`deformerNodeSync`) + `synthesizeDeformerNodesForExport`. Oracle stays
  green by construction (identical warpSpecs out). Migration test added.

The cage MUST become a real mesh (`meshData.vertices` + grid edges), not a
`baseGrid` array — that's the user's core ask (edit grid verts in Edit Mode,
reuse the exit→refit path). So `baseGrid` reads become `getMeshVertices`
reads; the seam covers FIELD access, not just the type predicate.

Original phase list (still valid for Phases 3-6):

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
