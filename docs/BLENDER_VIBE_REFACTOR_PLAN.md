# Blender Vibe Refactor — Outliner, Properties Visual, Mode Dichotomy, Open Gaps

**Status:** ✅ All 8 phases + 2 follow-ups shipped 2026-05-06 · **Drafted:** 2026-05-05 · **Owner:** pelmentor

## Follow-ups shipped 2026-05-06 (after the 8-phase initial sweep)

- **Phase 3 polish (V4 Track 3) — non-canvas-px keyform editing.** New `inverseBilinearFFD` helper (closed-form quadratic) + `pivot-relative` route via `cellSelect` + `evalRotation` + `canvasToLocal`. FaceParallax + per-mesh RigWarps now drag-editable. `DeformerKeyformsSection.onCanvasPx` gate dropped. 36 new assertions. Documented in [V4_BLENDER_PARITY_PLAN.md](V4_BLENDER_PARITY_PLAN.md).
- **BVR-004 follow-up — `rest.rotation` for bones unlocked.** v17's "transform.{rotation, x, y, scale} reserved at identity for bones" contract is lifted; those fields are now the bone's REST layout, editable in Armature Edit Mode. New `readRestValue` / `writeRestValues` helpers in [animationEngine.js](../src/renderer/animationEngine.js). `beginModalTransform` branches on `editMode === 'armatureEdit'` to capture/write rest fields; `modalTransformStore.restFrame` flag threaded through to overlay; revert path uses the matching writer. Modal G/R/S in Armature Edit Mode now writes `transform.{pivotX/Y, rotation, scaleX/Y}` (rest), not pose. ModePill + ToolSettingsPanel hints updated. 24 new assertions in [test_restRotation.mjs](../scripts/test/test_restRotation.mjs); existing suite green; typecheck clean.

- **BVR-004 deferred — Pose Mode joint drag now writes `pose.x/y`.** Closes the last UX inconsistency in the Edit/Pose dichotomy. Previously `editMode === 'skeleton'` (Pose Mode) joint drag wrote `transform.pivotX/Y` direct (= editing rest while in Pose Mode — wrong). Now it routes through new `preparePoseTranslate` / `applyPoseTranslate` helpers in [transforms.js](../src/renderer/transforms.js): drag-start captures `inverse(parentWorldWithPose × restMatrix)` + pivot; mousemove is one matrix-point multiply yielding `pose.{x,y}` such that the joint dot lands at the cursor. Math: `pose = inverse(parentWorld × restM) · target − pivot`. Works through arbitrary parent chains (parent's pose included; this bone's own pose excluded). Also fixed CanvasViewport `skeletonEditMode` prop to `editMode === 'skeleton' || 'armatureEdit'` (BVR-004 ship had it gated on `'skeleton'` only, which silently broke armatureEdit joint drag). 12 new assertions in [test_poseTranslate.mjs](../scripts/test/test_poseTranslate.mjs).

## Shipping summary (2026-05-06)

All eight phases landed in one autonomous session. Per-phase changelog:

