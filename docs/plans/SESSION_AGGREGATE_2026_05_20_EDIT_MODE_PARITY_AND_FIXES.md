# Session Aggregate — 2026-05-20 — Edit-Mode Blender-parity + bug-fix run

**Branch:** master. **State:** all work COMMITTED + PUSHED to origin
(pelmentor), working tree clean. Typecheck clean; unit/operator/depgraph
suites green. **NONE browser-verified** — the user explicitly defers
testing + Blender-behaviour matching to the NEXT session.

This was a rapid bug-fix + edit-mode-parity run triggered by the user
testing the prior UI-parity work on a rigged character (Shelby-class
arm/hand). Commits `6525edf` → `47d483d` (plus `7207c38` gap #2, recorded
in the sibling depgraph-parity aggregate).

---

## Shipped (commits, newest last)

| Commit | What |
|---|---|
| `7207c38` | depgraph gap #2 — per-part lifted-grid on mid-stack disable (see depgraph aggregate) |
| `6525edf` | **Log spam** — `selectRigSpec` passes `suppressFlare:true`; the orphan-fallback "Phase 3.C" diagnostic was firing per-eval-frame |
| `93e1ca1` | **Bone/part pose animation → skinning (Phase D-5)** — the big one (below) |
| `dbe7b53` | **Edit-mode batch** — Spacebar play/pause; vertex R/S modal; 2D cursor gizmo + edit-mode snap; brush undo |
| `9b8afea` | **2D cursor** — Shift+RMB placement + fix modal/wizard bleed (fixed→absolute SVG) |
| `fd23065` | **(WRONG)** phantom-vertex fix attempt via inverse-world `iwm` — FAILED, reverted in `47d483d` |
| `47d483d` | **Phantom verts — correct fix** (rig-driven-keep) + **Cursor tool** |

---

## Root causes + fixes

### Bone/part pose animation never reached the mesh (Phase D-5) — `93e1ca1`
`kernelAnimationTrackEval` wrote bone pose into `ctx.poseOverrides`, but
NOTHING read it — `kernelTransformCompose` (which builds the bone world
matrices that drive skinning) read only static `node.pose`. build.js:282
literally said the TRANSFORM wiring "will" happen "once they exist" — never
did. So param animation reached the mesh (warps) but pose animation moved
only the skeleton overlay, not the layers.
**Fix:** build.js relation `ANIMATION_TRACK_EVAL(pose) → TRANSFORM_COMPOSE`;
`kernelTransformCompose` seeds owner pose from `ctx.poseOverrides` before
constraints; `evalProjectFrame` accepts `opts.poseOverrides` (the viewport's
`computePoseOverrides`, filtered to transform channels); CanvasViewport
threads it in + adds it to the eval cache key. Pinned by Tests 6/7 in
`test_depgraph_armature.mjs` (poseOverrides path + action-fcurve path).

### Brush mesh-edit undo — `dbe7b53`
Brush per-tick `updateProject` had no `skipHistory`, flooding the 50-entry
history with sub-pixel micro-steps (Ctrl+Z reverted one imperceptible tick
AND evicted real history). Adopted the sculpt `firstTick` pattern → one
stroke = one undo entry.

### Vertex R/S in Edit Mode — `dbe7b53`
G/R/S all dispatched to the OBJECT-mode transform; the vertex modal only
did translate (via Extrude). Routed `transform.translate/rotate/scale` to a
vertex modal in Edit Mode (median pivot, Blender default), extending the
store + overlay with rotate/scale math.

### 2D cursor — `dbe7b53` + `9b8afea`
Data + snap ops existed since v33 but nothing DREW it. Added Cursor2DOverlay
(Blender red/white crosshair). Placement = **Shift+RMB** (Blender default
`cursor_set_event`, blender_default.py:172). "Cursor to Selected" /
"Selection to Cursor" now work on the Edit-Mode vertex selection. Overlay is
an `absolute inset-0` SVG inside the viewport container (clipped, below
modals) — earlier `position:fixed` floated it over the wizard.

### Cursor tool — `47d483d`
Added Blender's `builtin.cursor` to the object/mesh/skeleton toolbars
(crosshair icon). Pick it → plain LMB places the cursor; Shift+RMB still
works in any tool.

