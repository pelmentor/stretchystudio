# Session Close-out — 2026-05-10 (Phase 3 sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_10_PHASE2.md](./SESSION_CLOSEOUT_2026_05_10_PHASE2.md).
Earlier-day work: Animation Phase 0 (5/6 + armature port), Toolset
Phase 0 + Phase 1 + Phase 2, two audit-fix sweeps. This sub-session
shipped Toolset **Phase 3 + Phase 3 audit-fix sweep** (third audit
sweep of the day). Branch clean at `22a128b`.

## What shipped this sub-session (2 commits)

### Toolset Blender-Parity Plan — Phase 3 + audit-fix

Sculpt Mode + 3 Blender-faithful brushes:

| Commit  | What |
|---------|------|
| `fa17a46` | Phase 3 initial — `editorStore.sculpt` slot, `lib/sculpt/{index,grab,smooth,pinch}.js`, ModePill row, T-panel sculpt brush picker (new `kind: 'sculpt_brush'`), N-panel SculptSection, CanvasViewport pointer dispatch with one-undo-per-stroke batching, 4 test files (91 assertions). |
| `22a128b` | Phase 3 audit-fix sweep — 7 HIGH (3 arch + 4 Blender) + 12 MED/LOW gaps closed. Grab rewritten to anchored Blender semantics, Pinch rewritten to stroke-aligned 2D squeeze, Magnify asymmetric (0.25× weaker), Ctrl locked at LMB-press. **G-1 facade fix is the headline** — `editorRef.current` migrated to subscribe-driven full-store ref, closing the latent dead-UI bug for sculpt + 3 pre-existing latent gaps (Phase 0 toolMode, Edit-Mode brushHardness, animation autoKeyframe). 112 total assertions in 5 suites. |

## Audit-fix sweep details (`22a128b`)

Two independent agents (architecture + Blender-fidelity) audited
`fa17a46` and surfaced 12+15 = 27 gaps. All 7 HIGH addressed.

### Architecture HIGH

