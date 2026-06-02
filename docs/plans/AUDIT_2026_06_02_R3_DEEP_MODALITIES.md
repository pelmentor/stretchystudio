# Audit 2026-06-02 round-3 — deep modalities

Third-round `Workflow` audit over the top-5 critic-flagged categories from R2 + driver-cycle / migration safety: live2d-JSON subformats, cross-store consistency, build/PWA tooling, UI operator edge cases, renderer correctness, migrations + drivers.

**Workflow run `wf_3cd96114-a42`** — 202 agents, ~9.4M tokens, 28 min.

**65 raw findings → 33 confirmed / 32 refuted** via 3-lens default-refuted verify (49% pruning).

## Severity distribution

- HIGH (14): L2D-JSON-01/-02/-03/-04/-05, CROSS-1, CROSS-4, F1, F2, F4, GL-03, MIG-NAN-SCHEMA-VERSION, DRIVER-PARAMS-VIEW-STALE-DEFAULTS, MIG-V18-UV-FLOAT32-MISSING
- MEDIUM (11), LOW (8)

## Confirmed findings — punch list

### live2d-json-subformats (9)

- [ ] **L2D-JSON-01** `physics3json.js:107` Output.Weight hardcoded to 100 — round-trip drops imported value. **HIGH**
- [ ] **L2D-JSON-02** `physics3json.js:154` EffectiveForces hardcoded; ignored on round-trip. **HIGH**
- [ ] **L2D-JSON-03** `physics3json.js:99` Unknown Input.type silently coerced to 'Angle'. **HIGH**
- [ ] **L2D-JSON-04** `physics3json.js:112` No NaN/Infinity guard on vertex Position / Mobility / Delay / Acceleration / Radius. **HIGH**
- [ ] **L2D-JSON-05** `physics3json.js:73` Rule emitted with fewer than 2 vertices. **HIGH**
- [ ] **L2D-JSON-07** `physics3jsonImport.js:124` Missing Output.VertexIndex silently defaults to 1. **MEDIUM**
- [ ] **L2D-JSON-08** `motion3json.js:108` Action duration/fps default to 2000ms/24fps. **MEDIUM**
- [ ] **L2D-JSON-09** `motion3jsonImport.js:106` Duration ≤0 silently clamped to 1ms. **MEDIUM**
- [ ] **L2D-JSON-12** `cdi3json.js:38` No dedup on Parameters/Parts. **LOW**

### cross-store (8)

- [ ] **CROSS-1** `projectStore.js:1911` deleteNode does not clean up editor/selection/animation stores. **HIGH** (central)
- [ ] **CROSS-4** `paramValuesStore.js:46` Not reset on project load / reset — stale param values persist. **HIGH**
- [ ] **CROSS-5** `registry.js:411` selection.delete clears selectionStore but not editorStore.selection. **MEDIUM**
- [ ] **CROSS-7** `editorStore.js:349` selectedVertexIndices keyed by partId never pruned on delete/re-mesh. **MEDIUM**
- [ ] **CROSS-9** `editorStore.js:393` setSelection reads preferences during reducer — preference race. **MEDIUM**
- [ ] **CROSS-10** `preferencesStore.js:303` Persisted lastToolByMode may hold tool ids that no longer exist. **LOW**
- [ ] **CROSS-11** `animationStore.js:67` draftPose / restPose Maps leak entries for deleted nodes. **LOW**
- [ ] **CROSS-12** `editorStore.js:227` expandedGroups Set never pruned. **LOW**

### build-tooling (4)

- [ ] **BUILD-001** `vite.config.js:27` manual-chunks denylist — new lazy packages silently land in main bundle. **MEDIUM**
- [ ] **BUILD-006** `public/manifest.webmanifest:11` PWA manifest icon set is default Vite SVG only. **LOW**
- [ ] **BUILD-008** `tsconfig.json:38` tsconfig + jsconfig duplicate paths config — drift risk. **LOW**
- [ ] **BUILD-009** `swRegister.jsx:7` Docstring references hook-form but code uses callback-form. **LOW**

### ui-edge (3)

- [ ] **F1** `editorStore.js:531` exitEditMode / setEditMode does not cancel active modal G/R/S overlays. **HIGH**
- [ ] **F2** `projectStore.js:1208` loadProject / resetProject does not cancel active modals or reset cross-project ephemeral stores. **HIGH**
- [ ] **F4** `DopesheetEditor.jsx:1030` Dopesheet grab modal window keydown does not block Ctrl+Z. **HIGH**

### renderer (6)

- [ ] **GL-03** `CanvasViewport.jsx:616` No WebGL context-loss handlers. **HIGH**
- [ ] **GL-04** `CanvasViewport.jsx:657` Tab-hidden rAF pause causes physics/breath spike on resume. **MEDIUM**
- [ ] **GL-06** `CanvasViewport.jsx:3572` handleReset / handleLoadProject leak upload-cache refs. **MEDIUM**
- [ ] **GL-07** `partRenderer.js:59` Triangle/wireframe IBO hardcoded to Uint16Array — >65535 verts truncate. **MEDIUM**
- [ ] **GL-08** `partRenderer.js:196` LINEAR min-filter + generateMipmap — wasted mipmap chain. **MEDIUM**
- [ ] **GL-10** `scenePass.js:70` premultipliedAlpha:false but blendFunc(ONE,...) — mixed alpha at page-composite. **LOW**

### migrations-drivers (3)

- [ ] **MIG-NAN-SCHEMA-VERSION** `projectMigrations.js:1153` NaN schemaVersion silently skips ALL migrations. **HIGH**
- [ ] **MIG-V18-UV-FLOAT32-MISSING** `projectFile.js:267` UV→Float32Array restore skips post-v18 meshData nodes. **HIGH**
- [ ] **DRIVER-PARAMS-VIEW-STALE-DEFAULTS** `rnaPath.js:172` Driver variables reading `objects["__params__"]` see defaults not live values. **HIGH**

## Strategy

Group fixes by file/area. Ship in alternating Claude/Pelmentor commits per RULE-№5. Last commit was Pelmentor `4a984b8` → next is Claude.

Defer LOW-only items and BUILD-006 (asset work, separate session). Document each deferral.
