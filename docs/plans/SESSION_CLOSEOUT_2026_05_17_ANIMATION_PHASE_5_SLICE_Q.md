# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.Q

**Scope:** Active Keyframe N-panel — toggleable right-side sidebar
on the FCurveEditor (N key) hosting a numerical editor for the
active keyform's Interpolation type + Time (ms) + Value. Ports
Blender's `GRAPH_PT_key_properties` (`graph_buttons.cc:365-610`
+ `:1434-1438`).

**Path resumed:** #5 (top queued from Slice 5.P close-out
`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_P.md`).

## Commits (2 this slice)

| SHA       | Subject                                                          |
|-----------|------------------------------------------------------------------|
| `a869a5d` | feat(anim): Animation Phase 5 Slice 5.Q — Active Keyframe N-panel |
| `9d63bf3` | fix(audit): Animation Phase 5 Slice 5.Q dual-audit sweep — 2 HIGH + 3 MED |

## What shipped

### New data module (`src/v3/editors/fcurve/activeKeyformPanelData.js`, ~310 LOC)

Pure data layer backing the panel (sister to `fcurveFooterData.js`):

- **`resolveActiveKeyformContext(action, fcurveId)`** →
  `{fcurve, kfIndex, kf}` or `null`. Mirrors Blender's
  `get_active_fcurve_keyframe_edit` (`graph_buttons.cc:253-274`)
  minus the prev-keyform half (deferred with handle editing).
- **`applyEditKeyformValue` + preflight** — direct `kf.value` write,
  THEN `recalcKeyformHandles` (audit-fix HIGH-B1).
- **`applyEditKeyformFrame` + preflight** — `kf.time` write, inline
  re-sort, active-index relocate via Slice 5.H's
  `captureActiveKeyformObject` pattern, THEN `recalcKeyformHandles`.
- **`applyEditKeyformInterpolation` + preflight** — sparse-discipline
  write: `'linear'` value DELETES the field (keeps schema sparse per
  Rule №2); explicit non-linear value writes through.

### New React component (`src/v3/editors/fcurve/ActiveKeyformPanel.jsx`, ~225 LOC)

- `PanelSection` + `FieldRow` + `NumberInput` primitives. Latter has
  commit-on-blur + commit-on-Enter + cancel-on-Escape matching
  Blender's `B_REDR` button retval (`graph_buttons.cc:456`).
- All hooks hoisted above the `!ctx` early return
  (`feedback_hooks_before_early_return` compliance verified by
  architecture audit).
- 3 dispatchers using preflight-before-update pattern (Slice 5.M).

### Wire-up (`src/v3/editors/fcurve/FCurveEditor.jsx`)

- Local `npanelOpen` useState (defaults `false` — matches Blender's
  N-panel default-hidden state per `ARegion->flag` semantics).
- N keybind branch in `onKeyDown` — bare N modifier, fires regardless
  of `regionHoverRef.current` (the WINDOW region is the keymap host
  per `blender_default.py:1958-1962` calling
  `_template_space_region_type_toggle` at `:355-369`).
- NPanel mount as 3rd flex child after Sidebar + right column. Fixed
  256px width (`w-64`) when shown; entirely unmounted when closed.

### Tests (`scripts/test/test_activeKeyformPanelData.mjs`, NEW)

**70 assertions** covering:

| Class | Tests |
|-------|-------|
| `resolveActiveKeyformContext` — guards, NONE sentinel, OOB, resolved | 11 |
| `applyEditKeyformValue` + preflight — no-active, same-value, write, NaN/Infinity | 9 |
| `applyEditKeyformFrame` + preflight — no-active, same-time, mid/forward/backward crossing, NaN/Infinity | 12 |
| `applyEditKeyformInterpolation` + preflight — sparse-default, sparse→bezier, bezier→linear (DELETE), bezier→sine, guard branches | 14 |
| Preflight↔mutator symmetry loop (Slice 5.M HIGH-A1 invariant) | 6 |
| (Test helpers + setup) | 18 |
| **TOTAL** | **70** |

### package.json

- `test:activeKeyformPanelData` script added.

## Streak status

| Audit | Findings | Notes |
|-------|----------|-------|
| Architecture | **1 HIGH** (HTMLSelectElement input-guard gap) + 0 MED + 0 LOW | Latent bug exposed by this slice; fixed in `9d63bf3`. |
| Blender-fidelity | **1 HIGH** (handles_recalc omission) + **2 MED** (citations off) + **1 MED** (undocumented divergence) | Real correctness gap + 2 citation drifts + 1 undocumented divergence; all fixed in `9d63bf3`. |

