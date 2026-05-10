# Toolset Phase 3 — Sculpt Mode + brushes (shipped 2026-05-10)

Plan reference: [TOOLSET_BLENDER_PARITY_PLAN.md §Phase 3](./TOOLSET_BLENDER_PARITY_PLAN.md#phase-3--sculpt-mode--brushes-1-week).

## What shipped

A new `editorStore.editMode = 'sculpt'` with three Blender-faithful
sculpt brushes — Grab / Smooth / Pinch (+ Magnify on Ctrl) — all
operating on the same mesh data the Edit-Mode brush already touches,
but with cursor-centered falloff (vs Edit-Mode brush's anchor-from-
picked-vertex). Strokes collapse to one undo entry per stroke.

Module layout (all created in this phase):

| File | Purpose |
|------|---------|
| [src/lib/sculpt/index.js](../../src/lib/sculpt/index.js) | Brush registry, `getBrushById`, shared `brushFalloffWeights` helper |
| [src/lib/sculpt/grab.js](../../src/lib/sculpt/grab.js) | Grab brush — cursor delta × falloff × strength |
| [src/lib/sculpt/smooth.js](../../src/lib/sculpt/smooth.js) | Smooth brush — Laplacian over triangle adjacency, multi-iter |
| [src/lib/sculpt/pinch.js](../../src/lib/sculpt/pinch.js) | Pinch brush — pull toward cursor; Ctrl flips sign (Magnify) |

Wired through:

| Surface | What changed |
|---------|--------------|
| `editorStore.sculpt` slot | `{activeBrush, size, strength, falloff, iterations, connectedOnly}` + `setSculpt(partial)` deep-merge writer |
| `enterEditMode` whitelist | `'sculpt'` accepted; default `toolMode` → `'brush'` |
| `ModePill` | Sculpt Mode row (Hand icon), gated by `modeCompatTest(dataKind, MODE_SCULPT)` |
| `tools.js` | New `TOOLS_BY_MODE.sculpt` table (Grab/Smooth/Pinch); `toolsFor('sculpt')` returns it |
| `CanvasToolbar` | New `kind: 'sculpt_brush'` activation branch — writes `sculpt.activeBrush` |
| `ToolSettingsPanel` (N-panel) | `SculptSection` — brush picker, size, strength, falloff, iterations (Smooth-only), connected-only checkbox |
| `CanvasViewport.onPointerDown` | Sculpt branch builds `dragRef.current = { mode:'sculpt', adjacency, originIdx, prevCursor:null, firstTick:true, iwm, startSizeLocal }` |
| `CanvasViewport.onPointerMove` | Per-tick brush dispatch via `getBrushById(...).tick({...})`; first tick writes WITH history (one undo entry), rest with `skipHistory:true` |

## Blender fidelity notes

- **Magnify (Ctrl + Pinch).** Sign flips on Ctrl-hold via the brush
  `tick` opts (`{ ctrl: e.ctrlKey || e.metaKey }`). Matches Blender's
  `BRUSH_DIR_FLAG` / `SCULPT_TOOL_PINCH` modal toggle.
- **Falloff curves** reuse `applyFalloff` from `proportionalEdit.js`
  so the curves match Blender's `WM_propeditfalloff_*` 1:1.
- **Adjacency** reuses `getOrBuildAdjacency` from `proportionalEdit.js`
  (WeakMap-cached on the indices array). Successive Sculpt strokes on
  the same part hit the cache after the first build.
- **Connected-only** mode anchors the BFS at the vertex closest to
  the stroke's start cursor (Blender's "Use Connected Only" behaviour
  — the brush footprint is anchored to the start patch even if the
  cursor drags off it).
- **Inflate not shipped — Pinch in its place.** v1 of the plan called
  for Inflate; the audit-revised plan swapped it for Pinch because
  Blender's Inflate moves verts along the per-vertex *normal* which
  on a flat 2D mesh is degenerate. Pinch translates cleanly to 2D
  (each vert moves toward / away from the cursor); see plan §3.E.

