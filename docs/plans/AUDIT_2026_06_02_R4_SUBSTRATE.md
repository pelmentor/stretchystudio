# Audit 2026-06-02 round-4 — substrate

Fourth-round Workflow over byte-fidelity binary writers + Cubism kernels + anim editors + mesh-edit kernels + bone skinning + migration chain.

**Workflow run `wf_42f51bc7-f49`** — 205 agents, ~10M tokens, 33 min.

**66 raw findings → 24 confirmed / 42 refuted** via 3-lens default-refuted verify (64% pruning — strictest round yet, critic was tough on byte-fidelity claims).

## Severity distribution

- HIGH (16): WRT-1, WRT-2, CUBISM-PORT-001, CUBISM-PORT-004, ANIM-1, ANIM-2, ANIM-3, ANIM-4, MESH-002, F1-rotation-units, A-1, A-2, A-4, A-5, B-1, B-2
- MEDIUM (3), LOW (5)

## Confirmed findings — punch list

### moc3-cmo3-writers (2)

- [ ] **WRT-1** `binaryWriter.js:33` writeI32/writeI16/writeU8 silently coerce NaN to 0. **HIGH** (mirror F6 to integer bucket)
- [ ] **WRT-2** `xmlbuilder.js:114` XmlBuilder serializes NaN/Infinity attribute values as literal strings. **HIGH** (cmo3 round-trip)

### cubism-kernels (4)

- [ ] **CUBISM-PORT-001** `scenePass.js:245` Overlapping mask meshes alias on shared 8-bit stencil. **HIGH** — DEFERRED (needs Cubism-style bit-packed channel masking shader; substantial refactor)
- [ ] **CUBISM-PORT-004** `kernels/keyform.js:134` Rotation keyform interpolation silently shrinks scale when any keyform missing. **HIGH**
- [ ] **CUBISM-PORT-007** `kernels/rotationSetup.js:142` Per-evalChainAtPoint Float32Array allocations per rotation per frame. **LOW** (perf)
- [ ] **CUBISM-PORT-008** `cubismWarpEval.js:407` Corner-zone find rebuilds 4-element array per OOB vertex. **MEDIUM** (perf)

### anim-editors (6)

- [ ] **ANIM-1** `TimelineEditor.jsx:734` selectedKeyframes Set never cleared on action change. **HIGH**
- [ ] **ANIM-2** `keyformSelectionStore.js:95` Global store retains stale fcurveId entries across action switch. **HIGH**
- [ ] **ANIM-3** `NLAEditor.jsx:1042` Strip context menu 'Edit Action' ignores PROTECTED + tweak-mode gates. **HIGH**
- [ ] **ANIM-4** `animationStore.js:97` setStartFrame doesn't clamp vs endFrame, lets NaN/Infinity through. **HIGH**
- [ ] **ANIM-5** `TimelineEditor.jsx:736` Clipboard does not record source action. **MEDIUM**
- [ ] **ANIM-11** `TimelineEditor.jsx:1180` Keydown handler doesn't gate on contentEditable / range selection. **LOW**

### mesh-edit-kernels (3)

- [ ] **MESH-002** `lib/sculpt/grab.js:69` grabTick writes only {x,y} — restX/restY never updated. **HIGH**
- [ ] **MESH-010** `applyTopologyOp.js:144` Array.from(uvs) converts Float32Array to plain Array. **LOW**
- [ ] **MESH-011** `normalize.js:113` normalizeAllWeights divides by sum without subnormal floor. **LOW**

### bone-skinning-constraints (2)

- [ ] **F1-rotation-units-mismatch** `constraints.js:230` TRACK_TO / LIMIT_ROTATION treat rotation as radians, renderer reads as degrees. **HIGH**
- [ ] **F9-copy-rotation-wrap** `constraints.js:249` evalCopyRotation wrapPi causes ±360° flip across frames. **LOW** — DEFERRED (needs broader constraint math unwrap policy)

### migration-chain-keymap (7)

- [ ] **A-1** `artMeshRuntimeSync.js:155` persistArtMeshRuntime silent no-op post-v18 (reads node.mesh). **HIGH**
- [ ] **A-2** `groupRotationToBone.js:193` v44 GroupRotation→bone skips every part post-v18. **HIGH**
- [ ] **A-4** `v47_runtime_parent_strip.js:58` v47 strip no-op on post-v18 (reads node.mesh?.runtime). **HIGH**
- [ ] **A-5** `projectFile.js:111` Save path doesn't convert meshData uvs Float32Array → number[]. **HIGH**
- [ ] **B-1** `dispatcher.js:62` Keymap dispatcher swallows operator exceptions (R1 only fixed menu invokers). **HIGH**
- [ ] **B-2** `registry.js:336` selection.selectAllToggle reads node.mesh.vertices — always 0 post-v18. **HIGH**
- [ ] **B-3** `DopesheetEditor.jsx:584` G/Delete/Shift+D handlers don't stopPropagation. **MEDIUM**

## Critic — missed categories (next round)

After 4 rounds: PSD ingestion pipeline, can3 + JSON sibling writers (motion3/physics3/cdi3/model3 still partial), Cubism physics tick, caffPacker/Unpacker XML escape + zip-entry encoding, cmo3 import synthesis pipeline, Service layer (RigService, PoseService, ImportService, ExportService, etc.).

## Strategy

Last commit Pelmentor `1ffc4ea` → next Claude (this doc). Then batch:
1. WRT-1 + WRT-2 (mirror F6 to integers + XML)
2. v18-cascade A-1/-2/-4/-5/B-2 (all silent-noops from same root cause)
3. CUBISM-PORT-004 + CUBISM-PORT-007/-008 (correctness + perf)
4. ANIM batch (1+2 prune, 3 gate, 4 clamp, 5 clipboard, 11 contentEditable)
5. MESH batch (002 restX/Y, 010+011 hygiene)
6. F1 rotation units
7. B-1 + B-3 dispatcher
8. Close-out
