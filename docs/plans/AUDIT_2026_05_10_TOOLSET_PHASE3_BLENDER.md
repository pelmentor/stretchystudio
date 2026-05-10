# Audit 2026-05-10 — Toolset Plan Phase 3 (Sculpt Mode + 3 brushes), Blender fidelity

Commit: `fa17a46` — `feat(toolset): Phase 3 — Sculpt Mode + 3 brushes (Grab/Smooth/Pinch)`
Plan ref: [TOOLSET_BLENDER_PARITY_PLAN.md §Phase 3](./TOOLSET_BLENDER_PARITY_PLAN.md) (lines 568–720)
Progress: [TOOLSET_PHASE_3_PROGRESS.md](./TOOLSET_PHASE_3_PROGRESS.md)
Reference Blender clone at `reference/blender/source/blender/editors/sculpt_paint/...`.

Scope: Blender fidelity only. Architecture / NPE / undo correctness is the parallel agent's review.

---

## Summary table

| ID    | Severity | Area                                 | Class       | Verdict |
|-------|----------|--------------------------------------|-------------|---------|
| D-1   | HIGH     | Grab semantic: anchored vs continuous | BUG         | SS Grab is closer to Blender NUDGE than to GRAB. Real GRAB anchors radius at click + accumulates delta against ORIG positions. |
| D-2   | HIGH     | Pinch math: radial pull vs stroke-aligned squeeze | BUG     | Real Pinch projects displacement onto stroke-X + surface-Z (Y removed). SS does pure radial pull toward cursor. |
| D-3   | HIGH     | Pinch coefficient `PINCH_RATE = 0.5` | DRIFT       | Blender uses `alpha * pressure * overlap * feather` (no fixed 0.5). Magnify is asymmetric: 0.25× weaker than Pinch in Blender; SS uses uniform sign flip. |
| D-4   | HIGH     | Ctrl-during-stroke vs lock-at-begin   | BUG         | Blender's `toggle_settings.invert` is set ONCE at stroke begin from Ctrl (or pen flip). SS reads `e.ctrlKey` per-tick, allowing mid-stroke flip. |
| D-5   | MED      | Smooth iterations field 1–10          | DRIFT       | Blender's standard Laplacian Smooth has NO iterations slider. Iteration count is implicit via `int(strength * 4) (+1 partial)`. |
| D-6   | MED      | Defaults `size=80, strength=0.5`      | DRIFT       | Blender DNA defaults are `size=70, alpha=1.0`. SS values are invented (close-ish, but not cited). |
| D-7   | MED      | "Use Connected Only" on every brush   | DRIFT/BUG   | Real `BRUSH_USE_CONNECTED_ONLY` is a Pose-brush-only flag (only consumer is `sculpt_pose.cc`). Generic Sculpt brushes don't expose it. |
| D-8   | MED      | Per-pointermove dispatch vs spaced stroke | DRIFT   | Blender dispatches at `brush.spacing` % of radius (default 10% → ~7px for size=70). SS fires every pointermove. |
| D-9   | LOW      | Falloff curve set                     | DRIFT       | SS uses 7 of Blender's 10 curves; missing `smoother`, `pow4`, `custom`. Defaults to `smooth` (Blender match). Curve formulas verified identical for the 7 shared. |
| D-10  | LOW      | Iconography (Smile = Smooth, Hand = Grab, Minimize = Pinch) | DRIFT | Lucide `Smile` reads as facial expression, not "average / smooth". Better picks suggested. |
| D-11  | LOW      | Brush ring overlay deferred           | INTENTIONAL | Plan acknowledges; Blender's `paint_draw_cursor` always shows ring. UX gap, not a fidelity bug. |
| D-12  | LOW      | N-panel section label "Sculpt" vs "Brush Settings" | DRIFT | Blender uses `bl_label = "Brush Settings"` (`scripts/startup/bl_ui/space_view3d_toolbar.py:325, 1566, 1626, 1802`). SS uses "Sculpt". |
| D-13  | LOW      | Documentation references fabricated enum names | BUG (doc) | `BRUSH_DIR_FLAG`, `SCULPT_TOOL_PINCH`, `SCULPT_brush_strokes` cited in commit + module docs do not exist. Real symbols are `BRUSH_DIR_IN`, `SCULPT_BRUSH_TYPE_PINCH`. |
| D-14  | INFO     | Brush size unit (canvas-px)           | INTENTIONAL | Matches Blender's `BRUSH_LOCK_SIZE`-OFF default (VIEW unit / pixels). Image Paint 2D also uses pixels. Justified. |
| D-15  | INFO     | Inflate → Pinch swap                  | INTENTIONAL | Verified: Blender Inflate translates along `vert_normals`. Flat 2D mesh has all normals on Z, giving zero in-plane displacement. Audit-driven swap is correct. |

