# Session 28 Findings — Neck-corner shapekey + eyewhite mask keyform fix

**Date:** 2026-04-22 (day after Session 27's refactor).
**Scope:** two feature improvements on top of the Session 27 refactor:
(1) neck-corner shapekey bound to ParamAngleX so the neck's top corners
follow the head under yaw (fixes seam visibility between head and shoulders);
(2) eyewhite mask keyform extension so Cubism Editor stops warning about
"Mask Artmeshes have problems" when iris gaze is enabled.
**Status at session end:** both changes shipped and smoke-tested end-to-end.
User confirmed the neck shapekey looks right after two rounds of tuning.
Awaiting browser confirmation on the mask warning fix.

---

## 1. Neck-corner shapekey (Head Angle X)

### Problem

With `generateRig: true`, the neck mesh had no binding on ParamAngleX. As
the head yawed (±30°) via FaceParallax, the face shifted horizontally but
the neck stayed as a static rectangle. Seams appeared at the top corners
where the neck's brown-skin edges no longer aligned with the jaw's bottom
edge.

### Fix

Per-vertex `CArtMeshForm` shapekey on the `neck` mesh, bound to
ParamAngleX (3 keyforms at −30 / 0 / +30). Uses the same per-vertex pattern
as the Session 17 eye-closure shapekey.

The shift for each vertex at ±30° is:

```js
dX = |2·relX - 1|                // 1 at left/right edge, 0 at center
dY = max(0, 1 - relY)            // 1 at top, 0 at bottom
tx = dX >= NECK_X_PLATEAU ? 1 : dX / NECK_X_PLATEAU
ty = dY >= NECK_Y_PLATEAU ? 1 : dY / NECK_Y_PLATEAU
cornerness = smoothstep(tx) * smoothstep(ty)
shiftPx = sign(ax) * NECK_CORNER_TILT_FRAC * neckWidth * cornerness
```

where `smoothstep(t) = t²·(3 − 2t)`.

### Final tuning (after 3 iterations with user in the loop)

```js
const NECK_CORNER_TILT_FRAC = 0.05; // 5% of neck width at the exact corner
const NECK_X_PLATEAU = 0.7;         // outer 15% from each X edge at full shift
const NECK_Y_PLATEAU = 0.7;         // top 30% at full shift
```

### Why plateau + smoothstep (not `d^POW`)

Initial attempt used `d^POW` with POW = 2 → 1 → 0.5 to widen the zone.
Problem: `d^POW` with POW < 1 has a *vertical tangent* at d → 0 — so at
the zone boundary (center X / mid Y), the shift magnitude drops from
non-zero to zero along an almost-vertical curve. That reads as a visible
"stroke" at the edge of the deformation zone.

`smoothstep(t) = t²·(3 − 2t)` has *zero derivative* at both t = 0 and
t = 1, giving a soft S-curve with no visible boundary. Adding a plateau
threshold keeps the full-strength zone wide while still having a soft
fade-out inside.

### Tuning iteration history

| Attempt | `TILT_FRAC` | `POW` | Plateau X / Y | User feedback |
|---|---:|---:|---|---|
| 1 | 0.08 | 2 | — | "нужно больше зону хватать" |
| 2 | 0.08 | 1 | — | "ещё шире" |
| 3 | 0.08 | 0.5 | — | "мягче на конце, градиентный спад силы нужен" |
| 4 (switch to smoothstep) | 0.08 | smoothstep | 0.5 / 0.5 | "сейчас слишком много шеи захватывается" |
| 5 (final) | 0.05 | smoothstep | 0.7 / 0.7 | "всё выглядит отлично" |

### Implementation location

All in `src/io/live2d/cmo3writer.js`:
- `pidParamAngleXEarly` lookup near the other eye-closure early pids.
- `hasNeckCornerShapekeys` detection in the per-mesh keyform setup loop.
- New `else if` branch that wires up the 3-keyform binding on ParamAngleX.
- New `else if (pm.hasNeckCornerShapekeys)` branch in the mesh-emission
  section that computes the shifted positions and emits 3 `CArtMeshForm`
  entries.

---

## 2. Eyewhite mask keyform fix (Cubism "Mask Artmeshes have problems")

### Problem

After turning on iris gaze (which binds the iris's rig warp to
ParamEyeBallX / ParamEyeBallY), Cubism Editor showed the dialog:

> Assign clipping mask to Mask Artmeshes have problems.
> There are some problems in the status of output mask.
> Please set to output the used masks.
> If the masks are using ArtMeshes with no keyforms at maximum and
> minimum parameter values, they may be displayed unexpectedly on the
> actual device.
> ID list of Mask Artmeshes have problems:
> ArtMesh5 [Keyforms]
> ArtMesh6 [Keyforms]

The two listed IDs were `eyewhite-l` and `eyewhite-r`. A mask is
expected to have deformer keyforms covering every parameter the clipped
child is bound to — otherwise at those parameter extremes the mask's
rendered shape is undefined relative to the child.

### First attempt (rejected): mesh-level multi-parameter keyforms

Initially we extended the eyewhite ArtMesh keyforms from 2 (on
ParamEye{L,R}Open) to 18 (on ParamEyeOpen × ParamEyeBallX × ParamEyeBallY),
reusing only 2 CFormGuids. XML verification confirmed the extra bindings
and 18 `KeyformOnGrid` entries were emitted correctly. **But Cubism's
warning still fired.**

Reason: Cubism checks the DEFORMER chain, not just the mesh. The iris
mesh is deformed by its rig warp, which is bound to ParamEyeBallX/Y.
The eyewhite mesh is deformed by its OWN rig warp, which was bound only
to ParamOpacity. The mask's shape at ParamEyeBallX ≠ 0 was therefore
still undefined at the warp level — mesh-level keyforms don't cure that.

### Second attempt (shipped): warp-level identity keyforms

Added `eyewhite-l` / `eyewhite-r` entries to `TAG_PARAM_BINDINGS` with:
- `bindings`: `[{ ParamEyeBallX, keys: [-1,0,1] }, { ParamEyeBallY, keys: [-1,0,1] }]`
- `shiftFn: (grid) => new Float64Array(grid)` — **identity** (no displacement)

This makes the eyewhite's rig warp structurally match the iris's rig
warp: both now have a 6×6 grid of 9 keyforms on ParamEyeBallX × ParamEyeBallY.
The iris's warp actually shifts the grid (uniform translation of 9% × 7.5%
per Hiyori); the eyewhite's warp returns identical positions at every
gaze combo.

