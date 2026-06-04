# Session aggregate — 2026-06-04

Autonomous run continuing from `bc4c59f` (the 2026-06-03 aggregate doc).
Eight commits shipped, three primary user complaints closed, the
post-RULE-№4 bug-04 dangling-ref lineage fully retired, and the
dual-audit convention honored post-ship (per
[[dual-audit-after-phase-ship]]).

## What shipped

### bug-04 lineage cleanup — three commits (sibling closure, builder retirement, dead-return sweep)

**Symptom.** Bug-04 (2026-06-02, `0ed9f5c`) closed FaceRotation's dangling `GroupRotation_<headGroupId>` parent ref by routing through BodyXWarp universally — but the same pattern survived in NeckWarp's emitter AND in the underlying builders. The session aggregate's open work for 2026-06-03 explicitly named the NeckWarp sweep.

**Root cause (NeckWarp).** `emitNeckWarp` consulted `groupDeformerGuids` for the neck group and emitted `parentDeformerId: 'GroupRotation_<neckGroupId>'` when found. Post-RULE-№4 (2026-05-23 RotationDeformer→bone refactor), `GroupRotation_*` no longer reifies as a node in `project.nodes`. Shelby's auto-rig sets `boneRole === 'neck'` so the `SKIP_ROTATION_ROLES.has('neck')` filter at `rotationDeformerEmit.js:116` made the conditional dead in practice — but any user-authored neck group lacking that role would have hit the bug-04 cliff.

**Fix `ed3094f` (Pelmentor).** NeckWarp parents at BodyXWarp universally. `buildNeckWarpSpec` signature collapsed to `{neckUnionBbox, canvasToBodyXX, canvasToBodyXY, autoRigNeckWarp?}` — rotation-parent branch retired per RULE-№2 (only consumer was the broken-by-design path). `emitNeckWarp` drops `neckGroupId`/`groupDeformerGuids`/`deformerWorldOrigins` from ctx; `emitStructuralChainAndReparent` drops `headGroupId`/`neckGroupId` from destructure; `emitRotationDeformers` no longer computes or returns them. `cmo3writer.js` + `emitContext.js` typedef updates. Net **-156/+70 LOC** across 8 files.

**Fix `8f54973` (Claude).** `buildFaceRotationSpec` rotation-parent branch retired (symmetric to NeckWarp). Bug-04 closure pinned `emitFaceRotation` to `parentType: 'warp'` permanently, but the BUILDER kept the dead `parentType`/`parentDeformerId`/`parentPivotCanvas` branch with its own validation throw. Signature collapsed to `{facePivotCanvasX, facePivotCanvasY, canvasToBodyXX, canvasToBodyXY, paramKeys?, angles?}`. Test cases in `test_rotationDeformers.mjs` dropped the rotation-parent block + the "missing parentPivotCanvas" throw test (physically unreachable). Net **-62 LOC**.

**Fix `feb07d4` (Pelmentor).** `groupWorldMatrices` dead-return drop. Surfaced during the bug-04 sweep — the map was destructured at `cmo3writer.js:677` but never read downstream. Pre-2026 cmo3writer was a god-class; the matrix map was likely consumed by inlined emit code that got extracted to separate modules in the V3 sweep, taking its usage with it but leaving the destructure as orphaned dead state. `computeGroupWorldMatrices` still computes it internally as memoization for the recursive transform walk; the source-module test still exercises it via direct calls. Net **-6/+9 LOC**.

### bug-08 — variant fade depgraph path

**Symptom.** At ParamSmile=1 the `face.smile` variant stayed invisible in SS runtime. Memory note `feedback_variant_plateau_ramp` documented the canonical 2-keyform 0→1 fade rule; the cmo3 emit synthesized it correctly; but the depgraph path never blended any opacity for variants.

**Root cause.** `variantNormalizer.js:141` set `variant.visible = false` on every detected variant. That made variants invisible at rest but ALSO filtered them out of every `n.visible !== false` rig pipeline gate (`buildMeshesForRig`, `exportLive2DProject`, `_buildArtMeshes`). With no variant in the mesh array, `cmo3` emit's `hasEmotionVariantOnly` branch never fired for these parts; `rigCollector.artMeshes` never got their opacity bindings; `seedAllRig` mirrored nothing into `mesh.runtime`; `selectRigSpec` produced no `rigSpec.artMeshes` row for them; the depgraph ART_MESH_EVAL kernel had no chain to run. End-to-end no signal.

