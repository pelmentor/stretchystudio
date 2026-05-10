# Toolset Phase 2 — Progress Log

Started: 2026-05-10
Plan: [TOOLSET_BLENDER_PARITY_PLAN.md](./TOOLSET_BLENDER_PARITY_PLAN.md) §Phase 2
Goal: Modal G/R/S consults a Blender-faithful snap system. Master
"magnet" toggle + per-mode (vertex / grid / increment) + Shift =
MOD_PRECISION + Ctrl = MOD_SNAP_INV, all matching the gesture
vocabulary in `reference/blender/source/blender/editors/transform/transform_snap*.{c,cc}`.
The N-panel gains a Snap section so users adjust these without
leaving the canvas. Closes Top-12 #5.

## Sub-phase status

| Sub | What | Status |
|-----|------|--------|
| 2.A | `preferencesStore.snap` slot + `setSnap` deep-merge writer + JSON persistence; precision sub-fields per mode | ✅ SHIPPED (audit-revised 2026-05-10) |
| 2.B | Snap-to-grid in Modal G — auto-engages when master ON + grid.enabled; Shift selects precision; without master, Shift = pure MOD_PRECISION on free transform | ✅ SHIPPED (audit-revised 2026-05-10) |
| 2.C | Snap-to-vertex via `buildSnapHash` (no module-level cache; per-modal-mount build); `pickSelectionAnchor` + `enumerateSelectionAnchorVerts` for Blender-faithful Closest target; magenta dot overlay; Pose Mode override via `frames` | ✅ SHIPPED (audit-revised 2026-05-10) |
| 2.D | Snap-to-increment in Modal R + S — auto-engages when master + increment.enabled; Shift selects precision; without master, Shift = MOD_PRECISION; rotate default 5° / 1° matches Blender | ✅ SHIPPED (audit-revised 2026-05-10) |
| 2.E | N-panel Snap section — visible all modes; Increment row labels both rotation step and derived scale step (audit fix G-8) | ✅ SHIPPED (audit-revised 2026-05-10) |
| 2.F | 5 test files, 133 assertions: snap-grid math, snap-vertex threshold, snap-rotation/scale + precision helpers, snap-target modes, **gesture model integration** | ✅ SHIPPED (audit-revised 2026-05-10) |
| 2.G | Manual exit gate (browser-side; verified by user) | ⏳ PENDING |

## Audit-driven fixes (2026-05-10)

Two independent agents audited the initial Phase 2 ship (commit
`5b81205`) and surfaced 11 + 9 = 20 gaps. The HIGH-severity items have
all been addressed in this audit-fix sweep.

**Architecture audit (`AUDIT_2026_05_10_TOOLSET_PHASE2_ARCH.md`):**

- **G-1 (HIGH crash)** — Modal crashed on first mousemove with
  `TypeError: cannot read 'zoom' of undefined`. The `view` slot was
  renamed to `viewByMode.viewport` in commit `86b2e43` (year-old
  rework); modal G/R/S have been silently broken ever since BVR-005,
  Phase 2 just expanded the surface (also reading `view.panX/Y`).
  Fixed by switching all 2 callsites to `useEditorStore.getState().viewByMode?.viewport ?? {…}`.
- **G-2 (HIGH)** — Snap-to-vertex didn't exclude the dragged part's
  own verts in Object Mode → modal "stuck" at start. Fixed by passing
  `excludePartId` to `buildSnapHash` when there's exactly one node
  selected and we're not in Edit Mode (Edit Mode's snap-within-active-
  part is a feature).
- **G-3 + G-4 (MED)** — Apply Pose As Rest + Reset Pose mutated
  `v.x/v.y` without invalidating the snap-hash cache. **Mooted by the
  no-cache redesign** below.
- **G-6 (MED)** — Cleanup return didn't `clearSnapTarget()`; magenta
  dot persisted across abnormal exits. Fixed.
- **G-8 (MED)** — N-panel Increment row's `°` label hid the
  `value/100 ×` scale binding. Fixed by replacing single-unit row with
  dual-label `°R · ×0.05S`.

**Blender-fidelity audit (`AUDIT_2026_05_10_TOOLSET_PHASE2_BLENDER.md`):**

- **D-1 (HIGH)** — Shift was wired as snap-engagement modifier; Blender
  binds `LEFT_SHIFT → MOD_PRECISION` (`blender_default.py:6184-85`),
  `LEFT_CTRL → SNAP_INV_ON` (`:6154-56`). The pre-Phase-2 SS hardcode
  of "Shift snaps to 10px" was an SS reinvention.
