# Animation Phase 5 — Session-spanning close-out (Slices 5.Y → 5.JJ)

**Dates**: 2026-05-17 → 2026-05-18 (super-session spanning a date roll)
**Commit range**: `11755e4` (5.Y substrate) → `8096f6a` (5.JJ close-out)
**Slices shipped**: 13 (5.Y, 5.Z, 5.AA, 5.BB, 5.CC, 5.DD, 5.EE, 5.FF, 5.GG, 5.HH, 5.II, 5.JJ)
**Commits**: 29 (13 substrate + 5 audit-fix sweeps + 13 close-out docs)
**Lines changed**: +6230 / −176 across 30 files
**Tests**: ~250 new assertions across 5 new test files + extensions to 3 existing
**Branch state**: 100 commits ahead of origin/master, working tree clean

---

## Slice-by-slice timeline

| # | Slice | Date | Path # | One-line | Audit? | Commits |
|---|-------|------|--------|----------|--------|---------|
| 1 | **5.Y** | 2026-05-17 | #12 | Channel-list box (drag-rect) select via `ANIM_OT_channels_select_box` | ✓ (1 HIGH fab, 6 MED, 2 LOW) | substrate + audit-fix + close-out |
| 2 | **5.Z** | 2026-05-17 | #45 | Wire `clearActive` through bulk select-all (closes 5.K MED-A1) | ✗ gap-closure | substrate + close-out |
| 3 | **5.AA** | 2026-05-17 | #15 | Keymap-preset selector (`default` / `industry_compatible`) + resolver pattern | ✓ (2 HIGH 0 fab, 6 MED, 3 LOW) | substrate + audit-fix + close-out |
| 4 | **5.BB** | 2026-05-17 | #35 | Group-children select (Shift+Ctrl+click) | ✓ (1 HIGH dormant-invariant, 7 MED, 3 LOW) | substrate + audit-fix + close-out |
| 5 | **5.CC** | 2026-05-18 | #40 | `change_active=true` cascade on Ctrl+click toggle-OFF (closes 5.X-1) | ✗ gap-closure | substrate + close-out |
| 6 | **5.DD** | 2026-05-18 | #41 | GRAPH-region `do_channels` cascade + active-restore (closes 5.X-4) | ✓ (1 HIGH semantic-port, 6 MED, 4 LOW) | substrate + audit-fix + close-out |
| 7 | **5.EE** | 2026-05-18 | #42 | Cross-editor keyform-selection mirror store (closes 5.W-2 halo precondition) | ✓ (1 HIGH lifecycle, 2 MED, 3 LOW) | substrate + audit-fix + close-out |
| 8 | **5.FF** | 2026-05-18 | #43 | B-key box-select gesture invocation (closes 5.Y-1) | ✗ gap-closure | substrate + close-out |
| 9 | **5.GG** | 2026-05-18 | #47 | Third preset `'default_no_toggle'` (closes 5.AA Dev 1) | ✗ gap-closure | substrate + close-out |
| 10 | **5.HH** | 2026-05-18 | #46 | PreferencesModal keymap-preset Select UI (closes 5.AA Dev 4) | ✗ gap-closure | substrate + close-out |
| 11 | **5.II** | 2026-05-18 | #48a | Preset-aware channel-delete X-vs-Backspace (closes 5.N inline TODO) | ✗ gap-closure | substrate + close-out |
| 12 | **5.JJ** | 2026-05-18 | #56 | Preset-aware hide/reveal H-vs-Ctrl+H (sister to 5.II) | ✗ gap-closure | substrate + close-out |

**Substrate slices (with audit)**: 5.Y, 5.AA, 5.BB, 5.DD, 5.EE — 5 slices, 5 dual-audit sweeps
**Gap-closure slices (no audit)**: 5.Z, 5.CC, 5.FF, 5.GG, 5.HH, 5.II, 5.JJ — **7-slice gap-closure streak**

---

## New files (substrate this session)

