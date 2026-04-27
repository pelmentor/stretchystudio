# Native Rig Refactor — Plan

## Status

Living tracker. Update on every stage transition.

| Stage | Description | Status |
| --- | --- | --- |
| 0 | Diff harness foundation (canonicalizer + structural diff) | **shipped** — `scripts/native-rig-diff/`, 34 unit tests, `npm run test:diff-harness` |
| 0.5 | Schema versioning + migration scaffold | **shipped** — `src/store/projectMigrations.js`, 25 unit tests, `npm run test:migrations` |
| 1a | Parameters — native rig fork + seeder + equivalence tests | **shipped** — `paramSpec.js` fork, `seedParameters()`, `useProjectStore.seedParameters` action, 21 tests, `npm run test:paramSpec`. UI deferred to 1b. |
| 1b | Parameters UI panel + delete protection | **shipped (v1)** — `src/components/parameters/ParametersPanel.jsx` slotted in `EditorLayout.jsx`. Collapsible read-only list of `project.parameters` with `name [min, max] · default`. Three-cell baked-vs-inline status row (face / body / per-mesh). "Initialize Rig" button (`Wand2`) calls `initializeRigFromProject` → `seedAllRig`; "Clear" (`Trash2`) calls `clearRigKeyforms`. Both confirm via `AlertDialog` when seed exists. `seedAllRig(harvest)` orchestrator in `projectStore.js` does single-snapshot fan-out across all 9 seeders + 3 clearXxx. `loadProject` / `resetProject` bug-fix: `autoRigConfig` / `faceParallax` / `bodyWarp` / `rigWarps` were silently dropped on `.stretch` reload — restored. `harvestSeedFromRigSpec` (pure filter) extracted from `initRig.js` for unit testing. 35 tests, `npm run test:initRig`. v1 deferred: param-group UI (LipSync/EyeBlink palette ordering), per-param min/max/default editing, delete protection on 22 standard IDs with track-reference display. |
| 2 | autoRigConfig (seeder tuning surface) | **shipped** — `src/io/live2d/rig/autoRigConfig.js` (`DEFAULT_AUTO_RIG_CONFIG` bundles `bodyWarp` + `faceParallax` + `neckWarp` sections). Schema v7. Per-section fallback (each section validates independently — malformed bodyWarp leaves user faceParallax intact). bodyWarp.js / cmo3/faceParallax.js / rig/warpDeformers.js all read tunables from input args with `DEFAULT_AUTO_RIG_CONFIG.<section>` fallback; cmo3writer + bodyRig thread the resolved config through. Lifts: HIP/FEET fracs + canvas pad + BX/BY/Breath margins + upper-body shape + FP depth/angle/protection coefficients + protectionPerTag map + superGroups + eye/squash amps + NECK_TILT_FRAC. Defaults match existing literals bit-for-bit. 83 tests, `npm run test:autoRigConfig`. |
| 3 | Mask configs | **shipped** — `src/io/live2d/rig/maskConfigs.js` (`CLIP_RULES` + `seedMaskConfigs` + `resolveMaskConfigs`), schema bumped to v2 with migration, both writers fork on `maskConfigs` arg, 25 tests, `npm run test:maskConfigs`. |
| 4 | Face parallax | **shipped** — `src/io/live2d/rig/faceParallaxBuilder.js` (`buildFaceParallaxSpec`, ~520 LOC of compute extracted from `cmo3/faceParallax.js`) + `src/io/live2d/rig/faceParallaxStore.js` (`serializeFaceParallaxSpec` / `deserializeFaceParallaxSpec` / `resolveFaceParallax` / `seedFaceParallax` / `clearFaceParallax`). Schema v8. `emitFaceParallax` accepts `preComputedSpec` ctx arg — populated → serialize stored spec verbatim; null → run `buildFaceParallaxSpec` heuristic. cmo3writer + exporter thread `faceParallaxSpec` resolved from project. Float64Array fields serialize via plain-array storage (`baseGrid`, `keyforms[i].positions`). Stage 4 v1 ships **without** signatureHash staleness detection — re-import-after-seed is a documented footgun. 154 tests, `npm run test:faceParallax`. |
| 5 | Variant fade rules + eye closure config | **shipped** — `src/io/live2d/rig/variantFadeRules.js` (`DEFAULT_BACKDROP_TAGS` + `seedVariantFadeRules` + `resolveVariantFadeRules`) and `src/io/live2d/rig/eyeClosureConfig.js` (`DEFAULT_EYE_CLOSURE_TAGS` + `DEFAULT_LASH_STRIP_FRAC` + `DEFAULT_BIN_COUNT` + `seedEyeClosureConfig` + `resolveEyeClosureConfig`). Schema v5. Both writers fork on the resolved configs (cmo3 reads both, moc3 reads variantFadeRules — eye closure keyforms come from rigSpec.eyeClosure built in cmo3). 52 tests, `npm run test:variantFadeRules` + `npm run test:eyeClosureConfig`. |
| 6 | Physics rules | **shipped** — `src/io/live2d/rig/physicsConfig.js` (`DEFAULT_PHYSICS_RULES` + `seedPhysicsRules` + `resolvePhysicsRules`). Schema v3. Both `cmo3/physics.js` and `physics3json.js` refactored to consume pre-resolved rules (boneOutputs flattened at seed time). 83 tests, `npm run test:physicsConfig`. |
| 7 | Bone config | **shipped** — `src/io/live2d/rig/boneConfig.js` (`bakedKeyformAngles` per project, default `[-90,-45,0,45,90]`). Schema v4. paramSpec / cmo3writer / moc3writer all consume via `bakedKeyformAngles` arg. Eliminates the duplicated literal in moc3writer. 18 tests. |
| 8 | Rotation deformers (config) | **shipped** — `src/io/live2d/rig/rotationDeformerConfig.js` (`DEFAULT_ROTATION_DEFORMER_CONFIG` bundles `skipRotationRoles` + `paramAngleRange` + `groupRotation`/`faceRotation` paramKey→angle mappings). Schema v6. cmo3writer keyform emission generalised from 3-keyform to N-keyform; paramSpec consumes skipRoles + range; bodyRig threads faceRotation paramKeys/angles. Pivots stay computed live (no snapshot). 49 tests, `npm run test:rotationDeformerConfig`. |
| 9a | Tag warp bindings — module + magnitude lift | **shipped** — `src/io/live2d/rig/tagWarpBindings.js` (`buildTagWarpBindingRules(magnitudes)` + `buildTagBindingMap(paramPids, magnitudes)`). The 290-LOC inline `TAG_PARAM_BINDINGS` Map in `cmo3writer.js` (front hair, back hair, bottomwear, topwear, legwear, eyebrow×3, irides×3, eyewhite×3, eyelash, mouth — 16 tags total) extracted into a pure module. Magnitudes (~13 numeric constants — hair sway, clothing sway, brow Y, iris gaze, eye-converge frac, mouth stretch) lifted into `autoRigConfig.tagWarpMagnitudes`; per-character override now requires no code edits. Defaults bit-for-bit identical to pre-9a literals (verified by inline-reference tests). 182 tests in `scripts/test_tagWarpBindings.mjs`, 26 new in `test_autoRigConfig.mjs`. **No keyform baking yet** — keyforms still computed at export time; that's Stage 9b. |
| 9b | Tag warp bindings — per-mesh keyform baking | **shipped (v1)** — `src/io/live2d/rig/rigWarpsStore.js` (`serializeRigWarps` / `deserializeRigWarps` / `resolveRigWarps` / `seedRigWarps` / `clearRigWarps`). Schema v10. `project.rigWarps` is a `{[partId]: storedSpec}` map (Float64Array baseGrid + per-keyform positions → number[]). cmo3writer accepts `rigWarps` ctx arg as a `Map<partId, spec>`; per-mesh emission loop validates stored spec shape (numKf + per-keyform position length) and replaces the procedural `shiftFn` invocation with stored positions when valid. Misses fall through to inline path — preserves today's heuristic for unseeded meshes. exporter threads `resolveRigWarps(project)` through both `generateCmo3` calls. **No bake-flow yet** — the seeder action exists but no UI calls it; v1 ships the read-side. v1 staleness footgun (PSD reimport requires `clearRigWarps`) — same as Stages 4 + 10. 104 tests, `npm run test:rigWarps`, +3 v10 migration tests. |
| 10 | Body warp chain (keyforms) | **shipped (v1)** — `src/io/live2d/rig/bodyWarpStore.js` (`serializeBodyWarpChain` / `deserializeBodyWarpChain` / `resolveBodyWarp` / `seedBodyWarpChain` / `clearBodyWarp`) + `makeBodyWarpNormalizers(layout)` exported from `bodyWarp.js` so the deserializer rebuilds `canvasToBodyXX/Y` closures from the stored layout. Schema v9. cmo3writer accepts `bodyWarpChain` ctx arg — populated → use stored chain verbatim; null → run `buildBodyWarpChain` heuristic. exporter threads `resolveBodyWarp(project)` through both `generateCmo3` calls. Float64Array → number[] for baseGrid + per-keyform positions; closures rebuilt at deserialize time from the layout block. 3- vs 4-spec chains both round-trip (no-BX legacy support). v1 ships **without** signatureHash staleness detection — PSD reimport with re-meshed body silhouette silently produces stale exports. 131 tests, `npm run test:bodyWarp`. |
| 11 | Final cleanup (remove generator branches) | **shipped 2026-04-27** — `exporter.js` `resolveAllKeyformSpecs(project, images)` helper at top of both `exportLive2D` and `exportLive2DProject`: respects explicit seeding, falls back to one-shot `initializeRigFromProject` harvest when state is fully empty (in-memory only — does NOT mutate project). Partial seeding respected. `cmo3writer.js` keeps `?? heuristic` branches as safety net for the seeder's `rigOnly` mode but emits `console.warn` when fallback fires outside `rigOnly` — visible regression detector. `rigOnly` mode preserved (still used by `initRig`); plan-bullet 2 ("garbage-collect rigOnly if no longer used") doesn't apply. `RUNTIME_PARITY_PLAN.md` updated with "Native rig path is now canonical" subsection. All 1092 tests green, 0 new lint errors, build green. |

