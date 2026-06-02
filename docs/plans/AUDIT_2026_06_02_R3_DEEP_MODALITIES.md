# Audit 2026-06-02 round-3 — deep modalities

Third-round `Workflow` audit over the top-5 critic-flagged categories from R2 + driver-cycle / migration safety.

**Workflow run `wf_3cd96114-a42`** — 202 agents, ~9.4M tokens, 28 min.

**65 raw findings → 33 confirmed / 32 refuted** via 3-lens default-refuted verify (49% pruning).

## Severity distribution

- HIGH (14): L2D-JSON-01/-02/-03/-04/-05, CROSS-1, CROSS-4, F1, F2, F4, GL-03, MIG-NAN-SCHEMA-VERSION, DRIVER-PARAMS-VIEW-STALE-DEFAULTS, MIG-V18-UV-FLOAT32-MISSING
- MEDIUM (11), LOW (8)

## Confirmed findings — punch list

Status: `[x]` shipped this round / `[ ]` deferred (see DEFERRED section).

### live2d-json-subformats (9)

- [x] **L2D-JSON-01** `physics3json.js:107` Output.Weight hardcoded to 100. **HIGH** — `e61cf1a`
- [x] **L2D-JSON-02** `physics3json.js:154` EffectiveForces hardcoded. **HIGH** — `e61cf1a`
- [x] **L2D-JSON-03** `physics3json.js:99` Unknown Input.type silently coerced. **HIGH** — `e61cf1a`
- [x] **L2D-JSON-04** `physics3json.js:112` No NaN/Infinity guard on vertex Position / Mobility / Delay / Acceleration / Radius. **HIGH** — `e61cf1a`
- [x] **L2D-JSON-05** `physics3json.js:73` Rule emitted with fewer than 2 vertices. **HIGH** — `e61cf1a`
- [x] **L2D-JSON-07** `physics3jsonImport.js:124` Missing Output.VertexIndex silently defaults to 1. **MEDIUM** — `e61cf1a`
- [x] **L2D-JSON-08** `motion3json.js:108` Action duration/fps default to 2000ms/24fps. **MEDIUM** — `4560232`
- [x] **L2D-JSON-09** `motion3jsonImport.js:106` Duration ≤0 silently clamped to 1ms. **MEDIUM** — `4560232`
- [x] **L2D-JSON-12** `cdi3json.js:38` No dedup on Parameters/Parts. **LOW** — `4560232`

### cross-store (8)

- [x] **CROSS-1** `projectStore.js:1911` deleteNode cascade cleanup. **HIGH** — `7a20e68`
- [x] **CROSS-4** `paramValuesStore.js:46` Not reset on project load / reset. **HIGH** — `7a20e68`
- [x] **CROSS-5** `registry.js:411` selection.delete dual-clear (folded into CROSS-1 fan-out). **MEDIUM** — `7a20e68`
- [x] **CROSS-7** `editorStore.js:349` selectedVertexIndices prune (folded into CROSS-1 fan-out). **MEDIUM** — `7a20e68`
- [ ] **CROSS-9** `editorStore.js:393` setSelection reads preferences during reducer. **MEDIUM** — DEFERRED (refactor scope; the in-place-set pattern is widespread and the race class is low-probability)
- [ ] **CROSS-10** `preferencesStore.js:303` Persisted lastToolByMode validation. **LOW** — DEFERRED (low impact)
- [x] **CROSS-11** `animationStore.js:67` draftPose / restPose Maps leak (folded into CROSS-1 fan-out). **LOW** — `7a20e68`
- [x] **CROSS-12** `editorStore.js:227` expandedGroups Set prune (folded into CROSS-1 fan-out). **LOW** — `7a20e68`

### build-tooling (4)

- [ ] **BUILD-001** `vite.config.js:27` manual-chunks denylist. **MEDIUM** — DEFERRED (chunking strategy change; needs byte-budget baseline before flipping)
- [ ] **BUILD-006** `public/manifest.webmanifest:11` PWA manifest icon set. **LOW** — DEFERRED (asset work, separate task)
- [ ] **BUILD-008** `tsconfig.json:38` tsconfig + jsconfig duplicate paths. **LOW** — DEFERRED (low-impact hygiene)
- [x] **BUILD-009** `swRegister.jsx:7` Docstring references hook-form but code uses callback-form. **LOW** — `44f21fe`

### ui-edge (3)

