# Cubism Physics Port — Plan

**Status:** Phase 0 + Phase 1 + Phase 2 **SHIPPED 2026-05-03**.
- Phase 0 (oracle harness): see [CUBISM_PHYSICS_PORT_PHASE0_FINDINGS.md](CUBISM_PHYSICS_PORT_PHASE0_FINDINGS.md). Verdict: port required. Max divergence 2.0; mean 0.5–1.3 across shelby+Hiyori.
- Phase 1 (kernel port): `src/io/live2d/runtime/cubismPhysicsKernel.js`. Oracle harness shows max divergence **1e-5** (float32 noise floor) across all driver fixtures. Byte-faithful match achieved.
- Phase 2 (wire-in + flag): `physicsTick.js` delegates to the kernel by default. `setPhysicsKernel('v3-legacy')` retains the verlet integrator for one release cycle as opt-out. All 93 test suites green; typecheck silent.

**Phase 3 (visual sweep)** still owed: side-by-side compare with Cubism Viewer on shelby + Hiyori. User-side activity. May surface that auto-rig defaults at `cmo3/physics.js:PHYSICS_RULES` need re-tuning (their `scale` fields were tuned for v3-legacy's `(deg/angleMax)*scale` mapping; under cubism-port = `radians*scale` the output magnitudes shrink ~5.7× for SRC_TO_G_ANGLE outputs).

**Original status (queued):** Authored 2026-05-03 by user request: "порт физики из cubism viewer это первоочередная задача". User-flagged as **top priority** for the next autonomous session.

Sister document to [CUBISM_WARP_PORT.md](CUBISM_WARP_PORT.md) — same shape: byte-faithful port from a known-correct reference, with an oracle harness gating each phase.

## What and why

v3 has a hand-rolled "Cubism-style" physics implementation at [`src/io/live2d/runtime/physicsTick.js`](../../src/io/live2d/runtime/physicsTick.js). The header reads:

> v2 R9 — Physics tick. Cubism-style pendulum integrator that turns head/body angle inputs into lagged hair / clothing / bust / arm sway outputs. Pure JS, frame-independent (fixed-dt accumulator), no GL — driven from the main viewport tick.
>
> Algorithm... Standard verlet step per particle, plus a rod constraint pinning each vertex at `radius` from its parent. Verlet is well-behaved under the fixed-dt regime (1/60 s) we run at; energy creep over many seconds is bounded by the `mobility` velocity-damping factor.
>
> Calibrated so default Hiyori rules settle in ~0.5 s.

**It's an approximation.** The header even says so — "Cubism-style", "Standard verlet", "calibrated so default Hiyori rules settle in ~0.5 s". That's a v3-side calibration, not a port. The same shape of gap we closed for the chain evaluator in Phase 2b: hand-rolled approximation that worked at rest but diverged from Cubism under genuine driver input.

**Reference is Cubism Web Framework's `CubismPhysics` class.** Repo: https://github.com/Live2D/CubismWebFramework. File: `src/physics/cubismphysics.ts` and `src/physics/cubismphysicsinternal.ts`. Live2D's source license (Live2D Open Software License) restricts redistribution but permits derivative works for interop with `physics3.json` files — same legal posture as the warp/rotation port from Cubism Core (DLL via IDA), where we transcribed the algorithm to JS for our own use.

**Important:** unlike the warp/rotation port, **physics is NOT in Cubism Core**. It's in the Web Framework layer (pure TypeScript, no WASM dep). So the RE shape is different:
- Warp/rotation port → DLL → IDA → asm/decompile → JS port
- Physics port → public Web Framework TypeScript source → JS port (or compile-and-import)

The TypeScript source IS the canonical reference. No reverse engineering needed. We just need to ensure byte-faithful transcription.

**Reality check on "visible divergence":** the user has not reported a specific physics-related visual bug. The port is queued because (a) v3's impl is hand-rolled and admitted-as-approximate, (b) every other Cubism kernel that v3 had hand-rolled (warp eval, rotation Setup) revealed divergence under measurement once the oracle harness arrived. Physics is the last unported runtime kernel in v3; finishing the matching set is the goal, not a known visual regression. **If oracle measurement shows v3's physics already matches Cubism's within 1e-4 across the test fixtures, the port may collapse to a no-op cleanup. Don't pre-assume divergence.**

## Why it's first-priority (per user 2026-05-03)

1. **Last unported runtime kernel.** Phase 1 (warp eval) and Phase 2b (rotation Setup) shipped; physics is the remaining hand-rolled piece. Finishing it brings v3's runtime kernels up to byte-faithful Cubism parity.
2. **Pre-emptive risk closure.** Every other v3-hand-rolled Cubism kernel that we measured against an oracle showed divergence (warp 17 px PARAM, rotation 5 px PARAM). Same risk profile here until measured.
3. **GAP-017 (in-app idle motion generation) downstream check.** Idle motion drives params; if v3's physics doesn't match Cubism's, the in-app preview of generated idle looks different from what the user gets when shipping to Ren'Py / VTuber Studio. Closing the parity gap before GAP-017 ships means the in-app preview is trustworthy.
4. **Phase 5 (visual sweep) of CUBISM_WARP_PORT.md is the next user-side gate.** That sweep will inevitably show physics behaviour. Closing the physics port first means the sweep gate isn't conflated with two open kernel divergences at once.

## Structure mirrors CUBISM_WARP_PORT

| Phase | Goal | Reference |
|-------|------|-----------|
| 0 — RE + harness | Map Cubism Web Framework's `CubismPhysics` to v3's `physicsTick`. Build oracle harness that runs both against a fixed `physics3.json` + driver-param sequence; diff per-frame output param values | `CubismPhysics.ts` (Web Framework); `physics3.json` from any reference model |
| 1 — Kernel port | Port `CubismPhysicsRig.update()` byte-faithfully to a new `cubismPhysicsKernel.js` | Web Framework's `_inputs[]`, `_particles[]`, `_outputs[]` walk |
| 2 — Wire-in | Replace `physicsTick.tickPhysics()`'s integration loop with the byte-faithful kernel; keep the v3 fixed-dt accumulator harness around it | `physicsTick.js` |
| 3 — Visual parity sweep | Side-by-side Cubism Viewer + v3 Live Preview on shelby + Hiyori; user confirms no divergence | — |

Each phase gates on the next: kernel port doesn't ship until oracle byte-matches; visual sweep doesn't run until oracle is green.

## Phase 0 — Source mapping + oracle harness (½–1 day)

**Deliverables:**

1. **Fetch Web Framework source.** Pull `cubismphysics.ts`, `cubismphysicsinternal.ts`, `cubismphysicsjson.ts` (and any helpers they import — `cubismmath.ts`, `cubismvector2.ts`) into `reference/cubism-web-framework/physics/` as an immutable snapshot. Do not include the rest of the Web Framework — only what physics needs.
   - License hygiene: include the upstream `LICENSE.md` + repo URL + commit SHA in a top-level `reference/cubism-web-framework/README.md` so the source is attributed.

2. **Decide oracle invocation strategy.** Three options, pick at Phase 0 not later:
   - **(a) On-the-fly TS compile.** Use `tsx` or `esbuild` in the harness to compile + import the .ts files at runtime. Simplest to set up; adds ~1 dep.
   - **(b) Pre-compile to JS.** Run `tsc` once on the snapshot, commit the .js output alongside. Zero runtime overhead; harness imports plain JS.
   - **(c) Hand-transcribe inline.** Port directly into the harness. Loses the "clean reference" property — once you transcribe, you're already half-porting. Don't do this for Phase 0.
   - **Recommendation:** (b). Pre-compile keeps the harness simple and the reference self-contained.

3. **Map the data structures.** Compare Web Framework's `CubismPhysicsRig` shape against v3's `rule` shape and write the field-by-field crosswalk:
   - Web Framework's `_inputs[].source.targetType` (e.g. `Parameter`) — does v3 carry this?
   - `_particles[].mobility/delay/acceleration/radius` — v3 has `vertices[i].{mobility, delay, acceleration, radius}`. Likely 1:1, but verify.
   - `_outputs[].destinationParameterIndex` — v3 uses `outputs[i].paramId` (string lookup). Diff in addressing scheme.
   - `_normalizationPosition` / `_normalizationAngle` — v3 has `rule.normalization.{posMin, posMax, angleMin, angleMax}`. Likely 1:1, verify.

4. **New `scripts/cubism_physics/diff_v3_vs_oracle.mjs` harness:**
   - Load a `physics3.json` (start with shelby's; add Hiyori later).
   - Load the pre-compiled Web Framework physics (per option (b) above) as oracle.
   - Drive both with a scripted param sequence (e.g. ParamAngleX swept 0→30→0→-30→0 over 4 seconds at 60 Hz; ParamBodyAngleZ ramp; combined drives).
   - Per-frame, compare every output param's value.
   - Report max/mean divergence per output, identify which fixtures diverge worst.

5. **Pinned baselines.** ~10 driver fixtures: head angle sweeps, body angle sweeps, body angle Z-sustained, breath cycle 1 period, combined head+body drive, step-input (jump from 0 to ±30), and rest. Don't aim for 21 like the warp port — physics fixtures are more redundant.

**Verification gate:** harness runs end-to-end on shelby's `physics3.json`; produces a structured per-frame, per-output divergence table. **The exact baseline divergence is unknown until measured.** Plan numbers below assume some divergence to fix; if Phase 0 measurement shows v3 already matches within 1e-4, Phases 1-3 collapse and the port becomes "delete the v3-style header comment, file as already-correct".

## Phase 1 — Kernel port (1–2 days, conditional on Phase 0 measurement)

**Approach:** read `cubismphysics.ts` + `cubismphysicsinternal.ts`, write the equivalent JS module in `src/io/live2d/runtime/cubismPhysicsKernel.js`. Same naming as the source, same struct shapes, same helper functions. Don't refactor — port verbatim. Constants (gravity-correction scalar, max weight, movement threshold, etc.) come from the source at port time, not pre-committed in this plan — listing them here would invite drift.

**Checkpoints during port (each gated independently against Phase 0 oracle):**
- After porting input aggregation (`Update()` head): oracle byte-equal on a single-input single-particle drive.
- After porting `UpdateParticles()`: oracle byte-match on multi-vertex chains (ribbon / long skirt with 4–8 particles).
- After porting `UpdateOutputs()`: oracle byte-match on `isReverse` outputs (used by some authored physics3.json files).
- After porting frame-rate handling (Cubism uses a fixed timestep too, possibly with different MAX_SUBSTEPS): oracle byte-match across `dt` variations (60 Hz nominal, 30 Hz, 144 Hz).

**Verification gate:** oracle harness shows max |v3_out − oracle_out| < 1e-4 (float32 noise floor) on every fixture in the Phase 0 baseline. No fixture allowed at >1e-3 even temporarily — that hides bugs.

**Out-of-band checkpoint:** if a fixture in Phase 0 already shows v3 < 1e-4 to oracle, copy the proof into Phase 5 results, skip rebuilding it. Don't pretend to "port" what already matches.

## Phase 2 — Wire-in (½ day)

Replace `physicsTick.tickPhysics()`'s body with a call to the byte-faithful kernel. Two parts of v3's current physicsTick to handle carefully:

1. **Fixed-dt accumulator + MAX_SUBSTEPS capping** — verify whether Cubism does this internally or expects callers to. If callers, keep v3's accumulator wrapper. If internal, replace v3's wrapper with calls into the kernel's own dt handling. Phase 0's frame-rate-variation test answers this.
2. **`createPhysicsState()` / `tickPhysics()` signature** — keep externally identical so consumers (`CanvasViewport`'s tick loop) don't need changes. Internals replaced.

Behind a `kernel: 'v3-legacy' | 'cubism-port'` flag mirroring Phase 2b's pattern. Default flips to `cubism-port` immediately after Phase 1 oracle gates pass — flag is opt-out only, removed after one release.

**Verification gate:** `npm test` green; oracle harness still byte-matches; existing `physicsTick` consumer tests pass (they should — wire-in keeps the same `tickPhysics()` signature).

## Phase 3 — Visual parity sweep (¼ day, user-side)

Side-by-side: Cubism Viewer playing shelby, v3 Live Preview playing the same shelby. User scrubs params (head angle, body angle, sustained drives), confirms no visible divergence. Same protocol as Phase 5 of CUBISM_WARP_PORT.

If user reports any visible divergence after Phase 1 oracle was green: that's a bug in (a) v3's physics3.json import, or (b) the kernel port's harness vs production code path. Diagnose; don't re-RE.

## Out of scope

- **Physics rule authoring.** SS already auto-emits physics rules in `cmo3/physics.js` for hair/skirt/etc; that emission code isn't changed. The port is runtime only.
- **physics3.json schema changes.** SS's emit path stays compatible with what Cubism Editor produces.
- **Performance optimisation.** Cubism's reference impl runs comfortably at 60 Hz on shelby's ~5 rules; a faithful port should too. Optimise only if Phase 2 measurement shows >10% regression.

## Risk register

| Risk | Mitigation |
|------|-----------|
| Web Framework source license (Live2D Open Software License) restricts derivatives | Port is for **interop** with Cubism's authored physics3.json files — same legal posture as the warp/rotation port from Cubism Core. Source attribution preserved in `reference/cubism-web-framework/README.md`. The port is ours; it consumes Cubism-format authored data. |
| Cubism's algorithm has variant branches not visible at first read | Phase 0 maps every branch (input types, output types, particle initialisation) before Phase 1 starts. Same pattern as cubismWarpEval's 9-region dispatch. |
| Cubism's integrator choice (Euler / verlet / RK / Cubism-bespoke) differs from v3's verlet | The kernel port replaces v3's integration entirely. Whatever Cubism does is what we do. v3's "verlet is well-behaved" comment is a v3 design note, not a guarantee Cubism uses verlet. |
| Phase 0 measurement reveals v3 already byte-matches | Plan collapses: skip Phases 1-3, file as "v3 was already correct". Note in this doc + memory entry. The TS-source mapping in Phase 0 is still valuable as documentation. |
| Phase 0 measurement reveals v3 diverges in NORMAL cases (small drives, default params) | Port priority confirmed; proceed with Phases 1-3. |
| Phase 0 measurement reveals v3 diverges only in EDGE cases (extreme drives, unusual physics3.json topologies) | Document the edge cases, defer port unless a real-world model hits them. The "ship the kernel port now" calculus depends on whether an actual user character is affected. |
| Hiyori-only tuning bakes into v3 (memory: physicsTick was "calibrated so default Hiyori rules settle in ~0.5 s") | The byte-faithful port has no tuning constants of its own — Cubism's algorithm is parameter-driven, mobility/delay/acceleration come from authored physics3.json. Calibration becomes a non-issue. |
| Behaviour change visible to users on existing characters | Keep the `kernel: 'v3-legacy'` flag for one release cycle. Document as a kernel-port commit; users who notice can opt back to legacy via the flag temporarily. Same migration shape as Phase 2b. |
| Web Framework's CubismPhysics depends on `CubismVector2`, `CubismMath`, etc. — pulling them in expands the snapshot | Pull only what's transitively needed by `cubismphysics.ts` + `cubismphysicsinternal.ts`. The transitive set is small (Vector2 + a few math helpers). Leave the rest of Web Framework out. |

## Estimated cost

| Phase | Days | Conditional? |
|-------|------|--------------|
| 0 — Source mapping + oracle harness | 0.5–1.0 | always |
| 1 — kernel port | 1.0–2.0 | only if Phase 0 measures non-trivial divergence |
| 2 — wire-in + flag | 0.5 | only if Phase 1 ran |
| 3 — visual sweep | 0.25 (user-side) | always — confirms in-app preview matches Cubism Viewer |
| **Total if Phase 0 finds divergence** | **2.25–3.75 days** | |
| **Total if Phase 0 finds no divergence** | **0.5–1.25 days** | (just Phase 0 + Phase 3) |

The big uncertainty is Phase 0's outcome. The plan is structured to bail out cheap if v3 already matches.

## Anti-patterns (lessons from CUBISM_WARP_PORT)

- **Don't pitch alternative architectures** while the port is in flight (memory: `feedback_exact_port.md`). Web Framework is the reference; transcribe.
- **Don't speculate about per-symptom divergences** — the oracle measures, the port matches. If a fixture diverges after Phase 1 ships, RE the matching Web Framework branch, not invent a fix.
- **Don't add per-character tuning** to compensate for kernel divergence. Tuning hides the bug; we want the fix.
- **Don't ship the port without oracle gates.** Phase 1's "does shelby look right" is not a gate — Phase 0's harness is.

## Cross-references

- [`physicsTick.js`](../../src/io/live2d/runtime/physicsTick.js) — current hand-rolled impl
- [`cmo3/physics.js`](../../src/io/live2d/cmo3/physics.js) — physics rule emission (unchanged by this port)
- [`physicsRules`](../../src/io/live2d/rig/physicsRules.js) — rule shape + `resolvePhysicsRules`
- [`CUBISM_WARP_PORT.md`](CUBISM_WARP_PORT.md) — sister document with the same structure
- Web Framework source: https://github.com/Live2D/CubismWebFramework (look at `src/physics/cubismphysics.ts`)
