# Session Aggregate — 2026-05-20 — phantom (2nd fix) + edit→object refit + Pivot pill + header relocation + loading bar

**Branch:** master. **State:** commits `27493fa` + `2b682df` COMMITTED +
PUSHED to origin (pelmentor); two follow-up fixes (pivot-pill centering +
edit→object refit) UNCOMMITTED in the working tree. Typecheck clean;
touched files lint-clean (CanvasViewport's pre-existing unused-var +
`mesh` no-undef@~2460 errors are NOT from this session). **NONE
browser-verified** — user tests next.

Continuation of the edit-mode Blender-parity work. The user tested the
prior session's fixes and reported: (1) loading still felt slow + wanted a
slick bar, (2) the phantom STILL happened ("edit appears only after
changing modes"), (3) the Transform Pivot Point pill was missing, (4) the
floating Layers / Reset Pose / Apply Pose cluster should move into the
header, and finally (5) after the phantom was fixed, the edit didn't show
in Object Mode on exit.

---

## Shipped / changed

| Commit | What |
|---|---|
| `27493fa` | **Loading sweep bar** — CSS-only indeterminate feathered sweep under the topbar in the pre-React boot shell (`index.html`) |
| `2b682df` | **Phantom verts (2nd fix)** + **Transform Pivot Point pill** + **pose controls → header** |
| *(uncommitted)* | **Pivot pill centered** in the header; **edit→object-mode refit** on Edit-Mode exit |

---

## Root causes + fixes

### 1. Loading sweep bar — `27493fa`
User saw ~5 s on `localhost:5173`. Diagnosed (from the prior loading-times
baselines) as a **Vite dev-server artifact** — cold ESM waterfall
(`boot:reactRender` 5239 ms cold vs 147 ms hot); a prod build bundles it
away, and the PWA precaches the eager graph. So no "make it faster" work
was warranted; instead added a slick **indeterminate** CSS sweep to the
existing pre-React shell (`index.html`), honoring `prefers-reduced-motion`.
Indeterminate by design — browser ESM/chunk fetch progress isn't observable
from JS, so a percentage would be invented (Rule №1).

### 2. Phantom verts — the SECOND, real fix — `2b682df` (CanvasViewport ~1087)
The prior `47d483d` fix (keep the edited part rig-driven to avoid a
worldMatrix double-transform) was **necessary but insufficient**. The
remaining cause: in CanvasViewport's eval loop the edited part hit
`continue` with **no** `mesh_verts` override, so after the first edit-mode
frame it was in neither `newMeshOverridden` nor `meshOverriddenParts` →
the render loop **never re-uploaded its GL buffer**. A committed edit only
reached the GPU when a mode change forced a fresh upload (the
`meshOverriddenParts` restore branch fires on the first frame back) — the
"Tab-twice snaps the mesh to the dots" symptom. The vertex dots
(`VertexSelectionOverlay`) read `mesh.vertices` live, so they moved while
the mesh buffer stayed frozen = the phantom.
**Fix:** for the edited part, push its live `mesh.vertices` as the
`mesh_verts` override **every frame** + keep it rig-driven (camera-only).
The GL mesh then draws the exact same array the dots draw
(`mesh.vertices × zoom + pan`, camera-only) — they cannot diverge by
construction. Grounded in the actual draw path (read the overlay + upload
loop directly; did not trust a premise — the lesson from getting it wrong
in `fd23065`).

### 3. Transform Pivot Point pill — `2b682df`
New `src/v3/transformPivot.js` — enum verbatim from Blender's
`rna_enum_transform_pivot_full_items` (`rna_scene.cc:585-608`); persisted
`preferencesStore.transformPivot` (default `MEDIAN_POINT`, Blender's
default); per-mode pivot computed in `registry.js`
`beginVertexModalTransform` (true orbit centre — vertex G/R/S) and
`beginModalTransform` (object G/R/S maps mouse→angle/scale, parts spin in
place). Pill rendered in `ViewportHeader`.
**Ships 4 of Blender's 5 modes** — Median Point / Bounding Box Center /
2D Cursor / Active Element. **`INDIVIDUAL_ORIGINS` omitted on purpose**:
degenerate in SS (single-island art meshes ⇒ identical to median;
object-mode rotate already spins parts about their own origin), so a 5th
entry would be a phantom control (Rule №1). `CURSOR` labelled "2D Cursor"
(SS is 2D; matches the cursor tool's own label).
**Position:** first placed next to the ModePill (wrong); user flagged it.
Moved to the transform-tools cluster after the View/Select/Object menus,
then **centred** with flex spacers — matching Blender's `VIEW3D_HT_header`
where orientation / pivot / snap / proportional float in the middle.

### 4. Layers / Reset Pose / Apply Pose As Rest → header — `2b682df`
Moved the floating top-right canvas cluster into `ViewportHeader`
(`PoseControls`, right-aligned, store-backed — reads `editorMode` /
project / `PoseService` directly, no props; hidden on Live Preview because
ViewportHeader is only registered for the `viewport` editor). Flattened
the `ViewLayersPopover` trigger (h-8 card/blur/shadow → h-6 ghost) for the
header row. Removed the cluster + its now-dead imports
(`ViewLayersPopover`, `resetPoseDraft`/`resetToRestPose`, `Button`,
`Tooltip*`, `Popover*`, `RotateCcw`/`ChevronDown`/`Anchor`) from
CanvasViewport.

### 5. Edit→Object-Mode edit propagation — refit on exit — *(uncommitted)*
**The architectural decoupling, confirmed end-to-end.** A rigged part's
Object-Mode shape is blended **entirely** from `mesh.runtime.keyforms[]
.vertexPositions` (parent-deformer-local, baked at Init Rig —
`artMesh.js:99-107` / `selectRigSpec.js:494-583`). The art-mesh spec also
carries `verticesCanvas` (live `mesh.vertices`) but the depgraph kernel
does **not** use it for deformation. So editing `mesh.vertices` never
re-derives the baked keyforms → Object Mode keeps the pre-edit bake.
**Blender's behaviour:** leaving Edit Mode writes the cage back to the base
mesh, flags the depsgraph, and the modifier stack re-evaluates on the new
base (`ED_object_editmode_exit` → `BKE_mesh_*` → `DEG_id_tag_update`;
shape-key offsets via `BKE_keyblock_*`).
**Adaptation (CanvasViewport ~1301):** on Edit-Mode exit, snapshot-compare
the edited part's vertex-array reference (immer swaps it on any edit); if
it changed **and** the part is rigged (`mesh.runtime.keyforms`), re-derive
via `RigService.refitAll({ mode:'merge' })` — the existing tested pipeline
that projects canvas-px verts into each parent deformer's local frame.
**Deliberately did NOT hand-roll the canvas→parent-local projection** — it
needs `selectRigSpec`'s internal lifted-rest states + multi-keyform delta
propagation, the exact coordinate-space class mishandled twice on the
phantom (Rule №1 = reuse correct code). `refitAll('merge')` preserves pose,
params, and `_userAuthored` entries; reads `mesh.vertices` as source (never
overwrites the edit); the WeakMap harvest cache misses on the edited
project (new immer identity) so it genuinely re-derives. Non-rigged parts
skip the refit (they render `mesh.vertices` directly via the pre-rig
fallback). One deviation from Blender: it's a refit on Tab-out (a few
hundred ms, once per edit session), not per-keystroke — the faithful
"exit → re-eval" without SS needing a full live-eval refactor.

### 6. Vertex selection dropped after G/R/S commit — *(uncommitted)*
Blender keeps the selection through a transform; SS deselected verts after
a rotate (most visible on rotate — the cursor sweeps off the verts). Cause:
the modal commits on a window `mousedown` (capture), but the canvas selects
on React's `onPointerDown`; `pointerdown` fires **before** `mousedown` and
is a separate event stream, so the modal's `mousedown` stopPropagation
can't block it. The commit click's pointerdown ran selection first —
landing on empty canvas after a rotate → `deselectAllVertices`
(CanvasViewport ~2615). Translate often ended near the verts so the pick
re-selected them, masking the bug.
**Fix (CanvasViewport `onPointerDown` top):** bail when a vertex **or**
object modal transform is active (`useModalVertexTransformStore` /
`useModalTransformStore` `.kind !== null`), so the commit click never runs
canvas selection. Covers both the edit-mode vertex branch and the
object-mode part-select branch (same handler). Selection now survives
G/R/S, matching Blender.

---

## Files touched
- `index.html` — boot-shell sweep bar (`27493fa`).
- `src/v3/transformPivot.js` (NEW) — pivot enum/labels/coerce (`2b682df`).
- `src/store/preferencesStore.js` — `transformPivot` slot + setter (`2b682df`).
- `src/v3/operators/registry.js` — per-mode pivot in vertex + object G/R/S (`2b682df`).
- `src/v3/headers/ViewportHeader.jsx` — `PivotPill` + `PoseControls`; pivot centred (`2b682df` + uncommitted).
- `src/v3/shell/ViewLayersPopover.jsx` — flattened header trigger (`2b682df`).
- `src/components/canvas/CanvasViewport.jsx` — phantom 2nd fix; cluster + dead imports removed; edit→object refit effect; `onPointerDown` modal-active guard (selection preserved through G/R/S) (`2b682df` + uncommitted).

---

## VERIFICATION DEBT (next — user tests)
1. **Phantom (HIGH — wrong twice):** Edit Mode on the rigged arm/hand —
   G/R/S **and** brush move the mesh live *with* the dots, no mode change.
2. **Edit→Object refit:** edit a rigged part's rest mesh, Tab out → Object
   Mode shows the edit; pose / params / other parts intact; the
   "Rig refit…" toast fires only on a real change.
3. **Pivot pill:** centred in the header; the 4 modes re-centre rotate/scale
   correctly in Edit Mode (Median / BBox / 2D Cursor / Active).
4. **Header cluster:** Layers + Reset/Apply Pose look right in the row and
   stay hidden on Live Preview.
5. **Loading bar:** sweep visible during cold load (hard-reload to bypass
   cached `index.html`).
6. **Selection through transform:** select verts → R (or G/S) → confirm with
   a click → the verts stay selected (no deselect), incl. when the commit
   click lands on empty canvas.
