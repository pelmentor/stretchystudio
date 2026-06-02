# Audit 2026-06-02 round-2 — missing modalities

Second-round `Workflow` audit over the modalities the round-1 critic flagged as uncovered: perf/GPU lifecycle, data integrity, workers+async, undo/memory, depgraph core, security.

**Workflow run `wf_13a3aa07-109`** — 193 agents, ~8.7M tokens, 25 min.

**62 raw findings → 35 confirmed / 27 refuted** via 3-lens default-refuted verify (existence/severity/context, survives if ≤1 of 3 refutes). 44% pruning.

## Severity distribution

- HIGH (11): PERF-1, PERF-2, PERF-4, F1, WORKER-001, WORKER-002, MEM-01, MEM-02, DEPGRAPH-EVAL-01, DEPGRAPH-FRAME-01, SEC-001
- MEDIUM (~17), LOW (~7)

## Confirmed findings — punch list

Status legend: `[x]` shipped this round / `[ ]` deferred (see DEFERRED section).

### perf-gpu (8)

- [x] **PERF-1** depgraph rebuilt every viewport frame — `evalProjectFrame.js:95` calls `buildDepGraph` on every rAF tick. Memoize by project identity. **HIGH** — `b194a42`
- [x] **PERF-2** cmo3Import leaks blob URLs for orphan PNGs — `cmo3Import.js:131`. Revoke unused. **HIGH** — `88fd2b3`
- [ ] **PERF-3** moc3 `BinaryWriter._buf` is JS `number[]` — O(N) push + GC churn. Switch to growing `Uint8Array`. **MEDIUM** — DEFERRED (writer refactor scope)
- [x] **PERF-4** per-frame `new Float32Array(m.uvs)` in render loop — `CanvasViewport.jsx:1253`. Cache typed view. **HIGH** — `f3060ff`
- [ ] **PERF-5** FCurveEditor `<Plot/>` not memoized, full re-render on every `currentTime` tick. Split `<PlayheadLine/>` + `React.memo`. **MEDIUM** — DEFERRED (component split scope)
- [ ] **PERF-6** texture sync loop has no in-flight dedup — `CanvasViewport.jsx:471`. Add `pendingUploadsRef`. **MEDIUM** — DEFERRED (interacts with hot-reload swap logic)
- [ ] **PERF-7** PerformanceEditor history `[...h, fps]` re-spread every 500ms. Ring buffer. **LOW** — DEFERRED (minor)
- [x] **PERF-8** `projectFile.loadProject` leaks staged blob URLs on async Image throw — `projectFile.js:238`. Track + revoke in catch. **MEDIUM** — `88fd2b3` (combined with SEC-006)

### data-integrity (3)

- [x] **F1** `project.cursor` never persisted — `projectFile.js:162`. Reset every save→load. **HIGH** — `c323d7a`
- [x] **F5** `duplicateProject` sets `tx.oncomplete` twice; first is dead code, second inside async callback. **MEDIUM** — `47e50f8`
- [x] **F6** `writeF32` silently accepts NaN/Infinity. Guard at writer per [[typeof-nan-is-number]]. **MEDIUM** — `10169b0`

### workers-async (8)

- [x] **WORKER-001** psdFinalize worker pool reuses dead worker after `onerror` — every queued job after a crash hangs. **HIGH** — `be96b06`
- [x] **WORKER-002** `PsdImportWizard` fires `PsdImportService.finalize` without await — rejections become unhandled. **HIGH** — `bdd1a24`
- [x] **WORKER-003** `dispatchMeshWorker` swallows worker rejections with bare `console.error`. Route via logger.error. **MEDIUM** — `4d8c516`
- [x] **WORKER-004** PSD worker silently no-ops on missing `buffer` — main-thread promise never settles. Reply with `ok:false`. **MEDIUM** — `bdd1a24`
- [x] **WORKER-006** `new Image()` decode sites lack `img.onerror` handlers — silent no-op on decode fail. **MEDIUM** — `4d8c516`
- [x] **WORKER-007** `RigService._harvestPipelinePromise` memoised without `.catch` reset — rejection sticks for the session. **MEDIUM** — `bdd1a24`
- [x] **WORKER-008** mesh worker `error: err.message` produces `undefined` for non-Error throws. Use safer stringify. **LOW** — `4d8c516`
- [ ] **WORKER-010** `swRegister.jsx` uses `cancelled` flag instead of AbortController. **LOW** — DEFERRED (finding itself acknowledged "doc as intentional one-shot" — no behavioural bug)

