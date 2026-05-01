# Cubism Warp Evaluator Port

Living document. Tracks the byte-faithful port of the in-app runtime evaluator
from v3's hand-written code to a direct port of Live2D Cubism Core's
deformation algorithms.

Update this doc as we go — phase status, RE findings, decisions, blockers.
Don't delete superseded notes; cross them out so the trail stays readable.

---

## Goal

Replace v3's hand-written runtime evaluators ([chainEval](../../src/io/live2d/runtime/evaluator/chainEval.js),
[warpEval](../../src/io/live2d/runtime/evaluator/warpEval.js),
[rotationEval](../../src/io/live2d/runtime/evaluator/rotationEval.js),
[artMeshEval](../../src/io/live2d/runtime/evaluator/artMeshEval.js)) with
**byte-faithful ports** of the Cubism Live2D Cubism Core algorithms.

After this work:

- Visual output of v3's in-app rig matches Cubism Viewer pixel-for-pixel on the same model + params.
- The whole class of bugs "warp X doesn't behave like Cubism" disappears at the root, not via per-symptom patches.
- Hand-written evaluators can be deleted; the port is the single source of truth.

## Why now

v3's evaluator was written from scratch during the [Native Rig Refactor](./NATIVE_RIG_REFACTOR_PLAN.md)
(Phase v2 — chainEval, scrubber UI, mask allocator, idle-skip eval cache).
Multiple bugs accumulated showing it doesn't match Cubism — body angle X/Y/Z
deformation looks "garbage", breath squashes the head, face angle leaks past
its bbox. The bbox-cutoff fix (BUG-006) addressed extrapolation but the user
reports residual divergence after that landed.

User decision **2026-04-30**: stop incremental patches; do a port. No crutches.

---

## Reference materials

