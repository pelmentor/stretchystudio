# Animation Phase 5 — Slice 5.U close-out (2026-05-17)

Slice 5.U ports Blender's `USER_FLAG_NUMINPUT_ADVANCED` preference,
closing the SS-deferred audit-fix MED-B1 that has been carried
inside `transformInputReducer.js`'s JSDoc since Slice 5.E. One
substrate+audit-fix commit + this close-out.

## Commits

| SHA       | Subject                                                                          |
|-----------|----------------------------------------------------------------------------------|
| `8cf16bb` | `feat(anim): Animation Phase 5 Slice 5.U — USER_FLAG_NUMINPUT_ADVANCED preference` |
| (this)    | `docs(plan): Animation Phase 5 Slice 5.U close-out`                              |

## What shipped

Reducer + helper
- **`src/lib/modal/transformInputReducer.js`** — new atomic action
  `appendTypedAuto`: appends digit/sign/dot AND enters numericMode in
  one reducer tick. Mirrors Blender's `numinput.cc:352-365` block
  where `USER_FLAG_NUMINPUT_ADVANCED` ON flips `NUM_EDIT_FULL` on the
  first eligible char.
- **`keyEventToAction(event, { axisAllowed, numericInputAdvanced })`**
  — new `numericInputAdvanced` option. When true, digit/sign/dot keys
  emit `'appendTypedAuto'` instead of `'appendTyped'`.

Store + preference
- **`src/store/preferencesStore.js`** — new
  `useNumericInputAdvanced: false` slot (default matches Blender per
  `versioning_userdef.cc:1070` clearing the bit at user-prefs init).
  Setter `setUseNumericInputAdvanced` + localStorage key
  `v3.prefs.useNumericInputAdvanced`.
- **`src/store/modalTransformStore.js`** — `appendTypedAuto` action
  wraps the reducer's new transition.

Caller wires
- **`src/v3/editors/fcurve/FCurveEditor.jsx`** — `onKey` inside
  `startModal` reads
  `usePreferencesStore.getState().useNumericInputAdvanced` and passes
  it as `numericInputAdvanced` to `keyEventToAction`. `getState()`
  pattern is correct here: the handler is captured by a `useEffect`
  closure that can't re-subscribe per-pref-change without re-attaching
  the listener.
- **`src/v3/shell/ModalTransformOverlay.jsx`** — destructured
  `appendTypedAuto` alongside `appendTyped`; the digit branch reads
  the pref and dispatches the atomic action when ON.
- **`src/v3/shell/ModalVertexTransformOverlay.jsx`** — NOT wired.
  Vertex store has no `numericMode` slot to enter atomically; call
  site carries a one-line deviation comment per audit LOW-A2.

UI surface
- **`src/v3/shell/PreferencesModal.jsx`** — new Input section with
  "Default to Advanced Numeric Input" checkbox + verbatim Blender
  description. Routed through `useT('prefs.input.*')` keys.
- **`src/i18n/index.js`** + **`src/i18n/locales/ru.js`** — 3 new
  `prefs.input.*` keys, EN + RU.

Tests
- **`scripts/test/test_transformInputReducer.mjs`** — extended from
  71 → 96 assertions (atomicity, rejection no-flip, keyEventToAction
  option threading).
- **`scripts/test/test_modalTransformTyped.mjs`** — extended from
  26 → 35 assertions for the store-level wrapper.
- **`scripts/test/test_preferencesStore.mjs`** — extended from
  49 → 56 assertions for the new pref.

JSDoc closure
- **transformInputReducer.js** module header — the
  "SS-deferred (audit-fix MED-B1, 2026-05-16)" section was
  REPLACED (not appended) with a "CLOSED Slice 5.U" section that
  documents the new behavior + the two remaining intentional
  deviations (narrower char-acceptance set; missing Ctrl/Alt modifier
  gate).

## Audit-fix sweep (dual-audit 2026-05-17)

