# Toolset Phase 7.B — Weight Paint tools — PROGRESS

Status: **SHIPPED 2026-05-11** (initial `9489177` + audit-fix `bd2b58f`).
Owner: pelmentor.
Plan: [TOOLSET_BLENDER_PARITY_PLAN.md §7.B](./TOOLSET_BLENDER_PARITY_PLAN.md).

## What shipped

Five user-facing tool clusters per plan §7.B.1-5, each Blender-faithful
chord-bound or N-panel surfaced + mounted in WeightPaintSection:

| # | Tool | Surface | Implementation |
|---|------|---------|----------------|
| 7.B.1 | Sample Weight | `Shift+X` | `src/v3/operators/weightPaint/sample.js` (`sampleWeightAt` + `sampleWeightFromGlobalCursor`) |
| 7.B.2 | Blur brush | brush dropdown | `src/lib/weightPaint/blur.js` (face-loop accumulation per `paint_weight.cc:1214-1249`) + `src/lib/weightPaint/index.js` (`WEIGHT_BRUSHES`) |
| 7.B.3 | Mirror Weights | N-panel buttons + command palette | `src/v3/operators/weightPaint/mirror.js` (Position + By Name modes) |
| 7.B.4 | X-Axis Mirror toggle | N-panel checkbox | `node.weightPaintSettings.xMirror` (schema v34) + WeightPaintOverlay live-mirror |
| 7.B.5 | Normalize All | N-panel button + command palette | `src/v3/operators/weightPaint/normalize.js` |

## Schema bump v34

`node.weightPaintSettings: { xMirror: boolean }` — per-Object X-axis
live mirror toggle for weight paint strokes. Default `false`. Migration
in `src/store/migrations/v34_weight_paint_settings.js`. Mirrors Blender's
`Mesh.use_mirror_x` (`reference/blender/source/blender/makesrna/intern/rna_mesh.cc:3243-3247`,
backed by `Mesh.symmetry & ME_SYMMETRY_X`). SS stores per-Object rather
than per-Mesh because v18+ Object↔ObjectData split makes per-mesh paths
awkward; behaviorally identical for v1 (1 Object = 1 mesh).

## Editor-state additions

- `editorStore.weightPaintBrush` — brush type id from `WEIGHT_BRUSHES`
  registry (`'draw'` default; `'blur'` is the only other v1 brush).
- `editorStore.brushWeight` — eyedropper-driven target weight `[0,1]`
  (default `1.0`). Written by `Shift+X`.
- `editorStore.brushStrength` (audit-fix G-1+G-4+D-6) — per-tick lerp
  factor `[0,1]` (default `0.5`). Wired to BOTH Draw and Blur strokes.
  Replaces the pre-fix hardcoded `0.5` constants in WeightPaintOverlay
  AND the misleading Hardness slider that wrote to deform-only
  `brushHardness`.

## Audit-fix sweep details (`bd2b58f`)

Two parallel agents audited initial `9489177`:
- [AUDIT_2026_05_11_TOOLSET_PHASE7B_ARCH.md](./AUDIT_2026_05_11_TOOLSET_PHASE7B_ARCH.md)
  — 6 gaps (1 HIGH, 3 MED, 2 LOW)
- [AUDIT_2026_05_11_TOOLSET_PHASE7B_BLENDER.md](./AUDIT_2026_05_11_TOOLSET_PHASE7B_BLENDER.md)
  — 9 gaps (1 HIGH, 3 MED, 5 LOW)

15 total: 2 HIGH, 6 MED, 7 LOW. **All HIGH addressed.** MED+LOW: 8 FIX,
5 DOCUMENT-AS-DEVIATION, 2 already-documented.

### Architecture HIGH

- **G-1** — N-panel rendered the deform-mode `BrushSection` in
  weight-paint mode, surfacing a Hardness slider that wrote to
  `brushHardness` (read only by deform-mode brushes). Slider had zero
  effect on Draw or Blur strokes. Fix: introduce
  `editorStore.brushStrength` + setter; replace BrushSection in
  weight-paint with size-only `WeightPaintBrushSizeSection`; wire
  `brushStrength` to BOTH Draw and Blur per-tick lerp in `flushPaint`.
  Closes G-4 + D-6 in same vehicle.

### Architecture MED

- **G-2** — `mirrorWeights` topology branch leaked phantom undo
  snapshot when `activeWeightGroup` was missing. Fix: gate
  `eligibleForMirror({mode:'position'})` on activeWeightGroup +
  early-return BEFORE `beginBatch`.
- **G-3 (DOCUMENT-AS-DEVIATION)** — `sampleWeightFromGlobalCursor`
  singleton overlay assumption. Safe in v1; documented for split-view
  future.
- **G-4 (FIX via G-1 vehicle)** — Blur strength hardcoded; now driven
  by `brushStrength`.

### Architecture LOW

- **G-5 (DOCUMENT-AS-DEVIATION)** — `buildMirrorVertexMap` bucket key
  resolution 10× finer than acceptance threshold; sub-pixel jitter
  loses pairs. Auto-rig safe; documented.
- **G-6** — `weightPaint.sample.available()` returned true for non-
  meshed parts. Fix: mesh-presence check matching sister gates.

### Blender-fidelity HIGH

- **D-1** — `computeBlurUpdates` used unique-neighbour mean. Blender
  `do_wpaint_brush_blur` uses face-loop accumulation (1/3 self-
  preservation on triangle meshes). Boundary collapsed in 1 tick in
  SS vs reaching 1/3 in Blender. Fix: pass `triangles` to
  `computeBlurUpdates`; pre-pass builds per-vertex `[sum, loops]`;
  `target = sum / loops`.