- [x] **F1** `editorStore.js:531` exitEditMode does not cancel active modals. **HIGH** — `3e5578b`
- [x] **F2** `projectStore.js:1208` loadProject / resetProject does not cancel modals. **HIGH** — `3e5578b`
- [x] **F4** `DopesheetEditor.jsx:1030` Dopesheet grab modal Ctrl+Z swallow. **HIGH** — `3e5578b`

### renderer (6)

- [x] **GL-03** `CanvasViewport.jsx:616` No WebGL context-loss handlers. **HIGH** — `c5d4fcc`
- [x] **GL-04** `CanvasViewport.jsx:657` Tab-hidden rAF pause causes physics spike. **MEDIUM** — `c5d4fcc`
- [x] **GL-06** `CanvasViewport.jsx:3572` handleReset / handleLoadProject leak upload-cache refs. **MEDIUM** — `c5d4fcc`
- [x] **GL-07** `partRenderer.js:59` Triangle/wireframe IBO hardcoded to Uint16Array. **MEDIUM** — `c5d4fcc`
- [x] **GL-08** `partRenderer.js:196` LINEAR min-filter + generateMipmap mismatch. **MEDIUM** — `c5d4fcc`
- [ ] **GL-10** `scenePass.js:70` premultipliedAlpha:false but blendFunc(ONE,...). **LOW** — DEFERRED (needs visual A/B against existing exports before flipping pma)

### migrations-drivers (3)

- [x] **MIG-NAN-SCHEMA-VERSION** `projectMigrations.js:1153` NaN schemaVersion silently skips ALL migrations. **HIGH** — `43abefc`
- [x] **MIG-V18-UV-FLOAT32-MISSING** `projectFile.js:267` UV→Float32Array restore skips meshData nodes. **HIGH** — `43abefc`
- [x] **DRIVER-PARAMS-VIEW-STALE-DEFAULTS** `rnaPath.js:172` Driver `__params__` view reads defaults not live. **HIGH** — `3e812f3` + `b4c5812` test un-pin

## Deferred (5 items)

- **CROSS-9** — setSelection reads preferences during reducer. The pattern is widespread (enterEditMode, setViewLayers etc.); fixing one site without auditing the others would be inconsistent. Separate refactor session.
- **CROSS-10** — persisted `lastToolByMode` validation. Pure UI cosmetic; toolbar already skips unknown ids silently.
- **BUILD-001** — manual-chunks denylist → allowlist. Substantial chunking strategy change; needs a byte-budget baseline + bundle-size assertion before flipping or future deps could regress boot.
- **BUILD-006** — PWA manifest needs 192/512 PNG icons; asset task, not code.
- **BUILD-008** — tsconfig + jsconfig duplication. Deleting jsconfig.json works as long as no IDE plugin specifically reads it; needs verification across IDE setups before removing.
- **GL-10** — premultipliedAlpha:false + blendFunc(ONE, ...) mismatch. Visible at iris/eyewhite borders; flipping pma requires verifying captureExportFrame.js still encodes correctly. Worth a dedicated visual A/B.

## Shipped commits this round (chronological)

| # | Commit | Author | Items |
|---|--------|--------|-------|
| 1 | `27528d9` | Claude | tracking doc |
| 2 | `43abefc` | pelmentor | MIG-NAN + MIG-V18 |
| 3 | `e61cf1a` | Claude | L2D-JSON physics3 batch (01/02/03/04/05/07) |
| 4 | `4560232` | pelmentor | L2D-JSON motion3 + cdi3 (08/09/12) |
| 5 | `7a20e68` | Claude | CROSS-1/-4/-5/-7/-11/-12 |
| 6 | `3e5578b` | pelmentor | F1 + F2 + F4 |
| 7 | `c5d4fcc` | Claude | GL-03/-04/-06/-07/-08 |
| 8 | `3e812f3` | pelmentor | DRIVER-PARAMS-VIEW-STALE-DEFAULTS |
| 9 | `44f21fe` | Claude | BUILD-009 |
| 10 | `b4c5812` | pelmentor | test un-pin for driver cascade |
| 11 | `fce32a4` | Claude | test un-pin for Angle-default fallback |

**Closed: 28 / 33 confirmed findings.** 5 deferred (each with reason above).

## Resume hint

Next session can:
1. Pick up a deferred item (each is well-scoped).
2. Launch round-4 if remaining-modalities yield justifies.
3. Resume bug-03 Shelby handwear once user re-runs Init Rig.

Per RULE-№5: last commit Claude `fce32a4` → next is pelmentor.
