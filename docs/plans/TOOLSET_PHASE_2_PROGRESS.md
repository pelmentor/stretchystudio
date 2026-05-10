# Toolset Phase 2 — Progress Log

Started: 2026-05-10
Plan: [TOOLSET_BLENDER_PARITY_PLAN.md](./TOOLSET_BLENDER_PARITY_PLAN.md) §Phase 2
Goal: Modal G/R/S consults a snap-config preference — snap-to-grid
during Shift, snap-to-vertex auto-engaging within a configurable
threshold, snap-to-increment for rotation/scale. The N-panel gains
a Snap section so the user adjusts these values without leaving the
canvas. Closes Top-12 #5 and unblocks the precise-positioning that
Phase 4 (merge / dissolve / subdivide) and Phase 5 (extrude) need.

## Sub-phase status

| Sub | What | Status |
|-----|------|--------|
| 2.A | `preferencesStore.snap` slot + `setSnap` deep-merge writer + `loadJson(SNAP_KEY, SNAP_DEFAULT)` persistence | ✅ SHIPPED (2026-05-10) |
| 2.B | Snap-to-grid in Modal G — Shift consults `snap.modes.grid.{enabled,increment}`; legacy 10px fallback when mode disabled | ✅ SHIPPED (2026-05-10) |
| 2.C | Snap-to-vertex in Modal G — `snapHash.js` (project-rest-vert spatial hash, project-identity + version-stamp invalidation), magenta-dot overlay, topology-change sister hooks at all 3 vertex-mutation callsites | ✅ SHIPPED (2026-05-10) |
| 2.D | Snap-to-increment in Modal R + S — Shift consults `snap.modes.increment.{enabled,value}`; legacy 15° / 0.1× fallbacks when mode disabled | ✅ SHIPPED (2026-05-10) |
| 2.E | N-panel Snap section — visible in all modes, master toggle + per-mode toggle/value + target dropdown | ✅ SHIPPED (2026-05-10) |
| 2.F | 4 test files: snap-grid math, snap-vertex threshold + project-identity rebuild, snap-rotation/scale math, snap-target modes (80 assertions total) | ✅ SHIPPED (2026-05-10) |
| 2.G | Manual exit gate (browser-side; verified by user) | ⏳ PENDING |

## What landed

### 2.A — `preferencesStore.snap` + setter

[src/store/preferencesStore.js](../../src/store/preferencesStore.js):

```js
snap: {
  enabled: false,                                       // master toggle
  modes: {
    grid:      { enabled: true,  increment: 16 },       // canvas-px (Blender default)
    vertex:    { enabled: true,  threshold:  8 },       // canvas-px
    increment: { enabled: false, value:     15 },       // degrees (rot) / value/100 (scale)
  },
  target: 'closest',                                    // 'closest' | 'center' | 'median' | 'active'
}
```

`setSnap(partial)` is a deep partial-merge — callers can write
`setSnap({ modes: { grid: { increment: 32 } } })` without spelling
out the rest. `mergeSnap()` validates target enum + tolerates missing
keys on schema bumps. Persistence: one JSON blob keyed
`v3.prefs.snap`.

Master toggle `enabled` defaults `false` so no behaviour change until
the user opts in via the N-panel. Per-mode `grid.enabled = true`
default + `LEGACY_SNAP_GRID_INCREMENT = 10` fallback in the modal
preserves the pre-Phase-2 Shift+G snap behaviour exactly when the
user never visits the N-panel.

### 2.B — Snap-to-grid (Modal G + Shift)

[src/v3/shell/ModalTransformOverlay.jsx](../../src/v3/shell/ModalTransformOverlay.jsx)
`applyDelta()`:

