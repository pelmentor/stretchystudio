# Session 27 Findings — cmo3writer.js refactor (Phases A–F, full split)

**Date:** 2026-04-21 (same calendar day as Session 26; started right after
the Session 26 doc commit).
**Scope:** structural extraction of the entire 4983-line `cmo3writer.js`
into a `cmo3/` sub-package. No feature changes, no behavior changes.
**Status at session end:** Phases A–F all landed. cmo3writer.js is now
**3700 lines** (−25.7%) with 5 new cohesive sibling modules in `cmo3/`.

**Verification performed:**
1. `node --check` on every touched file (all pass).
2. Dynamic `import()` smoke test of `cmo3writer.js` and `exporter.js`
   (both load, original exports preserved).
3. **End-to-end smoke test with minimal input** — `generateCmo3` called
   with `generateRig: false` produces a 6219-byte cmo3. No ReferenceError.
4. **End-to-end smoke test with `generateRig: true` + tagged meshes**
   exercising FaceParallax super-groups (eye-l/eye-r), pair symmetrization
   (A.3), grid-cell expansion (A.6b), computeFpKeyform rotation math,
   #3 eye amp + #5 far-eye squash, symmetrizeKeyform at ax=0, and the full
   Face Rotation + Neck Warp chain. Produces a 30185-byte cmo3. No
   ReferenceError — confirms every closure dependency is correctly
   threaded through each helper's `ctx` bag.
5. **Still pending:** manual browser export of shelby / girl / waifu for
   byte-level equivalence with the Session 26 baseline (see §6).

---

## 1. What was extracted

### Phase A — `cmo3/constants.js` (146 lines, new)

Module-level data constants out of cmo3writer:
- `VERSION_PIS`, `IMPORT_PIS` (XML processing instructions)
- `FILTER_DEF_LAYER_SELECTOR`, `FILTER_DEF_LAYER_FILTER` (editor-hardcoded UUIDs)
- `DEFORMER_ROOT_UUID` (`CDeformerGuid.ROOT` fixed UUID)

Pure data, no behavioral risk.

### Phase B — `cmo3/pngHelpers.js` (186 lines, new)

PNG synthesis utilities:
- `buildRawPng(w, h)` — raw white RGBA PNG (IHDR/IDAT/IEND, uncompressed
  deflate blocks).
- `extractBottomContourFromLayerPng(pngData, xMin, xMax)` — P12 helper for
  the eye-closure parabola fit.

Private helpers kept module-local: `deflateUncompressed`, `crc32Buf`,
`CRC_TABLE_PNG`.

**Dead code removed in this phase:**
- `imageToPng(img, w, h)` — never called anywhere in the codebase
- `makeMinimalPng(w, h)` — never called anywhere in the codebase

Confirmed via full `src/` grep.

### Phase C — XML helpers audit (no-op)

`xmlbuilder.js` is already a clean shared module (used by `cmo3writer.js`
and `can3writer.js`). Instance methods on `XmlBuilder` are the right
abstraction; no extra wrapping helps. Audit ended with zero extractions.

### Phase D — `cmo3/deformerEmit.js` (149 lines, new)

Four warp / keyform emit helpers that were inline closures inside
`generateCmo3`:
- `makeUniformGrid(col, row, minVal, maxVal)` — pure, no deps
- `emitKfBinding(x, kfbNode, ...)` — takes `x` as first param
- `emitSingleParamKfGrid(x, pidParam, keys, description)` — uses `x` + `uuid`
- `emitStructuralWarp(x, ctx, name, idstr, ...)` — uses `x` + a 3-field
  `ctx` bag `{ allDeformerSources, pidPartGuid, rootPart }`.

18 call sites in cmo3writer.js updated.

### Phase F — `cmo3/bodyRig.js` (239 lines, new)

Two self-contained deformer-emission blocks:
- `emitNeckWarp(x, ctx)` → `pidNeckWarpGuid | null`. 6×6 warp, 3 keyforms
  on ParamAngleZ, Y-gradient bending (NECK_TILT_FRAC = 0.08).
- `emitFaceRotation(x, ctx)` → `pidFaceRotGuid`. 3-keyform rotation
  deformer, pivot at chin, ±10° cap.

Both accept the closure's previously-captured names via a single `ctx`
object.

### Phase E — `cmo3/faceParallax.js` (731 lines, new)

The biggest extraction. Single exported `emitFaceParallax(x, ctx)` that
contains:
- Rest-grid build in Face Rotation's local frame (canvas-pixel offsets).
- Symmetric face-mesh radius (A.1) for guaranteed L/R mirror geometry.
- Cylindrical dome depth function `fpZAt(u)`.
- Protected region table (PROTECTION_PER_TAG, SUPER_GROUPS).
- A.3 L/R pair symmetrization (|u|, v, z, halfU/V averaging).
- A.6b grid-cell rigid-zone expansion (halfU/V += cellU/V).
- `computeFpKeyform(ax, ay)` — 3D rotation + #3 eye-parallax amp + #5
  far-eye squash.
- `symmetrizeKeyform(pos)` — anti-symmetric X / symmetric Y shift
  enforcement at ax=0.
- 9-keyform generation + `CWarpDeformerSource` emit.

Returns `pidFpGuid`; caller stores in `faceParallaxGuids.set('__all__', …)`
for downstream rig-warp reparenting.

**Dead code dropped:** `mirrorKeyform(srcPos)` (+ its `fpBboxCenterX` /
`mirrorKx` constants) — declared but never invoked in the keyform loop
(only `symmetrizeKeyform` is used). Same pattern as Phase B's dead-code
drops.

---

## 2. Results

