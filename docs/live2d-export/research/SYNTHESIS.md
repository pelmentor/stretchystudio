# Research Synthesis — What to Adopt, What to Skip

After studying 8 papers across two rounds (Smith 2023 & 2025, Rivers 2010,
Johnston 2002, Sýkora 2010 & 2014, Dvorožňák 2020 Monster Mash, and
Depth Anything V2 2024), here's the distilled verdict. See `NOTES.md` for
per-paper detail; this file is the decision layer.

**Round 2 additions** (Sýkora 2010, Monster Mash, Depth Anything V2)
revealed a cleaner combined-best-of algorithm described in the final
section "Combined depth pipeline" below.

## Themes that emerged

1. **Separate 3D-like concerns from 2D shape concerns.** Every paper does
   this implicitly or explicitly: Rivers names it as "the core realization";
   Smith 2025 formalizes it as view-dependent retargeting; Ink-and-Ray
   treats shape (Poisson inflation) and layering (depth order) as distinct
   stages. **Our architecture already does this** — Cubism keyforms hold
   2D shape, draw-order + warp chain holds depth / 3D-like effects. We
   did not invent this by accident; it's the right structure.

2. **Inflation from silhouette is the canonical way to get region depth.**
   A continuous lineage: Johnston 2002 (damped-spring diffusion of edge
   normals) → TexToons 2011 (Laplace equation) → Ink-and-Ray 2014 (Poisson
   equation with constant RHS). All three produce hemispherical-style bas-
   reliefs from a 2D silhouette. Our cylindrical dome is a 1D degenerate
   case of this family.

3. **PSD layer tags give us a lot for free.** Segmentation (Smith 2023
   §3.2), region identification (Ink-and-Ray §3, §4.1), depth ordering
   (Rivers "overlap tool", Ink-and-Ray layering phase), and attribute
   annotation (Smith 2025 §4.1) — all problems the papers spend pages
   solving — are answered by tagged PSD layers in our input. This is a
   real architectural advantage we should explicitly document and defend.

4. **Our input is easier than theirs.** Smith 2023/2025 work from a single
   photo with ML pipelines. Rivers needs 3–4 hand-drawn views. Ink-and-Ray
   needs user scribbles for segmentation. We get a layered PSD with tags
   and clean alphas. This means whole stages (ML inference, multi-view
   triangulation, segmentation, completion) we can skip entirely.

5. **Our output is simpler than theirs.** They output: 3D mesh (Ink-and-
   Ray), 2.5D character rig (Smith 2025), rotation-interpolated 2D rendering
   (Rivers), animated video (Smith 2023). We output a `.cmo3` parameter
   definition for Cubism to interpret. Much narrower scope.

## Ideas ranked by value × feasibility × confidence

### Adopt — high value, high confidence

**A. Poisson-solved silhouette depth dome (replaces cylindrical dome).**
- **Source:** Ink-and-Ray §4.4, Lumo §2.1
- **What:** Solve `−∇²f = c` with Dirichlet `f=0` boundary on each tag's
  alpha mask. Optional `√f` post-process for hemispherical vs parabolic
  profile. Use as per-pixel depth for Face Parallax + body parallax Step 3.
- **Where:** new function in `bodyAnalyzer.js` style, applied in
  `cmo3writer.js` FaceParallax code and any future body depth cue.
- **Implementation cost:** ~1 day. Jacobi iteration on canvas-sized masks,
  ~100 iters, converges in ~1 second at export time.
- **Risk:** low. Falls back to current cylindrical if solve fails or
  analysis absent. Visible improvement expected on non-circular faces.
- **Verdict: Adopt as Step 3 of body parallax refactor**, after Step 2A/B
  visual testing validates per-row spine + feet pin.

**B. Closest-bone fallback for untagged mesh classification.**
- **Source:** Smith 2023 §3.4 (Delaunay + closest-bone-to-centroid)
- **What:** when `psdOrganizer.matchTag()` returns null, assign the mesh
  to a role by proximity to canonical body keypoints (neck, shoulders,
  hips, etc. already derived in `armatureOrganizer.js`).
- **Where:** `psdOrganizer.js:matchTag()` fallback path.
- **Implementation cost:** ~2 hours.
- **Risk:** very low. Non-destructive addition — existing tag matching
  path unchanged. Only affects meshes that currently get dropped.
- **Verdict: Adopt as side improvement any time.** Independent of Step 2.

### Consider later — medium value, medium confidence

**C. Per-tag Z-depth draw-order swaps at extreme ParamAngleY.**
- **Source:** Rivers 2010 §4.2 "overlap tool"; Smith 2025 §4.3.3 render
  ordering
- **What:** emit Cubism DrawOrder keyforms bound to ParamAngleY so that
  when character turns away, draw-order swaps become visible (far ear
  goes behind head, etc.).
- **Where:** new keyform emission pass in `cmo3writer.js`.
- **Implementation cost:** ~1-2 days (need to understand Cubism DrawOrder
  binding format + emit conditionally per tag pair).
- **Risk:** medium. We don't currently test at extreme Y rotations; could
  introduce artifacts we don't notice.
