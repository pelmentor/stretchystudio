# Session 23 Findings — Face Parallax Deep Iteration + Cross-Style Auto-Rig

**Date:** 2026-04-20
**Scope:** Face parallax refactoring, See-Through depth PSD integration,
geometric depth fallback, body warp improvements, iris clipping mask,
export UX. Testing across three character styles (waifu/girl/shelby).
**Status at session end:** Core infrastructure shipped; face parallax still
inflection-pointing — needs Phase A pre-symmetrization approach tomorrow.

---

## 1. High-level narrative

Started from post-Session-22 state: auto-rig had shipped P0–P12 with
research-backed foundations (Rivers 2.5D / Sýkora lineage / Meta's children's
drawings). Face parallax used Session 20's cylindrical-dome heuristic.

Session 23's arc:
1. **Research Round 2** — filled gaps (Sýkora 2010 Sparse Depth Inequalities,
   Monster Mash 2020, Depth Anything V2). Established the Sýkora group's
   Johnston→TexToons→Ink-and-Ray lineage as our strongest algorithmic
   source; see `docs/live2d-export/research/`.
2. **See-Through depth PSD integration** — Marigold per-pixel depth from
   [shitagaki-lab/see-through](https://github.com/shitagaki-lab/see-through)
   works brilliantly for anime (waifu). Out-of-domain for western art.
3. **Geometric fallback (A1/A3)** — EDT hemisphere per tag,
   style-agnostic, plausibility-gated. `src/io/geometricDepth.js`.
4. **Body warp refinements** — shoulder-feet midbody hip, bow amplitude
   reduction, head t-cap, neck rotation deformer skip.
5. **Iris clipping mask** — standard Live2D feature we had missed. Shipped,
   user-confirmed.
6. **Face parallax iteration loop** — tried 7+ variants, converged on
   realization that **one algorithm cannot serve both symmetric (shelby) and
   asymmetric (girl) art**. Toggle required.
7. **Export UX** — modelName auto-fill, depth PSD upload, reset-on-project-
   change, widened dialog.

---

## 2. What shipped cleanly (user-confirmed working)

### Body parallax
- **Body Angle X lower-torso rotation**: shelby's wide-shouldered body triggered
  the `shoulder-feet midbody` hip fallback (when `widestCoreY` fails
  plausibility). Fade zone 0.55→0.75 instead of 0.45→0.75. Lower torso now
  rotates visibly. `cmo3writer.js:3094`.
- **Head "slightly translate"**: `t = min(0.5, 0.08 + 1.5 * distAboveHip)`
  caps upper-body motion at 50% so head doesn't detach from neck.
  `cmo3writer.js:3162`.
- **Bow amplitude reduce**: `0.05→0.035` for Body Z, `0.02+0.015→0.015+0.01`
  uniform lean. Arms swing less violently. User: "тело работает норм" on
  all three characters.
- **Neck rotation deformer skip**: `neck` added to `SKIP_ROTATION_ROLES`.
  Previously a rotation deformer with bad origin made the neck tear from
  torso under Body Angle X. `cmo3writer.js:1524`.
- **Spine outlier filter** (Step 2B polish): widthProfile samples with
  `coreWidth < 30% maxCoreWidth` excluded from `spineCfShift` interpolation.
  Previously tiny-coreWidth edge samples (collar tip, dress hem) gave
  `-0.12` cf shift poisoning girl's body warp. `cmo3writer.js:3142`.

### Iris clipping
- `CLIP_RULES` map → `irides`/`irides-l`/`irides-r` masked by
  `eyewhite`/`eyewhite-l`/`eyewhite-r`. Emitted via `clipGuidList` +
  `CDrawableGuid` ref. Standard Cubism feature. `cmo3writer.js:4096`.
- User: "clipping mask работает" ✓

### Export UX
- `projectName`/`projectId` prop passed from `EditorLayout` → `ExportModal`.
- Model name field auto-fills from project name when user hasn't manually
  edited (`modelNameTouched` tracked). `ExportModal.jsx:56-107`.
- `useEffect(projectId)` resets depth PSD state + file input on project
  switch — no stale "✓ Loaded" from previous session.
- Dialog widened `max-w-md → max-w-lg`; Depth PSD input `w-full min-w-0 +
  break-words`. No more text clipping.

### See-Through depth PSD pipeline
- `src/io/depthPsd.js` — ag-psd based parser → per-tag grayscale rasters.
  Bilinear `sampleDepthSigned` with canvas rescale (handles girl's 1920 art
  vs 1792 depth canvas).
- Plausibility check: `face.meanGray < back_hair.meanGray` + iris-within-
  tolerance-of-face. Malformed See-Through outputs auto-fall back to
  geometric path.
- `effectiveDepth` in `cmo3writer.js:531` unifies downstream usage.

### Geometric depth fallback (A1/A3)
- `src/io/geometricDepth.js` — Meijster 2-pass squared EDT + hemisphere
  profile (`gray = 255 - sqrt(d_norm) * 255`). Same output shape as depth PSD
  so `sampleDepthSigned` consumes either transparently.
- Activated when `depthData == null` or `isDepthPsdPlausible() === false`.

---

## 3. Face parallax — what was tried, what failed, why

### TRIED: FP_DEPTH_AMP boost (1.6 → 3.0) for geometric path
- **Rationale:** EDT signal is "flat" per region (no anatomical semantic);
  boost amp to get visible 3D feel.
- **Result on girl:** User said "parallax вообще прекрасно работает". PERFECT
  look on girl.
- **Result on shelby:** Goblin. Grotesque feature displacement under ±30°
  rotation.
- **Diagnosis:** girl's drawn head-tilt = asymmetric face mask → asymmetric
  EDT → asymmetric shifts. The asymmetry ACCIDENTALLY aligned with her drawn
  tilt, creating believable 3D. On shelby (symmetric drawn), same asymmetry
  manifested as uncompensated noise → goblin.
- **Resolved:** reverted to 1.6 uniform. Accepted girl regression.

### TRIED: mirror -ax keyforms from +ax
- **Rationale:** guarantee ±30 are exact horizontal mirrors (fixes user
  complaint that shelby's ±30 weren't mirror-symmetric).
- **Result:** worked initially. User: "body angle x norm на shelby".
- **Then added sym on top (next attempt):** in-keyform L/R symmetrize.
- **Combined sym + mirror bug:** symmetrized shifts are antisymmetric by
  construction. Mirror of antisymmetric = identity. ±30 keyforms became
  IDENTICAL — user saw "одна и та же поза на -30 и +30". Dead end.
- **Resolution:** removed mirror entirely. Symmetrize left as ax=0-only.

### TRIED: in-keyform symmetrization (all keyforms)
- **Rationale:** force antisymmetric X shift + symmetric Y shift within
  each keyform, eliminating depth-field noise asymmetry.
- **Result:** fixed AngleY's "one eye sinks" but broke AngleX (the sym +
  mirror cancellation above).