| File | Slice | Role |
|------|-------|------|
| `src/anim/fcurveBoxSelect.js` | 5.Y | Pure helper `applyChannelBoxSelect` + `wouldChannelBoxSelectChange` |
| `src/anim/keymapPresets.js` | 5.AA | Resolver pattern — extended in 5.GG/5.II/5.JJ to 3 resolvers (370 LOC) |
| `src/anim/graphSelectAllCascade.js` | 5.DD | Pure helper `applyGraphSelectAllChannelCascade` + preflight |
| `src/store/keyformSelectionStore.js` | 5.EE | Cross-editor publish/subscribe mirror store |
| `scripts/test/test_fcurveBoxSelect.mjs` | 5.Y | 71 assertions |
| `scripts/test/test_keymapPresets.mjs` | 5.AA | 115 assertions (45 → 88 → 115 across slices) |
| `scripts/test/test_graphSelectAllCascade.mjs` | 5.DD | 47 assertions |
| `scripts/test/test_keyformSelectionStore.mjs` | 5.EE | 25 assertions |
| `docs/plans/SESSION_CLOSEOUT_2026_05_17_*.md` | 5.Y/5.Z/5.AA/5.BB/5.CC | 5 per-slice close-out docs |
| `docs/plans/SESSION_CLOSEOUT_2026_05_18_*.md` | 5.DD/5.EE/5.FF/5.GG/5.HH/5.II/5.JJ | 7 per-slice close-out docs |
| `docs/plans/SESSION_CLOSEOUT_2026_05_17_18_*.md` | (this doc) | Session-spanning aggregate |

---

## Test coverage delta

| Test | Pre-session | Post-session | Delta |
|------|-------------|--------------|-------|
| test:fcurveChannelSelect | 204 | 274 | +70 (5.Z +8, 5.BB +45, 5.CC +17 — minus consolidation) |
| test:fcurveBoxSelect | (new in 5.Y) | 71 | +71 |
| test:keymapPresets | (new in 5.AA) | 115 | +115 (45 substrate + 18 5.GG + 25 5.II + 27 5.JJ) |
| test:graphSelectAllCascade | (new in 5.DD) | 47 | +47 |
| test:keyformSelectionStore | (new in 5.EE) | 25 | +25 |
| test:preferencesStore | 56 | 62 | +6 (5.AA + 5.HH) |
| test:fcurveActive | 75 | 75 | unchanged (held green throughout) |

**Total new assertions**: ~250+ across 5 new modules + 3 extensions.

---

## Audit findings summary

| Slice | HIGH | MED | LOW | Fab? | Streak status |
|-------|------|-----|-----|------|---------------|
| 5.Y | 1 | 8 | 5 | **YES** (1 fab — `WM_GESTURE_DRAG_THRESHOLD` invented; real: `WM_event_drag_threshold` + `U.drag_threshold_mouse`) | **BROKEN** (last break 5.V; now 5.Y) |
| 5.AA | 2 | 6 | 3 | NO (0 fab) | HELD (1st post-5.Y) |
| 5.BB | 1 | 7 | 3 | NO (0 fab — HIGH was dormant-invariant bug: sibling `group.selected` pre-clear cascade missing) | HELD (2nd) |
| 5.DD | 1 | 6 | 4 | NO (0 fab — HIGH was real semantic-port bug: INVERT cascade hits else branch → unconditional ADD, not flip) | HELD (3rd) |
| 5.EE | 1 | 2 | 3 | NO (0 fab — HIGH was React lifecycle bug: `useEffect` cleanup miss → mirror store stale after FCurveEditor unmount) | HELD (4th) |

**Fab streak: HELD 4 in a row** post-5.Y break (5.AA, 5.BB, 5.DD, 5.EE).

### HIGH-finding pattern by slice

The HIGH severity findings evolved across this session:

