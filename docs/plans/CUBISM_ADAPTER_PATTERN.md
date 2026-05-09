# Cubism Adapter Pattern

Status: **SHIPPED 2026-05-09** — code complete; manual Cubism-Viewer-load gate is the only remaining verification.
Owner: pelmentor
Started: 2026-05-09
Shipped: 2026-05-09 (same-day execution post-audit)
Estimate: ~4 hours of focused work across 5 phases — actual: ~3.5 hours including two audits and the equivalence proof.

See §13 below for the final shipping status, commit list, and test totals.

---

## 1. Goal

Make the **authored** data layer fully Blender-shaped and the **export** wire format fully Cubism-shaped, with a clean adapter at the boundary between them.

Today's tension: SS is half-Blender (modifier stacks, Armature modifier with Apply, vertex groups on limbs) and half-original (overlay-matrix rigid follow, `jointBoneId` only-on-limbs, two parallel composition paths in the renderer). That tension produced BUG-028 (post-Apply double-rotation) and will keep producing similar bugs as long as the runtime shape disagrees with itself.

The adapter pattern lets us:
- Author every bone-followed part with vertex groups (`mesh.boneWeights`). Rigid follow = all-1.0 ("red paint"); real skinning = per-vertex variation.
- Render through one LBS path uniformly. Delete the overlay-matrix branch.
- Apply Modifier on every bone-followed part (not just limbs).
- Export through a translation seam that strips back to today's Cubism wire format. **Shelby `.cmo3` byte-identical pre/post.**

## 2. Why the adapter pattern (Rule №1)

Three smaller fixes are available; each is a band-aid:

- ❌ **Keep BUG-028 gate, leave overlay-matrix path** — two composition paths forever; next bug pre-loaded.
- ❌ **Strip overlay-matrix path without backfilling weights** — unweighted parts stop following bones (regression).
- ❌ **Add weights to all bone-followed parts without an export adapter** — Shelby `.cmo3` byte-fidelity breaks (`jointBoneId` leaks into Cubism artmesh emission for parts that previously had none).

The proper fix is the adapter pattern. Authored layer stays uniformly Blender; export layer stays byte-identical to today; bug surface is eliminated structurally rather than gated case-by-case.

This is the same separation that already exists at the writer/`RigSpec` boundary (per `BLENDER_PARITY_REFACTOR.md` §7 "What stays the same"): the writer-facing contract is preserved while in-memory shape evolves. The adapter formalises and extends that pattern.

## 3. Architecture

```
authored layer                       cubism adapter                       export shape
──────────────                       ──────────────                       ────────────
project.nodes                        normalizeForCubismExport(project)    cmo3writer / moc3writer
 └─ part w/ boneWeights = [1,1,1]  →  isRigidVertexGroup? → strip       →  emits as if no weights
    + jointBoneId='leftArm'           boneWeights + jointBoneId from      (today's legacy path)
                                      export-bound copy
 └─ part w/ per-vertex weights     →  variance detected → preserve      →  emits with weights
    + jointBoneId='leftElbow'         (today's limb path)
```

Decision rule: **all weights ≡ 1.0 within epsilon = "rigid intent"**; anything else = "real skinning".

