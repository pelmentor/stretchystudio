# Cubism Physics Port — Plan

**Status:** queued. Authored 2026-05-03 by user request: "порт физики из cubism viewer это первоочередная задача". User-flagged as **top priority** for the next autonomous session.

Sister document to [CUBISM_WARP_PORT.md](CUBISM_WARP_PORT.md) — same shape: byte-faithful port from a known-correct reference, with an oracle harness gating each phase.

## What and why

v3 has a hand-rolled "Cubism-style" physics implementation at [`src/io/live2d/runtime/physicsTick.js`](../../src/io/live2d/runtime/physicsTick.js). The header reads:

> v2 R9 — Physics tick. Cubism-style pendulum integrator that turns head/body angle inputs into lagged hair / clothing / bust / arm sway outputs. Pure JS, frame-independent (fixed-dt accumulator), no GL — driven from the main viewport tick.
>
> Algorithm... Standard verlet step per particle, plus a rod constraint pinning each vertex at `radius` from its parent. Verlet is well-behaved under the fixed-dt regime (1/60 s) we run at; energy creep over many seconds is bounded by the `mobility` velocity-damping factor.
>
> Calibrated so default Hiyori rules settle in ~0.5 s.

**It's an approximation.** The user reports visual divergence between the same model played in v3's Live Preview vs Cubism Viewer — same characters, same params, different sway behavior. That's the same kind of "Cubism-style approximation" gap we just closed for the chain evaluator (Phase 2b).

**Reference is Cubism Web Framework's `CubismPhysics`.** Open-source (MIT-style Live2D license) at `github.com/Live2D/CubismWebFramework/blob/develop/src/physics/cubismphysics.ts`. The DLL at `D:\Program Files\Live2D Cubism 5.0\app\dll64\Live2DCubismCoreJNI.dll` also contains the physics impl (accessible via IDA MCP if Web Framework's source is ambiguous).

The Web Framework class implements the canonical reference algorithm. That's what `physics3.json` is authored against and what every Cubism SDK consumer expects. v3 must match it byte-for-byte to claim runtime parity.

## Why it's first-priority

1. **User-visible divergence.** Hair, clothing, bust, ribbon sway look different between v3 and Cubism Viewer for the same model. This is the kind of difference users notice immediately.
2. **Already-shipped models.** Every character SS has exported assumes Cubism-spec physics will play it back. v3 not matching means those characters look "off" in the in-app preview vs how they'll look in any SDK consumer (Ren'Py, VTuber Studio, etc.).
3. **Idle motion generator (GAP-017) depends on this.** The generator's auto-skip-physics-output logic is correct against `physics3.json`, but the *visual* check that "the generated idle plays nicely with the physics outputs" requires v3's physics to match Cubism's. Otherwise the motion looks fine in Cubism Viewer but wrong in SS.
4. **Phase 5 of CUBISM_WARP_PORT.md (visual sweep) is incomplete without it.** Visual side-by-side will surface physics divergence as the next bug. Better to port it now than chase reports later.

## Structure mirrors CUBISM_WARP_PORT

| Phase | Goal | Reference |
|-------|------|-----------|
| 0 — RE + harness | Map Cubism Web Framework's `CubismPhysics` to v3's `physicsTick`. Build oracle harness that runs both against a fixed `physics3.json` + driver-param sequence; diff per-frame output param values | `CubismPhysics.ts` (Web Framework); `physics3.json` from any reference model |
| 1 — Kernel port | Port `CubismPhysicsRig.update()` byte-faithfully to a new `cubismPhysicsKernel.js` | Web Framework's `_inputs[]`, `_particles[]`, `_outputs[]` walk |
| 2 — Wire-in | Replace `physicsTick.tickPhysics()`'s integration loop with the byte-faithful kernel; keep the v3 fixed-dt accumulator harness around it | `physicsTick.js` |
| 3 — Visual parity sweep | Side-by-side Cubism Viewer + v3 Live Preview on shelby + Hiyori; user confirms no divergence | — |

Each phase gates on the next: kernel port doesn't ship until oracle byte-matches; visual sweep doesn't run until oracle is green.

## Phase 0 — RE + oracle harness (½–1 day)

**Deliverables:**

1. Pull the Web Framework's `CubismPhysics.ts` + companion files into `reference/cubism-web-framework/` (download once, treat as immutable reference). The pull is a one-time setup, not a runtime dep.

