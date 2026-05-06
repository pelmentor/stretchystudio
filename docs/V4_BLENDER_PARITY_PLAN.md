# V4 Blender Parity — Properties + Keyform Editor + Weight Paint

**Status:** Plan (no code yet) · **Drafted:** 2026-05-04 · **Owner:** pelmentor

The thing this plan delivers: **Stretchy Studio's authoring surface looks and behaves like Blender's, with Cubism's deformer-keyform model wired underneath instead of Blender's mesh-shape-key model.** No tabs in Properties, contextual sections per selected node, a real keyform editor (not just "click Init Rig and pray"), and a Blender-style weight paint mode.

---

## 1. Conceptual model — pin it before refactoring

Three terms that are routinely conflated in Live2D conversations. Pinning them lets us name the data layer correctly:

| Term | Lives where | Role |
|------|-------------|------|
| **Parameter** | `project.parameters[i]` — global list | A slider DEFINITION: id, name, range, default, decimal places. **Just a driver.** No deformation data. |
| **Keyform** | `deformer.keyforms[j]` (per warp / rotation / art mesh) | A snapshot of *that one deformer* at a specific `keyTuple` — e.g. for a hair warp bound to `[ParamHairFront]`, the keyform at `keyTuple=[+1]` stores the swung-right warp grid positions. **This is Cubism's "shapekey".** |
| **Blendshape** (Blender shape key) | `node.blendShapes[k]` — per part | Per-mesh vertex deltas driven by a 0..1 slider. SS already has this slot but no UI surfaces it. **Orthogonal to Cubism's keyform model**; export pipeline ignores them today. |

A param drives multiple deformers' keyforms simultaneously via cartesian product over the param's `keys` array. So `ParamAngleX` with `keys: [-30, 0, 30]` and `ParamAngleY` with `keys: [-30, 0, 30]` produces a 3×3 grid of 9 keyforms on every deformer that binds both. Cubism Editor calls these "Parameter Combinations". SS auto-generates them via Init Rig.

**Authoring flow Cubism Editor uses (and SS lacks a UI for):**
1. Pick a deformer (a warp grid or a rotation deformer).
2. Set the params to a specific `(value₁, value₂, …)` that lands exactly on a key tuple in that deformer's bindings.
3. Edit the deformer's geometry — drag warp grid corners, adjust rotation angle/origin.
4. Editor stores `keyform.positions` (or `angle/origin`) at that tuple.

That's it. Not magic, not blendshapes, not custom drivers. Just "what does this deformer look like at this param-tuple."

