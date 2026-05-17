# Session close-out — 2026-05-17 — Animation Phase 5 Slices 5.L / 5.M / 5.N

**Session shape:** Three Graph-Editor keymap-parity slices shipped
back-to-back from one `/compact`-resumed session, closing 3 of the 14
queued resume paths from Slice 5.K. Each slice followed the standard
substrate → dual-audit → audit-fix → close-out cadence; per-slice
close-outs at `SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_L.md`,
`..._SLICE_M.md`, and `..._SLICE_N.md` capture full details. This
document is the session-spanning index.

## Commits this session (9 commits, all on `master`)

| SHA       | Subject                                                                            |
|-----------|------------------------------------------------------------------------------------|
| `18b5a3a` | feat(anim): Animation Phase 5 Slice 5.L — keyform invert (Ctrl+I timeline region) |
| `df3ce81` | fix(audit): Animation Phase 5 Slice 5.L dual-audit sweep — 1 MED + 1 LOW          |
| `505228a` | docs(plan): Animation Phase 5 Slice 5.L close-out                                 |
| `0852bc1` | feat(anim): Animation Phase 5 Slice 5.M — bulk hide/reveal (H / Shift+H / Alt+H) |
| `fb0e271` | fix(audit): Animation Phase 5 Slice 5.M dual-audit sweep — 1 HIGH + 1 MED + 2 housekeeping |
| `718434c` | docs(plan): Animation Phase 5 Slice 5.M close-out                                 |
| `e9d0457` | feat(anim): Animation Phase 5 Slice 5.N — bulk channel delete (sidebar X/Delete) |
| `56dcce9` | fix(audit): Animation Phase 5 Slice 5.N dual-audit sweep — 1 HIGH + 2 MED         |
| `60f5c1a` | docs(plan): Animation Phase 5 Slice 5.N close-out                                 |

## Slices at a glance

| Slice | Operator port | Keymap bound | Surface |
|-------|---------------|--------------|---------|
| 5.L   | Keyform INVERT (`graph.select_all` action=INVERT) | Ctrl+I | Timeline region |
| 5.M   | Bulk hide/reveal (`graph.hide` + `graph.reveal`) | H / Shift+H / Alt+H | Timeline region |
| 5.N   | Bulk channel delete (`anim.channels_delete`) | X / Delete | Sidebar region (region-aware dispatch with existing timeline keyform delete) |

## Streak status — fidelity zero-fab

| Slice | Blender-fidelity audit findings | Streak |
|-------|--------------------------------|--------|
| 5.J (prior session) | HIGH-B1 (inverted modifier mapping) | BROKEN |
| 5.K (prior session) | 0 HIGH (1 MED + 1 LOW) | 1 |
| **5.L (this session)** | 0 HIGH (1 LOW — line citation off by 13) | **2** |
| **5.M (this session)** | 0 HIGH (1 MED — IC keymap divergence + 1 LOW — Deviation 1 wording) | **3** |
| **5.N (this session)** | 0 HIGH, 0 MED, 0 LOW — clean | **4** |

The `feedback_modifier_binding_check_keymap_first` discipline kept
fidelity clean across all 3 session slices. Every Blender citation
was re-grepped by the fidelity agent and verified. Slice 5.M's
LOW-B1 was a line-number-citation-in-wrong-branch nit caught + fixed
the same day. Slice 5.N had zero findings — pure correct port.

## Streak status — architecture (overall)

| Slice | Architecture audit findings | Overall streak |
|-------|----------------------------|----------------|
| 5.L | 1 MED (functional-update asymmetry comment) | held |
| **5.M** | **1 HIGH (no-op H/Shift+H/Alt+H pushes phantom undo)** | RESET to 0 |
| **5.N** | **1 HIGH (`.clear()` evicted unrelated selection items)** | held at 0 |

Both architecture HIGHs surfaced new patterns worth memorizing:

1. **Slice 5.M's HIGH** revealed `updateProject`'s
   `pushSnapshot`-before-recipe behavior. Fix: read-only preflight
   helpers (`wouldHideChangeFCurves`, `wouldRevealChangeFCurves`)
   so the dispatcher can short-circuit before `update()`. **This
   pattern is now a template** — every future undo-bearing operator
   should ship a preflight reader.