---

## D-1 — HIGH — Grab brush: anchored radius + accumulated-delta-against-ORIG

**SS:** `src/lib/sculpt/grab.js:29-58` + `src/components/canvas/CanvasViewport.jsx:2247-2316`
- On `onPointerDown` (CanvasViewport.jsx:2253-2316): `originIdx` is computed at click, but NOT used as a radius anchor. The brush radius is centered at the LIVE cursor every tick.
- `grab.js:33-34`: `dx = cursor.x - prevCursor.x; dy = cursor.y - prevCursor.y` (per-tick incremental delta).
- `grab.js:43-48`: `brushFalloffWeights` is recomputed per tick around the LIVE cursor against CURRENT vertex positions.
- `grab.js:53-56`: writes `verts[i].x + dx * w * s` — applied to CURRENT positions.

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/grab.cc:70-93` + `mesh/sculpt.cc:4163-4307`
- `sculpt.cc:4163-4181`: `need_delta_from_anchored_origin(brush)` is **true** for `SCULPT_BRUSH_TYPE_GRAB` (and Pose / Boundary / Thumb / ElasticDeform).
- `sculpt.cc:4272-4276`: For these brushes, `delta = grab_location - cache->old_grab_location` is **accumulated** into `cache->grab_delta` (running total since stroke start).
- `sculpt.cc:4305-4307`: `cache->location = cache->orig_grab_location` — brush radius stays anchored at the original click point, doesn't follow cursor.
- `grab.cc:70-71`: Operates on `OrigPositionData orig_data = orig_position_data_get_mesh(...)` — verts are pulled from their **stroke-start** positions, not current.
- `grab.cc:87-92`: `translations_from_offset_and_factors(offset, factors, translations)` — offset (= total accumulated grab_delta) applied as uniform translation, scaled by per-vert factor.

**Difference.**
- Blender Grab: click captures verts in radius once; drag accumulates total displacement; ORIG verts are repositioned to `orig + total_delta * falloff`. Releasing & re-clicking restarts. Cursor position NEVER picks up new verts mid-stroke.
- SS Grab: click captures live cursor; each pointermove pulls verts CURRENTLY in the moving radius by per-frame delta from CURRENT positions.

**Behavioural consequence.** SS users who sweep the cursor across a region effectively "paint" deformations into successive verts (closer to NUDGE behaviour). Blender users who do the same get a single uniform translation of the original captured patch.

**Class:** BUG. SS calls itself a Grab port but implements continuous-delta Nudge semantics.

---

## D-2 — HIGH — Pinch brush: radial pull vs stroke-aligned squeeze

**SS:** `src/lib/sculpt/pinch.js:36-63`
- `dx = cursor.x - verts[i].x` (line 52): displacement vector points from each vert to the cursor.
- Lines 56-60: `verts[i].xy + dx,dy * (w * s * PINCH_RATE * sign)` — pure radial pull toward (or away from) cursor.

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/pinch.cc:39-60` (`calc_translations`) + `pinch.cc:194-204`
- Lines 39-60 compute the stroke matrix: `mat.x_axis = cross(area_no, grab_delta_symm); mat.y_axis = cross(area_no, mat.x_axis); mat.z_axis = area_no;` then extracts `stroke_xz = {normalize(mat.x_axis), normalize(mat.z_axis)}`.
- Lines 47-58: `disp_center = location - position; x_disp = stroke_xz[0] * dot(disp_center, stroke_xz[0]); z_disp = stroke_xz[1] * dot(disp_center, stroke_xz[1]); translations[i] = x_disp + z_disp;`
- "The Y component is removed" (comment, line 57): displacement is the cursor-to-vert vector projected onto the stroke direction (X) + surface normal (Z). The transverse component (Y) is dropped.

