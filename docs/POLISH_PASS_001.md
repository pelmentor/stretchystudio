# Polish Pass 001 — Visual Audit 2026-05-03

**Context.** First user-driven visual audit after V3 re-rig flow shipped (commits `d3f4078` … `15163bb`). User went through the live UI in the browser and surfaced a batch of paper-cuts spanning broken behavior, UX quality, and a small feature gap. This document tracks each item to closure.

**Naming convention.** `PP1-NNN` for entries in this pass. Future visual audits get `PP2-NNN` and a sibling document. Keeping numbered passes (rather than one ever-growing file) means each audit is a coherent unit; old passes become read-only history once their items close. Living-backlog tracking already exists in [BUGS.md](BUGS.md) and [FEATURE_GAPS.md](FEATURE_GAPS.md) — items here that mature into long-lived issues get cross-referenced into one of those.

**Status flow.** `open` → `investigating` → `in-progress` → `closed`. Severity: `critical` / `high` / `medium` / `low`. Same conventions as BUGS.md / FEATURE_GAPS.md.

**Scope discipline.** Each entry below stays self-contained. If an item turns out to be a feature pillar (multi-day plan), it gets a separate plan doc and PP1 entry just links out — same way GAP entries do.

---

## Status snapshot (2026-05-03)

| ID | Type | Severity | Title | Status |
|----|------|----------|-------|--------|
| [PP1-001](#pp1-001) | bug     | high   | Bone-controller rotation doesn't propagate to layers (no re-render trigger) | closed |
| [PP1-002](#pp1-002) | bug     | high   | Init Rig honours `subsystems.hairRig=false` opt-out only partially | open |
| [PP1-003](#pp1-003) | ux      | medium | Inline-tooltip pattern eats screen real-estate (cross-cutting) | open |
| [PP1-004](#pp1-004) | bug     | medium | Iris clip-mask edges are aliased (stairstep, not antialiased) | open |
| [PP1-005](#pp1-005) | ux/bug  | low    | "Setup" button at top of UI is non-clickable + unexplained | open |
| [PP1-006](#pp1-006) | ux      | low    | Edit-mode picker disabled-until-selection has no affordance | open |
| [PP1-007](#pp1-007) | feature | medium | Layers panel — warps default-visible + opacity slider (default 0.50) | open |
| [PP1-008](#pp1-008) | bug + ux | high | Mesh edit broken (vertices don't move) + proportional-editing UX rework + toolbar relocation | (a) closed; (b)(c) open |

---

## Entries

<a id="pp1-001"></a>
### PP1-001 — Bone-controller rotation doesn't propagate to layers (no re-render trigger)

**Type:** bug · **Severity:** high · **Status:** closed (commit `2d6cf29`)

**Resolution.** The actual cause was deeper than "missing re-render trigger" — `worldMatrix` is **skipped** for rig-driven parts (scenePass.js:84-95), so for those parts the bone's `node.transform.rotation` has zero effect on the rendered pose. The rig is driven by `paramValues` only, via `evalRig`. The auto-rig already creates `ParamRotation_<sanitisedName>` for every bone group ([`paramSpec.js:267-303`](../src/io/live2d/rig/paramSpec.js#L267-L303)) — the SkeletonOverlay rotate-drag was just never writing to it.

Fix: SkeletonOverlay rotate-drag now captures the bone's `ParamRotation_<sanitisedName>` id + range at pointer-down time, and the move handler routes the angle through both `node.transform.rotation` (worldMatrix path, non-rig parts) AND that parameter (chainEval path, rig-driven parts). Mirrors the dual-write pattern the iris trackpad already uses for `ParamEyeBallX/Y`. Bones outside `SKIP_ROTATION_ROLES` (= every bone with a rig parameter) now drive the live preview directly; bones that don't get a parameter (torso/eyes/neck — handled by warps) remain worldMatrix-only, which is correct.

**Symptom (user-visible).** After Init Rig, dragging a bone controller in `SkeletonOverlay` writes the rotation into `node.transform.rotation` but the dependent layers don't move. As soon as the user touches **any** bone that DOES move things (e.g. elbow), the entire skeleton's pose catches up — every previously-rotated bone snaps into place at once. Body warp deformers (driven by `ParamBodyAngle*` sliders) work normally throughout — confirms chainEval is running.

**Hypothesis (verified by reading source).** [`SkeletonOverlay.jsx:330-380`](../src/components/canvas/SkeletonOverlay.jsx#L330-L380) — the `'rotate'` drag branch writes `node.transform.rotation` via `updateProject`, then conditionally fires `setDraftPose` for each dependent part **only when `drag.dependentParts.length > 0`**. `setDraftPose` is what triggers the GPU upload path in the `CanvasViewport` rAF tick → re-render → chainEval re-reads all bone rotations.

Bones that own skinned mesh weights (elbow, knee, etc.) have `dependentParts.length > 0` → trigger fires → re-render → user sees update. Bones that don't own skinned parts (main arm root, shoulder, neck root, etc.) write rotation to project state but never dispatch a re-render → chainEval doesn't tick → mesh stays in old pose. The next dispatch from ANY source (e.g. elbow drag) bumps the render path and chainEval reads ALL fresh bone rotations on that tick, producing the "catch-up snap".

**Repro.**
1. Load a project, run Init Rig.
2. Switch to a workspace where SkeletonOverlay shows controllers (Pose / Rigging).
3. Drag a parent-chain bone (e.g. arm root) → mesh stays still.
4. Drag a leaf bone (e.g. elbow) by 1° → suddenly the parent's prior rotation kicks in, mesh snaps.

**Repair sketch.** SkeletonOverlay's rotate drag path should bump `versionControl.transformVersion` (or call `setDraftPose(drag.nodeId, { rotation: ... })` unconditionally) regardless of whether the bone has dependent parts. The chainEval tick gate is rendering correctness — it should fire whenever bone rotation changes, not only when there's a skinning side-effect. Body-warps-from-params already work because params have their own dispatch path.

**Risks of fix.** Bumping every bone-drag through draftPose changes the staging-mode write path (today it goes through `updateProject` directly for bones-without-skinning). Need to verify the staging-mode commit-on-pointer-up still produces the same persistent state.

---

<a id="pp1-002"></a>
### PP1-002 — Init Rig honours `subsystems.hairRig=false` opt-out only partially

**Type:** bug · **Severity:** high · **Status:** open

**Symptom (user-visible).** User opens Init Rig Options popover, unchecks "Hair Rig", clicks Init Rig. Live preview after init STILL shows hair swinging — physics rules + hair sway warps appear to have been generated despite the opt-out.

**What's happening (from memory + recent code review).** GAP-008 Phase A+B shipped 2026-04-25 covered the opt-out for the **heuristic** init path:
- `seedPhysicsRules` filters by `subsystems.hairRig` (drops `hair-` prefixed rules).
- `harvestSeedFromRigSpec` filters `rigWarps` by `TAG_TO_SUBSYSTEM` mapping.

But the **authored-cmo3** init path landed later (commit `41e63bc` 2026-05-03 — "GAP-008 subsystem opt-out on authored cmo3 path"). User may be hitting either:
- (a) Authored-cmo3 path subsystem filter has a coverage gap (a category not yet wired up).
- (b) The popover-checkbox isn't actually persisting `hairRig: false` into `project.autoRigConfig.subsystems` before Init Rig reads it — a write-order bug.
- (c) The Phase 0 clobber-fix preserves `subsystems` across re-init but only if `project.autoRigConfig` already has a `subsystems` field. Fresh project + first Init Rig may write all-defaults regardless of popover state.

**Investigation steps.**
1. Add an `[InitRig]` log line that prints `resolveAutoRigConfig(project).subsystems` at the start of `initializeRigFromProject` — check what subsystem flags are seen at harvest time.
2. Verify [`InitRigOptionsPopover.jsx:49-50`](../src/v3/editors/parameters/InitRigOptionsPopover.jsx#L49-L50) write path produces a project state where `project.autoRigConfig.subsystems.hairRig === false` BEFORE Init Rig is clicked.
3. Re-run Init Rig with hair off; check logs panel for `disabledSubsystems: ['hairRig']` in the harvest-complete log.
4. If subsystems flag IS reaching harvest but hair STILL appears: walk the authored-cmo3 path to find which warp output is bypassing the filter.

**Repair plan.** Depends on which of (a)/(b)/(c) is the root cause. (a) → patch `buildRigSpecFromCmo3` filter. (b) → fix popover write order. (c) → bootstrap `subsystems` default explicitly when popover saves a non-default flag.

---

<a id="pp1-003"></a>
### PP1-003 — Inline-tooltip pattern eats screen real-estate (cross-cutting)

**Type:** ux · **Severity:** medium · **Status:** open

**Symptom (user-visible).** Hovering "Reset Pose" in the canvas top-right reveals a long single-line info bar at the bottom of the canvas: "Reset to rest pose — zeros every bone-group rotation/translation/scale (preserving pivots) and resets parameters to defaults. Per-part transforms are preserved; use Properties → Reset Transform for those." (See screenshot.) The bar spans roughly half the canvas width and obscures the workspace below.

User concern: this is the same pattern used in many places. Cross-cutting refactor needed.

**What it is.** Native `title` attribute? Custom tooltip component? Need to grep — likely the latter given length + styling. Possible candidate: a custom `<HelpText>` / `<TooltipBar>` rendered absolute-positioned at canvas bottom.

**Direction (sketch, not committed).** Three options:
- (a) **Shrink + relocate** — show the long help in the existing Logs/Help panel only; canvas tooltip becomes a 1-line summary that fits in the standard tooltip popover.
- (b) **Expand-on-click** — short summary in tooltip, "Learn more" expands into a side popover.
- (c) **Documentation page** — replace inline-help with a per-button F1/help-panel route; tooltip stays minimal.

Plan to investigate the actual component before scoping. May open a sibling plan doc if the refactor is multi-component.

**Repro.** Hover Reset Pose button in canvas top-right; see info bar materialise at canvas bottom.

---

<a id="pp1-004"></a>
### PP1-004 — Iris clip-mask edges are aliased (stairstep, not antialiased)

**Type:** bug · **Severity:** medium · **Status:** open

**Symptom (user-visible).** Iris clip-mask cuts produce visibly stairstepped edges in the rendered output. Eyeball edges look pixel-precise binary instead of smoothly antialiased — see screenshot of the eye, the brown iris boundary against the eyewhite has visible diagonal lesenka.

**Where the rendering happens.** Mask stencil pass — see `maskStencil` references in the renderer. Cubism's runtime uses an off-screen mask buffer with pixel-rate stencil; antialiasing depends on whether the mask sampler is point-filter (binary) vs linear-filter (smoothed) and whether the blit blends or threshold-cuts.

**Investigation steps.**
1. Read [`maskStencil.js`](../src/renderer/maskStencil.js) (or wherever the mask render target is set up).
2. Check sampler filter mode — is the mask texture sampled with `gl.NEAREST` or `gl.LINEAR`?
3. Check the threshold/blend in the masked-mesh fragment shader — binary discard vs alpha blend.
4. Reference: how does Cubism Web SDK handle iris clip antialiasing? Likely supersample or bilinear-sampled mask.

**Repair sketch.** Linear filter on mask texture + alpha-blend fragment math (instead of `discard` threshold) typically removes the stairstep. May need MSAA on the mask buffer for very thin features. Fix is renderer-local, contained.

**Risks.** Other clip masks (eyebrow over hair, etc.) share the same pipeline — will improve them too, may slightly shift their rendered look. Visual diff before merging.

---

<a id="pp1-005"></a>
### PP1-005 — "Setup" button at top of UI is non-clickable + unexplained

**Type:** ux/bug · **Severity:** low · **Status:** open

**Symptom (user-visible).** A button labelled "Setup" appears in the top of the UI. Clicking it does nothing. Hover/focus produces no tooltip explaining its purpose. User confused about what it is.

**Investigation steps.**
1. Grep for `Setup` in `src/v3/shell/` to locate the button source — likely in topbar / workspace bar.
2. Check whether it's a placeholder for an unfinished workspace (Setup as in "rig setup phase") or a leftover from an earlier UI iteration.
3. If it's an actual workspace selector that's just gated on something missing, fix the gating; if it's vestigial, remove.

**Repair.** Either wire it up + add tooltip, or delete. Trivial once the source is located. (User implicitly tolerates either.)

---

<a id="pp1-006"></a>
### PP1-006 — Edit-mode picker disabled-until-selection has no affordance

**Type:** ux · **Severity:** low · **Status:** investigating (user self-resolved → confirms it's an affordance issue)

**Symptom (user-visible).** Object-mode picker shows one mode "stuck" as the active option; the others appear greyed-out and uninteractable. User reported as broken; later self-resolved by realising they had to select a layer first ("Ой у меня получилось зайти в edit mode просто надо было селекнуть слой").

**Why this counts as a real issue.** The picker is doing its job (workspace `allowedEditModes` gate + selection-required gate). But the user couldn't tell WHY the modes were greyed — no inline message saying "select a layer to enable edit modes". A first-time user hitting this would assume it's broken (as this user did), churn for a while, then either give up or stumble onto the workaround.

**Repair sketch.** Three options:
- (a) **Tooltip on hover** of disabled mode button: "Select a layer to enable Mesh Edit." Discoverable on hover.
- (b) **Inline hint** below the picker when no selection: small subtitle text "Select a layer to switch modes."
- (c) **Always-enabled** with no-op + toast on click: "Select a layer first."

(b) is least intrusive; (a) is cheapest to add. Plan to land (a) + (b) together — they don't conflict.

---

<a id="pp1-007"></a>
### PP1-007 — Layers panel: warps default-visible + opacity slider

**Type:** feature · **Severity:** medium · **Status:** open

**Request (refined 2026-05-03).** Two coupled asks from the user:
1. **Default visible.** Warp grids should be visible by default whenever any warps exist on the character. Today's `viewLayers.warpGrids` default is already `true` ([`editorStore.js:69`](../src/store/editorStore.js#L69)) — so this part is satisfied IF the rendering is actually firing for all warps. Investigation: confirm WarpDeformerOverlay isn't filtering by selection (only rendering the currently-selected warp).
2. **Opacity, not just on/off.** Default opacity = **0.50** (semi-transparent), controllable via a slider in the ViewLayers popover. The boolean toggle becomes "show / hide" master; the slider becomes "intensity when shown".

**What exists today.**
- `editorStore.viewLayers.warpGrids: true` — boolean toggle gating `WarpDeformerOverlay` in [`CanvasArea.jsx`](../src/v3/shell/CanvasArea.jsx).
- `editorStore.viewLayers.rotationPivots: true` — sibling toggle for `RotationDeformerOverlay`.
- ViewLayersPopover shows toggles grouped by Mesh / Rig / Edit (per `project_gaps_post_compact_2026_05_02` for the popover's Phase A surface).

**Schema change.** Replace `viewLayers.warpGrids: boolean` with two coexisting fields, OR with a single numeric:
- **Option (a):** `warpGrids: boolean` (visible/hidden) + `warpGridsOpacity: number` (0..1, default 0.5). Two slots; clean separation of intent (hide = master off; intensity = preference). Hide overrides intensity.
- **Option (b):** `warpGrids: number` (0..1, where 0 = hidden, 0.5 default, 1 = full). Single slot; ergonomically same outcome (slider with snap-to-0 = hide).

(a) is more conventional for shadcn/ui (Switch + Slider) and matches the existing visual pattern of other layers having on/off toggles. (b) is one less field but conflates two concepts.

**UX sketch.** Inside ViewLayersPopover's Rig section:
- Existing "Warp Grids" Switch → unchanged.
- New row underneath when Switch is on: "Opacity" label + Slider (0–100%). Default 50.
- Sibling pattern likely warranted later for `rotationPivots` and `skeleton` — but those aren't requested today.

**Renderer wiring.** [`WarpDeformerOverlay`](../src/v3/shell/CanvasArea.jsx) (or the actual overlay component) reads the opacity from editorStore and applies it to its SVG/Canvas grid stroke as `stroke-opacity` / `globalAlpha`. Trivial once the store field exists.

**Investigation steps.**
1. Verify WarpDeformerOverlay renders ALL warps (not selection-filtered). If selection-filtered, lift that restriction first — that's the "default visible" part.
2. Decide between schema option (a) vs (b). Default to (a) — cleaner, shadcn-friendly.
3. Add opacity field to editorStore + migrate preferences if `viewLayerPresets` records the field.

**Migration.** If `preferencesStore.viewLayerPresets` records the boolean, add a forward-compat read (`typeof saved === 'boolean' ? {warpGrids: saved, warpGridsOpacity: 0.5} : saved`). Old saved presets default opacity to 0.5 on load.

---

<a id="pp1-008"></a>
### PP1-008 — Mesh edit broken (vertices don't move) + proportional-editing UX rework

**Type:** bug + ux · **Severity:** high · **Status:** open

Two related but separable problems in the mesh-edit surface. Filing as one entry because they share the same code path; will likely split into two commits when fixed.

#### Sub-issue (a) — vertices don't move at all — closed (commit pending)

**Root cause.** The handlers were intact — drag uploads were happening on every pointer move. The bug was in the rAF tick: after Init Rig, `evalRig` produces frames for every art mesh, those frames go into `poseOverrides[id].mesh_verts`, and the renderer uploads them every frame ([`CanvasViewport.jsx:740-748`](../src/components/canvas/CanvasViewport.jsx#L740-L748)). Rig keyforms are baked at Init Rig time from the THEN-current `node.mesh.vertices`. The user's mesh edit writes to `node.mesh.vertices` and uploads the new positions, but the next rAF tick re-uploads the stale rig output on top — net effect: vertices appear pinned.

**Fix.** While the user is mesh-editing a part, skip the rig override for THAT part. Other parts keep evalRig output as usual; only the selected mesh-edited part drops out so the user's edits show through. Other parts continue to be driven by paramValues. The rigSpec keyforms remain stale until the user clicks Refit (RigStagesTab) — which is the documented path to refresh the rig with their edits.

#### Sub-issue (b) — proportional editing UX needs Blender-faithful rework

**Current behavior (per memory).** MMB-scroll changes radius while dragging.

**Desired behavior (Blender-faithful).** User presses **F** → enters "adjust radius" mode → scroll wheel grows / shrinks the falloff radius (live preview circle on canvas) → click anywhere commits the new radius → exits adjust mode. This matches Blender's `Shift+O` / radius-adjust gesture and is what user originally referenced as the model in the mesh-edit feedback.

**Repair sketch.**
- Add a keymap entry: `F` while in mesh edit mode → toggle `proportionalEditAdjustingRadius: true` in `editorStore`.
- While `adjustingRadius`, the canvas overlay listens for `wheel` events → mutate `editorStore.proportionalRadius`. (Distinct from MMB-scroll, which can stay as the "during-drag" adjust.)
- First click while `adjustingRadius` commits + flips back to false. ESC cancels.
- Render a circle gizmo at cursor showing the current radius live.

**Cross-link.** Memory `feedback_blender_mesh_edit_port.md` says: "match `O`/`Shift+O`/`Alt+O` hotkeys + falloff curves byte-for-byte." This entry adds **`F`** to that list as the radius-set keybind. Verify against Blender 5.1 (installed locally per `reference_blender_install`) before shipping.

#### Sub-issue (c) — proportional-editing toggle is in the wrong place

**Current placement.** The proportional-editing toggle button currently sits near the brushes/tools toolbar (left edge T-panel per `project_click_to_select_and_toolbar_shipped_2026_05_02`). User finds this wrong.

**Desired placement.** Like Blender — on the **header bar where edit-mode / object-mode picker lives**, immediately to the **right** of the active-mode display. Blender's pattern: mode dropdown · proportional-edit toggle · falloff-shape dropdown · X-mirror · ... → all in the same row at the top of the editor area.

**Why this matters.** Proportional editing is a global mesh-edit-mode modifier that affects every brush + every drag. Putting it next to the mode picker (where the user already looks to confirm "am I in mesh edit mode?") is correct grouping. Putting it next to brushes implies it's a brush option, which it isn't.

**Repair sketch.** Move the toggle's render site from the tools toolbar to the same component that hosts the edit-mode picker (likely the workspace header or the canvas top-bar). Wire it to the same `editorStore.proportionalEdit` flag — just relocate, no behavior change. Same applies to the falloff-shape dropdown (Blender shows it as a sibling toggle).

**Verification.** Open Blender 5.1 → 3D Viewport edit mode → screenshot the top header bar from "Object Mode" dropdown to "Snap" controls. Match SS layout to that grouping.

---

## Cross-references

- Plan governing this audit's parent feature: [V3_RERIG_FLOW_PLAN.md](V3_RERIG_FLOW_PLAN.md) (shipped 2026-05-03)
- Sister living docs: [BUGS.md](BUGS.md), [FEATURE_GAPS.md](FEATURE_GAPS.md), [PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md)
- Memory: `feedback_post_ship_audit.md` (the lesson that prompted this visual pass)

## Tracking discipline

- When an entry transitions to `in-progress`, update its status here AND link the commit hash on close.
- When an entry's investigation reveals it's a feature pillar (≥1 day work), spin a dedicated plan doc, leave a 1-line stub here pointing to it.
- When ALL entries close, this document becomes read-only history. Future visual audits open `POLISH_PASS_002.md`.
