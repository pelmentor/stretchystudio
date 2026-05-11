# Session Close-out — 2026-05-11 (Phase 7.B sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE7A.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7A.md).
This sub-session shipped Toolset **Phase 7.B + Phase 7.B audit-fix sweep**
(eighth audit sweep over the toolset plan). Branch ahead of `origin/master`
by 27 commits at HEAD `bd2b58f` (close-out doc commit follows separately).

## What shipped this sub-session (2 commits)

### Toolset Blender-Parity Plan — Phase 7.B + audit-fix

| Commit  | What |
|---------|------|
| `9489177` | Phase 7.B initial — Sample Weight (Shift+X) + Blur brush + Mirror Weights (Topology + By Name) + X-Axis Mirror toggle + Normalize All. Schema bump v34 (`node.weightPaintSettings.xMirror`). 137 spec assertions across 6 test suites. |
| `bd2b58f` | Phase 7.B audit-fix sweep — 2 HIGH (1 arch + 1 Blender) + 6 MED + 7 LOW gaps closed. 8 FIXes + 5 DOCUMENT-AS-DEVIATION (Rule №1) + 2 already-documented. 43-assertion audit-pin test (185 total Phase 7.B). |

(Close-out doc commit follows separately.)

## Audit-fix sweep details (`bd2b58f`)

Full per-gap details in
[TOOLSET_PHASE_7B_PROGRESS.md](./TOOLSET_PHASE_7B_PROGRESS.md)
§"Audit-fix sweep details". Headlines:

### Architecture HIGH

- **G-1** — N-panel rendered the deform-mode `BrushSection` in
  weight-paint mode, surfacing a Hardness slider that wrote to
  `brushHardness` (read only by deform brushes). Slider had ZERO effect
  on Draw or Blur. Rule №1 violation. Fix: introduce
  `editorStore.brushStrength`; replace BrushSection in weight-paint
  with size-only `WeightPaintBrushSizeSection`; wire `brushStrength`
  to BOTH Draw and Blur in `flushPaint`. Closes G-4 + D-6 in same
  vehicle.

### Blender-fidelity HIGH

- **D-1** — `computeBlurUpdates` used pure unique-neighbour mean.
  Blender's `do_wpaint_brush_blur` (`paint_weight.cc:1214-1249`) uses
  face-loop accumulation: target = `(k*w[v] + sum(neighbours)) / (3k)`
  for valence k on triangle mesh — preserves 1/3 of own weight per
  tick. Pre-fix SS converged a `w=1` boundary vert to 0.0 in 1 tick;
  Blender reaches 0.333. Fix: pass `triangles` to `computeBlurUpdates`;
  pre-pass builds `[sum, loops]` per vertex; target = `sum / loops`.

### Architecture MED

- **G-2** — `mirrorWeights` topology branch leaked phantom undo
  snapshot when `activeWeightGroup` was missing. Fix: gate
  `eligibleForMirror({mode:'position'})` on activeWeightGroup +
  early-return BEFORE `beginBatch`.
- **G-3 (DOCUMENT-AS-DEVIATION)** — `sampleWeightFromGlobalCursor`
  singleton overlay assumption. Safe in v1 (one CanvasArea); split-
  view would need a registered-rect getter. Documented in sample.js.
- **G-4 (FIX via G-1 vehicle)** — Blur strength hardcoded; now
  `brushStrength`.

### Blender-fidelity MED

- **D-2 (FIX cite)** — `paint_weight.cc:1063` was misidentified as
  enum; real enum at `DNA_brush_enums.h:507-510`. Cite corrected in
  `blur.js`.
- **D-3 (FIX rename)** — Mirror mode 'topology' was a Blender NAMING
  INVERSION (Blender `use_topology=false` IS coordinate match).
  Rename → 'position'; operator id → `weightPaint.mirror.byPosition`;
  N-panel label → "Mirror (By Position)". Per Rule №2 the legacy id
  is dropped without alias.
- **D-4 (FIX port)** — `NAME_PAIRS` only recognised 4 suffix pairs.
  Blender's `BLI_string_flip_side_name` (`string_utils.cc:243-413`)
  has 3 passes (suffix, prefix, word). Fix: ported as
  `flipSideName(name)`. Now `arm-L`, `L_arm`, `LEFT_eye` all flip.

### Architecture LOW

- **G-5 (DOCUMENT-AS-DEVIATION)** — `buildMirrorVertexMap` bucket
  resolution 10× finer than acceptance threshold. Auto-rig safe;
  documented.
- **G-6** — `weightPaint.sample.available()` returned true for non-
  meshed parts. Fix: mesh-presence check matching sister gates.

### Blender-fidelity LOW

- **D-5 (DOCUMENT-AS-DEVIATION)** — `paint.weight_sample_group`
  (`Ctrl+Shift+X`) not implemented. Documented in keymap.
