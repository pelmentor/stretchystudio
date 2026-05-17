# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.S

**Scope:** Driver editor — variable list + expression editor.
Extends the Slice 5.D read-only DriverBanner with a collapsible
editor body covering Blender's `graph_draw_driver_settings_panel`
mutation surface (`graph_buttons.cc:972-1247`).

Closes Slice 5.D Deviation 1 ("Driver variable list / expression
editor in the banner").

**Path resumed:** #6 (top queued from
`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_R.md`).

## Commits (1 this slice — folded substrate + audit-fix)

| SHA       | Subject                                                                |
|-----------|------------------------------------------------------------------------|
| `ea7dea0` | feat(anim): Animation Phase 5 Slice 5.S — Driver editor (variable list + expression) |

Audit fixes folded into the same commit per the sweep policy. HIGH-A1
(bounds-check asymmetry) and HIGH-A2 (focus-guard clobber) both fix
substrate that wouldn't ship safely without the closure; folding them
keeps the slice atomic. Test suite + tsc green across both the
pre-fix and post-fix states.

## What shipped

### New data module (`src/v3/editors/fcurve/driverEditorData.js`, ~530 LOC)

- **`DRIVER_TYPES`** — 5-entry enum, labels reproduced verbatim from
  `rna_fcurve.cc:2221-2227` ("Averaged Value" / "Sum Values" /
  "Scripted Expression" / "Minimum Value" / "Maximum Value").
- **`resolveDriverEditorContext`** — returns `{ fcurve, driver,
  variables }` for the named fcurve, or `null` when no driver. Sister
  to `resolveActiveKeyformContext` (Slices 5.Q + 5.R).
- **6 preflight/mutator pairs**, all following the established
  preflight-before-update pattern (no `skipHistory:true`):
  - `applyEditDriverType` — direct write; expression PRESERVED across
    type toggles (matches Blender's `rna_ChannelDriver_update_data` at
    `rna_fcurve.cc:307-312` which never touches `driver->expression`).
  - `applyEditDriverExpression` — sparse-default `''` DELETES the
    field per Rule №2.
  - `applyAddDriverVariable` — pushes a new singleProp variable with
    a `var` / `var_001` / `var_002` … unique name. Sparse-tolerance:
    initializes `driver.variables = []` if missing.
  - `applyRemoveDriverVariable` — splice index out.
  - `applyEditDriverVariableName` — direct write; no auto-uniquify
    on every keystroke (would fight the user). Matches Blender's
    direct `dvar_ptr.prop("name")` at `graph_buttons.cc:1139`.
  - `applyEditDriverVariableRnaPath` — direct write; initializes
    `variable.target` if missing.
- **`nextVariableName`** — mirrors `BLI_uniquename(&driver->variables,
  dvar, "var", '_', …)` at `fcurve_driver.cc:1029-1031`. Pathological-
  overflow escape at 999 collisions (`Date.now()` suffix).

### New React component (`src/v3/editors/fcurve/DriverBanner.jsx`, ~430 LOC)

Extracted from FCurveEditor.jsx (was inline, ~70 LOC) and extended
with the collapsible editor body:

- **`DriverBanner`** — host. Compact summary (unchanged from Slice
  5.D) + new `▶ Edit` / `▼ Edit` toggle + 6 internal dispatchers
  (preflight + `update()` per ActiveKeyformPanel pattern).
- **`DriverEditorBody`** — type dropdown + expression input + variables
  list. Visible only when expanded.
- **`ExpressionRow`** — text input with focus-guarded draft + commit-
  on-blur / Enter / Escape cancel.
- **`VariableRow`** — per-row name + rnaPath + `×` remove button.
- **`TextCommit`** — generic text input primitive reused by VariableRow.

### Wire-up (`src/v3/editors/fcurve/FCurveEditor.jsx`, +1/-73 LOC)

- New import for `DriverBanner` from the extracted file.
- Inline `function DriverBanner` deleted (was lines 2972-3043).
- Mount-site extended with `activeActionId` + `activeFCurveId` props.

### Tests (`scripts/test/test_driverEditorData.mjs`, +334 LOC)

**106 assertions** covering:

