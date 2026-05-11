# Phase 7.C Blender-Fidelity Audit (2026-05-11)

Reviewed commit `fbf7f82` — Phase 7.C Pose Mode tools (Clear
Transforms / Select Mirror / Mirror Paste / Copy-Paste). Verified
against `reference/blender/` source files. All cited line numbers were
opened and checked.

## Summary

9 gaps found: **2 HIGH**, **4 MEDIUM**, **3 LOW.**

| ID  | Sev | One-line | Action |
|-----|-----|----------|--------|
| D-1 | HIGH | `Alt+Shift+KeyG/R/S` entries use wrong modifier order — builder emits `Shift+Alt+Key*`; the three clear-all bindings never fire | FIX (same as G-1) |
| D-2 | HIGH | `POSE_OT_clear_user_transform` (cited `:1163-1191`) does not exist; the real `POSE_OT_user_transforms_clear` restores to keyframed state, not identity zeros; SS semantics match `POSE_OT_transforms_clear` applied to all bones | FIX (cite + rename) |
| D-3 | MED  | `POSE_OT_loc_clear` / `rot_clear` / `scale_clear` cited at `:1129` / `:1138` / `:1147` — those lines are inside `pchan_clear_rot`'s lock-handling body; actual registrations at `:1404` / `:1377` / `:1350` | FIX (cite) |
| D-4 | MED  | `POSE_OT_select_mirror` exec cited at `pose_select.cc:1011-1078`, registration at `:1080-1132` — those ranges are `pose_select_same_collection`; actual exec at `:1392`, registration at `:1470` | FIX (cite) |
| D-5 | MED  | `flip_pose_data` cited at `pose_transform.cc:660-803` does not exist; the X-flip is inlined in `pose_bone_do_paste` (same lines); SS invented a function name that has no Blender counterpart | FIX (cite) |
| D-6 | MED  | `POSE_OT_paste` exec cited at `:805-859`, RNA `flipped` flag at `:899` — exec actually starts at `:861`, `flipped` flag at `:1032` | FIX (cite) |
| D-7 | LOW  | `poseClipboardStore.js` claims clipboard storage is at `view3d_buttons.cc:2018+`; that line is quaternion lock UI panel code; Blender's clipboard is a temp `.blend` file on disk | FIX (cite) |
| D-8 | LOW  | `poseSelectMirror` always adds to selection (`extend=true` equivalent); Blender's default `POSE_OT_select_mirror` call (no properties) swaps selection (`extend=false`); not documented as deviation | DOCUMENT-AS-DEVIATION |
| D-9 | LOW  | `BLI_string_flip_side_name` cited at `string_utils.cc:243-413`; function starts at `:297` (line 243 is `is_char_sep`, a file-local helper) | FIX (cite) |

---

## HIGH

### D-1: `Alt+Shift+KeyG/R/S` entries use wrong modifier order — clear-all bindings never fire

**File:** `src/v3/keymap/default.js:329-331`

**Severity:** HIGH — the three "clear all bones" operators
(`pose.clearAllLocation`, `pose.clearAllRotation`, `pose.clearAllScale`)
have dead bindings in the default keymap. The chord builder in the same
file (`chordOf`, line 350-357) emits modifiers in `Ctrl+Shift+Alt+Meta+`
order. Pressing `Alt+Shift+G` yields `shiftKey` first then `altKey`,
producing `Shift+Alt+KeyG`. The table entry is `'Alt+Shift+KeyG'` — no
match, the operator never fires from keyboard.

**Blender ref:** Not applicable — these operators have no Blender
keymap equivalent (see D-2). The bug is purely in SS's own chord-table
ordering.

**Fix:** Same as G-1. Change to `Shift+Alt+Key*`.

---

### D-2: `POSE_OT_clear_user_transform` cited as the "clear all" reference operator — operator does not exist; the real `POSE_OT_user_transforms_clear` does something completely different

**File:** `src/v3/operators/pose/clearTransform.js:33-35` (module doc)

**Severity:** HIGH — the `clearAllPose` function (lines 219-230) zeros
`pose.{rotation,x,y,scaleX,scaleY}` on every bone in the project. The
module doc says this "Matches Blender's `POSE_OT_clear_user_transform`
(`pose_transform.cc:1163-1191`)". Two facts are wrong:

1. **Operator name**: The operator is `POSE_OT_user_transforms_clear`
   (not `POSE_OT_clear_user_transform` — the words are reordered).
   `POSE_OT_clear_user_transform` does not exist in Blender's source.

2. **Semantics**: `POSE_OT_user_transforms_clear` does NOT zero channels
   to identity. Per `pose_clear_user_transforms_exec` (`:1453-1515`):
   - If the armature has an action: re-evaluates the animation at the
     current frame using a dummy pose copy, then pastes those
     (keyframed) values back, effectively resetting to the
     **keyframed state**.
   - If no action: calls `BKE_pose_rest(*ob, only_select)` — resets to
     the **rest pose**.
   It is essentially "undo manual pose edits" — not "zero all channels".

