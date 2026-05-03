# Cubism Physics Port — Phase 0 Findings

**Date:** 2026-05-03 (autonomous session resuming after /compact)
**Plan doc:** [CUBISM_PHYSICS_PORT.md](CUBISM_PHYSICS_PORT.md)
**Verdict:** Phase 1 port is **required**. v3's `physicsTick.js` diverges from Cubism Web Framework's `CubismPhysics` by **max 2.0** (sign-flipped clamp) and **mean 0.5–1.3** across both shelby and Hiyori fixtures.

> **Update 2026-05-03 same day:** Phase 1 + Phase 2 SHIPPED. The new kernel `src/io/live2d/runtime/cubismPhysicsKernel.js` is wired into `physicsTick.js` as the default; the harness now reports max divergence **1e-5** (float32 noise floor) across all fixtures. This document remains the rationale snapshot for the divergence pre-port; the harness is now repurposed as the regression net for the production kernel.
>
> **Open Phase 3 issue (user-side):** the auto-rig default `outputScale` values at `cmo3/physics.js:PHYSICS_RULES` (range 0.4–2.061) were tuned in v3-legacy `(deg/angleMax)*scale` semantics. Under cubism-port (radians × scale) they produce ~5.7× smaller magnitude. Defaults are deliberately **not** re-tuned: doing so would specifically match v3-legacy's wrong-magnitude output, undoing the byte-faithfulness. If Phase 3 visual sweep shows Cubism Viewer agreeing with the new (smaller) magnitudes, defaults are correct as-is. If Cubism Viewer shows v3-legacy's larger magnitudes, that would imply Cubism Viewer was already running with a different scale convention — which is testable, but has not been observed.

## Methodology