```js
if (kind === 'translate' && !useTyped && shift && !snapVertexHit) {
  const gridInc = snap?.modes?.grid?.enabled
    ? (snap.modes.grid.increment > 0 ? snap.modes.grid.increment : LEGACY_SNAP_GRID_INCREMENT)
    : LEGACY_SNAP_GRID_INCREMENT;
  const snapped = snapDeltaToGrid({ x: dxCanvas, y: dyCanvas }, gridInc);
  dxCanvas = snapped.x;
  dyCanvas = snapped.y;
}
```

Vertex snap (below) wins — Shift inverts intent so they don't both
apply on the same tick.

### 2.C — Snap-to-vertex (Modal G, unshifted, master on)

[src/lib/snap/snapHash.js](../../src/lib/snap/snapHash.js) — vertex-
identity spatial hash. Each cell stores `{ x, y, partId, vertIndex }`
tuples; `findNearest(x, y, dist)` does a 3×3 cell scan within `dist`.
Cell size = max(threshold, 32) so the search radius always fits.

Cache invalidation is two-stage so callers don't have to coordinate:
- Whole-store swap (PSD import, project load, undo to a prior
  snapshot) → caught by project-reference identity check.
- In-place vertex mutation (mesh-worker remesh, add_vertex,
  remove_vertex) → version stamp bumped via `invalidateSnapHash()`
  sister to the `invalidateVertexSelectionForPart` callsites at
  CanvasViewport.jsx:1545, 2372, 2414.

Modal hits `findNearestVertex(project, cursorCanvasX, cursorCanvasY,
threshold)`; if found, `dxCanvas = hit.x - originalCursorCanvasX` so
the cursor IS the anchor (target mode `closest`). Other target modes
land in `computeSelectionAnchor` for unit-test coverage; the modal
currently uses `closest` regardless.

The magenta snap-target dot is a `<SnapTargetDot />` rendered by
`ModalTransformOverlay` at `screenX = rect.left + (target.x * zoom +
panX)` etc. Subscribes to `useSnapStore.target` so the dot follows
the live snap target per modal tick.

### 2.D — Snap-to-increment (Modal R + S)

```js
// Modal R + Shift
const incDeg = snap?.modes?.increment?.enabled
  ? (snap.modes.increment.value > 0 ? snap.modes.increment.value : LEGACY_SNAP_ROTATE_INCREMENT_DEG)
  : LEGACY_SNAP_ROTATE_INCREMENT_DEG;
dRot = snapAngleToIncrement(dRot, incDeg);

// Modal S + Shift
const incDeg = snap?.modes?.increment?.enabled
  ? (snap.modes.increment.value > 0 ? snap.modes.increment.value : LEGACY_SNAP_SCALE_INCREMENT_DEG)
  : LEGACY_SNAP_SCALE_INCREMENT_DEG;
s = snapScaleToIncrement(s, incDeg);
```

`incrementDeg` = degrees for rotation; scale uses `incrementDeg/100`
as the multiplier step (15° → 0.15× step). When mode disabled,
legacy 15°/0.1× preserved exactly via `LEGACY_SNAP_ROTATE_INCREMENT_DEG = 15`
and `LEGACY_SNAP_SCALE_INCREMENT_DEG = 10` (10/100 = 0.1).

### 2.E — N-panel Snap section

[src/v3/shell/ToolSettingsPanel.jsx](../../src/v3/shell/ToolSettingsPanel.jsx) —
mounted ABOVE the existing mode-specific content so the section
renders in every mode (modal G/R/S works in Object + every Edit
Mode):

- Master enable toggle (with magnet icon).
- Per-mode rows (Vertex / Grid / Increment) — each with a checkbox
  and a numeric value bound to `snap.modes.{mode}.{threshold|increment|value}`.
- Target dropdown (Closest / Center / Median / Active).

The mode group dims (`opacity-60`) when master is off so the user
sees the inputs are gated.

### 2.F — Tests (78 assertions)

