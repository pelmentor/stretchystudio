# Polish Pass 002 — Visual Audit 2026-05-03 (post PP1)

**Context.** Second user-driven visual audit, opened immediately after `POLISH_PASS_001.md` closed (10/10). Same conventions: numbered `PP2-NNN` entries, status flow `open → investigating → in-progress → closed`, severities `critical / high / medium / low`.

**Scope discipline.** Same as PP1 — each entry stays self-contained. Items that mature into multi-day plans get a separate plan doc with a stub here.

---

## Status snapshot (2026-05-03)

| ID | Type | Severity | Title | Status |
|----|------|----------|-------|--------|
| [PP2-001](#pp2-001) | bug    | medium | Wizard Reorder step — canvas click-to-select dead | closed (`9330211`) |
| [PP2-002](#pp2-002) | bug    | medium | Proportional-edit ring visible outside mesh edit (wizard, Object Mode) | closed (`9330211`) |
| [PP2-003](#pp2-003) | feature| medium | Warp grid overlay — black + 25% opacity defaults | closed (`9330211`) |
| [PP2-004](#pp2-004) | bug    | high   | Warp grid overlay only renders ONE giant grid (nested warps invisible) | open |
| [PP2-005](#pp2-005) | bug    | high   | Hair opt-out leaks: ParamHair* still emitted, hair layers deformed | open |
| [PP2-006](#pp2-006) | bug    | high   | Bone rotation drag — neck / torso / legwear / bothLegs bones don't drive layers | open |
| [PP2-007](#pp2-007) | bug    | high   | Live Preview tab — wheel zoom and middle-mouse pan don't work | open |
| [PP2-008](#pp2-008) | bug    | medium | `ParamOpacity` (char global opacity) slider does nothing | open |

---

## Entries

<a id="pp2-001"></a>
### PP2-001 — Wizard Reorder step — canvas click-to-select dead

**Type:** bug · **Severity:** medium · **Status:** closed (commit `9330211`)

**Symptom.** During the PSD import wizard's *Reorder Layers* step, clicking a piece on the canvas didn't select anything; only Outliner clicks selected. The canvas-toolbar arrow tool was visible (suggesting select-mode was armed) but produced no result.

**Root cause.** `hitTestParts` in [`io/hitTest.js`](../src/io/hitTest.js) filtered candidates to parts with `mesh.triangles?.length > 0`. PSD-imported parts at the Reorder step still have raw image bytes only — auto-mesh hasn't run yet — so they're skipped entirely and the hit-test always returns null.

**Fix.** Hit-test now also accepts parts with `imageWidth`/`imageHeight` but no triangulated mesh, falling back to a quad-bbox test in local space. Click-to-select works from PSD import onwards.

---

<a id="pp2-002"></a>
### PP2-002 — Proportional-edit ring visible outside mesh edit

**Type:** bug · **Severity:** medium · **Status:** closed (commit `9330211`)

**Symptom.** The yellow dashed influence circle followed the cursor in Object Mode, the wizard banners (Reorder, Adjust Joints), and any other Default-workspace context — even though it's only meaningful inside Mesh Edit.

**Root cause.** PP1-008(b) gated the ring on `wsAllows = (workspace === 'default')`. The Default workspace is the home of Object Mode + every wizard step too, so the gate was effectively "always on inside Default".

**Fix.** Gate switched from workspace to `editMode === 'mesh'`. Outside mesh edit the ring is hidden regardless of `proportionalEdit.enabled`.

---

<a id="pp2-003"></a>
### PP2-003 — Warp grid overlay defaults — black + 25% opacity

**Type:** feature · **Severity:** medium · **Status:** closed (commit `9330211`)

**Request.** User found the previous sky-blue lattices loud, especially with PP1-007's render-all-warps change. Asked for black colour and 25 % default opacity.

**Implementation.** `editorStore.viewLayers.warpGridsOpacity` default `0.5 → 0.25`; popover slider + overlay fallback both updated. Warp `<g>` className changed from `text-sky-400` to `text-foreground` (theme-aware: black in light mode, off-white in dark). Selected warp keeps the sky-400 accent so it still pops against neutral grids. Removed the legacy `stroke-slate-900/80` border on dots — redundant with the foreground colour.

---

<a id="pp2-004"></a>
### PP2-004 — Warp grid overlay only renders ONE giant grid

**Type:** bug · **Severity:** high · **Status:** open

**Symptom.** With PP1-007 shipped (render all warps), the user expected to see the network of lattices: face parallax, hair sway warps, body chain, etc. In practice only ONE giant grid renders (visually it's the body chain top-level warp covering the whole figure).

**Root cause (verified by reading source).** [`WarpDeformerOverlay.jsx:107`](../src/v3/editors/viewport/overlays/WarpDeformerOverlay.jsx#L107) filters with `localFrame === 'canvas-px'`. Most rigWarps in the heuristic-path rigSpec have `localFrame === 'normalized-0to1'` (per-part hair/eye/clothing warps parented under FaceParallax / BodyChain). Those grids' control points are stored in their PARENT warp's normalised frame; projecting them back to canvas-px requires running them through chainEval's lifted-grid pass.

**Repair sketch.** Two options:
- (a) **Use chainEval's lifted cache.** chainEval already computes a canvas-px lifted grid per warp (see `cache._liftedById` in `chainEval.js`). Expose it on the evalRig output (e.g. add `liftedGrids: Map<warpId, Float32Array>`) and have the overlay render those positions. Pure read of an already-computed structure; cheap.
- (b) **Re-port the lift logic** into the overlay. More duplication; reject.

(a) is the right call. Plan: thread the lifted-grid map through `evalRig` → `lastEvalCacheRef` → overlay reads it via `useRigSpecStore` or a dedicated store slot.

---

<a id="pp2-005"></a>
### PP2-005 — Hair opt-out leaks: params + deformation

**Type:** bug · **Severity:** high · **Status:** open

**Symptom.** User opens Init Rig Options popover, unchecks **Hair Rig**, presses Init Rig:
1. `ParamHairFront` / `ParamHairBack` sliders STILL appear in the Parameters panel.
2. Hair layers visibly DEFORM on the canvas (without the user moving any slider).

**What's happening.**
- (1) `paramSpec.js:248-256` emits standard params (including `ParamHairFront` / `ParamHairBack`) gated on tag-presence only — there is no subsystem filter. PP1-002 + GAP-008 covered rigWarps and physics rules but didn't touch the parameter list.
- (2) PP1-002's audit follow-up neutralised hair rigWarps (single rest keyform, empty bindings) so chainEval evaluates them as identity. But the user reports visible deformation. Either the rest keyform isn't pure identity (A.6b widened-bbox grids may shift verts even at "rest"), or some other non-hair-but-affecting-hair driver is moving the hair (BodyAngle warp chain, parent-bone rotation, etc.). Needs trace.

**Investigation steps.**
1. After Init Rig with hairRig=false, dump `project.parameters.filter(p => p.id.startsWith('ParamHair'))` — confirm leak.
2. Reset all params to default (Reset Pose), confirm hair layers visually settle to canvas rest position. If they DON'T settle to rest, the rest keyform is non-identity → isolate which warp is shifting them.
3. With params at rest, slowly move ParamBodyAngleX — observe whether hair follows. That's expected (body warp drags hair). User may have meant "hair sways with body" rather than "hair sways autonomously".

**Repair plan.**
- Param leak: extend `buildParameterSpec(input)` to take `subsystems` and skip `ParamHair*` when `subsystems.hairRig === false`, `ParamShirt`/`Pants`/`Skirt` when `clothingRig === false`. Wire `subsystems` from `seedParameters` (read `project.autoRigConfig.subsystems`).
- Bone params: drop `ParamRotation_<bone>` when the bone group's name (or boneRole) matches the disabled subsystem (e.g. name lower-cased contains "hair"). Heuristic but matches the auto-rig naming convention.
- Deformation: needs trace before deciding fix.

---

<a id="pp2-006"></a>
### PP2-006 — Bone rotation drag: neck / torso / legwear / bothLegs don't drive layers

**Type:** bug · **Severity:** high · **Status:** open

**Symptom.** Quote from user: *"neck bone rotation doesn't drive layer pieces, only skeleton moves. same issue with bones like legwear, torso. НАДО ФИКСИТЬ ВСЁ БЕЗ КОСТЫЛЕЙ."*

The PP1-001 dual-write (transform + `ParamRotation_<sanitisedName>`) only works when the bone has a matching `ParamRotation_<...>` parameter in `project.parameters`. Some bones don't — specifically the auto-rig's `SKIP_ROTATION_ROLES` set (`['torso', 'eyes', 'neck']` per [`paramSpec.js:187`](../src/io/live2d/rig/paramSpec.js#L187)) intentionally OMITS these from the rotation-deformer pass; they're handled by warps (FaceParallax / body chain) instead. So dragging the neck bone has no `ParamRotation_Neck` to write to → SkeletonOverlay's `drag.rotationParamId === null` → only `node.transform.rotation` updates, which is invisible for rig-driven parts (worldMatrix is skipped).

For "legwear" / "bothLegs": those probably have no rotation deformer either (legwear is a part, bothLegs's rotation is body-warp-driven), so same issue.

**Repair sketch.** No single canonical fix — three classes of bone:
1. **Has `ParamRotation_<bone>`** (arms, elbows, etc.): PP1-001 already works.
2. **Drives a warp chain via standard params** (neck → ParamAngleX/Y, torso → ParamBodyAngleX/Y, etc.): the bone drag should write to those *standard* params instead. e.g. neck-bone drag → `ParamAngleX`. Mapping: bone boneRole → standard-param tuple. Live2D convention: head bones drive `ParamAngle*`, body/torso drive `ParamBodyAngle*`.
3. **Pure transform-only bones** (no rig wiring): drag still updates `node.transform.rotation`, which IS picked up by `worldMatrix` for non-rig-driven parts. These work today.

Implementation:
- Build a `boneRole → driverParams` map (e.g. `neck → [{paramId:'ParamAngleX', axis:'y'}, {paramId:'ParamAngleY', axis:'x'}]`).
- SkeletonOverlay rotate-drag computes the equivalent param value from the bone-rotation gesture and writes via `setMany`.
- Falls through to `node.transform.rotation` for unmapped bones (case 3).

This is "do as Live2D does": bones in the natural skeleton don't have their own rotation params for trunk segments — those segments are warp-driven by the standard ParamAngle* / ParamBodyAngle* set.

---

<a id="pp2-007"></a>
### PP2-007 — Live Preview tab — wheel zoom and pan don't work

**Type:** bug · **Severity:** high · **Status:** open

**Symptom.** On the Live Preview canvas tab, wheel does nothing and middle-mouse drag doesn't pan. The user can't reframe the live preview.

**Where to look.** [`CanvasViewport.jsx onPointerDown ~line 1620`](../src/components/canvas/CanvasViewport.jsx#L1620) — middle/right mouse + Alt+left → pan / zoom block. Then ~line 1644 there's a `previewModeRef.current` short-circuit that arms cursor look on LMB. The pan / zoom block IS above that, so middle-mouse pan should work in preview. Wheel handler is registered at `useEffect` ~1592 unconditionally.

**Hypothesis.** The Live Preview surface might have its own pointer-events stack that swallows the wheel/middle-mouse events before CanvasViewport sees them, OR `previewModeRef.current` gating is short-circuiting somewhere we missed. Needs a trace.

**Investigation steps.**
1. Add `logger.debug('preview-pointer', e.button, e.type)` at the very top of CanvasViewport's `onPointerDown` and `onWheel` and check whether events reach when previewMode is true.
2. Inspect the LivePreviewEditor wrapper for any `pointerEvents: 'none'` / `stopPropagation` that intercepts canvas events.

---

<a id="pp2-008"></a>
### PP2-008 — `ParamOpacity` (char global opacity) does nothing

**Type:** bug · **Severity:** medium · **Status:** open

**Symptom.** The `ParamOpacity` slider in the Parameters panel produces no visible effect when moved. Should multiply the rendered opacity of every part by the slider value (canonical Live2D global-opacity behaviour).

**Where to look.** `ParamOpacity` is emitted by `paramSpec.js` (line ~206 — `push({ ...PARAM_OPACITY })`). chainEval reads keyforms; per-mesh opacity is composed (variant fades, etc). Global `ParamOpacity` likely needs an explicit consumer in either chainEval (multiply mesh opacity by ParamOpacity value) or scenePass (uniform u_opacity multiplied at draw time).

**Repair sketch.** Add a global-opacity uniform multiplier in [`scenePass.js`](../src/renderer/scenePass.js) that reads `paramValues.ParamOpacity` (default 1) and multiplies it into `effectiveOpacity` for every part. Trivial fix; one read + one multiply.

---

## Cross-references

- Parent audit: [POLISH_PASS_001.md](POLISH_PASS_001.md) (closed 2026-05-03)
- Sister living docs: [BUGS.md](BUGS.md), [FEATURE_GAPS.md](FEATURE_GAPS.md), [PROJECT_DATA_LAYER.md](PROJECT_DATA_LAYER.md)
- Memory: `feedback_post_ship_audit.md` (audit-pass discipline)

## Tracking discipline

Same as PP1:
- When an entry transitions to `in-progress`, update its status here AND link the commit hash on close.
- When an entry's investigation reveals it's a feature pillar (≥1 day work), spin a dedicated plan doc, leave a 1-line stub here pointing to it.
- When ALL entries close, this document becomes read-only history. Future visual audits open `POLISH_PASS_003.md`.
