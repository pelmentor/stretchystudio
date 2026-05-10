# Toolset Blender-Parity Plan

Status: **REFINED v2** — incorporates 2-agent audit feedback (architecture + Blender-fidelity), 2026-05-09
Owner: pelmentor
Date opened: 2026-05-09
Target: ~7–11 weeks of focused work, 8 phases
Scope rule: **per user — only the most important Blender tools, not all of them; AND coverage spans all modes (Object / Edit / Pose / Weight Paint / Sculpt), not just Edit**.
Working rule: **RULE №1 — no quick-and-dirty fixes**. **RULE №2 — no migration baggage**.

Audit-driven changes from v1:
- **Schema numbers**: vTB+1 / vTB+2 placeholder tokens; canonical numbers assigned from `projectMigrations.js` header at ship time (audit caught: v33/v34 collision with the animation plan was real Rule №2 baggage)
- **§7.A scope trim** — dropped per audit simplifications: `Origin to Geometry`, `Make Single User`, `Apply Visual Transform`, `Lock Weights` (orphan with no spec)
- **§7.A added** — `Origin to Center of Mass (Surface)` (area-weighted centroid; useful on long thin parts like tails / hair)
- **§7.B Sample Weight** moved from `Ctrl+LMB` to **`Shift+X`** (audit-HIGH: `Ctrl+LMB` collides with Blender invert-paint chord)
- **§7.B Normalize All** **drops the `Ctrl+N` chord** (audit-HIGH: Blender `Ctrl+N` = File New globally; binding to Normalize would cause file-loss surprise). Menu-only access matches Blender.
- **§7.C Mirror Pose** moves from `Ctrl+Shift+M` to **`Ctrl+Shift+V`** (audit-HIGH: `Ctrl+Shift+M` is Blender's `pose.select_mirror`; pose-mirror in Blender is `Ctrl+Shift+V` = paste-flipped). `Ctrl+Shift+M` is reserved for select-mirror partner-extension (additional Phase 7.C operator).
- **§7.C Clear All Pose** clarified to **3 separate chords** `Alt+Shift+G` / `Alt+Shift+R` / `Alt+Shift+S` (audit-CRITICAL: the v1 plan had 3 different answers in 3 places; Blender ships them per-axis, no combined chord)
- **§0.B Ctrl+LMB "spatial-nearest"** replaced with **topology shortest-path** via BFS on `buildVertexAdjacency` (audit-HIGH: spatial-nearest is invented; Blender does topology shortest-path)
- **§3 Sculpt Inflate** swapped for **Sculpt Pinch** (audit-MEDIUM: Blender's Inflate is normal-based and degenerate on flat 2D meshes; Pinch is more useful for 2D rigging)
- **§4.C Subdivide** gains **`smoothness` slider** (audit-MEDIUM: important for organic 2D shapes; ~15 LOC addition)
- **§4.A Dissolve** specified to use **Meisters–Chazelle ear-clip** (audit-HIGH: handles non-convex polygons correctly; standard ear-clip silently fails on Live2D-typical concave silhouettes)
- **§5.A Extrude** boundary detection guarded against **degenerate seam triangles** (audit-HIGH: zero-area triangles falsely look like single-incident-triangle boundary)
- **§7.C.5 Mirror Pose role detection** narrowed to **`left*`/`right*` camelCase prefix only** (audit-MEDIUM: matches actual SS auto-rig boneRoles; suffix-based detection deferred without a real spec)
- **§4 Phase order** diagram updated to make **Phase 0 → Phase 1 dependency explicit**
- **Risk register** gains **3 missed risks**: topology-op snapshot-undo memory pressure; selection persistence on part-switch; sculpt-brush + Armature-modifier interaction
- **Estimate** revised upward: ~9–10 weeks realistic (was ~7.5 in v1; audit found Phase 7 mirror-vertex-map work underestimated 2–3×)

---

## 0. TL;DR

The SS toolset audit caught the operator system in mid-stride: G/R/S
modal, click-to-select, A select-all toggle, proportional editing,
weight paint, modal F-radius, keymap dispatcher, T-panel toolbar,
N-panel, modifier stack with Apply Pose As Rest and Add-Armature-Modifier
all shipped. What remains is a structural gap (no vertex-level selection
model in Edit Mode → blocks every multi-vertex op) and a usability gap
spread across all five modes: no box select (any mode), no sculpt
brushes beyond weight paint (Edit/Sculpt), no extrude / merge / dissolve
(Edit), no Insert Keyframe / I-menu (any mode), no Apply menu (any
mode), no duplicate (Object/Edit), no select linked (Edit), no Snap
menu (Object), no Mirror (Object), no Parent / Clear Parent (Object),
no Sample Weight or Blur brush (Weight Paint), no Mirror Weights
(Weight Paint), no Clear Pose (Pose).

This plan ports **the most important Blender tools across all five
modes** — Object / Edit / Pose / Weight Paint / Sculpt. The Top-12
mesh-and-selection cluster from the audit drives Phases 0–6; Phase 7
fills the per-mode gaps the user explicitly named. Knife / loop cut /
bevel / inset / rip / edge slide remain out of scope (each requires
either a half-edge data structure or expensive 2D ops that don't pay
back for a Live2D rigger).

The plan is two foundations and six tool-clusters:

- **Phase 0**: vertex-level selection model in Edit Mode (the foundation
  every multi-vertex op needs)
- **Phase 1**: box / lasso select — works in Object + Edit (the
  foundation that makes selection ops practical)
- **Phase 2**: snap to grid / snap to vertex during transform — works
  in any mode that uses modal G/R/S
- **Phase 3**: sculpt mode + Grab/Smooth/Inflate brushes (new Sculpt Mode)
- **Phase 4**: Merge / Dissolve / Subdivide (Edit Mode)
- **Phase 5**: Extrude (Edit Mode)
- **Phase 6**: Select Linked / Duplicate / Apply menu / Circle select
  (Edit + Object Mode)
- **Phase 7**: per-mode tool completion — Object Mode: Snap menu,
  Mirror, Parent / Clear Parent, Origin set; Weight Paint: Sample
  Weight, Blur brush, Mirror Weights, X-Axis Mirror toggle; Pose
  Mode: Clear Pose Loc/Rot/Scale, Mirror Pose

The cmo3 / moc3 / can3 / motion3 / model3 export pipeline is unchanged
by this plan — every phase ships byte-identical re-exports of Hiyori
and Shelby.

---

## 1. Why now

Three forces:

1. **The mode/workspace system is settled.** [BLENDER_PARITY_REFACTOR.md](./BLENDER_PARITY_REFACTOR.md)
   shipped Phases 1–5 (2026-05-06); the
   [project_workspace_mode_rework_2026_05_02.md](../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/project_workspace_mode_rework_2026_05_02.md)
   collapsed five workspaces to three; the [edit-mode refactor](../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/project_edit_mode_refactor_2026_05_02.md)
   replaced three flags with a single `editMode` slot. The mode system
   can now host new operators cleanly.
2. **The single-vertex-selection wall.** Every Blender mesh-edit op
   except Knife and Inset works against a vertex selection set. SS has
   no vertex selection set in Edit Mode — only a brush that picks by
   proximity. Until we add a vertex selection set, we can't ship
   Merge, Dissolve, Subdivide of selected, Extrude, Select Linked,
   Duplicate verts, Smooth-only-selected, Sculpt grab on selection,
   etc. — which is most of the user-facing toolset value.
3. **User direction.** The user has explicitly said "only the most
   important". The Top-12 is what passes that bar.

---

## 2. Scope

### 2.1 In scope — broken out per mode

#### Top-12 cross-mode + Edit-heavy (Phases 0–6)

Order is by phase grouping, not pure ranking:

| # | Tool | Hotkey | Mode | Phase |
|---|------|--------|------|-------|
| 1 | Vertex selection model | LMB / Shift+LMB / A | Edit | Phase 0 |
| 2 | Box Select | B | Object + Edit | Phase 1 |
| 3 | Circle Select | C | Object + Edit | Phase 6 |
| 4 | Lasso Select | Ctrl+drag | Object + Edit | Phase 1 |
| 5 | Snap to grid / vertex | Shift (modal) + Snap menu (Shift+S) | Any modal G/R/S | Phase 2 |
| 6 | Sculpt Grab | (Sculpt → LMB) | Sculpt | Phase 3 |
| 7 | Sculpt Smooth | (Sculpt brush) | Sculpt | Phase 3 |
| 8 | Sculpt Inflate | (Sculpt brush) | Sculpt | Phase 3 |
| 9 | Merge / Merge by distance | M | Edit | Phase 4 |
| 10 | Subdivide | (right-click → Subdivide) | Edit | Phase 4 |
| 11 | Extrude | E | Edit | Phase 5 |
| 12 | Select Linked | L / Ctrl+L | Edit | Phase 6 |

Plus three Phase-6 small wins (share infrastructure with the cluster):

- **Duplicate** (`Shift+D`) — Object Mode duplicates parts; Edit Mode
  duplicates selected verts.
- **Apply menu** (`Ctrl+A`) — surfaces existing apply operators (Pose
  as Rest, modifiers per-modifier, visual transform).
- **Dissolve** (`Ctrl+X` for menu, `X` from M-menu for "dissolve
  verts") — shares the merge/subdivide retriangulate path.

#### Per-mode tool completion (Phase 7)

The user's reminder: **toolsets are needed for Object / Weight Paint /
Pose, not just Edit**. Phase 7 covers the per-mode gaps:

**Object Mode (Phase 7.A):**

| Tool | Hotkey | Why |
|------|--------|-----|
| Snap menu (Selection to / Cursor to) | `Shift+S` | One-shot snap (vs Phase 2's modal-only snap). Snap selection to cursor / grid / world origin / active. Snap cursor to selection / grid / world origin. |
| Mirror selected | `Ctrl+M` then `X`/`Y` | Mirror selected parts across an axis through the median pivot |
| Parent | `Ctrl+P` | Parent active selection to last-clicked object (sets `node.parent`) |
| Clear Parent | `Alt+P` | Submenu: clear, clear & keep transform, clear inverse |
| Set Origin | (right-click → Set Origin) | Submenu: origin to median, origin to cursor, origin to bounding box center, **origin to center of mass (surface)** (audit-added: area-weighted centroid; gives better pivots on tails / hair locks where median or AABB-center are off-target) |

(v1 also listed *Origin to Geometry* and *Make Single User*. Audit
simplifications: Origin to Geometry is a Blender direction-inverse op
unrelated to centroid types; dropped to reduce confusion. Make Single
User has no current data model to act on — SS doesn't share mesh
data between nodes — and was Rule №2 spec-without-purpose; deferred
until a real Duplicate-Linked feature ships.)

**Weight Paint Mode (Phase 7.B):**

| Tool | Hotkey | Why |
|------|--------|-----|
| Sample Weight | **`Shift+X`** (audit-fixed; was `Ctrl+LMB`) | Pick the weight value at a vertex (set as current brush weight). `Ctrl+LMB` is reserved for Blender's invert-paint chord; do not bind it for sample. |
| Blur brush | (brush dropdown) | Smooth weights between neighbours. Companion to existing Add brush. |
| Mirror Weights | (right-click → Mirror) | Mirror weights across X-axis (or any axis); supports both **position-based** and **name-based** flips (e.g. `Group.L` ↔ `Group.R`) per Blender `OBJECT_OT_vertex_group_mirror`. |
| X-Axis Mirror toggle | (N-panel) | Live mirror — paint on one side, the symmetric side updates simultaneously. Matches Blender's per-Mesh symmetry. |
| Normalize all | (right-click → Normalize All) **no chord** (audit-fixed; was `Ctrl+N`) | Per-vertex sum of weights = 1.0 across all unlocked groups. **`Ctrl+N` is Blender's File New globally; binding it would cause file-loss surprise.** Menu-only, matching Blender. |

(v1 also listed *Lock weights per group* as `(UI gap)` orphan — audit
flagged it as a Rule №2 transition diagnostic; either fully spec
(per-group locked: boolean + lock-respecting normalize logic) or drop
from scope. Deferred to a follow-up plan because the lock-respecting
logic in §7.B.5 already handles the runtime side; the UI surface for
toggling locks is the only missing piece and falls naturally into a
Properties-section polish pass.)

**Pose Mode (Phase 7.C):**

| Tool | Hotkey | Why |
|------|--------|-----|
| Clear Pose Location | `Alt+G` | Reset pose translation on selected bones to (0, 0) |
| Clear Pose Rotation | `Alt+R` | Reset pose rotation on selected bones to 0 |
| Clear Pose Scale | `Alt+S` | Reset pose scale on selected bones to (1, 1) |
| Clear All Pose (per-axis) | **`Alt+Shift+G` / `Alt+Shift+R` / `Alt+Shift+S`** (audit-fixed) | **3 separate chords**, one per axis (matches Blender; v1 had three different answers in three places) |
| Select Mirror | `Ctrl+Shift+M` (audit: this is Blender's chord) | Extends selection to the mirror partner of each selected bone (matches Blender `pose.select_mirror`). |
| Mirror Pose | **`Ctrl+Shift+V`** (audit-fixed; was `Ctrl+Shift+M`) | Pastes a previously-copied pose flipped across X (matches Blender's `pose.paste(flipped=true)`). Pair with Copy Pose first. The single-step "mirror selected bones' pose without copy" workflow lives in the Pose menu without a chord (also Blender-faithful). |
| Copy / Paste Pose | `Ctrl+C` / `Ctrl+V` | Copy current pose of selected bones; paste onto matching boneRoles. Foundation for a future Pose Library. |

### 2.2 Out of scope (deliberately not Top-12)

| Tool | Why excluded |
|------|--------------|
| Knife (K) | Audit says Hard; needs robust 2D edge-distance + polygon clipping + retriangulate; high cost, niche use |
| Loop Cut + Slide (Ctrl+R) | Needs a half-edge / topology data structure SS doesn't have; expensive to add for one tool |
| Bevel (Ctrl+B) | Edge bevel needs edge selection; vertex bevel needs adjacency; lower 2D value |
| Inset (I) | Needs face selection + polygon offset; SS has no face selection model |
| Rip (V) / Rip Edge | Cursor-proximity ops are fragile in 2D; lower user value than the alternatives |
| Edge Slide (G+G / Shift+E) | Needs edge selection model; defer with Bevel |
| Select Similar (Shift+G) | Heuristic; rarely used in 2D |
| Custom transform orientations | Canvas space is sufficient for 2D; defer |
| Sculpt Pinch / Snake Hook / Layer / etc. | Less critical than Grab + Smooth + Inflate trio |
| Subdivision Surface modifier | A *render-time* subdivision; Phase 4 ships *destructive* subdivide which is the user-visible op |
| Multires / Sculpt detail layers | 3D-specific concept; not useful in 2D |

The `I` key is reserved for the **animation plan's Insert Keyframe**
operator (per ANIMATION_BLENDER_PARITY_PLAN.md §12). The toolset plan
explicitly does not bind `I` to Inset — Inset would shift to a
sub-menu accessible from the Mesh menu.

### 2.3 Reserved (might come later, but not in this plan)

- Half-edge / DCEL data structure (for Loop Cut + Bevel + Edge Slide)
- Topology-aware undo (delta-based instead of full snapshot)
- Scriptable operators / user-extensible operator registry
- Custom transform orientations + pivot points beyond median/cursor

---

## 3. Architecture overview

The end state has three new substrates:

```
editorStore.selectedVertexIndices : Map<partId, Set<number>>
                                    ^ Phase 0; consumed by every Edit-Mode op

selectMode operators (box / circle / lasso)
                                    ^ Phase 1 + Phase 6; consume vertex selection in Edit Mode,
                                      part list in Object Mode

src/lib/snap.js                     ^ Phase 2; spatial hash on rest verts;
                                      consumed by ModalTransformOverlay

src/lib/sculpt/
  ├── grab.js                       ^ Phase 3; reuses proportionalEdit infrastructure
  ├── smooth.js                     ^ Phase 3; Laplacian smoothing on vertex neighbors
  └── inflate.js                    ^ Phase 3; per-vertex normal-direction push

src/v3/operators/edit/
  ├── merge.js                      ^ Phase 4
  ├── dissolve.js                   ^ Phase 4
  ├── subdivide.js                  ^ Phase 4
  └── extrude.js                    ^ Phase 5
```

Three core invariants:

**A — Vertex selection is per-part, not global.** Selecting verts in
mesh A and mesh B doesn't merge them; each part owns its own selection
set. Mode-switch out of Edit Mode preserves the set; switching back
restores. This matches Blender's Edit Mode (selection per `Mesh`
datablock).

**B — Sculpt is a sub-mode of Edit, not a peer.** Blender treats Sculpt
as a peer of Edit. SS's mode compat table already lists `MODE_SCULPT`
as a peer — Phase 3 keeps that. The active brush (Grab / Smooth /
Inflate) is on `editorStore.toolMode` within `editMode === 'sculpt'`.

**C — Operators write through the existing undo/batch system.** Every
new operator wraps its mutation in `beginBatch` / `endBatch` (already
shipped in [src/store/undoHistory.js](../../src/store/undoHistory.js)).
No new undo machinery.

---

## 4. Phase order (audit-fixed: explicit dependencies)

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4 ──→ Phase 5
   │           ║                                    ║
   │           ╚════════════════════════════════════╝
   │                            │
   └─→ (Phase 0 is foundation for every Edit-Mode op below)
                                │
                          Phase 6
                                │
                          Phase 7
                     (per-mode polish)
```

**Audit-driven dependency clarification:** Phase 1's Edit-Mode path
*requires* Phase 0's `selectedVertexIndices`. Phase 1's Object-Mode
path is independent but ships together. Phases 4 (Merge/Dissolve/
Subdivide) and 5 (Extrude) directly require Phase 0's selection set.
This was implicit in v1; the diagram now shows it explicitly so future
work can't extract Phase 1 Object-Mode early and leave the Edit-Mode
path unfinished.

Phases 0 and 1 are foundations. Phase 2 (snap) is mostly independent
and could land anywhere after Phase 0 — schedule it after Phase 1 to
let users get box-select first. Phase 3 (sculpt) is independent of
Phases 1–2 but shares mode infrastructure with Phase 0. Phase 4 (merge
/ dissolve / subdivide) and Phase 5 (extrude) need both Phase 0
(vertex selection) and Phase 2 (snap, used by extrude modal). Phase 6
picks up small adjacent wins. Phase 7 closes per-mode coverage
(Object / Weight Paint / Pose) — these tools are mostly independent
of each other and could ship in any internal order, but they all
benefit from Phase 0's selection-aware foundations and Phase 2's snap
module. **Cross-plan note:** Phase 2's `src/lib/snap.js` exposes
`snapToIncrement(value, increment)` which the animation plan's Phase
5 Graph Editor imports for snap-to-frame.

Each phase is independently shippable.

---

## 5. Phases

### Phase 0 — Vertex selection model (5–7 days)

**Goal.** Edit Mode gains a first-class vertex selection set. Every
subsequent mesh-edit operator dispatches against it.

#### 0.A — `editorStore.selectedVertexIndices`

```js
// editorStore additions
selectedVertexIndices: Map<partId, Set<number>>,

// Actions
selectVertex(partId, vertIndex, additive=false) → void
deselectVertex(partId, vertIndex) → void
toggleVertexSelection(partId, vertIndex) → void
selectAllVertices(partId) → void   // for active part
deselectAllVertices(partId) → void
clearAllVertexSelections() → void  // on edit-mode exit
isVertexSelected(partId, vertIndex) → boolean
getSelectedVertexCount(partId) → number
getAllSelectedVertices(partId) → number[]
```

#### 0.B — Click semantics in Edit Mode

[CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx)
`onPointerDown` in Edit Mode + `toolMode === 'select'`:

- LMB on a vertex → select that vertex (replace previous selection)
- Shift+LMB on a vertex → toggle that vertex
- **Ctrl+LMB on a vertex → topology shortest-path** from active to clicked, via BFS on `buildVertexAdjacency` (audit-fixed: this matches Blender's `mesh.shortest_path_pick`; v1's "spatial-nearest path" was invented and would confuse Blender users). Selects all verts on the shortest connectivity path. ~30 LOC.
- LMB on empty space → deselect all (same as Object Mode)

The vertex-hit-test is a new helper: [src/io/hitTest.js](../../src/io/hitTest.js)
gains `hitTestVertices(parts, point, threshold) → { partId, vertIndex }
| null`. Threshold = 6px scaled by zoom (matches Blender's vertex
pick threshold).

#### 0.C — `A` key in Edit Mode

`A` toggles select-all-or-none scoped to the active part's vertices
(currently A toggles parts in Object Mode). Pressing `Alt+A`
deselects all.

#### 0.D — Render

Selected vertices render as orange-filled dots (HSL `25 95% 55%`);
unselected as small white dots (HSL `0 0% 100%` at 60% alpha). The
*active* vertex (last clicked) renders as a small white-bordered
orange dot. Render lives in [WeightPaintOverlay.jsx](../../src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx)'s
sister overlay [VertexSelectionOverlay.jsx] (new).

#### 0.E — Brush mode coexistence

Edit Mode currently has three `toolMode`s: `brush`, `add_vertex`,
`remove_vertex`. Phase 0 adds `select` as the new default. Brush stays
for "soft modify" (proportional-edit drag of nearest); `select` is the
selection-aware path. The T-panel is updated in Phase 0 to show:

```
Edit Mode tools:
  • Select    (LMB toggle)        [default]
  • Brush     (drag soft)
  • Add Vertex
  • Remove Vertex
```

#### 0.F — Mode-switch persistence

`editorStore.selectedVertexIndices` is preserved across mode switches
(entering Pose Mode and back to Edit Mode keeps your selection).
Cleared on:
- Leaving Edit Mode for Object Mode (per Blender)
- Switching active part
- Mesh topology change (vertex count differs)

#### 0.G — Tests

| Test | What |
|------|------|
| `test_vertexSelection_basic.mjs` | LMB / Shift+LMB / Ctrl+LMB / A semantics |
| `test_vertexSelection_persistence.mjs` | Mode switch round-trip |
| `test_vertexSelection_invalidation.mjs` | Topology change clears selection |
| `test_vertexSelection_hitTest.mjs` | hitTestVertices vs zoom + threshold |

#### 0.H — Phase exit gate

- All vertex-selection tests green.
- Manual: in Hiyori Edit Mode, click a vertex, see orange dot. Shift-click another, both orange. A toggles all on/off.
- No regressions in existing Edit-Mode brush tests.

**Phase 0 sum:** 5–7 days. New: vertex selection model + UI rendering
+ hit-test. Closes: foundation gap that blocked Phases 4, 5, 6
multi-vertex ops.

---

### Phase 1 — Box / Lasso Select (1 week)

**Goal.** Rubber-band rectangle and freehand lasso selection in both
Object Mode (parts) and Edit Mode (verts).

#### 1.A — Box Select operator

`selection.boxSelect` (`B` hotkey):

- Modal capture pointer.
- LMB-down → start rectangle; LMB-drag → resize; LMB-up → commit.
- During drag: rectangle drawn as dashed border in the active overlay.
- On commit: hit-test contained elements.
- Modifiers:
  - Shift held during commit → add to selection (instead of replace)
  - Ctrl held during commit → subtract from selection
  - Mid-drag: A toggles "select all under" semantics (Blender-style)

In Object Mode: select parts whose mesh AABB intersects the rect.
In Edit Mode: select verts whose canvas-px position falls inside the rect.

#### 1.B — Lasso Select operator

`selection.lassoSelect` (`Ctrl+LMB-drag`, the Blender chord):

- Modal capture; user drags polygon path.
- On release: point-in-polygon test (winding number) against each
  candidate's canvas-px position.
- Same modifiers as Box.

#### 1.C — Select All by Pixel Box (Edit-Mode-only optimization)

For meshes with >5000 verts, Box Select uses a quadtree built from
rest verts; Lasso uses a coarse AABB pre-filter then point-in-polygon.

#### 1.D — Modal capture infrastructure

Reuse the modal capture pattern from
[ModalTransformOverlay.jsx](../../src/v3/shell/ModalTransformOverlay.jsx).
New: `BoxSelectOverlay.jsx` + `LassoSelectOverlay.jsx`. Each renders a
fixed-position SVG with `pointer-events: all` over the canvas.

#### 1.E — Tests

| Test | What |
|------|------|
| `test_boxSelect_objectMode.mjs` | Parts AABB-rect intersection + replace/add/subtract |
| `test_boxSelect_editMode.mjs` | Vertex-in-rect + replace/add/subtract |
| `test_lassoSelect_winding.mjs` | Winding number for self-intersecting paths |
| `test_lassoSelect_modifiers.mjs` | Shift / Ctrl modifiers |

#### 1.F — Phase exit gate

- All select tests green.
- Manual: B-drag a rect over Hiyori in Object Mode → selects intersecting parts.
- Manual: B-drag in Edit Mode after selecting verts → highlights verts in rect.

**Phase 1 sum:** ~1 week. New: B / Ctrl+drag operators + overlays.
Closes: Top-12 #2 + #4.

---

### Phase 2 — Snap to grid / vertex (3–4 days)

**Goal.** Modal G transform respects snap modes. Snap-to-grid by
default, snap-to-vertex when held shift+drag near a vertex.

#### 2.A — Snap preference store

[src/store/preferencesStore.js](../../src/store/preferencesStore.js):

```js
snap: {
  enabled: false,                  // master toggle
  modes: {
    grid: { enabled: true, increment: 16 },     // canvas-px
    vertex: { enabled: true, threshold: 8 },    // canvas-px
    increment: { enabled: false, value: 1 },    // for rotation/scale
  },
  target: 'closest',  // 'closest' | 'center' | 'median' | 'active'
}
```

#### 2.B — Snap-to-grid in Modal G

[ModalTransformOverlay.jsx](../../src/v3/shell/ModalTransformOverlay.jsx)
`applyDelta()` consults `snapState`:

- If snap.modes.grid.enabled and Shift held: snap delta to nearest grid
  multiple. Replaces the current `Math.round(delta / 10) * 10` line
  with `Math.round(delta / snap.grid.increment) * snap.grid.increment`.
- A small visual indicator (faint dotted grid) renders when snap is
  active.

#### 2.C — Snap-to-vertex in Modal G

A spatial hash over all rest verts in the project (cached and
invalidated on topology change). Lookup: nearest vert within
`snap.modes.vertex.threshold` from the current pointer position. If
found, snap delta = (vert - originalCursor).

A small magenta dot renders on the snap target during modal drag.

#### 2.D — Snap-to-grid in Modal R

Rotation snaps to `snap.modes.increment.value` degrees when Shift held
(currently fixed at 15°; preference makes it user-configurable).

#### 2.E — N-panel snap section

The N-panel gains a Snap section visible in all modes:
- Master enable toggle
- Per-mode toggle (grid / vertex / increment)
- Per-mode value input
- Target dropdown

#### 2.F — Tests

| Test | What |
|------|------|
| `test_snap_grid_translate.mjs` | Snap math at various increments |
| `test_snap_vertex_threshold.mjs` | Snap engages within threshold, releases beyond |
| `test_snap_rotation_increment.mjs` | Rotation snap math |
| `test_snap_target_modes.mjs` | closest / center / median / active |

#### 2.G — Phase exit gate

- All snap tests green.
- Manual: G then Shift held → cursor snaps to grid increments.
- Manual: G near a vertex → magenta dot appears, drag snaps to it.

**Phase 2 sum:** ~3–4 days. New: snap module + UI. Closes: Top-12 #5.

---

### Phase 3 — Sculpt mode + brushes (1 week)

**Goal.** A new edit-mode `'sculpt'` with three brushes that reuse
the proportional-edit + weight-paint brush infrastructure.

#### 3.A — Mode entry

`editorStore.editMode = 'sculpt'` is already legal in
[modeCompat.js](../../src/modes/modeCompat.js). Phase 3 wires up:
- T-panel entry: "Sculpt Mode" button in mode dropdown
- Active T-panel content: brush list
- N-panel content: brush settings

The mode is reachable from a meshed part's ModePill dropdown (alongside
Edit / Pose / Weight Paint).

#### 3.B — Brush registry

[src/lib/sculpt/index.js]:

```js
export const SCULPT_BRUSHES = [
  { id: 'grab',    label: 'Grab',    impl: grabBrush },
  { id: 'smooth',  label: 'Smooth',  impl: smoothBrush },
  { id: 'pinch',   label: 'Pinch',   impl: pinchBrush },  // (audit-swap: was 'inflate')
];
```

**Audit-driven swap:** v1 shipped Inflate. Blender's Inflate moves
verts along the per-vertex *normal*, which on a flat 2D mesh is
degenerate (all parallel to canvas Z; produces zero displacement).
The math v1 proposed (sum-of-edge-gradients) was a 2D reinvention
that doesn't match Blender's Inflate at all. **Pinch** is more useful
for 2D rigging (sharpening contour points, tightening hair tips, eye
corners) and has a Blender-faithful implementation that translates
cleanly to 2D: each affected vertex moves toward (or away from, with
Ctrl) the brush center.

Each brush exports:
- `tick(state, dt) → updatedVerts: Map<vertIndex, { x, y }>`
- `init(state) → state` — called on stroke begin
- `dispose(state) → void` — called on stroke end (commit batch)

State per stroke:
```js
{
  partId: string,
  cursor: { x, y },               // canvas-px
  pressure: number,               // 0..1
  size: number,                   // canvas-px radius
  strength: number,               // 0..1
  falloff: 'smooth' | 'sphere' | 'sharp' | 'linear' | 'constant',
  affectedIndices: Set<number>,   // computed at init from spatial hash
}
```

#### 3.C — Grab brush

Identical math to proportional-edit drag with falloff. The cursor
defines the anchor; on each tick, all vertices within `size` are pulled
by `(cursor - lastCursor) * falloffWeight(distance, size, falloff)`.

Implementation: ~80 LOC in [src/lib/sculpt/grab.js].

Reuses [src/lib/proportionalEdit.js](../../src/lib/proportionalEdit.js)'s
`computeFalloffWeight` and `buildVertexAdjacency` (for connected-only
mode).

#### 3.D — Smooth brush

Laplacian smoothing per vertex over neighbors:

```js
for (vert of affectedIndices) {
  const neighbors = adjacency.get(vert);
  const avg = neighbors.reduce((sum, n) => add(sum, verts[n]), {x:0,y:0});
  avg.x /= neighbors.length;
  avg.y /= neighbors.length;
  const w = falloffWeight(...) * strength;
  newVerts[vert] = lerp(verts[vert], avg, w);
}
```

Two iterations per tick gives a smoother result; one is faster. Default
1, configurable in N-panel.

#### 3.E — Pinch brush (audit-swap; v1 was Inflate)

Each affected vertex moves toward the brush center, weighted by
falloff and stroke strength. Faithful 2D port of Blender's Pinch:

```js
const center = state.cursor;
for (vert of affectedIndices) {
  const dir = subtract(center, verts[vert]);
  const dist = length(dir);
  if (dist < EPS) continue;  // already at center
  const w = falloffWeight(dist, state.size, state.falloff) * state.strength;
  // Push toward center; magnitude proportional to falloff+strength.
  newVerts[vert] = add(verts[vert], scale(normalize(dir), w * dist * 0.5));
}
```

Strength sign flips on Ctrl-hold (Magnify — push verts *away* from
center, the inverse of Pinch). This matches Blender's Pinch/Magnify
modal toggle.

#### 3.F — Brush settings UI (N-panel)

```
Sculpt
─────────
Brush:    [Grab ▼]
Size:     [   80   ] px       <wheel: adjust>
Strength: [  0.5   ]          <Shift+drag: adjust>
Falloff:  [Smooth ▼]
Iterations (smooth only): [ 1 ]
```

#### 3.G — Coexistence with proportional editing

Sculpt brushes always have a falloff radius; the proportional-edit
toggle is irrelevant in Sculpt Mode (because every brush already does
proportional editing). Hide the proportional-edit ModePill toggle when
`editMode === 'sculpt'`.

#### 3.H — Tests

| Test | What |
|------|------|
| `test_sculpt_grab.mjs` | Grab math under various cursor deltas + falloffs |
| `test_sculpt_smooth.mjs` | One- and two-iteration Laplacian on fixture mesh |
| `test_sculpt_inflate.mjs` | Inflate displacement direction + magnitude |
| `test_sculpt_undo.mjs` | One stroke = one undo entry |

#### 3.I — Phase exit gate

- All sculpt tests green.
- Manual: Sculpt mode entry → Grab brush drags vertices smoothly.
- Manual: Smooth brush flattens noisy regions.
- Manual: Inflate brush expands outward; Ctrl held = deflate.

**Phase 3 sum:** ~1 week. New: sculpt mode + 3 brushes + N-panel. Closes:
Top-12 #6, #7, #8.

---

### Phase 4 — Merge / Dissolve / Subdivide (1 week)

**Goal.** Three topology operations on selected vertices. All
retriangulate after; all batch-undo.

#### 4.A — Merge operator

`edit.mergeMenu` (`M` hotkey):

A modal menu pops up with options:
- **At Center** — average position of selected verts → all verts move there
- **At Cursor** — all selected verts → cursor's canvas-px
- **At Last** — all selected verts → active vertex
- **By Distance** — merge pairs within a threshold (with a popup for the
  threshold value)
- **Collapse** — merge each connected component of selection into its
  centroid

Each branch does:
1. Compute target position(s)
2. Move selected verts to target
3. Remove duplicates (verts with identical position within epsilon)
4. Update triangle indices (degenerate triangles removed)
5. Retriangulate (call existing worker path)

Implementation: [src/v3/operators/edit/merge.js].

#### 4.B — Dissolve operator

`edit.dissolveMenu` (`Ctrl+X` hotkey):

Menu options:
- **Dissolve Vertices** — remove selected verts and re-triangulate the
  hole
- **Dissolve Faces** — N/A in SS (no face selection model)

For Dissolve Vertices: **Meisters–Chazelle ear-clip** retriangulation
of the polygon formed by removing the selected vert from each adjacent
triangle (audit-fixed: standard ear-clip silently fails on non-convex
polygons; Live2D character art is routinely concave). Algorithm:

1. Build the surrounding ring as an ordered polygon
2. For each candidate ear-vertex `e_i`:
   - Test `(e_{i-1}, e_i, e_{i+1})` for **convex** (positive 2D cross
     product, given a known outward winding)
   - Test that no other polygon vertex lies **inside** that triangle
     (Meisters–Chazelle's correctness condition)
3. Cut the ear, advance, repeat
4. Final polygon is degenerate (3 verts) → emit one triangle

Implementation: [src/v3/operators/edit/dissolve.js]. Tests cover
convex (happy path) and concave (star-shaped ring) fixtures.

#### 4.C — Subdivide operator

`edit.subdivide` (right-click → Subdivide menu, no default hotkey):

Insert midpoints on all edges of selected triangles, replace each
original triangle with four new triangles. UV / weight-group / blendShape
data interpolated linearly.

For a triangle with vertices `(A, B, C)` and edges `(AB, BC, CA)`:
- New verts: `M_AB = (A+B)/2`, `M_BC = (B+C)/2`, `M_CA = (C+A)/2`
- New triangles: `(A, M_AB, M_CA)`, `(B, M_BC, M_AB)`, `(C, M_CA, M_BC)`,
  `(M_AB, M_BC, M_CA)`

If only some verts are selected, subdivide only triangles where ≥2
selected verts span an edge (matches Blender behaviour).

Modifier modal: a popup with two fields (audit-added `smoothness`):

- **Number of Cuts** (1..6, default 1) — each cut subdivides the
  *current* mesh, so 2 cuts → 4× density per selected triangle.
- **Smoothness** (0..1, default 0) — pulls new midpoint verts toward
  a Catmull-Clark smoothed position. Useful for organic shapes (faces,
  hair) — exactly the 2D rigging case. Blender's `MESH_OT_subdivide`
  ships this; v1 dropped it. ~15 LOC additional in `subdivide.js`:
  ```js
  if (smoothness > 0) {
    for (newMidpoint of newMidpoints) {
      const target = catmullClarkSmooth(newMidpoint, originalRing);
      newMidpoint = lerp(newMidpoint, target, smoothness);
    }
  }
  ```

(Blender's `subdivide` also has `fractal` + `fractal_along_normal`
options. Both are 3D-specific and not useful for 2D; keep dropped.)

Implementation: [src/v3/operators/edit/subdivide.js].

#### 4.D — Selection state through topology change

After a topology op, the vertex indices change. Each operator returns
a `vertexIndexRemap: Map<oldIndex, newIndex | null>` and the dispatcher
applies it to `editorStore.selectedVertexIndices`. Verts mapped to
`null` (deleted) are dropped from the selection; verts mapped to a new
index are kept.

#### 4.E — Tests

| Test | What |
|------|------|
| `test_merge_center.mjs` | Centroid math + dedup |
| `test_merge_byDistance.mjs` | Threshold-based dedup |
| `test_dissolve_verts_eartrip.mjs` | Ear-clip retriangulation |
| `test_subdivide_one_cut.mjs` | Single-cut topology |
| `test_subdivide_n_cuts.mjs` | Multi-cut composition |
| `test_topology_op_selection_remap.mjs` | Selection survives op |

#### 4.F — Phase exit gate

- All Phase 4 tests green.
- Manual: M-merge a stray vertex into its neighbour cluster → mesh
  cleans up, no broken triangles.
- Manual: Subdivide a face → density doubles, no holes.
- Byte-fidelity sweep on Hiyori with a topology-edited part: re-export
  cmo3 still loads in Cubism Viewer.

**Phase 4 sum:** ~1 week. New: 3 topology operators. Closes: Top-12
#9, #10, plus Dissolve.

---

### Phase 5 — Extrude (4–5 days)

**Goal.** `E`-key extrude on selected boundary verts: duplicate, link
edges to old, enter modal G.

#### 5.A — Boundary detection

A boundary edge is one referenced by exactly one triangle in the mesh.
Boundary vertex = a vertex incident on at least one boundary edge.
Selected boundary subset = boundary verts that are also selected.

**Audit-driven hardening** against degenerate seam triangles:

A triangle with zero area (three collinear or coincident verts) is
typically used in Live2D meshes as a UV / clip-mask seam separator.
Its edges are referenced by only the degenerate triangle and one
neighbour, **misclassifying as boundary** under the naive rule. Phase
5 boundary detection filters as follows:

```js
function getBoundaryVerts(mesh) {
  const edgeUseCount = new Map();
  for (const tri of mesh.triangles) {
    if (isDegenerate(tri, mesh.vertices, EPS_AREA)) continue;
    incrementEdgeUseCount(edgeUseCount, tri);
  }
  // Boundary edges = used by exactly one *non-degenerate* triangle
  const boundaryVerts = new Set();
  for (const [edge, count] of edgeUseCount) {
    if (count === 1) {
      boundaryVerts.add(edge[0]);
      boundaryVerts.add(edge[1]);
    }
  }
  return boundaryVerts;
}
```

Implementation: [src/io/meshTopology.js] gains `getBoundaryVerts(mesh)
→ Set<vertIndex>` (cached, with epsilon-area degenerate filter).
Test fixture covers a mesh with internal seam triangles.

#### 5.B — Extrude operator

`edit.extrude` (`E` hotkey):

1. Compute selected boundary verts (`B = selected ∩ boundaryVerts`)
2. For each `v ∈ B`: create a new vertex `v'` at the same position
3. For each boundary edge `(v, w)` where `v, w ∈ B`: add a quad strip
   (two triangles) `(v, w, w', v')`
4. Replace selection with the new verts (`{v' : v ∈ B}`)
5. Begin modal G transform (matches Blender)

The modal G commits the extrude on confirm; cancellation reverts the
extrude (the user can also press Esc to cancel).

#### 5.C — Edge cases

- Extrude with no boundary verts in selection → toast "Extrude needs
  selected boundary verts" and bail.
- Extrude an entire mesh's boundary → one continuous extruded ring.
- Extrude with one selected vert → degenerate case: just duplicate the
  vert, no new edges, modal G on the new vert.

#### 5.D — Tests

| Test | What |
|------|------|
| `test_extrude_singleVert.mjs` | One-vert extrude duplicates only |
| `test_extrude_boundaryRing.mjs` | Closed loop extrude |
| `test_extrude_partialBoundary.mjs` | Open path extrude |
| `test_extrude_modalCommit.mjs` | E + drag + click commits |
| `test_extrude_modalCancel.mjs` | E + drag + Esc reverts |

#### 5.E — Phase exit gate

- All extrude tests green.
- Manual: select Hiyori's hair tip, E, drag → extruded strip with new geometry.
- Byte-fidelity: re-export cmo3 still loads.

**Phase 5 sum:** ~4–5 days. New: extrude operator + boundary detection.
Closes: Top-12 #11.

---

### Phase 6 — Select Linked / Duplicate / Apply menu / Circle (1 week)

**Goal.** Cluster of small wins that share infrastructure.

#### 6.A — Select Linked (`L` / `Ctrl+L`)

Flood-fill vertex selection via the existing `buildVertexAdjacency`
([src/lib/proportionalEdit.js](../../src/lib/proportionalEdit.js)).

- `L` (cursor): hit-test for nearest vertex, flood-fill from it.
- `Ctrl+L`: flood-fill from current selection (expand each connected
  component to its full extent).

Implementation: [src/v3/operators/select/linked.js], ~50 LOC.

#### 6.B — Duplicate (`Shift+D`)

Object Mode: clone selected nodes (deep copy with new IDs), offset by
4px, immediately enter modal G translate.

Edit Mode: clone selected verts (assign new indices, keep positions),
add new triangles to maintain topology where complete triangles in the
selection are duplicated, immediately enter modal G translate.

Implementation: [src/v3/operators/edit/duplicate.js], ~120 LOC.

#### 6.C — Apply menu (`Ctrl+A`)

Modal menu (Pop-up) with applicable items based on selection:
- **Apply Pose As Rest** — existing `applyPoseAsRest` (already in
  projectStore.js); make it Operator-level + bind here
- **Apply Modifier** — submenu listing each modifier on the active
  object; calls `applyArmatureModifier` etc.

(Audit simplification: v1 also listed *Apply Visual Transform*. SS
has no parent-transform stack for non-bone nodes — `node.transform` IS
the visual transform — so there is no "visual" vs "local" split to
collapse. Speccing it would be Rule №2 baggage. Deferred until a real
parent-transform stack is in scope.)

Implementation: [src/v3/operators/apply/menu.js] + register existing
operators with proper IDs.

#### 6.D — Circle Select (`C`)

Cursor becomes a circle; LMB-drag (paint) toggles items under circle;
wheel adjusts radius. Modal capture.

Modes:
- LMB-drag: add to selection
- Shift+LMB-drag: subtract from selection

Implementation: [src/v3/operators/select/circle.js] + overlay,
~150 LOC.

#### 6.E — Tests

| Test | What |
|------|------|
| `test_selectLinked_cursor.mjs` | Flood-fill from nearest vertex |
| `test_selectLinked_fromSelection.mjs` | Expand connected components |
| `test_duplicate_object.mjs` | Clone IDs + offset + modal G |
| `test_duplicate_edit.mjs` | Clone verts + new triangles |
| `test_apply_menu.mjs` | Menu items dispatch to right operator |
| `test_circle_select.mjs` | Wheel radius + LMB toggle + Shift subtract |

#### 6.F — Phase exit gate

- All Phase 6 tests green.
- Manual: hover Hiyori's eye, L → eye selected. Ctrl+L expands.
- Manual: Shift+D in Object Mode → duplicates a part, drag, click.
- Manual: Ctrl+A in Pose Mode → menu shows "Apply Pose As Rest".

**Phase 6 sum:** ~1 week. New: 4 operators + circle overlay. Closes:
Top-12 #3, #12 + Duplicate + Apply menu.

---

### Phase 7 — Per-mode tool completion (1.5–2 weeks)

**Goal.** Close the per-mode coverage gap. Object Mode gets a real
toolbox. Weight Paint becomes practical for symmetric characters. Pose
Mode gets the Alt-clear ergonomics every Blender user has muscle memory
for.

The phase is split into three independent sub-phases (A / B / C) that
can be developed in parallel; the gates are scoped per-mode.

#### 7.A — Object Mode tools (4–5 days)

##### 7.A.1 — Snap menu (`Shift+S`)

A modal pop-up menu with two columns:

```
   Selection to ...           Cursor to ...
  ─────────────              ─────────────
   Cursor                     World Origin
   Cursor (Keep Offset)       Selected
   Grid                       Grid
   World Origin               Active
   Active
```

Each item is an operator (`object.snap.selectionToCursor`,
`object.snap.cursorToSelected`, etc.). The 3D cursor in SS is the
canvas-space cursor at the playhead time (a new
`editorStore.cursor: { x, y }`). Default position: canvas centre.

Implementation: [src/v3/operators/object/snap.js], ~120 LOC.
[src/v3/shell/SnapMenu.jsx] — small pop-up overlay.

##### 7.A.2 — Mirror selected (`Ctrl+M` then `X`/`Y`/`Z`)

Two-step modal: `Ctrl+M` → axis-pick mode (the user presses `X` or
`Y` to commit; `Z` is no-op in 2D, accepted gracefully). Mirror each
selected part's `transform` across the chosen axis through the median
pivot of the selection.

Edge case: `node.transform.scaleX` flips sign on X-mirror; rotation
flips sign; pose data flips sign. Mesh data is *not* mirrored — only
the part's transform. (For "mirror the actual geometry" the user
goes to Edit Mode and uses the Mirror modifier — out of scope for
this phase.)

Implementation: [src/v3/operators/object/mirror.js], ~80 LOC.

##### 7.A.3 — Parent (`Ctrl+P`)

Sets `node.parent` of every non-active selected part to the active
part's id. Validates: no cycles (active is not a descendant of any
non-active selection); same scene (always true in SS).

Pop-up confirms parent type: "Object" (default — apply parent's
transform to children at parent time) vs "Object (Without Inverse)"
(don't apply parent's inverse — child stays put).

Implementation: [src/v3/operators/object/parent.js], ~60 LOC.

##### 7.A.4 — Clear Parent (`Alt+P`)

Three options menu:
- **Clear Parent** — `node.parent = null`, child snaps to whatever
  position the math implies (which usually means it jumps; matches Blender)
- **Clear and Keep Transform** — `node.parent = null` + apply parent's
  cumulative transform to child so child stays visually in place
- **Clear Parent Inverse** — clears the inverse-stored transform but
  keeps the parent relationship (rarely useful in 2D; included for
  parity)

Implementation: [src/v3/operators/object/clearParent.js], ~70 LOC.

##### 7.A.5 — Set Origin (right-click → Set Origin)

Submenu:
- **Origin to Median** — recomputes `node.transform.pivotX/Y` to mesh
  vertex median; offsets `transform.x/y` to keep visual position
- **Origin to Cursor** — sets pivot to canvas cursor; offsets transform
- **Origin to Bounding Box Center** — pivot to mesh AABB center
- **Origin to Geometry** — for parts with weight groups, pivot to the
  weighted centroid

Implementation: [src/v3/operators/object/setOrigin.js], ~80 LOC.

##### 7.A.6 — Tests (Object Mode)

| Test | What |
|------|------|
| `test_objectMode_snapMenu.mjs` | All 9 snap targets math + cursor invariants |
| `test_objectMode_mirror.mjs` | X/Y mirror with pose + scale sign flips |
| `test_objectMode_parent.mjs` | Parent + cycle detection |
| `test_objectMode_clearParent.mjs` | Three clear modes |
| `test_objectMode_setOrigin.mjs` | All four origin modes |

#### 7.B — Weight Paint tools (4–5 days)

##### 7.B.1 — Sample Weight (`Ctrl+LMB`)

In Weight Paint Mode, `Ctrl+LMB` on a vertex picks that vertex's
weight in the active group and sets it as the brush's weight value.
The N-panel "Weight" slider updates to match. Same affordance as
Blender's eyedropper.

Implementation: extend [WeightPaintOverlay.jsx](../../src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx)
`onPointerDown` to dispatch on `event.ctrlKey`.

##### 7.B.2 — Blur brush

A new brush type in the brush dropdown. On each tick:

```js
for (vert of affectedIndices) {
  const neighbors = adjacency.get(vert);
  const avgWeight = neighbors.reduce(
    (sum, n) => sum + getWeight(n, activeGroup),
    0
  ) / neighbors.length;
  const w = falloffWeight(...) * strength;
  setWeight(vert, activeGroup, lerp(getWeight(vert), avgWeight, w));
}
```

Implementation: [src/lib/weightPaint/blur.js], ~50 LOC. Brush
selector in N-panel: `[Add ▼]` → list adds Blur.

##### 7.B.3 — Mirror Weights

Right-click context menu in Weight Paint Mode → Mirror Weights:
- Submenu: X-axis (default) / Y-axis / Z-axis (no-op in 2D)
- Optionally: by topology (mirror to mirrored-vertex by position
  match) vs by group name (e.g. `Group.L` mirrors to `Group.R`)

For position-based mirror: precompute a mirror-vertex map by finding
each vertex's mirrored position (within ε). Apply per-group:
`getWeight(v, g)` ← `getWeight(mirror(v), g)`.

Implementation: [src/v3/operators/weightPaint/mirror.js], ~120 LOC.

##### 7.B.4 — X-Axis Mirror toggle

A new toggle in the N-panel Weight Paint section. When on: a paint
stroke at vertex `v` also paints at `mirror(v)` simultaneously. The
toggle is per-Object (stored on `node.weightPaintSettings.xMirror:
boolean`).

Implementation: extend [WeightPaintOverlay.jsx](../../src/v3/editors/viewport/overlays/WeightPaintOverlay.jsx)
to compute mirrored verts during stroke and apply the same brush
weight to both.

##### 7.B.5 — Normalize All (`Ctrl+N`)

Operator: per-vertex, sum weights across all *unlocked* groups,
divide each unlocked group's weight by the sum so the new sum is 1.0.
Locked groups' weights are subtracted from the budget first.

Implementation: [src/v3/operators/weightPaint/normalize.js], ~40 LOC.

##### 7.B.6 — Tests (Weight Paint)

| Test | What |
|------|------|
| `test_weightPaint_sample.mjs` | Ctrl+LMB picks weight |
| `test_weightPaint_blur.mjs` | Blur kernel math |
| `test_weightPaint_mirror.mjs` | Mirror by position + by name |
| `test_weightPaint_xMirror.mjs` | Live X-mirror during stroke |
| `test_weightPaint_normalize.mjs` | Normalize math + lock respect |

#### 7.C — Pose Mode tools (3–4 days)

##### 7.C.1 — Clear Pose Location (`Alt+G`)

For each selected bone in Pose Mode, set `node.pose.x = 0` and
`node.pose.y = 0`. Wrap in `beginBatch` / `endBatch` so it's one
undo entry.

##### 7.C.2 — Clear Pose Rotation (`Alt+R`)

Same shape, sets `node.pose.rotation = 0`.

##### 7.C.3 — Clear Pose Scale (`Alt+S`)

Same shape, sets `node.pose.scaleX = 1`, `node.pose.scaleY = 1`.

##### 7.C.4 — Clear All Pose (`Alt+Shift+R` per Blender)

Combined Loc + Rot + Scale clear. Single operator, single batch.

##### 7.C.5 — Select Mirror (`Ctrl+Shift+M`) + Mirror Pose (`Ctrl+Shift+V`)

**Audit-driven split into two operators:**

1. **Select Mirror** (`Ctrl+Shift+M`) — extends the current bone
   selection to include the mirror partner of each selected bone (per
   Blender `pose.select_mirror`). v1's plan put pose-mirroring on
   this chord, which collides with Blender muscle memory.

2. **Mirror Pose** (`Ctrl+Shift+V`) — pastes a previously-copied
   pose flipped across X (per Blender `pose.paste(flipped=true)`).
   Requires a copied pose (use Ctrl+C first); pastes to selected
   bones with mirror-role partner detection.

Mirror operation (used by both operators when finding partners):

- `pose.x` → `-pose.x` (X-axis mirror)
- `pose.rotation` → `-pose.rotation`
- `pose.scaleX` / `pose.scaleY` unchanged

**Naming convention** (audit-narrowed): detect **`left*` / `right*`
camelCase prefix only** (matches 100% of current SS auto-rig roles
per [armatureOrganizer.js](../../src/io/armatureOrganizer.js):
`leftElbow`, `rightElbow`, `leftArm`, `rightArm`, `leftLeg`,
`rightLeg`, `leftKnee`, `rightKnee`).

If no mirror exists, skip with a toast `"<role> has no mirror
partner"`. Suffix-based `*.L` / `*.R` is **not implemented** in this
phase — it can be added by a follow-up plan with a real spec.

##### 7.C.6 — Copy / Paste Pose (`Ctrl+C` / `Ctrl+V` in Pose Mode)

Copy: snapshot the pose data of all selected bones into a
`poseClipboardStore` (a new tiny store). Paste: for each bone in
the clipboard, find a bone in the current selection with matching
`boneRole` and apply the pose. Bones in the clipboard with no match
in the selection are skipped (toast "No matching bone for
<sourceRole>").

Foundation for a future Pose Library — once we have copy/paste, a
named pose library is just persisted clipboard entries.

##### 7.C.7 — Tests (Pose Mode)

| Test | What |
|------|------|
| `test_poseMode_clearLoc.mjs` | Alt+G clears pose.x/y |
| `test_poseMode_clearRot.mjs` | Alt+R clears pose.rotation |
| `test_poseMode_clearScale.mjs` | Alt+S clears pose.scaleX/Y |
| `test_poseMode_clearAll.mjs` | Combined clear |
| `test_poseMode_mirrorPose.mjs` | Mirror + role-based partner detection |
| `test_poseMode_copyPaste.mjs` | Clipboard round-trip + role mapping |

#### 7.D — Phase 7 exit gate

- All Phase 7.A/B/C tests green
- Manual: each Object-Mode tool works on Hiyori multi-part selection
- Manual: each Weight Paint tool works on a weighted Hiyori arm
- Manual: each Pose Mode tool works on Hiyori arm pose
- Memory entries for each sub-phase

**Phase 7 sum:** ~1.5–2 weeks. New: 17 operators across 3 modes + 1
new store (`poseClipboardStore`) + 1 new editorStore field
(`cursor`). Closes: per-mode coverage the user explicitly asked for.

---

## 6. Schema bumps

This plan adds **two small project-schema changes**, both for Phase 7.
**Schema numbers are placeholders (vTB+1 / vTB+2) until ship time** —
audit caught a real Rule №2 collision with the animation plan if both
plans land staged versions.

| v | Phase | What |
|---|-------|------|
| `vTB+1` | 7.A.1 | `project.cursor: { x, y }` (canvas-space 3D-cursor analog for Snap menu); default = canvas centre |
| `vTB+2` | 7.B.4 | `node.weightPaintSettings: { xMirror: boolean, ... }` per-Object weight-paint preferences |

**Resolution gate at ship time** (audit-fixed; v1 said "the plan
reviewer should pick canonical numbering" which is itself the
deferral the audit flagged):

When Phase 7.A is ready to ship, read the next-available schema number
from `projectMigrations.js` header (call it `N`), update the migration
filename to `vN_toolset_cursor.js`, and write the migration directly.
Same for Phase 7.B. **Do not pre-allocate version numbers that might
collide with sibling plans.** This is mechanical at ship time and
removes the planning-document collision entirely.

Architectural rationale: the project's mesh/topology format already
supports the output of every Phase 0–6 operator (vertices + triangles
+ UVs + weight groups + blendShapes). Phase 7's two schema additions
are for *authoring affordances* (cursor position, X-mirror toggle)
that Blender persists per-document and we should too.

All other state additions are in `editorStore` (in-memory editor
state, not persisted), `preferencesStore` (persisted to localStorage,
not project), `poseClipboardStore` (new, in-memory only), and
operator/tool-internal state.

---

## 7. Validation per phase

Every phase ships:

- **Unit tests** (per the per-phase tables above)
- **Integration test** — at least one `test_*_integration.mjs`
  exercising the full path from operator dispatch through state
  mutation to UI render
- **Byte-fidelity sweep** — covers BOTH user E2E test PSDs (Western + anime topology) plus Hiyori reference:
  - **Shelby** (`shelby_neutral_ok.psd`) → Init Rig → export → diff against `shelby.cmo3` baseline. Regression-grade.
  - **test_image4** (anime) → Init Rig → export → smoke-load in Cubism Viewer. Anime topology has historically exposed bugs Shelby's Western fixture missed (BUG-025 leg-roles fly was anime-only). No byte baseline; gated on Viewer load + visual sanity.
  - **Hiyori** moc3 byte-diff against canonical reference (no PSD source; gate on exported artefact).
  Phase 4 + 5 (topology ops) add a Shelby-with-edited-topology AND a test_image4-with-edited-topology re-export.
- **Manual verification** — at least one screenshot or short-form GIF
  in the changelog
- **Memory entry** — auto-memory file added, MEMORY.md updated

The byte-fidelity sweep gate is hard. A topology op that produces a
non-fan-triangulated mesh, or an extrude that leaves degenerate
triangles, would break the sweep — the writer asserts both. Anime-only
or Western-only regressions are explicit blockers — neither can be
silently shipped because the other topology passed.

---

## 8. Hotkey additions

### Phases 0–6 (cross-mode + Edit-heavy)

| Chord | Operator | Phase | Notes |
|-------|----------|-------|-------|
| `B` | `selection.boxSelect` | 1 | Object + Edit modes |
| `Ctrl+drag` | `selection.lassoSelect` (ADD) | 1 | Modal capture |
| `Ctrl+Shift+drag` | `selection.lassoSelect` (SUB) | 1 | Audit-added: Blender canonical SUB modifier |
| `C` | `selection.circleSelect` | 6 | Modal capture |
| `L` | `selection.linkedAtCursor` | 6 | Edit mode |
| `Ctrl+L` | `selection.linkedFromSelection` | 6 | Edit mode |
| `Shift+D` | `edit.duplicate` (Edit) / `object.duplicate` (Object) | 6 | Mode-dispatched |
| `M` | `edit.mergeMenu` | 4 | Edit mode |
| `Ctrl+X` | `edit.dissolveMenu` | 4 | Edit mode |
| `E` | `edit.extrude` | 5 | Edit mode |
| `Ctrl+A` | `apply.menu` | 6 | Mode-aware menu |
| (Mode-pill) | `mode.sculpt` | 3 | New entry in ModePill dropdown |

### Phase 7 — Object Mode

| Chord | Operator |
|-------|----------|
| `Shift+S` | `object.snap.menu` |
| `Ctrl+M` then `X`/`Y` | `object.mirror.<axis>` |
| `Ctrl+P` | `object.parent.set` |
| `Alt+P` | `object.parent.clearMenu` |
| (right-click → Set Origin) | `object.setOrigin.<mode>` |

(v1's outdated Weight Paint table replaced; see audit-fixed table
below.)

### Phase 7 — Weight Paint (audit-fixed bindings)

| Chord | Operator |
|-------|----------|
| **`Shift+X`** | `weightPaint.sample` (audit-fixed; was `Ctrl+LMB`) |
| (brush dropdown) | `weightPaint.brush.blur` |
| (right-click → Mirror) | `weightPaint.mirror.<axis>` |
| (N-panel toggle) | `weightPaint.xMirror.toggle` |
| **(menu only — no chord)** | `weightPaint.normalizeAll` (audit-fixed; was `Ctrl+N`; conflicts with Blender File New) |

### Phase 7 — Pose Mode (audit-fixed bindings)

| Chord | Operator |
|-------|----------|
| `Alt+G` | `pose.clearLocation` |
| `Alt+R` | `pose.clearRotation` |
| `Alt+S` | `pose.clearScale` |
| **`Alt+Shift+G`** | `pose.clearAllLocation` (audit-fixed: 3 separate chords, one per axis) |
| **`Alt+Shift+R`** | `pose.clearAllRotation` |
| **`Alt+Shift+S`** | `pose.clearAllScale` |
| `Ctrl+Shift+M` | `pose.selectMirror` (audit-fixed: this is Blender's chord for select-mirror, NOT pose-mirror) |
| **`Ctrl+Shift+V`** | `pose.mirrorPose` (audit-fixed: paste-flipped, Blender's actual mirror-pose chord) |
| `Ctrl+C` (in Pose) | `pose.copy` |
| `Ctrl+V` (in Pose) | `pose.paste` |

### Reserved by other plans (not bound here)

- `I` — Insert Keyframe (ANIMATION_BLENDER_PARITY_PLAN.md Phase 7)
- `K` — kept as legacy "insert all keyframes"

### Deliberately not bound (in §2.2 out-of-scope)

- `Ctrl+B` (Bevel)
- `Ctrl+R` (Loop Cut)
- Knife (would conflict with `K` legacy; defer)

---

## 9. File index

### New files

| Path | Phase | What |
|------|-------|------|
| src/v3/editors/viewport/overlays/VertexSelectionOverlay.jsx | 0 | Selected vert dots |
| src/v3/operators/select/box.js | 1 | Box select |
| src/v3/operators/select/lasso.js | 1 | Lasso select |
| src/v3/operators/select/circle.js | 6 | Circle select |
| src/v3/operators/select/linked.js | 6 | Select linked |
| src/v3/shell/BoxSelectOverlay.jsx | 1 | Modal capture overlay |
| src/v3/shell/LassoSelectOverlay.jsx | 1 | Modal capture overlay |
| src/v3/shell/CircleSelectOverlay.jsx | 6 | Modal capture overlay |
| src/lib/snap.js | 2 | Spatial hash + snap math |
| src/lib/sculpt/index.js | 3 | Brush registry |
| src/lib/sculpt/grab.js | 3 | Grab brush |
| src/lib/sculpt/smooth.js | 3 | Smooth brush |
| src/lib/sculpt/inflate.js | 3 | Inflate brush |
| src/v3/editors/viewport/overlays/SculptCursorOverlay.jsx | 3 | Cursor circle render |
| src/v3/operators/edit/merge.js | 4 | Merge operators |
| src/v3/operators/edit/dissolve.js | 4 | Dissolve operators |
| src/v3/operators/edit/subdivide.js | 4 | Subdivide |
| src/v3/operators/edit/extrude.js | 5 | Extrude |
| src/v3/operators/edit/duplicate.js | 6 | Duplicate |
| src/v3/operators/apply/menu.js | 6 | Apply menu |
| src/io/meshTopology.js | 5 | Boundary detection (and shared topology helpers) |
| src/v3/operators/object/snap.js | 7.A | Object Mode Snap menu |
| src/v3/shell/SnapMenu.jsx | 7.A | Snap menu pop-up overlay |
| src/v3/operators/object/mirror.js | 7.A | Mirror selected (Ctrl+M) |
| src/v3/operators/object/parent.js | 7.A | Parent (Ctrl+P) |
| src/v3/operators/object/clearParent.js | 7.A | Clear Parent (Alt+P) |
| src/v3/operators/object/setOrigin.js | 7.A | Set Origin submenu |
| src/lib/weightPaint/blur.js | 7.B | Blur brush |
| src/v3/operators/weightPaint/sample.js | 7.B | Ctrl+LMB sample |
| src/v3/operators/weightPaint/mirror.js | 7.B | Mirror Weights |
| src/v3/operators/weightPaint/normalize.js | 7.B | Normalize All (Ctrl+N) |
| src/lib/weightPaint/mirrorMap.js | 7.B | Position-based mirror-vertex map |
| src/v3/operators/pose/clearLocation.js | 7.C | Alt+G |
| src/v3/operators/pose/clearRotation.js | 7.C | Alt+R |
| src/v3/operators/pose/clearScale.js | 7.C | Alt+S |
| src/v3/operators/pose/clearAll.js | 7.C | Alt+Shift+R |
| src/v3/operators/pose/mirror.js | 7.C | Mirror Pose (Ctrl+Shift+M) |
| src/v3/operators/pose/copyPaste.js | 7.C | Pose copy/paste |
| src/store/poseClipboardStore.js | 7.C | Pose clipboard (in-memory) |
| src/store/migrations/v33_toolset_cursor.js | 7.A | `project.cursor` field |
| src/store/migrations/v34_toolset_xMirror.js | 7.B | `node.weightPaintSettings` |

### Modified entry-point files

| Path | Phases | Note |
|------|--------|------|
| [src/store/editorStore.js](../../src/store/editorStore.js) | 0, 3 | `selectedVertexIndices`; `editMode === 'sculpt'` defaults |
| [src/store/preferencesStore.js](../../src/store/preferencesStore.js) | 2 | `snap` block |
| [src/io/hitTest.js](../../src/io/hitTest.js) | 0 | `hitTestVertices` |
| [src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx) | 0, 1, 5 | Click semantics; modal dispatch |
| [src/v3/operators/registry.js](../../src/v3/operators/registry.js) | 0..6 | Register all new operators |
| [src/v3/keymap/default.js](../../src/v3/keymap/default.js) | 1, 4, 5, 6 | Bind new chords |
| [src/v3/shell/CanvasToolbar.jsx](../../src/v3/shell/CanvasToolbar.jsx) | 0, 3 | Vertex select tool; sculpt mode |
| [src/v3/shell/canvasToolbar/tools.js](../../src/v3/shell/canvasToolbar/tools.js) | 0, 3 | TOOLS_BY_MODE entries |
| [src/v3/shell/ToolSettingsPanel.jsx](../../src/v3/shell/ToolSettingsPanel.jsx) | 2, 3 | Snap section; sculpt brush settings |
| [src/v3/shell/ModalTransformOverlay.jsx](../../src/v3/shell/ModalTransformOverlay.jsx) | 2 | Snap dispatch |
| [src/v3/shell/ModePill.jsx](../../src/v3/shell/ModePill.jsx) | 3 | Sculpt mode entry |
| [src/lib/proportionalEdit.js](../../src/lib/proportionalEdit.js) | 3 | Refactor to share with sculpt |

---

## 10. Architecture decisions

### 10.A — Why no half-edge data structure

A half-edge / DCEL would unlock Loop Cut, Bevel, Edge Slide, Inset.
Cost: a parallel topology representation that has to stay in sync with
the triangle-index buffer through every mesh edit, plus rewrites of
the existing operators that pretend topology is "just a triangle list".

Benefit: those four tools.

We're choosing not to: the four tools are already declared out of
scope in §2.2; the Top-12 is achievable with adjacency (already
present in [proportionalEdit.js](../../src/lib/proportionalEdit.js))
plus boundary detection (one new helper).

### 10.B — Why vertex selection per-part not global

Blender's Edit Mode is per-Mesh (per-data-block). SS is per-part.
Selecting verts in mesh A should not deselect verts in mesh B; they
are separate datablocks.

Counter-argument: in SS the user might want to "edit two meshes at
once". The Object-Mode multi-selection model already supports
selecting multiple parts; multi-Object Edit Mode is a separate UX
question (Blender's `Edit > Multi-Object Edit Mode` toggle). Defer
to a follow-up.

### 10.C — Why Sculpt as a peer mode, not a brush in Edit Mode

Three reasons:
1. The mode compat table already says `MODE_SCULPT` is a peer of
   `MODE_EDIT`.
2. Sculpt brushes don't use vertex selection — they affect every vert
   under the cursor. Different mental model from "click to select".
3. T-panel and N-panel content swap cleanly between modes; a brush-
   inside-Edit-Mode would need conditional N-panel content nested
   inside the existing Edit-Mode N-panel. Cleaner as peer.

### 10.D — Why three sculpt brushes (Grab + Smooth + Inflate), not one

Each is a different shape transformation:
- **Grab** = translate within radius (proportional drag)
- **Smooth** = local average (Laplacian)
- **Inflate** = directed expansion (gradient sum)

Collapsing them is wrong because the user picks the verb based on the
intended shape change. Three is the minimum to cover translate /
smooth / expand. Pinch / Layer / Snake Hook are 2nd-tier and out of
scope.

### 10.E — Why retriangulate every topology op

The current rendering pipeline assumes a fan-triangulated mesh
(`mesh.triangles[]` is a flat index array of fan-triangulations).
Topology operators that produce non-fan results would silently break
the shader. Retriangulating after each op (via the existing worker)
keeps the invariant.

Cost: ~10ms for a 1000-vert mesh. Run async, show "Retriangulating…"
toast for >100ms.

### 10.F — Why no rebuilt topology data structure for SS

Adjacency lists (`Map<vertIndex, Set<vertIndex>>`) covers every
operator in this plan. A half-edge DCEL would buy:
- Edge traversal (`for each edge incident to vertex V`) — not used
  outside Loop Cut (out of scope).
- Face neighbour lookup (`face F has neighbour faces F1, F2, F3`) —
  not used (no face selection).
- Manifold checks — already implicit in retriangulate worker.

Conclusion: adjacency + boundary detection is sufficient.

### 10.G — Why hotkeys match Blender exactly

Muscle memory. The user is a Blender power user (per
[reference_blender_source.md](../../C:/Users/Alexgrv/.claude/projects/d--Projects-Programming-stretchystudio/memory/reference_blender_source.md));
hotkey divergence is friction. The only divergence is `K` (we keep
"Insert all keyframes"; Knife is out of scope), which is documented.

### 10.H — Why operators write through existing undoHistory

`undoHistory.beginBatch / endBatch` was shipped for Modal G/R/S +
weight-paint strokes. Reusing it for sculpt brushes + topology ops
keeps undo behaviour consistent: one stroke = one entry. No new undo
machinery; no new bugs.

---

## 11. Risk register

| # | Risk | Likelihood | Mitigation |
|---|------|-----------|-----------|
| 1 | Vertex selection model UI confuses existing brush-based-Edit users | Medium | Phase 0 keeps Brush as a tool option, not removes it. New `select` is the default but brush is one click away. Add a one-time onboarding toast on first Edit Mode entry. |
| 2 | Topology ops produce degenerate triangles → retriangulate fails | High | Every operator has a post-condition assertion (no zero-area triangles, no duplicate verts within ε). Failed assertion → revert + toast. |
| 3 | Sculpt brushes' performance with high-density meshes | Medium | Pre-compute affected indices at stroke start; rAF coalesce ticks; if profiling shows >16ms, downgrade to "every other frame" tick rate. |
| 4 | Box select on a project with hundreds of parts | Low | AABB-rect intersection is O(n); n is bounded by ~50 parts in practice. |
| 5 | Lasso self-intersection produces wrong selection | Medium | Use winding-number test (handles self-intersection correctly), not even-odd. |
| 6 | Snap-to-vertex spatial hash invalidation on topology change | Medium | The hash is built per-render (not cached); cost ~1ms for typical mesh. If profiling shows it's hot, cache + invalidate on mesh signature. |
| 7 | Apply menu binds Ctrl+A which conflicts with "Select All" muscle memory | Medium | Blender's parity: Ctrl+A is Apply (object/edit mode), A alone is Select All. SS already binds A to Select All. No conflict; document in the menu's tooltip. |
| 8 | Animation plan binds I to Insert Keyframe; existing K-key behaviour stays | Resolved | Documented in §8 of this plan and §12 of the animation plan. No conflict. |
| 9 | Extrude on a vertex with no incident boundary edges in selection | Medium | Bail with toast; covered by Phase 5.C edge case test. |
| 10 | Duplicate in Edit Mode produces orphan verts (no adjacency) | Medium | If selected triangles aren't fully cloned, the new verts are isolated. Document as expected behaviour (Blender does the same); user can add new triangles via Phase 5 extrude. |
| 11 | Sculpt mode + proportional edit toggle confusing | Low | Phase 3.G hides the proportional-edit toggle in Sculpt mode. |
| 12 | Phase 7 Mirror Pose can't find a partner because boneRoles aren't symmetric (e.g. user named bones `arm1` / `arm2`) | High | Detect by `left*` / `right*` suffix or `*.L` / `*.R` suffix (Blender naming conventions). If no match found, surface a one-time toast linking to a docs section explaining the naming convention. Don't silently fail. |
| 13 | Phase 7.B Mirror Weights position-based mirror picks the wrong vertex on near-degenerate symmetric topology | Medium | Use ε = 1px snap threshold; if multiple verts within ε, prefer the one whose mesh-distance (adjacency) is shortest. Document edge case. |
| 14 | Phase 7.A Set Origin breaks vertex weights / blendShapes that are stored in object-local frame | High | Origin operations rebase mesh data into the new frame: `vertex_new = vertex_old + (originOld - originNew)`. Test fixture covers a part with weight groups + blendShapes. Byte-fidelity sweep gates the phase. |
| 15 | Phase 7.B X-Axis Mirror toggle confuses users when their topology isn't symmetric | Medium | Surface an indicator on the toggle (green dot = symmetric topology detected; yellow dot = partial; red dot = asymmetric). Cheap to compute via the mirror-vertex-map cardinality. |
| 16 | Phase 4 topology-op snapshot-undo memory pressure on high-vertex meshes (audit-added) | High-impact / Low-likelihood | `beginBatch / endBatch` writes a full project snapshot per topology op. For a 5000-vert mesh that's ~2 MB per undo entry × 50 entries = 100 MB. Mitigation: defer to a follow-up plan that ships delta-based undo for topology ops; for now, document the memory budget and warn on Logs panel when undo stack memory exceeds 200 MB. |
| 17 | Phase 0 selection persistence cleared on active-part-switch surprises users (audit-added) | Medium | The plan §0.F clears selection on switching active part. Users with a "select-verts → switch parts to check → switch back" workflow lose selection. Mitigation: per Blender behaviour we keep this clearance; document in onboarding toast; multi-Object Edit Mode is a follow-up plan that would lift this. |
| 18 | Phase 3 Sculpt brush + Armature modifier interaction (audit-added) | Medium | Sculpt brushes write directly to rest-position verts. If the part has an active Armature modifier, sculpting rest verts while in Sculpt Mode produces a confusing mismatch (rest changed but posed position computed from the modified rest). Mitigation: detect active Armature modifier on entry to Sculpt Mode; if present, surface a one-time toast: "Sculpt edits rest position; Armature modifier output reflects the new rest". Optional advanced UX: an `editorStore.sculptOnPosed` flag that sculpts the posed verts and bakes the delta back to rest via inverse Armature transform — defer to a follow-up. |

---

## 12. Estimate (audit-revised)

| Phase | Optimistic | Realistic | Pessimistic |
|-------|-----------|-----------|-------------|
| 0 — Vertex selection foundation (incl. topology shortest-path) | 4 days | 7 days | 10 days |
| 1 — Box / Lasso select (incl. SUB modifier) | 5 days | 7 days | 10 days |
| 2 — Snap (also exposes `snapToIncrement` for animation plan) | 3 days | 4 days | 6 days |
| 3 — Sculpt mode + Grab/Smooth/**Pinch** brushes (audit-swap) | 5 days | 7 days | 10 days |
| 4 — Merge / Dissolve (Meisters–Chazelle) / Subdivide (smoothness) | 6 days | 9 days | 13 days |
| 5 — Extrude (with degenerate-seam guard) | 3 days | 5 days | 7 days |
| 6 — Linked / Duplicate / Apply / Circle | 5 days | 7 days | 10 days |
| 7 — Per-mode (Object + Weight Paint + Pose; audit-trimmed scope) | 10 days | 16 days | 22 days |
| **Total** | **41 days (~5.9 wk)** | **62 days (~8.9 wk)** | **88 days (~12.6 wk)** |

Realistic: **~9 weeks** of focused work (audit-revised upward from
v1's 7.5; the audit found Phase 7 mirror-vertex-map work
underestimated 2–3× because position-based mirror on irregular meshes
surfaces topology anomalies that need defensive handling).

**Pessimistic ~13 weeks is the number to commit to externally.**

The plan is internally sequenced so partial delivery is shippable:
stopping after Phase 1 still gets us box / lasso select on top of the
vertex selection foundation; stopping after Phase 4 gets us all the
topology ops short of extrude; stopping after Phase 6 gets the full
mesh + selection + Edit-mode toolset; Phase 7 adds the per-mode
breadth that completes Object / Weight Paint / Pose coverage.

---

## 13. Coordination with other in-flight plans

- **ANIMATION_BLENDER_PARITY_PLAN.md** (sibling plan) — keymap
  coordination per Risk #8. `I` is reserved for Insert Keyframe;
  this plan does not bind it. `B` in Graph Editor scope = box select
  keyframes (animation Phase 5); this plan binds `B` in Object/Edit
  Mode = box select objects/verts. Scope-aware keymap (already in the
  dispatcher) handles it.
- **Performance audits** — sculpt brushes and topology ops are new hot
  paths. Phase 3 + Phase 4 each include a manual perf check on a large
  Hiyori-scale mesh. Any regression > 2× in editor frame time
  blocks the phase.
- **Cubism Adapter Pattern** — none of the new operators interact with
  the export pipeline. Modifying mesh topology in SS naturally flows
  through the existing exporter.

---

## 14. Phase exit checklists (running)

```
Phase 0:
  [ ] editorStore.selectedVertexIndices + actions shipped
  [ ] hitTestVertices in hitTest.js
  [ ] LMB / Shift+LMB / A semantics in CanvasViewport
  [ ] VertexSelectionOverlay renders
  [ ] T-panel `Select` tool entry
  [ ] All vertex-selection tests green
  [ ] Manual: click-toggle-A on Hiyori works as expected
  [ ] Memory entry: 'Vertex selection model'

Phase 1:
  [ ] Box select operator + overlay
  [ ] Lasso select operator + overlay
  [ ] B / Ctrl+drag bound
  [ ] All select tests green
  [ ] Manual: B-drag selects parts in Object Mode and verts in Edit Mode
  [ ] Memory entry: 'Box / Lasso select'

Phase 2:
  [x] preferencesStore.snap shipped
  [x] snap.js + spatial hash (lib/snap/{snapMath,snapHash,index}.js)
  [x] ModalTransformOverlay consults snap state (G/R/S all wired)
  [x] N-panel snap section (visible all modes)
  [x] All snap tests green (80 assertions across 4 suites)
  [ ] Manual: G + Shift snaps to grid; near vertex snaps to vert
  [ ] Memory entry: 'Snap during transform'

Phase 3:
  [ ] sculpt mode entry in ModePill
  [ ] T-panel sculpt tools
  [ ] N-panel brush settings
  [ ] Grab / Smooth / Inflate brushes shipped
  [ ] All sculpt tests green
  [ ] Manual: each brush behaves as expected on Hiyori
  [ ] Memory entry: 'Sculpt mode + 3 brushes'

Phase 4:
  [ ] Merge operator + M-menu
  [ ] Dissolve operator + Ctrl+X menu
  [ ] Subdivide operator + right-click menu
  [ ] Vertex index remap on topology change
  [ ] All Phase 4 tests green
  [ ] Manual: each op + retriangulate works on Hiyori
  [ ] Byte-fidelity: edited Hiyori cmo3 still loads in Cubism Viewer
  [ ] Memory entry: 'Merge / Dissolve / Subdivide'

Phase 5:
  [ ] Boundary detection helper
  [ ] Extrude operator (E)
  [ ] All extrude tests green
  [ ] Manual: extrude Hiyori hair tip works
  [ ] Byte-fidelity: extruded Hiyori cmo3 still loads
  [ ] Memory entry: 'Extrude'

Phase 6:
  [ ] Select Linked (L / Ctrl+L)
  [ ] Duplicate (Shift+D)
  [ ] Apply menu (Ctrl+A)
  [ ] Circle select (C)
  [ ] All Phase 6 tests green
  [ ] Manual: each op works on Hiyori
  [ ] Memory entry: 'Select Linked / Duplicate / Apply / Circle'

Phase 7.A — Object Mode:
  [ ] project.cursor schema bump + migration
  [ ] Snap menu (Shift+S) with all 9 targets
  [ ] Mirror selected (Ctrl+M, X/Y axis)
  [ ] Parent (Ctrl+P)
  [ ] Clear Parent (Alt+P) — three modes
  [ ] Set Origin submenu — four modes
  [ ] All Phase 7.A tests green
  [ ] Memory entry: 'Object Mode toolbox'

Phase 7.B — Weight Paint:
  [ ] node.weightPaintSettings schema bump + migration
  [ ] Sample Weight (Ctrl+LMB)
  [ ] Blur brush
  [ ] Mirror Weights (right-click → Mirror, X/Y/by-name)
  [ ] X-Axis Mirror live toggle (N-panel)
  [ ] Normalize All (Ctrl+N)
  [ ] All Phase 7.B tests green
  [ ] Memory entry: 'Weight Paint completion'

Phase 7.C — Pose Mode:
  [ ] Clear Pose Loc/Rot/Scale (Alt+G/R/S)
  [ ] Clear All Pose (Alt+Shift+R)
  [ ] Mirror Pose (Ctrl+Shift+M) with role-based partner detection
  [ ] poseClipboardStore + Copy/Paste Pose (Ctrl+C/V in Pose Mode)
  [ ] All Phase 7.C tests green
  [ ] Memory entry: 'Pose Mode toolbox'
```

---

## 15. Quick-reference: what closes what

### Top-12 from the audit (Phases 0–6)

| # | Tool | Phase |
|---|------|-------|
| 1 | Vertex selection model (foundation) | Phase 0 |
| 2 | Box Select | Phase 1 |
| 3 | Circle Select | Phase 6 |
| 4 | Lasso Select | Phase 1 |
| 5 | Snap to grid / vertex | Phase 2 |
| 6 | Sculpt Grab | Phase 3 |
| 7 | Sculpt Smooth | Phase 3 |
| 8 | Sculpt Inflate | Phase 3 |
| 9 | Merge | Phase 4 |
| 10 | Subdivide | Phase 4 |
| 11 | Extrude | Phase 5 |
| 12 | Select Linked | Phase 6 |

Bonus closures (small wins along the way):

| Tool | Phase |
|------|-------|
| Dissolve verts | Phase 4 |
| Duplicate (Object + Edit) | Phase 6 |
| Apply menu (Ctrl+A) | Phase 6 |

### Per-mode coverage (Phase 7)

| Mode | Tool | Sub-phase |
|------|------|-----------|
| Object | Snap menu (Shift+S) | 7.A.1 |
| Object | Mirror (Ctrl+M) | 7.A.2 |
| Object | Parent (Ctrl+P) | 7.A.3 |
| Object | Clear Parent (Alt+P) | 7.A.4 |
| Object | Set Origin submenu | 7.A.5 |
| Weight Paint | Sample Weight (Ctrl+LMB) | 7.B.1 |
| Weight Paint | Blur brush | 7.B.2 |
| Weight Paint | Mirror Weights | 7.B.3 |
| Weight Paint | X-Axis Mirror live toggle | 7.B.4 |
| Weight Paint | Normalize All (Ctrl+N) | 7.B.5 |
| Pose | Clear Pose Loc/Rot/Scale (Alt+G/R/S) | 7.C.1–3 |
| Pose | Clear All Pose (Alt+Shift+R) | 7.C.4 |
| Pose | Mirror Pose (Ctrl+Shift+M) | 7.C.5 |
| Pose | Copy/Paste Pose (Ctrl+C/V) | 7.C.6 |

---

End of plan. Ready for two-agent audit.
