# Project Data Layer

Living document. Tracks what fields belong on the canonical project data layer
(the `project.*` object that `saveProject`/`loadProject` round-trips), where
gaps exist between "seeded into project" and "persisted to .stretch", and the
migration plan for closing those gaps.

This is the foundation for [GAP-011](FEATURE_GAPS.md#gap-011) (project as
true source of truth). The [CUBISM_WARP_PORT](live2d-export/CUBISM_WARP_PORT.md)
oracle-diff test ([`scripts/cubism_oracle/diff_v3_vs_oracle.mjs`](../scripts/cubism_oracle/diff_v3_vs_oracle.mjs))
ships its own programmatic rigSpec build path via `cmo3Import → initializeRigFromProject`
in Node, so it doesn't depend on save/load round-trip parity — but a future
version that loads a `.stretch` project file directly would benefit from
the data-layer holes being closed.

## Status snapshot (2026-05-02)

9 of 10 integrity holes have detection-side defences shipped (Phase A); I-2
(binding param schema fingerprint) deferred — needs the parameter editor UI
surface. Phase B follow-ups (UI delete-confirm, "preserve customisations"
re-init, parameter editor surfaces) gate on the broader
`project_v3_rerig_flow_gap` UI work.

| Hole | Status | What ships |
|------|--------|------------|
| ✅ I-1  | Phase A shipped | `meshSignature` module + per-mesh fingerprint at seed |
| 🟡 I-2  | Open (deferred) | binding param schema fingerprint — needs param editor UI |
| ✅ I-3  | Phase A shipped | `paramReferences` orphan detection at seedAllRig |
| ✅ I-4  | Phase A shipped | `variantNormalizer` rename-detected-as-removal warn |
| ✅ I-5  | Phase A shipped | `seedAllRig` walks `mesh.jointBoneId` orphans |
| ✅ I-6  | Phase A shipped | `seedAllRig` walks `physicsRules.outputs` orphans |
| ✅ I-7  | Closed | `resolveAutoRigConfig` per-field spread merge over defaults |
| ✅ I-8  | Closed | `lastInitRigCompletedAt` ISO marker (replaces heuristic) |
| ✅ I-9  | Closed | `{strict:true}` opt-in for save/load |
| ✅ I-10 | Phase A shipped | `<StaleRigBanner>` + load/reimport hooks + Logs warns |

---

## The strategic problem

Stretchy Studio's value prop: "auto-rig is good enough, AND when it isn't you
can edit on top, AND you can flip between the two cleanly". This depends on
a single invariant:

> **The project file is the canonical source of truth.** Everything visible
> in the editor, everything used by the export pipeline, lives in
> `project.*`. Save then reload reproduces the editing context exactly.
> Re-running Init Rig only re-derives fields the user hasn't customised.

Currently this invariant is **partially broken**. Some fields are seeded by
`Init Rig` but lost when the user saves the project to disk and reloads it,
which silently downgrades the export pipeline from "use my edits" to
"auto-regenerate from heuristics" without warning.

This doc enumerates exactly which fields are affected.

---

## Audit (2026-05-01)

### Tier 1 — Persisted, exported, edited (works correctly)

These fields survive save/load and the export pipeline reads them. User
edits to these flow through correctly; auto-regenerate paths fall back to
defaults when fields are absent. **No work needed.**

| Field | Schema | Seeder | Saved by `saveProject` | Resolver | Notes |
|-------|--------|--------|------------------------|----------|-------|
| `canvas` | inline | always | ✅ | direct read | width/height/bgColor |
| `textures` | `[{id, source}]` | PSD import | ✅ (with PNG blobs) | direct read | Source-of-truth for texture data |
| `nodes` | flat array w/ mesh + boneWeights + blendShapes | PSD import | ✅ | direct read | Largest field |
| `animations` | array | user actions | ✅ (with audio blobs) | direct read | |
| `parameters` | `[{id, name, min, max, default, tag}]` | `seedParameters` | ✅ | `paramSpec.buildParameterSpec(project)` | Falls back to STANDARD_PARAMS + tag discovery if empty |
| `physics_groups` | array | (legacy?) | ✅ | direct read | |
| `maskConfigs` | array of mask pairings | `seedMaskConfigs` | ✅ | `resolveMaskConfigs(project)` | Falls back to inline `CLIP_RULES` |
| `physicsRules` | array of pendulum chains | `seedPhysicsRules` | ✅ | `resolvePhysicsRules(project)` | Falls back to `DEFAULT_PHYSICS_RULES` |
| `boneConfig` | `{bakedKeyformAngles: number[]}` | `seedBoneConfig` | ✅ | `resolveBoneConfig(project)` | Falls back to `[-90,-45,0,45,90]` |
| `variantFadeRules` | `{backdropTags: string[]}` | `seedVariantFadeRules` | ✅ | `resolveVariantFadeRules(project)` | Falls back to default backdrops |
| `eyeClosureConfig` | `{closureTags, lashStripFrac, binCount}` | `seedEyeClosureConfig` | ✅ | `resolveEyeClosureConfig(project)` | Tunables only — actual parabola fits NOT stored (see Tier 3) |
| `rotationDeformerConfig` | `{skipRoles, deformerAngleMin/Max, paramKeys, angles}` | `seedRotationDeformerConfig` | ✅ | `resolveRotationDeformerConfig(project)` | Falls back to defaults |