**Difference.** Blender Pinch is anisotropic — only the components ALONG the stroke direction and ALONG the surface normal contribute. The component PERPENDICULAR to the stroke is suppressed. SS does pure isotropic radial pull (every component contributes).

**Behavioural consequence.**
- SS Pinch with a stationary cursor: verts in radius pull uniformly toward cursor (visually identical to a circular lasso closing).
- Blender Pinch with a stationary cursor: stroke matrix can't form (`grab_delta_symm` is zero-vector → early-return at `pinch.cc:191-193`). NO pinch occurs until the user drags.
- Blender Pinch DURING drag: verts are squeezed perpendicular to the stroke direction (sharpening a ridge along the stroke path), not radially.

**Class:** BUG. SS implements a "radial attractor", which is a different deformation primitive from Blender's Pinch.

---

## D-3 — HIGH — Pinch coefficient and asymmetric Magnify strength

**SS:** `src/lib/sculpt/pinch.js:29` + `:48-56`
- `const PINCH_RATE = 0.5;` — fixed coefficient.
- `const sign = ctrl ? -1 : 1;` — symmetric flip.
- `k = w * s * PINCH_RATE * sign;` — same magnitude for Pinch and Magnify.

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/mesh/sculpt.cc:2433-2439` (`brush_strength`)
```cpp
case SCULPT_BRUSH_TYPE_PINCH:
  if (flip > 0.0f) {                                                     // Pinch direction
    return alpha * flip * pressure * overlap * feather;
  }
  else {                                                                 // Magnify direction
    return 0.25f * alpha * flip * pressure * overlap * feather;          // 4× WEAKER
  }
```
- No fixed 0.5 magic number. Magnitude is `alpha * pressure * overlap * feather` (default `alpha=1.0, pressure≈1.0, overlap≈1.0, feather=1.0` → effective `1.0 * factor`).
- Magnify direction is **0.25× weaker** than Pinch direction (artistic balance: Magnify is destructive, Pinch is constructive).

**Difference.**
- SS: hard-coded 0.5 per-tick rate, identical Pinch and Magnify magnitude.
- Blender: rate derived from brush alpha + pressure + overlap (~all 1.0 by default → effective 1.0), Magnify is 25% of Pinch.

**Class:** DRIFT. Numbers are invented; no Blender citation supports `PINCH_RATE = 0.5`. The asymmetric Magnify coefficient is a documented Blender artistic choice that SS misses.

---

## D-4 — HIGH — Ctrl modifier locked at stroke begin (Blender) vs read per-tick (SS)

**SS:** `src/components/canvas/CanvasViewport.jsx:2870` (per-tick)
- `ctrl: e.ctrlKey || e.metaKey` is read on EVERY pointermove inside the sculpt branch (line 2870 of the post-diff file → "ctrl: e.ctrlKey || e.metaKey," in the brush.tick(...) call site).
- Means: hold Pinch, drag, then press Ctrl → verts mid-stroke flip from Pinch to Magnify.

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/paint_stroke.cc:868`
- `stroke_mode_ = BrushStrokeMode(RNA_enum_get(op->ptr, "mode"));` — read ONCE from the operator's `mode` enum (set by the modal keymap when LMB is pressed: `Normal` / `Invert` (Ctrl held at click) / `Smooth` (Shift held at click)).
- `mesh/paint_vertex.cc:401`: `toggle_settings.invert = stroke_mode == BrushStrokeMode::Invert || pen_flip;` — set once into `cache.toggle_settings.invert`, read everywhere downstream (e.g. `mesh/sculpt.cc:2312`).
- The modal handler (`paint_stroke.cc:1515-1530`) ONLY toggles GPencil's Smooth via Shift; Sculpt's Invert is locked.

**Difference.** Blender users get a stable per-stroke direction (no surprise mid-drag flips). SS users can flip mid-drag, which feels reactive but doesn't match Blender's stroke-locked semantics.

**Class:** BUG vs documented Blender behaviour. SS commit + module docs claim it "matches Blender's BRUSH_DIR_FLAG / SCULPT_TOOL_PINCH modal toggle" (a fabricated enum chain — see D-13), but the actual toggle is at click-time only.

