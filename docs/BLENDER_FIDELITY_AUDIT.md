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

---

## Open crutches

### BFA-001 — `editorStore.editorMode` is now a derived field

**What it is.** `editorMode: 'staging' | 'animation'` is a stored slot in `editorStore`. After PP2-009 + the redundant-call cleanup in this audit, the **only writer** is `uiV3Store.setWorkspace` (via `EditorModeService.setEditorMode`). The slot is therefore always `(activeWorkspace === 'animation' ? 'animation' : 'staging')`.

**Why it's a crutch.** Two slots holding the same information is a future-bug factory. New contributors will write to one without the other. The current `setWorkspace → setEditorMode` chain papers over the duplication; collapsing it removes the chain.

**Plan.**
1. **Add a derived selector.** Export from `uiV3Store`:
   ```js
   export const selectEditorMode = (s) => s.activeWorkspace === 'animation' ? 'animation' : 'staging';
   ```
2. **Replace reads.** ~51 occurrences across 11 files (a handful are comments). Each `useEditorStore(s => s.editorMode)` becomes `useUIV3Store(selectEditorMode)`.
3. **Move rest-pose capture out of EditorModeService.** Today `setEditorMode('animation')` calls `captureRestPose` on staging→animation. Move that side-effect into `setWorkspace` directly.
4. **Delete** `editorStore.editorMode` + `editorStore.setEditorMode` + `EditorModeService` once no readers remain.

**Risk.** Touching 49 call sites; some are in hot paths (canvas rAF tick, gesture handlers). Worth shipping in one PR with a single test pass, not piecemeal.

**Out of scope today.** The current PP2 sweep is closing user-visible bugs; this is a code-cleanliness pass. Land it after PP2-005b/-006/-007/-008.

---

### BFA-002 — `autoKeyframe` is a Spine pattern, not Blender

**What it is.** `editorStore.autoKeyframe: true` causes pointer-up on a bone / param drag in animation mode to dispatch a synthetic K key, automatically writing a keyframe at the current time.

**Why it might be a crutch.** Blender's pattern: explicit `I` press to insert a keyframe, full stop. There IS a global Auto-Keying button (the red record dot) in the timeline header that turns on automatic keyframing for every property change — but it's **off by default** and lives in the timeline chrome, not buried in editor state. Our default flips that: Auto-Key is on out of the box and only the K binding shows the user the explicit path.

**Plan (deferred — needs user input).**
- Surface the toggle in the timeline header (Blender pattern), not as a hidden default.
- Default to `false` (matches Blender ergonomics; user explicitly asks for keyframes).
- Keep the K key as the canonical path.

**Open question for the user:** is auto-keyframe actually wanted? If yes, leave on; if no, default off. Not actioned in this audit pass.

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

### BFA-005 — `editorMode` (Spine name) coexisting with `editMode` (Blender name)

**What it is.** Two state fields with confusingly similar names: `editorMode` (the Setup/Animate axis from BFA-001) and `editMode` (the Blender-style mesh/skeleton/blendShape contextual mode). In the same store. With nearly the same name. Differing by ONE letter.

**Why it's a crutch.** Pure naming hazard. Easy to grep `editMode` and get `editorMode` matches (or vice versa) — autocomplete misfires the same way. When BFA-001 lands and `editorMode` is removed, this collapses naturally; until then, any new contributor needs to stay alert.

**Plan.** Remove `editorMode` per BFA-001. Until then, keep the JSDoc warnings on both fields.

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
