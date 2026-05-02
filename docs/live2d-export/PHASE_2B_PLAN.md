# BUG-003 Phase 2b Refactor — Plan

**Status:** queued. Authored 2026-05-03 after two single-sweep attempts on 2026-05-02 evening regressed the oracle harness.

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

- Drop oracle PARAM divergence below **1.0 px** on every fixture (currently 9.45 px on `AngleZ_pos30/neg30`).
- Don't regress TOTAL divergence beyond +5 % (currently 24.21 px).
- All existing tests stay green.
- No feature flags or dual code paths in production after merge.

## Non-goals

- Changing `.cmo3` / `.moc3` emission output. Round-trip with Cubism Editor stays compatible.
- More than ~10 % per-frame perf hit in `chainEval`.
- UI changes.
- "Improving on Cubism" — the goal is **byte parity**, not theoretical accuracy.

---

## Strategy: parallel kernel + oracle gates between stages

Build the new path as a **separate module** (`cubismChainEval.js`) alongside today's `chainEval.js`. The oracle harness selects which kernel to test via a `--kernel=` flag. Each stage advances the new kernel; today's kernel stays untouched and shipping the whole time. Cutover only when the new kernel passes the bar **on all 21 fixtures**, which means the failure mode of "single-sweep attempt regresses, gets reverted" cannot happen — divergence is checked at every stage.

This is the same shape as Phase 0 (oracle) → Phase 1 (kernel port) → Phase 3 (lift composition) successfully used.

---

## Stages

### Stage 0 — Diagnostic infrastructure (½ day)

**Deliverables:**
- New `src/io/live2d/runtime/evaluator/cubismChainEval.js`. Public API mirrors `chainEval.js`'s `evalRig(rigSpec, paramValues) → ArtMeshFrame[]`. Initial body just delegates to legacy `chainEval`.
- [`diff_v3_vs_oracle.mjs`](../../scripts/cubism_oracle/diff_v3_vs_oracle.mjs) `--kernel=v3-legacy|cubism-setup` flag. Default `v3-legacy`.
- New `scripts/cubism_oracle/probe_kernel.mjs` script: dumps the per-fixture per-deformer state for both kernels. Used to compare INTERMEDIATE state (lifted grids, rotation matrices, vertex outputs at chain steps), not just final divergence.

**Verification gate:**
- `--kernel=cubism-setup` with the delegating body produces identical output to `--kernel=v3-legacy` (max diff = 0). Pure infrastructure ship.

**Why this matters:** the previous attempts couldn't tell WHERE in the chain the divergence appeared. With probe_kernel, we can pinpoint "rotation R at chain step N produces output X under v3, Y under cubism-setup" before any regression makes it to the final-output diff.

---

### Stage 1 — Print observed reality at the rotation→warp boundary (½ day)