2. Map the data structures:
   - `CubismPhysicsRig._inputs[]` ↔ v3's `rule.inputs[]`
   - `CubismPhysicsRig._particles[]` ↔ v3's `rule.vertices[]` + `state.particles[]`
   - `CubismPhysicsRig._outputs[]` ↔ v3's `rule.outputs[]`
   - `CubismPhysicsRig._normalizationPosition` / `_normalizationAngle` ↔ v3's `rule.normalization`

3. New `scripts/cubism_physics/diff_v3_vs_oracle.mjs` harness:
   - Load a `physics3.json` (start with shelby's; add Hiyori later)
   - Load Web Framework's `CubismPhysics` (via dynamic import or hand-port it)
   - Drive both with a scripted param sequence (e.g. ParamAngleX swept 0→30→0→-30→0 over 4 seconds at 60 Hz)
   - Per-frame, compare every output param's value
   - Report max/mean divergence per output

4. Pinned baselines: 21 fixtures matching the existing `cubism_oracle/snapshots/` style — driver param sequences that exercise hair, skirt, arm, bust, breath physics independently and combined.

**Verification gate:** harness produces structured per-frame diff; v3-legacy mode shows the current divergence (probably ~degrees on extreme drives).

## Phase 1 — Kernel port (1–2 days)

**Approach:** read CubismPhysics.ts, write the equivalent JS module in `src/io/live2d/runtime/cubismPhysicsKernel.js`. Same naming, same struct shapes, same helper functions (e.g. `getInputTranslationXFromNormalizedParameterValue`). Don't refactor — port verbatim.

**Critical numbers** (extracted from Web Framework, in advance):
- `Air resistance` = 5.0
- `Maximum weight` = 100.0
- `Movement threshold` = 0.001
- `Angle correction` = M_PI / 180.0
- `Vertex acceleration` = 100.0 (matches v3's `ACCEL_SCALAR` already, by coincidence or by lineage)

**Checkpoints during port:**
- After porting `Update()` — oracle should be runnable with byte-equal output to Web Framework on a simple ParamAngleX→ParamHairFront drive.
- After porting `UpdateParticles()` — oracle byte-match on multi-vertex chains (ribbon, skirt).
- After porting `UpdateOutputs()` — oracle byte-match on isReverse outputs (rare but present).

**Verification gate:** oracle harness shows v3's output deltaPx max < 1e-4 (float32 noise floor) on all 21 fixtures.

## Phase 2 — Wire-in (½ day)

Replace `physicsTick.tickPhysics()`'s body with a call to the byte-faithful kernel. Keep the fixed-dt accumulator + substep capping (those are v3-specific harness, not part of Cubism's algorithm). Delete `stepRule()` / `aggregateInputs()` / `writeRuleOutputs()` once `cubismPhysicsKernel.update()` covers them.

Behind a `kernel: 'v3-legacy' | 'cubism-port'` flag (mirrors Phase 2b's pattern). Default flips after Phase 3 visual sweep passes.

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
| Web Framework source license restricts derivatives | Port is for **interop** with Cubism's authored physics3.json files — same legal posture as the warp/rotation port. The port is ours; it consumes Cubism-format authored data. |
| Cubism's algorithm has variant branches (e.g. extrapolate flag, like the warp kernel had) | Phase 0 maps every branch up front; Phase 1 ports each branch. Same pattern as cubismWarpEval's 9-region dispatch. |
| Verlet vs Cubism's actual integrator differs | If Web Framework uses a different integrator than v3's verlet (likely — verlet is one choice among many), the port replaces it entirely. v3's "verlet is well-behaved" comment is a v3 design note, not a guarantee Cubism uses verlet. |
| Hiyori-only tuning bakes into v3 (memory: physicsTick was "calibrated so default Hiyori rules settle in ~0.5 s") | Bytewise port has no tuning constants of its own — Cubism's algorithm is parameter-driven, mobility/delay/acceleration come from the authored physics3.json. Calibration becomes a non-issue. |
| User shipping characters today have stable v3-physics behaviour they'd notice the change | Keep the `kernel: 'v3-legacy'` branch behind a flag for one release cycle. Document the new behaviour as a kernel-port commit; users who notice can opt back to legacy temporarily. Same migration shape as Phase 2b. |

## Estimated cost

| Phase | Days |
|-------|------|
| 0 — RE + harness | 0.5–1.0 |
| 1 — kernel port | 1.0–2.0 |
| 2 — wire-in | 0.5 |
| 3 — visual sweep | 0.25 (user-side) |
| **Total** | **2.25–3.75 days** |

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
