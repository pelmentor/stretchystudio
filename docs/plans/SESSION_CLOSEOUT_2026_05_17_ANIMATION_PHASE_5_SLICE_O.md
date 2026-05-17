# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.O

**Scope:** Bulk channel-mute keymap (sidebar Shift+W / Ctrl+Shift+W /
Alt+W). Ports Blender's three `anim.channels_setting_*` operators
with `setting=ACHANNEL_SETTING_MUTE`.

**Path resumed:** #3.MUTE (top queued path from Slice 5.N close-out
`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICES_L_M_N.md`).
Sister of paths #1 (Ctrl+I → 5.L), #2 (H/Shift+H/Alt+H → 5.M),
#3 channel-delete half (X/DEL sidebar → 5.N).

## Commits (2 this slice)

| SHA       | Subject                                                          |
|-----------|------------------------------------------------------------------|
| `b1f8ad9` | feat(anim): Animation Phase 5 Slice 5.O — bulk channel mute      |
| `14c7f50` | fix(audit): Animation Phase 5 Slice 5.O dual-audit sweep — 2 LOW |

## What shipped

### Substrate (`src/anim/fcurveMute.js` +200 LOC)

- **`applyChannelMuteSelected(action, mode)`** — bulk-flip `mute` on
  every selected fcurve. `mode = 'toggle' | 'enable' | 'disable'`.
  Returns `{changed, mutedCount, unmutedCount, resolvedMode}`.
- **`wouldChannelMuteSelectedChange(action, mode)`** — preflight
  reader symmetric with the mutator. Same phantom-undo gate pattern
  as Slice 5.M `wouldHideChangeFCurves` and Slice 5.N
  `wouldChannelDeleteSelectedChange`.
- **`resolveToggleDirection(selectedFCurves)`** — internal helper;
  default 'enable', flips to 'disable' on first muted fcurve found.
  Mirrors Blender `setflag_anim_channels:2968-2980` (TOGGLE scan-first).
  **Single decision point** prevents preflight/mutator drift.
- **`collectSelectedFCurves(action)`** — internal helper; iterates
  `fc.selected === true`. No `isFCurveHidden` skip (sidebar uses
  `ANIMFILTER_LIST_VISIBLE`, not `ANIMFILTER_CURVE_VISIBLE`).

### Dispatcher + keymap (`src/v3/editors/fcurve/FCurveEditor.jsx`)

- **`applyChannelMuteOp(mode)`** — reads live state via
  `useProjectStore.getState()`, runs preflight, short-circuits before
  `update()` if no change. Calls `update(recipe)` without
  `skipHistory:true` (mute is data not view state — matches Blender's
  `OPTYPE_UNDO` on all three operators at `anim_channels_edit.cc:3053`,
  `:3079`, `:3105`).
- **3 new `onKeyDown` branches**, all gated on
  `regionHoverRef.current === 'sidebar'`:
  - `Shift+W` (no Ctrl, no Alt, no Meta) → `'toggle'`
  - `Ctrl+Shift+W` (Shift+Ctrl or Shift+Meta on Mac, no Alt) → `'enable'`
  - `Alt+W` (no Ctrl, no Shift, no Meta) → `'disable'`
- `useCallback` deps array extended with `applyChannelMuteOp`.

### Tests (`scripts/test/test_fcurveMute.mjs`)

**38 → 124 assertions (+86).** New coverage:

| Class | Tests |
|-------|-------|
| ENABLE × all-target / all-already / mixed | 9 |
| DISABLE × all-target / all-already / sparse-preserved | 8 |
| TOGGLE × all-unmuted / all-muted / mixed (scan-first DISABLE) | 13 |
| No-selection × 3 modes | 12 |
| Guards: null action / null fcurves / invalid mode | 7 |
| Sparse / null fcurve entries tolerated | 4 |
| Hidden + selected curve still acted on | 3 |
| Preflight symmetry × 4 scenarios × 3 modes | 25 |
| Driver-bearing curve mute-toggleable | 2 |
| Pre-existing 5.G tests preserved | 38 |
| **TOTAL** | **124** |

## Streak status

| Audit | Findings | Streak |
|-------|----------|--------|
| Architecture | 0 HIGH, 0 MED, 2 LOW (header provenance only) | held at 0 HIGH |
| Blender-fidelity | 0 HIGH, 0 MED, 0 LOW — completely clean | **5** zero-fab |

