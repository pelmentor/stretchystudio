# V3 Re-Rig Flow — Plan

**Status:** **SHIPPED 2026-05-03.** Phases 0 + 1 + 3 + 4 all delivered in a single autonomous session after `/compact`. Phase 2 (conflict preview) was the optional 0.5d that the plan default skipped — undo is the safety net.

**Commits:**
- Phase 0 (merge primitives + clobber fix): commit `d3f4078`
- Phase 1 (runStage + RigStagesTab + telemetry): commit `ac87052`
- Phase 3 + 4 (integration test + PhysicsTab reroute + docs): pending in this commit

The original plan body below describes the design; treat it as historical context. The shipped surface lives in [`RigStagesTab.jsx`](../src/v3/editors/properties/tabs/RigStagesTab.jsx), [`RigService.js`](../src/services/RigService.js) (`runStage` / `refitAll`), [`PoseService.js`](../src/services/PoseService.js) (`capturePose` / `restorePose`), and [`userAuthorMarkers.js`](../src/io/live2d/rig/userAuthorMarkers.js).

---

**Premise.** After the PSD-import wizard runs, users today have NO way to refit individual rig stages — the only "re-rig" path is re-importing the PSD, which clobbers every manual edit (mask additions, physics imports, joint pivots, transform tweaks, etc.). This plan adds per-stage refit operators with merge-aware seeders, so iterating on a rig is safe.

This is a **feature pillar**, not a small fix. Multi-day. Plan structured so each phase ships independently and earlier phases stand on their own value (Phase 0 alone fixes a real existing bug — `seedAutoRigConfig` clobbers user subsystem flags on every full re-init).

---

## Status quo (audited 2026-05-03)

### Pipeline

Canonical entry point: [`RigService.initializeRig()`](../src/services/RigService.js) at line 110. Order:

1. `PoseService.resetToRestPose()` — clears pose state to zero; required because keyform seeders snapshot vertex positions at rest.
2. `loadProjectTextures(project)` — async PNG load (used by parabola fitting in eye closure stage).
3. `initializeRigFromProject(project, images)` ([`initRig.js:235`](../src/io/live2d/rig/initRig.js)) — produces `harvest`. Two paths: **authored** (project has `_cmo3Scene` → `buildRigSpecFromCmo3`) or **heuristic** (`buildMeshesForRig` → `generateCmo3` → `harvestSeedFromRigSpec`).
4. **`projectStore.seedAllRig(harvest)`** ([`projectStore.js:474`](../src/store/projectStore.js)) — single immer transaction calling all 11 seeders in fixed order:

| # | Seeder | File | Writes |
|---|--------|------|--------|
| 1 | `seedParameters` | `paramSpec.js` | `project.parameters` |
| 2 | `seedMaskConfigs` | `maskConfigs.js` | `project.maskConfigs` |
| 3 | `seedPhysicsRules` | `physicsConfig.js` | `project.physicsRules` |
| 4 | `seedBoneConfig` | `boneConfig.js` | `project.boneConfig` |
| 5 | `seedVariantFadeRules` | `variantFadeRules.js` | `project.variantFadeRules` |
| 6 | `seedEyeClosureConfig` | `eyeClosureConfig.js` | `project.eyeClosureConfig` |
| 7 | `seedRotationDeformerConfig` | `rotationDeformerConfig.js` | `project.rotationDeformerConfig` |
| 8 | `seedAutoRigConfig` | `autoRigConfig.js` | `project.autoRigConfig` |
| 9 | `seedFaceParallax` / `clearFaceParallax` | `faceParallaxStore.js` | `project.faceParallax` |
| 10 | `seedBodyWarpChain` / `clearBodyWarp` | `bodyWarpStore.js` | `project.bodyWarp` |
| 11 | `seedRigWarps` / `clearRigWarps` | `rigWarpsStore.js` | `project.rigWarps` |

Stages 9–11 (keyform seeders) READ from the outputs of 1–8 (committed inside the same `produce` transaction).