- **D-6 (FIX via G-1 vehicle)** — Strength hardcoded; now
  `brushStrength`.
- **D-7 (DOCUMENT-AS-DEVIATION)** — Sample threshold ties to brushSize
  (intentional UX). Documented.
- **D-8 (DOCUMENT-AS-DEVIATION expanded)** — Companion
  `use_mirror_topology` not modeled. Documented in v34 migration.
- **D-9 (already documented)** — `lock_active` deviation in
  normalizeAll.

Audit docs on disk:
- [AUDIT_2026_05_11_TOOLSET_PHASE7B_ARCH.md](./AUDIT_2026_05_11_TOOLSET_PHASE7B_ARCH.md) — 6 gaps (1 HIGH, 3 MED, 2 LOW)
- [AUDIT_2026_05_11_TOOLSET_PHASE7B_BLENDER.md](./AUDIT_2026_05_11_TOOLSET_PHASE7B_BLENDER.md) — 9 gaps (1 HIGH, 3 MED, 5 LOW)

## Test scoreboard

All 7 Phase 7.B suites green; sister suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_weightPaint_blur` (face-loop algo, rewritten)                     | 27  |
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

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged. Depgraph coherent post Phase 0 audit-fix; Phase 0.D flag
flip is gated on user-side manual byte-fidelity sweep on Shelby +
test_image4 PSDs.

### B. Manual gates 0.H + 1.F + 2.G + 3.J + 4.J + 5.E + 6.F + 7.A.6 + 7.B.6

Nine manual gates queued (browser-side). Phase 7.B.6 highlights:
- Sample Weight (Shift+X): eyedropper picks vertex weight under cursor
- Blur brush (D-1 fix): face-loop math now matches Blender's 1/3
  self-preservation per tick
- Strength slider (G-1 fix): per-tick lerp drives both Draw and Blur
- Mirror (By Position) (D-3 fix): renamed from "Topology"
- Mirror (By Name) (D-4 fix): now recognises `arm-L`, `L_arm`,
  `LEFT_eye` patterns
- X-Axis Mirror toggle: live mirror during stroke
- Normalize All: per-vertex sum → 1.0
- Schema v34 persistence: xMirror toggle survives save+load

### C. Toolset Phase 7.C — Pose Mode tools (3–4 days)

Next autonomous chunk per plan §7.C:
- 7.C.1 Clear Pose Location (`Alt+G`)
- 7.C.2 Clear Pose Rotation (`Alt+R`)
- 7.C.3 Clear Pose Scale (`Alt+S`)
- 7.C.4 Clear All Pose (`Alt+Shift+G/R/S` per audit-fixed bindings)
- 7.C.5 Select Mirror (`Ctrl+Shift+M`) + Mirror Pose (`Ctrl+Shift+V`)
- 7.C.6 Copy / Paste Pose (`Ctrl+C` / `Ctrl+V` in Pose Mode)

Phase 7.C has no schema bump (uses existing `node.pose` shape from
v17). Adds new `poseClipboardStore`. Six new chord reservations.

### D. Toolset Phase 7.D — Phase 7 exit gate

Per plan §7.D — verify all per-mode tool clusters work end-to-end on a
real Shelby project and update the plan's Top-12 score (Phase 7
covers ~6 of the 12 entries directly).

## Hotkey reservations (Phase 7.B additions)

- `Shift+KeyX` = `weightPaint.sample` ✅ shipped

(Mirror Weights + Normalize All deliberately have NO chord per the
audit-fixed binding table.)

Forthcoming Phase 7.C reservations (per plan, not yet bound):
- `Alt+KeyG` / `Alt+KeyR` / `Alt+KeyS` = `pose.clear{Loc,Rot,Scale}`
- `Alt+Shift+KeyG` / `Alt+Shift+KeyR` / `Alt+Shift+KeyS` = `pose.clearAll*`
- `Ctrl+Shift+KeyM` = `pose.selectMirror`
- `Ctrl+Shift+KeyV` = `pose.mirrorPose`

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (24 from 2026-05-10 close-out) | Phases 0/1/2/3/4/5/6 ship + audit-fixes + close-outs |
| 25    | `cdd3c93` | toolset Phase 7.A — Object Mode tools |
| 26    | `c9c35c3` | audit-fix sweep #7 — Phase 7.A dual audit |
| 27    | `c6d1604` | docs Phase 7.A close-out + progress |
| 28    | `9489177` | toolset Phase 7.B — Weight Paint tools (Sample / Blur / Mirror / X-Mirror / Normalize) |
| 29    | `bd2b58f` | audit-fix sweep #8 — Phase 7.B dual audit (2 HIGH + 11 MED/LOW) |
