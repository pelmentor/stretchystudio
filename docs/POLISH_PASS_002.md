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
| [PP2-005](#pp2-005) | bug    | high   | Hair opt-out — params (a) closed; visual deformation (b) open | partial |
| [PP2-006](#pp2-006) | bug    | high   | Bone rotation — only elbow/arm/head bones drive layers; rest are inert | partial (trunk closed; legs/legwear open) |
| [PP2-007](#pp2-007) | bug    | high   | Live Preview tab — wheel zoom and middle-mouse pan don't work | closed (this commit) |
| [PP2-008](#pp2-008) | bug    | medium | `ParamOpacity` (char global opacity) slider does nothing | closed (this commit) |
| [PP2-009](#pp2-009) | refactor | medium | Drop the Setup/Animate topbar pill — workspace drives editorMode | closed (this commit) |
| [PP2-010](#pp2-010) | feature  | medium | Warp grid overlay — render all warps live + outliner per-warp visibility | open (supersedes PP2-004) |

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

**Type:** bug · **Severity:** high · **Status:** partial — (a) params closed (this commit); (b) visual deformation open

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
- (a) ✅ Param leak fixed (this commit). `STANDARD_PARAMS` entries for hair/clothing now carry a `subsystem` tag; `buildParameterSpec` accepts `subsystems` and drops them when the flag is `false`. Bone-rotation + group-rotation passes also filter by name heuristic (`/hair/`, `/topwear|bottomwear|legwear|skirt|shirt|pants|cloth/`). `seedParameters` reads `project.autoRigConfig.subsystems` and threads it through.
- (b) Visual deformation — still open. With PP1-002 audit's hair-warp neutralisation in place, the rest keyform should be identity. User reports verts shift after Init Rig anyway. Hypothesis: A.6b widened-bbox rest grids aren't pure identity over the part's bbox (the widening shifts the bilinear-FFD interpolation result for verts at bbox edges). Needs an oracle dump: `evalRig(rigSpec, allParamsAtDefault)` → compare hair part output verts vs `node.mesh.vertices` to confirm whether the inert chain is actually identity at rest. If it isn't, replace the widened rest keyform with a uniform-rest grid that exactly fits the part's canvas-px bbox.

---

<a id="pp2-006"></a>
### PP2-006 — Bone rotation: only elbow/arm/head bones drive layers; rest are inert

**Type:** bug · **Severity:** high · **Status:** partial — trunk bones (neck/torso/head) closed (this commit); legs / clothing bones still need investigation

**Trunk-bone fix (this commit).** Added `BONE_ROLE_FALLBACK_PARAM` in [`SkeletonOverlay.jsx`](../src/components/canvas/SkeletonOverlay.jsx) — when a bone has no `ParamRotation_<sanitisedName>` (the auto-rig's `SKIP_ROTATION_ROLES` set: `torso` / `eyes` / `neck`), the rotation arc gesture writes to the canonical Live2D in-plane rotation param instead:
- `neck` / `head` → `ParamAngleZ`
- `torso` → `ParamBodyAngleZ`

`eyes` has no sensible single-axis rotation param (ParamEyeBallX/Y is iris position, not eye rotation), so it falls through to transform-only.

The clamp also tightened: when the bone drives any rig param, the visible bone arc clamps to the param range too (prevents the SVG arc from overshooting the param's `[-30, +30]` ceiling — which previously misread as "the rig is broken" since the arc kept rotating while the deformation stopped). The JS-skinning delta is re-derived from the clamped rotation so transform / param / skinning stay in sync.

X / Y axes (3D look-around — pull-the-bone-tip gesture) are out of scope; rotation arc gives one in-plane angle by construction.

**Open: legs + clothing bones.** The user's repro also mentioned `bothLegs` / `legwear`. Those bones are NOT in `SKIP_ROTATION_ROLES`, so [`paramSpec.js:300`](../src/io/live2d/rig/paramSpec.js#L300) section 6 should emit `ParamRotation_BothLegs` etc. and PP1-001 would route the gesture there. Why those particular bones still feel inert needs a live trace — possibilities: (a) the dependent meshes aren't wired into the rotation deformer's children, (b) sanitisation between auto-rig emit and SkeletonOverlay lookup diverges, (c) the user's `legwear` is a clothing-rig group that gets dropped when clothing-rig is opted out.

**Symptom (expanded 2026-05-03).** *"ПОСЛЕ INIT RIG СКЕЛЕТНЫЕ КОСТИ СТАНОВЯТСЯ USELESS - КРОМЕ ELBOW И ARM И FACE КОСТИ - ОСТАЛЬНЫЕ КОСТИ ПЕРЕСТАЮТ ВООБЩЕ ДРАЙВИТЬ ЧТО ЛИБО."* The arm + elbow bones rotate things (PP1-001). Neck / torso / legwear / bothLegs / etc. don't.

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

**Type:** bug · **Severity:** high · **Status:** closed (this commit)

**Symptom.** On the Live Preview canvas tab, wheel did nothing and middle-mouse drag didn't pan. Pointer events DID reach the canvas (the `previewMode` gates run cursor-look on LMB just fine); the writes also fired against `viewByMode.livePreview` via `setView('livePreview', …)`. They simply didn't appear on screen.

**Root cause.** [`CanvasArea.jsx:75`](../src/v3/shell/CanvasArea.jsx#L75) shares a single `<CanvasViewport>` instance across the Viewport and Live Preview tabs (so the WebGL2 context survives tab toggles — see `feedback_two_views_one_host`). The WebGL init lives in a `useEffect(..., [])` that captures `modeKey` in its rAF-tick closure exactly once at mount. Pan / zoom handlers correctly write to `viewByMode[<current modeKey>]` because their `useCallback` lists `modeKey` as a dep — but the tick kept reading `viewByMode[<initial modeKey>]`. So when the user opened Live Preview, gestures landed in `viewByMode.livePreview` while the renderer kept painting from `viewByMode.viewport`, producing the dead-feel.

**Fix.** Added `modeKeyRef` mirroring `modeKey` and changed the rAF tick to read it via the ref each frame. Also added a `useEffect(..., [modeKey])` that flips `isDirtyRef = true` so the freshly-active tab repaints immediately on toggle (no need to wait for an unrelated mutation).

---

<a id="pp2-008"></a>
### PP2-008 — `ParamOpacity` (char global opacity) does nothing

**Type:** bug · **Severity:** medium · **Status:** closed (this commit)

**Symptom.** The `ParamOpacity` slider in the Parameters panel produced no visible effect when moved. Should multiply the rendered opacity of every part by the slider value (canonical Live2D global-opacity behaviour).

**Root cause.** Mesh keyform bindings emit `ParamOpacity` with a single keyform at value `1.0` ([`artMeshSourceEmit.js:646`](../src/io/live2d/cmo3/artMeshSourceEmit.js#L646), [`meshBindingPlan.js:177`](../src/io/live2d/moc3/meshBindingPlan.js#L177) — same default, both rig + moc3 paths). With one keyform, `cellSelect` returns the same opacity regardless of slider value, so chainEval can't drive global opacity through bindings.

**Fix.** Added a `globalOpacity` opt to [`scenePass.draw`](../src/renderer/scenePass.js) that multiplies into `effectiveOpacity` per part. CanvasViewport reads `paramValues.ParamOpacity` (default 1) and threads it through both the live tick and `captureExportFrame` so single-frame + animation export honour the slider too. One read + one multiply, exactly per the original repair sketch.

---

<a id="pp2-009"></a>
### PP2-009 — Drop the Setup/Animate topbar pill

**Type:** refactor · **Severity:** medium · **Status:** closed (this commit)

**Why.** The Setup/Animate pill was a redundant axis. Memory `project_open_post_compact_2026_05_02` shows the pill went through several iterations (added, refined with "Mode" label PP1-005). User concluded the user always wanted Animate while in the Animation workspace and Setup elsewhere — two axes for one decision. Cleanest answer: drop the pill, derive `editorMode` from `activeWorkspace`.

**Implementation.** `uiV3Store.setWorkspace` now calls `setEditorMode('animation')` for the Animation workspace and `'staging'` for Default (via `EditorModeService`, which is already idempotent on no-op transitions and captures the rest pose on staging→animation). Topbar's pill + `editorMode` selector + `serviceSetEditorMode` import all removed. `test_uiV3Store` updated: the prior "workspace switch does NOT touch editorMode" Blender-contract assertion is replaced with the new "workspace DRIVES editorMode" assertion.

---

<a id="pp2-010"></a>
### PP2-010 — Warp grid overlay: render all warps live + outliner per-warp visibility

**Type:** feature · **Severity:** medium · **Status:** open (supersedes PP2-004)

**Why this exists.** User explained the original design intent: *"Я придумал чтобы посмотреть как ПРОИСХОДИТ деформация когда я драйвлю ANGLE XYZ и другие PARAMS."* The warp-grid overlay is a debug tool — see how each lattice deforms as parameters change. Cubism Editor shows the SELECTED deformer's grid; SS's intent is broader (network view of all lattices, animated with params).

**Scope.** Three sub-tasks bundled because they share infrastructure:

**(a) Render every warp's grid in canvas-px, animated with params.** Currently the overlay only renders warps with `localFrame === 'canvas-px'` — body chain top-level warps. Per-part rigWarps (hair, eyes, clothing, face accents) are `normalized-0to1` and don't render. Their canvas-px positions exist in chainEval's `cache._liftedById` map but aren't exposed.

  Repair: add `liftedGrids: Map<warpId, Float32Array>` to `evalRig`'s output. CanvasViewport caches it on `lastEvalCacheRef`. Overlay reads it via a new `useRigSpecStore` slice (or a dedicated `useRigEvalStore`). Overlay's `buildGrid` switches from `keyforms[0].positions` to `liftedGrids.get(warp.id)` when available — that gives canvas-px positions of the LIVE-evaluated grid (deforms with params, exactly what the user wants).

**(b) Per-warp visibility toggles in the Outliner Rig tab.** Currently the Rig tab shows the warp/rotation tree but every entry is "visible if master toggle is on". Add an eye icon per row that flips a `viewLayers.warpGridVisibility[warpId] = boolean` map. Default true. The overlay filters `displayWarps` by this map.

**(c) Cubism comparison.** Cubism Editor's pattern is: list deformers in left panel, click one → that deformer's grid shows on the canvas, control points draggable, grid follows live param changes. There's no "show all" mode out-of-the-box. SS's all-warps-on-by-default with per-row toggles is a SUPERSET — better for debugging. Cubism's draggable control points are out of scope for this entry (Phase 2D editing); the read-only network view comes first.

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
