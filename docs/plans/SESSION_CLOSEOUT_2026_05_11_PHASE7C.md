# Session Close-out — 2026-05-11 (Phase 7.C sub-session)

Continuation of [SESSION_CLOSEOUT_2026_05_11_PHASE7B.md](./SESSION_CLOSEOUT_2026_05_11_PHASE7B.md).
This sub-session shipped Toolset **Phase 7.C + Phase 7.C audit-fix sweep**
(ninth audit sweep over the toolset plan). Branch ahead of `origin/master`
by 30 commits at HEAD `25b04f3` (close-out doc commit follows separately).

## What shipped this sub-session (2 commits)

### Toolset Blender-Parity Plan — Phase 7.C + audit-fix

| Commit  | What |
|---------|------|
| `fbf7f82` | Phase 7.C initial — Clear Pose Loc/Rot/Scale (Alt+G/R/S) + Clear All per-axis (Alt+Shift+G/R/S) + Select Mirror (Ctrl+Shift+M) + Mirror Pose (Ctrl+Shift+V) + Copy/Paste Pose (Ctrl+C/V in Pose Mode). 10 operators, new poseClipboardStore (in-memory), no schema bump. 149 spec assertions across 6 test suites. |
| `25b04f3` | Phase 7.C audit-fix sweep — 2 HIGH (1 arch + 1 Blender) + 6 MED + 6 LOW gaps closed. 9 FIXes + 3 DOCUMENT-AS-DEVIATION + 2 duplicate-with-HIGH. 46-assertion audit-pin test (195 total Phase 7.C). |

(Close-out doc commit follows separately.)

## Audit-fix sweep details (`25b04f3`)

Full per-gap details in
[TOOLSET_PHASE_7C_PROGRESS.md](./TOOLSET_PHASE_7C_PROGRESS.md)
§"Audit-fix sweep details". Headlines:

### Architecture HIGH (= Blender D-1)

- **G-1/D-1** — `Alt+Shift+KeyG/R/S` keymap entries were dead-on-
  arrival. `chordOf` builds modifiers in canonical
  `Ctrl+Shift+Alt+Meta+` order; pressing Alt+Shift+G produces
  `Shift+Alt+KeyG` — none of the three `pose.clearAllLocation/
  Rotation/Scale` chords would EVER fire. Fix: rename keys to
  canonical `Shift+Alt+Key*` order (Rule №2 — no legacy alias).
  All other Phase 0-7.B `Ctrl+Shift+*` chords are already correct
  per-`chordOf`; this was a Phase 7.C-introduced bug.

### Blender-fidelity HIGH

- **D-2** — `clearAllPose` doc cited a non-existent
  `POSE_OT_clear_user_transform` operator. The real
  `POSE_OT_user_transforms_clear` restores bones to KEYFRAMED state
  (or rest if no action), NOT identity-zero. SS's actual behavior
  matches `POSE_OT_transforms_clear` applied to all bones — an SS-
  specific extension. Fix: rewrote doc with correct names +
  analogues + explicit SS-extension marker.

### Architecture MED

- **G-2 (DOCUMENT-AS-DEVIATION)** — Phase 7.C operators write flat
  `node.pose.{x,y,...}` matching every other writer in the codebase
  (PoseService.restorePose, SkeletonOverlay drag). v19 schema
  migration wraps flat pose into `node.pose.channels[boneId]`; only
  `getBonePose` reads channels-shape. Cross-cutting gap predates
  Phase 7.C. Documented for follow-up plan
  (`setBonePoseField` helper OR v35 re-flatten migration).
- **G-3 (FIX)** — `poseCopy` cleared clipboard on empty selection;
  programmatic callers would silently destroy a valid clipboard.
  Fix: one-line removal.
- **G-5 (FIX)** — `poseSelectMirror` toast only fired on total
  failure; partial-success missing roles silently dropped. Fix: toast
  fires whenever any role is missing.

### Blender-fidelity MED (all cite corrections)

- **D-3 (FIX cite)** — `POSE_OT_loc_clear/rot_clear/scale_clear`
  real cites at `:1404/:1377/:1350`.
- **D-4 (FIX cite)** — `POSE_OT_select_mirror` real cites: exec
  `:1392`, registration `:1470`.
- **D-5 (FIX cite)** — `flip_pose_data` function does not exist;
  X-flip inlined in `pose_bone_do_paste` (`:625-777`; flip block
  `:720-750`).
- **D-6 (FIX cite)** — `POSE_OT_paste` real cites: registration
  `:1015`, exec `:861`, `flipped` flag `:1032`.

### Architecture LOW

- **G-4 (DOCUMENT-AS-DEVIATION via G-2)** — no v19-shape test
  fixture; folded into G-2 follow-up.

### Blender-fidelity LOW

- **D-7 (FIX cite)** — `poseClipboardStore` cite corrected from
  `view3d_buttons.cc:2018+` (quaternion UI) to actual mechanism
  (`pose_copy_exec` at `pose_transform.cc:785`, `.blend` file via
  `pose_copybuffer_filepath_get`).
- **D-8 (DOCUMENT-AS-DEVIATION)** — `poseSelectMirror` is additive
  (Blender default swaps). Matches SS's broader additive-selection
  UX. Documented in `mirror.js`.
- **D-9 (FIX cite)** — `BLI_string_flip_side_name` cite corrected
  from `:243` (was `is_char_sep` helper) to `:297` (real function
  start). Same wrong cite was also fixed in Phase 7.B D-4 for the
  weight-paint mirror module.