### Tier 2 — **Seeded but NOT saved** (silently lost on save→load) ⚠️

These fields ARE populated by `seedAllRig` after Init Rig, AND they're read by
the export pipeline. But [`saveProject`](../src/io/projectFile.js) does not
include them in the saved JSON, so they vanish on the next reload. After
reload, `exporter.js`'s `anySeeded` check (`faceParallaxSpec !== null ||
bodyWarpChain !== null || rigWarps.size > 0`) returns false and the pipeline
falls through to a fresh `initializeRigFromProject` heuristic harvest —
**effectively becoming the auto-regenerated path**. The user's customisations
made via UI editors don't make it across reload.

This is the primary "stretchy studio data layer doesn't work as Cubism" gap.

| Field | Schema | Populated by | Read by | Save status |
|-------|--------|--------------|---------|-------------|
| `autoRigConfig` | three sections (bodyWarp/faceParallax/neckWarp tunables + tagWarpMagnitudes) | `seedAutoRigConfig` | `resolveAutoRigConfig` (consumed by ALL warp/parallax builders) | ❌ NOT SAVED |
| `faceParallax` | full WarpDeformerSpec (id, parent, gridSize, baseGrid, bindings, keyforms with positions) | `seedFaceParallax` from `harvest.faceParallaxSpec` | `resolveFaceParallax(project)` → exporter feeds to cmo3writer/moc3writer | ❌ NOT SAVED |
| `bodyWarp` | array of 3-4 WarpDeformerSpec entries + layout block (BZ/BY/BR/BX bbox + slopes) | `seedBodyWarpChain` from `harvest.bodyWarpChain` | `resolveBodyWarp(project)` → exporter feeds to cmo3writer/moc3writer | ❌ NOT SAVED |
| `rigWarps` | per-mesh map keyed by partId (each value is a WarpDeformerSpec for hair/clothing/etc.) | `seedRigWarps` from `harvest.rigWarps` Map | `resolveRigWarps(project)` → exporter feeds to cmo3writer/moc3writer | ❌ NOT SAVED |

**Concrete reproduction:**

1. Open shelby_neutral_ok.psd
2. Click Init Rig — `project.faceParallax/bodyWarp/rigWarps/autoRigConfig` are populated in memory
3. Export `.cmo3` — uses seeded data ✅ (correct, matches Cubism Editor's output)
4. Save project as `.stretch`
5. Close app, reload `.stretch`
6. Export `.cmo3` — falls back to fresh harvest. **Visually different output.**

The issue is exactly that "step 6 produces different output than step 3" even though the user changed nothing. Steps 4-5 silently zero out the rig data that step 3 was using.

### Tier 3 — Re-derived at export time, never persisted

These are computed each export from inputs that DO persist. They're
deterministic, so the round-trip behaviour is correct as long as the inputs
don't change. Listed for awareness; not bugs unless the user wants to
manually override.

| Output | Re-derived from | Edit surface |
|--------|-----------------|--------------|
| Eye closure parabolas | `eyeClosureConfig` tunables + each eyewhite mesh's PNG alpha | None — to override would need parabola coefficients persisted per side |
| Bone-baked mesh keyforms | `node.mesh.boneWeights` + `node.mesh.jointBoneId` + `boneConfig.bakedKeyformAngles` | Skinning paint (when shipped) writes boneWeights → keyforms re-derive |
| Variant-suffix discovery | Node names containing `.<suffix>` (e.g. `face.smile`) | Layer rename in PSD/Outliner re-discovers |
| Drawable parent indices | Node parent chain | Reparent in Outliner persists via `nodes[].parent` |
| Texture atlas packing | All mesh UVs + textures | Genuinely export-time; fine |
| Physics output bones | `boneConfig` + node group names | Group rename re-discovers |

### Tier 4 — Live state (intentionally NOT persisted)

These live transiently in zustand stores or React state and are correctly
not part of the project file.

| State | Owner | Purpose |
|-------|-------|---------|
| `paramValues` | `useParamValuesStore` | Current scrubber values for live preview |
| Selection (active node, mode) | `useSelectionStore`, `useUiV3Store` | UI focus |
| Camera/zoom/pan | `useEditorStore` | Per-canvas viewport state |
| Logs ring buffer | `useLogsStore` | Diagnostic stream |
| `rigSpec` (built from project) | `useRigSpecStore` | Computed at runtime for chainEval |
| `versionControl` | `projectStore` | Render-pass invalidation flags |

---

## Target schema

For the data layer to be truly canonical, **every field in Tier 2 must move
to Tier 1**. The fix is mechanical: add the four fields to
[`saveProject`](../src/io/projectFile.js) lines 82-97.

```js
const projectJson = {
  version: project.version,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  canvas: project.canvas,
  textures: serializedTextures,
  nodes: serializedNodes,
  animations: serializedAnimations,
  parameters: project.parameters ?? [],
  physics_groups: project.physics_groups ?? [],
  maskConfigs: project.maskConfigs ?? [],
  physicsRules: project.physicsRules ?? [],
  boneConfig: project.boneConfig ?? null,
  variantFadeRules: project.variantFadeRules ?? null,
  eyeClosureConfig: project.eyeClosureConfig ?? null,
  rotationDeformerConfig: project.rotationDeformerConfig ?? null,
  // ── ADD ──
  autoRigConfig: project.autoRigConfig ?? null,
  faceParallax: project.faceParallax ?? null,
  bodyWarp: project.bodyWarp ?? null,
  rigWarps: project.rigWarps ?? {},
};
```

The zustand store schema already declares them (`projectStore.js` lines
122-125). Migration entries v7-v10 already handle "field exists but value
is null" on legacy saves. So the writer-side change is one-line-per-field
and the reader needs no change — old saves that don't carry these fields
get migrated to null defaults, exactly as today.

This single fix closes the round-trip gap for all existing UI customisation
surfaces. **It must ship before any new UI editor for warp/parallax/rig keyform
editing exists** — otherwise edits land into fields that disappear on save.

---

## Migration plan

### Phase A — Close the round-trip gap (the quick fix)

**Effort:** ~30 minutes incl. tests and migration safety check.

1. Add the four missing fields to `saveProject`'s `projectJson` (one-liner each).
2. Add a v12 migration entry that's a no-op for new saves and a default-to-null
   for legacy saves. (Probably already covered by v7-v10; double-check.)
3. Add a test (`test_projectRoundTrip.mjs`) that:
   - Creates a project with all Tier 2 fields populated (mock rigSpec data).
   - Calls `saveProject`, then `loadProject` on the result.
   - Asserts `loaded.faceParallax/bodyWarp/rigWarps/autoRigConfig` deep-equal
     the originals.
4. Add a test that exports `.cmo3` from a freshly-loaded `.stretch` and
   asserts the output matches the export from the same project pre-save
   (byte-equal moc3 across save/load cycle).

### Phase B — Make Tier 3 fields editable when needed (deferred)

Tier 3 is currently fine — the re-derive path is deterministic. Only worth
moving fields to Tier 1 when a UI editor for them exists. Candidate
priorities (when the rerig flow gap [`project_v3_rerig_flow_gap`] gets a
plan):

- **Eye closure parabola coefficients** — would let a user override the
  computed fit when the PNG alpha contour is bad (occluded by lash, bad
  AA, etc.). Would persist `{a, b, c}` per-side per-eye in `project.eyeClosureFits`.
- **Bone-baked keyforms manual-override** — useful if the user wants
  custom poses at specific angles (not just the linear-interpolated bake).
  Would persist per-mesh per-angle position arrays.
- **Variant-suffix override** — let the user explicitly mark a layer as a
  variant of another layer rather than relying on `.suffix` naming. Would
  persist `{nodeId, variantOf, variantSuffix}` map.

Each is its own UI feature. Don't pre-migrate without a use case.

### Phase C — Full project-file schema doc (later)

Once Phase A is in, write `docs/PROJECT_FILE_FORMAT.md` documenting the
exact JSON shape produced by `saveProject`. Useful for: third-party
tooling, version control friendliness, regression testing.

---

## Integrity gaps and known footguns

The Phase A fix closes the round-trip gap — fields persist correctly. The follow-up audit identified 10 deeper integrity holes (I-1 … I-10) where the **persisted data may still be wrong** because nothing in the system detects when the user-visible state diverges from the inputs that originally produced the seeded data.

**Phase A status (2026-05-02):** all 10 holes have detection-side defences shipped. Phase B (UI gates / delete-confirm dialogs / interactive remediation) is deferred until the relevant UI surfaces (parameter editor, bone-edit operator, group-edit operator, layer-rename op) land — those gate Phase B more than the data-layer plumbing does. See "Steps 1–7 closure plan" in the decision log below.

These are the "known footguns" originally documented module-by-module across the codebase ([rigWarpsStore.js:35-43](../src/io/live2d/rig/rigWarpsStore.js#L35), [faceParallaxStore.js:22-30](../src/io/live2d/rig/faceParallaxStore.js#L22), [bodyWarpStore.js:23-30](../src/io/live2d/rig/bodyWarpStore.js#L23), [eyeClosureConfig.js:19-22](../src/io/live2d/rig/eyeClosureConfig.js#L19), [boneConfig.js:14-19](../src/io/live2d/rig/boneConfig.js#L14), [rotationDeformerConfig.js:26-30](../src/io/live2d/rig/rotationDeformerConfig.js#L26), and the cross-cutting "ID stability" section of [NATIVE_RIG_REFACTOR_PLAN.md → Cross-cutting invariants](live2d-export/NATIVE_RIG_REFACTOR_PLAN.md#cross-cutting-invariants)) — consolidated here.

### Hole I-1 — No mesh signature hash → stale warp keyforms after PSD reimport

**Severity:** high. **Affects:** `faceParallax`, `bodyWarp`, `rigWarps`, all bone-baked mesh keyforms.

**The problem:** warp keyforms (`keyform.positions`) are stored as flat per-vertex `[x0, y0, x1, y1, …]` arrays indexed positionally to `node.mesh.vertices`. If the user reimports a PSD with a re-meshed layer (different vertex count, different geometry density, repositioned silhouette), the indexes still line up structurally but **point at wrong vertices**. The export pipeline produces a moc3 that interpolates random vertices toward the original silhouette positions — visually catastrophic but silent.

**Defence shipped 2026-05-01 (Phase A — detection):** per-mesh `signatureHash = { vertexCount, triCount, uvHash }` stored at seed time as `project.meshSignatures[partId]`. Module: [src/io/meshSignature.js](../src/io/meshSignature.js) — FNV-1a 32 over canonicalised f32 UV bytes (positional, not sorted; vertex reorder is an invalidating change). Hooked into `seedAllRig` (writes signatures after harvest), serialized via `saveProject`'s `meshSignatures` field, schema migration v12 defaults legacy saves to `{}`. `validateProjectSignatures(project)` returns `{stale, missing, unseededNew, ok}` — detection only, no auto-clear (user decides via re-Init Rig).

**Open:** Phase B — the **consumer** of the validation report (Hole I-10 banner) still needs wiring; on its own the fingerprint is recorded but nothing reads it. See I-10 for the load-time + reimport-time hook.

**Divergence from refactor plan:** plan said "sortedUVHashes". Shipped as positional UV hash because keyforms are positionally indexed; sorted hash would treat reorder-without-content-change as identical and miss real corruption. Decision recorded in [meshSignature.js JSDoc](../src/io/meshSignature.js).

**Test coverage:** `test:meshSignature` (29 cases) — determinism, vertex count change, tri count change, UV value change, positional reorder detection, edge cases, validateProjectSignatures across all 4 buckets. `test:projectRoundTrip` (23 cases, +3 over Phase A) — meshSignatures survives save/load. `test:migrations` (73 cases, +3 over Phase A) — v12 migration default + idempotence.

### Hole I-2 — No keyform-binding fingerprint → stale param wiring

**Severity:** medium. **Affects:** all `bindings` arrays inside warp/rotation/parameter records.

**The problem:** `bindings[].keys = [-30, 0, 30]` and `bindings[].parameterId = 'ParamAngleZ'` are stored verbatim. If the user later changes the parameter range (e.g. `ParamAngleZ` becomes ±45 in `project.parameters`), the binding still says `[-30, 0, 30]` — keyforms beyond ±30 just clamp at the endpoints. Or worse, if a parameter is renamed/deleted, `bindings[].parameterId` becomes a dangling reference and the deformer reads default value 0 silently.

**Defence:** at seed time, record per-binding `(parameterId, paramSchemaHash)`. On load, validate `parameterId` still exists and the schema matches. Standard parameters (the 22 baked-in IDs) are protected by UI; custom parameters (variant suffix, bone rotation) need delete-confirmation that lists references.

**Status today:** no fingerprint, no validation, no UI delete-protection mentioned for non-standard params. Manifests as "I added an emotion variant, deleted it, now my export is broken in subtle ways."

### Hole I-3 — Animation tracks reference parameters by ID, no orphan check

**Severity:** medium. **Affects:** `project.animations[].tracks[]` (motion3.json output), `bindings[].parameterId` inside warp keyforms, `physicsRules[].inputs[].paramId`.

**The problem:** Each animation track's `paramId` references a parameter by ID (e.g. `'ParamAngleX'`). If the parameter is removed (custom param deleted, or `paramSpec.requireTag` gating excludes it now that a tag is no longer present), the track becomes an orphan. Export emits the motion file with a property path that no parameter resolves — model3.json will reference a parameter that doesn't exist in moc3, and the runtime will warn or fail to load. Same applies to warp bindings and physics inputs.

**Defence shipped 2026-05-01 (Phase A — detection):** new module [src/io/live2d/rig/paramReferences.js](../src/io/live2d/rig/paramReferences.js) provides:

- `findReferences(project, paramId)` — locate every reference to a single id (animation tracks + warp bindings + physics inputs), returns `{ animationTracks, bindings, physicsInputs, total }` with human-readable `location` strings.
- `findOrphanReferences(project)` — sweep the project for refs whose paramId doesn't resolve; returns `{ [orphanId]: ReferenceReport }`. Allowlists ParamOpacity + the 14 unconditional standard params + the `ParamRotation_*` prefix; tag-gated standard params (ParamSkirt, ParamHairFront, ParamShirt, etc.) ARE in the orphan-detection scope by design — that's the whole point.

Hooked in `projectStore.seedAllRig` (post-seed): emits a single structured `logger.warn('paramOrphans', …, { [paramId]: locations })` per Init Rig with a non-zero orphan count. Surface visible in the Logs editor.

**Test coverage:** `test:paramReferences` (27 cases) — all three categories, edge cases, allowlist correctness (tag-gated NOT allowlisted).

**Open (Phase B):** UI delete-confirm dialog when a parameter editor exists. Today there's no UI surface for parameter delete, so the warn-only path is sufficient until the rerig-flow gap ships an editor (which also gates GAP-013 fully closing).

### Hole I-4 — Variant-suffix discovery is name-based, breaks on rename

**Severity:** medium. **Affects:** all variant systems (face.smile, eyebrow.surprised, accessory.season, etc.).

**The problem:** [`variantNormalizer.js`](../src/io/variantNormalizer.js) parses `node.name` for `^[a-zA-Z_][a-zA-Z0-9_]{2,}$` after the last dot. The result is written to `node.variantOf` and `node.variantSuffix` (good — these persist). BUT:

- If the user renames `face.smile` → `face_alt` after Init Rig, the persisted `variantSuffix='smile'` is stale. The export still emits the variant under ParamSmile, but the layer name in editor doesn't match — and the next re-Init Rig sees `face_alt` (no suffix) and creates orphan state.
- New variant added by renaming an existing layer to `face.surprised` after Init Rig: `variantOf` not set, `variantSuffix` not set, layer never gets registered with ParamSurprised even though that param gets created.

**Partial defence shipped 2026-05-01 (detection):** [`variantNormalizer.js`](../src/io/variantNormalizer.js) now emits a `logger.warn('variantNorm', …)` with `previousSuffix` / `previousBase` / `stillHidden` when a node was previously a variant and is now renamed-away. Combined with paramReferences orphan detection (Hole I-3) which catches the dangling ParamSmile binding, the user-visible failure mode is now logged not silent.

**Open (Phase B):** UI layer-rename op should suggest "register as new variant" / "keep wiring" when the rename pattern matches a variant convention. Out of scope for the umbrella detection pass; tracked under `project_v3_rerig_flow_gap`.

**Effective coverage today:** rename-detected-as-removal logs a warn so the user knows variantOf was cleared; if the layer was hidden by the variant pass it stays hidden until the user manually shows it. The "new layer renamed INTO a variant after seed" case is NOT logged — the normalizer only runs at PSD import + handleWizardApplyRig today, so a post-seed rename simply isn't observed unless the user re-runs Init Rig.

### Hole I-5 — Bone weight orphans when bone deleted/renamed

**Severity:** medium. **Affects:** `node.mesh.boneWeights` + `node.mesh.jointBoneId`.

**The problem:** `node.mesh.jointBoneId = 'leftElbow'` references a group node by id. If that bone group is deleted, the mesh skinning data dangles. Export's bone-rotation keyform emission either fails or produces a mesh deformed against a phantom bone. (Rename works because the id is stable across name changes — only delete is the silent-corruption case.)

**Defence shipped 2026-05-01 (Phase A — detection):** `projectStore.seedAllRig` now enumerates every part's `mesh.jointBoneId` and checks against the current set of group ids. Mismatches emit one structured `logger.warn('boneOrphans', …, { orphans: [{ partId, partName, jointBoneId }] })` per Init Rig. Detection only — UI bone-edit operators will gate the rename/delete in Phase B.

**Open (Phase B):** UI gate. When the bone-edit op surfaces, it should enumerate `nodes[].mesh.jointBoneId` references on delete and prompt the user to pick a replacement bone or unbind the meshes.

### Hole I-6 — Physics rule outputs reference group names

**Severity:** low. **Affects:** `physicsRules[].outputs` (built by `buildPhysicsRulesFromProject` from the `physics3.json` output side).

**The problem:** `outputs: ['hair-front-1', 'hair-front-2']` are group names resolved to bone targets. Group rename breaks this silently — physics calls a bone that doesn't exist, just outputs no influence (silent zero motion).

**Defence shipped 2026-05-01 (Phase A — detection):** `projectStore.seedAllRig` now enumerates every `physicsRules[i].outputs[j]` and checks against the current set of group names + ids. Mismatches emit one structured `logger.warn('physicsOrphans', …, { orphans: [{ ruleIdx, ruleName, output, location }] })` per Init Rig. Resolution accepts both string outputs and `{bone, boneId}` shapes for forward-compat with potential schema migrations.

**Open (Phase B):** UI gate on group rename — same shape as I-5 fix, surface when group-edit operators land.

### Hole I-7 — autoRigConfig defaults silently override user tunings

**Severity:** low (but contributes to debugging confusion).

**The problem:** old `resolveAutoRigConfig` returned the full stored `autoRigConfig` if shape-valid, else full defaults. There was no per-field merge — adding a new tunable in v8 of the config shape (e.g. a new `faceParallax.someNewKnob`) would be `undefined` on legacy seeded projects, and the resolver passed `undefined` through to consumers.

**Defence shipped 2026-05-01:** [`autoRigConfig.js#resolveAutoRigConfig`](../src/io/live2d/rig/autoRigConfig.js) now uses `mergeOverDefaults(DEFAULT_AUTO_RIG_CONFIG.X, stored.X)` per section instead of pass-through. Semantics mirror `{ ...DEFAULTS, ...stored }` recursively: every default key gets a value, stored values override, **unknown future fields in stored are preserved** (forward-compat: a save from a future build with extra fields still loads cleanly). Resolver now returns a fresh object; caller can't accidentally mutate the stored config.

