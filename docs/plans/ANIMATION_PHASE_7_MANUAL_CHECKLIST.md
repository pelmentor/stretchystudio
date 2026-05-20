# Phase 7 — Manual Verification Checklist

**Owner:** user (single end-to-end sweep)
**Scope:** Phase 7 Slices 7.A → 7.E (Keying Set registry, Insert
Keyframe kernel, I-key menu, Auto-key mode parity, K-key first-use
toast). 7.F (this checklist + coverage audit + exit-gate banner) is
the Phase 7 exit gate; this doc is its user-facing half.
**Purpose:** Consolidate the manual-verification items deferred
during each 7.A → 7.E ship (`feedback_no_background` — no autonomous
dev-server start) into a single sweep the user can execute
end-to-end. All five substrate slices have automated tests (370
asserts across 5 scripts — see §0 and `ANIMATION_PHASE_7_COVERAGE_AUDIT.md`);
the items below are end-user-visible behaviors that automated tests
can't cover (real DOM keymap routing, real toast emission, real
dropdown click-through, real auto-key dispatch on bone/gizmo/canvas
drag-end).

**Estimated time:** 20–30 minutes (1 dev-server start, 1 test action
with mixed-type fcurves, no PSD re-import — Shelby's existing project
state suffices for every item per `feedback_test_character_is_shelby`).

---

## §0 — Tests already passing (automated; informational)

Run before starting the manual sweep to confirm clean baseline:

```
npm run test:keyingSets          # 7.A — 144 asserts
npm run test:insertKeyframe      # 7.B —  87 asserts
npm run test:keyingSetMenu       # 7.C —  69 asserts
npm run test:autoKeyDispatch     # 7.D —  48 asserts
npm run test:kKeyFirstUseToast   # 7.E —  22 asserts
```

All wired into the master `npm test` chain at `package.json:328` as
of 7.F.