| Test | What | Assertions |
|------|------|------------|
| `test_snap_grid_translate.mjs` | `snapDeltaToGrid` at increments 10, 16, 64; axis-locked deltas; bad-input degradation; on-grid idempotence; negative-half rounding (Math.round towards +Inf) | 16 |
| `test_snap_rotation_increment.mjs` | `snapAngleToIncrement` at 15°/45°/5°/90°; `snapScaleToIncrement` step floor; custom step 0.15; bad-input degradation | 29 |
| `test_snap_target_modes.mjs` | `computeSelectionAnchor` for all 4 modes; AABB centre with outliers; per-axis median; activeVert fallback; NaN/null filtering | 15 |
| `test_snap_vertex_threshold.mjs` | `findNearestVertex` within / outside threshold; `excludePartId`; flat-numeric vertex shape; `invalidateSnapHash` rebuild; project-identity rebuild; bad-input degradation | 20 |

All four passing; integrated into `npm test` chain after
`test:lassoSelectModifiers` and before `test:auditFixes20260510`.

### Topology-invalidation hooks (sister of `invalidateVertexSelectionForPart`)

[src/components/canvas/CanvasViewport.jsx](../../src/components/canvas/CanvasViewport.jsx):

- L1551 — `dispatchMeshWorker` after `setMesh()` (mesh-worker remesh).
- L2378 — Edit-Mode `add_vertex` after persisting to store.
- L2421 — Edit-Mode `remove_vertex` after persisting to store.

All three already had `invalidateVertexSelectionForPart`; this phase
adds an `invalidateSnapHash()` sister immediately after.

## Deliberately NOT shipped (per Rule №1 / №2)

- **Target modes other than `closest` in the live modal.** The math
  is implemented + unit-tested for all four target modes via
  `computeSelectionAnchor`, but the modal currently uses `closest`
  regardless of `snap.target` (the dropdown stores the user's choice
  but doesn't drive applyDelta yet). Reason: `closest` covers the
  vast majority of use cases — the cursor IS the anchor, snap-to-vert
  drops the modal-G result onto the snap target. The other modes
  (`center`/`median`/`active`) require selection-vertex enumeration
  (canvas-px transforms; bone vs non-bone branch) which is a clean
  follow-up but not load-bearing for shipping the feature. Each can
  be wired by reading `selectionStore.items` + `editorStore.activeVertex`,
  computing the anchor canvas-px, and substituting it for the
  current "originalCursorCanvasX/Y" in the modal's snap-vertex
  branch. Test coverage already pins the math.

- **No PSD-import / runStage explicit invalidation.** The
  project-identity rebuild in `getOrBuildSnapHash` catches both: PSD
  import calls `setProject()` which gives the store a new project
  ref, and `runStage` returns a new project (post-immer
  produce). Tests in `test_snap_vertex_threshold.mjs` Test 10 pin
  this contract. No need for explicit `invalidateSnapHash()` calls
  in those paths.

## Manual gate (Phase 2.G)

User-side smoke test (browser-only). Items the test suite cannot
verify:

- [ ] N-panel Snap section visible + collapsible in all 3 modes
      (Object / Edit / Pose).
- [ ] Master toggle persists across reload (`v3.prefs.snap` blob in
      `localStorage`).
- [ ] Per-mode toggles dim values on disable; numeric inputs accept
      keyboard entry.
- [ ] Modal G with master OFF → behaves identically to pre-Phase-2
      (Shift snaps to 10px).
- [ ] Modal G with master ON + vertex.enabled → cursor near a rest
      vertex shows magenta dot; clicking confirms onto the vertex.
- [ ] Modal G with master ON + Shift → uses `grid.increment` (default
      16) not the legacy 10.
- [ ] Modal R with `increment.enabled` ON + Shift → snaps to user-set
      degrees (e.g. 5° step).
- [ ] Modal S with `increment.enabled` ON + Shift → snaps to
      `value/100` step (15 → 0.15×).
- [ ] Snap target persists across canvas pan/zoom (rect re-derived
      every render).