Functional result: the mask's shape is now defined at every
ParamEyeBallX/Y value, satisfying Cubism's check. No actual deformation
— the eyewhite stays put while the iris moves inside it, which is the
intended behavior.

Mesh-level keyforms stay unchanged at 2 (closed + open on ParamEyeOpen).

### Scope

Applied to `eyewhite-l` and `eyewhite-r` only (tags registered as masks
in `CLIP_RULES`). Eyelash / iris entries unchanged. Legacy non-split
`eyewhite` tag also unchanged; if a user hits the warning on that path
we can extend similarly.

### Implementation

`src/io/live2d/cmo3writer.js`:
- `TAG_PARAM_BINDINGS` gains two entries for `eyewhite-l` and
  `eyewhite-r`, both with the same ParamEyeBallX/Y binding as
  `irides-l`/`irides-r` but with an identity `shiftFn`.

No other changes (the mesh-level closure binding is unchanged).

### Lesson

For a clip mask to satisfy Cubism's "keyforms at max/min" check, the
keyforms must exist at the appropriate level in the deformer chain.
Adding keyforms at the wrong level (mesh vs. warp) does not silence the
warning even if the XML structure looks correct. The **warp-level
matching** — mask's warp has the same parameter bindings as the clipped
child's warp — is what the Editor actually validates.

---

## 3. Verification performed

1. `node --check` on `src/io/live2d/cmo3writer.js` — PASS
2. Dynamic `import()` of both `cmo3writer.js` and `exporter.js` — PASS
3. End-to-end `generateCmo3` smoke test with `generateRig: true` and a
   tagged mesh set that includes eyelash/eyewhite/irides for both sides
   and a neck mesh — PASS, produces ~24 KB cmo3 with no ReferenceError.
4. Visual confirmation from user for the neck shapekey (after 5 tuning
   iterations) — "всё выглядит отлично".
5. User to confirm in Cubism Editor that the mask warning is gone.

---

## 4. Files changed

- `src/io/live2d/cmo3writer.js` — 3700 → ~3900 lines
  (+ early pid lookups, + `hasNeckCornerShapekeys` detection and binding,
  + eyewhite mask multi-parameter binding path,
  + neck-corner shapekey position computation in emit section,
  + threaded two new fields through `perMesh.push`).
- `docs/live2d-export/SESSION_28_FINDINGS.md` — this file.

---

## 5. Tunable constants summary

All inline in `cmo3writer.js` — no new config system introduced.

| Constant | Value | Meaning |
|---|---:|---|
| `NECK_CORNER_TILT_FRAC` | 0.05 | Peak corner shift as fraction of neck width |
| `NECK_X_PLATEAU` | 0.7 | Full-strength zone threshold on X-edge distance |
| `NECK_Y_PLATEAU` | 0.7 | Full-strength zone threshold on Y-top distance |

The mask fix has no tunables — the keyform count (2 × 3 × 3) is pinned
to match the iris rig warp's 2D gaze binding.

---

## 6. Deferred / next

- Non-split `eyewhite` (legacy single-eye tag without -l/-r) would
  hypothetically trigger the same warning if its iris has gaze. Not fixed
  here because modern characters all use the split `-l` / `-r` convention
  and no shipping test character exercised that path. Can revisit if a
  user encounters it.
- Session 27's deferred "slight neck-layer exposure at AngleX ±30"
  (carried over from Session 26 §7) may now be partially masked by the
  new neck-corner shapekey. Worth re-checking visually; if still present,
  a small CPart opacity bind or a dedicated neck vertex shift could
  close the remaining gap.