**Workaround note.** If SS wants per-tick flexibility deliberately (Blender-divergence by intent), it should be classified INTENTIONAL DEVIATION with a clear note. Today the docs claim parity — it is not parity.

---

## D-5 — MED — Smooth iterations 1–10 slider invented

**SS:** `src/lib/sculpt/smooth.js:40` + `src/v3/shell/ToolSettingsPanel.jsx:181-189`
- `iterations = Math.max(1, Math.min(10, opts.iterations ?? 1));` — user-controlled 1..10.
- Outer loop iterates `iterations` times, each pass committing into a working buffer.

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/smooth.cc:34-48`
```cpp
static Vector<float> iteration_strengths(const float strength)
{
  constexpr int max_iterations = 4;
  const float clamped_strength = std::min(strength, 1.0f);
  const int count = int(clamped_strength * max_iterations);
  const float last = max_iterations * (clamped_strength - float(count) / max_iterations);
  Vector<float> result;
  result.append_n_times(1.0f, count);
  result.append(last);
  return result;
}
```
- Iterations are derived from `strength`: `int(strength * 4)` full-strength passes plus one partial-strength pass.
- `strength=0.25 → 1 full + 0 partial = 1 iteration`; `strength=0.5 → 2 + 0 = 2`; `strength=1.0 → 4 + 0 = 4`. Max 5 (4 full + 1 partial).
- DNA Brush has no `iterations` field for the standard Laplacian Smooth brush. (`pose_smooth_iterations` and `surface_smooth_iterations` exist for OTHER brushes — see `DNA_brush_types.h:375, 401`.)

**Class:** DRIFT. SS exposes a parameter Blender does not expose; reasonable customization but not Blender-faithful. The "Iterations 1-10" slider also implies 10 passes is meaningful, but a 10-iter Laplacian on a single tick will typically over-smooth dramatically.

---

## D-6 — MED — Default values invented

**SS:** `src/store/editorStore.js:181-188`
```js
sculpt: {
  activeBrush:   'grab',
  size:          80,
  strength:      0.5,
  falloff:       'smooth',
  iterations:    1,
  connectedOnly: false,
},
```

**Blender:** `reference/blender/source/blender/makesdna/DNA_brush_types.h:200-203, 218, 222-223, 246`
- `int size = 70;` (diameter in pixels)
- `float alpha = 1.0f;` (strength)
- `float jitter = 0.0f;`
- `int spacing = 10;` (% of size)
- `BKE_brush_curve_preset(brush, CURVE_PRESET_SMOOTH);` (default falloff = smooth) — `brush.cc:65`

**Difference.**
- SS `size=80` vs Blender DNA `size=70` — close but invented. Plan claims this is the default; Blender's is 70.
- SS `strength=0.5` vs Blender DNA `alpha=1.0` — meaningfully different. Note: Blender's effective stroke factor squares alpha (`alpha * alpha` at `mesh/sculpt.cc:2332`), so user-facing alpha=1.0 → stroke factor 1.0. With pre-shipped brush ASSETS (not in this clone), per-brush defaults can override; but the master DNA default for Sculpt would-be brushes is alpha=1.0.
- SS falloff default `'smooth'` correctly matches Blender's `CURVE_PRESET_SMOOTH`.

**Class:** DRIFT. Defaults are invented (or at minimum uncited).

---

## D-7 — MED — "Use Connected Only" applied to every brush

**SS:** `src/lib/sculpt/index.js:125-159` (`brushFalloffWeights`) + `editorStore.js:188` (`connectedOnly: false`)
- All three brushes (Grab/Smooth/Pinch) honour the `connectedOnly` flag — gates falloff weight calculation through a BFS reachable-set.

**Blender:** `reference/blender/source/blender/makesdna/DNA_brush_enums.h:392`
- `BRUSH_USE_CONNECTED_ONLY = (1 << 3),` is a real `flag2` bit on Brush.
- BUT — only consumer in the sculpt code is `mesh/sculpt_pose.cc:1931`:
  ```cpp
  const bool use_fake_neighbors = !(brush.flag2 & BRUSH_USE_CONNECTED_ONLY);
  ```
- Used for the `Pose` brush's IK chain "fake neighbors" topology resolution. Generic Grab / Smooth / Pinch don't read this flag at all.

**Difference.** SS exposes a per-brush "Connected Only" checkbox that Blender exposes only on the Pose brush. The behaviour SS implements (BFS-restrict the brush footprint) is plausible and useful, but it's invented — not citing the actual semantic Blender uses (Pose-IK fake-neighbor toggle).

**Class:** DRIFT (or arguably BUG since the SS plan claims this is "Blender's 'Use Connected Only' sculpt option"). The sculpt option exists but for a different brush and a different purpose.

---

## D-8 — MED — Per-pointermove dispatch vs `brush.spacing`-paced strokes

**SS:** `src/components/canvas/CanvasViewport.jsx:2823-2890`
- The sculpt branch fires inside `onPointerMove`. Every browser pointermove → one brush tick.

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/paint_stroke.cc:608-655` (`paint_space_stroke_spacing`) + `DNA_brush_types.h:223`
- `int spacing = 10;` (% of brush radius, default 10).
- Stroke advances at fixed spaced intervals along the cursor path: spacing-pixels apart per tick (≈ `size_clamp * spacing / 50.0` for VIEW units; line 655).
- Default: brush size 70, spacing 10% → tick every ~7 px of cursor travel. Below that, no tick.
- Above-threshold `paint_space_stroke` interpolates intermediate positions if cursor moved >1 spacing — guarantees uniform deposit density independent of mouse polling rate.

