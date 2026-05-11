# Toolset Phase 7.C — Pose Mode tools — PROGRESS

Status: **SHIPPED 2026-05-11** (initial `fbf7f82` + audit-fix `25b04f3`).
Owner: pelmentor.
Plan: [TOOLSET_BLENDER_PARITY_PLAN.md §7.C](./TOOLSET_BLENDER_PARITY_PLAN.md).

## What shipped (initial)

Ten user-facing operators per plan §7.C.1-6, mode-gated to Pose Mode
via the operator registry's `available()` callback:

| # | Tool | Chord | Implementation |
|---|------|-------|----------------|
| 7.C.1 | Clear Pose Location | `Alt+G` | `pose.clearLocation` → `clearPoseLocation` in `src/v3/operators/pose/clearTransform.js` |
| 7.C.2 | Clear Pose Rotation | `Alt+R` | `pose.clearRotation` → `clearPoseRotation` |
| 7.C.3 | Clear Pose Scale | `Alt+S` | `pose.clearScale` → `clearPoseScale` |
| 7.C.4a | Clear All Pose Locations | `Shift+Alt+G` (audit-fix G-1/D-1) | `pose.clearAllLocation` → `clearAllPose('location')` |
| 7.C.4b | Clear All Pose Rotations | `Shift+Alt+R` (audit-fix G-1/D-1) | `pose.clearAllRotation` → `clearAllPose('rotation')` |
| 7.C.4c | Clear All Pose Scales | `Shift+Alt+S` (audit-fix G-1/D-1) | `pose.clearAllScale` → `clearAllPose('scale')` |
| 7.C.5a | Select Mirror | `Ctrl+Shift+M` | `pose.selectMirror` → `poseSelectMirror` in `src/v3/operators/pose/mirror.js` |
| 7.C.5b | Mirror Pose | `Ctrl+Shift+V` | `pose.mirrorPose` → `poseMirrorPaste` |
| 7.C.6a | Copy Pose | `Ctrl+C` (Pose Mode only) | `pose.copy` → `poseCopy` |
| 7.C.6b | Paste Pose | `Ctrl+V` (Pose Mode only) | `pose.paste` → `posePaste` |

## No schema bump

Phase 7.C uses the existing `node.pose` shape from schema v17 (flat
`{rotation, x, y, scaleX, scaleY}` per bone-group). The clipboard is
in-memory only via the new `poseClipboardStore` — Blender's pose
clipboard is also runtime-only, and keeping it ephemeral avoids a
schema migration for Rule №2 compliance.

## New store

`src/store/poseClipboardStore.js` — tiny zustand store. Two slots:

- `entries: Array<{role: string, pose: PoseDelta}>` — ordered list of
  copied bones keyed by `boneRole` (so cross-skeleton paste works
  whenever roles match).
- `timestamp: number | null` — ms-since-epoch; available for future
  "X seconds ago" tooltips on a Pose Library affordance.

Methods: `setEntries(entries)`, `clear()`.

## Mirror semantics (X axis only — 2D rig, no Y/Z)

Per plan §7.C.5:
- `pose.x` → `-pose.x`
- `pose.rotation` → `-pose.rotation`
- `pose.scaleX` / `pose.scaleY` unchanged
- `pose.y` unchanged (X-axis flip)

Implemented in `flipPoseX(pose)` — pure function, returns fresh object.

## Role-based partner detection (audit-narrowed)

Per plan §7.C.5 audit-narrowing: `left*` / `right*` camelCase prefix
only. Implemented as `mirrorRole(role)`. Matches 100% of current SS
auto-rig roles per `src/io/armatureOrganizer.js:494-545`:

- `leftElbow ↔ rightElbow`
- `leftArm ↔ rightArm`
- `leftLeg ↔ rightLeg`
- `leftKnee ↔ rightKnee`

Roles without camelCase mirror prefix (`torso`, `head`, `root`, `neck`,
`eyes`, `bothArms`, `bothLegs`) return `null`. If a bone has no
mirror partner, the operator surfaces a toast naming the role.

The existing `flipSideName(name)` 3-pass detector ported in Phase 7.B's
weight-paint `mirror.js` (D-4 fix) for `arm.L`/`L_arm`/`LEFT_eye`-style
names is NOT used here — bone-name authoring UX doesn't exist yet, so
all real-world bone names go through the camelCase pipeline. A follow-up
plan can swap to `flipSideName` once manual bone-naming lands.

## Editor / dispatcher integration

- All 10 operators use eager-import discipline (Phase 7.A G-1 lesson —
  async exec leaks unhandled rejections through dispatcher's non-await
  `op.exec(...)`). Imports at top of `registry.js`:
  `import * as poseClear from './pose/clearTransform.js';`
  `import * as poseMirror from './pose/mirror.js';`

- All operators gate on `editorStore.editMode === 'pose'` via the
  `inPoseMode()` helper inside `registerBuiltins`. Outside Pose Mode,
  `available()` returns false → dispatcher returns WITHOUT
  preventDefault → browser default kicks in. This matters for
  `Ctrl+C/V` falling through to text copy/paste in non-Pose contexts.

