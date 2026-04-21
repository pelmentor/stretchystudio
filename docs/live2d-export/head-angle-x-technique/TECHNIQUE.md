# HEAD ANGLE X technique — reverse-engineered from `./frames/`

> **⚠ POST-MORTEM (Session 24, attempted implementation)** — The RotationDeformer
> interpretation below is **WRONG**. Attempting to key a 2D RotationDeformer to
> ParamAngleX produced a rigid tilt (head detaches from neck and swings around
> the chin pivot like a severed head on a string), not a pseudo-3D turn. In
> Live2D's 2D-only deformer model, a RotationDeformer can only rotate around
> the Z-axis of the canvas — mathematically, that's a lean/tilt, not a turn.
>
> The "rotation arc" I saw in frame 142 was almost certainly the warp
> deformer's OUTER outline in its deformed state, not a separate rotation
> deformer. The entire pseudo-3D head-turn illusion in Live2D rigs is carried
> by the WARP deformer's keyforms alone — there is no secondary rotation
> deformer layering on top.
>
> The §5 programmatic implementation guide below (add Head X Rotation +
> reduce warp amp) was tried and reverted. See `../SESSION_24_FINDINGS.md`
> for the revert narrative. Keep this file as record of what I thought I saw
> and why I was wrong; rely on the warp-only approach going forward.

---


Source: 174 PNG frames sampled at 2 fps from a Live2D Cubism Editor recording of a rigged anime-style character ("Sample model", illust: @moo_n_moko, rig: @maki_haruno). The video shows the author scrubbing parameters and navigating deformer layers of an **already-rigged** HEAD ANGLE X system — it is a walkthrough of the finished rig, not a build-from-scratch session. The "hack" therefore has to be inferred from the nested deformer boxes, the deformation behavior at non-zero ParamAngleX, and the visible grid topology.

**Honest caveat.** The recording is cropped to the canvas. The deformer-hierarchy panel, parameter panel, and property inspector are NOT visible. Numeric values (exact angles, warp vertex offsets, keyform values) cannot be read from pixels. What follows is the technique reconstructed from visual evidence, cross-checked against the standard Cubism head-angle idiom. Ambiguous points are flagged as "inferred" or "unknown".

---

## 1. Starting state (what the author has before testing)

Evidence from frames 1–15, 55–60, 100–125, 142–155:

- A layered character illustration (anime style, white uniform, grey hair, front-facing at param zero).
- **Nested warp-deformer hierarchy** around the head. From outer to inner, at least four layers are visible:
  1. **Head warp** (frame 1, 2, 12): red outer box spans from above the hair crown to the collarbone, left-right covers shoulder-width. Interior grid looks like a 5×5 or 6×6 cell warp (Cubism defaults). Encloses the whole head + some body margin.
  2. **Face warp** (frames 52, 55, 60): red box confined to the facial plane — top edge around eyebrows, bottom edge just below chin, left-right from ear to ear. Finer grid than (1).
  3. **Eye-region warp** (frames 75, 100, inferred): tighter warp around the eye/eyelash area. Frame 100 shows an extreme eye closeup with grid-like artifacts.
  4. **Eyebrow warp** (frame 125): THIN HORIZONTAL warp just over the eyebrow row — red box is a narrow strip, much wider than tall.
  5. **Mouth/nose warp** (frame 120, inferred): small warp around the nose/upper-lip region.
- **Rotation deformer** (frames 142, 150, 155): visible only at rotated states as a green curved/arc boundary surrounding the warped head. This is the parent rotation deformer — it holds the warp chain and rotates the whole face structure as one rigid body around a pivot near the chin/neck base.
- **Model validator panel** is open (visible almost every frame — the `ArtMesh83を含めた11個のオブジェクトが意図…` / `ArtMesh57を含めた2個の…` warnings are a permanent overlay).
- **"Hide selection" toggle** was enabled (`「選択状態を隠す」が有効です`, frames 58, 145, 160) so the deformer outlines disappear during clean-preview scrubbing.

Inferred hierarchy (not visually confirmed — deformer panel cropped):

```
HEAD_ROOT_ROTATION  (RotationDeformer, pivot ≈ neck base)
└── HEAD_WARP       (WarpDeformer, 5×5 grid over whole head)
    ├── FACE_WARP   (WarpDeformer, 5×5 or 6×6 over facial plane)
    │   ├── EYE_L_WARP, EYE_R_WARP  (small WarpDeformers over each eye)
    │   ├── EYEBROW_WARP            (thin horizontal WarpDeformer)
    │   ├── NOSE_MOUTH_WARP         (small WarpDeformer, center face)
    │   └── (face-layer ArtMeshes)
    └── (hair / ear ArtMeshes)
```

