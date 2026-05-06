# Skeleton scan of ./frames/ (174 frames @ 2fps ≈ 87s video)

Preliminary phase map from sampling every ~10–15 frames. Will be refined with zooms.

## Phase map (coarse)

| Frames | Phase label | What's on screen |
|---|---|---|
| 001–010 | **P1: outer face warp inspect** | Huge red+green bounding warp deformer around entire head/hair region. Face art alpha dimmed to show warp grid (~20×20 cells visible). Selection showed as red outer box + inner green handles. Mesh/deformer preselected at start. |
| 011–020 | **P1 cont.** | Face art re-shown. Outer warp deformer still selected. Two-column selection box visible. Author zooms/pans. |
| 021–035 | **P2: preview zoom-out** | Pulls out, no grid visible on 025/030. Clean art view of upper body. Likely scrolling parameter slider to test current state (no deformation happening). |
| 035–050 | **P2 cont.** | Wide zoom. Tool palette visible at top (frame 035). Clearly navigation between regions. |
| 050–060 | **P3: face-region warp inspect** | Smaller red warp around mid-face (eyes + nose region). Grid cells visible (~12×6). Green row of control handles across upper row. |
| 060–080 | **P4: eye region / inner deformer** | Zooming deeper. Grid around eyes, visible warp handles. Frame 075 clearly shows a warp grid tight around single eye region (left eye visible with grid). Likely descending hierarchy: face_warp → eye_warp. |
| 080–090 | **P5: zoom-out preview** | Full upper body shown again — likely checking effect after adjustments. |
| 090–105 | **P6: ear region** | Frame 095 shows ear/earring fragment + bbox. Frame 100 = extreme eye closeup with grid (parts of lashes only — warp around eyelash mesh or tight eye warp). |
| 105–125 | **P7: small face-center warp** | Frame 120: face with small grid around nose/mouth area (looks like a small warp deformer around mouth+nose region, much smaller than face warp). |
| 125–140 | **P8: TESTING starts** | Frame 140: character head visibly rotated to the right with pseudo-3D distortion (head leaning/turning). Background color changes to brown/mauve = workspace panel. |
| 140–165 | **P8 cont.: slider test** | Frame 160 shows head rotated extreme right. Cursor visible grabbing slider. |
| 165–174 | **P8 cont.** | Frame 174: head rotated HARD to the left (−30° equivalent). Mesh grid visible → still on selected deformer while testing. |

## Key visual cues

- **Red outer box + green inner handles** = Cubism warp deformer selection.
- **Grid density** varies per deformer level — coarser on big head warp, finer on eye/mouth warps.
- **Head rotation in test phase** is NOT a pure 2D rotation — there's squash and pseudo-perspective, which matches the classic "warp + rotation deformer combo" technique.
- Text labels on screen (partially visible Japanese):
  - "ArtMesh224を含めた11個のオブジェクトが意図しない見た目の可能性があります" = warning about 11 objects with potentially unintended visuals.
  - "ArtMesh57を含めた2個のア..." = 2 object warning, related to rig check.
  - These are Cubism warnings that appear in the **Model validator panel** — visible almost every frame, so the author opened that panel early and it stays open.
  - Frame 141: "選択状態を隠す" が有効です" = "Hide selection" mode is enabled — author toggled hide-selection for the test.
  - Frame 050 corner: "「選択状態を隠す」..." same hint.
  - Frame 100: "ブレンドシェイプ編集可能..." = "Blendshape editable..." — author may be using blend shape / warp editing mode.
  - Frame 160: "「選択状態を隠す」が有効です。(ここをク..." = hide-selection enabled.

## Hypothesis of the "hack"

Based on rotation character in test (head squashes + tilts with strong pseudo-3D in frames 140–174, not a flat 2D move), and the visible hierarchy of nested warps:

- **Outer warp** covers whole head/hair + background region.
- **Face warp** covers face-proper (smaller).
- **Eye warps** inside face warp.
- **Mouth/nose warp** also inside face warp (frame 120).
- Plus likely a **Rotation Deformer** that rotates the face+inner warps as a group — evidence: head visibly rotates around a pivot roughly at the neck in test frames.

Classic Cubism "head angle X" rig = Warp deformer for squash/perspective + Rotation deformer as parent = author keyframes BOTH to ParamAngleX at −30 / 0 / +30.

## What I still need to confirm

1. Exact deformer hierarchy (which deformer is parent of which).
2. Whether author creates NEW deformers in this video or just tweaks existing ones.
3. Numeric values entered in property panel (angle, scale, shear).
4. ParamAngleX keyform values (−30, 0, +30? Or −45 / +45?).
5. How the warp grid points are displaced per keyform (squash pattern).
6. Whether any physics/automation is used.
7. What the lower-level grids (eye, mouth) are doing — are they keyed to ParamAngleX too, or to other params?

Next: zoom into 001–025 (P1/early setup), then 050–080 (eye/face warp edits), then 130–145 (transition from setup → test to see last edits before testing).
