# Animation Phase 3 + 4 — Manual Verification Checklists

**Owed-from session(s):** Phase 3 carryover + Phase 4 §4.G accrual.
Surfaced + filled by Slice 4.F (test parity sweep).

**Scope.** Automated tests cover substrate correctness (735 Phase 4
asserts + 5K+ project-wide). These checklists cover the UI surfaces
+ interaction flows that only human + browser can validate:
mouse/keyboard ergonomics, visual rendering correctness, dialog +
toast UX, end-to-end authoring scenarios.

**How to use.** Open the app (`npm run dev`), load Shelby PSD via
the Init Rig wizard, then walk each section in order. Mark each
checkbox `[x]` as you confirm; record any deviation as a note under
the failing item. Report back so the deviation can become a tracked
bug (or, if the spec was wrong, the spec gets amended).

---

## Phase 3 — FModifier UI surface (Slice 3.C)

**Goal.** Every of the 6 FModifier types can be added, edited,
reordered, muted, and removed via the FCurveEditor's N-panel
("Modifiers" section, mounted below `ActiveKeyformPanel`).

### 3.C.1 — Per-modifier-type add + edit

For each FModifier type below: select a parameter with at least one
keyframe in the Action editor → switch to FCurve editor → open the
N-panel → expand "Modifiers" → click "Add Modifier" → choose the
type → expand the new modifier card.

- [ ] **Generator** — function-curve overlay. Add with default
  coefficients; observe the fcurve curve in the editor changes
  shape (a polynomial overlay added to the keyform interpolation).
  Edit `mode` (linear / polynomial / factorised), `coefficients[]`,
  `use_additive` — verify the curve re-renders correctly each edit.
- [ ] **Envelope** — control-point envelope clamps fcurve to
  per-time min/max band. Add with default empty envelope; observe
  no visual change. Add a control point at t=0 + another at
  t=1000ms with min/max bands; observe fcurve clamping. Edit point
  times + bands; verify re-render.
- [ ] **Cycles** — pre/post repeat. Add with default "REPEAT both
  sides"; observe fcurve extension before t=first-key and after
  t=last-key. Change `before_mode` / `after_mode` between
  REPEAT / REPEAT_OFFSET / MIRROR / NONE; verify each extension
  rule. Verify "Add Modifier" dropdown GREYS the Cycles option
  when one already exists on the fcurve (Blender deviation: only
  ONE Cycles modifier per fcurve).
- [ ] **Noise** — additive noise overlay. Add with default
  scale/strength; observe noise-pattern overlay on the fcurve.
  Edit `phase`, `depth`, `strength`, `offset`; verify the noise
  pattern updates.
- [ ] **Limits** — hard min/max clamp. Add; check the 4
  per-side enable flags (`use_min_x`, `use_max_x`, `use_min_y`,
  `use_max_y`). Toggle each + set values; verify fcurve clamping
  in time axis (X) and value axis (Y).
- [ ] **Stepped** — quantize fcurve into steps. Add; set `step_size`
  + `offset`. Verify fcurve renders as a staircase.

### 3.C.2 — Common operations on the modifier stack

Pick any modifier card to operate on for these:

- [ ] **Mute toggle** in the card header — click; the modifier's
  contribution disappears from the rendered fcurve (but the card
  stays visible, just greyed). Click again — re-enables.
- [ ] **Remove button** in the card header — click; the modifier
  card disappears + the fcurve re-renders without that modifier's
  contribution.
- [ ] **Reorder Up / Down buttons** — add 2+ modifiers; click Up/
  Down on a middle one; observe the visual order in the stack
  changes + the fcurve recomputes (modifier-stack order matters
  for many combinations — e.g. noise-then-limits clips the noise,
  limits-then-noise lets the noise bleed past the clamp).
- [ ] **Collapse / expand card** — click the card header (not
  the type label / mute / remove / reorder buttons); the body
  collapses + the disclosure-triangle rotates. Click again —
  expands.

### 3.C.3 — Per-modifier inline editor controls

- [ ] **NumberInput controls** — drag the label to scrub the
  value; click into the input + type a new value + Enter to
  commit. Esc to cancel.
- [ ] **Select / dropdown** controls — for `mode` (Generator),
  `before_mode` / `after_mode` (Cycles), etc. — open + pick an
  option; verify the editor re-renders accordingly.
- [ ] **Checkbox** controls — for `use_additive`, `use_min_x`,
  etc.; click; verify boolean toggle persists across editor close +
  reopen.

### 3.C.4 — Persistence

- [ ] Add a modifier of each type to different fcurves; save the
  project (`Ctrl+S`); close + reopen; verify all 6 modifier types
  + their settings persist correctly.
- [ ] Undo/redo via `Ctrl+Z` / `Ctrl+Shift+Z` correctly walks
  through every add/edit/remove operation on the modifier stack.

---

## Phase 4 — NLA stack end-to-end scenarios (Slice 4.G)

**Goal.** Three authored-by-hand scenarios that exercise the full
NLA stack end-to-end + one round-trip parity check with Cubism
Viewer.

### 4.G.1 — "Idle + breath" stacked → walk → talk-while-walking

The compositional sweet spot: 3 actions on 3 tracks, each
contributing to a different parameter subset; user authors by
dragging strips around the timeline.

1. Author 3 Actions on a Shelby Object:
   - `Idle` — baseline body sway (sinusoidal `BodyAngleY` keys)
   - `Breath` — `ParamBreath` keys at ~5s cycle
   - `Walk` — `BodyAngleX` + `BodyAngleZ` legs-style sway
