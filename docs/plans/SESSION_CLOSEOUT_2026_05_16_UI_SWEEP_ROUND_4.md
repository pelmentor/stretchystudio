# Session close-out — 2026-05-16 (round 4)
# UI Blender-fidelity sweep ROUND 4 — Audit 2 F2-1 (4 animation-editor headers) + post-ship dual-audit fix sweep

## Status

Continuation of the 2026-05-16 master session. Resumed from `baf5407`
(`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_3.md`'s top queued resume
path), shipped the F2-1 architecture-continuation finding, then ran
the established dual-audit-after-phase-ship convention and closed 6
of 8 findings (1 verified-clean, 1 deferred). **3 commits**, all
affected tests green at HEAD, typecheck clean. All pushed to
`origin/master`.

| # | Commit | Thread | What landed |
|---|--------|--------|-------------|
| 1 | `2f77a26` | UI sweep R4 | F2-1 — 4 animation-editor headers lifted into per-area Header slot |
| 2 | `0866e5a` | audit-fix  | Post-ship dual-audit sweep — 6 findings closed (2 arch + 4 fidelity), 1 cleared via verification |
| 3 | this     | docs       | Round 4 close-out |

## Resume context

User typed `Go` after `/compact`. Per Rule №3 (question agents not user),
no clarification asked — picked the doc's explicit top resume path:
"Audit 2 F2-1 — Lift 4 animation-editor headers (Timeline / Dopesheet /
FCurve / NodeTree) into per-area Header slot. Medium cost, mechanical
work on the F-1 architecture this session shipped."

After shipping commit #1 ran the dual-audit per
`feedback_dual_audit_after_phase_ship.md` proactively — this time
without user prompting, applying the lesson from Round 3 where the
audit ran only after the user pointed it out. Memory reinforcement
held: re-read the dual-audit memory before the close-out doc.

## Thread A — F2-1 (4 animation-editor headers)

Mechanical continuation of F-1 (`b05e343`). F-1 shipped the per-area
Header registry slot + the OutlinerHeader + ViewportHeader scaffolds;
F2-1 ships the 4 animation-editor headers using the same slot.

### Headers added

Each new file mirrors its Blender `*_HT_header` Python class
(`feedback_blender_reference_strict.md` — Blender source is source of
truth):

| File | Blender source | What it contains |
|------|----------------|------------------|
| `src/v3/headers/TimelineHeader.jsx` | `DOPESHEET_HT_header` TIMELINE branch (`space_dopesheet.py:208-217` + `:401-414`) | Clock icon + "Timeline" name + active-action subtitle (frame range · fps) + View menu (Frame Selected). Transport row STAYS in-body (Blender embeds playback_controls in same header; SS keeps the two-stripe layout for narrower default Timeline widths). |
| `src/v3/headers/DopesheetHeader.jsx` | `DOPESHEET_HT_header` default branch (`space_dopesheet.py:199`) | Film icon + "Dopesheet" name + subtitle (action name · fcurve count · duration) + View menu. Lifts the inline `<DopeHeader>` strip. |
| `src/v3/headers/FCurveHeader.jsx` | `GRAPH_HT_header` (`space_graph.py:44`) | Activity icon + "F-curve" name + selection-driven subtitle (label · keyframe count · duration) + View menu. Lifts the inline `<Wrapper>` title. |
| `src/v3/headers/NodeTreeHeader.jsx` | `NODE_HT_header` (`space_node.py:41`) | 3-pill row (Rig / Driver / Animation) + driver-mode fallback parameter dropdown. Lifts the mode-pill row out of `NodeTreeArea` body. |

### State lifted to `editorStore`

`NodeTreeArea` pre-lift owned `useState(mode)` + `useState(driverFallbackId)`
in local React state. Lifting the mode-pill row into a per-area header
required both to be shared across the header / body subscriber pair —
the same pattern OutlinerHeader used in F-1.

New slots on `editorStore`:
- `nodeTreeMode: 'rig' | 'driver' | 'animation'` (default `'rig'`)
- `nodeTreeDriverFallbackId: string | null` (default `null`)
- `setNodeTreeMode(mode)` validates against the 3-value enum, no-ops on equality.
- `setNodeTreeDriverFallbackId(id)` coerces empty-string → `null`, no-ops on equality.

### Editor body cleanups (Rule №1 + Rule №2)

| Body | Before | After |
|------|--------|-------|
| `DopesheetEditor.jsx` | Owns `<DopeHeader>` function + `Film` import | `<DopeHeader>` deleted; `Film` import dropped; no-action empty-state path simplified. |
| `FCurveEditor.jsx` | `Wrapper` takes `title`/`subtitle` props; `describeSelection` helper feeds the subtitle | `Wrapper` is structural shell only (`children`-only); `describeSelection` deleted (no remaining call sites); `Activity` import dropped. |
| `NodeTreeArea.jsx` | `useState(mode)` + `useState(driverFallbackId)` + `MODES` constant + entire mode-pill `<div>` | Subscribes to `editorStore.nodeTreeMode` + `editorStore.nodeTreeDriverFallbackId`; mode-pill row removed (header owns it); `driverIds` enumeration moved into header (only consumer). |

