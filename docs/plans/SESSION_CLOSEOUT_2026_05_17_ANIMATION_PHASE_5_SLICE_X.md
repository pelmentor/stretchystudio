# Animation Phase 5 — Slice 5.X close-out

**Date**: 2026-05-17  
**Commits**: `0d5068d` (substrate) → `c0a2468` (audit-fix sweep) → (this doc)  
**Path #11 from Phase 5 queue** — *Per-fcurve ACTIVE slot* — SHIPPED.

## What the path was

> "Per-fcurve ACTIVE slot — would close MED-A1's visible divergence by
> letting Slice 5.K's `clearActive` decision be honored. See
> `project_ss_is_embryo`."
> (from Slice 5.J queued-paths list, carried forward)

Promoted to TOP of queue by Slice 5.W's close-out which identified it as
the proper closure for 5.W Dev 2 (active-keyform halo selection
precondition) and the retirement vector for `pickActiveFCurve`.

## What shipped

Per-fcurve `active` boolean field (sparse, EXCLUSIVE within an action)
ports Blender's `FCURVE_ACTIVE` bit
(`reference/blender/source/blender/makesdna/DNA_anim_enums.h:309` —
`FCURVE_ACTIVE = (1 << 2)`).

| Capability | Source | Where |
|------------|--------|-------|
| `isFCurveActive(fc)` reader | strict `=== true` | `src/anim/fcurveActive.js` |
| `getActiveFCurve(action)` | first-match (EXCLUSIVE invariant) | same |
| `setActiveFCurve(action, fcurveId)` | clears all siblings, sets target | same |
| `clearActiveFCurves(action)` | sparse-delete all | same |
| `wouldSetActiveFCurveChange(action, fcurveId)` | preflight | same |
| Persisted-flag-first `activeFCurve` precedence | `getActiveFCurve ?? pickFCurve` | FCurveEditor.jsx:467 |
| Sister precedence in DopesheetEditor | `getActiveFCurve(action)?.id ?? pickActiveFCurve(...)` | DopesheetEditor.jsx:107 |
| Click → promote fcurve to active | `setActiveFCurve` wired into 3 sites | FCurveEditor.jsx applyChannelClick + handle-click + keyform-click branches |
| `pickActiveFCurve` demoted to bootstrap fallback | JSDoc rewrite + Slice 5.X header | fcurvePicker.js |

## Substrate (`0d5068d`)

| File | Status | Role |
|------|--------|------|
| `src/anim/fcurveActive.js` | NEW (~210 LOC, then ~245 post-audit-fix) | Pure helpers + module header with Blender provenance |
| `src/v3/editors/fcurve/FCurveEditor.jsx` | refactored | activeFCurve precedence + 3 click-site promotions |
| `src/v3/editors/dopesheet/DopesheetEditor.jsx` | refactored | activeFCurveId precedence flipped |
| `scripts/test/test_fcurveActive.mjs` | NEW | 67 assertions (substrate ship) → 75 (post-fix) |
| `package.json` | + `test:fcurveActive` | Registered + appended to aggregate `test` chain |

## Dual audit (parallel general-purpose agents)

Both audits returned 0 fab cites — pre-verify discipline held for the
**2nd slice in a row** after the 5.V break.

| Lane          | HIGH | MED | LOW | Total |
|---------------|------|-----|-----|-------|
| Architecture  | 2    | 3   | 3   | 8     |
| Blender fidelity | 1 | 3   | 2   | 6     |
| **Combined**  | **3** | **6** | **5** | **14** |

(LOW-3 architecture was a pure observation — return-shape divergence
from sister Slice 5.H, justified by Deviation 3.)

## Audit-fix sweep (`c0a2468`)

All HIGH addressed. All MED addressed. All LOW addressed (or
acknowledged as no-action-needed for LOW-3 arch + LOW-1 fidelity).

### Architecture findings

**H1 — `activeFCurve` memo deps regression (sister to Slice 5.W's H1).**
Both FCurveEditor's memo and DopesheetEditor's `activeFCurveId` memo
depended on full `action` ref. Narrowed to `[action?.fcurves, selection]`
in both. The `decoded` memo at FCurveEditor:478 already gets this right
— new memos now match the pattern.

**H2 — `applyChannelClick` closure-purity comment extension.** The
existing Slice 5.J LOW-A1 comment warned not to capture `decoded` into
the closure. Extended to cover the new Slice 5.X `setActiveFCurve` call
so future readers don't inadvertently break structural purity.

**M1 — `setActiveFCurve` reference-identity fragility.** Pre-fix used
`fc === target` after pre-resolving target via `.find(...)`. Fragile
against future call sites resolving target from a different array
slice — silent failure mode would DELETE ALL active flags. Switched
to inline `fc.id === fcurveId` compare, eliminating ref-identity
dependency. New test verifies via JSON deep-clone round-trip.

**M2 — sibling `activeKeyformIndex` non-clear.** Documented in module
header: when an fcurve loses `active` (via `setActiveFCurve(other)`),
its `activeKeyformIndex` is INTENTIONALLY preserved. Matches Blender's
split-state design (`mouse_graph_keys` has two separate write sites).
Re-activating the curve restores prior context.

**M3 — test gap.** "Cleanup-during-already-active" case wasn't
covered — `setActiveFCurve(action, X)` when X is already active AND a
sibling carries stale `active: false`. New assertion verifies
`changed: true` and sibling normalisation.

**L1 — Deviation 3 framing clarified.** It's an INHERITED consequence
of Slice 5.F's selection-as-view-state UX choice, not a 5.X-original
divergence.

**L2 — `fcurvePicker.js` header retitled.** From "this picker can
retire" → "DEMOTED to bootstrap fallback" with rationale (principled
fallback for legacy data + load-to-first-click window, not a
transitional shim).