- **Verdict: Skip for now.** Our current 3 test characters don't need
  it; Cubism default draw-order works for face-forward and moderate tilt.

**D. Neumann boundary conditions for straight edges.**
- **Source:** Ink-and-Ray §4.4 Eq. 3
- **What:** if adopting Poisson dome (Idea A), allow marking some edges
  as Neumann (no roll-over) per tag. Shirt hem, rigid accessories, etc.
- **Where:** enhancement to the Poisson solver from Idea A.
- **Implementation cost:** ~half day on top of Idea A.
- **Risk:** low.
- **Verdict: Consider if Idea A ships and simple Dirichlet dome isn't
  sufficient for some tags.**

### Skip — low value or inapplicable

**E. Multi-view 2.5D structure (Rivers core algorithm).** We have one
view. Inferring 3D anchor positions from multi-view triangulation is
fundamentally incompatible with our single-PSD input.

**F. Left view + right view mirroring (Smith 2025 §4.2).** Our target
characters are asymmetric-by-design. Mirroring would create artifacts.

**G. Projection plane optimization for flailing/dampening (Smith 2025
§4.3.4).** Elegant novel math, but only applies when projecting 3D mocap
motion to 2D poses. Our input is 2D params (tracker values) — no such
projection happens in our pipeline.

**H. ARAP mesh deformation.** Smith 2023/2025 and Rivers all use or
reference it. Conflicts with Cubism's native warp + per-vertex
interpolation. Would not compose.

**I. Neural detection / segmentation / pose estimation.** Smith 2023
needs these because their input is a messy photograph. Our tagged PSD
bypasses the entire ML problem.

**J. Global illumination rendering, bas-relief mesh export, grafting,
stitching.** Ink-and-Ray infrastructure we don't need because we don't
render — we emit Cubism parameters.

**K. Twisted-perspective retargeting.** Smith 2023 validated it for
amateur children's drawings that already have twisted perspective baked
in. Our characters (girl/waifu/shelby) use consistent perspective.
Adding the technique would introduce distortion where none exists.

## Recommended action plan

Ordered by ROI:

1. **Resume Step 2A visual test** (current work, not research-driven).
   User exports girl/waifu/shelby with the measured HIP_FRAC/FEET_FRAC,
   checks that feet no longer tug under Body X/Z rotation. Validate the
   straightforward measurement-driven fix before anything else.

2. **Ship Step 2B — per-row spineX pivot in bow math** (also current
   work). Girl's 65px spine drift lower-body should get properly pivoted.
   No research dependency.

3. **Consider Idea B (closest-bone fallback)** as a small standalone
   improvement whenever a quiet day happens. Low risk, low cost.

4. **Prototype Idea A (Poisson dome)** as a feature-flagged experiment
   after Steps 2A/B ship:
   - Add `poissonDome: true|false` flag to generateCmo3
   - Implement Jacobi solver for per-tag alpha mask
   - Replace FP cylindrical dome behind the flag
   - A/B test on girl/waifu/shelby
   - Ship if visibly better; remove flag if not
   This is the single most principled upgrade available from the research.

5. **Document the segmentation-free architectural advantage** in
   `AUTO_RIG_PLAN.md` future-directions section. Cite Smith 2023 §3.2
   and Ink-and-Ray §3 for "why we don't need to solve segmentation/layering".

6. **Everything else is deferred indefinitely** unless evidence emerges
   that our output is wrong on a specific character in a way one of the
   skipped ideas would fix.

## What we did NOT find in the literature

- **A formula for inferring 3D depth from a single 2D view without user
  input.** Nobody has this, and our reading confirms why — it's
  fundamentally under-constrained. Rivers requires multi-view; Smith
  requires ML; Ink-and-Ray requires user scribbles. Our heuristics
  (tag-driven depth assignments, dome profiles) are the standard
  practical answer.

- **A principled way to auto-detect "hip" on arbitrary body silhouettes.**
  Our `widestCoreY` heuristic failing on shelby mirrors the "long tail of
  body shapes" problem Smith 2023 acknowledges (wide shoulders vs. wide
  hips). No paper offers a universal solution. Our current plausibility
  clamp (reject hipRf outside [0.35, 0.65]) is a reasonable engineering
  choice.