5. `useRigSpecStore.setState({rigSpec, ...})` — caches spec for live evaluator.
6. `paramValuesStore.resetToDefaults(params)` — **all sliders snap back to defaults**. (Bug-or-feature depending on caller: full re-init = expected, per-stage refit = unwanted.)

### Existing re-run UI

- **[`ParametersEditor.jsx`](../src/v3/editors/parameters/ParametersEditor.jsx) "Initialize Rig" button** — calls full `initializeRig()`.
- **[`StaleRigBanner.jsx`](../src/v3/shell/StaleRigBanner.jsx) "Re-Init Rig" button** — same.
- **[`PhysicsTab.jsx`](../src/v3/editors/properties/tabs/PhysicsTab.jsx) "Reset" button** — calls `seedPhysicsRules()` directly (single-stage; only stage with this UI today).

### Manual-edit surfaces (these mutate rig-relevant `project.*`)

| Surface | Field |
|---------|-------|
| ObjectTab → name / visible / opacity / transform / draw_order / pivot | `nodes[i].*` |
| MeshTab → gridSpacing / Regenerate Mesh | `nodes[i].mesh.*` |
| MaskTab → add / remove mask | `project.maskConfigs[]`, `nodes[i].mesh.maskMeshIds` |
| PhysicsTab → Import .physics3.json / Reset | `project.physicsRules` |
| InitRigOptionsPopover → subsystem checkboxes | `project.autoRigConfig.subsystems` |
| SkeletonOverlay → joint_drag / rotation drag | `nodes[i].transform.{pivotX,pivotY,rotation}` |
| Outliner → drag-to-reparent / visibility | `nodes[i].{parent,visible}` |

### Conflict surface — what gets clobbered on re-run

