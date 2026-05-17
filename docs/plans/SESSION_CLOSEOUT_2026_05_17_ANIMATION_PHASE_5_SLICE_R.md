# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.R

**Scope:** Active Keyframe N-panel — handle + easing editor.
Extends the 5.Q always-on fields (Interpolation + Time + Value) with
the 4 conditional sections from Blender's `graph_panel_key_properties`
(`graph_buttons.cc:365-610`):

1. **Easing direction** dropdown (Auto/In/Out/InOut) — visible when
   current kf's `ipo > BEZT_IPO_BEZ` (named easings)
2. **Easing extras** — `back` for BACK, `amplitude` + `period` for ELASTIC
3. **Left handle** (Type + Frame + Value) — visible when previous kf is bezier
4. **Right handle** (Type + Frame + Value) — visible when current kf is bezier

Closes Slice 5.Q Deviation 1.

**Path resumed:** #5.R (top queued from
`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICES_O_P_Q.md`).

## Commits (1 this slice — folded substrate + audit-fix)

| SHA       | Subject                                                                |
|-----------|------------------------------------------------------------------------|
| `32caf15` | feat(anim): Animation Phase 5 Slice 5.R — Active Keyframe handle + easing editor |

Audit fixes folded into the same commit per the sweep policy — the
visual-regression fix for ELASTIC defaults could not safely ship as a
follow-up commit because the panel display-fallback constants and the
eval substrate constants need to flip together. Test suite + tsc green
across both states; the single commit is the lowest-risk path.

## What shipped

### Extended data module (`src/v3/editors/fcurve/activeKeyformPanelData.js`, +~390 LOC)

- **`resolveActiveKeyformContext`** extended to return `{fcurve,
  kfIndex, kf, prevKf}`. `prevKf` is `null` for `idx=0` (SS is stricter
  than Blender's self-as-prev sentinel — see LOW-B2 closure below).
- **5 visibility predicates** — `shouldShowLeftHandleSection`,
  `shouldShowRightHandleSection`, `shouldShowEasingDirection`,
  `shouldShowBackExtras`, `shouldShowElasticExtras`. Each mirrors a
  specific gate in `graph_panel_key_properties` 1:1.
- **`readHandleCoord`** — read accessor with sparse-default fallback
  to `{kf.time, kf.value}` matching `upsertKeyframe`'s initialization.
- **`applyEditKeyformHandleType` + preflight** — write side-type, run
  the `BKE_fcurve_update_handle_flag_from_opposite` port (see MED-B3
  closure), then `recalcKeyformHandles`. Whole-object sparse: when
  both sides land on 'auto', delete the entire `handleType` field.
- **`applyEditKeyformHandleCoord` + preflight** — routes through
  Slice 5.B's `applyHandleDrag` (encodes `BKE_nurb_bezt_handle_test`
  side effects: AUTO/AUTO_ANIM → ALIGN on BOTH sides; VECT → FREE
  on dragged side; opposite-side aligned mirror), then sort + recalc.
- **`applyEditKeyformEaseMode` + preflight** — sparse-discipline:
  'auto' DELETES the field.
- **`applyEditKeyformEasingExtra` + preflight** — back/amplitude/period
  shared via `EASING_EXTRA_DEFAULTS` dispatch table. Sparse-default
  values now match Blender (1.70158 / 0.8 / 4.1 — fixed in audit-fix
  HIGH-B1).
- **Internal `updateHandleFlagFromOpposite` helper** — 25-line port
  of Blender's `BKE_fcurve_update_handle_flag_from_opposite`
  (`fcurve.cc:1233-1267`). Pure function over `handleType`.

### Extended React component (`src/v3/editors/fcurve/ActiveKeyformPanel.jsx`, +~150 LOC)

- `EASING_DIRECTIONS` constant — 4-entry enum, labels reproduced
  verbatim from `rna_fcurve.cc:118-143` ("Automatic Easing" / "Ease In"
  / "Ease Out" / "Ease In and Out").
- 4 new dispatchers (`onEditEaseMode`, `onEditEasingExtra`,
  `onEditHandleType`, `onEditHandleCoord`) — all using the
  preflight-before-update pattern. All hooks hoisted above the
  `!ctx` early return.
- Conditional section render — order matches Blender's panel order:
  interpolation → easing direction → easing extras → key frame coords
  → left handle → right handle.

### Wire-up (`src/v3/editors/fcurve/FCurveEditor.jsx`, +1 line)