1. **Reference snapshot** at [`reference/cubism-web-framework/`](../../reference/cubism-web-framework/) — verbatim copy of the physics-relevant subset of [Live2D's CubismWebFramework](https://github.com/Live2D/CubismWebFramework) at commit `d4da0aa07e47d2c1e4f5fa7ea6047861ea5e5d0b` ("Update to Cubism 5 SDK for Web R5"), with attribution and the Live2D Open Software License preserved.

2. **Hand-transcribed JS oracle** at [`scripts/cubism_physics/oracle/cubismPhysicsOracle.mjs`](../../scripts/cubism_physics/oracle/cubismPhysicsOracle.mjs) — pure-JS port of `cubismphysics.ts` with each function carrying a `// @ref cubismphysics.ts:NNN` line pointing to the upstream source. Bypasses `CubismPhysicsJson` (ingests parsed `physics3.json` directly via `setRig()`) and replaces `CubismModel` with a plain parameter-pool object — all unrelated to the algorithm. Two upstream "bugs" preserved as bug-compat (the `direction.y = sin(r)*newDirection.x + ...` quirk at @ref :1131-1136, and the equivalent quirk on `totalTranslation` at @ref :603-610).

3. **Harness** at [`scripts/cubism_physics/diff_v3_vs_oracle.mjs`](../../scripts/cubism_physics/diff_v3_vs_oracle.mjs) — drives both v3's `tickPhysics()` and the oracle's `evaluate()` on the same `physics3.json` + parameter-driver sequence at fixed `dt = 1/60s` for 4 seconds. Compares all output params per-frame, reports max + mean divergence per output.

4. **Driver fixtures (10):** rest, single-axis steps (X/Y/Z), single-axis sweeps, body angle sustained, breath cycle, combined head+body, step-input jump, extreme square wave. Plan: docs/live2d-export/CUBISM_PHYSICS_PORT.md §"Pinned baselines".

## Results

### shelby.physics3.json (4 rules, 5 output params)

```
fixture                 output                    max         mean
bodyAngleX_step         ParamShirt                1.572223    0.735815
bodyAngleX_step         ParamPants                1.000000    0.241574
bodyAngleX_step         ParamBust                 1.728510    0.592775
bodyAngleX_step         ParamRotation_leftElbow   2.000000    0.565868
bodyAngleX_step         ParamRotation_rightElbow  2.000000    0.565868
bodyAngleZ_sweep        ParamShirt                0.428019    0.224660
bodyAngleZ_sweep        ParamPants                0.449878    0.257303
bodyAngleZ_sweep        ParamBust                 0.166957    0.090366
bodyAngleZ_sweep        ParamRotation_leftElbow   1.380936    0.750171
bodyAngleZ_sweep        ParamRotation_rightElbow  1.380936    0.750171
combined_head_body      ParamShirt                0.560465    0.222058
combined_head_body      ParamPants                0.549608    0.260968
combined_head_body      ParamBust                 0.237237    0.100971
combined_head_body      ParamRotation_leftElbow   1.412534    0.670225
combined_head_body      ParamRotation_rightElbow  1.412534    0.670225
```

Worst: **2.000000** at `bodyAngleX_step / ParamRotation_leftElbow`.

(Fixtures driving params not present in shelby's physics3.json — `angleX`, `breath`, `extreme_drive` — show 0 divergence, as expected: there's no rule to evaluate.)

### Hiyori (hiyori_pro_t11.physics3.json — 18 rules, ~32 output params)

```
fixture                 output                          max         mean
angleX_step             ParamHairFront                  2.000000    1.311420
extreme_drive           ParamHairFront                  2.000000    1.311420
extreme_drive           Param_Angle_Rotation_1_ArtMesh* 2.000000    0.128–0.97
extreme_drive           Param_Angle_Rotation_2_ArtMesh* 2.000000    0.83–0.99
[similar pattern for ~25 other Param_Angle_Rotation_* outputs]
```

Worst: **2.000000** at `angleX_step / ParamHairFront`.

## Why they diverge

1. **Different integrator.** v3 uses Verlet integration with rod constraint. Cubism uses an explicit-velocity pendulum where each frame: `direction = position - parent`, rotate `direction` toward `currentGravity` by `directionToRadian(lastGravity, currentGravity) / 5.0` rad, then `position = parent + direction + velocity*delay + force*delay²`, then enforce rod constraint. The integration shapes are not equivalent — v3 conserves momentum and oscillates, Cubism's air-resistance term damps faster.

2. **Different convergence rate.** v3 takes ~3–4s to settle from a step input; Cubism's algorithm settles in ~0.5–1s. Trace from `bodyAngleX_step`:
   - t=0:    v3 = -1.0000  (clamped),    oracle = 0.0000  (previous-frame interpolation @ first frame)
   - t=0.5:  v3 = -1.0000  (still clipped), oracle = -0.1424
   - t=1.0:  v3 = -1.0000  (still clipped), oracle =  0.0109  (settled)
   - t=4.0:  v3 = -0.1533  (still oscillating), oracle = 0.0000

3. **Polarity flip.** Cubism's `normalizeParameterValue` (`@ref :1347`) returns `result * -1.0` when `isInverted=false` — i.e., the default behaviour is to negate the normalised input. v3 has `if (inp.isReverse) n = -n` — i.e., the default is to NOT negate. Both sides read `physics3.json:Reflect=false` into their `isInverted`/`isReverse`, but Cubism uses it as "don't double-negate", and v3 uses it as "don't negate". The result: **opposite signs on every input**.

4. **Different normalisation centre.** Cubism's `normalizeParameterValue` uses `middleValue = (paramMin + paramMax) / 2` as the input-space mid (`@ref :1311`, `getDefaultValue`). v3's `normalizeParam` uses `spec.default` (the explicit per-param default, e.g. `0` for ParamBreath which has `min=0, max=1, default=0`). For symmetric params, equivalent; for asymmetric params (`ParamBreath`), they centre at different values.

5. **Frame-rate decoupling + interpolation.** Cubism, when `physics3.json` has no `Fps` (shelby) and `dt = 1/60`, runs the substep-loop exactly once with `inputWeight=1`, then does `interpolate(alpha=0)` which writes `previousOutputs` (one-frame stale) to `parameterValues`. v3 has no equivalent — it writes `currentOutputs` synchronously. Result: a **one-frame lag** on Cubism's side.

6. **Output type dispatch.** Cubism's `getOutputAngle` returns RADIANS; `getOutputTranslationX/Y` return raw translation. v3's `writeRuleOutputs` always computes `value = (p.angle / angleMax) * scale` regardless of output type — i.e., v3 only supports angle outputs and silently corrupts X/Y outputs (rare in practice but real).

7. **Output weight blending.** Cubism's `updateOutputParameterValue` (`@ref :1267-1273`) blends `previousParam * (1 - weight/100) + computedValue * weight/100` when `weight < 100`. v3 has no equivalent; it always hard-replaces. (Most authored physics3.json files use `Weight=100`, so this is a tail risk, but it's a real semantic gap.)

