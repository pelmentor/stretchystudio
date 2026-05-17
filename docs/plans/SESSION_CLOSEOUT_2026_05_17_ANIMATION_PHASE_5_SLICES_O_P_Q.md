# Session close-out — 2026-05-17 — Animation Phase 5 Slices 5.O / 5.P / 5.Q

**Session shape:** Three back-to-back Phase 5 slices shipped from one
`/compact`-resumed session, closing 3 of the 17 queued resume paths
from the prior session's close-out
(`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICES_L_M_N.md`).
Each slice followed the standard substrate → dual-audit → audit-fix
→ close-out cadence; per-slice close-outs at
`SESSION_CLOSEOUT_2026_05_17_ANIMATION_PHASE_5_SLICE_O.md`,
`..._SLICE_P.md`, and `..._SLICE_Q.md` capture full details. This
document is the session-spanning index.

## Commits this session (9 commits, all on `master`)

| SHA       | Subject                                                                          |
|-----------|----------------------------------------------------------------------------------|
| `b1f8ad9` | feat(anim): Animation Phase 5 Slice 5.O — bulk channel mute (sidebar Shift+W / Ctrl+Shift+W / Alt+W) |
| `14c7f50` | fix(audit): Animation Phase 5 Slice 5.O dual-audit sweep — 2 LOW (header annotations) |
| `23bfa8a` | docs(plan): Animation Phase 5 Slice 5.O close-out                               |
| `e2bf302` | feat(anim): Animation Phase 5 Slice 5.P — FCurveEditor per-editor footer (channel-state summary + active label) |
| `75da930` | fix(audit): Animation Phase 5 Slice 5.P dual-audit sweep — 1 MED + 1 LOW         |
| `7407324` | docs(plan): Animation Phase 5 Slice 5.P close-out                                |
| `a869a5d` | feat(anim): Animation Phase 5 Slice 5.Q — Active Keyframe N-panel (Interpolation + Time + Value) |
| `9d63bf3` | fix(audit): Animation Phase 5 Slice 5.Q dual-audit sweep — 2 HIGH + 3 MED        |
| `a702a2e` | docs(plan): Animation Phase 5 Slice 5.Q close-out                                |

## Slices at a glance

| Slice | Surface | Keymap / trigger | Shape |
|-------|---------|------------------|-------|
| 5.O   | Bulk channel mute (`anim.channels_setting_*` w/ MUTE) | Shift+W / Ctrl+Shift+W / Alt+W — sidebar region only | Blender-port keymap parity |
| 5.P   | FCurveEditor per-editor footer (channel counts + active label) | (always-visible per-editor footer at bottom of editor) | SS-shape extension repurposing freed FOOTER region |
| 5.Q   | Active Keyframe N-panel (Interpolation + Time + Value) | N key (bare) — `_template_space_region_type_toggle` | Blender-port + new UI surface (right sidebar) |

## Streak status — fidelity zero-fab

| Slice | Blender-fidelity audit findings | Streak |
|-------|--------------------------------|--------|
| 5.K (prior session) | 0 HIGH (1 MED + 1 LOW) | 1 |
| 5.L (prior session) | 0 HIGH (1 LOW citation nit) | 2 |
| 5.M (prior session) | 0 HIGH (1 MED + 1 LOW housekeeping) | 3 |
| 5.N (prior session) | **0 / 0 / 0 — fully clean** | 4 |
| **5.O (this session)** | **0 / 0 / 0 — fully clean** | **5** |
| **5.P (this session)** | **1 MED — fabricated `interface_template_status.cc:475` citation** | **BROKEN at 5** |
| **5.Q (this session)** | **1 HIGH (handles_recalc omission) + 2 MED (cite drifts) + 1 MED (undocumented divergence)** | **0** |

The Slice 5.P fab broke the 5-run streak honestly. The fidelity
discipline (now generalized post-5.P — see
`feedback_modifier_binding_check_keymap_first`'s extended scope to
"ALL Blender citations, not just keymap modifier claims") caught it
cleanly AND caught 5.Q's real HIGH (handles_recalc omission for AUTO
handle integrity) + 2 cite drifts.

