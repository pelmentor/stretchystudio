# Init Rig — Authored cmo3 Path

**Status:** queued for implementation. Authored 2026-05-03 by user request after the Phase 2b investigation.

**Origin (user 2026-05-03):**
> Надо эту большую фичу сделать без костылей и не бойся ломать вещи, проект всё еще в стадии эмбриона.

## What's broken

[`initializeRigFromProject`](../src/io/live2d/rig/initRig.js) ALWAYS runs the heuristic init rig — it builds the body warp chain, FaceParallax, FaceRotation pivot, Group rotations, and per-part rig warps from PSD-style data (face mesh bbox, topwear position, etc.).

This is correct for the **PSD wizard path** (where there is no rig data, only meshes) but **wrong for the cmo3 import path** (where the authored rig is already in the cmo3 file). Two consequences:

1. **Oracle harness shows ~9.45 px PARAM divergence on AngleZ_pos30** that `verify_pivot_fix.mjs` traced to v3's heuristic FaceParallaxWarp ≠ Cubism's authored FaceParallaxWarp. It's not a chainEval bug — it's a rig-data-source mismatch.
2. **cmo3 round-trip is lossy.** Import a cmo3 → init rig → re-export → the re-exported file uses v3's heuristic rig, NOT what was authored. Subtle author-set values (FaceRotation pivot, body warp control points, custom rotation angles) are lost.

Per memory `project_ss_is_embryo.md`: "SS is an embryo, not a mature tool — Live2D-inspired skeleton; no native data models for params/deformers/keyforms/physics yet, only transient export-time structures." The init rig was always heuristic-only because that matched the PSD-wizard origin story. cmo3 import added the *data* but not the *consumer*.

## What we want

A second path in `initializeRigFromProject` that uses authored cmo3 data when present. The two paths in summary:

| Path        | Trigger                  | Source of body warp chain | Source of FaceRotation pivot | Source of per-part warps |
|-------------|--------------------------|---------------------------|------------------------------|---------------------------|
| HEURISTIC   | PSD wizard import        | Synthesized from face/topwear bbox | `cmo3writer.js:851` heuristic | Synthesized per-part |
| **AUTHORED**| cmo3 import (NEW)        | From cmo3 warp deformers  | From cmo3 rotation deformers | From cmo3 (already mostly works for leaf rigWarps) |

## Goals

1. **Primary:** `oracle harness` PARAM divergence drops from 9.45 px (AngleZ_pos30) to **< 1.0 px** without touching chainEval. The drop comes from using authored body chain + FaceRotation pivot directly.
2. **Secondary:** cmo3 round-trip is lossless for the rig graph. Import → no-op edits → export produces a cmo3 byte-equivalent to the input (modulo our intentional v3 changes — see [`UPSTREAM_PARITY_AUDIT.md`](UPSTREAM_PARITY_AUDIT.md)).
3. PSD wizard path (HEURISTIC) **unchanged**.
4. No feature flag, no dual code paths in production. The two paths exist because the input shapes differ; both ship.

## Non-goals

- Restoring upstream-byte-equivalence of writer output. That's the parity audit (separate doc).
- "Smart merge" of authored + heuristic data. Authored OR heuristic. Pure paths.
- New UI for editing imported rigs. The user can edit through existing UI; the imported rig is just the starting state.

## Strategy

The cmo3Import already extracts everything we need. Today it builds `project.nodes`, `project.parameters`, etc., and stashes a few values on group `transform.pivot` (broken for parent=rotation, see Stage 1 finding). It does NOT produce a rigSpec.

The new code:
1. **`cmo3Import` produces an `authoredRigSeed`** — a serializable structure containing all the warp deformers, rotation deformers, keyform bindings, and per-part rig warp references.
2. **`initializeRigFromProject` checks for `authoredRigSeed`** on the project. If present, route to the new `buildRigSpecFromAuthored` (instead of the heuristic `generateCmo3` call). If absent, current heuristic behavior.
3. **`buildRigSpecFromAuthored`** converts the seed into a v3 RigSpec. Frame conversions, reparenting, parameter binding.

This is "build a parallel pipeline for the import-from-cmo3 case" — not a hack on top of the heuristic.

## Stages

### Stage 0 — Decide: hard cutover or transitional? (no code, ½ hour)

