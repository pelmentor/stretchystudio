# Session 26 Findings — A.6 grid-coverage fix + 3D effects + depth/tiltedNeck removal

**Date:** 2026-04-21 (same calendar day as Sessions 24–25; this is the followup after Session 25c-25f testing)
**Scope:** (1) Fix the L/R "stroke face" asymmetry that survived Session 25's A.1–A.3. (2) Add two 3D-enhancement effects. (3) Remove depth PSD + tiltedNeck infrastructure after testing proved them unnecessary.
**Status at session end:** cmo3writer.js reduced to 4983 lines. Default path handles all three test characters (shelby, girl, waifu). Two code modules deleted. Ready for Session 27 refactor.

---

## 1. Root cause of the residual "stroke face" asymmetry

Session 25 Phase A.1–A.3 symmetrized the REGION parameters (paired eye-l/eye-r
halfU/halfV/v/z) and the GRID (symmetrizeKeyform for ax=0). Yet shelby still
showed visible L/R height mismatch in the eyes under AngleY ±30.

**Diagnosis (A.6):** the inner full-protection zone was an ELLIPSE inscribed
in the mesh bbox (`duInner² + dvInner² ≤ 1`), which covers only π/4 ≈ 78% of
the bbox area. The 4 CORNERS of the bbox — exactly where eye-corner mesh
vertices sit (inner/outer canthus, upper eyelash tips) — fell into the fade
zone and received `proximity < 1` → blended natural+rigid shifts. Since drawn
art has sub-pixel L/R asymmetry in eye-mesh vertex positions, those corner
vertices saw different blend weights and produced visible asymmetry.

Fix A.6: switched the inner test from ellipse to RECTANGLE (Chebyshev):
`|duInner| ≤ 1 && |dvInner| ≤ 1`. Now the entire bbox (corners included)
gets `proximity = 1`.

**But A.6 alone wasn't enough.** User reported face still looks "perekosheno
ot insulta" (stroke-distorted). Deeper diagnosis:

**Real root cause (A.6b):** the warp grid is SPARSE (6 × 6 over faceUnionBbox).
Cell width in u-space ≈ 0.3–0.5. Eye super-group halfU ≈ 0.1 — **much smaller
than one cell**. Protection only takes effect on GRID-POINT shifts, and mesh
vertices are bilinearly interpolated from 4 surrounding grid corners. When
the region is smaller than a cell, some of those 4 corners fall OUTSIDE the
rigid zone → bilinear interp pulls in position-dependent natural shifts.
Drawn-art vertex asymmetry (subtle) maps onto the natural shift field, which
varies with u/v/z → asymmetric interp result.

Fix A.6b: after A.3's averaging, expand every protected region's halfU/halfV
by one grid-cell width (`cellU = (faceUnionBbox.W / fpCol) / fpRadiusX`).
This guarantees that for any mesh vertex inside the ORIGINAL mesh bbox, all
4 surrounding grid corners fall inside the expanded rigid zone. Bilinear
interp of four identical rigid shifts = that rigid shift exactly, no natural
leak.

**Side effect (accepted):** a small "flat slab" around each feature rigid-
translates. FP_PROTECTION_FALLOFF_BUFFER still smooths the transition at the
outer edge. Traded microscopic parallax detail in feature neighborhoods for
guaranteed L/R symmetry. User confirmed the result is clean.

**Preserved for effects that need tight scoping:** `r.meshHalfU` / `r.meshHalfV`
are stashed in A.6b before the expansion, so #5 (far-eye squash) can limit
its effect to the original mesh bbox without touching the A.6b-expanded zone.

---

## 2. 3D punch-up effects

### #3 — Eye parallax amp (Session 25e)

Multiply `regionShifts[ri].shiftU` by 1.3× for `eye-l` / `eye-r` super-groups
in `computeFpKeyform`. Eyes sit on high dome-z (≈0.78 at u≈±0.25), so under
AngleX the rotation math already gives them a substantial shiftU. 1.3× on
top makes the eyes "pop" slightly more than the surrounding skin, selling
the 3D curvature of the face.

Mild value (1.3) chosen because eyes are in a protection=1.0 region widened
by A.6b — a larger amp would drag the eye-surround slab (face-chunk failure
mode, see §3 below).