- **Resolution:** conditional — only symmetrize ax=0 keyforms (pure pitch).
  Mirror removed separately.

### TRIED: super-group for eye sub-meshes
- **Rationale:** iris/eyewhite/eyelash as 3 separate protected regions with
  3 different centers → 3 different rigid shifts → eye "breaks apart" into
  sub-shifts. Group them as ONE region with union bbox.
- **Result:** Architecturally cleaner. Eye sub-meshes translate together.
  Still in code — didn't fully fix shelby's asymmetric eye behavior alone.
- **Kept.** `cmo3writer.js:3807`.

### TRIED: inner-bbox full protection + outer fade
- **Rationale:** current proximity fades from 1 at center to 0 at falloff.
  Grid cells at mesh EDGE blend 50/50 between rigid + natural shift →
  stretch at edge. Fix: full protection within bbox, fade only in buffer.
- **Result:** shipped in final state, but user still saw eye asymmetry on
  shelby after this change.
- **Kept.** `cmo3writer.js:3980`.

### Current state at session end (shelby-focused defaults)
- AMP = 1.6 uniform (no girl-specific boost)
- ax=0 only in-keyform symmetrize (pure pitch L/R)
- Super-group for eyes (iris+eyewhite+eyelash as one unit per side)
- Inner-bbox full protection + outer fade proximity
- No mirror (caused ±30 identical with sym)
- Protection bumps: ears 0→0.90, eyebrow 0.50→0.80, eyelash/eyewhite 0.95→1.00
- `tiltedNeck` flag scaffolded in `generateCmo3` input + `cmo3writer.js` but
  UI not connected yet