User said *"не бойся ломать вещи"* (don't fear breaking things) and *"проект всё ещё в стадии эмбриона"* (project is in embryo stage). So **hard cutover**:

- cmo3 imports ALWAYS use the AUTHORED path.
- HEURISTIC path stays only for PSD wizard.
- No flag.
- Existing v3 projects: nothing migrates automatically. If the user re-imports a cmo3, they get the new path.
- Tests that depend on heuristic behavior on cmo3-imported projects get rebaselined or scoped to PSD-wizard projects.

### Stage 1 — Define `authoredRigSeed` shape (½ day)

`authoredRigSeed` is a denormalized snapshot of the cmo3's rig graph in canvas-px units, ready to be turned into a RigSpec. Live on `project.authoredRigSeed`.

```ts
interface AuthoredRigSeed {
  /** Source canvas dims at the time of import. */
  canvasW: number;
  canvasH: number;

  /** All warp deformers, in topological order (parents before children). */
  warps: Array<{
    idStr: string;                              // CDeformerId.idstr (e.g. 'BodyXWarp')
    parent: { kind: 'root'|'warp'|'rotation', idStr?: string };
    cols: number;
    rows: number;
    isQuadTransform: boolean;
    /** Top-level base positions, in canvas-px (LIFTED through ancestor warps). */
    basePositionsCanvas: Float32Array;
    /** Per-keyform positions in PARENT's input frame (NOT lifted). */
    keyforms: Array<{
      paramAccess: Array<{ paramId: string, key: number }>; // resolved access key
      positions: Float32Array;
    }>;
  }>;

  /** All rotation deformers, in topological order. */
  rotations: Array<{
    idStr: string;
    parent: { kind: 'root'|'warp'|'rotation', idStr?: string };
    /** Authored origin in PARENT's input frame (raw cmo3 value). */
    keyforms: Array<{
      paramAccess: Array<{ paramId: string, key: number }>;
      angle: number;
      originX: number;     // parent-frame raw value (semantics depend on parent.kind)
      originY: number;
      scale: number;
    }>;
    /** Computed canvas-px pivot AT REST. Convenience field; recomputable from keyforms. */
    restCanvasPivot: { x: number, y: number };
  }>;

  /** Per-part rig warp ids — which warp owns each part (already tracked in cmo3Import today). */
  rigWarpsByPartId: Map<string, string>;  // partId → warp idStr

  /** Param-to-deformer-keyform binding map. */
  bindings: Array<{
    deformerIdStr: string;
    paramId: string;
    keys: number[];
    interpolation: string;
  }>;
}
```

Why this shape:
- Topological order means downstream consumers don't need to re-sort.
- Storing `basePositionsCanvas` (lifted) avoids re-running lifted-grid composition every time we want a warp's canvas-px bbox.
- `restCanvasPivot` is computed once at seed time so consumers don't redo chain composition.
- Keyforms keep their parent-frame origin so the writer can emit them back in the correct frame (round-trip).

### Stage 2 — Populate `authoredRigSeed` in cmo3Import (1 day)

Add a new module: [`src/io/live2d/cmo3Import/authoredRigSeed.js`](../src/io/live2d/cmo3Import/authoredRigSeed.js).

Function: `buildAuthoredRigSeed(scene, canvasW, canvasH) → AuthoredRigSeed`. Steps:

1. Topologically sort deformers (warps + rotations).
2. For each warp: compute lifted `basePositionsCanvas` by walking up the parent chain composing through ancestor warp grids. Reuse `evalWarpKernelCubism` from `cubismWarpEval.js` for the bilerp.
3. For each rotation: walk parents to compute `restCanvasPivot`:
   - parent=root: pivot = (originX·canvasW, originY·canvasH)? Actually need to verify what "root-parented" means in upstream. For shelby no rotation has root as parent.
   - parent=warp: pivot = `bilerp(parent.basePositionsCanvas, originX, originY)` — interpret originX/Y as 0..1 of parent warp's input frame.
   - parent=rotation: pivot = parent.restCanvasPivot + R(parent.restAngle) · (originX, originY).
4. For each keyform binding: resolve parameterGuidRef to paramId via the parameter table.
5. Return the seed.

**Verification gate:** unit test on shelby — for FaceRotation, `restCanvasPivot` should be ~(901.5, 385.7) (the value matched by my `probe_pivot_offset.mjs` measurement to within ~0.2 px).

### Stage 3 — Surface seed on project (¼ day)

In [`src/io/live2d/cmo3Import.js`](../src/io/live2d/cmo3Import.js), after `applyRotationDeformersToGroups`:

```js
import { buildAuthoredRigSeed } from './cmo3Import/authoredRigSeed.js';
// ...
project.authoredRigSeed = buildAuthoredRigSeed(scene, canvasW, canvasH);
```

Also: now that we have the seed, we can **delete the broken parent=rotation skip** in `applyRotationDeformersToGroups:130` — the seed handles those properly. But that group-transform stash might be used elsewhere; check before removing. (If it's only used as a downstream rendering hint, can simplify; if other code paths depend on it, leave it.)

**Verification gate:** existing cmo3 import tests stay green. Project loaded from shelby.cmo3 has `project.authoredRigSeed.rotations.find(r => r.idStr === 'FaceRotation').restCanvasPivot ≈ (901.5, 385.7)`.

### Stage 4 — `buildRigSpecFromAuthored` (1.5 days)

New module: [`src/io/live2d/rig/buildRigSpecFromAuthored.js`](../src/io/live2d/rig/buildRigSpecFromAuthored.js).

Function: `buildRigSpecFromAuthored(seed, project) → RigSpec`. Builds a RigSpec compatible with chainEval / cmo3writer / moc3writer.

Implementation:
- For each warp in seed: produce a `WarpDeformerSpec` with the right `parent`, `gridSize`, `keyforms`, `bindings`.
- For each rotation: produce a `RotationDeformerSpec`. Frame-convert origins to v3's RigSpec convention (which is the cmo3 frame already, so this is mostly identity — but verify against tests).
- artMeshes: use existing `buildMeshesForRig` output (mesh tessellation is per-part, not rig-graph-dependent).
- canvasToInnermostX/Y: derived from the body warp chain's bottom-most warp (BodyXWarp for shelby).

**v3-specific deformers** that aren't in the authored cmo3 (FaceParallaxWarp, etc.): synthesized as today, but ONLY when the wizard or user explicitly enables them. For cmo3 import path, by default we DO NOT synthesize these — the authored rig is what we use. If the user later wants a FaceParallaxWarp, that's a separate "add deformer" UI action.

This is one of the "embryo project" calls: cmo3 imports lose access to v3-only features by default. PSD wizard imports get the full v3 feature set. Document the tradeoff.

**Verification gate:** test fixture `test:authoredRigBuilder` covers shelby + a synthetic minimal cmo3. Outputs match expected RigSpec shape; bindings + parents resolve correctly.

### Stage 5 — Wire into `initializeRigFromProject` (½ day)

In [`src/io/live2d/rig/initRig.js`](../src/io/live2d/rig/initRig.js):

```js
export async function initializeRigFromProject(project, images = new Map()) {
  if (project.authoredRigSeed) {
    return initializeRigFromAuthored(project, images);
  }
  return initializeRigFromHeuristic(project, images);  // current code, renamed
}
```

`initializeRigFromAuthored` calls `buildRigSpecFromAuthored` and harvests as today.

**Verification gate:** running the oracle harness on shelby with the new path produces `AngleZ_pos30` PARAM divergence below 1.0 px. (Currently 9.45 px.)

### Stage 6 — Test rebaselines (½ day)

Tests that depend on the heuristic-init-rig output for cmo3-imported projects need to be re-baselined or scoped:

- `test:rigInit`: split into `test:rigInit-heuristic` (PSD wizard fixtures) and `test:rigInit-authored` (cmo3 import fixtures).
- `test:e2e_equivalence`: this exists for round-trip; should now be tighter on cmo3 imports.
- `test:chainEval`: unaffected (kernel logic).
- Oracle harness: should improve, not regress.

**Verification gate:** `npm test` green, oracle harness shows AngleZ_pos30 PARAM dropped, no test silently masking a regression.

### Stage 7 — Documentation + memory (¼ day)

- Update memory `project_native_rig_refactor_plan.md` with this rewrite as a follow-up.
- Update `BUGS.md` BUG-003 → Fixed (with the actual fix being the authored-seed path).
- Update `PHASE_2B_PLAN.md` — close out with Stage 1 findings + this fix as the resolution.
- Update `project_cubism_warp_port.md` memory.
- New memory entry: `project_authored_rig_path_shipped.md`.

## Cost estimate

| Stage | Days | Verification gate |
|-------|------|-------------------|
| 0 — decision | 0   | Hard cutover decided |
| 1 — seed shape | 0.5 | Type defined, reviewed |
| 2 — populate seed | 1.0 | Unit test on shelby restCanvasPivot ≈ (901.5, 385.7) |
| 3 — surface on project | 0.25 | Existing cmo3 tests stay green |
| 4 — buildRigSpecFromAuthored | 1.5 | New unit test passes |
| 5 — wire into initRig | 0.5 | Oracle PARAM < 1.0 px on AngleZ_pos30 |
| 6 — rebaseline tests | 0.5 | npm test green |
| 7 — docs | 0.25 | Memory + BUGS.md + PHASE_2B_PLAN.md done |
| **Total** | **4.5 days** | Multi-day, bounded |

## Risk register

| Risk | Mitigation |
|------|-----------|
| Authored rig + v3-only features (FaceParallax, etc.) interact badly. | Cmo3 import path skips v3-only synthesis by default. Add later via explicit user action. Document tradeoff. |
| Oracle PARAM doesn't drop below 1.0 px even with authored path. | Re-investigate. Could be that we still have a chainEval gap, OR the seed has a frame-conversion bug. The harness gives ground truth either way. |
| Existing v3 projects (saved with heuristic-built rig) load differently. | Saved projects have their rig serialized; re-running init rig only happens on explicit user action. So no auto-migration. New imports use new path. |
| `buildRigSpecFromAuthored` becomes complex. | Keep it strictly mechanical (seed → RigSpec). All synthesis lives in the heuristic path. |
| Round-trip exposes writer bugs. | That's the purpose of `UPSTREAM_PARITY_AUDIT.md` (separate). Run it after this lands. |
| Tests rebaseline masks real regressions. | Stage 6's gate: every rebaselined value must be cross-checked against oracle, not just diff'd against the new output. |

## Migration strategy

User said don't fear breaking. So:

- **Existing v3 projects with heuristic-built rigs:** unchanged on disk; load as-is. No auto-migration. If the user wants the authored-path benefits, they re-import the cmo3.
- **New cmo3 imports:** use authored path automatically.
- **PSD wizard imports:** unchanged; use heuristic path.
- **Editor users mid-project (loaded from cmo3):** the project they're working on already has the heuristic rig stored. Saving + reloading doesn't re-init. To get the new rig, they'd need to re-import the cmo3 (and lose any project-level customisations, which is the documented tradeoff).

Alternative: add a "Re-init from authored cmo3" UI button. Out of scope for this rewrite.

## Open questions for user before implementation

1. **FaceParallax warp:** v3 adds it (not in upstream). For cmo3 imports of shelby (no authored FaceParallax), should the new path:
   - (a) Skip FaceParallax entirely → matches Cubism's exact rig.
   - (b) Synthesize FaceParallax additionally → keeps v3's "improved" face animation behavior.
   My read: **(a)** for byte parity / oracle correctness; user can opt-in to (b) later. But if the v3 user experience depends on FaceParallax for face animation richness, (b) is the right default.
2. **Body warp Y-extension:** v3 extends BodyWarp Y past upstream (per memory). Same question as above. Inclined toward (a) — match authored.
3. **Idle motion / breath synthesis:** these are LIVE drivers (mutate paramValues at runtime), not deformer additions. Stay regardless of path.

If user doesn't answer: default (a) for cmo3 import path. PSD wizard keeps full v3 feature set.

## Anti-pattern checklist

- ❌ "Hybrid" rig (mix of authored + heuristic). Pick one source per import path. Mixing causes the kind of inconsistency the v0.2 harness `--authored-rig` flag had ("mixed authored/heuristic produces inconsistent rig that doesn't match Cubism's eval — full divergence on the order of 100k px").
- ❌ Feature flag for the new path. Hard cutover.
- ❌ Patching individual rigSpec values post-init (the verify_pivot_fix.mjs disproof showed why this doesn't work).
- ❌ Touching chainEval to compensate for rig-data mismatches. Stage 1 already showed chainEval is correct; the bug is upstream of it.
