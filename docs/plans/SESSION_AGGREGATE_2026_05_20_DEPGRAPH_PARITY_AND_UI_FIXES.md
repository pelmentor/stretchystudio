# Session Aggregate — 2026-05-20 — depgraph parity gaps + UI/wizard fixes

**Branch:** master. **State at compact:** 8 files modified, **UNCOMMITTED**
(working tree dirty, 0 new commits). **Schema:** v42 (unchanged).
All changes are test-backed + typecheck-clean; left uncommitted pending the
user's browser verification.

This session was a bug-fix run triggered by user testing of the prior
session's UI Blender-parity work. Six fixes shipped (uncommitted); two
deeper depgraph parity gaps + two latent ones identified, with one (#1)
fixed and the rest scoped for a future session.

---

## Part 1 — three UI regressions from the prior session's UI-parity work

All three were regressions introduced by the 2026-05-20 UI mode/pill/tool
Blender-parity initiative (Slices A–E). They do NOT touch rig eval.

### Fix 1 — Sculpt workspace crash (`AreaTree.jsx`)
`react-resizable-panels` threw `Panel data not found for index 2` entering
the Sculpt workspace. Sculpt is the only **center+right** column shape; the
old code had three separate `return` branches each rendering a horizontal
`<PanelGroup>`, so React reused ONE instance and shrank a live 3-panel group
to 2 without stable panel ids. **Fix:** one persistent horizontal
`PanelGroup` built from a `columns` array, rendered as a FLAT, individually-
keyed list of `<Panel>` + `<PanelResizeHandle>` with stable `id`/`order`.
The `center` panel keeps a stable React key + library id, so CanvasArea's
WebGL2 context never remounts across workspace switches (preserves BUG-017).
Inner center (canvas/timeline) + side (top/bottom) groups got the same
id/order treatment with stable autoSaveIds.

### Fix 2 — Wizard "Adjust Joints" drag dead (`SkeletonOverlay.jsx:~218`)
Slice D's tool-aware select branch (Select tool → select-bone-not-drag)
fired on `toolMode === 'select'` regardless of mode. The import wizard's
adjust-joints step forces `skeletonEditMode = true` with NO `editMode`, and
the new default tool is Select → the branch hijacked the rest-pivot drag.
**Fix:** gate the select-branch on `editMode === 'pose'`, which the wizard
never is.

### Fix 3 — Brush cursor under the Select tool in Edit Mode (`CanvasViewport.jsx`)
The brush radius circle, `cursor:'none'`, and the `[`/`]` resize keys all
gated on `meshSubMode === 'deform'`, ignoring the active tool. Pre-Slice-A,
Edit Mode opened with the brush tool so they agreed; now it opens with
Select but `meshSubMode` still defaults to `'deform'`. **Fix:** added a
`toolMode === 'brush'` requirement to all three gates (added a reactive
`toolMode` subscription + `editorState.toolMode`). Pointer DISPATCH was
already correctly tool-driven, so this was purely cosmetic-cursor. Shape-
paint unaffected (only fires in the brush branch).

---

## Part 2 — depgraph engine parity gaps (the big find)

**Root context:** the viewport now renders SOLELY through the **depgraph**
engine (`src/anim/depgraph/`). The **classic** engine (`chainEval.js`
`evalRig`) was removed as a viewport option in the prior session's CO-A
close-out (commit `7c0852a`) BEFORE full parity was proven — so any chainEval
code path with no depgraph equivalent is a latent divergence. chainEval is
still used for the armature bake + the `sideBySide.js` test harness, so it
remains the parity reference.

**The pattern:** the depgraph uses a GLOBAL-per-warp model (one
`GRID_LIFT_TO_PARENT` per warp, walks global `def.parent` pointers).
chainEval has a PER-PART correction layer (selectRigSpec reprojection +
`getLiftedGridForChain`) that the depgraph has no counterpart for. Every gap
found is an instance of this.

### Fix 4 — handwear/legwear dislocated to canvas origin after Init Rig (FIXED)
**Symptom:** bone-baked parts (handwear → `Rotation_leftArm`/`_rightArm`,
legwear → `GroupRotation_<leg>`) render at the upper-left corner after Init
Rig; rest of the character fine.
**Root cause:** bone-baked parts carry their implicit rotation parent in
`mesh.runtime.parent`, NOT in `part.modifiers[]` (v21
`synthesizeModifierStacks` only inserts body-warp synthetics). chainEval
falls back to a global parent-pointer walk when `modifierChain` is null
(`chainEval.js:317-400`); the depgraph kernel walked ONLY `part.modifiers[]`,
so the rotation chain was never applied → verts stayed pivot-relative
(≈ origin). **Also a build-relations gap:** with empty modifiers the part's
`ART_MESH_EVAL` op had no upstream edge → it ran in the initial ready set,
BEFORE the rotation's `MATRIX_BUILD` existed.
**Fix (two parts):**
- `kernels/artMesh.js` — `walkDeformerParentChain()` mirrors chainEval's
  fallback + `gridLift.js`'s walk: from `runtime.parent`, apply each
  ancestor's lifted-grid (warp, break) / canvas-final matrix (rotation),
  walking `def.parent`. Gated on `implicitParentId && !implicitInModifiers`.
- `build.js` `buildPartModifierRelations` — adds the matching dependency
  edges (ancestor `MATRIX_BUILD`/`GRID_LIFT_TO_PARENT`+`KEYFORM_EVAL` →
  part's `ART_MESH_EVAL`) so the matrix evaluates first.
Pinned by Test 4 in `test_depgraph_eval_artMesh.mjs` (failed pre-fix).

### Fix 5 — warp overlay showed only ONE grid (FIXED)
**Root cause:** `WarpDeformerOverlay` renders a warp only if it has a lifted
grid (or is a top-level canvas-px warp). The depgraph never surfaced
`GRID_LIFT_TO_PARENT` into the overlay's `liftedGrids` map (a comment claimed
a "probe path" that never existed — Rule №2 baggage); the classic engine used
to fill it via `evalRig({ out:{liftedGrids} })`. **Fix:** `evalProjectFrame.js`
fills an optional `opts.liftedGrids` Map from the depgraph's
`GRID_LIFT_TO_PARENT` outputs; `CanvasViewport` passes it; the eval-cache hit
path republishes so toggling the overlay on a static rig populates. Pinned by
Test 5.

### Fix 6 — modifier-disable reprojection (gap #1, FIXED)
**Symptom (latent until a modifier is toggled off):** disabling a modifier so
a part's effective leaf parent changes → the mesh jumps to the wrong place.
**Root cause:** `selectRigSpec` reprojects keyform verts into the effective
leaf-parent frame when `needsReproject` (`selectRigSpec.js:523-537`,
`_reprojectKeyformVerts`); chainEval consumes the reprojected `meshSpec.
keyforms`. The depgraph read RAW `mesh.runtime.keyforms` (baked leaf frame).
**Fix:** the depgraph now sources keyform/binding DATA from the rigSpec when
handed one. `evalProjectFrameViaDepgraph(project, params, { rigSpec })` →
`ctx.rigArtMeshById` → `kernelArtMeshEval` blends rigSpec keyforms (else
runtime). Chain TOPOLOGY still read from the project. **No-op for the common
no-toggle case** (rigSpec keyforms ≡ runtime keyforms), so zero regression.
`CanvasViewport` passes `rigSpec: _rigSpec`. The existing modifier-loop
already skips disabled modifiers, so reprojected keyforms were the only
missing piece. Pinned by Test 6 (with rigSpec ⇒ matches chainEval; legacy
raw path diverges by the exact pivot delta = 100px).

**Trigger reachability confirmed:** `ModifierStackSection.jsx:85`
`toggleEnabled` wires a ✓/× button → per-part modifier disable is a live user
action, so #1 (and #2) are LIVE, not latent. (No divergence at Init Rig with
all enabled — which is why regular parts looked fine.)