| ID      | What shipped | Files (representative) | Tests |
|---------|--------------|------------------------|-------|
| BVR-001 | BUG-023 instrumentation: `loadProject` summary log + `paramOrphans` warn + `rigSpecPostLoad` auto-fill OK/SKIPPED log. E2E roundtrip test verifying file-format layer is clean. (Browser-side root cause still pending repro.) | `src/store/projectStore.js`, `src/store/rigSpecStore.js`, `scripts/test/test_saveLoadRigSpec.mjs` | 19 new |
| BVR-002 | Properties Section visual: Blender N-panel pattern — header band (`bg-muted/50`, `text-foreground font-medium`) + flat body (`bg-transparent`) + thin section dividers. | `src/v3/editors/properties/sections/SectionShell.jsx`, `src/v3/editors/properties/PropertiesEditor.jsx` | n/a (visual) |
| BVR-003 | Outliner synthetic Armature root: `wrapArmature` injects pseudo-node grouping all top-level bones in viewLayer + skeleton modes. Bone rows tinted sky-400. Click on synthetic routes to first child bone. | `src/v3/editors/outliner/treeBuilder.js`, `src/v3/editors/outliner/TreeNode.jsx`, `src/v3/editors/outliner/OutlinerEditor.jsx` | +12 (existing test updates + 3 new BVR-003 tests) |
| BVR-004 | Edit Mode / Pose Mode dichotomy: new `editorStore.editMode === 'armatureEdit'` value. `shiftBonePivot` action with descendant-follow. SkeletonOverlay branches on mode. Modal R/S no-op in armatureEdit. Apply Pose As Rest UI gate. ModePill labels: "Pose Mode" + "Armature Edit". Tab cycles Pose ↔ Armature Edit when bone selected. | `src/store/editorStore.js`, `src/store/projectStore.js`, `src/components/canvas/SkeletonOverlay.jsx`, `src/v3/operators/registry.js`, `src/v3/shell/ModePill.jsx`, `src/components/canvas/CanvasViewport.jsx` | 12 new |
| BVR-005 | Modal G/R/S numeric type-in HUD: `modalTransformStore.typedBuffer` + `appendTyped` / `popTyped` / `clearTyped`. Buffer overrides mouse delta when non-empty (translate=px, rotate=°, scale=×). HUD shows live buffer with unit suffix. | `src/store/modalTransformStore.js`, `src/v3/shell/ModalTransformOverlay.jsx` | 11 new |
| BVR-006 | Outliner drag-reparent: TreeNode HTML5 drag handlers; OutlinerEditor `onReparent` → `projectStore.reparentNode`. Cycle detection + bone-onto-part rejection + dangling-target safety. Synthetic Armature drop routes bone-to-root. Disabled in rig mode (deformer reparent is footgun-prone). | `src/store/projectStore.js`, `src/v3/editors/outliner/TreeNode.jsx`, `src/v3/editors/outliner/OutlinerEditor.jsx` | 9 new |
| BVR-007 | N-panel (right-edge tool settings): new `ToolSettingsPanel` component. Mode-driven content (Brush sliders for paint modes, mode hints for armature modes). `editorStore.toolPanelVisible` + `toggleToolPanel`. N keybind via `panel.toolSettingsToggle` operator. | `src/v3/shell/ToolSettingsPanel.jsx`, `src/v3/shell/CanvasArea.jsx`, `src/store/editorStore.js`, `src/v3/operators/registry.js`, `src/v3/keymap/default.js` | n/a (UI) |
| BVR-008 | Outliner parent-relationship lines: thin vertical guide rules at each ancestor's indent column (sky-tint when bone-row, default border otherwise). | `src/v3/editors/outliner/TreeNode.jsx` | n/a (visual) |

**New tests:** 5 (`test_saveLoadRigSpec`, `test_armatureEditMode`, `test_modalTransformTyped`, `test_reparentNode`, plus extensions to `test_outlinerTreeBuilder`).
**Total new assertions:** 60+ across the new tests + outliner extensions.
**Full suite:** all green. Typecheck clean.

### Decisions made during ship