| Pattern | Slices | Description |
|---------|--------|-------------|
| Semantic-deviation-not-flagged-as-deviation | 5.W (pre-session), 5.X (pre-session), 5.AA | Code is correct; docstring/comment misframes Blender behavior |
| Dormant-invariant bug | 5.BB | Real bug with currently-zero visible impact; would surface when a future consumer reads the invariant |
| Real semantic-port bug | 5.DD | Code SHIPPED wrong behavior; caught by careful per-line Blender reference reading |
| React-lifecycle bug | 5.EE | `useEffect` cleanup miss in cross-component publish/subscribe pattern |
| Fabricated cite | 5.Y | Single throw-away constant name in a UI comment (`WM_GESTURE_DRAG_THRESHOLD` doesn't exist) |

Lesson: per-line Blender cite verification serves DUAL duty — fab detection AND semantic divergence detection. Arch audits should explicitly include mount/unmount lifecycle for cross-component pubsub patterns.

---

## Deviations closed this session

| # | Deviation | Closure slice |
|---|-----------|---------------|
| Slice 5.X-1 | Channel-deselect doesn't auto-clear `active` | **5.CC** |
| Slice 5.X-4 | No active-restore pass after bulk select-toggle | **5.DD** |
| Slice 5.W-2 | Active-keyform halo doesn't enforce keyform-selection precondition | **5.EE** |
| Slice 5.Y-1 | B-key keyboard entry for box-select deferred | **5.FF** |
| Slice 5.AA Dev 1 | `'default'` preset picks toggle branch (deviation from Blender out-of-box) | **5.GG** |
| Slice 5.AA Dev 4 | No UI affordance for switching presets | **5.HH** |
| Slice 5.K MED-A1 | `clearActive` computed but NOT forwarded | **5.Z** |
| Slice 5.N inline TODO | IC Backspace channel-delete not wired | **5.II** |
| (new path #56 from 5.II) | Hide/reveal preset divergence | **5.JJ** |

**9 deviations closed.** Most were queued from earlier slices' close-out docs, hand-tracked through several `/compact` cycles. The discipline of writing closure conditions into deviation lists pays off — they become a searchable backlog.

---

## New deviations opened this session (documented)

| # | Deviation | Slice | Closure target |
|---|-----------|-------|----------------|
| 5.Y-2 | 'deselect' mode literal-Blender (Ctrl+drag wipes everything in scope) | 5.Y | None planned (faithful port) |
| 5.Y-3 | Two distinct Blender scopes folded into one (`ctx.orderedIds`) | 5.Y | path #44 (low-priority) |
| 5.AA-1 | toggle-branch picked as default preset (closed by 5.GG) | 5.AA | **CLOSED** |
| 5.AA-2 | metaKey-as-Ctrl-equivalent is web/DOM convention, not Blender port | 5.AA | None planned |
| 5.AA-3 | A_DOUBLE_CLICK omitted (no keyboard double-press in web KeyboardEvent) | 5.AA | None planned |
| 5.AA-4 | No UI affordance (closed by 5.HH) | 5.AA | **CLOSED** |
| 5.AA-5 | No OPTYPE_UNDO snapshot | 5.AA | None planned |
| 5.BB-1 | Shift+Ctrl+click on fcurve rows dispatches to parent group (SS UX extension) | 5.BB | None planned |
| 5.BB-2 | Hidden children of clicked group still selected | 5.BB | None planned |
| 5.BB-5 | `agrp->channels` equivalence assumption (no defensive filter) | 5.BB | None planned (Rule №1) |
| 5.DD-1 | Scope = `ctx.orderedIds` (narrower than Blender pre-clear) | 5.DD | None planned |
| 5.DD-2 | EXCLUSIVE re-elevation via `setActiveFCurve` | 5.DD | None planned |
| 5.DD-3 | Stash visibility gate stricter than Blender | 5.DD | path #52 |
| 5.DD-5 | Step 2 optimization (skip previouslyActive) | 5.DD | None planned |
| 5.EE-1 | Keyform selection NOT persisted across save/load | 5.EE | path #53 |
| 5.EE-2 | View-range halo gate (`graph_draw.cc:251`) omitted | 5.EE | None planned |
| 5.FF-1 | No two-click box-select variant | 5.FF | path #54 |
| 5.FF-2 | Hint banner vs Blender status bar | 5.FF | None planned |
| 5.FF-3 | No graph-region B binding ported | 5.FF | path #55/#57 |

**19 new deviations documented; 2 closed within the session (5.AA-1 by 5.GG, 5.AA-4 by 5.HH).** Of the 17 remaining: 11 have no closure planned (faithful ports, SS UX choices, or Rule №1 stance); 6 are queued as paths #44, #52, #53, #54, #55, #57.

---

## Resolver pattern — extended 4× this session

Slice 5.AA shipped the substrate (`coerceKeymapPreset` + `resolveSelectAllAction`). Subsequent slices extended:

| Slice | Resolver | Binding family |
|-------|----------|----------------|
| 5.AA | `resolveSelectAllAction` | Select-all triplet (A/Alt+A/Ctrl+I) |
| 5.GG | (preset enum extended) | Added `'default_no_toggle'` byte-faithful Blender out-of-box |
| 5.II | `resolveChannelDeleteAction` | Channel delete (X vs Backspace; DEL shared) |
| 5.JJ | `resolveHideRevealAction` | Hide/reveal (H vs Ctrl+H; Shift+H + Alt+H shared) |

**`keymapPresets.js` now exports 3 resolvers in ~370 LOC.** Module growth worth monitoring; per-family file split might be worth a slice if 2+ more resolvers ship.

The 5-slice extension demonstrates the productivity multiplier of well-audited substrate: Slice 5.AA cost ~150 LOC + 14 audit findings; each follow-on resolver is ~30 LOC + tests + dispatcher rewire, no new audits.

---

## Convention established this session

**Substrate slices (new files / helpers / schema)** → get dual audit (architecture + Blender-fidelity, parallel agents). Same-day fix sweep + audit-pin.

**Gap-closure slices (UI wiring or extension against pre-audited helpers)** → ship as single commits. No audit needed because the helper contract was already established.

This convention emerged across 5.Z/5.CC/5.FF/5.GG/5.HH/5.II/5.JJ (7 gap-closures in a row). Logged in 5.FF lesson #1 + 5.HH lesson #3.

---

## Session-wide lessons (consolidated from per-slice close-outs)

1. **Fab streak HELD 4 in a row post-5.Y break.** Per-line Blender cite verification scales when cites are load-bearing, even at substrate volume. The 5.Y fab was a single throw-away constant name in a UI comment — easier to wave through, harder to catch. Lesson: single-line cites get the same per-cite verification discipline as substrate cites, no exceptions.

2. **HIGH categories diversified beyond "fab vs semantic divergence".** 5.BB surfaced a dormant-invariant bug (sibling group.selected pre-clear cascade missing); 5.DD a real semantic-port bug (Blender INVERT cascade hits else branch); 5.EE a React lifecycle bug (useEffect cleanup miss). Per-line cite verification serves DUAL duty — fab detection AND semantic divergence detection. Arch audits should explicitly include lifecycle reasoning for cross-component patterns.

3. **Documented deviations are queue entries.** Every deviation with a stated closure condition becomes implicit backlog. 5.X-1/5.X-4/5.W-2/5.Y-1/5.AA-1/5.AA-4/5.K MED-A1/5.N inline TODO all closed this session because they had concrete closure conditions written into prior close-out docs. Lesson: when a deviation has a concrete closure condition, treat it as a backlog item — the condition IS the spec.

4. **Resolver pattern is the right shape for preset-divergent bindings.** Slice 5.AA shipped `(preset, e) → action | null` as the resolver signature. 4 subsequent slices (5.GG/5.II/5.JJ, plus the original 5.AA select-all) extend it without modification. The shared+divergent pattern repeats (DEL+X/Backspace; Shift+H+Alt+H+H/Ctrl+H) — share common checks first, branch only divergent ones.

5. **Mirror pattern beats full state lift when one editor owns + others read.** Slice 5.EE — FCurveEditor has 37+ touch points to `selectedHandles`; lifting all to a Zustand store would be high-churn for zero benefit at the owner. The `useEffect` mirror is 6 lines + cleanup return + achieves cross-editor visibility without disrupting the owner. Lesson: "lift state to store" isn't always the right answer; "publish state to mirror store" is often better when ownership stays put.

6. **The `else` branch trap.** Slice 5.DD's HIGH was a Blender INVERT cascade port where I assumed INVERT means "invert per channel" at every level. Blender's `do_channels` cascade actually has only TWO branches: SUBTRACT clears, EVERYTHING ELSE (including INVERT) sets. The per-keyform invert is at the leaf; the channel-level cascade is normalization. Lesson: when porting a switch-like dispatch with a default else, enumerate which inputs hit the default — don't assume an op's name carries through every layer.

7. **Single-coercion-point pays dividends.** Slice 5.AA arch audit MED-2 caught 3 independent coercion sites and consolidated them into one (`coerceKeymapPreset`). Slice 5.GG added a third preset value by changing ONLY that helper. Zero touches to the store body. Lesson: when an enum-coercion pattern surfaces, consolidate even if there are only 2 values today — marginal cost is tiny; marginal benefit on next addition is real.

8. **Critical differentiator tests prevent silent regressions.** Each preset-extension slice (5.GG, 5.II, 5.JJ) ends with an explicit "critical differentiator" test block that asserts the ONE divergent binding between two presets. If a future refactor accidentally collapses the branches, the test fails loudly. Lesson: when two presets/modes differ in ONE specific way, write a test that explicitly asserts the divergence — not just per-preset behavior.

9. **Unbound key fall-through guards.** Slice 5.II's critical fall-through block was a near-miss: refactoring channel-delete to use the resolver without thinking about IC-X-over-sidebar would have silently fired keyform-delete on the timeline's selection. 4-line guard prevents the bug. Lesson: when a region-aware dispatch swaps from an `if (e.code === ...)` ladder to a resolver, audit each removed case for "might my refactor accidentally route to the WRONG region in some preset?"

10. **7-slice gap-closure streak validates the substrate investment.** Slice 5.AA shipped the resolver substrate + dual-audited (14 findings). Subsequent slices (5.GG/5.HH/5.II/5.JJ + sister-pattern 5.Z/5.CC/5.FF) closed Slice 5.AA's queued deviations and extended the resolver pattern without any further audit needed. Measure ROI in slices-enabled, not LOC-shipped.

---

## Pre-compact state

| Item | Value |
|------|-------|
| Branch | `master` |
| Commits ahead of origin | **100** |
| Working tree | clean |
| Last commit | `8096f6a docs(plan): Animation Phase 5 Slice 5.JJ close-out` |
| Phase 5 slice letter | up to **JJ** (next letter: KK or 6.A) |
| Schema version | v40 (unchanged this session) |
| keymapPreset slot | `default` / `default_no_toggle` / `industry_compatible` (3 options) |
| Resolvers in `keymapPresets.js` | 3 (select-all, channel-delete, hide/reveal) |
| Active fab streak | HELD 4 in a row (5.AA, 5.BB, 5.DD, 5.EE) post-5.Y break |
| Total session test deltas | +250 assertions across 5 new modules + 3 extensions |

### Top queued paths for next session

| Path | Title | Notes |
|------|-------|-------|
| 49 | Plain/Ctrl/Shift group-header click handlers (closes 5.BB scoped-out variants) | NEW TOP for one-slice ships — different category (UI gesture, not preset-aware key) |
| 50 | Port AGRP_ACTIVE (closes 5.BB MED-3 cascade gap) | Substrate scope — would need dual audit |
| 51 | `visibleIds` memo extraction across dispatchers (5.DD LOW-2 arch) | Phase-5-wide refactor |
| 52 | Drop `orderedIds` gate on restore (5.DD Deviation 3 alt path) | Trade-off slice |
| 53 | Persist keyform selection to action draft (closes 5.EE-1) | Substrate scope — touches 37 writer sites |
| 54 | Click-corner1 → click-corner2 box-select variant (5.FF Dev 1) | Modal FSM extension |
| 55 | Graph-region B → GRAPH_OT_select_box port (5.FF Dev 3) | Needs keyform box-select pipeline first |
| 57 | Graph-region select_box B vs Q (closes 5.FF dev variant) | Downstream of #55 |

Plus: paths #13/#14/#16-39 carry forward (Phase 2 manual verif, Phase 3 modifiers, etc.).

**Next-session top pick recommendation**: #49 (group-header click handlers) — concrete, well-defined Blender semantics for SELECT_REPLACE/INVERT/EXTEND_RANGE on group rows, sister-pattern to 5.BB's children_only.

---

## Session feel

Sustained autonomous shipping across two days (date rolled mid-session from 2026-05-17 to 2026-05-18). User intervention: 13 single-word "Go" prompts to advance the queue + 1 "Documentize, prepare for compact" at end. Zero design questions bounced to user (per Rule №3); 5 dual-audit sweeps spawned for substrate slices; 7 gap-closures shipped as single commits per the established convention.
