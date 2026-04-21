# Session 25 Findings — Phase A pre-symmetrization (warp-only)

**Date:** 2026-04-21 (continuing same real-day as Session 24 revert)
**Scope:** Implemented Session 23 Phase A items A.1–A.4 in the warp-only
architecture, after Session 24's rotation-deformer detour was reverted.
**Status at session end:** cmo3writer.js has the four input-symmetrization
changes behind `!tiltedNeck` gating. Awaiting user test on shelby / girl
/ waifu.

---

## 1. Context

Session 24 attempted to add a RotationDeformer keyed to ParamAngleX,
hypothesizing it would provide a rigid-body head-swing alongside the
existing FaceParallax warp. User tested → head severed from neck and
tilted around chin (cartoon "head on a stick"). Root cause: Live2D's
RotationDeformer rotates only around canvas Z-axis — that's a lean, not
a yaw. All head-turn illusion in 2D Live2D comes from **warp grid
shapekeys** (keyform control-point displacements). No secondary
rotation deformer.

Reverted Session 24 fully. Returned to the Session 23 Phase A plan:
pre-symmetrize the FaceParallax warp's inputs so the keyform math
produces clean L/R mirror shapekeys, enabling a higher FP_DEPTH_AMP
without the goblinification we saw at AMP=3.0 with raw asymmetric
inputs.

## 2. Changes shipped in `src/io/live2d/cmo3writer.js`

All four are gated on `!tiltedNeck` (the A.5 UI toggle still pending;
`tiltedNeck=false` is the default).

### A.1 — Symmetric face half-width

Old: `fpRadiusX = (faceMeshBbox.maxX - faceMeshBbox.minX) / 2`
New: `fpRadiusX = max(centerX - minX, maxX - centerX)`

Why: real art has sub-pixel L/R asymmetries in the face mesh bbox. Using
the raw half-width means u=±1 land at different canvas distances from
the face center; mirror grid points see different geometry. Taking the
larger half forces equal u-extent on both sides.

### A.2 — Mirror-averaged depth sampling

`fpZAt(canvasGx, canvasGy, u)` now samples depth at both `canvasGx` and
its mirror across `faceMeshCxLocal`, then averages, when depth-PSD is
used and `!tiltedNeck`. Cylindrical-dome fallback is already symmetric
in u.

Why: EDT hemispheres on asymmetric face alpha masks can have sub-pixel
L/R asymmetry. See-Through depth PSDs can have similar noise from the
Marigold model's stochasticity. AMP=3.0 amplifies that noise 2× vs
AMP=1.6 (Session 23 goblin root cause). Averaging kills the noise at
the source.

### A.3 — Paired region symmetrization

After `protectedRegions` is built, iterate through pairs whose tags
share a base (`foo-l` + `foo-r`). For each pair, force:
- `|u|` = average of `|u_L|` and `|u_R|` (preserves sign/side, matches magnitude)
- `v`, `z`, `halfU`, `halfV`, `falloffU`, `falloffV` = simple averages

Why: even with A.1 and A.2 in place, per-mesh vertex bboxes can be
slightly asymmetric. Forcing L/R regions into exact mirror eliminates
the residual asymmetry that caused "left eye translates while right
eye deforms" under AngleY.

### A.4 — FP_DEPTH_AMP = 3.0 globally

Was: `(tiltedNeck && isGeometricDepth) ? 3.0 : 1.6`
Now: `3.0`

Why: 1.6 was a Session 23 fallback to avoid goblinification when the
root cause (asymmetric depth noise) was unfixed. A.1–A.3 kill the
noise; 3.0 is safe and gives the visibly stronger parallax that girl's
"perfect" look had.

## 3. What Phase A.5 (UI toggle) still needs

Not yet shipped:
- Checkbox "Tilted Neck (drawn-turned head)" in `ExportModal.jsx`.
- `tiltedNeck` bool plumbed through export pipeline to cmo3writer
  (already partially done — the flag is in the input destructure).

Until A.5 ships, `tiltedNeck` is effectively always `false` and
everyone gets the symmetrization path. This is the right default for
95% of Live2D characters.

## 4. Expected behavior on test

- **shelby** (symmetric realistic): AngleX ±30 now shows visible
  parallax squash (AMP=3.0 vs previous 1.6 bump); L and R eye behave
  identically under AngleY; no goblin.
- **waifu** (symmetric anime with depth PSD): similar improvement;
  depth PSD's natural anime-face asymmetry noise gets averaged out.
- **girl** (drawn-turned head, asymmetric): likely NOT to recover its
  Session 23 "perfect" look — girl's perfection relied on the raw
  asymmetric depth field aligning with the drawn tilt. A.5's
  `tiltedNeck=true` UI toggle is the proper path for her. Until that
  ships, girl uses the symmetrized path and will probably look
  "corrected" but flat-ish compared to Session 23's perfect snapshot.

## 5. Files touched

- `src/io/live2d/cmo3writer.js` — four blocks under section 3d.2
  (`FP_DEPTH_AMP`, `fpZAt`, face-parallax normalization, region
  post-processing).
- `docs/live2d-export/SESSION_25_FINDINGS.md` — this file.
- `docs/live2d-export/AUTO_RIG_PLAN.md` — Session 25 evidence entry.
- `memory/project_live2d_export.md` — Session 25 summary.

## 6. If this export regresses

Fallback sequence if the user sees worse output than Session 23's
AMP=1.6 baseline:

1. Drop `FP_DEPTH_AMP` from 3.0 back to 1.6 (A.4 revert — smallest
   hammer, keeps the other three symmetrizations).
2. If still bad: disable A.3 region pairing (the most invasive
   change — changes region centers which might interact with the
   protection blending).
3. If still bad: disable A.2 mirror-averaging (might be washing out
   legitimate depth detail).
4. If still bad: full revert to HEAD (pre-Session-24 = pre-Session-25).

## 7. Next

- A.5 UI toggle for `tiltedNeck` — lets girl recover via the
  unsymmetrized path.
- Re-evaluate Sýkora Poisson inflation (Phase B from Session 23 plan)
  only if Phase A + A.5 isn't enough.

## 8. Follow-up tunes this same session (25b)

- **FP_MAX_ANGLE_Y_DEG: 12 → 8.** User reported "goblin" on shelby
  under AngleY=±30 after A.4 bumped AMP to 3.0 — 12° virtual pitch
  produced too-aggressive vertical compression (forehead enlarged,
  chin receded). 8° preserves the nod cue without the cartoon
  distortion. AngleX kept at 15° because horizontal head swing
  needs more amplitude to read as a turn.

## 9. Known art-level issue (not code-fixable)

User diagnosed a persistent "left eye floats behind the face" artifact
on shelby: the **eyelid line is baked into the face mesh on the L
side** (so it deforms with the face under parallax), but exists as
part of `eyelash-r` on the R side (so it rigid-translates with the
eye). Under any head rotation the L eyelid line deforms while the L
eye itself rigid-translates — they drift apart, looking like the eye
"floats behind."

This is a PSD-tagging asymmetry, not a parallax-math bug. Fixes are
all upstream:
1. Re-tag the L eyelid line as part of `eyelash-l` (PSD edit).
2. Or split the L eyelid line out of the face mesh into a new
   `eyelid-l` mesh and protect it.

Leaving as-is for now — documenting so we know this class of artifact
is an art-data issue, not the parallax code.