**Fidelity zero-fab streak now at 5 consecutive slices** (5.K → 5.L →
5.M → 5.N → 5.O). `feedback_modifier_binding_check_keymap_first`
discipline continues to pay off — every Blender citation was re-grepped
and verified by the fidelity agent.

Architecture audit caught only cosmetic provenance (module headers
needing 5.O attribution). No correctness issues, no integration issues,
no Rule №1 / Rule №2 violations. Fixed in `14c7f50` with
LOW-A1 + LOW-A2 attribution.

## Patterns reused (zero new this slice)

- **Preflight readers** (Slice 5.M template): `wouldChannelMuteSelectedChange`
  + dispatcher short-circuit. No phantom undo on no-op presses.
- **Region-routed keymap dispatch** (Slice 5.K/5.L/5.M/5.N pattern):
  W branches gated on `regionHoverRef.current === 'sidebar'`. Same
  known limitation (keyboard-only nav falls through to default region;
  queued as path #17).
- **Shared resolution function** (new template, but architecturally
  a continuation of the preflight pattern): preflight and mutator
  both call `resolveToggleDirection` so TOGGLE semantics can't drift.

## Documented SS deviations (3 new — cumulative session total now 11)

| # | Deviation | Closure condition |
|---|-----------|-------------------|
| 5.O Dev 1 | No type-picker menu (Blender pops `{PROTECT, MUTE}` enum via `WM_menu_invoke`) | PROTECT slice + popup-menu primitive (path #18) |
| 5.O Dev 2 | No Industry-Compatible keymap support | SS keymap-preset selector (path #15) |
| 5.O Dev 3 | No FCurveGroup flush after per-channel write | FCurveGroup datablock (sister to AGRP_MUTED gap) |

Cumulative session deviations (this `/compact`-resumed session):

| Slice | Count |
|-------|-------|
| 5.L   | 3     |
| 5.M   | 3     |
| 5.N   | 2     |
| 5.O   | 3     |
| **Total** | **11** |

## Owed manual browser verification

Standard set (same shape as Slice 5.N's owed verification):

- **Sidebar Shift+W on single muted fcurve** → unmutes (scan-first
  picks DISABLE because that one curve is muted; uniform-flip with
  size=1).
- **Sidebar Shift+W on multi-selection all-unmuted** → all mute.
- **Sidebar Shift+W on multi-selection all-muted** → all unmute.
- **Sidebar Shift+W on mixed** → all unmute (scan-first finds muted →
  DISABLE direction).
- **Sidebar Ctrl+Shift+W on mixed** → all mute (no scan; uniform ADD).
- **Sidebar Alt+W on mixed** → all unmute (no scan; uniform CLEAR).
- **Sidebar W (no modifiers)** → no-op (no SS binding, no Blender
  binding either).
- **Timeline-region Shift+W** → no-op (sidebar-region only).
- **No selection + sidebar Shift+W** → no-op AND no Ctrl+Z entry
  consumed (preflight short-circuit).
- **All-already-muted + sidebar Ctrl+Shift+W** → no-op AND no Ctrl+Z
  entry (preflight).
- **Hidden + selected fcurve + sidebar Shift+W** → mute toggles
  (hidden curves still act-on'd).
- **Driver-bearing fcurve + sidebar Shift+W** → mute toggles AND
  driver evaluation immediately stops firing on next eval (verified
  in tests — caller-side eval gate at `evaluateActionFCurves`).
- **Universal guards** (input focus / modal / menu) gate W presses
  the same as every other Slice 5.K-onwards binding.

## Queued resume paths

Status after this slice:

| # | Path | Status |
|---|------|--------|
| 1 | Ctrl+I keyform invert | SHIPPED in 5.L |
| 2 | H / Shift+H / Alt+H | SHIPPED in 5.M |
| 3 | Operators-on-selected-channels (delete half) | SHIPPED in 5.N |
| 3.MUTE | Shift+W / Ctrl+Shift+W / Alt+W | **SHIPPED in 5.O** |
| 4 | Footer wiring for fcurve channel state | queued (top) |
| 5 | N-panel active-keyform numerical editor | queued |
| 6 | Driver variable list / expression editor | queued |
| 7 | SIPO_DRAWTIME seconds-vs-frames toggle | queued |
| 8 | USER_FLAG_NUMINPUT_ADVANCED | queued |
| 9 | Group-level mute (AGRP_MUTED) + hide | queued (FCurveGroup gate) |
| 10 | DopesheetEditor row-state styling | queued |
| 11 | Per-fcurve ACTIVE slot | queued |
| 12 | ANIM_OT_channels_select_box drag-rect on sidebar | queued |
| 13 | Phase 2 owed-manual verification | queued |
| 14 | Phase 3 — F-Curve modifiers | queued |
| 15 | SS keymap-preset selector | queued (closes 5.M Dev 2 + 5.N Dev 1 + 5.O Dev 2) |
| 16 | Hide/reveal toast notifications | queued |
| 17 | Sidebar focus tracking for region-aware keys | queued (closes 5.N MED-A2 + retroactively 5.K + 5.O keyboard-nav gap) |

New paths discovered this slice:

| # | Path | Closes |
|---|------|--------|
| 18 | Popup-menu primitive for FCurveEditor (channels-context type-picker) | 5.O Dev 1 (when paired with PROTECT slice) |
| 19 | `fcurve.protected` (FCURVE_PROTECTED port) | Half of 5.O Dev 1 (other half is #18) |

## Pre-compact state

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead | **45 commits ahead of `origin/master`** (was 43 pre-slice) |
| `tsc --noEmit` | clean |
| Affected tests | 124/124 (5.O fcurveMute); 844/844 across 10 phase-5 suites |
| Fidelity streak | **5 consecutive zero-fab slices** (5.K → 5.L → 5.M → 5.N → 5.O) |
| Architecture HIGHs caught | 0 this slice (held at 0 since 5.N) |
| Audit-fix sweeps total | **35** across the project lifetime |
| Cumulative session deviations | 11 (3+3+2+3 across 5.L/5.M/5.N/5.O) |
| Next path (top queued) | **#4** — Footer wiring for fcurve channel state (counts + active info). Pure UI surface; no new substrate needed. |

## Slice lessons (internalized for next session)

1. **Shared resolution function is the cleanest way to enforce
   preflight/mutator parity** when both need to compute a state-derived
   direction. The previous slices' preflights duplicated the
   mutator's filter+match logic verbatim — that worked for simple
   filters but invited drift. TOGGLE scan-first has enough state to
   make duplication risky; factoring `resolveToggleDirection` into a
   single internal helper that both callers invoke eliminates the
   drift surface structurally. Use this template for any future
   operator with a non-trivial mode-resolution step.

2. **Sidebar W keymap is the third class of region-routed dispatch.**
   - Slice 5.K: A / Alt+A / Ctrl+I → channel select-all (sidebar-only)
   - Slice 5.N: X / DEL → region-dispatch (sidebar=channel delete,
     timeline=keyform delete)
   - Slice 5.O: Shift+W / Ctrl+Shift+W / Alt+W → channel mute
     (sidebar-only)

   The cumulative count of sidebar-gated keymap branches now justifies
   the queued path #17 (sidebar focus tracking) being the next
   architectural lift rather than per-slice point fixes. Documented
   the MED-A2 keyboard-nav gap once more in this slice without
   patching it.

3. **Degenerate menu UI is a real port challenge.** When Blender wraps
   an enum-pick around an N-option menu (PROTECT/MUTE), porting the
   single-option subset cleanly required either:
   - Building a full popup-menu primitive AND a 1-item picker (which
     would crutchify until PROTECT lands), OR
   - Skipping the picker entirely and direct-binding to the only
     supported setting, with the picker becoming part of the future
     PROTECT slice.

   Path (b) chosen — keeps Rule №1 (no crutches) without blocking
   the keymap parity. Documented as Dev 1 with paired path #18 (menu
   primitive) + #19 (`fcurve.protected`) for closure.

4. **2 LOW header-annotation flags from architecture audit is the
   "essentially clean" outcome for a substrate slice extending an
   existing module.** Worth shipping as its own audit-fix commit
   anyway — keeps the convention visible in `git log` and gives
   future audits a "clean baseline" reference point. Per-slice
   commit count holds at 2 (substrate + audit-fix), with the optional
   close-out doc as a 3rd.

5. **Path #3.MUTE was correctly split out** during Slice 5.N (which
   handled only the delete half). The split-at-UI-infra-boundary
   rule (Slice N→O session lesson #5) made 5.O a clean, contained
   substrate-only slice. Without the split, this slice would have
   conflated MUTE substrate with PROTECT + menu UI scope, blowing
   past Rule №1.