| Item | Path / source | Used for |
|------|---------------|----------|
| **Test PSD** (input) | `D:\Projects\Programming\stretchystudio\shelby_neutral_ok.psd` | Repro |
| **Reference `.cmo3`** | `D:\Projects\Programming\stretchystudio\shelby.cmo3` | Authoring-format ground truth |
| **Reference runtime bundle** | `D:\Projects\Programming\stretchystudio\New Folder_cubism\` | What Cubism Viewer loads |
| **Cubism Core binary** | `C:\Program Files\Live2D Cubism 5.0\app\dll64\Live2DCubismCoreJNI.dll` (Cubism Editor's JNI wrapper — statically links the core) | Source of truth for warp/rotation algorithms |
| **IDA Pro MCP** | User-side; on-demand | Disasm + pseudocode of core eval functions |
| **moc3 binary spec** | moc3ingbird community RE (memory: `reference_moc3_resources.md`) | Layout cross-check |
| **Cubism Web Framework** | github.com/Live2D/CubismWebFramework | Wrappers / calling conventions, NOT eval (eval lives in closed core) |
| **Existing v3 evaluator** | [src/io/live2d/runtime/evaluator/](../../src/io/live2d/runtime/evaluator/) | What's being replaced |
| **moc3 inspectors** | [scripts/moc3_inspect*.py](../../scripts/) | Verifying our exported moc3 vs reference at byte level |

**Hiyori is intentionally excluded** from this work — user already validated
moc3 byte-parity against Hiyori (memory: `project_runtime_export_parity.md`),
and shelby is the active test character. All visual diffs go shelby-vs-shelby.

---

## Verification setup

Visual screenshot diff against Cubism Viewer is too noisy for a port — pixel-perfect match is unrealistic and small numeric divergences are invisible until they're catastrophic. We need **numeric ground truth**.

**Approach: harness the Cubism Web SDK as an oracle.**

`Live2DCubismCore.js` (the public Web SDK) exposes `csmGetDrawableVertexPositions(model, drawableIndex)` — returns a Float32Array of post-eval canvas-px vertex positions. The oracle and v3's in-app eval must operate on the **same rig** for the comparison to be meaningful, so the flow is:

1. v3 builds `rigSpec` from `shelby_neutral_ok.psd` (wizard → Init Rig)
2. v3's exporter writes that `rigSpec` to a `.moc3` on disk (this path is already at byte-parity per `project_runtime_export_parity.md`)
3. Oracle harness loads OUR exported `.moc3` into Cubism Web SDK, calls `csmUpdateParameters` + `csmUpdateModel` for a fixture `(param → value)` table, dumps `csmGetDrawableVertexPositions` per drawable → snapshot JSON
4. Our v3 in-app evaluator runs on the same `rigSpec` with the same params, dumps same shape
5. Numeric diff: per-vertex `|cubismPos - v3Pos|`, report max + mean, threshold ~0.01 px (float32 noise floor)

We compare **same rig, two evaluators** — Cubism's runtime via exported moc3 vs our JS in-app evaluator. Both consume identical input data; any divergence is in the eval algorithm, which is exactly what the port is fixing.

**Sanity check before Phase 1 begins:** run the oracle on `New Folder_cubism\shelby.moc3` (Cubism Editor's own authored runtime, not ours) AND on our exported `.moc3` of `shelby_neutral_ok.psd`. Both must load and produce vertex positions without errors — confirms the harness itself is correct and our exporter still produces a valid moc3. If either fails, fix that before continuing.

This is the **canonical pass criterion** for every phase — green when max diff < threshold across the diagnostic param table. Visual screenshot diff is a sanity check for humans, not the verification metric.

The harness lives at `scripts/cubism_oracle/` (created in Phase 0). Reuses Cubism Web SDK's published `Live2DCubismCore.js` — no extra deps.

**Diagnostic params (in order of priority for the port):**

| Param | Range | Drives | Why prioritised |
|-------|-------|--------|-----------------|
| `ParamEyeBallX/Y` | ±1 | Iris RotationDeformer | Smallest, fastest oracle target — start here |
| `ParamBodyAngleX` | ±10 | BodyXWarp | Most-reported broken |
| `ParamBodyAngleY` | ±10 | BodyWarpY | Same family |
| `ParamBodyAngleZ` | ±10 | BodyWarpZ (canvas-px parent) | Coord-space test (canvas-px vs normalised) |
| `ParamBreath` | 0..1 | BreathWarp | Has the head-squash regression |
| `ParamAngleX/Y/Z` | ±30 | FaceParallax + FaceRotation | Tests rotation→warp boundary (the `1/canvasMaxDim` hack lives here) |

For each: capture oracle snapshot at a few key values (e.g., -10, -5, 0, 5, 10), pin them as test fixtures, lock in the port via diff tests.

---

## Plan

### Phase 0 — Setup, oracle harness, symbol inventory

**Inputs:** Cubism SDK / Editor install on user's machine, IDA Pro MCP, shelby runtime bundle.

**Tasks:**

- [ ] **Oracle harness** at `scripts/cubism_oracle/`:
  - Pull Cubism Web SDK's `Live2DCubismCore.js` into the project (or reference via local path — no npm dep)
  - Write a Node/browser script: load `New Folder_cubism\shelby.moc3` → set params from a fixture table → dump `csmGetDrawableVertexPositions` per drawable → write `.json` snapshot per param value
  - This is the ground truth for every subsequent phase's "is this port correct" check
- [ ] Locate Cubism Core binary. Targets in priority order:
  1. **Cubism SDK for Native 5** at `C:\Live2D Cubism 5.0 SDK for Native\Core\dll\windows\x86_64\Live2DCubismCore.dll` (or wherever user installed) — public DLL, public header `Live2DCubismCore.h` gives struct layouts and signatures, IDA handles cleanly
  2. **Cubism Web SDK** `.wasm` — `Live2DCubismCore.wasm`. Often a *better* RE target than the DLL because:
     - Typed function signatures survive stripping (WASM keeps types in the binary)
     - Pure i32/f32/i64 ops, no SSE/AVX confusion
     - Smaller code surface — `wabt`/`wasm2wat` produces readable text
     - If DLL is too messy, fall back to WASM
  3. **Cubism Editor binary** — last resort; the editor likely statically links or dynamically loads its own copy of the core, so it's the same algorithm but harder to isolate from editor surrounding code
- [ ] Open chosen binary in IDA. Anchor the graph from public exports (`csmGetVersion`, `csmInitializeAmountOfMemory`, `csmReviveMocInPlace`, `csmGetSizeofModel`, `csmInitializeModelInPlace`, `csmUpdateModel`, `csmGetDrawableVertexPositions`).
- [ ] Identify the **inner per-deformer math functions** — these are what we port, NOT `csmUpdateModel` (we already have our own chain orchestrator):
  - Warp deformer apply (per-vertex bilinear math + boundary handling)
  - Rotation deformer apply (per-vertex matrix math + parent-frame conversion)
  - Mesh keyform interpolation (per-vertex blend across keyform tuple)
  - Parameter blend → cell weights (cellSelect equivalent)
- [ ] Map struct layouts using public `Live2DCubismCore.h` as starting point — that header gives us `csmModel`, `csmModelInfo`, drawable arrays, parameter arrays. The internal `csmDeformer` / `csmKeyform` structs are private but moc3ingbird community spec (memory `reference_moc3_resources.md`) covers the binary layout.

**Output of Phase 0:**

1. Working `scripts/cubism_oracle/` harness — produces ground-truth vertex snapshots for any (shelby, paramValues) tuple
2. Pinned snapshot files for each row of the diagnostic param table (initial baseline)
3. **Symbol map** in the RE Findings section below — IDA addresses + recovered names + brief signatures for the deformer-apply functions
4. **Decision** on which binary (DLL vs WASM) is the cleaner reference — committed for the rest of the port

**Status:** ✅ Done (2026-05-01). Binary inventoried, all critical kernels + setups identified and renamed in IDB, dispatch-entry layout confirmed, oracle harness running, baseline snapshots pinned for both Editor's `shelby.moc3` and our v3 exporter's `shelby.moc3`. See RE Findings for full detail.

---

### Phase 1 — Port warp deformer eval

**Scope:** Replace `bilinearFFD` + bbox-cutoff logic in [chainEval.js](../../src/io/live2d/runtime/evaluator/chainEval.js) (lines 139-167) and [warpEval.js](../../src/io/live2d/runtime/evaluator/warpEval.js) with the Cubism algorithm.

**Tasks:**

- [ ] Pull IDA pseudocode of the warp-deformer apply function. Capture:
  - Input arguments (deformer index, parent vertex array, output vertex array, parameter values)
  - Local variables / loops
  - Cell index calculation (the equivalent of our `i = floor(u * cols)`)
  - Boundary handling (clamp / extrapolate / cutoff — answer the question my BUG-006 fix guessed at)
  - Bilinear weight formula (is it the simple `(1-u)(1-v)` form? or are weights cached per cell?)
  - Whether keyform blending happens in the same function (single pass) or pre-computed (the deformed grid is read pre-blended)
- [ ] Translate to JS — direct line-by-line from the pseudocode, no "improvements"
- [ ] Wire into `chainEval`: replace the `state.kind === 'warp'` branch (lines 139-167)
- [ ] Run oracle harness with the diagnostic params; numeric diff `(cubism vertex - v3 vertex)` should be < ~0.01 px max
- [ ] Pin the verified port with regression test fixtures (Phase 0's snapshots become locked-in baselines)

**Notes for the porter:**

- **My BUG-006 cutoff guess gets explicitly verified or replaced.** The bbox-cutoff logic I added (use `baseGrid` outside `[0,1]`) was reasoned, not measured against Cubism. Phase 1 either confirms it (in which case the port keeps the same shape) or replaces it (port's behavior wins). Don't preserve the cutoff for sentimental reasons.
- **Mask allocator and idle-skip eval cache survive the port.** Both are orthogonal — mask allocator picks render targets for clipping, idle-skip cache short-circuits when params haven't changed. Neither lives in the deformer apply function; they live in the chain walker / scene pass and stay as-is.

**Risks:**

- Cubism may store grid in a different memory layout (e.g., column-major vs row-major; pre-swizzled for SIMD)
- Cubism may use SSE/AVX. JS has no SIMD by default — port semantically (write the scalar version of what SIMD did), accept the perf hit (eval is per-frame on small mesh counts; scalar JS is fast enough)
- The "outside-bbox" question may turn out to be neither "extrapolate" nor "cutoff" — could be a smooth attenuation, or a specific weight clamp, or the question may not even arise (Cubism might never let an out-of-bbox vertex reach the warp because it pre-rejects in the chain walk)

**Status:** ⏳ Blocked on Phase 0.

---

### Phase 2 — Port rotation deformer eval

**Scope:** Replace [rotationEval.js](../../src/io/live2d/runtime/evaluator/rotationEval.js) (`evalRotation`, `buildRotationMat3`) and the anisotropic mat3 builder in chainEval with the Cubism algorithm.

**Open question right now:** The `1/canvasMaxDim` hack (chainEval lines 197-216, `_warpSlopeX/Y` derived from `canvasToInnermostX/Y`) is a workaround we discovered when arms flew off in v2 R6. Cubism's actual algorithm probably doesn't have this concept at all — it works in moc3 binary's pre-baked `rotation_deformer_keyform.scales` field. The port should strip the workaround and use whatever Cubism does.

**Tasks:**

- [ ] Pull IDA pseudocode of the rotation-deformer apply function
- [ ] Identify how `keyform.scales` gets consumed (this is the field memory: `reference_moc3_compile_time_fields.md` notes is `1/canvasMaxDim` for warp-parented rotations)
- [ ] Confirm pivot-relative vs canvas-px input convention
- [ ] Translate, wire in, verify on `ParamEyeBallX/Y` (smallest test surface) and `ParamAngleZ` (FaceRotation)

**Status:** ⏳ Blocked on Phase 1.

---

### Phase 3 — Port chain composition

**Scope:** Replace [chainEval.js](../../src/io/live2d/runtime/evaluator/chainEval.js)'s `evalArtMeshFrame` parent-walk loop with Cubism's composition algorithm.

**Open questions to resolve from IDA:**

- What order does Cubism apply deformers? (parent-to-child, child-to-parent, or topological order with an explicit tree walk?)
- Does Cubism do per-frame caching of deformer states, or recompute per-mesh?
- Where does the rotation→warp coordinate-space change happen — inside the rotation function, inside the warp function, or in the chain walker?

**Status:** ⏳ Blocked on Phase 1+2.

---

### Phase 4 — Port artmesh eval

**Scope:** Replace [artMeshEval.js](../../src/io/live2d/runtime/evaluator/artMeshEval.js) and its keyform-blending math.

**Open questions:**

- How does Cubism compose 1D vs 2D keyform grids (the cross-product cellSelect output)?
- Are mesh keyforms in parent-deformer-local space already (matching our convention) or in some normalised intermediate?

**Status:** ⏳ Blocked on Phase 1+2+3.

---

### Phase 5 — Numeric + visual parity sweep on shelby

**Scope:** Run oracle harness across the diagnostic param table, numeric diff every drawable, document divergences, file follow-up bugs for any residual, then visual sanity check against Cubism Viewer screenshots for human confidence.

**"Done" criteria:**

- Oracle harness reports max per-vertex diff < 0.01 px across every diagnostic param value
- Hand-written `chainEval/warpEval/rotationEval/artMeshEval` files deleted (or reduced to thin re-exports of the port)
- BUG-003 (Body Angle X/Y/Z), BUG-006 follow-up (residual warp issues), and any new bugs filed during Phases 1-4 all closed
- Visual sanity check: side-by-side Cubism Viewer + v3 (Live Preview, GAP-010) on shelby, no obvious deviation across param scrubs

**Status:** ⏳ Blocked on Phases 1-4.

---

## Test strategy

The existing test suite has units for the to-be-replaced files: [test_chainEval.mjs](../../scripts/test/test_chainEval.mjs), [test_warpEval.mjs](../../scripts/test/test_warpEval.mjs), [test_rotationEval.mjs](../../scripts/test/test_rotationEval.mjs), [test_artMeshEval.mjs](../../scripts/test/test_artMeshEval.mjs). These tests encode v3's hand-written behavior — they're a regression net for the *current* code, not the *correct* code.

**Per-phase test handling:**

1. **Math tests** (e.g., bilinear weight formulas, rotation matrix construction) — these encode the OLD math. They get **deleted** when the port replaces their target. The replacement test is the oracle-harness diff against Cubism's snapshot for the same input.
2. **Structural tests** (e.g., chain walk visits parents in order, deformer state cache returns same instance for same id) — these encode integration shape, which doesn't change. They **stay**.
3. **Edge-case tests** (e.g., empty mesh, missing parent, NaN parameter values) — keep, but re-target inputs against ground truth from the oracle harness rather than hand-computed expected values.

Add new test file per phase: `test_cubism_oracle_<phase>.mjs` — loads pinned oracle snapshots, runs ported eval, asserts numeric match within threshold. These tests become the regression net post-port.

---

## License / scope considerations

This is reverse engineering for **interop** — making our tool produce models that load correctly in Cubism Viewer. Live2D Cubism Core is proprietary; direct algorithm transcription is a derivative work in the legal sense, even if the goal is interop.

Practical bounds:

- Internal use only at this stage — code stays in the project repo, doesn't ship as a standalone library
- Document the RE source in code comments at the top of each ported function (`// RE'd from Live2DCubismCore.dll, function at <addr>` or `// matches WASM export <id>`) so the provenance trail is preserved
- If we ever distribute, revisit — Live2D's terms allow runtime use of the published Web SDK, which would be the deployment path for the open-source-friendly version of the tool