3. **Cited lines**: `pose_transform.cc:1163-1191` falls inside
   `pchan_clear_rot`'s per-axis lock-clamping code (the Euler branch
   inside the `else` of the OB_LOCK_ROT4D block). There is no
   operator boundary there.

**The closest Blender analogue for SS's actual behavior**: The
function `pchan_clear_transforms` at `:1252-1257` clears loc + rot +
scale of selected bones, called by `POSE_OT_transforms_clear` at
`:1431`. SS's `clearAllPose` applies the same zero-to-identity logic
but to all bones unconditionally (ignoring selection) — an SS-specific
extension with no direct Blender counterpart.

**Blender ref:**
- `pose_transform.cc:1453` — `pose_clear_user_transforms_exec` (actual "clear user transforms")
- `pose_transform.cc:1517` — `POSE_OT_user_transforms_clear` (registration)
- `pose_transform.cc:1252` — `pchan_clear_transforms` (the actual zero-to-identity helper)
- `pose_transform.cc:1431` — `POSE_OT_transforms_clear` (selection-scoped zero)

**Fix:** Update the module doc to:
1. Remove the incorrect `POSE_OT_clear_user_transform` reference.
2. State that `clearAllPose` has no direct Blender equivalent; the
   closest analogues are `POSE_OT_transforms_clear`
   (`pose_transform.cc:1431`) for selected-only clearing and
   `POSE_OT_user_transforms_clear` (`pose_transform.cc:1517`) for
   keyframe-restore (which is semantically different).
3. Document the "clear all bones regardless of selection" as an
   SS-specific extension.

---

## MEDIUM

### D-3: `POSE_OT_loc_clear` / `rot_clear` / `scale_clear` operator cites point into `pchan_clear_rot` lock-handling code

**File:** `src/v3/operators/pose/clearTransform.js:9-17` (module doc)

**Severity:** MEDIUM — a developer following the cites to verify the
operator behavior lands inside `pchan_clear_rot`'s Euler-lock clamping
block, not at any operator boundary.

**Actual registration locations:**
- `POSE_OT_scale_clear`: `:1350`
- `POSE_OT_rot_clear`: `:1377`
- `POSE_OT_loc_clear`: `:1404`

All three delegate through `pose_clear_transform_generic_exec` at `:1262`
which iterates selected bones.

**Fix:** Update module doc lines 9-17 with the correct cites + add
a note about the generic dispatcher.

---

### D-4: `POSE_OT_select_mirror` exec + registration cites point at `pose_select_same_collection`

**File:** `src/v3/operators/pose/mirror.js:10-16` (module doc)

**Severity:** MEDIUM — the cited range `:1080-1132` (exec at `:1011-1078`)
is `pose_select_same_collection`, a completely unrelated function.

**Actual locations:**
- `pose_select_mirror_exec`: `:1392`
- `POSE_OT_select_mirror` (registration): `:1470`

**Fix:** Update module doc to point at `:1392` / `:1470`.

---

### D-5: `flip_pose_data` cited at `pose_transform.cc:660-803` — function does not exist; those lines are `pose_bone_do_paste`

**File:** `src/v3/operators/pose/mirror.js:30-34` (module doc)

**Severity:** MEDIUM — a function named `flip_pose_data` does not appear
anywhere in the Blender source tree. SS's module doc attributes the
X-flip algorithm to it. The flip logic is inlined inside
`pose_bone_do_paste` at `:720-750` (within a `if (flip) { … }` block
inside the function that spans `:625-777`).

**SS's `flipPoseX`** negates `pose.x` and `pose.rotation` (which maps
to the Z-Euler for a 2D rig). In 3D Blender negates both Y and Z
Euler — Y is out-of-plane for 2D and irrelevant. So the rotation
component of `flipPoseX` is correct for the 2D case (Z-Euler only).
The algorithm divergence is a documented and correct 2D narrowing;
only the cite is wrong.

**Fix:** Update module doc to point at `pose_bone_do_paste` at
`:625-777` with flip block at `:720-750`, and note no standalone
`flip_pose_data` function exists.

---

### D-6: `POSE_OT_paste` exec and RNA `flipped` flag are cited at wrong lines

**File:** `src/v3/operators/pose/mirror.js:18-20` (module doc)

**Severity:** MEDIUM — two cites are both wrong.

**Actual locations:**
- `pose_paste_exec` starts at `:861`
- `POSE_OT_paste` registration at `:1015`
- RNA `flipped` boolean defined at `:1032`

**Fix:** Update module doc cite to `:1015` registration, exec at
`:861`, `flipped` flag at `:1032`.

---

## LOW

### D-7: `poseClipboardStore.js` clipboard-storage cite is wrong — `view3d_buttons.cc:2018+` is the quaternion lock UI panel

**File:** `src/store/poseClipboardStore.js:29-31` (module doc)

**Severity:** LOW — the cite misleads a developer looking for where
Blender stores clipboard data.

