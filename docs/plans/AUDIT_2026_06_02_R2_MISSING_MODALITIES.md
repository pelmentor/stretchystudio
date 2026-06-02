# Audit 2026-06-02 round-2 — missing modalities

Second-round `Workflow` audit over the modalities the round-1 critic flagged as uncovered: perf/GPU lifecycle, data integrity, workers+async, undo/memory, depgraph core, security.

**Workflow run `wf_13a3aa07-109`** — 193 agents, ~8.7M tokens, 25 min.

**62 raw findings → 35 confirmed / 27 refuted** via 3-lens default-refuted verify (existence/severity/context, survives if ≤1 of 3 refutes). 44% pruning.

## Severity distribution

- HIGH (11): PERF-1, PERF-2, PERF-4, F1, WORKER-001, WORKER-002, MEM-01, MEM-02, DEPGRAPH-EVAL-01, DEPGRAPH-FRAME-01, SEC-001
- MEDIUM (~17), LOW (~7)

## Confirmed findings — punch list

### perf-gpu (7)

- [ ] **PERF-1** depgraph rebuilt every viewport frame — `evalProjectFrame.js:95` calls `buildDepGraph` on every rAF tick. Memoize by project identity. **HIGH**
- [ ] **PERF-2** cmo3Import leaks blob URLs for orphan PNGs — `cmo3Import.js:131`. Revoke unused. **HIGH**
- [ ] **PERF-3** moc3 `BinaryWriter._buf` is JS `number[]` — O(N) push + GC churn. Switch to growing `Uint8Array`. **MEDIUM**
- [ ] **PERF-4** per-frame `new Float32Array(m.uvs)` in render loop — `CanvasViewport.jsx:1253`. Cache typed view. **HIGH**
- [ ] **PERF-5** FCurveEditor `<Plot/>` not memoized, full re-render on every `currentTime` tick. Split `<PlayheadLine/>` + `React.memo`. **MEDIUM**
- [ ] **PERF-6** texture sync loop has no in-flight dedup — `CanvasViewport.jsx:471`. Add `pendingUploadsRef`. **MEDIUM**
- [ ] **PERF-7** PerformanceEditor history `[...h, fps]` re-spread every 500ms. Ring buffer. **LOW**
- [ ] **PERF-8** `projectFile.loadProject` leaks staged blob URLs on migration throw — `projectFile.js:238`. Track + revoke in catch. **MEDIUM**

### data-integrity (3)

- [ ] **F1** `project.cursor` never persisted — `projectFile.js:162`. Reset every save→load. **HIGH**
- [ ] **F5** `duplicateProject` sets `tx.oncomplete` twice; first is dead code, second inside async callback. **MEDIUM**
- [ ] **F6** `writeF32` silently accepts NaN/Infinity. Guard at writer per [[typeof-nan-is-number]]. **MEDIUM**

### workers-async (8)

- [ ] **WORKER-001** psdFinalize worker pool reuses dead worker after `onerror` — every queued job after a crash hangs. **HIGH**
- [ ] **WORKER-002** `PsdImportWizard` fires `PsdImportService.applyRig/finalize` without await — rejections become unhandled. **HIGH**
- [ ] **WORKER-003** `dispatchMeshWorker` swallows worker rejections with bare `console.error`. Route via logger.error + toast. **MEDIUM**
- [ ] **WORKER-004** PSD worker silently no-ops on missing `buffer` — main-thread promise never settles. Reply with `ok:false`. **MEDIUM**
- [ ] **WORKER-006** `new Image()` decode sites lack `img.onerror` handlers — silent no-op on decode fail. **MEDIUM**
- [ ] **WORKER-007** `RigService._harvestPipelinePromise` memoised without `.catch` reset — rejection sticks for the session. **MEDIUM**
- [ ] **WORKER-008** mesh worker `error: err.message` produces `undefined` for non-Error throws. Use safer stringify. **LOW**
- [ ] **WORKER-010** `swRegister.jsx` uses `cancelled` flag instead of AbortController. Doc-as-intentional one-shot. **LOW**

### undo-memory (6)

- [ ] **MEM-01** `deleteNode` does not revoke part-texture blob URLs nor fan out to auxiliary stores. **HIGH**
- [ ] **MEM-02** `useAudioSync` never closes AudioContext nor prunes `buffersRef` on track removal — leaks AudioContext per mount. **HIGH**
- [ ] **MEM-03** `pushSnapshot` pins deleted-texture blob URLs for up to 50 history steps — needs evict-diff revoke. **MEDIUM**
- [ ] **MEM-05** `new Image()` sites lack `onerror` — failed decode never updates `lastUploadedSourcesRef`, retries every project mutation. **MEDIUM** (overlaps WORKER-006)
- [ ] **MEM-09** `handleSave` revokes object URL synchronously after `a.click()` — may race the download. **LOW**
- [ ] **MEM-11** decode-only AudioContext at `TimelineEditor.jsx:415` never closed. **MEDIUM** (overlaps MEM-02)

