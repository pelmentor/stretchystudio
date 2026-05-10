# Toolset Phase 3 — Sculpt Mode + brushes (shipped 2026-05-10)

Plan reference: [TOOLSET_BLENDER_PARITY_PLAN.md §Phase 3](./TOOLSET_BLENDER_PARITY_PLAN.md#phase-3--sculpt-mode--brushes-1-week).

Audit docs:
- [AUDIT_2026_05_10_TOOLSET_PHASE3_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE3_ARCH.md) — 12 gaps, 3 HIGH addressed
- [AUDIT_2026_05_10_TOOLSET_PHASE3_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE3_BLENDER.md) — 15 gaps, 4 HIGH addressed

## What shipped (initial: `fa17a46`; audit-fix sweep: `<TBD>`)

A new `editorStore.editMode = 'sculpt'` with three Blender-faithful
sculpt brushes — Grab (anchored), Smooth (Laplacian), and Pinch
(stroke-aligned squeeze; Ctrl: Magnify, 4× weaker). Strokes collapse
to one undo entry per stroke.

Module layout:

| File | Purpose |
|------|---------|
| [src/lib/sculpt/index.js](../../src/lib/sculpt/index.js) | Brush registry, `getBrushById`, shared `brushFalloffWeights` helper |
| [src/lib/sculpt/grab.js](../../src/lib/sculpt/grab.js) | Grab brush — **anchored** (D-1 audit fix): brush footprint locks at click; verts repositioned to `orig + total_delta * weight` each tick |
| [src/lib/sculpt/smooth.js](../../src/lib/sculpt/smooth.js) | Smooth brush — Laplacian over triangle adjacency, multi-iter |
| [src/lib/sculpt/pinch.js](../../src/lib/sculpt/pinch.js) | Pinch brush — **stroke-aligned 2D squeeze** (D-2 audit fix): verts pulled perpendicular to stroke direction; Magnify (Ctrl) is 0.25× weaker (D-3) |

Wired through:

| Surface | What changed |
|---------|--------------|
| `editorStore.sculpt` slot | `{activeBrush, size, strength, falloff, iterations, connectedOnly}` + `setSculpt(partial)` deep-merge writer |
| `enterEditMode` whitelist | `'sculpt'` accepted; default `toolMode` → `'brush'` |
| `ModePill` | Sculpt Mode row (Hand icon), gated by `modeCompatTest(dataKind, MODE_SCULPT)` AND blocked when in Animation editor (G-2) |
| `tools.js` | New `TOOLS_BY_MODE.sculpt` table; new `kind: 'sculpt_brush'` activation kind |
| `CanvasToolbar` | sculpt_brush activate branch — writes `sculpt.activeBrush` |
| `ToolSettingsPanel` (N-panel) | "Brush Settings" section (D-12 — was "Sculpt"); brush picker, size, strength, falloff, iterations (Smooth-only), connected-only |
| `CanvasViewport.editorRef` | **Migrated to `useEditorStore.subscribe()`-driven full-store ref** (G-1 fix) — closes pre-existing facade gaps for `toolMode`, `brushHardness`, `autoKeyframe` in one shot |
| `CanvasViewport.onPointerDown` | Sculpt branch + Animation-mode safety net; snapshots `origVerts`, `startCursor`, `iwm`, `allUvs`, `ctrlAtStart` |
| `CanvasViewport.onPointerMove` | Per-tick brush dispatch; **in-memory `newVerts` build → GPU upload → `updateProject`** (G-3 fix; eliminates 1-frame visual lag); mode-change abort (G-4) |
| `CanvasViewport.onPointerUp` | K-dispatch gated on `dragRef.mode !== 'sculpt'` (G-7) |

## Audit-fix sweep details

### Architecture HIGH (audit `AUDIT_2026_05_10_TOOLSET_PHASE3_ARCH.md`)

- **G-1 (CRITICAL)** — Sculpt brush picker / size / strength / falloff /
  iterations / connectedOnly were ALL dead UI. The `editorRef.current`
  facade introduced by perf commit `a21fc2e` (2026-05-09) didn't
  carry the `sculpt` slot, so per-tick reads of
  `editorRef.current.sculpt ?? {}` silently fell back to defaults
  (always Grab brush at size 80, strength 0.5, smooth falloff). Same
  facade gap also broke `toolMode` (Phase 0 vertex-select toolbar
  dead), `brushHardness` (Edit-Mode brush hardness slider read NaN),
  `autoKeyframe` (animation auto-key never fired). Fixed by migrating
  `editorRef.current` to `useEditorStore.subscribe()`-driven full-store
  ref (sister to existing `animRef.current` pattern at
  [CanvasViewport.jsx:256-257](../../src/components/canvas/CanvasViewport.jsx#L256)).
  All four pre-existing gaps closed in one motion.
- **G-2** — Sculpt in Animation Mode permanently corrupted rest mesh
  (no `draftPose` route — sculpt is a rest-mesh edit, not a per-keyframe
  deformation). Fixed by gating ModePill row when `editorMode ===
  'animation'` + onPointerDown safety net `getEditorMode() !== 'animation'`.
- **G-3** — GPU upload was reading stale `projectRef.current` post-
  `updateProject` (1-frame visual lag every tick). Refactored to mirror
  Edit-Mode brush pattern: build `newVerts` in-memory, upload to GPU,
  THEN `updateProject`.

### Architecture MED

- **G-4** — Mode-change mid-stroke would leave `dragRef` live + cursor
  stuck at `crosshair`. Added `editorRef.current.editMode !== 'sculpt'`
  abort guard at the top of the per-tick brush dispatch.
- **G-7** — `pointerup` synthetic K dispatch (autoKeyframe path)
  fired even for sculpt strokes, where there's no `draftPose` to
  commit. Gated on `wasSculpt = dragRef.current.mode === 'sculpt'`.
- **G-8** — `test_sculpt_undo.mjs` listed in plan §3.H but not shipped
  with the initial commit. Now shipped (11 assertions covering empty-
  tick-1 firstTick stability, all-empty stroke = no history entry,
  sculpt slot independent of project undo).
- **G-10** — Per-tick `new Float32Array(mAfter.uvs)` allocation moved
  to dragRef setup (sculpt is position-only; UVs don't change).
- **G-11** — Dead dragRef fields `imageWidth`, `imageHeight`, `startZoom`
  removed; replaced with `origVerts`, `startCursor`, `allUvs`, `ctrlAtStart`.
- **G-12** — Misleading "freshly-written project ref" comment removed
  (replaced with accurate G-3 explanation).

### Blender-fidelity HIGH (audit `AUDIT_2026_05_10_TOOLSET_PHASE3_BLENDER.md`)

- **D-1** — Pre-fix Grab implemented Blender's NUDGE semantics
  (cursor-anchored radius + per-tick incremental delta vs current
  positions). Blender's actual GRAB is **anchored**: brush radius
  locks at click, total cursor delta accumulates, verts repositioned
  to `orig + total_delta * weight` each tick. Rewritten to match
  Blender (`mesh/sculpt.cc:4163-4307` `need_delta_from_anchored_origin`
  → true; `mesh/brushes/grab.cc:70-92` reads `OrigPositionData`).
  Anchored Grab is also more useful for character rigging (drag a
  feature as a unit; wandering cursor doesn't sweep up new verts).
- **D-2** — Pre-fix Pinch was radial pull (each vert moved toward
  cursor by `(cursor - vert) * weight * 0.5`). Blender's PINCH is
  **stroke-aligned squeeze**: stroke matrix X-axis = perpendicular to
  grab_delta; Z-axis = surface normal. For 2D mesh in canvas plane,
  Z-disp drops to 0 (normal is constant Z), so verts squeeze along
  the X-axis (perpendicular to stroke direction). Stationary cursor
  → no pinch (early-return). Rewritten to match Blender
  (`mesh/brushes/pinch.cc:39-60, 191-204`).
- **D-3** — Pre-fix Pinch used uniform `PINCH_RATE = 0.5` for both
  Pinch and Magnify directions. Blender's `brush_strength` returns
  `0.25 * alpha * pressure * overlap * feather` for Magnify direction
  (`mesh/sculpt.cc:2433-2439`) — 4× weaker than Pinch. Magnify is
  destructive (smooths/spreads) so deserves intentional throttling.
  Now: Pinch direction = full strength × PINCH_RATE; Magnify (Ctrl)
  direction = -0.25× (sign flip + 0.25 magnitude).
- **D-4** — Pre-fix dispatch read `e.ctrlKey` per-tick, allowing
  mid-stroke Pinch ↔ Magnify flip. Blender's `paint_stroke.cc:868`
  reads `RNA_enum_get(op->ptr, "mode")` ONCE at LMB-press; the modal
  handler doesn't toggle invert mid-stroke. Captured as
  `dragRef.ctrlAtStart` at pointerdown; brush dispatch passes that
  fixed value as `ctrl` per tick.

### Blender-fidelity MED + LOW (handled inline, no rewrite)

- **D-5** (Smooth iterations 1–10 slider) — SS-invented direct slider
  vs Blender's strength-derived `int(strength × 4)`. KEPT as
  intentional SS enhancement (more discoverable for character rigging
  users); module doc now flags as deviation.
- **D-6** (defaults `size: 80, strength: 0.5`) — Blender DNA defaults
  are `size: 70, alpha: 1.0`. KEPT as SS choice (smaller default for
  2D character canvas; gentler default strength avoids over-deform on
  first stroke). Acceptable drift documented in module + plan.
- **D-7** (connected-only on every brush vs Pose-brush only in Blender)
  — KEPT as SS enhancement (useful for limiting brush to one mesh
  component during character editing); BrushTickOpts JSDoc flags as
  SS-invented.
- **D-8** (per-pointermove dispatch vs `brush.spacing`-paced strokes)
  — DEFERRED to Phase 3 polish v2; documented in plan §3 as DRIFT.
- **D-10** — Lucide icon picks: `Smile` → `Waves` (Smooth), `Minimize`
  → `ChevronsLeftRight` (Pinch). Visually convey actual function.
- **D-11** (brush ring overlay) — DEFERRED to Phase 3 polish v2.
- **D-12** — N-panel section label `"Sculpt"` → `"Brush Settings"`
  (matches Blender's `bl_label`).
- **D-13** — Fabricated Blender enum names (`BRUSH_DIR_FLAG`,
  `SCULPT_TOOL_PINCH`, `SCULPT_brush_strokes`) scrubbed from module
  docs + commit messages. Real symbols cited where applicable.

### Deliberately deferred (per Rule №1, no half-measures)

- **G-5** (sculpt distance test uses rest verts but cursor projected
  through deformed iwm — frame mismatch on bone-skinned parts) —
  documented as "Sculpt is rest-mesh-only; for posed characters,
  exit Pose Mode first". Building `effectiveVerts` would mirror
  the Edit-Mode brush at a substantial complexity cost; defer until
  a posed-mesh sculpt use case appears.
- **G-6** (`iwm` cached at stroke begin goes stale if anim playback
  advances mid-stroke) — Animation playback-during-sculpt is now
  blocked by G-2 (sculpt forbidden in Animation editor). Driver-driven
  transform updates remain a theoretical concern but rare in practice.
- **G-9** (`originIdx` for connectedOnly has no max-distance cutoff)
  — performance-only; no visible bug.

## Frame discipline (post-audit-fix)

- Cursor canvas-px → mesh-local conversion uses the inverse world
  matrix `iwm` cached at stroke begin (recomputing per pointermove
  is expensive — chains the whole node tree).
- Brush size captured at stroke begin (`startSizeLocal = size /
  view.zoom`) so mid-stroke zoom doesn't stretch the brush footprint.
- Per-tick: build `newVerts` in-memory from `mesh.vertices` (or
  `origVerts` for Grab), apply tick result, upload to GPU **before**
  `updateProject` — eliminates the projectRef-stale-until-render
  1-frame visual lag (G-3).
- One-undo-per-stroke: first non-empty tick writes WITH history
  (snapshot is pre-stroke); rest use `skipHistory: true`. Grab brush's
  always-empty first tick (no `prevCursor`) means the snapshot fires
  on the SECOND pointermove for Grab — pre-stroke verts are still
  unchanged at that point.

## Test scoreboard (post-audit-fix sweep)

| Suite | Assertions |
|-------|------------|
| sculpt_grab (rewritten for anchored semantics) | 26 |
| sculpt_smooth | 20 |
| sculpt_pinch (rewritten for stroke-aligned semantics) | 20 |
| sculpt_store | 35 |
| **sculpt_undo (NEW)** — empty-tick-1, all-empty stroke, isolation | 11 |
| **Phase 3 total** | **112** |

All adjacent suites green:

| Suite | Assertions |
|-------|------------|
| editorStore | 87 |
| canvasToolbar | 104 |
| modeCompat | 78 |
| proportionalEdit | 52 |
| audit_fixes_2026_05_10 | 23 |
| modalTransformTyped | 11 |
| undoHistory | 22 |
| vertexSelection_basic | 28 |
| snap_gesture_model | 18 |

`npm run typecheck` clean.

## Manual gate (Phase 3.J — pending user)

Browser-side smoke test:

1. Select a meshed part → Sculpt Mode visible in ModePill, **enabled
   only when not in Animation editor** (G-2).
2. Enter Sculpt Mode → T-panel shows 3 brush buttons (Grab/Smooth/
   Pinch); N-panel "**Brush Settings**" (D-12) section with picker,
   size, strength, falloff, iterations (visible only when Smooth
   selected), connected-only.
3. **Picker is live** (G-1 fix): N-panel "Brush: Pinch" → next stroke
   does Pinch math, not Grab. Slider "Size: 200" → next stroke uses
   200 px footprint.
4. **Grab (anchored)**: click on a feature → drag → entire feature
   patch translates as a unit (the click-time radius locks; sweeping
   the cursor doesn't pick up new verts). Release → re-click on
   different feature → new patch grabs. Matches Blender 1:1.
5. **Smooth**: click-drag on noisy region → settles toward neighbours'
   average; Iterations=5 smooths much more aggressively per tick.
6. **Pinch (stroke-aligned)**: click-drag ALONG a hairline → verts on
   either side pinch toward the line (sharpens it). Stationary cursor
   click-hold → no pinch (no stroke direction). Hold Ctrl AT CLICK
   for Magnify (verts spread away from line; 4× weaker; D-3 + D-4).
7. **Ctrl mid-stroke is ignored** (D-4): start Pinch (no Ctrl), drag,
   press Ctrl mid-drag → still Pinch (not Magnify). Release pointer,
   re-click with Ctrl held → now Magnify.
8. **Stroke = one undo entry**: drag for 30 frames, release, Ctrl+Z →
   mesh restores to pre-drag state in one step.
9. **Connected-only**: enable, click on one mesh component → only
   that component's verts move; verts on a separate component within
   the radius stay put.
10. **Animation gate** (G-2): switch to Animation editor → Sculpt
    Mode row in ModePill is disabled with hint "Sculpt edits the
    rest mesh — exit the Animation editor first…".
11. **No 1-frame lag** (G-3): Sculpt strokes feel snappy. Per-tick
    GPU upload is in-memory before `updateProject`.

## Pre-existing latent fixes (G-1 side effects)

The G-1 facade rewrite to `useEditorStore.subscribe()`-driven `editorRef`
also closes three latent gaps that pre-dated Phase 3:

- Phase 0 Edit-Mode toolbar tools (`select` / `add_vertex` /
  `remove_vertex`) — `toolMode` was `undefined` in the dispatch,
  silently falling through to brush. Now read correctly.
- Edit-Mode brush hardness slider — `brushHardness` was `undefined`
  → `brushWeight(dist, radius, undefined)` returned NaN → brush
  effects were degenerate. Now read correctly.
- Animation auto-keyframe (`autoKeyframe` slot from BFA-002) — was
  silently never firing because the facade dropped it. Now read
  correctly. Note: not directly tested in this sweep; user should
  verify in animation manual gate.

## Commit chain

| Order | Commit | What |
|-------|--------|------|
| 1 | `fa17a46` | feat(toolset): Phase 3 — Sculpt Mode + 3 brushes |
| 2 | `<TBD>` | fix(audit): Phase 3 audit-fix sweep — 3 HIGH arch + 4 HIGH Blender + 12 MED/LOW |