| Lane          | Severity | Finding | Disposition                              |
|---------------|----------|---------|------------------------------------------|
| Architecture  | MED-A1   | Dead-code guard `if (nextBuf === buf && state.numericMode) return state;` unreachable | Removed; replaced with audit-pin comment explaining invariant |
| Architecture  | LOW-A1   | i18n inconsistency (literal strings vs `useT()`) | Threaded through 3 new `prefs.input.*` i18n keys (EN + RU) |
| Architecture  | LOW-A2   | Vertex modal exclusion needed call-site comment | Added at `ModalVertexTransformOverlay.jsx:356` |
| Fidelity      | MED-B1   | Ctrl/Alt modifier gate from `numinput.cc:356` not ported, undocumented | Deviation note added to module JSDoc |
| Fidelity      | LOW-B1   | Off-by-one cite `numinput.cc:353-365` (should include `#ifdef` opening line) | Corrected to `352-365` |

**Fab citations**: **0**. Streak now **3 of 3** clean (5.S → 5.T → 5.U).

## Documented SS deviations (3 new — cumulative 36 across Phase 5)

| #         | Deviation                                                                | Closure condition                                          |
|-----------|--------------------------------------------------------------------------|------------------------------------------------------------|
| 5.U Dev 1 | Narrower char-acceptance set vs Blender's `@%^&*+/{}()[]<>|` operators   | Future "math-expression numeric input" slice               |
| 5.U Dev 2 | Missing Ctrl/Alt modifier gate from `numinput.cc:356`                    | One-line guard in `keyEventToAction` + 2 caller branches   |
| 5.U Dev 3 | Vertex modal (`ModalVertexTransformOverlay`) does not honour the pref    | Future slice porting `numericMode` to vertex store         |

Cumulative across Phase 5 Slices 5.L → 5.U:

| Slice | Count |
|-------|-------|
| 5.L   | 3     |
| 5.M   | 3     |
| 5.N   | 2     |
| 5.O   | 3     |
| 5.P   | 2     |
| 5.Q   | 4     |
| 5.R   | 3     |
| 5.S   | 7     |
| 5.T   | 7     |
| 5.U   | 3     |
| **Total** | **37** |

(5.Q Dev 3 closed by 5.T; net active 36.)

## Owed manual browser verification

Verify by opening Preferences and exercising a modal G/R/S in
viewport / FCurveEditor:

- **Preferences → Input section** appears below AI section with
  "Default to Advanced Numeric Input" checkbox. Localised to "По
  умолчанию — расширенный числовой ввод" in RU.
- **Pref OFF (default)**: in viewport modal G, type `5` — buffer
  shows `5` but HUD does NOT show the blue `=` numericMode badge.
  Need to press `=` to enter numericMode.
- **Pref ON**: in viewport modal G, type `5` — buffer shows `5` AND
  HUD shows the blue `=` badge immediately (numericMode auto-entered).
- **Same in FCurveEditor**: open the editor, select a keyform, press
  G, type a digit — same behavior gated by the pref.
- **Vertex modal NOT affected**: in vertex-mode G (move a vertex),
  typing digits accumulates buffer but never auto-enters numericMode
  (no numericMode slot in vertex store; documented deviation).
- **Pref persists across page reloads**: toggle on, reload, confirm
  still on in PreferencesModal.
- **Pref change mid-modal**: open modal G in viewport, then open
  Preferences (would actually require Esc-cancel modal first since
  modal grabs keys — verify behavior). The next modal G respects the
  new value.
- **Rejected char does NOT flip**: with pref ON, type `1` then `-` —
  the `-` is rejected (sign mid-buffer) and numericMode stays as it
  was (true if previously entered, false if not).

## Queued resume paths (after 5.U)