**Difference.** SS's per-pointermove dispatch makes deformation strength dependent on browser polling rate (60Hz → light, 240Hz pen → heavy). Blender's spaced stroke is rate-independent.

**Behavioural consequence.** Identical-shape strokes drawn at different speeds produce different deformations in SS (faster = fewer ticks = lighter deformation). Blender intentionally normalises this.

**Class:** DRIFT. Acceptable v1 simplification but documented gap should be tracked for v2.

---

## D-9 — LOW — Falloff curve set inherited from proportional-edit (7 of 10 curves)

**SS:** `src/lib/proportionalEdit.js:48` (`FALLOFF_CYCLE`) + reused in `src/lib/sculpt/index.js:127` and `ToolSettingsPanel.jsx:171-175`
- Exposes 7 curves: `'smooth' | 'sphere' | 'root' | 'linear' | 'sharp' | 'invSquare' | 'constant'`.

**Blender:**
- Proportional edit set: `PROP_SMOOTH | PROP_SPHERE | PROP_ROOT | PROP_LIN | PROP_CONST | PROP_RANDOM | PROP_SHARP | PROP_INVSQUARE` (`transform_generics.cc:1322-1356`) — 8 curves. SS omits `random` (intentional, per `proportionalEdit.js:42-44`).
- Brush `BRUSH_CURVE_*` set: `SHARP, SMOOTH, SMOOTHER, ROOT, LIN, CONSTANT, SPHERE, POW4, INVSQUARE, CUSTOM` (`blenkernel/intern/brush.cc:1486-1601`) — 10 curves. SS reuses the **proportional-edit** set, missing `smoother` (5th-order smoothstep) + `pow4` (quartic) + `custom` (free curve) for Sculpt.
- For each curve SS implements, the formula matches Blender (verified):
  - `'smooth'` (SS:69-71) = `3u² - 2u³` ↔ Blender `BRUSH_CURVE_SMOOTH` (`brush.cc:1517`) and `PROP_SMOOTH` (`transform_generics.cc:1331`). MATCH.
  - `'sphere'` (SS:72) = `sqrt(1 - t²)` ↔ Blender `sqrt(2*(1-t) - (1-t)²) = sqrt(1-t²)`. MATCH.
  - `'root'` (SS:73) = `sqrt(1-t)` ↔ Blender `sqrt(1-t)`. MATCH.
  - `'linear'` (SS:74), `'constant'` (SS:75), `'sharp'` (SS:76), `'invSquare'` (SS:77-81). All match (verified arithmetic).

**Class:** DRIFT (minor). SS is internally consistent (sculpt uses same curves as proportional-edit, easier UX) but Blender's Sculpt brush picker is a strict superset (includes `smoother`, `pow4`, `custom`).

---