1. Synthetic Armature kept as data-model-free UI shim (per Decision Log #1) — no schema bump.
2. `editMode === 'skeleton'` kept its name (= Pose Mode) instead of renaming to `'pose'` — minimizes callsite churn (7 callers). New `'armatureEdit'` is opt-in via Tab + ModePill row.
3. `'armatureEdit'` joint drag uses `shiftBonePivot` with descendants-follow; **does NOT swap the existing skeleton-mode joint-drag-writes-pivot behavior**. Rationale: existing UX preserved; armatureEdit is the additive Blender-Edit-Mode equivalent.
4. Modal R/S in armatureEdit return at the `beginModalTransform` gate — no overlay activation. Avoids a half-modal where R/S looks active but writes go nowhere.
5. T-panel naming: kept Blender-correct. CanvasToolbar (left) = T-panel (tool picker, already shipped). New right-edge component = N-panel (active-tool/item settings). Plan §9 used "T-panel" loosely; the doc was updated to match Blender vocabulary in this summary.
6. N keybind only — no Ctrl modifier. Bare-letter chord matches Blender exactly. Conflicts with Ctrl+N (file.new) avoided since chord builder distinguishes modifier prefixes.

### Out of scope (unchanged from plan)

V4 Track 2/3/4 (Param editor / Keyform editor / Weight Paint v2) and `rest.rotation` for bones still deferred. BVR-004 disables R/S in armatureEdit by design — when `rest.rotation` lands, those gates can be opened.

---

The thing this plan delivers: **close the remaining "this isn't quite Blender" gaps now that v17 rest/pose split has shipped.** Outliner gets a real Armature container; Properties panel gets readable section hierarchy; Edit Mode and Pose Mode become structurally distinct (matching the data layer we just built); and the long tail of small Blender-isms (drag-reparent, numeric type-in HUD, parent lines, T-panel) gets sequenced.

Not in scope: V4 Track 3 (Keyform Editor) and Track 4 (Weight Paint v2) — they have their own plan in [docs/V4_BLENDER_PARITY_PLAN.md](V4_BLENDER_PARITY_PLAN.md) and depend on this work landing first.

---

## 1. Why now

The architecture is finally Blender-shape. Schema v17 split rest from pose; BFA-006 promoted deformers to first-class `project.nodes` entries; V3 re-rig flow preserves user authoring across re-runs; V4 Track 1 sectioned the Properties panel.

What's left is the **surface** catching up to the data layer:

- `node.pose` is real, but Edit Mode and Pose Mode aren't structurally distinct — gizmo + outliner click still trigger pose writes regardless of mode. That's a hidden costyl.
- Properties sections are sectioned (good) but visually too flat to scan (`bg-card/30` + faint header).
- Bones live in `project.nodes` peer-to peer with parts/groups. Outliner has a `'skeleton'` filter mode that hides non-bones, but there is **no Armature object** the user can collapse / drag / parent things into.
- Modal G/R/S works but lacks numeric input — the Blender hallmark.
- Outliner is read-only — no drag-reparent, no parent-relationship lines.

---

## 2. Inventory

| ID | Item | Effort | Risk | Phase |
|----|------|--------|------|-------|
| BVR-001 | BUG-023 save/load triage | unknown | release blocker | 0 |
| BVR-002 | Properties section visual polish | 30 min | nil | 1 |
| BVR-003 | Outliner Armature synthetic root + bone-row tint | 1–2 h | low | 2 |
| BVR-004 | Edit Mode / Pose Mode dichotomy formalization | 0.5–1 day | medium (touches gizmo + applyPoseAsRest gate) | 3 |
| BVR-005 | Modal G/R/S numeric type-in HUD | 2–3 h | low | 4 |
| BVR-006 | Outliner drag-reparent | 0.5 day | medium (cycle detection, validation) | 5 |
| BVR-007 | T-panel split (mode tool settings) | 0.5 day | low | 6 |
| BVR-008 | Outliner parent-relationship lines | 1 h | nil | 7 |

Phase numbering = ship order. BVR-001 first because it's a release blocker; everything after is sequenced by ROI × low-risk-first.

---

## 3. Phase 0 — BUG-023 triage

**Goal:** localize the save→load param breakage. Out: a fix, or a narrowed reproduction with the offending param spec captured.

**Status:** open in [docs/BUGS.md](BUGS.md). Severity: high. The save round-trip drops or corrupts most params — no concrete localisation yet.

**Approach:**
1. Reproduce locally: load any v17 project → save → reload from disk → diff `project.parameters` and `project.nodes[*].keyforms` before vs after.
2. Logs panel (per `feedback_in_app_logging`) + `lib/logger.js` instrumentation in:
   - `src/services/ProjectService.js` (or wherever serialize/deserialize lives)
   - `src/store/projectMigrations.js` (v17 migration may double-fire)
3. Suspect surfaces (rank-ordered):
   - Migration runs twice on already-v17 saves (v17 idempotence test exists but only covers bone groups, not deformer keyforms)
   - Param `keys` array round-trip — Float32Array vs plain array
   - Deformer keyform `positions` Float32Array round-trip via `JSON.stringify`
   - Newly added `node.pose` slot lost on serialize for some bones

**Exit criteria:** save→load round-trip fixture in `scripts/test/test_saveLoadRoundtrip.mjs` (new); BUGS.md entry closed with commit ref.

**Why first:** every other phase ships features. If save/load is broken, those features can't survive a session boundary. Fix the foundation first.

---

## 4. Phase 1 — Properties section visual polish (BVR-002)

**Goal:** make sections scannable at a glance. Header bands, flat body, divider stripe between sections — the Blender N-panel pattern.

**Files:**
- `src/v3/editors/properties/sections/SectionShell.jsx` — header + body styling
- `src/v3/editors/properties/PropertiesEditor.jsx` — between-section dividers (or per-section bottom border)

**Approach:** Blender's pattern is **header band, flat body**. Apply it:
- Header: `bg-muted/60` + `text-foreground font-medium` (drop `text-muted-foreground` for the title)
- Body: `bg-transparent` (drop `bg-card/30`); slight `pl-2` for visual indent
- Between sections: `border-t border-border/50` on the section header, no gap
- Collapse chevron: keep `lucide-react ChevronDown`, but rotate-on-collapse instead of swap

**Tradeoffs considered:**
- **Card pattern** (`bg-card`, hard border) — looked tested in branch but felt heavier than Blender. Rejected for being more "Material Design" than N-panel.
- **Striped alternation** — was option but parity with Blender wins; Blender uses a flat panel with header bands.

**Tests:** none — visual change only. Manual spot-check across 9 sections (ObjectTab, MeshTab, BlendShapeTab, MaskTab, PhysicsTab, DeformerTab, ParameterTab, VariantTab, RigStagesTab).

**Exit criteria:** screenshot diff in commit. No regression in collapse/expand keyboard behaviour.

---

## 5. Phase 2 — Outliner Armature synthetic root (BVR-003)

**Goal:** the user sees a single `Armature` row in the Outliner that expands to reveal the bone hierarchy. Parts-collections (folders) and bones (skeleton) are visually distinct at a glance.

### 5.1 Data model — unchanged

Bones already nest by `parent` chain in `project.nodes`. The "Armature" is the **closure of bone-group ancestors with no bone parent** — i.e. all top-level bones. Synthetic. No migration. No new node type.

### 5.2 `treeBuilder.js` injects synthetic node

Add in `src/v3/editors/outliner/treeBuilder.js` (~561 lines today):

```js
const SYNTHETIC_ARMATURE_ID = '__armature_root__';

function buildViewLayerTree(nodes, ...) {
  const real = buildRealTree(nodes, ...);
  const topLevelBones = real.filter(n => n.isBone && (!n.parent || !isBone(n.parent)));
  if (topLevelBones.length === 0) return real;
  const armature = {
    id: SYNTHETIC_ARMATURE_ID,
    name: 'Armature',
    isSynthetic: true,
    isArmature: true,
    children: topLevelBones,
  };
  // top-level bones are removed from `real` and re-rooted under `armature`
  return [armature, ...real.filter(n => !topLevelBones.includes(n))];
}
```

Selecting `Armature` row dispatches `select({ type: 'armature' })` (new selection type). Properties panel can react.

### 5.3 Visual differentiation

`TreeNode.jsx`:
- Bone rows: `text-sky-400/90` (Blender's bone tint, slightly cooler than foreground)
- Armature row: `Bone` icon + `font-medium`
- Plain group rows ("collections"): unchanged, `Folder` icon, `text-foreground`
- Part rows: unchanged

### 5.4 Filter modes (existing `'viewLayer' | 'skeleton' | 'rig'`)

- `'viewLayer'`: shows Armature container with collapse
- `'skeleton'`: same as today (bones-only via `buildSkeletonTree`); Armature root added on top
- `'rig'`: unchanged (deformers only)

### 5.5 Selection

Adding `'armature'` selection type means:
- `selectionStore.js` accepts `{ type: 'armature' }`
- Properties panel can show an "Armature" section (visibility, layers — like Blender's Object Properties for an Armature)
- Click on Armature row in current model selects nothing (or every bone) — undecided. **Default: select first child bone.** Lets keyboard nav still feel right.

### 5.6 Drag-and-drop deferred

Drop INTO Armature is not implemented in this phase — see Phase 5 (BVR-006). For now Armature is read-only.

**Files touched:** `treeBuilder.js`, `TreeNode.jsx`, `OutlinerEditor.jsx` (add synthetic node skip in keyboard nav?), `selectionStore.js`.

**Tests:**
- `scripts/test/test_outlinerArmature.mjs` (new): verify synthetic root appears for projects with bones, doesn't appear for boneless projects, top-level bones reparent correctly.

**Exit criteria:** Outliner shows Armature row, expand/collapse works, click selects (per 5.5), no regression in skeleton-filter mode.

---

## 6. Phase 3 — Edit Mode / Pose Mode dichotomy (BVR-004)

**Goal:** formalise what's already physically true at the data layer. Edit Mode = pivot/rest authoring; Pose Mode = pose authoring. The gizmo, outliner click, and Properties commit-target read the active mode.

### 6.1 Why this is the biggest item by ROI

Schema v17 split `transform.pivotX/Y` (rest) from `pose.{rotation,x,y,scaleX,scaleY}` (offset). The data is two-bucket. **The UI still treats it as one bucket** — gizmo on a bone writes to whichever bucket the current code path picked, and that's `pose.rotation` whether you wanted to set the rest pivot or animate the pose. Apply Pose As Rest exists but lives in a chevron submenu.

In Blender: Edit Mode on Armature lets you grab a bone and drag — this moves the **rest** position (head/tail). Pose Mode lets you grab the same bone and drag — this animates `pose.location`. Two modes, two write targets, one data structure.

### 6.2 What changes

`useEditorStore.editMode` slot already accepts `null | 'mesh' | 'blendShape' | 'skeleton'`. Promote it:

- `'pose'` (new) — gizmo writes to `node.pose.*`. Apply Pose As Rest enabled.
- `'armatureEdit'` (new, formerly conflated with `'skeleton'`) — gizmo writes to `node.transform.{pivotX,pivotY}` (and rest scale/rotation if/when we add `rest.rotation`). Pose is locked to identity for visual feedback.
- `'skeleton'` (existing) — selection filter only, doesn't gate writes. Renamed to `'skeletonView'` or kept as alias.

Mode switcher: Tab cycles `pose` ↔ `armatureEdit` (matches Blender's Tab toggle).

### 6.3 Write-target matrix

| Action | `pose` | `armatureEdit` | other modes |
|--------|--------|----------------|-------------|
| Gizmo drag rotate | `node.pose.rotation` | `node.transform.pivotX/Y` shift (rotates pivot? or no-op?) | unchanged |
| Gizmo drag translate | `node.pose.x/y` | `node.transform.pivotX/Y` | unchanged |
| Modal R | writes `pose.rotation` | **disabled** (no rest rotation slot today) | unchanged |
| Modal G | writes `pose.x/y` | writes pivot | unchanged |
| Modal S | writes `pose.scaleX/Y` | **disabled** (no rest scale slot today) | unchanged |
| `applyPoseAsRest()` | enabled | **disabled** (rest is what you're editing) | unchanged |

**Open question:** what happens to bone DRAG in `armatureEdit` mode when the bone has children? Blender's answer: rest of children moves with parent (rigid translation); their rest data stays relative. In SS this means **shifting `pivotX/Y` of all descendant bones by the same delta** — equivalent to an applyPoseAsRest pre-bake of `pose.x/y` then zero. Approach: do the same descendant-pivot-shift in `armatureEdit` translate path. No new helper needed.

### 6.4 ModePill / Toolbar surface

ModePill canvas overlay (already shipped per `project_workspace_mode_rework_2026_05_02`) gains "Edit" / "Pose" toggle for armature contexts. Existing edit-mode list extended.

### 6.5 Files touched

- `src/store/editorStore.js` — extend `editMode` enum + write-target getter
- `src/components/canvas/GizmoOverlay.jsx` — branch on `editMode === 'pose'` vs `'armatureEdit'`
- `src/v3/shell/ModalTransformOverlay.jsx` — same branch
- `src/v3/operators/registry.js` — `beginModalTransform` reads from correct slot
- `src/components/canvas/SkeletonOverlay.jsx` — drag commit branch
- `src/store/projectStore.js` — `applyPoseAsRest()` adds `editMode === 'pose'` guard
- `src/v3/shell/ModePill.jsx` — Tab keybind cycle update

### 6.6 Tests

- `scripts/test/test_armatureEditMode.mjs` (new): G in armatureEdit shifts pivot; descendants follow; pose stays at zero; Apply Pose As Rest is disabled.
- Extend `test_applyPoseAsRest.mjs`: verify mode gate.
- Extend `test_modalTransform.mjs` (if exists): R/S disabled in armatureEdit.

**Exit criteria:** Tab toggles modes when armature is selected; gizmo writes to correct slot per mode; applyPoseAsRest only fires from pose mode; descendant pivot shift works on parent translate in armatureEdit.

---

## 7. Phase 4 — Modal G/R/S numeric type-in HUD (BVR-005)

**Goal:** Blender's `G 30 Enter` / `R -45 Enter` / `S 1.5 Enter`. Type during modal, see HUD readout, Enter to commit, Esc to cancel.

**Files:**
- `src/v3/shell/ModalTransformOverlay.jsx` — accumulate digit/sign/dot keystrokes; show HUD at cursor; commit applies typed value verbatim instead of mouse delta
- `src/v3/operators/registry.js` — `beginModalTransform` accepts initial typed-buffer state

**Behaviour:**
- Numeric keys + `.` + `-` accumulate into a buffer
- Backspace deletes last char
- Tab switches axis (X→Y→XY)
- Buffer overrides mouse delta when non-empty
- HUD: small overlay at cursor showing `G: 30.5` / `R: -45°` / `S: 1.5`

**Tests:** add to `test_modalTransform.mjs` — typed value commits regardless of mouse position.

**Exit criteria:** typed values commit faithfully; Esc still cancels; Enter still commits; mouse-only path unchanged.

---

## 8. Phase 5 — Outliner drag-reparent (BVR-006)

**Goal:** drag an outliner row onto another row to reparent. Validates: no cycles, type compatibility (a part can't parent a bone), respects Armature container semantics.

**Files:**
- `src/v3/editors/outliner/TreeNode.jsx` — `draggable`, `onDragStart`, `onDragOver`, `onDrop`
- `src/v3/editors/outliner/OutlinerEditor.jsx` — drop handler dispatches `projectStore.reparentNode(childId, newParentId)`
- `src/store/projectStore.js` — `reparentNode` action with cycle/type validation

**Validation rules:**
- No cycles: walk newParent's ancestry; reject if childId appears
- Drop on Armature synthetic root: reparent to nearest top-level bone (or no-op if not a bone being dragged)
- Drop bone onto part: reject (parts can't own bones in our model)
- Drop deformer: same validation as bone (deformer is rig-side)

**Visual:** drop indicator line above/below target row + highlight on container drop.

**Tests:** `scripts/test/test_outlinerReparent.mjs` — happy path + cycle detection + type mismatch rejection.

**Exit criteria:** drag-reparent works in viewLayer mode for parts and bones; cycles rejected; Armature container behaves intuitively.

---

## 9. Phase 6 — T-panel split (BVR-007)

**Goal:** split tool settings (brush params, mode-specific options) out of ModePill+Toolbar into a dedicated right-side T-panel — Blender's T-shortcut surface.

**Files:**
- `src/v3/shell/AppShell.jsx` (or wherever the layout is) — add right rail
- `src/v3/shell/ToolPanel.jsx` (new) — registry of mode → tool-settings component
- Existing per-mode settings (weight paint brush size, mesh-edit proportional radius) move from ModePill overlays into ToolPanel sections

**Behaviour:** `T` keybind toggles. Default-collapsed for first-launch users.

**Tradeoff:** Toolbar (already shipped left rail) overlaps somewhat with T-panel role. **Decision:** keep Toolbar as tool **picker**, add T-panel as tool **settings**. Same as Blender.

**Tests:** none beyond a smoke test that the panel mounts.

**Exit criteria:** T toggles panel; mode switch updates contents; brush settings live there instead of ModePill.

---

## 10. Phase 7 — Outliner parent-relationship lines (BVR-008)

**Goal:** Blender draws thin vertical lines connecting parent rows to child rows in the Outliner. Indentation alone is harder to scan with deeply nested hierarchies. Pure cosmetic.

**Files:** `src/v3/editors/outliner/TreeNode.jsx` — absolute-positioned vertical lines per nesting level.

**Tests:** none.

**Exit criteria:** lines visible; don't render past the last child.

---

## 11. Decision log

| # | Question | Decision | Why |
|---|----------|----------|-----|
| 1 | Synthetic Armature node vs real `type:'armature'` data model | Synthetic | Reversible; data layer already has bone nesting; can promote later without rework |
| 2 | Properties styling — card pattern vs Blender N-panel pattern | N-panel (header band, flat body) | Matches Blender directly; lighter visual weight |
| 3 | Phase 3 — `armatureEdit` rotates around what? | TBD; default to "no-op for now, add `rest.rotation` later" | 2D-rest limitation already documented in [REST_POSE_SPLIT_PLAN.md](REST_POSE_SPLIT_PLAN.md); deferring full rest rotation is consistent |
| 4 | Tab in armature context cycles which modes? | `pose ↔ armatureEdit` only | Matches Blender exactly; other modes (mesh edit, weight paint) entered via own keybinds |
| 5 | Phase 5 drop on Armature root behaviour | reparent to first top-level bone if dragged item is a bone; otherwise reject | Synthetic root has no parent semantics of its own |
| 6 | Numeric type-in (Phase 4) — does it work in armatureEdit too? | Yes | Same modal infra; mode-gating happens at the slot-write level |
| 7 | Drag-reparent (Phase 5) availability per filter mode | viewLayer + skeleton; not rig | Rig deformers reparent via DeformerTab parent picker; outliner-reparent of deformers is a footgun |

---

## 12. Out of scope

- **Keyform Editor UI** (V4 Track 3) — has its own [V4_BLENDER_PARITY_PLAN.md](V4_BLENDER_PARITY_PLAN.md) sequence; depends on Phase 1 visual landing first.
- **Weight Paint v2** (V4 Track 4) — same.
- **Param editor edit operations** (V4 Track 2) — same.
- **`rest.rotation` for bones** — full Blender parity (3D-style rest matrix) is deferred per [REST_POSE_SPLIT_PLAN.md](REST_POSE_SPLIT_PLAN.md). Phase 3 here works around this by disabling R/S in armatureEdit.
- **Outliner search/filter UI** — exists as `filters.js`; not on the Blender-vibe roadmap.
- **Properties panel split into Object/Mesh/Modifier sub-editors** (Blender's tabbed Properties Editor) — V4 Track 1 explicitly chose the single-column N-panel pattern; reaffirmed here.

---

## 13. Ship sequence + soak gates

1. **Phase 0** — BUG-023 — must close before Phase 1 ships (or at least be reproduced + filed with concrete cause)
2. **Phase 1** — visual polish — can ship anytime; isolated
3. **Phase 2** — Armature root — depends on Phase 1 visual hierarchy already being good (Armature row needs to read as distinct from Folder)
4. **Phase 3** — mode dichotomy — depends on Phase 2 (Armature selection type) for the `armatureEdit` activation surface
5. **Phase 4** — numeric HUD — independent; can land alongside Phase 3
6. **Phase 5** — drag-reparent — depends on Phase 2 (Armature container semantics)
7. **Phase 6** — T-panel — independent
8. **Phase 7** — parent lines — independent, last because it's pure polish

**Recommended pairing for first sweep:** Phase 1 + Phase 2 + Phase 8 in one commit — pure visual + outliner shape changes, all low-risk, all reinforce each other.

**Phase 3 stands alone** — it touches the gizmo, modal, and skeleton overlay, and we want a clean diff for soak-testing.

---

## 14. References

- [REST_POSE_SPLIT_PLAN.md](REST_POSE_SPLIT_PLAN.md) — schema v17 data layer this plan builds on
- [V4_BLENDER_PARITY_PLAN.md](V4_BLENDER_PARITY_PLAN.md) — sibling plan (Tracks 2/3/4)
- [BFA_006_DEFORMER_NODES_PLAN.md](BFA_006_DEFORMER_NODES_PLAN.md) — deformer-as-node refactor that closed sidetables
- [BUGS.md](BUGS.md) — open bug list (BUG-023 lives here)