**Architecture HIGH-A1** — the audit caught a real correctness gap.
The `onKeyDown` guard at FCurveEditor.jsx:2204 checked
`HTMLInputElement` + `HTMLTextAreaElement` but NOT
`HTMLSelectElement`. Slice 5.Q's `<select>` dropdown for interpolation
exposed the gap: pressing N inside the dropdown bubbled up and
toggled the N-panel closed mid-selection. Latent issue affecting
EVERY existing editor keybind (G, S, B, V, T, X, A, H, W…); fixing
the guard once covers all current and future select-bearing
surfaces.

**Fidelity HIGH-B1** — the audit caught a real port-fab. The initial
substrate's `applyEditKeyformValue` omitted `BKE_fcurve_handles_recalc`
with a wrong rationale ("handles_recalc only matters for handles
which this MVP doesn't expose"). Reality: AUTO handle tangent
positions are STORED; they depend on neighboring keyframe values; if
not recomputed after a value edit, the curve shape between this
keyform and its neighbors becomes wrong even though the panel never
shows handles. Mirrors Blender's UNCONDITIONAL recalc call at
`graph_buttons.cc:283`. SS already has `recalcKeyformHandles` (Slice
5.B); imported and called after both value AND frame edits.

**Fidelity MED-B1 + MED-B2** — two off-by-N citation drifts.
`get_active_fcurve_keyframe_edit` was cited as `:245-274` (off by 8;
actual `:253-274`). `INTERPOLATION_TYPES` was cited as
`FCurveEditor.jsx:397-411` (off by 1; actual `:398-412`).
**Continuation of the post-Slice-5.P discipline:** verify EVERY
Blender citation against the actual reference clone before shipping,
not just keymap modifier claims. The audit caught 2 cite drifts this
slice; the substrate author should pre-verify.

**Fidelity MED-B3** — undocumented divergence (default interpolation
Blender BEZ vs SS 'linear'). The divergence predates Slice 5.Q but
the panel's dropdown + preflight surfaces it explicitly. Promoted
from buried preflight comment to named Deviation 4 with closure tied
to a future "match Blender defaults" sweep.

## Pattern reinforced (post-5.P generalization continues)

The fidelity audit caught 2 cite drifts + 1 functional gap this
slice. The Slice 5.P generalization of
`feedback_modifier_binding_check_keymap_first` ("verify ANY Blender
citation against the actual reference clone") is paying off — without
the dedicated fidelity lane, the handles_recalc gap (HIGH-B1) would
have shipped silently and only manifested as wrong curve shapes on
AUTO-handle data, possibly weeks after the fact.

## Documented SS deviations (4 new — cumulative session total now 17)

| # | Deviation | Closure condition |
|---|-----------|-------------------|
| 5.Q Dev 1 | MVP omits handle editing rows + easing direction + easing extras | Slice 5.R adds handle/easing |
| 5.Q Dev 2 | No per-property unit conversion | Future parameter-units system |
| 5.Q Dev 3 | Frame field shows ms (not frames) | Phase 5 #7 SIPO_DRAWTIME toggle |
| 5.Q Dev 4 | Default interpolation 'linear' (not Blender's BEZT_IPO_BEZ) — promoted from buried comment in audit-fix MED-B3 | Future "match Blender defaults" sweep |

Cumulative session deviations:

| Slice | Count |
|-------|-------|
| 5.L   | 3     |
| 5.M   | 3     |
| 5.N   | 2     |
| 5.O   | 3     |
| 5.P   | 2     |
| 5.Q   | 4     |
| **Total** | **17** |

## Owed manual browser verification

- **Open FCurveEditor with no action** → Empty state; pressing N
  toggles `npanelOpen` (panel slot would mount, but the inner
  ActiveKeyformPanel hits its empty-state). Verify panel renders
  "No active keyframe" copy when no keyform is active.
- **N key with focus on the editor wrap** → panel toggles open.
- **N key with focus on a sidebar text input** → no toggle (input
  guard already protected).
- **N key with focus on the interpolation `<select>`** → no toggle
  (audit-fix HIGH-A1; verify the new SelectElement guard fires).
- **Click a keyform handle (Slice 5.H makes it active)** → panel
  populates with Interpolation/Time/Value rows.
- **Type a new value, blur or Enter** → kf.value updates AND AUTO
  handles repositioned (curve shape near the kf should adjust).
- **Type a new time, blur** → kf.time updates AND re-sorts if it
  crosses neighbors; active-index relocation updates the panel.
- **Type the existing value/time, blur** → no Ctrl+Z entry consumed
  (preflight short-circuit).
- **Select 'bezier' from dropdown → 'linear'** → interpolation field
  is DELETED (verify in saved project JSON; sparse discipline).

## Queued resume paths

Status after this slice:

| # | Path | Status |
|---|------|--------|
| 1-3.MUTE | Earlier slices (5.L→5.O) | SHIPPED |
| 4 | Footer wiring | SHIPPED in 5.P |
| 5 | N-panel active-keyform numerical editor | **SHIPPED in 5.Q (MVP)** |
| 5.R | Active Keyframe handle editing (handles + easing direction + easing extras) | NEW TOP — closes 5.Q Dev 1 |
| 6 | Driver variable list / expression editor | queued |
| 7 | SIPO_DRAWTIME seconds-vs-frames toggle | queued (closes 5.Q Dev 3) |
| 8 | USER_FLAG_NUMINPUT_ADVANCED | queued |
| 9 | Group-level mute + hide | queued (FCurveGroup gate) |
| 10 | DopesheetEditor row-state styling | queued |
| 11 | Per-fcurve ACTIVE slot | queued |
| 12 | ANIM_OT_channels_select_box drag-rect on sidebar | queued |
| 13 | Phase 2 owed-manual verification | queued |
| 14 | Phase 3 — F-Curve modifiers | queued |
| 15 | SS keymap-preset selector | queued |
| 16 | Hide/reveal toast notifications | queued |
| 17 | Sidebar focus tracking for region-aware keys | queued |
| 18 | Popup-menu primitive | queued (paired with PROTECT) |
| 19 | `fcurve.protected` (FCURVE_PROTECTED port) | queued |
| **20 (NEW)** | N-panel collapse-state persistence + multi-panel host | NEW — would lift Slice 5.Q's local React state to a per-editor view-state store; non-blocking polish |

## Pre-compact state

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead | **49 commits ahead of `origin/master`** (was 47 pre-slice) |
| `tsc --noEmit` | clean |
| Affected tests | 70/70 (new); 911/911 across 12 phase-5 suites |
| Fidelity streak | 0 (was already 0 post-5.P fab; 5.Q had 1 HIGH + 2 MED on fidelity, all caught + fixed) |
| Architecture HIGHs caught | **1** this slice (HTMLSelectElement guard gap) — latent issue exposed by 5.Q's select dropdown |
| Audit-fix sweeps total | **37** across the project lifetime |
| Cumulative session deviations | 17 (3+3+2+3+2+4 across 5.L/5.M/5.N/5.O/5.P/5.Q) |
| Next path (top queued) | **#5.R** — Active Keyframe handle editing (handle Type + Frame + Value for L+R when bezier; easing direction + easing extras for BACK/ELASTIC). Closes 5.Q Dev 1. |

## Slice lessons (internalized for next session)

1. **Audit-fix patterns generalize across surfaces.** The
   HTMLSelectElement gap was latent in the editor — every existing
   keybind (G, S, B, V, T, X, A, H, W…) was equally affected — but
   only surfaced when Slice 5.Q introduced the first `<select>`
   inside the editor's keymap-handling div. The fix landed once;
   pays dividends for every future `<select>` UI in the editor.
   Worth scanning OTHER editors for the same pattern (timeline,
   viewport sidebar Properties tabs may have the same gap).

2. **"Doesn't expose handles" is not the same as "doesn't need
   handle recalc".** AUTO/AUTO_ANIM handles' tangent positions are
   STORED, not derived at render time, and depend on neighboring
   values. A value edit changes those inputs; without a recalc, the
   stored tangents go stale and the curve shape evaluates wrong.
   The MVP scope decision (omit handle UI) correctly stands —
   but the data-layer's responsibility to maintain handle integrity
   does NOT change with the UI scope. Future "MVP omits X" decisions
   must distinguish UI omission from data-layer omission.

3. **Pre-verify cites before submitting JSDoc.** Slice 5.Q shipped
   with 2 off-by-N citation drifts (`:245` should have been `:253`;
   `:397-411` should have been `:398-412`). These are EXACTLY the
   class of fab the Slice 5.P generalization warns against. The
   audit-fix discipline catches them, but the substrate author
   should grep + verify before shipping — every citation is a
   claim that the line range contains the cited content, and a
   misaligned cite reads as a wrong claim to anyone who follows
   the reference. Continue treating EVERY Blender citation as a
   testable claim, not a decorative reference.

4. **Latent issues > newly introduced issues, when the audit lane
   catches them.** Slice 5.Q's HIGH-A1 (architecture) and HIGH-B1
   (fidelity) both involved code that was ALREADY broken or
   incomplete; the slice just made the breaks visible. The dual-
   audit pattern's value isn't just "did the new code break", it's
   "did the new code surface existing breakage that wasn't visible
   before". Both kinds count toward "ship clean" — fix both classes
   in the audit-fix commit.

5. **MVP scope is a UI choice, not a correctness choice.** When
   choosing what to ship in an MVP, the rule is "ship complete data
   layer + minimum UI surface", not "ship minimum data + minimum
   UI". Slice 5.Q chose to omit handle editing UI but should NEVER
   have omitted the handle-recalc data integrity. Future MVPs:
   data-layer correctness is non-negotiable; UI surface area is
   negotiable.