Audit docs on disk:
- [AUDIT_2026_05_11_TOOLSET_PHASE7C_ARCH.md](./AUDIT_2026_05_11_TOOLSET_PHASE7C_ARCH.md) — 5 gaps (1 HIGH, 2 MED, 2 LOW)
- [AUDIT_2026_05_11_TOOLSET_PHASE7C_BLENDER.md](./AUDIT_2026_05_11_TOOLSET_PHASE7C_BLENDER.md) — 9 gaps (2 HIGH, 4 MED, 3 LOW)

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
| **`test_audit_fixes_2026_05_11_phase7c` (NEW — pins all 8 FIXes + 3 deviation docs)** | **46** |
| **Phase 7.C total post-audit-fix**                                      | **195** |
| migrations                                                              | 135 |
| editorStore                                                             | 87  |
| meshSync                                                                | 28  |
| undoHistory                                                             | 22  |
| apply_menu_store                                                        | 28  |
| Phase 7.B audit-pin                                                     | 43  |

## Resume paths for fresh session

### A. Animation Phase 0 close-out (small, user-blocking)

Unchanged. Depgraph coherent post Phase 0 audit-fix; Phase 0.D flag
flip is gated on user-side manual byte-fidelity sweep on Shelby +
test_image4 PSDs.

### B. Manual gates 0.H + 1.F + 2.G + 3.J + 4.J + 5.E + 6.F + 7.A.6 + 7.B.6 + 7.C.7

Ten manual gates queued (browser-side). Phase 7.C.7 highlights:
- Clear Pose Loc/Rot/Scale (Alt+G/R/S) on Pose Mode bone selection
- Clear All per-axis (Shift+Alt+G/R/S) — note canonical chord order
  per audit-fix G-1/D-1; pre-fix `Alt+Shift+*` is silently inert
- Select Mirror (Ctrl+Shift+M) extends selection to camelCase prefix
  partners (`leftElbow ↔ rightElbow`)
- Mirror Pose (Ctrl+Shift+V) — paste-flipped X-axis after Ctrl+C
- Copy/Paste Pose (Ctrl+C / Ctrl+V in Pose Mode); outside Pose Mode
  the chords fall through to browser default

### C. Toolset Phase 7.D — Phase 7 exit gate

Per plan §7.D — verify all per-mode tool clusters work end-to-end on
a real Shelby project and update the plan's Top-12 score (Phase 7
covers ~6 of the 12 entries directly).

### D. Cross-cutting follow-up plan — Pose write canonicalisation

Audit-fix G-2 deviation: every pose writer in the codebase
(`PoseService.restorePose`, `SkeletonOverlay` drag, Phase 7.C
operators) writes flat `node.pose.{x,y,...}`, but v19 schema migration
wraps flat into `node.pose.channels[boneId]`. Only `getBonePose` reads
channels. Add `setBonePoseField(node, field, value)` to
`objectDataAccess.js` and route every writer through it, OR ship a
v35 migration that re-flattens (since no writer uses channels-shape,
removing it removes the divergence entirely). Cross-cutting blast
radius is small (3-4 callers) but is its own plan.

## Hotkey reservations (Phase 7.C additions)

- `Alt+KeyG` = `pose.clearLocation` ✅ shipped
- `Alt+KeyR` = `pose.clearRotation` ✅ shipped
- `Alt+KeyS` = `pose.clearScale` ✅ shipped
- `Shift+Alt+KeyG` = `pose.clearAllLocation` ✅ shipped (audit-fixed)
- `Shift+Alt+KeyR` = `pose.clearAllRotation` ✅ shipped (audit-fixed)
- `Shift+Alt+KeyS` = `pose.clearAllScale` ✅ shipped (audit-fixed)
- `Ctrl+Shift+KeyM` + `Meta+Shift+KeyM` = `pose.selectMirror` ✅ shipped
- `Ctrl+Shift+KeyV` + `Meta+Shift+KeyV` = `pose.mirrorPose` ✅ shipped
- `Ctrl+KeyC` + `Meta+KeyC` = `pose.copy` (Pose Mode only) ✅ shipped
- `Ctrl+KeyV` + `Meta+KeyV` = `pose.paste` (Pose Mode only) ✅ shipped

## Day-end commit chain (cumulative across sub-sessions)

| Order | Commit  | What |
|-------|---------|------|
| ...   | (24 from 2026-05-10 close-out) | Phases 0/1/2/3/4/5/6 ship + audit-fixes + close-outs |
| 25    | `cdd3c93` | toolset Phase 7.A — Object Mode tools |
| 26    | `c9c35c3` | audit-fix sweep #7 — Phase 7.A dual audit |
| 27    | `c6d1604` | docs Phase 7.A close-out + progress |
| 28    | `9489177` | toolset Phase 7.B — Weight Paint tools |
| 29    | `bd2b58f` | audit-fix sweep #8 — Phase 7.B dual audit (2 HIGH + 11 MED/LOW) |
| 30    | `7ac194f` | docs Phase 7.B close-out + progress |
| 31    | `fbf7f82` | toolset Phase 7.C — Pose Mode tools (Clear / Mirror / Copy/Paste) |
| 32    | `25b04f3` | audit-fix sweep #9 — Phase 7.C dual audit (2 HIGH + 10 MED/LOW) |