2. **Slice 5.N's HIGH** revealed `useSelectionStore.getState().clear()`
   as overreach when only some items need eviction. Fix: snapshot
   each item's resolved fcurve-id BEFORE delete, replace
   `selection.items` with only the survivors. **Snapshot-and-filter
   > clear-and-rebuild** when only a subset is stale.

## Test counts (cumulative through session)

| Suite                          | Pre-session | Slice 5.L | Slice 5.M | Slice 5.N | Total |
|--------------------------------|-------------|-----------|-----------|-----------|-------|
| test:fcurveKeyformSelect (NEW) | —           | **+34**   | 34        | 34        | 34    |
| test:fcurveVisible             | 47          | 47        | **+95**   | 142       | 142   |
| test:fcurveChannelSelect       | 168         | 168       | 168       | **+36**   | 204   |
| test:fcurveMute                | 38          | 38        | 38        | 38        | 38    |
| test:fcurveActiveKeyform       | 62          | 62        | 62        | 62        | 62    |
| test:fcurveEval                | 35          | 35        | 35        | 35        | 35    |
| test:fcurveHandles             | 35          | 35        | 35        | 35        | 35    |
| test:graphEditOps              | 115         | 115       | 115       | 115       | 115   |
| test:projectRoundTrip          | 41          | 41        | 41        | 41        | 41    |
| test:animFCurveBridge          | 52          | 52        | 52        | 52        | 52    |
| **TOTAL**                      | **593**     | **629** (+36) | **758** (+129) | **794** (+36) | **758** |

(Note: total is suite-deduped — `test:fcurveKeyformSelect` and
`test:fcurveVisible` are counted once at their final values.)

`tsc --noEmit` clean at every commit boundary.

## New patterns this session

1. **Preflight readers** (`wouldHide* / wouldReveal* /
   wouldChannelDelete*`) — mirror mutation logic exactly, no writes.
   Dispatcher reads live state via `useProjectStore.getState()`,
   short-circuits before `update()` if no change. Avoids phantom
   undo entries.

2. **Snapshot-and-filter for cross-store cleanup** — when an operator
   touches state in store A (project) that has downstream consumers
   in store B (selection), snapshot the resolution state in B
   BEFORE the mutation in A, then surgically remove only the
   dangling references afterward.

3. **Region-routed keymap dispatch** — `regionHoverRef.current`
   updated by sidebar pointer events; `onKeyDown` branches gate
   on it for keys with different meanings per region (A/Alt+A/Ctrl+I
   from Slice 5.K, X/Delete from Slice 5.N). Known limitation
   documented (keyboard-only navigation falls through to default
   region — deferred fix needs sidebar focus tracking).

## Owed manual browser verification (cumulative)

Each slice's close-out doc lists 10–15 specific flows. Aggregate
themes:

- **Modal + menu + input guards** — every new keymap branch sits
  after the universal guards in `onKeyDown`. Verify no regressions.
- **Sister-field preservation** — bulk operations (hide, reveal,
  delete) should NOT touch unrelated per-FCurve flags (mute,
  activeKeyformIndex, etc.). Asserted in tests.
- **Undo correctness** — both preflight readers (5.M + 5.N) need
  manual verification that no-op presses leave Ctrl+Z unchanged.
- **Cross-store cleanup** (Slice 5.N HIGH-A1 fix) — needs flows
  with viewport selection ALSO active to confirm surgical removal.

## Documented SS deviations (cumulative across session)

| Slice | # | Deviation | Closure condition |
|-------|---|-----------|-------------------|
| 5.L   | 1 | No channel-flag side-effect on keyform INVERT | `project_ss_is_embryo` |
| 5.L   | 2 | No FCURVE_ACTIVE save/restore | per-fcurve ACTIVE slot |
| 5.L   | 3 | Hidden curve entry preservation differs from Blender | symmetric with operatorSelectAll precedent |
| 5.M   | 1 | No FCURVE_ACTIVE clearing on hide | per-fcurve ACTIVE slot |
| 5.M   | 2 | No Industry-Compatible keymap (Ctrl+H) | SS keymap-preset selector |
| 5.M   | 3 | No FCurveGroup flushing | FCurveGroup datablock |
| 5.N   | 1 | No Industry-Compatible Backspace binding | SS keymap-preset selector |
| 5.N   | 2 | No container-channel walk | Container datablocks per type |