**Known residual issues:**
- Shelby AngleX ±30 look similar (cos-compression dominates; physics correct
  but visually undifferentiated)
- Shelby AngleY: left eye translates while right eye deforms (per user's
  last report; diagnosis pending)
- Girl lost "perfect" look (reverted AMP=3.0 boost)

---

## 4. The fundamental problem (definitive diagnosis)

Girl's "perfect" was **accidental alignment**:
```
algorithm.asymmetry (EDT field noise, AMP=3.0 amplification)
  ≈ art.asymmetry (drawn head tilt)
  → two asymmetries cancel → looks like real 3D rotation
```

For shelby (symmetric front-facing drawing):
```
algorithm.asymmetry (still same EDT + AMP)
  vs art.asymmetry (ZERO — drawn symmetric)
  → algorithm noise uncancelled → visible goblin / asymmetric deformation
```

**No single algorithm solves both.** The algorithm must either:
- Match the art's asymmetry (fine for girl, wrong for shelby)
- Produce symmetric output (fine for shelby, understates girl)

**Pragmatic solution:** toggle. `tiltedNeck` flag in ExportModal selects mode:
- **Default (front-facing, shelby-like):** pre-symmetrize INPUT data,
  safely amplify. Symmetric input → symmetric output.
- **tiltedNeck=true (drawn-tilt, girl-like):** skip pre-symmetrization, use
  raw asymmetric response. High amp = strong effect.

---

## 5. Plan for Session 24 — Phase A (pre-symmetrization)

### Key insight
Previous attempts symmetrized at the OUTPUT (keyform post-processing). That
interfered with mirror logic. Correct place is the INPUT.

### Implementation steps

**A.1 — Force-symmetric face bbox**
Replace `faceMeshBbox` with symmetric version:
```javascript
const faceCenterX = (faceMeshBbox.minX + faceMeshBbox.maxX) / 2;
const halfW = Math.max(
  faceMeshBbox.maxX - faceCenterX,
  faceCenterX - faceMeshBbox.minX
);
// Force-symmetric bbox around face center X
const symFaceBbox = {
  minX: faceCenterX - halfW,
  maxX: faceCenterX + halfW,
  minY: faceMeshBbox.minY,
  maxY: faceMeshBbox.maxY,
};
```
Gate on `!tiltedNeck` — skip when girl-like.

**A.2 — Symmetric depth sampling**
When sampling depth for face parallax:
```javascript
function sampleDepthSym(depthData, tag, canvasGx, canvasGy, ...) {
  const z1 = sampleDepthSigned(depthData, tag, canvasGx, canvasGy, ...);
  const xMirror = 2 * faceCenterX - canvasGx;
  const z2 = sampleDepthSigned(depthData, tag, xMirror, canvasGy, ...);
  return (z1 + z2) / 2; // averaged mirror value = symmetric
}
```
Gate on `!tiltedNeck`.

**A.3 — Symmetric protected region positions**
For iris-l/iris-r pair (and similar mirror pairs):
- Detect mirror pairs via tag suffix (`-l`/`-r`)
- Compute union centroid's distance from face center X
- Force iris-l at (faceCenterX - d), iris-r at (faceCenterX + d)
- Use averaged Y and matching rz

**A.4 — Restore AMP=3.0 for geometric path**
Safe after A.1-A.3 because inputs are now symmetric — AMP=3.0 amplifies
but without introducing asymmetric noise. Shelby should see strong parallax
similar to girl's "perfect" look but safely.

