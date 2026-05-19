# Session Close-out — Animation Phase 6 Slice 6.D (Delete + Duplicate-move)

**Session date:** 2026-05-19 (continuation; same-day as 6.A+6.B+6.C)
**Branch:** master (176 commits ahead of origin/master; +2 this slice)
**Schema:** v42 (no bump — UI substrate only)
**Status:** Slice 6.D SHIPPED.
**Phase 6 status:** 6.A + 6.B + 6.C + 6.D SHIPPED; 6.E + 6.F + 6.G
remain.

---

## What this slice shipped

### Substrate

**`src/anim/dopesheetDelDup.js`** (NEW, ~395 LOC after audit-fix):

- `applyDeleteKeyforms(action, handles)` — immer-friendly mutator.
  Pre-filters OOB + non-center entries per fcurve (audit-fix MED-A1),
  delegates to `graphEditOps.deleteKeyforms` (mirrors Blender's
  `BKE_fcurve_delete_keys_selected` at `fcurve.cc:1757-1784`),
  recalcs handles via `recalcKeyformHandles`. Returns
  `{ remaps: Map<fcurveId, Map<oldIdx, newIdx|-1>>, changed }`.
- `applyDuplicateKeyforms(action, handles)` — immer-friendly mutator.
  Walks selected center indices in ASCENDING order, inserts deep-copy
  duplicate immediately after each (mirrors Blender's
  `duplicate_fcurve_keys` at `keyframes_general.cc:62-95`). Remap
  points at the DUPLICATE positions (NOT -1; no entries removed).
- `wouldDelDupChange(handles)` — predicate. True iff any handle has
  `center === true`.

### UI surface

`src/v3/editors/dopesheet/DopesheetEditor.jsx`:

- `enterGrabModal()` useCallback helper extracted from the G-key
  effect so Shift+D can re-use it.
- Del → `applyDeleteKeyforms` via `updateProject` →
  `remapHandlesAfterTranslate` drops deleted entries from selection
  store.
- Shift+D → `applyDuplicateKeyforms` → `remapHandlesAfterTranslate`
  re-targets selection at duplicates → `enterGrabModal()` auto-enters
  the 6.C grab modal pre-targeted at the duplicates (Blender's
  `ACTION_OT_duplicate_move` macro chain at `action_ops.cc:80-89`).
