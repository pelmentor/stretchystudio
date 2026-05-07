# Blender Deviation Audit — Stretchy Studio

Status: PROPOSED 2026-05-07. Awaiting user prioritisation.

User direction: "We follow Blender in almost all regards" — this audit
enumerates every SS-invented concept that doesn't have a 1:1 Blender
counterpart, so we can decide which to drop / fold / rename.

Reference clone: `reference/blender/source/blender/`. Authoritative
files cited per item.

---

## Findings

| # | SS Concept | Where | Blender Equivalent | Verdict | Notes |
|---|---|---|---|---|---|
| 1 | `MODE_BLEND_SHAPE` ('blendShape') as top-level mode | `editorStore.editMode`, `modeCompat.js` | NONE. Blender shape-key painting lives INSIDE Edit Mode (Properties → Mesh Data → Shape Keys panel + active-shape pointer) and Sculpt Mode ("use shape key" toggle). No `OB_MODE_BLEND_SHAPE` in `eObjectMode_*`. | **Fold** | User-flagged. SS surfaces it as a peer of Edit/Pose for "discoverability" — pure invention. |
| 2 | `'skeleton'` slot value (= Pose Mode) | `editorStore.editMode`, `modeCompat.js:106-108` | `OB_MODE_POSE`. The slot IS Pose Mode but kept the legacy "Skeleton Edit" SS label. | **Rename** | The comment in `modeCompat.js:59-62` already admits the name is stale. Rename slot value to `'pose'` + v26 migration mirroring v25's `'mesh'→'edit'`. |
| 3 | `node.type === 'deformer'` sibling node | `objectDataAccess.js:97-130`; `getDataKind` returns `'deformer'` | NONE. Blender modifiers are `ListBase<ModifierData>` INSIDE an Object — never standalone scene-graph entries (`reference/blender/.../makesdna/DNA_modifier_types.h:169`). | **Fold** | BFA-006 made deformers first-class `project.nodes` entries for export-pipeline reasons. v20 already shipped `Object.modifiers[]`; the standalone deformer node now duplicates that data. Promote `Object.modifiers[]` to canonical, retire the deformer node to a synthetic. |
| 4 | `'keyform'` editMode | `editorStore.editMode`, `enterEditMode('keyform', …)` | NONE. Closest is "Edit shape key", which lives inside Edit Mode. SS treats keyform-drag as a third edit context. | **Fold** | Should be a sub-mode of Edit Mode (mesh data) or a tool inside it, not a peer mode. |
| 5 | `'animations'` editor type | `editorRegistry.js:51` | `SPACE_ACTION` (Action Editor) — Blender has the action LIST as a header DROPDOWN inside the Action Editor, not a separate panel. | **Fold** | Surface as a header dropdown inside Dopesheet/Action editor, not a separate editor type. |
| 6 | `'parameters'` editor | `editorRegistry.js:49` | `SPACE_PROPERTIES` "Object Properties" tab — custom props live there. Blender has no separate sliders panel. | **Fold or rename** | Fold into Properties → "Parameters" section. If kept as a separate editor (Cubism-driven), rename to `'sliders'` to disambiguate. |
| 7 | `'performance'` editor | `editorRegistry.js:52`; `PerformanceEditor.jsx` | `SPACE_INFO` (Info Editor) shows scene stats; Blender profiling is CLI flags / System Console — no dedicated GUI. | **Drop** | Read-only FPS panel; collapse into Logs editor or remove. |
| 8 | `'keyformGraph'` editor | `editorRegistry.js:55` | `SPACE_GRAPH` (F-Curve Editor) is Blender's canonical curve editor. SS already has a separate `fcurve` editor. | **Drop** | Two graph editors is redundant — bake keyform-magnitude as an F-Curve channel in the F-Curve editor. |
| 9 | `'logs'` editor | `editorRegistry.js:56` | `SPACE_INFO` (Info Editor) is Blender's operator/log readout. | **Rename** | Rename to `'info'` to match `eSpace_Type`. |
| 10 | `'livePreview'` editor type | `editorRegistry.js:46` | NONE. Blender's viewport always evaluates the depgraph; SS splits "edit" vs "live physics tick" via two tabs. | **Keep (justified)** | Required because SS bakes physics/breath/cursor-look only in live mode (Cubism runtime parity). |
| 11 | Modifier `'warp'` type | `modifierTypeInfo.js:159` | `eModifierType_Warp = 35` exists in Blender (`DNA_modifier_types.h`), but it's POINT-based deformation, not bilinear FFD. SS warp ≈ `eModifierType_Lattice` semantically. | **Rename** | Rename to `'lattice'`. Lattice modifier in Blender is the actual bilinear/trilinear FFD primitive. |
| 12 | Modifier `'rotation'` type | `modifierTypeInfo.js:163` | NONE (no `eModifierType_Rotation`). Closest is `eModifierType_SimpleDeform` (Twist/Bend/Taper) or an Armature-bone child. | **Keep (justified)** | Cubism `RotationDeformer` export-format-driven. Document the deviation in the modifier type registry. |
| 13 | `'group'` node with `boneRole` = bone | `objectDataAccess.js:75-78` | Bones are `Bone` records inside an `Armature` data block, NOT Objects. SS conflates Object + Bone. | **Migrate** | Phase 1B/1C plan already calls for `type: 'object', dataKind: 'armature'` + bone records. Finish that migration. (Overlaps with the Armature container plan from earlier today.) |
| 14 | `meshSubMode: 'adjust'` (UV adjust inside Edit Mode) | `editorStore.meshSubMode` | UV editing has its own space (`SPACE_IMAGE` → UV Editor). Blender does NOT switch 3D viewport mode for UV adjust. | **Fold** | UV adjust should live in a dedicated editor matching `'image'` Space type, not piggyback on Edit Mode's submode. |
| 15 | `node.type === 'meshData'` (separate node) | `objectDataAccess.js:129` | `ID_ME` data block is a top-level `Main.meshes` entry referenced by Object via `ob->data` — exactly Blender's pattern. | **Keep (justified)** | Object/ObjectData split IS Blender. Finish making it canonical (Phase 1C). |
| 16 | `'nodeTree'` editor | `editorRegistry.js:57`; `anim/nodetree/types.js` | `SPACE_NODE` (Node Editor — shader/comp/geometry trees). V2 work explicitly cites the DNA file. | **Keep (justified)** | Real Blender concept; subtypes `'rig'`/`'driver'`/`'animation'` are fine (analogous to geometry/shader/compositor). |