**Deliverable:** for shelby on `AngleZ_pos30`, dump:
1. `_warpSlopeX/Y` value used by current `chainEval` for each rotation deformer with a warp parent
2. The FD-probed J at the same pivot, for the same param value (using current chainEval's lifted-grid)
3. The actual canvas position of mesh vertex (1, 0) pivot-relative for the rotation, computed both ways
4. The Cubism oracle's canvas position for the same vertex

**Verification gate:** the dump produces clear numerical evidence of WHICH end is the bug. Two possibilities:
- **(P1)** `_warpSlopeX/Y ≠ J⁻¹` even at rest pose — the cascaded normaliser is the bug; replacing it with J⁻¹ fixes rest, and the rotation at non-rest comes out for free.
- **(P2)** `_warpSlopeX/Y ≈ J⁻¹` at rest pose, but they diverge under parameter rotation — the issue is rest-state vs current-state, and Phase 2b's job is to swap CONSTANT for PER-FRAME without touching the rest-pose value.

The previous failed attempts conflated these two possibilities. **No code lands in Stage 2 until we know which one is true.**

---

### Stage 2 — Match the rest-pose value (1 day)

**Conditional on Stage 1's finding:**

**If P1 (cascaded normaliser is wrong even at rest):**
- The fix isn't Phase 2b at all — it's that v3's emitter and chainEval are out of sync with each other on the rest-pose Jacobian.
- Pick whichever produces canvas-correct output at rest (likely J⁻¹), update the OTHER to match.
- Stage 3 still applies.

**If P2 (rest is correct, only current-state diverges):**
- In `cubismChainEval`, swap `_warpSlopeX/Y` for the FD-probed J⁻¹ AT REST.
- Sanity check: oracle harness with `--kernel=cubism-setup` produces same divergence as legacy on the rest fixture.

**Verification gate:** both kernels match each other on all REST fixtures (no param deformation). PARAM divergence on parameter-deformed fixtures may still exist; that's Stage 3's job.

---

### Stage 3 — Per-frame Setup port (1 day)

In `cubismChainEval.getState` for rotations, compute the canvas-final matrix per Cubism's IDA-derived formula:

```
canvasPivot = chainEval.evalChainAtPoint(rotation.parent, originX, originY)
probeY      = chainEval.evalChainAtPoint(rotation.parent, originX, originY + ε)
delta       = probeY - canvasPivot
probedAngle = atan2(delta.x, delta.y)        // angle from +Y axis
probedScale = |delta| / ε

// adjustedScale must be calibrated so the matrix preserves canvas-px
// scale at rest. Stage 1's findings determine the formula:
//   - if cubism formula 1/canvasMaxDim × probedScale = 1 at rest: use it
//   - otherwise: derive the right multiplier from observed numbers
adjustedScale = keyformScale × probedScale × <calibration>
adjustedAngle = keyformAngle - probedAngle
adjustedOrigin = canvasPivot

mat = R(adjustedAngle) · diag(adjustedScale) · diag(rx, ry)
isCanvasFinal = true
```

**Subtleties to handle:**
- Per-parent-type input frame: artmesh keyforms arrive in different frames depending on chain position (rig-warp parent → `0..1` of rig warp's bbox; group-rotation parent → raw canvas-px offsets; chain root → cascaded-normaliser; legacy → PPU-normalised). Stage 3's matrix needs to know which input frame to expect.
- Chain walker break: extend `evalArtMeshFrame` to BREAK after a `isCanvasFinal: true` rotation matrix.
- Lift composition: `_computeLiftedGrid` walks UP from a warp through ancestors. Walking through a canvas-final rotation should break the lift (output is canvas, no further composition).
- Degenerate FD probes (parent has zero-area cell at the pivot): fall back to Stage 2's rest-pose path.

**Verification gate:** PARAM max < 1.0 px on **every** fixture. This is the actual Cubism-parity bar.

If the gate fails on a specific fixture, use `probe_kernel.mjs` to find which deformer step causes the local divergence; iterate the formula until that step matches Cubism's intermediate state.

---

### Stage 4 — Cutover (¼ day)

- `evalRig()` in `chainEval.js` switches to delegating to `cubismChainEval.evalRig`.
- The legacy `chainEval` body becomes the inner implementation of `cubismChainEval` minus the rotation-Setup path. Or: legacy chainEval gets deleted and `cubismChainEval` is renamed back to `chainEval`. Pick whichever results in less churn — there's no production reason to keep both.
- Update `test:chainEval`: math tests that encoded the old rotation-matrix formula get oracle-derived expected values instead of hand-derived ones (they were testing v3's specific approximation, not the canonical correct output).

**Verification gate:** `npm test` green; oracle harness PARAM max < 1.0 px on every fixture.

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
| Stage 1's diagnostic dump reveals a deeper architectural issue (e.g. v3's emitter is byte-wrong against Cubism Editor's compiled output, separate from Phase 2b). | Stage 1 is cheap (½ day) and surfaces this if it's true. We'd file a separate bug and rescope before doing Stage 2-3. |
| FD probe at the pivot is degenerate for some shelby rotations (e.g. pivot lands on a grid cell boundary). | Stage 3 specifies fallback to rest-pose path. Cubism's runtime retries with smaller ε up to 10 iterations; we'd port that retry loop if a fixture fails the gate. |
| Some artmesh keyforms are in frames the per-parent-type code doesn't handle. | Stage 0's `probe_kernel.mjs` makes this visible — we'd see anomalous intermediate state for the broken mesh + add the missing frame. No stage-skip risk. |
| Rotation chains (rotation under rotation) break the canvas-final-break invariant. | Cubism's Setup is recursive; each rotation in the chain gets its own Setup. Our `evalChainAtPoint` already walks recursively via `getState`, so the recursion is free — but we must verify shelby's bone-chain rotations work. |
| Performance regression: per-rotation FD probe adds 3 single-point chain walks per evalRig call. | At shelby's ~5 rotations × ~3-deep chains, that's ~45 chain-walk ops/frame. Each op is ~5 deformer evals. Total ~225 deformer evals/frame on top of the existing ~5000. <5 % overhead. Acceptable; if it becomes a real issue, memoize `(rotationId, paramValuesIdentity) → adjustedMatrix`. |

## Estimated cost

| Stage | Days | Verification gate |
|-------|------|------|
| 0     | 0.5  | new kernel matches legacy at delegation (max diff = 0) |
| 1     | 0.5  | numerical evidence pinpoints P1 vs P2 |
| 2     | 1.0  | new kernel matches legacy on rest fixtures |
| 3     | 1.0  | PARAM max < 1.0 px on all 21 fixtures |
| 4     | 0.25 | full `npm test` green |
| 5     | 0.25 | docs / memory updated |
| **Total** | **3.5 days** | |

This is `multi-day` as the docs warned, but bounded — three working days plus tail, with cheap rollback at every stage (each stage is a separate commit; oracle gate is mechanical).

---

## What this plan changes vs the previous failed attempts

| Failed attempts (2026-05-02) | This plan |
|------------------------------|-----------|
| Modified `chainEval.js` directly. Regression invalidates the entire kernel. | New `cubismChainEval.js`. Legacy stays shipping until cutover. |
| Each attempt tested only against the final `--overall` divergence number. | Stage 0 ships `probe_kernel.mjs` for per-step intermediate-state diffs. |
| Speculated about which Cubism semantic v3 needed to match. | Stage 1 PRINTS the actual values from both v3 and Cubism, then derives the formula from observed reality. |
| Single sweep, single commit, single oracle check. | 5 stages, each gated. |
| No reference to v3's calibration constants (`_warpSlopeX/Y` cascaded normaliser). | Acknowledged up front; Stage 1 explicitly checks whether this is part of the bug surface. |

---

## Out of scope for this plan

- BUG-005 (per-piece Opacity slider) — separate.
- BUG-015 (BodyAngle slider in Live Preview) — separate UI bug.
- Cubism warp port Phase 4 (artmesh eval port) and Phase 5 (final parity sweep) — both blocked on Phase 2b's completion. Pick up after this lands.
- UI improvements (last-used-tool persistence, box-select, etc.) — independent.