### Tests

- `test_editorStore` — 90 → **97** passed (+7 assertions covering
  initial mode/fallback values, all 3 valid mode transitions,
  rejection of invalid modes, store/clear/empty-string-clear behaviour
  for `setNodeTreeDriverFallbackId`).
- All other affected suites verified green: `v3Operators` (124),
  `uiV3Store` (59), `modalTransformTyped` (26), `outlinerFilters` (18),
  `animationStore` (55), `animationEngine` (61),
  `animationTree_compile` (15), `nodetree_shape` (35),
  `nodeTreeEditor_renderRead` (24).
- `npx tsc --noEmit` clean.

## Thread B — Post-ship dual-audit + fix sweep (commit `0866e5a`)

Per `feedback_dual_audit_after_phase_ship.md` (established convention,
not optional): spawned 2 parallel audit agents on commit `2f77a26`:
1. **Architecture audit** (`code-reviewer` agent) — 3 actionable findings.
2. **Blender-fidelity audit** (`general-purpose` agent) — 5 findings (all documentation-tightening).

### Architecture findings (3 — 1 cleared via verification, 2 fixed)

| ID       | Severity | File:lines                                          | Outcome |
|----------|----------|-----------------------------------------------------|---------|
| ARCH-1   | HIGH     | `FCurveHeader.jsx:63` (`selectionStore.items` sub)  | **Verified clean, no action.** Re-read `selectionStore.js` — every `set()` returns `{ items: <fresh array> }` via spread / filter / clone+splice. No in-place push paths. Subscription is safe; the agent flagged the *possibility* of an in-place mutation, but the store's actual implementation is purely immutable. |
| ARCH-2   | HIGH     | `NodeTreeHeader.jsx:92` (`<select>` value)          | Dead `?? driverIds[0]` fallback removed. The outer `driverIds.length > 0` guard already makes `driverPick` non-null inside the conditional, so the fallback was dead today AND a future stale-display trap (if `driverPick` ever returned null while drivers exist, the dropdown would pin to `driverIds[0]` while the store still held the old `driverFallbackId`). Added a comment recording the load-bearing guarantee. |
| ARCH-3   | HIGH     | 4 headers × `runOperator`/`isAvailable` duplication | Extracted to `src/v3/headers/headerOperators.js` exporting `makeHeaderOperators(editorType)` → `{ runOperator, isAvailable }` (closure-bound, called once at module scope so the pair is stable). All 4 headers (ViewportHeader + 3 F2-1 headers) now import the shared pair. **−75 lines net.** Rule №1 (`feedback_no_crutches_rule_one.md`) close: pre-fix three byte-identical copies differing only in the `editorType` ctx string. |

Confirmed-clean surfaces (no action): hook ordering in all 4 new
headers, filter-in-selector compliance in NodeTreeHeader (`useMemo`
filters on a parent-ref subscription per
`feedback_filter_in_selector.md`), filter inside DopesheetHeader's
`useMemo` (operating on a non-selector dep), dead-imports purged from
all stripped bodies, no Rule №2 migration baggage.

### Blender-fidelity findings (5 — all closed via JSDoc tightening)

| ID       | Cited source                                                         | Fix |
|----------|----------------------------------------------------------------------|-----|
| FID-B.1  | `DopesheetHeader.jsx:17` cited `space_dopesheet.py:446`              | Citation framed the op as coming from the header directly; real source is `DOPESHEET_MT_view` (the menu surfaced from the header). Citation tightened. |
| FID-B.2  | `NodeTreeHeader.jsx:31-33` cited `DNA_node_types.h:274-283`          | File path was implicit + line range slightly off. Verified against `reference/blender/source/blender/makesdna/DNA_node_types.h:275-283` (enum `NTREE_UNDEFINED` / `NTREE_CUSTOM` / `NTREE_SHADER` / `NTREE_COMPOSIT` / `NTREE_TEXTURE` / `NTREE_GEOMETRY`). Full path + enum names added. |
| FID-A.1  | (new deviation note across 3 headers)                                | SS unifies Blender's per-space view-selected ops (`action.view_selected` / `graph.view_selected` / `node.view_selected`) into one `view.frameSelected` op — defensible (bbox of a Part/Group is space-agnostic, Rule №1) but undocumented. Added one-liner to TimelineHeader / DopesheetHeader / FCurveHeader JSDocs noting the consolidation + pointing at `registry.js:393`. |
| FID-A.2  | `TimelineHeader.jsx` JSDoc                                           | Did not acknowledge `DOPESHEET_HT_playback_controls` (`space_dopesheet.py:351-358`) + `GRAPH_HT_playback_controls` (`space_graph.py:113-124`) — Blender's separate FOOTER region for transport. These are the natural target for SS's pending F-1 / Audit-4 #1 status bar lift. Added JSDoc paragraph mapping the deferral. |
| FID-A.3  | `NodeTreeHeader.jsx:33-38`                                           | "Rig (Modifiers) / Driver (Expression) / Animation (FCurves)" labels are SS-specific extensions of Blender's `tree_type` enum; reasoning was in the comment but lacked the explicit `feedback_blender_reference_strict.md` deviation marker. Added the marker + framed as deliberate (NodeEditor chrome pattern reused, but the three modes are not Blender's shader/compositor/geometry/texture trees). |