**v1 → v2 transition.** v1 (data layer) shipped 2026-04-27 with all 15
stages (0/0.5/1a/1b/2/3/4/5/6/7/8/9a/9b/10/11) at schema v10. v2 plan
authored 2026-04-28 — see [v2 — Native Render Pipeline](#v2--native-render-pipeline)
section below. v1 edit-UI gap acknowledged (read-only ParametersPanel +
0 of 11 seeded subsystems have edit UI); deferred to "build under v2
demand" rather than speculatively.

| v2 Stage | Description | Status |
| --- | --- | --- |
| R0 | Plumbing smoke test (paramValues store + dirty-tag + minimal slider) | **shipped 2026-04-28** |
| R1 | RigSpec session cache (`useRigSpecStore`) | **shipped 2026-04-28** |
| R2 | `cellSelect` — N-binding cross-product cell + lerp weights | **shipped 2026-04-28** |
| R3 | `warpEval` — bilinear FFD + `frameConvert` | **shipped 2026-04-28** |
| R4 | `rotationEval` — angle/origin/scale interp + mat3 | **shipped 2026-04-28** |
| R5 | `artMeshEval` — keyform interp (verts + opacity + drawOrder) | **shipped 2026-04-28** |
| R6 | Chain composition + first visible demo | not started |
| R7 | Mask system generalization (stencil) | not started |
| R8 | Full param scrubber UI | not started |
| R9 | Physics tick (Cubism pendulum) | not started |
| R10 | Performance hardening | not started |

Cross-ref: see [`RUNTIME_PARITY_PLAN.md`](RUNTIME_PARITY_PLAN.md) — that
work shipped the `rigSpec` contract this refactor leans on.

## Goal

Today, SS does not have a native data model for parameters, warp deformers,
rotation deformers, keyform bindings, or physics rules. They exist only as
**transient structures inside the export pipeline**, computed from PSD tags
and heuristics at export time. The closest thing to a native field is
`project.parameters[]`, which is in the schema but unused.

The goal of this refactor is to **build those constructs as first-class
entities inside SS** (Live2D-inspired data models), seed them from the
existing auto-rig, then flip the exporter from a **generator** into a
**serializer** that reads pre-computed rig state from the `.stretch` file
and emits it almost verbatim to `.cmo3` / `.moc3` / `physics3.json`.

Auto-rig stays in the codebase but changes role: instead of running on every
export, it runs **once per project** as a "Initialize Rig" action that
populates the new project state. From that point forward the user owns the
rig data, can edit it in SS, and the export is deterministic.

### Architectural anchor: `rigSpec` is the contract

The export pipeline today already has a clean intermediate object —
[`rigSpec`](../../src/io/live2d/rig/rigSpec.js) — that the generator
populates and the writers (`cmo3writer`, `moc3writer`, `physics3json`)
consume. **`rigSpec` is not changing.** What changes is *who fills it*:

* Today: a heuristic generator inspects PSD tags + mesh anatomy and writes
  rigSpec inline.
* After migration: an *adapter* reads the project's native rig fields and
  writes rigSpec from them, 1:1 mapping. Writers stay byte-for-byte
  identical.

This is why the refactor is incremental and safe: each subsystem migrates
its input source (heuristics → project state) without touching the
downstream writer code.

### Architectural decision: precompile procedural morphs into keyforms

The biggest hidden subsystem in today's generator is `TAG_PARAM_BINDINGS`
in [cmo3writer.js:2202-2491](../../src/io/live2d/cmo3writer.js#L2202) —
20+ tag entries each carrying a procedural `shiftFn(grid, paramValue, …)`
that morphs warp grids at export time. Serialising those closures
verbatim is impossible; serialising them as formula strings would require
a full DSL + interpreter.

Instead: the seeder **invokes `shiftFn` once and bakes the resulting
per-vertex deltas into stored keyforms.** After seeding, the procedural
function is gone — the project stores a flat array of vertex offsets per
keyform per parameter, exactly as Cubism stores keyforms in a `.cmo3`.

Trade-off: parametric tuning (e.g., "amplify hair X-sway by 1.5×") is no
longer a single-number edit — it requires a re-seed with a different
input constant, which destructively rewrites keyforms. This is acceptable
because (a) Cubism Editor itself works this way, (b) the tunable inputs
move to the `autoRigConfig` layer (see Stages), and (c) v2 would let users
edit vertex deltas directly anyway.

## What "native" means here — v1 (store) vs v2 (render natively)

Two scopes are possible. **v1 is the target of this plan.** v2 is mentioned
only so we don't accidentally design v1 in a way that blocks it.

* **v1 — store-only.** SS gains data models for parameters, warp deformers,
  rotation deformers, keyform bindings, and physics rules. The user can
  inspect and edit them through panels (lists, numeric fields, simple
  forms). The SS viewport **does not render their effect** — meshes still
  show in their static rest pose. WYSIWYG comes from re-exporting and
  reloading in Cubism Viewer (current workflow). What v1 *does* unlock:
  deterministic export, editable persisted state, per-character overrides
  without touching shared code, foundation for v2.
* **v2 — native render.** The SS runtime evaluates parameters, blends
  keyforms, drives warp/rotation deformers, runs physics — all live in the
  viewport. Equivalent in scope to building a Cubism-compatible runtime
  inside SS. Out of scope for this plan; revisit after v1 ships.

Design constraint for v1: the data models must be **schema-compatible with
v2** so we don't have to migrate the persisted format twice. Concretely:
keyforms store interpolation-ready data (parameter value + per-vertex
delta), not just final-export packed bytes; deformer hierarchy mirrors
Cubism's, so a future renderer can walk it directly.

## Why

Status quo problems (see [AUTO_RIG_PLAN.md](AUTO_RIG_PLAN.md) for
generator pain points):

* **No WYSIWYG.** Parameters, deformer keyforms, physics rules exist only
  inside the export pipeline. The user can't see them in SS, can't preview,
  can't edit. Tweaking means iterating PSD tags + re-export + reload in
  Cubism Viewer.
* **Heuristic regressions are silent.** Tag-matching rules in
  [physics.js](../../src/io/live2d/cmo3/physics.js) and
  [bodyWarp.js](../../src/io/live2d/rig/bodyWarp.js) fire or skip based on
  PSD layer names. A renamed layer can drop a whole physics setting with no
  diagnostic.
* **Per-character tuning lives nowhere.** When the user tweaks a magic
  constant for one character, it either gets baked into shared code or
  lost. There's no project-level override.
* **Auto-rig keeps growing magic constants.** Each new character style (`girl.psd`,
  `waifu.psd`, `shelby`, etc.) adds another conditional. Native state lets
  the user fix the one character without touching shared rules.

Post-refactor benefits:

* User edits → saved in `.stretch` → re-exported deterministically.
* Auto-rig is a seed, not a pipeline. It can be re-run intentionally.
* Deformer/physics/parameter editors become possible (out of scope for v1
  but unblocked).

## Non-goals

* **Not** building a full Cubism-Editor-clone in SS. v1 ships *storage* and
  *pass-through serialization*; rich editor UIs come later if at all.
* **Not** removing the auto-rig logic. It becomes the seeder.
* **Not** changing the `.cmo3` / `.moc3` / `physics3.json` output format.
  Cubism Editor + Viewer must keep loading our exports unchanged.
* **Not** migrating procedural motion presets (idle, listening, talking,
  embarrassed). Those stay algorithmic — see
  [project_idle_motion_generator.md](../../) memory note.
* **Not** migrating moc3 compile-time fields (rotation_deformer.scales,
  keyform_binding_begin_indices, per-mesh keyform plan). Those are derived
  during binary serialization — see
  `reference_moc3_compile_time_fields` memory note.
* **Not** importing `.cmo3` round-trip. If a user opens an exported
  `.cmo3` in Cubism Editor and edits keyforms there, those edits are
  **not** read back into SS. Re-exporting from SS overwrites them.
  Out of scope; user's mental model is "SS → cmo3" one-way.
* **Not** moving the seeder to a Worker thread. Schemas designed for
  worker-transferability (plain JSON, no closures) so it's possible
  later, but v1 keeps the seeder synchronous on the main thread.

## Export flow — today, hybrid, and target

Three concrete flows. The differences are entirely in *what fills
`rigSpec`*; the writers and output files are identical across all three.

### Today (full generator path)

```
.stretch (no rig fields)
   │
   ▼
exportLive2D()
   │
   ├─→ buildParameterSpec()       [generator: 22 standard + variant + bone]
   │     └─ inspects nodes + PSD tags + heuristics
   │
   └─→ generateCmo3(rigOnly=true) [generator: warps + rotations + keyforms]
         └─ inspects nodes + PSD tags + TAG_PARAM_BINDINGS.shiftFn(...)
   │
   ▼
rigSpec  (parameters, deformers, keyforms, etc.)
   │
   ├─→ cmo3writer  ─→ .cmo3
   ├─→ moc3writer  ─→ .moc3
   ├─→ physics3json ─→ physics3.json
   └─→ model3+cdi3+motion3 builders ─→ .json files
```

Rig data is computed fresh on every export. Nothing about the rig is
persisted in `.stretch`.

### Hybrid (mid-migration, per-subsystem fork)

```
.stretch (some rig fields populated, others empty)
   │
   ▼
exportLive2D()
   │
   ├─→ project.parameters?       → adapter ─→ rigSpec.parameters
   │     │ no                     ↗
   │     └─→ generator (heuristics)
   │
   ├─→ project.faceParallax?     → adapter ─→ rigSpec.faceParallax deformer
   │     │ no                     ↗
   │     └─→ generator (heuristics)
   │
   ├─→ project.rotationDeformers?→ adapter ─→ rigSpec.rotationDeformers
   │     │ no                     ↗
   │     └─→ generator (heuristics)
   │
   ... per subsystem ...
   │
   ▼
rigSpec  (assembled from mixed sources)
   │
   ▼ (writers unchanged)
output files
```

Same `rigSpec` shape regardless of source. Writers don't know or care
which subsystems came from native state vs. heuristics.

### Target (full native path)

```
.stretch (all rig fields populated)
   │
   ▼
exportLive2D()
   │
   └─→ projectToRigSpec(project)  [pure adapter, 1:1]
   │
   ▼
rigSpec
   │
   ▼ (writers unchanged)
output files
```

Generator code is no longer reachable from the export path. It survives
only as the seeder (next section).

### Seeder flow — orthogonal to export

```
User clicks "Initialize Rig" (or specific subsystem re-seed)
   │
   ▼
auto-rig generator
   │  (inspects PSD tags, mesh anatomy, autoRigConfig constants;
   │   invokes shiftFn for each tag, bakes result into keyforms)
   │
   ▼
project.parameters / .warpDeformers / .physicsRules / ...   ← persisted
   │
   ▼
.stretch save
```

The seeder writes to project state. Re-running the seeder is destructive
to user edits in the affected subsystems (see Seeder semantics below).

## Coexistence model — how the project lives mid-migration

Each migrated subsystem lives behind one rule, applied at the entry to the
adapter:

> If `project.<subsystemField>` is **populated**, the adapter builds the
> corresponding chunk of `rigSpec` from it. If **empty / missing**, the
> heuristic generator runs and fills `rigSpec` directly (today's path).

That gives:

* Existing `.stretch` files (no native rig data) keep exporting bit-for-bit
  identically through the generator path. **No user action required, no
  migration code on file load.**
* Newly-seeded projects get rich native state. Export bytes match the
  generator path when the seeder produces the same data — verified by the
  diff harness (Stage 0).
* Per-subsystem rollout. Stages land independently. Stage N being
  half-done doesn't block stages 1..N-1 from being green.

Concretely, the project schema grows new fields. **None of these data
models exist in SS today** beyond the dormant `project.parameters[]`
field — each stage designs the model first, then wires it:

```js
project.parameters[]        // already in schema, dormant
project.parameterGroups     // new — LipSync, EyeBlink, palette ordering
project.faceParallax        // new
project.rotationDeformers[] // new
project.bodyWarp            // new
project.tagWarpBindings[]   // new — keyforms for hair/clothes/etc warps
project.maskConfigs[]       // new — explicit clip mask pairings
project.physicsRules[]      // new — replaces hardcoded PHYSICS_RULES
project.eyeClosureConfig    // new — eye blink closure params
project.variantFadeRules    // new — backdrop tags + base-fade behaviour
project.boneConfig          // new — baked angle set, physics output bones
project.autoRigConfig       // new — tunable inputs to the seeder (magic
                            //         constants live here, not the seeder)
```

Each adapter entry point checks `if (project.foo) use it; else generate`.

### How the new constructs hook into existing SS entities

Even though the data models are new, they don't float free — they reference
the SS entities the user already sees:

| New construct | References existing SS entity |
| --- | --- |
| Parameter | nothing — top-level catalog |
| Warp deformer | parent group node, child meshes (by `nodeId`) |
| Rotation deformer | a group node (by `nodeId`) |
| Keyform binding | a parameter (by `id`) and a deformer/mesh |
| Physics rule | input parameters, output parameters (both by `id`) |
| Mask config | masked + masking meshes (by `nodeId`) |

This is the leverage of v1: existing SS entities (nodes, meshes, groups,
parameters) stay the user's primary mental model; rig data is metadata
attached to them, not a parallel universe. Editor UIs can be inspector
panels on selected nodes rather than a separate "rig editor" surface.

## Cross-cutting invariants

These constraints span multiple stages. Every stage must respect them; if
a stage can't, that stage's design is wrong.

### Schema versioning

`.stretch` files saved before any rig field exists must keep loading after
those fields exist. The plan's "if `project.foo` populated, else generate"
rule already handles *export* compatibility, but *load* compatibility
needs a versioned schema:

* Add `project.schemaVersion: number` (current = 1, implicit before
  Stage 0.5).
* Migration registry per version bump; `loadProject()` walks migrations
  from the file's version up to current.
* New rig fields default to undefined/empty when migrating from an older
  version. The export "if populated" gate then routes to the generator.

This is **Stage 0.5** — must ship before Stage 1 adds the first new
field. Without it, the first new schema field forces a hard-break load
path for older `.stretch` files.

### ID stability and invalidation

Once a subsystem is seeded, its data may reference SS entities by ID
(node ID, mesh ID, vertex *index*). Three failure modes to defend
against:

1. **Vertex index drift.** Warp keyforms store per-vertex deltas as
   arrays indexed by `mesh.vertices` position. PSD reimport that re-meshes
   a layer silently invalidates these deltas — same indices, different
   geometry. Defence: store a `signatureHash` per mesh
   (`hash(vertexCount, triCount, sortedUVHashes)`) at seed time, recompute
   on load, log a warning when divergent. Don't auto-clear (lossy); let
   the user re-seed.
2. **Parameter ID rename / delete.** Animation tracks
   ([`project.animations[].tracks[].propPath`](../../src/io/live2d/exporter.js))
   reference parameters by ID. Physics rules reference inputs/outputs by
   ID. Deleting a parameter breaks both silently. Defence: standard
   parameters (the 22 baked-in IDs) are protected — UI doesn't allow
   delete. Custom parameters (variant, bone-rotation) prompt with a list
   of references on delete; user confirms.
3. **Node ID stability.** SS already uses stable node IDs across PSD
   reimport (per
   [`projectStore.js`](../../src/store/projectStore.js)). The refactor
   must not weaken this — never store transient node references.

### Seeder freshness invariant

Seeded data is a snapshot of the SS state at seed time. Whenever the
input state changes (PSD reimport, mesh edit, tag change), the snapshot
may become stale. The system must:

* Track a `seederMeshSignatures` map per seeded subsystem.
* On load and on `applyRig`-equivalent operations, recompute mesh
  signatures and surface a warning when subsystems have stale data.
* Never silently re-run the seeder — it's destructive (see Seeder
  semantics). User triggers re-seed explicitly.

### Stable rig schema across Cubism format versions

Cubism occasionally bumps `fileFormatVersion` (see
`feedback_match_file_format_version` memory note). The native rig schema
must be **format-version agnostic**:

* Schema describes *intent* (a body warp chain with N layers, a physics
  rule with these inputs/outputs, etc.) not *output bytes*.
* Format-specific quirks (which fields go where in the moc3 binary, how
  XML attributes are spelled in cmo3) live in writers, not in the
  schema.
* When Cubism ships a new format version, only writers update — `.stretch`
  files don't migrate.

## What user can edit in v1 (honest scope)

Storing data natively does not automatically give a UI for editing it. v1
ships **a thin editor surface that matches the data shape**, no live
preview. Concretely:

| Subsystem | v1 edit affordance |
| --- | --- |
| Parameters | List + numeric fields (min/max/default, display name, group) |
| Parameter groups | Drag-to-reorder + group membership picker |
| Physics rules | Per-rule form (inputs, outputs, vertices) — same shape as `physics3.json` |
| Face parallax | Numeric form (depth, max angles, pivot override) |
| autoRigConfig | Numeric form (HIP_FRAC, FEET_FRAC, per-tag magnitudes, etc.) — re-seeds on apply |
| Mask configs | Mask-pair list with mesh pickers |
| Variant fade rules | Backdrop-tag list + per-suffix overrides |
| Eye closure config | Numeric form (lash strip, bin count, closed-eye Y) |
| Warp keyforms (vertex deltas) | **No editor UI in v1.** Read-only inspector at most. Tune via `autoRigConfig` + re-seed. |
| Rotation deformer keyforms (angles per param value) | List of `{paramValue, angle}` pairs |

The hard subsystem is warp keyforms (per-vertex deltas across N keyforms).
Authoring those without a viewport renderer is impractical — that's what
v2 unlocks. v1's answer is: warp keyforms are seeder output; you edit them
indirectly through `autoRigConfig` and re-seed.

## Seeder semantics (important behavioural contract)

The seeder is **destructive at the subsystem level**. It overwrites
whatever was in `project.<subsystem>` before. This applies to both the
top-level "Initialize Rig" (overwrites all rig fields) and per-subsystem
re-seeds ("Re-seed face parallax" overwrites only `project.faceParallax`).

Why destructive: subsystems like warp keyforms are the *output* of running
`shiftFn(autoRigConfig)`. There's no way to "merge" a re-seed with prior
edits because we threw away the procedural function. Re-seeding is the
only way to consume a changed `autoRigConfig`.

UI expectations:

* "Initialize Rig" prompts a confirmation when **any** rig field is
  populated. Mentions which subsystems have edits.
* Per-subsystem re-seeds prompt confirmation only for that subsystem.
* `autoRigConfig` edits do **not** automatically re-seed. The user
  changes constants, then explicitly clicks "Re-seed body warp" (or
  whichever subsystem). This keeps the destructive action explicit.
* `.stretch` autosave (if any) preserves rig edits — the seeder is only
  invoked by explicit user action, never on load.

## The diff harness — Stage 0, the safety net

Every subsequent stage is gated on this. Without it, "doesn't break the
build" is unverifiable.

### Determinism finding (resolved during Stage 0 audit)

A Stage 0 code audit found **the current export is not byte-deterministic**.
Two consecutive exports of the same `.stretch` differ at:

* [`xmlbuilder.js:11`](../../src/io/live2d/xmlbuilder.js#L11) —
  `crypto.randomUUID()` allocates a fresh GUID for every deformer / mesh
  / parameter on every export. ~hundreds of UUIDs per file.
* [`cmo3writer.js:124`](../../src/io/live2d/cmo3writer.js#L124) —
  `new Date().toISOString()` writes the export wall-clock into cmo3 metadata.
* [`idle/builder.js:344`](../../src/io/live2d/idle/builder.js#L344) —
  `Date.now()` in `__motion_<preset>_<ts>` motion IDs.

**Decision: don't make export deterministic. Canonicalize during diff.**

Reasons:

1. Cubism Editor compares some UUIDs *by value* (e.g.
   `e9fe6eff-953b-4ce2-be7c-4a7c3913686b` for ROOT_GROUP — see
   `project_random_pose_dialog_pending` memory). Replacing random UUIDs
   with content-hashed ones risks breaking these well-known checks.
2. The harness only needs **structural equivalence**, not byte equality.
   Canonicalization is a one-time tool; deterministic export would be a
   permanent constraint on every future writer change.

### What the harness does

For each reference model in the test set, runs the export twice and
compares **canonicalized** outputs. Canonicalization steps:

1. **UUID remap.** Walk each output (XML, JSON), collect all UUIDs in
   traversal order, build a remap table `original → uuid_NNNN`, substitute
   throughout. Two exports with identical structure produce identical
   canonical UUIDs (`uuid_0001`, `uuid_0002`, …) regardless of which
   random UUIDs `crypto.randomUUID()` actually generated.
2. **Timestamp blank.** Replace `<Timestamp>...</Timestamp>` and
   `__motion_<preset>_<ts>` patterns with fixed sentinels.
3. **Float canonicalization.** Format floats with fixed precision (e.g.
   12 decimals) before comparing — eliminates `0.1 + 0.2 ≠ 0.3` noise
   without losing meaningful precision differences.

After canonicalization, the harness diffs:

* JSON outputs (`model3.json`, `physics3.json`, `cdi3.json`,
  `motion3.json`) — structural deep-equal.
* `rigSpec` object before binary serialization — structural deep-equal,
  with float tolerance.
* `.cmo3` XML payload (after CAFF unpacking) — XML AST diff.

What it does NOT diff:

* `.moc3` binary. Map iteration ordering and float NaN/zero canonicalization
  make byte equality fragile even after canonicalization. Instead:
  **smoke test** — does the file load in Cubism Viewer without warnings?
* PNG atlases. Pixel-equivalence not load-bearing for the refactor.

### Two scenarios the harness must support

1. **Determinism scenario.** Export twice, same `.stretch`. Canonical
   diff must be empty. Establishes that UUIDs/timestamps are the only
   non-deterministic noise (no other surprises).
2. **Adapter-equivalence scenario.** Export with rig fields populated
   (adapter path) vs. unpopulated (generator path). Canonical diff must
   be empty. This is what gates each stage merge.

### Reference set

* **Primary in-repo asset:** `shelby_neutral_ok.psd` (only PSD checked
  into git). Use this as the reproducible baseline.
* **User-side canonical:** Hiyori-derived `.stretch` (per
  `feedback_reference_only_hiyori`). User has it locally; harness should
  accept it as a CLI/UI argument.
* **Canary later:** `waifu.psd` once available. Adds non-Hiyori
  divergence coverage.

### Implementation location

* `scripts/native-rig-diff/canonicalize.js` — pure-JS canonicalizer
  library (UUID remap, timestamp blank, float format). Node-runnable,
  no browser deps. Built first.
* `scripts/native-rig-diff/diff.js` — the actual diffing logic on top
  of canonicalize.js.
* Driver (the thing that *calls* `exportLive2D` twice) — deferred. The
  exporter is browser-coupled (`HTMLImageElement`, `JSZip`); a clean
  Node driver requires either headless-browser tooling or extracting the
  JSON-only generators. Decision deferred to Stage 1, when we first need
  the harness end-to-end.

### Stage 0 deliverables (concrete, narrow scope)

Stage 0 ships **infrastructure, not behaviour change**:

1. Canonicalizer library + unit tests.
2. Documented determinism finding (this section).
3. Tag `pre-native-rig-refactor` on current `master`.

The end-to-end diff driver is deferred — Stage 1 (parameters) will need
it, and we'll know more about driver requirements by then.

## Per-stage protocol

Every stage from 1 onward follows the same six steps. Treat deviation as a
red flag.

1. **Schema add.** Add the new field(s) to `projectStore.js` defaults +
   load/save round-trip. Existing projects load with the field empty.
2. **Generator → adapter split.** Refactor the relevant generator code so
   it produces a plain data structure shaped like the project schema, and
   add the *adapter* (project state → rigSpec chunk). Generator path now
   produces the same project-shaped data, then runs the adapter — proves
   the adapter is correct.
3. **Reader path (the fork).** Wire the "if `project.foo` populated, use
   adapter; else use generator" branch in the export orchestrator.
4. **Seeder action.** Add a "Re-seed `<subsystem>`" UI action that runs
   the generator and writes its output into `project.foo`. No editor UI
   yet — just populate.
5. **Diff harness green.** Re-export Hiyori with seeded state. The diff
   harness must report zero diffs vs. the unseeded (generator-path)
   baseline.
6. **Tag the stage.** Git tag `native-rig-stage-N-complete` on the merge
   commit. Rollback anchor for later stages.

A stage is **not done** until all six are green. Don't ship steps 1–4
without the diff being verified.

## Stages

12 subsystems total. Grouped into 3 milestones by risk and dependency.

**Milestone A — foundation** lays the infrastructure (diff harness,
parameters, autoRigConfig). Without these, nothing else has a baseline or
a tuning surface.

**Milestone B — flat data** migrates subsystems whose data is naturally
flat (numbers, references, lists). Low keyform-precision risk.

**Milestone C — keyform-bearing** migrates subsystems that store
per-vertex deltas across N keyforms. Highest float-precision risk; biggest
schema slices.

Within each milestone, stages can land in any order that the diff harness
allows.

---

### Milestone A — Foundation

#### Stage 0 — Diff harness foundation (no behavior change)

**Status: shipped.**

See "The diff harness" section above for the full design rationale.

* Build `scripts/native-rig-diff/canonicalize.js` (UUID remap, timestamp
  blank, float format) + unit tests.
* Build `scripts/native-rig-diff/diff.js` (XML/JSON structural diff on top
  of canonicalize).
* Document determinism finding (UUIDs + timestamps).
* End-to-end driver deferred to Stage 1.
* Tag: `pre-native-rig-refactor` on current `master`.

**Files:** `scripts/native-rig-diff/` (new). **Risk:** none — read-only.

#### Stage 0.5 — Schema versioning + migration scaffold

**Status: shipped.**

* `src/store/projectMigrations.js` — `migrateProject()` runner +
  `CURRENT_SCHEMA_VERSION = 1`. v1 migration is the consolidated
  forward-compat patcher that previously lived inline in
  `projectFile.loadProject` and `projectStore.loadProject`.
* `src/io/projectFile.js` — `loadProject` migrates after JSON.parse;
  `saveProject` writes `schemaVersion: CURRENT_SCHEMA_VERSION`.
* `src/store/projectStore.js` — `loadProject` calls `migrateProject`
  defensively (idempotent); initial state carries `schemaVersion`.
* 25 unit tests in `scripts/test_migrations.mjs`. Future-version files
  rejected with a clear error.

#### Stage 1a — Parameters: native rig fork + seeder + equivalence tests

**Status: shipped.**

Audit at kickoff resolved the open question: `project.parameters[]` was
in the schema but never populated (no UI, no code path writes to it
beyond initialisation). Exporter read `project.parameters` and prepended
its entries (legacy partial shape, role='project' hardcoded). Stage 1a
extends this without breaking anything.

* `paramSpec.js` `buildParameterSpec` now has a **native rig fork**:
  when `baseParameters` is non-empty, it skips all generators and emits
  `[ParamOpacity, ...baseParameters]` verbatim (deduped, opacity
  prepended only if missing). When empty, today's generator path runs.
* `paramSpec.js` exports `seedParameters(project)` that runs the
  generator once and stores the full spec in `project.parameters`.
* Storage shape extended to full ParamSpec: `role`, `decimalPlaces`,
  `repeat`, optional `boneId`/`variantSuffix`/`groupId` are preserved.
  Legacy partial-shape entries get sensible defaults.
* `useProjectStore.seedParameters` action wraps the function with
  history snapshot + unsaved-changes flag.
* 21 unit tests (`scripts/test_paramSpec.mjs`) cover the equivalence
  invariant (after seed, native path output == generator path output),
  round-trip serialisation, opacity prepending, order preservation,
  legacy partial-shape compat, and seed determinism.

**Files:** `src/io/live2d/rig/paramSpec.js`, `src/store/projectStore.js`,
`scripts/test_paramSpec.mjs`, `package.json` (npm script).

#### Stage 1b — Parameters UI + Initialize-Rig orchestrator

**Status: shipped (v1).**

Stage 1 was originally bundled with UI work. Splitting it out — the data
layer (1a) is what unblocks downstream stages; the UI is the entry point
for the seeders shipped in stages 1a / 3 / 5–10.

* `src/components/parameters/ParametersPanel.jsx` — Parameters panel
  slotted into the right sidebar between `ArmaturePanel` and `Inspector`.
  Read-only collapsed list of `project.parameters` with name + range +
  default. Three-cell status row at the top showing whether
  `faceParallax` / `bodyWarp` / `rigWarps` are baked-vs-inline.
* "Initialize Rig" button — runs
  `initializeRigFromProject(project, images)` and pushes the harvest
  through `useProjectStore.seedAllRig(harvest)`. Confirmation dialog
  fires if any keyform-bearing field is already populated.
* "Clear Rig Keyforms" button — calls `clearRigKeyforms` (drops
  faceParallax / bodyWarp / rigWarps; configs left intact). Confirmation
  dialog gated on the same any-baked predicate.
* `src/io/live2d/rig/initRig.js` — the orchestrator. Runs `generateCmo3`
  in `rigOnly` mode against the live project state (with the keyform-
  bearing inputs explicitly set to `null` so heuristics fire) and
  harvests via the pure `harvestSeedFromRigSpec(rigSpec)` helper.
  Filter logic: `id === 'FaceParallaxWarp'` → faceParallax;
  `id ∈ {BZ/BY/Breath/BX} ∪ {NeckWarp}` → suppressed (chain comes from
  `rigSpec.bodyWarpChain` stash); `targetPartId != null` → rigWarps map.
* `cmo3writer.js` stashes `_bodyChain` on `rigCollector.bodyWarpChain`
  so the harvester gets the full chain (specs + layout + debug +
  closures) without rerunning `buildBodyWarpChain` itself.
* `useProjectStore.seedAllRig(harvest)` — single-snapshot orchestrator
  that fans out to every seeder (parameters / mask / physics / bone /
  variantFade / eyeClosure / rotationDeformer / autoRig) and then the
  three keyform stores. When the harvest produces null for one of the
  keyform-bearing fields the matching `clearXxx` runs instead — keeps
  state consistent.
* `useProjectStore.clearRigKeyforms()` — drops the three keyform stores
  in one snapshot.
* `loadProject` action bug-fix: previously dropped `autoRigConfig`,
  `faceParallax`, `bodyWarp`, `rigWarps` when restoring a `.stretch`,
  silently regenerating them from heuristics. Now restored verbatim.
* `resetProject` mirrors the same field set.
* 35 unit tests cover `harvestSeedFromRigSpec` filter logic — null /
  empty inputs, face parallax extraction, body warp suppression, neck
  warp suppression, per-mesh rigWarps map keyed by `targetPartId`,
  duplicate-partId last-wins, mixed-everything together, malformed
  entry tolerance, order independence, missing chain stash. The async
  `initializeRigFromProject` end-to-end is covered indirectly by
  test_e2e_equivalence and the export integration paths.

**Out of scope (deferred):**
* `project.parameterGroups` for LipSync / EyeBlink / palette ordering
  (today auto-discovered by tag scan in cdi3 emission — works but isn't
  user-editable).
* Delete protection (per "Cross-cutting invariants → ID stability").
  Standard params (22 baked-in IDs) cannot be deleted via UI; custom
  params (variant, bone-rotation, project-added) prompt with a list of
  referencing animation tracks + physics rules. Stage 1b v1 makes the
  parameters list read-only so deletion isn't even reachable yet.
* Per-parameter min/max/default editing.

**Files:** new `src/components/parameters/ParametersPanel.jsx`,
new `src/io/live2d/rig/initRig.js`, new `scripts/test_initRig.mjs`,
modified `src/io/live2d/cmo3writer.js` (rigCollector.bodyWarpChain stash),
modified `src/io/live2d/rig/rigSpec.js` (emptyRigSpec adds
bodyWarpChain field), modified `src/io/live2d/exporter.js` (export
buildMeshesForRig), modified `src/store/projectStore.js` (seedAllRig +
clearRigKeyforms actions, loadProject + resetProject field fixes),
modified `src/app/layout/EditorLayout.jsx` (ParametersPanel slot).

#### Stage 2 — autoRigConfig (seeder tuning surface)

**Status: shipped.**

Centralises scattered magic constants from three subsystems into one
project-level config that the seeder/writers read. Pure plumbing — no
behaviour change; defaults match the existing hardcoded literals
bit-for-bit.

* `src/io/live2d/rig/autoRigConfig.js` — `DEFAULT_AUTO_RIG_CONFIG`
  bundles three sections:
    - `bodyWarp` — `canvasPadFrac` (0.10), `hipFracDefault` (0.45),
      `feetFracDefault` (0.75), `feetMarginRf` (0.05), `bxRange`
      (0.10..0.90), `byMargin` (0.065), `breathMargin` (0.055),
      `upperBodyTCap` (0.5), `upperBodySlope` (1.5). Anatomy-measured
      `HIP_FRAC` / `FEET_FRAC` continue to override the defaults via
      `bodyAnalyzer` — config only seeds the fallbacks.
    - `faceParallax` — `depthK` (0.80), `edgeDepthK` (0.30),
      `maxAngleXDeg` (15), `maxAngleYDeg` (8), `depthAmp` (3.0),
      `eyeParallaxAmpX` (1.3), `farEyeSquashAmp` (0.18),
      `protectionStrength` (1.0), `protectionFalloffBuffer` (0.12),
      `protectionPerTag` (eyelash/eyewhite/irides=1.00, ears=0.90,
      eyebrow=0.80, mouth/nose=0.30), `superGroups`
      (`eye-l`/`eye-r` → eyelash+eyewhite+irides per side).
    - `neckWarp` — `tiltFrac` (0.08).
  Plus builder / resolver / seeder following Stage 5/6/7/8 pattern.
* Schema bumped to v7 with migration adding `project.autoRigConfig`
  (default null; resolver provides defaults when null).
* `rig/bodyWarp.js` `buildBodyWarpChain` takes `autoRigBodyWarp` input
  arg with `DEFAULT_AUTO_RIG_CONFIG.bodyWarp` fallback. Local `BX_MIN`,
  `BX_MAX`, `BY_MARGIN`, `BR_MARGIN`, `padFrac`, `HIP_FRAC_DEFAULT`,
  `FEET_FRAC_DEFAULT`, `FEET_MARGIN_RF`, `UPPER_BODY_T_CAP`,
  `UPPER_BODY_SLOPE` all sourced from the config.
* `cmo3/faceParallax.js` `emitFaceParallax` takes `autoRigFaceParallax`
  ctx arg. The 9 numeric coefficients + `PROTECTION_PER_TAG` +
  `SUPER_GROUPS` all come from the config; `EYE_PARALLAX_AMP_X` and
  `FAR_EYE_SQUASH_AMP` (inside `computeFpKeyform`) likewise.
* `rig/warpDeformers.js` `buildNeckWarpSpec` takes `autoRigNeckWarp`
  input arg. `NECK_TILT_FRAC` sourced from the config; debug log
  reflects the actual value used.
* `cmo3writer.js` accepts `autoRigConfig` as input and threads each
  section into the right call (`bodyWarp`, `faceParallax`, `neckWarp`).
  `cmo3/bodyRig.js` `emitNeckWarp` takes `autoRigNeckWarp` ctx arg.
* `useProjectStore.seedAutoRigConfig` action.
* **Resolution semantics: per-section fallback.** Unlike Stages 7/8
  (whole-config fallback), `resolveAutoRigConfig` validates each of
  `bodyWarp` / `faceParallax` / `neckWarp` independently. If one
  section is malformed, only that section falls back to defaults; the
  other sections are kept as-is. Reason: this is a multi-section
  config that downstream stages (4, 9, 10) will keep adding to —
  invalidating an entire user config because one new field went wrong
  is too harsh.
* 83 unit tests cover the DEFAULT contract (every legacy literal),
  build-returns-mutable-deep-copy, per-section fallback (good +
  malformed sections coexist), destructive seed, JSON round-trip,
  `buildBodyWarpChain` + `buildNeckWarpSpec` consuming custom config
  values, and equivalence (default literals == seeded autoRigBodyWarp).

**Out of scope (deferred to other stages):** TAG_PARAM_BINDINGS shiftFn
magnitudes (Stage 9 — they're entangled with the keyform precompile,
not just constants), face parallax keyform output (Stage 4), body warp
chain keyform output (Stage 10).

**Files:** `src/io/live2d/rig/autoRigConfig.js` (new),
`src/io/live2d/rig/bodyWarp.js`, `src/io/live2d/cmo3/faceParallax.js`,
`src/io/live2d/rig/warpDeformers.js`, `src/io/live2d/cmo3writer.js`,
`src/io/live2d/cmo3/bodyRig.js`, `src/io/live2d/exporter.js`,
`src/store/projectStore.js`, `src/store/projectMigrations.js`.

---

### Milestone B — Flat data subsystems

#### Stage 3 — Mask configs

**Status: shipped.**

* `src/io/live2d/rig/maskConfigs.js` — single home for `CLIP_RULES` (was
  duplicated in moc3writer + cmo3writer) + `buildMaskConfigsFromProject`
  (heuristic) + `resolveMaskConfigs` (populated→use, else heuristic) +
  `seedMaskConfigs(project)` (destructive, writes to
  `project.maskConfigs`).
* `project.maskConfigs[]` schema added; v1→v2 migration adds an empty
  default.
* `moc3writer` and `cmo3writer` now consume mask pairs via
  `resolveMaskConfigs(project)` (caller-side) — writers translate mesh
  IDs to their internal references (mesh index in moc3,
  `pidDrawable` in cmo3).
* `useProjectStore.seedMaskConfigs` action exposed.
* 25 unit tests cover the heuristic (variant pairing, fallback,
  invisible-mesh skipping, ordering), `resolveMaskConfigs` populated-vs-
  empty branching, seeder destructiveness, equivalence (seeded path ==
  generator path), and JSON round-trip.

#### Stage 4 — Face parallax

**Status: shipped (v1, no staleness detection).**

Stage 4 is the first **keyform-bearing** stage (Milestone C). The
FaceParallax warp deformer's 6×6 grid × 9 keyforms (~720 floats) now
serialize into `project.faceParallax` and replay on subsequent exports.

* `src/io/live2d/rig/faceParallaxBuilder.js` (new) — extracted ~520 LOC
  of pure compute from `cmo3/faceParallax.js` `emitFaceParallax`.
  Exports `buildFaceParallaxSpec({meshes, faceUnionBbox, facePivotCx,
  facePivotCy, faceMeshBbox, autoRigFaceParallax})` returning `{spec,
  debug}`. The full algorithm — depth-weighted ellipsoidal rotation,
  protected-region build (super-groups + per-mesh, A.3 L/R pairing,
  A.6b grid-cell expansion), eye parallax amp, far-eye squash, ax=0
  horizontal symmetrisation — lives here. No XML / no PIDs / no UUIDs.
* `src/io/live2d/rig/faceParallaxStore.js` (new) — serialize/deserialize
  helpers (Float64Array ↔ plain `number[]` since typed arrays don't
  survive JSON round-trip), `resolveFaceParallax(project)`,
  `seedFaceParallax(project, spec)`, `clearFaceParallax(project)`.
  Lenient deserializer (defaults missing fields) but rejects fundamentally
  malformed input (no keyforms / no baseGrid).
* `cmo3/faceParallax.js` (`emitFaceParallax`) — refactored to ~225 LOC:
  if `ctx.preComputedSpec` provided, use it directly; else call
  `buildFaceParallaxSpec(...)` to produce a fresh spec. XML emission
  consumes `spec.baseGrid` and `spec.keyforms[i].positions` regardless
  of source. rigCollector still receives the spec.
* Schema bumped to v8 with migration adding `project.faceParallax`
  (default null; resolver returns null → cmo3 falls back to heuristic).
* `cmo3writer` + `exporter` thread `faceParallaxSpec = resolveFaceParallax(project)`.
* `useProjectStore.seedFaceParallax(spec)` action; `clearFaceParallax()`
  action for reverting. The seeder takes a pre-computed spec because
  `buildFaceParallaxSpec` needs caller-derived bbox/pivot inputs that
  the export pipeline computes; future "Initialize Rig" UI button
  (Stage 1b territory) packages build+seed.
* 154 unit tests cover spec shape (id, parent, gridSize, baseGrid,
  bindings, keyforms), pivot-relative rest grid, rest keyform == baseGrid,
  determinism, ax≠0 keyform divergence at center, ax=0 L/R symmetry,
  protected region count + values, custom config propagation, faceMesh
  fallback, serialize/deserialize round-trip (1e-15 precision), null/
  malformed handling, lenient defaults, store action destructiveness,
  full JSON.stringify→parse round-trip.

**Out of scope (Stage 4 v1):** mesh signature tracking. If user reimports
PSD with re-meshed face-tagged meshes, stored vertex deltas silently
become stale (cross-cutting "ID stability" invariant calls for
`signatureHash`). User must `clearFaceParallax` manually after reimport.
Documented as known footgun; full signature tracking deferred to a
later cleanup stage.

**Files:** `src/io/live2d/rig/faceParallaxBuilder.js` (new),
`src/io/live2d/rig/faceParallaxStore.js` (new),
`src/io/live2d/cmo3/faceParallax.js`, `src/io/live2d/cmo3writer.js`,
`src/io/live2d/exporter.js`, `src/store/projectStore.js`,
`src/store/projectMigrations.js`, `scripts/test_faceParallax.mjs` (new),
`scripts/test_migrations.mjs`, `package.json`.

#### Stage 5 — Variant fade rules + eye closure config

**Status: shipped.**

Tag-gated heuristics (`BACKDROP_TAGS_SET`, `EYE_CLOSURE_TAGS`,
`EYE_CLOSURE_LASH_STRIP_FRAC`, `EYE_CLOSURE_BIN_COUNT`) become explicit
project config.

* `src/io/live2d/rig/variantFadeRules.js` — `DEFAULT_BACKDROP_TAGS` (the
  canonical Hiyori-style list), `buildVariantFadeRulesFromProject`,
  `resolveVariantFadeRules`, `seedVariantFadeRules`.
* `src/io/live2d/rig/eyeClosureConfig.js` — `DEFAULT_EYE_CLOSURE_TAGS`,
  `DEFAULT_LASH_STRIP_FRAC = 0.06`, `DEFAULT_BIN_COUNT = 6`, builder /
  resolver / seeder.
* Schema bumped to v5 with migration adding `project.variantFadeRules`
  and `project.eyeClosureConfig` (both default null; resolvers provide
  defaults when null).
* `cmo3writer.js` consumes both via input args (`variantFadeRules`,
  `eyeClosureConfig`); inline `BACKDROP_TAGS_SET` / `EYE_CLOSURE_TAGS` /
  `EYE_CLOSURE_LASH_STRIP_FRAC` / `EYE_CLOSURE_BIN_COUNT` constants now
  derive from the resolved configs.
* `moc3writer.js` consumes `variantFadeRules` via input arg; the
  duplicated `BACKDROP_TAGS_SET_MOC3` is now sourced from the resolved
  config. (Eye closure keyforms still flow through `rigSpec.eyeClosure`
  built in cmo3writer — no separate moc3 path needed.)
* `useProjectStore.seedVariantFadeRules` + `seedEyeClosureConfig`
  actions wrap the seeders with history snapshot + unsaved-changes flag.
* 52 unit tests across `scripts/test_variantFadeRules.mjs` (19) +
  `scripts/test_eyeClosureConfig.mjs` (33) covering DEFAULT contract,
  build-returns-mutable-copy, populated-vs-empty resolution branching,
  destructive seed semantics, equivalence (seeded == generator), and
  round-trip serialization.
* End-to-end equivalence test extended to verify both subsystems compose
  correctly with the rest of the seeded path.

Verified against memory invariants:
  - `feedback_variant_plateau_ramp` — backdrop list matches the rule's
    "face / ears / front+back hair never fade" canon.
  - `feedback_no_sharing_eye_2d_grid` — no shared closure curve in the
    config; per-variant fits remain in cmo3writer (the config only
    surfaces the tunable constants, not derived geometry).

#### Stage 6 — Physics rules

**Status: shipped.**

* `src/io/live2d/rig/physicsConfig.js` — `DEFAULT_PHYSICS_RULES` (re-exported
  from `cmo3/physics.js` as the seed source), `buildPhysicsRulesFromProject`
  (resolves `boneOutputs` against project groups, flattens into `outputs[]`),
  `resolvePhysicsRules` (populated→use, else build), `seedPhysicsRules`
  (destructive write).
* Schema bumped to v3 with migration adding `project.physicsRules[]`.
* `cmo3/physics.js`'s `emitPhysicsSettings` now takes pre-resolved
  `rules` from ctx (no more local `ruleOutputs` helper); per-mesh tag /
  paramDef gating remains because it depends on export-time state.
* `physics3json.js` similarly refactored — `resolveRuleOutputs` deleted,
  consumes `rules` from opts.
* Caller in `exporter.js` computes via `resolvePhysicsRules(project)` and
  passes to both writers.
* `useProjectStore.seedPhysicsRules` action.
* 83 unit tests cover boneOutput resolution, equivalence (seeded ==
  generator), round-trip, structural fields, populated-vs-empty
  resolution, destructiveness.

Note: tag/param gating stays in writers (depends on export-time
tagsPresent / paramDefs which the resolver doesn't see). Re-seed
required if user adds a new boneRole group post-seed.

#### Stage 7 — Bone config

**Status: shipped.**

* `src/io/live2d/rig/boneConfig.js` — `DEFAULT_BAKED_KEYFORM_ANGLES`
  (frozen `[-90,-45,0,45,90]`), `buildBoneConfigFromProject` (returns
  mutable copy of defaults; reserved for future per-bone overrides),
  `resolveBoneConfig` (populated→use, else build), `seedBoneConfig`.
* Schema bumped to v4 with migration adding `project.boneConfig` (null
  default; resolver provides defaults when null).
* `paramSpec.js`, `cmo3writer.js`, `moc3writer.js` all take
  `bakedKeyformAngles` from input. Bone-rotation param min/max derived
  from this set; bone-baked keyform emission iterates this set.
  Previously hardcoded as `BAKED_BONE_ANGLES` in paramSpec + duplicated
  inline literal in moc3writer — now a single source of truth.
* `useProjectStore.seedBoneConfig` action.
* 18 tests cover the resolver branching, destructive seed, custom and
  asymmetric angle sets, frozen-default protection, and round-trip.
* Re-seed required if user changes the angle set after bone-baked mesh
  keyforms have been emitted (cross-cutting "ID stability" invariant).

---

### Milestone C — Keyform-bearing subsystems

These store per-vertex deltas across N keyforms. The seeder runs
`shiftFn` and bakes outputs (see "Architectural decision: precompile" in
Goal). Diff harness needs float tolerance here.

#### Stage 8 — Rotation deformers (config)

**Status: shipped.**

Pragmatic interpretation: rotation-deformer "keyforms" are just
`(paramKey, angle)` tuples plus a live-computed pivot — there's no
per-vertex delta data to stage as keyforms. Stage 8 lifts the four
hardcoded constants that previously drove auto-rig output:

* `src/io/live2d/rig/rotationDeformerConfig.js` —
  `DEFAULT_ROTATION_DEFORMER_CONFIG` bundles:
    - `skipRotationRoles` (boneRoles handled by warps, not rotation
      deformers; default `['torso','eyes','neck']`).
    - `paramAngleRange` (`ParamRotation_<group>` min/max; default ±30).
    - `groupRotation.{paramKeys, angles}` (default 1:1 ±30).
    - `faceRotation.{paramKeys, angles}` (default ±10° on ±30 keys —
      Hiyori cap).
  Plus builder / resolver / seeder following Stage 5/6/7 pattern.
* Schema bumped to v6 with migration adding `project.rotationDeformerConfig`
  (default null; resolver provides defaults when null).
* `paramSpec.js` consumes `rotationDeformerConfig.skipRotationRoles` +
  `paramAngleRange` to pick which groups get a `ParamRotation_*` and at
  what range. Eliminates the duplicated `SKIP_ROTATION_ROLES` constant
  that previously lived in both paramSpec and cmo3writer.
* `cmo3writer.js` consumes the full config; rotation-deformer keyform
  emission generalised from a hardcoded 3-keyform shape (min/def/max)
  to **N-keyform** based on `groupRotation.paramKeys.length`. Defaults
  (3 keyforms) match exact previous output bit-for-bit.
* `cmo3/bodyRig.js` (`emitFaceRotation`) takes `faceRotationParamKeys`
  + `faceRotationAngles` ctx args, threading through to
  `buildFaceRotationSpec`.
* `rig/rotationDeformers.js` `buildFaceRotationSpec` +
  `buildGroupRotationSpec` accept `paramKeys` + `angles` input args
  with default fallbacks; throw on length mismatch.
* `moc3writer.js` accepts `rotationDeformerConfig` (pass-through to
  paramSpec via `buildSectionData`).
* `useProjectStore.seedRotationDeformerConfig` action.
* 49 unit tests cover the DEFAULT contract, build-returns-mutable-copy,
  populated/null/malformed resolution branching, destructive seed,
  buildFaceRotationSpec / buildGroupRotationSpec param overrides + length-mismatch
  throws, paramSpec consuming the config, JSON round-trip + custom values.

Pivots stay computed live from `g.transform` at export time — re-seed
not required when user moves a group; only the angle mapping is frozen.
`scale=1.0` and `useBoneUiTestImpl=true` remain hardcoded in builders
(would belong in a hypothetical Stage 8b that exposes more rotation
deformer fields if anyone ever needs them).

**Files:** `src/io/live2d/rig/rotationDeformerConfig.js` (new),
`src/io/live2d/rig/rotationDeformers.js`, `src/io/live2d/rig/paramSpec.js`,
`src/io/live2d/cmo3writer.js`, `src/io/live2d/cmo3/bodyRig.js`,
`src/io/live2d/moc3writer.js`, `src/io/live2d/exporter.js`,
`src/store/projectStore.js`, `src/io/projectFile.js`,
`src/store/projectMigrations.js`.

#### Stage 9 — Tag warp bindings (split: 9a shipped, 9b not started)

##### Stage 9a — Module + magnitude lift (**shipped**)

Lifted the 290-LOC inline `TAG_PARAM_BINDINGS` Map out of
`cmo3writer.js` into a pure module
[`rig/tagWarpBindings.js`](../../src/io/live2d/rig/tagWarpBindings.js).
The procedural `shiftFn` closures stay closures (still computed at
export time) — what changed is *where they live* and *how they read
their magnitudes*:

* `buildTagWarpBindingRules(magnitudes)` returns the Map
  `tag → {bindings, shiftFn}`. The `shiftFn`s read every numeric
  magnitude (hair X-sway, hem sway, brow translate, eye converge
  fraction, iris gaze, mouth stretch — ~13 in total) from the
  `magnitudes` arg instead of inline literals.
* `buildTagBindingMap(paramPids, magnitudes)` wraps the rule set with
  the writer's expected legacy shape: each binding gains a `pid`
  field looked up from a `paramId → pid` map (writer's gate
  `bindings.every(b => b.pid)` cleanly drops bindings whose param
  isn't registered).
* `autoRigConfig.tagWarpMagnitudes` is the new knob surface —
  per-character override without forking shared code. Defaults are
  bit-for-bit identical to the pre-9a literals; equivalence verified
  by reference-table tests in `scripts/test_tagWarpBindings.mjs`.
* `cmo3writer.js` now imports `buildTagBindingMap` and threads in
  `autoRigConfig?.tagWarpMagnitudes`.

**Tests:** 182 in `test_tagWarpBindings.mjs` (rule shape, PID wiring,
default equivalence per-tag, rest keyforms, magnitude linearity,
determinism, default-magnitude-table) + 26 in `test_autoRigConfig.mjs`
(per-section fallback for tagWarpMagnitudes).

**Files:** `rig/tagWarpBindings.js` (new), `rig/autoRigConfig.js`
(added section + clone/validator), `cmo3writer.js` (290-LOC inline
block replaced by 26-LOC import-and-consume), `scripts/test_*` (×2).

##### Stage 9b — Per-mesh keyform baking (**shipped v1**)

* `project.rigWarps` = `{[partId]: serializedRigWarpSpec}`. Each entry
  mirrors the `rigWarpSpec` produced inside `cmo3writer.js`'s per-mesh
  emission loop (`id` / `name` / `parent` / `targetPartId` / `canvasBbox`
  / `gridSize` / `baseGrid` / `localFrame` / `bindings` / `keyforms` /
  visibility flags). Float64Array → number[] for JSON survival,
  same shape as Stages 4 + 10.
* Reader fork: `cmo3writer` accepts a `rigWarps` input — a
  `Map<partId, spec>`. Per-mesh emission validates stored spec shape
  (numKf cardinality + per-keyform position length matches the
  cartesian-product expected shape). On match, the procedural
  `shiftFn` invocation is replaced by `new Float64Array(spec.keyforms[ki].positions)`.
  On miss / shape-mismatch, the inline shiftFn path runs (no behavioural
  change). `exporter` threads `resolveRigWarps(project)` through both
  `generateCmo3` calls (rigOnly + full).
* Coexistence: empty `project.rigWarps` runs every mesh through the
  heuristic exactly as before — zero byte-for-byte regression risk on
  existing saves. Per-mesh granularity means partial seeding works
  too (some meshes baked, others heuristic).
* `shiftFn` STILL lives in `tagWarpBindings.js` for the heuristic /
  bake side. The eventual seeder action will invoke it once per
  (mesh, keyform-tuple) and store the result; v1 ships only the
  read side, so the seeder bake-flow remains unwired (caller can
  populate `project.rigWarps` from any source — typically by running
  `generateCmo3` once and harvesting `rigSpec.warpDeformers` filtered
  to entries with `targetPartId`).

**v1 caveat (deferred):** No `signatureHash` staleness detection. PSD
reimport with re-meshed silhouette / different vertex count silently
produces stale exports — user must `clearRigWarps` manually. The
shape-validity guard (numKf + position length) catches obvious
re-mesh cases automatically and falls back to heuristic; subtler
mismatches (same shape, different vertex topology) slip through.
Same trade-off Stages 4 + 10 v1 made.

**Tests:** 104 in `scripts/test_rigWarps.mjs` (`npm run test:rigWarps`)
+ 3 v10 migration tests in `test_migrations.mjs`. Covers serialize
shape contract, drop-without-targetPartId, JSON survival, exact
1e-15 round-trip on baseGrid + per-keyform positions, malformed
input rejection, store action destructiveness, multi-binding
(cartesian product) shape preservation, reader-fork validity-guard
behaviour on stale-grid-size / stale-keyform-count entries, and
"stored entries bypass heuristic" invariant.

**Files:** new `rig/rigWarpsStore.js`, `cmo3writer.js` (added
`rigWarps` ctx arg + reader fork in per-keyform position emission
loop), `exporter.js` (threads `resolveRigWarps`),
`projectMigrations.js` (v9 → v10), `projectStore.js` (initial state
`rigWarps: {}` + `seedRigWarps` / `clearRigWarps` actions).

#### Stage 10 — Body warp chain (**shipped v1**)

4-warp BZ → BY → Breath → BX chain in
[bodyWarp.js](../../src/io/live2d/rig/bodyWarp.js).

* `project.bodyWarp` = serialized chain — `{specs, layout, hasParamBodyAngleX, debug}`.
  `specs[]` carries the per-warp `WarpDeformerSpec` (3 entries when
  ParamBodyAngleX is absent, 4 otherwise) with `Float64Array` baseGrid +
  per-keyform `positions` re-encoded as `number[]` for JSON survival.
* `layout` carries the BZ_*/BY_*/BR_*/BX_* normaliser constants;
  `canvasToBodyXX/Y` closures are rebuilt at deserialize time via
  [`makeBodyWarpNormalizers(layout)`](../../src/io/live2d/rig/bodyWarp.js)
  (also used by `buildBodyWarpChain` itself, single source of truth).
* `debug` snapshots `HIP_FRAC` / `FEET_FRAC` / `bodyFracSource` /
  `spineCfShifts` so `rigDebugLog` reads the same whether the chain
  came from heuristic or storage.
* Reader fork: `cmo3writer` accepts a `bodyWarpChain` input — populated
  → use stored chain verbatim; null → run today's heuristic. `exporter`
  threads `resolveBodyWarp(project)` through both `generateCmo3` calls
  (rigOnly + full).
* Coexistence: matches the pattern from Stages 4 / 6 / 7 / 8 / 2 / 3.
  Empty `project.bodyWarp` runs the heuristic exactly as before — no
  byte-for-byte regression risk on existing `.stretch` files.

**v1 caveat (deferred):** No `signatureHash` staleness detection. PSD
reimport with re-meshed body silhouette / new bodyAnalyzer anchors
silently produces stale exports — user must `clearBodyWarp` manually.
Same trade-off Stage 4 v1 made. Full signature tracking deferred.

**Tests:** 131 in `scripts/test_bodyWarp.mjs` (`npm run test:bodyWarp`).
Covers chain shape contract, no-BX path, determinism, rest keyform
identity, normaliser equivalence, layout/closure reconstruction,
serialize/deserialize round-trip at 1e-15, JSON survival,
malformed input rejection, store action destructiveness, and the
"stored chain bypasses heuristic" invariant.

**Files:** `rig/bodyWarp.js` (added `makeBodyWarpNormalizers` export +
inline use), new `rig/bodyWarpStore.js`, `cmo3writer.js` (added
`bodyWarpChain` ctx arg + reader fork), `exporter.js` (threads
`resolveBodyWarp`), `projectMigrations.js` (v8 → v9), `projectStore.js`
(initial state + `seedBodyWarp` / `clearBodyWarp` actions).

---

### Stage 11 — Final cleanup (shipped 2026-04-27)

The plan was: remove the generator branches from the export orchestrator;
generator code reachable only via the seeder. Concretely shipped:

**`exporter.js` — `resolveAllKeyformSpecs(project, images)` helper.** New
private async function called at the top of both `exportLive2D` and
`exportLive2DProject`. Resolves the three keyform-bearing specs from
`project.faceParallax / bodyWarp / rigWarps` when populated; falls back to
a single `initializeRigFromProject` harvest when **all three** are empty.
The helper does NOT mutate `project` — the harvest is in-memory only, so
explicit "Initialize Rig" UI seeding remains the canonical user flow.
Partial seeding is respected: if at least one field is populated, the rest
stay `null` on the assumption the user explicitly cleared them (e.g. a
model with no face meshes legitimately has `project.faceParallax === null`).

**`cmo3writer.js` — fallback warn-guards.** The existing `?? heuristic`
branches stay in place (they're still used by the seeder via `rigOnly`
mode). Outside `rigOnly`, each branch now emits a `console.warn` flagging
that the exporter bypassed Stage 11 — a visible regression detector for
future callers. Three guard sites:

* `bodyWarpChain ?? buildBodyWarpChain(...)` (line ~2350)
* `rigWarps` empty-or-null check at top of section 3 emit
* `faceParallaxSpec` null check before `emitFaceParallax` call

**`rigOnly` mode is preserved.** The original Stage 11 plan-bullet 2
("garbage-collect `rigOnly` if no longer used") doesn't apply because
`initRig.js`'s `initializeRigFromProject` still uses `rigOnly` mode to
harvest a fresh rigSpec from the heuristic builders. Removing it would
require porting the rig-harvest flow into a separate `rig/buildRig.js`
module — a ~500 LOC extraction deferred to a future Stage 12 if/when the
need arises.

**`RUNTIME_PARITY_PLAN.md`** updated with a "Native rig path is now
canonical" subsection in the "Already shipped" block, documenting the
single canonical data flow: `project state → resolveAllKeyformSpecs →
cmo3writer (rigSpec harvest) → moc3writer`.

**Files:** `exporter.js`, `cmo3writer.js`, `RUNTIME_PARITY_PLAN.md`.
**Tests:** all 1092 tests across 16 suites still green; no new tests
added (refactor, not feature). **Build/lint:** zero new errors. Tag:
`native-rig-stage-11-complete`.

### v2 Stage R0 — Plumbing smoke test (shipped 2026-04-28)

First v2 milestone. Wires the live param-value pipeline from a UI slider
through a dirty-tagged React state effect and into the WebGL render
tick — all without any evaluator. Proves the data path works before R2-R5
math lands.

**`paramValuesStore.js` (new).** Zustand slice. Plain object `values`
(not Map — Zustand needs new references for re-renders, the
`{...prev, [id]: v}` pattern is idiomatic). Three actions:
`setParamValue(id, v)`, `setMany(updates)`, `resetToDefaults(parameters)`
(seeds `values[p.id] = p.default` for each parameter spec). Distinct
from `project.parameters` (persisted *spec*) and from animation
keyframes (which write into `draftPose` / channels) — this store is the
*current dial position* of every runnable param.

**`CanvasViewport.jsx` — paramValues subscription.** Imports the store,
mirrors values into `paramValuesRef.current` synchronously on render
(same pattern as `editorRef`/`projectRef`/`animRef`), and adds a
`useEffect(() => { isDirtyRef.current = true; }, [paramValues])`
alongside the existing project/theme dirty effect.

**`CanvasViewport.jsx` — R0 hook in tick.** Inserted after the puppet
warp branch (line ~404) and before the GPU upload loop (line ~426).
Reads `paramValuesRef.current['__test_translate_x']`; for each currently
selected mesh part, composes onto any existing `kfOv.mesh_verts` (or
falls back to base mesh) and translates X by the slider value. Writes
back to `poseOverrides`. Real evaluator (R2-R5) will replace this branch
with a chain composition reading the cached `rigSpec`.

**`ParametersPanel.jsx` — test slider UI.** Imports `Slider` (already
shadcn-shipped) + the store. Renders inside the existing `expanded`
block: dashed-bordered card showing `__test_translate_x: NN px` label
with a `[-100, +100]` step-1 slider. Live updates the store, triggers
the dirty effect, viewport renders the next frame.

**Verification:** `npm run build` clean (3.6s, no new warnings). UI
smoke test left to user — open ParametersPanel → expand → select a
meshed part → drag the test slider → mesh slides horizontally.

**Files:** `src/store/paramValuesStore.js` (new),
`src/components/canvas/CanvasViewport.jsx`,
`src/components/parameters/ParametersPanel.jsx`. **Tag:**
`native-rig-render-stage-R0-complete`.

### v2 Stage R1 — RigSpec session cache (shipped 2026-04-28)

Three sub-tasks shipped per the v2-plan double-check note. All four
gaps the doc flagged (initRig API, artMesh push, blendShape comp, R9
risk) — R1 closes the first two. R6 will close blendShape.

**(a) `initRig.js` — extended API.** `initializeRigFromProject` now
also returns `result.rigSpec` (was discarded at L144 in the original
v1 implementation). Same one-shot `generateCmo3 rigOnly` invocation
drives both the seeder harvest fields (faceParallaxSpec / bodyWarpChain
/ rigWarps) and the runtime cache. Existing callers (ParametersPanel
"Initialize Rig", exporter Stage 11 fallback) ignore the new field —
purely additive. JSDoc updated; new `rigSpec: object|null` documented.

**(b) `cmo3writer.js` — `rigCollector.artMeshes` populated.** The
per-mesh emit loop (Section 4, ~L3414-3938) now captures an
`ArtMeshSpec` per mesh alongside the existing XML emission. Each spec
carries `id (partId)`, `name`, best-effort `parent` ref, `verticesCanvas`,
`triangles`, `uvs`, `variantSuffix`, `textureId`, `bindings`, `keyforms`,
`drawOrder`, `localFrame`, `isVisible`. All six existing keyform
branches contribute the right shape:

* `hasBakedKeyforms` — N keyforms on the bone's
  `ParamRotation_<bone>` param, positions match XML (warp-local
  0..1 if rwBox, else pivot-relative px).
* `hasEyeVariantCompound` — 2D grid: 2 bindings (closure × variant
  suffix), 4 row-major keyforms with αN/αV opacity flip.
* `hasEyelidClosure` — 2 keyforms on `ParamEye{L,R}Open`.
* `hasNeckCornerShapekeys` — 3 keyforms on `ParamAngleX [-30, 0, 30]`.
* `hasEmotionVariantOnly` — 2 keyforms on `Param<Suffix>` opacity 0→1.
* `hasBaseFadeOnly` — 2 keyforms on `Param<Suffix>` opacity 1→0.
* default — 1-keyform plan on `ParamOpacity[1.0]` (mirrors moc3writer
  default `meshBindingPlan` at L624).

The `rigOnly` short-circuit moved from before-Section-4 (~L3340) to
after-Section-4 (~L3940) so the per-mesh loop runs and populates
`rigCollector.artMeshes`. Section 4 XML emission is wasted work in
rigOnly mode (~50ms on Hiyori-sized rigs) but Initialize-Rig is a
one-shot user click, not a hot path. Sections 5/6/7 (CModelImageGroup
+ CAFF packing) still skip cleanly as before.

**(c) `useRigSpecStore` Zustand slice (new file).** State:
`{ rigSpec, isBuilding, error, lastBuiltGeometryVersion }`. Actions:
`buildRigSpec()` (single-flight async — calls `initializeRigFromProject`
and caches `result.rigSpec`) and `invalidate()` (drops cache).
Auto-invalidation: a one-time `useProjectStore.subscribe` at module
load watches `versionControl.geometryVersion` — bumps caused by mesh
edits / retriangulate / PSD reimport / blend shape / puppet pin
edits drop the cache so the next read kicks a rebuild. Tag changes
don't bump geometry but normally accompany an Initialize-Rig click.

**ParametersPanel hook.** "Initialize Rig" already has the harvest
result in hand — `runInit` now also calls `useRigSpecStore.setState`
to seed the cache directly (avoids re-running the rig generator).
"Clear keyforms" calls `useRigSpecStore.invalidate()` so a future
evaluator rebuild picks up the cleared state.

**Verification:** `test_initRig.mjs` extended with API-shape smoke
test (synthetic 1-mesh project) — asserts `rigSpec.artMeshes` is
present and populated with `id`, `bindings`, `keyforms` arrays. All
1097 tests pass (1092 prior + 5 new). Build green.

**Files:** `src/io/live2d/rig/initRig.js`,
`src/io/live2d/cmo3writer.js`,
`src/store/rigSpecStore.js` (new),
`src/components/parameters/ParametersPanel.jsx`,
`scripts/test_initRig.mjs`. **Tag:**
`native-rig-render-stage-R1-complete`.

### v2 Stage R2 — `cellSelect` (shipped 2026-04-28)

First evaluator math module. Pure JS. Takes a host's `bindings` array
and a flat `paramValues` map; returns `{indices, weights}` for the
2^N (or product, with single-key bindings) corner cells of the
cross-product keyform grid plus the multilinear blend weights.

**Cell selection** — for each binding, finds the segment
`(keys[j], keys[j+1])` containing the current param value and the
lerp `t ∈ [0, 1]`. Edge handling: out-of-range values clamp to nearest
endpoint (`t=0` or `t=1`); single-key bindings collapse to one corner
with weight 1 (degenerate "no parameter axis" case); missing
paramValue defaults to 0.

**Layout convention** — first binding varies fastest in both the
output array and the keyform array index. Verified against Hiyori's
.cmo3 (cmo3writer.js cornersOrder L1257) and the moc3 keyform
binding-index packing.

**Weights** — multilinear: corner with binding-pos vector
`(c_0, …, c_{N-1})` has weight `∏_n (c_n ? t_n : 1−t_n)`. Sum to 1
(within FP rounding) — verified with a 100-sample random sweep test.

**Files:** `src/io/live2d/runtime/evaluator/cellSelect.js` (new
directory tree per v2 plan layout), `scripts/test_cellSelect.mjs`,
`package.json` (test script wired into `npm test`).

**Tests:** 39 cases — zero/null/undefined bindings, 1D 2-key, 1D 3-key
(BAKED_ANGLES style), 1D 5-key (wider bone-bake range), 2D 2×2 (eye
compound), 2D 2×3 asymmetric, 3D 2×2×2, exact-key handling, clamping,
single-key degeneracy, single-key + 2-key combined, missing param,
non-uniform spacing, weights-sum invariant, first-fastest invariant.
All pass.

**Tag:** `native-rig-render-stage-R2-complete`.

### v2 Stage R3 — `warpEval` + `frameConvert` (shipped 2026-04-28)

Two pure modules driving warp deformer evaluation.

**`warpEval.js`** — Two functions:

* `evalWarpGrid(spec, cellInfo)` — Blend the per-keyform position
  arrays by `cellInfo.weights` and return the currently-active deformed
  control-point grid. Output is in the spec's `localFrame` (still
  needs `frameConvert` to map back to canvas).
* `bilinearFFD(grid, gridSize, u, v, out?)` — Apply the warp's grid
  as a free-form deformation to a single point in the warp's
  normalised `[0..1] × [0..1]` domain. Optional output buffer to
  avoid heap churn in tight loops.

**`frameConvert.js`** — `canvasToLocal(canvasPos, localFrame, ctx?)`
+ `localToCanvas(localPos, localFrame, ctx?)`. Three frames:

* `'canvas-px'` — identity. Parent is ROOT.
* `'normalized-0to1'` — `(cx, cy) ↔ (u, v)` against the parent warp's
  REST `gridBox = {minX, minY, W, H}`. Caller threads the actual
  deformed grid via `bilinearFFD` after un-normalising.
* `'pivot-relative'` — subtract pivot then unrotate by parent's
  current angle (forward); rotate by parent angle then add pivot
  (inverse). Round-trip to FP precision verified.

**Tests:** 41 cases covering single/multi-keyform blends, weight-zero
skip (no NaN), null/empty spec → null, FFD identity at corners, FFD
center / edge midpoint, FFD out-of-domain clamp, FFD output buffer
reuse, 2×2 grid (3×3 control points), and frameConvert: canvas-px
identity, normalized round-trip + corners + zero-extent gridBox +
missing-context throw, pivot-relative no-rotation / 90° / arbitrary
angle round-trip, unknown-frame throw, plus an integration test that
chains `evalWarpGrid → bilinearFFD`.

**Files:** `src/io/live2d/runtime/evaluator/warpEval.js` (new),
`src/io/live2d/runtime/evaluator/frameConvert.js` (new),
`scripts/test_warpEval.mjs` (new), `package.json` (test wired into
`npm test`). 1177 tests pass total.

**Tag:** `native-rig-render-stage-R3-complete`.

### v2 Stage R4 — `rotationEval` (shipped 2026-04-28)

Pure JS module covering rotation deformer evaluation + 3×3 affine
matrix composition.

**`evalRotation(spec, cellInfo)`** blends a rotation deformer's
keyforms into `{angleDeg, originX, originY, scale, reflectX, reflectY,
opacity}`. Numeric fields lerp linearly by `cellInfo.weights`; the
two booleans (`reflectX`, `reflectY`) are taken from the
heaviest-weighted keyform — in practice they're invariant across a
single deformer's keyforms anyway. Defensive fallback: zero-weight
cellInfo returns the spec's first keyform unchanged. Empty / null
spec returns `null`.

**`buildRotationMat3(state)`** composes the 3×3 row-major affine
matrix `parentPos = origin + R(angle) · S(scale) · Reflect · pivotRel`.
Returned as a flat 9-element `Float64Array`
`[a, b, c, d, e, f, 0, 0, 1]` for cheap matrix multiply.

**`applyMat3ToPoint(m, x, y, out?)`** and
**`mat3Multiply(a, b, out?)`** — small helpers so callers don't pull
in a full mat3 library; both accept optional output buffers for
alloc-free composition. R6 (chain composition) will use them
heavily.

**Angle blending** stays linear — for the typical Cubism
[-30, 0, 30] et al. ranges that's exact. Wrap-around lerp deferred
until any rig actually uses a range crossing ±180°.

**Tests:** 41 cases — single keyform identity, missing-fields
defaults, 50/50 blend (angle / origin / scale / opacity midpoints),
reflect heaviest-wins, empty/null spec, zero-weight defensive
fallback, identity matrix, pure translation, 90° around origin /
around (10, 20), pure scale, reflectX/Y, combined transform,
mat3Multiply identity / chained-rotation composition / out param,
applyMat3ToPoint out param, plus an integration test
(evalRotation → buildRotationMat3 → applyMat3ToPoint at 50/50 blend
of 0° and 90°). All pass; total suite at 1218.

**Files:** `src/io/live2d/runtime/evaluator/rotationEval.js` (new),
`scripts/test_rotationEval.mjs` (new), `package.json`. **Tag:**
`native-rig-render-stage-R4-complete`.

### v2 Stage R5 — `artMeshEval` (shipped 2026-04-28)

Pure JS module that blends an art mesh's per-keyform vertex grids,
opacities and drawOrders into a single resolved state. Same shape as
`evalWarpGrid` but for variable-length per-mesh vertex arrays —
returns a fresh `Float32Array` (typed to match the storage).

**Opacity** lerps directly (scalar weighted average — covers eye
fade, variant cross-fade, base fade-out, compound 2D αN/αV). Random
sweep test verifies opacity stays in `[0, 1]` for valid weight
inputs.

**drawOrder** is *sticky* — taken from the heaviest-weighted keyform
rather than blended. Cubism's runtime treats drawOrder as discrete
per-keyform, so a continuous blend would produce visible Z-flicker.
Fallback chain: keyform `drawOrder` → spec `drawOrder` → `500`.

**Length mismatch** in keyform vertex arrays causes the offending
entry to be skipped (defensive — the rig builder should never emit
this, but a stale rigSpec after a remesh could). Reference length is
the first weighted keyform.

**Defensive fallback** for zero total weight: copy the first keyform
verbatim. Output is always a fresh `Float32Array` — no aliasing of
input keyform buffers.

**Tests:** 32 cases — single keyform identity, 2-keyform 50/50
blend (eye-blink shape), variant fade (verts unchanged + opacity
ramps), 4-keyform 2D compound (eye blink × variant), default
1-keyform `ParamOpacity[1.0]` plan, drawOrder heaviest wins,
drawOrder fallback chain (keyform → spec → 500), null/empty/no-
keyforms → null, length mismatch skip, zero-weight fallback,
no-aliasing of input buffers, random sweep opacity in `[0, 1]`. All
pass; total suite at 1250.

**Files:** `src/io/live2d/runtime/evaluator/artMeshEval.js` (new),
`scripts/test_artMeshEval.mjs` (new), `package.json`. **Tag:**
`native-rig-render-stage-R5-complete`.

## Rollback strategy

Two layers:

1. **Per-feature gate.** The "if `project.foo` populated, use it; else
   generate" pattern means a bad migration is reverted by clearing the
   field, not by reverting commits. Even mid-stage, the export still works.
2. **Per-stage tag.** `git tag native-rig-stage-N-complete` after each
   green stage. If stage N+1 turns out architecturally wrong, reset
   feature branch to stage N tag. The pre-refactor baseline tag is
   `pre-native-rig-refactor` on `master`.

Master stays exportable at every commit. **Never** merge a stage that
breaks the diff harness on Hiyori.

## What stays generated forever (or at least past v1)

These are excluded from the refactor:

* **Procedural motion presets** (idle/listening/talking/embarrassed) —
  algorithmic by design. Generated at export from
  [scripts/idle/](../../scripts/idle/) and friends.
* **moc3 compile-time fields** — `rotation_deformer.scales` (=
  1/canvasMaxDim for warp parents), `parameter.keyform_binding_begin_indices`,
  per-mesh keyform plans. These are computed during binary serialization
  and have no `.cmo3` XML equivalent — see
  `reference_moc3_compile_time_fields` memory note.
* **PNG atlas packing.** Already deterministic, not in scope.
* **Auto-rig itself.** Code stays; role becomes "seeder".

## Open questions resolved during Stage 0

1. **Is the current export deterministic?** **No.** UUIDs (random) and
   timestamps. Resolved by canonicalization in the harness — see "The
   diff harness" section.
2. **What's the minimum reference set?** `shelby_neutral_ok.psd` is the
   only in-repo asset. Hiyori is canonical for cmo3 work but lives
   user-side; harness accepts it as input. `waifu.psd` not in repo
   either; canary deferred until needed.

## Open questions remaining

1. **Driver architecture.** End-to-end harness needs to call
   `exportLive2D()` twice. Browser-coupled today (`HTMLImageElement`,
   `JSZip`). Three possible drivers: (a) headless browser via Puppeteer,
   (b) extract JSON-only generators to Node, (c) in-app dev tool button.
   Decision deferred to Stage 1 when the harness is first used.
2. **`project.parameters` schema.** The dormant field exists — what's
   its exact current shape? Need to confirm it matches the generator's
   `paramSpec` output before wiring (Stage 1 prerequisite — investigate
   at Stage 1 kickoff).

---

# v2 — Native Render Pipeline

> **Status:** v2 planning kicked off 2026-04-28 (post v1 stage 11 ship).
> Pre-render rollback anchor: tag `pre-native-rig-render` on the
> commit that follows this section's authoring.

## Goal (one-liner)

The SS viewport renders **Cubism-equivalent live preview**: meshes
deform in real time as the user drags parameter sliders (head turn, body
sway, blink, breath, mouth shape, variant fade, hair sway, …) — driven
by the **same RigSpec** the export pipeline already produces.

**Acceptance criterion.** Side-by-side: SS viewport on the left, Cubism
Viewer loading the same project's exported `.moc3` on the right. Drag
the same parameters in both. Visual motion matches to the naked eye on a
reference rig (Hiyori). No pixel-perfect requirement, no automated diff
harness in v2 v1.

## Non-goals

* **Not a Cubism Editor clone.** No timeline editing, no motion
  authoring, no physics field drag-edit, no in-viewport keyform painting.
* **Not a drop-in replacement for Cubism Viewer in production QA.**
  Naked-eye parity is enough; pixel-diff isn't a v2 requirement.
* **Not v3 (live mesh editing with deformation feedback).** v3 = "I edit
  a vertex and immediately see how it deforms across all keyforms." v2
  ends one step before that — meshes are read-only inputs to the
  evaluator.
* **No WebGPU.** WebGL2 stack stays. The existing `partRenderer.js`
  `uploadPositions(partId, verts, uvs)` already does per-frame vertex
  buffer updates (used by blendShapes + puppetWarp); v2 plugs into the
  same path.
* **Not migrating to a worker thread.** Schemas are worker-transferable
  (plain JSON RigSpec, plain object paramValues), but v2 keeps the
  evaluator on main thread. Move later if profiler demands it.

## Architectural anchor — RigSpec is still the contract

The export pipeline today produces a `RigSpec` object via
`generateCmo3({...rigOnly:true})`. That object captures *every* deformer
keyform, art-mesh keyform, parent chain, parameter binding the writers
need. **v2's evaluator consumes the same RigSpec.** No new data model.

The de-risking logic is symmetric to v1's "writers are byte-stable"
property:

```
        RigSpec
       /        \
      v          v
  cmo3writer    v2 evaluator (NEW)
  moc3writer
  physics3json
```

If the writers (already byte-equivalent to Cubism Editor's compile per
[RUNTIME_PARITY_PLAN.md](RUNTIME_PARITY_PLAN.md)) and the evaluator
both consume the same spec, divergence is structurally bounded to "the
evaluator misinterprets a field." Visual parity against Cubism Viewer
catches that.

## RigSpec acquisition — cache in session, do NOT persist

### The gap discovered during v2 planning

v1 persisted only **warp deformer keyforms** (`project.faceParallax`
[Stage 4], `project.bodyWarp` [Stage 10], `project.rigWarps` [Stage 9b]).
Three other categories remained as generator output, recomputed inside
[`cmo3writer.js`](../../src/io/live2d/cmo3writer.js) every export:

* **Rotation deformer keyforms.** Group rotations + face rotation,
  built in the deferred rotation block (line ~1640).
* **Art-mesh keyforms.** Eye closure, neck corner shapekeys,
  bone-baked rotation, variant fade, base fade — all decided by the
  `hasBakedKeyforms` / `hasEyelidClosure` / `hasNeckCornerShapekeys` /
  `hasBaseFade` / `hasEyeVariantCompound` branches at lines 1017–1071,
  with vertex deltas computed inline at lines 3414–3835.
* **Parts hierarchy + draw order.** Computed every export from
  `project.nodes` + groupings.

So v2 **cannot** read a complete RigSpec from `project.*` alone.

### Decision — cache, not persist (Path B)

Three paths considered:

* **A. Persist the gap.** Add v1 stages for rotation deformer +
  art-mesh keyforms + parts hierarchy persistence before v2 ships
  evaluators. ~3 new v1 stages of work, plus all the staleness +
  signatureHash footguns those bring.
* **B. Cache RigSpec in editor session, not persisted.** New
  `useRigSpecStore` Zustand slice holding `{ rigSpec | null }`. Built
  once via `initializeRigFromProject(...)` (the existing seeder path
  already produces a full RigSpec) on project load + on explicit
  invalidation events (PSD reimport, mesh edit, tag change). Eval
  reads from the cache. No persistence model change. **Chosen.**
* **C. Path B now, persist later** if staleness becomes painful.

Path B keeps v1's "persist what user might edit" symmetric: if the user
doesn't edit rotation deformers in v1, there's no reason to round-trip
them through `.stretch`. The auto-rig is the source of truth for those
fields, and re-running the seeder is cheap (one-shot rigOnly export
takes <1s on Hiyori-sized rigs in the dev env).

**Implication.** v2 R1 ships the cache before any evaluator stage —
without it, no evaluator has data to read.

### Two structural gaps R1 must close

Reconnaissance after the initial Path-B decision exposed two issues
that the Stage R1 design must address concretely:

**Gap 1 — `initializeRigFromProject` discards `result.rigSpec`.** The
existing function in [`initRig.js`](../../src/io/live2d/rig/initRig.js)
only returns `{faceParallaxSpec, bodyWarpChain, rigWarps, debug}`
extracted by `harvestSeedFromRigSpec(...)`. The full RigSpec built
inside `generateCmo3` rigOnly mode is throw away at line 144. **R1
must either** (a) change `initializeRigFromProject` to additionally
return `result.rigSpec`, or (b) add a parallel `harvestFullRigSpec`
function. Option (a) is a minimal API extension; chosen.

**Gap 2 — `rigCollector.artMeshes` is never populated.** The
`rigCollector` aggregates rotation deformers (line 1795) and warp
deformers (lines 3098/3138) but no `rigCollector.artMeshes.push(...)`
exists in `cmo3writer.js`. Art-mesh keyform logic lives in TWO
parallel implementations: cmo3's per-mesh emit loop (lines 1017-1071
guards + 3414-3835 keyform compute, inline mixed with XML) and
moc3writer's `meshBindingPlan` builder (lines 513-624, ~110 LOC of
clean per-mesh keyform decision logic). **Neither persists to RigSpec.**

R1 must add art-mesh keyform population. Two sub-options:

* **R1.a** Modify `cmo3writer.js` to also push art-mesh keyforms
  into `rigCollector.artMeshes` during rigOnly mode. ~80 LOC of
  additive change inside the emit loop (compute already happens; we
  just don't store the result in rigSpec). Touches a 4292-LOC
  sensitive file but additively — every existing path keeps working.
* **R1.b** Extract `moc3writer`'s `meshBindingPlan` builder (lines
  513-624) into a shared module `runtime/buildArtMeshSpecs.js`. Both
  moc3writer and v2 R1 call it. ~110 LOC extraction + small refactor
  to moc3writer's call site. Cleaner architecturally; a touch riskier
  because moc3writer is the hot path for runtime export.

**Decision: R1.a.** Cmo3writer emits the cmo3 XML which is the
authoritative ground truth (already byte-diffed against Cubism Editor
per RUNTIME_PARITY_PLAN); pushing into rigCollector during the same
loop is structurally minimal. moc3writer's `meshBindingPlan`
re-derives the same data from project state — eventually that
duplication should collapse, but not as part of v2 R1.

## Architecture (concrete file layout)

```
src/io/live2d/runtime/             ← NEW; cohesive with rig/ + rigSpec.js
  evaluator/
    cellSelect.js                  ← N-binding cross-product cell + lerp weights
    warpEval.js                    ← bilinear FFD on warp grids
    rotationEval.js                ← rotation deformer → 3×3 mat at param values
    artMeshEval.js                 ← art-mesh keyform interp (verts + opacity + drawOrder)
    frameConvert.js                ← canvas ↔ deformer-local (forward + inverse)
    chainEval.js                   ← walk parent chain, compose all deformers
  evalLoop.js                      ← top-level driver: rigSpec + paramValues → Map<partId, deformedVerts>
  physicsTick.js                   ← Cubism pendulum integrator (Stage R9)

src/store/
  paramValuesStore.js              ← NEW; plain object {paramValues: {[id]:number}}
  rigSpecStore.js                  ← NEW; cached rigSpec + invalidation actions

src/components/parameters/
  ParametersPanel.jsx              ← extend (currently read-only) with sliders

src/components/canvas/CanvasViewport.jsx
  ← insert evalLoop call between line 396 and line 403
  ← add useEffect dirty-tag on paramValues + rigSpec store subscriptions

src/renderer/scenePass.js          ← R7: generalize hardcoded iris/eyewhite stencil

scripts/
  test_cellSelect.mjs              ← R2
  test_warpEval.mjs                ← R3
  test_rotationEval.mjs            ← R4
  test_artMeshEval.mjs             ← R5
  test_chainEval.mjs               ← R6
  test_physicsTick.mjs             ← R9
```

`runtime/` lives **inside** `io/live2d/` rather than as a sibling
`src/runtime/` directory because the evaluator is part of the Live2D
toolchain (consumes RigSpec types defined in `io/live2d/rig/rigSpec.js`,
mirrors the math the writers translate to disk). The renderer
(`src/renderer/`) is the consumer of the evaluator output, not part of
it.

## paramValues data shape

```js
useParamValuesStore = create(set => ({
  paramValues: {},                    // {[paramId]: number}, plain object for cheap immutable ops
  setParamValue: (id, val) => set(s => ({
    paramValues: { ...s.paramValues, [id]: val }
  })),
  resetToDefaults: (paramSpecList) => set({
    paramValues: Object.fromEntries(paramSpecList.map(p => [p.id, p.default]))
  }),
  setMany: (entries) => set(s => ({ paramValues: { ...s.paramValues, ...entries } })),
}));
```

**Plain object, not `Map`.** Zustand uses immutable references for
change detection; `{...obj, [id]: val}` is the idiomatic pattern.

**Volatile session state, not persisted.** Behaves like
`editor.view.zoom` — resets to defaults on project load. Auto-init from
`project.parameters[i].default` when rigSpec is built.

**Default values come from `rigSpec.parameters[i].default`** — NOT
from `project.parameters[i].default`. `project.parameters` is empty
on fresh PSD imports until "Initialize Rig" runs (per v1 Stage 1b
read-only design). The rigSpec built by R1 always carries a populated
`parameters[]` array (built by `paramSpec.js::buildParameterSpec`).
`useRigSpecStore` build action triggers
`useParamValuesStore.resetToDefaults(rigSpec.parameters)` after
`initRig` completes, so the viewport always shows the rest pose
unless the user moved a slider.

## Stages

Restructured by **dependency**, not by subsystem. Math stages (R2–R5)
are pure JS with unit tests but no visible demo individually — the
viewport doesn't move until R6 chains them together. R0–R1 are infra.

| Stage | Goal | Files | Demo on completion | Risk |
| --- | --- | --- | --- | --- |
| **R0** | Plumbing smoke test. paramValues store + dirty-tag + minimal slider in ParametersPanel + integration with CanvasViewport tick. Hardcoded "slider value × 50 → translate one selected mesh." Proves wiring without any evaluator. | `paramValuesStore.js`, `CanvasViewport.jsx`, `ParametersPanel.jsx` | Drag the dummy slider, watch one mesh slide horizontally. | Low — pure plumbing. |
| **R1** | RigSpec session cache. Three sub-tasks: (a) extend `initializeRigFromProject` to also return `result.rigSpec` — currently discarded at L144; (b) add `rigCollector.artMeshes.push(...)` in cmo3writer's per-mesh emit loop so the rigSpec carries art-mesh keyforms (eye closure, variant fade, base fade, bone-baked); (c) `useRigSpecStore` Zustand slice + `buildRigSpec(project)` action + invalidation hooks (mesh edit / tag change / PSD reimport / "Initialize Rig" click). | `initRig.js`, `cmo3writer.js`, `rigSpecStore.js`, `projectStore.js` | DevTools: `useRigSpecStore.getState().rigSpec` returns a populated RigSpec with `warpDeformers` + `rotationDeformers` + `artMeshes` + `parameters` all populated after project load. | Medium — touches cmo3writer additively. |
| **R2** | `cellSelect(bindings, paramValues) → {indices[2^N], weights[2^N]}`. Pure JS, comprehensive unit tests for 1D/2D/3D bindings, edge cases (param at exact key, param outside range, single-keyform deformer). | `runtime/evaluator/cellSelect.js`, `scripts/test_cellSelect.mjs` | Tests pass; nothing visible. | Low — pure math. |
| **R3** | `warpEval(spec, cellInfo) → deformedGrid` (bilinear FFD on warp grid baseGrid + N-cell lerp). Plus `frameConvert.js`: forward (`canvasToLocal`) and inverse (`localToCanvas`) for `'canvas-px'`/`'normalized-0to1'`/`'pivot-relative'` localFrame. | `runtime/evaluator/warpEval.js`, `runtime/evaluator/frameConvert.js`, `scripts/test_warpEval.mjs` | Tests pass; nothing visible. | Medium — frame conversion has 3 cases per spec; pivot semantics in rotation→warp transitions need careful spec. |
| **R4** | `rotationEval(spec, cellInfo) → mat3` — interp angle/origin/scale across cells, compose `T(origin) × R(angle) × S(scale) × T(-origin)`. | `runtime/evaluator/rotationEval.js`, `scripts/test_rotationEval.mjs` | Tests pass; nothing visible. | Low-Medium — math is small. |
| **R5** | `artMeshEval(spec, cellInfo) → {vertexOffsets, opacity, drawOrder}` — N-cell lerp on per-keyform vertex offset arrays + scalar opacity + scalar drawOrder. | `runtime/evaluator/artMeshEval.js`, `scripts/test_artMeshEval.mjs` | Tests pass; nothing visible. | Low — pattern mirrors blendShapes loop in CanvasViewport.jsx:336. |
| **R6** | **Chain composition + first visible demo.** `chainEval.js`: walk a mesh's parent chain (BodyZ → BodyY → Breath → BodyX → optional FaceParallax → optional FaceRotation → optional rigWarp → mesh), apply each deformer in turn, output canvas verts. `evalLoop.js`: top-level driver running per-frame in CanvasViewport tick. ParametersPanel scrubber for ~5 standard params (ParamAngleX/Y/Z, ParamBodyAngleX/Y/Z, ParamEyeLOpen, ParamEyeROpen, ParamMouthOpenY). Hook into existing `poseOverrides.mesh_verts` upload path **and** refactor blendShape loop ([CanvasViewport.jsx:357](../../src/components/canvas/CanvasViewport.jsx#L357)) to read from existing `mesh_verts` (like puppetWarp does at L390) instead of always starting from rest, so v2 evaluator output composes correctly with blendShape/puppetWarp instead of being overwritten. **Side-by-side visual gate against Cubism Viewer on Hiyori.** | `runtime/evaluator/chainEval.js`, `runtime/evalLoop.js`, `CanvasViewport.jsx`, `ParametersPanel.jsx` | Drag ParamAngleX in SS — face turns. Drag ParamBodyAngleX — body sways. Blink works. Visual match against Cubism Viewer to the naked eye. | **HIGH** — the dependency graph all converges here. Frame-conversion edge cases surface. |
| **R7** | Mask system generalization. Replace hardcoded iris/eyewhite stencil in `scenePass.js` with `Map<partId, stencilValue>` allocated from `maskConfigs`. 8-bit stencil = up to 255 mask groups. | `scenePass.js` | Custom mask configs in `maskConfigs` (e.g. headwear masking back-hair) work without code changes. | Low — ~50 LOC change, isolated to renderer. |
| **R8** | Full param scrubber UI. Extend ParametersPanel: slider per param organised by group (LipSync/EyeBlink/Body/Face/Variant/Bone), keyboard shortcuts, "Reset to default", group collapse/expand. Variant slider triggers visible variant fade. | `ParametersPanel.jsx`, possibly extracted into a multi-file UI module | Polished param-control UX. | Low — UI work over already-functional eval. |
| **R9** | Physics tick — Cubism pendulum integrator. **Port from cubism-web SDK** (open-source TypeScript runtime), not from-scratch. Inputs: `physicsRules` from `useRigSpecStore`. Output: writes back into `useParamValuesStore` for downstream params (hair sway, clothing, arm physics). Driven by main eval loop with fixed-dt integration. | `runtime/physicsTick.js`, `evalLoop.js` | Hair/clothes auto-sway under body motion, no direct user input. | **MEDIUM** — port from cubism-web SDK reference; risk concentrated in our own physics3 schema mapping rather than physics math itself. |
| **R10** | Performance. Profile, then targeted wins: dirty-flag eval (skip if no param changed), bbox cull (skip evaluators whose meshes are off-screen), mat3 reuse, Float32Array pooling. If main thread still saturated, port `warpEval` to vertex shader (GPU-side bilinear FFD). | `evalLoop.js`, possibly new `runtime/glEvaluator.js` | 60 fps stable on Hiyori-sized rig with all params animating. | Med — premature-opt trap; measure before optimising. |

## Milestones

* **Milestone D — Visible viewport (R0–R6).** First moment v2 is
  user-facing. Face turns, body sways, blink works. The single biggest
  user-visible win in the entire native rig refactor.
* **Milestone E — Full rig (R7–R8).** Masks generalised, full param
  scrubber. After E, "Cubism Viewer not needed for live preview" is
  true for static-pose work.
* **Milestone F — Physics + perf (R9–R10).** Hair/clothes auto-sway,
  60fps target. Production-grade.

## Risks (the real ones)

1. **Frame conversion correctness in chain composition (R6).** Three
   `localFrame` types (`canvas-px` / `normalized-0to1` / `pivot-relative`)
   with non-trivial transitions (rotation→warp must convert
   pivot-relative offsets to normalized-0to1 of the warp grid). Writer
   side already handles this — see [reference_cubism_deformer_local_frames](memory)
   note. **Mitigation:** dedicated `frameConvert.js` module in R3, unit
   tests for every transition pair, side-by-side visual diff in R6.
2. **Physics fidelity (R9).** Cubism's pendulum semantics aren't
   formally documented but **the cubism-web SDK is open source** and
   has the exact runtime physics implementation in TypeScript. R9
   ports from there rather than reimplementing. **Mitigation:** R9
   is still the LAST stage so Milestones D + E ship without physics
   risk; the port itself is a focused effort, not exploration. Iterate
   against [reference_alexia_arm_physics](memory) transcription as
   sanity check.
3. **Performance under heavy rigs.** 50+ meshes × N keyforms × M params
   × per-frame eval on main thread. Naive estimate: 10–50ms per frame
   on Hiyori-sized rig. **Mitigation:** R10 first measures, then
   optimises in priority order: dirty-flag → bbox cull → typed-array
   pool → vertex-shader port. The shader port unblocks even pathological
   rigs.
4. **No automated parity harness.** Regressions in evaluator math could
   slip past visual side-by-side review. **Mitigation:** post-Milestone
   D, ship a numeric snapshot harness — store `{rigId, paramValues, expectedVerts}`
   fixtures, evaluator runs against them, JSON diff in CI. Optional
   stretch: parallel-run cubism-web SDK as ground truth oracle.
5. **rigSpec staleness in cache.** PSD reimport / mesh edit silently
   invalidates cached rigSpec. **Mitigation:** R1 wires invalidation
   hooks into the relevant projectStore actions. Worst case is a stale
   render until next user-triggered "Rebuild rig" — not a correctness
   bug, just a visible-staleness UX bug.
6. **Mesh ID matching: `node.id` ↔ `rigSpec.artMeshes[i].id`.**
   cmo3writer often uses sanitized names (e.g. `ArtMesh3` or part name
   sanitised) for spec IDs while SS uses stable node IDs (e.g.
   `psd_face_001`). The evaluator needs a reliable mapping
   `partId → rigSpec.artMeshes[index]` to upload deformed verts to
   the right node. **Mitigation:** during R1's artMesh push into
   rigCollector, store `nodeId` alongside (or as) the spec id —
   `cmo3writer.js` already has the `m.partId` in scope at every emit
   site. Concrete invariant for R1: every `rigSpec.artMeshes[i]`
   carries `partId` referring to a node in `project.nodes`.

## Reference parity strategy

* **R0–R5: unit tests.** Pure-math stages are testable in isolation
  with hand-crafted fixtures (single-keyform warp at known param
  values, etc.). No reference rig needed.
* **R6: visual side-by-side gate.** SS viewport on the left, Cubism
  Viewer with same exported `.moc3` on the right. Drag matching
  parameters, watch motion. Pass = naked-eye match. Fail = math bug,
  iterate. This is the gate that lets R6 ship.
* **R7–R10: visual side-by-side per stage.** Cubism Viewer remains the
  ground truth. Add the numeric harness at any point if visual gates
  miss too much.

This is honest scope. v2 v1 ships **without** an automated parity
harness against Cubism. Auto-harness is a stretch goal *for v2 v2*.

## Per-stage protocol

Same shape as v1 stages but acceptance changed from "diff harness
green" to "visual side-by-side green":

1. **Spec.** Define inputs/outputs of the new module/component.
2. **Pure unit tests.** Math is testable without DOM/GL.
3. **Integration.** Wire into evalLoop + dirty-tag.
4. **Visual smoke test.** Side-by-side against Cubism Viewer on
   Hiyori for any stage that produces visible output (R0, R6, R7, R8,
   R9). Math-only stages (R1–R5) skip this.
5. **Doc.** Update this section's stage table with status + concise
   summary.
6. **Tag.** `native-rig-render-stage-RN-complete`.

A stage is **not done** until all six are green. Don't ship math
modules without their unit tests; don't ship visible stages without
side-by-side gating.

## Estimated scope

Updated after the R1 expansion (artMesh push into rigCollector +
initRig API extension) and R6 blendShape composition refactor were
identified during double-check pass:

* **Milestone D (R0–R6):** 6–9 sessions. R1 grew (additive
  cmo3writer changes); R6 grew (blendShape composition refactor + the
  hard frame-conversion debugging).
* **Milestone E (R7–R8):** 2–3 sessions.
* **Milestone F (R9–R10):** 3–5 sessions (R9 risk dropped to medium
  because cubism-web SDK is the port reference, not from-scratch).

**Total: 11–17 sessions** for full v2. Comparable to v1's 15-stage
arc. Roughly 2–3 months of focused autonomous work.

## Open questions for R0/R1 kickoff

1. **`useParamValuesStore` location.** New top-level store vs slice in
   `useEditorStore`. **Decided:** new top-level store (cleaner
   separation, auto-init triggers from rigSpec, scrubber UI is its
   primary consumer).
2. **rigSpec rebuild triggers.** Which projectStore actions invalidate?
   **Decided for R1:** mesh edit (vertex move, retriangulate),
   `applyRig` wizard, PSD reimport, "Initialize Rig" button click.
   Conservatively over-invalidate at first; tighten if rebuild becomes
   a perf issue.
3. **Eval frequency.** Run on every rAF or only when paramValues /
   rigSpec dirty? **Decided:** dirty-gated (matches existing rAF tick
   pattern in CanvasViewport). If no param moves, no eval, no upload.
4. **Editor mode integration.** Always-on (staging + animation modes)
   or new "preview" mode? **Decided:** always-on. With paramValues all
   at default, evaluator output ≈ rest pose, so existing render path
   handles the no-op case naturally. Animation mode's keyframe-driven
   `poseOverrides` and v2's evaluator output coexist (animation drives
   transforms, evaluator drives mesh_verts — orthogonal axes).
