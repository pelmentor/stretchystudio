# Session Close-out — 2026-05-17 — Animation Phase 5 Slice 5.J

**Shift+click range-select (SELECT_EXTEND_RANGE port) + Ctrl/Shift mapping correction.**

## Commits

| SHA       | Subject                                                                                                |
| --------- | ------------------------------------------------------------------------------------------------------ |
| `4d8e549` | feat(anim): Animation Phase 5 Slice 5.J — Ctrl+click range-select (SELECT_EXTEND_RANGE) [INVERTED MAP] |
| `835c20b` | fix(audit): Slice 5.J dual-audit sweep — 1 HIGH + 3 MED + 2 LOW (breaks 4-slice zero-fab streak)       |

**Important:** the feature commit `4d8e549` shipped with Shift and Ctrl
inverted vs Blender's keymap. The audit-fix commit `835c20b` corrected
the mapping AND swept all the secondary divergences the auditor caught.
The final shipped behavior is the post-`835c20b` state — Shift+click =
range, Ctrl+click = toggle.

## What shipped

**Feature** ([src/anim/fcurveChannelSelect.js](../../src/anim/fcurveChannelSelect.js)):
- `applyChannelSelect` gained a `'range'` modifier branch that walks
  the sidebar-visible channel list from the active fcurve through the
  clicked one inclusive, selecting every channel in the range.
- Pre-walk wipe scope is the FILTERED visible list (`orderedIds`), not
  the underlying action — matches Blender's
  `ANIM_anim_channels_select_set(EXTEND_RANGE)` operating on
  `anim_channels_for_selection(ac)` at `anim_channels_edit.cc:4236`.
- Auto-downgrade to `'toggle'` when no eligible active exists (null /
  not in `orderedIds`, OR clicked id not in `orderedIds` as an SS-only
  safety net). Mirrors Blender's `anim_channels_edit.cc:4517-4522`
  `animchannel_has_active_of_type` gate.
- Walker mirrors `animchannel_select_range` at
  `anim_channels_edit.cc:3984-4025` — iterate the ordered list, flip
  `in_selection_range` at both bounds, select interior. Adds an SS
  perf optimization that breaks once the range closes (documented as
  a deviation, not a port — Blender keeps iterating).
- Active is NOT elevated on range (line 4247 gate). `makeActive: false`.