**Blender's actual clipboard mechanism** (`pose_transform.cc:785-838`):
`pose_copy_exec` writes a partial `.blend` file to a temp path obtained
via `pose_copybuffer_filepath_get`, including the selected bones' pose
data. `pose_paste_exec` reads that file via `BKE_copybuffer_read`. The
clipboard is a **file on disk**, not an in-memory store.

SS's in-memory approach is a deliberate and correct deviation (no need
for file I/O in a web app). The doc already explains the in-memory
rationale correctly; only the Blender cite is wrong.

**Fix:** Replace the `view3d_buttons.cc:2018+` cite with a description
of the actual mechanism (`.blend` file on disk via `pose_copy_exec` at
`pose_transform.cc:785`).

---

### D-8 (DOCUMENT-AS-DEVIATION): `poseSelectMirror` always extends selection; Blender's default chord swaps selection

**File:** `src/v3/operators/pose/mirror.js:135-170` (`poseSelectMirror`)

**Severity:** LOW — Blender's `POSE_OT_select_mirror` called without
properties uses `extend=false` (the RNA default at `pose_select.cc:1486`).
With `extend=false` the operator passes `bone_selection_flags_set` to
each bone — it REPLACES each bone's selection state with its mirror's
selection state, effectively swapping which side is selected.

SS's `poseSelectMirror` calls `selStore.select(toAdd, 'add')` — it
always adds the mirror partners without clearing the originals. This
matches Blender's `extend=true` behavior.

For symmetrical rigs the practical difference is minimal (both sides
end up selected either way). For asymmetrical selection patterns
(selecting a subset of left-side bones) the Blender default would
transfer selection to the right side and deselect left; SS leaves both
sides selected.

**Resolution:** DOCUMENT-AS-DEVIATION. The "additive by default"
behavior matches SS's broader selection UX (Phase 7.A boxSelect adds
by default, not replaces). The Blender swap-by-default behavior is
only intuitive when paired with an active-bone affordance, which SS
doesn't surface.

---

### D-9: `BLI_string_flip_side_name` cited at `string_utils.cc:243-413` — function starts at `:297`

**File:** `src/v3/operators/pose/mirror.js:75-76` (module doc)

**Severity:** LOW — the range start is off by 54 lines. Line 243 is
`is_char_sep`, a `static bool` helper used internally by
`BLI_string_flip_side_name`.

The public function `BLI_string_flip_side_name` starts at `:297`.

**Note:** This cite was also fixed in Phase 7.B (D-4) for the weight
paint mirror module. The pose mirror module carries the same wrong
start line.

**Fix:** Update mirror.js module doc cite to `string_utils.cc:297-413`.

---

## Source citation table (verified)

| Citation in Phase 7.C | Actual Blender source | Verdict |
|---|---|---|
| `pose_transform.cc:1129` = `POSE_OT_loc_clear` | inside axis-angle branch of `pchan_clear_rot` | WRONG — see D-3 |
| `pose_transform.cc:1138` = `POSE_OT_rot_clear` | closing `}` then quat-branch start inside `pchan_clear_rot` | WRONG — see D-3 |
| `pose_transform.cc:1147` = `POSE_OT_scale_clear` | `pchan->quat[2] = 0.0f` inside `pchan_clear_rot` quat branch | WRONG — see D-3 |
| `pose_transform.cc:1085-1127` = exec body for loc_clear | `pchan_clear_loc` helper (correct body, wrong framing — generic exec is at `:1262`) | PARTIALLY CORRECT |
| `pose_transform.cc:1163-1191` = `POSE_OT_clear_user_transform` | inside `pchan_clear_rot` Euler-lock; operator name also wrong | WRONG — see D-2 |
| `pose_select.cc:1080-1132` = `POSE_OT_select_mirror` registration | `pose_select_same_collection` | WRONG — see D-4 |
| `pose_select.cc:1011-1078` = `pose_select_mirror_exec` | `pose_select_same_color` | WRONG — see D-4 |
| `pose_transform.cc:660-803` = `flip_pose_data` | body of `pose_bone_do_paste` (no `flip_pose_data` function exists) | WRONG — see D-5 |
| `pose_transform.cc:805-859` = `pose_paste_exec` | inside `pose_copy_exec`; paste exec at `:861` | WRONG — see D-6 |
| `pose_transform.cc:899` = `flipped` RNA flag | inside paste exec body; actual at `:1032` | WRONG — see D-6 |
| `view3d_buttons.cc:2018+` = pose clipboard storage | quaternion UI panel code | WRONG — see D-7 |
| `blender_default.py:~4654` = `Ctrl+C` for `pose.copy` | correct | CORRECT |
| `blender_default.py:~4657` = `Ctrl+Shift+V` for paste-flipped | correct | CORRECT |
| `blender_default.py:~4672` = `Ctrl+Shift+M` for `pose.select_mirror` | correct | CORRECT |
| `blender_default.py:~4649-4651` = `Alt+G/R/S` for loc/rot/scale clear | correct | CORRECT |
| `string_utils.cc:243-413` = `BLI_string_flip_side_name` | function at `:297` | WRONG — see D-9 |