- Both gated on `wouldDelDupChange(curHandles)` pre-check (matches
  Blender's `actkeys_*_exec` `OPERATOR_CANCELLED` on empty selection).
- Both suppressed during grab/box-drag via refs (audit-fix HIGH-A1).
- Backspace aliased to Delete (SS DEV 9 — Mac laptop accommodation).

### Refs added

- `boxDragActiveRef` (boolean mirror of `boxDrag !== null` for
  ref-based suppression in keymap effects, audit-fix HIGH-A1).

---

## Cite-discipline arc — **5-SLICE FAB STREAK BROKEN**

| Cite | Verified |
|------|----------|
| `blender_default.py:2703-2704` (Del + Shift+D keymap) | YES |
| `action_edit.cc:1210-1225` (ACTION_OT_delete) | YES |
| `action_edit.cc:1118-1170` (delete_action_keys wrapper) | YES |
| `fcurve.cc:1757-1784` (BKE_fcurve_delete_keys_selected) | YES |
| `fcurve.cc:1767` (f2 & SELECT gate) | YES |
| `fcurve.cc:1768-1770` (active_keyframe_index clear) | YES |
| `action_edit.cc:1154-1157` (BKE_fcurve_is_empty unhook) | YES |
| `action_edit.cc:1097-1110` (ACTION_OT_duplicate) | YES |
| `action_edit.cc:1034-1073` (duplicate_action_keys wrapper) | YES |
| `keyframes_general.cc:62-95` (duplicate_fcurve_keys kernel) | YES |
| `keyframes_general.cc:77-79` (memcpy + memcpy + memcpy pattern) | YES |
| `keyframes_general.cc:87-91` (BEZT_DESEL + BEZT_SEL pair) | YES |
| `action_ops.cc:80-89` (ACTION_OT_duplicate_move macro) | YES |
| `action_edit.cc:1194-1208` (confirm-invoke gate) | YES |
| `action_edit.cc:1166` (ANIM_animdata_update) | YES |
| `action_edit.cc:1037-1043` (ANIMFILTER setup) | YES |

**Pre-audit:** 16 cites, 0 fabs.

**Post-audit:** all 16 cites byte-verified by the Blender-fidelity
audit agent. **0 HIGH-F findings.** The 5-slice fab streak (4.D.4 /
4.E / 6.A / 6.B / 6.C) is **BROKEN at 5**.

Streak arc:
- 5.P broke at 0 → reset
- 3.F-4.C HOLDS at 5 → 4.D.1 BROKE → reset
- 4.D.2 HOLDS at 1 → 4.D.3 HOLDS at 2 → 4.D.4 BROKE at 2 → reset
- 4.E BROKE at 2 → reset → 4.F clean
- 6.A BROKE at 2 → reset
- 6.B BROKE at 1 → reset
- 6.C BROKE at 3 → reset (5-slice streak peak)
- **6.D CLEAN at 0 — streak BROKEN** (1-slice arc CLEAN counter starts)

### Why 6.D shipped clean

The post-6.C meta-feedback added rule 6 to
`feedback_byte_verify_behavior_cites`:

> **6. Re-verify SOURCE cites when re-quoting from sister modules
> (6.C lesson).** When a slice cites a value/function/formula that
> another in-tree docstring already documented, DON'T trust the
> in-tree docstring. Open Blender's actual file + verify.

For 6.D, this meant: even though `graphEditOps.deleteKeyforms` was
already documented with its own Blender cites, I opened `fcurve.cc`
and re-verified the `BKE_fcurve_delete_keys_selected` semantic
before re-quoting. The pre-check also caught `duplicate_fcurve_keys`'s
`BEZT_DESEL_ALL + BEZT_SEL_ALL` pair (which led to the MED-F1
finding about SS's partial-bit divergence). Rules 7 + 8 (pattern
memory + paraphrase elision) didn't fire because the cites here
are mechanical (function names + line ranges + macro definitions
— low pattern-memory load).

---

## Audit findings rolled up (sweep #74)

| Audit | HIGH | MED | LOW | CITE FABS |
|-------|------|-----|-----|-----------|
| Architecture | 2 (re-mount + handles consistency) | 2 (silent invariant + Backspace doc) | 2 (test doc gap) | 0 |
| Blender fidelity | 0 | 1 (selection-bit divergence) | 3 (doc polish) | **0** |

All findings addressed in same-day audit-fix commit `a79f431`.

---

## SS deviations (4 new this slice; Phase-6-cumulative 10)

- **DEV 7 (Phase 6)** — Empty-fcurve auto-removal NOT shipped.
  Blender's `BKE_fcurve_is_empty → ED_anim_ale_fcurve_delete` path
  at `action_edit.cc:1154-1157` unhooks empty fcurves from the
  action; SS keeps them so the user can re-insert keys without
  losing the channel registration.
- **DEV 8 (Phase 6)** — Delete confirm dialog suppressed. Blender's
  `actkeys_delete_invoke` (`action_edit.cc:1194-1208`) gates the
  dialog on RNA `confirm=True`; the dopesheet keymap binding passes
  `confirm=False`, so SS mirrors the suppressed-confirm dopesheet
  behavior.
- **DEV 9 (Phase 6)** — Backspace aliased to Delete. Blender's
  keymap binds only `DEL`; SS extends to also accept Backspace
  because Mac laptops have no physical Delete key (the labelled
  "delete" IS Backspace). The input-skip guard prevents Backspace
  from firing inside text fields. Audit-fix MED-A2.
- **DEV 10 (Phase 6)** — Duplicate inherits original's HandleParts
  profile verbatim instead of Blender's `BEZT_SEL_ALL(copy)`
  force-all-on at `keyframes_general.cc:91`. Under realistic SS UX
  (tick-click + box-select set all 3 bits in lockstep), divergence
  is invisible; partial-bit selections diverge. Audit-fix MED-F1.

---

## Rule №1 catches surfaced this slice

1. **Architecture HIGH-A1 (re-mount cycle)** — Both new keymap
   effects (G-key from 6.C + Del/Shift+D from 6.D) had
   `[grabState, boxDrag, ...]` deps that re-mounted listeners on
   every grab-frame + box-drag-frame (60-120 Hz). Same shape as
   6.B HIGH-A1 (handleTrackPointerMove fix). Added `boxDragActiveRef`
   sibling to `grabActiveRef`; both keymap effects now gate via refs
   and stay mounted once.

2. **Architecture HIGH-A2 (handles snapshot consistency)** —
   6.C grab commit + 6.D Delete + Shift+D paths each read
   `useKeyformSelectionStore.getState().handles` 2-3 times in the
   same synchronous event handler. Today the snapshots can't
   diverge (no middleware), but structurally inconsistent. Now all
   3 sites snapshot ONCE into `curHandles` and reuse for the no-op
   check + op input + remap input.

3. **MED-A1 (silent invariant)** — `applyDeleteKeyforms` had
   `if (fc.keyforms.length === before) continue` that silently
   dropped the remap. Converted to explicit pre-filter at the
   contract boundary (skip OOB + non-center entries before
   delegating to `graphEditOps.deleteKeyforms`) + Rule №1 throw on
   actual invariant violation. Pre-filter catches a real pre-existing
   latent bug: `deleteKeyforms` builds a non-empty survivor-remap
   even when ALL selection entries are OOB (because it walks the
   array, not the selection). New test §28b covers OOB-only no-throw
   path.

4. **MED-A2 (Backspace alias undocumented)** — Backspace was treated
   as Delete without an SS DEVIATION. Now documented as SS DEV 9.

5. **Fidelity MED-F1 (selection-bit divergence undocumented)** —
   Pre-fix the docstring claimed "exactly matching Blender's
   `BEZT_DESEL_ALL(original) + BEZT_SEL_ALL(copy)` pair" — partial
   lie. Blender's `BEZT_SEL_ALL` force-sets f1+f2+f3; SS preserves
   the original's partial-bit profile. Documented as SS DEV 10.

---

## Test counts

| File | Pre-slice | Post-slice |
|------|-----------|------------|
| `test_dopesheetDelDup.mjs` | 0 | 83 |

All sibling NLA / FCurve / Keyform / Dopesheet test suites still
green (verified via full sweep — fcurveActive, fcurveBoxSelect,
fcurveChannelSelect, fcurveEval, fcurveGroups, fcurveModifiers*,
keyform*, nla* incl. test_nlaEval/test_nlaEditorOps/test_nlaTweakMode/
test_nlaEditorData, test_bakeNla, test_dopesheetSelectOps,
test_dopesheetBoxSelect, test_dopesheetGrab, test_graphEditOps,
test_fmodifiers, test_keyformSelectionStore). Typecheck clean.

---

## Commits this slice (2)

```
872a208 feat(anim): Phase 6 Slice 6.D — Dopesheet delete (Del) + duplicate-move (Shift+D)
a79f431 fix(audit): Phase 6 Slice 6.D audit-fix — 2 HIGH-A + 2 MED-A + 1 MED-F + 1 LOW-F + 2 new SS DEVs
```

(+1 docs commit shipping this close-out + plan banner + MEMORY.)

---

## Top queued path next

**Slice 6.E — Column copy/paste (Ctrl+C / Ctrl+V).**

Per plan §6.B operator table:
- `dopesheet.copyColumn | Ctrl+C | Copy column at playhead`
- `dopesheet.pasteColumn | Ctrl+V | Paste at playhead`

Mirrors Blender's `ACTION_OT_copy` + `ACTION_OT_paste` (both at
`action_edit.cc` — similar wrapper-around-keyframes-general pattern).