### undo-memory (6)

- [x] **MEM-01** `deleteNode` does not revoke part-texture blob URLs. **HIGH** — `28e9ed7`
- [x] **MEM-02** `useAudioSync` never closes AudioContext nor prunes `buffersRef` on track removal. **HIGH** — `d0051ce`
- [ ] **MEM-03** `pushSnapshot` pins deleted-texture blob URLs for up to 50 history steps. **MEDIUM** — DEFERRED (refcount design needed)
- [x] **MEM-05** `new Image()` sites lack `onerror` — failed decode never updates `lastUploadedSourcesRef`, retries every project mutation. **MEDIUM** — `4d8c516` (overlaps WORKER-006)
- [x] **MEM-09** `handleSave` revokes object URL synchronously after `a.click()` — may race the download. **LOW** — `4d8c516`
- [x] **MEM-11** decode-only AudioContext at `TimelineEditor.jsx:415` never closed. **MEDIUM** — `d0051ce`

### depgraph-core (6)

- [x] **DEPGRAPH-EVAL-01** every depgraph kernel exception silently swallowed — `eval.js:196`. **HIGH** (RULE-№1 keystone) — `5d5c5af`
- [ ] **DEPGRAPH-BUILD-01** `buildDriverRelations` only wires `__params__` driver variables; node-property variables silently skipped. **HIGH** — DEFERRED (substantive substrate change)
- [x] **DEPGRAPH-BUILD-03** per-warp chain walk re-scans `project.nodes` — O(N×N×D) build cost. **MEDIUM** — `95aa073`
- [x] **DEPGRAPH-FRAME-01** full depgraph rebuild every viewport tick (combined with PERF-1). **HIGH** — `b194a42`
- [ ] **STORE-03** `applyPoseAsRest` silent partial bake on overlay-followed parts. **MEDIUM** — DEFERRED (needs overlay-path bake design)
- [x] **PERSIST-01** `duplicateProject` reads `blobReq.result` before blob request completes (combined with F5). **MEDIUM** — `47e50f8`

### security (5)

- [x] **SEC-001** unbounded length/offset reads in CAFF parser — malicious `.cmo3` can hang / OOM. **HIGH** — `ee39d8a`
- [x] **SEC-004** orphan-PNG blob URL leak in cmo3Import (combined with PERF-2). **MEDIUM** — `88fd2b3`
- [x] **SEC-005** driver sandbox token-reject regex widened. **MEDIUM** — `75e0437`
- [x] **SEC-006** texture blob URL leaks on async Image decode throw — combined with PERF-8. **LOW** — `88fd2b3`
- [x] **SEC-007** PSD walker recurses without depth limit — iterative queue. **LOW** — `75e0437`

## Deferred (6)