**A.5 — ExportModal "Tilted Neck" checkbox**
Add under generateRig section:
```jsx
<Checkbox id="tiltedNeck" checked={tiltedNeck} onCheckedChange={setTiltedNeck}/>
<Label>Tilted neck (art drawn with head turned)</Label>
<span>Enable for characters drawn with neck angled; otherwise leave off
for front-facing rest pose.</span>
```
Pass through `exportLive2DProject` → `generateCmo3`.

### Test matrix for Session 24
| Character | tiltedNeck | Expected |
|---|---|---|
| waifu + depth PSD | off | unchanged (Marigold path untouched) |
| shelby, no depth PSD | off | symmetric input + AMP=3.0 → strong clean parallax |
| girl, no depth PSD | on | raw asymmetric + AMP=3.0 → "perfect" restored |

---

## 6. Phase B & C (deferred, for future sessions)

### Phase B — Poisson inflation replaces EDT
From Ink-and-Ray 2014 §4.4: `−∇²f = c` with `f=0` Dirichlet boundary.
Parabolic profile per region; `√f` for hemispherical. Properly bounded,
better anatomical profile than our current EDT hemisphere.

Implementation: Jacobi iteration on alpha mask, ~100 iters at 1024². Drop-in
replacement for EDT in `geometricDepth.js`.

### Phase C — Laplace inter-region smoothing
Sýkora 2010 §3.2: Dirichlet seeds at each layer's alpha, Neumann at real
contours, Laplace smoothing across canvas. Gives coherent inter-tag depth
transitions instead of per-tag blobs.

### Phase D (speculative)
- Neural depth (Depth Anything V2) for western art without See-Through
  access. Heavy dep, unclear runtime story.
- Body depth parallax (B1 from earlier plan) — apply face parallax math to
  Body X Warp with body layer depth.

---

## 7. Files changed this session

```
src/io/live2d/cmo3writer.js        -- heavy changes in face parallax,
                                       body warps, iris clipping
src/io/live2d/exporter.js          -- passes depthData + tiltedNeck
src/io/live2d/bodyAnalyzer.js      -- unchanged (Session 22 work)
src/io/depthPsd.js                 -- new: See-Through depth PSD parser
src/io/geometricDepth.js           -- new: EDT hemisphere + plausibility
src/components/export/ExportModal.jsx  -- depth upload, modelName autofill,
                                          reset-on-project-change, wider dialog
src/app/layout/EditorLayout.jsx    -- pass projectName/Id to ExportModal
scripts/verify_body_analyzer.py    -- verification script (Session 22)
scripts/analyze_depth_psd.py       -- verification script (Session 23)
docs/live2d-export/research/       -- NEW: research notes (8 papers)
```

## 8. Reference papers absorbed this session

Full notes in `docs/live2d-export/research/NOTES.md`. Synthesis in
`docs/live2d-export/research/SYNTHESIS.md`. Papers in
`reference/papers/` (gitignored).

**Directly applicable findings:**
- **Ink-and-Ray 2014** — Poisson inflation (Phase B)
- **Sýkora 2010 Sparse Depth Inequalities** — Laplace equation (Phase C)
- **Johnston Lumo 2002** — ancestral silhouette-inflation technique
- **Smith 2023** — closest-bone fallback idea (deferred)
- **See-Through project** — Marigold depth PSD source (shipped)

## 9. Open questions for tomorrow

1. Is A.2 (mirror-averaged depth) sufficient, or do we also need to
   symmetrize the alpha mask itself (before EDT even runs)?
2. For A.3 (symmetric protected regions), how to handle cases where the
   artist drew l/r features at genuinely different sizes (e.g., one eye
   slightly squinting at rest)?
3. Should iris clipping mask extend to `eyelash` as well (eyelash over
   iris)? Check Hiyori reference.
4. Does Phase A solve the AngleX ±30 "look similar" issue, or is that a
   separate AMP/angle-range problem independent of symmetry?
