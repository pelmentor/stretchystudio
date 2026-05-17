# Session close-out — 2026-05-17 — Animation Phase 5 Slice 5.P

**Scope:** FCurveEditor per-editor footer (channel-state summary +
active-FCurve label). SS-shaped extension repurposing Blender's
`RGN_TYPE_FOOTER` slot which is freed in SS (playback controls
lifted to global; driver info has dedicated banner).

**Path resumed:** #4 (top queued from Slice 5.O close-out
`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_O.md`).

## Commits (2 this slice)

| SHA       | Subject                                                     |
|-----------|-------------------------------------------------------------|
| `e2bf302` | feat(anim): Animation Phase 5 Slice 5.P — FCurveEditor per-editor footer |
| `75da930` | fix(audit): Animation Phase 5 Slice 5.P dual-audit sweep — 1 MED + 1 LOW |

## What shipped

### New module (`src/v3/editors/fcurve/fcurveFooterData.js`, ~165 LOC)

Pure data module backing the per-editor footer (sister architecture
to `v3/shell/footerStatusData.js`):

- **`countFCurveChannelStates(decoded)`** → `{total, selected, hidden, muted}`.
  4 independent dimensions tallied via the existing
  `isFCurveSelected` / `isFCurveHidden` / `isFCurveMuted` strict
  `=== true` readers.
- **`formatFCurveChannelCounts(counts)`** →
  `"12 channels · 3 selected · 2 hidden · 1 muted"`.
  Zero-elision for selected/hidden/muted; `channels` always shown
  with singular/plural agreement.
- **`formatActiveFCurveLabel(decoded, activeFCurveId)`** → label
  string or `null`. Resolves via `decoded.find()` so the footer
  label can't drift from the sidebar's row labels (shared source).

### Wire-up (`src/v3/editors/fcurve/FCurveEditor.jsx`)

- `Wrapper` extended with optional `footer = null` prop. Pre-
  existing Empty-state call sites compile unchanged (no `footer`
  passed → null → React drops).
