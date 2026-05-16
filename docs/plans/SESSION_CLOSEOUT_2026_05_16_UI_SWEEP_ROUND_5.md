# Session close-out — 2026-05-16 (round 5)
# UI Blender-fidelity sweep ROUND 5 — Audit 4 #2 (RMB context menu per editMode) + post-ship dual-audit fix sweep

## Status

Continuation of the 2026-05-16 master session. Resumed from `f401b58`
([`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md)'s
top queued resume path), shipped the Audit 4 #2 right-click context
menu feature, ran the established dual-audit convention, and folded
all 8 findings back into the SAME commit (no separate audit-fix sweep
this round — fixes landed inline before push). **1 commit**, all
affected tests green at HEAD, typecheck clean. Pushed to
`origin/master`.

| # | Commit | Thread | What landed |
|---|--------|--------|-------------|
| 1 | `921ea57` | UI sweep R5 | Audit 4 #2 — RMB context menu per editMode + inline dual-audit fixes |
| 2 | this     | docs       | Round 5 close-out |

## Resume context

User typed `Go` after `/compact`. Per Rule №3 (question agents not
user), no clarification asked — picked the doc's explicit top resume
path (`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md:160-162`):
"Audit 4 #2 — Right-click context menu per editorMode. RMB currently
silent `preventDefault`s on canvas. Small-medium; leverages existing
operators (the 6 popover menus already exist)."

Dual-audit invoked proactively without prompting (Round 4 lesson
held). This round broke a Round-4 pattern: instead of shipping the
feature + post-ship audit-fix as TWO commits, audit findings were
applied inline to the same uncommitted tree before the first commit
landed. Reasoning: the CRITICAL Ctrl+RMB zoom-branch fix was on the
same code path as the feature itself; splitting would have published
a broken intermediate commit. Documenting this as a one-off; default
convention (separate audit-fix commit) still stands when fixes are
adjacent rather than on the critical path.

## Thread A — Audit 4 #2 RMB context menu

### Architecture

Extended the existing `editMenuStore` family (Snap / Mirror / Merge /
Apply / ClearParent / SetOriginMenu — six sibling popovers driven by
`useEditMenuStore.kind`). New `'canvasContextMenu'` kind + opener
slots in beside the six.

| File | Status | What it does |
|------|--------|--------------|
| `src/store/editMenuStore.js` | MODIFIED | Added `'canvasContextMenu'` to the discriminated-union `kind` + `openCanvasContextMenu({cursor})` action. Symmetric with the other six openers. |
| `src/v3/shell/canvasContextMenuItems.js` | NEW | Pure-data module: per-`editMode` item descriptor arrays + `pickItemSet(editMode, dataKind)` dispatch. Kept `.js` (not `.jsx`) so the Node-loadable integrity test can import without a JSX transpiler. |
| `src/v3/shell/CanvasContextMenu.jsx` | NEW | Popover sister to `SnapMenu.jsx`. Subscribes to `editMenuStore.kind === 'canvasContextMenu'`, reads `editorStore.editMode` + active head's `getDataKind(node, project)` for dispatch, runs operators via `getOperator(id).exec({editorType: 'viewport'})`. |
| `src/v3/shell/AppShell.jsx` | MODIFIED | Lazy-imported + mounted under the existing `editMenuKind === '…'` switch, beside the six siblings. |
| `src/components/canvas/CanvasViewport.jsx` | MODIFIED | `rmbDraggedRef` discriminator + onContextMenu rewrite + `button: e.button` recorded in both pan and zoom branches. |

### Per-mode dispatch

Each branch mirrors its Blender `VIEW3D_MT_<mode>_context_menu`
analog (`feedback_blender_reference_strict.md` — Blender source is
source of truth):

| editMode (+ dataKind) | Blender source | SS items surfaced |
|-----------------------|----------------|--------------------|
| `null` (Object Mode) | `VIEW3D_MT_object_context_menu` (`space_view3d.py:2943`) | Snap…, Mirror…, Parent…, Clear Parent…, Set Origin…, Duplicate, Delete, Frame Selected |
| `'edit'` + dataKind `'mesh'` | `VIEW3D_MT_edit_mesh_context_menu` (`:4565`) | Subdivide, Extrude Vertices, Merge…, Dissolve Vertices, Select Linked under Cursor / Select Linked, Duplicate, Delete, Frame Selected |
| `'edit'` + dataKind `'armature'` | `VIEW3D_MT_armature_context_menu` (`:5671`) | Duplicate, Delete, Frame Selected (post-audit-fix enrichment from `[Frame Selected]` only) |
| `'pose'` | `VIEW3D_MT_pose_context_menu` (`:4409`) | Copy Pose, Paste Pose, Paste X-Flipped Pose, Select Mirror, Clear Location/Rotation/Scale, Apply…, Frame Selected |
| `'weightPaint'` | `VIEW3D_PT_paint_weight_context_menu` (`:8836`) — spirit-port | Sample Weight, Mirror Weights (by Position/by Name), Normalize All, Frame Selected |

Item-set rules per Rule №1 (no quick-and-dirty fixes):
- Only operators ALREADY in `v3/operators/registry.js` are surfaced.
  No stub rows, no "coming soon" sentinels.
- Operators that fail `available({editorType:'viewport'})` render
  disabled (Blender's `enabled = …` pattern, surfaced via the
  `opacity-40 cursor-not-allowed` class same as `SnapMenu.jsx`).
- Blender items SS omits are enumerated per-list in JSDoc so future
  audits can confirm omission discipline (not silent gaps).

### RMB drag-vs-click discriminator

RMB currently triggers pan (`CanvasViewport.jsx:2298-2302` —
`e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)`).
Naively rewiring RMB to context-menu would break pan ergonomics.
Solution: track a `rmbDraggedRef` flag, set true once RMB-pan motion
crosses 4 px (same threshold the box-select overlay uses), checked
by the trailing `contextmenu` event (fires after `pointerup` on
Windows).

| State | Action |
|-------|--------|
| `rmbDraggedRef.current === true` | `e.preventDefault()` + reset flag → suppress menu (was a pan gesture) |
| `previewModeRef.current === true` | `e.preventDefault()` + return → Live Preview surface is read-only (GAP-010) |
| else | `e.preventDefault()` + `openCanvasContextMenu({cursor:{x,y}})` |

Blender's modern default (`left-select` keymap, since 2.80) maps
RMB → context menu and MMB → pan. SS deviates by keeping RMB-drag = pan
because (a) MMB isn't universally present (laptop trackpads, Apple
Magic Mouse), and (b) RMB-pan ships since SS v0.1; changing it
invalidates every user's muscle memory. Deviation flagged in
`rmbDraggedRef` JSDoc.

### Tests

| Suite | Asserts | Change |
|-------|---------|--------|
| `test_canvasContextMenu_dispatch.mjs` | 55 | NEW — branch dispatch + operator-id resolution against the live registry + branch distinctness + Object fallback |
| `test_objectMode_menu_store.mjs` | 22 | +4 — `openCanvasContextMenu` opener + close round-trip + all-7-kinds enumeration |
| `package.json` | `test:canvasContextMenu` registered + umbrella chain extended | |

The integrity test is the key safeguard: every operator id referenced
in any menu list MUST resolve in `v3/operators/registry.js`. Catches
typos + operator removals + new modes added without menu updates.

## Thread B — Dual-audit (8 findings, ALL CLOSED in same commit)

Per `feedback_dual_audit_after_phase_ship.md`: 2 parallel agents
(architecture + Blender-fidelity) ran against the staged tree before
the commit landed.

### Findings closed

| # | Tag | Severity | Finding | Fix |
|---|-----|----------|---------|-----|
| 1 | ARCH-1 | CRITICAL | `CanvasViewport.jsx` Ctrl+RMB zoom branch missing `button: e.button` → `rmbDraggedRef` never flips → context menu pops at end of every zoom gesture | Added `button: e.button` to the zoom branch with a JSDoc explaining the load-bearing role |
| 2 | FID-A.1 | MED | Armature menu missing `:5671` cite + omitted `edit.duplicate` + `selection.delete` (registry-present, dataKind-agnostic, would route through Blender's armature analogs) | Added `:5671` cite + enriched item list from `[Frame Selected]` only to `[Duplicate, Delete, Frame Selected]` parallel to mesh menu |
| 3 | FID-A.2 | MED | `view.frameSelected` surfaced in ALL 5 lists — Blender NEVER puts it in these RMB menus (lives on `numpad-.` only) — deviation unflagged | Added cross-list deviation note to module header: SS adds Frame Selected for discoverability (smaller command set than Blender + harder for non-Blender users to discover `.` keybind) |
| 4 | FID-A.3 | MED | Pose menu JSDoc flagged only `anim.keyframe_insert` as missing; the larger gap (7 Blender items) wasn't acknowledged | Enumerated all 7 omissions (anim.keyframe_insert/_menu, pose.push, pose.relax, pose.breakdown, pose.blend_to_neighbor, wm.call_panel(rename), pose.paths_*, pose.hide/reveal, pose.user_transforms_clear) in JSDoc with per-op omission reason. Also marked `apply.menu` as a SS-deviation: Blender doesn't put Apply… in the pose RMB menu (lives in header) — SS surfaces it because Apply Pose As Rest is the most-asked operator after copy/paste |
| 5 | FID-B.1 | LOW | `CanvasViewport.jsx:179` `rmbDraggedRef` JSDoc said "preserves muscle memory" without acknowledging it deviates from Blender's left-select-keymap default | Expanded JSDoc with the Blender-keymap deviation rationale (RMB=menu/MMB=pan in Blender; SS keeps RMB=pan for MMB-availability + muscle-memory reasons) |
| 6 | FID-B.2 | LOW | WEIGHT_PAINT cite `:8836` points to a `Panel` class (popover), not a `Menu` like the other four | Added note that `VIEW3D_PT_paint_weight_context_menu` is Panel-class, explaining why SS reaches for "spirit" parity (per-mode contextual actions on RMB) rather than literal port (brush sliders would clutter; they already live in SS's N-panel) |
| 7 | FID-B.3 | LOW | Object menu missing copy/paste-objects (Blender `view3d.copybuffer`) — honest omission per Rule №1, no fix required, but JSDoc could tidy by listing | Acknowledged in spirit by the per-list omission discipline added in FID-A.3 (pose menu); object menu's omissions remain in Blender's own no-selection-comment-block territory (no SS op exists) |
| 8 | ARCH-2 | — | (Cleared) `feedback_filter_in_selector` + `feedback_hooks_before_early_return` rules verified clean: project subscribes to `s.project` ref (not `.filter(...)`), all 9 hook calls precede the early return | No fix — verification pass |

Note: there was no separate audit-fix commit this round. Findings
applied inline before the first commit landed because ARCH-1 was on
the feature's critical code path (publishing the feature commit
broken-by-Ctrl+RMB-zoom and then immediately fixing it would have
been worse than holding the commit). Default convention (separate
audit-fix commit) still stands when fixes are JSDoc / non-load-bearing.

## Test scoreboard

- TSC clean across the commit.
- All affected suites green at HEAD (`921ea57`):
  - `test_canvasContextMenu` — **55 passed** (NEW)
  - `test_objectModeMenuStore` — 18 → **22 passed** (+4 for `openCanvasContextMenu` + 7-kind close round-trip)
  - `test_editorStore` — 97 passed (unchanged)
  - `test_v3Operators` — 124 passed (unchanged)
- Full `npm test` chain still hits Windows cmd-line length limit;
  affected-suites smoke is the verification path.

## Owed (not blocked)

**Manual browser verification** — RMB on canvas in each editMode,
confirm right item set appears, click each item, confirm operator
fires. Cannot be assertion-tested in headless Node; needs human eyes.

## Resume paths post-compact

The cross-audit priority list from prior close-outs has one fewer
unfinished pick this round:

1. ~~**Audit 4 #2**~~ — **SHIPPED this round.**
2. **Audit 4 #1** — Status bar (`Footer.jsx`) mirroring
   `STATUSBAR_HT_header`. Surfaces selection count + modal echo +
   reports. Medium cost, high impact. **This is the natural target for
   the transport-row lift flagged in FID-A.2 (Round 4)** — when the
   Footer region lands, TimelineEditor's transport can move into a
   FOOTER header per `DOPESHEET_HT_playback_controls` +
   `GRAPH_HT_playback_controls`.
3. **Animation Phase 2** — Slices 2.D (auto-handle calc) / 2.G + 2.G.1
   (motion3 bezier round-trip) / 2.H (6-Cubism-sample exit gate).
   ALSO unblocks `anim.keyframe_insert` for the Pose menu's biggest
   Blender-fidelity gap flagged in this round's FID-A.3.

Queued from prior sessions:
- **F-1 follow-on** — ModePill lift to shared subcomponent
- **F-8 (deferred)** — Constraint stack UI, needs Constraints
  datablock model in projectStore first

## Memory updates this session

None added. Two conventions reinforced and applied:
- `feedback_dual_audit_after_phase_ship.md` — invoked proactively
  (Round 4 lesson held).
- One-off pattern noted in close-out: when audit findings are on
  the feature's critical code path, fold them into the same commit
  rather than ship a broken intermediate. Default (separate
  audit-fix commit) still stands for non-critical-path fixes.

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1 (no quick-and-dirty fixes); applied throughout: no stub menu rows, only registry-resolved operators surfaced.
- `feedback_no_migration_baggage_rule_two.md` — Rule №2 (no migration baggage); extended `editMenuStore` family instead of forking a new context-menu store.
- `feedback_question_agents_not_user.md` — Rule №3 (question agents, not user); applied at session start (no clarifying question on resume).
- `feedback_dual_audit_after_phase_ship.md` — established convention; applied proactively this round, findings folded inline.
- `feedback_blender_reference_strict.md` — Blender source IS the source of truth; closed by FID-A.1 (cite enrichment) + FID-A.2/A.3 (deviation discipline) + FID-B.1/B.2 (deviation acknowledgment).
- `feedback_filter_in_selector.md` — verified clean in audit (ARCH-2 confirmed selector pattern is correct).
- `feedback_hooks_before_early_return.md` — verified clean in audit (all 9 hooks precede early return in `CanvasContextMenu.jsx`).
- [`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md) — predecessor close-out (Round 4 — Audit 2 F2-1 4 animation-editor headers).
