# Audit 2026-06-02 round-4 — substrate

Fourth-round Workflow over byte-fidelity binary writers + Cubism kernels + anim editors + mesh-edit kernels + bone skinning + migration chain.

**Workflow run `wf_42f51bc7-f49`** — 205 agents, ~10M tokens, 33 min.

**66 raw findings → 24 confirmed / 42 refuted** via 3-lens default-refuted verify (64% pruning — strictest round yet).

## Severity distribution

- HIGH (16), MEDIUM (3), LOW (5)

## Confirmed findings

### moc3-cmo3-writers (2)

- [x] **WRT-1** `binaryWriter.js:33` writeI32/writeI16/writeU8 silently coerce NaN to 0. **HIGH** — `19798a6`
- [x] **WRT-2** `xmlbuilder.js:114` XmlBuilder serializes NaN/Infinity as literal strings. **HIGH** — `19798a6`

### cubism-kernels (4)

- [ ] **CUBISM-PORT-001** `scenePass.js:245` Overlapping mask meshes alias on shared 8-bit stencil. **HIGH** — DEFERRED (needs Cubism bit-packed channel masking shader; substantial refactor)
- [x] **CUBISM-PORT-004** `kernels/keyform.js:134` Rotation keyform interp silently shrinks scale on missing keyform. **HIGH** — `d803df4`
- [x] **CUBISM-PORT-007** `kernels/rotationSetup.js:142` Per-call Float32Array allocations. **LOW** — `3ed2e92`
- [x] **CUBISM-PORT-008** `cubismWarpEval.js:407` Corner-zone find rebuilds 4-elem array per OOB vertex. **MEDIUM** — `3ed2e92`

### anim-editors (6)

- [x] **ANIM-1** `TimelineEditor.jsx:734` selectedKeyframes never cleared on action change. **HIGH** — `8958142`
- [x] **ANIM-2** `keyformSelectionStore.js:95` Global store stale fcurveIds across action switch. **HIGH** — `8958142`
- [x] **ANIM-3** `NLAEditor.jsx:1042` Strip context Edit Action ignores PROTECTED + tweak gates. **HIGH** — `8958142`
- [x] **ANIM-4** `animationStore.js:97` setStartFrame no NaN guard, no end-frame clamp. **HIGH** — `8958142`
- [x] **ANIM-5** `TimelineEditor.jsx:736` Clipboard doesn't record source action. **MEDIUM** — `8958142`
- [x] **ANIM-11** `TimelineEditor.jsx:1180` Keydown handler doesn't gate contentEditable. **LOW** — `8958142`

### mesh-edit-kernels (3)

- [x] **MESH-002** `lib/sculpt/grab.js:69` grabTick writes only {x,y} — restX/restY never updated. **HIGH** — `587a5f1`
- [x] **MESH-010** `applyTopologyOp.js:144` Array.from(uvs) collapses Float32Array. **LOW** — `587a5f1`
- [x] **MESH-011** `normalize.js:113` Divides by sum without subnormal floor. **LOW** — `587a5f1`

### bone-skinning-constraints (2)

- [x] **F1-rotation-units-mismatch** `constraints.js:230` Constraints operate in radians, project in degrees. **HIGH** — `5aedfd9`
- [ ] **F9-copy-rotation-wrap** `constraints.js:249` evalCopyRotation wrapPi causes ±360° flip. **LOW** — DEFERRED (needs broader unwrap policy across motion3 export + drivers)

### migration-chain-keymap (7)

- [x] **A-1** `artMeshRuntimeSync.js:155` persistArtMeshRuntime silent no-op post-v18. **HIGH** — `79b5bdc`
- [x] **A-2** `groupRotationToBone.js:193` v44 migration skips every part post-v18. **HIGH** — `79b5bdc`
- [x] **A-4** `v47_runtime_parent_strip.js:58` v47 strip no-op post-v18. **HIGH** — `79b5bdc`
- [x] **A-5** `projectFile.js:111` Save doesn't convert meshData uvs Float32Array. **HIGH** — `79b5bdc`
- [x] **B-1** `dispatcher.js:62` Keymap swallows operator exceptions. **HIGH** — `f1eab4a`
- [x] **B-2** `registry.js:336` selection.selectAllToggle reads node.mesh.vertices. **HIGH** — `79b5bdc`
- [x] **B-3** `DopesheetEditor.jsx:584` G/Delete/Shift+D don't stopPropagation. **MEDIUM** — `f1eab4a`

## Deferred (2 items)

- **CUBISM-PORT-001** mask stencil overlap — needs Cubism-style bit-packed channel masking shader (matches `CubismClippingManager_WebGL`). Substantial shader + state-management rework; separate session.
- **F9-copy-rotation-wrap** — drop wrapPi from evalCopyRotation to preserve unwrapped value across frames. Touches drivers, fcurve interp, motion3 diff export. Needs broader unwrap policy.

## Shipped commits this round (chronological)

| # | Commit | Author | Items |
|---|--------|--------|-------|
| 1 | `509ce66` | Claude | tracking doc |
| 2 | `19798a6` | pelmentor | WRT-1 + WRT-2 |
| 3 | `79b5bdc` | Claude | v18 cascade A-1/-2/-4/-5 + B-2 |
| 4 | `d803df4` | pelmentor | CUBISM-PORT-004 |
| 5 | `8958142` | Claude | ANIM-1..-5/-11 |
| 6 | `587a5f1` | pelmentor | MESH-002/-010/-011 |
| 7 | `f1eab4a` | Claude | B-1 + B-3 |
| 8 | `5aedfd9` | pelmentor | F1-rotation-units |
| 9 | `3ed2e92` | Claude | CUBISM-PORT-007/-008 |

**Closed: 22 / 24 confirmed findings.** 2 deferred.

## Critic — missed categories (next round)

After 4 rounds: PSD ingestion pipeline + worker pool, can3 + JSON sibling writers (motion3/physics3/cdi3/model3 still partial post-R3), Cubism physics tick, caffPacker/Unpacker XML escape, cmo3 import synthesis pipeline, Service layer (RigService/PoseService/ImportService/ExportService/dwposeService).

## Resume hint

Last commit Claude `3ed2e92` → next pelmentor (close-out).

Next round candidates: byte-fidelity service layer + cmo3 import synthesis (highest critic-flagged yield), or PSD ingestion pipeline.
