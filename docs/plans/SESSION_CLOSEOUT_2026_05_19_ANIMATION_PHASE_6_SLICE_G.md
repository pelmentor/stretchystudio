# Session Close-out — Animation Phase 6 Slice 6.G (Exit Gate)

**Session date:** 2026-05-19 (continuation from session aggregate `8963a31`
covering 6.E + 6.F.1 + 6.F.2).
**Slice:** 6.G — Phase 6 exit gate.
**Branch:** master.
**Schema:** v42 (unchanged — 6.G is documentation + test-chain wiring only,
no new substrate).
**Status:** **PHASE 6 SHIP-COMPLETE** (7 substrate slices + exit gate).

---

## What 6.G shipped

Three deliverables; no new code substrate.

### 1. Test sweep + master-chain wiring

All eight Phase 6 test scripts pass clean against current `master`:

| Script | Phase 6 slice | Asserts |
|--------|---------------|---------|
| `test:dopesheetSelectOps` | 6.A | 60 |
| `test:dopesheetBoxSelect` | 6.B | 61 |
| `test:dopesheetGrab` | 6.C | 70 |
| `test:dopesheetDelDup` | 6.D | 83 |
| `test:dopesheetClipboard` | 6.E | 107 |
| `test:dopesheetChannelMute` | 6.F.1 | 56 |
| `test:dopesheetChannelSolo` | 6.F.2 | 48 |
| `test:fcurveSolo` | 6.F.2 | 59 |
| **Total Phase 6 substrate** | | **544** |

Cross-slice extended suites also green:
- `test:dopesheetRows`: 75 (+9 in 6.F.2 for solo greying cascade)
- `test:fcurveGroups`: 89 (+12 in 6.F.2 for `isFCurveEffectivelyMuted`
  solo cascade)
- `test:keyformSelectionStore`: 25 (extended in 6.A for state lift)
- `test:graphEditOps`: 115 (touched in 6.D for `deleteKeyforms` cite fix)
- `test:fcurveMute`: 124 (5.O substrate; sister surface to 6.F.1)

**Master `npm test` chain wiring (this commit):** ALL eight Phase 6
scripts + one Phase 4 oversight (`test:bakeNla`, 4.E substrate that was
missed at 4.F) added to the master chain. Now every Phase 6 ship is
gated by `npm test` (previously they were individually runnable but
silently skipped from the master sweep). Insertion point: directly
after `test:nlaEditorOps`, directly before `test:fmodifiers` — keeps
animation-domain tests grouped.

### 2. Cross-slice review

**SS DEVIATION ledger** (19 cumulative across Phase 6):