- `handleTypes={HANDLE_TYPES}` prop pass at the ActiveKeyformPanel
  mount site. `HANDLE_TYPES` already defined for the existing V-menu
  (Slice 5.B).

### Eval substrate fix (`src/anim/fcurveEval.js`, ~25 LOC delta)

- `DEFAULT_ELASTIC_AMPLITUDE` flipped from `0` → `0.8`
- `DEFAULT_ELASTIC_PERIOD` flipped from `0` → `4.1`
- Cite corrected to `animrig/intern/fcurve.cc:338-345`. Audit-fix
  HIGH-B1 — see Streak status below.

### Tests (`scripts/test/test_activeKeyformPanelData.mjs`, +~360 LOC)

**188 assertions** (70 baseline + 118 new) covering:

| Class | Tests |
|-------|-------|
| 5.Q baseline (resolve, value, frame, interpolation, symmetry) | 70 |
| `resolveActiveKeyformContext` — `prevKf` shape (null at idx=0; keyform at idx-1) | 4 |
| 5 visibility predicates — exhaustive coverage of all 13 interp types | 24 |
| `readHandleCoord` — sparse fallback, both sides, bad-input guards | 8 |
| `applyEditKeyformHandleType` — preflight, write, MED-B3 port (auto/free/vector/auto_clamped opposite-side flips), sparse-delete, bad-input | 16 |
| `applyEditKeyformHandleCoord` — preflight, same-coord, AUTO→ALIGN both, value vs time axis, bad-input | 12 |
| `applyEditKeyformEaseMode` — preflight, sparse→auto, sparse→in, in→auto (DELETE), same | 8 |
| `applyEditKeyformEasingExtra` — preflight, sparse=default (0.8/4.1 post-HIGH-B1), write non-default, explicit→default (DELETE), bad field | 18 |
| 5.R preflight↔mutator symmetry loop | 8 |
| **TOTAL** | **188** |

## Streak status

| Audit | Findings | Notes |
|-------|----------|-------|
| Architecture | 0 HIGH, 2 MED (dead-guard + sparse-fab false-alarm), 1 LOW (sort-no-op) | All addressed; MED-A2 (sparse-fab) was actually a misread of SS convention. |
| Blender-fidelity | **3 HIGH** (1 real + 2 fab cites), 3 MED, 2 LOW | **HIGH-B1 = real visual regression: ELASTIC defaults wrong since Phase 2.C**; HIGH-B2 + HIGH-B3 = fab cites; MED-B3 = ported helper claimed un-portable. |

### HIGH-B1 — ELASTIC defaults visual regression (REAL substrate bug)

`DEFAULT_ELASTIC_AMPLITUDE = 0` and `DEFAULT_ELASTIC_PERIOD = 0`
have been wrong since Phase 2.C. Blender's `animrig/intern/fcurve.cc:340/344/345`:

```c
beztr->back = 1.70158f;
beztr->amplitude = 0.8f;
beztr->period = 4.1f;
```

The comment in Blender explicitly notes "Values here were hand-optimized
for a default duration of ~10 frames (typical motion-graph motion
length)." With SS's `0`/`0`:
- `amplitude=0` zeroes the sine envelope → degenerate flat-line ELASTIC
- `period=0` forces div-by-zero protection paths in `elastic_in/out/inout`

Anyone porting a Blender motion file with ELASTIC interpolation would
see flat segments where Blender has the characteristic bounce. Fix
ripples to:
- `src/anim/fcurveEval.js` — `DEFAULT_ELASTIC_AMPLITUDE/PERIOD` constants
- `src/v3/editors/fcurve/activeKeyformPanelData.js` — `EASING_EXTRA_DEFAULTS`
- `src/v3/editors/fcurve/ActiveKeyformPanel.jsx` — display-fallback constants
- `scripts/test/test_activeKeyformPanelData.mjs` — sparse-equality
  assertions (was asserting `0`/`0` was no-op; now asserts `0.8`/`4.1`
  is no-op)

The pre-existing `feedback_blender_reference_strict` rule was working
as intended — the fidelity audit lane surfaced this latent bug as part
of the same sweep that introduced the panel's new amplitude/period
input fields.

### HIGH-B2 + HIGH-B3 — Fab cites (the 5.P → 5.R repeat)

Two more fabricated Blender citations in the new 5.R docstrings:

- `isEasingInterpolation` JSDoc cited `DNA_anim_enums.h` with wrong
  enum order (SINE=3, ELASTIC=12). Actual file is `DNA_curve_enums.h:200-217`
  with verified order (BEZ=2, BACK=3, BOUNCE=4, CIRC=5, CUBIC=6,
  ELASTIC=7, EXPO=8, QUAD=9, QUART=10, QUINT=11, SINE=12). The
  runtime predicate `> 'bezier'` was still correct (all 10 named
  easings have ordinals 3-12), so the doc-only fix doesn't move
  behaviour — but the rationale was load-bearing for any future
  refactor.
- `EASE_MODE_DEFAULT` cited `rna_curve.cc`; real enum lives in
  `rna_fcurve.cc:118-143`.

**Streak status: BROKEN AGAIN at 5.R, same shape as 5.P** — "claim
Blender struct/enum location without opening the file." The
generalization of `feedback_modifier_binding_check_keymap_first`
from Slice 5.P remains the right discipline. The audit lane keeps
catching the violations but the substrate author keeps committing
unverified cites.

### MED-B3 — `BKE_fcurve_update_handle_flag_from_opposite` portability

The initial substrate documented this helper as deferred:
> "porting it requires the BezTriple selection-flag model SS doesn't yet have"

Re-reading `fcurve.cc:1233-1267` shows the helper has **zero
selection-flag dependency** — pure 25-line switch on the source-side
handle-type enum that writes the target-side handle-type. Trivially
portable today; the "needs X" claim was a false barrier. Ported as
`updateHandleFlagFromOpposite` in `activeKeyformPanelData.js` and
invoked from `applyEditKeyformHandleType`.

**Behavioural impact**: previously, picking 'aligned' on the LEFT
side via the dropdown left RIGHT at 'auto' — the aligned LEFT had
no aligned partner so subsequent drags wouldn't mirror. Post-port,
picking 'aligned' on LEFT promotes RIGHT to 'aligned' too (matches
Blender). The sparse-delete branch simplified accordingly: setting
one side to 'auto' propagates to the opposite and collapses to a
deleted handleType in one edit instead of two.

### MED-B1 — Label parity

Blender's `rna_enum_beztriple_interpolation_easing_items` item for
`BEZT_IPO_EASE_AUTO` is labeled `"Automatic Easing"` (`rna_fcurve.cc:123`).
SS had it as `"Automatic"`. Corrected to verbatim Blender label.

### MED-B2 — Selection-flag VECT→FREE divergence

`applyHandleDrag` (Slice 5.B helper) runs VECT→FREE unconditionally;
Blender's `BKE_nurb_bezt_handle_test_calc_flag` at `curve.cc:4073-4082`
gates it on partial-selection (XOR with center flag). For the N-panel
edit path the gate is equivalent (each panel input is logically a
single-side single-axis change = partial selection in Blender terms).
Documented as deviation in `applyEditKeyformHandleCoord` JSDoc.

### MED-A1 — Dead defense-in-depth guards (audit-pinned)

The `{showLeftHandle && leftHandle && (…)}` and right-handle equivalents
in the JSX are dead in the current `readHandleCoord` null-contract —
when `showLeftHandle` is true (which requires `ctx` non-null), the
helper falls through to the kf-coords default and returns non-null.
Kept as TypeScript-narrowing aids with audit-pin comments so a future
`readHandleCoord` null-contract change surfaces here.

### MED-A2 — Sparse-fab false alarm

The architecture audit flagged `applyEditKeyformHandleType` for writing
`right: 'auto'` explicitly when only `left` was changed from sparse.
Re-reading the SS convention in `upsertKeyframe` (`fcurve.js:197-199`)
and the existing `setHandleType` operator (`graphEditOps.js:531-541`):
SS uses **whole-handleType-or-nothing** sparsity, not per-side sparsity.
Both writers in the codebase write both sides whenever the object
exists. The audit recommendation would have introduced a per-side
sparse shape inconsistent with the rest of the codebase. Not a bug.

### LOW-B2 — First-keyform left-handle parity

`resolveActiveKeyformContext` returns `prevKf = null` for `idx=0`.
Blender's `get_active_fcurve_keyframe_edit` (`graph_buttons.cc:270-271`)
computes `prev_index = max_ii(idx-1, 0)` so for the first kf,
`prevbezt = active kf itself` (self-as-prev), and the
`shouldShowLeftHandleSection` gate at `graph_buttons.cc:479` fires
iff the active kf's own `ipo` is bezier.

