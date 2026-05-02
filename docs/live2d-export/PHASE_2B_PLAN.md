# BUG-003 Phase 2b Refactor — Plan

**Status:** ⚠️ **PREMISE INVALIDATED 2026-05-03 by Stage 1 measurement.** The 9.45 px PARAM signal at AngleZ_pos30 is NOT a chainEval slope/J⁻¹ bug. It's a **FaceRotation pivot import gap** in [`src/io/live2d/cmo3Import/rotationDeformerSynth.js:130`](../../src/io/live2d/cmo3Import/rotationDeformerSynth.js) — the cmo3 importer skips authored rotation-deformer pivots when the parent is another rotation (FaceRotation under GroupRotation case), so v3's heuristic init rig produces a pivot ~12 px off Cubism's authored pivot. The plan's Stages 2-5 do not apply. See **Stage 1 Findings** at the bottom for the actual fix path.

Authored 2026-05-03 after two single-sweep attempts on 2026-05-02 evening regressed the oracle harness.

**Cross-references:**
- [BUGS.md § BUG-003](../BUGS.md) — body / face Angle X/Y/Z divergence vs Cubism (current PARAM max 9.45 px on `AngleZ_pos30/neg30`)
- [CUBISM_WARP_PORT.md § Phase 2b](CUBISM_WARP_PORT.md) — IDA findings + previous attempts
- Oracle harness: [`scripts/cubism_oracle/diff_v3_vs_oracle.mjs`](../../scripts/cubism_oracle/diff_v3_vs_oracle.mjs)

---

## What we know

### The two attempts that failed (2026-05-02 evening)

| Variant | Approach | Result | Why |
|---------|----------|--------|-----|
| **(b)** | Replace `diag(_warpSlopeX, _warpSlopeY)` with FD-probed inverse Jacobian J⁻¹ in the matrix linear part. Keep chain-walker invariant (rotation outputs `parent's localFrame`, walk continues). | PARAM 9.45 → **14.68 px** | `_warpSlopeX/Y` is `canvasToInnermostX/Y(1) - canvasToInnermostX/Y(0)`, a **4-stage cascaded normaliser** (BZ → BY → Breath → BX), NOT `1/bbox`. Real J⁻¹ ≠ today's `_warpSlopeX/Y` even at rest pose. The rest of v3's emit + chainEval math is calibrated against the cascaded normaliser. |
| **(a)** | Cubism's literal Setup formula: bake `originX/Y ← canvasPivot`, `angle ← angle - probedAngle`, `scale ← scale × probedScale`. Mark matrix `isCanvasFinal: true`, break chain walker. | PARAM 9.45 → **~85,000 px** (catastrophic) | Cubism's compiled `keyformScale = 1/canvasMaxDim` balances against `probedScale ≈ bboxSize` to give effective `s ≈ 1`. v3 emits `keyformScale = 1.0` and compensates at runtime via `_warpSlopeX/Y`. Naively baking Cubism's formula with v3's `keyformScale = 1.0` produces ~1100× over-scaled matrices. |

### The structural insight

v3 and Cubism each have a **self-consistent system** of conventions:

|                          | v3 today                                    | Cubism                                          |
|--------------------------|---------------------------------------------|-------------------------------------------------|
| Compiled `keyformScale`  | `1.0`                                       | `1 / canvasMaxDim`                              |
| Runtime canvas→localFrame conv. | `_warpSlopeX/Y` (cascaded normaliser, REST) | `probedScale` from per-frame FD probe (CURRENT)  |
| Effective rotation scale at rest | `_warpSlopeX/Y`                          | `(1/canvasMaxDim) × probedScale ≈ bboxSize/canvasMaxDim` |
| Chain semantics          | Walker continues through every parent       | Break after Setup-adjusted rotation             |
| Lift                     | Phase 3 lifted-grid composition for warps   | Top-down Setup pre-bakes everything             |

Both produce roughly correct rendering at rest pose. They diverge under parameter deformation because v3's `_warpSlopeX/Y` is REST-state — it doesn't pick up the warp's parameter-driven local rotation/scale changes.

**You cannot swap one component without breaking the others.** Single-sweep attempts will regress until BOTH the runtime path AND its calibration constants flip together.

---

## Goals