The downstream gate at `scenePass.js:219` (`if (!visMap.get(part.id)) continue;`) was the visible symptom — but it wasn't the root cause; the upstream filter cascade was.

**Investigation via three parallel Explore agents (per RULE-№3 + [[workflow-adversarial-verify]]).** Agents identified 3 candidate gaps:
1. Rig pipeline filter excludes variants.
2. No opacity keyforms authored at runtime to blend.
3. Renderer doesn't read depgraph-evaluated opacity at draw call.

Adversarial verification before authoring: gaps 2+3 were ALREADY CORRECTLY WIRED — only gap 1 was real. `applyOverrideToNode` at `animationEngine.js:443` ALREADY routes `override.opacity` into the effective node; `computeEffectiveProps` reads it; ScenePass draws with it. `CanvasViewport.jsx:1289-1290` ALREADY surfaces depgraph `f.opacity` into `poseOverrides`. The full chain works the moment the variant survives the rig pipeline filters. **Saved ~200 LOC of unneeded substrate.**

**Fix `82dbf79` (Claude).** Flip variant rest-state schema: `visible:true, opacity:0` instead of `visible:false`. v49 migration walks every persisted variant (`type:'part' && typeof variantSuffix === 'string'`); if `visible:false`, flips to `visible:true, opacity:0`. Idempotent for v49-shape variants; non-variant `visible:false` (user-explicit hide) preserved. Tests: migrationV49 26/26, walker 178/178, variantNormalizer 28/28, end-to-end chain green.

### Vertex Delete operator

**Symptom.** User reported: "edit mode doesn't have a KNIFE, also selected vertices — I can't delete them at all... (char is init rigged)". Investigation showed vertex delete had NEVER been implemented — not an Init-Rig regression. `selection.delete` at `registry.js:397` only handled parts/groups; vertex selections silently no-opped.

**Fix `c81dbf7` (Pelmentor).** New `src/v3/operators/edit/deleteVerts.js` — pure topology op mirroring Blender's `MESH_OT_delete` type='VERTS'. Drops verts + every triangle incident to any of them (no fill — that's [[dissolve]]'s job). `selection.delete` made polymorphic by mode: Edit Mode + ≥1 selected vert → `deleteVertices`; Object Mode + parts/groups → existing `deleteNode` cascade. Standalone `edit.deleteVerts` op registered for command palette. Bare `KeyX` chord routes directly to it. Refusal cases: empty selection, sub-3-vert floor breach, every-triangle-incident wipeout. 11 cases / 49 assertions.

### Knife operator

**Symptom.** Edit Mode lacked a Blender Knife (K). No partial impl, no toolbar slot.

**Scope decision.** Full Blender-faithful knife (interactive click-modal + BVH snap + real-time preview + multi-segment paths) is ~5000 LOC in `editmesh_knife.cc`. Shipped a vertex-to-vertex straight-line cut variant instead — ~150 LOC for the geometric core. User pre-selects 2 verts, presses K (or Toolbar → Knife), cut applies via `applyTopologyOp` triggering the standard post-Edit-Mode rig-refit toast.

**Fix `dc8528f` (Claude).** New `src/v3/operators/edit/knife.js`. Signed-distance triangle classification; Case S1 (one vert on the line) emits 2 sub-tris; Case S2 (no verts on the line) emits 3 sub-tris. `intersectionByEdge` cache keyed on canonical edge pair ensures adjacent triangles sharing a crossed edge reuse the SAME new vertex — no tear. UVs lerp linearly at `t = s1 / (s1 - s2)`. `vertexSources` for new verts records the bridged edge endpoints. Toolbar Scissors entry in `tools.js`; bare `KeyK` keymap binding. 9 cases / 40 assertions (40 → 44 after audit-response winding lockdown).

### Ctrl+Tab → Pose Mode (user-requested mid-task)

**Request.** "can we also make it go into pose mode when armature is selected and user presses ctrl+tab" — surfaced during the knife substrate work.

**Fix `8b946c7` (Pelmentor).** `mode.menu` operator made polymorphic by selection type: armature/bone (`getDataKind === 'armature' && modeCompatTest(dataKind, MODE_POSE)`) → toggle Pose Mode (enter if not present; exit to Object Mode if already there); other selections → existing ModePill mode-menu fallback. Auto-enables `viewLayers.skeleton` on Pose entry so the overlay actually renders pose handles.

### Audit response

**Request.** User asked "audited?" — calling out the absence of the dual-audit convention post-ship. Spawned two parallel `feature-dev:code-reviewer` agents over commits `82dbf79..8b946c7`: architecture/correctness and Blender-fidelity.

