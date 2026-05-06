# Research Study Notes

Per-paper notes as we read. Structure for each entry:

- **Source:** link to REFERENCES.md entry
- **Read date + depth:** full / skimmed / abstract-only
- **What the paper actually does:** 1-2 paragraphs, in our own words
- **Concrete ideas we can steal:** bullet list, each with a file/function
  reference in our codebase where it could apply
- **What NOT to adopt and why:** explicit rejects (protect future-us from
  re-evaluating)
- **Open questions / follow-up refs**

Keep summaries grounded in what we actually read, not paper-abstract paraphrases.
When a claim is from an abstract/summary rather than main text, flag with 🟡.
When we verified by reading the section ourselves, mark with ✅.

---

## #1 — Smith et al. 2023 — A Method for Animating Children's Drawings

- **Source:** REFERENCES #1
- **Read date + depth:** 2026-04-20, full read (15 pages)
- **PDF:** `reference/papers/smith2023-children-drawings.pdf`

### What it actually does ✅

Input: a single in-the-wild photograph of a child's drawing (pen, crayon, etc.
on paper). Output: a retargeted animation (character moves via mocap data).
Four-stage pipeline:

1. **Figure detection** — fine-tuned Mask R-CNN (ResNet-50 + FPN) finds a
   bounding box around the human figure in the photo.
2. **Segmentation** — classical image processing (adaptive threshold →
   morphological closing+dilation → flood fill → retain largest polygon),
   NOT neural. Authors report 42.4% full-auto success, explicitly saying the
   image-processing approach beats Mask R-CNN masks for this use case because
   the downstream mesh needs a single tightly-fitting polygon with no holes.
3. **Pose estimation** — custom ResNet-50 + heatmap head for 2D joint
   positions (shoulders, elbows, wrists, hips, knees, ankles, nose).
4. **Rig + animation** —
   - Delaunay triangulation of the mask → textured mesh
   - Skeleton built from joint predictions (root = hip midpoint, chest =
     shoulder midpoint)
   - **Each triangle assigned to one of 9 body parts** (L/R upper/lower arm,
     L/R upper/lower leg, trunk) via *closest bone to centroid* heuristic —
     used for front/back render ordering
   - Reposing via As-Rigid-As-Possible (ARAP) mesh deformation driven by joint
     handles
   - Motion retargeting: project 3D mocap to a 2D plane, rotate character
     bones to match global orientations within the plane

**Deliberate design choices:**
- **No foreshortening** (bones stay at drawn length) — children's drawings
  rarely depict foreshortening
- **Twisted-perspective retargeting** — project lower limbs onto sagittal
  plane, upper body onto frontal plane, independently. Chosen automatically
  via PCA of each limb-set's point cloud. User study: 16/20 tested
  combinations significantly preferred twisted perspective.

### Concrete ideas we can steal

1. **Closest-bone-to-centroid for mesh→part auto-classification.** If a user's
   PSD has untagged meshes, we could fall back to proximity-based auto-tagging
   using the canonical body keypoints we already derive (neck, shoulders, hips,
   etc. from `armatureOrganizer.js:116`). Applicable in `psdOrganizer.js` as a
   last-resort heuristic when `matchTag()` returns null.
   - *Our current code:* `src/io/psdOrganizer.js:matchTag()` gives up on unmatched names.
   - *Smith's approach:* every triangle finds its closest bone, always assigns.

2. **Segmentation-free architectural advantage.** Smith spends half the paper
   on segmentation pain. Our PSD-alpha approach (P12 + bodyAnalyzer) entirely
   sidesteps this class of problem because we get per-layer clean alpha for
   free. Worth documenting as a *deliberate* architectural decision in
   `AUTO_RIG_PLAN.md` — we're not "missing segmentation", we *have* it by
   construction.

3. **Body part layering for depth illusion.** Their key insight: the *only*
   real depth cue needed is **render ordering** (which arm is in front of the
   torso). Cubism's draw order already does this; no need to add actual 3D
   depth for limbs. This validates our current approach.