| # | Slice | What | Honesty class |
|---|-------|------|----------------|
| 1 | 6.A | Ctrl+LMB rebound to deselect | Honest UI extension (editor consistency) |
| 2 | 6.B | INCLUSIVE time-range bounds vs Blender's STRICT | Honest UX choice (modern marquee convention) |
| 3 | 6.B | Alt+B axis-range mode NOT shipped | Honest deferral (6.B.1 polish slice) |
| 4 | 6.C | Integer-ms time-translate | Honest discipline (matches `feedback_ms_canonical_animation_time`) |
| 5 | 6.C | Snap-to-frame NOT shipped | Honest deferral (6.C.1 polish slice) |
| 6 | 6.C | Merge epsilon 0.5ms vs 0.01f frames | Honest divergence (3× coarser; matches pointer overshoot) |
| 7 | 6.D | Empty-fcurve auto-removal NOT shipped | Honest extension (preserves channel registration) |
| 8 | 6.D | Delete confirm dialog suppressed | Honest match (mirrors Blender's dopesheet keymap `confirm=False`) |
| 9 | 6.D | Backspace aliased to Delete | Honest extension (Mac laptop accommodation) |
| 10 | 6.D | Duplicate inherits HandleParts profile | Honest divergence (invisible under realistic UX) |
| 11 | 6.E | Plan-naming clarification (selection-based vs column) | Honest disambiguation (substrate matches Blender semantics) |
| 12 | 6.E | fcurve match by exact id vs RNA path | Honest substitution (SS has stable string ids) |
| 13 | 6.E | Single paste mode (CFRA_START + MIX defaults) | Honest deferral (no SS redo panel; other modes deferred without no-op stubs per Rule №2) |
| 14 | 6.E | Shift+Ctrl+V flipped NOT shipped | Honest non-applicability (no bone RNA paths in SS dopesheet keyform model) |
| 15 | 6.E | Selection-after-paste GLOBAL replace | Honest simplification (invisible under realistic UX) |
| 16 | 6.F.1 | Hotkey M (vs Blender's Shift+W) | Honest UI choice (plan §6.B explicitly specifies M) |
| 17 | 6.F.1 | Hover-priority target selection | Honest extension (approximates Blender's region-scoped UX) |
| 18 | 6.F.1 | Solo (Ctrl+Alt+M) DEFERRED to 6.F.2 | Honest scope split (Blender's `ACHANNEL_SETTING_SOLO` is NLA-only per `ED_anim_api.hh:674`) |
| 19 | 6.F.2 | Hotkey Ctrl+Alt+M for solo | Honest UI choice (no Blender hotkey for per-FCurve solo; SS-original) |

**Rule №2 compliance:** All 19 deviations are honest. Categories:
- **6 NOT-SHIPPED items** (DEV 3, 5, 7, 13, 14, 18) all have explicit
  honest rationale + either a deferred-slice target (6.B.1 / 6.C.1 /
  6.F.2) or non-applicability proof (DEV 14 model gap, DEV 13 no-redo-
  panel, DEV 7 channel-registration rationale).
- **No no-op shims** introduced.
- **No "deferred-forever" diagnostics**: no orphaned constants,
  reserved fields, or staged-but-not-registered modules.
- **One scope split shipped same-day** (DEV 18 → 6.F.2 SHIPPED) —
  exemplifies Rule №2 honest follow-through.

**Cross-slice consistency review:**

| Pattern | 6.A | 6.B | 6.C | 6.D | 6.E | 6.F.1 | 6.F.2 |
|---------|-----|-----|-----|-----|-----|-------|-------|
| Window-level keymap effect | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Input/textarea skip gate | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| grab/box-drag ref suppression | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Action store-read at fire time | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Conditional `preventDefault` | n/a | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Pure-op + immer dispatcher split | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `would*Change` predicate exported | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `[VERIFY]`-tagged Blender cites | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

All 7 slices follow identical structural patterns. The only pattern
breaks are HONEST (6.A doesn't have a window-level keymap because it's
pointer-event-only). No latent inconsistencies found.

**Documentation completeness:**

| Slice | Substrate commit | Audit-fix commit | Close-out doc |
|-------|------------------|------------------|---------------|
| 6.A | `cfb82a9` | `5b4cccd` | `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_A.md` |
| 6.B | `bdf95a8` | `dff1c99` | `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_B.md` |
| 6.C | `98b8a2a` | `f82e670` | `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_C.md` |
| 6.D | `872a208` | `a79f431` | `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_D.md` |
| 6.E | `1aaf0b3` | `554be56` | `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_E.md` |
| 6.F.1 | `21416c5` | `1f15410` | `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_F1.md` |
| 6.F.2 | `90e8655` | `b1b7a5b` | `SESSION_CLOSEOUT_2026_05_19_ANIMATION_PHASE_6_SLICE_F2.md` |
| 6.G (this) | — | — | (this doc) |

Plus 2 cross-slice aggregates (`SESSION_AGGREGATE_2026_05_19_*_C_AND_D.md`
and `..._E_F1_F2.md`). Every shipped slice has a close-out doc.

### 3. Manual checklist authored

**`docs/plans/ANIMATION_PHASE_6_MANUAL_CHECKLIST.md`** — new doc,
9 sections covering user-side end-to-end verification of every shipped
slice's UI surface:

- §1 Slice 6.A — tick selection + cross-editor mirror
- §2 Slice 6.B — box-select (3 modifier modes + 4px threshold + B-arm)
- §3 Slice 6.C — modal grab (entry / preview / commit / cancel /
  suppression / merge-on-collision)
- §4 Slice 6.D — Delete + Backspace alias + Shift+D auto-grab
- §5 Slice 6.E — Ctrl+C / Ctrl+V (single + cross-action + MIX merge +
  browser text-copy preservation)
- §6 Slice 6.F.1 — M-key mute (hovered / selected scan-first / hover
  priority / row greying / eval drop)
- §7 Slice 6.F.2 — Ctrl+Alt+M solo (hover toggle / multi-solo /
  solo-overrides-mute / scan-first / hover priority / eval cascade)
- §8 Cross-slice gate semantics (input/textarea skip / during-grab /
  during-box-drag)
- §9 Sign-off

Estimated ~30–40 min for a single sweep. Models after the existing
`PHASE_3_MANUAL_VERIFICATION_CHECKLIST.md` structure.

---

## Phase 6 SHIP-COMPLETE summary

**Substrate:** 8 new modules + 4 extended modules in 7 substrate slices.

```
src/anim/dopesheetSelectOps.js       6.A    NEW
src/anim/dopesheetBoxSelect.js       6.B    NEW
src/anim/dopesheetGrab.js            6.C    NEW
src/anim/dopesheetDelDup.js          6.D    NEW
src/anim/dopesheetClipboard.js       6.E    NEW
src/anim/dopesheetChannelMute.js     6.F.1  NEW
src/anim/dopesheetChannelSolo.js     6.F.2  NEW
src/anim/fcurveSolo.js               6.F.2  NEW
src/anim/fcurveGroups.js             6.F.2  EXTENDED (solo cascade)
src/v3/editors/dopesheet/dopesheetRows.js
                                     6.F.2  EXTENDED (inline solo branch)
src/v3/editors/dopesheet/DopesheetEditor.jsx
                                     6.A→6.F.2  EXTENDED (state lift +
                                                7 window-level keymap effects)
src/v3/stores/keyformSelectionStore.js
                                     6.A    EXTENDED (became canonical
                                                store for selection)
```

**Tests:** 544 Phase 6 substrate asserts + 84 supporting cross-slice
extensions + 124 sibling `fcurveMute` regressions = **752 asserts under
Phase 6 gating**.

**Cite-discipline arc:**
- 5-slice fab streak BROKEN at 6.D (via rule 6 — re-verify SOURCE cites
  when re-quoting sister modules).
- **4 consecutive clean slices (6.D + 6.E + 6.F.1 + 6.F.2)** post-rule-6
  establish streak-break as durable discipline change.
- **Rule 9 introduced** mid-session in `feedback_byte_verify_behavior_cites`
  memory: "Re-SOURCE, don't re-QUOTE, when sister modules cover the
  same Blender semantic." Subsumes rule 6 by sidestepping inherited-fab
  failure class entirely.
- **6.F.2 was the first SS-original (non-port) slice in the post-rule-9
  regime** — passed honest-framing audit cleanly (0 HIGH-F / 0 MED-F /
  0 LOW-F across 12+ provenance cites).

**SS DEVIATIONS:** 19 cumulative; all audit-verified honest per Rule №2.

**Audit sweeps:** 7 Blender-fidelity + 7 architecture sweeps (one of
each per substrate slice). 0 HIGH-F findings in 4 consecutive slices
(6.D → 6.F.2). All HIGH-A and MED-A findings addressed same-day in
audit-fix commits.

**Phase 6 closes:** 1 grievance from the original 17-item Blender-
parity grievance list (Dopesheet read-only).

**Next plan section:** Phase 7 — Insert Keyframe + Keying Sets (3-5
days). No dependency blockers from Phase 6.

---

## User-side owed

- **Phase 6 manual checklist** (this slice's §3 deliverable): user-
  side ~30-40 min single sweep against `npm run dev` + Shelby project
  state. See `docs/plans/ANIMATION_PHASE_6_MANUAL_CHECKLIST.md`.
- **Phase 3+4 manual checklist** still outstanding (separate scope):
  `docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`.

Manual checklists are NOT 6.G blockers — Phase 6 is SHIP-COMPLETE
substrate-side regardless. Failed manual items become post-6.G polish
slices (6.A.1, 6.B.1, etc.).

---

## Pre-commit state

- **Branch**: master, 188 commits ahead of origin (NEVER pushed)
- **Working tree**: about to commit (1) `package.json` test-chain
  wiring, (2) `docs/plans/ANIMATION_PHASE_6_MANUAL_CHECKLIST.md`,
  (3) this close-out doc, (4) plan banner update.
- **Schema**: v42 (unchanged)
- **Phase 6 progress**: 6.A → 6.G all SHIPPED — **PHASE 6
  SHIP-COMPLETE**
- **Cite-discipline**: 4 consecutive clean slices held; rule 9 active

---

## Post-6.G queued

Per plan §4 Phase order:

- **Phase 7 — Insert Keyframe + Keying Sets** (3-5 days, plan §7.A-F).
  No schema bump expected. Closes 1 grievance (no Insert Keyframe).
- **Phase 4.G** (Phase 4 exit gate) — still GATED on user-side
  Phase 3+4 manual checklist. Ships docs-only when checklist comes
  back green.

Phase 6 leaves no work for Phase 7 to inherit. Clean handoff.
