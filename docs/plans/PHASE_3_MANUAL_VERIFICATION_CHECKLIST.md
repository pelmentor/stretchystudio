# Phase 3 — Manual Verification Checklist

**Owner:** user (single end-to-end sweep)
**Scope:** Phase 3 Slices 3.C (FModifier UI), 3.D (Cycles → motion3.json
Loop), 3.E (Noise → motion3.json bake). Slices 3.A/3.B (substrate +
live evaluator) + 3.F (per-type tests) + 3.G (round-trip + this doc)
have no user-side UI surfaces — automated tests are sufficient.

**Purpose:** Consolidate the manual-verification items deferred during
the 3.C/3.D/3.E slice ships (`feedback_no_background` — no autonomous
dev-server start) into a single sweep the user can execute end-to-end.
3.G is the Phase 3 exit gate; this checklist is its user-facing half.

**Estimated time:** 25–35 minutes (1 dev-server start, ~5 export
round-trips, no PSD re-import needed — Shelby's existing project state
suffices for every item).

---

## Setup

```
npm run dev
```

Open in browser. Load Shelby project (the test character per
`feedback_test_character_is_shelby`). If no project loaded, import
Shelby PSD via the wizard once — subsequent items reuse the same
project state.

Open the **Animation** workspace and create a test action with at
least 3 fcurves of mixed types (e.g. `ParamAngleX`, `ParamAngleY`,
`ParamBodyAngleX`). Any non-trivial action works.

---

## §1 — Slice 3.C: FModifier UI (N-panel Modifiers section)

The 3.C ship added a modifier-stack panel to the FCurve editor's N-panel.
The 6 modifier types (Cycles, Noise, Generator, Limits, Stepped Envelope,
Envelope) are addable via the panel's add-button and stack head-of-list.

### §1.1 — Add modifier (all 6 types)

For each of the 6 types, in turn:

- [ ] Select a fcurve in the FCurve editor.
- [ ] Open the N-panel (right side) → "Modifiers" section.
- [ ] Click "Add Modifier" → pick the type from the dropdown.
- [ ] Verify a new modifier row appears with the type label, mute/disable
  toggles, expand-collapse caret, and remove (X) button.
- [ ] Verify `Cycles` lands at index 0 (head-of-stack invariant per
  Blender `fmodifier.cc:635` `BLI_assert(fcm->prev == nullptr)`). The
  other 5 types may stack in any order.

### §1.2 — Per-type field editing

For each modifier added in §1.1:

- [ ] Expand the modifier row (caret).
- [ ] Edit each field — sliders/spinners/dropdowns.
- [ ] Verify the FCurve display updates live as you drag values.
- [ ] Specifically for `Cycles`: try `after = repeat`, `after = repeat_offset`,
  `after = mirror`. The fcurve display should show the cycle behaviour
  past the last keyform.
- [ ] Specifically for `Noise`: try changing `size` (high freq vs low
  freq), `strength`, `blendType` (`replace` / `add` / `subtract` /
  `multiply`). Each blend mode visibly differs.

### §1.3 — Mute / disable