SS is **stricter** — hides the left-handle section on the first kf
even when bezier. Acceptable today: first-kf-left-handle is only
meaningful for cyclic / wrapped curves, which SS doesn't ship yet
(Phase 3 F-Modifier `Cycles` queued). The docstring's prior overclaim
("identical without the awkward self-as-prev sentinel") corrected
to "stricter — hides first-kf left-handle".

## Documented SS deviations (5 new — cumulative session total now 22)

| # | Deviation | Closure condition |
|---|-----------|-------------------|
| 5.R Dev 1 | First-keyform left-handle section hidden (Blender shows it via `max_ii` self-as-prev) | Phase 3 F-Modifier `Cycles` |
| 5.R Dev 2 | `applyHandleDrag` VECT→FREE unconditional (Blender gates on partial-selection) | Future BezTriple selection-flag model port |
| 5.R Dev 3 | Sort runs unconditionally in `applyEditKeyformHandleCoord` (always a no-op for handle edits) | None — symmetry with frame/value recipes |
| 5.R Dev 4 | No `HD_ALIGN_DOUBLESIDE` handling in `updateHandleFlagFromOpposite` port | When SS surfaces aligned-double-side; not on roadmap today |
| 5.R Dev 5 | Sparse-default elastic amplitude/period was 0/0 pre-audit (visual regression); now matches Blender's 0.8/4.1 | CLOSED in HIGH-B1 fix |

Cumulative session deviations:

| Slice | Count |
|-------|-------|
| 5.L   | 3     |
| 5.M   | 3     |
| 5.N   | 2     |
| 5.O   | 3     |
| 5.P   | 2     |
| 5.Q   | 4     |
| 5.R   | 5     |
| **Total** | **22** |

## Owed manual browser verification

- **Open FCurveEditor, select a non-bezier keyform, press N** → panel
  shows Interpolation + Time + Value only (no easing direction, no
  handle sections). Sanity check that 5.Q baseline still works post-extension.
- **Change interpolation to 'back'** → "Back" field appears with
  default 1.70158.
- **Change to 'elastic'** → "Amplitude" (0.8) + "Period" (4.1) fields
  appear. **Critical regression check**: type a frame between two
  elastic keyforms and confirm the value curve has the characteristic
  elastic bounce (post-HIGH-B1 fix). Pre-fix this was a degenerate
  flat line.
- **Change to 'bezier'** → "Right Type" + "Right Time" + "Right Value"
  fields appear. Edit the right handle's value and confirm AUTO
  handles flip to ALIGN on both sides (panel re-renders showing
  "Aligned" in the Right Type dropdown immediately).
- **Active kf is at index ≥ 1, prev kf is bezier** → "Left Type" + "Left
  Time" + "Left Value" rows appear. Edit and confirm same AUTO→ALIGN
  both-sides flip.
- **Pick 'aligned' for Left Type** → Right Type immediately becomes
  'aligned' too (MED-B3 port). Pick 'free' for Right → Left does NOT
  re-promote to aligned (the helper only flips opposite when source
  is in {AUTO/ALIGN/AUTO_ANIM/ALIGN_DOUBLESIDE} OR FREE/VECT with
  opposite not already in {FREE/VECT}; here source=FREE, opposite was
  freshly aligned, so opposite → FREE).
- **Pick 'auto' for one side after both were 'aligned'** → both
  collapse to auto in one edit and the field is DELETED in saved
  JSON (whole-object sparse discipline).
- **N panel still closed at app startup** (matches Blender default).

## Queued resume paths

Status after this slice:

| # | Path | Status |
|---|------|--------|
| 1-4 | Earlier slices | SHIPPED |
| 5 | N-panel active-keyform numerical editor (MVP) | SHIPPED in 5.Q |
| 5.R | Active Keyframe handle editing + easing | **SHIPPED in 5.R (this slice)** |
| 6 | Driver variable list / expression editor | **NEW TOP** |
| 7 | SIPO_DRAWTIME seconds-vs-frames toggle | queued (closes 5.Q Dev 3) |
| 8 | USER_FLAG_NUMINPUT_ADVANCED | queued |
| 9 | Group-level mute + hide | queued (FCurveGroup gate) |
| 10 | DopesheetEditor row-state styling | queued |
| 11 | Per-fcurve ACTIVE slot | queued |
| 12 | ANIM_OT_channels_select_box drag-rect on sidebar | queued |
| 13 | Phase 2 owed-manual verification | queued |
| 14 | Phase 3 — F-Curve modifiers | queued (closes 5.R Dev 1 via Cycles) |
| 15 | SS keymap-preset selector | queued (closes 5.M Dev 2 + 5.N Dev 1 + 5.O Dev 2) |
| 16 | Hide/reveal toast notifications | queued |
| 17 | Sidebar focus tracking for region-aware keys | queued |
| 18 | Popup-menu primitive | queued (paired with PROTECT) |
| 19 | `fcurve.protected` (FCURVE_PROTECTED port) | queued |
| 20 | N-panel collapse-state persistence + multi-panel host | queued |
| **21 (NEW)** | BezTriple selection-flag model + `HD_ALIGN_DOUBLESIDE` | NEW — would close 5.R Dev 2 + Dev 4; lifts the partial-selection gate in `applyHandleDrag` |
| **22 (NEW)** | Pre-verify cite discipline for substrate authors | NEW — workflow item: substrate author should grep + open every Blender citation BEFORE the audit catches it; the fidelity lane shouldn't be the first line of defense for cite drift |

