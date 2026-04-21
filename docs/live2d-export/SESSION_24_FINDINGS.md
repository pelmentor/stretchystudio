# Session 24 Findings — Head X Rotation attempt + REVERT

**Date:** 2026-04-21
**Scope:** Reverse-engineered a 175-frame Cubism Editor recording of a rigged
HEAD ANGLE X model. Attempted to add a dedicated RotationDeformer keyed to
ParamAngleX. **Reverted** — the approach was based on a wrong reading of the
reference video and does not work in 2D Live2D.
**Status at session end:** cmo3writer.js restored to pre-Session-24 state.
Documentation updated to record the mistake so it isn't re-tried. Session 23
Phase A plan (warp-only + pre-symmetrization) is back on deck.

---

## 0. What happened (the short version)

1. Reverse-engineered tutorial frames in `./frames/` → wrote
   `head-angle-x-technique/TECHNIQUE.md` claiming the rig uses
   RotationDeformer + WarpDeformer both keyed to ParamAngleX.
2. Implemented that in `cmo3writer.js`: new Head X Rotation deformer ±12°
   at chin pivot, inserted between Face Rotation and FaceParallax;
   reduced `FP_MAX_ANGLE_X_DEG` 15 → 6.
3. User tested on shelby → head **detaches from neck and rigidly swings
   around the chin pivot** at ParamAngleX ±30. No warp deformation
   visible. The visual was a cartoon "head-on-a-stick" effect — head
   severed from body at the neck, pivoting as a rigid 2D shape.
4. **Root cause of the failure:** a Live2D RotationDeformer can only
   rotate around the canvas's Z-axis. That's a 2D tilt / lean, NOT a 3D
   yaw/turn. ParamAngleX needs a left-right head TURN (yaw), which in
   2D art is only achievable through WARP perspective tricks — the warp
   shifts grid points asymmetrically to fake the projection of a
   rotating 3D head onto the 2D canvas. A rotation deformer cannot
   produce this; it just spins the head around a point.
5. Additionally, the "no warp deform" part of the symptom is not fully
   diagnosed — possibly the warp's AngleX keyforms DID fire but their
   effect was invisible next to the dominant ±12° rigid tilt. Didn't
   investigate further because the rotation-tilt was already disqualifying.
6. Reverted the entire Session 24 change. cmo3writer.js diff is empty
   on Session 24 markers.

## 1. Why the video misled me (post-mortem)

Key mistaken observation: frame 142 showed a green curved arc around the
rotated head. I interpreted this as a RotationDeformer's rotation-handle
arc. In reality, it was almost certainly the OUTER BOUNDARY of the warp
deformer in its deformed state — warp deformer bounds aren't rectangular
once the grid is deformed; they follow the convex hull of deformed
control points. That produces a curved/arced visible boundary at extreme
keyforms.

Also, I conflated "head leans/swings in the video" with "head rotates."
Re-watching the frames with the correct prior: the head isn't tilting
around a pivot — it's being WARPED into a perspective-projected pose.
The chin moves too (not fixed at a rotation center), which is
inconsistent with a rotation deformer.

**Lesson:** in a 2D rig, any head "turn" motion is warp-only. Rotation
deformers are exclusively for tilts (ParamAngleZ). Don't re-try this.

---

## 1. What changed direction

Session 23 had identified a residual face-parallax issue: goblinification on
shelby, asymmetric left/right eye deformation under AngleY, inability to
match the "perfect" girl look across all three characters. The planned fix
was **Phase A pre-symmetrization** (5 sub-steps: force-symmetric face bbox,
mirror-average depth sampling, paired iris mirror positions, restore
FP_DEPTH_AMP=3.0, tiltedNeck UI toggle).

This session started by reverse-engineering a user-supplied tutorial
recording (175 frames @ 2fps) of a Live2D Cubism Editor rig, and the
insight was that **our exporter was doing the wrong thing at the
architecture level**, not just tuning-wrong at the numeric level:

- The reference rig uses the classical Cubism idiom: **RotationDeformer
  keyed to ParamAngleX (rigid-body swing) + WarpDeformer keyed to the same
  param (perspective squash)**.
- Our exporter had only the warp, no rotation deformer for AngleX. That's
  why the warp had to carry the entire "head turn" illusion alone, and why
  we kept running into aesthetic edge cases (goblin / asymmetry / etc.).

The reverse-engineering + technique docs live in
[`docs/live2d-export/head-angle-x-technique/`](head-angle-x-technique/)
(TECHNIQUE.md + notes_01_skeleton.md).

Phase A pre-symmetrization is **parked** — not canceled, but likely
obsoleted once the rotation+warp combo runs on real exports. The root
causes the pre-symmetrization was working around (depth-sampling asymmetry
amplified by a 15° virtual warp rotation) shrink significantly when the
warp only contributes 6° and the rigid rotation does the rest.

---

## 2. Code change

### 2.1 New Head X Rotation deformer

`src/io/live2d/cmo3writer.js` section 3d.2 — inserted between Face Rotation
and FaceParallax in the deformation chain:

```
Body X → Face Rotation (AngleZ, ±10°) → Head X Rotation (AngleX, ±12°) → FaceParallax (AngleX×AngleY, 9kf)
                                         ^^^^^^^^^^^^^^ NEW
```

- Type: `CRotationDeformerSource`
- Pivot: `(0, 0)` in Face Rotation's local frame — same chin canvas-point
  as Face Rotation. Composes the two rotations around the identical pivot
  without disturbing FaceParallax's rest grid (still canvas-pixel offsets
  from chin).