- **PERF-3** moc3 `BinaryWriter` Uint8Array refactor — would require auditing every call site that assumes `_buf` is a JS array; better as its own pass.
- **PERF-5** FCurveEditor Plot memoization — needs `<PlayheadLine/>` extraction; substantial component refactor.
- **PERF-6** texture sync in-flight dedup — interacts with hot-reload swap logic in non-obvious ways; needs careful trace through `versionControl.textureVersion`.
- **PERF-7** PerformanceEditor ring buffer — low-impact (only the panel-open case).
- **WORKER-010** swRegister AbortController — the finding itself acknowledged the `cancelled` flag is sufficient for one-shot registration. Document-as-intentional, no behavioural bug.
- **MEM-03** undo-history blob URL refcount — needs a refcount table at blob-creation sites (PSD import + projectFile load) + a symmetric decrement on snapshot evict + `clearHistory`. Substantial design.
- **DEPGRAPH-BUILD-01** driver node-property variables — needs `decodeFCurveTarget`-style decoder per driver var + `findIdNode(target.nodeId).TRANSFORM_COMPOSE → driverOp` edge for every node target. Substantive substrate change.
- **STORE-03** `applyPoseAsRest` overlay-followed parts — either extend the bake to write `mesh.vertices` via the overlay matrix path, or detect overlay-followed descendants of zeroed bones and bail with a logger.warn. Needs design call.

## Shipped commits this round (chronological)

| # | Commit | Author | Items |
|---|--------|--------|-------|
| 1 | `053eaeb` | pelmentor | tracking doc |
| 2 | `5d5c5af` | Claude | DEPGRAPH-EVAL-01 |
| 3 | `c323d7a` | pelmentor | F1 |
| 4 | `10169b0` | Claude | F6 |
| 5 | `ee39d8a` | pelmentor | SEC-001 |
| 6 | `be96b06` | Claude | WORKER-001 |
| 7 | `bdd1a24` | pelmentor | WORKER-002/-004/-007 |
| 8 | `4d8c516` | Claude | WORKER-003/-006/-008 + MEM-05/-09 |
| 9 | `28e9ed7` | pelmentor | MEM-01 |
| 10 | `d0051ce` | Claude | MEM-02/-11 |
| 11 | `88fd2b3` | pelmentor | PERF-2 + SEC-004 + SEC-006 + PERF-8 |
| 12 | `f3060ff` | Claude | PERF-4 |
| 13 | `b194a42` | pelmentor | PERF-1 + DEPGRAPH-FRAME-01 |
| 14 | `95aa073` | Claude | DEPGRAPH-BUILD-03 |
| 15 | `47e50f8` | pelmentor | F5 + PERSIST-01 |
| 16 | `75e0437` | Claude | SEC-005 + SEC-007 |

**Closed: 27 / 35 confirmed findings.** 8 deferred (each with reason above).

## Critic — missed categories (round-3 candidates)

Completeness critic strongly recommended round-3 with these axes (rank-ordered by expected yield per critic notes):

1. **live2d-json-subformats** — cdi3/model3/physics3/motion3 import+export. Untouched in r1+r2. Likely same NaN-accept + unchecked-trust class as moc3/CAFF.
2. **test-infrastructure-CI** — no CI workflows, no Husky, all tests chained with `&&` (first failure aborts whole suite).
3. **cross-store-consistency** — 12+ Zustand stores. Selection stores hold node IDs that `deleteNode` may purge.
4. **build-tooling-pwa** — vite.config.js chunking, PWA Workbox precache regex drift, dist/ ships test artifacts at root.
5. **ui-operator-edge-cases** — NLA tweak mode, dopesheet, modal-transform race conditions.
6. type-system-gaps-beyond-ts-check (149/517 files lack `@ts-check`)
7. localization-completeness
8. documentation-drift (MEMORY.md exceeded size cap)
9. indexeddb-schema-and-quota
10. renderer-correctness (mask stencil N>16, FBO validity after deleteNode)
11. accessibility-and-focus
12. error-boundary-and-logger-coverage (sensitive-data in payloads)
13. schema-migration-safety (v18..v48 rollback)
14. driver-cycle-detection
15. moc3-byte-fidelity-regression (no continuous byte-diff in `npm test`)
16. network-trust-and-SRI (jsdelivr CDN — no SRI)
17. service-worker-update-flow

## Resume hint

Next session can either:
1. Pick up one of the 8 DEFERRED items above (each is well-scoped).
2. Launch round-3 over the top-5 critic-flagged categories.
3. Resume bug-03 Shelby handwear once user re-runs Init Rig.