---

## Open / deferred (next session)

### Gap #2 — per-part lift on a MID-STACK disable (NOT fixed, deferred)
When a *middle* (not leaf, not whole-stack) modifier is disabled on a part
that SHARES a deformer, chainEval recomputes a chain-specific lattice via
`cache.getLiftedGridForChain(stepSpec, chainAbove)` (`chainEval.js:277`,
impl `:721-805`); the depgraph uses the single GLOBAL `GRID_LIFT_TO_PARENT`
composed through the disabled ancestor → the part gets deformed by a warp it
opted out of (e.g. breath bleeds onto a part that disabled BreathWarp).
**Why deferred:** needs a genuine per-part lifted-grid subsystem in the
kernel (re-lift the leaf warp through the part's EFFECTIVE chain-above). The
cheap "compose nested grids step-by-step" shortcut is the quartic
approximation chainEval explicitly rejects → would be a Rule №1 crutch.
Trigger is narrow (shared deformer + mid-stack disable). Treat as its own
task. Reference for the correct math: chainEval `getLiftedGridForChain`.

### Gap #3 — `baseAngle` (latent, low)
depgraph applies `angle + baseAngle` (`matrix.js:109`, `rotationSetup.js:60`);
chainEval ignores `baseAngle` (`rotationEval.js:66`). Every authoring path
writes `baseAngle: 0` (rotationDeformers.js, bodyRig.js, buildRigSpecFromCmo3.js)
→ dormant. Note: here the depgraph is arguably the MORE correct engine.

### Gap #4 — reflect-flag blend (rare, low)
chainEval takes `reflectX/Y` from the heaviest keyform (`rotationEval.js:72-76`);
depgraph ORs them across the cell (`keyform.js:131-132`). Diverges only when
one cell blend mixes reflected + non-reflected keyforms.

### Verified EQUIVALENT (no gap)
Bone post-chain skinning (LBS/overlay/none), opacity + heaviest-cell
drawOrder, rotation FD-probe / canvas-final matrix, the bone-baked fallback
(now fixed).

---

## Files modified (all uncommitted)

| File | Fix(es) |
|---|---|
| `src/v3/shell/AreaTree.jsx` | #1 sculpt crash (panel id/order + keyed flat list) |
| `src/components/canvas/SkeletonOverlay.jsx` | #2 wizard joint-drag gate (`editMode==='pose'`) |
| `src/components/canvas/CanvasViewport.jsx` | #3 brush-cursor `toolMode` gate; #5 liftedGrids out-param; #6 pass `rigSpec` |
| `src/anim/depgraph/kernels/artMesh.js` | #4 `walkDeformerParentChain`; #6 rigSpec keyform source |
| `src/anim/depgraph/build.js` | #4 implicit-parent dependency edges |
| `src/anim/depgraph/evalProjectFrame.js` | #5 surface lifted grids; #6 `opts.rigSpec` + `buildRigArtMeshIndex` |
| `src/anim/depgraph/eval.js` | #6 thread `rigArtMeshById` through ctx |
| `scripts/test/test_depgraph_eval_artMesh.mjs` | Tests 4/5/6 (24 asserts total) |

**Tests:** full depgraph + chainEval suite green (depgraph_build 37,
eval_artMesh 24, sideBySide 7, sideBySide_rotationParent 6, armature 9,
liftedGrid 11, chainEval 25, artMeshEval 32, …). Typecheck clean. No NEW lint
(pre-existing: 6 in CanvasViewport, 7 unused-arg in build.js, 1
`evaluatedCount` in eval.js — all confirmed on HEAD).

## Verification debt (user-side)
- Browser-verify all six fixes: Sculpt opens without crash + character
  survives workspace switches; wizard Adjust-Joints dots drag; Edit Mode
  cursor normal with Select, brush circle returns with Brush; re-Init-Rig →
  handwear/legwear in place + warp overlay shows full lattice network;
  (optional) toggle a modifier off and confirm no dislocation.
- Then COMMIT (none committed yet — each fix is a clean single-revert).

## Rule alignment
- **Rule №1** — premise correction on the dislocation (it was a build-order
  gap, not just a kernel walk); #2 deliberately deferred rather than shipping
  the quartic-approx crutch.
- **Rule №3** — the parity audit was run via a research agent, not bounced to
  the user; the user was asked only the genuine product/scope call ("fix what's
  necessary").
- Findings template + per-part-lift reference preserved above for the
  follow-up session.