- **G-1 (CRITICAL)** — Sculpt brush picker / size / strength / falloff
  / iterations / connectedOnly were ALL dead UI. The `editorRef.current`
  facade introduced by perf commit `a21fc2e` (2026-05-09) didn't carry
  the new `sculpt` slot, so per-tick reads silently fell back to
  defaults (always Grab brush at size 80, strength 0.5, smooth
  falloff). Same facade gap also broke `toolMode` (Phase 0 vertex-select
  toolbar dead), `brushHardness` (Edit-Mode brush hardness slider read
  NaN), `autoKeyframe` (animation auto-key never fired). Fixed by
  migrating `editorRef.current` to `useEditorStore.subscribe()`-driven
  full-store ref (sister to existing `animRef.current` pattern at
  [CanvasViewport.jsx:256-257](../../src/components/canvas/CanvasViewport.jsx#L256)).
  All four pre-existing gaps closed in one motion.
- **G-2** — Sculpt in Animation editor permanently corrupted rest mesh
  (no `draftPose` route — sculpt is rest-mesh-only). ModePill row now
  disables when `editorMode === 'animation'` with hint; onPointerDown
  adds safety net `getEditorMode() !== 'animation'`.
- **G-3** — GPU upload was reading stale `projectRef.current` post-
  `updateProject` (1-frame visual lag every tick). Refactored sculpt
  onPointerMove to mirror Edit-Mode brush: build `newVerts` in-memory,
  upload to GPU, THEN `updateProject`.

### Blender-fidelity HIGH

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
  grab_delta; Z-axis projection drops to 0 in 2D plane. Stationary
  cursor → no pinch (early-return). Rewritten to match Blender
  (`mesh/brushes/pinch.cc:39-60, 191-204`).
- **D-3** — Pre-fix Pinch used uniform `PINCH_RATE = 0.5` for both
  Pinch and Magnify directions. Blender's `brush_strength` returns
  `0.25 * alpha * pressure * overlap * feather` for Magnify direction
  (`mesh/sculpt.cc:2433-2439`) — 4× weaker than Pinch. Now: Pinch
  direction = full strength × PINCH_RATE; Magnify (Ctrl) direction
  = -0.25× (sign flip + 0.25 magnitude).
- **D-4** — Pre-fix dispatch read `e.ctrlKey` per-tick, allowing
  mid-stroke Pinch ↔ Magnify flip. Blender's `paint_stroke.cc:868`
  reads `RNA_enum_get(op->ptr, "mode")` ONCE at LMB-press; the modal
  handler doesn't toggle invert mid-stroke. Captured as
  `dragRef.ctrlAtStart` at pointerdown.

### MED / LOW

- **G-4** — Mode-change abort guard at top of per-tick brush dispatch.
- **G-7** — K-dispatch gated on `wasSculpt = dragRef.current.mode ===
  'sculpt'` (sculpt has no draftPose to commit).
- **G-8** — Shipped `test_sculpt_undo.mjs` (11 assertions).
- **G-10/11/12** — UV snapshot moved to dragRef setup; dead fields
  dropped (imageWidth/Height/startZoom); misleading comment removed.
- **D-10** — Lucide icons swapped: `Smile` → `Waves` (Smooth);
  `Minimize` → `ChevronsLeftRight` (Pinch).
- **D-12** — N-panel section label `"Sculpt"` → `"Brush Settings"`.
- **D-13** — Fabricated Blender enum names (`BRUSH_DIR_FLAG`,
  `SCULPT_TOOL_PINCH`, `SCULPT_brush_strokes`) scrubbed.

### Documented as SS-intentional deviations (per audit recommendation)

- **D-5** — Smooth iterations 1–10 slider (Blender derives from
  `int(strength × 4)`). KEPT as SS enhancement; module doc flags.
- **D-6** — Defaults `size: 80, strength: 0.5` (Blender DNA: `70 / 1.0`).
  KEPT as SS choice — smaller/gentler defaults for 2D character canvas.
- **D-7** — `connectedOnly` per-brush (Blender restricts to Pose brush
  only). KEPT as SS enhancement; useful for limiting brush to one
  mesh component during character editing.

### Deliberately deferred (LOW, per Rule №1 — proper or nothing)

- **G-5** — sculpt distance test uses rest verts but cursor projected
  through deformed iwm (frame mismatch on bone-skinned parts).
  Documented as "Sculpt is rest-mesh-only; for posed characters,
  exit Pose Mode first".
- **G-6** — `iwm` cached at stroke begin goes stale if anim playback
  advances mid-stroke. Now blocked by G-2 (sculpt forbidden in Animation
  editor); driver-driven transform updates remain a theoretical concern.
- **G-9** — `originIdx` for connectedOnly has no max-distance cutoff
  (perf-only).
- **D-8** — Per-pointermove dispatch vs `brush.spacing`-paced strokes.
  Acceptable v1 simplification; documented in plan §3.
- **D-11** — Brush ring overlay during sculpt strokes. UX polish, not
  a correctness gap.

## Audit docs on disk

- [AUDIT_2026_05_10_TOOLSET_PHASE3_ARCH.md](./AUDIT_2026_05_10_TOOLSET_PHASE3_ARCH.md) — 12 gaps, 3 HIGH addressed
- [AUDIT_2026_05_10_TOOLSET_PHASE3_BLENDER.md](./AUDIT_2026_05_10_TOOLSET_PHASE3_BLENDER.md) — 15 gaps, 4 HIGH addressed

## Test scoreboard

All 5 sculpt suites green; all adjacent suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| sculpt_grab (rewritten for anchored semantics) | 26 |
| sculpt_smooth | 20 |
| sculpt_pinch (rewritten for stroke-aligned semantics) | 20 |
| sculpt_store | 35 |
| **sculpt_undo (NEW)** — empty-tick-1, all-empty stroke, isolation | 11 |
| **Phase 3 total** | **112** |
| editorStore | 87 |
| canvasToolbar | 104 |
| modeCompat | 78 |
| proportionalEdit | 52 |
| audit_fixes_2026_05_10 | 23 |
| modalTransformTyped | 11 |
| undoHistory | 22 |
| vertexSelection_basic | 28 |
| snap_gesture_model | 18 |

## Pre-existing latent fixes (G-1 side effects)

The G-1 facade rewrite to `useEditorStore.subscribe()`-driven `editorRef`
also closed three latent gaps that pre-dated Phase 3. These were silently
broken since perf commit `a21fc2e` (2026-05-09):

- **Phase 0 Edit-Mode toolbar tools** (`select` / `add_vertex` /
  `remove_vertex`) — `toolMode` was `undefined` in the dispatch,
  silently falling through to brush. Now read correctly.
- **Edit-Mode brush hardness slider** — `brushHardness` was `undefined`
  → `brushWeight(dist, radius, undefined)` returned NaN → brush effects
  were degenerate. Now read correctly.
- **Animation auto-keyframe** (`autoKeyframe` slot from BFA-002) — was
  silently never firing because the facade dropped it. Now read
  correctly. Note: not directly tested in this sweep; user should
  verify in animation manual gate.

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged from previous close-outs. The depgraph is coherent
post-audit-fix #1; the Phase 0.D flag flip is gated only on the
user-side manual byte-fidelity sweep on Shelby + test_image4 PSDs.

1. Toggle `preferencesStore.evalEngine = 'depgraph'` in app.
2. Load `shelby_neutral_ok.psd` + `test_image4.psd`.
3. Verify visually + export `.cmo3` and byte-diff against `'classic'`
   baseline.
4. Flip [preferencesStore.js:163](../../src/store/preferencesStore.js#L163)
   default `'classic'` → `'depgraph'`. Keep classic opt-out one
   release.

### B. Toolset Phase 2.G + 3.J manual gates (user-blocking)

Phase 2 + Phase 3 are fully shipped + audit-fixed. Browser-side smoke
tests remain.

**Phase 3.J highlights** (full checklist in
[TOOLSET_PHASE_3_PROGRESS.md](./TOOLSET_PHASE_3_PROGRESS.md) §"Manual gate"):

- N-panel "Brush Settings" section visible; brush picker + size +
  strength + falloff + iterations (Smooth-only) + connected-only.
- **Picker is live** (G-1 fix): change brush → next stroke uses new
  brush math; change size → next stroke uses new footprint.
- **Anchored Grab**: click on a feature → drag → entire feature
  patch translates as a unit; wandering cursor doesn't pick up new
  verts. Release + re-click on different feature → new patch grabs.
- **Stroke-aligned Pinch**: click-drag ALONG a hairline → verts on
  either side pinch toward the line (sharpens it). Stationary cursor
  click-hold → no pinch.
- **Ctrl-at-click for Magnify** (D-4): start with Ctrl held → Magnify;
  releasing Ctrl mid-stroke does NOT flip back to Pinch.
- **Animation gate** (G-2): switch to Animation editor → Sculpt Mode
  row in ModePill is disabled with hint.
- **One stroke = one undo entry**: drag, release, Ctrl+Z → mesh
  restores to pre-drag state in one step.

### C. Toolset Phase 4 — Merge / Dissolve / Subdivide (~1 week)

Next autonomous chunk per plan. New mesh-edit operators (V key for
merge, X for dissolve, Ctrl+Subdivide for subdivision). See
[TOOLSET_BLENDER_PARITY_PLAN.md §Phase 4](./TOOLSET_BLENDER_PARITY_PLAN.md).

### D. Manual browser gates 0.H + 1.F + 2.G + 3.J (still pending user)

Should be verified before further phases ship. Now four manual gates
queued. Phase 3.J adds the brush picker + anchored Grab + stroke-aligned
Pinch + Magnify-on-click checks (above).

## Hotkey reservations across both plans

Unchanged. Sculpt Mode adds no new hotkeys (brushes selected via
T-panel + N-panel picker; chord-based brush switching deferred to
v2 polish).

- `I` = Insert Keyframe (animation Phase 6)
- `B` = Box Select (toolset Phase 1) ✅ shipped
- `C` = Circle Select (toolset Phase 6)
- `Shift+X` = Sample Weight (toolset Phase 7.B)
- `Ctrl+Shift+M` = Pose select-mirror (Blender-faithful)
- `Ctrl+Shift+V` = Mirror Pose (paste-flipped, Blender-faithful)
- `Ctrl+N` NOT bound (collides with Blender File New)
- `Alt+Shift+G/R/S` = Clear All Pose per-axis (3 separate chords,
  Blender-faithful)
- ⚠️ `Shift+S` reserved for Phase 7.A toolbox — collides with
  Blender's `VIEW3D_MT_snap_pie`; revisit binding before Phase 7
  ships

## Day-end commit chain (14 commits across three sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| 1 | `ec5d7d3` | anim 0.A — gridLift / depgraph build-relation fix |
| 2 | `ad7f26a` | anim 0.B — driver pass wired into CanvasViewport tick |
| 3 | `0386a6a` | anim 0.C — TRANSFORM_COMPOSE op |
| 4 | `c8f86f3` | anim 0.D.0 — depgraph wired into CanvasViewport rAF |
| 5 | `bc8a875` | anim 0.D armature port — bone post-chain inside ART_MESH_EVAL |
| 6 | `10ecaa8` | docs(plan) — Phase 0 close-out |
| 7 | `4a59d62` | toolset Phase 0 — vertex selection model in Edit Mode |
| 8 | `f7fba11` | toolset Phase 1 — box / lasso select |
| 9 | `ee2b1c5` | audit-fix sweep #1 — 6 HIGH + 2 MED + doc-drift |
| 10 | `6a8b5d3` | session close-out (mid-day) |
| 11 | `5b81205` | toolset Phase 2 — snap during transform (initial) |
| 12 | `980da3e` | audit-fix sweep #2 — Phase 2 dual audit (5 HIGH + 4 MED) |
| 13 | `9c3a906` | docs(plan) — Phase 2 sub-session close-out |
| 14 | `fa17a46` | toolset Phase 3 — Sculpt Mode + 3 brushes |
| 15 | `22a128b` | audit-fix sweep #3 — Phase 3 dual audit (7 HIGH + 12 MED/LOW) |