2. Open the NLAEditor on Shelby.
3. Click `+ Track` 3× to create 3 empty tracks (bottom→top: Idle,
   Breath, Walk).
4. Per track, click `+ Strip` → pick the matching Action.
5. Set bottom strip (Idle) blend `replace`, middle (Breath) blend
   `add` + influence ~0.5, top (Walk) blend `add` + influence ~0.7.
- [ ] **Visual check** — scrub the timeline; Shelby's body should
  sway (Idle) + breathe (Breath added on top) + walk (Walk
  legs/body added on top). All 3 effects should overlay smoothly
  without occluding each other.
6. Add a `Talk` Action (`ParamMouthOpenY` keys). Add a 4th track
   at the top with strip blend `add`, influence 1.
- [ ] **Visual check** — Shelby still walks/breathes/sways AND
  mouth-talks; all 4 layers coexist.

### 4.G.2 — Two characters with shared "Blink" Action

Two Object nodes (Shelby + a second character, e.g. another PSD
load OR a duplicated rig) each carrying their OWN animData but
SHARING a single project-level Action.

1. Load a second character (or duplicate Shelby's rig).
2. Author a `Blink` Action targeting `ParamEyeLOpen` (0→1→0 over
   200ms).
3. In NLAEditor, both characters should appear as separate Group
   headers (one per Object).
4. Add a track + strip for the `Blink` Action on EACH character.
- [ ] **Visual check** — scrub; both characters blink in sync (they
  share the same Action so their fcurve sampling is identical).
- [ ] Open the Actions panel; verify the `Blink` Action's "Used by"
  surface lists BOTH character names.
- [ ] Delete the `Blink` Action via the Actions panel → confirm.
  Both characters' NLA strips should now show "(missing action)"
  or similar (Slice 4.D NlaContextMenu surfaces this).

### 4.G.3 — Tweak push → edit blink frequency → accept

Tweak-mode workflow: take an existing NLA strip, "tweak" into it,
edit its underlying Action in the Action editor, then exit tweak
mode + verify the NLA underlay reflects the change.

1. Continuing from 4.G.2: right-click the Blink strip on one
   character → "Tweak" (or use the strip-context menu).
2. The NLAEditor should mark the group with the yellow "TWEAK"
   badge + the "Exit Tweak" button should appear in the
   GroupHeader.
3. Switch to the Action editor; the active Action is now the
   Blink Action (tweak action == that strip's action).
4. Edit the Blink Action's `ParamEyeLOpen` fcurve: shift the
   close-keyframe earlier so the blink is faster.
- [ ] **Visual check** — the OTHER character's NLA blink (which
  shares the same Action) should ALSO get faster, because both
  strips reference the same Action.
5. Return to the NLAEditor; click "Exit Tweak" in the GroupHeader.
6. The yellow "TWEAK" badge clears; the strip's bounds re-sync via
   SYNC_LENGTH.
- [ ] **Visual check** — both characters still blink at the new
  (faster) speed; the post-exit strip bounds reflect the new
  Action duration.

### 4.G.4 — Bake NLA → motion3.json round-trip vs Cubism

The exporter parity check: bake the NLA stack into a single
ground-truth Action, export motion3.json, load in Cubism Viewer,
compare against a hand-authored equivalent.

1. Continuing from 4.G.1 (Idle + Breath + Walk + Talk stacked):
   - Click the **Bake** button (Combine icon, emerald) on Shelby's
     group header in the NLAEditor.
   - Wait for the bake to complete (logged via Logs panel as
     `bakeNla: ...` info).
- [ ] **Result check** — Shelby's `animData.actionId` should now
  point at a NEW action named "Baked Action" (or "Baked
  Action.001" on second bake).
- [ ] The NLAEditor still shows the 4 original tracks, but the
  bound action above the stack is now the baked one.
2. Open the Actions panel; the new "Baked Action" should be listed
   with `meta.source: 'baked'`.
3. Verify the baked action's fcurves include one per touched
   rnaPath (e.g. `BodyAngleX`, `BodyAngleY`, `BodyAngleZ`,
   `ParamBreath`, `ParamMouthOpenY`).
4. Export motion3.json from the export modal targeting the baked
   action.
5. Load the exported motion3.json in Cubism Viewer alongside the
   `.moc3` from the same project.
- [ ] **Visual parity check** — Shelby in Cubism Viewer should
  play the same composed animation as the SS NLAEditor scrub did
  pre-bake.
6. As a control: hand-author an equivalent flat Action in SS (just
   the composed motion as a single Action's fcurves), export it,
   load in Cubism Viewer.
- [ ] The baked Action's playback should be visually
  indistinguishable from the hand-authored equivalent.

---

## Reporting back

For each item:
- ☑ **Pass** — note nothing.
- ✗ **Fail** — describe what you saw vs expected, attach a 2-3s
  screen recording or screenshot if behavioral, include the Logs
  panel output if anything logged.
- ⚠ **Partial / unclear** — same as Fail but flagged for spec
  clarification rather than as a bug.

Failures become tracked entries:
- Phase 3 failures → reopen Slice 3.C (or new 3.D-3.X audit-fix
  slice as scoped).
- Phase 4 failures → re-open Slice 4.D / 4.E / 4.G as scoped.

Once all checkboxes here are `[x]`, Phase 3 + Phase 4 are USER-
SIDE-VERIFIED-CLOSED. The exit-gate doc
(`docs/plans/ANIMATION_BLENDER_PARITY_PLAN.md` §4.G) can be marked
SHIPPED at that point.