**L3 (arch) — return-shape divergence noted.** No code change; sister
`setActiveKeyform` returns `{activeNow}` only, `setActiveFCurve`
returns `{activeNow, changed}`. Justified by Deviation 3.

### Fidelity findings

**HIGH-1F — Cite chain mis-attribution in FCurveEditor click branches.**
Pre-fix the comment claimed `graph_select.cc:1790-1797` sets BOTH the
keyform-active AND FCURVE_ACTIVE. Verification: `:1790-1797` is
keyform-active only. The parent FCURVE_ACTIVE write happens at a
SEPARATE site `:1846-1856` via `ANIM_set_active_channel(...)`. Both
branches now cite the two sites separately. SS-port behaviour is
correct; only the cite chain was sloppy.

**MED-1F — `graph_select.cc:466` mis-attributed.** Pre-fix said
"`graph.select_active_curve` operator (Alt+click pattern)". Verification:
`:466` lives inside `graphkeys_deselectall_exec` (GRAPH_OT_select_all's
active-restore pass that runs AFTER `deselect_graph_keys` to preserve
the previously-active fcurve). Module header section retitled
"post-deselect-all active-restore"; added Deviation 4 (no SS-port
active-restore pass yet — deferred to a future bulk select-toggle
operator).

**MED-2F — `OPTYPE_UNDO` operator misattribution.** Pre-fix cited
`anim_channels_edit.cc:3105` (`ANIM_OT_channels_setting_toggle`). The
actual port-equivalent for SS's `applyChannelClick` is
`ANIM_OT_channels_click` with `OPTYPE_UNDO` at `:4686`. JSDoc fixed.

**MED-3F — same-type filter explicit note.** Blender's
`ANIM_set_active_channel` has `if (channel_type != ale->type) continue;`
because `anim_data` is heterogeneous. SS's `action.fcurves` is
monotyped, so the filter collapses to a no-op. Now documented in
module header.

**LOW-1F — cite in commit body but not shipped code.** No fix.

**LOW-2F — active-keyform render gate semantically matches.** No fix.

## SS deviations documented this slice (4 new — cumulative 49 across Phase 5)

| # | Deviation | Closure condition |
|---|-----------|-------------------|
| 5.X-1 | Channel-deselect doesn't auto-clear `active` | When `applyChannelSelect` gains `change_active=true` branch (Blender's `setflag_anim_channels:728-733`) |
| 5.X-2 | Batch select-toggle doesn't auto-clear `active` | When bulk select-toggle operator ships (queued path #12) |
| 5.X-3 | ACTIVE writes use `skipHistory:true` (inherited from 5.F) | When 50-entry undo budget is no longer binding |
| 5.X-4 | No active-restore pass after bulk select-toggle / deselect-all | Same as 5.X-1 + 5.X-2 plus port of `graphkeys_deselectall_exec:459-470` |

## Closes

- **Slice 5.W Dev 2** (active-keyform halo selection precondition): the
  persisted flag now drives the gate; selection-based fallback is the
  bootstrap-only path. Partial closure — the keyform-selection
  precondition (Blender `:254`: `if (!(bezt->f2 & SELECT)) return;`)
  remains unported because SS keyform selection lives in editor-local
  React state.
- **Refinement of 5.W close-out claim**: "retires pickActiveFCurve" was
  aspirational. Actual: DEMOTED to bootstrap fallback. Documented in
  fcurvePicker.js header.

## Test additions

| Suite | Assertions (cumulative) |
|-------|------------------------:|
| `test_fcurveActive.mjs` | 0 → 67 (substrate) → 75 (audit-fix +8) |

## Pre-/post-slice state

| | Pre-5.X | Post-5.X |
|---|---------|----------|
| commits ahead of origin/master | 67 | 70 (post-close-out commit) |
| Schema version | 40 | 40 (no migration) |
| Aggregate `test` length | + `test:dopesheetRows` + `test:fcurvePicker` | + `test:fcurveActive` |
| Documented SS deviations cumulative | 45 (Phase 5) | 49 (Phase 5) |
| Fab streak | 1 (5.W held) | 2 (5.X held) |