- **D-2 (HIGH)** — Master OFF + Shift still grid-snapped via the
  legacy fallback path. Master only gated vertex snap.
- **D-3 (HIGH)** — `'closest'` target was implemented backwards. SS
  treated it as "the cursor IS the anchor"; Blender's
  `SCE_SNAP_SOURCE_CLOSEST` (`transform_snap.cc:1481-1588`) finds the
  selection vertex / bbox corner geometrically NEAREST the snap
  target, then translates so that anchor lands ON the target.
- **D-4 (HIGH)** — Snap-to-vertex hash was built over rest verts; in
  Pose Mode the user sees the deformed mesh, so the magenta dot
  appeared 50+ px away from where the visible vertex actually sat.
- **D-5 (HIGH)** — Default rotation increment 15° vs Blender's 5°
  (`DNA_scene_types.h:2430` — `snap_angle_increment_2d = DEG2RADF(5.0f)`).
  Fixed.
- **D-6 (MED) + plan-doc claims** — "16 px = Blender default" /
  "Blender's 1° = 0.01× scale convention" etc. were doc-text
  fabrications. Scrubbed.
- **D-7 (MED)** — Snap modes didn't co-exist (vertex was Shift-gated
  exclusive of grid). Fixed via gesture redesign — both modes coexist;
  vertex within threshold wins per tick.

## What landed (audit-revised architecture)

### Schema (preferencesStore.snap)

```js
snap: {
  enabled: false,                                  // master "magnet"
  modes: {
    grid:      { enabled: true,  increment: 16, precision: 1.6 },
    vertex:    { enabled: true,  threshold:   8 },
    increment: { enabled: false, value:       5, precision:   1 },
  },
  target: 'closest',
}
```

`setSnap(partial)` is a deep-merge writer; `mergeSnap()` validates +
preserves nested keys on schema bumps. The `precision` sub-fields are
new in this audit-fix sweep (Blender's `_precision = 1°` for rotate,
1.6 for grid = `increment / 10`).

### Gesture model (Blender-faithful)

[ModalTransformOverlay.jsx](../../src/v3/shell/ModalTransformOverlay.jsx)
`applyDelta(currentX, currentY, shift, ctrl)`:

```js
const masterOn = !!snap?.enabled;
const effSnap = ctrl ? !masterOn : masterOn;   // MOD_SNAP_INV
```

- **Master ON, no Ctrl** → snap engages (priority: vertex > grid).
- **Master ON + Ctrl** → SNAP_INV cancels snap; Shift = precision.
- **Master OFF, no Ctrl** → free transform; Shift = precision.
- **Master OFF + Ctrl** → SNAP_INV engages snap.
- **Shift** = MOD_PRECISION in all states. With snap, selects per-mode
  `precision` slot. Without snap, multiplies free-transform delta by
  0.1 (translate), 0.1 (rotate), or relative-to-1 0.1 (scale).

`onKeyDown` / `onKeyUp` re-fire `applyDelta` on Ctrl + Shift change so
the modal updates without waiting for a mousemove (matches Blender).

### Snap hash (no cache)

[snapHash.js](../../src/lib/snap/snapHash.js) — module-level cache
DROPPED. The audit's MED gaps (G-3, G-4 missing `invalidateSnapHash`
at `applyPoseAsRest` + `resetToRestPose`) become moot when the hash
is built fresh per modal session (~1 ms per ~5000 verts; negligible
vs. the maintenance burden of 5+ invalidation hooks scattered across
the codebase).

```js
buildSnapHash(project, {
  cellSize: 64,
  frames,                  // Pose Mode override → post-skinning verts
  excludePartId,           // Object Mode → skip dragged part
}) → VertexSnapHash;
```

Pose Mode hash routes through `getCanvasHitContext().frames` which
holds the live `chainEval`/depgraph result (`finalVerts` per partId).
The magenta dot tracks the visible deformed mesh.

### Closest target (Blender-faithful)

[snapMath.js](../../src/lib/snap/snapMath.js) `pickSelectionAnchor` +
`enumerateSelectionAnchorVerts`:

- Object Mode meshed part → centroid + 4 bbox corners (5 anchor
  candidates per part).