- [ ] Click the mute (eye) icon on any modifier → fcurve display
  reverts to the unmodified curve (the modifier's contribution drops).
- [ ] Click again → effect returns.
- [ ] Same for the disable toggle if exposed separately.

### §1.4 — Remove / reorder

- [ ] Remove a non-Cycles modifier (X button) → it disappears, fcurve
  updates immediately.
- [ ] Add 3 non-Cycles modifiers, drag-reorder them in the panel.
- [ ] Verify the modifier list reflects the new order and the fcurve
  display updates (modifier evaluation order matters for non-
  commutative combinations, e.g. Limits-before-Noise vs Noise-before-
  Limits).

### §1.5 — Undo / redo

- [ ] Add a modifier → Ctrl+Z → modifier disappears.
- [ ] Ctrl+Y → modifier reappears.
- [ ] Edit a field → Ctrl+Z → field reverts.
- [ ] Mute → Ctrl+Z → unmuted.

### §1.6 — Expand-collapse persistence

- [ ] Expand a modifier, switch to another fcurve, switch back. The
  expand state should persist per-modifier (or reset cleanly — either
  is acceptable; just note which).

---

## §2 — Slice 3.D: Cycles → motion3.json Meta.Loop

The 3.D ship maps a uniform head-of-stack `Cycles` modifier (with
`after: 'repeat'`) on every fcurve in the action to `Meta.Loop = true`
in the exported motion3.json. Mixed actions (some cycle, some don't)
get `Loop = false` and the cycling fcurves bake into explicit keyforms.

### §2.1 — Uniform Cycles → Loop = true

- [ ] In the action created above, add a `Cycles` modifier with
  `after = repeat` to EVERY fcurve.
- [ ] Export the action as `.motion3.json` (Export menu).
- [ ] Open the exported `.motion3.json` in a text editor.
- [ ] Verify `Meta.Loop: true`.
- [ ] Verify each `Curves[].Segments` array is short (no bake — original
  keyforms preserved).

### §2.2 — Mixed → Loop = false + bake

- [ ] Remove the `Cycles` modifier from ONE fcurve (leave it on the
  others).
- [ ] Re-export.
- [ ] Verify `Meta.Loop: false`.
- [ ] Verify the still-cycling fcurves' `Segments` arrays are LONGER
  (bake fired — sample-per-frame at the action's FPS over the action
  duration).
- [ ] Verify the non-cycling fcurve's `Segments` array is still short
  (its keyforms ship as-authored).

### §2.3 — No Cycles → Loop = false

- [ ] Remove `Cycles` from all fcurves.
- [ ] Re-export.
- [ ] Verify `Meta.Loop: false` and all `Segments` arrays are short.

### §2.4 — Round-trip via existing Cubism motion

- [ ] Import an existing Cubism-authored loop motion (e.g. Hiyori's
  `runtime/motion/hiyori_m01.motion3.json`) via the timeline-bar
  motion3.json import.
- [ ] In the FCurve editor's N-panel, verify EVERY imported fcurve
  carries a head-of-stack `Cycles` modifier with `after = repeat`.
- [ ] Re-export the imported motion. Verify `Meta.Loop: true` survives.

### §2.5 — Cubism Viewer load (loop behaviour)

This is the load-bearing fidelity gate — automated tests pin the
predicate, but Cubism Viewer's runtime is the ground truth for "does
it actually loop seamlessly?".

- [ ] Load the §2.1 export (uniform Cycles → Loop=true) into Cubism
  Viewer.
- [ ] Play the motion. Verify it loops seamlessly (no visible discontinuity
  at the loop boundary).
- [ ] Load the §2.2 export (mixed → Loop=false + bake) into Cubism
  Viewer.
- [ ] Verify it plays once then stops (no loop) AND the cycling
  parameters still animate per-frame (bake fidelity).

---

## §3 — Slice 3.E: Noise → motion3.json bake

The 3.E ship triggers an unconditional bake for any fcurve carrying an
active `Noise` modifier — regardless of `Meta.Loop` status. Cubism has
no live-noise primitive; the only representation is the baked sample
sequence.

### §3.1 — Noise bake fires

- [ ] Add a `Noise` modifier (any blend type) to ONE fcurve.
- [ ] Export.
- [ ] Verify that fcurve's `Segments` array is LONG (bake fired —
  sample-per-frame).
- [ ] Verify non-Noise fcurves ship their original keyforms unchanged.

### §3.2 — Muted Noise skips bake

- [ ] Mute the `Noise` modifier (eye icon in §1.3).
- [ ] Re-export.
- [ ] Verify the fcurve's `Segments` array is back to short (no bake —
  muted modifier is a no-op).

### §3.3 — Cycles + Noise hybrid

- [ ] Add `Cycles` (after=repeat) AND `Noise` to the SAME fcurve.
- [ ] Add `Cycles` (after=repeat) to all other fcurves (no Noise).
- [ ] Re-export.
- [ ] Verify `Meta.Loop: true` (uniform Cycles satisfies the predicate).
- [ ] Verify the Cycles+Noise fcurve's `Segments` is LONG (Noise bake
  fires regardless of Loop).
- [ ] Verify the Cycles-only fcurves' `Segments` are short (no bake under
  Loop=true).
- [ ] **Known SS deviation:** Cubism replays the same baked noise
  samples each loop iteration (Blender re-evaluates noise per cycle).
  Documented in plan §3.E. Verify the loop is seamless; the per-cycle
  noise pattern repetition is expected.

### §3.4 — Determinism (same export → identical bytes)

- [ ] Export the §3.3 action twice in a row (without editing).
- [ ] `diff` the two `.motion3.json` files. They MUST be byte-identical.
  (Pinned by `test:fmodifierRoundTrip` §7 automatically — this is a
  user-side sanity check.)

---

## §4 — Cubism Viewer integration tests (load-bearing)

These items require Cubism Viewer (per `reference_cubism_editor` —
user has Cubism 5.0 installed).

- [ ] §2.5 above (Loop=true seamless loop; Loop=false single-shot +
  baked motion).
- [ ] Load the §3.1 Noise-baked export → verify the noise plays
  visually (parameter wiggles per the baked sequence).
- [ ] Load the §3.3 Cycles+Noise hybrid → verify Loop=true plays
  seamlessly AND the noise wiggle repeats per cycle.

---

## Notes for reporting

For each `[ ]` checked: optional. For each item that FAILS to behave
as described: file as a follow-up against Phase 3, citing the section
number (e.g. "§2.5 Loop=true does not loop seamlessly in Cubism
Viewer"). The automated tests pin the SS-side semantics; Cubism Viewer
discrepancies indicate either (a) a SS export-side bug or (b) an
intentional SS deviation that needs documenting in plan §3.{D,E}.

When the sweep completes (or items 1–3 complete with item 4 deferred
to next Cubism Viewer access), file: "Phase 3 manual verification
complete — date — N/N items passed". Phase 3 → SHIP-COMPLETE on the
plan doc.