- New inline `FCurveFooter` component renders the data module
  outputs with `h-7` styling (vs global Footer's `h-9`). Per-editor
  footer is thinner since it omits the transport-bar slot.
- Main return wires `<FCurveFooter decoded={decoded} activeFCurveId={...} />`.

### Tests (`scripts/test/test_fcurveFooterData.mjs`, NEW)

**38 assertions** covering:

| Class | Tests |
|-------|-------|
| `countFCurveChannelStates` — null/undefined/empty guards | 3 |
| `countFCurveChannelStates` — single bare + per-flag isolation | 4 |
| `countFCurveChannelStates` — all-three-on-one + mixed 5-row | 2 |
| `countFCurveChannelStates` — sparse-field tolerance | 1 |
| `countFCurveChannelStates` — strict `=== true` invariant | 1 |
| `countFCurveChannelStates` — null entries / null fcurve skipped | 2 |
| `formatFCurveChannelCounts` — pluralisation (0/1/N) | 3 |
| `formatFCurveChannelCounts` — zero-elision combinatorics | 6 |
| `formatFCurveChannelCounts` — null/undefined/empty defaults | 3 |
| `formatActiveFCurveLabel` — null/empty id and decoded guards | 6 |
| `formatActiveFCurveLabel` — resolvable, unresolvable, empty-label | 5 |
| `formatActiveFCurveLabel` — null-fcurve row tolerated | 2 |
| **TOTAL** | **38** |

### package.json

- `test:fcurveFooterData` script added.

## Streak status

| Audit | Findings | Streak |
|-------|----------|--------|
| Architecture | 0 HIGH, 0 MED, 1 LOW (`v3/v3/` typo in JSDoc) | held at 0 HIGH |
| Blender-fidelity | 0 HIGH, **1 MED (fabricated citation)**, 0 LOW | **RESET to 0** |

**Fidelity zero-fab streak broken at 5** (5.K → 5.L → 5.M → 5.N → 5.O
held; 5.P broke it). The fidelity agent caught the fab cleanly:

> The cited Blender file `interface_template_status.cc` doesn't exist
> at the claimed path — it's under `editors/interface/templates/`, not
> `editors/interface/`. AND line 475 at the correct path is
> `int icon = ICON_INTERNET;` — extension-update icon code unrelated
> to any "sel" abbreviation.

This is exactly the kind of port-fab the discipline exists to catch.
The audit-fix commit (`75da930`) removed the manufactured citation
and replaced it with honest "this is an SS-internal style decision"
attribution.

Architecture audit caught only a cosmetic JSDoc typo. The slice
holds at 0 HIGH for both audit lanes.

## Pattern extension (added this slice)

**`feedback_modifier_binding_check_keymap_first` generalizes from
"verify keymap modifier citations" to "verify ANY Blender citation
against the actual reference clone".** The fidelity agent extends
the rule implicitly when reviewing Blender citations; the substrate
author should pre-verify too. The Slice 5.J HIGH-B1 lesson was
keymap-specific; this slice surfaces that the underlying discipline
is broader. Recommended addition to `feedback_modifier_binding_check_keymap_first`
memory entry next sweep.

## Documented SS deviations (2 new — cumulative session total now 13)

| # | Deviation | Closure condition |
|---|-----------|-------------------|
| 5.P Dev 1 | Channel-state summary instead of Blender's playback-controls/driver-info footer content | SS regrows per-editor transports (would push channel-state summary to sidebar header strip) |
| 5.P Dev 2 | No driver-mode footer alternative | Phase 5 #6 — Driver variable list / expression editor as separate surface |

Cumulative session deviations:

| Slice | Count |
|-------|-------|
| 5.L   | 3     |
| 5.M   | 3     |
| 5.N   | 2     |
| 5.O   | 3     |
| 5.P   | 2     |
| **Total** | **13** |

## Owed manual browser verification

- **Open FCurveEditor with no action selected** → Empty state shows,
  NO footer renders (mounted via wrapper-without-footer branch).
- **Open FCurveEditor with action containing zero fcurves** → Same:
  Empty state, no footer.
- **Action with curves** → Footer visible at bottom with
  "N channels" baseline.
- **Click a sidebar channel to select** → Count updates to
  "N channels · 1 selected".
- **Shift+W (Slice 5.O) bulk-mute** → Count updates to include muted
  tally.
- **Eye-toggle hide on a row** → Count updates to include hidden
  tally.
- **Click an fcurve row to make active** → Right-side "Active: <label>"
  appears.
- **Selection cleared (Alt+A in sidebar from Slice 5.K)** → Active
  label disappears (no resolvable active).
- **Long fcurve label** → Truncates with ellipsis; full text on
  hover via `title=` attr.

## Queued resume paths

Status after this slice:

| # | Path | Status |
|---|------|--------|
| 1 | Ctrl+I keyform invert | SHIPPED in 5.L |
| 2 | H / Shift+H / Alt+H | SHIPPED in 5.M |
| 3 | Operators-on-selected-channels (delete half) | SHIPPED in 5.N |
| 3.MUTE | Shift+W / Ctrl+Shift+W / Alt+W | SHIPPED in 5.O |
| 4 | Footer wiring for fcurve channel state | **SHIPPED in 5.P** |
| 5 | N-panel active-keyform numerical editor | queued (top) |
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
| 17 | Sidebar focus tracking for region-aware keys | queued (closes 5.N MED-A2 + 5.K + 5.O keyboard-nav gap) |
| 18 | Popup-menu primitive for FCurveEditor | queued (paired with 5.O Dev 1 + PROTECT) |
| 19 | `fcurve.protected` (FCURVE_PROTECTED port) | queued (half of 5.O Dev 1) |

No new paths discovered this slice.

## Pre-compact state

| Field | Value |
|-------|-------|
| Branch | `master` |
| Working tree | clean |
| Commits ahead | **47 commits ahead of `origin/master`** (was 45 pre-slice) |
| `tsc --noEmit` | clean |
| Affected tests | 38/38 (new); 879/879 across 11 phase-5 suites (added fcurveFooterData) |
| Fidelity streak | **0 (RESET — broken at 5)** by 5.P fabricated citation |
| Architecture HIGHs caught | 0 this slice (held at 0 since 5.N) |
| Audit-fix sweeps total | **36** across the project lifetime |
| Cumulative session deviations | 13 (3+3+2+3+2 across 5.L/5.M/5.N/5.O/5.P) |
| Next path (top queued) | **#5** — N-panel active-keyform numerical editor (frame + value editing for the active keyform via sidebar N-panel surface). |

## Slice lessons (internalized for next session)

1. **Pre-verify EVERY Blender citation, not just keymap ones.** Slice
   5.P shipped a fabricated `interface_template_status.cc:475`
   reference because the author wanted SS's brevity decision to look
   like it had Blender backing. The fidelity audit caught it cleanly,
   but the right pattern is to grep the actual reference clone BEFORE
   writing the citation. The `feedback_modifier_binding_check_keymap_first`
   discipline generalizes — extend the memory note accordingly.

2. **Fidelity zero-fab streaks are honest signal, not vanity metric.**
   The streak broke at 5 because a real fab shipped. That's the
   discipline working — better to break the streak than carry a fake
   citation forward. The streak reset is documented; the substrate is
   cleaner now than before.

3. **SS-shaped extensions are allowed and should be clearly labeled.**
   Slice 5.P is NOT a Blender port; it's repurposing a freed Blender
   region slot for SS-specific info. The substrate commit's framing
   ("SS-shaped extension; not a strict Blender port") makes this
   honest and audit-friendly. Future SS-shape slices should adopt
   the same framing in commit messages.

4. **Data module + inline component is the right split when the
   component is trivial.** Slice 5.P chose to keep `FCurveFooter`
   inline in FCurveEditor.jsx (one render function, ~25 LOC) rather
   than extracting to its own JSX file. The PURE DATA (counts +
   formatters) lives in a `.js` module so tests can run without a
   JSX transpiler — matches the established
   `footerStatusData.js` ↔ `Footer.jsx` pattern. Components only
   warrant their own file when they grow state, refs, or peer
   components.

5. **Optional Wrapper prop with sensible default is the cleanest
   backward-compat path.** Slice 5.P extended `Wrapper` with an
   optional `footer = null` prop. The two pre-existing Empty-state
   call sites compile unchanged; only the new "with curves" path
   passes the prop. No migration baggage (Rule №2 holds — the prop
   is honestly optional, not a transition shim).