This isn't a blocker for the port; it's a note to keep distribution decisions deliberate later.

---

## RE Findings

Cumulative as we discover them. Append; don't overwrite.

### Cubism Core binary inventory

*(Phase 0 — IDA session 2026-04-30)*

**Binary chosen:** `C:\Program Files\Live2D Cubism 5.0\app\dll64\Live2DCubismCoreJNI.dll` (112 KB, 221 functions). This is Cubism Editor's JNI wrapper, but it **statically links the entire Cubism Core** — no `LoadLibrary`/`GetProcAddress` calls, the `csm*` impls live in this same image. That makes it a self-contained RE target with all eval logic visible.

- MD5 `8f90d89d3a7e51255b0262cb7c5b69a8` / SHA256 `a1c9c194c0518756b47538c4164311c235a83ac77ec51b992a7e01e8125c7bca`
- Image base in this IDA session: `0x7fff2b240000` (ASLR — addresses below are relative to base; subtract `0x7fff2b240000` for image-relative offsets)
- Segments: `.text` 0x13000, `.rdata` 0x3e50, `.data` 0x2000

**JNI surface (entry points into the core):**

`Java_com_live2d_sdk_cubism_core_Live2DCubismCoreJNI_*` — thin wrappers around the actual `csm*_impl` functions. The notable one is `updateModel @ 0x7fff2b241400` which forwards directly to `csmUpdateModel_impl @ 0x7fff2b24c550`.

**Inner symbols recovered + renamed in IDB:**

| Address | Renamed | Role |
|---------|---------|------|
| `0x7fff2b24c550` | `csmUpdateModel_impl` | Per-frame eval pipeline — calls 32 stages in sequence (see "Pipeline taxonomy" below) |
| `0x7fff2b24af70` | `InitializeDeformers` | Build-time table builder — populates per-deformer 48-byte dispatch entry with type, indices, **setup func ptr**, **eval func ptr** |
| `0x7fff2b24cc40` | `WarpDeformer_TransformTarget` | ⭐ Per-vertex warp eval kernel (Phase 1 port target) |
| `0x7fff2b24c950` | `RotationDeformer_TransformTarget` | ⭐ Per-vertex rotation eval kernel (Phase 2 port target) |
| `0x7fff2b24e410` | `WarpDeformer_Setup` | Per-frame: deforms warp's grid via parent's eval kernel **in-place**, then propagates opacity/multiply/screen colors |
| `0x7fff2b24dee0` | `RotationDeformer_Setup` | Per-frame: **finite-difference probes parent eval** to derive local rotation+scale at this rotation deformer's pivot, stores into `model[68/69/70/71]` |
| `0x7fff2b253020` | `angle_between_vec2_wrapped` | Helper: `atan2(b)-atan2(a)` wrapped to `(-π, π]`. Used by `RotationDeformer_Setup` to convert a Jacobian column into a rotation angle |
| `0x7fff2b252970` | `UpdateModel_SavePrevDrawableState` | Stage 1 — copy dynamic-flag/drawOrder/renderOrder/multiply/screen arrays to prev-frame slots (used later for diff-based dirty flags) |
| `0x7fff2b24f0b0` | `UpdateModel_ClampParameters` | Stage 2 — per parameter: clamp into `[min,max]` (or modulo-wrap if repeat-flag set); record per-param dirty bit |
| `0x7fff2b24eeb0` | `UpdateModel_CellSelectNormalParams` | Stage 3 — for each non-blend-shape param binding: locate cell index + interp `t`, record cell-changed and t-changed dirty bits |
| `0x7fff2b24e880` | `UpdateModel_CellSelectBlendShapeParams` | Stage 4 — same but for blend-shape bindings (MOC v≥4 only) |
| `0x7fff2b24e660` | `UpdateModel_BlendShapeGroupBlend` | Stage 6 — blend per-group keyform tuple results into per-group min weight |
| `0x7fff2b24c670` | `UpdateModel_ClampPartOpacities` | Stage 7 — SIMD clamp `model[+104]` (part opacities) into `[0,1]` |
| `0x7fff2b24f320` | `UpdateModel_ComputePartVisibility` | Stage 8 — per part: parent-visible AND own-flag → output BOOL into `model[+80]` |
| `0x7fff2b24f230` | `UpdateDeformerHierarchy` | **Computes per-deformer visibility** — also reveals dispatch-entry layout (see below) |
| `0x7fff2b24f1b0` | `UpdateModel_ComputeDrawableVisibility` | Per drawable: parent-part-visible AND parent-deformer-visible AND own-flag → BOOL `model[+848]` |
| `0x7fff2b252470b` | `UpdateModel_ComputeDynamicFlags` | Final stage — diff vs prev-frame state, populate `csmDrawableDynamicFlags` bits (visible/visible-changed/opacity-changed/drawOrder-changed/renderOrder-changed/vertices-changed/blendColor-changed) |

Other renamed helpers: `swap_bytes_u32_array`, `swap_bytes_u8`, `swap_finish`, `detect_endianness`, `endian_swap_all`, `validate_header_section`, `validate_data_section`, `validate_id_strings`, `validate_begin_count_range`, `validate_indexed_begin_count`, `resolveSOT_to_pointers`, `postprocess_runtime_and_uvflip`, `csm_log_printf`, `csmHasMocConsistency_impl`, `csmReviveMocInPlace_impl`, `csmGetSizeofModel_impl`. These are MOC-load-time helpers, not per-frame eval — they don't need to be ported, only the layout they produce matters.

**Confidence on naming:** Every name in the table above is grounded in either a string xref (e.g., `"WarpDeformer::TransformTarget() error..."`, `"InitializeDeformers(): Unknown Deformer Type."`, `"UpdateDeformerHierarchy(): Unknown Deformer Type."`, `"RotationDeformer: Not found tr..."`) or unambiguous data-flow signature (`sinf`/`cosf`/`atan2f` patterns, SIMD clamp pattern, dirty-flag patterns). Pipeline-stage roles are derived from decompiled bodies — most stages just iterate one model array and produce a derived array, the role is what each pair of input/output arrays represents.

**Deformer dispatch table (built once by `InitializeDeformers`, consumed by `csmUpdateModel`):**

`model[77]` (= `model + 616`) is an array of 48-byte entries, one per deformer in eval-order. Layout corrected after decompiling `UpdateDeformerHierarchy`:

| Offset | Type | Field | Notes |
|--------|------|-------|-------|
| 0 | qword | `parentPart` | `partArray + 56 * partIdx` — deformer's owning part |
| 8 | int | `parentPartVisIdx` | Index into part-visibility BOOL[] at `model[+80]` (or -1 if no parent part) |
| 12 | int | `parentDeformerIdx` | Index of parent deformer in this same `model[77]` table (or -1 if root) |
| 16 | int | `deformerType` | 0 = warp, 1 = rotation, else `"UpdateDeformerHierarchy(): Unknown Deformer Type."` |
| 20 | int | `deformerArrayIdx` | Index into per-type array — for warps it's the drawable array (`model[15]`); for rotations it's `model[42]` |
| 24 | qword | `setupFnPtr` | Per-frame setup: `WarpDeformer_Setup` or `RotationDeformer_Setup` |
| 32 | qword | `evalFnPtr` | Per-vertex transform: `WarpDeformer_TransformTarget` or `RotationDeformer_TransformTarget` |
| 40 | int | `enabled` | Visibility/enabled flag |
| 44 | int | `padding` | Probably padding to 48-byte alignment |

**Eval kernel signature is uniform:** `(csmModel*, dispatchEntryIdx, vertsIn*, vertsOut*, vertCount)`. Both warp and rotation match. The chain orchestrator in our v3 `chainEval` can be kept; the port only replaces the per-vertex math.