- Selection model: bones are `useSelectionStore.items` entries with
  `{type:'group', id}` where the node is `isBoneGroup(node)` (== has
  `boneRole`). Plain organisational groups are filtered before reaching
  any operator via `eligibleBones()` in `clearTransform.js`.

## Undo / batch correctness

- `clearPoseLocation/Rotation/Scale` and `clearAllPose(channel)` each
  wrap their multi-bone loops in a single `beginBatch(project)` /
  `endBatch()` so the user gets ONE undo entry no matter how many bones
  were cleared.
- `posePaste` and `poseMirrorPaste` similarly wrap their writes in a
  single batch.
- `poseSelectMirror` does NOT batch — selection changes are not in the
  undo stack (matches sister operators' behaviour).
- `poseCopy` does NOT batch — clipboard-write is not in the project
  undo stack (it's a separate in-memory store).

## Test scoreboard

All 6 Phase 7.C suites green; sister suites green; typecheck clean.

| Suite | Assertions |
|-------|------------|
| `test_poseMode_clearLoc`                                                | 23  |
| `test_poseMode_clearRot`                                                | 10  |
| `test_poseMode_clearScale`                                              | 9   |
| `test_poseMode_clearAll`                                                | 24  |
| `test_poseMode_mirrorPose`                                              | 53  |
| `test_poseMode_copyPaste`                                               | 30  |
| **`test_audit_fixes_2026_05_11_phase7c` (NEW — pins 8 FIXes + 3 deviation docs)** | **46** |
| **Phase 7.C total post-audit-fix**                                      | **195** |
| migrations                                                              | 135 |
| editorStore                                                             | 87  |
| meshSync                                                                | 28  |
| undoHistory                                                             | 22  |
| apply_menu_store                                                        | 28  |
| Phase 7.B audit-pin                                                     | 43  |

## Hotkey additions (Phase 7.C)

Per plan §8 audit-fixed binding table:

| Chord | Operator |
|-------|----------|
| `Alt+G`            | `pose.clearLocation` |
| `Alt+R`            | `pose.clearRotation` |
| `Alt+S`            | `pose.clearScale` |
| `Shift+Alt+G`      | `pose.clearAllLocation` (audit-fix G-1/D-1: was `Alt+Shift+G`) |
| `Shift+Alt+R`      | `pose.clearAllRotation` (audit-fix G-1/D-1: was `Alt+Shift+R`) |
| `Shift+Alt+S`      | `pose.clearAllScale` (audit-fix G-1/D-1: was `Alt+Shift+S`) |
| `Ctrl+Shift+M`     | `pose.selectMirror` (+ `Meta+Shift+M`) |
| `Ctrl+Shift+V`     | `pose.mirrorPose` (+ `Meta+Shift+V`) |
| `Ctrl+C`           | `pose.copy` (Pose Mode only; + `Meta+C`) |
| `Ctrl+V`           | `pose.paste` (Pose Mode only; + `Meta+V`) |

## Manual gate (Phase 7.C.6 / 7.D)

Browser-side. Suggested checks:

- **Clear Loc/Rot/Scale**: pose a bone (drag in Pose Mode), select it,
  press `Alt+G` / `Alt+R` / `Alt+S`; the corresponding channel resets
  to identity.
- **Clear All**: press `Alt+Shift+G/R/S`; every bone in the project
  has that channel reset (regardless of selection).
- **Select Mirror**: select `leftElbow`, press `Ctrl+Shift+M`;
  selection extends to include `rightElbow`.
- **Copy / Paste round-trip**: pose `leftElbow`, press `Ctrl+C`;
  reset its pose; press `Ctrl+V`; pose restored.
- **Mirror Pose**: pose `leftArm` (e.g. raise it 30°), press `Ctrl+C`;
  select `rightArm`, press `Ctrl+Shift+V`; right arm raises 30° on
  the mirrored axis.
- **Cross-skeleton paste**: pose Hiyori's left arm, copy, switch to a
  different .stretch project with same role taxonomy, paste — pose
  transferred.
- **No-Pose-Mode safety**: outside Pose Mode, pressing `Ctrl+C` over a
  text input still copies text (dispatcher returns without
  preventDefault when operator unavailable); pressing it on the canvas
  is a silent no-op.

## Audit-fix sweep details (`25b04f3`)

Two parallel agents audited initial `fbf7f82`:
- [AUDIT_2026_05_11_TOOLSET_PHASE7C_ARCH.md](./AUDIT_2026_05_11_TOOLSET_PHASE7C_ARCH.md)
  — 5 gaps (1 HIGH, 2 MED, 2 LOW)
- [AUDIT_2026_05_11_TOOLSET_PHASE7C_BLENDER.md](./AUDIT_2026_05_11_TOOLSET_PHASE7C_BLENDER.md)
  — 9 gaps (2 HIGH, 4 MED, 3 LOW)

14 total (with 2 LOW duplicating G-1/D-1 chord-order). 9 FIX + 3
DOCUMENT-AS-DEVIATION + 2 already-merged-as-duplicates.

### Architecture HIGH (= Blender D-1)

- **G-1/D-1** — `Alt+Shift+KeyG/R/S` keymap entries were dead-on-arrival.
  `chordOf` builds modifiers in canonical `Ctrl+Shift+Alt+Meta+`
  order; pressing Alt+Shift+G produces `Shift+Alt+KeyG`. None of the
  three `pose.clearAllLocation/Rotation/Scale` chords would ever fire.
  Fix: rename keys to canonical `Shift+Alt+Key*` order (Rule №2 — no
  legacy alias for the wrong-order names). Updated registry operator
  labels and the comment block.

### Blender-fidelity HIGH

- **D-2** — `clearAllPose`'s doc cited `POSE_OT_clear_user_transform`
  which doesn't exist in Blender. The real `POSE_OT_user_transforms_clear`
  restores to KEYFRAMED state, not identity-zero. SS's actual behavior
  matches `POSE_OT_transforms_clear` (`pose_transform.cc:1431`) applied
  to all bones unconditionally — an SS-specific extension. Fix: rewrote
  module doc with correct operator names + analogues + explicit
  SS-extension marker.

### Architecture MED

- **G-2 (DOCUMENT-AS-DEVIATION)** — Phase 7.C operators write flat
  `node.pose.{x,y,...}`; v19 schema migration wraps flat pose into
  `node.pose.channels[boneId]`. Only `getBonePose` reads channels;
  every writer (PoseService.restorePose, SkeletonOverlay drag, Phase
  7.C ops) writes flat. Cross-cutting gap predates Phase 7.C; fixing
  ONLY 7.C operators would create three writer-class disagreement.
  Documented in `clearTransform.js` with follow-up plan name
  (`setBonePoseField` helper OR v35 re-flatten migration).
- **G-3 (FIX)** — `poseCopy` cleared the clipboard on empty selection.
  Available() gate prevents keyboard invocation, but programmatic
  callers (future Pose Library, scripts) would silently destroy a
  valid clipboard. Fix: one-line removal — empty-selection is now a
  silent no-op (Blender semantics).
- **G-5 (FIX)** — `poseSelectMirror` toast fired only on total failure
  (`added === 0 && missing.length > 0`); partial-success missing roles
  were silently dropped. Fix: toast now fires whenever
  `missing.length > 0`, with different copy for partial vs full failure.

### Blender-fidelity MED (all cite corrections)

- **D-3 (FIX cite)** — `POSE_OT_loc_clear/rot_clear/scale_clear` cited
  at `:1129/:1138/:1147` are inside `pchan_clear_rot`'s lock-handling.
  Real registrations at `:1404/:1377/:1350`; generic dispatcher at
  `:1262`.
- **D-4 (FIX cite)** — `POSE_OT_select_mirror` exec/registration cited
  at `pose_select.cc:1011-1078` and `:1080-1132` were
  `pose_select_same_color` and `pose_select_same_collection`. Real:
  exec `:1392`, registration `:1470`.
- **D-5 (FIX cite)** — `flip_pose_data` function does NOT exist in
  Blender. The X-flip is inlined in `pose_bone_do_paste` (`:625-777`
  function body; flip block at `:720-750`). Fix: rewrote doc to cite
  the real inline location.
- **D-6 (FIX cite)** — `POSE_OT_paste` exec cited at `:805-859` was
  inside `pose_copy_exec`; `flipped` RNA flag at `:899` was inside
  paste exec body. Real: registration `:1015`, exec `:861`, flipped
  flag `:1032`.

### Architecture LOW

- **G-4 (DOCUMENT-AS-DEVIATION via G-2)** — no v19-shape test fixture.
  Folded into G-2 follow-up plan — adding a v19 fixture inside Phase
  7.C would lock in cross-cutting bug behavior.

### Blender-fidelity LOW

- **D-7 (FIX cite)** — `poseClipboardStore` cited `view3d_buttons.cc:2018+`
  (quaternion lock UI). Real: Blender's pose clipboard is a temp
  `.blend` file written by `pose_copy_exec` (`pose_transform.cc:785`)
  via `pose_copybuffer_filepath_get`. SS's in-memory store remains
  correct; only the source-pointer was wrong.
- **D-8 (DOCUMENT-AS-DEVIATION)** — `poseSelectMirror` is additive
  (extend=true); Blender's default `extend=false` SWAPS selection.
  SS's additive default matches the broader SS selection UX (Phase
  7.A boxSelect adds by default). Documented in `mirror.js`.
- **D-9 (FIX cite)** — `BLI_string_flip_side_name` cited at
  `string_utils.cc:243-413`; function actually starts at `:297` (line
  243 was `is_char_sep` helper). Same wrong cite was fixed in Phase
  7.B D-4 for weight-paint mirror; fixed here for Phase 7.C.

## N-panel / UI surface

Phase 7.C did NOT add new N-panel sections — all operators are
chord-only + command-palette accessible. The Pose Mode N-panel
remains a Phase 7.D / follow-up concern (no SS user currently has
N-panel content for Pose Mode beyond the existing per-Object transform
section).