- **Primary:** drop the BUG-003 signal — oracle PARAM divergence on `AngleZ_pos30/neg30` — below 1.0 px (currently 9.45 px).
- **Secondary:** don't regress any other fixture by more than 0.5 px PARAM. (Some fixtures may improve and some may stay flat; that's fine. Yesterday's option-(b) attempt regressed BodyAngleX from 7.34 → 14.68 px even while improving AngleZ — this gate prevents that pattern.)
- Don't regress TOTAL divergence beyond +5 % (currently 24.21 px).
- All existing tests stay green (or have their hand-derived expected values rebaselined against the oracle, see Stage 4).
- No feature flags or dual code paths in production after merge. (A `kernel` flag inside `chainEval.js` is fine during stages 1-3; it gets deleted at Stage 4 cutover.)

## Non-goals

- Changing `.cmo3` / `.moc3` emission output. Round-trip with Cubism Editor stays compatible.
- UI changes.
- "Improving on Cubism" — the goal is **byte parity**, not theoretical accuracy.
- Performance commitments. Setup adds 1 FD probe per rotation per `evalRig` call (= 3 single-point chain walks each). At shelby's ~5 rotations × ~3-deep parent chains that's ~45 chain-walk ops/frame on top of the existing few thousand. Likely cheap, but committed-to numbers happen at Stage 4 measurement, not up front.

---

## Strategy: feature-flagged Setup path + oracle gates between stages

Inside `chainEval.js`, introduce a `kernel: 'v3-legacy' | 'cubism-setup'` flag (default `v3-legacy`). The flag selects branches inside `getState` for rotations and inside the chain-walker break logic — about 30 lines of branching, far less than cloning the 635-LOC file into a parallel module.

The oracle harness gets a `--kernel=` flag passing through. Stage 0 verifies that with `--kernel=cubism-setup` set but the new branches stubbed-out, output is byte-identical to legacy on all 21 fixtures. Stages 1-3 build the Setup path INSIDE the `cubism-setup` branch only; legacy keeps shipping the whole time. Stage 4 deletes the `v3-legacy` branch and the flag together.

Same shape as Phase 0 (oracle) → Phase 1 (kernel port) → Phase 3 (lift composition) successfully used.

---

## Stages

### Stage 0 — Diagnostic infrastructure (½ day)

**Deliverables:**
1. `chainEval.js` gets a `kernel: 'v3-legacy' | 'cubism-setup'` parameter on `evalRig` (default `'v3-legacy'`). Passed down through `evalArtMeshFrame` + `DeformerStateCache` constructor. With both branches identical (Stage 0 has no real Setup path yet), output is byte-identical to today regardless of flag.
2. [`diff_v3_vs_oracle.mjs`](../../scripts/cubism_oracle/diff_v3_vs_oracle.mjs) gets a `--kernel=` flag passing through to `evalRig`. Default `v3-legacy`.
3. **Re-add the `evalChainAtPoint` lifted-grid update** that yesterday's reverted attempt had: when probing through a warp parent, `evalChainAtPoint` must use `getLiftedGrid` (canvas-px) to match `evalArtMeshFrame`'s Phase 3 semantics. Without this, FD probes compose the chain DIFFERENTLY from how artmesh verts see it. This is a small surgical change to the existing `evalChainAtPoint`; doesn't depend on Setup.
4. New `scripts/cubism_oracle/probe_kernel.mjs` script: walks shelby's chain at a chosen fixture, prints per-deformer intermediate state (rotation matrices, lifted grids' bbox at each warp, vertex output at each chain step). Reads from a single-mesh trace API added to chainEval (an optional `trace: TraceCollector` arg the chain walker writes into when present).

**Verification gate:**
- `--kernel=cubism-setup` produces output byte-identical to `--kernel=v3-legacy` on all 21 fixtures. (Both branches are still identical; this gate verifies the plumbing didn't accidentally diverge them.)
- `evalChainAtPoint` lifted-grid change passes existing `test:chainEval`.
- `probe_kernel.mjs` produces a readable dump for `AngleZ_pos30` (no correctness check yet — just visual sanity).

**Why this stage matters:** the previous attempts tried to fix Phase 2b without observability into per-deformer-step intermediate state. They could see only final-output divergence and had to guess at WHERE the chain was wrong. With `probe_kernel.mjs`, Stage 1 can pinpoint "rotation R's matrix at chain step N produces output X under v3-legacy" with concrete numbers. We don't need (and can't get) Cubism's intermediate state — we need v3's, which we can fully observe.

---

### Stage 1 — Measure v3's actual chain composition at the rotation→warp boundary (½ day)

