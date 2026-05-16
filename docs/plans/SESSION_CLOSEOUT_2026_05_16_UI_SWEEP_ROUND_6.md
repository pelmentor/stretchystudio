# Session close-out — 2026-05-16 (round 6)
# UI Blender-fidelity sweep ROUND 6 — Audit 4 #1 (Footer / status bar) + post-ship dual-audit fix sweep

## Status

Continuation of the 2026-05-16 master session. Resumed from `a07c7ea`
([`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_5.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_5.md)'s
top queued resume path), shipped the Audit 4 #1 Footer / status-bar
feature, ran the established dual-audit convention, and folded all 7
findings into a SEPARATE audit-fix commit (the default per Round 5's
documented convention — inline is the exception, only when findings
sit on the feature's runtime critical path). **2 commits**, all
affected tests green at HEAD, typecheck clean. Pushed to
`origin/master`.

| # | Commit | Thread | What landed |
|---|--------|--------|-------------|
| 1 | `ac84780` | UI sweep R6 | Audit 4 #1 — Footer status bar (Blender STATUSBAR_HT_header parity) |
| 2 | `5e499f1` | UI sweep R6 audit-fix | 7-finding sweep (1 CRIT-cite + 4 fidelity + 2 perf + 1 doc) |
| 3 | this     | docs       | Round 6 close-out |

## Resume context

User typed `Go` after `/compact`. Per Rule №3 (question agents not
user), no clarification asked — picked the doc's explicit top resume
path (`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_5.md:163-169`):
"Audit 4 #1 — Status bar (`Footer.jsx`) mirroring `STATUSBAR_HT_header`.
Surfaces selection count + modal echo + reports. Medium cost, high
impact. **This is the natural target for the transport-row lift flagged
in FID-A.2 (Round 4)** — when the Footer region lands, TimelineEditor's
transport can move into a FOOTER header per `DOPESHEET_HT_playback_controls`
+ `GRAPH_HT_playback_controls`."

Footer did not exist pre-round — this round created it as a new file.
The spacer-flex layout was shaped to host the future transport-row
lift in the center section without further restructuring.

Dual-audit invoked proactively without prompting (Round 5 lesson
held). This round restored the default Round-4 pattern: feature ship
first, audit-fix sweep as a second commit. Round 5's inline-fold was
explicitly documented as a one-off (CRITICAL was on the critical
runtime path); this round's findings were all JSDoc + subscription
perf, not runtime-breaking, so the default split applies.

## Thread A — Audit 4 #1 Footer status bar

### Architecture

| File | Status | What it does |
|------|--------|--------------|
| `src/v3/shell/footerStatusData.js` | NEW | Pure-data module: `modeLabel`, `formatInputStatus`, `formatStats`, `countReports`. Kept `.js` (not `.jsx`) so the Node integrity test imports without a JSX transpiler — sister architecture to `canvasContextMenuItems.js` from Round 5. |
| `src/v3/shell/Footer.jsx` | NEW | Three-section status bar: LEFT input-status (modal echo or mode label), CENTER flex spacer + reports banner, RIGHT stats. Permanent mount; subscribes to modal stores + editorStore + projectStore.nodes + logsStore.entries. |
| `src/v3/shell/AppShell.jsx` | MODIFIED | Mounted `<Footer />` after `<AreaTree />` in the existing `flex-col h-screen` shell. `h-6 shrink-0` row at the bottom; AreaTree's `flex-1 min-h-0` keeps the canvas growing into the remaining height. |
| `scripts/test/test_footerStatus.mjs` | NEW | 39 asserts over all four exported formatters. |
| `package.json` | MODIFIED | `test:footerStatus` registered + umbrella chain extended after `test:canvasContextMenu`. |

### Per-section sources

Each section maps to one of Blender's three `STATUSBAR_HT_header.draw`
calls (`reference/blender/scripts/startup/bl_ui/space_statusbar.py:8-31`):

| Section | Blender analog | SS source | Output example |
|---------|----------------|-----------|----------------|
| LEFT input-status | `template_input_status` (`interface_template_status.cc:267-375`) | `useModalTransformStore` + `useModalVertexTransformStore` + `editorStore.editMode` + active-head dataKind | `"G — Move · X: 12.5 px"` / `"R — Rotate · 45.0°"` / `"S — Scale · 1.250×"` / `"Edit Mode (Mesh)"` |
| CENTER reports | `template_reports_banner` (`interface_template_status.cc:45-151`) | `useLogsStore.entries` → `countReports` | `⚠ 3` (yellow pill) + `⛔ 1` (red pill), hidden when both are zero |
| RIGHT stats | `template_status_info` (`interface_template_status.cc:408-622`) | `editorStore.selection.length` + `selection[0]` + active-head dataKind + per-mode vert count | `"0 selected"` / `"1 selected · Mesh"` / `"1 selected · Mesh · 142 verts"` / `"3 selected"` |

Deviations from Blender, all documented in module JSDoc (per
`feedback_blender_reference_strict.md` — no silent gaps):

- `template_input_status` non-modal cursor-region keymap row (LMB/MMB/RMB
  per-area labels) NOT surfaced. SS has no cursor-area-zone keymap
  primitive; falls back to a mode label instead.
- `template_reports_banner` Blender shows a timed-fade single-message
  banner; SS shows aggregate counts over the full ring buffer. Different
  ergonomics: SS misses Blender's transient text surface, Blender misses
  SS's running-total affordance.
- `template_running_jobs` progress bar omitted — SS has no unified
  background-job system today (PSD wizard owns its own full-screen
  chrome; export modal stays open during work). Would be a Rule №1 stub.
- `template_status_info` Blender shows scene-level vert/edge/face/tri
  counts + memory usage; SS surfaces object-selection-level info. No
  scene-stats plumbing today; deviation documented as a layer-of-
  granularity choice in the same screen slot.

### Modal echo HUD

When `modalTransformStore.kind !== null` OR
`modalVertexTransformStore.kind !== null`, the LEFT section flips into
gesture-echo mode. Vertex modal takes priority over node modal
(matches the editor-state stack: vertex-modal is only entered from
inside Edit Mode where a node-modal cannot be running). Numeric
type-in mode (`numericMode === true` via the `=` keyboard toggle —
Blender's `NUM_EDIT_FULL`, `editors/util/numinput.cc:51` declaration,
`:355-365` digit trigger, `:367-380` `=`-toggle path) replaces the
live-delta render with the typed buffer in square brackets so users
see their keystrokes accumulate alongside the on-canvas HUD.

Format rules (Blender HUD parity):

| Kind | No axis | Axis locked |
|------|---------|-------------|
| translate | `12.5, -8.0 px` | `X: 12.5 px` / `Y: -8.0 px` |
| rotate    | `45.0°`         | (SS rotates Z-only; axis lock not applicable) |
| scale     | `1.250×`        | `X: 1.250×` / `Y: 1.250×` |

The font weight + color flip when a modal is active (foreground vs
muted-foreground) — reinforces "you are in a gesture" without
introducing a new color slot.

### Tests

| Suite | Asserts | Change |
|-------|---------|--------|
| `test_footerStatus.mjs` | 39 | NEW — modeLabel covers all (editMode × dataKind) combos, formatInputStatus dispatch priority + axis lock + numeric override, formatStats plurals + per-mode vert suffix, countReports skips debug/info + handles null/empty/unknown levels |
| `package.json` | `test:footerStatus` registered + umbrella chain extended | |

The integrity test is the key safeguard: every dispatch branch +
format edge case is asserted. Catches typos / regression in label
strings + formula drift. Modular pure-data file enables headless
testing without JSX transpilation — same pattern as Round 5's
`canvasContextMenuItems.js`.

## Thread B — Dual-audit (7 findings, ALL CLOSED in `5e499f1`)

Per `feedback_dual_audit_after_phase_ship.md`: 2 parallel agents
(architecture + Blender-fidelity) ran against the staged tree before
the second commit landed. This round restored the default split
(feature commit + audit-fix commit) — findings were all JSDoc /
subscription tweaks, none on a runtime critical path.

### Findings closed

| # | Tag | Severity | Finding | Fix |
|---|-----|----------|---------|-----|
| 1 | B1 | CRITICAL | `footerStatusData.js:145` `numinput.cc:367-380` cite points to the USE_FAKE_EDIT `=`/`*` keyboard fallback, not the NUM_EDIT_FULL flag itself | Re-cited to `:51` (flag declaration) + `:355-365` (primary digit-entry trigger); `:367-380` kept as the `=`-toggle path's locator |
| 2 | B3 | HIGH | JSDoc described `template_input_status` as showing "modal operator key hints" only; Blender ALSO surfaces cursor-region LMB/MMB/RMB keymap labels in the non-modal path | Documented as a deliberate deviation in both module headers — SS has no cursor-area-zone keymap primitive; not an oversight |
| 3 | B4 | HIGH | JSDoc invented `WM_report_banner_show_pending` as the dismiss mechanism for `template_reports_banner` | Re-described per actual Blender behavior — `uiTemplateReportsBanner` shows the most-recent report as a timed fade-out (`reports->reporttimer`-driven), NO per-report dismiss. SS's aggregate-count surface is a deliberate trade-off, not a port |
| 4 | B6 | MED | `dataKindToLabel` JSDoc cited an invented `"Collection \| Mesh"` string for `template_status_info`; doesn't exist in Blender | Replaced with honest comparison: Blender shows scene-level vert/edge/face counts via `ED_info_statusbar_string_ex`; SS surfaces object-selection-level info in the same slot (no scene-stats plumbing today) |
| 5 | A1 | HIGH | `Footer.jsx` `useEditorStore((s) => s.selection)` subscribed to the array ref; re-rendered on every selection event even when `length` + `[0]` didn't change | Narrowed to primitive selectors: `s.selection.length` + `s.selection[0] ?? null`. Zustand's Object.is compare keeps the snapshot stable |
| 6 | A2 | MED | `Footer.jsx:81` comment said "logsStore.push mutates the array reference"; it REPLACES via `[...arr, next]` spread | Corrected to "REPLACES the array reference via spread" so future maintainers don't act on the wrong invariant |
| 7 | A3 | MED | `Footer.jsx` `useProjectStore((s) => s.project)` re-rendered Footer on any project mutation (transform writes, param changes, etc.) | Narrowed to `s.project?.nodes` (the only slot `getDataKind` needs); pass `null` as the unused second arg to `getDataKind` rather than reconstructing the project ref |

CRITICAL B1 was severity-tagged for the cite-strictness rule
(`feedback_blender_reference_strict.md`) but is functionally a
documentation fix — not on the runtime path. The Round 5
inline-fold convention applies only when fixes break runtime; this
round's CRITICAL was a comment, so the default separate-commit
pattern applied.

## Test scoreboard

- TSC clean across both commits.
- All affected suites green at HEAD (`5e499f1`):
  - `test_footerStatus` — **39 passed** (NEW)
  - `test_canvasContextMenu` — 55 passed (unchanged)
  - `test_editorStore` — 97 passed (unchanged)
- Full `npm test` chain still hits Windows cmd-line length limit;
  affected-suites smoke is the verification path.

## Owed (not blocked)

**Manual browser verification** — load SS, confirm Footer renders at
the bottom; switch modes (Object → Edit Mesh → Edit Armature → Pose
→ Weight Paint), confirm mode label updates; press G/R/S in Object
Mode, confirm modal echo + live delta + axis lock formatting; trigger
a warn or error via Logs panel actions, confirm reports pill appears;
select / multi-select / enter Edit Mode with vertex selection, confirm
stats output. Cannot be assertion-tested in headless Node; needs human
eyes.

## Resume paths post-compact

The cross-audit priority list from prior close-outs has one fewer
unfinished pick this round:

1. ~~**Audit 4 #1**~~ — **SHIPPED this round.**
2. **Transport-row lift (FID-A.2 from Round 4)** — now natural
   next-up: Footer exists, so TimelineEditor's transport bar (play /
   pause / frame fields / fps / speed / loop / auto-key / audio) can
   move into a FOOTER region per `DOPESHEET_HT_playback_controls`
   (`reference/blender/scripts/startup/bl_ui/space_dopesheet.py:351-358`)
   + `GRAPH_HT_playback_controls`
   (`reference/blender/scripts/startup/bl_ui/space_graph.py:113-124`).
   Center spacer in Footer is shaped for this injection.
3. **Animation Phase 2** — Slices 2.D (auto-handle calc) / 2.G + 2.G.1
   (motion3 bezier round-trip) / 2.H (6-Cubism-sample exit gate).
   Independent of Footer; also unblocks `anim.keyframe_insert` for
   the Pose menu's biggest Blender-fidelity gap flagged in Round 5
   FID-A.3.

Queued from prior sessions:
- **F-1 follow-on** — ModePill lift to shared subcomponent
- **F-8 (deferred)** — Constraint stack UI, needs Constraints
  datablock model in projectStore first
- **Interactive affordances on Footer (deferred)** — click-to-open-Logs
  + per-report dismiss. Would need either workspace mutation (swap an
  Area's editorType to `'logs'`) or a new global Logs-panel store
  (parallel to editMenuStore for a non-popover surface). First-cut
  shipped read-only-informational; non-trivial extension that earns
  its own audit lap.

## Memory updates this session

None added. Two conventions reinforced and applied:
- `feedback_dual_audit_after_phase_ship.md` — invoked proactively
  (Round 5 lesson held).
- One-off pattern from Round 5 (inline-fold for critical-path fixes)
  did NOT apply this round — all 7 findings were JSDoc + subscription
  perf, default split-commit convention applied. Round 5's exception
  framing held: "default (separate audit-fix commit) still stands when
  fixes are JSDoc / non-load-bearing."

## Cross-references

- `feedback_no_crutches_rule_one.md` — Rule №1 (no quick-and-dirty
  fixes); applied throughout: no interactive affordances on Footer
  in the first cut, no stub progress bar, no invented dismiss model.
  Each omission documented in JSDoc with rationale.
- `feedback_no_migration_baggage_rule_two.md` — Rule №2 (no migration
  baggage); pure-data module extracted up-front, no shims.
- `feedback_question_agents_not_user.md` — Rule №3 (question agents,
  not user); applied at session start (no clarifying question on
  resume).
- `feedback_dual_audit_after_phase_ship.md` — established convention;
  applied this round, findings folded as a separate commit per the
  default convention (Round 5's inline-fold was the exception, not
  the new default).
- `feedback_blender_reference_strict.md` — Blender source IS the
  source of truth; closed by B1 (cite correction) + B3/B4/B6
  (deviation discipline — invented behavior removed, real deviations
  documented).
- `feedback_filter_in_selector.md` — A1 narrowed selection
  subscription per this rule's spirit (return store-resident
  primitives, not array refs).
- [`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_5.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_5.md) — predecessor close-out (Round 5 — Audit 4 #2 RMB context menu).
- [`SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md`](SESSION_CLOSEOUT_2026_05_16_UI_SWEEP_ROUND_4.md) — Round 4 (Audit 2 F2-1 4 animation-editor headers) — original source of FID-A.2 transport-row lift flag.