- Keyforms: ParamAngleX = −30 / 0 / +30 → angles −12° / 0° / +12°.
  Value ±12° is from TECHNIQUE.md §5.3, derived from visually estimating
  rotation amplitude in frame 142 of the tutorial recording.

### 2.2 FaceParallax amplitude reduction

`FP_MAX_ANGLE_X_DEG` lowered from 15 to 6 (same file, same section). The
warp now contributes only the **perspective squash** that finishes off the
rigid rotation, instead of trying to carry the whole illusion.

`FP_MAX_ANGLE_Y_DEG` stays at 12 (unchanged) — there's no Head Y Rotation
deformer yet, so the warp still carries all of AngleY.

### 2.3 Backwards compatibility

The new block is gated on `pidParamAngleX` existing; its guid is stored in
`pidHeadXRotGuid` (null when the param is absent). FaceParallax's target
becomes `pidHeadXRotGuid || pidFaceRotGuid`, so models without an AngleX
parameter fall through to the old chain unchanged.

---

## 3. Why this should work across all three characters

Session 23's diagnosis — "one algorithm can't serve both symmetric and
asymmetric art" — was framed around a warp-only rig where all AngleX
behavior flowed through the depth field. When the depth field has any
left/right asymmetry (from EDT hemispheres on asymmetric mask shapes, or
from See-Through depth PSDs drawn with slight tilts), a 15° virtual
rotation amplifies those asymmetries visibly.

With the new architecture:

- **Rigid rotation** is perfectly symmetric by definition (RotationDeformer
  with angle ±12° doesn't care about the underlying art's symmetry).
- **Perspective squash** at 6° produces 60% less asymmetry amplification
  than at 15° — whatever noise survives should be near-imperceptible.
- The pseudo-3D effect's magnitude is **preserved** because the rigid
  swing replaces the visual load the warp was carrying.

For shelby (symmetric realistic): the rotation alone gives a clean swing,
the mild warp adds subtle finish. No goblin.

For waifu (symmetric anime): same path, should keep the waifu quality that
Session 23 already praised.

For girl (asymmetric drawn-turned): the drawn asymmetry is now expressed
by the art itself, not amplified by a wide warp — the tiltedNeck flag may
end up unnecessary. We'll check after export.

---

## 4. Remaining TECHNIQUE.md items (deferred)

From TECHNIQUE.md §5:

- **Rotation deformer X-translation keyform** (`±4% canvas width` at ±30).
  Could add 2-3 px of lateral slide to enhance the rotation feel. Skipped
  for now to keep this change minimal. Easy to add inside the same block
  by extending `CRotationDeformerForm` attrs.
- **Column-wise warp shift** (classical Cubism profile: far col ±12%, near
  col ±3%) instead of hemisphere 3D rotation. Skipped because current
  hemisphere model gives depth-based nose protrusion that we value for
  faces with depth PSDs. Reconsider if users report edge-column behavior
  feels off.
- **Head Y Rotation** (symmetric to Head X Rotation, keyed to AngleY).
  Not addressed in the tutorial frames. Add when AngleY shows similar
  issues post-export.

---

## 5. What to verify on next export

1. Run export for shelby, waifu, girl. Scrub ParamAngleX ∈ [−30, 30].
2. Expected behavior:
   - Chin stays roughly anchored; crown swings to the side.
   - Mild perspective squash on face interior (from the reduced warp).
   - No goblinification on shelby.
   - No worse on girl (girl's "perfect" look may or may not survive — if
     it doesn't, we re-open the tiltedNeck branch).
3. Check ParamAngleZ (head tilt) still works — Face Rotation should be
   untouched.
4. Check ParamAngleY still works — FaceParallax warp's AngleY keyforms
   are unchanged at 12°.
5. If rotation sign feels wrong (e.g. +AngleX swings the wrong way), flip
   `hxRotAngles` sign in the cmo3writer.

---

## 6. Reference material

- [head-angle-x-technique/TECHNIQUE.md](head-angle-x-technique/TECHNIQUE.md)
  — full reverse-engineering + numeric defaults.
- [head-angle-x-technique/notes_01_skeleton.md](head-angle-x-technique/notes_01_skeleton.md)
  — phase map of the tutorial frames.
- [SESSION_23_FINDINGS.md](SESSION_23_FINDINGS.md) — previous session's
  Phase A plan, now parked.
- Memory: [feedback_cubism_warps_dont_blend.md](../../memory/feedback_cubism_warps_dont_blend.md)
  and [reference_cubism_deformer_local_frames.md](../../memory/reference_cubism_deformer_local_frames.md)
  informed the shared-pivot decision.

---

## 7. Files touched this session

- `src/io/live2d/cmo3writer.js` — added Head X Rotation deformer block
  (≈85 lines), reduced `FP_MAX_ANGLE_X_DEG`, re-targeted FaceParallax.
- `docs/live2d-export/head-angle-x-technique/notes_01_skeleton.md` —
  phase map of tutorial frames.
- `docs/live2d-export/head-angle-x-technique/TECHNIQUE.md` — technique
  writeup + programmatic implementation guide.
- `docs/live2d-export/SESSION_24_FINDINGS.md` — this file.
- `docs/live2d-export/AUTO_RIG_PLAN.md` — Session 24 evidence entry.
- `memory/project_live2d_export.md` — Session 24 summary.
