# Native Rig Refactor — Plan

## Status

Living tracker. Update on every stage transition.

| Stage | Description | Status |
| --- | --- | --- |
| 0 | Diff harness foundation (canonicalizer + structural diff) | **shipped** — `scripts/native-rig-diff/`, 34 unit tests, `npm run test:diff-harness` |
| 0.5 | Schema versioning + migration scaffold | **shipped** — `src/store/projectMigrations.js`, 25 unit tests, `npm run test:migrations` |
| 1a | Parameters — native rig fork + seeder + equivalence tests | **shipped** — `paramSpec.js` fork, `seedParameters()`, `useProjectStore.seedParameters` action, 21 tests, `npm run test:paramSpec`. UI deferred to 1b. |
| 1b | Parameters UI panel + delete protection | not started |
| 2 | autoRigConfig (seeder tuning surface) | not started |
| 3 | Mask configs | **shipped** — `src/io/live2d/rig/maskConfigs.js` (`CLIP_RULES` + `seedMaskConfigs` + `resolveMaskConfigs`), schema bumped to v2 with migration, both writers fork on `maskConfigs` arg, 25 tests, `npm run test:maskConfigs`. |
| 4 | Face parallax | not started |
| 5 | Variant fade rules + eye closure config | not started |
| 6 | Physics rules | **shipped** — `src/io/live2d/rig/physicsConfig.js` (`DEFAULT_PHYSICS_RULES` + `seedPhysicsRules` + `resolvePhysicsRules`). Schema v3. Both `cmo3/physics.js` and `physics3json.js` refactored to consume pre-resolved rules (boneOutputs flattened at seed time). 83 tests, `npm run test:physicsConfig`. |
| 7 | Bone config | not started |
| 8 | Rotation deformers (keyforms) | not started |
| 9 | Tag warp bindings (keyforms — biggest stage) | not started |
| 10 | Body warp chain (keyforms) | not started |
| 11 | Final cleanup (remove generator branches) | not started |

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

#### Stage 1b — Parameters UI + delete protection

Stage 1 was originally bundled with UI work. Splitting it out — the data
layer (1a) is what unblocks downstream stages; the UI is independent.

* Minimal Parameters panel (read-only list with name/min/max/default).
* "Re-seed parameters" button + confirmation dialog when seeded data
  exists.
* `project.parameterGroups` for LipSync / EyeBlink / palette ordering
  (currently auto-discovered by tag scan in cdi3 emission).
* **Delete protection** (per "Cross-cutting invariants → ID stability").
  Standard params (22 baked-in IDs) cannot be deleted via UI. Custom
  params (variant, bone-rotation, project-added) prompt with a list of
  referencing animation tracks + physics rules before deletion.

**Files:** new `src/components/parameters/ParametersPanel.jsx`,
integration into `EditorLayout`. **Risk:** low — UI work, no data-layer
risk now that 1a is in.

#### Stage 2 — autoRigConfig (seeder tuning surface)

Centralise scattered magic constants (`HIP_FRAC`, `FEET_FRAC`, `FP_DEPTH_K`,
`NECK_TILT_FRAC`, per-tag warp magnitudes, etc.) into one project-level
field that the seeder reads. Generator code switches from inline literals
to `autoRigConfig.bodyWarp.hipFrac` etc.

This stage is **schema + plumbing only** — no behaviour change. It
unblocks the per-character tuning that motivates Stage 4 and Stage 6.
Default values match today's hardcoded literals; diff harness must stay
green with no edits to the config.

**Files:** scattered (`bodyWarp.js`, `faceParallax.js`, `cmo3writer.js`
TAG_PARAM_BINDINGS, etc.); a new `src/io/live2d/rig/autoRigConfig.js`
defining defaults.
**Risk:** low-medium — purely mechanical refactor, large surface.

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

Numeric face-parallax tuning (`FP_DEPTH_K`, `FP_MAX_ANGLE_X_DEG`,
`FP_MAX_ANGLE_Y_DEG`, face pivot override). After Stage 2, most of these
values *already* live in `autoRigConfig`. This stage moves the resulting
warp+rotation specs into `project.faceParallax`.

**Files:** `src/io/live2d/cmo3/faceParallax.js`, `cmo3writer.js`.
**Risk:** medium-low.

#### Stage 5 — Variant fade rules + eye closure config

Tag-gated heuristics (`BACKDROP_TAGS_SET`, `EYE_CLOSURE_TAGS`,
`EYE_CLOSURE_LASH_STRIP_FRAC`) become explicit project config.

**Files:** variant fade emission across `cmo3writer.js`; eye closure
extraction.
**Risk:** medium — touches the variant system covered by several memory
notes. Verify against `feedback_variant_plateau_ramp` and
`feedback_no_sharing_eye_2d_grid` invariants.

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

Baked keyform angle set ([-90, -45, 0, 45, 90]°), physics-output bone
list, baked keyform parameters per bone.

**Files:** bone keyform generation in `cmo3writer.js`,
`rotationDeformers.js`.
**Risk:** low — small surface, mostly numeric.

---

### Milestone C — Keyform-bearing subsystems

These store per-vertex deltas across N keyforms. The seeder runs
`shiftFn` and bakes outputs (see "Architectural decision: precompile" in
Goal). Diff harness needs float tolerance here.

#### Stage 8 — Rotation deformers

Per-group rotation deformer keyforms ([rotationDeformers.js](../../src/io/live2d/rig/rotationDeformers.js))
move into `project.rotationDeformers[]`. Already partially structured by
`rigSpec`.

**Files:** `rig/rotationDeformers.js`, both writers.
**Risk:** medium — float precision in keyform data.

#### Stage 9 — Tag warp bindings (the big one)

20+ tag entries in
[TAG_PARAM_BINDINGS](../../src/io/live2d/cmo3writer.js#L2202) (front
hair, back hair, topwear, brows, irides, mouth, etc.). Seeder invokes
`shiftFn` per tag, bakes vertex deltas into stored keyforms.

* `project.tagWarpBindings[]` schema = list of `{deformerId, paramId,
  keyforms: [{paramValue, vertexDeltas: Float32Array}]}`.
* `shiftFn` lives only in the seeder. Disappears from the runtime path
  after seed.
* Per-tag re-seed surface: pick a tag, change `autoRigConfig.tagWarpMagnitudes[tag]`,
  click "Re-seed `<tag>`".

**Files:** big surface across `cmo3writer.js` (TAG_PARAM_BINDINGS map),
`moc3writer.js`.
**Risk:** highest. Most likely site for float drift; do per-tag
substages (one tag at a time) if needed.

#### Stage 10 — Body warp chain

4-warp BZ → BY → Breath → BX chain in
[bodyWarp.js](../../src/io/live2d/rig/bodyWarp.js).

* `project.bodyWarp` = chain of `WarpDeformerSpec` with baked keyforms.
* `canvasToBodyXX/Y` normalisers stored as serialisable helpers (or
  pure functions of canvas size + body anatomy frozen at seed time).

**Files:** `bodyWarp.js`, both writers.
**Risk:** medium-high — float drift, body anatomy depends on `bodyAnalyzer`
which inspects mesh geometry; seed-time freeze is essential.

---

### Stage 11 — Final cleanup (post-migration)

* Remove the generator branches from the export orchestrator. Generator
  code reachable only via the seeder.
* Garbage-collect `rigOnly=true` mode from `cmo3writer` if no longer used.
* Update `RUNTIME_PARITY_PLAN.md` to mark the native path as canonical.

**Files:** `exporter.js`, `cmo3writer.js`. **Risk:** none if all earlier
stages green.

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