This matches the Cubism SDK sample-model convention and the `Hiyori` reference rig.

---

## 2. Step-by-step from the frames

The video is a **demo, not a construction**. Below each phase is what the author *does on screen*, with frame ranges. Treat phases as "the author is showing / probing this layer" rather than "the author is creating this layer right now."

### Phase P1 — Head-warp inspection (frames 001–015)
- Author has the **head warp** selected. Red outer box covers full head; green handles on corners + edge midpoints (standard Cubism warp control points).
- Face skin art is partially transparent / mesh-view enabled — author is looking at the warp grid through the art.
- Cursor (`+` icon at f005) hovers over a grid vertex, suggesting the user is about to grab a control point but does not actually drag in this range.
- No numeric edits visible.

### Phase P2 — Full-body preview (frames 020–040)
- Zoom out to see the whole figure + background illustration (the pink "School life" typography + heart decorations are part of the art).
- Author scrubs a parameter. In frame 028 the head is clearly tilted and the warp grid is skewed (non-rectangular interior grid lines) — **this is the rig animating**. The mouth is closed / neutral; the tilt is ParamAngleX ≠ 0.
- Frame 033 briefly flashes a toolbar entry at top: `一*変形ツール` (partial OCR — likely "一括変形ツール" = *Bulk Transform Tool* / range-select transform). Author toggles this tool but doesn't commit an edit.
- Frame 042: mouth is smiling — ParamMouthOpen / ParamMouthForm scrubbed. Unrelated to AngleX, just demo noise.

### Phase P3 — Face-warp layer (frames 050–065)
- Zoom into face. Red box shrinks to the facial plane. Grid is denser (more interior dots). Green handles along top-edge (eyebrow height) and bottom-edge (just below chin).
- Author scrubs parameters again — frame 058 shows mild asymmetric face deformation with `選択状態を隠す` hint popup, i.e. they toggled hide-selection to preview cleanly.
- No visible vertex drag.

### Phase P4 — Eye-region inspection (frames 070–080)
- Extreme eye closeup. At f075 a warp grid is visible tight around a single eye — evidence of per-eye warps inside the face warp.
- No visible edit operation.

### Phase P5 — Preview / checking result (frames 080–095)
- Pulled out to mid-body. Frame 085 is essentially a clean preview. Frame 095 shows an earring/ear detail — author is navigating the hierarchy, selecting the ear art mesh to verify it's inside the head warp (so the ear rotates with the head).

### Phase P6 — Eye-inner closeup (frames 100–115)
- Frame 100 shows only the eyelashes + lower eye with a text popup `ブレンドシェイプ編集可能…` ("Blendshape editable…") — author briefly entered blendshape-edit mode. No destructive action.
- Frames 105, 115 zoom back out; face has mild mouth animation from parameter scrubbing.

### Phase P7 — Eyebrow warp (frames 120–130)
- Frame 125: a **thin horizontal warp** (red box aspect ratio ≈ 8:1) over the eyebrow row becomes selected. This is the dedicated eyebrow warp. Grid is coarser vertically than horizontally.
- Author is showing this layer exists. No edit.