### #5 — Far-eye squash (Session 25f)

Perspective foreshortening for the far eye under AngleX. Implemented NOT via
ART_MESH keyforms (which would have required 9 keyforms per eye sub-mesh ×
multiplied by existing eye-closure keyforms = 18 combinations, risky), but
at the GRID LEVEL:

After the main grid-shift loop in `computeFpKeyform`, for each eye super-group:
- Determine "far" side: `r.u * sinX < 0` (far eye is the side whose u sign
  differs from thetaX's sign). Under +thetaX, +z face surface rotates to +u,
  so -u side recedes "into the back" of the head.
- For grid points on the OUTER side of the far eye (`duFromEye * r.u > 0`),
  within r.meshHalfU/V (NOT falloffU/V — scoped to original bbox), shift
  them INWARD toward the eye center.
- Gradient: `uStr * vStr` — strongest at outer edge, fades to 0 at eye
  center and at V extremes.

`FAR_EYE_SQUASH_AMP = 0.18`. Peak shift ≈ 9 px at max AngleX for fpRadiusX=200.

Cubism bilinear-interps mesh vertices from grid corners, so the outer half
of the far eye's mesh compresses, inner half stays. Reads as "eye viewed at
an angle". User confirmed it looks right across all three characters.

---

## 3. Failed experiment: ear-tuck amp (Session 25d, reverted)

**Attempt:** multiply `regionShifts[ri].shiftU *= 3.0` for `ears` / `ears-l`
/ `ears-r` tags. Idea: ears sit at u=±1 with dome-z=FP_EDGE_DEPTH_K≈0.30,
so rotation gives only modest shiftU; amping 3× would "tuck" the far ear
behind the face silhouette under AngleX.

**Result:** shelby's face side visibly compressed under AngleX=-30. ~25% of
the face near the ear moved with it, exposing the neck layer underneath.

**Why it failed:** interaction with A.6b. Ear's halfU expanded to ~0.6 u
(cellU + mesh halfU) = 120 px canvas. Ear protection=0.9 → face-mesh vertices
in this wide zone got 90% rigid-shift = ear's shift × 3 = ~28 px. Whole side
of face dragged with the ear.

**Lesson:** amplification of shifts for highly-protected regions compounds
with A.6b's wide protection zones. Amps must stay ≤ ~1.5× unless the zone is
specifically shrunk for the region. Eye amp (#3) survives at 1.3× only
because it's modest. Reverted the amp; ears now use natural rotation math
only.

---

## 4. UI and infrastructure cleanup (end of session)

### 4.1 — `tiltedNeck` toggle removed

Started the session planning to ship an A.5 `tiltedNeck` checkbox so
drawn-turned characters (like girl) could bypass the symmetrization.

**After testing:** default path (A.6b + #3 + #5 + AMP=3.0 + A.1/A.2/A.3
symmetrization) works on ALL THREE test characters:
- shelby (front-facing realistic)
- girl (3/4 drawn-turned)
- waifu (anime front-facing with depth PSD)

The `tiltedNeck=true` fallback path ended up dead code. User called it
useless, we removed:
- `tiltedNeck` state + checkbox + Label in `ExportModal.jsx`
- `tiltedNeck` destructure in `exporter.js` + cmo3writer.js
- All `if (tiltedNeck)` / `if (!tiltedNeck)` branches in cmo3writer.js
  (A.1 tiltedNeck branch, A.2 single-sample branch, A.3 gate, #3 gate,
  symmetrizeKeyform gate, conditional `FP_DEPTH_AMP = tiltedNeck ? 1.6 : 3.0`)

Simplification ~80–100 lines net.

### 4.2 — Depth PSD removed entirely

User tested waifu (the character most likely to benefit from See-Through
depth PSD, being the only anime art with an accompanying Marigold-derived
depth map) WITHOUT depth PSD input, and said "better results". Confirmed the
cylindrical dome fallback is adequate for head parallax on all character
types.

Body parallax (Body Angle X/Y) never consumed depth — only face parallax
sampled `effectiveDepth`. So depth infrastructure served only one consumer,
and that consumer works better without it.

Removed:
- `src/io/depthPsd.js` (full file deleted)
- `src/io/geometricDepth.js` (full file deleted)
- `importDepthPsd` UI upload + `depthData` state + `handleDepthPsdFile` in
  `ExportModal.jsx` (~50 lines)
- `depthData` pass-through in `exporter.js`
- `effectiveDepth` / `depthSource` / `depthPlausible` resolution block
  (~35 lines in cmo3writer.js lines 524–566)
- `hasDepthForFace` / `isGeometricDepth` in FaceParallax section
- Both branches of `fpZAt` (depth-sampled path + mirror-average path) —
  collapsed to just the cylindrical dome formula
- Depth-related `rigDebugLog.faceParallax` fields
- `sampleDepthSigned` / `computeGeometricDepth` / `isDepthPsdPlausible`
  imports in cmo3writer.js

Simplification: ~100 lines in cmo3writer, plus full `depthPsd.js` (≈140
lines) and `geometricDepth.js` (≈240 lines) = ~480 lines eliminated across
the project.

---

## 5. Files changed this session

- `src/io/live2d/cmo3writer.js` — 5028 → **4983** lines (net −45, but
  includes many block-level simplifications: removed depth resolution,
  dome-only fpZAt, 4 tiltedNeck gates unwrapped)
- `src/io/live2d/exporter.js` — removed depthData + tiltedNeck params
- `src/components/export/ExportModal.jsx` — 776 → **711** lines
- `src/io/depthPsd.js` — **DELETED**
- `src/io/geometricDepth.js` — **DELETED**
- `docs/live2d-export/SESSION_26_FINDINGS.md` — this file
- `docs/live2d-export/AUTO_RIG_PLAN.md` — Session 26 evidence entry
- `memory/project_live2d_export.md` — Session 26 summary

---

## 6. Constants that are now stable

```
FP_DEPTH_K               = 0.80   // dome z at face center
FP_EDGE_DEPTH_K          = 0.30   // dome z at face edges
FP_DEPTH_AMP             = 3.0    // unconditional (was conditional on tiltedNeck)
FP_MAX_ANGLE_X_DEG       = 15
FP_MAX_ANGLE_Y_DEG       = 8      // reduced 12→8 in Session 25b (goblin under AngleY)
FP_PROTECTION_STRENGTH   = 1.0
FP_PROTECTION_FALLOFF_BUFFER = 0.12
EYE_PARALLAX_AMP_X       = 1.3    // #3
FAR_EYE_SQUASH_AMP       = 0.18   // #5
```

Eye super-group protection = 1.0 (max). Ears/brows = 0.8–0.9. Nose/mouth =
0.3. All regions get halfU/halfV expanded by cellU/cellV post A.3 (A.6b).

---

## 7. Known deferred issue

Under AngleX ±30, a slight neck-layer exposure appears at the side of the
face where the jawline compresses. User noted but deferred: "but it's for
later". Likely cause: A.6b's wide protection zones reduce natural parallax
in the face-skin area adjacent to features, so the chin doesn't translate
as much as the neck expects. Fix TBD — possibly reducing chin-area natural
parallax less aggressively, or masking neck-reveal with a CPart opacity bind.

---

## 8. Next session: refactor

cmo3writer.js is 4983 lines. Unsustainable for continued feature work.
Proposed split:

- `cmo3writer.js` — orchestrator + CAFF archive write
- `cmo3/faceParallax.js` — all FP math (region build, A.3 pairing, A.6b
  expansion, #3, #5, symmetrizeKeyform, computeFpKeyform, fpZAt)
- `cmo3/bodyRig.js` — Body X / Neck / Face Rotation warps
- `cmo3/deformerEmit.js` — warp/rotation deformer emit boilerplate
- `cmo3/xmlHelpers.js` — x.sub / x.shared / x.ref wrappers

Also clean up `src/io/live2d/bodyAnalyzer.js` (untracked, unclear if in use)
and other stragglers in that directory.

**Do NOT ship feature changes in the refactor session.** Pure structural
moves. Tests: node --check on all touched files + manual export of shelby
+ girl + waifu to confirm no behavioral drift.