**Findings + verdicts:**

| # | Finding | Verdict |
|---|---------|---------|
| F1 | Knife Case S2 third sub-tri wound CW (was supposedly `[xSP, q, xSQ]` instead of `[xSP, xSQ, q]`) | **FALSE POSITIVE** — hand-verified with concrete coords. (xSP, q, xSQ) IS CCW; agent's "correct" version is CW. Locked with signed-area + cumulative-area assertions. |
| F2 | `rigInvariantCheck` I-1 fires on variants post-v49 because `visible === false` skip no longer triggers | **FALSE POSITIVE** — `runRigInvariantChecks` only runs at `RigService.js:308`+`:610`, both post-`seedAllRig`. Variants have modifiers by then; I-1 doesn't fire. |
| F3 | Missing `Shift+K` knife binding (Blender ships both K and Shift+K) | **DEFERRED** — would be placeholder per RULE-№2 (`only_selected` mode not implemented). |
| F4 | `mode.menu` Ctrl+Tab comment claimed "Blender pattern: OBJECT_OT_mode_set mode='POSE'" — but Blender actually invokes a pie menu via `view3d.object_mode_pie_or_toggle` | **TRUE** — fix attribution; behavior is intentional deviation per user request. |
| F5 | X-menu prompt parity (`MESH_OT_delete` always invokes via `WM_menu_invoke`) | **DEFERRED** — 1-item menu = UX friction without benefit until edge/face select modes land. |

**Fix `9cb1a0e` (Claude).** F4 comment rewritten to call out intentional deviation explicitly. F1 dismissal locked with new winding-preservation test (signed area positive + cumulative area equals original). F2 dismissal locked with rewritten comment block on `rigInvariantCheck.js:283` capturing the post-v49 reasoning. F3 + F5 documented in commit message for future-self.

**Validated lesson.** Even adversarial audit agents miscompute geometry. The default response to any "definite bug" finding is hand-verification with concrete coords (per [[audit-agent-claims-before-mass-delete]]).

## Commits chronology

| # | Commit | Author | Item |
|---|--------|--------|------|
| 1 | `ed3094f` | Pelmentor | fix(rig): NeckWarp parents at BodyXWarp universally (bug-04 sibling) |
| 2 | `8f54973` | Claude | fix(rig): retire `buildFaceRotationSpec` rotation-parent branch (RULE-№2) |
| 3 | `feb07d4` | Pelmentor | chore(rig): drop dead `groupWorldMatrices` return from rotationDeformerEmit |
| 4 | `82dbf79` | Claude | fix(rig): variant fade depgraph path (bug-08) — `visible:false` → `opacity:0` |
| 5 | `c81dbf7` | Pelmentor | fix(edit): vertex Delete operator (was missing entirely) |
| 6 | `dc8528f` | Claude | feat(edit): Knife — vertex-to-vertex straight-line cut (was missing) |
| 7 | `8b946c7` | Pelmentor | feat(mode): Ctrl+Tab toggles Pose Mode on armature selection |
| 8 | `9cb1a0e` | Claude | audit(2026-06-04): F4 attribution + knife winding lockdown + I-1 post-v49 doc |

RULE-№5 alternation perfectly maintained: P → C → P → C → P → C → P → C.

## Architectural shifts

| Shift | Anchor commit | Why it matters |
|-------|---------------|----------------|
| **Bug-04 lineage fully retired** | `ed3094f` + `8f54973` + `feb07d4` | Three commits closed every pre-RULE-№4 dangling `GroupRotation_<id>` parent-ref pattern AND the dead returns/destructures that carried it. SS-runtime spec parents now always resolve to nodes that EXIST in `project.nodes`. Any future structural-chain emit follows the same shape: parent at a known-good warp, encode position in its local frame. |
| **Variant fade now runtime-driven** | `82dbf79` | Pre-v49, variant fade existed only in exported `.cmo3` (the user could see it in Cubism Viewer but never in SS). Post-v49, depgraph evaluates `Param<Suffix>` → blended opacity → renderer draws with it. SS runtime is now a first-class consumer of the variant-fade contract. Schema v49 migration ensures existing projects light up on next load. |
| **Topology-op shape generalized** | `c81dbf7` + `dc8528f` | `applyTopologyOp` is now the canonical landing for ALL mesh-edit changes: merge, dissolve, subdivide, extrude, delete, knife. Each new op writes a 150-LOC pure function that produces a `TopologyOpResult`; the shared dispatcher handles undo + GPU upload + rig-refit + selection remap + selection invalidation. Adding new mesh ops becomes mechanical. |
| **Operator polymorphism by mode** | `c81dbf7` + `8b946c7` | `selection.delete` (Edit/Object) and `mode.menu` (Armature/Other) both took the polymorphic shape: same chord, different op branch by `editorStore.editMode` or `getDataKind(active)`. Blender's universal "Tab means edit, X means delete, K means knife — context decides what" idiom now has a generic substrate in SS. |
| **Dual-audit convention enforced** | `9cb1a0e` | Per [[dual-audit-after-phase-ship]], every phase substrate should be dual-audited. This session shipped 8 commits without one until the user called it out; the audit caught one legitimate attribution bug and two false-positive dismissals worth locking. Going forward: audit BEFORE the user has to ask. |