### Phase P8 — Head-rotation test (frames 135–174) — **the payoff**
- Workspace background changes to the brown panel (f140+) — possible that selection-hide + canvas-only preview mode was engaged OR the author deselected and the background illustration is hidden.
- From f140 on, the author **scrubs ParamAngleX across its whole range**:
  - f140: mild positive tilt (right lean from viewer POV)
  - f142: extreme profile view facing our LEFT — **this is the most revealing frame**: the green rotation-deformer arc is visible wrapping the head, warp grid inside the arc has bent into a parallelogram, and the head has rotated ~30° plus picked up perspective compression on the far side.
  - f145: head slightly right-of-center — position has translated (pivot is below chin, so the head moves as a rigid body plus deformation).
  - f150, 155: warp grid visible through semi-transparent head, clearly non-orthogonal (interior lines curve).
  - f160: head far-right — cursor visible on parameter slider.
  - f165, 170, 174: cycling back through −20 → −30 → 0. f174 = extreme negative AngleX (facing our right? or the same left — it's hard to tell without a reference frame).

---

## 3. The "hack" — what makes this look 3D

The technique is the **classic Cubism head-rotation idiom**, composed of two cooperating deformers keyed to the same parameter:

### 3.1 Rotation deformer as outer envelope

- A RotationDeformer (in `moc3` terms: `CubismDeformers::RotationDeformer`) wraps the whole head hierarchy.
- **Pivot** is placed at the **neck base / chin bottom**, not at the head centroid. This is critical: rotating around the neck produces the natural "head swings sideways and the chin sweeps across" motion seen in frames 142, 160, 174 — the head translates *and* rotates, because the geometric center of the head orbits around the pivot.
- **Binding:** `ParamAngleX` ↔ rotation deformer's `Angle` property. Key values (inferred from visible rotation extent in frames 142/174 ≈ ±30° head turn):
  - ParamAngleX = −30 → Angle ≈ −10° to −15° (rotation alone is subtle; most of the "turn" illusion comes from the warp)
  - ParamAngleX =   0 → Angle = 0°
  - ParamAngleX = +30 → Angle ≈ +10° to +15°
- Some rigs also key **horizontal translation** to ParamAngleX on this same rotation deformer (or its parent), to offset the head laterally and further sell the rotation. Evidence: in f142 the head appears to have shifted right in addition to rotating.

Numeric values unknown — inferred from visible rotation amplitude. In the Hiyori SDK sample the head rotation deformer uses angles roughly ±10°.

### 3.2 Warp deformer for perspective squash

- The **head warp** (and especially the **face warp** inside it) is also keyed to `ParamAngleX`.
- At ±30 the warp grid control points are displaced to simulate **face-plane foreshortening**: the far side of the face compresses horizontally, the near side expands slightly, and the vertical grid lines on the far side bow outward (giving the face a convex "wrapping around a cylinder" look).
- Frames 150 and 155 show this directly — interior grid lines are no longer parallel or evenly spaced.

Specifically, the warp-keyform transformation at non-zero ParamAngleX looks like this (inferred from grid appearance in f155):

- Horizontal compression on the far side: far-side column of control points shifts toward the center by ≈ 15–25% of cell width.
- Horizontal expansion on the near side: near-side column shifts outward by a smaller amount (≈ 5–10%).
- Vertical bowing: top and bottom rows on the far side curve slightly toward the face center → crown and chin lean into the turn.
- No significant vertical shift of the whole warp (i.e. warp translation isn't keyed to AngleX — only per-vertex horizontal + subtle vertical deform).

### 3.3 Why both are needed

- **Rotation alone** = tilting the head like a cardboard cutout. Looks flat, wrong.
- **Warp alone** = face squashes in place without turning. Looks like a mask being pushed sideways.
- **Rotation + warp, same parameter**: the rotation provides the rigid-body swing; the warp adds pseudo-perspective. Combined, the viewer's brain reads it as 3D rotation despite the art being 2D.

### 3.4 Inner warps (eyes, mouth, nose, eyebrows)

- The inner warps (eye, eyebrow, mouth/nose) are **NOT** primarily keyed to ParamAngleX in this rig. They're keyed to their own semantic parameters (ParamEyeLOpen, ParamMouthOpen, ParamBrowL/R, etc.).
- However, because they sit *inside* the face warp, they inherit the face warp's deformation automatically — when the face squashes under ParamAngleX the eyes, brows, and mouth also squash along with it. This is the key insight: **each inner deformer only solves its own semantic problem; the perspective illusion is carried entirely by the outermost head warp + the rotation deformer**.

### 3.5 Partial eye-AngleX compensation (optional, inferred)

- In the Hiyori-style rig the per-eye warps receive a **small ParamAngleX offset** so the eyes stay anchored to the rotating face, avoiding the "sliding eyes" artifact when the face plane foreshortens. This is the "eye follow" trick.
- No direct evidence in the frames, but the eyes look naturally placed in the rotated keyforms so some compensation is probably present.

---

## 4. Result (ParamAngleX slider scrub)

When the viewer drags ParamAngleX from −30 to +30:
- **Whole head rotates ~±10–15°** around a pivot at the neck base → head leans/swings.
- **Horizontal translation** of 20–40 canvas-px follows the rotation direction, adding "sliding" realism.
- **Face plane undergoes perspective squash** — far cheek compresses, near cheek expands, chin+crown slant inward on the far side.
- **Ear** on the near side becomes more visible (in f142/150 one ear is clearly showing while the other is occluded by hair).
- **Eyes, nose, mouth, brows** ride along with the face squash because they're children of the face warp. No independent motion from AngleX.
- **Hair** moves as part of the head warp (rigid, no separate sway from AngleX — secondary hair sway is physics-driven, separate).

---

## 5. Programmatic implementation for Stretchy Studio

Maps to existing exporter pieces. Ties into [AUTO_RIG_PLAN.md](../AUTO_RIG_PLAN.md) and [SESSION_23_FINDINGS.md](../SESSION_23_FINDINGS.md) residual work.

### 5.1 Deformers to create (parent → child order)

1. **`head_root_rotation`** — `RotationDeformer`
   - Parent: `body_root` (or the existing root head parent).
   - Pivot (`origin`): at neck-base position from `bodyAnalyzer.js` anchors (the `neck.minY`-ish Y, and the face center X). This already exists in code for neck rotation — reuse the same pivot.
   - Binding: `ParamAngleX` key-tied.
   - Keyforms:
     - AngleX −30 → rotation angle **−12°** (recommended starting value; tune).
     - AngleX   0 → rotation angle 0°.
     - AngleX +30 → rotation angle **+12°**.
   - Optional X translation keyform: −30 → dx ≈ −0.04 × faceWidth, 0 → 0, +30 → +0.04 × faceWidth.

2. **`head_warp`** — `WarpDeformer`, 5×5 grid (or 6×6 for finer), parent = `head_root_rotation`.
   - Bounding box: covers full head region (from bodyAnalyzer `head.topY` down to `neck.minY` + 10% margin, left-right = `head.bbox` + 5% margin).
   - Binding: `ParamAngleX` key-tied.
   - Keyforms (vertex displacements at −30 / 0 / +30). Let `cols` = 6 (for 5×5 warp) and let `i ∈ [0..cols-1]` be horizontal index with `i=0` left edge, `i=cols-1` right edge. At ParamAngleX = +30 (head turning right from character's POV, our left):
     - Near side (right columns `i ≥ cols-2`): shift right by `≈ +0.03 × warpWidth`.
     - Far side (left columns `i ≤ 1`): shift right by `≈ +0.12 × warpWidth` (inward compression).
     - Middle columns: interpolate linearly.
     - Vertical: top and bottom rows on the far side bow inward by `≈ 0.02 × warpHeight`.
   - AngleX = −30 is the mirror (flip signs).
   - AngleX = 0 is identity (no displacement).
   - **These numbers are starting points** derived from eyeballing f155. Tune against a test export.

3. **`face_warp`** — `WarpDeformer`, 5×5 or 6×6, parent = `head_warp`.
   - Bounding box: facial plane only (`face.bbox` from bodyAnalyzer — eyebrow line to chin, ear-to-ear).
   - Binding: `ParamAngleX` key-tied with **reduced** amplitude (≈ 50% of `head_warp`) — because head_warp already deforms the whole head; face_warp only adds finishing perspective. Tune.
   - Keyforms: same pattern as head_warp but smaller magnitudes (e.g. near side `+0.02`, far side `+0.06`).

4. **Per-feature warps** (`eye_l_warp`, `eye_r_warp`, `eyebrow_warp`, `nose_mouth_warp`) — children of `face_warp`.
   - **Do NOT key to ParamAngleX**. They inherit face_warp deformation automatically.
   - They're created and keyed for their own semantic parameters (ParamEyeLOpen, ParamBrowLY, ParamMouthForm, etc.) as part of the existing export pipeline.

5. **Optional: per-eye small ParamAngleX compensation**.
   - Only if the eye-following looks off. Magnitude ≈ 10–20% of face_warp effect, applied as pure translation (no squash) so irises stay centered on the turning face plane.

### 5.2 Where this plugs into the current exporter

Touch points in [`src/io/live2d/cmo3writer.js`](../../../src/io/live2d/cmo3writer.js):

- **Root rotation deformer** — already present (body rotation). Extend to also key `ParamAngleX` with a small rotation offset, OR add a dedicated `head_root_rotation` between `body_root` and the head warp stack.
- **Head warp** — already emitted (`FP_DEPTH_AMP`, `fpGridPositions` — see `computeFpKeyform`). This IS the perspective warp for the face. Current implementation uses depth-driven per-vertex shifts. Replace / augment with the column-wise perspective shift described above for a more classic Cubism feel.
- **Face warp** — currently conflated with the head warp in the exporter. Consider splitting: outer head warp (hair + skin) for large perspective, inner face warp for subtle feature alignment.
- **Per-feature warps** — already emitted individually per role (`eyelash-l`, `irides-l`, etc. with their own bbox protection). No AngleX keys needed there.

Concretely for Session 24 / 25:

- Rename `FP_DEPTH_AMP` usage to `FACE_WARP_PERSPECTIVE_AMP`, and ADD a sibling `HEAD_ROTATION_ANGLEX_DEG = 12` that drives the outer rotation deformer keyform.
- In the AngleX keyform loop (where `computeFpKeyform(ax, ay)` is called), also emit the rotation-deformer keyforms for `ParamAngleX = -30 / 0 / +30` with angles `-12 / 0 / +12`.
- Verify the pivot: the head rotation deformer origin must be at the **chin-bottom / neck-top**, not the face centroid. `bodyAnalyzer.js` already exports `neck` anchor — use its `.y` and the face center `.x`.

### 5.3 Suggested numeric defaults (start tuning from here)

| Component | Param | Keyform −30 | Keyform 0 | Keyform +30 |
|---|---|---|---|---|
| head_root_rotation.angle | ParamAngleX | −12° | 0° | +12° |
| head_root_rotation.txOpt | ParamAngleX | −4% W | 0 | +4% W |
| head_warp.farCol shift | ParamAngleX | +12% warpW (toward +x) | 0 | −12% warpW |
| head_warp.nearCol shift | ParamAngleX | −3% warpW | 0 | +3% warpW |
| head_warp.vBow | ParamAngleX | 2% warpH | 0 | 2% warpH |
| face_warp.farCol shift | ParamAngleX | +6% faceW | 0 | −6% faceW |
| face_warp.nearCol shift | ParamAngleX | −1.5% faceW | 0 | +1.5% faceW |

Where `W` = canvas width, `warpW`/`faceW` = respective warp bounding box widths. All percentages are *signed* — flip on the mirror side.

Keep everything measured against `bodyAnalyzer` anchors rather than baked Hiyori numbers (per [Measure, don't bake](../../../memory/feedback_measure_not_bake.md)).

---

## 6. What we cannot confirm from the frames (need reference or SDK spec)

1. **Exact rotation angle at extremes** — we see approx ±12° but could be as high as ±20°. Check `Hiyori.moc3` rotation deformer keyforms.
2. **Whether the rotation deformer has translation keyed**, or only rotation. Frame 142 suggests yes; need SDK ref.
3. **Whether any physics** (hair sway, cheek bounce) is keyed to ParamAngleX or purely to ParamAngleZ/physics inputs.
4. **Exact warp grid resolution** (5×5 vs 6×6 vs 4×4). From green dot counts it looks like 5×5, but the crop is tight.
5. **Whether a NON-rotation, pure-X-translation deformer sits between** rotation and warp. Some rigs add it for extra natural motion.
6. **Eye-follow compensation** (§3.5) is inferred, not observed directly.
7. **The author's exact mouse actions during f033's bulk-transform tool activation** — no drag was completed within the captured frames, so whether they intended to batch-move a column of warp vertices is unknown.

## 7. Next steps

1. Dump `Hiyori.moc3` (or any Cubism SDK sample) to extract the rotation deformer angle keyforms + warp control-point deltas at ParamAngleX = ±30. Use `moc3ingbird` or the Rust parser (see [MOC3 RE resources](../../../memory/reference_moc3_resources.md)).
2. Patch [cmo3writer.js](../../../src/io/live2d/cmo3writer.js):
   - Add `head_root_rotation` RotationDeformer as parent of the head warp chain.
   - Emit ParamAngleX keyforms on that rotation deformer (±12°).
   - Optionally refactor `FP_DEPTH_AMP` into separate outer/inner warp amplitudes.
3. Test against shelby (front-facing) — should give clean swing without the goblinification we saw in Session 23.
4. Re-test against waifu — the anime case should still look good because the warp technique is what the original Hiyori rig uses.
5. Revisit the `tiltedNeck` flag (Session 23 Phase A.5): with an explicit rotation-deformer swing, the drawn-turned-head (girl) case may no longer need a separate code path.

---

## Appendix: frame references per claim

| Claim | Frames |
|---|---|
| Head warp encloses whole head | 001, 002, 005, 012 |
| Face warp (smaller, tighter) | 052, 055, 058 |
| Eye-region warp | 072, 075, 100 |
| Eyebrow thin warp | 125 |
| Warp deforming during AngleX scrub | 028, 150, 155 |
| Rotation deformer arc visible | 142 |
| Head rotated extreme + translated | 142, 160, 174 |
| Selection-hide toggle active | 058, 145, 160 |
| Bulk transform tool flashed | 033 |
| Blendshape-edit popup | 100 |
| Model validator warnings persistent | most frames |