For the deeper subsumption claim ("plan §7.F's 5 prescribed test
files are subsumed by the 5 above"), see
`ANIMATION_PHASE_7_COVERAGE_AUDIT.md`.

---

## Setup

```
npm run dev
```

Open in browser. Load Shelby project (the test character per
`feedback_test_character_is_shelby`). If no project loaded, import
Shelby PSD via the wizard once — subsequent items reuse the same
project state.

Switch to the **Animation** workspace. Ensure at least one object is
in the scene and has an Action assigned (any non-trivial action
works — most items below need only a selection + a current time on
the playhead).

Open browser DevTools (`F12`) — some items below ask you to inspect
console output (DEV warnings, dispatched events).

---

## §1 — Slice 7.A: Keying-set registry surfaces (via I-menu)

Built-in keying sets are not directly user-visible; they surface
through the I-menu (§3). Item below verifies the registry side-effect
on the menu list ordering.

### §1.1 — Built-in set ordering in I-menu

- [ ] In Animation mode with a part selected, press **I**. The menu
  opens with the heading "Insert Keyframe" at the top.
- [ ] Verify the entries appear in this exact order: **Available**,
  **Location**, **Rotation**, **Scale**, **LocRotScale**,
  **BlendShape**, **AllParams**. (Matches Blender canonical menu
  order from `keyingsets_builtins.py:647-670`.)
- [ ] **DEV 20** sanity: the 4th entry's *label* reads "Scale" but
  its *internal id* is "Scaling" — verified by the autotests; not
  user-visible.

### §1.2 — User-defined sets appear after built-ins

If you have created any custom keying sets via developer console (`addKeyingSet(project, { id: 'MyCustom', paths: [...] })`):

- [ ] Re-open the I-menu. Verify your custom set appears AFTER the 7
  built-ins, with a "USER" badge on the right.
- [ ] If no custom sets exist, this item is N/A.

---

## §2 — Slice 7.B: Insert Keyframe kernel (via I-menu happy path)

The kernel is exercised every time you pick an entry from the I-menu.
Items below verify the visible effect of each flag-equivalent path.

### §2.1 — Pick a built-in set → keyforms appear

- [ ] Select a part with a `transform.x` of e.g. 100. Position the
  playhead at e.g. 500ms.
- [ ] Press **I**, click **Location**. Verify:
  - A toast appears (typically "Inserted N keys via Location" or
    similar status text).
  - In the Dopesheet, **two new ticks** appear on the part's row at
    time = 500ms (one each for `transform.x` and `transform.y`).
  - The ticks render at the part's current values (not zeros).

### §2.2 — Same time = replace (no duplicate ticks)

- [ ] Move the part slightly (so `transform.x` differs from §2.1's
  value). DO NOT move the playhead.
- [ ] Press **I**, pick **Location** again. Verify:
  - The two ticks from §2.1 update to the NEW values (do not stack).
  - Tick count stays the same on the row (still 2, not 4).

### §2.3 — New time = additional ticks

- [ ] Move the playhead to a different time (e.g. 1500ms).
- [ ] Press **I**, pick **Location**. Verify:
  - Two more ticks appear at 1500ms (now 4 ticks total per row).

### §2.4 — Available set requires existing fcurves

- [ ] On a DIFFERENT part that has NO existing keyforms yet, position
  the playhead at any time. Press **I**, pick **Available**. Verify:
  - A toast appears noting "0 keys inserted" or similar (Available
    won't create new fcurves; only adds keys to existing).
  - No new ticks appear in the Dopesheet for that part.
- [ ] On the part from §2.1 (which now has Location fcurves), press
  **I**, pick **Available** at a new time. Verify:
  - Ticks appear ONLY on `transform.x` + `transform.y` (the existing
    fcurves) — none on `transform.rotation` or scale.

### §2.5 — BlendShape set requires mesh part with blendShapeValues

- [ ] Select a mesh part that has blend shapes (Shelby's face usually
  qualifies). Position the playhead. Press **I**, pick **BlendShape**.
- [ ] Verify ticks appear for each blendshape entry; toast counts
  matching.
- [ ] On a part WITHOUT blend shapes, BlendShape → 0 keys inserted.

### §2.6 — AllParams ignores selection (project-wide)

- [ ] With NOTHING selected, press **I**, pick **AllParams**. Verify:
  - Toast reports N keys inserted = number of project parameters.
  - In the Dopesheet, parameter fcurves all get a tick at playhead.

### §2.7 — Empty selection on selection-scoped sets → 0 keys

- [ ] With nothing selected, press **I**, pick **Location**. Verify
  toast reports 0 keys (no objects to iterate).

---

## §3 — Slice 7.C: I-key menu UI

The menu itself (popover semantics, default-highlighted entry,
keyboard navigation).

### §3.1 — Menu opens at cursor

- [ ] In Animation mode, move cursor over the canvas. Press **I**.
  Verify the popover opens **at the cursor position** (not center
  screen or other fixed location).
- [ ] Esc closes the menu without keying anything.
- [ ] Click outside the menu closes it without keying anything.

### §3.2 — Default-highlighted entry per selection

The menu picks a sensible default per `pickDefaultKeyingSet`:

- [ ] Select a **part with no bones**, press I. Verify **LocRotScale**
  is BOLD (default-picked).
- [ ] Select a **bone** group, press I. Verify **Rotation** is BOLD.
- [ ] Switch to BlendShape edit mode (Tab into shape editing if
  applicable), press I. Verify **BlendShape** is BOLD.
- [ ] With multi-selection containing both bones and parts, verify
  the LAST→FIRST walk picks based on the most recently selected
  entry's type (last bone wins → Rotation; last part wins →
  LocRotScale).

### §3.3 — Active-set indicator

If a keying set has been marked active via
`setActiveKeyingSet(project, 'Rotation')` (via dev console for now —
no UI in 7.C):

- [ ] Open the I-menu. Verify the active set has a **bullet dot (•)**
  to the left of its name.
- [ ] Other entries show no bullet.

### §3.4 — Pressing I twice does NOT stack menus

- [ ] Press I. Menu opens.
- [ ] Press I again. Verify only ONE menu remains visible (or the
  second press is no-op — both acceptable; verify no two menus stack).

### §3.5 — Menu suppressed outside Animation mode

- [ ] Switch to **Modeling** or **Layout** workspace. Press I.
- [ ] Verify nothing happens (no menu opens — I is gated to
  Animation workspace per `editorStore.workspace`).

### §3.6 — Menu suppressed in input/textarea

- [ ] Focus the Action name input or a numeric spinner. Press I.
- [ ] Verify the input gets the keystroke (literal "i" appears in
  the field). The menu does NOT open.

---

## §4 — Slice 7.D: Auto-key mode dropdown

Auto-key mode is selectable via dropdown next to the AutoKey toggle
in the playback bar.

### §4.1 — Dropdown UI surface

- [ ] In the Animation workspace, find the **AutoKey** toggle in the
  playback controls. Verify a **chevron** appears flush-right of the
  toggle button.
- [ ] Click the chevron. Verify a dropdown opens with 3 radio
  entries:
  - **AutoKey: All Properties** (default-selected on fresh project)
  - **AutoKey: Active Keying Set**
  - **AutoKey: Available**

### §4.2 — Mode selection is sticky + sparse

- [ ] Pick **AutoKey: Active Keying Set**. Close dropdown.
- [ ] Reopen. Verify the active radio is now "Active Keying Set".
- [ ] Pick **AutoKey: All Properties** (the default). Verify radio
  flips back.
- [ ] Save the project (Ctrl+S). Reload (refresh browser). Re-open
  dropdown.
- [ ] Verify the mode persisted across reload (use the dev console:
  `useProjectStore.getState().project.autoKeyMode` should return
  `undefined` for "all" or the explicit string otherwise — sparse
  storage per Rule №2).

### §4.3 — Mode change does NOT pollute undo stack

- [ ] Pick **AutoKey: Active Keying Set**.
- [ ] Press Ctrl+Z (undo). Verify the undo does NOT roll back the
  auto-key mode (mode changes use `{skipHistory: true}` per
  audit-fix M-3 — Blender stores autokey mode in user prefs, not
  undo stack).

### §4.4 — "All" mode: bone drag keys everything

- [ ] Set mode to **All Properties**. Enable AutoKey toggle. Select
  a bone in Pose mode. Drag-rotate the bone.
- [ ] On drag release, verify in the Dopesheet that new keyforms
  appeared for the bone's pose channels (rotation, plus loc/scale if
  it's a leaf bone).
- [ ] (Behind-the-scenes: the rotation triggers a synthetic K-event
  dispatch through `runAutoKey('all')` → legacy K-key handler. The
  toast from §5 should NOT appear here — see §5.2.)

### §4.5 — "Active Keying Set" mode: only the active set's channels are keyed

- [ ] In the dev console: `setActiveKeyingSet(useProjectStore.getState().project, 'Rotation')`
  (or use the I-menu's set-active flow if/when shipped).
- [ ] Set dropdown mode to **AutoKey: Active Keying Set**. AutoKey
  enabled.
- [ ] Drag-rotate a bone. Verify ONLY `pose.rotation` gets a new tick
  (not location, not scale) — the active set's collector at
  `keyingSets.js:226-250` filters to the set's path list.
- [ ] If no active keying set is set, the mode falls back to
  **LocRotScale** (verified by autotests).

### §4.6 — "Available" mode: only existing fcurves keyed

- [ ] Set dropdown to **AutoKey: Available**. AutoKey enabled.
- [ ] On a bone that has `pose.rotation` keys but NO `pose.x` keys,
  drag-rotate (which changes both rotation AND translation).
- [ ] Verify ONLY the rotation fcurve gets a new tick. The
  translation fcurve is NOT created.

### §4.7 — Mode applies to all 3 drag-end trigger sites

Verify the mode dropdown affects every drag-end site:

- [ ] **SkeletonOverlay bone drag** (drag a bone in Pose mode).
- [ ] **GizmoOverlay handle drag** (drag a gizmo arrow).
- [ ] **Canvas-direct drag** (drag a part by clicking its body and
  moving). All three should respect the selected mode.

### §4.8 — Param-row auto-key (RESOLVED in Slice 7.H `1f89d01`)

Param-slider auto-key now matches Blender's UI-button path
(`button_anim_autokey` → `autokeyframe_property(only_if_property_keyed
=true)`): a slider drag only MAINTAINS an existing fcurve, never
creates one — regardless of the AutoKey mode dropdown (that dropdown
governs only the viewport transform/pose path).

- [ ] Turn **AutoKey ON** (any mode). In the Parameters panel, drag a
  slider for a param that has NO existing fcurve. Verify **no new
  fcurve is created** (the live value still updates for immediate
  feedback; it just isn't keyed).
- [ ] Insert the first keyframe explicitly: press **I** → choose
  **All Parameters** keying set (or otherwise create a param fcurve).
- [ ] With that fcurve now existing and AutoKey still ON, drag the
  same slider. Verify the existing fcurve gets a keyform updated/added
  at the playhead (auto-key now maintains it).
- [ ] Confirm the undo stack is not spammed while dragging an UNKEYED
  param (no `updateProject` snapshot fires when there's no fcurve).

---

## §5 — Slice 7.E: K-key first-use toast + `__ssAutoKey` sentinel

The toast educates users about the new I-menu on their first manual
K-press; auto-key triggered K-events skip the toast.

### §5.1 — First K-press shows toast (once)

- [ ] In the dev console, clear the pref to simulate fresh user:
  `localStorage.removeItem('v3.prefs.kKeyFirstUseShown'); usePreferencesStore.setState({kKeyFirstUseShown: false})`
- [ ] In Animation mode with a part selected, press **K**.
- [ ] Verify a toast appears with title **"K — Insert all properties"**
  and description **"Press I to pick a specific keying set
  (Location / Rotation / All Parameters / …)."**
- [ ] Verify the K-press also inserts keyframes (the toast does not
  block the recipe — toast emits AFTER the guards pass and BEFORE
  the recipe runs).
- [ ] Press **K** again. Verify the toast does NOT appear a second
  time (pref now true, persisted to localStorage).

### §5.2 — Auto-key drag does NOT show toast

- [ ] Clear the pref again (per §5.1 setup).
- [ ] Enable AutoKey. Set mode to **All Properties**.
- [ ] Drag-rotate a bone (triggers `runAutoKey('all')` → synthetic
  K-event with `__ssAutoKey: true` expando).
- [ ] Verify the toast does NOT appear (sentinel skip in the K-key
  handler at `CanvasViewport.jsx:1527`).
- [ ] Verify the keyframes still get written (auto-key recipe ran
  successfully).

### §5.3 — Pref persists across reload

- [ ] After §5.1 has shown the toast once and set the pref:
- [ ] Reload the browser. Press **K** with a selection.
- [ ] Verify the toast does NOT reappear (pref loaded from
  localStorage at `v3.prefs.kKeyFirstUseShown`).

### §5.4 — Toast suppressed outside Animation mode

- [ ] Clear the pref.
- [ ] Switch to **Modeling** workspace. Press **K**.
- [ ] Verify NOTHING happens (no toast, no keyframes — guards in
  `CanvasViewport.jsx:1457-1500` block K outside Animation mode).
- [ ] Switch back to Animation. Press **K** with selection. Now the
  toast appears (the guards from above let it through).

### §5.5 — Toast suppressed in input/textarea

- [ ] Clear the pref.
- [ ] Focus the Action name input. Type "k". Verify "k" appears in
  the input and NO toast fires.

### §5.6 — Description references real Blender built-in labels

The toast description names three real built-ins (Location / Rotation
/ All Parameters). Verify this is not a placeholder:

- [ ] On the toast: "Location" matches the I-menu entry **Location**.
- [ ] "Rotation" matches I-menu entry **Rotation**.
- [ ] "All Parameters" — note this is the **friendly** label for the
  `AllParams` id. The I-menu likely shows it as "AllParams"; this is
  a minor naming inconsistency that can be cleaned up in a polish
  slice (audit-fix MED-1 mapped to "All Parameters" string in the
  description; the I-menu label is "AllParams" per current registry).

---

## §6 — Cross-slice gate semantics

All Phase 7 keybindings share the same gate pattern: input/textarea
skip + animation-mode gate + selection-requirement guard. Verify
once for I, K (the two new bindings):

### §6.1 — Input/textarea skip

- [ ] Focus a text input. Press **I** then **K**. Verify both
  characters appear in the input, no menu opens, no toast appears.

### §6.2 — Animation-mode gate

- [ ] Switch to **Modeling** workspace. Press **I** and **K**.
- [ ] Verify neither does anything (no menu, no toast).

### §6.3 — Selection-required for I-menu happy paths

- [ ] With NO selection, press **I**. Menu still opens (registry is
  selection-independent for the listing).
- [ ] Pick a selection-scoped set (e.g. **Location**). Verify the
  toast reports "0 keys inserted" (empty selection → empty
  collection).
- [ ] Pick **AllParams**. Verify it works (project-wide, no
  selection needed).

---

## §7 — Sign-off

- [ ] All §1 — §6 items pass on **Shelby**.
- [ ] (Optional, per `feedback_test_character_is_shelby` dual-PSD
  convention) repeat key items on **test_image4**.

When all items pass, file a note in the next session message saying
**"Phase 7 manual checklist green"** — at that point 7.F is fully
complete and **Phase 7 ships SHIP-COMPLETE 6/6**.

If any item fails: write down the failing item number, repro steps,
and any console output, then report. Failed items become post-7.F
polish slices (7.G+), not 7.F blockers — the substrate-tested
behavior is independently green per §0.

---

## Known gaps (intentional, deferred)

- **K-rebind preference** (plan §7.E option (b)): not implemented
  in 7.E (MVP scope decision). Requires extracting the 170-line
  legacy K-key fan-out into a pure helper. Tracked as a §7.F+ polish
  slice.
- ~~**Param-row auto-key gap** (§4.8)~~ — RESOLVED in Slice 7.H
  (`1f89d01`). Param-slider auto-key now ports Blender's UI-button
  path (only-if-keyed; never creates a fcurve; scoped to the touched
  param). The premise of the original gap (route through `runAutoKey`)
  was wrong — Blender keeps single-property UI edits OFF the
  selection/keying-set path. See plan §7.H. `PHASE-7-GAP` comment
  removed.
- **`pickActiveSetIdForAutoKey` fallback chain** (audit-noted, not
  blocking): when `activeKeyingSetId` is stale, fallback is
  hardcoded to `LocRotScale` (not the user-pref keying mode like
  Blender). Documented in `autoKeyDispatch.js` module header.
- ~~**Set-active UI**~~ — RESOLVED in Slice 7.I (`dcb7c37`). The
  I-menu's per-row indicator is now an interactive ●/○ toggle: click
  the dot to set (or clear) the active keying set without dev-console
  writes. The menu stays open so you can see the indicator flip and
  still insert. Manual check: open the I-menu, click a row's ○ → it
  fills (●) and a toast confirms; the AutoKey "Active Set" mode then
  keys that set on drag. Click the ● again → clears.
- ~~**Toast description label drift**~~ — NON-ISSUE on re-inspection
  (2026-05-20, during §7.I). The premise was stale: `KeyingSetMenu`
  renders `{set.label ?? set.id}` and the apply toast
  (`insertKey.js` `execApplyKeyingSet`) uses `set.label ?? set.id` —
  both surface the human label **"All Parameters"** for the AllParams
  built-in. The raw id `"AllParams"` is never user-facing, so there is
  no drift to reconcile. No code change needed.