### Blender-fidelity MED

- **D-2 (FIX cite)** — `paint_weight.cc:1063` cited as enum; line
  1063 is a runtime guard. Real enum at `DNA_brush_enums.h:507-510`.
  Cite corrected in `blur.js`.
- **D-3 (FIX rename)** — Mirror mode 'topology' was a NAMING
  INVERSION vs Blender (`use_topology=false` IS coordinate match).
  Rename → 'position'; operator id → `weightPaint.mirror.byPosition`;
  label → "Mirror Weights (By Position, X axis)". Per Rule №2 the
  legacy id is dropped without alias.
- **D-4 (FIX port)** — `NAME_PAIRS` only recognised 4 suffix forms.
  Blender's `BLI_string_flip_side_name` (3 passes: suffix, prefix,
  word) supports 12+ patterns. Fix: ported as `flipSideName(name)`.
  Now `arm-L/arm-R`, `L_arm/R_arm`, `LEFT_eye/RIGHT_eye` pair.

### Blender-fidelity LOW

- **D-5 (DOCUMENT-AS-DEVIATION)** — `paint.weight_sample_group`
  (`Ctrl+Shift+X`) not implemented; SS uses N-panel Vertex Groups
  dropdown. Documented in keymap.
- **D-6 (FIX via G-1 vehicle)** — Strength hardcoded; now `brushStrength`.
- **D-7 (DOCUMENT-AS-DEVIATION)** — Sample threshold ties to brushSize
  (intentional UX); diverges from Blender's fixed
  `ED_MESH_PICK_DEFAULT_VERT_DIST=25` at brushSize<16 or >50.
  Documented.
- **D-8 (DOCUMENT-AS-DEVIATION expanded)** — Companion
  `use_mirror_topology` not modeled. Documented in v34 migration.
- **D-9 (already documented)** — `lock_active` deviation in
  normalizeAll.

## Test scoreboard

All 7 Phase 7.B suites green; sister suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_weightPaint_blur` (face-loop algo)                                | 27 (was 22; rewritten) |
| `test_weightPaint_sample`                                               | 17  |
| `test_weightPaint_mirror` (post-rename to 'position')                   | 41  |
| `test_weightPaint_normalize`                                            | 27  |
| `test_weightPaint_xMirror`                                              | 11  |
| `test_migrationV34`                                                     | 19  |
| **`test_audit_fixes_2026_05_11_phase7b` (NEW — pins all 8 FIXes)**      | **43** |
| **Phase 7.B total post-audit-fix**                                      | **185** |
| migrations                                                              | 135 |
| editorStore                                                             | 87  |
| meshSync                                                                | 28  |
| undoHistory                                                             | 22  |
| applyMenuStore                                                          | 28  |
| auditFixes Phase 7.A                                                    | 50  |

## N-panel layout (`ToolSettingsPanel.jsx`) — post-audit-fix

Weight Paint mode N-panel content (top to bottom):

```
[ Brush ]
  Size           ▶▶▶▶▶▶▶▶▶▶  50px      ← only Size; Hardness REMOVED (G-1)

[ Weight Paint ]
  Brush          [Draw  ▾]
  Weight         ▶▶▶▶▶▶▶▶▶▶  1.00      ← Draw only
  Strength       ▶▶▶▶▶───── 0.50       ← NEW (G-1+G-4+D-6); both brushes
  ☐ X-Axis Mirror
  ─────────
  [ Mirror (By Position) ]              ← was "Topology" (D-3)
  [ Mirror (By Name) ]
  [ Normalize All ]
```

## Hotkey additions (Phase 7.B)

- `Shift+KeyX` → `weightPaint.sample`

(Mirror Weights + Normalize All have NO chord per plan §"Phase 7 —
Weight Paint (audit-fixed bindings)" — the latter because Blender's
`Ctrl+N` collides with SS's `file.new`; the former because Blender
surfaces them via right-click context menu, which SS doesn't have
yet.)

## Manual gate (Phase 7.B.6)

Browser-side. Suggested checks:

- **Sample Weight**: weight-paint a vertex → press `Shift+X` over it →
  brush weight slider updates to that vertex's weight.
- **Blur brush**: paint a high-contrast weight pattern (1.0 stripe) →
  switch to Blur → drag across the boundary; weights smooth toward the
  face-loop weighted mean (1/3 self-preserve per Blender semantics —
  audit fix D-1).
- **Strength slider** (audit fix G-1): drag Strength from 0 to 1; both
  Draw and Blur brushes converge faster/slower accordingly.
- **Mirror (By Position)** (audit fix D-3): on a symmetric mesh, paint
  weights on the left side → press Mirror (By Position); right side
  receives the mirrored weights.
- **Mirror (By Name)**: rename groups to `arm_L` / `arm_R` (or the
  expanded `L_arm`/`R_arm`/`LEFT/RIGHT` patterns from audit fix D-4)
  → paint left → press Mirror (By Name); right receives.
- **X-Axis Mirror toggle**: tick the N-panel checkbox → paint a single
  vertex; the mirrored vertex also receives the same weight.
- **Normalize All**: paint multiple groups so per-vertex sums > 1 →
  press Normalize All → sums become 1.0.
- **Schema persistence**: tick X-Mirror → save + reload `.stretch` →
  the toggle state survives.