## Pre-compact state

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead | **54 commits ahead of `origin/master`** (was 53 pre-slice) |
| `tsc --noEmit` | clean |
| Affected tests | 188/188 (5.R suite); **1029/1029** across 12 phase-5 suites |
| Fidelity streak | 0 — broken at 5.P, broken AGAIN at 5.R with 2 fab cites + 1 real visual-regression bug. Audit lane is doing its job but the substrate author isn't pre-verifying. |
| Architecture HIGHs caught | 0 this slice (clean) |
| Audit-fix sweeps total | **38** across the project lifetime |
| Cumulative session deviations | 22 (3+3+2+3+2+4+5 across 5.L→5.R) |
| Bonus this slice | Real visual-regression closure — ELASTIC interpolation was degenerate flat-line since Phase 2.C; fidelity audit surfaced this from a panel-default tracing exercise. |
| Next path (top queued) | **#6** — Driver variable list / expression editor. |

## Slice lessons (internalized for next session)

1. **Audit lanes find inherited bugs.** HIGH-B1 was a Phase 2.C
   substrate bug that lay dormant for weeks because no UI surfaced
   the elastic amplitude/period parameters. The instant Slice 5.R
   added the panel inputs, the fidelity audit traced the defaults
   to Blender, opened `fcurve.cc:338-345`, and surfaced the
   divergence. **Every new UI is a tracer for stale data-layer
   constants.** When adding a UI for a previously-headless field,
   the audit must trace the field back to its data-layer source
   AND verify the source against Blender.

2. **"Needs X" is a claim that requires verification.** MED-B3's
   "porting requires the BezTriple selection-flag model" was a
   wrong barrier — the helper is a 25-line switch with zero
   selection deps. The cost of opening `fcurve.cc:1233-1267` to
   verify is ~30s; the cost of leaving the helper unported is a
   real user-facing bug (asymmetric handle pairs after dropdown
   edits). **Treat every "requires X" claim in substrate JSDoc as a
   testable assertion: open the cited file, read the function body,
   confirm or refute the claim.**

3. **Fab cites are persistent.** Slice 5.P broke the 5-run zero-fab
   streak. Slice 5.R broke it AGAIN, same shape: claim a Blender
   struct/enum location, ship without opening the file. The
   generalization of `feedback_modifier_binding_check_keymap_first`
   from 5.P is the right discipline but isn't being applied
   substrate-side. **Suggested workflow: grep the reference for the
   cited symbol BEFORE writing the JSDoc, paste the line range into
   the docstring, then read the docstring back against the grep
   output.** The 5-second check at substrate-time saves 60+ seconds
   of audit-fix later.

4. **SS conventions differ from "ideal" conventions.** MED-A2's
   architecture flag for "writing `right: 'auto'` explicitly" was a
   misread — SS uses whole-handleType-or-nothing sparsity (visible
   in `upsertKeyframe`, `setHandleType`, every existing
   `handleType` writer). The audit recommendation would have
   introduced per-side sparsity inconsistent with the rest of the
   codebase. Before applying a sparse-discipline fix, **check what
   the existing writers do** — schema convention beats theoretical
   purity.

5. **Bonus visual fix > silent visual fix.** Folding the
   ELASTIC-defaults regression into the 5.R commit (rather than
   shipping it as a follow-up "fix(anim): correct ELASTIC defaults"
   commit) keeps the audit-fix attribution visible in the slice
   close-out. A separate commit would have hidden the discovery
   in git log noise — the visible attribution surfaces the lesson
   for the next session.