`UpdateDeformerHierarchy` (stage 11) also writes per-type visibility BOOLs:
- `model[+288]` (= `model[36]` as qword) — per-warp visibility (indexed by warp's drawable index)
- `model[+528]` (= `model[66]`) — per-rotation visibility (indexed by `model[42]` array index)
- `model[+624]` (= `model[78]`) — per-dispatch-entry visibility (indexed in `model[77]` order)

**Partial model-struct field map** (offsets are `model[N]` in qword units i.e. raw_offset = N×8):

| `model[N]` | Type | Use |
|------------|------|-----|
| `[0]` | `MOC*` | header at offset 4 = version byte |
| `[15]` | qword ptr | drawable array (32 bytes/entry — warp deformer's grid-size lives here) |
| `[17]` | qword ptr | per-drawable cumulative warp-grid vertex counts |
| `[28]` (DWORD) | `int` | drawable count |
| `[36]` (DWORD) | `int` | total warp-grid vertices across all warp deformers |
| `[38]` | qword ptr | per-warp-deformer pointer to its **grid vertex positions** array (the deformed grid for the current frame, interleaved x,y) |
| `[42]` | qword ptr | rotation deformer struct array (16 bytes/entry; +8 = local angle, +12 = back-ref to pipeline-eval index) |
| `[44]` | qword ptr | per-rotation-deformer cumulative-vertex-counts |
| `[68]` | float ptr | per-rotation-deformer scale |
| `[69]` | float ptr | per-rotation-deformer pivot Y (translate Y in output) |
| `[70]` | float ptr | per-rotation-deformer pivot X |
| `[71]` | float ptr | per-rotation-deformer accumulated angle from parameter binding |
| `[72]` | int ptr | per-rotation-deformer reflectX flag |
| `[73]` | int ptr | per-rotation-deformer reflectY flag |
| `[77]` | qword ptr | **deformer dispatch table** (48 bytes/entry — see above) |
| `[82]` (DWORD) | `int` | likely part count |
| `[142]` | qword ptr | part struct array (56 bytes/entry) |
| `[152]` (DWORD) | `int` | total deformer count |

This map is partial; the rest gets filled in as we port. Notably model[15] (drawable) and model[42] (rotation deformer) record sizes are confirmed (32 / 16 bytes). The drawable's warp-grid metadata is in those 32 bytes: cols at +8, rows at +12, extrapolation flag at +16.

### Warp deformer algorithm

*(Phase 0 RE — pseudocode-level findings; full byte-faithful port lives in Phase 1)*

`WarpDeformer_TransformTarget(model, pipelineIdx, vertsIn, vertsOut, vertCount)` at `0x7fff2b24cc40`. Per input vertex `(u, v)`:

**Grid lookup:**
- `deformerIdx = model[77][pipelineIdx*48 + 20]`
- `drawable = model[15] + 32 * deformerIdx`
- `cols = drawable[+8]`, `rows = drawable[+12]`, `extrapolateFlag = drawable[+16]`
- `gridVerts = (float*)model[38][deformerIdx]` — 2 floats (x,y) per grid vertex, row-major, stride = `(cols+1)`

**INSIDE case** (`0 ≤ u < 1` AND `0 ≤ v < 1`):
- `cellU = floor(u*cols)`, `du = u*cols - cellU`
- `cellV = floor(v*rows)`, `dv = v*rows - cellV`
- `cellIdx = cellU + (cols+1) * cellV` (TL corner of cell), `cellIdxNext = cellIdx + (cols+1)` (BL of next row)

  Two branches by `extrapolateFlag`:

  - **Flag = 0** (default — _triangle-split bilinear_, NOT plain bilinear):
    - if `du + dv > 1` (upper-right triangle):
      ```
      out = (1-du)·gridVerts[cellIdxNext]
          + (du-1+dv)·gridVerts[cellIdxNext+1]
          + (1-dv)·gridVerts[cellIdx+1]
      ```
    - else (lower-left triangle):
      ```
      out = (1-du-dv)·gridVerts[cellIdx]
          + du·gridVerts[cellIdx+1]
          + dv·gridVerts[cellIdxNext]
      ```
  - **Flag = 1** (full bilinear, no triangle split):
    ```
    out = (1-du)(1-dv)·gridVerts[cellIdx]
        + du(1-dv)·gridVerts[cellIdx+1]
        + (1-du)·dv·gridVerts[cellIdxNext]
        + du·dv·gridVerts[cellIdxNext+1]
    ```

  > **Critical for our v3 port:** v3's `bilinearFFD` always uses the 4-point bilinear form (matches `extrapolateFlag=1`). Cubism's default with flag=0 is **two-triangle** decomposition. They differ along the cell diagonal. This may explain residual divergence even after BUG-006's bbox-cutoff fix. Phase 1 must replicate the triangle-split branch.

**OUTSIDE case** (`u` or `v` outside `[0,1)`): this is where Cubism does **explicit extrapolation**, not cutoff. v3 currently falls back to `baseGrid` (no displacement); Cubism continues to displace vertices that are outside the warp's normalised range, using the gradients of the grid at the nearest edge.

Algorithm sketch (the implementation is intricate ~200 LOC; full transcription belongs in Phase 1):

1. **First out-of-bounds vertex triggers a one-shot lazy init** of "edge gradients" — six precomputed quantities derived from the four corner grid vertices and the two adjacent-to-corner grid vertices: `(centroid, dGrid/dU, dGrid/dV, mixedDeriv, halfDU, halfDV)` where each is a float2.
2. Subsequent vertices reuse the cached edge gradients.
3. Dispatch by quadrant relative to `[0,1]²`:
   - **Far field** (`u ≤ -2 OR u ≥ 3 OR v ≤ -2 OR v ≥ 3`): pure linear extrapolation using `centroid + u·dGrid/dU + v·dGrid/dV`.
   - **Side bands** (one coord in `[0,1]`, the other in `[-2,3]`): use the 1D row/column of grid vertices on the relevant edge as a basis, blend toward the far-field gradient.
   - **Corner zones** (both coords in `[-2,0]` or both in `[1,3]`): use the corner grid vertex itself, project outward using diagonal gradients.
4. Final blend per quadrant uses the same triangle-split-or-bilinear logic as INSIDE, with the gradient-derived "virtual" corner positions.
5. If somehow both coords land back in `[0,1]` here (shouldn't happen given the dispatch), Cubism logs `"WarpDeformer::TransformTarget() error. [%d] p01=(%.4f , %.4f)"` — this is the guard that lets us be sure this branch handles all out-of-bounds inputs.

> **What this means for v3:** my BUG-006 cutoff fix was *too conservative* — it stops displacement entirely outside the warp bbox. The correct behavior is "displacement continues, derived from edge gradients". This is consistent with the user's report that BodyAngle and Breath warps still feel wrong after BUG-006 — affected vertices that are slightly outside the warp's normalised range get no displacement at all in v3, but Cubism still moves them.

### Rotation deformer algorithm

*(Phase 0 RE — pseudocode-level; full port lives in Phase 2)*

**Eval kernel** `RotationDeformer_TransformTarget(model, dispatchIdx, vertsIn, vertsOut, vertCount)` at `0x7fff2b24c950`. Per input vertex `(px, py)`:

```
deformerIdx   = model[77][dispatchIdx*48 + 20]
angleDeg      = model[42][16*deformerIdx + 8]            // base angle from MOC
              + model[71][deformerIdx]                   // accumulated parameter contribution
angleRad      = angleDeg * π / 180
sinA, cosA    = sinf(angleRad), cosf(angleRad)
scale         = model[68][deformerIdx]
ty            = model[69][deformerIdx]
tx            = model[70][deformerIdx]
reflectX      = model[72][deformerIdx] ? -1 : 1          // x-flip flag
reflectY      = model[73][deformerIdx] ? -1 : 1          // y-flip flag

out.x = px·(-sinA · scale · reflectY) + py·(scale · cosA · reflectX) + ty
out.y = px·( scale · cosA · reflectY) + py·( scale · sinA · reflectX) + tx
```

The output mapping has x↔y axes swapped relative to a textbook 2D rotation matrix — Cubism-specific convention for parent-frame orientation. The port carries this exactly.

The kernel processes 4 vertices per loop iteration when `vertCount ≥ 4` (manually unrolled), with a tail loop for the remainder.

**Setup function** `RotationDeformer_Setup(model, dispatchIdx)` at `0x7fff2b24dee0` — this is the surprising one. It computes `scale`/`tx`/`ty`/parent-angle by **finite-difference probing the parent deformer's eval kernel**:

```
1. Read this rotation deformer's pivot point (px, py) in parent frame from MOC.
2. parentEvalFn = model[77][parentDispatchIdx*48 + 32]   // parent's eval func ptr
3. Call parentEvalFn(model, parentDispatchIdx, &(px, py), &center, 1)
                                                  // 1 vertex: pivot transformed to world
4. Try increasing finite-difference deltas (10 iterations, δ = 0.1f → 0.01f → ...):
   call parentEvalFn(..., &(px+δ, py), &probeX, 1)
   call parentEvalFn(..., &(px,   py+δ), &probeY, 1)
   colJacX = probeX - center
   colJacY = probeY - center
   if colJacX != 0 AND colJacY != 0: break
5. Decompose the 2x2 Jacobian into (rotation, scale):
   parentLocalAngle = angle_between_vec2_wrapped(colJacX, [neutralVec])
   parentLocalScale = |colJacX| / δ        (and similarly Y)
6. Store:
   model[71][deformerIdx] = parentLocalAngle  (radians→degrees converted later)
   model[68][deformerIdx] = scale base * parentLocalScale
   model[69][deformerIdx] = center.y         (translated pivot world position)
   model[70][deformerIdx] = center.x
   model[72]/[73]         = reflect flags from sign of Jacobian
```

If after 10 iterations the parent transform still hasn't moved between probes (degenerate Jacobian), Cubism logs `"[CSM] [W]RotationDeformer: Not found tr..."` and uses zero rotation.

**Implications for v3:**
- The "rotation deformer rides on warp" mechanism that v3 emulates via `_warpSlopeX/Y` (the `1/canvasMaxDim` hack in chainEval lines 197-216) is Cubism's finite-difference Jacobian decomposition. v3 hand-coded a closed-form approximation that happens to match for axis-aligned warps; the port replaces it with the actual finite-difference probe.
- `keyform.scales` field in the moc3 binary (memory: `reference_moc3_compile_time_fields.md`) feeds the *base* scale before parent decomposition, not the final scale used here.
- This setup runs once per rotation deformer per frame — **2-3 parent eval calls per rotation deformer per frame**. For shelby's ~10 rotation deformers and small mesh sizes, that's negligible cost. Don't worry about perf in the port — match semantics.

### Warp deformer setup (chain composition)

`WarpDeformer_Setup(model, dispatchIdx)` at `0x7fff2b24e410`. This is **how warp grids inherit their parent deformer's deformation**:

```
1. parentDispatchIdx = model[77][dispatchIdx*48 + 12]
2. ownDrawableIdx    = model[77][dispatchIdx*48 + 20]
3. ownGrid           = model[38][ownDrawableIdx]   // (cols+1)×(rows+1) vec2 array
4. gridVertCount     = model[15][ownDrawableIdx*32 + 20]
5. If parentDispatchIdx == -1 (root warp):
     - own scale = 1.0
     - own opacity = paramBindingOpacity[drawableIdx] (from binding eval)
   Else:
     parentEvalFn = model[77][parentDispatchIdx*48 + 32]
     parentEvalFn(model, parentDispatchIdx, ownGrid, ownGrid, gridVertCount)  // IN-PLACE
     own scale = parentBindingOpacity[parent] * parentScale[parentDispatchIdx]
     own opacity propagated from parent
6. (MOC v≥4 only) propagate multiply/screen colors from parent
```

**Key insight:** the warp's grid is **deformed in place** by the parent's eval kernel. By the time `WarpDeformer_TransformTarget` runs to push a child mesh's vertices through this warp, the grid is already fully-composed in canvas space. v3's chainEval does the same conceptually but with a different orchestration (parent-walk loop in `chainEval` instead of per-deformer setup pass).

**Implication for the chain orchestrator:** v3's parent-walk and Cubism's setup-then-eval produce equivalent results when the eval kernels match. The port can keep v3's orchestration; only the per-vertex math inside `bilinearFFD` (warp) and `evalRotation` (rotation setup + transform) is replaced.

### csmUpdateModel pipeline taxonomy

*(Phase 0 RE — order of stages inside `csmUpdateModel_impl @ 0x7fff2b24c550`)*

| # | Address | Renamed | What it does |
|---|---------|---------|--------------|
| 1 | `0x7fff2b252970` | `UpdateModel_SavePrevDrawableState` | Copy this-frame drawable state into prev-frame slots for later diff |
| 2 | `0x7fff2b24f0b0` | `UpdateModel_ClampParameters` | Clamp/wrap each parameter into `[min, max]` per repeat-flag |
| 3 | `0x7fff2b24eeb0` | `UpdateModel_CellSelectNormalParams` | For each binding: find cell index + interp t (with epsilon-aware boundary) |
| 4 | `0x7fff2b24e880` | `UpdateModel_CellSelectBlendShapeParams` | Same for blend-shape bindings (MOC v≥4) |
| 5 | `0x7fff2b24ee50` | *unidentified small (83 B)* | Wraps `sub_7FFF2B24EA00` — likely zeros/inits some accumulator |
| 6 | `0x7fff2b24e660` | `UpdateModel_BlendShapeGroupBlend` | Compose per-group blend-shape weights from per-keyform contributions |
| 7 | `0x7fff2b24c670` | `UpdateModel_ClampPartOpacities` | SIMD-clamp all part opacities to `[0, 1]` |
| 8 | `0x7fff2b24f320` | `UpdateModel_ComputePartVisibility` | Per part: combine own flag + parent-visible into BOOL[] |
| 9 | `0x7fff2b24fbd0` | *unidentified blend-shape index resolve (464 B)* | Per drawable: composite multi-keyform index/UV streams from MOC keyform tables |
| 10 | `0x7fff2b250cd0` | *tiny (23 B)* | Wraps `sub_7FFF2B251020` |
| 11 | `0x7fff2b24f230` | `UpdateDeformerHierarchy` | Build per-deformer + per-warp + per-rotation visibility BOOL arrays. Confirms dispatch-entry layout |
| 12 | `0x7fff2b250500` | *blend-shape resolve (655 B)* | Per drawable: keyform vertex-position resolve, stride 32 |
| 13 | `0x7fff2b24fda0` | *blend-shape index/UV/color resolve (1018 B)* | Same shape as #9, color streams |
| 14 | `0x7fff2b250eb0` | *unidentified (367 B)* | Calls `qword_7FFF2B2591C0` import + `sub_7FFF2B251020` |
| 15 | `0x7fff2b250cf0` | *unidentified (446 B)* | Same import family — likely vertex assembly continuation |
| 16 | `0x7fff2b24f1b0` | `UpdateModel_ComputeDrawableVisibility` | Per drawable: parent-part-visible AND own → BOOL[] |
| 17 | `0x7fff2b24f380` | *blend-shape resolve (770 B)* | Same family as #9/#12/#13 |
| 18 | `0x7fff2b250af0` | *unidentified (439 B)* | Calls 3 imports + `sub_7FFF2B251020` |
| 19 | `0x7fff2b24f9f0` | *blend-shape resolve (480 B)* | Same family — stride 40 |
| 20 | `0x7fff2b250cb0` | *tiny (31 B)* | |
| 21 | `0x7fff2b2519b0` | *small (65 B)* | Wraps `sub_7FFF2B251850` |
| 22 | `0x7fff2b251f20` | *unidentified (308 B)* | Calls `sub_7FFF2B251A00`, `251700`, `251300` |
| 23 | `0x7fff2b251d70` | *unidentified (417 B)* | Same callees |
| 24 | `0x7fff2b251190` | *unidentified (363 B)* | Calls `sub_7FFF2B251A00`, `251850`, `251700`, `251300` |
| 25 | `0x7fff2b2515a0` | *unidentified (68 B)* | Wraps `sub_7FFF2B251700` |
| 26 | `0x7fff2b24dda0` | *unidentified (308 B)* | |
| 27 | `0x7fff2b24dd20` | *small (118 B)* | |
| 28 | `0x7fff2b24da50` | *unidentified (247 B)* | |
| 29 | `0x7fff2b252060` | *unidentified (391 B)* | Calls `sub_7FFF2B2522D0` |
| 30 | `qword_7FFF2B2591A8` | *function pointer in `.data`* | Indirect — dispatched via global table |
| 31 | `0x7fff2b2521f0` | *small (218 B)* | Calls `sub_7FFF2B2522D0` |
| 32 | `0x7fff2b2524b0` | `UpdateModel_ComputeDynamicFlags` | Final stage — diff vs prev-frame, populate `csmDrawableDynamicFlags` |

**Where do the deformer kernels actually run inside this pipeline?** Stages 22–24 (`sub_7FFF2B251F20/251D70/251190` and friends, all calling the helper family `sub_7FFF2B251020/251300/251700/251850/251A00/2515F0/2522D0`) are the most likely candidates — they're after the visibility passes (which gate which deformers run) and before the final dynamic-flag composer. Confirming exactly which stage triggers `WarpDeformer_Setup` / `RotationDeformer_Setup` is Phase 3 work; for Phase 1, all that matters is that **the per-vertex eval kernels are isolated** and have a known signature, which they do.

The 8 "unidentified blend-shape resolve" stages (#9/#12/#13/#14/#15/#17/#18/#19, sizes 363–1018 B) are all variations of the same theme: iterate drawables, for each one composite multiple keyform streams (indices, UVs, colors, vertex positions) into the active output stream using the cellSelect cell index + interp t from stages 3/4. This is artmesh keyform composition — Phase 4's port surface.

### Chain composition

*(Phase 3 — was clarified during Phase 0; full port question moves to "is v3's parent-walk equivalent to Cubism's setup-then-eval")*

The `WarpDeformer_Setup` / `RotationDeformer_Setup` pseudocode above hold the chain composition mechanism:

1. Each deformer has a known parent dispatch index at `model[77][i*48+12]`.
2. Setup calls **`parent.evalFn(model, parentIdx, myInputData, myOutputData, vertCount)`** — pushes inputs through the parent's transform first.
3. By the time `*_TransformTarget` runs for a child mesh's vertices, all ancestor deformers' state is already in canvas-space.

v3's `chainEval` does this via an explicit parent-walk loop (recursive eval climbing the chain). Same end state; different orchestration. Phase 3 verifies this equivalence rather than reimplementing.

### Artmesh keyform composition

*(Phase 4)*

The 8 "blend-shape resolve" stages in the pipeline (above) are the implementation. They differ only in stride / source MOC offsets — each handles a different category (vertex position vs index vs UV vs multiply-color vs screen-color) of the 1D or 2D keyform tuple. Full port = transcribing one of those stages to JS, then templating across the others. Not in Phase 0 scope.

### Full DLL inventory

*(Phase 0 RE — comprehensive sweep, 2026-05-01)*

#### File metadata

| Field | Value |
|-------|-------|
| Path | `C:\Program Files\Live2D Cubism 5.0\app\dll64\Live2DCubismCoreJNI.dll` |
| MD5 | `8f90d89d3a7e51255b0262cb7c5b69a8` |
| SHA-256 | `a1c9c194c0518756b47538c4164311c235a83ac77ec51b992a7e01e8125c7bca` |
| Image size | `0x1c000` (112 KB) |
| Architecture | x86_64 PE32+ |
| Cubism Core version (via `csmGetVersion`) | 5.0.0 |
| Latest moc3 version supported | 5 |
| Total functions | 221 |
| Renamed functions | 47 (pre-existing 16 + 31 added during Phase 0) |
| Total strings | 211 |

#### Function inventory (by role)

**MOC validation + revive (load-time, called from `csmReviveMocInPlace`):**

| Address | Name | Purpose |
|---------|------|---------|
| `0x7fff2b243580` | `csmReviveMocInPlace` | Public C ABI export, validates address/size + alignment |
| `0x7fff2b248b00` | `csmReviveMocInPlace_impl` | Internal — orchestrates byte-swap + validation |
| `0x7fff2b247530` | `csmHasMocConsistency_impl` | Validates moc structural consistency |
| `0x7fff2b2450d0` | `validate_header_section` (0x23ec — biggest function) | Section-header validity sweep |
| `0x7fff2b244050` | `validate_data_section` | Data-section validity sweep |
| `0x7fff2b2474c0` | `validate_id_strings` | ID-string array validity |
| `0x7fff2b2479f0` | `validate_begin_count_range` | Range checks for begin/count fields |
| `0x7fff2b247a70` | `validate_indexed_begin_count` | Indexed range checks |
| `0x7fff2b247b40` | `endian_swap_all` (0xfba) | Endian-swap every numeric field if needed |
| `0x7fff2b24c870` | `detect_endianness` | Read magic, detect host vs file endianness |
| `0x7fff2b24c830` | `swap_bytes_u32_array` (xref count 139 — most-called helper) | 32-bit word byte swap |
| `0x7fff2b24c800` | `swap_bytes_u8` | Byte swap |
| `0x7fff2b24c900` | `swap_finish` | Final cleanup of swap pass |
| `0x7fff2b243700` | `resolveSOT_to_pointers` | Convert "Section-Offset Table" entries to actual pointers |
| `0x7fff2b2476c0` | `postprocess_runtime_and_uvflip` | Final fixups (e.g. UV Y-flip if needed) |

**Model layout + initialization (load-time, called from `csmInitializeModelInPlace_impl`):**

| Address | Name | Purpose |
|---------|------|---------|
| `0x7fff2b24bb70` | **`csmInitializeModelInPlace_impl`** ⭐ | Top-level model init — calls layout/populate/deformers/initial-update in sequence |
| `0x7fff2b24aa70` | `csmGetSizeofModel_impl` | Returns model byte size (calls ComputeLayout, returns total) |
| `0x7fff2b24a350` | **`ModelInit_ComputeLayout`** (0x6f6) | Builds 70-field layout descriptor — see "Model layout descriptor" below |
| `0x7fff2b249370` | **`ModelInit_PopulateFieldPointers`** (0x45a) | Populates the qword-pointer header from the layout descriptor |
| `0x7fff2b24b440` | **`ModelInit_DeformersAndDrawables`** (0x72f) | Calls `InitializeDeformers` + sorts drawables + sets up dynamic flags. `qsort` is used here for draw-order sort |
| `0x7fff2b24af70` | `InitializeDeformers` (0x4c1) | Builds the per-deformer 48-byte dispatch entry (type, indices, setup/eval fnPtrs) |
| `0x7fff2b249050` | *helper called by PopulateFieldPointers* | Per-field pointer copy with offsets |
| `0x7fff2b248d20` | *helper called by PopulateFieldPointers* | Same family |
| `0x7fff2b2497d0` | *helper called by PopulateFieldPointers* | Same family |
| `0x7fff2b249c20` | *helper called by ComputeLayout* | Computes nested keyform/blend-shape sizes |
| `0x7fff2b249980` | *helper called by ComputeLayout* | Computes deformer layout sizes |
| `0x7fff2b24a130` | *helper called by ComputeLayout* | Computes drawable-related sizes |
| `0x7fff2b24aad0`, `0x7fff2b24ac80`, `0x7fff2b24aef0`, `0x7fff2b24bc30`, `0x7fff2b24be60`, `0x7fff2b24c030`, `0x7fff2b24c240` | *helpers called by `ModelInit_DeformersAndDrawables`* | Per-array initialization (drawable parents, mask references, draw orders) |

**Eval kernels + parent-walk (per-frame deformation, the Phase 1/2 port targets):**

| Address | Name | Purpose |
|---------|------|---------|
| `0x7fff2b24cc40` | ⭐ **`WarpDeformer_TransformTarget`** | Per-vertex bilinear (triangle-split) inside + edge-gradient extrapolation outside |
| `0x7fff2b24c950` | ⭐ **`RotationDeformer_TransformTarget`** | Per-vertex 2×2 matrix (sin/cos × scale × reflect + pivot translate) |
| `0x7fff2b24e410` | `WarpDeformer_Setup` | Per-frame: deforms own grid via parent eval, propagates opacity/colors |
| `0x7fff2b24dee0` | `RotationDeformer_Setup` | Per-frame: finite-difference Jacobian probe of parent eval, decompose to (rotation, scale) |
| `0x7fff2b253020` | `angle_between_vec2_wrapped` | Helper — wraps `atan2(b)-atan2(a)` to `(-π, π]` |
| `0x7fff2b24c030` | *unidentified small func using `powf`* | Likely a binding-curve interp helper |

**csmUpdateModel pipeline (32 stages — see "csmUpdateModel pipeline taxonomy" earlier in this doc for ordered table):**

Beyond the 14 primary stages already named in that table:

| Stage role | Renamed |
|------------|---------|
| Stage 5 wrapper | `UpdateModel_BlendShapeGroupSetup` (calls `BlendShape_GroupCombinatorialBlend`) |
| Stage 9 | `BlendShape_ResolveDrawableIndexUV_v2` |
| Stage 10 | `UpdateModel_BlendShapeWrapper1` |
| Stage 12 | `BlendShape_ResolveDrawableVertexPositions` |
| Stage 13 | `BlendShape_ResolveDrawableIndexUVColor` |
| Stage 14 | `BlendShape_DispatchVertexAccum_v1` |
| Stage 15 | `BlendShape_DispatchVertexAccum_v2` |
| Stage 17 | `BlendShape_ResolveDrawableMultiplyScreen_v4` |
| Stage 18 | `BlendShape_DispatchVertexAccum_v3` |
| Stage 19 | `BlendShape_ResolveDrawableMultiplyScreen_v5` |
| Stage 20 | `UpdateModel_BlendShapeWrapper2` |
| Stage 21 | `BlendShape_DispatchDrawOrderInt` |
| Stage 22 | `BlendShape_DispatchOpacityMultiplyScreen` |
| Stage 23 | `BlendShape_DispatchOpacityDrawOrder` |
| Stage 24 | `BlendShape_DispatchOpacityDrawOrderRender` |
| Stage 25 | `BlendShape_DispatchOpacity` |
| Stage 26 | `UpdateModel_BlendShapeFinalize_v1` |
| Stage 27 | `UpdateModel_BlendShapeFinalize_v2` |
| Stage 28 | `UpdateModel_DrawOrderSort` |
| Stage 29 | `UpdateModel_BuildTransparencyOrders` |
| Stage 30 | *CFG-protected fnptr* `qword_7FFF2B2591A8` — runtime-resolved at first call |
| Stage 31 | `UpdateModel_FinalizeRenderOrders` |

**Blend-shape composition helpers (called by stages 22-25 + their dispatchers):**

| Address | Name | Signature / role |
|---------|------|------------------|
| `0x7fff2b251020` | `BlendShape_InterleaveTriplets` | Generic SIMD gather/interleave 3 streams into output, stride-aware |
| `0x7fff2b251300` | `BlendShape_InterpColor3` | Composite (R,G,B) channel triple from MOC keyform table — combinationCount {1, 2} branches |
| `0x7fff2b251700` | `BlendShape_InterpScalar1` | Same shape, single float (opacity etc.) — clamped to `[a5,a6]` arg-range |
| `0x7fff2b2515f0` | `BlendShape_InterpScalar1_v2` | Variant — different output write convention |
| `0x7fff2b251850` | `BlendShape_InterpInt1Rounded` | Float interpolation + `+0.001` round-to-int conversion (for `drawOrder`) |
| `0x7fff2b251a00` | `BlendShape_AccumVertexBuffer` | Composite a 2*N float buffer (vertex stream) — SIMD-unrolled 4 floats/iter |
| `0x7fff2b250790` | `BlendShape_CompositeStreams6` | Per-drawable: composite 6 parallel streams (likely indexCount, indices, mUV, sUV, multiply, screen) |
| `0x7fff2b24ea00` | `BlendShape_GroupCombinatorialBlend` | For a parameter group with K bindings: produce 2^K combinations of (compound cell idx, weight) |
| `0x7fff2b2522d0` | `BuildTransparencyLinkedList` | Per transparency group: build linked list of drawables, assign render orders |

**Draw-order finalisation:**

| Address | Name | Purpose |
|---------|------|---------|
| `0x7fff2b24da50` | `UpdateModel_DrawOrderSort` | Sort drawables by drawOrder (uses `qsort`) |
| `0x7fff2b252060` | `UpdateModel_BuildTransparencyOrders` | Build linked-list of transparent drawables for back-to-front render |
| `0x7fff2b2521f0` | `UpdateModel_FinalizeRenderOrders` | Walk the lists, write final renderOrder per drawable |
| `0x7fff2b2524b0` | `UpdateModel_ComputeDynamicFlags` | Diff vs prev-frame, populate dynamic-flag bits |
| `0x7fff2b252970` | `UpdateModel_SavePrevDrawableState` | Save current state to prev-frame slots for next frame's diff |

**JNI bridge (Java entry points):**

`Java_com_live2d_sdk_cubism_core_Live2DCubismCoreJNI_*` — 13 wrappers around `csm*_impl` functions for Java callers. The biggest is `initializeJavaModelWithNativeModel @ 0x7fff2b241990` (3868 B) which constructs the Java model class from native data — fills in parameter ID strings, drawable IDs, part IDs, references back to native arrays. Not relevant for the port (we never go through Java).

**Top-level orchestration (the only function we actually need to "port" semantically — everything else is called from it):**

`csmUpdateModel_impl` @ `0x7fff2b24c550` — 32-stage sequence above. v3's `chainEval` is the analog. The port replaces just `WarpDeformer_TransformTarget` (Phase 1) and `RotationDeformer_TransformTarget` (Phase 2). Stages 1-8 (parameter clamping, cellSelect, part visibility) and Stage 11 (`UpdateDeformerHierarchy`) and Stages 16-32 (drawable visibility, blend-shape composition, draw-order, dynamic flags) are not touched — they're either already done equivalently in v3 or out of scope.

#### Model layout descriptor

`ModelInit_ComputeLayout` (decompiled in Phase 0) builds a 560-byte descriptor (140 dwords = 70 fields × 2 dwords each). For each model field `i`:

- `descriptor[2i]` = byte offset of field `i`'s data within the model (filled in by alignment loop)
- `descriptor[2i+1]` = byte offset where field `i+1` starts

Element sizes are hardcoded constants at `dword_7FFF2B258018` through `dword_7FFF2B258460` (each is the "bytes per element" for one field). The function multiplies these by counts pulled from the MOC header to get total bytes per field, then aligns each to 16 bytes.

Sample of size constants (extracted from .data):
- `dword_7FFF2B258018` = 16 (parameter count × 16 = parameter records)
- `dword_7FFF2B258020` = 4 (parameter count × 4 = param values float[])
- `dword_7FFF2B258028` = 4 (...)
- `dword_7FFF2B258390` = 48 (deformer count × 48 = dispatch table)
- ...

A complete extraction of all 70 (offset, sizePerElement, source-MOC-count-offset) tuples is sufficient to reconstruct the entire model struct field layout in v3, but Phase 1 doesn't need it — only the per-vertex eval kernels access these fields, and our v3 chainEval already has its own equivalent layout. This is an artifact preserved for Phases 2-4.

#### Eval-kernel constants (`.rdata`)

Floats extracted from `.rdata` at addresses referenced by warp + rotation kernels:

| Address | Bytes | Float | Used in |
|---------|-------|-------|---------|
| `0x7fff2b254a5c` | `00 00 80 3f` | `1.0f` | sentinel |
| `0x7fff2b254a60` | `00 00 c0 3f` | `1.5f` | likely outside-band threshold |
| `0x7fff2b254a64` | `6f 12 83 3a` | `1e-3f` | epsilon for finite-difference |
| `0x7fff2b254a68` | `04 00 00 00` | int 4 | iter limit |
| `0x7fff2b254ad0` | `cd cc cc 3d` | `0.1f` | δ start for finite-difference |
| `0x7fff2b254ae0` | `01 01 01 01 (×4)` | int128 | bitmask for SIMD clamp's "where positive" |
| `0x7fff2b254b64` | `db 0f 49 40` | `π = 3.1415927f` | rotation's `degrees → radians` factor |
| `0x7fff2b254b68` | `00 00 00 80` | `-1.0f` | flip flag |
| `0x7fff2b254bd0` | `00 00 80 3f` | `1.0f` | unit |
| `0x7fff2b254bd4` | `00 00 c0 3f` | `1.5f` | bands |
| `0x7fff2b254ae0+0` | `00 00 80 3f, 00 00 80 3f, 00 00 80 3f, 00 00 80 3f` | `vec4(1,1,1,1)` | SIMD clamp upper bound |

These are constants the v3 port needs to match exactly. Document them inline in the port code via `// matches Live2DCubismCore.dll @ 0x7fff2b254...` comments.

#### .data globals (runtime state, not interesting)

The .data section is dominated by import thunks (Win32, CRT, mathf), JNI string literals (csm function names, Java class paths), and CFG-protected dispatch fnptrs (`qword_7FFF2B2591A0..C0`). Nothing the port consumes directly.

#### Renamed-symbol summary

47 functions renamed in the IDB during Phase 0:

- 8 from prior session: validation/swap helpers + `csm*_impl`
- 8 deformer kernels + setups + dispatch (`Warp/Rotation × {TransformTarget, Setup}`, `InitializeDeformers`, `csmUpdateModel_impl`, `csm_log_printf`, `angle_between_vec2_wrapped`)
- 14 csmUpdateModel pipeline stages with identified roles
- 4 ModelInit_* functions
- 13 BlendShape_* helpers + dispatchers
- 5 final-pass functions (DrawOrderSort, BuildTransparencyOrders, FinalizeRenderOrders, ComputeDynamicFlags, SavePrevDrawableState)

Remaining unidentified functions are:
- 24 small/medium internal helpers (mostly model-init field-copy patterns, sub-100 LOC each)
- 13 JNI wrappers (irrelevant — we never go through Java)
- ~30 CRT runtime helpers (`__scrt_*`, `__GSHandlerCheck`, etc., from MSVC startup code)

The unidentified internal helpers can be named on demand as Phases 2-4 reference specific functions, but **none of them are needed for Phase 1's warp-eval port**. Phase 1 has all its prereqs.

---

## Progress tracker

| Phase | Status | Started | Finished | Notes |
|-------|--------|---------|----------|-------|
| 0 — Setup + symbol inventory | ✅ Done | 2026-04-30 | 2026-05-01 | Binary inventoried, kernels + setups RE'd, oracle harness shipping, baselines pinned |
| 1 — Warp port | 🟡 Code shipped, oracle-diff pending | 2026-05-01 | — | `cubismWarpEval.js` ported (INSIDE: triangle-split + 4-point bilinear; OUTSIDE: edge-gradient extrapolation across far field + 4 boundary bands + 4 corner zones). Wired into `chainEval.js`. 29 unit-test cases pass. 13 rig-eval regression tests still green (754 total). Numeric oracle-diff against shelby snapshots is the final gate — needs a programmatic rigSpec build path (open question, see Notes below) |
| 2 — Rotation port | ⏳ Blocked | — | — | Blocked on Phase 1 |
| 3 — Chain composition port | ⏳ Blocked | — | — | Blocked on Phase 2 |
| 4 — Artmesh port | ⏳ Blocked | — | — | Blocked on Phase 3 |
| 5 — Visual parity sweep | ⏳ Blocked | — | — | Blocked on Phases 1-4 |

| Diagnostic param | Status | Notes |
|------------------|--------|-------|
| ParamEyeBallX/Y | ⏳ | Smallest surface — port verification target |
| ParamBodyAngleX | ⏳ | Most-reported broken — Phase 1 verification target |
| ParamBodyAngleY | ⏳ | |
| ParamBodyAngleZ | ⏳ | Tests canvas-px localFrame |
| ParamBreath | ⏳ | Was head-squash; bbox-cutoff fix may already cover this |
| ParamAngleX/Y/Z | ⏳ | Tests rotation→warp boundary |

---

## Decision log

Append new entries; don't edit old ones (cross out + add follow-up if reversed).

- **2026-04-30** — User decision: warp evaluator gets a full port from Cubism Core. No more incremental patches. Reference is shelby (not Hiyori). User has IDA Pro MCP for disassembly.
- **2026-04-30** — Approach: phased port (warp → rotation → chain → artmesh → parity). Each phase gates the next. Living doc at this path is the single tracker.
- **2026-04-30** — Out of scope for this port: physics, breath cycle synth, cursor-look. Those are LIVE DRIVER code (mutate paramValues), not deformation eval. They stay as-is in CanvasViewport for now and will move to LivePreviewCanvas under [GAP-010](../FEATURE_GAPS.md). Mask allocator and idle-skip eval cache also stay — they're orthogonal to deformer apply math.
- **2026-04-30** — Verification approach refined: numeric oracle (Cubism Web SDK's `csmGetDrawableVertexPositions`) is the canonical pass criterion, not visual screenshot diff. Threshold ~0.01 px max per-vertex. Visual diff is sanity-only.
- **2026-04-30** — DLL vs WASM as IDA target: try DLL first (cleaner with public header for struct layouts). Fall back to WASM if DLL is too messy — typed function signatures survive WASM stripping.
- **2026-04-30** — Existing math-only tests for chainEval/warpEval/rotationEval/artMeshEval get deleted when their target is replaced; structural and edge-case tests stay (re-targeted against oracle output). New `test_cubism_oracle_<phase>.mjs` files become the post-port regression net.
- **2026-04-30** — Phase 0 binary chosen: `Live2DCubismCoreJNI.dll` from Cubism Editor 5.0 install. Why this and not the SDK DLL: the JNI wrapper statically links the entire core (no `LoadLibrary`/`GetProcAddress`), so all eval logic is in a single 112 KB image with strings preserved (`"WarpDeformer::TransformTarget() error..."`, `"InitializeDeformers(): Unknown Deformer Type."`). Kernel functions confirmed by string xrefs, not just inferred from data flow. WASM fallback unnecessary.
- **2026-04-30** — Phase 0 finding that motivates Phase 1's first concrete divergence: Cubism's INSIDE warp eval uses a **two-triangle** split (when `extrapolateFlag=0`, the default), not the 4-point bilinear that v3's `bilinearFFD` does. This is a per-vertex algorithmic difference, not just a boundary issue, and may account for residual divergence even after BUG-006's cutoff fix.
- **2026-04-30** — Phase 0 finding that supersedes BUG-006's "use `baseGrid` outside bbox" fix: Cubism continues to displace out-of-bounds vertices using gradients computed at the warp's edges (lazy-cached on first OOB vertex per call). My v3 cutoff-to-baseGrid was too conservative. The Phase 1 port replaces it.
- **2026-05-01** — Phase 0 finding (rotation deformer mechanism): `RotationDeformer_Setup` builds the local rotation+scale **by finite-difference probing the parent eval kernel** (2-3 calls per rotation deformer per frame, 10-iteration retry with shrinking δ for degenerate cases). This is the actual mechanism behind v3's `_warpSlopeX/Y` `1/canvasMaxDim` workaround. The Phase 2 port replaces the closed-form approximation with the finite-difference probe.
- **2026-05-01** — Phase 0 finding (warp chain composition): Cubism deforms each warp's grid **in place** during its setup pass by calling the parent's eval kernel on the grid vertices. v3's `chainEval` parent-walk produces equivalent results when eval kernels match — Phase 3 verifies the equivalence rather than rewriting the orchestration.
- **2026-05-01** — Phase 0 oracle binary chosen: `Live2DCubismCore.dll` (Cubism Core 5.0.0) shipped with Ren'Py SDK at `D:\renpy-8.5.0-sdk\lib\py3-windows-x86_64\Live2DCubismCore.dll`. All 39 `csm*` C exports verified at runtime. Plain C ABI — Python ctypes binds cleanly, no FFI/koffi/npm-install dependency added. Override via `LIVE2D_CUBISM_CORE` env var if user has the public Cubism Native SDK installed elsewhere.
- **2026-05-01** — Phase 0 sanity check passed: both `New Folder_cubism\shelby.moc3` (Cubism Editor's own runtime export) AND `New Folder\shelby.moc3` (our v3 exporter's output) load without errors in the oracle and produce non-zero per-vertex deltas across the diagnostic param table. Confirms our exporter is at byte-parity at the load level (no MOC-validity divergence) — Phase 1's diff numbers will isolate eval-kernel divergence cleanly.
- **2026-05-01** — Phase 1 port shipped: `src/io/live2d/runtime/evaluator/cubismWarpEval.js` is the byte-faithful transcription of `WarpDeformer_TransformTarget`. INSIDE branch implements triangle-split bilinear (default) + 4-point bilinear (when `isQuadTransform=true`); OUTSIDE branch implements the lazy-init 6-value edge-gradient cache + 9-region dispatch (1 far-field, 4 boundary bands, 4 corner zones). Wired into `chainEval.js` as the `state.kind === 'warp'` branch, replacing the BUG-006-era `bilinearFFD(inside ? grid : baseGrid)` cutoff. Smoke tests (29 cases on identity + deformed grids, INSIDE/OUTSIDE) all pass; full rig-eval regression suite (chainEval/warpEval/rotationEval/artMeshEval/cellSelect/initRig/bodyWarp/faceParallax/rigWarps/etc., 13 files, 754 cases) still green.
- **2026-05-01** — Phase 1 known-gap: oracle-diff validation against shelby is blocked on a programmatic rigSpec build path. The current rigSpec is built transiently in the React store via the wizard UI; running it from Node requires either (a) a CLI-driven wizard runner (not built yet) or (b) saving rigSpec to disk from the running app and reloading. The `oracle-diff` test is scaffolded conceptually but not implemented — when the rigSpec-from-disk path lands (could come naturally with the Save/Load polish in `project_v3_save_load_gap.md`), the snapshot diff at `scripts/cubism_oracle/snapshots/shelby_v3export/` becomes the canonical numeric pass criterion. Until then, the port verification is: smoke unit tests + visual scrub in the dev server.
