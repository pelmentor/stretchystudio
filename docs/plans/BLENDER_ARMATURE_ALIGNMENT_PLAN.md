# Blender Armature Alignment Plan

Status: PROPOSED 2026-05-07. Awaiting user sign-off.

Three user-named items, ordered by risk/scope. Each phase ships
independently — Phase 1 first because it might just be a
visualization tweak; Phase 2 second because the schema cost is
small; Phase 3 last because it touches the data model.

---

## Today's shape (verified)

- Bones are `node.type === 'group'` with a `boneRole` field
  (`'root' | 'head' | 'leftArm' | …`). Discriminator: `isBoneGroup(n)`
  in `src/store/objectDataAccess.js:75`.
- Bones live **flat** in `project.nodes` linked by `node.parent`
  pointers. There is no Armature container today.
- Bone-baked parts (`handwear-l`, `handwear-r`) link to their owning
  bone via `node.parent = <boneGroupId>`. The mesh inherits the
  bone's transform via `computeBoneOverlayMatrices` in
  `src/components/canvas/CanvasViewport.jsx`.
- Per-part `node.modifiers[]` carries **only warp / rotation
  deformer entries** today (`MODIFIER_TYPES = { warp, rotation }` in
  `src/anim/modifierTypeInfo.js:158`). No bone / armature entry.