### Side-effects from extractions

- `ViewportHeader.jsx` shrunk: −44 lines after dropping its inline
  `runOperator`/`isAvailable` definitions (kept the surrounding JSDoc
  on the operator-dispatch pattern as a 4-line comment pointing at
  the shared helper).
- All 4 animation-editor headers shrunk by ~14 lines each (the inline
  helper pair).
- `headerOperators.js` is the single source of the dispatch contract —
  future changes to `getOperator`'s signature or `available(ctx)` only
  touch one file instead of four.

### Tests for audit-fix sweep

No new test files. The audit-fix changes are JSDoc tightening +
pure helper extraction + dead-code removal — none alter runtime
semantics. Re-ran `editorStore` (97), `v3Operators` (124), `uiV3Store`
(59) to confirm no regression. `npx tsc --noEmit` clean.

## Test scoreboard

- TSC clean across all 3 commits.
- All affected suites green at HEAD (`0866e5a`):
  - `test_editorStore` — 90 → **97** passed (+7 from F2-1 nodeTree slots)
  - `test_v3Operators` — 124 passed (unchanged)
  - `test_uiV3Store` — 59 passed (unchanged)
  - `test_modalTransformTyped` — 26 passed (unchanged)
  - `test_animationEngine` — 61 passed (unchanged)
  - `test_animationTree_compile` — 15 passed (unchanged)
  - `test_nodetree_shape` — 35 passed (unchanged)
  - `test_nodeTreeEditor_renderRead` — 24 passed (unchanged)
- Full `npm test` chain not run (Windows cmd-line length limit — the
  npm-script chain exceeds the per-process arg limit on Windows).
  Affected-suites smoke is the verification path.

## Resume paths post-compact

The cross-audit priority list from prior close-outs still has 3
unfinished picks (one consumed this round):

1. ~~**Audit 2 F2-1**~~ — **SHIPPED this round.**
2. **Audit 4 #2** — Right-click context menu per editorMode. RMB
   currently silent `preventDefault`s on canvas. Small-medium; leverages
   existing operators (the 6 popover menus already exist).
3. **Audit 4 #1** — Status bar (`Footer.jsx`) mirroring
   `STATUSBAR_HT_header`. Surfaces selection count + modal echo +
   reports. Medium cost, high impact. **This is the natural target for
   the transport-row lift flagged in FID-A.2** — when the Footer
   region lands, TimelineEditor's transport can move into a FOOTER
   header per `DOPESHEET_HT_playback_controls` + `GRAPH_HT_playback_controls`.

Also queued from prior sessions:
- **Animation Phase 2** — Slices 2.D (auto-handle calc) / 2.G + 2.G.1
  (motion3 bezier round-trip) / 2.H (6-Cubism-sample exit gate)
- **F-1 follow-on** — ModePill lift to shared subcomponent
- **F-8 (deferred)** — Constraint stack UI, needs Constraints
  datablock model in projectStore first

## Memory updates this session

None added; one lesson reinforced and applied. The dual-audit-after-phase-ship
convention (`feedback_dual_audit_after_phase_ship.md`) was correctly
invoked WITHOUT user prompting this round, applying the Round 3 lesson.
Memory unchanged.

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1 (no quick-and-dirty fixes); closed by ARCH-3 extraction + ARCH-2 dead-code removal.
- `feedback_no_migration_baggage_rule_two.md` — Rule №2 (no migration baggage); applied to body cleanup (`describeSelection` deleted, dead imports purged).
- `feedback_question_agents_not_user.md` — Rule №3 (question agents, not user); applied at session start (no clarifying question on resume).
- `feedback_dual_audit_after_phase_ship.md` — established convention; applied proactively this round.
- `feedback_blender_reference_strict.md` — Blender source IS the source of truth; closed by FID-A.3 + FID-B.2 marker additions.
- `feedback_filter_in_selector.md` — verified clean in audit (ARCH-3 confirmed pattern is correct in all 4 headers).
- `docs/plans/SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_3.md` — predecessor close-out (Round 3 — Audit 4 #3 + Audit 4 #4 + audit-fix sweep).
- `docs/plans/SESSION_CLOSEOUT_2026_05_16_FULL_UI_SWEEP.md` — master 2026-05-16 session close-out.