- **Academic work specifically on Live2D or .cmo3.** Unsurprisingly —
  the Cubism format is industrial, Live2D is proprietary. The Inochi2D
  open-source analog exists (REFERENCES #10) but as documentation, not
  academic papers. Our ongoing reverse-engineering notes in
  `docs/live2d-export/` are the primary contribution to this niche.

---

## Combined depth pipeline (Round 2 conclusion)

**The key Round 2 insight:** Sýkora 2010 and Ink-and-Ray 2014 solve
*different* sub-problems that combine cleanly:

- **Sýkora 2010 (Sparse Depth Inequalities):** LAYERED depth field —
  each region gets one depth value; smooth inter-region transitions via
  Laplace equation with mixed Dirichlet (seeds) + Neumann (at real
  contours) boundaries.
- **Ink-and-Ray 2014 (Bas-Relief Meshes):** INFLATED depth per region —
  each region gets a hemispherical dome via Poisson equation `−∇²f = cᵢ`.

Neither alone is optimal for us. Combined, they give a complete depth
pipeline:

```
Z_final(pixel) = Z_layered(pixel) + Z_inflation(pixel)
```

### Concrete implementation (proposed)

1. **Build per-tag alpha masks** (already done in `bodyAnalyzer.js`)

2. **Assign Dirichlet seeds** from PSD stack:
   - Each layer gets integer depth from its stack index
   - Face = 0 (frontmost), back-hair = -5 (farthest back), etc.
   - Seeds are all pixels inside each layer's alpha

3. **Solve Laplace for Z_layered** (§Sýkora 2010 §3.2):
   - `∇²d = 0`
   - Dirichlet: seed pixels fixed at layer integer depth
   - Neumann: at real contour pixels (where two layers' alphas abut)
   - Jacobi iteration, ~100 iters converges

4. **Solve per-region Poisson for Z_inflation** (§Ink-and-Ray §4.4):
   - For each tag: `−∇²f = c_tag` on that tag's alpha mask
   - `f = 0` on alpha boundary (Dirichlet)
   - Optional `√f` post-process for hemispherical vs parabolic profile
   - `c_tag` is the puffiness parameter (one scalar per tag)

5. **Sum:** `Z(pixel) = Z_layered(pixel) + α · Z_inflation(pixel)`
   where `α` controls global parallax intensity.

6. **Feed Z into parallax deformation:**
   - Horizontal shift under ParamAngleY ∝ `Z(pixel) × sin(angle)`
   - Vertical shift under ParamAngleX ∝ `Z(pixel) × sin(angle) × cos(angle)`
     (depth along Y-axis of rotation doesn't shift X, depth along X-axis
     does shift Y — standard 3D rotation decomposition)
   - Keeps our existing FaceParallax / body warp chain, replaces the
     hand-tuned cylindrical/ellipsoidal dome with a principled per-pixel
     depth field

### Implementation cost estimate

- **Laplace solver:** ~50 lines of JavaScript (Jacobi iteration on
  Uint8Array with fixed-point depth values). ~100ms for 1024×1024.
- **Poisson solver:** same kernel, different RHS term. ~50 lines.
- **Mask extraction + Dirichlet/Neumann classification:** builds on
  existing `bodyAnalyzer.js` infrastructure. ~200 lines.
- **Integration into `cmo3writer.js`:** replace the hand-coded
  FaceParallax dome with the sampled Z field. ~100 lines modified.

**Total: ~1-2 days** for a working prototype. A/B test against current
cylindrical dome. Ship if visibly better on girl/waifu/shelby.

### Validation via Depth Anything V2

Optional but useful: run DAV2 on girl.png/waifu.png/shelby.png composite
images. Visualize its depth output alongside our analytical Z field. Use
it as an independent "second opinion":
- If DAV2 agrees with our Z field qualitatively → we're on the right
  track
- If DAV2 produces wildly different depth (e.g., thinks the background
  is foreground because of stylized coloring) → sanity check, DAV2 is
  unreliable on cartoons
- If they diverge in specific ways → investigate whether PSD-based
  layering missed something or DAV2 hallucinated

One-time setup. Keeps the validation in our dev loop without adding
runtime dependencies.

---

## Revised action priority (post-Round 2)

1. **Current work first**: finish Step 2A visual test + Step 2B (per-row
   spine pivot). Don't delay shipping the measured feet-pin + pivot fix
   for a bigger rewrite.

2. **Ship Step 3 as Combined Depth Pipeline** (replaces earlier
   "Poisson dome" in old SYNTHESIS). Once Step 2A/B ship, prototype the
   combined Laplace + Poisson approach as a feature flag. If visibly
   better on test characters, ship and delete the old FP_ constants /
   cylindrical dome logic.

3. **Side improvement: closest-bone fallback** from Smith 2023 §3.4.
   Independent of depth work; do any time.

4. **Dev tooling (optional):** set up DAV2 local inference for sanity
   checking. One-time, accelerates Step 3 validation.

5. **Everything else deferred.** Subsequent Sýkora papers (TexToons
   2011) didn't add algorithmic content beyond what Ink-and-Ray 2014
   includes. Monster Mash's ARAP-L is inapplicable. Smith 2025's
   projection plane optimization is inapplicable. Rivers' multi-view
   is inapplicable.

## What we've now definitively established

- **We are solving a narrower problem than all eight papers.** Tagged
  PSD layers + single view + deterministic Cubism output = our input
  constraints are cleaner than any paper we read.
- **The Sýkora group lineage (2010 → 2014) is our best source.** Johnston
  2002 is the grandparent, Smith papers are downstream amateur-friendly
  variants, Rivers is multi-view outlier, Monster Mash is 3D-mesh outlier.
  The core depth-field methodology is the Sýkora-lineage Laplace/Poisson
  PDE solution.
- **ML depth estimation is out of scope as runtime tool** but potentially
  useful as dev validation.
- **Our architecture (tagged layers + Cubism keyform export) is
  appropriate** — no paper suggests a different decomposition would be
  strictly better for our goals.