4. **Principled release: public demo + dataset as validation corpus.** They
   have 178K in-the-wild drawings with bboxes, masks, joint annotations. If we
   ever want to stress-test auto-rig robustness across thousands of characters,
   this dataset is a candidate — but only relevant if we take on their
   segmentation problem (we don't).

### What NOT to adopt and why

1. **Neural detection/segmentation/pose estimation.** Overkill. We have tagged
   PSD layers with clean alpha — the entire motivation for their ML pipeline
   (messy in-the-wild photos) doesn't apply. Adding ML dependencies for
   something we already get for free would be a strict regression.

2. **ARAP mesh deformation.** Cubism does its own mesh interpolation between
   keyforms via native bilinear (warps) and per-vertex (CArtMeshForm)
   deformers. Running our own ARAP on top would conflict, not compose.

3. **Twisted perspective retargeting.** Their target characters are children's
   drawings that ALREADY have non-uniform perspective baked in. Our target
   characters (girl/waifu/shelby) are drawn with consistent perspective. Adding
   twisted-perspective retargeting would *introduce* distortion where none
   exists. Reject for our art style.
   - *Flag for future:* if someone imports a stylized/amateur PSD where the
     arms are drawn facing the viewer but legs are drawn in profile, revisit.

4. **Motion capture retargeting as animation driver.** We don't drive the rig
   with mocap. We export a param-driven Cubism model that gets driven by
   tracker input (VTube Studio, webcam, etc.). Entirely different direction.

### Open questions / follow-up

- **Cross-reference #3:** They cite Rivers 2010 "2.5D Cartoon Models" as peer
  work in §2.2. Rivers is our next read — they frame it as amateur-friendly
  authoring, distinct from their auto-animate goal.
- **Monster Mash** (Dvorožňák, Sýkora et al. 2020) — cited as "intuitive
  single-view 3D modeling and animation". Might be worth adding to
  REFERENCES.md as #5.5 given Sýkora overlap with #5.
- **Fan et al. "Tooncap" 2018** — cited as inverse problem (capturing a pose
  of a known cartoon character given layered image + handles). Potentially
  relevant to our "input is PSD with known layer structure" setup.
- **Open question for us:** would running a pre-trained pose estimator on the
  PSD *composite* (girl.png etc.) give us reliable joint positions we could
  use to derive hip/shoulder/knee anchors? Smith releases fine-tuned model
  weights. This would be a heavy dependency but could replace our fragile
  `widestCoreY` heuristic for characters like Shelby.

### Relevance rating

**High — but almost entirely in terms of architectural framing and what
NOT to do.** Smith 2023 is an ML-heavy pipeline that solves a *harder*
input problem (photograph instead of layered PSD) and a *different* output
problem (video animation instead of rig file). Where it lines up with us,
they validate design decisions we already made (layer-based render order,
tag-based mesh-to-part assignment). Where it diverges, it's because our
input is easier — we get to skip the hardest stages.

Main actionable takeaways: (a) consider closest-bone fallback for untagged
meshes, (b) document the segmentation-free architectural choice explicitly,
(c) add Monster Mash + Tooncap to REFERENCES.md.

---

## #2 — Smith, He, Ye 2025 — Animating Childlike Drawings with 2.5D Character Rigs

- **Source:** REFERENCES #2
- **Read date + depth:** 2026-04-20, full read (10 pages, ACM ToG submission)
- **PDF:** `reference/papers/smith2025-25d-character-rigs.pdf`

### What it actually does ✅

Input: a single childlike figure drawing plus **user-provided high-level
annotations** (split figure into silhouette segments + mark internal part
regions with attributes). Output: a 2.5D character model that can be driven
by any 3D skeletal motion and viewed from arbitrary camera angles in real
time. Specifically designed for mixed-reality applications (VR/AR).

**Annotation vocabulary** (user provides):
- **Silhouette segments** — vertical splits of the figure mask (hair, head,
  torso) each labeled with orientation: left / right / none.
- **Internal part regions** — eyes, nose, mouth, etc. Each gets five attributes:
  Mask (pixels), Translate (static/smooth/discrete), Direction (left/right/none),
  Enclosed (hide when outside parent), HideOnBack (hide on back view).
- **Feet annotation** — per-foot left/right/missing.

**The 2.5D model construction:**
- Horizontally mirror all "right-facing" parts to produce a **left view**
  (entire hierarchy mirrored). Analogous **right view** built.
- Each view has up to 8 unique textured meshes (4 foot-orientation variants
  × 2 textures front/back).
- Textures synthesized via **image inpainting** (to fill holes when parts
  translate away).
- Meshes generated via marching squares contour → constrained Delaunay.
- Each translating part region stores a pair of **keyview-transforms**
  (3×3 affine per view) — anchor point defined by part's mask + direction.

**View-dependent retargeting (the novel system):**
- Define **view angle θ** = angle between camera→character root vector and
  character's forward vector.
- Pick left view when θ∈[0,π], right view when θ∈[π,2π).
- Retarget each 3D skeletal joint: project to character's 2D plane, rotate
  corresponding 2D character joint to match global orientation. Bone lengths
  preserved (no foreshortening — childlike drawing convention).
- When character faces camera's back, swap left/right limb mapping to "turn
  180°" (keeps pose recognizable).
- Feet excluded from retargeting — pose determined by knee direction.
- **Render order:** explicitly ordered by depth of each joint's 3D projection
  (farthest-to-nearest). Depth-culling insufficient since character is a 2D plane.

**Novel contribution — Projection Plane Optimization (§4.3.4):**

When projecting 3D skeletal motion to a 2D plane, two artifacts:
- **Flailing** — when 3D joint points near plane normal, tiny 3D movement →
  huge 2D angle change (singularity at the projection pole).
- **Dampening** — when 3D movement is purely along projection axis, 2D
  doesn't change at all.

Math: 2D angle α = atan2(Py, Px), Jacobian blows up as P→0. Their fix: choose
projection plane normal **n** per-limb to minimize a cost function on the unit
sphere:

```
min_n  (1 − |vᵤ·vₗ|/(‖vᵤ‖‖vₗ‖)) · exp(-d_xt(n,vᵤ,vₗ)²/(2σ₁²))
     + exp(-d_gc(n,v_c)²/(2σ₂²))
     + exp(-d_gc(n,v_p)²/(2σ₃²))
```

where vᵤ, vₗ are upper/lower limb vectors, v_c is character plane normal,
v_p is previous frame's n (temporal consistency), d_xt is cross-track
distance from n to great circle formed by vᵤvₗ, d_gc is spherical distance.

Net effect: n aligns with limb rotation axis (avoids flailing), stays near
character plane (recognizable), varies smoothly over time. Replaces the
manual upper/lower-body PCA split of Smith 2023.

### Concrete ideas we can steal

1. **Part-region attribute vocabulary inspires our warp attributes.** Their
   five attributes (Mask/Translate/Direction/Enclosed/HideOnBack) are a clean
   enumeration of "how does this part behave under orientation change". In our
   code, RIG_WARP_TAGS just maps tag→grid size. We could consider adding a
   per-tag behavior struct: `translates: boolean, hideOnBack: boolean`, etc.
   Not urgent — most of our target characters don't need back views.

2. **Render order from body part depth under rotation** — their "project 3D
   joint to depth, render farthest→nearest" is the general form of what
   Cubism does via draw-order parameters. If we ever add a `ParamAngleY`-
   driven back-view variant, we'd want this logic.

3. **Left-right limb mirroring when facing away.** At large |ParamAngleY|
   (near ±30° or whatever the Cubism convention), a character's L arm should
   visually become their R arm. We currently don't do this. For characters
   where the "back" is rarely visible (all our current test cases), this
   doesn't matter. Flag for future if we ever add significant back-view
   rotation.

### Ideas to note but NOT adopt

1. **Projection plane optimization (§4.3.4).** *Genuinely novel math,*
   but it only applies when you're projecting 3D mocap → 2D pose. We don't
   do this — our input is 2D params from a tracker (VTube Studio, etc.) that
   already live in the 2D drawing plane. No flailing/dampening in our pipeline.
   Archive as "interesting but inapplicable".

2. **Left view + right view (mirrored hierarchy).** Our target characters
   are asymmetric-by-design (hair parted one way, eye highlights on one side,
   etc.). Mirroring would create ghastly artifacts. Only applicable for
   symmetric/stylized drawings.

3. **User annotation UI.** They require a user to explicitly annotate
   silhouette splits + part attributes per-character. We have that info for
   free from PSD layer tags — architectural advantage, don't give it up.

4. **ARAP mesh deformation.** Same rejection as Smith 2023.

5. **Image inpainting for back-texture generation.** We don't synthesize
   back views — user would provide them as separate PSD layers if wanted.

### Open questions / follow-up

- **Delta from Smith 2023 summary:** 2023 = single-view 2D animation from
  photo; 2025 = true 2.5D with left+right views + 3D camera handling,
  user-annotated (not ML-inferred). Different end goal (XR/VR vs 2D video).
- **Cross-reference #3:** They cite Rivers 2010 in §2.1 as the originator
  of 2.5D cartoon models concept. Our next read.
- **"Monster Mash" cited again (§2.2)** — confirming that's a worthy add.

### Relevance rating

**Low-medium.** Beyond reinforcing our architectural choices, only two
small influences:
- Attribute vocabulary for per-tag behavior (if we expand RIG_WARP_TAGS).
- Left/right limb swap awareness at extreme Y rotation (future only).

Their core novel algorithm (projection plane optimization) doesn't apply to
our pipeline. Their 2.5D model structure (left/right views) would damage
asymmetric drawn characters. The real intellectual line is Rivers 2010 → our
architecture; Smith 2025 is a downstream refinement of Rivers for a specific
user (childlike drawings + XR deployment).

**Priority adjustment:** Rivers 2010 now clearly the next must-read —
it's the origin of the "2.5D cartoon model" concept that both Smith papers
build on.

---

## #3 — Rivers, Igarashi, Durand 2010 — 2.5D Cartoon Models

- **Source:** REFERENCES #3
- **Read date + depth:** 2026-04-20, full read (7 pages SIGGRAPH 2010)
- **PDF:** `reference/papers/rivers2010.pdf` (via Igarashi's Tokyo mirror —
  MIT DSpace and Alec Rivers' site both rejected automated fetch)

### What it actually does ✅

**Input:** multiple (typically 3–4) hand-drawn 2D vector art views of a
cartoon (e.g. front, side, top).
**Output:** a *2.5D cartoon model* — each stroke has a single 3D anchor
position and a set of key views. The model can then be rendered from any
arbitrary yaw/pitch by interpolating.

**Core structure:** each stroke = "a billboard in 3D space" with:
- A 3D anchor position (auto-inferred from ≥2 drawn key views via
  triangulation-style reasoning — paper doesn't fully detail the formula
  in sections I read, but it's standard multi-view inference)
- A set of **key views** at known (yaw, pitch) coordinates, drawn manually
- Optional **Z-ordering overrides** per view-range (tool: "overlap tool" —
  artist draws a polygon on the view-angle control grid to specify A>B for
  that range of views)
- Optional **visibility overrides** per view-range
- Optional **Boolean operations** (A∩B, A∪B) for constructing concave shapes
  from simple primitives

**Interpolation algorithm (Section 3 core realization):**

> "A stroke's shape changes in complex ways when viewed as the shifting
> contour of a 3D object, but can be approximated well by simple 2D
> interpolation. Meanwhile, strokes' positions and Z-ordering are
> essentially 3D properties... these challenges can be separated."

Decomposition:
- **Shape** (the stroke's 2D geometry) → 2D vector interpolation across
  nearest key views in yaw/pitch space. Uses simple linear methods (not ARAP).
- **Position** (where the stroke's anchor lands on screen) → rotate the
  inferred 3D anchor in 3D, project to screen.
- **Z-ordering** → depth of projected anchor, with artist overrides.

**Derived key views (§5.3):** exploit symmetries to reduce manual drawing.
- Front view flipped horizontally = back view (for silhouettes)
- Pitch = ±π/2 views are rotationally equivalent
- Vertically-symmetric strokes: right-facing view flipped = left-facing view

Typical cartoon (~20 strokes): artist draws only 3–4 views, ~3.2–3.8 key
views per stroke on average (Table 1).

**Explicit limitations the paper names:**
- Highly concave shapes interpolate poorly (Figure 5: hair popping)
- Partial occlusion (cloth wrapping around body) not supported — strokes
  are treated as independent billboards
- Sharp shapes interpolate poorly at intermediate views
- Popping artifacts at Z-ordering switches

### Concrete ideas we can steal

1. **Core framing: "separate 3D concerns from 2D shape concerns."** This is
   the architectural principle behind our current Cubism export:
   - Cubism keyforms (= Rivers key views) store the 2D deformed shape
   - Draw order / render layer (= Rivers Z-ordering) is handled separately
   - Parameter-driven interpolation (= Rivers' yaw/pitch parameterization)
   handles the blending

   Our architecture aligns — validation of the implicit design. Worth
   citing this paper in `AUTO_RIG_PLAN.md` as the conceptual parent.

2. **Per-mesh 3D anchor as depth proxy.** Rivers assigns each stroke a 3D
   position; Z-order derives from it. For us: we could assign a canonical
   Z-depth per tag (face=0, hair-front=+0.1, hair-back=-0.5, ears=-0.05,
   etc.) and use this to:
   - Modulate horizontal shift magnitude under ParamAngleY (parts further
     back move more opposite the rotation direction — standard parallax)
   - Drive draw-order swaps at extreme Y rotation (Cubism's DrawOrder
     parameter bindings already support this)

   Currently our FaceParallax uses a cylindrical dome based on U only (the
   canvas X coordinate). A per-mesh Z-anchor is finer-grained and could
   replace the dome with a truly per-part depth model — exactly in the
   spirit of Rivers. Candidate future work.

3. **Z-order override per view range.** Rivers' "overlap tool" (A>B for a
   polygon in yaw/pitch space) maps directly onto Cubism's parameter-bound
   DrawOrder. We don't currently generate draw-order keyforms in our auto-
   rig. If two meshes' relative depth SHOULD swap at θ > 30° (e.g. an ear
   should go behind the head at extreme yaw), Cubism supports this
   natively — we just need to emit the keyform. Future enhancement.

4. **Derived views from symmetry — but not as they do it.** They use symmetry
   to reduce artist workload (draw 1 view, get 2). For us, we have no artist
   for secondary views. But the *principle* — that mirror symmetries reduce
   the space of "what you need to specify" — aligns with our observation
   that left/right warp keyforms of a character are often mirrors of each
   other (eyes, arms, etc.). Already implicit in our export; not a new idea.

### Ideas to note but NOT adopt

1. **Multi-view drawing workflow.** Fundamentally incompatible — we have
   one PSD, not 3–4 hand-drawn views. Their 3D anchor inference requires
   multi-view triangulation and can't run with a single view. We'd have to
   *invent* Z-depths (heuristic or measured) rather than infer them.

2. **Stroke-level primitives.** Rivers works at the level of individual
   vector art strokes; we work at the level of tagged PSD layers (each
   containing potentially hundreds of strokes baked into raster). The
   finer granularity opens options they have (Boolean combinations, per-
   stroke animation) that we can't use.

3. **Overlap tool as user-facing feature.** Would be a massive new UI
   surface for debatable gain. If we need per-angle draw order swaps, we
   derive them from heuristics (e.g. far-side ear goes behind head when
   |θ_y| > threshold).

### Open questions / follow-up

- **How do they infer 3D anchor positions?** Paper sections I read say it's
  automatic but don't show the formula. Almost certainly standard multi-
  view triangulation given 2+ key-view screen positions + known yaw/pitch.
  Not critical for us because we don't have multi-view input.

- **Their hair failure case is our hair concern.** Figure 5 hair pop-out
  at an intermediate view is exactly the failure we'd see on anime-style
  hair if we tried to rotate it via a single warp. Our RIG_WARP_TAGS
  explicitly splits "front hair" vs "back hair" to sidestep this. Good
  implicit alignment with paper's recommendations.

- **Cross-reference:** Rivers cites Sýkora 2010 "Adding Depth to Cartoons
  Using Sparse Depth (In)equalities" — a method for specifying cartoon
  depth with minimal user input. Worth adding to REFERENCES (different
  Sýkora paper than Ink-and-Ray 2014). Could be more directly applicable
  to our single-view case than full 2.5D Cartoon Models.

### Relevance rating

**Medium.** The paper's *mental model* is valuable — naming our implicit
architecture (billboards in 3D, separated concerns, Z from anchor depth)
and validating it against prior art. But no transferable formulas: their
algorithm requires multi-view input we don't have, and their per-stroke
granularity is finer than our per-layer setup.

Biggest single actionable idea: **per-tag Z-depth anchor** as a replacement
for our cylindrical dome in FaceParallax. This would be a principled
reformulation of Session 20 P10 work, and would naturally extend to body
parallax (ears/hair/etc. moving with different depth cues). Candidate for
**Step 3** of our current body refactor if Step 2A/B visual tests show
that per-row spine + feet-pin alone aren't enough.

**Sýkora 2010 "Sparse Depth Inequalities" (cited by Rivers) may actually
be more directly applicable to us than 2.5D Cartoon Models** — flag for
potential add to REFERENCES list.

---

## #4 — Johnston 2002 — Lumo: Illumination for Cel Animation

- **Source:** REFERENCES #4
- **Read date + depth:** 2026-04-20, full read (9 pages NPAR 2002)
- **PDF:** `reference/papers/johnston2002-lumo.pdf` (SFU mirror worked, 18MB)

### Important correction ⚠️

**My earlier claim that Lumo contains a "sinus blob formula proportional to
local 2D width" was inaccurate.** The paper does NOT use `sin(π × u)` or any
explicit trigonometric height formula. The actual technique is different —
see below. I was pattern-matching a search-result summary to our cylindrical
dome code; the underlying idea is related but the math is not the same.

### What it actually does ✅

**Target problem:** approximate per-pixel 3D surface normals on a 2D hand-
drawn cel, so that photorealistic lighting can be applied to cel animation
when compositing with live-action scenes.

**Core algorithm — two normal sources combined:**

1. **Region-based normals ("blobbing", §2.1):** for a filled region:
   - Compute gradient of the alpha mask at its boundary
   - At edge pixels, set `N = (∇α, 0)` (normalized) — `Nz = 0` keeps the
     normal perpendicular to the eye vector, matching how silhouettes work
     in orthographic projection
   - Interpolate `(Nx, Ny)` **linearly across the interior** via sparse
     interpolation
   - Recompute `Nz` at each pixel so that `‖N‖ = 1`
   - Result: for a filled circle, this produces the normal field of a
     hemisphere. For arbitrary silhouettes, an implicit hemispherical
     bas-relief whose peak is wherever the region is locally widest

2. **Line-based normals ("quilting", §2.2):** compute gradients across
   interior ink lines (not the mask edge) → opposing normals on each side.
   More detail in the interior, but "quilted" appearance because both sides
   of every line show the fold.

3. **Over/Under assignment (§2.3):** the key contribution — artist tags each
   line with "over" (white) and "under" (black) markers. When interpolated,
   forms a **confidence matte** indicating where the quilted normal is
   trustworthy vs. where the blob normal should dominate.

4. **Blend (§2.5):** linear interpolation of `(Nx, Ny)` between blobby and
   quilted normals, weighted by confidence matte. Recompute `Nz`. Result
   = "bas-relief of the object".

**Z-scaling (§2.6.2, the only explicit formula in the paper we care about):**

To scale a region's "puffiness", replace normals with the normals of a
z-scaled sphere:

```
(Nx, Ny, Nz) → (S·Nx, S·Ny, Nz) / ‖(S·Nx, S·Ny, Nz)‖
```

For `S < 1`: shallower. For `S > 1`: deeper. Eq. (1) in the paper.

To adjust edge normal subtlety (perspective correction, §2.6.2):

```
(Nx, Ny) ← (Nx, Ny) × √(S(2-S)),  then renormalize Nz
```

Here `S` is the "slice thickness" of a visible unit-sphere portion.

**Sparse interpolation (§3):** they use a damped-spring diffuser:

```
V'[i,j] = d · V[i,j] + k · (P[i-1,j] + P[i+1,j] + P[i,j-1] + P[i,j+1] - 4·P[i,j])
P'[i,j] = P[i,j] + V'[i,j]
```

Iterate until convergence. Simple and robust.

### Concrete ideas we can steal

1. **Silhouette-derived depth dome (instead of cylindrical dome).** Our
   current FaceParallax uses a cylindrical dome: `z = √(1 - u²) × peak`
   where `u` is horizontal position relative to face bbox center
   (`cmo3writer.js` Session 20 P10). This assumes the face is a cylinder —
   shallow on the left-right extents, consistent peak along vertical axis.

   Lumo's blobbing gives us a principled alternative: derive Z from the
   actual face silhouette via gradient-at-edge + inward interpolation.
   Concretely:
   - Compute edge normals `(Nx, Ny)` from alpha gradient at face mask boundary
   - `Nz = 0` at boundary
   - Interpolate `(Nx, Ny)` inward (diffusion iterations)
   - Recover `Nz = √(1 - Nx² - Ny²)`
   - Use `Nz(pixel) × depth_amplitude` as the per-pixel depth for parallax
     shift

   This adapts naturally to face shape (more peak in rounder regions, less
   on narrow chin/jaw) instead of assuming a cylinder.

   **Where to hook in:** the `faceParallax` code path in `cmo3writer.js`
   around the cylindrical dome definition. We'd run the diffusion offline
   during export (similar cost to `bodyAnalyzer.js` — scan + diffuse a
   canvas-sized field a few tens of iterations).

2. **Z-scaling as principled tuning knob.** Their Eq. (1) `(S·Nx, S·Ny, Nz)
   normalize` is cleaner than our scattered `FP_DEPTH_K` / `FP_EDGE_DEPTH_K`
   constants. If we adopt silhouette-derived dome, we get `S` as the single
   depth-amplitude knob per region — less hand-tuning, more evidence-driven.

3. **Damped-spring diffusion (§3).** Simple linear operator for interpolating
   sparse values across a field. Useful for any "extend a boundary value
   inward smoothly" task. Could replace parts of our per-vertex shape work
   if we ever need smooth-field inpainting.

### Ideas to note but NOT adopt

1. **Over/under line tagging.** Requires artist annotation we don't have
   and aren't going to add. Our per-layer PSD structure already gives us
   depth ordering — we don't need the user to hand-tag "this line is over
   that line".

2. **Quilting for interior detail normals.** We don't do lighting. We don't
   need interior-line-derived detail. Our use case is depth-for-parallax,
   where a coarse per-region depth profile is enough.

3. **Drawn tone mattes (§2.6.4).** Another lighting-specific technique.
   N/A for us.

### Open questions / follow-up

- **Offline depth field as a new export artifact?** If we adopt silhouette-
  derived dome per-mesh, we'd compute it once during export and bake it
  into FaceParallax keyform deltas. No runtime cost.
- **Does it actually beat the cylindrical dome on real cases?** Likely yes
  for round faces, likely similar for long faces. Only measurable way to
  know: implement both and A/B visually on girl/waifu/shelby.
- **Compute cost:** for a 1024×1024 canvas with 50-iter damped-spring
  diffusion, roughly 50M pixel ops. ~100ms at worst. Fine for export.

### Relevance rating

**Medium-high — more useful than I originally claimed, but for a different
reason than I claimed.** The paper's target application (cel-animation
lighting) isn't ours. But its region-based normal approximation from
silhouette gradient + sparse interpolation is a **principled alternative
to our cylindrical dome heuristic** for Face Parallax depth.

Most actionable takeaway: **replace the hand-tuned cylindrical dome in
FaceParallax with a silhouette-derived hemispherical blob computed from
each face mesh's alpha mask.** This is a real engineering lead that maps
cleanly onto our existing bodyAnalyzer PNG-scanning infrastructure. Not
blocking — our current dome works acceptably per Session 20 testing — but
a candidate for **Step 3** of the body refactor if we decide to
generalize beyond the current body-specific fix.

**What did NOT pan out:** the specific "sinus blob" formula claim from the
original search-summary. The underlying technique is related (hemisphere-
shaped inflation from silhouette) but different in mechanism (gradient +
diffusion, not `sin(π × u)`).

---

## #5 — Sýkora et al. 2014 — Ink-and-Ray: Bas-Relief Meshes for Global Illumination

- **Source:** REFERENCES #5
- **Read date + depth:** 2026-04-20, sections 1–4 (pipeline + inflation +
  stitching) read carefully; rest skimmed
- **PDF:** `reference/papers/sykora2014-ink-and-ray.pdf`

### What it actually does ✅

Converts a hand-drawn 2D character into a **bas-relief mesh** — a shallow
3D proxy adequate for global-illumination rendering (self-shadowing, color
bleeding, glossy reflections). Inspired by the *bas-relief ambiguity*
[Belhumeur et al. 1999]: under orthographic projection and Lambertian
shading, absolute depth doesn't matter — relative order and local relief do.

**Pipeline (§3, six stages):**
1. **Segmentation** — partition input image into regions (LazyBrush etc.)
2. **Completion** — estimate occluded silhouettes via illusory-surface
   diffusion [Geiger et al. 1998, Orzan et al. 2008 diffusion curves]
3. **Layering** — infer relative depth order per region pair via illusory-
   surface area test; user corrects via inequality arrows
4. **Inflation** — solve **Poisson equation per region** (the core math)
5. **Stitching** — join inflated regions with depth constraints via
   quadratic programming
6. **Grafting** — C¹-continuous smoothing across joined boundaries

**The inflation formula (§4.4, Eq. 1–3):**

For region Ωᵢ, solve:

```
−∇²f̃ᵢ(x) = cᵢ         ∀x ∈ int(Ωᵢ)        (Poisson)
f̃ᵢ(x) = 0              ∀x ∈ BD              (Dirichlet: zero on boundary)
∂f̃ᵢ/∂n(x) = 0          ∀x ∈ BN              (Neumann: no boundary slope)
```

- `cᵢ > 0` is the **puffiness / inflation scalar**
- Solution is a smooth height field over Ωᵢ
- Default: BD over whole boundary → zero-height on edge; interior pulls up

**Profile shape:** default solution is **parabolic** (for a disk of radius
R: `f(r) = c(R²−r²)/4`). To get a **hemispherical** profile instead, apply
square-root post-processing:

```
fᵢ(x) = dᵢ · √f̃ᵢ(x)
```

where `dᵢ ∈ ℝ` scales per region.

**Explicit lineage to Lumo (paper cites it):**

> "A similar approach to inflation was previously used in TexToons
> [Sýkora et al. 2011]. Here normal interpolation (originally proposed in
> **Lumo** [Johnston 2002]) is reformulated based on solving a **Laplace
> equation**."

So the chain is: Johnston 2002 (damped-spring diffusion of edge normals)
→ TexToons 2011 (same as explicit Laplace) → Ink-and-Ray 2014 (Poisson
with constant RHS for principled parabolic inflation).

### Concrete ideas we can steal

1. **Poisson-solved silhouette dome.** This is the single most actionable
   idea across all five papers we've read. It *unifies* and *generalizes*
   our cylindrical dome heuristic:

   - Current `cmo3writer.js` FP logic: `z = √(1 − u²)` where u is
     horizontal position in face bbox — a **1D cylindrical hemisphere**
     varying only along X
   - Ink-and-Ray replacement: solve Poisson on the actual face/region
     alpha mask, optionally apply √ post-process → **2D hemispherical
     profile** varying correctly in both X and Y, adapted to the exact
     silhouette shape

   **Implementation:** build on existing `bodyAnalyzer.js` PNG-scanning
   infrastructure. Add a pass that runs Jacobi iteration on the mask until
   convergence. Output per-pixel Z field → sample at vertex positions →
   use as depth amplitude in FaceParallax warp deformation.

   **Math complexity:** Jacobi step is `f[i,j] = (f[i-1,j] + f[i+1,j] +
   f[i,j-1] + f[i,j+1] + c·h²) / 4` where h is pixel size. ~100 iterations
   for a 1024×1024 canvas converges in ~1 second. No external solver
   needed (no MOSEK, no linear algebra lib).

2. **Per-region `cᵢ` as a single puffiness knob.** Cleaner than our
   scattered FP_DEPTH_K, FP_EDGE_DEPTH_K, FP_BOW_X_FRAC, etc. One scalar
   per tag. Could live in a `TAG_INFLATION_C` map replacing the current
   depth constants.

3. **Parabolic vs hemispherical profile choice.** Default Poisson gives
   parabolic; √ post-process gives hemispherical. Both have different
   visual character — parabolic is softer in the middle, hemisphere
   sharper at edges (more "rolled over"). Exposing this as a per-tag
   toggle costs almost nothing.

4. **Neumann BC for flat regions.** Interesting feature: mark parts of a
   boundary as Neumann → surface stays flat at that edge (doesn't roll
   over). Useful for a shirt hem (shouldn't round) vs. a hair silhouette
   (should). Could be tag-driven in our pipeline.

### Ideas to note but NOT adopt

1. **Segmentation, completion, layering.** Our PSD layer tags give us
   regions explicitly, occlusion is already encoded (each layer has its
   own alpha), and depth order is the PSD stack order. Skip all three
   stages — they solve problems we don't have.

2. **Stitching with quadratic programming (MOSEK).** They use it to
   enforce that adjacent regions meet exactly at prescribed points with
   prescribed inequalities. Overkill for our use case: Cubism interpolates
   between layers via warp grids independently, and we don't render
   global illumination. Skip.

3. **Grafting / C¹ biharmonic smoothing.** Produces seamless arm-body
   transitions for rendering. We don't render — we emit Cubism keyforms.
   Cubism handles inter-layer transitions via parameter-driven blending
   of independent meshes. Skip.

4. **Absolute depth values + bas-relief mesh export.** We don't need a
   3D mesh. We need a per-pixel depth field used to modulate 2D
   deformation amplitudes. Much simpler.

### Open questions / follow-up

- **Does the Poisson dome beat cylindrical on our test cases?** Only
  testable by implementing. On a circular face: should be similar. On
  an elongated face (e.g. long jaw): Poisson correctly gives lower depth
  at the jaw's narrow part, where cylindrical says "full depth along Y
  axis regardless". Potential visible improvement on chin/jaw region
  under ParamAngleX.
- **Cross-reference discovered:** TexToons [Sýkora et al. 2011] is
  explicitly cited as the Laplace-equation intermediate between Lumo and
  Ink-and-Ray. Might be worth adding to REFERENCES as #5a if we want
  the simpler Laplace formulation.
- **Sýkora 2010 "Sparse Depth Inequalities"** (referenced in both Rivers
  and here) — flagged earlier. Could be the simplest principled depth
  framework for single-view input with minimal user annotation.

### Relevance rating

**High — this is our best concrete algorithmic lead from the research.**

The Poisson-equation inflation is a clean, well-tested, principled
alternative to our current hand-tuned dome heuristics. It's:
- **Computable** with Jacobi iteration on existing PNG alpha infrastructure
- **Generic** — same formula for face, body, any region
- **Parameterizable** with one knob per region (cᵢ)
- **Production-proven** — Disney Animation collaboration

Combined with Johnston's Lumo understanding (gradient + diffusion for
normals), this is the clearest answer to "what should our depth field
actually be". The two papers describe the same underlying idea with
Ink-and-Ray being the cleaner mathematical formulation.

Candidate as **Step 3** of the body refactor: replace cylindrical dome
with Poisson-solved silhouette dome, once Step 2A/B visual tests
validate the per-row spine / feet-pin approach.

---

# Round 2

Added after user feedback that Round 1 missed the most depth-centric
papers in the chain.

---

## #6 — Sýkora et al. 2010 — Adding Depth to Cartoons Using Sparse Depth (In)equalities

- **Source:** arXiv/DCGI preprint (EUROGRAPHICS 2010)
- **Read date + depth:** 2026-04-20, full read (9 pages)
- **PDF:** `reference/papers/sykora2010-sparse-depth-inequalities.pdf`

### What it actually does ✅

**The prequel to both Rivers 2010 and Ink-and-Ray 2014.** Introduces the
idea of *sparse depth (in)equalities* — the user specifies pairs of points
saying "A is in front of B" without needing absolute depth values, and the
system solves for a consistent depth field.

**Problem setup:** given an image 𝓘 with user-specified constraints
𝒰_= (equalities) and 𝒰_> (inequalities), find depth `d_p` per pixel that:
1. Honors all user constraints (`d_p − d_q = 0` or `≥ ε` per pair)
2. Minimizes energy `∑ w_pq (d_p − d_q)²` summed over 4-neighbors, weighted
   by image gradient (discontinuities allowed where intensity changes)

**Two formulations:**

1. **Exact quadratic program** (Eq. 2):
   ```
   min  (1/2) dᵀ L d
   s.t. constraint pairs as linear (in)equalities
   ```
   where `L` is the Laplace-Beltrami matrix. Solved via active set method
   (MOSEK or similar). **Tens of seconds** even for small images.

2. **Interactive approximation (§3.2):** decompose into:
   - **Multi-label segmentation** via LazyBrush [Sýkora et al. 2009]
   - **Topological sort** of inequality graph → absolute integer depths
     per region
   - **Laplace smoothing** with mixed boundary conditions to get continuous
     depth field:
     ```
     ∇²d = 0
     Dirichlet:  d_p = d̂_p       at seed pixels (U_∘)
     Neumann:    ∂d/∂n = 0        at real depth discontinuities (contour pixels, 𝓘_p = 0)
     ```
   - Fast GPU Laplace solver [Jeschke et al. 2009] → interactive feedback

**Depth expansion (§3.3):** contour pixels belong to neither region by
default. They extend depth into contours via medial-axis distance transform,
propagating each contour's adjacent region's depth outward by local line
thickness.

### How this compares to what we read already

| | Lumo 2002 | Sparse Depth (In)equalities 2010 | Ink-and-Ray 2014 |
|--|--|--|--|
| **Question answered** | "what are the surface normals?" | "how do regions order + smoothly transition?" | "what's the 3D shape?" |
| **Equation** | Damped-spring diffusion of normals | **Laplace ∇²d=0** with mixed BC | **Poisson ∇²f=c** per region |
| **User input** | Over/under line tags | Sparse inequality arrows | Region seeds + depth arrows |
| **Output** | Per-pixel normal field | Per-pixel depth field (layered) | Per-region height field (inflated) |
| **Gives inflation?** | Yes (implicit, via normal integration) | **No — flat layers only** | **Yes — explicit puffiness** |

**Critical insight:** Sýkora 2010's approach produces FLAT layered depth —
each region gets one depth value, smoothly interpolated across virtual
gaps but sharp at real contours. **No per-region "puffiness" or dome
shape.** You can add that separately via Lumo/Ink-and-Ray inflation.

Ink-and-Ray evolved from Sparse Depth Inequalities by adding per-region
Poisson inflation on top of the layered depth ordering.

### Concrete ideas we can steal

1. **Laplace with mixed Dirichlet/Neumann for inter-layer depth field.**
   Our PSD layer stack tells us the depth ORDER of regions. If we want a
   continuous per-pixel depth field that respects this order:
   - Assign each layer an integer depth from its PSD position (layer index)
   - Use these as Dirichlet seeds inside each layer's alpha
   - Use Neumann BC at real contour pixels (where another layer's alpha
     boundary meets this one) — preserves the sharp "step" where one layer
     ends and another begins
   - Solve `∇²d = 0` via Jacobi iteration

   Result: smooth depth transitions in regions where layers touch virtually
   (no contour), sharp jumps where they touch physically. **This gives us
   the same depth-field benefits Ink-and-Ray gets from layering + stitching,
   but without needing MOSEK / QP solver.**

2. **Don't need quadratic programming.** The "exact QP" formulation in §3
   of this paper is the heavy way. The §3.2 approximate pipeline (segment
   → topological sort → Laplace smoothing) gives visually similar results
   at 10-100× speed. We can apply the same simplification: use PSD tags
   for segmentation, PSD draw order for depth, Laplace for smoothing. No
   need for user inequality arrows — we have layer stack.

3. **Neumann BC at real contours.** Same insight as Ink-and-Ray §4.4, but
   arrived at earlier (2010). Confirms this is the standard way to preserve
   sharp depth discontinuities at drawn outlines.

### Ideas to note but NOT adopt

1. **LazyBrush segmentation.** We have PSD tags. Skip.
2. **User-drawn inequality arrows.** We have PSD layer order. Skip.
3. **Topological sort over inequality graph.** Replaced by PSD stack order. Skip.
4. **Depth expansion into contour pixels (§3.3).** Our layer alphas
   already cover all meaningful pixels per layer. Contours are part of
   the layer. N/A.
5. **GPU solver.** Overkill for our offline export step; simple Jacobi
   on CPU is fine.

### Relevance rating

**High — this is the "missing link" between our tagged-PSD input and
Ink-and-Ray's per-region inflation.** The algorithmic sequence becomes:
1. **Sparse Depth Inequalities 2010** logic: Laplace-smoothed inter-layer
   depth field from PSD stack (replaces need for user-drawn arrows —
   layer stack is our input)
2. **Ink-and-Ray 2014** logic: Poisson-solved per-region puffiness on top
3. **Sum them:** `Z_total(p) = Z_inter(p) + Z_intra(p)`

This is the **combined best-of-both** pipeline the user asked about. One
coherent story: Sýkora group's 4-paper lineage (2010 → 2011 TexToons →
2014 Ink-and-Ray, with Johnston 2002 as grandparent) reaches its logical
endpoint when applied to our constraints.

---

## #7 — Dvorožňák et al. 2020 — Monster Mash (skim)

- **Source:** SIGGRAPH Asia 2020
- **Read date + depth:** 2026-04-20, skimmed (intro, related work,
  pipeline overview — ~4 pages of 12)
- **PDF:** `reference/papers/monstermash2020.pdf`
- **Open-source code:** [github.com/google/monster-mash](https://github.com/google/monster-mash)
- **Live demo:** [monstermash.zone](https://monstermash.zone)

### What it actually does ✅

Converts a hand-drawn sketch into a **single unified 3D mesh** that can be
animated via ARAP-L (Layered ARAP — their novel deformation model with
depth-ordering constraints).

**Pipeline:**
1. User draws strokes, tags each with "in front of" / "behind" / "symmetric"
2. Parts merged via joint inflation (extending Dvorožňák 2018)
3. ARAP-L deformation for real-time animation with depth constraints

**Critical architectural note:** Monster Mash extends Dvorožňák et al.
2018, which does **joint inflation** across the whole model rather than
per-part inflation + merging. This sidesteps artifacts at merge boundaries
that per-part approaches (e.g., Ink-and-Ray §4.5 stitching phase) have to
fix up with extra machinery.

### Concrete ideas we can steal

1. **Joint inflation concept.** If we go Poisson-dome route, consider
   solving Poisson over the WHOLE character alpha (union of all tag masks)
   with per-region depth offsets as Dirichlet boundary conditions at tag
   boundaries. May give smoother inter-region transitions than per-region
   + stitching. Experimental — not clear it beats per-region Poisson in
   our use case.

2. **Existence of open-source reference implementation.** Google has
   released Monster Mash code under Apache 2 (github.com/google/monster-mash).
   If we want to validate our Poisson solver against a known-good
   implementation, we can steal algorithmic details from their source.

### Ideas to note but NOT adopt

1. **ARAP-L deformation.** Same rejection as Smith 2023/2025 and original
   ARAP. Conflicts with Cubism native warp interpolation.

2. **Depth-ordering constraints during animation.** Monster Mash solves
   these to prevent inter-penetration when animating. Our Cubism export
   emits static keyforms + draw-order bindings; runtime inter-penetration
   is Cubism's problem, not ours.

3. **User-drawn strokes + symmetric tagging.** Our input is PSD layers,
   not sketches.

### Relevance rating

**Low-medium.** Monster Mash is downstream of Ink-and-Ray / Sparse Depth
Inequalities in the Sýkora lineage, with a Google/animation angle. Its
innovations (ARAP-L, joint inflation + real-time animation) don't transfer
to our Cubism pipeline. But the open-source code is a potential reference
implementation if we need to sanity-check our own Poisson solver.

---

## #8 — Yang et al. 2024 — Depth Anything V2 (abstract + method overview)

- **Source:** NeurIPS 2024
- **Read date + depth:** 2026-04-20, abstract + §1 intro + §7 results
- **PDF:** `reference/papers/depth-anything-v2.pdf`
- **Open-source:** [github.com/DepthAnything/Depth-Anything-V2](https://github.com/DepthAnything/Depth-Anything-V2)
- **Project page:** [depth-anything-v2.github.io](https://depth-anything-v2.github.io/)

### What it actually does ✅

Foundation model for monocular depth estimation — takes ANY single image,
returns a per-pixel depth map. Neural network (ViT-based), trained on
synthetic images + 62M pseudo-labeled real images.

**Performance:** ViT-S (25M params) runs at 60ms on V100 GPU; ViT-L
(335M params) at 213ms. Weights freely available.

**Compared to alternatives:** Marigold (SD-based) is slower (~5s per
image) but sometimes sharper at fine detail; Depth Anything V2 claims
both strengths combined — fast AND detailed.

### Concrete ideas — two potential uses for us

**Use A: Stress-test / validation tool during development.**
Run DAV2 on girl.png, waifu.png, shelby.png composite images. Compare
the produced depth map against our Poisson-Laplace hybrid. Where they
agree → confidence. Where they disagree → investigate whether our
tag-stack heuristic or DAV2's neural inference is right.

- Cost: install PyTorch locally, run model, compare visualizations.
  One-time setup for our dev loop, not production.

**Use B: Runtime as alternative depth source (NOT recommended).**
Replace our Poisson-Laplace pipeline with DAV2 inference at export time.

- Cost: 335M (ViT-L) or 25M (ViT-S) model in `reference/` or similar,
  +PyTorch/ONNX runtime dependency.
- Pro: zero hand-tuning, zero per-tag input needed.
- Con: ML dependency in a web-based tool is heavy. Model outputs are
  trained on natural photos — **no guarantee it produces sensible depth
  on stylized cartoon characters** (anime waifu, western realistic, etc.).
  Black box we can't debug.
- **Verdict: Skip as runtime source.** Our input has enough structure
  (tagged layers) to compute depth analytically. Keep for stress-testing
  only.

### Ideas to note but NOT adopt

1. **Runtime ML for depth.** Not worth the dependency.
2. **Fine-tuning on cartoon depth.** Way out of scope.
3. **Distillation/teacher-student training.** Irrelevant to us.

### Relevance rating

**Low for direct adoption, medium for validation.** Our deterministic
Poisson-Laplace hybrid is the right fit for our pipeline. DAV2 is a
useful reference tool during development to check our output is sane,
but deploying it as part of Cubism export would be over-engineering.



