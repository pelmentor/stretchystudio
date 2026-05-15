# Session close-out — 2026-05-16
# Phase 2 BezTriple substrate (Slices 2.A + 2.C) + UI Blender-fidelity sweep ROUND 1 (F-1 / F-3 / F-4 / F-10) + ROUND 2 directive (F-2 + F-6)

## Status

Across the session this thread shipped **8 commits** + **3 close-out docs** + **4 background audits**. Test scoreboard at HEAD: 261/261 scripts green, typecheck clean. All commits pushed to `origin/master`.

| # | Commit | Thread | What landed |
|---|--------|--------|-------------|
| 1 | `24764d1` | Phase 2.A | Schema v39 — BezTriple keyform shape (field rename only) |
| 2 | `f8be651` | Phase 2.C | Full BezTriple evaluator + 30 named easings (Blender byte-faithful) |
| 3 | `6a1b468` | UI sweep R1 | F-3 Properties tab order + IDs + F-10 stale 'Skeleton Edit' copy |
| 4 | `4ec9349` | UI sweep R1 | F-4 Outliner Blender labels + OUTLINER_PT_filter popover |
| 5 | `b05e343` | UI sweep R1 | F-1 (architecture) per-area Header registry + OutlinerHeader + ViewportHeader |
| 6 | `51f13ea` | docs | Round 1 close-out doc |
| 7 | `ed7cf26` | UI sweep R2 | F-2 6 workspaces + F-6 Blender bTheme palette (per user direction) |
| 8 | this | docs | Final close-out doc + audit findings catalog (this file) |

Plus 4 background audit runs that produced 35+ ranked findings across the SS UI surface.

## User directives this session

After Phase 1.G dual-PSD acceptance gate closed in the prior session (`9f957b8`):

1. **"Go"** — pick a resume path. I asked once via AskUserQuestion → user invoked Rule №3 ("ask agents if lost"). Memory `feedback_question_agents_not_user.md` updated to extend Rule №3 to priority/scheduling forks.
2. **"Also stretchy studio needs a strong UI blender fidelity audit. And sweep after."** — triggered audit 1 + sweep round 1 (F-3 / F-4 / F-1 / F-10).
3. **"F2 - expand. F6 - blender. F8 - deferred for now. More ui blender fidelity audits. Documentize, prepare for compact."** — triggered audits 2/3/4 + sweep round 2 (F-2 / F-6) + this close-out.

## Thread A — Animation Phase 2 BezTriple substrate

Slice 2.A (`24764d1`) lands **schema v39** — converts every keyform from the legacy `{time, value, type?, easing?}` to Blender's full BezTriple-shape record `{time, value, handleLeft, handleRight, handleType, interpolation, flag}`. Both evaluators (`evaluateFCurve` depgraph + `interpolateTrack` animationEngine) converge on `kf.interpolation` as the segment-shape discriminator. Drops `type` + `easing` outright per Rule №2.

Slice 2.C (`f8be651`) lands the **full evaluator** — cubic-bezier inversion via Cardano's roots ported byte-faithfully from Blender's `solve_cubic` + `findzero` + `berekeny` + `BKE_fcurve_correct_bezpart` (`reference/blender/source/blender/blenkernel/intern/fcurve.cc:1377-1559`), plus 30 named easings (back/bounce/circ/cubic/elastic/expo/quad/quart/quint/sine × {in/out/inout}) ported from `reference/blender/source/blender/blenlib/intern/easing.cc`. Single shared module `src/anim/fcurveEval.js` so both eval paths can't drift again. Tests: 35 assertions in new `test_fcurveEval.mjs` + 43 in `test_migration_v39.mjs`.

### Phase 2 — what's left

| Slice | Status | Scope |
|-------|--------|-------|
| 2.D — Auto-handle calculator | pending | `fcurveHandles.js` helper for `auto` / `auto_clamped` per Blender's `BKE_fcurve_handles_recalc` |
| 2.G + 2.G.1 — motion3 import/export bezier round-trip | pending | Preserve cx1/cy1/cx2/cy2 control points → `handleLeft`/`handleRight` |
| 2.F + 2.H — Exit gate | pending | Round-trip 6 Cubism samples (Hiyori, Mark, Mao, Natori, Wanko, Mocchin) byte-identical |

## Thread B — UI Blender-fidelity sweep ROUND 1

Audit 1 (background agent, 10 findings); 5 swept this round, 5 deferred for direction.

### F-3 + F-10 (`6a1b468`) — Properties tab order + stale copy
- Tab id `'item'` → `'object'` (matches BCONTEXT_OBJECT enum at `space_buttons.cc:218`).
- Tab order: Object · Modifiers · Physics · Object Data · Bone (Physics moved BEFORE Data per Blender enum).
- New BCONTEXT_SEPARATOR-style divider before SS-specific tabs (Variant · Deformer · Parameter · Rig).
- 6 user-facing "Skeleton Edit" copy strings updated → "Pose Mode" / "armature filter".