## What this means for the port

Phase 1 (kernel port) **is justified**. Each of the 7 differences above translates to user-visible behaviour:
- Slow convergence (#2) is the most visible — the user sees v3 lagging behind input vs Cubism Viewer's snappier response.
- Polarity flip (#3) means hair sways the wrong way relative to authored intent.
- Different transients (#1) make v3's idle-motion preview look jittery vs Cubism's smooth response — directly relevant to GAP-017's downstream check.

## Cost re-estimation

The original plan estimated 1.0–2.0 days for Phase 1 conditional on Phase 0 finding divergence. **Phase 0 took ~0.4 days** (oracle transcription + harness + report — including this writeup). Phase 1 estimate stands at **1.0–2.0 days** because the algorithm shape is now fully understood from the oracle work.

## Artefacts

- [`reference/cubism-web-framework/physics/`](../../reference/cubism-web-framework/physics/) — immutable upstream snapshot
- [`reference/cubism-web-framework/README.md`](../../reference/cubism-web-framework/README.md) — attribution + commit SHA
- [`reference/cubism-web-framework/LICENSE.md`](../../reference/cubism-web-framework/LICENSE.md) — Live2D Open Software License
- [`scripts/cubism_physics/oracle/cubismPhysicsOracle.mjs`](../../scripts/cubism_physics/oracle/cubismPhysicsOracle.mjs) — hand-transcribed JS port
- [`scripts/cubism_physics/oracle/smoke_test.mjs`](../../scripts/cubism_physics/oracle/smoke_test.mjs) — sanity check that oracle runs without throwing
- [`scripts/cubism_physics/diff_v3_vs_oracle.mjs`](../../scripts/cubism_physics/diff_v3_vs_oracle.mjs) — Phase 0 harness; runs on any `physics3.json`

Run with:
```
node scripts/cubism_physics/diff_v3_vs_oracle.mjs                                              # default = shelby
node scripts/cubism_physics/diff_v3_vs_oracle.mjs --json=reference/live2d-sample/Hiyori/...    # alternate
node scripts/cubism_physics/diff_v3_vs_oracle.mjs --fixture=bodyAngleX_step --verbose          # single fixture, per-frame trace
```

## Phase 1 entry conditions

- [x] Reference snapshot under `reference/cubism-web-framework/` with attribution
- [x] Oracle module that ingests parsed `physics3.json` and runs to convergence without errors
- [x] Diff harness covering ≥10 driver fixtures
- [x] Divergence measured and documented per-fixture, per-output
- [x] Specific divergence sources identified (the 7 bullets above)

Phase 1 owner work begins with replacing v3's `tickPhysics()` body with a thin wrapper around a new `cubismPhysicsKernel.js` that mirrors the oracle's algorithm. Each of the 7 bullets becomes a checkpoint commit.