- The root bone IS drawn + clickable in `SkeletonOverlay.jsx:742-774`
  but at **60 % joint radius** (smaller than other bones, "structural
  pivot, no rotation arc"). Wizard places its pivot at the DWPose
  pelvis keypoint, falling back to image-center.
- Edit Mode for bones was **deliberately removed 2026-05-06**
  (commit `9df561f`, memory entry `project_mode_consolidation_2026_05_06`).
  Pose Mode is the sole bone-edit mode today; armature compatibility
  table in `src/modes/modeCompat.js:127-133` only contains `MODE_POSE`.

---

## Phase 1 — Root bone visibility on canvas

**Goal.** User can see and click the root bone reliably without
hunting for a 60 %-radius dot.

The root IS drawn + clickable today; if the user can't find it the
likely causes are:

1. `viewLayers.skeleton === false` (skeleton overlay hidden).
2. Root pivot ended up at an unhelpful position (image-center
   fallback when DWPose keypoints fail; or keypoints placed it at
   pelvis which on Shelby is at `y=433`, `x=897` — fine for a
   front-facing character but easy to miss when overlapping with
   the body silhouette).
3. The 60 % radius makes it visually recessive against busy
   geometry — and unlike other bones it has no rotation arc to draw
   the eye.

### Phase 1 work items

1.1 — **Make root visually distinctive.** Render the root as an
octahedral diamond outline (matches Blender's armature root marker)
instead of the smaller dot. Same hit area as a bone joint.
*File:* `src/components/canvas/SkeletonOverlay.jsx:742-774`.

1.2 — **Default seed to canvas center for the new "root in canvas"
contract.** Today's pelvis-keypoint default is fine for figure
characters but ambiguous for landscape / non-figure imports. Plan:
when `kp.pelvis` is unavailable, place root at `(canvasW/2, canvasH/2)`
(was: image-center which is the same in current Shelby case but
codifies the intent). When `kp.pelvis` IS available, keep that.
*File:* `src/io/armatureOrganizer.js:514-530`.

1.3 — **Diagnostic log on Init Rig.** `logger.debug('rootBoneInit', …)`
with `{ pivotX, pivotY, withinCanvas, source: 'pelvis' | 'fallback' }`
so a future "I can't see root" report is one Logs-panel entry away
from a diagnosis.
*File:* `src/io/armatureOrganizer.js:514-530`.

1.4 — **Test:** existing `test_armatureOrganizer.mjs` extended with
"root pivot is inside canvas after wizard" assertion.

Rough size: ~80 LOC, 1 schema-touch (none — runtime only).

---

## Phase 2 — Edit Mode for bones (Armature Edit)

**Goal.** Selecting a bone and pressing Tab should let the user
enter an editable mode where they can drag the bone's **rest pivot**
(not its pose rotation). Pose Mode stays as the second mode for
animation rotation. This is Blender's Armature → Edit Mode ↔ Pose
Mode dichotomy.

This **does NOT revert the 2026-05-06 mode consolidation**. That
collapse merged the prior `armatureEdit` into Pose because they had
overlapping semantics. The new mode here is specifically **rest
pivot drag** — distinct enough from Pose (which writes
`pose.rotation` overlay) that the dichotomy is meaningful again.

### Phase 2 work items

2.1 — **Add `MODE_ARMATURE_EDIT` constant** to `src/modes/modeCompat.js`.
Add it to the `armature` compatibility set alongside `MODE_POSE`.

2.2 — **Add `'armatureEdit'` to `editorStore.editMode` type union.**
Treat it as another valid editMode value. Same lock/exit semantics
as `'mesh'` and `'skeleton'`.

2.3 — **Tab keybind cycle.** In `src/v3/operators/registry.js:485-489`,
when a bone is selected:
- Object → Pose (`'skeleton'`) — first Tab.
- Pose → Armature Edit (`'armatureEdit'`) — second Tab.
- Armature Edit → Object — third Tab.

Cycle order matches Blender: Pose first (animation flow), Edit
second (rig editing flow). Mirror Blender's hotkey **Ctrl+Tab** as
a direct mode-picker for power users (deferred to a later polish
pass).

2.4 — **SkeletonOverlay drag handler branch.**
`SkeletonOverlay.jsx:496-507`: when `editMode === 'armatureEdit'`,
drag writes `node.transform.pivotX/Y` directly (rest-pivot edit).
When `editMode === 'skeleton'`, current pose-rotation behavior.

2.5 — **Mode-pill label.** Add `Armature Edit` label to the
ModePill canvas overlay so the user always knows which mode they're
in. Shipped 2026-05-02 patterns (`src/components/canvas/ModePill.jsx`)
already handle this — just an entry add.

2.6 — **Tests:**
- `test_modeCompat.mjs` — `armature` set contains both
  `MODE_POSE` and `MODE_ARMATURE_EDIT`.
- `test_armatureEditMode.mjs` (existing — was deleted in the 2026-05-06
  consolidation? Check; if deleted, restore the rest-pivot drag
  assertions only).

Rough size: ~150 LOC, no schema, no migration.

---

## Phase 3 — Armature container + Armature modifier (Blender alignment)

**Goal.** Match Blender's data model: an Armature is a first-class
node containing all bones; bone-bound parts have an Armature
modifier in their stack pointing at the Armature.

This is the largest phase because it touches the schema and the
wizard. To keep blast radius small we ship it in three sub-phases.

### Today's gap vs Blender's model

| Concept                  | Blender                                  | SS today                                 |
|--------------------------|------------------------------------------|------------------------------------------|
| Armature container       | `Armature` data, `Object` instance       | None — bones are flat siblings           |
| Bone hierarchy           | Children of the Armature data            | Flat with `node.parent` pointers         |
| Mesh ↔ bones link        | Armature modifier on the mesh            | `node.parent = boneId`, no modifier      |
| Modifier types available | `Armature`, `Subdiv`, `Solidify`, …      | `warp`, `rotation`                       |

### Phase 3a — Schema migration v25 (Armature container)

Add an `Armature` node:
- `node.type === 'armature'`, `node.id === 'Armature_<projectId>'`
  (one per project today; multi-armature is out of scope).
- `node.parent = null` (sibling of the canvas root).
- All bones reparent: `bone.parent` either stays as `<otherBoneId>`
  for non-root bones, OR for the root bone changes from `null` to
  `Armature_<projectId>`.
- Idempotent: re-running the migration is a no-op.

*Files:*
- `src/store/migrations/v25_armature_container.js` (new).
- `src/store/projectMigrations.js` — bump `CURRENT_SCHEMA_VERSION`
  to 25, add v25 entry.

### Phase 3b — Add `'armature'` modifier type

Register `armature` in `MODIFIER_TYPES` (`src/anim/modifierTypeInfo.js`).
The `deformVerts` callback is a **no-op pass-through** for this
phase — bone deformation continues to come from
`computeBoneOverlayMatrices` (the post-rig overlay). The Armature
modifier here is **descriptive only**: it tells the user (and the
Properties / NodeTree views) "this part is bound to bone X under
Armature Y", without yet replacing the existing bone-overlay
rendering path.

Modifier shape:
```js
{
  type: 'armature',
  armatureId: 'Armature_<projectId>',
  boneId: '<boneGroupId>',     // the specific bone the part binds to
  enabled: true,
  showInEditor: true,
  mode: MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER,
}
```

*Files:* `src/anim/modifierTypeInfo.js`, `src/anim/depgraph/types.js`
(if a new opcode is needed — likely not, the no-op kernel
short-circuits).

### Phase 3c — Wizard wire

When the wizard rigs a PSD and assigns `node.parent = <boneId>` on
bone-baked parts, **also append** an `armature` modifier entry to
`part.modifiers[]`. Existing warp/rotation modifiers stay; the
armature modifier sits at the end of the stack (root-most position
in leaf-first order, which is the Blender convention — Armature
last in the chain).

*Files:* `src/services/PsdImportService.js:149`,
`src/io/armatureOrganizer.js:583-586`,
`src/store/migrations/v25_armature_container.js`
(back-fill: existing rigs without the modifier get one).

### Phase 3d — UI surface (ModifierStackSection)

Existing `src/v3/editors/properties/sections/ModifierStackSection.jsx`
already iterates `part.modifiers[]`. Add a render branch for
`type === 'armature'`:
- Label: `ARMATURE`.
- Subtitle: `Armature_<projectId> · bone: <boneRole>`.
- Click on the bone link selects the bone in the outliner / canvas
  (matches Blender's "click to navigate to the bound armature").

*Files:* `src/v3/editors/properties/sections/ModifierStackSection.jsx`.

### Phase 3 work items summary

| Sub-phase | LOC est. | Schema | Migration |
|-----------|---------:|--------|-----------|
| 3a (v25 container)    | ~120 | v25  | yes |
| 3b (modifier type)    | ~80  | none | no  |
| 3c (wizard wire)      | ~60  | none | yes (back-fill) |
| 3d (Properties UI)    | ~50  | none | no  |

### Tests

- `test_migration_v25.mjs` — v25 idempotence + lossless reparent.
- `test_armatureModifier.mjs` — wizard appends armature modifier on
  bone-baked parts; warp-only parts skip.
- `test_propertiesSectionRegistry.mjs` — extend assertion for
  armature modifier render.

---

## Sequencing

1. **Phase 1** first (smallest blast radius — pure runtime tweak +
   diagnostic log).
2. **Phase 2** second (no schema, isolated to mode subsystem).
3. **Phase 3** last and only after the user confirms 1+2 deliver
   what they're after.

Each phase ships its own commit. After Phase 3, a memory entry
records the new Blender-aligned shape so future-sessions don't
re-derive the bone model from grep.

---

## Open questions for user sign-off

1. **Phase 1**: Confirm the root visibility issue is "I can't find
   the dot" (visualization) vs "the root is genuinely outside the
   canvas". A screenshot or coordinates from the Logs panel would
   pin which case.
2. **Phase 2**: Confirm Tab cycle order **Object → Pose → Armature
   Edit → Object** matches expectation. Blender's actual order is
   Object → Edit → Pose (Edit first), but the SS history has Pose
   as the established mode — flipping the order is friction. Vote.
3. **Phase 3**: Is "Armature modifier as descriptive-only no-op
   today, with rendering still on `computeBoneOverlayMatrices`"
   acceptable? Promoting it to an actual rendering path is a
   separate architectural lift (it would require Armature eval to
   produce the overlay matrices the depgraph could pick up). The
   plan deliberately keeps the bone-rendering path untouched in
   Phase 3 so the Blender data model lands without rendering risk.