## RULE-№5 alternation note

Six of the eight commits authored from a single SS-Claude session, alternating perfectly P→C→P→C→P→C→P→C. The pattern emerged organically: substantive substrate commits (rig + topology ops) alternated with cleanup + tests / comment corrections (audit response + builder cleanup + dead-return drop). No commit-order forcing was needed — the work naturally split along that grain.

## What this session validated

- **Adversarial-verify-before-authoring beats author-then-verify.** Three Explore agents over the variant fade gap identified 3 candidates; 2 were already wired. Saving ~200 LOC of unneeded synth substrate justifies the upfront investigation cost (per [[workflow-adversarial-verify]]).
- **Even audit agents miscompute.** The F1 winding "bug" was wrong; hand-verification with concrete coords (4 small numbers) refuted it in 2 minutes. Default to hand-check on any geometric correctness claim (per [[audit-agent-claims-before-mass-delete]]).
- **Dual-audit must be invoked, not deferred.** Per [[dual-audit-after-phase-ship]], post-phase dual audit is convention. Skipping it once led to the user calling it out — a healthy signal that the convention is enforced socially even when not by tooling.
- **User reports often surface ancient gaps, not regressions.** "Can't delete vertices" sounded Init-Rig-specific; was actually "vertex delete never existed". Always check whether the user's symptom matches a recent commit OR a long-standing gap before assuming a regression.
- **Polymorphic operators by mode is the Blender pattern.** Same chord, different semantics by context. SS now has 2 instances; the substrate generalizes cleanly.

## Open work for next session

| ROI | Item | Cost | Note |
|-----|------|------|------|
| Med | `Shift+K` knife (only_selected mode) | Med | Requires `cutMeshAlongLine` selection-mode parameter + the canvas-knife-modal slice (interactive click-A-click-B with preview overlay). |
| Med | X-menu prompt (Blender-faithful `MESH_OT_delete` invoke menu) | Low | Trivially shippable — 1-item menu for vertex-only mode. Defer until edge/face selects exist so the menu becomes meaningful. |
| Low | `_onUndoSnapshotEvict` walk cost (deferred from 2026-06-03) | Med | O(N×M) per eviction; defer until measured hot. |
| Low | Knife click-A-click-B interactive modal (BVH snap + preview) | High | ~3-4 hours minimum for a working modal; full Blender-faithful is multi-day. |
| Low | v49 migration opacity-overwrite smell | Low | Defensible per variant fade contract; could add a `logger.info` when overwriting a non-zero opacity to surface the surprise. |

## Resume hint for next Claude

Last commit Claude `9cb1a0e` → next must be Pelmentor per RULE-№5.

The user has now reported and seen fixed:
1. Bug-08 variant fade (face.smile appears at ParamSmile=1)
2. Vertex Delete (X / Delete / Backspace work in Edit Mode)
3. Knife (K cuts between 2 selected verts)
4. Ctrl+Tab → Pose for armatures

User has NOT yet verified these in-browser on a freshly Init-Rigged Shelby. If a paste of new logs lands, prioritize that.

Standing options ranked by ROI:
1. **Wait for user verification.** Three real bugs surfaced in this session purely from user pastes; track record favors user-driven prioritization over speculative next-steps.
2. **Knife interactive modal.** The 2-select-vert variant works but the Blender-faithful experience is click-A-click-B with preview. Substantial substrate (~3-4 hours minimum). Only worth it if the user surfaces a need.
3. **X-menu Blender-faithful prompt.** Low cost when edge/face selects land. Premature today.

Default if user says "go next" without scoping: option 1 (wait, since session shipped 8 substantive items already).