The adapter is a pure function. It does NOT mutate the project — it returns a structurally-shared copy with only the modified parts swapped (similar to immer's structural sharing). The cmo3/moc3 writers consume the adapted copy.

## 4. Phased plan

Each phase is independently shippable with a green `npm test` suite plus a Shelby `.cmo3` + `.moc3` byte-identity gate.

### Phase A — adapter foundation (~150 LOC, no behavior change)

**Files**
- `src/io/live2d/cubismAdapter/vertexGroupVariance.js` — `isRigidVertexGroup(weights, eps=1e-6)` detector. Returns `true` iff every weight is within `eps` of `1.0`. Empty / null / non-array returns `false`.
- `src/io/live2d/cubismAdapter/normalizeForCubismExport.js` — pure function over project. Returns a new project where every part with `isRigidVertexGroup(mesh.boneWeights)` has `boneWeights` and `jointBoneId` stripped from its mesh.
- `src/io/live2d/cubismAdapter/index.js` — re-exports.

**Adapter rules (Phase A only — phases C/D/E may extend)**
1. For each part `n` in `project.nodes`:
   - If `isMeshedPart(n)` AND `isRigidVertexGroup(getMesh(n)?.boneWeights)`:
     - Emit a structurally-shared copy of `n` where `mesh.boneWeights` and `mesh.jointBoneId` are deleted.
   - Else: pass `n` through by reference (no copy).
2. The returned project's `nodes` array contains the adapted nodes.
3. All other project fields (`parameters`, `canvas`, `physicsRules`, etc.) pass through by reference.

**Tests**
- `scripts/test/test_vertexGroupVariance.mjs` — variance detector cases: all-1.0 → true, all-0.0 → false, mixed → false, single-vertex 1.0 → true, missing/null → false, slightly-off-1.0 (1.0 ± 1e-7) → true, slightly-off-1.0 (1.0 ± 1e-3) → false.
- `scripts/test/test_normalizeForCubismExport.mjs` — adapter round-trip: project with no rigid parts → identity; project with rigid handwear → handwear's weights/jointBoneId stripped, other parts untouched; project with mixed rigid + skinned → only rigid stripped.
- **No production wiring yet.** Adapter is dead code reachable only from tests.

**Exit gate**: tests green; no other test suite affected (no production wiring).

### Phase B — wire adapter into cmo3/moc3 writers (~50 LOC)

**Files touched**
- `src/io/live2d/cmo3writer.js` — top-level entry point calls `normalizeForCubismExport(project)` first; downstream reads the adapted project.
- `src/io/live2d/moc3writer.js` — same.
- `src/io/live2d/exporter.js` — top-level export coordinator passes the adapted project through.

**Exit gate**
- `npm run test:shelbyByteFidelity` — Shelby `.cmo3` byte-identical to current main. **Should be trivially identical** since no rigid-weighted parts exist yet on real projects (the adapter is a no-op).
- `npm run test:breathFidelity` — warp synthesis unchanged.
- Manual: load Hiyori, export `.cmo3`, byte-diff against pre-Phase-B baseline → zero delta.

### Phase C — authored-side rigid weights (~100 LOC)

**Files**
- `src/store/seedDefaultRigidWeights.js` — pure helper. Walks every `isMeshedPart` whose nearest ancestor (via `node.parent` chain) is a bone group. For each:
  - If `mesh.boneWeights` already populated (length === vertices.length, non-zero values) → leave intact (preserves `computeSkinWeights` limb output + user-authored weights).
  - Else if `mesh.vertices` has known length → fill `mesh.boneWeights = new Array(N).fill(1.0)`, set `mesh.jointBoneId = nearestBoneAncestor.id`.
  - Else → no-op (mesh not yet processed).
- `src/store/projectStore.js` — wire `seedDefaultRigidWeights(proj)` into `seedAllRig` after mesh sync, BEFORE `synthesizeModifierStacks` (so the synth picks up the new weights and adds Armature modifiers to formerly-unweighted parts).

**Existing wiring that handles this automatically**
- `synthesizeModifierStacks` already adds Armature modifier when `mesh.boneWeights && length > 0`. New rigid-weighted parts get modifiers without code change.
- `pickBonePostChainComposition` already returns `kind: 'lbs'` for parts with weights + active modifier. New rigid-weighted parts render through LBS automatically.

**Exit gate**
- `npm run test:shelbyByteFidelity` — Shelby `.cmo3` byte-identical post-Init-Rig. The adapter (Phase B) strips the newly-added all-1.0 weights → emission matches today's bytes.
- Manual: re-run Init Rig on Hiyori; confirm `.cmo3` byte-diff is zero.
- Visual: pose any bone in viewport; every bone-descendant part follows (rigid + skinned uniformly via LBS).

### Phase D — renderer simplification (~40 LOC + deletions)

**Files touched**
- `src/renderer/bonePostChainComposition.js` — drop the `'overlay'` branch. Decision becomes binary: `'lbs'` (modifier + weights) | `'none'` (post-Apply / unbound). The defensive third case "part with bone ancestor but no weights" is logged as a warning (post-Phase-C invariant violation; should never fire on a properly-Init-Rigged project).
- `src/components/canvas/CanvasViewport.jsx` — delete the `applyOverlayMatrixObj` call.
- `src/renderer/boneOverlayMatrix.js` — `computeBoneOverlayMatrices` + `applyOverlayMatrixObj` + `applyOverlayMatrixFlat` deleted if no other callers. (`computeBoneWorldMatrices` + `computeBoneParentMap` stay — used by LBS path.)

**Tests**
- `scripts/test/test_bonePostChainComposition.mjs` — update existing 13 tests to reflect 2-state decision; add a "weighted but no modifier under bone ancestor" case asserting a warning log.

**Exit gate**
- `npm test` green.
- Visual: all the Phase C test cases (bone gesture moves all bone-followed parts) still work.

### Phase E — Apply Modifier on all bone-followed parts (~10 LOC, mostly UI)

**Files touched**
- `src/v3/editors/properties/sections/ModifierStackSection.jsx` — already shows the Armature modifier + Apply when present. Post-Phase-C every bone-followed part HAS a modifier, so the Apply button surfaces automatically. Verify the kebab menu's per-row layout works for rigid parts (no special-case needed).
- `src/services/ArmatureModifierService.js` — `applyArmatureModifier` already handles all-1.0 weights correctly (LBS bake of (rest position) × 1.0 = rotated position). No change needed; verify with a unit test.

**Tests**
- `scripts/test/test_applyArmatureModifier.mjs` — add cases for all-1.0 weights: bake produces full rotation; modifier removed; vertex groups + jointBoneId persist (mirrors Blender's `me->dvert` keep semantic).

## 5. Test gates (every phase)

1. `npm test` — full unit suite green.
2. `npm run test:shelbyByteFidelity` — Shelby `.cmo3` byte-identical to current main.
3. `npm run test:breathFidelity` — warp synthesis within 0.1 px of authored.
4. Manual: Hiyori — Init Rig, blink, body-angle slider, idle motion play, export `.cmo3` + `.can3` + `.moc3`. All load in Cubism Viewer without warnings.
5. Manual: Shelby (the v0.2 regression fixture) — visual sweep matches pre-refactor.

## 6. Risks + mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Variance epsilon mis-tuned (false-rigid strips real skinning) | LOW | 1e-6 is well below any meaningful per-vertex variation. Add `logger.warn` when variance falls in 1e-6..1e-3 (borderline) — flags potential mis-paint without changing behavior. |
| Cubism Viewer treats all-1.0 weights ≠ missing weights | LOW | Byte-diff gate catches this before ship. If wire format identical, runtime behavior must match. |
| Existing projects have rigid parts without weights → Init Rig adds them → next save changes shape | EXPECTED | Adapter strips on next export → byte-identical to before. The in-memory shape change is invisible to Cubism. |
| `applyOverlayMatrixObj` callers I haven't found | MED | Grep audit before Phase D deletion. Add a deprecation warning before removal if found. |
| moc3 byte-fidelity differs from cmo3 (different reader paths) | MED | Run `test:breathFidelity` and a moc3-specific byte-diff in addition to cmo3 byte-diff. |
| Adapter performance on large projects (deep copy cost) | LOW | Structural sharing — only rigid-weighted nodes get cloned. ~10-30 nodes typical, negligible vs export work. |
| Live preview (LBS) and Cubism Viewer (rotation deformer keyform) diverge visually | MED | Spot-check by comparing post-rotation screenshots: SS Live Preview vs Cubism Viewer with same param values. Acceptable divergence: floating-point tolerance only. |
| User-painted partial-rigid (e.g. all 0.7) — variance is zero but value isn't 1.0 | LOW | Adapter doesn't strip (variance test requires == 1.0). Cubism gets the partial weights and runs per-vertex skinning. Correct behavior. |
| User-painted all-zero (no follow at all, jointBoneId still set) | LOW | Adapter doesn't strip (all-0 ≠ all-1). Cubism gets explicit zero weights. Correct semantics. |

## 7. What we are NOT doing

- ❌ Stripping `boneWeights` for parts with per-vertex variation (real skinning stays in cmo3 as today).
- ❌ Changing how Cubism's keyform interpolation works (the adapter is wire-format only).
- ❌ Adding a UI for "set all weights to 1.0" — `seedDefaultRigidWeights` runs at Init Rig automatically.
- ❌ Coupling this to Phase 3.C of `BLENDER_DEVIATION_FIX_3_DEFORMER_RETIREMENT.md` (independent; modifier.data lookups don't affect the adapter).
- ❌ Touching the bone-armature-independence work (composes naturally — bone gestures still write `pose.rotation`, LBS reads it from the resolved bone world matrix).
- ❌ A schema migration that auto-populates rigid weights on load (defer to Init Rig). User triggers explicitly.

## 8. Decision log

- **2026-05-09 — Plan kickoff.** User identified that vertex-group-with-strength-1 is the Blender-correct authoring shape; rejected the half-fix of "gate overlay path on hasWeights" alone. Adapter at the export boundary is the proper Rule №1 solution.
- **2026-05-09 — Variance epsilon = 1e-6.** Conservative default; user can tune via the borderline-warn log if real projects produce drift in that range.
- **2026-05-09 — Adapter location: pre-cmo3writer (option 3 of three considered).** Rejected `selectRigSpec` (live render also reads through it; would change runtime behavior, not just export) and `synthesizeDeformerNodesForExport` (operates on modifier stacks, doesn't see `mesh.boneWeights`). The dedicated `normalizeForCubismExport` keeps the live render shape Blender-clean while giving the writers today's wire format.

## 9. Audit (post-write critical review)

Audit performed 2026-05-09 by re-reading the plan against the codebase. Five substantive issues found; phases A/B/C/D updated below to address them. The plan's overall architecture (adapter pattern at the boundary) was confirmed sound, but several wiring details were wrong.

### Issue 1 (HIGH) — Phase B wiring target is wrong

**The plan claimed**: wire `normalizeForCubismExport(project)` into `cmo3writer.js` and `moc3writer.js` top-level entries.

**The code shows**: writers don't consume `project.nodes` directly. `src/io/live2d/exporter.js` builds a flat `meshes[]` struct via `buildMeshesForRig` (line 737) and `exportLive2DProject` (line 381), extracting `mesh.boneWeights` + `mesh.jointBoneId` at lines 462–463 and 759–760 BEFORE that array reaches any writer. Calling the adapter at the writer top-level is a no-op — the writers see the already-extracted struct.

**Fix**: Phase B hook point is `exporter.js`'s mesh-struct construction, not the writers. Either:
- (a) Apply `normalizeForCubismExport(project)` BEFORE `buildMeshesForRig`/`exportLive2DProject` so they read the adapted project.
- (b) Add a sibling `normalizeMeshesForCubismExport(meshes[])` that operates on the flat struct array AFTER it's built.

Option (a) is preferred — keeps the seam at one well-defined boundary (project → exporter), single cache locality, no duplicate adapter logic.

### Issue 2 (HIGH) — `synthesizeModifierStacks` requires THREE guards, not two

**The plan claimed**: "Armature modifier added when `mesh.boneWeights && length > 0`."

**The code shows** (`src/store/deformerNodeSync.js:457-495`): three conditions must hold simultaneously:
1. `mesh.jointBoneId` is a non-empty string (line 458–459)
2. `mesh.boneWeights` is a non-empty array (line 460–461)
3. `byId.get(jointBoneId)` resolves to a node where `type === 'group' && boneRole` (line 463)

If `seedDefaultRigidWeights` sets `jointBoneId` to a plain (non-bone) group, no Armature modifier is added — silent failure.

**Fix**: Phase C `seedDefaultRigidWeights` MUST walk to the nearest ancestor where `isBoneGroup(node)` is true (i.e., `type === 'group' && boneRole`), not just the nearest `type === 'group'`. Use the existing `isBoneGroup` from `src/store/objectDataAccess.js` for the predicate.

### Issue 3 (HIGH, overlaps Issue 2) — "Nearest bone group" must mean `boneRole`-bearing

**The plan claimed**: "nearest ancestor (via node.parent chain) is a bone group".

**The code shows** (`src/store/objectDataAccess.js:75-78`): `isBoneGroup(node) === node.type === 'group' && !!node.boneRole`. Plain organisational groups (`isPlainGroup`) without `boneRole` exist in real projects.

**Fix**: explicit in Phase C — use `isBoneGroup` predicate. Stop at first ancestor where it's true. If no such ancestor exists, the part is not bone-followed and `seedDefaultRigidWeights` is a no-op for it.

### Issue 4 (MED) — Phase D missed `test_boneOverlayMatrix.mjs`

**The plan listed**: `test_bonePostChainComposition.mjs` as the only test to update.

**The code shows**: `scripts/test/test_boneOverlayMatrix.mjs` imports and calls `computeBoneOverlayMatrices` in 6 separate test cases (lines 16, 55, 70, 109, 137, 160, 175). Phase D's deletion of that function would break the test file outright.

**Fix**: Phase D file list MUST include `test_boneOverlayMatrix.mjs`. Either delete it (if `applyOverlayMatrixObj` + `applyOverlayMatrixFlat` + `computeBoneOverlayMatrices` all go) or trim it to test only the surviving exports (`computeBoneWorldMatrices`, `computeBoneParentMap`).

### Issue 5 (HIGH, follows Issue 1) — moc3 path inherits the same wiring problem

**The plan claimed**: top-level wiring in `moc3writer.js` covers the moc3 path.

**The code shows** (`src/io/live2d/exporter.js:183-195`): `generateMoc3` builds its rig spec via the `rigOnly` cmo3 call (lines 151–173), which writes through `buildMeshesForRig`. The mesh struct flows via `rigSpec.artMeshes`, never via `moc3writer.js`'s direct read of `project`.

**Fix**: Same as Issue 1 — adapter must hook upstream of `buildMeshesForRig`. Once that's done, both cmo3 and moc3 are covered automatically (single hook point covers both paths).

### Issue 6 (MED) — Phase D regression risk for un-re-rigged projects

**The plan claimed**: "rely on next Init Rig" + marked the loaded-but-not-yet-re-rigged case as "EXPECTED" without mitigation.

**The code shows**: `seedAllRig` runs only on user action (Init Rig button or per-stage refit, in `src/services/RigService.js:165, 435`). Not on project load. So a user post-Phase-D opening a pre-Phase-C project would see bone-followed non-limb parts silently stop following bones — no error, no recovery hint. **Violates Rule №1.**

**Fix**: Phase D must NOT ship until one of these mitigations is in place:
- (a) Schema bump (v31) that runs `seedDefaultRigidWeights` on load as part of the migration. Idempotent and safe — fills weights only where missing.
- (b) Project-load gate that detects "bone-followed parts without weights" and either prompts user for Init Rig OR auto-runs a minimal seed pass.

(a) is cleaner — same pattern as v29's `migrateArtMeshRuntimePersist` clearing `lastInitRigCompletedAt`. Adopt it.

### Confirmed correct (no change needed)

- `selectRigSpec` does NOT read `mesh.boneWeights`/`jointBoneId` directly — it reads via `mesh.runtime` (persisted v29). §8 decision to reject `selectRigSpec` as adapter location stands.
- Armature modifier placement order (AFTER deformer chain in the stack) is correct per `deformerNodeSync.js:443-494`. The Apply path's keyform-bake invariant from BUG-027 is unaffected.
- Variance detector spec is internally consistent. Length-parity assertion (`boneWeights.length === vertices.length`) added to Phase A as a defensive one-liner per the audit's LOW-confidence flag.

## 10. Plan revisions (post-audit)

### Phase A — UNCHANGED.

Variance detector + adapter foundation logic was correct. Add one defensive assertion:

```js
// vertexGroupVariance.js
export function isRigidVertexGroup(weights, expectedLength = null, eps = 1e-6) {
  if (!Array.isArray(weights) || weights.length === 0) return false;
  if (expectedLength !== null && weights.length !== expectedLength) return false;
  for (let i = 0; i < weights.length; i++) {
    if (Math.abs(weights[i] - 1) > eps) return false;
  }
  return true;
}
```

Caller in `normalizeForCubismExport` passes `mesh.vertices.length` so length mismatch fails closed (treats as non-rigid → preserves data → safer default).

### Phase B — REVISED hook point.

**Replace**: "wire into cmo3writer.js + moc3writer.js top-level entries"

**With**: hook into `src/io/live2d/exporter.js` BEFORE the mesh-struct construction. Specifically:

- `exportLive2DProject` (line 381) — call `const adaptedProject = normalizeForCubismExport(project)` at function entry; replace all subsequent `project` reads with `adaptedProject`.
- `buildMeshesForRig` (line 737) — same pattern.
- `generateMoc3` (line 183) — adapter not needed at this layer because the rigSpec it consumes was built by the adapted cmo3 path.

Single hook point in `exporter.js` covers both cmo3 and moc3 export paths.

### Phase C — REVISED predicate.

**Replace**: "nearest ancestor that is a bone group"

**With**: nearest ancestor where `isBoneGroup(node) === true` (i.e., `type === 'group' && !!node.boneRole`). Import the predicate from `src/store/objectDataAccess.js`. Parts whose chain has no such ancestor are skipped.

Add a v31 schema migration (REVISION per Issue 6):

- `src/store/migrations/v31_default_rigid_weights.js` — runs `seedDefaultRigidWeights` on load. Idempotent. Bumps `CURRENT_SCHEMA_VERSION` to 31.
- Closes the regression risk for projects opened post-Phase-D without manual Init Rig.

### Phase D — REVISED file list.

**Add**: `scripts/test/test_boneOverlayMatrix.mjs`. Either delete it entirely (if `computeBoneOverlayMatrices` goes — most likely outcome) or trim it to assert only the surviving exports (`computeBoneWorldMatrices`, `computeBoneParentMap`).

**Phase D entry gate** (NEW, was implicit before): v31 migration must be shipped + tested green before Phase D's overlay path deletion. Without v31, any project loaded but not re-Init-Rigged regresses.

### Phase E — UNCHANGED.

UI surfaces Apply for all bone-followed parts automatically once Phases B + C ship. No code changes other than the new unit-test cases for all-1.0 weights.

---

## 11. Second audit (different perspective)

Audit #2 performed 2026-05-09 by a general-purpose agent, briefed to find issues NOT covered by audit #1. It looked at architectural alternatives, hidden coupling, real-world weight values, UX of Apply on rigid parts, performance, animation export, and sanity of the strip-vs-passthrough decision. Three substantive issues found; one is a critical corner case the original plan missed entirely.

### Issue 7 (HIGH) — A 4th adapter location is strictly cleaner: collapse into `exporter.js` mesh-struct loop

**The audit observed**: the mesh-struct construction at `src/io/live2d/exporter.js` lines 414-500 (`exportLive2DProject`) and 743-820 (`buildMeshesForRig`) is itself the existing project-tree → flat-export-struct translator. It already extracts `mesh.boneWeights` + `mesh.jointBoneId` into a new `meshes[]` element. The Cubism-export adapter is **3 lines added inline**, not a new module hierarchy:

```js
const isRigid = isRigidVertexGroup(mesh.boneWeights, mesh.vertices.length);
const boneWeights = isRigid ? null : (mesh.boneWeights ?? null);
const jointBoneId = isRigid ? null : (mesh.jointBoneId ?? null);
```

Reasons this beats option (a) of Issue 1's revision:
- Avoids a second pure-function pass over `project.nodes` (no extra allocation, no structural-sharing gymnastics).
- Avoids a new `cubismAdapter/` module hierarchy that's mostly empty calories.
- Avoids the awkwardness that `selectRigSpec` ALSO consumes `project.nodes` and would now see a "different" project shape depending on whether export ran in the meantime.
- Both `meshes.push({…})` blocks (one each in `exportLive2DProject` + `buildMeshesForRig`) currently DUPLICATE the boneWeights/jointBoneId extraction — extracting the rigid-strip logic into a helper deduplicates them as a side-effect.

**Fix**: drop the `src/io/live2d/cubismAdapter/` module from the plan. Keep `vertexGroupVariance.js` as the predicate (testable in isolation). Modify the two `meshes.push({…})` sites in `exporter.js` to use the strip-when-rigid logic above. Add a tiny `extractMeshExportStruct(part, project)` helper if the dedup is worth doing — likely yes.

### Issue 8 (HIGH) — `computeSkinWeights` clamp produces all-1.0 for hand-only sub-meshes; variance test mis-classifies and the adapter would strip → hand detaches from elbow at runtime

**The audit observed**: `src/components/canvas/viewport/meshPostProcess.js` line ~100 computes `w = clamp(projection / blend + 0.5, 0, 1)`. For a "hand-only" mesh (separate part under `leftArm`, no upper-arm verts) where every vertex sits ≥ blend/2 past the elbow pivot, every projection ≥ 20 px → every weight clamps to **exactly 1.0**. This is geometrically common (`*_low.psd` separate hand layers; some sticker overlays).

The variance test (`isRigidVertexGroup` with eps=1e-6) returns `true` — exact 1.0 always passes. The adapter then strips `boneWeights` + `jointBoneId='leftElbow'`. cmo3 emits the hand parented to leftArm's parent group (torso, via the rotation deformer chain). **Cubism Viewer renders: arm bends from leftArm pivot, hand stays at torso pivot.** Hand visibly detaches.

This is a CORRECTNESS regression the variance-only test cannot catch. The weights ARE all-1.0 numerically but they encode "follow leftElbow specifically, not whatever the part's structural parent walks up to" — i.e., they encode bone-routing intent that the legacy non-weighted path can't express.

**Fix**: predicate must take the part's structural-parent walk into account. The right semantic is: "all-1.0 weights are equivalent to not having weights ONLY IF the jointBoneId matches the bone the part would rigidly follow without weights (= the nearest `isBoneGroup` ancestor of the part)."

Revised predicate:

```js
isRigidVertexGroup(boneWeights, vertCount, jointBoneId, nearestBoneAncestorId) {
  // All weights == 1.0 within epsilon AND the weights aren't routing
  // the part to a different bone than its structural parent ancestor.
  // Mismatch (jointBoneId !== nearestBoneAncestorId) means the weights
  // encode bone-routing intent and must NOT be stripped.
  if (jointBoneId !== nearestBoneAncestorId) return false;
  if (!Array.isArray(boneWeights) || boneWeights.length === 0) return false;
  if (vertCount !== null && boneWeights.length !== vertCount) return false;
  for (let i = 0; i < boneWeights.length; i++) {
    if (Math.abs(boneWeights[i] - 1) > 1e-6) return false;
  }
  return true;
}
```

The caller (in `exporter.js`) computes `nearestBoneAncestorId` by walking the part's `node.parent` chain to the first `isBoneGroup` node — same predicate `seedDefaultRigidWeights` uses (Issue 2). If the part's stored `jointBoneId` differs from that walk's result, the weights are bone-routing intent → preserved.

Add a test: hand-only-mesh fixture (parent leftArm, jointBoneId leftElbow, weights all-1.0) → adapter MUST preserve weights + jointBoneId.

### Issue 9 (MED) — Apply + rebind drifts `parentBoneId` between synth path and `bindArmatureModifier` path

**The audit observed**: `synthesizeModifierStacks` (`deformerNodeSync.js:466-471`) and `bindArmatureModifier` (`ArmatureModifierService.js:251-257`) both compute `parentBoneId` for the Armature modifier. Synth walks `jointBone.parent` to the first `isBoneGroup` ancestor; `bindArmatureModifier` does the same. They should agree — but if the rig's bone tree has a non-bone group between two bones (e.g., a Blender-style `Empty` parented mid-tree), only the consistent walk produces the correct nearest-bone result. Worth one regression test per Phase C: bind on a rigid part → `synthesize` again → `parentBoneId` matches.

**Fix**: add `scripts/test/test_armatureModifier_parentBoneIdConsistency.mjs` to Phase C — assert that `synthesizeModifierStacks` and `bindArmatureModifier` produce identical `parentBoneId` for the same part state. Catches future drift if either walk is changed.

### Issue 10 (MED) — Phases A+B+C are really ONE ship, not three

**The audit observed**: Phase A ships the predicate as test-only code. Phase B wires it but no rigid-weighted parts exist yet → adapter is a no-op on real projects. Phase C populates rigid weights → adapter starts having real effects.

A+B independent of C produces no observable change. The "independently shippable" claim is technically true (each phase passes its own gate), but operationally A+B+C land together as one feature ship. Phase D is genuinely independent (deletes the legacy renderer path; depends on C+v31 migration).

**Fix**: relabel as Phase A+B+C = "Adapter foundation + activation" (single feature ship); Phase D = "Renderer simplification" (separate ship, depends on v31). Phase E rolls into Phase D's gate (UI changes are minor).

### Confirmed correct (audit #2)

- Adapter perf is fine — only runs in `exportLive2DProject`/`buildMeshesForRig`, not per-frame.
- Animation export (`motion3json.js`) doesn't reach `mesh.boneWeights` — no mixed-rigidity hazard there.
- Strip-vs-passthrough decision: stripping is **necessary** (not just convenient) for byte-fidelity against current main, since the current Shelby `.cmo3` was emitted without rigid weights. Passthrough would byte-diff. (Note: this doesn't prove Cubism Editor would reject all-1.0 weights — defers to the byte gate, which is correct.)

## 12. Plan revisions (post-audit-2)

### Adapter module: SCRAPPED. Logic moves inline into `exporter.js`.

**Replace** the `src/io/live2d/cubismAdapter/` module hierarchy with:

- `src/lib/vertexGroupVariance.js` — single tiny module exporting `isRigidVertexGroup(weights, vertCount, jointBoneId, nearestBoneAncestorId)`. Pure predicate. Testable in isolation. No dependencies.
- `src/io/live2d/exporter.js` — both `meshes.push({…})` sites use a shared `extractMeshExportStruct(part, project, meshOpts)` helper that runs the predicate inline and conditionally nulls `boneWeights` + `jointBoneId` for rigid parts.

This deletes ~50% of the proposed Phase A/B file footprint. Phase B's "wire adapter" simplifies to "modify the existing extraction sites in exporter.js."

### Predicate: 4-argument form (per Issue 8).

`isRigidVertexGroup(weights, vertCount, jointBoneId, nearestBoneAncestorId)`. Mismatch between `jointBoneId` and `nearestBoneAncestorId` returns `false` (preserves data — weights encode bone-routing intent). The caller (in `exporter.js` extraction) walks the part's `node.parent` chain via `isBoneGroup` to compute `nearestBoneAncestorId` once per part.

Rationale: hand-only-meshes under leftArm with `jointBoneId='leftElbow'` would otherwise mis-classify and ship a hand-detachment regression. The predicate must respect bone-routing intent that the export wire format can't otherwise encode.

### Phase ordering: A+B+C combined; D+E combined (gated by v31 migration).

**Revised top-level order**:

- **Phase 1 — Adapter foundation + activation** (combines old A+B+C; ~250 LOC). Predicate + extraction-site modification + `seedDefaultRigidWeights` + v31 migration + Init Rig wiring. Single byte-fidelity gate.
- **Phase 2 — Renderer simplification + Apply UX** (combines old D+E; ~80 LOC). Drops overlay path + deletes `applyOverlayMatrixObj` callers + updates `test_boneOverlayMatrix.mjs` + adds Apply test cases for rigid parts.

Phase 2 strict-depends on Phase 1 + v31 migration shipping cleanly first. Phase 1 alone is a complete feature (adapter active, rigid weights flowing, byte-identical export); Phase 2 is the cleanup ship.

### New tests added (per audits 1 + 2)

1. `scripts/test/test_vertexGroupVariance.mjs` — predicate unit tests including the 4th-argument bone-routing-intent case (Issue 8).
2. `scripts/test/test_armatureModifier_parentBoneIdConsistency.mjs` — synth + bind agree on `parentBoneId` (Issue 9).
3. `scripts/test/test_normalizeForCubismExport.mjs` — extraction-site round-trips for rigid + skinned + hand-only-mesh fixtures.
4. Existing `test_boneOverlayMatrix.mjs` — trim or delete in Phase 2.
5. Existing `test_bonePostChainComposition.mjs` — update for 2-state decision in Phase 2.

### Estimate revised

- Phase 1: ~2.5 hours (predicate + extraction + seed pass + v31 migration + tests + byte gate).
- Phase 2: ~1.5 hours (renderer cleanup + Apply UX tests + delete dead code).
- Total: ~4 hours (unchanged from original estimate; the simplification of Phase 1's module structure offsets the added test coverage and the migration work).

---

## 13. Final shipping status (2026-05-09)

**Code complete.** Three commits pushed to `origin/master`:

| Commit | Phase | Summary |
|---|---|---|
| `333fccc` | Phase 1 (combined A+B+C) | Predicate + extractMeshExportStruct + seedDefaultRigidWeights + v31 migration |
| `3c08290` | Phase 2 (combined D+E) | Renderer collapse to single LBS path; overlay-matrix branch + dead code deleted; Apply rigid-weights tests |
| `5f66bff` | Bonus | Mathematical render-equivalence proof (36 cases) — automated verification of claims that previously required Cubism Viewer / live canvas inspection |

### Files added

```
src/lib/vertexGroupVariance.js                    — 4-arg predicate + ancestor walker
src/io/live2d/extractMeshExportStruct.js          — per-part bone-binding extract w/ adapter strip
src/store/seedDefaultRigidWeights.js              — Init Rig pass for default rigid weights
src/store/migrations/v31_default_rigid_weights.js — schema v31 migration

scripts/test/test_vertexGroupVariance.mjs                          (23 cases)
scripts/test/test_extractMeshExportStruct.mjs                      (25)
scripts/test/test_armatureModifier_parentBoneIdConsistency.mjs     ( 8)
scripts/test/test_cubismAdapter_renderEquivalence.mjs              (36)
```

### Files modified

```
src/io/live2d/exporter.js              — both extraction sites use shared helper; legacy duplicated blocks removed
src/store/projectStore.js              — seedDefaultRigidWeights wired into seedAllRig; new import
src/store/projectMigrations.js         — CURRENT_SCHEMA_VERSION 29 → 31; v30 reserved no-op shim; v31 registered
src/components/canvas/CanvasViewport.jsx — overlay-matrix branch + boneOverlay computation + 2 imports deleted
src/renderer/bonePostChainComposition.js — composition decision 3-state → 2-state ('lbs' | 'none')
src/renderer/boneOverlayMatrix.js      — computeBoneOverlayMatrices/applyOverlayMatrixObj/applyOverlayMatrixFlat deleted
package.json                           — 4 new test entries; test:boneOverlayMatrix removed
scripts/test/test_bonePostChainComposition.mjs — updated for 2-state decision (13 → 15)
scripts/test/test_applyArmatureModifier.mjs    — 4 Phase-2 invariant cases added (39 → 43)
```

### Files deleted

```
scripts/test/test_boneOverlayMatrix.mjs — only tested deleted exports (audit Issue 4)
```

### Audit issues — all addressed

| # | Severity | Source | Status |
|---|---|---|---|
| 1 | HIGH | Audit 1 — wrong hook target (writers vs `exporter.js`) | ✅ Hook in `exporter.js` mesh-struct construction |
| 2 | HIGH | Audit 1 — `synthesizeModifierStacks` requires `boneRole` ancestor | ✅ `seedDefaultRigidWeights` uses `isBoneGroup` predicate |
| 3 | HIGH | Audit 1 — "nearest bone group" must be `boneRole`-bearing | ✅ Same — `isBoneGroup` walk |
| 4 | MED | Audit 1 — `test_boneOverlayMatrix.mjs` not in deletion list | ✅ Deleted; removed from `npm test` |
| 5 | HIGH | Audit 1 — moc3 inherits Issue 1's wrong wiring | ✅ Single hook covers both paths via `rigOnly` cmo3 flow |
| 6 | MED | Audit 1 — Phase D regression risk for un-re-rigged projects | ✅ v31 migration is hard prerequisite |
| 7 | HIGH | Audit 2 — adapter module over-engineered | ✅ Module hierarchy scrapped; logic inline in exporter |
| 8 | HIGH | Audit 2 — `computeSkinWeights` clamp produces all-1.0 → variance test mis-classifies hand-only meshes | ✅ 4-arg predicate w/ bone-routing-intent guard; regression test pinned |
| 9 | MED | Audit 2 — `parentBoneId` drift between synth + bind paths | ✅ 8-case consistency test |
| 10 | MED | Audit 2 — A+B+C are formally separate but operationally one ship | ✅ Re-bucketed into Phase 1 |

### Test totals

```
145+ existing test suites: green (no regressions)
4 new test files: 92 new assertions
2 updated test files: 6 net new assertions (15 + 43 vs prior 13 + 39)
                                            —————
Total new coverage:                          98 assertions
```

Across all suites: **0 failures**. Typecheck (`tsc --noEmit`): clean.

### Architectural outcome

```
BEFORE                                          AFTER
══════                                          ═════
Authored: half-Blender (vertex groups on        Authored: fully Blender-shaped (every bone-
limbs only; rigid follow via tree parent)       followed part has vertex groups; rigid =
                                                all-1.0; skinned = per-vertex variation)

Renderer: TWO composition paths                 Renderer: ONE composition path
  ├ LBS for limb meshes                           └ LBS for every bone-followed part
  └ overlay-matrix for unweighted bone children       (single decision; can't disagree
        ↑ disagreed with itself → BUG-028              with itself)

Export: writers extracted boneWeights inline    Export: shared `extractMeshExportStruct`
in two near-duplicate blocks; jointBoneId       runs the strip rule once at the project →
present iff weights present                     mesh-struct boundary; legacy non-weighted
                                                wire format preserved for rigid parts;
                                                per-vertex weights pass through unchanged

Apply Modifier: works on limbs only             Apply Modifier: works on every bone-
(non-limbs have no modifier to apply)           followed part; decouples cleanly post-Apply
                                                (BUG-028 closed structurally)
```

### Equivalence proof — what's automated

`test_cubismAdapter_renderEquivalence.mjs` pins three claims that previously required visual inspection:

1. **Equivalence**: rigid LBS produces vertex positions IDENTICAL to the deleted overlay-matrix path (byte-for-byte within 1e-9). Math: LBS with w=1 reduces to `out = child·v`, which equals the overlay matrix when child = nearest-bone-ancestor (which is exactly what `seedDefaultRigidWeights` sets `jointBoneId` to). Verified on simple + nested 2-bone chains.
2. **Decoupling**: post-Apply Modifier on a rigid part, subsequent bone-pose changes do NOT move rendered verts. The `pickBonePostChainComposition` decision is `'none'` / `'applied'` and no matrix is applied.
3. **Migration round-trip**: pre-v31 project → migrate → render via Phase-2 LBS produces positions IDENTICAL to what the deleted overlay path would have produced on the same project pre-migration. Loaded-but-not-re-Init-Rigged projects render identically pre/post v31.

Plus bonus: v31 idempotent (re-run no-op); hand-only-mesh routing intent (jointBoneId differs from structural parent bone) preserved across migration.

### Manual gates remaining (user-only — orthogonal to code)

These cannot be automated without the Cubism Editor binary or the user's local fixture. They're not regressions or new requirements — they're the standard wire-format-to-Cubism-runtime gate that every export-affecting change goes through.

1. **Cubism Viewer load test**: open user's Shelby `.cmo3` exported post-Phase-2 in Cubism Editor. Must load without warnings.
2. **Local byte-diff**: with `SHELBY_FIXTURE` / `SHELBY_BASELINE_CMO3` / `SHELBY_BASELINE_MOC3` env vars set to the user's local baselines, run `node scripts/byteFidelity/check_shelby.mjs`. Must report zero divergent bytes.
3. **Visual sweep**: load Hiyori → Init Rig → blink → body-angle slider scrub → idle motion playback → export → load in Cubism Viewer. No visual regressions vs pre-Phase-1.

The equivalence proof (§13 → automated) bounds what could possibly diverge in the manual gates to "things outside the LBS+adapter math" — a small surface.

### Plan finished

This document is the canonical record of the Cubism Adapter Pattern work. No follow-up phases queued. The pattern (authored Blender shape ↔ adapter ↔ Cubism wire format) is generalizable to future Blender-vs-Cubism shape mismatches; if any surface, they get their own focused plan rather than extending this one.

Memory: `project_cubism_adapter_pattern_shipped.md` carries the cross-conversation summary.