### Phantom vertices (G/R/S moved the dots, not the mesh) — `fd23065` WRONG, `47d483d` CORRECT
**Failed first attempt (`fd23065`):** an investigation agent concluded the
modal wrote canvas-space deltas onto part-LOCAL verts without the
inverse-world (`iwm`) mapping the brush uses, and proposed threading `iwm`.
Shipped it; it made the dots and mesh diverge in DIFFERENT directions
(worse). The agent's premise was wrong.
**Correct diagnosis (`47d483d`):** `mesh.vertices` are **canvas-px**, not
local — proven by the dots (drawn camera-only) sitting exactly on the
rig-driven mesh (also camera-only, since rig output is canvas-px and
scenePass skips `worldMatrix` for rig-driven parts — the "-1B" rule,
scenePass.js:231). The bug: PP1-008 (CanvasViewport ~line 1087) DROPPED the
edited part from `rigDrivenParts`, so scenePass then multiplied by the
part's `worldMatrix` on top of already-canvas-px verts — a
**double-transform** that detached the rendered mesh from the camera-only
dots. (User confirmed: Tab-twice re-eval snapped the mesh to the phantom
position — the edited verts were correct all along; only the live display
was double-transformed.)
**Fix:** PP1-008 now KEEPS the edited part flagged `rigDrivenParts`
(camera-only) so its canvas-px verts aren't double-transformed; reverted the
`iwm` threading (store/registry/overlay) since deltas are canvas-px and
apply directly.

---

## Audit — "what else never happened / needs wiring"
Swept `src/anim/depgraph/` for `will wire / not yet / Phase D-N / stub`:
- **Pose → TRANSFORM_COMPOSE** — the one real production gap, fixed (`93e1ca1`).
- **`mesh_verts` fcurves** (animation.js:63 "defer to Phase N-3") — NOT a
  bug: the viewport applies `mesh_verts` as a post-eval GPU upload
  (CanvasViewport ~1186). Keyed mesh deformation already works.
- Other "Phase D-N" markers are test-only paths or documented design.

## Scale note (asked by user)
vs `upstream/master` (MangoLion), merge-base `24a83a2`: **816 commits ahead**,
+257k net lines — src ~+104k (135k LOC total), scripts ~+90k (314 test files /
82.5k LOC), docs ~+60k. `reference/` clones are gitignored, not counted.

---

## VERIFICATION DEBT (next session — user's explicit plan)

**Nothing here is browser-verified.** Test all, and chase any Blender
mismatch:

1. **Phantom-vertex fix (HIGH — I got it wrong once).** In Edit Mode on the
   rigged arm/hand: G/R/S and the brush should move the **mesh live with the
   dots** (no Tab needed). If they still diverge, the rig-driven-keep
   diagnosis is wrong — re-instrument the actual coordinate spaces
   (mesh.vertices[0], rig frame[0], worldMatrix, dot-screen vs mesh-screen)
   rather than trust another premise.
2. **Bone-pose animation** — generate an idle anim with arm-bone keys; the
   LAYERS must follow the skeleton during playback AND live posing.
3. Spacebar plays/pauses; brush edit → one Ctrl+Z reverts the stroke; 2D
   cursor visible + Shift+RMB places it + the Cursor tool places on LMB;
   "Cursor to Selected" works in Edit Mode; log panel quiet.

## Blender-fidelity verified this session
- Cursor placement = **Shift+RMB** (default `cursor_set_event`); Cursor tool
  = `builtin.cursor` (plain LMB). Both shipped.
- Edit-Mode transform pivot = **Median Point** (matched). Transforms are
  object-local in Blender; SS edited-parts are camera-only/canvas-px (the
  fix), which coincides for these parts.
- **Rest-cage editing is correct Blender default:** modifier default is
  `Realtime|Render|Editmode`, **`OnCage` off** (modifier.cc:153-159) → the
  editable verts sit at REST positions. SS now matches (camera-only rest
  cage). My earlier "it sits at rest during edit" caveat was wrong hedging —
  that IS Blender.

## Deferred Blender-parity ADDITIONS (features, not fixes)
- **Show deformed result in Edit Mode** (Blender `show_in_editmode`): SS
  shows only the rest cage during edit; Blender also shows the posed
  deformation semi-transparently. Only differs when posed in Edit Mode.
- **On-Cage toggle** (`show_on_cage`): put the editable verts on the
  deformed surface.
- **Known data-model limitation (not a bug):** editing a rigged part's rest
  `mesh.vertices` does NOT re-derive the baked keyforms live — the edit
  shows in Edit Mode (rest cage) but the rig output updates only after a
  Refit/re-init rig. This is the Tab-twice behaviour. True Blender "live
  modifier re-eval on the edited cage" would need the rig deformation to be
  a live function of the base mesh (big architectural change).