### F-4 (`4ec9349`) — Outliner labels + OUTLINER_PT_filter popover
- Labels: `Armature Data` → `Armature`, `Rig Data` → `Deformer Graph`.
- New filter popover (Funnel icon) mirrors `OUTLINER_PT_filter` (`space_outliner.py:403`). Starter set: Show Selected Only + Hide Hidden.
- New `filterOutlinerTreeByPredicate` helper in `filters.js`.

### F-1 (`b05e343`) — Per-area Header registry (architecture)
- `EDITOR_REGISTRY` entries gain optional `header` slot.
- Outliner header lifted from in-body to `src/v3/headers/OutlinerHeader.jsx`. State source-of-truth promoted to `editorStore` (`outlinerMode`, `outlinerSearchQuery`, `outlinerShowSelectedOnly`, `outlinerHideHidden`).
- New `ViewportHeader` scaffold with mode label + View / Select / Object menus. All menu items dispatch through the existing operator registry (same code path as keymap dispatcher; menu + hotkey can never drift).

## Thread C — UI Blender-fidelity sweep ROUND 2 (per user direction)

### F-2 (`ed7cf26`) — Expand workspaces from 2 → 6

Blender General-template subset (no UV / Texture / Shading / Compositing / Geometry Nodes / Scripting — those don't apply to a 2D Live2D pipeline):

| Workspace | Areas |
|-----------|-------|
| **layout** (default — was `default`) | Outliner / Logs / Viewport+LivePreview / Parameters / Properties+NodeTree |
| **modeling** | Outliner / Viewport / Properties (focus on geometry) |
| **rigging** | Outliner / Viewport / Parameters / Properties (no LivePreview) |
| **weightPaint** | Outliner / Viewport / Properties (brush via N-panel) |
| **sculpt** | Viewport full-bleed / Outliner+Properties stacked right |
| **animation** | Outliner / Logs / Viewport+LivePreview / Parameters / Actions+Properties+NodeTree / Timeline+Dopesheet+FCurve |

Wire-ups:
- `WORKSPACE_IDS` operator registry expanded
- New `workspace.cycle.next` / `workspace.cycle.prev` operators
- Ctrl+Digit1..6 keymap (was Ctrl+Digit1..2)
- Ctrl+PageUp/Down workspace cycle (Blender's `screen.workspace_cycle` from `blender_default.py:823-825`)
- Topbar pill renders all 6 workspaces with descriptive tooltips

### F-6 (`ed7cf26`) — Blender bTheme palette ports

`blenderDarkPreset` ports `userdef_default_theme.c`:
- background `HSL(0,0%,19%)` ← 0x303030 area space
- foreground `HSL(0,0%,90%)` ← 0xe6e6e6 wcol text
- **primary `HSL(213,44%,49%)` ← 0x4772b3 Blender selection blue**
- border `HSL(0,0%,24%)` ← 0x3d3d3d outline
- popover `HSL(0,0%,11%)` ← 0x1d1d1d header_back
- secondary `HSL(0,0%,16%)` ← 0x282828 toolbar item
- chart palette tuned for keyframes/active/destructive/driver

`blenderLightPreset` mirrors `Blender_Light.xml`:
- background `HSL(0,0%,80%)` ← 0xcccccc panel_back
- primary `HSL(218,50%,60%)` ← 0x668ccc Blender Light selection blue

Both presets selectable from PreferencesModal → Color Preset (no default flip — opt-in per Rule №1).

### F-8 — Constraint stack UI

**Deferred per user direction** (this session). Needs backing data layer first (Constraints datablock model in projectStore). Out of scope until that lands.

## Audit findings catalog

The 4 audits this session produced **35+ ranked findings**. Round 1 audit picks already shipped above; Round 2 audits' 25 findings are catalogued here for the next sweep.

### Round 2 — Audit 2 (per-editor chrome) — 10 findings, 5 swept

Top 5 sweep picks from this audit:
1. **F2-1 — Lift 4 inline headers into `*_HT_header` registry slots** (Timeline / Dopesheet / FCurve / NodeTree). The F-1 architecture is in place; just need 4 new `*Header.jsx` files. **Cost: medium.**
2. **F2-2 — Timeline transport icon split** (REW / PrevKey / Play / NextKey / FF; auto-key dot to its own row above transport per `space_time.py:71-79`). Needs new `screen.keyframe_jump` operator. **Cost: small.**
3. **F2-3 — Dopesheet channel chrome** (mute + lock + filter strip per `space_dopesheet.py:30-44` + `:171-194`). Per-row toggles wire `fc.mute` / `fc.locked`. **Cost: medium.**
4. **F2-5 — NodeTree per-class colour bands + zoom-to-fit** (`Home` keybind). Map `nclass` enum to TH_NODE_* theme tokens per `node_draw.cc:1387-1432`. **Cost: medium.**
5. **F2-6 — Properties `defaultClosed` declaration + pin button** (per `DNA_screen_types.h:220-231` `ePanel_Flag.PNL_PIN`). Drag-reorder deferred. **Cost: medium.**

Bumped down (out of this round's scope):
- **F2-4 — F-Curve handle drag**: large; Normalize toggle alone is a small piece that can ride with F2-1.
- **F2-7 — AreaTabBar removal**: large architectural — collapse `area.tabs[]` → `area.editorType: EditorType` per Blender's per-area pattern.
- **F2-8 — NAV_BAR width tuning**: minor pixel polish.
- **F2-9 — Section-header typography**: minor visual polish.
- **F2-10 — Channel column splitter resize**: small QoL.

### Round 2 — Audit 3 (tools + N-panel) — 5 findings + 5 backlog

Top 5 sweep picks:
1. **`bToolRef` per-(workspace, mode) tool refs + delete `lastToolByMode` legacy normaliser**. Rule №2 violation — the rest is correctness debt. Mirror Blender's `bToolRef` shape verbatim per `DNA_workspace_types.h:69-115`. **Cost: medium.**
2. **N-panel `bl_category` tabbed sub-regions** (Item / View / Tool); fold the 6 ad-hoc canvas-overlay menus (ApplyMenu / MergeMenu / etc.) into proper panels. **Cost: medium-large.**
3. **Brush datablock**: replace flat `editorStore.sculpt` + flat weight-paint fields with `Brush` datablocks per `DNA_brush_types.h:192-442`. Drop or re-scope `connectedOnly` SS-invention. **Cost: medium.**
4. **`TOOL_HEADER` strip**: thin horizontal active-tool option strip beneath the topbar, driven by `tool.drawSettings(context)`. **Cost: small-medium.**
5. **Per-panel collapse + drop the right-edge chevron region-collapse stub**; relocate region toggle to the area header. **Cost: small.**

Backlog:
- Object-Mode Move/Rotate/Scale as sticky tools with gizmos (large).
- Edit Mode tool catalog expansion (most don't apply to 2D, but Edge Slide / Vertex Smooth / Rip Edge would be useful).
- Box / Lasso / Circle Select as sticky tools (currently Ctrl-LMB-drag gestures).

### Round 2 — Audit 4 (modal + global UX) — 5 findings + 8 things faithful

Top 5 sweep picks:
1. **Status bar** — single biggest UX hole. New `Footer.jsx` mirroring Blender's `STATUSBAR_HT_header` (`reference/blender/scripts/startup/bl_ui/space_statusbar.py:8-31`): input-status + reports-banner + jobs + status-info templates. Move modal G/R/S header echo to footer-left (currently centered floating HUD covers the work). **Cost: medium.**
2. **Right-click context menu** — RMB currently silently `preventDefault`s on canvas. New `ContextMenu.jsx` per editorMode mirroring `VIEW3D_MT_object_context_menu` / `VIEW3D_MT_edit_mesh_context_menu`. The 6 popover menus (Apply / Snap / Mirror / etc.) already exist as ops. **Cost: small-medium.**
3. **File menu** — replace 6-icon strip with proper dropdown mirroring `INFO_MT_file` (`space_topbar.py:157-215`): New / Open / Open Recent ▶ / Revert / Save / Save As / Save Copy / Import ▶ / Export Live2D / Preferences / Quit. Add `Ctrl+Shift+S` for Save As. **Cost: small.**
4. **Modal G/R/S chord fixes**:
   - `Shift+X` / `Shift+Y` plane lock-out (Blender's `TFM_MODAL_PLANE_X/Y/Z` from `transform.cc:656-658`).
   - Always-visible delta in HUD (currently only shown when typing).
   - Leading `=` prefix for numeric input mode.
   - `e.stopPropagation()` parity with vertex-modal sister.
   **Cost: small.** ~40 lines across 2 files.
5. **Preferences modal tabbed structure** — restructure to vertical Tabs mirroring `space_userpref.py`: Interface · Editing · Animation · Input · System · Save & Load · Experimental. Surfaces eval-engine selector + snap defaults + autosave (currently localStorage-only). **Cost: small-medium.**

Things that ARE faithful (don't re-touch):
- F3 command palette (`CommandPalette.jsx`) — matches `WM_OT_search_menu` UX faithfully.
- Modal RMB cancel — both modals correctly map RMB to cancel matching the LMB-select keyconfig preset.
- Modal axis-lock toggle — bare X/Y press toggles, matches Blender's `TFM_MODAL_AXIS_X` semantics.
- Modal numeric input + MOD_PRECISION (Shift) + MOD_SNAP_INV (Ctrl) inversion model.
- Snap target dot rendering + toast position + keymap chord precedence.

### Cross-audit sweep priority

**If user wants the highest-velocity follow-on sweep round 3**, ranked by user-impact / cost ratio:
1. **Audit 4 #3** — File menu dropdown (small, 1 file, immediately discoverable)
2. **Audit 4 #4** — Modal HUD chord fixes (small, 2 files, fixes muscle-memory regression)
3. **Audit 2 F2-1** — Lift 4 animation-editor headers into per-area Header slot (medium, mechanical)
4. **Audit 4 #2** — Right-click context menu (small-medium, leverages existing operators)
5. **Audit 4 #1** — Status bar (medium, high impact — surfaces selection count, modal echo, reports)

## Memory updates this session

- `feedback_question_agents_not_user.md` (Rule №3) — extended to cover priority/scheduling forks (clarified after the user invoked it on a 3-way resume-path question).

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1 (no quick-and-dirty fixes)
- `feedback_no_migration_baggage_rule_two.md` — Rule №2 (no migration baggage)
- `feedback_question_agents_not_user.md` — Rule №3 (question agents, not user)
- `feedback_blender_reference_strict.md` — Blender source IS the source of truth
- `feedback_test_character_is_shelby.md` — dual-PSD policy for byte-fidelity gates
- `project_blender_parity_plans_in_flight.md` — anchor memory
- `docs/plans/SESSION_CLOSEOUT_2026_05_16_PHASE2_BEZTRIPLE_AND_UI_SWEEP.md` — Round 1 close-out (predecessor, this session)
- `docs/plans/SESSION_CLOSEOUT_2026_05_12_PHASE_1G_GATE_CLOSED.md` — Phase 1.G gate close
- `docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` — Phase 2 substrate plan (Slices 2.A–2.H)

## Test scoreboard

- TSC clean across all 8 commits.
- Full suite via Node wrapper: 261/261 scripts green at HEAD.
- Notable script results:
  - `test:fcurveEval` (NEW): 35 passed
  - `test:migrationV39` (NEW): 43 passed
  - `test:animationEngine`: 61 passed (Slice 2.A + 2.C field-rename + named-easing assertions)
  - `test:animFCurveBridge`: 52 passed (Slice 2.A factory + buildParam/Node FCurve coverage)
  - `test:editorStore`: 87 passed (F-1 lifted outliner state + F-3 propertiesActiveTab default)
  - `test:uiV3Store`: 59 passed (F-2 6-workspace expansion)
  - `test:v3Operators`: 112 passed (F-2 9 built-in operators including cycle.next/prev)
  - `test:livePreviewWiring`: 18 passed (F-2 'layout' workspace key)
  - `test:themePresets`: 45 passed (F-6 blenderDark + blenderLight added with sibling parity)

## Resume paths post-compact

After this session's two-thread ship + 4 audits, four threads are queued:

### A. Animation Phase 2 BezTriple — Slices 2.D / 2.G / 2.H

Continuation of Thread A. Slice 2.D (`fcurveHandles.js` auto-handle calculator) is the next prerequisite for the Phase 5 editor UI; Slice 2.G + 2.G.1 unblock Cubism `.motion3.json` round-trip fidelity; Slice 2.H is the 6-sample byte-diff exit gate.

### B. UI sweep ROUND 3 — top picks from audits 2/3/4

5-pick priority list above. Recommend starting with Audit 4 #3 (file menu) + Audit 4 #4 (modal chord fixes) for immediate muscle-memory wins, then Audit 2 F2-1 (animation-editor headers) for architectural completion of the F-1 sweep.

### C. UI sweep — F-1 follow-on commits

- Lift ModePill into shared ModeSelector subcomponent (mount in both canvas overlay AND ViewportHeader)
- Properties / Timeline / Actions / NodeTree / FCurve / Dopesheet headers
- Add menu (needs node-creation operators per audit F-8)

### D. Audit deferred items

- F-2 (workspaces) — DONE this session per user direction
- F-5 (rename `'fcurve'` editor type → `'graph'`) — trivial, ride with next UI commit
- F-6 (theme palette) — DONE this session per user direction
- F-7 (`/` local-view keybind) — needs canvas rendering filter (separate work thread)
- F-8 (constraint stack) — DEFERRED per user direction (this session)
- F-9 (modal G/R/S verification) — overlaps Audit 4 #4 above