- Object Mode bone group → bone pivot.
- Object Mode part w/ `imageBounds` only → 4 corners + centroid.
- Edit Mode → selected verts of active part, active first.

`pickSelectionAnchor(anchors, target, { snapTarget, cursor })` matches
Blender's `snap_source_closest_fn`: `target='closest'` finds the
geometrically nearest member of `anchors` to `snapTarget`.

The legacy `computeSelectionAnchor` is kept as a deprecated passthrough
for one release.

### Modal-side snap orchestration

```js
useEffect(() => {
  // Build snap context once at modal mount.
  snapHashRef.current = buildSnapHash(project, {
    cellSize: 64, frames, excludePartId,
  });
  anchorVertsRef.current = enumerateSelectionAnchorVerts(project, selection, editor);
  …
});

function applyDelta(currentX, currentY, shift, ctrl) {
  const effSnap = ctrl ? !masterOn : masterOn;
  if (effSnap && snap.modes.vertex.enabled) {
    const hit = snapHash.findNearest(cursorX, cursorY, threshold);
    if (hit) {
      const anchor = pickSelectionAnchor(anchorVerts, snap.target, { snapTarget: hit });
      dx = hit.x - anchor.x;  dy = hit.y - anchor.y;
    }
  }
  if (effSnap && noVertexHit && snap.modes.grid.enabled) {
    const inc = shift ? grid.precision : grid.increment;
    ({x: dx, y: dy} = snapDeltaToGrid({x: dx, y: dy}, inc));
  }
  if (!effSnap && shift) {  // free MOD_PRECISION
    ({x: dx, y: dy} = applyPrecisionToDelta({x: dx, y: dy}, 0.1));
  }
  …
}
```

### N-panel UI

[ToolSettingsPanel.jsx](../../src/v3/shell/ToolSettingsPanel.jsx) —
`<SnapSection />` mounted ABOVE mode-specific content. Master toggle
gates the system (UI dim when off). 3 mode rows:
- `Vertex` — checkbox + threshold input
- `Grid` — checkbox + increment input
- `Increment` — checkbox + value input + `°R · ×0.05S` dual label
  (audit fix G-8 — surface both rotation step and derived scale step)
- Target dropdown (Closest / Center / Median / Active)

### Tests (133 assertions)

| Test | What | Assertions |
|------|------|------------|
| `test_snap_grid_translate.mjs` | `snapDeltaToGrid` math at increments 10/16/64; axis-locked; bad-input degradation | 16 |
| `test_snap_rotation_increment.mjs` | `snapAngleToIncrement` + `snapScaleToIncrement` + 3 precision helpers (`applyPrecisionTo{Delta,Angle,Scale}`) | 44 |
| `test_snap_target_modes.mjs` | `pickSelectionAnchor` (Blender-faithful semantics) + `enumerateSelectionAnchorVerts` (Object/Edit/bone) + legacy `computeSelectionAnchor` | 32 |
| `test_snap_vertex_threshold.mjs` | `findNearestVertex` + `excludePartId` + `frames` Pose-Mode override + post-mutation rebuild contract | 23 |
| `test_snap_gesture_model.mjs` | Master/Shift/Ctrl combinations across translate/rotate/scale; SNAP_INV; MOD_PRECISION engagement matrix | 18 |

All five suites passing; `npm test` chain wired.

## Manual gate (Phase 2.G)

User-side smoke test (browser-only). Items the test suite cannot
verify:

- [ ] N-panel Snap section visible + collapsible in all 3 modes
      (Object / Edit / Pose).
- [ ] Master toggle persists across reload (`v3.prefs.snap` blob in
      `localStorage`).
- [ ] Per-mode toggles dim values on disable; numeric inputs accept
      keyboard entry.
- [ ] Modal G with master OFF → free transform; Shift = 10× finer
      input (precision).
- [ ] Modal G with master ON → snap fires when cursor near vertex;
      magenta dot lands on the project vert; selection's nearest
      anchor (per `target` mode) lands on the dot.
- [ ] Ctrl held mid-drag → snap state flips immediately (master ON →
      OFF, master OFF → ON). Re-fired without waiting for mousemove.
- [ ] Modal R with master ON + increment.enabled → 5° step; Shift =
      1° precision step.
- [ ] Modal S with master ON + increment.enabled → 0.05× step; Shift
      = 0.01× precision step.
- [ ] Modal G in Pose Mode with master ON → magenta dot tracks
      visible deformed mesh, NOT rest geometry.