### depgraph-core (5)

- [ ] **DEPGRAPH-EVAL-01** every depgraph kernel exception silently swallowed — `eval.js:196`. Replace bare `catch {}` with `reportOpFailure`. **HIGH** (RULE-№1 keystone)
- [ ] **DEPGRAPH-BUILD-01** `buildDriverRelations` only wires `__params__` driver variables; node-property variables (`objects["<id>"].pose.rotation`) silently skipped — driver reads stale value. **HIGH**
- [ ] **DEPGRAPH-BUILD-03** per-warp chain walk re-scans `project.nodes` via `Array.find` inside a loop — O(N×N×D) build cost. Build `nodesById` Map once. **MEDIUM**
- [ ] **DEPGRAPH-FRAME-01** full depgraph rebuild every viewport tick (duplicates PERF-1). **HIGH**
- [ ] **STORE-03** `applyPoseAsRest` silent partial bake on overlay-followed parts. **MEDIUM**
- [ ] **PERSIST-01** `duplicateProject` reads `blobReq.result` before blob request completes (duplicates F5). **MEDIUM**

### security (5)

- [ ] **SEC-001** unbounded length/offset reads in CAFF parser — malicious `.cmo3` can hang / OOM. **HIGH**
- [ ] **SEC-004** orphan-PNG blob URL leak in cmo3Import (duplicates PERF-2). **MEDIUM**
- [ ] **SEC-005** driver sandbox relies on token-reject regex — `Function`, `constructor`, `arguments`, `prototype`, backticks not rejected. **MEDIUM**
- [ ] **SEC-006** texture blob URL leaks on async Image decode throw — `projectFile.js:238`. Revoke in catch. **LOW**
- [ ] **SEC-007** PSD walker recurses without depth limit — `psd.worker.js:33`. Iterative queue. **LOW**

## Refuted (sampling)

27 findings were refuted by the 3-lens verify (default refuted=true requires affirmative confirmation from ≥2 of 3 lenses).

## Critic — missed categories (round-3 candidates)

Completeness critic strongly recommended round-3 with these axes (rank-ordered by expected yield per critic notes):

1. **live2d-json-subformats** — cdi3/model3/physics3/motion3 import+export. Untouched in r1+r2. Likely same NaN-accept + unchecked-trust class as moc3/CAFF.
2. **test-infrastructure-CI** — no CI workflows, no Husky, all tests chained with `&&` (first failure aborts whole suite).
3. **cross-store-consistency** — 12+ Zustand stores, BUG-022/BUG-024 history shows real defect class. Selection stores hold node IDs that `deleteNode` may purge.
4. **build-tooling-pwa** — vite.config.js chunking, dropOrtWasm plugin, PWA Workbox precache regex drift, dist/ ships `SHELBY_*` + `.psd` + `.jfif` at root.
5. **ui-operator-edge-cases** — NLA tweak mode, dopesheet, modal-transform race conditions.
6. type-system-gaps-beyond-ts-check (149/517 files lack `@ts-check`, 68 `any`/`as-any`/`@ts-ignore` escape hatches)
7. localization-completeness (only en+ru shipped; no extraction tool)
8. documentation-drift (40+ markdown plans; MEMORY.md exceeded size cap)
9. indexeddb-schema-and-quota (QuotaExceededError, cross-tab concurrent writes)
10. renderer-correctness (mask stencil under N>16 masks, FBO validity after deleteNode)
11. accessibility-and-focus (modal focus trap, Esc handling)
12. error-boundary-and-logger-coverage (ring-buffer cap, sensitive-data leak in payloads)
13. schema-migration-safety (v18..v48 chain rollback impossibility)
14. driver-cycle-detection (A→B→A driver cycles likely silent infinite loops)
15. moc3-byte-fidelity-regression (no continuous byte-diff test in `npm test`)
16. network-trust-and-SRI (jsdelivr CDN fetch for onnxruntime-web wasm — no SRI, no fallback)
17. service-worker-update-flow (registerType:'prompt' double-registration race)

## Resume after fix sweep

This doc is the punch list. Close items by checking the boxes + reference commit hash inline.

After autonomous sweep: write session aggregate, update MEMORY.md, optionally launch round-3 over the top-5 missed categories.