| #   | Path                                                                | Status                            |
|-----|---------------------------------------------------------------------|-----------------------------------|
| 1-6 | Earlier slices (5.L→5.S)                                            | SHIPPED                           |
| 7   | SIPO_DRAWTIME seconds-vs-frames toggle                              | SHIPPED in 5.T                    |
| 8   | USER_FLAG_NUMINPUT_ADVANCED                                         | **SHIPPED in 5.U (this slice)**   |
| 9   | Group-level mute + hide                                             | **NEW TOP** (FCurveGroup gate)    |
| 10  | DopesheetEditor row-state styling                                   | queued                            |
| 11  | Per-fcurve ACTIVE slot                                              | queued                            |
| 12  | ANIM_OT_channels_select_box drag-rect on sidebar                    | queued                            |
| 13  | Phase 2 owed-manual verification                                    | queued                            |
| 14  | **Phase 3 — F-Curve modifiers** (full phase; closes 5.R Dev 1)      | queued                            |
| 15  | SS keymap-preset selector                                           | queued                            |
| 16  | Hide/reveal toast notifications                                     | queued                            |
| 17  | Sidebar focus tracking for region-aware keys                        | queued                            |
| 18  | Popup-menu primitive                                                | queued (paired with PROTECT)      |
| 19  | `fcurve.protected` (FCURVE_PROTECTED port)                          | queued                            |
| 20  | N-panel collapse-state persistence + multi-panel host               | queued                            |
| 21  | BezTriple selection-flag model + `HD_ALIGN_DOUBLESIDE`              | queued                            |
| 22  | Pre-verify cite discipline workflow item                            | queued                            |
| 23  | Compound driver variable types (closes 5.S Dev 1)                   | queued                            |
| 24  | Driver compile-cache + invalidation hooks (closes 5.S Dev 6)        | queued                            |
| 25  | `self` magic identifier for drivers (closes 5.S Dev 7)              | queued                            |
| 26  | `ChannelDriver.influence` slider (closes 5.S Dev 4)                 | queued                            |
| 27  | `DRIVER_FLAG_INVALID` status field + error labels                   | queued                            |
| 28  | `User.timecode_style` + BLI_timecode port (closes 5.T Dev 3)        | queued                            |
| 29  | SIPO_MODE_DRIVERS gate for X-axis (closes 5.T Dev 1)                | queued (downstream of #6)         |
| 30 (NEW) | Math-expression numeric input + operator chars (closes 5.U Dev 1)  | queued                            |
| 31 (NEW) | Ctrl/Alt modifier gate for digit auto-flip (closes 5.U Dev 2)      | queued (one-line per caller)      |
| 32 (NEW) | Port numericMode to vertex modal (closes 5.U Dev 3)                | queued                            |

## Pre-compact state

- 60 commits ahead of `origin/master`
- typecheck clean
- Touched-paths suites green (3: transformInputReducer, modalTransformTyped, preferencesStore)
- Fab streak **3 of 3** (5.S → 5.T → 5.U)
- 5.U closes the longest-standing deferred audit-fix in Phase 5
  (carried in JSDoc since 5.E, 2026-05-16)

## Session lessons

1. **Sister-pattern audits catch self-deferrals.** The reducer JSDoc
   has been carrying the "SS-deferred MED-B1" note since Slice 5.E —
   it took 5.U's pre-work grep to surface it as a closure-eligible
   queued path. The audit-fix-deferral pattern WORKS (the note stayed
   accurate and actionable for 9 slices) but only if someone goes
   looking — pre-work-scope discovery is load-bearing.
2. **Dead-code guards mislead.** The MED-A1 finding was a guard that
   couldn't fire; the auditor caught it not because it caused bugs
   but because it created a false impression of a special case. Per
   Rule №1 (no crutches), removing dead code is part of the contract;
   leaving it in as "defense-in-depth" is the same anti-pattern.
3. **`getState()` in event handlers is the right answer.** Both
   callers (FCurveEditor onKey, ModalTransformOverlay onKey) read the
   pref via `usePreferencesStore.getState()` inside the imperative
   handler. The auditor confirmed this is the correct pattern for
   keyboard event handlers captured by `useEffect` — subscribing via
   the hook would force re-attaching the listener on every pref
   change. The pattern is documented in the call-site comments.
4. **Atomic reducer actions beat dispatch sequences.** The first
   design considered was "caller dispatches append, then dispatches
   enter". An atomic `appendTypedAuto` is cleaner because the
   imperative `applyDelta` reads `stateRef` immediately after dispatch
   — a two-step dispatch would leave the first read seeing
   numericMode=false. Atomicity matters when sister code reads
   between transitions.
5. **3 of 3 fab-free streak is sustainable.** Pre-verifying every
   cited file at the cited line takes ~5 minutes per slice and
   continues to pay back in fidelity audits. The Slice 5.O fab broke
   the streak; the discipline added in 5.P has held for 5.S, 5.T,
   5.U. The next 5 slices are the test of whether this is a habit
   or a phase.