**Net signal:** the discipline is paying off. 3 substantive fidelity
findings caught + fixed this session (1 fab + 1 functional gap + 2
cite drifts), each of which would have shipped silently without the
dedicated fidelity audit lane.

## Streak status — architecture (overall)

| Slice | Architecture audit findings | Overall streak |
|-------|----------------------------|----------------|
| 5.O | 0 HIGH (2 LOW header annotations) | held |
| 5.P | 0 HIGH (1 LOW path typo) | held |
| **5.Q** | **1 HIGH (HTMLSelectElement input-guard latent bug exposed by N-panel `<select>`)** | RESET to 0 |

The Slice 5.Q architecture HIGH is the more important kind of
finding: a LATENT bug that affected every existing editor keybind
(G, S, B, V, T, X, A, H, W…) was exposed by the first `<select>`
dropdown added to the editor. Fix lifted ALL keybinds, not just
5.Q's — the gap had been silently present since the editor's first
keymap branch.

**Pattern reinforced (5.Q lesson #4):** dual-audit value isn't just
"did the new code break", it's "did the new code surface existing
breakage that wasn't visible before". Both kinds of findings count.

## Test counts (cumulative through session)

| Suite                          | Pre-session | Slice 5.O | Slice 5.P | Slice 5.Q | Total |
|--------------------------------|-------------|-----------|-----------|-----------|-------|
| test:activeKeyformPanelData (NEW) | —        | —         | —         | **+70**   | 70    |
| test:fcurveFooterData (NEW)    | —           | —         | **+38**   | 38        | 38    |
| test:fcurveMute                | 38          | **+86**   | 124       | 124       | 124   |
| test:fcurveChannelSelect       | 204         | 204       | 204       | 204       | 204   |
| test:fcurveVisible             | 142         | 142       | 142       | 142       | 142   |
| test:fcurveKeyformSelect       | 34          | 34        | 34        | 34        | 34    |
| test:fcurveActiveKeyform       | 62          | 62        | 62        | 62        | 62    |
| test:fcurveEval                | 35          | 35        | 35        | 35        | 35    |
| test:fcurveHandles             | 35          | 35        | 35        | 35        | 35    |
| test:graphEditOps              | 115         | 115       | 115       | 115       | 115   |
| test:animFCurveBridge          | 52          | 52        | 52        | 52        | 52    |
| **TOTAL** (12 suites)          | **717**     | **803** (+86) | **841** (+38) | **911** (+70) | **911** |

`tsc --noEmit` clean at every commit boundary.

## New patterns this session

1. **Shared resolution function for preflight↔mutator parity (5.O).**
   When the preflight needs to compute a state-derived direction
   (e.g. TOGGLE scan-first resolution), factor the resolution into a
   single internal helper that BOTH preflight and mutator call. This
   structurally eliminates drift between the two surfaces.

2. **SS-shape extension framing (5.P).** When a slice repurposes a
   Blender region slot for SS-specific content (rather than porting
   Blender's content verbatim), the commit message must explicitly
   flag "SS-shaped extension; not a strict Blender port" so future
   readers don't expect byte-faithful parity. Documented deviations
   list closure conditions for any future "match Blender exactly"
   ask.

3. **Pre-verify EVERY Blender citation (5.P/5.Q lesson).** The
   `feedback_modifier_binding_check_keymap_first` discipline
   generalizes from "verify keymap modifier citations" to "verify
   ANY Blender citation (path + line + content) against the actual
   reference clone". Memory entry updated to reflect the
   generalization. Slice 5.P fab + Slice 5.Q two cite drifts were
   all caught by the fidelity audit — discipline works, but the
   substrate author should pre-verify to avoid the audit catching
   easy misses.

4. **MVP scope is a UI choice, not a correctness choice (5.Q
   HIGH-B1 lesson).** When defining "what ships in the MVP", scope
   the UI surface area, but NEVER scope the data-layer correctness.
   Slice 5.Q chose to defer the handle-editing UI but should never
   have omitted the handle-recalc data integrity. AUTO handles'
   STORED tangents depend on neighboring values; omitting the
   recalc on value edits would have drifted the curve shape on
   AUTO-handle data even though the panel never showed handles.
   Future MVP framings: "ship complete data layer + minimum UI
   surface", not "ship minimum data + minimum UI".

5. **Latent bugs exposed by new code count toward audit signal
   (5.Q HIGH-A1).** The HTMLSelectElement input-guard gap was
   latent across the editor since its first keymap branch; the
   audit lane caught it the moment Slice 5.Q added the first
   `<select>` dropdown. Dual-audit value: surface existing
   breakage AS new code becomes visible to it. Fix lifts ALL
   affected surfaces, not just the one the new code exposed.

## Owed manual browser verification (cumulative)

Per-slice close-out docs list 10-15 specific flows each. Aggregate
themes:

- **Universal guards** — every new keymap branch sits after the
  modal/menu/input/select guards in `onKeyDown`. Verify no
  regressions in 5.O Shift+W, 5.Q N, and any prior keybinds.
- **Sidebar region routing** — 5.O's W keybindings + 5.N's X/DEL
  + 5.K's A/Alt+A/Ctrl+I all gate on `regionHoverRef.current
  === 'sidebar'`. Same known keyboard-nav limitation (queued path
  #17 — sidebar focus tracking).
- **Preflight undo correctness** — 5.O bulk mute, 5.Q value/frame/
  interp edits all gate via `wouldEdit*Change` preflights. Verify
  no-op presses don't burn Ctrl+Z slots.
- **Auto-handle integrity** (5.Q HIGH-B1 fix) — value edits via
  the N-panel should propagate to AUTO handle positions. Verify
  curve shape near the edited keyform adjusts visually on AUTO
  data.
- **N-panel + select dropdown UX** (5.Q HIGH-A1 fix) — pressing
  N inside the interpolation dropdown should NOT toggle the panel
  closed.
- **Per-editor footer** (5.P) — channel counts update on
  hide/mute/select operations; active label updates on click-to-
  activate.

## Documented SS deviations (cumulative across session)

| Slice | # | Deviation | Closure condition |
|-------|---|-----------|-------------------|
| 5.O   | 1 | No type-picker menu (Blender pops `{PROTECT, MUTE}`) | PROTECT slice + popup-menu primitive |
| 5.O   | 2 | No Industry-Compatible keymap support | SS keymap-preset selector |
| 5.O   | 3 | No FCurveGroup flush | FCurveGroup datablock |
| 5.P   | 1 | Channel-state summary instead of playback controls | SS regrows per-editor transports |
| 5.P   | 2 | No driver-mode footer alternative | Driver editor as separate surface |
| 5.Q   | 1 | MVP omits handle editing + easing | Slice 5.R |
| 5.Q   | 2 | No per-property unit conversion | Future parameter-units system |
| 5.Q   | 3 | Frame field shows ms (not frames) | Phase 5 #7 SIPO_DRAWTIME toggle |
| 5.Q   | 4 | Default interpolation 'linear' (not BEZT_IPO_BEZ) | Future "match Blender defaults" sweep |

## Queued resume paths

Status now (paths 1-19 from prior session + 20 new this session):

| # | Path | Status |
|---|------|--------|
| 1 | Ctrl+I keyform invert | SHIPPED (5.L) |
| 2 | H / Shift+H / Alt+H | SHIPPED (5.M) |
| 3 | Operators-on-selected-channels (delete) | SHIPPED (5.N) |
| 3.MUTE | Shift+W / Ctrl+Shift+W / Alt+W | **SHIPPED (5.O)** |
| 4 | Footer wiring for fcurve channel state | **SHIPPED (5.P)** |
| 5 | N-panel active-keyform numerical editor | **SHIPPED MVP (5.Q)** |
| **5.R** | **Active Keyframe handle editing + easing** | **NEW TOP — closes 5.Q Dev 1** |
| 6 | Driver variable list / expression editor | queued |
| 7 | SIPO_DRAWTIME seconds-vs-frames toggle | queued (closes 5.Q Dev 3) |
| 8 | USER_FLAG_NUMINPUT_ADVANCED | queued |
| 9 | Group-level mute (AGRP_MUTED) + hide | queued (FCurveGroup gate) |
| 10 | DopesheetEditor row-state styling | queued |
| 11 | Per-fcurve ACTIVE slot | queued |
| 12 | ANIM_OT_channels_select_box drag-rect on sidebar | queued |
| 13 | Phase 2 owed-manual verification | queued |
| 14 | Phase 3 — F-Curve modifiers | queued |
| 15 | SS keymap-preset selector | queued (closes 5.M Dev 2 + 5.N Dev 1 + 5.O Dev 2) |
| 16 | Hide/reveal toast notifications | queued |
| 17 | Sidebar focus tracking for region-aware keys | queued |
| 18 | Popup-menu primitive | queued (paired with PROTECT) |
| 19 | `fcurve.protected` (FCURVE_PROTECTED port) | queued |
| 20 (NEW) | N-panel collapse-state persistence + multi-panel host | queued — lift Slice 5.Q's local React state to per-editor view-state store |

## Pre-compact state

| Field             | Value                                                  |
|-------------------|--------------------------------------------------------|
| Branch            | `master`                                               |
| Working tree      | clean                                                  |
| Commits ahead     | **52 commits ahead of `origin/master`**                |
| `tsc --noEmit`    | clean                                                  |
| Affected tests    | **911/911 pass across 12 phase-5 suites**              |
| Fidelity streak   | **0** (broke at 5.P fab; 5.Q caught HIGH + 2 MED)     |
| Architecture HIGHs caught | 1 (5.Q HTMLSelectElement gap — latent, lifted globally) |
| Audit-fix sweeps total | **37** across the project lifetime                |
| Cumulative session deviations | **9** (3 + 2 + 4 across 5.O/5.P/5.Q)           |
| Next path (top queued) | **#5.R** — Active Keyframe handle editing (handle Type + Frame + Value for L+R when bezier; easing direction + easing extras for BACK/ELASTIC). Closes 5.Q Dev 1. |

## Session lessons (internalized for next session)

1. **Pre-verify cites before submitting JSDoc.** Slice 5.P fab +
   5.Q two cite drifts all caught by fidelity audit. Every Blender
   citation is a testable claim; grep the reference clone first.
   The post-5.P discipline generalization is in
   [feedback_modifier_binding_check_keymap_first.md].

2. **MVP omission must be UI-scope only.** Data-layer correctness
   is non-negotiable. Slice 5.Q omitted handle-editing UI but
   should never have omitted handle-recalc data integrity.
   Memorialize: when scoping an MVP, ask "does the omission affect
   UI surface area, or correctness of data?". Only UI omissions
   are valid.

3. **Latent bugs exposed by new code count.** Slice 5.Q HIGH-A1
   was a years-old (since editor inception) keybind-guard gap that
   only surfaced when the editor got its first `<select>` dropdown.
   Fix it globally when caught, not just for the surface that
   exposed it.

4. **Shared resolution functions prevent preflight drift.**
   Slice 5.O's `resolveToggleDirection` factored TOGGLE scan-first
   resolution into one helper called by both the preflight and the
   mutator. Drift is structurally impossible as long as the
   resolution function is the single decision point. Use this
   pattern for any operator with non-trivial mode resolution.

5. **N-panel infrastructure is the foundation for many future
   slices.** Slice 5.Q built the N-panel host as a local-React-
   state right sidebar. Slice 5.R (handle editing) adds to the
   SAME panel; future Phase 5 slices (#6 driver editor, #9 group
   editor, #14 F-Curve modifiers) all live in panels mounted in
   the same N-panel host. Queued path #20 (persistence + multi-
   panel host) is the non-blocking polish that lets the host
   accommodate >1 panel cleanly.