**Wire** ([src/v3/editors/fcurve/FCurveEditor.jsx](../../src/v3/editors/fcurve/FCurveEditor.jsx)):
- Sidebar onClick maps `e.shiftKey → 'range'`, `(e.ctrlKey || e.metaKey)
  → 'toggle'`, else `'replace'`. Matches Blender's keymap at
  [blender_default.py:3849-3854](../../reference/blender/scripts/presets/keyconfig/keymap_data/blender_default.py#L3849-L3854).
- `ctx` is built per-click: `{ activeFCurveId, orderedIds: decoded.map(d
  => d.fcurve.id) }`. Documented as caller-built (LOW-A1 audit-fix
  added an explicit "do not hoist into useCallback closure" comment).
- Plain replace-click wipes keyform selection (SS UX extension);
  range + toggle preserve keyforms (cross-channel composition intent).

**Tests** ([scripts/test/test_fcurveChannelSelect.mjs](../../scripts/test/test_fcurveChannelSelect.mjs)):
- 50 → 105 assertions (+55 net across feature + audit-fix).
- New coverage: forward / reverse / single-cell ranges; pre-walk wipe;
  4 auto-downgrade cases (null active, orphan active, clicked-not-in-
  list, missing/empty ctx); 5-channel multi-interior walk; sister-field
  preservation (mute/hide/activeKeyformIndex untouched); null entries
  in orderedIds tolerated; **MED-B1 visible-scope pre-walk** (invisible-
  but-selected curve preserved); **MED-A2 orphan-active bound** (active
  id in orderedIds but missing from action.fcurves).

## Dual-audit table

| ID      | Severity | Auditor      | Finding                                                                                                | Status                |
| ------- | -------- | ------------ | ------------------------------------------------------------------------------------------------------ | --------------------- |
| HIGH-B1 | HIGH     | Blender-fid. | Modifier mapping inverted: Slice 5.F+5.J had Shift=toggle/Ctrl=range; Blender keymap is the opposite.  | FIXED in `835c20b`    |
| MED-B1  | MED      | Blender-fid. | Pre-walk wipe scope too wide — clobbered invisible-but-selected fcurves' `selected` bit.               | FIXED in `835c20b`    |
| MED-B2  | MED      | Blender-fid. | Auto-downgrade rationale conflated 2 invariants; "clicked must be in orderedIds" guard is SS-only.     | DOCUMENTED in `835c20b` |
| LOW-B1  | LOW      | Blender-fid. | Walker early-exit is SS perf opt, not Blender port; should be marked as deviation.                     | DOCUMENTED in `835c20b` |
| MED-A1  | MED      | Architecture | Walker silently skips when active bound id has no fc in action.fcurves; comment needed.                | DOCUMENTED in `835c20b` |
| MED-A2  | MED      | Architecture | Missing regression test for the MED-A1 orphan-bound case.                                              | TEST ADDED in `835c20b` |
| LOW-A1  | LOW      | Architecture | `applyChannelClick` useCallback needs comment pinning "ctx built by caller, don't hoist decoded.map".  | COMMENT in `835c20b`  |

## Citation cross-verification ledger

Streak status: **4-slice zero-fabrication streak BROKEN at Slice 5.J.**
Pattern was: 5.E=0, 5.F=4, 5.G=1, 5.H=0, 5.I=0, **5.J=1** (HIGH-B1's
mis-applied `anim_channels_edit.cc:4636-4641`).

All other citations verified clean on disk before the audit-fix commit
landed:

| Citation                                                                                                                              | Claim                                                                                  | Verified |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| `anim_channels_edit.cc:3984-4025`                                                                                                     | `animchannel_select_range` walker — iterates list, flips `in_selection_range` at bounds | ✅       |
| `anim_channels_edit.cc:4017-4021`                                                                                                     | single-cell range break (active===cursor)                                              | ✅       |
| `anim_channels_edit.cc:4231-4234`                                                                                                     | `SELECT_INVERT` XOR's only clicked curve                                               | ✅       |
| `anim_channels_edit.cc:4236`                                                                                                          | pre-walk `ANIM_anim_channels_select_set(EXTEND_RANGE)`                                 | ✅       |
| `anim_channels_edit.cc:4247`                                                                                                          | active-elevation gate — `(selectmode != SELECT_EXTEND_RANGE)`                          | ✅       |
| `anim_channels_edit.cc:4517-4522`                                                                                                     | auto-downgrade gate — `animchannel_has_active_of_type`                                 | ✅       |
| `anim_channels_edit.cc:662-669`                                                                                                       | "deselect *everything*" comment on `ACHANNEL_SETFLAG_EXTEND_RANGE`                     | ✅       |
| `blender_default.py:3849-3854`                                                                                                        | Animation Channels keymap — Shift=extend_range, Ctrl=extend                            | ✅       |
| `industry_compatible_data.py:2329-2334`                                                                                               | Industry-compatible keymap — same mapping                                              | ✅       |
| `anim_channels_edit.cc:4636-4641`                                                                                                     | Operator RNA-reading precedence (NOT modifier mapping)                                 | ❌ MIS-APPLIED — fixed in `835c20b` |

## SS-deferred Blender operators (newly relevant after Slice 5.J)

| Operator                                                                       | Keybind             | Deferral reason                                                                  |
| ------------------------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------- |
| `children_only` on `ANIM_OT_channels_click`                                    | Shift+Ctrl+click    | SS has no FCurveGroup datablock yet; Shift+Ctrl falls through to Shift (range).  |
| `ANIM_OT_channels_select_all` (Select All / Invert / None)                     | A / Alt+A / Ctrl+I  | Slice 5.F shipped per-curve `selected`; bulk operators still pending.            |
| `GRAPH_OT_hide` / `GRAPH_OT_reveal`                                            | H / Shift+H / Alt+H | Slice 5.I deferred — bulk hide on selected channels.                             |
| `ANIM_OT_channels_setting_toggle` with `ACHANNEL_SETTING_VISIBLE/MUTE/PROTECT` | (no default keybind)| Multi-channel mute/hide/protect; gated on bulk channel selection (now possible). |

## Owed manual browser verification

Persistence-focused (15 flows from Slice 5.I close-out remain owed; new
ones specific to Slice 5.J below):

- [ ] Shift+click in sidebar with no active fcurve → toggles only the clicked curve (auto-downgrade).
- [ ] Shift+click with active set → range from active through clicked, inclusive.
- [ ] Shift+click reverse direction (active below clicked in list) — same range, both bounds selected.
- [ ] Shift+click same fcurve as active → single-cell range; only that one curve selected.
- [ ] Ctrl+click in sidebar → toggles only the clicked curve's `selected` (matches old Slice 5.F Shift+click semantics).
- [ ] Save project → re-load → channel selection persists (already covered by Slice 5.F).
- [ ] Range-select then modal G/S — modal sees all range-selected curves' active keyforms.
- [ ] Shift+click does NOT wipe keyform selection on other channels (cross-channel composition).
- [ ] Plain click DOES wipe keyform selection on other channels (matches Slice 5.F SS UX extension).
- [ ] Shift+click in 1-curve action → falls through to range, selects only that one curve.

## Affected test suites (all passing)

| Suite                      | Assertions | Notes                                            |
| -------------------------- | ---------- | ------------------------------------------------ |
| test:fcurveChannelSelect   | 105        | +55 net (feature: +46; audit-fix: +9).           |
| test:fcurveMute            | 38         | Untouched.                                       |
| test:fcurveVisible         | 49         | Untouched.                                       |
| test:fcurveActiveKeyform   | 62         | Untouched.                                       |
| test:fcurveEval            | 35         | Untouched.                                       |
| test:projectRoundTrip      | 41         | Untouched.                                       |
| test:graphEditOps          | 115        | Untouched.                                       |
| test:animFCurveBridge      | 52         | Untouched.                                       |
| test:fcurveHandles         | 35         | Untouched.                                       |
| **TOTAL**                  | **532**    | (was 477 pre-slice; +55 net.)                    |

`npx tsc --noEmit`: clean.

## Queued resume paths

Priority order for the next session:

1. **Bulk channel-select operators** — `ANIM_OT_channels_select_all`
   (A / Alt+A / Ctrl+I). Now relevant since Slice 5.J shipped range
   and the sidebar can render multi-channel selection legibly.
2. **`GRAPH_OT_hide` / `GRAPH_OT_reveal` keymap parity** — H /
   Shift+H / Alt+H. Slice 5.I inventoried these as deferred; they
   become especially ergonomic now that range-select can pick the
   target set in one click.
3. **Operators-on-selected-channels** — bulk mute/unmute/delete/hide.
   Trivial once `(1)` and `(2)` ship; the per-curve helpers already
   exist (Slice 5.F selected, 5.G mute, 5.I hide).
4. **Footer wiring for fcurve channel state** — selected-count +
   muted-count + hidden-count + active-keyform-info.
5. **N-panel active-keyform numerical editor** — Blender's
   `graph_buttons.cc` per-keyform inline edit.
6. **Driver variable list / expression editor** — Slice 5.D's biggest
   deferral.
7. **`SIPO_DRAWTIME` seconds-vs-frames toggle** — MED-B2 from Slice 5.E.
8. **`USER_FLAG_NUMINPUT_ADVANCED`** — MED-B1 from Slice 5.E.
9. **Group-level mute (`AGRP_MUTED`) + group-level hide** — gated on
   FCurveGroup datablock.
10. **DopesheetEditor row-state styling** — mute-row + active-keyform-
    row + hide-row.
11. **Phase 2 owed-manual verification** — bezier export, Hiyori
    round-trip.
12. **Phase 3 — F-Curve modifiers** — Cycles/Noise/Generator/Envelope.

## Lessons / honest reflection

**Mapping verification was rushed.** I cited
`anim_channels_edit.cc:4636-4641` as the modifier-precedence authority
without reading the keymap file. The cited range IS real and IS about
extend-vs-extend_range RNA tiebreaking, but it's NOT the modifier→
selectmode mapping the comment claimed it was. The keymap file
`blender_default.py:3849-3854` was the actual authority. Lesson: **for
any "Ctrl does X, Shift does Y" claim, read the keymap file, not the
operator's `invoke` function.** The operator only sees RNA props; it
doesn't know which modifier produced them.

The 4-slice zero-fabrication streak (5.E, 5.F, 5.G, 5.H, 5.I — wait,
that's actually 5 slices — 5.J broke it at slice 6) is broken. The
audit caught it; the fix is in `835c20b`. Future slices should add
"if comment claims X-modifier-bind, verify against the keymap file
NOT just the operator source" to the citation-verification checklist.

The other audit findings (MED-B1 scope, MED-B2 rationale, LOW-B1
walker early-exit, MED-A1/A2 orphan-bound) are all "did the right
thing, missed the why-comment or a test case" — the kind of polish
that benefits from the dual-audit's adversarial framing. Architecture
audit was useful (MED-A2's orphan-bound test added confidence the
silent `if (fc)` guard is intentional, not a latent bug); fidelity
audit was load-bearing (HIGH-B1 would have shipped a wrong-feeling
UX permanently if the audit hadn't run).