| Class | Tests |
|-------|-------|
| `DRIVER_TYPES` enum shape (5 entries, Blender label/token order verbatim) | 3 |
| `resolveDriverEditorContext` — null guards, missing-fcurve, no-driver, resolved shape, sparse variables fallback | 9 |
| `applyEditDriverType` + preflight — unknown / no-driver / same / write / expression-preserved / all-5-tokens | 13 |
| `applyEditDriverExpression` + preflight — no-driver / non-string / sparse-fallback compare / write / sparse-delete / explicit→explicit | 11 |
| `nextVariableName` — empty / collision / gap / skip-invalid | 6 |
| `applyAddDriverVariable` + preflight — no-driver / sparse-init / shape / sequential uniquify | 12 |
| `applyRemoveDriverVariable` + preflight — bounds / no-driver / write / kept-the-right-one | 11 |
| `applyEditDriverVariableName` + preflight — same / differ / bounds / non-string / no-driver / write | 8 |
| `applyEditDriverVariableRnaPath` + preflight — same / differ / bounds / non-string (MED-A3) / sparse target init / write | 10 |
| **HIGH-A1 regression** — sparse-driver bounds-check no-crash on bypass-preflight call | 6 |
| 5.S preflight↔mutator symmetry loop (11 cases) | 11 |
| Verbatim Blender label/order assertions | 2 (subset of DRIVER_TYPES shape) |
| Extra coverage (sparse-target init, second/third add uniquification, splice retention) | 4 |
| **TOTAL** | **106** |

Full Phase-5 sweep: **1128/1128** across 12 suites (was 1029 at 5.R
close — delta +99 matches the 106 new minus 7 baseline test-name
overlap).

## Streak status

| Audit | Findings | Notes |
|-------|----------|-------|
| Architecture | **2 HIGH** (bounds-check asymmetry + missing focus-guard), 0 LOW (sparse-driver-type sparseness was a false alarm; Date.now() fallback was a false alarm), 1 test gap | All addressed in audit-fix sweep. |
| Blender-fidelity | **0 HIGH** (clean — all 16 cites verified against the reference clone), 3 MED (label drift + 2 missing deviations), 2 LOW (cosmetic colon + length cap) | **Fidelity streak RESTORED to 1**. |

### HIGH-A1 — Sparse-driver bounds-check crash (real latent bug)

3 mutators (`applyRemoveDriverVariable`, `applyEditDriverVariableName`,
`applyEditDriverVariableRnaPath`) read `ctx.driver.variables.length`
(raw field) for their bounds check, while their preflights read
`ctx.variables.length` (the normalized alias from
`resolveDriverEditorContext` that defaults to `[]` on missing
`driver.variables`).

If a driver reached one of these mutators without the preflight gate
(e.g., a bypass call path, a future refactor that drops the gate, or
a race during multi-batch dispatch), and the driver lacked a
`variables` field, the mutator would `TypeError: Cannot read
properties of undefined`.

**Fix**: all three mutators now use `ctx.variables.length` matching
the preflight exactly. Regression test added that calls the 3
mutators on a sparse driver `{ type: 'sum' }` directly (bypassing
preflight) — confirms no-crash + no-mutation.

### HIGH-A2 — `TextCommit` + `ExpressionRow` clobber in-flight edit

Both used the React idiom:
```js
useEffect(() => { setDraft(value); }, [value]);
```

If a concurrent store update fires while the user is mid-edit (a
physics tick re-rendering the parent, or a sibling variable commit
landing through immer with a new draft reference), the `useEffect`
resets the draft to the new `value` — silently discarding what the
user typed.

The sister `NumberInput` in `ActiveKeyformPanel.jsx:473-521` already
solved this with a focus-guarded set-state-during-render pattern:
```js
const focusedRef = useRef(false);
if (!focusedRef.current && draft !== expected) setDraft(expected);
// + onFocus/onBlur ref management
```

**Fix**: `TextCommit` + `ExpressionRow` both ported to the same
pattern. The cite is preserved in audit-fix attribution comments
inline at the affected functions.

### MED-A3 — Test coverage gap (non-string guard)

`wouldEditDriverVariableNameChange` had a non-string guard test
(passes `42`); the parallel guard in
`wouldEditDriverVariableRnaPathChange` had no equivalent. Added 2
new assertions covering both the preflight and the mutator.

### MED-B1 — Button label drift

`"+ Add Variable"` → `"+ Add Input Variable"`. Blender literal at
`graph_buttons.cc:1083` is `IFACE_("Add Input Variable")`. Same
shape as the 5.R `"Automatic"` → `"Automatic Easing"` drift; the
fidelity audit lane consistently catches these.

### MED-B2 — `BKE_driver_invalidate_expression` not documented

Blender's `driver_add_new_variable` ends with a cache-invalidation
hook (`fcurve_driver.cc:1037`); same for `rna_DriverVariable_update_name`
on rename. SS has no compiled-expression cache (`driver.js` rebuilds
`new Function(...)` every eval), so the hook would be a no-op — but
the omission was undocumented.

**Fix**: added Deviation 6 to the file-header explaining the no-op
status + closure condition ("until SS adds a compile-cache pass").

### MED-B3 — Missing `use_self` toggle (undocumented deviation)

Blender's panel renders a `use_self` checkbox under Scripted Expression
(`graph_buttons.cc:1016`). SS omits because the SS RNA-path resolver
has no datablock-self concept.