## D-10 — LOW — Lucide icon picks weak for Smooth and Pinch

**SS:** `src/v3/shell/canvasToolbar/tools.js:184-211`
- Grab → `Hand` (Lucide). Reads as "open palm" — visually associates with grabbing/dragging. Acceptable.
- Smooth → `Smile` (Lucide). Reads as facial expression, not "blur / average / smooth". Misleading.
- Pinch → `Minimize` (Lucide). Reads as "shrink window / collapse". Approximates "pull together" but unclear; users will read this as a window control.

**Blender:** Custom SVG icon sheet at `reference/blender/release/datafiles/blender_icons16/` — `BRUSH_GRAB`, `BRUSH_SMOOTH`, `BRUSH_PINCH` (proper sculpt iconography: hand grabbing a vertex, brush smoothing a wave, two arrows pulling together).

**Suggested Lucide replacements** (do not fix — audit-only):
- Smooth → `Waves` (literal smoothing of waves) or `Eraser` (Blender Smooth's "erase noise" semantic) or `Spline` (curve smoothing).
- Pinch → `ChevronsLeftRight` (two arrows pointing toward center) or `Magnet` (already used for snap, but visually correct for "attract") or `Combine`.
- Grab → keep `Hand`.

**Class:** DRIFT. Low severity (purely cosmetic), but Smile/Minimize do not visually communicate the brush function.

---

## D-11 — LOW — Brush ring overlay deferred

**SS:** `src/components/canvas/CanvasViewport.jsx` — proportional-edit ring is gated on `editMode === 'edit'` (per progress doc line 122-126). Sculpt mode shows no cursor ring.

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/paint_cursor.cc:1255` (`paint_draw_cursor`) — always renders a circle at brush radius, tinted by brush colour. ALWAYS visible during sculpt strokes.

**Class:** INTENTIONAL deferral (acknowledged in progress doc). LOW severity, but absence makes the brush size slider unusable without trial-and-error.

---

## D-12 — LOW — N-panel section label "Sculpt" vs Blender's "Brush Settings"

**SS:** `src/v3/shell/ToolSettingsPanel.jsx:135` — `<SectionHeader label="Sculpt" />`.

**Blender:** `reference/blender/scripts/startup/bl_ui/space_view3d_toolbar.py:325, 1566, 1626, 1802` — every Sculpt-mode brush settings panel uses `bl_label = "Brush Settings"`. (Other panels in Sculpt mode use `bl_label = "Sculpt"` for non-brush settings, e.g. modifier list — different scope.)

**Class:** DRIFT. Minor labeling inconsistency.

---

## D-13 — LOW — Documentation references fabricated Blender enum names

Across the commit message, `src/lib/sculpt/pinch.js:17-18`, `src/lib/sculpt/index.js:?`, and `TOOLSET_PHASE_3_PROGRESS.md:38-39`:

| Citation in SS                              | Real Blender symbol                             |
|---------------------------------------------|-------------------------------------------------|
| `BRUSH_DIR_FLAG`                            | `BRUSH_DIR_IN` (`DNA_brush_enums.h:355`)        |
| `SCULPT_TOOL_PINCH`                         | `SCULPT_BRUSH_TYPE_PINCH` (`DNA_brush_enums.h:429`) |
| `SCULPT_TOOL_GRAB`                          | `SCULPT_BRUSH_TYPE_GRAB` (`DNA_brush_enums.h:431`)  |
| `SCULPT_TOOL_SMOOTH`                        | `SCULPT_BRUSH_TYPE_SMOOTH` (`DNA_brush_enums.h:428`) |
| `SCULPT_brush_strokes`                      | (does not exist — possibly meant `do_smooth_brush`) |

These were renamed across Blender 3.x → 4.x (`SCULPT_TOOL_*` → `SCULPT_BRUSH_TYPE_*`); SS docs reference the older / hallucinated names. Functionally harmless but undermines reviewer confidence that the implementation is actually Blender-faithful.

**Class:** BUG (documentation-only). Update doc strings + commit message wording before next ship.

---

## D-14 — INFO — Brush size in canvas-px is justified for 2D mesh

**SS:** `editorStore.js:178` — `size: 80` "screen-space radius in pixels". CanvasViewport converts to mesh-local at stroke start (`startSizeLocal = size / view.zoom`).

**Blender:** `DNA_brush_enums.h:366` (`BRUSH_LOCK_SIZE`) + `rna_brush.cc:2367-2371`:
- Two units: VIEW (pixels, default) and SCENE (Blender Units, when LOCK_SIZE flag set).
- Default for Image Paint 2D + Texture Paint = VIEW (pixels). Default for 3D Sculpt = also VIEW (locked size is opt-in).

**Verdict.** SS's pixel-unit choice is consistent with Blender's default. INTENTIONAL and Blender-aligned.

---

## D-15 — INFO — Pinch substitution for Inflate is correct

**SS:** Plan §3.E + commit message — "Pinch substituted for Inflate per audit; Blender's Inflate moves verts along the per-vertex normal which is degenerate on a flat 2D mesh."

**Blender:** `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/inflate.cc:60-76` — `calc_faces` gathers `vert_normals` and uses them as `translations`, scaled per-vert by brush factor.
- 2D mesh in canvas plane: all vertex normals point along canvas Z (out of screen). In-plane translation = 0. Verified.

**Verdict.** INTENTIONAL substitution, technically sound. Pinch is an excellent 2D-friendly replacement.

---

## Findings ranked by remediation impact

1. **Documentation cleanup (D-13)** — Costs nothing, removes false claims of Blender parity. Should be the first fix.
2. **Defaults alignment (D-6)** — Trivial number changes (`size: 80→70`, `strength: 0.5→1.0`, or document why SS deviates). Low-risk.
3. **Connected-only scope (D-7)** — Either remove from generic brushes (Blender-faithful) or document as SS-invented enhancement.
4. **Smooth iterations slider (D-5)** — Either delete the slider (Blender-faithful: derive from strength × 4) or document as SS enhancement.
5. **Ctrl-during-stroke vs lock-at-begin (D-4)** — Behavioural change, likely needs a separate audit-fix sweep.
6. **Pinch math redesign (D-2) + Grab math redesign (D-1)** — Substantial rewrites if true Blender parity is desired. Both currently implement different deformations than their Blender namesakes. If SS keeps the simpler radial + continuous semantics, it should rename "Grab" → "Drag" and "Pinch" → "Attract" (both more accurate to what the code does) and stop claiming Blender parity in module docs.
7. **Spaced stroke (D-8)** — Quality polish; affects per-stroke determinism on different input devices.
8. **Brush ring overlay (D-11)** — UX polish; cheap to add, materially improves usability.
9. **Falloff superset (D-9)** — Add `smoother`/`pow4`/`custom` only if SS expects to support sculpt-grade brush variety. Low priority for character rigging.
10. **Icon picks (D-10)** — One-line lookup-table change.
11. **Panel label "Sculpt" → "Brush Settings" (D-12)** — One-string change.

---

## Files referenced

- SS sources audited:
  - `src/lib/sculpt/index.js`
  - `src/lib/sculpt/grab.js`
  - `src/lib/sculpt/smooth.js`
  - `src/lib/sculpt/pinch.js`
  - `src/store/editorStore.js`
  - `src/v3/shell/ModePill.jsx`
  - `src/v3/shell/ToolSettingsPanel.jsx`
  - `src/v3/shell/CanvasToolbar.jsx`
  - `src/v3/shell/canvasToolbar/tools.js`
  - `src/components/canvas/CanvasViewport.jsx`
  - `src/lib/proportionalEdit.js`
- Blender reference reads:
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/grab.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/smooth.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/pinch.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/brushes/inflate.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/sculpt.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/sculpt_smooth.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/sculpt_pose.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/paint_stroke.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/paint_cursor.cc`
  - `reference/blender/source/blender/editors/sculpt_paint/mesh/paint_vertex.cc`
  - `reference/blender/source/blender/editors/transform/transform_generics.cc`
  - `reference/blender/source/blender/blenkernel/intern/brush.cc`
  - `reference/blender/source/blender/makesdna/DNA_brush_types.h`
  - `reference/blender/source/blender/makesdna/DNA_brush_enums.h`
  - `reference/blender/source/blender/makesrna/intern/rna_brush.cc`
  - `reference/blender/scripts/startup/bl_ui/space_view3d_toolbar.py`
