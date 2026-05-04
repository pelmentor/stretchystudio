# Blender-Fidelity Audit

**Why this doc.** Stretchy Studio's stated UX target is Blender (with a Live2D rig export pipeline). Over the project's lifetime, Spine-style and Cubism-Editor-style controls leaked into the chrome — separate "are you keyframing" pills, gating workspaces, dual-purpose toggles. This document catalogues:

- **what we already collapsed** (so we don't re-introduce the same patterns), and
- **what's still load-bearing crutch** with a concrete plan to remove each.

The rule of thumb: **one axis, one stored slot, derive the rest**. If a state can be computed from another state, don't store it. If a UI pill controls a thing the user always wants paired with a workspace, the workspace should drive it.

---

## Past wins (reference, do not regress)

| Date       | Crutch removed                                          | What it was                                                                                                | How it was fixed |
|------------|---------------------------------------------------------|------------------------------------------------------------------------------------------------------------|------------------|
| 2026-05-02 | 5 workspaces (Layout/Modeling/Rigging/Pose/Animation)   | Layout/Modeling/Rigging had identical `DEFAULT_AREAS` and only differed via a workspace-policy gate.         | Collapsed to 3 (`edit`/`pose`/`animation`); `workspaceViewportPolicy.js` deleted. |
| 2026-05-02 | `meshEditMode` + `skeletonEditMode` + `blendShapeEditMode` triple | Three booleans pretending to be orthogonal but actually nested (blendShape forced meshEditMode=true).      | Single `editorStore.editMode: null \| 'mesh' \| 'skeleton' \| 'blendShape'` slot. |
| 2026-05-02 | Workspace-gated visualizations                          | `workspaceViewportPolicy` decided which view layers were visible per workspace.                            | Workspaces are pure layout; `viewLayers` is read directly by scenePass. |
| 2026-05-03 | 3 workspaces (`edit` + `pose` + `animation`)            | `edit` and `pose` had structurally identical layouts and only differed by name.                            | Collapsed to 2 (`default`/`animation`). |
| 2026-05-03 | Setup/Animate topbar pill                               | A second "are you keyframing" axis that the user always wanted in lockstep with the workspace.             | `setWorkspace` drives `editorMode` via `EditorModeService`; pill removed (PP2-009). |
| 2026-05-03 | Dead state in editorStore                               | `dragState: {isDragging, partId, vertexIndex}` and `armedParameterId` had no readers.                       | Fields + setters removed (this audit). |
| 2026-05-03 | Redundant `setEditorMode` calls after `setWorkspace`     | `IdleMotionDialog` + `AnimationsEditor` paired `setWorkspace('animation')` with a follow-up `serviceSetEditorMode('animation')`. After PP2-009 the second call is a no-op (idempotent). | Removed both calls + their imports; `setWorkspace` is now the canonical entry. |
| 2026-05-03 | Tab-close `×` on canvas / timeline trio                 | Closing them empties an area with no in-product way back.                                                  | `NON_CLOSABLE_EDITOR_TYPES` allow-list. |
| 2026-05-03 | Inline-tooltip wide bar                                 | shadcn `TooltipContent` had no max-width; long help text stretched across the canvas.                       | Default `max-w-xs`; per-call override still works (PP1-003). |
| 2026-05-04 | `editorStore.editorMode` slot + `EditorModeService` chain | Stored field whose only writer was `setWorkspace`. Two slots holding the same information. | Replaced with `selectEditorMode` / `getEditorMode` derived from `uiV3Store.activeWorkspace`. `editorMode` field, `setEditorMode` action, `EditorModeService.js`, and its test all deleted. `setWorkspace` itself runs `captureRestPose` on staging→animation (BFA-001 + BFA-005). |
| 2026-05-04 | `autoKeyframe` defaulted on (Spine, not Blender)         | Property changes silently wrote keyframes; only the `K` shortcut showed users the explicit path. | Default flipped to `false` (BFA-002). Timeline header's red record-dot button opts users into Auto-Keying explicitly; tooltip rewritten. K stays as the canonical manual-insert path. |

---

## Open crutches

### BFA-001 — `editorStore.editorMode` collapsed to a derived selector — **CLOSED**

**Status (this commit).** Closed. `editorStore.editorMode` and `editorStore.setEditorMode` are deleted; `EditorModeService` (and its test) are deleted. `uiV3Store` exports `selectEditorMode(s) = s.activeWorkspace === 'animation' ? 'animation' : 'staging'` and a `getEditorMode()` imperative form. `setWorkspace` itself runs the `captureRestPose` side-effect on the staging→animation transition (no service indirection). All call sites — CanvasViewport rAF tick, GizmoOverlay, SkeletonOverlay (via prop), ParamRow auto-keyframe gate, Topbar — read through the selector. Tests updated; full suite green including the previously-existing "workspace DRIVES editorMode" assertion (now formulated as "selector follows workspace").

**Original analysis.** `editorMode: 'staging' | 'animation'` was a stored slot whose only writer was `setWorkspace`. Two slots holding the same information is a future-bug factory; the chain `setWorkspace → setEditorMode` papered over the duplication. Collapsing it removes the chain.

**What landed.**
1. **Derived selector exported** from `uiV3Store` (`selectEditorMode` for hooks, `getEditorMode()` for imperative reads).
2. **Reads replaced.** Components subscribing via Zustand use `useUIV3Store(selectEditorMode)`; rAF-tick / pointer-handler imperative reads use `getEditorMode()`. SkeletonOverlay still receives `editorMode` as a prop — its parent (CanvasViewport) computes it from the selector once.
3. **Rest-pose capture moved into `setWorkspace`** directly, gated on the staging→animation transition in `set((state) => ...)` so it has access to the previous value atomically.
4. **`editorMode` field + `setEditorMode` action + `EditorModeService` + its test all deleted.** Comment-only references in animations editor / topbar / uiV3Store / docstrings updated.

---

### BFA-002 — `autoKeyframe` defaults to off (Blender-faithful) — **CLOSED**

**What it was.** `editorStore.autoKeyframe` defaulted to `true`, so any property change in animation mode silently wrote a keyframe at the playhead. Blender ships Auto-Keying off by default — explicit `K` (or `I` in Blender proper) inserts a key, the red record-dot in the timeline header opts into the auto-write shortcut.

**Status (this commit).** Closed. Default flipped to `false` in [`editorStore.autoKeyframe`](../src/store/editorStore.js). The Auto-Keying button is already in the timeline header (red record dot, `animate-recording` pulse when on); the tooltip rewrites to spell out the semantics ("when on, every property change writes a keyframe at the playhead. Off by default — press K to insert manually."). The K-key handler in CanvasViewport stays as the canonical insert path. No runtime behaviour change for users who actively turn Auto-Key on; the only difference is that fresh sessions start in the explicit-insert mode instead of silently recording.

---

### BFA-003 — `viewByMode` keyed by `'viewport' | 'livePreview'`

**What it is.** `editorStore.viewByMode` is a `Record<'viewport' | 'livePreview', { zoom, panX, panY }>` — separate camera state per canvas tab. Each canvas reads `viewByMode[modeKey]` where `modeKey` is its own tab id.

**Why it might be a crutch.** Blender has independent 3D viewport state per area, but the keying is structural (each Area carries its own view). Our keying is by editor TYPE, not by area instance, so two simultaneous viewports would share state. There aren't any, so today this works — but it's a structural shortcut that will break the day a user splits the canvas in half.

**Plan (deferred).** Move per-area view state into the `AreaSlot` itself: `area.viewState = {zoom,panX,panY}`. The `viewport` and `livePreview` types stop owning view state.

---

### BFA-004 — `versionControl: { geometryVersion, transformVersion, textureVersion }`

**What it is.** Three monotonic counters in `projectStore.versionControl` that subscribers bump after specific kinds of mutation (mesh changes, transform changes, texture uploads). Consumers like `RigService.refresh-on-version-change` cache outputs and invalidate when the version changes.

**Why it might be a crutch.** Blender uses a depsgraph: a directed acyclic graph of dependencies between data and outputs, automatically invalidating downstream when an input changes. Our version-counter approach is a manual dependency-tracking system that's prone to "I forgot to bump" bugs.

**Plan (deferred — large).** Out of scope until rig builders, evaluators, and export paths are stable enough to slot into a real depsgraph. For now, the manual counters work; document each writer's invariants so they don't drift.

---

### BFA-005 — naming collision between `editorMode` and `editMode` — **CLOSED**

**Status.** Closed automatically when BFA-001 landed: `editorStore.editorMode` is gone, so `editMode` is now the only mode-shaped field on `editorStore`. The grep / autocomplete hazard the entry described no longer exists. Remaining `editorMode` identifiers are local variables in components (computed from `selectEditorMode`) and JSDoc references to the derived selector — no second store field to confuse with.

---

### BFA-006 — `rigSpec` is a parallel graph that should live in `project.nodes`

**What it is.** Today's data has TWO graphs: `project.nodes` (parts + groups + bones) is the scene graph; `useRigSpecStore.rigSpec` (warps + rotations + art-mesh frames) is the rig graph, computed from three persistent sidetables (`project.faceParallax`, `project.bodyWarp`, `project.rigWarps`). The Outliner just shipped a unified View Layer mode (commit `7d2a426`) that **fakes** one tree by composing both at render time — that's a view-layer fix, not a data-model fix.

**Why it's a crutch.** Save/load is twice the surface (GAP-011 caught a silent field drop). `_userAuthored` markers live on storage shape, not on identifiable nodes. Deformers can't be referenced before Init Rig, can't be undo-tracked, can't be drag-reordered. After project load the user must click Init Rig again to repopulate the live evaluator.

**Plan.** Promote deformers to `project.nodes` entries with `type:'deformer'`. `rigSpec` becomes a derived selector — a runtime index over `project.nodes`, not a separately-built blob. Three persistent sidetables collapse into the node list itself. 7-phase migration; full plan in [BFA_006_DEFORMER_NODES_PLAN.md](BFA_006_DEFORMER_NODES_PLAN.md).

**Status.** Phases 1–5 shipped 2026-05-04 (commits `7cdf08d` / `6a0313b` / `c9a1f12` / `e61c832` / `4023227`). Phase 6 (sidetable deletion) explicitly gated on ≥1 week daily-driver soak per the plan's locked-in decision; rolls forward only after rig-eval / export regressions are observed-clear.

**What landed (Phases 1–5).**

1. **Migration v15 + dual-write seeders (Phase 1).** Warp deformers from `project.faceParallax` / `project.bodyWarp.specs[]` / `project.rigWarps[*]` lift into first-class `type:'deformer', deformerKind:'warp'` entries on `project.nodes` at load time. `seedFaceParallax` / `seedBodyWarpChain` / `seedRigWarps` (and their `clearXxx`) mirror their writes onto `project.nodes` so Init Rig keeps the shadow consistent. Sidetables stay populated as the runtime source of truth.
2. **`selectRigSpec(project)` derived selector (Phases 2–3).** Pure synchronous derivation of the full RigSpec (warpDeformers + rotationDeformers + artMeshes + canvasToInnermostX/Y closures) from `project.nodes`. Memoized on project identity. Phase 3 added the lifted-grid rest pass (ported verbatim from `buildRigSpecFromCmo3.js`) for artMesh parent-frame conversion + chained body-warp closure derivation.
3. **`seedAllRig` rotation dual-write (Phase 3).** Init Rig now upserts `harvest.rigSpec.rotationDeformers` as `type:'deformer', deformerKind:'rotation'` nodes alongside the warp dual-writes. Replace mode wipes prior rotations; merge mode preserves `_userAuthored` entries.
4. **`useRigSpecStore` fast-path (Phase 3).** `buildRigSpec()` short-circuits via `selectRigSpec` when complete; a top-level `useProjectStore.subscribe` auto-fills `rigSpec` on project mutation when the deformer graph is complete. **Closes the "click Init Rig to rebuild after load" UX gap.**
5. **Outliner naturalisation (Phase 4).** `buildHierarchyTree` accepts deformer nodes (alongside parts + groups); deformer rows surface `isDeformer` + `deformerKind` flags so TreeNode picks the right icon. `buildViewLayerTree` collapses to `buildHierarchyTree(nodes)` — no synthetic Rig pseudo-root, no rigSpec composition.
6. **DeformerTab read+write (Phase 5).** Reads from `project.nodes` directly. Adds a parent dropdown (reparent under any non-descendant node via `updateProject`) and a `_userAuthored` toggle (immunises a hand-edited deformer from per-stage refit clobbers).

**Still open until Phase 6.** Three sidetables (`project.faceParallax`, `project.bodyWarp`, `project.rigWarps`) remain the runtime source of truth that `cmo3writer` and `chainEval` read; they're the dual-write target of the seeders. Phase 6 deletes them after the soak window, migrating ~23 sidetable readers to read from `project.nodes` directly.

---

## Working principles (carry-forward)

1. **One axis, one slot.** Don't store information that can be derived. Don't pair a UI pill with another pill if the user always wants them in lockstep.
2. **Workspaces are layout-only** (Blender's contract). Selection, modes, view state must all survive a workspace switch unchanged.
3. **Tab toggles inside the canvas** (Blender's `editMode` axis), not in the topbar.
4. **No "fake orthogonality."** If toggles are actually nested (one forces the other), collapse them into a single enum.
5. **Defer state to where it's used.** Drag state belongs in the dragging component's ref. Cursor position in the cursor-tracking component's ref. The store is for state shared across components.
6. **Every UI control must do something.** Dead toggles, dead sliders, and dead state fields rot trust. Either wire them up or delete.

---

## Cross-references

- Polish passes: [POLISH_PASS_001.md](POLISH_PASS_001.md), [POLISH_PASS_002.md](POLISH_PASS_002.md)
- Project shape: [PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md)
- Memory feedback: `feedback_post_ship_audit` (audit-pass discipline before declaring done)
