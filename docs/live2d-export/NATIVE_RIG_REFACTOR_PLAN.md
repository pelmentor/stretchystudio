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