## Queued resume paths

Slice 5.K shipped with 14 queued paths. Status now:

| # | Path | Status |
|---|------|--------|
| 1 | Ctrl+I keyform invert | **SHIPPED in 5.L** |
| 2 | GRAPH_OT_hide / GRAPH_OT_reveal | **SHIPPED in 5.M** |
| 3 | Operators-on-selected-channels | **PARTIALLY SHIPPED in 5.N** (delete half; mute half = new path #3.MUTE) |
| 3.MUTE | Shift+W → channels_setting_toggle menu | NEW TOP — needs channels-context menu UI |
| 4 | Footer wiring for fcurve channel state | queued |
| 5 | N-panel active-keyform numerical editor | queued |
| 6 | Driver variable list / expression editor | queued |
| 7 | SIPO_DRAWTIME seconds-vs-frames toggle | queued |
| 8 | USER_FLAG_NUMINPUT_ADVANCED | queued |
| 9 | Group-level mute (AGRP_MUTED) + hide | queued (gated on FCurveGroup) |
| 10 | DopesheetEditor row-state styling | queued |
| 11 | Per-fcurve ACTIVE slot | queued (would close 5.K MED-A1 + 5.L Dev 2 + 5.M Dev 1) |
| 12 | ANIM_OT_channels_select_box drag-rect on sidebar | queued |
| 13 | Phase 2 owed-manual verification | queued |
| 14 | Phase 3 — F-Curve modifiers | queued |

New paths discovered this session:

| # | Path | Closes |
|---|------|--------|
| 15 | SS keymap-preset selector | Slice 5.M Dev 2 + Slice 5.N Dev 1 |
| 16 | Hide/reveal toast notifications | UX polish from Slice 5.M architecture audit |
| 17 | Sidebar focus tracking for region-aware keys | Slice 5.N MED-A2 + retroactively fixes Slice 5.K keyboard-only gap |

## Pre-compact state

| Field             | Value                                                  |
|-------------------|--------------------------------------------------------|
| Branch            | `master`                                               |
| Working tree      | clean                                                  |
| Commits ahead     | **42 commits ahead of `origin/master`**                |
| `tsc --noEmit`    | clean                                                  |
| Affected tests    | 758/758 pass across 10 suites                          |
| **Fidelity streak** | **4 consecutive zero-fab slices** (5.K → 5.L → 5.M → 5.N) |
| Architecture HIGHs caught | 2 (5.M no-op undo; 5.N selection overreach) — both fixed same-day |
| Audit-fix sweeps total | **34** across the project lifetime                 |
| Next path (top queued) | **#3.MUTE** — `anim.channels_setting_toggle` (Shift+W → menu picker for MUTE/VISIBLE/PROTECT). Needs channels-context menu UI scoping. |

## Session lessons (internalized for next session)

1. **Preflight readers are not optional for undo-bearing ops.**
   `updateProject` pushes snapshots unconditionally. Every new
   operator that goes through `update()` (no `skipHistory: true`)
   needs a preflight reader to gate the call. Slice 5.M MED → HIGH
   trajectory shows what happens without one.

2. **`.clear()` on selection-store is almost always overreach.**
   When cleanup is needed, snapshot the resolution state first,
   then surgically remove only the dangling items. Preserve
   unrelated selections.

3. **Architecture audit and Blender-fidelity audit produce
   non-overlapping signal.** Architecture caught HIGHs in 5.M + 5.N
   that fidelity didn't flag (correctness gaps outside the port
   layer). Fidelity caught LOW citation nits that architecture
   ignored. Running both in parallel after every substrate commit
   continues to pay off — not a single false-positive run.

4. **Region-routed keymap dispatch is a recurring pattern.** Slice
   5.K, 5.L, 5.M (timeline-only), 5.N (region-aware) all rely on
   `regionHoverRef`. The known keyboard-navigation gap is now a
   queued path (#17) and should be lifted across all region-aware
   keys at once — not patched per-slice.

5. **Path #3 wasn't atomic.** "Bulk mute/unmute/delete/hide" was
   one path on paper; in practice DELETE was small (Slice 5.N)
   while MUTE needs a whole menu UI infrastructure. Splitting paths
   at the UI-infra boundary keeps slices Rule-№1-compliant.