## Queued resume paths (after 5.X)

| #   | Path                                                          | Status                            |
|-----|---------------------------------------------------------------|-----------------------------------|
| 1-9 | Earlier slices (5.L → 5.V)                                    | SHIPPED                           |
| 10  | DopesheetEditor row-state styling                             | SHIPPED in 5.W                    |
| 11  | Per-fcurve ACTIVE slot                                        | **SHIPPED in 5.X (this slice)**   |
| 12  | ANIM_OT_channels_select_box drag-rect on sidebar              | **NEW TOP** (closes 5.X Dev 2 + 4 via the bulk-op + active-restore pattern)|
| 13  | Phase 2 owed-manual verification                              | queued                            |
| 14  | **Phase 3 — F-Curve modifiers** (full phase)                  | queued                            |
| 15  | SS keymap-preset selector                                     | queued                            |
| 16  | Hide/reveal toast notifications                               | queued                            |
| 17  | Sidebar focus tracking for region-aware keys                  | queued                            |
| 18  | Popup-menu primitive                                          | queued                            |
| 19  | `fcurve.protected` (FCURVE_PROTECTED port)                    | queued                            |
| 20  | N-panel collapse-state persistence + multi-panel host         | queued                            |
| 21  | BezTriple selection-flag model + `HD_ALIGN_DOUBLESIDE`        | queued                            |
| 22  | Pre-verify cite discipline workflow item                      | queued                            |
| 23-27 | Driver polish (5.S devs)                                    | queued                            |
| 28-29 | Timecode/Mode-drivers (5.T devs)                            | queued                            |
| 30-32 | NumInput polish (5.U devs)                                  | queued                            |
| 33  | Auto-group on fcurve add (closes 5.V Dev 5)                   | queued                            |
| 34  | Group-flush helper (closes 5.V Dev 6)                         | queued                            |
| 35  | Group-children select operator (Shift+Ctrl+click)             | queued                            |
| 36  | DopeSheet editor + per-editor expand bit (closes 5.V Dev 1)   | queued                            |
| 37  | AGRP_MODIFIERS_OFF cascade (closes 5.V Dev 2)                 | queued (downstream of #14)        |
| 38  | AGRP_CURVES_ALWAYS_VISIBLE pin (closes 5.V Dev 3)             | queued                            |
| 39  | Slice 5.V MED-3 fidelity cite cleanup (hide cascade)          | queued                            |
| 40 (NEW) | `applyChannelSelect.change_active=true` branch + auto-clear active (closes 5.X Dev 1) | queued |
| 41 (NEW) | Active-restore pass on bulk select-toggle (closes 5.X Dev 4) | queued (downstream of #12)   |
| 42 (NEW) | Keyform-selection precondition on halo (closes 5.W Dev 2 fully) | queued (needs project-stored keyform selection or cross-editor subscription) |

## Lessons

1. **Memo-dep narrowing has to be enforced per-slice.** Slice 5.W's H1
   audit-fix narrowed the `rows` memo deps. Slice 5.X's substrate
   added a NEW memo right next door with the broad deps the 5.W fix
   had just removed. Same pattern, same regression class. Lesson:
   when adding a memo near a recently-narrowed one, mirror the
   narrowing convention as a habit, not as something to be caught by
   the next audit.

2. **Reference-identity comparisons inside immer recipes are brittle.**
   `setActiveFCurve`'s pre-resolution + `fc === target` worked under
   immer drafts but would silently FAIL under any future call site
   that resolves target from a different array slice. ID-based
   compare eliminates the coupling and costs nothing. Lesson: prefer
   structural compare (`fc.id === fcurveId`) over reference compare
   inside loops that mutate, even when reference compare is "correct"
   today.

3. **Cite chain accuracy matters even when behaviour is correct.**
   Three of the four fidelity findings (HIGH-1F, MED-1F, MED-2F) were
   cite-chain corrections — the SS port behaviour was right, but the
   comments mis-attributed which Blender file/line/operator was being
   mirrored. Each fix took ~2 min; debugging from a wrong cite later
   would have cost more.

4. **"Demoted to fallback" is not the same as "retired."** Slice 5.W's
   close-out claimed Slice 5.X would "retire `pickActiveFCurve`". The
   actual right answer is "demote to bootstrap fallback" because of
   the no-migration policy on `fc.active`. Documenting the principled
   fallback (not a transitional shim) keeps Rule №2 compliant — the
   fallback is intrinsic, not deferred-forever baggage.

5. **Pre-verify discipline held 2 slices in a row.** 5.S/T/U held with
   small slices; 5.V broke (3 fabs, substrate slice); 5.W held (cite
   discipline scaled with cite volume); 5.X held (substrate slice
   with all cites verified). The pattern holds when applied
   per-cite, even at substrate volume — the 5.V miss was the
   exception, not the new norm.