## Frame discipline

Cursor canvas-px → mesh-local conversion uses the inverse world
matrix `iwm` cached at stroke begin. Recomputing `worldMatrices` per
pointermove is expensive (chains the whole node tree); the
stroke-begin snapshot stays accurate because the part's transform
doesn't move while the user is dragging in it.

Brush size is captured at stroke begin (`startSizeLocal = size /
view.zoom`) so mid-stroke zoom doesn't stretch the brush footprint.
This matches Blender's sculpt brush size lock at stroke begin.

Per-tick GPU upload reads from the freshly-written project ref so
what we upload matches the store. The `firstTick` flag drives a
single non-skipHistory write per stroke — rest use `skipHistory:true`
so undo restores the pre-stroke verts in one step.

## Test scoreboard

| Suite | Assertions |
|-------|------------|
| sculpt_grab | 18 |
| sculpt_smooth | 20 |
| sculpt_pinch | 18 |
| sculpt_store | 35 |
| **Phase 3 total** | **91** |

All adjacent suites green:

| Suite | Assertions |
|-------|------------|
| editorStore | 87 |
| canvasToolbar | 104 |
| modeCompat | 78 |
| proportionalEdit | 52 |
| (Phase 0/1/2 suites — vertexSelection_basic, boxSelect_objectMode, lassoSelect_modifiers, all 5 snap suites, audit_fixes_2026_05_10, modalTransformTyped, applyPoseAsRest) | green |

`npm run typecheck` clean post-fix to `tools.js` JSDoc Record.

## Manual gate (Phase 3.J — pending user)

Browser-side smoke test:

1. Select a meshed part → Sculpt Mode visible in ModePill dropdown,
   not greyed out.
2. Enter Sculpt Mode → T-panel shows 3 brush buttons (Grab / Smooth /
   Pinch); active brush ring + N-panel "Sculpt" section with brush
   picker, size, strength, falloff, iterations (visible only when
   Smooth selected), connected-only checkbox.
3. Grab: click-drag on mesh → verts within radius follow the cursor;
   rim verts feathered by falloff.
4. Smooth: click-drag on a noisy region → verts settle toward
   neighbours' average; Iterations=2 smooths twice as much per tick.
5. Pinch: click-drag → verts pull toward cursor center; hold Ctrl
   mid-drag → verts push AWAY (Magnify); release Ctrl → back to
   Pinch.
6. Stroke = one undo entry. Drag for 30 frames, release, Ctrl+Z →
   mesh restores to pre-drag state in one step.
7. Connected-only: enable, click on one connected component → only
   that component's verts move; verts on a separate component within
   the radius stay put.
8. Tab into Sculpt → proportional-edit toggle (next to ModePill)
   disappears (already gated on `editMode === 'edit'`); Tab back to
   Edit Mode → toggle reappears.

## Deliberately deferred (per Rule №1)

- **Brush ring overlay during sculpt strokes.** The proportional-edit
  ring (`propEditCircleRef`) is gated on `editMode === 'edit'`;
  Sculpt Mode would ideally show a similar circle at the cursor.
  Skipped for v1; brush still works cleanly without it, and adding
  a ring is a polish item not a correctness one.
- **Pressure / pen tilt.** Brush state plumbing accepts a `pressure`
  field but the canvas dispatch passes 1.0 (no Pen API integration).
- **Multi-iteration smoothing per tick beyond N=10.** `iterations`
  clamped to [1, 10] — pragmatic ceiling; 10 already produces a
  nearly flat result for any typical stroke.
- **Brush falloff `random`.** Same as proportional-edit — non-deterministic
  deformation rarely useful for character rigging.
- **Per-stroke falloff override (Shift+O cycle).** Phase 3 reads from
  `editorStore.sculpt.falloff`; user changes via N-panel, not chord.

## Commit

`<TBD>` — `feat(toolset): Phase 3 — Sculpt Mode + 3 brushes (Grab/Smooth/Pinch)`