| File | Before | After | Δ |
|---|---:|---:|---:|
| `cmo3writer.js` | 4983 | **3700** | **−1283 (−25.7%)** |
| `cmo3/constants.js` | 0 | 146 | +146 |
| `cmo3/pngHelpers.js` | 0 | 186 | +186 |
| `cmo3/deformerEmit.js` | 0 | 149 | +149 |
| `cmo3/bodyRig.js` | 0 | 239 | +239 |
| `cmo3/faceParallax.js` | 0 | 731 | +731 |
| **Total** | 4983 | 5151 | **+168** |

Net +168 lines across the project because each new module has frontmatter,
`export` keywords, and JSDoc. The goal wasn't total line count — it was
shrinking cmo3writer and giving each sub-system a cohesive file where a
future reader can jump in without scrolling through 5000 lines of
unrelated logic.

---

## 3. Verification performed

1. `node --check` on cmo3writer.js + all 5 new modules — PASS
2. `node -e "import(...)"` on both cmo3writer.js and exporter.js — PASS
3. End-to-end `generateCmo3` smoke test (`generateRig: false`) — PASS,
   produced 6219-byte cmo3 with no runtime errors.
4. End-to-end `generateCmo3` smoke test (`generateRig: true`) with a
   14-mesh tagged synthetic character (face / eyes / ears / brows / nose /
   mouth / neck + head group) — PASS, produced 30185-byte cmo3 and
   exercised every extracted module (FaceParallax super-groups, A.3
   pairing, A.6b expansion, the full `computeFpKeyform` hot loop with
   #3 + #5 effects, `symmetrizeKeyform` at ax=0, Face Rotation emit,
   Neck Warp emit).
5. Grep for orphan references to internal names that moved into modules
   (`protectedRegions`, `fpUVZ`, `fpCol`, `computeFpKeyform`,
   `pidFaceRotDf`, `nwGridPositions`, etc.) in cmo3writer.js — zero matches.

**Not yet done** (for user to verify before shipping further work):
- Manual browser export of shelby / girl / waifu. `node` smoke tests
  run the full code path, but `OffscreenCanvas` / `Image` / `crypto` are
  polyfilled slightly differently in node vs. the real browser. Any
  browser-specific path in `buildRawPng` / `extractBottomContourFromLayerPng`
  should be re-validated in the actual IDE before merging this into
  downstream work.

---

## 4. Files changed

- `src/io/live2d/cmo3writer.js` — 4983 → **3700** lines (all 5 extractions)
- `src/io/live2d/cmo3/constants.js` — **NEW** (146 lines)
- `src/io/live2d/cmo3/pngHelpers.js` — **NEW** (186 lines)
- `src/io/live2d/cmo3/deformerEmit.js` — **NEW** (149 lines)
- `src/io/live2d/cmo3/bodyRig.js` — **NEW** (239 lines)
- `src/io/live2d/cmo3/faceParallax.js` — **NEW** (731 lines)
- `docs/live2d-export/SESSION_27_FINDINGS.md` — this file

`exporter.js` unchanged. Downstream consumers (`exporter.js`,
`caffPacker.js`, `xmlbuilder.js`, …) all still load through the refactor.

---

## 5. Module ownership after refactor

```
src/io/live2d/
├── cmo3writer.js               # orchestrator: params, parts, meshes,
│                               # per-mesh rig warps, CArtMeshSource,
│                               # main.xml assembly, CAFF packing
├── cmo3/
│   ├── constants.js            # VERSION_PIS, IMPORT_PIS, filter UUIDs
│   ├── pngHelpers.js           # buildRawPng, P12 bottom-contour
│   ├── deformerEmit.js         # makeUniformGrid, emitKfBinding,
│   │                           # emitSingleParamKfGrid, emitStructuralWarp
│   ├── bodyRig.js              # emitNeckWarp, emitFaceRotation
│   └── faceParallax.js         # emitFaceParallax (biggest: regions,
│                               # A.3, A.6b, computeFpKeyform, #3, #5,
│                               # symmetrizeKeyform, deformer emit)
├── bodyAnalyzer.js             # analyzeBody (in use — not dead code)
├── caffPacker.js               # CAFF archive layout
├── can3writer.js               # (sibling: .can3 animation export)
├── exporter.js                 # entry point
├── xmlbuilder.js               # shared XmlBuilder class + uuid()
└── (other pipeline files)
```

`bodyAnalyzer.js` was flagged in Session 26 as potentially dead — it is
NOT dead; cmo3writer.js imports `analyzeBody` from it. Leaving it at
`src/io/live2d/` next to other siblings (not moved into `cmo3/`).

---

## 6. Next session

Refactor work is complete. The next session should be feature work or
the deferred `AngleX ±30 neck-layer exposure` fix from Session 26 §7 —
both now landing in a far more navigable codebase. Before the next session
starts making changes, **please export shelby in the browser once** to
confirm the refactor is behaviorally identical to Session 26's state;
the node smoke test verifies every code path runs, but not that the
actual keyform bytes match.

If anything looks different, the five git diffs to investigate are, in
rough order of likelihood:
1. `cmo3/faceParallax.js` — biggest surface, easiest to typo a closure
   variable.
2. `cmo3/bodyRig.js` — `emitFaceRotation` / `emitNeckWarp` ctx destructure.
3. `cmo3/deformerEmit.js` — `emitStructuralWarp` ctx destructure.
4. `cmo3/pngHelpers.js` — dead-code drop (`imageToPng`, `makeMinimalPng`).
   Can't affect behavior, but good to sanity-check.
5. `cmo3/constants.js` — pure data; shouldn't be the culprit.