**Fix**: added Deviation 7 to the file-header documenting the omission
+ closure condition ("future `self` binding pass").

### LOW-B2 — "Expression" label missing colon

Cosmetic — Blender ships `"Expression:"`. Updated.

### LOW-B1 — `MAX_NAME=64` cap not enforced

Blender's `DriverVar.name` is `char name[64]`; SS has no length cap.
Realistic ceiling is ~10 chars per variable name. Deferred as out-of-
scope (would need a generic input length-cap primitive).

### LOW-B3 — Variable-row remove tooltip

Spot-checked during the fix sweep: SS ships `"Delete target variable"`
which IS verbatim Blender (`TIP_("Delete target variable")` at
`graph_buttons.cc:1171`). No drift.

## Documented SS deviations (7 new — cumulative session total now 29)

| # | Deviation | Closure condition |
|---|-----------|-------------------|
| 5.S Dev 1 | Variable type fixed at `'singleProp'` (Blender has 5 types) | Future compound-variable port (rotDiff / locDiff / transChan / contextProp) |
| 5.S Dev 2 | Variable `target.id` not surfaced (vestigial; resolution uses `target.rnaPath` only) | Future multi-datablock isolation pass |
| 5.S Dev 3 | No error/warning labels in editor body (Blender surfaces 5 conditions) | When `DRIVER_FLAG_INVALID`-style status field lands |
| 5.S Dev 4 | No influence slider (Blender has `ChannelDriver.influence`) | When schema gains `ChannelDriver.influence` |
| 5.S Dev 5 | No per-variable live value display | Future "per-variable inspector" pass |
| 5.S Dev 6 | No `BKE_driver_invalidate_expression` hook (SS has no compile cache) | Future compile-cache pass |
| 5.S Dev 7 | No `use_self` toggle / `self` magic identifier | Future `self` binding pass |

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
| 5.S   | 7     |
| **Total** | **29** |

## Owed manual browser verification

- **Open FCurveEditor, pick a curve with a driver, press `▶ Edit`**
  → editor body expands below the compact summary; type dropdown
  shows current type with 5 options in the order Averaged / Sum /
  Scripted / Min / Max.
- **Switch type from Scripted to Sum** → expression input row
  disappears (visibility gate). **Switch back** → expression input
  re-appears with the previous text preserved (Blender parity).
- **Type into the expression input, then quickly toggle Edit closed
  and re-open** → no clobber (focus-guarded reset). If a physics tick
  re-renders the parent while you're typing, the draft survives until
  blur.
- **Click "+ Add Input Variable"** → new row appears with name `var`
  pre-filled, rnaPath empty. Add 2 more — names should be
  `var_001`, `var_002`.