**Important framing:** Cubism's runtime intermediate state is NOT exposed via `csmGet*` API. The oracle harness can only show us Cubism's FINAL canvas vertex positions. So Stage 1 measures **v3's** intermediates and reasons backward — given Cubism's known final output, what does v3 need to produce at intermediate steps?

**Deliverables (using `probe_kernel.mjs` from Stage 0):**

1. For shelby at REST pose (`default`), per rotation deformer with a warp parent:
   - `_warpSlopeX/Y` constant used by current `getState`
   - FD-probed `J⁻¹` at the same pivot using current chainEval's lifted-grid
   - **Pure numerical comparison** of these two values; report ratio + difference

2. For shelby at `AngleZ_pos30`, same rotations:
   - Same two values as (1) at the param-deformed pivot position
   - The actual mesh vertex (1, 0) pivot-relative, computed end-to-end via current chain walk → final canvas position
   - Cubism oracle's final canvas position for the same vertex (from snapshot)
   - Difference = the BUG-003 signal isolated to ONE rotation deformer

3. Same instrumentation for `BodyAngleX_pos10` (yesterday's regression victim)

**Possible outcomes:**

- **(P1)** `_warpSlopeX/Y ≠ J⁻¹` at REST. The cascaded normaliser is calibrated for something other than the local Jacobian even at rest; v3's chain composition's correctness depends on this calibration. Fix path: replace `_warpSlopeX/Y` everywhere — both at rest and at non-rest — with the FD-probed J⁻¹. Side effects extend beyond rotations into any chainEval consumer of `_warpSlopeX/Y`.

- **(P2)** `_warpSlopeX/Y ≈ J⁻¹` at REST but they diverge under parameter deformation. The fix is what Phase 2b was originally scoped for: swap CONSTANT for PER-FRAME without touching rest-pose semantics.

- **(P3, the messy outcome)** Mixed: J⁻¹ correctly handles SOME parameter-driven deformations (e.g., AngleZ which rotates the warp grid) but introduces error for OTHERS (e.g., BodyAngleX which translates / shears the grid). This was the actual yesterday-option-(b) result. Means Cubism does something more nuanced than just "use J⁻¹"; possibly weighted by deformation type, possibly recomputed at a different point in the chain, possibly involving `Setup_LocalPivot` rebaking that we haven't disassembled.

**Verification gate:** the dump produces clear numerical evidence locking in P1, P2, or P3. The decision point for Stage 2-3 derives from which outcome holds.

If P3, **Stage 2 + 3 may need re-planning** with an additional IDA pass on `Setup_LocalPivot` / `Setup_Compounded*` functions (~0x7fff2b24dee0+ at increasing addresses) and a corresponding extension of this plan. Don't proceed to Stage 2 with a half-baked theory.

**Anti-pattern:** the previous attempts conflated P1/P2 and skipped this step. Don't.

---

### Stage 2 — Wire FD-probed Jacobian into `cubism-setup` branch (1 day)

**Conditional on Stage 1's outcome:**

**If P1 (rest is wrong):**
- This is no longer Phase 2b — it's a deeper "v3's chain composition is calibrated against a wrong constant" issue. Stop, file as a separate bug ahead of Phase 2b. Re-scope.

**If P2 (rest is correct, only non-rest diverges):**
- In `chainEval.getState` for rotations, the `cubism-setup` branch FD-probes the parent at the pivot every frame and uses J⁻¹ instead of `_warpSlopeX/Y`.
- The matrix structure stays the same as legacy (`linear = J⁻¹ · R · diag`, translation = `(originX, originY)`). Chain-walker invariant unchanged.
- This is essentially yesterday's option (b), but with whatever calibration adjustment Stage 1 surfaced.

**If P3 (mixed):**
- Stage 1 must produce a hypothesis for what the additional Cubism behavior is (e.g., per-deformation-type weighting, additional Setup function we haven't ported). The plan extends with a sub-stage 2.5 to RE the additional Cubism function. Don't write Stage 2 code until the hypothesis is testable.

**Verification gate:**

- Oracle harness `--kernel=cubism-setup` produces output **within 0.05 px max-vertex-diff** of `--kernel=v3-legacy` on rest fixtures (`*__default.json`). FD probes have small float-rounding noise even when J⁻¹ ≈ `_warpSlopeX/Y` mathematically; 0.05 px is a generous bound that still catches structural bugs (wrong column/row layout, wrong inversion formula) — those would diverge by orders of magnitude.

- For non-rest fixtures: don't gate yet — Stage 3 fixes those.

  Note: this gate is only meaningful if both branches do real work and could plausibly diverge. With P2 confirmed by Stage 1, both branches compute the same thing via different paths (constant lookup vs FD probe + inversion), so near-equality is the right gate.

---

### Stage 3 — Drive the FD-probed Jacobian down to <1 px PARAM divergence on AngleZ (1 day)

Stage 2 wired in the per-frame J⁻¹. If yesterday's option-(b) data holds, AngleZ should now be slightly better and BodyAngleX much worse (the P3-shaped problem). Stage 3's job is to figure out the calibration that closes both.

**Possible interventions, each tested via oracle harness independently:**

1. **Per-parent-type input frame normalisation**. Artmesh keyform vertex storage frame depends on parent type (per `keyformAndDeformerSections.js`):
   - rig-warp parent → `0..1` of rig warp's `canvasBbox`
   - group-rotation parent → raw canvas-px offsets from group pivot
   - chain root → `canvasToInnermostX/Y` (cascaded-normaliser output)
   - legacy → centred + PPU-normalised

   Today's chainEval handles these implicitly via `_warpSlopeX/Y`. The FD-probed path in Stage 2 may have skipped one or more conversions — adding them per-parent-type is one fix vector.

2. **Cubism's full Setup port** (canvas-final matrix, chain-walker break). If P3's BodyAngleX problem is "the warp's bilinear off-pivot diverges from the linear approximation that J⁻¹ encodes", the canvas-final approach (apply matrix, BREAK, never re-compose through the warp) is what Cubism uses. Yesterday's option-(a) attempt at this exploded because `keyformScale=1.0` × `probedScale=bbox_size` ≠ 1; with Stage 2's calibration result in hand, the explosion is recoverable.

3. **ε retry on degenerate probes**. Cubism's `RotationDeformer_Setup` retries with ε × 0.5 up to 10× when `|delta| ≈ 0`, then tries `-Y` direction. Single-shot ε at 0.01 may give noisy J on certain shelby pivots. Port the retry loop.

4. **Sub-stage 3.5 (only if P3 means something deeper)**: re-RE Cubism's `Setup_LocalPivot` / `Setup_Compounded*` functions in IDA. Update Stage 3 with the new findings.

**Subtleties already known to need handling:**
- Chain walker break: extend `evalArtMeshFrame` to BREAK after `isCanvasFinal: true` rotation matrix (yesterday's revert removed this; re-add).
- Lift composition: `_computeLiftedGrid` walks UP from a warp through ancestors; walking through a canvas-final rotation should break the lift (output is canvas; no further composition).

**Verification gate:**
- `AngleZ_pos30/neg30` PARAM max < 1.0 px (the BUG-003 signal — primary).
- No other fixture regresses by more than 0.5 px PARAM compared to current baseline.
- TOTAL divergence within +5% of baseline (24.21 px).

Numerical floor: Cubism's runtime is single-precision and our FD probe has its own rounding. If a fixture pins at 0.5–0.9 px on the AngleZ bound, that's "match Cubism within numerical precision" and acceptable. >1.0 px is a real divergence to chase.

If the gate fails after intervention 1+2+3 are tried (3 sweeps within Stage 3), invoke 3.5 — re-RE additional Cubism Setup functions and extend the plan.

---

### Stage 4 — Cutover (½ day)

- `evalRig` in `chainEval.js` flips its default to `kernel: 'cubism-setup'`. Run full oracle harness to confirm.
- Delete the `kernel === 'v3-legacy'` branches from `chainEval.js`. Delete the `kernel` parameter. Delete the `--kernel=` flag from oracle harness.
- Tests to update (each gets re-baselined against oracle output, not hand-derived expected values):
  - `test:chainEval` — particularly any test asserting numeric vertex output of a rotation step. Hand-derived expected values came from v3's specific math; the new math may produce slightly different numbers (within 0.5 px). Replace expected values with oracle-derived ones for the same fixture.
  - `test:rotationEval` — pure math tests on `buildRotationMat3` / `applyMat3ToPoint` are likely unaffected (those functions don't change). Verify.
  - `test:e2e_equivalence` — end-to-end. May need rebaseline.
  - `test:cubismRotationEval` — historical, currently retained as record. Verify still relevant or delete.

- Run `npx tsc --noEmit` + `npm test` + oracle harness. Each must be green.
- Profile `evalRig` against rest-pose shelby for 100 calls; record per-call mean before vs after. If regression > 10%, memoize `(rotationId, paramValuesIdentity) → adjustedMatrix` (cheap WeakMap hash).

**Verification gate:** `npm test` green; oracle harness `AngleZ` PARAM < 1.0 px; no fixture PARAM > baseline + 0.5 px; perf delta < 10% (or memoization landed).

---

### Stage 5 — Documentation & cleanup (¼ day)

- BUGS.md: BUG-003 → Fixed. Move entry to the Fixed section with this plan as the fix log.
- CUBISM_WARP_PORT.md Phase 2b: SHIPPED. Phase 4 (artmesh eval port) and Phase 5 (final parity sweep) become the next blocked items.
- This plan doc: SHIPPED banner at top.
- New memory entry summarizing the refactor for future reference.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Stage 1's measurement reveals **P1** (rest-pose `_warpSlopeX/Y` ≠ J⁻¹). | This is a deeper architectural issue, not Phase 2b. Stop, file as separate bug, re-scope. The plan does NOT cover the P1 case — it'd need a different doc. |
| Stage 1's measurement reveals **P3** (mixed: J⁻¹ helps some warps, hurts others). | Stage 3's interventions list is designed for this case (per-parent-type frame, canvas-final break, ε retry). If those three don't close the gap, sub-stage 3.5 invokes additional IDA RE on `Setup_LocalPivot` / `Setup_Compounded*`. Each intervention is independently oracle-tested before stacking. |
| FD probe at the pivot is degenerate (pivot lands on a grid-cell boundary, `\|delta\| ≈ 0`). | Stage 3 intervention 3: port Cubism's ε-retry loop (×0.5 up to 10×, then try `-Y` direction). If that still fails for a fixture, fall back to legacy `_warpSlopeX/Y` for that rotation only — better than crashing. |
| Some artmesh keyforms are in frames the per-parent-type code doesn't handle. | `probe_kernel.mjs` from Stage 0 makes this visible — anomalous intermediate state for the broken mesh + add the missing frame. Surfaces during Stage 3 testing, not at cutover. |
| Rotation chains (rotation under rotation): the recursive Setup needs each ancestor rotation to be Setup-adjusted before its child probes through it. | `getState` is memoized per-evalRig — first probe through R triggers R's own Setup, subsequent probes hit the cache. As long as `getState` is called consistently (not bypassed via direct keyform reads), this composes correctly. **Verify this on shelby's bone-chain rotations during Stage 3** — test:chainEval has fixtures using arm/leg rotation chains. |
| `evalChainAtPoint` and `_computeLiftedGrid` interact (lifting computes warp grids by walking through rotations; FD probe walks through warps using lifted grids). Possible cycle. | Yesterday's `_liftingInFlight` set already detects cycles via cycle-detection sentinel. Setup recursion is ACYCLIC (rig is a tree); only malformed input would trigger. Stage 0 verifies this on shelby. |
| Performance regression > 10%. | Stage 4 measures and gates. Memoize `(rotationId, paramValuesIdentity) → adjustedMatrix` if needed. The cache already exists for getState; extending to include Setup output is mechanical. |
| Cutover's test rebaselines mask a real regression as "expected delta". | Stage 4's rebaselines must compare oracle-derived expected values to OBSERVED output — if they disagree by > 0.1 px, that's not a baseline drift, that's a bug. Be strict here. |

## Estimated cost

| Stage | Days | Verification gate |
|-------|------|------|
| 0     | 0.5  | flag plumbing + lifted-grid `evalChainAtPoint` + probe script; both kernel branches still byte-identical |
| 1     | 0.5  | measurement isolates outcome (P1 / P2 / P3) with concrete numbers |
| 2     | 1.0  | (assuming P2 or P3) `cubism-setup` byte-matches `v3-legacy` on rest fixtures |
| 3     | 1.0  | (assuming P2 or P3) AngleZ PARAM < 1.0 px; no fixture regresses by > 0.5 px |
| 3.5   | +1–2 (contingent) | only if P3 demands additional Cubism IDA RE; budget for re-RE + retest |
| 4     | 0.5  | `npm test` green; perf delta < 10% (or memoized) |
| 5     | 0.25 | docs / memory updated; flag deleted |
| **Total** | **3.75 days nominal, up to 5.75 with 3.5** | |

This is `multi-day` as the docs warned, but bounded — three to four working days plus tail. Cheap rollback at every stage: each is a separate commit; the `kernel` flag means master never has a broken kernel even mid-refactor.

**If Stage 1 reveals P1**: the plan does NOT apply. Stop, write a new bug + plan, return.

---

## What this plan changes vs the previous failed attempts

| Failed attempts (2026-05-02) | This plan |
|------------------------------|-----------|
| Modified `chainEval.js` directly. Regression invalidates the entire kernel. | `kernel` flag inside `chainEval.js`. Legacy branch keeps shipping until cutover; flag is removed entirely at Stage 4. |
| Each attempt tested only against the final `--overall` divergence number. | Stage 0 ships `probe_kernel.mjs` + a `trace` API on `evalRig` for per-step intermediate-state observation. |
| Speculated about which Cubism semantic v3 needed to match. | Stage 1 PRINTS the actual values from v3's chain composition and reasons backward from Cubism's known final output (Cubism's intermediates aren't observable; that's accepted). |
| Single sweep, single commit, single oracle check. | 5 stages (+ contingent 3.5), each gated. |
| No reference to v3's calibration constants (`_warpSlopeX/Y` cascaded normaliser). | Acknowledged up front; Stage 1 explicitly checks whether this is part of the bug surface. |
| P1/P2 framing applied as binary; yesterday's data showed P3 (mixed) is the actual case. | This plan recognizes P3 explicitly and Stage 3's interventions are designed to handle it incrementally. |

---

## Out of scope for this plan

- BUG-005 (per-piece Opacity slider) — separate.
- BUG-015 (BodyAngle slider in Live Preview) — separate UI bug.
- Cubism warp port Phase 4 (artmesh eval port) and Phase 5 (final parity sweep) — both blocked on Phase 2b's completion. Pick up after this lands.
- UI improvements (last-used-tool persistence, box-select, etc.) — independent.

---

## Stage 1 Findings (2026-05-03)

Stage 0 plumbing landed in commit `1833380` (kernel flag, trace API, `probe_kernel.mjs`, lifted-grid `evalChainAtPoint`). Stage 1 measurement ran on `default`, `AngleZ_pos30`, `AngleZ_neg30`, `BodyAngleX_pos10`, `BodyAngleX_neg10` and produced **clean numerical evidence that the plan's premise was wrong**.

### Measurement: slope vs FD-probed J⁻¹ at every warp-parented rotation pivot

[`scripts/cubism_oracle/measure_jacobian.mjs`](../../scripts/cubism_oracle/measure_jacobian.mjs) probes BodyXWarp at each `GroupRotation_*` pivot, computes J = ∂(canvas-px)/∂(warp 0..1) via FD with ε=0.01, inverts it, compares to v3's `diag(_warpSlopeX, _warpSlopeY)`:

| Fixture            | J⁻¹ vs slope at pivot                          | Off-diagonal in J⁻¹ |
|--------------------|------------------------------------------------|---------------------|
| `default` (rest)   | identical to ~7 decimal places (Frob ~1e-8)    | 0.0%                |
| `AngleZ_pos30`     | identical to ~7 decimal places (Frob ~1e-8)    | 0.0%                |
| `AngleZ_neg30`     | identical to ~7 decimal places (Frob ~1e-8)    | 0.0%                |
| `BodyAngleX_pos10` | central pivot: 9.4% Frob diff (off-diag shear) | 9.4% of |J⁻¹|       |
| `BodyAngleX_neg10` | mirror of `pos10`                              | 9.4% of |J⁻¹|       |

**Outcome class: not P1, not P2, not P3.** A new class — call it **P0** — emerged: at AngleZ_pos30 there is **nothing to fix** at the rotation→warp boundary. The slope is exactly the right J⁻¹ at every probed pivot. Yet PARAM divergence is 9.45 px.

### Where the 9.45 px actually comes from

Sorting all 19 oracle drawables by PARAM divergence at `AngleZ_pos30` ([`scripts/cubism_oracle/fixture_breakdown.mjs`](../../scripts/cubism_oracle/fixture_breakdown.mjs)):

| Drawable    | PARAM max | PARAM mean | What it actually is                                          |
|-------------|-----------|------------|--------------------------------------------------------------|
| eyelash-r   | 9.45      | 7.54       | eye mesh — eye-closure parabola fit fallback (harness-known) |
| eyelash-l   | 9.11      | 7.41       | "                                                            |
| eyewhite-r  | 8.86      | 7.27       | "                                                            |
| irides-r    | 8.84      | 7.34       | "                                                            |
| eyewhite-l  | 8.57      | 7.15       | "                                                            |
| irides-l    | 8.49      | 7.00       | "                                                            |
| eyebrow-l   | **6.18**  | **6.17**   | **uniform shift** — pure rigid offset                        |
| eyebrow-r   | 6.18      | 6.17       | uniform shift                                                |
| front hair  | 6.18      | 6.17       | uniform shift                                                |
| face/ears/back hair/body | (skipped)| (vertex-count mismatch — separate import gap) |

The eye meshes' divergence is the **harness-documented eye-closure parabola fit artifact** (Node has no PNG decoder for alpha-channel sampling). That part is real but **not a chainEval bug**.

The eyebrow / front-hair signal is what matters: param_max ≡ param_mean to two decimals on each, and the same value across three different meshes with different shapes/sizes — **uniform rigid shift**, the signature of a rotation pivot offset.

### Recovering the pivot offset numerically

[`scripts/cubism_oracle/probe_pivot_offset.mjs`](../../scripts/cubism_oracle/probe_pivot_offset.mjs) inverts `(R(30°) - I) · (P_cubism - P_v3) = paramDelta` at four representative vertices on each face-rotated mesh. Result identical across all sample vertices and all three meshes:

```
P_cubism - P_v3 = (4.35, 11.10) px       [+sign convention]
                = (1.78, -11.79) px      [-sign convention]
```

|P_cubism - P_v3| ≈ **11.92 px**. The sign depends on Cubism's rotation direction convention; the magnitude is invariant. **Cubism's authored FaceRotation pivot is ~12 px off v3's heuristic-computed pivot in canvas-px.**

### Root cause: cmo3 importer skips authored pivot when parent is another rotation

[`src/io/live2d/cmo3Import/rotationDeformerSynth.js:130`](../../src/io/live2d/cmo3Import/rotationDeformerSynth.js):

```js
if (parentIsRotation) {
  continue;  // <-- skips pivot import when rotation's parent is another rotation
}
```

Comment at the top of the file:

> For rotation deformers chained under another rotation (e.g. FaceRotation under Rotation_head), the cmo3 stores `originY` in pixel-OFFSET form relative to the parent rotation's pivot, not canvas-normalised. We skip pivot translation in that case and let the writer fall back to its bbox-of-descendant-meshes heuristic.

For shelby's FaceRotation (parent = `GroupRotation_head`), the authored pivot is **never imported**. The harness uses heuristic init rig, which calls [`src/io/live2d/cmo3writer.js:851-892`](../../src/io/live2d/cmo3writer.js) — face-mesh-bbox center for X, chin/topwear-top for Y. That heuristic gives a pivot 12 px off Cubism's authored value.

This is also what makes BodyAngleX behave differently: BodyXWarp's keyforms are imported correctly (warp deformers come through `rigWarpSynth.js`), so its parameter-driven J⁻¹ shear is genuine — the 9.4% off-diagonal at `BodyAngleX_pos10` IS what Cubism produces. Yesterday's option-(b) attempt that swapped slope→J⁻¹ regressed BodyAngleX from 7.34 → 14.68 px because it tried to "fix" the J⁻¹ shear, but the shear is part of the correct evaluation; the slope-rest approximation is what Cubism's `RotationDeformer_Setup` produces. (The Setup's per-frame Jacobian probe is conceptually equivalent to v3's slope at rest because BodyXWarp at rest is bilinear-of-corners.)

### What this means for Phase 2b

- **Stages 2-5 of this plan don't apply.** They were designed to swap the rotation→warp slope conversion for a per-frame J⁻¹. Stage 1 measured that the slope IS the right J⁻¹ at the rotation pivots in every fixture we've examined. Pursuing Stage 2 would be a reprise of yesterday's option-(b) — which we've now confirmed regressed the harness because it was solving a non-existent problem.
- **Stage 0's plumbing is still useful.** The `kernel` flag, `TraceCollector`, lifted-grid `evalChainAtPoint`, and `probe_kernel.mjs` all stand on their own as diagnostic infrastructure. Don't revert.

### Real fix path

The actual BUG-003 root cause is in the importer, not the chain evaluator:

1. **Extend [`rotationDeformerSynth.js:130`](../../src/io/live2d/cmo3Import/rotationDeformerSynth.js)** to recover the authored canvas-px pivot when the parent is another rotation. The cmo3 stores the value in pixel-offset form relative to the parent's pivot — so we need to walk up the rotation chain, collecting offsets, until we hit a canvas-rooted ancestor whose pivot is canvas-normalised. Sum the offsets to get absolute canvas-px.
2. **Or** — write a project-level "authored rotation pivots" map keyed by group nodeId, and have [`cmo3writer.js:851-892`](../../src/io/live2d/cmo3writer.js) prefer the imported value over the heuristic when present.

Either fix would close the AngleZ_pos30 PARAM signal entirely. Confidence is high because the signal across three independent meshes (eyebrow-l, eyebrow-r, front hair) reduces to a single (Δx, Δy) constant — there's nothing else for the divergence to be.

### Stage 1 deliverables (committed alongside this revision)

| Path                                                | Purpose                                                                |
|-----------------------------------------------------|------------------------------------------------------------------------|
| `scripts/cubism_oracle/measure_jacobian.mjs`        | Per-rotation slope vs FD-probed J⁻¹ table across multiple fixtures.    |
| `scripts/cubism_oracle/fixture_breakdown.mjs`       | All-drawables PARAM breakdown for any fixture (extends harness top-5). |
| `scripts/cubism_oracle/map_drawables.mjs`           | Oracle ArtMeshN → v3 mesh-name + chain mapping.                        |
| `scripts/cubism_oracle/probe_pivot_offset.mjs`      | Recovers `(R(θ)-I)⁻¹ · paramDelta` to back out implied pivot offsets.  |
| `scripts/cubism_oracle/probe_param_uses.mjs`        | List specs binding to a chosen parameter.                              |
| `scripts/cubism_oracle/dump_authored_rotations.mjs` | Inspect raw cmo3 rotation deformers (verifies parent=rotation case).   |
| `scripts/cubism_oracle/verify_pivot_fix.mjs`        | Disproof artifact — see "Pivot-patch disproof" below.                  |
| Changes in [`chainEval.js`](../../src/io/live2d/runtime/evaluator/chainEval.js) | Exports `DeformerStateCache` so probes can run FD lookups directly. |

### Pivot-patch disproof (2026-05-03 follow-up)

A natural next move after Stage 1 was: "patch FaceRotation's `origin` in the harvested rigSpec to the authored Cubism value, re-run oracle, see PARAM drop". `verify_pivot_fix.mjs` ran exactly that experiment — and the **PARAM signal at AngleZ_pos30 did not change**. Eyebrow-l/eyebrow-r/front-hair stayed pinned at param_max=6.18 px before and after the patch.

The geometric reason is straightforward once you write out the matrix. v3's rotation matrix is `out = R·in + origin` (matches Cubism's `RotationDeformer_TransformTarget` per IDA `0x7fff2b24c950`). At any angle, `d(out)/d(origin) = I` — changing `origin` shifts the output by the same constant vector regardless of `R`. The harness's PARAM is `(v3@30 − oracle@30) − (v3@rest − oracle@rest)`, which subtracts the rest-pose offset, so any constant shift in `origin` cancels out completely.

The PARAM signature `(R(10°)−I)·c = (−6.13, 0.69)` therefore resolves not to a "pivot offset" but to **`c = (in_v3 − in_oracle) ≈ (−0.88, −35.4)`** — a ~35 px constant difference in the **vertex coordinates arriving AT FaceRotation's input**. Those verts come from FaceParallaxWarp's lifted output. v3 builds FaceParallaxWarp heuristically ([`src/io/live2d/cmo3writer.js`](../../src/io/live2d/cmo3writer.js) `facePivot` + radius/protected-regions); Cubism uses the authored cmo3 grid; they don't agree.

So the BUG-003 9.45 px PARAM signal at AngleZ_pos30 is **the heuristic-vs-authored gap of FaceParallaxWarp** (and likely several other ancestors in the body warp chain), surfaced through FaceRotation's amplification. There is no single-deformer fix. Closing it requires `initializeRigFromProject` to prefer authored cmo3 deformer data over heuristics — a substantial feature rebuild that touches the cmo3Import → initRig → cmo3writer pipeline. That work is **out of scope for Phase 2b** and would benefit from explicit user-direction on rollout (other characters that depend on v3's heuristic init rig would need re-validation).

For ongoing work: when chasing oracle-harness divergence, distinguish "kernel correctness" (chainEval / warpEval / rotationEval — verified at high precision by Phase 0/1/3 + Stage 1) from "rig-data fidelity" (heuristic init rig vs authored cmo3 — the actual delta surface). The harness measures both compounded; only the latter can move on this codebase right now.