---

## Top 3 fixes by user-impact (recommended priority)

### Fix 1 — Fold `MODE_BLEND_SHAPE` into Edit Mode.

**Why first:** Only invented top-level mode left. Removes a peer-mode that Blender users misread; deletes a row from `modeCompat.js`'s `mesh` set; lets the same Tab-then-pick-shape-key flow Blender ships work here too.

**Plan:**
- `editorStore.activeBlendShapeId` stays as the active-shape pointer, but the slot `editMode === 'blendShape'` collapses into `editMode === 'edit'`.
- When `editMode === 'edit'` AND `activeBlendShapeId` set on the active part: brush writes to the shape's deltas.
- ModePill drops the "Blend Shape Paint" section. The shape-key picker moves to the Properties → Mesh Data → Shape Keys panel (Blender pattern).
- v26 schema migration rewrites stored `'blendShape'` editMode to `'edit'`.

LOC est. ~200, schema v26.

### Fix 2 — Rename `'skeleton'` → `'pose'` slot value.

**Why second:** Pure terminological alignment, mechanical. The slot semantics are already Pose Mode; only the label lies.

**Plan:**
- `MODE_POSE = 'pose'` in `modeCompat.js` (was `'skeleton'`).
- v26 migration rewrites stored `node.mode === 'skeleton'` to `'pose'`.
- preferencesStore normalises legacy `lastToolByMode.skeleton` key on read.
- `viewLayers.skeleton` (the show/hide toggle) keeps its name — it's a layer name, not a mode.
- ModePill / SkeletonOverlay / etc rename `editMode === 'skeleton'` references.

LOC est. ~150, schema v26.

### Fix 3 — Retire `node.type === 'deformer'` as a sibling node.

**Why third:** Biggest blast radius — touches the data layer + every reader that branches on deformer-as-node vs deformer-as-modifier. But it closes the BFA-006 plan's stated goal: "no dual representation". Today every reader has to branch.

**Plan:**
- `Object.modifiers[]` (v20) becomes the canonical store for warp/rotation deformer state.
- Delete `node.type === 'deformer'` entries from `project.nodes` in v26 migration.
- All readers (export pipeline, chainEval, depgraph, NodeTreeEditor) that walked the node array now walk `Object.modifiers[]` instead.
- This is the V2-Cleanup-Phase work that was deferred earlier today.

LOC est. ~600, schema v26 (or split: v26 marks deprecated, v27 deletes after a soak).

---

## Open question for user

Pick the order. The plan ships fixes incrementally — each one is its own commit + tests + push. Defaults if unspecified: 1 → 2 → 3. Phase 3 (Armature container + modifier from the earlier plan) blocks on Fix 3 because both touch the same layer.