**Test coverage:** test:autoRigConfig grew to 117 cases, +13 over pre-Step 7. New cases: per-field merge preserves user tunings, partial-section merge fills missing fields from defaults, resolver-output mutation doesn't bleed into stored config, future-unknown fields tolerated.

**Status:** closed for this iteration. If a section adds a new required field that defaults can't safely supply (e.g. one that requires per-character calibration), explicit migration entries in `projectMigrations.js` are still the right tool.

### Hole I-8 — Fresh-harvest detection is too aggressive

**Severity:** medium. **Affects:** export for partial-coverage characters.

**The problem:** old [exporter.js#L659](../src/io/live2d/exporter.js#L659) check was `anySeeded = faceParallax !== null || bodyWarp !== null || rigWarps.size > 0`. If at least ONE was seeded, the others were kept null on the assumption "the user explicitly cleared them" (e.g. character with no face).

That's **also** what happens when the user did Init Rig successfully but only one of the three fields had a meaningful result for that character. Concrete: a face-only character → faceParallax populated, bodyWarp null (no body), rigWarps empty. `anySeeded = true`, no fresh harvest runs — correct. But: a face-only character whose Init Rig was interrupted, leaving partial state with only autoRigConfig seeded — `anySeeded = false`, fresh harvest fires and overwrites partial state.

**Defence shipped 2026-05-01 (Phase A):** explicit `project.lastInitRigCompletedAt` ISO-timestamp marker, set at the end of `projectStore.seedAllRig`. Persisted via `saveProject` + schema migration v13 (legacy saves get null). Exporter's `resolveAllKeyformSpecs` first checks the marker, then falls back to the old heuristic if the marker is null — so projects rigged before this change continue to behave as before until the user re-runs Init Rig.

**Status:** legacy heuristic still in place as a fallback for pre-v13 projects but tagged as "legacy" with a comment. Once enough time passes that all in-flight projects have re-init'd, the legacy fallback can be dropped.

### Hole I-9 — saveProject is async, `loadProject` reads via JSZip — both can fail silently in batch tools

**Severity:** low. **Affects:** automated batch processing.

**The problem:** Both round-trip steps swallow per-texture/per-audio errors with `console.error` and continue ([projectFile.js:23](../src/io/projectFile.js#L23), [:142](../src/io/projectFile.js#L142)). For end-user save/load this is fine — losing one texture is recoverable. For automated test harnesses or CI, silent partial-save is a footgun.

**Defence shipped 2026-05-01:** both `saveProject(project, opts)` and `loadProject(file, opts)` accept `{ strict?: boolean }`. Default false → existing back-compat console.error + continue. `strict: true` → throw on first per-asset failure, with a message identifying the caller and the failing asset id (`saveProject(strict): texture <id> fetch failed: ...`). Tests verify both paths.

**Status:** end-user UI continues to use default mode (lossy save is recoverable; corrupting whole save would be worse). Batch / CI tooling should pass `{ strict: true }`.

### Hole I-10 — Re-import PSD doesn't re-derive what's stale

**Severity:** high (wires multiple holes above into one user-visible failure).

**The problem:** the PSD reimport path adds new nodes / updates mesh data on existing nodes, but **does not** invalidate or re-derive any of the seeded rig data that depends on those nodes. Concretely:

- New mesh added → `faceParallax` keyforms don't include it (it's not in the keyform tuples) → silently uncovered by face deformation.
- Existing mesh re-meshed → `keyform.positions` still indexed against OLD vertex array → wrong vertices deform.
- Layer renamed → variant detection may break (Hole I-4).
- Group renamed → physics output name dangles (Hole I-6).
- Layer deleted → `bindings[].parameterId` for variants/bones may be orphan (Hole I-3).

**Defence shipped 2026-05-01 (Phase A — detection):**

1. ✅ Per-mesh signatures captured at seed (Hole I-1; module [src/io/meshSignature.js](../src/io/meshSignature.js)).
2. ✅ Reactive validation — [src/v3/shell/StaleRigBanner.jsx](../src/v3/shell/StaleRigBanner.jsx) calls `validateProjectSignatures(project)` on every project mutation; gated by `hasStaleRigData(report)` (which ignores the `unseededNew` bucket — fresh-import-before-Init-Rig is normal). Uses `useMemo` keyed on the project reference; FNV-1a over a few hundred meshes is <1ms in profile.
3. ✅ User surface — banner row mounts under Topbar (above AreaTree) when divergence is real. Yellow warning + summary count + Re-Init Rig button (calls `RigService.initializeRig` directly) + dismiss-for-this-session button. Auto-reappears when divergence count changes (e.g., a second reimport adds more stale meshes).
4. ✅ Logs panel integration — every divergence emits one structured `logger.warn('staleRig', …, {stale: [...], missing: [...]})` so users can see per-part detail in the Logs editor.

**Open (Phase B):** "Re-Init Rig (preserve customisations)" mode — re-derive only the changed meshes, leaving unchanged-mesh seeds intact. Out of scope for the umbrella detection fix; tracked under the broader rerig-flow gap (memory: `project_v3_rerig_flow_gap`).

**Effective coverage today:** any PSD reimport that touches mesh geometry (vertex count, triangle count, UV positions, OR vertex order) raises the banner and emits per-mesh warnings. Layer rename / group rename (Holes I-4 / I-6) NOT detected by signature alone — handled separately by the local fixes scheduled for Step 4.

### Summary table

| Hole | Severity | Existing mitigation | Detection | Auto-fix |
|------|----------|---------------------|-----------|----------|
| I-1 mesh signature hash | high | rigWarps validates `numKf` + signatureHash shipped 2026-05-01 (Phase A) | `validateProjectSignatures(project)` | none (lossy; user re-Init Rig) |
| I-2 binding fingerprint | medium | none | none | none |
| I-3 animation orphan params | medium | UI protection of standard params + paramReferences detection shipped 2026-05-01 (Phase A) | post-seedAllRig logger.warn('paramOrphans') | none (UI delete-confirm pending Param Editor UI) |
| I-4 variant rename | medium | persistent `variantSuffix` + variantNorm warn shipped 2026-05-01 | logger.warn on rename-detected-as-removal | none (UI rename op pending) |
| I-5 bone weight orphan | medium | seedAllRig boneOrphans walk shipped 2026-05-01 | logger.warn('boneOrphans') | none (UI bone-edit op pending) |
| I-6 physics output dangling | low | seedAllRig physicsOrphans walk shipped 2026-05-01 | logger.warn('physicsOrphans') | none (UI group-edit op pending) |
| I-7 autoRigConfig field drift | low | resolveAutoRigConfig spread-merge over defaults shipped 2026-05-01 | n/a (merge fills missing fields) | n/a |
| I-8 fresh-harvest aggressive | medium | explicit lastInitRigCompletedAt marker shipped 2026-05-01 | exporter prefers marker over heuristic | n/a (precise check replaces heuristic) |
| I-9 silent texture/audio errors | low | console.error + `{strict:true}` opt-in shipped 2026-05-01 | strict mode throws | n/a (caller picks mode) |
| I-10 PSD reimport no invalidation | high | StaleRigBanner shipped 2026-05-01 (Phase A, detection) | reactive UI banner + per-mesh logger.warn | none (lossy; user re-Init Rig) |

**Recommended ordering for Phase B+ (when prioritised):** I-10 first (it's the single user-facing umbrella for I-1, I-3, I-4, I-5, I-6 in a single workflow); I-1 second (signatureHash unlocks the I-10 detection); I-3 third (animation orphans are the next-most-common silent-export-corruption vector). I-7 / I-9 are quality-of-life. I-2 / I-8 wait until UI editors for the relevant fields exist.

---

## Decision log

- **2026-05-01** — Audit performed by Claude (this document). Identified
  the four-field round-trip gap. Recommendation: ship Phase A immediately.
- **2026-05-01** — User raised the strategic concern that drove this audit:
  "если у нас нету правильных data layer, то и экспорт из stretchy studio
  data layer будет не работать как должен в cubism". Confirmed by the
  audit — the "use my edits" export path is silently equivalent to
  "auto-regenerate" after a single save→load cycle.
- **2026-05-01** — Phase A shipped (saveProject persists the four lost
  fields; round-trip test green). Round-trip integrity confirmed for the
  fields themselves; deeper integrity issues (signatureHash, orphan
  detection, PSD-reimport invalidation) catalogued in the "Integrity gaps
  and known footguns" section above and tracked under GAP-012 + GAP-013.
- **2026-05-01** — Hole I-1 detection mechanism shipped: per-mesh
  fingerprint (`vertexCount`, `triCount`, FNV-1a UV hash) captured at
  seed time in `project.meshSignatures`. Module
  [src/io/meshSignature.js](../src/io/meshSignature.js); seed hook in
  `projectStore.seedAllRig`; serialization in `saveProject`; schema
  v12 migration. Tests: `test:meshSignature` (29), `test:projectRoundTrip`
  (23), `test:migrations` (73). Open: I-10 consumer side (banner,
  reimport hook) — fingerprint is captured but nothing reads it yet.
- **2026-05-01** — Design divergence on Hole I-1: plan called for
  `sortedUVHashes`, shipped with **positional** UV hash. Reason: warp
  keyforms are positionally indexed, so reordering vertices is itself
  an invalidating change a sorted hash would miss. Recorded in
  meshSignature.js JSDoc; living-doc note here for future readers.
- **2026-05-01** — Hole I-10 detection consumer shipped:
  [src/v3/shell/StaleRigBanner.jsx](../src/v3/shell/StaleRigBanner.jsx)
  mounts under Topbar in AppShell. Reactive validation via `useMemo`;
  gated by `hasStaleRigData` (ignores fresh-import unseededNew case).
  Emits structured `logger.warn('staleRig', …)` so per-mesh detail
  surfaces in the Logs editor. Re-Init Rig button calls
  `RigService.initializeRig` directly (no operator id yet — operator
  registration deferred to broader rerig-flow gap).
- **2026-05-01** — Step 7 shipped: I-7 `mergeOverDefaults` in
  resolveAutoRigConfig. Per-field spread merge instead of full-section
  pass-through; future-unknown fields preserved (forward-compat);
  resolver now returns fresh objects (caller can't mutate stored).
  117 autoRigConfig tests (+13). Closes the original closure plan.
- **2026-05-01** — Step 5 shipped: I-9 `{strict:true}` mode for
  saveProject/loadProject. Default behaviour unchanged (UI keeps
  lossy-tolerant save). Tests cover both paths.
- **2026-05-01** — Step 4 shipped: local fixes for I-4/I-5/I-6/I-8.
  variantNormalizer logs rename-detected-as-removal cases;
  seedAllRig walks `mesh.jointBoneId` (I-5) and `physicsRules.outputs`
  (I-6) for orphans, emitting `logger.warn('boneOrphans')` /
  `logger.warn('physicsOrphans')`; `project.lastInitRigCompletedAt`
  (I-8) replaces the exporter's old "anySeeded" heuristic with an
  explicit Init Rig completion marker. Schema v13 migrates legacy
  saves to `lastInitRigCompletedAt: null` (exporter falls back to
  legacy heuristic for them so existing projects don't lose seeded-
  mode export until next re-Init Rig).
- **2026-05-01** — Hole I-3 detection shipped:
  [src/io/live2d/rig/paramReferences.js](../src/io/live2d/rig/paramReferences.js)
  enumerates references to a paramId across animation tracks + warp
  bindings + physics inputs. Hooked in `projectStore.seedAllRig`
  (post-seed): emits one `logger.warn('paramOrphans', …)` per Init
  Rig with a non-zero orphan count. **Design choice:** tag-gated
  standard params (ParamSkirt, ParamHairFront, etc.) ARE in the
  orphan-detection scope — exactly the case Hole I-3 was about
  (re-Init Rig with reduced tag coverage drops them). Only
  unconditional standard params + ParamOpacity + ParamRotation_*
  prefix are allowlisted.