| Field | Seeder writes it | Manual UI also writes it | Survives full re-init today? |
|-------|------------------|--------------------------|-------------------------------|
| `project.maskConfigs` | seedMaskConfigs (#3) | MaskTab add/remove | **NO** — manual edits lost |
| `project.physicsRules` | seedPhysicsRules (#3) | PhysicsTab import/reset | **NO** — imported physics3.json lost |
| `project.autoRigConfig.subsystems` | seedAutoRigConfig (#8) | InitRigOptionsPopover | **NO** — flags reset to all-on (existing bug) |
| `project.parameters` | seedParameters (#1) | (read-only today) | N/A |
| `project.boneConfig` / `variantFadeRules` / `eyeClosureConfig` / `rotationDeformerConfig` | (#4-7) | (read-only today) | N/A — pure defaults, no input |
| `project.faceParallax` / `bodyWarp` / `rigWarps` | (#9-11) | (no manual UI yet) | N/A |
| `nodes[i].transform.pivotX/Y` | (read by keyform seeders) | SkeletonOverlay joint_drag, ObjectTab | **YES** — manual moves are inputs to next refit, by design |

### Known idempotency notes

- `initializeRigFromProject` IS idempotent ([`initRig.js:29-31`](../src/io/live2d/rig/initRig.js) explicitly says so). Two calls on the same project produce the same output.
- `seedAllRig` is destructive on the 4 conflict-surface fields (above).
- No single-flight guard on `RigService.initializeRig()` — two rapid clicks both execute. (Existing pre-feature bug; not load-bearing.)

---

## What this feature does

Surface all 11 rig pipeline stages as user-triggerable operators in a Rigging workspace properties tab, with **merge-aware seeders** that preserve manual user edits to the conflict-surface fields. Single-stage refit becomes safe; full wizard re-init keeps its current "destructive on purpose" semantics.

## What it does NOT do

- **Weight-paint tool.** Live2D's deformer model doesn't have per-vertex bone weights. The closest analog is "deformer parent assignment" which Outliner drag-to-reparent already supports. If a Blender-style weight-paint is wanted, that's a separate feature pillar requiring rendering pipeline changes.
- **New rig algorithms.** We surface what exists; we don't add new pipeline stages.
- **Wizard replacement.** PSD wizard stays as the green-field path.
- **Workflow records / versioning.** No "history of edits per stage". Undo/redo at the project level is the safety net.

---

## Phase 0 — Conflict audit + merge primitives (1.5 days)

### Why first

Per-stage UI without merge semantics is the worst kind of footgun: every "Refit X" button silently loses the user's authored Y. Phase 0 makes the pipeline safe to re-run BEFORE adding the surface that invites users to re-run.

### Marker scheme — uniform, not per-seeder

**Decision (was waffly in v0):** explicit `_userAuthored: true` markers on entries the user created or imported. NOT heuristic detection at refit time. Reasons:
- Heuristic ("does it match tag scan?") has edge cases (user-added mask that happens to align with a future tag).
- Markers are explicit. Diffable. Surviving renames + tag changes by design.
- Cost is 3 modified files in Phase 0 (the manual-edit surfaces that today don't set markers).

**`_userAuthored` markers don't exist in any project today** (verified via grep). Phase 0 introduces them. Migration: not needed — absence of marker == auto-seeded == reseedable, which is the safe assumption.

### Deliverables

1. **New module `src/io/live2d/rig/userAuthorMarkers.js`** — one centralised predicate. One file all seeders + manual-edit surfaces import from. Exports:
   - `markUserAuthored(entry)` — sets `entry._userAuthored = true` (returns the entry for chaining).
   - `isUserAuthored(entry)` — true if marker is set.
   - `mergeAuthored(autoSeeded, existing)` — merge helper: returns `[...existing.filter(isUserAuthored), ...autoSeeded.filter(e => !existsInExisting(e))]` (semantically: keep all user-authored from existing, add auto-seeded that don't conflict).
   - `predicate(stageName)` — returns the per-stage equality function used by `mergeAuthored` to decide "is this auto-seeded entry already represented?". Per-stage because different stages have different uniqueness keys (mask uses `paramId`, physics rule uses `id`, etc.).

2. **Modify the manual-edit surfaces to write markers** (Phase 0 cannot defer this — without markers, merge mode has nothing to preserve):
   - [`MaskTab.jsx:53`](../src/v3/editors/properties/tabs/MaskTab.jsx) `addMask` → wrap pushed entry with `markUserAuthored`.
   - [`physics3jsonImport.js`](../src/io/live2d/physics3jsonImport.js) `parsePhysics3Json` → mark imported rules.
   - [`PhysicsTab.jsx:79`](../src/v3/editors/properties/tabs/PhysicsTab.jsx) — leaves Reset semantics intact (Reset = `mode: 'replace'`, deliberately destructive). See Phase 4 note.
   - Future warp UIs will follow the same convention; not needed today.

3. **Each conflict-surface seeder gets a `mode: 'replace' | 'merge'` parameter**, default `'replace'` (back-compat). Merge logic uses `mergeAuthored`:

   | Seeder | `merge` behaviour |
   |--------|-------------------|
   | `seedAutoRigConfig` | Preserve `subsystems` flags via shallow-merge. Reseed all other autoRigConfig fields. |
   | `seedMaskConfigs` | `mergeAuthored(autoSeeded, existing)` keyed on `paramId`. |
   | `seedPhysicsRules` | `mergeAuthored(autoSeeded, existing)` keyed on `id`. |
   | `seedFaceParallax` / `seedBodyWarpChain` / `seedRigWarps` | Per-entry `_userAuthored` check. Reseed entries without marker; preserve marked. |

   Stages 1, 4-7 (parameters, bone config, variant fade rules, eye closure config, rotation deformer config) have no manual UI today and nothing to preserve: `merge === replace` (no-op specialisation).

4. **`seedAllRig(harvest, mode = 'replace')` accepts a mode arg** and propagates. Existing callers (`RigService.initializeRig` ⇒ "Re-Init Rig" button) stay on `'replace'`. Phase 1's per-stage UI uses `'merge'`.

5. **Single-flight guard on `seedAllRig`**: Boolean lock module-scope; block second concurrent call. **Separate concern from merge logic, but landing in the same Phase because both touch `seedAllRig`'s entry path.**

6. **Fix the `seedAutoRigConfig` clobber bug** (independently valuable): even in `mode = 'replace'`, change to preserve `subsystems` if they're non-default. Today, [`InitRigOptionsPopover.jsx:47`](../src/v3/editors/parameters/InitRigOptionsPopover.jsx) writes user-chosen flags, and full re-init silently undoes them. This bug stands on its own — even if Phases 1-4 stall, fixing it ships value.

7. **Per-seeder unit tests for merge mode:**
   - `seedAutoRigConfig`: pre-seed with `subsystems.hairRig: false`; merge re-run; assert `subsystems.hairRig === false`.
   - `seedAutoRigConfig` (replace bug fix): pre-seed with `subsystems.hairRig: false`; **replace** re-run; assert flag still preserved (the bug fix).
   - `seedMaskConfigs`: pre-seed; add a mask config with `_userAuthored`; merge re-run; assert it survives.
   - `seedPhysicsRules`: pre-seed; mark a rule with `_userAuthored: true`; merge re-run; assert preserved.
   - Same shape for face parallax / body warp / rig warps.
   - **Test for `mergeAuthored` itself** as a pure function — covers add/remove/preserve permutations.

### Verification gate

- All existing tests still green (back-compat preserved by default `mode = 'replace'`).
- New merge-mode tests green per seeder + `mergeAuthored` unit tests green.
- `seedAutoRigConfig` clobber bug fixed: full re-init no longer resets `subsystems`.
- 3 manual-edit surfaces now write markers; no existing test broken by the addition (markers are additive on the entry shape).

---

## Phase 1 — Per-stage operators (1.5 days)

### Pose preservation — explicit pseudocode

Pose preservation across per-stage refit is the bit that requires care. **Stages 9-11 (keyform seeders)** are sensitive: they snapshot vertex positions at "rest" via `harvestSeedFromRigSpec`, which depends on bone-group transforms being at zero AND `paramValuesStore` being at defaults (so no unwanted deformation in the snapshot).

`runStage(name, opts)` therefore branches:

```
async runStage(name, { mode = 'merge' }):
  if name in ['parameters', 'maskConfigs', 'physicsRules', 'boneConfig',
              'variantFadeRules', 'eyeClosureConfig', 'rotationDeformerConfig',
              'autoRigConfig']:
    // Stages 1-8: read project nodes/canvas; no pose dependency. Direct call.
    projectStore[`seed${capitalize(name)}`](mode)
    project.rigStageLastRunAt[name] = now()

  else if name in ['faceParallax', 'bodyWarpChain', 'rigWarps']:
    // Stages 9-11: keyform seeders need rest-pose snapshot.
    saved = capturePose()                      // paramValues + bone transforms
    PoseService.resetToRestPose()
    images = await loadProjectTextures(project)  // parabola fitting
    harvest = harvestSeedFromRigSpec(...)
    projectStore[`seed${capitalize(name)}`](harvest, mode)
    restorePose(saved)                          // pose state restored
    project.rigStageLastRunAt[name] = now()
```

Crucially: per-stage refit **does NOT call `paramValuesStore.resetToDefaults`** at the end. The slider state survives. Verified safe — `resetToDefaults` only has 3 callers (`PoseService.resetToRestPose`, `RigService.initializeRig`, ParametersEditor's "Reset Pose" button), and bypassing it for per-stage refit doesn't leave inconsistent state.

### Deliverables

1. **`src/services/RigService.js` adds `runStage(name, opts)`:** as above. Reuses single-flight guard from Phase 0.

2. **`src/v3/editors/properties/tabs/RigStagesTab.jsx`** — new properties tab:
   - List of 11 stages (one per seeder).
   - Per-row: stage name + one-line description + status indicator + "Refit" button.
   - **Status v1 (this Phase):** 🟢 ran-since-init / ⚪ never-run-since-init. Dirty-detection (🟡 input changed since last seed) is **deferred** — would require per-stage signature scheme (mesh hash, parameter-list hash, etc.). v1 just marks freshness; "did this stage's output drift from upstream?" lives in a follow-up signature pass.
   - **`replace` vs `merge` UI:** primary "Refit" button uses `merge`. A secondary kebab menu per row offers "Force replace (lose customisations)" for users who want defaults back.
   - Bottom: "Refit All (merge)" button = `seedAllRig(harvest, 'merge')`. **Distinct from existing "Re-Init Rig" button** (which stays as `replace`). Two intents:
     - "Re-Init Rig" (existing, ParametersEditor + StaleRigBanner): wipe-and-regen. Destructive on purpose.
     - "Refit All" (new, RigStagesTab): preserve customisations, re-run pipeline.

3. **Per-stage telemetry**: add `project.rigStageLastRunAt: Record<string, string>` (ISO timestamp keyed by stage name). New field; backwards compat via `??= {}`. **Coexists with existing `project.lastInitRigCompletedAt`** — that field is still used by [`exporter.js:689`](../src/io/live2d/exporter.js) and [`projectFile.js:126`](../src/io/projectFile.js) for "is the rig seeded at all?" gating; don't break it. Phase 1 just adds the per-stage detail.

4. **Wire the tab via [`tabRegistry.jsx`](../src/v3/editors/properties/tabRegistry.jsx)** (`PROPERTIES_TABS` array, line 48). Visibility filter: always-show, since rig stages are project-level not selection-scoped. (Reconsider in Phase 4 if the tab clutters non-rigging workflows; can scope to "selection is a group node" later.)

5. **Migration entry in `projectMigrations.js`**: `rigStageLastRunAt` defaults to `{}` if missing.

### Verification gate

- Each stage button refits its own field and leaves others unchanged (per-test for stages 1-8; pose-save-restore round-trip for 9-11).
- "Refit All" merge-mode preserves manually-added mask + imported physics3.json.
- "Re-Init Rig" (existing destructive button) still resets pose — back-compat.
- Pose values + paramValues preserved across all 11 per-stage refits.
- `npm run typecheck` silent; `npm test` green; new `test:rigStages` covers the 3 cases above.

---

## Phase 2 — Conflict preview (½ day)

### Why

When user clicks "Refit Mask Configs" on a project with 3 manually-added masks, they should see "This refit will keep your 3 manual masks and reseed 5 auto-derived ones. Proceed?" before committing.

This is polish, not foundation. Phase 1 alone is shippable; Phase 2 reduces "oh no I clicked refit and lost stuff" anxiety.

### Deliverables

1. **`src/services/RigStageDryRun.js`** — pure: `dryRun(stageName, project, mode) → diff`. Diff shape:
   ```
   { added: [...], removed: [...], changed: [...], preservedUserEdits: [...] }
   ```

2. **AlertDialog confirmation** in RigStagesTab when `diff.removed.length > 0` AND any of those entries are user-authored.

3. **Optional preference**: `preferencesStore.rigStageConfirmation: 'always' | 'on-conflict' | 'never'`. Default `'on-conflict'`.

### Verification gate

- Dry-run unit test: project with manual mask → dry-run seedMaskConfigs in merge mode → diff shows 0 removed user-authored entries.
- Same project + replace mode → diff shows N removed entries flagged as user-authored.
- AlertDialog renders the diff; user can confirm or cancel.

---

## Phase 3 — Pose & joint preservation polish (½ day)

### Deliverables

1. **Confirm `RigService.runStage` behaviour**: pose state preserved (Phase 1 already promised this — verify under load).

2. **Joint-drag note**: the existing `SkeletonOverlay` joint_drag tool writes `nodes[i].transform.pivotX/Y` directly. After refitting keyform seeders (9-11), the next eval reads from the new pivot. This is correct as designed — joint moves ARE the input. Document this in the plan + add a unit test that exercises the loop:
   - Set pivot X = 50 via test helper → run keyform seeder → assert keyform was rebuilt with pivotX=50.

3. **Optional**: surface a "Reset all pivots to wizard-emitted defaults" button if/when users have a workflow that needs it. Out-of-scope for v1; track as separate ask.

### Verification gate

- Test: refit eye closure with `ParamAngleX = 15` set in paramValuesStore → after refit, `ParamAngleX` still 15.
- Test: SkeletonOverlay-style pivot mutation followed by stage 9 refit → keyform reflects the new pivot.

---

## Phase 4 — Cleanup + docs (½ day)

1. **PhysicsTab Reset button — KEEP, do not retire.** v0 of this plan said "replace with refit"; re-checked the semantics — they're distinct:
   - PhysicsTab Reset = "wipe my custom physics, regen defaults" → `mode: 'replace'`.
   - RigStagesTab "Refit physics" = "refresh while preserving" → `mode: 'merge'`.
   Two intents, two buttons. Phase 4 only re-routes PhysicsTab Reset through `RigService.runStage('physicsRules', { mode: 'replace' })` so there's one execution path; semantics stay.
2. Update [`docs/V3_WORKSPACES.md`](V3_WORKSPACES.md) to mention RigStagesTab.
3. Update memory: `feedback_*` re: merge-vs-replace + `_userAuthored` marker convention; `project_v3_rerig_flow_gap` → mark as resolved.
4. Update [FEATURE_GAPS.md](FEATURE_GAPS.md) — re-rig flow no longer open.

### Verification gate

- `npm test` green; `npm run typecheck` silent.
- User side-by-side: full wizard re-init still works (subsystems now preserved post-fix); per-stage refit works; pose preserved on per-stage; pose reset on full.

---

## Estimated cost (revised after self-review)

| Phase | Days | Conditional? | Notes |
|-------|------|--------------|-------|
| 0 — Merge primitives + markers + seedAutoRigConfig fix + single-flight | 1.5 | always | Was 1.0 in v0; bumped because Phase 0 touches 3 manual-edit surfaces (MaskTab, physics3jsonImport, plus the central `userAuthorMarkers` module) and adds the `mergeAuthored` helper + per-seeder unit tests |
| 1 — `RigService.runStage` + RigStagesTab + pose save/restore | 1.5 | always | Was 1.0; bumped because pose save/restore for stages 9-11 is non-trivial (texture load, transform snapshot, `produce` transaction) and the freshness-only status indicator still needs `rigStageLastRunAt` plumbing |
| 2 — Conflict preview (DryRun + AlertDialog) | 0.5 | optional | Skip if scope-tight; undo is the safety net |
| 3 — Joint-drag↔refit unit test + minor polish | 0.25 | always | Was 0.5; the major bit (pose preservation) moved into Phase 1's pseudocode |
| 4 — Cleanup + docs | 0.5 | always | |
| **Total nominal (with Phase 2)** | **4.25 days** | | |
| **Total without Phase 2** | **3.75 days** | | |

Phase 0 is independently valuable: even if the rest of this plan stalls, fixing `seedAutoRigConfig` clobbering subsystem flags is a real bug fix that ships value.

**Reality check:** these estimates assume autonomous execution + no scope creep. The biggest unknowns are:
- The `harvestSeedFromRigSpec` callback path for stages 9-11 may have hidden assumptions about pose state we haven't traced. Phase 1 estimate covers normal paths; if something blows up there, +0.5d.
- The migration step for `rigStageLastRunAt` is straightforward but every project schema change has needed a `projectMigrations.js` audit historically.

---

## Risk register

| Risk | Mitigation |
|------|-----------|
| Merge semantics fork per-seeder, drift over time | Centralise marker writing + reading in `userAuthorMarkers.js`; one predicate; one helper (`mergeAuthored`); tests in one file |
| Cascading dependencies — refitting stage 1-8 invalidates stage 9-11 keyforms | v1 status indicator is freshness-only (deferred dirty-detection). RigStagesTab's per-row "Refit" tooltip notes "stages 9-11 read from this output; refit them too if you've added params/etc." Long-term: signature scheme = follow-up phase |
| Two existing entry points (PhysicsTab Reset + new RigStagesTab) diverge | KEEP both — distinct semantic (Reset=replace vs Refit=merge); Phase 4 only re-routes PhysicsTab Reset through `RigService.runStage(..., {mode:'replace'})` so there's one execution path |
| `seedAutoRigConfig` clobber fix breaks expectations of "Re-Init Rig" reset-everything semantics | The button label is "Re-Init Rig" not "Reset all settings". Subsystems are per-character config, not per-rig — different lifecycle. If user reports issue, add explicit "Reset to defaults" button as separate UI |
| Joint-drag pivot edits + subsequent stage 9-11 refit have non-obvious dependency | Phase 3 unit test exercises the loop; documentation note in RigStagesTab row tooltip |
| `paramValuesStore.resetToDefaults` removal from per-stage path → consumer staleness | Audited: only 3 callers (PoseService, RigService.initializeRig, ParametersEditor "Reset Pose" button). Per-stage refit bypasses; animation engine reads paramValuesStore directly — no staleness. Verified safe |
| Texture-load is async + RigStagesTab calls runStage from a button | `runStage` returns Promise; show busy state on the row + disable button during the async window. Same pattern as Reset Rig today |
| Migration `rigStageLastRunAt` field rollout breaks old project files | Standard `projectMigrations.js` entry — defaults to `{}` if missing; non-breaking |
| Adding `_userAuthored` to existing entries on disk creates noise in saved JSON | Marker is a single boolean field; size impact negligible. JSON-shape stable since marker only gets serialised when set |
| `seedAllRig`'s single-flight guard introduces a new failure mode (button "stuck") | Guard releases on completion AND on error (try/finally). UI shows busy spinner. Standard async-button pattern |
| Markers can't tell "user-authored same as auto-derived" from "auto-derived" | Convention: `markUserAuthored` is opt-in at write time. If user ADDS the same entry through MaskTab that auto-derivation also produces, the marker says "preserve" — even though merging would have produced the same row. This is the right behaviour: user's intent was explicit |

---

## Out of scope

- **Weight-paint tool** — separate feature pillar, scope unclear (Live2D doesn't have per-vertex weights natively); confirm with user before any planning.
- **Wizard stage UI replacement** — wizard stays as green-field flow.
- **History view of rig stage runs** — undo at project-scope is sufficient.
- **Rig algorithm improvements** — surface what exists; don't reshape pipeline.
- **Per-stage "advanced settings" forms** — RigStagesTab is binary "refit" UI for v1; per-stage tuning is a separate feature.

---

## Discussion checklist before Phase 0

Defaults below pre-decided in v1; these are the questions where I might be wrong:

1. ✅ **Marker scheme** = unified `_userAuthored: true` (not heuristic). Decision made; one module owns it.
2. ✅ **PhysicsTab "Reset" button** = KEEP (intent ≠ Refit); Phase 4 only re-routes through `runStage`.
3. ⚠️ **Phase 2 conflict preview** = optional 0.5d. Default: skip; undo is the safety net. Override if you want it.
4. ✅ **Weight-paint scope** = out. Separate feature pillar if pursued.
5. ✅ **`seedAutoRigConfig` clobber-fix** = folded into Phase 0 (independently valuable; ships even if rest stalls).
6. ⚠️ **"Refit All" button** = new in RigStagesTab as `merge` mode. Existing "Re-Init Rig" stays as `replace`. Two distinct buttons. Override if you want one combined dropdown.
7. ⚠️ **Status indicator v1** = freshness-only (🟢 ran-since-init / ⚪ never). Per-stage signature dirty-detection is deferred to a follow-up phase. Override if you want it in Phase 1.

If you don't override any of (3) (6) (7), I'll proceed autonomously after `/compact` with the defaults above.

---

## Cross-references

- [`src/services/RigService.js`](../src/services/RigService.js) — entry point
- [`src/io/live2d/rig/initRig.js`](../src/io/live2d/rig/initRig.js) — orchestrator
- [`src/store/projectStore.js#L474`](../src/store/projectStore.js) — `seedAllRig`
- [`src/io/live2d/rig/`](../src/io/live2d/rig/) — 11 seeders
- Memory: `project_v3_rerig_flow_gap.md` (3 days old; this plan supersedes)