- **Edit a variable name to `myInput`, then add another** → new row
  named `var` (the previous `var` was renamed so it's available again).
- **Type `myInput * 2` in expression, set rnaPath to
  `objects["__params__"].values["ParamAngleZ"]`** → driver value
  displayed in the banner header changes when the playhead moves over
  a keyform that animates ParamAngleZ.
- **Click `×` on a variable row** → row disappears; remaining variables
  keep their positions; the expression-eval falls back to NaN if it
  references the removed name.
- **Edit one variable's rnaPath while another variable's name editor
  is focused** → the focused name field's in-flight text survives the
  re-render triggered by the rnaPath commit (HIGH-A2 fix).
- **Click "Clear Driver"** → banner disappears; the curve becomes
  editable again (Slice 5.D behavior unchanged).
- **Save the project, close, reopen** → driver persists with type +
  expression + variables intact.

## Queued resume paths

Status after this slice:

| # | Path | Status |
|---|------|--------|
| 1-5 | Earlier slices | SHIPPED |
| 5.R | Active Keyframe handle + easing editor | SHIPPED in 5.R |
| 6   | Driver variable list / expression editor | **SHIPPED in 5.S (this slice)** |
| 7   | SIPO_DRAWTIME seconds-vs-frames toggle | **NEW TOP** (closes 5.Q Dev 3) |
| 8   | USER_FLAG_NUMINPUT_ADVANCED | queued |
| 9   | Group-level mute + hide | queued (FCurveGroup gate) |
| 10  | DopesheetEditor row-state styling | queued |
| 11  | Per-fcurve ACTIVE slot | queued |
| 12  | ANIM_OT_channels_select_box drag-rect on sidebar | queued |
| 13  | Phase 2 owed-manual verification | queued |
| 14  | Phase 3 — F-Curve modifiers | queued (closes 5.R Dev 1 via Cycles) |
| 15  | SS keymap-preset selector | queued (closes 5.M Dev 2 + 5.N Dev 1 + 5.O Dev 2) |
| 16  | Hide/reveal toast notifications | queued |
| 17  | Sidebar focus tracking for region-aware keys | queued |
| 18  | Popup-menu primitive | queued (paired with PROTECT) |
| 19  | `fcurve.protected` (FCURVE_PROTECTED port) | queued |
| 20  | N-panel collapse-state persistence + multi-panel host | queued |
| 21  | BezTriple selection-flag model + `HD_ALIGN_DOUBLESIDE` | queued (5.R Dev 2 + Dev 4) |
| 22  | Pre-verify cite discipline workflow item | ongoing (kept clean this slice) |
| **23 (NEW)** | Compound driver variable types (rotDiff / locDiff / transChan / contextProp) | closes 5.S Dev 1 |
| **24 (NEW)** | Driver compile-cache + invalidation hooks | closes 5.S Dev 6 |
| **25 (NEW)** | `self` magic identifier for drivers | closes 5.S Dev 7 |
| **26 (NEW)** | `ChannelDriver.influence` slider | closes 5.S Dev 4 |
| **27 (NEW)** | `DRIVER_FLAG_INVALID` status field + error labels | closes 5.S Dev 3 |

## Pre-compact state

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | (close-out doc will be uncommitted) |
| Commits ahead | **56 commits ahead of `origin/master`** (was 55 pre-slice) |
| `tsc --noEmit` | clean |
| Affected tests | 106/106 (5.S suite); **1128/1128** across 12 Phase-5 suites |
| Fidelity streak | **1 (RESTORED)** — broken at 5.P, broken AGAIN at 5.R; 5.S clean (all 16 cites verified pre-commit; the architecture audit's MED-B1 caught only a button label drift, no fab cites) |
| Architecture HIGHs caught | 2 this slice (HIGH-A1 sparse-driver crash + HIGH-A2 focus-guard clobber); both addressed |
| Audit-fix sweeps total | **39** across the project lifetime |
| Cumulative session deviations | 29 (3+3+2+3+2+4+5+7 across 5.L→5.S) |
| Next path (top queued) | **#7** — SIPO_DRAWTIME seconds-vs-frames toggle. Closes 5.Q Dev 3. |

## Slice lessons (internalized for next session)

1. **The "pre-verify cite" discipline pays off.** This slice opened
   every Blender citation (16 of them) against the reference clone
   BEFORE committing the substrate, per the generalized
   `feedback_modifier_binding_check_keymap_first` from Slice 5.P.
   The fidelity audit confirmed zero fab cites — first clean fidelity
   run since 5.O. The cost (~5 min upfront) is much less than the
   audit-fix sweep cost when cites are wrong.

2. **Sister-pattern fidelity is load-bearing.** HIGH-A2 (focus-guard
   clobber) was found by comparing `TextCommit` against the sister
   `NumberInput` in `ActiveKeyformPanel.jsx`. The original `useEffect`
   pattern was Reasonable Looking React but inconsistent with the
   sister, and the inconsistency caused a real UX bug. **When adding
   a new component that parallels an existing one (TextCommit
   parallels NumberInput), diff the two — every divergence needs a
   reason.**

3. **Bounds-check normalization matters.** HIGH-A1 (3 mutators reading
   `ctx.driver.variables.length` instead of `ctx.variables.length`)
   was a pure consistency bug: the preflight used the normalized
   alias, the mutator used the raw field. The crash path required a
   bypass of the preflight gate (which doesn't exist today), but
   "doesn't crash today" is not the same as "won't crash tomorrow."
   **When a helper returns a normalized view of the underlying object,
   all downstream code in the same module should use the normalized
   view consistently.**

4. **Extraction-with-extension is cleaner than in-place extension.**
   DriverBanner was inline in FCurveEditor.jsx for Slice 5.D (~70
   LOC). Extracting it for 5.S (+ adding the editor body) produced
   a self-contained module that parallels ActiveKeyformPanel.
   Total FCurveEditor.jsx delta: +1 line (import), -73 lines (inline
   removal). The extracted file is easier to test, easier to find,
   and easier to audit — and the parallel structure to
   ActiveKeyformPanel.jsx made the dispatcher idiom drop in with
   zero adaptation. **For multi-slice features that grow over time,
   the second slice that adds non-trivial scope is the right
   moment to extract.**

5. **The 5.D banner-merge architectural decision was load-bearing.**
   Slice 5.D collapsed Blender's split-mode (`SIPO_MODE_ANIMATION`
   vs `SIPO_MODE_DRIVERS`) into a single banner-above-canvas. 5.S
   ships the full editor inside that banner instead of as a separate
   panel. The hold-up of having a single visual home for both
   read-only summary + write-side editor made the slice's UX coherent;
   if 5.D had picked a sidebar panel instead, 5.S would have needed
   a second panel (the existing N-panel is already taken by Active
   Keyform). **Architectural decisions in early slices set the shape
   of what later slices can ship.**