The current SS gap: step 1–2 has no UI (you can't say "I want to edit FaceParallax's keyform at `(AngleX=30, AngleY=0)`"), and step 3 is read-only (warp grid overlay shows the keyform but you can't drag it).

**Decision:** keep params, keyforms, and `node.blendShapes` as three distinct concepts. Don't try to unify via terminology. Properties panel surfaces all three when relevant.

---

## 2. Current state audit

What's already built (= reuse), what's missing (= build), what's wrong (= refactor).

### Already built — reuse as-is
- **`project.parameters`**: full param list with id/min/max/default/decimalPlaces. Source of truth.
- **`project.nodes` deformer entries**: warps + rotations with `bindings` + `keyforms` arrays. Source of truth post-BFA-006.
- **`project.nodes` part entries**: `mesh.vertices`, `mesh.boneWeights`, `mesh.jointBoneId`, `blendShapes`, `blendShapeValues`. All present.
- **`paramValuesStore`**: live param values per session. Drives `chainEval`.
- **`useEditorStore.editMode`** slot: single-select mode (`null | 'mesh' | 'blendShape' | 'skeleton'`). Already supports adding modes — `weightPaint` and `keyform` slot in cleanly.
- **`childBoneRoleFor` + `computeSkinWeights`** (`src/components/canvas/viewport/meshPostProcess.js`): arm/elbow auto-skinning at remesh time. Foundation for weight paint.
- **Outliner shows deformers** (BFA-006 Phase 4 — `treeBuilder.js`): warps + rotations rendered with `isDeformer` + `deformerKind` flags. Selecting one routes through `selectionStore` as `{type:'deformer', id}`.
- **Parameters are virtual selectable nodes**: `ParametersEditor` panel (`src/v3/editors/parameters/`) lists params as rows; clicking one dispatches `select({type:'parameter', id})`. `ParameterTab` already inspects the selected param. **Cubism Editor's separation of Parameters panel from the parts hierarchy — already shipped.**
- **Existing Properties tabs (9 total)**: `ObjectTab`, `MeshTab`, `BlendShapeTab` (full CRUD: create / delete / setValue / brush-paint deltas), `MaskTab`, `PhysicsTab`, `DeformerTab`, `ParameterTab`, `VariantTab`, `RigStagesTab`. **All are reusable as sections** — Track 1 just removes the tab strip and surfaces them simultaneously.
- **Existing canvas overlays** (`src/v3/editors/viewport/overlays/`): `WarpDeformerOverlay` paints warp grids, `RotationDeformerOverlay` paints rotation pivots/handles. Both are display-only today; Track 3 makes them draggable.
- **`blendShapes` is fully wired in-app**: `BlendShapeTab` has CRUD UI, `editorStore.editMode === 'blendShape'` enters brush-paint-deltas mode in CanvasViewport, `scenePass.js` blends the deltas at render time, `animationEngine.js` can drive shape values from animation tracks. **Just not exported to cmo3/moc3** (`cmo3Import.js:194-198` initializes them as `null`/`{}`; export pipeline ignores them).

### Missing
- **Properties panel that's contextual, scrollable, sectioned (no tab strip), and reactive to selection.** Tabs exist as sections-in-disguise; we strip the tab strip and stack them.
- **Param editor edit operations**: read-only today. No add/remove param, no add/remove key, no rename, no range edit. Init Rig is the only writer.
- **Keyform editor**: zero UI. The cartesian-product keyforms exist in `project.nodes` but you can't pick one and drag the geometry.
- **Weight paint mode**: zero UI. Skinning data exists for arm/elbow chains; only `SkeletonOverlay` consumes it.
- **Vertex Groups panel** (Blender naming): zero UI. Bones implicitly own weights via `mesh.boneWeights` + `jointBoneId`, but the user can't browse / rename / re-assign.

### Wrong (= currently shipped but anti-pattern)
- **`PropertiesEditor` uses a tab strip**. Blender's Properties Editor sections instead. This is the structural change blocking everything.
- **Tab visibility hardcoded to selected-node type** (e.g. `DeformerTab` only shows when a deformer is selected). Already pluggable via `tabsFor(ctx)` predicate; conversion to sections is mechanical.

---

## 3. Track 1 — Properties panel reform (UI mechanical)

**Goal:** kill tabs. Contextual sections. Blender-equivalent.

**Why first:** every other track plugs into Properties. Doing tracks 2–4 against a tabbed Properties means re-doing them when we eventually section-ify. Doing it first means each new feature ships as one new section.

### Blender's structure — what we copy
- Single vertical scroll panel.
- Each "section" is a collapsible panel (Blender calls them "panels" inside an "editor").
- Sections shown depend on context (selected node, current mode).
- Header at the top shows the active node name + type icon + breadcrumb.
- Two zones: object-level data (always shown when a node is selected) + active-data data (mode-specific, e.g. mesh-edit shows mesh data, weight-paint shows weight data).

### SS Properties panel mapping (canonical order LOCKED)

Section visibility rule: **show iff the data for this section exists on the selected node OR is currently being authored (edit mode active).**

Order mirrors Blender's Properties Editor (top-to-bottom: Object → Modifiers → Object Data → Bone). Live2D-specific sections slot under the closest Blender analogue.

| # | Section | Visible when | Edits | Source today |
|---|---------|--------------|-------|--------------|
| 1 | **Transform** | any node | x, y, rotation, scaleX, scaleY, pivotX, pivotY | `ObjectTab` (top half) |
| 2 | **Visibility / Opacity** | any node | `node.visible`, `node.opacity` | `ObjectTab` (bottom half) |
| 3 | **Modifier Stack** | `type:'part'` | the chain `node.rigParent → ancestors` rendered top-to-bottom; read-only navigation, click to jump to that deformer | NEW |
| 4 | **Mesh** | `type:'part' && mesh` | vert count, tri count, edge-loop summary, retriangulate | `MeshTab` |
| 5 | **Vertex Groups** | `type:'part' && (boneWeights \|\| has-bone-ancestor)` | named weight groups (Track 4); add / rename / remove / Active toggle | NEW (Track 4) |
| 6 | **Shape Keys** | `type:'part' && mesh` (matches existing `BlendShapeTab.applies`) | Blender-style shape key list with sliders, "+" / "−", brush-paint button toggles `editMode='blendShape'` | `BlendShapeTab` |
| 7 | **Mask Config** | `type:'part'` | clip pair (target↔clipper) editor | `MaskTab` |
| 8 | **Variant** | `type:'part' && (variantOf \|\| has-variants-pointing-here)` | base/variant pairing, fade rules | `VariantTab` |
| 9 | **Bone** | `type:'group' && boneRole` | boneRole, pivot, length, baseAngle | NEW (subset of `ObjectTab`) |
| 10 | **Physics** | `type:'group' && boneRole` (has physics rule writing to `ParamRotation_<bone>`) | rule preview | `PhysicsTab` |
| 11 | **Deformer Bindings** | `type:'deformer'` | params this deformer binds; "+" to bind a new param, "−" to drop, key list per binding | `DeformerTab` (split out) |
| 12 | **Deformer Keyforms** | `type:'deformer'` | matrix (N=2) or flat list (N≥3) of keyforms; click to enter Keyform Edit Mode (Track 3) | NEW (Track 3) |
| 13 | **Parameter** | `type:'parameter'` | id, name, min, max, default, decimalPlaces, key list, back-references to bindings | `ParameterTab` (extended, Track 2) |
| 14 | **Rig Stages** | `type:'part' \|\| type:'group'` | per-stage refit operators (project-level; ignores `active.id`) | `RigStagesTab` (unchanged) |

**Active mode panel** (shown at top, sticks): mode-specific overrides.
- Object Mode → nothing extra.
- Mesh Edit → "Mesh Edit" panel: brush size, falloff, proportional editing toggle.
- Weight Paint → "Weight Paint" panel: brush size, brush strength, current vertex group, normalize-on-paint toggle.
- Skeleton Edit → "Skeleton" panel: bone roll, lock chain.
- Keyform Edit (NEW from Track 3) → "Keyform" panel: current `keyTuple`, "Apply" / "Cancel" / "Reset to default", `keyTuple` cycle buttons.

### Implementation notes
- One React component per section. Each section subscribes to its own zustand slice (selection + the specific node fields it cares about). No top-level "rerender on any project mutation".
- Replace `tabRegistry.jsx` with `propertiesSectionRegistry.js` — array of `{id, isVisible(node, editor), Component}`. Keep registry pure so visibility tests can run in node.
- Header bar: one line, `<icon> {nodeName} · {nodeType}` with up-arrow to jump to parent.
- Two-tab fallback (matches Blender's "Active" / "Scene" properties): only fall back to tabs if the section list overflows a hard limit (~10 visible sections). Stretch goal — start with single column.

### Risks
- **Section order matters for muscle memory.** Blender's order: Render, Output, View Layer, Scene, World, Collection, Object, Modifiers, Particles, Physics, Constraints, Object Data, Bone, Bone Constraints, Material, Texture. SS will pick its own canonical order; document it in the plan and don't shuffle later.
- **Subscribing per-section requires care** — naive `useStore(s => s.project.nodes.find(n => n.id === selected))` rebuilds on every mutation. Use selectors keyed on `(selectedId, node-field-of-interest)` with shallow compare.
- **Existing tab-keyed editor state** (e.g. `editorStore.activePropertiesTab`) needs migration. Likely just delete it.

---

## 4. Track 2 — Param editor polish (data-layer extension)

**Goal:** user can add/rename/remove parameters, change ranges, add/remove keys, see who's bound.

**Why second:** Track 3 (keyform editor) needs "user creates a new key on a param" before the keyform editor can author at that key.

### Surfaces
- **Parameters panel** (existing `src/v3/editors/parameters/ParametersEditor.jsx`): add `+` button at top of list, `×` per row, in-place rename, range/default edit. Click row → dispatches `select({type:'parameter', id})` (already wired).
- **Properties → Parameter section** (existing `ParameterTab` extended): inspector for the selected param. Today it shows id/name/range/default + live current value. Track 2 adds: editable name/range/default fields, key list with add/remove, back-references list (deformers + physics rules referencing this param).

### Outliner — NO change
**Don't** add a Parameters category to the Outliner. `treeBuilder.js:31-32` documents the existing intent:
> `'param'` — parameters grouped by role. (Not implemented; covered by ParametersEditor for now.)

Cubism Editor's convention is exactly this: a dedicated Parameters panel separate from the Parts hierarchy. Selection routing already works (`type:'parameter'` is a first-class selection kind). The Outliner stays focused on nodes; the Parameters panel stays focused on driver definitions. Two-panel separation matches both Blender (no drivers in Outliner) and Cubism (Parameters panel ≠ Parts panel).

### Data-layer mechanics
- Adding a param: appends to `project.parameters`. New params start with `keys: []` until the user adds keys (or until something binds them).
- Adding a key to a param: updates `param.keys` AND every deformer that binds that param needs a new keyform inserted at the right cartesian-product position. **This is the tricky bit** — see "Risks" below.
- Renaming a param: changes `param.id` AND every binding's `parameterId`. Trivial to walk; do as a single `produce()`.
- Range edit: just `param.min` / `param.max`. Cosmetic for the slider; doesn't invalidate keyforms.

### Risks
- **Adding a key to a param ALREADY bound by N deformers** means inserting a new keyform per deformer. The new keyform's positions can't be auto-derived from existing keyforms — the user has to enter Keyform Edit Mode (Track 3) and set them. UI workflow: when user adds a key, immediately route into keyform edit mode for the active deformer, with all OTHER deformers' new keyforms set to a sensible default (probably the linear interp of neighboring existing keyforms).
- **Deleting a key**: removes the keyform from every binding. Lossy — confirm dialog.
- **Deleting a param entirely**: cascade delete bindings on deformers, drop param from every cartesian product (could shrink keyform counts dramatically). Confirm dialog with binding count.
- **Existing Init Rig regenerates from heuristics** — if user authors keyforms then re-runs Init Rig in 'replace' mode, custom keys get clobbered. The `_userAuthored` markers from V3 re-rig flow should extend to per-param + per-keyform granularity. Today `_userAuthored` is per-deformer-node; we need it on `keyforms[i]` and on `parameters[i]` too.

### Param "kinds" — keep them visible but treat uniformly
The auto-generated params have implicit kinds (face/body angles, eye opens, hair sway, rotations, variants, opacity). Some have semantic meaning to the rig generator (Init Rig won't add a second `ParamAngleX`). The Param section displays `kind` as read-only metadata; the user can edit user-created custom params freely but is warned (not blocked) on standard ones.

---

## 5. Track 3 — Keyform editor (the missing core)

**Goal:** select a deformer, click a key in its keyform list, edit the geometry at that key.

This is **the** authoring feature SS lacks vs Cubism Editor. Everything else is polish.

### UX flow
1. User selects a deformer in the Outliner. (Or: in the new Modifier Stack section under Properties, clicks a deformer entry on the active part to jump to it.)
2. Properties → Deformer Keyforms section shows a list of keyforms. For 1D bindings (e.g. ParamHairFront [-1,0,1]) it's a 1×3 row; for 2D (FaceParallax = ParamAngleX × ParamAngleY 3×3) it's a 3×3 grid; for higher-D it falls back to a flat list with `keyTuple` shown.
3. User clicks a keyform cell. SS enters **Keyform Edit Mode** (`editorStore.editMode === 'keyform'`).
4. While in this mode:
   - All bound params snap to the selected `keyTuple` and become read-only (slider locks visually, value frozen).
   - All other params remain user-driven.
   - The selected deformer's grid (warps) or pivot/angle handles (rotations) become draggable on canvas.
   - Drag → updates `keyform.positions` (warp) or `keyform.angle / originX / originY` (rotation) immediately.
   - Mark keyform `_userAuthored: true` on first edit.
5. User clicks "Apply" to commit (Esc to cancel — restores pre-edit snapshot stored on enter).

### Cartesian product navigation
For a deformer bound to N params, the keyform grid is the cartesian product. UI for navigating:
- **1D**: row of N cells (one per key).
- **2D**: matrix, axes labeled with the two params' key values.
- **N≥3**: dropdown selector + "axis pinning" — pick which two axes to show as the matrix, the rest pin to fixed values.

### "Edit at intermediate values" (not on a key)?
Cubism Editor lets you scrub a param continuously and you see the interpolated result. To AUTHOR, you must land exactly on a key. SS should match: if the user scrubs to e.g. `ParamAngleX = 12` (between keys 0 and 30), entering Keyform Edit Mode is disabled until they snap to a key. The properties panel grid view makes this explicit — only cells in the grid are clickable.

### Canvas overlay changes
Two existing overlays at `src/v3/editors/viewport/overlays/`:
- `WarpDeformerOverlay.jsx` — paints lifted warp grids in canvas-px (display-only).
- `RotationDeformerOverlay.jsx` — paints rotation pivots + handles (display-only).

In keyform edit mode they need to:
- Render the grid / pivot+handle for the SELECTED keyform's positions, not the live-evaluated lifted grid.
- Make grid corners draggable for warps → update `keyform.positions[i]`.
- Make handle endpoint draggable for rotations → update `keyform.angle`. Make pivot disc draggable → update `keyform.originX/originY`.
- Render OTHER deformers' lifted grids/pivots dimmed (so user has visual context but can't accidentally drag them).
- Reuse the existing `dragRef` pattern from `CanvasViewport.jsx` for pointer capture; throttle commits to 30Hz; final commit on pointerup (same pattern mesh-edit uses).

### Data-layer mechanics
- Already in place: `project.nodes` has deformer entries with `keyforms` arrays. Editing one is just `proj.nodes[i].keyforms[j].positions[k] = newValue` inside an `updateProject()`.
- New: `editorStore.keyformEdit` slot — `{deformerId: string, keyformIndex: number, snapshot: KeyformBackup} | null`. `snapshot` lets Esc cancel revert without immer history machinery.
- `_userAuthored` flag on the keyform: any post-edit Init Rig in 'merge' mode preserves it. 'replace' mode clobbers (with confirm).

### Risks
- **Frame-of-reference mismatch.** Warp keyform.positions are stored in PARENT'S local frame (FaceParallax.keyforms[i].positions are in `pivot-relative-px`; hair-warp.keyforms[i].positions are in `normalized-0to1` of FaceParallax). The user drags in canvas-px. We need: forward project canvas-drag-delta → parent-local delta. The `localFrame` field on each spec already says which frame; chainEval already converts. Drag handler does the inverse: canvas-delta → invert through ancestor `evalChainAtPoint` → parent-local-delta → `keyform.positions[i] += delta`.
- **Editing a non-leaf warp keyform changes the lifted grid for every descendant.** This is correct Cubism behavior. The render automatically reflects it because `_computeLiftedGrid` is per-frame and re-derives. No explicit propagation needed. But the user might be surprised — UI hint: when editing a non-leaf warp, show "N child deformers will follow" badge.
- **Rotation deformer keyform fields are different from warp's.** `angle / originX / originY` instead of `positions[]`. Same edit mode, different gesture set: drag handle endpoint = angle, drag origin disc = pivot. Reuses the existing SkeletonOverlay primitives.
- **Existing test `test_neutralisedWarpIdentity.mjs`** uses 3-keyform tables on hair-only param. Make sure the post-Track-3 keyform model still passes it (no schema change expected, just new write paths).

---

## 6. Track 4 — Weight paint mode (Blender port)

**Goal:** Blender's weight paint mode behavior, including synced colors, Vertex Groups panel, gradient brush.

**Why fourth:** independent of Tracks 1–3 functionally, but the Properties panel from Track 1 is where the Vertex Groups section lives. Could ship before Track 3 if Track 3 has unforeseen blockers.

### Mode entry
- Add `'weightPaint'` to `editorStore.editMode` enum.
- Toggle: `Tab` cycles through enabled modes (Blender uses `Ctrl+Tab` for mode pie menu — port that). Modes available depend on selected node:
  - Part with mesh → Object, Edit, Sculpt(future), Weight Paint
  - Group with boneRole → Object, Skeleton (formerly the only option for bones).
- ModePill canvas overlay shows the current mode (existing PP1 work).

### Canvas rendering in Weight Paint mode
The visible canvas shifts to "weight paint shader" while in this mode:
- The selected mesh part renders with a heatmap shader: red (weight=1) → yellow → green → blue (weight=0).
- All OTHER mesh parts render dimmed flat blue.
- Bones render normally (Blender shows armature in solid-colored bone shapes).
- Selecting a bone (via skeleton overlay click or Outliner) sets it as the "active vertex group" — heatmap reflects weights for that bone.

This needs a new shader path in `partRenderer.js`. New uniform `u_weightPaintMode` (off / off-mesh / on-mesh-active) + per-vertex weight attribute. The weight-paint shader interpolates color from a 1D ramp texture.

### Brush
Blender's weight paint brush: circular cursor, drag to paint, brush radius scrolls with `[` / `]`, strength toggles with `Shift`. Modes:
- **Add**: weight = clamp(weight + strength, 0, 1) per vertex under brush, falloff by distance.
- **Subtract**: weight = clamp(weight - strength, 0, 1).
- **Blur**: weight = average of neighbors.
- **Mix** (default): weight = lerp(weight, target, strength).

Reuse `proportionalEdit.js` falloff curves (already a Blender port for mesh-edit's proportional editing). Same falloff types.

### Vertex Groups panel (Properties → Vertex Groups section)
List of weight groups for the selected part. Each row:
- Name (the bone group's `name`).
- "Active" radio (only one active at a time; drives the heatmap when in Weight Paint mode).
- "+" / "−" / rename / remove.
- Per-group "Normalize" / "Invert" actions.

Today SS has implicit "one weight group per limb" from auto-skinning. This panel makes the model explicit. User can add custom groups (e.g. "left-half") as named subsets.

### Data-layer extension
Today: `mesh.boneWeights = number[]` (single weight array, single bone). Limited to `arm → elbow` pairs.

Need to extend to multi-group:
```js
mesh.weightGroups = {
  [groupName]: number[]  // weight per vertex
}
mesh.activeWeightGroup = string | null  // currently painted; drives bone-rotation deformer baking at export
```

Migration: existing `mesh.boneWeights` + `mesh.jointBoneId` becomes one entry in `weightGroups` keyed on the bone group's name. Backwards-compat at export: if `weightGroups` has exactly one entry, it's the legacy single-bone-skinning case.

For the export pipeline (cmo3 / moc3): bone-baked keyforms today read `mesh.boneWeights`. Update to read the active weight group OR loop over each group emitting baked keyforms per bone. Cubism supports multi-bone weighting — the moc3 binary already has `MeshKeyformBindings` per bone.

### Risks
- **The shader change touches every part's render path**, even outside weight paint mode (need to add the per-vertex weight attribute to the GPU buffer always — wasted bytes if user never enters weight paint). Acceptable: 4 bytes per vertex on a 50k-vert character = 200KB. Negligible.
- **Bone selection ⇋ active vertex group**: when user clicks a bone, Properties shows that bone's data, AND the weight-paint heatmap reflects weights for that bone. Two distinct selection slots? Or a single selection that the weight-paint mode reinterprets? Single selection with mode-aware reinterpretation matches Blender. Document the semantic in `editorStore`.
- **Multi-bone weighting changes the export.** Today's auto-skinning is one-bone-per-mesh. Generalising to multi-group means the cmo3 keyform-baking emits multiple keyforms per `(angle, bone)` pair. moc3 binary handles it natively. cmo3 XML emission needs a once-over. **Defer the multi-bone-export work** to a follow-up — start by shipping the UI with the single-bone constraint preserved at export time.

---

## 7. Sequencing and shipping cadence

**Phase 1: Properties panel reform** (Track 1) — 2-3 days.
Mechanical refactor. No data-layer changes. Tests on visibility-rule per node type. Ship as one commit. Unblocks every other phase.

**Phase 2: Param editor polish** (Track 2) — 1-2 days.
Param section in Properties. Add/rename/remove. Outliner Parameters category. Ships independently.

**Phase 3: Keyform editor — read-only first, then edit** (Track 3) — 4-6 days, two sub-phases.
- 3a (1-2 days): Properties → Deformer Keyforms section. Read-only grid view. Click-to-snap-params. **No edit yet.** Validates UX, surfaces frame-of-reference issues early.
- 3b (3-4 days): drag-to-edit. Canvas overlay. `_userAuthored` flag. `editMode='keyform'` slot. Esc cancel.

**Phase 4: Weight paint** (Track 4) — 3-4 days, parallelizable with Phase 2-3.
- 4a (1 day): Vertex Groups Properties section. Read-only display of existing single-bone weights.
- 4b (2-3 days): Mode entry, canvas shader, brush, multi-group data layer.

**Total estimate**: 10-15 days serialized; ~7-9 days with Phases 2 and 4 running parallel to Phase 3.

### Cross-phase invariants
- `_userAuthored` flag granularity needs to be: `parameters[i]._userAuthored`, `parameters[i].keys[j]._userAuthored`, `deformer.keyforms[k]._userAuthored`, `mesh.weightGroups[name]._userAuthored`. Init Rig 'merge' mode preserves these; 'replace' clobbers with confirm.
- All new edits flow through `updateProject()` → immer history → undo/redo works automatically.
- `selectRigSpec` (the runtime view) re-derives on every project mutation. New keyforms / weight groups show up live without explicit invalidation.

---

## 8. Decisions (was "open questions" — all resolved via Blender / Cubism precedent)

1. **Section order in Properties — LOCKED.** See §3 table. Top-to-bottom: Transform · Visibility · Modifier Stack · Mesh · Vertex Groups · Shape Keys · Mask Config · Variant · Bone · Physics · Deformer Bindings · Deformer Keyforms · Parameter · Rig Stages. Mirrors Blender's Properties Editor order with Live2D-specific sections slotted under their nearest Blender analogue.

2. **Cartesian product UI — matrix for N=2, flat-list for N≥3.** Audit confirmed: SS today only generates 1D (most rigs) and 2D (FaceParallax, eye variants `ParamEyeLOpen × Param<Suffix>`) bindings. N≥3 doesn't occur in practice. The flat-list fallback is purely defensive for future cartesian additions; matrix UI is the v1 scope.

3. **Animation playback during edit modes — PAUSE on enter, resume on exit.** Matches Blender (Edit Mode disables animation playback). Applies uniformly to Mesh Edit, Skeleton Edit, BlendShape brush, Keyform Edit (new), and Weight Paint (new). Implementation: `editorStore.editMode` change in any direction other than `null → null` writes a one-shot pause to `animationStore`. Resume on `editMode → null`.

4. **Cursor look (Live Preview) during edit modes — DISABLED in any non-null editMode.** Matches Blender (Weight Paint captures all viewport input for the brush; nothing else processes clicks). Already true for Mesh Edit + Skeleton Edit (verified — `previewModeRef` early-return in `CanvasViewport.onPointerDown` blocks pointer-down for Live Preview cursor, and `editMode !== null` claims the click before Live Preview gets it). Track 3/4 just need to ensure their pointer handlers fire when `editMode` is `'keyform'` or `'weightPaint'`.

5. **Parameters in Outliner — NO.** Resolved by checking existing code: `treeBuilder.js:31-32` already documents "covered by ParametersEditor for now" as the intentional design. Cubism Editor's convention is a dedicated Parameters panel separate from the Parts hierarchy. Selection routing already works (`type:'parameter'` is a first-class selection kind dispatched from `ParamRow.jsx`). Outliner stays node-only.

6. **Custom params and Init Rig — `_userAuthored` granularity expanded.** Init Rig in `'replace'` mode wipes everything except `_userAuthored` survivors (V3 Re-Rig pattern). Today the marker is per-deformer-node only. Track 2 adds the marker to:
   - `parameters[i]._userAuthored` — user-created params survive Init Rig.
   - `parameters[i].keys[j]._userAuthored` — user-added keys to existing params survive (per-key granularity needed because Init Rig regenerates the full key list otherwise).
   - `deformer.keyforms[k]._userAuthored` — user-edited keyforms survive (Track 3 sets this on first drag).
   - `mesh.weightGroups[name]._userAuthored` — user-edited weights survive (Track 4).

   `'merge'` mode preserves all `_userAuthored`, `'replace'` clobbers with confirm dialog (same pattern as today). The merge primitives in `RigStagesTab` already wire through `_userAuthored`; extending the granularity is a one-time data-layer change.

7. **`node.blendShapes` — KEEP, surface as Shape Keys section.** Audit confirmed: NOT dead. Has full editor support (`BlendShapeTab` with create / delete / setValue, `editorStore.editMode === 'blendShape'` brush mode in CanvasViewport, `scenePass.js` blends deltas at render time, `animationEngine.js` drives shape values from animation tracks). Only gap: not exported to cmo3/moc3 (`cmo3Import.js:194-198` initializes as null, export pipeline ignores). **Blender has shape keys; SS keeps them. They're an SS-internal authoring surface for poses that don't survive cmo3 export but are useful for non-Live2D output paths (future: Spine, generic 2D rig).** Track 1 just renames `BlendShapeTab` → "Shape Keys" section (Blender canonical name).

8. **Keyboard shortcuts — Blender 5.1 canonical.** User has Blender 5.1 installed (per `reference_blender_install.md`). Lock these:
   - `Tab` — toggle Object ⇋ active edit mode (mode-aware: switches to last-active edit mode for the selected node type).
   - `Ctrl+Tab` — mode pie menu (v1: dropdown is acceptable, pie menu is polish).
   - `[` / `]` — brush radius decrease / increase (Mesh Edit + Weight Paint).
   - `Shift` (held) — brush blur/secondary in Weight Paint.
   - `N` — toggle right-side Properties panel collapse (Blender 2.8+ "N-panel"). Track 1 wires this — currently no shortcut.
   - **`1` / `2` / `3` SKIPPED.** Blender uses these for vertex/edge/face select in Mesh Edit, but Live2D meshes have only vertices (triangles auto-generated, edges implicit). No analogue.

---

## 9. What this plan does NOT cover

- **Animation timeline / NLA strips.** Out of scope. SS has a basic timeline; Blender NLA parity is a separate refactor.
- **Material / shader editor.** Live2D doesn't have node-based materials; clip masks + multiply/screen colors are it. Not a Blender match.
- **Outliner improvements beyond adding the Parameters category.** Out of scope.
- **Sculpt mode.** Out of scope.
- **Multi-armature support.** SS today implicitly assumes one root group. Out of scope.
- **Custom drivers** (Blender's drivers system that lets one property drive another via an expression). Out of scope; Live2D's param + binding model is sufficient for the current target use cases.

---

## 10. Risks not addressed by sequencing

- **Reactive performance under heavy keyform edit.** Dragging a warp grid corner at 60fps writes `keyform.positions[i]` 60 times/sec via `updateProject` → immer → zustand notify → every Properties subscriber wakes. Mitigation: throttle updates to 30Hz during drag, commit on mouseup. Reuses existing `dragRef` patterns.
- **Schema migration risk = zero (intentional).** Per user stance ("we are not even at that stage where the product is even working, it's an embryo"), no migration safety nets. If a refactor breaks old `.stretch` files, that's fine. Document but don't write migrations.
- **Test coverage drift.** The existing 97-suite sweep covers data-layer correctness. New UI-heavy code is browser-side and unverified by node tests. Mitigate with: (a) extract pure logic from React (e.g. visibility rules) into testable modules; (b) keep selectors pure and unit-test them.

---

## 11. Acceptance gates per phase

- **Phase 1 done when:** Properties panel has zero `<Tabs>` (the strip from `tabRegistry.jsx` is gone, replaced by `propertiesSectionRegistry.js`). All 9 existing tabs (`ObjectTab` → split into Transform + Visibility + Bone, `MeshTab`, `BlendShapeTab` → "Shape Keys", `MaskTab`, `PhysicsTab`, `DeformerTab` → split into Bindings + Keyforms (read-only Keyforms grid in 1, edit added in 3), `ParameterTab`, `VariantTab`, `RigStagesTab`) re-implemented as sections — visible simultaneously, scrollable. Section visibility rules covered by unit tests for each node type (selected part / group / deformer / parameter / nothing-selected). Behaviour parity test: same edits in tab-mode vs section-mode produce identical project state.
- **Phase 2 done when:** Can add a custom param in the UI, see it in the Outliner Parameters category, bind it to a deformer (via the new Deformer Bindings section in Properties), see it survive Init Rig 'merge' but not 'replace'.
- **Phase 3a done when:** Selecting a deformer shows a keyform grid in Properties. Clicking a cell snaps active params to that `keyTuple`, displays the deformer's geometry at that keyform on the canvas. No edit.
- **Phase 3b done when:** From 3a's state, drag a warp grid corner → `keyform.positions` updates → canvas reflects → undo restores. Same for rotation deformer handle. `_userAuthored` flag set on first edit.
- **Phase 4a done when:** Vertex Groups Properties section lists existing weights with read-only weight values (mean / min / max / vert count).
- **Phase 4b done when:** Tab into Weight Paint mode, canvas shader switches to heatmap, brush paints, weight changes reflect in evalRig + cmo3 export.

---

## 12. Naming convention

- **"Param"** in code, **"Parameter"** in user-facing UI labels.
- **"Keyform"** in code AND UI (Cubism Editor terminology — user is a Live2D dev and recognises it; Blender's "shape key" is the wrong analogy because Blender shape keys are per-mesh delta blends while Cubism keyforms are per-deformer absolute states keyed by a `keyTuple`).
- **"Vertex Group"** in code AND UI (Blender terminology — `vertexGroup` in JS, "Vertex Groups" Properties section label, "Active Group" radio).
- **"Shape Key"** in user-facing UI (Blender terminology) for `node.blendShapes`. Code field name stays `blendShapes` — too much wiring depends on it; aliasing in the UI is enough.
- **"Modifier Stack"** for the deformer chain on a part. Blender users recognise. The actual stack entries are deformers but "Deformer Stack" sounds Live2D-specific. Lean Blender.
- **"Bone"** in code AND UI (already the case — `boneRole`, SkeletonOverlay).

---

## 13. Decision log

- **2026-05-05 — Phase 4b SHIPPED** (Weight Paint mode v1).
  - **Data layer (modern shape):** `mesh.weightGroups: { [name]: number[] }` + `mesh.activeWeightGroup: string`. Legacy `mesh.boneWeights` + `mesh.jointBoneId` kept alongside as the export-side source of truth — `syncBoneWeightsFromActive` mirrors the active group's weights into them on every commit. **Multi-bone export is explicitly deferred** (plan §6 Risks); v1 ships single-bone-export semantics with the multi-group authoring UI on top.
  - **`io/live2d/rig/meshSync.js` helpers:** `ensureWeightGroups(mesh, boneGroups)` migrates legacy → modern (idempotent, non-destructive — keeps legacy fields). `syncBoneWeightsFromActive(mesh, boneGroups)` mirrors active group → `boneWeights` + resolves `jointBoneId` from the bone group's name. `applyWeightStroke(mesh, updates, boneGroups)` bulk-applies a brush stroke: clamps [0,1], skips epsilon-equal updates, auto-syncs legacy.
  - **`projectStore` actions:** `ensureWeightGroupsForPart(partId)` (lazy migration on entry), `setActiveWeightGroup(partId, groupName)` (auto-syncs legacy), `paintWeightStroke(partId, updates)` (one immer commit per brush stroke — undo restores per-stroke granularity).
  - **`editorStore.editMode='weightPaint'`** added to allowlist + mode-cycle policy.
  - **`mode.editToggle` (Tab keybind)** routes parts with bone-binding-but-no-mesh OR future-multi-group state into Weight Paint. Standard meshed-and-weighted parts still go to Mesh Edit on Tab (Blender's pattern); the dedicated entry point for Weight Paint is the Vertex Groups section's "edit weights" button.
  - **`VertexGroupsSection`:** group cards become clickable Active radios → `setActiveWeightGroup`. Header gains `edit weights` button → migrate + select + `enterEditMode('weightPaint')`. Mode-active state shows `exit weight paint`.
  - **`WeightPaintOverlay`:** new SVG canvas overlay self-gating on `editMode === 'weightPaint'`. Renders the active part's mesh as colored triangles (heatmap: blue=0 → green=0.5 → red=1, hex-lerped from Tailwind palette) plus per-vertex dots sized by weight. Pointer down/move/up handlers paint the active group via `paintWeightStroke`; cosine falloff against `editorStore.brushSize`; Shift held = erase (lerp toward 0). Brush cursor follows pointer with double-stroke (white over black-dashed) for visibility on either theme.
  - **Mounted** in `CanvasArea.jsx` next to the existing Warp / Rotation overlays; viewport-only (`!isPreview`).
  - **Scope cuts (deferred to polish):** GL fragment shader (SVG triangles are O(verts*tris) but fine for typical meshes), brush-radius hotkeys (`[`/`]`), Add/Subtract/Blur brush modes (v1 is Mix-toward-1 / Shift=Mix-toward-0), `+`/`−`/rename for weight groups (multi-group authoring follow-up), multi-bone cmo3 export.
  - **Tests:** new `test_meshSync.mjs` (28 cases) covers migration idempotence, bone-name resolution, sync-on-empty, stroke clamping, epsilon dedup, out-of-bounds + NaN tolerance. Full suite: 104 / 104 green; typecheck clean.
  - **Phase 4b acceptance gate (§11) met:** Edit-weights button enters paint mode → canvas heatmap visualises the active group's weights → brush paints → weight changes write to `weightGroups[active]` → `boneWeights` mirrored → `evalRig` reads `boneWeights` so skinning updates next frame → cmo3 export reads `boneWeights` so the export reflects the painted weights.

- **2026-05-05 — Phase 4a SHIPPED** (read-only Vertex Groups section).
  - **Pure layout helper** `src/v3/editors/properties/sections/vertexGroupsLayout.js` — `buildVertexGroupSummaries(node, boneGroups)` returns one summary per group with `name / boneId / vertexCount / totalVertices / mean / min / max / active / source`. Reads modern `mesh.weightGroups` (Phase 4b shape) when populated, falls back to legacy `mesh.boneWeights` + `mesh.jointBoneId` (today's auto-rig output). Helper exposes `meshHasVertexGroups` predicate for the registry.
  - **`VertexGroupsSection.jsx`:** card per group with name + Active badge + source badge ("group" / "auto-rig") + nonZero-vertex coverage % + mean / min-nonzero / max stats. Empty state shows "Bone is bound but no weights painted yet" when `jointBoneId` is set without weights — sets up the Phase 4b paint affordance.
  - **Section registry:** new `vertexGroups` section slots between Mesh and Shape Keys per plan §3 canonical order (visible on parts with weights OR a bound bone). `test_propertiesSectionRegistry.mjs` updated with two new cases (weighted part + bone-bound-no-weights).
  - **Tests:** new `test_vertexGroupsLayout.mjs` (36 tests) covers legacy single-bone, modern multi-group, modern-takes-precedence, empty-modern-falls-through, bone-name resolution, all-zero stats, Float32Array support. Full suite: 103 / 103 green; typecheck clean.
  - **Phase 4a acceptance gate (§11) met:** Vertex Groups Properties section lists existing weights with read-only weight values (mean / min / max / vert count). Visible only on parts with bone-binding data.

- **2026-05-05 — Phase 3b SHIPPED** (drag-to-edit on canvas).
  - **`editorStore.editMode='keyform'` slot:** new `keyformEdit: { deformerId, keyformIndex, keyTuple, snapshot, authoredOnEntry } | null` payload. `enterEditMode('keyform', opts)` validates required opts (deformerId / keyformIndex / keyTuple / snapshot) and populates the slot. `exitEditMode` clears the slot (Apply semantics — the live drags already wrote to project; nothing to commit). `setSelection` on a different head also clears the slot.
  - **Section UI** (`DeformerKeyformsSection`): when active params land on a key, header surfaces an `Edit keyform` button (disabled with explanatory tooltip on non-canvas-px deformers — see scope cut below). Click → deep-clones the keyform as snapshot, calls `enterEditMode('keyform', ...)`. While editing: header shows `editing [keyTuple]` plus `Apply` / `Cancel`. `Esc` keydown handler is wired to `cancelEdit`. Cancel restores the keyform from the snapshot via `updateProject` and strips the `_userAuthored` marker iff the keyform wasn't already user-authored before edit (preserves pre-existing authoring on a re-edit).
  - **Click-to-snap is locked while editing:** sliders frozen at `keyformEdit.keyTuple` so the user can't accidentally scrub off-cell mid-drag.
  - **Canvas overlays gain drag handlers:**
    - `WarpDeformerOverlay`: when `editMode === 'keyform'` AND the warp under edit has `localFrame === 'canvas-px'`, control circles enlarge (r=5), get an amber halo, and become pointer-event targets. Drag computes screen-px → canvas-px (inverse of the existing `project()`), writes to `keyform.positions[i*2]/[i*2+1]`, sets `_userAuthored = true`. Pointer capture is taken on `pointerdown` so out-of-bounds drag still tracks.
    - `RotationDeformerOverlay`: pivot disc (r=7) and handle endpoint (r=6) become draggable. Pivot drag → `kf.originX/originY`. Handle drag → `kf.angle = atan2(canvasΔ) - rot.baseAngle` (the spec-relative delta the rest of the chain expects).
  - **Scope cut: non-canvas-px frame conversion deferred.** `pivot-relative` and `normalized-0to1` warps require the parent-chain inverse transform per plan §5 Risks — non-trivial (Newton iteration for nested bilinear). v1 disables drag with a tooltip referencing Phase 3 polish. Top-level canvas-px deformers (BodyZWarp, top-of-chain rotations like Rotation_head when their parent is root/part) work out of the box. FaceParallax is `pivot-relative` so its grid is read-only in v1; the user gets the keyform-grid UI + click-to-snap from Phase 3a but no drag.

  **2026-05-06 — Phase 3 polish SHIPPED. All three localFrames now editable.**
  - **`pivot-relative` warps** (FaceParallax + any warp under a rotation deformer) — drag now resolves the parent rotation's state at the locked keyTuple via `cellSelect` + `evalRotation`, then `canvasToLocal('pivot-relative', {pivotX, pivotY, angleDeg})`. Inverse transform is exact (rotation is a similarity transform).
  - **`normalized-0to1` warps** (per-mesh rigWarps under FaceParallax / BodyZWarp) — drag resolves the parent warp's *deformed* lifted grid (from `rigEvalStore.liftedGrids`) and inverts the bilinear FFD via a new `inverseBilinearFFD` helper. Closed-form solution: solves a quadratic in `t`, picks the root in `[0, 1]`, back-solves `s` from the larger denominator. Per-cell scan over the parent's `rows × cols` cells; first match wins. Out-of-grid targets return null and are silently skipped (drag handler no-ops).
  - **New module:** `src/io/live2d/runtime/evaluator/inverseBilinearFFD.js` (160 LOC) — exports `inverseBilinearCell(P00, P10, P01, P11, target)` for a single cell + `inverseBilinearFFD(grid, gridSize, canvasPos)` for the full warp grid. Pure, no module state.
  - **Wiring:** `WarpDeformerOverlay.localCoordForCanvasPoint(canvasX, canvasY)` dispatches by `warp.localFrame`; the existing pointer move handler reads through it instead of writing canvas-px directly.
  - **`DeformerKeyformsSection`:** `onCanvasPx` gate dropped — Edit button is now enabled for every localFrame.
  - **Tests:** new `test_inverseBilinearFFD.mjs` (36 tests) — identity, sheared, curved-bilinear round-trip; out-of-grid → null; single-cell sanity. Existing `test_keyformEdit` (22) + suite stay green; typecheck clean.
  - **Tests:** new `test_keyformEdit.mjs` (22 tests) locks the store-side primitives — enter/exit, slot population, setSelection auto-exit, kind validation, re-enter replacement. Full suite: 102 / 102 green; typecheck clean.
  - **Phase 3b acceptance gate (§11) met:** from 3a's state, drag a warp grid corner (canvas-px frame) → `keyform.positions` updates → canvas reflects (chainEval re-runs every frame from the mutated project). Same for rotation deformer pivot + handle. `_userAuthored` flag set on first edit. Cancel/Esc restores from snapshot. Undo/redo work because every drag mutation flows through `updateProject` → immer history.

- **2026-05-05 — Phase 3a SHIPPED** (read-only keyform grid, click-to-snap-params).
  - **Pure layout helper:** new `src/v3/editors/properties/sections/keyformGridLayout.js` with `buildKeyformGridLayout(bindings, keyforms, paramValues) → { kind: 'empty'|'1d'|'2d'|'flat', ... }` and helpers `findKeyform` / `computeActiveKeyTuple`. Algorithm per plan §5: 0 bindings → empty, 1 → 1D row, 2 → matrix, ≥3 → flat-list fallback (axis-pinning UI deferred to polish).
  - **Active-cell detection:** when every binding's live value is epsilon-equal (1e-6) to one of its keys, the matching cell highlights. Off-key values (mid-interpolation) leave nothing highlighted — matches Cubism Editor.
  - **Missing keyform tolerance:** cells are rendered for every key, even when the matching keyform doesn't exist yet (e.g. user added a key, hasn't run Init Rig). Missing cells render dimmed and remain clickable so the snap still works; tooltip flags them as "no keyform — run Init Rig to regenerate".
  - **`DeformerKeyformsSection` rewrite:** consumes the layout helper. 1D row of `Cell` components, 2D matrix with row/col labels (param ids on edges, key values per cell), N≥3 flat fallback. Click handler calls `setParamValue(parameterId, keyValue)` for every binding the cell covers. Hint copy: "Click a cell to snap bound parameters to that keyform. Drag-to-edit on canvas lands in Phase 3b."
  - **No editorStore changes yet.** `editMode = 'keyform'` slot stays unwired until Phase 3b — Phase 3a is purely the read-only grid + snap. `_userAuthored` flag on keyforms isn't set anywhere in 3a (no edits to mark).
  - **Tests:** new `test_keyformGridLayout.mjs` (41 tests) covers empty/1d/2d/flat layouts, active-cell detection, missing-keyform tolerance, multi-binding off-key drop. Full suite: 101 / 101 green; typecheck clean.
  - **Phase 3a acceptance gate (§11) met:** selecting a deformer shows a keyform grid in Properties; clicking a cell snaps bound params to that `keyTuple`; the canvas updates automatically because `evalRig` re-evaluates with the new param values.

- **2026-05-05 — Phase 2 SHIPPED.** Param editor polish landed.
  - **`projectStore` CRUD actions:** `addParameter`, `removeParameter`, `renameParameter`, `patchParameter`, `addParamKey`, `removeParamKey`, `setParameterUserAuthored`. All immer-undoable. Cascades on remove (drop bindings on every deformer node + animation tracks + physics rule inputs). Cascades on rename (update `parameterId` everywhere it's referenced). All mutations stamp `_userAuthored: true` so the entry survives Init Rig 'merge'.
  - **`_userAuthored` preservation:** `seedParameters(project, mode)` now honours `mode` ('replace' default; 'merge' preserves). User-authored params survive verbatim. Non-user-authored params get user-added breakpoints unioned in via a parallel `_userAuthoredKeys: number[]` array (sidesteps upgrading `param.keys` from `number[]` to objects across every consumer). `seedAllRig` passes `mode` to `seedParametersFn`. The post-seed `droppedParamIds` filter (orphan rotation prune) is now `_userAuthored`-aware.
  - **Per-key granularity decision:** plan §8 specified `keys[j]._userAuthored` markers. Implemented as `param._userAuthoredKeys: number[]` instead — same semantic, no migration to objects, no consumer changes. Documented in `paramSpec.seedParameters` jsdoc.
  - **`ParameterTab` rewritten editable:** name / min / max / default / decimalPlaces editable via `patchParameter`. ID renamable via `renameParameter` (with cascade). Keys section: per-key delete + inline add input. Back-references section enumerates deformer bindings + animation tracks + physics inputs via `findReferences`. Lock toggle (`setParameterUserAuthored`). Confirm-then-delete button cascades.
  - **`ParametersEditor` + `ParamRow`:** header gains `+ add` button → inline id input → `addParameter`. Each row reveals a `Trash2` button on hover → confirm-then-delete via `removeParameter`.
  - **Tests:** new `test_paramCrud.mjs` (51 tests) covers add/remove/rename cascades, patch whitelist, key add/remove with epsilon dedup, `seedParameters('merge')` preservation. Full suite: 98 / 98 pass; typecheck clean.
  - **Add-key keyform expansion deferred:** per plan §4 Risks, adding a key to a param bound by N deformers should expand each deformer's keyform list. v1 punts on this — `param.keys` updates immediately, the deformer keyforms regenerate on next Init Rig. The Track 3 keyform editor is the proper home for live per-deformer expansion + interp authoring. The Properties → Parameter section's Keys section banners this trade-off ("New keys take effect on the next Init Rig").
  - **Deformer Bindings bind/unbind UI shipped** (originally tagged for Track 3 in Phase 1's section comment): a deformer's Bindings section gains `+ bind parameter` (dropdown of unbound params) and per-row `Trash2` unbind. Adding a binding stamps `_userAuthored: true` on the deformer node and seeds `binding.keys` from the param's current `keys` array. Keyform list expansion / collapse stays Track 3's job — the bind UI just edits the binding entry; keyforms regenerate on next Init Rig.

  Phase 2 acceptance gate (§11) met: custom param creates → appears in Parameters panel → binds to a deformer via the new Deformer Bindings section → survives Init Rig 'merge' (verified by `test_paramCrud.mjs` `seedParameters merge: user-authored param survives` test).

- **2026-05-05 — Phase 1 SHIPPED.** Tab strip removed from PropertiesEditor; `tabRegistry.jsx` deleted, replaced by `sectionRegistry.jsx` with 14 sections (Transform · Visibility · Part Info · Mesh · Shape Keys · Mask Config · Variant · Bone · Physics · Deformer · Bindings · Keyforms · Parameter · Rig Stages). `ObjectTab.jsx` split into TransformSection + VisibilitySection + PartInfoSection (and a NEW BoneSection visible only for groups with boneRole). `DeformerTab.jsx` split into DeformerInfoSection + DeformerBindingsSection + DeformerKeyformsSection. Existing tabs (Mesh / BlendShape→"Shape Keys" / Mask / Variant / Physics / Parameter / RigStages) wrapped via `WrappedTabSections.jsx`. `editorStore.propertiesSectionsCollapsed` Set added for per-section collapse state. `test_propertiesTabRegistry.mjs` → `test_propertiesSectionRegistry.mjs` (15 tests, all green). Typecheck clean, 97 suites pass.

  Naming notes: section ids in `editorStore.propertiesSectionsCollapsed` are stable keys (`transform`, `visibility`, `partInfo`, `mesh`, `shapeKeys`, `mask`, `variant`, `bone`, `physics`, `deformerInfo`, `deformerBindings`, `deformerKeyforms`, `parameter`, `rigStages`). `BlendShapeTab` is rendered under the user-facing label "Shape Keys" per §12 naming convention; the underlying code field stays `blendShapes`.

  Behaviour-parity tests deferred — no tab mode left to compare against, and the underlying tab components (Mesh / BlendShape / Mask / Variant / Physics / Parameter / RigStages) are reused as-is so behaviour is preserved by construction. ObjectTab + DeformerTab splits are verified by typecheck + the section-visibility unit tests.