Key Blender refs to byte-verify pre-draft:
- Keymap: `blender_default.py` near `:2700` (Ctrl+C / Ctrl+V dopesheet
  bindings).
- `ACTION_OT_copy` + `ACTION_OT_paste` operator definitions.
- Internal "keyframe buffer" datastructure (Blender uses a static
  array of fcurves as the clipboard — verify the data model).
- Paste-at-playhead semantics (offset from copy-time origin).

SS will need:
- A pure `copyKeyformsColumn(action, handles, originTime)` →
  returns a transferable clipboard buffer (per-fcurve list of
  keyforms with times offset from `originTime`).
- A pure `pasteKeyformsColumn(action, clipboard, destinationTime)`
  → mutates action by inserting clipboard entries at
  `destinationTime + (entry.timeOffset)` per fcurve.
- A module-level clipboard storage (singleton — matches Blender's
  per-process keyframe buffer).
- DopesheetEditor wires Ctrl+C → copy; Ctrl+V → paste, both at
  the current `useAnimationStore.currentTime`.

After 6.E:
- **6.F** — Per-channel mute (M) + solo (Ctrl+Alt+M)
- **6.G** — Test sweep + Phase 6 exit gate

---

## Pre-compact state (snapshot)

- **Branch**: master, 176 commits ahead of origin (NEVER pushed)
- **Working tree**: about to commit this close-out + plan banner +
  MEMORY
- **Schema**: v42 (unchanged)
- **Phase 6 progress**: 6.A + 6.B + 6.C + 6.D SHIPPED (4/7 slices);
  6.E-6.G remain (~1-2 days estimated)
- **Tests added this slice**: 83 new asserts (test_dopesheetDelDup);
  all sibling suites green; typecheck clean
- **Audit sweep this slice**: #74: 0 HIGH-F (FAB STREAK BROKEN) +
  2 HIGH-A + 2 MED-A + 1 MED-F + LOW polish; all addressed
- **Cite-discipline**: 0 fabs on 6.D substrate, **5-SLICE FAB STREAK
  BROKEN**. The rule-6 mitigation (re-verify SOURCE cites when
  re-quoting from sister modules) WORKED.
- **SS deviations (Phase 6)**: 10 cumulative (DEV 1 Ctrl+LMB rebind;
  DEV 2 inclusive bounds; DEV 3 axis-range deferred; DEV 4 integer-ms
  quantize; DEV 5 snap deferred; DEV 6 merge epsilon; DEV 7
  empty-fcurve preserved; DEV 8 confirm dialog suppressed; DEV 9
  Backspace alias; DEV 10 partial-bit selection preserved on duplicate)
- **User-side owed**: Phase 3 + 4 manual checklist still outstanding
  (`docs/plans/ANIMATION_PHASE_3_4_MANUAL_CHECKLISTS.md`); Phase 6
  manual checklist accrues at 6.G
